const pool = require('../db');
const crypto = require('crypto');
const logger = require('./logger');

class ChunkingService {
  constructor() {
    this.SENTENCE_SPLIT_REGEX = /(?<=[。！？!?\n])\s*/g;
    this.SEMANTIC_SIMILARITY_THRESHOLD = 0.45;
    this.BREAKPOINT_PERCENTILE = 0.25;
    this.MIN_SENTENCES_PER_CHUNK = 3;
    this.PARENT_CHUNK_SIZE = 4000;
    this.PARENT_OVERLAP = 300;
    this.CHILD_CHUNK_SIZE = 800;
    this.CHILD_OVERLAP = 100;
    this.MIN_CHILD_CHUNK_SIZE = 100;
    this.EMBEDDING_BATCH_SIZE = 20;
  }

  splitIntoSentences(text) {
    const raw = text.split(this.SENTENCE_SPLIT_REGEX).filter(s => s.trim().length > 0);
    const sentences = [];
    let pos = 0;
    for (const s of raw) {
      const trimmed = s.trim();
      if (trimmed.length > 0) {
        sentences.push({ text: trimmed, start: pos, end: pos + s.length });
      }
      pos += s.length;
    }
    return sentences;
  }

  async generateEmbeddings(texts, userId) {
    const aiService = require('./aiService');
    const aiConfig = await aiService.getSystemDefaultAIConfig();

    if (!aiConfig || !aiConfig.api_key) {
      logger.warn('无可用AI配置，无法生成embedding');
      return null;
    }

    const embeddingUrl = aiConfig.embedding_api_url || aiConfig.api_url?.replace('/chat/completions', '/embeddings');
    if (!embeddingUrl) {
      logger.warn('无可用Embedding API URL');
      return null;
    }

    try {
      const axios = require('axios');
      const timeoutConfig = await aiService.getUserAITimeoutConfig(userId);
      const effectiveTimeout = timeoutConfig.generalAITask || 120000;
      const model = aiConfig.embedding_model || 'text-embedding-v3';

      const allEmbeddings = [];

      for (let i = 0; i < texts.length; i += this.EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(i, i + this.EMBEDDING_BATCH_SIZE);
        const truncatedBatch = batch.map(t => t.slice(0, 8000));

        const response = await axios.post(embeddingUrl, {
          model,
          input: truncatedBatch
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiConfig.api_key}`
          },
          timeout: effectiveTimeout + 10000
        });

        const batchEmbeddings = response.data?.data || [];
        batchEmbeddings.sort((a, b) => a.index - b.index);
        allEmbeddings.push(...batchEmbeddings.map(d => d.embedding));

        logger.debug('Embedding批次生成完成', {
          batchIndex: Math.floor(i / this.EMBEDDING_BATCH_SIZE),
          batchSize: batch.length,
          totalProgress: `${Math.min(i + this.EMBEDDING_BATCH_SIZE, texts.length)}/${texts.length}`
        });
      }

      return allEmbeddings;
    } catch (error) {
      logger.error('批量生成embedding失败', { error: error.message, textCount: texts.length });
      return null;
    }
  }

  calculateCosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;

    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  computeSimilarities(embeddings) {
    const similarities = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
      similarities.push(this.calculateCosineSimilarity(embeddings[i], embeddings[i + 1]));
    }
    return similarities;
  }

  findBreakpoints(similarities, threshold) {
    if (similarities.length === 0) return [];

    const sorted = [...similarities].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * this.BREAKPOINT_PERCENTILE);
    const dynamicThreshold = sorted[idx] || threshold;
    const effectiveThreshold = Math.min(threshold, dynamicThreshold);

    const breakpoints = [];
    for (let i = 0; i < similarities.length; i++) {
      if (similarities[i] < effectiveThreshold) {
        breakpoints.push(i);
      }
    }

    return breakpoints;
  }

  groupSentencesIntoChunks(sentences, breakpoints, options = {}) {
    const { maxChunkSize = 2000, minChunkSize = 100 } = options;
    const chunks = [];
    let groupStart = 0;

    const allBreaks = [...breakpoints, sentences.length - 1];
    const uniqueBreaks = [...new Set(allBreaks)].sort((a, b) => a - b);

    for (const breakIdx of uniqueBreaks) {
      const groupEnd = breakIdx + 1;
      const groupSentences = sentences.slice(groupStart, groupEnd);
      const groupText = groupSentences.map(s => s.text).join('');

      if (groupText.length > maxChunkSize) {
        let subStart = groupStart;
        let subText = '';

        for (let j = groupStart; j < groupEnd; j++) {
          const candidate = subText + sentences[j].text;

          if (candidate.length > maxChunkSize && subText.length >= minChunkSize) {
            chunks.push({
              content: subText.trim(),
              sentenceRange: [subStart, j]
            });
            subText = sentences[j].text;
            subStart = j;
          } else {
            subText = candidate;
          }
        }

        if (subText.trim().length >= minChunkSize) {
          chunks.push({
            content: subText.trim(),
            sentenceRange: [subStart, groupEnd]
          });
        }
      } else if (groupText.trim().length >= minChunkSize) {
        chunks.push({
          content: groupText.trim(),
          sentenceRange: [groupStart, groupEnd]
        });
      } else if (chunks.length > 0) {
        chunks[chunks.length - 1].content += '\n' + groupText.trim();
        chunks[chunks.length - 1].sentenceRange[1] = groupEnd;
      } else if (groupText.trim().length > 0) {
        chunks.push({
          content: groupText.trim(),
          sentenceRange: [groupStart, groupEnd]
        });
      }

      groupStart = groupEnd;
    }

    return chunks;
  }

  async semanticChunk(content, options = {}) {
    const {
      chunkSize = 2000,
      minChunkSize = 100,
      similarityThreshold = this.SEMANTIC_SIMILARITY_THRESHOLD,
      userId = null
    } = options;

    const sentences = this.splitIntoSentences(content);

    if (sentences.length <= this.MIN_SENTENCES_PER_CHUNK) {
      logger.info('文本句子数过少，无需语义切分', { sentenceCount: sentences.length });
      return this._fallbackChunk(content, chunkSize, minChunkSize);
    }

    const sentenceTexts = sentences.map(s => s.text);

    let embeddings = null;
    if (userId) {
      logger.info('开始生成句子embedding用于语义切分', { sentenceCount: sentenceTexts.length });
      embeddings = await this.generateEmbeddings(sentenceTexts, userId);
    }

    if (!embeddings || embeddings.length !== sentenceTexts.length) {
      logger.warn('Embedding生成失败或数量不匹配，降级为结构感知切分');
      return this._fallbackChunk(content, chunkSize, minChunkSize);
    }

    const similarities = this.computeSimilarities(embeddings);

    logger.debug('句子间相似度统计', {
      count: similarities.length,
      mean: (similarities.reduce((a, b) => a + b, 0) / similarities.length).toFixed(4),
      min: Math.min(...similarities).toFixed(4),
      max: Math.max(...similarities).toFixed(4)
    });

    const breakpoints = this.findBreakpoints(similarities, similarityThreshold);

    logger.info('语义断点检测结果', {
      sentenceCount: sentences.length,
      breakpointCount: breakpoints.length,
      breakpoints: breakpoints.slice(0, 20)
    });

    const groupedChunks = this.groupSentencesIntoChunks(sentences, breakpoints, {
      maxChunkSize: chunkSize,
      minChunkSize
    });

    const chunks = groupedChunks.map((g, index) => ({
      chunkIndex: index,
      chunkContent: g.content,
      tokenCount: this.estimateTokens(g.content),
      charCount: g.content.length,
      metadata: {
        chunkingStrategy: 'semantic',
        sentenceRange: g.sentenceRange,
        avgSimilarity: this._avgSimilarityInRange(similarities, g.sentenceRange)
      }
    }));

    logger.info('语义切分完成', {
      totalChunks: chunks.length,
      avgChunkSize: Math.round(chunks.reduce((s, c) => s + c.charCount, 0) / chunks.length)
    });

    return chunks;
  }

  _avgSimilarityInRange(similarities, range) {
    if (!range || !similarities.length) return null;
    const [start, end] = range;
    const relevantSims = similarities.slice(Math.max(0, start), Math.min(end - 1, similarities.length));
    if (relevantSims.length === 0) return null;
    return parseFloat((relevantSims.reduce((a, b) => a + b, 0) / relevantSims.length).toFixed(4));
  }

  _fallbackChunk(content, chunkSize, minChunkSize) {
    const fileParserService = require('./fileParserService');
    return fileParserService.chunkContent(content, { chunkSize, overlap: 200, minChunkSize });
  }

  parentChildChunk(content, options = {}) {
    const {
      parentChunkSize = this.PARENT_CHUNK_SIZE,
      parentOverlap = this.PARENT_OVERLAP,
      childChunkSize = this.CHILD_CHUNK_SIZE,
      childOverlap = this.CHILD_OVERLAP,
      minChildChunkSize = this.MIN_CHILD_CHUNK_SIZE,
      baseChunks = null
    } = options;

    const parentChunks = baseChunks || this._fallbackChunk(content, parentChunkSize, 200);

    const result = {
      parents: [],
      children: []
    };

    for (let pIdx = 0; pIdx < parentChunks.length; pIdx++) {
      const parent = parentChunks[pIdx];
      const parentContent = parent.chunkContent || parent.content || '';

      const parentId = `parent-${pIdx}`;

      result.parents.push({
        chunkIndex: pIdx,
        chunkContent: parentContent,
        tokenCount: this.estimateTokens(parentContent),
        charCount: parentContent.length,
        chunkType: 'parent',
        parentId,
        metadata: {
          chunkingStrategy: 'parent_child',
          chunkType: 'parent',
          childCount: 0
        }
      });

      const childChunks = this._splitIntoChildren(
        parentContent,
        childChunkSize,
        childOverlap,
        minChildChunkSize
      );

      for (let cIdx = 0; cIdx < childChunks.length; cIdx++) {
        const child = childChunks[cIdx];
        result.children.push({
          chunkIndex: result.children.length,
          parentChunkIndex: pIdx,
          parentId,
          chunkContent: child.content,
          tokenCount: this.estimateTokens(child.content),
          charCount: child.content.length,
          chunkType: 'child',
          metadata: {
            chunkingStrategy: 'parent_child',
            chunkType: 'child',
            parentIndex: pIdx,
            childIndexInParent: cIdx,
            parentContentPreview: parentContent.slice(0, 200)
          }
        });
      }

      result.parents[pIdx].metadata.childCount = childChunks.length;
    }

    logger.info('父子切分完成', {
      parentCount: result.parents.length,
      childCount: result.children.length,
      avgParentSize: Math.round(result.parents.reduce((s, p) => s + p.charCount, 0) / result.parents.length),
      avgChildSize: Math.round(result.children.reduce((s, c) => s + c.charCount, 0) / result.children.length)
    });

    return result;
  }

  _splitIntoChildren(parentContent, childSize, overlap, minSize) {
    const children = [];
    let position = 0;

    while (position < parentContent.length) {
      const oldPosition = position;
      let endPosition = Math.min(position + childSize, parentContent.length);
      let chunkText = parentContent.slice(position, endPosition);

      if (endPosition < parentContent.length) {
        const paragraphBreak = chunkText.lastIndexOf('\n\n');
        const sentenceBreak = Math.max(
          chunkText.lastIndexOf('。'),
          chunkText.lastIndexOf('！'),
          chunkText.lastIndexOf('？'),
          chunkText.lastIndexOf('.\n'),
          chunkText.lastIndexOf('\n')
        );

        let bestBreak = -1;
        if (paragraphBreak > minSize) {
          bestBreak = paragraphBreak;
        } else if (sentenceBreak > minSize) {
          bestBreak = sentenceBreak;
        }

        if (bestBreak > minSize) {
          chunkText = chunkText.slice(0, bestBreak + 1);
        }
      }

      const trimmed = chunkText.trim();
      if (trimmed.length >= minSize || (children.length === 0 && trimmed.length > 0)) {
        children.push({ content: trimmed });
      }

      position += chunkText.length - overlap;
      if (position <= oldPosition) position = oldPosition + Math.min(chunkText.length, minSize);
    }

    return children;
  }

  async semanticParentChildChunk(content, options = {}) {
    const {
      userId = null,
      parentChunkSize = this.PARENT_CHUNK_SIZE,
      childChunkSize = this.CHILD_CHUNK_SIZE,
      childOverlap = this.CHILD_OVERLAP,
      minChildChunkSize = this.MIN_CHILD_CHUNK_SIZE,
      similarityThreshold = this.SEMANTIC_SIMILARITY_THRESHOLD
    } = options;

    let baseChunks;
    if (userId) {
      baseChunks = await this.semanticChunk(content, {
        chunkSize: parentChunkSize,
        minChunkSize: 200,
        similarityThreshold,
        userId
      });
    } else {
      baseChunks = this._fallbackChunk(content, parentChunkSize, 200);
    }

    const result = this.parentChildChunk(content, {
      parentChunkSize,
      parentOverlap: this.PARENT_OVERLAP,
      childChunkSize,
      childOverlap,
      minChildChunkSize,
      baseChunks
    });

    if (userId && baseChunks[0]?.metadata?.chunkingStrategy === 'semantic') {
      for (const parent of result.parents) {
        parent.metadata.chunkingStrategy = 'semantic_parent_child';
      }
      for (const child of result.children) {
        child.metadata.chunkingStrategy = 'semantic_parent_child';
      }
    }

    return result;
  }

  estimateTokens(text) {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishMatches = text.match(/[a-zA-Z]+/g) || [];
    const englishCharCount = englishMatches.reduce((sum, w) => sum + w.length, 0);
    const numberMatches = text.match(/\d+/g) || [];
    const numberCharCount = numberMatches.reduce((sum, n) => sum + n.length, 0);
    const others = text.length - chineseChars - englishCharCount - numberCharCount;

    return Math.ceil(chineseChars * 0.6 + englishCharCount * 0.25 + numberCharCount * 0.3 + others * 0.3);
  }

  async saveParentChildChunks(fileId, moduleId, parentChildResult, libraryId) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.execute(`DELETE FROM ai_material_chunks WHERE file_id = ?`, [fileId]);

      const parentIdMap = new Map();
      let globalIndex = 0;

      for (const parent of parentChildResult.parents) {
        const [result] = await connection.execute(`
          INSERT INTO ai_material_chunks
            (file_id, module_id, library_id, chunk_index, chunk_content, token_count, char_count, chunk_type, chunking_strategy, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'parent', ?, ?)
        `, [
          fileId, moduleId || null, libraryId || null,
          globalIndex, parent.chunkContent, parent.tokenCount, parent.charCount,
          parent.metadata.chunkingStrategy,
          JSON.stringify(parent.metadata)
        ]);

        parentIdMap.set(parent.parentId, result.insertId);
        globalIndex++;
      }

      for (const child of parentChildResult.children) {
        const parentDbId = parentIdMap.get(child.parentId) || null;

        await connection.execute(`
          INSERT INTO ai_material_chunks
            (file_id, module_id, library_id, chunk_index, chunk_content, token_count, char_count, chunk_type, parent_chunk_id, chunking_strategy, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'child', ?, ?, ?)
        `, [
          fileId, moduleId || null, libraryId || null,
          globalIndex, child.chunkContent, child.tokenCount, child.charCount,
          parentDbId,
          child.metadata.chunkingStrategy,
          JSON.stringify(child.metadata)
        ]);

        globalIndex++;
      }

      await connection.commit();

      logger.info('父子切分块保存完成', {
        fileId,
        parentCount: parentChildResult.parents.length,
        childCount: parentChildResult.children.length,
        totalChunks: globalIndex
      });

      const allItems = [...parentChildResult.parents, ...parentChildResult.children];
      const totalTokens = allItems.reduce((sum, item) => sum + (item.tokenCount || 0), 0);

      return {
        parentCount: parentChildResult.parents.length,
        childCount: parentChildResult.children.length,
        totalChunks: globalIndex,
        totalTokens
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getParentContext(childChunkId) {
    const [chunks] = await pool.execute(`
      SELECT c.*, p.chunk_content as parent_content, p.chunk_index as parent_chunk_index
      FROM ai_material_chunks c
      LEFT JOIN ai_material_chunks p ON c.parent_chunk_id = p.id
      WHERE c.id = ?
    `, [childChunkId]);

    if (chunks.length === 0) return null;

    const chunk = chunks[0];
    return {
      childContent: chunk.chunk_content,
      parentContent: chunk.parent_content || null,
      chunkType: chunk.chunk_type,
      chunkingStrategy: chunk.chunking_strategy
    };
  }

  async getSiblingChunks(childChunkId) {
    const [chunks] = await pool.execute(`
      SELECT parent_chunk_id FROM ai_material_chunks WHERE id = ? AND chunk_type = 'child'
    `, [childChunkId]);

    if (chunks.length === 0 || !chunks[0].parent_chunk_id) return [];

    const parentId = chunks[0].parent_chunk_id;

    const [siblings] = await pool.execute(`
      SELECT id, chunk_index, chunk_content, char_count
      FROM ai_material_chunks
      WHERE parent_chunk_id = ? AND chunk_type = 'child'
      ORDER BY chunk_index ASC
    `, [parentId]);

    return siblings;
  }
}

module.exports = new ChunkingService();
