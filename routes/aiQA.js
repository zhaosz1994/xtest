const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, isAdmin } = require('../middleware');
const agentExecutionEngine = require('../services/agentExecutionEngine');
const logger = require('../services/logger');

// GET /available-agents - 获取可用的QA Sub-Agent列表
router.get('/available-agents', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    // 查找 allow_qa=1 AND is_enabled=1 的代理
    let query = `
      SELECT id, agent_code, display_name, description, category,
             is_system, creator_id, visibility, memory_enabled
      FROM ai_sub_agents
      WHERE allow_qa = 1 AND is_enabled = 1
    `;
    const params = [];

    // 非管理员只能看到 public + 自己的 private
    if (!userIsAdmin) {
      query += ' AND (visibility = \'public\' OR creator_id = ?)';
      params.push(userId);
    }

    query += ' ORDER BY is_system DESC, created_at ASC';

    const [agents] = await pool.execute(query, params);

    // 应用Override逻辑：对于同一agent_code，优先显示用户的私有覆盖
    const agentMap = new Map();
    for (const a of agents) {
      const key = a.agent_code;
      if (!agentMap.has(key)) {
        agentMap.set(key, a);
      } else {
        // 如果当前记录是用户的私有覆盖，替换系统默认
        if (a.creator_id === userId && !a.is_system) {
          agentMap.set(key, a);
        }
      }
    }

    const resultAgents = Array.from(agentMap.values());

    // 为每个代理加载配置文件摘要（file_type列表）
    const data = [];
    for (const agent of resultAgents) {
      const [configFiles] = await pool.execute(
        'SELECT file_type FROM ai_sub_agent_config_files WHERE agent_id = ? ORDER BY sort_order ASC',
        [agent.id]
      );

      data.push({
        id: agent.id,
        agent_code: agent.agent_code,
        display_name: agent.display_name,
        description: agent.description,
        category: agent.category,
        memory_enabled: agent.memory_enabled,
        config_file_types: configFiles.map(f => f.file_type)
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('获取可用QA代理列表失败', { error: error.message });
    res.status(500).json({ success: false, message: '获取可用QA代理列表失败' });
  }
});

// POST /ask - 提交QA问题
router.post('/ask', authenticateToken, async (req, res) => {
  try {
    const { agent_code, question, library_id, module_id } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    if (!agent_code || !question) {
      return res.json({ success: false, message: 'agent_code和question为必填参数' });
    }

    // 检查代理是否存在且允许QA
    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE agent_code = ? AND allow_qa = 1 AND is_enabled = 1',
      [agent_code]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在、不允许QA或已禁用' });
    }

    const agent = agents[0];

    // 权限检查
    if (!userIsAdmin && agent.visibility === 'private' && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限使用此代理' });
    }

    // 获取模块信息用于变量插值
    let moduleName = '';
    let moduleDescription = '';

    if (module_id) {
      const [modules] = await pool.execute(
        'SELECT name, description FROM modules WHERE id = ?',
        [module_id]
      );
      if (modules.length > 0) {
        moduleName = modules[0].name || '';
        moduleDescription = modules[0].description || '';
      }
    }

    // 获取用户信息用于执行上下文
    const [users] = await pool.execute(
      'SELECT id, username, role FROM users WHERE id = ?',
      [userId]
    );
    const username = users[0]?.username || '';
    const userRole = users[0]?.role || '';

    // 通过agentExecutionEngine执行，注入记忆上下文
    const variables = {
      question,
      module_name: moduleName,
      module_description: moduleDescription
    };

    const context = {
      libraryId: library_id || null,
      moduleId: module_id || null,
      userRole,
      username,
      source: 'qa'
    };

    const result = await agentExecutionEngine.executeAgent(
      agent_code,
      userId,
      variables,
      context
    );

    if (result.success) {
      logger.info('QA问答完成', {
        agentCode: agent_code,
        agentId: agent.id,
        userId,
        executionTimeMs: result.executionTimeMs
      });

      res.json({
        success: true,
        data: {
          answer: result.result,
          memoryContribution: result.memoryContribution,
          toolCallsLog: result.toolCallsLog
        }
      });
    } else {
      res.json({
        success: false,
        message: result.error || 'QA问答执行失败'
      });
    }
  } catch (error) {
    logger.error('QA问答失败', { error: error.message });
    res.status(500).json({ success: false, message: 'QA问答执行失败' });
  }
});

module.exports = router;
