const pool = require('../db');
const { isAdmin } = require('../middleware');
const { safeJson, jsonValue, newId, parsePositiveInt, normalizeMode, normalizeStatus } = require('./agentUtils');
const resourceSchedulerService = require('./resourceSchedulerService');

function mapAgent(row) {
  return {
    ...row,
    allowed_tools: safeJson(row.allowed_tools, []),
    allowed_envs: safeJson(row.allowed_envs, []),
    allowed_modes: safeJson(row.allowed_modes, []),
    allowed_modules: safeJson(row.allowed_modules, []),
    requires_approval_for: safeJson(row.requires_approval_for, []),
    default_safety_policy: safeJson(row.default_safety_policy, {}),
    metrics: safeJson(row.metrics, {})
  };
}

function mapTask(row) {
  return {
    ...row,
    agents: safeJson(row.agents, []),
    shared_state: safeJson(row.shared_state, {}),
    artifacts: safeJson(row.artifacts, {}),
    verdict: safeJson(row.verdict, null),
    metadata: safeJson(row.metadata, {})
  };
}

class AgentConsoleService {
  async listAgents(filters = {}) {
    const conditions = [];
    const params = [];
    if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
    if (filters.role) { conditions.push('role = ?'); params.push(filters.role); }
    conditions.push('deleted_at IS NULL');
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await pool.execute(`SELECT * FROM agent_registry ${where} ORDER BY display_name`, params);
    return rows.map(mapAgent);
  }

  async upsertAgent(user, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const agentId = data.agentId || data.agent_id;
    if (!agentId) throw new Error('agentId不能为空');
    await pool.execute(
      `INSERT INTO agent_registry
       (agent_id, display_name, role, version, description, allowed_tools, allowed_envs,
        allowed_modes, allowed_modules, requires_approval_for, default_safety_policy, status, metrics)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name), role = VALUES(role), version = VALUES(version), description = VALUES(description),
        allowed_tools = VALUES(allowed_tools), allowed_envs = VALUES(allowed_envs), allowed_modes = VALUES(allowed_modes),
        allowed_modules = VALUES(allowed_modules), requires_approval_for = VALUES(requires_approval_for),
        default_safety_policy = VALUES(default_safety_policy), status = VALUES(status), metrics = VALUES(metrics), updated_at = NOW()`,
      [
        agentId,
        data.displayName || data.display_name || agentId,
        data.role || 'custom_agent',
        data.version || 'v1',
        data.description || null,
        jsonValue(data.allowedTools || data.allowed_tools || []),
        jsonValue(data.allowedEnvs || data.allowed_envs || []),
        jsonValue(data.allowedModes || data.allowed_modes || ['advisory']),
        jsonValue(data.allowedModules || data.allowed_modules || []),
        jsonValue(data.requiresApprovalFor || data.requires_approval_for || []),
        jsonValue(data.defaultSafetyPolicy || data.default_safety_policy || {}),
        normalizeStatus(data.status, 'online'),
        jsonValue(data.metrics || {})
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM agent_registry WHERE agent_id = ? AND deleted_at IS NULL', [agentId]);
    return mapAgent(rows[0]);
  }

  async createTask(user, data) {
    const mode = normalizeMode(data.mode);
    const taskId = data.taskId || data.task_id || newId('AT');
    const agents = data.agents || ['planner_agent', 'sdk_cli_agent_v1', 'traffic_agent_v1', 'critic_agent_v1'];
    const approvalRequired = Boolean(data.approvalRequired || data.approval_required || ['execute', 'autonomous'].includes(mode));
    const sharedState = {
      test_id: taskId,
      phase: 'IDLE',
      chip_version: data.chipVersion || data.chip_version || null,
      target_env: data.targetEnv || data.target_env || null,
      topology: data.topology || {},
      config_state: {},
      traffic_state: {},
      observations: { cli_counters: {}, traffic_stats: {}, logs: [] },
      locks: {}
    };
    await pool.execute(
      `INSERT INTO agent_tasks
       (task_id, created_by, project_id, module_id, module_name, chip_version_id, chip_version,
        target_env, mode, objective, agents, status, approval_required, approval_status,
        shared_state, artifacts, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        user.id,
        parsePositiveInt(data.projectId || data.project_id),
        parsePositiveInt(data.moduleId || data.module_id),
        data.moduleName || data.module || null,
        parsePositiveInt(data.chipVersionId || data.chip_version_id),
        data.chipVersion || data.chip_version || null,
        data.targetEnv || data.target_env || null,
        mode,
        data.objective || data.queryText || 'Agent任务',
        jsonValue(agents),
        approvalRequired ? 'waiting_for_critic_review' : 'draft',
        approvalRequired ? 1 : 0,
        approvalRequired ? 'pending' : 'not_required',
        jsonValue(sharedState),
        jsonValue(data.artifacts || {}),
        jsonValue(data.metadata || {})
      ]
    );
    await this.appendAudit(user, 'agent_task_created', { taskId, mode, module: data.moduleName || data.module || null });
    if (global.io) {
      global.io.emit('agent:task_created', { taskId, stage: 'created' });
      if (approvalRequired) {
        global.io.emit('agent:approval_needed', { taskId, mode, moduleId: data.moduleId || data.module_id });
      }
    }
    return this.getTask(user, taskId);
  }

  async getTask(user, taskId) {
    const [rows] = await pool.execute('SELECT * FROM agent_tasks WHERE task_id = ? LIMIT 1', [taskId]);
    if (rows.length === 0) return null;
    const task = mapTask(rows[0]);
    if (task.created_by !== user.id && !isAdmin(user)) throw new Error('无权访问该任务');
    return task;
  }

  async listTasks(user, filters = {}) {
    const conditions = [];
    const params = [];
    if (!isAdmin(user)) { conditions.push('created_by = ?'); params.push(user.id); }
    if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
    if (filters.mode) { conditions.push('mode = ?'); params.push(filters.mode); }
    if (filters.moduleId) { conditions.push('module_id = ?'); params.push(filters.moduleId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(parsePositiveInt(filters.limit, 50), 100));
    const [rows] = await pool.execute(`SELECT * FROM agent_tasks ${where} ORDER BY created_at DESC LIMIT ${limit}`, params);
    return rows.map(mapTask);
  }

  async updateTaskStatus(user, taskId, status, patch = {}) {
    const task = await this.getTask(user, taskId);
    if (!task) throw new Error('任务不存在');
    const nextState = { ...(task.shared_state || {}), ...(patch.sharedState || patch.shared_state || {}) };
    const artifacts = { ...(task.artifacts || {}), ...(patch.artifacts || {}) };
    const verdict = patch.verdict !== undefined ? patch.verdict : task.verdict;
    await pool.execute(
      `UPDATE agent_tasks SET status = ?, shared_state = ?, artifacts = ?, verdict = ?, completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN NOW() ELSE completed_at END WHERE task_id = ?`,
      [normalizeStatus(status, task.status), jsonValue(nextState), jsonValue(artifacts), jsonValue(verdict), normalizeStatus(status, task.status), taskId]
    );
    await this.appendAudit(user, 'agent_task_status_changed', { taskId, status });
    if (global.io) {
      global.io.emit('agent:task_status_changed', { taskId, status });
      if (['completed','failed','cancelled'].includes(normalizeStatus(status, task.status))) {
        const updated = await this.getTask(user, taskId);
        global.io.emit('agent:task_completed', { taskId, status: normalizeStatus(status, task.status), verdict: updated.verdict });
      }
    }
    return this.getTask(user, taskId);
  }

  async createSession(user, taskId, data = {}) {
    const task = await this.getTask(user, taskId);
    if (!task) throw new Error('任务不存在');
    const sessionId = data.sessionId || data.session_id || newId('AS');
    await pool.execute(
      `INSERT INTO agent_session
       (session_id, task_id, test_id, user_id, module, chip_version, chip_version_id, target_env,
        mode, phase, status, lease_id, workspace_path, knowledge_snapshot, shared_state, created_by, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        taskId,
        data.testId || taskId,
        user.id,
        task.module_name,
        task.chip_version,
        task.chip_version_id,
        task.target_env,
        task.mode,
        data.phase || 'LEARN_CONTEXT',
        data.leaseId || task.lease_id || null,
        data.workspacePath || `task_runs/${taskId}/`,
        data.knowledgeSnapshot || task.knowledge_snapshot || null,
        jsonValue(task.shared_state || {}),
        String(user.id),
        jsonValue(data.metadata || {})
      ]
    );
    await this.emitEvent({ sessionId, taskId, eventType: 'SESSION_CREATED', senderAgent: 'system', payload: { phase: 'LEARN_CONTEXT' } });
    return this.getSession(user, sessionId);
  }

  async getSession(user, sessionId) {
    const [rows] = await pool.execute('SELECT * FROM agent_session WHERE session_id = ? LIMIT 1', [sessionId]);
    if (rows.length === 0) return null;
    const session = {
      ...rows[0],
      shared_state: safeJson(rows[0].shared_state, {}),
      metadata: safeJson(rows[0].metadata, {})
    };
    if (session.user_id !== user.id && !isAdmin(user)) throw new Error('无权访问该会话');
    return session;
  }

  async emitEvent({ sessionId, taskId, eventType, senderAgent, receiverAgent, phase, payload }) {
    await pool.execute(
      `INSERT INTO agent_events (session_id, task_id, event_type, sender_agent, receiver_agent, phase, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, taskId || null, eventType, senderAgent || null, receiverAgent || null, phase || null, jsonValue(payload || {})]
    );
    if (phase) {
      await pool.execute('UPDATE agent_session SET phase = ? WHERE session_id = ?', [phase, sessionId]);
    }
    if (global.io) {
      global.io.emit('agent:event_emitted', { taskId, eventType, senderAgent, receiverAgent, phase, payload: payload || {} });
      if (phase) {
        global.io.emit('agent:task_stage_changed', { taskId, toStage: this._mapPhaseToStage(phase, {}), agentId: senderAgent });
      }
    }
    return { sessionId, eventType, phase, payload: payload || {} };
  }

  async listEvents(user, sessionId) {
    await this.getSession(user, sessionId);
    const [rows] = await pool.execute('SELECT * FROM agent_events WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT 200', [sessionId]);
    return rows.map(row => ({ ...row, payload: safeJson(row.payload, {}) }));
  }

  async bindLease(user, taskId, leaseId) {
    const task = await this.getTask(user, taskId);
    const leaseCheck = await resourceSchedulerService.validateLeaseForAction({ leaseId, taskId, userId: user.id });
    if (!leaseCheck.valid) throw new Error('Lease无效或已过期');
    const sharedState = { ...(task.shared_state || {}), locks: { ...((task.shared_state || {}).locks || {}), lease_id: leaseId } };
    await pool.execute('UPDATE agent_tasks SET lease_id = ?, shared_state = ? WHERE task_id = ?', [leaseId, jsonValue(sharedState), taskId]);
    await this.appendAudit(user, 'agent_task_lease_bound', { taskId, leaseId });
    return this.getTask(user, taskId);
  }

  async approveTask(user, taskId, decision = 'approved', comment = '') {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const normalizedDecision = decision === 'rejected' ? 'rejected' : 'approved';
    const [rows] = await pool.execute('SELECT task_id FROM agent_tasks WHERE task_id = ? LIMIT 1', [taskId]);
    if (rows.length === 0) throw new Error('任务不存在');
    await pool.execute(
      `UPDATE agent_tasks
       SET approval_status = ?, status = CASE WHEN ? = 'approved' THEN 'approved' ELSE 'rejected' END
       WHERE task_id = ?`,
      [normalizedDecision, normalizedDecision, taskId]
    );
    await this.appendAudit(user, 'agent_task_approval_decision', { taskId, verdict: normalizedDecision, comment });
    if (global.io) {
      global.io.emit('agent:approval_decided', { taskId, decision: normalizedDecision, comment });
    }
    return this.getTask(user, taskId);
  }

  async appendAudit(user, auditType, data = {}) {
    await pool.execute(
      `INSERT INTO agent_audit_logs (audit_id, audit_type, task_id, session_id, lease_id, resource_id, user_id, module, mode, verdict, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('AUDIT'), auditType, data.taskId || null, data.sessionId || null, data.leaseId || null, data.resourceId || null, user?.id || null, data.module || null, data.mode || null, data.verdict || null, jsonValue(data)]
    );
  }

  async createJointVerdict(user, taskId, data = {}) {
    const task = await this.getTask(user, taskId);
    if (!task) throw new Error('任务不存在');
    const trafficStats = data.trafficStats || data.traffic_stats || {};
    const cliCounters = data.cliCounters || data.cli_counters || {};
    const criteria = {
      deadlock_recovered: data.deadlockRecovered ?? data.deadlock_recovered ?? null,
      recovery_time_ms: data.recoveryTimeMs ?? data.recovery_time_ms ?? null,
      loss_after_recovery: data.lossAfterRecovery ?? data.loss_after_recovery ?? null,
      queue_not_stuck: data.queueNotStuck ?? data.queue_not_stuck ?? null,
      cli_counter_matches_traffic: data.cliCounterMatchesTraffic ?? data.cli_counter_matches_traffic ?? null
    };
    const verdict = {
      verdict: data.verdict || 'inconclusive',
      criteria,
      traffic_evidence: data.trafficEvidence || data.traffic_evidence || trafficStats,
      cli_evidence: data.cliEvidence || data.cli_evidence || cliCounters,
      failure_signature: data.failureSignature || data.failure_signature || null,
      next_action: data.nextAction || data.next_action || null,
      created_at: new Date().toISOString()
    };
    await pool.execute('UPDATE agent_tasks SET verdict = ?, status = ? WHERE task_id = ?', [jsonValue(verdict), verdict.verdict === 'passed' ? 'completed' : 'diagnosing', taskId]);
    await this.appendAudit(user, 'joint_verdict_created', { taskId, verdict: verdict.verdict, payload: verdict });
    return this.getTask(user, taskId);
  }

  async listAuditLogs(user, filters = {}) {
    const conditions = [];
    const params = [];
    if (!isAdmin(user)) { conditions.push('a.user_id = ?'); params.push(user.id); }
    if (filters.taskId) { conditions.push('a.task_id = ?'); params.push(filters.taskId); }
    if (filters.auditType) { conditions.push('a.audit_type = ?'); params.push(filters.auditType); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(parsePositiveInt(filters.limit, 50), 100));
    const [rows] = await pool.execute(
      `SELECT a.*, u.username AS operator_username FROM agent_audit_logs a LEFT JOIN users u ON a.user_id = u.id ${where} ORDER BY a.created_at DESC LIMIT ${limit}`,
      params
    );
    return rows.map(row => ({ ...row, payload: safeJson(row.payload, {}) }));
  }

  async dashboard(user) {
    const userFilter = isAdmin(user) ? '' : 'WHERE created_by = ?';
    const params = isAdmin(user) ? [] : [user.id];
    const [taskRows] = await pool.execute(`SELECT status, COUNT(*) count FROM agent_tasks ${userFilter} GROUP BY status`, params);
    const [agentRows] = await pool.execute("SELECT status, COUNT(*) count FROM agent_registry WHERE deleted_at IS NULL GROUP BY status");
    const resources = await resourceSchedulerService.listResources({});
    return {
      tasks: taskRows,
      agents: agentRows,
      resources: {
        total: resources.length,
        idle: resources.filter(r => r.status === 'idle').length,
        leased: resources.filter(r => r.status === 'leased').length,
        dirty: resources.filter(r => r.status === 'dirty').length
      }
    };
  }

  // ===== Part 2: 模块知识健康度 =====
  // 5 维度评分: docCompleteness(25%) + drvSdkConsistency(20%) + bugCoverage(20%)
  //           + testPointCoverage(20%) + executionStability(15%)
  // 评分写回 modules 表,前端可按 health_score 排序/筛选模块
  async getModuleHealth(moduleId) {
    // 1. 文档完整度: 已解析文档数 / 文档总数
    const [docRows] = await pool.execute(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN parse_status = "parsed" THEN 1 ELSE 0 END) AS parsed FROM module_knowledge_files WHERE module_id = ? AND deleted_at IS NULL',
      [moduleId]
    );
    const docTotal = docRows[0].total || 0;
    const docParsed = docRows[0].parsed || 0;
    const docScore = docTotal === 0 ? 0 : Math.round((docParsed / docTotal) * 100);

    // 2. DRV/SDK 一致性: 用冲突文档数倒推 (spec 原写 parse_status='conflict' 但该列无此值,
    //    改用 Part 3 新增的 conflict_flags JSON 列 + review_status='rejected' 检测真实冲突)
    const [conflictRows] = await pool.execute(
      "SELECT COUNT(*) AS conflicts FROM module_knowledge_files WHERE module_id = ? AND deleted_at IS NULL AND (conflict_flags IS NOT NULL OR review_status = 'rejected')",
      [moduleId]
    );
    const consistencyScore = docTotal === 0 ? 0 : Math.max(0, 100 - (conflictRows[0].conflicts || 0) * 10);

    // 3. Bug 覆盖: 已审核 bug 卡数 - open gap 报告扣分
    const [bugRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM bug_method_cards WHERE module_id = ? AND status = "approved"',
      [moduleId]
    );
    const [gapRows] = await pool.execute(
      'SELECT COUNT(*) AS gaps FROM bug_test_gap_reports WHERE module = (SELECT name FROM modules WHERE id = ?) AND status = "open"',
      [moduleId]
    );
    const bugScore = Math.min(100, (bugRows[0].total || 0) * 10 - (gapRows[0].gaps || 0) * 5);

    // 4. 测试点覆盖: level1_points 数量 * 5 (上限 100)
    const [tpRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM level1_points WHERE module_id = ?',
      [moduleId]
    );
    const tpScore = Math.min(100, (tpRows[0].total || 0) * 5);

    // 5. 执行稳定性: 近 30 天 agent_tasks 通过率
    const [execRows] = await pool.execute(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN verdict IS NOT NULL AND JSON_EXTRACT(verdict, "$.verdict") = "passed" THEN 1 ELSE 0 END) AS passed FROM agent_tasks WHERE module_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)',
      [moduleId]
    );
    const execTotal = execRows[0].total || 0;
    const execPassed = execRows[0].passed || 0;
    const stabilityScore = execTotal === 0 ? 50 : Math.round((execPassed / execTotal) * 100);

    // 加权汇总
    const healthScore = Math.round(
      docScore * 0.25 +
      consistencyScore * 0.20 +
      Math.max(0, bugScore) * 0.20 +
      tpScore * 0.20 +
      stabilityScore * 0.15
    );

    const breakdown = {
      docCompleteness: docScore,
      drvSdkConsistency: consistencyScore,
      bugCoverage: Math.max(0, bugScore),
      testPointCoverage: tpScore,
      executionStability: stabilityScore
    };

    // 写回 modules 表
    try {
      await pool.execute(
        'UPDATE modules SET health_score = ?, health_checked_at = NOW(), health_breakdown = ? WHERE id = ?',
        [healthScore, JSON.stringify(breakdown), moduleId]
      );
    } catch (err) {
      // health_score 列可能未迁移,容错处理:仅返回不写回
      console.warn('写入 health_score 失败,可能列未迁移:', err.message);
    }

    return { moduleId, healthScore, breakdown };
  }

  // 批量获取模块健康度列表(供前端模块列表展示)
  async listModuleHealth(filters = {}) {
    const limit = Math.max(1, Math.min(parsePositiveInt(filters.limit, 50), 200));
    let where = 'WHERE 1=1';
    const params = [];
    if (filters.moduleId) {
      where += ' AND id = ?';
      params.push(filters.moduleId);
    }
    const [rows] = await pool.execute(
      `SELECT id, name, health_score, health_checked_at, health_breakdown, taxonomy_path, taxonomy_level
       FROM modules ${where}
       ORDER BY health_score DESC, name ASC
       LIMIT ${limit}`,
      params
    );
    return rows.map(row => ({
      ...row,
      health_breakdown: safeJson(row.health_breakdown, null)
    }));
  }

  // ===== Agent 调度中心 Pipeline =====

  static PIPELINE_STAGES = [
    { id: 'created', name: '已创建', agentRole: 'system' },
    { id: 'learn_context', name: '学习上下文', agentRole: 'planner_agent' },
    { id: 'approval_gate', name: '审批门', agentRole: 'critic_agent' },
    { id: 'execute_config', name: 'SDK配置', agentRole: 'sdk_cli_agent_v1' },
    { id: 'execute_traffic', name: '流量执行', agentRole: 'traffic_agent_v1' },
    { id: 'critic_gate', name: '评审门', agentRole: 'critic_agent_v1' },
    { id: 'completed', name: '已完成', agentRole: 'system' }
  ];

  _mapPhaseToStage(phase, task) {
    if (!phase) return 'created';
    const p = String(phase).toLowerCase();
    if (p === 'idle') return 'created';
    if (p === 'learn_context') return 'learn_context';
    if (p === 'execute_config') return 'execute_config';
    if (p === 'execute_traffic') return 'execute_traffic';
    if (p === 'critic_gate') {
      if (task && task.approval_status === 'pending') return 'approval_gate';
      return 'critic_gate';
    }
    if (p === 'observe') return 'completed';
    return 'created';
  }

  _mapTaskToStage(task, session) {
    if (!task) return 'created';
    const ts = String(task.status || '').toLowerCase();
    if (['completed','failed','cancelled'].includes(ts)) return 'completed';
    if (ts === 'waiting_for_critic_review' && task.approval_status === 'pending') return 'approval_gate';
    if (session && session.phase) return this._mapPhaseToStage(session.phase, task);
    if (ts === 'approved' || ts === 'diagnosing') return 'execute_config';
    if (ts === 'rejected') return 'completed';
    return 'created';
  }

  _mapEventToStage(evt) {
    const et = String(evt.event_type || '').toUpperCase();
    const ph = String(evt.phase || '').toLowerCase();
    if (et === 'SESSION_CREATED' || ph === 'learn_context') return 'learn_context';
    if (ph === 'execute_config' || et === 'CLI_COMMAND') return 'execute_config';
    if (ph === 'execute_traffic' || et.startsWith('TRAFFIC_')) return 'execute_traffic';
    if (ph === 'critic_gate') return 'critic_gate';
    if (ph === 'observe') return 'completed';
    if (et === 'APPROVAL_REQUIRED' || et === 'APPROVAL_NEEDED') return 'approval_gate';
    if (et === 'TASK_COMPLETED' || et === 'TASK_FAILED') return 'completed';
    return null;
  }

  _buildStageTimeline(events) {
    const timeline = AgentConsoleService.PIPELINE_STAGES.map(s => ({
      stage: s.id, name: s.name, agentRole: s.agentRole,
      status: 'pending', enteredAt: null, exitedAt: null, durationSec: null, agentId: null
    }));
    for (const evt of events) {
      const stageId = this._mapEventToStage(evt);
      if (!stageId) continue;
      const entry = timeline.find(t => t.stage === stageId);
      if (!entry) continue;
      if (!entry.enteredAt) {
        entry.enteredAt = evt.created_at;
        entry.status = 'running';
        entry.agentId = evt.sender_agent;
      }
      entry._lastSeen = evt.created_at;
    }
    let currentIdx = -1;
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].enteredAt) currentIdx = i;
    }
    for (let i = 0; i < timeline.length; i++) {
      if (i < currentIdx) timeline[i].status = 'passed';
      else if (i === currentIdx) timeline[i].status = timeline[i].status === 'running' ? 'running' : 'passed';
      else timeline[i].status = 'pending';
    }
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].enteredAt && i + 1 < timeline.length && timeline[i + 1].enteredAt) {
        timeline[i].exitedAt = timeline[i + 1].enteredAt;
        timeline[i].durationSec = Math.round((new Date(timeline[i].exitedAt) - new Date(timeline[i].enteredAt)) / 1000);
      }
    }
    return timeline;
  }

  async getPipelineBoard(user, filters = {}) {
    const conditions = [];
    const params = [];
    if (!isAdmin(user)) { conditions.push('created_by = ?'); params.push(user.id); }
    const statusFilter = filters.status;
    if (statusFilter === 'active') {
      conditions.push("status NOT IN ('completed','failed','cancelled')");
    } else if (statusFilter === 'completed') {
      conditions.push("status IN ('completed','failed','cancelled')");
    } else if (statusFilter) {
      conditions.push('status = ?'); params.push(statusFilter);
    }
    if (filters.mode) { conditions.push('mode = ?'); params.push(filters.mode); }
    if (filters.moduleId) { conditions.push('module_id = ?'); params.push(filters.moduleId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(parsePositiveInt(filters.limit, 30), 50));
    const [taskRows] = await pool.execute(
      `SELECT * FROM agent_tasks ${where} ORDER BY created_at DESC LIMIT ${limit}`, params
    );
    const taskIds = taskRows.map(r => r.task_id);
    let sessionMap = {};
    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => '?').join(',');
      const [sessionRows] = await pool.execute(
        `SELECT s.* FROM agent_session s
         INNER JOIN (SELECT task_id, MAX(id) AS max_id FROM agent_session GROUP BY task_id) latest
         ON s.id = latest.max_id
         WHERE s.task_id IN (${placeholders})`,
        taskIds
      );
      sessionMap = {};
      for (const s of sessionRows) {
        sessionMap[s.task_id] = { ...s, shared_state: safeJson(s.shared_state, {}), metadata: safeJson(s.metadata, {}) };
      }
    }
    let lastEventMap = {};
    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => '?').join(',');
      const [eventRows] = await pool.execute(
        `SELECT e.* FROM agent_events e
         INNER JOIN (SELECT task_id, MAX(id) AS max_id FROM agent_events GROUP BY task_id) latest
         ON e.id = latest.max_id
         WHERE e.task_id IN (${placeholders})`,
        taskIds
      );
      for (const e of eventRows) {
        lastEventMap[e.task_id] = { ...e, payload: safeJson(e.payload, {}) };
      }
    }
    let leaseMap = {};
    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => '?').join(',');
      const [leaseRows] = await pool.execute(
        `SELECT * FROM env_resource_lease WHERE task_id IN (${placeholders}) AND lease_status = 'active'`,
        taskIds
      );
      for (const l of leaseRows) {
        leaseMap[l.task_id] = { ...l, bound_resources: safeJson(l.bound_resources, []), metadata: safeJson(l.metadata, {}) };
      }
    }
    const tasks = taskRows.map(row => {
      const task = mapTask(row);
      const session = sessionMap[task.task_id] || null;
      const lastEvent = lastEventMap[task.task_id] || null;
      const lease = leaseMap[task.task_id] || null;
      const currentStage = this._mapTaskToStage(task, session);
      const stageStatus = ['completed','failed','cancelled'].includes(String(task.status).toLowerCase())
        ? (String(task.status).toLowerCase() === 'completed' ? 'passed' : String(task.status).toLowerCase())
        : (task.status === 'waiting_for_critic_review' && task.approval_status === 'pending' ? 'blocked' : 'running');
      return {
        taskId: task.task_id,
        moduleId: task.module_id,
        moduleName: task.module_name,
        chipVersion: task.chip_version,
        targetEnv: task.target_env,
        mode: task.mode,
        objective: task.objective,
        status: task.status,
        approvalStatus: task.approval_status,
        agents: task.agents,
        currentStage,
        stageStatus,
        stageEnteredAt: session ? session.started_at : task.created_at,
        activeAgent: session ? session.phase : null,
        leaseId: lease ? lease.lease_id : null,
        leaseResourceId: lease ? lease.resource_id : null,
        leaseExpiresAt: lease ? lease.expires_at : null,
        lastEvent: lastEvent ? {
          eventType: lastEvent.event_type,
          senderAgent: lastEvent.sender_agent,
          createdAt: lastEvent.created_at,
          phase: lastEvent.phase
        } : null,
        createdAt: task.created_at,
        completedAt: task.completed_at,
        verdict: task.verdict
      };
    });
    const [agentRows] = await pool.execute("SELECT * FROM agent_registry WHERE deleted_at IS NULL");
    const agentTaskMap = {};
    for (const t of tasks) {
      const role = AgentConsoleService.PIPELINE_STAGES.find(s => s.id === t.currentStage)?.agentRole;
      if (role && role !== 'system') {
        const agent = agentRows.find(a => a.role === role || a.agent_id === role);
        if (agent) {
          agentTaskMap[agent.agent_id] = agentTaskMap[agent.agent_id] || [];
          agentTaskMap[agent.agent_id].push(t.taskId);
        }
      }
    }
    const agents = agentRows.map(row => {
      const a = mapAgent(row);
      return {
        agentId: a.agent_id,
        displayName: a.display_name,
        role: a.role,
        status: a.status,
        currentTaskIds: agentTaskMap[a.agent_id] || [],
        activeTaskCount: (agentTaskMap[a.agent_id] || []).length,
        metrics: a.metrics
      };
    });
    // summary 统计独立于筛选条件，查询全局数据
    const summaryWhere = isAdmin(user) ? '' : 'WHERE created_by = ?';
    const summaryParams = isAdmin(user) ? [] : [user.id];
    const [statRows] = await pool.execute(
      `SELECT
        SUM(CASE WHEN status NOT IN ('completed','failed','cancelled') THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'waiting_for_critic_review' AND approval_status = 'pending' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM agent_tasks ${summaryWhere}`,
      summaryParams
    );
    const stat = statRows[0] || {};
    const summary = {
      running: stat.running || 0,
      blocked: stat.blocked || 0,
      completed: stat.completed || 0,
      failed: stat.failed || 0
    };
    return { summary, stages: AgentConsoleService.PIPELINE_STAGES, tasks, agents };
  }

  async getPipelineTaskDetail(user, taskId) {
    const task = await this.getTask(user, taskId);
    if (!task) throw new Error('任务不存在');
    const [sessionRows] = await pool.execute(
      'SELECT * FROM agent_session WHERE task_id = ? ORDER BY id DESC LIMIT 1', [taskId]
    );
    const session = sessionRows[0] ? { ...sessionRows[0], shared_state: safeJson(sessionRows[0].shared_state, {}), metadata: safeJson(sessionRows[0].metadata, {}) } : null;
    const [eventRows] = await pool.execute(
      'SELECT * FROM agent_events WHERE task_id = ? ORDER BY created_at ASC, id ASC LIMIT 100', [taskId]
    );
    const events = eventRows.map(e => ({ ...e, payload: safeJson(e.payload, {}) }));
    const stageTimeline = this._buildStageTimeline(events);
    const currentStage = this._mapTaskToStage(task, session);
    const [cliRows] = await pool.execute(
      'SELECT * FROM cli_command_trace WHERE task_id = ? ORDER BY command_index ASC, id ASC LIMIT 30', [taskId]
    );
    const cliTraces = cliRows.map(c => ({ ...c, parsed_result: safeJson(c.parsed_result, {}), evidence_refs: safeJson(c.evidence_refs, []) }));
    const [trafficRows] = await pool.execute(
      'SELECT * FROM traffic_run_trace WHERE task_id = ? ORDER BY id DESC LIMIT 10', [taskId]
    );
    const trafficTraces = trafficRows.map(t => ({ ...t, config: safeJson(t.config, {}), results: safeJson(t.results, {}) }));
    const [leaseRows] = await pool.execute(
      "SELECT * FROM env_resource_lease WHERE task_id = ? ORDER BY acquired_at DESC", [taskId]
    );
    const leases = leaseRows.map(l => ({ ...l, bound_resources: safeJson(l.bound_resources, []), metadata: safeJson(l.metadata, {}) }));
    const [queueRows] = await pool.execute(
      "SELECT * FROM env_resource_queue WHERE task_id = ? ORDER BY created_at DESC", [taskId]
    );
    const queues = queueRows.map(q => ({ ...q, resource_requirements: safeJson(q.resource_requirements, {}), metadata: safeJson(q.metadata, {}) }));
    const [auditRows] = await pool.execute(
      'SELECT * FROM agent_audit_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 20', [taskId]
    );
    const auditLogs = auditRows.map(a => ({ ...a, payload: safeJson(a.payload, {}) }));
    return {
      task,
      session,
      currentStage,
      stageTimeline,
      events,
      cliTraces,
      trafficTraces,
      leases,
      queues,
      auditLogs
    };
  }

  async getAgentLoad() {
    const [agentRows] = await pool.execute("SELECT * FROM agent_registry WHERE deleted_at IS NULL");
    const [activeSessionRows] = await pool.execute(
      "SELECT s.* FROM agent_session s INNER JOIN (SELECT task_id, MAX(id) AS max_id FROM agent_session GROUP BY task_id) latest ON s.id = latest.max_id WHERE s.status = 'active'"
    );
    const agentSessionMap = {};
    for (const s of activeSessionRows) {
      const stage = this._mapPhaseToStage(s.phase, {});
      const stageDef = AgentConsoleService.PIPELINE_STAGES.find(st => st.id === stage);
      if (stageDef && stageDef.agentRole !== 'system') {
        const agent = agentRows.find(a => a.role === stageDef.agentRole || a.agent_id === stageDef.agentRole);
        if (agent) {
          agentSessionMap[agent.agent_id] = agentSessionMap[agent.agent_id] || [];
          agentSessionMap[agent.agent_id].push({ taskId: s.task_id, phase: s.phase, stage });
        }
      }
    }
    return agentRows.map(row => {
      const a = mapAgent(row);
      return {
        agentId: a.agent_id,
        displayName: a.display_name,
        role: a.role,
        status: a.status,
        metrics: a.metrics,
        activeSessions: agentSessionMap[a.agent_id] || [],
        activeTaskCount: (agentSessionMap[a.agent_id] || []).length
      };
    });
  }

  async executePipelineAction(user, taskId, action, comment = '') {
    const task = await this.getTask(user, taskId);
    if (!task) throw new Error('任务不存在');
    switch (String(action).toLowerCase()) {
      case 'pause':
        return this.updateTaskStatus(user, taskId, 'paused');
      case 'resume':
        return this.updateTaskStatus(user, taskId, 'diagnosing');
      case 'cancel':
        return this.updateTaskStatus(user, taskId, 'cancelled');
      case 'approve':
        return this.approveTask(user, taskId, 'approved', comment);
      case 'reject':
        return this.approveTask(user, taskId, 'rejected', comment);
      default:
        throw new Error('不支持的操作: ' + action);
    }
  }
}

module.exports = new AgentConsoleService();
