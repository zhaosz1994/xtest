-- =====================================================
-- 论坛附件表 - 支持多种文件格式
-- =====================================================

USE xtest_db;

-- 论坛附件表
CREATE TABLE IF NOT EXISTS forum_attachments (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '附件ID',
    post_id INT DEFAULT NULL COMMENT '帖子ID，NULL表示未关联帖子',
    uploader_id INT NOT NULL COMMENT '上传者ID',
    file_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
    file_path VARCHAR(500) NOT NULL COMMENT '服务器存储路径',
    file_size INT NOT NULL COMMENT '文件大小(字节)',
    file_type VARCHAR(50) NOT NULL COMMENT '文件类型(image/document/code/other)',
    mime_type VARCHAR(100) COMMENT 'MIME类型',
    download_count INT DEFAULT 0 COMMENT '下载次数',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
    
    INDEX idx_post_id (post_id) COMMENT '帖子ID索引',
    INDEX idx_uploader_id (uploader_id) COMMENT '上传者索引',
    INDEX idx_file_type (file_type) COMMENT '文件类型索引',
    
    FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='论坛附件表';
