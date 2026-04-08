const jwt = require('jsonwebtoken');
require('dotenv').config();
const logger = require('./services/logger');

const ADMIN_ROLES = ['管理员', 'admin', 'Administrator'];

function isAdmin(user) {
    return user && ADMIN_ROLES.includes(user.role);
}

function isOwner(user, resourceUserId) {
    return user && user.id === parseInt(resourceUserId);
}

// JWT认证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '访问令牌缺失' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: '访问令牌无效' });
    }
    req.user = user;
    next();
  });
};

// 管理员权限中间件
const requireAdmin = (req, res, next) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ message: '需要管理员权限' });
  }
  next();
};

// 检查是否为管理员或资源所有者
// 安全：仅从路由参数(params)获取资源用户ID，防止通过query/body伪造
const requireAdminOrOwner = (resourceUserIdField = 'userId') => {
  return (req, res, next) => {
    if (isAdmin(req.user)) {
      return next();
    }
    
    const resourceUserId = req.params[resourceUserIdField];
    
    if (!resourceUserId) {
      return res.status(400).json({ success: false, message: '缺少资源标识参数' });
    }
    
    if (isOwner(req.user, resourceUserId)) {
      return next();
    }
    
    return res.status(403).json({ 
      success: false, 
      message: '您没有权限操作此资源' 
    });
  };
};

// 检查用户是否可以修改自己的资料
const canModifyProfile = (req, res, next) => {
  const targetUserId = parseInt(req.params.id || req.body.id);
  
  if (isAdmin(req.user)) {
    return next();
  }
  
  if (targetUserId && targetUserId === req.user.id) {
    return next();
  }
  
  return res.status(403).json({ 
    success: false, 
    message: '您只能修改自己的资料' 
  });
};

// 检查 AI 模型所有权
const canModifyAIModel = async (req, res, next) => {
  const pool = require('./db');
  const modelId = req.params.id || req.body.id;
  
  if (isAdmin(req.user)) {
    return next();
  }
  
  try {
    const [models] = await pool.execute(
      'SELECT user_id FROM ai_models WHERE id = ?',
      [modelId]
    );
    
    if (models.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'AI模型不存在' 
      });
    }
    
    const modelUserId = models[0].user_id;
    if (modelUserId !== null && modelUserId === req.user.id) {
      return next();
    }
    
    return res.status(403).json({ 
      success: false, 
      message: '您没有权限操作此AI模型' 
    });
  } catch (error) {
    logger.error('检查AI模型权限错误', { error: error.message, modelId });
    return res.status(500).json({ 
      success: false, 
      message: '服务器错误' 
    });
  }
};

// 检查 AI 技能编辑/删除权限（管理员或创建者）
const canModifyAISkill = async (req, res, next) => {
  const pool = require('./db');
  const skillId = req.params.id;
  
  if (isAdmin(req.user)) {
    return next();
  }
  
  try {
    const [skills] = await pool.execute(
      'SELECT creator_id, is_system FROM ai_skills WHERE id = ?',
      [skillId]
    );
    
    if (skills.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '技能不存在' 
      });
    }
    
    if (skills[0].is_system) {
      return res.status(403).json({ 
        success: false, 
        message: '系统内置技能不允许修改' 
      });
    }
    
    if (skills[0].creator_id === req.user.id) {
      return next();
    }
    
    return res.status(403).json({ 
      success: false, 
      message: '您没有权限操作此技能' 
    });
  } catch (error) {
    logger.error('检查AI技能权限错误', { error: error.message, skillId });
    return res.status(500).json({ 
      success: false, 
      message: '服务器错误' 
    });
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireAdminOrOwner,
  canModifyProfile,
  canModifyAIModel,
  canModifyAISkill,
  isAdmin,
  isOwner,
  ADMIN_ROLES
};