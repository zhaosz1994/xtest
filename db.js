const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 50, // 增加连接池大小以支持1000+用户
  queueLimit: 100, // 限制等待队列大小
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000, // 30秒
  connectTimeout: 10000, // 连接超时10秒
  acquireTimeout: 30000, // 获取连接超时30秒
  timezone: '+08:00' // 设置时区为中国时区
});

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