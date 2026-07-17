-- =====================================================================
-- Part 4: Module Taxonomy 标准分类树
-- 描述: 给 modules 表加分类字段,种子 7 个根分类
-- =====================================================================

ALTER TABLE `modules`
  ADD COLUMN `taxonomy_path` VARCHAR(512) DEFAULT NULL COMMENT '分类路径,如 Front-end/Ingress',
  ADD COLUMN `parent_module_id` INT DEFAULT NULL COMMENT '父模块ID,用于构建分类树',
  ADD COLUMN `taxonomy_level` INT DEFAULT 0 COMMENT '分类层级,0=普通模块,1=根分类,2+=子分类';

-- 种子 7 个根分类(仅在不存在时插入)
-- 注: modules 表无 description 列,用 module_id 列存放中文描述
INSERT IGNORE INTO `modules` (`module_id`, `name`, `taxonomy_path`, `taxonomy_level`, `created_at`) VALUES
('FE_INGRESS', 'Front-end / Ingress', 'Front-end/Ingress', 1, NOW()),
('BUF_MMU', 'Buffer / MMU', 'Buffer/MMU', 1, NOW()),
('FABRIC_SCHED', 'Fabric / Scheduling', 'Fabric/Scheduling', 1, NOW()),
('EGRESS', 'Egress', 'Egress', 1, NOW()),
('TELEMETRY_OAM', 'Telemetry / OAM', 'Telemetry/OAM', 1, NOW()),
('PORT_MAC_PCS', 'Port / MAC / PCS / SerDes', 'Port/MAC/PCS', 1, NOW()),
('SDK_CLI_DRV', 'SDK / CLI / DRV Common', 'SDK/CLI/DRV', 1, NOW());
