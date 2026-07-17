-- 语义切分和父子切分支持 - 数据库迁移脚本
-- 版本: v1.0
-- 日期: 2026-05-09
-- 说明: 给 ai_material_chunks 表增加 chunk_type、parent_chunk_id、chunking_strategy 字段，
--       支持语义切分和父子切分策略

-- 1. 增加 chunk_type 字段：区分 parent/child 普通块
ALTER TABLE ai_material_chunks
  ADD COLUMN chunk_type enum('parent','child','normal') DEFAULT 'normal' COMMENT '块类型: parent-父块, child-子块, normal-普通块' AFTER char_count;

-- 2. 增加 parent_chunk_id 字段：子块关联父块
ALTER TABLE ai_material_chunks
  ADD COLUMN parent_chunk_id int DEFAULT NULL COMMENT '父块ID(仅子块有值)' AFTER chunk_type,
  ADD KEY idx_parent_chunk_id (parent_chunk_id);

-- 3. 增加 chunking_strategy 字段：记录使用的切分策略
ALTER TABLE ai_material_chunks
  ADD COLUMN chunking_strategy varchar(50) DEFAULT 'structure_aware' COMMENT '切分策略: structure_aware/semantic/parent_child/semantic_parent_child' AFTER parent_chunk_id,
  ADD KEY idx_chunking_strategy (chunking_strategy);

-- 4. 回填已有数据为 normal 类型和 structure_aware 策略
UPDATE ai_material_chunks
SET chunk_type = 'normal', chunking_strategy = 'structure_aware'
WHERE chunk_type = 'normal' OR chunk_type IS NULL;

-- 5. 给 module_knowledge_files 表增加默认切分策略配置
ALTER TABLE module_knowledge_files
  ADD COLUMN chunking_strategy varchar(50) DEFAULT 'structure_aware' COMMENT '文件切分策略: structure_aware/semantic/parent_child/semantic_parent_child' AFTER total_tokens;
