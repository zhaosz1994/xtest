# Linux服务器增量部署指南（8000端口）

## 🚀 快速部署（推荐）

### 方式一：使用自动化脚本

```bash
# 1. 设置服务器信息
export SERVER_HOST='your-server-ip'  # 替换为你的服务器IP
export SERVER_USER='root'            # 替换为你的用户名
export PROJECT_PATH='/var/www/xtest' # 替换为你的项目路径

# 2. 执行部署脚本
chmod +x scripts/deploy-to-linux.sh
./scripts/deploy-to-linux.sh
```

### 方式二：手动部署（5步完成）

#### 步骤1：上传文件（3个命令）

```bash
# 1.1 上传新增文件
scp routes/aiOperationLogs.js \
    services/sqlSecurityValidator.js \
    services/dataIsolationMiddleware.js \
    services/aiAuditLogger.js \
    services/apiKeyEncryption.js \
    services/connectionPoolMonitor.js \
    db-ai-readonly.js \
    public/ai-operation-logs.html \
    scripts/deploy-ai-security-db.sh \
    user@server:/var/www/xtest/

# 1.2 上传修改文件
scp server.js index.html routes/aiSkills.js \
    user@server:/var/www/xtest/

# 1.3 上传部署脚本
scp scripts/deploy-ai-security-db.sh \
    user@server:/var/www/xtest/scripts/
```

#### 步骤2：SSH登录服务器

```bash
ssh user@server
cd /var/www/xtest
```

#### 步骤3：安装依赖和配置环境

```bash
# 3.1 安装依赖
npm install node-sql-parser --save

# 3.2 生成加密密钥
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 3.3 更新.env文件
cat >> .env << EOF

# AI只读数据库用户配置
AI_DB_USER=ai_readonly
AI_DB_PASSWORD=AI_Readonly_2026_Secure!

# API Key加密密钥
API_KEY_ENCRYPTION_KEY=$ENCRYPTION_KEY
EOF
```

#### 步骤4：执行数据库部署

```bash
# 4.1 给脚本执行权限
chmod +x scripts/deploy-ai-security-db.sh

# 4.2 执行数据库部署（会自动读取.env）
./scripts/deploy-ai-security-db.sh
```

#### 步骤5：重启服务

```bash
# 如果使用PM2
pm2 restart ecosystem.config.js

# 或者直接重启
pm2 restart all
```

---

## ✅ 验证部署

### 1. 检查服务状态

```bash
pm2 status
pm2 logs --lines 50
```

### 2. 测试API接口

```bash
# 测试服务器是否运行
curl http://localhost:8000/

# 测试AI操作日志接口（需要先登录获取token）
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/ai-operation-logs/overview?days=7
```

### 3. 访问可视化页面

```
http://your-server-ip:8000/ai-operation-logs.html
```

---

## 📋 部署清单

### 新增文件（必须上传）
- ✅ `routes/aiOperationLogs.js`
- ✅ `services/sqlSecurityValidator.js`
- ✅ `services/dataIsolationMiddleware.js`
- ✅ `services/aiAuditLogger.js`
- ✅ `services/apiKeyEncryption.js`
- ✅ `services/connectionPoolMonitor.js`
- ✅ `db-ai-readonly.js`
- ✅ `public/ai-operation-logs.html`
- ✅ `scripts/deploy-ai-security-db.sh`

### 修改文件（必须更新）
- ✅ `server.js`
- ✅ `index.html`
- ✅ `routes/aiSkills.js`

### 数据库变更
- ✅ 创建AI只读用户
- ✅ 创建审计日志表
- ✅ 配置日志自动清理

### 环境配置
- ✅ 安装 `node-sql-parser`
- ✅ 配置 `.env` 文件

---

## 🔧 常见问题

### 问题1：文件上传失败

**解决**：检查权限和路径
```bash
# 检查项目目录权限
ls -la /var/www/xtest

# 如果权限不足
sudo chown -R your-user:your-group /var/www/xtest
```

### 问题2：数据库部署失败

**解决**：手动执行SQL
```bash
mysql -u root -p xtest_db < scripts/create-ai-operation-logs-table.sql
```

### 问题3：服务重启失败

**解决**：检查日志
```bash
pm2 logs
pm2 restart ecosystem.config.js --update-env
```

### 问题4：页面无法访问

**解决**：检查防火墙和端口
```bash
# 检查端口是否开放
netstat -tlnp | grep 8000

# 检查防火墙
sudo ufw status
sudo ufw allow 8000
```

---

## 🎯 一键部署命令（复制粘贴）

```bash
# 设置变量（替换为实际值）
SERVER_HOST='your-server-ip'
SERVER_USER='root'
PROJECT_PATH='/var/www/xtest'

# 上传文件
rsync -avz routes/aiOperationLogs.js services/sqlSecurityValidator.js services/dataIsolationMiddleware.js services/aiAuditLogger.js services/apiKeyEncryption.js services/connectionPoolMonitor.js db-ai-readonly.js public/ai-operation-logs.html scripts/deploy-ai-security-db.sh $SERVER_USER@$SERVER_HOST:$PROJECT_PATH/

rsync -avz server.js index.html routes/aiSkills.js $SERVER_USER@$SERVER_HOST:$PROJECT_PATH/

# SSH执行部署
ssh $SERVER_USER@$SERVER_HOST << 'EOF'
cd /var/www/xtest
npm install node-sql-parser --save
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo -e "\n# AI只读数据库用户配置\nAI_DB_USER=ai_readonly\nAI_DB_PASSWORD=AI_Readonly_2026_Secure!\n\n# API Key加密密钥\nAPI_KEY_ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env
chmod +x scripts/deploy-ai-security-db.sh
./scripts/deploy-ai-security-db.sh
pm2 restart ecosystem.config.js
EOF
```

---

## 📊 部署后检查

```bash
# 1. 检查服务状态
pm2 status

# 2. 检查数据库
mysql -u root -p -e "SHOW TABLES LIKE 'ai_operation_logs';" xtest_db

# 3. 检查AI只读用户
mysql -u root -p -e "SHOW GRANTS FOR 'ai_readonly'@'%';"

# 4. 检查日志
pm2 logs --lines 20

# 5. 访问测试
curl http://localhost:8000/ai-operation-logs.html
```

---

## 🎉 部署完成！

访问地址：
```
http://your-server-ip:8000/ai-operation-logs.html
```

或从主页面进入：
```
http://your-server-ip:8000/ → 配置管理 → AI配置 → 查看AI操作日志
```
