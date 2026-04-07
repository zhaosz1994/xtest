-- ============================================
-- AI操作日志老化策略配置
-- ============================================

-- 查看当前日志统计
SELECT 
  COUNT(*) as total_logs,
  MIN(created_at) as oldest_log,
  MAX(created_at) as newest_log,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
FROM ai_operation_logs;

-- 查看日志按月份分布
SELECT 
  DATE_FORMAT(created_at, '%Y-%m') as month,
  COUNT(*) as log_count,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
FROM ai_operation_logs
GROUP BY DATE_FORMAT(created_at, '%Y-%m')
ORDER BY month DESC;

-- ============================================
-- 自定义老化策略（选择以下方案之一）
-- ============================================

-- 方案1：保留30天（适合高频使用场景）
-- DROP EVENT IF EXISTS clean_old_ai_operation_logs;
-- CREATE EVENT IF NOT EXISTS clean_old_ai_operation_logs
-- ON SCHEDULE EVERY 1 DAY
-- STARTS CURRENT_TIMESTAMP
-- DO
--   DELETE FROM ai_operation_logs 
--   WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 方案2：保留60天（平衡方案）
-- DROP EVENT IF EXISTS clean_old_ai_operation_logs;
-- CREATE EVENT IF NOT EXISTS clean_old_ai_operation_logs
-- ON SCHEDULE EVERY 1 DAY
-- STARTS CURRENT_TIMESTAMP
-- DO
--   DELETE FROM ai_operation_logs 
--   WHERE created_at < DATE_SUB(NOW(), INTERVAL 60 DAY);

-- 方案3：保留180天（长期审计需求）
-- DROP EVENT IF EXISTS clean_old_ai_operation_logs;
-- CREATE EVENT IF NOT EXISTS clean_old_ai_operation_logs
-- ON SCHEDULE EVERY 1 DAY
-- STARTS CURRENT_TIMESTAMP
-- DO
--   DELETE FROM ai_operation_logs 
--   WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY);

-- 方案4：保留365天（年度审计需求）
-- DROP EVENT IF EXISTS clean_old_ai_operation_logs;
-- CREATE EVENT IF NOT EXISTS clean_old_ai_operation_logs
-- ON SCHEDULE EVERY 1 DAY
-- STARTS CURRENT_TIMESTAMP
-- DO
--   DELETE FROM ai_operation_logs 
--   WHERE created_at < DATE_SUB(NOW(), INTERVAL 365 DAY);

-- 方案5：分级老化（保留失败的日志更久）
-- DROP EVENT IF EXISTS clean_old_ai_operation_logs;
-- CREATE EVENT IF NOT EXISTS clean_old_ai_operation_logs
-- ON SCHEDULE EVERY 1 DAY
-- STARTS CURRENT_TIMESTAMP
-- DO
--   BEGIN
--     -- 删除90天前的成功日志
--     DELETE FROM ai_operation_logs 
--     WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
--       AND status = 'success';
--     
--     -- 删除180天前的失败日志
--     DELETE FROM ai_operation_logs 
--     WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)
--       AND status = 'failed';
--   END;

-- ============================================
-- 手动清理日志
-- ============================================

-- 清理30天前的日志
-- DELETE FROM ai_operation_logs 
-- WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 清理特定用户的旧日志
-- DELETE FROM ai_operation_logs 
-- WHERE user_id = ? AND created_at < DATE_SUB(NOW(), INTERVAL 60 DAY);

-- 只保留最近10000条日志
-- DELETE FROM ai_operation_logs 
-- WHERE id NOT IN (
--   SELECT id FROM (
--     SELECT id FROM ai_operation_logs 
--     ORDER BY created_at DESC 
--     LIMIT 10000
--   ) as recent_logs
-- );

-- ============================================
-- 日志归档（可选）
-- ============================================

-- 创建归档表
CREATE TABLE IF NOT EXISTS ai_operation_logs_archive (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  username VARCHAR(100),
  skill_name VARCHAR(100) NOT NULL,
  skill_id INT,
  operation_type VARCHAR(20) NOT NULL,
  sql_query TEXT,
  sql_params TEXT,
  tables_accessed VARCHAR(500),
  result_count INT DEFAULT 0,
  execution_time_ms INT,
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  error_message TEXT,
  ip_address VARCHAR(50),
  user_agent VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at),
  INDEX idx_archived_at (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI操作日志归档表';

-- 归档90天前的日志到归档表
-- INSERT INTO ai_operation_logs_archive
-- SELECT *, NOW() as archived_at
-- FROM ai_operation_logs
-- WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- 归档后删除原表中的数据
-- DELETE FROM ai_operation_logs 
-- WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- ============================================
-- 查看事件调度器状态
-- ============================================

-- 检查事件调度器是否启用
SHOW VARIABLES LIKE 'event_scheduler';

-- 启用事件调度器（如果未启用）
-- SET GLOBAL event_scheduler = ON;

-- 查看所有事件
SHOW EVENTS;

-- 查看特定事件详情
SHOW CREATE EVENT clean_old_ai_operation_logs;

-- 禁用自动清理事件（如果需要）
-- ALTER EVENT clean_old_ai_operation_logs DISABLE;

-- 启用自动清理事件
-- ALTER EVENT clean_old_ai_operation_logs ENABLE;

-- 删除自动清理事件
-- DROP EVENT IF EXISTS clean_old_ai_operation_logs;
