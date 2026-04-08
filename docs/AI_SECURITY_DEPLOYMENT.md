# AI安全访问控制部署指南

## 📋 概述

本系统实现了完整的AI安全访问控制机制，确保AI技能只能执行只读操作，防止数据泄露和误删除。

## 🚀 快速部署

### 步骤1：创建AI只读数据库用户

```bash
# 方式1：使用自动化脚本（推荐）
node scripts/create-ai-readonly-user.js

# 方式2：手动执行SQL
mysql -u root -p < scripts/create-ai-readonly-user.sql
```

### 步骤2：配置环境变量

在 `.env` 文件中添加以下配置：

```env
# AI只读数据库用户配置
AI_DB_USER=ai_readonly
AI_DB_PASSWORD=AI_Readonly_2026_Secure!

# API Key加密密钥（请生成一个强密钥）
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key-here
```

生成加密密钥：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 步骤3：创建审计日志表

```bash
mysql -u root -p your_database < scripts/create-ai-operation-logs-table.sql
```

### 步骤4：运行测试验证

```bash
node scripts/test-ai-security.js
```

### 步骤5：配置日志老化策略（可选）

```bash
# 使用交互式管理工具
node scripts/manage-ai-logs-aging.js

# 或手动执行SQL配置
mysql -u root -p your_database < scripts/ai-logs-aging-policy.sql
```

**默认策略**：保留最近90天的日志，每天自动清理一次。

### 步骤6：重启应用

```bash
npm run dev
# 或
pm2 restart ecosystem.config.js
```

## 🔒 安全机制说明

### 1. 数据库权限隔离

- **AI只读用户**：只有SELECT权限，无法执行DELETE、UPDATE、INSERT操作
- **连接池隔离**：AI技能使用独立的只读连接池
- **表级白名单**：只允许访问指定的业务表

### 2. SQL安全验证

- **操作类型验证**：只允许SELECT查询
- **表访问控制**：禁止访问敏感表（users、ai_models等）
- **SQL注入防护**：检测UNION注入、OR注入等攻击

### 3. 数据隔离

- **行级权限**：自动注入WHERE条件，限制数据访问范围
- **项目隔离**：用户只能访问自己有权限的项目数据
- **管理员特权**：管理员可以访问所有数据

### 4. 审计日志

- **完整记录**：记录所有AI操作的SQL、参数、结果
- **性能监控**：记录执行时间、结果数量
- **错误追踪**：记录失败操作的详细信息

### 5. API Key加密

- **AES-256加密**：使用强加密算法保护API Key
- **透明加解密**：应用层自动处理加解密
- **密钥管理**：支持环境变量配置密钥

## 📊 监控和运维

### 查看AI操作日志

```sql
-- 查看最近的AI操作
SELECT * FROM ai_operation_logs ORDER BY created_at DESC LIMIT 100;

-- 查看失败的AI操作
SELECT * FROM ai_operation_logs WHERE status = 'failed' ORDER BY created_at DESC;

-- 统计AI技能使用频率
SELECT skill_name, COUNT(*) as usage_count 
FROM ai_operation_logs 
GROUP BY skill_name 
ORDER BY usage_count DESC;

-- 统计用户AI使用情况
SELECT user_id, username, COUNT(*) as usage_count 
FROM ai_operation_logs 
GROUP BY user_id, username 
ORDER BY usage_count DESC;
```

### 日志老化管理

#### 默认老化策略

系统默认配置了自动老化机制：
- **保留时间**：最近90天的日志
- **清理频率**：每天自动执行一次
- **清理方式**：MySQL事件调度器自动删除

#### 自定义老化策略

使用交互式管理工具：

```bash
node scripts/manage-ai-logs-aging.js
```

该工具提供以下功能：
1. 查看当前日志统计和分布
2. 配置不同的保留时间（30/60/90/180/365天）
3. 分级老化（失败日志保留更久）
4. 手动清理指定时间的日志
5. 归档旧日志到归档表
6. 禁用/启用自动清理

#### 可选的老化策略

**策略1：短期保留（30天）**
- 适合高频使用场景
- 减少数据库存储压力

**策略2：中期保留（90天，默认）**
- 平衡存储和审计需求
- 满足大多数合规要求

**策略3：长期保留（180-365天）**
- 满足严格审计要求
- 需要更多存储空间

**策略4：分级老化**
- 成功日志保留90天
- 失败日志保留180天
- 重点关注异常操作

#### 日志归档

对于需要长期保存的日志，可以归档到专门的归档表：

```sql
-- 创建归档表
CREATE TABLE ai_operation_logs_archive (...);

-- 归档90天前的日志
INSERT INTO ai_operation_logs_archive
SELECT *, NOW() as archived_at
FROM ai_operation_logs
WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- 删除已归档的日志
DELETE FROM ai_operation_logs
WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
```

#### 手动管理日志

```sql
-- 查看日志统计
SELECT 
  COUNT(*) as total_logs,
  MIN(created_at) as oldest_log,
  MAX(created_at) as newest_log
FROM ai_operation_logs;

-- 手动清理30天前的日志
DELETE FROM ai_operation_logs 
WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 只保留最近10000条日志
DELETE FROM ai_operation_logs 
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id FROM ai_operation_logs 
    ORDER BY created_at DESC 
    LIMIT 10000
  ) as recent_logs
);
```

#### 检查事件调度器状态

```sql
-- 查看事件调度器是否启用
SHOW VARIABLES LIKE 'event_scheduler';

-- 启用事件调度器
SET GLOBAL event_scheduler = ON;

-- 查看所有事件
SHOW EVENTS;

-- 查看清理事件详情
SHOW CREATE EVENT clean_old_ai_operation_logs;
```

### 连接池监控

连接池状态会自动记录到日志中，包括：
- 活跃连接数
- 等待连接数
- 总连接数

当连接池压力过大时会自动告警。

### 性能优化建议

1. **连接池配置**：根据并发用户数调整连接池大小
2. **查询优化**：为常用查询字段添加索引
3. **缓存策略**：对频繁查询的数据实现缓存
4. **慢查询监控**：定期检查慢查询日志

## 🛠️ 故障排查

### 问题1：AI只读用户连接失败

**症状**：应用启动时报错 "Access denied for user 'ai_readonly'"

**解决方案**：
1. 检查 `.env` 文件中的 `AI_DB_USER` 和 `AI_DB_PASSWORD` 配置
2. 验证数据库用户是否创建成功：
   ```sql
   SELECT User, Host FROM mysql.user WHERE User = 'ai_readonly';
   ```
3. 检查用户权限：
   ```sql
   SHOW GRANTS FOR 'ai_readonly'@'%';
   ```

### 问题2：SQL验证失败

**症状**：AI技能执行时报错 "SQL验证失败"

**解决方案**：
1. 检查SQL语句是否为SELECT查询
2. 确认访问的表在白名单中
3. 查看详细错误信息：
   ```bash
   tail -f logs/app.log | grep "SQL验证失败"
   ```

### 问题3：审计日志未记录

**症状**：`ai_operation_logs` 表中没有数据

**解决方案**：
1. 确认审计日志表已创建
2. 检查数据库连接是否正常
3. 查看应用日志是否有错误信息

### 问题4：API Key解密失败

**症状**：报错 "API_key解密失败"

**解决方案**：
1. 确认 `.env` 中的 `API_KEY_ENCRYPTION_KEY` 配置正确
2. 如果更换了密钥，需要重新加密所有API Key
3. 检查数据库中的API Key格式是否正确

## 🔐 安全最佳实践

### 1. 定期更换密码

```bash
# 每3个月更换AI只读用户密码
node scripts/create-ai-readonly-user.js
# 输入新密码后更新 .env 文件
```

### 2. 监控异常操作

```sql
-- 查看异常的AI操作（执行时间过长）
SELECT * FROM ai_operation_logs 
WHERE execution_time_ms > 5000 
ORDER BY created_at DESC;

-- 查看频繁失败的用户
SELECT user_id, username, COUNT(*) as fail_count 
FROM ai_operation_logs 
WHERE status = 'failed' 
GROUP BY user_id, username 
HAVING fail_count > 10;
```

### 3. 数据备份

建议每天备份一次数据库，特别是 `ai_operation_logs` 表。

### 4. 权限审计

定期检查AI只读用户的权限，确保没有被意外修改：

```sql
SHOW GRANTS FOR 'ai_readonly'@'%';
```

## 📈 性能调优

### 连接池参数调优

根据实际负载调整 `db-ai-readonly.js` 中的参数：

```javascript
{
  connectionLimit: 200,    // 最大连接数
  queueLimit: 1000,        // 等待队列大小
  acquireTimeout: 30000,   // 获取连接超时时间
}
```

### 查询性能优化

1. 为常用查询字段添加索引
2. 使用数据库视图预过滤数据
3. 实现查询结果缓存

## 📞 技术支持

如有问题，请查看：
- 应用日志：`logs/app.log`
- 数据库日志：MySQL错误日志
- 测试脚本：`node scripts/test-ai-security.js`

## 🎯 总结

通过以上部署和配置，您的AI系统已具备：

✅ **数据库权限隔离**：AI无法执行删除操作  
✅ **SQL安全验证**：防止SQL注入和非法操作  
✅ **数据隔离**：用户只能访问自己的数据  
✅ **完整审计**：所有操作可追溯  
✅ **API Key加密**：敏感信息安全存储  
✅ **性能监控**：实时监控连接池状态  

系统已支持100+并发用户，每个用户都有独立的API_key和数据隔离。
