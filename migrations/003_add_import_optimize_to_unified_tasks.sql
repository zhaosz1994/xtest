ALTER TABLE `ai_unified_tasks`
  MODIFY COLUMN `task_type` enum('case_generation', 'overview_generation', 'key_config_generation', 'report_generation', 'import_optimize', 'other')
  NOT NULL COMMENT '任务类型';

INSERT INTO `ai_task_type_configs` (`task_type`, `display_name`, `concurrency`, `timeout_ms`, `max_retry`, `priority`, `description`)
VALUES
  ('import_optimize', 'AI导入优化', 2, 300000, 3, 5, '对导入的测试用例进行AI优化')
ON DUPLICATE KEY UPDATE `display_name` = VALUES(`display_name`);
