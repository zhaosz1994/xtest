# xTest AI 子智能体架构升级设计文档

> 版本: v4.0  
> 日期: 2026/04/28  
> 作者: xTest Team

---

## 一、架构目标与设计理念

### 1.1 背景

当前 xTest 系统已支持测试用例的人工评审流程（提交评审 → 评审人审批 → 通过/拒绝），但缺少 AI 辅助评审能力。随着 AI 生成用例量的增加，纯人工评审效率成为瓶颈。同时，现有的硬编码 AI 技能库（`ai_skills`）架构扩展性不足，无法满足多样化测试场景的诉求。

本次架构升级旨在将现有的硬编码 AI 技能库，**彻底重构为具备"高度扩展性"和"业务自进化能力"的 AI Agentic Platform（智能体编排底座）**。

### 1.2 核心设计理念

| 理念 | 说明 |
|------|------|
| **智能体化 (Agentic)** | 废弃单体技能（Skills），引入具备独立人设、上下文和工具调用能力的 Sub-Agent（子智能体） |
| **动态经验引擎 (Experience Engine)** | **【本期核心】** 引入 `memory.md` 记忆机制。AI 不仅能执行任务，还能通过用户的修正反馈，在"模块/项目"维度自动沉淀长期经验，实现越用越聪明，打破大模型的"遗忘诅咒" |
| **配置即代码 (Config-Driven)** | 通过 `soul.md`(人设)、`user.md`(上下文)、`tools.md`(动作) 和 `memory.md`(记忆) 虚拟化落库，驱动智能体行为 |
| **继承与重写 (Override)** | 支持系统级 Agent 与个人私有 Agent 的分离与无缝重写 |
| **规范化存储** | 主表只存元数据（名称、描述、开关状态等），所有 .md 配置文件统一作为行记录存入 `ai_sub_agent_config_files` 表，消除双写一致性风险 |
| **沙盒安全** | 剥离工具执行环境，引入隔离沙盒（Docker）支持执行用户自定义的 Python 等脚本语言 |
| **极简技术栈** | 严格依赖 Node.js (应用逻辑) + MySQL (持久化与配置状态)，不引入外部状态中间件，降低内部部署的运维复杂度 |
| **🚨 内网离线优先 (100% 本地化)** | 严禁强依赖任何外部在线服务或公网 CDN。若系统或自定义脚本需要引入外部依赖库，必须支持完全的本地化私有部署，确保在无外网（Air-Gapped）环境下系统仍能稳定运行 |

### 1.3 核心概念：从 Skills 升级为 Sub-Agents 体系

在多智能体（MAS）架构中：

| 概念 | 说明 |
|------|------|
| **Skill（技能/工具）** | 没有自主意识的原子能力，比如"查数据库"、"测网速"、"计算覆盖率"，对应 `ai_custom_tools` 表中的具体脚本 |
| **Sub-Agent（子智能体）** | 具备完整人设（Soul）、特定上下文（User）、可用工具（Tools）和持久记忆（Memory）的"数字员工" |

**更名映射**：

| 旧概念 | 新概念 | 说明 |
|--------|--------|------|
| `ai_skills` | `ai_sub_agents` | 主表更名，语义更准确 |
| `ai_skill_config_files` | `ai_sub_agent_config_files` | 配置文件表更名 |
| Skill 配置中心 | 智能体编排台 | UI 更名 |
| Soul.md / User.md / Tools.md | 不变 | 配置文件类型不变 |
| — | **Memory.md（新增）** | 动态经验记忆，碎片化存储于 `ai_sub_agent_memories` 表 |

通过这种重构，系统后台就像是一家"数字员工人力资源部"，`ai_sub_agents` 就是员工花名册，你可以派他们去后台做苦力（异步批量评审测试用例），也可以把他们拉到前台做客服（AI 知识问答交互）。而 `memory.md` 让这些数字员工拥有了"业务经验"，每一次人工修正都让他们在下一次评审中更加精准。

### 1.4 参考：OpenClaw Skills 架构

OpenClaw v2026.3.24 引入了原生 Skills 系统，核心设计如下：

| 概念 | 说明 |
|------|------|
| **SOUL.md** | 定义 Agent 的"人格灵魂"——核心原则、行为边界、身份认同 |
| **SKILL.md** | 定义具体技能——触发条件、执行步骤、输出格式、升级规则 |
| **Tools** | Agent 可调用的工具集——Python/JS 类，有 name/description/schema |
| **References** | 技能的参考文档——checklist.md、examples.md、glossary.md 等 |

**借鉴要点**：
- SOUL.md 定义"AI 是谁"（评审原则、专业领域、行为边界）
- User.md 定义"用户偏好"（评审关注点、风格偏好、历史评审习惯）
- Tools.md 定义"可用工具"（查重、规范检查、覆盖率分析等）
- Memory.md 定义"业务记忆"（模块级踩坑记录、团队评审共识、全局规范沉淀）
- 支持 References 扩展（checklist、examples 等辅助文档）
- 继承 OpenClaw 的 Override 机制，实现系统级/私有级的两级配置

---

## 二、系统架构设计

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          前端 (index.html + ai-generation.js)            │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 顶部导航栏                                                          │  │
│  │ [AI问答] [AI生成(紫色渐变)] [社区] [⌘K] [🌙] [🔔] [用户]          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────────────────┐     │
│  │ 生成任务  │  │ 临时用例  │  │ 评审管理                           │     │
│  │   Tab    │  │  预览Tab  │  │ ┌────────┐ ┌──────────────────┐  │     │
│  │          │  │          │  │ │人工评审 │ │AI辅助评审(新增)   │  │     │
│  │          │  │          │  │ └────────┘ └──────────────────┘  │     │
│  └──────────┘  └──────────┘  └───────────────────────────────────┘     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 配置中心 (#/settings)                                               │  │
│  │ ┌────────────────────┐  ┌────────────────┐  ┌──────────────────┐ │  │
│  │ │ 智能体编排台         │  │ 自定义工具工坊  │  │ 记忆管理台       │ │  │
│  │ │ (Sub-Agent          │  │ (Custom Tool   │  │ (Memory Center)  │ │  │
│  │ │  Orchestrator)      │  │  Workshop)     │  │  【新增】        │ │  │
│  │ └────────────────────┘  └────────────────┘  └──────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ AI 知识问答 (顶部导航栏按钮 → 模态框)                               │  │
│  │ ┌──────────────────────────────────────────────────────────────┐  │  │
│  │ │ 下拉选择 Sub-Agent → 输入问题 → AI 回答(注入Memory上下文)    │  │  │
│  │ └──────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│                          后端路由层                                        │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────────────┐ │
│  │ tempCases.js │  │aiSubAgents.js  │  │ aiReview.js(新增)            │ │
│  │ (现有)       │  │ (升级重构)      │  │                              │ │
│  └──────────────┘  └────────────────┘  └──────────────────────────────┘ │
│  ┌──────────────┐  ┌────────────────────────────────────────────────┐   │
│  │ aiTools.js   │  │ aiSubAgentConfigFiles.js (配置文件CRUD)         │   │
│  │ (新增)       │  │ (新增)                                         │   │
│  └──────────────┘  └────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌────────────────────────────────────────────────┐   │
│  │ aiQA.js      │  │ aiMemories.js (记忆管理路由, 新增)              │   │
│  │ (新增)       │  │ (新增)                                         │   │
│  └──────────────┘  └────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────┤
│                          服务层                                            │
│  ┌──────────────────┐  ┌────────────────────────────────────────────┐  │
│  │ reviewService.js │  │ aiReviewService.js (新增)                   │  │
│  │ (现有)           │  │ - AI评审调度 / 孤儿任务自检与心跳           │  │
│  └──────────────────┘  └────────────────────────────────────────────┘  │
│  ┌──────────────────────┐  ┌────────────────────────────────────────┐  │
│  │ aiService.js (现有)  │  │ agentExecutionEngine.js (新增)          │  │
│  └──────────────────────┘  └────────────────────────────────────────┘  │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐   │
│  │ emailNotificationService │  │ sandboxExecutor.js (新增)         │   │
│  └──────────────────────────┘  └──────────────────────────────────┘   │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐   │
│  │ diffGenerator.js (新增)  │  │ llmResponseParser.js (新增)       │   │
│  └──────────────────────────┘  └──────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ memoryEngine.js (新增) — JIT拼装 + Distiller经验提炼             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│                          数据库层 (MySQL)                                  │
│  ┌────────────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ ai_sub_agents  │  │ai_custom_tools│ │ai_sub_agent_config_       │  │
│  │ (核心重构)     │  │ (新增)       │  │files (新增)               │  │
│  └────────────────┘  └──────────────┘  └────────────────────────────┘  │
│  ┌──────────────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ai_sub_agent_memories │  │ai_review_tasks│ │ai_review_results     │  │
│  │ (新增-核心)          │  │ (新增)       │  │ (新增)               │  │
│  └──────────────────────┘  └──────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 AI 辅助评审流程（含 Memory 注入）

```
用户提交评审 ──────────────────────────────────────────────────
     │
     ├── 选择评审人（人工）
     │
     ├── ☑ 启用AI辅助评审 ────── 选择AI评审Sub-Agent
     │         │
     │         ▼
     │   创建AI评审任务(ai_review_tasks)
     │         │
     │         ▼
     │   Override Engine: 加载Sub-Agent配置
     │   (优先私有重写 → 降级系统默认)
     │         │
     │         ▼
     │   从 ai_sub_agent_config_files 加载配置:
     │   soul → System Prompt
     │   user + 变量插值 → User Prompt
     │   tools → Function Calling JSON
     │         │
     │         ▼
     │   【V4.0新增】Memory JIT拼装引擎:
     │   根据当前模块(library_id/module_id)
     │   从 ai_sub_agent_memories 提取:
     │   全局记忆 → 库级记忆 → 模块级记忆
     │   作为 <Memory_Context> 注入 System Prompt
     │         │
     │         ▼
     │   调用LLM(response_format=json_object)
     │   ── LLM决议调用工具?
     │         │              │
     │         │         ┌────┴────┐
     │         │         │ 是      │ 否
     │         │         ▼         │
     │         │   沙盒执行引擎    │
     │         │   (JS沙箱/Docker) │
     │         │         │         │
     │         │         ▼         │
     │         │   工具结果回传    │
     │         │   LLM继续推理     │
     │         │         │         │
     │         └────┬────┘         │
     │              ▼              │
     │   逐条解析评审结果(JSON容错)
     │         │
     │         ▼
     │   系统生成Diff摘要(非LLM生成)
     │   diffGenerator: original vs suggested
     │         │
     │         ▼
     │   写入ai_review_results + 更新temp_test_cases
     │         │
     │         ▼
     │   发送邮件通知(评审人 + 提交人)
     │
     ▼
评审管理页面展示 ──────────────────────────────────────────────
     │
     ├── 人工评审结果
     │
     ├── AI辅助评审结果（新增标签页/区域）
     │     ├── 查看AI修改建议（对比：原内容 vs AI建议）
     │     ├── 单条操作：采纳修改 / 拒绝 / 编辑后采纳
     │     └── 批量操作：批量采纳 / 批量拒绝 / 批量合并
     │
     └── 【V4.0新增】用户修正采纳时：
           └── Distiller Agent 异步提炼修正差异
               └── 沉淀经验到 ai_sub_agent_memories
                   └── 下次同模块评审自动更精准
```

---

## 三、核心领域模型设计

平台数据模型分为三大核心实体：**Sub-Agent 配置 (ai_sub_agents)**、**原子工具 (ai_custom_tools)** 与 **动态经验记忆 (ai_sub_agent_memories)**，辅以 **配置文件 (ai_sub_agent_config_files)** 和 **评审相关表**。

> **设计原则**：主表 `ai_sub_agents` 只存储元数据（名称、描述、开关状态等），所有 .md 配置文件（Soul.md、User.md、Tools.md、checklist.md 等）统一作为行记录存入 `ai_sub_agent_config_files` 表，彻底消除双写一致性风险。动态记忆则独立存入 `ai_sub_agent_memories` 表，采用"碎片化落库"设计，解决单一文件过大导致的 Token 溢出问题。

### 3.1 子智能体配置模型 (ai_sub_agents)

该模型定义了 Sub-Agent 的元数据与行为边界，由现有 `ai_skills` 表升级重构而来。为了支持"后台固定任务调用"与"前台 AI 知识问答选择"双重场景，表中明确区分系统编码和中文展示名，并增加场景控制开关。

#### 3.1.1 `ai_sub_agents` 表 DDL

```sql
CREATE TABLE IF NOT EXISTS `ai_sub_agents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_code` varchar(50) NOT NULL COMMENT '系统唯一标识符(如 review_test_cases)，供代码硬编码调用',
  `display_name` varchar(100) NOT NULL COMMENT '中文名称(如 "测试用例评审专家")，用于前端UI和知识问答下拉展示',
  `description` varchar(255) COMMENT '智能体能力简述',
  `category` varchar(50) COMMENT '分类：如 test_generation, test_review, qa_assistant',

  -- 场景与权限控制
  `is_system` tinyint(1) DEFAULT 0 COMMENT '是否为系统内置标准Agent',
  `allow_qa` tinyint(1) DEFAULT 1 COMMENT '是否允许在"AI知识问答"功能中被用户下拉选择',
  `is_enabled` tinyint(1) DEFAULT 1 COMMENT '启用状态',

  -- 重写与路由机制字段
  `creator_id` int DEFAULT NULL COMMENT '创建者(私有Agent专属)',
  `visibility` enum('public','private') DEFAULT 'public' COMMENT '可见性: public-全局公开, private-仅创建者',

  -- 记忆控制
  `memory_enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用动态经验记忆',
  `memory_distill_threshold` int DEFAULT 2000 COMMENT '记忆内容超过此字符数时触发提炼(默认2000)',

  -- 审计字段
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_code_creator` (`agent_code`, `creator_id`),
  KEY `idx_category` (`category`),
  KEY `idx_allow_qa` (`allow_qa`),
  KEY `idx_is_system` (`is_system`),
  KEY `idx_creator_id` (`creator_id`),
  KEY `idx_enabled` (`is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI 子智能体配置表';
```

**字段设计说明**：

| 字段 | 设计意图 |
|------|---------|
| `agent_code` | 系统唯一标识符，如 `review_test_cases`、`generate_test_cases`，供代码硬编码调用，用于 Override Engine 路由匹配 |
| `display_name` | 中文名称，如"测试用例评审专家"，用于前端 UI 展示和 AI 知识问答下拉选择 |
| `category` | 分类标识：`test_generation`（用例生成）、`test_review`（用例评审）、`qa_assistant`（问答助手）等 |
| `is_system` | 标识是否为系统出厂配置。系统级不可被非管理员直接覆盖，只能重写 |
| `allow_qa` | 是否允许在"AI 知识问答"功能中被用户下拉选择 |
| `visibility` | `public` = 全局公开，`private` = 仅创建者可见（私有重写记录） |
| `creator_id` | 创建者标识。系统级记录为 NULL，私有重写记录为具体用户 ID |
| `memory_enabled` | 是否启用动态经验记忆。关闭后该 Agent 不会读取/写入 ai_sub_agent_memories |
| `memory_distill_threshold` | 记忆提炼阈值。当某模块的记忆内容字符数超过此值时，触发 Distiller Agent 提炼 |

**UNIQUE KEY `uk_agent_code_creator`**：同一 `agent_code` + 同一 `creator_id` 只能有一条记录，确保私有重写的唯一性。系统级记录的 `creator_id` 为 NULL。

> **与 V3.0 的关键区别**：新增 `memory_enabled` 和 `memory_distill_threshold` 字段，支持动态经验记忆的细粒度控制。

#### 3.1.2 重写与路由机制

```
┌─────────────────────────────────────────────────────────────┐
│                    Override Engine 路由策略                    │
│                                                               │
│  应用层发起调用: agent_code = "review_test_cases", user_id = 5 │
│                                                               │
│  Step 1: 查询私有重写                                         │
│  SELECT * FROM ai_sub_agents                                 │
│  WHERE agent_code = 'review_test_cases'                      │
│    AND creator_id = 5                                        │
│    AND is_system = 0                                         │
│                                                               │
│  ┌─ 找到 → 使用私有重写配置(用户的微调版本)                   │
│  │                                                            │
│  └─ 未找到 → Step 2: 降级查询系统默认                         │
│                                                               │
│  Step 2: 查询系统默认                                         │
│  SELECT * FROM ai_sub_agents                                 │
│  WHERE agent_code = 'review_test_cases'                      │
│    AND is_system = 1                                         │
│                                                               │
│  ┌─ 找到 → 使用系统默认配置                                   │
│  │                                                            │
│  └─ 未找到 → 返回错误(Sub-Agent不存在)                        │
│                                                               │
│  Step 3: 加载配置文件(无论命中哪条记录)                        │
│  SELECT * FROM ai_sub_agent_config_files                     │
│  WHERE agent_id = ?                                          │
│  → 在内存中根据 file_type 组装 soul/user/tools 等             │
│                                                               │
│  Step 4: 加载动态记忆(仅当 memory_enabled=1)                  │
│  SELECT content FROM ai_sub_agent_memories                   │
│  WHERE agent_id = ?                                          │
│    AND (library_id IS NULL OR library_id = ?)                │
│    AND (module_id IS NULL OR module_id = ?)                  │
│  ORDER BY level ASC                                          │
│  → 拼装为 <Memory_Context> 注入 System Prompt                │
└─────────────────────────────────────────────────────────────┘
```

**透明修改逻辑**：

| 操作 | 非管理员 | 管理员 |
|------|---------|--------|
| 修改系统Sub-Agent并保存 | 后端拦截，INSERT 创建该用户的私有重写记录（`is_system=0, visibility=private`） | 可选择更新系统默认（`is_system=1, visibility=public`），也可创建私有 |
| 恢复默认 | DELETE 移除该用户的私有重写记录，自动降级到系统默认 | 无此操作（管理员直接修改系统默认） |
| 查看Sub-Agent | 优先展示私有重写版本，标注"已自定义"标签 | 展示系统默认版本 |

### 3.2 原子工具模型 (ai_custom_tools)

该模型管理所有可被 Sub-Agent 调用的具体能力脚本。

#### 3.2.1 `ai_custom_tools` 表 DDL

```sql
CREATE TABLE IF NOT EXISTS `ai_custom_tools` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tool_name` varchar(100) NOT NULL COMMENT '英文标识, 供LLM调用, 如 spec_checker',
  `display_name` varchar(200) DEFAULT NULL COMMENT 'UI展示名, 如 规范检查器',
  `description` text COMMENT '给LLM查阅的工具用途说明',
  `input_schema` json DEFAULT NULL COMMENT 'JSON Schema格式, 定义入参结构',

  -- 执行定义
  `language` enum('javascript','python') DEFAULT 'javascript' COMMENT '执行语言枚举',
  `code_content` longtext COMMENT '脚本源码实体',

  -- 权限与状态
  `is_public` tinyint(1) DEFAULT '1' COMMENT '是否允许其他用户绑定',
  `is_system` tinyint(1) DEFAULT '0' COMMENT '是否为系统内置工具',
  `is_enabled` tinyint(1) DEFAULT '1' COMMENT '是否启用',
  `creator_id` int DEFAULT NULL COMMENT '创建者ID',
  `updater_id` int DEFAULT NULL COMMENT '更新者ID',

  -- 安全与审计
  `timeout_ms` int DEFAULT 10000 COMMENT '执行超时时间(毫秒)',
  `max_memory_mb` int DEFAULT 128 COMMENT 'Docker容器最大内存(MB, 仅Python)',
  `allowed_tables` json DEFAULT NULL COMMENT '允许访问的数据库表列表(仅JS沙箱)',
  `requires_docker` tinyint(1) DEFAULT '0' COMMENT '是否需要Docker沙箱执行(仅Python)',

  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tool_name` (`tool_name`),
  KEY `idx_language` (`language`),
  KEY `idx_is_public` (`is_public`),
  KEY `idx_is_system` (`is_system`),
  KEY `idx_creator_id` (`creator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI自定义原子工具表';
```

### 3.3 Sub-Agent 配置文件模型 (ai_sub_agent_config_files)

所有 .md 配置文件统一存储在此表中，包括 Soul.md、User.md、Tools.md 以及扩展的 checklist.md、examples.md 等。后端加载时只需一次查询，在内存中按 `file_type` 组装。

#### 3.3.1 `ai_sub_agent_config_files` 表 DDL

```sql
CREATE TABLE IF NOT EXISTS `ai_sub_agent_config_files` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_id` int NOT NULL COMMENT '关联的Sub-Agent ID',
  `file_type` enum('soul','user','tools','checklist','examples',
    'glossary','template','custom') NOT NULL COMMENT '文件类型',
  `file_name` varchar(100) NOT NULL COMMENT '文件名(如Soul.md)',
  `content` longtext COMMENT '文件内容(Markdown/JSON)',
  `description` varchar(500) DEFAULT NULL COMMENT '文件描述',
  `is_required` tinyint(1) DEFAULT 0 COMMENT '是否为必填配置',
  `sort_order` int DEFAULT 0 COMMENT '排序顺序',
  `version` int DEFAULT 1 COMMENT '版本号',
  `created_by` int DEFAULT NULL COMMENT '创建者ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_file_type` (`agent_id`, `file_type`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_file_type` (`file_type`),
  CONSTRAINT `fk_config_sub_agent` FOREIGN KEY (`agent_id`)
    REFERENCES `ai_sub_agents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI子智能体配置文件表(Soul.md/User.md/Tools.md/References等)';
```

**配置文件类型与用途**：

| file_type | 文件名 | 说明 | 存储格式 |
|-----------|--------|------|---------|
| `soul` | Soul.md | System Prompt，定义角色与输出规范 | Markdown |
| `user` | User.md | User Prompt 模板，支持 Handlebars 插值 | Markdown |
| `tools` | Tools.md | 工具挂载声明，JSON 数组格式 | JSON |
| `checklist` | checklist.md | 评审检查清单 | Markdown |
| `examples` | examples.md | 好/差示例 | Markdown |
| `glossary` | glossary.md | 术语表 | Markdown |
| `template` | template.md | 输出模板 | Markdown |
| `custom` | 自定义 | 用户自定义扩展 | Markdown |

> **注意**：`memory` 类型不在 `ai_sub_agent_config_files` 中，因为记忆是动态的、碎片化的，独立存储于 `ai_sub_agent_memories` 表。

### 3.4 动态经验记忆模型 (ai_sub_agent_memories) 【V4.0 核心新增】

采用"碎片化落库"设计，解决单一 `memory.md` 文件过大导致的 Token 溢出问题。记忆按三级粒度存储：全局（跨库通用）、库级（特定用例库）、模块级（特定模块）。

#### 3.4.1 `ai_sub_agent_memories` 表 DDL

```sql
CREATE TABLE IF NOT EXISTS `ai_sub_agent_memories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_id` int NOT NULL COMMENT '关联的Sub-Agent ID',
  `library_id` int DEFAULT NULL COMMENT '用例库ID(为空代表跨库全局记忆)',
  `module_id` int DEFAULT NULL COMMENT '模块ID(为空代表库级通用记忆)',
  `level` enum('global', 'library', 'module') NOT NULL COMMENT '记忆层级: global-跨库通用, library-库级, module-模块级',
  `content` longtext COMMENT '该节点下沉淀的经验规则(Markdown格式片段)',
  `char_count` int DEFAULT 0 COMMENT '内容字符数(用于提炼阈值判断)',
  `last_distilled_at` timestamp NULL DEFAULT NULL COMMENT '最近一次提炼时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_memory_node` (`agent_id`, `library_id`, `module_id`),
  KEY `idx_agent_level` (`agent_id`, `level`),
  KEY `idx_library` (`library_id`),
  KEY `idx_module` (`module_id`),
  KEY `idx_char_count` (`agent_id`, `char_count`),
  CONSTRAINT `fk_memory_sub_agent` FOREIGN KEY (`agent_id`)
    REFERENCES `ai_sub_agents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI子智能体动态经验记忆表(碎片化Memory.md)';
```

**碎片化设计说明**：

| 场景 | library_id | module_id | level | 说明 |
|------|-----------|-----------|-------|------|
| 全局基础规范 | NULL | NULL | `global` | 所有用例库通用，如"优先级必须为高/中/低之一" |
| 库级共识 | 1 | NULL | `library` | 特定用例库的共识，如"交换芯片库：步骤编号必须用 1. 2. 3." |
| 模块级踩坑 | 1 | 10 | `module` | 特定模块的经验，如"QoS_SDK模块：预期结果必须包含HTTP状态码" |

**UNIQUE KEY `uk_memory_node`**：同一个 Agent + 同一个库 + 同一个模块只能有一条记忆记录。内容在该记录的 `content` 字段中以 Markdown 累积追加，当超过阈值时由 Distiller Agent 提炼压缩。

#### 3.4.2 记忆内容示例

**全局记忆 (global)**：
```markdown
## 评审基础规范
- 用例名称必须以模块名开头
- 预期结果必须包含具体数值或明确状态
- 步骤编号统一使用 1. 2. 3. 格式
- 优先级只允许：高/中/低
- 每条用例至少覆盖1个异常场景
```

**库级记忆 (library, 交换芯片测试库)**：
```markdown
## 交换芯片库评审共识
- 所有协议相关用例需标注协议版本
- 性能测试用例预期结果必须量化(如: 延迟<5ms)
- 配置类用例需包含回退步骤
```

**模块级记忆 (module, QoS_SDK)**：
```markdown
## QoS_SDK 模块踩坑记录
- 预期结果必须包含HTTP状态码(如: 返回200 OK)
- QoS策略名称需使用下划线命名法
- 流量限制用例需覆盖超出阈值场景
- 用户修正：原建议"验证QoS生效"→改为"验证流量被限制在阈值内"
```

### 3.5 AI 评审相关表

#### 3.5.1 `ai_review_tasks` - AI评审任务表

```sql
CREATE TABLE IF NOT EXISTS `ai_review_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `review_task_id` varchar(50) NOT NULL COMMENT 'AI评审任务唯一标识',
  `source_task_id` varchar(50) DEFAULT NULL COMMENT '来源的AI生成任务ID',
  `submitter_id` int NOT NULL COMMENT '提交评审的用户ID',
  `agent_id` int NOT NULL COMMENT '使用的AI评审Sub-Agent ID',
  `status` enum('pending','running','completed','failed','cancelled')
    DEFAULT 'pending' COMMENT '任务状态',
  `total_cases` int DEFAULT 0 COMMENT '待评审用例总数',
  `reviewed_cases` int DEFAULT 0 COMMENT '已完成评审用例数',
  `approved_cases` int DEFAULT 0 COMMENT 'AI建议通过数',
  `rejected_cases` int DEFAULT 0 COMMENT 'AI建议拒绝数',
  `modified_cases` int DEFAULT 0 COMMENT 'AI建议修改数',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI辅助评审任务表';
```

> **新增索引 `idx_status_updated`**：用于孤儿任务自检时快速查找 `status='running' AND updated_at < 阈值` 的记录。

#### 3.5.2 `ai_review_results` - AI评审结果表

```sql
CREATE TABLE IF NOT EXISTS `ai_review_results` (
  `id` int NOT NULL AUTO_INCREMENT,
  `review_task_id` varchar(50) NOT NULL COMMENT 'AI评审任务ID',
  `temp_case_id` varchar(50) NOT NULL COMMENT '临时用例ID',
  `action` enum('approve','reject','modify') NOT NULL COMMENT 'AI评审动作',
  `ai_comment` text COMMENT 'AI评审意见',
  `ai_score` decimal(3,1) DEFAULT NULL COMMENT 'AI评分(0-10)',
  `original_content` json DEFAULT NULL COMMENT '原始用例内容快照',
  `suggested_content` json DEFAULT NULL COMMENT 'AI建议修改后的内容',
  `diff_summary` text COMMENT '系统生成的修改差异摘要(非LLM生成)',
  `diff_detail` json DEFAULT NULL COMMENT '系统生成的差异详情(字段级)',
  `tool_calls_log` json DEFAULT NULL COMMENT 'LLM工具调用日志',
  `memory_contribution` varchar(200) DEFAULT NULL COMMENT '本次评审中Memory贡献说明(如: 已参考QoS_SDK模块3条经验)',
  `user_decision` enum('pending','accepted','rejected','modified_accepted')
    DEFAULT 'pending' COMMENT '用户决策',
  `user_comment` text COMMENT '用户备注',
  `user_modified_content` json DEFAULT NULL COMMENT '用户编辑后的采纳内容(用于Distiller提炼)',
  `decided_at` timestamp NULL DEFAULT NULL COMMENT '用户决策时间',
  `decided_by` int DEFAULT NULL COMMENT '决策用户ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_review_case` (`review_task_id`, `temp_case_id`),
  KEY `idx_review_task_id` (`review_task_id`),
  KEY `idx_temp_case_id` (`temp_case_id`),
  KEY `idx_action` (`action`),
  KEY `idx_user_decision` (`user_decision`),
  CONSTRAINT `fk_ai_review_task` FOREIGN KEY (`review_task_id`)
    REFERENCES `ai_review_tasks` (`review_task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='AI辅助评审结果表';
```

> **与 V3.0 的关键区别**：新增 `memory_contribution` 字段记录本次评审中 Memory 上下文的贡献说明；新增 `user_modified_content` 字段记录用户编辑后采纳的内容，供 Distiller Agent 提炼修正差异。

### 3.6 现有表扩展

#### 3.6.1 `temp_test_cases` 表新增字段

```sql
ALTER TABLE `temp_test_cases`
  ADD COLUMN `ai_review_action` enum('none','approve','reject','modify')
    DEFAULT 'none' COMMENT 'AI评审动作' AFTER `review_deadline`,
  ADD COLUMN `ai_review_comment` text
    COMMENT 'AI评审意见' AFTER `ai_review_action`,
  ADD COLUMN `ai_review_score` decimal(3,1) DEFAULT NULL
    COMMENT 'AI评审评分(0-10)' AFTER `ai_review_comment`,
  ADD COLUMN `ai_suggested_content` json DEFAULT NULL
    COMMENT 'AI建议修改后的完整内容' AFTER `ai_review_score`,
  ADD COLUMN `ai_diff_summary` text
    COMMENT '系统生成的修改差异摘要' AFTER `ai_suggested_content`,
  ADD COLUMN `ai_review_task_id` varchar(50) DEFAULT NULL
    COMMENT '关联的AI评审任务ID' AFTER `ai_diff_summary`,
  ADD COLUMN `ai_user_decision` enum('pending','accepted','rejected','modified_accepted')
    DEFAULT 'pending' COMMENT '用户对AI建议的决策' AFTER `ai_review_task_id`;
```

#### 3.6.2 `email_types` 表新增记录

```sql
INSERT INTO `email_types`
  (`type_code`, `type_name`, `category`, `description`, `is_required`,
   `default_email_enabled`, `default_in_app_enabled`, `template_subject`,
   `template_path`, `supports_in_app`, `role_restriction`, `sort_order`)
VALUES
  ('ai_review_complete', 'AI辅助评审完成', 'business',
   'AI辅助评审任务完成后通知提交人和评审人', FALSE, TRUE, TRUE,
   '【xTest】AI辅助评审完成 - {taskName}', 'ai_review_complete', TRUE, NULL, 205),
  ('ai_review_result', 'AI评审结果通知', 'business',
   'AI评审结果可供查看时通知相关评审人', FALSE, TRUE, TRUE,
   '【xTest】AI评审结果待确认 - {caseName}', 'ai_review_result', TRUE, NULL, 206);
```

### 3.7 数据模型关系图

```
┌─────────────────────┐       ┌──────────────────────────────┐
│   ai_sub_agents     │       │  ai_sub_agent_config_files   │
│─────────────────────│       │──────────────────────────────│
│ agent_code (UK)     │──1:N──│ agent_id (FK)                │
│ display_name        │       │ file_type (soul/user/tools/  │
│ category            │       │   checklist/examples/...)    │
│ is_system           │       │ content                      │
│ allow_qa            │       │ version                      │
│ memory_enabled      │       └──────────────────────────────┘
│ memory_distill_thr  │
│ visibility          │       ┌──────────────────────────────┐
│ creator_id          │──1:N──│  ai_sub_agent_memories       │
└────────┬────────────┘       │──────────────────────────────│
         │                    │ agent_id (FK)                │
         │                    │ library_id / module_id       │
         │                    │ level (global/library/module)│
         │                    │ content (碎片化Markdown)      │
         │                    │ char_count / last_distilled  │
         │                    └──────────────────────────────┘
         │
         │ config_files(tools类型) 引用 tool_name
         │
         ▼
┌─────────────────────┐       ┌──────────────────────────┐
│   ai_custom_tools   │       │    ai_review_tasks       │
│─────────────────────│       │──────────────────────────│
│ tool_name (UK)      │       │ review_task_id (UK)      │
│ display_name        │       │ agent_id (FK)            │
│ description         │       │ submitter_id             │
│ input_schema (JSON) │       │ status                   │
│ language            │       └──────────┬───────────────┘
│ code_content        │                  │
│ is_public           │                  │1:N
│ requires_docker     │                  ▼
└─────────────────────┘       ┌──────────────────────────┐
                              │   ai_review_results      │
                              │──────────────────────────│
                              │ review_task_id (FK)      │
                              │ temp_case_id             │
                              │ action / ai_score        │
                              │ original_content (JSON)  │
                              │ suggested_content (JSON) │
                              │ diff_summary (系统生成)   │
                              │ diff_detail (系统生成)    │
                              │ memory_contribution      │
                              │ user_modified_content    │
                              │ user_decision            │
                              └──────────────────────────┘
```

---

## 四、核心执行引擎设计

### 4.1 动态路由与重写策略 (Override Engine)

当应用层发起 Sub-Agent 调用时：

```
┌─────────────────────────────────────────────────────────────┐
│                    Override Engine 执行流程                    │
│                                                               │
│  1. 提取目标 agent_code 和当前操作者的 user_id                │
│                                                               │
│  2. 查库策略:                                                 │
│     优先匹配: agent_code = target AND creator_id = user_id   │
│       AND is_system = 0 → 命中私有重写记录                    │
│     若无, 降级匹配: agent_code = target AND is_system = 1    │
│       → 命中系统级记录                                        │
│                                                               │
│  3. 加载配置文件:                                             │
│     SELECT * FROM ai_sub_agent_config_files                   │
│     WHERE agent_id = ?                                        │
│     → 在内存中按 file_type 组装配置                           │
│                                                               │
│  4. 加载动态记忆(仅当 memory_enabled=1):                      │
│     Memory JIT Engine 按需拼装记忆上下文                      │
│                                                               │
│  5. 透明修改逻辑:                                             │
│     非管理员修改系统Sub-Agent → 创建私有重写记录               │
│       + 在 ai_sub_agent_config_files 创建私有配置文件副本     │
│     恢复默认 → DELETE 私有重写记录(CASCADE删除私有配置文件)    │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 动态 Prompt 组装流水线 (Assembly Line)

```
Step 0: 加载配置文件
  SELECT * FROM ai_sub_agent_config_files WHERE agent_id = ?
  → 在内存中按 file_type 组装为 Map

Step 0.5: 【V4.0新增】Memory JIT拼装
  MemoryEngine.assembleContext(agent_id, library_id, module_id)
  → 提取: 全局记忆 + 库级记忆 + 模块级记忆
  → 拼装为 <Memory_Context> 片段

Step 1: 渲染上下文
  加载 configMap.user，替换 Handlebars 变量
  如有 checklist/examples 等参考文档，追加到 User Prompt 末尾

Step 2: 挂载工具链
  解析 configMap.tools (JSON数组)
  从 ai_custom_tools 拉取 description + input_schema
  转换为 Function Calling JSON 结构

Step 3: 发起推理
  System Prompt = configMap.soul + <Memory_Context> 注入
  User Prompt = 渲染后的 configMap.user
  Tools = 挂载的工具链
  response_format = { type: "json_object" }

Step 4: 工具调用循环 (Agentic Loop, 最多5轮)
  LLM返回tool_calls → 沙盒执行 → 结果回传 → 继续推理

Step 5: 逐条解析与系统Diff生成
  1. 逐条解析 JSON (容错解析)
  2. 对每条 modify 结果:
     - diff 库对比 original_content vs suggested_content
     - 系统自动生成 diff_summary + diff_detail
  3. LLM 只负责生成用例内容，不负责总结差异
```

### 4.3 运行时 Memory 动态拼装引擎 (Just-In-Time Assembly) 【V4.0 新增】

当用户在"QoS_SDK"模块（module_id: 10，属于 library_id: 1）触发 AI 评审时，Node.js 并不读取某个巨大的物理文件，而是动态拼装：

#### 4.3.1 拼装逻辑

```javascript
class MemoryEngine {
  async assembleContext(agentId, libraryId, moduleId) {
    if (!libraryId && !moduleId) return '';

    const [rows] = await db.query(
      `SELECT level, content FROM ai_sub_agent_memories
       WHERE agent_id = ?
         AND (library_id IS NULL OR library_id = ?)
         AND (module_id IS NULL OR module_id = ?)
       ORDER BY level ASC`,
      [agentId, libraryId || null, moduleId || null]
    );

    if (!rows.length) return '';

    const sections = rows.map(r => {
      const label = { global: '全局基础规范', library: '用例库共识', module: '模块级踩坑记录' }[r.level];
      return `### ${label}\n${r.content}`;
    });

    return `\n<Memory_Context>\n以下是本团队长期积累的评审经验，请严格遵循：\n\n${sections.join('\n\n')}\n</Memory_Context>`;
  }
}
```

#### 4.3.2 拼装示例

假设 QoS_SDK 模块（library_id=1, module_id=10）触发评审，拼装结果：

```
<Memory_Context>
以下是本团队长期积累的评审经验，请严格遵循：

### 全局基础规范
- 用例名称必须以模块名开头
- 预期结果必须包含具体数值或明确状态
- 步骤编号统一使用 1. 2. 3. 格式

### 用例库共识
- 交换芯片库：所有协议相关用例需标注协议版本
- 性能测试用例预期结果必须量化(如: 延迟<5ms)

### 模块级踩坑记录
- QoS_SDK：预期结果必须包含HTTP状态码
- QoS_SDK：流量限制用例需覆盖超出阈值场景
</Memory_Context>
```

### 4.4 异步经验提炼智能体 (Distiller Agent) 【V4.0 新增】

AI 的记忆不能无限增长，必须有"提炼"机制。

#### 4.4.1 触发时机

| 触发场景 | 说明 |
|---------|------|
| 用户修正采纳 | 用户在评审页面修改了 AI 的建议并最终"采纳"（`user_decision='modified_accepted'`），将用户的修改差异（Diff）提炼为经验 |
| 记忆超阈值 | 某模块的 `char_count` 超过 `memory_distill_threshold`（默认2000字符），提炼压缩现有记忆 |

#### 4.4.2 执行流程

```
触发: 用户修正采纳(modified_accepted)
  │
  ├── 1. 提取修正差异
  │     user_modified_content vs suggested_content
  │     → 使用 diffGenerator 生成差异
  │
  ├── 2. 获取当前记忆
  │     SELECT content FROM ai_sub_agent_memories
  │     WHERE agent_id = ? AND library_id = ? AND module_id = ?
  │
  ├── 3. 异步调用 Distiller Agent
  │     System Prompt: "你是经验提炼专家，将用户修正差异合并到现有记忆中..."
  │     Input: { current_memory, user_diff, module_context }
  │     Output: 提炼后的精简 Markdown
  │
  └── 4. 落地更新
        UPDATE ai_sub_agent_memories
        SET content = ?, char_count = LENGTH(?),
            last_distilled_at = NOW()
        WHERE agent_id = ? AND library_id = ? AND module_id = ?

触发: 记忆超阈值(char_count > threshold)
  │
  ├── 1. 加载臃肿记忆
  │
  ├── 2. 异步调用 Distiller Agent
  │     System Prompt: "合并同类项，删减冗余，浓缩为不超过500字的核心业务军规"
  │     Input: { bloated_memory }
  │     Output: 精简 Markdown
  │
  └── 3. 落地覆盖
        UPDATE ai_sub_agent_memories
        SET content = ?, char_count = LENGTH(?),
            last_distilled_at = NOW()
```

#### 4.4.3 Distiller Agent 的 Soul 片段

```markdown
# 经验提炼专家

## 身份
你是一名经验沉淀专家，负责将用户的修正反馈和大模型的历史记忆进行合并提炼。

## 核心原则
1. **保留事实**：用户的具体修正记录必须保留
2. **合并同类**：语义重复的规则合并为一条
3. **去冗余**：删除过于细碎、低价值的记录
4. **格式统一**：统一使用 "- 规则描述" 格式
5. **字数控制**：提炼后总字数不超过500字

## 输出格式
直接输出提炼后的 Markdown 文本，不需要代码块包裹。
```

### 4.5 沙盒工具执行引擎 (Sandbox Executor)

#### 4.5.1 JavaScript 工具执行（现有 vm 沙箱升级）

- 从 `ai_custom_tools` 加载 `code_content`
- `validateCodeSecurity()` 安全检查
- `createSafeSandbox()` 暴露 console/Date/Math/JSON/db.query
- db.query 受 `sqlSecurityValidator` + `dataIsolation` + `allowed_tables` 约束
- `vm.Script` 编译 + `runInContext(timeout: 10s)`

#### 4.5.2 Python 工具执行（Docker 沙箱，新增）

- 生成临时 .py 文件，写入 `code_content` + LLM 参数
- Docker API (dockerode) 拉起隔离容器
- 🚨 **内网离线约束**：Python 镜像预置于本地 Harbor，禁止运行时 pip install
- 容器配置：Network none, ReadOnlyRootfs, AutoRemove, 资源限制
- 捕获 stdout，超时 SIGKILL，销毁容器

**Docker 离线镜像构建规范**：

```dockerfile
FROM python:3.11-slim
COPY requirements.txt /tmp/
RUN pip install --no-index --find-links=/tmp/wheels -r /tmp/requirements.txt
WORKDIR /sandbox
CMD ["python"]
```

### 4.6 异步任务健壮性设计（防范孤儿任务）

#### 4.6.1 启动时自检

在 `server.js` 启动时，将所有 `status='running'` 且 `updated_at` 超过阈值（默认30分钟）的任务重置为 `failed`：

```javascript
async function cleanupOrphanTasks() {
  const ORPHAN_THRESHOLD_MINUTES = 30;
  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MINUTES * 60 * 1000);
  const [result] = await db.query(
    `UPDATE ai_review_tasks
     SET status = 'failed', error_message = '任务因服务重启被标记为失败(孤儿任务自检)'
     WHERE status = 'running' AND updated_at < ?`,
    [cutoff]
  );
  if (result.affectedRows > 0) {
    logger.warn(`[OrphanTaskCleaner] 重置了 ${result.affectedRows} 个孤儿任务`);
  }
}
```

#### 4.6.2 心跳机制

对于耗时极长的批量任务，后端执行循环时定期更新 `updated_at`（默认每60秒），证明任务"还活着"：

```javascript
const heartbeatTimer = setInterval(async () => {
  await db.query(
    'UPDATE ai_review_tasks SET updated_at = NOW() WHERE review_task_id = ?',
    [reviewTaskId]
  );
}, 60 * 1000);
```

### 4.7 LLM 输出 JSON 严格化

#### 4.7.1 API 级约束

调用 LLM 时强制指定 `response_format: { type: 'json_object' }`，大幅提升 JSON 输出合法性。对于不支持的模型，降级到后端容错解析。

#### 4.7.2 分步骤验证（逐条评审）

使用 Node.js 控制并发（默认 MAX_CONCURRENT=3），逐条让 AI 返回单条用例的修改建议。即使某一条 JSON 格式崩了，也不会导致整个批次解析失败。

#### 4.7.3 LLM 输出容错解析

多层容错策略：直接解析 → 提取 `json` 代码块 → 查找首尾花括号 → 修复常见错误（末尾逗号等）。

### 4.8 Diff 摘要系统生成策略

后端拿到 `suggested_content` 后，使用 `diff` 库自动对比 `original_content` 和 `suggested_content`，由系统生成准确的差异描述。LLM 只负责生成最高质量的用例内容。

**`services/diffGenerator.js`** 核心逻辑：
- `generateDiffSummary(original, suggested)` → 生成人类可读的差异摘要（如"优先级: 中→高; 预期结果: 登录成功→返回HTTP 200"）
- `generateDiffDetail(original, suggested)` → 生成字段级差异详情 JSON（含 changeType: added/removed/modified）

---

## 五、四大核心配置文件规范

### 5.1 Soul.md — Sub-Agent 的"灵魂"

定义 Sub-Agent 的身份、原则和行为边界。

**默认模板（review_test_cases）**：

```markdown
# AI 评审员

## 身份
你是一名资深的测试用例评审专家，拥有 10 年以上的软件测试经验。

## 核心原则
1. **准确性优先**：评审意见必须基于事实，不得臆测
2. **建设性反馈**：拒绝时必须给出具体改进建议
3. **规范遵循**：严格遵循项目测试用例编写规范
4. **完整性检查**：确保用例覆盖正常/异常/边界场景

## 行为边界
- 仅评审测试用例的质量，不修改业务逻辑
- 不替代人工评审的最终决策权
- 遇到不确定的内容，标注为"需人工确认"
- 不生成全新的测试用例，仅对现有用例提出修改建议

## 评审维度
1. 用例名称是否清晰准确
2. 前置条件是否完整
3. 测试步骤是否可执行、有编号
4. 预期结果是否明确可验证
5. 优先级设定是否合理
6. 用例类型分类是否正确
7. 是否覆盖边界和异常场景

## 输出格式
严格按照 JSON 格式输出评审结果：
{
  "action": "approve|reject|modify",
  "score": 0-10,
  "comment": "评审意见",
  "suggested_content": { ... }
}
```

> **注意**：输出格式中不再要求 LLM 生成 `diff_summary`，该字段由系统通过 `diffGenerator` 自动生成。`<Memory_Context>` 由 Memory JIT Engine 在运行时动态注入，不需要写入 Soul.md。

### 5.2 User.md — 用户偏好与输入模板

定义用户/团队的偏好和 Prompt 模板，支持 Handlebars 风格插值语法。

**默认模板（review_test_cases）**：

```markdown
# 用户评审偏好

## 团队规范
- 用例命名格式：[模块名]_[测试类型]_[测试点描述]
- 步骤编号格式：1. 2. 3.
- 预期结果需包含具体数值或明确状态

## 评审关注点
- 重点关注：步骤可执行性、预期结果可验证性
- 次要关注：命名规范、格式统一
- 可忽略：备注字段内容

## 待评审用例
{{temp_cases_json}}

## 模块上下文
模块名称: {{module_name}}
模块描述: {{module_description}}

## 评审要求
- 评审数量: {{case_count}} 条
- 自动通过阈值: {{auto_approve_score}}
- 重点关注: {{review_focus}}
```

### 5.3 Tools.md — 可用工具与能力

存储在 `ai_sub_agent_config_files` 表的 `tools` 类型中，content 为 JSON 数组格式：

```json
["spec_checker", "duplication_checker", "coverage_analyzer", "consistency_checker"]
```

### 5.4 Memory.md — 动态经验记忆 【V4.0 新增】

Memory.md 不作为 `ai_sub_agent_config_files` 中的静态文件存储，而是通过 `ai_sub_agent_memories` 表碎片化管理。运行时由 Memory JIT Engine 动态拼装注入。

**记忆生命周期**：

```
初次评审(无记忆)
  │
  ├── AI 输出评审结果
  ├── 用户修正采纳(modified_accepted)
  │     │
  │     └── Distiller Agent 提炼修正差异
  │           │
  │           └── 写入 ai_sub_agent_memories(INSERT/UPDATE)
  │                 │
  │                 └── 下次同模块评审自动加载记忆
  │
  └── 记忆持续累积...
        │
        └── char_count > memory_distill_threshold
              │
              └── Distiller Agent 提炼压缩
                    │
                    └── UPDATE 覆盖旧记忆(精简版)
```

### 5.5 扩展配置文件（References）

| 文件类型 | file_type 值 | 说明 | 优先级 |
|----------|-------------|------|--------|
| 评审检查清单 | `checklist` | 逐项检查的评审清单 | P1 推荐 |
| 评审示例 | `examples` | 好/差的用例评审示例 | P1 推荐 |
| 术语表 | `glossary` | 项目/领域专有名词解释 | P2 可选 |
| 输出模板 | `template` | AI 输出格式的详细模板 | P2 可选 |
| 自定义扩展 | `custom` | 用户自定义的任意 Markdown 配置 | P3 扩展 |

---

## 六、后端接口设计

### 6.1 Sub-Agent 管理路由：`routes/aiSubAgents.js`

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/ai-sub-agents/list` | GET | 获取Sub-Agent列表（含Override逻辑） |
| `/api/ai-sub-agents/detail/:agentCode` | GET | 获取详情+配置文件+记忆统计 |
| `/api/ai-sub-agents/create` | POST | 创建（元数据+配置文件单事务写入） |
| `/api/ai-sub-agents/update/:id` | PUT | 更新（含Override逻辑，不再双写） |
| `/api/ai-sub-agents/override/:agentCode` | DELETE | 恢复默认（CASCADE删除私有配置文件） |
| `/api/ai-sub-agents/toggle/:id` | POST | 切换启用状态 |
| `/api/ai-sub-agents/:id` | DELETE | 删除（系统内置不可删） |

### 6.2 自定义工具路由：`routes/aiTools.js`

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/ai-tools/list` | GET | 获取工具列表 |
| `/api/ai-tools/detail/:toolName` | GET | 获取工具详情 |
| `/api/ai-tools/create` | POST | 创建工具 |
| `/api/ai-tools/update/:toolName` | PUT | 更新工具 |
| `/api/ai-tools/:toolName` | DELETE | 删除工具 |
| `/api/ai-tools/test-run/:toolName` | POST | 测试运行工具 |

### 6.3 Sub-Agent 配置文件路由：`routes/aiSubAgentConfigFiles.js`

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/ai-sub-agents/config-files/:agentId` | GET | 获取配置文件列表 |
| `/api/ai-sub-agents/config-files/:agentId/:fileType` | PUT | 更新配置文件（不再双写主表） |
| `/api/ai-sub-agents/config-files/:agentId` | POST | 新增配置文件 |
| `/api/ai-sub-agents/config-files/:fileId` | DELETE | 删除配置文件（soul/user/tools不可删） |
| `/api/ai-sub-agents/init-config-files/:agentId` | POST | 初始化默认配置文件 |

### 6.4 记忆管理路由：`routes/aiMemories.js` 【V4.0 新增】

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/ai-memories/tree/:agentId` | GET | 获取记忆树状结构（全局→库→模块） |
| `/api/ai-memories/detail` | GET | 获取指定记忆节点内容（参数: agent_id, library_id, module_id） |
| `/api/ai-memories/update` | PUT | 手动编辑记忆内容 |
| `/api/ai-memories/distill` | POST | 手动触发记忆提炼（管理员） |
| `/api/ai-memories/stats/:agentId` | GET | 获取记忆统计（各级记忆条数、字符数、最近提炼时间） |
| `/api/ai-memories/reset/:agentId` | POST | 重置某Agent全部记忆（管理员，需确认） |

### 6.5 AI 评审路由：`routes/aiReview.js`

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/ai-review/submit` | POST | 提交AI辅助评审 |
| `/api/ai-review/task/:reviewTaskId` | GET | 获取任务状态 |
| `/api/ai-review/results/:reviewTaskId` | GET | 获取评审结果列表 |
| `/api/ai-review/decide` | POST | 单条决策（含修正采纳，触发Distiller） |
| `/api/ai-review/batch-decide` | POST | 批量决策 |
| `/api/ai-review/batch-merge` | POST | 批量合并到正式库 |
| `/api/ai-review/compare/:reviewTaskId/:tempCaseId` | GET | 获取对比详情 |

### 6.6 AI 知识问答路由：`routes/aiQA.js`

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/ai-qa/available-agents` | GET | 获取可用的问答Sub-Agent列表（`allow_qa=1 AND is_enabled=1`） |
| `/api/ai-qa/ask` | POST | 提交问答（加载Soul.md+Tools.md+Memory，拼装发给LLM） |

---

## 七、前端页面设计（详细规格）

### 7.0 前端架构概述

本项目前端采用**原生 JavaScript + Hash 路由**架构，所有核心业务页面集中在 `index.html` 中通过 `display:none/block` 切换，路由系统基于 `public/js/modules/core/router.js`。AI 相关模块独立为 `public/js/modules/ai-generation.js`。配置中心位于 `#/settings`，采用左右布局（左侧菜单+右侧面板）。

**AI 功能入口总览**：

| 入口位置 | 入口形式 | 目标页面/功能 | 说明 |
|---------|---------|-------------|------|
| 顶部导航栏 | 紫色渐变按钮"AI生成" | `#/ai-generation` | AI用例生成+评审管理 |
| 顶部导航栏 | AI问答按钮（灯泡图标） | 模态框 `#ai-assistant-modal` | AI知识问答 |
| 配置中心左侧菜单 | "AI 智能体"菜单组 | 多个配置面板 | 智能体编排台/工具工坊/记忆管理台 |

### 7.1 智能体编排台 (Sub-Agent Orchestrator)

#### 7.1.1 入口与位置

- **所在页面**：配置中心（`#/settings`）
- **菜单路径**：左侧菜单 → "🤖 AI 智能体" 菜单组 → "智能体编排台"
- **URL 路由**：`#/settings?config=ai-sub-agents`
- **面板 ID**：`ai-sub-agents-config`
- **权限**：所有用户可见（非管理员只能查看和创建私有Agent）

#### 7.1.2 面板整体布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  🤖 智能体编排台                                                      │
│  管理AI子智能体，配置人设、上下文、工具和记忆。                          │
│                                                                      │
│  [+ 新建智能体]  [📂 从模板创建]              🔍 [搜索智能体...]       │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 筛选: [全部分类 ▼]  [全部状态 ▼]  [仅我创建 □]                  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 编码            │ 名称          │ 分类    │ 记忆 │ 状态  │ 操作 │ │
│  │─────────────────│───────────────│─────────│──────│───────│──────│ │
│  │ review_test_    │ 测试用例评审   │ 用例评审 │ ✅   │ 启用  │ ⋮   │ │
│  │ cases           │ 专家          │         │      │       │      │ │
│  │─────────────────│───────────────│─────────│──────│───────│──────│ │
│  │ generate_test_  │ 测试用例生成   │ 用例生成 │ ❌   │ 启用  │ ⋮   │ │
│  │ cases           │ 专家          │         │      │       │      │ │
│  │─────────────────│───────────────│─────────│──────│───────│──────│ │
│  │ qa_assistant    │ 通用问答助手   │ 问答助手 │ ✅   │ 禁用  │ ⋮   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  💡 系统内置智能体不可删除，非管理员修改后自动保存为私有版本           │
└──────────────────────────────────────────────────────────────────────┘
```

**列表字段说明**：

| 列名 | 宽度 | 说明 |
|------|------|------|
| 编码 (agent_code) | 20% | 系统唯一标识，等宽字体 |
| 名称 (display_name) | 20% | 中文显示名 |
| 分类 (category) | 12% | 标签样式：用例评审(蓝)、用例生成(绿)、问答助手(橙) |
| 记忆 (memory_enabled) | 8% | ✅/❌ 图标，悬停显示记忆统计 |
| 状态 (is_enabled) | 8% | 启用/禁用切换开关 |
| 操作 | 12% | 下拉菜单：编辑/复制/重写(私有)/恢复默认/删除 |

#### 7.1.3 编辑模态框 — 多Tab布局

点击"编辑"或"新建"后，弹出全屏模态框，采用**顶部Tab导航**布局：

```
┌──────────────────────────────────────────────────────────────────────┐
│  ✏️ 编辑智能体: 测试用例评审专家                              [✕]   │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 基本信息  │ │ Soul.md  │ │ User.md  │ │ Tools.md │ │ 参考文档  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                                                                 │ │
│  │  [当前Tab内容区]                                                 │ │
│  │                                                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  🏷️ 已自定义(私有版本)  [🔄 恢复系统默认]                             │
│                                                                      │
│                              [取消]  [保存]                          │
└──────────────────────────────────────────────────────────────────────┘
```

**Tab 1: 基本信息**

| 字段 | 控件 | 说明 |
|------|------|------|
| 智能体编码 (agent_code) | input[text] | 新建时可编辑，编辑时只读，小写下划线风格 |
| 显示名称 (display_name) | input[text] | 中文展示名 |
| 分类 (category) | select | 用例评审/用例生成/问答助手/通用 |
| 描述 (description) | textarea | 能力简述 |
| 允许AI问答 (allow_qa) | toggle switch | 是否允许在AI问答下拉中选择 |
| 启用经验记忆 (memory_enabled) | toggle switch | 是否启用动态经验记忆 |
| 记忆提炼阈值 (memory_distill_threshold) | input[number] | 仅当 memory_enabled=1 时显示，默认2000 |
| 启用状态 (is_enabled) | select | 启用/禁用 |

**Tab 2: Soul.md（左右分栏编辑器+预览）**

```
┌────────────────────────┬────────────────────────┐
│  编辑区 (Monaco/CodeMirror)  │  Markdown 预览区        │
│  ──────────────────────│────────────────────────│
│  # AI 评审员            │  <h1>AI 评审员</h1>      │
│  ## 身份                │  <h2>身份</h2>           │
│  你是一名资深的...       │  你是一名资深的...        │
│                         │                         │
│  [格式化] [压缩] [重置]  │                         │
└────────────────────────┴────────────────────────┘
```

- 左侧：代码编辑器（Monaco Editor 本地化托管），语法高亮 Markdown
- 右侧：实时 Markdown 预览（使用 DOMPurify 消毒后渲染）
- 工具栏：格式化 / 压缩 / 恢复默认模板 / 插入变量片段
- 🚨 编辑器 JS 依赖必须完全本地化，禁止从 CDN 加载

**Tab 3: User.md（左右分栏编辑器+预览）**

- 与 Soul.md 相同的编辑器布局
- 额外功能：在编辑器上方显示可用 Handlebars 变量列表（`{{temp_cases_json}}`、`{{module_name}}` 等），点击可插入

**Tab 4: Tools.md（穿梭框挂载/移除工具）**

```
┌──────────────────────────────────────────────────────────┐
│  可用工具                        │ 已挂载工具               │
│  ─────────────────────────────│─────────────────────────│
│  🔍 spec_checker              │  ✅ spec_checker    [×] │
│  🔍 duplication_checker       │  ✅ dup_checker      [×] │
│  📊 coverage_analyzer         │                         │
│  🔄 consistency_checker       │                         │
│  📈 test_statistics           │                         │
│  ─────────────────────────────│─────────────────────────│
│  [◀ 挂载选中]  [挂载全部 ▶▶]  │  [◀◀ 移除全部]  [移除选中 ▶]│
└──────────────────────────────────────────────────────────┘
```

- 左侧：从 `ai_custom_tools` 中已启用且公开的工具列表
- 右侧：当前 Sub-Agent 已挂载的工具
- 双击或按钮操作进行挂载/移除
- 底部：JSON 预览区（显示当前 Tools.md 的 JSON 数组内容）

**Tab 5: 参考文档（checklist/examples/glossary/template/custom 管理）**

```
┌──────────────────────────────────────────────────────────┐
│  [+ 新建参考文档]                                         │
│                                                          │
│  ┌──────────────┬──────────┬────────┬──────────┐        │
│  │ 文件名        │ 类型     │ 大小   │ 操作      │        │
│  │──────────────│──────────│────────│──────────│        │
│  │ checklist.md │ 检查清单 │ 1.2KB  │ 编辑/删除 │        │
│  │ examples.md  │ 评审示例 │ 2.5KB  │ 编辑/删除 │        │
│  │ glossary.md  │ 术语表   │ 0.8KB  │ 编辑/删除 │        │
│  └──────────────┴──────────┴────────┴──────────┘        │
│                                                          │
│  点击"编辑"打开左右分栏编辑器（同 Soul.md）                 │
└──────────────────────────────────────────────────────────┘
```

#### 7.1.4 Override 交互

- 编辑系统级 Sub-Agent 时，底部显示黄色横幅："⚠️ 您正在修改系统内置智能体，保存后将创建您的私有版本"
- 已自定义的 Agent 列表行显示"🏷️ 已自定义"标签
- 点击"🔄 恢复系统默认"时弹出确认：`await showConfirmMessage('确定恢复系统默认？您的私有配置将被删除')`

### 7.2 自定义工具工坊 (Custom Tool Workshop)

#### 7.2.1 入口与位置

- **所在页面**：配置中心（`#/settings`）
- **菜单路径**：左侧菜单 → "🤖 AI 智能体" 菜单组 → "自定义工具工坊"
- **URL 路由**：`#/settings?config=ai-tools`
- **面板 ID**：`ai-tools-config`
- **权限**：所有用户可见（非管理员只能管理自己创建的工具）

#### 7.2.2 面板布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔧 自定义工具工坊                                                    │
│  管理AI可调用的原子工具，支持JavaScript和Python脚本。                    │
│                                                                      │
│  [+ 新建工具]                                    🔍 [搜索工具...]     │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 工具标识       │ 展示名       │ 语言  │ 公开 │ 状态  │ 操作      │ │
│  │───────────────│──────────────│───────│─────│──────│───────────│ │
│  │ spec_checker  │ 规范检查器    │ JS    │ ✅  │ 启用  │ 编辑/删除 │ │
│  │ dup_checker   │ 查重器       │ JS    │ ✅  │ 启用  │ 编辑/删除 │ │
│  │ coverage_calc │ 覆盖率计算    │ Python│ ✅  │ 启用  │ 编辑/删除 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

#### 7.2.3 工具编辑模态框

- **上方**：基本信息（tool_name、display_name、description、language、is_public）
- **中间**：Monaco Editor 代码编辑器（JS/Python 语法高亮）
- **左下**：JSON Schema 可视化编辑器（定义 input_schema）
- **右下**：测试运行区（输入测试参数 → 点击"▶ 测试运行" → 显示执行结果）

### 7.3 记忆管理台 (Memory Center) 【V4.0 新增】

#### 7.3.1 入口与位置

- **所在页面**：配置中心（`#/settings`）
- **菜单路径**：左侧菜单 → "🤖 AI 智能体" 菜单组 → "记忆管理台"
- **URL 路由**：`#/settings?config=ai-memories`
- **面板 ID**：`ai-memories-config`
- **权限**：所有用户可见（管理员可操作所有Agent的记忆）

#### 7.3.2 面板布局 — 树状目录视图

```
┌──────────────────────────────────────────────────────────────────────┐
│  🧠 记忆管理台                                                        │
│  管理AI子智能体的业务经验记忆，支持查看、编辑和提炼。                      │
│                                                                      │
│  选择智能体: [测试用例评审专家 ▼]                                       │
│                                                                      │
│  ┌──────────────────────────┬───────────────────────────────────────┐│
│  │ 📂 记忆树                 │  📝 记忆内容                          ││
│  │                          │                                       ││
│  │ 🌐 全局基础记忆            │  ## 评审基础规范                       ││
│  │    (5条规则, 320字)       │  - 用例名称必须以模块名开头              ││
│  │                          │  - 预期结果必须包含具体数值或明确状态     ││
│  │ 📁 交换芯片测试库          │  - 步骤编号统一使用 1. 2. 3. 格式       ││
│  │   ├── L2_Switch模块       │  - 优先级只允许：高/中/低               ││
│  │   │   (3条, 180字)       │  - 每条用例至少覆盖1个异常场景           ││
│  │   └── QoS_SDK模块        │                                       ││
│  │       (5条, 450字)       │  [编辑] [🗑️ 清空] [🔄 提炼]            ││
│  │                          │                                       ││
│  │ 📁 协议一致性测试库        │  最近提炼: 2026/04/25 14:30            ││
│  │   └── DHCP模块            │  字符数: 320 / 阈值: 2000              ││
│  │       (2条, 120字)       │                                       ││
│  └──────────────────────────┴───────────────────────────────────────┘│
│                                                                      │
│  💡 记忆由AI自动沉淀，您也可以手动编辑。当记忆超过阈值时会自动提炼。     │
└──────────────────────────────────────────────────────────────────────┘
```

#### 7.3.3 交互流程

| 操作 | 交互 | 说明 |
|------|------|------|
| 选择智能体 | 下拉选择 | 切换后刷新记忆树和内容区 |
| 点击树节点 | 加载内容 | 右侧显示该节点的记忆内容（Markdown格式） |
| 编辑记忆 | 点击"编辑"按钮 | 内容区变为可编辑的 Monaco Editor，保存时调用 `/api/ai-memories/update` |
| 手动提炼 | 点击"🔄 提炼"按钮 | `await showConfirmMessage('确定提炼此记忆？将压缩冗余内容')`，调用 `/api/ai-memories/distill`，显示加载动画 |
| 清空记忆 | 点击"🗑️ 清空"按钮 | `await showConfirmMessage('确定清空此节点的记忆？不可恢复')` |
| 重置全部 | 顶部按钮"重置全部记忆" | 仅管理员可见，`await showConfirmMessage('⚠️ 确定重置该智能体的全部记忆？不可恢复')` |

#### 7.3.4 配置中心菜单变更

在现有配置中心的"AI 引擎设置"菜单组中，将"AI 技能管理"替换为新的菜单结构：

| 旧菜单 | 新菜单 | panel ID |
|--------|--------|----------|
| AI 技能管理 | 智能体编排台 | `ai-sub-agents-config` |
| — | 自定义工具工坊 (新增) | `ai-tools-config` |
| — | 记忆管理台 (新增) | `ai-memories-config` |
| AI 超时配置 | AI 超时配置 (保留) | `ai-timeout-config` |

菜单组名称从"AI 引擎设置"改为"🤖 AI 智能体"。

### 7.4 评审管理页面升级

#### 7.4.1 入口与位置

- **所在页面**：AI生成页面（`#/ai-generation`）
- **Tab位置**：第三个Tab "🔍 评审管理"
- **URL 路由**：`#/ai-generation/review`
- **现有结构**：当前评审Tab仅包含人工评审列表，需新增"AI辅助评审"子标签页

#### 7.4.2 升级后的评审管理Tab布局

将现有的评审管理Tab升级为双子标签布局：

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔍 评审管理                                                          │
│                                                                      │
│  ┌──────────────┐  ┌──────────────────┐                              │
│  │ 👥 人工评审    │  │ 🤖 AI辅助评审     │  ← 新增子标签               │
│  └──────────────┘  └──────────────────┘                              │
│                                                                      │
│  === 选中"AI辅助评审"子标签时 ===                                     │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 统计卡片:                                                        │ │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │ │
│  │ │ ✅ 通过   │ │ ❌ 拒绝   │ │ ✏️ 建议修改│ │ ⏳ 待决策  │           │ │
│  │ │   12     │ │   3      │ │   8      │ │   5      │           │ │
│  │ └──────────┘ └──────────┘ └──────────┘ └──────────┘           │ │
│  │ 💾 已参考3条模块经验 (Memory贡献)                                  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 筛选: [全部动作 ▼] [全部决策 ▼]    🔍 [搜索用例...]               │ │
│  │                                                                  │ │
│  │ [批量采纳] [批量拒绝] [📦 合并进库]                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ ☐ │ 用例名称     │ AI动作 │ AI评分 │ Diff摘要     │ 决策  │ 操作 │ │
│  │───│─────────────│───────│───────│─────────────│─────│──────│ │
│  │ ☐ │ 登录功能_正  │ 修改  │ 7.5   │ 优先级:中→高│ 待定 │ 查看 │ │
│  │   │ 常登录       │       │       │             │     │      │ │
│  │ ☐ │ 登录功能_密  │ 通过  │ 9.0   │ —           │ 待定 │ 查看 │ │
│  │   │ 码错误       │       │       │             │     │      │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

#### 7.4.3 对比详情弹窗

点击"查看"操作时，弹出对比详情弹窗：

```
┌──────────────────────────────────────────────────────────────────────┐
│  📊 AI评审对比详情                                             [✕]   │
│                                                                      │
│  ┌──────────────────────────┬───────────────────────────────────────┐│
│  │ 原始用例                   │ AI建议修改                            ││
│  │──────────────────────────│──────────────────────────────────────││
│  │ 名称: 登录功能_正常登录    │ 名称: 登录功能_正常登录                ││
│  │ 优先级: 中                │ 优先级: 高  ← 标红差异                 ││
│  │ 前置条件: 用户已注册       │ 前置条件: 用户已注册且账号已激活 ←新增  ││
│  │ 步骤:                     │ 步骤:                                ││
│  │ 1. 打开登录页面            │ 1. 打开登录页面                       ││
│  │ 2. 输入用户名和密码        │ 2. 输入用户名和密码                    ││
│  │ 3. 点击登录按钮            │ 3. 点击登录按钮                       ││
│  │ 预期: 登录成功             │ 预期: 返回HTTP 200, 跳转首页 ←修改   ││
│  └──────────────────────────┴───────────────────────────────────────┘│
│                                                                      │
│  📝 Diff摘要 (系统生成):                                              │
│  • 优先级: 中 → 高                                                    │
│  • 前置条件: 新增"且账号已激活"                                        │
│  • 预期结果: 登录成功 → 返回HTTP 200, 跳转首页                         │
│                                                                      │
│  💾 Memory贡献: 已参考QoS_SDK模块3条经验                               │
│                                                                      │
│  🤖 AI评审意见: 建议将优先级提升为"高"，因为登录是核心入口功能；         │
│  前置条件需补充账号激活状态；预期结果需量化。                             │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────── │
│  您的决策:                                                            │
│  ○ 直接采纳AI建议    ○ 拒绝AI建议    ● 编辑后采纳                      │
│                                                                      │
│  [编辑区 - 仅当选"编辑后采纳"时显示]                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ (可编辑的采纳内容，默认填入AI建议内容)                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  📝 备注: [可选填写]                                                   │
│                                                                      │
│                              [取消]  [确认决策]                       │
└──────────────────────────────────────────────────────────────────────┘
```

**关键交互**：
- 选择"编辑后采纳"时，下方展开可编辑区域，默认填入 AI 建议内容
- 用户编辑后点击"确认决策"，`user_decision='modified_accepted'`，保存 `user_modified_content`
- 后端异步触发 Distiller Agent 提炼修正差异，沉淀经验到记忆表

### 7.5 提交评审弹窗升级

#### 7.5.1 入口

- **所在页面**：AI生成页面 → "临时用例预览" Tab
- **触发方式**：点击"📤 提交评审"按钮（现有按钮升级）
- **弹窗形式**：模态框

#### 7.5.2 弹窗布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  📤 提交评审                                                   [✕]   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 评审人选择 (现有功能)                                             │ │
│  │ [搜索评审人...] ☐ 张三  ☐ 李四  ☐ 王五                          │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 🤖 AI辅助评审 (新增区域)                                         │ │
│  │                                                                  │ │
│  │ ☑ 启用AI辅助评审                                                 │ │
│  │                                                                  │ │
│  │ 选择AI评审智能体: [测试用例评审专家 ▼]                             │ │
│  │ ┌─────────────────────────────────────────────────────────────┐ │ │
│  │ │ 📋 测试用例评审专家                                         │ │ │
│  │ │ 专注测试用例质量评审，支持规范检查、查重、覆盖率分析          │ │ │
│  │ │ 记忆: ✅ 已启用 | 可用工具: 4个                               │ │ │
│  │ └─────────────────────────────────────────────────────────────┘ │ │
│  │                                                                  │ │
│  │ AI评审选项:                                                      │ │
│  │  • 自动通过阈值: [8.0] 分 (AI评分≥此值自动标记为"建议通过")       │ │
│  │  • 并发数: [3] (同时评审的用例数)                                  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  💡 AI评审结果将与人工评审一同通过邮件发送给评审人                       │
│                                                                      │
│                              [取消]  [提交评审]                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.6 AI 知识问答页面升级

#### 7.6.1 入口

- **所在页面**：顶部导航栏 → "AI问答"按钮（灯泡图标）
- **触发方式**：点击按钮，打开现有 `#ai-assistant-modal` 模态框
- **升级内容**：在现有问答对话框上方新增 Sub-Agent 下拉选择

#### 7.6.2 升级后的问答模态框

```
┌──────────────────────────────────────────────────────────────────────┐
│  🤖 AI知识问答                                                 [✕]   │
│                                                                      │
│  选择智能体: [测试用例评审专家 ▼]  (仅显示 allow_qa=1 的智能体)        │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ 📋 当前智能体: 测试用例评审专家                               │     │
│  │ 记忆: ✅ 已启用(将注入相关经验上下文)                          │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ 对话区域                                                         │ │
│  │                                                                  │ │
│  │ 🤖 你好！我是测试用例评审专家。有什么评审相关的问题可以帮你？     │ │
│  │                                                                  │ │
│  │ 👤 这个用例的预期结果写"系统正常"可以吗？                         │ │
│  │                                                                  │ │
│  │ 🤖 不建议。根据团队评审经验，预期结果需包含具体数值或明确状态。     │ │
│  │ 建议修改为类似"返回HTTP 200，页面跳转至首页"的具体描述。          │ │
│  │ [💾 参考了: 全局基础规范-第2条]                                   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ [输入您的问题...]                              [📎] [🎤] [发送] │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**V4.0 升级要点**：
- 新增智能体下拉选择（仅显示 `allow_qa=1 AND is_enabled=1`）
- 问答时自动加载选中智能体的 Soul.md + Tools.md + Memory（JIT拼装）
- AI 回答中标注 Memory 贡献（如"[💾 参考了: 全局基础规范-第2条]"）
- Q&A 场景下的 Memory 按 library_id/module_id 路由：用户当前选中的用例库/模块

---

## 八、邮件通知设计

| type_code | 触发时机 | 接收人 | 邮件内容 |
|-----------|---------|--------|---------|
| `ai_review_complete` | AI评审任务完成时 | 提交人 + 所有评审人 | 评审摘要统计、Memory贡献说明、系统生成的差异摘要、评审结果页面链接 |
| `ai_review_result` | AI评审结果可供查看时 | 被选中的评审人 | 单条用例AI评审结果、Diff摘要、决策页面链接 |

邮件模板包含评审摘要统计、系统生成的差异摘要、评审结果页面链接。

---

## 九、安全与权限设计

### 9.1 权限矩阵

| 操作 | 提交人 | 评审人 | 管理员 | 其他用户 |
|------|--------|--------|--------|---------|
| 提交AI辅助评审 | ✅ | ✅ | ✅ | ❌ |
| 查看AI评审结果 | ✅(自己的) | ✅(被分配的) | ✅(全部) | ❌ |
| 采纳/拒绝AI建议 | ✅(自己的) | ✅(被分配的) | ✅(全部) | ❌ |
| 合并到正式库 | ✅(自己的) | ✅(被分配的) | ✅(全部) | ❌ |
| 修改系统Sub-Agent | → 自动私有重写 | → 自动私有重写 | ✅(可改系统默认) | ❌ |
| 编辑/重置记忆 | ❌ | ❌ | ✅(全部) | ❌ |
| 手动提炼记忆 | ❌ | ❌ | ✅ | ❌ |
| AI知识问答 | ✅ | ✅ | ✅ | ❌ |

### 9.2 AI 调用安全

- Soul.md/User.md/Tools.md 内容传入 LLM 前需经过 XSS 过滤
- AI 评审结果写入数据库前需经过 `escapeHtml` 处理
- 超时机制（默认10分钟），Agentic Loop 最多5轮
- LLM 调用强制指定 `response_format: { type: 'json_object' }`
- Distiller Agent 提炼结果写入记忆前需经过安全校验（长度限制、XSS过滤）

### 9.3 沙盒安全

| 维度 | JS 沙箱 (vm) | Python 沙箱 (Docker) |
|------|-------------|---------------------|
| 隔离级别 | 进程内隔离 | 容器级隔离 |
| 网络访问 | 无 | 无 (Network: none) |
| 文件系统 | 不可访问 | 只读挂载脚本文件 |
| 数据库 | 白名单表+SQL验证+数据隔离 | 不可访问 |
| 资源限制 | 超时10s | 超时+内存限制 |

### 9.4 记忆安全

- 记忆内容写入前必须经过 XSS 过滤
- Distiller Agent 提炼后的内容长度限制在500字以内
- 记忆仅限同一 Agent 内共享，不同 Agent 之间记忆隔离
- 私有重写 Agent 的记忆独立于系统 Agent

---

## 十、数据库迁移脚本

迁移文件：`migrations/add_ai_sub_agent_platform.sql`

核心步骤：
1. 创建 `ai_sub_agents` 表（含 memory_enabled、memory_distill_threshold）
2. 创建 `ai_custom_tools` 表
3. 创建 `ai_sub_agent_config_files` 表
4. 创建 `ai_sub_agent_memories` 表（V4.0新增核心表）
5. 创建 `ai_review_tasks` 表（含 `idx_status_updated` 索引）
6. 创建 `ai_review_results` 表（含 `diff_detail`、`memory_contribution`、`user_modified_content` 字段）
7. ALTER `temp_test_cases` 新增AI评审字段
8. INSERT `email_types` 新增邮件类型
9. 迁移 `ai_skills` 数据到 `ai_sub_agents`（仅元数据）
10. 为内置Sub-Agent创建配置文件（soul/user/tools/checklist/examples）
11. 插入内置评审Sub-Agent `review_test_cases`
12. 插入内置工具（spec_checker/duplication_checker/coverage_analyzer/consistency_checker）
13. 为内置评审Sub-Agent初始化全局记忆种子数据（V4.0新增）

---

## 十一、实施计划

| 阶段 | 任务 |
|------|------|
| 一：基础设施 | 数据库迁移(含memories表) + 执行引擎 + 沙盒执行器 + Diff生成器 + LLM解析器 + 路由注册 + 孤儿任务自检 + npm install diff |
| 二：记忆引擎 | MemoryEngine(JIT拼装) + Distiller Agent + 记忆路由(aiMemories.js) + 记忆阈值自检定时任务 |
| 三：前端配置中心 | 智能体编排台 + 工具工坊 + 记忆管理台 + Monaco本地化 + Override交互 + 配置中心菜单重构 |
| 四：AI评审核心 | 评审服务(含心跳+Memory注入) + 评审路由 + 提交弹窗升级 + 修正采纳→Distiller触发 |
| 五：评审结果展示 | 评审管理标签页(双子标签) + 对比视图(Diff高亮) + 单条/批量决策 + 合并 + Memory贡献展示 |
| 六：Q&A与通知 | AI知识问答升级(Sub-Agent下拉+Memory注入) + 邮件通知扩展(Memory贡献) |
| 七：部署收尾 | Docker离线镜像 + 集成测试 + init.sql更新 + 记忆种子数据 |

---

## 十二、风险与注意事项

### 12.1 技术风险

| 风险 | 缓解措施 |
|------|---------|
| LLM 返回格式不稳定 | API级 `response_format=json_object` + 逐条评审 + 多层容错解析 |
| 服务重启导致孤儿任务 | 启动时自检 + 心跳机制 |
| 大批量用例 Token 超限 | 逐条评审 + 并发控制(MAX_CONCURRENT=3) |
| LLM Diff摘要幻觉 | 系统自动生成（diff库对比），不依赖LLM |
| 双写一致性风险 | 彻底规范化：主表只存元数据，配置统一存config_files表 |
| Docker 容器逃逸 | 最小权限+只读文件系统+无网络+资源限制 |
| **记忆无限膨胀** | **Distiller Agent 自动提炼 + char_count 阈值触发 + 提炼后500字上限** |
| **Distiller 提炼质量** | **保留事实原则 + 用户修正差异优先保留 + 管理员可手动编辑/重置** |
| **Memory注入导致Token超限** | **JIT拼装时计算char_count总量 + 全局上限5000字 + 超限截断低优先级记忆** |

### 12.2 兼容性

- `ai_skills` 表保留，数据迁移后可择期废弃
- 现有评审流程完全保留，AI辅助评审为可选增强
- Docker 为可选依赖，未安装时 Python 工具不可用但系统正常运行
- `diff` npm 包为轻量级纯 JS 库，无外部依赖
- 记忆功能为可选（`memory_enabled` 字段控制），关闭后不影响基础评审

---

## 附录 A：OpenClaw Skills 架构对照表

| OpenClaw 概念 | xTest V4.0 对应 | 说明 |
|--------------|-----------------|------|
| SOUL.md | `ai_sub_agent_config_files(soul)` | V4.0统一存于配置文件表 |
| SKILL.md | `ai_sub_agent_config_files(user)` | xTest用User.md模板 |
| Tools (Python/JS) | `ai_custom_tools` 表 | 独立工具表+沙箱/Docker执行 |
| References/ | `ai_sub_agent_config_files(checklist/examples/...)` | 对齐references目录结构 |
| Override/个人配置 | `ai_sub_agents.visibility + creator_id` | 两级体系(系统级/私有重写) |
| Memory/经验 | `ai_sub_agent_memories` 表 | **V4.0新增**，碎片化JIT拼装 |

## 附录 B：建议扩展的 .md 配置文件

| 文件 | 优先级 | 说明 |
|------|--------|------|
| **Soul.md** | P0 必须 | AI人格定义 |
| **User.md** | P0 必须 | 用户偏好与输入模板 |
| **Tools.md** | P0 必须 | 工具能力声明 |
| **Memory.md** | P0 必须 | 动态经验记忆（碎片化存储于memories表） |
| **checklist.md** | P1 推荐 | 评审检查清单 |
| **examples.md** | P1 推荐 | 好/差示例 |
| **glossary.md** | P2 可选 | 术语表 |
| **template.md** | P2 可选 | 输出模板 |
| **custom.md** | P3 扩展 | 用户自定义 |

## 附录 C：ai_skills → ai_sub_agents 迁移映射

| ai_skills 字段 | ai_sub_agents 字段 | 说明 |
|----------------|-------------------|------|
| `name` | `agent_code` | V4.0使用小写下划线风格 |
| `display_name` | `display_name` | 中文展示名 |
| `definition` | → `ai_sub_agent_config_files(soul)` | V4.0下沉到配置文件表 |
| `execute_code` | → `ai_custom_tools` | V4.0迁移到独立工具表 |
| `is_public` | `visibility` | 升级为 ENUM('public','private') |
| `soul_md` (V2.1) | → `ai_sub_agent_config_files(soul)` | V4.0彻底下沉，主表不再冗余 |
| `user_md` (V2.1) | → `ai_sub_agent_config_files(user)` | V4.0彻底下沉，主表不再冗余 |
| `tools_md` (V2.1) | → `ai_sub_agent_config_files(tools)` | V4.0彻底下沉，主表不再冗余 |
| `has_config_files` (V2.1) | 移除 | V4.0不再需要 |

## 附录 D：V3.0 → V4.0 核心变更摘要

| 变更项 | V3.0 | V4.0 |
|--------|------|------|
| 核心概念 | Sub-Agents (无记忆) | Sub-Agents + Memory（具备经验自进化能力） |
| 配置文件 | 3核心(Soul/User/Tools) | 4核心(Soul/User/Tools/**Memory**) |
| 新增核心表 | — | `ai_sub_agent_memories`（碎片化记忆表） |
| ai_sub_agents 字段 | 无记忆控制 | +`memory_enabled` +`memory_distill_threshold` |
| ai_review_results 字段 | 无记忆/修正字段 | +`memory_contribution` +`user_modified_content` |
| 执行引擎 | Prompt拼装 | Prompt拼装 + **Memory JIT注入** |
| 经验沉淀 | 无 | **Distiller Agent 自动提炼** |
| 前端新增页面 | — | **记忆管理台**（树状目录视图） |
| 配置中心菜单 | AI技能管理 | 智能体编排台 + 工具工坊 + 记忆管理台 |
| 评审决策 | 采纳/拒绝 | 采纳/拒绝/**编辑后采纳**(触发Distiller) |
| AI问答 | 无Sub-Agent选择 | **Sub-Agent下拉 + Memory注入** |
| 记忆路由 | — | 全局 → 库级 → 模块级（3级粒度） |