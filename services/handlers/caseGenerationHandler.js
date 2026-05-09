const BaseTaskHandler = require('./baseTaskHandler');
const logger = require('../logger');

class CaseGenerationHandler extends BaseTaskHandler {
  constructor() {
    super('case_generation');
  }

  async execute(task) {
    const caseGeneratorService = require('../caseGeneratorService');
    const dedupService = require('../dedupService');
    const level1PointService = require('../level1PointService');
    const caseGenerationAdapter = require('../adapters/caseGenerationAdapter');
    const pool = require('../../db');

    const taskId = task.task_id;
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});

    if (config.level1Mode === 'auto') {
      await level1PointService.generateLevel1Points(taskId, task.target_id);
    }

    const mapResult = await caseGeneratorService.executeMapPhase(taskId);

    if (mapResult.skipped) {
      return { status: 'completed', message: '任务已在运行中' };
    }

    const taskAfterMap = await caseGeneratorService.getTaskStatus(taskId);
    if (taskAfterMap && taskAfterMap.status === 'cancelled') {
      return { status: 'completed', message: '任务已取消' };
    }

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

      logger.info('用例生成部分完成(handler)', { taskId, completedChunks: mapResult.completedChunks, failedChunks: mapResult.failedChunks });
      return { status: 'partial_completed', message: '用例生成部分完成' };
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

      logger.info('用例生成完成(handler)', { taskId });
      return { status: 'completed', message: '用例生成完成' };
    }
  }
}

module.exports = new CaseGenerationHandler();
