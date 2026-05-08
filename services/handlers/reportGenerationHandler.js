const BaseTaskHandler = require('./baseTaskHandler');
const logger = require('../logger');

class ReportGenerationHandler extends BaseTaskHandler {
  constructor() {
    super('report_generation');
  }

  async execute(task) {
    logger.info('报告生成处理器(占位)，报告生成由独立的reports路由异步处理', { taskId: task.task_id });

    return '报告生成由独立系统处理';
  }
}

module.exports = new ReportGenerationHandler();
