# 数据库自动迁移系统

## 概述

本系统实现了数据库的自动迁移功能，在服务器启动时会自动检查并执行未执行的数据库迁移脚本。

## 工作原理

1. **启动时自动检查**：服务器启动时，会自动检查数据库中的 `schema_migrations` 表
2. **执行未执行的迁移**：自动执行 `migrations` 目录下所有未执行的 `.sql` 文件
3. **记录迁移历史**：每次成功执行的迁移都会被记录到 `schema_migrations` 表中
4. **幂等性保证**：同一个迁移脚本只会执行一次，不会重复执行

## 目录结构

```
xtest/
├── migrations/                    # 迁移脚本目录
│   ├── add_review_feature.sql
│   ├── add_multi_reviewer.sql
│   ├── ai_generation_system.sql
│   └── ...
├── deploy-offline/
│   └── init-sql/
│       └── init.sql              # 基础数据库初始化脚本
└── services/
    └── autoMigration.js          # 自动迁移服务
```

## 迁移脚本命名规范

建议使用以下命名规范：

- `YYYYMMDD_description.sql` - 例如：`20260428_add_user_table.sql`
- `add_feature_name.sql` - 例如：`add_review_feature.sql`
- `fix_issue_description.sql` - 例如：`fix_user_index.sql`

## 如何添加新的迁移

1. 在 `migrations` 目录下创建新的 `.sql` 文件
2. 编写迁移 SQL 语句（建议使用 `CREATE TABLE IF NOT EXISTS` 等幂等语句）
3. 重启服务器，系统会自动执行新的迁移

## 迁移脚本示例

```sql
-- 添加新字段
ALTER TABLE `users` 
ADD COLUMN IF NOT EXISTS `phone` varchar(20) DEFAULT NULL COMMENT '手机号';

-- 创建新表
CREATE TABLE IF NOT EXISTS `user_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_setting` (`user_id`, `setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 查看迁移状态

可以通过以下 API 查看迁移状态：

```javascript
const autoMigration = require('./services/autoMigration');
const status = await autoMigration.getMigrationStatus();
console.log(status);
```

返回结果示例：
```json
{
  "executed": ["add_review_feature", "add_multi_reviewer"],
  "pending": ["ai_generation_system"],
  "totalExecuted": 2,
  "totalPending": 1
}
```

## 手动执行迁移

如果需要手动执行迁移，可以运行：

```javascript
const autoMigration = require('./services/autoMigration');
const result = await autoMigration.runMigrations();
console.log(result);
```

## 注意事项

1. **备份重要数据**：在执行迁移前，建议备份重要数据
2. **测试迁移脚本**：在生产环境执行前，先在测试环境验证迁移脚本
3. **避免修改已执行的迁移**：已执行的迁移脚本不要修改，如需调整应创建新的迁移
4. **使用事务**：复杂的迁移建议使用事务确保数据一致性

## 部署到生产环境

1. 确保 `migrations` 目录下的所有迁移脚本都已测试
2. 部署新代码到生产服务器
3. 重启服务，系统会自动执行所有未执行的迁移
4. 查看日志确认迁移执行成功

## 故障排查

### 迁移执行失败

1. 查看服务器日志，找到失败的迁移名称
2. 检查对应的 SQL 文件语法
3. 修复问题后，可以手动执行 SQL 或删除 `schema_migrations` 表中的对应记录后重启服务

### 表已存在错误

如果迁移脚本使用了 `CREATE TABLE` 而不是 `CREATE TABLE IF NOT EXISTS`，可能会导致此错误。建议修改为幂等语句。

## 数据库表结构

### schema_migrations 表

```sql
CREATE TABLE `schema_migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `migration_name` varchar(255) NOT NULL,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `rollback_script` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `migration_name` (`migration_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- `migration_name`: 迁移脚本名称（不含 .sql 后缀）
- `executed_at`: 执行时间
- `rollback_script`: 回滚脚本（可选）
