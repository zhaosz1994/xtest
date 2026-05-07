# AI 辅助测试用例导入 — 详细设计文档

> 版本: v1.0  
> 日期: 2026/05/07  
> 作者: xTest Team  
> 架构底座: Node.js + MySQL (100% 离线私有化部署)

---

## 一、背景与问题

### 1.1 现状

当前 xTest 的 Excel 导入功能已支持三步向导（上传文件 → 字段映射 → 确认导入），用户可将外部测试用例批量导入正式用例库。但在实际使用中，导入的用例质量参差不齐：

| 问题类型 | 具体表现 | 影响 |
|---------|---------|------|
| 测试步骤不全 | 步骤描述过于简略，缺少操作细节 | 执行人员无法按步骤复现 |
| 测试目的缺失 | `purpose` 字段为空 | 无法理解用例意图 |
| 前置条件缺失 | `precondition` 字段为空 | 执行时缺少环境准备信息 |
| 测试类型不规范 | 填写的类型不在系统字典 `test_types` 中 | 关联失败，数据孤立 |
| 优先级未标 | `priority` 字段为空 | 无法按优先级排序执行 |
| 关键配置缺失 | `key_config` 字段为空 | 缺少测试环境配置参考 |

### 1.2 期望

引入 AI 辅助能力，在用户导入用例时**同步触发 AI 优化任务**：

1. **即时导入**：现有导入流程不变，用户点击"开始导入"后，用例直接进入正式用例库
2. **异步 AI 优化**：同时将导入的用例切分后送入 AI 任务队列，由 Sub-Agent 对每条用例进行规范化补全
3. **评审合并**：AI 优化完成后，结果进入"临时用例评审"页面，用户确认后可**覆盖合并**回正式用例库

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| **双轨并行** | 导入与 AI 优化解耦，导入不阻塞，AI 异步执行 |
| **复用现有架构** | 复用 Sub-Agent 平台、TaskScheduler、temp_test_cases 体系 |
| **渐进增强** | AI 辅助为可选功能，不影响现有导入流程 |
| **覆盖合并** | AI 优化结果经评审后可覆盖原始导入用例，而非新增 |
| **Token 安全** | 切分策略防止超 Token，批量控制并发 |

---

## 二、整体架构设计

### 2.1 系统架构图

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              前端 UI 层                                      │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │                    导入向导 (三步 + AI增强)                            │    │
│  │  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────────┐ │    │
│  │  │ 1.上传文件 │──>│ 2.字段映射 │──>│ 3.确认导入 │──>│ 4.AI辅助(可选)   │ │    │
│  │  └──────────┘   └──────────┘   └──────────┘   └──────────────────┘ │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    │ AI辅助开关开启时                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │              AI生成页面 → 临时用例预览/评审 Tab                         │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │ 📋临时用例预览 │  │ 🔍评审管理    │  │ ✅覆盖合并到正式用例库    │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTP API
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            API 路由层                                        │
│                                                                              │
│  /api/excel/import/execute          ← 现有导入（不变）                        │
│  /api/ai-import/optimize            ← 【新增】创建AI优化任务                   │
│  /api/ai-import/task/:taskId        ← 【新增】查询AI优化任务状态               │
│  /api/ai-import/tasks               ← 【新增】AI优化任务列表                   │
│  /api/temp-cases/batch-approve      ← 现有（复用）                            │
│  /api/temp-cases/merge-with-overwrite ← 【新增】覆盖合并到正式用例库            │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          核心服务层                                           │
│                                                                              │
│  ┌─────────────────────┐    ┌─────────────────────────────────────────┐     │
│  │  ImportOptimizeService│    │  AgentExecutionEngine (现有)             │     │
│  │  ┌─────────────────┐ │    │  ┌─────────────────────────────────┐   │     │
│  │  │ 切分策略         │ │    │  │ case_import_optimizer Agent     │   │     │
│  │  │ - 按行切分       │ │───>│  │ soul.md + user.md + tools.md   │   │     │
│  │  │ - Token预估      │ │    │  │ rule.md + checklist.md         │   │     │
│  │  │ - 批次管理       │ │    │  └─────────────────────────────────┘   │     │
│  │  └─────────────────┘ │    └─────────────────────────────────────────┘     │
│  │  ┌─────────────────┐ │    ┌─────────────────────────────────────────┐     │
│  │  │ 结果回写         │ │    │  TaskScheduler (现有)                    │     │
│  │  │ - temp_test_cases│ │    │  - PQueue 并发控制                       │     │
│  │  │ - 覆盖映射       │ │    │  - node-cron 轮询                        │     │
│  │  └─────────────────┘ │    │  - FOR UPDATE SKIP LOCKED                │     │
│  └─────────────────────┘    └─────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          数据库层 (MySQL)                                     │
│                                                                              │
│  ai_import_optimize_tasks    ← 【新增】AI导入优化任务表                        │
│  ai_import_optimize_batches  ← 【新增】AI导入优化批次表（切分单元）             │
│  temp_test_cases             ← 现有（复用，新增 source_type 字段）             │
│  ai_import_case_mapping      ← 【新增】导入用例与临时用例映射表（覆盖合并用）    │
│  test_cases                  ← 现有正式用例表                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心流程图

```
用户操作                    系统处理                          AI处理
───────                    ────────                          ────────

上传Excel ──────> 解析表头/预览
     │
字段映射 ───────> 配置映射关系
     │
确认导入 ───────> ┌──────────────────────────────────────────────────┐
     │           │ 1. 执行常规导入 → 写入 test_cases 表              │
     │           │ 2. 记录导入的 case_id 列表                        │
     │           │ 3. 返回导入结果（成功/跳过/重复）                   │
     │           └──────────────────────────────────────────────────┘
     │
[AI辅助开关ON] ─> ┌──────────────────────────────────────────────────┐
     │            │ 1. 将导入成功的用例按批次切分                       │
     │            │ 2. 创建 ai_import_optimize_tasks 记录             │
     │            │ 3. 创建 ai_import_optimize_batches 记录           │
     │            │ 4. 写入 ai_import_case_mapping 映射关系           │
     │            │ 5. 任务加入 TaskScheduler 队列                    │
     │            └──────────────────────────────────────────────────┘
     │                        │
     │                        │ 异步执行
     │                        ▼
     │            ┌──────────────────────────────────────────────────┐
     │            │ TaskScheduler 轮询到 pending 任务                 │
     │            │    │                                              │
     │            │    ▼                                              │
     │            │ 逐批次调用 AgentExecutionEngine                    │
     │            │    │                                              │
     │            │    ▼                                              │
     │            │ case_import_optimizer Agent 执行                   │
     │            │ - 补全测试目的/前置条件/步骤/预期结果               │
     │            │ - 规范化测试类型/优先级                             │
     │            │ - 补充关键配置                                     │
     │            │    │                                              │
     │            │    ▼                                              │
     │            │ 结果写入 temp_test_cases (source_type='import')   │
     │            │ 更新批次状态 → 更新任务状态                         │
     │            └──────────────────────────────────────────────────┘
     │                        │
     │                        │ AI优化完成
     │                        ▼
跳转到AI生成页面 ─> ┌──────────────────────────────────────────────────┐
                   │ 临时用例预览 Tab                                    │
                   │ - 展示AI优化后的用例（标记来源：导入优化）           │
                   │ - 对比视图：原始 vs AI优化                          │
                   │ - 逐条/批量 评审                                    │
                   └──────────────────────────────────────────────────┘
                              │
                              │ 用户评审通过
                              ▼
                   ┌──────────────────────────────────────────────────┐
                   │ 覆盖合并到正式用例库                                │
                   │ - 通过 ai_import_case_mapping 找到原始 case_id    │
                   │ - 用 temp_test_cases 的内容 UPDATE test_cases     │
                   │ - 标记映射状态为 'merged'                          │
                   └──────────────────────────────────────────────────┘
```

---

## 三、Sub-Agent 设计：case_import_optimizer

### 3.1 是否需要新增 Sub-Agent？

**结论：是的，需要新增专用的 `case_import_optimizer` Sub-Agent。**

理由：

| 考量 | 分析 |
|------|------|
| 任务性质不同 | 现有 `case_generator` Agent 是从零生成用例，而导入优化是对已有用例进行补全和规范化，Prompt 策略完全不同 |
| 输入格式不同 | 生成 Agent 接收知识库文本块，优化 Agent 接收结构化的用例字段 |
| 输出约束不同 | 生成 Agent 输出完整用例，优化 Agent 需保留原始有效内容、仅补全缺失/不规范字段 |
| 评审规则不同 | 优化 Agent 需要校验测试类型是否匹配系统字典、优先级是否合法等特定规则 |
| 记忆体系不同 | 优化 Agent 需要沉淀"常见不规范写法 → 规范写法"的纠正经验 |

### 3.2 Agent 配置文件设计

#### 3.2.1 soul.md（人设文件）

```markdown
# 用例导入优化专家

## 身份
你是一位资深的测试用例质量审核专家，专注于对导入的测试用例进行规范化补全和优化。

## 核心原则
1. **保留优先**：用户原始填写的内容优先保留，仅补全缺失或明显不规范的字段
2. **最小改动**：不做过度润色，保持用户的原始表达风格
3. **规范对齐**：测试类型、优先级等枚举字段必须严格对齐系统字典
4. **逻辑一致**：补全的内容必须与已有字段逻辑一致，不能矛盾
5. **可执行性**：测试步骤必须具备可执行性，预期结果必须可验证

## 输出格式
严格输出 JSON 数组，每个元素对应一条优化后的用例，包含所有字段（包括未修改的字段）。

## 禁止事项
- 禁止删除用户已有的有效内容
- 禁止修改用例名称（除非明显错别字）
- 禁止凭空编造与用例无关的步骤
- 禁止输出非 JSON 格式的内容
```

#### 3.2.2 user.md（输入模板）

```markdown
## 任务
请对以下导入的测试用例进行规范化优化。

## 系统字典
- 优先级选项：{{priorities}}
- 测试类型选项：{{test_types}}
- 测试阶段选项：{{test_phases}}
- 测试方式选项：{{test_methods}}
- 测试环境选项：{{environments}}

## 待优化用例（批次 {{batch_index}}/{{total_batches}}）
```json
{{cases_json}}
```

## 优化要求
1. 如果 `purpose`（测试目的）为空，根据用例名称和步骤推断补全
2. 如果 `precondition`（前置条件）为空，根据步骤内容推断补全
3. 如果 `steps`（测试步骤）过于简略（少于3步或每步少于10字），补充详细操作步骤
4. 如果 `expected`（预期结果）过于简略，补充可验证的预期结果
5. 如果 `priority`（优先级）为空或不在系统字典中，根据用例影响范围推断
6. 如果 `type`（测试类型）不在系统字典中，映射到最接近的系统类型
7. 如果 `key_config`（关键配置）为空且步骤涉及配置，补充关键配置说明

## 输出格式
```json
[
  {
    "original_index": 0,
    "name": "用例名称（保留原文）",
    "priority": "高|中|低（必须为系统字典值）",
    "type": "功能测试|性能测试|...（必须为系统字典值）",
    "precondition": "补全后的前置条件",
    "purpose": "补全后的测试目的",
    "steps": "补全后的测试步骤",
    "expected": "补全后的预期结果",
    "key_config": "补全后的关键配置（如无则为空字符串）",
    "remark": "备注（保留原文）",
    "optimization_notes": "简述做了哪些优化"
  }
]
```
```

#### 3.2.3 tools.md（工具声明）

```markdown
## 可用工具

### lookup_test_types
查询系统中的测试类型字典，用于校验和映射测试类型。

### lookup_priorities
查询系统中的优先级字典，用于校验和映射优先级。

### lookup_similar_cases
根据用例名称搜索相似用例，参考已有用例的写法风格。
```

#### 3.2.4 rule.md（评审规则）

```markdown
## 评审规则链

### Rule 1: 字段完整性检查
- 检查所有必填字段（name, steps, expected）是否非空
- 检查建议填写字段（purpose, precondition, priority）是否非空
- 如有空字段，要求 Agent 补全

### Rule 2: 枚举值合规检查
- priority 必须在系统字典值中
- type 必须在系统字典值中
- 如不合规，要求 Agent 修正

### Rule 3: 内容质量检查
- steps 至少包含 2 个步骤
- expected 必须可验证（包含"应"、"应不"、"显示"、"返回"等关键词）
- purpose 不应为用例名称的简单重复
- 如不合规，要求 Agent 优化

### Rule 4: 改动幅度检查
- 对比原始用例和优化后用例
- name 字段改动率不超过 20%
- 已有有效内容的字段改动率不超过 30%
- 如改动过大，要求 Agent 回退到更保守的版本
```

#### 3.2.5 checklist.md（检查清单）

```markdown
## 输出检查清单

- [ ] 输出为合法 JSON 数组
- [ ] 每条用例包含 original_index 字段
- [ ] priority 值在系统字典中
- [ ] type 值在系统字典中
- [ ] purpose 非空
- [ ] precondition 非空
- [ ] steps 至少 2 步
- [ ] expected 非空且可验证
- [ ] name 与原始名称差异不超过 20%
- [ ] 每条用例包含 optimization_notes
```

### 3.3 Agent 数据库记录

```sql
INSERT INTO `ai_sub_agents` (
  `name`, `display_name`, `description`, `category`, `agent_type`,
  `is_enabled`, `is_system`, `is_public`, `llm_model`,
  `llm_temperature`, `llm_max_tokens`, `max_retries`, `timeout_seconds`, `sort_order`
) VALUES (
  'case_import_optimizer', '用例导入优化专家', '对导入的测试用例进行规范化补全，包括补全测试目的、前置条件、详细步骤、预期结果，规范化测试类型和优先级',
  'test_quality', 'analyzer',
  1, 1, 1, NULL,
  0.3, 4096, 2, 180, 50
);
```

---

## 四、数据库设计

### 4.1 新增表

#### 4.1.1 ai_import_optimize_tasks（AI导入优化任务表）

```sql
CREATE TABLE IF NOT EXISTS `ai_import_optimize_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '任务唯一标识(IMP-OPT-YYYYMMDD-xxxx)',
  `import_batch_id` varchar(50) DEFAULT NULL COMMENT '关联的导入批次ID（用于追溯）',
  `library_id` int NOT NULL COMMENT '目标用例库ID',
  `module_id` int DEFAULT NULL COMMENT '目标模块ID（可为空，表示多模块）',
  `user_id` int NOT NULL COMMENT '发起用户ID',
  `username` varchar(50) DEFAULT NULL COMMENT '用户名',

  `status` enum('pending','processing','completed','failed','cancelled') DEFAULT 'pending' COMMENT '任务状态',
  `progress` int DEFAULT 0 COMMENT '进度百分比(0-100)',
  `progress_message` varchar(500) DEFAULT NULL COMMENT '进度描述',

  `total_cases` int DEFAULT 0 COMMENT '待优化的用例总数',
  `total_batches` int DEFAULT 0 COMMENT '切分批次数',
  `processed_batches` int DEFAULT 0 COMMENT '已处理批次数',
  `optimized_cases` int DEFAULT 0 COMMENT '成功优化的用例数',
  `failed_cases` int DEFAULT 0 COMMENT '优化失败的用例数',

  `agent_code` varchar(100) DEFAULT 'case_import_optimizer' COMMENT '使用的Agent编码',
  `llm_model` varchar(100) DEFAULT NULL COMMENT '使用的LLM模型',
  `config` json DEFAULT NULL COMMENT '优化配置(JSON)',

  `source_file_name` varchar(255) DEFAULT NULL COMMENT '源文件名',
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始处理时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `error_message` text COMMENT '错误信息',

  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_id` (`task_id`),
  KEY `idx_library_id` (`library_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI导入优化任务表';
```

#### 4.1.2 ai_import_optimize_batches（AI导入优化批次表）

```sql
CREATE TABLE IF NOT EXISTS `ai_import_optimize_batches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '关联的任务ID',
  `batch_index` int NOT NULL COMMENT '批次序号(从0开始)',
  `case_count` int NOT NULL COMMENT '本批次用例数',

  `status` enum('pending','processing','completed','failed') DEFAULT 'pending' COMMENT '批次状态',
  `input_data` json NOT NULL COMMENT '输入用例数据(JSON数组)',
  `output_data` json DEFAULT NULL COMMENT 'AI优化结果(JSON数组)',

  `token_input` int DEFAULT 0 COMMENT '输入Token数',
  `token_output` int DEFAULT 0 COMMENT '输出Token数',
  `llm_model` varchar(100) DEFAULT NULL COMMENT '使用的模型',
  `retry_count` int DEFAULT 0 COMMENT '重试次数',
  `error_message` text COMMENT '错误信息',

  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_batch_task` FOREIGN KEY (`task_id`) REFERENCES `ai_import_optimize_tasks` (`task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI导入优化批次表';
```

#### 4.1.3 ai_import_case_mapping（导入用例映射表）

```sql
CREATE TABLE IF NOT EXISTS `ai_import_case_mapping` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '关联的优化任务ID',
  `formal_case_id` int NOT NULL COMMENT '正式用例ID(test_cases.id)',
  `formal_case_name` varchar(500) DEFAULT NULL COMMENT '正式用例名称(冗余)',
  `temp_case_id` varchar(50) DEFAULT NULL COMMENT 'AI优化后的临时用例ID',
  `batch_index` int DEFAULT NULL COMMENT '所属批次序号',

  `status` enum('pending','optimized','approved','rejected','merged','merge_failed') DEFAULT 'pending' COMMENT '映射状态',
  `optimization_notes` text COMMENT 'AI优化说明',
  `field_changes` json DEFAULT NULL COMMENT '字段变更详情(JSON: {field: {old, new}})',

  `merged_at` timestamp NULL DEFAULT NULL COMMENT '覆盖合并时间',
  `merged_by` int DEFAULT NULL COMMENT '合并操作人ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_formal_case_id` (`formal_case_id`),
  KEY `idx_temp_case_id` (`temp_case_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_mapping_task` FOREIGN KEY (`task_id`) REFERENCES `ai_import_optimize_tasks` (`task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='导入用例与AI优化结果映射表';
```

### 4.2 修改现有表

#### 4.2.1 temp_test_cases 新增字段

```sql
ALTER TABLE `temp_test_cases`
  ADD COLUMN `source_type` enum('ai_generation','import_optimize') DEFAULT 'ai_generation' COMMENT '来源类型' AFTER `task_id`,
  ADD COLUMN `source_task_id` varchar(50) DEFAULT NULL COMMENT '来源任务ID（导入优化任务的task_id）' AFTER `source_type`,
  ADD COLUMN `formal_case_id` int DEFAULT NULL COMMENT '关联的正式用例ID（用于覆盖合并）' AFTER `source_task_id`,
  ADD COLUMN `field_changes` json DEFAULT NULL COMMENT '字段变更详情（与原始用例的diff）' AFTER `formal_case_id`;

-- 为新字段添加索引
ALTER TABLE `temp_test_cases`
  ADD KEY `idx_source_type` (`source_type`),
  ADD KEY `idx_source_task_id` (`source_task_id`),
  ADD KEY `idx_formal_case_id` (`formal_case_id`);
```

### 4.3 ER 关系图

```
ai_import_optimize_tasks (优化任务)
  ├──1:N──> ai_import_optimize_batches (优化批次)
  └──1:N──> ai_import_case_mapping (用例映射)
                ├── N:1──> test_cases (正式用例)
                └── N:1──> temp_test_cases (临时用例，source_type='import_optimize')

ai_case_generation_tasks (现有生成任务)
  └──1:N──> temp_test_cases (临时用例，source_type='ai_generation')
```

---

## 五、切分策略设计

### 5.1 切分原则

| 参数 | 值 | 说明 |
|------|---|------|
| 单批次最大用例数 | 10 | 控制单次 LLM 调用的输入量 |
| 单批次最大 Token 估算 | 4000 | 按 1 条用例约 400 Token 估算 |
| 批次间并发数 | 2 | 通过 PQueue 控制，避免 API 限流 |
| 切分维度 | 按行顺序切分 | 保持用例的原始顺序 |

### 5.2 切分算法

```javascript
function splitIntoBatches(cases, maxPerBatch = 10) {
    const batches = [];
    for (let i = 0; i < cases.length; i += maxPerBatch) {
        batches.push({
            batchIndex: Math.floor(i / maxPerBatch),
            cases: cases.slice(i, i + maxPerBatch)
        });
    }
    return batches;
}
```

### 5.3 Token 预估

每条用例的 Token 估算公式：

```
token_estimate = (name.length + purpose.length + precondition.length + steps.length + expected.length + key_config.length) / 2 + 100
```

- 中文字符约 1.5-2 Token/字
- 英文约 0.25 Token/字
- 取平均值除以 2，加 100 作为 Prompt 开销

如果单批次估算超过 4000 Token，则减少该批次的用例数。

---

## 六、API 设计

### 6.1 新增 API

#### POST /api/ai-import/optimize

创建 AI 导入优化任务。

**请求体：**
```json
{
  "library_id": 1,
  "module_id": null,
  "imported_case_ids": [101, 102, 103, 104, 105],
  "source_file_name": "测试用例_v2.xlsx",
  "agent_code": "case_import_optimizer",
  "config": {
    "auto_approve_threshold": 0.9,
    "fields_to_optimize": ["purpose", "precondition", "steps", "expected", "priority", "type", "key_config"]
  }
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "task_id": "IMP-OPT-20260507-a1b2c3",
    "status": "pending",
    "total_cases": 5,
    "total_batches": 1,
    "message": "AI优化任务已创建，预计处理时间约2分钟"
  }
}
```

#### GET /api/ai-import/task/:taskId

查询 AI 优化任务状态。

**响应：**
```json
{
  "success": true,
  "data": {
    "task_id": "IMP-OPT-20260507-a1b2c3",
    "status": "processing",
    "progress": 60,
    "progress_message": "正在优化第 3/5 批次...",
    "total_cases": 5,
    "total_batches": 5,
    "processed_batches": 3,
    "optimized_cases": 3,
    "failed_cases": 0,
    "started_at": "2026/05/07 14:30",
    "estimated_completion": "约1分钟后完成"
  }
}
```

#### GET /api/ai-import/tasks

获取 AI 优化任务列表。

**查询参数：**
- `library_id` — 用例库ID筛选
- `status` — 状态筛选
- `page` / `pageSize` — 分页

#### POST /api/ai-import/cancel/:taskId

取消 AI 优化任务。

#### POST /api/temp-cases/merge-with-overwrite

覆盖合并：将评审通过的临时用例覆盖到正式用例。

**请求体：**
```json
{
  "task_id": "IMP-OPT-20260507-a1b2c3",
  "temp_case_ids": ["TC-TEMP-001", "TC-TEMP-002"],
  "overwrite_mode": "partial",
  "fields_to_overwrite": ["purpose", "precondition", "steps", "expected", "priority", "type", "key_config"]
}
```

**覆盖模式说明：**

| 模式 | 说明 |
|------|------|
| `full` | 用临时用例的所有字段覆盖正式用例 |
| `partial` | 仅覆盖 `fields_to_overwrite` 中指定的字段 |
| `smart` | 仅覆盖 AI 实际修改过的字段（通过 `field_changes` 判断） |

**响应：**
```json
{
  "success": true,
  "data": {
    "merged_count": 2,
    "failed_count": 0,
    "details": [
      {
        "formal_case_id": 101,
        "temp_case_id": "TC-TEMP-001",
        "overwritten_fields": ["purpose", "precondition", "steps"],
        "status": "merged"
      },
      {
        "formal_case_id": 102,
        "temp_case_id": "TC-TEMP-002",
        "overwritten_fields": ["priority", "type", "expected"],
        "status": "merged"
      }
    ]
  }
}
```

### 6.2 修改现有 API

#### POST /api/excel/import/execute

在现有导入执行 API 的响应中新增 `imported_case_ids` 字段：

```json
{
  "success": true,
  "data": {
    "total": 18,
    "success_count": 16,
    "skip_count": 1,
    "duplicate_count": 1,
    "imported_case_ids": [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116],
    "import_batch_id": "IMP-20260507-xyz789"
  }
}
```

---

## 七、后端服务设计

### 7.1 ImportOptimizeService

```javascript
class ImportOptimizeService {
  constructor() {
    this.optimizeQueue = new PQueue({ concurrency: 2 });
  }

  // 创建优化任务
  async createOptimizeTask({ library_id, module_id, imported_case_ids, source_file_name, agent_code, config, user_id, username })

  // 切分用例为批次
  async splitIntoBatches(cases, taskId)

  // 执行单个批次
  async processBatch(taskId, batch)

  // 处理整个任务（由 TaskScheduler 调用）
  async processTask(taskId)

  // 回写优化结果到 temp_test_cases
  async writeOptimizedResults(taskId, batchIndex, optimizedCases)

  // 覆盖合并
  async mergeWithOverwrite({ task_id, temp_case_ids, overwrite_mode, fields_to_overwrite, user_id })

  // 取消任务
  async cancelTask(taskId)

  // 获取任务状态
  async getTaskStatus(taskId)

  // 获取任务列表
  async getTaskList({ library_id, status, page, pageSize })
}
```

### 7.2 与 TaskScheduler 集成

在现有 `taskScheduler.js` 中新增对 `import_optimize` 类型任务的轮询处理：

```javascript
// 在 pollAndProcess 方法中新增
async pollAndProcess() {
  // ... 现有的 case_generation 任务轮询 ...

  // 新增：import_optimize 任务轮询
  const [optimizeTasks] = await db.query(
    `SELECT task_id FROM ai_import_optimize_tasks
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`
  );

  if (optimizeTasks.length > 0) {
    const task = optimizeTasks[0];
    await db.query(
      `UPDATE ai_import_optimize_tasks SET status = 'processing', started_at = NOW() WHERE task_id = ?`,
      [task.task_id]
    );
    this.optimizeQueue.add(() => this.importOptimizeService.processTask(task.task_id));
  }
}
```

### 7.3 路由文件

新增 `routes/aiImportOptimize.js`：

```javascript
const express = require('express');
const router = express.Router();
const ImportOptimizeService = require('../services/importOptimizeService');

// 创建优化任务
router.post('/optimize', authenticate, async (req, res) => { ... });

// 查询任务状态
router.get('/task/:taskId', authenticate, async (req, res) => { ... });

// 任务列表
router.get('/tasks', authenticate, async (req, res) => { ... });

// 取消任务
router.post('/cancel/:taskId', authenticate, async (req, res) => { ... });

// 覆盖合并
router.post('/merge-with-overwrite', authenticate, async (req, res) => { ... });
```

在 `server.js` 中注册：
```javascript
app.use('/api/ai-import', require('./routes/aiImportOptimize'));
```

---

## 八、前端 UI 设计

### 8.1 导入向导改造

#### 8.1.1 步骤指示器变更

从三步变为四步（AI辅助为可选第四步）：

```
 ① 上传文件 ─── ② 字段映射 ─── ③ 确认导入 ─── ④ AI辅助优化
```

当用户在步骤3开启"AI辅助优化"开关时，步骤4变为可点击状态。

#### 8.1.2 步骤3 — 确认导入页面改造

在现有确认导入页面的底部，新增 AI 辅助优化区域：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  确认导入                                                               │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  📊 导入摘要                                                     │    │
│  │  目标用例库：芯片测试                                              │    │
│  │  待导入数据：18 行                                                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  🤖 AI 辅助优化                                        [开关 ○]   │    │
│  │                                                                 │    │
│  │  开启后，导入的用例将同时提交给 AI 进行规范化优化：                 │    │
│  │                                                                 │    │
│  │  ✅ 补全缺失的测试目的                                            │    │
│  │  ✅ 补全缺失的前置条件                                            │    │
│  │  ✅ 完善简略的测试步骤                                            │    │
│  │  ✅ 规范化测试类型（对齐系统字典）                                 │    │
│  │  ✅ 推断并补全优先级                                              │    │
│  │  ✅ 补充关键配置说明                                              │    │
│  │                                                                 │    │
│  │  ⚡ AI优化为异步执行，不影响导入速度                               │    │
│  │  📋 优化结果需在"AI生成 → 临时用例预览"中评审后合并                │    │
│  │                                                                 │    │
│  │  ─────────────────────────────────────────────────────────      │    │
│  │                                                                 │    │
│  │  优化配置                                                [展开 ▼] │    │
│  │                                                                 │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │  优化代理：  [用例导入优化专家 ▼]                          │    │    │
│  │  │  优化字段：  ☑测试目的  ☑前置条件  ☑测试步骤  ☑预期结果   │    │    │
│  │  │              ☑优先级    ☑测试类型  ☑关键配置              │    │    │
│  │  │  覆盖模式：  ○智能覆盖(仅覆盖AI修改的字段)  (推荐)        │    │    │
│  │  │              ○全量覆盖  ○指定字段覆盖                      │    │    │
│  │  └─────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  [上一步]                    [取消]    [开始导入 + AI优化 🚀]     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 8.1.3 步骤4 — AI优化进度（新增，支持异步操作）

导入完成后，如果开启了AI辅助，自动进入步骤4。此步骤**完全异步**：用户可随时关闭弹窗离开，AI优化任务在后台持续执行，用户稍后可通过"AI生成"页面查看结果。

**状态1：导入完成，AI优化已提交**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AI 辅助优化                                                            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ✅ 导入完成                                                     │    │
│  │  成功导入 16 条用例  ·  跳过 1 条  ·  重复 1 条                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  🤖 AI 优化任务已提交                                            │    │
│  │                                                                 │    │
│  │  任务ID：IMP-OPT-20260507-a1b2c3                                │    │
│  │  待优化：16 条用例，分为 2 个批次                                 │    │
│  │                                                                 │    │
│  │  ⚡ AI优化为异步执行，您可以：                                    │    │
│  │     • 留在此页面查看实时进度                                     │    │
│  │     • 关闭弹窗稍后查看（任务不会中断）                            │    │
│  │     • 前往「AI生成 → 临时用例预览」查看历史任务                    │    │
│  │                                                                 │    │
│  │  ████████████████░░░░░░░░  60%                                  │    │
│  │                                                                 │    │
│  │  正在优化第 2/2 批次...  已优化 6/16 条用例                      │    │
│  │                                                                 │    │
│  │  ⏱ 预计剩余时间：约1分钟                                         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  📋 优化完成后                                                   │    │
│  │  结果将出现在「AI生成 → 临时用例预览」中                          │    │
│  │  您可以逐条评审后覆盖合并到正式用例库                             │    │
│  │                                                                 │    │
│  │  [前往评审 →]    [稍后查看]    [关闭]                             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

**状态2：AI优化完成（用户仍在此页面时）**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AI 辅助优化                                                            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ✅ 导入完成                                                     │    │
│  │  成功导入 16 条用例  ·  跳过 1 条  ·  重复 1 条                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ✅ AI 优化完成！                                                │    │
│  │                                                                 │    │
│  │  任务ID：IMP-OPT-20260507-a1b2c3                                │    │
│  │  优化成功：14 条  ·  优化失败：2 条  ·  总计：16 条              │    │
│  │                                                                 │    │
│  │  ██████████████████████████  100%                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  📋 下一步                                                       │    │
│  │  请前往「AI生成 → 临时用例预览」评审AI优化结果                    │    │
│  │  评审通过后可覆盖合并到正式用例库                                 │    │
│  │                                                                 │    │
│  │  [前往评审 →]    [关闭]                                          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

**状态3：AI优化失败**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AI 辅助优化                                                            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ✅ 导入完成                                                     │    │
│  │  成功导入 16 条用例  ·  跳过 1 条  ·  重复 1 条                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ❌ AI 优化失败                                                  │    │
│  │                                                                 │    │
│  │  任务ID：IMP-OPT-20260507-a1b2c3                                │    │
│  │  错误信息：AI模型调用超时                                         │    │
│  │                                                                 │    │
│  │  您可以：                                                       │    │
│  │     • [重新提交优化任务]                                         │    │
│  │     • 已导入的用例不受影响，可正常使用                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

**异步机制说明：**

- 步骤4使用 `setInterval` 每 5 秒轮询 `/api/ai-import/task/:taskId` 获取进度
- 用户关闭导入弹窗后，AI优化任务在后台继续执行（由 TaskScheduler 管理）
- 用户下次打开"AI生成 → 临时用例预览"时，可看到历史导入优化任务的临时用例
- 如果用户在线且AI优化完成，通过 Toast 通知用户

### 8.2 AI生成页面改造

#### 8.2.1 临时用例预览 Tab 改造

在现有的"临时用例预览"Tab 中，新增来源筛选和对比视图：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  📋 临时用例预览                                                        │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 来源：[全部 ▼]  任务：[全部任务 ▼]  状态：[全部 ▼]  🔍搜索...    │   │
│  │                                                                  │   │
│  │  来源选项：全部 | AI生成 | 导入优化                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 📊 统计                                                          │   │
│  │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │   │
│  │ │ 总计   │ │ 待确认 │ │ 已批准 │ │ 已拒绝 │ │ 已合并 │         │   │
│  │ │  28    │ │  12    │ │  10    │ │   3    │ │   3    │         │   │
│  │ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 📁 芯片测试 (28)  [待确认:12 已批准:10 已拒绝:3 已合并:3]         │   │
│  │   📦 模块A (18)                                                   │   │
│  │     📂 功能测试 (10)                                              │   │
│  │       ┌────────────────────────────────────────────────────────┐ │   │
│  │       │ ☐ │ 用例名称        │ 来源   │ 优先级 │ 类型   │ 操作 │ │   │
│  │       │───│────────────────│────────│────────│────────│──────│ │   │
│  │       │ ☐ │ 登录功能验证    │🤖导入优化│ 高   │功能测试│ 👁 ✏️ │ │   │
│  │       │ ☐ │ 权限控制测试    │🤖导入优化│ 中   │功能测试│ 👁 ✏️ │ │   │
│  │       │ ☐ │ 接口响应测试    │✨AI生成 │ 中   │接口测试│ 👁 ✏️ │ │   │
│  │       └────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ [批量批准]  [批量拒绝]  [批量删除]  [覆盖合并到正式库 ⬆️]         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 8.2.2 导入优化对比视图（新增）

点击导入优化来源的用例"查看"按钮时，展示对比视图：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← 返回列表          用例对比视图                                       │
│                                                                         │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  📄 原始用例（导入时）       │  │  🤖 AI 优化后                  │  │
│  │                              │  │                                 │  │
│  │  名称：登录功能验证           │  │  名称：登录功能验证              │  │
│  │  优先级：（空）               │  │  优先级：高 ✨                  │  │
│  │  类型：功能                   │  │  类型：功能测试 ✨              │  │
│  │  前置条件：（空）             │  │  前置条件：系统已部署，✨        │  │
│  │                              │  │  用户账号已创建且处于激活状态    │  │
│  │  测试目的：（空）             │  │  测试目的：验证系统登录✨        │  │
│  │                              │  │  功能的可用性和安全性            │  │
│  │  测试步骤：                   │  │  测试步骤：                     │  │
│  │  1. 输入账号密码              │  │  1. 打开系统登录页面 ✨          │  │
│  │  2. 点击登录                  │  │  2. 输入有效账号和密码           │  │
│  │                              │  │  3. 点击"登录"按钮              │  │
│  │                              │  │  4. 验证登录后页面跳转 ✨        │  │
│  │  预期结果：登录成功           │  │  预期结果：                     │  │
│  │                              │  │  1. 登录成功后跳转至首页 ✨      │  │
│  │                              │  │  2. 页面显示用户名和角色信息 ✨  │  │
│  │  关键配置：（空）             │  │  关键配置：测试环境URL、✨       │  │
│  │                              │  │  测试账号: testuser01           │  │
│  └─────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  📝 AI 优化说明                                                  │    │
│  │  • 补全了优先级为"高"（核心登录功能）                              │    │
│  │  • 将测试类型从"功能"规范化为"功能测试"                            │    │
│  │  • 补全了前置条件、测试目的                                       │    │
│  │  • 完善了测试步骤（从2步扩展到4步）                                │    │
│  │  • 细化了预期结果，使其可验证                                      │    │
│  │  • 补充了关键配置信息                                             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  [❌ 拒绝]        [✏️ 编辑后采纳]        [✅ 采纳并覆盖]          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 8.2.3 覆盖合并确认弹窗

批量覆盖合并时，展示影响范围确认：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚠️ 覆盖合并确认                                                        │
│                                                                         │
│  即将用 AI 优化后的内容覆盖以下正式用例：                                 │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  用例名称          │ 覆盖字段                         │ 影响评估  │   │
│  │────────────────────│──────────────────────────────────│──────────│   │
│  │  登录功能验证       │ 目的,前置条件,步骤,预期,优先级    │ 🟡 中等  │   │
│  │  权限控制测试       │ 类型,优先级                      │ 🟢 轻微  │   │
│  │  接口响应测试       │ 步骤,预期,关键配置               │ 🟡 中等  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  覆盖模式：◉ 智能覆盖（仅覆盖AI修改的字段）                              │
│            ○ 全量覆盖                                                    │
│            ○ 指定字段覆盖                                                │
│                                                                         │
│  ⚠️ 此操作将直接修改正式用例库中的数据，请确认评审无误。                  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    [取消]        [确认覆盖合并]                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.3 CSS 设计规范

#### 8.3.1 新增 CSS 变量

```css
:root {
  --ai-import-primary: #6366f1;
  --ai-import-primary-light: #818cf8;
  --ai-import-primary-bg: #eef2ff;
  --ai-import-success: #10b981;
  --ai-import-warning: #f59e0b;
  --ai-import-danger: #ef4444;
  --ai-import-gradient: linear-gradient(135deg, #6366f1, #8b5cf6);
  --ai-import-source-ai: #8b5cf6;
  --ai-import-source-import: #3b82f6;
}
```

#### 8.3.2 AI辅助开关样式

```css
.ai-optimize-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 20px;
  background: var(--ai-import-primary-bg);
  border: 1px solid var(--ai-import-primary-light);
  cursor: pointer;
  transition: all 0.3s ease;
}

.ai-optimize-toggle.active {
  background: var(--ai-import-gradient);
  color: white;
  border-color: transparent;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
}

.ai-optimize-toggle .toggle-icon {
  font-size: 18px;
  transition: transform 0.3s ease;
}

.ai-optimize-toggle.active .toggle-icon {
  transform: rotate(360deg);
}
```

#### 8.3.3 对比视图样式

```css
.ai-compare-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  padding: 20px;
}

.ai-compare-panel {
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #e5e7eb;
  transition: box-shadow 0.3s ease;
}

.ai-compare-panel:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.ai-compare-panel.original {
  background: #fafafa;
  border-left: 3px solid #9ca3af;
}

.ai-compare-panel.optimized {
  background: #f5f3ff;
  border-left: 3px solid var(--ai-import-primary);
}

.ai-compare-field {
  margin-bottom: 16px;
}

.ai-compare-field .field-label {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ai-compare-field .field-value {
  font-size: 14px;
  line-height: 1.6;
  color: #1f2937;
  padding: 8px 12px;
  border-radius: 6px;
  background: white;
}

.ai-compare-field.changed .field-value {
  background: #fef3c7;
  border: 1px solid #fbbf24;
}

.ai-compare-field .change-marker {
  display: inline-block;
  margin-left: 4px;
  color: var(--ai-import-primary);
  font-size: 12px;
}
```

#### 8.3.4 来源标签样式

```css
.ai-source-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.ai-source-badge.ai-generation {
  background: #f3e8ff;
  color: var(--ai-import-source-ai);
}

.ai-source-badge.import-optimize {
  background: #eff6ff;
  color: var(--ai-import-source-import);
}
```

---

## 九、关键交互流程

### 9.1 用户开启AI辅助导入

```
1. 用户打开导入向导
2. 上传Excel文件 → 解析表头
3. 配置字段映射
4. 进入步骤3"确认导入"
5. 开启"AI辅助优化"开关
   → 展开优化配置区域
   → 选择优化代理（默认：用例导入优化专家）
   → 选择优化字段（默认全选）
   → 选择覆盖模式（默认：智能覆盖）
6. 点击"开始导入 + AI优化"
   → 前端先调用 /api/excel/import/execute 执行常规导入
   → 导入成功后，用返回的 imported_case_ids 调用 /api/ai-import/optimize
   → 进入步骤4展示AI优化进度
7. 轮询 /api/ai-import/task/:taskId 获取进度
8. AI优化完成后：
   → 显示"前往评审"按钮
   → 点击跳转到 AI生成页面 → 临时用例预览 Tab
```

### 9.2 用户评审AI优化结果

```
1. 用户在"临时用例预览"Tab中，筛选来源为"导入优化"
2. 展开树形结构，查看AI优化后的用例
3. 点击"查看"按钮，进入对比视图
4. 逐条评审：
   - 采纳：标记为 approved
   - 编辑后采纳：编辑临时用例内容后标记为 approved
   - 拒绝：标记为 rejected，保留原始用例不变
5. 批量操作：
   - 批量批准选中的临时用例
   - 批量拒绝选中的临时用例
```

### 9.3 用户覆盖合并

```
1. 用户选中已批准的临时用例
2. 点击"覆盖合并到正式库"
3. 弹出确认弹窗，展示影响范围
4. 选择覆盖模式
5. 确认合并
   → 调用 /api/temp-cases/merge-with-overwrite
   → 后端根据 ai_import_case_mapping 找到原始正式用例
   → 按覆盖模式更新 test_cases 表
   → 更新映射状态为 'merged'
6. 显示合并结果
```

---

## 十、安全与权限设计

### 10.1 权限控制

| 操作 | 所需权限 |
|------|---------|
| 创建AI优化任务 | 用例库写权限 |
| 查看优化任务 | 用例库读权限 |
| 取消优化任务 | 任务创建者或管理员 |
| 评审优化结果 | 用例库写权限 |
| 覆盖合并 | 用例库写权限 + 确认弹窗 |

### 10.2 数据安全

| 措施 | 说明 |
|------|------|
| API Key 加密 | 复用现有 aiService 的加密存储机制 |
| XSS 防护 | AI 输出内容使用 `escapeHtml()` 转义后再渲染 |
| SQL 注入防护 | 使用参数化查询（mysql2/promise 的占位符） |
| 敏感数据 | AI 请求中不包含用户密码等敏感信息 |
| 操作审计 | 覆盖合并操作记录到 ai_import_case_mapping |

### 10.3 AI 输出安全

| 措施 | 说明 |
|------|------|
| JSON 解析容错 | 复用 LLMResponseParser 多策略解析 |
| 字段长度校验 | AI 输出字段长度不超过数据库字段定义 |
| 枚举值校验 | priority/type 等枚举字段必须匹配系统字典 |
| 改动幅度校验 | rule.md 中的 Rule 4 限制改动幅度 |

---

## 十一、性能与可靠性设计

### 11.1 并发控制

| 资源 | 并发限制 | 控制方式 |
|------|---------|---------|
| AI优化任务 | 2 | PQueue (optimizeQueue) |
| LLM API 调用 | 4 | PQueue (apiQueue，复用现有) |
| 数据库写入 | 批量 | 事务批量 INSERT |

### 11.2 容错机制

| 场景 | 处理策略 |
|------|---------|
| 单批次 LLM 调用失败 | 重试最多 3 次，指数退避 |
| 单批次重试耗尽 | 标记该批次为 failed，继续处理下一批次 |
| 整个任务超时 | 30 分钟超时，标记任务为 failed |
| 服务重启 | 启动时将 processing 状态重置为 pending，自动恢复 |
| AI 输出格式错误 | LLMResponseParser 多策略解析，仍失败则标记该批次 failed |

### 11.3 进度追踪

```javascript
// 进度计算
progress = Math.floor((processed_batches / total_batches) * 100);
progress_message = `正在优化第 ${processed_batches + 1}/${total_batches} 批次...`;
```

---

## 十二、实现计划

### Phase 1：后端核心（预计 3 天）

| 任务 | 说明 |
|------|------|
| 创建数据库迁移脚本 | 新增 3 张表 + 修改 temp_test_cases |
| 实现 ImportOptimizeService | 切分、执行、回写、合并 |
| 实现 aiImportOptimize 路由 | 5 个 API 端点 |
| 集成 TaskScheduler | 新增 import_optimize 任务轮询 |
| 创建 case_import_optimizer Agent | soul/user/tools/rule/checklist 配置文件 |

### Phase 2：前端改造（预计 3 天）

| 任务 | 说明 |
|------|------|
| 导入向导步骤4 | AI辅助开关、配置区域、进度展示 |
| 导入结果页跳转 | 导入完成后跳转到步骤4 |
| AI生成页面来源筛选 | 新增"导入优化"来源标签和筛选 |
| 对比视图组件 | 原始 vs AI优化 左右对比 |
| 覆盖合并确认弹窗 | 影响范围展示和模式选择 |

### Phase 3：联调与测试（预计 2 天）

| 任务 | 说明 |
|------|------|
| 端到端联调 | 导入 → AI优化 → 评审 → 覆盖合并 |
| 边界场景测试 | 空用例、超长用例、特殊字符、大批量 |
| 性能测试 | 100+ 条用例的切分和并发处理 |
| UI 走查 | 各状态下的 UI 展示和交互 |

---

## 十三、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|---------|
| AI 输出质量不稳定 | 优化后用例仍不规范 | Reflection Pipeline 阶梯式评审 + 人工评审兜底 |
| 大批量用例超时 | 任务执行时间过长 | 切分策略 + 并发控制 + 超时熔断 |
| 覆盖合并误操作 | 正式用例数据丢失 | 确认弹窗 + 操作审计 + 支持字段级覆盖 |
| LLM API 限流 | 批次处理失败 | PQueue 并发控制 + 指数退避重试 |
| 用户不理解双轨流程 | 忽略AI优化结果 | 步骤4进度展示 + 邮件/站内信通知 |

---

## 附录 A：状态机

### A.1 优化任务状态机

```
pending ──→ processing ──→ completed
    │            │              
    │            └──→ failed   
    │                           
    └──→ cancelled              
```

### A.2 用例映射状态机

```
pending ──→ optimized ──→ approved ──→ merged
                              │
                              └──→ rejected
                                  
optimized ──→ merge_failed ──→ merged (重试)
```

### A.3 临时用例状态机（复用现有）

```
pending ──→ approved ──→ merged
    │
    └──→ rejected
```

## 附录 B：消息通知设计

AI 优化任务完成后，通过以下方式通知用户：

| 通知方式 | 触发条件 | 内容 |
|---------|---------|------|
| 站内 Toast | 任务完成时（用户在线） | "AI优化完成：10条用例已优化，请前往评审" |
| 邮件通知 | 任务完成时（用户离线） | 复用现有邮件通知服务 |
| 步骤4页面 | 用户停留在导入向导 | 进度条更新为100%，显示"前往评审"按钮 |

## 附录 C：与统一任务调度系统的关系

本设计中的 `ai_import_optimize_tasks` 表独立于规划中的 `ai_unified_tasks` 统一任务表。当统一任务调度系统实施后，可将本功能迁移至统一任务表，只需：

1. 将 `ai_import_optimize_tasks` 的字段映射到 `ai_unified_tasks`
2. `task_type` 新增枚举值 `import_optimize`
3. `config` 字段存储优化配置
4. 前端切换到统一的 TaskManager

迁移过程向后兼容，不影响现有功能。
