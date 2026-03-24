const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');

/**
 * GET /api/notifications/unread
 * 获取当前用户的未读通知数量
 */
router.get('/unread', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [result] = await pool.execute(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [userId]
    );
    
    res.json({
      success: true,
      count: result[0].count
    });
  } catch (error) {
    console.error('获取未读通知数量失败:', error);
    res.json({ success: false, count: 0, message: '获取失败' });
  }
});

/**
 * GET /api/notifications/list
 * 获取当前用户的通知列表
 */
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('[通知API] 获取通知列表, 用户ID:', userId);
    
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;
    
    // 使用模板字符串直接拼接 LIMIT 和 OFFSET，避免 mysql2 预处理语句的类型问题
    // parseInt 已经确保了安全性，不会有 SQL 注入风险
    const limitValue = parseInt(pageSize);
    const offsetValue = parseInt(offset);
    
    const [notifications] = await pool.execute(`
      SELECT 
        n.id,
        n.title,
        COALESCE(n.content, n.content_preview) as content,
        n.content_preview,
        n.type,
        n.target_id,
        n.is_read,
        n.created_at,
        n.data,
        n.sender_id,
        u.username as sender_name
      FROM notifications n
      LEFT JOIN users u ON n.sender_id = u.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT ${limitValue} OFFSET ${offsetValue}
    `, [userId]);
    
    console.log('[通知API] 查询到通知数量:', notifications.length);
    
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?',
      [userId]
    );
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parseInt(pageSize));
    
    res.json({
      success: true,
      notifications: notifications.map(n => ({
        ...n,
        data: n.data ? (typeof n.data === 'string' ? JSON.parse(n.data) : n.data) : null
      })),
      pagination: {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        total: total,
        totalPages: totalPages
      }
    });
  } catch (error) {
    console.error('[通知API] 获取通知列表失败:', error);
    res.json({ success: false, notifications: [], message: '获取失败: ' + error.message });
  }
});

/**
 * POST /api/notifications/mark-read/:id
 * 标记通知为已读
 */
router.post('/mark-read/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    await pool.execute(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    
    res.json({ success: true, message: '已标记为已读' });
  } catch (error) {
    console.error('标记已读失败:', error);
    res.json({ success: false, message: '操作失败' });
  }
});

/**
 * POST /api/notifications/mark-all-read
 * 标记所有通知为已读
 */
router.post('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    await pool.execute(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND is_read = FALSE',
      [userId]
    );
    
    res.json({ success: true, message: '已全部标记为已读' });
  } catch (error) {
    console.error('标记全部已读失败:', error);
    res.json({ success: false, message: '操作失败' });
  }
});

/**
 * DELETE /api/notifications/:id
 * 删除通知
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    await pool.execute(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除通知失败:', error);
    res.json({ success: false, message: '删除失败' });
  }
});

/**
 * POST /api/notifications/create
 * 创建通知（仅管理员可调用）
 * 安全说明: 此接口仅限管理员使用，防止普通用户伪造系统通知
 */
router.post('/create', authenticateToken, async (req, res) => {
  try {
    // 安全检查：只有管理员可以创建系统通知
    const userRole = req.user.role;
    if (userRole !== 'admin' && userRole !== '管理员' && userRole !== 'Administrator') {
      return res.status(403).json({ 
        success: false, 
        message: '权限不足：只有管理员可以创建系统通知' 
      });
    }
    
    const { userId, title, content, type = 'system', data = null } = req.body;
    
    // 参数验证
    if (!userId || !title || !content) {
      return res.status(400).json({ 
        success: false, 
        message: '参数不完整：userId, title, content 为必填项' 
      });
    }
    
    const [result] = await pool.execute(`
      INSERT INTO notifications (user_id, sender_id, title, content, type, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [userId, req.user.id, title, content, type, data ? JSON.stringify(data) : null]);
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    console.error('创建通知失败:', error);
    res.json({ success: false, message: '创建失败' });
  }
});

module.exports = router;
