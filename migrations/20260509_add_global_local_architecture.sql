-- 全局-局部两阶段架构迁移
-- 版本: v1.0
-- 日期: 2026-05-09
-- 说明: 为全局感知阶段增加 global_context 存储字段，增加 skeleton_stage 任务阶段

-- 1. ai_case_generation_tasks 增加 global_context 字段，存储阶段一提取的全局系统背景
ALTER TABLE ai_case_generation_tasks
  ADD COLUMN global_context text DEFAULT NULL COMMENT '全局系统背景(阶段一提取)' AFTER config;

-- 2. ai_case_generation_tasks 增加 skeleton_level1_json 字段，存储阶段一提取的全量一级测试点枚举
ALTER TABLE ai_case_generation_tasks
  ADD COLUMN skeleton_level1_json json DEFAULT NULL COMMENT '全量一级测试点枚举(阶段一冻结)' AFTER global_context;

-- 3. ai_case_generation_tasks stage 枚举增加 skeleton 阶段
ALTER TABLE ai_case_generation_tasks
  MODIFY COLUMN stage enum('init','chunking','skeleton','mapping','reducing','finished') DEFAULT 'init' COMMENT '当前处理阶段';

-- 4. temp_test_cases 增加 level1_source 字段，标记一级测试点来源
ALTER TABLE temp_test_cases
  ADD COLUMN level1_source enum('skeleton','existing','fallback') DEFAULT 'skeleton' COMMENT '一级测试点来源: skeleton-骨架生成, existing-已有, fallback-兜底' AFTER is_new_level1;
