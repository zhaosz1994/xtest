const pool = require('../db');

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
  getUserAIConfig
};
