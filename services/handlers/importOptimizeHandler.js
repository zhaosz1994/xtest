const BaseTaskHandler = require('./baseTaskHandler');
const logger = require('../logger');

class ImportOptimizeHandler extends BaseTaskHandler {
  constructor() {
    super('import_optimize');
  }

  async execute(task) {
    const importOptimizeService = require('../importOptimizeService');
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});

    const originalTaskId = config.originalTaskId || task.task_id;

    await importOptimizeService.processTask(originalTaskId);

    logger.info('导入优化完成(handler)', { taskId: task.task_id, originalTaskId });

    return '导入优化完成';
  }
}

module.exports = new ImportOptimizeHandler();
