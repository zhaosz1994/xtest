# AI安全访问控制 - Linux服务器增量部署指南

## 📋 部署概述

本文档指导你如何在Linux服务器上增量部署AI安全访问控制功能，包括：
- AI只读数据库用户
- 审计日志系统
- API Key加密
- AI操作日志可视化

## 🚀 快速部署

### 方式一：自动部署脚本（推荐）

#### 1. 上传文件到服务器

```bash
# 在本地机器上执行
scp -r routes/aiOperationLogs.js user@server:/path/to/xtest/routes/
scp -r services/sqlSecurityValidator.js user@server:/path/to/xtest/services/
scp -r services/dataIsolationMiddleware.js user@server:/path/to/xtest/services/
scp -r services/aiAuditLogger.js user@server:/path/to/xtest/services/
scp -r services/apiKeyEncryption.js user@server:/path/to/xtest/services/
scp -r services/connectionPoolMonitor.js user@server:/path/to/xtest/services/
scp -r db-ai-readonly.js user@server:/path/to/xtest/
scp -r public/ai-operation-logs.html user@server:/path/to/xtest/public/
scp -r scripts/deploy-ai-security-db.sh user@server:/path/to/xtest/scripts/
scp -r scripts/manage-ai-logs-aging.js user@server:/path/to/xtest/scripts/
scp -r scripts/ai-logs-aging-policy.sql user@server:/path/to/xtest/scripts/
```

#### 2. 在服务器上执行部署脚本

```bash
# SSH登录到服务器
ssh user@server

# 进入项目目录
cd /path/to/xtest

# 设置数据库密码环境变量
export DB_PASSWORD='your_mysql_root_password'
export DB_NAME='xtest'  # 如果数据库名不是xtest，请修改

# 给脚本执行权限
chmod +x scripts/deploy-ai-security-db.sh

# 执行部署脚本
./scripts/deploy-ai-security-db.sh
```

### 方式二：手动部署

#### 1. 数据库操作

```bash
# 登录MySQL
mysql -u root -p

# 执行以下SQL
```

```sql
-- 1. 创建AI只读用户
CREATE USER IF NOT EXISTS 'ai_readonly'@'%' IDENTIFIED BY 'AI_Readonly_2026_Secure!';
REVOKE ALL PRIVILEGES ON *.* FROM 'ai_readonly'@'%';
GRANT SELECT ON xtest.* TO 'ai_readonly'@'%';
FLUSH PRIVILEGES;

-- 2. 创建审计日志表
CREATE TABLE IF NOT EXISTS ai_operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
  user_id INT NOT NULL COMMENT '用户ID',
  username VARCHAR(100) COMMENT '用户名',
  skill_name VARCHAR(100) NOT NULL COMMENT '技能名称',
  skill_id INT COMMENT '技能ID',
  operation_type VARCHAR(20) NOT NULL COMMENT '操作类型（SELECT）',
  sql_query TEXT COMMENT '执行的SQL语句',
  sql_params TEXT COMMENT 'SQL参数（JSON格式）',
  tables_accessed VARCHAR(500) COMMENT '访问的表（逗号分隔）',
  result_count INT DEFAULT 0 COMMENT '返回结果数量',
  execution_time_ms INT COMMENT '执行耗时（毫秒）',
  status VARCHAR(20) NOT NULL DEFAULT 'success' COMMENT '执行状态（success/failed）',
  error_message TEXT COMMENT '错误信息',
  ip_address VARCHAR(50) COMMENT 'IP地址',
  user_agent VARCHAR(500) COMMENT '用户代理',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  
  INDEX idx_user_id (user_id),
  INDEX idx_skill_name (skill_name),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_operation_type (operation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI操作审计日志表';

-- 3. 配置日志自动清理（保留90天）
SET GLOBAL event_scheduler = ON;
DROP EVENT IF EXISTS clean_old_ai_operation_logs;
CREATE EVENT clean_old_ai_operation_logs
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
DO
  DELETE FROM ai_operation_logs 
  WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- 4. 验证
SHOW GRANTS FOR 'ai_readonly'@'%';
SHOW TABLES LIKE 'ai_operation_logs';
SHOW EVENTS LIKE 'clean_old_ai_operation_logs';
```

#### 2. 配置环境变量

编辑 `.env` 文件：

```bash
nano .env
```

添加以下配置：

```env
# AI只读数据库用户配置
AI_DB_USER=ai_readonly
AI_DB_PASSWORD=AI_Readonly_2026_Secure!

# API Key加密密钥（运行下面的命令生成）
API_KEY_ENCRYPTION_KEY=<生成的密钥>
```

生成加密密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 3. 安装依赖

```bash
npm install node-sql-parser --save
```

#### 4. 重启应用

```bash
# 如果使用PM2
pm2 restart ecosystem.config.js

# 或者直接重启
npm run prod
```

## 📁 需要部署的文件清单

### 新增文件

```
routes/
  └── aiOperationLogs.js          # AI操作日志API

services/
  ├── sqlSecurityValidator.js     # SQL安全验证
  ├── dataIsolationMiddleware.js  # 数据隔离中间件
  ├── aiAuditLogger.js            # 审计日志服务
  ├── apiKeyEncryption.js         # API Key加密
  └── connectionPoolMonitor.js    # 连接池监控

public/
  └── ai-operation-logs.html      # AI操作日志可视化页面

scripts/
  ├── deploy-ai-security-db.sh    # 数据库部署脚本
  ├── manage-ai-logs-aging.js     # 日志老化管理工具
  └── ai-logs-aging-policy.sql    # 日志老化策略SQL

db-ai-readonly.js                 # AI只读连接池
```

### 修改文件

```
server.js                         # 注册新路由
index.html                        # 添加查看日志按钮
routes/aiSkills.js                # 重构使用安全架构
```

## ✅ 验证部署

### 1. 检查数据库

```bash
mysql -u root -p

# 检查AI只读用户
SELECT User, Host FROM mysql.user WHERE User = 'ai_readonly';
SHOW GRANTS FOR 'ai_readonly'@'%';

# 检查审计日志表
USE xtest;
SHOW TABLES LIKE 'ai_operation_logs';
SELECT COUNT(*) FROM ai_operation_logs;

# 检查事件调度器
SHOW EVENTS;
```

### 2. 检查应用日志

```bash
# 查看PM2日志
pm2 logs

# 或查看应用日志
tail -f logs/app.log
```

### 3. 测试API接口

```bash
# 获取token（替换为实际的用户名密码）
TOKEN=$(curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}' \
  | jq -r '.token')

# 测试AI操作日志接口
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/ai-operation-logs/overview?days=7

# 测试最近操作接口
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/ai-operation-logs/recent?limit=10
```

### 4. 访问可视化页面

打开浏览器访问：
```
http://your-server:port/ai-operation-logs.html
```

## 🔧 常见问题排查

### 问题1：AI只读用户连接失败

**检查**：
```bash
# 测试AI只读用户连接
mysql -u ai_readonly -p'AI_Readonly_2026_Secure!' -e "SELECT 1"
```

**解决**：
- 检查 `.env` 中的 `AI_DB_USER` 和 `AI_DB_PASSWORD`
- 检查MySQL用户权限
- 检查防火墙设置

### 问题2：审计日志表未创建

**检查**：
```sql
SHOW CREATE TABLE ai_operation_logs;
```

**解决**：
```bash
# 手动执行SQL
mysql -u root -p xtest < scripts/create-ai-operation-logs-table.sql
```

### 问题3：事件调度器未启用

**检查**：
```sql
SHOW VARIABLES LIKE 'event_scheduler';
```

**解决**：
```sql
SET GLOBAL event_scheduler = ON;
```

或在 `my.cnf` 中添加：
```ini
[mysqld]
event_scheduler = ON
```

### 问题4：API接口返回401

**检查**：
- 确认用户已登录
- 检查token是否有效
- 检查请求头是否包含 `Authorization: Bearer <token>`

### 问题5：页面无法访问

**检查**：
```bash
# 检查文件是否存在
ls -la public/ai-operation-logs.html

# 检查文件权限
chmod 644 public/ai-operation-logs.html
```

## 📊 性能优化建议

### 1. 数据库索引优化

```sql
-- 为常用查询添加索引
CREATE INDEX idx_logs_user_status ON ai_operation_logs(user_id, status);
CREATE INDEX idx_logs_skill_status ON ai_operation_logs(skill_name, status);
```

### 2. 连接池调优

编辑 `db-ai-readonly.js`，根据服务器配置调整：

```javascript
{
  connectionLimit: 200,    // 根据并发数调整
  queueLimit: 1000,        // 根据服务器内存调整
  acquireTimeout: 30000,   // 根据网络延迟调整
}
```

### 3. 日志归档策略

对于高频使用的系统，建议定期归档：

```bash
# 使用管理工具
node scripts/manage-ai-logs-aging.js
```

## 🔐 安全建议

### 1. 修改默认密码

```sql
-- 修改AI只读用户密码
ALTER USER 'ai_readonly'@'%' IDENTIFIED BY 'Your_Strong_Password_Here!';
FLUSH PRIVILEGES;
```

然后更新 `.env` 文件中的 `AI_DB_PASSWORD`。

### 2. 限制访问范围

```sql
-- 只允许本地访问
CREATE USER 'ai_readonly'@'localhost' IDENTIFIED BY 'Your_Password';
GRANT SELECT ON xtest.* TO 'ai_readonly'@'localhost';
```

### 3. 定期更换密钥

```bash
# 生成新的加密密钥
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 更新 .env 文件
# 重新加密所有API Key（需要编写脚本）
```

## 📝 维护命令

### 查看日志统计

```sql
-- 总体统计
SELECT 
  COUNT(*) as total_logs,
  MIN(created_at) as oldest_log,
  MAX(created_at) as newest_log
FROM ai_operation_logs;

-- 按月统计
SELECT 
  DATE_FORMAT(created_at, '%Y-%m') as month,
  COUNT(*) as count
FROM ai_operation_logs
GROUP BY DATE_FORMAT(created_at, '%Y-%m')
ORDER BY month DESC;
```

### 手动清理日志

```sql
-- 清理30天前的日志
DELETE FROM ai_operation_logs 
WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 只保留最近10000条
DELETE FROM ai_operation_logs 
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id FROM ai_operation_logs 
    ORDER BY created_at DESC 
    LIMIT 10000
  ) as tmp
);
```

### 备份日志

```bash
# 导出最近30天的日志
mysqldump -u root -p xtest ai_operation_logs \
  --where="created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)" \
  > ai_logs_backup_$(date +%Y%m%d).sql
```

## 🎯 部署检查清单

- [ ] 上传所有新文件到服务器
- [ ] 执行数据库部署脚本
- [ ] 配置 `.env` 环境变量
- [ ] 安装 `node-sql-parser` 依赖
- [ ] 重启应用服务
- [ ] 验证AI只读用户权限
- [ ] 验证审计日志表创建
- [ ] 验证事件调度器启用
- [ ] 测试API接口正常
- [ ] 访问可视化页面正常
- [ ] 检查应用日志无错误

## 📞 技术支持

如遇问题，请检查：
- 应用日志：`pm2 logs` 或 `logs/app.log`
- 数据库日志：MySQL错误日志
- 测试脚本：`node scripts/test-ai-security.js`

部署完成后，你的AI系统将具备完整的安全访问控制机制！🎉
