# xTest 部署指南

## 📋 部署前检查清单

### 1. 数据库修改内容

本次更新包含以下数据库表结构修改：

#### 评审功能迁移 (add_review_feature.sql)
- **修改表**: `test_cases`
  - 添加字段: `review_status` (ENUM: draft, pending, approved, rejected)
  - 添加字段: `reviewer_id` (INT)
  - 添加字段: `review_submitted_at` (TIMESTAMP)
  - 添加字段: `review_completed_at` (TIMESTAMP)
  - 添加索引和外键约束

- **新建表**: `review_records`
  - 用于记录评审历史

#### 多人评审功能迁移 (add_multi_reviewer.sql)
- **新建表**: `case_reviewers`
  - 支持多人评审功能
  - 自动迁移现有数据

### 2. 环境要求

- Node.js >= 14.0.0
- MySQL >= 5.7
- PM2 (全局安装)
- Git

### 3. 环境变量配置

确保 `.env` 文件包含以下配置：

```env
# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=your_password
DB_NAME=xtest_db

# 生产环境
DB_NAME_PRODUCTION=xtest_db

# 测试环境
DB_NAME_STAGING=xtest_db_staging
```

## 🚀 部署方式

### 方式一：完整自动部署（推荐）

包含数据库迁移、代码部署、服务重启的完整流程：

```bash
# 部署到测试环境
./deploy-with-migration.sh staging

# 部署到生产环境
./deploy-with-migration.sh production
```

**执行步骤：**
1. 拉取最新代码
2. 创建备份（代码+数据库）
3. 执行数据库迁移
4. 安装依赖
5. 运行测试
6. 重启服务
7. 健康检查
8. 显示迁移状态

### 方式二：分步部署

#### 步骤1: 数据库迁移

```bash
# 查看迁移状态
./migrate-database.sh staging status

# 执行迁移
./migrate-database.sh staging migrate

# 如果需要回滚
./migrate-database.sh staging rollback
```

#### 步骤2: 代码部署

```bash
# 使用原有部署脚本
./deploy.sh staging
```

### 方式三：手动部署

#### 1. 备份数据库

```bash
mysqldump -h localhost -u root -p xtest_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

#### 2. 执行数据库迁移

```bash
# 按顺序执行迁移脚本
mysql -h localhost -u root -p xtest_db < migrations/add_review_feature.sql
mysql -h localhost -u root -p xtest_db < migrations/add_multi_reviewer.sql
```

#### 3. 部署代码

```bash
git pull origin main
npm ci --production
pm2 restart xtest
```

## 🔄 回滚方案

### 数据库回滚

```bash
# 自动回滚所有迁移
./migrate-database.sh production rollback

# 或手动执行回滚脚本（在迁移文件中）
mysql -h localhost -u root -p xtest_db <<EOF
-- 删除外键约束
ALTER TABLE test_cases DROP FOREIGN KEY fk_test_cases_reviewer;

-- 删除索引
ALTER TABLE test_cases DROP INDEX idx_review_status;
ALTER TABLE test_cases DROP INDEX idx_reviewer_id;

-- 删除字段
ALTER TABLE test_cases DROP COLUMN review_completed_at;
ALTER TABLE test_cases DROP COLUMN review_submitted_at;
ALTER TABLE test_cases DROP COLUMN reviewer_id;
ALTER TABLE test_cases DROP COLUMN review_status;

-- 删除表
DROP TABLE IF EXISTS case_reviewers;
DROP TABLE IF EXISTS review_records;
EOF
```

### 代码回滚

```bash
# 使用回滚脚本
./rollback.sh production backup_20240101_120000
```

## 📊 验证部署

### 1. 检查服务状态

```bash
pm2 status
pm2 logs xtest --lines 50
```

### 2. 检查数据库迁移

```bash
# 查看迁移记录
mysql -h localhost -u root -p xtest_db -e "SELECT * FROM schema_migrations;"

# 验证表结构
mysql -h localhost -u root -p xtest_db -e "DESCRIBE test_cases;"
mysql -h localhost -u root -p xtest_db -e "DESCRIBE review_records;"
mysql -h localhost -u root -p xtest_db -e "DESCRIBE case_reviewers;"
```

### 3. 功能测试

- [ ] 测试用例创建功能正常
- [ ] 测试用例提交评审功能正常
- [ ] 多人评审功能正常
- [ ] 评审记录查询正常

## ⚠️ 注意事项

### 部署前

1. **备份数据库**: 迁移脚本会自动备份，但建议手动再备份一次
2. **测试环境验证**: 先在测试环境验证迁移脚本
3. **通知用户**: 部署期间服务会短暂中断

### 部署中

1. **监控日志**: 使用 `pm2 logs xtest` 实时监控
2. **检查错误**: 如果迁移失败，立即停止并回滚
3. **验证功能**: 部署后立即测试核心功能

### 部署后

1. **监控性能**: 观察数据库查询性能
2. **检查日志**: 查看是否有异常错误
3. **用户反馈**: 收集用户使用反馈

## 🛠️ 常见问题

### Q1: 迁移脚本执行失败怎么办？

**A**: 
1. 检查数据库连接配置
2. 查看错误日志
3. 手动执行迁移脚本排查问题
4. 使用备份恢复数据库

### Q2: 如何查看迁移是否已执行？

**A**: 
```bash
./migrate-database.sh production status
```

### Q3: 迁移可以重复执行吗？

**A**: 可以。脚本会自动跳过已执行的迁移。

### Q4: 如何只回滚某个特定的迁移？

**A**: 需要手动执行对应迁移文件中的回滚脚本（注释部分）。

## 📞 支持

如有问题，请联系：
- 开发团队: dev@example.com
- 运维团队: ops@example.com
