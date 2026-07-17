const pool = require('../db');
const logger = require('./logger');
const { safeJson, jsonValue, newId } = require('./agentUtils');

/**
 * 声明式工作流引擎
 * 支持节点定义、条件路由、循环控制、错误路由、审批暂停
 */
class WorkflowEngine {
  constructor(services = {}) {
    this.services = services;
    this.handlers = new Map();
    this.instances = new Map();
    this.definitionCache = new Map();
    this._registerDefaultHandlers();
  }

  /**
   * 注册默认 handler（具体实现由调用方通过 setHandler 注入）
   */
  _registerDefaultHandlers() {
    // 占位 handler，实际由外部注入
    const noop = async () => ({ status: 'completed', output: {} });
    const defaultHandlers = [
      'env_prepare','learn_context','design_understand','design_outline','expand_testpoints',
      'approval_gate','execute_config','execute_traffic','test_dispatch','test_hunt',
      'test_review_gate','test_review','test_completeness_gate','hard_constraint_check',
      'critic_gate','knowledge_settle','completed','load_existing_cases'
    ];
    for (const h of defaultHandlers) {
      this.handlers.set(h, noop);
    }
  }

  /**
   * 注入 handler 实现
   */
  setHandler(name, fn) {
    if (typeof fn !== 'function') throw new Error('handler 必须是函数');
    this.handlers.set(name, fn);
    return this;
  }

  /**
   * 加载工作流定义（DB 优先，回退文件系统）
   */
  async loadDefinition(workflowType) {
    if (this.definitionCache.has(workflowType)) {
      return this.definitionCache.get(workflowType);
    }
    let definition = null;
    // 1. 从 DB 查找
    try {
      const [rows] = await pool.execute(
        'SELECT definition_json, version FROM workflow_definitions WHERE workflow_type = ? AND status = "active" ORDER BY version DESC LIMIT 1',
        [workflowType]
      );
      if (rows.length > 0) {
        definition = typeof rows[0].definition_json === 'string'
          ? JSON.parse(rows[0].definition_json)
          : rows[0].definition_json;
      }
    } catch (e) {
      logger.warn(`[WorkflowEngine] 从DB加载工作流定义失败: ${e.message}`);
    }
    // 2. 回退到文件系统（如 workflow_definitions/default.json）
    if (!definition) {
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const filePath = path.join(__dirname, '..', 'workflow_definitions', `${workflowType}.json`);
        const content = await fs.readFile(filePath, 'utf-8');
        definition = JSON.parse(content);
      } catch (e) {
        // 文件不存在时回退到 legacy 工作流
        if (workflowType !== 'legacy') {
          logger.warn(`[WorkflowEngine] 工作流 ${workflowType} 未找到，回退到 legacy`);
          return this.loadDefinition('legacy');
        }
        throw new Error(`工作流定义不存在: ${workflowType}`);
      }
    }
    this._validateDefinition(definition);
    this.definitionCache.set(workflowType, definition);
    return definition;
  }

  /**
   * 列出所有可用工作流定义
   */
  async listDefinitions() {
    try {
      const [rows] = await pool.execute(
        'SELECT workflow_type, name, description, version, status, updated_at FROM workflow_definitions WHERE status = "active" ORDER BY workflow_type'
      );
      return rows;
    } catch (e) {
      return [];
    }
  }

  /**
   * 保存工作流定义到 DB
   */
  async saveDefinition(workflowType, name, description, definitionObj, createdBy = null) {
    const defJson = typeof definitionObj === 'string' ? definitionObj : JSON.stringify(definitionObj);
    this._validateDefinition(typeof definitionObj === 'string' ? JSON.parse(definitionObj) : definitionObj);
    // 版本递增
    const [existing] = await pool.execute(
      'SELECT MAX(version) as max_version FROM workflow_definitions WHERE workflow_type = ?',
      [workflowType]
    );
    const newVersion = (existing[0]?.max_version || 0) + 1;
    await pool.execute(
      `INSERT INTO workflow_definitions (workflow_type, name, description, definition_json, version, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [workflowType, name, description || '', defJson, newVersion, createdBy]
    );
    // 旧版本归档
    await pool.execute(
      'UPDATE workflow_definitions SET status = "archived" WHERE workflow_type = ? AND version < ?',
      [workflowType, newVersion]
    );
    this.definitionCache.delete(workflowType);
    logger.info(`[WorkflowEngine] 工作流定义已保存: ${workflowType} v${newVersion}`);
    return { workflowType, version: newVersion };
  }

  /**
   * 校验工作流定义
   */
  _validateDefinition(def) {
    if (!def || typeof def !== 'object') throw new Error('工作流定义必须是对象');
    if (!Array.isArray(def.nodes)) throw new Error('工作流定义必须有 nodes 数组');
    if (!Array.isArray(def.edges)) throw new Error('工作流定义必须有 edges 数组');
    const entryEdges = def.edges.filter(e => e.from === '__START__');
    if (entryEdges.length === 0) throw new Error('工作流必须有至少一条 __START__ 边');
    const nodeIds = new Set(def.nodes.map(n => n.id));
    nodeIds.add('__START__');
    nodeIds.add('__END__');
    for (const node of def.nodes) {
      if (!node.id) throw new Error(`节点缺少 id: ${JSON.stringify(node)}`);
      if (!node.handler) throw new Error(`节点 ${node.id} 缺少 handler`);
    }
    for (const edge of def.edges) {
      if (!nodeIds.has(edge.from)) throw new Error(`边 from 未知节点: ${edge.from}`);
      if (!nodeIds.has(edge.to)) throw new Error(`边 to 未知节点: ${edge.to}`);
    }
  }

  /**
   * 启动工作流执行
   */
  async runWorkflow(taskId, workflowType, initialContext = {}) {
    const definition = await this.loadDefinition(workflowType);
    const instanceId = await this._createInstance(taskId, workflowType, definition);
    const context = {
      taskId,
      instanceId,
      workflowType,
      phase: 'running',
      currentNode: null,
      nodeResults: {},
      sharedState: { ...initialContext },
      history: [],
      loopCount: {},
      maxLoops: definition.max_loops_per_node || 10,
      startTime: new Date(),
    };
    await this._persistContext(instanceId, context);
    const startEdges = definition.edges.filter(e => e.from === '__START__');
    const firstNode = startEdges[0].to;
    return this._executeFromNode(instanceId, definition, context, firstNode);
  }

  /**
   * 从指定节点开始执行
   */
  async _executeFromNode(instanceId, definition, context, nodeId) {
    let currentNodeId = nodeId;
    while (currentNodeId && currentNodeId !== '__END__') {
      const node = definition.nodes.find(n => n.id === currentNodeId);
      if (!node) throw new Error(`节点不存在: ${currentNodeId}`);
      // 循环次数检查
      context.loopCount[currentNodeId] = (context.loopCount[currentNodeId] || 0) + 1;
      if (context.loopCount[currentNodeId] > context.maxLoops) {
        logger.warn(`[WorkflowEngine] 节点 ${currentNodeId} 超过最大循环次数 ${context.maxLoops}`);
        break;
      }
      context.currentNode = currentNodeId;
      await this._persistContext(instanceId, context);
      this._emit('workflow:node_start', { instanceId, nodeId: node.id, nodeLabel: node.label, taskId: context.taskId });
      try {
        const handler = this._resolveHandler(node.handler);
        const result = await handler({
          taskId: context.taskId,
          node,
          context: context.sharedState,
          nodeResults: context.nodeResults,
          emit: (event, data) => this._emit('workflow:node_event', { instanceId, nodeId: node.id, event, data, taskId: context.taskId }),
        });
        const status = result?.status || 'completed';
        const output = result?.output || {};
        context.nodeResults[currentNodeId] = { status, output, timestamp: new Date() };
        // CTA: 将handler输出合并到sharedState，使后续节点可通过context访问前序节点输出
        if (output && typeof output === 'object' && !Array.isArray(output)) {
          Object.assign(context.sharedState, output);
        }
        context.history.push({ nodeId: currentNodeId, status, timestamp: new Date() });
        this._emit('workflow:node_complete', { instanceId, nodeId: node.id, result: context.nodeResults[currentNodeId], taskId: context.taskId });
        // 审批暂停
        if (node.requires_approval && status === 'needs_approval') {
          context.phase = 'awaiting_approval';
          await this._persistContext(instanceId, context);
          this._emit('workflow:approval_required', { instanceId, nodeId: node.id, output, taskId: context.taskId });
          await pool.execute(
            'UPDATE workflow_instances SET status = "awaiting_approval" WHERE instance_id = ?',
            [instanceId]
          );
          return { status: 'paused', instanceId, approvalNode: currentNodeId, context };
        }
        // 决定下一个节点
        const nextEdges = definition.edges.filter(e => e.from === currentNodeId && !e.on_error);
        if (nextEdges.length === 0) {
          break;
        } else if (nextEdges.length === 1 && !nextEdges[0].condition) {
          currentNodeId = nextEdges[0].to;
        } else {
          const nextNode = this._resolveConditionalRoute(nextEdges, context);
          if (!nextNode) throw new Error(`节点 ${currentNodeId} 没有匹配的路由`);
          currentNodeId = nextNode;
        }
      } catch (error) {
        context.nodeResults[currentNodeId] = { status: 'error', error: error.message, timestamp: new Date() };
        await this._persistContext(instanceId, context);
        logger.error(`[WorkflowEngine] 节点 ${currentNodeId} 执行失败: ${error.message}`);
        const errorEdges = definition.edges.filter(e => e.from === currentNodeId && e.on_error);
        if (errorEdges.length > 0) {
          currentNodeId = errorEdges[0].to;
        } else {
          context.phase = 'failed';
          await this._persistContext(instanceId, context);
          await pool.execute(
            'UPDATE workflow_instances SET status = "failed", completed_at = NOW() WHERE instance_id = ?',
            [instanceId]
          );
          this._emit('workflow:failed', { instanceId, nodeId: currentNodeId, error: error.message, taskId: context.taskId });
          return { status: 'failed', instanceId, error: error.message, context };
        }
      }
      await this._persistContext(instanceId, context);
    }
    context.phase = 'completed';
    context.currentNode = null;
    context.endTime = new Date();
    await this._persistContext(instanceId, context);
    await pool.execute(
      'UPDATE workflow_instances SET status = "completed", completed_at = NOW(), result_json = ? WHERE instance_id = ?',
      [JSON.stringify({ nodeResults: context.nodeResults }), instanceId]
    );
    this._emit('workflow:complete', { instanceId, context, taskId: context.taskId });
    return { status: 'completed', instanceId, nodeResults: context.nodeResults, sharedState: context.sharedState };
  }

  /**
   * 条件路由解析
   * 先匹配条件边，都不匹配时使用 default 边或无条件边
   */
  _resolveConditionalRoute(edges, context) {
    // 先匹配条件边
    for (const edge of edges) {
      if (edge.condition && this._evaluateCondition(edge.condition, context)) return edge.to;
    }
    // 条件都不匹配时，查找 default 边或无条件边
    const defaultEdge = edges.find(e => e.is_default);
    if (defaultEdge) return defaultEdge.to;
    const noConditionEdge = edges.find(e => !e.condition);
    return noConditionEdge ? noConditionEdge.to : null;
  }

  /**
   * 条件表达式求值（安全沙箱）
   */
  _evaluateCondition(expr, context) {
    try {
      // 简化条件表达式求值：仅支持点路径访问和基本运算
      // 提取形如 nodeResults.xxx.output.yyy == true 的表达式
      const match = expr.match(/^nodeResults\.(\w+)\.output\.(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
      if (match) {
        const [, nodeId, key, op, rhs] = match;
        const nodeResult = context.nodeResults[nodeId];
        const lhs = nodeResult?.output?.[key];
        const rhsTrimmed = rhs.trim().replace(/^["']|["']$/g, '');
        const rhsVal = rhsTrimmed === 'true' ? true : rhsTrimmed === 'false' ? false : (isNaN(Number(rhsTrimmed)) ? rhsTrimmed : Number(rhsTrimmed));
        switch (op) {
          case '==': return lhs == rhsVal;
          case '!=': return lhs != rhsVal;
          case '>=': return Number(lhs) >= Number(rhsVal);
          case '<=': return Number(lhs) <= Number(rhsVal);
          case '>': return Number(lhs) > Number(rhsVal);
          case '<': return Number(lhs) < Number(rhsVal);
        }
      }
      // 复合表达式：含 && 的
      if (expr.includes('&&')) {
        return expr.split('&&').every(part => this._evaluateCondition(part.trim(), context));
      }
      if (expr.includes('||')) {
        return expr.split('||').some(part => this._evaluateCondition(part.trim(), context));
      }
      // 未知表达式，回退为 false
      logger.warn(`[WorkflowEngine] 无法解析条件表达式: ${expr}`);
      return false;
    } catch (e) {
      logger.warn(`[WorkflowEngine] 条件求值失败: ${expr} - ${e.message}`);
      return false;
    }
  }

  /**
   * 解析 handler
   */
  _resolveHandler(handlerName) {
    const handler = this.handlers.get(handlerName);
    if (!handler) throw new Error(`未知 handler: ${handlerName}`);
    return handler;
  }

  /**
   * 恢复暂停的工作流（审批通过后）
   */
  async resumeWorkflow(instanceId, decision = 'approved') {
    const [rows] = await pool.execute(
      'SELECT * FROM workflow_instances WHERE instance_id = ? LIMIT 1',
      [instanceId]
    );
    if (rows.length === 0) throw new Error('工作流实例不存在');
    const inst = rows[0];
    if (inst.status !== 'awaiting_approval') throw new Error('工作流不处于待审批状态');
    let context = safeJson(inst.context_json, {});
    const definition = await this.loadDefinition(inst.workflow_type);
    await pool.execute('UPDATE workflow_instances SET status = "running" WHERE instance_id = ?', [instanceId]);
    // 从审批节点的下一个节点开始（使用条件路由解析）
    const currentNode = context.currentNode;
    const nextEdges = definition.edges.filter(e => e.from === currentNode && !e.on_error);
    let nextNode;
    if (nextEdges.length === 0) {
      nextNode = '__END__';
    } else if (nextEdges.length === 1 && !nextEdges[0].condition) {
      nextNode = nextEdges[0].to;
    } else {
      nextNode = this._resolveConditionalRoute(nextEdges, context);
      if (!nextNode) nextNode = '__END__';
    }
    if (decision === 'rejected') {
      context.phase = 'rejected';
      await this._persistContext(instanceId, context);
      await pool.execute('UPDATE workflow_instances SET status = "failed", completed_at = NOW() WHERE instance_id = ?', [instanceId]);
      return { status: 'rejected', instanceId };
    }
    return this._executeFromNode(instanceId, definition, context, nextNode);
  }

  /**
   * 获取实例详情
   */
  async getInstance(instanceId) {
    const [rows] = await pool.execute(
      'SELECT * FROM workflow_instances WHERE instance_id = ? LIMIT 1',
      [instanceId]
    );
    if (rows.length === 0) return null;
    const inst = rows[0];
    return {
      ...inst,
      context_json: safeJson(inst.context_json, {}),
      result_json: safeJson(inst.result_json, {}),
    };
  }

  /**
   * 获取任务的工作流实例
   */
  async getTaskInstance(taskId) {
    const [rows] = await pool.execute(
      'SELECT * FROM workflow_instances WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      [taskId]
    );
    if (rows.length === 0) return null;
    const inst = rows[0];
    return {
      ...inst,
      context_json: safeJson(inst.context_json, {}),
      result_json: safeJson(inst.result_json, {}),
    };
  }

  async _createInstance(taskId, workflowType, definition) {
    const instanceId = newId('WF');
    await pool.execute(
      `INSERT INTO workflow_instances (instance_id, task_id, workflow_type, definition_version, status, context_json, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, NOW())`,
      [instanceId, taskId, workflowType, definition.version || 1, JSON.stringify({})]
    );
    // 更新任务的 workflow_instance_id
    try {
      await pool.execute(
        'UPDATE agent_tasks SET workflow_instance_id = ? WHERE task_id = ?',
        [instanceId, taskId]
      );
    } catch (e) { /* 忽略字段不存在的错误 */ }
    return instanceId;
  }

  async _persistContext(instanceId, context) {
    try {
      await pool.execute(
        'UPDATE workflow_instances SET context_json = ?, current_node = ?, status = ? WHERE instance_id = ?',
        [JSON.stringify(context), context.currentNode, context.phase, instanceId]
      );
    } catch (e) {
      logger.error(`[WorkflowEngine] 持久化上下文失败: ${e.message}`);
    }
  }

  _emit(event, data) {
    if (global.io) {
      global.io.emit(event, data);
    }
  }
}

// 导出单例
const engine = new WorkflowEngine();
module.exports = engine;
module.exports.WorkflowEngine = WorkflowEngine;
