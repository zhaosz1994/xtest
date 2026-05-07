-- AI辅助导入优化系统 - 数据库迁移脚本
-- 版本: v1.0
-- 日期: 2026/05/07

-- 1. AI导入优化任务表
CREATE TABLE IF NOT EXISTS `ai_import_optimize_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '任务唯一标识(IMP-OPT-YYYYMMDD-xxxx)',
  `import_batch_id` varchar(50) DEFAULT NULL COMMENT '关联的导入批次ID',
  `library_id` int NOT NULL COMMENT '目标用例库ID',
  `module_id` int DEFAULT NULL COMMENT '目标模块ID',
  `user_id` int NOT NULL COMMENT '发起用户ID',
  `username` varchar(50) DEFAULT NULL COMMENT '用户名',
  `status` enum('pending','processing','completed','failed','cancelled') DEFAULT 'pending' COMMENT '任务状态',
  `progress` int DEFAULT 0 COMMENT '进度百分比(0-100)',
  `progress_message` varchar(500) DEFAULT NULL COMMENT '进度描述',
  `total_cases` int DEFAULT 0 COMMENT '待优化的用例总数',
  `total_batches` int DEFAULT 0 COMMENT '切分批次数',
  `processed_batches` int DEFAULT 0 COMMENT '已处理批次数',
  `optimized_cases` int DEFAULT 0 COMMENT '成功优化的用例数',
  `failed_cases` int DEFAULT 0 COMMENT '优化失败的用例数',
  `agent_code` varchar(100) DEFAULT 'case_import_optimizer' COMMENT '使用的Agent编码',
  `llm_model` varchar(100) DEFAULT NULL COMMENT '使用的LLM模型',
  `config` json DEFAULT NULL COMMENT '优化配置(JSON)',
  `source_file_name` varchar(255) DEFAULT NULL COMMENT '源文件名',
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始处理时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `error_message` text COMMENT '错误信息',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_id` (`task_id`),
  KEY `idx_library_id` (`library_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI导入优化任务表';

-- 2. AI导入优化批次表
CREATE TABLE IF NOT EXISTS `ai_import_optimize_batches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '关联的任务ID',
  `batch_index` int NOT NULL COMMENT '批次序号(从0开始)',
  `case_count` int NOT NULL COMMENT '本批次用例数',
  `status` enum('pending','processing','completed','failed') DEFAULT 'pending' COMMENT '批次状态',
  `input_data` json NOT NULL COMMENT '输入用例数据(JSON数组)',
  `output_data` json DEFAULT NULL COMMENT 'AI优化结果(JSON数组)',
  `token_input` int DEFAULT 0 COMMENT '输入Token数',
  `token_output` int DEFAULT 0 COMMENT '输出Token数',
  `llm_model` varchar(100) DEFAULT NULL COMMENT '使用的模型',
  `retry_count` int DEFAULT 0 COMMENT '重试次数',
  `error_message` text COMMENT '错误信息',
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_optimize_batch_task` FOREIGN KEY (`task_id`) REFERENCES `ai_import_optimize_tasks` (`task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI导入优化批次表';

-- 3. 导入用例映射表
CREATE TABLE IF NOT EXISTS `ai_import_case_mapping` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '关联的优化任务ID',
  `formal_case_id` int NOT NULL COMMENT '正式用例ID(test_cases.id)',
  `formal_case_name` varchar(500) DEFAULT NULL COMMENT '正式用例名称(冗余)',
  `temp_case_id` varchar(50) DEFAULT NULL COMMENT 'AI优化后的临时用例ID',
  `batch_index` int DEFAULT NULL COMMENT '所属批次序号',
  `status` enum('pending','optimized','approved','rejected','merged','merge_failed') DEFAULT 'pending' COMMENT '映射状态',
  `optimization_notes` text COMMENT 'AI优化说明',
  `field_changes` json DEFAULT NULL COMMENT '字段变更详情(JSON: {field: {old, new}})',
  `merged_at` timestamp NULL DEFAULT NULL COMMENT '覆盖合并时间',
  `merged_by` int DEFAULT NULL COMMENT '合并操作人ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_formal_case_id` (`formal_case_id`),
  KEY `idx_temp_case_id` (`temp_case_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_mapping_task` FOREIGN KEY (`task_id`) REFERENCES `ai_import_optimize_tasks` (`task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='导入用例与AI优化结果映射表';

-- 4. temp_test_cases 新增字段
ALTER TABLE `temp_test_cases`
  ADD COLUMN `source_type` enum('ai_generation','import_optimize') DEFAULT 'ai_generation' COMMENT '来源类型' AFTER `task_id`,
  ADD COLUMN `source_task_id` varchar(50) DEFAULT NULL COMMENT '来源任务ID' AFTER `source_type`,
  ADD COLUMN `formal_case_id` int DEFAULT NULL COMMENT '关联的正式用例ID' AFTER `source_task_id`,
  ADD COLUMN `field_changes` json DEFAULT NULL COMMENT '字段变更详情' AFTER `formal_case_id`;

ALTER TABLE `temp_test_cases`
  ADD KEY `idx_source_type` (`source_type`),
  ADD KEY `idx_source_task_id` (`source_task_id`),
  ADD KEY `idx_formal_case_id` (`formal_case_id`);
