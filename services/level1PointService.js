const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const PQueue = require('p-queue').default;
const logger = require('./logger');
const aiAuditLogger = require('./aiAuditLogger');
const aiRequestLogger = require('./aiRequestLogger');
const { callAIWithRetry } = require('./aiCallWrapper');
const { getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams, getUserAIConfig, getSystemDefaultAIConfig } = require('./aiService');

const SKELETON_KEYWORDS = [
  '异常', '错误', '边界', '限制', '失败', '超时', '溢出',
  '冲突', '死锁', '容错', '恢复', '降级', '兼容', '安全',
  '性能', '压力', '并发', '竞态', '泄漏', '崩溃', '防护',
  '校验', '验证', '约束', '违规', '非法', '越权', '注入'
];

class Level1PointService {
  constructor() {
    this.skeletonQueue = new PQueue({ concurrency: parseInt(process.env.SKELETON_CONCURRENCY) || 8 });
  }

  async getExistingLevel1Points(moduleId) {
    const [rows] = await pool.execute(`
      SELECT id, name, test_type, 
             (SELECT COUNT(*) FROM test_cases WHERE level1_id = level1_points.id) as case_count
      FROM level1_points
      WHERE module_id = ?
      ORDER BY order_index, created_at
    `, [moduleId]);
    return rows;
  }

  async executeGlobalAwareness(taskId, moduleId, existingLevel1) {
    const chunks = await this._loadChunksForSkeleton(moduleId, taskId);

    if (!chunks || chunks.length === 0) {
      logger.warn('全局感知阶段无可用chunks', { taskId, moduleId });
      return { success: false, globalContext: '', allValidLevel1: existingLevel1 };
    }

    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET stage = 'skeleton', progress_message = '正在分析文档全貌...'
      WHERE task_id = ?
    `, [taskId]);

    let mapResults = [];
    let mapSuccess = false;
    try {
      mapResults = await this._skeletonMap(chunks, taskId);
      mapSuccess = mapResults.some(r => r.background || (r.test_domains && r.test_domains.length > 0));
    } catch (error) {
      logger.error('骨架Map阶段失败', { taskId, error: error.message });
      return { success: false, globalContext: '', allValidLevel1: existingLevel1 };
    }

    let globalContext = '';
    try {
      globalContext = await this._reduceGlobalContext(mapResults, taskId);
    } catch (error) {
      logger.warn('全局背景合并失败，降级为空', { taskId, error: error.message });
    }

    let deltaLevel1 = [];
    try {
      deltaLevel1 = await this._reduceDeltaLevel1(mapResults, existingLevel1, taskId, moduleId);
    } catch (error) {
      logger.warn('增量测试点提取失败，降级为仅使用已有测试点', { taskId, error: error.message });
    }

    const allValidLevel1 = this._mergeLevel1(existingLevel1, deltaLevel1);

    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET global_context = ?, skeleton_level1_json = ?
      WHERE task_id = ?
    `, [globalContext, JSON.stringify(allValidLevel1), taskId]);

    logger.info('全局感知阶段完成', {
      taskId,
      globalContextLength: globalContext.length,
      existingCount: existingLevel1.length,
      deltaCount: deltaLevel1.length,
      totalCount: allValidLevel1.length
    });

    const hasUsableLevel1 = allValidLevel1.length > 0;

    return {
      success: hasUsableLevel1,
      skeletonExtracted: mapSuccess || deltaLevel1.length > 0,
      globalContext,
      allValidLevel1
    };
  }

  async _loadChunksForSkeleton(moduleId, taskId) {
    const [tasks] = await pool.execute(`
      SELECT selected_files FROM ai_case_generation_tasks WHERE task_id = ?
    `, [taskId]);

    if (tasks.length === 0) return [];

    const selectedFiles = typeof tasks[0].selected_files === 'string'
      ? JSON.parse(tasks[0].selected_files || '[]')
      : (tasks[0].selected_files || []);

    let sql = `
      SELECT c.id, c.chunk_content, c.chunk_index, c.chunk_type
      FROM ai_material_chunks c
      JOIN module_knowledge_files f ON c.file_id = f.id
      WHERE c.module_id = ? AND f.deleted_at IS NULL
        AND (c.chunk_type = 'child' OR c.chunk_type = 'normal' OR c.chunk_type IS NULL)
    `;
    const params = [moduleId];

    if (selectedFiles.length > 0) {
      const placeholders = selectedFiles.map(() => '?').join(',');
      sql += ` AND c.file_id IN (${placeholders})`;
      params.push(...selectedFiles);
    }

    sql += ` ORDER BY c.chunk_index ASC`;

    const [chunks] = await pool.execute(sql, params);
    return chunks;
  }

  async _skeletonMap(chunks, taskId) {
    let aiConfig;
    try {
      aiConfig = await this._getAIConfig(taskId);
    } catch (error) {
      logger.error('骨架Map阶段获取AI配置失败', { taskId, error: error.message });
      throw error;
    }

    const userId = await this._getUserId(taskId);
    const timeoutConfig = await getUserAITimeoutConfig(userId);
    const effectiveTimeout = timeoutConfig.generalAITask || 120000;

    const results = [];
    const tasks = chunks.map((chunk, idx) => this.skeletonQueue.add(async () => {
      const prompt = this._buildSkeletonMapPrompt(chunk.chunk_content);
      try {
        const response = await this._callAI(aiConfig, prompt, userId, effectiveTimeout, 300, 0.3, {
          triggerType: 'generation',
          triggerSource: 'skeleton_map',
          triggerSourceName: '骨架扫描'
        });
        const content = response.choices?.[0]?.message?.content || '';
        const parsed = this._parseSkeletonMapResponse(content);
        logger.info('骨架扫描chunk完成', { taskId, chunkIndex: idx, domains: parsed.test_domains, background: (parsed.background || '').substring(0, 80) });
        return { chunkIndex: idx, ...parsed };
      } catch (error) {
        logger.warn('骨架扫描chunk失败，跳过', { taskId, chunkIndex: idx, error: error.message });
        return { chunkIndex: idx, background: '', test_domains: [] };
      }
    }));

    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }

    results.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return results;
  }

  _buildSkeletonMapPrompt(chunkContent) {
    const truncated = chunkContent.length > 3000 ? chunkContent.slice(0, 3000) + '...' : chunkContent;
    return `请分析以下需求文档片段，提取两类信息：

1. 系统背景信息：硬件型号、软件版本、网络环境、全局配置参数、模块依赖关系、前置条件等关键技术约束
2. 测试领域：该片段涉及的测试领域或功能区域名称

文档片段：
${truncated}

输出格式（严格JSON）：
\`\`\`json
{
  "background": "系统背景关键信息，100字以内",
  "test_domains": ["领域1", "领域2"]
}
\`\`\``;
  }

  _parseSkeletonMapResponse(content) {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          background: parsed.background || '',
          test_domains: Array.isArray(parsed.test_domains) ? parsed.test_domains : []
        };
      } catch (e) {
        // fall through
      }
    }

    try {
      const parsed = JSON.parse(content);
      return {
        background: parsed.background || '',
        test_domains: Array.isArray(parsed.test_domains) ? parsed.test_domains : []
      };
    } catch (e) {
      // fall through
    }

    return { background: '', test_domains: [] };
  }

  async _reduceGlobalContext(mapResults, taskId) {
    const backgrounds = mapResults
      .filter(r => r.background && r.background.trim())
      .map(r => r.background.trim());

    if (backgrounds.length === 0) return '';

    const combined = backgrounds.join('\n');
    if (combined.length <= 500) return combined;

    const aiConfig = await this._getAIConfig(taskId);
    const userId = await this._getUserId(taskId);
    const timeoutConfig = await getUserAITimeoutConfig(userId);
    const effectiveTimeout = timeoutConfig.generalAITask || 120000;

    const prompt = `请将以下多个文档片段的系统背景信息，融合成一份500字以内的"全局测试系统背景说明"。保留所有技术约束和硬性参数，去除重复，保持精炼。

${combined}

输出格式（严格JSON）：
\`\`\`json
{
  "global_context": "全局系统背景说明，500字以内"
}
\`\`\``;

    const response = await this._callAI(aiConfig, prompt, userId, effectiveTimeout, 800, 0.3, {
      triggerType: 'generation',
      triggerSource: 'skeleton_global_context',
      triggerSourceName: '全局背景合并'
    });
    const content = response.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return parsed.global_context || '';
      } catch (e) {
        // fall through
      }
    }

    try {
      const parsed = JSON.parse(content);
      return parsed.global_context || '';
    } catch (e) {
      // fall through
    }

    return combined.slice(0, 500);
  }

  async _reduceDeltaLevel1(mapResults, existingLevel1, taskId, moduleId) {
    const allDomains = [];
    for (const r of mapResults) {
      if (Array.isArray(r.test_domains)) {
        allDomains.push(...r.test_domains);
      }
    }

    const uniqueDomains = [...new Set(allDomains.map(d => d.trim()).filter(d => d))];
    logger.info('增量测试点提取-领域汇总', {
      taskId,
      totalDomains: allDomains.length,
      uniqueDomains: uniqueDomains.length,
      domains: uniqueDomains.slice(0, 20)
    });

    if (uniqueDomains.length === 0) {
      logger.warn('增量测试点提取-无可用测试领域，骨架扫描可能未提取到test_domains', {
        taskId,
        mapResultsCount: mapResults.length,
        mapResultsSample: mapResults.slice(0, 3).map(r => ({ background: (r.background || '').substring(0, 50), domains: r.test_domains }))
      });
      return [];
    }

    const existingNames = new Set(existingLevel1.map(p => this._normalizeName(p.name)));

    const deltaDomains = uniqueDomains.filter(d => {
      const normalized = this._normalizeName(d);
      for (const existingName of existingNames) {
        if (normalized === existingName || normalized.includes(existingName) || existingName.includes(normalized)) {
          return false;
        }
      }
      return true;
    });

    logger.info('增量测试点提取-去重后领域', {
      taskId,
      existingCount: existingLevel1.length,
      deltaDomains: deltaDomains.length,
      filteredOut: uniqueDomains.length - deltaDomains.length,
      deltaDomainsList: deltaDomains.slice(0, 20)
    });

    if (deltaDomains.length === 0) {
      logger.warn('增量测试点提取-所有领域与已有测试点重复', {
        taskId,
        uniqueDomains: uniqueDomains.slice(0, 10),
        existingNames: [...existingNames].slice(0, 10)
      });
      return [];
    }

    const aiConfig = await this._getAIConfig(taskId);
    const userId = await this._getUserId(taskId);
    const timeoutConfig = await getUserAITimeoutConfig(userId);
    const effectiveTimeout = timeoutConfig.generalAITask || 120000;
    const existingNamesStr = existingLevel1.map(p => p.name).join(', ') || '暂无';

    const BATCH_SIZE = 30;
    const allDeltaPoints = [];

    for (let i = 0; i < deltaDomains.length; i += BATCH_SIZE) {
      const batch = deltaDomains.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(deltaDomains.length / BATCH_SIZE);

      logger.info('增量测试点提取-分批处理', {
        taskId,
        batch: `${batchNum}/${totalBatches}`,
        batchSize: batch.length
      });

      const prompt = `请将以下测试领域名称规范化为一级测试点名称。

命名规范："功能/领域名称 + 测试类型"，如"Buffer管理测试"、"异常处理测试"
现有一级测试点（避免重复）：${existingNamesStr}

待规范化的领域：${batch.join(', ')}

输出格式（严格JSON）：
\`\`\`json
{
  "delta_level1_points": [
    {"name": "一级测试点名称", "test_type": "功能测试/性能测试/异常测试/...", "description": "简短描述"}
  ]
}
\`\`\``;

      try {
        const response = await this._callAI(aiConfig, prompt, userId, effectiveTimeout, 2000, 0.3, {
          triggerType: 'generation',
          triggerSource: 'skeleton_delta_level1',
          triggerSourceName: `增量测试点提取(${batchNum}/${totalBatches})`,
          moduleId
        });
        const content = response.choices?.[0]?.message?.content || '';
        const batchPoints = this._parseDeltaLevel1Response(content);
        allDeltaPoints.push(...batchPoints);

        logger.info('增量测试点提取-批次完成', {
          taskId,
          batch: `${batchNum}/${totalBatches}`,
          inputDomains: batch.length,
          extractedPoints: batchPoints.length
        });
      } catch (error) {
        logger.warn('增量测试点提取-批次失败，跳过', {
          taskId,
          batch: `${batchNum}/${totalBatches}`,
          error: error.message
        });
      }
    }

    logger.info('增量测试点提取-全部批次完成', {
      taskId,
      totalBatches: Math.ceil(deltaDomains.length / BATCH_SIZE),
      rawPointsCount: allDeltaPoints.length
    });

    const dedupedPoints = [];
    const allExistingNames = new Set(existingLevel1.map(p => this._normalizeName(p.name)));
    for (const point of allDeltaPoints) {
      const normalized = this._normalizeName(point.name);
      let isDuplicate = false;
      for (const existingName of allExistingNames) {
        if (normalized === existingName || normalized.includes(existingName) || existingName.includes(normalized)) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        dedupedPoints.push(point);
        allExistingNames.add(normalized);
      }
    }

    if (dedupedPoints.length > 0) {
      const values = dedupedPoints.map(point => [
        `TEMP-L1-${uuidv4().slice(0, 8).toUpperCase()}`,
        taskId, moduleId, point.name, point.test_type || '功能测试', point.description || ''
      ]);
      const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
      await pool.execute(`
        INSERT INTO temp_level1_points 
          (temp_level1_id, task_id, module_id, name, test_type, description)
        VALUES ${placeholders}
      `, values.flat());
    }

    return dedupedPoints;
  }

  _parseDeltaLevel1Response(content) {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const points = parsed.delta_level1_points || parsed.level1_points || [];
        if (points.length === 0) {
          logger.warn('增量测试点提取-AI返回JSON但字段为空', {
            rawKeys: Object.keys(parsed),
            contentPreview: content.substring(0, 200)
          });
        }
        return points;
      } catch (e) {
        logger.warn('增量测试点提取-JSON代码块解析失败', {
          error: e.message,
          contentPreview: content.substring(0, 200)
        });
      }
    }

    try {
      const parsed = JSON.parse(content);
      const points = parsed.delta_level1_points || parsed.level1_points || [];
      if (points.length === 0) {
        logger.warn('增量测试点提取-AI返回裸JSON但字段为空', {
          rawKeys: Object.keys(parsed),
          contentPreview: content.substring(0, 200)
        });
      }
      return points;
    } catch (e) {
      logger.warn('增量测试点提取-响应解析完全失败', {
        error: e.message,
        contentLength: content.length,
        contentPreview: content.substring(0, 300)
      });
    }

    return [];
  }

  _mergeLevel1(existingLevel1, deltaLevel1) {
    const result = existingLevel1.map(p => ({
      name: p.name,
      test_type: p.test_type,
      isExisting: true,
      id: p.id
    }));

    const existingNames = new Set(existingLevel1.map(p => this._normalizeName(p.name)));

    for (const delta of deltaLevel1) {
      const normalized = this._normalizeName(delta.name);
      let isDuplicate = false;
      for (const existingName of existingNames) {
        if (normalized === existingName || normalized.includes(existingName) || existingName.includes(normalized)) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        result.push({
          name: delta.name,
          test_type: delta.test_type || '功能测试',
          isExisting: false,
          id: null
        });
        existingNames.add(normalized);
      }
    }

    return result;
  }

  _normalizeName(name) {
    return (name || '').toLowerCase().replace(/\s+/g, '').replace(/[_\-]/g, '').replace(/(测试|验证|检验)$/, '');
  }

  findFuzzyMatch(inputName, allValidLevel1) {
    if (!inputName || !allValidLevel1 || allValidLevel1.length === 0) return null;

    const normalized = this._normalizeName(inputName);

    for (const point of allValidLevel1) {
      const existing = this._normalizeName(point.name);
      if (normalized === existing) return point;
    }

    for (const point of allValidLevel1) {
      const existing = this._normalizeName(point.name);
      if (normalized.includes(existing) || existing.includes(normalized)) {
        return point;
      }
    }

    return null;
  }

  async validateLevel1Assignments(taskId, allValidLevel1) {
    if (!allValidLevel1 || allValidLevel1.length === 0) return;

    const validNames = allValidLevel1.map(p => p.name);
    const normalizedValidNames = allValidLevel1.map(p => this._normalizeName(p.name));
    const fallbackName = '其他测试';

    const [cases] = await pool.execute(`
      SELECT temp_case_id, level1_name FROM temp_test_cases 
      WHERE task_id = ? AND status = 'pending'
    `, [taskId]);

    const toFix = cases.filter(c => {
      if (!c.level1_name) return true;
      if (validNames.includes(c.level1_name)) return false;
      const normalized = this._normalizeName(c.level1_name);
      return !normalizedValidNames.includes(normalized);
    });
    if (toFix.length === 0) return;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const caseItem of toFix) {
        const matched = this.findFuzzyMatch(caseItem.level1_name, allValidLevel1);
        const resolvedName = matched ? matched.name : fallbackName;
        const isNewLevel1 = matched ? (matched.isExisting ? 0 : 1) : 1;
        const level1Source = matched ? (matched.isExisting ? 'existing' : 'skeleton') : 'fallback';

        await connection.execute(`
          UPDATE temp_test_cases 
          SET level1_name = ?, is_new_level1 = ?, level1_source = ?
          WHERE temp_case_id = ?
        `, [resolvedName, isNewLevel1, level1Source, caseItem.temp_case_id]);
      }

      await connection.commit();
      logger.info('一级测试点归属校验修复', { taskId, fixedCount: toFix.length });
    } catch (error) {
      await connection.rollback();
      logger.error('一级测试点归属校验失败', { taskId, error: error.message });
      throw error;
    } finally {
      connection.release();
    }
  }

  async assignExistingLevel1ToCases(taskId, level1Id) {
    const [level1] = await pool.execute(`
      SELECT id, name FROM level1_points WHERE id = ?
    `, [level1Id]);

    if (level1.length === 0) return;

    await pool.execute(`
      UPDATE temp_test_cases 
      SET level1_id = ?, level1_name = ?, is_new_level1 = 0, level1_source = 'existing'
      WHERE task_id = ? AND status = 'pending'
    `, [level1[0].id, level1[0].name, taskId]);
  }

  async mergeLevel1Points(taskId) {
    const [tempPoints] = await pool.execute(`
      SELECT * FROM temp_level1_points 
      WHERE task_id = ? AND status = 'approved'
    `, [taskId]);

    for (const tempPoint of tempPoints) {
      const [result] = await pool.execute(`
        INSERT INTO level1_points (module_id, name, test_type, order_index)
        VALUES (?, ?, ?, ?)
      `, [tempPoint.module_id, tempPoint.name, tempPoint.test_type, tempPoint.order_index]);

      await pool.execute(`
        UPDATE temp_level1_points 
        SET status = 'merged', merged_level1_id = ?
        WHERE id = ?
      `, [result.insertId, tempPoint.id]);

      await pool.execute(`
        UPDATE temp_test_cases 
        SET level1_id = ?
        WHERE level1_name = ? AND task_id = ? AND is_new_level1 = 1
      `, [result.insertId, tempPoint.name, taskId]);
    }
  }

  async getTempLevel1Points(taskId) {
    const [points] = await pool.execute(`
      SELECT tlp.*, 
        (SELECT COUNT(*) FROM temp_test_cases WHERE task_id = tlp.task_id AND level1_name = tlp.name) as case_count
      FROM temp_level1_points tlp
      WHERE tlp.task_id = ?
      ORDER BY tlp.order_index, tlp.created_at
    `, [taskId]);
    return points;
  }

  async approveTempLevel1Point(tempLevel1Id, taskId) {
    await pool.execute(`
      UPDATE temp_level1_points 
      SET status = 'approved'
      WHERE temp_level1_id = ? AND task_id = ?
    `, [tempLevel1Id, taskId]);
  }

  async rejectTempLevel1Point(tempLevel1Id, taskId) {
    await pool.execute(`
      UPDATE temp_level1_points 
      SET status = 'rejected'
      WHERE temp_level1_id = ? AND task_id = ?
    `, [tempLevel1Id, taskId]);
  }

  async _getAIConfig(taskId) {
    const userId = await this._getUserId(taskId);
    if (userId) {
      try {
        return getUserAIConfig(userId);
      } catch (error) {
        logger.warn('获取用户AI配置失败，使用系统默认', { userId, error: error.message });
      }
    }
    return getSystemDefaultAIConfig();
  }

  async _getUserId(taskId) {
    const [tasks] = await pool.execute(`
      SELECT user_id FROM ai_case_generation_tasks WHERE task_id = ?
    `, [taskId]);
    return tasks.length > 0 ? tasks[0].user_id : null;
  }

  async _callAI(aiConfig, userPrompt, userId, effectiveTimeout, maxTokens, temperature, logContext = {}) {
    if (!aiConfig) throw new Error('AI配置不存在');

    const apiKey = aiConfig.api_key;
    if (!apiKey || !apiKey.trim()) throw new Error('AI API Key未配置');

    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const systemPrompt = '你是一个专业的测试用例设计专家，擅长分析需求文档并提取关键信息。请严格按照要求的JSON格式输出。';

    const requestBody = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: temperature || 0.3,
      max_tokens: maxTokens || 300
    };

    const genParams = userId ? await getUserAIGenerationParams(userId) : {};
    if (genParams.top_p !== undefined && genParams.top_p !== 1.0) {
      requestBody.top_p = genParams.top_p;
    }

    const triggerType = logContext.triggerType || 'generation';
    const triggerSource = logContext.triggerSource || 'skeleton';
    const triggerSourceName = logContext.triggerSourceName || '骨架生成';

    return callAIWithRetry(async () => {
      const startTime = Date.now();
      try {
        const response = await axios.post(apiUrl, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: Math.max(effectiveTimeout + 15000, 180000)
        });

        if (!response.data || !response.data.choices || !response.data.choices[0]) {
          throw new Error('AI响应格式异常：缺少choices字段');
        }

        const executionTimeMs = Date.now() - startTime;
        const usage = response.data.usage || {};
        const content = response.data.choices[0].message?.content || '';

        aiAuditLogger.logSuccess({
          userId,
          skillName: triggerSourceName,
          operationType: 'GENERATE',
          executionTimeMs,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          modelName: model,
          resultCount: logContext.resultCount || 1
        });

        aiRequestLogger.logSuccess({
          userId,
          triggerType,
          triggerSource,
          triggerSourceName,
          systemPrompt,
          userPrompt,
          aiResponse: content,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          modelName: model,
          executionTimeMs,
          moduleId: logContext.moduleId || null
        });

        return response.data;
      } catch (error) {
        const executionTimeMs = Date.now() - startTime;
        const errorMessage = error.response?.data?.error?.message || error.message || '未知错误';

        aiAuditLogger.logFailure({
          userId,
          skillName: triggerSourceName,
          operationType: 'GENERATE',
          executionTimeMs,
          errorMessage,
          modelName: model
        });

        aiRequestLogger.logFailure({
          userId,
          triggerType,
          triggerSource,
          triggerSourceName,
          systemPrompt,
          userPrompt,
          executionTimeMs,
          errorMessage,
          modelName: model,
          moduleId: logContext.moduleId || null
        });

        throw error;
      }
    }, aiConfig, { triggerSource: triggerSourceName, model });
  }
}

module.exports = new Level1PointService();
