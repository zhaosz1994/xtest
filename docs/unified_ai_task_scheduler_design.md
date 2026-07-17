# 统一AI任务调度系统设计方案

## 一、背景与问题

### 1.1 当前系统中的AI生成功能

| 功能名称 | 当前实现方式 | 是否有队列 | UI入口位置 | 问题 |
|---------|------------|----------|-----------|------|
| AI生成测试用例 | taskScheduler + 数据库表 | ✅ 有 | 知识库页面 → AI生成按钮 | 无 |
| AI生成一级测试点概述 | setImmediate | ❌ 无 | 一级测试点详情弹窗 → "AI生成概述"按钮 | 多任务并发，无法排队 |
| AI生成关键配置 | setImmediate | ❌ 无 | 用例编辑弹窗 → "AI生成"按钮 | 多任务并发，无法排队 |
| AI生成测试报告 | report_jobs表 + 独立队列 | ✅ 有 | 测试报告页面 → "生成报告"按钮 | 独立实现，未统一 |

### 1.2 存在的问题

1. **实现不统一**：不同AI功能使用不同的任务管理方式
2. **缺乏排队机制**：概述生成和关键配置生成使用 `setImmediate`，无法排队
3. **前端跟踪混乱**：全局变量只能跟踪一个任务，多任务场景下UI更新错误
4. **资源管理缺失**：无法控制AI API的并发调用，可能触发限流
5. **监控困难**：缺乏统一的任务监控和管理界面

## 二、统一任务调度系统设计

### 2.1 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端UI层                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │用例生成   │  │概述生成   │  │关键配置   │  │报告生成   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   统一任务管理器 (前端)                       │
│  - TaskManager: 管理所有类型的任务                            │
│  - WebSocket监听: 接收任务完成通知                            │
│  - UI更新: 统一的任务状态显示                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    API接口层                                 │
│  /api/ai-tasks/create     创建任务                           │
│  /api/ai-tasks/status     查询状态                           │
│  /api/ai-tasks/list       任务列表                           │
│  /api/ai-tasks/cancel     取消任务                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                统一任务调度器 (TaskScheduler)                 │
│  - 多队列管理: 不同类型任务独立队列                            │
│  - 并发控制: 可配置各类任务的并发数                            │
│  - 任务恢复: 服务重启后自动恢复                                │
│  - 定时清理: 自动清理过期任务                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                   数据库任务表                               │
│  ai_unified_tasks: 统一任务表                                │
│  - 支持多种任务类型                                           │
│  - 统一的状态管理                                             │
│  - 完整的生命周期跟踪                                         │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据库设计

#### 2.2.1 统一任务表

```sql
CREATE TABLE IF NOT EXISTS `ai_unified_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` varchar(50) NOT NULL COMMENT '任务唯一标识',
  `task_type` enum('case_generation', 'overview_generation', 'key_config_generation', 'report_generation', 'other') 
    NOT NULL COMMENT '任务类型',
  `user_id` int NOT NULL COMMENT '用户ID',
  `username` varchar(50) DEFAULT NULL COMMENT '用户名',
  
  -- 目标信息
  `target_type` varchar(50) DEFAULT NULL COMMENT '目标类型(module/level1_point/test_case/report)',
  `target_id` int DEFAULT NULL COMMENT '目标ID',
  `target_name` varchar(255) DEFAULT NULL COMMENT '目标名称',
  
  -- 任务状态
  `status` enum('pending','processing','completed','failed','cancelled') 
    DEFAULT 'pending' COMMENT '任务状态',
  `progress` int DEFAULT 0 COMMENT '进度百分比(0-100)',
  `progress_message` varchar(500) DEFAULT NULL COMMENT '进度描述',
  
  -- 任务配置
  `config` json DEFAULT NULL COMMENT '任务配置(JSON)',
  `input_data` json DEFAULT NULL COMMENT '输入数据(JSON)',
  
  -- 执行结果
  `result` longtext COMMENT '执行结果',
  `error_message` text COMMENT '错误信息',
  `error_stack` text COMMENT '错误堆栈',
  
  -- AI审计信息
  `model_name` varchar(100) DEFAULT NULL COMMENT '使用的AI模型',
  `prompt_tokens` int DEFAULT 0 COMMENT '提示词Token数',
  `completion_tokens` int DEFAULT 0 COMMENT '完成Token数',
  `total_tokens` int DEFAULT 0 COMMENT '总Token数',
  
  -- 时间戳
  `started_at` timestamp NULL DEFAULT NULL COMMENT '开始时间',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT '完成时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_id` (`task_id`),
  KEY `idx_task_type` (`task_type`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_target` (`target_type`, `target_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_unified_task_user` FOREIGN KEY (`user_id`) 
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='AI统一任务表';
```

#### 2.2.2 任务类型配置表

```sql
CREATE TABLE IF NOT EXISTS `ai_task_type_configs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_type` varchar(50) NOT NULL COMMENT '任务类型',
  `display_name` varchar(100) NOT NULL COMMENT '显示名称',
  `concurrency` int DEFAULT 2 COMMENT '并发数',
  `timeout_ms` int DEFAULT 120000 COMMENT '超时时间(毫秒)',
  `max_retry` int DEFAULT 3 COMMENT '最大重试次数',
  `priority` int DEFAULT 0 COMMENT '优先级(数字越大优先级越高)',
  `is_enabled` tinyint(1) DEFAULT 1 COMMENT '是否启用',
  `description` text COMMENT '描述',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_type` (`task_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='AI任务类型配置表';

-- 插入默认配置
INSERT INTO `ai_task_type_configs` (`task_type`, `display_name`, `concurrency`, `timeout_ms`, `priority`, `description`) VALUES
('case_generation', '测试用例生成', 2, 300000, 10, '根据需求文档生成测试用例'),
('overview_generation', '一级测试点概述生成', 3, 120000, 5, '为一级测试点生成概述'),
('key_config_generation', '关键配置生成', 3, 60000, 5, '为测试用例生成关键配置'),
('report_generation', '测试报告生成', 1, 600000, 8, '生成测试报告及AI分析');
```

### 2.3 后端服务设计

#### 2.3.1 统一任务服务

```javascript
const pool = require('../db');
const logger = require('./logger');
const aiAuditLogger = require('./aiAuditLogger');

class UnifiedTaskService {
  constructor() {
    this.taskHandlers = new Map();
    this.registerTaskHandlers();
  }

  registerTaskHandlers() {
    this.taskHandlers.set('overview_generation', require('./handlers/overviewGenerationHandler'));
    this.taskHandlers.set('key_config_generation', require('./handlers/keyConfigGenerationHandler'));
    this.taskHandlers.set('case_generation', require('./handlers/caseGenerationHandler'));
    this.taskHandlers.set('report_generation', require('./handlers/reportGenerationHandler'));
  }

  async createTask(taskType, userId, username, targetInfo, config = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const taskId = this.generateTaskId(taskType);
      
      const [result] = await connection.execute(
        `INSERT INTO ai_unified_tasks 
         (task_id, task_type, user_id, username, target_type, target_id, target_name, config, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [taskId, taskType, userId, username, 
         targetInfo.type, targetInfo.id, targetInfo.name, 
         JSON.stringify(config)]
      );

      await connection.commit();

      logger.info('任务已创建', { taskId, taskType, userId, targetInfo });

      return {
        taskId,
        taskType,
        targetInfo,
        status: 'pending'
      };
    } catch (error) {
      await connection.rollback();
      logger.error('创建任务失败', { error: error.message, taskType });
      throw error;
    } finally {
      connection.release();
    }
  }

  generateTaskId(taskType) {
    const prefix = this.getTaskPrefix(taskType);
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  getTaskPrefix(taskType) {
    const prefixes = {
      'case_generation': 'case',
      'overview_generation': 'ov',
      'key_config_generation': 'kc',
      'report_generation': 'rpt'
    };
    return prefixes[taskType] || 'task';
  }

  async getTaskStatus(taskId) {
    const [tasks] = await pool.execute(
      'SELECT * FROM ai_unified_tasks WHERE task_id = ?',
      [taskId]
    );
    return tasks.length > 0 ? tasks[0] : null;
  }

  async getUserTasks(userId, filters = {}) {
    let sql = 'SELECT * FROM ai_unified_tasks WHERE user_id = ?';
    const params = [userId];

    if (filters.taskType) {
      sql += ' AND task_type = ?';
      params.push(filters.taskType);
    }

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(filters.limit || 20, filters.offset || 0);

    const [tasks] = await pool.execute(sql, params);
    return tasks;
  }

  async executeTask(taskId) {
    const task = await this.getTaskStatus(taskId);
    if (!task || task.status === 'cancelled') {
      return;
    }

    const handler = this.taskHandlers.get(task.task_type);
    if (!handler) {
      throw new Error(`未找到任务处理器: ${task.task_type}`);
    }

    try {
      await this.updateTaskStatus(taskId, 'processing', 0, '任务开始处理');

      const result = await handler.execute(task);

      await this.updateTaskStatus(taskId, 'completed', 100, '任务完成', result);

      this.notifyTaskComplete(task, result, true);

      return result;

    } catch (error) {
      await this.updateTaskStatus(taskId, 'failed', 0, error.message, null, error.message, error.stack);
      
      this.notifyTaskComplete(task, null, false, error.message);

      throw error;
    }
  }

  async updateTaskStatus(taskId, status, progress, message, result = null, error = null, errorStack = null) {
    const updates = ['status = ?', 'progress = ?', 'progress_message = ?', 'updated_at = NOW()'];
    const params = [status, progress, message];

    if (status === 'processing') {
      updates.push('started_at = NOW()');
    } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.push('completed_at = NOW()');
    }

    if (result !== null) {
      updates.push('result = ?');
      params.push(typeof result === 'string' ? result : JSON.stringify(result));
    }

    if (error !== null) {
      updates.push('error_message = ?');
      params.push(error);
    }

    if (errorStack !== null) {
      updates.push('error_stack = ?');
      params.push(errorStack);
    }

    params.push(taskId);

    await pool.execute(
      `UPDATE ai_unified_tasks SET ${updates.join(', ')} WHERE task_id = ?`,
      params
    );
  }

  notifyTaskComplete(task, result, success, errorMessage = null) {
    if (global.io) {
      global.io.to(`user_${task.user_id}`).emit('ai_task_complete', {
        taskId: task.task_id,
        taskType: task.task_type,
        targetType: task.target_type,
        targetId: task.target_id,
        targetName: task.target_name,
        result: result,
        success: success,
        errorMessage: errorMessage,
        timestamp: Date.now()
      });
    }
  }

  async cancelTask(taskId, userId) {
    const [result] = await pool.execute(
      `UPDATE ai_unified_tasks 
       SET status = 'cancelled', completed_at = NOW()
       WHERE task_id = ? AND user_id = ? AND status = 'pending'`,
      [taskId, userId]
    );

    return result.affectedRows > 0;
  }
}

module.exports = new UnifiedTaskService();
```

#### 2.3.2 任务处理器接口

```javascript
class BaseTaskHandler {
  constructor(taskType) {
    this.taskType = taskType;
  }

  async execute(task) {
    throw new Error('子类必须实现 execute 方法');
  }

  async validate(task) {
    return true;
  }

  async prepare(task) {
    return {};
  }

  async cleanup(task) {
    // 可选的清理逻辑
  }
}

module.exports = BaseTaskHandler;
```

#### 2.3.3 概述生成处理器

```javascript
const BaseTaskHandler = require('./baseTaskHandler');
const pool = require('../../db');
const logger = require('../../logger');
const { getUserAIConfig, getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams } = require('../../aiService');

class OverviewGenerationHandler extends BaseTaskHandler {
  constructor() {
    super('overview_generation');
  }

  async execute(task) {
    const level1PointId = task.target_id;
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : task.config;

    const [points] = await pool.execute(
      'SELECT id, name, summary, module_id FROM level1_points WHERE id = ?',
      [level1PointId]
    );

    if (points.length === 0) {
      throw new Error('一级测试点不存在');
    }

    const point = points[0];

    const [cases] = await pool.execute(
      `SELECT name, purpose, steps, expected, key_config, precondition
       FROM test_cases
       WHERE level1_id = ? AND is_deleted = 0
       ORDER BY created_at ASC`,
      [level1PointId]
    );

    const caseInfo = cases.length > 0
      ? cases.map((c, i) => 
          `${i + 1}. 【${c.name}】\n   目的: ${c.purpose || '无'}\n   前置条件: ${c.precondition || '无'}\n   步骤: ${c.steps || '无'}\n   预期: ${c.expected || '无'}${c.key_config ? '\n   关键配置: ' + c.key_config : ''}`
        ).join('\n\n')
      : '该测试点下暂无测试用例';

    const aiModel = await getUserAIConfig(task.user_id);
    if (!aiModel) {
      throw new Error('未配置AI模型');
    }

    const systemPrompt = `你是一个专业的测试管理专家。你的任务是根据一级测试点下的所有测试用例内容，生成一段简洁的概述（summary），帮助测试人员快速了解该测试点的测试范围和重点。

要求：
1. 概述长度控制在50-200字
2. 概括该测试点的主要测试内容和方向
3. 如果有多个测试方向，按重要性简要列举
4. 语言简洁专业，避免冗余
5. 只输出概述文本，不要输出其他任何内容`;

    const userPrompt = `测试点名称: ${point.name}
测试类型: 功能测试

该测试点下的测试用例:
${caseInfo}

请为该测试点生成一段概述：`;

    const timeoutConfig = await getUserAITimeoutConfig(task.user_id);
    const genParams = await getUserAIGenerationParams(task.user_id);
    const sceneParams = getSceneParams(genParams, 'scene_case_generation');

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(), 
      timeoutConfig.generalAITask || genParams.request_timeout
    );

    const response = await fetch(aiModel.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiModel.api_key}`
      },
      body: JSON.stringify({
        model: aiModel.model_name,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: sceneParams.temperature,
        max_tokens: sceneParams.max_tokens
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`AI API请求失败: ${response.status}`);
    }

    const data = await response.json();
    let overview = data.choices?.[0]?.message?.content?.trim() || '';

    if (!overview) {
      throw new Error('AI返回的概述为空');
    }

    let finalSummary = overview;
    if (config.appendMode && point.summary) {
      finalSummary = point.summary + '\n' + overview;
    }

    await pool.execute(
      'UPDATE level1_points SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [finalSummary, level1PointId]
    );

    logger.info('概述生成完成', { taskId: task.task_id, level1PointId });

    return finalSummary;
  }
}

module.exports = new OverviewGenerationHandler();
```

### 2.4 任务调度器升级

```javascript
const pool = require('../db');
const { default: PQueue } = require('p-queue');
const cron = require('node-cron');
const logger = require('./logger');
const unifiedTaskService = require('./unifiedTaskService');

class UnifiedTaskScheduler {
  constructor() {
    this.taskQueues = new Map();
    this.isRunning = false;
  }

  async init() {
    const [configs] = await pool.execute(
      'SELECT * FROM ai_task_type_configs WHERE is_enabled = 1'
    );

    for (const config of configs) {
      this.taskQueues.set(config.task_type, {
        queue: new PQueue({ concurrency: config.concurrency }),
        config: config
      });
    }
  }

  async start() {
    if (this.isRunning) return;
    
    await this.init();
    this.isRunning = true;

    this.recoverInterruptedTasks();

    cron.schedule('*/10 * * * * *', () => {
      this.pollAndProcessTasks();
    });

    cron.schedule('0 2 * * *', () => {
      this.cleanupCompletedTasks();
    });

    logger.info('统一任务调度器已启动');
  }

  async recoverInterruptedTasks() {
    try {
      const [result] = await pool.execute(`
        UPDATE ai_unified_tasks 
        SET status = 'pending', progress = 0, progress_message = '任务恢复中...'
        WHERE status = 'processing'
      `);

      if (result.affectedRows > 0) {
        logger.info('已恢复中断的任务', { count: result.affectedRows });
      }
    } catch (error) {
      logger.error('恢复中断任务失败', { error: error.message });
    }
  }

  async pollAndProcessTasks() {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [tasks] = await connection.execute(`
        SELECT t.task_id, t.task_type, c.concurrency
        FROM ai_unified_tasks t
        LEFT JOIN ai_task_type_configs c ON t.task_type = c.task_type
        WHERE t.status = 'pending'
        ORDER BY c.priority DESC, t.created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      `);

      if (tasks.length === 0) {
        await connection.rollback();
        return;
      }

      const processedTaskTypes = new Set();

      for (const task of tasks) {
        const queueInfo = this.taskQueues.get(task.task_type);
        
        if (!queueInfo) {
          logger.warn('未找到任务队列', { taskType: task.task_type });
          continue;
        }

        if (queueInfo.queue.pending >= queueInfo.config.concurrency) {
          continue;
        }

        if (processedTaskTypes.has(task.task_id)) {
          continue;
        }

        await connection.execute(
          'UPDATE ai_unified_tasks SET status = ?, started_at = NOW() WHERE task_id = ?',
          ['processing', task.task_id]
        );

        processedTaskTypes.add(task.task_id);

        queueInfo.queue.add(() => this.processTask(task.task_id));
      }

      await connection.commit();

    } catch (error) {
      await connection.rollback();
      logger.error('任务轮询失败', { error: error.message });
    } finally {
      connection.release();
    }
  }

  async processTask(taskId) {
    logger.info('开始处理任务', { taskId });
    
    try {
      await unifiedTaskService.executeTask(taskId);
    } catch (error) {
      logger.error('任务处理失败', { taskId, error: error.message });
    }
  }

  async cleanupCompletedTasks() {
    try {
      const [result] = await pool.execute(`
        DELETE FROM ai_unified_tasks 
        WHERE status IN ('completed', 'failed', 'cancelled')
          AND completed_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);

      if (result.affectedRows > 0) {
        logger.info('清理了已完成的任务', { count: result.affectedRows });
      }
    } catch (error) {
      logger.error('清理任务失败', { error: error.message });
    }
  }
}

const unifiedTaskScheduler = new UnifiedTaskScheduler();
module.exports = unifiedTaskScheduler;
```

### 2.5 前端统一任务管理器

```javascript
class UnifiedTaskManager {
  constructor() {
    this.tasks = new Map();
    this.init();
  }

  init() {
    if (typeof socket !== 'undefined') {
      socket.on('ai_task_complete', (data) => {
        this.handleTaskComplete(data);
      });
    }

    this.loadPendingTasks();
  }

  async loadPendingTasks() {
    try {
      const response = await apiRequest('/ai-tasks/list?status=pending,processing');
      if (response.success && response.data) {
        response.data.forEach(task => {
          this.tasks.set(task.task_id, task);
        });
        this.updateGlobalUI();
      }
    } catch (error) {
      console.error('加载待处理任务失败:', error);
    }
  }

  addTask(taskId, taskInfo) {
    this.tasks.set(taskId, {
      ...taskInfo,
      createdAt: Date.now()
    });
    this.updateGlobalUI();
    this.updateTaskUI(taskId, 'pending');
  }

  removeTask(taskId) {
    this.tasks.delete(taskId);
    this.updateGlobalUI();
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  getTasksByType(taskType) {
    const result = [];
    for (const [taskId, taskInfo] of this.tasks) {
      if (taskInfo.taskType === taskType) {
        result.push({ taskId, ...taskInfo });
      }
    }
    return result;
  }

  getTasksByTarget(targetType, targetId) {
    const result = [];
    for (const [taskId, taskInfo] of this.tasks) {
      if (taskInfo.targetType === targetType && taskInfo.targetId === targetId) {
        result.push({ taskId, ...taskInfo });
      }
    }
    return result;
  }

  handleTaskComplete(data) {
    const { taskId, taskType, targetType, targetId, result, success, errorMessage } = data;
    
    const taskInfo = this.tasks.get(taskId);
    
    if (taskInfo) {
      this.updateTaskUI(taskId, success ? 'completed' : 'failed', result);
      
      if (success) {
        showSuccessMessage(`任务完成 - ${taskInfo.targetName || ''}`);
      } else {
        showErrorMessage(`任务失败 - ${taskInfo.targetName || ''}: ${errorMessage}`);
      }
      
      this.removeTask(taskId);
    } else {
      if (success) {
        showSuccessMessage('任务完成');
      } else {
        showErrorMessage('任务失败: ' + errorMessage);
      }
    }
  }

  updateTaskUI(taskId, status, result) {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) return;

    switch (taskInfo.taskType) {
      case 'overview_generation':
        this.updateOverviewUI(taskInfo, status, result);
        break;
      case 'key_config_generation':
        this.updateKeyConfigUI(taskInfo, status, result);
        break;
      case 'case_generation':
        this.updateCaseGenerationUI(taskInfo, status, result);
        break;
      case 'report_generation':
        this.updateReportUI(taskInfo, status, result);
        break;
    }
  }

  updateOverviewUI(taskInfo, status, result) {
    if (status === 'completed' && result) {
      if (taskInfo.textarea && document.body.contains(taskInfo.textarea)) {
        let finalSummary = result;
        if (taskInfo.appendMode && taskInfo.existingSummary) {
          finalSummary = taskInfo.existingSummary + '\n' + result;
        }
        taskInfo.textarea.value = finalSummary;
        taskInfo.textarea.dispatchEvent(new Event('input'));
      }
      
      if (typeof updateLevel1SummaryInList === 'function') {
        updateLevel1SummaryInList(taskInfo.targetId, result);
      }
      
      if (typeof updateLevel1DetailModalSummary === 'function') {
        updateLevel1DetailModalSummary(taskInfo.targetId, result);
      }
    }
    
    if (taskInfo.generateBtn) {
      resetOverviewBtn(taskInfo.generateBtn);
    }
  }

  updateKeyConfigUI(taskInfo, status, result) {
    if (status === 'completed' && result) {
      if (taskInfo.textarea && document.body.contains(taskInfo.textarea)) {
        let finalConfig = result;
        if (taskInfo.appendMode && taskInfo.existingConfig) {
          finalConfig = taskInfo.existingConfig + '\n' + result;
        }
        taskInfo.textarea.value = finalConfig;
        taskInfo.textarea.dispatchEvent(new Event('input'));
      }
    }
    
    if (taskInfo.generateBtn) {
      resetKeyConfigBtn(taskInfo.generateBtn);
    }
  }

  updateGlobalUI() {
    const taskCount = this.tasks.size;
    const indicator = document.getElementById('ai-task-indicator');
    
    if (indicator) {
      if (taskCount > 0) {
        const pendingCount = this.getTasksByStatus('pending').length;
        const processingCount = this.getTasksByStatus('processing').length;
        
        indicator.innerHTML = `
          <div class="task-indicator-content">
            <span class="task-icon">🤖</span>
            <span class="task-text">
              ${processingCount > 0 ? `${processingCount}个任务处理中` : ''}
              ${pendingCount > 0 ? `${pendingCount}个任务排队中` : ''}
            </span>
          </div>
        `;
        indicator.style.display = 'block';
      } else {
        indicator.style.display = 'none';
      }
    }
  }

  getTasksByStatus(status) {
    const result = [];
    for (const [taskId, taskInfo] of this.tasks) {
      if (taskInfo.status === status) {
        result.push({ taskId, ...taskInfo });
      }
    }
    return result;
  }
}

window.unifiedTaskManager = new UnifiedTaskManager();
```

## 三、前端交互优化设计

### 3.1 核心交互原则

**每个一级测试点的"AI生成概述"按钮是独立管理的**，具体规则：

1. ✅ **独立禁用**：点击某个测试点的AI生成按钮后，只有该测试点的按钮被禁用
2. ✅ **独立恢复**：该测试点的生成任务完成后，只有该测试点的按钮恢复可点击
3. ✅ **并行操作**：在等待期间，可以点击其他测试点的AI生成按钮
4. ✅ **状态隔离**：每个测试点的任务状态完全独立，互不影响

### 3.2 按钮状态管理

#### 3.2.1 按钮状态定义

```javascript
// 按钮状态枚举
const ButtonState = {
  IDLE: 'idle',           // 空闲，可点击
  PENDING: 'pending',     // 排队中，不可点击
  PROCESSING: 'processing', // 处理中，不可点击
  COMPLETED: 'completed',  // 已完成，恢复可点击
  FAILED: 'failed'        // 失败，恢复可点击
};

// 每个测试点的按钮状态独立存储
class ButtonStateManager {
  constructor() {
    this.buttonStates = new Map(); // key: level1PointId, value: ButtonState
  }

  setState(pointId, state) {
    this.buttonStates.set(pointId, state);
    this.updateButtonUI(pointId, state);
  }

  getState(pointId) {
    return this.buttonStates.get(pointId) || ButtonState.IDLE;
  }

  isClickable(pointId) {
    const state = this.getState(pointId);
    return state === ButtonState.IDLE || 
           state === ButtonState.COMPLETED || 
           state === ButtonState.FAILED;
  }

  updateButtonUI(pointId, state) {
    const button = document.querySelector(
      `.ai-generate-overview-btn[data-point-id="${pointId}"]`
    );
    
    if (!button) return;

    switch (state) {
      case ButtonState.IDLE:
        button.disabled = false;
        button.classList.remove('btn-loading', 'btn-success', 'btn-error');
        button.innerHTML = `
          <svg>...</svg>
          AI生成概述
        `;
        button.title = '点击AI自动生成概述';
        break;

      case ButtonState.PENDING:
        button.disabled = true;
        button.classList.add('btn-loading');
        button.innerHTML = `
          <svg class="spin">...</svg>
          排队中...
        `;
        button.title = '任务已提交，正在排队等待处理';
        break;

      case ButtonState.PROCESSING:
        button.disabled = true;
        button.classList.add('btn-loading');
        button.innerHTML = `
          <svg class="spin">...</svg>
          生成中...
        `;
        button.title = 'AI正在生成概述，请稍候';
        break;

      case ButtonState.COMPLETED:
        button.disabled = false;
        button.classList.remove('btn-loading');
        button.classList.add('btn-success');
        button.innerHTML = `
          <svg>✓</svg>
          已完成
        `;
        button.title = '概述生成完成';
        
        // 2秒后恢复为IDLE状态
        setTimeout(() => {
          this.setState(pointId, ButtonState.IDLE);
        }, 2000);
        break;

      case ButtonState.FAILED:
        button.disabled = false;
        button.classList.remove('btn-loading');
        button.classList.add('btn-error');
        button.innerHTML = `
          <svg>✗</svg>
          失败
        `;
        button.title = '概述生成失败，点击重试';
        
        // 3秒后恢复为IDLE状态
        setTimeout(() => {
          this.setState(pointId, ButtonState.IDLE);
        }, 3000);
        break;
    }
  }
}

window.buttonStateManager = new ButtonStateManager();
```

#### 3.2.2 实际使用示例

```javascript
// 场景1：用户点击测试点A的AI生成按钮
async function handleOverviewGeneration(pointId) {
  // 检查该测试点是否已有任务
  if (!window.buttonStateManager.isClickable(pointId)) {
    showInfoMessage('该测试点的概述生成任务正在处理中');
    return;
  }

  // 设置按钮为PENDING状态
  window.buttonStateManager.setState(pointId, ButtonState.PENDING);

  try {
    // 创建任务
    const response = await apiRequest('/ai-tasks/create', {
      method: 'POST',
      body: JSON.stringify({
        taskType: 'overview_generation',
        targetType: 'level1_point',
        targetId: pointId,
        config: { appendMode: false }
      })
    });

    if (response.success) {
      // 任务创建成功，按钮状态会在任务完成时自动更新
      showSuccessMessage('概述生成任务已提交');
    } else {
      // 任务创建失败，恢复按钮状态
      window.buttonStateManager.setState(pointId, ButtonState.FAILED);
      showErrorMessage(response.message);
    }
  } catch (error) {
    window.buttonStateManager.setState(pointId, ButtonState.FAILED);
    showErrorMessage('提交任务失败: ' + error.message);
  }
}

// 场景2：用户在测试点A生成期间，点击测试点B的AI生成按钮
// ✅ 测试点B的按钮是独立的，不受测试点A的影响
// ✅ 测试点B可以正常创建任务并开始生成

// 场景3：任务完成时的处理
socket.on('ai_task_complete', (data) => {
  const { taskType, targetId, success } = data;
  
  if (taskType === 'overview_generation') {
    const pointId = targetId;
    
    if (success) {
      window.buttonStateManager.setState(pointId, ButtonState.COMPLETED);
    } else {
      window.buttonStateManager.setState(pointId, ButtonState.FAILED);
    }
  }
});
```

### 3.3 多任务并行场景示例

```
时间线：
T0: 用户点击测试点A的AI生成按钮
    → 测试点A按钮：禁用（排队中）
    → 测试点B按钮：可点击 ✅
    → 测试点C按钮：可点击 ✅

T1: 用户点击测试点B的AI生成按钮
    → 测试点A按钮：禁用（生成中）
    → 测试点B按钮：禁用（排队中）
    → 测试点C按钮：可点击 ✅

T2: 用户点击测试点C的AI生成按钮
    → 测试点A按钮：禁用（生成中）
    → 测试点B按钮：禁用（生成中）
    → 测试点C按钮：禁用（排队中）

T3: 测试点A生成完成
    → 测试点A按钮：恢复可点击 ✅
    → 测试点B按钮：禁用（生成中）
    → 测试点C按钮：禁用（排队中）

T4: 测试点B生成完成
    → 测试点A按钮：可点击
    → 测试点B按钮：恢复可点击 ✅
    → 测试点C按钮：禁用（生成中）

T5: 测试点C生成完成
    → 测试点A按钮：可点击
    → 测试点B按钮：可点击
    → 测试点C按钮：恢复可点击 ✅
```

### 3.4 UI入口位置说明

#### 3.4.1 AI生成测试用例

**UI入口位置**：
- 主导航：知识库 → 选择模块 → AI生成按钮
- 具体路径：[index.html:4407](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L4407)
- 按钮ID：`btnAIGenerate`
- 功能描述：根据知识库文件生成测试用例

**当前状态**：✅ 已使用任务调度器

#### 3.4.2 AI生成一级测试点概述

**UI入口位置**：
- 入口1：一级测试点列表 → 点击测试点 → 详情弹窗 → "AI生成概述"按钮
- 入口2：一级测试点详情页 → 概述区域 → "AI生成概述"按钮
- 具体路径：[index.html:6522](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L6522)
- 按钮ID：`ai-generate-summary-btn`
- 功能描述：为一级测试点生成概述

**当前状态**：❌ 使用 setImmediate，需改造

**交互优化**：
- ✅ 每个测试点的按钮独立管理
- ✅ 支持多个测试点同时生成
- ✅ 按钮状态实时反馈

#### 3.4.3 AI生成关键配置

**UI入口位置**：
- 入口1：测试用例编辑弹窗 → 关键配置区域 → "AI生成"按钮
- 入口2：测试用例详情页 → 关键配置区域 → "AI生成"按钮
- 具体路径：[index.html:7435](file:///Users/zhao/Desktop/my_projects/xtest/index.html#L7435)
- 按钮ID：`ai-generate-key-config-btn`
- 功能描述：为测试用例生成关键配置

**当前状态**：❌ 使用 setImmediate，需改造

**交互优化**：
- ✅ 每个用例的按钮独立管理
- ✅ 支持多个用例同时生成关键配置
- ✅ 按钮状态实时反馈

#### 3.4.4 AI生成测试报告

**UI入口位置**：
- 主导航：测试报告 → "生成报告"按钮
- 功能描述：生成测试报告及AI分析

**当前状态**：✅ 已使用独立任务队列

## 四、渐进迁移：用例生成与报告生成

### 4.1 现有系统分析

#### 4.1.1 用例生成（case_generation）

**当前实现**：
- 任务表：`ai_case_generation_tasks`（独立表，字段丰富：stage、progress、total_chunks、processed_chunks等）
- 调度器：`taskScheduler.js` 使用 `PQueue`，并发数由 `TASK_PROCESSING_CONCURRENCY` 控制
- 服务层：`caseGeneratorService.js` 管理 Map/Reduce 阶段
- 进度通知：通过数据库轮询获取进度，前端定时 `getTaskStatus`

**迁移难点**：
- 用例生成的阶段多（chunking → mapping → reducing → finished），进度计算复杂
- 已有独立的子表（`ai_material_chunks`、`temp_test_cases`、`temp_level1_points`）依赖 `task_id` 外键
- 前端进度展示页面（AI生成 Section）已有独立的进度条和阶段展示

**迁移策略：适配器模式，不迁移子表**

```
┌─────────────────────────────────────────────────────────────┐
│  新：ai_unified_tasks                                       │
│  task_id = "case_xxx"                                       │
│  task_type = "case_generation"                              │
│  status = "processing"                                      │
│  progress = 65                                              │
│  config = { originalTaskTable: true }                       │
├─────────────────────────────────────────────────────────────┤
│  旧：ai_case_generation_tasks（保留，通过适配器同步状态）      │
│  task_id = "case_xxx"                                       │
│  stage = "mapping"                                          │
│  progress = 65                                              │
│  total_chunks = 10, processed_chunks = 6                    │
└─────────────────────────────────────────────────────────────┘
```

#### 4.1.2 报告生成（report_generation）

**当前实现**：
- 任务表：`report_jobs`（独立表，字段：id、user_id、status、progress、message、config、report_id）
- 队列：使用 `processAsyncJob` 直接执行，无 `PQueue` 控制
- 通知：通过 `report_jobs` 表轮询

**迁移难点**：
- `report_jobs` 表与报告模块耦合较深
- 报告生成有独立的 `getJob`/`createJob`/`updateJob`/`deleteJob` 函数
- 前端通过 `/reports/job-status/:jobId` 轮询状态

**迁移策略：适配器模式，保留 report_jobs 表**

```
┌─────────────────────────────────────────────────────────────┐
│  新：ai_unified_tasks                                       │
│  task_id = "rpt_xxx"                                       │
│  task_type = "report_generation"                            │
│  status = "processing"                                      │
│  config = { originalJobTable: true, jobId: "job_xxx" }      │
├─────────────────────────────────────────────────────────────┤
│  旧：report_jobs（保留，通过适配器同步状态）                   │
│  id = "job_xxx"                                             │
│  status = "processing"                                      │
│  progress = 45                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 适配器层设计

#### 4.2.1 用例生成适配器（CaseGenerationAdapter）

```javascript
// services/adapters/caseGenerationAdapter.js
const pool = require('../../db');
const logger = require('../../logger');

class CaseGenerationAdapter {
  constructor() {
    this.taskType = 'case_generation';
  }

  // 从旧表同步状态到统一任务表
  async syncToUnifiedTask(originalTaskId) {
    const [origTasks] = await pool.execute(
      'SELECT * FROM ai_case_generation_tasks WHERE task_id = ?',
      [originalTaskId]
    );

    if (origTasks.length === 0) return null;

    const orig = origTasks[0];

    const statusMapping = {
      'pending': 'pending',
      'processing': 'processing',
      'completed': 'completed',
      'failed': 'failed',
      'cancelled': 'cancelled'
    };

    const unifiedStatus = statusMapping[orig.status] || 'pending';

    // UPSERT 到统一任务表
    await pool.execute(
      `INSERT INTO ai_unified_tasks 
       (task_id, task_type, user_id, username, target_type, target_id, target_name,
        status, progress, progress_message, config, started_at, completed_at, created_at)
       VALUES (?, ?, ?, ?, 'module', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         progress = VALUES(progress),
         progress_message = VALUES(progress_message),
         started_at = VALUES(started_at),
         completed_at = VALUES(completed_at)`,
      [
        orig.task_id, this.taskType, orig.user_id, null,
        orig.module_id, null, unifiedStatus, orig.progress,
        orig.progress_message,
        JSON.stringify({ originalTaskTable: true, stage: orig.stage }),
        orig.started_at, orig.completed_at, orig.created_at
      ]
    );

    return unifiedStatus;
  }

  // 从统一任务表创建时，同步到旧表
  async createInOriginalTable(unifiedTask) {
    // 用例生成仍走原始流程，只是状态同步到统一表
    // 这里不需要做额外操作，因为用例生成的创建流程不改变
  }

  // 获取详细进度（从旧表获取阶段信息）
  async getDetailedProgress(taskId) {
    const [tasks] = await pool.execute(
      'SELECT stage, total_chunks, processed_chunks, total_cases, duplicate_count FROM ai_case_generation_tasks WHERE task_id = ?',
      [taskId]
    );

    if (tasks.length === 0) return null;

    const task = tasks[0];
    const stageMessages = {
      'init': '任务初始化',
      'chunking': '文本分块处理中',
      'mapping': 'AI生成用例中',
      'reducing': '用例去重合并中',
      'finished': '任务完成'
    };

    return {
      stage: task.stage,
      stageMessage: stageMessages[task.stage] || task.stage,
      totalChunks: task.total_chunks,
      processedChunks: task.processed_chunks,
      totalCases: task.total_cases,
      duplicateCount: task.duplicate_count
    };
  }
}

module.exports = new CaseGenerationAdapter();
```

#### 4.2.2 报告生成适配器（ReportGenerationAdapter）

```javascript
// services/adapters/reportGenerationAdapter.js
const pool = require('../../db');
const logger = require('../../logger');

class ReportGenerationAdapter {
  constructor() {
    this.taskType = 'report_generation';
  }

  async syncToUnifiedTask(jobId) {
    const [jobs] = await pool.execute(
      'SELECT * FROM report_jobs WHERE id = ?',
      [jobId]
    );

    if (jobs.length === 0) return null;

    const job = jobs[0];
    const config = typeof job.config === 'string' ? JSON.parse(job.config) : job.config;

    const statusMapping = {
      'pending': 'pending',
      'processing': 'processing',
      'completed': 'completed',
      'failed': 'failed',
      'cancelled': 'cancelled'
    };

    const unifiedStatus = statusMapping[job.status] || 'pending';

    // 用 job 的 id 作为统一任务的 target_id
    const unifiedTaskId = `rpt_${job.id.replace('job_', '')}`;

    await pool.execute(
      `INSERT INTO ai_unified_tasks 
       (task_id, task_type, user_id, username, target_type, target_id, target_name,
        status, progress, progress_message, config, started_at, completed_at, created_at)
       VALUES (?, ?, ?, ?, 'report', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         progress = VALUES(progress),
         progress_message = VALUES(progress_message),
         completed_at = VALUES(completed_at)`,
      [
        unifiedTaskId, this.taskType, job.user_id, job.username,
        null, config.reportName || '测试报告', unifiedStatus, job.progress,
        job.message,
        JSON.stringify({ originalJobTable: true, jobId: job.id, reportId: job.report_id }),
        null, 
        job.status === 'completed' || job.status === 'failed' ? job.updated_at : null,
        job.created_at
      ]
    );

    return { unifiedTaskId, unifiedStatus };
  }

  async getDetailedProgress(unifiedTaskId) {
    const [tasks] = await pool.execute(
      'SELECT config FROM ai_unified_tasks WHERE task_id = ?',
      [unifiedTaskId]
    );

    if (tasks.length === 0) return null;

    const config = typeof tasks[0].config === 'string' ? JSON.parse(tasks[0].config) : tasks[0].config;
    if (!config.jobId) return null;

    const [jobs] = await pool.execute(
      'SELECT * FROM report_jobs WHERE id = ?',
      [config.jobId]
    );

    if (jobs.length === 0) return null;

    return {
      jobId: jobs[0].id,
      reportId: jobs[0].report_id,
      message: jobs[0].message,
      error: jobs[0].error_message
    };
  }
}

module.exports = new ReportGenerationAdapter();
```

### 4.3 迁移步骤

#### 4.3.1 用例生成迁移步骤

```
步骤1: 创建统一任务表（不影响现有功能）
步骤2: 在 taskScheduler.processTask 中增加状态同步钩子
       → 每次更新 ai_case_generation_tasks 状态后
       → 同步调用 caseGenerationAdapter.syncToUnifiedTask()
步骤3: 在 AI生成 Section 前端增加统一任务管理器接入
       → 任务创建时在统一表也创建一条记录
       → 进度展示仍从旧表读取（通过适配器）
步骤4: 验证：对比新旧表状态一致性
步骤5: 统一任务监控面板可展示用例生成任务
```

#### 4.3.2 报告生成迁移步骤

```
步骤1: 在 reports.js 的 createJob/updateJob 中增加状态同步钩子
       → 每次更新 report_jobs 后
       → 同步调用 reportGenerationAdapter.syncToUnifiedTask()
步骤2: 在报告生成前端增加统一任务管理器接入
步骤3: 验证：对比新旧表状态一致性
步骤4: 统一任务监控面板可展示报告生成任务
```

### 4.4 API兼容层

保留所有旧API路径，内部通过适配器同步到统一任务表：

```javascript
// 旧API: POST /ai-generation/create
// 内部增加一行：await caseGenerationAdapter.syncToUnifiedTask(result.taskId);

// 旧API: POST /reports/async-generate
// 内部增加一行：await reportGenerationAdapter.syncToUnifiedTask(jobId);

// 新API: GET /api/ai-tasks/list
// 可查看所有类型的任务（包括用例生成和报告生成）
```

### 4.5 数据迁移脚本

```sql
-- 将现有的 ai_case_generation_tasks 历史数据迁移到统一任务表
INSERT INTO ai_unified_tasks 
  (task_id, task_type, user_id, target_type, target_id, status, progress, 
   progress_message, started_at, completed_at, created_at)
SELECT 
  task_id, 'case_generation', user_id, 'module', module_id, status, progress,
  progress_message, started_at, completed_at, created_at
FROM ai_case_generation_tasks
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
ON DUPLICATE KEY UPDATE status = VALUES(status);

-- 将现有的 report_jobs 历史数据迁移到统一任务表
INSERT INTO ai_unified_tasks 
  (task_id, task_type, user_id, username, target_type, target_name, status, progress, 
   progress_message, config, completed_at, created_at)
SELECT 
  CONCAT('rpt_', REPLACE(id, 'job_', '')), 'report_generation', user_id, username, 
  'report', '测试报告', status, progress,
  message,
  JSON_OBJECT('originalJobTable', true, 'jobId', id, 'reportId', report_id),
  CASE WHEN status IN ('completed','failed','cancelled') THEN updated_at ELSE NULL END,
  created_at
FROM report_jobs
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
ON DUPLICATE KEY UPDATE status = VALUES(status);
```

## 五、任务监控面板

### 5.1 功能设计

#### 5.1.1 面板整体布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  🤖 AI任务中心                                          [刷新] [设置] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │  总任务  │ │  处理中  │ │  排队中  │ │  已完成  │ │  失败    │     │
│  │   128   │ │    3    │ │    5    │ │   112   │ │    8    │     │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘     │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  🔥 进行中的任务                                  [全部展开]   │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ 📝 概述生成 │ 👤张三 │ "登录功能测试点" │ ████████░░ 80% │ ... │   │
│  │ 📝 概述生成 │ 👤李四 │ "性能测试点"     │ ██░░░░░░░░ 15% │ ... │   │
│  │ 🔧 关键配置 │ 👤张三 │ "用户注册用例"   │ █████████░ 95% │ ... │   │
│  │ 📊 报告生成 │ 👤王五 │ "Q2测试报告"     │ ██████░░░░ 60% │ ... │   │
│  │ 🧪 用例生成 │ 👤张三 │ "SDK模块"        │ ███████░░░ 70% │ ... │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌───────────────────────────────┐ ┌─────────────────────────────┐ │
│  │  📊 今日统计                   │ │ 💰 Token消耗（近7天）        │ │
│  │  任务完成率: 93.5%            │ │  ██ ██ ██ █░ ░░ ░░ ░░       │ │
│  │  平均耗时: 18s               │ │  1.2万 1.1万 8千 3千 ...    │ │
│  │  AI调用次数: 45              │ │  今日消耗: 3,200 tokens      │ │
│  │  活跃用户: 6人               │ │  人均消耗: 533 tokens        │ │
│  └───────────────────────────────┘ └─────────────────────────────┘ │
│                                                                      │
│  ────────────────────────────────────────────────────────────────    │
│  📋 历史记录与详细日志请前往 → [AI操作日志页面]                      │
│  ────────────────────────────────────────────────────────────────    │
└──────────────────────────────────────────────────────────────────────┘
```

#### 5.1.2 面板功能模块

**模块1: 概览统计卡片**
- 总任务数、处理中、排队中、已完成、失败
- 点击卡片可筛选对应状态的任务

**模块2: 进行中的任务**
- 实时进度条展示
- 显示任务类型图标 + 创建人 + 目标名称 + 进度百分比 + 状态文本
- 用例生成任务展示阶段信息（chunking/mapping/reducing）
- 支持取消排队中的任务
- 每5秒自动刷新（WebSocket + 轮询兜底）

**模块3: 统计图表**
- 今日统计：完成率、平均耗时、调用次数、活跃用户数
- Token消耗趋势：近7天的消耗柱状图、人均消耗

**模块4: 历史记录跳转**
- 任务历史和详细日志不在本面板重复展示（AI操作日志页面已有完整覆盖）
- 提供跳转链接直达 [AI操作日志页面](/ai-operation-logs)
- 本面板聚焦于**实时任务监控**，不做历史数据重复

### 5.2 UI入口设计

#### 5.2.1 入口1：顶部导航栏 - AI任务中心按钮（推荐）

**位置**：顶部导航栏右侧，在"AI生成"按钮和"通知铃铛"之间

**交互**：
- 无任务时：显示 "🤖 AI任务" 按钮，无角标
- 有任务进行中：按钮显示角标，标注进行中的任务数量
- 点击后：在页面内弹出侧滑面板（从右侧滑出），展示任务监控面板

**HTML结构**：
```html
<!-- 在 nav-actions 内，AI生成按钮之后、通知铃铛之前插入 -->
<a href="javascript:void(0)" 
   onclick="openAITaskCenter()" 
   class="nav-action-btn ai-task-center-btn" 
   id="ai-task-center-btn"
   title="AI任务中心"
   style="background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); color: white; text-decoration: none; position: relative;">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
    </svg>
    <span class="nav-btn-text">AI任务</span>
    <!-- 任务数量角标 -->
    <span class="ai-task-badge" id="ai-task-badge" style="display: none; position: absolute; top: -4px; right: -4px; background: #ef4444; color: white; border-radius: 10px; font-size: 10px; min-width: 18px; height: 18px; line-height: 18px; text-align: center; padding: 0 4px;">0</span>
</a>
```

**插入位置示意**（现有导航栏布局）：
```
[测试管理] [用例库] [测试计划] [测试报告] [知识库] [配置中心]     [🌙暗色] [🤖AI问答] [🤖AI生成] [▶AI任务] [🔔通知] [👤用户]
                                                                     新增入口 ↑
```

#### 5.2.2 入口2：配置中心 - AI智能体分组下新增菜单项

**位置**：配置中心左侧导航 → AI 智能体分组 → 新增 "📊 AI任务中心" 菜单项

**交互**：点击后在配置中心右侧内容区域展示任务监控面板

**HTML结构**：
```html
<!-- 在 "⏱️ AI 超时配置" 菜单项之后添加 -->
<a href="#/settings?config=ai-task-center" class="menu-item" data-panel="ai-task-center-config">
    <span class="menu-item-icon">📊</span>
    <span class="menu-item-text">AI任务中心</span>
</a>
```

**插入位置示意**（配置中心左侧导航）：
```
🤖 AI 智能体
  ├── ⚙️ AI 配置
  ├── 🧩 智能体编排台
  ├── 🔧 自定义工具工坊
  ├── 🧠 记忆管理台
  ├── ⏱️ AI 超时配置
  └── 📊 AI任务中心      ← 新增
```

#### 5.2.3 入口3：AI生成页面 - 内嵌任务进度区域增强

**位置**：AI生成页面（`#/ai-generation`）中已有的 "⏳ AI生成进度" 区域

**增强内容**：
- 在现有的进度展示下方，增加"查看全部AI任务"链接
- 点击后打开任务监控侧滑面板

**HTML结构**：
```html
<!-- 在现有 AI生成 Section 的进度区域底部添加 -->
<div class="ai-all-tasks-link" style="text-align: center; margin-top: 16px;">
    <a href="javascript:void(0)" onclick="openAITaskCenter()" 
       style="color: #6366f1; font-size: 13px; text-decoration: none;">
        📊 查看全部AI任务 →
    </a>
</div>
```

### 5.3 侧滑面板实现

#### 5.3.1 面板结构

```javascript
function openAITaskCenter() {
    // 如果面板已存在，直接显示
    let panel = document.getElementById('ai-task-center-panel');
    if (panel) {
        panel.classList.add('panel-open');
        loadAITaskCenterData();
        return;
    }

    // 创建遮罩
    const overlay = document.createElement('div');
    overlay.id = 'ai-task-center-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9998;transition:opacity 0.3s;';

    // 创建面板
    panel = document.createElement('div');
    panel.id = 'ai-task-center-panel';
    panel.style.cssText = `
        position:fixed;top:0;right:-600px;width:600px;height:100vh;
        background:#fff;z-index:9999;transition:right 0.3s ease;
        box-shadow:-4px 0 20px rgba(0,0,0,0.15);display:flex;flex-direction:column;
    `;

    panel.innerHTML = `
        <!-- 面板头部 -->
        <div style="padding:20px 24px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
            <h2 style="margin:0;font-size:18px;font-weight:600;color:#1f2937;">
                🤖 AI任务中心
            </h2>
            <div style="display:flex;gap:8px;align-items:center;">
                <button onclick="loadAITaskCenterData()" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">
                    🔄 刷新
                </button>
                <button onclick="closeAITaskCenter()" style="padding:6px 12px;border:none;border-radius:6px;background:#f3f4f6;cursor:pointer;font-size:16px;">
                    ✕
                </button>
            </div>
        </div>

        <!-- 统计卡片 -->
        <div id="task-stats-cards" style="padding:16px 24px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px;">
            <!-- 动态渲染 -->
        </div>

        <!-- 标签页切换 -->
        <div style="padding:0 24px;border-bottom:1px solid #e5e7eb;display:flex;gap:0;">
            <button class="task-tab active" data-tab="running" onclick="switchTaskTab('running')">
                🔥 进行中 <span id="running-count" class="tab-badge">0</span>
            </button>
            <button class="task-tab" data-tab="stats" onclick="switchTaskTab('stats')">
                📊 统计
            </button>
        </div>

        <!-- 内容区域 -->
        <div style="flex:1;overflow-y:auto;padding:16px 24px;">
            <div id="tab-running" class="tab-content"></div>
            <div id="tab-stats" class="tab-content" style="display:none;"></div>
        </div>

        <!-- 底部跳转链接 -->
        <div style="padding:12px 24px;border-top:1px solid #e5e7eb;text-align:center;">
            <a href="/ai-operation-logs" target="_blank"
               style="color:#6366f1;font-size:13px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:4px;">
                📋 查看历史记录与详细日志 →
            </a>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    overlay.onclick = closeAITaskCenter;

    // 动画滑入
    requestAnimationFrame(() => {
        panel.style.right = '0';
        overlay.style.opacity = '1';
    });

    // 加载数据
    loadAITaskCenterData();
}

function closeAITaskCenter() {
    const panel = document.getElementById('ai-task-center-panel');
    const overlay = document.getElementById('ai-task-center-overlay');
    if (panel) {
        panel.style.right = '-600px';
        if (overlay) overlay.style.opacity = '0';
        setTimeout(() => {
            panel.remove();
            if (overlay) overlay.remove();
        }, 300);
    }
}
```

#### 5.3.2 进行中任务卡片

```javascript
function renderRunningTasks(tasks) {
    const container = document.getElementById('tab-running');
    if (tasks.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#9ca3af;">
                <div style="font-size:48px;margin-bottom:16px;">🎉</div>
                <div style="font-size:16px;font-weight:500;">暂无进行中的任务</div>
                <div style="font-size:13px;margin-top:8px;">所有AI任务都已完成</div>
            </div>
        `;
        return;
    }

    container.innerHTML = tasks.map(task => {
        const typeConfig = {
            'overview_generation': { icon: '📝', label: '概述生成', color: '#3b82f6' },
            'key_config_generation': { icon: '🔧', label: '关键配置', color: '#8b5cf6' },
            'case_generation': { icon: '🧪', label: '用例生成', color: '#10b981' },
            'report_generation': { icon: '📊', label: '报告生成', color: '#f59e0b' }
        };

        const tc = typeConfig[task.task_type] || { icon: '❓', label: '未知', color: '#6b7280' };
        const statusText = task.status === 'processing' ? '生成中...' : '排队中...';
        const isPending = task.status === 'pending';

        return `
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:12px;border-left:4px solid ${tc.color};">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:18px;">${tc.icon}</span>
                        <span style="font-size:13px;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:4px;">${tc.label}</span>
                        <span style="font-size:14px;font-weight:500;color:#1f2937;">${task.target_name || '未知目标'}</span>
                        <span style="font-size:11px;color:#9ca3af;background:#f9fafb;padding:1px 6px;border-radius:3px;">👤 ${task.username || '未知'}</span>
                    </div>
                    ${isPending ? `
                        <button onclick="cancelAITask('${task.task_id}')" 
                                style="padding:4px 10px;border:1px solid #fca5a5;border-radius:4px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:12px;">
                            取消
                        </button>
                    ` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="flex:1;height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden;">
                        <div style="width:${task.progress}%;height:100%;background:${tc.color};border-radius:4px;transition:width 0.5s ease;"></div>
                    </div>
                    <span style="font-size:12px;color:#6b7280;min-width:40px;text-align:right;">${task.progress}%</span>
                </div>
                <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-size:12px;color:#9ca3af;">
                        ${task.progress_message || statusText}
                        ${task.task_type === 'case_generation' && task.config?.stage ? ` · 阶段: ${task.config.stage}` : ''}
                    </span>
                    <span style="font-size:11px;color:#b0b8c4;">${task.model_name || ''}</span>
                </div>
            </div>
        `;
    }).join('');
}
```

### 5.4 后端API

```javascript
// routes/aiTasks.js

// 获取进行中的任务（含详细进度）
router.get('/running', authenticateToken, async (req, res) => {
  // 从适配器获取用例生成的阶段详情
  // 从适配器获取报告生成的进度详情
  // 返回字段包括：task_id, task_type, username, target_name, progress, progress_message, model_name, config
});

// 获取统计概览
router.get('/stats', authenticateToken, async (req, res) => {
  const { days } = req.query;
  // 返回：总数、处理中、排队中、已完成、失败
  // 返回：完成率、平均耗时、Token消耗趋势
  // 返回：活跃用户数、人均Token消耗
});

// 取消任务
router.post('/cancel/:taskId', authenticateToken, async (req, res) => {
  // ...
});

// 获取Token消耗统计
router.get('/token-stats', authenticateToken, async (req, res) => {
  const { days } = req.query;
  // 近N天每天的Token消耗
});

// 注：任务历史列表、筛选、分页、重试等功能不在本面板提供
//     历史记录和详细日志请使用已有的 AI操作日志页面 (/ai-operation-logs)
```

### 5.5 实时刷新机制

```javascript
// WebSocket 实时更新 + 轮询兜底
let taskCenterRefreshTimer = null;

function startTaskCenterRefresh() {
    // 方式1: WebSocket 实时推送（已有 ai_task_complete 事件）
    socket.on('ai_task_complete', (data) => {
        if (isTaskCenterOpen()) {
            loadAITaskCenterData(); // 收到任务完成事件时刷新
        }
        updateTaskBadge(); // 无论面板是否打开，都更新角标
    });

    // 方式2: 定时轮询兜底（每10秒）
    taskCenterRefreshTimer = setInterval(() => {
        if (isTaskCenterOpen()) {
            loadRunningTasks(); // 只刷新进行中的任务
        }
        updateTaskBadge();
    }, 10000);
}

function updateTaskBadge() {
    const badge = document.getElementById('ai-task-badge');
    if (!badge) return;

    apiRequest('/api/ai-tasks/stats').then(data => {
        if (data.success) {
            const runningCount = (data.data.processing || 0) + (data.data.pending || 0);
            if (runningCount > 0) {
                badge.textContent = runningCount;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    });
}
```

### 5.6 任务类型配置管理（管理员）

在配置中心的"AI任务中心"面板中，管理员可调整各类型任务的配置：

```
┌──────────────────────────────────────────────────────────────┐
│  📊 AI任务中心                                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  任务类型配置                                     [保存配置]  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 🧪 用例生成              并发数: [2▼]  超时: [300]s  │   │
│  │ 📝 概述生成              并发数: [3▼]  超时: [120]s  │   │
│  │ 🔧 关键配置              并发数: [3▼]  超时: [60]s   │   │
│  │ 📊 报告生成              并发数: [1▼]  超时: [600]s  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  自动清理策略                                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 已完成任务保留天数: [7▼]                               │   │
│  │ 失败任务保留天数:  [14▼]                               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  今日统计                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 总任务: 45  │ 完成: 38 │ 失败: 3 │ 进行中: 4         │   │
│  │ 完成率: 92.7%  │ 平均耗时: 18s  │ Token: 52,300      │   │
│  │ 活跃用户: 6人  │ 人均Token: 8,717                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  [📊 打开AI任务面板]                                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## 六、批量AI生成

### 6.1 设计目标

解决当前用户必须**逐个点击**每个测试点/用例的AI生成按钮的痛点，提供**批量复选 → 一键提交**的能力，将多个任务一次性扔进队列排队生成。

### 6.2 批量生成场景

| 场景 | 操作对象 | 生成类型 | 描述 |
|------|---------|---------|------|
| **批量生成概述** | 一级测试点 | overview_generation | 勾选多个测试点，批量AI生成概述 |
| **批量生成关键配置** | 测试用例 | key_config_generation | 勾选多个用例，批量AI生成关键配置 |

### 6.3 统一入口设计 — 折叠式批量AI生成按钮

#### 6.3.1 设计原则

符合UI第一性原理：**最小化用户认知负担**。

- 不同页面的"批量AI生成"功能统一为一个入口按钮，降低用户寻找成本
- 按钮点击后展开子菜单，按当前页面上下文自动提供可选的批量操作类型
- 用户不需要思考"我应该在哪个页面找哪个按钮"，一个入口解决所有批量AI需求

#### 6.3.2 一级测试点列表入口

**现有工具栏布局**：
```
[📋 一级测试点]                              [🔍搜索] [📂全展开] [✏️排序] [➕添加]
```

**新增后**：
```
[📋 一级测试点]                    [🤖AI生成▼] [🔍搜索] [📂全展开] [✏️排序] [➕添加]
                                       ↑ 新增
```

点击 `🤖AI生成▼` 后展开折叠菜单：

```
                         ┌─────────────────────────┐
  [🤖AI生成▼]           │  📝 批量生成概述          │
                         │  🔧 批量生成关键配置       │
                         └─────────────────────────┘
```

- **📝 批量生成概述**：点击后列表进入批量选择模式，可选择多个测试点生成概述
- **🔧 批量生成关键配置**：点击后列表进入批量选择模式，可选择多个测试点下的用例生成关键配置
  - 因为一个测试点下可能有多个用例，选择此项后会先展示该测试点下的用例列表供勾选

#### 6.3.3 用例列表入口（浮动面板中）

浮动面板空间有限，同样使用折叠式按钮，放置在工具栏中：

**现有工具栏布局**：
```
[🔍搜索] [👁批量查看] [📋批量新建] [➕新建用例] [✕关闭]
```

**新增后**：
```
[🔍搜索] [🤖AI生成▼] [👁批量查看] [📋批量新建] [➕新建用例] [✕关闭]
               ↑ 新增
```

点击 `🤖AI生成▼` 后展开折叠菜单：

```
                    ┌─────────────────────────┐
  [🤖AI生成▼]      │  🔧 批量生成关键配置       │
                    │  📝 批量生成概述           │
                    └─────────────────────────┘
```

> 注：用例列表上下文中，"批量生成关键配置"排第一位（最常用），"批量生成概述"排第二位
> （因为从用例列表也可以反向为其所属测试点生成概述）

#### 6.3.4 折叠按钮交互规范

| 交互 | 描述 |
|------|------|
| **点击按钮** | 展开/收起折叠菜单 |
| **菜单外点击** | 收起折叠菜单 |
| **Esc键** | 收起折叠菜单 |
| **选择菜单项** | 收起菜单，列表进入对应的批量选择模式 |
| **菜单项高亮** | 根据当前页面上下文，最常用的选项排在第一位 |
| **按钮状态** | 列表处于批量选择模式时，按钮保持高亮激活态 |

### 6.4 UI设计 — 批量生成概述

进入批量选择模式后，列表发生如下变化：

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│  [📋 一级测试点]          [🤖批量AI生成 ▼]   [🔍搜索]   [📂全展开]   [✏️排序]   [➕添加]      │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                 │
│  ┌─ 批量操作栏 ──────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                           │ │
│  │  ☑ 全选  │  已选 3/8 项  │                                                              │ │
│  │                                                                                           │ │
│  │  ┌────────────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  🚀 批量生成概述 (3)                                                                │  │ │
│  │  │                                                                                    │  │ │
│  │  │  已选测试点:                                                                        │  │ │
│  │  │  ┌──────────────────────────────────────────────────────────────────────────┐      │  │ │
│  │  │  │  ● 登录功能测试点  ·  概述: ✅已有 (追加/覆盖)                           │      │  │ │
│  │  │  │  ● 接口鉴权测试点  ·  概述: 🈳暂无                                      │      │  │ │
│  │  │  │  ● 数据导出测试点  ·  概述: ⚠️生成中...                                 │      │  │ │
│  │  │  └──────────────────────────────────────────────────────────────────────────┘      │  │ │
│  │  │                                                                                    │  │ │
│  │  │  概述冲突处理:                                                                       │  │ │
│  │  │  (◉) 覆盖已有概述   ( ) 追加到已有概述后面   ( ) 跳过已有概述的测试点              │  │ │
│  │  │                                                                                    │  │ │
│  │  │  预计生成: 3个概述任务 → 排队等待处理                                                │  │ │
│  │  │                                                                                    │  │ │
│  │  │  [  取消  ]                                    [  🚀 提交到队列  ]                  │  │ │
│  │  └────────────────────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                                           │ │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                 │
│  ┌──────┬──────────────────┬─────────────────────┬──────┬──────┬──────────┬──────────┐       │
│  │ ☐    │ 名称             │ 概述                │ 用例 │ 缺陷 │ 更新时间  │ 操作     │       │
│  ├──────┼──────────────────┼─────────────────────┼──────┼──────┼──────────┼──────────┤       │
│  │ ☑    │ 登录功能测试点   │ 覆盖登录模块核心... │  12  │  2   │ 05-07    │ 👁 ✏️ 🗑 │       │
│  │ ☐    │ 用户注册测试点   │ 🈳 暂无概述         │   8  │  0   │ 05-06    │ 👁 ✏️ 🗑 │       │
│  │ ☑    │ 接口鉴权测试点   │ 🈳 暂无概述         │  15  │  1   │ 05-06    │ 👁 ✏️ 🗑 │       │
│  │ ☐    │ 密码重置测试点   │ 验证密码重置流程... │   6  │  0   │ 05-05    │ 👁 ✏️ 🗑 │       │
│  │ ☑    │ 数据导出测试点   │ ⚠️ AI生成中...      │   9  │  3   │ 05-05    │ 👁 ✏️ 🗑 │       │
│  │ ☐    │ 权限管理测试点   │ 覆盖角色权限配置... │  11  │  1   │ 05-04    │ 👁 ✏️ 🗑 │       │
│  │ ☐    │ 日志审计测试点   │ 🈳 暂无概述         │   4  │  0   │ 05-04    │ 👁 ✏️ 🗑 │       │
│  │ ☐    │ 系统配置测试点   │ 覆盖系统参数配置... │   7  │  0   │ 05-03    │ 👁 ✏️ 🗑 │       │
│  └──────┴──────────────────┴─────────────────────┴──────┴──────┴──────────┴──────────┘       │
│                                                                                                 │
│  [← 上一页]  1  2  3  [下一页 →]                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**列表变化说明**：

| 元素 | 变化 |
|------|------|
| **表头** | 第一列从"编号"变为"☑全选"复选框 |
| **每行** | 第一列增加独立复选框 |
| **概述列** | 显示概述状态标签：✅已有 / 🈳暂无 / ⚠️生成中 / ❌生成失败 |
| **批量操作栏** | 新增浮层，展示已选项、冲突处理策略、提交按钮 |
| **正在生成中的行** | 复选框置灰不可选，避免重复提交 |

#### 6.3.3 概述状态标签设计

概述列的状态标签提供了清晰的信息层级，帮助用户快速决策哪些测试点需要生成：

```
┌─────────────────────────────────────────────────────────────┐
│  概述列状态标签                                               │
│                                                              │
│  ✅已有  ── 绿色调    已有AI生成或手动输入的概述              │
│            背景: #ecfdf5  文字: #065f46  边框: #a7f3d0      │
│                                                              │
│  🈳暂无  ── 灰色调    尚无任何概述内容（最需要生成的）        │
│            背景: #f8fafc  文字: #64748b  边框: #e2e8f0      │
│                                                              │
│  ⚠️生成中 ── 蓝色调    AI概述正在后台生成（不可重复提交）     │
│            背景: #eff6ff  文字: #1e40af  边框: #93c5fd      │
│            附带旋转动画图标 ⟳                                │
│                                                              │
│  ❌失败   ── 红色调    上次AI生成失败（可重新提交）           │
│            背景: #fef2f2  文字: #991b1b  边框: #fca5a5      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 6.3.4 冲突处理策略

当已选测试点中存在已有概述的项时，需提供冲突处理策略：

| 策略 | 说明 |
|------|------|
| **覆盖已有概述** | AI新生成的概述直接替换原有概述 |
| **追加到已有概述后面** | AI新概述追加在原有概述下方，用换行分隔 |
| **跳过已有概述的测试点** | 自动从已选列表中剔除已有概述的测试点，只为暂无概述的生成 |

### 6.5 UI设计 — 批量生成关键配置

#### 6.5.1 批量选择模式

从折叠菜单中选择"🔧 批量生成关键配置"后，用例列表进入批量选择模式：

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│  ┌─ 批量操作栏 ──────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                   │ │
│  │  ☑ 全选  │  已选 4/12 项  │                                                      │ │
│  │                                                                                   │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────────┐ │ │
│  │  │  🔧 批量生成关键配置 (4)                                                      │ │ │
│  │  │                                                                              │ │ │
│  │  │  已选用例:                                                                    │ │ │
│  │  │  ┌────────────────────────────────────────────────────────────────────────┐  │ │ │
│  │  │  │  ● 登录成功-正常账号     ·  关键配置: ✅已有 (追加/覆盖)              │  │ │ │
│  │  │  │  ● 登录失败-密码错误     ·  关键配置: 🈳暂无                          │  │ │ │
│  │  │  │  ● 登录失败-账号锁定     ·  关键配置: 🈳暂无                          │  │ │ │
│  │  │  │  ● 登录超时-网络异常     ·  关键配置: ✅已有 (追加/覆盖)              │  │ │ │
│  │  │  └────────────────────────────────────────────────────────────────────────┘  │ │ │
│  │  │                                                                              │ │ │
│  │  │  冲突处理:                                                                    │ │ │
│  │  │  (◉) 覆盖已有配置   ( ) 追加到已有配置后面   ( ) 跳过已有配置的用例          │ │ │
│  │  │                                                                              │ │ │
│  │  │  预计生成: 4个关键配置任务 → 排队等待处理                                      │ │ │
│  │  │                                                                              │ │ │
│  │  │  [  取消  ]                                    [  🚀 提交到队列  ]            │ │ │
│  │  └──────────────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                                   │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                         │
│  ┌──────┬──────────────────────┬──────┬──────┬──────────────┬──────────┐              │
│  │ ☐    │ 用例名称             │ 优先 │ 类型 │ 关键配置     │ 操作     │              │
│  ├──────┼──────────────────────┼──────┼──────┼──────────────┼──────────┤              │
│  │ ☑    │ 登录成功-正常账号    │  高  │ 功能 │ ✅ 已有      │ 👁 ✏️ 🗑 │              │
│  │ ☐    │ 登录成功-记住密码    │  中  │ 功能 │ 🈳 暂无      │ 👁 ✏️ 🗑 │              │
│  │ ☑    │ 登录失败-密码错误    │  高  │ 异常 │ 🈳 暂无      │ 👁 ✏️ 🗑 │              │
│  │ ☑    │ 登录失败-账号锁定    │  高  │ 异常 │ 🈳 暂无      │ 👁 ✏️ 🗑 │              │
│  │ ☐    │ 登录失败-验证码错误  │  中  │ 异常 │ ✅ 已有      │ 👁 ✏️ 🗑 │              │
│  │ ☑    │ 登录超时-网络异常    │  中  │ 异常 │ ✅ 已有      │ 👁 ✏️ 🗑 │              │
│  │ ☐    │ 密码重置-邮箱验证    │  中  │ 功能 │ 🈳 暂无      │ 👁 ✏️ 🗑 │              │
│  └──────┴──────────────────────┴──────┼──────┼──────────────┼──────────┘              │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.5 提交流程设计

#### 6.5.1 批量提交弹窗动画

用户点击"🚀 提交到队列"后，展示提交进度动画：

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│              🚀 正在提交批量任务...                                │
│                                                                  │
│     ████████████████████████████░░░░  80%  (4/5)                │
│                                                                  │
│     ✅ 登录功能测试点   → 已加入队列                              │
│     ✅ 接口鉴权测试点   → 已加入队列                              │
│     ✅ 数据导出测试点   → 已加入队列                              │
│     ⏳ 权限管理测试点   → 正在提交...                             │
│     ○  日志审计测试点   → 等待中                                 │
│                                                                  │
│                      [  后台运行  ]                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

#### 6.5.2 提交后列表状态

提交完成后，列表中对应行的概述/关键配置列自动更新为"⚠️生成中"状态：

```
│  │  ● 登录功能测试点  ·  概述: ⚠️ 生成中...   (排队 #1)     │
│  │  ● 接口鉴权测试点  ·  概述: ⚠️ 生成中...   (排队 #2)     │
│  │  ● 数据导出测试点  ·  概述: ⚠️ 生成中...   (已有任务)    │
```

### 6.6 后端API

```javascript
// 批量创建概述生成任务
router.post('/batch/overview', authenticateToken, async (req, res) => {
  const { level1PointIds, conflictStrategy } = req.body;

  if (!level1PointIds || !Array.isArray(level1PointIds) || level1PointIds.length === 0) {
    return res.status(400).json({ success: false, message: '请至少选择一个测试点' });
  }

  if (level1PointIds.length > 50) {
    return res.status(400).json({ success: false, message: '单次批量生成不超过50个测试点' });
  }

  const results = [];

  for (const pointId of level1PointIds) {
    try {
      // 检查是否有进行中的任务
      const [existing] = await pool.execute(
        `SELECT task_id FROM ai_unified_tasks 
         WHERE target_type = 'level1_point' AND target_id = ? AND task_type = 'overview_generation'
         AND status IN ('pending', 'processing') LIMIT 1`,
        [pointId]
      );

      if (existing.length > 0) {
        results.push({ pointId, success: false, message: '已有进行中的任务' });
        continue;
      }

      // 根据冲突策略处理
      if (conflictStrategy === 'skip') {
        const [points] = await pool.execute(
          'SELECT summary FROM level1_points WHERE id = ?',
          [pointId]
        );
        if (points.length > 0 && points[0].summary) {
          results.push({ pointId, success: false, message: '跳过: 已有概述' });
          continue;
        }
      }

      const appendMode = conflictStrategy === 'append';

      const task = await unifiedTaskService.createTask(
        'overview_generation',
        req.user.id,
        req.user.username,
        { type: 'level1_point', id: pointId },
        { appendMode, conflictStrategy }
      );

      results.push({ pointId, success: true, taskId: task.taskId });
    } catch (error) {
      results.push({ pointId, success: false, message: error.message });
    }
  }

  const successCount = results.filter(r => r.success).length;

  res.json({
    success: true,
    data: {
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results
    },
    message: `已提交 ${successCount} 个概述生成任务到队列`
  });
});

// 批量创建关键配置生成任务
router.post('/batch/key-config', authenticateToken, async (req, res) => {
  const { caseIds, conflictStrategy } = req.body;

  if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
    return res.status(400).json({ success: false, message: '请至少选择一个用例' });
  }

  if (caseIds.length > 50) {
    return res.status(400).json({ success: false, message: '单次批量生成不超过50个用例' });
  }

  const results = [];

  for (const caseId of caseIds) {
    try {
      const [existing] = await pool.execute(
        `SELECT task_id FROM ai_unified_tasks 
         WHERE target_type = 'test_case' AND target_id = ? AND task_type = 'key_config_generation'
         AND status IN ('pending', 'processing') LIMIT 1`,
        [caseId]
      );

      if (existing.length > 0) {
        results.push({ caseId, success: false, message: '已有进行中的任务' });
        continue;
      }

      if (conflictStrategy === 'skip') {
        const [cases] = await pool.execute(
          'SELECT key_config FROM test_cases WHERE id = ?',
          [caseId]
        );
        if (cases.length > 0 && cases[0].key_config) {
          results.push({ caseId, success: false, message: '跳过: 已有关键配置' });
          continue;
        }
      }

      const appendMode = conflictStrategy === 'append';

      // 获取用例信息作为输入数据
      const [cases] = await pool.execute(
        'SELECT name, precondition, purpose, steps, expected FROM test_cases WHERE id = ?',
        [caseId]
      );

      if (cases.length === 0) {
        results.push({ caseId, success: false, message: '用例不存在' });
        continue;
      }

      const task = await unifiedTaskService.createTask(
        'key_config_generation',
        req.user.id,
        req.user.username,
        { type: 'test_case', id: caseId, name: cases[0].name },
        { appendMode, conflictStrategy, caseInfo: cases[0] }
      );

      results.push({ caseId, success: true, taskId: task.taskId });
    } catch (error) {
      results.push({ caseId, success: false, message: error.message });
    }
  }

  const successCount = results.filter(r => r.success).length;

  res.json({
    success: true,
    data: {
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results
    },
    message: `已提交 ${successCount} 个关键配置生成任务到队列`
  });
});
```

### 6.7 前端实现

#### 6.7.1 批量选择状态管理

```javascript
class BatchSelectionManager {
  constructor() {
    this.mode = null;            // null | 'overview' | 'key_config'
    this.selectedIds = new Set();
    this.conflictStrategy = 'overwrite';  // overwrite | append | skip
  }

  enterMode(mode) {
    this.mode = mode;
    this.selectedIds.clear();
    this.conflictStrategy = 'overwrite';
    this.renderBatchUI();
    this.transformListUI();
  }

  exitMode() {
    this.mode = null;
    this.selectedIds.clear();
    this.removeBatchUI();
    this.restoreListUI();
  }

  toggleSelect(id) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.updateBatchBar();
    this.updateCheckboxUI(id);
  }

  selectAll(visibleIds) {
    visibleIds.forEach(id => this.selectedIds.add(id));
    this.updateBatchBar();
    this.updateAllCheckboxes();
  }

  deselectAll() {
    this.selectedIds.clear();
    this.updateBatchBar();
    this.updateAllCheckboxes();
  }

  getSelectedItems() {
    // 返回已选项的详细信息，包括概述/关键配置状态
  }

  async submitBatch() {
    const ids = Array.from(this.selectedIds);
    const endpoint = this.mode === 'overview'
      ? '/api/ai-tasks/batch/overview'
      : '/api/ai-tasks/batch/key-config';

    // 显示提交进度动画
    showBatchSubmitProgress(ids.length);

    try {
      const response = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          [this.mode === 'overview' ? 'level1PointIds' : 'caseIds']: ids,
          conflictStrategy: this.conflictStrategy
        })
      });

      if (response.success) {
        showSuccessMessage(response.message);
        // 更新列表中对应项的状态标签
        this.updateItemStatusAfterSubmit(response.data.results);
        // 退出批量模式
        this.exitMode();
      } else {
        showErrorMessage(response.message);
      }
    } catch (error) {
      showErrorMessage('批量提交失败: ' + error.message);
    }
  }
}

window.batchSelectionManager = new BatchSelectionManager();
```

#### 6.7.2 一级测试点列表切换批量模式

```javascript
function transformListForBatchOverview() {
    const header = document.querySelector('.level1-list-header');
    if (header) {
        // 在第一列前插入全选复选框
        const selectAllCell = document.createElement('div');
        selectAllCell.innerHTML = `
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="checkbox" id="batch-select-all-overview" 
                       onchange="handleBatchSelectAll(this.checked)"
                       style="width:16px;height:16px;accent-color:#6366f1;cursor:pointer;">
            </label>
        `;
        header.insertBefore(selectAllCell, header.firstChild);
    }

    // 为每行添加复选框，并将概述列变为状态标签
    document.querySelectorAll('.level1-list-item').forEach(item => {
        const pointId = item.dataset.pointId;
        const hasSummary = item.querySelector('.level1-summary')?.textContent?.trim();
        const isGenerating = window.batchSelectionManager.isPointGenerating(pointId);

        const checkboxCell = document.createElement('div');
        checkboxCell.style.cssText = 'display:flex;align-items:center;';
        checkboxCell.innerHTML = `
            <input type="checkbox" class="batch-item-checkbox" 
                   data-point-id="${pointId}"
                   ${isGenerating ? 'disabled' : ''}
                   onchange="window.batchSelectionManager.toggleSelect(${pointId})"
                   style="width:16px;height:16px;accent-color:#6366f1;cursor:pointer;">
        `;
        item.insertBefore(checkboxCell, item.firstChild);
    });
}
```

#### 6.7.3 快捷筛选按钮

在批量操作栏中，提供快捷筛选按钮帮助用户快速选择：

```
┌──────────────────────────────────────────────────────────────────────┐
│  ☑ 全选  │  已选 3/8 项  │  [仅选暂无概述]  [仅选生成失败]         │
└──────────────────────────────────────────────────────────────────────┘
```

- **仅选暂无概述**：快速选中所有没有概述的测试点（最常见的需求场景）
- **仅选生成失败**：快速选中上次生成失败的测试点进行重试

### 6.8 交互细节

| 交互 | 描述 |
|------|------|
| **进入批量模式** | 点击"🤖AI生成▼"折叠按钮，选择子菜单项后进入对应批量选择模式 |
| **退出批量模式** | 点击批量操作栏的"取消"按钮，或按 Esc 键，或点击列表外部区域 |
| **单选** | 点击行首复选框，选中/取消选中该项 |
| **全选** | 点击表头全选复选框，选中/取消选中当前页所有项 |
| **快捷筛选** | 点击"仅选暂无概述"/"仅选生成失败"，快速选中对应状态的项 |
| **冲突策略** | 在批量操作栏中选择覆盖/追加/跳过 |
| **提交** | 点击"🚀 提交到队列"，展示提交进度动画，完成后更新列表状态 |
| **正在生成的项** | 复选框置灰不可选，防止重复提交 |
| **批量上限** | 单次批量生成不超过50项，超出时提示分批操作 |
| **Toast通知** | 提交成功后显示"已提交 N 个任务到队列" |
| **按钮角标** | 批量AI生成按钮始终可见，无批量模式时作为入口，有批量模式时高亮 |

## 七、改造优先级与计划

### 7.1 第一阶段：核心改造（优先级：高）

1. **创建统一任务表和配置表**
   - 执行SQL创建表结构
   - 插入默认配置数据

2. **实现统一任务服务**
   - 开发 UnifiedTaskService
   - 开发 BaseTaskHandler

3. **改造概述生成功能**
   - 开发 OverviewGenerationHandler
   - 修改前端调用逻辑
   - 集成到统一任务管理器

### 7.2 第二阶段：扩展改造（优先级：中）

1. **改造关键配置生成功能**
   - 开发 KeyConfigGenerationHandler
   - 修改前端调用逻辑

2. **迁移测试用例生成**
   - 开发 CaseGenerationAdapter
   - 在 taskScheduler 中增加状态同步钩子
   - 数据迁移脚本

3. **迁移测试报告生成**
   - 开发 ReportGenerationAdapter
   - 在 reports.js 中增加状态同步钩子
   - 数据迁移脚本

### 7.3 第三阶段：增强功能（优先级：中）

1. **批量AI生成**
   - 一级测试点列表批量生成概述
   - 测试用例列表批量生成关键配置
   - 批量选择模式 + 快捷筛选 + 冲突处理策略
   - 批量提交API + 进度动画

2. **任务监控面板**
   - 顶部导航栏AI任务按钮（含角标）
   - 配置中心AI任务中心菜单项
   - AI生成页面"查看全部任务"链接
   - 侧滑面板（进行中任务、历史记录、统计图表）

3. **任务类型配置管理**
   - 管理员可调整并发数、超时时间
   - 自动清理策略配置

## 八、实施建议

### 8.1 兼容性策略

1. **渐进式迁移**：不一次性替换所有功能，逐步迁移
2. **API兼容层**：保留旧API，内部转发到新系统
3. **适配器模式**：用例生成和报告生成通过适配器同步状态，不直接迁移子表
4. **数据迁移**：提供数据迁移脚本，将旧任务数据迁移到新表

### 8.2 回滚方案

1. **保留旧代码**：在Git中创建分支保留旧实现
2. **配置开关**：通过环境变量控制使用新旧系统
3. **监控告警**：设置任务失败告警，及时发现问题
4. **适配器开关**：适配器同步可通过配置关闭，不影响旧系统运行

### 8.3 性能优化

1. **数据库索引**：为常用查询字段创建索引
2. **连接池配置**：优化数据库连接池大小
3. **队列监控**：监控队列长度，动态调整并发数
4. **轮询优化**：任务监控面板进行中任务10秒轮询，历史任务手动刷新

## 九、总结

通过统一任务调度系统的建设，可以：

1. ✅ **解决排队问题**：所有AI生成任务统一排队，避免并发冲突
2. ✅ **提升用户体验**：支持多任务并行，实时状态反馈，每个按钮独立管理
3. ✅ **降低维护成本**：统一架构，减少重复代码
4. ✅ **增强可观测性**：集中监控所有AI任务，任务监控面板一目了然
5. ✅ **提高系统稳定性**：完善的错误处理和恢复机制
6. ✅ **平滑迁移**：适配器模式保证用例生成和报告生成的平滑迁移，不影响现有功能
7. ✅ **批量生成提效**：批量复选 + 一键提交，告别逐个点击的低效操作

建议优先实施第一阶段，快速解决概述生成和关键配置生成的排队问题。
