-- Agent Console 统一字典表
-- 用于管理目标环境、模式、严重度等可维护的选项内容
-- 不删除现有数据,仅新增表与种子数据

CREATE TABLE IF NOT EXISTS `agent_console_catalog` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `category` VARCHAR(64) NOT NULL COMMENT '字典分类: target_env/mode/severity/agent_role 等',
  `item_key` VARCHAR(128) NOT NULL COMMENT '选项键值(英文标识,用于代码判断)',
  `item_label` VARCHAR(255) NOT NULL COMMENT '选项显示文本',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序权重,升序',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active/inactive',
  `description` VARCHAR(512) DEFAULT NULL COMMENT '描述说明',
  `metadata` JSON DEFAULT NULL COMMENT '扩展元数据(如表单schema、默认值等)',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_catalog_category_key` (`category`, `item_key`),
  KEY `idx_catalog_category_status` (`category`, `status`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent控制台统一字典表';

-- 目标环境种子数据(EDA Accelerator 已被替换为 1PP4_Veloce)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('target_env', 'CModel',          'CModel 软件仿真',         10, 'active', '软件级仿真环境,成本最低,首选 dry-run 验证'),
  ('target_env', 'FPGA',             'FPGA 硬件验证板',         20, 'active', '硬件级验证,适用于流量与性能相关用例'),
  ('target_env', '1PP4_Veloce',      '1PP4_Veloce 硬件加速器',  30, 'active', 'Veloce 硬件加速仿真,适用于大规模回归'),
  ('target_env', 'EDA_Accelerator',  'EDA Accelerator (旧)',    90, 'inactive', '已被 1PP4_Veloce 替换,保留以兼容历史数据');

-- 任务模式种子数据
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description, metadata) VALUES
  ('mode', 'advisory',   'Advisory 咨询',         10, 'active', '仅生成建议,不修改任何状态', JSON_OBJECT('approval_required', false)),
  ('mode', 'generation', 'Generation 生成',       20, 'active', '生成测试用例/脚本/flow spec,不执行', JSON_OBJECT('approval_required', false)),
  ('mode', 'dry_run',    'Dry-run 干跑',          30, 'active', '模拟执行,不真正下发到硬件', JSON_OBJECT('approval_required', false)),
  ('mode', 'execute',    'Execute 真执行',        40, 'active', '真实下发到目标环境,需管理员审批', JSON_OBJECT('approval_required', true)),
  ('mode', 'autonomous', 'Autonomous 自测试',     50, 'active', 'Agent 自主循环执行,需管理员审批', JSON_OBJECT('approval_required', true));

-- Bug 严重度种子数据
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('severity', 'critical', 'Critical 严重', 10, 'active', '阻塞性问题,必须立即修复'),
  ('severity', 'high',     'High 高',       20, 'active', '影响核心功能,优先处理'),
  ('severity', 'medium',   'Medium 中',     30, 'active', '影响非核心功能,版本内修复'),
  ('severity', 'low',      'Low 低',        40, 'active', '不影响功能,择机修复');

-- Agent 角色种子(用于新增 Agent 时的角色下拉)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('agent_role', 'planner_agent',                'Planner 任务规划',          10, 'active', '负责任务拆解与子任务分配'),
  ('agent_role', 'sdk_cli_configuration_and_observation', 'SDK CLI 配置与观察', 20, 'active', '负责配置下发、快照、counter、回滚'),
  ('agent_role', 'packet_generation_and_traffic_execution', 'Traffic 报文与流量', 30, 'active', '负责 SdkCTP 报文模板与流量执行'),
  ('agent_role', 'safety_evidence_and_plan_review',         'Critic 安全审查',     40, 'active', '负责 plan/verdict 的安全审查');

-- 任务状态种子(用于前端筛选下拉)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('task_status', 'draft',                  'Draft 草稿',             10, 'active', '任务已创建,尚未启动'),
  ('task_status', 'waiting_for_critic_review', 'Waiting for Critic', 15, 'active', '等待 Critic 审查'),
  ('task_status', 'pending',                'Pending 待审批',         20, 'active', '等待管理员审批(execute/autonomous)'),
  ('task_status', 'running',                'Running 执行中',         30, 'active', '任务正在执行'),
  ('task_status', 'paused',                 'Paused 已暂停',          40, 'active', '用户主动暂停'),
  ('task_status', 'completed',              'Completed 已完成',       50, 'active', '任务执行完成'),
  ('task_status', 'cancelled',              'Cancelled 已取消',      60, 'active', '任务被取消'),
  ('task_status', 'failed',                 'Failed 失败',            70, 'active', '任务执行失败');

-- 资源类型种子(用于新增资源时的类型下拉)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('resource_type', 'CMODEL_INSTANCE',     'CModel 仿真实例',      10, 'active', '软件仿真实例,可多开'),
  ('resource_type', 'FPGA_BOARD',         'FPGA 验证板',          20, 'active', '物理 FPGA 硬件板'),
  ('resource_type', 'EDA_ACCEL_PARTITION', 'EDA 加速器分区',      30, 'active', 'EDA/Veloce 硬件加速器的一个分区'),
  ('resource_type', '1PP4_VELOCE_PARTITION', '1PP4 Veloce 分区', 40, 'active', '1PP4 Veloce 硬件加速器分区');

-- 给 agent_registry 与 env_resource 增加软删除字段(便于管理员删除后保留历史)
-- 注意:此 ALTER 语句由 autoMigration.js 的列存在性检查保证幂等,重复执行会触发 ER_DUP_FIELDNAME 被忽略
ALTER TABLE agent_registry ADD COLUMN `deleted_at` DATETIME NULL DEFAULT NULL COMMENT '软删除时间';
ALTER TABLE env_resource ADD COLUMN `deleted_at` DATETIME NULL DEFAULT NULL COMMENT '软删除时间';
