const pool = require('../db');
const logger = require('./logger');
const chunkingService = require('./chunkingService');
const dedupService = require('./dedupService');

class EmbeddingAdapter {
  constructor() {
    this.backend = process.env.EMBEDDING_BACKEND || 'mysql';
    this.columnCache = new Map();
  }

  async generateEmbedding(texts, options = {}) {
    return chunkingService.generateEmbeddings(texts, options.userId);
  }

  async _getExistingColumns(tableName) {
    if (this.columnCache.has(tableName)) {
      return this.columnCache.get(tableName);
    }
    const [rows] = await pool.execute(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [tableName]
    );
    const columns = new Set(rows.map(row => row.COLUMN_NAME));
    this.columnCache.set(tableName, columns);
    return columns;
  }

  _safeJsonParse(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  _buildFilterConditions(filters, availableColumns, includeEmbedding) {
    const conditions = [];
    const params = [];

    if (includeEmbedding && availableColumns.has('embedding')) {
      conditions.push('embedding IS NOT NULL');
    }
    if (filters.fileCategory && availableColumns.has('file_category')) {
      conditions.push('file_category = ?');
      params.push(filters.fileCategory);
    }
    if (Array.isArray(filters.categories) && filters.categories.length > 0 && availableColumns.has('file_category')) {
      conditions.push(`file_category IN (${filters.categories.map(() => '?').join(',')})`);
      params.push(...filters.categories);
    }
    if (filters.moduleId && availableColumns.has('module_id')) {
      conditions.push('module_id = ?');
      params.push(filters.moduleId);
    }
    if (filters.libraryId && availableColumns.has('library_id')) {
      conditions.push('library_id = ?');
      params.push(filters.libraryId);
    }
    if (filters.chipVersionId && availableColumns.has('chip_version_id')) {
      conditions.push('(chip_version_id IS NULL OR chip_version_id = ?)');
      params.push(filters.chipVersionId);
    }

    return { conditions, params };
  }

  async search(queryText, topK = 5, filters = {}) {
    if (this.backend === 'chroma') {
      throw new Error('ChromaDB后端尚未实现');
    }

    const columns = await this._getExistingColumns('ai_material_chunks');
    if (!columns.has('embedding')) {
      return [];
    }

    const queryEmbedding = await this.generateEmbedding([queryText], { userId: filters.userId });
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return [];
    }

    const queryVec = queryEmbedding[0];
    const { conditions, params } = this._buildFilterConditions(filters, columns, true);
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const optionalColumns = ['file_category', 'metadata', 'chip_version_id'].filter(column => columns.has(column));
    const selectColumns = ['id', 'file_id', 'module_id', 'library_id', 'chunk_content', 'embedding', ...optionalColumns].join(', ');

    const [rows] = await pool.execute(
      `SELECT ${selectColumns} FROM ai_material_chunks ${whereClause}`,
      params
    );

    const results = [];
    for (const row of rows) {
      const embedding = this._safeJsonParse(row.embedding, null);
      if (!embedding) continue;

      const metadata = this._safeJsonParse(row.metadata, null);
      const similarity = dedupService.calculateCosineSimilarity(queryVec, embedding);
      results.push({
        id: row.id,
        fileId: row.file_id,
        moduleId: row.module_id,
        libraryId: row.library_id,
        chunkContent: row.chunk_content,
        fileCategory: row.file_category,
        chipVersionId: row.chip_version_id,
        metadata,
        similarity,
        score: similarity
      });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  async keywordSearch(queryText, topK = 5, filters = {}) {
    const columns = await this._getExistingColumns('ai_material_chunks');
    const { conditions, params } = this._buildFilterConditions(filters, columns, false);
    conditions.unshift('chunk_content LIKE ?');
    params.unshift(`%${queryText}%`);

    const optionalColumns = ['file_category', 'metadata', 'chip_version_id'].filter(column => columns.has(column));
    const selectColumns = ['id', 'file_id', 'module_id', 'library_id', 'chunk_content', ...optionalColumns].join(', ');
    const orderBy = columns.has('updated_at') ? 'updated_at DESC' : (columns.has('created_at') ? 'created_at DESC' : 'id DESC');

    const [rows] = await pool.execute(
      `SELECT ${selectColumns} FROM ai_material_chunks WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy} LIMIT ${Math.max(1, Math.min(topK, 50))}`,
      params
    );
    return rows.map(row => ({
      id: row.id,
      fileId: row.file_id,
      moduleId: row.module_id,
      libraryId: row.library_id,
      chunkContent: row.chunk_content,
      fileCategory: row.file_category,
      chipVersionId: row.chip_version_id,
      metadata: this._safeJsonParse(row.metadata, null),
      similarity: 0,
      score: 0.15
    }));
  }

  async hybridSearch(queryText, topK = 8, filters = {}) {
    const vectorResults = await this.search(queryText, topK, filters).catch(error => {
      logger.warn('向量检索失败，降级关键词检索', { error: error.message });
      return [];
    });
    const keywordResults = await this.keywordSearch(queryText, topK, filters).catch(() => []);
    const merged = new Map();
    for (const item of [...vectorResults, ...keywordResults]) {
      const existing = merged.get(item.id);
      if (!existing || (item.score || item.similarity || 0) > (existing.score || existing.similarity || 0)) {
        merged.set(item.id, item);
      }
    }
    return Array.from(merged.values())
      .sort((a, b) => (b.score || b.similarity || 0) - (a.score || a.similarity || 0))
      .slice(0, topK);
  }

  async _buildInsertPlan(chunks, fileId, moduleId, libraryId, fileCategory, options) {
    const columns = await this._getExistingColumns('ai_material_chunks');
    const insertColumns = ['file_id', 'module_id', 'library_id', 'chunk_index', 'chunk_content', 'token_count', 'char_count'];

    const needsEmbedding = columns.has('embedding') && chunks.some(chunk => !chunk.embedding);
    let generatedEmbeddings = null;
    if (needsEmbedding) {
      const texts = chunks.map(chunk => chunk.chunkContent || chunk.content || '');
      generatedEmbeddings = await this.generateEmbedding(texts, { userId: options.userId });
    }

    for (const column of ['embedding', 'file_category', 'chunking_strategy', 'metadata', 'chip_version_id']) {
      if (columns.has(column)) insertColumns.push(column);
    }

    const rows = chunks.map((chunk, index) => {
      const content = chunk.chunkContent || chunk.content || '';
      const row = {
        file_id: fileId,
        module_id: moduleId || null,
        library_id: libraryId || null,
        chunk_index: options.preserveChunkIndex ? (chunk.chunkIndex ?? index) : index,
        chunk_content: content,
        token_count: chunk.tokenCount || 0,
        char_count: chunk.charCount || content.length,
        embedding: chunk.embedding || generatedEmbeddings?.[index] || null,
        file_category: chunk.fileCategory || chunk.file_category || chunk.metadata?.category || fileCategory || null,
        chunking_strategy: chunk.chunkingStrategy || 'knowledge',
        metadata: chunk.metadata || null,
        chip_version_id: options.chipVersionId || chunk.chipVersionId || chunk.chip_version_id || null
      };
      return insertColumns.map(column => {
        if (column === 'embedding') return row.embedding ? JSON.stringify(row.embedding) : null;
        if (column === 'metadata') return row.metadata ? JSON.stringify(row.metadata) : null;
        return row[column];
      });
    });

    return { insertColumns, rows };
  }

  async upsertKnowledgeChunks(fileId, moduleId, libraryId, chunks, fileCategory, options = {}) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      if (!options.append) {
        await connection.execute('DELETE FROM ai_material_chunks WHERE file_id = ?', [fileId]);
      }

      if (chunks.length > 0) {
        const { insertColumns, rows } = await this._buildInsertPlan(chunks, fileId, moduleId, libraryId, fileCategory, options);
        const placeholders = rows.map(() => `(${insertColumns.map(() => '?').join(',')})`).join(',');
        const values = rows.flat();
        await connection.execute(
          `INSERT INTO ai_material_chunks (${insertColumns.join(', ')}) VALUES ${placeholders}`,
          values
        );
      }

      await connection.commit();

      logger.info('知识块写入完成', {
        fileId,
        moduleId,
        libraryId,
        fileCategory,
        chipVersionId: options.chipVersionId || null,
        chunkCount: chunks.length,
        append: !!options.append
      });

      return { fileId, chunkCount: chunks.length };
    } catch (error) {
      await connection.rollback();
      logger.error('知识块写入失败', { fileId, error: error.message });
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = new EmbeddingAdapter();
