const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');
const onlineUsersManager = require('../onlineUsersManager');
const logger = require('../services/logger');

// 创建操作日志表（如果不存在）
async function ensureActivityLogTable() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        username VARCHAR(50) NOT NULL,
        role VARCHAR(20) NOT NULL,
        action VARCHAR(100) NOT NULL,
        description TEXT,
        entity_type VARCHAR(50),
        entity_id INT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_created_at (created_at),
        INDEX idx_action (action)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    logger.info('操作日志表检查完成');
  } catch (error) {
    logger.error('创建操作日志表失败:', { error: error.message });
  }
}

// 启动时确保表存在
ensureActivityLogTable();

// 记录操作日志的辅助函数
async function logActivity(userId, username, role, action, description, entityType = null, entityId = null, ipAddress = null, userAgent = null) {
  try {
    await pool.execute(
      `INSERT INTO activity_logs (user_id, username, role, action, description, entity_type, entity_id, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, username, role, action, description, entityType, entityId, ipAddress, userAgent]
    );
    return true;
  } catch (error) {
    logger.error('记录操作日志失败:', { error: error.message });
    return false;
  }
}

// 获取最近活动记录
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const [logs] = await pool.execute(
      `SELECT 
        id, 
        user_id, 
        username, 
        role, 
        action, 
        description, 
        entity_type, 
        entity_id, 
        ip_address, 
        created_at 
       FROM activity_logs 
       ORDER BY created_at DESC 
       LIMIT ${limit}`
    );
    
    // 获取当前在线用户列表
    const onlineUsernames = onlineUsersManager.getOnlineUsernames();
    
    res.json({
      success: true,
      history: logs.map(log => {
        // 根据用户是否在在线列表中判断状态
        const isOnline = onlineUsernames.includes(log.username);
        
        return {
          id: log.id,
          userId: log.user_id,
          username: log.username,
          role: log.role,
          action: log.action,
          description: log.description,
          entityType: log.entity_type,
          entityId: log.entity_id,
          ipAddress: log.ip_address,
          timestamp: log.created_at,
          time: log.created_at,
          status: isOnline ? '在线' : '离线'
        };
      })
    });
  } catch (error) {
    logger.error('获取活动记录错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误', history: [] });
  }
});

// 添加操作日志
router.post('/add', authenticateToken, async (req, res) => {
  const { action, description, entityType, entityId } = req.body;
  const userId = req.user.id;
  const username = req.user.username;
  const role = req.user.role;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');

  try {
    await logActivity(userId, username, role, action, description, entityType, entityId, ipAddress, userAgent);
    res.json({ success: true, message: '操作日志记录成功' });
  } catch (error) {
    logger.error('添加操作日志错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取在线用户列表
router.get('/online-users', authenticateToken, async (req, res) => {
  try {
    const onlineUsernames = onlineUsersManager.getOnlineUsernames();
    const allOnlineUsers = onlineUsersManager.getAllOnlineUsers();
    res.json({
      success: true,
      onlineUsernames: onlineUsernames,
      onlineUsers: allOnlineUsers
    });
  } catch (error) {
    logger.error('获取在线用户错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 导出日志记录函数供其他模块使用
module.exports = {
  router,
  logActivity
};
