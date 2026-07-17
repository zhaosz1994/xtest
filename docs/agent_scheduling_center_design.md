# Agent 调度中心设计文档

> **用途**: 流水线可视化面板,实时展示 Pipeline 上每个 Agent 的执行状态
> **项目路径**: `/Users/zhao/Desktop/my_projects/xtest`
> **技术栈**: Node.js + Express + MySQL + 前端原生JS + Socket.io
> **日期**: 2026-07-09

---

## 1. 设计目标

### 1.1 核心问题

当前 Agent 控制台只能通过任务列表查看状态(文字),无法直观看到:
- 多个任务在流水线上并行推进的进度
- 每个任务当前卡在哪个阶段、哪个 Agent 在执行
- Agent 之间的交接关系(planner → sdk_cli → traffic → critic)
- 资源锁与任务的绑定关系
- 某个阶段卡住时的瓶颈定位

### 1.2 目标

构建一个 **Pipeline 看板**,类似 CI/CD 流水线或 Jenkins Stage View:
- **横轴**: 流水线阶段(7 个 Stage,从左到右)
- **纵轴**: 并发任务(每个任务一行)
- **卡片**: 每个任务在当前阶段显示为一个卡片,带状态色和进度
- **实时**: 任务状态变化时 WebSocket 推送,看板自动更新
- **可操作**: 点击卡片查看详情、审批、暂停/恢复/取消

---

## 2. 流水线阶段模型

### 2.1 阶段定义 (7 Stages)

基于现有 `agent_session.phase` 和 `agent_tasks.status` 的实际值,定义 7 个标准阶段:

| # | Stage ID | 中文名 | 主导 Agent | 对应 phase | 对应 task.status | 说明 |
|---|----------|--------|-----------|------------|-----------------|------|
| 1 | `created` | 已创建 | system | `IDLE` | `draft` | 任务已创建,等待启动 |
| 2 | `learn_context` | 学习上下文 | planner_agent | `LEARN_CONTEXT` | `draft` | 读取知识文件,理解模块上下文 |
| 3 | `approval_gate` | 审批门 | critic_agent / admin | — | `waiting_for_critic_review` | execute/autonomous 模式需管理员审批 |
| 4 | `execute_config` | SDK 配置 | sdk_cli_agent_v1 | `EXECUTE_CONFIG` | `approved` / `diagnosing` | 执行 SDK CLI 命令,配置芯片 |
| 5 | `execute_traffic` | 流量执行 | traffic_agent_v1 | `EXECUTE_TRAFFIC` | `diagnosing` | 打流,收集 counter/pcap |
| 6 | `critic_gate` | 评审门 | critic_agent_v1 | `CRITIC_GATE` | `diagnosing` | 审查证据链,生成联合判定 |
| 7 | `completed` | 已完成 | system | `OBSERVE` | `completed` / `failed` / `cancelled` | 终态:通过/失败/取消 |

### 2.2 阶段映射规则

后端新增 `mapTaskToStage(task, session)` 函数,将 task/session 状态映射到 Stage:

```
IF task.status IN ('completed','failed','cancelled') → stage 7 (completed)
ELSE IF session.phase = 'OBSERVE' → stage 7
ELSE IF session.phase = 'CRITIC_GATE' OR task.status = 'waiting_for_critic_review' → stage 6 (critic_gate) 或 stage 3 (approval_gate)
  - 区分: approval_status = 'pending' → stage 3; approval_status = 'approved' → stage 6
ELSE IF session.phase = 'EXECUTE_TRAFFIC' → stage 5
ELSE IF session.phase = 'EXECUTE_CONFIG' → stage 4
ELSE IF session.phase = 'LEARN_CONTEXT' → stage 2
ELSE → stage 1 (created)
```

### 2.3 阶段状态色

| 卡片状态 | 颜色 | 含义 |
|---------|------|------|
| `pending` | 灰色 `#94a3b8` | 等待前置阶段完成 |
| `running` | 蓝色脉冲 `#3b82f6` 动画 | 当前正在执行 |
| `blocked` | 橙色 `#f59e0b` | 被阻塞(等审批/等资源) |
| `passed` | 绿色 `#22c55e` | 阶段通过 |
| `failed` | 红色 `#ef4444` | 阶段失败 |
| `skipped` | 浅灰虚线 | 该阶段不适用(如 dry_run 跳过审批) |

---

## 3. 可视化设计

### 3.1 整体布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Agent 调度中心                                            [刷新] [设置]    │
├─────────────────────────────────────────────────────────────────────────┤
│  汇总栏:  运行中 3 · 排队 2 · 今日完成 5 · 失败 1 · 平均耗时 12m          │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬────────┤
│  已创建   │ 学习上下文 │  审批门   │ SDK配置  │ 流量执行  │  评审门  │ 已完成 │
│          │          │          │          │          │          │        │
│ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │          │┌──────┐│
│ │AT_008│ │ │AT_007│ │ │AT_006│ │ │AT_005│ │ │AT_004│ │          ││AT_003││
│ │ ■灰色 │ │ │■蓝色│ │ │■橙色│ │ │■蓝色│ │ │■蓝色│ │          ││■绿色 ││
│ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │ └──────┘ │          │└──────┘│
│          │          │          │          │          │          │┌──────┐│
│ ┌──────┐ │          │          │          │          │          ││AT_002││
│ │AT_009│ │          │          │          │          │          ││■红色 ││
│ │ ■灰色 │ │          │          │          │          │          │└──────┘│
│ └──────┘ │          │          │          │          │          │        │
├──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴────────┤
│  Agent 状态栏:                                                          │
│  [planner] ●在线 空闲  [sdk_cli] ●在线 执行AT_005  [traffic] ●在线 空闲  │
│  [critic]  ●在线 执行AT_006                                              │
├─────────────────────────────────────────────────────────────────────────┤
│  任务详情 (点击卡片后展开)                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ AT_005  PFC / Switch Gen3 RevB / CModel / Dry-run               │    │
│  │                                                                 │    │
│  │  [已创建] → [学习上下文] → [审批门⏭跳过] → [SDK配置●运行中] → [流量] → [评审] → [完成] │    │
│  │     ✓ 14:01    ✓ 14:02       ✓ skipped      14:05 运行中...      │    │
│  │                                                                 │    │
│  │  事件流:                                                        │    │
│  │  14:01  SESSION_CREATED    system → planner                     │    │
│  │  14:02  PHASE_CHANGED       LEARN_CONTEXT → APPROVAL_GATE        │    │
│  │  14:03  APPROVAL            not_required (dry_run)              │    │
│  │  14:05  PHASE_CHANGED       → EXECUTE_CONFIG                     │    │
│  │  14:05  CLI_COMMAND         "show interface Pfc" → ok            │    │
│  │                                                                 │    │
│  │  资源锁: CMODEL_INSTANCE_01 (LEASE_xxx, 60min, 剩余52min)       │    │
│  │                                                                 │    │
│  │  [暂停] [取消] [查看CLI日志] [查看流量日志]                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 卡片设计

每个任务卡片在对应的 Stage 列下显示:

```
┌──────────────────┐
│ AT_005           │  ← 任务ID (粗体)
│ PFC              │  ← 模块名
│ ●运行中 14:05     │  ← 状态指示灯 + 进入时间
│ ⏱ 3m / 60m       │  ← 已耗时 / TTL (有资源锁时显示)
│ 🔄 sdk_cli_agent  │  ← 当前执行 Agent
│ ──────────────── │
│ Gen3RevB · CModel │  ← 芯片 + 环境 (灰色小字)
│ Dry-run          │  ← 模式
└──────────────────┘
```

### 3.3 卡片交互

| 操作 | 行为 |
|------|------|
| 点击卡片 | 展开下方任务详情面板 |
| Hover 卡片 | 显示 tooltip: 最后一条事件 + 耗时 |
| 卡片右上角 ⋮ | 快捷菜单: 暂停/恢复/取消/查看日志 |
| 拖拽卡片 | 不支持(阶段由后端驱动,不能手动拖) |

### 3.4 任务详情面板

点击卡片后,底部展开详情面板,包含 4 个 Tab:

**Tab 1: 流水线时间线**
- 横向展示 7 个 Stage,已完成的标 ✓ + 时间戳,当前 Stage 高亮,未到的灰色
- 每个 Stage 下方显示: 主导 Agent 名 + 耗时 + 关键事件摘要

**Tab 2: 事件流**
- 按时间倒序展示 `agent_events` 列表
- 每条: 时间 + 事件类型 + sender → receiver + payload 摘要
- 支持"只看错误"筛选

**Tab 3: 资源与锁**
- 展示绑定的 `env_resource_lease`: 资源ID + 状态 + TTL 倒计时 + 续租/释放按钮
- 如果在队列中(`env_resource_queue`): 展示排队位置 + 预计等待

**Tab 4: 产物 (Artifacts)**
- `artifacts` JSON 里的内容: CLI 计划、流量配置、verdict 等
- `verdict` 如果有: 显示判定结果(passed/failed/inconclusive) + 5 项标准

### 3.5 Agent 状态栏

底部固定显示 4 个 Agent 的实时状态:

```
[planner_agent]  ●在线  空闲         任务数: 0    成功率: 95%
[sdk_cli_agent]  ●在线  执行 AT_005  任务数: 1    成功率: 88%
[traffic_agent]  ●离线  —            任务数: 0    成功率: 0%
[critic_agent]   ●在线  执行 AT_006  任务数: 1    成功率: 92%
```

- 点击 Agent 名 → 跳转到 Agent 管理页
- ● 在线绿色 / ● 离线灰色 / ● 维护橙色

---

## 4. 后端 API 设计

### 4.1 新增路由: `routes/agentPipeline.js`

挂载路径: `/api/agent-pipeline`

#### 4.1.1 看板数据

```
GET /api/agent-pipeline/board?status=active&limit=20
```

**响应:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "running": 3,
      "queued": 2,
      "completedToday": 5,
      "failedToday": 1,
      "avgDurationSec": 720
    },
    "stages": [
      { "id": "created", "name": "已创建", "agentRole": "system" },
      { "id": "learn_context", "name": "学习上下文", "agentRole": "planner_agent" },
      { "id": "approval_gate", "name": "审批门", "agentRole": "critic_agent" },
      { "id": "execute_config", "name": "SDK配置", "agentRole": "sdk_cli_agent_v1" },
      { "id": "execute_traffic", "name": "流量执行", "agentRole": "traffic_agent_v1" },
      { "id": "critic_gate", "name": "评审门", "agentRole": "critic_agent_v1" },
      { "id": "completed", "name": "已完成", "agentRole": "system" }
    ],
    "tasks": [
      {
        "taskId": "AT_005",
        "moduleId": 8,
        "moduleName": "PFC",
        "chipVersion": "Switch Gen3 RevB",
        "targetEnv": "CModel",
        "mode": "dry_run",
        "objective": "验证 PFC 死锁恢复",
        "currentStage": "execute_config",
        "stageStatus": "running",
        "stageEnteredAt": "2026-07-09T14:05:00Z",
        "stageDurationSec": 180,
        "activeAgent": "sdk_cli_agent_v1",
        "approvalStatus": "not_required",
        "leaseId": "LEASE_xxx",
        "leaseResourceId": "CMODEL_INSTANCE_01",
        "leaseExpiresAt": "2026-07-09T15:05:00Z",
        "stageHistory": [
          { "stage": "created", "status": "passed", "enteredAt": "T1", "exitedAt": "T2", "durationSec": 60 },
          { "stage": "learn_context", "status": "passed", "enteredAt": "T2", "exitedAt": "T3", "durationSec": 120 },
          { "stage": "approval_gate", "status": "skipped", "reason": "dry_run模式无需审批" },
          { "stage": "execute_config", "status": "running", "enteredAt": "T4", "exitedAt": null }
        ],
        "lastEvent": {
          "eventType": "CLI_COMMAND",
          "senderAgent": "sdk_cli_agent_v1",
          "createdAt": "2026-07-09T14:07:00Z",
          "summary": "show interface Pfc → ok"
        }
      }
    ],
    "agents": [
      {
        "agentId": "sdk_cli_agent_v1",
        "displayName": "SDK CLI Agent",
        "status": "online",
        "currentTaskId": "AT_005",
        "activeTaskCount": 1,
        "metrics": { "successRate": 0.88, "avgDurationSec": 450 }
      }
    ]
  }
}
```

#### 4.1.2 任务详情

```
GET /api/agent-pipeline/tasks/:taskId
```

返回单个任务的完整流水线信息:
- 任务基本信息 (来自 `agent_tasks`)
- 当前 session + phase (来自 `agent_session`)
- 阶段时间线 (从 `agent_events` 推算每个 Stage 的进出时间)
- 事件列表 (来自 `agent_events`,最近 50 条)
- CLI 命令轨迹 (来自 `cli_command_trace`,最近 20 条)
- 流量运行轨迹 (来自 `traffic_run_trace`,最近 5 条)
- 资源锁信息 (来自 `env_resource_lease`)
- 产物 + 判定 (来自 `agent_tasks.artifacts` + `verdict`)

#### 4.1.3 Agent 负载

```
GET /api/agent-pipeline/agents/load
```

返回 4 个 Agent 的当前负载:
- 每个 Agent: 状态、当前执行的任务 ID、待执行任务数、历史成功率/平均耗时
- 数据来源: `agent_registry` + `agent_session`(当前 phase 对应的 agent) + `agent_tasks`(活跃任务)

#### 4.1.4 看板操作

```
POST /api/agent-pipeline/tasks/:taskId/action
```

请求体:
```json
{
  "action": "pause" | "resume" | "cancel" | "approve" | "reject",
  "comment": "审批备注(可选)"
}
```

- `pause` → `updateTaskStatus(taskId, 'paused')`
- `resume` → `updateTaskStatus(taskId, 'diagnosing')` (恢复到诊断状态)
- `cancel` → `updateTaskStatus(taskId, 'cancelled')` + 释放资源锁
- `approve` → `approveTask(taskId, 'approved', comment)` (管理员审批)
- `reject` → `approveTask(taskId, 'rejected', comment)`

---

## 5. 实时更新机制

### 5.1 WebSocket 扩展

现有 Socket.io 已在 `server.js` 中初始化 (`global.io = io`),目前只用于用户在线状态。

**新增事件:**

| 事件名 | 触发时机 | Payload |
|--------|---------|---------|
| `agent:task_created` | 新任务创建 | `{ taskId, stage: 'created' }` |
| `agent:task_stage_changed` | session.phase 变化 | `{ taskId, fromStage, toStage, agentId }` |
| `agent:task_status_changed` | task.status 变化 | `{ taskId, status, stage }` |
| `agent:task_completed` | 任务完成/失败/取消 | `{ taskId, verdict, stage: 'completed' }` |
| `agent:approval_needed` | 任务进入审批门 | `{ taskId, mode, moduleId }` |
| `agent:approval_decided` | 审批结果 | `{ taskId, decision, comment }` |
| `agent:agent_status_changed` | Agent 上下线 | `{ agentId, status, currentTaskId }` |
| `agent:event_emitted` | 任意 agent_events 插入 | `{ taskId, eventType, senderAgent, summary }` |

### 5.2 推送实现

在 `agentConsoleService.js` 的关键方法中,状态变化后追加 `io.emit()`:

```javascript
// emitEvent 方法中,入库后推送
async emitEvent({ sessionId, taskId, eventType, senderAgent, ... }) {
  await pool.execute(/* INSERT agent_events */);
  if (phase) {
    await pool.execute('UPDATE agent_session SET phase = ? WHERE session_id = ?', [phase, sessionId]);
  }
  // 新增: WebSocket 推送
  if (global.io) {
    global.io.emit('agent:event_emitted', { taskId, eventType, senderAgent, phase });
    if (phase) {
      global.io.emit('agent:task_stage_changed', {
        taskId, toStage: mapPhaseToStage(phase), agentId: senderAgent
      });
    }
  }
  return { sessionId, eventType, phase, payload };
}

// updateTaskStatus 方法中
async updateTaskStatus(user, taskId, status, patch) {
  // ... 现有逻辑 ...
  if (global.io) {
    global.io.emit('agent:task_status_changed', { taskId, status });
    if (['completed','failed','cancelled'].includes(status)) {
      global.io.emit('agent:task_completed', { taskId, verdict: task.verdict });
    }
  }
  return task;
}

// approveTask 方法中
async approveTask(user, taskId, decision, comment) {
  // ... 现有逻辑 ...
  if (global.io) {
    global.io.emit('agent:approval_decided', { taskId, decision, comment });
  }
  return task;
}
```

### 5.3 前端订阅

```javascript
// agent-console.js 中新增 pipeline 模块
initPipelineSocket() {
  if (!window.socket) return;
  // 看板整体刷新(任务进入/离开阶段)
  window.socket.on('agent:task_stage_changed', (data) => {
    this.updateTaskCardStage(data.taskId, data.toStage);
  });
  // 任务状态变化
  window.socket.on('agent:task_status_changed', (data) => {
    this.updateTaskCardStatus(data.taskId, data.status);
  });
  // 新任务创建
  window.socket.on('agent:task_created', (data) => {
    this.loadPipelineBoard(); // 刷新整个看板
  });
  // 审批通知
  window.socket.on('agent:approval_needed', (data) => {
    this.showToast(`任务 ${data.taskId} 需要审批`, 'warning');
    this.loadPipelineBoard();
  });
}
```

### 5.4 降级策略

如果 WebSocket 连接断开,自动降级为 **5 秒轮询**:

```javascript
startPipelinePolling() {
  this.pipelinePollingTimer = setInterval(() => {
    this.loadPipelineBoard();
  }, 5000);
}

// WebSocket 重连后停止轮询
onSocketReconnect() {
  clearInterval(this.pipelinePollingTimer);
  this.loadPipelineBoard(); // 立即刷新一次
}
```

---

## 6. 前端架构

### 6.1 新增卡片

在 `index.html` 的 Agent Console 区域新增一张卡片:

```html
<div class="agent-console-card" id="pipeline-card">
  <div class="agent-console-card-header">
    <h3>Agent 调度中心</h3>
    <div>
      <button id="pipeline-refresh-btn" class="agent-console-small-btn">刷新</button>
      <button id="pipeline-auto-toggle" class="agent-console-small-btn">自动刷新: 开</button>
    </div>
  </div>
  <div id="pipeline-summary" class="pipeline-summary-bar"></div>
  <div id="pipeline-board" class="pipeline-board-container"></div>
  <div id="pipeline-agent-bar" class="pipeline-agent-bar"></div>
  <div id="pipeline-detail-panel" class="pipeline-detail-panel" style="display:none;"></div>
</div>
```

### 6.2 CSS 设计要点

- **看板容器**: `display: flex; overflow-x: auto;` 7 列等宽,最小列宽 180px
- **卡片**: `border-radius: 8px; border-left: 4px solid <状态色>;` 状态色通过 CSS class 控制
- **运行中动画**: `@keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(59,130,246,0.4)} 70%{box-shadow:0 0 0 8px rgba(59,130,246,0)} 100%{box-shadow:0 0 0 0 rgba(59,130,246,0)} }`
- **Stage 列头**: sticky 定位,滚动时保持可见
- **详情面板**: 从底部滑出,`position: fixed; bottom: 0; height: 40vh;`
- **Agent 状态栏**: `position: sticky; bottom: 0;` 固定在卡片底部

### 6.3 JS 模块结构

在 `public/js/agent-console.js` 新增方法:

```
// ===== Pipeline 调度中心 =====
loadPipelineBoard()              // 加载看板数据
renderPipelineBoard(data)        // 渲染看板
renderPipelineSummary(summary)   // 渲染汇总栏
renderPipelineAgentBar(agents)   // 渲染 Agent 状态栏
updateTaskCardStage(taskId, toStage)    // WebSocket: 卡片移动到新阶段
updateTaskCardStatus(taskId, status)    // WebSocket: 卡片状态变化
showPipelineTaskDetail(taskId)   // 展开任务详情
loadPipelineTaskDetail(taskId)   // 加载详情数据
renderPipelineTimeline(task)     // 渲染流水线时间线
renderPipelineEvents(events)      // 渲染事件流
renderPipelineResources(lease)    // 渲染资源与锁
renderPipelineArtifacts(task)     // 渲染产物
executeTaskAction(taskId, action)  // 执行操作(暂停/取消/审批)
initPipelineSocket()              // 初始化 WebSocket 订阅
startPipelinePolling()            // 降级轮询
```

### 6.4 看板筛选

看板顶部提供筛选:
- **状态筛选**: 全部 / 运行中 / 排队 / 已完成 / 失败
- **模式筛选**: 全部 / advisory / dry_run / execute / autonomous
- **模块筛选**: 全部 / [模块下拉]
- **时间范围**: 今天 / 近 3 天 / 近 7 天 / 全部

---

## 7. 阶段时间线推算

### 7.1 问题

现有 `agent_events` 记录了事件,但没有直接记录"Stage 进入/退出时间"。需要从事件流推算。

### 7.2 推算逻辑

后端 `buildStageTimeline(events)` 函数:

```javascript
function buildStageTimeline(events) {
  const timeline = STAGES.map(s => ({
    stage: s.id,
    status: 'pending',
    enteredAt: null,
    exitedAt: null,
    durationSec: null,
    agentId: null
  }));

  for (const evt of events) {
    const stage = mapEventToStage(evt);
    const stageEntry = timeline.find(t => t.stage === stage);
    if (!stageEntry) continue;

    // 第一次出现该阶段的事件 → 记录进入时间
    if (!stageEntry.enteredAt) {
      stageEntry.enteredAt = evt.created_at;
      stageEntry.status = 'running';
      stageEntry.agentId = evt.sender_agent;
    }
    // 该阶段最后一条事件 → 记录退出时间
    // (由下一个阶段的第一条事件触发,或最后一条事件的时间)
  }

  // 后处理: 当前阶段设为 running,已过去阶段设为 passed
  const currentIdx = findCurrentStageIndex(timeline);
  for (let i = 0; i < timeline.length; i++) {
    if (i < currentIdx) timeline[i].status = 'passed';
    else if (i === currentIdx) timeline[i].status = 'running';
    else timeline[i].status = 'pending';
  }

  // 计算每阶段耗时
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].enteredAt && timeline[i + 1]?.enteredAt) {
      timeline[i].exitedAt = timeline[i + 1].enteredAt;
      timeline[i].durationSec = diff(timeline[i].exitedAt, timeline[i].enteredAt);
    }
  }

  return timeline;
}
```

### 7.3 事件到 Stage 的映射

| 事件类型 | 映射到的 Stage |
|---------|---------------|
| `SESSION_CREATED` | `learn_context` |
| `PHASE_CHANGED` (payload.phase = `LEARN_CONTEXT`) | `learn_context` |
| `PHASE_CHANGED` (payload.phase = `EXECUTE_CONFIG`) | `execute_config` |
| `PHASE_CHANGED` (payload.phase = `EXECUTE_TRAFFIC`) | `execute_traffic` |
| `PHASE_CHANGED` (payload.phase = `CRITIC_GATE`) | `critic_gate` |
| `PHASE_CHANGED` (payload.phase = `OBSERVE`) | `completed` |
| `CLI_COMMAND` | `execute_config` |
| `TRAFFIC_STARTED` / `TRAFFIC_STOPPED` | `execute_traffic` |
| `APPROVAL_REQUIRED` | `approval_gate` |
| `APPROVAL_DECIDED` | 离开 `approval_gate` |
| `TASK_COMPLETED` / `TASK_FAILED` | `completed` |

---

## 8. 权限与操作

### 8.1 权限矩阵

| 操作 | 普通用户 | 管理员 |
|------|---------|--------|
| 查看看板 | ✅ (只看自己的任务) | ✅ (看所有任务) |
| 查看任务详情 | ✅ (自己的) | ✅ (所有) |
| 暂停/恢复/取消 | ✅ (自己的) | ✅ (所有) |
| 审批 (approve/reject) | ❌ | ✅ |
| 续租资源锁 | ✅ (自己的) | ✅ (所有) |
| 强制释放他人资源 | ❌ | ✅ |

### 8.2 安全约束

- `execute` / `autonomous` 模式的任务在 `approval_gate` 阶段必须等待管理员审批
- `high` 风险资源在 `execute_traffic` 阶段需要额外的管理员确认
- 任务取消时自动释放绑定的资源锁
- 审批操作记录到 `agent_audit_logs`

---

## 9. 数据来源汇总

| 数据 | 表 | 用途 |
|------|-----|------|
| 任务列表 | `agent_tasks` | 看板卡片数据 |
| 当前阶段 | `agent_session` (phase) | 卡片所在 Stage |
| 事件流 | `agent_events` | 详情 Tab 2 + 阶段时间线推算 |
| CLI 轨迹 | `cli_command_trace` | 详情 Tab 2 (CLI 命令) |
| 流量轨迹 | `traffic_run_trace` | 详情 Tab 2 (流量运行) |
| 资源锁 | `env_resource_lease` | 详情 Tab 3 + 卡片 TTL |
| 资源队列 | `env_resource_queue` | 详情 Tab 3 (排队中) |
| Agent 注册 | `agent_registry` | Agent 状态栏 |
| 审计日志 | `agent_audit_logs` | 详情 Tab 1 (审计) |
| 产物/判定 | `agent_tasks.artifacts` / `verdict` | 详情 Tab 4 |

---

## 10. 实现计划

### Phase 1: 后端看板 API (2h)

1. 新建 `routes/agentPipeline.js`,实现 4 个端点:
   - `GET /board` — 看板聚合数据(任务列表 + 阶段映射 + Agent 状态)
   - `GET /tasks/:taskId` — 任务详情(含事件流 + CLI/流量轨迹 + 资源锁)
   - `GET /agents/load` — Agent 负载
   - `POST /tasks/:taskId/action` — 暂停/恢复/取消/审批
2. 在 `agentConsoleService.js` 新增 `mapTaskToStage()` + `buildStageTimeline()` 辅助函数
3. `server.js` 注册路由

### Phase 2: WebSocket 推送 (1h)

1. 在 `agentConsoleService.js` 的 `emitEvent` / `updateTaskStatus` / `approveTask` 中追加 `global.io.emit()`
2. 定义 8 个事件类型常量
3. 前端 `initPipelineSocket()` 订阅事件

### Phase 3: 前端看板 UI (3h)

1. `index.html` 新增 Pipeline 卡片 HTML
2. `agent-console.js` 新增看板渲染逻辑(约 400 行)
   - `loadPipelineBoard()` — 拉取 + 渲染看板
   - `renderPipelineBoard()` — 7 列看板 + 卡片
   - `renderPipelineSummary()` — 汇总栏
   - `renderPipelineAgentBar()` — Agent 状态栏
   - 看板筛选(状态/模式/模块/时间)
3. CSS: 看板布局 + 卡片样式 + 运行中脉冲动画 + Stage 列头 sticky

### Phase 4: 任务详情面板 (2h)

1. 点击卡片展开底部详情面板
2. 4 个 Tab: 流水线时间线 / 事件流 / 资源与锁 / 产物
3. 流水线时间线渲染(7 Stage 横向时间线)
4. 事件流表格(时间 + 类型 + sender → receiver + 摘要)

### Phase 5: 操作与降级 (1h)

1. 卡片操作: 暂停/恢复/取消/审批
2. WebSocket 断线降级为 5 秒轮询
3. 审批通知 toast 提示

### 总计: 约 9 小时

---

## 11. 不做的事 (Out of Scope)

1. **自动调度**: 不会自动分配任务给空闲 Agent(任务由用户手动创建 + Agent 顺序执行)
2. **任务依赖图**: 不支持任务间的 DAG 依赖(每个任务独立)
3. **甘特图**: 不做时间轴甘特图(用 Stage 看板 + 时间线代替)
4. **拖拽排序**: 不支持手动拖拽卡片改变阶段(阶段由后端 Agent 执行驱动)
5. **多租户隔离**: 不做多组织隔离(基于现有 user/admin 两级权限)
