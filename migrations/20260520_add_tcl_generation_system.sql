-- xTest TCL自动化测试用例生成 融合设计 数据库迁移
-- 版本: v1.0
-- 日期: 2026-05-20
-- 说明: 为TCL自动化测试用例生成功能新增/修改表结构

-- ============================================================
-- 1. module_knowledge_files 增加 file_category 字段
-- ============================================================
ALTER TABLE module_knowledge_files
  ADD COLUMN file_category VARCHAR(50) DEFAULT 'design'
  COMMENT '文件分类: design|cli|methodology|tcl_convention|environment|test_plan|tcl_script';

CREATE INDEX idx_knowledge_files_category ON module_knowledge_files(file_category);

-- ============================================================
-- 2. module_knowledge_files parse_status 扩展支持 learning 状态
-- ============================================================
ALTER TABLE module_knowledge_files
  MODIFY COLUMN parse_status VARCHAR(20) DEFAULT 'pending'
  COMMENT '解析状态: pending|parsing|learning|parsed|failed';

-- ============================================================
-- 3. ai_material_chunks 增加 file_category 字段（便于RAG按分类过滤）
-- ============================================================
ALTER TABLE ai_material_chunks
  ADD COLUMN file_category VARCHAR(50) DEFAULT 'design'
  COMMENT '来源文件的分类标签: design|cli|methodology|tcl_convention|environment|test_plan|tcl_script|execution_experience';

CREATE INDEX idx_chunks_file_category ON ai_material_chunks(file_category);

-- ============================================================
-- 4. 新建 tcl_learning_results 表
-- ============================================================
CREATE TABLE IF NOT EXISTS `tcl_learning_results` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `module_id` INT NOT NULL,
  `library_id` INT DEFAULT NULL,
  `result_type` ENUM('cli_reference', 'tcl_convention') NOT NULL,
  `content` TEXT NOT NULL,
  `source_file_id` INT DEFAULT NULL COMMENT '来源TCL脚本文件ID(module_knowledge_files.id)',
  `source_script_ids` JSON COMMENT '来源TCL脚本ID列表',
  `chunk_ids` JSON COMMENT '生成的知识块ID列表',
  `status` ENUM('pending','processing','completed','failed') DEFAULT 'pending',
  `error_message` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_module_type (`module_id`, `result_type`),
  INDEX idx_status (`status`),
  INDEX idx_source_file (`source_file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='TCL脚本AI学习结果表';

-- ============================================================
-- 5. 新建 tcl_generation_tasks 表
-- ============================================================
CREATE TABLE IF NOT EXISTS `tcl_generation_tasks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `task_id` VARCHAR(100) NOT NULL,
  `module_id` INT NOT NULL,
  `library_id` INT DEFAULT NULL,
  `user_id` INT NOT NULL,
  `level1_point_id` INT DEFAULT NULL COMMENT '关联的一级测试点ID',
  `level1_point_name` VARCHAR(200) DEFAULT NULL COMMENT '一级测试点名称',
  `status` ENUM('pending','generating','validating','executing','repairing','completed','failed') DEFAULT 'pending',
  `rag_context` TEXT COMMENT 'RAG检索上下文',
  `tcl_content` TEXT COMMENT '生成的TCL脚本内容',
  `script_file_path` VARCHAR(500) COMMENT 'TCL文件路径',
  `reflection_result` JSON COMMENT '静态校验结果',
  `execution_status` ENUM('pending','passed','passed_after_repair','failed','timeout','skipped','agent_unreachable') DEFAULT 'pending',
  `execution_result` JSON COMMENT '动态执行结果(stdout/stderr/exit_code/execution_time)',
  `repair_count` INT DEFAULT 0 COMMENT '自修复次数',
  `repair_history` JSON COMMENT '自修复历史(每次修复的脚本diff+报错日志)',
  `repair_experience` TEXT COMMENT '避坑经验(回写知识库的内容)',
  `error_message` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY `uk_task_id` (`task_id`),
  INDEX idx_status (`status`),
  INDEX idx_module (`module_id`),
  INDEX idx_execution_status (`execution_status`),
  INDEX idx_level1_point (`level1_point_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='TCL脚本生成任务表';

-- ============================================================
-- 6. test_case_scripts 表扩展字段
-- ============================================================
ALTER TABLE test_case_scripts
  MODIFY COLUMN link_type VARCHAR(20) DEFAULT 'external'
  COMMENT '链接类型: external(手动关联)|generated(AI生成)';

ALTER TABLE test_case_scripts
  ADD COLUMN generation_task_id VARCHAR(100) DEFAULT NULL
  COMMENT 'AI生成任务ID，关联tcl_generation_tasks.task_id';

ALTER TABLE test_case_scripts
  ADD COLUMN level1_point_id INT DEFAULT NULL
  COMMENT '关联的一级测试点ID';

CREATE INDEX idx_scripts_link_type ON test_case_scripts(link_type);
CREATE INDEX idx_scripts_generation_task ON test_case_scripts(generation_task_id);

-- ============================================================
-- 7. temp_level1_points 增加扩展维度和RAG上下文字段
-- ============================================================
ALTER TABLE temp_level1_points
  ADD COLUMN expansion_dimension VARCHAR(20) DEFAULT NULL
  COMMENT '扩展维度: functional|boundary|exception|combination|state|original';

ALTER TABLE temp_level1_points
  ADD COLUMN rag_context TEXT DEFAULT NULL
  COMMENT 'RAG检索到的相关上下文';
