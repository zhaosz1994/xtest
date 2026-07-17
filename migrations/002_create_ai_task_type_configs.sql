CREATE TABLE IF NOT EXISTS `ai_task_type_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_type` varchar(50) NOT NULL COMMENT '任务类型',
  `display_name` varchar(100) NOT NULL COMMENT '显示名称',
  `concurrency` int DEFAULT 2 COMMENT '并发数',
  `timeout_ms` int DEFAULT 120000 COMMENT '超时时间(毫秒)',
  `max_retry` int DEFAULT 3 COMMENT '最大重试次数',
  `priority` int DEFAULT 0 COMMENT '优先级(数字越大优先级越高)',
  `is_enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `description` text COMMENT '描述',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_type` (`task_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='AI任务类型配置表';

INSERT INTO `ai_task_type_configs` (`task_type`, `display_name`, `concurrency`, `timeout_ms`, `max_retry`, `priority`, `description`) VALUES
('case_generation', '测试用例生成', 2, 300000, 3, 10, '根据需求文档生成测试用例'),
('overview_generation', '一级测试点概述生成', 3, 120000, 3, 5, '为一级测试点生成概述'),
('key_config_generation', '关键配置生成', 3, 60000, 3, 5, '为测试用例生成关键配置'),
('report_generation', '测试报告生成', 1, 600000, 3, 8, '生成测试报告及AI分析');
