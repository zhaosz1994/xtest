-- V2.1 Traffic Agent 与 SDK CLI Agent 双智能体自测试框架
-- 仅新增表/索引/种子数据，不删除或覆盖现有数据

CREATE TABLE IF NOT EXISTS `agent_registry` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `agent_id` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `role` VARCHAR(128) NOT NULL,
  `version` VARCHAR(64) DEFAULT 'v1',
  `description` TEXT,
  `allowed_tools` JSON,
  `allowed_envs` JSON,
  `allowed_modes` JSON,
  `allowed_modules` JSON,
  `requires_approval_for` JSON,
  `default_safety_policy` JSON,
  `status` VARCHAR(32) NOT NULL DEFAULT 'online',
  `metrics` JSON,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_registry_agent_id` (`agent_id`),
  KEY `idx_agent_registry_status` (`status`),
  KEY `idx_agent_registry_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_tasks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` VARCHAR(128) NOT NULL,
  `created_by` BIGINT,
  `project_id` BIGINT,
  `module_id` BIGINT,
  `module_name` VARCHAR(128),
  `chip_version_id` BIGINT,
  `chip_version` VARCHAR(128),
  `target_env` VARCHAR(128),
  `mode` VARCHAR(32) NOT NULL DEFAULT 'dry_run',
  `objective` TEXT NOT NULL,
  `agents` JSON,
  `status` VARCHAR(64) NOT NULL DEFAULT 'draft',
  `approval_required` TINYINT(1) NOT NULL DEFAULT 0,
  `approval_status` VARCHAR(32) DEFAULT 'not_required',
  `lease_id` VARCHAR(128),
  `shared_state` JSON,
  `artifacts` JSON,
  `verdict` JSON,
  `knowledge_snapshot` VARCHAR(128),
  `metadata` JSON,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_tasks_task_id` (`task_id`),
  KEY `idx_agent_tasks_created_by` (`created_by`),
  KEY `idx_agent_tasks_status` (`status`),
  KEY `idx_agent_tasks_module` (`module_id`),
  KEY `idx_agent_tasks_chip_version` (`chip_version_id`),
  KEY `idx_agent_tasks_lease` (`lease_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_session` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(128) NOT NULL,
  `task_id` VARCHAR(128) NOT NULL,
  `test_id` VARCHAR(128),
  `user_id` BIGINT,
  `module` VARCHAR(128),
  `chip_version` VARCHAR(128),
  `chip_version_id` BIGINT,
  `target_env` VARCHAR(128),
  `mode` VARCHAR(32) DEFAULT 'dry_run',
  `phase` VARCHAR(64) DEFAULT 'IDLE',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `lease_id` VARCHAR(128),
  `workspace_path` TEXT,
  `knowledge_snapshot` VARCHAR(128),
  `shared_state` JSON,
  `started_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `ended_at` DATETIME NULL,
  `created_by` VARCHAR(64),
  `metadata` JSON,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_session_session_id` (`session_id`),
  KEY `idx_agent_session_task_id` (`task_id`),
  KEY `idx_agent_session_user_id` (`user_id`),
  KEY `idx_agent_session_status` (`status`),
  KEY `idx_agent_session_lease` (`lease_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(128) NOT NULL,
  `task_id` VARCHAR(128),
  `event_type` VARCHAR(64) NOT NULL,
  `sender_agent` VARCHAR(128),
  `receiver_agent` VARCHAR(128),
  `phase` VARCHAR(64),
  `payload` JSON,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_agent_events_session` (`session_id`),
  KEY `idx_agent_events_task` (`task_id`),
  KEY `idx_agent_events_type` (`event_type`),
  KEY `idx_agent_events_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cli_command_trace` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(128) NOT NULL,
  `task_id` VARCHAR(128),
  `lease_id` VARCHAR(128),
  `command_index` INT NOT NULL,
  `command_text` TEXT NOT NULL,
  `stdout_path` TEXT,
  `stderr_path` TEXT,
  `parsed_result` JSON,
  `status` VARCHAR(32),
  `error_signature` VARCHAR(256),
  `evidence_refs` JSON,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cli_command_session` (`session_id`),
  KEY `idx_cli_command_task` (`task_id`),
  KEY `idx_cli_command_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `traffic_run_trace` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(128) NOT NULL,
  `task_id` VARCHAR(128),
  `lease_id` VARCHAR(128),
  `run_id` VARCHAR(128) NOT NULL,
  `sdkctp_script_path` TEXT,
  `flow_spec_path` TEXT,
  `pcap_path` TEXT,
  `stats` JSON,
  `status` VARCHAR(32),
  `failure_signature` VARCHAR(256),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_traffic_run_id` (`run_id`),
  KEY `idx_traffic_run_session` (`session_id`),
  KEY `idx_traffic_run_task` (`task_id`),
  KEY `idx_traffic_run_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE traffic_run_trace ADD COLUMN created_by BIGINT NULL;
CREATE INDEX idx_traffic_run_created_by ON traffic_run_trace(created_by);

CREATE TABLE IF NOT EXISTS `env_resource` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `resource_id` VARCHAR(128) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(256),
  `status` VARCHAR(32) NOT NULL DEFAULT 'idle',
  `capabilities` JSON,
  `supported_chip_versions` JSON,
  `supported_modules` JSON,
  `connection_profiles` JSON,
  `risk_level` VARCHAR(32) DEFAULT 'medium',
  `current_lease_id` VARCHAR(128),
  `metadata` JSON,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_env_resource_resource_id` (`resource_id`),
  KEY `idx_env_resource_type` (`resource_type`),
  KEY `idx_env_resource_status` (`status`),
  KEY `idx_env_resource_risk` (`risk_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `env_resource_lease` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `lease_id` VARCHAR(128) NOT NULL,
  `resource_id` VARCHAR(128) NOT NULL,
  `resource_type` VARCHAR(64),
  `owner_user` VARCHAR(128) NOT NULL,
  `owner_user_id` BIGINT,
  `task_id` VARCHAR(128) NOT NULL,
  `module` VARCHAR(128),
  `chip_version` VARCHAR(128),
  `mode` VARCHAR(32),
  `lease_status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `acquired_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `released_at` DATETIME NULL,
  `cleanup_status` VARCHAR(32),
  `bound_resources` JSON,
  `auto_extend_policy` VARCHAR(64),
  `cleanup_policy` VARCHAR(64),
  `metadata` JSON,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_env_resource_lease_id` (`lease_id`),
  KEY `idx_env_lease_resource` (`resource_id`),
  KEY `idx_env_lease_owner` (`owner_user_id`),
  KEY `idx_env_lease_task` (`task_id`),
  KEY `idx_env_lease_status` (`lease_status`),
  KEY `idx_env_lease_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `env_resource_queue` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `queue_id` VARCHAR(128) NOT NULL,
  `task_id` VARCHAR(128) NOT NULL,
  `user_id` VARCHAR(128) NOT NULL,
  `resource_id` VARCHAR(128),
  `resource_requirements` JSON,
  `priority` INT DEFAULT 50,
  `queue_status` VARCHAR(32) DEFAULT 'queued',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `scheduled_at` DATETIME NULL,
  `metadata` JSON,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_env_resource_queue_id` (`queue_id`),
  KEY `idx_env_queue_resource` (`resource_id`),
  KEY `idx_env_queue_status` (`queue_status`),
  KEY `idx_env_queue_priority` (`priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bug_method_cards` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `bug_id` VARCHAR(128) NOT NULL,
  `title` VARCHAR(512) NOT NULL,
  `chip_versions` JSON,
  `module` VARCHAR(128),
  `submodules` JSON,
  `target_envs` JSON,
  `severity` VARCHAR(32),
  `root_cause` TEXT,
  `trigger_conditions` JSON,
  `test_methods` JSON,
  `related_test_points` JSON,
  `recommended_test_content` JSON,
  `coverage_gap_implication` TEXT,
  `evidence_refs` JSON,
  `status` VARCHAR(32) DEFAULT 'draft',
  `created_by` BIGINT,
  `reviewer_id` BIGINT,
  `reviewed_at` DATETIME NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bug_method_cards_bug_id` (`bug_id`),
  KEY `idx_bug_method_cards_module` (`module`),
  KEY `idx_bug_method_cards_severity` (`severity`),
  KEY `idx_bug_method_cards_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bug_test_gap_reports` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `report_id` VARCHAR(128) NOT NULL,
  `module` VARCHAR(128) NOT NULL,
  `chip_version` VARCHAR(128),
  `existing_test_points` JSON,
  `bug_derived_required_points` JSON,
  `missing_test_points` JSON,
  `recommended_actions` JSON,
  `risk_summary` TEXT,
  `status` VARCHAR(32) DEFAULT 'open',
  `created_by` BIGINT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bug_gap_report_id` (`report_id`),
  KEY `idx_bug_gap_module` (`module`),
  KEY `idx_bug_gap_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bug_method_cards ADD COLUMN module_id BIGINT NULL;
CREATE INDEX idx_bug_method_cards_module_id ON bug_method_cards(module_id);

CREATE TABLE IF NOT EXISTS `agent_audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `audit_id` VARCHAR(128) NOT NULL,
  `audit_type` VARCHAR(128) NOT NULL,
  `task_id` VARCHAR(128),
  `session_id` VARCHAR(128),
  `lease_id` VARCHAR(128),
  `resource_id` VARCHAR(128),
  `user_id` BIGINT,
  `module` VARCHAR(128),
  `mode` VARCHAR(32),
  `verdict` VARCHAR(32),
  `payload` JSON,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_audit_id` (`audit_id`),
  KEY `idx_agent_audit_task` (`task_id`),
  KEY `idx_agent_audit_user` (`user_id`),
  KEY `idx_agent_audit_type` (`audit_type`),
  KEY `idx_agent_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO agent_registry
(agent_id, display_name, role, version, description, allowed_tools, allowed_envs, allowed_modes, requires_approval_for, default_safety_policy, status, metrics)
VALUES
('traffic_agent_v1', 'Traffic Agent / SdkCTP Agent', 'packet_generation_and_traffic_execution', 'v1', '基于 SdkCTP 生成报文模板、flow spec、打流计划、统计和 pcap 分析。', JSON_ARRAY('traffic_tool_service', 'pcap_analyzer', 'ixia_adapter'), JSON_ARRAY('CModel', 'FPGA', 'EDA_Accelerator'), JSON_ARRAY('advisory', 'generation', 'dry_run', 'execute'), JSON_ARRAY('pause_storm', 'line_rate_traffic', 'error_packet_injection'), JSON_OBJECT('max_rate_percent', 90, 'max_duration_sec', 300, 'requires_lease_for_execute', true), 'online', JSON_OBJECT('success_rate', 0, 'failure_rate', 0, 'avg_duration_sec', 0)),
('sdk_cli_agent_v1', 'SDK CLI Agent / Config Agent', 'sdk_cli_configuration_and_observation', 'v1', '生成和执行 SDK CLI 命令计划，管理 snapshot、counter 查询、diff 和 rollback。', JSON_ARRAY('sdk_cli_tool_service', 'counter_parser', 'snapshot_diff'), JSON_ARRAY('CModel', 'FPGA', 'EDA_Accelerator'), JSON_ARRAY('advisory', 'generation', 'dry_run', 'execute'), JSON_ARRAY('reset_chip', 'erase_flash', 'reboot_board', 'global_destructive_config'), JSON_OBJECT('denylist', JSON_ARRAY('reset chip', 'erase flash', 'reboot board'), 'require_snapshot_before_config', true, 'require_lease_for_execute', true), 'online', JSON_OBJECT('success_rate', 0, 'failure_rate', 0, 'avg_duration_sec', 0)),
('critic_agent_v1', 'Critic Agent', 'safety_evidence_and_plan_review', 'v1', '审查配置与流量一致性、环境能力、资源锁、可回滚性和证据链。', JSON_ARRAY('evidence_checker', 'policy_gate'), JSON_ARRAY('CModel', 'FPGA', 'EDA_Accelerator'), JSON_ARRAY('advisory', 'generation', 'dry_run', 'execute', 'autonomous'), JSON_ARRAY(), JSON_OBJECT('block_without_evidence', true), 'online', JSON_OBJECT('success_rate', 0, 'failure_rate', 0, 'avg_duration_sec', 0));

INSERT IGNORE INTO env_resource
(resource_id, resource_type, display_name, status, capabilities, supported_chip_versions, supported_modules, connection_profiles, risk_level, metadata)
VALUES
('CMODEL_INSTANCE_01', 'CMODEL_INSTANCE', 'CModel instance 01', 'idle', JSON_ARRAY('sdk_cli', 'traffic', 'counter', 'packet_trace'), JSON_ARRAY('Switch_Gen1', 'Switch_Gen2', 'Switch_Gen3', 'Switch_Gen3_RevB'), JSON_ARRAY('PFC', 'MMU', 'ACL', 'L2', 'Telemetry'), JSON_OBJECT('sdk_cli', 'cmodel://instance01/sdk_cli', 'traffic', 'cmodel://instance01/injector'), 'low', JSON_OBJECT('pool', 'default')),
('CMODEL_INSTANCE_02', 'CMODEL_INSTANCE', 'CModel instance 02', 'idle', JSON_ARRAY('sdk_cli', 'traffic', 'counter', 'packet_trace'), JSON_ARRAY('Switch_Gen1', 'Switch_Gen2', 'Switch_Gen3', 'Switch_Gen3_RevB'), JSON_ARRAY('PFC', 'MMU', 'ACL', 'L2', 'Telemetry'), JSON_OBJECT('sdk_cli', 'cmodel://instance02/sdk_cli', 'traffic', 'cmodel://instance02/injector'), 'low', JSON_OBJECT('pool', 'default')),
('FPGA_BOARD_03', 'FPGA_BOARD', 'FPGA board 03 - Gen3 RevB', 'idle', JSON_ARRAY('sdk_cli', 'traffic', 'counter', 'pcap'), JSON_ARRAY('Switch_Gen3', 'Switch_Gen3_RevB'), JSON_ARRAY('PFC', 'MMU', 'ACL', 'Telemetry'), JSON_OBJECT('sdk_cli', 'ssh://fpga03/sdk_cli', 'traffic', 'ixia://chassis1/ports/1/1,1/2'), 'high', JSON_OBJECT('requires_approval', true)),
('EDA_PARTITION_02', 'EDA_ACCEL_PARTITION', 'EDA accelerator partition 02', 'idle', JSON_ARRAY('sdk_cli', 'traffic', 'waveform', 'checkpoint'), JSON_ARRAY('Switch_Gen2', 'Switch_Gen3', 'Switch_Gen3_RevB'), JSON_ARRAY('PFC', 'MMU', 'ACL', 'L2'), JSON_OBJECT('sdk_cli', 'eda://partition02/sdk_shell', 'traffic', 'eda://partition02/transactor'), 'high', JSON_OBJECT('supports_reservation', true));
