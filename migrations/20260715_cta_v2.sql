-- CTA 改进数据库迁移
-- 包含：声明式工作流定义、工作流实例、硬约束、SSH会话、SDK快照、测试用例、测试Bug、Agent配置、知识沉淀

-- 1. 工作流定义表
CREATE TABLE IF NOT EXISTS `workflow_definitions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `workflow_type` VARCHAR(100) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT,
  `definition_json` LONGTEXT NOT NULL,
  `version` INT DEFAULT 1,
  `status` ENUM('active','inactive','draft','archived') DEFAULT 'active',
  `created_by` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_workflow_type_version` (`workflow_type`,`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 工作流实例表
CREATE TABLE IF NOT EXISTS `workflow_instances` (
  `instance_id` VARCHAR(100) PRIMARY KEY,
  `task_id` VARCHAR(128) NOT NULL,
  `workflow_type` VARCHAR(100) NOT NULL DEFAULT 'default',
  `definition_version` INT DEFAULT 1,
  `status` ENUM('pending','running','paused','awaiting_approval','completed','failed','cancelled') DEFAULT 'pending',
  `context_json` LONGTEXT,
  `result_json` LONGTEXT,
  `current_node` VARCHAR(100),
  `loop_count_json` JSON,
  `started_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL,
  `error_message` TEXT,
  `created_by` INT,
  INDEX `idx_workflow_instances_task` (`task_id`),
  INDEX `idx_workflow_instances_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 硬约束表
CREATE TABLE IF NOT EXISTS `hard_constraints` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `task_id` VARCHAR(128) NOT NULL,
  `constraint_type` ENUM('register','state_machine','parameter_matrix') NOT NULL,
  `constraint_key` VARCHAR(200) NOT NULL,
  `constraint_value` JSON,
  `source_doc` VARCHAR(500),
  `coverage_status` ENUM('pending','covered','uncovered') DEFAULT 'pending',
  `coverage_evidence` TEXT,
  `covered_by_case_id` INT,
  `covered_at` TIMESTAMP NULL,
  `checked_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_hard_constraints_task` (`task_id`),
  INDEX `idx_hard_constraints_type` (`constraint_type`),
  INDEX `idx_hard_constraints_status` (`coverage_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. SSH 会话表
CREATE TABLE IF NOT EXISTS `ssh_sessions` (
  `session_id` VARCHAR(100) PRIMARY KEY,
  `host` VARCHAR(200) NOT NULL,
  `port` INT DEFAULT 22,
  `username` VARCHAR(100) NOT NULL,
  `device_type` VARCHAR(50) DEFAULT 'generic',
  `resource_id` VARCHAR(128),
  `task_id` VARCHAR(128),
  `status` ENUM('active','error','closed','expired') DEFAULT 'active',
  `reconnect_count` INT DEFAULT 0,
  `last_reconnect_at` TIMESTAMP NULL,
  `closed_at` TIMESTAMP NULL,
  `created_by` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_ssh_sessions_task` (`task_id`),
  INDEX `idx_ssh_sessions_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. SDK 快照表
CREATE TABLE IF NOT EXISTS `sdk_snapshots` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(100) NOT NULL,
  `task_id` VARCHAR(128),
  `snapshot_type` VARCHAR(50) DEFAULT 'config',
  `config_json` LONGTEXT,
  `diff_json` LONGTEXT,
  `created_by` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sdk_snapshots_session` (`session_id`),
  INDEX `idx_sdk_snapshots_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. 测试用例表（CTA 深度测试闭环）
CREATE TABLE IF NOT EXISTS `test_cases` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `task_id` VARCHAR(128) NOT NULL,
  `testpoint_id` INT,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT,
  `command_list` JSON,
  `expected_result` JSON,
  `actual_output` JSON,
  `priority` INT DEFAULT 5,
  `path_type` VARCHAR(32) DEFAULT 'cli_command',
  `status` ENUM('pending','running','pass','fail','error','skipped') DEFAULT 'pending',
  `output` LONGTEXT,
  `execution_time_ms` INT,
  `retest_count` INT DEFAULT 0,
  `created_by` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `executed_at` TIMESTAMP NULL,
  INDEX `idx_test_cases_task` (`task_id`),
  INDEX `idx_test_cases_status` (`status`),
  INDEX `idx_test_cases_testpoint` (`testpoint_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. 测试Bug表
CREATE TABLE IF NOT EXISTS `test_bugs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `task_id` VARCHAR(128) NOT NULL,
  `test_case_id` INT,
  `bug_type` ENUM('cli_error','register_mismatch','traffic_mismatch','cross_validation_mismatch','coverage_gap','other') DEFAULT 'other',
  `severity` ENUM('critical','major','minor','info') DEFAULT 'minor',
  `description` TEXT NOT NULL,
  `path_a` VARCHAR(200),
  `path_a_result` TEXT,
  `path_b` VARCHAR(200),
  `path_b_result` TEXT,
  `path_results` JSON,
  `status` ENUM('open','confirmed','fixed','wontfix') DEFAULT 'open',
  `created_by` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_test_bugs_task` (`task_id`),
  INDEX `idx_test_bugs_case` (`test_case_id`),
  INDEX `idx_test_bugs_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Agent 配置表
CREATE TABLE IF NOT EXISTS `agent_configs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `agent_name` VARCHAR(100) NOT NULL,
  `agent_type` VARCHAR(50) DEFAULT 'ai',
  `config_json` JSON NOT NULL,
  `soul_md` LONGTEXT,
  `user_md` LONGTEXT,
  `version` INT DEFAULT 1,
  `status` ENUM('active','inactive','draft') DEFAULT 'active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_agent_name_version` (`agent_name`,`version`),
  INDEX `idx_agent_configs_name` (`agent_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. 知识沉淀表
CREATE TABLE IF NOT EXISTS `knowledge_artifacts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `task_id` VARCHAR(128) NOT NULL,
  `artifact_type` ENUM('design_understanding','test_plan','test_results','coverage_report','lessons_learned','cross_validation') NOT NULL,
  `title` VARCHAR(500),
  `content` LONGTEXT,
  `metadata_json` JSON,
  `embedding` LONGBLOB,
  `embedding_status` ENUM('pending','processing','completed','failed') DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_knowledge_artifacts_task` (`task_id`),
  INDEX `idx_knowledge_artifacts_type` (`artifact_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. 已有表新增字段
-- 注意：不使用 IF NOT EXISTS 语法（MySQL 8.0.29以下不支持），
-- 迁移系统的 isIgnorableError 会自动忽略 ER_DUP_FIELDNAME/ER_DUP_KEYNAME
ALTER TABLE `agent_tasks` ADD COLUMN `workflow_type` VARCHAR(100) DEFAULT 'default' AFTER `mode`;
ALTER TABLE `agent_tasks` ADD COLUMN `workflow_instance_id` VARCHAR(100) NULL AFTER `workflow_type`;
ALTER TABLE `agent_tasks` ADD INDEX `idx_agent_tasks_workflow` (`workflow_type`);
ALTER TABLE `agent_tool_registry` ADD COLUMN `timeout_ms` INT DEFAULT 30000 AFTER `description`;
ALTER TABLE `agent_tool_registry` ADD COLUMN `handler` VARCHAR(200) AFTER `timeout_ms`;

-- 11. 默认工作流定义种子数据（JSON 字符串）
INSERT INTO `workflow_definitions` (`workflow_type`,`name`,`description`,`definition_json`,`version`,`status`)
VALUES
('default', '默认测试工作流', '完整的深度测试闭环工作流', '{"nodes":[{"id":"env_prepare","label":"环境准备","handler":"env_prepare","agent":"env_preparer"},{"id":"learn_context","label":"学习上下文","handler":"learn_context","agent":"context_learner"},{"id":"approval_gate","label":"审批门","handler":"approval_gate","agent":"approver","requires_approval":true},{"id":"test_dispatch","label":"测试分发","handler":"test_dispatch","agent":"test_dispatcher"},{"id":"test_hunt","label":"测试执行","handler":"test_hunt","agent":"test_hunter"},{"id":"test_completeness_gate","label":"覆盖完整性门","handler":"test_completeness_gate","agent":"completeness_checker"},{"id":"hard_constraint_check","label":"硬约束检查","handler":"hard_constraint_check","agent":"constraint_checker"},{"id":"knowledge_settle","label":"知识沉淀","handler":"knowledge_settle","agent":"knowledge_settler"}],"edges":[{"from":"__START__","to":"env_prepare"},{"from":"env_prepare","to":"learn_context"},{"from":"learn_context","to":"approval_gate"},{"from":"approval_gate","to":"test_dispatch","condition":"nodeResults.approval_gate.output.decision == approved"},{"from":"test_dispatch","to":"test_hunt"},{"from":"test_hunt","to":"test_completeness_gate"},{"from":"test_completeness_gate","to":"hard_constraint_check","condition":"nodeResults.test_completeness_gate.output.coverage_met == true"},{"from":"test_completeness_gate","to":"test_dispatch","condition":"nodeResults.test_completeness_gate.output.coverage_met == false && nodeResults.test_completeness_gate.output.retest_count < 3"},{"from":"test_hunt","to":"test_dispatch","on_error":true},{"from":"hard_constraint_check","to":"knowledge_settle"},{"from":"knowledge_settle","to":"__END__"}],"max_loops_per_node":10}', 1, 'active')
ON DUPLICATE KEY UPDATE `status` = 'active';

INSERT INTO `workflow_definitions` (`workflow_type`,`name`,`description`,`definition_json`,`version`,`status`)
VALUES
('regression', '回归测试工作流', '简化版回归测试工作流', '{"nodes":[{"id":"env_prepare","label":"环境准备","handler":"env_prepare","agent":"env_preparer"},{"id":"learn_context","label":"学习上下文","handler":"learn_context","agent":"context_learner"},{"id":"test_dispatch","label":"测试分发","handler":"test_dispatch","agent":"test_dispatcher"},{"id":"test_hunt","label":"测试执行","handler":"test_hunt","agent":"test_hunter"},{"id":"critic_gate","label":"评审门","handler":"critic_gate","agent":"critic"},{"id":"knowledge_settle","label":"知识沉淀","handler":"knowledge_settle","agent":"knowledge_settler"}],"edges":[{"from":"__START__","to":"env_prepare"},{"from":"env_prepare","to":"learn_context"},{"from":"learn_context","to":"test_dispatch"},{"from":"test_dispatch","to":"test_hunt"},{"from":"test_hunt","to":"critic_gate"},{"from":"critic_gate","to":"knowledge_settle"},{"from":"knowledge_settle","to":"__END__"}],"max_loops_per_node":5}', 1, 'active')
ON DUPLICATE KEY UPDATE `status` = 'active';

INSERT INTO `workflow_definitions` (`workflow_type`,`name`,`description`,`definition_json`,`version`,`status`)
VALUES
('legacy', '传统流水线工作流', '兼容旧7阶段流水线的工作流定义', '{"nodes":[{"id":"learn_context","label":"学习上下文","handler":"learn_context","agent":"context_learner"},{"id":"approval_gate","label":"审批门","handler":"approval_gate","agent":"approver","requires_approval":true},{"id":"execute_config","label":"SDK配置","handler":"execute_config","agent":"config_executor"},{"id":"execute_traffic","label":"流量执行","handler":"execute_traffic","agent":"traffic_executor"},{"id":"critic_gate","label":"评审门","handler":"critic_gate","agent":"critic"},{"id":"completed","label":"完成","handler":"completed","agent":"completer"}],"edges":[{"from":"__START__","to":"learn_context"},{"from":"learn_context","to":"approval_gate"},{"from":"approval_gate","to":"execute_config","condition":"nodeResults.approval_gate.output.decision == approved"},{"from":"execute_config","to":"execute_traffic"},{"from":"execute_traffic","to":"critic_gate"},{"from":"critic_gate","to":"completed"},{"from":"completed","to":"__END__"}],"max_loops_per_node":3}', 1, 'active')
ON DUPLICATE KEY UPDATE `status` = 'active';
