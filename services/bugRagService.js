const pool = require('../db');
const embeddingAdapter = require('./embeddingAdapter');

function toNullableInt(value) {
  if (value === null || value === undefined || value === '' || value === 'null') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

class BugRagService {
  async list(options = {}) {
    const conditions = [];
    const params = [];
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    const chipVersionId = toNullableInt(options.chipVersionId || options.chip_version_id);
    if (chipVersionId) {
      conditions.push('(chip_version_id IS NULL OR chip_version_id = ?)');
      params.push(chipVersionId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(parseInt(options.limit, 10) || 50, 200));
    const [rows] = await pool.execute(
      `SELECT * FROM bug_rag_entries ${where} ORDER BY created_at DESC LIMIT ${limit}`,
      params
    );
    return rows;
  }

  async createCandidate(data) {
    const title = String(data.title || '').trim();
    if (!title) throw new Error('缺少Bug-RAG标题');
    const [result] = await pool.execute(
      `INSERT INTO bug_rag_entries
        (chip_version_id, module_id, library_id, title, symptom, root_cause, fix_suggestion,
         status, source_type, source_ref, created_by, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?)`,
      [
        toNullableInt(data.chipVersionId || data.chip_version_id),
        toNullableInt(data.moduleId || data.module_id),
        toNullableInt(data.libraryId || data.library_id),
        title,
        data.symptom || null,
        data.rootCause || data.root_cause || null,
        data.fixSuggestion || data.fix_suggestion || null,
        data.sourceType || data.source_type || null,
        data.sourceRef || data.source_ref || null,
        toNullableInt(data.createdBy || data.created_by),
        data.metadata ? JSON.stringify(data.metadata) : null
      ]
    );
    return { id: result.insertId };
  }

  async approve(id, reviewerId = null) {
    const entryId = toNullableInt(id);
    if (!entryId) throw new Error('无效Bug-RAG ID');
    await pool.execute(
      `UPDATE bug_rag_entries SET status = 'approved', reviewer_id = ?, reviewed_at = NOW() WHERE id = ?`,
      [toNullableInt(reviewerId), entryId]
    );
    const [rows] = await pool.execute('SELECT * FROM bug_rag_entries WHERE id = ?', [entryId]);
    const entry = rows[0] || null;
    if (entry) {
      await this.writeApprovedChunk(entry);
    }
    return { id: entryId, status: 'approved' };
  }

  async reject(id, reviewerId = null) {
    const entryId = toNullableInt(id);
    if (!entryId) throw new Error('无效Bug-RAG ID');
    await pool.execute(
      `UPDATE bug_rag_entries SET status = 'rejected', reviewer_id = ?, reviewed_at = NOW() WHERE id = ?`,
      [toNullableInt(reviewerId), entryId]
    );
    return { id: entryId, status: 'rejected' };
  }

  async searchApproved(queryText, options = {}) {
    const keyword = String(queryText || '').trim();
    if (!keyword) return [];

    const conditions = ['status = ?'];
    const params = ['approved'];
    const chipVersionId = toNullableInt(options.chipVersionId || options.chip_version_id);
    if (chipVersionId) {
      conditions.push('(chip_version_id IS NULL OR chip_version_id = ?)');
      params.push(chipVersionId);
    }
    conditions.push('(title LIKE ? OR symptom LIKE ? OR root_cause LIKE ? OR fix_suggestion LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like, like);
    const limit = Math.max(1, Math.min(parseInt(options.limit, 10) || 20, 100));

    const [rows] = await pool.execute(
      `SELECT * FROM bug_rag_entries WHERE ${conditions.join(' AND ')} ORDER BY reviewed_at DESC, created_at DESC LIMIT ${limit}`,
      params
    );
    return rows.map(row => ({ ...row, similarity: row.similarity || 0 }));
  }

  async writeApprovedChunk(entry) {
    if (!entry || entry.status !== 'approved') return null;
    const content = `Bug-RAG: ${entry.title}\n症状: ${entry.symptom || '-'}\n根因: ${entry.root_cause || '-'}\n建议: ${entry.fix_suggestion || '-'}`;
    const virtualFileId = 900000000 + Number(entry.id);
    return embeddingAdapter.upsertKnowledgeChunks(
      virtualFileId,
      entry.module_id,
      entry.library_id,
      [{ chunkContent: content, tokenCount: 0, charCount: content.length, chunkingStrategy: 'knowledge', metadata: { category: 'bug_rag', bugRagId: entry.id } }],
      'bug_rag',
      { chipVersionId: entry.chip_version_id }
    );
  }
}

module.exports = new BugRagService();
