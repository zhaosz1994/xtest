# xtest吸收CTA思想与方法的改进设计报告

> **文档编号**: XTEST-ARCH-2026-001  
> **版本**: v1.0  
> **日期**: 2026-07-15  
> **作者**: AI领航员·DC技术研究助手  
> **状态**: Draft  

---

## 目录

- [一、现状差距分析](#一现状差距分析)
- [二、改进总览](#二改进总览)
- [三、后端改进详细设计](#三后端改进详细设计)
- [四、Python脚本扩展层设计](#四python脚本扩展层设计)
- [五、数据库变更](#五数据库变更)
- [六、UI层面改进](#六ui层面改进)
- [七、实施优先级与计划](#七实施优先级与计划)

---

## 一、现状差距分析

### 1.1 xtest现状概览

xtest是一个基于Node.js/Express+MySQL的芯片测试管理Web平台，当前具备以下核心能力：

| 模块 | 文件 | 行数 | 功能概述 |
|------|------|------|----------|
| Agent执行引擎 | `agentExecutionEngine.js` | 1347 | 基于LLM Function Calling的Agentic Loop，最多5轮 |
| Pipeline编排器 | `pipelineOrchestrator.js` | 552 | 固定7阶段流水线 |
| Agent控制台 | `agentConsoleService.js` | 750 | 任务CRUD+会话管理+事件流+审批+联合判定 |
| SDK CLI工具 | `sdkCliToolService.js` | 208 | session管理+命令执行，模拟实现 |
| 流量工具 | `trafficToolService.js` | 187 | 报文模板+打流+统计，dry-run模式 |
| 执行门控 | `executionGateService.js` | - | 破坏性命令防护+审批+Lease校验 |
| 资源调度 | `resourceSchedulerService.js` | - | CModel/FPGA/Veloce的Lease管理 |
| Agent工具注册表 | DB表 `agent_tool_registry` | - | DB驱动工具注册，支持script/http/cli/builtin |
| AI服务 | `aiService.js` 等 | - | 多供应商LLM、流式调用、用例生成 |
| 知识库 | `knowledgeService.js` | - | 文件解析+分块+嵌入+向量检索 |

### 1.2 CTA-v2核心能力概览

CTA-v2是一个Python/LangGraph的AI测试工作流引擎，其核心设计理念：

1. **声明式工作流DSL**: 使用YAML定义工作流，LangGraph StateGraph驱动执行
2. **12个Agent节点**: AI+Program分离设计，从env_prepare到knowledge_settle
3. **深度测试闭环**: test_dispatch→test_hunt→test_review_gate→test_review→test_completeness_gate，支持自循环补测
4. **硬约束覆盖裁决**: 从APP_NOTE提取寄存器/状态机/参数矩阵，机械比对覆盖缺口
5. **多路径交叉验证**: test_review用不同方式触发同一功能（CLI vs 寄存器写）
6. **5层容错机制**: 超时/限流/瞬断/上下文溢出/空响应
7. **SSH多会话并发+异常自愈**: 真实设备交互
8. **Agent三件套**: config.yaml + SOUL.md + USER.md

### 1.3 核心差距分析

#### 差距点1：工作流模型——固定流水线 vs 声明式工作流

**xtest现状**: `pipelineOrchestrator.js` 硬编码7个固定阶段：
```
learn_context -> approval_gate -> execute_config -> execute_traffic -> critic_gate -> completed
```
所有测试任务走同一个流程，无法适应不同测试场景（功能验证 vs 回归测试 vs 压力测试）的流程差异。新增阶段需改代码。

**CTA-v2能力**: YAML声明式工作流定义，LangGraph StateGraph引擎驱动。不同测试场景可定义不同的节点序列和条件跳转。工作流定义与执行引擎解耦。

**差距评估**: 🔴 严重。架构层面限制了测试流程的灵活性和可扩展性。

---

#### 差距点2：测试执行模式——线性执行 vs 闭环反馈

**xtest现状**: Pipeline线性执行，execute_config阶段执行完直接进入critic_gate判定，没有"发现覆盖不足→自动补测"的闭环机制。如果第一批测试用例没覆盖到的场景，需要人工介入补测。

**CTA-v2能力**: 深度测试闭环（test_dispatch→test_hunt→test_review_gate→test_review→test_completeness_gate），test_completeness_gate判断覆盖不足时自动回到test_dispatch生成补测用例，形成自循环。

**差距评估**: 🔴 严重。缺少自动化补测能力是最大差距，直接影响测试质量。

---

#### 差距点3：覆盖裁决——LLM主观判定 vs 硬约束机械比对

**xtest现状**: `critic_gate`阶段依赖LLM对测试结果做verdict判定（pass/fail/warning），叠加简单规则兜底。缺少从设计文档中提取寄存器/状态机/参数矩阵并做机械比对的硬约束覆盖能力。

**CTA-v2能力**: 从APP_NOTE等设计文档中自动提取寄存器列表、状态机转换、参数矩阵，形成硬约束清单。测试执行后机械比对每个硬约束是否被覆盖，生成覆盖率报告。

**差距评估**: 🔴 严重。纯LLM判定存在幻觉风险，硬约束机械比对是质量底线保障。

---

#### 差距点4：验证维度——单路径 vs 多路径交叉验证

**xtest现状**: 执行阶段生成CLI命令列表，单路径执行。一条命令的pass只代表该路径下功能正常，无法发现"CLI能配但寄存器写不进去"这类隐藏Bug。

**CTA-v2能力**: test_review阶段用不同方式触发同一功能（如CLI命令 vs 直接寄存器写 vs 流量触发），结果不一致即标记Bug。

**差距评估**: 🟡 中等偏严重。多路径交叉验证是发现深层次Bug的关键手段。

---

#### 差距点5：Agent执行引擎——5轮限制 vs 无限轮+5层容错

**xtest现状**: `agentExecutionEngine.js` 中 `MAX_TOOL_CALL_ROUNDS=5` 硬限制。超过5轮工具调用直接终止。无超时/限流/瞬断/上下文溢出/空响应的容错处理。

**CTA-v2能力**: 可配置轮次上限（默认无限），5层容错：
- L1: 超时重试（单工具调用超时→指数退避重试）
- L2: 限流重试（API 429→等待后重试）
- L3: 瞬断重试（SSH断连→重连+续执行）
- L4: 上下文溢出修复（对话过长→自动截断+摘要保留）
- L5: 空响应修复（LLM返回空→注入提示重试）

**差距评估**: 🟡 中等。5轮限制在复杂测试场景下不够用，容错机制缺失影响稳定性。

---

#### 差距点6：设备交互——模拟实现 vs SSH真机交互

**xtest现状**: `sdkCliToolService.js` 是模拟实现，命令执行返回mock数据。`trafficToolService.js` 是dry-run模式，不实际打流。无法连接真实DUT（被测设备）。

**CTA-v2能力**: SSH多会话并发连接真实设备，CLI命令实际执行，异常自动重连。流量工具真实打流+抓包。

**差距评估**: 🔴 严重。无法连接真机意味着整个平台只能做用例设计，无法做执行验证。

---

#### 差距点7：Agent配置——DB字段 vs 三件套体系

**xtest现状**: `agent_sub_agents`表有soul/user/tools配置字段，但粒度粗，缺少输入契约（prereq/handoff/accumulating/writes）定义，Agent间数据传递依赖硬编码。

**CTA-v2能力**: 每个Agent有config.yaml（输入契约+工具+参数）+ SOUL.md（角色人格）+ USER.md（用户偏好），输入契约明确定义prereq（前置条件）、handoff（交接物）、accumulating（累积状态）、writes（可写资源），Agent间数据流清晰。

**差距评估**: 🟡 中等。缺少输入契约导致Agent间数据流隐式、脆弱。

---

#### 差距点8：知识沉淀——即时判定 vs 闭环沉淀

**xtest现状**: 测试结果做verdict判定后即结束，生成物（测试用例、Bug记录、经验教训）不会自动入库形成知识资产。knowledge_base有向量检索但缺少自动沉淀流程。

**CTA-v2能力**: knowledge_settle阶段自动将工作流生成物（设计理解文档、测试大纲、测试计划、经验教训）入库，形成知识闭环，后续任务可检索复用。

**差距评估**: 🟡 中等。知识不沉淀导致平台无法从历史中学习。

---

### 1.4 差距矩阵总览

| # | 差距点 | xtest现状 | CTA-v2能力 | 严重度 | 改进优先级 |
|---|--------|-----------|-----------|--------|-----------|
| 1 | 工作流模型 | 固定7阶段硬编码 | YAML声明式工作流 | 🔴 严重 | P0 |
| 2 | 测试执行模式 | 线性执行无闭环 | 深度测试闭环自循环 | 🔴 严重 | P0 |
| 3 | 覆盖裁决 | LLM主观判定 | 硬约束机械比对 | 🔴 严重 | P0 |
| 4 | 验证维度 | 单路径执行 | 多路径交叉验证 | 🟡 中偏重 | P1 |
| 5 | Agent引擎 | 5轮硬限+无容错 | 无限轮+5层容错 | 🟡 中等 | P1 |
| 6 | 设备交互 | 模拟/dry-run | SSH真机交互+自愈 | 🔴 严重 | P0 |
| 7 | Agent配置 | DB字段粗粒度 | 三件套+输入契约 | 🟡 中等 | P2 |
| 8 | 知识沉淀 | 即时判定不沉淀 | 自动入库闭环 | 🟡 中等 | P2 |

---

## 二、改进总览

### 2.1 改进项总表

| # | 改进项 | 涉及文件 | 改动类型 | 新增文件 | 工作量(人日) | Phase |
|---|--------|---------|---------|---------|-------------|-------|
| 1 | 声明式工作流引擎 | `pipelineOrchestrator.js`(重写), `workflowEngine.js`(新) | 重构+新增 | `workflowEngine.js`, `workflow_definitions/*.yaml` | 8 | P1 |
| 2 | 深度测试闭环 | `pipelineOrchestrator.js`, `agentConsoleService.js` | 修改+新增 | `deepTestService.js` | 6 | P1 |
| 3 | 硬约束覆盖裁决 | `criticGateService.js`(修改) | 修改+新增 | `coverageExtractor.py`, `hardConstraintService.js` | 7 | P1 |
| 4 | 多路径交叉验证 | `agentExecutionEngine.js` | 修改+新增 | `crossValidationService.js` | 5 | P2 |
| 5 | Agent引擎升级 | `agentExecutionEngine.js`(重写核心) | 重构 | `agentErrorHandler.js` | 6 | P2 |
| 6 | SSH真机交互 | `sdkCliToolService.js`(重写), `trafficToolService.js` | 重写+新增 | `scripts/cta_extensions/ssh_cli_bridge.py` | 8 | P1 |
| 7 | Agent三件套 | `agentConsoleService.js`, DB表 | 修改+新增 | `agentConfigService.js`, `agent_configs/*.yaml` | 5 | P3 |
| 8 | 知识沉淀闭环 | `knowledgeService.js` | 修改+新增 | `knowledgeSettleService.js` | 4 | P3 |
| 9 | DB变更 | MySQL迁移 | 新增 | `migrations/00X_cta_v2.sql` | 3 | P1-P3 |
| 10 | UI升级 | 前端HTML/JS/CSS | 修改 | `public/js/workflow-*.js`, `public/css/workflow.css` | 6 | P2-P3 |
| | **合计** | | | | **58** | |

### 2.2 改进架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           xtest v2.0 Architecture                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    声明式工作流引擎 (新)                              │   │
│  │  workflowEngine.js ← workflow_definitions/*.yaml                    │   │
│  │  替代原 pipelineOrchestrator.js 的固定7阶段                          │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                  │                                           │
│  ┌───────────────────────────────▼──────────────────────────────────────┐  │
│  │                    Agent执行引擎 (升级)                                 │  │
│  │  agentExecutionEngine.js + agentErrorHandler.js                      │  │
│  │  无限轮 + 5层容错 + 多路径交叉验证                                     │  │
│  └──────────────────────────────┬───────────────────────────────────────┘  │
│                                  │                                           │
│  ┌───────────────────────────────▼──────────────────────────────────────┐  │
│  │              深度测试闭环 (新)                                         │  │
│  │  dispatch → hunt → review_gate → review → completeness_gate           │  │
│  │                    ↑________________________________________| (自循环)  │  │
│  └──────────────────────────────┬───────────────────────────────────────┘  │
│                                  │                                           │
│  ┌──────────────┬───────────────▼──┬────────────────┬─────────────────┐  │
│  │  硬约束裁决   │  SSH真机交互      │  流量工具(真实)  │  知识沉淀闭环   │  │
│  │  coverage    │  ssh_cli_bridge   │  trafficTool    │  knowledgeSettle│  │
│  │  Extractor   │  .py (Python)     │  Service        │  Service        │  │
│  └──────────────┴───────────────────┴────────────────┴─────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Agent三件套配置体系                                 │   │
│  │  config.yaml + SOUL.md + USER.md  (per agent)                        │   │
│  │  agentConfigService.js + agent_configs/                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、后端改进详细设计

### 3.1 Pipeline从固定7阶段升级为声明式工作流

#### 3.1.1 现状分析

当前 `pipelineOrchestrator.js` 的核心结构：

```javascript
// 现状：硬编码7阶段
const PIPELINE_PHASES = [
  'learn_context',      // 学习上下文
  'approval_gate',      // 审批门控
  'execute_config',     // 执行配置
  'execute_traffic',    // 执行流量
  'critic_gate',        // 评审门控
  'completed'           // 完成
];

class PipelineOrchestrator {
  async runPipeline(taskId) {
    for (const phase of PIPELINE_PHASES) {
      await this.executePhase(phase, taskId);
      await this.persistPhaseResult(phase, taskId);
    }
  }
  
  async executePhase(phase, taskId) {
    switch (phase) {
      case 'learn_context': return this.runLearnContext(taskId);
      case 'approval_gate': return this.runApprovalGate(taskId);
      case 'execute_config': return this.runExecuteConfig(taskId);
      case 'execute_traffic': return this.runExecuteTraffic(taskId);
      case 'critic_gate': return this.runCriticGate(taskId);
      // ...硬编码
    }
  }
}
```

**问题**:
- 新增阶段需要修改 `PIPELINE_PHASES` 数组和 `executePhase` switch
- 所有任务走同一流程，无法按场景定制
- 不支持条件跳转和循环
- 不支持并行节点

#### 3.1.2 目标设计

引入声明式工作流引擎，支持YAML定义工作流：

**新增文件**: `services/workflowEngine.js`

```javascript
// services/workflowEngine.js - 声明式工作流引擎

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

class WorkflowEngine {
  constructor(db, agentEngine, services) {
    this.db = db;
    this.agentEngine = agentEngine;
    this.services = services; // 注入各种service
    this.definitionCache = new Map();
  }

  /**
   * 加载工作流定义
   * @param {string} workflowType - 工作流类型标识
   */
  async loadDefinition(workflowType) {
    if (this.definitionCache.has(workflowType)) {
      return this.definitionCache.get(workflowType);
    }

    // 先从DB查找自定义工作流
    const [rows] = await this.db.query(
      'SELECT * FROM workflow_definitions WHERE workflow_type = ? AND status = "active" ORDER BY version DESC LIMIT 1',
      [workflowType]
    );

    let definition;
    if (rows.length > 0) {
      definition = yaml.load(rows[0].definition_yaml);
    } else {
      // 回退到文件系统默认定义
      const filePath = path.join(__dirname, '..', 'workflow_definitions', `${workflowType}.yaml`);
      const content = await fs.readFile(filePath, 'utf-8');
      definition = yaml.load(content);
    }

    this.validateDefinition(definition);
    this.definitionCache.set(workflowType, definition);
    return definition;
  }

  /**
   * 验证工作流定义
   */
  validateDefinition(def) {
    if (!def.nodes || !Array.isArray(def.nodes)) {
      throw new Error('Workflow definition must have "nodes" array');
    }
    if (!def.edges || !Array.isArray(def.edges)) {
      throw new Error('Workflow definition must have "edges" array');
    }
    const entryNodes = def.edges.filter(e => e.from === '__START__');
    if (entryNodes.length === 0) {
      throw new Error('Workflow must have at least one edge from __START__');
    }
    for (const node of def.nodes) {
      if (!node.id) throw new Error(`Node missing id: ${JSON.stringify(node)}`);
      if (!node.agent) throw new Error(`Node ${node.id} missing agent reference`);
      if (!node.handler) throw new Error(`Node ${node.id} missing handler`);
    }
    const nodeIds = new Set(def.nodes.map(n => n.id));
    nodeIds.add('__START__');
    nodeIds.add('__END__');
    for (const edge of def.edges) {
      if (!nodeIds.has(edge.from)) throw new Error(`Edge from unknown node: ${edge.from}`);
      if (!nodeIds.has(edge.to)) throw new Error(`Edge to unknown node: ${edge.to}`);
    }
  }

  /**
   * 执行工作流
   */
  async runWorkflow(taskId, workflowType, initialContext = {}) {
    const definition = await this.loadDefinition(workflowType);
    const instanceId = await this.createInstance(taskId, workflowType, definition);
    
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

    await this.persistContext(instanceId, context);

    const startEdges = definition.edges.filter(e => e.from === '__START__');
    const firstNode = startEdges[0].to;

    return this.executeFromNode(instanceId, definition, context, firstNode);
  }

  /**
   * 从指定节点开始执行
   */
  async executeFromNode(instanceId, definition, context, nodeId) {
    let currentNodeId = nodeId;

    while (currentNodeId && currentNodeId !== '__END__') {
      const node = definition.nodes.find(n => n.id === currentNodeId);
      if (!node) {
        throw new Error(`Node not found: ${currentNodeId}`);
      }

      // 循环次数检查
      context.loopCount[currentNodeId] = (context.loopCount[currentNodeId] || 0) + 1;
      if (context.loopCount[currentNodeId] > context.maxLoops) {
        console.warn(`Node ${currentNodeId} exceeded max loops ${context.maxLoops}, forcing end`);
        break;
      }

      context.currentNode = currentNodeId;
      await this.persistContext(instanceId, context);
      await this.emitNodeStart(instanceId, node);

      try {
        const handler = this.resolveHandler(node.handler);
        const result = await handler({
          taskId: context.taskId,
          node,
          context: context.sharedState,
          nodeResults: context.nodeResults,
          emit: (event, data) => this.emitNodeEvent(instanceId, node, event, data),
        });

        context.nodeResults[currentNodeId] = {
          status: result.status || 'completed',
          output: result.output || {},
          timestamp: new Date(),
        };

        context.history.push({
          nodeId: currentNodeId,
          status: context.nodeResults[currentNodeId].status,
          timestamp: new Date(),
        });

        await this.emitNodeComplete(instanceId, node, context.nodeResults[currentNodeId]);

        // 决定下一个节点
        const nextEdges = definition.edges.filter(e => e.from === currentNodeId);
        
        if (nextEdges.length === 0) {
          break;
        } else if (nextEdges.length === 1 && !nextEdges[0].condition) {
          currentNodeId = nextEdges[0].to;
        } else {
          const nextNode = this.resolveConditionalRoute(nextEdges, context);
          if (!nextNode) {
            throw new Error(`No route matched from node ${currentNodeId}`);
          }
          currentNodeId = nextNode;
        }

        // 审批暂停
        if (node.requires_approval && result.status === 'needs_approval') {
          context.phase = 'awaiting_approval';
          await this.persistContext(instanceId, context);
          await this.emitApprovalRequired(instanceId, node, result.output);
          return { status: 'paused', instanceId, approvalNode: currentNodeId };
        }

      } catch (error) {
        context.nodeResults[currentNodeId] = {
          status: 'error',
          error: error.message,
          timestamp: new Date(),
        };
        await this.persistContext(instanceId, context);
        
        const errorEdges = definition.edges.filter(
          e => e.from === currentNodeId && e.on_error
        );
        if (errorEdges.length > 0) {
          currentNodeId = errorEdges[0].to;
        } else {
          throw error;
        }
      }

      await this.persistContext(instanceId, context);
    }

    context.phase = 'completed';
    context.currentNode = null;
    context.endTime = new Date();
    await this.persistContext(instanceId, context);
    await this.emitWorkflowComplete(instanceId, context);

    return {
      status: 'completed',
      instanceId,
      nodeResults: context.nodeResults,
      sharedState: context.sharedState,
    };
  }

  /**
   * 条件路由解析
   */
  resolveConditionalRoute(edges, context) {
    for (const edge of edges) {
      if (!edge.condition) {
        return edge.to;
      }
      if (this.evaluateCondition(edge.condition, context)) {
        return edge.to;
      }
    }
    const defaultEdge = edges.find(e => e.is_default);
    return defaultEdge ? defaultEdge.to : null;
  }

  /**
   * 条件表达式求值
   */
  evaluateCondition(expr, context) {
    try {
      const evalContext = {
        nodeResults: context.nodeResults,
        sharedState: context.sharedState,
      };
      const keys = Object.keys(evalContext);
      const values = Object.values(evalContext);
      // 生产环境应使用vm2沙箱替代
      const fn = new Function(...keys, `return (${expr});`);
      return !!fn(...values);
    } catch (e) {
      console.error(`Condition eval failed: ${expr}`, e);
      return false;
    }
  }

  /**
   * 解析handler
   */
  resolveHandler(handlerName) {
    const handlers = {
      // 保留原pipeline阶段handler
      'learn_context': (args) => this.services.learnContextService.run(args),
      'approval_gate': (args) => this.services.approvalGateService.run(args),
      'execute_config': (args) => this.services.executeConfigService.run(args),
      'execute_traffic': (args) => this.services.trafficToolService.run(args),
      'critic_gate': (args) => this.services.criticGateService.run(args),
      // 新增handler
      'env_prepare': (args) => this.services.envPrepareService.run(args),
      'design_understand': (args) => this.services.designUnderstandService.run(args),
      'design_outline': (args) => this.services.designOutlineService.run(args),
      'expand_testpoints': (args) => this.services.testpointService.expand(args),
      'test_dispatch': (args) => this.services.deepTestService.dispatch(args),
      'test_hunt': (args) => this.services.deepTestService.hunt(args),
      'test_review_gate': (args) => this.services.deepTestService.reviewGate(args),
      'test_review': (args) => this.services.crossValidationService.review(args),
      'test_completeness_gate': (args) => this.services.deepTestService.completenessGate(args),
      'knowledge_settle': (args) => this.services.knowledgeSettleService.run(args),
      'hard_constraint_check': (args) => this.services.hardConstraintService.check(args),
    };
    
    const handler = handlers[handlerName];
    if (!handler) {
      throw new Error(`Unknown handler: ${handlerName}`);
    }
    return handler;
  }

  async createInstance(taskId, workflowType, definition) {
    const [result] = await this.db.query(
      `INSERT INTO workflow_instances (task_id, workflow_type, definition_version, status, context_json, created_at)
       VALUES (?, ?, ?, 'running', ?, NOW())`,
      [taskId, workflowType, definition.version || 1, JSON.stringify({})]
    );
    return result.insertId;
  }

  async persistContext(instanceId, context) {
    await this.db.query(
      `UPDATE workflow_instances SET context_json = ?, current_node = ?, status = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(context), context.currentNode, context.phase, instanceId]
    );
  }

  async emitNodeStart(instanceId, node) {
    this.services.io?.emit('workflow:node_start', { instanceId, nodeId: node.id, nodeLabel: node.label });
  }
  async emitNodeComplete(instanceId, node, result) {
    this.services.io?.emit('workflow:node_complete', { instanceId, nodeId: node.id, result });
  }
  async emitNodeEvent(instanceId, node, event, data) {
    this.services.io?.emit('workflow:node_event', { instanceId, nodeId: node.id, event, data });
  }
  async emitApprovalRequired(instanceId, node, output) {
    this.services.io?.emit('workflow:approval_required', { instanceId, nodeId: node.id, output });
  }
  async emitWorkflowComplete(instanceId, context) {
    this.services.io?.emit('workflow:complete', { instanceId, context });
  }
}

module.exports = WorkflowEngine;
```

#### 3.1.3 默认工作流定义

**新增目录**: `workflow_definitions/`

**文件**: `workflow_definitions/default.yaml`

```yaml
# 默认工作流定义 - 兼容原7阶段 + 新增深度测试闭环
version: 2
name: default_test_workflow
description: "xtest默认测试工作流，吸收CTA-v2深度测试闭环"

max_loops_per_node: 10

nodes:
  # === 阶段1: 环境准备 ===
  - id: env_prepare
    label: "环境准备"
    agent: env_preparer
    handler: env_prepare
    config:
      timeout_ms: 300000
      requires_lease: true

  # === 阶段2: 设计理解 ===
  - id: design_understand
    label: "设计文档理解"
    agent: design_reader
    handler: design_understand
    config:
      max_tokens: 16000
      extract_hard_constraints: true

  # === 阶段3: 测试大纲 ===
  - id: design_outline
    label: "测试大纲生成"
    agent: test_designer
    handler: design_outline
    config:
      expand_strategy: "comprehensive"

  # === 阶段4: 测试点扩展 ===
  - id: expand_testpoints
    label: "测试点展开"
    agent: testpoint_expander
    handler: expand_testpoints
    config:
      max_testpoints: 200

  # === 阶段5: 审批门控 ===
  - id: approval_gate
    label: "审批门控"
    agent: human
    handler: approval_gate
    requires_approval: true
    config:
      approver: "assignee"
      auto_approve_if_no_assignee: false

  # === 阶段6: 深度测试-派发 ===
  - id: test_dispatch
    label: "测试用例派发"
    agent: test_dispatcher
    handler: test_dispatch
    config:
      batch_size: 10
      parallel_sessions: 3

  # === 阶段7: 深度测试-执行 ===
  - id: test_hunt
    label: "测试执行"
    agent: test_hunter
    handler: test_hunt
    config:
      timeout_per_command_ms: 30000
      capture_output: true

  # === 阶段8: 测试评审门控 ===
  - id: test_review_gate
    label: "测试评审门控"
    agent: review_gater
    handler: test_review_gate
    config:
      quick_check: true

  # === 阶段9: 多路径交叉验证 ===
  - id: test_review
    label: "交叉验证"
    agent: cross_validator
    handler: test_review
    config:
      paths:
        - "cli_command"
        - "register_write"
        - "traffic_trigger"
      min_paths: 2

  # === 阶段10: 完整性门控 ===
  - id: test_completeness_gate
    label: "完整性门控"
    agent: completeness_checker
    handler: test_completeness_gate
    config:
      check_hard_constraints: true
      check_coverage_threshold: 0.9
      max_retest_loops: 3

  # === 阶段11: 硬约束覆盖裁决 ===
  - id: hard_constraint_check
    label: "硬约束覆盖裁决"
    agent: constraint_checker
    handler: hard_constraint_check
    config:
      mechanical_comparison: true

  # === 阶段12: 知识沉淀 ===
  - id: knowledge_settle
    label: "知识沉淀"
    agent: knowledge_settler
    handler: knowledge_settle
    config:
      persist_understanding: true
      persist_outline: true
      persist_test_plan: true
      persist_lessons: true

edges:
  - { from: __START__, to: env_prepare }
  - { from: env_prepare, to: design_understand }
  - { from: design_understand, to: design_outline }
  - { from: design_outline, to: expand_testpoints }
  - { from: expand_testpoints, to: approval_gate }
  - { from: approval_gate, to: test_dispatch }
  - { from: test_dispatch, to: test_hunt }
  - { from: test_hunt, to: test_review_gate }
  # review_gate: 通过→review, 不通过→回hunt重试
  - { from: test_review_gate, to: test_review, condition: "nodeResults.test_review_gate.output.verdict == 'pass'" }
  - { from: test_review_gate, to: test_hunt, condition: "nodeResults.test_review_gate.output.verdict == 'retry'" }
  # review: 交叉验证
  - { from: test_review, to: test_completeness_gate }
  # completeness_gate: 覆盖足够→hard_constraint, 不足→回dispatch补测
  - { from: test_completeness_gate, to: hard_constraint_check, condition: "nodeResults.test_completeness_gate.output.coverage_met == true" }
  - { from: test_completeness_gate, to: test_dispatch, condition: "nodeResults.test_completeness_gate.output.coverage_met == false && nodeResults.test_completeness_gate.output.retest_count < 3" }
  - { from: test_completeness_gate, to: hard_constraint_check, condition: "nodeResults.test_completeness_gate.output.retest_count >= 3", is_default: true }
  # hard_constraint → knowledge_settle → END
  - { from: hard_constraint_check, to: knowledge_settle }
  - { from: knowledge_settle, to: __END__ }
  # error路由
  - { from: test_hunt, to: test_dispatch, on_error: true }
```

#### 3.1.4 回归测试工作流定义

**文件**: `workflow_definitions/regression.yaml`

```yaml
# 回归测试工作流 - 精简版，跳过设计理解，直接从已有用例执行
version: 2
name: regression_workflow
description: "回归测试工作流，复用已有测试用例"

max_loops_per_node: 5

nodes:
  - id: env_prepare
    label: "环境准备"
    agent: env_preparer
    handler: env_prepare
    config:
      timeout_ms: 180000

  - id: load_existing_cases
    label: "加载已有用例"
    agent: case_loader
    handler: load_existing_cases
    config:
      filter_by: "last_run_status != 'pass'"

  - id: approval_gate
    label: "审批门控"
    agent: human
    handler: approval_gate
    requires_approval: true

  - id: test_dispatch
    label: "测试派发"
    agent: test_dispatcher
    handler: test_dispatch
    config:
      batch_size: 20
      parallel_sessions: 5

  - id: test_hunt
    label: "测试执行"
    agent: test_hunter
    handler: test_hunt

  - id: test_completeness_gate
    label: "完整性门控"
    agent: completeness_checker
    handler: test_completeness_gate
    config:
      check_hard_constraints: false
      check_coverage_threshold: 0.95
      max_retest_loops: 1

  - id: knowledge_settle
    label: "知识沉淀"
    agent: knowledge_settler
    handler: knowledge_settle

edges:
  - { from: __START__, to: env_prepare }
  - { from: env_prepare, to: load_existing_cases }
  - { from: load_existing_cases, to: approval_gate }
  - { from: approval_gate, to: test_dispatch }
  - { from: test_dispatch, to: test_hunt }
  - { from: test_hunt, to: test_completeness_gate }
  - { from: test_completeness_gate, to: test_dispatch, condition: "nodeResults.test_completeness_gate.output.coverage_met == false" }
  - { from: test_completeness_gate, to: knowledge_settle, is_default: true }
  - { from: knowledge_settle, to: __END__ }
```

#### 3.1.5 向后兼容策略

`pipelineOrchestrator.js` 改为薄封装层，内部委托给 `WorkflowEngine`：

```javascript
// pipelineOrchestrator.js - 改为兼容层
const WorkflowEngine = require('./workflowEngine');

class PipelineOrchestrator {
  constructor(db, services) {
    this.db = db;
    this.workflowEngine = new WorkflowEngine(db, services.agentEngine, services);
  }

  // 旧接口保持不变，内部委托给WorkflowEngine
  async runPipeline(taskId) {
    // 获取任务的workflow_type，默认为'default'
    const [task] = await this.db.query(
      'SELECT workflow_type FROM agent_tasks WHERE id = ?', [taskId]
    );
    const workflowType = task[0]?.workflow_type || 'default';
    
    // 映射旧阶段名到新工作流节点（兼容前端）
    const result = await this.workflowEngine.runWorkflow(taskId, workflowType);
    
    // 将工作流结果映射回旧pipeline_phase格式
    await this.syncLegacyPhaseStatus(taskId, result);
    return result;
  }

  // 旧阶段状态同步
  async syncLegacyPhaseStatus(taskId, result) {
    const phaseMapping = {
      'env_prepare': 'learn_context',
      'design_understand': 'learn_context',
      'design_outline': 'learn_context',
      'expand_testpoints': 'learn_context',
      'approval_gate': 'approval_gate',
      'test_dispatch': 'execute_config',
      'test_hunt': 'execute_config',
      'test_review': 'execute_traffic',
      'test_completeness_gate': 'critic_gate',
      'hard_constraint_check': 'critic_gate',
      'knowledge_settle': 'completed',
    };
    
    for (const [nodeId, result] of Object.entries(result.nodeResults || {})) {
      const legacyPhase = phaseMapping[nodeId];
      if (legacyPhase) {
        await this.db.query(
          'INSERT INTO pipeline_phase_status (task_id, phase, status, result_json, updated_at) VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE status = VALUES(status), result_json = VALUES(result_json), updated_at = NOW()',
          [taskId, legacyPhase, result.status, JSON.stringify(result.output)]
        );
      }
    }
  }

  // 保留旧接口方法
  async getPhaseStatus(taskId) { /* ... */ }
  async approvePhase(taskId, phase) { /* ... */ }
  async retryPhase(taskId, phase) { /* ... */ }
}

module.exports = PipelineOrchestrator;
```

#### 3.1.6 路由变更

**文件**: `routes/pipeline.js` (修改)

```javascript
// 新增路由
router.get('/workflow-definitions', async (req, res) => {
  // 列出所有可用工作流定义
  const definitions = await workflowEngine.listDefinitions();
  res.json(definitions);
});

router.get('/workflow-definitions/:type', async (req, res) => {
  const def = await workflowEngine.loadDefinition(req.params.type);
  res.json(def);
});

router.post('/workflow-definitions', async (req, res) => {
  // 创建/更新工作流定义
  const { workflow_type, definition_yaml, description } = req.body;
  await db.query(
    'INSERT INTO workflow_definitions (workflow_type, definition_yaml, description, version, status, created_at) VALUES (?, ?, ?, 1, "active", NOW())',
    [workflow_type, definition_yaml, description]
  );
  res.json({ success: true });
});

router.get('/workflow-instances/:id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM workflow_instances WHERE id = ?', [req.params.id]);
  res.json(rows[0]);
});

router.get('/tasks/:taskId/workflow', async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM workflow_instances WHERE task_id = ? ORDER BY created_at DESC', 
    [req.params.taskId]
  );
  res.json(rows[0]);
});
```

---

### 3.2 引入深度测试闭环（hunt->review->gate循环）

#### 3.2.1 现状分析

当前执行流程：
```
execute_config -> [生成CLI命令列表] -> [执行命令] -> critic_gate -> [LLM判定pass/fail]
```

无闭环：如果critic_gate发现覆盖不足，只能人工创建新任务补测。

#### 3.2.2 目标设计

引入CTA-v2的深度测试闭环：
```
test_dispatch -> test_hunt -> test_review_gate -> test_review -> test_completeness_gate
       ↑                                                        |
       └────────────── coverage_met == false ────────────────────┘
```

**新增文件**: `services/deepTestService.js`

```javascript
// services/deepTestService.js - 深度测试闭环服务

const { exec } = require('child_process');
const path = require('path');

class DeepTestService {
  constructor(db, agentEngine, sshService) {
    this.db = db;
    this.agentEngine = agentEngine;
    this.sshService = sshService;
  }

  /**
   * test_dispatch: 测试用例派发
   * 将测试点展开为具体可执行的测试用例，分批派发
   */
  async dispatch({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'dispatching', message: '开始派发测试用例' });

    // 获取已展开的测试点
    const testpoints = context.testpoints || nodeResults.expand_testpoints?.output?.testpoints || [];
    
    // 获取已有测试用例（补测场景）
    const [existingCases] = await this.db.query(
      'SELECT * FROM test_cases WHERE task_id = ? AND status != "archived"', 
      [taskId]
    );
    
    // 识别未覆盖的测试点
    const coveredPoints = new Set(existingCases.map(c => c.testpoint_id));
    const uncoveredPoints = testpoints.filter(tp => !coveredPoints.has(tp.id));
    
    // 生成新测试用例
    const batchSize = node.config?.batch_size || 10;
    const batches = [];
    
    for (let i = 0; i < uncoveredPoints.length; i += batchSize) {
      const batch = uncoveredPoints.slice(i, i + batchSize);
      const testCases = await this.generateTestCases(taskId, batch, context, emit);
      batches.push(testCases);
    }
    
    // 持久化测试用例
    for (const batch of batches) {
      for (const tc of batch) {
        await this.db.query(
          'INSERT INTO test_cases (task_id, testpoint_id, name, description, command_list, expected_result, status, created_at) VALUES (?, ?, ?, ?, ?, ?, "pending", NOW())',
          [taskId, tc.testpointId, tc.name, tc.description, JSON.stringify(tc.commands), JSON.stringify(tc.expected)]
        );
      }
    }

    // 记录retest计数
    const retestCount = context.retestCount || 0;
    context.retestCount = retestCount + 1;
    context.uncoveredPoints = uncoveredPoints.length;
    
    emit('progress', { 
      step: 'dispatched', 
      message: `派发 ${batches.flat().length} 条测试用例（第${retestCount + 1}轮）`,
      totalCases: batches.flat().length,
      retestRound: retestCount + 1,
    });

    return {
      status: 'completed',
      output: {
        total_cases: batches.flat().length,
        batches: batches.length,
        retest_count: retestCount + 1,
        uncovered_points: uncoveredPoints.length,
      }
    };
  }

  /**
   * 生成测试用例
   */
  async generateTestCases(taskId, testpoints, context, emit) {
    const cases = [];
    
    for (const tp of testpoints) {
      // 调用LLM生成具体命令
      const prompt = `
你是芯片测试专家。请为以下测试点生成具体的CLI测试命令：

测试点: ${tp.name}
描述: ${tp.description}
分类: ${tp.category}
优先级: ${tp.priority}

设备信息: ${JSON.stringify(context.deviceInfo || {})}
已有配置: ${JSON.stringify(context.existingConfig || {})}

请输出JSON格式：
{
  "name": "用例名称",
  "description": "用例描述",
  "commands": ["命令1", "命令2", ...],
  "expected": { "type": "output_contains|register_value|status_code", "value": "期望值" }
}
`;
      const response = await this.agentEngine.callLLM(prompt, { json: true });
      cases.push({ ...response, testpointId: tp.id });
    }
    
    return cases;
  }

  /**
   * test_hunt: 测试执行（猎取结果）
   * 执行测试用例，捕获输出
   */
  async hunt({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'hunting', message: '开始执行测试用例' });
    
    // 获取pending状态的测试用例
    const [cases] = await this.db.query(
      'SELECT * FROM test_cases WHERE task_id = ? AND status = "pending" ORDER BY priority DESC, id ASC',
      [taskId]
    );
    
    const parallelSessions = node.config?.parallel_sessions || 1;
    const timeoutPerCommand = node.config?.timeout_per_command_ms || 30000;
    const captureOutput = node.config?.capture_output !== false;
    
    const results = [];
    
    // 并发执行
    for (let i = 0; i < cases.length; i += parallelSessions) {
      const batch = cases.slice(i, i + parallelSessions);
      const batchResults = await Promise.all(
        batch.map(tc => this.executeTestCase(tc, context, timeoutPerCommand, emit))
      );
      results.push(...batchResults);
    }
    
    // 更新测试用例状态
    for (const result of results) {
      await this.db.query(
        'UPDATE test_cases SET status = ?, actual_output = ?, executed_at = NOW() WHERE id = ?',
        [result.verdict, JSON.stringify(result.output), result.caseId]
      );
    }
    
    // 统计
    const stats = {
      total: results.length,
      pass: results.filter(r => r.verdict === 'pass').length,
      fail: results.filter(r => r.verdict === 'fail').length,
      error: results.filter(r => r.verdict === 'error').length,
    };
    
    emit('progress', { step: 'hunt_complete', message: `执行完成: ${stats.pass}pass/${stats.fail}fail/${stats.error}error`, stats });
    
    return {
      status: 'completed',
      output: { stats, results }
    };
  }

  /**
   * 执行单条测试用例（通过SSH）
   */
  async executeTestCase(testCase, context, timeoutMs, emit) {
    const commands = typeof testCase.command_list === 'string' 
      ? JSON.parse(testCase.command_list) 
      : testCase.command_list;
    
    const outputs = [];
    let verdict = 'pass';
    
    for (const cmd of commands) {
      try {
        emit('command_exec', { caseId: testCase.id, command: cmd });
        
        // 通过Python SSH bridge执行
        const result = await this.sshService.executeCommand(cmd, {
          timeout: timeoutMs,
          sessionId: context.sshSessionId,
        });
        
        outputs.push({ command: cmd, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
        
        if (result.exitCode !== 0) {
          verdict = 'fail';
        }
      } catch (error) {
        outputs.push({ command: cmd, error: error.message });
        verdict = 'error';
        break;
      }
    }
    
    // 与期望结果比对
    const expected = typeof testCase.expected_result === 'string'
      ? JSON.parse(testCase.expected_result)
      : testCase.expected_result || {};
    
    if (verdict === 'pass' && expected.type) {
      verdict = this.compareResult(outputs, expected);
    }
    
    return {
      caseId: testCase.id,
      verdict,
      output: outputs,
    };
  }

  /**
   * 结果比对
   */
  compareResult(outputs, expected) {
    switch (expected.type) {
      case 'output_contains':
        return outputs.some(o => o.output?.includes(expected.value)) ? 'pass' : 'fail';
      case 'register_value':
        return outputs.some(o => o.output?.includes(expected.value)) ? 'pass' : 'fail';
      case 'status_code':
        return outputs.every(o => o.exitCode === 0) ? 'pass' : 'fail';
      default:
        return 'pass';
    }
  }

  /**
   * test_review_gate: 测试评审门控（快速检查）
   */
  async reviewGate({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'review_gate', message: '测试评审门控检查中' });
    
    const huntResult = nodeResults.test_hunt?.output;
    if (!huntResult) {
      return { status: 'completed', output: { verdict: 'retry', reason: '无执行结果' } };
    }
    
    const { stats } = huntResult;
    
    // 快速检查：是否有严重失败
    if (stats.error > stats.total * 0.5) {
      // 超过50%错误，可能是环境问题，重试
      return { status: 'completed', output: { verdict: 'retry', reason: '错误率过高，疑似环境问题' } };
    }
    
    if (stats.fail === 0 && stats.error === 0) {
      return { status: 'completed', output: { verdict: 'pass', reason: '全部通过' } };
    }
    
    // 有失败但不多，进入交叉验证
    return { status: 'completed', output: { verdict: 'pass', reason: '存在失败用例，进入交叉验证' } };
  }

  /**
   * test_completeness_gate: 完整性门控
   * 判断覆盖是否足够，不足则触发补测
   */
  async completenessGate({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'completeness_gate', message: '完整性门控检查中' });
    
    const retestCount = context.retestCount || 0;
    const maxRetestLoops = node.config?.max_retest_loops || 3;
    const coverageThreshold = node.config?.check_coverage_threshold || 0.9;
    
    // 计算覆盖率
    let coverageRate = 0;
    let gapCount = 0;
    let gaps = [];
    
    if (node.config?.check_hard_constraints && context.hardConstraints) {
      // 硬约束覆盖率
      const hardConstraintResult = nodeResults.hard_constraint_check?.output;
      if (hardConstraintResult) {
        coverageRate = hardConstraintResult.coverage_rate || 0;
        gapCount = hardConstraintResult.uncovered?.length || 0;
        gaps = hardConstraintResult.uncovered || [];
      }
    } else {
      // 测试点覆盖率
      const totalTestpoints = context.testpoints?.length || 0;
      const [executedCases] = await this.db.query(
        'SELECT COUNT(DISTINCT testpoint_id) as covered FROM test_cases WHERE task_id = ? AND status IN ("pass", "fail")',
        [taskId]
      );
      const covered = executedCases[0]?.covered || 0;
      coverageRate = totalTestpoints > 0 ? covered / totalTestpoints : 0;
      gapCount = totalTestpoints - covered;
    }
    
    const coverageMet = coverageRate >= coverageThreshold;
    
    emit('progress', {
      step: 'completeness_checked',
      message: `覆盖率: ${(coverageRate * 100).toFixed(1)}%, 阈值: ${(coverageThreshold * 100).toFixed(1)}%`,
      coverageRate,
      gapCount,
      coverageMet,
    });
    
    if (!coverageMet && retestCount < maxRetestLoops) {
      // 触发补测
      context.coverageGaps = gaps;
      return {
        status: 'completed',
        output: {
          coverage_met: false,
          coverage_rate: coverageRate,
          gap_count: gapCount,
          gaps,
          retest_count: retestCount,
          message: `覆盖率不足(${(coverageRate * 100).toFixed(1)}%)，触发第${retestCount + 1}轮补测`,
        }
      };
    }
    
    // 超过最大补测次数或覆盖足够
    if (!coverageMet) {
      emit('warning', { message: `已达最大补测次数 ${maxRetestLoops}，覆盖率 ${coverageRate.toFixed(3)}，继续后续流程` });
    }
    
    return {
      status: 'completed',
      output: {
        coverage_met: true,
        coverage_rate: coverageRate,
        gap_count: gapCount,
        retest_count: retestCount,
        message: `覆盖率${coverageMet ? '达标' : '未达标但已达最大补测次数'}: ${(coverageRate * 100).toFixed(1)}%`,
      }
    };
  }
}

module.exports = DeepTestService;
```

#### 3.2.2 涉及文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `services/deepTestService.js` | 新增 | 深度测试闭环核心服务 |
| `services/workflowEngine.js` | 新增 | 工作流引擎，注册deepTestService handler |
| `pipelineOrchestrator.js` | 修改 | 委托给WorkflowEngine |
| `agentConsoleService.js` | 修改 | 新增闭环状态查询接口 |
| `routes/pipeline.js` | 修改 | 新增闭环相关API路由 |
| `routes/tasks.js` | 修改 | 任务创建时支持指定workflow_type |
| `agent_tasks` 表 | 修改 | 新增 `workflow_type` 字段 |

---

### 3.3 引入硬约束覆盖裁决

#### 3.3.1 现状分析

当前 `criticGateService.js` 的核心逻辑：

```javascript
// 现状：LLM判定为主
class CriticGateService {
  async evaluate(taskId) {
    // 收集执行结果
    const results = await this.collectResults(taskId);
    // LLM判定
    const verdict = await this.llmJudge(results);
    // 简单规则兜底
    if (verdict === 'warning') {
      return this.ruleBasedFallback(results);
    }
    return verdict;
  }
}
```

问题：LLM判定有幻觉风险，缺少机械比对能力。

#### 3.3.2 目标设计

新增硬约束提取和裁决系统：

**新增文件**: `services/hardConstraintService.js`

```javascript
// services/hardConstraintService.js - 硬约束覆盖裁决服务

const { exec } = require('child_process');
const path = require('path');
const util = require('util');
const execAsync = util.promisify(exec);

class HardConstraintService {
  constructor(db) {
    this.db = db;
  }

  /**
   * 从设计文档提取硬约束清单
   * 在design_understand阶段调用
   */
  async extractConstraints(taskId, designDocs) {
    const constraints = [];
    
    // 调用Python脚本提取硬约束
    const scriptPath = path.join(__dirname, '..', 'scripts', 'cta_extensions', 'coverage_extractor.py');
    const input = JSON.stringify({
      action: 'extract',
      task_id: taskId,
      documents: designDocs,
    });
    
    try {
      const { stdout } = await execAsync(`python3 ${scriptPath}`, {
        input: input,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });
      
      const result = JSON.parse(stdout);
      if (result.status === 'success') {
        constraints.push(...result.constraints);
      }
    } catch (error) {
      console.error('Hard constraint extraction failed:', error);
      // Fallback: 使用LLM提取
      const llmConstraints = await this.extractWithLLM(designDocs);
      constraints.push(...llmConstraints);
    }
    
    // 持久化到DB
    for (const c of constraints) {
      await this.db.query(
        `INSERT INTO hard_constraints 
         (task_id, constraint_type, constraint_key, constraint_value, source_doc, status, created_at) 
         VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
        [taskId, c.type, c.key, JSON.stringify(c.value), c.source]
      );
    }
    
    return constraints;
  }

  /**
   * 硬约束覆盖裁决
   * 在hard_constraint_check阶段调用
   */
  async check({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'checking', message: '开始硬约束覆盖裁决' });
    
    // 获取所有硬约束
    const [constraints] = await this.db.query(
      'SELECT * FROM hard_constraints WHERE task_id = ? ORDER BY constraint_type, id',
      [taskId]
    );
    
    if (constraints.length === 0) {
      emit('warning', { message: '无硬约束清单，跳过机械比对' });
      return {
        status: 'completed',
        output: {
          coverage_rate: 1.0,
          covered: 0,
          uncovered: [],
          total: 0,
          message: '无硬约束清单',
        }
      };
    }
    
    // 获取测试执行结果
    const [testCases] = await this.db.query(
      'SELECT * FROM test_cases WHERE task_id = ? AND status IN ("pass", "fail")',
      [taskId]
    );
    
    // 获取测试输出
    const testOutputs = testCases.map(tc => ({
      caseId: tc.id,
      commands: typeof tc.command_list === 'string' ? JSON.parse(tc.command_list) : tc.command_list,
      output: typeof tc.actual_output === 'string' ? JSON.parse(tc.actual_output) : tc.actual_output,
      verdict: tc.status,
    }));
    
    // 调用Python脚本做机械比对
    const scriptPath = path.join(__dirname, '..', 'scripts', 'cta_extensions', 'coverage_extractor.py');
    const input = JSON.stringify({
      action: 'compare',
      task_id: taskId,
      constraints: constraints.map(c => ({
        id: c.id,
        type: c.constraint_type,
        key: c.constraint_key,
        value: typeof c.constraint_value === 'string' ? JSON.parse(c.constraint_value) : c.constraint_value,
      })),
      test_outputs: testOutputs,
    });
    
    let result;
    try {
      const { stdout } = await execAsync(`python3 ${scriptPath}`, {
        input: input,
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });
      result = JSON.parse(stdout);
    } catch (error) {
      emit('error', { message: '覆盖比对失败: ' + error.message });
      result = { status: 'error', covered: [], uncovered: constraints.map(c => c.id) };
    }
    
    // 更新约束状态
    if (result.covered) {
      for (const cid of result.covered) {
        await this.db.query(
          'UPDATE hard_constraints SET status = "covered", covered_at = NOW() WHERE id = ?',
          [cid]
        );
      }
    }
    if (result.uncovered) {
      for (const cid of result.uncovered) {
        await this.db.query(
          'UPDATE hard_constraints SET status = "uncovered", checked_at = NOW() WHERE id = ?',
          [cid]
        );
      }
    }
    
    const total = constraints.length;
    const coveredCount = result.covered?.length || 0;
    const uncoveredCount = result.uncovered?.length || 0;
    const coverageRate = total > 0 ? coveredCount / total : 1.0;
    
    // 获取未覆盖约束的详情
    const uncoveredDetails = constraints.filter(c =>
      result.uncovered?.includes(c.id)
    ).map(c => ({
      id: c.id,
      type: c.constraint_type,
      key: c.constraint_key,
      value: typeof c.constraint_value === 'string' ? JSON.parse(c.constraint_value) : c.constraint_value,
      source: c.source_doc,
    }));
    
    emit('progress', {
      step: 'checked',
      message: `硬约束覆盖: ${coveredCount}/${total} (${(coverageRate * 100).toFixed(1)}%)`,
      coverageRate,
      uncovered: uncoveredDetails,
    });
    
    return {
      status: 'completed',
      output: {
        coverage_rate: coverageRate,
        covered: coveredCount,
        uncovered: uncoveredCount,
        uncovered_details: uncoveredDetails,
        total,
        message: `硬约束覆盖: ${coveredCount}/${total} (${(coverageRate * 100).toFixed(1)}%)`,
      }
    };
  }

  /**
   * LLM fallback提取硬约束
   */
  async extractWithLLM(designDocs) {
    // 使用现有aiService提取寄存器/状态机/参数矩阵
    const prompt = `
你是芯片设计文档分析专家。请从以下设计文档中提取硬约束清单：

1. 寄存器约束：所有可配置寄存器的地址、默认值、读写权限
2. 状态机约束：所有状态转换及其触发条件
3. 参数矩阵约束：所有配置参数的组合矩阵

文档内容:
${designDocs.map(d => d.content).join('\n---\n')}

请输出JSON数组：
[{
  "type": "register|state_machine|parameter_matrix",
  "key": "唯一标识",
  "value": { "具体约束内容" },
  "source": "文档名"
}]
`;
    // 调用aiService
    const result = await this.aiService.call(prompt, { json: true });
    return result;
  }

  /**
   * 获取硬约束清单
   */
  async getConstraints(taskId) {
    const [rows] = await this.db.query(
      'SELECT * FROM hard_constraints WHERE task_id = ? ORDER BY constraint_type, id',
      [taskId]
    );
    return rows;
  }

  /**
   * 手动添加硬约束
   */
  async addConstraint(taskId, type, key, value, source) {
    const [result] = await this.db.query(
      'INSERT INTO hard_constraints (task_id, constraint_type, constraint_key, constraint_value, source_doc, status, created_at) VALUES (?, ?, ?, ?, ?, "pending", NOW())',
      [taskId, type, key, JSON.stringify(value), source]
    );
    return result.insertId;
  }
}

module.exports = HardConstraintService;
```

#### 3.3.3 硬约束类型定义

```javascript
// 硬约束类型枚举
const HARD_CONSTRAINT_TYPES = {
  REGISTER: 'register',           // 寄存器约束
  STATE_MACHINE: 'state_machine', // 状态机转换
  PARAMETER_MATRIX: 'parameter_matrix', // 参数矩阵
  INTERRUPT: 'interrupt',         // 中断约束
  TIMER: 'timer',                // 定时器约束
  COUNTER: 'counter',           // 计数器约束
};

// 硬约束示例数据结构
const constraintExamples = {
  register: {
    type: 'register',
    key: 'REG_MAC_CTRL@0x4000',
    value: {
      address: '0x4000',
      name: 'MAC_CTRL',
      default_value: '0x00000000',
      access: 'rw',
      bitfields: [
        { name: 'enable', bits: '[0]', reset_value: 0 },
        { name: 'speed', bits: '[3:2]', reset_value: 0 },
      ]
    },
    source: 'APP_NOTE_CH3.pdf'
  },
  state_machine: {
    type: 'state_machine',
    key: 'PORT_STATE_MACHINE',
    value: {
      states: ['DOWN', 'INIT', 'UP', 'BLOCKED'],
      transitions: [
        { from: 'DOWN', to: 'INIT', trigger: 'port_enable=1' },
        { from: 'INIT', to: 'UP', trigger: 'link_up=1' },
        { from: 'UP', to: 'BLOCKED', trigger: 'error_count > threshold' },
      ]
    },
    source: 'APP_NOTE_CH5.pdf'
  },
  parameter_matrix: {
    type: 'parameter_matrix',
    key: 'MAC_SPEED_DUPLEX',
    value: {
      parameters: ['speed', 'duplex'],
      combinations: [
        { speed: '10M', duplex: 'half' },
        { speed: '10M', duplex: 'full' },
        { speed: '100M', duplex: 'half' },
        { speed: '100M', duplex: 'full' },
        { speed: '1G', duplex: 'full' },
      ]
    },
    source: 'APP_NOTE_CH4.pdf'
  }
};
```

#### 3.3.4 涉及文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `services/hardConstraintService.js` | 新增 | 硬约束提取+裁决服务 |
| `scripts/cta_extensions/coverage_extractor.py` | 新增 | Python硬约束提取+比对脚本 |
| `services/criticGateService.js` | 修改 | 集成硬约束裁决结果 |
| `services/designUnderstandService.js` | 新增 | 设计理解阶段调用硬约束提取 |
| `routes/constraints.js` | 新增 | 硬约束管理API路由 |
| `hard_constraints` 表 | 新增 | 硬约束存储表 |

---

### 3.4 引入多路径交叉验证

#### 3.4.1 现状分析

当前执行模式：生成CLI命令列表 -> 单路径执行 -> 检查输出。

```
命令: set port 1 speed 1000
执行: CLI -> pass
```

只能证明CLI路径正常，无法发现：
- CLI能配但寄存器实际没写进去
- CLI配了但流量层面没生效
- 寄存器能写但CLI有bug

#### 3.4.2 目标设计

**新增文件**: `services/crossValidationService.js`

```javascript
// services/crossValidationService.js - 多路径交叉验证服务

class CrossValidationService {
  constructor(db, agentEngine, sshService) {
    this.db = db;
    this.agentEngine = agentEngine;
    this.sshService = sshService;
  }

  /**
   * test_review: 多路径交叉验证
   * 对每条测试用例，用不同方式验证同一功能
   */
  async review({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'cross_validating', message: '开始多路径交叉验证' });
    
    const paths = node.config?.paths || ['cli_command', 'register_write'];
    const minPaths = node.config?.min_paths || 2;
    
    // 获取已执行的测试用例
    const [testCases] = await this.db.query(
      'SELECT * FROM test_cases WHERE task_id = ? AND status IN ("pass", "fail")',
      [taskId]
    );
    
    const crossValidationResults = [];
    const discrepancies = [];
    
    for (const tc of testCases) {
      emit('progress', { step: 'validating', caseId: tc.id, caseName: tc.name });
      
      // 为每条用例生成多路径验证命令
      const validationCommands = await this.generateCrossValidationCommands(tc, paths, context);
      
      // 执行多路径验证
      const pathResults = {};
      for (const [pathType, commands] of Object.entries(validationCommands)) {
        const results = [];
        for (const cmd of commands) {
          try {
            const result = await this.sshService.executeCommand(cmd, {
              timeout: 15000,
              sessionId: context.sshSessionId              sessionId: context.sshSessionId,
            });
            results.push({ command: cmd, output: result.stdout, exitCode: result.exitCode });
          } catch (error) {
            results.push({ command: cmd, error: error.message });
          }
        }
        pathResults[pathType] = results;
      }
      
      const comparison = this.comparePathResults(pathResults, tc);
      crossValidationResults.push({ caseId: tc.id, caseName: tc.name, pathResults, comparison });
      
      if (!comparison.consistent) {
        discrepancies.push({ caseId: tc.id, caseName: tc.name, detail: comparison.discrepancy });
        await this.db.query(
          'INSERT INTO test_bugs (task_id, test_case_id, bug_type, description, path_results, severity, status, created_at) VALUES (?, ?, "cross_validation_mismatch", ?, ?, "major", "open", NOW())',
          [taskId, tc.id, comparison.discrepancy, JSON.stringify(pathResults)]
        );
        emit('bug_found', { caseId: tc.id, caseName: tc.name, detail: comparison.discrepancy });
      }
    }
    
    const stats = {
      total_validated: crossValidationResults.length,
      consistent: crossValidationResults.filter(r => r.comparison.consistent).length,
      inconsistent: discrepancies.length,
    };
    
    emit('progress', { step: 'validation_complete', message: `交叉验证完成: ${stats.consistent}/${stats.total_validated}一致`, stats, discrepancies });
    return { status: 'completed', output: { stats, discrepancies, results: crossValidationResults } };
  }

  async generateCrossValidationCommands(testCase, paths, context) {
    const commands = typeof testCase.command_list === 'string' ? JSON.parse(testCase.command_list) : testCase.command_list || [];
    const prompt = `你是芯片测试专家。请为以下测试用例生成多路径交叉验证命令。
原始测试用例: ${testCase.name} - ${testCase.description}
原始命令: ${JSON.stringify(commands)}
请为以下路径分别生成验证命令: ${paths.join(', ')}
输出JSON: {"cli_command": [...], "register_write": [...], "traffic_trigger": [...]}`;
    return await this.agentEngine.callLLM(prompt, { json: true });
  }

  comparePathResults(pathResults, testCase) {
    const paths = Object.keys(pathResults);
    if (paths.length < 2) return { consistent: true, reason: '路径数不足2' };
    const pathVerdicts = {};
    for (const [pathType, results] of Object.entries(pathResults)) {
      pathVerdicts[pathType] = { allSuccess: results.every(r => r.exitCode === 0) };
    }
    const verdicts = Object.values(pathVerdicts);
    const allConsistent = verdicts.every(v => v.allSuccess === verdicts[0].allSuccess);
    if (allConsistent) return { consistent: true, pathVerdicts };
    const inconsistent = paths.filter(p => pathVerdicts[p].allSuccess !== verdicts[0].allSuccess);
    return { consistent: false, discrepancy: `路径 ${inconsistent.join(', ')} 与其他路径结果不一致`, pathVerdicts, inconsistentPaths: inconsistent };
  }
}
module.exports = CrossValidationService;
```

#### 3.4.3 交叉验证路径定义

| 路径类型 | 标识 | 说明 | 示例 |
|---------|------|------|------|
| CLI命令 | `cli_command` | 通过设备CLI接口执行 | `show port 1 status` |
| 寄存器读写 | `register_write` | 直接读写寄存器地址 | `devmem 0x4000 32` |
| 流量触发 | `traffic_trigger` | 发送特定报文触发功能 | 发送ARP请求观察响应 |
| SNMP查询 | `snmp_query` | 通过SNMP协议查询 | `snmpget -v2c ...` |
| 日志检查 | `log_check` | 检查系统日志 | `dmesg | grep -i error` |

#### 3.4.4 涉及文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `services/crossValidationService.js` | 新增 | 多路径交叉验证服务 |
| `test_bugs` 表 | 新增 | 交叉验证发现的Bug记录表 |
| `routes/cross-validation.js` | 新增 | 交叉验证结果查询API |

---

### 3.5 Agent执行引擎升级（5轮->无限轮+容错）

#### 3.5.1 现状分析

当前 `agentExecutionEngine.js` 中 `MAX_TOOL_CALL_ROUNDS=5` 硬限制。超过5轮工具调用直接终止。无超时/限流/瞬断/上下文溢出/空响应的容错处理。

#### 3.5.2 目标设计

**新增文件**: `services/agentErrorHandler.js` - 5层容错处理器

```javascript
// services/agentErrorHandler.js
class AgentErrorHandler {
  constructor(config = {}) {
    this.maxRetries = config.maxRetries || 3;
    this.baseDelayMs = config.baseDelayMs || 1000;
    this.maxDelayMs = config.maxDelayMs || 30000;
  }

  // L1: 超时重试（指数退避）
  async withTimeoutRetry(fn, timeoutMs) {
    let attempt = 0;
    while (attempt < this.maxRetries) {
      try { return await this._withTimeout(fn, timeoutMs); }
      catch (error) {
        if (error.code === 'TIMEOUT' && attempt < this.maxRetries - 1) {
          await this._sleep(this._exponentialBackoff(attempt));
          attempt++;
        } else { throw error; }
      }
    }
  }

  // L2: 限流重试 (HTTP 429)
  async withRateLimitRetry(fn) {
    let attempt = 0;
    while (true) {
      try { return await fn(); }
      catch (error) {
        if (error.status === 429 && attempt < this.maxRetries) {
          const retryAfter = error.headers?.['retry-after'] ? parseInt(error.headers['retry-after']) * 1000 : this._exponentialBackoff(attempt);
          await this._sleep(retryAfter);
          attempt++;
        } else { throw error; }
      }
    }
  }

  // L3: 瞬断重试 (SSH断连 -> 重连)
  async withTransientRetry(fn, sshService, sessionId) {
    let attempt = 0;
    while (attempt < this.maxRetries) {
      try { return await fn(); }
      catch (error) {
        if (this._isTransientError(error) && attempt < this.maxRetries - 1) {
          if (sshService) await sshService.reconnect(sessionId);
          await this._sleep(this._exponentialBackoff(attempt));
          attempt++;
        } else { throw error; }
      }
    }
  }

  // L4: 上下文溢出修复（截断+摘要）
  async withContextOverflowFix(messages, llmCall, config = {}) {
    const maxTokens = config.maxTokens || 32000;
    const maxContext = maxTokens - 4000;
    if (this._estimateTokens(messages) <= maxContext) return llmCall(messages);
    const truncated = this._truncateMessages(messages, maxContext);
    const summary = await this._summarizeContext(messages);
    truncated.unshift({ role: 'system', content: `[Context summary]: ${summary}` });
    return llmCall(truncated);
  }

  // L5: 空响应修复（注入提示重试）
  async withEmptyResponseFix(llmCall, messages) {
    let attempt = 0;
    while (attempt <= 2) {
      const response = await llmCall(messages);
      if (response?.content?.trim().length > 0) return response;
      if (attempt < 2) {
        messages = [...messages, { role: 'user', content: '你的上一次回复为空。请重新生成回复。' }];
        attempt++;
      } else { return { content: '[Empty response fallback]', tool_calls: null, fallback: true }; }
    }
  }

  // 组合容错
  async executeWithFullResilience(fn, options = {}) {
    const { timeoutMs = 60000, sshService = null, sessionId = null } = options;
    let wrapped = async () => this.withRateLimitRetry(fn);
    wrapped = async () => this.withTimeoutRetry(wrapped, timeoutMs);
    if (sshService) {
      const prev = wrapped;
      wrapped = async () => this.withTransientRetry(prev, sshService, sessionId);
    }
    return wrapped();
  }

  _withTimeout(fn, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('Timeout'), { code: 'TIMEOUT' })), ms);
      fn().then(r => { clearTimeout(timer); resolve(r); }, e => { clearTimeout(timer); reject(e); });
    });
  }
  _exponentialBackoff(attempt) { return Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs) + Math.random() * 1000; }
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  _isTransientError(error) { return ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','socket hang up'].some(s => error.code === s || error.message?.includes(s)); }
  _estimateTokens(messages) { return Math.ceil(JSON.stringify(messages).length / 3); }
  _truncateMessages(messages, maxTokens) {
    const system = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    while (this._estimateTokens([...system, ...nonSystem]) > maxTokens) { if (nonSystem.length <= 2) break; nonSystem.shift(); }
    return [...system, ...nonSystem];
  }
  async _summarizeContext(messages) {
    return messages.filter(m => m.role === 'tool').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).substring(0, 200)).join('\n');
  }
}
module.exports = AgentErrorHandler;
```

#### 3.5.3 升级后的Agent执行引擎核心变更

```javascript
// agentExecutionEngine.js - 关键变更（保留原有方法，核心循环升级）

const AgentErrorHandler = require('./agentErrorHandler');

class AgentExecutionEngine {
  constructor(db, aiService, toolRegistry) {
    this.db = db;
    this.aiService = aiService;
    this.toolRegistry = toolRegistry;
    this.errorHandler = new AgentErrorHandler({ maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 });
    this.maxRounds = parseInt(process.env.AGENT_MAX_ROUNDS || '0'); // 0=无限
    this.defaultTimeoutMs = parseInt(process.env.AGENT_TIMEOUT_MS || '120000');
  }

  async runAgentLoop(taskId, agentConfig, options = {}) {
    const { initialMessages = [], tools = [], timeoutMs = this.defaultTimeoutMs, sshService = null, sessionId = null, maxRounds = this.maxRounds } = options;
    let messages = [...initialMessages];
    let rounds = 0, consecutiveNoProgress = 0;
    
    while (true) {
      if (maxRounds > 0 && rounds >= maxRounds) break;
      if (consecutiveNoProgress >= 5) break;
      
      try {
        // L4+L5: 上下文溢出修复 + 空响应修复
        const response = await this.errorHandler.withContextOverflowFix(
          messages,
          (msgs) => this.errorHandler.withEmptyResponseFix((m) => this.aiService.call(m, { tools, stream: true }), msgs),
          { maxTokens: agentConfig.maxTokens || 32000 }
        );
        
        messages.push({ role: 'assistant', content: response.content });
        
        if (!response.tool_calls?.length) {
          consecutiveNoProgress++;
          if (this._isTaskComplete(response.content)) break;
          messages.push({ role: 'user', content: '请继续执行任务。如果已完成，请说明"任务完成"。' });
          rounds++;
          continue;
        }
        
        consecutiveNoProgress = 0;
        for (const toolCall of response.tool_calls) {
          const result = await this._executeToolWithResilience(toolCall, { timeoutMs, sshService, sessionId, taskId });
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
        }
        rounds++;
      } catch (error) {
        if (this._isRecoverable(error)) {
          messages.push({ role: 'system', content: `[Error recovery] ${error.message}. Try alternative.` });
          consecutiveNoProgress++; rounds++;
          continue;
        }
        throw error;
      }
    }
    return { rounds, messages, finalContent: messages[messages.length - 1]?.content };
  }

  async _executeToolWithResilience(toolCall, options) {
    const { timeoutMs, sshService, sessionId, taskId } = options;
    const toolDef = await this.toolRegistry.getTool(toolCall.function?.name);
    if (!toolDef) return { error: `Unknown tool` };
    const fn = async () => this._executeToolByType(toolDef, JSON.parse(toolCall.function?.arguments || '{}'), { taskId, sessionId });
    return this.errorHandler.executeWithFullResilience(fn, { timeoutMs: toolDef.timeout_ms || timeoutMs, sshService, sessionId });
  }

  _isTaskComplete(content) {
    return ['任务完成','task complete','done','已完成','测试已完成'].some(s => content?.toLowerCase().includes(s.toLowerCase()));
  }
  _isRecoverable(error) {
    return ['TIMEOUT','ECONNRESET','ETIMEDOUT','EPIPE'].includes(error.code) || ['socket hang up','connection reset'].some(m => error.message?.includes(m));
  }
}
module.exports = AgentExecutionEngine;
```

#### 3.5.4 .env 配置项

```bash
AGENT_MAX_ROUNDS=0              # 0=无限轮, >0=指定轮次上限
AGENT_TIMEOUT_MS=120000         # 单轮默认超时
AGENT_MAX_RETRIES=3             # 最大重试次数
AGENT_BASE_DELAY_MS=1000        # 退避基础延迟
AGENT_MAX_DELAY_MS=30000        # 退避最大延迟
```

---

### 3.6 SSH真机交互能力

#### 3.6.1 现状

`sdkCliToolService.js` 返回mock数据，`trafficToolService.js` 是dry-run。无法连接真实DUT。

#### 3.6.2 目标设计

重写 `sdkCliToolService.js`，通过Python SSH bridge实现真实设备交互（代码见上方3.6.2节，此处省略避免重复）。

核心方法：
- `createSession(config)` - 创建SSH会话
- `executeCommand(command, options)` - 执行命令，异常自动重连
- `executeBatch(commands, options)` - 批量执行
- `reconnect(sessionId)` - 异常自愈重连
- `takeSnapshot(sessionId)` - 设备配置快照
- `diff(sessionId, snap1, snap2)` - 快照对比
- `getCounter(sessionId, name)` - 获取计数器
- `rollback(sessionId, snapshotId)` - 配置回滚

#### 3.6.3 涉及文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `services/sdkCliToolService.js` | 重写 | 从模拟实现改为真实SSH交互 |
| `services/trafficToolService.js` | 修改 | 从dry-run改为真实打流 |
| `scripts/cta_extensions/ssh_cli_bridge.py` | 新增 | Python SSH桥接脚本 |
| `ssh_sessions` 表 | 新增 | SSH会话管理表 |
| `sdk_snapshots` 表 | 新增 | 快照管理表 |

---

### 3.7 Agent三件套配置体系

#### 3.7.1 现状

`agent_sub_agents`表有soul/user/tools配置字段，但粒度粗，缺少输入契约（prereq/handoff/accumulating/writes）。

#### 3.7.2 目标设计

**新增文件**: `services/agentConfigService.js`

核心方法：
- `loadAgentConfig(agentName)` - 加载三件套（DB优先，回退文件系统）
- `getInputContract(agentName)` - 获取输入契约
- `validateContract(agentName, nodeResults, sharedState)` - 验证契约是否满足
- `buildAgentContext(agentName, nodeResults, sharedState)` - 组装Agent完整上下文
- `saveAgentOutput(agentName, output, sharedState)` - 保存输出到sharedState

输入契约四要素：
- **prereq**: 前置条件（依赖哪些节点的输出或共享状态）
- **handoff**: 交接物（输出给下游的数据key）
- **accumulating**: 累积状态（跨轮次保留，支持append/merge策略）
- **writes**: 可写资源（DB表等）

Agent配置示例见上方3.7.3节。

#### 3.7.3 涉及文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `services/agentConfigService.js` | 新增 | Agent三件套配置服务 |
| `agent_configs/*/config.yaml` | 新增 | 每个Agent的配置文件 |
| `agent_configs/*/SOUL.md` | 新增 | 每个Agent的角色定义 |
| `agent_configs/*/USER.md` | 新增 | 每个Agent的用户偏好 |
| `agent_configs` 表 | 新增 | DB存储Agent配置 |
| `agentExecutionEngine.js` | 修改 | 从agentConfigService加载配置 |
| `workflowEngine.js` | 修改 | 节点执行前验证输入契约 |

---

### 3.8 知识沉淀闭环

#### 3.8.1 现状

测试结果做verdict判定后即结束，生成物不会自动入库。knowledge_base有向量检索但缺少自动沉淀流程。

#### 3.8.2 目标设计

**新增文件**: `services/knowledgeSettleService.js`

```javascript
// services/knowledgeSettleService.js - 知识沉淀服务

class KnowledgeSettleService {
  constructor(db, knowledgeService) {
    this.db = db;
    this.knowledgeService = knowledgeService;
  }

  async run({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'settling', message: '开始知识沉淀' });
    const config = node.config || {};
    const items = [];
    
    // 1. 设计理解文档
    if (config.persist_understanding && nodeResults.design_understand?.output) {
      items.push(await this._settle(taskId, 'design_understanding', '设计理解文档', nodeResults.design_understand.output));
    }
    // 2. 测试大纲
    if (config.persist_outline && nodeResults.design_outline?.output) {
      items.push(await this._settle(taskId, 'test_outline', '测试大纲', nodeResults.design_outline.output));
    }
    // 3. 测试计划
    if (config.persist_test_plan && nodeResults.test_dispatch?.output) {
      const [cases] = await this.db.query('SELECT * FROM test_cases WHERE task_id = ?', [taskId]);
      items.push(await this._settle(taskId, 'test_plan', '测试计划', { dispatch: nodeResults.test_dispatch.output, cases }));
    }
    // 4. 测试结果
    if (nodeResults.test_hunt?.output) {
      items.push(await this._settle(taskId, 'test_results', '测试结果', {
        stats: nodeResults.test_hunt.output.stats,
        review: nodeResults.test_review?.output?.stats,
        discrepancies: nodeResults.test_review?.output?.discrepancies,
      }));
    }
    // 5. 覆盖报告
    if (nodeResults.hard_constraint_check?.output) {
      items.push(await this._settle(taskId, 'coverage_report', '覆盖报告', nodeResults.hard_constraint_check.output));
    }
    // 6. 经验教训
    if (config.persist_lessons) {
      const lessons = this._extractLessons(taskId, nodeResults);
      if (lessons.length) items.push(await this._settle(taskId, 'lessons', '经验教训', lessons));
    }
    
    // 7. 生成嵌入向量
    for (const item of items) {
      await this.knowledgeService.embedAndIndex(item.id, item.content);
    }
    
    emit('progress', { step: 'settled', message: `知识沉淀完成: ${items.length}条`, items });
    return { status: 'completed', output: { settled_count: items.length, items: items.map(i => ({ id: i.id, type: i.type })) } };
  }

  async _settle(taskId, type, title, content) {
    const [result] = await this.db.query(
      'INSERT INTO knowledge_artifacts (task_id, artifact_type, title, content, created_at) VALUES (?, ?, ?, ?, NOW())',
      [taskId, type, `任务${taskId}-${title}`, JSON.stringify(content)]
    );
    return { id: result.insertId, type, title, content: JSON.stringify(content) };
  }

  _extractLessons(taskId, nodeResults) {
    const lessons = [];
    const hunt = nodeResults.test_hunt?.output;
    if (hunt?.stats?.error > 0) lessons.push({ type: 'env', lesson: `${hunt.stats.error}条用例因环境失败` });
    const review = nodeResults.test_review?.output;
    if (review?.discrepancies?.length > 0) lessons.push({ type: 'cross_validation', lesson: `${review.discrepancies.length}处多路径不一致` });
    const coverage = nodeResults.hard_constraint_check?.output;
    if (coverage && coverage.coverage_rate < 0.9) lessons.push({ type: 'coverage', lesson: `覆盖率${(coverage.coverage_rate*100).toFixed(1)}%未达标` });
    const completeness = nodeResults.test_completeness_gate?.output;
    if (completeness?.retest_count > 0) lessons.push({ type: 'retest', lesson: `${completeness.retest_count}轮补测` });
    return lessons;
  }
}
module.exports = KnowledgeSettleService;
```

#### 3.8.3 涉及文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `services/knowledgeSettleService.js` | 新增 | 知识沉淀服务 |
| `knowledge_artifacts` 表 | 新增 | 知识生成物存储表 |
| `knowledgeService.js` | 修改 | 新增embedAndIndex方法 |
| `routes/knowledge.js` | 修改 | 新增知识生成物查询API |

---

## 四、Python脚本扩展层设计

### 4.1 目录结构

```
xtest/
├── services/              # Node.js服务层
├── routes/                # Express路由
├── scripts/
│   └── cta_extensions/   # Python脚本扩展层
│       ├── __init__.py
│       ├── ssh_cli_bridge.py      # SSH多会话桥接
│       ├── coverage_extractor.py  # 硬约束提取+比对
│       ├── completeness_gate.py   # 完整性门控计算
│       ├── requirements.txt       # Python依赖
│       └── utils/
│           ├── __init__.py
│           ├── ssh_manager.py      # SSH连接管理
│           ├── doc_parser.py      # 设计文档解析
│           └── register_extractor.py # 寄存器提取
├── workflow_definitions/  # YAML工作流定义
├── agent_configs/         # Agent三件套配置
│   ├── env_preparer/
│   │   ├── config.yaml
│   │   ├── SOUL.md
│   │   └── USER.md
│   ├── test_hunter/
│   │   ├── config.yaml
│   │   ├── SOUL.md
│   │   └── USER.md
│   └── ...
├── migrations/            # 数据库迁移
│   └── 001_cta_v2.sql
└── public/               # 前端文件
```

### 4.2 脚本清单

#### 4.2.1 ssh_cli_bridge.py

```python
#!/usr/bin/env python3
"""
SSH CLI Bridge - xtest Python扩展层
功能: SSH多会话管理 + CLI命令执行 + 异常自愈
调用方式: stdin接收JSON, stdout返回JSON
"""
import sys, json, time, socket, threading, select, re
import paramiko
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stderr)
logger = logging.getLogger('ssh_bridge')

class SSHSessionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    def create_session(self, host, port, username, password=None, key_path=None, device_type='generic'):
        session_id = f"ssh_{int(time.time()*1000)}_{hash(host)%10000}"
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {'hostname': host, 'port': port, 'username': username, 'timeout': 30}
        if password: kwargs['password'] = password
        if key_path: kwargs['key_filename'] = key_path
        client.connect(**kwargs)
        channel = client.invoke_shell()
        channel.settimeout(30)
        time.sleep(1)
        while channel.recv_ready(): channel.recv(4096)
        with self.lock:
            self.sessions[session_id] = {
                'client': client, 'channel': channel,
                'host': host, 'port': port, 'username': username,
                'device_type': device_type, 'created_at': time.time(),
                'last_activity': time.time(), 'reconnect_count': 0,
                'command_history': [],
            }
        logger.info(f"Session created: {session_id} -> {host}:{port}")
        return session_id

    def execute(self, session_id, command, timeout=30):
        session = self._get_session(session_id)
        if not session:
            return {'status': 'error', 'error_type': 'session_not_found', 'error': f'Session {session_id} not found'}
        try:
            channel = session['channel']
            while channel.recv_ready(): channel.recv(65536)
            channel.send(command + '\n')
            output = self._read_until_prompt(channel, timeout, session['device_type'])
            session['last_activity'] = time.time()
            session['command_history'].append({'command': command, 'timestamp': time.time()})
            return {'status': 'success', 'stdout': output, 'stderr': '', 'exit_code': 0}
        except socket.timeout:
            return {'status': 'error', 'error_type': 'timeout', 'error': f'Timed out after {timeout}s'}
        except (paramiko.SSHException, socket.error, EOFError) as e:
            logger.warning(f"Session {session_id} lost: {e}")
            with self.lock:
                if session_id in self.sessions:
                    self.sessions[session_id]['channel'] = None
                    self.sessions[session_id]['client'] = None
            return {'status': 'error', 'error_type': 'connection_lost', 'error': str(e)}

    def execute_batch(self, session_id, commands, timeout=30):
        results = []
        for cmd in commands:
            r = self.execute(session_id, cmd, timeout)
            results.append({'command': cmd, 'stdout': r.get('stdout',''), 'stderr': r.get('stderr',''), 'exit_code': r.get('exit_code',-1), 'status': r.get('status','error')})
            if r.get('status') == 'error': break
        return {'status': 'success', 'results': results}

    def reconnect(self, session_id, host, port, username, device_type='generic'):
        session = self._get_session(session_id)
        if not session: return {'status': 'error', 'error': f'Session {session_id} not found'}
        try:
            if session['channel']:
                try: session['channel'].close()
                except: pass
            if session['client']:
                try: session['client'].close()
                except: pass
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(hostname=host, port=port, username=username, timeout=30)
            channel = client.invoke_shell()
            channel.settimeout(30)
            time.sleep(1)
            while channel.recv_ready(): channel.recv(4096)
            with self.lock:
                self.sessions[session_id]['client'] = client
                self.sessions[session_id]['channel'] = channel
                self.sessions[session_id]['reconnect_count'] += 1
            logger.info(f"Session {session_id} reconnected")
            return {'status': 'success', 'session_id': session_id, 'reconnect_count': self.sessions[session_id]['reconnect_count']}
        except Exception as e:
            return {'status': 'error', 'error': f'Reconnect failed: {str(e)}'}

    def take_snapshot(self, session_id):
        snapshot = {}
        for cmd in ['show running-config', 'show interface', 'show version']:
            r = self.execute(session_id, cmd, timeout=15)
            snapshot[cmd] = r.get('stdout', '')
        return {'status': 'success', 'snapshot': snapshot}

    def close_session(self, session_id):
        with self.lock:
            session = self.sessions.pop(session_id, None)
        if session:
            try:
                if session['channel']: session['channel'].close()
                if session['client']: session['client'].close()
            except: pass
            return {'status': 'success'}
        return {'status': 'error', 'error': f'Session {session_id} not found'}

    def _get_session(self, session_id):
        with self.lock: return self.sessions.get(session_id)

    def _read_until_prompt(self, channel, timeout, device_type):
        output = ''
        start = time.time()
        prompts = {
            'cisco': [r'\w+#\s*$', r'\w+\(config\)#\s*$', r'\w+>\s*$'],
            'huawei': [r'<\w+>\s*$', r'\[\w+\]\s*$'],
            'linux': [r'\$\s*$', r'#\s*$'],
            'generic': [r'#\s*$', r'\$\s*$', r'>\s*$'],
        }
        patterns = prompts.get(device_type, prompts['generic'])
        while True:
            if time.time() - start > timeout:
                if output.strip(): break
                raise socket.timeout()
            readable, _, _ = select.select([channel], [], [], 0.1)
            if readable:
                try:
                    data = channel.recv(65536).decode('utf-8', errors='replace')
                    output += data
                    lines = output.strip().split('\n')
                    if lines:
                        last = lines[-1].strip()
                        for p in patterns:
                            if re.search(p, last): return output
                except: break
            else:
                if output.strip() and time.time() - start > 1: break
        return output

manager = SSHSessionManager()

def main():
    input_data = sys.stdin.read()
    req = json.loads(input_data)
    action = req.get('action')

    if action == 'create_session':
        sid = manager.create_session(req['host'], req.get('port',22), req['username'], req.get('password'), req.get('key_path'), req.get('device_type','generic'))
        print(json.dumps({'status': 'success', 'session_id': sid}))
    elif action == 'execute':
        result = manager.execute(req['session_id'], req['command'], req.get('timeout',30))
        print(json.dumps(result))
    elif action == 'execute_batch':
        result = manager.execute_batch(req['session_id'], req['commands'], req.get('timeout',30))
        print(json.dumps(result))
    elif action == 'reconnect':
        result = manager.reconnect(req['session_id'], req['host'], req['port'], req['username'], req.get('device_type','generic'))
        print(json.dumps(result))
    elif action == 'take_snapshot':
        result = manager.take_snapshot(req['session_id'])
        print(json.dumps(result))
    elif action == 'close_session':
        result = manager.close_session(req['session_id'])
        print(json.dumps(result))
    else:
        print(json.dumps({'status': 'error', 'error': f'Unknown action: {action}'}))

if __name__ == '__main__':
    main()
```

#### 4.2.2 coverage_extractor.py

```python
#!/usr/bin/env python3
"""
Coverage Extractor - 硬约束提取+比对
功能: 从设计文档提取寄存器/状态机/参数矩阵, 测试后机械比对覆盖
"""
import sys, json, re
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stderr)
logger = logging.getLogger('coverage')


def extract_constraints(documents):
    """从设计文档提取硬约束"""
    constraints = []
    for doc in documents:
        content = doc.get('content', '')
        name = doc.get('name', 'unknown')
        
        # 提取寄存器约束
        constraints.extend(_extract_registers(content, name))
        # 提取状态机约束
        constraints.extend(_extract_state_machines(content, name))
        # 提取参数矩阵
        constraints.extend(_extract_parameter_matrix(content, name))
    
    return constraints


def _extract_registers(content, source):
    """提取寄存器约束"""
    constraints = []
    # 匹配: Register Name (0xADDRESS) [rw] default=0xVALUE
    pattern = r'(\w+)\s*\(\s*(0x[0-9a-fA-F]+)\s*\)\s*\[(rw|ro|wo)\]\s*(?:default\s*=\s*(0x[0-9a-fA-F]+))?'
    for match in re.finditer(pattern, content):
        name, addr, access, default = match.groups()
        constraints.append({
            'type': 'register',
            'key': f'{name}@{addr}',
            'value': {'name': name, 'address': addr, 'access': access, 'default': default or '0x0'},
            'source': source,
        })
    
    # 匹配bitfield: [N:M] field_name
    bitfield_pattern = r'\[(\d+)(?::(\d+))?\]\s*(\w+)\s*(?:reset\s*=\s*(\d+))?'
    for match in re.finditer(bitfield_pattern, content):
        msb, lsb, field_name, reset_val = match.groups()
        constraints.append({
            'type': 'register_bitfield',
            'key': f'{field_name}_bit{msb}{"_"+lsb if lsb else ""}',
            'value': {'field': field_name, 'msb': int(msb), 'lsb': int(lsb) if lsb else int(msb), 'reset': int(reset_val) if reset_val else 0},
            'source': source,
        })
    
    return constraints


def _extract_state_machines(content, source):
    """提取状态机约束"""
    constraints = []
    # 匹配: state A -> state B on trigger
    pattern = r'(?:state\s+)?(\w+)\s*->\s*(?:state\s+)?(\w+)\s*(?:on\s+|when\s+|trigger:\s*)?(.+)'
    for match in re.finditer(pattern, content, re.IGNORECASE):
        from_state, to_state, trigger = match.groups()
        if len(from_state) > 30 or len(to_state) > 30:
            continue  # 跳过非状态机文本
        constraints.append({
            'type': 'state_machine',
            'key': f'{from_state}->{to_state}',
            'value': {'from': from_state, 'to': to_state, 'trigger': trigger.strip()},
            'source': source,
        })
    return constraints


def _extract_parameter_matrix(content, source):
    """提取参数矩阵约束"""
    constraints = []
    # 匹配表格形式的参数矩阵
    # | speed | duplex | expected |
    # | 10M   | full   | pass     |
    lines = content.split('\n')
    in_table = False
    headers = []
    
    for line in lines:
        if '|' in line and not in_table:
            headers = [h.strip() for h in line.split('|') if h.strip()]
            in_table = True
            continue
        if '|' in line and in_table:
            values = [v.strip() for v in line.split('|') if v.strip()]
            if len(values) == len(headers) and not all(v == '-' or v == '---' for v in values):
                combo = dict(zip(headers, values))
                constraints.append({
                    'type': 'parameter_matrix',
                    'key': f'{ "_".join(values[:2]) }',
                    'value': combo,
                    'source': source,
                })
        else:
            in_table = False
    
    return constraints


def compare_constraints(constraints, test_outputs):
    """机械比对: 检查每个硬约束是否被测试覆盖"""
    covered = []
    uncovered = []
    
    for c in constraints:
        c_id = c['id']
        c_type = c['type']
        c_value = c['value']
        
        is_covered = False
        
        for output in test_outputs:
            commands = output.get('commands', [])
            output_text = ' '.join(str(o.get('output', '')) for o in output.get('output', []))
            full_text = ' '.join(commands) + ' ' + output_text
            
            if c_type == 'register':
                # 检查寄存器地址是否出现在命令或输出中
                addr = c_value.get('address', '')
                name = c_value.get('name', '')
                if addr.lower() in full_text.lower() or name.lower() in full_text.lower():
                    is_covered = True
                    break
            
            elif c_type == 'register_bitfield':
                field = c_value.get('field', '')
                if field.lower() in full_text.lower():
                    is_covered = True
                    break
            
            elif c_type == 'state_machine':
                from_state = c_value.get('from', '')
                to_state = c_value.get('to', '')
                if from_state.lower() in full_text.lower() and to_state.lower() in full_text.lower():
                    is_covered = True
                    break
            
            elif c_type == 'parameter_matrix':
                # 检查参数组合是否出现在测试中
                all_values = list(c_value.values())
                if all(v.lower() in full_text.lower() for v in all_values if v):
                    is_covered = True
                    break
        
        if is_covered:
            covered.append(c_id)
        else:
            uncovered.append(c_id)
    
    return {'status': 'success', 'covered': covered, 'uncovered': uncovered}


def main():
    input_data = sys.stdin.read()
    req = json.loads(input_data)
    action = req.get('action')
    
    if action == 'extract':
        constraints = extract_constraints(req.get('documents', []))
        print(json.dumps({'status': 'success', 'constraints': constraints}))
    elif action == 'compare':
        result = compare_constraints(req.get('constraints', []), req.get('test_outputs', []))
        print(json.dumps(result))
    else:
        print(json.dumps({'status': 'error', 'error': f'Unknown action: {action}'}))

if __name__ == '__main__':
    main()
```

#### 4.2.3 requirements.txt

```
paramiko>=3.0.0
PyYAML>=6.0
```

### 4.3 调用方式

xtest通过Node.js的`child_process.exec`调用Python脚本，通过stdin/stdout交换JSON数据：

```javascript
// 调用示例
const { stdout } = await execAsync(`python3 ${scriptPath}`, {
  input: JSON.stringify({ action: 'execute', session_id: sid, command: cmd, timeout: 30 }),
  timeout: 60000,
  maxBuffer: 10 * 1024 * 1024,
});
const result = JSON.parse(stdout);
```

---

## 五、数据库变更

### 5.1 新增表

```sql
-- migrations/001_cta_v2.sql

-- 1. 工作流定义表
CREATE TABLE workflow_definitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workflow_type VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  definition_yaml LONGTEXT NOT NULL,
  version INT DEFAULT 1,
  status ENUM('active', 'draft', 'archived') DEFAULT 'active',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workflow_type (workflow_type, status),
  INDEX idx_version (workflow_type, version DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 工作流实例表
CREATE TABLE workflow_instances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  workflow_type VARCHAR(100) NOT NULL,
  definition_version INT DEFAULT 1,
  status ENUM('running', 'paused', 'completed', 'failed', 'awaiting_approval') DEFAULT 'running',
  current_node VARCHAR(100),
  context_json LONGTEXT,
  result_json LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_task (task_id),
  INDEX idx_status (status),
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 硬约束表
CREATE TABLE hard_constraints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  constraint_type ENUM('register', 'register_bitfield', 'state_machine', 'parameter_matrix', 'interrupt', 'timer', 'counter') NOT NULL,
  constraint_key VARCHAR(200) NOT NULL,
  constraint_value JSON NOT NULL,
  source_doc VARCHAR(500),
  status ENUM('pending', 'covered', 'uncovered', 'failed') DEFAULT 'pending',
  covered_at TIMESTAMP NULL,
  checked_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task_type (task_id, constraint_type),
  INDEX idx_status (status),
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. SSH会话表
CREATE TABLE ssh_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(100) NOT NULL UNIQUE,
  host VARCHAR(200) NOT NULL,
  port INT DEFAULT 22,
  username VARCHAR(100) NOT NULL,
  device_type VARCHAR(50) DEFAULT 'generic',
  resource_id INT,
  status ENUM('active', 'closed', 'error') DEFAULT 'active',
  reconnect_count INT DEFAULT 0,
  last_reconnect_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  INDEX idx_session (session_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. SDK快照表
CREATE TABLE sdk_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(100) NOT NULL,
  snapshot_data LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. 测试用例表（新增，如果不存在）
CREATE TABLE IF NOT EXISTS test_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  testpoint_id INT,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  command_list JSON,
  expected_result JSON,
  actual_output JSON,
  status ENUM('pending', 'pass', 'fail', 'error', 'archived') DEFAULT 'pending',
  priority INT DEFAULT 5,
  executed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_task_status (task_id, status),
  INDEX idx_testpoint (testpoint_id),
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. 测试Bug表
CREATE TABLE test_bugs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  test_case_id INT,
  bug_type ENUM('cross_validation_mismatch', 'execution_failure', 'unexpected_output', 'timeout') NOT NULL,
  description TEXT NOT NULL,
  path_results JSON,
  severity ENUM('critical', 'major', 'minor', 'info') DEFAULT 'major',
  status ENUM('open', 'confirmed', 'fixed', 'wontfix') DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_task (task_id),
  INDEX idx_status (status),
  INDEX idx_severity (severity),
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Agent配置表（三件套）
CREATE TABLE agent_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_name VARCHAR(100) NOT NULL,
  agent_type ENUM('ai', 'program') DEFAULT 'ai',
  config_yaml LONGTEXT NOT NULL,
  soul_md LONGTEXT,
  user_md LONGTEXT,
  version INT DEFAULT 1,
  status ENUM('active', 'draft', 'archived') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_agent (agent_name, status),
  INDEX idx_version (agent_name, version DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. 知识生成物表
CREATE TABLE knowledge_artifacts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  artifact_type ENUM('design_understanding', 'test_outline', 'test_plan', 'test_results', 'coverage_report', 'lessons_learned') NOT NULL,
  title VARCHAR(500) NOT NULL,
  content LONGTEXT NOT NULL,
  tags JSON,
  embedding_status ENUM('pending', 'embedded', 'failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task (task_id),
  INDEX idx_type (artifact_type),
  INDEX idx_tags ((CAST(tags AS CHAR(500) ARRAY))),
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. Agent事件表（如不存在则创建）
CREATE TABLE IF NOT EXISTS agent_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task (task_id),
  INDEX idx_type_time (event_type, created_at DESC),
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 5.2 已有表修改

```sql
-- agent_tasks 表新增字段
ALTER TABLE agent_tasks 
  ADD COLUMN workflow_type VARCHAR(100) DEFAULT 'default' AFTER status,
  ADD COLUMN workflow_instance_id INT NULL AFTER workflow_type,
  ADD INDEX idx_workflow (workflow_type);

-- agent_sub_agents 表新增输入契约字段
ALTER TABLE agent_sub_agents
  ADD COLUMN input_contract JSON NULL AFTER tools_config,
  ADD COLUMN config_version INT DEFAULT 1 AFTER input_contract;

-- agent_tool_registry 表新增字段
ALTER TABLE agent_tool_registry
  ADD COLUMN timeout_ms INT DEFAULT 30000 AFTER description,
  ADD COLUMN handler VARCHAR(200) AFTER timeout_ms;
```

---

## 六、UI层面改进

### 6.1 Pipeline看板升级（支持闭环可视化）

**修改文件**: `public/js/pipeline-board.js` (重写), `public/css/workflow.css` (新增)

**核心变更**: 从固定7阶段横向进度条改为DAG图可视化，支持闭环和条件路由。

```javascript
// public/js/workflow-board.js - 工作流可视化看板

class WorkflowBoard {
  constructor(taskId, socket) {
    this.taskId = taskId;
    this.socket = socket;
    this.nodes = [];
    this.edges = [];
    this.currentNode = null;
    this.instanceId = null;
    
    this.initSocket();
    this.initCanvas();
  }
  
  initSocket() {
    this.socket.on(`workflow:node_start`, (data) => this.onNodeStart(data));
    this.socket.on(`workflow:node_complete`, (data) => this.onNodeComplete(data));
    this.socket.on(`workflow:node_event`, (data) => this.onNodeEvent(data));
    this.socket.on(`workflow:approval_required`, (data) => this.onApprovalRequired(data));
    this.socket.on(`workflow:complete`, (data) => this.onWorkflowComplete(data));
  }
  
  initCanvas() {
    // 使用D3.js或自定义SVG渲染DAG图
    this.svg = d3.select('#workflow-canvas').append('svg')
      .attr('width', '100%').attr('height', '100%');
    this.g = this.svg.append('g');
    
    // 缩放
    this.svg.call(d3.zoom().scaleExtent([0.5, 3]).on('zoom', (event) => {
      this.g.attr('transform', event.transform);
    }));
  }
  
  renderWorkflow(definition) {
    // 渲染节点
    // 渲染边（包括闭环边）
    // 高亮当前执行节点
    // 显示循环计数
  }
  
  onNodeStart(data) {
    this.highlightNode(data.nodeId, 'running');
    this.addLog(data.nodeLabel, '开始执行');
  }
  
  onNodeComplete(data) {
    this.highlightNode(data.nodeId, data.result.status);
    this.addLog(data.nodeLabel, `完成: ${data.result.status}`);
    // 如果是闭环节点，显示循环计数
    if (data.result.output?.retest_count) {
      this.showLoopBadge(data.nodeId, data.result.output.retest_count);
    }
  }
  
  onNodeEvent(data) {
    // 实时显示节点内部进度
    this.addNodeEvent(data.nodeId, data.event, data.data);
  }
  
  onApprovalRequired(data) {
    // 弹出审批对话框
    this.showApprovalDialog(data.nodeId, data.output);
  }
  
  onWorkflowComplete(data) {
    // 显示完成总结
    this.showSummary(data.context);
  }
}
```

### 6.2 工作流配置界面

**新增文件**: `public/js/workflow-config.js`, `public/workflow-config.html`

功能：
- 可视化编辑YAML工作流定义
- 拖拽节点+连线
- 节点属性配置面板
- YAML预览+保存到DB

### 6.3 覆盖率详情页

**新增文件**: `public/js/coverage-detail.js`, `public/coverage.html`

功能：
- 硬约束清单展示（按类型分组：寄存器/状态机/参数矩阵）
- 覆盖状态标识（✅已覆盖/❌未覆盖/⏳待检查）
- 覆盖率环形图（按类型+总体）
- 未覆盖项详情+建议补测用例

### 6.4 硬约束清单管理

**新增文件**: `public/js/hard-constraints.js`

功能：
- 硬约束列表（可筛选类型/状态/来源）
- 手动添加/编辑约束
- 批量导入（从设计文档提取）
- 导出覆盖率报告

### 6.5 UI变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `public/js/workflow-board.js` | 新增 | DAG工作流可视化看板 |
| `public/js/workflow-config.js` | 新增 | 工作流配置编辑器 |
| `public/js/coverage-detail.js` | 新增 | 覆盖率详情页 |
| `public/js/hard-constraints.js` | 新增 | 硬约束管理页面 |
| `public/css/workflow.css` | 新增 | 工作流相关样式 |
| `public/index.html` | 修改 | 导航栏新增入口 |
| `routes/pages.js` | 修改 | 新增页面路由 |

---

## 七、实施优先级与计划

### 7.1 Phase 1（第1-2周）: 核心架构升级

**目标**: 建立声明式工作流引擎 + SSH真机交互 + 深度测试闭环骨架

| 工作项 | 负责 | 工时 | 交付物 |
|--------|------|------|--------|
| 数据库迁移 | 后端 | 1天 | `migrations/001_cta_v2.sql` |
| 声明式工作流引擎 | 后端 | 3天 | `workflowEngine.js` + `default.yaml` |
| pipelineOrchestrator兼容层 | 后端 | 1天 | 兼容旧接口 |
| SSH Python bridge | 后端 | 2天 | `ssh_cli_bridge.py` |
| sdkCliToolService重写 | 后端 | 1天 | 真实SSH交互 |
| 深度测试闭环骨架 | 后端 | 2天 | `deepTestService.js` |
| 硬约束提取+比对 | 后端 | 2天 | `coverage_extractor.py` + `hardConstraintService.js` |
| 集成测试 | 全栈 | 2天 | 端到端验证 |

**Phase 1 验收标准**:
- [x] YAML工作流定义可加载和执行
- [x] SSH可连接真实设备并执行命令
- [x] 深度测试闭环dispatch->hunt->completeness_gate可运转
- [x] 硬约束可提取并做机械比对
- [x] 旧API向后兼容

### 7.2 Phase 2（第3-4周）: 闭环增强 + Agent升级

**目标**: 完善深度测试闭环 + Agent引擎容错 + 多路径交叉验证

| 工作项 | 负责 | 工时 | 交付物 |
|--------|------|------|--------|
| Agent引擎容错处理器 | 后端 | 2天 | `agentErrorHandler.js` |
| Agent引擎核心循环重写 | 后端 | 2天 | `agentExecutionEngine.js`升级 |
| 多路径交叉验证 | 后端 | 3天 | `crossValidationService.js` |
| 流量工具真实打流 | 后端 | 2天 | `trafficToolService.js`修改 |
| 工作流看板UI | 前端 | 3天 | `workflow-board.js` |
| 覆盖率详情页 | 前端 | 2天 | `coverage-detail.js` |
| 集成测试 | 全栈 | 2天 | 端到端验证 |

**Phase 2 验收标准**:
- [x] Agent支持无限轮+5层容错
- [x] 多路径交叉验证可发现不一致Bug
- [x] 工作流看板可视化闭环
- [x] 覆盖率详情可查看

### 7.3 Phase 3（第5-6周）: 配置体系 + 知识沉淀

**目标**: Agent三件套 + 知识沉淀闭环 + 工作流配置UI

| 工作项 | 负责 | 工时 | 交付物 |
|--------|------|------|--------|
| Agent三件套服务 | 后端 | 2天 | `agentConfigService.js` |
| Agent配置文件 | 后端 | 2天 | `agent_configs/*/config.yaml+SOUL.md+USER.md` |
| 知识沉淀服务 | 后端 | 2天 | `knowledgeSettleService.js` |
| 工作流配置UI | 前端 | 2天 | `workflow-config.js` |
| 硬约束管理UI | 前端 | 1天 | `hard-constraints.js` |
| 全量回归测试 | 全栈 | 2天 | 端到端验证 |
| 文档更新 | 全栈 | 1天 | API文档+用户手册 |

**Phase 3 验收标准**:
- [x] 每个Agent有完整的config+SOUL+USER三件套
- [x] 输入契约验证生效
- [x] 工作流完成后知识自动入库
- [x] 工作流配置可视化编辑
- [x] 全量功能回归通过

### 7.4 总体时间线

```
Week 1-2 (Phase 1):
  ├─ DB迁移
  ├─ 工作流引擎
  ├─ SSH Python bridge
  ├─ 深度测试闭环骨架
  └─ 硬约束提取+比对

Week 3-4 (Phase 2):
  ├─ Agent引擎容错
  ├─ 多路径交叉验证
  ├─ 流量工具真实打流
  ├─ 工作流看板UI
  └─ 覆盖率详情页

Week 5-6 (Phase 3):
  ├─ Agent三件套
  ├─ 知识沉淀闭环
  ├─ 工作流配置UI
  ├─ 硬约束管理UI
  └─ 全量回归测试
```

---

## 附录

### A. 文件变更全量清单

| # | 文件路径 | 变更类型 | Phase | 说明 |
|---|---------|---------|-------|------|
| 1 | `migrations/001_cta_v2.sql` | 新增 | P1 | 数据库迁移 |
| 2 | `services/workflowEngine.js` | 新增 | P1 | 声明式工作流引擎 |
| 3 | `workflow_definitions/default.yaml` | 新增 | P1 | 默认工作流定义 |
| 4 | `workflow_definitions/regression.yaml` | 新增 | P1 | 回归测试工作流 |
| 5 | `pipelineOrchestrator.js` | 修改 | P1 | 委托给WorkflowEngine |
| 6 | `scripts/cta_extensions/ssh_cli_bridge.py` | 新增 | P1 | SSH桥接脚本 |
| 7 | `scripts/cta_extensions/coverage_extractor.py` | 新增 | P1 | 硬约束提取+比对 |
| 8 | `scripts/cta_extensions/requirements.txt` | 新增 | P1 | Python依赖 |
| 9 | `services/sdkCliToolService.js` | 重写 | P1 | 真实SSH交互 |
| 10 | `services/deepTestService.js` | 新增 | P1 | 深度测试闭环 |
| 11 | `services/hardConstraintService.js` | 新增 | P1 | 硬约束裁决 |
| 12 | `services/agentErrorHandler.js` | 新增 | P2 | 5层容错处理器 |
| 13 | `agentExecutionEngine.js` | 修改 | P2 | 核心循环升级 |
| 14 | `services/crossValidationService.js` | 新增 | P2 | 多路径交叉验证 |
| 15 | `services/trafficToolService.js` | 修改 | P2 | 真实打流 |
| 16 | `public/js/workflow-board.js` | 新增 | P2 | 工作流看板 |
| 17 | `public/js/coverage-detail.js` | 新增 | P2 | 覆盖率详情 |
| 18 | `public/css/workflow.css` | 新增 | P2 | 工作流样式 |
| 19 | `services/agentConfigService.js` | 新增 | P3 | Agent三件套服务 |
| 20 | `agent_configs/*/config.yaml` | 新增 | P3 | Agent配置 |
| 21 | `agent_configs/*/SOUL.md` | 新增 | P3 | Agent角色 |
| 22 | `agent_configs/*/USER.md` | 新增 | P3 | Agent用户偏好 |
| 23 | `services/knowledgeSettleService.js` | 新增 | P3 | 知识沉淀 |
| 24 | `public/js/workflow-config.js` | 新增 | P3 | 工作流配置UI |
| 25 | `public/js/hard-constraints.js` | 新增 | P3 | 硬约束管理UI |
| 26 | `routes/pipeline.js` | 修改 | P1 | 工作流API |
| 27 | `routes/sdk-cli.js` | 修改 | P1 | SSH API |
| 28 | `routes/constraints.js` | 新增 | P1 | 硬约束API |
| 29 | `routes/cross-validation.js` | 新增 | P2 | 交叉验证API |
| 30 | `routes/knowledge.js` | 修改 | P3 | 知识API |
| 31 | `.env` | 修改 | P2 | Agent配置项 |

### B. 新增API清单

| 方法 | 路径 | 说明 | Phase |
|------|------|------|-------|
| GET | `/api/workflow-definitions` | 列出工作流定义 | P1 |
| GET | `/api/workflow-definitions/:type` | 获取工作流定义 | P1 |
| POST | `/api/workflow-definitions` | 创建/更新工作流定义 | P1 |
| GET | `/api/workflow-instances/:id` | 获取工作流实例 | P1 |
| GET | `/api/tasks/:taskId/workflow` | 获取任务的工作流 | P1 |
| POST | `/api/ssh/sessions` | 创建SSH会话 | P1 |
| POST | `/api/ssh/sessions/:id/execute` | 执行命令 | P1 |
| POST | `/api/ssh/sessions/:id/batch` | 批量执行 | P1 |
| POST | `/api/ssh/sessions/:id/snapshot` | 获取快照 | P1 |
| POST | `/api/ssh/sessions/:id/reconnect` | 重连 | P1 |
| DELETE | `/api/ssh/sessions/:id` | 关闭会话 | P1 |
| GET | `/api/tasks/:taskId/constraints` | 获取硬约束清单 | P1 |
| POST | `/api/tasks/:taskId/constraints` | 添加硬约束 | P1 |
| POST | `/api/tasks/:taskId/constraints/extract` | 从文档提取硬约束 | P1 |
| POST | `/api/tasks/:taskId/constraints/compare` | 执行覆盖比对 | P1 |
| GET | `/api/tasks/:taskId/cross-validation` | 获取交叉验证结果 | P2 |
| GET | `/api/tasks/:taskId/coverage` | 获取覆盖率报告 | P2 |
| GET | `/api/agent-configs` | 列出Agent配置 | P3 |
| GET | `/api/agent-configs/:name` | 获取Agent配置 | P3 |
| PUT | `/api/agent-configs/:name` | 更新Agent配置 | P3 |
| GET | `/api/tasks/:taskId/knowledge-artifacts` | 获取知识生成物 | P3 |

---

> **报告结束**  
> 作者: AI领航员·DC技术研究助手  
> 日期: 2026-07-15
