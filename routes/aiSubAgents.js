const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin, isAdmin } = require('../middleware');
const logger = require('../services/logger');
const memoryEngine = require('../services/memoryEngine');

// GET /list - 获取Sub-Agent列表（含Override逻辑）
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);
    const { category, is_enabled, creator_only } = req.query;

    // 1. 获取所有系统代理（is_system=1）
    let systemQuery = 'SELECT * FROM ai_sub_agents WHERE is_system = 1';
    const systemParams = [];
    if (category) {
      systemQuery += ' AND category = ?';
      systemParams.push(category);
    }
    if (is_enabled !== undefined) {
      systemQuery += ' AND is_enabled = ?';
      systemParams.push(is_enabled === 'true' ? 1 : 0);
    }
    systemQuery += ' ORDER BY created_at ASC';
    const [systemAgents] = await pool.execute(systemQuery, systemParams);

    // 2. 获取用户的私有覆盖代理（creator_id=userId, is_system=0）
    let privateQuery = 'SELECT * FROM ai_sub_agents WHERE creator_id = ? AND is_system = 0';
    const privateParams = [userId];
    if (category) {
      privateQuery += ' AND category = ?';
      privateParams.push(category);
    }
    if (is_enabled !== undefined) {
      privateQuery += ' AND is_enabled = ?';
      privateParams.push(is_enabled === 'true' ? 1 : 0);
    }
    privateQuery += ' ORDER BY created_at ASC';
    const [privateAgents] = await pool.execute(privateQuery, privateParams);

    // 3. Override逻辑：对于每个agent_code，如果用户有私有覆盖，则显示私有覆盖
    const privateOverrideMap = new Map();
    for (const pa of privateAgents) {
      privateOverrideMap.set(pa.agent_code, pa);
    }

    const result = [];

    // 处理系统代理
    for (const sa of systemAgents) {
      const overridden = privateOverrideMap.has(sa.agent_code);
      if (overridden) {
        const override = privateOverrideMap.get(sa.agent_code);
        result.push({
          ...override,
          is_overridden: true,
          system_id: sa.id,
          system_display_name: sa.display_name
        });
        privateOverrideMap.delete(sa.agent_code);
      } else {
        result.push({
          ...sa,
          is_overridden: false
        });
      }
    }

    // 添加剩余的私有代理（agent_code不与系统代理冲突的）
    for (const [agentCode, pa] of privateOverrideMap) {
      result.push({
        ...pa,
        is_overridden: false
      });
    }

    // 非管理员只能看到 public + 自己的 private
    let filtered = userIsAdmin
      ? result
      : result.filter(a => a.visibility === 'public' || a.creator_id === userId);

    // creator_only: 只返回当前用户创建的代理
    if (creator_only === 'true' || creator_only === '1') {
      filtered = filtered.filter(a => a.creator_id === userId);
    }

    res.json({
      success: true,
      data: filtered.map(a => ({
        id: a.id,
        agentCode: a.agent_code,
        displayName: a.display_name,
        description: a.description,
        category: a.category,
        isSystem: a.is_system,
        allowQa: a.allow_qa,
        isEnabled: a.is_enabled,
        creatorId: a.creator_id,
        visibility: a.visibility,
        memoryEnabled: a.memory_enabled,
        memoryDistillThreshold: a.memory_distill_threshold,
        isOverridden: a.is_overridden || false,
        systemId: a.system_id || null,
        systemDisplayName: a.system_display_name || null,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        canEdit: userIsAdmin || a.creator_id === userId,
        canDelete: userIsAdmin || a.creator_id === userId,
        canOverride: !userIsAdmin && a.is_system === 1 && !a.is_overridden
      }))
    });
  } catch (error) {
    logger.error('获取Sub-Agent列表失败', { error: error.message });
    res.status(500).json({ success: false, message: '获取Sub-Agent列表失败' });
  }
});

// GET /detail/:agentCode - 获取Agent详情 + 配置文件 + 记忆统计
router.get('/detail/:agentCode', authenticateToken, async (req, res) => {
  try {
    const { agentCode } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    // Override逻辑：优先查找用户的私有覆盖
    let agent = null;
    let isOverridden = false;

    // 查找用户的私有覆盖
    const [privateAgents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE agent_code = ? AND creator_id = ? AND is_system = 0 LIMIT 1',
      [agentCode, userId]
    );
    if (privateAgents.length > 0) {
      agent = privateAgents[0];
      isOverridden = true;
    }

    // 如果没有私有覆盖，查找系统默认
    if (!agent) {
      const [systemAgents] = await pool.execute(
        'SELECT * FROM ai_sub_agents WHERE agent_code = ? AND is_system = 1 LIMIT 1',
        [agentCode]
      );
      if (systemAgents.length > 0) {
        agent = systemAgents[0];
      }
    }

    // 如果还是没有，查找其他公开代理
    if (!agent) {
      const [publicAgents] = await pool.execute(
        "SELECT * FROM ai_sub_agents WHERE agent_code = ? AND visibility = 'public' AND is_enabled = 1 LIMIT 1",
        [agentCode]
      );
      if (publicAgents.length > 0) {
        agent = publicAgents[0];
      }
    }

    if (!agent) {
      return res.json({ success: false, message: '代理不存在' });
    }

    // 权限检查：非管理员不能查看他人的私有代理
    if (!userIsAdmin && agent.visibility === 'private' && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限查看此代理' });
    }

    // 获取配置文件
    const [configFiles] = await pool.execute(
      'SELECT id, file_type, file_name, content, description, is_required, sort_order, version FROM ai_sub_agent_config_files WHERE agent_id = ? ORDER BY sort_order ASC',
      [agent.id]
    );

    // 获取记忆统计（通过memoryEngine）
    const memoryStats = await memoryEngine.getMemoryStats(agent.id);

    res.json({
      success: true,
      data: {
        agent: {
          id: agent.id,
          agentCode: agent.agent_code,
          displayName: agent.display_name,
          description: agent.description,
          category: agent.category,
          isSystem: agent.is_system,
          allowQa: agent.allow_qa,
          isEnabled: agent.is_enabled,
          creatorId: agent.creator_id,
          visibility: agent.visibility,
          memoryEnabled: agent.memory_enabled,
          memoryDistillThreshold: agent.memory_distill_threshold,
          isOverridden,
          createdAt: agent.created_at,
          updatedAt: agent.updated_at,
          canEdit: userIsAdmin || agent.creator_id === userId,
          canDelete: userIsAdmin || agent.creator_id === userId,
          canOverride: !userIsAdmin && agent.is_system === 1 && !isOverridden
        },
        configFiles: configFiles.map(f => ({
          id: f.id,
          fileType: f.file_type,
          fileName: f.file_name,
          content: f.content,
          description: f.description,
          isRequired: f.is_required,
          sortOrder: f.sort_order,
          version: f.version
        })),
        memoryStats
      }
    });
  } catch (error) {
    logger.error('获取Sub-Agent详情失败', { error: error.message, agentCode: req.params.agentCode });
    res.status(500).json({ success: false, message: '获取代理详情失败' });
  }
});

// POST /create - 创建新的Sub-Agent（元数据 + 配置文件在单个事务中）
router.post('/create', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const {
      agent_code, display_name, description, category,
      allow_qa, memory_enabled, memory_distill_threshold,
      is_enabled, configFiles
    } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    // 验证必填字段
    if (!agent_code || !display_name) {
      return res.json({ success: false, message: '代理编码和显示名称为必填项' });
    }

    await connection.beginTransaction();

    // 检查agent_code是否已存在
    const [existing] = await connection.execute(
      'SELECT id FROM ai_sub_agents WHERE agent_code = ? AND (creator_id = ? OR is_system = 1)',
      [agent_code, userId]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return res.json({ success: false, message: '代理编码已存在' });
    }

    // 确定是否为系统代理
    const isSystem = userIsAdmin && req.body.is_system ? 1 : 0;
    const visibility = isSystem ? 'public' : 'private';
    const creatorId = isSystem ? null : userId;

    // 插入代理记录
    const [result] = await connection.execute(
      `INSERT INTO ai_sub_agents
        (agent_code, display_name, description, category, is_system, allow_qa, is_enabled, creator_id, visibility, memory_enabled, memory_distill_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agent_code,
        display_name,
        description || '',
        category || 'qa_assistant',
        isSystem,
        allow_qa !== undefined ? allow_qa : 1,
        is_enabled !== undefined ? is_enabled : 1,
        creatorId,
        visibility,
        memory_enabled !== undefined ? memory_enabled : 1,
        memory_distill_threshold || 2000
      ]
    );

    const agentId = result.insertId;

    // 处理配置文件：支持对象格式 { soul, user, tools, checklist, examples } 和数组格式
    const filesToInsert = [];

    if (configFiles && typeof configFiles === 'object' && !Array.isArray(configFiles)) {
      // 对象格式：{ soul: '...', user: '...', tools: '...', checklist: '...', examples: '...' }
      const fileTypeMap = {
        soul: { fileName: 'Soul.md', description: '灵魂文件，定义代理的身份、原则和输出格式', isRequired: 1, sortOrder: 1 },
        user: { fileName: 'User.md', description: '用户偏好文件，定义任务模板和变量插值', isRequired: 1, sortOrder: 2 },
        tools: { fileName: 'Tools.md', description: '工具配置文件，定义代理可调用的工具列表', isRequired: 1, sortOrder: 3 },
        checklist: { fileName: 'Checklist.md', description: '检查清单文件，定义代理的输出检查规则', isRequired: 0, sortOrder: 4 },
        examples: { fileName: 'Examples.md', description: '示例文件，定义代理的输入输出示例', isRequired: 0, sortOrder: 5 }
      };

      for (const [fileType, content] of Object.entries(configFiles)) {
        if (content !== undefined && content !== null && content !== '') {
          const meta = fileTypeMap[fileType] || { fileName: fileType, description: '', isRequired: 0, sortOrder: filesToInsert.length + 1 };
          filesToInsert.push({
            file_type: fileType,
            file_name: meta.fileName,
            content: typeof content === 'string' ? content : JSON.stringify(content),
            description: meta.description,
            is_required: meta.isRequired,
            sort_order: meta.sortOrder
          });
        }
      }
    } else if (configFiles && Array.isArray(configFiles)) {
      // 数组格式（兼容旧接口）
      for (let i = 0; i < configFiles.length; i++) {
        const cf = configFiles[i];
        if (cf.file_type && cf.content) {
          filesToInsert.push({
            file_type: cf.file_type,
            file_name: cf.file_name || cf.file_type,
            content: cf.content,
            description: cf.description || '',
            is_required: cf.is_required || 0,
            sort_order: cf.sort_order || (i + 1)
          });
        }
      }
    }

    // 插入配置文件
    for (const cf of filesToInsert) {
      await connection.execute(
        `INSERT INTO ai_sub_agent_config_files
          (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [agentId, cf.file_type, cf.file_name, cf.content, cf.description, cf.is_required, cf.sort_order, userId]
      );
    }

    await connection.commit();

    logger.info('Sub-Agent创建成功', { agentId, agentCode: agent_code, userId, isSystem });

    res.json({
      success: true,
      data: {
        agentId,
        agentCode: agent_code,
        isSystem: !!isSystem,
        visibility
      }
    });
  } catch (error) {
    if (connection) await connection.rollback();
    logger.error('创建Sub-Agent失败', { error: error.message });
    if (error.code === 'ER_DUP_ENTRY') {
      return res.json({ success: false, message: '代理编码已存在' });
    }
    res.status(500).json({ success: false, message: '创建代理失败' });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /update/:id - 更新代理（含Override逻辑）
router.put('/update/:id', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { id } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    const {
      display_name, description, category,
      allow_qa, memory_enabled, memory_distill_threshold,
      is_enabled, configFiles
    } = req.body;

    // 查找当前代理
    const [agents] = await connection.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [id]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    await connection.beginTransaction();

    if (agent.is_system === 1 && !userIsAdmin) {
      // 非管理员修改系统代理 -> 创建私有覆盖
      // 检查是否已有私有覆盖
      const [existingOverride] = await connection.execute(
        'SELECT id FROM ai_sub_agents WHERE agent_code = ? AND creator_id = ? AND is_system = 0',
        [agent.agent_code, userId]
      );

      if (existingOverride.length > 0) {
        // 已有覆盖，更新覆盖记录
        const overrideId = existingOverride[0].id;

        const updates = [];
        const params = [];

        if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
        if (description !== undefined) { updates.push('description = ?'); params.push(description); }
        if (category !== undefined) { updates.push('category = ?'); params.push(category); }
        if (allow_qa !== undefined) { updates.push('allow_qa = ?'); params.push(allow_qa); }
        if (memory_enabled !== undefined) { updates.push('memory_enabled = ?'); params.push(memory_enabled); }
        if (memory_distill_threshold !== undefined) { updates.push('memory_distill_threshold = ?'); params.push(memory_distill_threshold); }
        if (is_enabled !== undefined) { updates.push('is_enabled = ?'); params.push(is_enabled); }

        if (updates.length > 0) {
          params.push(overrideId);
          await connection.execute(
            `UPDATE ai_sub_agents SET ${updates.join(', ')} WHERE id = ?`,
            params
          );
        }

        // 更新覆盖的配置文件
        if (configFiles) {
          await _upsertConfigFiles(connection, overrideId, configFiles, userId);
        }

        await connection.commit();
        logger.info('更新私有覆盖代理成功', { overrideId, agentCode: agent.agent_code, userId });

        res.json({
          success: true,
          data: {
            isOverride: true,
            agentId: overrideId
          }
        });
      } else {
        // 创建新的私有覆盖
        const [overrideResult] = await connection.execute(
          `INSERT INTO ai_sub_agents
            (agent_code, display_name, description, category, is_system, allow_qa, is_enabled, creator_id, visibility, memory_enabled, memory_distill_threshold)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'private', ?, ?)`,
          [
            agent.agent_code,
            display_name || agent.display_name,
            description !== undefined ? description : agent.description,
            category || agent.category,
            allow_qa !== undefined ? allow_qa : agent.allow_qa,
            is_enabled !== undefined ? is_enabled : agent.is_enabled,
            userId,
            memory_enabled !== undefined ? memory_enabled : agent.memory_enabled,
            memory_distill_threshold || agent.memory_distill_threshold
          ]
        );

        const overrideId = overrideResult.insertId;

        // 复制系统代理的配置文件到私有覆盖
        const [systemConfigFiles] = await connection.execute(
          'SELECT file_type, file_name, content, description, is_required, sort_order FROM ai_sub_agent_config_files WHERE agent_id = ?',
          [id]
        );

        // 解析用户提交的configFiles（可能是对象格式或数组格式）
        const userConfigMap = _parseConfigFilesMap(configFiles);

        for (const cf of systemConfigFiles) {
          // 检查用户提交的configFiles中是否有同类型的覆盖
          const userOverride = userConfigMap.get(cf.file_type);
          const content = userOverride ? userOverride.content : cf.content;
          const desc = userOverride ? (userOverride.description || cf.description) : cf.description;

          await connection.execute(
            `INSERT INTO ai_sub_agent_config_files
              (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [overrideId, cf.file_type, cf.file_name, content, desc, cf.is_required, cf.sort_order, userId]
          );
        }

        // 添加用户提交的新配置文件（系统代理中没有的）
        for (const [fileType, cfData] of userConfigMap) {
          if (!systemConfigFiles.find(scf => scf.file_type === fileType)) {
            await connection.execute(
              `INSERT INTO ai_sub_agent_config_files
                (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
              [overrideId, fileType, cfData.file_name || fileType, cfData.content, cfData.description || '', cfData.is_required || 0, cfData.sort_order || 0, userId]
            );
          }
        }

        await connection.commit();
        logger.info('创建私有覆盖代理成功', { overrideId, agentCode: agent.agent_code, userId });

        res.json({
          success: true,
          data: {
            isOverride: true,
            agentId: overrideId
          }
        });
      }
    } else {
      // 管理员或修改自己的私有代理 -> 直接更新
      if (!userIsAdmin && agent.creator_id !== userId) {
        await connection.rollback();
        return res.status(403).json({ success: false, message: '您没有权限修改此代理' });
      }

      const updates = [];
      const params = [];

      if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
      if (description !== undefined) { updates.push('description = ?'); params.push(description); }
      if (category !== undefined) { updates.push('category = ?'); params.push(category); }
      if (allow_qa !== undefined) { updates.push('allow_qa = ?'); params.push(allow_qa); }
      if (memory_enabled !== undefined) { updates.push('memory_enabled = ?'); params.push(memory_enabled); }
      if (memory_distill_threshold !== undefined) { updates.push('memory_distill_threshold = ?'); params.push(memory_distill_threshold); }
      if (is_enabled !== undefined) { updates.push('is_enabled = ?'); params.push(is_enabled); }

      if (updates.length > 0) {
        params.push(id);
        await connection.execute(
          `UPDATE ai_sub_agents SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
      }

      // 更新配置文件
      if (configFiles) {
        await _upsertConfigFiles(connection, parseInt(id), configFiles, userId);
      }

      await connection.commit();
      logger.info('更新代理成功', { agentId: id, userId });

      res.json({
        success: true,
        data: {
          isOverride: false,
          agentId: parseInt(id)
        }
      });
    }
  } catch (error) {
    if (connection) await connection.rollback();
    logger.error('更新Sub-Agent失败', { error: error.message, id: req.params.id });
    res.status(500).json({ success: false, message: '更新代理失败' });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /override/:agentCode - 恢复为系统默认（删除私有覆盖）
router.delete('/override/:agentCode', authenticateToken, async (req, res) => {
  try {
    const { agentCode } = req.params;
    const userId = req.user.id;

    // 查找用户的私有覆盖
    const [overrides] = await pool.execute(
      'SELECT id, agent_code FROM ai_sub_agents WHERE agent_code = ? AND creator_id = ? AND is_system = 0',
      [agentCode, userId]
    );

    if (overrides.length === 0) {
      return res.json({ success: false, message: '您没有此代理的私有覆盖' });
    }

    // 删除私有覆盖记录（CASCADE会自动删除关联的配置文件）
    await pool.execute(
      'DELETE FROM ai_sub_agents WHERE id = ?',
      [overrides[0].id]
    );

    logger.info('删除私有覆盖，恢复系统默认', { agentCode, userId, deletedId: overrides[0].id });

    res.json({
      success: true,
      data: {
        agentCode,
        deletedId: overrides[0].id
      }
    });
  } catch (error) {
    logger.error('删除私有覆盖失败', { error: error.message, agentCode: req.params.agentCode });
    res.status(500).json({ success: false, message: '恢复系统默认失败' });
  }
});

// POST /toggle/:id - 切换is_enabled状态
router.post('/toggle/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [id]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    // 非管理员只能切换自己的私有代理
    if (!userIsAdmin && (agent.is_system === 1 || agent.creator_id !== userId)) {
      return res.status(403).json({ success: false, message: '您只能切换自己创建的私有代理' });
    }

    const newStatus = agent.is_enabled ? 0 : 1;

    await pool.execute(
      'UPDATE ai_sub_agents SET is_enabled = ? WHERE id = ?',
      [newStatus, id]
    );

    res.json({
      success: true,
      data: {
        agentId: parseInt(id),
        isEnabled: !!newStatus
      }
    });
  } catch (error) {
    logger.error('切换代理状态失败', { error: error.message, id: req.params.id });
    res.status(500).json({ success: false, message: '切换代理状态失败' });
  }
});

// DELETE /:id - 删除代理（创建者或管理员可删除，系统代理不可删除）
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    const [agents] = await pool.execute(
      'SELECT id, agent_code, is_system, creator_id FROM ai_sub_agents WHERE id = ?',
      [id]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    // 系统内置代理不允许删除
    if (agent.is_system === 1) {
      return res.json({ success: false, message: '系统内置代理不允许删除' });
    }

    // 权限检查：只有创建者或管理员可以删除
    if (!userIsAdmin && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限删除此代理' });
    }

    // CASCADE会自动删除关联的配置文件和记忆
    await pool.execute(
      'DELETE FROM ai_sub_agents WHERE id = ?',
      [id]
    );

    logger.info('删除代理成功', { agentId: id, agentCode: agent.agent_code, userId });

    res.json({
      success: true,
      data: {
        agentId: parseInt(id),
        agentCode: agent.agent_code
      }
    });
  } catch (error) {
    logger.error('删除代理失败', { error: error.message, id: req.params.id });
    res.status(500).json({ success: false, message: '删除代理失败' });
  }
});

/**
 * 解析configFiles为Map（支持对象格式和数组格式）
 * @param {Object|Array|undefined} configFiles
 * @returns {Map<string, {content, file_name, description, is_required, sort_order}>}
 */
function _parseConfigFilesMap(configFiles) {
  const map = new Map();

  if (!configFiles) {
    return map;
  }

  if (typeof configFiles === 'object' && !Array.isArray(configFiles)) {
    // 对象格式：{ soul: '...', user: '...', tools: '...', checklist: '...', examples: '...' }
    const fileTypeMap = {
      soul: { fileName: 'Soul.md', description: '灵魂文件，定义代理的身份、原则和输出格式', isRequired: 1, sortOrder: 1 },
      user: { fileName: 'User.md', description: '用户偏好文件，定义任务模板和变量插值', isRequired: 1, sortOrder: 2 },
      tools: { fileName: 'Tools.md', description: '工具配置文件，定义代理可调用的工具列表', isRequired: 1, sortOrder: 3 },
      checklist: { fileName: 'Checklist.md', description: '检查清单文件，定义代理的输出检查规则', isRequired: 0, sortOrder: 4 },
      examples: { fileName: 'Examples.md', description: '示例文件，定义代理的输入输出示例', isRequired: 0, sortOrder: 5 }
    };

    for (const [fileType, content] of Object.entries(configFiles)) {
      if (content !== undefined && content !== null && content !== '') {
        const meta = fileTypeMap[fileType] || { fileName: fileType, description: '', isRequired: 0, sortOrder: map.size + 1 };
        map.set(fileType, {
          content: typeof content === 'string' ? content : JSON.stringify(content),
          file_name: meta.fileName,
          description: meta.description,
          is_required: meta.isRequired,
          sort_order: meta.sortOrder
        });
      }
    }
  } else if (Array.isArray(configFiles)) {
    // 数组格式
    for (const cf of configFiles) {
      if (cf.file_type && cf.content !== undefined) {
        map.set(cf.file_type, {
          content: cf.content,
          file_name: cf.file_name || cf.file_type,
          description: cf.description || '',
          is_required: cf.is_required || 0,
          sort_order: cf.sort_order || 0
        });
      }
    }
  }

  return map;
}

/**
 * Upsert配置文件（支持对象格式和数组格式）
 * @param {Object} connection - 数据库连接（事务内）
 * @param {number} agentId - 代理ID
 * @param {Object|Array} configFiles - 配置文件
 * @param {number} userId - 操作用户ID
 */
async function _upsertConfigFiles(connection, agentId, configFiles, userId) {
  const configMap = _parseConfigFilesMap(configFiles);

  for (const [fileType, cfData] of configMap) {
    await connection.execute(
      `INSERT INTO ai_sub_agent_config_files
        (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), description = VALUES(description), sort_order = VALUES(sort_order)`,
      [agentId, fileType, cfData.file_name, cfData.content, cfData.description, cfData.is_required, cfData.sort_order, userId]
    );
  }
}

module.exports = router;
