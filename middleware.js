const jwt = require('jsonwebtoken');
require('dotenv').config();

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

// 管理员权限中间件（支持中英文角色值判断）
const requireAdmin = (req, res, next) => {
  if (req.user.role !== '管理员' && req.user.role !== 'admin' && req.user.role !== 'Administrator') {
    return res.status(403).json({ message: '需要管理员权限' });
  }
  next();
};

// 检查是否为管理员或资源所有者
const requireAdminOrOwner = (resourceUserIdField = 'userId') => {
  return (req, res, next) => {
    // 支持中英文角色值判断管理员权限
    if (req.user.role === '管理员' || req.user.role === 'admin' || req.user.role === 'Administrator') {
      return next();
    }
    
    const resourceUserId = req.params[resourceUserIdField] || 
                           req.body[resourceUserIdField] || 
                           req.query[resourceUserIdField];
    
    if (resourceUserId && parseInt(resourceUserId) === req.user.id) {
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
  
  // 支持中英文角色值判断管理员权限
  if (req.user.role === '管理员' || req.user.role === 'admin' || req.user.role === 'Administrator') {
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
  
  // 支持中英文角色值判断管理员权限
  if (req.user.role === '管理员' || req.user.role === 'admin' || req.user.role === 'Administrator') {
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
    console.error('检查AI模型权限错误:', error);
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
  
  // 支持中英文角色值判断管理员权限
  if (req.user.role === '管理员' || req.user.role === 'admin' || req.user.role === 'Administrator') {
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
    console.error('检查AI技能权限错误:', error);
    return res.status(500).json({ 
      success: false, 
      message: '服务器错误' 
    });
  }
};

// 辅助函数：判断是否为管理员（支持中英文角色值）
const isAdmin = (user) => {
  return user && (user.role === '管理员' || user.role === 'admin' || user.role === 'Administrator');
};

// 辅助函数：判断是否为资源所有者
const isOwner = (user, resourceUserId) => {
  return user && user.id === parseInt(resourceUserId);
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireAdminOrOwner,
  canModifyProfile,
  canModifyAIModel,
  canModifyAISkill,
  isAdmin,
  isOwner
};