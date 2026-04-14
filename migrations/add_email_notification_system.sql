-- 邮件通知系统扩展 - 数据库迁移脚本
-- 创建日期: 2026-04-13
-- 说明: 创建 email_types 表、user_notification_prefs 表，扩展 users 表

-- =============================================
-- 1. 创建邮件类型定义表
-- =============================================
CREATE TABLE IF NOT EXISTS email_types (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    type_code VARCHAR(50) UNIQUE NOT NULL COMMENT '类型代码',
    type_name VARCHAR(100) NOT NULL COMMENT '类型名称',
    category ENUM('account', 'social', 'business', 'approval', 'announcement', 'digest') NOT NULL COMMENT '所属分类',
    description TEXT COMMENT '详细描述说明',
    is_required BOOLEAN DEFAULT FALSE COMMENT '是否强制发送（不可关闭）',
    default_email_enabled BOOLEAN DEFAULT TRUE COMMENT '默认邮件开关',
    default_in_app_enabled BOOLEAN DEFAULT TRUE COMMENT '默认站内通知开关',
    template_subject VARCHAR(255) COMMENT '邮件主题模板',
    template_path VARCHAR(255) COMMENT '邮件模板文件路径',
    supports_in_app BOOLEAN DEFAULT TRUE COMMENT '是否支持站内通知',
    role_restriction VARCHAR(50) DEFAULT NULL COMMENT '角色限制',
    sort_order INT DEFAULT 0 COMMENT '排序权重',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_category (category),
    INDEX idx_is_active (is_active),
    INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邮件类型定义表';

-- =============================================
-- 2. 创建用户通知偏好表
-- =============================================
CREATE TABLE IF NOT EXISTS user_notification_prefs (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    user_id INT NOT NULL COMMENT '用户ID',
    type_code VARCHAR(50) NOT NULL COMMENT '邮件类型代码',
    email_enabled BOOLEAN DEFAULT TRUE COMMENT '是否接收邮件通知',
    in_app_enabled BOOLEAN DEFAULT TRUE COMMENT '是否接收站内通知',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY uk_user_type (user_id, type_code),
    INDEX idx_user_id (user_id),
    INDEX idx_type_code (type_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户通知偏好表';

-- =============================================
-- 3. 扩展 users 表 - 添加全局偏好字段
-- =============================================
-- 使用存储过程安全添加列（如果不存在）
DROP PROCEDURE IF EXISTS add_column_if_not_exists;
DELIMITER //
CREATE PROCEDURE add_column_if_not_exists()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_global_enabled') THEN
        ALTER TABLE users ADD COLUMN email_global_enabled BOOLEAN DEFAULT TRUE COMMENT '全局邮件开关' AFTER email_notify_likes;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_quiet_hours_start') THEN
        ALTER TABLE users ADD COLUMN email_quiet_hours_start TIME DEFAULT NULL COMMENT '免打扰开始时间' AFTER email_global_enabled;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_quiet_hours_end') THEN
        ALTER TABLE users ADD COLUMN email_quiet_hours_end TIME DEFAULT NULL COMMENT '免打扰结束时间' AFTER email_quiet_hours_start;
    END IF;
END //
DELIMITER ;
CALL add_column_if_not_exists();
DROP PROCEDURE IF EXISTS add_column_if_not_exists;

-- =============================================
-- 4. 插入邮件类型初始数据
-- =============================================
INSERT IGNORE INTO email_types (type_code, type_name, category, description, is_required, default_email_enabled, default_in_app_enabled, template_subject, template_path, supports_in_app, role_restriction, sort_order) VALUES
-- 社区互动类
('mention', '@提及提醒', 'social', '有人在论坛帖子中@你', FALSE, TRUE, TRUE, '【xTest 社区】{senderName} 在论坛中@了你', 'mention', TRUE, NULL, 101),
('comment', '评论提醒', 'social', '有人评论了你的帖子', FALSE, TRUE, TRUE, '【xTest 社区】{senderName} 评论了您的帖子', 'comment', TRUE, NULL, 102),
('like', '点赞提醒', 'social', '有人点赞了你的帖子', FALSE, FALSE, TRUE, '【xTest 社区】{senderName} 赞了您的帖子', 'like', TRUE, NULL, 103),
('follow_post', '关注发帖提醒', 'social', '你关注的人发布了新帖子', FALSE, FALSE, TRUE, '【xTest 社区】{followedUser} 发布了新帖子', 'follow_post', TRUE, NULL, 104),

-- 测试业务类
('plan_assigned', '测试计划分配', 'business', '你被分配了新的测试计划', FALSE, TRUE, TRUE, '【xTest】您被分配了新的测试计划 - {planName}', 'plan_assigned', TRUE, NULL, 201),
('plan_status', '计划状态变更', 'business', '测试计划状态发生变更', FALSE, TRUE, TRUE, '【xTest】测试计划状态变更 - {planName}', 'plan_status', TRUE, NULL, 202),
('case_review', '用例审核结果', 'business', '你提交的用例审核结果通知', FALSE, TRUE, TRUE, '【xTest】用例审核结果 - {caseName}', 'case_review', TRUE, NULL, 203),
('case_review_submit', '用例评审提交通知', 'business', '测试用例提交评审时通知评审人', FALSE, TRUE, TRUE, '【xTest】您有新的测试用例待评审 - {caseName}', 'case_review_submit', TRUE, NULL, 204),
('report_ready', '报告生成完成', 'business', '测试报告生成完成通知', FALSE, TRUE, TRUE, '【xTest】测试报告已生成 - {reportName}', 'report_ready', TRUE, NULL, 205),
('plan_deadline', '测试计划到期提醒', 'business', '测试计划即将到期时提醒负责人', FALSE, TRUE, TRUE, '【xTest】测试计划即将到期 - {planName}', 'plan_deadline', TRUE, NULL, 206),
('plan_progress_alert', '测试计划进度预警', 'business', '测试计划进度异常时预警', FALSE, TRUE, TRUE, '【xTest】测试计划进度预警 - {planName}', 'plan_progress_alert', TRUE, NULL, 207),
('defect_created', '缺陷创建通知', 'business', '新缺陷创建时通知相关人员', FALSE, TRUE, TRUE, '【xTest】新缺陷记录 - {defectTitle}', 'defect_created', TRUE, NULL, 208),
('defect_status', '缺陷状态变更通知', 'business', '缺陷状态变更时通知相关人员', FALSE, TRUE, TRUE, '【xTest】缺陷状态更新 - {defectTitle}', 'defect_status', TRUE, NULL, 210),
('task_assigned', '任务分配通知', 'business', '新任务分配时通知被分配人', FALSE, TRUE, TRUE, '【xTest】您有新的任务 - {taskTitle}', 'task_assigned', TRUE, NULL, 211),
('task_deadline', '任务到期提醒', 'business', '任务即将到期时提醒负责人', FALSE, TRUE, TRUE, '【xTest】任务即将到期 - {taskTitle}', 'task_deadline', TRUE, NULL, 212),

-- 审批流程类
('user_audit', '新用户待审核', 'approval', '有新用户注册等待审核', FALSE, TRUE, TRUE, '【xTest】新用户注册待审核 - {username}', 'user_audit', TRUE, 'admin', 301),
('audit_result', '审核结果通知', 'approval', '账号审核结果通知', FALSE, TRUE, TRUE, '【xTest】您的账号审核结果', 'audit_result', TRUE, NULL, 302),
('role_change', '角色变更通知', 'approval', '用户角色权限变更通知', FALSE, TRUE, TRUE, '【xTest】您的角色权限已变更', 'role_change', TRUE, NULL, 303),

-- 系统公告类
('maintenance', '系统维护通知', 'announcement', '系统维护公告通知', FALSE, TRUE, TRUE, '【xTest 系统公告】系统维护通知', 'maintenance', TRUE, NULL, 401),
('version_update', '版本更新公告', 'announcement', '系统版本更新公告', FALSE, TRUE, TRUE, '【xTest 系统公告】版本更新 - v{version}', 'version_update', TRUE, NULL, 402),
('urgent', '紧急通知', 'announcement', '管理员发送的紧急通知', FALSE, TRUE, TRUE, '【xTest 紧急通知】{title}', 'urgent', TRUE, NULL, 403),

-- 定期汇总类
('daily_digest', '每日进度汇总', 'digest', '每日测试进度汇总邮件', FALSE, FALSE, FALSE, '【xTest】每日测试进度汇总 - {date}', 'daily_digest', FALSE, NULL, 501),
('weekly_report', '每周工作报告', 'digest', '每周工作报告邮件', FALSE, FALSE, FALSE, '【xTest】每周工作报告 - {week}', 'weekly_report', FALSE, NULL, 502),
('monthly_stats', '月度统计数据', 'digest', '月度统计数据邮件（仅管理员）', FALSE, FALSE, FALSE, '【xTest】月度统计数据 - {month}', 'monthly_stats', FALSE, 'admin', 503);

-- =============================================
-- 5. 迁移现有偏好数据到 user_notification_prefs
-- =============================================
INSERT IGNORE INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT id, 'mention', COALESCE(email_notify_mentions, 1), TRUE FROM users WHERE email_notify_mentions IS NOT NULL;

INSERT IGNORE INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT id, 'comment', COALESCE(email_notify_comments, 1), TRUE FROM users WHERE email_notify_comments IS NOT NULL;

INSERT IGNORE INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT id, 'like', COALESCE(email_notify_likes, 0), TRUE FROM users WHERE email_notify_likes IS NOT NULL;

-- 为所有用户初始化其他类型的默认偏好
INSERT IGNORE INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT u.id, et.type_code, et.default_email_enabled, et.default_in_app_enabled
FROM users u
CROSS JOIN email_types et
WHERE NOT EXISTS (
    SELECT 1 FROM user_notification_prefs unp
    WHERE unp.user_id = u.id AND unp.type_code = et.type_code
);
