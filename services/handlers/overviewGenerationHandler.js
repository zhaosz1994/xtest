const BaseTaskHandler = require('./baseTaskHandler');
const pool = require('../../db');
const axios = require('axios');
const logger = require('../logger');
const aiAuditLogger = require('../aiAuditLogger');
const aiRequestLogger = require('../aiRequestLogger');
const { getUserAIConfig, getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams } = require('../aiService');
const unifiedTaskService = require('../unifiedTaskService');

class OverviewGenerationHandler extends BaseTaskHandler {
  constructor() {
    super('overview_generation');
  }

  async execute(task) {
    const level1PointId = task.target_id;
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});

    const [points] = await pool.execute(
      'SELECT id, name, test_type, summary, module_id FROM level1_points WHERE id = ?',
      [level1PointId]
    );

    if (points.length === 0) {
      throw new Error('一级测试点不存在');
    }

    const point = points[0];

    const [cases] = await pool.execute(
      `SELECT name, purpose, steps, expected, key_config, precondition
       FROM test_cases
       WHERE level1_id = ? AND is_deleted = 0
       ORDER BY created_at ASC`,
      [level1PointId]
    );

    const caseInfo = cases.length > 0
      ? cases.map((c, i) =>
          `${i + 1}. 【${c.name}】\n   目的: ${c.purpose || '无'}\n   前置条件: ${c.precondition || '无'}\n   步骤: ${c.steps || '无'}\n   预期: ${c.expected || '无'}${c.key_config ? '\n   关键配置: ' + c.key_config : ''}`
        ).join('\n\n')
      : '该测试点下暂无测试用例';

    const aiConfig = await getUserAIConfig(task.user_id);
    if (!aiConfig || !aiConfig.api_key) {
      throw new Error('未找到可用的AI模型配置');
    }

    let overview = '';
    let usedModel = aiConfig.model_name || 'deepseek-chat';
    let finalSummary = '';

    try {
      const agentEngine = require('../agentExecutionEngine');
      const [agentCheck] = await pool.execute(
        "SELECT id FROM ai_sub_agents WHERE agent_code = 'generate_overview' AND is_enabled = 1 LIMIT 1"
      );
      if (agentCheck.length > 0) {
        const agentResult = await agentEngine.executeAgent('generate_overview', task.user_id, {
          pointName: point.name,
          testType: point.test_type || '未指定',
          caseCount: String(cases.length),
          caseInfo: caseInfo.substring(0, 8000)
        }, {
          libraryId: null,
          moduleId: point.module_id,
          userRole: null,
          username: task.username || '',
          source: 'generation'
        });

        if (agentResult.success && agentResult.result) {
          overview = agentResult.result.trim();
          logger.info('[overview-handler] Sub-Agent执行成功', { taskId: task.task_id });
        }
      }
    } catch (agentErr) {
      logger.warn('[overview-handler] Sub-Agent调用异常，回退到直接LLM调用:', { error: agentErr.message });
    }

    if (!overview) {
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

      const timeoutConfig = await getUserAITimeoutConfig(task.user_id);
      const genParams = await getUserAIGenerationParams(task.user_id);
      const sceneParams = getSceneParams(genParams, 'scene_case_generation');
      const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
      const model = aiConfig.model_name || 'deepseek-chat';
      usedModel = model;

      const startTime = Date.now();
      try {
        const response = await axios.post(apiUrl, {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: sceneParams.temperature,
          max_tokens: sceneParams.max_tokens
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiConfig.api_key}`
          },
          timeout: timeoutConfig.generalAITask || genParams.request_timeout
        });

        overview = response.data?.choices?.[0]?.message?.content?.trim() || '';

        const executionTimeMs = Date.now() - startTime;
        const promptTokens = response.data?.usage?.prompt_tokens || 0;
        const completionTokens = response.data?.usage?.completion_tokens || 0;
        const totalTokens = response.data?.usage?.total_tokens || 0;

        await unifiedTaskService.updateTaskTokens(task.task_id, {
          modelName: model,
          promptTokens,
          completionTokens,
          totalTokens
        });

        aiAuditLogger.logSuccess({
          userId: task.user_id,
          username: task.username,
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
          userId: task.user_id,
          username: task.username,
          triggerType: 'generation_overview',
          triggerSource: 'unified_task',
          triggerSourceName: 'AI生成概述(统一任务)',
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
          userId: task.user_id,
          username: task.username,
          skillName: 'AI生成一级测试点概述',
          operationType: 'GENERATE',
          executionTimeMs,
          errorMessage: llmError.message,
          modelName: model
        });
        throw llmError;
      }
    }

    if (!overview) {
      throw new Error('AI返回的概述为空');
    }

    // 使用原子SQL操作更新概述，防止并发读写导致的数据覆盖
    if (config.appendMode) {
      await pool.execute(
        `UPDATE level1_points
         SET summary = CASE
           WHEN summary IS NOT NULL AND summary != '' THEN CONCAT(summary, CHAR(10), ?)
           ELSE ?
         END,
         updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [overview, overview, level1PointId]
      );
      // 重新读取以获取最终值
      const [updatedRows] = await pool.execute(
        'SELECT summary FROM level1_points WHERE id = ?',
        [level1PointId]
      );
      finalSummary = updatedRows.length > 0 ? updatedRows[0].summary : overview;
    } else {
      finalSummary = overview;
      await pool.execute(
        'UPDATE level1_points SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [finalSummary, level1PointId]
      );
    }

    logger.info('概述生成完成', { taskId: task.task_id, level1PointId });

    return finalSummary;
  }
}

module.exports = new OverviewGenerationHandler();
