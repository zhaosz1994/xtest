const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin, isAdmin } = require('../middleware');
const logger = require('../services/logger');
const sandboxExecutor = require('../services/sandboxExecutor');

/**
 * GET /list - 获取工具列表
 * 查询参数: language, is_public, search
 * 非管理员: 查看公开工具 + 自己创建的工具
 * 管理员: 查看所有工具
 */
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const { language, is_public, search } = req.query;
    const userId = req.user.id;
    const admin = isAdmin(req.user);

    let sql = 'SELECT * FROM ai_custom_tools WHERE 1=1';
    const params = [];

    // 非管理员只能看公开工具和自己的工具
    if (!admin) {
      sql += ' AND (is_public = 1 OR creator_id = ?)';
      params.push(userId);
    }

    if (language) {
      sql += ' AND language = ?';
      params.push(language);
    }

    if (is_public !== undefined && is_public !== '') {
      sql += ' AND is_public = ?';
      params.push(Number(is_public));
    }

    if (search) {
      sql += ' AND (tool_name LIKE ? OR display_name LIKE ? OR description LIKE ?)';
      const keyword = `%${search}%`;
      params.push(keyword, keyword, keyword);
    }

    sql += ' ORDER BY created_at DESC';

    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error('获取工具列表失败:', err);
    res.json({ success: false, message: '获取工具列表失败' });
  }
});

/**
 * GET /detail/:toolName - 获取工具详情
 */
router.get('/detail/:toolName', authenticateToken, async (req, res) => {
  try {
    const { toolName } = req.params;
    const userId = req.user.id;
    const admin = isAdmin(req.user);

    const [rows] = await pool.execute(
      'SELECT * FROM ai_custom_tools WHERE tool_name = ?',
      [toolName]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: '工具不存在' });
    }

    const tool = rows[0];

    // 非管理员只能查看公开工具或自己创建的工具
    if (!admin && !tool.is_public && tool.creator_id !== userId) {
      return res.json({ success: false, message: '无权查看该工具' });
    }

    res.json({ success: true, data: tool });
  } catch (err) {
    logger.error('获取工具详情失败:', err);
    res.json({ success: false, message: '获取工具详情失败' });
  }
});

/**
 * POST /create - 创建工具
 * Body: { tool_name, display_name, description, language, code_content, input_schema, is_public, timeout_ms, max_memory_mb, allowed_tables, requires_docker }
 */
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const {
      tool_name,
      display_name,
      description,
      language,
      code_content,
      input_schema,
      is_public,
      timeout_ms,
      max_memory_mb,
      allowed_tables,
      requires_docker
    } = req.body;

    const userId = req.user.id;
    const admin = isAdmin(req.user);

    // 校验必填字段
    if (!tool_name || !tool_name.trim()) {
      return res.json({ success: false, message: '工具名称不能为空' });
    }

    if (!code_content || !code_content.trim()) {
      return res.json({ success: false, message: '代码内容不能为空' });
    }

    // 校验 tool_name 唯一性
    const [existing] = await pool.execute(
      'SELECT id FROM ai_custom_tools WHERE tool_name = ?',
      [tool_name]
    );

    if (existing.length > 0) {
      return res.json({ success: false, message: '工具名称已存在' });
    }

    const is_system = admin && req.body.is_system ? 1 : 0;

    const [result] = await pool.execute(
      `INSERT INTO ai_custom_tools
        (tool_name, display_name, description, language, code_content, input_schema, is_public, is_system, timeout_ms, max_memory_mb, allowed_tables, requires_docker, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tool_name,
        display_name || tool_name,
        description || '',
        language || 'javascript',
        code_content,
        typeof input_schema === 'object' ? JSON.stringify(input_schema) : (input_schema || '{}'),
        is_public !== undefined ? Number(is_public) : 1,
        is_system,
        timeout_ms || 30000,
        max_memory_mb || 128,
        typeof allowed_tables === 'object' ? JSON.stringify(allowed_tables) : (allowed_tables || '[]'),
        requires_docker ? 1 : 0,
        userId
      ]
    );

    res.json({ success: true, data: { id: result.insertId, tool_name } });
  } catch (err) {
    logger.error('创建工具失败:', err);
    res.json({ success: false, message: '创建工具失败' });
  }
});

/**
 * PUT /update/:toolName - 更新工具
 * 只有创建者或管理员可以更新
 */
router.put('/update/:toolName', authenticateToken, async (req, res) => {
  try {
    const { toolName } = req.params;
    const userId = req.user.id;
    const admin = isAdmin(req.user);

    // 查找工具
    const [rows] = await pool.execute(
      'SELECT * FROM ai_custom_tools WHERE tool_name = ?',
      [toolName]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: '工具不存在' });
    }

    const tool = rows[0];

    // 权限校验: 只有创建者或管理员可以更新
    if (!admin && tool.creator_id !== userId) {
      return res.json({ success: false, message: '无权更新该工具' });
    }

    // 构建动态更新字段
    const allowedFields = [
      'display_name', 'description', 'language', 'code_content',
      'input_schema', 'is_public', 'timeout_ms', 'max_memory_mb',
      'allowed_tables', 'requires_docker'
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        let value = req.body[field];

        // JSON 字段序列化
        if ((field === 'input_schema' || field === 'allowed_tables') && typeof value === 'object') {
          value = JSON.stringify(value);
        }

        // 数值字段转换
        if (field === 'is_public') {
          value = Number(value);
        }
        if (field === 'requires_docker') {
          value = value ? 1 : 0;
        }

        updates.push(`${field} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return res.json({ success: false, message: '没有需要更新的字段' });
    }

    // 非管理员不能修改 is_public 为非公开（如果原来是系统工具）
    if (!admin && tool.is_system === 1) {
      return res.json({ success: false, message: '无权修改系统工具' });
    }

    updates.push('updater_id = ?');
    values.push(userId);

    values.push(toolName);

    await pool.execute(
      `UPDATE ai_custom_tools SET ${updates.join(', ')} WHERE tool_name = ?`,
      values
    );

    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    logger.error('更新工具失败:', err);
    res.json({ success: false, message: '更新工具失败' });
  }
});

/**
 * DELETE /:toolName - 删除工具
 * 系统工具(is_system=1)非管理员不能删除
 * 只有创建者或管理员可以删除
 */
router.delete('/:toolName', authenticateToken, async (req, res) => {
  try {
    const { toolName } = req.params;
    const userId = req.user.id;
    const admin = isAdmin(req.user);

    // 查找工具
    const [rows] = await pool.execute(
      'SELECT * FROM ai_custom_tools WHERE tool_name = ?',
      [toolName]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: '工具不存在' });
    }

    const tool = rows[0];

    // 系统工具非管理员不能删除
    if (tool.is_system === 1 && !admin) {
      return res.json({ success: false, message: '系统工具无法删除' });
    }

    // 权限校验: 只有创建者或管理员可以删除
    if (!admin && tool.creator_id !== userId) {
      return res.json({ success: false, message: '无权删除该工具' });
    }

    await pool.execute(
      'DELETE FROM ai_custom_tools WHERE tool_name = ?',
      [toolName]
    );

    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    logger.error('删除工具失败:', err);
    res.json({ success: false, message: '删除工具失败' });
  }
});

/**
 * POST /test-run/:toolName - 测试运行工具
 * Body: { params: {...} }
 */
router.post('/test-run/:toolName', authenticateToken, async (req, res) => {
  try {
    const { toolName } = req.params;
    const { params: runParams } = req.body;
    const userId = req.user.id;
    const admin = isAdmin(req.user);

    // 查找工具
    const [rows] = await pool.execute(
      'SELECT * FROM ai_custom_tools WHERE tool_name = ?',
      [toolName]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: '工具不存在' });
    }

    const tool = rows[0];

    // 权限校验: 非管理员只能运行公开工具或自己创建的工具
    if (!admin && !tool.is_public && tool.creator_id !== userId) {
      return res.json({ success: false, message: '无权运行该工具' });
    }

    const startTime = Date.now();

    // 根据语言选择执行器
    const executionContext = {
      userId,
      userRole: req.user.role,
      username: req.user.username,
      toolName: tool.tool_name,
      toolId: tool.id,
      timeoutMs: tool.timeout_ms || 30000,
      allowedTables: typeof tool.allowed_tables === 'string'
        ? JSON.parse(tool.allowed_tables || '[]')
        : (tool.allowed_tables || [])
    };

    let result;
    const language = tool.language || 'javascript';

    if (language === 'javascript') {
      result = await sandboxExecutor.executeJavaScript(
        tool.code_content,
        runParams || {},
        executionContext
      );
    } else if (language === 'python') {
      result = await sandboxExecutor.executePython(
        tool.code_content,
        runParams || {},
        executionContext
      );
    } else {
      return res.json({ success: false, message: `不支持的语言: ${language}` });
    }

    const executionTimeMs = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        result,
        executionTimeMs
      }
    });
  } catch (err) {
    logger.error('测试运行工具失败:', err);
    res.json({ success: false, message: `测试运行失败: ${err.message}` });
  }
});

module.exports = router;
