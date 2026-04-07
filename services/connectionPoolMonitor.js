const aiReadOnlyPool = require('../db-ai-readonly');
const logger = require('./logger');

class ConnectionPoolMonitor {
  constructor() {
    this.metrics = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      averageExecutionTime: 0,
      maxExecutionTime: 0,
      minExecutionTime: Infinity,
      slowQueries: []
    };
    
    this.alerts = {
      highWaitingConnections: 50,
      highActiveConnections: 150,
      slowQueryThreshold: 5000
    };
    
    this.startMonitoring();
  }

  startMonitoring() {
    setInterval(() => {
      this.collectMetrics();
    }, 30000);
    
    setInterval(() => {
      this.generateReport();
    }, 300000);
  }

  collectMetrics() {
    try {
      const poolStatus = aiReadOnlyPool._stat;
      
      if (!poolStatus) return;
      
      const activeConnections = poolStatus.active || 0;
      const waitingConnections = poolStatus.waiting || 0;
      const totalConnections = poolStatus.total || 0;
      
      const status = {
        active: activeConnections,
        waiting: waitingConnections,
        total: totalConnections,
        timestamp: new Date()
      };
      
      if (waitingConnections > this.alerts.highWaitingConnections) {
        logger.warn('AI连接池等待连接数过高', status);
        this.sendAlert('high_waiting_connections', status);
      }
      
      if (activeConnections > this.alerts.highActiveConnections) {
        logger.warn('AI连接池活跃连接数过高', status);
        this.sendAlert('high_active_connections', status);
      }
      
      logger.debug('AI连接池状态', status);
      
    } catch (error) {
      logger.error('收集连接池指标失败', { error: error.message });
    }
  }

  recordQuery(executionTime, success) {
    this.metrics.totalQueries++;
    
    if (success) {
      this.metrics.successfulQueries++;
    } else {
      this.metrics.failedQueries++;
    }
    
    if (executionTime > this.metrics.maxExecutionTime) {
      this.metrics.maxExecutionTime = executionTime;
    }
    
    if (executionTime < this.metrics.minExecutionTime) {
      this.metrics.minExecutionTime = executionTime;
    }
    
    const totalTime = this.metrics.averageExecutionTime * (this.metrics.totalQueries - 1) + executionTime;
    this.metrics.averageExecutionTime = totalTime / this.metrics.totalQueries;
    
    if (executionTime > this.alerts.slowQueryThreshold) {
      this.metrics.slowQueries.push({
        executionTime,
        timestamp: new Date()
      });
      
      if (this.metrics.slowQueries.length > 100) {
        this.metrics.slowQueries.shift();
      }
    }
  }

  generateReport() {
    const report = {
      timestamp: new Date(),
      metrics: {
        ...this.metrics,
        successRate: this.metrics.totalQueries > 0 
          ? (this.metrics.successfulQueries / this.metrics.totalQueries * 100).toFixed(2) + '%'
          : '0%',
        failureRate: this.metrics.totalQueries > 0 
          ? (this.metrics.failedQueries / this.metrics.totalQueries * 100).toFixed(2) + '%'
          : '0%'
      },
      poolStatus: this.getPoolStatus()
    };
    
    logger.info('AI连接池性能报告', report);
    
    return report;
  }

  getPoolStatus() {
    const poolStatus = aiReadOnlyPool._stat;
    
    if (!poolStatus) {
      return null;
    }
    
    return {
      active: poolStatus.active || 0,
      waiting: poolStatus.waiting || 0,
      total: poolStatus.total || 0
    };
  }

  sendAlert(alertType, data) {
    logger.warn(`AI连接池告警: ${alertType}`, data);
  }

  getMetrics() {
    return {
      ...this.metrics,
      poolStatus: this.getPoolStatus()
    };
  }

  resetMetrics() {
    this.metrics = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      averageExecutionTime: 0,
      maxExecutionTime: 0,
      minExecutionTime: Infinity,
      slowQueries: []
    };
    
    logger.info('AI连接池指标已重置');
  }
}

const connectionPoolMonitor = new ConnectionPoolMonitor();

module.exports = connectionPoolMonitor;
