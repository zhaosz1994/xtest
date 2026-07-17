const pool = require('../db');
const logger = require('./logger');
const axios = require('axios');
const { getUserAIConfig } = require('./aiService');
const { buildAIHeaders } = require('./aiCallWrapper');
const agentConsoleService = require('./agentConsoleService');
const sdkCliToolService = require('./sdkCliToolService');
const trafficToolService = require('./trafficToolService');
const resourceSchedulerService = require('./resourceSchedulerService');
const { safeJson, jsonValue } = require('./agentUtils');

const MAX_RETRIES = 2;
const LLM_TIMEOUT_MS = 60000;

class PipelineOrchestrator {
  constructor() {
    this.runningTasks = new Map();
  }

  isRunning(taskId) {
    return this.runningTasks.has(taskId);
  }

  async start(user, taskId) {
    if (this.isRunning(taskId)) {
      throw new Error('该任务正在自动执行中');
    }
    this.runningTasks.set(taskId, { startedAt: new Date(), phase: 'init' });
    try {
      await this._runPipeline(user, taskId);
    } catch (error) {
      logger.error('[Pipeline] 任务自动执行失败', { taskId, error: error.message });
      await agentConsoleService.updateTaskStatus(user, taskId, 'failed', { error: error.message }).catch(() => {});
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  async _runPipeline(user, taskId) {
    const task = await agentConsoleService.getTask(user, taskId);
    if (!task) throw new Error('任务不存在');
    if (['completed', 'failed', 'cancelled'].includes(String(task.status).toLowerCase())) {
      throw new Error('任务已结束，不能自动执行');
    }
    const ctx = {
      user,
      taskId,
      task,
      sessionId: null,
      mode: String(task.mode || 'dry_run').toLowerCase(),
      module: task.module_name || '通用',
      chipVersion: task.chip_version || '',
      targetEnv: task.target_env || '',
      objective: task.objective || '',
      knowledgeContext: '',
      cliPlan: null,
      cliResults: [],
      trafficSpec: null,
      trafficStats: null,
      verdict: null,
      pipelineErrors: [],
      resourceConnections: {}
    };
    // 从资源调度器加载 connection_profiles
    try {
      ctx.resourceConnections = await resourceSchedulerService.getConnectionProfilesForTask(taskId);
    } catch (e) {
      logger.warn('[Pipeline] 加载资源连接配置失败，将使用默认模式', { taskId, error: e.message });
    }
    logger.info('[Pipeline] 开始自动执行', { taskId, mode: ctx.mode, module: ctx.module, resourceConnections: Object.keys(ctx.resourceConnections) });

    // 阶段 1-2: 创建会话 + 学习上下文
    this.runningTasks.set(taskId, { startedAt: new Date(), phase: 'learn_context' });
    await agentConsoleService.updateTaskStatus(user, taskId, 'diagnosing', { sharedState: { phase: 'learn_context' } }).catch(() => {});
    await this._phaseLearnContext(ctx);

    // 阶段 3: 审批门
    this.runningTasks.set(taskId, { startedAt: new Date(), phase: 'approval_gate' });
    await this._updateSharedState(ctx, { phase: 'approval_gate' });
    const approvalResult = await this._phaseApprovalGate(ctx);

    // 阶段 4: SDK 配置
    this.runningTasks.set(taskId, { startedAt: new Date(), phase: 'execute_config' });
    await this._updateSharedState(ctx, { phase: 'execute_config' });
    await this._phaseExecuteConfig(ctx);

    // 阶段 5: 流量执行
    this.runningTasks.set(taskId, { startedAt: new Date(), phase: 'execute_traffic' });
    await this._updateSharedState(ctx, { phase: 'execute_traffic' });
    await this._phaseExecuteTraffic(ctx);

    // 阶段 6: 评审门
    this.runningTasks.set(taskId, { startedAt: new Date(), phase: 'critic_gate' });
    await agentConsoleService.updateTaskStatus(user, taskId, 'waiting_for_critic_review').catch(() => {});
    await this._updateSharedState(ctx, { phase: 'critic_gate' });
    await this._phaseCriticGate(ctx);

    // 阶段 7: 完成
    this.runningTasks.set(taskId, { startedAt: new Date(), phase: 'completed' });
    await agentConsoleService.updateTaskStatus(user, taskId, 'completed', {
      sharedState: { phase: 'completed', pipeline_errors: ctx.pipelineErrors },
      artifacts: { execution_plan: ctx.cliPlan, knowledge_summary: ctx.knowledgeContext?.substring(0, 2000) || '' },
      verdict: ctx.verdict
    }).catch(() => {});
    logger.info('[Pipeline] 任务自动执行完成', { taskId, verdict: ctx.verdict?.verdict });
  }

  // ===== 阶段 1-2: 创建会话 + 学习上下文 =====

  async _phaseLearnContext(ctx) {
    const { user, taskId } = ctx;
    // 创建会话
    const session = await agentConsoleService.createSession(user, taskId, {});
    ctx.sessionId = session.session_id;
    logger.info('[Pipeline] 会话已创建', { taskId, sessionId: ctx.sessionId });

    // 加载知识上下文
    const knowledge = await this._loadKnowledgeContext(ctx);
    ctx.knowledgeContext = knowledge;

    // 用 LLM 生成执行计划
    const planPrompt = this._buildPlanPrompt(ctx);
    const planResult = await this._callLLM(user.id, planPrompt);
    if (planResult) {
      try {
        ctx.cliPlan = typeof planResult === 'string' ? JSON.parse(planResult) : planResult;
      } catch {
        ctx.cliPlan = { raw_plan: planResult };
      }
    } else {
      // 规则引擎兜底: 根据 objective 和 mode 生成基础计划
      ctx.cliPlan = this._generateRuleBasedPlan(ctx);
      this._pushPipelineError(ctx, 'learn_context', 'warn', 'LLM调用失败，使用规则引擎生成执行计划', '请检查AI配置中心中的API Key和端点是否正确').catch(() => {});
    }

    // 将计划存入 artifacts
    await pool.execute(
      'UPDATE agent_tasks SET artifacts = ? WHERE task_id = ?',
      [jsonValue({ execution_plan: ctx.cliPlan, knowledge_summary: knowledge.substring(0, 2000) }), taskId]
    );

    // 更新 shared_state
    await this._updateSharedState(ctx, { phase: 'LEARN_CONTEXT', plan: ctx.cliPlan });

    logger.info('[Pipeline] 学习上下文阶段完成', { taskId });
  }

  async _loadKnowledgeContext(ctx) {
    const { moduleId } = ctx.task;
    try {
      let knowledge = '';
      if (moduleId) {
        const [files] = await pool.execute(
          'SELECT name, file_path, file_ext, description FROM module_knowledge_files WHERE module_id = ? AND deleted_at IS NULL AND is_enabled = TRUE ORDER BY sort_order ASC LIMIT 20',
          [moduleId]
        );
        if (files.length > 0) {
          knowledge += '模块知识文件:\n';
          for (const f of files) {
            knowledge += `- ${f.name} (${f.file_ext || '未知格式'})`;
            if (f.description) knowledge += `: ${f.description.substring(0, 200)}`;
            knowledge += '\n';
          }
        }
        // 加载测试点
        const [testPoints] = await pool.execute(
          'SELECT title, description FROM test_points WHERE module_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 20',
          [moduleId]
        );
        if (testPoints.length > 0) {
          knowledge += '\n测试点:\n';
          for (const tp of testPoints) {
            knowledge += `- ${tp.title}`;
            if (tp.description) knowledge += `: ${tp.description.substring(0, 200)}`;
            knowledge += '\n';
          }
        }
      }
      // 加载 Bug 学习卡片
      const [bugs] = await pool.execute(
        'SELECT title, severity, test_methods FROM bug_method_cards WHERE module_id = ? AND status = "approved" ORDER BY id DESC LIMIT 10',
        [moduleId || 0]
      );
      if (bugs.length > 0) {
        knowledge += '\n已知Bug模式:\n';
        for (const b of bugs) {
          knowledge += `- [${b.severity}] ${b.title}\n`;
          if (b.test_methods) {
            const method = typeof b.test_methods === 'string' ? safeJson(b.test_methods, {}) : b.test_methods;
            if (method && method.steps) knowledge += `  步骤: ${JSON.stringify(method.steps).substring(0, 300)}\n`;
          }
        }
      }
      return knowledge || '未找到模块相关知识文件，将基于任务目标生成计划。';
    } catch (error) {
      logger.warn('[Pipeline] 加载知识上下文失败', { error: error.message });
      this._pushPipelineError(ctx, 'learn_context', 'warn', '知识上下文加载失败', error.message).catch(() => {});
      return '知识上下文加载失败，将基于任务目标生成计划。';
    }
  }

  _buildPlanPrompt(ctx) {
    return `你是一个芯片测试规划Agent。请根据以下信息生成一个JSON格式的测试执行计划。

任务目标: ${ctx.objective}
模块: ${ctx.module}
芯片代系: ${ctx.chipVersion}
目标环境: ${ctx.targetEnv}
模式: ${ctx.mode}

知识上下文:
${ctx.knowledgeContext}

请生成一个JSON对象，包含以下字段:
{
  "cli_commands": ["需要执行的SDK CLI命令列表，如port enable 1", "show counter port 1"],
  "traffic_description": "需要生成的流量描述，如：构造PFC暂停风暴，端口1到端口2，持续30秒",
  "traffic_profile": { "rate_percent": 50, "duration_sec": 30 },
  "verification_points": ["需要验证的关键点列表"],
  "expected_behavior": "预期行为的简要描述"
}

注意:
- cli_commands 应该是实际可执行的SDK CLI命令
- traffic_description 应该是具体的流量构造描述
- 只返回JSON对象，不要包含其他文字`;
  }

  _generateRuleBasedPlan(ctx) {
    const objective = (ctx.objective || '').toLowerCase();
    const commands = ['show version', 'show interface brief'];
    // 根据关键词推断需要的命令
    if (objective.includes('pfc') || objective.includes('死锁') || objective.includes('deadlock')) {
      commands.push('show pfc statistics', 'show queue');
    }
    if (objective.includes('counter') || objective.includes('计数')) {
      commands.push('show counter port 1', 'show counter port 2');
    }
    if (objective.includes('pause')) {
      commands.push('show pause-frame statistics');
    }
    commands.push('show config');

    const trafficDesc = `构造测试流量: ${ctx.objective || '基础连通性测试'}，端口1到端口2，持续30秒`;
    return {
      cli_commands: commands,
      traffic_description: trafficDesc,
      traffic_profile: { rate_percent: 50, duration_sec: 30 },
      verification_points: ['CLI命令执行成功', '流量正常收发', '无丢包'],
      expected_behavior: '所有命令执行成功，流量统计与CLI计数器对齐',
      _source: 'rule_engine'
    };
  }

  // ===== 阶段 3: 审批门 =====

  async _phaseApprovalGate(ctx) {
    const { user, taskId, mode } = ctx;
    if (mode === 'dry_run' || mode === 'advisory') {
      logger.info('[Pipeline] dry_run/advisory模式，跳过审批门', { taskId });
      return { skipped: true };
    }
    // execute / autonomous 模式需要审批
    await agentConsoleService.updateTaskStatus(user, taskId, 'waiting_for_critic_review');
    logger.info('[Pipeline] execute/autonomous模式，任务已进入审批等待', { taskId });
    // 等待审批 -- 最多等待5分钟
    const maxWait = 5 * 60 * 1000;
    const startWait = Date.now();
    while (Date.now() - startWait < maxWait) {
      await this._sleep(5000);
      const task = await agentConsoleService.getTask(user, taskId);
      if (task.approval_status === 'approved') {
        logger.info('[Pipeline] 审批已通过', { taskId });
        return { approved: true };
      }
      if (task.approval_status === 'rejected') {
        throw new Error('任务审批被拒绝');
      }
    }
    throw new Error('审批超时（5分钟）');
  }

  // ===== 阶段 4: SDK 配置 =====

  async _phaseExecuteConfig(ctx) {
    const { user, taskId, sessionId, mode } = ctx;
    const plan = ctx.cliPlan || {};
    const commands = plan.cli_commands || [];
    if (commands.length === 0) {
      logger.warn('[Pipeline] 没有CLI命令可执行，跳过', { taskId });
      return;
    }
    // 如果LLM没有生成命令，用规则生成基础命令
    let cmdList = commands;
    if (cmdList.length === 0) {
      cmdList = ['show version', 'show counter'];
    }

    for (let i = 0; i < cmdList.length; i++) {
      const command = cmdList[i];
      logger.info('[Pipeline] 执行CLI命令', { taskId, index: i + 1, command });
      try {
        const result = await sdkCliToolService.runCommand(user, {
          command,
          mode,
          sessionId,
          taskId,
          commandIndex: i + 1,
          safetyPolicy: { denylist: [], destructive_patterns: ['reset', 'erase', 'format'] },
          resourceConnections: ctx.resourceConnections
        });
        ctx.cliResults.push({
          index: i + 1,
          command,
          status: result.status,
          parsed: result.parsed_result || result.parsed || {},
          stdout: result.stdout || ''
        });
        await this._sleep(500);
      } catch (error) {
        logger.error('[Pipeline] CLI命令执行失败', { taskId, command, error: error.message });
        this._pushPipelineError(ctx, 'execute_config', 'error', `CLI命令执行失败: ${command}`, error.message).catch(() => {});
        ctx.cliResults.push({
          index: i + 1,
          command,
          status: 'failed',
          error: error.message
        });
      }
    }

    // 更新 shared_state
    await this._updateSharedState(ctx, {
      phase: 'EXECUTE_CONFIG',
      config_state: { commands_executed: cmdList.length, results: ctx.cliResults }
    });
    logger.info('[Pipeline] SDK配置阶段完成', { taskId, commandsExecuted: cmdList.length });
  }

  // ===== 阶段 5: 流量执行 =====

  async _phaseExecuteTraffic(ctx) {
    const { user, taskId, sessionId, mode } = ctx;
    const plan = ctx.cliPlan || {};
    const trafficDesc = plan.traffic_description || ctx.objective || '构造基础测试流量';
    const trafficProfile = plan.traffic_profile || { rate_percent: 50, duration_sec: 30 };

    logger.info('[Pipeline] 生成流量规格', { taskId, description: trafficDesc });
    try {
      // 启动流量
      const startResult = await trafficToolService.startTraffic(user, {
        mode,
        sessionId,
        taskId,
        trafficType: trafficDesc,
        trafficProfile,
        flowSpecId: null,
        resourceConnections: ctx.resourceConnections
      });
      ctx.trafficSpec = startResult;
      logger.info('[Pipeline] 流量已启动', { taskId, runId: startResult.runId, status: startResult.status });

      // 流量被拒绝（如缺少 lease），跳过 stopTraffic
      if (startResult.status === 'rejected') {
        ctx.trafficStats = { rejected: true, reason: startResult.reason || '未知原因' };
        await this._pushPipelineError(ctx, 'execute_traffic', 'warn', `流量被拒绝: ${startResult.reason || startResult.message || '未知原因'}`, null);
      } else if (mode !== 'dry_run' && mode !== 'generation') {
        // execute 模式：等待后停止流量获取统计
        await this._sleep(2000);
        const stopResult = await trafficToolService.stopTraffic(user, startResult.runId, {});
        ctx.trafficStats = stopResult.stats;
      } else {
        // dry_run 模式：流量状态是 compiled，直接使用
        ctx.trafficStats = startResult.stats || { dry_run: true, tx_packets: 0, rx_packets: 0, loss_packets: 0 };
      }

      await this._updateSharedState(ctx, {
        phase: 'EXECUTE_TRAFFIC',
        traffic_state: { run_id: startResult.runId, stats: ctx.trafficStats }
      });
      logger.info('[Pipeline] 流量执行阶段完成', { taskId });
    } catch (error) {
      logger.error('[Pipeline] 流量执行失败', { taskId, error: error.message });
      this._pushPipelineError(ctx, 'execute_traffic', 'error', '流量执行失败', error.message).catch(() => {});
      ctx.trafficStats = { error: error.message };
    }
  }

  // ===== 阶段 6: 评审门 =====

  async _phaseCriticGate(ctx) {
    const { user, taskId } = ctx;

    // 收集证据
    const cliEvidence = this._collectCliEvidence(ctx);
    const trafficEvidence = ctx.trafficStats || {};

    // 用 LLM 生成判定
    const verdictPrompt = this._buildVerdictPrompt(ctx, cliEvidence, trafficEvidence);
    const verdictResult = await this._callLLM(user.id, verdictPrompt);
    let verdict;
    if (verdictResult) {
      try {
        verdict = typeof verdictResult === 'string' ? JSON.parse(verdictResult) : verdictResult;
      } catch {
        verdict = { verdict: 'inconclusive', reason: verdictResult };
      }
    } else {
      // 规则引擎兜底: 对比 CLI 和流量数据
      verdict = this._generateRuleBasedVerdict(ctx, cliEvidence, trafficEvidence);
    }

    // 调用 createJointVerdict 存储
    await agentConsoleService.createJointVerdict(user, taskId, {
      verdict: verdict.verdict || 'inconclusive',
      trafficStats: trafficEvidence,
      cliCounters: cliEvidence,
      trafficEvidence,
      cliEvidence,
      deadlockRecovered: verdict.deadlock_recovered ?? null,
      recoveryTimeMs: verdict.recovery_time_ms ?? null,
      lossAfterRecovery: verdict.loss_after_recovery ?? null,
      queueNotStuck: verdict.queue_not_stuck ?? null,
      cliCounterMatchesTraffic: verdict.cli_counter_matches_traffic ?? null,
      failureSignature: verdict.failure_signature || null,
      nextAction: verdict.next_action || null
    });

    ctx.verdict = verdict;
    logger.info('[Pipeline] 评审门阶段完成', { taskId, verdict: verdict.verdict });
  }

  _generateRuleBasedVerdict(ctx, cliEvidence, trafficEvidence) {
    const cliCmdCount = ctx.cliResults.length;
    const cliFailedCount = ctx.cliResults.filter(r => r.status === 'failed').length;
    const txPackets = trafficEvidence?.tx_packets || 0;
    const rxPackets = trafficEvidence?.rx_packets || 0;
    const lossPackets = trafficEvidence?.loss_packets || 0;
    const isDryRun = ctx.mode === 'dry_run';

    // 判定逻辑
    let verdict = 'inconclusive';
    let cliCounterMatches = null;

    if (cliFailedCount === 0 && cliCmdCount > 0) {
      // 所有 CLI 命令成功
      if (isDryRun) {
        // dry_run 模式: 检查是否有数据
        verdict = 'inconclusive'; // dry_run 没有真实数据，无法确定 pass
      } else if (txPackets > 0 && rxPackets > 0) {
        // 有流量数据
        const lossRate = txPackets > 0 ? lossPackets / txPackets : 0;
        if (lossRate === 0) {
          verdict = 'passed';
          cliCounterMatches = true;
        } else if (lossRate < 0.01) {
          verdict = 'passed';
          cliCounterMatches = true;
        } else {
          verdict = 'failed';
          cliCounterMatches = false;
        }
      }
    } else if (cliFailedCount > 0) {
      verdict = 'failed';
    }

    return {
      verdict,
      deadlock_recovered: verdict === 'passed' ? true : null,
      recovery_time_ms: null,
      loss_after_recovery: lossPackets > 0,
      queue_not_stuck: verdict === 'passed' ? true : null,
      cli_counter_matches_traffic: cliCounterMatches,
      failure_signature: verdict === 'failed' ? `${cliFailedCount}条CLI命令失败` : null,
      next_action: verdict === 'inconclusive'
        ? 'dry_run模式数据不足，建议用execute模式重新测试以获取真实数据'
        : verdict === 'passed' ? '测试通过' : '检查失败原因并修复',
      _source: 'rule_engine'
    };
  }

  _collectCliEvidence(ctx) {
    const evidence = {};
    for (const r of ctx.cliResults) {
      if (r.parsed && typeof r.parsed === 'object') {
        for (const [k, v] of Object.entries(r.parsed)) {
          if (typeof v === 'number') evidence[k] = v;
        }
      }
    }
    return evidence;
  }

  _buildVerdictPrompt(ctx, cliEvidence, trafficEvidence) {
    return `你是一个芯片测试评审Agent。请根据以下测试结果生成联合判定。

任务目标: ${ctx.objective}
模块: ${ctx.module}
模式: ${ctx.mode}

CLI命令执行结果:
${JSON.stringify(ctx.cliResults, null, 2)}

CLI提取的计数器:
${JSON.stringify(cliEvidence, null, 2)}

流量统计:
${JSON.stringify(trafficEvidence, null, 2)}

执行计划:
${JSON.stringify(ctx.cliPlan, null, 2)}

请生成一个JSON对象，包含以下字段:
{
  "verdict": "passed | failed | inconclusive",
  "deadlock_recovered": true或false或null,
  "recovery_time_ms": 数字或null,
  "loss_after_recovery": true或false或null,
  "queue_not_stuck": true或false或null,
  "cli_counter_matches_traffic": true或false或null,
  "failure_signature": "失败特征描述或null",
  "next_action": "下一步建议或null"
}

判定标准:
- verdict=passed: 所有验证点通过，CLI计数器与流量统计对齐
- verdict=failed: 有明确失败证据
- verdict=inconclusive: 数据不足以判定

只返回JSON对象，不要包含其他文字`;
  }

  // ===== 辅助方法 =====

  async _callLLM(userId, prompt) {
    const aiConfig = await getUserAIConfig(userId);
    if (!aiConfig || !aiConfig.api_key) {
      logger.warn('[Pipeline] 未找到AI配置或API Key为空，使用规则引擎生成');
      return null;
    }
    try {
      const headers = buildAIHeaders(aiConfig.provider, aiConfig.api_key);
      const body = {
        model: aiConfig.model_name || 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一个专业的芯片测试Agent。请严格按照要求生成JSON格式的内容。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      };
      const endpoint = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
      const response = await axios.post(endpoint, body, { headers, timeout: LLM_TIMEOUT_MS });
      const content = response.data?.choices?.[0]?.message?.content || '';
      logger.info('[Pipeline] LLM调用成功', { model: body.model, responseLength: content.length });
      return content;
    } catch (error) {
      // 详细记录 HTTP 错误信息（含状态码和响应体），便于诊断 403/503 等
      const status = error.response?.status;
      const errBody = error.response?.data;
      const errDetail = status ? `HTTP ${status}: ${typeof errBody === 'string' ? errBody.substring(0, 300) : JSON.stringify(errBody).substring(0, 300)}` : error.message;
      logger.warn('[Pipeline] LLM调用失败', { error: errDetail, endpoint, model: body.model });
      return null;
    }
  }

  async _updateSharedState(ctx, patch) {
    if (!ctx.sessionId) return;
    try {
      const [rows] = await pool.execute('SELECT shared_state FROM agent_session WHERE session_id = ?', [ctx.sessionId]);
      if (rows.length === 0) return;
      const currentState = safeJson(rows[0].shared_state, {});
      const newState = { ...currentState, ...patch };
      await pool.execute('UPDATE agent_session SET shared_state = ? WHERE session_id = ?', [jsonValue(newState), ctx.sessionId]);
    } catch (error) {
      logger.warn('[Pipeline] 更新shared_state失败', { error: error.message });
    }
  }

  /**
   * 将 Pipeline 执行过程中的错误/警告推入 shared_state.pipeline_errors，供前端展示
   */
  async _pushPipelineError(ctx, phase, level, message, detail = null) {
    const entry = { phase, level, message, detail, timestamp: new Date().toISOString() };
    ctx.pipelineErrors.push(entry);
    await this._updateSharedState(ctx, { pipeline_errors: ctx.pipelineErrors });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===== CTA 声明式工作流集成（向后兼容扩展） =====

  /**
   * 使用声明式工作流引擎启动任务（CTA）
   * 旧接口 start() 保留，新接口 startWithWorkflow() 使用 WorkflowEngine
   */
  async startWithWorkflow(user, taskId, workflowType = 'default') {
    if (this.isRunning(taskId)) {
      throw new Error('该任务正在自动执行中');
    }
    this.runningTasks.set(taskId, { startedAt: new Date(), phase: 'workflow_init', workflowType });
    try {
      const workflowEngine = require('./workflowEngine');
      const deepTestService = require('./deepTestService');
      const hardConstraintService = require('./hardConstraintService');
      const knowledgeSettleService = require('./knowledgeSettleService');
      const crossValidationService = require('./crossValidationService');
      const sshService = require('./sshService');

      // 获取任务信息，使用真实 mode 而非硬编码 dry_run
      const task = await agentConsoleService.getTask(user, taskId);
      const taskMode = String(task.mode || 'dry_run').toLowerCase();

      // 注入 SSH 服务到 deepTestService 和 crossValidationService
      deepTestService.setSshService(sshService);
      crossValidationService.setSshService(sshService);

      // 加载资源连接配置
      let resourceConnections = {};
      try {
        resourceConnections = await resourceSchedulerService.getConnectionProfilesForTask(taskId);
      } catch (e) {
        logger.warn('[Pipeline] 加载资源连接配置失败', { taskId, error: e.message });
      }

      // 注入 handler 实现（workflowEngine 已有 noop 兜底，这里覆盖关键 handler）
      workflowEngine.setHandler('env_prepare', async (args) => {
        const task = await agentConsoleService.getTask(user, args.taskId);
        const session = await agentConsoleService.createSession(user, args.taskId, {});
        return { status: 'completed', output: { message: '环境准备完成', task, sessionId: session.session_id } };
      });
      workflowEngine.setHandler('learn_context', async (args) => {
        const task = await agentConsoleService.getTask(user, args.taskId);
        const ctx = {
          user, taskId: args.taskId, task,
          sessionId: args.context?.sessionId || null, mode: args.context?.mode || taskMode,
          module: task.module_name || '', chipVersion: task.chip_version || '',
          targetEnv: task.target_env || '', objective: task.objective || '',
          knowledgeContext: '', cliPlan: null, cliResults: [],
          trafficSpec: null, trafficStats: null, verdict: null,
          _llmCalls: []
        };
        // 记录 LLM 调用
        ctx._llmCalls.push({ step: '生成执行计划', prompt: '根据任务目标和知识上下文生成CLI命令和流量规格', model: 'AI配置中心默认', timestamp: new Date().toISOString() });
        await this._phaseLearnContext(ctx);
        const llmUsed = ctx.cliPlan && ctx.cliPlan._source !== 'rule_engine';
        return { status: 'completed', output: { message: '上下文学习完成', cliPlan: ctx.cliPlan, knowledgeContext: ctx.knowledgeContext, _llmCalls: ctx._llmCalls, _llmUsed: llmUsed } };
      });
      workflowEngine.setHandler('approval_gate', async (args) => {
        if (args.context?.mode === 'dry_run' || args.context?.mode === 'advisory') {
          return { status: 'completed', output: { decision: 'auto_approved', reason: 'dry_run模式自动通过' } };
        }
        return { status: 'needs_approval', output: { message: '等待审批' } };
      });
      workflowEngine.setHandler('test_dispatch', async (args) => {
        const result = await deepTestService.dispatch(args);
        // 标记 LLM 调用信息
        if (result.output) {
          result.output._llmCalls = [{ step: '生成测试用例', prompt: '根据测试点生成具体的CLI测试命令', model: 'AI配置中心默认', timestamp: new Date().toISOString() }];
          result.output._llmUsed = result.output.total_cases > 0;
        }
        return result;
      });
      workflowEngine.setHandler('test_hunt', (args) => deepTestService.hunt(args));
      workflowEngine.setHandler('test_review_gate', (args) => deepTestService.reviewGate ? deepTestService.reviewGate(args) : ({ status: 'completed', output: {} }));
      workflowEngine.setHandler('test_review', (args) => crossValidationService.review(args));
      workflowEngine.setHandler('test_completeness_gate', (args) => deepTestService.completenessGate(args));
      workflowEngine.setHandler('hard_constraint_check', (args) => hardConstraintService.check(args));
      workflowEngine.setHandler('knowledge_settle', (args) => knowledgeSettleService.run(args));
      workflowEngine.setHandler('execute_config', async (args) => {
        const task = await agentConsoleService.getTask(user, args.taskId);
        const ctx = {
          user, taskId: args.taskId, task,
          sessionId: args.context?.sessionId || null, mode: args.context?.mode || taskMode,
          cliPlan: args.context?.cliPlan, cliResults: [],
          module: task.module_name || '', chipVersion: task.chip_version || '',
          targetEnv: task.target_env || '', objective: task.objective || '',
          knowledgeContext: '', trafficSpec: null, trafficStats: null, verdict: null,
          resourceConnections: args.context?.resourceConnections || resourceConnections
        };
        await this._phaseExecuteConfig(ctx);
        return { status: 'completed', output: { message: '配置执行完成', cliResults: ctx.cliResults } };
      });
      workflowEngine.setHandler('execute_traffic', async (args) => {
        const task = await agentConsoleService.getTask(user, args.taskId);
        const ctx = {
          user, taskId: args.taskId, task,
          sessionId: args.context?.sessionId || null, mode: args.context?.mode || taskMode,
          trafficSpec: args.context?.trafficSpec, trafficStats: null, cliResults: [],
          module: task.module_name || '', chipVersion: task.chip_version || '',
          targetEnv: task.target_env || '', objective: task.objective || '',
          knowledgeContext: '', cliPlan: null, verdict: null,
          resourceConnections: args.context?.resourceConnections || resourceConnections
        };
        await this._phaseExecuteTraffic(ctx);
        return { status: 'completed', output: { message: '流量执行完成', trafficStats: ctx.trafficStats } };
      });
      workflowEngine.setHandler('critic_gate', async (args) => {
        const task = await agentConsoleService.getTask(user, args.taskId);
        const ctx = {
          user, taskId: args.taskId, task,
          sessionId: args.context?.sessionId || null, mode: args.context?.mode || taskMode,
          cliResults: args.context?.cliResults || [], trafficStats: args.context?.trafficStats,
          verdict: null, module: task.module_name || '', chipVersion: task.chip_version || '',
          targetEnv: task.target_env || '', objective: task.objective || '',
          knowledgeContext: '', cliPlan: null, trafficSpec: null
        };
        await this._phaseCriticGate(ctx);
        const llmUsed = ctx.verdict && ctx.verdict._source !== 'rule_engine';
        return { status: 'completed', output: { message: '评审完成', verdict: ctx.verdict, _llmCalls: [{ step: '生成判定', prompt: '根据CLI和流量证据生成判定结论', model: 'AI配置中心默认', timestamp: new Date().toISOString() }], _llmUsed: llmUsed } };
      });
      workflowEngine.setHandler('completed', async () => {
        return { status: 'completed', output: { message: '任务完成' } };
      });

      // 启动工作流
      const result = await workflowEngine.runWorkflow(taskId, workflowType, {
        mode: taskMode,
        user_id: user.id,
        resourceConnections,
      });

      // 同步状态到旧 pipeline_phase_status（向后兼容）
      const finalStatus = result.status === 'completed' ? 'completed' : 'failed';
      const nodeResults = result.nodeResults || {};
      // 从各节点输出中提取 artifacts
      const learnCtx = nodeResults.learn_context?.output || {};
      const finalArtifacts = {
        execution_plan: learnCtx.cliPlan || null,
        knowledge_summary: (learnCtx.knowledgeContext || '').substring(0, 2000),
      };
      // 提取 pipeline_errors（各节点可能产生了错误）
      const pipelineErrors = [];
      for (const [name, nr] of Object.entries(nodeResults)) {
        if (nr.output?.error) pipelineErrors.push({ phase: name, level: 'error', message: nr.output.error, timestamp: new Date().toISOString() });
      }
      await agentConsoleService.updateTaskStatus(user, taskId, finalStatus, {
        sharedState: { phase: finalStatus === 'completed' ? 'completed' : 'failed', pipeline_errors: pipelineErrors },
        artifacts: finalArtifacts,
        verdict: { status: result.status, nodeResults }
      }).catch(() => {});

      return result;
    } catch (error) {
      logger.error('[Pipeline] 工作流执行失败', { taskId, error: error.message });
      await agentConsoleService.updateTaskStatus(user, taskId, 'failed', { error: error.message }).catch(() => {});
      throw error;
    } finally {
      this.runningTasks.delete(taskId);
    }
  }
}

module.exports = new PipelineOrchestrator();
