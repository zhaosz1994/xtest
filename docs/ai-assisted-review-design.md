# xTest 多智能体协同与阶梯式反思工作流设计报告

> 版本: v4.5 (最终集成版)
> 日期: 2026/04/28
> 作者: xTest Team
> 架构底座: Node.js + MySQL (100% 离线私有化部署)

---

## 一、架构目标与设计理念

### 1.1 背景

当前 xTest 系统已支持测试用例的人工评审流程（提交评审 → 评审人审批 → 通过/拒绝），但缺少 AI 辅助评审能力。随着 AI 生成用例量的增加，纯人工评审效率成为瓶颈。同时，现有的硬编码 AI 技能库（`ai_skills`）架构扩展性不足，无法满足多样化测试场景的诉求。

本次架构升级旨在将现有的硬编码 AI 技能库，**彻底重构为具备"高度扩展性"、"业务自进化能力"和"复杂流程编排能力"的 AI Agentic Platform（智能体编排底座）**。系统从"单一 AI 工具箱"提升为具备**自我进化能力**和**复杂流程编排能力**的子智能体平台（Sub-Agent Platform），支持多个 Agent 串行协作与阶梯式反思评审。

### 1.2 核心设计理念

| 理念 | 说明 |
|------|------|
| **智能体化 (Agentic)** | 废弃单体技能（Skills），引入具备独立人设、上下文和工具调用能力的 Sub-Agent（子智能体） |
| **阶梯式反思评审 (Reflection Pipeline)** | **【V4.5 核心】** 采用渐进式反思架构，支持多个 Agent 串行协作，每轮评审意见作为前置背景传给下一轮 |
| **动态经验引擎 (Experience Engine)** | 引入 `memory.md` 记忆机制，AI 通过用户修正反馈自动沉淀长期经验 |
| **配置即代码 (Config-Driven)** | 通过 `soul.md`/`user.md`/`tools.md`/`rule.md`/`memory.md` 虚拟化落库，驱动智能体行为 |
| **继承与重写 (Override)** | 支持系统级 Agent 与个人私有 Agent 的分离与无缝重写 |
| **规范化存储** | 主表只存元数据，所有 .md 配置文件统一存入 `ai_sub_agent_config_files` 表 |
| **沙盒安全** | 剥离工具执行环境，引入隔离沙盒（Docker）支持 Python 等脚本语言 |
| **极简技术栈** | 严格依赖 Node.js + MySQL，不引入外部状态中间件 |
| **内网离线优先** | 严禁强依赖外部在线服务，确保 Air-Gapped 环境稳定运行 |

### 1.3 核心概念：从 Skills 升级为 Sub-Agents 体系

| 概念 | 说明 |
|------|------|
| **Skill（技能/工具）** | 没有自主意识的原子能力，对应 `ai_custom_tools` 表中的具体脚本 |
| **Sub-Agent（子智能体）** | 具备完整人设（Soul）、上下文（User）、工具（Tools）、规则（Rule）和记忆（Memory）的"数字员工" |

#### 1.3.1 智能体四要素 (The Quadrinity)

| 要素 | 文件 | 说明 |
|------|------|------|
| **人设层** | `soul.md` | 定义 Agent 的身份、核心原则和行为边界 |
| **输入层** | `user.md` | 定义动态变量模板，用于接收前端传参 |
| **行动层** | `tools.md` | 声明 Agent 可以调用的沙盒工具 |
| **规则层** | `rule.md` **【V4.5 新增】** | 定义阶梯式评审规则链，多轮 rule 按 sort_order 顺序执行 |

此外，还有第五要素——**记忆层** `memory.md`，由系统自动维护，存储在 `ai_sub_agent_memories` 表中。

#### 1.3.2 配置文件类型枚举

| file_type | 说明 | 必填 |
|-----------|------|------|
| `soul` | 人设文件 | 是 |
| `user` | 输入模板 | 是 |
| `tools` | 工具声明 | 是 |
| `rule` | 评审规则 **【V4.5 新增】** | 否 |
| `checklist` | 检查清单 | 否 |
| `examples` | 示例用例 | 否 |
| `glossary` | 术语表 | 否 |
| `template` | 输出模板 | 否 |
| `custom` | 自定义配置 | 否 |

---

## 二、数据模型设计

### 2.1 ER 关系图

```
ai_sub_agents (主表) ──1:N──> ai_sub_agent_config_files (配置文件表)
ai_sub_agents (主表) ──1:N──> ai_sub_agent_memories (记忆主表) ──1:N──> ai_sub_agent_memory_chunks (记忆分块表)
ai_review_tasks (评审任务表) ──1:N──> ai_review_results (评审结果表)
ai_custom_tools (自定义工具表) ──1:N──> ai_tool_versions (工具版本表)
```

### 2.2 ai_sub_agents（子智能体主表）

```sql
CREATE TABLE IF NOT EXISTS `ai_sub_agents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL COMMENT '智能体唯一标识名(如qos_expert)',
  `display_name` varchar(200) NOT NULL COMMENT '显示名称(如QoS测试专家)',
  `description` text COMMENT '智能体描述',
  `avatar` varchar(500) DEFAULT NULL COMMENT '头像URL',
  `category` varchar(50) DEFAULT 'general' COMMENT '分类',
  `agent_type` enum('generator','reviewer','analyzer','assistant') DEFAULT 'assistant' COMMENT '智能体类型',
  `is_enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `is_system` tinyint(1) DEFAULT 0 COMMENT '是否系统内置(不可删除)',
  `is_public` tinyint(1) DEFAULT 1 COMMENT '是否公开(所有用户可见)',
  `owner_id` int DEFAULT NULL COMMENT '所有者ID(私有Agent)',
  `parent_agent_id` int DEFAULT NULL COMMENT '父Agent ID(用于Override继承)',
  `llm_model` varchar(100) DEFAULT NULL COMMENT '指定LLM模型(为空则用系统默认)',
  `llm_temperature` decimal(3,2) DEFAULT 0.7 COMMENT 'LLM温度参数',
  `llm_max_tokens` int DEFAULT 4096 COMMENT 'LLM最大输出Token数',
  `max_retries` int DEFAULT 3 COMMENT '阶梯评审最大重试次数',
  `timeout_seconds` int DEFAULT 300 COMMENT '单次执行超时时间(秒)',
  `sort_order` int DEFAULT 0 COMMENT '排序顺序',
  `version` int DEFAULT 1 COMMENT '版本号',
  `created_by` int DEFAULT NULL COMMENT '创建者ID',
  `updated_by` int DEFAULT NULL COMMENT '更新者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`),
  KEY `idx_category` (`category`),
  KEY `idx_agent_type` (`agent_type`),
  KEY `idx_is_enabled` (`is_enabled`),
  KEY `idx_owner_id` (`owner_id`),
  KEY `idx_parent_agent_id` (`parent_agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子智能体主表';
```

### 2.3 ai_sub_agent_config_files（配置文件表）

```sql
CREATE TABLE IF NOT EXISTS `ai_sub_agent_config_files` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_id` int NOT NULL COMMENT '关联的Sub-Agent ID',
  `file_type` enum('soul','user','tools','rule','checklist','examples','glossary','template','custom') NOT NULL COMMENT '文件类型',
  `file_name` varchar(100) NOT NULL COMMENT '文件名(如Soul.md)',
  `content` longtext COMMENT '文件内容(Markdown/JSON)',
  `description` varchar(500) DEFAULT NULL COMMENT '文件描述',
  `is_required` tinyint(1) DEFAULT 0 COMMENT '是否为必填配置',
  `sort_order` int DEFAULT 0 COMMENT '排序顺序(用于决定规则评审的先后顺序)',
  `version` int DEFAULT 1 COMMENT '版本号',
  `created_by` int DEFAULT NULL COMMENT '创建者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_file_type_sort` (`agent_id`, `file_type`, `sort_order`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_file_type` (`file_type`),
  CONSTRAINT `fk_config_sub_agent` FOREIGN KEY (`agent_id`) REFERENCES `ai_sub_agents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子智能体配置文件表';
```

**设计要点**：
- `sort_order` 字段对 `rule` 类型至关重要：多轮 rule 按 sort_order 升序执行
- 联合唯一键 `uk_agent_file_type_sort` 确保同一 Agent 下同类型文件不重复
- 所有配置文件统一存入此表，消除双写一致性风险

### 2.4 ai_sub_agent_memories（记忆主表）

```sql
CREATE TABLE IF NOT EXISTS `ai_sub_agent_memories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_id` int NOT NULL COMMENT '关联的Sub-Agent ID',
  `scope` enum('global','project','module') DEFAULT 'global' COMMENT '记忆作用域',
  `scope_id` int DEFAULT NULL COMMENT '作用域ID(project_id/module_id)',
  `memory_type` enum('experience','correction','preference','glossary') DEFAULT 'experience' COMMENT '记忆类型',
  `title` varchar(200) DEFAULT NULL COMMENT '记忆标题',
  `content` longtext COMMENT '记忆内容(Markdown)',
  `source` enum('user_correction','auto_distill','manual','system') DEFAULT 'auto_distill' COMMENT '来源',
  `relevance_score` decimal(5,2) DEFAULT 1.00 COMMENT '相关性分数(0-1)',
  `access_count` int DEFAULT 0 COMMENT '被引用次数',
  `last_accessed_at` timestamp NULL DEFAULT NULL COMMENT '最后引用时间',
  `is_active` tinyint(1) DEFAULT 1 COMMENT '是否激活(蒸馏后可归档)',
  `token_count` int DEFAULT 0 COMMENT '预估Token数',
  `version` int DEFAULT 1 COMMENT '版本号',
  `created_by` int DEFAULT NULL COMMENT '创建者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_agent_scope` (`agent_id`, `scope`, `scope_id`),
  KEY `idx_memory_type` (`memory_type`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_relevance` (`relevance_score`),
  CONSTRAINT `fk_memory_sub_agent` FOREIGN KEY (`agent_id`) REFERENCES `ai_sub_agents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子智能体记忆表(动态经验引擎)';
```

### 2.5 ai_sub_agent_memory_chunks（记忆分块表）

```sql
CREATE TABLE IF NOT EXISTS `ai_sub_agent_memory_chunks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `memory_id` int NOT NULL COMMENT '关联的记忆ID',
  `chunk_index` int NOT NULL COMMENT '分块索引',
  `chunk_content` text NOT NULL COMMENT '分块内容',
  `token_count` int DEFAULT 0 COMMENT '预估Token数',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_memory_chunk` (`memory_id`, `chunk_index`),
  KEY `idx_memory_id` (`memory_id`),
  CONSTRAINT `fk_chunk_memory` FOREIGN KEY (`memory_id`) REFERENCES `ai_sub_agent_memories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子智能体记忆分块表';
```

### 2.6 ai_custom_tools（自定义工具表）

```sql
CREATE TABLE IF NOT EXISTS `ai_custom_tools` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL COMMENT '工具唯一标识名',
  `display_name` varchar(200) NOT NULL COMMENT '显示名称',
  `description` text COMMENT '工具描述',
  `tool_type` enum('javascript','python','http_api') DEFAULT 'javascript' COMMENT '工具类型',
  `category` varchar(50) DEFAULT 'general' COMMENT '分类',
  `execute_code` longtext COMMENT '执行代码(JS/Python)',
  `api_endpoint` varchar(500) DEFAULT NULL COMMENT 'HTTP API端点',
  `api_method` enum('GET','POST','PUT','DELETE') DEFAULT 'POST' COMMENT 'API方法',
  `api_headers` json DEFAULT NULL COMMENT 'API请求头',
  `api_body_template` text COMMENT 'API请求体模板',
  `input_schema` json DEFAULT NULL COMMENT '输入参数JSON Schema',
  `output_schema` json DEFAULT NULL COMMENT '输出参数JSON Schema',
  `timeout_seconds` int DEFAULT 30 COMMENT '超时时间(秒)',
  `is_enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `is_system` tinyint(1) DEFAULT 0 COMMENT '是否系统内置',
  `is_public` tinyint(1) DEFAULT 1 COMMENT '是否公开',
  `owner_id` int DEFAULT NULL COMMENT '所有者ID',
  `sandbox_config` json DEFAULT NULL COMMENT '沙盒配置',
  `version` int DEFAULT 1 COMMENT '版本号',
  `created_by` int DEFAULT NULL COMMENT '创建者ID',
  `updated_by` int DEFAULT NULL COMMENT '更新者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`),
  KEY `idx_tool_type` (`tool_type`),
  KEY `idx_category` (`category`),
  KEY `idx_is_enabled` (`is_enabled`),
  KEY `idx_owner_id` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI自定义工具表';
```

### 2.7 ai_tool_versions（工具版本表）

```sql
CREATE TABLE IF NOT EXISTS `ai_tool_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tool_id` int NOT NULL COMMENT '关联的工具ID',
  `version` int NOT NULL COMMENT '版本号',
  `execute_code` longtext COMMENT '该版本的执行代码',
  `change_note` varchar(500) DEFAULT NULL COMMENT '变更说明',
  `created_by` int DEFAULT NULL COMMENT '创建者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tool_version` (`tool_id`, `version`),
  KEY `idx_tool_id` (`tool_id`),
  CONSTRAINT `fk_version_tool` FOREIGN KEY (`tool_id`) REFERENCES `ai_custom_tools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI自定义工具版本表';
```

### 2.8 ai_review_tasks（AI评审任务表）

```sql
CREATE TABLE IF NOT EXISTS `ai_review_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `review_task_id` varchar(50) NOT NULL COMMENT 'AI评审任务唯一标识',
  `source_task_id` varchar(50) DEFAULT NULL COMMENT '来源的AI生成任务ID',
  `submitter_id` int NOT NULL COMMENT '提交评审的用户ID',
  `agent_id` int NOT NULL COMMENT '使用的AI评审Sub-Agent ID',
  `status` enum('pending','running','completed','failed','cancelled','needs_human') DEFAULT 'pending' COMMENT '任务状态',
  `total_cases` int DEFAULT 0 COMMENT '待评审用例总数',
  `reviewed_cases` int DEFAULT 0 COMMENT '已完成评审用例数',
  `approved_cases` int DEFAULT 0 COMMENT 'AI建议通过数',
  `rejected_cases` int DEFAULT 0 COMMENT 'AI建议拒绝数',
  `modified_cases` int DEFAULT 0 COMMENT 'AI建议修改数',
  `needs_human_cases` int DEFAULT 0 COMMENT '熔断需人工介入数',
  `reflection_rounds` int DEFAULT 0 COMMENT '实际执行的反思轮数',
  `error_message` text COMMENT '错误信息',
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_review_task_id` (`review_task_id`),
  KEY `idx_source_task_id` (`source_task_id`),
  KEY `idx_submitter_id` (`submitter_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_status` (`status`),
  KEY `idx_status_updated` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI辅助评审任务表';
```

### 2.9 ai_review_results（AI评审结果表）

```sql
CREATE TABLE IF NOT EXISTS `ai_review_results` (
  `id` int NOT NULL AUTO_INCREMENT,
  `review_task_id` varchar(50) NOT NULL COMMENT '关联的AI评审任务ID',
  `temp_case_id` varchar(50) NOT NULL COMMENT '关联的临时用例ID',
  `agent_id` int NOT NULL COMMENT '执行的Agent ID',
  `result` enum('approved','rejected','modified','needs_human') NOT NULL COMMENT '评审结果',
  `original_content` json DEFAULT NULL COMMENT '原始用例内容(快照)',
  `modified_content` json DEFAULT NULL COMMENT 'AI修改后的用例内容',
  `diff_summary` text COMMENT '系统生成的差异摘要',
  `review_comment` text COMMENT 'AI评审意见',
  `reflection_history` json DEFAULT NULL COMMENT '阶梯评审履历',
  `final_rule_passed` int DEFAULT NULL COMMENT '最终通过的规则轮次',
  `failed_rule` int DEFAULT NULL COMMENT '熔断的规则轮次',
  `confidence_score` decimal(5,2) DEFAULT NULL COMMENT '置信度分数(0-100)',
  `user_decision` enum('pending','accepted','rejected','partially_accepted') DEFAULT 'pending' COMMENT '用户最终决策',
  `user_comment` text COMMENT '用户决策备注',
  `decided_at` timestamp NULL DEFAULT NULL COMMENT '用户决策时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_review_task_id` (`review_task_id`),
  KEY `idx_temp_case_id` (`temp_case_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_result` (`result`),
  KEY `idx_user_decision` (`user_decision`),
  CONSTRAINT `fk_result_review_task` FOREIGN KEY (`review_task_id`) REFERENCES `ai_review_tasks` (`review_task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI辅助评审结果表';
```

---

## 三、动态 Prompt 组装管线

### 3.1 组装流程

1. **加载配置** - 从 config_files 表加载 soul.md、user.md、tools.md
2. **注入记忆** - 从 memories 表动态组装 Memory Context
3. **渲染上下文** - 替换 user.md 中的 {{变量}} 为实际值
4. **挂载工具** - 从 tools.md 解析工具声明，挂载到 tools 参数
5. **LLM 推理** - 组装最终 Prompt 调用 LLM

### 3.2 组装伪代码

```javascript
async function assemblePrompt(agentId, userInputs, scopeContext) {
  const configs = await loadConfigFiles(agentId);
  const soulContent = configs.find(c => c.file_type === 'soul')?.content || '';
  const userTemplate = configs.find(c => c.file_type === 'user')?.content || '';
  const toolsContent = configs.find(c => c.file_type === 'tools')?.content || '';
  const memoryContext = await memoryEngine.assembleMemoryContext(agentId, scopeContext, { maxTokens: 2000 });
  let renderedUser = userTemplate;
  for (const [key, value] of Object.entries(userInputs)) {
    renderedUser = renderedUser.replace(new RegExp(`\{\{${key}\}\}`, 'g'), value);
  }
  const tools = await parseAndMountTools(toolsContent);
  return { system: soulContent + '\n\n## 经验记忆\n' + memoryContext, user: renderedUser, tools };
}
```

---

## 四、动态经验引擎 (Memory Engine)

### 4.1 记忆生命周期

用户修正反馈 -> Distiller Agent -> 经验蒸馏 -> 写入 memories 表 -> 定期压缩/归档 -> 下次执行时 Memory Context 注入

### 4.2 记忆组装策略

- 按优先级查询记忆: 模块级 > 项目级 > 全局级
- 按 relevance_score * access_count 加权排序
- 贪心装填，不超过 maxTokens 限制

### 4.3 Distiller Agent（异步经验蒸馏）

1. **用户修正蒸馏**：当用户对 AI 评审结果做出修改时，自动提取修正经验
2. **定期压缩**：当某 Agent 的记忆总量超过阈值时，自动合并相似条目
3. **归档管理**：将过时或低相关性的记忆标记为 `is_active = 0`

---

## 五、阶梯式反思评审管线 (Reflection Pipeline) **【V4.5 核心】**

### 5.1 架构概述

阶梯式反思评审采用渐进式反思架构：

Rule #1 (格式规范) -> Rule #2 (深度规则) -> Rule #3 (业务逻辑) -> ... -> Rule #N (质量门禁)

每轮规则：通过则进入下一轮，不通过则修正（携带前序履历），超过最大重试次数则熔断(needs_human)。

### 5.2 核心执行逻辑

```javascript
async function executeReflectionPipeline(agentId, draft, rules, context) {
  let currentDraft = draft;
  let reviewHistory = [];
  for (const rule of rules) {
    let retries = 0;
    const MAX_RETRIES = context.maxRetries || 3;
    let passed = false;
    while (!passed && retries < MAX_RETRIES) {
      const result = await callLLM({
        system: rule.content,
        user: '## 当前草稿\n' + JSON.stringify(currentDraft) + '\n\n## 前序评审履历\n' + reviewHistory.join('\n'),
        response_format: { type: 'json_object' }
      });
      if (result.passed) {
        passed = true;
        currentDraft = result.revised_draft || currentDraft;
        reviewHistory.push('[规则' + rule.sort_order + '] 通过: ' + result.summary);
      } else {
        currentDraft = result.revised_draft || currentDraft;
        retries++;
        reviewHistory.push('[规则' + rule.sort_order + '] 第' + retries + '次修正: ' + result.summary);
      }
    }
    if (!passed) {
      return { status: 'needs_human', rule: rule.sort_order, draft: currentDraft, history: reviewHistory };
    }
  }
  return { status: 'passed', draft: currentDraft, history: reviewHistory };
}
```

### 5.3 Anti-Oscillation（防震荡机制）

每轮评审时，将前序评审履历（reviewHistory）作为上下文传递给当前规则，使 LLM 了解之前的修正方向，避免方向性冲突。

### 5.4 Rule.md 配置示例

**第一轮评审：格式与规范**
- 检查维度：必填字段、格式规范、命名规范、优先级
- 判定标准：4项全部满足->通过，1项不满足->修正后通过

**第二轮评审：深度规则**
- 检查维度：逻辑覆盖、边界值、性能风险、数据流、依赖关系
- 判定标准：5项全部满足->通过，1项不满足->修正后通过，2项及以上->需重写

**第三轮评审：业务逻辑**
- 检查维度：业务正确性、预期合理性、风险识别、完整性
- 判定标准：4项全部满足->通过，1项不满足->修正后通过，2项及以上->需重写

### 5.5 熔断与人工介入

当某条规则连续重试 max_retries 次仍不通过时：
1. 任务状态变为 needs_human
2. 评审结果中 failed_rule 记录熔断的规则轮次
3. reflection_history 保留完整的评审履历
4. 前端展示熔断原因和完整履历，供人工参考决策

---

## 六、Override 引擎（继承与重写）

### 6.1 两级路由策略

查找用户私有 Agent (owner_id = 当前用户) -> 找到则使用私有配置 -> 未找到则使用系统公开 Agent

### 6.2 配置文件级 Override

支持用户在系统 Agent 基础上创建私有覆盖，修改特定配置文件而不影响系统默认配置。

---

## 七、系统生成 Diff（避免 LLM 幻觉）

绝不依赖 LLM 生成差异摘要。使用 `diff` npm 包进行结构化对比，逐字段比较原始内容和修改后内容，客观生成差异摘要。

---

## 八、前端 UI 设计

### 8.1 UI 入口与导航结构

- **AI生成** (现有)
  - 创建生成任务 (现有)
  - 临时用例预览 (现有)
  - 评审管理 (现有->增强)
    - 人工评审 (现有)
    - AI辅助评审 (新增)
- **AI配置中心** (新增)
  - 智能体管理 (Sub-Agents)
  - 工具管理 (Custom Tools)
  - 记忆管理 (Memories)

### 8.2 AI辅助评审页面

- 统计卡片：通过数/拒绝数/建议修改数/待决策数
- 筛选栏：评审结果/用户决策/评审Agent
- 批量操作栏：全选/批量接受/批量拒绝/批量合并到正式库
- 评审结果表格：用例名称/评审结果/置信度/反思轮数/用户决策/操作

### 8.3 评审结果详情弹窗

- 基本信息：用例名称、评审Agent、评审结果、置信度
- 阶梯评审履历：每轮规则的通过/修正记录
- Diff 对比视图：原始 vs AI修改后
- 用户决策：接受AI修改/拒绝/部分接受

### 8.4 AI配置中心 - 智能体管理

- 智能体卡片网格：显示类型/规则数/记忆数/状态
- 配置文件编辑器：Tab 切换 Soul/User/Tools/Rule.md
- 规则链管理：拖拽排序、添加/编辑/删除规则

### 8.5 提交评审时的 AI 辅助选项

在现有提交评审弹窗中增加：
- 启用 AI 辅助评审复选框
- 评审 Agent 下拉选择
- AI 评审结果说明

### 8.6 前端路由设计

| 路由路径 | 页面 | 说明 |
|----------|------|------|
| `/#/ai-generation/review` | 评审管理 | 现有页面增强 |
| `/#/ai-generation/review/ai` | AI辅助评审 | 新增 |
| `/#/ai-config` | AI配置中心 | 新增顶级路由 |
| `/#/ai-config/agents` | 智能体管理 | 新增 |
| `/#/ai-config/agents/:id` | 智能体编辑 | 新增 |
| `/#/ai-config/tools` | 工具管理 | 新增 |
| `/#/ai-config/memories` | 记忆管理 | 新增 |

---

## 九、API 设计

### 9.1 Sub-Agent 管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai-sub-agents/list` | 获取智能体列表 |
| GET | `/api/ai-sub-agents/detail/:id` | 获取智能体详情（含配置文件） |
| POST | `/api/ai-sub-agents/create` | 创建智能体 |
| PUT | `/api/ai-sub-agents/update/:id` | 更新智能体元数据 |
| DELETE | `/api/ai-sub-agents/:id` | 删除智能体 |
| POST | `/api/ai-sub-agents/:id/override` | 创建私有覆盖 |
| POST | `/api/ai-sub-agents/:id/toggle` | 启用/禁用智能体 |

### 9.2 配置文件管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai-sub-agents/:agentId/config-files` | 获取所有配置文件 |
| GET | `/api/ai-sub-agents/:agentId/config-files/:fileId` | 获取单个配置文件 |
| POST | `/api/ai-sub-agents/:agentId/config-files` | 创建配置文件 |
| PUT | `/api/ai-sub-agents/:agentId/config-files/:fileId` | 更新配置文件 |
| DELETE | `/api/ai-sub-agents/:agentId/config-files/:fileId` | 删除配置文件 |
| PUT | `/api/ai-sub-agents/:agentId/config-files/reorder` | 重排规则顺序 |

### 9.3 自定义工具管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai-tools/list` | 获取工具列表 |
| GET | `/api/ai-tools/detail/:id` | 获取工具详情 |
| POST | `/api/ai-tools/create` | 创建工具 |
| PUT | `/api/ai-tools/update/:id` | 更新工具 |
| DELETE | `/api/ai-tools/:id` | 删除工具 |
| POST | `/api/ai-tools/:id/test` | 测试工具执行 |
| GET | `/api/ai-tools/:id/versions` | 获取工具版本历史 |

### 9.4 记忆管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ai-memories/list` | 获取记忆列表 |
| GET | `/api/ai-memories/detail/:id` | 获取记忆详情 |
| POST | `/api/ai-memories/create` | 手动添加记忆 |
| PUT | `/api/ai-memories/update/:id` | 更新记忆 |
| DELETE | `/api/ai-memories/:id` | 删除记忆 |
| POST | `/api/ai-memories/distill` | 手动触发经验蒸馏 |
| GET | `/api/ai-memories/stats` | 获取记忆统计信息 |

### 9.5 AI 评审 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai-review/create` | 创建 AI 评审任务 |
| GET | `/api/ai-review/task/:taskId` | 获取评审任务状态 |
| GET | `/api/ai-review/tasks` | 获取评审任务列表 |
| POST | `/api/ai-review/cancel/:taskId` | 取消评审任务 |
| GET | `/api/ai-review/results/:taskId` | 获取评审结果列表 |
| GET | `/api/ai-review/result/:resultId` | 获取单条评审结果详情 |
| POST | `/api/ai-review/decide` | 用户决策 |
| POST | `/api/ai-review/batch-decide` | 批量用户决策 |
| POST | `/api/ai-review/merge` | 合并到正式用例库 |
| POST | `/api/ai-review/batch-merge` | 批量合并到正式用例库 |

---

## 十、可靠性与防御性设计

### 10.1 孤儿任务防护

- 启动自检：重置超时的运行中任务（updated_at < 30分钟前）
- 心跳机制：每60秒更新任务状态

### 10.2 LLM 输出严格性保障

1. API 层约束：使用 response_format: { type: 'json_object' } 强制 JSON 输出
2. 逐条评审：每次只评审一条用例
3. 并发控制：同时最多 3 个 LLM 请求
4. 多层 JSON 解析：直接解析 -> 提取代码块 -> 提取花括号对

### 10.3 沙盒执行安全

- JavaScript 沙盒：vm 模块 + 危险模式检测
- Python 沙盒：Docker 容器隔离（network_mode: none, read_only: true）

---

## 十一、邮件通知设计

| 事件 | 收件人 | 邮件内容 |
|------|--------|----------|
| AI评审完成 | 提交人 + 评审人 | AI评审结果摘要 |
| AI评审熔断 | 提交人 + 评审人 | 熔断原因和完整评审履历 |
| 用户决策完成 | 提交人 | 最终决策结果 |

---

## 十二、数据库迁移脚本

创建文件 `migrations/add_ai_sub_agent_platform.sql`，包含：
1. ai_sub_agents 主表
2. ai_sub_agent_config_files 配置文件表
3. ai_sub_agent_memories 记忆主表
4. ai_sub_agent_memory_chunks 记忆分块表
5. ai_custom_tools 自定义工具表
6. ai_tool_versions 工具版本表
7. ai_review_tasks 评审任务表
8. ai_review_results 评审结果表
9. 内置评审 Agent 数据（默认评审专家、QoS评审专家）
10. 默认配置文件数据（Soul.md、User.md、3条Rule.md）

---

## 十三、实施计划

### Phase 1: 核心基础（数据库 + 执行引擎）
- 数据库迁移
- Sub-Agent CRUD 服务
- 配置文件 CRUD 服务
- Prompt 组装管线
- LLM 解析器 + Diff 生成器
- 路由注册 + 孤儿任务自检

### Phase 2: 阶梯式反思评审
- 反思管线引擎
- 评审任务调度
- 评审结果服务
- 邮件通知集成

### Phase 3: 动态经验引擎
- 记忆组装引擎
- Distiller Agent
- 记忆压缩与归档

### Phase 4: 前端 UI
- AI辅助评审页面
- AI配置中心
- 工具管理页面
- 记忆管理页面
- 提交评审增强

### Phase 5: 测试与优化
- 单元测试 + 集成测试
- 性能优化
- 安全审计

---

## 附录 A：与现有系统的兼容性

### ai_skills 表迁移策略

1. Phase 1：创建新表
2. Phase 2：迁移数据（definition.prompts.system -> soul.md, definition.prompts.userTemplate -> user.md, execute_code -> ai_custom_tools）
3. Phase 3：前端切换到新 API，旧 API 标记为 deprecated
4. Phase 4：确认无问题后，ai_skills 表标记为废弃

### 现有路由兼容

| 现有路由 | 新路由 | 兼容策略 |
|----------|--------|----------|
| `/api/ai-skills/*` | `/api/ai-sub-agents/*` | 保留旧路由，内部转发 |
| `/api/ai-generation/skills` | `/api/ai-sub-agents/list?category=test_generation` | 保留旧路由，映射到新查询 |

---

## 附录 B：配置文件模板

### Soul.md 模板
定义 Agent 身份、核心原则、行为边界、输出规范

### User.md 模板
定义输入数据、执行要求、输出格式

### Tools.md 模板
定义可用工具列表、调用方式、参数说明

### Rule.md 模板
定义检查维度、判定标准、输出格式

---

## 附录 C：关键依赖

| 依赖 | 版本 | 用途 | 离线部署 |
|------|------|------|----------|
| `diff` | ^5.x | 结构化文本对比 | 是 |
| `vm` | Node.js 内置 | JavaScript 沙盒 | 是 |
| `dockerode` | ^4.x | Docker 容器管理 | 需本地 Docker |
| `nodemailer` | ^6.x | 邮件发送 | 是 |

---

> **文档结束**
> 本设计报告总结了从"多智能体串行协作"到"阶梯式反思评审"的完整架构演进，将 xTest 系统从一个单一的 AI 工具箱提升为一个具备**自我进化能力**和**复杂流程编排能力**的子智能体平台（Sub-Agent Platform）。
