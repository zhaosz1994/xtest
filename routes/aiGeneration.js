const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const caseGeneratorService = require('../services/caseGeneratorService');
const level1PointService = require('../services/level1PointService');
const taskScheduler = require('../services/taskScheduler');
const pool = require('../db');
const logger = require('../services/logger');
const aiAuditLogger = require('../services/aiAuditLogger');
const aiRequestLogger = require('../services/aiRequestLogger');

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

router.post('/reset-chunks', authenticateToken, async (req, res) => {
  try {
    const { moduleId, fileIds } = req.body;
    
    if (!moduleId) {
      return res.status(400).json({ success: false, message: '缺少模块ID' });
    }

    let sql = `UPDATE ai_material_chunks SET status = 'pending', generated_cases = 0, error_message = NULL WHERE module_id = ?`;
    const params = [moduleId];
    
    if (fileIds && fileIds.length > 0) {
      const placeholders = fileIds.map(() => '?').join(',');
      sql += ` AND file_id IN (${placeholders})`;
      params.push(...fileIds);
    }
    
    const [result] = await pool.execute(sql, params);
    
    logger.info('重置chunks状态', { 
      moduleId, 
      fileIds: fileIds || 'all', 
      affectedRows: result.affectedRows 
    });
    
    res.json({ 
      success: true, 
      data: { 
        affectedRows: result.affectedRows,
        message: `已重置 ${result.affectedRows} 个文本块的状态` 
      } 
    });
  } catch (error) {
    logger.error('重置chunks状态失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/check-chunks-status/:moduleId', authenticateToken, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { fileIds } = req.query;
    
    let sql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing
      FROM ai_material_chunks
      WHERE module_id = ?
    `;
    const params = [moduleId];
    
    if (fileIds) {
      const fileIdArray = fileIds.split(',').map(id => parseInt(id));
      const placeholders = fileIdArray.map(() => '?').join(',');
      sql += ` AND file_id IN (${placeholders})`;
      params.push(...fileIdArray);
    }
    
    const [result] = await pool.execute(sql, params);
    const stats = result[0];
    
    res.json({ 
      success: true, 
      data: {
        total: stats.total || 0,
        pending: stats.pending || 0,
        completed: stats.completed || 0,
        failed: stats.failed || 0,
        processing: stats.processing || 0,
        hasPendingChunks: stats.pending > 0
      }
    });
  } catch (error) {
    logger.error('检查chunks状态失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/cleanup-task/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    
    const [taskCheck] = await pool.execute(`
      SELECT user_id FROM ai_case_generation_tasks WHERE task_id = ?
    `, [taskId]);
    
    if (taskCheck.length === 0) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    if (taskCheck[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '无权操作此任务' });
    }
    
    const reviewService = require('../services/reviewService');
    const result = await reviewService.checkAndCleanupTask(taskId);
    
    if (result.cleaned) {
      res.json({ 
        success: true, 
        data: { 
          message: '任务已清理',
          taskId 
        } 
      });
    } else {
      res.json({ 
        success: false, 
        message: '任务下还有未处理的临时用例或一级测试点',
        data: result
      });
    }
  } catch (error) {
    logger.error('手动清理任务失败', { error: error.message });
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
    const _genParams1 = await aiService.getAIGenerationParams();
    const _sceneParams1 = aiService.getSceneParams(_genParams1, 'scene_case_generation');
    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const startTime = Date.now();
    let overview = '';
    let logStatus = 'success';
    let logError = null;

    try {
      const response = await axios.post(apiUrl, {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: _sceneParams1.temperature,
        max_tokens: _sceneParams1.max_tokens
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.api_key}`
        },
        timeout: timeoutConfig.generalAITask || _genParams1.request_timeout
      });

      overview = response.data?.choices?.[0]?.message?.content?.trim() || '';
      
      const executionTimeMs = Date.now() - startTime;
      const promptTokens = response.data?.usage?.prompt_tokens || 0;
      const completionTokens = response.data?.usage?.completion_tokens || 0;
      const totalTokens = response.data?.usage?.total_tokens || 0;

      aiAuditLogger.logSuccess({
        userId: req.user.id,
        username: req.user.username,
        skillName: 'AI生成一级测试点概述',
        operationType: 'GENERATE',
        executionTimeMs,
        promptTokens,
        completionTokens,
        totalTokens,
        modelName: model,
        resultCount: 1
      });

      aiRequestLogger.logSuccess({
        userId: req.user.id,
        username: req.user.username,
        triggerType: 'generation_overview',
        triggerSource: 'direct_llm',
        triggerSourceName: 'AI生成概述(直接调用)',
        systemPrompt,
        userPrompt,
        aiResponse: overview,
        promptTokens,
        completionTokens,
        totalTokens,
        modelName: model,
        executionTimeMs,
        moduleId: point.module_id || null
      });

      res.json({ success: true, data: { overview } });
    } catch (error) {
      logStatus = 'failed';
      logError = error.message;
      const executionTimeMs = Date.now() - startTime;

      aiAuditLogger.logFailure({
        userId: req.user.id,
        username: req.user.username,
        skillName: 'AI生成一级测试点概述',
        operationType: 'GENERATE',
        executionTimeMs,
        errorMessage: error.message,
        modelName: model
      });

      aiRequestLogger.logFailure({
        userId: req.user.id,
        username: req.user.username,
        triggerType: 'generation_overview',
        triggerSource: 'direct_llm',
        triggerSourceName: 'AI生成概述(直接调用)',
        systemPrompt,
        userPrompt,
        executionTimeMs,
        errorMessage: error.message,
        modelName: model
      });

      logger.error('AI生成概述失败:', { error: error.message });
      res.status(500).json({ success: false, message: 'AI生成概述失败: ' + error.message });
    }
  } catch (error) {
    logger.error('AI生成概述异常:', { error: error.message });
    res.status(500).json({ success: false, message: 'AI生成概述异常: ' + error.message });
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
    const _genParams2 = await aiService.getAIGenerationParams();
    const _sceneParams2 = aiService.getSceneParams(_genParams2, 'scene_case_generation');
    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const startTime = Date.now();
    let keyConfig = '';
    let logStatus = 'success';
    let logError = null;

    try {
      const response = await axios.post(apiUrl, {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: _sceneParams2.temperature,
        max_tokens: _sceneParams2.max_tokens
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.api_key}`
        },
        timeout: timeoutConfig.generalAITask || _genParams2.request_timeout
      });

      keyConfig = response.data?.choices?.[0]?.message?.content?.trim() || '';
      
      const executionTimeMs = Date.now() - startTime;
      const promptTokens = response.data?.usage?.prompt_tokens || 0;
      const completionTokens = response.data?.usage?.completion_tokens || 0;
      const totalTokens = response.data?.usage?.total_tokens || 0;

      aiAuditLogger.logSuccess({
        userId: req.user.id,
        username: req.user.username,
        skillName: 'AI生成关键配置',
        operationType: 'GENERATE',
        executionTimeMs,
        promptTokens,
        completionTokens,
        totalTokens,
        modelName: model,
        resultCount: 1
      });

      aiRequestLogger.logSuccess({
        userId: req.user.id,
        username: req.user.username,
        triggerType: 'generation_key_config',
        triggerSource: 'direct_llm',
        triggerSourceName: 'AI生成关键配置(直接调用)',
        systemPrompt,
        userPrompt,
        aiResponse: keyConfig,
        promptTokens,
        completionTokens,
        totalTokens,
        modelName: model,
        executionTimeMs
      });

      res.json({ success: true, data: { keyConfig } });
    } catch (error) {
      logStatus = 'failed';
      logError = error.message;
      const executionTimeMs = Date.now() - startTime;

      aiAuditLogger.logFailure({
        userId: req.user.id,
        username: req.user.username,
        skillName: 'AI生成关键配置',
        operationType: 'GENERATE',
        executionTimeMs,
        errorMessage: error.message,
        modelName: model
      });

      aiRequestLogger.logFailure({
        userId: req.user.id,
        username: req.user.username,
        triggerType: 'generation_key_config',
        triggerSource: 'direct_llm',
        triggerSourceName: 'AI生成关键配置(直接调用)',
        systemPrompt,
        userPrompt,
        executionTimeMs,
        errorMessage: error.message,
        modelName: model
      });

      logger.error('AI生成关键配置失败:', { error: error.message });
      res.status(500).json({ success: false, message: 'AI生成关键配置失败: ' + error.message });
    }
  } catch (error) {
    logger.error('AI生成关键配置异常:', { error: error.message });
    res.status(500).json({ success: false, message: 'AI生成关键配置异常: ' + error.message });
  }
});

router.post('/generate-key-config-async', authenticateToken, async (req, res) => {
  try {
    const { caseName, precondition, purpose, steps, expected, appendMode, caseId } = req.body;

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
          } else {
            logger.warn('[async-key-config] Sub-Agent执行失败，回退到直接LLM调用', {
              error: agentResult.error || '无结果'
            });
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
          const _genParams3 = await aiService.getAIGenerationParams();
          const _sceneParams3 = aiService.getSceneParams(_genParams3, 'scene_case_generation');
          const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
          const model = aiConfig.model_name || 'deepseek-chat';

          const startTime = Date.now();
          try {
            const response = await axios.post(apiUrl, {
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: _sceneParams3.temperature,
              max_tokens: _sceneParams3.max_tokens
            }, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiConfig.api_key}`
              },
              timeout: timeoutConfig.generalAITask || _genParams3.request_timeout
            });

            keyConfig = response.data?.choices?.[0]?.message?.content?.trim() || '';
            success = true;

            const executionTimeMs = Date.now() - startTime;
            const promptTokens = response.data?.usage?.prompt_tokens || 0;
            const completionTokens = response.data?.usage?.completion_tokens || 0;
            const totalTokens = response.data?.usage?.total_tokens || 0;

            aiAuditLogger.logSuccess({
              userId,
              username: req.user.username,
              skillName: 'AI生成关键配置',
              operationType: 'GENERATE',
              executionTimeMs,
              promptTokens,
              completionTokens,
              totalTokens,
              modelName: model,
              resultCount: 1
            });

            aiRequestLogger.logSuccess({
              userId,
              username: req.user.username,
              triggerType: 'generation_key_config',
              triggerSource: 'direct_llm',
              triggerSourceName: 'AI生成关键配置(异步直接调用)',
              systemPrompt,
              userPrompt,
              aiResponse: keyConfig,
              promptTokens,
              completionTokens,
              totalTokens,
              modelName: model,
              executionTimeMs
            });
          } catch (llmError) {
            const executionTimeMs = Date.now() - startTime;
            aiAuditLogger.logFailure({
              userId,
              username: req.user.username,
              skillName: 'AI生成关键配置',
              operationType: 'GENERATE',
              executionTimeMs,
              errorMessage: llmError.message,
              modelName: model
            });

            aiRequestLogger.logFailure({
              userId,
              username: req.user.username,
              triggerType: 'generation_key_config',
              triggerSource: 'direct_llm',
              triggerSourceName: 'AI生成关键配置(异步直接调用)',
              systemPrompt,
              userPrompt,
              executionTimeMs,
              errorMessage: llmError.message,
              modelName: model
            });
            throw llmError;
          }
        }
      } catch (error) {
        logger.error('[async-key-config] AI生成失败:', { error: error.message });
        success = false;
      }

      try {
        if (success && keyConfig && caseId) {
          let existingKeyConfig = '';
          if (appendMode) {
            const [caseRows] = await pool.execute(
              'SELECT key_config FROM test_cases WHERE id = ?',
              [caseId]
            );
            existingKeyConfig = caseRows.length > 0 ? (caseRows[0].key_config || '') : '';
          }
          const finalKeyConfig = (appendMode && existingKeyConfig)
            ? existingKeyConfig + '\n' + keyConfig
            : keyConfig;
          await pool.execute(
            'UPDATE test_cases SET key_config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [finalKeyConfig, caseId]
          );
          keyConfig = finalKeyConfig;
        }
      } catch (dbError) {
        logger.error('[async-key-config] 关键配置写入数据库失败:', { error: dbError.message });
      }

      try {
        const notificationType = success ? 'ai_key_config_complete' : 'system';
        const title = success ? `AI关键配置生成完成 - ${caseName || '未命名'}` : `AI关键配置生成失败 - ${caseName || '未命名'}`;
        const content = success ? keyConfig : 'AI生成关键配置失败，请重试';
        const data = JSON.stringify({
          taskType: 'key_config',
          taskId,
          caseId: caseId || null,
          caseName: caseName || '',
          result: success ? keyConfig : '',
          appendMode: !!appendMode,
          success
        });

        await pool.execute(
          `INSERT INTO notifications (user_id, type, target_id, title, content, content_preview, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [userId, notificationType, caseId || 0, title, content, content.substring(0, 100), data]
        );

        if (global.io) {
          global.io.to(`user_${userId}`).emit('ai_task_complete', {
            taskType: 'key_config',
            taskId,
            caseId: caseId || null,
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
          } else {
            logger.warn('[async-overview] Sub-Agent执行失败，回退到直接LLM调用', {
              error: agentResult.error || '无结果'
            });
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
          const _genParams4 = await aiService.getAIGenerationParams();
          const _sceneParams4 = aiService.getSceneParams(_genParams4, 'scene_case_generation');
          const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
          const model = aiConfig.model_name || 'deepseek-chat';

          const startTime = Date.now();
          try {
            const response = await axios.post(apiUrl, {
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: _sceneParams4.temperature,
              max_tokens: _sceneParams4.max_tokens
            }, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiConfig.api_key}`
              },
              timeout: timeoutConfig.generalAITask || _genParams4.request_timeout
            });

            overview = response.data?.choices?.[0]?.message?.content?.trim() || '';
            success = true;

            const executionTimeMs = Date.now() - startTime;
            const promptTokens = response.data?.usage?.prompt_tokens || 0;
            const completionTokens = response.data?.usage?.completion_tokens || 0;
            const totalTokens = response.data?.usage?.total_tokens || 0;

            aiAuditLogger.logSuccess({
              userId,
              username: req.user.username,
              skillName: 'AI生成一级测试点概述',
              operationType: 'GENERATE',
              executionTimeMs,
              promptTokens,
              completionTokens,
              totalTokens,
              modelName: model,
              resultCount: 1
            });

            aiRequestLogger.logSuccess({
              userId,
              username: req.user.username,
              triggerType: 'generation_overview',
              triggerSource: 'direct_llm',
              triggerSourceName: 'AI生成概述(异步直接调用)',
              systemPrompt,
              userPrompt,
              aiResponse: overview,
              promptTokens,
              completionTokens,
              totalTokens,
              modelName: model,
              executionTimeMs,
              moduleId: point.module_id || null
            });
          } catch (llmError) {
            const executionTimeMs = Date.now() - startTime;
            aiAuditLogger.logFailure({
              userId,
              username: req.user.username,
              skillName: 'AI生成一级测试点概述',
              operationType: 'GENERATE',
              executionTimeMs,
              errorMessage: llmError.message,
              modelName: model
            });

            aiRequestLogger.logFailure({
              userId,
              username: req.user.username,
              triggerType: 'generation_overview',
              triggerSource: 'direct_llm',
              triggerSourceName: 'AI生成概述(异步直接调用)',
              systemPrompt,
              userPrompt,
              executionTimeMs,
              errorMessage: llmError.message,
              modelName: model
            });
            throw llmError;
          }
        }
      } catch (error) {
        logger.error('[async-overview] AI生成失败:', { error: error.message });
        success = false;
      }

      try {
        if (success && overview) {
          let finalSummary = overview;
          if (appendMode && point.summary) {
            finalSummary = point.summary + '\n' + overview;
          }
          await pool.execute(
            'UPDATE level1_points SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [finalSummary, level1PointId]
          );
          overview = finalSummary;
        }
      } catch (dbError) {
        logger.error('[async-overview] 概述写入数据库失败:', { error: dbError.message });
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
          `INSERT INTO notifications (user_id, type, target_id, title, content, content_preview, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [userId, notificationType, parseInt(level1PointId) || 0, title, content, content.substring(0, 100), data]
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

module.exports = router;
