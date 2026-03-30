const mysql = require('mysql2');
require('dotenv').config();

// 基础配置
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 200,
  queueLimit: 500,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
  connectTimeout: 10000,
  timezone: '+08:00'
};

// 动态判断：如果环境变量里配了 Socket 就优先用 Socket，否则用 Host
if (process.env.DB_SOCKET) {
  dbConfig.socketPath = process.env.DB_SOCKET;
} else {
  dbConfig.host = process.env.DB_HOST || '127.0.0.1'; // 默认回退到本地 host
}

const pool = mysql.createPool(dbConfig);

// 添加连接池状态监控
setInterval(() => {
  const poolStatus = pool._stat;
  if (poolStatus) {
    const activeConnections = poolStatus.active || 0;
    const waitingConnections = poolStatus.waiting || 0;
    const totalConnections = poolStatus.total || 0;
    
    // 只在有活动连接时记录
    if (activeConnections > 0 || waitingConnections > 0) {
      console.log(`数据库连接池状态: 活跃=${activeConnections}, 等待=${waitingConnections}, 总计=${totalConnections}`);
      
      // 如果等待连接数过多，发出警告
      if (waitingConnections > 10) {
        console.warn(`⚠️ 数据库连接池压力较大，等待连接数: ${waitingConnections}`);
      }
    }
  }
}, 60000); // 每分钟记录一次

module.exports = pool.promise();