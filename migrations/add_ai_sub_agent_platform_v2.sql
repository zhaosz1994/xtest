-- AI Sub-Agent Platform V2 升级 - 数据库增量迁移脚本
-- 版本: v2.0
-- 日期: 2026-04-29
-- 说明: 补充设计文档中缺失的字段和表，支持阶梯式反思评审管线、记忆分块、工具版本管理等

-- =============================================
-- 1. ai_sub_agents 表 - 新增字段
-- =============================================
DROP PROCEDURE IF EXISTS alter_ai_sub_agents_v2;
DELIMITER //
CREATE PROCEDURE alter_ai_sub_agents_v2()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'agent_type') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `agent_type` ENUM('generator','reviewer','analyzer','assistant') DEFAULT 'assistant' COMMENT '智能体类型' AFTER `category`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'avatar') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `avatar` VARCHAR(500) DEFAULT NULL COMMENT '头像URL' AFTER `description`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'parent_agent_id') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `parent_agent_id` INT DEFAULT NULL COMMENT '父Agent ID(用于Override继承)' AFTER `creator_id`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'llm_model') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `llm_model` VARCHAR(100) DEFAULT NULL COMMENT '指定LLM模型(为空则用系统默认)' AFTER `parent_agent_id`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'llm_temperature') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `llm_temperature` DECIMAL(3,2) DEFAULT 0.70 COMMENT 'LLM温度参数' AFTER `llm_model`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'llm_max_tokens') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `llm_max_tokens` INT DEFAULT 4096 COMMENT 'LLM最大输出Token数' AFTER `llm_temperature`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'max_retries') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `max_retries` INT DEFAULT 3 COMMENT '阶梯评审最大重试次数' AFTER `llm_max_tokens`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'timeout_seconds') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `timeout_seconds` INT DEFAULT 300 COMMENT '单次执行超时时间(秒)' AFTER `max_retries`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'sort_order') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `sort_order` INT DEFAULT 0 COMMENT '排序顺序' AFTER `timeout_seconds`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'version') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `version` INT DEFAULT 1 COMMENT '版本号' AFTER `sort_order`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'created_by') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `created_by` INT DEFAULT NULL COMMENT '创建者ID' AFTER `version`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND COLUMN_NAME = 'updated_by') THEN
        ALTER TABLE `ai_sub_agents` ADD COLUMN `updated_by` INT DEFAULT NULL COMMENT '更新者ID' AFTER `created_by`;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND INDEX_NAME = 'idx_agent_type') THEN
        ALTER TABLE `ai_sub_agents` ADD INDEX `idx_agent_type` (`agent_type`);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agents' AND INDEX_NAME = 'idx_parent_agent_id') THEN
        ALTER TABLE `ai_sub_agents` ADD INDEX `idx_parent_agent_id` (`parent_agent_id`);
    END IF;
END //
DELIMITER ;
CALL alter_ai_sub_agents_v2();
DROP PROCEDURE IF EXISTS alter_ai_sub_agents_v2;

-- 更新内置评审Agent的agent_type
UPDATE `ai_sub_agents` SET `agent_type` = 'reviewer' WHERE `agent_code` = 'review_test_cases' AND `is_system` = 1 AND (`agent_type` IS NULL OR `agent_type` = 'assistant');

-- =============================================
-- 2. ai_sub_agent_config_files 表 - 新增 rule 枚举值 + 调整唯一键
-- =============================================
DROP PROCEDURE IF EXISTS alter_ai_config_files_v2;
DELIMITER //
CREATE PROCEDURE alter_ai_config_files_v2()
BEGIN
    DECLARE has_rule_enum INT DEFAULT 0;
    SELECT COUNT(*) INTO has_rule_enum FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_config_files' AND COLUMN_NAME = 'file_type' AND COLUMN_TYPE LIKE '%rule%';
    IF has_rule_enum = 0 THEN
        ALTER TABLE `ai_sub_agent_config_files` MODIFY COLUMN `file_type` ENUM('soul','user','tools','rule','checklist','examples','glossary','template','custom') NOT NULL COMMENT '配置文件类型';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_config_files' AND INDEX_NAME = 'uk_agent_file_type') THEN
        ALTER TABLE `ai_sub_agent_config_files` DROP INDEX `uk_agent_file_type`;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_config_files' AND INDEX_NAME = 'uk_agent_file_type_sort') THEN
        ALTER TABLE `ai_sub_agent_config_files` ADD UNIQUE KEY `uk_agent_file_type_sort` (`agent_id`, `file_type`, `sort_order`);
    END IF;
END //
DELIMITER ;
CALL alter_ai_config_files_v2();
DROP PROCEDURE IF EXISTS alter_ai_config_files_v2;

-- =============================================
-- 3. ai_sub_agent_memories 表 - 新增字段
-- =============================================
DROP PROCEDURE IF EXISTS alter_ai_memories_v2;
DELIMITER //
CREATE PROCEDURE alter_ai_memories_v2()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'memory_type') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `memory_type` ENUM('experience','correction','preference','glossary') DEFAULT 'experience' COMMENT '记忆类型' AFTER `level`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'title') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `title` VARCHAR(200) DEFAULT NULL COMMENT '记忆标题' AFTER `memory_type`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'source') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `source` ENUM('user_correction','auto_distill','manual','system') DEFAULT 'auto_distill' COMMENT '来源' AFTER `title`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'relevance_score') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `relevance_score` DECIMAL(5,2) DEFAULT 1.00 COMMENT '相关性分数(0-1)' AFTER `source`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'access_count') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `access_count` INT DEFAULT 0 COMMENT '被引用次数' AFTER `relevance_score`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'last_accessed_at') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `last_accessed_at` TIMESTAMP NULL DEFAULT NULL COMMENT '最后引用时间' AFTER `access_count`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'is_active') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `is_active` TINYINT(1) DEFAULT 1 COMMENT '是否激活(蒸馏后可归档)' AFTER `last_accessed_at`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'token_count') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `token_count` INT DEFAULT 0 COMMENT '预估Token数' AFTER `is_active`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'version') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `version` INT DEFAULT 1 COMMENT '版本号' AFTER `token_count`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND COLUMN_NAME = 'created_by') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD COLUMN `created_by` INT DEFAULT NULL COMMENT '创建者ID' AFTER `version`;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND INDEX_NAME = 'idx_memory_type') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD INDEX `idx_memory_type` (`memory_type`);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND INDEX_NAME = 'idx_is_active') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD INDEX `idx_is_active` (`is_active`);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_memories' AND INDEX_NAME = 'idx_relevance') THEN
        ALTER TABLE `ai_sub_agent_memories` ADD INDEX `idx_relevance` (`relevance_score`);
    END IF;
END //
DELIMITER ;
CALL alter_ai_memories_v2();
DROP PROCEDURE IF EXISTS alter_ai_memories_v2;

-- =============================================
-- 4. 创建 ai_sub_agent_memory_chunks 表（记忆分块表）
-- =============================================
CREATE TABLE IF NOT EXISTS `ai_sub_agent_memory_chunks` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `memory_id` INT NOT NULL COMMENT '关联的记忆ID',
  `chunk_index` INT NOT NULL COMMENT '分块索引',
  `chunk_content` TEXT NOT NULL COMMENT '分块内容',
  `token_count` INT DEFAULT 0 COMMENT '预估Token数',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_memory_chunk` (`memory_id`, `chunk_index`),
  KEY `idx_memory_id` (`memory_id`),
  CONSTRAINT `fk_chunk_memory` FOREIGN KEY (`memory_id`) REFERENCES `ai_sub_agent_memories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子智能体记忆分块表';

-- =============================================
-- 5. ai_custom_tools 表 - 新增字段
-- =============================================
DROP PROCEDURE IF EXISTS alter_ai_custom_tools_v2;
DELIMITER //
CREATE PROCEDURE alter_ai_custom_tools_v2()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_custom_tools' AND COLUMN_NAME = 'category') THEN
        ALTER TABLE `ai_custom_tools` ADD COLUMN `category` VARCHAR(50) DEFAULT 'general' COMMENT '分类' AFTER `description`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_custom_tools' AND COLUMN_NAME = 'output_schema') THEN
        ALTER TABLE `ai_custom_tools` ADD COLUMN `output_schema` JSON DEFAULT NULL COMMENT '输出参数Schema(JSON)' AFTER `input_schema`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_custom_tools' AND COLUMN_NAME = 'version') THEN
        ALTER TABLE `ai_custom_tools` ADD COLUMN `version` INT DEFAULT 1 COMMENT '版本号' AFTER `requires_docker`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_custom_tools' AND COLUMN_NAME = 'created_by') THEN
        ALTER TABLE `ai_custom_tools` ADD COLUMN `created_by` INT DEFAULT NULL COMMENT '创建者ID' AFTER `version`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_custom_tools' AND COLUMN_NAME = 'updated_by') THEN
        ALTER TABLE `ai_custom_tools` ADD COLUMN `updated_by` INT DEFAULT NULL COMMENT '更新者ID' AFTER `created_by`;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_custom_tools' AND INDEX_NAME = 'idx_category') THEN
        ALTER TABLE `ai_custom_tools` ADD INDEX `idx_category` (`category`);
    END IF;
END //
DELIMITER ;
CALL alter_ai_custom_tools_v2();
DROP PROCEDURE IF EXISTS alter_ai_custom_tools_v2;

-- =============================================
-- 6. 创建 ai_tool_versions 表（工具版本表）
-- =============================================
CREATE TABLE IF NOT EXISTS `ai_tool_versions` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `tool_id` INT NOT NULL COMMENT '关联的工具ID',
  `version` INT NOT NULL COMMENT '版本号',
  `execute_code` LONGTEXT COMMENT '该版本的执行代码',
  `input_schema` JSON DEFAULT NULL COMMENT '该版本的输入Schema',
  `change_note` VARCHAR(500) DEFAULT NULL COMMENT '变更说明',
  `created_by` INT DEFAULT NULL COMMENT '创建者ID',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tool_version` (`tool_id`, `version`),
  KEY `idx_tool_id` (`tool_id`),
  CONSTRAINT `fk_version_tool` FOREIGN KEY (`tool_id`) REFERENCES `ai_custom_tools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI自定义工具版本表';

-- =============================================
-- 7. ai_review_tasks 表 - 新增字段 + 扩展状态枚举
-- =============================================
DROP PROCEDURE IF EXISTS alter_ai_review_tasks_v2;
DELIMITER //
CREATE PROCEDURE alter_ai_review_tasks_v2()
BEGIN
    DECLARE has_needs_human_status INT DEFAULT 0;
    SELECT COUNT(*) INTO has_needs_human_status FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_tasks' AND COLUMN_NAME = 'status' AND COLUMN_TYPE LIKE '%needs_human%';

    IF has_needs_human_status = 0 THEN
        ALTER TABLE `ai_review_tasks` MODIFY COLUMN `status` ENUM('pending','running','completed','failed','cancelled','needs_human') DEFAULT 'pending' COMMENT '任务状态';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_tasks' AND COLUMN_NAME = 'needs_human_cases') THEN
        ALTER TABLE `ai_review_tasks` ADD COLUMN `needs_human_cases` INT DEFAULT 0 COMMENT '熔断需人工介入数' AFTER `modified_cases`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_tasks' AND COLUMN_NAME = 'reflection_rounds') THEN
        ALTER TABLE `ai_review_tasks` ADD COLUMN `reflection_rounds` INT DEFAULT 0 COMMENT '实际执行的反思轮数' AFTER `needs_human_cases`;
    END IF;
END //
DELIMITER ;
CALL alter_ai_review_tasks_v2();
DROP PROCEDURE IF EXISTS alter_ai_review_tasks_v2;

-- =============================================
-- 8. ai_review_results 表 - 新增字段 + 扩展动作枚举
-- =============================================
DROP PROCEDURE IF EXISTS alter_ai_review_results_v2;
DELIMITER //
CREATE PROCEDURE alter_ai_review_results_v2()
BEGIN
    DECLARE has_needs_human_action INT DEFAULT 0;
    SELECT COUNT(*) INTO has_needs_human_action FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_results' AND COLUMN_NAME = 'action' AND COLUMN_TYPE LIKE '%needs_human%';

    IF has_needs_human_action = 0 THEN
        ALTER TABLE `ai_review_results` MODIFY COLUMN `action` ENUM('approve','reject','modify','needs_human') NOT NULL COMMENT '评审动作';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_results' AND COLUMN_NAME = 'agent_id') THEN
        ALTER TABLE `ai_review_results` ADD COLUMN `agent_id` INT DEFAULT NULL COMMENT '执行的Agent ID' AFTER `temp_case_id`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_results' AND COLUMN_NAME = 'reflection_history') THEN
        ALTER TABLE `ai_review_results` ADD COLUMN `reflection_history` JSON DEFAULT NULL COMMENT '阶梯评审履历' AFTER `diff_detail`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_results' AND COLUMN_NAME = 'final_rule_passed') THEN
        ALTER TABLE `ai_review_results` ADD COLUMN `final_rule_passed` INT DEFAULT NULL COMMENT '最终通过的规则轮次' AFTER `reflection_history`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_results' AND COLUMN_NAME = 'failed_rule') THEN
        ALTER TABLE `ai_review_results` ADD COLUMN `failed_rule` INT DEFAULT NULL COMMENT '熔断的规则轮次' AFTER `final_rule_passed`;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_results' AND COLUMN_NAME = 'confidence_score') THEN
        ALTER TABLE `ai_review_results` ADD COLUMN `confidence_score` DECIMAL(5,2) DEFAULT NULL COMMENT '置信度分数(0-100)' AFTER `failed_rule`;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_review_results' AND INDEX_NAME = 'idx_agent_id') THEN
        ALTER TABLE `ai_review_results` ADD INDEX `idx_agent_id` (`agent_id`);
    END IF;
END //
DELIMITER ;
CALL alter_ai_review_results_v2();
DROP PROCEDURE IF EXISTS alter_ai_review_results_v2;

-- =============================================
-- 9. 插入内置评审Agent的 rule.md 配置文件（阶梯式反思评审规则链）
-- =============================================
SET @review_agent_id_v2 = (SELECT `id` FROM `ai_sub_agents` WHERE `agent_code` = 'review_test_cases' AND `is_system` = 1 LIMIT 1);

INSERT IGNORE INTO `ai_sub_agent_config_files` (`agent_id`, `file_type`, `file_name`, `content`, `description`, `is_required`, `sort_order`, `version`, `created_by`) VALUES
(@review_agent_id_v2, 'rule', 'Rule.md', '# 评审规则链

## 规则 #1: 格式与规范检查
**检查维度**: 必填字段、格式规范、命名规范、优先级
**判定标准**: 4项全部满足->通过，1项不满足->修正后通过
**检查项**:
- 用例名称是否包含模块名前缀且格式规范
- 前置条件是否完整且可满足
- 测试步骤是否有编号且可执行
- 预期结果是否明确可验证

## 规则 #2: 深度规则检查
**检查维度**: 逻辑覆盖、边界值、性能风险、数据流、依赖关系
**判定标准**: 5项全部满足->通过，1项不满足->修正后通过，2项及以上->需重写
**检查项**:
- 是否覆盖正常/异常/边界场景
- 边界值是否合理
- 是否存在性能风险
- 数据流是否正确
- 依赖关系是否清晰

## 规则 #3: 业务逻辑验证
**检查维度**: 业务正确性、预期合理性、风险识别、完整性
**判定标准**: 4项全部满足->通过，1项不满足->修正后通过，2项及以上->需重写
**检查项**:
- 业务逻辑是否正确
- 预期结果是否合理
- 是否识别潜在风险
- 用例是否完整覆盖业务场景', '阶梯式评审规则文件，定义多轮评审规则链', 0, 6, 1, NULL);

-- =============================================
-- 10. 为内置工具设置 category 字段
-- =============================================
UPDATE `ai_custom_tools` SET `category` = 'validation' WHERE `tool_name` = 'spec_checker' AND (`category` IS NULL OR `category` = 'general');
UPDATE `ai_custom_tools` SET `category` = 'validation' WHERE `tool_name` = 'duplication_checker' AND (`category` IS NULL OR `category` = 'general');
UPDATE `ai_custom_tools` SET `category` = 'analysis' WHERE `tool_name` = 'coverage_analyzer' AND (`category` IS NULL OR `category` = 'general');
UPDATE `ai_custom_tools` SET `category` = 'validation' WHERE `tool_name` = 'consistency_checker' AND (`category` IS NULL OR `category` = 'general');
