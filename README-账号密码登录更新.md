# AA日记 - 账号密码登录更新说明

## 主要变更

### 1. 数据库结构变更 (db-init.js)

**users 表更新：**
- 移除了 `device_token` 字段
- 新增了 `username` (VARCHAR 32) 字段 - 登录账号
- 新增了 `password_hash` (VARCHAR 255) 字段 - 密码哈希
- 新增了 `nickname` (VARCHAR 32) 字段 - 用户昵称

### 2. 后端 API 变更 (server.js)

**新增依赖：**
```bash
npm install bcrypt jsonwebtoken
```

**新增接口：**
- `POST /api/register` - 用户注册
  - 参数: `{ username, password, nickname? }`
  - 返回: `{ success, token, user }`

- `POST /api/login` - 用户登录
  - 参数: `{ username, password }`
  - 返回: `{ success, token, user, status, data? }`

**修改接口：**
- `POST /api/auth` - 改为使用 JWT Token 验证
  - 参数: `{ token }`
  - 返回: `{ status, user, data? }`

- 所有其他接口都从 `deviceToken` 改为使用 `token` 进行认证

**WebSocket 认证：**
- 连接时发送: `{ type: 'auth', token }`

### 3. 前端界面变更 (aa-diary-app.jsx)

**新增界面：**
- `LoginScreen` - 登录页面
  - 用户名/密码输入
  - 错误提示
  - 切换到注册页面

- `RegisterScreen` - 注册页面
  - 用户名/密码/确认密码/昵称输入
  - 表单验证
  - 切换到登录页面

**修改功能：**
- 移除了设备 token 机制
- 使用 localStorage 存储 JWT token (`aa_auth_token`)
- 添加了退出登录功能
- 配对页面显示用户昵称

## 部署步骤

### 1. 安装新依赖

```bash
cd riji-new
npm install
```

### 2. 重新初始化数据库

**注意：这会清空现有数据！**

```bash
npm run db:init
```

或者手动执行 SQL 修改现有表：
```sql
-- 备份现有数据
CREATE TABLE users_backup AS SELECT * FROM users;

-- 删除旧表
DROP TABLE countdowns;
DROP TABLE wishes;
DROP TABLE vouchers;
DROP TABLE diaries;
DROP TABLE pairs;
DROP TABLE users;

-- 然后运行新的 db-init.js
node db-init.js
```

### 3. 启动后端服务

```bash
npm start
# 或
node server.js
```

### 4. 运行前端

将 `aa-diary-app.jsx` 放入你的 React 项目中运行。

## 用户流程

1. **首次使用** - 用户需要注册账号
2. **登录** - 使用用户名和密码登录
3. **配对** - 登录后选择角色并创建/加入配对
4. **使用** - 配对成功后可以正常使用日记功能
5. **退出** - 可以在配对页面退出登录

## 安全说明

- 密码使用 bcrypt 进行哈希存储
- 使用 JWT Token 进行身份验证，有效期 30 天
- Token 存储在 localStorage 中
- 生产环境建议修改 `JWT_SECRET` 环境变量

```bash
# 设置环境变量
export JWT_SECRET=your-secret-key-here
```
