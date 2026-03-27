# AA日记 - 部署指南

## 架构概览

```
┌─────────────┐     REST API      ┌──────────────────┐     ┌─────────┐
│  前端 React  │ ◄──────────────► │  Node.js Express  │ ◄──►│  MySQL  │
│  (aa-diary-  │     WebSocket    │  (server.js)      │     │         │
│   app.jsx)   │ ◄──────────────► │  端口 3001        │     │ 端口3306│
└─────────────┘                   └──────────────────┘     └─────────┘
```

## 数据流

1. **配对流程**: A选角色→生成6位码→B输入码+选角色→配对完成→双方自动同步
2. **实时同步**: 任一方操作 → REST API写入MySQL → WebSocket广播给对方 → 对方UI即时更新
3. **身份识别**: 每个设备首次访问生成唯一 `deviceToken`，存在 localStorage，作为身份标识

## 快速启动

### 1. 准备 MySQL

确保 MySQL 已安装并运行，默认连接配置：
- Host: localhost
- Port: 3306
- User: root
- Password: (空)

可通过环境变量覆盖：
```bash
export DB_HOST=localhost
export DB_PORT=3306
export DB_USER=root
export DB_PASS=your_password
export DB_NAME=aa_diary
```

### 2. 启动后端

```bash
cd aa-diary-backend

# 安装依赖
npm install

# 初始化数据库（建库建表）
npm run db:init

# 启动服务
npm run dev
```

看到以下输出表示成功：
```
🌸 AA日记后端已启动
─────────────────────────
REST API:    http://localhost:3001/api
WebSocket:   ws://localhost:3001
```

### 3. 前端配置

在 `aa-diary-app.jsx` 顶部修改后端地址：
```javascript
const API_BASE = 'http://localhost:3001/api';  // REST API 地址
const WS_URL = 'ws://localhost:3001';          // WebSocket 地址
```

将前端部署到你的 React 项目中即可。

## API 接口文档

### 认证
| 接口 | 说明 | 参数 |
|------|------|------|
| POST /api/auth | 登录/注册 | deviceToken |

### 配对
| 接口 | 说明 | 参数 |
|------|------|------|
| POST /api/pair/create | 创建配对 | deviceToken, role |
| POST /api/pair/join | 加入配对 | deviceToken, inviteCode, role |

### 数据操作
| 接口 | 说明 | 参数 |
|------|------|------|
| POST /api/diary/save | 保存日记 | deviceToken, date, content |
| POST /api/voucher/create | 创建卡券 | deviceToken, reason |
| POST /api/voucher/update | 更新卡券状态 | deviceToken, voucherId, status |
| POST /api/wish/create | 创建心愿 | deviceToken, content |
| POST /api/wish/toggle | 切换心愿完成 | deviceToken, wishId |
| POST /api/wish/delete | 删除心愿 | deviceToken, wishId |
| POST /api/countdown/create | 创建倒数日 | deviceToken, title, date |
| POST /api/mood/update | 更新心情 | deviceToken, mood |
| POST /api/anniversary/update | 更新纪念日 | deviceToken, date |
| POST /api/comfort | 发送安慰 | deviceToken |

### WebSocket 事件

**客户端 → 服务器**
| 消息类型 | 说明 |
|---------|------|
| { type: 'auth', deviceToken } | 认证并加入房间 |
| { type: 'join_room', pairId } | 加入配对房间 |

**服务器 → 客户端**
| 事件 | 说明 | 触发时机 |
|------|------|---------|
| pair:completed | 配对完成 | 对方输入配对码成功 |
| diary:updated | 日记更新 | 任一方保存日记 |
| voucher:created | 新卡券 | 任一方创建卡券 |
| voucher:updated | 卡券状态变更 | 使用/审批卡券 |
| wish:created | 新心愿 | 任一方添加心愿 |
| wish:toggled | 心愿完成状态切换 | 任一方标记心愿 |
| wish:deleted | 心愿删除 | 任一方删除心愿 |
| countdown:created | 新倒数日 | 任一方添加 |
| mood:updated | 心情变化 | 任一方切换心情 |
| anniversary:updated | 纪念日变更 | 任一方修改设置 |
| comfort:received | 收到安慰 | 对方发送抱抱 |

## 数据库表结构

- **users** - 用户表（device_token 标识设备）
- **pairs** - 配对关系（invite_code + 双方用户ID）
- **diaries** - 日记（每对每人每天一条）
- **vouchers** - 免死金牌（available → pending → used）
- **wishes** - 心愿单
- **countdowns** - 倒数日

## 生产部署注意

1. **HTTPS**: 上线后需配置 SSL，WebSocket 改为 `wss://`
2. **认证安全**: 当前用 deviceToken 做简单身份识别，生产环境建议加 JWT
3. **数据库**: 生产环境建议设置连接池大小、读写分离
4. **配对码过期**: 建议给 waiting 状态的配对加 24h 过期清理
5. **心跳**: WebSocket 已内置 30s 心跳检测，断线自动重连（前端3s重连）
