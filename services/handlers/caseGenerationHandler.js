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
    const pool = require('../../db');

    const taskId = task.task_id;
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});

    if (config.chunkingStrategy && config.chunkingStrategy !== 'structure_aware') {
      await this._rechunkWithStrategy(task, config);
    }

    let globalContext = '';
    let allValidLevel1 = [];

    if (config.level1Mode === 'auto') {
      const existingLevel1 = await level1PointService.getExistingLevel1Points(task.target_id);

      const skeletonResult = await level1PointService.executeGlobalAwareness(taskId, task.target_id, existingLevel1);

      allValidLevel1 = skeletonResult.allValidLevel1 || existingLevel1;

      if (!skeletonResult.success && allValidLevel1.length === 0) {
        await pool.execute(`
          UPDATE ai_case_generation_tasks 
          SET status = 'failed', 
              stage = 'finished',
              error_message = '一级测试点骨架生成失败，且模块无已有测试点，无法继续',
              completed_at = NOW()
          WHERE task_id = ?
        `, [taskId]);

        logger.error('骨架生成失败且无已有测试点，任务终止', { taskId });
        return { status: 'failed', message: '骨架生成失败，无可用测试点' };
      }

      globalContext = skeletonResult.globalContext || '';

      logger.info('全局感知阶段结果', {
        taskId,
        globalContextLength: globalContext.length,
        level1Count: allValidLevel1.length,
        skeletonSuccess: skeletonResult.success
      });
    } else if (config.selectedLevel1Ids && config.selectedLevel1Ids.length > 0) {
      const existingLevel1 = await level1PointService.getExistingLevel1Points(task.target_id);
      allValidLevel1 = existingLevel1.filter(p => config.selectedLevel1Ids.includes(p.id));
      globalContext = '';
    } else if (config.level1Mode !== 'auto') {
      globalContext = '';
    }

    const mapResult = await caseGeneratorService.executeMapPhase(taskId, { globalContext, allValidLevel1 });

    if (mapResult.skipped) {
      return { status: 'completed', message: '任务已在运行中' };
    }

    const taskAfterMap = await caseGeneratorService.getTaskStatus(taskId);
    if (taskAfterMap && taskAfterMap.status === 'cancelled') {
      return { status: 'completed', message: '任务已取消' };
    }

    const hasFailedChunks = mapResult.failedChunks > 0;

    await dedupService.executeReducePhase(taskId);

    if (config.level1Mode === 'auto' && allValidLevel1.length > 0) {
      await level1PointService.validateLevel1Assignments(taskId, allValidLevel1);
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

  async _rechunkWithStrategy(task, config) {
    const fileParserService = require('../fileParserService');
    const pool = require('../../db');

    const selectedFiles = typeof task.selected_files === 'string'
      ? JSON.parse(task.selected_files || '[]')
      : (task.selected_files || []);

    let sql = `SELECT id FROM module_knowledge_files WHERE module_id = ? AND deleted_at IS NULL`;
    const params = [task.target_id];
    if (selectedFiles.length > 0) {
      const placeholders = selectedFiles.map(() => '?').join(',');
      sql += ` AND id IN (${placeholders})`;
      params.push(...selectedFiles);
    }

    const [files] = await pool.execute(sql, params);

    logger.info('使用新切分策略重新切分文件', {
      taskId: task.task_id,
      strategy: config.chunkingStrategy,
      fileCount: files.length
    });

    for (const file of files) {
      try {
        await fileParserService.reparseFile(file.id, {
          chunkingStrategy: config.chunkingStrategy,
          userId: task.user_id || null
        });
      } catch (error) {
        logger.warn('重新切分文件失败，跳过', {
          fileId: file.id,
          error: error.message
        });
      }
    }
  }
}

module.exports = new CaseGenerationHandler();
