const BaseTaskHandler = require('./baseTaskHandler');
const pool = require('../../db');
const logger = require('../logger');
const aiAuditLogger = require('../aiAuditLogger');
const aiRequestLogger = require('../aiRequestLogger');
const { getUserAIConfig, getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams } = require('../aiService');
const { buildAIHeaders, callAIStreamWithRetry } = require('../aiCallWrapper');
const unifiedTaskService = require('../unifiedTaskService');

class KeyConfigGenerationHandler extends BaseTaskHandler {
  constructor() {
    super('key_config_generation');
  }

  async execute(task) {
    const config = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});
    const inputData = typeof task.input_data === 'string' ? JSON.parse(task.input_data) : (task.input_data || {});

    const caseId = task.target_id;
    const caseName = inputData.caseName || task.target_name || '未命名';
    const precondition = inputData.precondition || '无';
    const purpose = inputData.purpose || '无';
    const steps = inputData.steps || '无';
    const expected = inputData.expected || '无';

    const aiConfig = await getUserAIConfig(task.user_id);
    if (!aiConfig || !aiConfig.api_key) {
      throw new Error('未找到可用的AI模型配置');
    }

    let keyConfig = '';
    let usedModel = aiConfig.model_name || 'deepseek-chat';

    try {
      const agentEngine = require('../agentExecutionEngine');
      const [agentCheck] = await pool.execute(
        "SELECT id FROM ai_sub_agents WHERE agent_code = 'generate_key_config' AND is_enabled = 1 LIMIT 1"
      );
      if (agentCheck.length > 0) {
        const agentResult = await agentEngine.executeAgent('generate_key_config', task.user_id, {
          caseName,
          precondition,
          purpose,
          steps,
          expected
        }, {
          libraryId: null,
          moduleId: null,
          userRole: null,
          username: task.username || '',
          source: 'generation'
        });

        if (agentResult.success && agentResult.result) {
          keyConfig = agentResult.result.trim();
          logger.info('[keyconfig-handler] Sub-Agent执行成功', { taskId: task.task_id });
        }
      }
    } catch (agentErr) {
      logger.warn('[keyconfig-handler] Sub-Agent调用异常，回退到直接LLM调用:', { error: agentErr.message });
    }

    if (!keyConfig) {
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

用例名称: ${caseName}
前置条件: ${precondition}
测试目的: ${purpose}
测试步骤: ${steps}
预期结果: ${expected}`;

      const timeoutConfig = await getUserAITimeoutConfig(task.user_id);
      const genParams = await getUserAIGenerationParams(task.user_id);
      const sceneParams = getSceneParams(genParams, 'scene_case_generation');
      const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
      const model = aiConfig.model_name || 'deepseek-chat';
      usedModel = model;
      const effectiveTimeout = timeoutConfig.generalAITask || genParams.request_timeout || 120000;

      const startTime = Date.now();
      try {
        const requestBody = {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: sceneParams.temperature,
          max_tokens: sceneParams.max_tokens
        };

        const headers = buildAIHeaders(aiConfig.provider, aiConfig.api_key);

        const streamResult = await callAIStreamWithRetry(apiUrl, requestBody, headers, aiConfig, {
          timeout: effectiveTimeout + 10000,
          logContext: { triggerSource: 'key_config_handler', model },
          shouldAbort: async () => {
            const [rows] = await pool.execute(
              `SELECT status FROM ai_unified_tasks WHERE task_id = ?`,
              [task.task_id]
            );
            return rows.length > 0 && rows[0].status === 'cancelled';
          }
        });

        keyConfig = streamResult.content?.trim() || '';

        const executionTimeMs = Date.now() - startTime;
        const promptTokens = streamResult.usage?.prompt_tokens || 0;
        const completionTokens = streamResult.usage?.completion_tokens || 0;
        const totalTokens = streamResult.usage?.total_tokens || 0;

        await unifiedTaskService.updateTaskTokens(task.task_id, {
          modelName: model,
          promptTokens,
          completionTokens,
          totalTokens
        });

        aiAuditLogger.logSuccess({
          userId: task.user_id,
          username: task.username,
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
          userId: task.user_id,
          username: task.username,
          triggerType: 'generation_key_config',
          triggerSource: 'unified_task',
          triggerSourceName: 'AI生成关键配置(统一任务)',
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
          userId: task.user_id,
          username: task.username,
          skillName: 'AI生成关键配置',
          operationType: 'GENERATE',
          executionTimeMs,
          errorMessage: llmError.message,
          modelName: model
        });
        throw llmError;
      }
    }

    if (!keyConfig) {
      throw new Error('AI返回的关键配置为空');
    }

    if (caseId) {
      // 使用原子SQL操作更新关键配置，防止并发读写导致的数据覆盖
      if (config.appendMode) {
        await pool.execute(
          `UPDATE test_cases
           SET key_config = CASE
             WHEN key_config IS NOT NULL AND key_config != '' THEN CONCAT(key_config, CHAR(10), ?)
             ELSE ?
           END,
           updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [keyConfig, keyConfig, caseId]
        );
        // 重新读取以获取最终值
        const [updatedRows] = await pool.execute(
          'SELECT key_config FROM test_cases WHERE id = ?',
          [caseId]
        );
        keyConfig = updatedRows.length > 0 ? (updatedRows[0].key_config || keyConfig) : keyConfig;
      } else {
        await pool.execute(
          'UPDATE test_cases SET key_config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [keyConfig, caseId]
        );
      }
    }

    logger.info('关键配置生成完成', { taskId: task.task_id, caseId });

    return keyConfig;
  }
}

module.exports = new KeyConfigGenerationHandler();
