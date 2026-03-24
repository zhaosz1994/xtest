-- =====================================================
-- 论坛模块数据库表设计
-- 数据库：MySQL 通用语法
-- =====================================================

USE ctcsdk_testplan;

-- 1. 帖子表 (forum_posts)
CREATE TABLE IF NOT EXISTS forum_posts (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '帖子ID',
    post_id VARCHAR(50) NOT NULL UNIQUE COMMENT '帖子唯一标识(如: POST-时间戳)',
    author_id INT NOT NULL COMMENT '作者ID，关联users表',
    title VARCHAR(200) NOT NULL COMMENT '帖子标题',
    content LONGTEXT NOT NULL COMMENT '帖子内容(Markdown源码)',
    content_html LONGTEXT COMMENT '帖子内容HTML渲染结果(可选缓存)',
    view_count INT DEFAULT 0 COMMENT '浏览次数',
    comment_count INT DEFAULT 0 COMMENT '评论数量(冗余字段，提升查询性能)',
    is_pinned TINYINT(1) DEFAULT 0 COMMENT '是否置顶 0-否 1-是',
    is_locked TINYINT(1) DEFAULT 0 COMMENT '是否锁定(禁止评论) 0-否 1-是',
    status ENUM('normal', 'hidden', 'deleted') DEFAULT 'normal' COMMENT '帖子状态',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    INDEX idx_author_id (author_id) COMMENT '作者ID索引',
    INDEX idx_created_at (created_at) COMMENT '创建时间索引',
    INDEX idx_status (status) COMMENT '状态索引',
    INDEX idx_is_pinned (is_pinned) COMMENT '置顶索引',
    
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='论坛帖子表';


-- 2. 评论表 (forum_comments)
CREATE TABLE IF NOT EXISTS forum_comments (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '评论ID',
    comment_id VARCHAR(50) NOT NULL UNIQUE COMMENT '评论唯一标识',
    post_id INT NOT NULL COMMENT '帖子ID，关联forum_posts表',
    author_id INT NOT NULL COMMENT '评论者ID，关联users表',
    parent_id INT DEFAULT NULL COMMENT '父评论ID(支持楼中楼回复)',
    reply_to_id INT DEFAULT NULL COMMENT '回复的评论ID',
    content TEXT NOT NULL COMMENT '评论内容(Markdown源码)',
    content_html TEXT COMMENT '评论内容HTML渲染结果',
    status ENUM('normal', 'hidden', 'deleted') DEFAULT 'normal' COMMENT '评论状态',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    INDEX idx_post_id (post_id) COMMENT '帖子ID索引',
    INDEX idx_author_id (author_id) COMMENT '作者ID索引',
    INDEX idx_parent_id (parent_id) COMMENT '父评论ID索引',
    INDEX idx_created_at (created_at) COMMENT '创建时间索引',
    
    FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES forum_comments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='论坛评论表';


-- 3. 帖子标签表 (forum_tags) - 可选扩展
CREATE TABLE IF NOT EXISTS forum_tags (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '标签ID',
    name VARCHAR(50) NOT NULL UNIQUE COMMENT '标签名称',
    color VARCHAR(20) DEFAULT '#3498db' COMMENT '标签颜色',
    post_count INT DEFAULT 0 COMMENT '关联帖子数量',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='论坛标签表';


-- 4. 帖子标签关联表 (forum_post_tags) - 可选扩展
CREATE TABLE IF NOT EXISTS forum_post_tags (
    id INT PRIMARY KEY AUTO_INCREMENT,
    post_id INT NOT NULL COMMENT '帖子ID',
    tag_id INT NOT NULL COMMENT '标签ID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_post_tag (post_id, tag_id),
    FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES forum_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='帖子标签关联表';


-- 5. 用户点赞表 (forum_likes) - 可选扩展
CREATE TABLE IF NOT EXISTS forum_likes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL COMMENT '用户ID',
    target_type ENUM('post', 'comment') NOT NULL COMMENT '点赞目标类型',
    target_id INT NOT NULL COMMENT '目标ID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_user_target (user_id, target_type, target_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户点赞表';


-- =====================================================
-- 初始化默认标签数据
-- =====================================================
INSERT INTO forum_tags (name, color) VALUES 
('经验分享', '#27ae60'),
('问题求助', '#e74c3c'),
('测试工具', '#3498db'),
('自动化测试', '#9b59b6'),
('性能测试', '#f39c12'),
('接口测试', '#1abc9c'),
('其他', '#95a5a6')
ON DUPLICATE KEY UPDATE name = VALUES(name);
