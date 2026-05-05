-- 数据库性能优化索引脚本
-- 用于支持1000+用户并发场景

-- 1. 用户表索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- 2. 测试用例表索引
CREATE INDEX IF NOT EXISTS idx_test_cases_library_id ON test_cases(library_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_module_id ON test_cases(module_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_level1_id ON test_cases(level1_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_owner ON test_cases(owner);
CREATE INDEX IF NOT EXISTS idx_test_cases_status ON test_cases(status);
CREATE INDEX IF NOT EXISTS idx_test_cases_priority ON test_cases(priority);
CREATE INDEX IF NOT EXISTS idx_test_cases_created_at ON test_cases(created_at);

-- 3. 测试计划表索引
CREATE INDEX IF NOT EXISTS idx_test_plans_owner ON test_plans(owner);
CREATE INDEX IF NOT EXISTS idx_test_plans_status ON test_plans(status);
CREATE INDEX IF NOT EXISTS idx_test_plans_project ON test_plans(project);
CREATE INDEX IF NOT EXISTS idx_test_plans_iteration ON test_plans(iteration);
CREATE INDEX IF NOT EXISTS idx_test_plans_created_at ON test_plans(created_at);

-- 4. 测试报告表索引
CREATE INDEX IF NOT EXISTS idx_test_reports_creator_id ON test_reports(creator_id);
CREATE INDEX IF NOT EXISTS idx_test_reports_project ON test_reports(project);
CREATE INDEX IF NOT EXISTS idx_test_reports_status ON test_reports(status);
CREATE INDEX IF NOT EXISTS idx_test_reports_created_at ON test_reports(created_at);

-- 5. 活动日志表索引
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_username ON activity_logs(username);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);

-- 6. 用例库表索引
CREATE INDEX IF NOT EXISTS idx_case_libraries_creator ON case_libraries(creator);
CREATE INDEX IF NOT EXISTS idx_case_libraries_created_at ON case_libraries(created_at);

-- 7. 模块表索引
CREATE INDEX IF NOT EXISTS idx_modules_library_id ON modules(library_id);

-- 8. 测试点表索引
CREATE INDEX IF NOT EXISTS idx_test_points_module_id ON test_points(module_id);
CREATE INDEX IF NOT EXISTS idx_test_points_library_id ON test_points(library_id);

-- 显示索引创建结果
SELECT 
    TABLE_NAME,
    INDEX_NAME,
    COLUMN_NAME
FROM 
    INFORMATION_SCHEMA.STATISTICS 
WHERE 
    TABLE_SCHEMA = DATABASE()
    AND INDEX_NAME LIKE 'idx_%'
ORDER BY 
    TABLE_NAME, INDEX_NAME;

-- Performance optimization indexes added 2026-05-02
-- Note: MySQL does not support CREATE INDEX IF NOT EXISTS
-- When running manually, duplicate index errors can be safely ignored
-- Test plan cases
CREATE INDEX idx_tpc_plan_status ON test_plan_cases (plan_id, status);
CREATE INDEX idx_tpc_case_id ON test_plan_cases (case_id);

-- Test case projects
CREATE INDEX idx_tcp_case_project ON test_case_projects (test_case_id, project_id);

-- Forum
CREATE INDEX idx_forum_posts_status_created ON forum_posts (status, created_at);
CREATE INDEX idx_forum_comments_post_status ON forum_comments (post_id, status);

-- Case reviewers
CREATE INDEX idx_cr_case_reviewer_status ON case_reviewers (case_id, reviewer_id, status);

-- Test cases
CREATE INDEX idx_tc_deleted_module ON test_cases (is_deleted, module_id);
CREATE INDEX idx_tc_creator_review ON test_cases (creator, review_status);
CREATE INDEX idx_tc_case_id ON test_cases (case_id);

-- Report jobs
CREATE INDEX idx_rj_status ON report_jobs (status);

-- AI operation logs
CREATE INDEX idx_aol_user_created ON ai_operation_logs (user_id, created_at);

-- Notifications
CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at);

-- Token blacklist
CREATE INDEX idx_tb_expires ON token_blacklist (expires_at);
