const pool = require('../db');
const logger = require('./logger');

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

class TokenBlacklist {
  constructor() {
    this._cleanupTimer = null;
  }

  async init() {
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS token_blacklist (
          id INT AUTO_INCREMENT PRIMARY KEY,
          token_jti VARCHAR(255) NOT NULL,
          user_id INT NOT NULL,
          reason VARCHAR(100) DEFAULT 'logout',
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_token_jti (token_jti),
          INDEX idx_expires_at (expires_at),
          INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      logger.info('Token黑名单表已就绪');
      this._startCleanup();
    } catch (error) {
      logger.error('初始化Token黑名单表失败', { error: error.message });
    }
  }

  async add(token, userId, reason = 'logout') {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) return false;

      const jti = decoded.jti || this._generateJti(token);
      const expiresAt = new Date(decoded.exp * 1000);

      await pool.execute(
        'INSERT IGNORE INTO token_blacklist (token_jti, user_id, reason, expires_at) VALUES (?, ?, ?, ?)',
        [jti, userId, reason, expiresAt]
      );

      logger.info('Token已加入黑名单', { userId, reason, expiresAt: expiresAt.toISOString() });
      return true;
    } catch (error) {
      logger.error('添加Token到黑名单失败', { error: error.message, userId });
      return false;
    }
  }

  async isBlacklisted(token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.decode(token);
      if (!decoded) return false;

      const jti = decoded.jti || this._generateJti(token);

      const [rows] = await pool.execute(
        'SELECT id FROM token_blacklist WHERE token_jti = ? AND expires_at > NOW()',
        [jti]
      );

      return rows.length > 0;
    } catch (error) {
      logger.error('检查Token黑名单失败', { error: error.message });
      return false;
    }
  }

  async blacklistAllUserTokens(userId, reason = 'password_change') {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.decode(arguments[2]);
      const expiresAt = decoded && decoded.exp
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const jti = `user_all_${userId}_${Date.now()}`;

      await pool.execute(
        'INSERT IGNORE INTO token_blacklist (token_jti, user_id, reason, expires_at) VALUES (?, ?, ?, ?)',
        [jti, userId, reason, expiresAt]
      );

      logger.info('已将用户所有Token加入黑名单', { userId, reason });
      return true;
    } catch (error) {
      logger.error('批量黑名单用户Token失败', { error: error.message, userId });
      return false;
    }
  }

  async cleanup() {
    try {
      const [result] = await pool.execute(
        'DELETE FROM token_blacklist WHERE expires_at <= NOW()'
      );
      if (result.affectedRows > 0) {
        logger.info('清理过期Token黑名单记录', { count: result.affectedRows });
      }
    } catch (error) {
      logger.error('清理Token黑名单失败', { error: error.message });
    }
  }

  _startCleanup() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    this._cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this._cleanupTimer.unref();
  }

  _generateJti(token) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 32);
  }
}

const tokenBlacklist = new TokenBlacklist();

module.exports = tokenBlacklist;
