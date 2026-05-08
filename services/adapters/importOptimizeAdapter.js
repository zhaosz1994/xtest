const pool = require('../../db');
const logger = require('../logger');

class ImportOptimizeAdapter {
  constructor() {
    this.taskType = 'import_optimize';
  }

  async syncToUnifiedTask(originalTaskId) {
    try {
      const [origTasks] = await pool.execute(
        'SELECT * FROM ai_import_optimize_tasks WHERE task_id = ?',
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

      const progress = orig.progress || 0;
      const progressMessage = orig.progress_message || '';

      const unifiedTaskId = `impopt_${orig.task_id.replace(/^IMP-OPT-/, '').replace(/-/g, '_')}`;

      await pool.execute(
        `INSERT INTO ai_unified_tasks
         (task_id, task_type, user_id, username, target_type, target_id, target_name,
          status, progress, progress_message, config, started_at, completed_at, created_at)
         VALUES (?, ?, ?, ?, 'library', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           progress = VALUES(progress),
           progress_message = VALUES(progress_message),
           started_at = VALUES(started_at),
           completed_at = VALUES(completed_at)`,
        [
          unifiedTaskId, this.taskType, orig.user_id, orig.username,
          orig.library_id, orig.source_file_name || 'AI导入优化', unifiedStatus, progress,
          progressMessage,
          JSON.stringify({ originalTaskTable: true, originalTaskId: orig.task_id, agentCode: orig.agent_code }),
          orig.started_at, (orig.status === 'completed' || orig.status === 'failed' || orig.status === 'cancelled') ? (orig.completed_at || orig.updated_at) : null,
          orig.created_at
        ]
      );

      return { unifiedTaskId, unifiedStatus };
    } catch (error) {
      logger.error('同步导入优化任务状态失败', { error: error.message, originalTaskId });
      return null;
    }
  }

  async getDetailedProgress(unifiedTaskId) {
    try {
      const [tasks] = await pool.execute(
        'SELECT config FROM ai_unified_tasks WHERE task_id = ?',
        [unifiedTaskId]
      );

      if (tasks.length === 0) return null;

      const config = typeof tasks[0].config === 'string' ? JSON.parse(tasks[0].config) : tasks[0].config;
      if (!config || !config.originalTaskId) return null;

      const [origTasks] = await pool.execute(
        'SELECT * FROM ai_import_optimize_tasks WHERE task_id = ?',
        [config.originalTaskId]
      );

      if (origTasks.length === 0) return null;

      return {
        originalTaskId: origTasks[0].task_id,
        totalCases: origTasks[0].total_cases,
        totalBatches: origTasks[0].total_batches,
        message: origTasks[0].progress_message
      };
    } catch (error) {
      logger.error('获取导入优化详细进度失败', { error: error.message, unifiedTaskId });
      return null;
    }
  }
}

module.exports = new ImportOptimizeAdapter();
