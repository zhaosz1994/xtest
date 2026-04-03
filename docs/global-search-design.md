# 全局搜索整合 - 详细设计方案

> 文档版本：v1.0  
> 创建日期：2024-01-15  
> 作者：系统架构师

---

## 目录

1. [概述](#一概述)
2. [现状分析](#二现状分析)
3. [设计目标](#三设计目标)
4. [技术架构](#四技术架构)
5. [API 接口设计](#五api-接口设计)
6. [前端实现设计](#六前端实现设计)
7. [数据库优化](#七数据库优化)
8. [交互设计](#八交互设计)
9. [扩展功能设计](#九扩展功能设计)
10. [错误处理与边界情况](#十错误处理与边界情况)
11. [性能优化策略](#十一性能优化策略)
12. [测试方案](#十二测试方案)
13. [实施计划](#十三实施计划)
14. [风险评估与缓解](#十四风险评估与缓解)
15. [附录](#十五附录)

---

## 一、概述

### 1.1 背景

当前系统存在两个独立的功能模块：

- **主应用**：测试计划管理、测试用例管理、测试报告等核心业务功能
- **论坛系统**：技术讨论、知识分享、问题求助等社区功能

两个模块各自拥有独立的搜索入口和数据源，用户需要在不同页面分别进行搜索，体验割裂。

### 1.2 问题陈述

| 问题 | 影响 | 严重程度 |
|------|------|----------|
| 搜索入口分散 | 用户需要在多个页面切换才能找到所需内容 | 高 |
| 数据孤岛 | 无法跨模块搜索相关内容 | 高 |
| 命令面板功能单一 | 仅支持命令导航，未发挥搜索潜力 | 中 |
| 重复建设 | 各模块独立实现搜索逻辑，维护成本高 | 中 |

### 1.3 解决方案概述

构建统一的全局搜索系统，以命令面板为入口，实现跨模块的一站式搜索体验。

---

## 二、现状分析

### 2.1 数据源详细分析

#### 2.1.1 测试计划 (test_plans)

```sql
-- 表结构核心字段
CREATE TABLE test_plans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL COMMENT '计划名称',
    owner VARCHAR(100) COMMENT '负责人',
    status ENUM('待开始', '进行中', '已完成', '已暂停') COMMENT '状态',
    test_phase VARCHAR(100) COMMENT '测试阶段',
    project VARCHAR(100) COMMENT '项目代码',
    iteration VARCHAR(100) COMMENT '迭代版本',
    pass_rate DECIMAL(5,2) COMMENT '通过率',
    total_cases INT COMMENT '总用例数',
    tested_cases INT COMMENT '已测用例数',
    created_at DATETIME,
    updated_at DATETIME,
    INDEX idx_name (name),
    INDEX idx_project (project),
    INDEX idx_owner (owner)
);
```

**搜索场景：**
- 按名称搜索：`性能测试计划`
- 按项目搜索：`XProject`
- 按负责人搜索：`张三`
- 按状态搜索：`进行中`

#### 2.1.2 测试用例 (test_cases)

```sql
-- 表结构核心字段
CREATE TABLE test_cases (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(500) NOT NULL COMMENT '用例名称',
    priority ENUM('P0', 'P1', 'P2', 'P3') COMMENT '优先级',
    type VARCHAR(50) COMMENT '用例类型',
    module_id INT COMMENT '所属模块',
    purpose TEXT COMMENT '测试目的',
    preconditions TEXT COMMENT '前置条件',
    steps TEXT COMMENT '测试步骤',
    expected_result TEXT COMMENT '预期结果',
    created_at DATETIME,
    updated_at DATETIME,
    INDEX idx_name (name),
    INDEX idx_module (module_id)
);
```

**搜索场景：**
- 按名称搜索：`登录测试`
- 按目的搜索：`验证用户登录功能`
- 按模块搜索：`用户模块`

#### 2.1.3 论坛帖子 (forum_posts)

```sql
-- 表结构核心字段
CREATE TABLE forum_posts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    post_id VARCHAR(20) UNIQUE COMMENT '帖子唯一标识',
    title VARCHAR(255) NOT NULL COMMENT '标题',
    content TEXT COMMENT '内容',
    author_id INT COMMENT '作者ID',
    is_anonymous TINYINT(1) DEFAULT 0 COMMENT '是否匿名',
    is_pinned TINYINT(1) DEFAULT 0 COMMENT '是否置顶',
    view_count INT DEFAULT 0 COMMENT '浏览数',
    comment_count INT DEFAULT 0 COMMENT '评论数',
    like_count INT DEFAULT 0 COMMENT '点赞数',
    status ENUM('normal', 'deleted') DEFAULT 'normal',
    created_at DATETIME,
    updated_at DATETIME,
    FULLTEXT INDEX ft_title_content (title, content),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
);
```

**搜索场景：**
- 按标题搜索：`性能测试方案`
- 按内容搜索：`如何提高测试效率`
- 支持中文全文检索

#### 2.1.4 论坛评论 (forum_comments)

```sql
-- 表结构核心字段
CREATE TABLE forum_comments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    post_id INT NOT NULL COMMENT '帖子ID',
    author_id INT COMMENT '作者ID',
    parent_id INT COMMENT '父评论ID',
    reply_to_id INT COMMENT '回复目标ID',
    content TEXT NOT NULL COMMENT '评论内容',
    is_anonymous TINYINT(1) DEFAULT 0,
    status ENUM('normal', 'deleted') DEFAULT 'normal',
    created_at DATETIME,
    INDEX idx_post (post_id),
    INDEX idx_content (content(100))
);
```

**搜索场景：**
- 按内容搜索：`我建议使用`
- 关联帖子标题搜索

### 2.2 现有搜索能力对比

| 数据源 | 搜索入口 | 搜索方式 | 中文支持 | 分页 |
|--------|----------|----------|----------|------|
| 测试计划 | 列表页筛选 | LIKE 模糊匹配 | ✅ | ✅ |
| 测试用例 | 无 | - | - | - |
| 论坛帖子 | 论坛搜索框 | FULLTEXT + LIKE | ✅ | ✅ |
| 论坛评论 | 无 | - | - | - |

### 2.3 现有命令面板分析

**当前功能：**
- 快捷命令导航
- 键盘快捷键支持
- 命令过滤

**局限性：**
- 无实际搜索功能
- 不支持跨模块查询
- 无搜索历史

---

## 三、设计目标

### 3.1 功能目标

#### 3.1.1 核心功能 (P0)

| 功能 | 描述 | 验收标准 |
|------|------|----------|
| 统一搜索入口 | 命令面板升级为全局搜索 | 用户可通过一个入口搜索所有内容 |
| 分类展示 | 按数据类型分组显示结果 | 结果按测试计划、用例、帖子、评论分组 |
| 实时搜索 | 输入时即时返回结果 | 输入停止 300ms 后触发搜索 |
| 快捷跳转 | 点击结果直接跳转详情 | 主应用内跳转，论坛新标签页打开 |

#### 3.1.2 增强功能 (P1)

| 功能 | 描述 | 验收标准 |
|------|------|----------|
| 搜索历史 | 记录最近搜索关键词 | 保存最近 10 条搜索记录 |
| 智能提示 | 显示搜索建议和历史 | 打开搜索框时显示历史和热门关键词 |
| 高亮显示 | 搜索结果中高亮关键词 | 匹配文本以黄色背景标记 |

#### 3.1.3 高级功能 (P2)

| 功能 | 描述 | 验收标准 |
|------|------|----------|
| 高级过滤 | 支持搜索语法过滤 | 支持 `project:`、`author:`、`type:` 等过滤符 |
| 搜索统计 | 记录搜索行为数据 | 记录搜索次数、点击率等指标 |
| 结果排序 | 按相关度排序结果 | 综合匹配度、时间、热度排序 |

### 3.2 非功能目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 响应时间 | < 500ms | 从输入到结果展示 |
| 并发支持 | 100 QPS | 同时搜索请求数 |
| 结果数量 | 每类最多 10 条 | 默认返回数量 |
| 兼容性 | Chrome 90+, Firefox 88+, Safari 14+ | 浏览器支持 |

### 3.3 用户体验目标

```
┌─────────────────────────────────────────────────────────────┐
│                     用户体验流程图                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   用户意图 ──▶ 打开搜索 ──▶ 输入关键词 ──▶ 查看结果 ──▶ 跳转 │
│      │           │             │             │          │   │
│      │           │             │             │          │   │
│   Ctrl+K     命令面板      实时搜索      分类展示    目标页面 │
│              或点击搜索     300ms防抖     高亮关键词           │
│                                                             │
│   预期时间：< 2s 完成整个搜索流程                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、技术架构

### 4.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户界面层                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    CommandPalette 组件                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │ SearchInput │  │ ResultList  │  │ SearchHistory│           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTP/REST API
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           API 网关层                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │              GET /api/search                                   │ │
│  │  - 请求参数验证                                                 │ │
│  │  - 用户身份认证                                                 │ │
│  │  - 请求限流                                                     │ │
│  │  - 响应缓存 (可选)                                              │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          业务逻辑层                                 │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    SearchService                               │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │ TestPlan    │  │ TestCase    │  │ Forum       │           │ │
│  │  │ Searcher    │  │ Searcher    │  │ Searcher    │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  │         │                │                │                   │ │
│  │         └────────────────┼────────────────┘                   │ │
│  │                          ▼                                    │ │
│  │              ┌─────────────────────┐                          │ │
│  │              │  ResultAggregator   │                          │ │
│  │              │  - 合并结果          │                          │ │
│  │              │  - 排序              │                          │ │
│  │              │  - 权限过滤          │                          │ │
│  │              └─────────────────────┘                          │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           数据访问层                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │ test_plans  │  │ test_cases  │  │ forum_posts │  │ forum_    │ │
│  │   DAO       │  │   DAO       │  │   DAO       │  │ comments  │ │
│  │             │  │             │  │             │  │   DAO     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘ │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           数据存储层                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                      MySQL Database                            │ │
│  │  test_plans │ test_cases │ forum_posts │ forum_comments       │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 模块职责划分

| 模块 | 职责 | 依赖 |
|------|------|------|
| CommandPalette | 用户交互、结果渲染、键盘导航 | SearchAPI |
| SearchAPI | 请求处理、参数验证、响应格式化 | SearchService |
| SearchService | 搜索逻辑编排、结果聚合 | 各 Searcher |
| TestPlanSearcher | 测试计划搜索 | TestPlanDAO |
| TestCaseSearcher | 测试用例搜索 | TestCaseDAO |
| ForumSearcher | 帖子和评论搜索 | ForumDAO |
| ResultAggregator | 结果合并、排序、权限过滤 | - |

### 4.3 数据流图

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  用户    │────▶│ 输入框   │────▶│ API请求  │────▶│ 服务处理 │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                          │
                     ┌────────────────────────────────────┘
                     │
                     ▼
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  响应    │◀────│ 结果聚合 │◀────│ 并行查询 │◀────│ 数据库   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                     │
                     ▼
               ┌──────────┐
               │ 渲染结果 │
               └──────────┘
```

---

## 五、API 接口设计

### 5.1 统一搜索接口

#### 5.1.1 接口定义

```http
GET /api/search
```

#### 5.1.2 请求参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| keyword | string | 是 | - | 搜索关键词，最少 2 个字符 |
| types | string | 否 | all | 搜索类型，逗号分隔：`testplan,case,post,comment` |
| limit | number | 否 | 5 | 每类返回数量，范围 1-20 |
| offset | number | 否 | 0 | 分页偏移量（用于加载更多） |

#### 5.1.3 请求示例

```http
GET /api/search?keyword=性能测试&types=testplan,post&limit=10
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

#### 5.1.4 响应结构

```json
{
    "success": true,
    "data": {
        "testPlans": {
            "total": 12,
            "hasMore": true,
            "items": [
                {
                    "id": 1,
                    "name": "性能测试计划-v2.3",
                    "project": "XProject",
                    "projectName": "X项目",
                    "status": "进行中",
                    "owner": "张三",
                    "passRate": 85.5,
                    "totalCases": 120,
                    "testedCases": 100,
                    "updatedAt": "2024-01-15T10:30:00Z"
                }
            ]
        },
        "testCases": {
            "total": 45,
            "hasMore": true,
            "items": [
                {
                    "id": 101,
                    "name": "登录功能-性能测试",
                    "module": "用户模块",
                    "moduleId": 5,
                    "priority": "P1",
                    "type": "性能测试",
                    "updatedAt": "2024-01-14T16:20:00Z"
                }
            ]
        },
        "posts": {
            "total": 3,
            "hasMore": false,
            "items": [
                {
                    "id": 5,
                    "postId": "POST-20240101-001",
                    "title": "如何设计性能测试方案？",
                    "summary": "本文介绍性能测试的设计思路...",
                    "author": "李四",
                    "authorId": 10,
                    "isAnonymous": false,
                    "commentCount": 12,
                    "likeCount": 25,
                    "createdAt": "2024-01-14T08:00:00Z"
                }
            ]
        },
        "comments": {
            "total": 8,
            "hasMore": true,
            "items": [
                {
                    "id": 201,
                    "content": "关于性能测试，我建议使用 JMeter 进行压测...",
                    "contentPreview": "关于性能测试，我建议使用...",
                    "postId": 5,
                    "postTitle": "如何设计性能测试方案？",
                    "author": "王五",
                    "authorId