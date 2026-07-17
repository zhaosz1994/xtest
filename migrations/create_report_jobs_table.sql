-- 创建报告生成任务表
-- 用于持久化异步任务状态，解决内存存储在服务重启后丢失的问题

CREATE TABLE IF NOT EXISTS report_jobs (
    id VARCHAR(100) PRIMARY KEY COMMENT '任务ID',
    user_id INT NOT NULL COMMENT '用户ID',
    username VARCHAR(50) NOT NULL COMMENT '用户名',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '任务状态: pending, processing, completed, failed, cancelled',
    progress INT NOT NULL DEFAULT 0 COMMENT '进度百分比 0-100',
    message VARCHAR(500) DEFAULT '' COMMENT '进度消息',
    error_message TEXT DEFAULT NULL COMMENT '错误信息',
    config JSON DEFAULT NULL COMMENT '任务配置',
    report_id INT DEFAULT NULL COMMENT '生成的报告ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报告生成任务表';
