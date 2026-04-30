-- 知识库文件夹支持用例库层级 - 数据库迁移脚本
-- 版本: v1.0
-- 日期: 2026-04-30
-- 说明: 给 module_knowledge_files 表增加 library_id 字段，
--       使得文件夹可以挂在用例库层级（module_id 为 NULL 时）

-- 1. module_knowledge_files 增加 library_id 字段
ALTER TABLE module_knowledge_files
  ADD COLUMN library_id int DEFAULT NULL COMMENT '所属用例库ID(用于用例库层级文件夹)' AFTER module_id,
  ADD KEY idx_library_id (library_id);

-- 2. 允许 module_id 为 NULL（用例库层级文件夹没有 module_id）
ALTER TABLE module_knowledge_files
  MODIFY COLUMN module_id int DEFAULT NULL COMMENT '所属模块ID，NULL表示挂在用例库层级';

-- 3. 为已有数据回填 library_id（通过 module_id 关联 modules 表获取 library_id）
UPDATE module_knowledge_files mkf
  INNER JOIN modules m ON mkf.module_id = m.id
SET mkf.library_id = m.library_id
WHERE mkf.library_id IS NULL AND mkf.module_id IS NOT NULL;

-- 4. ai_material_chunks 表的 module_id 允许为 NULL（用例库层级文件的分块没有 module_id）
-- 先删除外键约束
ALTER TABLE ai_material_chunks DROP FOREIGN KEY fk_chunk_module;
-- 修改字段允许 NULL
ALTER TABLE ai_material_chunks MODIFY COLUMN module_id int DEFAULT NULL COMMENT '所属模块ID(冗余，便于查询)，NULL表示用例库层级文件';
-- 重新添加外键（允许 NULL）
ALTER TABLE ai_material_chunks
  ADD CONSTRAINT fk_chunk_module FOREIGN KEY (module_id) REFERENCES modules (id) ON DELETE CASCADE;

-- 5. ai_material_chunks 也增加 library_id 用于冗余查询
ALTER TABLE ai_material_chunks
  ADD COLUMN library_id int DEFAULT NULL COMMENT '所属用例库ID(冗余)' AFTER module_id,
  ADD KEY idx_library_id (library_id);

-- 回填 ai_material_chunks 的 library_id
UPDATE ai_material_chunks ac
  INNER JOIN module_knowledge_files mkf ON ac.file_id = mkf.id
SET ac.library_id = mkf.library_id
WHERE ac.library_id IS NULL AND mkf.library_id IS NOT NULL;
