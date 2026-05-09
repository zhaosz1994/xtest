const pool = require('../db');
const { default: PQueue } = require('p-queue');
const cron = require('node-cron');
const logger = require('./logger');
const unifiedTaskService = require('./unifiedTaskService');
const caseGenerationAdapter = require('./adapters/caseGenerationAdapter');
const reportGenerationAdapter = require('./adapters/reportGenerationAdapter');
const importOptimizeAdapter = require('./adapters/importOptimizeAdapter');
const importOptimizeService = require('./importOptimizeService');

class TaskScheduler {
  constructor() {
    this.taskQueue = new PQueue({ concurrency: parseInt(process.env.TASK_PROCESSING_CONCURRENCY) || 2 });
    this.overviewQueue = new PQueue({ concurrency: 3 });
    this.keyConfigQueue = new PQueue({ concurrency: 3 });
    this.importOptimizeQueue = new PQueue({ concurrency: 2 });
    this.isRunning = false;
    this.cronJobs = [];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.recoverInterruptedTasks();
    this.recoverInterruptedOverviewTasks();
    this.recoverInterruptedImportOptimizeTasks();

    this.cronJobs.push(cron.schedule('*/30 * * * * *', () => {
      this.pollAndProcess();
    }));

    this.cronJobs.push(cron.schedule('*/10 * * * * *', () => {
      this.pollAndProcessOverviewTasks();
    }));

    this.cronJobs.push(cron.schedule('*/10 * * * * *', () => {
      this.pollAndProcessKeyConfigTasks();
    }));

    this.cronJobs.push(cron.schedule('*/15 * * * * *', () => {
      this.pollAndProcessImportOptimizeTasks();
    }));

    this.cronJobs.push(cron.schedule('*/30 * * * * *', () => {
      this.syncLegacyTasksToUnified();
    }));

    this.cronJobs.push(cron.schedule('0 * * * *', () => {
      this.cleanupExpiredTempCases();
    }));

    this.cronJobs.push(cron.schedule('0 2 * * *', () => {
      this.cleanupCompletedTasks();
      this.cleanupCompletedUnifiedTasks();
    }));

    logger.info('AI用例生成任务调度器已启动');
  }

  stop() {
    this.cronJobs.forEach(job => job.stop());
    this.cronJobs = [];
    this.isRunning = false;
    logger.info('AI用例生成任务调度器已停止');
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
        logger.info('已恢复中断的任务', { count: result.affectedRows });
      }
    } catch (error) {
      logger.error('恢复中断任务失败', { error: error.message });
    }
  }

  async recoverInterruptedOverviewTasks() {
    try {
      await unifiedTaskService.recoverInterruptedTasks(['overview_generation', 'key_config_generation', 'case_generation', 'report_generation', 'import_optimize']);
    } catch (error) {
      logger.error('恢复中断概述/关键配置任务失败', { error: error.message });
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

      this.taskQueue.add(() => this.processTask(taskId)).catch(err => {
        logger.error('用例生成任务队列执行异常', { taskId, error: err.message });
      });

    } catch (error) {
      await connection.rollback();
      logger.error('任务轮询失败', { error: error.message });
    } finally {
      connection.release();
    }
  }

  async pollAndProcessOverviewTasks() {
    if (this.overviewQueue.pending >= this.overviewQueue.concurrency) {
      return;
    }

    try {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [tasks] = await connection.execute(`
          SELECT task_id FROM ai_unified_tasks
          WHERE status = 'pending' AND task_type = 'overview_generation'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

        if (tasks.length === 0) {
          await connection.rollback();
          return;
        }

        const taskId = tasks[0].task_id;

        await connection.execute(
          `UPDATE ai_unified_tasks SET status = 'processing', started_at = NOW(), progress_message = '任务开始处理...' WHERE task_id = ?`,
          [taskId]
        );

        await connection.commit();

        this.overviewQueue.add(() => this.processUnifiedTask(taskId)).catch(err => {
          logger.error('概述任务队列执行异常', { taskId, error: err.message });
        });
      } catch (error) {
        await connection.rollback();
        logger.error('概述任务轮询失败', { error: error.message });
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error('概述任务轮询获取连接失败', { error: error.message });
    }
  }

  async pollAndProcessKeyConfigTasks() {
    if (this.keyConfigQueue.pending >= this.keyConfigQueue.concurrency) {
      return;
    }

    try {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [tasks] = await connection.execute(`
          SELECT task_id FROM ai_unified_tasks
          WHERE status = 'pending' AND task_type = 'key_config_generation'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

        if (tasks.length === 0) {
          await connection.rollback();
          return;
        }

        const taskId = tasks[0].task_id;

        await connection.execute(
          `UPDATE ai_unified_tasks SET status = 'processing', started_at = NOW(), progress_message = '任务开始处理...' WHERE task_id = ?`,
          [taskId]
        );

        await connection.commit();

        this.keyConfigQueue.add(() => this.processUnifiedTask(taskId)).catch(err => {
          logger.error('关键配置任务队列执行异常', { taskId, error: err.message });
        });
      } catch (error) {
        await connection.rollback();
        logger.error('关键配置任务轮询失败', { error: error.message });
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error('关键配置任务轮询获取连接失败', { error: error.message });
    }
  }

  async processUnifiedTask(taskId) {
    logger.info('开始处理统一任务', { taskId });
    try {
      await unifiedTaskService.executeTask(taskId);
    } catch (error) {
      logger.error('统一任务处理失败', { taskId, error: error.message });
    }
  }

  async processTask(taskId) {
    logger.info('开始处理任务', { taskId });
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

      const mapResult = await caseGeneratorService.executeMapPhase(taskId);

      if (mapResult.skipped) {
        logger.warn('Map阶段被跳过，任务可能已在运行中', { taskId });
        return;
      }

      const taskAfterMap = await caseGeneratorService.getTaskStatus(taskId);
      if (taskAfterMap && taskAfterMap.status === 'cancelled') return;

      const hasFailedChunks = mapResult.failedChunks > 0;

      await dedupService.executeReducePhase(taskId);

      if (config.level1Mode === 'auto') {
        await level1PointService.assignLevel1ToCases(taskId);
      } else if (config.selectedLevel1Ids && config.selectedLevel1Ids.length > 0) {
        await level1PointService.assignExistingLevel1ToCases(taskId, config.selectedLevel1Ids[0]);
      }

      if (hasFailedChunks) {
        const [countResult] = await pool.execute(`
          SELECT COUNT(*) as total FROM temp_test_cases WHERE task_id = ?
        `, [taskId]);
        const totalCases = countResult[0].total;

        await pool.execute(`
          UPDATE ai_case_generation_tasks 
          SET status = 'partial_completed', 
              stage = 'finished',
              progress = 100,
              progress_message = ?,
              total_cases = ?,
              completed_at = NOW()
          WHERE task_id = ?
        `, [`任务部分完成：成功${mapResult.completedChunks}块，失败${mapResult.failedChunks}块，生成${totalCases}条用例`, totalCases, taskId]);
      } else {
        const [countResult] = await pool.execute(`
          SELECT COUNT(*) as total FROM temp_test_cases WHERE task_id = ?
        `, [taskId]);
        const totalCases = countResult[0].total;

        await pool.execute(`
          UPDATE ai_case_generation_tasks 
          SET status = 'completed', 
              stage = 'finished',
              progress = 100,
              progress_message = '任务完成',
              total_cases = ?,
              completed_at = NOW()
          WHERE task_id = ?
        `, [totalCases, taskId]);
      }

      try {
        await caseGenerationAdapter.syncToUnifiedTask(taskId);
      } catch (syncError) {
        logger.error('同步用例生成任务状态到统一任务表失败', { error: syncError.message, taskId });
      }

      try {
        await emailNotificationService.sendAIGenerationCompletionNotification(taskId);
      } catch (emailError) {
        logger.error('发送邮件通知失败', { error: emailError.message });
      }

      logger.info('任务完成', { taskId, status: hasFailedChunks ? 'partial_completed' : 'completed' });

    } catch (error) {
      const errorMsg = error.message || error.toString() || '未知错误（error对象为空）';
      const errorStack = error.stack || new Error().stack;
      logger.error('任务失败', { taskId, error: errorMsg, stack: errorStack });

      await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET status = 'failed', 
            error_message = ?,
            error_stack = ?,
            progress_message = ?
        WHERE task_id = ?
      `, [errorMsg, errorStack, `任务失败: ${errorMsg}`, taskId]);

      try {
        await caseGenerationAdapter.syncToUnifiedTask(taskId);
      } catch (syncError) {
        logger.error('同步失败任务状态到统一任务表失败', { error: syncError.message, taskId });
      }
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
        logger.info('清理了过期临时用例', { count: result.affectedRows });
      }
    } catch (error) {
      logger.error('清理过期临时用例失败', { error: error.message });
    }
  }

  async cleanupCompletedTasks() {
    try {
      const [tasks] = await pool.execute(`
        SELECT t.task_id
        FROM ai_case_generation_tasks t
        LEFT JOIN temp_test_cases tc ON t.task_id = tc.task_id AND tc.status != 'merged'
        LEFT JOIN temp_level1_points tl ON t.task_id = tl.task_id AND tl.status != 'merged'
        WHERE t.status IN ('completed', 'partial_completed')
          AND t.completed_at < DATE_SUB(NOW(), INTERVAL 3 DAY)
          AND tc.id IS NULL
          AND tl.id IS NULL
      `);

      if (tasks.length === 0) {
        return;
      }

      const taskIds = tasks.map(t => t.task_id);
      const placeholders = taskIds.map(() => '?').join(',');
      
      const [result] = await pool.execute(`
        DELETE FROM ai_case_generation_tasks 
        WHERE task_id IN (${placeholders})
      `, taskIds);

      if (result.affectedRows > 0) {
        logger.info('清理了已完成的任务', { count: result.affectedRows, taskIds });
      }
    } catch (error) {
      logger.error('清理已完成任务失败', { error: error.message });
    }
  }

  async cleanupCompletedUnifiedTasks() {
    try {
      await unifiedTaskService.cleanupCompletedTasks(7);
    } catch (error) {
      logger.error('清理统一任务失败', { error: error.message });
    }
  }

  async syncLegacyTasksToUnified() {
    try {
      const [processingCases] = await pool.execute(
        `SELECT task_id FROM ai_case_generation_tasks WHERE status IN ('pending', 'processing') LIMIT 50`
      );
      for (const row of processingCases) {
        try {
          await caseGenerationAdapter.syncToUnifiedTask(row.task_id);
        } catch (e) {
          // ignore individual sync errors
        }
      }
    } catch (error) {
      logger.error('同步用例生成任务进度到统一任务表失败', { error: error.message });
    }

    try {
      const [processingReports] = await pool.execute(
        `SELECT id FROM report_jobs WHERE status IN ('pending', 'processing') LIMIT 50`
      );
      for (const row of processingReports) {
        try {
          await reportGenerationAdapter.syncToUnifiedTask(row.id);
        } catch (e) {
          // ignore individual sync errors
        }
      }
    } catch (error) {
      logger.error('同步报告生成任务进度到统一任务表失败', { error: error.message });
    }

    try {
      const [processingImports] = await pool.execute(
        `SELECT task_id FROM ai_import_optimize_tasks WHERE status IN ('pending', 'processing') LIMIT 50`
      );
      for (const row of processingImports) {
        try {
          await importOptimizeAdapter.syncToUnifiedTask(row.task_id);
        } catch (e) {
          // ignore individual sync errors
        }
      }
    } catch (error) {
      logger.error('同步导入优化任务进度到统一任务表失败', { error: error.message });
    }
  }

  async recoverInterruptedImportOptimizeTasks() {
    try {
      await importOptimizeService.recoverInterruptedTasks();
    } catch (error) {
      logger.error('恢复中断的导入优化任务失败', { error: error.message });
    }
  }

  async pollAndProcessImportOptimizeTasks() {
    if (this.importOptimizeQueue.pending >= this.importOptimizeQueue.concurrency) {
      return;
    }

    try {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const [tasks] = await connection.execute(`
          SELECT task_id FROM ai_import_optimize_tasks
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

        await connection.execute(
          `UPDATE ai_import_optimize_tasks SET status = 'processing', started_at = NOW(), progress_message = '任务开始处理...' WHERE task_id = ?`,
          [taskId]
        );

        await connection.commit();

        this.importOptimizeQueue.add(() => importOptimizeService.processTask(taskId)).catch(err => {
          logger.error('导入优化任务队列执行异常', { taskId, error: err.message });
        });
      } catch (error) {
        await connection.rollback();
        logger.error('导入优化任务轮询失败', { error: error.message });
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error('导入优化任务轮询获取连接失败', { error: error.message });
    }
  }
}

const taskScheduler = new TaskScheduler();

module.exports = taskScheduler;
