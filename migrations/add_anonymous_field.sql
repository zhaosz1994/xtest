-- ============================================
-- 匿名发帖/评论功能 - 数据库增量更新
-- 执行时间: 2026-03-18
-- ============================================

-- 1. forum_posts 表增加 is_anonymous 字段
ALTER TABLE forum_posts 
ADD COLUMN is_anonymous TINYINT(1) DEFAULT 0 COMMENT '是否匿名发布: 0-否, 1-是' 
AFTER author_id;

-- 2. forum_comments 表增加 is_anonymous 字段
ALTER TABLE forum_comments 
ADD COLUMN is_anonymous TINYINT(1) DEFAULT 0 COMMENT '是否匿名发布: 0-否, 1-是' 
AFTER author_id;

-- 3. 为 is_anonymous 字段添加索引（便于筛选匿名内容）
ALTER TABLE forum_posts ADD INDEX idx_is_anonymous (is_anonymous);
ALTER TABLE forum_comments ADD INDEX idx_is_anonymous (is_anonymous);

-- 验证字段已添加
-- SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT 
-- FROM INFORMATION_SCHEMA.COLUMNS 
-- WHERE TABLE_NAME = 'forum_posts' AND COLUMN_NAME = 'is_anonymous';
