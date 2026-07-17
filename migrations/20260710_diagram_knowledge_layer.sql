-- =====================================================================
-- Part 1: Diagram Knowledge Layer (P0)
-- 描述: 图形知识层,支持 drawio/vsdx/svg/pdf/OCR 解析
-- 4 张表: diagram_asset / diagram_node / diagram_edge / diagram_review
-- =====================================================================

CREATE TABLE IF NOT EXISTS `diagram_asset` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `diagram_id` VARCHAR(128) NOT NULL COMMENT '唯一标识 DIAG-xxx',
  `module_id` INT DEFAULT NULL,
  `library_id` INT DEFAULT NULL,
  `chip_version_id` INT DEFAULT NULL,
  `source_file_id` INT DEFAULT NULL COMMENT '关联 module_knowledge_files.id',
  `source_file_path` VARCHAR(512) NOT NULL,
  `source_file_type` ENUM('drawio','vsdx','svg','png','jpg','jpeg','pdf_figure') NOT NULL,
  `diagram_type` ENUM('state_machine','data_path','control_path','block_diagram','pipeline','topology','timing','other') DEFAULT 'other',
  `diagram_name` VARCHAR(256) DEFAULT NULL,
  `page_count` INT DEFAULT 1,
  `parse_status` ENUM('pending','parsing','parsed','parse_failed','reviewed','published') DEFAULT 'pending',
  `parse_error` TEXT DEFAULT NULL,
  `auto_extracted_metadata` JSON DEFAULT NULL,
  `human_summary` TEXT DEFAULT NULL COMMENT 'Module Owner人工总结(必填)',
  `reviewer_id` INT DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `published_at` DATETIME DEFAULT NULL,
  `rendered_preview_path` VARCHAR(512) DEFAULT NULL,
  `created_by` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_diagram_id` (`diagram_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_parse_status` (`parse_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `diagram_node` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `diagram_id` VARCHAR(128) NOT NULL,
  `page_index` INT DEFAULT 0,
  `node_id` VARCHAR(128) NOT NULL COMMENT '原图节点ID',
  `text` TEXT NOT NULL,
  `semantic_type` ENUM('state','action','condition','register','counter','queue','module','port','decision','node','unknown') DEFAULT 'node',
  `bbox` JSON DEFAULT NULL,
  `style` VARCHAR(256) DEFAULT NULL,
  `confidence` DECIMAL(4,2) DEFAULT 1.00,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_diagram_id` (`diagram_id`),
  KEY `idx_semantic_type` (`semantic_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `diagram_edge` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `diagram_id` VARCHAR(128) NOT NULL,
  `page_index` INT DEFAULT 0,
  `edge_id` VARCHAR(128) NOT NULL,
  `source_node_id` VARCHAR(128) DEFAULT NULL,
  `source_text` TEXT DEFAULT NULL,
  `target_node_id` VARCHAR(128) DEFAULT NULL,
  `target_text` TEXT DEFAULT NULL,
  `label` TEXT DEFAULT NULL,
  `semantic_type` ENUM('transition','timeout','drop','error','enable','disable','config','trigger','data_flow','control_flow','unknown') DEFAULT 'transition',
  `confidence` DECIMAL(4,2) DEFAULT 1.00,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_diagram_id` (`diagram_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `diagram_review` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `diagram_id` VARCHAR(128) NOT NULL,
  `reviewer_id` INT NOT NULL,
  `review_round` INT DEFAULT 1,
  `decision` ENUM('approved','rejected','changes_requested') NOT NULL,
  `reviewer_summary` TEXT,
  `reviewer_notes` TEXT,
  `previous_human_summary` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_diagram_id` (`diagram_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
