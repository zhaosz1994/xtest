const pool = require('../db');
const logger = require('./logger');

class AgentToolUsageLogger {
  constructor() {
    this.buffer = [];
    this.flushInterval = 5000;
    this.maxBufferSize = 100;
    this.startFlushTimer();
  }

  async log(data) {
    const logEntry = {
      user_id: data.userId,
      username: data.username || null,
      item_type: data.itemType,
      item_code: data.itemCode,
      item_name: data.itemName || null,
      source: data.source || null,
      execution_time_ms: data.executionTimeMs || null,
      prompt_tokens: data.promptTokens || 0,
      completion_tokens: data.completionTokens || 0,
      total_tokens: data.totalTokens || 0,
      model_name: data.modelName || null,
      status: data.status || 'success',
      error_message: data.errorMessage || null,
      context_info: data.contextInfo ? JSON.stringify(data.contextInfo) : null,
      created_at: new Date()
    };

    this.buffer.push(logEntry);

    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }

    logger.info('Agent/Tool使用日志', {
      itemType: data.itemType,
      itemCode: data.itemCode,
      userId: data.userId,
      status: data.status,
      executionTimeMs: data.executionTimeMs
    });
  }

  async flush() {
    if (this.buffer.length === 0) return;

    const logsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      const values = logsToFlush.map(log => [
        log.user_id,
        log.username,
        log.item_type,
        log.item_code,
        log.item_name,
        log.source,
        log.execution_time_ms,
        log.prompt_tokens,
        log.completion_tokens,
        log.total_tokens,
        log.model_name,
        log.status,
        log.error_message,
        log.context_info,
        log.created_at
      ]);

      await pool.query(`
        INSERT INTO ai_agent_tool_usage_logs (
          user_id, username, item_type, item_code, item_name,
          source, execution_time_ms,
          prompt_tokens, completion_tokens, total_tokens, model_name,
          status, error_message, context_info, created_at
        ) VALUES ?
      `, [values]);

      logger.debug('Agent/Tool使用日志已刷新', { count: logsToFlush.length });

    } catch (error) {
      logger.error('Agent/Tool使用日志刷新失败', {
        error: error.message,
        logCount: logsToFlush.length
      });

      this.buffer.unshift(...logsToFlush);
    }
  }

  startFlushTimer() {
    setInterval(async () => {
      try {
        await this.flush();
      } catch (error) {
        logger.error('定时刷新Agent/Tool使用日志失败', { error: error.message });
      }
    }, this.flushInterval);
  }

  async logSuccess(data) {
    return await this.log({ ...data, status: 'success' });
  }

  async logFailure(data) {
    return await this.log({ ...data, status: 'failed' });
  }
}

const agentToolUsageLogger = new AgentToolUsageLogger();

process.on('beforeExit', async () => {
  await agentToolUsageLogger.flush();
});

process.on('SIGINT', async () => {
  await agentToolUsageLogger.flush();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await agentToolUsageLogger.flush();
  process.exit(0);
});

module.exports = agentToolUsageLogger;
