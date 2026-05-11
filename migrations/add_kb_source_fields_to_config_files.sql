-- 添加知识库来源字段到 ai_sub_agent_config_files 表
-- 日期: 2026-05-09
-- 说明: 支持从知识库选择文档作为参考文档，记录来源信息

DROP PROCEDURE IF EXISTS add_kb_source_fields;
DELIMITER //
CREATE PROCEDURE add_kb_source_fields()
BEGIN
    DECLARE has_source_type INT DEFAULT 0;
    SELECT COUNT(*) INTO has_source_type 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ai_sub_agent_config_files' 
      AND COLUMN_NAME = 'source_type';
    
    IF has_source_type = 0 THEN
        ALTER TABLE `ai_sub_agent_config_files` 
        ADD COLUMN `source_type` VARCHAR(20) DEFAULT 'manual' COMMENT '来源类型: manual-手动添加, kb_doc-知识库文档' AFTER `version`,
        ADD COLUMN `source_file_id` INT DEFAULT NULL COMMENT '知识库文件ID(仅kb_doc类型有值)' AFTER `source_type`,
        ADD COLUMN `source_library_id` INT DEFAULT NULL COMMENT '来源用例库ID(仅kb_doc类型有值)' AFTER `source_file_id`,
        ADD COLUMN `source_path` VARCHAR(500) DEFAULT NULL COMMENT '来源路径(仅kb_doc类型有值)' AFTER `source_library_id`;
    END IF;
END //
DELIMITER ;
CALL add_kb_source_fields();
DROP PROCEDURE IF EXISTS add_kb_source_fields;

DROP PROCEDURE IF EXISTS add_kb_doc_enum;
DELIMITER //
CREATE PROCEDURE add_kb_doc_enum()
BEGIN
    DECLARE has_kb_doc_enum INT DEFAULT 0;
    SELECT COUNT(*) INTO has_kb_doc_enum 
    FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ai_sub_agent_config_files' 
      AND COLUMN_NAME = 'file_type' 
      AND COLUMN_TYPE LIKE '%kb_doc%';
    
    IF has_kb_doc_enum = 0 THEN
        ALTER TABLE `ai_sub_agent_config_files` 
        MODIFY COLUMN `file_type` ENUM('soul','user','tools','rule','checklist','examples','glossary','template','custom','ref_doc','kb_doc') 
        NOT NULL COMMENT '配置文件类型';
    END IF;
END //
DELIMITER ;
CALL add_kb_doc_enum();
DROP PROCEDURE IF EXISTS add_kb_doc_enum;
