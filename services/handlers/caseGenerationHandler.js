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

    await caseGeneratorService.executeMapPhase(taskId);

    const taskAfterMap = await caseGeneratorService.getTaskStatus(taskId);
    if (taskAfterMap && taskAfterMap.status === 'cancelled') {
      return '任务已取消';
    }

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

    logger.info('用例生成完成(handler)', { taskId });

    return '用例生成完成';
  }
}

module.exports = new CaseGenerationHandler();
