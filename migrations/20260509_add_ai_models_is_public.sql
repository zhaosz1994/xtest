-- ============================================
-- AI模型添加 is_public 字段
-- 创建时间: 2026-05-09
-- 功能: 支持模型公开/私有控制
-- ============================================

SET @dbname = DATABASE();

-- 添加 is_public 字段
SET @tablename = 'ai_models';
SET @columnname = 'is_public';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' TINYINT(1) DEFAULT 0 COMMENT ''是否公开，0-私有，1-公开'' AFTER user_id')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 为 is_public 添加索引
SET @indexname = 'idx_ai_models_is_public';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  CONCAT('CREATE INDEX ', @indexname, ' ON ', @tablename, '(is_public)')
));
PREPARE createIndexIfNotExists FROM @preparedStatement;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- 将 admin 用户的模型设置为公开
UPDATE ai_models am
JOIN users u ON u.username = 'admin'
SET am.is_public = 1
WHERE am.user_id = u.id;

-- 将 user_id 为 NULL 的模型设置为 admin 用户所有并公开
UPDATE ai_models am
JOIN users u ON u.username = 'admin'
SET am.user_id = u.id, am.is_public = 1
WHERE am.user_id IS NULL;
