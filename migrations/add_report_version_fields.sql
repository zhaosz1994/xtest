-- 添加报告版本管理字段
-- MySQL兼容版本：使用 SET + IF + PREPARE 安全添加字段（不使用存储过程和DELIMITER）

-- 1. 添加版本号字段
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
      AND table_name = 'test_reports' 
      AND column_name = 'version'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE test_reports ADD COLUMN version INT NOT NULL DEFAULT 1 COMMENT ''报告版本号''',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. 添加父报告ID字段
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
      AND table_name = 'test_reports' 
      AND column_name = 'parent_report_id'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE test_reports ADD COLUMN parent_report_id INT DEFAULT NULL COMMENT ''父报告ID，用于版本关联''',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. 添加版本备注字段
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
      AND table_name = 'test_reports' 
      AND column_name = 'version_note'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE test_reports ADD COLUMN version_note VARCHAR(500) DEFAULT '''' COMMENT ''版本备注说明''',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. 添加是否为当前版本标记
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
      AND table_name = 'test_reports' 
      AND column_name = 'is_current_version'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE test_reports ADD COLUMN is_current_version TINYINT(1) DEFAULT 1 COMMENT ''是否为当前版本: 0-历史版本, 1-当前版本''',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. 添加索引（如果不存在）
SET @idx_exists = (
    SELECT COUNT(*) FROM information_schema.statistics 
    WHERE table_schema = DATABASE() 
      AND table_name = 'test_reports' 
      AND index_name = 'idx_parent_report_id'
);

SET @sql = IF(@idx_exists = 0, 
    'CREATE INDEX idx_parent_report_id ON test_reports(parent_report_id)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
    SELECT COUNT(*) FROM information_schema.statistics 
    WHERE table_schema = DATABASE() 
      AND table_name = 'test_reports' 
      AND index_name = 'idx_version'
);

SET @sql = IF(@idx_exists = 0, 
    'CREATE INDEX idx_version ON test_reports(version)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
    SELECT COUNT(*) FROM information_schema.statistics 
    WHERE table_schema = DATABASE() 
      AND table_name = 'test_reports' 
      AND index_name = 'idx_is_current_version'
);

SET @sql = IF(@idx_exists = 0, 
    'CREATE INDEX idx_is_current_version ON test_reports(is_current_version)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. 添加外键约束（如果不存在）
SET @fk_exists = (
    SELECT COUNT(*) FROM information_schema.table_constraints 
    WHERE constraint_schema = DATABASE() 
      AND table_name = 'test_reports' 
      AND constraint_name = 'fk_test_reports_parent'
);

SET @sql = IF(@fk_exists = 0, 
    'ALTER TABLE test_reports ADD CONSTRAINT fk_test_reports_parent FOREIGN KEY (parent_report_id) REFERENCES test_reports(id) ON DELETE SET NULL',
    'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
