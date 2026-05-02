const crypto = require('crypto');
const logger = require('./logger');
require('dotenv').config();

const ALGORITHM = 'aes-256-cbc';

if (!process.env.API_KEY_ENCRYPTION_KEY) {
  logger.error('严重错误: 未设置 API_KEY_ENCRYPTION_KEY 环境变量，API密钥加密功能无法安全运行，重启后加密的数据将无法解密。请在 .env 文件中设置 API_KEY_ENCRYPTION_KEY 后重新启动。');
}

const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY;

class APIKeyEncryption {
  constructor() {
    if (!ENCRYPTION_KEY) {
      this.key = null;
      return;
    }
    this.key = Buffer.from(ENCRYPTION_KEY.substring(0, 64), 'hex');
  }

  _ensureKey() {
    if (!this.key) {
      throw new Error('API_KEY_ENCRYPTION_KEY 未配置，无法执行加密/解密操作。请在 .env 中设置该环境变量。');
    }
  }

  encrypt(text) {
    if (!text) return null;
    this._ensureKey();
    
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      logger.error('加密失败', { error: error.message });
      throw new Error('API_key加密失败');
    }
  }

  decrypt(encryptedData) {
    if (!encryptedData) return null;
    this._ensureKey();
    
    try {
      const parts = encryptedData.split(':');
      
      if (parts.length !== 2) {
        throw new Error('加密数据格式无效');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('解密失败', { error: error.message });
      throw new Error('API_key解密失败');
    }
  }

  encryptAPIKey(apiKey) {
    return this.encrypt(apiKey);
  }

  decryptAPIKey(encryptedAPIKey) {
    return this.decrypt(encryptedAPIKey);
  }

  isEncrypted(value) {
    if (!value) return false;
    const parts = value.split(':');
    return parts.length === 2 && /^[0-9a-f]{32}$/.test(parts[0]);
  }

  generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }
}

const apiKeyEncryption = new APIKeyEncryption();

function encryptAPIKey(apiKey) {
  return apiKeyEncryption.encryptAPIKey(apiKey);
}

function decryptAPIKey(encryptedAPIKey) {
  return apiKeyEncryption.decryptAPIKey(encryptedAPIKey);
}

function isEncrypted(value) {
  return apiKeyEncryption.isEncrypted(value);
}

function generateEncryptionKey() {
  return apiKeyEncryption.generateEncryptionKey();
}

module.exports = {
  encryptAPIKey,
  decryptAPIKey,
  isEncrypted,
  generateEncryptionKey
};
