CREATE TABLE IF NOT EXISTS `ai_unified_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '任务唯一标识',
  `task_type` enum('case_generation', 'overview_generation', 'key_config_generation', 'report_generation', 'import_optimize', 'other')
    NOT NULL COMMENT '任务类型',
  `user_id` int NOT NULL COMMENT '用户ID',
  `username` varchar(50) DEFAULT NULL COMMENT '用户名',

  `target_type` varchar(50) DEFAULT NULL COMMENT '目标类型(module/level1_point/test_case/report)',
  `target_id` int DEFAULT NULL COMMENT '目标ID',
  `target_name` varchar(255) DEFAULT NULL COMMENT '目标名称',

  `status` enum('pending','processing','completed','failed','cancelled')
    DEFAULT 'pending' COMMENT '任务状态',
  `progress` int DEFAULT 0 COMMENT '进度百分比(0-100)',
  `progress_message` varchar(500) DEFAULT NULL COMMENT '进度描述',

  `config` json DEFAULT NULL COMMENT '任务配置(JSON)',
  `input_data` json DEFAULT NULL COMMENT '输入数据(JSON)',

  `result` longtext COMMENT '执行结果',
  `error_message` text COMMENT '错误信息',
  `error_stack` text COMMENT '错误堆栈',

  `model_name` varchar(100) DEFAULT NULL COMMENT '使用的AI模型',
  `prompt_tokens` int DEFAULT 0 COMMENT '提示词Token数',
  `completion_tokens` int DEFAULT 0 COMMENT '完成Token数',
  `total_tokens` int DEFAULT 0 COMMENT '总Token数',

  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_id` (`task_id`),
  KEY `idx_task_type` (`task_type`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_target` (`target_type`, `target_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_unified_task_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='AI统一任务表';
