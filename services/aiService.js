const pool = require('../db');

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
    console.error('获取用户AI超时配置错误:', error);
    return getAITimeoutDefaults();
  }
}

async function getSystemDefaultAIConfig() {
  try {
    const [models] = await pool.execute(
      'SELECT * FROM ai_models WHERE is_default = TRUE AND is_enabled = TRUE LIMIT 1'
    );
    
    if (models.length === 0) {
      return null;
    }
    
    return models[0];
  } catch (error) {
    console.error('获取系统默认AI配置错误:', error);
    return null;
  }
}

async function getUserAIConfig(userId, modelId = null) {
  if (userId === undefined || userId === null) {
    console.error('getUserAIConfig: userId 不能为空');
    return await getSystemDefaultAIConfig();
  }
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
    
    if (models.length > 0) {
      return models[0];
    }
    
    return await getSystemDefaultAIConfig();
  } catch (error) {
    console.error('获取用户AI配置错误:', error);
    return await getSystemDefaultAIConfig();
  }
}

module.exports = {
  getSystemDefaultAIConfig,
  getUserAIConfig,
  getUserAITimeoutConfig,
  getAITimeoutDefaults
};
