# xTest AI 测试用例生成系统 —— 全局-局部两阶段架构设计报告

> 版本: v1.0  
> 日期: 2026-05-09  
> 状态: 已实现

---

## 一、当前系统问题诊断

### 1.1 一级测试点生成流程缺陷

当前流程采用"预生成 → 用例生成 → 事后匹配"三步走：

```
[1] generateLevel1Points()   ← 单独调AI，取前10个chunk拼摘要，经常失败
[2] executeMapPhase()        ← 生成用例，AI完全不知道一级测试点的存在
[3] assignLevel1ToCases()    ← 事后用名称模糊匹配，效果差
```

**具体问题**：

| 问题 | 位置 | 影响 |
|------|------|------|
| `timeout` 参数被错误放进请求体 | `level1PointService.js` | 内网大模型可能返回400/422 |
| JSON 解析只认 ` ```json ` 格式 | `level1PointService.js` | 内网模型返回格式不符则直接返回空 |
| 错误被静默吞掉 | `level1PointService.js` | 用户看不到真正失败原因 |
| 骨架输入只取前10个chunk | `level1PointService.js` | 遗漏文档后半段的异常/边界测试领域 |
| 用例生成时无全局上下文 | `caseGeneratorService.js` | 模型只看局部chunk，生成的用例缺乏系统级视角 |
| 事后匹配用简单字符串包含 | `level1PointService.js` | "Buffer管理测试"和"缓存管理测试"无法关联 |

### 1.2 核心矛盾

一级测试点和用例是同一份材料的两种抽象，却被拆成两次独立的 AI 调用，且两次调用之间没有语义关联。模型生成用例时不知道测试点的存在，生成测试点时不知道用例的具体内容。

---

## 二、新架构设计：全局-局部两阶段架构（Global-Local Two-Pass）

### 2.1 架构总览

```
用户点击"生成用例" (level1Mode = 'auto')
    │
    ▼
╔══════════════════════════════════════════════════════════════════╗
║  阶段零：预处理（Preprocessing）                                  ║
╚══════════════════════════════════════════════════════════════════╝
    │
    ├─→ 加载所有 chunks（ai_material_chunks）
    ├─→ existingLevel1 = getExistingLevel1Points(moduleId)
    └─→ 初始化任务状态
    │
    ▼
╔══════════════════════════════════════════════════════════════════╗
║  阶段一：全局感知（Global Awareness）—— Map-Reduce               ║
║                                                                  ║
║  目标：从全文中提取两个冻结常量                                    ║
║    ① globalContext（全局系统背景，~500字）                        ║
║    ② allValidLevel1（全量一级测试点枚举）                         ║
╚══════════════════════════════════════════════════════════════════╝
    │
    ├─→ [1a] Map：逐 chunk 轻量扫描（并发）
    │       每个 chunk 提取：核心术语 + 测试领域
    │       输出极短（~100字/chunk），token 消耗极低
    │
    ├─→ [1b] Reduce：合并压缩
    │       ├─ 合并所有 chunk 摘要 → globalContext（全局系统背景）
    │       └─ 合并所有测试领域 + existingLevel1 → deltaLevel1 → allValidLevel1
    │
    ├─→ [1c] 降级判断
    │       ├─ 骨架失败 + existingLevel1 为空 → 返回失败 ❌
    │       └─ 骨架失败 + existingLevel1 有值 → 降级继续 ✅
    │       └─ 骨架成功 → 正常继续 ✅
    │
    └─→ [1d] 冻结两个常量
            globalContext = "本模块为交换芯片QoS模块，基于224G SerDes..."
            allValidLevel1 = ["Buffer管理测试", "调度算法测试", ...]
    │
    ▼
╔══════════════════════════════════════════════════════════════════╗
║  阶段二：局部生成（Local Generation）—— 并发 Map                  ║
║                                                                  ║
║  每个 chunk 独立生成用例，注入全局上下文 + 测试点枚举约束          ║
╚══════════════════════════════════════════════════════════════════╝
    │
    └─→ Loop: 并发遍历每个 chunk
        ├─→ Prompt 注入：
        │     【全局系统背景】globalContext
        │     【可选一级测试点】allValidLevel1 枚举
        │     【当前文档片段】chunk.chunk_content
        │
        ├─→ callAI()
        ├─→ 解析响应（三级 fallback 容错）
        ├─→ 每个 case 带 level1_point 字段
        └─→ 保存用例 + 写入 temp_level1_points
    │
    ▼
╔══════════════════════════════════════════════════════════════════╗
║  阶段三：收尾（Reduce & Finalize）                                ║
╚══════════════════════════════════════════════════════════════════╝
    │
    ├─→ 去重：dedupService.executeReducePhase(taskId)
    ├─→ 兜底校验：case.level1_name ∈ allValidLevel1
    │     不在 → 模糊匹配 → 匹配不上 → 归入"其他测试"
    └─→ 更新任务状态
    │
    ▼
╔══════════════════════════════════════════════════════════════════╗
║  阶段四：审核入库                                                 ║
╚══════════════════════════════════════════════════════════════════╝
    │
    ├─→ 前端展示生成结果（一级测试点 + 用例）
    └─→ 工程师审核 → 确认入库
```

---

### 2.2 阶段一详细设计：全局感知（Global Awareness）

#### 2.2.1 Map 阶段：逐 chunk 轻量扫描

**目标**：每个 chunk 只提取两类信息，不生成用例，输出极短。

```
对每个 chunk 发送的 Prompt：
─────────────────────────────────────────────────────
请分析以下需求文档片段，提取两类信息：

1. 系统背景信息：硬件型号、软件版本、网络环境、全局配置参数、
   模块依赖关系、前置条件等"硬核"技术约束
2. 测试领域：该片段涉及的测试领域/功能区域名称

文档片段：
${chunk.chunk_content}

输出格式（严格JSON）：
```json
{
  "background": "系统背景关键信息，100字以内",
  "test_domains": ["领域1", "领域2", ...]
}
```
─────────────────────────────────────────────────────

特点：
  - max_tokens = 300（vs 用例生成的 4000）
  - 输出通常 < 150 tokens
  - 可高并发执行（无共享状态）
  - 每个 chunk 都被扫描到，不存在遗漏
```

**并发策略**：使用独立的 `skeletonQueue`（并发度8），比用例生成的 `apiQueue`（并发度4）更高，因为每次调用更轻量。

#### 2.2.2 Reduce 阶段：合并压缩

**输入**：所有 chunk 的 Map 结果

**输出**：两个冻结常量

```
Reduce 步骤 1：合并全局背景
─────────────────────────────────────────────────────
将所有 chunk 的 background 拼接，发一次 AI 调用压缩：

Prompt:
  "请将以下多个文档片段的系统背景信息，融合成一份 500 字以内的
   '全局测试系统背景说明'。保留所有技术约束和硬性参数，
   去除重复，保持精炼。"

输入：chunk1.background + chunk2.background + ... + chunkN.background
输出：globalContext（~500字，约 200-300 tokens）

示例输出：
  "本模块为交换芯片QoS子系统，基于224G SerDes架构，
   默认开启PFC优先级流控，支持8个优先级队列。
   调度算法支持SP/WRR/DWRR三种模式，Buffer总大小24MB，
   共享Buffer池与Headroom池动态分配。
   网络侧接口为100G/400G以太网，主机侧为PCIe Gen5。
   全局约束：最小报文长度64B，最大MTU 9216B，
   流控反压时延 < 5us。"

Reduce 步骤 2：合并测试领域 + 增量提取一级测试点
─────────────────────────────────────────────────────
将所有 chunk 的 test_domains 去重合并，与 existingLevel1 对比，
提取增量测试点：

  allDomains = 去重合并所有 chunk 的 test_domains
  deltaDomains = allDomains 中不在 existingLevel1 中的部分

  对 deltaDomains 中的每个领域，让 AI 规范化命名：
  Prompt:
    "请将以下测试领域名称规范化为一级测试点名称。
     命名规范：'功能/领域名称 + 测试类型'
     现有一级测试点（避免重复）：${existingLevel1.map(p => p.name).join(', ')}
     待规范化的领域：${deltaDomains.join(', ')}
     输出格式：{"delta_level1_points": [{"name": "...", "test_type": "..."}]}"

  最终：
    allValidLevel1 = [...existingLevel1, ...deltaLevel1]
```

**为什么 Map-Reduce 比直接摘要更好？**

| 维度 | 直接摘要（取前N个chunk） | Map-Reduce 扫描 |
|------|--------------------------|------------------|
| 全文覆盖 | ❌ 只看前10个chunk | ✅ 每个chunk都被扫描 |
| 异常测试覆盖 | ❌ 遗漏后半段 | ✅ 每个chunk独立提取 |
| Token 消耗 | 1次调用，~6000 tokens 输入 | N次轻量调用 + 1次合并，总消耗相当 |
| 并发友好 | 单次调用，无并发 | ✅ Map阶段可高并发 |
| 信息密度 | 低（大量原文被截断丢弃） | 高（每个chunk只保留精华） |

#### 2.2.3 降级策略

```
骨架生成的降级逻辑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

try {
    // Map-Reduce 执行
    const mapResults = await executeSkeletonMap(chunks);
    globalContext = await reduceGlobalContext(mapResults);
    deltaLevel1 = await reduceDeltaLevel1(mapResults, existingLevel1);
} catch (error) {
    logger.warn('全局感知阶段失败，尝试降级', { error: error.message });
    globalContext = '';
    deltaLevel1 = [];
}

allValidLevel1 = [...existingLevel1, ...deltaLevel1];

if (allValidLevel1.length === 0) {
    // ❌ 骨架失败 + 没有已有测试点 → 无法继续
    await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET status = 'failed', 
            error_message = '一级测试点骨架生成失败，且模块无已有测试点，无法继续'
        WHERE task_id = ?
    `, [taskId]);
    return { status: 'failed' };
}

// ✅ 有可用测试点（不管来自骨架还是已有），继续执行
```

---

### 2.3 阶段二详细设计：局部生成（Local Generation）

#### 2.3.1 Prompt 结构

每个 chunk 的 Prompt 由三部分组成：

```
┌─────────────────────────────────────────────┐
│  System Prompt（不变）                        │
│  "你是一个专业的测试用例设计专家..."            │
├─────────────────────────────────────────────┤
│  User Prompt                                 │
│                                              │
│  【全局系统背景】                              │  ← 新增：globalContext
│  本模块为交换芯片QoS子系统，基于224G SerDes... │
│                                              │
│  【可选的一级测试点】                          │  ← 新增：allValidLevel1 枚举
│  1. Buffer管理测试 (功能测试)                  │
│  2. 调度算法测试 (功能测试)                    │
│  3. PFC流控测试 (功能测试)                     │
│  4. 异常处理测试 (异常测试)                    │
│  5. 性能压力测试 (性能测试)                    │
│                                              │
│  【当前文档片段】                              │  ← 原有：chunk 内容
│  文件: qos_spec.docx                          │
│  片段序号: 7                                  │
│  内容: ...                                    │
│                                              │
│  【生成要求】                                 │  ← 增强
│  1. 结合全局系统背景的约束生成用例              │
│  2. level1_point 必须从上方列表中选择          │
│  3. ...                                      │
│                                              │
│  【输出格式】                                 │  ← 新增 level1_point 字段
│  ```json                                     │
│  {                                           │
│    "cases": [{                               │
│      "name": "...",                          │
│      "level1_point": "Buffer管理测试",        │
│      ...                                     │
│    }]                                        │
│  }                                           │
│  ```                                         │
└─────────────────────────────────────────────┘
```

**关键设计**：

- `globalContext` 约 500 字（~200-300 tokens），对每个 chunk 的 token 开销增加有限
- `allValidLevel1` 枚举列表通常 5-15 项，约 100-200 tokens
- 两者合计增加 ~400-500 tokens/请求，但带来的质量提升远超成本

#### 2.3.2 level1_point 约束策略

**优先使用 JSON Schema enum（如果模型支持）**：

```javascript
if (supportsStructuredOutput(aiConfig)) {
    requestBody.response_format = {
        type: "json_schema",
        json_schema: {
            name: "test_cases",
            schema: {
                type: "object",
                properties: {
                    cases: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                level1_point: {
                                    type: "string",
                                    enum: allValidLevel1.map(p => p.name)
                                },
                            }
                        }
                    }
                }
            }
        }
    };
}
```

**降级为 Prompt 自然语言约束（内网模型大概率走这条路）**：

```
## 一级测试点约束
level1_point 字段只能从以下选项中选择，不要自创：
${allValidLevel1.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}

如果当前片段的测试内容无法归入以上任何测试点，选择最接近的一个。
```

#### 2.3.3 响应解析与一级测试点归属

```
AI 响应解析流程
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1] 三级 fallback 解析 JSON（复用现有逻辑）
    ├─→ 尝试 ```json 代码块
    ├─→ 尝试截断的代码块 + 修复
    └─→ 尝试直接 JSON.parse

[2] 提取 cases[]，每个 case 带 level1_point 字段

[3] level1_point 校验与归属
    for each case:
      pointName = case.level1_point
      
      // 精确匹配 allValidLevel1
      matched = allValidLevel1.find(p => p.name === pointName)
      if (matched) {
          if (matched.isExisting) {
              case.level1_id = matched.id
              case.is_new_level1 = 0
          } else {
              case.is_new_level1 = 1
          }
          case.level1_name = matched.name
          case.level1_source = matched.isExisting ? 'existing' : 'skeleton'
          continue
      }
      
      // 模糊匹配（去空格/符号后比较）
      fuzzyMatched = findFuzzyMatch(pointName, allValidLevel1)
      if (fuzzyMatched) {
          case.level1_name = fuzzyMatched.name
          case.is_new_level1 = fuzzyMatched.isExisting ? 0 : 1
          case.level1_source = fuzzyMatched.isExisting ? 'existing' : 'skeleton'
          continue
      }
      
      // 按 test_type 匹配
      typeMatches = allValidLevel1.filter(p => p.test_type === case.type)
      if (typeMatches.length > 0) {
          case.level1_name = typeMatches[0].name
          case.is_new_level1 = typeMatches[0].isExisting ? 0 : 1
          case.level1_source = typeMatches[0].isExisting ? 'existing' : 'skeleton'
          continue
      }
      
      // 兜底：归入"其他测试"
      case.level1_name = null
      case.is_new_level1 = 0
      case.level1_source = 'fallback'
```

#### 2.3.4 temp_level1_points 写入策略

```
一级测试点写入时机
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

deltaLevel1 在阶段一 Reduce 完成后，立即批量写入 temp_level1_points：

  const values = deltaLevel1.map(point => [
      `TEMP-L1-${uuidv4().slice(0, 8).toUpperCase()}`,
      taskId, moduleId, point.name, point.test_type || '功能测试', point.description || ''
  ]);
  const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
  await pool.execute(`
      INSERT INTO temp_level1_points 
          (temp_level1_id, task_id, module_id, name, test_type, description)
      VALUES ${placeholders}
  `, values.flat());

阶段二不需要再写入 temp_level1_points，因为所有测试点已经在阶段一确定了。
用例的 level1_name 直接关联到这些已写入的测试点。
```

---

### 2.4 阶段三详细设计：收尾

#### 2.4.1 去重

不变，复用现有 `dedupService.executeReducePhase(taskId)`。

#### 2.4.2 兜底校验

```
轻量级校验（因为阶段二已经有枚举约束，这里只是安全护栏）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const validNames = allValidLevel1.map(p => p.name);
const fallbackName = '其他测试';

const [cases] = await pool.execute(`
    SELECT temp_case_id, level1_name FROM temp_test_cases 
    WHERE task_id = ? AND status = 'pending'
`, [taskId]);

const toFix = cases.filter(c => !c.level1_name || !validNames.includes(c.level1_name));
if (toFix.length === 0) return;

// 事务批量修复
const connection = await pool.getConnection();
try {
    await connection.beginTransaction();
    for (const caseItem of toFix) {
        const matched = findFuzzyMatch(caseItem.level1_name, allValidLevel1);
        const resolvedName = matched ? matched.name : fallbackName;
        const isNewLevel1 = matched ? (matched.isExisting ? 0 : 1) : 1;
        const level1Source = matched ? (matched.isExisting ? 'existing' : 'skeleton') : 'fallback';
        await connection.execute(`
            UPDATE temp_test_cases 
            SET level1_name = ?, is_new_level1 = ?, level1_source = ?
            WHERE temp_case_id = ?
        `, [resolvedName, isNewLevel1, level1Source, caseItem.temp_case_id]);
    }
    await connection.commit();
} catch (error) {
    await connection.rollback();
    throw error;
} finally {
    connection.release();
}
```

---

### 2.5 Handler 流程变更

```javascript
// caseGenerationHandler.js - 新流程

async execute(task) {
    const taskId = task.task_id;
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});

    // ── 阶段零：预处理 ──
    let globalContext = '';
    let allValidLevel1 = [];

    if (config.level1Mode === 'auto') {
        const existingLevel1 = await level1PointService.getExistingLevel1Points(task.target_id);

        // ── 阶段一：全局感知 ──
        const skeletonResult = await level1PointService.executeGlobalAwareness(
            taskId, task.target_id, existingLevel1
        );

        allValidLevel1 = skeletonResult.allValidLevel1 || existingLevel1;

        if (!skeletonResult.success && allValidLevel1.length === 0) {
            // 骨架失败 + 无已有测试点 → 返回失败
            return { status: 'failed', message: '骨架生成失败，无可用测试点' };
        }

        globalContext = skeletonResult.globalContext || '';
    } else if (config.selectedLevel1Ids && config.selectedLevel1Ids.length > 0) {
        const existingLevel1 = await level1PointService.getExistingLevel1Points(task.target_id);
        allValidLevel1 = existingLevel1.filter(p => config.selectedLevel1Ids.includes(p.id));
    }

    // ── 阶段二：局部生成 ──
    const mapResult = await caseGeneratorService.executeMapPhase(taskId, {
        globalContext,
        allValidLevel1
    });

    // ── 阶段三：去重 + 校验 ──
    await dedupService.executeReducePhase(taskId);

    if (config.level1Mode === 'auto' && allValidLevel1.length > 0) {
        await level1PointService.validateLevel1Assignments(taskId, allValidLevel1);
    } else if (config.selectedLevel1Ids && config.selectedLevel1Ids.length > 0) {
        await level1PointService.assignExistingLevel1ToCases(taskId, config.selectedLevel1Ids[0]);
    }

    // ── 更新任务状态 ──
    // ...
}
```

---

### 2.6 数据流总览

```
                    阶段一                           阶段二
              ┌─────────────────┐            ┌─────────────────────┐
              │                 │            │                     │
  chunks ────→│  Map (并发扫描)  │──→ summaries │  Map (并发生成用例)  │
              │                 │            │                     │
              │  Reduce (合并)  │──→ globalContext ──→ 注入每个chunk  │
              │                 │            │                     │
  existing ──→│                 │──→ allValidLevel1 ──→ 枚举约束     │
              │                 │            │                     │
              └─────────────────┘            └─────────────────────┘
                     │                                │
                     ▼                                ▼
              temp_level1_points               temp_test_cases
              (deltaLevel1 写入)              (带 level1_name)
```

---

## 三、API 调用成本分析

### 3.1 阶段一成本

```
Map 阶段：
  N 个 chunk × 轻量扫描
  每次输入：chunk_content（~2000字 ≈ 800 tokens）+ prompt（~150 tokens）
  每次输出：~100 tokens
  单次总计：~1050 tokens
  N=20 时：~21,000 tokens

Reduce 阶段：
  2 次 AI 调用（合并背景 + 规范化测试点）
  每次输入：~2000 tokens
  每次输出：~500 tokens
  总计：~5,000 tokens

阶段一总计：~26,000 tokens
```

### 3.2 阶段二成本

```
与现有流程相同，但每个 chunk 的 prompt 增加了：
  globalContext：~300 tokens
  allValidLevel1 枚举：~150 tokens
  增加幅度：~450 tokens/chunk

N=20 时额外增加：~9,000 tokens
```

### 3.3 总成本对比

| 方案 | API 调用次数 | 总 Token 消耗（N=20） |
|------|-------------|----------------------|
| 当前方案 | 1(骨架) + 20(用例) = 21 | ~105,000 |
| 新方案 | 20(扫描) + 2(合并) + 20(用例) = 42 | ~140,000 |
| 增幅 | +100% | +33% |

**说明**：调用次数翻倍，但阶段一的 20 次扫描都是轻量级的（每次 ~1050 tokens vs 用例生成的 ~5000 tokens），实际 token 增幅只有 33%。换来的是：

- ✅ 一级测试点一致性从"事后模糊匹配"提升到"枚举强约束"
- ✅ 全文覆盖，不再遗漏异常/边界测试领域
- ✅ 用例质量显著提升（有全局系统背景约束）
- ✅ 并发安全，无共享可变状态

---

## 四、数据库迁移

### 新增字段

| 表 | 字段 | 类型 | 说明 |
|----|------|------|------|
| `ai_case_generation_tasks` | `global_context` | text | 全局系统背景（阶段一提取） |
| `ai_case_generation_tasks` | `skeleton_level1_json` | json | 全量一级测试点枚举（阶段一冻结） |
| `ai_case_generation_tasks` | `stage` | enum | 增加 `skeleton` 阶段 |
| `temp_test_cases` | `level1_source` | enum('skeleton','existing','fallback') | 一级测试点来源 |

### 迁移文件

`migrations/20260509_add_global_local_architecture.sql`

### 自动迁移

在 `services/autoMigration.js` 中已注册迁移检查项，系统启动时自动执行。

---

## 五、修改的文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `migrations/20260509_add_global_local_architecture.sql` | **新建** | 数据库迁移 |
| `services/level1PointService.js` | **大幅重构** | 删除旧方法，新增全局感知方法 |
| `services/caseGeneratorService.js` | **核心修改** | 注入全局背景+枚举约束，移除 timeout 参数 |
| `services/handlers/caseGenerationHandler.js` | **重构** | 编排新四阶段流程 |
| `services/taskScheduler.js` | **同步修改** | 与 handler 保持一致 |
| `services/autoMigration.js` | **小改** | 添加新迁移检查项 |

### 不需要改动的部分

- **前端 UI**：level1Mode 选项保留，`auto` 含义变为"全局-局部两阶段生成"
- **`mergeLevel1Points`**：合并逻辑不变
- **前端审批/拒绝 UI**：不变
- **去重逻辑**：不变
- **文件解析/切分逻辑**：不变

---

## 六、新旧方案对比总结

```
旧方案（三步走，两步废）：
━━━━━━━━━━━━━━━━━━━━━━━━
  [1] 单独生成一级测试点（取前10个chunk摘要，经常失败）
  [2] 生成用例（AI不知道测试点，不知道全局背景）
  [3] 事后模糊匹配（效果差）

新方案（全局-局部两阶段）：
━━━━━━━━━━━━━━━━━━━━━━━━
  [1] 全局感知：Map-Reduce 扫描全文 → globalContext + allValidLevel1
  [2] 局部生成：每个chunk注入全局背景 + 枚举约束 → 高质量用例
  [3] 轻量校验：安全护栏（极少触发）

核心提升：
  ✅ 一致性：枚举约束 >> 事后模糊匹配
  ✅ 覆盖度：全文扫描 >> 前10个chunk摘要
  ✅ 用例质量：全局背景注入 >> 纯局部生成
  ✅ 并发安全：只读常量 >> 共享可变状态
  ✅ 容错性：骨架失败降级 >> 骨架失败全废
```

---

## 七、内网离线部署注意事项

1. **超时时间**：内网模型响应较慢，`_callAI` 的 axios 超时设置为 `Math.max(effectiveTimeout + 15000, 180000)`，确保至少 3 分钟
2. **API Key 校验**：`_callAI` 在调用前校验 `api_key` 是否存在，避免无意义的请求
3. **响应格式容错**：三级 fallback JSON 解析（```json → ``` → 直接解析），兼容各种内网模型输出格式
4. **降级策略**：骨架生成失败时，如果已有测试点则继续执行，不会阻塞整个流程
5. **并发度**：骨架扫描并发度 8（vs 用例生成 4），因为每次调用更轻量
6. **`timeout` 参数**：已从请求体中移除，避免内网模型 API 参数校验失败
