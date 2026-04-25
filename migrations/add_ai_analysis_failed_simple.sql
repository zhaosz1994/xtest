-- 简单版本：直接添加字段（如果已存在会报错，可以忽略）
-- 适用于MySQL 5.7+

-- 添加 ai_analysis_failed 字段到 test_reports 表
ALTER TABLE test_reports 
ADD COLUMN IF NOT EXISTS ai_analysis_failed TINYINT(1) DEFAULT 0 
COMMENT 'AI分析是否失败: 0-成功, 1-失败';

-- 如果上面的语句报错（MySQL 5.7不支持IF NOT EXISTS），请使用下面的存储过程方式：
-- 或者直接执行（如果字段已存在会报错，可以忽略）：
-- ALTER TABLE test_reports ADD COLUMN ai_analysis_failed TINYINT(1) DEFAULT 0 COMMENT 'AI分析是否失败: 0-成功, 1-失败';
