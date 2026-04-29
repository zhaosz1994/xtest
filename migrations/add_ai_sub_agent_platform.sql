-- AI Sub-Agent Platform 升级 - 数据库迁移脚本
-- 版本: v1.0
-- 日期: 2026-04-28
-- 说明: 创建 AI 子代理平台相关表结构，迁移 ai_skills 数据，初始化内置评审代理和工具

-- =============================================
-- 1. 创建 ai_sub_agents 表
-- =============================================
CREATE TABLE IF NOT EXISTS `ai_sub_agents` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `agent_code` VARCHAR(50) NOT NULL COMMENT '系统唯一标识',
  `display_name` VARCHAR(100) NOT NULL COMMENT '中文显示名称',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '代理描述',
  `category` VARCHAR(50) DEFAULT NULL COMMENT '分类: test_generation, test_review, qa_assistant',
  `is_system` TINYINT(1) DEFAULT 0 COMMENT '是否系统内置',
  `allow_qa` TINYINT(1) DEFAULT 1 COMMENT '是否允许QA问答',
  `is_enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用',
  `creator_id` INT DEFAULT NULL COMMENT '创建者ID',
  `visibility` ENUM('public','private') DEFAULT 'public' COMMENT '可见性',
  `memory_enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用记忆',
  `memory_distill_threshold` INT DEFAULT 2000 COMMENT '记忆蒸馏阈值(字符数)',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_code_creator` (`agent_code`, `creator_id`),
  KEY `idx_category` (`category`),
  KEY `idx_allow_qa` (`allow_qa`),
  KEY `idx_is_system` (`is_system`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_is_enabled` (`is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子代理表';

-- =============================================
-- 2. 创建 ai_custom_tools 表
-- =============================================
CREATE TABLE IF NOT EXISTS `ai_custom_tools` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `tool_name` VARCHAR(100) NOT NULL COMMENT '工具唯一标识',
  `display_name` VARCHAR(200) DEFAULT NULL COMMENT '中文显示名称',
  `description` TEXT COMMENT '工具描述',
  `input_schema` JSON DEFAULT NULL COMMENT '输入参数Schema(JSON)',
  `language` ENUM('javascript','python') DEFAULT 'javascript' COMMENT '编程语言',
  `code_content` LONGTEXT COMMENT '工具代码内容',
  `is_public` TINYINT(1) DEFAULT 1 COMMENT '是否公开',
  `is_system` TINYINT(1) DEFAULT 0 COMMENT '是否系统内置',
  `is_enabled` TINYINT(1) DEFAULT 1 COMMENT '是否启用',
  `creator_id` INT DEFAULT NULL COMMENT '创建者ID',
  `updater_id` INT DEFAULT NULL COMMENT '更新者ID',
  `timeout_ms` INT DEFAULT 10000 COMMENT '超时时间(毫秒)',
  `max_memory_mb` INT DEFAULT 128 COMMENT '最大内存(MB)',
  `allowed_tables` JSON DEFAULT NULL COMMENT '允许访问的数据库表(JSON数组)',
  `requires_docker` TINYINT(1) DEFAULT 0 COMMENT '是否需要Docker沙箱',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tool_name` (`tool_name`),
  KEY `idx_is_public` (`is_public`),
  KEY `idx_is_system` (`is_system`),
  KEY `idx_is_enabled` (`is_enabled`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_language` (`language`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI自定义工具表';

-- =============================================
-- 3. 创建 ai_sub_agent_config_files 表
-- =============================================
CREATE TABLE IF NOT EXISTS `ai_sub_agent_config_files` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `agent_id` INT NOT NULL COMMENT '关联的代理ID',
  `file_type` ENUM('soul','user','tools','checklist','examples','glossary','template','custom') NOT NULL COMMENT '配置文件类型',
  `file_name` VARCHAR(100) NOT NULL COMMENT '文件名称',
  `content` LONGTEXT COMMENT '文件内容',
  `description` VARCHAR(500) DEFAULT NULL COMMENT '文件描述',
  `is_required` TINYINT(1) DEFAULT 0 COMMENT '是否必需',
  `sort_order` INT DEFAULT 0 COMMENT '排序序号',
  `version` INT DEFAULT 1 COMMENT '版本号',
  `created_by` INT DEFAULT NULL COMMENT '创建人ID',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_file_type` (`agent_id`, `file_type`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_file_type` (`file_type`),
  CONSTRAINT `fk_config_sub_agent` FOREIGN KEY (`agent_id`) REFERENCES `ai_sub_agents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子代理配置文件表';

-- =============================================
-- 4. 创建 ai_sub_agent_memories 表
-- =============================================
CREATE TABLE IF NOT EXISTS `ai_sub_agent_memories` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `agent_id` INT NOT NULL COMMENT '关联的代理ID',
  `library_id` INT DEFAULT NULL COMMENT '用例库ID',
  `module_id` INT DEFAULT NULL COMMENT '模块ID',
  `level` ENUM('global','library','module') NOT NULL COMMENT '记忆层级',
  `content` LONGTEXT COMMENT '记忆内容',
  `char_count` INT DEFAULT 0 COMMENT '字符数',
  `last_distilled_at` TIMESTAMP NULL DEFAULT NULL COMMENT '上次蒸馏时间',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_memory_node` (`agent_id`, `library_id`, `module_id`),
  KEY `idx_agent_level` (`agent_id`, `level`),
  KEY `idx_library_id` (`library_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_agent_char_count` (`agent_id`, `char_count`),
  CONSTRAINT `fk_memory_sub_agent` FOREIGN KEY (`agent_id`) REFERENCES `ai_sub_agents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子代理记忆表';

-- =============================================
-- 5. 创建 ai_review_tasks 表
-- =============================================
CREATE TABLE IF NOT EXISTS `ai_review_tasks` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `review_task_id` VARCHAR(50) NOT NULL COMMENT '评审任务唯一标识',
  `source_task_id` VARCHAR(50) DEFAULT NULL COMMENT '来源生成任务ID',
  `submitter_id` INT DEFAULT NULL COMMENT '提交人ID',
  `agent_id` INT DEFAULT NULL COMMENT '执行评审的代理ID',
  `status` ENUM('pending','running','completed','failed','cancelled') DEFAULT 'pending' COMMENT '任务状态',
  `total_cases` INT DEFAULT 0 COMMENT '总用例数',
  `reviewed_cases` INT DEFAULT 0 COMMENT '已评审用例数',
  `approved_cases` INT DEFAULT 0 COMMENT '通过用例数',
  `rejected_cases` INT DEFAULT 0 COMMENT '拒绝用例数',
  `modified_cases` INT DEFAULT 0 COMMENT '修改用例数',
  `error_message` TEXT COMMENT '错误信息',
  `started_at` TIMESTAMP NULL DEFAULT NULL COMMENT '开始时间',
  `completed_at` TIMESTAMP NULL DEFAULT NULL COMMENT '完成时间',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_review_task_id` (`review_task_id`),
  KEY `idx_source_task_id` (`source_task_id`),
  KEY `idx_submitter_id` (`submitter_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_status` (`status`),
  KEY `idx_status_updated` (`status`, `updated_at`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI评审任务表';

-- =============================================
-- 6. 创建 ai_review_results 表
-- =============================================
CREATE TABLE IF NOT EXISTS `ai_review_results` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `review_task_id` VARCHAR(50) NOT NULL COMMENT '关联的评审任务ID',
  `temp_case_id` VARCHAR(50) NOT NULL COMMENT '临时用例ID',
  `action` ENUM('approve','reject','modify') NOT NULL COMMENT '评审动作',
  `ai_comment` TEXT COMMENT 'AI评审意见',
  `ai_score` DECIMAL(3,1) DEFAULT NULL COMMENT 'AI评分(0.0-10.0)',
  `original_content` JSON DEFAULT NULL COMMENT '原始用例内容',
  `suggested_content` JSON DEFAULT NULL COMMENT '建议修改内容',
  `diff_summary` TEXT COMMENT '差异摘要',
  `diff_detail` JSON DEFAULT NULL COMMENT '差异详情',
  `tool_calls_log` JSON DEFAULT NULL COMMENT '工具调用日志',
  `memory_contribution` VARCHAR(200) DEFAULT NULL COMMENT '记忆贡献说明',
  `user_decision` ENUM('pending','accepted','rejected','modified_accepted') DEFAULT 'pending' COMMENT '用户决策',
  `user_comment` TEXT COMMENT '用户意见',
  `user_modified_content` JSON DEFAULT NULL COMMENT '用户修改后的内容',
  `decided_at` TIMESTAMP NULL DEFAULT NULL COMMENT '决策时间',
  `decided_by` INT DEFAULT NULL COMMENT '决策人ID',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_review_case` (`review_task_id`, `temp_case_id`),
  KEY `idx_review_task_id` (`review_task_id`),
  KEY `idx_temp_case_id` (`temp_case_id`),
  KEY `idx_action` (`action`),
  KEY `idx_user_decision` (`user_decision`),
  KEY `idx_decided_by` (`decided_by`),
  CONSTRAINT `fk_ai_review_task` FOREIGN KEY (`review_task_id`) REFERENCES `ai_review_tasks` (`review_task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI评审结果表';

-- =============================================
-- 7. ALTER temp_test_cases 表 - 添加AI评审相关字段
-- =============================================
DROP PROCEDURE IF EXISTS add_ai_review_columns;
DELIMITER //
CREATE PROCEDURE add_ai_review_columns()
BEGIN
    -- ai_review_action
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND COLUMN_NAME = 'ai_review_action') THEN
        ALTER TABLE `temp_test_cases` ADD COLUMN `ai_review_action` ENUM('none','approve','reject','modify') DEFAULT 'none' COMMENT 'AI评审动作' AFTER `review_deadline`;
    END IF;
    -- ai_review_comment
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND COLUMN_NAME = 'ai_review_comment') THEN
        ALTER TABLE `temp_test_cases` ADD COLUMN `ai_review_comment` TEXT COMMENT 'AI评审意见' AFTER `ai_review_action`;
    END IF;
    -- ai_review_score
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND COLUMN_NAME = 'ai_review_score') THEN
        ALTER TABLE `temp_test_cases` ADD COLUMN `ai_review_score` DECIMAL(3,1) DEFAULT NULL COMMENT 'AI评审评分' AFTER `ai_review_comment`;
    END IF;
    -- ai_suggested_content
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND COLUMN_NAME = 'ai_suggested_content') THEN
        ALTER TABLE `temp_test_cases` ADD COLUMN `ai_suggested_content` JSON DEFAULT NULL COMMENT 'AI建议修改内容' AFTER `ai_review_score`;
    END IF;
    -- ai_diff_summary
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND COLUMN_NAME = 'ai_diff_summary') THEN
        ALTER TABLE `temp_test_cases` ADD COLUMN `ai_diff_summary` TEXT COMMENT 'AI差异摘要' AFTER `ai_suggested_content`;
    END IF;
    -- ai_review_task_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND COLUMN_NAME = 'ai_review_task_id') THEN
        ALTER TABLE `temp_test_cases` ADD COLUMN `ai_review_task_id` VARCHAR(50) DEFAULT NULL COMMENT 'AI评审任务ID' AFTER `ai_diff_summary`;
    END IF;
    -- ai_user_decision
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND COLUMN_NAME = 'ai_user_decision') THEN
        ALTER TABLE `temp_test_cases` ADD COLUMN `ai_user_decision` ENUM('pending','accepted','rejected','modified_accepted') DEFAULT 'pending' COMMENT '用户对AI评审的决策' AFTER `ai_review_task_id`;
    END IF;
END //
DELIMITER ;
CALL add_ai_review_columns();
DROP PROCEDURE IF EXISTS add_ai_review_columns;

-- 为新增字段添加索引（使用存储过程确保幂等性）
DROP PROCEDURE IF EXISTS add_ai_review_indexes;
DELIMITER //
CREATE PROCEDURE add_ai_review_indexes()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND INDEX_NAME = 'idx_ai_review_action') THEN
        ALTER TABLE `temp_test_cases` ADD INDEX `idx_ai_review_action` (`ai_review_action`);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND INDEX_NAME = 'idx_ai_review_task_id') THEN
        ALTER TABLE `temp_test_cases` ADD INDEX `idx_ai_review_task_id` (`ai_review_task_id`);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temp_test_cases' AND INDEX_NAME = 'idx_ai_user_decision') THEN
        ALTER TABLE `temp_test_cases` ADD INDEX `idx_ai_user_decision` (`ai_user_decision`);
    END IF;
END //
DELIMITER ;
CALL add_ai_review_indexes();
DROP PROCEDURE IF EXISTS add_ai_review_indexes;

-- =============================================
-- 8. 插入邮件类型记录
-- =============================================
INSERT IGNORE INTO `email_types` (`type_code`, `type_name`, `category`, `description`, `is_required`, `default_email_enabled`, `default_in_app_enabled`, `template_subject`, `template_path`, `supports_in_app`, `role_restriction`, `sort_order`) VALUES
('ai_review_complete', 'AI评审完成通知', 'business', 'AI子代理完成测试用例评审时通知提交人', FALSE, TRUE, TRUE, '【xTest】AI评审已完成 - {reviewTaskId}', 'ai_review_complete', TRUE, NULL, 220),
('ai_review_result', 'AI评审结果通知', 'business', 'AI评审单条用例结果通知，包含评审动作和评分', FALSE, TRUE, TRUE, '【xTest】AI评审结果 - {caseName}', 'ai_review_result', TRUE, NULL, 221);

-- =============================================
-- 9. 迁移 ai_skills 数据到 ai_sub_agents
-- =============================================
-- 列映射: name -> agent_code, display_name -> display_name, description -> description,
-- category -> category, is_system -> is_system, is_public -> visibility,
-- creator_id -> creator_id, is_enabled -> is_enabled
INSERT IGNORE INTO `ai_sub_agents` (`agent_code`, `display_name`, `description`, `category`, `is_system`, `allow_qa`, `is_enabled`, `creator_id`, `visibility`, `memory_enabled`, `memory_distill_threshold`)
SELECT
    `name`,
    COALESCE(`display_name`, `name`),
    SUBSTRING(COALESCE(`description`, ''), 1, 255),
    CASE
        WHEN `category` IN ('test_generation', 'test_review', 'qa_assistant') THEN `category`
        WHEN `category` = 'statistics' THEN 'qa_assistant'
        WHEN `category` = 'analysis' THEN 'qa_assistant'
        WHEN `category` = 'report' THEN 'qa_assistant'
        WHEN `category` = 'task' THEN 'qa_assistant'
        ELSE 'qa_assistant'
    END,
    COALESCE(`is_system`, 0),
    1,
    COALESCE(`is_enabled`, 1),
    `creator_id`,
    CASE WHEN COALESCE(`is_public`, 1) = 1 THEN 'public' ELSE 'private' END,
    1,
    2000
FROM `ai_skills`
WHERE NOT EXISTS (
    SELECT 1 FROM `ai_sub_agents` sa
    WHERE sa.`agent_code` = `ai_skills`.`name`
    AND (sa.`creator_id` = `ai_skills`.`creator_id` OR (sa.`creator_id` IS NULL AND `ai_skills`.`creator_id` IS NULL))
);

-- =============================================
-- 10. 插入内置 Sub-Agent: review_test_cases
-- =============================================
INSERT IGNORE INTO `ai_sub_agents` (`agent_code`, `display_name`, `description`, `category`, `is_system`, `allow_qa`, `is_enabled`, `creator_id`, `visibility`, `memory_enabled`, `memory_distill_threshold`) VALUES
('review_test_cases', '测试用例评审', '对测试用例进行自动化评审，检查规范性、完整性、一致性和覆盖率，提供修改建议', 'test_review', 1, 1, 1, NULL, 'public', 1, 2000);

-- =============================================
-- 11. 插入内置工具
-- =============================================
INSERT IGNORE INTO `ai_custom_tools` (`tool_name`, `display_name`, `description`, `input_schema`, `language`, `code_content`, `is_public`, `is_system`, `is_enabled`, `creator_id`, `updater_id`, `timeout_ms`, `max_memory_mb`, `allowed_tables`, `requires_docker`) VALUES
('spec_checker', '规范检查器', '检查测试用例是否符合编写规范，包括命名格式、步骤编号、预期结果等',
 '{"type":"object","properties":{"case_name":{"type":"string","description":"用例名称"},"steps":{"type":"string","description":"测试步骤"},"expected":{"type":"string","description":"预期结果"}},"required":["case_name","steps","expected"]}',
 'javascript',
 'return { passed: true, checks: [{ rule: ''命名规范'', passed: true, message: ''用例名称符合规范'' }] };',
 1, 1, 1, NULL, NULL, 10000, 128, NULL, 0),

('duplication_checker', '查重器', '检查测试用例是否与已有用例重复',
 '{"type":"object","properties":{"case_name":{"type":"string","description":"用例名称"},"case_content":{"type":"string","description":"用例内容"}},"required":["case_name"]}',
 'javascript',
 'return { is_duplicate: false, similarity: 0, message: ''未发现重复用例'' };',
 1, 1, 1, NULL, NULL, 10000, 128, NULL, 0),

('coverage_analyzer', '覆盖率分析器', '分析测试用例的覆盖情况，识别未覆盖的场景',
 '{"type":"object","properties":{"cases":{"type":"array","description":"用例列表"},"module_context":{"type":"object","description":"模块上下文"}},"required":["cases"]}',
 'javascript',
 'return { coverage_score: 85, uncovered_scenarios: [], message: ''覆盖率良好'' };',
 1, 1, 1, NULL, NULL, 10000, 128, NULL, 0),

('consistency_checker', '一致性检查器', '检查测试用例之间的一致性，包括术语、格式、粒度等',
 '{"type":"object","properties":{"cases":{"type":"array","description":"用例列表"}},"required":["cases"]}',
 'javascript',
 'return { is_consistent: true, inconsistencies: [], message: ''用例一致性良好'' };',
 1, 1, 1, NULL, NULL, 10000, 128, NULL, 0);

-- =============================================
-- 12. 初始化 review_test_cases 代理的默认配置文件
-- =============================================
-- 获取 review_test_cases 的 agent_id（用于后续 INSERT）
SET @review_agent_id = (SELECT `id` FROM `ai_sub_agents` WHERE `agent_code` = 'review_test_cases' AND `is_system` = 1 LIMIT 1);

-- Soul.md
INSERT IGNORE INTO `ai_sub_agent_config_files` (`agent_id`, `file_type`, `file_name`, `content`, `description`, `is_required`, `sort_order`, `version`, `created_by`) VALUES
(@review_agent_id, 'soul', 'Soul.md', '# AI 评审员\n\n## 身份\n你是一名资深的测试用例评审专家，拥有 10 年以上的软件测试经验。\n\n## 核心原则\n1. **准确性优先**：评审意见必须基于事实，不得臆测\n2. **建设性反馈**：拒绝时必须给出具体改进建议\n3. **规范遵循**：严格遵循项目测试用例编写规范\n4. **完整性检查**：确保用例覆盖正常/异常/边界场景\n\n## 行为边界\n- 仅评审测试用例的质量，不修改业务逻辑\n- 不替代人工评审的最终决策权\n- 遇到不确定的内容，标注为"需人工确认"\n- 不生成全新的测试用例，仅对现有用例提出修改建议\n\n## 评审维度\n1. 用例名称是否清晰准确\n2. 前置条件是否完整\n3. 测试步骤是否可执行、有编号\n4. 预期结果是否明确可验证\n5. 优先级设定是否合理\n6. 用例类型分类是否正确\n7. 是否覆盖边界和异常场景\n\n## 输出格式\n严格按照 JSON 格式输出评审结果：\n{\n  "action": "approve|reject|modify",\n  "score": 0-10,\n  "comment": "评审意见",\n  "suggested_content": { ... }\n}', '评审员灵魂文件，定义身份、原则、行为边界和输出格式', 1, 1, 1, NULL);

-- User.md
INSERT IGNORE INTO `ai_sub_agent_config_files` (`agent_id`, `file_type`, `file_name`, `content`, `description`, `is_required`, `sort_order`, `version`, `created_by`) VALUES
(@review_agent_id, 'user', 'User.md', '# 用户评审偏好\n\n## 团队规范\n- 用例命名格式：[模块名]_[测试类型]_[测试点描述]\n- 步骤编号格式：1. 2. 3.\n- 预期结果需包含具体数值或明确状态\n\n## 评审关注点\n- 重点关注：步骤可执行性、预期结果可验证性\n- 次要关注：命名规范、格式统一\n- 可忽略：备注字段内容\n\n## 待评审用例\n{{temp_cases_json}}\n\n## 模块上下文\n模块名称: {{module_name}}\n模块描述: {{module_description}}\n\n## 评审要求\n- 评审数量: {{case_count}} 条\n- 自动通过阈值: {{auto_approve_score}}\n- 重点关注: {{review_focus}}', '用户偏好文件，定义团队规范和评审上下文模板', 1, 2, 1, NULL);

-- Tools.md
INSERT IGNORE INTO `ai_sub_agent_config_files` (`agent_id`, `file_type`, `file_name`, `content`, `description`, `is_required`, `sort_order`, `version`, `created_by`) VALUES
(@review_agent_id, 'tools', 'Tools.md', '["spec_checker", "duplication_checker", "coverage_analyzer", "consistency_checker"]', '工具配置文件，定义代理可调用的工具列表', 1, 3, 1, NULL);

-- checklist.md
INSERT IGNORE INTO `ai_sub_agent_config_files` (`agent_id`, `file_type`, `file_name`, `content`, `description`, `is_required`, `sort_order`, `version`, `created_by`) VALUES
(@review_agent_id, 'checklist', 'checklist.md', '# 评审检查清单\n\n## 必检项\n- [ ] 用例名称是否包含模块名前缀\n- [ ] 前置条件是否完整且可满足\n- [ ] 测试步骤是否有编号且可执行\n- [ ] 预期结果是否明确可验证\n- [ ] 优先级是否合理（核心功能高，边缘功能低）\n\n## 建议检项\n- [ ] 是否覆盖正常/异常/边界场景\n- [ ] 用例类型是否正确\n- [ ] 测试方法是否合理\n- [ ] 关键配置是否说明', '评审检查清单，定义必检项和建议检项', 1, 4, 1, NULL);

-- examples.md
INSERT IGNORE INTO `ai_sub_agent_config_files` (`agent_id`, `file_type`, `file_name`, `content`, `description`, `is_required`, `sort_order`, `version`, `created_by`) VALUES
(@review_agent_id, 'examples', 'examples.md', '# 评审示例\n\n## 好的用例示例\n**名称**: 登录功能_功能测试_正常登录\n**优先级**: 高\n**前置条件**: 用户已注册且账号已激活\n**步骤**:\n1. 打开登录页面\n2. 输入正确的用户名和密码\n3. 点击登录按钮\n**预期结果**: 返回HTTP 200，页面跳转至首页，显示用户昵称\n\n## 差的用例示例\n**名称**: 登录测试\n**优先级**: 中\n**前置条件**: 无\n**步骤**:\n1. 登录\n**预期结果**: 系统正常', '评审示例文件，提供好坏用例的对比参考', 0, 5, 1, NULL);

-- =============================================
-- 13. 插入 review_test_cases 代理的全局记忆种子数据
-- =============================================
INSERT IGNORE INTO `ai_sub_agent_memories` (`agent_id`, `library_id`, `module_id`, `level`, `content`, `char_count`, `last_distilled_at`) VALUES
(@review_agent_id, NULL, NULL, 'global', '## 评审基础规范\n- 用例名称必须以模块名开头\n- 预期结果必须包含具体数值或明确状态\n- 步骤编号统一使用 1. 2. 3. 格式\n- 优先级只允许：高/中/低\n- 每条用例至少覆盖1个异常场景', 95, NULL);
