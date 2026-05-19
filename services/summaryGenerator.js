const pool = require('../db');
const { getUserAIConfig, getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams } = require('./aiService');
const { buildAIHeaders, callAIStreamWithRetry } = require('./aiCallWrapper');
const aiAuditLogger = require('./aiAuditLogger');
const logger = require('./logger');

const SYSTEM_PROMPT = `你是一个专业的测试用例分析专家。你的任务是根据一级测试点下的所有测试用例，生成一段简洁、专业的概述。

【概述要求】
1. 概述应该总结该测试点的主要测试内容和目的
2. 概述应该涵盖测试用例的关键测试场景
3. 概述应该简洁明了，一般控制在100-200字
4. 概述应该使用专业术语，但避免过于技术化
5. 如果测试用例数量较少，可以简要描述每个用例的核心内容
6. 如果测试用例数量较多，可以按类型或场景进行归纳总结

【输出格式】
请直接输出概述文本，不需要任何标题或格式标记。`;

async function getTestCasesByLevel1(level1Id) {
  try {
    const [cases] = await pool.execute(`
      SELECT 
        tc.id,
        tc.case_id,
        tc.name,
        tc.priority,
        tc.type,
        tc.precondition,
        tc.purpose,
        tc.steps,
        tc.expected,
        tc.key_config,
        tc.remark,
        m.name as module_name
      FROM test_cases tc
      LEFT JOIN modules m ON tc.module_id = m.id
      WHERE tc.level1_id = ? AND (tc.is_deleted = 0 OR tc.is_deleted IS NULL)
      ORDER BY tc.created_at ASC
    `, [level1Id]);
    
    return cases;
  } catch (error) {
    logger.error('获取测试用例失败:', { error: error.message, level1Id });
    return [];
  }
}

async function generateSummaryForLevel1(level1Id, userId = null, username = null) {
  const startTime = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let aiModel = null;
  
  try {
    const [level1Points] = await pool.execute(
      'SELECT id, name, module_id FROM level1_points WHERE id = ?',
      [level1Id]
    );
    
    if (level1Points.length === 0) {
      logger.warn('一级测试点不存在', { level1Id });
      return null;
    }
    
    const level1Point = level1Points[0];
    
    const testCases = await getTestCasesByLevel1(level1Id);
    
    if (testCases.length === 0) {
      logger.info('一级测试点下没有测试用例，跳过概述生成', { level1Id });
      return null;
    }
    
    aiModel = await getUserAIConfig(userId);
    
    if (!aiModel) {
      logger.warn('未配置AI模型，无法生成概述', { level1Id });
      return null;
    }
    
    const caseSummary = testCases.map((tc, index) => {
      let summary = `${index + 1}. 【${tc.name}】`;
      if (tc.purpose) summary += ` 目的: ${tc.purpose.substring(0, 100)}`;
      if (tc.type) summary += ` 类型: ${tc.type}`;
      if (tc.priority) summary += ` 优先级: ${tc.priority}`;
      if (tc.key_config) summary += ` 关键配置: ${tc.key_config.substring(0, 50)}`;
      return summary;
    }).join('\n');
    
    const userPrompt = `请为以下一级测试点生成概述：

## 测试点信息
- 测试点名称: ${level1Point.name}
- 测试用例数量: ${testCases.length}

## 测试用例列表
${caseSummary}

请根据以上测试用例的内容，生成一段简洁的概述，总结该测试点的测试内容和目的。`;

    const controller = new AbortController();
    const timeoutConfig = await getUserAITimeoutConfig(userId);
    const genParams = await getUserAIGenerationParams(userId);
    const sceneParams = getSceneParams(genParams, 'scene_case_generation');
    const effectiveTimeout = timeoutConfig.generalAITask || genParams.request_timeout || 120000;
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    const requestBody = {
      model: aiModel.model_name,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: sceneParams.temperature,
      max_tokens: sceneParams.max_tokens
    };

    const headers = buildAIHeaders(aiModel.provider, aiModel.api_key);
    const streamResult = await callAIStreamWithRetry(
      aiModel.endpoint, requestBody, headers, aiModel,
      { timeout: effectiveTimeout + 10000, signal: controller.signal, logContext: { triggerSource: 'summary_generator' } }
    );

    clearTimeout(timeoutId);

    promptTokens = streamResult.usage?.prompt_tokens || 0;
    completionTokens = streamResult.usage?.completion_tokens || 0;
    totalTokens = streamResult.usage?.total_tokens || 0;

    let summary = streamResult.content?.trim() || null;
    
    if (!summary) {
      logger.warn('AI返回的概述为空', { level1Id });
      return null;
    }
    
    await pool.execute(
      'UPDATE level1_points SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [summary, level1Id]
    );
    
    const executionTimeMs = Date.now() - startTime;
    
    if (userId) {
      aiAuditLogger.logSuccess({
        userId: userId,
        username: username,
        skillName: '一级测试点概述生成',
        skillId: null,
        operationType: 'ANALYZE',
        executionTimeMs: executionTimeMs,
        modelName: aiModel?.model_name,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: totalTokens,
        resultCount: 1
      });
    }
    
    logger.info('一级测试点概述生成成功', { 
      level1Id, 
      summaryLength: summary.length,
      caseCount: testCases.length,
      executionTimeMs 
    });
    
    return summary;
    
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    
    if (userId) {
      aiAuditLogger.logFailure({
        userId: userId,
        username: username,
        skillName: '一级测试点概述生成',
        skillId: null,
        operationType: 'ANALYZE',
        executionTimeMs: executionTimeMs,
        modelName: aiModel?.model_name,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: totalTokens,
        errorMessage: error.message
      });
    }
    
    if (error.name === 'AbortError') {
      logger.error('一级测试点概述生成超时', { level1Id });
    } else {
      logger.error('一级测试点概述生成失败:', { error: error.message, level1Id });
    }
    
    return null;
  }
}

async function generateSummaryForMultipleLevel1(level1Ids, userId = null, username = null) {
  const results = [];
  
  for (const level1Id of level1Ids) {
    try {
      const summary = await generateSummaryForLevel1(level1Id, userId, username);
      results.push({ level1Id, success: !!summary, summary });
      
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error('批量生成概述失败:', { error: error.message, level1Id });
      results.push({ level1Id, success: false, error: error.message });
    }
  }
  
  return results;
}

module.exports = {
  generateSummaryForLevel1,
  generateSummaryForMultipleLevel1,
  getTestCasesByLevel1
};
