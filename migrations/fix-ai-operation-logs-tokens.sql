-- ============================================
-- 修复 ai_operation_logs 表结构 (MySQL 5.x 兼容版)
-- 添加缺失的 token 统计字段
-- ============================================

-- 1. 检查并添加 prompt_tokens 字段
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
      AND table_name = 'ai_operation_logs' 
      AND column_name = 'prompt_tokens'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE ai_operation_logs ADD COLUMN prompt_tokens INT DEFAULT 0 COMMENT ''提示词token数'' AFTER execution_time_ms',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. 检查并添加 completion_tokens 字段
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
      AND table_name = 'ai_operation_logs' 
      AND column_name = 'completion_tokens'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE ai_operation_logs ADD COLUMN completion_tokens INT DEFAULT 0 COMMENT ''完成token数'' AFTER prompt_tokens',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. 检查并添加 total_tokens 字段
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
      AND table_name = 'ai_operation_logs' 
      AND column_name = 'total_tokens'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE ai_operation_logs ADD COLUMN total_tokens INT DEFAULT 0 COMMENT ''总token数'' AFTER completion_tokens',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. 检查并添加 model_name 字段
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
      AND table_name = 'ai_operation_logs' 
      AND column_name = 'model_name'
);

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE ai_operation_logs ADD COLUMN model_name VARCHAR(100) COMMENT ''使用的AI模型名称'' AFTER total_tokens',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 验证表结构
DESCRIBE ai_operation_logs;

SELECT '✓ ai_operation_logs 表结构修复完成！' as status;
