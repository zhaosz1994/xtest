const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');
const emailService = require('../services/emailService');

// 获取邮件配置列表
router.get('/configs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [configs] = await pool.execute(`
      SELECT id, config_name, email_type, smtp_host, smtp_port, smtp_secure, smtp_user,
             sender_email, sender_name, self_hosted_api_url, is_default, is_enabled, 
             daily_limit, sent_today, last_sent_date, created_at, updated_at
      FROM email_config
      ORDER BY is_default DESC, created_at ASC
    `);
    
    res.json({ success: true, configs: configs });
  } catch (error) {
    logger.error('获取邮件配置错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取单个邮件配置
router.get('/configs/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [configs] = await pool.execute('SELECT * FROM email_config WHERE id = ?', [id]);
    
    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    
    // 不返回密码
    const config = { ...configs[0] };
    delete config.smtp_password;
    delete config.self_hosted_api_key;
    
    res.json({ success: true, config: config });
  } catch (error) {
    logger.error('获取邮件配置错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建邮件配置
router.post('/configs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      config_name, email_type,
      smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password,
      sender_email, sender_name,
      self_hosted_api_url, self_hosted_api_key,
      is_default, is_enabled, daily_limit
    } = req.body;
    
    // 加密敏感信息
    const encryptedPassword = smtp_password ? emailService.encrypt(smtp_password) : null;
    const encryptedApiKey = self_hosted_api_key ? emailService.encrypt(self_hosted_api_key) : null;
    
    // 如果设为默认，先取消其他默认配置
    if (is_default) {
      await pool.execute('UPDATE email_config SET is_default = FALSE');
    }
    
    const [result] = await pool.execute(`
      INSERT INTO email_config (
        config_name, email_type, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password,
        sender_email, sender_name, self_hosted_api_url, self_hosted_api_key,
        is_default, is_enabled, daily_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      config_name, email_type, smtp_host, smtp_port || 587, smtp_secure || false,
      smtp_user, encryptedPassword, sender_email, sender_name,
      self_hosted_api_url, encryptedApiKey,
      is_default || false, is_enabled !== false, daily_limit || 500
    ]);
    
    res.json({ success: true, message: '邮件配置创建成功', id: result.insertId });
  } catch (error) {
    logger.error('创建邮件配置错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新邮件配置
router.put('/configs/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      config_name, email_type,
      smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password,
      sender_email, sender_name,
      self_hosted_api_url, self_hosted_api_key,
      is_default, is_enabled, daily_limit
    } = req.body;
    
    // 如果设为默认，先取消其他默认配置
    if (is_default) {
      await pool.execute('UPDATE email_config SET is_default = FALSE');
    }
    
    // 构建更新字段
    const updates = [];
    const values = [];
    
    if (config_name !== undefined) { updates.push('config_name = ?'); values.push(config_name); }
    if (email_type !== undefined) { updates.push('email_type = ?'); values.push(email_type); }
    if (smtp_host !== undefined) { updates.push('smtp_host = ?'); values.push(smtp_host); }
    if (smtp_port !== undefined) { updates.push('smtp_port = ?'); values.push(smtp_port); }
    if (smtp_secure !== undefined) { updates.push('smtp_secure = ?'); values.push(smtp_secure); }
    if (smtp_user !== undefined) { updates.push('smtp_user = ?'); values.push(smtp_user); }
    if (smtp_password !== undefined && smtp_password) {
      updates.push('smtp_password = ?');
      values.push(emailService.encrypt(smtp_password));
    }
    if (sender_email !== undefined) { updates.push('sender_email = ?'); values.push(sender_email); }
    if (sender_name !== undefined) { updates.push('sender_name = ?'); values.push(sender_name); }
    if (self_hosted_api_url !== undefined) { updates.push('self_hosted_api_url = ?'); values.push(self_hosted_api_url); }
    if (self_hosted_api_key !== undefined && self_hosted_api_key) {
      updates.push('self_hosted_api_key = ?');
      values.push(emailService.encrypt(self_hosted_api_key));
    }
    if (is_default !== undefined) { updates.push('is_default = ?'); values.push(is_default); }
    if (is_enabled !== undefined) { updates.push('is_enabled = ?'); values.push(is_enabled); }
    if (daily_limit !== undefined) { updates.push('daily_limit = ?'); values.push(daily_limit); }
    
    if (updates.length === 0) {
      return res.json({ success: true, message: '没有需要更新的内容' });
    }
    
    values.push(id);
    await pool.execute(`UPDATE email_config SET ${updates.join(', ')} WHERE id = ?`, values);
    
    res.json({ success: true, message: '邮件配置更新成功' });
  } catch (error) {
    logger.error('更新邮件配置错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除邮件配置
router.delete('/configs/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查是否为默认配置
    const [configs] = await pool.execute('SELECT is_default FROM email_config WHERE id = ?', [id]);
    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '配置不存在' });
    }
    
    if (configs[0].is_default) {
      return res.status(400).json({ success: false, message: '不能删除默认配置' });
    }
    
    await pool.execute('DELETE FROM email_config WHERE id = ?', [id]);
    
    res.json({ success: true, message: '邮件配置删除成功' });
  } catch (error) {
    logger.error('删除邮件配置错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 测试邮件发送
router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { to, configId } = req.body;
    
    if (!to) {
      return res.status(400).json({ success: false, message: '请提供收件人邮箱' });
    }
    
    const result = await emailService.sendEmail({
      to: to,
      subject: '【xTest】邮件配置测试',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #28a745;">邮件配置测试成功</h2>
          <p>这是一封测试邮件，如果您收到此邮件，说明邮件配置正确。</p>
          <p>发送时间: ${new Date().toLocaleString('zh-CN')}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">此邮件由 xTest 测试管理系统自动发送</p>
        </div>
      `,
      emailType: 'test',
      configId: configId
    });
    
    res.json(result);
  } catch (error) {
    logger.error('测试邮件发送错误:', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取邮件发送日志
router.get('/logs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const status = req.query.status || '';
    const emailType = req.query.emailType || '';
    
    let whereClause = '1=1';
    const params = [];
    
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    
    if (emailType) {
      whereClause += ' AND email_type = ?';
      params.push(emailType);
    }
    
    // 获取总数
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM email_logs WHERE ${whereClause}`,
      params
    );
    const total = countResult[0].total;
    
    // 获取日志（使用模板字符串，因为MySQL不支持LIMIT/OFFSET参数化）
    const [logs] = await pool.execute(`
      SELECT el.*, ec.config_name
      FROM email_logs el
      LEFT JOIN email_config ec ON el.config_id = ec.id
      WHERE ${whereClause}
      ORDER BY el.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `, params);
    
    res.json({
      success: true,
      logs: logs,
      pagination: {
        page: page,
        pageSize: pageSize,
        total: total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    logger.error('获取邮件日志错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取邮件统计
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // 获取今日统计
    const today = new Date().toISOString().split('T')[0];
    const [todayStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM email_logs
      WHERE DATE(created_at) = ?
    `, [today]);
    
    // 获取最近7天统计
    const [weeklyStats] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM email_logs
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    
    // 获取配置使用情况
    const [configStats] = await pool.execute(`
      SELECT 
        ec.config_name,
        ec.sent_today,
        ec.daily_limit,
        ec.is_enabled,
        COUNT(el.id) as total_sent
      FROM email_config ec
      LEFT JOIN email_logs el ON ec.id = el.config_id AND DATE(el.created_at) = ?
      GROUP BY ec.id
    `, [today]);
    
    res.json({
      success: true,
      stats: {
        today: todayStats[0],
        weekly: weeklyStats,
        configs: configStats
      }
    });
  } catch (error) {
    logger.error('获取邮件统计错误:', { error: error.message });
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 发送验证码（普通用户可用）
router.post('/send-verification', authenticateToken, async (req, res) => {
  try {
    const { email } = req.body;
    const username = req.user.username;
    
    // 生成6位验证码
    const code = Math.random().toString().slice(-6);
    
    // TODO: 将验证码存储到Redis或数据库，设置10分钟过期
    
    const result = await emailService.sendVerificationCode(email, code, username);
    
    res.json(result);
  } catch (error) {
    logger.error('发送验证码错误:', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
