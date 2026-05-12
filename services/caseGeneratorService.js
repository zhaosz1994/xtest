const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const { default: PQueue } = require('p-queue');
const logger = require('./logger');
const aiAuditLogger = require('./aiAuditLogger');
const aiRequestLogger = require('./aiRequestLogger');
const { callAIWithRetry } = require('./aiCallWrapper');
const level1PointService = require('./level1PointService');

class CaseGeneratorService {
  constructor() {
    this.apiQueue = new PQueue({ concurrency: parseInt(process.env.CHUNK_API_CONCURRENCY) || 4 });
    this.runningTasks = new Set();
  }

  async executeMapPhase(taskId, globalAwareness = {}) {
    if (this.runningTasks.has(taskId)) {
      logger.debug('executeMapPhase 任务已在运行中，跳过', { taskId });
      return { completedChunks: 0, failedChunks: 0, totalChunks: 0, skipped: true };
    }
    this.runningTasks.add(taskId);
    logger.debug('executeMapPhase 开始处理任务', { taskId });

    const { globalContext = '', allValidLevel1 = [] } = globalAwareness;

    try {
    const [tasks] = await pool.execute(`
      SELECT t.*, m.name as module_name,
        l.name as library_name,
        u.username
      FROM ai_case_generation_tasks t
      JOIN modules m ON t.module_id = m.id
      LEFT JOIN case_libraries l ON t.library_id = l.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.task_id = ?
    `, [taskId]);

    if (tasks.length === 0) {
      logger.debug('executeMapPhase 任务不存在', { taskId });
      return { completedChunks: 0, failedChunks: 0, totalChunks: 0, skipped: true };
    }

    const task = tasks[0];
    const selectedFiles = typeof task.selected_files === 'string'
      ? JSON.parse(task.selected_files || '[]')
      : (task.selected_files || []);

    let sql = `
      SELECT c.*, f.name as file_name,
        p.chunk_content as parent_chunk_content,
        p.chunk_index as parent_chunk_index
      FROM ai_material_chunks c
      JOIN module_knowledge_files f ON c.file_id = f.id
      LEFT JOIN ai_material_chunks p ON c.parent_chunk_id = p.id
      WHERE c.module_id = ? AND c.status = 'pending' AND f.deleted_at IS NULL
        AND (c.chunk_type = 'child' OR c.chunk_type = 'normal' OR c.chunk_type IS NULL)
    `;
    const params = [task.module_id];

    if (selectedFiles.length > 0) {
      const placeholders = selectedFiles.map(() => '?').join(',');
      sql += ` AND f.id IN (${placeholders})`;
      params.push(...selectedFiles);
    }

    sql += ` ORDER BY c.chunk_index ASC`;

    const [chunks] = await pool.execute(sql, params);

    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET total_chunks = ?, stage = 'mapping', progress_message = '正在生成用例...'
      WHERE task_id = ?
    `, [chunks.length, taskId]);

    if (chunks.length === 0) {
      logger.info('executeMapPhase 无可用文本块', { taskId });
      await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET total_cases = 0, progress = 100, progress_message = '无可用文本块'
        WHERE task_id = ?
      `, [taskId]);
      return { completedChunks: 0, failedChunks: 0, totalChunks: 0, skipped: true };
    }

    let processedCount = 0;
    let completedChunks = 0;
    let failedChunks = 0;

    const config = task.config ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) : {};

    const agentPrompt = await this.loadAgentPrompt(task.agent_id);

    const { getSceneParams, getUserAIGenerationParams } = require('./aiService');
    const genParams = await getUserAIGenerationParams(task.user_id);
    const sceneParams = getSceneParams(genParams, 'scene_case_generation');
    const contextChars = config.max_context_chars ?? sceneParams.max_context_chars ?? 1000;

    const maxRetries = parseInt(process.env.CHUNK_MAX_RETRIES) || 3;
    const retryInterval = (sceneParams.retry_interval !== undefined ? sceneParams.retry_interval : 30) * 1000;

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];
      const prevChunk = chunkIdx > 0 ? chunks[chunkIdx - 1] : null;
      const nextChunk = chunkIdx < chunks.length - 1 ? chunks[chunkIdx + 1] : null;

      const chunkContext = this._buildChunkContext(chunk, prevChunk, nextChunk, contextChars);

      await this.apiQueue.add(async () => {
        let chunkSuccess = false;
        let lastError = null;
        let actualRetryCount = 0;

        for (let retry = 0; retry < maxRetries; retry++) {
          try {
            await pool.execute(`
              UPDATE ai_material_chunks 
              SET status = 'processing'
              WHERE id = ? AND status IN ('pending', 'failed')
            `, [chunk.id]);

            const cases = await this.generateCasesFromChunk(chunk, task, config, agentPrompt, chunkContext, { globalContext, allValidLevel1 });

            await pool.execute(`DELETE FROM temp_test_cases WHERE task_id = ? AND chunk_id = ?`, [taskId, chunk.id]);

            if (cases.length > 0) {
              await this.saveTempCases(taskId, task.module_id, chunk.id, cases, task.library_id, allValidLevel1);
            }

            await pool.execute(`
              UPDATE ai_material_chunks 
              SET status = 'completed', generated_cases = ?, processed_at = NOW(), retry_count = ?
              WHERE id = ?
            `, [cases.length, retry, chunk.id]);

            chunkSuccess = true;
            actualRetryCount = retry;
            break;
          } catch (error) {
            lastError = error;
            if (retry < maxRetries - 1) {
              logger.warn('chunk处理失败，准备重试', {
                chunkId: chunk.id,
                taskId,
                retry: retry + 1,
                maxRetries,
                retryIntervalMs: retryInterval,
                error: error.message
              });
              await new Promise(resolve => setTimeout(resolve, retryInterval));
            }
          }
        }

        if (!chunkSuccess) {
          const errorMsg = lastError ? (lastError.message || lastError.toString() || '未知错误') : '重试耗尽';
          logger.error('处理chunk失败（重试耗尽）', {
            chunkId: chunk.id,
            taskId,
            error: errorMsg,
            maxRetries
          });
          await pool.execute(`
            UPDATE ai_material_chunks 
            SET status = 'failed', error_message = ?, retry_count = ?
            WHERE id = ?
          `, [errorMsg.substring(0, 500), maxRetries, chunk.id]);
          failedChunks++;
        } else {
          completedChunks++;
        }

        processedCount++;
        await this.updateProgressFromDB(taskId, processedCount, chunks.length);
      });
    }

    await this.apiQueue.onIdle();

    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total FROM temp_test_cases WHERE task_id = ?
    `, [taskId]);
    const totalCases = countResult[0].total;

    let progressMessage;
    if (failedChunks === 0) {
      progressMessage = `用例生成完成：共${chunks.length}块，成功${completedChunks}块`;
    } else {
      progressMessage = `用例生成完成（部分成功）：共${chunks.length}块，成功${completedChunks}块，失败${failedChunks}块`;
    }

    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET total_cases = ?, progress_message = ?,
          completed_chunks = ?, failed_chunks = ?
      WHERE task_id = ?
    `, [totalCases, progressMessage, completedChunks, failedChunks, taskId]);

    logger.info('executeMapPhase 完成', {
      taskId,
      totalChunks: chunks.length,
      completedChunks,
      failedChunks,
      totalCases
    });

    return { completedChunks, failedChunks, totalChunks: chunks.length };
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  async loadAgentPrompt(agentId) {
    if (!agentId) return null;

    const [configFiles] = await pool.execute(`
      SELECT file_type, content FROM ai_sub_agent_config_files WHERE agent_id = ? ORDER BY sort_order ASC
    `, [agentId]);

    if (configFiles.length === 0) return null;

    const soulFile = configFiles.find(f => f.file_type === 'soul');
    const userFile = configFiles.find(f => f.file_type === 'user');

    return {
      system: soulFile?.content || null,
      userTemplate: userFile?.content || null
    };
  }

  async generateCasesFromChunk(chunk, task, config, agentPrompt, chunkContext = {}, globalAwareness = {}) {
    const { globalContext = '', allValidLevel1 = [] } = globalAwareness;
    const systemPrompt = agentPrompt?.system || this.getDefaultSystemPrompt();
    const userPrompt = agentPrompt?.userTemplate 
      ? this.applyTemplate(agentPrompt.userTemplate, chunk, task, config, chunkContext, globalAwareness)
      : this.buildPrompt(chunk, task, config, chunkContext, globalAwareness);

    const generateStartTime = Date.now();

    logger.debug('生成用例Prompt', {
      chunkId: chunk.id,
      hasAgentPrompt: !!agentPrompt,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      userPromptPreview: userPrompt.substring(0, 300)
    });

    const aiConfig = await this.getAIConfig(task.user_id);

    const response = await this.callAI(aiConfig, systemPrompt, userPrompt, config, task.user_id, task.username, task.library_id, task.module_id);

    const content = response.choices?.[0]?.message?.content || '';
    const usage = response.usage || {};
    
    logger.info('AI返回内容', { 
      chunkId: chunk.id,
      contentLength: content.length,
      contentPreview: content.substring(0, 500)
    });
    
    const cases = this.parseAIResponse(content);

    if (cases.length > 0) {
      const executionTimeMs = Date.now() - generateStartTime;

      aiAuditLogger.logSuccess({
        userId: task.user_id,
        username: task.username,
        skillName: 'AI生成测试用例',
        operationType: 'GENERATE',
        executionTimeMs,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        modelName: aiConfig.model_name || config?.model || 'deepseek-chat',
        resultCount: cases.length
      });

      aiRequestLogger.logSuccess({
        userId: task.user_id,
        triggerType: 'generation',
        triggerSource: 'case_generator',
        triggerSourceName: 'AI生成测试用例',
        systemPrompt,
        userPrompt,
        aiResponse: content,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        modelName: aiConfig.model_name || config?.model || 'deepseek-chat',
        executionTimeMs,
        libraryId: task.library_id,
        moduleId: task.module_id
      });
    } else if (content.length > 0) {
      logger.warn('AI返回内容解析失败，未生成有效用例', {
        chunkId: chunk.id,
        contentLength: content.length,
        contentPreview: content.substring(0, 200)
      });

      const executionTimeMs = Date.now() - (this._lastAIStartTime || Date.now());

      aiAuditLogger.logFailure({
        userId: task.user_id,
        username: task.username,
        skillName: 'AI生成测试用例',
        operationType: 'GENERATE',
        executionTimeMs,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        modelName: aiConfig.model_name || config?.model || 'deepseek-chat',
        errorMessage: 'AI返回内容无法解析为有效的测试用例JSON格式'
      });

      aiRequestLogger.logFailure({
        userId: task.user_id,
        triggerType: 'generation',
        triggerSource: 'case_generator',
        triggerSourceName: 'AI生成测试用例',
        systemPrompt,
        userPrompt,
        aiResponse: content,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        modelName: aiConfig.model_name || config?.model || 'deepseek-chat',
        errorMessage: 'AI返回内容无法解析为有效的测试用例JSON格式',
        libraryId: task.library_id,
        moduleId: task.module_id
      });
    }
    
    return cases;
  }

  getDefaultSystemPrompt() {
    return `你是一个专业的测试用例设计专家，拥有丰富的软件测试经验。
你的任务是根据用户提供的需求材料，生成高质量、可执行的测试用例。

## 专业能力
1. 深入理解软件测试原理和方法
2. 熟悉各种测试类型：功能测试、性能测试、安全测试、兼容性测试等
3. 能够识别边界条件和异常场景
4. 善于设计可验证的测试步骤和预期结果

## 输出原则
1. 用例名称要简洁明确，能体现测试点
2. 测试步骤要具体可执行，编号清晰
3. 预期结果要明确可验证
4. 考虑正常场景和异常场景
5. 仅根据提供的材料内容生成，不要臆测`;
  }

  buildPrompt(chunk, task, config, chunkContext = {}, globalAwareness = {}) {
    const { globalContext = '', allValidLevel1 = [] } = globalAwareness;
    const caseLimit = config.caseCountLimit || 20;

    let contextSection = '';
    if (chunkContext.parentContext) {
      contextSection += '\n## 所属大段落上下文（当前片段是此大段落的子片段，仅供理解整体语义，不要为大段落上下文生成用例）\n';
      contextSection += `${chunkContext.parentContext}\n\n`;
    }
    if (chunkContext.prevContext || chunkContext.nextContext) {
      contextSection += '\n## 相邻片段上下文（仅供理解当前片段的语义衔接，不要为上下文内容生成用例）\n';
      if (chunkContext.prevContext) {
        contextSection += `### 前一片段尾部:\n...${chunkContext.prevContext}\n\n`;
      }
      if (chunkContext.nextContext) {
        contextSection += `### 后一片段头部:\n${chunkContext.nextContext}...\n\n`;
      }
    }

    let globalContextSection = '';
    if (globalContext) {
      globalContextSection = `\n## 全局系统背景\n${globalContext}\n`;
    }

    let level1Section = '';
    if (allValidLevel1.length > 0) {
      level1Section = `\n## 可选的一级测试点（level1_point 必须从以下选项中选择，不要自创）\n`;
      level1Section += allValidLevel1.map((p, i) => `${i + 1}. ${p.name} (${p.test_type || '功能测试'})`).join('\n');
      level1Section += '\n\n注意：如果当前片段的测试内容无法归入以上任何测试点，选择最接近的一个。\n';
    }

    return `## 模块背景
模块名称: ${task.module_name}
模块描述: ${task.module_desc || task.module_name || '无'}
${globalContextSection}${level1Section}${contextSection}## 当前材料片段
文件: ${chunk.file_name}
片段序号: ${chunk.chunk_index + 1}
${chunk.chunk_type === 'child' ? '片段类型: 子片段（大段落的精细切分）\n' : ''}内容:
${chunk.chunk_content}

## 生成要求
1. 结合全局系统背景的约束生成用例
2. 主要根据当前片段内容生成测试用例，结合上下文理解语义
3. 如果片段内容不足以生成完整用例，可以跳过
4. 用例名称要能体现测试点
5. 测试步骤要具体可执行
6. 预期结果要明确可验证
7. 最多生成 ${caseLimit} 个用例

## 输出格式
请严格按照以下JSON格式输出:
\`\`\`json
{
  "cases": [
    {
      "name": "用例名称",
      "priority": "高/中/低",
      "type": "功能测试/性能测试/压力测试/规格测试/异常测试",
      "level1_point": "一级测试点名称",
      "precondition": "前置条件",
      "purpose": "测试目的",
      "steps": "1. 步骤1\\n2. 步骤2\\n3. 步骤3",
      "expected": "预期结果",
      "key_config": "关键配置(可选)",
      "remark": "备注(可选)"
    }
  ]
}
\`\`\``;
  }

  applyTemplate(template, chunk, task, config, chunkContext = {}, globalAwareness = {}) {
    const { globalContext = '', allValidLevel1 = [] } = globalAwareness;
    const moduleDesc = task.module_desc || task.module_name || '无';
    const focusAreas = (config.focusAreas || []).join(', ');
    const caseLimit = config.caseCountLimit || 20;
    
    let context = `模块名称: ${task.module_name}\n`;
    context += `模块描述: ${moduleDesc}\n`;
    if (focusAreas) {
      context += `重点关注: ${focusAreas}\n`;
    }

    let prevContextStr = '';
    if (chunkContext.prevContext) {
      prevContextStr = `前一片段尾部:\n...${chunkContext.prevContext}`;
    }
    let nextContextStr = '';
    if (chunkContext.nextContext) {
      nextContextStr = `后一片段头部:\n${chunkContext.nextContext}...`;
    }
    let adjacentContext = '';
    if (prevContextStr || nextContextStr) {
      adjacentContext = '相邻片段上下文（仅供理解语义衔接，不要为上下文内容生成用例）:\n';
      if (prevContextStr) adjacentContext += prevContextStr + '\n';
      if (nextContextStr) adjacentContext += nextContextStr + '\n';
    }

    let parentContextStr = '';
    if (chunkContext.parentContext) {
      parentContextStr = `所属大段落上下文（当前片段是此大段落的子片段，仅供理解整体语义）:\n${chunkContext.parentContext}`;
    }
    
    let level1EnumStr = '';
    if (allValidLevel1.length > 0) {
      level1EnumStr = allValidLevel1.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    }

    const result = template
      .replace(/\{\{module_name\}\}/g, task.module_name)
      .replace(/\{\{module_description\}\}/g, moduleDesc)
      .replace(/\{\{material_content\}\}/g, chunk.chunk_content)
      .replace(/\{\{content\}\}/g, chunk.chunk_content)
      .replace(/\{\{case_count_limit\}\}/g, caseLimit)
      .replace(/\{\{focus_areas\}\}/g, focusAreas)
      .replace(/\{\{existing_case_style\}\}/g, config.existingCaseStyle || '无')
      .replace(/\{\{prev_context\}\}/g, prevContextStr)
      .replace(/\{\{next_context\}\}/g, nextContextStr)
      .replace(/\{\{adjacent_context\}\}/g, adjacentContext)
      .replace(/\{\{parent_context\}\}/g, parentContextStr)
      .replace(/\{\{global_context\}\}/g, globalContext)
      .replace(/\{\{level1_enum\}\}/g, level1EnumStr)
      .replace(/\{\{context\}\}/g, context);
    
    logger.debug('模板替换完成', {
      chunkId: chunk.id,
      templateLength: template.length,
      resultLength: result.length,
      hasContent: result.includes(chunk.chunk_content.substring(0, 50))
    });
    
    return result;
  }

  _buildChunkContext(chunk, prevChunk, nextChunk, contextChars) {
    const context = {
      prevContext: null,
      nextContext: null,
      parentContext: null
    };

    if (chunk.chunk_type === 'child' && chunk.parent_chunk_content) {
      context.parentContext = chunk.parent_chunk_content;
    }

    if (prevChunk) {
      if (prevChunk.chunk_type === 'child' && prevChunk.parent_chunk_id === chunk.parent_chunk_id) {
        context.prevContext = prevChunk.chunk_content.slice(-contextChars);
      } else if (prevChunk.chunk_type !== 'child') {
        context.prevContext = prevChunk.chunk_content.slice(-contextChars);
      }
    }

    if (nextChunk) {
      if (nextChunk.chunk_type === 'child' && nextChunk.parent_chunk_id === chunk.parent_chunk_id) {
        context.nextContext = nextChunk.chunk_content.slice(0, contextChars);
      } else if (nextChunk.chunk_type !== 'child') {
        context.nextContext = nextChunk.chunk_content.slice(0, contextChars);
      }
    }

    return context;
  }

  async getAIConfig(userId) {
    const aiService = require('./aiService');
    return aiService.getUserAIConfig(userId);
  }

  async callAI(aiConfig, systemPrompt, userPrompt, config, userId, username = null, libraryId = null, moduleId = null) {
    const axios = require('axios');
    const { getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams } = require('./aiService');
    const timeoutConfig = await getUserAITimeoutConfig(userId);
    const genParams = await getUserAIGenerationParams(userId);
    const sceneParams = getSceneParams(genParams, 'scene_case_generation');
    const apiKey = aiConfig.api_key;
    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || config?.model || 'deepseek-chat';

    const effectiveTemp = config?.temperature ?? sceneParams.temperature;
    const effectiveMaxTokens = config?.max_tokens ?? sceneParams.max_tokens;
    const effectiveTimeout = timeoutConfig.generalAITask || genParams.request_timeout || 120000;

    const requestBody = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: effectiveTemp,
      max_tokens: effectiveMaxTokens
    };

    if (genParams.top_p !== undefined && genParams.top_p !== 1.0) {
      requestBody.top_p = genParams.top_p;
    }
    if (genParams.frequency_penalty !== undefined && genParams.frequency_penalty !== 0) {
      requestBody.frequency_penalty = genParams.frequency_penalty;
    }
    if (genParams.presence_penalty !== undefined && genParams.presence_penalty !== 0) {
      requestBody.presence_penalty = genParams.presence_penalty;
    }

    return callAIWithRetry(async () => {
      const startTime = Date.now();
      try {
        const response = await axios.post(apiUrl, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: effectiveTimeout + 10000
        });

        const executionTimeMs = Date.now() - startTime;
        const promptTokens = response.data?.usage?.prompt_tokens || 0;
        const completionTokens = response.data?.usage?.completion_tokens || 0;
        const totalTokens = response.data?.usage?.total_tokens || 0;
        const aiResponse = response.data?.choices?.[0]?.message?.content || '';

        logger.info('AI API 调用成功', {
          model,
          status: response.status,
          hasContent: !!aiResponse,
          executionTimeMs,
          totalTokens
        });

        return response.data;
      } catch (error) {
        const executionTimeMs = Date.now() - startTime;
        let errorMsg = error.message || '未知错误';

        if (error.code === 'ECONNABORTED') {
          errorMsg = `AI API 请求超时（${timeoutConfig.generalAITask/1000}秒），请检查网络或增加超时时间`;
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          errorMsg = `无法连接到 AI API 服务器 (${error.code})，请检查 endpoint 配置: ${apiUrl}`;
        } else if (error.response) {
          const status = error.response.status;
          const data = error.response.data;

          if (status === 401) {
            errorMsg = `AI API 认证失败 (401)，请检查 API Key 是否正确`;
          } else if (status === 429) {
            errorMsg = `AI API 请求频率超限 (429)，请稍后重试`;
          } else if (status >= 500) {
            errorMsg = `AI API 服务器错误 (${status}): ${data?.error?.message || data?.message || errorMsg}`;
          } else {
            errorMsg = `AI API 错误 (${status}): ${JSON.stringify(data).substring(0, 200)}`;
          }
        }

        logger.error('调用 AI API 失败', {
          error: errorMsg,
          code: error.code,
          status: error.response?.status,
          stack: error.stack
        });

        aiAuditLogger.logFailure({
          userId,
          username,
          skillName: 'AI生成测试用例',
          operationType: 'GENERATE',
          executionTimeMs,
          errorMessage: errorMsg,
          modelName: model
        });

        aiRequestLogger.logFailure({
          userId,
          triggerType: 'generation',
          triggerSource: 'case_generator',
          triggerSourceName: 'AI生成测试用例',
          systemPrompt,
          userPrompt,
          executionTimeMs,
          errorMessage: errorMsg,
          modelName: model,
          libraryId,
          moduleId
        });

        throw new Error(errorMsg);
      }
    }, aiConfig, { triggerSource: 'case_generator', model });
  }

  extractCasesFromParsed(parsed) {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      const caseKeys = ['cases', 'test_cases', 'testCases', 'items'];
      for (const key of caseKeys) {
        if (Array.isArray(parsed[key])) {
          logger.debug(`从JSON中提取用例，使用key: ${key}`, { casesCount: parsed[key].length });
          return parsed[key];
        }
      }
      if (Array.isArray(parsed.data)) {
        logger.debug('从JSON中提取用例，使用key: data', { casesCount: parsed.data.length });
        return parsed.data;
      }
    }
    return [];
  }

  parseAIResponse(content) {
    logger.debug('开始解析AI响应', { contentLength: content.length });
    
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      logger.debug('找到JSON代码块', { matchedLength: jsonMatch[1].length });
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const cases = this.extractCasesFromParsed(parsed);
        logger.info('JSON代码块解析成功', { casesCount: cases.length });
        return cases;
      } catch (error) {
        logger.error('JSON代码块解析失败', { 
          error: error.message,
          content: jsonMatch[1].substring(0, 200)
        });
      }
    }

    const truncatedMatch = content.match(/```json\s*([\s\S]+)/);
    if (truncatedMatch) {
      let jsonStr = truncatedMatch[1].replace(/\s*```\s*$/, '');
      logger.debug('尝试解析截断的JSON代码块', { length: jsonStr.length });
      try {
        const parsed = JSON.parse(jsonStr);
        const cases = this.extractCasesFromParsed(parsed);
        logger.info('截断JSON代码块解析成功', { casesCount: cases.length });
        return cases;
      } catch (error) {
        logger.debug('截断JSON直接解析失败，尝试修复', { error: error.message });
        const repaired = this.tryRepairTruncatedJSON(jsonStr);
        if (repaired) {
          try {
            const parsed = JSON.parse(repaired);
            const cases = this.extractCasesFromParsed(parsed);
            logger.info('修复后JSON解析成功', { casesCount: cases.length });
            return cases;
          } catch (repairError) {
            logger.error('修复后JSON解析仍失败', { error: repairError.message });
          }
        }
      }
    }

    logger.debug('未找到JSON代码块，尝试直接解析');
    try {
      const parsed = JSON.parse(content);
      const cases = this.extractCasesFromParsed(parsed);
      logger.info('直接解析JSON成功', { casesCount: cases.length });
      return cases;
    } catch (error) {
      logger.error('直接解析JSON失败', { 
        error: error.message,
        contentPreview: content.substring(0, 200)
      });
      return [];
    }
  }

  tryRepairTruncatedJSON(jsonStr) {
    let str = jsonStr.trimEnd();
    str = str.replace(/,\s*$/, '');

    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') openBraces++;
      if (ch === '}') openBraces--;
      if (ch === '[') openBrackets++;
      if (ch === ']') openBrackets--;
    }

    if (inString) {
      str += '"';
    }

    while (openBrackets > 0) {
      str += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      str += '}';
      openBraces--;
    }

    try {
      JSON.parse(str);
      return str;
    } catch (e) {
      return null;
    }
  }

  async saveTempCases(taskId, moduleId, chunkId, cases, libraryId, allValidLevel1 = []) {
    if (cases.length === 0) return;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const batchSize = 50;
      for (let i = 0; i < cases.length; i += batchSize) {
          const batch = cases.slice(i, i + batchSize);
          const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
          const values = batch.flatMap(c => {
              const level1Result = this._resolveLevel1Point(c, allValidLevel1);
              return [
                  `TEMP-${uuidv4().slice(0, 16).toUpperCase()}`,
                  taskId, moduleId, chunkId,
                  level1Result.level1Id,
                  level1Result.level1Name,
                  level1Result.isNewLevel1,
                  level1Result.level1Source,
                  c.name || '未命名用例',
                  c.priority || '中',
                  c.type || '功能测试',
                  c.precondition || '',
                  c.purpose || '',
                  c.steps || '',
                  c.expected || '',
                  c.key_config || null,
                  c.remark || null
              ];
          });
          await connection.execute(`
              INSERT INTO temp_test_cases 
                  (temp_case_id, task_id, module_id, chunk_id, level1_id, level1_name, 
                   is_new_level1, level1_source, name, priority, type,
                   precondition, purpose, steps, expected, key_config, remark)
              VALUES ${placeholders}
          `, values);
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  _resolveLevel1Point(caseItem, allValidLevel1) {
    if (!allValidLevel1 || allValidLevel1.length === 0) {
      return { level1Id: null, level1Name: null, isNewLevel1: 0, level1Source: 'fallback' };
    }

    const pointName = caseItem.level1_point || caseItem.level1_name || '';

    if (pointName) {
      const exactMatch = allValidLevel1.find(p => p.name === pointName);
      if (exactMatch) {
        return {
          level1Id: exactMatch.isExisting ? exactMatch.id : null,
          level1Name: exactMatch.name,
          isNewLevel1: exactMatch.isExisting ? 0 : 1,
          level1Source: exactMatch.isExisting ? 'existing' : 'skeleton'
        };
      }

      const fuzzyMatch = level1PointService.findFuzzyMatch(pointName, allValidLevel1);
      if (fuzzyMatch) {
        return {
          level1Id: fuzzyMatch.isExisting ? fuzzyMatch.id : null,
          level1Name: fuzzyMatch.name,
          isNewLevel1: fuzzyMatch.isExisting ? 0 : 1,
          level1Source: fuzzyMatch.isExisting ? 'existing' : 'skeleton'
        };
      }
    }

    const caseType = caseItem.type || '功能测试';
    const typeMatches = allValidLevel1.filter(p => p.test_type === caseType);
    if (typeMatches.length > 0) {
      const typeMatch = typeMatches[0];
      return {
        level1Id: typeMatch.isExisting ? typeMatch.id : null,
        level1Name: typeMatch.name,
        isNewLevel1: typeMatch.isExisting ? 0 : 1,
        level1Source: typeMatch.isExisting ? 'existing' : 'skeleton'
      };
    }

    return { level1Id: null, level1Name: null, isNewLevel1: 0, level1Source: 'fallback' };
  }

  async updateProgress(taskId, processed, total, totalCases) {
    const progress = Math.round((processed / total) * 80);
    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET progress = ?, processed_chunks = ?, total_cases = ?,
          progress_message = CONCAT('正在生成用例... ', ?, '/', ?)
      WHERE task_id = ?
    `, [progress, processed, totalCases, processed, total, taskId]);
  }

  async updateProgressFromDB(taskId, processed, total) {
    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total FROM temp_test_cases WHERE task_id = ?
    `, [taskId]);
    const totalCases = countResult[0].total;
    await this.updateProgress(taskId, processed, total, totalCases);
  }

  async createTask(moduleId, userId, options = {}) {
    const taskId = `TASK-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 8).toUpperCase()}`;

    const config = {
      caseCountLimit: options.caseCountLimit || 20,
      enableDedup: options.enableDedup !== false,
      similarityThreshold: options.similarityThreshold || 0.85,
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      focusAreas: options.focusAreas || [],
      level1Mode: options.level1Mode || 'auto',
      selectedLevel1Ids: options.selectedLevel1Ids || [],
      chunkingStrategy: options.chunkingStrategy || 'structure_aware'
    };

    const [result] = await pool.execute(`
      INSERT INTO ai_case_generation_tasks 
        (task_id, module_id, library_id, user_id, config, selected_files, agent_id,
         expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
    `, [taskId, moduleId, options.libraryId || null, userId,
        JSON.stringify(config),
        JSON.stringify(options.selectedFiles || []),
        options.agentId || null]);

    return { taskId, id: result.insertId };
  }

  async getTaskStatus(taskId) {
    const [tasks] = await pool.execute(`
      SELECT t.*, m.name as module_name
      FROM ai_case_generation_tasks t
      JOIN modules m ON t.module_id = m.id
      WHERE t.task_id = ?
    `, [taskId]);

    return tasks[0] || null;
  }

  async getUserTasks(userId, options = {}) {
    const limit = Math.max(1, Math.min(100, parseInt(options.limit) || 20));
    const offset = Math.max(0, parseInt(options.offset) || 0);

    const [tasks] = await pool.execute(`
      SELECT t.*, m.name as module_name
      FROM ai_case_generation_tasks t
      JOIN modules m ON t.module_id = m.id
      WHERE t.user_id = ?
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, [userId]);

    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total FROM ai_case_generation_tasks WHERE user_id = ?
    `, [userId]);

    return {
      tasks,
      total: countResult[0].total
    };
  }

  async cancelTask(taskId, userId) {
    const [result] = await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET status = 'cancelled',
          progress_message = '用户取消'
      WHERE task_id = ? AND user_id = ? AND status IN ('pending', 'processing')
    `, [taskId, userId]);

    return result.affectedRows > 0;
  }

  async retryTask(taskId, userId) {
    const [tasks] = await pool.execute(`
      SELECT * FROM ai_case_generation_tasks WHERE task_id = ? AND user_id = ?
    `, [taskId, userId]);

    if (tasks.length === 0) return false;

    const task = tasks[0];
    if (task.status !== 'failed' && task.status !== 'partial_completed') return false;

    await pool.execute(`DELETE FROM temp_test_cases WHERE task_id = ? AND status != 'merged'`, [taskId]);
    await pool.execute(`DELETE FROM temp_level1_points WHERE task_id = ? AND status != 'merged'`, [taskId]);

    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET status = 'pending', 
          stage = 'init',
          progress = 0,
          processed_chunks = 0,
          total_cases = 0,
          total_chunks = 0,
          completed_chunks = 0,
          failed_chunks = 0,
          progress_message = '等待重试...',
          error_message = NULL,
          error_stack = NULL,
          started_at = NULL,
          completed_at = NULL
      WHERE task_id = ?
    `, [taskId]);

    const selectedFiles = typeof task.selected_files === 'string' 
      ? JSON.parse(task.selected_files || '[]') 
      : (task.selected_files || []);

    if (task.status === 'partial_completed') {
      if (selectedFiles.length > 0) {
        const placeholders = selectedFiles.map(() => '?').join(',');
        await pool.execute(`
          UPDATE ai_material_chunks 
          SET status = 'pending', error_message = NULL, generated_cases = 0
          WHERE file_id IN (${placeholders})
        `, selectedFiles);
      } else {
        await pool.execute(`
          UPDATE ai_material_chunks 
          SET status = 'pending', error_message = NULL, generated_cases = 0
          WHERE module_id = ?
        `, [task.module_id]);
      }
    } else {
      if (selectedFiles.length > 0) {
        const placeholders = selectedFiles.map(() => '?').join(',');
        await pool.execute(`
          UPDATE ai_material_chunks 
          SET status = 'pending', error_message = NULL
          WHERE file_id IN (${placeholders}) AND status = 'failed'
        `, selectedFiles);
      } else {
        await pool.execute(`
          UPDATE ai_material_chunks 
          SET status = 'pending', error_message = NULL
          WHERE module_id = ? AND status = 'failed'
        `, [task.module_id]);
      }
    }

    return true;
  }
}

module.exports = new CaseGeneratorService();
