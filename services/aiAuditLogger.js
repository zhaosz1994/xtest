const pool = require('../db');
const logger = require('./logger');

class AIAuditLogger {
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
      skill_name: data.skillName,
      skill_id: data.skillId || null,
      operation_type: data.operationType || 'SELECT',
      sql_query: data.sqlQuery || null,
      sql_params: data.sqlParams ? JSON.stringify(data.sqlParams) : null,
      tables_accessed: data.tablesAccessed ? data.tablesAccessed.join(',') : null,
      result_count: data.resultCount || 0,
      execution_time_ms: data.executionTimeMs || null,
      prompt_tokens: data.promptTokens || 0,
      completion_tokens: data.completionTokens || 0,
      total_tokens: data.totalTokens || 0,
      model_name: data.modelName || null,
      status: data.status || 'success',
      error_message: data.errorMessage || null,
      ip_address: data.ipAddress || null,
      user_agent: data.userAgent || null,
      created_at: new Date()
    };
    
    this.buffer.push(logEntry);
    
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
    
    logger.info('AI操作日志', {
      userId: data.userId,
      skillName: data.skillName,
      status: data.status,
      executionTime: data.executionTimeMs,
      totalTokens: data.totalTokens
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
        log.skill_name,
        log.skill_id,
        log.operation_type,
        log.sql_query,
        log.sql_params,
        log.tables_accessed,
        log.result_count,
        log.execution_time_ms,
        log.prompt_tokens,
        log.completion_tokens,
        log.total_tokens,
        log.model_name,
        log.status,
        log.error_message,
        log.ip_address,
        log.user_agent,
        log.created_at
      ]);
      
      await pool.query(`
        INSERT INTO ai_operation_logs (
          user_id, username, skill_name, skill_id, operation_type,
          sql_query, sql_params, tables_accessed, result_count,
          execution_time_ms, prompt_tokens, completion_tokens, total_tokens, model_name,
          status, error_message, ip_address, user_agent, created_at
        ) VALUES ?
      `, [values]);
      
      logger.debug('AI审计日志已刷新', { count: logsToFlush.length });
      
    } catch (error) {
      logger.error('AI审计日志刷新失败', { 
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
        logger.error('定时刷新AI审计日志失败', { error: error.message });
      }
    }, this.flushInterval);
  }

  async logSuccess(data) {
    return await this.log({
      ...data,
      status: 'success'
    });
  }

  async logFailure(data) {
    return await this.log({
      ...data,
      status: 'failed'
    });
  }

  async getRecentLogs(limit = 100) {
    try {
      const [logs] = await pool.execute(`
        SELECT * FROM ai_operation_logs 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [limit]);
      
      return logs;
    } catch (error) {
      logger.error('获取AI审计日志失败', { error: error.message });
      return [];
    }
  }

  async getUserLogs(userId, limit = 100) {
    try {
      const [logs] = await pool.execute(`
        SELECT * FROM ai_operation_logs 
        WHERE user_id = ?
        ORDER BY created_at DESC 
        LIMIT ?
      `, [userId, limit]);
      
      return logs;
    } catch (error) {
      logger.error('获取用户AI审计日志失败', { userId, error: error.message });
      return [];
    }
  }

  async getSkillUsageStats(days = 30) {
    try {
      const [stats] = await pool.execute(`
        SELECT 
          skill_name,
          COUNT(*) as total_calls,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          AVG(execution_time_ms) as avg_execution_time,
          MAX(execution_time_ms) as max_execution_time,
          MIN(execution_time_ms) as min_execution_time
        FROM ai_operation_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY skill_name
        ORDER BY total_calls DESC
      `, [days]);
      
      return stats;
    } catch (error) {
      logger.error('获取AI技能使用统计失败', { error: error.message });
      return [];
    }
  }

  async getUserUsageStats(days = 30) {
    try {
      const [stats] = await pool.execute(`
        SELECT 
          user_id,
          username,
          COUNT(*) as total_calls,
          COUNT(DISTINCT skill_name) as unique_skills_used,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
        FROM ai_operation_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY user_id, username
        ORDER BY total_calls DESC
      `, [days]);
      
      return stats;
    } catch (error) {
      logger.error('获取用户AI使用统计失败', { error: error.message });
      return [];
    }
  }

  async getFailedOperations(limit = 100) {
    try {
      const [logs] = await pool.execute(`
        SELECT * FROM ai_operation_logs 
        WHERE status = 'failed'
        ORDER BY created_at DESC 
        LIMIT ?
      `, [limit]);
      
      return logs;
    } catch (error) {
      logger.error('获取失败的AI操作失败', { error: error.message });
      return [];
    }
  }
}

const aiAuditLogger = new AIAuditLogger();

process.on('beforeExit', async () => {
  await aiAuditLogger.flush();
});

process.on('SIGINT', async () => {
  await aiAuditLogger.flush();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await aiAuditLogger.flush();
  process.exit(0);
});

module.exports = aiAuditLogger;
