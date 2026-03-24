-- =====================================================
-- 论坛全文索引优化脚本
-- 用于提升帖子搜索性能
-- =====================================================

USE ctcsdk_testplan;

-- 添加全文索引（如果不存在）
-- 注意：FULLTEXT 索引仅支持 InnoDB 和 MyISAM 引擎
-- 且要求字符串类型为 CHAR、VARCHAR 或 TEXT

-- 为 forum_posts 表的 title 和 content 添加全文索引
-- 支持中文分词需要使用 ngram 解析器（MySQL 5.7.6+）
ALTER TABLE forum_posts 
ADD FULLTEXT INDEX ft_title_content (title, content) WITH PARSER ngram;

-- 如果 MySQL 版本不支持 ngram，使用以下命令（仅支持英文分词）：
-- ALTER TABLE forum_posts ADD FULLTEXT INDEX ft_title_content (title, content);

-- 设置 GROUP_CONCAT 最大长度（防止标签截断）
-- 在会话级别设置，或修改 my.cnf 配置文件
SET SESSION group_concat_max_len = 1000000;

-- 验证索引是否创建成功
SHOW INDEX FROM forum_posts WHERE Key_name = 'ft_title_content';

-- =====================================================
-- 使用示例
-- =====================================================
-- 自然语言搜索（默认模式）
-- SELECT * FROM forum_posts 
-- WHERE MATCH(title, content) AGAINST('测试工具');

-- 布尔模式搜索（支持 +、-、* 等操作符）
-- SELECT * FROM forum_posts 
-- WHERE MATCH(title, content) AGAINST('+自动化 +测试' IN BOOLEAN MODE);

-- 查询扩展模式
-- SELECT * FROM forum_posts 
-- WHERE MATCH(title, content) AGAINST('性能测试' WITH QUERY EXPANSION);
