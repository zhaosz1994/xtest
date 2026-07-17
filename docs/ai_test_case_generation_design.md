# AI自动生成测试用例系统设计报告

## 一、系统概述

### 1.1 项目背景

xTest是一个专业的测试管理平台，核心资产是测试用例信息。随着AI Agent技术的发展，本系统旨在实现测试用例的智能化自动生成，通过AI Skills + 大模型能力，根据用户提供的材料自动生成符合数据库表单格式的测试用例。

### 1.2 核心目标

1. **智能化生成**：基于用户上传的材料（文档、网页等），自动生成标准化测试用例
2. **学习与查重**：学习现有测试用例风格，生成新用例时自动查重
3. **安全可控**：生成的用例先进入临时状态，用户确认后才正式生效
4. **异步处理**：后台异步生成，完成后邮件通知用户

### 1.3 极简架构设计原则

本系统采用**极简架构**设计理念，遵循以下核心原则：

| 原则 | 说明 | 收益 |
|------|------|------|
| **去Redis化** | 利用Node.js原生异步特性配合MySQL实现轻量级任务队列 | 降低基础设施维护成本，无需额外部署Redis |
| **内存计算代偿** | 针对十万级以下用例查重，放弃向量数据库，改用Node.js内存计算 | 简化技术栈，降低系统复杂度 |
| **数据库分治** | 将长文本材料切片存储于MySQL，采用Map-Reduce处理流 | 规避大模型Token溢出与幻觉问题 |

**架构对比**：

```
传统方案:                          极简方案:
┌─────────────┐                   ┌─────────────┐
│   Redis     │ ← 移除            │   MySQL     │ ← 状态机
│  (任务队列)  │                   │  (任务状态)  │
└─────────────┘                   └─────────────┘
┌─────────────┐                   ┌─────────────┐
│ 向量数据库   │ ← 移除            │  Node.js    │ ← 内存计算
│  (查重索引)  │                   │  (相似度)    │
└─────────────┘                   └─────────────┘
┌─────────────┐                   ┌─────────────┐
│  RAG架构    │ ← 移除            │  MySQL      │ ← 分块存储
│ (长文本处理)│                   │ (Map-Reduce)│
└─────────────┘                   └─────────────┘
```

### 1.3 现有技术栈

| 层级 | 技术选型 |
|------|----------|
| 后端框架 | Node.js + Express |
| 数据库 | MySQL 8.0 |
| 前端 | 原生JavaScript + 模块化架构 |
| AI能力 | 已有ai_skills/ai_models表，支持DeepSeek/OpenAI/智谱AI |
| 邮件服务 | nodemailer（已集成） |
| 文件处理 | multer + xlsx |

---

## 二、系统架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端展示层                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  模块管理   │  │  材料上传   │  │  用例预览   │  │  用例确认   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API网关层                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  认证中间件 │ 权限校验 │ 请求限流 │ 日志记录                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              业务服务层                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │ 材料解析服务 │ │ AI生成服务   │ │ 查重服务     │ │ 邮件通知服务 │      │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                       │
│  │ 任务队列服务 │ │ 网页爬虫服务 │ │ 文件存储服务 │                       │
│  └──────────────┘ └──────────────┘ └──────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              数据存储层                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │ MySQL数据库  │ │ 文件存储     │ │ 任务队列     │ │ 缓存层       │      │
│  │ (业务数据)   │ │ (材料文件)   │ │ (异步任务)   │ │ (临时数据)   │      │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心流程图

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  用户   │───▶│ 选择模块 │───▶│ 上传材料 │───▶│ 点击生成 │───▶│ 等待通知 │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          后台异步处理流程                                │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐             │
│  │ 解析材料 │───▶│ 学习现有 │───▶│ AI生成  │───▶│ 查重过滤 │             │
│  │         │    │ 用例风格 │    │ 新用例  │    │         │             │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘             │
│        │                                              │                 │
│        ▼                                              ▼                 │
│  ┌─────────┐                                   ┌─────────┐             │
│  │ 网页爬虫 │                                   │ 存入临时 │             │
│  │ (可选)  │                                   │ 表单    │             │
│  └─────────┘                                   └─────────┘             │
└─────────────────────────────────────────────────────────────────────────┘
                                                              │
                                                              ▼
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 邮件通知 │───▶│ 用户登录 │───▶│ 预览用例 │───▶│ 编辑/确认│───▶│ 正式生效 │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
```

---

## 三、数据库设计

### 3.1 新增数据表

#### 3.1.1 测试用例生成任务表 (ai_case_generation_tasks)

```sql
CREATE TABLE `ai_case_generation_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '任务唯一标识',
  `module_id` int NOT NULL COMMENT '目标模块ID',
  `library_id` int DEFAULT NULL COMMENT '用例库ID',
  `user_id` int NOT NULL COMMENT '发起任务的用户ID',
  `status` enum('pending','processing','completed','failed','cancelled') DEFAULT 'pending' COMMENT '任务状态',
  `progress` int DEFAULT 0 COMMENT '进度百分比(0-100)',
  `progress_message` varchar(500) DEFAULT NULL COMMENT '进度描述信息',
  `total_cases` int DEFAULT 0 COMMENT '生成的用例总数',
  `duplicate_count` int DEFAULT 0 COMMENT '查重过滤的数量',
  `error_message` text COMMENT '错误信息',
  `config` json DEFAULT NULL COMMENT '生成配置(JSON格式)',
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始处理时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_id` (`task_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_task_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_task_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI测试用例生成任务表';
```

#### 3.1.2 生成任务材料表 (ai_case_generation_materials)

```sql
CREATE TABLE `ai_case_generation_materials` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '关联的任务ID',
  `material_type` enum('file','url','text') NOT NULL COMMENT '材料类型: file-文件, url-网页链接, text-纯文本',
  `material_name` varchar(255) DEFAULT NULL COMMENT '材料名称/文件名',
  `file_path` varchar(500) DEFAULT NULL COMMENT '文件存储路径(文件类型)',
  `file_size` bigint DEFAULT NULL COMMENT '文件大小(字节)',
  `file_type` varchar(50) DEFAULT NULL COMMENT '文件类型',
  `url` varchar(1000) DEFAULT NULL COMMENT '网页URL(url类型)',
  `url_username` varchar(100) DEFAULT NULL COMMENT '网页登录用户名(可选)',
  `url_password` varchar(255) DEFAULT NULL COMMENT '网页登录密码(加密存储,可选)',
  `text_content` longtext COMMENT '纯文本内容(text类型)',
  `parse_status` enum('pending','parsing','parsed','failed') DEFAULT 'pending' COMMENT '解析状态',
  `parse_result` longtext COMMENT '解析后的文本内容',
  `parse_error` text COMMENT '解析错误信息',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_material_type` (`material_type`),
  CONSTRAINT `fk_material_task` FOREIGN KEY (`task_id`) REFERENCES `ai_case_generation_tasks` (`task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI测试用例生成材料表';
```

#### 3.1.3 临时测试用例表 (temp_test_cases)

```sql
CREATE TABLE `temp_test_cases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `temp_case_id` varchar(50) NOT NULL COMMENT '临时用例唯一标识',
  `task_id` varchar(50) NOT NULL COMMENT '关联的任务ID',
  `module_id` int NOT NULL COMMENT '模块ID',
  `name` varchar(500) NOT NULL COMMENT '用例名称',
  `priority` varchar(20) DEFAULT '中' COMMENT '优先级',
  `type` varchar(50) DEFAULT '功能测试' COMMENT '用例类型',
  `precondition` text COMMENT '前置条件',
  `purpose` text COMMENT '测试目的',
  `steps` text NOT NULL COMMENT '测试步骤',
  `expected` text NOT NULL COMMENT '预期结果',
  `key_config` text COMMENT '关键配置',
  `remark` text COMMENT '备注',
  `method` varchar(50) DEFAULT '手动' COMMENT '测试方法',
  `owner` varchar(50) DEFAULT NULL COMMENT '负责人',
  `environments` json DEFAULT NULL COMMENT '测试环境(JSON数组)',
  `test_types` json DEFAULT NULL COMMENT '测试类型(JSON数组)',
  `sources` json DEFAULT NULL COMMENT '用例来源(JSON数组)',
  `phases` json DEFAULT NULL COMMENT '测试阶段(JSON数组)',
  `methods` json DEFAULT NULL COMMENT '测试方法(JSON数组)',
  `duplicate_score` decimal(5,2) DEFAULT NULL COMMENT '查重相似度分数(0-100)',
  `duplicate_with_case_id` int DEFAULT NULL COMMENT '重复的正式用例ID',
  `is_duplicate` tinyint(1) DEFAULT 0 COMMENT '是否被标记为重复',
  `user_modified` tinyint(1) DEFAULT 0 COMMENT '用户是否已修改',
  `status` enum('pending','approved','rejected','merged') DEFAULT 'pending' COMMENT '状态: pending-待确认, approved-已批准, rejected-已拒绝, merged-已合并',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_temp_case_id` (`temp_case_id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_status` (`status`),
  KEY `idx_is_duplicate` (`is_duplicate`),
  CONSTRAINT `fk_temp_task` FOREIGN KEY (`task_id`) REFERENCES `ai_case_generation_tasks` (`task_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_temp_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临时测试用例表';
```

#### 3.1.4 AI生成配置表 (ai_generation_configs)

```sql
CREATE TABLE `ai_generation_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `config_name` varchar(100) NOT NULL COMMENT '配置名称',
  `config_type` enum('global','module','user') DEFAULT 'global' COMMENT '配置类型',
  `target_id` int DEFAULT NULL COMMENT '目标ID(模块ID或用户ID)',
  `model_id` varchar(50) DEFAULT NULL COMMENT '使用的AI模型ID',
  `temperature` decimal(3,2) DEFAULT 0.70 COMMENT '生成温度(0-1)',
  `max_tokens` int DEFAULT 4000 COMMENT '最大生成token数',
  `case_count_limit` int DEFAULT 50 COMMENT '单次生成用例数量上限',
  `duplicate_threshold` decimal(5,2) DEFAULT 80.00 COMMENT '查重阈值(相似度超过此值视为重复)',
  `enable_learning` tinyint(1) DEFAULT 1 COMMENT '是否学习现有用例',
  `enable_dedup` tinyint(1) DEFAULT 1 COMMENT '是否启用查重',
  `custom_prompt` text COMMENT '自定义提示词模板',
  `field_mappings` json DEFAULT NULL COMMENT '字段映射配置',
  `is_default` tinyint(1) DEFAULT 0 COMMENT '是否默认配置',
  `is_enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `created_by` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_config_type` (`config_type`),
  KEY `idx_target_id` (`target_id`),
  KEY `idx_is_default` (`is_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI生成配置表';
```

#### 3.1.5 模块风格知识库表 (module_style_knowledge)

```sql
CREATE TABLE `module_style_knowledge` (
  `id` int NOT NULL AUTO_INCREMENT,
  `module_id` int NOT NULL COMMENT '模块ID',
  `style_vector` json DEFAULT NULL COMMENT '风格向量(用于相似度计算)',
  `style_summary` text COMMENT '风格摘要文本',
  `naming_patterns` json DEFAULT NULL COMMENT '命名模式统计',
  `step_patterns` json DEFAULT NULL COMMENT '步骤模式统计',
  `priority_distribution` json DEFAULT NULL COMMENT '优先级分布',
  `type_distribution` json DEFAULT NULL COMMENT '类型分布',
  `avg_case_length` int DEFAULT NULL COMMENT '平均用例长度',
  `sample_cases` json DEFAULT NULL COMMENT '样本用例(用于学习)',
  `case_count` int DEFAULT 0 COMMENT '用例总数',
  `last_updated` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_module_id` (`module_id`),
  CONSTRAINT `fk_style_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块风格知识库表';
```

#### 3.1.6 模块关联关系表 (module_relations)

```sql
CREATE TABLE `module_relations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `module_id` int NOT NULL COMMENT '源模块ID',
  `related_module_id` int NOT NULL COMMENT '关联模块ID',
  `relation_type` enum('similar','dependency','parent','sibling') DEFAULT 'similar' COMMENT '关联类型',
  `similarity_score` decimal(5,2) DEFAULT NULL COMMENT '相似度分数',
  `relation_reason` text COMMENT '关联原因说明',
  `is_verified` tinyint(1) DEFAULT 0 COMMENT '是否已验证',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_module_relation` (`module_id`, `related_module_id`),
  KEY `idx_related_module_id` (`related_module_id`),
  CONSTRAINT `fk_relation_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_relation_related` FOREIGN KEY (`related_module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块关联关系表';
```

#### 3.1.7 材料分块处理表 (ai_material_chunks)

用于处理长文本材料，采用Map-Reduce架构，规避大模型Token溢出问题：

```sql
CREATE TABLE `ai_material_chunks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `material_id` int NOT NULL COMMENT '关联的材料ID',
  `task_id` varchar(50) NOT NULL COMMENT '关联的任务ID',
  `chunk_index` int NOT NULL COMMENT '块的顺序索引',
  `chunk_content` text NOT NULL COMMENT '文本片段内容',
  `token_count` int DEFAULT 0 COMMENT '预估Token数',
  `status` enum('pending','processing','completed','failed') DEFAULT 'pending' COMMENT '处理状态',
  `retry_count` int DEFAULT 0 COMMENT '重试次数',
  `generated_cases` int DEFAULT 0 COMMENT '该块生成的用例数',
  `error_message` text COMMENT '错误信息',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_material` (`task_id`, `material_id`),
  KEY `idx_status` (`status`),
  KEY `idx_chunk_index` (`chunk_index`),
  CONSTRAINT `fk_chunk_material` FOREIGN KEY (`material_id`) REFERENCES `ai_case_generation_materials` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='长材料分块处理表';
```

#### 3.1.8 用例向量索引表 (case_embedding_index)

存储用例的embedding向量，用于内存查重计算：

```sql
CREATE TABLE `case_embedding_index` (
  `id` int NOT NULL AUTO_INCREMENT,
  `case_id` int NOT NULL COMMENT '测试用例ID',
  `case_type` enum('formal','temp') DEFAULT 'formal' COMMENT '用例类型: formal-正式用例, temp-临时用例',
  `name_embedding` json DEFAULT NULL COMMENT '用例名称的embedding向量',
  `content_embedding` json DEFAULT NULL COMMENT '用例内容的embedding向量',
  `embedding_model` varchar(50) DEFAULT NULL COMMENT '生成embedding的模型',
  `embedding_dimension` int DEFAULT 1536 COMMENT '向量维度',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_case_type` (`case_id`, `case_type`),
  KEY `idx_case_type` (`case_type`),
  CONSTRAINT `fk_embedding_case` FOREIGN KEY (`case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例向量索引表';
```

### 3.2 数据表关系图

```
┌─────────────────────┐     ┌─────────────────────┐
│ ai_case_generation_ │     │ ai_case_generation_ │
│       tasks         │────▶│      materials      │
│  (生成任务主表)      │     │    (材料表)         │
└─────────────────────┘     └─────────────────────┘
          │
          │ 1:N
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│   temp_test_cases   │     │      modules        │
│  (临时测试用例表)    │────▶│    (模块表)         │
└─────────────────────┘     └─────────────────────┘
          │                          │
          │ 确认后合并                │
          ▼                          ▼
┌─────────────────────┐     ┌─────────────────────┐
│     test_cases      │────▶│   (正式用例表)      │
│  (正式测试用例表)    │     └─────────────────────┘
└─────────────────────┘
```

---

## 四、后端API设计

### 4.1 API接口列表

| 接口路径 | 方法 | 功能描述 |
|---------|------|----------|
| `/api/ai-generation/tasks` | POST | 创建生成任务 |
| `/api/ai-generation/tasks` | GET | 获取任务列表 |
| `/api/ai-generation/tasks/:taskId` | GET | 获取任务详情 |
| `/api/ai-generation/tasks/:taskId/cancel` | POST | 取消任务 |
| `/api/ai-generation/tasks/:taskId/temp-cases` | GET | 获取临时用例列表 |
| `/api/ai-generation/temp-cases/:tempCaseId` | GET | 获取临时用例详情 |
| `/api/ai-generation/temp-cases/:tempCaseId` | PUT | 更新临时用例 |
| `/api/ai-generation/temp-cases/:tempCaseId` | DELETE | 删除临时用例 |
| `/api/ai-generation/temp-cases/batch-approve` | POST | 批量批准用例 |
| `/api/ai-generation/temp-cases/batch-reject` | POST | 批量拒绝用例 |
| `/api/ai-generation/temp-cases/merge` | POST | 合并确认的用例 |
| `/api/ai-generation/materials/upload` | POST | 上传材料文件 |
| `/api/ai-generation/materials/url` | POST | 添加网页链接材料 |
| `/api/ai-generation/configs` | GET/POST/PUT | 配置管理 |
| `/api/ai-generation/dedup/check` | POST | 查重检测 |
| `/api/ai-generation/style-knowledge/refresh` | POST | 刷新模块风格知识库 |
| `/api/ai-generation/module-relations` | GET/POST | 模块关联管理 |

### 4.2 核心接口详细设计

#### 4.2.1 创建生成任务

**请求**
```http
POST /api/ai-generation/tasks
Content-Type: application/json
Authorization: Bearer <token>

{
  "moduleId": 4,
  "libraryId": 1,
  "materials": [
    {
      "type": "file",
      "materialId": "MAT-xxx-001"
    },
    {
      "type": "url",
      "url": "https://example.com/spec",
      "username": "user",
      "password": "pass"
    }
  ],
  "config": {
    "caseCountLimit": 20,
    "enableLearning": true,
    "enableDedup": true,
    "enableCrossModuleLearning": true,
    "crossModuleStrategy": "smart",
    "customPrompt": "请根据以下材料生成测试用例..."
  }
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "taskId": "TASK-20260425-001",
    "status": "pending",
    "message": "任务已创建，正在后台处理"
  }
}
```

#### 4.2.2 获取临时用例列表

**请求**
```http
GET /api/ai-generation/tasks/TASK-20260425-001/temp-cases?status=pending&includeDuplicate=false
Authorization: Bearer <token>
```

**响应**
```json
{
  "success": true,
  "data": {
    "total": 15,
    "pending": 12,
    "approved": 2,
    "rejected": 1,
    "duplicates": 3,
    "cases": [
      {
        "tempCaseId": "TEMP-CASE-001",
        "name": "NetRx Buffer基本功能测试",
        "priority": "高",
        "type": "功能测试",
        "precondition": "设备已启动并完成初始化",
        "purpose": "验证Buffer管理功能正常",
        "steps": "1. 配置Buffer大小\n2. 发送测试报文\n3. 检查Buffer状态",
        "expected": "Buffer状态正确，报文正常转发",
        "isDuplicate": false,
        "duplicateScore": null,
        "status": "pending"
      }
    ]
  }
}
```

#### 4.2.3 批量批准并合并用例

**请求**
```http
POST /api/ai-generation/temp-cases/merge
Content-Type: application/json
Authorization: Bearer <token>

{
  "taskId": "TASK-20260425-001",
  "tempCaseIds": ["TEMP-CASE-001", "TEMP-CASE-002"],
  "defaultOwner": "zhaosz"
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "mergedCount": 2,
    "caseIds": ["CASE-20260425-001", "CASE-20260425-002"],
    "message": "已成功合并2个测试用例到正式库"
  }
}
```

---

## 五、前端UI设计

### 5.1 页面结构

```
模块详情页
├── 模块基本信息区
├── AI生成用例区 (新增)
│   ├── 生成按钮
│   ├── 任务状态卡片
│   └── 快捷操作入口
├── 现有测试用例列表区
└── 临时用例预览区 (新增)
    ├── 材料管理面板
    ├── 用例列表
    └── 批量操作工具栏
```

### 5.2 核心UI组件设计

#### 5.2.1 AI生成入口组件

**位置**：模块详情页顶部，现有"新建用例"按钮旁

```
┌─────────────────────────────────────────────────────────────────────┐
│  模块: NetRx                                                        │
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐│
│  │  新建用例    │  │  🤖 AI生成用例                               ││
│  └──────────────┘  └──────────────────────────────────────────────┘│
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  📊 最近生成任务                                             │   │
│  │  ┌───────────────────────────────────────────────────────┐  │   │
│  │  │ 任务ID: TASK-20260425-001  状态: 处理中  进度: 45%    │  │   │
│  │  │ [████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  │  │   │
│  │  │ 正在解析材料... 已生成 8 个用例                         │  │   │
│  │  └───────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 5.2.2 材料上传弹窗

**触发**：点击"AI生成用例"按钮

```
┌─────────────────────────────────────────────────────────────────────┐
│  🤖 AI生成测试用例                                           [×]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  目标模块: NetRx                                                    │
│                                                                     │
│  📎 上传材料                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  拖拽文件到此处，或点击选择文件                       │  │   │
│  │  │                                                       │  │   │
│  │  │  支持格式: Excel(.xlsx/.xls), Word(.docx), PDF,      │  │   │
│  │  │          图片, Visio(.vsdx), DrawIO(.drawio)         │  │   │
│  │  │                                                       │  │   │
│  │  │          最大文件大小: 20MB                           │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  📎 已上传材料                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  📄 PRD_v2.0.docx                    2.3MB   [删除] [预览]  │   │
│  │  📊 测试需求.xlsx                    156KB   [删除] [预览]  │   │
│  │  🖼️ 流程图.png                       890KB   [删除] [预览]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  🔗 网页链接材料                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  URL: [https://example.com/spec                          ]  │   │
│  │  ☐ 需要登录认证                                             │   │
│  │  用户名: [              ]  密码: [              ]           │   │
│  │  [+ 添加链接]                                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ⚙️ 生成配置                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  用例数量上限: [20     ] 个                                  │   │
│  │  ☑ 学习现有用例风格  ☑ 启用查重过滤                         │   │
│  │  ☑ 学习关联模块用例 (智能推荐)                              │   │
│  │  查重阈值: [80     ]% (相似度超过此值视为重复)              │   │
│  │  AI模型: [DeepSeek ▼]                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                              [取消]  [开始生成]             │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 5.2.3 任务处理进度弹窗

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⏳ AI生成进度                                               [×]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  任务ID: TASK-20260425-001                                          │
│  状态: 处理中                                                       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  [████████████████████████░░░░░░░░░░░░░░░░░░░░]  65%       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  📋 处理步骤                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ✅ 1. 解析材料文件                              已完成     │   │
│  │  ✅ 2. 学习现有用例风格                          已完成     │   │
│  │  ✅ 3. 生成测试用例 (已生成 12/20)               处理中     │   │
│  │  ⏳ 4. 查重过滤                                  等待中     │   │
│  │  ⏳ 5. 保存临时用例                              等待中     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  📊 实时统计                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  已生成: 12 个    重复过滤: 3 个    有效: 9 个              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  💡 提示: 任务将在后台继续处理，完成后会发送邮件通知您             │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    [最小化]  [取消任务]                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 5.2.4 临时用例预览页面

**入口**：任务完成后，点击通知或从任务列表进入

```
┌─────────────────────────────────────────────────────────────────────┐
│  📋 AI生成结果预览                                                  │
├─────────────────────────────────────────────────────────────────────┤
│  任务ID: TASK-20260425-001    生成时间: 2026/04/25 14:30:00        │
│  模块: NetRx                                                        │
│                                                                     │
│  📊 统计摘要                                                        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐       │
│  │ 总计: 15   │ │ 待确认: 10 │ │ 已批准: 3  │ │ 重复: 2    │       │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘       │
│                                                                     │
│  🔍 筛选: [全部 ▼] [待确认 ▼]    搜索: [                    ]      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ☐ │ 用例名称                │ 优先级 │ 类型   │ 状态   │ 操作 │   │
│  ├───┼─────────────────────────┼────────┼────────┼────────┼──────┤   │
│  │ ☐ │ NetRx Buffer基本功能测试│ 高     │ 功能   │ 待确认 │ 👁️ ✏️ │   │
│  │ ☐ │ NetRx调度算法验证       │ 高     │ 功能   │ 待确认 │ 👁️ ✏️ │   │
│  │ ☐ │ Buffer溢出异常测试      │ 中     │ 异常   │ ⚠️重复 │ 👁️   │   │
│  │ ☐ │ NetRx性能压力测试       │ 中     │ 性能   │ 已批准 │ 👁️ ✏️ │   │
│  │...│ ...                     │ ...    │ ...    │ ...    │ ...  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [全选] [批量批准] [批量拒绝] [批量删除]    [确认合并到正式库]│   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 5.2.5 用例详情编辑弹窗

```
┌─────────────────────────────────────────────────────────────────────┐
│  📝 编辑测试用例                                             [×]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  基本信息                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 用例名称: [NetRx Buffer基本功能测试                      ]  │   │
│  │ 优先级:   [高 ▼]    类型: [功能测试 ▼]    方法: [手动 ▼]   │   │
│  │ 负责人:   [zhaosz ▼]                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  测试内容                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 前置条件:                                                    │   │
│  │ [设备已启动并完成初始化配置                               ]  │   │
│  │                                                              │   │
│  │ 测试目的:                                                    │   │
│  │ [验证NetRx Buffer管理功能正常工作                         ]  │   │
│  │                                                              │   │
│  │ 测试步骤:                                                    │   │
│  │ [1. 配置Buffer大小为1024KB                               ]  │   │
│  │ [2. 发送1000个测试报文                                    ]  │   │
│  │ [3. 检查Buffer使用状态                                    ]  │   │
│  │ [4. 验证报文转发正确性                                    ]  │   │
│  │                                                              │   │
│  │ 预期结果:                                                    │   │
│  │ [Buffer状态正确，报文正常转发，无丢包                     ]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  扩展属性                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 测试环境: [☑ UML] [☑ EMUL] [☐ 开发环境] [☐ 测试环境]       │   │
│  │ 测试类型: [☑ 功能测试] [☐ 性能测试] [☐ 压力测试]           │   │
│  │ 测试阶段: [☑ v1.0] [☑ v2.0] [☐ v3.0]                       │   │
│  │ 用例来源: [☑ PRD] [☑ 客户需求] [☐ 功能特性]                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ⚠️ 查重提示: 此用例与 CASE-20260330-56150 相似度 85%              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                              [取消]  [保存修改]             │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 邮件通知模板

#### 5.3.1 任务完成通知

```
主题: 【xTest】AI测试用例生成完成 - NetRx模块

尊敬的 zhaosz：

您提交的AI测试用例生成任务已完成。

任务详情:
- 任务ID: TASK-20260425-001
- 目标模块: NetRx
- 生成时间: 2026/04/25 14:30:00

生成结果:
- 总生成用例: 15 个
- 有效用例: 13 个
- 重复过滤: 2 个

请登录系统查看并确认生成的测试用例:
http://localhost:3000/ai-generation/tasks/TASK-20260425-001

注意: 临时用例将在7天后自动清理，请及时确认。

此邮件由系统自动发送，请勿回复。
```

---

## 六、后端服务设计

### 6.1 服务模块划分

```
services/
├── aiGeneration/
│   ├── taskService.js          # 任务管理服务
│   ├── materialParserService.js # 材料解析服务
│   ├── caseGeneratorService.js  # 用例生成服务
│   ├── dedupService.js          # 查重服务
│   ├── mergeService.js          # 合并服务
│   ├── configService.js         # 配置服务
│   ├── styleLearningService.js  # 风格学习服务
│   └── crossModuleService.js    # 跨模块学习服务
├── crawlers/
│   ├── webCrawlerService.js     # 网页爬虫服务
│   └── authCrawlerService.js    # 带认证的爬虫服务
├── parsers/
│   ├── excelParser.js           # Excel解析器
│   ├── wordParser.js            # Word解析器
│   ├── pdfParser.js             # PDF解析器
│   ├── imageParser.js           # 图片OCR解析器
│   ├── visioParser.js           # Visio解析器
│   └── drawioParser.js          # DrawIO解析器
└── queue/
    └── taskQueueService.js      # 任务队列服务
```

### 6.2 核心服务流程

#### 6.2.1 任务处理主流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        任务处理主流程                                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 任务初始化                                                        │
│    - 创建任务记录                                                    │
│    - 初始化进度状态                                                  │
│    - 加入任务队列                                                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. 材料解析阶段                                                      │
│    for each material:                                               │
│      - 判断材料类型                                                  │
│      - 调用对应解析器                                                │
│      - 提取文本内容                                                  │
│      - 更新解析状态                                                  │
│    合并所有材料内容为上下文                                          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. 学习阶段                                                          │
│    3.1 学习本模块用例风格                                            │
│        - 查询模块现有用例                                            │
│        - 提取用例风格特征                                            │
│        - 构建风格提示词                                              │
│                                                                     │
│    3.2 跨模块学习 (可选，根据策略)                                   │
│        - 查询关联模块                                                │
│        - 获取关联模块风格知识库                                      │
│        - 合并风格特征                                                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. AI生成阶段                                                        │
│    - 构建生成提示词                                                  │
│    - 调用AI模型API                                                   │
│    - 解析生成结果                                                    │
│    - 验证用例格式                                                    │
│    - 批量生成(分批处理)                                              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. 查重阶段 (可选)                                                   │
│    if (enableDedup):                                                │
│      for each generated case:                                       │
│        - 计算与现有用例的相似度                                      │
│        - 标记重复用例                                                │
│        - 记录重复来源                                                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. 保存阶段                                                          │
│    - 批量插入临时用例表                                              │
│    - 更新任务状态为完成                                              │
│    - 发送邮件通知                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 AI生成提示词模板设计

```
你是一个专业的测试用例设计专家。请根据以下材料生成测试用例。

## 输入材料
{materials_content}

## 现有用例风格参考 (可选)
{existing_cases_style}

## 输出要求
1. 严格按照以下JSON格式输出测试用例数组
2. 每个用例必须包含以下字段:
   - name: 用例名称 (简洁明确,不超过100字)
   - priority: 优先级 (高/中/低)
   - type: 用例类型 (功能测试/性能测试/压力测试/规格测试/异常测试)
   - precondition: 前置条件
   - purpose: 测试目的
   - steps: 测试步骤 (每步一行,编号格式如"1. xxx")
   - expected: 预期结果
   - key_config: 关键配置参数 (可选)
   - remark: 备注 (可选)

## 输出格式
```json
{
  "cases": [
    {
      "name": "用例名称",
      "priority": "高",
      "type": "功能测试",
      "precondition": "前置条件描述",
      "purpose": "测试目的描述",
      "steps": "1. 步骤1\n2. 步骤2\n3. 步骤3",
      "expected": "预期结果描述",
      "key_config": "关键配置",
      "remark": "备注信息"
    }
  ]
}
```

## 生成数量限制
最多生成 {case_count_limit} 个测试用例

## 注意事项
1. 用例名称要能体现测试点
2. 测试步骤要具体可执行
3. 预期结果要明确可验证
4. 考虑正常场景和异常场景
5. 参考现有用例的命名和描述风格
```

### 6.4 查重算法设计

采用**多维度相似度计算**方法：

```
相似度 = w1 × 名称相似度 + w2 × 内容相似度 + w3 × 步骤相似度

其中:
- 名称相似度: 使用编辑距离(Levenshtein)或TF-IDF余弦相似度
- 内容相似度: 使用预训练模型生成embedding，计算余弦相似度
- 步骤相似度: 分步骤比对，计算重叠率

权重配置:
- w1 = 0.3 (名称权重)
- w2 = 0.4 (内容权重)  
- w3 = 0.3 (步骤权重)

判定规则:
- 相似度 >= 阈值(默认80%): 标记为重复
- 相似度 < 阈值: 视为新用例
```

### 6.5 长文本处理：MySQL分块生成机制 (Map-Reduce)

处理几十页的PRD或大文件时，采用分块入库+Map-Reduce处理流，规避大模型Token溢出与幻觉问题。

#### 6.5.1 处理流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    长文本Map-Reduce处理流程                          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. 切分 (Chunking)                                                  │
│     - 解析器将Word/Excel解析为纯文本                                  │
│     - 按自然段或特定标识符切分成1000-2000字的块                       │
│     - 存入ai_material_chunks表                                       │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. 映射 (Map) - 并发处理各块                                        │
│     - 遍历pending状态的块                                            │
│     - 组装Prompt: 【全局模块背景】+【当前文本块内容】                 │
│     - 调用大模型生成测试用例                                         │
│     - 无脑写入temp_test_cases表                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. 归约 (Reduce) - 全局去重                                         │
│     - 所有块的用例都写入后                                           │
│     - 调用内存查重服务进行"临时表内部去重"                           │
│     - 标记重复用例                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 6.5.2 分块策略

```javascript
class ChunkService {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 2000;      // 每块字数
    this.overlap = options.overlap || 200;           // 块之间重叠字数
    this.minChunkSize = options.minChunkSize || 500; // 最小块大小
  }
  
  /**
   * 将长文本切分成块
   * @param {string} content - 原始文本内容
   * @param {number} materialId - 材料ID
   * @param {string} taskId - 任务ID
   */
  async chunkContent(content, materialId, taskId) {
    const chunks = [];
    let index = 0;
    let position = 0;
    
    while (position < content.length) {
      const endPosition = Math.min(position + this.chunkSize, content.length);
      let chunkContent = content.slice(position, endPosition);
      
      // 尝试在句子边界切分
      if (endPosition < content.length) {
        const lastPeriod = chunkContent.lastIndexOf('。');
        const lastNewline = chunkContent.lastIndexOf('\n');
        const breakPoint = Math.max(lastPeriod, lastNewline);
        
        if (breakPoint > this.minChunkSize) {
          chunkContent = chunkContent.slice(0, breakPoint + 1);
        }
      }
      
      chunks.push({
        material_id: materialId,
        task_id: taskId,
        chunk_index: index,
        chunk_content: chunkContent,
        token_count: this.estimateTokens(chunkContent),
        status: 'pending'
      });
      
      position += chunkContent.length - this.overlap;
      index++;
    }
    
    return chunks;
  }
  
  estimateTokens(text) {
    // 简单估算: 中文约1.5字符/token，英文约4字符/token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
}
```

#### 6.5.3 Map阶段提示词模板

```
你是一个专业的测试用例设计专家。请根据以下材料片段生成测试用例。

## 模块背景
{module_background}

## 当前材料片段 (第 {chunk_index}/{total_chunks} 块)
{chunk_content}

## 输出要求
1. 仅根据当前片段内容生成测试用例
2. 如果片段内容不足以生成完整用例，可以跳过
3. 严格按照JSON格式输出

## 输出格式
```json
{
  "cases": [
    {
      "name": "用例名称",
      "priority": "高/中/低",
      "type": "功能测试/性能测试/压力测试/规格测试/异常测试",
      "precondition": "前置条件",
      "purpose": "测试目的",
      "steps": "1. 步骤1\n2. 步骤2",
      "expected": "预期结果"
    }
  ]
}
```
```

---

## 七、跨模块学习优化设计

### 7.1 问题分析

学习其他模块的测试用例可以带来以下好处：
- 学习更丰富的测试风格和模式
- 发现跨模块的关联性测试点
- 提高生成用例的多样性

但同时也存在以下问题：
- 处理时间显著增加
- 可能引入不相关的风格
- 数据量过大导致性能下降

### 7.2 优化方案：智能跨模块学习策略

#### 7.2.1 三层学习架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                      三层学习架构                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  第一层: 本模块用例学习 (必选)                               │   │
│  │  - 学习目标模块现有用例                                      │   │
│  │  - 提取命名模式、步骤模式、优先级分布                        │   │
│  │  - 权重: 70%                                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  第二层: 关联模块学习 (智能推荐)                             │   │
│  │  - 自动识别相似模块                                          │   │
│  │  - 学习关联模块风格知识库                                    │   │
│  │  - 权重: 25%                                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  第三层: 全局风格知识库 (预计算)                             │   │
│  │  - 系统级风格摘要                                            │   │
│  │  - 通用测试模式                                              │   │
│  │  - 权重: 5%                                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.2.2 模块风格知识库预计算

**核心思想**：将学习过程前置，在后台定期预计算各模块的风格知识库，用户生成用例时直接使用预计算结果。

```
┌─────────────────────────────────────────────────────────────────────┐
│                    风格知识库预计算流程                              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  触发条件                                                            │
│  - 定时任务: 每天凌晨2点执行                                         │
│  - 事件触发: 模块用例数量变化超过10%                                  │
│  - 手动触发: 管理员手动刷新                                          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  计算内容                                                            │
│  1. 命名模式统计                                                     │
│     - 常见前缀/后缀                                                  │
│     - 命名长度分布                                                   │
│     - 关键词频率                                                     │
│                                                                     │
│  2. 步骤模式统计                                                     │
│     - 平均步骤数                                                     │
│     - 常用动词(配置、验证、检查、发送等)                             │
│     - 步骤结构模式                                                   │
│                                                                     │
│  3. 内容特征                                                         │
│     - 优先级分布                                                     │
│     - 类型分布                                                       │
│     - 平均用例长度                                                   │
│                                                                     │
│  4. 样本用例                                                         │
│     - 抽取代表性用例(不同类型各2-3个)                                │
│     - 总数控制在10个以内                                             │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  存储结构                                                            │
│  {                                                                   │
│    "moduleId": 4,                                                    │
│    "moduleName": "NetRx",                                            │
│    "styleVector": [0.2, 0.5, ...],  // 用于相似度计算               │
│    "styleSummary": "该模块用例命名规范，步骤清晰...",               │
│    "namingPatterns": {                                               │
│      "prefixes": ["NetRx", "Buffer", "调度"],                        │
│      "avgLength": 25                                                 │
│    },                                                                │
│    "stepPatterns": {                                                 │
│      "avgSteps": 4.2,                                                │
│      "commonVerbs": ["配置", "发送", "验证", "检查"],               │
│      "patterns": ["配置-执行-验证", "初始化-操作-检查"]             │
│    },                                                                │
│    "priorityDistribution": {"高": 0.3, "中": 0.5, "低": 0.2},       │
│    "typeDistribution": {"功能测试": 0.6, "性能测试": 0.3},          │
│    "sampleCases": [...]                                              │
│  }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.2.3 模块相似度计算与关联推荐

```
┌─────────────────────────────────────────────────────────────────────┐
│                    模块相似度计算                                    │
└─────────────────────────────────────────────────────────────────────┘

相似度计算维度:
┌─────────────────┬─────────────────────────────────────────────────┐
│ 维度            │ 计算方法                                         │
├─────────────────┼─────────────────────────────────────────────────┤
│ 名称相似度      │ 模块名称关键词重叠度                             │
│                 │ NetRx vs NetTx → 共同词"Net" → 相似度60%        │
├─────────────────┼─────────────────────────────────────────────────┤
│ 风格向量相似度  │ 风格向量的余弦相似度                             │
│                 │ 比较命名模式、步骤模式等的相似程度               │
├─────────────────┼─────────────────────────────────────────────────┤
│ 用例内容相似度  │ 抽样用例的embedding相似度                        │
│                 │ 比较测试内容的语义相似性                         │
├─────────────────┼─────────────────────────────────────────────────┤
│ 层级关系        │ 同一用例库下的模块优先级更高                     │
│                 │ 父子模块关系优先级更高                           │
└─────────────────┴─────────────────────────────────────────────────┘

关联推荐策略:
┌─────────────────────────────────────────────────────────────────────┐
│ 策略名称: smart (智能推荐)                                           │
│                                                                     │
│ 1. 计算目标模块与所有其他模块的相似度                                │
│ 2. 筛选相似度 >= 50% 的模块                                         │
│ 3. 按相似度排序，取Top 3                                            │
│ 4. 检查是否已存在关联关系，更新或创建                                │
│                                                                     │
│ 结果示例:                                                           │
│ NetRx模块的关联模块:                                                │
│ - NetTx (相似度: 75%) - 同类网络模块                                │
│ - Buffer管理 (相似度: 65%) - 功能相关                               │
│ - 调度算法 (相似度: 55%) - 测试模式相似                             │
└─────────────────────────────────────────────────────────────────────┘
```

#### 7.2.4 学习策略配置

```javascript
const crossModuleLearningStrategies = {
  // 策略1: 不学习其他模块 (最快)
  none: {
    enableCrossModuleLearning: false,
    description: '仅学习本模块用例，处理速度最快'
  },
  
  // 策略2: 智能推荐 (推荐)
  smart: {
    enableCrossModuleLearning: true,
    maxRelatedModules: 3,
    similarityThreshold: 0.5,
    usePrecomputedKnowledge: true,
    description: '自动识别相似模块，使用预计算知识库，平衡速度和质量'
  },
  
  // 策略3: 同库学习
  sameLibrary: {
    enableCrossModuleLearning: true,
    scope: 'library',
    maxRelatedModules: 5,
    usePrecomputedKnowledge: true,
    description: '学习同一用例库下的其他模块'
  },
  
  // 策略4: 手动选择
  manual: {
    enableCrossModuleLearning: true,
    allowUserSelect: true,
    usePrecomputedKnowledge: true,
    description: '用户手动选择要学习的模块'
  },
  
  // 策略5: 全面学习 (最慢)
  full: {
    enableCrossModuleLearning: true,
    scope: 'all',
    maxRelatedModules: 10,
    usePrecomputedKnowledge: false,
    description: '学习所有相关模块，质量最高但速度最慢'
  }
};
```

### 7.3 性能优化措施

#### 7.3.1 预计算 + 缓存

```
┌─────────────────────────────────────────────────────────────────────┐
│                      性能优化架构                                    │
└─────────────────────────────────────────────────────────────────────┘

时间对比:
┌──────────────────────┬────────────────┬────────────────┐
│ 场景                 │ 无优化         │ 优化后         │
├──────────────────────┼────────────────┼────────────────┤
│ 仅学习本模块         │ 2-3秒          │ 0.5秒(缓存)    │
├──────────────────────┼────────────────┼────────────────┤
│ 学习本模块+3个关联   │ 8-10秒         │ 1-2秒(预计算)  │
├──────────────────────┼────────────────┼────────────────┤
│ 学习全库模块         │ 30-60秒        │ 3-5秒(预计算)  │
└──────────────────────┴────────────────┴────────────────┘

缓存策略:
- 风格知识库缓存: 24小时有效
- 模块关联关系缓存: 7天有效
- 样本用例缓存: 按需加载
```

#### 7.3.2 异步预计算任务

```javascript
// 定时任务配置
const scheduledTasks = {
  // 每天凌晨2点刷新所有模块的风格知识库
  refreshStyleKnowledge: {
    cron: '0 2 * * *',
    task: async () => {
      const modules = await getAllModules();
      for (const module of modules) {
        await refreshModuleStyleKnowledge(module.id);
      }
    }
  },
  
  // 每周日凌晨3点重新计算模块关联关系
  refreshModuleRelations: {
    cron: '0 3 * * 0',
    task: async () => {
      await calculateAllModuleRelations();
    }
  }
};
```

### 7.4 用户配置界面

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚙️ 跨模块学习配置                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  学习策略: [智能推荐 ▼]                                             │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ○ 不学习其他模块 - 最快，仅学习本模块                        │   │
│  │ ● 智能推荐 - 推荐，自动识别相似模块                          │   │
│  │ ○ 同库学习 - 学习同一用例库下的模块                          │   │
│  │ ○ 手动选择 - 自己选择要学习的模块                            │   │
│  │ ○ 全面学习 - 最慢，学习所有相关模块                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  📊 推荐学习模块 (基于相似度分析)                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ☑ NetTx      相似度: 75%  (同类网络模块)                     │   │
│  │ ☑ Buffer管理  相似度: 65%  (功能相关)                        │   │
│  │ ☐ 调度算法    相似度: 55%  (测试模式相似)                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  💡 提示: 使用预计算的风格知识库，学习速度提升80%                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 八、文件解析器设计

### 8.1 解析器架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         材料解析器工厂                               │
│                                                                     │
│  ┌─────────────┐                                                   │
│  │ MaterialParserFactory                                           │
│  │ - getParser(fileType)                                           │
│  │ - parse(filePath, options)                                      │
│  └─────────────┘                                                   │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Parser Interface                          │   │
│  │  + parse(filePath: string): Promise<ParsedContent>           │   │
│  │  + extractText(content: any): string                         │   │
│  │  + validate(filePath: string): boolean                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                          │
│    ┌────┴────┬─────────┬─────────┬─────────┬─────────┐            │
│    ▼         ▼         ▼         ▼         ▼         ▼            │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │Excel │ │Word  │ │ PDF  │ │Image │ │Visio │ │DrawIO│            │
│ │Parser│ │Parser│ │Parser│ │Parser│ │Parser│ │Parser│            │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 各解析器技术选型

| 文件类型 | 解析库 | 输出格式 |
|---------|--------|----------|
| Excel (.xlsx/.xls) | xlsx (已集成) | 表格文本 |
| Word (.docx) | mammoth | 结构化文本 |
| PDF | pdf-parse | 纯文本 |
| 图片 | tesseract.js (OCR) | 识别文本 |
| Visio (.vsdx) | unzip + xml解析 | 流程图文本 |
| DrawIO (.drawio) | xml2js | 流程图文本 |

### 8.3 网页爬虫设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                         网页爬虫服务                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│    简单爬虫 (无需认证)     │   │    认证爬虫 (需登录)      │
│  - puppeteer              │   │  - puppeteer + stealth    │
│  - cheerio (HTML解析)     │   │  - 支持表单登录           │
│  - 提取正文内容           │   │  - 支持Cookie维持         │
└───────────────────────────┘   └───────────────────────────┘
                │                               │
                └───────────────┬───────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      内容提取与清洗                                  │
│  - 移除导航栏、广告、脚本等噪音                                     │
│  - 提取主要文本内容                                                 │
│  - 保留表格结构                                                     │
│  - 输出Markdown格式                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 九、安全设计

### 9.1 权限控制

| 操作 | 所需权限 |
|------|----------|
| 创建生成任务 | 普通用户 |
| 查看自己的任务 | 普通用户 |
| 查看所有任务 | 管理员 |
| 编辑临时用例 | 任务创建者 |
| 合并用例到正式库 | 任务创建者 |
| 配置AI生成参数 | 管理员 |
| 刷新风格知识库 | 管理员 |
| 管理模块关联关系 | 管理员 |

### 9.2 数据安全

1. **敏感信息加密**
   - 网页密码使用AES-256加密存储
   - API Key使用现有加密服务

2. **文件上传安全**
   - 文件类型白名单校验
   - 文件大小限制 (20MB)
   - 文件内容扫描 (防病毒)
   - 随机文件名存储

3. **SQL注入防护**
   - 使用参数化查询
   - 复用现有SQL安全验证器

### 9.3 速率限制

```javascript
const rateLimitConfig = {
  createTask: {
    windowMs: 60 * 60 * 1000,  // 1小时
    max: 10,                    // 最多10个任务
    message: '每小时最多创建10个生成任务'
  },
  uploadMaterial: {
    windowMs: 60 * 1000,        // 1分钟
    max: 20,                    // 最多20个文件
    message: '每分钟最多上传20个文件'
  }
};
```

---

## 十、性能优化设计

### 10.1 异步任务队列（去Redis化设计）

采用**MySQL状态机 + Node.js内存队列(p-queue)**方案，无需Redis：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    极简任务队列架构                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                                                   │
│  │  用户请求   │                                                   │
│  └──────┬──────┘                                                   │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  API层: 插入任务记录到MySQL                                  │   │
│  │  INSERT INTO ai_case_generation_tasks (status='pending')    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  后台轮询服务 (node-cron定时触发)                            │   │
│  │  SELECT * FROM tasks WHERE status='pending' LIMIT 1         │   │
│  │  UPDATE status='processing' WHERE task_id=xxx               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  p-queue 并发控制                                             │   │
│  │  - 控制同时处理的任务数 (TASK_PROCESSING_CONCURRENCY)        │   │
│  │  - 控制大模型API并发数 (CHUNK_API_CONCURRENCY)               │   │
│  │  - 避免触发外部AI厂商的Rate Limit                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  处理完成: UPDATE status='completed'                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 10.1.1 队列容灾机制

如果Node.js进程意外重启，服务启动时自动恢复中断的任务：

```javascript
// 服务启动时执行
async function recoverInterruptedTasks() {
  const sql = `
    UPDATE ai_case_generation_tasks 
    SET status = 'pending' 
    WHERE status = 'processing'
  `;
  await pool.execute(sql);
  console.log('已恢复中断的任务到pending状态');
}
```

#### 10.1.2 p-queue并发控制实现

```javascript
const PQueue = require('p-queue');

// 任务级并发控制 (同时处理几个生成任务)
const taskQueue = new PQueue({ concurrency: 2 });

// API调用级并发控制 (同时发几个请求给大模型)
const apiQueue = new PQueue({ concurrency: 4 });

// 使用示例
async function processTask(taskId) {
  await taskQueue.add(async () => {
    // 更新状态为processing
    await updateTaskStatus(taskId, 'processing');
    
    // 处理材料分块
    const chunks = await getChunks(taskId);
    
    for (const chunk of chunks) {
      await apiQueue.add(async () => {
        // 调用大模型生成用例
        const cases = await generateCases(chunk);
        await saveTempCases(cases);
      });
    }
    
    // 更新状态为completed
    await updateTaskStatus(taskId, 'completed');
  });
}
```

### 10.2 缓存策略

| 缓存内容 | 缓存时长 | 缓存位置 |
|---------|---------|---------|
| AI模型配置 | 1小时 | 内存 |
| 模块现有用例 | 10分钟 | 内存 |
| 解析后的材料内容 | 任务期间 | 内存 |
| 用户权限信息 | 30分钟 | 内存 |
| 模块风格知识库 | 24小时 | 内存+数据库 |
| 模块关联关系 | 7天 | 内存+数据库 |

### 10.3 批量操作优化

1. **批量插入临时用例**: 使用批量INSERT语句
2. **查重计算**: 使用Node.js内存计算余弦相似度（见10.4节）
3. **邮件发送**: 异步批量发送

### 10.4 内存查重服务设计（替代向量数据库）

针对业务初期十万级以下的用例查重，采用**Node.js内存计算**方案，无需向量数据库：

#### 10.4.1 余弦相似度核心算法

```javascript
/**
 * 计算两个向量的余弦相似度 (Cosine Similarity)
 * @param {number[]} vecA - 向量A (如大模型生成的embedding，维度固定如1536)
 * @param {number[]} vecB - 向量B
 * @returns {number} 相似度得分 (0~1)
 */
function calculateCosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

#### 10.4.2 查重服务执行流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    内存查重服务执行流程                              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. 预加载阶段                                                       │
│     - 从MySQL一次性查出目标模块所有正式用例                           │
│     - 加载ID、Name、以及JSON字段中的Embedding向量                    │
│     - 存入Node.js内存数组                                            │
│     - 性能评估: 10,000条数据占用内存不足20MB                         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. 双重循环比对                                                     │
│     - 遍历temp_test_cases中新生成的用例                              │
│     - 分别与内存中的已有用例进行余弦相似度计算                        │
│     - 性能评估: 10,000次1536维度的余弦计算，耗时约10-30ms            │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. 打标回写                                                         │
│     - 将duplicate_score大于阈值的临时用例标记is_duplicate=1          │
│     - 批量更新回MySQL                                                │
│     - 立即释放内存数组引用，由Node.js GC自动清理                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 10.4.3 查重服务实现

```javascript
class DedupService {
  constructor(pool, threshold = 0.85) {
    this.pool = pool;
    this.threshold = threshold;
  }
  
  /**
   * 执行查重
   * @param {number} moduleId - 目标模块ID
   * @param {Array} newCases - 新生成的用例数组
   */
  async deduplicate(moduleId, newCases) {
    // 1. 预加载已有用例的向量
    const existingCases = await this.loadExistingCaseVectors(moduleId);
    
    // 2. 为新用例生成embedding
    const newCaseEmbeddings = await this.generateEmbeddings(newCases);
    
    // 3. 双重循环比对
    const results = [];
    for (const newCase of newCaseEmbeddings) {
      let maxSimilarity = 0;
      let duplicateWith = null;
      
      for (const existing of existingCases) {
        const similarity = calculateCosineSimilarity(
          newCase.embedding,
          existing.embedding
        );
        
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          duplicateWith = existing.caseId;
        }
      }
      
      results.push({
        tempCaseId: newCase.tempCaseId,
        isDuplicate: maxSimilarity >= this.threshold,
        duplicateScore: Math.round(maxSimilarity * 100),
        duplicateWithCaseId: duplicateWith
      });
    }
    
    // 4. 批量更新
    await this.updateDuplicateFlags(results);
    
    return results;
  }
  
  async loadExistingCaseVectors(moduleId) {
    const [rows] = await this.pool.execute(`
      SELECT ce.case_id, ce.name_embedding, ce.content_embedding
      FROM case_embedding_index ce
      JOIN test_cases tc ON ce.case_id = tc.id
      WHERE tc.module_id = ? AND ce.case_type = 'formal'
    `, [moduleId]);
    
    return rows.map(row => ({
      caseId: row.case_id,
      embedding: JSON.parse(row.content_embedding || '[]')
    }));
  }
}
```

#### 10.4.4 性能基准

| 数据规模 | 内存占用 | 计算耗时 |
|---------|---------|---------|
| 1,000条用例 | ~2MB | ~3ms |
| 5,000条用例 | ~10MB | ~15ms |
| 10,000条用例 | ~20MB | ~30ms |
| 50,000条用例 | ~100MB | ~150ms |

**结论**: 对于十万级以下用例，Node.js内存计算完全满足性能需求，无需引入向量数据库。

---

## 十一、扩展性设计

### 11.1 AI模型可扩展

支持动态添加新的AI模型：

```javascript
const aiModelRegistry = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    formatRequest: (prompt, config) => ({...}),
    parseResponse: (response) => ({...})
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    formatRequest: (prompt, config) => ({...}),
    parseResponse: (response) => ({...})
  },
  // 可扩展添加更多模型
};
```

### 11.2 解析器可扩展

支持插件式添加新的文件解析器：

```javascript
class ParserPlugin {
  constructor(fileExtension, parserImpl) {
    this.extension = fileExtension;
    this.parser = parserImpl;
  }
  
  register() {
    MaterialParserFactory.register(this.extension, this.parser);
  }
}
```

### 11.3 查重算法可配置

支持配置不同的查重算法：

```javascript
const dedupStrategies = {
  simple: new SimpleTextSimilarity(),      // 简单文本相似度
  tfidf: new TFIDFSimilarity(),            // TF-IDF
  embedding: new EmbeddingSimilarity(),    // 向量嵌入
  hybrid: new HybridSimilarity()           // 混合策略
};
```

---

## 十二、部署方案

### 12.1 依赖新增（极简版）

```json
{
  "dependencies": {
    "mammoth": "^1.6.0",
    "pdf-parse": "^1.1.1",
    "tesseract.js": "^5.0.0",
    "puppeteer": "^21.0.0",
    "cheerio": "^1.0.0",
    "p-queue": "^7.3.4",
    "uuid": "^9.0.0",
    "node-cron": "^3.0.0"
  }
}
```

**依赖说明**：

| 依赖包 | 用途 | 备注 |
|--------|------|------|
| mammoth | Word文档解析 | 解析.docx文件 |
| pdf-parse | PDF解析 | 提取PDF文本 |
| tesseract.js | 图片OCR | 识别图片中的文字 |
| puppeteer | 网页爬虫 | 爬取网页内容 |
| cheerio | HTML解析 | 配合puppeteer使用 |
| **p-queue** | 并发控制 | 替代bull，轻量级队列 |
| uuid | ID生成 | 生成唯一标识 |
| node-cron | 定时任务 | 预计算任务调度 |

**已移除的依赖**：
- ~~bull~~ (用p-queue替代)
- ~~redis~~ (无需Redis)

### 12.2 环境变量配置

```env
# AI生成相关
AI_GENERATION_ENABLED=true
AI_GENERATION_MAX_CASES=50
AI_GENERATION_TIMEOUT=300000

# 文件解析相关
MAX_FILE_SIZE=20971520
UPLOAD_DIR=./uploads/materials

# 并发控制 (极简队列核心配置)
TASK_PROCESSING_CONCURRENCY=2
CHUNK_API_CONCURRENCY=4
SIMILARITY_THRESHOLD=0.85

# 网页爬虫相关
CRAWLER_TIMEOUT=30000
CRAWLER_USER_AGENT=xTest-Bot/1.0

# 风格知识库相关
STYLE_KNOWLEDGE_CACHE_TTL=86400
MODULE_RELATION_CACHE_TTL=604800

# 长文本分块配置
CHUNK_SIZE=2000
CHUNK_OVERLAP=200
```

### 12.3 数据库迁移

```sql
-- 执行顺序
1. migrations/create_ai_generation_tables.sql
2. migrations/create_style_knowledge_tables.sql
3. migrations/insert_default_ai_config.sql
4. migrations/create_indexes.sql
```

---

## 十三、总结

本设计方案完整覆盖了AI自动生成测试用例系统的核心功能：

1. **材料管理**: 支持多种格式文件上传和网页链接爬取
2. **智能生成**: 基于AI Skills + 大模型生成标准化测试用例
3. **学习与查重**: 学习现有用例风格，自动查重过滤
4. **跨模块学习**: 智能识别关联模块，预计算风格知识库，平衡速度与质量
5. **安全可控**: 临时用例机制，用户确认后生效
6. **异步处理**: 后台任务队列，邮件通知
7. **可扩展性**: 支持插件式扩展AI模型和解析器

### 极简架构优势

本系统采用**极简架构**设计，相比传统方案具有以下优势：

| 对比项 | 传统方案 | 极简方案 | 优势 |
|--------|---------|---------|------|
| 任务队列 | Redis + Bull | MySQL + p-queue | 无需额外部署Redis，降低运维成本 |
| 查重服务 | 向量数据库 | Node.js内存计算 | 简化技术栈，十万级数据性能足够 |
| 长文本处理 | RAG架构 | MySQL分块+Map-Reduce | 规避Token溢出，实现简单 |
| 基础设施 | MySQL + Redis + 向量库 | 仅MySQL | 部署简单，维护成本低 |

该设计充分利用了现有系统的AI能力（ai_skills、ai_models表）和邮件通知功能，与现有架构无缝集成。通过预计算风格知识库和智能模块关联推荐，有效解决了跨模块学习带来的性能问题。
