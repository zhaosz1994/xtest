-- ============================================
-- AI只读数据库用户配置脚本
-- 用途：创建专用的AI只读用户，限制AI技能只能执行SELECT操作
-- ============================================

-- 1. 创建AI只读用户
-- 注意：请在执行前修改密码为强密码
CREATE USER IF NOT EXISTS 'ai_readonly'@'%' IDENTIFIED BY 'AI_Readonly_2026_Secure!';

-- 2. 撤销所有现有权限（确保干净状态）
REVOKE ALL PRIVILEGES ON *.* FROM 'ai_readonly'@'%';

-- 3. 授予指定数据库的SELECT权限
-- 请将 'xtest' 替换为你的实际数据库名
GRANT SELECT ON xtest.* TO 'ai_readonly'@'%';

-- 4. 授予指定表的SELECT权限（更严格的表级权限控制）
-- 如果需要更细粒度的控制，可以注释掉上面的GRANT SELECT ON xtest.*，使用下面的表级授权

-- 允许访问的表（白名单）
-- GRANT SELECT ON xtest.test_cases TO 'ai_readonly'@'%';
-- GRANT SELECT ON xtest.test_plans TO 'ai_readonly'@'%';
-- GRANT SELECT ON xtest.test_reports TO 'ai_readonly'@'%';
-- GRANT SELECT ON xtest.test_points TO 'ai_readonly'@'%';
-- GRANT SELECT ON xtest.projects TO 'ai_readonly'@'%';
-- GRANT SELECT ON xtest.modules TO 'ai_readonly'@'%';
-- GRANT SELECT ON xtest.test_plan_cases TO 'ai_readonly'@'%';

-- 5. 禁止访问的敏感表（黑名单）
-- 注意：以下表AI用户无法访问
-- - users（用户信息）
-- - ai_models（AI模型配置，包含API_key）
-- - ai_skills（AI技能定义）
-- - user_skill_settings（用户技能设置）
-- - sessions（会话信息）

-- 6. 刷新权限
FLUSH PRIVILEGES;

-- 7. 验证用户权限
SHOW GRANTS FOR 'ai_readonly'@'%';

-- 8. 查看用户信息
SELECT User, Host FROM mysql.user WHERE User = 'ai_readonly';
