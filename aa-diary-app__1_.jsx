import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Calendar as CalendarIcon, Ticket, Plus, X, Stamp, ChevronLeft, ChevronRight, Settings2, ListTodo, Heart, Clock, CheckCircle2, Trash2, HeartHandshake, Copy, Check } from 'lucide-react';

// ======================== 配置 ========================
const API_BASE = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001';

// ======================== 设备标识 ========================
function getDeviceToken() {
  let token = null;
  try { token = localStorage.getItem('aa_device_token'); } catch(e) {}
  if (!token) {
    token = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('aa_device_token', token); } catch(e) {}
  }
  return token;
}

// ======================== API 封装 ========================
async function api(path, body = {}) {
  const deviceToken = getDeviceToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ======================== 常量 ========================
const MOOD_OPTIONS = [
  { value: 'happy', emoji: '🥰', label: '开心' },
  { value: 'surprise', emoji: '🤩', label: '惊喜' },
  { value: 'emo', emoji: '🥺', label: 'Emo' },
  { value: 'angry', emoji: '哼', label: '傲娇' }
];

const getTheme = (role) => {
  const b = role === 'boy';
  return {
    appBg: b ? '#F4F9FF' : '#FFF5F7',
    mainColor: b ? '#60a5fa' : '#f472b6',
    mainColorLight: b ? '#dbeafe' : '#fce7f3',
    mainColorSoft: b ? '#eff6ff' : '#fff1f2',
    mainColorMuted: b ? '#bfdbfe' : '#fbcfe8',
    fabFrom: b ? '#60a5fa' : '#f472b6',
    fabTo: b ? '#67e8f9' : '#fb7185',
    gradientFrom: b ? 'rgba(239,246,255,0.5)' : 'rgba(255,241,242,0.5)',
  };
};

// ======================== 主应用 ========================
export default function CoupleDiaryApp() {
  const [appState, setAppState] = useState('loading'); // loading | unpaired | waiting | paired
  const [myRole, setMyRole] = useState(null);
  const [pairId, setPairId] = useState(null);
  const [inviteCode, setInviteCode] = useState('');
  const [userId, setUserId] = useState(null);

  // 数据
  const [vouchers, setVouchers] = useState([]);
  const [diaryData, setDiaryData] = useState({});
  const [wishlist, setWishlist] = useState([]);
  const [countdowns, setCountdowns] = useState([]);
  const [moods, setMoods] = useState({ girl: 'happy', boy: 'happy' });
  const [anniversary, setAnniversary] = useState(null);

  const [activeTab, setActiveTab] = useState('calendar');
  const [showComfortEffect, setShowComfortEffect] = useState(false);

  // 弹窗
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [showAnniversaryModal, setShowAnniversaryModal] = useState(false);
  const [showWishlistModal, setShowWishlistModal] = useState(false);
  const [showCountdownModal, setShowCountdownModal] = useState(false);

  const [toastMsg, setToastMsg] = useState('');
  const [showToast, setShowToast] = useState(false);

  const wsRef = useRef(null);
  const theme = getTheme(myRole || 'girl');

  const toast = (msg) => { setToastMsg(msg); setShowToast(true); setTimeout(() => setShowToast(false), 2000); };

  // 应用数据到状态
  const applyPairData = useCallback((data) => {
    if (data.diaryData) setDiaryData(data.diaryData);
    if (data.vouchers) setVouchers(data.vouchers);
    if (data.wishlist) setWishlist(data.wishlist);
    if (data.countdowns) setCountdowns(data.countdowns);
    if (data.moods) setMoods(data.moods);
    if (data.anniversary) setAnniversary(data.anniversary);
  }, []);

  // WebSocket 连接
  const connectWS = useCallback((currentPairId) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', deviceToken: getDeviceToken() }));
      if (currentPairId) ws.send(JSON.stringify({ type: 'join_room', pairId: currentPairId }));
    };

    ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);

        switch (event) {
          case 'pair:completed':
            setAppState('paired');
            if (data.pairData) applyPairData(data.pairData);
            toast('配对成功！🎉');
            break;
          case 'diary:updated':
            setDiaryData(prev => ({
              ...prev,
              [data.date]: { ...prev[data.date], [data.role]: { text: data.text, updatedAt: data.updatedAt } }
            }));
            break;
          case 'voucher:created':
            setVouchers(prev => [data, ...prev]);
            toast('收到一张新的免死金牌！✨');
            break;
          case 'voucher:updated':
            setVouchers(prev => prev.map(v => v.id === data.id ? { ...v, status: data.status } : v));
            break;
          case 'voucher:revoked':
            setVouchers(prev => prev.map(v => v.id === data.id ? { ...v, status: 'revoked' } : v));
            toast('一张免死金牌被撤回了 😱');
            break;
          case 'wish:created':
            setWishlist(prev => [data, ...prev]);
            break;
          case 'wish:toggled':
            setWishlist(prev => prev.map(w => w.id === data.id ? { ...w, completed: data.completed } : w));
            break;
          case 'wish:deleted':
            setWishlist(prev => prev.filter(w => w.id !== data.id));
            break;
          case 'countdown:created':
            setCountdowns(prev => [...prev, data].sort((a, b) => new Date(a.date) - new Date(b.date)));
            break;
          case 'mood:updated':
            setMoods(prev => ({ ...prev, [data.role]: data.mood }));
            break;
          case 'anniversary:updated':
            setAnniversary(data.date);
            break;
          case 'comfort:received':
            setShowComfortEffect(true);
            setTimeout(() => setShowComfortEffect(false), 2500);
            break;
        }
      } catch (err) { console.error('WS parse error:', err); }
    };

    ws.onclose = () => { setTimeout(() => connectWS(currentPairId), 3000); };
    ws.onerror = () => { ws.close(); };
  }, [applyPairData]);

  // 初始化：检查认证状态
  useEffect(() => {
    (async () => {
      try {
        const res = await api('/auth');
        setUserId(res.user.id);

        if (res.status === 'paired') {
          setMyRole(res.user.role);
          setPairId(res.user.pairId);
          applyPairData(res.data);
          setAppState('paired');
          connectWS(res.user.pairId);
        } else if (res.status === 'waiting') {
          setMyRole(res.user.role);
          setPairId(res.user.pairId);
          setInviteCode(res.inviteCode);
          setAppState('waiting');
          connectWS(res.user.pairId);
        } else {
          setAppState('unpaired');
          connectWS(null);
        }
      } catch (err) {
        console.error('Init error:', err);
        setAppState('unpaired');
      }
    })();
    return () => { wsRef.current?.close(); };
  }, [applyPairData, connectWS]);

  // 创建配对
  const handleCreatePair = async (role) => {
    try {
      const res = await api('/pair/create', { role });
      setMyRole(role);
      setPairId(res.pairId);
      setInviteCode(res.inviteCode);
      setAppState('waiting');
      // 加入 WS 房间
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'join_room', pairId: res.pairId }));
      }
    } catch (err) { toast(err.message); }
  };

  // 加入配对
  const handleJoinPair = async (code, role) => {
    try {
      const res = await api('/pair/join', { inviteCode: code, role });
      setMyRole(role);
      setPairId(res.pairId);
      applyPairData(res.data);
      setAppState('paired');
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'join_room', pairId: res.pairId }));
      }
      toast('配对成功！🎉');
    } catch (err) { toast(err.message); }
  };

  // 取消配对（从 waiting 回到 unpaired）
  const handleCancelPair = async () => {
    try {
      await api('/pair/cancel');
      setMyRole(null);
      setPairId(null);
      setInviteCode('');
      setAppState('unpaired');
    } catch (err) { toast(err.message); }
  };

  const handleFabClick = () => {
    if (activeTab === 'vouchers') {
      if (myRole === 'boy') { toast('男生没有发券的权力哦 😤'); return; }
      setShowVoucherModal(true);
    }
    else if (activeTab === 'wishlist') setShowWishlistModal(true);
    else if (activeTab === 'calendar') setShowCountdownModal(true);
  };

  // ========== 渲染 ==========
  if (appState === 'loading') {
    return (
      <div style={{ height: '100dvh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.appBg }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: `4px solid ${theme.mainColorLight}`, borderTopColor: theme.mainColor, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>日记本打开中...</span>
        </div>
      </div>
    );
  }

  if (appState === 'unpaired' || appState === 'waiting') {
    return <PairingScreen appState={appState} inviteCode={inviteCode} onCreatePair={handleCreatePair} onJoinPair={handleJoinPair} onCancelPair={handleCancelPair} theme={theme} />;
  }

  return (
    <div style={{ height: '100dvh', width: '100%', display: 'flex', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', overflow: 'hidden', background: theme.appBg }}>
      <div style={{ width: '100%', maxWidth: 448, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.4)', boxShadow: '0 25px 50px rgba(0,0,0,0.1)' }}>

        {showComfortEffect && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {[...Array(12)].map((_, i) => <Heart key={i} style={{ position: 'absolute', left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, color: theme.mainColor, opacity: 0.7, animation: `ping ${0.8 + Math.random()}s ease-out infinite`, transform: `scale(${1 + Math.random() * 1.5})` }} size={28} fill="currentColor" />)}
            <div style={{ background: 'white', padding: '8px 24px', borderRadius: 999, fontWeight: 900, fontSize: 14, color: theme.mainColor, boxShadow: '0 10px 25px rgba(0,0,0,0.1)', border: `2px solid ${theme.mainColorLight}`, animation: 'bounce 1s infinite' }}>Ta 给你发了一个抱抱！🧸💖</div>
          </div>
        )}

        <Toast message={toastMsg} visible={showToast} />

        {/* 角色标签 */}
        <div style={{ background: theme.mainColor, color: 'white', fontSize: 11, padding: '8px 20px', textAlign: 'center', fontWeight: 700, borderRadius: '0 0 16px 16px', margin: '0 32px', letterSpacing: 1 }}>
          {myRole === 'girl' ? '👩 女生视角' : '👦 男生视角'}
        </div>

        <div style={{ padding: '16px 24px 4px', flexShrink: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#334155', margin: 0 }}>
            {activeTab === 'calendar' ? 'AA日记 🌸' : activeTab === 'wishlist' ? '我们的小目标 🎀' : '魔法卡包 ✨'}
          </h1>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, fontWeight: 500 }}>
            {activeTab === 'calendar' ? '每一天都值得被记录 🧸' : activeTab === 'wishlist' ? '把想做的事都变成现实吧' : '专属特权，随时召唤！'}
          </p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 120px' }}>
          {activeTab === 'calendar' && <DashboardView diaryData={diaryData} myRole={myRole} moods={moods} countdowns={countdowns} anniversary={anniversary} theme={theme} onMoodChange={async (mood) => {
            setMoods(prev => ({ ...prev, [myRole]: mood }));
            try { await api('/mood/update', { mood }); } catch(e) { console.error(e); }
          }} onComfort={async () => {
            try { await api('/comfort'); toast('抱抱已发送给Ta 🧸💕'); } catch(e) { console.error(e); }
          }} onSaveDiary={async (date, content) => {
            await api('/diary/save', { date, content });
            setDiaryData(prev => ({ ...prev, [date]: { ...prev[date], [myRole]: { text: content, updatedAt: Date.now() } } }));
          }} />}
          {activeTab === 'wishlist' && <WishlistView wishlist={wishlist} myRole={myRole} theme={theme} onToggle={async (id) => {
            setWishlist(prev => prev.map(w => w.id === id ? { ...w, completed: !w.completed } : w));
            try { await api('/wish/toggle', { wishId: id }); } catch(e) { console.error(e); }
          }} onDelete={async (id) => {
            setWishlist(prev => prev.filter(w => w.id !== id));
            try { await api('/wish/delete', { wishId: id }); } catch(e) { console.error(e); }
          }} />}
          {activeTab === 'vouchers' && <VoucherView vouchers={vouchers} myRole={myRole} theme={theme} onUpdateStatus={async (id, status) => {
            setVouchers(prev => prev.map(v => v.id === id ? { ...v, status } : v));
            try { await api('/voucher/update', { voucherId: id, status }); } catch(e) { console.error(e); }
          }} onRevoke={async (id) => {
            setVouchers(prev => prev.map(v => v.id === id ? { ...v, status: 'revoked' } : v));
            try { await api('/voucher/revoke', { voucherId: id }); toast('免死金牌已撤回 🚫'); } catch(e) { toast(e.message); console.error(e); }
          }} />}
        </div>

        {/* 底部导航 */}
        <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} onFab={handleFabClick} onSettings={() => { setShowAnniversaryModal(true); }} theme={theme} />

        {/* 弹窗 */}
        {showAnniversaryModal && (
          <ModalWrapper onClose={() => setShowAnniversaryModal(false)} title="纪念日设置 🎀" theme={theme}>
            <AnniversaryForm currentDate={anniversary} onSave={async (date) => { await api('/anniversary/update', { date }); setAnniversary(date); setShowAnniversaryModal(false); toast('纪念日已更新 💕'); }} theme={theme} />
          </ModalWrapper>
        )}
        {showCountdownModal && (
          <ModalWrapper onClose={() => setShowCountdownModal(false)} title="添加专属倒数日 ⏰" theme={theme}>
            <CountdownForm onSave={async (title, date) => { const res = await api('/countdown/create', { title, date }); setCountdowns(prev => [...prev, res.countdown].sort((a, b) => new Date(a.date) - new Date(b.date))); setShowCountdownModal(false); toast('倒数日已添加 ⏰'); }} theme={theme} />
          </ModalWrapper>
        )}
        {showWishlistModal && (
          <ModalWrapper onClose={() => setShowWishlistModal(false)} title="许下共同小星愿 🌟" theme={theme}>
            <WishForm onSave={async (content) => { const res = await api('/wish/create', { content }); setWishlist(prev => [res.wish, ...prev]); setShowWishlistModal(false); toast('心愿已许下 🌟'); }} theme={theme} />
          </ModalWrapper>
        )}
        {showVoucherModal && (
          <ModalWrapper onClose={() => setShowVoucherModal(false)} title="颁发免死金牌 🏅" theme={theme}>
            <VoucherForm onSave={async (reason) => { const res = await api('/voucher/create', { reason }); setVouchers(prev => [res.voucher, ...prev]); setShowVoucherModal(false); toast('免死金牌已发放 🏅'); }} theme={theme} />
          </ModalWrapper>
        )}
      </div>
    </div>
  );
}

// ======================== 配对页面 ========================
function PairingScreen({ appState, inviteCode, onCreatePair, onJoinPair, onCancelPair, theme }) {
  const [tab, setTab] = useState('create'); // create | join
  const [selectedRole, setSelectedRole] = useState(null);
  const [inputCode, setInputCode] = useState('');
  const [joinRole, setJoinRole] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    try { await onCancelPair(); }
    catch (e) { /* handled in parent */ }
    setCancelling(false);
  };

  const handleCopy = () => {
    try { navigator.clipboard.writeText(inviteCode); } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreate = async () => {
    if (!selectedRole) return;
    setLoading(true);
    await onCreatePair(selectedRole);
    setLoading(false);
  };

  const handleJoin = async () => {
    if (!inputCode || !joinRole) return;
    setLoading(true);
    try { await onJoinPair(inputCode.trim(), joinRole); }
    catch (e) { /* error handled in parent */ }
    setLoading(false);
  };

  // 已生成配对码，等待对方加入
  if (appState === 'waiting') {
    return (
      <div style={{ height: '100dvh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.appBg, padding: 16 }}>
        <div style={{ width: '100%', maxWidth: 400, background: 'white', borderRadius: 40, boxShadow: '0 20px 60px rgba(0,0,0,0.1)', padding: 32, textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, background: theme.mainColorSoft, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '3px solid white' }}>
            <Clock size={30} color={theme.mainColor} strokeWidth={2.5} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#334155', margin: '0 0 8px' }}>等待 Ta 加入</h2>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>把下面的配对码发给 Ta<br />Ta 输入后即可完成绑定</p>

          <div style={{ background: theme.mainColorSoft, borderRadius: 24, padding: 24, marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 12 }}>你的专属配对码</span>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#334155', letterSpacing: 8, fontFamily: 'monospace' }}>{inviteCode}</div>
          </div>

          <button onClick={handleCopy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, margin: '0 auto', padding: '10px 24px', borderRadius: 999, border: `2px solid ${theme.mainColorLight}`, background: 'white', color: theme.mainColor, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {copied ? <><Check size={16} /> 已复制</> : <><Copy size={16} /> 复制配对码</>}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24, fontSize: 11, color: '#94a3b8' }}>
            <div style={{ width: 6, height: 6, background: '#fbbf24', borderRadius: '50%', animation: 'pulse 2s infinite' }} />
            <span>正在等待 Ta 输入配对码...</span>
          </div>

          <button onClick={handleCancel} disabled={cancelling} style={{ marginTop: 20, padding: '10px 28px', borderRadius: 999, border: '2px solid #e2e8f0', background: 'white', color: '#94a3b8', fontWeight: 700, fontSize: 13, cursor: cancelling ? 'not-allowed' : 'pointer', opacity: cancelling ? 0.5 : 1, transition: 'all 0.2s' }}>
            {cancelling ? '取消中...' : '← 返回重新选择'}
          </button>
        </div>
      </div>
    );
  }

  // 未配对：选择创建还是加入
  return (
    <div style={{ height: '100dvh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.appBg, padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'white', borderRadius: 40, boxShadow: '0 20px 60px rgba(0,0,0,0.1)', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>💕</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: '#334155', margin: '0 0 8px' }}>AA日记</h2>
        <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>专属于你们两个人的私密空间</p>

        {/* Tab 切换 */}
        <div style={{ display: 'flex', background: '#f8fafc', borderRadius: 16, padding: 4, marginBottom: 24 }}>
          <button onClick={() => setTab('create')} style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, background: tab === 'create' ? 'white' : 'transparent', color: tab === 'create' ? '#334155' : '#94a3b8', boxShadow: tab === 'create' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none' }}>
            我来发起 ✨
          </button>
          <button onClick={() => setTab('join')} style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, background: tab === 'join' ? 'white' : 'transparent', color: tab === 'join' ? '#334155' : '#94a3b8', boxShadow: tab === 'join' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none' }}>
            输入配对码 🔗
          </button>
        </div>

        {tab === 'create' ? (
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 12 }}>选择你的身份</span>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
              <button onClick={() => setSelectedRole('girl')} style={{ flex: 1, padding: '20px 0', borderRadius: 20, border: selectedRole === 'girl' ? '3px solid #f472b6' : '3px solid #f1f5f9', background: selectedRole === 'girl' ? '#fff1f2' : 'white', cursor: 'pointer', transition: 'all 0.2s' }}>
                <div style={{ fontSize: 32, marginBottom: 4 }}>👩</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: selectedRole === 'girl' ? '#f472b6' : '#94a3b8' }}>女生</div>
              </button>
              <button onClick={() => setSelectedRole('boy')} style={{ flex: 1, padding: '20px 0', borderRadius: 20, border: selectedRole === 'boy' ? '3px solid #60a5fa' : '3px solid #f1f5f9', background: selectedRole === 'boy' ? '#eff6ff' : 'white', cursor: 'pointer', transition: 'all 0.2s' }}>
                <div style={{ fontSize: 32, marginBottom: 4 }}>👦</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: selectedRole === 'boy' ? '#60a5fa' : '#94a3b8' }}>男生</div>
              </button>
            </div>
            <button onClick={handleCreate} disabled={!selectedRole || loading} style={{ width: '100%', padding: '16px 0', borderRadius: 16, border: 'none', cursor: selectedRole && !loading ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 900, color: selectedRole ? 'white' : '#d1d5db', background: selectedRole ? `linear-gradient(135deg, ${theme.fabFrom}, ${theme.fabTo})` : '#f3f4f6', boxShadow: selectedRole ? '0 8px 20px rgba(0,0,0,0.12)' : 'none' }}>
              {loading ? '生成中...' : '生成配对码'}
            </button>
          </div>
        ) : (
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 12 }}>输入 Ta 给你的配对码</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={inputCode}
              onChange={e => setInputCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6位数字配对码"
              style={{ width: '100%', textAlign: 'center', fontSize: 28, fontWeight: 900, letterSpacing: 8, padding: '16px 0', borderRadius: 20, border: '3px solid #f1f5f9', outline: 'none', fontFamily: 'monospace', color: '#334155', background: '#f8fafc', boxSizing: 'border-box' }}
            />

            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', margin: '20px 0 12px' }}>选择你的身份</span>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
              <button onClick={() => setJoinRole('girl')} style={{ flex: 1, padding: '16px 0', borderRadius: 16, border: joinRole === 'girl' ? '3px solid #f472b6' : '3px solid #f1f5f9', background: joinRole === 'girl' ? '#fff1f2' : 'white', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: joinRole === 'girl' ? '#f472b6' : '#94a3b8' }}>
                👩 女生
              </button>
              <button onClick={() => setJoinRole('boy')} style={{ flex: 1, padding: '16px 0', borderRadius: 16, border: joinRole === 'boy' ? '3px solid #60a5fa' : '3px solid #f1f5f9', background: joinRole === 'boy' ? '#eff6ff' : 'white', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: joinRole === 'boy' ? '#60a5fa' : '#94a3b8' }}>
                👦 男生
              </button>
            </div>
            <button onClick={handleJoin} disabled={inputCode.length !== 6 || !joinRole || loading} style={{ width: '100%', padding: '16px 0', borderRadius: 16, border: 'none', cursor: inputCode.length === 6 && joinRole && !loading ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 900, color: inputCode.length === 6 && joinRole ? 'white' : '#d1d5db', background: inputCode.length === 6 && joinRole ? `linear-gradient(135deg, ${theme.fabFrom}, ${theme.fabTo})` : '#f3f4f6', boxShadow: inputCode.length === 6 && joinRole ? '0 8px 20px rgba(0,0,0,0.12)' : 'none' }}>
              {loading ? '配对中...' : '确认配对 🌸'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ======================== 底部导航 ========================
function BottomNav({ activeTab, setActiveTab, onFab, onSettings, theme }) {
  const items = [
    { key: 'calendar', icon: CalendarIcon, label: '首页' },
    { key: 'wishlist', icon: ListTodo, label: '心愿' },
    { key: 'fab', label: '+' },
    { key: 'vouchers', icon: Ticket, label: '卡包' },
    { key: 'settings', icon: Settings2, label: '设置' },
  ];

  return (
    <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', width: '88%', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', border: `2px solid ${theme.mainColorLight}`, borderRadius: 28, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', zIndex: 30, display: 'flex', alignItems: 'flex-end', padding: '10px 0' }}>
      {items.map(item => {
        if (item.key === 'fab') {
          return (
            <div key="fab" style={{ flex: 1, display: 'flex', justifyContent: 'center', marginTop: -32 }}>
              <button onClick={onFab} style={{ width: 56, height: 56, borderRadius: '50%', border: '4px solid white', cursor: 'pointer', background: `linear-gradient(135deg, ${theme.fabFrom}, ${theme.fabTo})`, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 20px rgba(0,0,0,0.15)' }}>
                <Plus size={26} strokeWidth={3} />
              </button>
            </div>
          );
        }
        const isActive = item.key === activeTab;
        const Icon = item.icon;
        return (
          <div key={item.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }} onClick={() => item.key === 'settings' ? onSettings() : setActiveTab(item.key)}>
            <Icon size={21} strokeWidth={isActive ? 2.5 : 2} color={isActive ? theme.mainColor : '#94a3b8'} />
            <span style={{ fontSize: 9, marginTop: 3, fontWeight: 800, color: isActive ? theme.mainColor : '#94a3b8' }}>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ======================== 通用组件 ========================
function ModalWrapper({ children, title, onClose, theme }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div style={{ background: 'white', borderRadius: '40px 40px 0 0', padding: '16px 24px 24px', position: 'relative', zIndex: 10, maxHeight: '90%', display: 'flex', flexDirection: 'column', boxShadow: '0 -10px 40px rgba(0,0,0,0.1)' }}>
        <div style={{ width: 48, height: 6, background: '#e5e7eb', borderRadius: 999, margin: '0 auto 20px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: '#334155' }}>{title}</span>
          <button onClick={onClose} style={{ padding: 6, background: '#f9fafb', borderRadius: '50%', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={20} strokeWidth={3} /></button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 16 }}>{children}</div>
      </div>
    </div>
  );
}

function Toast({ message, visible }) {
  if (!visible) return null;
  return <div style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(30,41,59,0.9)', color: 'white', fontSize: 12, fontWeight: 700, padding: '10px 20px', borderRadius: 999, boxShadow: '0 8px 20px rgba(0,0,0,0.15)', whiteSpace: 'nowrap' }}>{message}</div>;
}

function ActionButton({ onClick, disabled, text, theme }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: '100%', padding: '16px 0', borderRadius: 16, fontWeight: 900, fontSize: 14, color: disabled ? '#d1d5db' : 'white', background: disabled ? '#f3f4f6' : `linear-gradient(135deg, ${theme.fabFrom}, ${theme.fabTo})`, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', boxShadow: disabled ? 'none' : '0 8px 20px rgba(0,0,0,0.12)' }}>
      {text}
    </button>
  );
}

// ======================== 表单组件 ========================
function AnniversaryForm({ currentDate, onSave, theme }) {
  const [date, setDate] = useState(currentDate || '');
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 8 }}>那是我们故事开始的哪一天？</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%', padding: '12px 16px', borderRadius: 16, border: `2px solid ${theme.mainColorLight}`, fontSize: 16, fontWeight: 700, color: '#334155', outline: 'none', background: theme.mainColorSoft, boxSizing: 'border-box', marginBottom: 16 }} />
      <ActionButton onClick={() => onSave(date)} disabled={!date} text="保存设置" theme={theme} />
    </div>
  );
}

function CountdownForm({ onSave, theme }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  return (
    <div>
      <input type="text" placeholder="比如：一起去看海 🎂" value={title} onChange={e => setTitle(e.target.value)} maxLength={20} style={{ width: '100%', padding: '12px 16px', borderRadius: 16, border: `2px solid ${theme.mainColorLight}`, fontSize: 16, fontWeight: 700, color: '#334155', outline: 'none', background: theme.mainColorSoft, boxSizing: 'border-box', marginBottom: 12 }} />
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%', padding: '12px 16px', borderRadius: 16, border: `2px solid ${theme.mainColorLight}`, fontSize: 16, fontWeight: 700, color: '#334155', outline: 'none', background: theme.mainColorSoft, boxSizing: 'border-box', marginBottom: 16 }} />
      <ActionButton onClick={() => onSave(title, date)} disabled={!title || !date} text="添加倒数日" theme={theme} />
    </div>
  );
}

function WishForm({ onSave, theme }) {
  const [text, setText] = useState('');
  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value)} maxLength={50} placeholder="例如：一起去吃新开的那家甜品店 🍰..." style={{ width: '100%', height: 128, padding: 16, borderRadius: 16, border: `2px solid ${theme.mainColorLight}`, fontSize: 16, fontWeight: 500, color: '#334155', outline: 'none', resize: 'none', background: theme.mainColorSoft, boxSizing: 'border-box', marginBottom: 16 }} />
      <ActionButton onClick={() => onSave(text)} disabled={!text.trim()} text="放进心愿罐" theme={theme} />
    </div>
  );
}

function VoucherForm({ onSave, theme }) {
  const [text, setText] = useState('');
  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value)} maxLength={100} placeholder="例如：今天乖乖听话了，奖励一张免死金牌！🧸" style={{ width: '100%', height: 128, padding: 16, borderRadius: 16, border: `2px solid ${theme.mainColorLight}`, fontSize: 16, fontWeight: 500, color: '#334155', outline: 'none', resize: 'none', background: theme.mainColorSoft, boxSizing: 'border-box', marginBottom: 16 }} />
      <ActionButton onClick={() => onSave(text)} disabled={!text.trim()} text="啾咪~ 发送奖励" theme={theme} />
    </div>
  );
}

// ======================== 首页仪表盘 ========================
function DashboardView({ diaryData, myRole, moods, countdowns, anniversary, theme, onMoodChange, onComfort, onSaveDiary }) {
  const [isMoodOpen, setIsMoodOpen] = useState(false);
  const partnerRole = myRole === 'girl' ? 'boy' : 'girl';
  const myMood = moods[myRole] || 'happy';
  const partnerMood = moods[partnerRole] || 'happy';
  const partnerNeedsComfort = ['emo', 'angry'].includes(partnerMood);

  // 计算倒数日：如果日期已过，自动算到下一年的这个日子
  const calcCountdownDays = (dateStr) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T00:00:00');
    const thisYear = new Date(today.getFullYear(), target.getMonth(), target.getDate());
    thisYear.setHours(0, 0, 0, 0);
    const diffThis = Math.ceil((thisYear - today) / 864e5);
    if (diffThis >= 0) return diffThis;
    const nextYear = new Date(today.getFullYear() + 1, target.getMonth(), target.getDate());
    nextYear.setHours(0, 0, 0, 0);
    return Math.ceil((nextYear - today) / 864e5);
  };

  const calcAnnivDays = () => {
    if (!anniversary) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(anniversary + 'T00:00:00');
    start.setHours(0, 0, 0, 0);
    return Math.floor((today - start) / 864e5);
  };

  const handleMoodChange = (mood) => {
    setIsMoodOpen(false);
    onMoodChange(mood);
  };

  const handleComfort = () => {
    onComfort();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
      {/* 状态卡片 - 紧凑版 */}
      <div style={{ background: 'white', borderRadius: 24, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '3px solid white', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', gap: 12, zIndex: 10 }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div onClick={() => setIsMoodOpen(!isMoodOpen)} style={{ width: 44, height: 44, background: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer', border: `3px solid ${theme.mainColorLight}`, boxShadow: '0 2px 6px rgba(0,0,0,0.06)', zIndex: 20 }}>
              {MOOD_OPTIONS.find(m => m.value === myMood)?.emoji}
            </div>
            <span style={{ fontSize: 9, marginTop: 4, fontWeight: 700, color: theme.mainColor, background: theme.mainColorSoft, padding: '1px 6px', borderRadius: 4 }}>我</span>
            {isMoodOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setIsMoodOpen(false)} />
                <div style={{ position: 'absolute', top: 50, left: -8, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderRadius: 999, padding: '6px 10px', display: 'flex', gap: 10, zIndex: 30, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', border: `2px solid ${theme.mainColorLight}` }}>
                  {MOOD_OPTIONS.map(m => <button key={m.value} onClick={() => handleMoodChange(m.value)} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{m.emoji}</button>)}
                </div>
              </>
            )}
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 44, height: 44, background: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, border: partnerNeedsComfort ? '3px solid #c7d2fe' : '3px solid #f1f5f9', animation: partnerNeedsComfort ? 'pulse 2s infinite' : undefined, cursor: 'pointer' }} onClick={handleComfort}>
              {MOOD_OPTIONS.find(m => m.value === partnerMood)?.emoji}
            </div>
            <span style={{ fontSize: 9, color: '#94a3b8', marginTop: 4, fontWeight: 700, background: '#f8fafc', padding: '1px 6px', borderRadius: 4 }}>Ta</span>
            <button onClick={handleComfort} style={{ position: 'absolute', top: -3, right: -6, background: partnerNeedsComfort ? '#ef4444' : theme.mainColor, color: 'white', padding: 4, borderRadius: '50%', border: 'none', cursor: 'pointer', boxShadow: '0 3px 8px rgba(0,0,0,0.15)', zIndex: 20, animation: partnerNeedsComfort ? 'pulse 1.5s infinite' : undefined }}>
              <HeartHandshake size={12} />
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'right', background: 'rgba(255,255,255,0.8)', padding: '6px 10px', borderRadius: 12, border: `1px solid ${theme.mainColorLight}` }}>
          <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 1 }}>在一起已经</span>
          <div><span style={{ fontSize: 22, fontWeight: 900, color: theme.mainColor }}>{calcAnnivDays()}</span> <span style={{ fontSize: 9, color: theme.mainColorMuted }}>天</span></div>
        </div>
      </div>

      {/* 倒数日 - 紧凑横向滚动 */}
      {countdowns.length > 0 && (
        <div>
          <h3 style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', marginBottom: 8, marginLeft: 8, display: 'flex', alignItems: 'center' }}><Clock size={12} style={{ marginRight: 4, color: theme.mainColor }} /> 倒数日</h3>
          <div style={{ display: 'flex', overflowX: 'auto', gap: 8, paddingBottom: 4, scrollbarWidth: 'none' }}>
            {countdowns.map(cd => {
              const dl = calcCountdownDays(cd.date);
              const isToday = dl === 0;
              return (
                <div key={cd.id} style={{ flexShrink: 0, width: 120, padding: '10px 12px', borderRadius: 16, border: `2px solid ${isToday ? '#fbbf24' : theme.mainColorLight}`, background: isToday ? '#fffbeb' : 'white' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{cd.title}</div>
                  <div><span style={{ fontSize: 20, fontWeight: 900, color: isToday ? '#f59e0b' : theme.mainColor }}>{isToday ? '🎉' : dl}</span>{!isToday && <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', marginLeft: 2 }}>天后</span>}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CalendarWidget diaryData={diaryData} myRole={myRole} theme={theme} onSaveDiary={onSaveDiary} />
    </div>
  );
}

// ======================== 日历 ========================
function CalendarWidget({ diaryData, myRole, theme, onSaveDiary }) {
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDate = now.getDate();
  
  const [viewYear, setViewYear] = useState(todayYear);
  const [viewMonth, setViewMonth] = useState(todayMonth);
  const [selectedDate, setSelectedDate] = useState(null);
  const [inputText, setInputText] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const monthStr = (viewMonth + 1).toString().padStart(2, '0');
  const days = Array.from({ length: daysInMonth }, (_, i) => `${viewYear}-${monthStr}-${(i + 1).toString().padStart(2, '0')}`);
  const todayStr = `${todayYear}-${(todayMonth + 1).toString().padStart(2, '0')}-${todayDate.toString().padStart(2, '0')}`;
  const isCurrentMonth = viewYear === todayYear && viewMonth === todayMonth;

  const goPrev = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const goNext = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  const handleDayClick = (ds) => { setSelectedDate(ds); setInputText(diaryData[ds]?.[myRole]?.text || ''); setIsModalOpen(true); };

  const saveDiary = async () => {
    if (!inputText.trim() || !selectedDate) return;
    setSaving(true);
    try {
      await onSaveDiary(selectedDate, inputText);
      setIsModalOpen(false);
    }
    catch (e) { console.error(e); }
    setSaving(false);
  };

  const partnerRole = myRole === 'girl' ? 'boy' : 'girl';

  return (
    <>
      <div style={{ background: 'white', borderRadius: 24, border: '3px solid white', padding: '14px 16px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <button onClick={goPrev} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', background: theme.mainColorSoft, color: theme.mainColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft size={18} strokeWidth={3} /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: '#334155' }}>{viewYear}年{monthStr}月</span>
            {!isCurrentMonth && <button onClick={() => { setViewYear(todayYear); setViewMonth(todayMonth); }} style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: 'none', cursor: 'pointer', color: theme.mainColor, background: theme.mainColorSoft }}>回今天</button>}
          </div>
          <button onClick={goNext} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', background: theme.mainColorSoft, color: theme.mainColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight size={18} strokeWidth={3} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '14px 6px', textAlign: 'center' }}>
          {['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} style={{ fontSize: 10, fontWeight: 900, color: '#cbd5e1' }}>{d}</div>)}
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {days.map((ds, idx) => {
            const gW = !!diaryData[ds]?.girl; const bW = !!diaryData[ds]?.boy; const neither = !gW && !bW; const isToday = ds === todayStr;
            return (
              <div key={ds} onClick={() => handleDayClick(ds)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ position: 'relative', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {neither && <div style={{ position: 'absolute', inset: 4, borderRadius: 12, border: `2.5px solid ${isToday ? theme.mainColorLight : '#f8fafc'}` }} />}
                  {!neither && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {gW && <Heart style={{ position: 'absolute', color: '#f472b6', clipPath: 'inset(0 50% 0 0)', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.1))' }} size={32} fill="currentColor" strokeWidth={1} stroke="white" />}
                      {bW && <Heart style={{ position: 'absolute', color: '#60a5fa', clipPath: 'inset(0 0 0 50%)', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.1))' }} size={32} fill="currentColor" strokeWidth={1} stroke="white" />}
                    </div>
                  )}
                  <span style={{ position: 'relative', zIndex: 10, fontSize: 11, fontWeight: 900, color: !neither ? 'white' : isToday ? theme.mainColor : '#94a3b8', textShadow: !neither ? '0 1px 2px rgba(0,0,0,0.2)' : 'none' }}>{idx + 1}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isModalOpen && selectedDate && (
        <ModalWrapper onClose={() => setIsModalOpen(false)} title={`${selectedDate.slice(-5)} 小记忆 📝`} theme={theme}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', background: '#f8fafc', padding: '2px 8px', borderRadius: 6, marginBottom: 8, display: 'inline-block' }}>Ta的秘密角落</span>
              <div style={{ position: 'relative', width: '90%' }}>
                {diaryData[selectedDate]?.[partnerRole] ? (
                  <>
                    <div style={{ background: '#f8fafc', padding: 16, borderRadius: 24, fontSize: 14, fontWeight: 500, color: '#475569', border: '2px solid #f1f5f9', filter: !diaryData[selectedDate]?.[myRole] ? 'blur(6px)' : 'none', userSelect: !diaryData[selectedDate]?.[myRole] ? 'none' : 'auto' }}>
                      {diaryData[selectedDate][partnerRole].text}
                    </div>
                    {!diaryData[selectedDate]?.[myRole] && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{ background: 'rgba(255,255,255,0.95)', fontSize: 12, fontWeight: 900, padding: '8px 20px', borderRadius: 999, color: theme.mainColor, border: `2px solid ${theme.mainColorLight}`, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>留下你的记忆才能解锁哦 ✨</div>
                      </div>
                    )}
                  </>
                ) : <div style={{ background: '#f8fafc', padding: 16, borderRadius: 24, fontSize: 12, color: '#94a3b8', border: '2px dashed #f1f5f9' }}>Ta 还在偷懒，没有写日记哦 💤</div>}
              </div>
            </div>
            <div>
              <div style={{ textAlign: 'right', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: theme.mainColor, background: theme.mainColorSoft, padding: '2px 8px', borderRadius: 6 }}>我的碎碎念</span>
              </div>
              <textarea style={{ width: '100%', height: 128, borderRadius: 24, padding: 16, fontSize: 16, fontWeight: 500, color: '#334155', resize: 'none', outline: 'none', border: `2px solid ${theme.mainColorLight}`, background: theme.mainColorSoft, boxSizing: 'border-box' }} placeholder="今天有什么开心的事情呀？🌸" value={inputText} onChange={e => setInputText(e.target.value)} maxLength={500} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button onClick={saveDiary} disabled={!inputText.trim() || saving} style={{ padding: '8px 24px', borderRadius: 999, fontSize: 12, fontWeight: 900, color: inputText.trim() ? 'white' : '#d1d5db', background: inputText.trim() ? theme.mainColor : '#f3f4f6', border: 'none', cursor: inputText.trim() ? 'pointer' : 'not-allowed', boxShadow: inputText.trim() ? '0 4px 12px rgba(0,0,0,0.12)' : 'none' }}>
                  {saving ? '保存中...' : '存起来 💌'}
                </button>
              </div>
            </div>
          </div>
        </ModalWrapper>
      )}
    </>
  );
}

// ======================== 心愿单 ========================
function WishlistView({ wishlist, myRole, theme, onToggle, onDelete }) {
  const pending = wishlist.filter(w => !w.completed);
  const completed = wishlist.filter(w => w.completed);

  const toggle = (id) => onToggle(id);
  const del = (id) => onDelete(id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
      {wishlist.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 80, fontSize: 12, fontWeight: 700, background: 'white', padding: 48, borderRadius: 32, border: `4px dashed ${theme.mainColorLight}` }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: theme.mainColorSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}><Heart size={28} color={theme.mainColor} /></div>
          心愿罐空空如也 🌬️
        </div>
      ) : (
        <>
          {pending.map(item => (
            <div key={item.id} onClick={() => toggle(item.id)} style={{ background: 'white', padding: 16, borderRadius: 24, border: '3px solid white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: `2px solid ${theme.mainColorMuted}`, marginRight: 12, background: theme.mainColorSoft }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#334155', display: 'block' }}>{item.text}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: item.creator === 'girl' ? '#f472b6' : '#60a5fa', marginTop: 2, display: 'inline-block' }}>{item.creator === 'girl' ? '👩 她的心愿' : '👦 他的心愿'}</span>
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); del(item.id); }} style={{ width: 32, height: 32, borderRadius: '50%', background: '#f8fafc', color: '#cbd5e1', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={14} /></button>
            </div>
          ))}
          {completed.length > 0 && (
            <div style={{ paddingTop: 24 }}>
              <h4 style={{ fontSize: 11, fontWeight: 900, color: '#94a3b8', marginBottom: 16, marginLeft: 8, display: 'flex', alignItems: 'center' }}><CheckCircle2 size={14} style={{ marginRight: 4, color: '#34d399' }} /> 已达成 ({completed.length})</h4>
              {completed.map(item => (
                <div key={item.id} onClick={() => toggle(item.id)} style={{ background: 'rgba(248,250,252,0.5)', padding: 16, borderRadius: 24, border: '2px solid #f1f5f9', display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 12, opacity: 0.7 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#d1fae5', color: '#34d399', marginRight: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><CheckCircle2 size={16} strokeWidth={3} /></div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#94a3b8', textDecoration: 'line-through', display: 'block' }}>{item.text}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: item.creator === 'girl' ? '#f9a8d4' : '#93c5fd' }}>{item.creator === 'girl' ? '👩 她的心愿' : '👦 他的心愿'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ======================== 卡包 ========================
function VoucherView({ vouchers, myRole, theme, onUpdateStatus, onRevoke }) {
  const [sub, setSub] = useState('available');
  const filtered = vouchers.filter(v => {
    if (sub === 'available') return v.status !== 'used' && v.status !== 'revoked';
    if (sub === 'used') return v.status === 'used';
    if (sub === 'revoked') return v.status === 'revoked';
    return false;
  });

  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ display: 'flex', padding: 4, background: 'white', borderRadius: 16, marginBottom: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <button onClick={() => setSub('available')} style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 900, borderRadius: 12, border: 'none', cursor: 'pointer', color: sub === 'available' ? theme.mainColor : '#94a3b8', background: sub === 'available' ? theme.mainColorSoft : 'transparent' }}>魔法卡包 ✨</button>
        <button onClick={() => setSub('used')} style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 900, borderRadius: 12, border: 'none', cursor: 'pointer', color: sub === 'used' ? '#475569' : '#94a3b8', background: sub === 'used' ? '#f1f5f9' : 'transparent' }}>回忆票根 🎫</button>
        <button onClick={() => setSub('revoked')} style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 900, borderRadius: 12, border: 'none', cursor: 'pointer', color: sub === 'revoked' ? '#ef4444' : '#94a3b8', background: sub === 'revoked' ? '#fef2f2' : 'transparent' }}>已撤回 🚫</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 64, fontSize: 12, fontWeight: 700, background: 'white', padding: 48, borderRadius: 32, border: `4px dashed ${theme.mainColorLight}` }}>
            <div style={{ fontSize: 30, marginBottom: 12 }}>{sub === 'revoked' ? '🎉' : '🪹'}</div>
            {sub === 'available' ? '还没有可用的免死金牌哦 🧸' : sub === 'used' ? '还没有核销过的卡券' : '没有被撤回的卡券，真棒！'}
          </div>
        ) : filtered.map(v => <VoucherCard key={v.id} voucher={v} myRole={myRole} theme={theme} onUpdateStatus={onUpdateStatus} onRevoke={onRevoke} />)}
      </div>
    </div>
  );
}

function VoucherCard({ voucher, myRole, theme, onUpdateStatus, onRevoke }) {
  const [flipped, setFlipped] = useState(false);
  const [stamping, setStamping] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const isSender = voucher.senderRole === myRole;

  const handleApply = (e) => { e.stopPropagation(); onUpdateStatus(voucher.id, 'pending'); };
  const handleStamp = (e) => {
    e.stopPropagation(); setStamping(true);
    onUpdateStatus(voucher.id, 'used');
    setTimeout(() => setStamping(false), 800);
  };
  const handleRevoke = (e) => {
    e.stopPropagation();
    setShowRevokeConfirm(true);
  };
  const confirmRevoke = (e) => {
    e.stopPropagation();
    onRevoke(voucher.id);
    setShowRevokeConfirm(false);
  };
  const cancelRevoke = (e) => {
    e.stopPropagation();
    setShowRevokeConfirm(false);
  };

  const backActions = () => {
    // 已撤回状态
    if (voucher.status === 'revoked') return (
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 900, color: '#ef4444', background: '#fef2f2', padding: '6px 16px', borderRadius: 999, border: '2px solid #fecaca' }}>已撤回 · 作废</span>
      </div>
    );
    if (voucher.status === 'used') return <div style={{ marginTop: 16, textAlign: 'center' }}><span style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', background: '#f1f5f9', padding: '6px 16px', borderRadius: 999, border: '2px solid #e2e8f0' }}>已免责 · 已使用</span></div>;
    if (isSender) {
      if (voucher.status === 'pending') return (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: '#fffbeb', padding: '4px 12px', borderRadius: 999, marginBottom: 8 }}>Ta 请求放过 👇</span>
          <button onClick={handleStamp} style={{ width: 48, height: 48, background: 'white', borderRadius: '50%', border: `3px solid ${theme.mainColor}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.mainColor, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', opacity: stamping ? 0 : 1, transform: stamping ? 'scale(1.5)' : 'scale(1)', transition: 'all 0.3s' }}><Stamp size={24} strokeWidth={2.5} /></button>
        </div>
      );
      // available 状态 - 发放者可以撤回
      return (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 10, color: '#94a3b8', background: '#f8fafc', padding: 8, borderRadius: 12, border: '2px dashed #f1f5f9', width: '100%', textAlign: 'center' }}>等待Ta使用... 🤫</div>
          {showRevokeConfirm ? (
            <div style={{ background: '#fef2f2', borderRadius: 16, padding: 12, width: '100%', border: '2px solid #fecaca' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textAlign: 'center', marginBottom: 8 }}>确定要撤回这张券吗？🤔</div>
              <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', marginBottom: 10 }}>撤回后对方将无法使用</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={cancelRevoke} style={{ flex: 1, padding: '8px 0', borderRadius: 12, border: '2px solid #e2e8f0', background: 'white', color: '#64748b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>再想想</button>
                <button onClick={confirmRevoke} style={{ flex: 1, padding: '8px 0', borderRadius: 12, border: 'none', background: '#ef4444', color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>确认撤回</button>
              </div>
            </div>
          ) : (
            <button onClick={handleRevoke} style={{ width: '100%', padding: '8px 0', borderRadius: 12, border: '2px solid #fecaca', background: '#fff5f5', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <X size={14} strokeWidth={2.5} /> 撤回这张券
            </button>
          )}
        </div>
      );
    } else {
      if (voucher.status === 'pending') return <div style={{ marginTop: 16, textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#f59e0b', background: '#fffbeb', padding: 10, borderRadius: 12, border: '2px solid #fef3c7' }}>已申请保命，等待审批中... 🥺</div>;
      return <div style={{ marginTop: 16 }}><button onClick={handleApply} style={{ width: '100%', color: 'white', fontSize: 12, fontWeight: 900, padding: '12px 0', borderRadius: 16, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${theme.fabFrom}, ${theme.fabTo})`, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>惹生气了？点击保命！🏃</button></div>;
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: 200, cursor: 'pointer', perspective: 1000 }} onClick={() => setFlipped(!flipped)}>
      <div style={{ width: '100%', minHeight: 200, transition: 'transform 0.7s ease-out', transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0)' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 32, background: 'white', backfaceVisibility: 'hidden', display: 'flex', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 32, margin: 8, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: `3px dashed ${theme.mainColorMuted}`, background: `linear-gradient(135deg, ${theme.mainColorSoft}, white)`, padding: '24px 16px' }}>
            <h3 style={{ fontSize: 28, fontWeight: 900, letterSpacing: 4, color: theme.mainColor }}>免死金牌</h3>
            <div style={{ width: 64, height: 6, borderRadius: 999, marginTop: 8, background: theme.mainColorMuted }} />
            <p style={{ fontSize: 10, fontWeight: 700, marginTop: 12, color: theme.mainColor, background: 'white', padding: '4px 12px', borderRadius: 999 }}>✨ 戳我翻面看秘密 ✨</p>
          </div>
          {voucher.status === 'pending' && !flipped && <div style={{ position: 'absolute', top: -8, right: -8, background: '#fbbf24', color: 'white', fontSize: 10, fontWeight: 900, padding: '6px 12px', borderRadius: 999, border: '2px solid white', transform: 'rotate(12deg)', animation: 'pulse 2s infinite' }}>求放过 🥺</div>}
          {voucher.status === 'revoked' && !flipped && <div style={{ position: 'absolute', top: -8, right: -8, background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 900, padding: '6px 12px', borderRadius: 999, border: '2px solid white', transform: 'rotate(12deg)' }}>已撤回 🚫</div>}
        </div>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 32, background: 'white', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', border: `4px solid ${voucher.status === 'used' || voucher.status === 'revoked' ? '#f1f5f9' : theme.mainColorLight}`, padding: 20, display: 'flex', flexDirection: 'column', opacity: voucher.status === 'used' || voucher.status === 'revoked' ? 0.9 : 1, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <h4 style={{ fontSize: 11, fontWeight: 900, color: '#94a3b8', borderBottom: '2px dashed #f1f5f9', paddingBottom: 8 }}>给全世界最好的你 🧸</h4>
            <div style={{ flex: 1, marginTop: 12, borderRadius: 16, padding: 16, overflowY: 'auto', fontSize: 14, fontWeight: 700, color: '#475569', lineHeight: 1.6, background: theme.mainColorSoft, border: `1px solid ${theme.mainColorLight}` }}>"{voucher.reason}"</div>
            {backActions()}
          </div>
          {(voucher.status === 'used' || stamping) && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%) rotate(20deg)', width: 96, height: 96, borderRadius: '50%', border: `4px solid ${theme.mainColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 20, color: theme.mainColor, background: 'rgba(255,255,255,0.9)', zIndex: 20, opacity: stamping ? 0 : 1, transition: 'all 0.5s' }}>已核销</div>
          )}
          {voucher.status === 'revoked' && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%) rotate(-15deg)', width: 96, height: 96, borderRadius: '50%', border: '4px solid #ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 20, color: '#ef4444', background: 'rgba(255,255,255,0.9)', zIndex: 20 }}>已撤回</div>
          )}
        </div>
      </div>
    </div>
  );
}
