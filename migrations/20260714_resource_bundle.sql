-- =====================================================================
-- Part 5: 资源 Bundle 联合锁
-- 描述: 将多个 env_resource 组成 Bundle,一次性原子申请/释放
-- 2 张表: env_resource_bundle + env_resource_bundle_item
-- 并给 env_resource_lease 增加 bundle_id 列,用于追溯联合锁归属
-- =====================================================================

ALTER TABLE `env_resource_lease`
  ADD COLUMN `bundle_id` VARCHAR(128) DEFAULT NULL COMMENT '联合锁Bundle归属';

CREATE TABLE IF NOT EXISTS `env_resource_bundle` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `bundle_id` VARCHAR(128) NOT NULL UNIQUE COMMENT '唯一标识 BUNDLE-xxx',
  `display_name` VARCHAR(256) NOT NULL,
  `status` ENUM('idle','leased','maintenance','offline') DEFAULT 'idle',
  `compatible_modules` JSON DEFAULT NULL COMMENT '兼容模块列表',
  `cleanup_sequence` JSON DEFAULT NULL COMMENT '清理顺序',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bundle_id` (`bundle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `env_resource_bundle_item` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `bundle_id` VARCHAR(128) NOT NULL,
  `resource_id` VARCHAR(128) NOT NULL,
  `sort_order` INT DEFAULT 0,
  `role` VARCHAR(64) DEFAULT NULL COMMENT '资源在 bundle 中的角色 (dut/tb/server 等)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bundle_id` (`bundle_id`),
  KEY `idx_resource_id` (`resource_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
