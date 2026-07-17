-- 智能交换芯片自适应测试系统增量迁移
-- 日期: 2026-06-30

CREATE TABLE IF NOT EXISTS `chip_versions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `version_key` VARCHAR(64) NOT NULL COMMENT '芯片代系唯一标识，如 Switch_Gen1',
  `name` VARCHAR(128) NOT NULL COMMENT '芯片代系显示名称',
  `generation_order` INT DEFAULT 0 COMMENT '代系顺序，用于继承和兼容判断',
  `parent_id` INT DEFAULT NULL COMMENT '继承自上一代芯片版本',
  `status` VARCHAR(32) DEFAULT 'active' COMMENT 'active|deprecated|draft',
  `description` TEXT,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chip_versions_key` (`version_key`),
  KEY `idx_chip_versions_parent` (`parent_id`),
  KEY `idx_chip_versions_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='芯片代系/版本表';

CREATE TABLE IF NOT EXISTS `chip_registers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `chip_version_id` INT DEFAULT NULL COMMENT 'NULL 表示通用寄存器定义',
  `source_file_id` INT DEFAULT NULL COMMENT '来源 SVD/XML 文件ID',
  `peripheral_name` VARCHAR(128) NOT NULL,
  `register_name` VARCHAR(128) NOT NULL,
  `base_address` BIGINT UNSIGNED DEFAULT NULL,
  `address_offset` BIGINT UNSIGNED DEFAULT NULL,
  `absolute_address` BIGINT UNSIGNED DEFAULT NULL,
  `description` TEXT,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chip_register_source` (`chip_version_id`, `source_file_id`, `peripheral_name`, `register_name`, `address_offset`),
  KEY `idx_chip_register_chip` (`chip_version_id`),
  KEY `idx_chip_register_name` (`register_name`),
  KEY `idx_chip_register_abs_addr` (`absolute_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='芯片寄存器映射表';

CREATE TABLE IF NOT EXISTS `chip_register_fields` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `register_id` INT NOT NULL,
  `field_name` VARCHAR(128) NOT NULL,
  `bit_offset` INT DEFAULT NULL,
  `bit_width` INT DEFAULT NULL,
  `lsb` INT DEFAULT NULL,
  `msb` INT DEFAULT NULL,
  `access` VARCHAR(32) DEFAULT NULL,
  `description` TEXT,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_register_field` (`register_id`, `field_name`, `bit_offset`, `bit_width`),
  KEY `idx_register_fields_register` (`register_id`),
  KEY `idx_register_fields_name` (`field_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='芯片寄存器字段表';

CREATE TABLE IF NOT EXISTS `sdk_api_symbols` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `chip_version_id` INT DEFAULT NULL COMMENT 'NULL 表示通用 SDK 符号',
  `file_id` INT DEFAULT NULL COMMENT '来源 C/H/CPP 文件ID',
  `symbol_type` VARCHAR(32) NOT NULL COMMENT 'macro|function|struct|enum',
  `name` VARCHAR(255) NOT NULL,
  `signature` TEXT,
  `namespace` VARCHAR(255) DEFAULT NULL,
  `source_location` VARCHAR(255) DEFAULT NULL,
  `content` TEXT,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sdk_symbol_file` (`file_id`, `symbol_type`, `name`),
  KEY `idx_sdk_symbol_chip` (`chip_version_id`),
  KEY `idx_sdk_symbol_type_name` (`symbol_type`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SDK API 符号索引表';

CREATE TABLE IF NOT EXISTS `evidence_links` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `target_type` VARCHAR(64) NOT NULL COMMENT 'level1_point|test_case|tcl_task|ai_task|adaptive_task 等',
  `target_id` VARCHAR(100) NOT NULL,
  `evidence_type` VARCHAR(64) NOT NULL COMMENT 'register_map|register_field|sdk_api|bug_rag|knowledge_chunk|execution_experience 等',
  `evidence_table` VARCHAR(64) DEFAULT NULL,
  `evidence_id` VARCHAR(100) DEFAULT NULL,
  `evidence_title` VARCHAR(255) DEFAULT NULL,
  `evidence_excerpt` TEXT,
  `confidence` DECIMAL(5,4) DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_by` INT DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_evidence_target` (`target_type`, `target_id`),
  KEY `idx_evidence_ref` (`evidence_type`, `evidence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='自适应生成证据链表';

CREATE TABLE IF NOT EXISTS `bug_rag_entries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `chip_version_id` INT DEFAULT NULL,
  `module_id` INT DEFAULT NULL,
  `library_id` INT DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `symptom` TEXT,
  `root_cause` TEXT,
  `fix_suggestion` TEXT,
  `status` VARCHAR(32) DEFAULT 'candidate' COMMENT 'candidate|approved|rejected',
  `source_type` VARCHAR(64) DEFAULT NULL,
  `source_ref` VARCHAR(255) DEFAULT NULL,
  `reviewer_id` INT DEFAULT NULL,
  `reviewed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_by` INT DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bug_rag_status` (`status`),
  KEY `idx_bug_rag_chip` (`chip_version_id`),
  KEY `idx_bug_rag_module` (`module_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Bug-RAG 候选和审核知识表';

CREATE TABLE IF NOT EXISTS `execution_environments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `env_key` VARCHAR(64) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `env_type` VARCHAR(64) DEFAULT NULL COMMENT 'simulation|fpga|silicon|unit_test',
  `runner_url` VARCHAR(500) DEFAULT NULL,
  `default_timeout_sec` INT DEFAULT 300,
  `description` TEXT,
  `metadata` JSON DEFAULT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_execution_env_key` (`env_key`),
  KEY `idx_execution_env_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='脚本执行环境配置表';

CREATE TABLE IF NOT EXISTS `script_execution_runs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `task_id` VARCHAR(100) DEFAULT NULL,
  `execution_env_id` INT DEFAULT NULL,
  `status` VARCHAR(32) DEFAULT 'pending',
  `exit_code` INT DEFAULT NULL,
  `stdout` MEDIUMTEXT,
  `stderr` MEDIUMTEXT,
  `started_at` TIMESTAMP NULL DEFAULT NULL,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  `duration_ms` INT DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_script_runs_task` (`task_id`),
  KEY `idx_script_runs_env` (`execution_env_id`),
  KEY `idx_script_runs_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='脚本执行记录表';

ALTER TABLE module_knowledge_files ADD COLUMN chip_version_id INT NULL COMMENT '关联芯片代系，NULL 表示通用';
ALTER TABLE module_knowledge_files ADD COLUMN file_category VARCHAR(50) DEFAULT 'design' COMMENT '知识文件分类';
ALTER TABLE module_knowledge_files ADD COLUMN chunking_strategy VARCHAR(50) DEFAULT 'structure_aware' COMMENT '文件切分策略';
ALTER TABLE ai_material_chunks ADD COLUMN chip_version_id INT NULL COMMENT '关联芯片代系，NULL 表示通用';
ALTER TABLE ai_material_chunks ADD COLUMN embedding JSON DEFAULT NULL COMMENT '文本向量，用于RAG向量检索';
ALTER TABLE ai_material_chunks ADD COLUMN file_category VARCHAR(50) DEFAULT 'design' COMMENT '来源文件分类';
ALTER TABLE ai_material_chunks ADD COLUMN chunking_strategy VARCHAR(50) DEFAULT 'structure_aware' COMMENT '切分/知识策略';
ALTER TABLE ai_material_chunks ADD COLUMN chunk_type ENUM('parent','child','normal') DEFAULT 'normal' COMMENT '块类型';
ALTER TABLE ai_material_chunks ADD COLUMN parent_chunk_id INT DEFAULT NULL COMMENT '父块ID';
ALTER TABLE ai_material_chunks ADD COLUMN metadata JSON DEFAULT NULL COMMENT '扩展元数据';
ALTER TABLE ai_material_chunks ADD COLUMN library_id INT DEFAULT NULL COMMENT '用例库ID';
ALTER TABLE level1_points ADD COLUMN chip_version_id INT NULL COMMENT '关联芯片代系，NULL 表示通用';
ALTER TABLE test_cases ADD COLUMN chip_version_id INT NULL COMMENT '关联芯片代系，NULL 表示通用';
ALTER TABLE tcl_generation_tasks ADD COLUMN chip_version_id INT NULL COMMENT '关联芯片代系，NULL 表示通用';
ALTER TABLE tcl_generation_tasks ADD COLUMN execution_env_id INT NULL COMMENT '脚本执行环境ID';
ALTER TABLE ai_case_generation_tasks ADD COLUMN chip_version_id INT NULL COMMENT '关联芯片代系，NULL 表示通用';

CREATE INDEX idx_knowledge_files_chip_version ON module_knowledge_files(chip_version_id);
CREATE INDEX idx_knowledge_files_category_chip ON module_knowledge_files(file_category, chip_version_id);
CREATE INDEX idx_chunks_chip_version ON ai_material_chunks(chip_version_id);
CREATE INDEX idx_chunks_file_category_chip ON ai_material_chunks(file_category, chip_version_id);
CREATE INDEX idx_chunks_chunking_strategy ON ai_material_chunks(chunking_strategy);
CREATE INDEX idx_chunks_parent_chunk_id ON ai_material_chunks(parent_chunk_id);
CREATE FULLTEXT INDEX ft_chunks_content ON ai_material_chunks(chunk_content);
CREATE INDEX idx_level1_chip_version ON level1_points(chip_version_id);
CREATE INDEX idx_test_cases_chip_version ON test_cases(chip_version_id);
CREATE INDEX idx_tcl_tasks_chip_version ON tcl_generation_tasks(chip_version_id);
CREATE INDEX idx_tcl_tasks_execution_env ON tcl_generation_tasks(execution_env_id);
CREATE INDEX idx_ai_case_tasks_chip_version ON ai_case_generation_tasks(chip_version_id);

INSERT IGNORE INTO chip_versions (version_key, name, generation_order, parent_id, description) VALUES ('Switch_Gen1', 'Switch Gen1', 1, NULL, '第一代智能交换芯片');
INSERT IGNORE INTO chip_versions (version_key, name, generation_order, parent_id, description) VALUES ('Switch_Gen2', 'Switch Gen2', 2, (SELECT id FROM (SELECT id FROM chip_versions WHERE version_key = 'Switch_Gen1' LIMIT 1) tmp_gen1), '第二代智能交换芯片，继承 Gen1');
INSERT IGNORE INTO chip_versions (version_key, name, generation_order, parent_id, description) VALUES ('Switch_Gen3', 'Switch Gen3', 3, (SELECT id FROM (SELECT id FROM chip_versions WHERE version_key = 'Switch_Gen2' LIMIT 1) tmp_gen2), '第三代智能交换芯片，继承 Gen2');
INSERT IGNORE INTO chip_versions (version_key, name, generation_order, parent_id, description) VALUES ('Switch_Gen3_RevB', 'Switch Gen3 RevB', 4, (SELECT id FROM (SELECT id FROM chip_versions WHERE version_key = 'Switch_Gen3' LIMIT 1) tmp_gen3), '第三代 RevB 修订版');

INSERT IGNORE INTO execution_environments (env_key, name, env_type, default_timeout_sec, description) VALUES ('xcelium_sim', 'Xcelium 仿真环境', 'simulation', 600, 'Cadence Xcelium 仿真执行环境');
INSERT IGNORE INTO execution_environments (env_key, name, env_type, default_timeout_sec, description) VALUES ('vcs_sim', 'VCS 仿真环境', 'simulation', 600, 'Synopsys VCS 仿真执行环境');
INSERT IGNORE INTO execution_environments (env_key, name, env_type, default_timeout_sec, description) VALUES ('fpga_lab', 'FPGA 实验室', 'fpga', 900, 'FPGA 板级验证环境');
INSERT IGNORE INTO execution_environments (env_key, name, env_type, default_timeout_sec, description) VALUES ('silicon_bringup', '硅片 Bring-up', 'silicon', 1200, '真实硅片 Bring-up 环境');
INSERT IGNORE INTO execution_environments (env_key, name, env_type, default_timeout_sec, description) VALUES ('sdk_unit_test', 'SDK 单元测试', 'unit_test', 300, 'SDK API 单元测试执行环境');
