const express = require('express');
const router = express.Router();
const pool = require('../db');
const aiReadOnlyPool = require('../db-ai-readonly');
const vm = require('vm');
const { authenticateToken, requireAdmin, canModifyAISkill, isAdmin } = require('../middleware');
const { validateSQL, extractTablesFromSQL } = require('../services/sqlSecurityValidator');
const { createSecureExecutor, getUserProjects } = require('../services/dataIsolationMiddleware');
const aiAuditLogger = require('../services/aiAuditLogger');
const { encryptAPIKey, decryptAPIKey, isEncrypted } = require('../services/apiKeyEncryption');
const logger = require('../services/logger');

const SAFE_GLOBALS = ['console', 'Date', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Promise', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet'];

const DANGEROUS_PATTERNS = [
    /require\s*\(/i,
    /import\s+/i,
    /process\s*\./i,
    /global\s*\./i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /AsyncFunction\s*\(/i,
    /child_process/i,
    /fs\s*\.\s*(read|write|unlink|mkdir|rmdir|rm)/i,
    /__dirname/i,
    /__filename/i,
    /prototype\s*\[\s*['"]constructor['"]\s*\]/i,
    /constructor\s*\(/i,
    /this\s*\.\s*constructor/i,
    /\[\s*['"]constructor['"]\s*\]/i
];

function validateCodeSecurity(code) {
    if (!code || typeof code !== 'string') {
        throw new Error('代码不能为空');
    }
    
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(code)) {
            throw new Error(`代码包含不允许的模式: ${pattern.source}`);
        }
    }
}

async function createSafeSandbox(userId, userRole, username, skillName, skillId) {
    const secureExecutor = await createSecureExecutor(userId, userRole);
    
    const sandbox = {
        console: {
            log: (...args) => console.log('[Skill]', ...args),
            error: (...args) => console.error('[Skill]', ...args),
            warn: (...args) => console.warn('[Skill]', ...args),
            info: (...args) => console.info('[Skill]', ...args)
        },
        Date: Date,
        Math: Math,
        JSON: JSON,
        Object: Object,
        Array: Array,
        String: String,
        Number: Number,
        Boolean: Boolean,
        Error: Error,
        TypeError: TypeError,
        Promise: Promise,
        Map: Map,
        Set: Set,
        db: {
            query: async (sql, params) => {
                const startTime = Date.now();
                let result = null;
                let error = null;
                
                try {
                    const validation = validateSQL(sql, params || []);
                    
                    if (!validation.valid) {
                        throw new Error(`SQL验证失败: ${validation.errors.join('; ')}`);
                    }
                    
                    result = await secureExecutor.query(sql, params || []);
                    
                    const executionTimeMs = Date.now() - startTime;
                    
                    await aiAuditLogger.logSuccess({
                        userId,
                        username,
                        skillName,
                        skillId,
                        operationType: 'SELECT',
                        sqlQuery: sql,
                        sqlParams: params,
                        tablesAccessed: validation.tables,
                        resultCount: result ? result.length : 0,
                        executionTimeMs,
                        status: 'success'
                    });
                    
                    return result;
                    
                } catch (err) {
                    error = err;
                    
                    const executionTimeMs = Date.now() - startTime;
                    
                    await aiAuditLogger.logFailure({
                        userId,
                        username,
                        skillName,
                        skillId,
                        operationType: 'SELECT',
                        sqlQuery: sql,
                        sqlParams: params,
                        tablesAccessed: [],
                        resultCount: 0,
                        executionTimeMs,
                        errorMessage: err.message,
                        status: 'failed'
                    });
                    
                    throw new Error(`数据库查询错误: ${err.message}`);
                }
            }
        }
    };
    
    Object.freeze(sandbox.console);
    Object.freeze(sandbox.db);
    
    return vm.createContext(sandbox);
}

router.get('/list', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    const { category, enabled } = req.query;
    
    let whereClause = '1=1';
    const params = [];
    
    if (currentUserRole !== '管理员') {
      whereClause += ' AND (s.is_public = TRUE OR s.creator_id = ?)';
      params.push(currentUserId);
    }
    
    if (category) {
      whereClause += ' AND s.category = ?';
      params.push(category);
    }
    
    if (enabled !== undefined) {
      whereClause += ' AND uss.is_enabled = ?';
      params.push(enabled === 'true');
    }
    
    const query = `
      SELECT 
        s.id,
        s.name,
        s.display_name,
        s.description,
        s.definition,
        s.execute_code,
        s.category,
        s.is_public,
        s.is_system,
        s.creator_id,
        s.updater_id,
        s.created_at,
        s.updated_at,
        COALESCE(uss.is_enabled, s.is_enabled) as is_enabled,
        creator.username as creator_name,
        updater.username as updater_name
      FROM ai_skills s
      LEFT JOIN users creator ON s.creator_id = creator.id
      LEFT JOIN users updater ON s.updater_id = updater.id
      LEFT JOIN user_skill_settings uss ON uss.skill_id = s.id AND uss.user_id = ?
      WHERE ${whereClause}
      ORDER BY s.created_at DESC
    `;
    
    params.unshift(currentUserId);
    
    const [skills] = await pool.execute(query, params);
    
    res.json({
      success: true,
      skills: skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        displayName: skill.display_name,
        description: skill.description,
        definition: typeof skill.definition === 'string' ? JSON.parse(skill.definition) : skill.definition,
        executeCode: skill.execute_code,
        category: skill.category,
        isPublic: skill.is_public,
        isSystem: skill.is_system,
        isEnabled: skill.is_enabled,
        creatorId: skill.creator_id,
        updaterId: skill.updater_id,
        creatorName: skill.creator_name,
        updaterName: skill.updater_name,
        createdAt: skill.created_at,
        updatedAt: skill.updated_at,
        isCreator: skill.creator_id === currentUserId,
        canEdit: currentUserRole === '管理员' || skill.creator_id === currentUserId,
        canDelete: currentUserRole === '管理员' || skill.creator_id === currentUserId
      })),
      currentUser: {
        id: currentUserId,
        role: currentUserRole
      }
    });
  } catch (error) {
    logger.error('获取AI技能列表错误:', { error: error.message });
    res.status(500).json({ success: false, message: '获取技能列表失败' });
  }
});

router.get('/detail/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;
    
    const [skills] = await pool.execute(`
      SELECT 
        s.*,
        creator.username as creator_name,
        updater.username as updater_name,
        COALESCE(uss.is_enabled, s.is_enabled) as user_enabled
      FROM ai_skills s
      LEFT JOIN users creator ON s.creator_id = creator.id
      LEFT JOIN users updater ON s.updater_id = updater.id
      LEFT JOIN user_skill_settings uss ON uss.skill_id = s.id AND uss.user_id = ?
      WHERE s.id = ?
    `, [currentUserId, id]);
    
    if (skills.length === 0) {
      return res.json({ success: false, message: '技能不存在' });
    }
    
    const skill = skills[0];
    
    if (!skill.is_public && skill.creator_id !== currentUserId && req.user.role !== '管理员') {
      return res.status(403).json({ success: false, message: '您没有权限查看此技能' });
    }
    
    res.json({
      success: true,
      skill: {
        id: skill.id,
        name: skill.name,
        displayName: skill.display_name,
        description: skill.description,
        definition: typeof skill.definition === 'string' ? JSON.parse(skill.definition) : skill.definition,
        executeCode: skill.execute_code,
        category: skill.category,
        isPublic: skill.is_public,
        isSystem: skill.is_system,
        isEnabled: skill.user_enabled,
        creatorId: skill.creator_id,
        updaterId: skill.updater_id,
        creatorName: skill.creator_name,
        updaterName: skill.updater_name,
        createdAt: skill.created_at,
        updatedAt: skill.updated_at,
        isCreator: skill.creator_id === currentUserId,
        canEdit: req.user.role === '管理员' || skill.creator_id === currentUserId,
        canDelete: req.user.role === '管理员' || skill.creator_id === currentUserId
      }
    });
  } catch (error) {
    logger.error('获取AI技能详情错误:', { error: error.message });
    res.status(500).json({ success: false, message: '获取技能详情失败' });
  }
});

router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { 
      name, 
      displayName, 
      description, 
      definition, 
      executeCode, 
      category, 
      makePublicAndEnableAll 
    } = req.body;
    
    const currentUserId = req.user.id;
    
    if (!name || !definition || !executeCode) {
      return res.json({ 
        success: false, 
        message: '技能名称、定义和执行代码为必填项' 
      });
    }
    
    let definitionJson;
    try {
      definitionJson = typeof definition === 'string' ? JSON.parse(definition) : definition;
    } catch (e) {
      return res.json({ success: false, message: '技能定义必须是有效的 JSON 格式' });
    }
    
    try {
      validateCodeSecurity(executeCode);
    } catch (error) {
      return res.json({ 
        success: false, 
        message: `执行代码安全检查失败: ${error.message}` 
      });
    }
    
    const isPublic = makePublicAndEnableAll === true;
    
    const [result] = await pool.execute(
      `INSERT INTO ai_skills 
       (name, display_name, description, definition, execute_code, category, is_enabled, is_public, creator_id, updater_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, displayName || name, description || '', JSON.stringify(definitionJson), executeCode, category || 'general', true, isPublic, currentUserId, currentUserId]
    );
    
    const skillId = result.insertId;
    
    if (isPublic) {
      await pool.execute(`
        INSERT IGNORE INTO user_skill_settings (user_id, skill_id, is_enabled)
        SELECT id, ?, TRUE FROM users
      `, [skillId]);
    } else {
      await pool.execute(`
        INSERT INTO user_skill_settings (user_id, skill_id, is_enabled)
        VALUES (?, ?, TRUE)
      `, [currentUserId, skillId]);
    }
    
    res.json({
      success: true,
      message: '技能创建成功',
      skillId: skillId
    });
  } catch (error) {
    logger.error('创建AI技能错误:', { error: error.message });
    if (error.code === 'ER_DUP_ENTRY') {
      return res.json({ success: false, message: '技能名称已存在' });
    }
    res.status(500).json({ success: false, message: '创建技能失败: ' + error.message });
  }
});

router.put('/update/:id', authenticateToken, canModifyAISkill, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      displayName, 
      description, 
      definition, 
      executeCode, 
      category, 
      isPublic 
    } = req.body;
    const currentUserId = req.user.id;
    
    const [skills] = await pool.execute('SELECT is_system, creator_id FROM ai_skills WHERE id = ?', [id]);
    if (skills.length === 0) {
      return res.json({ success: false, message: '技能不存在' });
    }
    
    if (skills[0].is_system && executeCode) {
      return res.json({ success: false, message: '系统内置技能不允许修改执行代码' });
    }
    
    let definitionJson = null;
    if (definition) {
      try {
        definitionJson = typeof definition === 'string' ? JSON.parse(definition) : definition;
      } catch (e) {
        return res.json({ success: false, message: '技能定义必须是有效的 JSON 格式' });
      }
    }
    
    if (executeCode) {
      try {
        validateCodeSecurity(executeCode);
      } catch (error) {
        return res.json({ 
          success: false, 
          message: `执行代码安全检查失败: ${error.message}` 
        });
      }
    }
    
    const updates = [];
    const params = [];
    
    if (name) { updates.push('name = ?'); params.push(name); }
    if (displayName) { updates.push('display_name = ?'); params.push(displayName); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (definitionJson) { updates.push('definition = ?'); params.push(JSON.stringify(definitionJson)); }
    if (executeCode) { updates.push('execute_code = ?'); params.push(executeCode); }
    if (category) { updates.push('category = ?'); params.push(category); }
    if (isPublic !== undefined) { updates.push('is_public = ?'); params.push(isPublic); }
    
    updates.push('updater_id = ?');
    params.push(currentUserId);
    
    if (updates.length === 1) {
      return res.json({ success: false, message: '没有需要更新的字段' });
    }
    
    params.push(id);
    
    await pool.execute(
      `UPDATE ai_skills SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    res.json({ success: true, message: '技能更新成功' });
  } catch (error) {
    logger.error('更新AI技能错误:', { error: error.message });
    res.status(500).json({ success: false, message: '更新技能失败: ' + error.message });
  }
});

router.delete('/:id', authenticateToken, canModifyAISkill, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [skills] = await pool.execute('SELECT is_system, name FROM ai_skills WHERE id = ?', [id]);
    if (skills.length === 0) {
      return res.json({ success: false, message: '技能不存在' });
    }
    
    if (skills[0].is_system) {
      return res.json({ success: false, message: '系统内置技能不允许删除' });
    }
    
    await pool.execute('DELETE FROM ai_skills WHERE id = ?', [id]);
    
    res.json({ success: true, message: '技能删除成功' });
  } catch (error) {
    logger.error('删除AI技能错误:', { error: error.message });
    res.status(500).json({ success: false, message: '删除技能失败' });
  }
});

router.post('/toggle/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;
    
    const [skills] = await pool.execute(
      'SELECT id FROM ai_skills WHERE id = ? AND (is_public = TRUE OR creator_id = ?)',
      [id, currentUserId]
    );
    if (skills.length === 0) {
      return res.json({ success: false, message: '技能不存在或无权访问' });
    }
    
    const [settings] = await pool.execute(
      'SELECT is_enabled FROM user_skill_settings WHERE user_id = ? AND skill_id = ?',
      [currentUserId, id]
    );
    
    const newStatus = settings.length === 0 ? false : !settings[0].is_enabled;
    
    await pool.execute(`
      INSERT INTO user_skill_settings (user_id, skill_id, is_enabled)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)
    `, [currentUserId, id, newStatus]);
    
    res.json({ 
      success: true, 
      message: newStatus ? '技能已启用' : '技能已禁用',
      isEnabled: newStatus
    });
  } catch (error) {
    logger.error('切换技能状态错误:', { error: error.message });
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

async function getEnabledSkillsAsTools(userId) {
  try {
    if (userId === undefined || userId === null) {
      logger.error('getEnabledSkillsAsTools: userId 不能为空');
      return [];
    }
    
    const query = `
      SELECT s.name, s.definition
      FROM ai_skills s
      LEFT JOIN user_skill_settings uss ON uss.skill_id = s.id AND uss.user_id = ?
      WHERE (s.is_public = TRUE OR s.creator_id = ?)
        AND COALESCE(uss.is_enabled, s.is_enabled) = TRUE
    `;
    
    const [skills] = await pool.execute(query, [userId, userId]);
    
    return skills.map(skill => {
      const definition = typeof skill.definition === 'string' 
        ? JSON.parse(skill.definition) 
        : skill.definition;
      return definition;
    });
  } catch (error) {
    logger.error('获取启用的技能失败:', { error: error.message });
    return [];
  }
}

async function executeSkillCode(skillName, args, context = {}) {
  const { userId, username, userRole } = context;
  
  try {
    const [skills] = await pool.execute(
      'SELECT execute_code, name, id FROM ai_skills WHERE name = ? AND is_enabled = TRUE',
      [skillName]
    );
    
    if (skills.length === 0) {
      return { error: `技能 "${skillName}" 不存在或未启用` };
    }
    
    const executeCode = skills[0].execute_code;
    const skillId = skills[0].id;
    
    try {
      validateCodeSecurity(executeCode);
    } catch (error) {
      return { error: `安全检查失败: ${error.message}` };
    }
    
    const sandbox = await createSafeSandbox(userId, userRole, username, skillName, skillId);
    sandbox.args = args;
    Object.assign(sandbox, context);
    
    const script = new vm.Script(executeCode);
    const result = await script.runInContext(sandbox, { timeout: 10000 });
    
    return result;
    
  } catch (error) {
    console.error(`执行技能 "${skillName}" 错误:`, error);
    return { error: `执行技能失败: ${error.message}` };
  }
}

async function executeMultipleSkills(toolCalls, context) {
  const results = [];
  
  for (const call of toolCalls) {
    const skillName = call.function.name;
    const args = JSON.parse(call.function.arguments);
    
    const result = await executeSkillCode(skillName, args, context);
    
    results.push({
      tool_call_id: call.id,
      name: skillName,
      result: result
    });
  }
  
  return results;
}

module.exports = {
  router,
  getEnabledSkillsAsTools,
  executeSkillCode,
  executeMultipleSkills
};
