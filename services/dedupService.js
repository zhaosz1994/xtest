const pool = require('../db');
const crypto = require('crypto');
const logger = require('./logger');

class DedupService {
  constructor() {
    this.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.85;
  }

  calculateCosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  calculateJaccardSimilarity(setA, setB) {
    if (!setA || !setB || setA.length === 0 || setB.length === 0) return 0;
    const intersection = setA.filter(item => setB.includes(item));
    const union = [...new Set([...setA, ...setB])];
    return intersection.length / union.length;
  }

  calculateTextSimilarity(textA, textB) {
    if (!textA || !textB) return 0;
    const tokensA = this.tokenize(textA);
    const tokensB = this.tokenize(textB);
    return this.calculateJaccardSimilarity(tokensA, tokensB);
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  _quickNameFilter(tempName, existingCases, maxCandidates = 50) {
    const candidates = [];
    const tempLower = tempName.toLowerCase();
    for (const existing of existingCases) {
      const existLower = (existing.name || '').toLowerCase();
      let commonPrefixLen = 0;
      const minLen = Math.min(tempLower.length, existLower.length);
      for (let i = 0; i < minLen; i++) {
        if (tempLower[i] === existLower[i]) commonPrefixLen++;
        else break;
      }
      candidates.push({ case: existing, commonPrefixLen });
    }
    candidates.sort((a, b) => b.commonPrefixLen - a.commonPrefixLen);
    return candidates.slice(0, maxCandidates).map(c => c.case);
  }

  async executeReducePhase(taskId) {
    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET stage = 'reducing', progress_message = '正在查重...'
      WHERE task_id = ?
    `, [taskId]);

    const [tasks] = await pool.execute(`
      SELECT module_id, config, user_id FROM ai_case_generation_tasks WHERE task_id = ?
    `, [taskId]);

    if (tasks.length === 0) return;

    const task = tasks[0];
    const config = task.config ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config) : {};
    const threshold = config.similarityThreshold || this.similarityThreshold;
    const enableDedup = config.enableDedup !== false;
    const userId = task.user_id;

    if (!enableDedup) {
      await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET stage = 'finished', progress = 100, progress_message = '任务完成(跳过查重)'
        WHERE task_id = ?
      `, [taskId]);
      return;
    }

    const moduleId = task.module_id;

    const existingCases = await this.loadExistingCases(moduleId);

    const [tempCases] = await pool.execute(`
      SELECT id, temp_case_id, name, purpose, steps, expected
      FROM temp_test_cases
      WHERE task_id = ? AND status = 'pending'
    `, [taskId]);

    let duplicateCount = 0;
    const batchSize = 100;

    for (let i = 0; i < tempCases.length; i += batchSize) {
      const batch = tempCases.slice(i, i + batchSize);

      for (const tempCase of batch) {
        let maxSimilarity = 0;
        let duplicateWithId = null;

        const tempText = `${tempCase.name} ${tempCase.purpose || ''} ${tempCase.steps || ''} ${tempCase.expected || ''}`;

        const tempEmbedding = await this.getOrGenerateEmbedding(tempCase, 'temp', userId);

        // Pre-filter to top candidates by name similarity
        const candidates = this._quickNameFilter(tempCase.name || '', existingCases);

        for (const existing of candidates) {
          let similarity = 0;

          if (tempEmbedding && existing.embedding) {
            similarity = this.calculateCosineSimilarity(tempEmbedding, existing.embedding);
          } else {
            const existingText = `${existing.name} ${existing.purpose || ''} ${existing.steps || ''} ${existing.expected || ''}`;
            similarity = this.calculateTextSimilarity(tempText, existingText);
          }

          if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
            duplicateWithId = existing.caseId;
          }
        }

        const isDuplicate = maxSimilarity >= threshold;

        if (isDuplicate) {
          duplicateCount++;
        }

        await pool.execute(`
          UPDATE temp_test_cases 
          SET duplicate_score = ?,
              is_duplicate = ?,
              duplicate_with_case_id = ?
          WHERE id = ?
        `, [Math.round(maxSimilarity * 100), isDuplicate ? 1 : 0, duplicateWithId, tempCase.id]);
      }

      const progress = 80 + Math.round(((i + batchSize) / tempCases.length) * 20);
      await pool.execute(`
        UPDATE ai_case_generation_tasks 
        SET progress = ?, progress_message = CONCAT('正在查重... ', ?, '/', ?)
        WHERE task_id = ?
      `, [Math.min(progress, 100), Math.min(i + batchSize, tempCases.length), tempCases.length, taskId]);
    }

    await pool.execute(`
      UPDATE ai_case_generation_tasks 
      SET duplicate_count = ?
      WHERE task_id = ?
    `, [duplicateCount, taskId]);
  }

  async loadExistingCases(moduleId) {
    const [rows] = await pool.execute(`
      SELECT tc.id as case_id, tc.name, tc.purpose, tc.steps, tc.expected,
        cei.content_embedding
      FROM test_cases tc
      LEFT JOIN case_embedding_index cei ON tc.id = cei.case_id AND cei.case_type = 'formal'
      WHERE tc.module_id = ?
    `, [moduleId]);

    return rows.map(row => ({
      caseId: row.case_id,
      name: row.name,
      purpose: row.purpose,
      steps: row.steps,
      expected: row.expected,
      embedding: typeof row.content_embedding === 'string' ? JSON.parse(row.content_embedding) : (row.content_embedding || null)
    }));
  }

  async getOrGenerateEmbedding(tempCase, caseType, userId) {
    const content = `${tempCase.name} ${tempCase.purpose || ''} ${tempCase.steps || ''} ${tempCase.expected || ''}`;
    const contentHash = this.hashContent(content);

    const [existing] = await pool.execute(`
      SELECT content_embedding FROM case_embedding_index
      WHERE case_id = ? AND case_type = ? AND content_hash = ?
    `, [tempCase.id, caseType, contentHash]);

    if (existing.length > 0 && existing[0].content_embedding) {
      try {
        return typeof existing[0].content_embedding === 'string' ? JSON.parse(existing[0].content_embedding) : existing[0].content_embedding;
      } catch {
        return null;
      }
    }

    try {
      const embedding = await this.generateEmbedding(content, userId);
      if (embedding && embedding.length > 0) {
        await pool.execute(`
          INSERT INTO case_embedding_index (case_id, case_type, content_embedding, content_hash)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE content_embedding = ?, content_hash = ?
        `, [tempCase.id, caseType, JSON.stringify(embedding), contentHash,
            JSON.stringify(embedding), contentHash]);

        return embedding;
      }
    } catch (error) {
      logger.error('生成embedding失败', { error: error.message });
    }

    return null;
  }

  async generateEmbedding(text, userId) {
    const aiService = require('./aiService');
    const aiConfig = await aiService.getSystemDefaultAIConfig();

    if (!aiConfig || !aiConfig.api_key) return null;

    const embeddingUrl = aiConfig.embedding_api_url || aiConfig.api_url?.replace('/chat/completions', '/embeddings');

    if (!embeddingUrl) return null;

    try {
      const axios = require('axios');
      const timeoutConfig = await aiService.getUserAITimeoutConfig(userId);
      const response = await axios.post(embeddingUrl, {
        model: aiConfig.embedding_model || 'text-embedding-v3',
        input: text.slice(0, 8000)
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.api_key}`
        },
        timeout: timeoutConfig.generalAITask
      });

      return response.data?.data?.[0]?.embedding || null;
    } catch (error) {
      logger.error('调用embedding API失败', { error: error.message });
      return null;
    }
  }

  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

module.exports = new DedupService();
