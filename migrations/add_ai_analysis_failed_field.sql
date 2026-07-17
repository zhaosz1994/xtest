-- 添加AI分析失败标记字段到测试报告表
-- MySQL兼容版本：先检查字段是否存在再添加

-- 创建存储过程来安全添加字段
DELIMITER //

DROP PROCEDURE IF EXISTS add_column_if_not_exists //

CREATE PROCEDURE add_column_if_not_exists()
BEGIN
    -- 检查 ai_analysis_failed 字段是否存在
    IF NOT EXISTS (
        SELECT * FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = 'test_reports' 
        AND column_name = 'ai_analysis_failed'
    ) THEN
        ALTER TABLE test_reports ADD COLUMN ai_analysis_failed TINYINT(1) DEFAULT 0 COMMENT 'AI分析是否失败: 0-成功, 1-失败';
    END IF;
END //

DELIMITER ;

-- 执行存储过程
CALL add_column_if_not_exists();

-- 删除存储过程
DROP PROCEDURE IF EXISTS add_column_if_not_exists;
