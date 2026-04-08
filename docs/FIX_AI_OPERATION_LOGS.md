# AI操作日志表修复指南

## 问题描述

错误信息：
```
[ERROR] [app] 获取AI操作预览失败 {"error":"unknown column 'total_tokens' in 'field list'"}
```

**原因**: `ai_operation_logs` 表缺少 token 统计相关字段，代码已更新但数据库结构未同步。

## 缺失字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| prompt_tokens | INT | 提示词token数 |
| completion_tokens | INT | 完成token数 |
| total_tokens | INT | 总token数 |
| model_name | VARCHAR(100) | 使用的AI模型名称 |

## 解决方案

### 方式1: 使用Shell脚本（推荐）

在Linux服务器上执行：

```bash
cd /path/to/xtest

# 确保.env文件配置正确
cat .env | grep -E "DB_|DATABASE"

# 执行修复脚本
./scripts/fix-ai-operation-logs.sh
```

**输出示例：**
```
========================================
  修复 AI 操作日志表 - 缺失字段
  时间: 2026-04-08 00:55:00
========================================

=== 1. 检查当前表结构 ===
=== 2. 检查缺失字段 ===
⚠ 缺少字段: prompt_tokens
⚠ 缺少字段: completion_tokens
⚠ 缺少字段: total_tokens
⚠ 缺少字段: model_name

=== 3. 开始修复 ===
添加 prompt_tokens 字段...
  ✓ 成功添加 prompt_tokens
...

========================================
  ✅ 修复完成！
========================================
```

### 方式2: 手动SQL命令

登录MySQL后执行：

```bash
mysql -u your_user -p xtest_db
```

然后执行SQL：

```sql
-- 1. 添加 prompt_tokens 字段
ALTER TABLE ai_operation_logs 
ADD COLUMN IF NOT EXISTS prompt_tokens INT DEFAULT 0 COMMENT '提示词token数' 
AFTER execution_time_ms;

-- 2. 添加 completion_tokens 字段
ALTER TABLE ai_operation_logs 
ADD COLUMN IF NOT EXISTS completion_tokens INT DEFAULT 0 COMMENT '完成token数' 
AFTER prompt_tokens;

-- 3. 添加 total_tokens 字段
ALTER TABLE ai_operation_logs 
ADD COLUMN IF NOT EXISTS total_tokens INT DEFAULT 0 COMMENT '总token数' 
AFTER completion_tokens;

-- 4. 添加 model_name 字段
ALTER TABLE ai_operation_logs 
ADD COLUMN IF NOT EXISTS model_name VARCHAR(100) COMMENT '使用的AI模型名称' 
AFTER total_tokens;

-- 5. 验证
DESCRIBE ai_operation_logs;
```

### 方式3: 使用迁移文件

```bash
# 在项目根目录执行
mysql -u your_user -p xtest_db < migrations/fix-ai-operation-logs-tokens.sql
```

## 验证修复

### 1. 检查表结构

```sql
DESCRIBE ai_operation_logs;
```

应该看到以下字段：

```
+-------------------+--------------+------+-----+-------------------+
| Field             | Type         | Null | Key | Default           |
+-------------------+--------------+------+-----+-------------------+
| ...               | ...          | ...  | ... | ...               |
| execution_time_ms | int          | YES  |     | NULL              |
| prompt_tokens     | int          | NO   |     | 0                 |  ← 新增
| completion_tokens | int          | NO   |     | 0                 |  ← 新增
| total_tokens      | int          | NO   |     | 0                 |  ← 新增
| model_name        | varchar(100) | YES  |     | NULL              |  ← 新增
| status            | varchar(20)  | NO   |     | success           |
| ...               | ...          | ...  | ... | ...               |
+-------------------+--------------+------+-----+-------------------+
```

### 2. 测试API接口

重启应用服务后访问：

```bash
# 测试获取AI操作日志预览
curl http://your-server:3000/api/ai-operation-logs/preview

# 应该返回正常数据，不再报错
```

### 3. 检查应用日志

```bash
# 查看应用日志
tail -f logs/app.log

# 应该不再出现 "unknown column" 错误
```

## 重启服务

修复完成后，重启Node.js应用：

```bash
# 如果使用PM2
pm2 restart all

# 或手动重启
kill $(pgrep -f "node.*server.js")
node server.js &

# 或使用systemctl
sudo systemctl restart xtest
```

## 常见问题

### Q1: 执行时提示 "Duplicate column name"
**原因**: 字段已经存在
**解决**: 脚本使用了 `IF NOT EXISTS`，如果还报错可以忽略或先删除再添加

### Q2: 权限不足
**错误**: `ERROR 1142 (42000): ALTER command denied`
**解决**: 使用有ALTER权限的数据库用户

```sql
GRANT ALTER ON xtest_db.* TO 'your_user'@'%';
FLUSH PRIVILEGES;
```

### Q3: 表不存在
**错误**: `Table 'ai_operation_logs' doesn't exist`
**解决**: 先创建表

```bash
mysql -u root -p xtest_db < scripts/create-ai-operation-logs-table.sql
```

### Q4: 修复后还是报错
**可能原因**:
1. 应用没有重启
2. 连接的是错误的数据库
3. 有多个实例运行

**排查步骤**:
```bash
# 1. 确认连接的数据库
echo "SELECT DATABASE();" | mysql -u user -p

# 2. 确认字段存在
echo "SHOW COLUMNS FROM ai_operation_logs LIKE 'total_tokens';" | mysql -u user -p xtest_db

# 3. 重启所有Node.js进程
pm2 restart all
# 或
pkill -f node && node server.js &
```

## 预防措施

为了避免以后再次遇到类似问题：

### 1. 定期检查数据库迁移
```bash
# 添加到部署脚本中
./scripts/check-database.sh
```

### 2. 版本控制迁移文件
确保所有SQL迁移文件都提交到Git并同步到服务器。

### 3. 自动化部署流程
在部署脚本中加入数据库迁移步骤：

```bash
#!/bin/bash
# deploy.sh 示例

# 更新代码
git pull origin main

# 安装依赖
npm install

# 运行数据库迁移
for migration in migrations/*.sql; do
    echo "Running $migration..."
    mysql -u user -p password db_name < "$migration"
done

# 重启服务
pm2 restart all
```

## 相关文件

- **修复脚本**: [scripts/fix-ai-operation-logs.sh](../scripts/fix-ai-operation-logs.sh)
- **SQL迁移**: [migrations/fix-ai-operation-logs-tokens.sql](../migrations/fix-ai-operation-logs-tokens.sql)
- **原始建表SQL**: [scripts/create-ai-operation-logs-table.sql](../scripts/create-ai-operation-logs-table.sql)
- **审计日志服务**: [services/aiAuditLogger.js](../services/aiAuditLogger.js)

## 技术支持

如遇其他问题，请查看：
- 项目文档: [docs/DATABASE_CHECK_GUIDE.md](../docs/DATABASE_CHECK_GUIDE.md)
- 数据库检查工具: [scripts/check-database.js](../scripts/check-database.js)
