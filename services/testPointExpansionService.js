const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const logger = require('./logger');
const embeddingAdapter = require('./embeddingAdapter');
const dedupService = require('./dedupService');
const { getSystemDefaultAIConfig, getUserAITimeoutConfig } = require('./aiService');
const { buildAIHeaders } = require('./aiCallWrapper');

const EXPANSION_DIMENSIONS = ['functional', 'boundary', 'exception', 'combination', 'state'];
const DIMENSION_LABELS = {
  functional: '功能',
  boundary: '边界',
  exception: '异常',
  combination: '组合',
  state: '状态'
};

class TestPointExpansionService {
  async expand(taskId, moduleId, existingPoints, globalContext) {
    const allNewPoints = [];
    const processedPoints = [];

    const aiConfig = await getSystemDefaultAIConfig();
    if (!aiConfig || !aiConfig.api_key) {
      logger.warn('测试点扩展-AI配置不可用', { taskId });
      return { expandedCount: 0, newPoints: [] };
    }

    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';
    const headers = buildAIHeaders(aiConfig.provider, aiConfig.api_key);

    let userId = null;
    try {
      const [tasks] = await pool.execute(
        'SELECT user_id FROM ai_case_generation_tasks WHERE task_id = ?',
        [taskId]
      );
      userId = tasks.length > 0 ? tasks[0].user_id : null;
    } catch (_) {}
    const timeoutConfig = await getUserAITimeoutConfig(userId);
    const effectiveTimeout = timeoutConfig.generalAITask || 120000;

    for (const point of existingPoints) {
      try {
        const ragContext = await this._ragSearch(point.name, moduleId);
        const prompt = this._buildExpansionPrompt(point, ragContext, globalContext);

        const requestBody = {
          model,
          messages: [
            { role: 'system', content: '你是一个专业的测试用例设计专家，擅长从多个维度扩展测试点覆盖范围。请严格按照要求的JSON格式输出。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.5,
          max_tokens: 4000
        };

        const response = await axios.post(apiUrl, requestBody, {
          headers,
          timeout: effectiveTimeout + 10000
        });

        const content = response.data?.choices?.[0]?.message?.content || '';
        const expandedPoints = this._parseExpansionResponse(content);

        const dedupedPoints = [];
        for (const ep of expandedPoints) {
          let isDuplicate = false;
          const epText = `${ep.name} ${ep.description || ''}`;

          for (const existing of existingPoints) {
            const existingText = `${existing.name} ${existing.description || ''}`;
            const similarity = dedupService.calculateTextSimilarity(epText, existingText);
            if (similarity >= 0.85) {
              isDuplicate = true;
              break;
            }
          }

          if (!isDuplicate) {
            for (const alreadyAdded of allNewPoints) {
              const alreadyText = `${alreadyAdded.name} ${alreadyAdded.description || ''}`;
              const similarity = dedupService.calculateTextSimilarity(epText, alreadyText);
              if (similarity >= 0.85) {
                isDuplicate = true;
                break;
              }
            }
          }

          if (!isDuplicate) {
            dedupedPoints.push(ep);
          }
        }

        if (dedupedPoints.length > 0) {
          const values = dedupedPoints.map(ep => [
            `TEMP-L1-${uuidv4().slice(0, 8).toUpperCase()}`,
            taskId,
            moduleId,
            ep.name,
            ep.test_type || '功能测试',
            ep.description || '',
            ep.dimension || 'functional'
          ]);
          const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
          await pool.execute(`
            INSERT INTO temp_level1_points
              (temp_level1_id, task_id, module_id, name, test_type, description, expansion_dimension)
            VALUES ${placeholders}
          `, values.flat());

          allNewPoints.push(...dedupedPoints);
        }

        processedPoints.push({
          pointName: point.name,
          expandedCount: dedupedPoints.length,
          dimensions: dedupedPoints.map(p => p.dimension)
        });

        logger.info('测试点扩展-单个完成', {
          taskId,
          pointName: point.name,
          rawCount: expandedPoints.length,
          dedupedCount: dedupedPoints.length
        });
      } catch (error) {
        logger.warn('测试点扩展-单个失败，跳过继续', {
          taskId,
          pointName: point.name,
          error: error.message
        });
      }
    }

    logger.info('测试点扩展-全部完成', {
      taskId,
      totalExisting: existingPoints.length,
      totalExpanded: allNewPoints.length,
      processedCount: processedPoints.length
    });

    return {
      expandedCount: allNewPoints.length,
      newPoints: allNewPoints
    };
  }

  _buildExpansionPrompt(point, ragContext, globalContext) {
    const dimensionDesc = EXPANSION_DIMENSIONS.map(d => `- ${d}(${DIMENSION_LABELS[d]})`).join('\n');

    let contextSection = '';
    if (globalContext) {
      contextSection += `【全局系统背景】\n${globalContext}\n\n`;
    }
    if (ragContext) {
      contextSection += `【相关知识参考】\n${ragContext}\n\n`;
    }

    return `请对以下测试点进行5维度扩展，生成更全面的测试覆盖。

当前测试点：
- 名称：${point.name}
- 类型：${point.test_type || '功能测试'}
- 描述：${point.description || '无'}

${contextSection}扩展维度说明：
${dimensionDesc}

要求：
1. 每个维度生成1-3个扩展测试点
2. 扩展测试点名称需体现该维度的特征
3. 不要与原测试点重复
4. 严格按照JSON数组格式输出

输出格式：
\`\`\`json
[
  {"name": "扩展测试点名称", "test_type": "测试类型", "description": "简短描述", "dimension": "维度标识"}
]
\`\`\``;
  }

  async _ragSearch(pointName, moduleId) {
    const allResults = [];

    try {
      const cliResults = await embeddingAdapter.search(pointName, 5, { fileCategory: 'cli', moduleId });
      allResults.push(...cliResults);
    } catch (error) {
      logger.warn('测试点扩展-RAG搜索cli失败', { pointName, error: error.message });
    }

    try {
      const methodologyResults = await embeddingAdapter.search(pointName, 5, { fileCategory: 'methodology', moduleId });
      allResults.push(...methodologyResults);
    } catch (error) {
      logger.warn('测试点扩展-RAG搜索methodology失败', { pointName, error: error.message });
    }

    try {
      const tclResults = await embeddingAdapter.search(pointName, 5, { fileCategory: 'tcl_convention', moduleId });
      allResults.push(...tclResults);
    } catch (error) {
      logger.warn('测试点扩展-RAG搜索tcl_convention失败', { pointName, error: error.message });
    }

    const seen = new Set();
    const unique = [];
    for (const r of allResults) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        unique.push(r);
      }
    }
    unique.sort((a, b) => b.similarity - a.similarity);

    const topResults = unique.slice(0, 10);
    if (topResults.length === 0) return '';

    return topResults.map((r, i) => `[${i + 1}] [${r.fileCategory}] ${r.chunkContent.slice(0, 500)}`).join('\n\n');
  }

  _parseExpansionResponse(content) {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) return this._validateExpansionPoints(parsed);
      } catch (e) {}
    }

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return this._validateExpansionPoints(parsed);
    } catch (e) {}

    return [];
  }

  _validateExpansionPoints(points) {
    const validDimensions = new Set(EXPANSION_DIMENSIONS);
    return points
      .filter(p => p.name && typeof p.name === 'string' && p.name.trim())
      .map(p => ({
        name: p.name.trim(),
        test_type: (p.test_type && typeof p.test_type === 'string') ? p.test_type.trim() : '功能测试',
        description: (p.description && typeof p.description === 'string') ? p.description.trim() : '',
        dimension: validDimensions.has(p.dimension) ? p.dimension : 'functional'
      }));
  }
}

module.exports = new TestPointExpansionService();
