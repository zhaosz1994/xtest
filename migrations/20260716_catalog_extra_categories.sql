-- =====================================================================
-- 补充 agent_console_catalog 5 个新分类
-- risk_level / resource_status / agent_status / task_type / bug_status
-- 让 Agent 控制台所有硬编码下拉都接入配置管理
-- =====================================================================

-- 风险等级 (资源表单)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('risk_level', 'high',   'High 高风险',   10, 'active', '高风险资源,执行模式需管理员审批'),
  ('risk_level', 'medium', 'Medium 中风险', 20, 'active', '中风险资源,默认 dry_run 可直接使用'),
  ('risk_level', 'low',    'Low 低风险',    30, 'active', '低风险资源,无限制');

-- 资源状态 (资源表单编辑)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('resource_status', 'idle',        'Idle 空闲',      10, 'active', '资源可用,可被申请'),
  ('resource_status', 'maintenance', 'Maintenance 维护', 20, 'active', '维护中,不可申请'),
  ('resource_status', 'offline',     'Offline 离线',    30, 'active', '已下线'),
  ('resource_status', 'leased',      'Leased 已占用',   40, 'inactive', '系统状态,由 lease 自动设置'),
  ('resource_status', 'dirty',       'Dirty 需清理',    50, 'inactive', '系统状态,需人工清理后才能恢复'),
  ('resource_status', 'queue',       'Queue 排队中',    60, 'inactive', '系统状态,资源在队列中');

-- Agent 状态 (Agent 表单)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('agent_status', 'online',      'Online 在线',     10, 'active', 'Agent 可接收任务'),
  ('agent_status', 'offline',     'Offline 离线',    20, 'active', 'Agent 已下线'),
  ('agent_status', 'maintenance', 'Maintenance 维护', 30, 'active', 'Agent 维护中,暂不接任务');

-- 任务类型 (EDA 预约表单)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('task_type', 'release_gate',         'Release Gate 发版门禁',     10, 'active', '发版门禁测试,优先级最高 P100'),
  ('task_type', 'nightly_regression',   'Nightly Regression 夜间回归', 20, 'active', '夜间回归测试 P80'),
  ('task_type', 'module_owner_debug',   'Module Owner Debug 模块调试', 30, 'active', '模块负责人调试 P70'),
  ('task_type', 'normal_execute',       'Normal Execute 常规执行',   40, 'active', '常规执行任务 P50'),
  ('task_type', 'dry_run',              'Dry-run 干跑',              50, 'active', '模拟执行 P30'),
  ('task_type', 'exploratory',          'Exploratory 探索',          60, 'active', '探索性测试 P20');

-- Bug 卡片状态 (Bug 状态筛选 + 表单)
INSERT IGNORE INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description) VALUES
  ('bug_status', 'draft',        'Draft 草稿',        10, 'active', '新建草稿'),
  ('bug_status', 'auto_parsed',  'Auto-parsed 自动解析', 20, 'active', '已自动解析,待审核'),
  ('bug_status', 'under_review', 'Under Review 审核中', 30, 'active', '审核中'),
  ('bug_status', 'approved',     'Approved 已审核',   40, 'active', '审核通过'),
  ('bug_status', 'rejected',     'Rejected 已拒绝',   50, 'active', '审核拒绝'),
  ('bug_status', 'published',    'Published 已发布',   60, 'active', '已发布到知识库');
