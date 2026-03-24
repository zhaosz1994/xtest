# XTest 系统跨平台部署指南

本文档详细说明 XTest 系统在不同环境下的部署方式和配置方法。

---

## 目录

1. [环境要求](#环境要求)
2. [本地开发环境](#本地开发环境)
3. [Linux 生产服务器部署](#linux-生产服务器部署)
4. [PM2 进程管理](#pm2-进程管理)
5. [Docker 容器化部署](#docker-容器化部署)
6. [常见问题排查](#常见问题排查)

---

## 环境要求

### 基础环境

| 组件 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | >= 16.x | 推荐 18.x LTS |
| npm | >= 8.x | 随 Node.js 安装 |
| MySQL | >= 5.7 | 推荐 8.x |
| PM2 | >= 5.x | 生产环境必需 |

### 端口要求

| 端口 | 用途 |
|------|------|
| 3000 | HTTP 服务 & WebSocket |

---

## 本地开发环境

### Windows 开发环境

#### 1. 安装依赖

```cmd
npm install
```

#### 2. 配置环境变量

复制并编辑 `.env` 文件：

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=xtest
PORT=3000
```

#### 3. 启动服务

```cmd
# 开发模式（带热重载）
npm run dev

# 生产模式
npm start
```

#### 4. 访问应用

浏览器打开：`http://localhost:3000`

---

### macOS 开发环境

#### 1. 安装依赖

```bash
npm install
```

#### 2. 配置环境变量

确保 `.env` 文件配置正确：

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=xtest
PORT=3000
```

#### 3. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

#### 4. 访问应用

浏览器打开：`http://localhost:3000`

---

### 局域网访问测试

如需从其他设备访问开发服务器：

#### 1. 获取本机 IP

**Windows:**
```cmd
ipconfig
```

**macOS/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

#### 2. 修改防火墙设置

确保防火墙允许 3000 端口入站连接。

#### 3. 访问测试

其他设备通过浏览器访问：`http://<本机IP>:3000`

> **注意**：由于已使用 `window.location.origin` 动态获取地址，无需修改任何代码即可支持局域网访问。

---

## Linux 生产服务器部署

### 前置准备

#### 1. 安装 Node.js

**Ubuntu/Debian:**
```bash
# 使用 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**CentOS/RHEL:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

#### 2. 安装 MySQL

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install mysql-server
sudo mysql_secure_installation
```

**CentOS/RHEL:**
```bash
sudo yum install mysql-server
sudo systemctl start mysqld
sudo mysql_secure_installation
```

#### 3. 安装 PM2

```bash
sudo npm install -g pm2
```

---

### 部署步骤

#### 1. 上传代码

```bash
# 方式一：Git 克隆
git clone <repository_url> /opt/xtest
cd /opt/xtest

# 方式二：SCP 上传
scp -r ./sdk_xtest user@server:/opt/xtest
```

#### 2. 安装依赖

```bash
cd /opt/xtest
npm install --production
```

#### 3. 配置环境变量

创建 `.env` 文件：

```bash
cat > .env << EOF
NODE_ENV=production
DB_HOST=localhost
DB_USER=xtest_user
DB_PASSWORD=your_secure_password
DB_NAME=xtest
PORT=3000
EOF
```

#### 4. 初始化数据库

```bash
# 登录 MySQL 创建数据库和用户
mysql -u root -p

# 在 MySQL 中执行
CREATE DATABASE xtest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'xtest_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON xtest.* TO 'xtest_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;

# 导入数据库结构（如有）
mysql -u xtest_user -p xtest < database/schema.sql
```

#### 5. 启动服务

```bash
# 使用 PM2 启动
pm2 start ecosystem.config.js --env production

# 保存 PM2 进程列表
pm2 save

# 设置开机自启
pm2 startup
```

#### 6. 验证部署

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs ctcsdk-testplan

# 测试接口
curl http://localhost:3000/api/users/list
```

---

### Nginx 反向代理配置（推荐）

#### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

#### 2. 配置反向代理

创建配置文件 `/etc/nginx/sites-available/xtest`：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 或服务器 IP

    # 客户端请求体大小限制
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # WebSocket 超时设置
        proxy_read_timeout 86400;
    }
}
```

#### 3. 启用配置

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/xtest /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

---

## PM2 进程管理

### 常用命令

```bash
# 启动服务
npm run pm2:start
# 或
pm2 start ecosystem.config.js

# 停止服务
npm run pm2:stop
# 或
pm2 stop ctcsdk-testplan

# 重启服务
npm run pm2:restart
# 或
pm2 restart ctcsdk-testplan

# 优雅重载（零停机）
npm run pm2:reload
# 或
pm2 reload ctcsdk-testplan

# 查看日志
npm run pm2:logs
# 或
pm2 logs ctcsdk-testplan

# 查看实时日志
pm2 logs ctcsdk-testplan --lines 100

# 清空日志
pm2 flush

# 监控面板
pm2 monit

# 查看进程详情
pm2 show ctcsdk-testplan

# 删除进程
npm run pm2:delete
# 或
pm2 delete ctcsdk-testplan
```

### PM2 配置说明

`ecosystem.config.js` 关键配置项：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `name` | ctcsdk-testplan | 进程名称 |
| `script` | server.js | 入口文件 |
| `instances` | 1 | 实例数量 |
| `exec_mode` | fork | 执行模式 |
| `autorestart` | true | 自动重启 |
| `max_memory_restart` | 500M | 内存超限重启 |
| `kill_timeout` | 5000 | 优雅关闭超时 |

### 开机自启

```bash
# 生成启动脚本命令
pm2 startup

# 执行输出的命令（需要 sudo）
# 例如：sudo env PATH=$PATH:... pm2 startup systemd -u username --hp /home/username

# 保存当前进程列表
pm2 save
```

---

## Docker 容器化部署

### Dockerfile

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

### docker-compose.yml

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  app:
    build: .
    container_name: xtest-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DB_HOST=db
      - DB_USER=xtest_user
      - DB_PASSWORD=xtest_password
      - DB_NAME=xtest
      - PORT=3000
    depends_on:
      - db
    networks:
      - xtest-network

  db:
    image: mysql:8.0
    container_name: xtest-mysql
    restart: unless-stopped
    environment:
      - MYSQL_ROOT_PASSWORD=root_password
      - MYSQL_DATABASE=xtest
      - MYSQL_USER=xtest_user
      - MYSQL_PASSWORD=xtest_password
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - xtest-network

volumes:
  mysql-data:

networks:
  xtest-network:
    driver: bridge
```

### Docker 部署命令

```bash
# 构建镜像
docker build -t xtest:latest .

# 使用 docker-compose 启动
docker-compose up -d

# 查看日志
docker-compose logs -f app

# 停止服务
docker-compose down

# 停止并删除数据卷
docker-compose down -v
```

---

## 常见问题排查

### 1. 端口被占用

```bash
# 查看端口占用
# Linux/macOS
lsof -i :3000

# Windows
netstat -ano | findstr :3000

# 结束占用进程
kill -9 <PID>  # Linux/macOS
taskkill /PID <PID> /F  # Windows
```

### 2. 数据库连接失败

检查项：
- MySQL 服务是否启动
- `.env` 配置是否正确
- 数据库用户权限是否正确
- 防火墙是否允许连接

```bash
# 测试数据库连接
mysql -h localhost -u xtest_user -p xtest
```

### 3. WebSocket 连接失败

检查项：
- Nginx 是否正确配置 WebSocket 代理
- 防火墙是否允许 WebSocket 连接
- 浏览器控制台是否有错误信息

### 4. PM2 进程频繁重启

```bash
# 查看错误日志
pm2 logs ctcsdk-testplan --err

# 查看进程详情
pm2 show ctcsdk-testplan

# 检查内存使用
pm2 monit
```

### 5. 换行符问题

如果在 macOS/Linux 下遇到脚本执行错误：

```bash
# 安装 dos2unix
# Ubuntu/Debian
sudo apt install dos2unix

# macOS
brew install dos2unix

# 转换文件
dos2unix *.js

# 或使用 Git 重新规范化
git add --renormalize .
git commit -m "统一换行符"
```

### 6. 局域网无法访问

检查项：
- 服务器防火墙是否开放端口
- 云服务器安全组是否放行端口
- 应用是否绑定到 0.0.0.0（默认配置已支持）

```bash
# 开放防火墙端口
# Ubuntu/Debian (ufw)
sudo ufw allow 3000

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

---

## 环境变量速查表

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `NODE_ENV` | 否 | development | 运行环境 |
| `PORT` | 否 | 3000 | 服务端口 |
| `DB_HOST` | 是 | - | 数据库主机 |
| `DB_USER` | 是 | - | 数据库用户 |
| `DB_PASSWORD` | 是 | - | 数据库密码 |
| `DB_NAME` | 是 | - | 数据库名称 |

---

## 快速命令参考

```bash
# 开发环境
npm run dev                    # 启动开发服务器

# 生产环境
npm run prod                   # 启动生产服务器

# PM2 管理
npm run pm2:start              # 启动 PM2
npm run pm2:stop               # 停止 PM2
npm run pm2:restart            # 重启 PM2
npm run pm2:logs               # 查看日志
npm run pm2:delete             # 删除进程

# Docker
docker-compose up -d           # 启动容器
docker-compose down            # 停止容器
docker-compose logs -f         # 查看日志
```

---

## 联系与支持

如遇到问题，请检查：
1. 服务日志：`./logs/error.log` 和 `./logs/out.log`
2. PM2 日志：`pm2 logs`
3. 系统日志：`/var/log/syslog` 或 `/var/log/messages`
