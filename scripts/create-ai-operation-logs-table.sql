-- ============================================
-- AI操作审计日志表
-- 用途：记录所有AI技能的数据库操作，用于安全审计和追溯
-- ============================================

CREATE TABLE IF NOT EXISTS ai_operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
  user_id INT NOT NULL COMMENT '用户ID',
  username VARCHAR(100) COMMENT '用户名',
  skill_name VARCHAR(100) NOT NULL COMMENT '技能名称',
  skill_id INT COMMENT '技能ID',
  operation_type VARCHAR(20) NOT NULL COMMENT '操作类型（SELECT）',
  sql_query TEXT COMMENT '执行的SQL语句',
  sql_params TEXT COMMENT 'SQL参数（JSON格式）',
  tables_accessed VARCHAR(500) COMMENT '访问的表（逗号分隔）',
  result_count INT DEFAULT 0 COMMENT '返回结果数量',
  execution_time_ms INT COMMENT '执行耗时（毫秒）',
  status VARCHAR(20) NOT NULL DEFAULT 'success' COMMENT '执行状态（success/failed）',
  error_message TEXT COMMENT '错误信息',
  ip_address VARCHAR(50) COMMENT 'IP地址',
  user_agent VARCHAR(500) COMMENT '用户代理',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  
  INDEX idx_user_id (user_id),
  INDEX idx_skill_name (skill_name),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_operation_type (operation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI操作审计日志表';

-- 创建定期清理旧日志的事件（保留最近90天的日志）
-- 注意：需要先启用事件调度器 SET GLOBAL event_scheduler = ON;

DROP EVENT IF EXISTS clean_old_ai_operation_logs;

CREATE EVENT IF NOT EXISTS clean_old_ai_operation_logs
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
DO
  DELETE FROM ai_operation_logs 
  WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- 查询最近的AI操作日志
-- SELECT * FROM ai_operation_logs ORDER BY created_at DESC LIMIT 100;

-- 查询特定用户的操作日志
-- SELECT * FROM ai_operation_logs WHERE user_id = ? ORDER BY created_at DESC;

-- 查询失败的AI操作
-- SELECT * FROM ai_operation_logs WHERE status = 'failed' ORDER BY created_at DESC;

-- 统计AI技能使用频率
-- SELECT skill_name, COUNT(*) as usage_count 
-- FROM ai_operation_logs 
-- GROUP BY skill_name 
-- ORDER BY usage_count DESC;

-- 统计用户AI使用频率
-- SELECT user_id, username, COUNT(*) as usage_count 
-- FROM ai_operation_logs 
-- GROUP BY user_id, username 
-- ORDER BY usage_count DESC;
