const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const { default: PQueue } = require('p-queue');
const logger = require('./logger');
const aiAuditLogger = require('./aiAuditLogger');
const aiRequestLogger = require('./aiRequestLogger');

class CaseGeneratorService {
  constructor() {
    this.apiQueue = new PQueue({ concurrency: parseInt(process.env.CHUNK_API_CONCURRENCY) || 4 });
    this.runningTasks = new Set();
  }

  async executeMapPhase(taskId) {
    if (this.runningTasks.has(taskId)) {
      logger.debug('executeMapPhase 任务已在运行中，跳过', { taskId });
      return;
    }
    this.runningTasks.add(taskId);
    logger.debug('executeMapPhase 开始处理任务', { taskId });

    try {
    const [tasks] = await pool.execute(`
      SELECT t.*, m.name as module_name,
        l.name as library_name
      FROM ai_case_generation_tasks t
      JOIN modules m ON t.module_id = m.id
      LEFT JOIN case_libraries l ON t.library_id = l.id
      WHERE t.task_id = ?
    `, [taskId]);

    if (tasks.length === 0) {
      logger.debug('executeMapPhase 任务不存在', { taskId });
      return;
    }

    const task = tasks[0];
    const selectedFiles = typeof task.selected_files === 'string'
      ? JSON.parse(task.selected_files || '[]')
      : (task.selected_files || []);

    let sql = `
      SELECT c.*, f.name as file_name
      FROM ai_material_chunks c
      JOIN module_knowledge_files f ON c.file_id = f.id
      WHERE c.module_id = ? AND c.status = 'pending' AND f.deleted_at IS NULL
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
      return;
    }

    let processedCount = 0;

    const config = task.config ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) : {};

    const agentPrompt = await this.loadAgentPrompt(task.agent_id);

    for (const chunk of chunks) {
      await this.apiQueue.add(async () => {
        try {
          await pool.execute(`
            UPDATE ai_material_chunks 
            SET status = 'processing'
            WHERE id = ?
          `, [chunk.id]);

          const cases = await this.generateCasesFromChunk(chunk, task, config, agentPrompt);

          if (cases.length > 0) {
            await this.saveTempCases(taskId, task.module_id, chunk.id, cases, task.library_id);
          }

          await pool.execute(`
            UPDATE ai_material_chunks 
            SET status = 'completed', generated_cases = ?, processed_at = NOW()
            WHERE id = ?
          `, [cases.length, chunk.id]);

          processedCount++;
          await this.updateProgressFromDB(taskId, processedCount, chunks.length);

        } catch (error) {
          const errorMsg = error.message || error.toString() || '未知错误';
          logger.error('处理chunk失败', { 
            chunkId: chunk.id, 
            taskId, 
            error: errorMsg,
            stack: error.stack
          });
          await pool.execute(`
            UPDATE ai_material_chunks 
            SET status = 'failed', error_message = ?, retry_count = retry_count + 1
            WHERE id = ?
          `, [errorMsg, chunk.id]);
          processedCount++;
          await this.updateProgressFromDB(taskId, processedCount, chunks.length);
        }
      });
    }

    await this.apiQueue.onIdle();

    const [countResult] = await pool.execute(`
      SELECT COUNT(*) as total FROM temp_test_cases WHERE task_id = ?
    `, [taskId]);
    const totalCases = countResult[0].total;

    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET total_cases = ?
      WHERE task_id = ?
    `, [totalCases, taskId]);
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

  async generateCasesFromChunk(chunk, task, config, agentPrompt) {
    const systemPrompt = agentPrompt?.system || this.getDefaultSystemPrompt();
    const userPrompt = agentPrompt?.userTemplate 
      ? this.applyTemplate(agentPrompt.userTemplate, chunk, task, config)
      : this.buildPrompt(chunk, task, config);

    logger.debug('生成用例Prompt', {
      chunkId: chunk.id,
      hasAgentPrompt: !!agentPrompt,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      userPromptPreview: userPrompt.substring(0, 300)
    });

    const aiConfig = await this.getAIConfig(task.user_id);

    const response = await this.callAI(aiConfig, systemPrompt, userPrompt, config, task.user_id, task.library_id, task.module_id);

    const content = response.choices?.[0]?.message?.content || '';
    const usage = response.usage || {};
    
    logger.info('AI返回内容', { 
      chunkId: chunk.id,
      contentLength: content.length,
      contentPreview: content.substring(0, 500)
    });
    
    const cases = this.parseAIResponse(content);
    
    if (cases.length === 0 && content.length > 0) {
      logger.warn('AI返回内容解析失败，未生成有效用例', {
        chunkId: chunk.id,
        contentLength: content.length,
        contentPreview: content.substring(0, 200)
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

  buildPrompt(chunk, task, config) {
    const caseLimit = config.caseCountLimit || 20;
    return `## 模块背景
模块名称: ${task.module_name}
模块描述: ${task.module_desc || task.module_name || '无'}

## 当前材料片段
文件: ${chunk.file_name}
片段序号: ${chunk.chunk_index + 1}
内容:
${chunk.chunk_content}

## 生成要求
1. 仅根据当前片段内容生成测试用例
2. 如果片段内容不足以生成完整用例，可以跳过
3. 用例名称要能体现测试点
4. 测试步骤要具体可执行
5. 预期结果要明确可验证
6. 最多生成 ${caseLimit} 个用例

## 输出格式
请严格按照以下JSON格式输出:
\`\`\`json
{
  "cases": [
    {
      "name": "用例名称",
      "priority": "高/中/低",
      "type": "功能测试/性能测试/压力测试/规格测试/异常测试",
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

  applyTemplate(template, chunk, task, config) {
    const moduleDesc = task.module_desc || task.module_name || '无';
    const focusAreas = (config.focusAreas || []).join(', ');
    const caseLimit = config.caseCountLimit || 20;
    
    let context = `模块名称: ${task.module_name}\n`;
    context += `模块描述: ${moduleDesc}\n`;
    if (focusAreas) {
      context += `重点关注: ${focusAreas}\n`;
    }
    
    const result = template
      .replace(/\{\{module_name\}\}/g, task.module_name)
      .replace(/\{\{module_description\}\}/g, moduleDesc)
      .replace(/\{\{material_content\}\}/g, chunk.chunk_content)
      .replace(/\{\{content\}\}/g, chunk.chunk_content)
      .replace(/\{\{case_count_limit\}\}/g, caseLimit)
      .replace(/\{\{focus_areas\}\}/g, focusAreas)
      .replace(/\{\{existing_case_style\}\}/g, config.existingCaseStyle || '无')
      .replace(/\{\{context\}\}/g, context);
    
    logger.debug('模板替换完成', {
      chunkId: chunk.id,
      templateLength: template.length,
      resultLength: result.length,
      hasContent: result.includes(chunk.chunk_content.substring(0, 50))
    });
    
    return result;
  }

  async getAIConfig(userId) {
    const aiService = require('./aiService');
    return aiService.getUserAIConfig(userId);
  }

  async callAI(aiConfig, systemPrompt, userPrompt, config, userId, libraryId = null, moduleId = null) {
    const axios = require('axios');
    const { getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams } = require('./aiService');
    const timeoutConfig = await getUserAITimeoutConfig(userId);
    const genParams = await getUserAIGenerationParams(userId);
    const sceneParams = getSceneParams(genParams, 'scene_case_generation');
    const apiKey = aiConfig.api_key;
    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || config?.model || 'deepseek-chat';

    logger.info('调用AI API', { 
      apiUrl: apiUrl.replace(/\/v1\/chat\/completions$/, '/...'), 
      model, 
      promptLength: userPrompt.length 
    });

    const effectiveTemp = config?.temperature ?? sceneParams.temperature;
    const effectiveMaxTokens = config?.max_tokens ?? sceneParams.max_tokens;

    const startTime = Date.now();
    try {
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

      const response = await axios.post(apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: timeoutConfig.generalAITask || genParams.request_timeout
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

      aiAuditLogger.logSuccess({
        userId,
        skillName: 'AI生成测试用例',
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
        triggerType: 'generation',
        triggerSource: 'case_generator',
        triggerSourceName: 'AI生成测试用例',
        systemPrompt,
        userPrompt,
        aiResponse,
        promptTokens,
        completionTokens,
        totalTokens,
        modelName: model,
        executionTimeMs,
        libraryId,
        moduleId
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
  }

  parseAIResponse(content) {
    logger.debug('开始解析AI响应', { contentLength: content.length });
    
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      logger.debug('找到JSON代码块', { matchedLength: jsonMatch[1].length });
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const cases = parsed.cases || [];
        logger.info('JSON代码块解析成功', { casesCount: cases.length });
        return cases;
      } catch (error) {
        logger.error('JSON代码块解析失败', { 
          error: error.message,
          content: jsonMatch[1].substring(0, 200)
        });
        return [];
      }
    }

    logger.debug('未找到JSON代码块，尝试直接解析');
    try {
      const parsed = JSON.parse(content);
      const cases = parsed.cases || [];
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

  async saveTempCases(taskId, moduleId, chunkId, cases, libraryId) {
    if (cases.length === 0) return;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const batchSize = 50;
      for (let i = 0; i < cases.length; i += batchSize) {
          const batch = cases.slice(i, i + batchSize);
          const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
          const values = batch.flatMap(c => [
              `TEMP-${uuidv4().slice(0, 16).toUpperCase()}`,
              taskId, moduleId, chunkId,
              c.name || '未命名用例',
              c.priority || '中',
              c.type || '功能测试',
              c.precondition || '',
              c.purpose || '',
              c.steps || '',
              c.expected || '',
              c.key_config || null,
              c.remark || null
          ]);
          await connection.execute(`
              INSERT INTO temp_test_cases 
                  (temp_case_id, task_id, module_id, chunk_id, name, priority, type,
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
      selectedLevel1Ids: options.selectedLevel1Ids || []
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
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

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
    if (task.status !== 'failed') return false;

    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET status = 'pending', 
          stage = 'init',
          progress = 0,
          processed_chunks = 0,
          total_cases = 0,
          total_chunks = 0,
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

    return true;
  }
}

module.exports = new CaseGeneratorService();
