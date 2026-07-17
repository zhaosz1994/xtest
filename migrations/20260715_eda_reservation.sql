-- =====================================================================
-- Part 6: EDA 预约 / 配额 / 抢占
-- 描述: 支持按时间段预约资源,按用户/资源类型计算日配额,高优先级任务可抢占低优先级 lease
-- 2 张表: eda_reservation + resource_quota
-- =====================================================================

CREATE TABLE IF NOT EXISTS `eda_reservation` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `reservation_id` VARCHAR(128) NOT NULL UNIQUE COMMENT '唯一标识 RSV-xxx',
  `resource_id` VARCHAR(128) NOT NULL,
  `user_id` INT NOT NULL,
  `start_time` DATETIME NOT NULL,
  `end_time` DATETIME NOT NULL,
  `status` ENUM('pending','confirmed','in_progress','completed','cancelled') DEFAULT 'pending',
  `task_type` ENUM('release_gate','nightly_regression','module_owner_debug','normal_execute','dry_run','exploratory') DEFAULT 'normal_execute',
  `priority` INT DEFAULT 50,
  `notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reservation_id` (`reservation_id`),
  KEY `idx_resource_time` (`resource_id`, `start_time`, `end_time`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `resource_quota` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `daily_quota_minutes` INT DEFAULT 120,
  `used_today_minutes` INT DEFAULT 0,
  `quota_date` DATE NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_type_date` (`user_id`, `resource_type`, `quota_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
