const pool = require('../db');
const logger = require('./logger');

const _aiConfigCache = new Map();
const AI_CONFIG_CACHE_TTL = 5 * 60 * 1000;

const _userGenParamsCache = new Map();
const USER_GEN_PARAMS_CACHE_TTL = 2 * 60 * 1000;

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

function _getCachedUserGenParams(userId) {
    const entry = _userGenParamsCache.get(userId);
    if (entry && Date.now() - entry.time < USER_GEN_PARAMS_CACHE_TTL) {
        return entry.params;
    }
    if (entry) {
        _userGenParamsCache.delete(userId);
    }
    return null;
}

function _setCachedUserGenParams(userId, params) {
    if (_userGenParamsCache.size > 500) {
        const firstKey = _userGenParamsCache.keys().next().value;
        _userGenParamsCache.delete(firstKey);
    }
    _userGenParamsCache.set(userId, { params, time: Date.now() });
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
    _userGenParamsCache.delete(userId);
  }
  _aiConfigCache.delete('system_default');
  _genParamsCache = null;
}

const GEN_PARAMS_DEFAULTS = {
  temperature: 0.3,
  max_tokens: 4000,
  top_p: 1.0,
  frequency_penalty: 0,
  presence_penalty: 0,
  tool_choice: 'auto',
  response_format: 'text',
  request_timeout: 120000,
  max_retries: 3,
  ai_rate_limit: 10,
  seed: null,
  scene_data_analysis: { temperature: 0.3, max_tokens: 2000, max_context_rounds: 10 },
  scene_case_generation: { temperature: 0.7, max_tokens: 4000 },
  scene_report_analysis: { temperature: 0.3, max_tokens: 2000 },
  scene_memory_distillation: { temperature: 0.3, max_tokens: 800 }
};

let _genParamsCache = null;
let _userGenParamsColumnExists = null;

async function _checkUserGenParamsColumnsExist() {
  if (_userGenParamsColumnExists !== null) {
    return _userGenParamsColumnExists;
  }
  try {
    const [columns] = await pool.query(`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name IN ('ai_generation_params', 'ai_scene_params')
    `);
    _userGenParamsColumnExists = columns[0].count >= 2;
    return _userGenParamsColumnExists;
  } catch (error) {
    logger.warn('检查用户AI配置字段是否存在失败', { error: error.message });
    _userGenParamsColumnExists = false;
    return false;
  }
}

function _deepCloneGenParams(params) {
  const result = { ...params };
  const sceneKeys = ['scene_data_analysis', 'scene_case_generation', 'scene_report_analysis', 'scene_memory_distillation'];
  for (const key of sceneKeys) {
    if (result[key] && typeof result[key] === 'object') {
      result[key] = { ...result[key] };
    }
  }
  return result;
}

async function getAIGenerationParams() {
  if (_genParamsCache) return _genParamsCache;

  try {
    const configKeys = [
      'temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty',
      'tool_choice', 'response_format', 'request_timeout', 'max_retries', 'ai_rate_limit', 'seed',
      'scene_data_analysis', 'scene_case_generation', 'scene_report_analysis', 'scene_memory_distillation'
    ];

    const [configs] = await pool.execute(
      'SELECT config_key, config_value FROM ai_config WHERE config_key IN (' + configKeys.map(() => '?').join(',') + ')',
      configKeys
    );

    const result = {};
    const sceneKeys = ['scene_data_analysis', 'scene_case_generation', 'scene_report_analysis', 'scene_memory_distillation'];

    for (const config of configs) {
      if (sceneKeys.includes(config.config_key)) {
        try {
          result[config.config_key] = JSON.parse(config.config_value || '{}');
        } catch (e) {
          result[config.config_key] = {};
        }
      } else {
        result[config.config_key] = config.config_value;
      }
    }

    for (const [key, val] of Object.entries(GEN_PARAMS_DEFAULTS)) {
      if (result[key] === undefined) {
        result[key] = typeof val === 'object' ? { ...val } : val;
      }
    }

    for (const key of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty']) {
      if (result[key] !== undefined) result[key] = parseFloat(result[key]);
    }
    for (const key of ['max_tokens', 'request_timeout', 'max_retries', 'ai_rate_limit']) {
      if (result[key] !== undefined) result[key] = parseInt(result[key]);
    }
    if (result.seed === '' || result.seed === null || result.seed === undefined) {
      result.seed = null;
    } else {
      result.seed = parseInt(result.seed);
    }

    for (const sceneKey of sceneKeys) {
      if (result[sceneKey]) {
        for (const [k, v] of Object.entries(result[sceneKey])) {
          if (k === 'temperature' || k === 'top_p' || k === 'frequency_penalty' || k === 'presence_penalty') {
            result[sceneKey][k] = parseFloat(v);
          } else if (k === 'max_tokens' || k === 'max_context_rounds') {
            result[sceneKey][k] = parseInt(v);
          }
        }
      }
    }

    _genParamsCache = result;
    return result;
  } catch (error) {
    logger.error('获取AI生成参数错误', { error: error.message });
    return _deepCloneGenParams(GEN_PARAMS_DEFAULTS);
  }
}

async function getUserAIGenerationParams(userId) {
  if (!userId) {
    return await getAIGenerationParams();
  }

  const cached = _getCachedUserGenParams(userId);
  if (cached !== null) return cached;

  try {
    const columnsExist = await _checkUserGenParamsColumnsExist();
    if (!columnsExist) {
      const globalParams = await getAIGenerationParams();
      _setCachedUserGenParams(userId, globalParams);
      return globalParams;
    }

    const [users] = await pool.execute(
      'SELECT ai_generation_params, ai_scene_params FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      const globalParams = await getAIGenerationParams();
      _setCachedUserGenParams(userId, globalParams);
      return globalParams;
    }

    const user = users[0];
    const globalParams = await getAIGenerationParams();

    if (!user.ai_generation_params && !user.ai_scene_params) {
      _setCachedUserGenParams(userId, globalParams);
      return globalParams;
    }

    const userGenParams = user.ai_generation_params
      ? (typeof user.ai_generation_params === 'string' ? JSON.parse(user.ai_generation_params) : user.ai_generation_params)
      : {};

    const userSceneParams = user.ai_scene_params
      ? (typeof user.ai_scene_params === 'string' ? JSON.parse(user.ai_scene_params) : user.ai_scene_params)
      : {};

    const result = _deepCloneGenParams(globalParams);

    const paramKeys = ['temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty',
                       'tool_choice', 'response_format', 'request_timeout', 'max_retries', 'ai_rate_limit', 'seed'];

    for (const key of paramKeys) {
      if (userGenParams[key] !== undefined && userGenParams[key] !== null && userGenParams[key] !== '') {
        result[key] = userGenParams[key];
      }
    }

    const sceneKeys = ['scene_data_analysis', 'scene_case_generation', 'scene_report_analysis', 'scene_memory_distillation'];
    for (const sceneKey of sceneKeys) {
      if (userSceneParams[sceneKey]) {
        result[sceneKey] = {
          ...globalParams[sceneKey],
          ...userSceneParams[sceneKey]
        };
      }
    }

    for (const key of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty']) {
      if (result[key] !== undefined) result[key] = parseFloat(result[key]);
    }
    for (const key of ['max_tokens', 'request_timeout', 'max_retries', 'ai_rate_limit']) {
      if (result[key] !== undefined) result[key] = parseInt(result[key]);
    }
    if (result.seed === '' || result.seed === null || result.seed === undefined) {
      result.seed = null;
    } else {
      result.seed = parseInt(result.seed);
    }

    _setCachedUserGenParams(userId, result);
    return result;
  } catch (error) {
    logger.error('获取用户AI生成参数错误', { error: error.message, userId });
    return await getAIGenerationParams();
  }
}

function getSceneParams(globalParams, sceneKey) {
  const scene = globalParams[sceneKey] || {};
  return {
    temperature: scene.temperature !== undefined ? scene.temperature : globalParams.temperature,
    max_tokens: scene.max_tokens !== undefined ? scene.max_tokens : globalParams.max_tokens,
    top_p: globalParams.top_p,
    frequency_penalty: globalParams.frequency_penalty,
    presence_penalty: globalParams.presence_penalty,
    seed: globalParams.seed
  };
}

module.exports = {
  getSystemDefaultAIConfig,
  getUserAIConfig,
  getUserAITimeoutConfig,
  getAITimeoutDefaults,
  invalidateAIConfigCache,
  getAIGenerationParams,
  getUserAIGenerationParams,
  getSceneParams
};
