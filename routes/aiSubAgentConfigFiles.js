const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin, isAdmin } = require('../middleware');
const logger = require('../services/logger');

// 合法的 file_type 枚举值
const VALID_FILE_TYPES = ['soul', 'user', 'tools', 'rule', 'checklist', 'examples', 'glossary', 'template', 'custom', 'ref_doc'];

// 核心配置文件类型，不允许删除
const CORE_FILE_TYPES = ['soul', 'user', 'tools'];

// 默认 Soul.md 模板
const DEFAULT_SOUL_TEMPLATE = `# AI 助手

## 身份
你是一名AI助手，专门协助测试团队完成各类任务。

## 核心原则
1. 准确性优先
2. 建设性反馈
3. 规范遵循

## 输出格式
严格按照 JSON 格式输出结果。`;

// 默认 User.md 模板
const DEFAULT_USER_TEMPLATE = `# 用户偏好

## 待处理内容
{{content}}

## 上下文
{{context}}`;

// 默认 Tools.md 模板
const DEFAULT_TOOLS_TEMPLATE = '[]';

// GET /:agentId - 获取代理的配置文件列表（仅元数据+字符数，不返回完整内容）
router.get('/:agentId', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    // 检查代理是否存在
    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    // 权限检查：私有代理仅创建者和管理员可见
    if (!userIsAdmin && agent.visibility === 'private' && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限查看此代理的配置文件' });
    }

    const [configFiles] = await pool.execute(
      `SELECT id, file_type, file_name, content, description, is_required, sort_order, version
       FROM ai_sub_agent_config_files
       WHERE agent_id = ?
       ORDER BY sort_order ASC`,
      [agentId]
    );

    res.json({
      success: true,
      data: configFiles.map(f => ({
        id: f.id,
        file_type: f.file_type,
        file_name: f.file_name,
        content: f.content,
        description: f.description,
        is_required: f.is_required,
        sort_order: f.sort_order,
        version: f.version,
        charCount: f.content ? f.content.length : 0
      }))
    });
  } catch (error) {
    logger.error('获取配置文件列表失败', { error: error.message, agentId: req.params.agentId });
    res.status(500).json({ success: false, message: '获取配置文件列表失败' });
  }
});

// PUT /:agentId/:fileType - 更新配置文件（Upsert：不存在则插入）
router.put('/:agentId/:fileType', authenticateToken, async (req, res) => {
  try {
    const { agentId, fileType } = req.params;
    const { content, description } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    // 检查代理是否存在
    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    // 权限检查：管理员或创建者可以编辑
    if (!userIsAdmin && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限修改此代理的配置文件' });
    }

    // 检查配置文件是否存在
    const [existing] = await pool.execute(
      'SELECT id, version FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
      [agentId, fileType]
    );

    if (existing.length > 0) {
      // 更新已有记录
      const currentVersion = existing[0].version || 1;

      const updates = [];
      const params = [];

      if (content !== undefined) {
        updates.push('content = ?');
        params.push(content);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        params.push(description);
      }

      updates.push('version = ?');
      params.push(currentVersion + 1);

      params.push(agentId, fileType);

      await pool.execute(
        `UPDATE ai_sub_agent_config_files SET ${updates.join(', ')} WHERE agent_id = ? AND file_type = ?`,
        params
      );

      logger.info('配置文件更新成功', { agentId, fileType, userId, newVersion: currentVersion + 1 });
    } else {
      // 不存在则插入
      const fileName = fileType.charAt(0).toUpperCase() + fileType.slice(1);
      await pool.execute(
        `INSERT INTO ai_sub_agent_config_files
          (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
         VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?)`,
        [
          agentId,
          fileType,
          fileName,
          content || '',
          description || '',
          userId
        ]
      );

      logger.info('配置文件创建成功(Upsert)', { agentId, fileType, userId });
    }

    res.json({ success: true, message: '配置文件已更新' });
  } catch (error) {
    logger.error('更新配置文件失败', { error: error.message, agentId: req.params.agentId, fileType: req.params.fileType });
    res.status(500).json({ success: false, message: '更新配置文件失败' });
  }
});

// POST /:agentId - 创建新的配置文件
router.post('/:agentId', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { file_type, file_name, content, description, is_required, sort_order } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    if (!file_type || content === undefined) {
      return res.json({ success: false, message: 'file_type和content为必填项' });
    }

    // 验证 file_type 是否为合法枚举值
    if (!VALID_FILE_TYPES.includes(file_type)) {
      return res.json({
        success: false,
        message: `file_type无效，合法值为: ${VALID_FILE_TYPES.join(', ')}`
      });
    }

    // 检查代理是否存在
    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    // 权限检查
    if (!userIsAdmin && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限添加此代理的配置文件' });
    }

    // 检查同类型文件是否已存在
    const [existing] = await pool.execute(
      'SELECT id FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
      [agentId, file_type]
    );

    if (existing.length > 0) {
      return res.json({ success: false, message: '该类型的配置文件已存在，请使用更新接口' });
    }

    const [result] = await pool.execute(
      `INSERT INTO ai_sub_agent_config_files
        (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        agentId,
        file_type,
        file_name || file_type,
        content,
        description || '',
        is_required || 0,
        sort_order || 0,
        userId
      ]
    );

    logger.info('配置文件添加成功', { agentId, fileType: file_type, userId, fileId: result.insertId });

    res.json({
      success: true,
      data: { id: result.insertId }
    });
  } catch (error) {
    logger.error('添加配置文件失败', { error: error.message, agentId: req.params.agentId });
    if (error.code === 'ER_DUP_ENTRY') {
      return res.json({ success: false, message: '该类型的配置文件已存在' });
    }
    res.status(500).json({ success: false, message: '添加配置文件失败' });
  }
});

// DELETE /:fileId - 删除配置文件
router.delete('/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    // 查找配置文件，同时关联代理获取创建者信息
    const [files] = await pool.execute(
      'SELECT cf.*, a.creator_id AS agent_creator_id FROM ai_sub_agent_config_files cf JOIN ai_sub_agents a ON cf.agent_id = a.id WHERE cf.id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return res.json({ success: false, message: '配置文件不存在' });
    }

    const file = files[0];

    // soul/user/tools 类型的核心配置文件不允许删除
    if (CORE_FILE_TYPES.includes(file.file_type)) {
      return res.json({ success: false, message: 'soul/user/tools 类型的核心配置文件不允许删除' });
    }

    // 权限检查：管理员或代理创建者可以删除
    if (!userIsAdmin && file.agent_creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限删除此配置文件' });
    }

    await pool.execute(
      'DELETE FROM ai_sub_agent_config_files WHERE id = ?',
      [fileId]
    );

    logger.info('配置文件删除成功', { fileId, fileType: file.file_type, userId });

    res.json({ success: true, message: '配置文件已删除' });
  } catch (error) {
    logger.error('删除配置文件失败', { error: error.message, fileId: req.params.fileId });
    res.status(500).json({ success: false, message: '删除配置文件失败' });
  }
});

// POST /init-config-files/:agentId - 初始化默认配置文件（soul, user, tools）
router.post('/init-config-files/:agentId', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    // 检查代理是否存在
    const [agents] = await connection.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    // 权限检查
    if (!userIsAdmin && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限初始化此代理的配置文件' });
    }

    // 检查已有配置文件
    const [existing] = await connection.execute(
      'SELECT file_type FROM ai_sub_agent_config_files WHERE agent_id = ?',
      [agentId]
    );
    const existingTypes = new Set(existing.map(f => f.file_type));

    await connection.beginTransaction();

    const defaultConfigs = [
      {
        file_type: 'soul',
        file_name: 'Soul.md',
        content: DEFAULT_SOUL_TEMPLATE,
        description: '灵魂文件，定义代理的身份、原则和输出格式',
        is_required: 1,
        sort_order: 1
      },
      {
        file_type: 'user',
        file_name: 'User.md',
        content: DEFAULT_USER_TEMPLATE,
        description: '用户偏好文件，定义任务模板和变量插值',
        is_required: 1,
        sort_order: 2
      },
      {
        file_type: 'tools',
        file_name: 'Tools.md',
        content: DEFAULT_TOOLS_TEMPLATE,
        description: '工具配置文件，定义代理可调用的工具列表',
        is_required: 1,
        sort_order: 3
      }
    ];

    let createdCount = 0;

    for (const config of defaultConfigs) {
      if (!existingTypes.has(config.file_type)) {
        await connection.execute(
          `INSERT INTO ai_sub_agent_config_files
            (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [agentId, config.file_type, config.file_name, config.content, config.description, config.is_required, config.sort_order, userId]
        );
        createdCount++;
      }
    }

    await connection.commit();

    logger.info('初始化默认配置文件完成', { agentId, createdCount, userId });

    res.json({ success: true, message: '默认配置文件已初始化' });
  } catch (error) {
    await connection.rollback();
    logger.error('初始化默认配置文件失败', { error: error.message, agentId: req.params.agentId });
    res.status(500).json({ success: false, message: '初始化默认配置文件失败' });
  } finally {
    connection.release();
  }
});

module.exports = router;
