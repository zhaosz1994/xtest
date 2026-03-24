const nodemailer = require('nodemailer');
const pool = require('../db');
const crypto = require('crypto');

// 加密密钥（生产环境应从环境变量获取）
const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'xtest-email-encryption-key-32b';
const IV_LENGTH = 16;

// 加密函数
function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// 解密函数
function decrypt(text) {
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = textParts.join(':');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('解密失败:', error);
    return text;
  }
}

// 创建SMTP传输器
function createSMTPTransporter(config) {
  return nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port,
    secure: config.smtp_secure,
    auth: {
      user: config.smtp_user,
      pass: decrypt(config.smtp_password)
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

// 创建自建服务器传输器（使用自定义API）
function createSelfHostedTransporter(config) {
  return {
    sendMail: async (mailOptions) => {
      const response = await fetch(config.self_hosted_api_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${decrypt(config.self_hosted_api_key)}`
        },
        body: JSON.stringify({
          to: mailOptions.to,
          subject: mailOptions.subject,
          html: mailOptions.html,
          text: mailOptions.text,
          from: mailOptions.from
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`自建服务器发送失败: ${error}`);
      }
      
      return await response.json();
    }
  };
}

// 获取默认邮件配置
async function getDefaultConfig() {
  const [configs] = await pool.execute(
    'SELECT * FROM email_config WHERE is_default = TRUE AND is_enabled = TRUE LIMIT 1'
  );
  return configs.length > 0 ? configs[0] : null;
}

// 更新每日发送计数
async function updateDailyCount(configId) {
  const today = new Date().toISOString().split('T')[0];
  
  const [config] = await pool.execute(
    'SELECT last_sent_date, sent_today FROM email_config WHERE id = ?',
    [configId]
  );
  
  if (config.length > 0) {
    const lastSentDate = config[0].last_sent_date;
    const sentToday = config[0].sent_today;
    
    if (lastSentDate === null || lastSentDate.toISOString().split('T')[0] !== today) {
      await pool.execute(
        'UPDATE email_config SET sent_today = 1, last_sent_date = ? WHERE id = ?',
        [today, configId]
      );
    } else {
      await pool.execute(
        'UPDATE email_config SET sent_today = sent_today + 1 WHERE id = ?',
        [configId]
      );
    }
  }
}

// 记录邮件日志
async function logEmail(configId, recipientEmail, recipientName, subject, emailType, status, errorMessage = null) {
  await pool.execute(
    `INSERT INTO email_logs (config_id, recipient_email, recipient_name, subject, email_type, status, error_message, sent_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [configId, recipientEmail, recipientName, subject, emailType, status, errorMessage, status === 'sent' ? new Date() : null]
  );
}

// 发送邮件主函数
async function sendEmail({ to, subject, html, text, emailType = 'notification', configId = null }) {
  try {
    // 获取邮件配置
    let config;
    if (configId) {
      const [configs] = await pool.execute('SELECT * FROM email_config WHERE id = ? AND is_enabled = TRUE', [configId]);
      config = configs[0];
    } else {
      config = await getDefaultConfig();
    }
    
    if (!config) {
      throw new Error('没有可用的邮件配置');
    }
    
    // 检查每日发送限制
    const today = new Date().toISOString().split('T')[0];
    const lastSentDate = config.last_sent_date ? new Date(config.last_sent_date).toISOString().split('T')[0] : null;
    const sentToday = lastSentDate === today ? config.sent_today : 0;
    
    if (sentToday >= config.daily_limit) {
      throw new Error(`已达到每日发送限制 (${config.daily_limit} 封)`);
    }
    
    // 创建传输器
    let transporter;
    if (config.email_type === 'smtp') {
      transporter = createSMTPTransporter(config);
    } else if (config.email_type === 'self_hosted') {
      transporter = createSelfHostedTransporter(config);
    } else {
      throw new Error('不支持的邮件类型');
    }
    
    // 准备邮件选项
    const mailOptions = {
      from: `"${config.sender_name}" <${config.sender_email || config.smtp_user}>`,
      to: Array.isArray(to) ? to.join(',') : to,
      subject: subject,
      html: html,
      text: text || html.replace(/<[^>]*>/g, '')
    };
    
    // 发送邮件
    const info = await transporter.sendMail(mailOptions);
    
    // 更新发送计数
    await updateDailyCount(config.id);
    
    // 记录日志
    const recipientEmail = Array.isArray(to) ? to[0] : to;
    await logEmail(config.id, recipientEmail, '', subject, emailType, 'sent');
    
    return {
      success: true,
      messageId: info.messageId,
      message: '邮件发送成功'
    };
    
  } catch (error) {
    console.error('邮件发送失败:', error);
    
    // 记录失败日志
    const recipientEmail = Array.isArray(to) ? to[0] : to;
    try {
      const config = await getDefaultConfig();
      if (config) {
        await logEmail(config.id, recipientEmail, '', subject, emailType, 'failed', error.message);
      }
    } catch (logError) {
      console.error('记录邮件日志失败:', logError);
    }
    
    return {
      success: false,
      message: error.message
    };
  }
}

// 发送验证码邮件
async function sendVerificationCode(email, code, username = '') {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">xTest 测试管理系统</h2>
      <p>尊敬的 ${username || '用户'}，您好！</p>
      <p>您的验证码是：</p>
      <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
        ${code}
      </div>
      <p style="color: #666;">验证码有效期为 10 分钟，请尽快使用。</p>
      <p style="color: #999; font-size: 12px;">如果这不是您的操作，请忽略此邮件。</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #999; font-size: 12px; text-align: center;">此邮件由系统自动发送，请勿回复。</p>
    </div>
  `;
  
  return await sendEmail({
    to: email,
    subject: '【xTest】邮箱验证码',
    html: html,
    emailType: 'verification'
  });
}

// 发送测试报告通知
async function sendReportNotification(email, reportName, reportLink, username = '') {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333; border-bottom: 2px solid #28a745; padding-bottom: 10px;">测试报告已生成</h2>
      <p>尊敬的 ${username || '用户'}，您好！</p>
      <p>您的测试报告 <strong>${reportName}</strong> 已生成完成。</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${reportLink}" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">查看报告</a>
      </div>
      <p style="color: #666;">如有疑问，请联系管理员。</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #999; font-size: 12px; text-align: center;">此邮件由 xTest 测试管理系统自动发送</p>
    </div>
  `;
  
  return await sendEmail({
    to: email,
    subject: `【xTest】测试报告已生成 - ${reportName}`,
    html: html,
    emailType: 'report'
  });
}

// 发送密码重置邮件
async function sendPasswordReset(email, resetLink, username = '') {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">密码重置</h2>
      <p>尊敬的 ${username || '用户'}，您好！</p>
      <p>我们收到了重置您账户密码的请求。</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="background-color: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">重置密码</a>
      </div>
      <p style="color: #666;">此链接有效期为 30 分钟。</p>
      <p style="color: #999; font-size: 12px;">如果这不是您的操作，请忽略此邮件，您的密码不会被更改。</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #999; font-size: 12px; text-align: center;">此邮件由 xTest 测试管理系统自动发送</p>
    </div>
  `;
  
  return await sendEmail({
    to: email,
    subject: '【xTest】密码重置',
    html: html,
    emailType: 'password_reset'
  });
}

module.exports = {
  sendEmail,
  sendVerificationCode,
  sendReportNotification,
  sendPasswordReset,
  encrypt,
  decrypt
};
