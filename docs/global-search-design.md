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
                    "authorId": 15,
                    "isAnonymous": false,
                    "createdAt": "2024-01-14T09:30:00Z"
                }
            ]
        }
    },
    "meta": {
        "keyword": "性能测试",
        "types": ["testplan", "post"],
        "searchTime": 45,
        "totalResults": 68
    }
}
```

#### 5.1.5 错误响应

```json
{
    "success": false,
    "error": {
        "code": "INVALID_KEYWORD",
        "message": "搜索关键词至少需要 2 个字符",
        "details": {
            "minLength": 2,
            "actualLength": 1
        }
    }
}
```

### 5.2 错误码定义

| 错误码 | HTTP 状态码 | 说明 |
|--------|-------------|------|
| INVALID_KEYWORD | 400 | 关键词格式错误 |
| INVALID_TYPES | 400 | 搜索类型参数错误 |
| UNAUTHORIZED | 401 | 未登录或 Token 过期 |
| RATE_LIMITED | 429 | 请求频率超限 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |

### 5.3 后端实现代码

#### 5.3.1 路由定义

```javascript
// routes/search.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');

/**
 * GET /api/search
 * 统一搜索接口
 */
router.get('/search', authenticateToken, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { keyword, types = 'all', limit = 5, offset = 0 } = req.query;
        const userId = req.user.id;
        
        // 参数验证
        const validation = validateSearchParams({ keyword, types, limit, offset });
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: validation.message
                }
            });
        }
        
        const searchTerm = keyword.trim();
        const limitNum = Math.min(Math.max(1, parseInt(limit)), 20);
        const offsetNum = Math.max(0, parseInt(offset));
        
        // 解析搜索类型
        const typeList = types === 'all' 
            ? ['testplan', 'case', 'post', 'comment'] 
            : types.split(',').map(t => t.trim()).filter(t => 
                ['testplan', 'case', 'post', 'comment'].includes(t)
              );
        
        // 并行执行搜索
        const results = {};
        const searchPromises = [];
        
        if (typeList.includes('testplan')) {
            searchPromises.push(
                searchTestPlans(searchTerm, limitNum, offsetNum)
                    .then(r => { results.testPlans = r; })
                    .catch(e => { results.testPlans = { total: 0, items: [], error: e.message }; })
            );
        }
        
        if (typeList.includes('case')) {
            searchPromises.push(
                searchTestCases(searchTerm, limitNum, offsetNum, userId)
                    .then(r => { results.testCases = r; })
                    .catch(e => { results.testCases = { total: 0, items: [], error: e.message }; })
            );
        }
        
        if (typeList.includes('post')) {
            searchPromises.push(
                searchPosts(searchTerm, limitNum, offsetNum)
                    .then(r => { results.posts = r; })
                    .catch(e => { results.posts = { total: 0, items: [], error: e.message }; })
            );
        }
        
        if (typeList.includes('comment')) {
            searchPromises.push(
                searchComments(searchTerm, limitNum, offsetNum)
                    .then(r => { results.comments = r; })
                    .catch(e => { results.comments = { total: 0, items: [], error: e.message }; })
            );
        }
        
        await Promise.all(searchPromises);
        
        // 计算总结果数
        const totalResults = Object.values(results).reduce((sum, r) => sum + (r.total || 0), 0);
        
        res.json({
            success: true,
            data: results,
            meta: {
                keyword: searchTerm,
                types: typeList,
                searchTime: Date.now() - startTime,
                totalResults
            }
        });
        
    } catch (error) {
        console.error('搜索错误:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: '搜索服务暂时不可用，请稍后重试'
            }
        });
    }
});

/**
 * 参数验证
 */
function validateSearchParams({ keyword, types, limit, offset }) {
    if (!keyword || typeof keyword !== 'string') {
        return { valid: false, message: '搜索关键词不能为空' };
    }
    
    if (keyword.trim().length < 2) {
        return { valid: false, message: '搜索关键词至少需要 2 个字符' };
    }
    
    if (keyword.length > 100) {
        return { valid: false, message: '搜索关键词不能超过 100 个字符' };
    }
    
    if (types !== 'all') {
        const validTypes = ['testplan', 'case', 'post', 'comment'];
        const inputTypes = types.split(',').map(t => t.trim());
        const invalidTypes = inputTypes.filter(t => !validTypes.includes(t));
        if (invalidTypes.length > 0) {
            return { valid: false, message: `无效的搜索类型: ${invalidTypes.join(', ')}` };
        }
    }
    
    return { valid: true };
}

module.exports = router;
```

#### 5.3.2 测试计划搜索

```javascript
/**
 * 搜索测试计划
 */
async function searchTestPlans(keyword, limit, offset) {
    const searchPattern = `%${keyword}%`;
    
    // 获取总数
    const [countResult] = await pool.execute(`
        SELECT COUNT(*) as total
        FROM test_plans
        WHERE name LIKE ? 
           OR project LIKE ? 
           OR owner LIKE ?
           OR test_phase LIKE ?
    `, [searchPattern, searchPattern, searchPattern, searchPattern]);
    
    const total = countResult[0].total;
    
    // 获取结果
    const [rows] = await pool.execute(`
        SELECT 
            tp.id,
            tp.name,
            tp.project,
            tp.status,
            tp.owner,
            tp.test_phase,
            tp.pass_rate,
            tp.total_cases,
            tp.tested_cases,
            tp.updated_at,
            p.name as project_name
        FROM test_plans tp
        LEFT JOIN projects p ON tp.project = p.code
        WHERE tp.name LIKE ? 
           OR tp.project LIKE ? 
           OR tp.owner LIKE ?
           OR tp.test_phase LIKE ?
        ORDER BY tp.updated_at DESC
        LIMIT ? OFFSET ?
    `, [searchPattern, searchPattern, searchPattern, searchPattern, limit, offset]);
    
    return {
        total,
        hasMore: total > offset + limit,
        items: rows.map(row => ({
            id: row.id,
            name: row.name,
            project: row.project,
            projectName: row.project_name || row.project,
            status: row.status,
            owner: row.owner,
            testPhase: row.test_phase,
            passRate: row.pass_rate || 0,
            totalCases: row.total_cases || 0,
            testedCases: row.tested_cases || 0,
            updatedAt: row.updated_at
        }))
    };
}
```

#### 5.3.3 测试用例搜索

```javascript
/**
 * 搜索测试用例
 */
async function searchTestCases(keyword, limit, offset, userId) {
    const searchPattern = `%${keyword}%`;
    
    // 获取总数
    const [countResult] = await pool.execute(`
        SELECT COUNT(*) as total
        FROM test_cases tc
        LEFT JOIN modules m ON tc.module_id = m.id
        WHERE tc.name LIKE ? 
           OR tc.purpose LIKE ?
           OR m.name LIKE ?
    `, [searchPattern, searchPattern, searchPattern]);
    
    const total = countResult[0].total;
    
    // 获取结果
    const [rows] = await pool.execute(`
        SELECT 
            tc.id,
            tc.name,
            tc.priority,
            tc.type,
            tc.updated_at,
            m.id as module_id,
            m.name as module_name
        FROM test_cases tc
        LEFT JOIN modules m ON tc.module_id = m.id
        WHERE tc.name LIKE ? 
           OR tc.purpose LIKE ?
           OR m.name LIKE ?
        ORDER BY tc.updated_at DESC
        LIMIT ? OFFSET ?
    `, [searchPattern, searchPattern, searchPattern, limit, offset]);
    
    return {
        total,
        hasMore: total > offset + limit,
        items: rows.map(row => ({
            id: row.id,
            name: row.name,
            module: row.module_name || '未分类',
            moduleId: row.module_id,
            priority: row.priority,
            type: row.type || '功能测试',
            updatedAt: row.updated_at
        }))
    };
}
```

#### 5.3.4 论坛帖子搜索

```javascript
/**
 * 搜索论坛帖子
 */
async function searchPosts(keyword, limit, offset) {
    const hasChinese = /[\u4e00-\u9fa5]/.test(keyword);
    
    let countQuery, dataQuery, params;
    
    if (hasChinese) {
        // 中文使用 LIKE 搜索
        const searchPattern = `%${keyword}%`;
        countQuery = `
            SELECT COUNT(*) as total
            FROM forum_posts
            WHERE status = 'normal' 
              AND (title LIKE ? OR content LIKE ?)
        `;
        dataQuery = `
            SELECT 
                p.id,
                p.post_id,
                p.title,
                p.content,
                p.view_count,
                p.comment_count,
                p.like_count,
                p.is_anonymous,
                p.created_at,
                u.id as author_id,
                u.username as author_name
            FROM forum_posts p
            LEFT JOIN users u ON p.author_id = u.id
            WHERE p.status = 'normal' 
              AND (p.title LIKE ? OR p.content LIKE ?)
            ORDER BY p.is_pinned DESC, p.created_at DESC
            LIMIT ? OFFSET ?
        `;
        params = [searchPattern, searchPattern, searchPattern, searchPattern, limit, offset];
    } else {
        // 英文使用全文索引
        countQuery = `
            SELECT COUNT(*) as total
            FROM forum_posts
            WHERE status = 'normal'
              AND MATCH(title, content) AGAINST (? IN BOOLEAN MODE)
        `;
        dataQuery = `
            SELECT 
                p.id,
                p.post_id,
                p.title,
                p.content,
                p.view_count,
                p.comment_count,
                p.like_count,
                p.is_anonymous,
                p.created_at,
                u.id as author_id,
                u.username as author_name
            FROM forum_posts p
            LEFT JOIN users u ON p.author_id = u.id
            WHERE p.status = 'normal'
              AND MATCH(p.title, p.content) AGAINST (? IN BOOLEAN MODE)
            ORDER BY p.is_pinned DESC, p.created_at DESC
            LIMIT ? OFFSET ?
        `;
        params = [keyword, keyword, limit, offset];
    }
    
    // 获取总数
    const [countResult] = await pool.execute(countQuery, params.slice(0, hasChinese ? 2 : 1));
    const total = countResult[0].total;
    
    // 获取结果
    const [rows] = await pool.execute(dataQuery, params);
    
    return {
        total,
        hasMore: total > offset + limit,
        items: rows.map(row => ({
            id: row.id,
            postId: row.post_id,
            title: row.title,
            summary: escapeHtml(row.content.substring(0, 150).replace(/[#*`>\-\s]/g, ' ').trim()),
            author: row.is_anonymous ? '匿名工程师' : row.author_name,
            authorId: row.is_anonymous ? null : row.author_id,
            isAnonymous: row.is_anonymous === 1,
            viewCount: row.view_count,
            commentCount: row.comment_count,
            likeCount: row.like_count || 0,
            createdAt: row.created_at
        }))
    };
}

function escapeHtml(text) {
    if (!text) return '';
    const div = { textContent: '' };
    // 简单的 HTML 转义
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```

#### 5.3.5 论坛评论搜索

```javascript
/**
 * 搜索论坛评论
 */
async function searchComments(keyword, limit, offset) {
    const searchPattern = `%${keyword}%`;
    
    // 获取总数
    const [countResult] = await pool.execute(`
        SELECT COUNT(*) as total
        FROM forum_comments c
        JOIN forum_posts p ON c.post_id = p.id
        WHERE c.status = 'normal' 
          AND p.status = 'normal'
          AND c.content LIKE ?
    `, [searchPattern]);
    
    const total = countResult[0].total;
    
    // 获取结果
    const [rows] = await pool.execute(`
        SELECT 
            c.id,
            c.content,
            c.post_id,
            c.is_anonymous,
            c.created_at,
            p.title as post_title,
            u.id as author_id,
            u.username as author_name
        FROM forum_comments c
        JOIN forum_posts p ON c.post_id = p.id
        LEFT JOIN users u ON c.author_id = u.id
        WHERE c.status = 'normal' 
          AND p.status = 'normal'
          AND c.content LIKE ?
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
    `, [searchPattern, limit, offset]);
    
    return {
        total,
        hasMore: total > offset + limit,
        items: rows.map(row => ({
            id: row.id,
            content: row.content,
            contentPreview: row.content.substring(0, 100),
            postId: row.post_id,
            postTitle: row.post_title,
            author: row.is_anonymous ? '匿名工程师' : row.author_name,
            authorId: row.is_anonymous ? null : row.author_id,
            isAnonymous: row.is_anonymous === 1,
            createdAt: row.created_at
        }))
    };
}
```

---

## 六、前端实现设计

### 6.1 组件结构

```
CommandPalette/
├── index.js              # 主组件入口
├── SearchInput.js        # 搜索输入框
├── ResultList.js         # 结果列表
├── ResultCategory.js     # 结果分类
├── ResultItem.js         # 单个结果项
├── SearchHistory.js      # 搜索历史
├── KeyboardNavigator.js  # 键盘导航
├── api.js                # API 调用
├── utils.js              # 工具函数
└── styles.css            # 样式文件
```

### 6.2 核心代码实现

#### 6.2.1 主组件

```javascript
// CommandPalette/index.js
const CommandPalette = {
    // 状态
    isOpen: false,
    mode: 'command',        // 'command' | 'search'
    selectedIndex: 0,
    selectedCategory: 0,
    commands: [],
    filteredCommands: [],
    searchResults: null,
    searchKeyword: '',
    searchDebounce: null,
    isLoading: false,
    
    // DOM 元素引用
    element: null,
    input: null,
    results: null,
    modeIndicator: null,
    
    // 配置
    config: {
        debounceDelay: 300,
        minSearchLength: 2,
        maxHistoryItems: 10,
        searchLimit: 5
    },
    
    /**
     * 初始化
     */
    init() {
        this.commands = this.getCommands();
        this.render();
        this.bindEvents();
        this.loadSearchHistory();
    },
    
    /**
     * 获取命令列表
     */
    getCommands() {
        return [
            {
                id: 'global-search',
                title: '全局搜索',
                description: '搜索测试计划、用例、帖子、评论',
                icon: '🔍',
                shortcut: ['/'],
                action: () => this.switchToSearchMode()
            },
            {
                id: 'new-testplan',
                title: '新建测试计划',
                description: '创建一个新的测试计划',
                icon: '📋',
                shortcut: ['N', 'P'],
                action: () => { this.close(); addTestPlan(); }
            },
            {
                id: 'new-testcase',
                title: '新建测试用例',
                description: '创建一个新的测试用例',
                icon: '📝',
                shortcut: ['N', 'C'],
                action: () => { this.close(); addTestCase(); }
            },
            {
                id: 'dashboard',
                title: '仪表盘',
                description: '查看测试概览',
                icon: '📊',
                shortcut: ['G', 'D'],
                action: () => { this.close(); Router.navigateTo('dashboard'); }
            },
            {
                id: 'testplans',
                title: '测试计划',
                description: '管理测试计划',
                icon: '📋',
                shortcut: ['G', 'P'],
                action: () => { this.close(); Router.navigateTo('testplans'); }
            },
            {
                id: 'cases',
                title: '用例管理',
                description: '管理测试用例',
                icon: '📁',
                shortcut: ['G', 'C'],
                action: () => { this.close(); Router.navigateTo('cases'); }
            },
            {
                id: 'reports',
                title: '测试报告',
                description: '查看测试报告',
                icon: '📈',
                shortcut: ['G', 'R'],
                action: () => { this.close(); Router.navigateTo('reports'); }
            },
            {
                id: 'settings',
                title: '配置中心',
                description: '系统配置管理',
                icon: '⚙️',
                shortcut: ['G', 'S'],
                action: () => { this.close(); Router.navigateTo('settings'); }
            },
            {
                id: 'toggle-theme',
                title: '切换主题',
                description: '在浅色和暗黑模式之间切换',
                icon: '🌙',
                shortcut: ['T', 'T'],
                action: () => { ThemeSystem.toggle(); }
            },
            {
                id: 'ai-assistant',
                title: 'AI问答',
                description: '打开AI助手',
                icon: '🤖',
                shortcut: ['A', 'I'],
                action: () => { this.close(); openAIAssistant(); }
            },
            {
                id: 'forum',
                title: '技术论坛',
                description: '访问技术讨论区',
                icon: '💬',
                shortcut: ['G', 'F'],
                action: () => { this.close(); window.open('/forum.html', '_blank'); }
            }
        ];
    },
    
    /**
     * 渲染组件
     */
    render() {
        const palette = document.createElement('div');
        palette.id = 'command-palette';
        palette.className = 'command-palette';
        palette.innerHTML = `
            <div class="command-palette-container">
                <div class="command-palette-input-wrapper">
                    <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.35-4.35"></path>
                    </svg>
                    <input type="text" 
                           class="command-palette-input" 
                           id="command-input" 
                           placeholder="输入命令或搜索... (按 / 进入搜索模式)" 
                           autocomplete="off"
                           spellcheck="false">
                    <span class="mode-indicator" id="mode-indicator"></span>
                    <div class="shortcut-hint">
                        <kbd>ESC</kbd> 关闭
                    </div>
                </div>
                <div class="command-palette-results" id="command-results"></div>
            </div>
        `;
        
        document.body.appendChild(palette);
        
        this.element = palette;
        this.input = palette.querySelector('#command-input');
        this.results = palette.querySelector('#command-results');
        this.modeIndicator = palette.querySelector('#mode-indicator');
    },
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 全局快捷键
        document.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));
        
        // 输入事件
        this.input.addEventListener('input', (e) => this.handleInput(e));
        
        // 点击背景关闭
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.close();
            }
        });
    },
    
    /**
     * 处理全局键盘事件
     */
    handleGlobalKeydown(e) {
        // Ctrl+K 或 Cmd+K 打开/关闭命令面板
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
            return;
        }
        
        // 面板打开时的键盘事件
        if (this.isOpen) {
            // ESC 关闭
            if (e.key === 'Escape') {
                e.preventDefault();
                if (this.mode === 'search') {
                    this.switchToCommandMode();
                } else {
                    this.close();
                }
                return;
            }
            
            // / 进入搜索模式
            if (e.key === '/' && this.mode === 'command') {
                e.preventDefault();
                this.switchToSearchMode();
                return;
            }
            
            // 方向键导航
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.selectNext();
                return;
            }
            
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.selectPrev();
                return;
            }
            
            // Enter 执行
            if (e.key === 'Enter') {
                e.preventDefault();
                this.execute();
                return;
            }
            
            // Tab 切换分类 (搜索模式)
            if (e.key === 'Tab' && this.mode === 'search') {
                e.preventDefault();
                this.switchCategory(e.shiftKey ? -1 : 1);
                return;
            }
        }
    },
    
    /**
     * 处理输入
     */
    handleInput(e) {
        const value = e.target.value;
        
        if (this.mode === 'search') {
            this.searchKeyword = value;
            this.performSearch(value);
        } else {
            this.filterCommands(value);
        }
    },
    
    /**
     * 打开面板
     */
    open() {
        this.isOpen = true;
        this.selectedIndex = 0;
        this.element.classList.add('active');
        this.input.value = '';
        this.input.focus();
        
        if (this.mode === 'command') {
            this.filterCommands('');
        } else {
            this.renderSearchPrompt();
        }
    },
    
    /**
     * 关闭面板
     */
    close() {
        this.isOpen = false;
        this.element.classList.remove('active');
        this.mode = 'command';
        this.input.value = '';
        this.modeIndicator.textContent = '';
        this.input.placeholder = '输入命令或搜索... (按 / 进入搜索模式)';
    },
    
    /**
     * 切换到搜索模式
     */
    switchToSearchMode() {
        this.mode = 'search';
        this.selectedIndex = 0;
        this.selectedCategory = 0;
        this.input.placeholder = '搜索测试计划、用例、帖子、评论...';
        this.input.value = '';
        this.modeIndicator.textContent = '搜索';
        this.modeIndicator.classList.add('active');
        this.input.focus();
        this.renderSearchPrompt();
    },
    
    /**
     * 切换到命令模式
     */
    switchToCommandMode() {
        this.mode = 'command';
        this.input.value = '';
        this.modeIndicator.textContent = '';
        this.modeIndicator.classList.remove('active');
        this.input.placeholder = '输入命令或搜索... (按 / 进入搜索模式)';
        this.filterCommands('');
    },
    
    /**
     * 过滤命令
     */
    filterCommands(query) {
        const q = query.toLowerCase().trim();
        
        if (!q) {
            this.filteredCommands = this.commands;
        } else {
            this.filteredCommands = this.commands.filter(cmd =>
                cmd.title.toLowerCase().includes(q) ||
                cmd.description.toLowerCase().includes(q) ||
                cmd.id.toLowerCase().includes(q)
            );
        }
        
        this.selectedIndex = 0;
        this.renderCommandResults();
    },
    
    /**
     * 渲染命令结果
     */
    renderCommandResults() {
        if (this.filteredCommands.length === 0) {
            this.results.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-emoji">🔍</div>
                    <div class="empty-state-title">未找到匹配的命令</div>
                    <div class="empty-state-description">尝试其他关键词或按 / 进行全局搜索</div>
                </div>
            `;
            return;
        }
        
        this.results.innerHTML = this.filteredCommands.map((cmd, index) => `
            <div class="command-palette-item ${index === this.selectedIndex ? 'selected' : ''}" 
                 data-index="${index}">
                <div class="command-palette-item-icon">${cmd.icon}</div>
                <div class="command-palette-item-content">
                    <div class="command-palette-item-title">${cmd.title}</div>
                    <div class="command-palette-item-description">${cmd.description}</div>
                </div>
                ${cmd.shortcut ? `
                    <div class="command-palette-item-shortcut">
                        ${cmd.shortcut.map(k => `<kbd>${k}</kbd>`).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');
        
        this.bindCommandItemEvents();
    },
    
    /**
     * 绑定命令项点击事件
     */
    bindCommandItemEvents() {
        this.results.querySelectorAll('.command-palette-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.executeCommand(index);
            });
            
            item.addEventListener('mouseenter', () => {
                this.selectedIndex = parseInt(item.dataset.index);
                this.updateCommandSelection();
            });
        });
    },
    
    /**
     * 执行搜索
     */
    async performSearch(query) {
        clearTimeout(this.searchDebounce);
        
        if (query.length < this.config.minSearchLength) {
            this.renderSearchPrompt();
            return;
        }
        
        this.renderSearching();
        
        this.searchDebounce = setTimeout(async () => {
            try {
                this.isLoading = true;
                const response = await fetch(
                    `/api/search?keyword=${encodeURIComponent(query)}&limit=${this.config.searchLimit}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                        }
                    }
                );
                
                if (!response.ok) {
                    throw new Error('搜索请求失败');
                }
                
                const data = await response.json();
                
                if (data.success) {
                    this.searchResults = data.data;
                    this.renderSearchResults(query);
                    this.saveSearchHistory(query);
                } else {
                    this.renderSearchError(data.error?.message || '搜索失败');
                }
            } catch (error) {
                console.error('搜索错误:', error);
                this.renderSearchError('搜索服务暂时不可用');
            } finally {
                this.isLoading = false;
            }
        }, this.config.debounceDelay);
    },
    
    /**
     * 渲染搜索提示
     */
    renderSearchPrompt() {
        const history = this.getSearchHistory();
        
        let html = '<div class="search-prompt">';
        
        if (history.length > 0) {
            html += `
                <div class="search-history">
                    <div class="search-history-header">
                        <span class="history-title">最近搜索</span>
                        <button class="clear-history-btn" id="clear-history-btn">清除</button>
                    </div>
                    <div class="search-history-tags">
                        ${history.map(h => `
                            <span class="history-tag" data-keyword="${this.escapeHtml(h)}">${this.escapeHtml(h)}</span>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        html += `
            <div class="search-hints">
                <div class="search-hint-title">搜索提示</div>
                <div class="search-hint-items">
                    <div class="search-hint-item">
                        <span class="hint-icon">💡</span>
                        <span>输入至少 2 个字符开始搜索</span>
                    </div>
                    <div class="search-hint-item">
                        <span class="hint-icon">⌨️</span>
                        <span>使用 <kbd>↑</kbd> <kbd>↓</kbd> 导航，<kbd>Enter</kbd> 选择</span>
                    </div>
                    <div class="search-hint-item">
                        <span class="hint-icon">🔄</span>
                        <span>按 <kbd>Tab</kbd> 切换搜索分类</span>
                    </div>
                </div>
            </div>
        `;
        
        html += '</div>';
        
        this.results.innerHTML = html;
        this.bindSearchPromptEvents();
    },
    
    /**
     * 绑定搜索提示事件
     */
    bindSearchPromptEvents() {
        // 历史标签点击
        this.results.querySelectorAll('.history-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                const keyword = tag.dataset.keyword;
                this.input.value = keyword;
                this.searchKeyword = keyword;
                this.performSearch(keyword);
            });
        });
        
        // 清除历史按钮
        const clearBtn = this.results.querySelector('#clear-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearSearchHistory();
                this.renderSearchPrompt();
            });
        }
    },
    
    /**
     * 渲染搜索中状态
     */
    renderSearching() {
        this.results.innerHTML = `
            <div class="search-loading">
                <div class="loading-spinner"></div>
                <div class="loading-text">搜索中...</div>
            </div>
        `;
    },
    
    /**
     * 渲染搜索结果
     */
    renderSearchResults(keyword) {
        const { testPlans, testCases, posts, comments } = this.searchResults;
        
        const categories = [
            { key: 'testPlans', data: testPlans, icon: '📋', title: '测试计划' },
            { key: 'testCases', data: testCases, icon: '📝', title: '测试用例' },
            { key: 'posts', data: posts, icon: '💬', title: '论坛帖子' },
            { key: 'comments', data: comments, icon: '💭', title: '评论' }
        ].filter(c => c.data && c.data.items && c.data.items.length > 0);
        
        if (categories.length === 0) {
            this.results.innerHTML = `
                <div class="search-empty">
                    <div class="search-empty-icon">🔍</div>
                    <div class="search-empty-title">未找到 "${this.escapeHtml(keyword)}" 相关结果</div>
                    <div class="search-empty-hint">尝试其他关键词或检查拼写</div>
                </div>
            `;
            return;
        }
        
        let html = '';
        
        categories.forEach((category, catIndex) => {
            const isSelected = catIndex === this.selectedCategory;
            
            html += `
                <div class="search-category ${isSelected ? 'selected' : ''}" data-category="${category.key}">
                    <div class="search-category-header">
                        <span class="category-icon">${category.icon}</span>
                        <span class="category-title">${category.title}</span>
                        <span class="category-count">${category.data.total} 个结果</span>
                        ${category.data.hasMore ? '<span class="category-more">更多</span>' : ''}
                    </div>
                    <div class="search-category-items">
                        ${category.data.items.map((item, itemIndex) => `
                            <div class="search-item ${isSelected && itemIndex === this.selectedIndex ? 'selected' : ''}" 
                                 data-type="${category.key.slice(0, -1).replace('testPlan', 'testplan').replace('testCase', 'case')}"
                                 data-id="${item.id}"
                                 ${item.postId ? `data-post-id="${item.postId}"` : ''}>
                                <div class="search-item-icon">${category.icon}</div>
                                <div class="search-item-content">
                                    <div class="search-item-title">${this.highlightText(
                                        item.name || item.title || item.contentPreview || item.content,
                                        keyword
                                    )}</div>
                                    <div class="search-item-meta">
                                        ${this.renderItemMeta(category.key, item)}
                                    </div>
                                </div>
                                <div class="search-item-arrow">${category.key === 'posts' || category.key === 'comments' ? '↗' : '→'}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });
        
        this.results.innerHTML = html;
        this.bindSearchItemEvents();
    },
    
    /**
     * 渲染结果项元数据
     */
    renderItemMeta(categoryKey, item) {
        switch (categoryKey) {
            case 'testPlans':
                return `
                    <span>${item.projectName || item.project}</span>
                    <span class="meta-separator">·</span>
                    <span class="status-badge status-${item.status}">${item.status}</span>
                    <span class="meta-separator">·</span>
                    <span>${item.owner}</span>
                `;
            case 'testCases':
                return `
                    <span>${item.module}</span>
                    <span class="meta-separator">·</span>
                    <span class="priority-badge priority-${item.priority}">${item.priority}</span>
                    <span class="meta-separator">·</span>
                    <span>${item.type}</span>
                `;
            case 'posts':
                return `
                    <span>${item.author}</span>
                    <span class="meta-separator">·</span>
                    <span>💬 ${item.commentCount}</span>
                    <span class="meta-separator">·</span>
                    <span>${this.formatTime(item.createdAt)}</span>
                `;
            case 'comments':
                return `
                    <span>回复: ${item.postTitle}</span>
                    <span class="meta-separator">·</span>
                    <span>${item.author}</span>
                    <span class="meta-separator">·</span>
                    <span>${this.formatTime(item.createdAt)}</span>
                `;
            default:
                return '';
        }
    },
    
    /**
     * 绑定搜索结果项事件
     */
    bindSearchItemEvents() {
        this.results.querySelectorAll('.search-item').forEach(item => {
            item.addEventListener('click', () => {
                this.navigateToResult(
                    item.dataset.type,
                    item.dataset.id,
                    item.dataset.postId
                );
            });
            
            item.addEventListener('mouseenter', () => {
                const categoryEl = item.closest('.search-category');
                const categoryIndex = Array.from(
                    this.results.querySelectorAll('.search-category')
                ).indexOf(categoryEl);
                
                const itemIndex = Array.from(
                    categoryEl.querySelectorAll('.search-item')
                ).indexOf(item);
                
                this.selectedCategory = categoryIndex;
                this.selectedIndex = itemIndex;
                this.updateSearchSelection();
            });
        });
    },
    
    /**
     * 渲染搜索错误
     */
    renderSearchError(message) {
        this.results.innerHTML = `
            <div class="search-error">
                <div class="error-icon">⚠️</div>
                <div class="error-title">搜索出错</div>
                <div class="error-message">${this.escapeHtml(message)}</div>
                <button class="retry-btn" id="search-retry-btn">重试</button>
            </div>
        `;
        
        this.results.querySelector('#search-retry-btn').addEventListener('click', () => {
            this.performSearch(this.searchKeyword);
        });
    },
    
    /**
     * 选择下一个
     */
    selectNext() {
        if (this.mode === 'command') {
            this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
            this.updateCommandSelection();
        } else {
            this.selectNextSearchItem();
        }
    },
    
    /**
     * 选择上一个
     */
    selectPrev() {
        if (this.mode === 'command') {
            this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
            this.updateCommandSelection();
        } else {
            this.selectPrevSearchItem();
        }
    },
    
    /**
     * 选择下一个搜索结果
     */
    selectNextSearchItem() {
        const categories = this.results.querySelectorAll('.search-category');
        if (categories.length === 0) return;
        
        const currentCategory = categories[this.selectedCategory];
        const items = currentCategory.querySelectorAll('.search-item');
        
        if (this.selectedIndex < items.length - 1) {
            this.selectedIndex++;
        } else if (this.selectedCategory < categories.length - 1) {
            this.selectedCategory++;
            this.selectedIndex = 0;
        }
        
        this.updateSearchSelection();
    },
    
    /**
     * 选择上一个搜索结果
     */
    selectPrevSearchItem() {
        if (this.selectedIndex > 0) {
            this.selectedIndex--;
        } else if (this.selectedCategory > 0) {
            this.selectedCategory--;
            const prevCategory = this.results.querySelectorAll('.search-category')[this.selectedCategory];
            this.selectedIndex = prevCategory.querySelectorAll('.search-item').length - 1;
        }
        
        this.updateSearchSelection();
    },
    
    /**
     * 切换分类
     */
    switchCategory(direction) {
        const categories = this.results.querySelectorAll('.search-category');
        if (categories.length === 0) return;
        
        this.selectedCategory = Math.max(0, Math.min(
            this.selectedCategory + direction,
            categories.length - 1
        ));
        this.selectedIndex = 0;
        this.updateSearchSelection();
    },
    
    /**
     * 更新命令选择状态
     */
    updateCommandSelection() {
        this.results.querySelectorAll('.command-palette-item').forEach((item, index) => {
            item.classList.toggle('selected', index === this.selectedIndex);
        });
    },
    
    /**
     * 更新搜索选择状态
     */
    updateSearchSelection() {
        this.results.querySelectorAll('.search-category').forEach((cat, catIndex) => {
            cat.classList.toggle('selected', catIndex === this.selectedCategory);
        });
        
        const selectedCategory = this.results.querySelectorAll('.search-category')[this.selectedCategory];
        if (selectedCategory) {
            selectedCategory.querySelectorAll('.search-item').forEach((item, itemIndex) => {
                item.classList.toggle('selected', itemIndex === this.selectedIndex);
            });
        }
    },
    
    /**
     * 执行命令
     */
    executeCommand(index) {
        const cmd = this.filteredCommands[index];
        if (cmd && cmd.action) {
            this.close();
            cmd.action();
        }
    },
    
    /**
     * 执行当前选择
     */
    execute() {
        if (this.mode === 'command') {
            this.executeCommand(this.selectedIndex);
        } else {
            const categories = this.results.querySelectorAll('.search-category');
            const selectedCategory = categories[this.selectedCategory];
            if (selectedCategory) {
                const selectedItem = selectedCategory.querySelectorAll('.search-item')[this.selectedIndex];
                if (selectedItem) {
                    this.navigateToResult(
                        selectedItem.dataset.type,
                        selectedItem.dataset.id,
                        selectedItem.dataset.postId
                    );
                }
            }
        }
    },
    
    /**
     * 导航到结果详情
     */
    navigateToResult(type, id, postId) {
        this.close();
        
        switch (type) {
            case 'testplan':
                Router.navigateTo('testplan-detail', { id });
                break;
            case 'case':
                Router.navigateTo('case-detail', { id });
                break;
            case 'post':
                window.open(`/post-detail.html?id=${id}`, '_blank');
                break;
            case 'comment':
                window.open(`/post-detail.html?id=${postId}&comment=${id}`, '_blank');
                break;
        }
    },
    
    /**
     * 高亮文本
     */
    highlightText(text, keyword) {
        if (!text || !keyword) return this.escapeHtml(text || '');
        const escapedText = this.escapeHtml(text);
        const escapedKeyword = this.escapeHtml(keyword);
        const regex = new RegExp(`(${this.escapeRegex(escapedKeyword)})`, 'gi');
        return escapedText.replace(regex, '<mark class="highlight">$1</mark>');
    },
    
    /**
     * 转义正则特殊字符
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },
    
    /**
     * HTML 转义
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * 格式化时间
     */
    formatTime(dateStr) {
        if (!dateStr) return '';
        
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days < 7) return `${days}天前`;
        
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    },
    
    // ==================== 搜索历史 ====================
    
    /**
     * 加载搜索历史
     */
    loadSearchHistory() {
        this.searchHistory = JSON.parse(localStorage.getItem('globalSearchHistory') || '[]');
    },
    
    /**
     * 获取搜索历史
     */
    getSearchHistory() {
        return this.searchHistory || [];
    },
    
    /**
     * 保存搜索历史
     */
    saveSearchHistory(keyword) {
        if (!keyword || keyword.length < 2) return;
        
        let history = this.searchHistory.filter(h => h !== keyword);
        history.unshift(keyword);
        history = history.slice(0, this.config.maxHistoryItems);
        
        this.searchHistory = history;
        localStorage.setItem('globalSearchHistory', JSON.stringify(history));
    },
    
    /**
     * 清除搜索历史
     */
    clearSearchHistory() {
        this.searchHistory = [];
        localStorage.removeItem('globalSearchHistory');
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    CommandPalette.init();
});
```

### 6.3 样式设计

```css
/* styles/command-palette.css */

/* 面板容器 */
.command-palette {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 10000;
    display: none;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
}

.command-palette.active {
    display: flex;
}

/* 面板内容 */
.command-palette-container {
    width: 600px;
    max-width: 90vw;
    max-height: 70vh;
    background: var(--color-bg-primary, #ffffff);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

/* 暗色主题 */
@media (prefers-color-scheme: dark) {
    .command-palette-container {
        background: #1e1e1e;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }
}

/* 输入区域 */
.command-palette-input-wrapper {
    display: flex;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-border, #e0e0e0);
    position: relative;
}

.search-icon {
    color: var(--color-text-secondary, #666);
    margin-right: 12px;
    flex-shrink: 0;
}

.command-palette-input {
    flex: 1;
    border: none;
    outline: none;
    font-size: 16px;
    background: transparent;
    color: var(--color-text-primary, #333);
}

.command-palette-input::placeholder {
    color: var(--color-text-tertiary, #999);
}

.mode-indicator {
    position: absolute;
    right: 80px;
    background: var(--color-primary, #007bff);
    color: white;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    display: none;
}

.mode-indicator.active {
    display: block;
}

.shortcut-hint {
    position: absolute;
    right: 20px;
    font-size: 12px;
    color: var(--color-text-tertiary, #999);
}

.shortcut-hint kbd {
    background: var(--color-bg-secondary, #f5f5f5);
    border: 1px solid var(--color-border, #ddd);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: inherit;
    font-size: 11px;
}

/* 结果区域 */
.command-palette-results {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
}

/* 命令项 */
.command-palette-item {
    display: flex;
    align-items: center;
    padding: 12px 20px;
    cursor: pointer;
    transition: background 0.15s;
}

.command-palette-item:hover,
.command-palette-item.selected {
    background: var(--color-bg-hover, #f0f0f0);
}

.command-palette-item-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-secondary, #f5f5f5);
    border-radius: 8px;
    margin-right: 14px;
    font-size: 18px;
}

.command-palette-item-content {
    flex: 1;
    min-width: 0;
}

.command-palette-item-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text-primary, #333);
}

.command-palette-item-description {
    font-size: 12px;
    color: var(--color-text-secondary, #666);
    margin-top: 2px;
}

.command-palette-item-shortcut {
    display: flex;
    gap: 4px;
}

.command-palette-item-shortcut kbd {
    background: var(--color-bg-secondary, #f5f5f5);
    border: 1px solid var(--color-border, #ddd);
    border-radius: 4px;
    padding: 3px 6px;
    font-family: inherit;
    font-size: 11px;
    color: var(--color-text-secondary, #666);
}

/* 搜索分类 */
.search-category {
    margin-bottom: 8px;
}

.search-category.selected {
    background: var(--color-bg-selected, rgba(0, 123, 255, 0.05));
}

.search-category-header {
    display: flex;
    align-items: center;
    padding: 10px 20px;
    background: var(--color-bg-secondary, #f8f8f8);
    font-size: 12px;
    color: var(--color-text-secondary, #666);
    position: sticky;
    top: 0;
    z-index: 1;
}

.category-icon {
    margin-right: 8px;
    font-size: 14px;
}

.category-title {
    font-weight: 600;
    color: var(--color-text-primary, #333);
}

.category-count {
    margin-left: auto;
    font-size: 11px;
    color: var(--color-text-tertiary, #999);
}

.category-more {
    margin-left: 8px;
    color: var(--color-primary, #007bff);
    font-size: 11px;
}

/* 搜索项 */
.search-item {
    display: flex;
    align-items: center;
    padding: 12px 20px;
    cursor: pointer;
    transition: background 0.15s;
}

.search-item:hover,
.search-item.selected {
    background: var(--color-bg-hover, #f0f0f0);
}

.search-item-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-secondary, #f5f5f5);
    border-radius: 6px;
    margin-right: 12px;
    font-size: 14px;
}

.search-item-content {
    flex: 1;
    min-width: 0;
}

.search-item-title {
    font-size: 14px;
    color: var(--color-text-primary, #333);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.search-item-title .highlight {
    background: #fff3cd;
    color: inherit;
    padding: 0 2px;
    border-radius: 2px;
}

.search-item-meta {
    font-size: 12px;
    color: var(--color-text-secondary, #666);
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
}

.meta-separator {
    color: var(--color-text-tertiary, #ccc);
}

.search-item-arrow {
    color: var(--color-text-tertiary, #999);
    font-size: 14px;
    margin-left: 8px;
}

/* 状态徽章 */
.status-badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
}

.status-进行中 {
    background: #e3f2fd;
    color: #1976d2;
}

.status-已完成 {
    background: #e8f5e9;
    color: #388e3c;
}

.status-待开始 {
    background: #fff3e0;
    color: #f57c00;
}

.status-已暂停 {
    background: #fce4ec;
    color: #c2185b;
}

/* 优先级徽章 */
.priority-badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
}

.priority-P0 {
    background: #ffebee;
    color: #c62828;
}

.priority-P1 {
    background: #fff3e0;
    color: #e65100;
}

.priority-P2 {
    background: #fff8e1;
    color: #f57f17;
}

.priority-P3 {
    background: #f5f5f5;
    color: #616161;
}

/* 搜索提示 */
.search-prompt {
    padding: 20px;
}

.search-history {
    margin-bottom: 20px;
}

.search-history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.history-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary, #666);
}

.clear-history-btn {
    background: none;
    border: none;
    color: var(--color-primary, #007bff);
    font-size: 12px;
    cursor: pointer;
}

.clear-history-btn:hover {
    text-decoration: underline;
}

.search-history-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.history-tag {
    background: var(--color-bg-secondary, #f5f5f5);
    border: 1px solid var(--color-border, #e0e0e0);
    border-radius: 16px;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--color-text-primary, #333);
    cursor: pointer;
    transition: all 0.15s;
}

.history-tag:hover {
    background: var(--color-primary, #007bff);
    border-color: var(--color-primary, #007bff);
    color: white;
}

.search-hints {
    padding: 16px;
    background: var(--color-bg-secondary, #f8f8f8);
    border-radius: 8px;
}

.search-hint-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary, #666);
    margin-bottom: 12px;
}

.search-hint-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.search-hint-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--color-text-secondary, #666);
}

.hint-icon {
    font-size: 14px;
}

.search-hint-item kbd {
    background: white;
    border: 1px solid var(--color-border, #ddd);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: inherit;
    font-size: 11px;
}

/* 加载状态 */
.search-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
}

.loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border, #e0e0e0);
    border-top-color: var(--color-primary, #007bff);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.loading-text {
    margin-top: 12px;
    font-size: 14px;
    color: var(--color-text-secondary, #666);
}

/* 空状态 */
.search-empty,
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
}

.search-empty-icon,
.empty-state-emoji {
    font-size: 48px;
    margin-bottom: 16px;
}

.search-empty-title,
.empty-state-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text-primary, #333);
    margin-bottom: 8px;
}

.search-empty-hint,
.empty-state-description {
    font-size: 13px;
    color: var(--color-text-secondary, #666);
}

/* 错误状态 */
.search-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
}

.error-icon {
    font-size: 48px;
    margin-bottom: 16px;
}

.error-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text-primary, #333);
    margin-bottom: 8px;
}

.error-message {
    font-size: 13px;
    color: var(--color-text-secondary, #666);
    margin-bottom: 16px;
}

.retry-btn {
    background: var(--color-primary, #007bff);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s;
}

.retry-btn:hover {
    background: var(--color-primary-dark, #0056b3);
}

/* 滚动条样式 */
.command-palette-results::-webkit-scrollbar {
    width: 8px;
}

.command-palette-results::-webkit-scrollbar-track {
    background: transparent;
}

.command-palette-results::-webkit-scrollbar-thumb {
    background: var(--color-border, #ddd);
    border-radius: 4px;
}

.command-palette-results::-webkit-scrollbar-thumb:hover {
    background: var(--color-text-tertiary, #bbb);
}
```

---

## 七、数据库优化

### 7.1 索引优化

```sql
-- 测试计划表索引
ALTER TABLE test_plans ADD INDEX idx_name_owner (name, owner);
ALTER TABLE test_plans ADD INDEX idx_updated_at (updated_at);

-- 测试用例表索引
ALTER TABLE test_cases ADD INDEX idx_name_module (name, module_id);
ALTER TABLE test_cases ADD INDEX idx_purpose (purpose(100));

-- 论坛帖子表（已有全文索引，确保配置正确）
-- 检查全文索引配置
SHOW INDEX FROM forum_posts WHERE Index_type = 'FULLTEXT';

-- 论坛评论表索引
ALTER TABLE forum_comments ADD INDEX idx_content (content(100));
ALTER TABLE forum_comments ADD INDEX idx_status_created (status, created_at);
```

### 7.2 查询优化建议

```sql
-- 使用 EXPLAIN 分析查询计划
EXPLAIN SELECT * FROM test_plans WHERE name LIKE '%性能%';

-- 对于大型表，考虑使用覆盖索引
ALTER TABLE test_plans ADD INDEX idx_search_cover (name, project, owner, status, updated_at);
```

### 7.3 缓存策略

```javascript
// 服务端缓存配置
const NodeCache = require('node-cache');
const searchCache = new NodeCache({ 
    stdTTL: 60,           // 缓存 60 秒
    checkperiod: 30,      // 每 30 秒检查过期
    maxKeys: 1000         // 最多缓存 1000 个关键词
});

// 在搜索接口中使用缓存
async function searchWithCache(keyword, types, limit) {
    const cacheKey = `${keyword}:${types}:${limit}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached) {
        return cached;
    }
    
    const result = await performSearch(keyword, types, limit);
    searchCache.set(cacheKey, result);
    
    return result;
}
```

---

## 八、交互设计

### 8.1 快捷键映射表

| 快捷键 | 上下文 | 功能 |
|--------|--------|------|
| `Ctrl/Cmd + K` | 全局 | 打开/关闭命令面板 |
| `/` | 命令模式 | 切换到搜索模式 |
| `Esc` | 搜索模式 | 返回命令模式 |
| `Esc` | 命令模式 | 关闭面板 |
| `↑` `↓` | 面板内 | 导航结果 |
| `Enter` | 面板内 | 选择并执行 |
| `Tab` | 搜索模式 | 切换分类（正向） |
| `Shift + Tab` | 搜索模式 | 切换分类（反向） |

### 8.2 交互流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          交互流程图                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────┐                                                       │
│   │ 用户    │                                                       │
│   └────┬────┘                                                       │
│        │                                                            │
│        │ Ctrl+K                                                     │
│        ▼                                                            │
│   ┌─────────────┐                                                   │
│   │ 打开命令面板 │◀──────────────────────────────┐                  │
│   │ (命令模式)   │                               │                  │
│   └──────┬──────┘                               │                  │
│          │                                      │                  │
│          ├──────────────────┬───────────────────┤                  │
│          │                  │                   │                  │
│          │ 输入命令         │ 按 /              │ Esc              │
│          │                  │                   │                  │
│          ▼                  ▼                   │                  │
│   ┌─────────────┐    ┌─────────────┐           │                  │
│   │ 过滤命令    │    │ 切换搜索模式 │           │                  │
│   │ 显示结果    │    └──────┬──────┘           │                  │
│   └──────┬──────┘           │                  │                  │
│          │                  │                  │                  │
│          │ Enter            │ 输入关键词       │                  │
│          │                  │ (≥2字符)         │                  │
│          ▼                  ▼                  │                  │
│   ┌─────────────┐    ┌─────────────┐           │                  │
│   │ 执行命令    │    │ 实时搜索    │           │                  │
│   │ 关闭面板    │    │ 显示结果    │           │                  │
│   └─────────────┘    └──────┬──────┘           │                  │
│                             │                  │                  │
│                             │ ↑↓ 导航          │                  │
│                             │ Enter 选择       │                  │
│                             │                  │                  │
│                             ▼                  │                  │
│                      ┌─────────────┐           │                  │
│                      │ 跳转详情页  │           │                  │
│                      │ 关闭面板    │───────────┘                  │
│                      └─────────────┘                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.3 状态转换图

```
┌─────────────────────────────────────────────────────────────────┐
│                        状态转换图                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐     Ctrl+K      ┌─────────┐                      │
│   │  关闭   │ ───────────────▶│ 命令模式 │                      │
│   └─────────┘                 └────┬────┘                      │
│        ▲                           │                           │
│        │                           │ /                         │
│        │                           ▼                           │
│        │                     ┌─────────┐                       │
│        │                     │ 搜索模式 │                       │
│        │                     └────┬────┘                       │
│        │                          │                            │
│        │           ┌──────────────┼──────────────┐            │
│        │           │              │              │            │
│        │     输入关键词      选择结果        Esc           │
│        │           │              │              │            │
│        │           ▼              ▼              │            │
│        │     ┌─────────┐   ┌─────────┐          │            │
│        │     │ 搜索中  │   │ 跳转页面 │          │            │
│        │     └────┬────┘   └─────────┘          │            │
│        │          │                               │            │
│        │    返回结果                          Esc │            │
│        │          │                               │            │
│        │          ▼                               │            │
│        │    ┌─────────┐                          │            │
│        │    │ 显示结果 │◀─────────────────────────┘            │
│        │    └─────────┘                                       │
│        │                                                       │
│        └───────────────────────────────────────────────────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九、扩展功能设计

### 9.1 高级搜索语法

支持类似 GitHub 或 Google 的搜索语法：

| 语法 | 说明 | 示例 |
|------|------|------|
| `keyword` | 全文搜索 | `性能测试` |
| `project:xxx` | 按项目过滤 | `project:XProject 登录` |
| `author:xxx` | 按作者过滤 | `author:张三 测试计划` |
| `type:xxx` | 按类型过滤 | `type:case 登录` |
| `status:xxx` | 按状态过滤 | `status:进行中 性能` |
| `priority:P0` | 按优先级过滤 | `priority:P0 登录` |

**解析器实现：**

```javascript
/**
 * 高级搜索语法解析器
 */
class AdvancedSearchParser {
    constructor() {
        this.filters = {
            project: { field: 'project', type: 'string' },
            author: { field: 'author', type: 'string' },
            owner: { field: 'owner', type: 'string' },
            type: { field: 'type', type: 'enum', values: ['testplan', 'case', 'post', 'comment'] },
            status: { field: 'status', type: 'enum', values: ['待开始', '进行中', '已完成', '已暂停'] },
            priority: { field: 'priority', type: 'enum', values: ['P0', 'P1', 'P2', 'P3'] }
        };
    }
    
    /**
     * 解析搜索查询
     * @param {string} query - 原始查询字符串
     * @returns {Object} 解析结果
     */
    parse(query) {
        const result = {
            keyword: '',
            filters: {},
            raw: query
        };
        
        // 匹配 filter:value 格式
        const filterPattern = /(\w+):([^\s]+)/g;
        let match;
        let cleanedQuery = query;
        
        while ((match = filterPattern.exec(query)) !== null) {
            const [fullMatch, filterName, filterValue] = match;
            
            if (this.filters[filterName]) {
                const filterConfig = this.filters[filterName];
                
                // 验证枚举值
                if (filterConfig.type === 'enum' && !filterConfig.values.includes(filterValue)) {
                    continue;
                }
                
                result.filters[filterName] = filterValue;
                cleanedQuery = cleanedQuery.replace(fullMatch, '');
            }
        }
        
        // 剩余部分作为关键词
        result.keyword = cleanedQuery.trim().replace(/\s+/g, ' ');
        
        return result;
    }
    
    /**
     * 将解析结果转换为 API 参数
     */
    toApiParams(parsed) {
        const params = {
            keyword: parsed.keyword
        };
        
        if (parsed.filters.type) {
            params.types = parsed.filters.type;
        }
        
        // 其他过滤条件作为额外参数
        Object.entries(parsed.filters).forEach(([key, value]) => {
            if (key !== 'type') {
                params[key] = value;
            }
        });
        
        return params;
    }
}

// 使用示例
const parser = new AdvancedSearchParser();
const result = parser.parse('project:XProject author:张三 性能测试');
// result = {
//     keyword: '性能测试',
//     filters: { project: 'XProject', author: '张三' },
//     raw: 'project:XProject author:张三 性能测试'
// }
```

### 9.2 搜索统计与分析

```javascript
/**
 * 搜索统计服务
 */
class SearchAnalytics {
    constructor() {
        this.storageKey = 'searchAnalytics';
    }
    
    /**
     * 记录搜索行为
     */
    recordSearch(keyword, results) {
        const analytics = this.getAnalytics();
        const today = new Date().toISOString().split('T')[0];
        
        if (!analytics.daily[today]) {
            analytics.daily[today] = { searches: 0, clicks: 0 };
        }
        
        analytics.daily[today].searches++;
        analytics.totalSearches++;
        
        // 记录热门关键词
        if (!analytics.keywords[keyword]) {
            analytics.keywords[keyword] = { count: 0, clicks: 0 };
        }
        analytics.keywords[keyword].count++;
        
        this.saveAnalytics(analytics);
    }
    
    /**
     * 记录点击行为
     */
    recordClick(keyword, resultType, resultId) {
        const analytics = this.getAnalytics();
        const today = new Date().toISOString().split('T')[0];
        
        if (analytics.daily[today]) {
            analytics.daily[today].clicks++;
        }
        
        if (analytics.keywords[keyword]) {
            analytics.keywords[keyword].clicks++;
        }
        
        analytics.totalClicks++;
        
        this.saveAnalytics(analytics);
    }
    
    /**
     * 获取热门关键词
     */
    getHotKeywords(limit = 10) {
        const analytics = this.getAnalytics();
        
        return Object.entries(analytics.keywords)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, limit)
            .map(([keyword, data]) => ({
                keyword,
                count: data.count,
                clickRate: data.count > 0 ? (data.clicks / data.count * 100).toFixed(1) : 0
            }));
    }
    
    /**
     * 获取统计数据
     */
    getAnalytics() {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
            return JSON.parse(stored);
        }
        
        return {
            totalSearches: 0,
            totalClicks: 0,
            keywords: {},
            daily: {}
        };
    }
    
    /**
     * 保存统计数据
     */
    saveAnalytics(analytics) {
        localStorage.setItem(this.storageKey, JSON.stringify(analytics));
    }
}
```

### 9.3 搜索结果导出

```javascript
/**
 * 导出搜索结果
 */
async function exportSearchResults(keyword, format = 'csv') {
    const response = await fetch(
        `/api/search?keyword=${encodeURIComponent(keyword)}&limit=100`,
        {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        }
    );
    
    const data = await response.json();
    
    if (!data.success) {
        throw new Error('导出失败');
    }
    
    if (format === 'csv') {
        return exportToCSV(data.data);
    } else if (format === 'json') {
        return JSON.stringify(data.data, null, 2);
    }
}

function exportToCSV(results) {
    const rows = [];
    
    // 测试计划
    if (results.testPlans?.items) {
        results.testPlans.items.forEach(item => {
            rows.push({
                type: '测试计划',
                name: item.name,
                project: item.projectName,
                status: item.status,
                owner: item.owner
            });
        });
    }
    
    // 测试用例
    if (results.testCases?.items) {
        results.testCases.items.forEach(item => {
            rows.push({
                type: '测试用例',
                name: item.name,
                module: item.module,
                priority: item.priority,
                type: item.type
            });
        });
    }
    
    // ... 其他类型
    
    // 生成 CSV
    const headers = Object.keys(rows[0] || {});
    const csvContent = [
        headers.join(','),
        ...rows.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');
    
    return csvContent;
}
```

---

## 十、错误处理与边界情况

### 10.1 错误处理策略

| 错误类型 | 处理方式 | 用户提示 |
|----------|----------|----------|
| 网络错误 | 重试 3 次 | "网络连接失败，正在重试..." |
| 认证过期 | 跳转登录 | "登录已过期，请重新登录" |
| 参数错误 | 返回空结果 | "请输入有效的搜索关键词" |
| 服务超时 | 降级处理 | "搜索服务响应较慢，请稍后重试" |
| 数据库错误 | 记录日志 | "搜索服务暂时不可用" |

### 10.2 边界情况处理

```javascript
/**
 * 边界情况处理
 */
const EdgeCaseHandler = {
    /**
     * 处理空关键词
     */
    handleEmptyKeyword() {
        return {
            success: true,
            data: {},
            meta: { keyword: '', totalResults: 0 }
        };
    },
    
    /**
     * 处理超长关键词
     */
    handleLongKeyword(keyword, maxLength = 100) {
        if (keyword.length > maxLength) {
            return {
                success: false,
                error: {
                    code: 'KEYWORD_TOO_LONG',
                    message: `搜索关键词不能超过 ${maxLength} 个字符`
                }
            };
        }
        return null;
    },
    
    /**
     * 处理特殊字符
     */
    sanitizeKeyword(keyword) {
        // 移除可能导致 SQL 注入的字符
        return keyword
            .replace(/[<>\"\'\\]/g, '')
            .trim();
    },
    
    /**
     * 处理无结果情况
     */
    handleNoResults(keyword) {
        return {
            success: true,
            data: {
                testPlans: { total: 0, items: [] },
                testCases: { total: 0, items: [] },
                posts: { total: 0, items: [] },
                comments: { total: 0, items: [] }
            },
            meta: {
                keyword,
                totalResults: 0,
                suggestions: [
                    '检查关键词是否正确',
                    '尝试使用更通用的关键词',
                    '减少过滤条件'
                ]
            }
        };
    },
    
    /**
     * 处理并发搜索限制
     */
    handleRateLimit(userId) {
        // 检查用户搜索频率
        const key = `search_limit_${userId}`;
        const count = parseInt(localStorage.getItem(key) || '0');
        
        if (count > 30) { // 每分钟最多 30 次
            return {
                success: false,
                error: {
                    code: 'RATE_LIMITED',
                    message: '搜索频率过高，请稍后再试'
                }
            };
        }
        
        localStorage.setItem(key, count + 1);
        setTimeout(() => {
            localStorage.setItem(key, Math.max(0, count - 1));
        }, 2000);
        
        return null;
    }
};
```

### 10.3 降级方案

```javascript
/**
 * 搜索服务降级处理
 */
const SearchFallback = {
    /**
     * 降级到本地搜索
     */
    async localSearch(keyword) {
        // 从 localStorage 中搜索已缓存的数据
        const cachedData = this.getCachedData();
        
        const results = {
            testPlans: { total: 0, items: [] },
            testCases: { total: 0, items: [] },
            posts: { total: 0, items: [] },
            comments: { total: 0, items: [] }
        };
        
        // 简单的本地过滤
        if (cachedData.testPlans) {
            results.testPlans.items = cachedData.testPlans
                .filter(p => p.name.includes(keyword))
                .slice(0, 5);
            results.testPlans.total = results.testPlans.items.length;
        }
        
        return {
            success: true,
            data: results,
            meta: {
                keyword,
                totalResults: results.testPlans.total,
                isFallback: true
            }
        };
    },
    
    /**
     * 获取缓存数据
     */
    getCachedData() {
        return {
            testPlans: JSON.parse(localStorage.getItem('cachedTestPlans') || '[]'),
            testCases: JSON.parse(localStorage.getItem('cachedTestCases') || '[]')
        };
    }
};
```

---

## 十一、性能优化策略

### 11.1 前端优化

| 优化项 | 实现方式 | 预期效果 |
|--------|----------|----------|
| 防抖 | 300ms 延迟 | 减少不必要的请求 |
| 虚拟滚动 | 仅渲染可见项 | 大结果列表流畅滚动 |
| 请求取消 | AbortController | 避免过期请求 |
| 结果缓存 | 内存缓存 | 重复搜索秒开 |

```javascript
// 请求取消实现
const SearchAbortController = {
    controller: null,
    
    async search(keyword) {
        // 取消之前的请求
        if (this.controller) {
            this.controller.abort();
        }
        
        this.controller = new AbortController();
        
        try {
            const response = await fetch('/api/search', {
                signal: this.controller.signal,
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            
            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('请求已取消');
                return null;
            }
            throw error;
        }
    }
};
```

### 11.2 后端优化

| 优化项 | 实现方式 | 预期效果 |
|--------|----------|----------|
| 并行查询 | Promise.all | 减少总响应时间 |
| 连接池 | 数据库连接池 | 提高并发能力 |
| 结果缓存 | Redis/内存缓存 | 热门关键词秒回 |
| 索引优化 | 复合索引 | 加速 LIKE 查询 |

```javascript
// 并行查询优化
async function parallelSearch(keyword, limit) {
    const startTime = Date.now();
    
    // 并行执行所有搜索
    const [testPlans, testCases, posts, comments] = await Promise.all([
        searchTestPlans(keyword, limit).catch(e => ({ total: 0, items: [], error: e.message })),
        searchTestCases(keyword, limit).catch(e => ({ total: 0, items: [], error: e.message })),
        searchPosts(keyword, limit).catch(e => ({ total: 0, items: [], error: e.message })),
        searchComments(keyword, limit).catch(e => ({ total: 0, items: [], error: e.message }))
    ]);
    
    console.log(`搜索耗时: ${Date.now() - startTime}ms`);
    
    return { testPlans, testCases, posts, comments };
}
```

### 11.3 性能监控

```javascript
/**
 * 性能监控
 */
const PerformanceMonitor = {
    metrics: [],
    
    /**
     * 记录搜索性能
     */
    record(operation, duration, success) {
        this.metrics.push({
            operation,
            duration,
            success,
            timestamp: Date.now()
        });
        
        // 只保留最近 100 条记录
        if (this.metrics.length > 100) {
            this.metrics.shift();
        }
        
        // 上报性能数据
        this.report();
    },
    
    /**
     * 获取性能统计
     */
    getStats() {
        const successMetrics = this.metrics.filter(m => m.success);
        
        if (successMetrics.length === 0) {
            return null;
        }
        
        const durations = successMetrics.map(m => m.duration);
        
        return {
            count: this.metrics.length,
            successRate: (successMetrics.length / this.metrics.length * 100).toFixed(1),
            avgDuration: (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(0),
            maxDuration: Math.max(...durations),
            minDuration: Math.min(...durations),
            p95Duration: this.percentile(durations, 95)
        };
    },
    
    /**
     * 计算百分位数
     */
    percentile(arr, p) {
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil(sorted.length * p / 100) - 1;
        return sorted[index];
    },
    
    /**
     * 上报性能数据
     */
    report() {
        // 可以发送到后端进行统计分析
        // fetch('/api/analytics/performance', { ... });
    }
};
```

---

## 十二、测试方案

### 12.1 单元测试

```javascript
// tests/search.test.js

describe('SearchParser', () => {
    let parser;
    
    beforeEach(() => {
        parser = new AdvancedSearchParser();
    });
    
    describe('parse', () => {
        it('should parse simple keyword', () => {
            const result = parser.parse('性能测试');
            expect(result.keyword).toBe('性能测试');
            expect(result.filters).toEqual({});
        });
        
        it('should parse keyword with filter', () => {
            const result = parser.parse('project:XProject 性能测试');
            expect(result.keyword).toBe('性能测试');
            expect(result.filters.project).toBe('XProject');
        });
        
        it('should parse multiple filters', () => {
            const result = parser.parse('project:XProject author:张三 type:case 登录');
            expect(result.keyword).toBe('登录');
            expect(result.filters.project).toBe('XProject');
            expect(result.filters.author).toBe('张三');
            expect(result.filters.type).toBe('case');
        });
        
        it('should ignore invalid filter values', () => {
            const result = parser.parse('type:invalid 性能测试');
            expect(result.filters.type).toBeUndefined();
        });
    });
});

describe('CommandPalette', () => {
    describe('highlightText', () => {
        it('should highlight matching text', () => {
            const result = CommandPalette.highlightText('性能测试计划', '性能');
            expect(result).toBe('<mark class="highlight">性能</mark>测试计划');
        });
        
        it('should handle empty text', () => {
            const result = CommandPalette.highlightText('', '性能');
            expect(result).toBe('');
        });
        
        it('should handle empty keyword', () => {
            const result = CommandPalette.highlightText('性能测试计划', '');
            expect(result).toBe('性能测试计划');
        });
    });
    
    describe('formatTime', () => {
        it('should format recent time', () => {
            const now = new Date();
            const result = CommandPalette.formatTime(now.toISOString());
            expect(result).toBe('刚刚');
        });
        
        it('should format hours ago', () => {
            const hoursAgo = new Date(Date.now() - 2 * 3600000);
            const result = CommandPalette.formatTime(hoursAgo.toISOString());
            expect(result).toBe('2小时前');
        });
    });
});
```

### 12.2 集成测试

```javascript
// tests/api/search.test.js

describe('Search API', () => {
    let authToken;
    
    beforeAll(async () => {
        // 获取测试用户 token
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ username: 'testuser', password: 'testpass' });
        authToken = loginRes.body.token;
    });
    
    describe('GET /api/search', () => {
        it('should return search results', async () => {
            const res = await request(app)
                .get('/api/search?keyword=测试')
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.meta.keyword).toBe('测试');
        });
        
        it('should return error for short keyword', async () => {
            const res = await request(app)
                .get('/api/search?keyword=测')
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_PARAMS');
        });
        
        it('should filter by type', async () => {
            const res = await request(app)
                .get('/api/search?keyword=测试&types=testplan')
                .set('Authorization', `Bearer ${authToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body.data.testPlans).toBeDefined();
            expect(res.body.data.testCases).toBeUndefined();
            expect(res.body.data.posts).toBeUndefined();
        });
        
        it('should return 401 without auth', async () => {
            const res = await request(app)
                .get('/api/search?keyword=测试');
            
            expect(res.status).toBe(401);
        });
    });
});
```

### 12.3 E2E 测试

```javascript
// e2e/search.spec.js

describe('Global Search', () => {
    beforeEach(() => {
        cy.login('testuser', 'testpass');
    });
    
    it('should open command palette with Ctrl+K', () => {
        cy.get('body').type('{ctrl}k');
        cy.get('#command-palette').should('be.visible');
        cy.get('#command-input').should('be.focused');
    });
    
    it('should switch to search mode with /', () => {
        cy.get('body').type('{ctrl}k');
        cy.get('#command-input').type('/');
        cy.get('.mode-indicator').should('contain', '搜索');
    });
    
    it('should display search results', () => {
        cy.get('body').type('{ctrl}k');
        cy.get('#command-input').type('/性能测试');
        
        // 等待搜索完成
        cy.get('.search-category', { timeout: 5000 }).should('exist');
        cy.get('.search-item').should('have.length.gt', 0);
    });
    
    it('should navigate results with arrow keys', () => {
        cy.get('body').type('{ctrl}k');
        cy.get('#command-input').type('/性能测试');
        
        cy.get('.search-item').should('exist');
        cy.get('body').type('{downArrow}');
        cy.get('.search-item.selected').should('exist');
    });
    
    it('should navigate to result on Enter', () => {
        cy.get('body').type('{ctrl}k');
        cy.get('#command-input').type('/性能测试');
        
        cy.get('.search-item').first().click();
        
        // 应该跳转到详情页
        cy.url().should('include', '/testplan');
    });
    
    it('should close with Escape', () => {
        cy.get('body').type('{ctrl}k');
        cy.get('#command-palette').should('be.visible');
        
        cy.get('body').type('{esc}');
        cy.get('#command-palette').should('not.be.visible');
    });
});
```

---

## 十三、实施计划

### 13.1 阶段划分

#### Phase 1: 基础搜索功能 (2-3 天)

| 任务 | 工作内容 | 预估时间 |
|------|----------|----------|
| 后端 API | 创建统一搜索接口 | 4h |
| 数据库优化 | 添加必要索引 | 2h |
| 前端基础 | 命令面板搜索模式 | 4h |
| 结果展示 | 分类展示搜索结果 | 4h |
| 联调测试 | 前后端联调 | 2h |

#### Phase 2: 交互优化 (1-2 天)

| 任务 | 工作内容 | 预估时间 |
|------|----------|----------|
| 键盘导航 | 完善键盘交互 | 2h |
| 高亮显示 | 关键词高亮 | 2h |
| 跳转逻辑 | 结果跳转处理 | 2h |
| 样式优化 | UI 细节调整 | 2h |

#### Phase 3: 增强功能 (1 天)

| 任务 | 工作内容 | 预估时间 |
|------|----------|----------|
| 搜索历史 | 历史记录功能 | 2h |
| 智能提示 | 搜索建议 | 2h |
| 空状态 | 无结果提示 | 1h |
| 错误处理 | 异常情况处理 | 1h |

#### Phase 4: 高级功能 (1-2 天)

| 任务 | 工作内容 | 预估时间 |
|------|----------|----------|
| 高级语法 | 搜索过滤语法 | 3h |
| 性能优化 | 缓存、防抖等 | 2h |
| 统计分析 | 搜索数据统计 | 2h |
| 文档编写 | 使用文档 | 1h |

### 13.2 里程碑

```
Week 1
├── Day 1-2: Phase 1 完成
│   └── 里程碑: 基础搜索可用
│
├── Day 3-4: Phase 2 完成
│   └── 里程碑: 交互体验达标
│
├── Day 5: Phase 3 完成
│   └── 里程碑: 功能完整
│
└── Day 6-7: Phase 4 完成
    └── 里程碑: 功能发布
```

### 13.3 发布检查清单

- [ ] 所有单元测试通过
- [ ] 集成测试通过
- [ ] E2E 测试通过
- [ ] 性能测试达标 (< 500ms)
- [ ] 浏览器兼容性测试
- [ ] 移动端适配测试
- [ ] 无障碍访问测试
- [ ] 安全审计通过
- [ ] 文档更新完成
- [ ] 代码审查通过

---

## 十四、风险评估与缓解

### 14.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 搜索性能差 | 中 | 高 | 添加索引、结果缓存、限制结果数 |
| 中文分词不准 | 中 | 中 | 使用 LIKE + 全文索引组合 |
| 并发压力大 | 低 | 高 | 请求限流、服务降级 |
| 数据量增长 | 高 | 中 | 分库分表、搜索引擎 |

### 14.2 业务风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 用户习惯改变 | 中 | 低 | 保留原有搜索入口 |
| 权限泄露 | 低 | 高 | API 层权限验证 |
| 搜索结果不准 | 中 | 中 | 持续优化搜索算法 |

### 14.3 运维风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 服务不可用 | 低 | 高 | 降级方案、监控告警 |
| 数据不一致 | 低 | 中 | 定期数据校验 |
| 缓存失效 | 中 | 低 | 缓存预热、多级缓存 |

---

## 十五、附录

### 15.1 相关文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| 搜索路由 | `routes/search.js` | 后端搜索 API |
| 命令面板 | `script.js` (L592-854) | 前端命令面板组件 |
| 论坛搜索 | `routes/forum.js` (L442-571) | 论坛帖子搜索 |
| 测试计划列表 | `routes/testplans.js` | 测试计划数据结构 |
| 测试用例 | `routes/testcases.js` | 测试用例数据结构 |
| 样式文件 | `styles/command-palette.css` | 命令面板样式 |

### 15.2 参考资料

- [MDN - Keyboard Events](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent)
- [MySQL Full-Text Search](https://dev.mysql.com/doc/refman/8.0/en/fulltext-search.html)
- [Command Pattern Design](https://refactoring.guru/design-patterns/command)

### 15.3 术语表

| 术语 | 说明 |
|------|------|
| CommandPalette | 命令面板，快捷操作入口 |
| Debounce | 防抖，延迟执行技术 |
| Full-Text Search | 全文搜索，文本索引技术 |
| LIKE | SQL 模糊匹配操作符 |

---

**文档结束**

> 本文档描述了全局搜索整合功能的完整设计方案，包括技术架构、API 设计、前端实现、测试方案等内容。如有疑问或建议，请联系开发团队。
