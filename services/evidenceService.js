const pool = require('../db');

function normalizeTargetId(targetId) {
  if (targetId === null || targetId === undefined || targetId === '') {
    throw new Error('缺少证据目标ID');
  }
  return String(targetId);
}

class EvidenceService {
  async createLink(data) {
    const targetType = String(data.targetType || data.target_type || '').trim();
    const targetId = normalizeTargetId(data.targetId || data.target_id);
    const evidenceType = String(data.evidenceType || data.evidence_type || '').trim();
    if (!targetType || !evidenceType) {
      throw new Error('缺少证据目标类型或证据类型');
    }

    const [result] = await pool.execute(
      `INSERT INTO evidence_links
        (target_type, target_id, evidence_type, evidence_table, evidence_id, evidence_title,
         evidence_excerpt, confidence, metadata, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetType,
        targetId,
        evidenceType,
        data.evidenceTable || data.evidence_table || null,
        data.evidenceId || data.evidence_id ? String(data.evidenceId || data.evidence_id) : null,
        data.evidenceTitle || data.evidence_title || null,
        data.evidenceExcerpt || data.evidence_excerpt || null,
        data.confidence === undefined ? null : Number(data.confidence),
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.createdBy || data.created_by || null
      ]
    );
    return { id: result.insertId };
  }

  async createLinks(links = []) {
    const created = [];
    for (const link of links) {
      created.push(await this.createLink(link));
    }
    return created;
  }

  async getEvidenceForTarget(targetType, targetId, options = {}) {
    const limit = Math.max(1, Math.min(parseInt(options.limit, 10) || 50, 200));
    const conditions = ['target_type = ?', 'target_id = ?'];
    const params = [String(targetType), normalizeTargetId(targetId)];
    if (options.createdBy) {
      conditions.push('created_by = ?');
      params.push(options.createdBy);
    }
    const [rows] = await pool.execute(
      `SELECT * FROM evidence_links
       WHERE ${conditions.join(' AND ')}
       ORDER BY confidence DESC, created_at DESC
       LIMIT ${limit}`,
      params
    );
    return rows;
  }

  async getEvidenceSummary(targetType, targetId, options = {}) {
    const evidence = await this.getEvidenceForTarget(targetType, targetId, { ...options, limit: 100 });
    const byType = evidence.reduce((acc, item) => {
      acc[item.evidence_type] = (acc[item.evidence_type] || 0) + 1;
      return acc;
    }, {});
    return {
      targetType,
      targetId: String(targetId),
      total: evidence.length,
      byType,
      topEvidence: evidence.slice(0, 10)
    };
  }
}

module.exports = new EvidenceService();
