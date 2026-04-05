# AA日记腾讯云部署清单

这份清单按“能直接执行”的顺序整理，目标环境是腾讯云 Linux 云服务器。

## 1. 服务器准备

- 准备一台腾讯云 CVM，推荐 Ubuntu 22.04 LTS
- 开放安全组端口：`22`、`80`、`443`
- 如果 MySQL 不和应用同机，还要放通 MySQL 端口 `3306`，并限制来源 IP
- 准备一个域名，提前把域名 A 记录解析到服务器公网 IP

## 2. 安装基础环境

```bash
sudo apt update
sudo apt install -y git curl nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 3. 安装 MySQL

如果数据库和应用部署在同一台机器：

```bash
sudo apt install -y mysql-server
sudo systemctl enable mysql
sudo systemctl start mysql
sudo systemctl status mysql
```

初始化数据库账号：

```bash
sudo mysql
```

在 MySQL 里执行：

```sql
CREATE DATABASE aa_diary CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'aa_diary'@'127.0.0.1' IDENTIFIED BY '请替换成强密码';
GRANT ALL PRIVILEGES ON aa_diary.* TO 'aa_diary'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

## 4. 拉取项目

```bash
cd /var/www
sudo mkdir -p /var/www/riji
sudo chown -R $USER:$USER /var/www/riji
git clone https://github.com/AndreaYang89/riji /var/www/riji
cd /var/www/riji
```

## 5. 安装依赖

```bash
npm install
cd app
npm install
cd ..
```

## 6. 配置后端环境变量

推荐用 `systemd` 注入环境变量，不把密码写死进代码。

先准备这些值：

- `DB_HOST=127.0.0.1`
- `DB_PORT=3306`
- `DB_USER=aa_diary`
- `DB_PASS=你的数据库密码`
- `DB_NAME=aa_diary`
- `JWT_SECRET=一段长度足够的随机密钥`
- `PORT=3001`

## 7. 初始化数据库表

```bash
DB_HOST=127.0.0.1 \
DB_PORT=3306 \
DB_USER=aa_diary \
DB_PASS='你的数据库密码' \
DB_NAME=aa_diary \
npm run db:init
```

执行成功后应看到：

```bash
✅ 数据库 [aa_diary] 初始化完成，共 7 张表
```

## 8. 构建前端

当前前端默认写死了本地地址：

- [App.tsx](/Users/andrea/Documents/riji/app/src/App.tsx) 里的 `API_BASE`
- [App.tsx](/Users/andrea/Documents/riji/app/src/App.tsx) 里的 `WS_URL`

正式部署前请改成你的线上域名，例如：

```ts
const API_BASE = 'https://你的域名/api';
const WS_URL = 'wss://你的域名';
```

然后构建：

```bash
cd /var/www/riji/app
npm run build
```

## 9. 用 systemd 启动后端

创建服务文件：

```bash
sudo nano /etc/systemd/system/riji.service
```

写入：

```ini
[Unit]
Description=AA Diary Backend
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=/var/www/riji
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=PORT=3001
Environment=DB_HOST=127.0.0.1
Environment=DB_PORT=3306
Environment=DB_USER=aa_diary
Environment=DB_PASS=你的数据库密码
Environment=DB_NAME=aa_diary
Environment=JWT_SECRET=你的强随机密钥

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable riji
sudo systemctl start riji
sudo systemctl status riji
```

查看日志：

```bash
sudo journalctl -u riji -f
```

## 10. 配置 Nginx

创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/riji
```

写入：

```nginx
server {
    listen 80;
    server_name 你的域名;

    root /var/www/riji/app/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/riji /etc/nginx/sites-enabled/riji
sudo nginx -t
sudo systemctl reload nginx
```

## 11. 配置 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

完成后，把前端地址确认成：

```ts
const API_BASE = 'https://你的域名/api';
const WS_URL = 'wss://你的域名/ws';
```

注意：如果使用上面这个 `/ws` 反代路径，前端也要同步改成 `/ws`，否则 WebSocket 会连不到。

## 12. 上线前检查

- `npm run build` 成功
- `systemctl status riji` 正常
- `curl http://127.0.0.1:3001/api/auth` 返回 401，而不是 500
- 浏览器可以打开首页
- 新用户能注册
- 创建配对码和输入配对码都成功
- 配对后能进入主页，不白屏
- 倒数日、心愿、日记、卡券接口正常

## 13. 本项目当前特别注意

- 前端接口地址目前是硬编码，不改线上域名会直接请求本机 `localhost`
- WebSocket 线上建议统一走 `wss://你的域名/ws`
- 如果数据库密码为空，只适合本地测试，不要用于云服务器
- `JWT_SECRET` 一定要改，不能用默认值

## 14. 以后更新代码的发布步骤

```bash
cd /var/www/riji
git pull origin main
npm install
cd app && npm install && npm run build && cd ..
sudo systemctl restart riji
sudo systemctl reload nginx
```

