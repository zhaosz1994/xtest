const pool = require('../db');
const logger = require('./logger');

class AIRequestLogger {
  constructor() {
    this.buffer = [];
    this.flushInterval = 5000;
    this.flushThreshold = 50;
    this.bufferHardCap = 200;
    this.MAX_RECORDS = 1000;
    this.cleanInterval = 3600000;
    this._flushing = false;
    this.flushTimer = this._startFlushTimer();
    this.cleanTimer = this._startCleanTimer();
  }

  async log(data) {
    if (!data.userId) {
      logger.warn('AI请求日志缺少userId，跳过记录', { triggerType: data.triggerType });
      return;
    }

    let username = data.username || null;
    if (!username && data.userId) {
      try {
        const [users] = await pool.execute(
          'SELECT username FROM users WHERE id = ?',
          [data.userId]
        );
        if (users.length > 0) {
          username = users[0].username;
        }
      } catch (error) {
        logger.warn('查询用户名失败', { userId: data.userId, error: error.message });
      }
    }

    const logEntry = {
      user_id: data.userId,
      username: username,
      trigger_type: data.triggerType,
      trigger_source: data.triggerSource || null,
      trigger_source_name: data.triggerSourceName || null,
      system_prompt: data.systemPrompt || null,
      user_prompt: data.userPrompt || null,
      ai_response: data.aiResponse || null,
      prompt_tokens: data.promptTokens || 0,
      completion_tokens: data.completionTokens || 0,
      total_tokens: data.totalTokens || 0,
      model_name: data.modelName || null,
      status: data.status || 'success',
      error_message: data.errorMessage || null,
      execution_time_ms: data.executionTimeMs || null,
      project_id: data.projectId || null,
      library_id: data.libraryId || null,
      module_id: data.moduleId || null,
      ip_address: data.ipAddress || null,
      created_at: new Date()
    };

    if (this.buffer.length >= this.bufferHardCap) {
      logger.warn('AI请求日志缓冲区已满，丢弃最旧的日志', {
        bufferSize: this.buffer.length,
        maxBufferSize: this.bufferHardCap
      });
      this.buffer.shift();
    }

    this.buffer.push(logEntry);

    if (this.buffer.length >= this.flushThreshold) {
      const flushResult = await this.flush();
      if (flushResult) {
        logger.info('AI请求日志', {
          userId: data.userId,
          triggerType: data.triggerType,
          triggerSource: data.triggerSource,
          status: data.status,
          totalTokens: data.totalTokens,
          executionTimeMs: data.executionTimeMs
        });
      } else {
        logger.warn('AI请求日志暂存（flush失败，数据在缓冲区中）', {
          userId: data.userId,
          triggerType: data.triggerType,
          bufferSize: this.buffer.length
        });
      }
    } else {
      logger.info('AI请求日志', {
        userId: data.userId,
        triggerType: data.triggerType,
        triggerSource: data.triggerSource,
        status: data.status,
        totalTokens: data.totalTokens,
        executionTimeMs: data.executionTimeMs
      });
    }
  }

  async flush() {
    if (this.buffer.length === 0 || this._flushing) return true;
    this._flushing = true;

    const logsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      const values = logsToFlush.map(log => [
        log.user_id,
        log.username,
        log.trigger_type,
        log.trigger_source,
        log.trigger_source_name,
        log.system_prompt,
        log.user_prompt,
        log.ai_response,
        log.prompt_tokens,
        log.completion_tokens,
        log.total_tokens,
        log.model_name,
        log.status,
        log.error_message,
        log.execution_time_ms,
        log.project_id,
        log.library_id,
        log.module_id,
        log.ip_address,
        log.created_at
      ]);

      await pool.query(`
        INSERT INTO ai_request_logs (
          user_id, username, trigger_type, trigger_source, trigger_source_name,
          system_prompt, user_prompt, ai_response,
          prompt_tokens, completion_tokens, total_tokens, model_name,
          status, error_message, execution_time_ms,
          project_id, library_id, module_id, ip_address, created_at
        ) VALUES ?
      `, [values]);

      logger.debug('AI请求日志已刷新', { count: logsToFlush.length });
      return true;

    } catch (error) {
      logger.error('AI请求日志刷新失败', {
        error: error.message,
        logCount: logsToFlush.length
      });

      this.buffer.unshift(...logsToFlush);
      return false;
    } finally {
      this._flushing = false;
    }
  }

  _startFlushTimer() {
    return setInterval(async () => {
      try {
        await this.flush();
      } catch (error) {
        logger.error('定时刷新AI请求日志失败', { error: error.message });
      }
    }, this.flushInterval);
  }

  _startCleanTimer() {
    return setInterval(async () => {
      try {
        await this.cleanOldRecords();
      } catch (error) {
        logger.error('AI请求日志滚动清理失败', { error: error.message });
      }
    }, this.cleanInterval);
  }

  async cleanOldRecords() {
    try {
      const [countResult] = await pool.execute(
        'SELECT COUNT(*) AS cnt FROM ai_request_logs'
      );
      const count = countResult[0].cnt;

      if (count > this.MAX_RECORDS) {
        await pool.execute(`
          DELETE FROM ai_request_logs 
          WHERE id NOT IN (
            SELECT id FROM (
              SELECT id FROM ai_request_logs 
              ORDER BY created_at DESC, id DESC
              LIMIT ?
            ) AS keep_ids
          )
        `, [this.MAX_RECORDS]);
        logger.info('AI请求日志滚动清理完成', {
          beforeCount: count,
          maxRecords: this.MAX_RECORDS
        });
      }
    } catch (error) {
      logger.error('AI请求日志滚动清理失败', { error: error.message });
    }
  }

  async logSuccess(data) {
    return await this.log({ ...data, status: 'success' });
  }

  async logFailure(data) {
    return await this.log({ ...data, status: 'failed' });
  }

  destroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.cleanTimer) clearInterval(this.cleanTimer);
  }
}

const aiRequestLogger = new AIRequestLogger();

let isShuttingDown = false;
function handleShutdownSignal() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const timeout = setTimeout(() => {
    logger.warn('AI请求日志flush超时，强制退出');
    process.exit(1);
  }, 5000);

  aiRequestLogger.flush().then(() => {
    clearTimeout(timeout);
    logger.info('AI请求日志已安全flush');
  }).catch((err) => {
    clearTimeout(timeout);
    logger.error('AI请求日志flush失败', { error: err.message });
  });
}

process.on('SIGINT', handleShutdownSignal);
process.on('SIGTERM', handleShutdownSignal);

module.exports = aiRequestLogger;
