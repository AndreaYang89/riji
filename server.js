/**
 * AA日记后端服务
 * Express REST API + WebSocket 实时推送
 */
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const mysql = require('mysql2/promise');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'aa-diary-secret-key-change-in-production';

// ======================== 配置 ========================
const PORT = process.env.PORT || 3001;
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'aa_diary',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
};

// ======================== 初始化 ========================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const pool = mysql.createPool(DB_CONFIG);

// WebSocket 连接池：pairId -> Set<ws>
const pairConnections = new Map();

// ======================== 工具方法 ========================
function genInviteCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** 向同一配对关系下的所有 WebSocket 客户端广播 */
function broadcastToPair(pairId, event, data, excludeUserId = null) {
  const clients = pairConnections.get(pairId);
  if (!clients) return;
  const msg = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const ws of clients) {
    if (ws._userId !== excludeUserId && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

/** 通过用户ID获取用户 */
async function getUserById(userId) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
  return rows[0] || null;
}

/** 通过用户名获取用户 */
async function getUserByUsername(username) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
  return rows[0] || null;
}

/** 验证 JWT Token */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/** 生成 JWT Token */
function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

/** 加载配对关系下的所有数据 */
async function loadPairData(pairId) {
  const [diaries] = await pool.execute(
    'SELECT d.diary_date, d.content, d.updated_at, u.role FROM diaries d JOIN users u ON d.user_id = u.id WHERE d.pair_id = ? ORDER BY d.diary_date',
    [pairId]
  );
  const [vouchers] = await pool.execute(
    'SELECT id, sender_role, reason, status, created_at FROM vouchers WHERE pair_id = ? ORDER BY created_at DESC',
    [pairId]
  );
  const [wishes] = await pool.execute(
    'SELECT id, creator_role, content, completed, created_at FROM wishes WHERE pair_id = ? ORDER BY created_at DESC',
    [pairId]
  );
  const [countdowns] = await pool.execute(
    'SELECT id, title, target_date, created_at FROM countdowns WHERE pair_id = ? ORDER BY target_date',
    [pairId]
  );
  const [pair] = await pool.execute('SELECT anniversary FROM pairs WHERE id = ?', [pairId]);
  const [users] = await pool.execute('SELECT role, mood FROM users WHERE pair_id = ?', [pairId]);

  const diaryData = {};
  for (const d of diaries) {
    const dateStr = typeof d.diary_date === 'string' ? d.diary_date.slice(0, 10) : d.diary_date;
    if (!diaryData[dateStr]) diaryData[dateStr] = {};
    diaryData[dateStr][d.role] = { text: d.content, updatedAt: new Date(d.updated_at).getTime() };
  }

  const moods = { girl: 'happy', boy: 'happy' };
  for (const u of users) {
    if (u.role) moods[u.role] = u.mood || 'happy';
  }

  const fmtDate = (d) => d ? (typeof d === 'string' ? d.slice(0, 10) : d) : null;

  return {
    anniversary: fmtDate(pair[0]?.anniversary) || null,
    moods,
    diaryData,
    vouchers: vouchers.map(v => ({ id: v.id, title: '不生气券', reason: v.reason, status: v.status, senderRole: v.sender_role, createdAt: new Date(v.created_at).getTime() })),
    wishlist: wishes.map(w => ({ id: w.id, text: w.content, completed: !!w.completed, creator: w.creator_role, createdAt: new Date(w.created_at).getTime() })),
    countdowns: countdowns.map(c => ({ id: c.id, title: c.title, date: fmtDate(c.target_date), createdAt: new Date(c.created_at).getTime() })),
  };
}

// ======================== REST API ========================

/**
 * POST /api/auth
 * Body: { token: string }
 */
app.post('/api/auth', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(401).json({ error: '未登录' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });

    if (user.pair_id) {
      const [pair] = await pool.execute('SELECT * FROM pairs WHERE id = ?', [user.pair_id]);
      if (pair.length > 0 && pair[0].status === 'paired') {
        const pairData = await loadPairData(user.pair_id);
        return res.json({
          status: 'paired',
          user: { id: user.id, role: user.role, pairId: user.pair_id, nickname: user.nickname },
          data: pairData,
        });
      }
      return res.json({
        status: 'waiting',
        user: { id: user.id, role: user.role, pairId: user.pair_id, nickname: user.nickname },
        inviteCode: pair[0]?.invite_code,
      });
    }

    return res.json({ status: 'unpaired', user: { id: user.id, role: null, pairId: null, nickname: user.nickname } });
  } catch (err) {
    console.error('auth error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/register
 * Body: { username, password, nickname? }
 */
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, nickname } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    if (username.length < 3 || username.length > 32) {
      return res.status(400).json({ error: '用户名长度需在3-32个字符之间' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少6位' });
    }

    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return res.status(409).json({ error: '用户名已被注册' });
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, 10);
    const userNickname = nickname || username;

    await pool.execute(
      'INSERT INTO users (id, username, password_hash, nickname) VALUES (?, ?, ?, ?)',
      [id, username, passwordHash, userNickname]
    );

    const token = generateToken(id);

    res.json({
      success: true,
      message: '注册成功',
      token,
      user: { id, username, nickname: userNickname, role: null, pairId: null }
    });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/login
 * Body: { username, password }
 */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = generateToken(user.id);

    const response = {
      success: true,
      message: '登录成功',
      token,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        pairId: user.pair_id
      }
    };

    if (user.pair_id) {
      const [pair] = await pool.execute('SELECT * FROM pairs WHERE id = ?', [user.pair_id]);
      if (pair.length > 0) {
        if (pair[0].status === 'paired') {
          const pairData = await loadPairData(user.pair_id);
          response.status = 'paired';
          response.data = pairData;
        } else {
          response.status = 'waiting';
          response.inviteCode = pair[0].invite_code;
        }
      }
    } else {
      response.status = 'unpaired';
    }

    res.json(response);
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/pair/create
 */
app.post('/api/pair/create', async (req, res) => {
  try {
    const { token, role } = req.body;
    if (!token || !role) return res.status(400).json({ error: '缺少参数' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });

    if (user.pair_id) {
      const [existingPairs] = await pool.execute(
        'SELECT * FROM pairs WHERE id = ? AND status = "waiting"',
        [user.pair_id]
      );
      if (existingPairs.length > 0) {
        await pool.execute('DELETE FROM pairs WHERE id = ?', [user.pair_id]);
        await pool.execute('UPDATE users SET pair_id = NULL, role = NULL WHERE id = ?', [user.id]);
      } else {
        return res.status(400).json({ error: '你已在配对中' });
      }
    }

    let code;
    for (let i = 0; i < 5; i++) {
      code = genInviteCode();
      const [existing] = await pool.execute('SELECT id FROM pairs WHERE invite_code = ? AND status = "waiting"', [code]);
      if (existing.length === 0) break;
      if (i === 4) return res.status(500).json({ error: '生成邀请码失败，请重试' });
    }

    const pairId = uuid();
    await pool.execute(
      'INSERT INTO pairs (id, invite_code, user_a_id, status) VALUES (?, ?, ?, "waiting")',
      [pairId, code, user.id]
    );
    await pool.execute('UPDATE users SET role = ?, pair_id = ? WHERE id = ?', [role, pairId, user.id]);

    res.json({ status: 'waiting', inviteCode: code, pairId, role });
  } catch (err) {
    console.error('pair/create error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/pair/join
 */
app.post('/api/pair/join', async (req, res) => {
  try {
    const { token, inviteCode, role } = req.body;
    if (!token || !inviteCode || !role) return res.status(400).json({ error: '缺少参数' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (user.pair_id) return res.status(400).json({ error: '你已在配对中' });

    const [pairs] = await pool.execute(
      'SELECT * FROM pairs WHERE invite_code = ? AND status = "waiting"',
      [inviteCode]
    );
    if (pairs.length === 0) return res.status(404).json({ error: '配对码无效或已过期' });

    const pair = pairs[0];
    if (pair.user_a_id === user.id) return res.status(400).json({ error: '不能和自己配对哦' });

    const [userA] = await pool.execute('SELECT role FROM users WHERE id = ?', [pair.user_a_id]);
    if (userA[0]?.role === role) return res.status(400).json({ error: `对方已选择了${role === 'girl' ? '女生' : '男生'}，请选另一个角色` });

    await pool.execute(
      'UPDATE pairs SET user_b_id = ?, status = "paired", anniversary = CURDATE() WHERE id = ?',
      [user.id, pair.id]
    );
    await pool.execute('UPDATE users SET role = ?, pair_id = ? WHERE id = ?', [role, pair.id, user.id]);

    const pairData = await loadPairData(pair.id);
    broadcastToPair(pair.id, 'pair:completed', { pairData });

    res.json({ status: 'paired', pairId: pair.id, role, data: pairData });
  } catch (err) {
    console.error('pair/join error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/pair/cancel
 */
app.post('/api/pair/cancel', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: '缺少参数' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(400).json({ error: '当前没有配对' });

    const [pairs] = await pool.execute(
      'SELECT * FROM pairs WHERE id = ? AND status = "waiting"',
      [user.pair_id]
    );
    if (pairs.length === 0) return res.status(400).json({ error: '配对已完成，无法取消' });

    await pool.execute('DELETE FROM pairs WHERE id = ?', [user.pair_id]);
    await pool.execute('UPDATE users SET pair_id = NULL, role = NULL WHERE id = ?', [user.id]);

    res.json({ status: 'unpaired' });
  } catch (err) {
    console.error('pair/cancel error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/diary/save
 */
app.post('/api/diary/save', async (req, res) => {
  try {
    const { token, date, content } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    const id = uuid();
    await pool.execute(
      `INSERT INTO diaries (id, pair_id, user_id, diary_date, content)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = NOW()`,
      [id, user.pair_id, user.id, date, content]
    );

    broadcastToPair(user.pair_id, 'diary:updated', { date, role: user.role, text: content, updatedAt: Date.now() }, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('diary/save error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/voucher/create
 */
app.post('/api/voucher/create', async (req, res) => {
  try {
    const { token, reason } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    const id = uuid();
    await pool.execute(
      'INSERT INTO vouchers (id, pair_id, sender_id, sender_role, reason) VALUES (?, ?, ?, ?, ?)',
      [id, user.pair_id, user.id, user.role, reason]
    );

    const voucher = { id, title: '不生气券', reason, status: 'available', senderRole: user.role, createdAt: Date.now() };
    broadcastToPair(user.pair_id, 'voucher:created', voucher, user.id);
    res.json({ success: true, voucher });
  } catch (err) {
    console.error('voucher/create error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/voucher/update
 */
app.post('/api/voucher/update', async (req, res) => {
  try {
    const { token, voucherId, status } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    const [rows] = await pool.execute('SELECT status FROM vouchers WHERE id = ? AND pair_id = ?', [voucherId, user.pair_id]);
    if (rows.length === 0) return res.status(404).json({ error: '券不存在' });
    if (rows[0].status === 'revoked') return res.status(400).json({ error: '该券已被撤回，无法操作' });

    await pool.execute('UPDATE vouchers SET status = ? WHERE id = ? AND pair_id = ?', [status, voucherId, user.pair_id]);
    broadcastToPair(user.pair_id, 'voucher:updated', { id: voucherId, status }, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('voucher/update error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/voucher/revoke
 */
app.post('/api/voucher/revoke', async (req, res) => {
  try {
    const { token, voucherId } = req.body;
    if (!token || !voucherId) return res.status(400).json({ error: '缺少参数' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    const [rows] = await pool.execute(
      'SELECT * FROM vouchers WHERE id = ? AND pair_id = ?',
      [voucherId, user.pair_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '券不存在' });

    const voucher = rows[0];
    if (voucher.sender_id !== user.id) {
      return res.status(403).json({ error: '只有发放者才能撤回哦' });
    }
    if (voucher.status !== 'available') {
      return res.status(400).json({ error: '该券已被使用或正在审批中，无法撤回' });
    }

    await pool.execute('UPDATE vouchers SET status = "revoked" WHERE id = ?', [voucherId]);
    broadcastToPair(user.pair_id, 'voucher:revoked', { id: voucherId }, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('voucher/revoke error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/wish/create
 */
app.post('/api/wish/create', async (req, res) => {
  try {
    const { token, content } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    const id = uuid();
    await pool.execute(
      'INSERT INTO wishes (id, pair_id, creator_id, creator_role, content) VALUES (?, ?, ?, ?, ?)',
      [id, user.pair_id, user.id, user.role, content]
    );

    const wish = { id, text: content, completed: false, creator: user.role, createdAt: Date.now() };
    broadcastToPair(user.pair_id, 'wish:created', wish, user.id);
    res.json({ success: true, wish });
  } catch (err) {
    console.error('wish/create error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/wish/toggle
 */
app.post('/api/wish/toggle', async (req, res) => {
  try {
    const { token, wishId } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    await pool.execute('UPDATE wishes SET completed = NOT completed WHERE id = ? AND pair_id = ?', [wishId, user.pair_id]);
    const [rows] = await pool.execute('SELECT completed FROM wishes WHERE id = ?', [wishId]);
    broadcastToPair(user.pair_id, 'wish:toggled', { id: wishId, completed: !!rows[0]?.completed }, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('wish/toggle error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/wish/delete
 */
app.post('/api/wish/delete', async (req, res) => {
  try {
    const { token, wishId } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    await pool.execute('DELETE FROM wishes WHERE id = ? AND pair_id = ?', [wishId, user.pair_id]);
    broadcastToPair(user.pair_id, 'wish:deleted', { id: wishId }, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('wish/delete error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/countdown/create
 */
app.post('/api/countdown/create', async (req, res) => {
  try {
    const { token, title, date } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    const id = uuid();
    await pool.execute(
      'INSERT INTO countdowns (id, pair_id, title, target_date) VALUES (?, ?, ?, ?)',
      [id, user.pair_id, title, date]
    );

    const countdown = { id, title, date, createdAt: Date.now() };
    broadcastToPair(user.pair_id, 'countdown:created', countdown, user.id);
    res.json({ success: true, countdown });
  } catch (err) {
    console.error('countdown/create error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/mood/update
 */
app.post('/api/mood/update', async (req, res) => {
  try {
    const { token, mood } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    await pool.execute('UPDATE users SET mood = ? WHERE id = ?', [mood, user.id]);
    broadcastToPair(user.pair_id, 'mood:updated', { role: user.role, mood }, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('mood/update error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/anniversary/update
 */
app.post('/api/anniversary/update', async (req, res) => {
  try {
    const { token, date } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    await pool.execute('UPDATE pairs SET anniversary = ? WHERE id = ?', [date, user.pair_id]);
    broadcastToPair(user.pair_id, 'anniversary:updated', { date }, user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('anniversary/update error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

/**
 * POST /api/comfort
 */
app.post('/api/comfort', async (req, res) => {
  try {
    const { token } = req.body;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: '登录已过期' });

    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    if (!user.pair_id) return res.status(403).json({ error: '未配对' });

    const clients = pairConnections.get(user.pair_id);
    if (clients) {
      const msg = JSON.stringify({ event: 'comfort:received', data: { fromRole: user.role }, timestamp: Date.now() });
      for (const ws of clients) {
        if (ws._userId !== user.id && ws.readyState === WebSocket.OPEN) {
          ws.send(msg);
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('comfort error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ======================== WebSocket ========================
wss.on('connection', (ws, req) => {
  console.log('🔌 WebSocket 新连接');

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'auth') {
        const decoded = verifyToken(msg.token);
        if (!decoded) {
          ws.send(JSON.stringify({ event: 'auth:error', data: { message: '登录已过期' } }));
          return;
        }

        const user = await getUserById(decoded.userId);
        if (!user) {
          ws.send(JSON.stringify({ event: 'auth:error', data: { message: '用户不存在' } }));
          return;
        }

        ws._userId = user.id;
        ws._pairId = user.pair_id;
        ws._token = msg.token;

        if (user.pair_id) {
          if (!pairConnections.has(user.pair_id)) {
            pairConnections.set(user.pair_id, new Set());
          }
          pairConnections.get(user.pair_id).add(ws);
          ws.send(JSON.stringify({ event: 'auth:ok', data: { userId: user.id, role: user.role, pairId: user.pair_id } }));
          console.log(`  ✅ 用户 ${user.id} (${user.role}) 已加入房间 ${user.pair_id}`);
        } else {
          ws.send(JSON.stringify({ event: 'auth:ok', data: { userId: user.id, role: null, pairId: null } }));
        }
      }

      if (msg.type === 'join_room' && msg.pairId) {
        ws._pairId = msg.pairId;
        if (!pairConnections.has(msg.pairId)) {
          pairConnections.set(msg.pairId, new Set());
        }
        pairConnections.get(msg.pairId).add(ws);
        console.log(`  🔗 用户加入房间 ${msg.pairId}`);
      }

    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    if (ws._pairId && pairConnections.has(ws._pairId)) {
      pairConnections.get(ws._pairId).delete(ws);
      if (pairConnections.get(ws._pairId).size === 0) {
        pairConnections.delete(ws._pairId);
      }
    }
    console.log('🔌 WebSocket 连接断开');
  });
});

// 心跳检测
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ======================== 启动 ========================
server.listen(PORT, () => {
  console.log(`
  🌸 AA日记后端已启动
  ─────────────────────────
  REST API:    http://localhost:${PORT}/api
  WebSocket:   ws://localhost:${PORT}
  ─────────────────────────
  请先运行 npm run db:init 初始化数据库
  `);
});
