const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, isAdmin } = require('../middleware');
const agentExecutionEngine = require('../services/agentExecutionEngine');
const logger = require('../services/logger');

router.get('/available-agents', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    let query = `
      SELECT id, agent_code, display_name, description, category,
             is_system, creator_id, visibility, memory_enabled
      FROM ai_sub_agents
      WHERE allow_qa = 1 AND is_enabled = 1
    `;
    const params = [];

    if (!userIsAdmin) {
      query += ' AND (visibility = \'public\' OR creator_id = ?)';
      params.push(userId);
    }

    query += ' ORDER BY is_system DESC, created_at ASC';

    const [agents] = await pool.execute(query, params);

    const agentMap = new Map();
    for (const a of agents) {
      const key = a.agent_code;
      if (!agentMap.has(key)) {
        agentMap.set(key, a);
      } else {
        if (a.creator_id === userId && !a.is_system) {
          agentMap.set(key, a);
        }
      }
    }

    const resultAgents = Array.from(agentMap.values());

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

router.post('/ask', authenticateToken, async (req, res) => {
  try {
    const { agent_code, question, library_id, module_id } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    if (!agent_code || !question) {
      return res.json({ success: false, message: 'agent_code和question为必填参数' });
    }

    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE agent_code = ? AND allow_qa = 1 AND is_enabled = 1',
      [agent_code]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在、不允许QA或已禁用' });
    }

    const agent = agents[0];

    if (!userIsAdmin && agent.visibility === 'private' && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限使用此代理' });
    }

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

    const [users] = await pool.execute(
      'SELECT id, username, role FROM users WHERE id = ?',
      [userId]
    );
    const username = users[0]?.username || '';
    const userRole = users[0]?.role || '';

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

router.post('/ask-stream', authenticateToken, async (req, res) => {
  try {
    const { agent_code, question, library_id, module_id } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    if (!agent_code || !question) {
      return res.json({ success: false, message: 'agent_code和question为必填参数' });
    }

    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE agent_code = ? AND allow_qa = 1 AND is_enabled = 1',
      [agent_code]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在、不允许QA或已禁用' });
    }

    const agent = agents[0];

    if (!userIsAdmin && agent.visibility === 'private' && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限使用此代理' });
    }

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

    const [users] = await pool.execute(
      'SELECT id, username, role FROM users WHERE id = ?',
      [userId]
    );
    const username = users[0]?.username || '';
    const userRole = users[0]?.role || '';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const sendSSE = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        logger.warn('SSE写入失败（客户端可能已断开）', { error: e.message });
      }
    };

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch (e) {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });

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
      source: 'qa_stream'
    };

    const streamCallbacks = {
      onContent: (deltaContent, fullContent) => {
        sendSSE('content', { delta: deltaContent, full: fullContent });
      },
      onToolCall: (toolCalls) => {
        const names = toolCalls.map(tc => tc.function?.name || tc.name || 'unknown');
        sendSSE('tool_call', { tools: names });
      },
      onToolResult: (toolName, result) => {
        sendSSE('tool_result', { tool: toolName, preview: typeof result === 'string' ? result.substring(0, 200) : 'executed' });
      },
      onRound: (round, maxRounds) => {
        sendSSE('round', { round, maxRounds });
      }
    };

    const result = await agentExecutionEngine.executeAgentStream(
      agent_code,
      userId,
      variables,
      context,
      streamCallbacks
    );

    clearInterval(heartbeat);

    if (result.success) {
      sendSSE('done', {
        answer: result.result,
        memoryContribution: result.memoryContribution,
        toolCallsLog: result.toolCallsLog,
        executionTimeMs: result.executionTimeMs
      });
      logger.info('QA流式问答完成', {
        agentCode: agent_code,
        agentId: agent.id,
        userId,
        executionTimeMs: result.executionTimeMs
      });
    } else {
      sendSSE('error', { message: result.error || 'QA问答执行失败' });
    }

    try {
      res.end();
    } catch (e) {}
  } catch (error) {
    logger.error('QA流式问答失败', { error: error.message });
    try {
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'QA流式问答执行失败' });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
      }
    } catch (e) {}
  }
});

module.exports = router;
