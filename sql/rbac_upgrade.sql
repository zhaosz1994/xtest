-- ============================================
-- 配置中心 RBAC 改造 - 数据库增量更新
-- 创建时间: 2026-03-17
-- 功能: AI配置私有化、AI技能公共池化管理、权限防篡改
-- ============================================

SET @dbname = DATABASE();

-- ============================================
-- 1. ai_models 表增加 user_id 字段（AI配置私有化）
-- ============================================
SET @tablename = 'ai_models';
SET @columnname = 'user_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT NULL COMMENT ''所属用户ID，NULL表示全局配置'' AFTER id')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 为 user_id 添加索引
SET @indexname = 'idx_ai_models_user_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  'CREATE INDEX idx_ai_models_user_id ON ai_models(user_id)'
));
PREPARE createIndexIfNotExists FROM @preparedStatement;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- 添加外键约束（如果不存在）
SET @fkname = 'fk_ai_models_user';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND CONSTRAINT_NAME = @fkname) > 0,
  'SELECT 1',
  'ALTER TABLE ai_models ADD CONSTRAINT fk_ai_models_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'
));
PREPARE addFkIfNotExists FROM @preparedStatement;
EXECUTE addFkIfNotExists;
DEALLOCATE PREPARE addFkIfNotExists;

-- ============================================
-- 2. ai_skills 表增加公共化和协作字段
-- ============================================

-- 2.1 增加 is_public 字段
SET @tablename = 'ai_skills';
SET @columnname = 'is_public';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' BOOLEAN DEFAULT FALSE COMMENT ''是否公开：true-公共池技能，false-私有技能'' AFTER is_system')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2.2 增加 creator_id 字段
SET @columnname = 'creator_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT NULL COMMENT ''创建者用户ID'' AFTER is_public')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2.3 增加 updater_id 字段
SET @columnname = 'updater_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE ', @tablename, ' ADD COLUMN ', @columnname, ' INT NULL COMMENT ''最后更新者用户ID'' AFTER creator_id')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 为 creator_id 和 updater_id 添加索引
SET @indexname = 'idx_ai_skills_creator_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  'CREATE INDEX idx_ai_skills_creator_id ON ai_skills(creator_id)'
));
PREPARE createIndexIfNotExists FROM @preparedStatement;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

SET @indexname = 'idx_ai_skills_updater_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  'CREATE INDEX idx_ai_skills_updater_id ON ai_skills(updater_id)'
));
PREPARE createIndexIfNotExists FROM @preparedStatement;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- 添加外键约束
SET @fkname = 'fk_ai_skills_creator';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND CONSTRAINT_NAME = @fkname) > 0,
  'SELECT 1',
  'ALTER TABLE ai_skills ADD CONSTRAINT fk_ai_skills_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL'
));
PREPARE addFkIfNotExists FROM @preparedStatement;
EXECUTE addFkIfNotExists;
DEALLOCATE PREPARE addFkIfNotExists;

SET @fkname = 'fk_ai_skills_updater';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND CONSTRAINT_NAME = @fkname) > 0,
  'SELECT 1',
  'ALTER TABLE ai_skills ADD CONSTRAINT fk_ai_skills_updater FOREIGN KEY (updater_id) REFERENCES users(id) ON DELETE SET NULL'
));
PREPARE addFkIfNotExists FROM @preparedStatement;
EXECUTE addFkIfNotExists;
DEALLOCATE PREPARE addFkIfNotExists;

-- 为 is_public 添加索引
SET @indexname = 'idx_ai_skills_is_public';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname) > 0,
  'SELECT 1',
  'CREATE INDEX idx_ai_skills_is_public ON ai_skills(is_public)'
));
PREPARE createIndexIfNotExists FROM @preparedStatement;
EXECUTE createIndexIfNotExists;
DEALLOCATE PREPARE createIndexIfNotExists;

-- ============================================
-- 3. 创建 user_skill_settings 表（用户私有技能启用状态）
-- ============================================
CREATE TABLE IF NOT EXISTS user_skill_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL COMMENT '用户ID',
    skill_id INT NOT NULL COMMENT '技能ID',
    is_enabled BOOLEAN DEFAULT TRUE COMMENT '该用户对此技能的启用状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    UNIQUE KEY uk_user_skill (user_id, skill_id),
    
    CONSTRAINT fk_user_skill_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_skill_settings_skill FOREIGN KEY (skill_id) REFERENCES ai_skills(id) ON DELETE CASCADE,
    
    INDEX idx_user_id (user_id),
    INDEX idx_skill_id (skill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户技能私有设置表';

-- ============================================
-- 4. 数据迁移：将现有数据设置为公共且属于admin用户
-- ============================================

-- 获取 admin 用户ID
SET @admin_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1);

-- 将现有 AI 模型设置为 admin 用户所有（如果 user_id 为空）
UPDATE ai_models SET user_id = @admin_id WHERE user_id IS NULL AND @admin_id IS NOT NULL;

-- 将现有 AI 技能设置为公共且记录创建者（如果 is_public 为空）
UPDATE ai_skills 
SET is_public = TRUE, 
    creator_id = COALESCE(creator_id, @admin_id),
    updater_id = COALESCE(updater_id, @admin_id)
WHERE is_public IS NULL OR creator_id IS NULL;

-- ============================================
-- 5. 初始化 user_skill_settings 表
-- 为所有用户对所有公共技能默认启用
-- ============================================
INSERT IGNORE INTO user_skill_settings (user_id, skill_id, is_enabled)
SELECT u.id, s.id, TRUE
FROM users u
CROSS JOIN ai_skills s
WHERE s.is_public = TRUE;
