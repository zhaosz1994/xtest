const pool = require('../db');
const { default: PQueue } = require('p-queue');
const cron = require('node-cron');

class TaskScheduler {
  constructor() {
    this.taskQueue = new PQueue({ concurrency: parseInt(process.env.TASK_PROCESSING_CONCURRENCY) || 2 });
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.recoverInterruptedTasks();

    cron.schedule('*/30 * * * * *', () => {
      this.pollAndProcess();
    });

    cron.schedule('0 * * * *', () => {
      this.cleanupExpiredTempCases();
    });

    console.log('AI用例生成任务调度器已启动');
  }

  async recoverInterruptedTasks() {
    try {
      const [result] = await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET status = 'pending', 
            progress_message = '任务恢复中...'
        WHERE status = 'processing'
      `);

      if (result.affectedRows > 0) {
        console.log(`已恢复 ${result.affectedRows} 个中断的任务`);
      }
    } catch (error) {
      console.error('恢复中断任务失败:', error.message);
    }
  }

  async pollAndProcess() {
    if (this.taskQueue.pending >= this.taskQueue.concurrency) {
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
      console.error('任务轮询失败:', error.message);
    } finally {
      connection.release();
    }
  }

  async processTask(taskId) {
    console.log(`开始处理任务: ${taskId}`);
    const caseGeneratorService = require('./caseGeneratorService');
    const dedupService = require('./dedupService');
    const level1PointService = require('./level1PointService');
    const emailNotificationService = require('./emailNotificationService');

    try {
      const task = await caseGeneratorService.getTaskStatus(taskId);
      if (!task || task.status === 'cancelled') return;

      const config = task.config ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) : {};

      if (config.level1Mode === 'auto') {
        await level1PointService.generateLevel1Points(taskId, task.module_id);
      }

      await caseGeneratorService.executeMapPhase(taskId);

      const taskAfterMap = await caseGeneratorService.getTaskStatus(taskId);
      if (taskAfterMap && taskAfterMap.status === 'cancelled') return;

      await dedupService.executeReducePhase(taskId);

      if (config.level1Mode === 'auto') {
        await level1PointService.assignLevel1ToCases(taskId);
      } else if (config.selectedLevel1Ids && config.selectedLevel1Ids.length > 0) {
        await level1PointService.assignExistingLevel1ToCases(taskId, config.selectedLevel1Ids[0]);
      }

      await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET status = 'completed', 
            stage = 'finished',
            progress = 100,
            progress_message = '任务完成',
            completed_at = NOW()
        WHERE task_id = ?
      `, [taskId]);

      try {
        await emailNotificationService.sendAIGenerationCompletionNotification(taskId);
      } catch (emailError) {
        console.error('发送邮件通知失败:', emailError.message);
      }

      console.log(`任务完成: ${taskId}`);

    } catch (error) {
      console.error(`任务失败: ${taskId}`, error.message);

      await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET status = 'failed', 
            error_message = ?,
            error_stack = ?,
            progress_message = '任务失败'
        WHERE task_id = ?
      `, [error.message, error.stack, taskId]);
    }
  }

  async cancelTask(taskId, userId) {
    const caseGeneratorService = require('./caseGeneratorService');
    return caseGeneratorService.cancelTask(taskId, userId);
  }

  async cleanupExpiredTempCases() {
    try {
      const [result] = await pool.execute(`
        DELETE FROM temp_test_cases
        WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND status = 'pending'
          AND review_status = 'none'
      `);

      if (result.affectedRows > 0) {
        console.log(`清理了 ${result.affectedRows} 条过期临时用例`);
      }
    } catch (error) {
      console.error('清理过期临时用例失败:', error.message);
    }
  }
}

const taskScheduler = new TaskScheduler();

module.exports = taskScheduler;
