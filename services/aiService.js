const pool = require('../db');
const logger = require('./logger');

const _aiConfigCache = new Map();
const AI_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function _getCacheKey(userId, modelId) {
    return `${userId}:${modelId || 'default'}`;
}

function _getCachedConfig(key) {
    const entry = _aiConfigCache.get(key);
    if (entry && Date.now() - entry.time < AI_CONFIG_CACHE_TTL) {
        return entry.config;
    }
    if (entry) {
        _aiConfigCache.delete(key);
    }
    return null;
}

function _setCachedConfig(key, config) {
    if (_aiConfigCache.size > 1000) {
        const firstKey = _aiConfigCache.keys().next().value;
        _aiConfigCache.delete(firstKey);
    }
    _aiConfigCache.set(key, { config, time: Date.now() });
}

const AI_TIMEOUT_DEFAULTS = {
  generalAITask: 120000,
  reportGeneration: 600000
};

function getAITimeoutDefaults() {
  return { ...AI_TIMEOUT_DEFAULTS };
}

async function getUserAITimeoutConfig(userId) {
  if (!userId) {
    return getAITimeoutDefaults();
  }

  try {
    const [users] = await pool.execute(
      'SELECT ai_timeout_config FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0 || !users[0].ai_timeout_config) {
      return getAITimeoutDefaults();
    }

    const userConfig = typeof users[0].ai_timeout_config === 'string'
      ? JSON.parse(users[0].ai_timeout_config)
      : users[0].ai_timeout_config;

    const result = {
      ...getAITimeoutDefaults(),
      ...userConfig
    };

    if (userConfig.caseGeneration || userConfig.level1PointGeneration || userConfig.dedupEmbedding || userConfig.summaryGeneration) {
      result.generalAITask = userConfig.generalAITask || userConfig.caseGeneration || userConfig.level1PointGeneration || userConfig.summaryGeneration || userConfig.dedupEmbedding || AI_TIMEOUT_DEFAULTS.generalAITask;
    }

    return result;
  } catch (error) {
    logger.error('获取用户AI超时配置错误', { error: error.message });
    return getAITimeoutDefaults();
  }
}

async function getSystemDefaultAIConfig() {
  const cached = _getCachedConfig('system_default');
  if (cached !== null) return cached;
  
  try {
    const [models] = await pool.execute(
      'SELECT * FROM ai_models WHERE is_default = TRUE AND is_enabled = TRUE LIMIT 1'
    );
    
    const result = models.length === 0 ? null : models[0];
    if (result) _setCachedConfig('system_default', result);
    return result;
  } catch (error) {
    logger.error('获取系统默认AI配置错误', { error: error.message });
    return null;
  }
}

async function getUserAIConfig(userId, modelId = null) {
  if (userId === undefined || userId === null) {
    logger.error('getUserAIConfig: userId 不能为空');
    return await getSystemDefaultAIConfig();
  }
  
  const cacheKey = _getCacheKey(userId, modelId);
  const cached = _getCachedConfig(cacheKey);
  if (cached !== null) return cached;
  
  try {
    let query, params;
    
    if (modelId) {
      query = 'SELECT * FROM ai_models WHERE (model_id = ? OR name = ?) AND is_enabled = TRUE AND user_id = ?';
      params = [modelId, modelId, userId];
    } else {
      query = 'SELECT * FROM ai_models WHERE is_enabled = TRUE AND user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1';
      params = [userId];
    }
    
    const [models] = await pool.execute(query, params);
    
    let result;
    if (models.length > 0) {
      result = models[0];
    } else {
      result = await getSystemDefaultAIConfig();
    }
    
    if (result) _setCachedConfig(cacheKey, result);
    return result;
  } catch (error) {
    logger.error('获取用户AI配置错误', { error: error.message });
    return await getSystemDefaultAIConfig();
  }
}

function invalidateAIConfigCache(userId, modelId) {
  if (userId) {
    _aiConfigCache.delete(_getCacheKey(userId, modelId));
    _aiConfigCache.delete(_getCacheKey(userId, null));
  }
  _aiConfigCache.delete('system_default');
}

module.exports = {
  getSystemDefaultAIConfig,
  getUserAIConfig,
  getUserAITimeoutConfig,
  getAITimeoutDefaults,
  invalidateAIConfigCache
};
