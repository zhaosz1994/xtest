# xTest × TCL自动化测试用例生成 融合设计报告

> **版本**: v2.0  
> **日期**: 2026-05-20  
> **目标**: 将5阶段TCL自动化方案与xTest现有架构进行融合，最大化复用现有能力，最小化架构侵入

---

## 一、现状分析：xTest已有能力盘点

### 1.1 已有能力与5阶段方案的映射

| 5阶段方案 | xTest已有对应能力 | 复用度 | 差距 |
|-----------|------------------|--------|------|
| ① 数据准备 | VFS知识库 + 模块系统 + 文件上传（docx/xlsx/pdf/pptx/txt/md） | **80%** | 缺少CLI参考、TCL规范、测试方法论等分类标签 |
| ② 文档解析+知识入库 | `fileParserService.js` + `chunkingService.js`（结构感知/语义/父子切分 + Embedding生成） | **70%** | 当前用MySQL JSON存向量，非ChromaDB；embedding模型非BGE-M3 |
| ③ AI学习已有TCL用例 | `routes/scripts.js`（.tcl文件上传/管理）+ `agentExecutionEngine.js`（Sub-Agent） | **30%** | 无TCL脚本AI分析能力，无CLI命令/规范自动提取 |
| ④ 测试点扩展 | `level1PointService.js`（Global-Local Two-Pass，Map-Reduce骨架扫描） | **60%** | 缺少5维度扩展（功能/边界/异常/组合/状态），缺少RAG检索增强 |
| ⑤ TCL用例生成 | `caseGeneratorService.js`（AI生成自然语言用例）+ `reflectionPipeline.js`（反思管道） | **40%** | 输出格式为自然语言，非可执行TCL脚本；生成的TCL需能关联到测试用例 |

### 1.2 架构约束回顾

xTest遵循**极简实用主义"三不"原则**：

| 约束 | 当前替代方案 |
|------|------------|
| 不引入Redis | MySQL状态机 + p-queue |
| 不引入向量数据库 | MySQL JSON存储 + 内存余弦相似度 |
| 不使用复杂RAG | MySQL分块存储 + Map-Reduce |

**关键决策点**：5阶段方案要求引入ChromaDB + BGE-M3，这与"三不"原则存在冲突。融合方案需要在此做出取舍。

### 1.3 现有TCL脚本关联机制

xTest已有`test_case_scripts`表，支持将脚本文件关联到测试用例：

```sql
test_case_scripts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  test_case_id INT NOT NULL,          -- 关联的测试用例ID
  script_name VARCHAR(255) NOT NULL,  -- 脚本名称
  script_type VARCHAR(50) DEFAULT 'tcl', -- 脚本类型：tcl/py/sh/other
  description TEXT,                   -- 脚本描述
  file_path VARCHAR(500),             -- 上传文件的存储路径
  file_size BIGINT,                   -- 文件大小
  file_hash VARCHAR(64),              -- 文件MD5哈希值
  original_filename VARCHAR(255),     -- 原始文件名
  link_url VARCHAR(1000),             -- 外部链接URL
  link_title VARCHAR(255),            -- 链接显示标题
  link_type VARCHAR(20) DEFAULT 'external',
  order_index INT DEFAULT 0,          -- 排序序号
  creator VARCHAR(50) NOT NULL,       -- 创建人
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

**现有API**（`routes/scripts.js`）：

| API | 方法 | 功能 |
|-----|------|------|
| `/api/scripts/testcases/:id/scripts` | GET | 获取测试用例关联的脚本列表 |
| `/api/scripts/testcases/scripts/:scriptId` | GET | 获取脚本详情 |
| `/api/scripts/testcases/:id/scripts` | POST | 手动添加关联脚本 |
| `/api/scripts/testcases/scripts/:scriptId` | PUT | 更新脚本信息 |
| `/api/scripts/testcases/scripts/:scriptId` | DELETE | 删除关联脚本 |
| `/api/scripts/testcases/scripts/upload` | POST | 上传脚本文件 |
| `/api/scripts/testcases/scripts/download/:scriptId` | GET | 下载脚本文件 |
| `/api/scripts/testcases/scripts/batch` | POST | 批量添加脚本关联 |

---

## 二、融合策略：渐进式增强，非替换式重构

### 2.1 核心原则

1. **复用优先**：最大化复用xTest已有的文件解析、切分、AI调用、任务调度基础设施
2. **渐进引入**：ChromaDB作为可选组件，不破坏MySQL-only的部署模式
3. **双轨输出**：自然语言用例 + TCL脚本并行生成，用户自选
4. **知识闭环**：TCL学习结果回写知识库，形成"学习→生成→再学习"的飞轮
5. **脚本关联闭环**：生成的TCL脚本自动关联到对应测试用例，复用现有`test_case_scripts`机制

### 2.2 架构决策

| 决策项 | 方案 | 理由 |
|--------|------|------|
| 向量数据库 | **ChromaDB可选引入**，通过适配器模式封装 | 小规模部署继续用MySQL JSON；大规模/高精度场景启用ChromaDB |
| Embedding模型 | **复用现有embedding通道**，新增BGE-M3配置项 | `chunkingService.js`已有`generateEmbeddings()`，只需扩展模型选择 |
| TCL学习 | **新增`TCLLearningService`** | 独立于现有服务，不侵入`caseGeneratorService` |
| 5维度扩展 | **扩展`level1PointService`** | 在现有骨架扫描后增加扩展阶段 |
| TCL生成 | **新增`TCLGenerationService`** | 与`caseGeneratorService`并行，共享AI调用基础设施 |
| TCL→用例关联 | **复用`test_case_scripts`表** | 已有完整的CRUD API，只需在TCL生成后自动写入关联记录 |

---

## 三、融合架构设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              xTest 融合架构                                          │
│                                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                          ① 数据准备层 (复用+扩展)                              │  │
│  │                                                                               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │  │
│  │  │ 设计文档 │ │ CLI参考  │ │ 测试方法 │ │ TCL规范  │ │ 测试环境 │           │  │
│  │  │ (已有)   │ │ (新增)   │ │ (新增)   │ │ (新增)   │ │ (新增)   │           │  │
│  │  │ VFS知识库│ │ VFS知识库│ │ VFS知识库│ │ VFS知识库│ │ VFS知识库│           │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘           │  │
│  │         │              │             │             │             │             │  │
│  │         └──────────────┴─────────────┴─────────────┴─────────────┘             │  │
│  │                                    │                                          │  │
│  │                     文件类型标签(file_category)                                │  │
│  │         design | cli | methodology | tcl_convention | environment              │  │
│  └───────────────────────────────────┬───────────────────────────────────────────┘  │
│                                      │                                              │
│                                      ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                    ② 文档解析 + 知识入库 (复用+增强)                            │  │
│  │                                                                               │  │
│  │  fileParserService.js ──> chunkingService.js ──> EmbeddingAdapter             │  │
│  │       (已有)                   (已有)               (新增适配层)               │  │
│  │                                                         │                    │  │
│  │                                              ┌─────────┴─────────┐           │  │
│  │                                              │                   │           │  │
│  │                                         MySQL JSON         ChromaDB          │  │
│  │                                         (默认/轻量)      (可选/高精度)        │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                              │
│                                      ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                    ③ AI学习已有TCL用例 (内嵌于解析流程)                        │  │
│  │                                                                               │  │
│  │  fileParserService.parseAndChunk()                                            │  │
│  │    └── [后处理] file_category='tcl_script' 时自动触发                         │  │
│  │         ├── TCL脚本解析器 ──> 提取CLI命令模式                                  │  │
│  │         ├── LLM分析 ──> cli-reference.md (CLI命令知识)                        │  │
│  │         └── LLM分析 ──> tcl-conventions.md (TCL编写规范)                      │  │
│  │         │                                                                     │  │
│  │         ▼                                                                     │  │
│  │  学习结果 → EmbeddingAdapter → MySQL/ChromaDB (回写知识库)                     │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                              │
│                                      ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                    ④ 测试点扩展 (复用+增强)                                     │  │
│  │                                                                               │  │
│  │  level1PointService.js (已有Global-Local Two-Pass)                            │  │
│  │         │                                                                     │  │
│  │         ├── 阶段一: 全局感知 (已有，不变)                                      │  │
│  │         │                                                                     │  │
│  │         ├── 阶段二: 5维度扩展 (新增)                                           │  │
│  │         │    TestPointExpansionService (新增)                                  │  │
│  │         │    ├── RAG检索相关知识 (通过EmbeddingAdapter)                         │  │
│  │         │    ├── LLM按5维度扩展: 功能|边界|异常|组合|状态                       │  │
│  │         │    └── 输出: 扩展测试点(MD) + 导出Excel                              │  │
│  │         │                                                                     │  │
│  │         └── 阶段三: 用例生成 (已有，不变)                                      │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                      │                                              │
│                                      ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                    ⑤ TCL用例生成 + 执行验证 + 脚本关联 (新增)                    │  │
│  │                                                                               │  │
│  │  TCLGenerationService (新增)                                                  │  │
│  │    ├── 输入: 测试点.md + ChromaDB/MySQL检索的CLI命令+TCL规范                   │  │
│  │    ├── Sub-Agent驱动 (复用agentExecutionEngine)                                │  │
│  │    ├── LLM生成结构化TCL脚本                                                    │  │
│  │    ├── ReflectionPipeline静态校验 (复用反思管道)                                │  │
│  │    ├── ScriptRunner动态执行验证 (新增，Python预埋)                              │  │
│  │    ├── 自修复闭环: 执行失败 → 日志回捞 → LLM修复 → 重新执行                    │  │
│  │    ├── 输出: .tcl脚本文件 → uploads/scripts/                                   │  │
│  │    └── 自动关联: 写入test_case_scripts表 (复用现有关联机制)                     │  │
│  │                                                                               │  │
│  │  生成模块化脚本，必须包含Setup(初始化)、Test Steps(执行/验证)、                 │  │
│  │  Teardown(脏数据清理)及异常捕获机制                                            │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流全景图

```
用户操作                    系统处理                         存储
─────────                  ─────────                       ─────

上传设计文档 ──────> fileParserService.parseAndChunk() ──> ai_material_chunks
上传CLI参考  ──────> fileParserService.parseAndChunk() ──> ai_material_chunks
上传TCL规范  ──────> fileParserService.parseAndChunk() ──> ai_material_chunks
上传已有TCL  ──────> fileParserService.parseAndChunk()
                        ├── 常规解析入库            ──> ai_material_chunks
                        └── TCL学习后处理(自动追加) ──> ai_material_chunks
                                                        (cli-reference知识)
                                                        (tcl-convention知识)

点击"扩展测试点" ─> TestPointExpansionService.expand()
                     ├── EmbeddingAdapter.search(测试领域)
                     ├── LLM 5维度扩展
                     └── 输出扩展测试点              ──> temp_level1_points

点击"生成TCL" ───> TCLGenerationService.generate()
                     ├── 加载测试点
                     ├── RAG检索CLI命令+TCL规范
                     ├── Sub-Agent生成结构化TCL (Setup/Steps/Teardown)
                     ├── ReflectionPipeline静态校验
                     ├── ScriptRunner动态执行验证 (可选)
                     ├── 自修复闭环 (执行失败→日志回捞→LLM修复)
                     ├── 输出.tcl文件               ──> uploads/scripts/
                     └── 自动关联到测试用例          ──> test_case_scripts
```

---

## 四、各类文档上传流程详细设计

### 4.1 上传入口统一：VFS知识库

**核心思路**：所有5类文档统一通过VFS知识库上传，通过`file_category`字段区分类型。用户无需到不同页面上传不同类型文件，一个知识库界面搞定所有文档管理。

#### 4.1.1 上传入口位置

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         xTest 主界面                                        │
│                                                                             │
│  ┌─────────┐                                                                │
│  │ 模块列表 │                                                                │
│  │         │     ┌──────────────────────────────────────────────────────┐   │
│  │ ▶ QoS   │     │              知识库 (VFS)                            │   │
│  │ ▶ 路由  │────▶│                                                        │   │
│  │ ▶ ACL   │     │  ┌────────────────────────────────────────────────┐ │   │
│  │         │     │  │  📁 设计文档          📁 CLI参考               │ │   │
│  │         │     │  │    PRD_v2.docx          cli_cmds_qos.xlsx      │ │   │
│  │         │     │  │    需求规格.pdf          show_commands.md       │ │   │
│  │         │     │  │                                                    │ │   │
│  │         │     │  │  📁 测试方法论        📁 TCL规范                │ │   │
│  │         │     │  │    测试策略.md          tcl_coding_std.md       │ │   │
│  │         │     │  │    边界值方法.docx       命名规范.docx          │ │   │
│  │         │     │  │                                                    │ │   │
│  │         │     │  │  📁 测试环境          📁 已有TCL脚本           │ │   │
│  │         │     │  │    env_config.md         qos_basic_test.tcl     │ │   │
│  │         │     │  │    拓扑说明.xlsx          acl_stress_test.tcl   │ │   │
│  │         │     │  └────────────────────────────────────────────────┘ │   │
│  │         │     │                                                        │   │
│  │         │     │  [+ 上传文件]  [+ 新建文件夹]  [🤖 重新学习TCL]     │   │
│  │         │     └──────────────────────────────────────────────────────┘   │
│  └─────────┘                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.1.2 上传对话框设计

用户点击"上传文件"按钮后，弹出上传对话框：

```
┌──────────────────────────────────────────────────────────────────┐
│  上传文件到知识库                                           [×]  │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  文件分类:  [▼ 设计文档        ]  ← 下拉选择，必填              │
│                                                                  │
│             选项:                                                │
│             ├── 设计文档 (design)         ← .docx .pdf .pptx    │
│             ├── CLI参考 (cli)             ← .xlsx .md .txt      │
│             ├── 测试方法论 (methodology)   ← .md .docx .pdf     │
│             ├── TCL规范 (tcl_convention)  ← .md .docx .txt      │
│             ├── 测试环境 (environment)    ← .md .xlsx .txt      │
│             ├── 测试计划 (test_plan)      ← .xlsx               │
│             └── 已有TCL脚本 (tcl_script)  ← .tcl .py .sh       │
│                                                                  │
│  目标位置:  [▼ 选择挂载位置...  ]  ← 树形选择器，支持3种层级     │
│             详见 4.1.5 灵活的文件挂载位置                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                                                          │   │
│  │     📎 拖拽文件到此处，或点击选择文件                     │   │
│  │                                                          │   │
│  │     支持批量上传（最多10个文件）                          │   │
│  │                                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ☑ 上传后自动解析入库                                           │
│  (TCL脚本上传后将自动解析+AI学习，无需额外操作)                  │
│                                                                  │
│                              [取消]  [上传]                      │
└──────────────────────────────────────────────────────────────────┘
```

#### 4.1.3 各类文档上传流程详解

##### A. 设计文档上传流程

```
用户操作                              系统处理                              存储
────────                              ─────────                              ─────

1. 选择文件分类 "设计文档"
2. 选择文件 PRD_v2.docx
3. 点击上传
                                      4. vfsService.uploadFile()
                                         ├── 保存文件到 uploads/knowledge/{moduleId}/{uuid}.docx
                                         ├── 写入 module_knowledge_files 表
                                         │   file_category = 'design'
                                         └── 触发异步解析
                                      5. fileParserService.asyncParseFile()
                                         ├── 解析docx → 纯文本
                                         ├── 切分策略: structure_aware (默认)
                                         │   或 semantic_parent_child
                                         ├── chunkingService.saveParentChildChunks()
                                         └── 写入 ai_material_chunks 表
                                                                         ai_material_chunks
                                                                         (chunk_content,
                                                                          chunk_type,
                                                                          chunking_strategy)
```

**API调用**：
```
POST /api/knowledge/upload
Content-Type: multipart/form-data

file: PRD_v2.docx
moduleId: 5
parentId: 12              (目标文件夹ID)
libraryId: 3
fileCategory: design       ← 新增参数
```

**后端改动**：`routes/knowledge.js` 的 `/upload` 接口增加 `fileCategory` 参数处理

##### B. CLI参考上传流程

```
用户操作                              系统处理                              存储
────────                              ─────────                              ─────

1. 选择文件分类 "CLI参考"
2. 选择文件 cli_cmds_qos.xlsx
3. 点击上传
                                      4. vfsService.uploadFile()
                                         ├── 保存文件
                                         ├── 写入 module_knowledge_files
                                         │   file_category = 'cli'
                                         └── 触发异步解析
                                      5. fileParserService.asyncParseFile()
                                         ├── 解析xlsx → 纯文本
                                         │   (保留表格结构，命令|语法|参数|说明)
                                         ├── 切分策略: structure_aware
                                         └── 写入 ai_material_chunks
                                                                         ai_material_chunks
                                                                         (CLI命令知识块)
```

**与设计文档的区别**：
- `file_category = 'cli'`
- 切分时保留表格行结构（一个CLI命令不跨chunk）
- 后续RAG检索时按`file_category='cli'`过滤

##### C. 测试方法论上传流程

```
用户操作                              系统处理                              存储
────────                              ─────────                              ─────

1. 选择文件分类 "测试方法论"
2. 选择文件 测试策略.md
3. 点击上传
                                      4. vfsService.uploadFile()
                                         ├── file_category = 'methodology'
                                         └── 触发异步解析
                                      5. fileParserService.asyncParseFile()
                                         ├── 解析md → 纯文本
                                         ├── 切分策略: structure_aware
                                         └── 写入 ai_material_chunks
                                                                         ai_material_chunks
                                                                         (方法论知识块)
```

##### D. TCL规范上传流程

```
用户操作                              系统处理                              存储
────────                              ─────────                              ─────

1. 选择文件分类 "TCL规范"
2. 选择文件 tcl_coding_std.md
3. 点击上传
                                      4. vfsService.uploadFile()
                                         ├── file_category = 'tcl_convention'
                                         └── 触发异步解析
                                      5. fileParserService.asyncParseFile()
                                         ├── 解析md → 纯文本
                                         ├── 切分策略: structure_aware
                                         └── 写入 ai_material_chunks
                                                                         ai_material_chunks
                                                                         (TCL规范知识块)
```

##### E. 已有TCL脚本上传流程（增强型单通道）

**TCL脚本上传采用"增强型单通道"设计：常规解析+AI学习合为一条流水线，用户只需一次上传操作，系统自动完成全部处理。**

```
用户操作                              系统处理                              存储
────────                              ─────────                              ─────

1. 选择文件分类 "已有TCL脚本"
   (系统自动推荐，.tcl文件默认选中)
2. 选择文件 qos_basic_test.tcl
3. 点击上传
                                      4. vfsService.uploadFile()
                                         ├── 保存文件到 uploads/knowledge/{moduleId}/{uuid}.tcl
                                         ├── 写入 module_knowledge_files
                                         │   file_category = 'tcl_script'
                                         └── 触发异步解析

                                      5. fileParserService.parseAndChunk()  ← 增强型单通道
                                         │
                                         ├── [Step 1] 常规解析（与设计文档相同）
                                         │   ├── 解析tcl → 纯文本
                                         │   ├── 切分策略: structure_aware
                                         │   │   (按proc/测试步骤切分)
                                         │   └── 写入 ai_material_chunks
                                         │                                       ai_material_chunks
                                         │                                       (TCL脚本原始知识块)
                                         │
                                         ├── [Step 2] 检测 file_category = 'tcl_script'
                                         │   └── 自动触发 TCL学习后处理
                                         │
                                         └── [Step 3] TCL学习后处理（自动追加）
                                             ├── 读取TCL文件内容
                                             ├── 正则提取CLI命令模式
                                             ├── LLM深度分析:
                                             │   ├── 提取 cli-reference.md
                                             │   └── 提取 tcl-conventions.md
                                             ├── 学习结果切分+向量化
                                             └── 写入 ai_material_chunks
                                                                                 ai_material_chunks
                                                                                 (cli-reference知识块)
                                                                                 (tcl-convention知识块)
                                                                                 tcl_learning_results
                                                                                 (学习结果记录)
```

**关键设计**：TCL脚本上传走增强型单通道，AI学习作为 `parseAndChunk()` 的后处理步骤自动追加

| 步骤 | 处理内容 | 存储位置 | 说明 |
|------|---------|---------|------|
| Step 1 | 常规解析+切分 | `ai_material_chunks` | 与设计文档完全相同的流程，TCL原始内容作为知识块可被RAG检索 |
| Step 2 | 分类检测 | — | `parseAndChunk()` 完成常规切分后，查询 `module_knowledge_files.file_category`，若为 `tcl_script` 则自动进入Step 3 |
| Step 3 | TCL学习后处理 | `ai_material_chunks` + `tcl_learning_results` | LLM分析提取CLI命令模式和TCL编写规范，生成结构化知识块回写知识库 |

**合并双通道为单通道的优势**：

| 维度 | 双通道方案（旧） | 增强型单通道（新） |
|------|----------------|------------------|
| 用户操作 | 需勾选"上传后自动学习" | 无需额外操作，上传即学习 |
| 实现复杂度 | 两个独立触发点，需协调状态 | 一个触发点，状态机线性流转 |
| 状态一致性 | 可能出现"已上传但未学习"的中间态 | 解析完成即学习完成，无中间态 |
| 失败处理 | 通道1成功+通道2失败需单独重试 | 整体失败可一键重试（reparse） |
| 代码侵入 | 需在vfsService中增加通道2触发逻辑 | 仅在fileParserService中增加后处理分支 |

**`fileParserService.parseAndChunk()` 增强逻辑伪代码**：

```javascript
async parseAndChunk(fileId, options = {}) {
  // ... 现有解析+切分逻辑不变 ...

  // 常规解析完成后，检查是否需要TCL学习后处理
  const [files] = await pool.execute(
    'SELECT file_category, module_id FROM module_knowledge_files WHERE id = ?',
    [fileId]
  );
  
  if (files.length > 0 && files[0].file_category === 'tcl_script') {
    try {
      // 更新解析状态为"学习中"（复用parse_status字段）
      await pool.execute(
        "UPDATE module_knowledge_files SET parse_status = 'learning' WHERE id = ?",
        [fileId]
      );
      
      // 自动触发TCL学习后处理
      const tclLearningService = require('./tclLearningService');
      await tclLearningService.analyzeFromFile(fileId, files[0].module_id);
      
      // 学习完成
      await pool.execute(
        "UPDATE module_knowledge_files SET parse_status = 'parsed' WHERE id = ?",
        [fileId]
      );
    } catch (error) {
      // 学习失败不影响常规解析结果，降级为仅原始知识块
      logger.warn('TCL学习后处理失败，降级为仅原始知识块', { fileId, error: error.message });
      await pool.execute(
        "UPDATE module_knowledge_files SET parse_status = 'parsed', parse_error = ? WHERE id = ?",
        [`TCL学习失败: ${error.message}`, fileId]
      );
    }
  }
}
```

**`module_knowledge_files.parse_status` 扩展**：

```sql
-- 新增解析状态值
-- 现有: pending → parsing → parsed / failed
-- 扩展: pending → parsing → learning → parsed / failed
--                       ↑ 仅tcl_script分类经过此状态

ALTER TABLE module_knowledge_files
MODIFY COLUMN parse_status VARCHAR(20) DEFAULT 'pending'
COMMENT '解析状态: pending|parsing|learning|parsed|failed';
```

**前端解析状态展示**：

| parse_status | 显示文案 | 说明 |
|-------------|---------|------|
| pending | 等待解析 | — |
| parsing | 正在解析... | — |
| learning | 正在学习... | 仅tcl_script文件显示 |
| parsed | 解析完成 | — |
| failed | 解析失败 | — |

#### 4.1.4 智能分类建议

为降低用户操作成本，系统根据文件扩展名自动推荐分类：

| 文件扩展名 | 自动推荐分类 | 用户可修改 |
|-----------|-------------|-----------|
| .docx .doc .pdf .pptx | 设计文档 (design) | ✅ |
| .xlsx .xls | CLI参考 (cli) 或 测试计划 (test_plan) | ✅ |
| .tcl | 已有TCL脚本 (tcl_script) | ✅ |
| .py .sh .pl .rb .js | 已有TCL脚本 (tcl_script) | ✅ |
| .md .txt (含"规范"/"convention"关键词) | TCL规范 (tcl_convention) | ✅ |
| .md .txt (含"方法"/"methodology"关键词) | 测试方法论 (methodology) | ✅ |
| .md .txt (含"环境"/"environment"关键词) | 测试环境 (environment) | ✅ |
| .md .txt (其他) | 设计文档 (design) | ✅ |

#### 4.1.5 灵活的文件挂载位置

用户上传文件时，可以选择将文件挂载到VFS树的任意位置，支持以下三种挂载层级：

**挂载层级一：用例库根目录**

文件直接挂在用例库的根级别，不属于任何模块。系统自动按分类创建默认文件夹：

```
📁 QoS用例库 (library_id=3)
├── 📁 设计文档/              ← file_category='design' 的默认归档位置
├── 📁 CLI参考/               ← file_category='cli'
├── 📁 测试方法论/            ← file_category='methodology'
├── 📁 TCL规范/               ← file_category='tcl_convention'
├── 📁 测试环境/              ← file_category='environment'
├── 📁 测试计划/              ← file_category='test_plan'
└── 📁 已有TCL脚本/           ← file_category='tcl_script'
```

**数据库特征**：`library_id = 用例库ID`, `module_id = NULL`, `parent_id = 分类文件夹ID`

**挂载层级二：模块（一级测试点）下**

文件挂在某个模块下，属于该模块的专属知识资产。同样支持按分类自动归档：

```
📁 QoS用例库 (library_id=3)
├── 📁 设计文档/              ← 用例库级别
├── 📁 CLI参考/
└── 📁 Buffer管理 (module_id=12)  ← 模块级别
    ├── 📁 设计文档/          ← 模块下的分类文件夹
    ├── 📁 CLI参考/
    └── 📁 已有TCL脚本/
        └── qos_buffer_test.tcl
```

**数据库特征**：`library_id = 用例库ID`, `module_id = 模块ID`, `parent_id = 分类文件夹ID`

**挂载层级三：自定义文件夹下**

文件挂在用户手动创建的自定义文件夹下，灵活组织：

```
📁 QoS用例库 (library_id=3)
├── 📁 设计文档/              ← 用例库级别
├── 📁 Buffer管理 (module_id=12)  ← 模块级别
│   └── 📁 已有TCL脚本/
└── 📁 2026年Q2测试 (自定义文件夹, module_id=NULL, parent_id=NULL)
    ├── 📁 设计文档/          ← 自定义文件夹下的分类子文件夹
    ├── PRD_v2.docx           ← 也可以直接放文件，不建分类子文件夹
    └── 📁 Buffer管理 (module_id=12, parent_id=自定义文件夹ID)
        └── qos_buffer_test.tcl
```

**数据库特征**：`library_id = 用例库ID`, `module_id` 可选, `parent_id = 自定义文件夹ID`

**上传对话框的"目标位置"交互设计**：

```
┌──────────────────────────────────────────────────────────────────┐
│  上传文件到知识库                                           [×]  │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  文件分类:  [▼ 已有TCL脚本     ]  ← 决定分类标签和默认归档位置   │
│                                                                  │
│  目标位置:  [▼ 选择挂载位置...                                  ]│
│                                                                  │
│             树形选择器:                                          │
│             ├── 📁 QoS用例库                                    │
│             │   ├── 📁 设计文档              ← 用例库根目录+分类 │
│             │   ├── 📁 CLI参考               ← 用例库根目录+分类 │
│             │   ├── 📁 已有TCL脚本           ← 用例库根目录+分类 │
│             │   ├── 📁 Buffer管理            ← 模块级别         │
│             │   │   └── 📁 已有TCL脚本       ← 模块下+分类      │
│             │   └── 📁 2026年Q2测试          ← 自定义文件夹     │
│             │       └── 📁 已有TCL脚本       ← 自定义+分类      │
│             └── 📁 路由用例库                                    │
│                 ├── 📁 设计文档                                  │
│                 └── 📁 OSPF测试                                  │
│                                                                  │
│  ☑ 自动创建分类子文件夹 (如果目标位置下不存在对应分类文件夹)     │
│                                                                  │
│  说明:                                                           │
│  - 选择分类文件夹 → 文件直接放入该文件夹                         │
│  - 选择模块 → 自动在模块下创建/查找对应分类子文件夹              │
│  - 选择用例库根 → 自动在根目录下创建/查找对应分类子文件夹        │
│  - 选择自定义文件夹 → 自动在该文件夹下创建/查找分类子文件夹      │
│                                                                  │
│                              [取消]  [上传]                      │
└──────────────────────────────────────────────────────────────────┘
```

**自动归档逻辑**：

用户选择目标位置后，系统按以下规则确定文件的最终挂载点：

```
用户选择的目标位置                系统处理                              最终挂载点
────────────────                ─────────                              ──────────

选择了一个分类文件夹              直接放入                              该文件夹
(如: "QoS用例库/已有TCL脚本")

选择了一个模块                   查找/创建模块下的分类子文件夹           模块/分类文件夹
(如: "Buffer管理")              (如: Buffer管理/已有TCL脚本/)

选择了用例库根目录               查找/创建根目录下的分类文件夹           用例库根/分类文件夹
(如: "QoS用例库")               (如: QoS用例库/已有TCL脚本/)

选择了一个自定义文件夹            查找/创建该文件夹下的分类子文件夹       自定义文件夹/分类文件夹
(如: "2026年Q2测试")            (如: 2026年Q2测试/已有TCL脚本/)
```

**分类文件夹查找/创建规则**：

```javascript
async findOrCreateCategoryFolder(targetParentId, fileCategory, moduleId, libraryId, userId) {
  const categoryFolderNames = {
    design: '设计文档',
    cli: 'CLI参考',
    methodology: '测试方法论',
    tcl_convention: 'TCL规范',
    environment: '测试环境',
    test_plan: '测试计划',
    tcl_script: '已有TCL脚本'
  };

  const folderName = categoryFolderNames[fileCategory];

  let query, params;
  if (moduleId) {
    query = `SELECT id FROM module_knowledge_files
             WHERE module_id = ? AND parent_id ${targetParentId ? '= ?' : 'IS NULL'}
               AND name = ? AND type = 'folder' AND deleted_at IS NULL`;
    params = targetParentId ? [moduleId, targetParentId, folderName] : [moduleId, folderName];
  } else {
    query = `SELECT id FROM module_knowledge_files
             WHERE library_id = ? AND (module_id IS NULL OR module_id = 0)
               AND parent_id ${targetParentId ? '= ?' : 'IS NULL'}
               AND name = ? AND type = 'folder' AND deleted_at IS NULL`;
    params = targetParentId ? [libraryId, targetParentId, folderName] : [libraryId, folderName];
  }

  const [existing] = await pool.execute(query, params);

  if (existing.length > 0) {
    return existing[0].id;
  }

  return await vfsService.createFolder(libraryId, moduleId, targetParentId, folderName, userId);
}
```

**关键设计原则**：

1. **分类标签与挂载位置解耦**：`file_category` 是文件的元数据标签，与文件在VFS树中的位置无关。无论文件挂在哪个层级，`file_category` 都正确标记，RAG检索时按 `file_category` 过滤
2. **分类文件夹是可选的便利设施**：用户可以关闭"自动创建分类子文件夹"，直接将文件放入选定的目标位置
3. **跨模块共享**：挂在用例库根目录的分类文件夹下的文件，所有模块的RAG检索都能命中
4. **模块专属**：挂在模块下的文件，优先服务于该模块的AI生成任务

#### 4.1.6 "重新学习TCL脚本"按钮

知识库界面增加"🤖 重新学习"按钮，用于对TCL脚本重新执行AI学习（适用于学习失败后重试，或需要重新提取知识的场景）：

```
触发条件:
  - 当前知识库中存在 file_category='tcl_script' 的文件
  - 且该文件解析状态为 parsed 或 failed

点击后:
  1. 列出所有TCL脚本文件及其学习状态
     ├── ✅ 已学习 (tcl_learning_results 中有记录)
     ├── ❌ 学习失败 (parse_error 包含 "TCL学习失败")
     └── ⏳ 未学习 (无学习记录)
  2. 用户勾选要(重新)学习的脚本（支持全选）
  3. 确认后触发 reparse 流程
  4. fileParserService.reparseFile() 自动走增强型单通道
  5. 完成后通知用户，学习结果可在知识库中查看

说明:
  - 上传TCL脚本时已自动完成AI学习，此按钮主要用于重试/重新学习
  - 重新学习会先清除旧的 tcl_learning_results 和衍生知识块
```

---

## 五、各阶段详细设计

### 5.1 阶段① 数据准备层 — 复用VFS + 扩展分类标签

**改动范围**：最小化，仅扩展`module_knowledge_files`表

**数据库变更**：

```sql
ALTER TABLE module_knowledge_files 
ADD COLUMN file_category VARCHAR(50) DEFAULT 'design' 
COMMENT '文件分类: design|cli|methodology|tcl_convention|environment|test_plan|tcl_script';

CREATE INDEX idx_knowledge_files_category ON module_knowledge_files(file_category);
```

**前端变更**：知识库上传对话框增加"文件分类"下拉选择

**复用点**：
- `vfsService.js` — 完全复用
- `fileParserService.js` — 完全复用
- `routes/knowledge.js` — 增加category参数

### 5.2 阶段② 文档解析+知识入库 — EmbeddingAdapter适配层

**核心设计**：引入`EmbeddingAdapter`抽象层，屏蔽底层向量存储差异

```
┌─────────────────────────────────────────┐
│           EmbeddingAdapter              │
│                                        │
│  generateEmbedding(texts, model)       │
│  search(query, topK, filters)          │
│  upsert(id, embedding, metadata)       │
│  delete(id)                            │
└──────────┬──────────────┬──────────────┘
           │              │
    ┌──────▼──────┐ ┌────▼──────────┐
    │ MySQLEmbed  │ │ ChromaDBEmbed │
    │  (默认)     │ │  (可选)       │
    └─────────────┘ └───────────────┘
```

**新增文件**：`services/embeddingAdapter.js`

**关键接口**：

```javascript
class EmbeddingAdapter {
  constructor() {
    this.backend = process.env.EMBEDDING_BACKEND || 'mysql';
  }

  async generateEmbedding(texts, options = {}) {
    // 复用chunkingService.generateEmbeddings()
    // 支持model参数: 'text-embedding-v3' | 'bge-m3'
  }

  async search(queryVector, topK = 10, filters = {}) {
    if (this.backend === 'chromadb') {
      return this._searchChromaDB(queryVector, topK, filters);
    }
    return this._searchMySQL(queryVector, topK, filters);
  }

  async _searchMySQL(queryVector, topK, filters) {
    // 复用dedupService.calculateCosineSimilarity()
    // 从ai_material_chunks加载向量JSON，内存计算相似度
    // 支持按file_category过滤
  }

  async _searchChromaDB(queryVector, topK, filters) {
    // 调用ChromaDB REST API
    // 支持file_category等metadata过滤
  }
}
```

**ChromaDB部署方案**（可选）：

```yaml
# docker-compose.yml 新增服务
chromadb:
  image: chromadb/chroma:latest
  ports:
    - "8001:8000"
  volumes:
    - chromadb_data:/chroma/chroma
  environment:
    - ANONYMIZED_TELEMETRY=FALSE
```

**BGE-M3模型接入**：复用现有`aiService.js`的模型配置体系，在`ai_models`表新增BGE-M3模型记录：

```sql
INSERT INTO ai_models (model_id, name, provider, api_key, endpoint, model_name, is_default, is_enabled)
VALUES ('bge-m3', 'BGE-M3 Embedding', 'custom', '<key>', '<endpoint>', 'bge-m3', 0, 1);
```

### 5.3 阶段③ AI学习已有TCL用例 — 新增TCLLearningService

**新增文件**：`services/tclLearningService.js`

**核心流程**：

```
已有TCL脚本(test_case_scripts 或 VFS知识库中的tcl_script)
    │
    ├── [1] TCL脚本解析
    │   ├── 正则提取CLI命令模式 (如: config interface, show version, ping ...)
    │   ├── 提取参数模式 (IP地址、VLAN ID、接口名 ...)
    │   └── 提取断言模式 (expect, assert, 输出检查 ...)
    │
    ├── [2] LLM深度分析 (复用aiCallWrapper)
    │   ├── 输入: 解析后的TCL结构 + 原始脚本
    │   ├── 输出1: cli-reference.md (CLI命令参考)
    │   │   格式: 命令名 | 语法 | 参数说明 | 使用场景 | 示例
    │   └── 输出2: tcl-conventions.md (TCL编写规范)
    │       格式: 规范项 | 说明 | 正确示例 | 错误示例
    │
    └── [3] 知识回写
        ├── cli-reference.md → chunkingService切分 → EmbeddingAdapter向量化 → 知识库
        └── tcl-conventions.md → chunkingService切分 → EmbeddingAdapter向量化 → 知识库
```

**数据库变更**：

```sql
CREATE TABLE tcl_learning_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module_id INT NOT NULL,
  result_type ENUM('cli_reference', 'tcl_convention') NOT NULL,
  content TEXT NOT NULL,
  source_script_ids JSON COMMENT '来源TCL脚本ID列表',
  chunk_ids JSON COMMENT '生成的知识块ID列表',
  status ENUM('pending','processing','completed','failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_module_type (module_id, result_type),
  INDEX idx_status (status)
);
```

**与现有系统的集成点**：
- 复用 `agentExecutionEngine.js` — 可配置专用Sub-Agent执行TCL分析
- 复用 `aiCallWrapper.js` — AI调用通道
- 复用 `chunkingService.js` — 学习结果切分+向量化
- 复用 `routes/scripts.js` — TCL脚本来源（已有TCL脚本上传通道）

**触发方式**：
1. **自动触发（主路径）**：上传TCL脚本时，`fileParserService.parseAndChunk()` 检测到 `file_category='tcl_script'` 后自动追加TCL学习后处理
2. **重试触发**：学习失败后，用户在知识库页面点击"🤖 重新学习TCL"按钮，走 `reparseFile()` 流程重新执行
3. **批量触发**：用户选择多个TCL脚本，一键批量重新学习

**与 `fileParserService` 的集成方式**：

TCL学习不再作为独立的外部触发流程，而是作为 `parseAndChunk()` 的后处理步骤内嵌：

```
fileParserService.parseAndChunk(fileId)
  │
  ├── [现有逻辑] 解析文件 → 切分 → 保存chunks → 更新状态为parsed
  │
  └── [新增后处理] if (file_category === 'tcl_script')
      ├── 更新状态为 'learning'
      ├── tclLearningService.analyzeFromFile(fileId, moduleId)
      │   ├── 读取TCL文件内容
      │   ├── 正则提取CLI命令模式
      │   ├── LLM深度分析 → cli-reference.md + tcl-conventions.md
      │   ├── 学习结果切分+向量化
      │   └── 写入 ai_material_chunks + tcl_learning_results
      └── 更新状态为 'parsed' (成功) 或 'parsed'+parse_error (降级)
```

**降级策略**：TCL学习失败时，常规解析结果（TCL原始内容知识块）仍然可用，系统仅记录 `parse_error` 提示用户可重新学习。不会因为AI学习失败导致整个上传流程失败。

### 5.4 阶段④ 测试点扩展 — 扩展level1PointService

**改动范围**：在现有Global-Local Two-Pass架构后增加扩展阶段

**新增文件**：`services/testPointExpansionService.js`

**核心流程**：

```
allValidLevel1 (来自全局感知阶段)
    │
    ├── [1] RAG检索增强
    │   ├── 对每个测试点，通过EmbeddingAdapter检索相关知识
    │   │   ├── CLI命令参考 (file_category='cli')
    │   │   ├── 测试方法论 (file_category='methodology')
    │   │   └── TCL规范 (file_category='tcl_convention')
    │   └── 组装增强上下文
    │
    ├── [2] LLM 5维度扩展
    │   ├── 功能维度: 正常功能路径覆盖
    │   ├── 边界维度: 参数边界值、容量极限
    │   ├── 异常维度: 错误注入、异常恢复
    │   ├── 组合维度: 多功能交互、配置组合
    │   └── 状态维度: 状态转换、时序约束
    │
    ├── [3] 去重合并
    │   └── 复用level1PointService._normalizeName() + dedupService
    │
    └── [4] 输出
        ├── 扩展测试点.md (Markdown格式)
        └── 导出Excel (复用routes/excel.js)
```

**与现有系统的集成点**：
- `level1PointService.js` — 扩展阶段在`executeGlobalAwareness()`之后执行
- `dedupService.js` — 复用查重逻辑
- `embeddingAdapter.js`（新增）— RAG检索
- `routes/excel.js` — Excel导出

**数据库变更**：

```sql
ALTER TABLE temp_level1_points 
ADD COLUMN expansion_dimension VARCHAR(20) DEFAULT NULL 
COMMENT '扩展维度: functional|boundary|exception|combination|state|original';

ALTER TABLE temp_level1_points
ADD COLUMN rag_context TEXT DEFAULT NULL
COMMENT 'RAG检索到的相关上下文';
```

### 5.5 阶段⑤ TCL用例生成 + 脚本关联 — 新增TCLGenerationService

**新增文件**：`services/tclGenerationService.js`

**核心流程**：

```
测试点(已扩展) + ChromaDB/MySQL知识检索
    │
    ├── [1] 知识组装
    │   ├── RAG检索CLI命令参考 (按测试点语义匹配)
    │   ├── RAG检索TCL编写规范
    │   ├── 加载测试环境配置
    │   └── 组装Prompt上下文
    │
    ├── [2] Sub-Agent驱动生成 (复用agentExecutionEngine)
    │   ├── Soul Prompt: TCL测试脚本编写专家
    │   ├── User Template: 包含测试点+CLI参考+TCL规范
    │   └── 输出: 结构化TCL脚本
    │       ├── Setup段: 设备初始化、环境准备、基线配置
    │       ├── Test Steps段: 测试执行与结果验证
    │       ├── Teardown段: 脏数据清理、配置恢复
    │       └── 异常捕获: catch机制确保Teardown始终执行
    │
    ├── [3] ReflectionPipeline 静态校验 (复用)
    │   ├── 规则1: 语法正确性 (TCL语法检查)
    │   ├── 规则2: CLI命令有效性 (与cli-reference对比)
    │   ├── 规则3: 断言完整性 (每个测试步骤有预期结果检查)
    │   ├── 规则4: 规范符合度 (与tcl-convention对比)
    │   └── 规则5: 结构完整性 (必须包含Setup/Test/Teardown三段)
    │
    ├── [4] 动态执行与自修复闭环 (新增)
    │   ├── ScriptRunner投递脚本至执行节点 (Python预埋)
    │   ├── 执行结果判定:
    │   │   ├── PASS → 进入步骤[5]
    │   │   ├── FAIL/TIMEOUT → 提取报错日志
    │   │   └── UNREACHABLE → 标记执行节点不可用
    │   ├── 自修复 Agent (最多重试N次):
    │   │   ├── 将报错日志 + 原始脚本提交LLM
    │   │   ├── LLM分析失败原因并生成修复脚本
    │   │   └── 重新投递执行 → 回到结果判定
    │   └── 避坑经验回写:
    │       ├── 将修复过程中的关键发现(如参数废弃、时序延迟)提取
    │       └── 回写至知识库 (EmbeddingAdapter → ai_material_chunks)
    │
    ├── [5] 输出TCL脚本文件
    │   ├── 保存到 uploads/scripts/{year}/{month}/{uuid}.tcl
    │   └── 记录到 tcl_generation_tasks 表
    │
    └── [6] 自动关联到测试用例 ← 关键新增
        ├── 查找对应的测试用例 (通过level1_point + 测试点名称匹配)
        ├── 写入 test_case_scripts 表
        │   ├── test_case_id = 对应用例ID
        │   ├── script_name = 测试点名称 + ".tcl"
        │   ├── script_type = 'tcl'
        │   ├── file_path = 脚本文件路径
        │   ├── file_size = 文件大小
        │   ├── original_filename = 原始文件名
        │   ├── link_type = 'generated'  ← 新增类型，标识AI生成
        │   └── creator = 'AI'
        └── 用户可在测试用例详情页查看/下载/替换关联的TCL脚本
```

#### 5.5.0 结构化TCL脚本规范

**生成的TCL脚本必须遵循以下三段式结构**，确保测试的可重复性和设备状态安全：

```tcl
# ============================================================
# 测试用例: {{test_point_name}}
# 扩展维度: {{expansion_dimension}}
# 生成时间: {{generated_at}}
# ============================================================

# ---- Setup: 初始化 ----
proc setup {} {
    # 设备连接与基线配置
    # 环境准备（创建VLAN、配置接口等）
    # 记录初始状态快照
}

# ---- Test Steps: 执行与验证 ----
proc test_steps {} {
    # 执行测试操作
    # 每步验证预期结果
    # 收集测试数据
}

# ---- Teardown: 清理 ----
proc teardown {} {
    # 删除测试产生的配置
    # 恢复设备到初始状态
    # 释放资源
}

# ---- 主执行流程 ----
if {[catch {
    setup
    test_steps
} errMsg]} {
    puts "TEST FAILED: $errMsg"
    catch { teardown }
    exit 1
}

teardown
puts "TEST PASSED"
exit 0
```

**三段式结构的核心价值**：

| 段落 | 职责 | 不做的后果 |
|------|------|-----------|
| Setup | 初始化设备状态，建立基线 | 测试在脏数据上执行，结果不可重复 |
| Test Steps | 执行测试逻辑，验证预期 | — |
| Teardown | 清理配置，恢复设备 | 脏数据残留，后续用例误报(False Alarm) |
| catch异常捕获 | 确保Teardown始终执行 | 中间步骤报错后设备状态混乱 |

#### 5.5.0a ScriptRunner 动态执行预埋设计

**背景**：xTest部署在内网，与实验室网络存在隔离。无法直接从xTest服务器SSH到被测设备。因此设计一个Python执行代理（ScriptRunner），部署在实验室网络内，负责接收TCL脚本、执行并回捞日志。

**架构**：

```
┌──────────────────────┐         ┌──────────────────────────────────────┐
│   xTest 服务器        │         │   实验室网络 (ScriptRunner Agent)     │
│   (内网)              │         │   (可访问被测设备)                    │
│                      │         │                                      │
│  tclGenerationService│──HTTP──▶│  script_runner_agent.py              │
│        │             │  请求   │    ├── 接收TCL脚本                    │
│        │             │         │    ├── 调用tclsh/expect执行           │
│        │             │◀──HTTP──│    ├── 捕获stdout/stderr/exit_code    │
│        │             │  响应   │    └── 返回执行日志                   │
│        ▼             │         │                                      │
│  日志解析 → 自修复    │         │  ┌─────────┐  ┌─────────┐           │
│        │             │         │  │ 被测设备A│  │ 被测设备B│           │
│        ▼             │         │  └─────────┘  └─────────┘           │
│  避坑经验回写知识库   │         │                                      │
└──────────────────────┘         └──────────────────────────────────────┘
```

**ScriptRunner Agent（Python脚本）设计**：

```python
# script_runner_agent.py
# 部署在实验室网络的Python HTTP服务
# 职责: 接收TCL脚本 → 执行 → 回捞日志

from flask import Flask, request, jsonify
import subprocess
import tempfile
import os
import uuid
from datetime import datetime

app = Flask(__name__)

EXECUTOR_CONFIG = {
    'tclsh_path': '/usr/bin/tclsh',
    'expect_path': '/usr/bin/expect',
    'max_execution_time': 300,
    'log_dir': '/var/log/script_runner'
}

@app.route('/api/runner/execute', methods=['POST'])
def execute_script():
    """
    执行TCL脚本并返回结果
    
    Request:
      {
        "task_id": "TCL-20260520-A1B2C3D4",
        "script_content": "...",
        "target_device": {
            "host": "10.1.1.1",
            "port": 22,
            "username": "admin",
            "password": "***"
        },
        "timeout": 300,
        "env_vars": {}
      }
    
    Response:
      {
        "task_id": "TCL-20260520-A1B2C3D4",
        "status": "pass|fail|timeout|error",
        "exit_code": 0,
        "stdout": "...",
        "stderr": "...",
        "execution_time": 12.5,
        "timestamp": "2026-05-20T14:30:00"
      }
    """
    data = request.json
    task_id = data.get('task_id', str(uuid.uuid4()))
    timeout = data.get('timeout', EXECUTOR_CONFIG['max_execution_time'])
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.tcl', delete=False) as f:
        f.write(data['script_content'])
        script_path = f.name
    
    try:
        start_time = datetime.now()
        
        result = subprocess.run(
            [EXECUTOR_CONFIG['tclsh_path'], script_path],
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, **data.get('env_vars', {})}
        )
        
        execution_time = (datetime.now() - start_time).total_seconds()
        
        status = 'pass' if result.returncode == 0 else 'fail'
        
        return jsonify({
            'task_id': task_id,
            'status': status,
            'exit_code': result.returncode,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'execution_time': execution_time,
            'timestamp': datetime.now().isoformat()
        })
        
    except subprocess.TimeoutExpired:
        return jsonify({
            'task_id': task_id,
            'status': 'timeout',
            'exit_code': -1,
            'stdout': '',
            'stderr': f'Execution timed out after {timeout}s',
            'execution_time': timeout,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'task_id': task_id,
            'status': 'error',
            'exit_code': -1,
            'stdout': '',
            'stderr': str(e),
            'execution_time': 0,
            'timestamp': datetime.now().isoformat()
        })
        
    finally:
        os.unlink(script_path)

@app.route('/api/runner/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8900)
```

**xTest侧的ScriptRunner客户端**：

```javascript
// services/scriptRunnerClient.js
// xTest服务器调用ScriptRunner Agent的客户端

class ScriptRunnerClient {
  constructor() {
    this.agentUrl = process.env.SCRIPT_RUNNER_URL || null;
    this.enabled = !!this.agentUrl;
  }

  async execute(tclContent, options = {}) {
    if (!this.enabled) {
      return { status: 'skipped', reason: 'ScriptRunner Agent未配置' };
    }

    const response = await fetch(`${this.agentUrl}/api/runner/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: options.taskId,
        script_content: tclContent,
        target_device: options.targetDevice || null,
        timeout: options.timeout || 300,
        env_vars: options.envVars || {}
      }),
      signal: AbortSignal.timeout((options.timeout || 300) * 1000 + 10000)
    });

    return await response.json();
  }

  async healthCheck() {
    if (!this.enabled) return { status: 'disabled' };
    try {
      const response = await fetch(`${this.agentUrl}/api/runner/health`, {
        signal: AbortSignal.timeout(5000)
      });
      return await response.json();
    } catch (error) {
      return { status: 'unreachable', error: error.message };
    }
  }
}

module.exports = new ScriptRunnerClient();
```

**环境变量配置**：

```env
# ScriptRunner Agent地址（不配置则跳过动态执行）
SCRIPT_RUNNER_URL=http://10.1.100.50:8900

# 自修复最大重试次数
TCL_SELF_REPAIR_MAX_RETRIES=2
```

**动态执行与自修复闭环流程**：

```
TCL脚本通过ReflectionPipeline静态校验
    │
    ├── ScriptRunner Agent 是否可用?
    │   ├── 不可用 (未配置/网络不通)
    │   │   └── 跳过动态执行，直接进入[5]输出
    │   │       标记: execution_status = 'skipped'
    │   │
    │   └── 可用
    │       └── 投递执行
    │           │
    │           ├── PASS
    │           │   └── 标记: execution_status = 'passed'
    │           │       进入[5]输出
    │           │
    │           ├── FAIL / TIMEOUT
    │           │   ├── 提取报错日志 (stdout + stderr)
    │           │   ├── 自修复循环 (最多N次):
    │           │   │   ├── 构建修复Prompt:
    │           │   │   │   ├── 原始脚本
    │           │   │   │   ├── 报错日志
    │           │   │   │   ├── CLI命令参考
    │           │   │   │   └── TCL编写规范
    │           │   │   ├── LLM生成修复脚本
    │           │   │   ├── ReflectionPipeline静态校验
    │           │   │   └── 重新投递执行
    │           │   │       ├── PASS → 退出循环
    │           │   │       └── 仍FAIL → 继续循环
    │           │   │
    │           │   ├── 自修复成功:
    │           │   │   ├── 标记: execution_status = 'passed_after_repair'
    │           │   │   ├── 记录修复次数和修复内容
    │           │   │   └── 避坑经验回写知识库
    │           │   │
    │           │   └── 自修复失败 (达到最大重试次数):
    │           │       ├── 标记: execution_status = 'failed'
    │           │       ├── 保留最后一次修复的脚本 + 完整日志
    │           │       └── 提示用户人工介入
    │           │
    │           └── UNREACHABLE
    │               └── 标记: execution_status = 'agent_unreachable'
    │                   提示检查ScriptRunner Agent状态
    │
    └── 避坑经验回写 (仅自修复成功时)
        ├── 提取修复关键发现:
        │   ├── 废弃的CLI参数
        │   ├── 必需的时序延迟
        │   ├── 命令依赖顺序
        │   └── 环境特定限制
        ├── 生成经验知识块
        └── EmbeddingAdapter → ai_material_chunks
            (file_category = 'execution_experience')
```

#### 5.5.1 TCL脚本→测试用例关联详细设计

**关联时机**：TCL脚本生成并通过ReflectionPipeline静态校验（及可选的动态执行验证）后，自动执行关联

**关联逻辑**：

```
TCL脚本生成完成
    │
    ├── [1] 确定关联目标
    │   ├── 每个 TCL 脚本对应一个测试点 (level1_point)
    │   ├── 查找该测试点下的测试用例:
    │   │   ├── 优先查找 temp_test_cases (尚未合并的临时用例)
    │   │   └── 其次查找 test_cases (已合并的正式用例)
    │   │       WHERE level1_id = level1_point.id
    │   └── 如果一个测试点下有多个用例，TCL脚本关联到所有用例
    │
    ├── [2] 写入关联记录
    │   └── INSERT INTO test_case_scripts
    │       (test_case_id, script_name, script_type, description,
    │        file_path, file_size, original_filename,
    │        link_type, creator)
    │       VALUES
    │       (caseId, 'QoS_Buffer管理_test.tcl', 'tcl',
    │        'AI生成的TCL测试脚本 - Buffer管理测试',
    │        '/uploads/scripts/2026/05/xxx.tcl',
    │        fileSize, 'QoS_Buffer管理_test.tcl',
    │        'generated', 'AI')
    │
    └── [3] 前端展示
        ├── 测试用例详情页 → "关联脚本" 标签页
        │   ├── 显示AI生成的TCL脚本 (link_type='generated')
        │   ├── 显示手动上传的脚本 (link_type='external')
        │   └── 支持下载、预览、替换、删除
        │
        └── TCL脚本标记
            ├── AI生成的脚本显示 "🤖 AI生成" 标签
            ├── 手动上传的脚本显示 "📎 手动关联" 标签
            └── 支持用户手动替换AI生成的脚本
```

**test_case_scripts表扩展**：

```sql
ALTER TABLE test_case_scripts
MODIFY COLUMN link_type VARCHAR(20) DEFAULT 'external'
COMMENT '链接类型: external(手动关联)|generated(AI生成)';

ALTER TABLE test_case_scripts
ADD COLUMN generation_task_id VARCHAR(100) DEFAULT NULL
COMMENT 'AI生成任务ID，关联tcl_generation_tasks.task_id';

ALTER TABLE test_case_scripts
ADD COLUMN level1_point_id INT DEFAULT NULL
COMMENT '关联的一级测试点ID';

CREATE INDEX idx_scripts_link_type ON test_case_scripts(link_type);
CREATE INDEX idx_scripts_generation_task ON test_case_scripts(generation_task_id);
```

**关联API设计**（复用现有 + 新增）：

| API | 方法 | 功能 | 状态 |
|-----|------|------|------|
| `/api/scripts/testcases/:id/scripts` | GET | 获取测试用例关联的脚本列表 | 已有 |
| `/api/scripts/testcases/:id/scripts` | POST | 手动添加关联脚本 | 已有 |
| `/api/scripts/testcases/scripts/batch` | POST | 批量添加脚本关联 | 已有 |
| `/api/scripts/testcases/scripts/upload` | POST | 上传脚本文件 | 已有 |
| `/api/scripts/tcl-generation/auto-associate` | POST | TCL生成后自动关联到用例 | **新增** |
| `/api/scripts/tcl-generation/task/:taskId/scripts` | GET | 获取某次TCL生成任务的所有脚本 | **新增** |

**自动关联API详细设计**：

```
POST /api/scripts/tcl-generation/auto-associate

Request Body:
{
  "taskId": "TCL-20260520-A1B2C3D4",
  "moduleId": 5,
  "associations": [
    {
      "level1PointId": 12,
      "level1PointName": "Buffer管理测试",
      "scriptFilePath": "/uploads/scripts/2026/05/xxx.tcl",
      "scriptFileSize": 2048,
      "originalFilename": "Buffer管理测试.tcl"
    },
    {
      "level1PointId": 13,
      "level1PointName": "调度算法测试",
      "scriptFilePath": "/uploads/scripts/2026/05/yyy.tcl",
      "scriptFileSize": 3072,
      "originalFilename": "调度算法测试.tcl"
    }
  ]
}

Response:
{
  "success": true,
  "data": {
    "associatedCount": 5,
    "details": [
      {
        "level1PointId": 12,
        "level1PointName": "Buffer管理测试",
        "associatedCases": [
          { "caseId": 101, "caseName": "Buffer溢出异常测试", "scriptId": 201 },
          { "caseId": 102, "caseName": "Buffer容量边界测试", "scriptId": 202 }
        ]
      },
      {
        "level1PointId": 13,
        "level1PointName": "调度算法测试",
        "associatedCases": [
          { "caseId": 103, "caseName": "SP调度功能测试", "scriptId": 203 },
          { "caseId": 104, "caseName": "WFQ调度功能测试", "scriptId": 204 },
          { "caseId": 105, "caseName": "调度算法组合测试", "scriptId": 205 }
        ]
      }
    ]
  }
}
```

#### 5.5.2 前端展示：测试用例详情页的脚本关联

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  测试用例: Buffer溢出异常测试                                          [编辑] │
│──────────────────────────────────────────────────────────────────────────────│
│                                                                              │
│  基本信息 │ 测试步骤 │ 关联脚本 │ 执行记录                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  关联脚本 (2)                                    [+ 添加脚本] [上传]  │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │ 🤖 AI生成   Buffer溢出异常测试.tcl                    [下载] [预览] │ │  │
│  │  │ 脚本类型: tcl  |  大小: 2.0KB  |  生成时间: 2026/05/20 14:30     │ │  │
│  │  │ 来源: TCL自动生成任务 TCL-20260520-A1B2C3D4                      │ │  │
│  │  │                                              [替换] [解除关联]   │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │ 📎 手动关联  buffer_stress_test.tcl                   [下载]      │ │  │
│  │  │ 脚本类型: tcl  |  大小: 4.5KB  |  上传人: 张三                    │ │  │
│  │  │                                              [替换] [解除关联]   │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**TCL生成Sub-Agent配置**：

```
Soul Prompt 示例:
────────────────
你是一个专业的TCL测试脚本编写专家，擅长为网络设备编写自动化测试脚本。

## 编写规范
1. 脚本必须采用三段式结构：Setup(初始化) → Test Steps(执行/验证) → Teardown(清理)
2. Setup段：设备连接、环境准备、基线配置、记录初始状态
3. Test Steps段：执行测试操作，每步验证预期结果
4. Teardown段：删除测试产生的配置，恢复设备到初始状态，释放资源
5. 必须使用catch异常捕获机制，确保Teardown在任何情况下都能执行
6. 每个测试步骤前添加注释说明测试目的
7. 使用expect进行命令交互
8. 每个关键步骤后添加结果断言
9. 变量命名清晰，使用有意义的名称

## 脚本模板
```tcl
# ---- Setup: 初始化 ----
proc setup {} {
    # 设备连接与基线配置
    # 环境准备
    # 记录初始状态快照
}

# ---- Test Steps: 执行与验证 ----
proc test_steps {} {
    # 执行测试操作
    # 每步验证预期结果
}

# ---- Teardown: 清理 ----
proc teardown {} {
    # 删除测试产生的配置
    # 恢复设备到初始状态
}

# ---- 主执行流程 ----
if {[catch {
    setup
    test_steps
} errMsg]} {
    puts "TEST FAILED: $errMsg"
    catch { teardown }
    exit 1
}
teardown
puts "TEST PASSED"
exit 0
```

## CLI命令参考
{{cli_reference}}

## TCL编写规范
{{tcl_conventions}}

## 测试环境
{{test_environment}}

User Template 示例:
────────────────
请根据以下测试点生成结构化TCL测试脚本。

## 测试点信息
- 测试点名称: {{test_point_name}}
- 测试类型: {{test_type}}
- 扩展维度: {{expansion_dimension}}
- 测试目的: {{test_purpose}}

## 相关CLI命令
{{rag_cli_commands}}

## 全局系统背景
{{global_context}}

请生成TCL脚本，要求：
1. 必须包含Setup/Test Steps/Teardown三段式结构
2. Setup段完成设备初始化和基线配置
3. Teardown段确保脏数据清理和配置恢复
4. 使用catch机制确保异常时Teardown仍能执行
5. 包含完整的测试步骤和预期结果断言
6. 使用上述CLI命令参考中的标准命令格式
```

**数据库变更**：

```sql
CREATE TABLE tcl_generation_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(100) NOT NULL UNIQUE,
  module_id INT NOT NULL,
  user_id INT NOT NULL,
  level1_point_id INT COMMENT '关联的一级测试点',
  status ENUM('pending','generating','validating','executing','repairing','completed','failed') DEFAULT 'pending',
  rag_context TEXT COMMENT 'RAG检索上下文',
  tcl_content TEXT COMMENT '生成的TCL脚本内容',
  script_file_path VARCHAR(500) COMMENT 'TCL文件路径',
  reflection_result JSON COMMENT '静态校验结果',
  execution_status ENUM('pending','passed','passed_after_repair','failed','timeout','skipped','agent_unreachable') DEFAULT 'pending',
  execution_result JSON COMMENT '动态执行结果(stdout/stderr/exit_code/execution_time)',
  repair_count INT DEFAULT 0 COMMENT '自修复次数',
  repair_history JSON COMMENT '自修复历史(每次修复的脚本diff+报错日志)',
  repair_experience TEXT COMMENT '避坑经验(回写知识库的内容)',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  INDEX idx_status (status),
  INDEX idx_module (module_id),
  INDEX idx_execution_status (execution_status)
);
```

---

## 六、TCL脚本→测试用例关联完整生命周期

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    TCL脚本与测试用例的关联生命周期                              │
└──────────────────────────────────────────────────────────────────────────────┘

1. 生成阶段
──────────
   TCLGenerationService.generate()
     │
     ├── 生成TCL脚本文件
     ├── 通过ReflectionPipeline校验
     └── 保存到 uploads/scripts/

2. 自动关联阶段
──────────────
   TCLGenerationService.autoAssociate()
     │
     ├── 查找测试点下的所有测试用例
     │   ├── temp_test_cases (临时用例，尚未合并)
     │   └── test_cases (正式用例)
     │
     ├── 写入 test_case_scripts 关联记录
     │   link_type = 'generated'
     │   generation_task_id = taskId
     │   level1_point_id = pointId
     │
     └── 返回关联结果

3. 用户确认阶段
──────────────
   用户在测试用例详情页查看关联的TCL脚本
     │
     ├── 查看脚本内容 (在线预览)
     ├── 下载脚本文件
     ├── 替换AI生成的脚本 (上传新版本)
     │   └── link_type 变为 'external'，保留 generation_task_id 记录
     └── 解除关联 (删除 test_case_scripts 记录)

4. 用例合并阶段
──────────────
   当临时用例合并到正式库时:
     │
     ├── temp_test_cases → test_cases (用例数据迁移)
     └── test_case_scripts.test_case_id 需要更新
         └── 合并逻辑中增加脚本关联的迁移

5. 脚本执行阶段 (未来扩展)
────────────────────────
   用户可直接在测试用例页面:
     │
     ├── 在线执行TCL脚本 (通过SSH连接测试环境)
     ├── 查看执行结果
     └── 执行记录写入 case_execution_records
```

---

## 七、融合后的完整业务流程

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        融合后完整业务流程                                      │
└──────────────────────────────────────────────────────────────────────────────┘

阶段零: 资产准备 (复用+扩展)
──────────────────────────
  知识库页面上传各类文档 (统一VFS入口，file_category区分)
    ├── 设计文档 (.docx/.pdf/.pptx)  → fileParserService → ai_material_chunks
    ├── CLI参考 (.xlsx/.md)           → fileParserService → ai_material_chunks
    ├── 测试方法论 (.md/.docx)         → fileParserService → ai_material_chunks
    ├── TCL规范 (.md/.docx)           → fileParserService → ai_material_chunks
    ├── 测试环境 (.md/.xlsx)          → fileParserService → ai_material_chunks
    └── 已有TCL脚本 (.tcl)            → fileParserService → ai_material_chunks
                                    └→ 自动追加TCL学习后处理 → cli-reference + tcl-convention

阶段一: 全局感知 (复用，不变)
──────────────────────────
  executeGlobalAwareness()
    ├── Map: 逐chunk骨架扫描
    ├── Reduce: 合并全局背景 + 增量测试点
    └── 输出: globalContext + allValidLevel1

阶段二: 测试点扩展 (新增)
────────────────────────
  testPointExpansionService.expand()
    ├── RAG检索: CLI参考 + 方法论 + TCL规范
    ├── LLM 5维度扩展: 功能|边界|异常|组合|状态
    ├── 去重合并
    └── 输出: 扩展测试点(MD/Excel)

阶段三: 用例生成 (复用，双轨输出)
──────────────────────────────
  ┌─ 自然语言用例 (已有)
  │   caseGeneratorService.executeMapPhase()
  │     └── 输出: temp_test_cases (name/steps/expected)
  │
  └─ TCL脚本用例 (新增)
      tclGenerationService.generate()
        ├── RAG检索: CLI命令 + TCL规范
        ├── Sub-Agent生成结构化TCL (Setup/Steps/Teardown)
        ├── ReflectionPipeline静态校验
        ├── ScriptRunner动态执行验证 (可选)
        ├── 自修复闭环 (执行失败→日志回捞→LLM修复)
        ├── 避坑经验回写知识库
        ├── 输出: .tcl脚本 → uploads/scripts/
        └── 自动关联: test_case_scripts (link_type='generated')

阶段四: 安全落地 (复用+增强)
──────────────────────────
  用户确认
    ├── 确认测试用例 → 合并到正式库
    ├── 确认TCL脚本 → 保留/替换/删除关联
    └── 脚本关联随用例合并自动迁移
```

---

## 八、改动清单与影响评估

### 8.1 新增文件

| 文件 | 职责 | 代码量估算 |
|------|------|-----------|
| `services/embeddingAdapter.js` | 向量存储抽象层（MySQL/ChromaDB双后端） | ~200行 |
| `services/tclLearningService.js` | TCL脚本AI分析+知识提取 | ~300行 |
| `services/testPointExpansionService.js` | 5维度测试点扩展 | ~250行 |
| `services/tclGenerationService.js` | TCL脚本生成+动态执行+自修复+自动关联 | ~550行 |
| `services/scriptRunnerClient.js` | ScriptRunner Agent HTTP客户端 | ~80行 |
| `tools/script_runner_agent.py` | 实验室网络Python执行代理 | ~120行 |
| `routes/tclGeneration.js` | TCL生成API路由 | ~150行 |
| `migrations/xxx_add_tcl_generation.sql` | 数据库迁移脚本 | ~80行 |

### 8.2 修改文件

| 文件 | 改动内容 | 影响范围 |
|------|---------|---------|
| `routes/knowledge.js` | 上传接口增加fileCategory参数 | 低 |
| `services/vfsService.js` | uploadFile增加category参数传递 | 低 |
| `services/fileParserService.js` | parseAndChunk增加TCL学习后处理分支 | 中 |
| `services/chunkingService.js` | embedding生成支持模型选择 | 低 |
| `services/level1PointService.js` | 全局感知后调用扩展服务 | 中 |
| `services/aiService.js` | 新增BGE-M3模型配置支持 | 低 |
| `routes/scripts.js` | 新增自动关联API，link_type扩展 | 中 |
| `server.js` | 注册新路由 + test_case_scripts表结构更新 | 低 |
| 前端知识库页面 | 增加文件分类选择 + TCL学习按钮 | 中 |
| 前端任务中心 | 增加TCL生成任务类型 | 中 |
| 前端用例详情页 | 脚本关联展示增强（AI生成标签） | 中 |

### 8.3 不改动的文件

| 文件 | 原因 |
|------|------|
| `caseGeneratorService.js` | 自然语言用例生成逻辑完全保留 |
| `fileParserService.js` | 文件解析逻辑完全复用（仅增加TCL后处理分支，不修改现有逻辑） |
| `dedupService.js` | 查重逻辑完全复用 |
| `agentExecutionEngine.js` | Sub-Agent引擎完全复用 |
| `reflectionPipeline.js` | 反思管道完全复用 |
| `db.js` | 数据库连接完全复用 |
| `vfsService.js` | VFS服务完全复用（无需增加通道2触发逻辑，因已合并到fileParserService内部） |

---

## 九、实施路线图

### Phase 1：基础增强（阶段①②）

- 扩展`module_knowledge_files`增加file_category
- 实现`EmbeddingAdapter`（先只实现MySQL后端）
- 知识库前端增加分类标签选择
- 上传对话框增加文件分类下拉
- 验证：上传不同类型文件，分类标签正确存储和检索

### Phase 2：TCL学习能力（阶段③）

- 实现`TCLLearningService`
- 新增`tcl_learning_results`表
- 实现TCL脚本解析器（正则+LLM分析）
- 学习结果回写知识库
- 知识库页面增加"学习TCL脚本"按钮
- 验证：上传3-5个TCL脚本，自动生成cli-reference和tcl-convention

### Phase 3：测试点扩展（阶段④）

- 实现`TestPointExpansionService`
- 在全局感知阶段后集成5维度扩展
- 扩展`temp_level1_points`表
- 实现RAG检索增强
- 验证：对比扩展前后的测试点覆盖度

### Phase 4：TCL生成+执行验证+脚本关联（阶段⑤）

- 实现`TCLGenerationService`（结构化脚本生成：Setup/Test Steps/Teardown）
- 配置TCL生成专用Sub-Agent（含三段式模板）
- 实现ReflectionPipeline的TCL校验规则（含结构完整性检查）
- 实现`ScriptRunnerClient`（HTTP客户端，可选组件）
- 实现`script_runner_agent.py`（Python执行代理，部署在实验室网络）
- 实现动态执行与自修复闭环逻辑
- 实现避坑经验回写知识库
- 新增`tcl_generation_tasks`表（含执行状态、修复历史等字段）
- **实现TCL脚本→测试用例自动关联**
- 扩展`test_case_scripts`表（link_type, generation_task_id, level1_point_id）
- 前端用例详情页增加AI生成脚本展示（含执行状态标签）
- 验证：生成TCL脚本结构合规率 > 95%，静态校验通过率 > 85%，动态执行通过率 > 70%

### Phase 5：ChromaDB集成（可选增强）

- 实现`EmbeddingAdapter`的ChromaDB后端
- Docker Compose增加ChromaDB服务
- 数据迁移工具：MySQL向量 → ChromaDB
- 验证：对比MySQL/ChromaDB的检索精度和性能

---

## 十、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| ChromaDB引入增加部署复杂度 | 中 | 中 | 作为可选组件，MySQL后端始终可用 |
| BGE-M3 embedding质量依赖模型服务 | 中 | 高 | 支持多embedding模型切换，降级到现有模型 |
| TCL脚本静态校验通过但动态执行失败 | 高 | 高 | 自修复闭环(最多N次重试) + 避坑经验回写 + 人工审核 |
| 自修复闭环陷入死循环 | 中 | 中 | 最大重试次数限制 + 每次修复前强制ReflectionPipeline校验 |
| ScriptRunner Agent网络不通 | 高 | 低 | 动态执行为可选步骤，不通则跳过，仅做静态校验 |
| 5维度扩展产生过多冗余测试点 | 中 | 低 | 复用dedupService去重 + 用户可调整扩展维度 |
| TCL学习结果质量不稳定 | 中 | 中 | 人工审核学习结果 + 增量学习机制 |
| TCL脚本关联到错误的测试用例 | 中 | 中 | 基于level1_point精确匹配 + 用户可手动调整关联 |
| 用例合并时脚本关联丢失 | 低 | 高 | 合并逻辑中增加test_case_scripts的迁移处理 |
