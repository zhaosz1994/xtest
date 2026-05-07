const pool = require('../../db');
const logger = require('../logger');

class CaseGenerationAdapter {
  constructor() {
    this.taskType = 'case_generation';
  }

  async syncToUnifiedTask(originalTaskId) {
    try {
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

      const [moduleName] = await pool.execute(
        'SELECT name FROM modules WHERE id = ?',
        [orig.module_id]
      ).catch(() => [[{ name: null }]]);

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
          orig.module_id, moduleName[0]?.name || null, unifiedStatus, orig.progress,
          orig.progress_message,
          JSON.stringify({ originalTaskTable: true, stage: orig.stage }),
          orig.started_at, orig.completed_at, orig.created_at
        ]
      );

      return unifiedStatus;
    } catch (error) {
      logger.error('同步用例生成任务状态失败', { error: error.message, originalTaskId });
      return null;
    }
  }

  async getDetailedProgress(taskId) {
    try {
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
    } catch (error) {
      logger.error('获取用例生成详细进度失败', { error: error.message, taskId });
      return null;
    }
  }
}

module.exports = new CaseGenerationAdapter();
