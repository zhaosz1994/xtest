# 邮件提醒功能扩展设计文档

> 文档版本：v2.0  
> 创建日期：2026-04-13  
> 作者：系统架构设计  
> 基于文档：《邮件通知系统设计方案 v1.0》

---

## 目录

1. [概述](#1-概述)
2. [需求分析](#2-需求分析)
3. [测试用例评审邮件提醒](#3-测试用例评审邮件提醒)
4. [测试计划邮件提醒](#4-测试计划邮件提醒)
5. [其他业务场景邮件提醒](#5-其他业务场景邮件提醒)
6. [数据库设计扩展](#6-数据库设计扩展)
7. [API接口设计扩展](#7-api接口设计扩展)
8. [前端界面设计扩展](#8-前端界面设计扩展)
9. [邮件模板设计](#9-邮件模板设计)
10. [实施计划](#10-实施计划)

---

## 1. 概述

### 1.1 背景

基于现有的《邮件通知系统设计方案 v1.0》，系统已经具备了完整的邮件通知基础设施，包括：
- 统一的邮件通知中转服务（EmailNotificationService）
- 邮件类型定义表（email_types）
- 用户通知偏好表（user_notification_prefs）
- 6大类邮件通知类型体系

但在实际业务场景中，还需要补充以下关键邮件提醒功能：
1. **测试用例评审流程**：评审提交、评审结果通知
2. **测试计划管理**：计划分配、状态变更、进度提醒
3. **其他业务场景**：缺陷管理、任务分配等

### 1.2 设计目标

| 目标 | 描述 |
|------|------|
| **完善评审流程** | 覆盖测试用例评审的全流程邮件提醒 |
| **增强计划管理** | 提供测试计划各阶段的邮件通知 |
| **用户可控** | 所有新增邮件类型支持用户独立开关 |
| **易于扩展** | 新增邮件类型遵循现有架构，无需重构 |

### 1.3 适用范围

本文档适用于 xTest 测试管理系统的邮件提醒功能扩展设计与开发，是对《邮件通知系统设计方案 v1.0》的补充和完善。

---

## 2. 需求分析

### 2.1 用户需求

#### 2.1.1 测试用例评审邮件提醒

**场景描述：**
1. 用户提交测试用例评审时，被指定的评审人需要接收到邮件提示
2. 评审人完成评审后（通过/驳回），用例的提交人和负责人需要接收到邮件提示
3. 用户可以在配置中心的消息提醒中开关接收此类提醒

**触发时机：**
- 提交评审：调用 `POST /api/testcases/:id/submit-review` 或 `POST /api/testcases/batch-submit-review`
- 完成评审：调用 `POST /api/testcases/:id/review` 或 `POST /api/testcases/batch-review`

**收件人：**
- 提交评审时：所有被指定的评审人
- 完成评审时：用例提交者（creator）和负责人（owner）

#### 2.1.2 测试计划邮件提醒

**场景描述：**
1. 测试计划创建后，被分配的负责人需要接收到邮件通知
2. 测试计划状态变更时（开始/暂停/完成/延期），相关人员需要接收到邮件提示
3. 测试计划即将到期时，负责人需要接收到提醒邮件
4. 测试计划进度异常时（通过率过低），管理员需要接收到预警邮件

**触发时机：**
- 创建计划：调用 `POST /api/testplans/create_with_rules`
- 更新计划：调用 `PUT /api/testplans/:id`
- 状态变更：计划状态字段变更
- 定时任务：每日检查计划进度和到期时间

**收件人：**
- 计划负责人（owner）
- 计划参与者（执行用例的人员）
- 管理员（预警场景）

#### 2.1.3 其他业务场景邮件提醒

**缺陷管理：**
- 缺陷创建时通知相关人员
- 缺陷状态变更时通知创建者
- 缺陷被分配时通知被分配人

**任务分配：**
- 新任务分配时通知被分配人
- 任务状态变更时通知相关人员
- 任务即将到期时发送提醒

### 2.2 现有系统分析

#### 2.2.1 现有邮件类型覆盖情况

根据《邮件通知系统设计方案 v1.0》，现有邮件类型定义如下：

| 类型代码 | 类型名称 | 分类 | 状态 |
|----------|----------|------|------|
| `case_review` | 用例审核结果 | business | 已定义，需细化 |
| `plan_assigned` | 测试计划分配 | business | 已定义，需实现 |
| `plan_status` | 计划状态变更 | business | 已定义，需实现 |

**需要新增的邮件类型：**
- `case_review_submit`：测试用例评审提交通知（评审人接收）
- `plan_deadline`：测试计划到期提醒
- `plan_progress_alert`：测试计划进度预警
- `defect_created`：缺陷创建通知
- `defect_status`：缺陷状态变更通知

#### 2.2.2 现有代码分析

**测试用例评审相关代码：**

文件：`routes/testcases.js`

- 提交评审：`POST /:id/submit-review`（第355-487行）
- 批量提交评审：`POST /batch-submit-review`（第849-1010行）
- 执行评审：`POST /:id/review`（第489-666行）
- 批量评审：`POST /batch-review`（第1012-1193行）

**关键数据结构：**
```javascript
// 评审记录表：review_records
{
  case_id: INT,
  reviewer_id: INT,
  submitter_id: INT,
  action: ENUM('submit', 'approve', 'reject'),
  comment: TEXT,
  created_at: TIMESTAMP
}

// 评审人表：case_reviewers
{
  case_id: INT,
  reviewer_id: INT,
  status: ENUM('pending', 'approved', 'rejected'),
  comment: TEXT,
  reviewed_at: TIMESTAMP,
  created_at: TIMESTAMP
}
```

**测试计划相关代码：**

文件：`routes/testplans.js`

- 创建计划：`POST /create_with_rules`（第137-221行）
- 更新计划：`PUT /:id`（第248-336行）
- 更新用例状态：`PUT /:planId/cases/:caseId`（第573-671行）

**关键数据结构：**
```javascript
// 测试计划表：test_plans
{
  id: INT,
  name: VARCHAR(100),
  owner: VARCHAR(50),
  status: VARCHAR(20),
  test_phase: VARCHAR(50),
  project: VARCHAR(100),
  iteration: VARCHAR(50),
  start_date: DATE,
  end_date: DATE,
  pass_rate: DECIMAL(5,2),
  tested_cases: INT,
  total_cases: INT
}
```

---

## 3. 测试用例评审邮件提醒

### 3.1 邮件类型定义

#### 3.1.1 评审提交通知（新增）

| 属性 | 值 |
|------|-----|
| **类型代码** | `case_review_submit` |
| **类型名称** | 测试用例评审提交通知 |
| **分类** | business（测试业务类） |
| **触发条件** | 用户提交测试用例进行评审 |
| **收件人** | 所有被指定的评审人 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】您有新的测试用例待评审 - {用例名称} |

**业务规则：**
1. 单个用例提交评审时，通知所有评审人
2. 批量提交评审时，每个评审人收到汇总通知
3. 邮件内容包含：用例名称、提交人、提交时间、评审链接
4. 支持用户在偏好设置中关闭此通知

#### 3.1.2 评审结果通知（已存在，需细化）

| 属性 | 值 |
|------|-----|
| **类型代码** | `case_review` |
| **类型名称** | 用例审核结果通知 |
| **分类** | business（测试业务类） |
| **触发条件** | 评审人完成评审（通过/驳回） |
| **收件人** | 用例提交者（creator）和负责人（owner） |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】用例审核结果 - {用例名称} |

**业务规则：**
1. 单人评审：评审完成立即发送通知
2. 多人评审：所有评审人完成后发送最终结果通知
3. 驳回时：邮件内容包含驳回原因和修改建议
4. 通过时：邮件内容包含评审意见（如有）
5. 支持用户在偏好设置中关闭此通知

### 3.2 触发流程设计

#### 3.2.1 提交评审流程

```
用户提交评审请求
     │
     ▼
┌─────────────────────────────────────┐
│ 1. 业务逻辑处理                      │
│    - 验证用例状态                    │
│    - 验证评审人有效性                │
│    - 更新用例状态为 pending          │
│    - 创建评审记录                    │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 2. 发送邮件通知                      │
│    - 调用 EmailNotificationService  │
│    - emailType: case_review_submit  │
│    - to: 所有评审人ID列表           │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 3. 创建站内通知                      │
│    - 写入 notifications 表          │
│    - type: case_review_submit       │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 4. WebSocket 实时推送                │
│    - 推送给在线评审人                │
└─────────────────────────────────────┘
```

#### 3.2.2 完成评审流程

```
评审人完成评审
     │
     ▼
┌─────────────────────────────────────┐
│ 1. 业务逻辑处理                      │
│    - 更新评审状态                    │
│    - 判断是否所有评审完成            │
│    - 更新用例最终状态                │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 2. 判断通知时机                      │
│    - 单人评审：立即通知              │
│    - 多人评审：全部完成后通知        │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 3. 发送邮件通知                      │
│    - 调用 EmailNotificationService  │
│    - emailType: case_review         │
│    - to: [creator_id, owner_id]     │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 4. 创建站内通知                      │
│    - 写入 notifications 表          │
│    - type: case_review              │
└─────────────────────────────────────┘
```

### 3.3 邮件内容设计

#### 3.3.1 评审提交通知邮件

**邮件主题：** 【xTest】您有新的测试用例待评审 - {用例名称}

**邮件内容模板：**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    .email-container { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-header { border-bottom: 2px solid #007bff; padding-bottom: 15px; margin-bottom: 20px; }
    .email-title { color: #333; font-size: 24px; margin: 0; }
    .highlight-box { background-color: #f5f5f5; padding: 15px; border-left: 4px solid #007bff; margin: 20px 0; }
    .email-button { display: inline-block; padding: 12px 30px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .email-footer { border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1 class="email-title">📋 测试用例评审通知</h1>
    </div>
    
    <div class="email-content">
      <p>尊敬的 <strong>{{reviewerName}}</strong>，您好！</p>
      
      <p><strong>{{submitterName}}</strong> 提交了一个测试用例，需要您进行评审。</p>
      
      <div class="highlight-box">
        <h3 style="margin: 0 0 10px 0; color: #333;">{{caseName}}</h3>
        <p style="margin: 5px 0;"><strong>用例编号：</strong>{{caseId}}</p>
        <p style="margin: 5px 0;"><strong>优先级：</strong>{{priority}}</p>
        <p style="margin: 5px 0;"><strong>所属模块：</strong>{{moduleName}}</p>
        <p style="margin: 5px 0;"><strong>提交时间：</strong>{{submittedAt}}</p>
        {{#if comment}}
        <p style="margin: 10px 0 0 0;"><strong>评审说明：</strong>{{comment}}</p>
        {{/if}}
      </div>
      
      <p>请尽快完成评审，如有疑问请联系提交人。</p>
      
      <div style="text-align: center;">
        <a href="{{reviewLink}}" class="email-button">立即评审</a>
      </div>
    </div>
    
    <div class="email-footer">
      <p>此邮件由 xTest 测试管理系统自动发送</p>
      <p>如不想接收此类邮件，请在<a href="{{preferenceLink}}">消息提醒设置</a>中关闭</p>
    </div>
  </div>
</body>
</html>
```

**批量提交评审邮件模板：**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    .email-container { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-header { border-bottom: 2px solid #007bff; padding-bottom: 15px; margin-bottom: 20px; }
    .email-title { color: #333; font-size: 24px; margin: 0; }
    .case-list { background-color: #f5f5f5; padding: 15px; margin: 20px 0; }
    .case-item { padding: 10px; border-bottom: 1px solid #ddd; }
    .case-item:last-child { border-bottom: none; }
    .email-button { display: inline-block; padding: 12px 30px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .email-footer { border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1 class="email-title">📋 批量测试用例评审通知</h1>
    </div>
    
    <div class="email-content">
      <p>尊敬的 <strong>{{reviewerName}}</strong>，您好！</p>
      
      <p><strong>{{submitterName}}</strong> 提交了 <strong>{{caseCount}}</strong> 个测试用例，需要您进行评审。</p>
      
      <div class="case-list">
        {{#each caseList}}
        <div class="case-item">
          <strong>{{this.caseName}}</strong>
          <span style="color: #666; margin-left: 10px;">{{this.caseId}}</span>
          <span style="color: #999; margin-left: 10px;">优先级：{{this.priority}}</span>
        </div>
        {{/each}}
      </div>
      
      <p>请尽快完成评审，如有疑问请联系提交人。</p>
      
      <div style="text-align: center;">
        <a href="{{reviewListLink}}" class="email-button">查看待评审列表</a>
      </div>
    </div>
    
    <div class="email-footer">
      <p>此邮件由 xTest 测试管理系统自动发送</p>
      <p>如不想接收此类邮件，请在<a href="{{preferenceLink}}">消息提醒设置</a>中关闭</p>
    </div>
  </div>
</body>
</html>
```

#### 3.3.2 评审结果通知邮件

**邮件主题：** 【xTest】用例审核结果 - {用例名称} - {结果}

**通过邮件模板：**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    .email-container { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-header { border-bottom: 2px solid #28a745; padding-bottom: 15px; margin-bottom: 20px; }
    .email-title { color: #28a745; font-size: 24px; margin: 0; }
    .success-box { background-color: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0; }
    .email-button { display: inline-block; padding: 12px 30px; background-color: #28a745; color: #ffffff; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .email-footer { border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1 class="email-title">✅ 测试用例评审通过</h1>
    </div>
    
    <div class="email-content">
      <p>尊敬的 <strong>{{userName}}</strong>，您好！</p>
      
      <p>您提交的测试用例已通过评审。</p>
      
      <div class="success-box">
        <h3 style="margin: 0 0 10px 0; color: #333;">{{caseName}}</h3>
        <p style="margin: 5px 0;"><strong>用例编号：</strong>{{caseId}}</p>
        <p style="margin: 5px 0;"><strong>评审人：</strong>{{reviewerName}}</p>
        <p style="margin: 5px 0;"><strong>评审时间：</strong>{{reviewedAt}}</p>
        {{#if comment}}
        <p style="margin: 10px 0 0 0;"><strong>评审意见：</strong>{{comment}}</p>
        {{/if}}
      </div>
      
      <p>用例已进入可用状态，可在测试计划中关联使用。</p>
      
      <div style="text-align: center;">
        <a href="{{caseLink}}" class="email-button">查看用例详情</a>
      </div>
    </div>
    
    <div class="email-footer">
      <p>此邮件由 xTest 测试管理系统自动发送</p>
      <p>如不想接收此类邮件，请在<a href="{{preferenceLink}}">消息提醒设置</a>中关闭</p>
    </div>
  </div>
</body>
</html>
```

**驳回邮件模板：**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    .email-container { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-header { border-bottom: 2px solid #dc3545; padding-bottom: 15px; margin-bottom: 20px; }
    .email-title { color: #dc3545; font-size: 24px; margin: 0; }
    .error-box { background-color: #f8d7da; padding: 15px; border-left: 4px solid #dc3545; margin: 20px 0; }
    .suggestion-box { background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
    .email-button { display: inline-block; padding: 12px 30px; background-color: #dc3545; color: #ffffff; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .email-footer { border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1 class="email-title">❌ 测试用例评审驳回</h1>
    </div>
    
    <div class="email-content">
      <p>尊敬的 <strong>{{userName}}</strong>，您好！</p>
      
      <p>您提交的测试用例未通过评审，请根据评审意见进行修改。</p>
      
      <div class="error-box">
        <h3 style="margin: 0 0 10px 0; color: #333;">{{caseName}}</h3>
        <p style="margin: 5px 0;"><strong>用例编号：</strong>{{caseId}}</p>
        <p style="margin: 5px 0;"><strong>评审人：</strong>{{reviewerName}}</p>
        <p style="margin: 5px 0;"><strong>评审时间：</strong>{{reviewedAt}}</p>
      </div>
      
      <div class="suggestion-box">
        <h4 style="margin: 0 0 10px 0; color: #856404;">驳回原因：</h4>
        <p style="margin: 0;">{{comment}}</p>
        {{#if suggestion}}
        <h4 style="margin: 15px 0 10px 0; color: #856404;">修改建议：</h4>
        <p style="margin: 0;">{{suggestion}}</p>
        {{/if}}
      </div>
      
      <p>修改完成后可重新提交评审。</p>
      
      <div style="text-align: center;">
        <a href="{{caseLink}}" class="email-button">修改用例</a>
      </div>
    </div>
    
    <div class="email-footer">
      <p>此邮件由 xTest 测试管理系统自动发送</p>
      <p>如不想接收此类邮件，请在<a href="{{preferenceLink}}">消息提醒设置</a>中关闭</p>
    </div>
  </div>
</body>
</html>
```

### 3.4 代码集成点

#### 3.4.1 提交评审集成

**文件：** `routes/testcases.js`

**位置：** 第355-487行 `POST /:id/submit-review`

**集成方式：**

```javascript
// 在现有代码的第453行（connection.commit() 之后）添加：

// 发送邮件通知评审人
const emailNotificationService = require('../services/emailNotificationService');

await emailNotificationService.send({
    emailType: 'case_review_submit',
    to: reviewerIdList,  // 所有评审人ID
    data: {
        caseName: caseData.name,
        caseId: caseData.case_id,
        priority: caseData.priority,
        moduleName: moduleName,
        submitterName: currentUser.username,
        submittedAt: new Date().toLocaleString('zh-CN'),
        comment: comment || '',
        reviewLink: `${process.env.APP_URL || 'http://localhost:3000'}/?action=review_case&id=${id}`,
        preferenceLink: `${process.env.APP_URL || 'http://localhost:3000'}/settings/notifications`
    }
});
```

#### 3.4.2 完成评审集成

**文件：** `routes/testcases.js`

**位置：** 第489-666行 `POST /:id/review`

**集成方式：**

```javascript
// 在现有代码的第623行（connection.commit() 之后）添加：

// 判断是否需要发送结果通知
if (newCaseStatus !== 'pending') {
    // 获取提交者和负责人信息
    const [creatorInfo] = await connection.execute(
        'SELECT id FROM users WHERE username = ?',
        [caseData.creator]
    );
    
    const recipientIds = [];
    if (creatorInfo.length > 0) {
        recipientIds.push(creatorInfo[0].id);
    }
    
    // 如果负责人与提交者不同，也通知负责人
    if (caseData.owner && caseData.owner !== caseData.creator) {
        const [ownerInfo] = await connection.execute(
            'SELECT id FROM users WHERE username = ?',
            [caseData.owner]
        );
        if (ownerInfo.length > 0 && !recipientIds.includes(ownerInfo[0].id)) {
            recipientIds.push(ownerInfo[0].id);
        }
    }
    
    // 发送邮件通知
    if (recipientIds.length > 0) {
        await emailNotificationService.send({
            emailType: 'case_review',
            to: recipientIds,
            data: {
                caseName: caseData.name,
                caseId: caseData.case_id,
                result: newCaseStatus === 'approved' ? '通过' : '驳回',
                reviewerName: currentUser.username,
                reviewedAt: new Date().toLocaleString('zh-CN'),
                comment: comment || '',
                suggestion: suggestion || '',
                caseLink: `${process.env.APP_URL || 'http://localhost:3000'}/?action=view_case&id=${id}`,
                preferenceLink: `${process.env.APP_URL || 'http://localhost:3000'}/settings/notifications`
            }
        });
    }
}
```

---

## 4. 测试计划邮件提醒

### 4.1 邮件类型定义

#### 4.1.1 计划分配通知（已定义）

| 属性 | 值 |
|------|-----|
| **类型代码** | `plan_assigned` |
| **类型名称** | 测试计划分配通知 |
| **分类** | business（测试业务类） |
| **触发条件** | 创建测试计划并指定负责人 |
| **收件人** | 计划负责人（owner） |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】您被分配了新的测试计划 - {计划名称} |

**业务规则：**
1. 创建计划时，如果指定了负责人，发送通知
2. 更新计划时，如果负责人变更，发送通知
3. 邮件内容包含：计划名称、项目、迭代、截止日期、用例数量

#### 4.1.2 计划状态变更通知（已定义）

| 属性 | 值 |
|------|-----|
| **类型代码** | `plan_status` |
| **类型名称** | 计划状态变更通知 |
| **分类** | business（测试业务类） |
| **触发条件** | 测试计划状态变更 |
| **收件人** | 计划负责人和参与者 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】测试计划状态变更 - {计划名称} |

**业务规则：**
1. 状态变更包括：未开始 → 进行中 → 已完成 / 已暂停 / 已延期
2. 通知计划负责人和所有参与执行的测试人员
3. 邮件内容包含：计划名称、原状态、新状态、变更时间

#### 4.1.3 计划到期提醒（新增）

| 属性 | 值 |
|------|-----|
| **类型代码** | `plan_deadline` |
| **类型名称** | 测试计划到期提醒 |
| **分类** | business（测试业务类） |
| **触发条件** | 测试计划即将到期（提前1天/3天） |
| **收件人** | 计划负责人 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】测试计划即将到期 - {计划名称} |

**业务规则：**
1. 定时任务每日检查计划到期时间
2. 提前3天发送第一次提醒
3. 提前1天发送第二次提醒
4. 仅提醒状态为"进行中"的计划
5. 邮件内容包含：计划名称、截止日期、剩余天数、当前进度

#### 4.1.4 计划进度预警（新增）

| 属性 | 值 |
|------|-----|
| **类型代码** | `plan_progress_alert` |
| **类型名称** | 测试计划进度预警 |
| **分类** | business（测试业务类） |
| **触发条件** | 测试计划通过率低于阈值或进度异常 |
| **收件人** | 计划负责人和管理员 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】测试计划进度预警 - {计划名称} |

**业务规则：**
1. 定时任务每日检查计划进度
2. 预警条件：
   - 通过率 < 70%
   - 距离截止日期不足3天，但进度 < 50%
   - 阻塞用例占比 > 20%
3. 邮件内容包含：计划名称、当前进度、通过率、预警原因

### 4.2 触发流程设计

#### 4.2.1 计划分配流程

```
创建/更新测试计划
     │
     ▼
┌─────────────────────────────────────┐
│ 1. 业务逻辑处理                      │
│    - 创建/更新计划记录               │
│    - 关联测试用例                    │
│    - 设置负责人                      │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 2. 判断是否需要通知                  │
│    - 新建计划：通知负责人            │
│    - 更新计划：负责人变更时通知      │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 3. 发送邮件通知                      │
│    - emailType: plan_assigned       │
│    - to: 负责人ID                   │
└─────────────────────────────────────┘
```

#### 4.2.2 计划状态变更流程

```
计划状态变更
     │
     ▼
┌─────────────────────────────────────┐
│ 1. 业务逻辑处理                      │
│    - 更新计划状态                    │
│    - 记录状态变更日志                │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 2. 获取通知对象                      │
│    - 计划负责人                      │
│    - 所有参与执行的测试人员          │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 3. 发送邮件通知                      │
│    - emailType: plan_status         │
│    - to: 所有相关人员ID列表         │
└─────────────────────────────────────┘
```

#### 4.2.3 定时任务流程

```
定时任务触发（每日凌晨）
     │
     ▼
┌─────────────────────────────────────┐
│ 1. 查询所有进行中的测试计划          │
└─────────────────────────────────────┘
     │
     ├──────────────────┬──────────────────┐
     ▼                  ▼                  ▼
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ 到期检查 │    │ 进度检查     │    │ 异常检查     │
└──────────┘    └──────────────┘    └──────────────┘
     │                  │                  │
     ▼                  ▼                  ▼
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ 发送到期 │    │ 发送进度     │    │ 发送异常     │
│ 提醒邮件 │    │ 预警邮件     │    │ 预警邮件     │
└──────────┘    └──────────────┘    └──────────────┘
```

### 4.3 邮件内容设计

#### 4.3.1 计划分配通知邮件

**邮件主题：** 【xTest】您被分配了新的测试计划 - {计划名称}

**邮件内容模板：**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    .email-container { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-header { border-bottom: 2px solid #007bff; padding-bottom: 15px; margin-bottom: 20px; }
    .email-title { color: #333; font-size: 24px; margin: 0; }
    .highlight-box { background-color: #f5f5f5; padding: 15px; border-left: 4px solid #007bff; margin: 20px 0; }
    .email-button { display: inline-block; padding: 12px 30px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .email-footer { border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1 class="email-title">📋 测试计划分配通知</h1>
    </div>
    
    <div class="email-content">
      <p>尊敬的 <strong>{{userName}}</strong>，您好！</p>
      
      <p>您被 <strong>{{assignerName}}</strong> 分配了新的测试计划。</p>
      
      <div class="highlight-box">
        <h3 style="margin: 0 0 10px 0; color: #333;">{{planName}}</h3>
        <p style="margin: 5px 0;"><strong>项目：</strong>{{projectName}}</p>
        <p style="margin: 5px 0;"><strong>迭代：</strong>{{iteration}}</p>
        <p style="margin: 5px 0;"><strong>测试阶段：</strong>{{testPhase}}</p>
        <p style="margin: 5px 0;"><strong>用例数量：</strong>{{caseCount}} 个</p>
        <p style="margin: 5px 0;"><strong>开始日期：</strong>{{startDate}}</p>
        <p style="margin: 5px 0;"><strong>截止日期：</strong>{{endDate}}</p>
        {{#if description}}
        <p style="margin: 10px 0 0 0;"><strong>计划描述：</strong>{{description}}</p>
        {{/if}}
      </div>
      
      <p>请在截止日期前完成测试任务，如有疑问请联系计划创建者。</p>
      
      <div style="text-align: center;">
        <a href="{{planLink}}" class="email-button">查看测试计划</a>
      </div>
    </div>
    
    <div class="email-footer">
      <p>此邮件由 xTest 测试管理系统自动发送</p>
      <p>如不想接收此类邮件，请在<a href="{{preferenceLink}}">消息提醒设置</a>中关闭</p>
    </div>
  </div>
</body>
</html>
```

#### 4.3.2 计划到期提醒邮件

**邮件主题：** 【xTest】测试计划即将到期 - {计划名称} - 剩余{剩余天数}天

**邮件内容模板：**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    .email-container { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .email-header { border-bottom: 2px solid #ffc107; padding-bottom: 15px; margin-bottom: 20px; }
    .email-title { color: #ffc107; font-size: 24px; margin: 0; }
    .warning-box { background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
    .progress-bar { background-color: #e9ecef; height: 20px; border-radius: 10px; margin: 10px 0; }
    .progress-fill { background-color: #28a745; height: 100%; border-radius: 10px; }
    .email-button { display: inline-block; padding: 12px 30px; background-color: #ffc107; color: #000; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .email-footer { border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1 class="email-title">⏰ 测试计划即将到期提醒</h1>
    </div>
    
    <div class="email-content">
      <p>尊敬的 <strong>{{userName}}</strong>，您好！</p>
      
      <p>您的测试计划即将到期，请关注进度。</p>
      
      <div class="warning-box">
        <h3 style="margin: 0 0 10px 0; color: #856404;">{{planName}}</h3>
        <p style="margin: 5px 0;"><strong>截止日期：</strong>{{endDate}}</p>
        <p style="margin: 5px 0;"><strong>剩余天数：</strong><span style="color: #dc3545; font-weight: bold;">{{remainingDays}} 天</span></p>
        <p style="margin: 5px 0;"><strong>当前进度：</strong>{{testedCases}} / {{totalCases}}</p>
        
        <div class="progress-bar">
          <div class="progress-fill" style="width: {{progressPercent}}%;"></div>
        </div>
        
        <p style="margin: 5px 0;"><strong>通过率：</strong>{{passRate}}%</p>
      </div>
      
      <p>请合理安排时间，确保按时完成测试任务。</p>
      
      <div style="text-align: center;">
        <a href="{{planLink}}" class="email-button">查看测试计划</a>
      </div>
    </div>
    
    <div class="email-footer">
      <p>此邮件由 xTest 测试管理系统自动发送</p>
      <p>如不想接收此类邮件，请在<a href="{{preferenceLink}}">消息提醒设置</a>中关闭</p>
    </div>
  </div>
</body>
</html>
```

### 4.4 代码集成点

#### 4.4.1 计划分配集成

**文件：** `routes/testplans.js`

**位置：** 第137-221行 `POST /create_with_rules`

**集成方式：**

```javascript
// 在现有代码的第204行（connection.commit() 之后）添加：

// 发送邮件通知负责人
if (owner) {
    const [ownerInfo] = await pool.execute(
        'SELECT id FROM users WHERE username = ?',
        [owner]
    );
    
    if (ownerInfo.length > 0) {
        await emailNotificationService.send({
            emailType: 'plan_assigned',
            to: ownerInfo[0].id,
            data: {
                planName: name,
                projectName: project,
                iteration: iteration,
                testPhase: testPhase,
                caseCount: selectedCases ? selectedCases.length : 0,
                startDate: start_date,
                endDate: end_date,
                description: description,
                assignerName: currentUser.username,
                planLink: `${process.env.APP_URL || 'http://localhost:3000'}/?action=view_plan&id=${planId}`,
                preferenceLink: `${process.env.APP_URL || 'http://localhost:3000'}/settings/notifications`
            }
        });
    }
}
```

#### 4.4.2 定时任务实现

**新建文件：** `scripts/checkPlanDeadlines.js`

```javascript
/**
 * 测试计划到期和进度检查定时任务
 * 建议每天凌晨执行一次
 */

const pool = require('../db');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../services/logger');

async function checkPlanDeadlines() {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 1. 检查即将到期的计划（提前3天和1天）
        const [upcomingPlans] = await pool.execute(`
            SELECT tp.id, tp.name, tp.owner, tp.end_date, tp.tested_cases, tp.total_cases, tp.pass_rate,
                   DATEDIFF(tp.end_date, CURDATE()) as remaining_days,
                   u.id as owner_id, u.email
            FROM test_plans tp
            LEFT JOIN users u ON tp.owner = u.username
            WHERE tp.status = '进行中'
              AND tp.end_date IS NOT NULL
              AND DATEDIFF(tp.end_date, CURDATE()) IN (1, 3)
        `);
        
        for (const plan of upcomingPlans) {
            if (plan.owner_id) {
                const progressPercent = plan.total_cases > 0 
                    ? Math.round((plan.tested_cases / plan.total_cases) * 100) 
                    : 0;
                
                await emailNotificationService.send({
                    emailType: 'plan_deadline',
                    to: plan.owner_id,
                    data: {
                        planName: plan.name,
                        endDate: plan.end_date,
                        remainingDays: plan.remaining_days,
                        testedCases: plan.tested_cases,
                        totalCases: plan.total_cases,
                        progressPercent: progressPercent,
                        passRate: plan.pass_rate || 0,
                        planLink: `${process.env.APP_URL || 'http://localhost:3000'}/?action=view_plan&id=${plan.id}`,
                        preferenceLink: `${process.env.APP_URL || 'http://localhost:3000'}/settings/notifications`
                    }
                });
            }
        }
        
        // 2. 检查进度异常的计划
        const [alertPlans] = await pool.execute(`
            SELECT tp.id, tp.name, tp.owner, tp.pass_rate, tp.tested_cases, tp.total_cases,
                   DATEDIFF(tp.end_date, CURDATE()) as remaining_days,
                   u.id as owner_id,
                   (SELECT COUNT(*) FROM test_plan_cases WHERE plan_id = tp.id AND status = 'blocked') as blocked_count
            FROM test_plans tp
            LEFT JOIN users u ON tp.owner = u.username
            WHERE tp.status = '进行中'
              AND (
                  tp.pass_rate < 70
                  OR (DATEDIFF(tp.end_date, CURDATE()) <= 3 AND (tp.tested_cases / NULLIF(tp.total_cases, 0)) < 0.5)
                  OR ((SELECT COUNT(*) FROM test_plan_cases WHERE plan_id = tp.id AND status = 'blocked') / NULLIF(tp.total_cases, 0)) > 0.2
              )
        `);
        
        for (const plan of alertPlans) {
            if (plan.owner_id) {
                // 确定预警原因
                let alertReason = '';
                if (plan.pass_rate < 70) {
                    alertReason = `通过率过低（${plan.pass_rate}%），低于70%阈值`;
                } else if (plan.remaining_days <= 3 && (plan.tested_cases / plan.total_cases) < 0.5) {
                    alertReason = `距离截止日期仅剩${plan.remaining_days}天，但进度不足50%`;
                } else if ((plan.blocked_count / plan.total_cases) > 0.2) {
                    alertReason = `阻塞用例占比过高（${Math.round((plan.blocked_count / plan.total_cases) * 100)}%），超过20%阈值`;
                }
                
                await emailNotificationService.send({
                    emailType: 'plan_progress_alert',
                    to: plan.owner_id,
                    data: {
                        planName: plan.name,
                        passRate: plan.pass_rate,
                        testedCases: plan.tested_cases,
                        totalCases: plan.total_cases,
                        alertReason: alertReason,
                        planLink: `${process.env.APP_URL || 'http://localhost:3000'}/?action=view_plan&id=${plan.id}`,
                        preferenceLink: `${process.env.APP_URL || 'http://localhost:3000'}/settings/notifications`
                    }
                });
            }
        }
        
        logger.info('计划到期和进度检查完成', { 
            upcomingCount: upcomingPlans.length,
            alertCount: alertPlans.length
        });
        
    } catch (error) {
        logger.error('计划检查任务失败:', { error: error.message });
    }
}

// 执行任务
checkPlanDeadlines().then(() => {
    console.log('计划检查任务执行完成');
    process.exit(0);
}).catch(error => {
    console.error('计划检查任务失败:', error);
    process.exit(1);
});
```

---

## 5. 其他业务场景邮件提醒

### 5.1 缺陷管理邮件提醒

#### 5.1.1 缺陷创建通知

| 属性 | 值 |
|------|-----|
| **类型代码** | `defect_created` |
| **类型名称** | 缺陷创建通知 |
| **分类** | business（测试业务类） |
| **触发条件** | 在测试执行中记录缺陷 |
| **收件人** | 项目管理员和测试负责人 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】新缺陷记录 - {缺陷标题} |

#### 5.1.2 缺陷状态变更通知

| 属性 | 值 |
|------|-----|
| **类型代码** | `defect_status` |
| **类型名称** | 缺陷状态变更通知 |
| **分类** | business（测试业务类） |
| **触发条件** | 缺陷状态变更（新建/已分配/已修复/已验证/已关闭） |
| **收件人** | 缺陷创建者和相关人员 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】缺陷状态更新 - {缺陷标题} |

### 5.2 任务分配邮件提醒

#### 5.2.1 任务分配通知

| 属性 | 值 |
|------|-----|
| **类型代码** | `task_assigned` |
| **类型名称** | 任务分配通知 |
| **分类** | business（测试业务类） |
| **触发条件** | 管理员分配任务给用户 |
| **收件人** | 被分配的用户 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】您有新的任务 - {任务标题} |

#### 5.2.2 任务到期提醒

| 属性 | 值 |
|------|-----|
| **类型代码** | `task_deadline` |
| **类型名称** | 任务到期提醒 |
| **分类** | business（测试业务类） |
| **触发条件** | 任务即将到期 |
| **收件人** | 任务负责人 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】任务即将到期 - {任务标题} |

### 5.3 报告生成邮件提醒

#### 5.3.1 报告生成完成通知（已定义）

| 属性 | 值 |
|------|-----|
| **类型代码** | `report_ready` |
| **类型名称** | 报告生成完成通知 |
| **分类** | business（测试业务类） |
| **触发条件** | 测试报告生成完毕 |
| **收件人** | 报告创建者 |
| **默认开启** | ✅ 是 |
| **支持站内通知** | ✅ 是 |
| **邮件主题模板** | 【xTest】测试报告已生成 - {报告名称} |

**集成点：** `services/reportService.js`

---

## 6. 数据库设计扩展

### 6.1 新增邮件类型数据

在现有 `email_types` 表中新增以下记录：

```sql
-- 测试用例评审相关
INSERT INTO email_types (type_code, type_name, category, description, is_required, default_email_enabled, default_in_app_enabled, template_subject, template_path, sort_order) VALUES
('case_review_submit', '测试用例评审提交通知', 'business', '测试用例提交评审时通知评审人', FALSE, TRUE, TRUE, '【xTest】您有新的测试用例待评审 - {caseName}', 'case_review_submit', 204);

-- 测试计划相关
INSERT INTO email_types (type_code, type_name, category, description, is_required, default_email_enabled, default_in_app_enabled, template_subject, template_path, sort_order) VALUES
('plan_deadline', '测试计划到期提醒', 'business', '测试计划即将到期时提醒负责人', FALSE, TRUE, TRUE, '【xTest】测试计划即将到期 - {planName}', 'plan_deadline', 206),
('plan_progress_alert', '测试计划进度预警', 'business', '测试计划进度异常时预警', FALSE, TRUE, TRUE, '【xTest】测试计划进度预警 - {planName}', 'plan_progress_alert', 207);

-- 缺陷管理相关
INSERT INTO email_types (type_code, type_name, category, description, is_required, default_email_enabled, default_in_app_enabled, template_subject, template_path, sort_order) VALUES
('defect_created', '缺陷创建通知', 'business', '新缺陷创建时通知相关人员', FALSE, TRUE, TRUE, '【xTest】新缺陷记录 - {defectTitle}', 'defect_created', 208),
('defect_status', '缺陷状态变更通知', 'business', '缺陷状态变更时通知相关人员', FALSE, TRUE, TRUE, '【xTest】缺陷状态更新 - {defectTitle}', 'defect_status', 210);

-- 任务管理相关
INSERT INTO email_types (type_code, type_name, category, description, is_required, default_email_enabled, default_in_app_enabled, template_subject, template_path, sort_order) VALUES
('task_assigned', '任务分配通知', 'business', '新任务分配时通知被分配人', FALSE, TRUE, TRUE, '【xTest】您有新的任务 - {taskTitle}', 'task_assigned', 211),
('task_deadline', '任务到期提醒', 'business', '任务即将到期时提醒负责人', FALSE, TRUE, TRUE, '【xTest】任务即将到期 - {taskTitle}', 'task_deadline', 212);
```

### 6.2 用户偏好初始化

为所有现有用户初始化新增邮件类型的偏好设置：

```sql
-- 为所有用户初始化新增邮件类型的默认偏好
INSERT INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT u.id, et.type_code, et.default_email_enabled, et.default_in_app_enabled
FROM users u
CROSS JOIN email_types et
WHERE et.type_code IN ('case_review_submit', 'plan_deadline', 'plan_progress_alert', 'defect_created', 'defect_status', 'task_assigned', 'task_deadline')
  AND NOT EXISTS (
      SELECT 1 FROM user_notification_prefs unp 
      WHERE unp.user_id = u.id AND unp.type_code = et.type_code
  );
```

### 6.3 定时任务记录表（可选）

为了跟踪定时任务的执行情况，可以新增一个任务执行记录表：

```sql
CREATE TABLE scheduled_task_logs (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    task_name VARCHAR(100) NOT NULL COMMENT '任务名称',
    task_type VARCHAR(50) NOT NULL COMMENT '任务类型: deadline_check, progress_alert',
    execution_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '执行时间',
    status ENUM('success', 'failed') NOT NULL COMMENT '执行状态',
    processed_count INT DEFAULT 0 COMMENT '处理记录数',
    error_message TEXT COMMENT '错误信息',
    details JSON COMMENT '执行详情',
    
    INDEX idx_task_name (task_name),
    INDEX idx_execution_time (execution_time),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='定时任务执行日志表';
```

---

## 7. API接口设计扩展

### 7.1 用户通知偏好 API（已存在）

参考《邮件通知系统设计方案 v1.0》第7章，用户可以通过以下API管理通知偏好：

- `GET /api/notification-preferences` - 获取用户通知偏好
- `PUT /api/notification-preferences/:typeCode` - 更新单个类型偏好
- `PUT /api/notification-preferences/batch` - 批量更新偏好
- `POST /api/notification-preferences/reset` - 重置为默认偏好

### 7.2 测试用例评审 API（已存在）

现有API无需修改，只需在业务逻辑中集成邮件通知：

- `POST /api/testcases/:id/submit-review` - 提交评审（集成邮件通知）
- `POST /api/testcases/batch-submit-review` - 批量提交评审（集成邮件通知）
- `POST /api/testcases/:id/review` - 执行评审（集成邮件通知）
- `POST /api/testcases/batch-review` - 批量评审（集成邮件通知）

### 7.3 测试计划 API（已存在）

现有API无需修改，只需在业务逻辑中集成邮件通知：

- `POST /api/testplans/create_with_rules` - 创建计划（集成邮件通知）
- `PUT /api/testplans/:id` - 更新计划（集成邮件通知）

### 7.4 定时任务管理 API（新增）

#### 7.4.1 手动触发计划检查

```
POST /api/admin/trigger-plan-check

请求头：
Authorization: Bearer <token> (需要管理员权限)

请求体：
{
  "checkType": "deadline"  // deadline | progress | all
}

响应：
{
  "success": true,
  "message": "计划检查任务已触发",
  "result": {
    "upcomingPlans": 5,
    "alertPlans": 2,
    "notificationsSent": 7
  }
}
```

#### 7.4.2 获取任务执行日志

```
GET /api/admin/task-logs

请求头：
Authorization: Bearer <token> (需要管理员权限)

查询参数：
- taskName: 任务名称（可选）
- status: 执行状态（可选）
- startDate: 开始日期（可选）
- endDate: 结束日期（可选）
- page: 页码
- pageSize: 每页数量

响应：
{
  "success": true,
  "logs": [
    {
      "id": 1,
      "taskName": "plan_deadline_check",
      "taskType": "deadline_check",
      "executionTime": "2026-04-13 00:00:00",
      "status": "success",
      "processedCount": 10,
      "details": {
        "upcomingPlans": 5,
        "notificationsSent": 5
      }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

## 8. 前端界面设计扩展

### 8.1 配置中心 - 消息提醒页面扩展

在现有《邮件通知系统设计方案 v1.0》第8章的基础上，扩展"测试业务"分类：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📋 测试业务                                          [邮件] [站内]         │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  📝 测试计划分配                         [🔘 开]       [🔘 开]              │
│     你被分配了新的测试计划                                                   │
│                                                                              │
│  📊 计划状态变更                         [🔘 开]       [🔘 开]              │
│     测试计划状态发生变更（开始/完成/延期）                                    │
│                                                                              │
│  ⏰ 计划到期提醒                         [🔘 开]       [🔘 开]              │
│     测试计划即将到期时提醒                                                   │
│                                                                              │
│  ⚠️ 计划进度预警                         [🔘 开]       [🔘 开]              │
│     测试计划进度异常时预警                                                   │
│                                                                              │
│  ✅ 用例评审提交通知                     [🔘 开]       [🔘 开]              │
│     有测试用例提交评审时通知评审人                                           │
│                                                                              │
│  ✅ 用例审核结果                         [🔘 开]       [🔘 开]              │
│     你提交的用例审核结果通知                                                 │
│                                                                              │
│  🐛 缺陷创建通知                         [🔘 开]       [🔘 开]              │
│     新缺陷创建时通知相关人员                                                 │
│                                                                              │
│  🐛 缺陷分配通知                         [🔘 开]       [🔘 开]              │
│     缺陷被分配时通知被分配人                                                 │
│                                                                              │
│  🐛 缺陷状态变更通知                     [🔘 开]       [🔘 开]              │
│     缺陷状态变更时通知相关人员                                               │
│                                                                              │
│  📄 报告生成完成                         [🔘 开]       [🔘 开]              │
│     测试报告生成完成通知                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 管理员界面扩展

#### 8.2.1 定时任务管理

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  定时任务管理                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 任务名称                │ 执行频率   │ 最后执行时间   │ 状态   │ 操作 │   │
│  ├─────────────────────────┼────────────┼────────────────┼────────┼──────┤   │
│  │ 计划到期检查            │ 每日 00:00 │ 2026-04-13     │ 正常   │ [执行]│   │
│  │ 计划进度预警            │ 每日 00:00 │ 2026-04-13     │ 正常   │ [执行]│   │
│  │ 邮件发送统计            │ 每日 01:00 │ 2026-04-13     │ 正常   │ [执行]│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 执行日志                                                              │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ [2026-04-13 00:00:00] 计划到期检查完成，发送通知 5 封                 │   │
│  │ [2026-04-13 00:00:05] 计划进度预警完成，发送通知 2 封                 │   │
│  │ [2026-04-12 00:00:00] 计划到期检查完成，发送通知 3 封                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. 邮件模板设计

### 9.1 模板目录结构扩展

```
/emailTemplates
├── /business
│   ├── plan_assigned.html          # 测试计划分配（已存在）
│   ├── plan_status.html            # 计划状态变更（已存在）
│   ├── plan_deadline.html          # 计划到期提醒（新增）
│   ├── plan_progress_alert.html    # 计划进度预警（新增）
│   ├── case_review_submit.html     # 用例评审提交（新增）
│   ├── case_review.html            # 用例审核结果（已存在）
│   ├── report_ready.html           # 报告生成完成（已存在）
│   ├── defect_created.html         # 缺陷创建通知（新增）
│   ├── defect_status.html          # 缺陷状态变更（新增）
│   ├── task_assigned.html          # 任务分配通知（新增）
│   └── task_deadline.html          # 任务到期提醒（新增）
└── /partials
    ├── header.html
    ├── footer.html
    └── button.html
```

### 9.2 模板变量规范扩展

| 变量名 | 说明 | 适用模板 |
|--------|------|----------|
| `{{caseName}}` | 用例名称 | case_review_submit, case_review |
| `{{caseId}}` | 用例编号 | case_review_submit, case_review |
| `{{reviewerName}}` | 评审人姓名 | case_review_submit, case_review |
| `{{submitterName}}` | 提交人姓名 | case_review_submit |
| `{{planName}}` | 计划名称 | plan_assigned, plan_deadline, plan_progress_alert |
| `{{remainingDays}}` | 剩余天数 | plan_deadline |
| `{{progressPercent}}` | 进度百分比 | plan_deadline, plan_progress_alert |
| `{{alertReason}}` | 预警原因 | plan_progress_alert |
| `{{defectTitle}}` | 缺陷标题 | defect_created, defect_status |
| `{{taskTitle}}` | 任务标题 | task_assigned, task_deadline |

---

## 10. 实施计划

### 10.1 分阶段实施

#### 第一阶段：测试用例评审邮件提醒（预计 2 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 数据库更新 | 新增邮件类型记录 | 0.5 天 |
| 创建邮件模板 | case_review_submit.html | 0.5 天 |
| 集成提交评审通知 | 修改 testcases.js | 0.5 天 |
| 集成评审结果通知 | 修改 testcases.js | 0.5 天 |

#### 第二阶段：测试计划邮件提醒（预计 3 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 数据库更新 | 新增邮件类型记录 | 0.5 天 |
| 创建邮件模板 | plan_deadline.html, plan_progress_alert.html | 0.5 天 |
| 集成计划分配通知 | 修改 testplans.js | 0.5 天 |
| 开发定时任务 | checkPlanDeadlines.js | 1 天 |
| 配置定时任务 | 设置 cron job | 0.5 天 |

#### 第三阶段：其他业务场景（预计 2 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 数据库更新 | 新增缺陷、任务邮件类型 | 0.5 天 |
| 创建邮件模板 | 缺陷、任务相关模板 | 0.5 天 |
| 集成缺陷通知 | 修改相关业务代码 | 0.5 天 |
| 集成任务通知 | 修改相关业务代码 | 0.5 天 |

#### 第四阶段：前端界面扩展（预计 2 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 扩展配置中心页面 | 新增邮件类型开关 | 1 天 |
| 开发管理员界面 | 定时任务管理页面 | 1 天 |

#### 第五阶段：测试与上线（预计 2 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 单元测试 | 核心服务单元测试 | 0.5 天 |
| 集成测试 | 端到端功能测试 | 0.5 天 |
| 性能测试 | 批量发送性能测试 | 0.5 天 |
| 上线部署 | 生产环境部署 | 0.5 天 |

### 10.2 总体时间估算

| 阶段 | 预计时间 |
|------|----------|
| 第一阶段 | 2 天 |
| 第二阶段 | 3 天 |
| 第三阶段 | 2 天 |
| 第四阶段 | 2 天 |
| 第五阶段 | 2 天 |
| **合计** | **11 天** |

### 10.3 依赖关系

```
第一阶段（测试用例评审）
     │
     ├──────────────────┐
     ▼                  ▼
第二阶段（测试计划）  第三阶段（其他业务）
     │                  │
     └────────┬─────────┘
              ▼
     第四阶段（前端界面）
              │
              ▼
     第五阶段（测试上线）
```

---

## 附录

### A. 邮件类型汇总表

| 类型代码 | 类型名称 | 分类 | 触发条件 | 收件人 | 默认开启 |
|----------|----------|------|----------|--------|----------|
| `case_review_submit` | 测试用例评审提交通知 | business | 提交评审 | 评审人 | ✅ |
| `case_review` | 用例审核结果通知 | business | 评审完成 | 提交者、负责人 | ✅ |
| `plan_assigned` | 测试计划分配通知 | business | 创建/更新计划 | 负责人 | ✅ |
| `plan_status` | 计划状态变更通知 | business | 状态变更 | 负责人、参与者 | ✅ |
| `plan_deadline` | 测试计划到期提醒 | business | 即将到期 | 负责人 | ✅ |
| `plan_progress_alert` | 测试计划进度预警 | business | 进度异常 | 负责人、管理员 | ✅ |
| `defect_created` | 缺陷创建通知 | business | 创建缺陷 | 管理员、负责人 | ✅ |
| `defect_status` | 缺陷状态变更通知 | business | 状态变更 | 创建者、相关人员 | ✅ |
| `task_assigned` | 任务分配通知 | business | 分配任务 | 被分配人 | ✅ |
| `task_deadline` | 任务到期提醒 | business | 即将到期 | 负责人 | ✅ |
| `report_ready` | 报告生成完成通知 | business | 报告生成 | 创建者 | ✅ |

### B. 定时任务配置示例

**使用 cron 配置定时任务：**

```bash
# 编辑 crontab
crontab -e

# 添加以下任务
# 每天凌晨 00:00 执行计划到期检查
0 0 * * * cd /path/to/xtest && node scripts/checkPlanDeadlines.js >> logs/plan_check.log 2>&1

# 每天凌晨 01:00 执行邮件发送统计
0 1 * * * cd /path/to/xtest && node scripts/emailStats.js >> logs/email_stats.log 2>&1
```

### C. 测试用例

#### C.1 测试用例评审邮件测试

| 测试场景 | 测试步骤 | 预期结果 |
|----------|----------|----------|
| 单个用例提交评审 | 1. 创建测试用例<br>2. 提交评审，指定评审人 | 评审人收到邮件和站内通知 |
| 批量提交评审 | 1. 选择多个用例<br>2. 批量提交评审 | 评审人收到汇总邮件 |
| 评审通过 | 1. 评审人登录<br>2. 通过评审 | 提交者和负责人收到通过邮件 |
| 评审驳回 | 1. 评审人登录<br>2. 驳回评审，填写原因 | 提交者和负责人收到驳回邮件，包含驳回原因 |
| 多人评审 | 1. 提交评审，指定多个评审人<br>2. 部分评审人完成评审 | 部分完成时不发送结果通知<br>全部完成后发送最终结果通知 |

#### C.2 测试计划邮件测试

| 测试场景 | 测试步骤 | 预期结果 |
|----------|----------|----------|
| 创建计划分配 | 1. 创建测试计划<br>2. 指定负责人 | 负责人收到计划分配邮件 |
| 更新计划负责人 | 1. 更新计划<br>2. 变更负责人 | 新负责人收到计划分配邮件 |
| 计划到期提醒 | 1. 创建即将到期的计划<br>2. 执行定时任务 | 负责人收到到期提醒邮件 |
| 计划进度预警 | 1. 创建低通过率计划<br>2. 执行定时任务 | 负责人收到进度预警邮件 |

---

## 文档修订记录

| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| v2.0 | 2026-04-13 | 系统 | 基于 v1.0 扩展测试用例评审、测试计划等业务场景邮件提醒 |

---

*本文档由 xTest 测试管理系统架构设计团队编写*
