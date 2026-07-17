-- CTA 补全迁移：为已存在的表补齐缺失列
-- 原因：20260715_cta_v2.sql 使用 CREATE TABLE IF NOT EXISTS，
-- 如果表已存在（旧版本创建），则不会添加新列，导致 "Unknown column" 错误。
-- 本迁移用 ALTER TABLE 补列，迁移系统的 isIgnorableError 会自动忽略重复列。
-- 注意：不使用 AFTER 子句，因为引用的列可能不存在导致 ALTER 失败。

-- test_cases 表补列
ALTER TABLE `test_cases` ADD COLUMN `task_id` VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE `test_cases` ADD COLUMN `testpoint_id` INT NULL;
ALTER TABLE `test_cases` ADD COLUMN `description` TEXT NULL;
ALTER TABLE `test_cases` ADD COLUMN `command_list` JSON NULL;
ALTER TABLE `test_cases` ADD COLUMN `expected_result` JSON NULL;
ALTER TABLE `test_cases` ADD COLUMN `actual_output` JSON NULL;
ALTER TABLE `test_cases` ADD COLUMN `priority` INT DEFAULT 5;
ALTER TABLE `test_cases` ADD COLUMN `path_type` VARCHAR(32) DEFAULT 'cli_command';
ALTER TABLE `test_cases` ADD COLUMN `retest_count` INT DEFAULT 0;
ALTER TABLE `test_cases` ADD COLUMN `output` LONGTEXT NULL;
ALTER TABLE `test_cases` ADD COLUMN `execution_time_ms` INT NULL;
ALTER TABLE `test_cases` ADD COLUMN `executed_at` TIMESTAMP NULL;
ALTER TABLE `test_cases` ADD COLUMN `created_by` INT NULL;
ALTER TABLE `test_cases` ADD INDEX `idx_test_cases_task` (`task_id`);
ALTER TABLE `test_cases` ADD INDEX `idx_test_cases_status` (`status`);
ALTER TABLE `test_cases` ADD INDEX `idx_test_cases_testpoint` (`testpoint_id`);

-- test_bugs 表补列
ALTER TABLE `test_bugs` ADD COLUMN `task_id` VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE `test_bugs` ADD COLUMN `test_case_id` INT NULL;
ALTER TABLE `test_bugs` ADD COLUMN `bug_type` VARCHAR(50) DEFAULT 'other';
ALTER TABLE `test_bugs` ADD COLUMN `severity` VARCHAR(20) DEFAULT 'minor';
ALTER TABLE `test_bugs` ADD COLUMN `description` TEXT NULL;
ALTER TABLE `test_bugs` ADD COLUMN `path_a` VARCHAR(200) NULL;
ALTER TABLE `test_bugs` ADD COLUMN `path_a_result` TEXT NULL;
ALTER TABLE `test_bugs` ADD COLUMN `path_b` VARCHAR(200) NULL;
ALTER TABLE `test_bugs` ADD COLUMN `path_results` JSON NULL;
ALTER TABLE `test_bugs` ADD COLUMN `created_by` INT NULL;
ALTER TABLE `test_bugs` ADD INDEX `idx_test_bugs_task` (`task_id`);
ALTER TABLE `test_bugs` ADD INDEX `idx_test_bugs_case` (`test_case_id`);
ALTER TABLE `test_bugs` ADD INDEX `idx_test_bugs_status` (`status`);

-- hard_constraints 表补列
ALTER TABLE `hard_constraints` ADD COLUMN `source_doc` VARCHAR(500) NULL;
ALTER TABLE `hard_constraints` ADD COLUMN `coverage_evidence` TEXT NULL;
ALTER TABLE `hard_constraints` ADD COLUMN `covered_by_case_id` INT NULL;
ALTER TABLE `hard_constraints` ADD COLUMN `covered_at` TIMESTAMP NULL;
ALTER TABLE `hard_constraints` ADD COLUMN `checked_at` TIMESTAMP NULL;

-- agent_tasks 表补列
ALTER TABLE `agent_tasks` ADD COLUMN `workflow_type` VARCHAR(100) DEFAULT 'default';
ALTER TABLE `agent_tasks` ADD COLUMN `workflow_instance_id` VARCHAR(100) NULL;
ALTER TABLE `agent_tasks` ADD INDEX `idx_agent_tasks_workflow` (`workflow_type`);

-- agent_tool_registry 表补列
ALTER TABLE `agent_tool_registry` ADD COLUMN `timeout_ms` INT DEFAULT 30000;
ALTER TABLE `agent_tool_registry` ADD COLUMN `handler` VARCHAR(200) NULL;

-- workflow_instances 表补列
ALTER TABLE `workflow_instances` ADD COLUMN `definition_version` INT DEFAULT 1;
ALTER TABLE `workflow_instances` ADD COLUMN `result_json` LONGTEXT NULL;
ALTER TABLE `workflow_instances` ADD COLUMN `loop_count_json` JSON NULL;

-- ssh_sessions 表补列
ALTER TABLE `ssh_sessions` ADD COLUMN `reconnect_count` INT DEFAULT 0;
ALTER TABLE `ssh_sessions` ADD COLUMN `last_reconnect_at` TIMESTAMP NULL;
ALTER TABLE `ssh_sessions` ADD COLUMN `closed_at` TIMESTAMP NULL;

-- knowledge_artifacts 表补列（先补 embedding 列，再补 embedding_status）
ALTER TABLE `knowledge_artifacts` ADD COLUMN `embedding` LONGBLOB NULL;
ALTER TABLE `knowledge_artifacts` ADD COLUMN `embedding_status` ENUM('pending','processing','completed','failed') DEFAULT 'pending';
