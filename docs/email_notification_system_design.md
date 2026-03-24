# 邮件通知系统设计方案

> 文档版本：v1.0  
> 创建日期：2026-03-23  
> 作者：系统架构设计

---

## 目录

1. [概述](#1-概述)
2. [现状分析](#2-现状分析)
3. [系统架构设计](#3-系统架构设计)
4. [邮件通知类型规划](#4-邮件通知类型规划)
5. [统一中转控制设计](#5-统一中转控制设计)
6. [数据库设计](#6-数据库设计)
7. [API接口设计](#7-api接口设计)
8. [用户界面设计](#8-用户界面设计)
9. [邮件模板设计](#9-邮件模板设计)
10. [与现有系统集成](#10-与现有系统集成)
11. [实施计划](#11-实施计划)
12. [附录](#附录)

---

## 1. 概述

### 1.1 背景

xTest 测试管理系统目前已具备基础的邮件发送能力，支持验证码、密码重置、社区互动通知等功能。但随着系统功能的丰富和用户量的增长，现有的邮件通知机制存在以下问题：

1. **通知类型覆盖不全**：缺少测试计划分配、用例审核、任务分配等核心业务场景的邮件通知
2. **用户配置粒度粗**：用户仅能控制三种社交类通知开关，无法精细控制各类业务通知
3. **缺少统一调度层**：邮件发送逻辑散落在各处，没有统一的"发送前偏好检查"机制
4. **配置中心页面功能单薄**：消息提醒标签页仅展示少量选项，无法满足精细化配置需求

### 1.2 设计目标

本方案旨在设计一套完整的邮件通知系统，实现以下目标：

| 目标 | 描述 |
|------|------|
| **统一调度** | 所有邮件发送经过统一的中转服务，确保偏好检查的一致性 |
| **精细控制** | 用户可对每种邮件类型独立配置"邮件"和"站内通知"两个开关 |
| **分类清晰** | 将邮件分为6大类，覆盖账户安全、社区互动、测试业务、审批流程、系统公告、定期汇总等场景 |
| **安全例外** | 账户安全类邮件（验证码、密码重置）强制发送，保障系统安全 |
| **批量友好** | 支持批量发送，自动处理每个收件人的偏好差异 |
| **易于扩展** | 新增邮件类型只需数据库配置，无需修改代码 |

### 1.3 适用范围

本文档适用于 xTest 测试管理系统的邮件通知功能设计与开发，涵盖：

- 后端服务架构设计
- 数据库表结构设计
- API 接口规范
- 前端界面交互设计
- 邮件模板规范

---

## 2. 现状分析

### 2.1 现有邮件发送能力

系统目前已实现的邮件发送功能：

| 功能 | 邮件类型代码 | 触发场景 | 实现位置 |
|------|-------------|----------|----------|
| 邮箱验证码 | `verification` | 用户绑定/修改邮箱 | `emailService.sendVerificationCode()` |
| 密码重置 | `password_reset` | 用户申请重置密码 | `emailService.sendPasswordReset()` |
| 测试报告通知 | `report` | 测试报告生成完成 | `emailService.sendReportNotification()` |
| @提及提醒 | `mention` | 论坛帖子中@某用户 | `notificationService.processMentions()` |
| 评论提醒 | `comment` | 有人评论帖子 | `notificationService.notifyInteraction()` |
| 点赞提醒 | `like` | 有人点赞帖子 | `notificationService.notifyInteraction()` |

### 2.2 现有用户偏好配置

用户表 `users` 中已有的邮件偏好字段：

```sql
email_notify_mentions BOOLEAN DEFAULT TRUE COMMENT '接收@提醒邮件'
email_notify_comments BOOLEAN DEFAULT TRUE COMMENT '接收评论提醒邮件'
email_notify_likes BOOLEAN DEFAULT FALSE COMMENT '接收被赞提醒邮件'
```

### 2.3 现有邮件配置表

系统已有 `email_config` 表用于管理 SMTP 配置：

```sql
CREATE TABLE email_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  config_name VARCHAR(100) NOT NULL,
  email_type ENUM('smtp', 'self_hosted') NOT NULL DEFAULT 'smtp',
  smtp_host VARCHAR(255),
  smtp_port INT DEFAULT 587,
  smtp_secure BOOLEAN DEFAULT FALSE,
  smtp_user VARCHAR(255),
  smtp_password VARCHAR(255),
  sender_email VARCHAR(255),
  sender_name VARCHAR(100),
  self_hosted_api_url VARCHAR(255),
  self_hosted_api_key VARCHAR(255),
  is_default BOOLEAN DEFAULT FALSE,
  is_enabled BOOLEAN DEFAULT TRUE,
  daily_limit INT DEFAULT 500,
  sent_today INT DEFAULT 0,
  last_sent_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 2.4 现有问题总结

| 问题类型 | 具体描述 | 影响 |
|----------|----------|------|
| 类型不全 | 缺少测试计划、用例审核、任务分配等业务场景 | 用户无法及时获知重要业务变更 |
| 粒度粗糙 | 仅3个开关，无法区分业务类型 | 用户要么全收要么全关，体验差 |
| 逻辑分散 | 邮件发送逻辑散落在多个服务中 | 维护困难，偏好检查不一致 |
| 扩展困难 | 新增类型需修改代码和数据库 | 开发成本高，上线周期长 |
| 缺少统计 | 无法了解各类型邮件发送情况 | 无法优化通知策略 |

---

## 3. 系统架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              业务层 (Business Layer)                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │ 用户管理 │  │ 测试计划│  │ 用例管理 │  │ 论坛社区 │  │ 系统管理 │           │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
└───────┼────────────┼────────────┼────────────┼────────────┼─────────────────┘
        │            │            │            │            │
        └────────────┴────────────┴─────┬──────┴────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        通知中转层 (Notification Gateway)                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    EmailNotificationService                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ 类型验证    │  │ 偏好检查    │  │ 模板渲染    │  │ 日志记录    │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐        ┌───────────────────┐        ┌───────────────────┐
│ EmailService  │        │ NotificationService│        │  EmailTypeConfig  │
│ (底层发送)    │        │ (站内通知)         │        │  (类型配置)       │
└───────────────┘        └───────────────────┘        └───────────────────┘
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐        ┌───────────────────┐        ┌───────────────────┐
│ SMTP/自建API  │        │ notifications表   │        │ email_types表     │
└───────────────┘        └───────────────────┘        └───────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           数据层 (Data Layer)                                │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────────────────┐ │
│  │ users表     │  │ user_notification│  │ email_logs表                    │ │
│  │ (全局偏好)  │  │ _prefs表(类型偏好)│  │ (发送日志)                      │ │
│  └─────────────┘  └─────────────────┘  └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件说明

| 组件 | 职责 | 位置 |
|------|------|------|
| **EmailNotificationService** | 统一邮件通知中转服务，处理发送前检查、模板渲染、日志记录 | `services/emailNotificationService.js` |
| **EmailService** | 底层邮件发送能力，对接SMTP或自建API | `services/emailService.js` |
| **NotificationService** | 站内通知管理 | `services/notificationService.js` |
| **EmailTypeConfig** | 邮件类型配置管理，从数据库读取类型定义 | 集成在 EmailNotificationService 中 |

### 3.3 数据流向

```
业务事件触发
     │
     ▼
┌─────────────────────────────────────┐
│ 1. 业务代码调用                      │
│    EmailNotificationService.send()  │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 2. 中转服务处理                      │
│    ├─ 验证邮件类型有效性             │
│    ├─ 查询收件人偏好设置             │
│    ├─ 判断是否发送                   │
│    └─ 渲染邮件模板                   │
└─────────────────────────────────────┘
     │
     ├──────────────────┬──────────────────┐
     ▼                  ▼                  ▼
┌──────────┐    ┌──────────────┐    ┌──────────────┐
│ 发送邮件 │    │ 创建站内通知 │    │ 记录日志     │
│ (Email   │    │ (Notification│    │ (email_logs) │
│ Service) │    │ Service)     │    │              │
└──────────┘    └──────────────┘    └──────────────┘
```

---

## 4. 邮件通知类型规划

### 4.1 分类体系

将系统邮件通知分为 **6大类**：

```
邮件通知类型体系
│
├── 1. 账户安全类 (account)
│   │  特点：涉及账户安全，部分强制发送
│   │
│   ├── email_verify      - 邮箱验证码
│   ├── password_reset    - 密码重置
│   └── login_alert       - 异常登录提醒
│
├── 2. 社区互动类 (social)
│   │  特点：用户社交行为触发，可配置
│   │
│   ├── mention           - @提及提醒
│   ├── comment           - 评论提醒
│   ├── like              - 点赞提醒
│   └── follow_post       - 关注发帖提醒
│
├── 3. 测试业务类 (business)
│   │  特点：核心业务流程通知，可配置
│   │
│   ├── plan_assigned     - 测试计划分配
│   ├── plan_status       - 计划状态变更
│   ├── case_review       - 用例审核结果
│   ├── report_ready      - 报告生成完成
│   └── defect_update     - 缺陷状态变更
│
├── 4. 审批流程类 (approval)
│   │  特点：涉及审批流程，可配置
│   │
│   ├── user_audit        - 新用户待审核
│   ├── audit_result      - 审核结果通知
│   └── role_change       - 角色变更通知
│
├── 5. 系统公告类 (announcement)
│   │  特点：管理员发布，可配置
│   │
│   ├── maintenance       - 系统维护通知
│   ├── version_update    - 版本更新公告
│   └── urgent            - 紧急通知
│
└── 6. 定期汇总类 (digest)
    │  特点：定时任务触发，可配置
    │
    ├── daily_digest      - 每日进度汇总
    ├── weekly_report     - 每周工作报告
    └── monthly_stats     - 月度统计数据
```

### 4.2 类型详细定义

#### 4.2.1 账户安全类 (account)

| 类型代码 | 类型名称 | 触发条件 | 收件人 | 强制发送 | 默认开启 | 邮件主题模板 |
|----------|----------|----------|--------|----------|----------|--------------|
| `email_verify` | 邮箱验证码 | 用户绑定/修改邮箱 | 操作用户 | ✅ 是 | ✅ 是 | 【xTest】邮箱验证码 |
| `password_reset` | 密码重置 | 用户申请重置密码 | 操作用户 | ✅ 是 | ✅ 是 | 【xTest】密码重置 |
| `login_alert` | 异常登录提醒 | 检测到异地/新设备登录 | 账户所有者 | ❌ 否 | ✅ 是 | 【xTest】账户安全提醒 |

**业务规则：**

- `email_verify` 和 `password_reset` 为强制发送类型，用户无法关闭
- `login_alert` 用户可自行关闭，建议默认开启
- 此类邮件优先级最高，不受免打扰时段限制

#### 4.2.2 社区互动类 (social)

| 类型代码 | 类型名称 | 触发条件 | 收件人 | 默认开启 | 邮件主题模板 |
|----------|----------|----------|--------|----------|--------------|
| `mention` | @提及提醒 | 有人@我 | 被@用户 | ✅ 是 | 【xTest 社区】{发送者} 在论坛中@了你 |
| `comment` | 评论提醒 | 有人评论我的帖子 | 帖子作者 | ✅ 是 | 【xTest 社区】{发送者} 评论了您的帖子 |
| `like` | 点赞提醒 | 有人点赞我的帖子 | 帖子作者 | ❌ 否 | 【xTest 社区】{发送者} 赞了您的帖子 |
| `follow_post` | 关注发帖提醒 | 我关注的人发了新帖 | 关注者 | ❌ 否 | 【xTest 社区】{关注的人} 发布了新帖子 |

**业务规则：**

- 自己@自己、评论自己的帖子不触发通知
- 匿名帖子的互动不触发通知（保护匿名性）
- 受免打扰时段限制

#### 4.2.3 测试业务类 (business)

| 类型代码 | 类型名称 | 触发条件 | 收件人 | 默认开启 | 邮件主题模板 |
|----------|----------|----------|--------|----------|--------------|
| `plan_assigned` | 测试计划分配 | 管理员分配测试计划 | 被分配人 | ✅ 是 | 【xTest】您被分配了新的测试计划 - {计划名称} |
| `plan_status` | 计划状态变更 | 计划开始/完成/延期 | 计划参与者 | ✅ 是 | 【xTest】测试计划状态变更 - {计划名称} |
| `case_review` | 用例审核结果 | 用例审核通过/驳回 | 用例提交者 | ✅ 是 | 【xTest】用例审核结果 - {用例名称} |
| `report_ready` | 报告生成完成 | 测试报告生成完毕 | 报告创建者 | ✅ 是 | 【xTest】测试报告已生成 - {报告名称} |
| `defect_update` | 缺陷状态变更 | 缺陷状态被更新 | 缺陷创建者 | ✅ 是 | 【xTest】缺陷状态更新 - {缺陷标题} |

**业务规则：**

- 测试计划分配支持批量收件人
- 计划状态变更通知所有参与者
- 受免打扰时段限制

#### 4.2.4 审批流程类 (approval)

| 类型代码 | 类型名称 | 触发条件 | 收件人 | 默认开启 | 邮件主题模板 |
|----------|----------|----------|--------|----------|--------------|
| `user_audit` | 新用户待审核 | 有新用户注册 | 所有管理员 | ✅ 是 | 【xTest】新用户注册待审核 - {用户名} |
| `audit_result` | 审核结果通知 | 账号审核通过/拒绝 | 被审核用户 | ✅ 是 | 【xTest】您的账号审核结果 |
| `role_change` | 角色变更通知 | 用户角色被修改 | 被修改用户 | ✅ 是 | 【xTest】您的角色权限已变更 |

**业务规则：**

- `user_audit` 仅管理员可见该配置项
- 审核结果通知包含审核意见
- 角色变更通知包含新旧角色对比

#### 4.2.5 系统公告类 (announcement)

| 类型代码 | 类型名称 | 触发条件 | 收件人 | 默认开启 | 邮件主题模板 |
|----------|----------|----------|--------|----------|--------------|
| `maintenance` | 系统维护通知 | 管理员发布维护公告 | 全体用户 | ✅ 是 | 【xTest 系统公告】系统维护通知 |
| `version_update` | 版本更新公告 | 系统版本更新 | 全体用户 | ✅ 是 | 【xTest 系统公告】版本更新 - v{版本号} |
| `urgent` | 紧急通知 | 管理员发送紧急通知 | 指定用户/全体 | ✅ 是 | 【xTest 紧急通知】{通知标题} |

**业务规则：**

- 系统公告类邮件可设置优先级
- 紧急通知可绕过免打扰时段
- 支持管理员预览发送数量

#### 4.2.6 定期汇总类 (digest)

| 类型代码 | 类型名称 | 触发条件 | 收件人 | 默认开启 | 邮件主题模板 |
|----------|----------|----------|--------|----------|--------------|
| `daily_digest` | 每日进度汇总 | 每日定时任务（如 18:00） | 相关用户 | ❌ 否 | 【xTest】每日测试进度汇总 - {日期} |
| `weekly_report` | 每周工作报告 | 每周一自动生成 | 相关用户 | ❌ 否 | 【xTest】每周工作报告 - {周次} |
| `monthly_stats` | 月度统计 | 每月1日自动生成 | 管理员 | ❌ 否 | 【xTest】月度统计数据 - {月份} |

**业务规则：**

- 汇总类邮件默认关闭，用户需主动开启
- `monthly_stats` 仅管理员可见
- 受免打扰时段限制

### 4.3 类型属性汇总表

| 类型代码 | 分类 | 强制发送 | 默认开启 | 支持站内通知 | 角色限制 |
|----------|------|----------|----------|--------------|----------|
| `email_verify` | account | ✅ | ✅ | ✅ | 无 |
| `password_reset` | account | ✅ | ✅ | ✅ | 无 |
| `login_alert` | account | ❌ | ✅ | ✅ | 无 |
| `mention` | social | ❌ | ✅ | ✅ | 无 |
| `comment` | social | ❌ | ✅ | ✅ | 无 |
| `like` | social | ❌ | ❌ | ✅ | 无 |
| `follow_post` | social | ❌ | ❌ | ✅ | 无 |
| `plan_assigned` | business | ❌ | ✅ | ✅ | 无 |
| `plan_status` | business | ❌ | ✅ | ✅ | 无 |
| `case_review` | business | ❌ | ✅ | ✅ | 无 |
| `report_ready` | business | ❌ | ✅ | ✅ | 无 |
| `defect_update` | business | ❌ | ✅ | ✅ | 无 |
| `user_audit` | approval | ❌ | ✅ | ✅ | 仅管理员 |
| `audit_result` | approval | ❌ | ✅ | ✅ | 无 |
| `role_change` | approval | ❌ | ✅ | ✅ | 无 |
| `maintenance` | announcement | ❌ | ✅ | ✅ | 无 |
| `version_update` | announcement | ❌ | ✅ | ✅ | 无 |
| `urgent` | announcement | ❌ | ✅ | ✅ | 无 |
| `daily_digest` | digest | ❌ | ❌ | ❌ | 无 |
| `weekly_report` | digest | ❌ | ❌ | ❌ | 无 |
| `monthly_stats` | digest | ❌ | ❌ | ❌ | 仅管理员 |

---

## 5. 统一中转控制设计

### 5.1 核心服务设计

#### 5.1.1 EmailNotificationService 接口定义

```javascript
/**
 * 统一邮件通知中转服务
 */
class EmailNotificationService {
  
  /**
   * 发送邮件通知（核心方法）
   * @param {Object} params - 发送参数
   * @param {string} params.emailType - 邮件类型代码
   * @param {number|number[]} params.to - 收件人用户ID（支持单个或数组）
   * @param {Object} params.data - 邮件模板数据
   * @param {Object} params.options - 可选配置
   * @param {boolean} params.options.forceSend - 强制发送（绕过用户偏好）
   * @param {boolean} params.options.skipInApp - 是否跳过站内通知
   * @param {string} params.options.priority - 发送优先级 'high'|'normal'|'low'
   * @returns {Promise<Object>} 发送结果
   */
  async send(params) {}
  
  /**
   * 检查是否应该发送邮件
   * @param {number} userId - 用户ID
   * @param {string} emailType - 邮件类型代码
   * @returns {Promise<boolean>} 是否发送
   */
  async shouldSendEmail(userId, emailType) {}
  
  /**
   * 获取用户的通知偏好
   * @param {number} userId - 用户ID
   * @returns {Promise<Object>} 偏好设置
   */
  async getUserNotificationPrefs(userId) {}
  
  /**
   * 获取邮件类型配置
   * @param {string} emailType - 邮件类型代码
   * @returns {Promise<Object>} 类型配置
   */
  async getEmailTypeConfig(emailType) {}
  
  /**
   * 渲染邮件模板
   * @param {string} templatePath - 模板路径
   * @param {Object} data - 模板数据
   * @returns {string} 渲染后的HTML
   */
  renderTemplate(templatePath, data) {}
}
```

#### 5.1.2 发送结果结构

```javascript
{
  success: true,           // 整体是否成功
  sentCount: 2,            // 实际发送数量
  skippedCount: 1,         // 因偏好设置跳过的数量
  failedCount: 0,          // 发送失败数量
  details: [
    {
      userId: 1,
      email: 'user1@example.com',
      status: 'sent',      // sent | skipped | failed
      reason: null         // 跳过或失败原因
    },
    {
      userId: 2,
      email: 'user2@example.com',
      status: 'skipped',
      reason: 'user_preference_disabled'
    },
    {
      userId: 3,
      email: 'user3@example.com',
      status: 'sent',
      reason: null
    }
  ]
}
```

### 5.2 发送前检查流程

#### 5.2.1 检查流程图

```
开始发送请求
     │
     ▼
┌─────────────────────────────────────┐
│ Step 1: 验证邮件类型                 │
│ - 检查 type_code 是否存在           │
│ - 检查类型是否启用 (is_active)      │
└─────────────────────────────────────┘
     │
     ├── 无效 ──→ 返回错误
     │
     ▼
┌─────────────────────────────────────┐
│ Step 2: 获取类型配置                 │
│ - is_required (是否强制)            │
│ - category (所属分类)               │
│ - template_path (模板路径)          │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Step 3: 遍历收件人列表               │
│ (并行处理每个收件人)                 │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Step 3.1: 查询用户信息               │
│ - email (邮箱地址)                  │
│ - status (用户状态)                 │
│ - email_global_enabled (全局开关)   │
└─────────────────────────────────────┘
     │
     ├── 邮箱无效/用户禁用 ──→ 跳过该用户
     │
     ▼
┌─────────────────────────────────────┐
│ Step 3.2: 检查是否强制发送           │
│ - is_required === true              │
│ - options.forceSend === true        │
└─────────────────────────────────────┘
     │
     ├── 是 ──→ 跳过偏好检查，直接发送
     │
     ▼
┌─────────────────────────────────────┐
│ Step 3.3: 检查全局开关               │
│ - email_global_enabled === false    │
└─────────────────────────────────────┘
     │
     ├── 关闭 ──→ 跳过该用户
     │
     ▼
┌─────────────────────────────────────┐
│ Step 3.4: 检查类型开关               │
│ - user_notification_prefs 表        │
│ - email_enabled === false           │
└─────────────────────────────────────┘
     │
     ├── 关闭 ──→ 跳过该用户
     │
     ▼
┌─────────────────────────────────────┐
│ Step 3.5: 检查免打扰时段             │
│ - 当前时间是否在 quiet_hours 内     │
│ - 该类型是否允许绕过 (urgent类型)    │
└─────────────────────────────────────┘
     │
     ├── 在免打扰时段 ──→ 跳过该用户
     │
     ▼
┌─────────────────────────────────────┐
│ Step 3.6: 发送邮件                   │
│ - 渲染模板                          │
│ - 调用 EmailService.sendEmail()     │
│ - 记录发送日志                      │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Step 3.7: 创建站内通知               │
│ (如果 skipInApp !== true)           │
│ - 检查 in_app_enabled 偏好          │
│ - 写入 notifications 表             │
└─────────────────────────────────────┘
     │
     ▼
返回汇总结果
```

#### 5.2.2 检查逻辑伪代码

```javascript
async function shouldSendEmail(userId, emailType, options = {}) {
  // 强制发送选项
  if (options.forceSend) {
    return { shouldSend: true, reason: 'force_send' };
  }
  
  // 获取类型配置
  const typeConfig = await this.getEmailTypeConfig(emailType);
  if (!typeConfig || !typeConfig.is_active) {
    return { shouldSend: false, reason: 'type_disabled' };
  }
  
  // 强制类型直接发送
  if (typeConfig.is_required) {
    return { shouldSend: true, reason: 'required_type' };
  }
  
  // 获取用户信息
  const user = await this.getUserInfo(userId);
  if (!user || user.status !== 'active') {
    return { shouldSend: false, reason: 'user_inactive' };
  }
  if (!user.email) {
    return { shouldSend: false, reason: 'no_email' };
  }
  
  // 检查全局开关
  if (user.email_global_enabled === false) {
    return { shouldSend: false, reason: 'global_disabled' };
  }
  
  // 获取用户对该类型的偏好
  const prefs = await this.getUserTypePreference(userId, emailType);
  if (prefs && prefs.email_enabled === false) {
    return { shouldSend: false, reason: 'type_disabled_by_user' };
  }
  
  // 检查免打扰时段
  if (this.isInQuietHours(user.email_quiet_hours_start, user.email_quiet_hours_end)) {
    // 紧急通知可绕过
    if (emailType !== 'urgent' && typeConfig.category !== 'account') {
      return { shouldSend: false, reason: 'quiet_hours' };
    }
  }
  
  return { shouldSend: true, reason: 'normal' };
}
```

### 5.3 批量发送处理

#### 5.3.1 批量发送策略

```javascript
async function sendBatch(emailType, userIds, data, options) {
  const results = {
    success: true,
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    details: []
  };
  
  // 并行处理，但限制并发数
  const concurrencyLimit = 10;
  const chunks = this.chunkArray(userIds, concurrencyLimit);
  
  for (const chunk of chunks) {
    const promises = chunk.map(userId => 
      this.sendToSingleUser(emailType, userId, data, options)
    );
    
    const chunkResults = await Promise.allSettled(promises);
    
    for (const result of chunkResults) {
      if (result.status === 'fulfilled') {
        results.details.push(result.value);
        if (result.value.status === 'sent') results.sentCount++;
        else if (result.value.status === 'skipped') results.skippedCount++;
        else results.failedCount++;
      } else {
        results.failedCount++;
        results.details.push({
          status: 'failed',
          reason: result.reason.message
        });
      }
    }
  }
  
  return results;
}
```

#### 5.3.2 批量发送场景示例

**场景：新用户注册，通知所有管理员审核**

```javascript
// 业务代码调用
const result = await emailNotificationService.send({
  emailType: 'user_audit',
  to: adminUserIds,  // [1, 2, 3, 4, 5]
  data: {
    newUsername: 'zhangsan',
    registerTime: '2026-03-23 14:30:00',
    email: 'zhangsan@example.com'
  }
});

// 返回结果
{
  success: true,
  sentCount: 3,      // 3个管理员开启了通知
  skippedCount: 2,   // 2个管理员关闭了该通知
  failedCount: 0,
  details: [...]
}
```

---

## 6. 数据库设计

### 6.1 新增表结构

#### 6.1.1 邮件类型定义表 `email_types`

```sql
CREATE TABLE email_types (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    type_code VARCHAR(50) UNIQUE NOT NULL COMMENT '类型代码，如 mention, plan_assigned',
    type_name VARCHAR(100) NOT NULL COMMENT '类型名称，用于显示',
    category ENUM('account', 'social', 'business', 'approval', 'announcement', 'digest') 
        NOT NULL COMMENT '所属分类',
    description TEXT COMMENT '详细描述说明',
    is_required BOOLEAN DEFAULT FALSE COMMENT '是否强制发送（不可关闭）',
    default_email_enabled BOOLEAN DEFAULT TRUE COMMENT '默认邮件开关',
    default_in_app_enabled BOOLEAN DEFAULT TRUE COMMENT '默认站内通知开关',
    template_subject VARCHAR(255) COMMENT '邮件主题模板',
    template_path VARCHAR(255) COMMENT '邮件模板文件路径',
    supports_in_app BOOLEAN DEFAULT TRUE COMMENT '是否支持站内通知',
    role_restriction VARCHAR(50) DEFAULT NULL COMMENT '角色限制，如 admin 表示仅管理员可见',
    sort_order INT DEFAULT 0 COMMENT '排序权重',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    INDEX idx_category (category),
    INDEX idx_is_active (is_active),
    INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邮件类型定义表';
```

#### 6.1.2 用户通知偏好表 `user_notification_prefs`

```sql
CREATE TABLE user_notification_prefs (
    id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    user_id INT NOT NULL COMMENT '用户ID',
    type_code VARCHAR(50) NOT NULL COMMENT '邮件类型代码',
    email_enabled BOOLEAN DEFAULT TRUE COMMENT '是否接收邮件通知',
    in_app_enabled BOOLEAN DEFAULT TRUE COMMENT '是否接收站内通知',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    
    UNIQUE KEY uk_user_type (user_id, type_code),
    INDEX idx_user_id (user_id),
    INDEX idx_type_code (type_code),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (type_code) REFERENCES email_types(type_code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户通知偏好表';
```

#### 6.1.3 邮件发送日志表扩展

在现有 `email_logs` 表基础上增加字段：

```sql
ALTER TABLE email_logs 
ADD COLUMN user_id INT COMMENT '收件人用户ID' AFTER recipient_email,
ADD COLUMN type_code VARCHAR(50) COMMENT '邮件类型代码' AFTER email_type,
ADD COLUMN skip_reason VARCHAR(50) COMMENT '跳过原因（当status为skipped时）' AFTER error_message,
ADD COLUMN user_pref_status VARCHAR(20) COMMENT '发送时用户的偏好状态' AFTER skip_reason;

ALTER TABLE email_logs 
ADD INDEX idx_user_id (user_id),
ADD INDEX idx_type_code (type_code);
```

### 6.2 现有表扩展

#### 6.2.1 users 表扩展

```sql
-- 添加全局邮件偏好字段
ALTER TABLE users 
ADD COLUMN email_global_enabled BOOLEAN DEFAULT TRUE 
    COMMENT '全局邮件开关，关闭后所有非强制邮件都不发送' AFTER email_notify_likes,
ADD COLUMN email_quiet_hours_start TIME DEFAULT NULL 
    COMMENT '免打扰开始时间，如 22:00:00' AFTER email_global_enabled,
ADD COLUMN email_quiet_hours_end TIME DEFAULT NULL 
    COMMENT '免打扰结束时间，如 08:00:00' AFTER email_quiet_hours_start,
ADD COLUMN email_digest_frequency ENUM('none', 'daily', 'weekly') DEFAULT 'none' 
    COMMENT '汇总邮件频率' AFTER email_quiet_hours_end;
```

### 6.3 初始数据

#### 6.3.1 邮件类型初始化数据

```sql
INSERT INTO email_types (type_code, type_name, category, description, is_required, default_email_enabled, default_in_app_enabled, template_subject, template_path, role_restriction, sort_order) VALUES
-- 账户安全类
('email_verify', '邮箱验证码', 'account', '用于邮箱绑定、修改时的验证', TRUE, TRUE, TRUE, '【xTest】邮箱验证码', 'email_verify', NULL, 1),
('password_reset', '密码重置', 'account', '用户申请重置密码时发送', TRUE, TRUE, TRUE, '【xTest】密码重置', 'password_reset', NULL, 2),
('login_alert', '异常登录提醒', 'account', '检测到异地或新设备登录时提醒', FALSE, TRUE, TRUE, '【xTest】账户安全提醒', 'login_alert', NULL, 3),

-- 社区互动类
('mention', '@提及提醒', 'social', '有人在论坛帖子中@你', FALSE, TRUE, TRUE, '【xTest 社区】{senderName} 在论坛中@了你', 'mention', NULL, 101),
('comment', '评论提醒', 'social', '有人评论了你的帖子', FALSE, TRUE, TRUE, '【xTest 社区】{senderName} 评论了您的帖子', 'comment', NULL, 102),
('like', '点赞提醒', 'social', '有人点赞了你的帖子', FALSE, FALSE, TRUE, '【xTest 社区】{senderName} 赞了您的帖子', 'like', NULL, 103),
('follow_post', '关注发帖提醒', 'social', '你关注的人发布了新帖子', FALSE, FALSE, TRUE, '【xTest 社区】{followedUser} 发布了新帖子', 'follow_post', NULL, 104),

-- 测试业务类
('plan_assigned', '测试计划分配', 'business', '你被分配了新的测试计划', FALSE, TRUE, TRUE, '【xTest】您被分配了新的测试计划 - {planName}', 'plan_assigned', NULL, 201),
('plan_status', '计划状态变更', 'business', '测试计划状态发生变更（开始/完成/延期）', FALSE, TRUE, TRUE, '【xTest】测试计划状态变更 - {planName}', 'plan_status', NULL, 202),
('case_review', '用例审核结果', 'business', '你提交的用例审核结果通知', FALSE, TRUE, TRUE, '【xTest】用例审核结果 - {caseName}', 'case_review', NULL, 203),
('report_ready', '报告生成完成', 'business', '测试报告生成完成通知', FALSE, TRUE, TRUE, '【xTest】测试报告已生成 - {reportName}', 'report_ready', NULL, 204),
('defect_update', '缺陷状态变更', 'business', '你创建的缺陷状态被更新', FALSE, TRUE, TRUE, '【xTest】缺陷状态更新 - {defectTitle}', 'defect_update', NULL, 205),

-- 审批流程类
('user_audit', '新用户待审核', 'approval', '有新用户注册等待审核', FALSE, TRUE, TRUE, '【xTest】新用户注册待审核 - {username}', 'user_audit', 'admin', 301),
('audit_result', '审核结果通知', 'approval', '账号审核结果通知', FALSE, TRUE, TRUE, '【xTest】您的账号审核结果', 'audit_result', NULL, 302),
('role_change', '角色变更通知', 'approval', '用户角色权限变更通知', FALSE, TRUE, TRUE, '【xTest】您的角色权限已变更', 'role_change', NULL, 303),

-- 系统公告类
('maintenance', '系统维护通知', 'announcement', '系统维护公告通知', FALSE, TRUE, TRUE, '【xTest 系统公告】系统维护通知', 'maintenance', NULL, 401),
('version_update', '版本更新公告', 'announcement', '系统版本更新公告', FALSE, TRUE, TRUE, '【xTest 系统公告】版本更新 - v{version}', 'version_update', NULL, 402),
('urgent', '紧急通知', 'announcement', '管理员发送的紧急通知', FALSE, TRUE, TRUE, '【xTest 紧急通知】{title}', 'urgent', NULL, 403),

-- 定期汇总类
('daily_digest', '每日进度汇总', 'digest', '每日测试进度汇总邮件', FALSE, FALSE, FALSE, '【xTest】每日测试进度汇总 - {date}', 'daily_digest', NULL, 501),
('weekly_report', '每周工作报告', 'digest', '每周工作报告邮件', FALSE, FALSE, FALSE, '【xTest】每周工作报告 - {week}', 'weekly_report', NULL, 502),
('monthly_stats', '月度统计数据', 'digest', '月度统计数据邮件（仅管理员）', FALSE, FALSE, FALSE, '【xTest】月度统计数据 - {month}', 'monthly_stats', 'admin', 503);
```

### 6.4 数据迁移

#### 6.4.1 迁移现有偏好数据

将 `users` 表中现有的三个偏好字段迁移到 `user_notification_prefs` 表：

```sql
-- 迁移脚本
INSERT INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT id, 'mention', email_notify_mentions, TRUE FROM users WHERE email_notify_mentions IS NOT NULL;

INSERT INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT id, 'comment', email_notify_comments, TRUE FROM users WHERE email_notify_comments IS NOT NULL;

INSERT INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT id, 'like', email_notify_likes, TRUE FROM users WHERE email_notify_likes IS NOT NULL;

-- 为所有用户初始化其他类型的默认偏好
INSERT INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
SELECT u.id, et.type_code, et.default_email_enabled, et.default_in_app_enabled
FROM users u
CROSS JOIN email_types et
WHERE NOT EXISTS (
    SELECT 1 FROM user_notification_prefs unp 
    WHERE unp.user_id = u.id AND unp.type_code = et.type_code
);
```

---

## 7. API接口设计

### 7.1 用户通知偏好 API

#### 7.1.1 获取用户通知偏好

```
GET /api/notification-preferences

请求头：
Authorization: Bearer <token>

响应：
{
  "success": true,
  "data": {
    "global": {
      "emailEnabled": true,
      "quietHoursStart": "22:00",
      "quietHoursEnd": "08:00",
      "digestFrequency": "none"
    },
    "categories": [
      {
        "code": "account",
        "name": "账户安全",
        "types": [
          {
            "typeCode": "email_verify",
            "typeName": "邮箱验证码",
            "description": "用于邮箱绑定、修改时的验证",
            "emailEnabled": true,
            "inAppEnabled": true,
            "isRequired": true,
            "canToggleEmail": false,
            "canToggleInApp": false
          },
          {
            "typeCode": "login_alert",
            "typeName": "异常登录提醒",
            "description": "检测到异地或新设备登录时提醒",
            "emailEnabled": true,
            "inAppEnabled": true,
            "isRequired": false,
            "canToggleEmail": true,
            "canToggleInApp": true
          }
        ]
      },
      {
        "code": "social",
        "name": "社区互动",
        "types": [...]
      },
      ...
    ]
  }
}
```

#### 7.1.2 更新全局偏好

```
PUT /api/notification-preferences/global

请求头：
Authorization: Bearer <token>

请求体：
{
  "emailEnabled": true,
  "quietHoursStart": "22:00",
  "quietHoursEnd": "08:00",
  "digestFrequency": "daily"
}

响应：
{
  "success": true,
  "message": "全局偏好设置已更新"
}
```

#### 7.1.3 更新单个类型偏好

```
PUT /api/notification-preferences/:typeCode

请求头：
Authorization: Bearer <token>

请求体：
{
  "emailEnabled": false,
  "inAppEnabled": true
}

响应：
{
  "success": true,
  "message": "偏好设置已更新"
}
```

#### 7.1.4 批量更新偏好

```
PUT /api/notification-preferences/batch

请求头：
Authorization: Bearer <token>

请求体：
{
  "preferences": [
    { "typeCode": "mention", "emailEnabled": true, "inAppEnabled": true },
    { "typeCode": "comment", "emailEnabled": true, "inAppEnabled": true },
    { "typeCode": "like", "emailEnabled": false, "inAppEnabled": true }
  ]
}

响应：
{
  "success": true,
  "message": "批量更新成功",
  "updatedCount": 3
}
```

#### 7.1.5 重置为默认偏好

```
POST /api/notification-preferences/reset

请求头：
Authorization: Bearer <token>

响应：
{
  "success": true,
  "message": "偏好设置已重置为默认值"
}
```

### 7.2 邮件通知发送 API（内部调用）

#### 7.2.1 发送邮件通知

```
POST /api/internal/email-notifications/send

请求体：
{
  "emailType": "plan_assigned",
  "to": [1, 2, 3],
  "data": {
    "planName": "v2.0版本测试计划",
    "assignerName": "管理员",
    "dueDate": "2026-03-30"
  },
  "options": {
    "forceSend": false,
    "skipInApp": false,
    "priority": "normal"
  }
}

响应：
{
  "success": true,
  "sentCount": 2,
  "skippedCount": 1,
  "failedCount": 0,
  "details": [...]
}
```

### 7.3 管理员 API

#### 7.3.1 获取邮件类型列表

```
GET /api/admin/email-types

请求头：
Authorization: Bearer <token> (需要管理员权限)

响应：
{
  "success": true,
  "data": [
    {
      "id": 1,
      "typeCode": "email_verify",
      "typeName": "邮箱验证码",
      "category": "account",
      "isRequired": true,
      "defaultEmailEnabled": true,
      "isActive": true,
      "sentCount": 1234,
      "lastSentAt": "2026-03-23 10:30:00"
    },
    ...
  ]
}
```

#### 7.3.2 更新邮件类型配置

```
PUT /api/admin/email-types/:typeCode

请求头：
Authorization: Bearer <token> (需要管理员权限)

请求体：
{
  "defaultEmailEnabled": true,
  "defaultInAppEnabled": true,
  "isActive": true,
  "templateSubject": "新的邮件主题模板"
}

响应：
{
  "success": true,
  "message": "邮件类型配置已更新"
}
```

#### 7.3.3 发送系统公告

```
POST /api/admin/announcements

请求头：
Authorization: Bearer <token> (需要管理员权限)

请求体：
{
  "emailType": "maintenance",
  "subject": "系统维护通知",
  "content": "系统将于本周六凌晨2点进行维护...",
  "targetType": "all",  // all | role | specific
  "targetRoles": null,  // 当 targetType 为 role 时指定角色
  "targetUserIds": null, // 当 targetType 为 specific 时指定用户ID
  "scheduledAt": null    // 定时发送时间，null 表示立即发送
}

响应：
{
  "success": true,
  "message": "公告发送任务已创建",
  "previewCount": {
    "total": 100,
    "willReceive": 85,
    "skipped": 15
  }
}
```

#### 7.3.4 邮件发送统计

```
GET /api/admin/email-stats

请求头：
Authorization: Bearer <token> (需要管理员权限)

查询参数：
- startDate: 开始日期
- endDate: 结束日期
- typeCode: 邮件类型（可选）

响应：
{
  "success": true,
  "data": {
    "overview": {
      "totalSent": 5000,
      "totalSkipped": 500,
      "totalFailed": 20,
      "successRate": 99.6
    },
    "byType": [
      {
        "typeCode": "mention",
        "typeName": "@提及提醒",
        "sent": 2000,
        "skipped": 100,
        "failed": 5
      },
      ...
    ],
    "byDay": [
      { "date": "2026-03-20", "sent": 200, "skipped": 20 },
      { "date": "2026-03-21", "sent": 180, "skipped": 15 },
      ...
    ],
    "skipReasons": [
      { "reason": "user_preference_disabled", "count": 300 },
      { "reason": "global_disabled", "count": 150 },
      { "reason": "quiet_hours", "count": 50 }
    ]
  }
}
```

---

## 8. 用户界面设计

### 8.1 配置中心 - 消息提醒页面

#### 8.1.1 页面布局

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  消息提醒设置                                                                │
│  自定义您的站内通知与邮件提醒偏好                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ⚙️ 全局设置                                                         │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │                                                                      │   │
│  │  邮件通知总开关                                                      │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │ [🔘 开启 ]  关闭后将不再接收任何邮件通知（账户安全类除外）    │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  │                                                                      │   │
│  │  免打扰时段                                                          │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │ [ 22:00 ▼ ] 至 [ 08:00 ▼ ]  在此时段内不发送邮件通知        │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  │                                                                      │   │
│  │  汇总邮件频率                                                        │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │  ○ 不发送   ○ 每日汇总   ○ 每周汇总                         │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🔐 账户安全                                          [邮件] [站内]   │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │                                                                      │   │
│  │  📧 邮箱验证码                        [必发]        [必发]          │   │
│  │     用于邮箱绑定、修改时的验证                                        │   │
│  │                                                                      │   │
│  │  🔑 密码重置                          [必发]        [必发]          │   │
│  │     用户申请重置密码时发送                                            │   │
│  │                                                                      │   │
│  │  🚨 异常登录提醒                      [🔘 开]       [🔘 开]         │   │
│  │     检测到异地或新设备登录时提醒                                      │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 💬 社区互动                                          [邮件] [站内]   │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │                                                                      │   │
│  │  @ 提到我                             [🔘 开]       [🔘 开]         │   │
│  │     有人在论坛帖子中@你                                               │   │
│  │                                                                      │   │
│  │  💬 评论我的帖子                       [🔘 开]       [🔘 开]         │   │
│  │     有人评论了你发布的帖子                                            │   │
│  │                                                                      │   │
│  │  👍 点赞我的帖子                       [🔘 关]       [🔘 开]         │   │
│  │     有人点赞了你发布的帖子                                            │   │
│  │                                                                      │   │
│  │  👤 关注的人发帖                       [🔘 关]       [🔘 开]         │   │
│  │     你关注的人发布了新帖子                                            │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📋 测试业务                                          [邮件] [站内]   │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │                                                                      │   │
│  │  📝 测试计划分配                       [🔘 开]       [🔘 开]         │   │
│  │     你被分配了新的测试计划                                            │   │
│  │                                                                      │   │
│  │  📊 计划状态变更                       [🔘 开]       [🔘 开]         │   │
│  │     测试计划状态发生变更（开始/完成/延期）                            │   │
│  │                                                                      │   │
│  │  ✅ 用例审核结果                       [🔘 开]       [🔘 开]         │   │
│  │     你提交的用例审核结果通知                                          │   │
│  │                                                                      │   │
│  │  📄 报告生成完成                       [🔘 开]       [🔘 开]         │   │
│  │     测试报告生成完成通知                                              │   │
│  │                                                                      │   │
│  │  🐛 缺陷状态变更                       [🔘 开]       [🔘 开]         │   │
│  │     你创建的缺陷状态被更新                                            │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ✅ 审批流程                                          [邮件] [站内]   │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │                                                                      │   │
│  │  👥 新用户待审核（仅管理员）            [🔘 开]       [🔘 开]         │   │
│  │     有新用户注册等待审核                                              │   │
│  │                                                                      │   │
│  │  📋 审核结果通知                       [🔘 开]       [🔘 开]         │   │
│  │     账号审核结果通知                                                  │   │
│  │                                                                      │   │
│  │  🔐 角色变更通知                       [🔘 开]       [🔘 开]         │   │
│  │     用户角色权限变更通知                                              │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📢 系统公告                                          [邮件] [站内]   │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │                                                                      │   │
│  │  🔧 系统维护通知                       [🔘 开]       [🔘 开]         │   │
│  │     系统维护公告通知                                                  │   │
│  │                                                                      │   │
│  │  🆕 版本更新公告                       [🔘 开]       [🔘 开]         │   │
│  │     系统版本更新公告                                                  │   │
│  │                                                                      │   │
│  │  🚨 紧急通知                           [🔘 开]       [🔘 开]         │   │
│  │     管理员发送的紧急通知                                              │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📊 定期汇总                                          [邮件] [站内]   │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │                                                                      │   │
│  │  📅 每日进度汇总                       [🔘 关]       [—]            │   │
│  │     每日测试进度汇总邮件                                              │   │
│  │                                                                      │   │
│  │  📈 每周工作报告                       [🔘 关]       [—]            │   │
│  │     每周工作报告邮件                                                  │   │
│  │                                                                      │   │
│  │  📊 月度统计（仅管理员）               [🔘 关]       [—]            │   │
│  │     月度统计数据邮件                                                  │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                      │   │
│  │     [ 💾 保存设置 ]     [ 🔄 恢复默认 ]                              │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 8.1.2 交互说明

| 元素 | 说明 |
|------|------|
| **总开关** | 关闭后所有非强制邮件都不发送，账户安全类除外 |
| **免打扰时段** | 时间选择器，可设置开始和结束时间，留空表示不启用 |
| **分类折叠** | 每个分类卡片可折叠/展开，默认全部展开 |
| **双开关** | 每个类型有"邮件"和"站内"两个独立开关 |
| **必发标签** | 账户安全类的强制类型显示"必发"，不可操作 |
| **禁用状态** | 不支持站内通知的类型，站内开关显示为"—"禁用状态 |
| **角色限制** | 管理员专属选项对普通用户隐藏 |
| **保存按钮** | 保存当前所有设置，显示成功提示 |
| **恢复默认** | 将所有设置重置为系统默认值，需二次确认 |

#### 8.1.3 状态提示

```
┌─────────────────────────────────────────────────────────────────┐
│  💡 提示信息                                                     │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  • 账户安全类邮件（验证码、密码重置）为强制发送，无法关闭        │
│  • 关闭总开关后，除账户安全类外所有邮件都将停止发送              │
│  • 免打扰时段内不会发送邮件（紧急通知除外）                      │
│  • 站内通知不受免打扰时段限制                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 管理员界面

#### 8.2.1 邮件类型管理

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  邮件类型管理                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 筛选：[全部分类 ▼] [全部状态 ▼]                    [搜索类型名称]   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 类型代码    │ 类型名称    │ 分类     │ 默认状态 │ 今日发送 │ 操作   │   │
│  ├─────────────┼─────────────┼──────────┼──────────┼──────────┼────────┤   │
│  │ email_verify│ 邮箱验证码  │ 账户安全 │ 强制开启 │ 156      │ [编辑] │   │
│  │ mention     │ @提及提醒   │ 社区互动 │ 默认开启 │ 89       │ [编辑] │   │
│  │ comment     │ 评论提醒    │ 社区互动 │ 默认开启 │ 45       │ [编辑] │   │
│  │ like        │ 点赞提醒    │ 社区互动 │ 默认关闭 │ 12       │ [编辑] │   │
│  │ plan_assign │ 计划分配    │ 测试业务 │ 默认开启 │ 23       │ [编辑] │   │
│  │ ...         │ ...         │ ...      │ ...      │ ...      │ ...    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 8.2.2 发送系统公告

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  发送系统公告                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  公告类型：  [系统维护通知 ▼]                                               │
│                                                                             │
│  公告标题：  [                                          ]                   │
│                                                                             │
│  公告内容：  ┌─────────────────────────────────────────────────────────┐   │
│              │                                                         │   │
│              │  （富文本编辑器）                                        │   │
│              │                                                         │   │
│              └─────────────────────────────────────────────────────────┘   │
│                                                                             │
│  发送对象：  ○ 全体用户                                                    │
│             ○ 指定角色：[多选下拉]                                         │
│             ○ 指定用户：[用户选择器]                                       │
│                                                                             │
│  发送时间：  ○ 立即发送                                                    │
│             ○ 定时发送：[日期选择] [时间选择]                              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📊 发送预览                                                          │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ 目标用户数：100 人                                                    │   │
│  │ 预计发送：85 人（15人已关闭此类通知）                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [ 取消 ]                                        [ 发送公告 ]              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. 邮件模板设计

### 9.1 模板目录结构

```
/emailTemplates
├── /account
│   ├── email_verify.html        # 邮箱验证码
│   ├── password_reset.html      # 密码重置
│   └── login_alert.html         # 异常登录提醒
├── /social
│   ├── mention.html             # @提及提醒
│   ├── comment.html             # 评论提醒
│   ├── like.html                # 点赞提醒
│   └── follow_post.html         # 关注发帖提醒
├── /business
│   ├── plan_assigned.html       # 测试计划分配
│   ├── plan_status.html         # 计划状态变更
│   ├── case_review.html         # 用例审核结果
│   ├── report_ready.html        # 报告生成完成
│   └── defect_update.html       # 缺陷状态变更
├── /approval
│   ├── user_audit.html          # 新用户待审核
│   ├── audit_result.html        # 审核结果通知
│   └── role_change.html         # 角色变更通知
├── /announcement
│   ├── maintenance.html         # 系统维护通知
│   ├── version_update.html      # 版本更新公告
│   └── urgent.html              # 紧急通知
├── /digest
│   ├── daily_digest.html        # 每日进度汇总
│   ├── weekly_report.html       # 每周工作报告
│   └── monthly_stats.html       # 月度统计数据
└── /partials
    ├── header.html              # 公共头部
    ├── footer.html              # 公共底部
    └── button.html              # 按钮组件
```

### 9.2 模板规范

#### 9.2.1 公共样式

```html
<!-- 基础样式 -->
<style>
  .email-container {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    background-color: #ffffff;
  }
  .email-header {
    border-bottom: 2px solid #007bff;
    padding-bottom: 15px;
    margin-bottom: 20px;
  }
  .email-title {
    color: #333;
    font-size: 24px;
    margin: 0;
  }
  .email-content {
    color: #666;
    line-height: 1.6;
  }
  .email-button {
    display: inline-block;
    padding: 12px 30px;
    background-color: #007bff;
    color: #ffffff;
    text-decoration: none;
    border-radius: 5px;
    margin: 20px 0;
  }
  .email-footer {
    border-top: 1px solid #eee;
    padding-top: 20px;
    margin-top: 30px;
    color: #999;
    font-size: 12px;
    text-align: center;
  }
  .highlight-box {
    background-color: #f5f5f5;
    padding: 15px;
    border-left: 4px solid #007bff;
    margin: 20px 0;
  }
</style>
```

#### 9.2.2 模板示例 - 测试计划分配

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1 class="email-title">📋 测试计划分配通知</h1>
    </div>
    
    <div class="email-content">
      <p>尊敬的 <strong>{{userName}}</strong>，您好！</p>
      
      <p>您已被 <strong>{{assignerName}}</strong> 分配了新的测试计划。</p>
      
      <div class="highlight-box">
        <h3 style="margin: 0 0 10px 0; color: #333;">{{planName}}</h3>
        <p style="margin: 5px 0;"><strong>截止日期：</strong>{{dueDate}}</p>
        <p style="margin: 5px 0;"><strong>用例数量：</strong>{{caseCount}} 个</p>
        <p style="margin: 5px 0;"><strong>优先级：</strong>{{priority}}</p>
      </div>
      
      <p>请在截止日期前完成测试任务，如有疑问请联系计划负责人。</p>
      
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

### 9.3 模板变量规范

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `{{userName}}` | 收件人用户名 | 张三 |
| `{{senderName}}` | 发送者用户名 | 管理员 |
| `{{planName}}` | 测试计划名称 | v2.0版本测试计划 |
| `{{planLink}}` | 测试计划链接 | http://xxx/plans/123 |
| `{{dueDate}}` | 截止日期 | 2026-03-30 |
| `{{preferenceLink}}` | 偏好设置链接 | http://xxx/settings/notifications |
| `{{appUrl}}` | 系统首页链接 | http://xxx |
| `{{date}}` | 当前日期 | 2026年3月23日 |

---

## 10. 与现有系统集成

### 10.1 需要改造的模块

| 模块 | 文件路径 | 改造内容 |
|------|----------|----------|
| 通知服务 | `services/notificationService.js` | 接入统一中转服务，移除直接的邮件发送逻辑 |
| 用户路由 | `routes/users.js` | 扩展偏好设置API，新增全局偏好接口 |
| 前端脚本 | `script.js` | 扩展配置中心界面，实现分类展示和双开关 |
| 前端页面 | `index.html` | 扩展消息提醒设置面板HTML |

### 10.2 新增模块

| 模块 | 文件路径 | 职责 |
|------|----------|------|
| 邮件通知服务 | `services/emailNotificationService.js` | 统一邮件通知中转服务 |
| 通知偏好路由 | `routes/notificationPrefs.js` | 用户通知偏好API |
| 邮件模板目录 | `emailTemplates/` | 各类邮件模板文件 |

### 10.3 改造示例

#### 10.3.1 notificationService.js 改造

**改造前：**

```javascript
// 直接发送邮件
if (user.email_notify_mentions == 1 && user.email) {
    emailService.sendEmail({
        to: user.email,
        subject: subject,
        html: html,
        emailType: 'notification'
    }).catch(e => console.error('发送@提醒邮件失败', e));
}
```

**改造后：**

```javascript
// 通过统一中转服务发送
const emailNotificationService = require('./emailNotificationService');

await emailNotificationService.send({
    emailType: 'mention',
    to: user.id,
    data: {
        senderName: senderName,
        preview: preview,
        sourceUrl: sourceUrl
    }
});
```

#### 10.3.2 业务代码调用示例

**测试计划分配：**

```javascript
const emailNotificationService = require('../services/emailNotificationService');

// 分配测试计划后发送通知
async function assignTestPlan(planId, userIds, assignerId) {
    // ... 业务逻辑：创建分配记录 ...
    
    // 发送通知
    await emailNotificationService.send({
        emailType: 'plan_assigned',
        to: userIds,  // 支持数组
        data: {
            planName: plan.name,
            planId: planId,
            assignerName: assigner.username,
            dueDate: plan.due_date,
            caseCount: plan.case_count,
            priority: plan.priority
        }
    });
}
```

**用例审核：**

```javascript
// 用例审核后发送通知
async function reviewCase(caseId, reviewerId, result, comment) {
    // ... 业务逻辑：更新审核状态 ...
    
    // 发送通知
    await emailNotificationService.send({
        emailType: 'case_review',
        to: case.creator_id,
        data: {
            caseName: case.name,
            caseId: caseId,
            result: result,  // 'approved' | 'rejected'
            comment: comment,
            reviewerName: reviewer.username
        }
    });
}
```

---

## 11. 实施计划

### 11.1 分阶段实施

#### 第一阶段：基础设施搭建（预计 3 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 创建数据库表 | 创建 `email_types`、`user_notification_prefs` 表 | 0.5 天 |
| 扩展 users 表 | 添加全局偏好字段 | 0.5 天 |
| 初始化类型数据 | 插入邮件类型初始数据 | 0.5 天 |
| 数据迁移 | 迁移现有偏好数据 | 0.5 天 |
| 创建模板目录 | 创建邮件模板文件结构 | 1 天 |

#### 第二阶段：核心服务开发（预计 4 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 开发 EmailNotificationService | 实现统一中转服务核心逻辑 | 2 天 |
| 开发偏好 API | 实现用户偏好增删改查接口 | 1 天 |
| 开发管理员 API | 实现邮件类型管理和统计接口 | 1 天 |

#### 第三阶段：前端界面开发（预计 3 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 扩展配置中心页面 | 实现消息提醒设置界面 | 2 天 |
| 实现双开关组件 | 邮件和站内通知独立开关 | 0.5 天 |
| 实现分类展示 | 按分类折叠展示通知类型 | 0.5 天 |

#### 第四阶段：业务集成（预计 3 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 改造 notificationService | 接入统一中转服务 | 1 天 |
| 集成测试业务通知 | 测试计划、用例审核等场景 | 1 天 |
| 集成其他业务 | 审批流程、系统公告等 | 1 天 |

#### 第五阶段：测试与上线（预计 2 天）

| 任务 | 描述 | 预计时间 |
|------|------|----------|
| 单元测试 | 核心服务单元测试 | 0.5 天 |
| 集成测试 | 端到端功能测试 | 0.5 天 |
| 性能测试 | 批量发送性能测试 | 0.5 天 |
| 上线部署 | 生产环境部署 | 0.5 天 |

### 11.2 总体时间估算

| 阶段 | 预计时间 |
|------|----------|
| 第一阶段 | 3 天 |
| 第二阶段 | 4 天 |
| 第三阶段 | 3 天 |
| 第四阶段 | 3 天 |
| 第五阶段 | 2 天 |
| **合计** | **15 天** |

---

## 附录

### A. 错误码定义

| 错误码 | 说明 |
|--------|------|
| `EMAIL_TYPE_NOT_FOUND` | 邮件类型不存在 |
| `EMAIL_TYPE_DISABLED` | 邮件类型已禁用 |
| `USER_NOT_FOUND` | 用户不存在 |
| `USER_INACTIVE` | 用户状态异常 |
| `USER_NO_EMAIL` | 用户未设置邮箱 |
| `GLOBAL_DISABLED` | 用户全局邮件开关已关闭 |
| `TYPE_DISABLED_BY_USER` | 用户已关闭该类型邮件 |
| `QUIET_HOURS` | 当前处于免打扰时段 |
| `TEMPLATE_NOT_FOUND` | 邮件模板不存在 |
| `SMTP_ERROR` | SMTP 发送失败 |

### B. 跳过原因说明

| 原因代码 | 说明 |
|----------|------|
| `user_preference_disabled` | 用户关闭了该类型邮件 |
| `global_disabled` | 用户关闭了全局邮件开关 |
| `quiet_hours` | 处于免打扰时段 |
| `no_email` | 用户未设置邮箱 |
| `user_inactive` | 用户状态异常 |

### C. 数据字典

#### C.1 邮件分类枚举

| 值 | 说明 |
|----|------|
| `account` | 账户安全类 |
| `social` | 社区互动类 |
| `business` | 测试业务类 |
| `approval` | 审批流程类 |
| `announcement` | 系统公告类 |
| `digest` | 定期汇总类 |

#### C.2 汇总频率枚举

| 值 | 说明 |
|----|------|
| `none` | 不发送汇总 |
| `daily` | 每日汇总 |
| `weekly` | 每周汇总 |

#### C.3 发送状态枚举

| 值 | 说明 |
|----|------|
| `pending` | 待发送 |
| `sent` | 已发送 |
| `skipped` | 已跳过 |
| `failed` | 发送失败 |

---

## 文档修订记录

| 版本 | 日期 | 修订人 | 修订内容 |
|------|------|--------|----------|
| v1.0 | 2026-03-23 | 系统 | 初始版本 |

---

*本文档由 xTest 测试管理系统架构设计团队编写*
