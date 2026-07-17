-- =====================================================================
-- Part 3: 知识导入审核流程 (Knowledge Review Workflow)
-- 描述: 给 module_knowledge_files 加审核状态字段,新建冲突日志表
-- =====================================================================

ALTER TABLE `module_knowledge_files`
  ADD COLUMN `review_status` ENUM('draft','auto_parsed','under_review','approved','rejected','published') DEFAULT 'draft' COMMENT '审核状态',
  ADD COLUMN `reviewer_id` INT DEFAULT NULL COMMENT '审核人ID',
  ADD COLUMN `reviewed_at` DATETIME DEFAULT NULL COMMENT '审核时间',
  ADD COLUMN `supersedes` INT DEFAULT NULL COMMENT '取代的旧文件ID',
  ADD COLUMN `conflict_flags` JSON DEFAULT NULL COMMENT '检测到的冲突标志';

CREATE TABLE IF NOT EXISTS `knowledge_conflict_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `file_id` INT NOT NULL COMMENT '关联的 module_knowledge_files.id',
  `conflict_type` ENUM('drv_mismatch','cli_sdk_mismatch','version_conflict','test_point_outdated','reset_value_mismatch','threshold_mismatch','enum_mismatch') NOT NULL COMMENT '冲突类型',
  `severity` ENUM('critical','high','medium','low') NOT NULL COMMENT '严重度',
  `description` TEXT COMMENT '冲突描述',
  `detected_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` DATETIME DEFAULT NULL,
  `resolved_by` INT DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_file_id` (`file_id`),
  KEY `idx_severity` (`severity`),
  KEY `idx_conflict_type` (`conflict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识导入冲突日志';
