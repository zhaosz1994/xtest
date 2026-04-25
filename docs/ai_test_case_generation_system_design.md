# xTest AI测试用例生成系统 - 系统设计报告

> **文档版本**: v1.0  
> **编写日期**: 2026-04-25  
> **适用范围**: xTest测试管理平台核心功能模块

---

## 一、系统概述

### 1.1 项目背景

xTest是一个专业的测试管理平台，核心资产是测试用例信息。随着AI技术的发展，本系统旨在实现测试用例的智能化自动生成，通过已封装好的底层大模型API，根据用户提供的测试材料（如PRD文档、Excel需求表），自动生成标准化、可落地的测试用例。

### 1.2 核心目标

| 目标 | 描述 |
|------|------|
| **资产前置化** | 用户可在模块专属「知识库」中上传和管理需求文件，形成可复用的测试资产 |
| **异步解析** | 文件上传后立即后台异步解析，切块存储，不阻塞用户操作 |
| **智能生成** | 基于知识库材料，分批调用大模型生成标准化测试用例 |
| **安全落地** | 生成用例进入临时表，经查重标记后由用户确认，再合并到正式库 |

### 1.3 核心业务闭环

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           核心业务闭环                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐     │
│    │ 资产前置 │─────▶│ 异步解析 │─────▶│ AI生成   │─────▶│ 安全落地 │     │
│    │ (知识库) │      │ (分块)   │      │ (用例)   │      │ (确认)   │     │
│    └──────────┘      └──────────┘      └──────────┘      └──────────┘     │
│         │                                                      │          │
│         │                                                      ▼          │
│         │                                              ┌──────────────┐  │
│         │                                              │ 临时用例表   │  │
│         │                                              │ (查重标记)   │  │
│         │                                              └──────┬───────┘  │
│         │                                                     │          │
│         │                                                     ▼          │
│         │                                              ┌──────────────┐  │
│         │                                              │ 用户确认     │  │
│         │                                              │ (编辑/删除)  │  │
│         │                                              └──────┬───────┘  │
│         │                                                     │          │
│         │                                                     ▼          │
│         │                                              ┌──────────────┐  │
│         └─────────────────────────────────────────────▶ │ 正式用例库   │  │
│                                                        └──────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 技术栈与架构约束

#### 1.4.1 技术栈

| 层级 | 技术选型 | 版本要求 |
|------|----------|----------|
| 运行时 | Node.js | >= 18.x |
| 后端框架 | Express | 4.x |
| 数据库 | MySQL | 8.0+ |
| 前端 | 原生JavaScript + 模块化架构 | - |
| AI能力 | 已封装的大模型API（DeepSeek/OpenAI/智谱AI） | - |

#### 1.4.2 极简架构"三不"原则

本系统采用**极简实用主义架构**，严格遵循以下约束：

| 约束 | 传统方案 | 替代方案 | 收益 |
|------|----------|----------|------|
| **不引入Redis和重型MQ** | Redis + Bull/Kafka | MySQL状态机 + p-queue | 无需额外部署中间件，降低运维成本 |
| **不引入向量数据库** | Milvus/Chroma/Pinecone | Node.js内存余弦相似度计算 | 简化技术栈，十万级数据性能足够 |
| **不使用复杂RAG架构** | LangChain + 向量检索 | MySQL分块存储 + Map-Reduce | 规避Token溢出，实现简单可控 |

#### 1.4.3 架构对比图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        架构方案对比                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  传统方案 (本系统不采用):                                                    │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐                    │
│  │  Redis  │   │ 向量库  │   │   RAG   │   │  MQ     │                    │
│  │(任务队列)│   │(查重索引)│   │(长文本) │   │(消息队列)│                    │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘                    │
│       ↓             ↓             ↓             ↓                          │
│  需要额外部署    需要额外部署    架构复杂      需要额外部署                   │
│  运维成本高      运维成本高    调试困难      运维成本高                      │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  极简方案 (本系统采用):                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         MySQL 8.0                                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │   │
│  │  │ 任务状态机   │  │ 文本分块存储 │  │ 向量JSON存储│                 │   │
│  │  │ (替代Redis) │  │ (替代RAG)   │  │ (替代向量库)│                 │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              +                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       Node.js Runtime                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │   │
│  │  │ p-queue     │  │ 内存查重    │  │ Map-Reduce  │                 │   │
│  │  │ (并发控制)  │  │ (余弦相似度)│  │ (分批处理)  │                 │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  优势: 仅依赖MySQL + Node.js，部署简单，运维成本极低                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、系统架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端展示层                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  知识库管理 │  │  任务中心   │  │  用例预览   │  │  用例确认   │       │
│  │  (VFS)     │  │  (进度)     │  │  (临时表)   │  │  (合并)     │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API网关层                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  认证中间件 │ 权限校验 │ 请求限流(p-queue) │ 日志记录               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              业务服务层                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │ VFS服务      │ │ 文件解析服务 │ │ AI生成服务   │ │ 查重服务     │      │
│  │ (虚拟文件系统)│ │ (Chunking)   │ │ (Map-Reduce) │ │ (内存计算)   │      │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                       │
│  │ 任务队列服务 │ │ 邮件通知服务 │ │ 合并服务     │                       │
│  │ (MySQL状态机)│ │ (nodemailer) │ │ (Temp→正式)  │                       │
│  └──────────────┘ └──────────────┘ └──────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              数据存储层                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         MySQL 8.0                                    │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐       │  │
│  │  │ 业务数据   │ │ 文件元数据 │ │ 文本分块   │ │ 向量索引   │       │  │
│  │  │ (用例/模块)│ │ (VFS)      │ │ (Chunks)   │ │ (JSON)     │       │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         文件存储                                      │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  /uploads/knowledge/{module_id}/{uuid}.{ext}                   │  │  │
│  │  │  (物理层扁平化存储，通过数据库构建逻辑目录树)                    │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           完整业务流程                                       │
└─────────────────────────────────────────────────────────────────────────────┘

阶段一: 资产前置 (知识库管理)
─────────────────────────────────────────────────────────────────────────────
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 用户    │───▶│ 打开知识│───▶│ 创建目录│───▶│ 上传文件│───▶│ 异步解析│
│         │    │ 库      │    │ (可选)  │    │         │    │ 后台    │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
                                                              │
                                                              ▼
                                                       ┌─────────────┐
                                                       │ 文本切分    │
                                                       │ 存入Chunks  │
                                                       └─────────────┘

阶段二: AI生成测试用例
─────────────────────────────────────────────────────────────────────────────
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 用户    │───▶│ 选择知识│───▶│ 发起生成│───▶│ 任务入队│───▶│ 后台处理│
│         │    │ 库文件  │    │ 任务    │    │ (MySQL) │    │ (p-queue)│
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Map-Reduce处理流程                                 │
│                                                                             │
│  ┌─────────────┐                                                           │
│  │ 1. Map阶段  │  拉取Chunks → 分批调用AI → 写入Temp表                     │
│  └─────────────┘                                                           │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────┐                                                           │
│  │ 2. Reduce   │  内存查重 → 标记重复 → 更新duplicate_score               │
│  │    阶段     │                                                           │
│  └─────────────┘                                                           │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────┐                                                           │
│  │ 3. 通知     │  邮件通知用户 → 任务完成                                  │
│  └─────────────┘                                                           │
└─────────────────────────────────────────────────────────────────────────────┘

阶段三: 安全落地闭环
─────────────────────────────────────────────────────────────────────────────
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 邮件通知│───▶│ 用户登录│───▶│ 预览临时│───▶│ 编辑/确认│───▶│ 合并到  │
│         │    │         │    │ 用例    │    │ /删除   │    │ 正式库  │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
```

### 2.3 数据流转图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           数据流转全景                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐                                           ┌──────────────────┐
│ 用户上传文件     │                                           │ 用户从知识库     │
│ (PRD/Excel/PDF) │                                           │ 选择已有文件     │
└────────┬─────────┘                                           └────────┬─────────┘
         │                                                              │
         │                                                              │
         ▼                                                              │
┌──────────────────┐     ┌──────────────────┐                          │
│ module_knowledge │────▶│ 物理文件存储     │                          │
│ _files (元数据)  │     │ /uploads/...     │                          │
└────────┬─────────┘     └──────────────────┘                          │
         │                                                              │
         │ 异步解析                                                     │
         ▼                                                              │
┌──────────────────┐                                                    │
│ ai_material_     │◀───────────────────────────────────────────────────┘
│ chunks (分块)    │           直接使用已有分块
└────────┬─────────┘
         │
         │ 用户发起生成任务 (选择文件/分块)
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           任务创建                                        │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 1. 用户选择知识库中的文件 (可多选)                                  │ │
│  │ 2. 系统检查文件解析状态 (已解析/解析中/未解析)                      │ │
│  │ 3. 创建任务记录 (status='pending')                                 │ │
│  │ 4. 任务入队等待处理                                                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
         │
         │ Map阶段: 分批调用AI
         ▼
┌──────────────────┐
│ temp_test_cases  │
│ (临时用例表)     │
└────────┬─────────┘
         │
         │ Reduce阶段: 内存查重
         ▼
┌──────────────────┐     ┌──────────────────┐
│ 更新duplicate_   │────▶│ 用户确认         │
│ score/标记       │     │ (编辑/删除)      │
└──────────────────┘     └────────┬─────────┘
                                  │
                                  │ 合并
                                  ▼
                         ┌──────────────────┐
                         │ test_cases       │
                         │ (正式用例表)     │
                         └──────────────────┘
```

**数据流转说明**：

| 入口 | 流程 | 说明 |
|------|------|------|
| **上传新文件** | 上传 → 异步解析 → 分块存储 → 等待用户选择 | 文件上传后立即后台解析，不阻塞用户 |
| **选择已有文件** | 知识库选择 → 检查解析状态 → 直接使用分块 | 复用已解析的文件，无需重复处理 |
| **混合选择** | 新上传 + 已有文件 → 统一处理 | 支持同时选择新文件和已有文件 |

---

## 三、数据库设计

### 3.1 数据表总览

| 表名 | 用途 | 核心职责 |
|------|------|----------|
| `module_knowledge_files` | 虚拟文件系统 | 存储文件夹/文件的元数据，构建逻辑目录树 |
| `ai_material_chunks` | 文本分块存储 | 存储解析后的文本块，支持Map-Reduce处理 |
| `ai_case_generation_tasks` | 任务管理 | 记录生成任务的状态、进度，作为状态机核心 |
| `temp_test_cases` | 临时用例表 | 安全隔离，存储待确认的用例，包含查重标记 |
| `case_embedding_index` | 向量索引 | 存储用例的embedding向量(JSON格式) |

### 3.2 虚拟文件系统表 (module_knowledge_files)

```sql
CREATE TABLE `module_knowledge_files` (
  `id` int NOT NULL AUTO_INCREMENT,
  `module_id` int NOT NULL COMMENT '所属模块ID',
  `parent_id` int DEFAULT NULL COMMENT '父目录ID，NULL表示根目录',
  `name` varchar(255) NOT NULL COMMENT '文件/文件夹名称',
  `type` enum('folder','file') NOT NULL DEFAULT 'folder' COMMENT '类型: folder-文件夹, file-文件',
  
  -- 文件特有字段
  `file_path` varchar(500) DEFAULT NULL COMMENT '物理存储路径(相对路径)',
  `file_size` bigint DEFAULT NULL COMMENT '文件大小(字节)',
  `file_ext` varchar(20) DEFAULT NULL COMMENT '文件扩展名',
  `mime_type` varchar(100) DEFAULT NULL COMMENT 'MIME类型',
  
  -- 解析状态
  `parse_status` enum('pending','parsing','parsed','failed') DEFAULT 'pending' COMMENT '解析状态',
  `parse_error` text COMMENT '解析错误信息',
  `parsed_at` timestamp NULL DEFAULT NULL COMMENT '解析完成时间',
  
  -- 统计信息
  `chunk_count` int DEFAULT 0 COMMENT '切分后的文本块数量',
  `total_tokens` int DEFAULT 0 COMMENT '预估总Token数',
  
  -- 元数据
  `description` varchar(500) DEFAULT NULL COMMENT '文件描述',
  `tags` json DEFAULT NULL COMMENT '标签(JSON数组)',
  `is_enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `sort_order` int DEFAULT 0 COMMENT '排序序号',
  
  -- 审计字段
  `created_by` varchar(50) DEFAULT NULL COMMENT '创建人',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT '软删除时间',
  
  PRIMARY KEY (`id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_type` (`type`),
  KEY `idx_parse_status` (`parse_status`),
  KEY `idx_deleted_at` (`deleted_at`),
  
  CONSTRAINT `fk_knowledge_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_knowledge_parent` FOREIGN KEY (`parent_id`) REFERENCES `module_knowledge_files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模块知识库文件表(VFS)';
```

**设计要点**：
- 采用**邻接表模型**构建树状目录，`parent_id`指向父目录
- 物理存储扁平化，逻辑层级通过数据库关系维护
- 支持软删除，`deleted_at`非空表示已删除
- 解析状态独立管理，支持异步处理

### 3.3 文本分块存储表 (ai_material_chunks)

```sql
CREATE TABLE `ai_material_chunks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `file_id` int NOT NULL COMMENT '关联的文件ID',
  `module_id` int NOT NULL COMMENT '所属模块ID(冗余，便于查询)',
  `chunk_index` int NOT NULL COMMENT '块的顺序索引(从0开始)',
  `chunk_content` text NOT NULL COMMENT '文本片段内容',
  
  -- Token估算
  `token_count` int DEFAULT 0 COMMENT '预估Token数',
  `char_count` int DEFAULT 0 COMMENT '字符数',
  
  -- 处理状态
  `status` enum('pending','processing','completed','failed') DEFAULT 'pending' COMMENT '处理状态',
  `retry_count` int DEFAULT 0 COMMENT '重试次数',
  `error_message` text COMMENT '错误信息',
  
  -- 生成统计
  `generated_cases` int DEFAULT 0 COMMENT '该块生成的用例数',
  `processed_at` timestamp NULL DEFAULT NULL COMMENT '处理完成时间',
  
  -- 元数据
  `metadata` json DEFAULT NULL COMMENT '扩展元数据(如章节标题、页码等)',
  
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_file_chunk` (`file_id`, `chunk_index`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_status` (`status`),
  
  CONSTRAINT `fk_chunk_file` FOREIGN KEY (`file_id`) REFERENCES `module_knowledge_files` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chunk_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI材料分块处理表';
```

**设计要点**：
- 文本块按`chunk_index`有序存储，保证顺序性
- 冗余`module_id`便于按模块批量查询
- 支持重试机制，`retry_count`记录重试次数
- `metadata`字段存储扩展信息，如章节标题、页码等

### 3.4 任务管理表 (ai_case_generation_tasks)

```sql
CREATE TABLE `ai_case_generation_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '任务唯一标识(业务ID)',
  `module_id` int NOT NULL COMMENT '目标模块ID',
  `library_id` int DEFAULT NULL COMMENT '用例库ID',
  `user_id` int NOT NULL COMMENT '发起任务的用户ID',
  
  -- 状态机核心字段
  `status` enum('pending','processing','completed','failed','cancelled') DEFAULT 'pending' COMMENT '任务状态',
  `stage` enum('init','chunking','mapping','reducing','finished') DEFAULT 'init' COMMENT '当前处理阶段',
  
  -- 进度信息
  `progress` int DEFAULT 0 COMMENT '进度百分比(0-100)',
  `progress_message` varchar(500) DEFAULT NULL COMMENT '进度描述信息',
  
  -- 统计信息
  `total_chunks` int DEFAULT 0 COMMENT '待处理的文本块总数',
  `processed_chunks` int DEFAULT 0 COMMENT '已处理的文本块数',
  `total_cases` int DEFAULT 0 COMMENT '生成的用例总数',
  `duplicate_count` int DEFAULT 0 COMMENT '查重过滤的数量',
  `approved_count` int DEFAULT 0 COMMENT '用户批准的数量',
  
  -- 配置信息
  `config` json DEFAULT NULL COMMENT '生成配置(JSON格式)',
  `selected_files` json DEFAULT NULL COMMENT '选中的文件ID列表',
  
  -- 错误处理
  `error_message` text COMMENT '错误信息',
  `error_stack` text COMMENT '错误堆栈',
  
  -- 时间戳
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始处理时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `expires_at` timestamp NULL DEFAULT NULL COMMENT '临时用例过期时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_id` (`task_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_expires_at` (`expires_at`),
  
  CONSTRAINT `fk_task_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_task_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI测试用例生成任务表';
```

**设计要点**：
- **状态机核心**：`status`字段作为任务队列的驱动
- `stage`字段细化处理阶段，便于前端展示进度
- 支持任务过期机制，`expires_at`控制临时用例生命周期
- 配置信息JSON化存储，灵活扩展

### 3.5 临时用例表 (temp_test_cases)

```sql
CREATE TABLE `temp_test_cases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `temp_case_id` varchar(50) NOT NULL COMMENT '临时用例唯一标识',
  `task_id` varchar(50) NOT NULL COMMENT '关联的任务ID',
  `module_id` int NOT NULL COMMENT '模块ID',
  `chunk_id` int DEFAULT NULL COMMENT '来源文本块ID',
  
  -- 一级测试点关联 (重要)
  `level1_id` int DEFAULT NULL COMMENT '关联的一级测试点ID',
  `level1_name` varchar(100) DEFAULT NULL COMMENT '一级测试点名称(冗余，便于展示)',
  `is_new_level1` tinyint(1) DEFAULT 0 COMMENT '是否为新生成的一级测试点',
  
  -- 用例核心字段 (与正式表结构一致)
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
  
  -- 扩展属性 (JSON字段)
  `environments` json DEFAULT NULL COMMENT '测试环境(JSON数组)',
  `test_types` json DEFAULT NULL COMMENT '测试类型(JSON数组)',
  `sources` json DEFAULT NULL COMMENT '用例来源(JSON数组)',
  `phases` json DEFAULT NULL COMMENT '测试阶段(JSON数组)',
  `methods` json DEFAULT NULL COMMENT '测试方法(JSON数组)',
  
  -- 查重相关字段 (核心)
  `duplicate_score` decimal(5,2) DEFAULT NULL COMMENT '查重相似度分数(0-100)',
  `duplicate_with_case_id` int DEFAULT NULL COMMENT '重复的正式用例ID',
  `duplicate_with_temp_id` int DEFAULT NULL COMMENT '重复的临时用例ID',
  `is_duplicate` tinyint(1) DEFAULT 0 COMMENT '是否被标记为重复',
  
  -- 用户确认状态
  `user_modified` tinyint(1) DEFAULT 0 COMMENT '用户是否已修改',
  `status` enum('pending','approved','rejected','merged') DEFAULT 'pending' COMMENT '确认状态',
  
  -- 合并信息
  `merged_case_id` int DEFAULT NULL COMMENT '合并后的正式用例ID',
  `merged_at` timestamp NULL DEFAULT NULL COMMENT '合并时间',
  
  -- 审计字段
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_temp_case_id` (`temp_case_id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_level1_id` (`level1_id`),
  KEY `idx_status` (`status`),
  KEY `idx_is_duplicate` (`is_duplicate`),
  KEY `idx_duplicate_score` (`duplicate_score`),
  
  CONSTRAINT `fk_temp_task` FOREIGN KEY (`task_id`) REFERENCES `ai_case_generation_tasks` (`task_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_temp_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_temp_level1` FOREIGN KEY (`level1_id`) REFERENCES `level1_points` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临时测试用例表';
```

**设计要点**：
- 增加 `level1_id` 字段关联一级测试点
- 增加 `level1_name` 冗余字段便于展示
- 增加 `is_new_level1` 标记是否为新生成的测试点

### 3.6 临时一级测试点表 (temp_level1_points)

用于存储AI生成的一级测试点，用户确认后再合并到正式表：

```sql
CREATE TABLE `temp_level1_points` (
  `id` int NOT NULL AUTO_INCREMENT,
  `temp_level1_id` varchar(50) NOT NULL COMMENT '临时一级测试点唯一标识',
  `task_id` varchar(50) NOT NULL COMMENT '关联的任务ID',
  `module_id` int NOT NULL COMMENT '模块ID',
  `name` varchar(100) NOT NULL COMMENT '一级测试点名称',
  `test_type` varchar(50) DEFAULT '功能测试' COMMENT '测试类型',
  `description` text COMMENT '测试点描述',
  `order_index` int DEFAULT 0 COMMENT '排序序号',
  `case_count` int DEFAULT 0 COMMENT '关联的用例数量',
  `status` enum('pending','approved','rejected','merged') DEFAULT 'pending' COMMENT '确认状态',
  `merged_level1_id` int DEFAULT NULL COMMENT '合并后的一级测试点ID',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_temp_level1_id` (`temp_level1_id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_status` (`status`),
  
  CONSTRAINT `fk_temp_level1_task` FOREIGN KEY (`task_id`) REFERENCES `ai_case_generation_tasks` (`task_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_temp_level1_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临时一级测试点表';
```

### 3.7 数据层级关系图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         数据层级关系                                         │
└─────────────────────────────────────────────────────────────────────────────┘

正式表层级结构:
─────────────────────────────────────────────────────────────────────
┌──────────────┐
│case_libraries│ 用例库
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────┐
│   modules    │ 模块
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────┐
│ level1_points│ 一级测试点
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────┐     ┌──────────────┐
│  test_cases  │────▶│test_case_    │ (多对多)
│              │     │projects      │
└──────────────┘     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  projects    │ 项目
                     └──────────────┘

临时表层级结构 (AI生成):
─────────────────────────────────────────────────────────────────────
┌──────────────────┐
│ ai_case_generation│ 生成任务
│ _tasks            │
│ (含library_id,    │
│  module_id)       │
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌──────────────┐    ┌──────────────┐
│temp_level1_  │───▶│temp_test_    │
│points        │1:N │cases         │
└──────┬───────┘    └──────┬───────┘
       │                   │
       │ 用户确认后合并     │ 用户确认后合并
       ▼                   ▼
┌──────────────┐    ┌──────────────┐
│ level1_points│───▶│  test_cases  │
└──────────────┘    │(library_id,  │
                    │ module_id)   │
                    └──────┬───────┘
                           │
                           │ 批量关联项目
                           ▼
                    ┌──────────────┐
                    │test_case_    │
                    │projects      │
                    └──────────────┘
```

### 3.8 关联字段说明

AI生成的测试用例会自动关联以下字段：

| 字段 | 来源 | 说明 |
|------|------|------|
| `library_id` | 任务配置 | 用例库ID，从任务创建时指定 |
| `module_id` | 任务配置 | 模块ID，从任务创建时指定 |
| `level1_id` | AI生成或用户选择 | 一级测试点ID |
| `owner` | 用户配置 | 负责人，合并时由用户指定 |
| `creator` | 系统自动 | 创建人，为任务发起者 |

**项目关联**：
- 项目关联通过 `test_case_projects` 表实现（多对多关系）
- 一个用例可以关联多个项目
- 合并到正式库后，用户可以批量关联项目
  KEY `idx_task_id` (`task_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_status` (`status`),
  KEY `idx_is_duplicate` (`is_duplicate`),
  KEY `idx_duplicate_score` (`duplicate_score`),
  
  CONSTRAINT `fk_temp_task` FOREIGN KEY (`task_id`) REFERENCES `ai_case_generation_tasks` (`task_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_temp_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临时测试用例表';
```

**设计要点**：
- **安全隔离核心**：临时表与正式表物理分离
- 查重字段完整：`duplicate_score`、`is_duplicate`、`duplicate_with_case_id`
- 支持用户修改追踪：`user_modified`标记
- 合并后保留映射：`merged_case_id`便于追溯

### 3.6 向量索引表 (case_embedding_index)

```sql
CREATE TABLE `case_embedding_index` (
  `id` int NOT NULL AUTO_INCREMENT,
  `case_id` int NOT NULL COMMENT '测试用例ID',
  `case_type` enum('formal','temp') DEFAULT 'formal' COMMENT '用例类型',
  
  -- 向量存储 (JSON格式)
  `name_embedding` json DEFAULT NULL COMMENT '用例名称的embedding向量',
  `content_embedding` json DEFAULT NULL COMMENT '用例内容的embedding向量',
  
  -- 元数据
  `embedding_model` varchar(50) DEFAULT NULL COMMENT '生成embedding的模型',
  `embedding_dimension` int DEFAULT 1536 COMMENT '向量维度',
  
  -- 缓存信息
  `content_hash` varchar(64) DEFAULT NULL COMMENT '内容哈希，用于判断是否需要重新计算',
  
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_case_type` (`case_id`, `case_type`),
  KEY `idx_case_type` (`case_type`),
  KEY `idx_content_hash` (`content_hash`),
  
  CONSTRAINT `fk_embedding_case` FOREIGN KEY (`case_id`) REFERENCES `test_cases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例向量索引表';
```

**设计要点**：
- 向量存储在MySQL的JSON字段中，避免引入向量数据库
- 支持名称和内容两种embedding，提高查重精度
- `content_hash`用于判断内容是否变化，避免重复计算embedding

### 3.7 数据表关系图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           数据表关系图                                       │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │     modules      │
                    │   (模块表)       │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ module_knowledge │ │ ai_case_         │ │ temp_test_cases  │
│ _files (VFS)     │ │ generation_tasks │ │ (临时用例)       │
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         │                    │                    │
         │                    │ 1:N                │
         ▼                    ▼                    │
┌──────────────────┐          │                    │
│ ai_material_     │          │                    │
│ chunks (分块)    │──────────┼────────────────────┘
└──────────────────┘          │
                              │
                              ▼
                    ┌──────────────────┐
                    │ test_cases       │
                    │ (正式用例表)     │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │ case_embedding_  │
                    │ index (向量)     │
                    └──────────────────┘
```

---

## 四、核心模块详细设计

### 4.1 虚拟文件系统设计 (VFS)

#### 4.1.1 设计目标

| 目标 | 描述 |
|------|------|
| 物理扁平化 | 文件在磁盘上按UUID命名，避免路径冲突 |
| 逻辑树状化 | 通过数据库邻接表构建用户可见的目录树 |
| 同名兼容 | 同一目录下允许同名文件，通过版本或时间戳区分 |
| 异步解析 | 文件上传后立即返回，后台异步解析切分 |

#### 4.1.2 物理存储策略

```
物理存储路径规则:
/uploads/knowledge/{module_id}/{file_uuid}.{ext}

示例:
/uploads/knowledge/4/a1b2c3d4-e5f6-7890-abcd-ef1234567890.docx
/uploads/knowledge/4/b2c3d4e5-f6a7-8901-bcde-f12345678901.xlsx

优势:
1. 避免文件名冲突 (UUID唯一)
2. 按模块分目录，便于管理和清理
3. 保留原始扩展名，便于识别文件类型
```

#### 4.1.3 逻辑目录树构建

```javascript
class VFSService {
  /**
   * 构建目录树
   * @param {number} moduleId - 模块ID
   * @param {number|null} parentId - 父目录ID，null表示根目录
   * @returns {Array} 目录树结构
   */
  async buildDirectoryTree(moduleId, parentId = null) {
    const [rows] = await pool.execute(`
      SELECT 
        id, parent_id, name, type, file_ext, file_size,
        parse_status, chunk_count, created_at, updated_at
      FROM module_knowledge_files
      WHERE module_id = ? AND parent_id ${parentId ? '= ?' : 'IS NULL'}
        AND deleted_at IS NULL
      ORDER BY type DESC, sort_order ASC, name ASC
    `, parentId ? [moduleId, parentId] : [moduleId]);
    
    const tree = [];
    for (const row of rows) {
      const node = {
        id: row.id,
        name: row.name,
        type: row.type,
        parseStatus: row.parse_status,
        chunkCount: row.chunk_count,
        createdAt: row.created_at
      };
      
      if (row.type === 'folder') {
        node.children = await this.buildDirectoryTree(moduleId, row.id);
      } else {
        node.fileExt = row.file_ext;
        node.fileSize = row.file_size;
      }
      
      tree.push(node);
    }
    
    return tree;
  }
  
  /**
   * 创建文件夹
   * @param {number} moduleId - 模块ID
   * @param {number|null} parentId - 父目录ID
   * @param {string} name - 文件夹名称
   * @param {string} userId - 创建人
   */
  async createFolder(moduleId, parentId, name, userId) {
    const [result] = await pool.execute(`
      INSERT INTO module_knowledge_files 
        (module_id, parent_id, name, type, created_by)
      VALUES (?, ?, ?, 'folder', ?)
    `, [moduleId, parentId, name, userId]);
    
    return result.insertId;
  }
  
  /**
   * 上传文件
   * @param {Object} file - 文件对象
   * @param {number} moduleId - 模块ID
   * @param {number|null} parentId - 父目录ID
   * @param {string} userId - 上传人
   */
  async uploadFile(file, moduleId, parentId, userId) {
    const fileUuid = uuidv4();
    const fileExt = path.extname(file.originalname).slice(1);
    const relativePath = `knowledge/${moduleId}/${fileUuid}.${fileExt}`;
    const absolutePath = path.join(UPLOAD_DIR, relativePath);
    
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      await fs.writeFile(absolutePath, file.buffer);
      
      const [result] = await connection.execute(`
        INSERT INTO module_knowledge_files 
          (module_id, parent_id, name, type, file_path, file_size, 
           file_ext, mime_type, created_by)
        VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)
      `, [moduleId, parentId, file.originalname, relativePath, 
          file.size, fileExt, file.mimetype, userId]);
      
      await connection.commit();
      
      const fileId = result.insertId;
      
      this.asyncParseFile(fileId);
      
      return { fileId, path: relativePath };
      
    } catch (error) {
      await connection.rollback();
      await fs.unlink(absolutePath).catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }
  
  /**
   * 异步解析文件 (后台任务)
   * @param {number} fileId - 文件ID
   */
  asyncParseFile(fileId) {
    setImmediate(async () => {
      try {
        await this.parseAndChunk(fileId);
      } catch (error) {
        console.error(`文件解析失败: fileId=${fileId}`, error);
      }
    });
  }
}
```

#### 4.1.4 同名文件处理策略

```
场景: 用户在同一目录下上传同名文件

处理流程:
─────────────────────────────────────────────────────────────────────

用户上传同名文件
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  系统检测到同名文件，弹出确认对话框:                              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ⚠️ 检测到同名文件                                           │ │
│  │                                                            │ │
│  │ 当前目录下已存在文件 "PRD文档.docx"                         │ │
│  │ 上传时间: 2026-04-20 10:00:00                              │ │
│  │                                                            │ │
│  │ 请选择处理方式:                                            │ │
│  │                                                            │ │
│  │ ○ 覆盖更新 - 删除旧文件，用新文件替换                       │ │
│  │   (旧文件的分块数据将被清除)                                │ │
│  │                                                            │ │
│  │ ○ 共存保留 - 保留旧文件，新文件独立存储                     │ │
│  │   (两个文件独立管理，可分别用于生成用例)                    │ │
│  │                                                            │ │
│  │ ○ 取消上传 - 不上传新文件                                  │ │
│  │                                                            │ │
│  │                              [取消]  [确认]                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

选项说明:
─────────────────────────────────────────────────────────────────────
┌────────────┬──────────────────────────────────────────────────────┐
│ 选项       │ 处理逻辑                                              │
├────────────┼──────────────────────────────────────────────────────┤
│ 覆盖更新   │ 1. 软删除旧文件记录 (deleted_at = NOW())             │
│            │ 2. 删除旧文件的所有分块 (ai_material_chunks)         │
│            │ 3. 插入新文件记录                                    │
│            │ 4. 异步解析新文件                                    │
├────────────┼──────────────────────────────────────────────────────┤
│ 共存保留   │ 1. 保留旧文件记录不变                                │
│            │ 2. 插入新文件记录 (同名但不同ID)                     │
│            │ 3. 异步解析新文件                                    │
│            │ 4. 前端展示时通过时间戳区分                          │
├────────────┼──────────────────────────────────────────────────────┤
│ 取消上传   │ 1. 不做任何操作                                      │
│            │ 2. 用户可重新选择其他文件                            │
└────────────┴──────────────────────────────────────────────────────┘

共存模式下的前端展示:
─────────────────────────────────────────────────────────────────────
├── 📁 需求文档
│   ├── 📄 PRD文档.docx (2026-04-20)  ← 旧版本
│   ├── 📄 PRD文档.docx (2026-04-25)  ← 新版本 (最新)
│   └── 📄 测试需求.xlsx
│
提示: 同名文件通过上传时间区分，最新版本标记 "(最新)"
```

**实现代码**:

```javascript
/**
 * 检查同名文件并处理
 */
async handleSameNameFile(moduleId, parentId, fileName, userId) {
  const [existing] = await pool.execute(`
    SELECT id, created_at, chunk_count
    FROM module_knowledge_files
    WHERE module_id = ? AND parent_id ${parentId ? '= ?' : 'IS NULL'}
      AND name = ? AND deleted_at IS NULL
  `, parentId ? [moduleId, parentId, fileName] : [moduleId, fileName]);
  
  return {
    hasConflict: existing.length > 0,
    existingFile: existing[0] || null
  };
}

/**
 * 覆盖更新同名文件
 */
async overwriteFile(existingFileId, newFile, moduleId, parentId, userId) {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    await connection.execute(`
      DELETE FROM ai_material_chunks WHERE file_id = ?
    `, [existingFileId]);
    
    await connection.execute(`
      UPDATE module_knowledge_files 
      SET deleted_at = NOW() 
      WHERE id = ?
    `, [existingFileId]);
    
    const fileUuid = uuidv4();
    const fileExt = path.extname(newFile.originalname).slice(1);
    const relativePath = `knowledge/${moduleId}/${fileUuid}.${fileExt}`;
    
    await fs.writeFile(path.join(UPLOAD_DIR, relativePath), newFile.buffer);
    
    const [result] = await connection.execute(`
      INSERT INTO module_knowledge_files 
        (module_id, parent_id, name, type, file_path, file_size, 
         file_ext, mime_type, created_by)
      VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)
    `, [moduleId, parentId, newFile.originalname, relativePath, 
        newFile.size, fileExt, newFile.mimetype, userId]);
    
    await connection.commit();
    
    this.asyncParseFile(result.insertId);
    
    return { fileId: result.insertId, action: 'overwrite' };
    
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 共存保留同名文件
 */
async coexistFile(newFile, moduleId, parentId, userId) {
  const fileUuid = uuidv4();
  const fileExt = path.extname(newFile.originalname).slice(1);
  const relativePath = `knowledge/${moduleId}/${fileUuid}.${fileExt}`;
  
  await fs.writeFile(path.join(UPLOAD_DIR, relativePath), newFile.buffer);
  
  const [result] = await pool.execute(`
    INSERT INTO module_knowledge_files 
      (module_id, parent_id, name, type, file_path, file_size, 
       file_ext, mime_type, created_by)
    VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)
  `, [moduleId, parentId, newFile.originalname, relativePath, 
      newFile.size, fileExt, newFile.mimetype, userId]);
  
  this.asyncParseFile(result.insertId);
  
  return { fileId: result.insertId, action: 'coexist' };
}

### 4.2 长文本处理 Map-Reduce 方案

#### 4.2.1 整体流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    长文本处理 Map-Reduce 流程                                │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │ 用户上传文件  │
                              └──────┬───────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段一: 解析入库 (异步)                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│  │ 文件类型识别  │───▶│ 调用对应解析器│───▶│ 提取纯文本   │                 │
│  └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                   │                         │
│                                                   ▼                         │
│                              ┌──────────────────────────────────┐          │
│                              │ 按段落/自然边界切分 (2000字/块)   │          │
│                              └──────────────┬───────────────────┘          │
│                                             │                               │
│                                             ▼                               │
│                              ┌──────────────────────────────────┐          │
│                              │ 写入 ai_material_chunks 表       │          │
│                              │ status='pending'                 │          │
│                              └──────────────────────────────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ 用户发起生成任务
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段二: Map (分批调用AI)                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ for each chunk (并发控制: p-queue, concurrency=4):                   │  │
│  │                                                                      │  │
│  │   1. 组装Prompt:                                                     │  │
│  │      - 模块背景信息                                                  │  │
│  │      - 当前文本块内容                                                │  │
│  │      - 生成指令                                                      │  │
│  │                                                                      │  │
│  │   2. 调用大模型API                                                   │  │
│  │                                                                      │  │
│  │   3. 解析返回的JSON                                                  │  │
│  │                                                                      │  │
│  │   4. 无脑写入 temp_test_cases 表                                    │  │
│  │                                                                      │  │
│  │   5. 更新 chunk.status = 'completed'                                │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ 所有chunk处理完成
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 阶段三: Reduce (内存查重合并)                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 1. 加载目标模块所有正式用例的embedding到内存                          │  │
│  │                                                                      │  │
│  │ 2. 为临时用例生成embedding                                           │  │
│  │                                                                      │  │
│  │ 3. 双重循环计算余弦相似度                                            │  │
│  │                                                                      │  │
│  │ 4. 标记重复用例:                                                     │  │
│  │    - is_duplicate = 1                                               │  │
│  │    - duplicate_score = 相似度分数                                   │  │
│  │    - duplicate_with_case_id = 重复源ID                              │  │
│  │                                                                      │  │
│  │ 5. 更新任务状态为 'completed'                                        │  │
│  │                                                                      │  │
│  │ 6. 发送邮件通知用户                                                  │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.2.2 文件解析器实现

```javascript
const parsers = {
  docx: require('./parsers/wordParser'),
  xlsx: require('./parsers/excelParser'),
  xls: require('./parsers/excelParser'),
  pdf: require('./parsers/pdfParser'),
  png: require('./parsers/imageParser'),
  jpg: require('./parsers/imageParser'),
  jpeg: require('./parsers/imageParser')
};

class FileParserService {
  /**
   * 解析文件并切分
   * @param {number} fileId - 文件ID
   */
  async parseAndChunk(fileId) {
    const [files] = await pool.execute(`
      SELECT f.*, m.name as module_name, m.description as module_desc
      FROM module_knowledge_files f
      JOIN modules m ON f.module_id = m.id
      WHERE f.id = ?
    `, [fileId]);
    
    if (files.length === 0) return;
    
    const file = files[0];
    
    await pool.execute(`
      UPDATE module_knowledge_files 
      SET parse_status = 'parsing' 
      WHERE id = ?
    `, [fileId]);
    
    try {
      const filePath = path.join(UPLOAD_DIR, file.file_path);
      const ext = file.file_ext.toLowerCase();
      
      const parser = parsers[ext];
      if (!parser) {
        throw new Error(`不支持的文件类型: ${ext}`);
      }
      
      const content = await parser.parse(filePath);
      
      const chunks = this.chunkContent(content, {
        chunkSize: 2000,
        overlap: 200,
        minChunkSize: 500
      });
      
      await this.saveChunks(fileId, file.module_id, chunks);
      
      await pool.execute(`
        UPDATE module_knowledge_files 
        SET parse_status = 'parsed', 
            chunk_count = ?,
            total_tokens = ?,
            parsed_at = NOW()
        WHERE id = ?
      `, [chunks.length, chunks.reduce((sum, c) => sum + c.tokenCount, 0), fileId]);
      
    } catch (error) {
      await pool.execute(`
        UPDATE module_knowledge_files 
        SET parse_status = 'failed', parse_error = ?
        WHERE id = ?
      `, [error.message, fileId]);
      
      throw error;
    }
  }
  
  /**
   * 文本切分
   * @param {string} content - 原始文本
   * @param {Object} options - 切分配置
   */
  chunkContent(content, options = {}) {
    const { chunkSize = 2000, overlap = 200, minChunkSize = 500 } = options;
    const chunks = [];
    let index = 0;
    let position = 0;
    
    while (position < content.length) {
      let endPosition = Math.min(position + chunkSize, content.length);
      let chunkContent = content.slice(position, endPosition);
      
      if (endPosition < content.length) {
        const breakPoints = [
          chunkContent.lastIndexOf('。\n'),
          chunkContent.lastIndexOf('。\r\n'),
          chunkContent.lastIndexOf('。'),
          chunkContent.lastIndexOf('\n\n'),
          chunkContent.lastIndexOf('\n'),
          chunkContent.lastIndexOf('.')
        ].filter(bp => bp > minChunkSize);
        
        if (breakPoints.length > 0) {
          const breakPoint = Math.max(...breakPoints);
          chunkContent = chunkContent.slice(0, breakPoint + 1);
        }
      }
      
      chunks.push({
        chunkIndex: index,
        chunkContent: chunkContent.trim(),
        tokenCount: this.estimateTokens(chunkContent),
        charCount: chunkContent.length
      });
      
      position += chunkContent.length - overlap;
      index++;
    }
    
    return chunks;
  }
  
  /**
   * Token估算
   * @param {string} text - 文本
   */
  estimateTokens(text) {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (text.match(/\d+/g) || []).length;
    const others = text.length - chineseChars - englishWords - numbers;
    
    return Math.ceil(chineseChars * 0.6 + englishWords * 1.3 + numbers * 0.5 + others * 0.3);
  }
  
  /**
   * 保存文本块
   */
  async saveChunks(fileId, moduleId, chunks) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      for (const chunk of chunks) {
        await connection.execute(`
          INSERT INTO ai_material_chunks 
            (file_id, module_id, chunk_index, chunk_content, token_count, char_count)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [fileId, moduleId, chunk.chunkIndex, chunk.chunkContent, 
            chunk.tokenCount, chunk.charCount]);
      }
      
      await connection.commit();
    } finally {
      connection.release();
    }
  }
}
```

#### 4.2.3 Map阶段实现

```javascript
const PQueue = require('p-queue');

class CaseGeneratorService {
  constructor() {
    this.apiQueue = new PQueue({ concurrency: 4 });
  }
  
  /**
   * 执行Map阶段
   * @param {string} taskId - 任务ID
   */
  async executeMapPhase(taskId) {
    const [tasks] = await pool.execute(`
      SELECT t.*, m.name as module_name, m.description as module_desc
      FROM ai_case_generation_tasks t
      JOIN modules m ON t.module_id = m.id
      WHERE t.task_id = ?
    `, [taskId]);
    
    if (tasks.length === 0) return;
    
    const task = tasks[0];
    const selectedFiles = JSON.parse(task.selected_files || '[]');
    
    const [chunks] = await pool.execute(`
      SELECT c.*, f.name as file_name
      FROM ai_material_chunks c
      JOIN module_knowledge_files f ON c.file_id = f.id
      WHERE f.module_id = ? AND c.status = 'pending'
        AND (${selectedFiles.length > 0 ? `f.id IN (${selectedFiles.map(() => '?').join(',')})` : '1=1'})
      ORDER BY c.chunk_index ASC
    `, [task.module_id, ...selectedFiles]);
    
    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET total_chunks = ?, stage = 'mapping'
      WHERE task_id = ?
    `, [chunks.length, taskId]);
    
    let processedCount = 0;
    
    for (const chunk of chunks) {
      await this.apiQueue.add(async () => {
        try {
          const cases = await this.generateCasesFromChunk(chunk, task);
          
          await this.saveTempCases(taskId, task.module_id, chunk.id, cases);
          
          await pool.execute(`
            UPDATE ai_material_chunks 
            SET status = 'completed', generated_cases = ?, processed_at = NOW()
            WHERE id = ?
          `, [cases.length, chunk.id]);
          
          processedCount++;
          await this.updateProgress(taskId, processedCount, chunks.length);
          
        } catch (error) {
          await pool.execute(`
            UPDATE ai_material_chunks 
            SET status = 'failed', error_message = ?, retry_count = retry_count + 1
            WHERE id = ?
          `, [error.message, chunk.id]);
        }
      });
    }
    
    await this.apiQueue.onIdle();
  }
  
  /**
   * 从文本块生成用例
   */
  async generateCasesFromChunk(chunk, task) {
    const prompt = this.buildPrompt(chunk, task);
    
    const response = await aiService.chat({
      model: task.config?.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: prompt }
      ],
      temperature: task.config?.temperature || 0.7,
      max_tokens: task.config?.max_tokens || 4000
    });
    
    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]).cases || [];
    }
    
    try {
      return JSON.parse(content).cases || [];
    } catch {
      return [];
    }
  }
  
  /**
   * 构建提示词
   */
  buildPrompt(chunk, task) {
    return `## 模块背景
模块名称: ${task.module_name}
模块描述: ${task.module_desc || '无'}

## 当前材料片段
文件: ${chunk.file_name}
片段序号: ${chunk.chunk_index + 1}
内容:
${chunk.chunk_content}

## 生成要求
1. 仅根据当前片段内容生成测试用例
2. 如果片段内容不足以生成完整用例，可以跳过
3. 用例名称要能体现测试点
4. 测试步骤要具体可执行
5. 预期结果要明确可验证

## 输出格式
请严格按照以下JSON格式输出:
\`\`\`json
{
  "cases": [
    {
      "name": "用例名称",
      "priority": "高/中/低",
      "type": "功能测试/性能测试/压力测试/规格测试/异常测试",
      "precondition": "前置条件",
      "purpose": "测试目的",
      "steps": "1. 步骤1\\n2. 步骤2\\n3. 步骤3",
      "expected": "预期结果"
    }
  ]
}
\`\`\``;
  }
  
  /**
   * 保存临时用例
   */
  async saveTempCases(taskId, moduleId, chunkId, cases) {
    if (cases.length === 0) return;
    
    const values = cases.map(c => [
      `TEMP-${uuidv4().slice(0, 8).toUpperCase()}`,
      taskId,
      moduleId,
      chunkId,
      c.name,
      c.priority || '中',
      c.type || '功能测试',
      c.precondition || '',
      c.purpose || '',
      c.steps,
      c.expected
    ]);
    
    const placeholders = values.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const flatValues = values.flat();
    
    await pool.execute(`
      INSERT INTO temp_test_cases 
        (temp_case_id, task_id, module_id, chunk_id, name, priority, type,
         precondition, purpose, steps, expected)
      VALUES ${placeholders}
    `, flatValues);
  }
  
  /**
   * 更新进度
   */
  async updateProgress(taskId, processed, total) {
    const progress = Math.round((processed / total) * 100);
    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET progress = ?, processed_chunks = ?, 
          progress_message = CONCAT('正在生成用例... ', ?, '/', ?)
      WHERE task_id = ?
    `, [progress, processed, processed, total, taskId]);
  }
}
```

### 4.2.4 一级测试点生成与关联逻辑

#### 生成模式

AI生成测试用例时，支持两种一级测试点关联模式：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         一级测试点关联模式                                   │
└─────────────────────────────────────────────────────────────────────────────┘

模式一: 选择已有测试点
─────────────────────────────────────────────────────────────────────
用户在发起生成任务时，选择已有的一级测试点：

┌──────────────────────────────────────────────────────────────────┐
│  选择一级测试点:                                                  │
│                                                                  │
│  ○ NetRx Buffer测试 (已有5个用例)                                │
│  ○ NetRx调度测试 (已有3个用例)                                   │
│  ○ FastCbfc (已有2个用例)                                        │
│  ● 自动创建新测试点 (AI根据材料自动生成)                          │
│                                                                  │
│  如果选择已有测试点，生成的用例将关联到该测试点                    │
└──────────────────────────────────────────────────────────────────┘

模式二: 自动创建新测试点
─────────────────────────────────────────────────────────────────────
AI分析材料内容，自动识别测试领域，生成一级测试点：

┌──────────────────────────────────────────────────────────────────┐
│  AI自动分析材料，生成一级测试点:                                  │
│                                                                  │
│  1. Buffer管理测试 (生成5个用例)                                 │
│  2. 调度算法测试 (生成3个用例)                                   │
│  3. 异常处理测试 (生成4个用例)                                   │
│                                                                  │
│  每个测试点下自动关联若干测试用例                                 │
└──────────────────────────────────────────────────────────────────┘
```

#### 生成流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    一级测试点生成流程                                        │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │ 用户发起任务  │
                              └──────┬───────┘
                                     │
                                     ▼
                    ┌────────────────────────────────┐
                    │ 是否选择已有测试点?            │
                    └────────────────┬───────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
        ┌───────────────────┐            ┌───────────────────┐
        │ 选择已有测试点     │            │ 自动创建新测试点   │
        └─────────┬─────────┘            └─────────┬─────────┘
                  │                                │
                  ▼                                ▼
        ┌───────────────────┐            ┌───────────────────┐
        │ 记录level1_id     │            │ AI分析材料        │
        │ 到任务配置        │            │ 识别测试领域      │
        └─────────┬─────────┘            └─────────┬─────────┘
                  │                                │
                  │                                ▼
                  │                      ┌───────────────────┐
                  │                      │ 生成一级测试点    │
                  │                      │ 存入temp_level1   │
                  │                      │ _points表         │
                  │                      └─────────┬─────────┘
                  │                                │
                  └────────────────┬───────────────┘
                                   │
                                   ▼
                        ┌───────────────────┐
                        │ AI生成测试用例    │
                        │ 关联level1_id     │
                        └─────────┬─────────┘
                                  │
                                  ▼
                        ┌───────────────────┐
                        │ 存入temp_test_    │
                        │ cases表           │
                        └───────────────────┘
```

#### AI生成一级测试点的提示词

```javascript
const level1GenerationPrompt = {
  systemPrompt: `你是一个专业的测试用例设计专家。
你的任务是根据需求材料，识别主要的测试领域，并生成一级测试点。

## 一级测试点定义
一级测试点是对测试范围的分类，每个测试点下会包含若干具体的测试用例。

## 命名规范
1. 简洁明了，体现测试领域
2. 格式建议: "功能名称 + 测试类型"
3. 示例: "Buffer管理测试"、"调度算法测试"、"异常处理测试"

## 输出要求
根据材料内容，识别3-10个主要测试领域，生成一级测试点。`,

  userPromptTemplate: `## 模块信息
模块名称: {{module_name}}
模块描述: {{module_description}}

## 现有一级测试点
{{existing_level1_points}}

## 需求材料内容
{{material_content}}

## 输出格式
严格按照以下JSON格式输出:
\`\`\`json
{
  "level1_points": [
    {
      "name": "一级测试点名称",
      "test_type": "功能测试/性能测试/异常测试/...",
      "description": "测试点描述",
      "estimated_cases": 5
    }
  ]
}
\`\`\`

注意: 避免与现有一级测试点重复`
};
```

#### 实现代码

```javascript
class Level1PointService {
  /**
   * 获取模块已有的一级测试点
   */
  async getExistingLevel1Points(moduleId) {
    const [rows] = await pool.execute(`
      SELECT id, name, test_type, 
             (SELECT COUNT(*) FROM test_cases WHERE level1_id = level1_points.id) as case_count
      FROM level1_points
      WHERE module_id = ?
      ORDER BY order_index, created_at
    `, [moduleId]);
    
    return rows;
  }
  
  /**
   * AI生成一级测试点
   */
  async generateLevel1Points(taskId, moduleId, materialContent) {
    const module = await this.getModuleInfo(moduleId);
    const existingPoints = await this.getExistingLevel1Points(moduleId);
    
    const prompt = this.buildLevel1Prompt(module, existingPoints, materialContent);
    
    const response = await aiService.chat({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: level1GenerationPrompt.systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });
    
    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    
    if (!jsonMatch) {
      return [];
    }
    
    const result = JSON.parse(jsonMatch[1]);
    
    const tempLevel1Points = [];
    for (const point of result.level1_points) {
      const tempLevel1Id = `TEMP-L1-${uuidv4().slice(0, 8).toUpperCase()}`;
      
      await pool.execute(`
        INSERT INTO temp_level1_points 
          (temp_level1_id, task_id, module_id, name, test_type, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [tempLevel1Id, taskId, moduleId, point.name, point.test_type, point.description]);
      
      tempLevel1Points.push({
        tempLevel1Id,
        name: point.name,
        testType: point.test_type
      });
    }
    
    return tempLevel1Points;
  }
  
  /**
   * 为测试用例分配一级测试点
   */
  async assignLevel1ToCases(taskId, tempLevel1Points, generatedCases) {
    for (const caseItem of generatedCases) {
      const matchedPoint = this.matchCaseToLevel1(caseItem, tempLevel1Points);
      
      if (matchedPoint) {
        await pool.execute(`
          UPDATE temp_test_cases 
          SET level1_id = ?, level1_name = ?, is_new_level1 = 1
          WHERE temp_case_id = ?
        `, [matchedPoint.tempLevel1Id, matchedPoint.name, caseItem.tempCaseId]);
      }
    }
  }
  
  /**
   * 匹配用例到一级测试点
   */
  matchCaseToLevel1(caseItem, level1Points) {
    const caseName = caseItem.name.toLowerCase();
    const caseType = caseItem.type.toLowerCase();
    
    for (const point of level1Points) {
      const pointName = point.name.toLowerCase();
      const pointType = point.testType.toLowerCase();
      
      if (caseName.includes(pointName.replace('测试', '')) ||
          caseType.includes(pointType)) {
        return point;
      }
    }
    
    return level1Points[0] || null;
  }
  
  /**
   * 合并一级测试点到正式表
   */
  async mergeLevel1Points(taskId) {
    const [tempPoints] = await pool.execute(`
      SELECT * FROM temp_level1_points 
      WHERE task_id = ? AND status = 'approved'
    `, [taskId]);
    
    for (const tempPoint of tempPoints) {
      const [result] = await pool.execute(`
        INSERT INTO level1_points (module_id, name, test_type, order_index)
        VALUES (?, ?, ?, ?)
      `, [tempPoint.module_id, tempPoint.name, tempPoint.test_type, tempPoint.order_index]);
      
      await pool.execute(`
        UPDATE temp_level1_points 
        SET status = 'merged', merged_level1_id = ?
        WHERE id = ?
      `, [result.insertId, tempPoint.id]);
      
      await pool.execute(`
        UPDATE temp_test_cases 
        SET level1_id = ?
        WHERE level1_id = ? AND task_id = ?
      `, [result.insertId, tempPoint.temp_level1_id, taskId]);
    }
  }
}
```

#### 前端界面 - 一级测试点选择

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🤖 AI生成测试用例配置                                              [×]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  目标模块: NetRx                                                            │
│                                                                             │
│  📁 一级测试点关联                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ○ 关联到已有测试点                                                  │   │
│  │   ┌─────────────────────────────────────────────────────────────┐  │   │
│  │   │ ☑ NetRx Buffer测试    (已有5个用例)                         │  │   │
│  │   │ ☐ NetRx调度测试        (已有3个用例)                        │  │   │
│  │   │ ☐ FastCbfc             (已有2个用例)                        │  │   │
│  │   └─────────────────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │ ● 自动创建新测试点 (AI分析材料自动生成)                             │   │
│  │   系统将根据材料内容自动识别测试领域，生成一级测试点                 │   │
│  │                                                                     │   │
│  │ ○ 混合模式                                                          │   │
│  │   部分关联已有测试点，部分创建新测试点                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  📎 选择知识库文件                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☑ PRD_v2.0.docx        已解析 ✓                                    │   │
│  │ ☑ 测试需求.xlsx        已解析 ✓                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                              [取消]  [开始生成]                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 临时用例预览 - 按一级测试点分组

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📋 AI生成结果预览                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  任务ID: TASK-20260425-001    模块: NetRx                                   │
│                                                                             │
│  📊 统计摘要                                                                │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                              │
│  │ 测试点: 3  │ │ 用例: 18   │ │ 待确认: 16 │                              │
│  └────────────┘ └────────────┘ └────────────┘                              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📁 Buffer管理测试 (新建)                              5个用例 [展开] │   │
│  │ ┌───────────────────────────────────────────────────────────────┐  │   │
│  │ │ ☐ │ Buffer基本功能测试    │ 高 │ 待确认 │ 👁️ ✏️ 🗑️           │  │   │
│  │ │ ☐ │ Buffer溢出处理        │ 中 │ 待确认 │ 👁️ ✏️ 🗑️           │  │   │
│  │ │ ...                                                           │  │   │
│  │ └───────────────────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │ 📁 调度算法测试 (新建)                                8个用例 [折叠] │   │
│  │                                                                     │   │
│  │ 📁 异常处理测试 (新建)                                5个用例 [折叠] │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [全选] [批量批准] [批量拒绝] [批量删除]    [确认合并到正式库]        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 去Redis化的任务队列机制

#### 4.3.1 状态机设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         任务状态机                                           │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │   pending    │
                              │  (等待处理)   │
                              └──────┬───────┘
                                     │
                        Worker拉取并更新状态
                                     │
                                     ▼
                              ┌──────────────┐
                              │  processing  │
                              │  (处理中)     │
                              └──────┬───────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
             ┌──────────┐    ┌──────────┐    ┌──────────┐
             │completed │    │  failed  │    │cancelled │
             │ (完成)   │    │  (失败)  │    │  (取消)  │
             └──────────┘    └──────────┘    └──────────┘

状态转换规则:
─────────────────────────────────────────────────────────────────────
当前状态        触发条件                    目标状态
─────────────────────────────────────────────────────────────────────
pending         Worker拉取任务              processing
processing      所有chunk处理完成           completed
processing      发生不可恢复错误            failed
pending         用户主动取消                cancelled
processing      用户主动取消                cancelled
failed          用户重试                    pending (重置)
─────────────────────────────────────────────────────────────────────
```

#### 4.3.2 任务调度器实现

```javascript
const PQueue = require('p-queue');
const cron = require('node-cron');

class TaskScheduler {
  constructor() {
    this.taskQueue = new PQueue({ concurrency: 2 });
    this.isRunning = false;
  }
  
  /**
   * 启动调度器
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    this.recoverInterruptedTasks();
    
    cron.schedule('*/5 * * * * *', () => {
      this.pollAndProcess();
    });
    
    console.log('任务调度器已启动');
  }
  
  /**
   * 恢复中断的任务
   */
  async recoverInterruptedTasks() {
    const [result] = await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET status = 'pending', 
          progress_message = '任务恢复中...'
      WHERE status = 'processing'
    `);
    
    if (result.affectedRows > 0) {
      console.log(`已恢复 ${result.affectedRows} 个中断的任务`);
    }
  }
  
  /**
   * 轮询并处理任务
   */
  async pollAndProcess() {
    if (this.taskQueue.size >= this.taskQueue.concurrency) {
      return;
    }
    
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const [tasks] = await connection.execute(`
        SELECT task_id FROM ai_case_generation_tasks 
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      
      if (tasks.length === 0) {
        await connection.rollback();
        return;
      }
      
      const taskId = tasks[0].task_id;
      
      await connection.execute(`
        UPDATE ai_case_generation_tasks 
        SET status = 'processing', 
            started_at = NOW(),
            progress_message = '任务开始处理...'
        WHERE task_id = ?
      `, [taskId]);
      
      await connection.commit();
      
      this.taskQueue.add(() => this.processTask(taskId));
      
    } catch (error) {
      await connection.rollback();
      console.error('任务轮询失败:', error);
    } finally {
      connection.release();
    }
  }
  
  /**
   * 处理单个任务
   */
  async processTask(taskId) {
    console.log(`开始处理任务: ${taskId}`);
    
    try {
      await caseGeneratorService.executeMapPhase(taskId);
      
      await dedupService.executeReducePhase(taskId);
      
      await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET status = 'completed', 
            stage = 'finished',
            progress = 100,
            progress_message = '任务完成',
            completed_at = NOW()
        WHERE task_id = ?
      `, [taskId]);
      
      await emailService.sendCompletionNotification(taskId);
      
      console.log(`任务完成: ${taskId}`);
      
    } catch (error) {
      console.error(`任务失败: ${taskId}`, error);
      
      await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET status = 'failed', 
            error_message = ?,
            error_stack = ?
        WHERE task_id = ?
      `, [error.message, error.stack, taskId]);
    }
  }
  
  /**
   * 取消任务
   */
  async cancelTask(taskId) {
    const [result] = await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET status = 'cancelled',
          progress_message = '用户取消'
      WHERE task_id = ? AND status IN ('pending', 'processing')
    `, [taskId]);
    
    return result.affectedRows > 0;
  }
}

const taskScheduler = new TaskScheduler();
taskScheduler.start();
```

#### 4.3.3 并发控制与限流

```javascript
const PQueue = require('p-queue');

const concurrencyConfig = {
  TASK_PROCESSING_CONCURRENCY: parseInt(process.env.TASK_PROCESSING_CONCURRENCY) || 2,
  CHUNK_API_CONCURRENCY: parseInt(process.env.CHUNK_API_CONCURRENCY) || 4,
  API_RATE_LIMIT_PER_MINUTE: parseInt(process.env.API_RATE_LIMIT_PER_MINUTE) || 60
};

const taskQueue = new PQueue({ 
  concurrency: concurrencyConfig.TASK_PROCESSING_CONCURRENCY 
});

const apiQueue = new PQueue({ 
  concurrency: concurrencyConfig.CHUNK_API_CONCURRENCY 
});

const apiRateLimiter = {
  tokens: concurrencyConfig.API_RATE_LIMIT_PER_MINUTE,
  lastRefill: Date.now(),
  
  async waitForToken() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    
    if (elapsed >= 60000) {
      this.tokens = concurrencyConfig.API_RATE_LIMIT_PER_MINUTE;
      this.lastRefill = now;
    }
    
    if (this.tokens <= 0) {
      const waitTime = 60000 - elapsed;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.tokens = concurrencyConfig.API_RATE_LIMIT_PER_MINUTE;
      this.lastRefill = Date.now();
    }
    
    this.tokens--;
  }
};

async function callAIWithRateLimit(prompt, config) {
  await apiRateLimiter.waitForToken();
  return apiQueue.add(() => aiService.chat(prompt, config));
}
```

### 4.4 内存级余弦相似度查重算法设计

#### 4.4.1 算法原理

```
余弦相似度计算公式:
─────────────────────────────────────────────────────────────────────

         A · B         Σ(Ai × Bi)
sim = ───────── = ─────────────────────────
       |A| × |B|    √(ΣAi²) × √(ΣBi²)

其中:
- A, B 是两个向量 (embedding)
- A · B 是向量点积
- |A|, |B| 是向量的模长

相似度范围: 0 ~ 1
- 0: 完全不相似
- 1: 完全相同
- 0.85+: 通常认为是重复
```

#### 4.4.2 核心实现

```javascript
class DedupService {
  constructor() {
    this.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.85;
  }
  
  /**
   * 计算两个向量的余弦相似度
   * @param {number[]} vecA - 向量A
   * @param {number[]} vecB - 向量B
   * @returns {number} 相似度 (0~1)
   */
  calculateCosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * 执行Reduce阶段 (查重)
   * @param {string} taskId - 任务ID
   */
  async executeReducePhase(taskId) {
    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET stage = 'reducing', progress_message = '正在查重...'
      WHERE task_id = ?
    `, [taskId]);
    
    const [tasks] = await pool.execute(`
      SELECT module_id FROM ai_case_generation_tasks WHERE task_id = ?
    `, [taskId]);
    
    if (tasks.length === 0) return;
    
    const moduleId = tasks[0].module_id;
    
    const existingCases = await this.loadExistingCaseVectors(moduleId);
    
    const [tempCases] = await pool.execute(`
      SELECT id, temp_case_id, name, purpose, steps, expected
      FROM temp_test_cases
      WHERE task_id = ? AND status = 'pending'
    `, [taskId]);
    
    let duplicateCount = 0;
    
    for (const tempCase of tempCases) {
      const tempEmbedding = await this.getOrGenerateEmbedding(tempCase);
      
      let maxSimilarity = 0;
      let duplicateWithId = null;
      
      for (const existing of existingCases) {
        const similarity = this.calculateCosineSimilarity(
          tempEmbedding,
          existing.embedding
        );
        
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          duplicateWithId = existing.caseId;
        }
      }
      
      const isDuplicate = maxSimilarity >= this.similarityThreshold;
      
      if (isDuplicate) {
        duplicateCount++;
      }
      
      await pool.execute(`
        UPDATE temp_test_cases 
        SET duplicate_score = ?,
            is_duplicate = ?,
            duplicate_with_case_id = ?
        WHERE id = ?
      `, [Math.round(maxSimilarity * 100), isDuplicate ? 1 : 0, duplicateWithId, tempCase.id]);
    }
    
    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET duplicate_count = ?
      WHERE task_id = ?
    `, [duplicateCount, taskId]);
  }
  
  /**
   * 加载已有用例的向量到内存
   * @param {number} moduleId - 模块ID
   * @returns {Array} 用例向量数组
   */
  async loadExistingCaseVectors(moduleId) {
    const [rows] = await pool.execute(`
      SELECT 
        tc.id as case_id,
        cei.content_embedding
      FROM test_cases tc
      LEFT JOIN case_embedding_index cei ON tc.id = cei.case_id AND cei.case_type = 'formal'
      WHERE tc.module_id = ?
    `, [moduleId]);
    
    return rows
      .filter(row => row.content_embedding)
      .map(row => ({
        caseId: row.case_id,
        embedding: JSON.parse(row.content_embedding)
      }));
  }
  
  /**
   * 获取或生成embedding
   */
  async getOrGenerateEmbedding(tempCase) {
    const content = `${tempCase.name} ${tempCase.purpose} ${tempCase.steps} ${tempCase.expected}`;
    const contentHash = this.hashContent(content);
    
    const [existing] = await pool.execute(`
      SELECT content_embedding FROM case_embedding_index
      WHERE case_id = ? AND case_type = 'temp' AND content_hash = ?
    `, [tempCase.id, contentHash]);
    
    if (existing.length > 0 && existing[0].content_embedding) {
      return JSON.parse(existing[0].content_embedding);
    }
    
    const embedding = await aiService.generateEmbedding(content);
    
    await pool.execute(`
      INSERT INTO case_embedding_index (case_id, case_type, content_embedding, content_hash)
      VALUES (?, 'temp', ?, ?)
      ON DUPLICATE KEY UPDATE content_embedding = ?, content_hash = ?
    `, [tempCase.id, JSON.stringify(embedding), contentHash, JSON.stringify(embedding), contentHash]);
    
    return embedding;
  }
  
  /**
   * 内容哈希
   */
  hashContent(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
```

#### 4.4.3 内存开销评估

```
内存开销计算:
─────────────────────────────────────────────────────────────────────

假设:
- 向量维度: 1536 (OpenAI text-embedding-3-small)
- 每个浮点数: 8 bytes (JavaScript Number)
- 每个用例向量: 1536 × 8 = 12,288 bytes ≈ 12 KB

不同规模下的内存占用:
┌──────────────┬──────────────┬──────────────┐
│ 用例数量     │ 向量内存     │ 总内存估算   │
├──────────────┼──────────────┼──────────────┤
│ 1,000       │ ~12 MB       │ ~15 MB       │
│ 5,000       │ ~60 MB       │ ~75 MB       │
│ 10,000      │ ~120 MB      │ ~150 MB      │
│ 50,000      │ ~600 MB      │ ~750 MB      │
│ 100,000     │ ~1.2 GB      │ ~1.5 GB      │
└──────────────┴──────────────┴──────────────┘

计算耗时评估 (V8引擎):
─────────────────────────────────────────────────────────────────────
- 单次1536维余弦相似度: ~0.003ms
- 1,000次比对: ~3ms
- 10,000次比对: ~30ms
- 100,000次比对: ~300ms

结论:
对于十万级以下用例，Node.js内存计算完全满足性能需求。
超过十万级建议分批处理或考虑引入向量数据库。
```

#### 4.4.4 内存管理策略

```javascript
class DedupService {
  /**
   * 带内存管理的查重
   */
  async executeReducePhaseWithMemoryManagement(taskId) {
    let existingCases = null;
    
    try {
      existingCases = await this.loadExistingCaseVectors(moduleId);
      
      const [tempCases] = await pool.execute(`
        SELECT id, temp_case_id, name, purpose, steps, expected
        FROM temp_test_cases
        WHERE task_id = ? AND status = 'pending'
      `, [taskId]);
      
      const batchSize = 100;
      for (let i = 0; i < tempCases.length; i += batchSize) {
        const batch = tempCases.slice(i, i + batchSize);
        await this.processBatch(batch, existingCases);
        
        if (global.gc) {
          global.gc();
        }
      }
      
    } finally {
      existingCases = null;
      
      if (global.gc) {
        global.gc();
      }
    }
  }
  
  /**
   * 批量处理
   */
  async processBatch(tempCases, existingCases) {
    for (const tempCase of tempCases) {
      const tempEmbedding = await this.getOrGenerateEmbedding(tempCase);
      
      let maxSimilarity = 0;
      let duplicateWithId = null;
      
      for (const existing of existingCases) {
        const similarity = this.calculateCosineSimilarity(tempEmbedding, existing.embedding);
        
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          duplicateWithId = existing.caseId;
        }
      }
      
      await this.updateDuplicateStatus(tempCase.id, maxSimilarity, duplicateWithId);
    }
  }
}
```

---

## 五、前端交互形态建议

### 5.1 知识库入口设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  模块详情页布局建议                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 模块: NetRx                                    [编辑] [AI生成用例]  │   │
│  │ 描述: 网络接收模块                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 测试用例列表 (主内容区)                                              │   │
│  │ ┌───────────────────────────────────────────────────────────────┐  │   │
│  │ │ [新建用例] [导入] [导出]                    搜索: [        ]  │  │   │
│  │ ├───────────────────────────────────────────────────────────────┤  │   │
│  │ │ ☐ │ 用例名称              │ 优先级 │ 类型   │ 状态   │ 操作 │  │   │
│  │ ├───┼───────────────────────┼────────┼────────┼────────┼──────┤  │   │
│  │ │ ...                                                       │  │   │
│  │ └───────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                                              ┌─────────────────────────┐   │
│                                              │ 📚 知识库               │   │
│                                              │    (滑出抽屉入口)       │   │
│                                              └─────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 知识库滑出抽屉设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📚 知识库                                              [×]               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  工具栏                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [新建文件夹] [上传文件]                        搜索: [           ]  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  文件列表                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📁 需求文档                                                [删除]    │   │
│  │    📄 PRD_v2.0.docx        已解析 ✓    15块    [预览] [删除]       │   │
│  │    📄 测试需求.xlsx        已解析 ✓    8块     [预览] [删除]       │   │
│  │                                                                     │   │
│  │ 📁 设计文档                                                [删除]    │   │
│  │    📄 架构图.drawio        已解析 ✓    3块     [预览] [删除]       │   │
│  │                                                                     │   │
│  │ 📄 接口文档.pdf            解析中...                              │   │
│  │ 📄 流程图.png              待解析     [解析]                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  操作区                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 已选择 2 个文件                                                     │   │
│  │                                                                     │   │
│  │ 生成配置:                                                           │   │
│  │ ┌───────────────────────────────────────────────────────────────┐  │   │
│  │ │ 用例数量上限: [20    ] 个                                      │  │   │
│  │ │ ☑ 启用查重过滤    阈值: [85   ]%                              │  │   │
│  │ └───────────────────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │                    [取消]  [🤖 生成测试用例]                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 任务进度弹窗

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⏳ AI生成进度                                              [×]            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  任务ID: TASK-20260425-001                                                  │
│  状态: 处理中                                                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [████████████████████░░░░░░░░░░░░░░░░░░░░░░░░]  55%                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  处理阶段                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ✅ 1. 准备材料                                        完成          │   │
│  │ ✅ 2. 文本分块                                        完成          │   │
│  │ 🔄 3. AI生成用例 (11/20块)                           进行中        │   │
│  │ ⏳ 4. 查重过滤                                        等待中        │   │
│  │ ⏳ 5. 完成                                            等待中        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  实时统计                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 已生成: 18 个用例    重复: 2 个    有效: 16 个                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  💡 任务完成后将发送邮件通知，您可以关闭此窗口                            │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          [最小化]  [取消任务]                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.4 临时用例预览页面

#### 5.4.1 权限控制

临时用例具有严格的访问权限控制：

| 角色 | 权限 | 说明 |
|------|------|------|
| **生成者** | 查看、编辑、删除、提交评审、直接合并 | 任务创建者拥有完整操作权限 |
| **管理员** | 查看、编辑、删除、审批评审 | 系统管理员可查看所有任务 |
| **其他用户** | 无权限 | 不可见临时用例，直到合并到正式库 |

```
权限检查流程:
─────────────────────────────────────────────────────────────────────

用户访问临时用例
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  检查用户身份                                                    │
│                                                                  │
│  if (用户ID === 任务创建者ID || 用户角色 === 'admin') {          │
│    ✅ 允许访问                                                   │
│  } else {                                                        │
│    ❌ 拒绝访问: "您没有权限查看此任务的临时用例"                  │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
```

#### 5.4.2 用例状态流转

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         临时用例状态流转图                                   │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │   pending    │
                              │  (待确认)    │
                              └──────┬───────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
             ┌──────────┐    ┌──────────┐    ┌──────────┐
             │ approved │    │ rejected │    │ editing  │
             │ (已批准) │    │ (已拒绝) │    │ (编辑中) │
             └────┬─────┘    └────┬─────┘    └────┬─────┘
                  │               │               │
                  │               │               │
                  │               │               ▼
                  │               │        ┌──────────┐
                  │               │        │提交评审  │
                  │               │        │          │
                  │               │        └────┬─────┘
                  │               │             │
                  │               │             ▼
                  │               │      ┌──────────┐
                  │               │      │待评审    │
                  │               │      │reviewing │
                  │               │      └────┬─────┘
                  │               │           │
                  │               │    ┌──────┴──────┐
                  │               │    ▼             ▼
                  │               │ ┌────────┐ ┌────────┐
                  │               │ │评审通过│ │评审拒绝│
                  │               │ └───┬────┘ └───┬────┘
                  │               │     │          │
                  ▼               ▼     ▼          │
             ┌────────────────────────────┐        │
             │         merged             │◀───────┘
             │       (已合并)             │  退回修改
             └────────────────────────────┘

状态说明:
─────────────────────────────────────────────────────────────────────
┌────────────┬──────────────────────────────────────────────────────┐
│ 状态       │ 说明                                                  │
├────────────┼──────────────────────────────────────────────────────┤
│ pending    │ 初始状态，等待用户确认                                │
│ approved   │ 用户批准，可合并                                      │
│ rejected   │ 用户拒绝，不合并                                      │
│ editing    │ 用户正在编辑修改                                      │
│ reviewing  │ 已提交评审，等待审批                                  │
│ merged     │ 已合并到正式用例库                                    │
└────────────┴──────────────────────────────────────────────────────┘
```

#### 5.4.3 两种合并路径

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         合并路径选择                                         │
└─────────────────────────────────────────────────────────────────────────────┘

路径一: 直接合并 (跳过评审)
─────────────────────────────────────────────────────────────────────────────
适用场景: 用户对生成的用例有信心，希望快速入库

┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 编辑确认  │───▶│ 批准用例  │───▶│ 确认合并  │───▶│ 正式入库  │
│          │    │          │    │          │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘

路径二: 评审流程 (推荐)
─────────────────────────────────────────────────────────────────────────────
适用场景: 需要团队确认，保证用例质量

┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 编辑确认  │───▶│ 提交评审  │───▶│ 评审审批  │───▶│ 评审通过  │───▶│ 自动入库  │
│          │    │          │    │          │    │          │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                       │
                                       │ 评审拒绝
                                       ▼
                                ┌──────────┐
                                │ 退回修改  │
                                │          │
                                └──────────┘
```

#### 5.4.4 评审流程设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📋 AI生成结果预览                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  任务ID: TASK-20260425-001    生成时间: 2026/04/25 14:30                    │
│  模块: NetRx                创建人: zhaosz                                  │
│                                                                             │
│  统计摘要                                                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│  │ 总计: 18   │ │ 待确认: 14 │ │ 已批准: 2  │ │ 重复: 2    │              │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘              │
│                                                                             │
│  筛选: [全部 ▼] [待确认 ▼]    搜索: [                              ]       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☐ │ 用例名称                │ 优先级 │ 相似度 │ 状态   │ 操作      │   │
│  ├───┼─────────────────────────┼────────┼────────┼────────┼────────────│   │
│  │ ☐ │ NetRx Buffer基本功能    │ 高     │ -      │ 待确认 │ 👁️ ✏️ 🗑️ │   │
│  │ ☐ │ NetRx调度算法验证       │ 高     │ -      │ 待确认 │ 👁️ ✏️ 🗑️ │   │
│  │ ☐ │ Buffer溢出异常测试      │ 中     │ 92%    │ ⚠️重复 │ 👁️       │   │
│  │ ☐ │ NetRx性能压力测试       │ 中     │ -      │ 已批准 │ 👁️ ✏️ 🗑️ │   │
│  │...│ ...                     │ ...    │ ...    │ ...    │ ...        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ⚠️ 重复用例说明: 相似度≥85%的用例已标记为重复，建议删除或修改            │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [全选] [批量批准] [批量拒绝] [批量删除]                              │   │
│  │                                                                     │   │
│  │ ┌───────────────────────────────────────────────────────────────┐  │   │
│  │ │ 合并方式:                                                     │  │   │
│  │ │                                                               │  │   │
│  │ │ ○ 直接合并到正式库 (跳过评审)                                 │  │   │
│  │ │   - 适用于: 对用例质量有信心，希望快速入库                    │  │   │
│  │ │                                                               │  │   │
│  │ │ ● 提交评审流程 (推荐)                                         │  │   │
│  │ │   - 适用于: 需要团队确认，保证用例质量                        │  │   │
│  │ │   - 评审人: [张三, 李四 ▼]                                    │  │   │
│  │ │   - 评审截止: [2026-04-28 ▼]                                  │  │   │
│  │ │                                                               │  │   │
│  │ │                              [取消]  [确认提交]               │  │   │
│  │ └───────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5.4.5 评审页面 (评审人视角)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🔍 用例评审                                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  任务ID: TASK-20260425-001    提交人: zhaosz                                │
│  模块: NetRx                提交时间: 2026/04/25 15:00                      │
│  截止时间: 2026/04/28                                                       │
│                                                                             │
│  待评审用例: 16 个                                                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ☐ │ 用例名称                │ 优先级 │ 类型   │ 评审   │ 操作      │   │
│  ├───┼─────────────────────────┼────────┼────────┼────────┼────────────│   │
│  │ ☐ │ NetRx Buffer基本功能    │ 高     │ 功能   │ ⏳待审 │ 👁️ ✅ ❌  │   │
│  │ ☐ │ NetRx调度算法验证       │ 高     │ 功能   │ ✅通过 │ 👁️       │   │
│  │ ☐ │ Buffer溢出异常测试      │ 中     │ 异常   │ ❌拒绝 │ 👁️ 💬    │   │
│  │...│ ...                     │ ...    │ ...    │ ...    │ ...        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  💬 拒绝原因: [步骤描述不够清晰，请补充具体操作步骤              ]          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [全选] [批量通过] [批量拒绝]                    [提交评审结果]       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 5.4.6 评审结果处理

```
评审完成后自动处理:
─────────────────────────────────────────────────────────────────────────────

┌──────────────────────────────────────────────────────────────────┐
│  评审结果统计                                                    │
│                                                                  │
│  总用例数: 16                                                    │
│  通过: 14                                                        │
│  拒绝: 2                                                         │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Step 1: 记录评审结果到 case_review_records 表                   │
│                                                                  │
│  for each 评审的用例:                                            │
│    INSERT INTO case_review_records (                             │
│      task_id, temp_case_id, reviewer_id, result, comment         │
│    ) VALUES (?, ?, ?, 'approved'/'rejected', ?)                  │
│                                                                  │
│  说明: 无论通过还是拒绝，都会记录评审历史                         │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Step 2: 更新临时用例状态                                        │
│                                                                  │
│  通过的用例:                                                      │
│    - 更新 temp_test_cases.review_status = 'approved'            │
│    - 更新 temp_test_cases.reviewed_at = NOW()                   │
│    - 更新 temp_test_cases.reviewer_id = ?                       │
│                                                                  │
│  拒绝的用例:                                                      │
│    - 更新 temp_test_cases.review_status = 'rejected'            │
│    - 更新 temp_test_cases.review_comment = 拒绝原因              │
│    - 更新 temp_test_cases.reviewed_at = NOW()                   │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Step 3: 处理评审结果                                            │
│                                                                  │
│  通过的用例 → 自动合并到正式用例库                                │
│    - 更新 temp_test_cases.status = 'merged'                     │
│    - 插入 test_cases 表                                          │
│    - 记录 merged_case_id                                         │
│                                                                  │
│  拒绝的用例 → 退回生成者修改                                      │
│    - 更新 temp_test_cases.status = 'editing'                    │
│    - 发送通知给生成者                                            │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Step 4: 发送邮件通知                                            │
│                                                                  │
│  - 通知生成者评审结果 (包含通过/拒绝数量)                         │
│  - 通知评审人评审完成                                            │
│  - 如有拒绝，提醒生成者修改后重新提交                             │
└──────────────────────────────────────────────────────────────────┘
```

**评审记录完整性说明**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         评审记录追踪                                         │
└─────────────────────────────────────────────────────────────────────────────┘

case_review_records 表记录每次评审操作:

┌────┬─────────────┬───────────────┬─────────────┬──────────┬────────────────┐
│ id │ task_id     │ temp_case_id  │ reviewer_id │ result   │ comment        │
├────┼─────────────┼───────────────┼─────────────┼──────────┼────────────────┤
│ 1  │ TASK-001    │ TEMP-CASE-001 │ 5           │ approved │ 用例设计合理   │
│ 2  │ TASK-001    │ TEMP-CASE-002 │ 5           │ approved │                │
│ 3  │ TASK-001    │ TEMP-CASE-003 │ 5           │ rejected │ 步骤不够清晰   │
│ 4  │ TASK-001    │ TEMP-CASE-003 │ 3           │ approved │ 修改后通过     │
└────┴─────────────┴───────────────┴─────────────┴──────────┴────────────────┘

说明:
- 同一用例可能有多条评审记录 (如: 首次拒绝 → 修改后再次评审通过)
- 所有评审历史都会保留，便于追溯
- 支持多人评审场景 (可配置是否需要多人评审)
```

**评审服务实现**:

```javascript
class ReviewService {
  /**
   * 提交评审结果
   * @param {string} taskId - 任务ID
   * @param {Array} reviews - 评审结果数组
   * @param {number} reviewerId - 评审人ID
   */
  async submitReviewResults(taskId, reviews, reviewerId) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      for (const review of reviews) {
        await connection.execute(`
          INSERT INTO case_review_records 
            (task_id, temp_case_id, reviewer_id, result, comment)
          VALUES (?, ?, ?, ?, ?)
        `, [taskId, review.tempCaseId, reviewerId, review.result, review.comment]);
        
        const newStatus = review.result === 'approved' ? 'approved' : 'rejected';
        await connection.execute(`
          UPDATE temp_test_cases 
          SET review_status = ?, 
              reviewer_id = ?,
              review_comment = ?,
              reviewed_at = NOW()
          WHERE temp_case_id = ?
        `, [newStatus, reviewerId, review.comment, review.tempCaseId]);
      }
      
      const approvedCases = reviews.filter(r => r.result === 'approved');
      const rejectedCases = reviews.filter(r => r.result === 'rejected');
      
      if (approvedCases.length > 0) {
        await this.mergeApprovedCases(connection, approvedCases);
      }
      
      if (rejectedCases.length > 0) {
        await this.notifyCreatorForRevision(connection, taskId, rejectedCases);
      }
      
      await connection.commit();
      
      return {
        approved: approvedCases.length,
        rejected: rejectedCases.length
      };
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  
  /**
   * 合并通过的用例到正式库
   */
  async mergeApprovedCases(connection, approvedCases) {
    for (const review of approvedCases) {
      const [tempCases] = await connection.execute(`
        SELECT * FROM temp_test_cases WHERE temp_case_id = ?
      `, [review.tempCaseId]);
      
      if (tempCases.length === 0) continue;
      
      const tempCase = tempCases[0];
      
      const [result] = await connection.execute(`
        INSERT INTO test_cases 
          (module_id, name, priority, type, precondition, purpose, 
           steps, expected, key_config, remark, method, owner,
           environments, test_types, sources, phases, methods)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [tempCase.module_id, tempCase.name, tempCase.priority, tempCase.type,
          tempCase.precondition, tempCase.purpose, tempCase.steps, tempCase.expected,
          tempCase.key_config, tempCase.remark, tempCase.method, tempCase.owner,
          tempCase.environments, tempCase.test_types, tempCase.sources, 
          tempCase.phases, tempCase.methods]);
      
      await connection.execute(`
        UPDATE temp_test_cases 
        SET status = 'merged', merged_case_id = ?, merged_at = NOW()
        WHERE temp_case_id = ?
      `, [result.insertId, review.tempCaseId]);
    }
  }
  
  /**
   * 获取用例的评审历史
   */
  async getReviewHistory(tempCaseId) {
    const [records] = await pool.execute(`
      SELECT r.*, u.username as reviewer_name
      FROM case_review_records r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.temp_case_id = ?
      ORDER BY r.created_at DESC
    `, [tempCaseId]);
    
    return records;
  }
}
```

#### 5.4.7 数据库表更新

需要在 `temp_test_cases` 表增加评审相关字段：

```sql
ALTER TABLE `temp_test_cases` 
ADD COLUMN `review_status` enum('none','pending','approved','rejected') DEFAULT 'none' COMMENT '评审状态',
ADD COLUMN `reviewer_id` int DEFAULT NULL COMMENT '评审人ID',
ADD COLUMN `review_comment` text COMMENT '评审意见',
ADD COLUMN `reviewed_at` timestamp NULL DEFAULT NULL COMMENT '评审时间',
ADD COLUMN `review_deadline` timestamp NULL DEFAULT NULL COMMENT '评审截止时间';
```

新增评审记录表：

```sql
CREATE TABLE `case_review_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '任务ID',
  `temp_case_id` varchar(50) NOT NULL COMMENT '临时用例ID',
  `reviewer_id` int NOT NULL COMMENT '评审人ID',
  `result` enum('approved','rejected') NOT NULL COMMENT '评审结果',
  `comment` text COMMENT '评审意见',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_temp_case_id` (`temp_case_id`),
  KEY `idx_reviewer_id` (`reviewer_id`),
  CONSTRAINT `fk_review_task` FOREIGN KEY (`task_id`) REFERENCES `ai_case_generation_tasks` (`task_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例评审记录表';
```

---

## 六、安全与扩展性设计

### 6.1 安全设计

#### 6.1.1 权限控制

| 操作 | 所需权限 | 说明 |
|------|----------|------|
| 查看知识库 | 模块成员 | 可查看文件列表和内容 |
| 上传文件 | 模块编辑权限 | 可上传文件到知识库 |
| 删除文件 | 模块管理员 | 可删除文件和文件夹 |
| 发起生成任务 | 模块编辑权限 | 可创建AI生成任务 |
| 查看临时用例 | 任务创建者 或 管理员 | 只有创建者和管理员可见 |
| 编辑临时用例 | 任务创建者 | 只有创建者可编辑 |
| 直接合并用例 | 任务创建者 | 跳过评审直接合并到正式库 |
| 提交评审 | 任务创建者 | 提交用例进入评审流程 |
| 审批评审 | 管理员 或 指定评审人 | 评审通过或拒绝用例 |
| 管理生成配置 | 系统管理员 | 可配置AI模型和参数 |

**临时用例访问控制实现**:

```javascript
async function checkTempCaseAccess(taskId, userId) {
  const [tasks] = await pool.execute(`
    SELECT t.user_id, u.role
    FROM ai_case_generation_tasks t
    JOIN users u ON u.id = ?
    WHERE t.task_id = ?
  `, [userId, taskId]);
  
  if (tasks.length === 0) {
    return { allowed: false, reason: '任务不存在' };
  }
  
  const task = tasks[0];
  
  if (task.user_id === userId || task.role === 'admin') {
    return { allowed: true };
  }
  
  return { allowed: false, reason: '您没有权限查看此任务的临时用例' };
}
```

#### 6.1.2 数据安全

```javascript
const securityConfig = {
  fileUpload: {
    maxSize: 20 * 1024 * 1024,
    allowedExtensions: ['docx', 'doc', 'xlsx', 'xls', 'pdf', 'png', 'jpg', 'jpeg', 'drawio', 'vsdx'],
    scanForVirus: true
  },
  
  tempCase: {
    expireDays: 7,
    autoCleanup: true
  },
  
  rateLimit: {
    createTask: { windowMs: 3600000, max: 10 },
    uploadFile: { windowMs: 60000, max: 20 }
  }
};

async function cleanupExpiredTempCases() {
  const [result] = await pool.execute(`
    DELETE FROM temp_test_cases
    WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      AND status = 'pending'
  `, [securityConfig.tempCase.expireDays]);
  
  console.log(`清理了 ${result.affectedRows} 条过期临时用例`);
}
```

#### 6.1.3 SQL注入防护

```javascript
const { validateSQL } = require('../middleware/sqlValidator');

async function safeQuery(sql, params) {
  if (!validateSQL(sql)) {
    throw new Error('SQL验证失败');
  }
  
  return pool.execute(sql, params);
}
```

### 6.2 扩展性设计

#### 6.2.1 AI模型可扩展

```javascript
const aiModelRegistry = {
  'deepseek-chat': {
    name: 'DeepSeek Chat',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    embeddingEndpoint: 'https://api.deepseek.com/v1/embeddings',
    maxTokens: 4000,
    embeddingDimension: 1536
  },
  'gpt-4': {
    name: 'GPT-4',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    embeddingEndpoint: 'https://api.openai.com/v1/embeddings',
    maxTokens: 8000,
    embeddingDimension: 1536
  }
};

function registerAIModel(modelId, config) {
  aiModelRegistry[modelId] = config;
}
```

#### 6.2.2 文件解析器可扩展

```javascript
const parserRegistry = {};

function registerParser(extension, parserClass) {
  parserRegistry[extension.toLowerCase()] = parserClass;
}

function getParser(extension) {
  return parserRegistry[extension.toLowerCase()];
}

registerParser('docx', WordParser);
registerParser('xlsx', ExcelParser);
registerParser('pdf', PDFParser);
registerParser('md', MarkdownParser);
```

#### 6.2.3 查重算法可配置

```javascript
const dedupStrategies = {
  cosine: {
    name: '余弦相似度',
    calculate: (vecA, vecB) => calculateCosineSimilarity(vecA, vecB)
  },
  euclidean: {
    name: '欧氏距离',
    calculate: (vecA, vecB) => calculateEuclideanDistance(vecA, vecB)
  },
  jaccard: {
    name: 'Jaccard相似度',
    calculate: (setA, setB) => calculateJaccardSimilarity(setA, setB)
  }
};
```

### 6.3 监控与日志

```javascript
const logger = require('../utils/logger');

class TaskMonitor {
  logTaskStart(taskId, moduleId) {
    logger.info('TASK_START', { taskId, moduleId, timestamp: Date.now() });
  }
  
  logTaskProgress(taskId, progress, message) {
    logger.info('TASK_PROGRESS', { taskId, progress, message });
  }
  
  logTaskComplete(taskId, stats) {
    logger.info('TASK_COMPLETE', { 
      taskId, 
      totalCases: stats.total,
      duplicateCases: stats.duplicates,
      duration: stats.duration
    });
  }
  
  logTaskError(taskId, error) {
    logger.error('TASK_ERROR', { taskId, error: error.message, stack: error.stack });
  }
}
```

---

## 七、总结

### 7.1 架构优势

| 维度 | 传统方案 | 本系统方案 | 优势 |
|------|----------|------------|------|
| 任务队列 | Redis + Bull | MySQL状态机 + p-queue | 无需额外中间件 |
| 查重服务 | 向量数据库 | Node.js内存计算 | 简化技术栈 |
| 长文本处理 | RAG架构 | MySQL分块 + Map-Reduce | 实现简单可控 |
| 基础设施 | MySQL + Redis + 向量库 | **仅MySQL** | 部署运维成本低 |

### 7.2 性能指标

| 指标 | 预期值 |
|------|--------|
| 文件解析速度 | 10页/秒 |
| 文本切分速度 | 100KB/秒 |
| AI生成速度 | 2-4块/分钟 (受API限制) |
| 查重速度 | 10,000次比对/30ms |
| 内存占用 | <200MB (10万用例) |

### 7.3 适用场景

本系统设计适用于：
- 中小型测试团队 (10-100人)
- 用例规模 10万级以下
- 追求低运维成本的场景
- 需要快速迭代的项目

对于超大规模场景 (百万级用例)，建议后续引入向量数据库进行优化。

---

## 八、网页爬虫工具设计

### 8.1 技术选型

采用成熟的开源工具组合，无需自研爬虫核心：

| 组件 | 开源工具 | 用途 |
|------|----------|------|
| 浏览器自动化 | **Puppeteer** | 无头浏览器，支持动态页面渲染 |
| HTML解析 | **Cheerio** | jQuery风格的DOM操作，轻量高效 |
| 内容提取 | **Readability.js** (Mozilla) | 智能提取网页正文，去除广告导航 |
| 防爬规避 | **puppeteer-extra-plugin-stealth** | 规避反爬检测 |

### 8.2 爬虫服务架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         网页爬虫服务架构                                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户请求层                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 输入: URL + 可选的认证信息 (用户名/密码)                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              爬虫引擎层                                      │
│                                                                             │
│  ┌───────────────┐         ┌───────────────┐         ┌───────────────┐    │
│  │ 简单爬虫      │         │ 认证爬虫      │         │ 动态页面爬虫  │    │
│  │ (静态页面)    │         │ (需登录)      │         │ (SPA/JS渲染)  │    │
│  │               │         │               │         │               │    │
│  │ axios+cheerio │         │ puppeteer     │         │ puppeteer     │    │
│  │               │         │ + stealth     │         │ + wait        │    │
│  └───────────────┘         └───────────────┘         └───────────────┘    │
│           │                       │                         │              │
│           └───────────────────────┴─────────────────────────┘              │
│                                       │                                    │
└───────────────────────────────────────┼────────────────────────────────────┘
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              内容处理层                                      │
│                                                                             │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐              │
│  │ HTML清洗      │───▶│ 正文提取      │───▶│ Markdown转换  │              │
│  │ (去除广告/导航)│    │ (Readability) │    │ (保留结构)    │              │
│  └───────────────┘    └───────────────┘    └───────────────┘              │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              输出存储层                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 存入 ai_material_chunks 表，与其他材料统一处理                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 爬虫服务实现

```javascript
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const { Readability } = require('@mozilla/readability');

puppeteer.use(StealthPlugin());

class WebCrawlerService {
  constructor() {
    this.timeout = parseInt(process.env.CRAWLER_TIMEOUT) || 30000;
    this.userAgent = process.env.CRAWLER_USER_AGENT || 'xTest-Bot/1.0';
  }
  
  /**
   * 爬取网页内容
   * @param {string} url - 目标URL
   * @param {Object} options - 可选配置
   */
  async crawl(url, options = {}) {
    const { username, password, waitFor, selector } = options;
    
    if (username && password) {
      return this.crawlWithAuth(url, { username, password, waitFor, selector });
    }
    
    return this.crawlSimple(url, { waitFor, selector });
  }
  
  /**
   * 简单爬取 (无需认证)
   */
  async crawlSimple(url, options = {}) {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.setDefaultTimeout(this.timeout);
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      if (options.waitFor) {
        await page.waitForSelector(options.waitFor);
      }
      
      if (options.selector) {
        await page.waitForSelector(options.selector);
      }
      
      const html = await page.content();
      const content = this.extractContent(html, url);
      
      return {
        success: true,
        url,
        title: content.title,
        content: content.textContent,
        markdown: content.markdown,
        links: content.links
      };
      
    } finally {
      await browser.close();
    }
  }
  
  /**
   * 带认证的爬取
   */
  async crawlWithAuth(url, options = {}) {
    const { username, password, loginUrl, loginSelectors } = options;
    
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.setDefaultTimeout(this.timeout);
      
      if (loginUrl && loginSelectors) {
        await page.goto(loginUrl, { waitUntil: 'networkidle2' });
        
        await page.type(loginSelectors.username, username);
        await page.type(loginSelectors.password, password);
        await page.click(loginSelectors.submit);
        
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
      }
      
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const html = await page.content();
      const content = this.extractContent(html, url);
      
      return {
        success: true,
        url,
        title: content.title,
        content: content.textContent,
        markdown: content.markdown
      };
      
    } finally {
      await browser.close();
    }
  }
  
  /**
   * 提取网页正文
   */
  extractContent(html, url) {
    const $ = cheerio.load(html);
    
    $('script, style, nav, header, footer, aside, .ads, .sidebar').remove();
    
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ href, text });
      }
    });
    
    return {
      title: article?.title || $('title').text(),
      textContent: article?.textContent || $('body').text(),
      markdown: this.toMarkdown(article?.content || $('body').html(), $),
      links: links.slice(0, 50)
    };
  }
  
  /**
   * 转换为Markdown
   */
  toMarkdown(html, $) {
    if (!$) $ = cheerio.load(html);
    
    let markdown = '';
    
    $('h1, h2, h3, h4, h5, h6, p, ul, ol, table, pre, code').each((i, el) => {
      const tag = el.tagName.toLowerCase();
      const text = $(el).text().trim();
      
      switch (tag) {
        case 'h1':
          markdown += `# ${text}\n\n`;
          break;
        case 'h2':
          markdown += `## ${text}\n\n`;
          break;
        case 'h3':
          markdown += `### ${text}\n\n`;
          break;
        case 'h4':
          markdown += `#### ${text}\n\n`;
          break;
        case 'p':
          markdown += `${text}\n\n`;
          break;
        case 'ul':
        case 'ol':
          $(el).find('li').each((j, li) => {
            markdown += `- ${$(li).text().trim()}\n`;
          });
          markdown += '\n';
          break;
        case 'table':
          markdown += this.tableToMarkdown($(el), $);
          break;
        case 'pre':
        case 'code':
          markdown += `\`\`\`\n${text}\n\`\`\`\n\n`;
          break;
      }
    });
    
    return markdown;
  }
  
  /**
   * 表格转Markdown
   */
  tableToMarkdown($table, $) {
    let md = '';
    
    const $headers = $table.find('thead tr th, tr:first-child th, tr:first-child td');
    if ($headers.length > 0) {
      $headers.each((i, th) => {
        md += `| ${$(th).text().trim()} `;
      });
      md += '|\n';
      
      $headers.each((i, th) => {
        md += '| --- ';
      });
      md += '|\n';
    }
    
    $table.find('tbody tr, tr').each((i, tr) => {
      $(tr).find('td').each((j, td) => {
        md += `| ${$(td).text().trim()} `;
      });
      md += '|\n';
    });
    
    return md + '\n';
  }
}

module.exports = new WebCrawlerService();
```

### 8.4 支持的网站类型

| 类型 | 示例 | 处理方式 |
|------|------|----------|
| 静态页面 | 文档站、博客 | axios + cheerio |
| 动态页面 | SPA应用 | puppeteer + waitFor |
| 需登录页面 | 内部Wiki、Confluence | puppeteer + 表单登录 |
| API文档 | Swagger、API Blueprint | 特殊解析器 |

---

## 九、测试用例生成Skills设计

### 9.1 Skills架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         测试用例生成Skills架构                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              Skills管理层                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ai_skills 表 (复用现有表)                         │   │
│  │                                                                     │   │
│  │  - 系统内置Skills (is_system=1, is_public=1)                       │   │
│  │  - 用户自定义Skills (is_system=0, creator_id=用户ID)               │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Skills选择层                                    │
│                                                                             │
│  用户发起生成任务时选择:                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Skills选择: [默认测试用例生成Skill ▼]                               │   │
│  │                                                                     │   │
│  │  可选项:                                                            │   │
│  │  - 默认测试用例生成Skill (系统内置)                                  │   │
│  │  - 功能测试专用Skill (系统内置)                                      │   │
│  │  - 性能测试专用Skill (系统内置)                                      │   │
│  │  - 我的自定义Skill-1 (用户创建)                                      │   │
│  │  - 我的自定义Skill-2 (用户创建)                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Skills执行层                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  1. 加载Skill定义 (definition字段 - LLM Tool Schema)                │   │
│  │  2. 组装Prompt (Skill提示词 + 材料内容)                             │   │
│  │  3. 调用大模型API                                                   │   │
│  │  4. 解析返回结果                                                    │   │
│  │  5. 验证用例格式                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 默认测试用例生成Skill

系统内置的默认Skill，存储在 `ai_skills` 表中：

```sql
INSERT INTO `ai_skills` (
  `name`, 
  `display_name`, 
  `description`, 
  `definition`, 
  `execute_code`, 
  `category`, 
  `is_enabled`, 
  `is_system`, 
  `is_public`,
  `created_by`
) VALUES (
  'generate_test_cases',
  '测试用例生成',
  '根据需求文档材料自动生成标准化的测试用例，支持功能测试、性能测试、异常测试等多种类型',
  '{
    "type": "function",
    "function": {
      "name": "generate_test_cases",
      "description": "根据输入的需求材料生成测试用例",
      "parameters": {
        "type": "object",
        "required": ["module_context", "material_content"],
        "properties": {
          "module_context": {
            "type": "object",
            "description": "模块上下文信息",
            "properties": {
              "module_name": { "type": "string", "description": "模块名称" },
              "module_description": { "type": "string", "description": "模块描述" },
              "existing_case_style": { "type": "string", "description": "现有用例风格参考" }
            }
          },
          "material_content": {
            "type": "string",
            "description": "需求材料内容"
          },
          "case_count_limit": {
            "type": "integer",
            "description": "生成用例数量上限",
            "default": 20
          },
          "focus_areas": {
            "type": "array",
            "items": { "type": "string" },
            "description": "重点关注领域，如[\"功能\", \"性能\", \"安全\"]"
          }
        }
      }
    }
  }',
  '-- 此Skill主要用于Prompt模板，execute_code为空
-- 实际生成逻辑在CaseGeneratorService中实现
return { skill: "generate_test_cases", status: "ready" };',
  'test_generation',
  1,
  1,
  1,
  'system'
);
```

### 9.3 Skill提示词模板设计

```javascript
const defaultSkillPrompt = {
  name: 'generate_test_cases',
  displayName: '默认测试用例生成Skill',
  
  systemPrompt: `你是一个专业的测试用例设计专家，拥有丰富的软件测试经验。
你的任务是根据用户提供的需求材料，生成高质量、可执行的测试用例。

## 专业能力
1. 深入理解软件测试原理和方法
2. 熟悉各种测试类型：功能测试、性能测试、安全测试、兼容性测试等
3. 能够识别边界条件和异常场景
4. 善于设计可验证的测试步骤和预期结果

## 输出原则
1. 用例名称要简洁明确，能体现测试点
2. 测试步骤要具体可执行，编号清晰
3. 预期结果要明确可验证
4. 考虑正常场景和异常场景
5. 参考现有用例的命名和描述风格`,

  userPromptTemplate: `## 模块信息
模块名称: {{module_name}}
模块描述: {{module_description}}

## 现有用例风格参考
{{existing_case_style}}

## 需求材料内容
{{material_content}}

## 生成要求
1. 生成数量: 最多 {{case_count_limit}} 个用例
2. 重点关注: {{focus_areas}}
3. 仅根据材料内容生成，不要臆测

## 输出格式
严格按照以下JSON格式输出:
\`\`\`json
{
  "cases": [
    {
      "name": "用例名称",
      "priority": "高/中/低",
      "type": "功能测试/性能测试/压力测试/规格测试/异常测试",
      "precondition": "前置条件",
      "purpose": "测试目的",
      "steps": "1. 步骤1\\n2. 步骤2\\n3. 步骤3",
      "expected": "预期结果",
      "key_config": "关键配置(可选)",
      "remark": "备注(可选)"
    }
  ]
}
\`\`\``
};
```

### 9.4 内置Skills列表

| Skill名称 | 类型 | 用途 |
|-----------|------|------|
| `generate_test_cases` | 通用 | 默认测试用例生成，适用于所有场景 |
| `generate_functional_cases` | 功能测试 | 专注于功能验证，生成功能测试用例 |
| `generate_performance_cases` | 性能测试 | 专注于性能指标，生成性能测试用例 |
| `generate_security_cases` | 安全测试 | 专注于安全漏洞，生成安全测试用例 |
| `generate_exception_cases` | 异常测试 | 专注于异常场景，生成异常测试用例 |
| `generate_api_cases` | API测试 | 专注于接口测试，生成API测试用例 |

### 9.5 用户自定义Skill管理

#### 9.5.1 配置中心界面

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚙️ AI生成配置中心                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📋 Skills管理                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [新建Skill]                                                          │   │
│  │                                                                     │   │
│  │ 系统内置Skills:                                                     │   │
│  │ ┌───────────────────────────────────────────────────────────────┐  │   │
│  │ │ 📌 默认测试用例生成    通用    [查看]                          │  │   │
│  │ │ 📌 功能测试用例生成    功能    [查看]                          │  │   │
│  │ │ 📌 性能测试用例生成    性能    [查看]                          │  │   │
│  │ │ 📌 异常测试用例生成    异常    [查看]                          │  │   │
│  │ └───────────────────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │ 我的Skills:                                                         │   │
│  │ ┌───────────────────────────────────────────────────────────────┐  │   │
│  │ │ 📝 U12芯片专用Skill    自定义    [编辑] [删除] [分享]          │  │   │
│  │ │ 📝 NetRx模块Skill      自定义    [编辑] [删除] [分享]          │  │   │
│  │ └───────────────────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 9.5.2 Skill编辑界面

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ✏️ 编辑Skill                                                        [×]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  基本信息                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Skill名称:   [U12芯片专用测试用例生成                    ]          │   │
│  │ 描述:        [针对U12芯片特点的测试用例生成，包含寄存器测试等    ]  │   │
│  │ 分类:        [芯片测试 ▼]                                          │   │
│  │ ☑ 公开 (其他用户可以使用此Skill)                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  系统提示词 (定义AI的角色和能力)                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 你是一个专业的芯片测试用例设计专家，专注于U12系列芯片的测试。      │   │
│  │                                                                     │   │
│  │ 你的专业领域包括:                                                   │   │
│  │ 1. 寄存器读写测试                                                   │   │
│  │ 2. 中断处理测试                                                     │   │
│  │ 3. 时序测试                                                         │   │
│  │ 4. 功耗测试                                                         │   │
│  │ ...                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  用户提示词模板 (定义输入输出格式)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ## 芯片信息                                                         │   │
│  │ 芯片型号: {{chip_model}}                                           │   │
│  │ 模块名称: {{module_name}}                                          │   │
│  │                                                                     │   │
│  │ ## 需求材料                                                         │   │
│  │ {{material_content}}                                               │   │
│  │                                                                     │   │
│  │ ## 特殊要求                                                         │   │
│  │ - 必须包含寄存器地址                                                │   │
│  │ - 必须包含预期值和实际值比较                                        │   │
│  │ ...                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  测试与预览                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [使用示例材料测试]                                                   │   │
│  │                                                                     │   │
│  │ 预览结果:                                                           │   │
│  │ ┌───────────────────────────────────────────────────────────────┐  │   │
│  │ │ { "cases": [...] }                                            │  │   │
│  │ └───────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                              [取消]  [保存]                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.6 Skill API设计

```javascript
// routes/aiGenerationSkills.js

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, canModifyAISkill } = require('../middleware');

/**
 * 获取可用的Skills列表
 */
router.get('/skills', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  
  const [skills] = await pool.execute(`
    SELECT id, name, display_name, description, category, is_system, creator_id
    FROM ai_skills
    WHERE category = 'test_generation'
      AND is_enabled = 1
      AND (is_public = 1 OR creator_id = ?)
    ORDER BY is_system DESC, created_at DESC
  `, [userId]);
  
  res.json({
    success: true,
    data: skills.map(s => ({
      id: s.id,
      name: s.name,
      displayName: s.display_name,
      description: s.description,
      category: s.category,
      isSystem: s.is_system === 1,
      isOwner: s.creator_id === userId
    }))
  });
});

/**
 * 创建自定义Skill
 */
router.post('/skills', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { name, displayName, description, systemPrompt, userPromptTemplate, category, isPublic } = req.body;
  
  const definition = JSON.stringify({
    type: 'function',
    function: {
      name: name,
      description: description,
      parameters: {
        type: 'object',
        properties: {
          module_context: { type: 'object' },
          material_content: { type: 'string' }
        }
      }
    },
    prompts: {
      system: systemPrompt,
      userTemplate: userPromptTemplate
    }
  });
  
  const [result] = await pool.execute(`
    INSERT INTO ai_skills 
      (name, display_name, description, definition, category, is_system, is_public, creator_id, created_by)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `, [name, displayName, description, definition, category || 'test_generation', 
      isPublic ? 1 : 0, userId, req.user.username]);
  
  res.json({
    success: true,
    data: { id: result.insertId, name }
  });
});

/**
 * 更新自定义Skill
 */
router.put('/skills/:id', authenticateToken, canModifyAISkill, async (req, res) => {
  const { id } = req.params;
  const { displayName, description, systemPrompt, userPromptTemplate, isPublic } = req.body;
  
  const definition = JSON.stringify({
    prompts: {
      system: systemPrompt,
      userTemplate: userPromptTemplate
    }
  });
  
  await pool.execute(`
    UPDATE ai_skills 
    SET display_name = ?, description = ?, definition = ?, is_public = ?, updated_at = NOW()
    WHERE id = ? AND is_system = 0
  `, [displayName, description, definition, isPublic ? 1 : 0, id]);
  
  res.json({ success: true });
});

/**
 * 删除自定义Skill
 */
router.delete('/skills/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  const [result] = await pool.execute(`
    DELETE FROM ai_skills 
    WHERE id = ? AND is_system = 0 AND creator_id = ?
  `, [id, userId]);
  
  res.json({ success: result.affectedRows > 0 });
});

module.exports = router;
```

### 9.7 Skill与生成任务的关联

在任务配置中关联Skill：

```sql
-- ai_case_generation_tasks 表增加 skill_id 字段
ALTER TABLE `ai_case_generation_tasks` 
ADD COLUMN `skill_id` int DEFAULT NULL COMMENT '使用的Skill ID',
ADD KEY `idx_skill_id` (`skill_id`);
```

```javascript
// 创建任务时选择Skill
async createTask(moduleId, options) {
  const { skillId, ...otherOptions } = options;
  
  const [result] = await pool.execute(`
    INSERT INTO ai_case_generation_tasks 
      (task_id, module_id, skill_id, config, ...)
    VALUES (?, ?, ?, ?, ...)
  `, [taskId, moduleId, skillId || null, JSON.stringify(config), ...]);
  
  return result.insertId;
}

// 执行任务时加载Skill
async executeWithSkill(taskId) {
  const [tasks] = await pool.execute(`
    SELECT t.*, s.definition
    FROM ai_case_generation_tasks t
    LEFT JOIN ai_skills s ON t.skill_id = s.id
    WHERE t.task_id = ?
  `, [taskId]);
  
  const task = tasks[0];
  const skillDefinition = task.definition ? JSON.parse(task.definition) : null;
  
  const systemPrompt = skillDefinition?.prompts?.system || defaultSkillPrompt.systemPrompt;
  const userTemplate = skillDefinition?.prompts?.userTemplate || defaultSkillPrompt.userPromptTemplate;
  
  // 使用Skill的提示词模板生成用例
  // ...
}
```

---

## 十、总结与展望

### 10.1 系统特性总结

| 特性 | 说明 |
|------|------|
| **极简架构** | 仅依赖MySQL + Node.js，无Redis/向量库/MQ |
| **知识库管理** | VFS虚拟文件系统，支持目录树、同名文件处理 |
| **智能解析** | 支持多种文件格式，异步解析分块存储 |
| **AI生成** | Map-Reduce架构，支持自定义Skills |
| **安全落地** | 临时表隔离、权限控制、评审流程 |
| **网页爬虫** | 基于Puppeteer，支持静态/动态/需登录页面 |

### 10.2 后续扩展方向

1. **更多文件格式支持**: CAD图纸、视频解析
2. **多人协作评审**: 支持多人同时评审
3. **用例模板库**: 预定义用例模板，快速复用
4. **AI模型微调**: 基于历史用例微调专属模型
5. **自动化执行**: 生成的用例自动转换为自动化脚本
