const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const caseGeneratorService = require('../services/caseGeneratorService');
const level1PointService = require('../services/level1PointService');
const taskScheduler = require('../services/taskScheduler');
const pool = require('../db');
const logger = require('../services/logger');

router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { moduleId, libraryId, selectedFiles, agentId, caseCountLimit, 
            enableDedup, similarityThreshold, level1Mode, selectedLevel1Ids,
            model, temperature, max_tokens, focusAreas } = req.body;

    if (!moduleId) {
      return res.status(400).json({ success: false, message: '缺少模块ID' });
    }

    const result = await caseGeneratorService.createTask(parseInt(moduleId), req.user.id, {
      libraryId,
      selectedFiles,
      agentId,
      caseCountLimit,
      enableDedup,
      similarityThreshold,
      level1Mode,
      selectedLevel1Ids,
      model,
      temperature,
      max_tokens,
      focusAreas
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/task/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await caseGeneratorService.getTaskStatus(taskId);

    if (!task) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    if (task.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '无权查看此任务' });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/tasks', authenticateToken, async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const result = await caseGeneratorService.getUserTasks(req.user.id, {
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/cancel/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const result = await taskScheduler.cancelTask(taskId, req.user.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/retry/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const result = await caseGeneratorService.retryTask(taskId, req.user.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/level1-points/:moduleId', authenticateToken, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const points = await level1PointService.getExistingLevel1Points(parseInt(moduleId));
    res.json({ success: true, data: points });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/temp-level1-points/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const points = await level1PointService.getTempLevel1Points(taskId);
    res.json({ success: true, data: points });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/temp-level1-approve', authenticateToken, async (req, res) => {
  try {
    const { tempLevel1Id, taskId } = req.body;
    await level1PointService.approveTempLevel1Point(tempLevel1Id, taskId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/temp-level1-reject', authenticateToken, async (req, res) => {
  try {
    const { tempLevel1Id, taskId } = req.body;
    await level1PointService.rejectTempLevel1Point(tempLevel1Id, taskId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// AI生成一级测试点概述
router.post('/generate-overview', authenticateToken, async (req, res) => {
  try {
    const { level1PointId } = req.body;
    if (!level1PointId) {
      return res.status(400).json({ success: false, message: '缺少测试点ID' });
    }

    // 获取一级测试点信息
    const [points] = await pool.execute(
      'SELECT id, name, test_type, summary, module_id FROM level1_points WHERE id = ?',
      [level1PointId]
    );
    if (points.length === 0) {
      return res.status(404).json({ success: false, message: '测试点不存在' });
    }
    const point = points[0];

    // 获取该测试点下的所有测试用例
    const [cases] = await pool.execute(
      `SELECT name, purpose, steps, expected, key_config, precondition
       FROM test_cases
       WHERE level1_id = ? AND is_deleted = 0
       ORDER BY created_at ASC`,
      [level1PointId]
    );

    const aiService = require('../services/aiService');
    const aiConfig = await aiService.getUserAIConfig(req.user.id);
    if (!aiConfig || !aiConfig.api_key) {
      return res.json({ success: false, message: '未找到可用的AI模型配置，请先在配置中心配置AI模型' });
    }

    const caseInfo = cases.length > 0
      ? cases.map((c, i) => `${i + 1}. 【${c.name}】\n   目的: ${c.purpose || '无'}\n   前置条件: ${c.precondition || '无'}\n   步骤: ${c.steps || '无'}\n   预期: ${c.expected || '无'}${c.key_config ? '\n   关键配置: ' + c.key_config : ''}`).join('\n\n')
      : '该测试点下暂无测试用例';

    // 优先尝试通过 Sub-Agent 执行
    try {
      const agentEngine = require('../services/agentExecutionEngine');
      const [agentCheck] = await pool.execute(
        "SELECT id FROM ai_sub_agents WHERE agent_code = 'generate_overview' AND is_enabled = 1 LIMIT 1"
      );
      if (agentCheck.length > 0) {
        const agentResult = await agentEngine.executeAgent('generate_overview', req.user.id, {
          pointName: point.name,
          testType: point.test_type || '未指定',
          caseCount: String(cases.length),
          caseInfo: caseInfo.slice(0, 8000)
        }, {
          libraryId: null,
          moduleId: point.module_id,
          userRole: req.user.role,
          username: req.user.username,
          source: 'generation'
        });

        if (agentResult.success && agentResult.result) {
          const overview = agentResult.result.trim();
          logger.info('[generate-overview] 通过 Sub-Agent generate_overview 生成成功');
          return res.json({ success: true, data: { overview, agent: 'generate_overview' } });
        } else {
          logger.warn('[generate-overview] Sub-Agent 执行失败，回退到直接LLM调用:', { error: agentResult.error });
        }
      }
    } catch (agentErr) {
      logger.warn('[generate-overview] Sub-Agent 调用异常，回退到直接LLM调用:', { error: agentErr.message });
    }

    // 回退：直接 LLM 调用
    const systemPrompt = `你是一个专业的测试管理专家。你的任务是根据一级测试点下的所有测试用例内容，生成一段简洁的概述（summary），帮助测试人员快速了解该测试点的测试范围和重点。

要求：
1. 概述长度控制在50-200字
2. 概括该测试点的主要测试内容和方向
3. 如果有多个测试方向，按重要性简要列举
4. 语言简洁专业，避免冗余
5. 只输出概述文本，不要输出其他任何内容`;

    const userPrompt = `测试点名称: ${point.name}
测试类型: ${point.test_type || '未指定'}

该测试点下的测试用例:
${caseInfo}

请为该测试点生成一段概述：`;

    const axios = require('axios');
    const timeoutConfig = await aiService.getUserAITimeoutConfig(req.user.id);
    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const response = await axios.post(apiUrl, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5,
      max_tokens: 500
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.api_key}`
      },
      timeout: timeoutConfig.generalAITask
    });

    const overview = response.data?.choices?.[0]?.message?.content?.trim() || '';

    res.json({ success: true, data: { overview } });
  } catch (error) {
    logger.error('AI生成概述失败:', { error: error.message });
    res.status(500).json({ success: false, message: 'AI生成概述失败: ' + error.message });
  }
});

// AI生成关键配置
router.post('/generate-key-config', authenticateToken, async (req, res) => {
  try {
    const { caseName, precondition, purpose, steps, expected } = req.body;

    if (!caseName && !purpose && !steps) {
      return res.status(400).json({ success: false, message: '请至少填写用例名称、目的或步骤' });
    }

    const aiService = require('../services/aiService');
    const aiConfig = await aiService.getUserAIConfig(req.user.id);
    if (!aiConfig || !aiConfig.api_key) {
      return res.json({ success: false, message: '未找到可用的AI模型配置，请先在配置中心配置AI模型' });
    }

    // 优先尝试通过 Sub-Agent 执行
    try {
      const agentEngine = require('../services/agentExecutionEngine');
      const [agentCheck] = await pool.execute(
        "SELECT id FROM ai_sub_agents WHERE agent_code = 'generate_key_config' AND is_enabled = 1 LIMIT 1"
      );
      if (agentCheck.length > 0) {
        const agentResult = await agentEngine.executeAgent('generate_key_config', req.user.id, {
          caseName: caseName || '未命名',
          precondition: precondition || '无',
          purpose: purpose || '无',
          steps: steps || '无',
          expected: expected || '无'
        }, {
          libraryId: null,
          moduleId: null,
          userRole: req.user.role,
          username: req.user.username,
          source: 'generation'
        });

        if (agentResult.success && agentResult.result) {
          const keyConfig = agentResult.result.trim();
          logger.info('[generate-key-config] 通过 Sub-Agent generate_key_config 生成成功');
          return res.json({ success: true, data: { keyConfig, agent: 'generate_key_config' } });
        } else {
          logger.warn('[generate-key-config] Sub-Agent 执行失败，回退到直接LLM调用:', { error: agentResult.error });
        }
      }
    } catch (agentErr) {
      logger.warn('[generate-key-config] Sub-Agent 调用异常，回退到直接LLM调用:', { error: agentErr.message });
    }

    // 回退：直接 LLM 调用
    const systemPrompt = `你是一个专业的测试工程师。你的任务是根据测试用例的信息，生成该用例的"关键配置"内容。

关键配置是指：执行该测试用例时需要特别注意的配置项、命令、参数、环境变量、数据准备等关键技术信息。

要求：
1. 内容精确具体，包含实际的命令、参数值、配置项等
2. 如果有前置条件中提到的环境要求，提取关键配置点
3. 如果步骤中涉及具体操作命令或参数，提取出来
4. 格式清晰，每行一个配置点，使用 "配置项: 值" 或 "- 配置说明" 的格式
5. 只输出关键配置内容，不要输出其他任何解释
6. 如果没有需要特别配置的内容，输出 "无特殊配置要求"`;

    const userPrompt = `请为以下测试用例生成关键配置：

用例名称: ${caseName || '未命名'}
前置条件: ${precondition || '无'}
测试目的: ${purpose || '无'}
测试步骤: ${steps || '无'}
预期结果: ${expected || '无'}`;

    const axios = require('axios');
    const timeoutConfig = await aiService.getUserAITimeoutConfig(req.user.id);
    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const response = await axios.post(apiUrl, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 1000
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.api_key}`
      },
      timeout: timeoutConfig.generalAITask
    });

    const keyConfig = response.data?.choices?.[0]?.message?.content?.trim() || '';

    res.json({ success: true, data: { keyConfig } });
  } catch (error) {
    logger.error('AI生成关键配置失败:', { error: error.message });
    res.status(500).json({ success: false, message: 'AI生成关键配置失败: ' + error.message });
  }
});

router.post('/generate-key-config-async', authenticateToken, async (req, res) => {
  try {
    const { caseName, precondition, purpose, steps, expected, appendMode } = req.body;

    if (!caseName && !purpose && !steps) {
      return res.status(400).json({ success: false, message: '请至少填写用例名称、目的或步骤' });
    }

    const aiService = require('../services/aiService');
    const aiConfig = await aiService.getUserAIConfig(req.user.id);
    if (!aiConfig || !aiConfig.api_key) {
      return res.json({ success: false, message: '未找到可用的AI模型配置，请先在配置中心配置AI模型' });
    }

    const taskId = `kc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const userId = req.user.id;

    res.json({ success: true, data: { taskId, message: 'AI关键配置生成任务已提交后台运行' } });

    setImmediate(async () => {
      let keyConfig = '';
      let success = false;
      try {
        const agentEngine = require('../services/agentExecutionEngine');
        const [agentCheck] = await pool.execute(
          "SELECT id FROM ai_sub_agents WHERE agent_code = 'generate_key_config' AND is_enabled = 1 LIMIT 1"
        );
        if (agentCheck.length > 0) {
          const agentResult = await agentEngine.executeAgent('generate_key_config', userId, {
            caseName: caseName || '未命名',
            precondition: precondition || '无',
            purpose: purpose || '无',
            steps: steps || '无',
            expected: expected || '无'
          }, {
            libraryId: null,
            moduleId: null,
            userRole: req.user.role,
            username: req.user.username,
            source: 'generation'
          });

          if (agentResult.success && agentResult.result) {
            keyConfig = agentResult.result.trim();
            success = true;
          }
        }

        if (!success) {
          const systemPrompt = `你是一个专业的测试工程师。你的任务是根据测试用例的信息，生成该用例的"关键配置"内容。

关键配置是指：执行该测试用例时需要特别注意的配置项、命令、参数、环境变量、数据准备等关键技术信息。

要求：
1. 内容精确具体，包含实际的命令、参数值、配置项等
2. 如果有前置条件中提到的环境要求，提取关键配置点
3. 如果步骤中涉及具体操作命令或参数，提取出来
4. 格式清晰，每行一个配置点，使用 "配置项: 值" 或 "- 配置说明" 的格式
5. 只输出关键配置内容，不要输出其他任何解释
6. 如果没有需要特别配置的内容，输出 "无特殊配置要求"`;

          const userPrompt = `请为以下测试用例生成关键配置：

用例名称: ${caseName || '未命名'}
前置条件: ${precondition || '无'}
测试目的: ${purpose || '无'}
测试步骤: ${steps || '无'}
预期结果: ${expected || '无'}`;

          const axios = require('axios');
          const timeoutConfig = await aiService.getUserAITimeoutConfig(userId);
          const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
          const model = aiConfig.model_name || 'deepseek-chat';

          const response = await axios.post(apiUrl, {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.4,
            max_tokens: 1000
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${aiConfig.api_key}`
            },
            timeout: timeoutConfig.generalAITask
          });

          keyConfig = response.data?.choices?.[0]?.message?.content?.trim() || '';
          success = true;
        }
      } catch (error) {
        logger.error('[async-key-config] AI生成失败:', { error: error.message });
        success = false;
      }

      try {
        const notificationType = success ? 'ai_key_config_complete' : 'system';
        const title = success ? `AI关键配置生成完成 - ${caseName || '未命名'}` : `AI关键配置生成失败 - ${caseName || '未命名'}`;
        const content = success ? keyConfig : 'AI生成关键配置失败，请重试';
        const data = JSON.stringify({
          taskType: 'key_config',
          taskId,
          caseName: caseName || '',
          result: success ? keyConfig : '',
          appendMode: !!appendMode,
          success
        });

        await pool.execute(
          `INSERT INTO notifications (user_id, type, title, content, content_preview, data, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [userId, notificationType, title, content, content.substring(0, 100), data]
        );

        if (global.io) {
          global.io.to(`user_${userId}`).emit('ai_task_complete', {
            taskType: 'key_config',
            taskId,
            caseName: caseName || '',
            result: success ? keyConfig : '',
            appendMode: !!appendMode,
            success,
            title
          });
        }
      } catch (notifyError) {
        logger.error('[async-key-config] 通知发送失败:', { error: notifyError.message });
      }
    });
  } catch (error) {
    logger.error('AI异步生成关键配置失败:', { error: error.message });
    res.status(500).json({ success: false, message: 'AI异步生成关键配置失败: ' + error.message });
  }
});

router.post('/generate-overview-async', authenticateToken, async (req, res) => {
  try {
    const { level1PointId, appendMode } = req.body;
    if (!level1PointId) {
      return res.status(400).json({ success: false, message: '缺少测试点ID' });
    }

    const [points] = await pool.execute(
      'SELECT id, name, test_type, summary, module_id FROM level1_points WHERE id = ?',
      [level1PointId]
    );
    if (points.length === 0) {
      return res.status(404).json({ success: false, message: '测试点不存在' });
    }
    const point = points[0];

    const aiService = require('../services/aiService');
    const aiConfig = await aiService.getUserAIConfig(req.user.id);
    if (!aiConfig || !aiConfig.api_key) {
      return res.json({ success: false, message: '未找到可用的AI模型配置，请先在配置中心配置AI模型' });
    }

    const taskId = `ov_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const userId = req.user.id;

    res.json({ success: true, data: { taskId, message: 'AI概述生成任务已提交后台运行' } });

    setImmediate(async () => {
      let overview = '';
      let success = false;

      try {
        const [cases] = await pool.execute(
          `SELECT name, purpose, steps, expected, key_config, precondition
           FROM test_cases
           WHERE level1_id = ? AND is_deleted = 0
           ORDER BY created_at ASC`,
          [level1PointId]
        );

        const caseInfo = cases.length > 0
          ? cases.map((c, i) => `${i + 1}. 【${c.name}】\n   目的: ${c.purpose || '无'}\n   前置条件: ${c.precondition || '无'}\n   步骤: ${c.steps || '无'}\n   预期: ${c.expected || '无'}${c.key_config ? '\n   关键配置: ' + c.key_config : ''}`).join('\n\n')
          : '该测试点下暂无测试用例';

        const agentEngine = require('../services/agentExecutionEngine');
        const [agentCheck] = await pool.execute(
          "SELECT id FROM ai_sub_agents WHERE agent_code = 'generate_overview' AND is_enabled = 1 LIMIT 1"
        );
        if (agentCheck.length > 0) {
          const agentResult = await agentEngine.executeAgent('generate_overview', userId, {
            pointName: point.name,
            testType: point.test_type || '未指定',
            caseCount: String(cases.length),
            caseInfo: caseInfo.slice(0, 8000)
          }, {
            libraryId: null,
            moduleId: point.module_id,
            userRole: req.user.role,
            username: req.user.username,
            source: 'generation'
          });

          if (agentResult.success && agentResult.result) {
            overview = agentResult.result.trim();
            success = true;
          }
        }

        if (!success) {
          const systemPrompt = `你是一个专业的测试管理专家。你的任务是根据一级测试点下的所有测试用例内容，生成一段简洁的概述（summary），帮助测试人员快速了解该测试点的测试范围和重点。

要求：
1. 概述长度控制在50-200字
2. 概括该测试点的主要测试内容和方向
3. 如果有多个测试方向，按重要性简要列举
4. 语言简洁专业，避免冗余
5. 只输出概述文本，不要输出其他任何内容`;

          const userPrompt = `测试点名称: ${point.name}
测试类型: ${point.test_type || '未指定'}

该测试点下的测试用例:
${caseInfo}

请为该测试点生成一段概述：`;

          const axios = require('axios');
          const timeoutConfig = await aiService.getUserAITimeoutConfig(userId);
          const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
          const model = aiConfig.model_name || 'deepseek-chat';

          const response = await axios.post(apiUrl, {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.5,
            max_tokens: 500
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${aiConfig.api_key}`
            },
            timeout: timeoutConfig.generalAITask
          });

          overview = response.data?.choices?.[0]?.message?.content?.trim() || '';
          success = true;
        }
      } catch (error) {
        logger.error('[async-overview] AI生成失败:', { error: error.message });
        success = false;
      }

      try {
        const notificationType = success ? 'ai_overview_complete' : 'system';
        const title = success ? `AI概述生成完成 - ${point.name}` : `AI概述生成失败 - ${point.name}`;
        const content = success ? overview : 'AI生成概述失败，请重试';
        const data = JSON.stringify({
          taskType: 'overview',
          taskId,
          level1PointId: parseInt(level1PointId),
          pointName: point.name,
          result: success ? overview : '',
          appendMode: !!appendMode,
          success
        });

        await pool.execute(
          `INSERT INTO notifications (user_id, type, title, content, content_preview, data, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [userId, notificationType, title, content, content.substring(0, 100), data]
        );

        if (global.io) {
          global.io.to(`user_${userId}`).emit('ai_task_complete', {
            taskType: 'overview',
            taskId,
            level1PointId: parseInt(level1PointId),
            pointName: point.name,
            result: success ? overview : '',
            appendMode: !!appendMode,
            success,
            title
          });
        }
      } catch (notifyError) {
        logger.error('[async-overview] 通知发送失败:', { error: notifyError.message });
      }
    });
  } catch (error) {
    logger.error('AI异步生成概述失败:', { error: error.message });
    res.status(500).json({ success: false, message: 'AI异步生成概述失败: ' + error.message });
  }
});

router.get('/skills', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [skills] = await pool.execute(`
      SELECT id, name, display_name, description, category, is_system, creator_id
      FROM ai_skills
      WHERE category = 'test_generation'
        AND is_enabled = 1
        AND (is_public = 1 OR creator_id = ?)
      ORDER BY is_system DESC, created_at DESC
    `, [userId]);

    res.json({
      success: true,
      data: skills.map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.display_name,
        description: s.description,
        category: s.category,
        isSystem: s.is_system === 1,
        isOwner: s.creator_id === userId
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/skills', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, displayName, description, systemPrompt, userPromptTemplate, category, isPublic } = req.body;

    if (!name || !displayName) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    const definition = JSON.stringify({
      type: 'function',
      function: {
        name: name,
        description: description,
        parameters: {
          type: 'object',
          properties: {
            module_context: { type: 'object' },
            material_content: { type: 'string' }
          }
        }
      },
      prompts: {
        system: systemPrompt,
        userTemplate: userPromptTemplate
      }
    });

    const [result] = await pool.execute(`
      INSERT INTO ai_skills 
        (name, display_name, description, definition, category, is_system, is_public, creator_id, created_by)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `, [name, displayName, description, definition, category || 'test_generation',
        isPublic ? 1 : 0, userId, req.user.username]);

    res.json({
      success: true,
      data: { id: result.insertId, name }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/skills/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { displayName, description, systemPrompt, userPromptTemplate, isPublic } = req.body;
    const userId = req.user.id;

    const [existing] = await pool.execute(`
      SELECT id, is_system, creator_id, definition FROM ai_skills WHERE id = ?
    `, [id]);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Skill不存在' });
    }

    if (existing[0].is_system === 1) {
      return res.status(403).json({ success: false, message: '系统内置Skill不可修改' });
    }

    if (existing[0].creator_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '无权修改此Skill' });
    }

    let existingDef = {};
    try {
      existingDef = typeof existing[0].definition === 'string' 
        ? JSON.parse(existing[0].definition) 
        : (existing[0].definition || {});
    } catch (e) {}

    existingDef.prompts = {
      system: systemPrompt,
      userTemplate: userPromptTemplate
    };

    const definition = JSON.stringify(existingDef);

    await pool.execute(`
      UPDATE ai_skills 
      SET display_name = ?, description = ?, definition = ?, is_public = ?, updated_at = NOW()
      WHERE id = ? AND is_system = 0
    `, [displayName, description, definition, isPublic ? 1 : 0, id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/skills/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const [result] = await pool.execute(`
      DELETE FROM ai_skills 
      WHERE id = ? AND is_system = 0 AND creator_id = ?
    `, [id, userId]);

    res.json({ success: result.affectedRows > 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
