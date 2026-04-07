-- 添加报告版本管理字段
-- MySQL兼容版本：使用存储过程安全添加字段

DELIMITER //

DROP PROCEDURE IF EXISTS add_report_version_fields //

CREATE PROCEDURE add_report_version_fields()
BEGIN
    -- 添加版本号字段
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'test_reports' 
        AND column_name = 'version'
    ) THEN
        ALTER TABLE test_reports ADD COLUMN version INT NOT NULL DEFAULT 1 COMMENT '报告版本号';
    END IF;
    
    -- 添加父报告ID字段
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'test_reports' 
        AND column_name = 'parent_report_id'
    ) THEN
        ALTER TABLE test_reports ADD COLUMN parent_report_id INT DEFAULT NULL COMMENT '父报告ID，用于版本关联';
    END IF;
    
    -- 添加版本备注字段
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'test_reports' 
        AND column_name = 'version_note'
    ) THEN
        ALTER TABLE test_reports ADD COLUMN version_note VARCHAR(500) DEFAULT '' COMMENT '版本备注说明';
    END IF;
    
    -- 添加是否为当前版本标记
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'test_reports' 
        AND column_name = 'is_current_version'
    ) THEN
        ALTER TABLE test_reports ADD COLUMN is_current_version TINYINT(1) DEFAULT 1 COMMENT '是否为当前版本: 0-历史版本, 1-当前版本';
    END IF;
    
    -- 添加索引（忽略已存在的错误）
    SET @sql = 'CREATE INDEX idx_parent_report_id ON test_reports(parent_report_id)';
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    
    SET @sql = 'CREATE INDEX idx_version ON test_reports(version)';
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    
    SET @sql = 'CREATE INDEX idx_is_current_version ON test_reports(is_current_version)';
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    
END //

DELIMITER ;

-- 执行存储过程
CALL add_report_version_fields();

-- 删除存储过程
DROP PROCEDURE IF EXISTS add_report_version_fields;

-- 添加外键约束（如果不存在）
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
