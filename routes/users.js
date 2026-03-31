const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');
const { logActivity } = require('./history');
require('dotenv').config();

// 登录
router.post('/login', async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');

  try {
    const [users] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const user = users[0];
    
    // 检查用户状态
    if (user.status === 'pending') {
      return res.status(403).json({ success: false, message: '账号正在等待管理员审核' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ success: false, message: '账号已被禁用' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    // 根据记住我设置不同的Token有效期
    // 不勾选: 24小时，勾选: 7天
    const tokenExpiresIn = rememberMe ? '7d' : '24h';
    
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: tokenExpiresIn }
    );

    // 记录登录日志
    await logActivity(user.id, user.username, user.role, '用户登录', `用户 ${user.username} 登录系统${rememberMe ? '' : ''}`, 'user', user.id, ipAddress, userAgent);

    res.json({ 
      success: true,
      token, 
      user: { id: user.id, username: user.username, role: user.role, email: user.email },
      expiresIn: tokenExpiresIn
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// Token 刷新接口
router.post('/refresh-token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // 从数据库获取最新的用户信息
    const [users] = await pool.execute(
      'SELECT id, username, role, email FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const user = users[0];
    
    // 生成新的 token（默认24小时有效期）
    const newToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      token: newToken,
      user: { id: user.id, username: user.username, role: user.role, email: user.email },
      expiresIn: '24h'
    });
  } catch (error) {
    console.error('Token刷新错误:', error);
    res.status(500).json({ success: false, message: 'Token刷新失败' });
  }
});

// 注册
router.post('/register', async (req, res) => {
  const { username, password, email } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');

  try {
    // 检查用户名是否已存在
    const [existingUsers] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 检查邮箱是否已存在
    const [existingEmails] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (existingEmails.length > 0) {
      return res.status(400).json({ message: '邮箱已被注册' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户（默认角色为测试人员，状态为待审核）
    await pool.execute(
      'INSERT INTO users (username, password, role, email, status) VALUES (?, ?, ?, ?, ?)',
      [username, hashedPassword, '测试人员', email, 'pending']
    );

    // 获取新创建的用户ID
    const [newUsers] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (newUsers.length > 0) {
      await logActivity(newUsers[0].id, username, '测试人员', '用户注册', `新用户 ${username} 注册成功，等待管理员审核`, 'user', newUsers[0].id, ipAddress, userAgent);
    }

    res.json({ message: '注册成功，请等待管理员审核后方可登录' });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取用户名列表（公开接口，用于@提及验证）
router.get('/usernames', async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT username FROM users WHERE status = "active"'
    );
    res.json({
      success: true,
      usernames: users.map(u => u.username)
    });
  } catch (error) {
    console.error('获取用户名列表失败:', error);
    res.json({ success: false, usernames: [], message: '获取失败' });
  }
});

// 获取用户列表（支持分页和搜索）
router.get('/list', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const searchTerm = req.query.search || req.query.username || '';
    const roleFilter = req.query.role || '';
    const statusFilter = req.query.status || '';
    const offset = (page - 1) * pageSize;
    
    // 构建查询条件
    let whereClause = '1=1';
    const params = [];
    
    if (searchTerm) {
      whereClause += ' AND (username LIKE ? OR email LIKE ?)';
      params.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }
    
    if (roleFilter) {
      whereClause += ' AND role = ?';
      params.push(roleFilter);
    }
    
    if (statusFilter) {
      whereClause += ' AND status = ?';
      params.push(statusFilter);
    }
    
    // 获取总数
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM users WHERE ${whereClause}`,
      params
    );
    const total = countResult[0].total;
    
    // 获取分页数据（包含status和muted_until字段）
    const [users] = await pool.execute(
      `SELECT id, username, role, email, status, muted_until, created_at FROM users WHERE ${whereClause} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    
    res.json({
      success: true,
      users: users,
      pagination: {
        page: page,
        pageSize: pageSize,
        total: total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 添加用户（需要管理员权限）
router.post('/add', authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, role, email } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');

  try {
    // 检查用户名是否已存在
    const [existingUsers] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户
    await pool.execute(
      'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, role, email]
    );

    // 获取新创建的用户ID
    const [newUsers] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (newUsers.length > 0) {
      await logActivity(currentUser.id, currentUser.username, currentUser.role, '添加用户', `管理员 ${currentUser.username} 添加了新用户 ${username}`, 'user', newUsers[0].id, ipAddress, userAgent);
    }

    res.json({ message: '用户添加成功' });
  } catch (error) {
    console.error('添加用户错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// ==================== 用户个人设置 API（必须在 /:id 路由之前定义）====================

/**
 * GET /api/users/profile
 * 获取当前用户的个人信息
 */
router.get('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  
  try {
    const [users] = await pool.execute(
      'SELECT id, username, email, role, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    res.json({ success: true, data: users[0] });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

/**
 * GET /api/users/preferences
 * 获取当前用户的偏好设置
 */
router.get('/preferences', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  
  try {
    const [users] = await pool.execute(
      'SELECT email_notify_mentions, email_notify_comments, email_notify_likes FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    res.json({ success: true, data: users[0] });
  } catch (error) {
    console.error('获取用户偏好设置错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

/**
 * PUT /api/users/preferences
 * 更新当前用户的偏好设置
 */
router.put('/preferences', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { email_notify_mentions, email_notify_comments, email_notify_likes } = req.body;
  
  try {
    await pool.execute(
      'UPDATE users SET email_notify_mentions = ?, email_notify_comments = ?, email_notify_likes = ?, updated_at = NOW() WHERE id = ?',
      [
        email_notify_mentions === undefined ? 1 : (email_notify_mentions ? 1 : 0),
        email_notify_comments === undefined ? 1 : (email_notify_comments ? 1 : 0),
        email_notify_likes === undefined ? 0 : (email_notify_likes ? 1 : 0),
        userId
      ]
    );
    
    res.json({ success: true, message: '偏好设置已更新' });
  } catch (error) {
    console.error('更新用户偏好设置错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 编辑用户（需要管理员权限）
router.put('/edit/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role, email } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');

  try {
    // 获取被编辑用户的信息
    const [users] = await pool.execute('SELECT username FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    await pool.execute(
      'UPDATE users SET role = ?, email = ? WHERE id = ?',
      [role, email, id]
    );

    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '编辑用户', `管理员 ${currentUser.username} 编辑了用户 ${users[0].username}`, 'user', parseInt(id), ipAddress, userAgent);

    res.json({ message: '用户编辑成功' });
  } catch (error) {
    console.error('编辑用户错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 审核用户（通过/禁用/启用）- 需要管理员权限
router.put('/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');

  try {
    // 验证状态值
    const validStatuses = ['pending', 'active', 'disabled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: '无效的状态值' });
    }

    // 获取用户信息
    const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const targetUser = users[0];

    // 不允许修改自己的状态
    if (targetUser.id === currentUser.id) {
      return res.status(400).json({ message: '不能修改自己的状态' });
    }
    
    // 保护admin账户，不能被禁用
    if (targetUser.username.toLowerCase() === 'admin' && status !== 'active') {
      return res.status(400).json({ message: '系统管理员账户不允许禁用' });
    }

    // 更新用户状态
    await pool.execute('UPDATE users SET status = ? WHERE id = ?', [status, id]);

    // 记录操作日志
    const statusText = status === 'active' ? '通过审核' : (status === 'disabled' ? '禁用' : '设为待审核');
    await logActivity(
      currentUser.id, 
      currentUser.username, 
      currentUser.role, 
      '审核用户', 
      `管理员 ${currentUser.username} 将用户 ${targetUser.username} ${statusText}`, 
      'user', 
      parseInt(id), 
      ipAddress, 
      userAgent
    );

    res.json({ success: true, message: `用户已${statusText}` });
  } catch (error) {
    console.error('审核用户错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除用户（需要管理员权限）
router.delete('/delete/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');

  try {
    // 获取被删除用户的信息
    const [users] = await pool.execute('SELECT username FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    // 保护admin账户，不能被删除
    if (users[0].username.toLowerCase() === 'admin') {
      return res.status(400).json({ message: '系统管理员账户不允许删除' });
    }
    
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);

    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '删除用户', `管理员 ${currentUser.username} 删除了用户 ${users[0].username}`, 'user', parseInt(id), ipAddress, userAgent);

    res.json({ message: '用户删除成功' });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新用户（需要管理员权限）- 兼容客户端调用方式
router.post('/update', authenticateToken, requireAdmin, async (req, res) => {
  const { username, email, role, password } = req.body;

  try {
    // 根据用户名查找用户ID
    const [users] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    const userId = users[0].id;
    
    let updateQuery = 'UPDATE users SET role = ?, email = ? WHERE id = ?';
    const updateParams = [role, email, userId];
    
    // 如果提供了密码，则更新密码
    if (password && password !== '********') {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery = 'UPDATE users SET role = ?, email = ?, password = ? WHERE id = ?';
      updateParams.splice(2, 0, hashedPassword);
    }
    
    await pool.execute(updateQuery, updateParams);
    res.json({ message: '用户更新成功' });
  } catch (error) {
    console.error('更新用户错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除用户（需要管理员权限）- 兼容客户端调用方式
router.post('/delete', authenticateToken, requireAdmin, async (req, res) => {
  const { username } = req.body;

  try {
    // 根据用户名删除用户
    const [result] = await pool.execute('DELETE FROM users WHERE username = ?', [username]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }
    
    res.json({ message: '用户删除成功' });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// ==================== 用户个人设置 API ====================

/**
 * PUT /api/users/email
 * 修改当前用户的邮箱
 */
router.put('/email', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { email } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  if (!email || !email.trim()) {
    return res.status(400).json({ success: false, message: '邮箱不能为空' });
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: '邮箱格式不正确' });
  }
  
  try {
    const [existingEmails] = await pool.execute(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, userId]
    );
    
    if (existingEmails.length > 0) {
      return res.status(400).json({ success: false, message: '该邮箱已被其他用户使用' });
    }
    
    await pool.execute(
      'UPDATE users SET email = ?, updated_at = NOW() WHERE id = ?',
      [email, userId]
    );
    
    await logActivity(
      userId, 
      req.user.username, 
      req.user.role, 
      '修改邮箱', 
      `用户 ${req.user.username} 修改了邮箱地址`, 
      'user', 
      userId, 
      ipAddress, 
      userAgent
    );
    
    res.json({ success: true, message: '邮箱修改成功' });
  } catch (error) {
    console.error('修改邮箱错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

/**
 * PUT /api/users/password
 * 修改当前用户的密码
 */
router.put('/password', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ success: false, message: '请填写所有密码字段' });
  }
  
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: '新密码长度不能少于6位' });
  }
  
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, message: '两次输入的新密码不一致' });
  }
  
  try {
    const [users] = await pool.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    const isPasswordValid = await bcrypt.compare(currentPassword, users[0].password);
    if (!isPasswordValid) {
      return res.status(400).json({ success: false, message: '当前密码错误' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await pool.execute(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, userId]
    );
    
    await logActivity(
      userId, 
      req.user.username, 
      req.user.role, 
      '修改密码', 
      `用户 ${req.user.username} 修改了登录密码`, 
      'user', 
      userId, 
      ipAddress, 
      userAgent
    );
    
    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    console.error('修改密码错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;