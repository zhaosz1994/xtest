const crypto = require('crypto');
require('dotenv').config();

const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-cbc';

if (!process.env.API_KEY_ENCRYPTION_KEY) {
  console.warn('警告: 未设置API_KEY_ENCRYPTION_KEY环境变量，使用随机密钥。重启后加密的数据将无法解密！');
}

class APIKeyEncryption {
  constructor() {
    this.key = Buffer.from(ENCRYPTION_KEY.substring(0, 64), 'hex');
  }

  encrypt(text) {
    if (!text) return null;
    
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('加密失败:', error.message);
      throw new Error('API_key加密失败');
    }
  }

  decrypt(encryptedData) {
    if (!encryptedData) return null;
    
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
      console.error('解密失败:', error.message);
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
