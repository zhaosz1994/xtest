-- 添加 ref_doc 文件类型到 ai_sub_agent_config_files 表
-- 日期: 2026-05-07
-- 说明: 支持参考文档功能，添加 ref_doc 枚举值

DROP PROCEDURE IF EXISTS add_ref_doc_enum;
DELIMITER //
CREATE PROCEDURE add_ref_doc_enum()
BEGIN
    DECLARE has_ref_doc_enum INT DEFAULT 0;
    SELECT COUNT(*) INTO has_ref_doc_enum 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ai_sub_agent_config_files' 
      AND COLUMN_NAME = 'file_type' 
      AND COLUMN_TYPE LIKE '%ref_doc%';
    
    IF has_ref_doc_enum = 0 THEN
        ALTER TABLE `ai_sub_agent_config_files` 
        MODIFY COLUMN `file_type` ENUM('soul','user','tools','rule','checklist','examples','glossary','template','custom','ref_doc') 
        NOT NULL COMMENT '配置文件类型';
    END IF;
END //
DELIMITER ;
CALL add_ref_doc_enum();
DROP PROCEDURE IF EXISTS add_ref_doc_enum;
