const pool = require('../db');
const logger = require('./logger');
const aiAuditLogger = require('./aiAuditLogger');

class UnifiedTaskService {
  constructor() {
    this.taskHandlers = new Map();
    this.registerTaskHandlers();
  }

  registerTaskHandlers() {
    try {
      this.taskHandlers.set('overview_generation', require('./handlers/overviewGenerationHandler'));
      this.taskHandlers.set('key_config_generation', require('./handlers/keyConfigGenerationHandler'));
    } catch (error) {
      logger.error('注册任务处理器失败', { error: error.message });
    }
  }

  async createTask(taskType, userId, username, targetInfo, config = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 在事务内检查是否存在进行中的同目标任务，防止TOCTOU竞态条件
      if (targetInfo.type && targetInfo.id) {
        const [existing] = await connection.execute(
          `SELECT task_id, status FROM ai_unified_tasks
           WHERE target_type = ? AND target_id = ? AND task_type = ? AND status IN ('pending', 'processing')
           LIMIT 1 FOR UPDATE`,
          [targetInfo.type, targetInfo.id, taskType]
        );
        if (existing.length > 0) {
          await connection.rollback();
          const err = new Error('该目标已有进行中的任务');
          err.code = 'DUPLICATE_TASK';
          err.existingTaskId = existing[0].task_id;
          err.existingStatus = existing[0].status;
          throw err;
        }
      }

      const taskId = this.generateTaskId(taskType);

      const [result] = await connection.execute(
        `INSERT INTO ai_unified_tasks
         (task_id, task_type, user_id, username, target_type, target_id, target_name, config, input_data, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [taskId, taskType, userId, username,
         targetInfo.type || null, targetInfo.id || null, targetInfo.name || null,
         JSON.stringify(config),
         config.inputData ? JSON.stringify(config.inputData) : null]
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

  async getTaskByTarget(targetType, targetId, taskType, statuses = ['pending', 'processing']) {
    const placeholders = statuses.map(() => '?').join(',');
    const [tasks] = await pool.execute(
      `SELECT * FROM ai_unified_tasks
       WHERE target_type = ? AND target_id = ? AND task_type = ? AND status IN (${placeholders})
       LIMIT 1`,
      [targetType, targetId, taskType, ...statuses]
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
      const validStatuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
      const statuses = filters.status.split(',').filter(s => validStatuses.includes(s.trim()));
      if (statuses.length > 0) {
        const placeholders = statuses.map(() => '?').join(',');
        sql += ` AND status IN (${placeholders})`;
        params.push(...statuses);
      }
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(parseInt(filters.limit) || 20, 100), Math.max(parseInt(filters.offset) || 0, 0));

    const [tasks] = await pool.execute(sql, params);
    return tasks;
  }

  async executeTask(taskId) {
    const task = await this.getTaskStatus(taskId);
    if (!task) {
      logger.warn('任务不存在，跳过执行', { taskId });
      return;
    }
    if (task.status === 'cancelled') {
      logger.info('任务已取消，跳过执行', { taskId });
      return;
    }
    if (task.status === 'completed') {
      logger.warn('任务已完成，跳过重复执行', { taskId });
      return;
    }
    if (task.status === 'processing') {
      // 调度器已将状态设为processing，这是正常流程，继续执行
      // 但如果直接调用executeTask（非通过调度器），需要防止重复执行
      logger.info('任务正在处理中，继续执行', { taskId });
    }
    // 如果状态是pending，说明是直接调用（非调度器流程），需要先更新状态

    const handler = this.taskHandlers.get(task.task_type);
    if (!handler) {
      throw new Error(`未找到任务处理器: ${task.task_type}`);
    }

    try {
      // 仅当任务状态为pending时才更新为processing（调度器已处理的则跳过）
      if (task.status === 'pending') {
        await this.updateTaskStatus(taskId, 'processing', 0, '任务开始处理');
      }

      const result = await handler.execute(task);

      await this.updateTaskStatus(taskId, 'completed', 100, '任务完成', result);

      this.notifyTaskComplete(task, result, true);

      return result;

    } catch (error) {
      try {
        await this.updateTaskStatus(taskId, 'failed', 0, error.message, null, error.message, error.stack);
      } catch (updateError) {
        logger.error('更新任务失败状态时出错', { taskId, updateError: updateError.message });
      }

      this.notifyTaskComplete(task, null, false, error.message);

      throw error;
    }
  }

  async updateTaskStatus(taskId, status, progress, message, result = null, error = null, errorStack = null) {
    try {
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
    } catch (dbError) {
      logger.error('更新任务状态失败', { taskId, status, error: dbError.message });
      throw dbError;
    }
  }

  async updateTaskProgress(taskId, progress, message) {
    await pool.execute(
      'UPDATE ai_unified_tasks SET progress = ?, progress_message = ?, updated_at = NOW() WHERE task_id = ?',
      [progress, message, taskId]
    );
  }

  async updateTaskTokens(taskId, tokenInfo) {
    await pool.execute(
      `UPDATE ai_unified_tasks SET model_name = ?, prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, updated_at = NOW() WHERE task_id = ?`,
      [tokenInfo.modelName || null, tokenInfo.promptTokens || 0, tokenInfo.completionTokens || 0, tokenInfo.totalTokens || 0, taskId]
    );
  }

  notifyTaskComplete(task, result, success, errorMessage = null) {
    if (global.io) {
      let config = {};
      try {
        config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});
      } catch (e) {
        logger.error('解析任务配置失败', { taskId: task.task_id, error: e.message });
      }

      const emitData = {
        taskId: task.task_id,
        taskType: task.task_type,
        targetType: task.target_type,
        targetId: task.target_id,
        targetName: task.target_name,
        result: result,
        success: success,
        errorMessage: errorMessage,
        timestamp: Date.now()
      };

      if (task.task_type === 'overview_generation') {
        emitData.appendMode = !!config.appendMode;
        emitData.level1PointId = task.target_id;
        emitData.pointName = task.target_name;
      }

      if (task.task_type === 'key_config_generation') {
        emitData.appendMode = !!config.appendMode;
        emitData.caseId = task.target_id;
        emitData.caseName = task.target_name;
      }

      global.io.to(`user_${task.user_id}`).emit('ai_task_complete', emitData);
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

  async getRunningTasks(userId) {
    const [tasks] = await pool.execute(
      `SELECT * FROM ai_unified_tasks
       WHERE user_id = ? AND status IN ('pending', 'processing')
       ORDER BY created_at ASC`,
      [userId]
    );
    return tasks;
  }

  async getAllRunningTasks() {
    const [tasks] = await pool.execute(
      `SELECT * FROM ai_unified_tasks
       WHERE status IN ('pending', 'processing')
       ORDER BY created_at ASC`
    );
    return tasks;
  }

  async getStats(days = 7) {
    const [statsResult] = await pool.execute(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
       FROM ai_unified_tasks
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );

    const [tokenStats] = await pool.execute(
      `SELECT
         SUM(total_tokens) as totalTokens,
         COUNT(DISTINCT user_id) as activeUsers
       FROM ai_unified_tasks
       WHERE status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );

    const [avgTime] = await pool.execute(
      `SELECT AVG(TIMESTAMPDIFF(SECOND, started_at, completed_at)) as avgDuration
       FROM ai_unified_tasks
       WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );

    const stats = statsResult[0] || {};
    const tokens = tokenStats[0] || {};
    const duration = avgTime[0] || {};

    const totalCompleted = stats.completed || 0;
    const totalFailed = stats.failed || 0;
    const completionRate = (totalCompleted + totalFailed) > 0
      ? ((totalCompleted / (totalCompleted + totalFailed)) * 100).toFixed(1)
      : '0.0';

    return {
      total: stats.total || 0,
      processing: stats.processing || 0,
      pending: stats.pending || 0,
      completed: totalCompleted,
      failed: totalFailed,
      cancelled: stats.cancelled || 0,
      completionRate,
      avgDuration: Math.round(duration.avgDuration || 0),
      totalTokens: tokens.totalTokens || 0,
      activeUsers: tokens.activeUsers || 0
    };
  }

  async getTokenStats(days = 7) {
    const [dailyStats] = await pool.execute(
      `SELECT
         DATE(created_at) as date,
         SUM(prompt_tokens) as promptTokens,
         SUM(completion_tokens) as completionTokens,
         SUM(total_tokens) as totalTokens,
         COUNT(*) as taskCount,
         COUNT(DISTINCT user_id) as userCount
       FROM ai_unified_tasks
       WHERE status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [days]
    );

    return dailyStats;
  }

  async cleanupCompletedTasks(retentionDays = 7) {
    try {
      const [result] = await pool.execute(
        `DELETE FROM ai_unified_tasks
         WHERE status IN ('completed', 'failed', 'cancelled')
           AND completed_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [retentionDays]
      );

      if (result.affectedRows > 0) {
        logger.info('清理了已完成的统一任务', { count: result.affectedRows });
      }
      return result.affectedRows;
    } catch (error) {
      logger.error('清理统一任务失败', { error: error.message });
      return 0;
    }
  }

  async recoverInterruptedTasks(taskTypes = ['overview_generation', 'key_config_generation']) {
    try {
      const placeholders = taskTypes.map(() => '?').join(',');
      const [result] = await pool.execute(
        `UPDATE ai_unified_tasks
         SET status = 'pending', progress = 0, progress_message = '任务恢复中...'
         WHERE status = 'processing' AND task_type IN (${placeholders})`,
        taskTypes
      );

      if (result.affectedRows > 0) {
        logger.info('已恢复中断的统一任务', { count: result.affectedRows });
      }
      return result.affectedRows;
    } catch (error) {
      logger.error('恢复中断统一任务失败', { error: error.message });
      return 0;
    }
  }
}

module.exports = new UnifiedTaskService();
