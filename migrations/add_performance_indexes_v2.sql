-- Performance optimization indexes
-- Added for high-concurrency support (1000+ users)
-- Note: MySQL does not support CREATE INDEX IF NOT EXISTS
-- The AutoMigration framework handles ER_DUP_KEYNAME errors gracefully

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
