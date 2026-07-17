# 数据库检查工具使用说明

## 概述

本工具用于检查MySQL数据库的完整性和健康状态,包括表结构、索引、外键约束、数据完整性等多个方面。

## 前置要求

1. 已安装 Node.js (v12+)
2. 已安装 MySQL 客户端
3. 已配置 `.env` 文件

## 配置

在项目根目录创建 `.env` 文件:

```bash
cp .env.example .env
```

编辑 `.env` 文件,填写数据库连接信息:

```env
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=xtest_db
# 可选: 使用socket连接
# DB_SOCKET=/path/to/mysql.sock
```

## 使用方法

### 方法1: Node.js 脚本 (推荐)

提供详细的JSON格式报告,包含所有检查项的详细信息。

```bash
# 在项目根目录执行
node scripts/check-database.js
```

**输出:**
- 控制台输出检查进度和结果
- 生成 `database-check-report.json` 详细报告

### 方法2: Shell 脚本

轻量级检查,适合快速检查或在没有Node.js环境的服务器上使用。

```bash
# 添加执行权限
chmod +x scripts/check-database.sh

# 执行检查
./scripts/check-database.sh
```

## 检查项目

### 1. 表存在性检查
- 检查所有预期的表是否存在
- 识别未预期的表

### 2. 表结构检查
- 主键检查
- 时间戳字段检查
- 可空字段检查

### 3. 索引检查
- 关键索引是否存在
- 索引使用情况

### 4. 外键约束检查
- 外键约束数量
- 孤立记录检查

### 5. 数据完整性检查
- 必填字段检查
- 重复数据检查
- 数据一致性检查

### 6. 表统计信息
- 表数量统计
- 空表识别
- 大表识别
- 表碎片检查

### 7. 数据库健康状态
- 连接使用率
- InnoDB状态

### 8. 安全设置检查
- 用户密码检查
- root用户远程访问检查

## 报告说明

### JSON报告格式

```json
{
  "timestamp": "2026-04-08T10:00:00.000Z",
  "database": "xtest_db",
  "checks": [
    {
      "category": "表存在性",
      "name": "users",
      "status": "pass",
      "message": "表存在",
      "details": null,
      "timestamp": "2026-04-08T10:00:01.000Z"
    }
  ],
  "summary": {
    "total_checks": 100,
    "passed": 95,
    "warnings": 3,
    "errors": 2
  }
}
```

### 状态说明

- **pass**: 检查通过 ✓
- **warning**: 警告 ⚠ (建议处理但不影响运行)
- **error**: 错误 ✗ (需要立即处理)

### 健康度评分

健康度 = (通过检查数 / 总检查数) × 100%

- **90-100%**: 优秀
- **70-89%**: 良好
- **50-69%**: 需要改进
- **0-49%**: 需要立即修复

## 常见问题处理

### 1. 表不存在

```sql
-- 检查迁移文件
SHOW CREATE TABLE missing_table;

-- 从备份恢复
SOURCE /path/to/backup.sql;
```

### 2. 索引缺失

```sql
-- 添加缺失的索引
CREATE INDEX idx_name ON table_name(column_name);
```

### 3. 孤立记录

```sql
-- 查找孤立记录
SELECT * FROM child_table 
WHERE foreign_key NOT IN (SELECT id FROM parent_table);

-- 删除孤立记录
DELETE FROM child_table 
WHERE foreign_key NOT IN (SELECT id FROM parent_table);
```

### 4. 表碎片

```sql
-- 优化表,消除碎片
OPTIMIZE TABLE table_name;
```

### 5. 重复数据

```sql
-- 查找重复数据
SELECT username, COUNT(*) as count 
FROM users 
GROUP BY username 
HAVING count > 1;

-- 删除重复数据(保留ID最小的)
DELETE t1 FROM users t1
INNER JOIN users t2 
WHERE t1.id > t2.id AND t1.username = t2.username;
```

## 定期检查建议

建议设置定时任务,定期执行数据库检查:

```bash
# 添加到crontab
# 每天凌晨2点执行检查
0 2 * * * cd /path/to/xtest && node scripts/check-database.js >> /var/log/db-check.log 2>&1
```

## 注意事项

1. **生产环境**: 在生产环境执行前,建议先在测试环境验证
2. **性能影响**: 检查过程会对数据库产生一定负载,建议在低峰期执行
3. **权限要求**: 需要数据库的SELECT权限和访问information_schema的权限
4. **数据安全**: 工具只读取数据,不会修改数据库内容

## 故障排查

### 连接失败

1. 检查 `.env` 配置是否正确
2. 检查数据库服务是否运行
3. 检查网络连接
4. 检查用户权限

### 权限不足

```sql
-- 授予必要权限
GRANT SELECT, SHOW VIEW ON xtest_db.* TO 'your_user'@'%';
FLUSH PRIVILEGES;
```

## 联系支持

如有问题,请查看项目文档或联系开发团队。
