const mysql = require('mysql2');
require('dotenv').config();
const logger = require('./services/logger');

const aiDBConfig = {
  user: process.env.AI_DB_USER || 'ai_readonly',
  password: process.env.AI_DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 200,
  queueLimit: 1000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
  connectTimeout: 30000,
  timezone: '+08:00'
};

if (process.env.DB_SOCKET) {
  aiDBConfig.socketPath = process.env.DB_SOCKET;
} else {
  aiDBConfig.host = process.env.DB_HOST || '127.0.0.1';
}

const aiReadOnlyPool = mysql.createPool(aiDBConfig);

aiReadOnlyPool.on('acquire', (connection) => {
  logger.debug(`AI只读连接池: 连接已获取 - ${connection.threadId}`);
});

aiReadOnlyPool.on('enqueue', () => {
  logger.debug('AI只读连接池: 连接排队中');
});

aiReadOnlyPool.on('release', (connection) => {
  logger.debug(`AI只读连接池: 连接已释放 - ${connection.threadId}`);
});

aiReadOnlyPool.on('error', (error) => {
  logger.error('AI只读连接池错误', { error: error.message });
});

setInterval(() => {
  const poolStatus = aiReadOnlyPool._stat;
  if (poolStatus) {
    const activeConnections = poolStatus.active || 0;
    const waitingConnections = poolStatus.waiting || 0;
    const totalConnections = poolStatus.total || 0;
    
    if (activeConnections > 0 || waitingConnections > 0) {
      logger.debug('AI只读连接池状态', { 
        active: activeConnections, 
        waiting: waitingConnections, 
        total: totalConnections 
      });
      
      if (waitingConnections > 50) {
        logger.warn('AI只读连接池压力较大', { waitingConnections });
      }
    }
  }
}, 60000);

module.exports = aiReadOnlyPool.promise();
