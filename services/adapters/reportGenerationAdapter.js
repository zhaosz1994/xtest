const pool = require('../../db');
const logger = require('../logger');

class ReportGenerationAdapter {
  constructor() {
    this.taskType = 'report_generation';
  }

  async syncToUnifiedTask(jobId) {
    try {
      const [jobs] = await pool.execute(
        'SELECT * FROM report_jobs WHERE id = ?',
        [jobId]
      );

      if (jobs.length === 0) return null;

      const job = jobs[0];
      const config = typeof job.config === 'string' ? JSON.parse(job.config) : (job.config || {});

      const statusMapping = {
        'pending': 'pending',
        'processing': 'processing',
        'completed': 'completed',
        'failed': 'failed',
        'cancelled': 'cancelled'
      };

      const unifiedStatus = statusMapping[job.status] || 'pending';

      const unifiedTaskId = `rpt_${job.id.startsWith('job_') ? job.id.substring(4) : job.id}`;

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
          (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') ? job.updated_at : null,
          job.created_at
        ]
      );

      return { unifiedTaskId, unifiedStatus };
    } catch (error) {
      logger.error('同步报告生成任务状态失败', { error: error.message, jobId });
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
      if (!config || !config.jobId) return null;

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
    } catch (error) {
      logger.error('获取报告生成详细进度失败', { error: error.message, unifiedTaskId });
      return null;
    }
  }
}

module.exports = new ReportGenerationAdapter();
