ALTER TABLE temp_test_cases ADD COLUMN project_id INT DEFAULT NULL COMMENT '关联项目ID' AFTER owner;
ALTER TABLE temp_test_cases ADD COLUMN project_ids JSON DEFAULT NULL COMMENT '关联项目ID列表(JSON数组)' AFTER project_id;
