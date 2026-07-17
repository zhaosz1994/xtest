const pool = require('../db');
const embeddingAdapter = require('./embeddingAdapter');
const { isAdmin } = require('../middleware');
const { safeJson, jsonValue, newId, parsePositiveInt } = require('./agentUtils');

function mapCard(row) {
  return {
    ...row,
    chip_versions: safeJson(row.chip_versions, []),
    submodules: safeJson(row.submodules, []),
    target_envs: safeJson(row.target_envs, []),
    trigger_conditions: safeJson(row.trigger_conditions, []),
    test_methods: safeJson(row.test_methods, []),
    related_test_points: safeJson(row.related_test_points, []),
    recommended_test_content: safeJson(row.recommended_test_content, []),
    evidence_refs: safeJson(row.evidence_refs, [])
  };
}

class BugLearningService {
  async createCard(user, data) {
    const bugId = data.bugId || data.bug_id || newId('BUG');
    if (!data.title) throw new Error('title不能为空');
    const moduleId = parsePositiveInt(data.moduleId || data.module_id);
    const [existing] = await pool.execute('SELECT * FROM bug_method_cards WHERE bug_id = ? LIMIT 1', [bugId]);
    if (existing.length > 0) {
      const card = existing[0];
      if (card.created_by !== user.id && !isAdmin(user)) throw new Error('无权修改该Bug方法卡片');
      if (card.status === 'approved' && !isAdmin(user)) throw new Error('已审核Bug方法卡片不能直接修改');
      await pool.execute(
        `UPDATE bug_method_cards
         SET title = ?, chip_versions = ?, module_id = ?, module = ?, submodules = ?, target_envs = ?, severity = ?,
             root_cause = ?, trigger_conditions = ?, test_methods = ?, related_test_points = ?,
             recommended_test_content = ?, coverage_gap_implication = ?, evidence_refs = ?,
             status = CASE WHEN status = 'approved' THEN 'draft' ELSE status END, updated_at = NOW()
         WHERE bug_id = ?`,
        [
          data.title,
          jsonValue(data.chipVersions || data.chip_versions || []),
          moduleId,
          data.module || null,
          jsonValue(data.submodules || []),
          jsonValue(data.targetEnvs || data.target_envs || []),
          data.severity || 'medium',
          data.rootCause || data.root_cause || null,
          jsonValue(data.triggerConditions || data.trigger_conditions || []),
          jsonValue(data.testMethods || data.test_methods || []),
          jsonValue(data.relatedTestPoints || data.related_test_points || []),
          jsonValue(data.recommendedTestContent || data.recommended_test_content || []),
          data.coverageGapImplication || data.coverage_gap_implication || null,
          jsonValue(data.evidenceRefs || data.evidence_refs || []),
          bugId
        ]
      );
    } else {
      await pool.execute(
        `INSERT INTO bug_method_cards
         (bug_id, title, chip_versions, module_id, module, submodules, target_envs, severity, root_cause,
          trigger_conditions, test_methods, related_test_points, recommended_test_content,
          coverage_gap_implication, evidence_refs, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bugId,
          data.title,
          jsonValue(data.chipVersions || data.chip_versions || []),
          moduleId,
          data.module || null,
          jsonValue(data.submodules || []),
          jsonValue(data.targetEnvs || data.target_envs || []),
          data.severity || 'medium',
          data.rootCause || data.root_cause || null,
          jsonValue(data.triggerConditions || data.trigger_conditions || []),
          jsonValue(data.testMethods || data.test_methods || []),
          jsonValue(data.relatedTestPoints || data.related_test_points || []),
          jsonValue(data.recommendedTestContent || data.recommended_test_content || []),
          data.coverageGapImplication || data.coverage_gap_implication || null,
          jsonValue(data.evidenceRefs || data.evidence_refs || []),
          'draft',
          user.id
        ]
      );
    }
    const [rows] = await pool.execute('SELECT * FROM bug_method_cards WHERE bug_id = ?', [bugId]);
    return mapCard(rows[0]);
  }

  async listCards(filters = {}) {
    const conditions = [];
    const params = [];
    if (filters.module) { conditions.push('module = ?'); params.push(filters.module); }
    if (filters.severity) { conditions.push('severity = ?'); params.push(filters.severity); }
    if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
    if (filters.keyword) {
      conditions.push('(title LIKE ? OR root_cause LIKE ? OR coverage_gap_implication LIKE ?)');
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`, `%${filters.keyword}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(parsePositiveInt(filters.limit, 50), 100));
    const [rows] = await pool.execute(`SELECT * FROM bug_method_cards ${where} ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low'), updated_at DESC LIMIT ${limit}`, params);
    return rows.map(mapCard);
  }

  async approve(user, bugId) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const [rows] = await pool.execute('SELECT * FROM bug_method_cards WHERE bug_id = ?', [bugId]);
    if (rows.length === 0) throw new Error('Bug卡片不存在');
    const card = mapCard(rows[0]);
    await this.indexCard(card);
    await pool.execute('UPDATE bug_method_cards SET status = \'approved\', reviewer_id = ?, reviewed_at = NOW() WHERE bug_id = ?', [user.id, bugId]);
    const [updated] = await pool.execute('SELECT * FROM bug_method_cards WHERE bug_id = ?', [bugId]);
    return mapCard(updated[0]);
  }

  async _ensureCardKnowledgeFile(card) {
    if (!card.module_id) return null;
    const fileName = `Bug方法卡片-${card.bug_id}.md`;
    const [existing] = await pool.execute(
      `SELECT id FROM module_knowledge_files
       WHERE module_id = ? AND name = ? AND type = 'file' AND deleted_at IS NULL
       LIMIT 1`,
      [card.module_id, fileName]
    );
    if (existing.length > 0) return existing[0].id;
    const [result] = await pool.execute(
      `INSERT INTO module_knowledge_files
       (module_id, parent_id, name, type, file_path, file_size, file_ext, mime_type, parse_status, created_by, file_category)
       VALUES (?, NULL, ?, 'file', NULL, 0, 'md', 'text/markdown', 'parsed', ?, 'bug_method_card')`,
      [card.module_id, fileName, String(card.created_by || '')]
    );
    return result.insertId;
  }

  async indexCard(card) {
    const contentBlocks = [
      { type: 'bug_module_index', content: `模块: ${card.module || '-'}\n子模块: ${card.submodules.join(', ')}\n根因: ${card.root_cause || '-'}\n触发: ${card.trigger_conditions.join('; ')}` },
      { type: 'bug_method_index', content: `测试方法: ${card.test_methods.join(', ')}\n触发条件: ${card.trigger_conditions.join('; ')}\n修复模式: ${card.root_cause || '-'}` },
      { type: 'bug_testpoint_index', content: `相关测试点: ${card.related_test_points.join(', ')}\n缺口影响: ${card.coverage_gap_implication || '-'}` },
      { type: 'bug_content_index', content: `推荐测试内容: ${card.recommended_test_content.join('; ')}\n证据: ${card.evidence_refs.join('; ')}` }
    ];
    const chunks = contentBlocks.map((block, index) => ({
      chunkContent: `Bug卡片 ${card.bug_id} - ${card.title}\n${block.content}`,
      tokenCount: 0,
      charCount: block.content.length,
      chunkingStrategy: 'bug_learning',
      fileCategory: block.type,
      metadata: { bugId: card.bug_id, category: block.type, severity: card.severity, module: card.module },
      chunkIndex: index
    }));
    const fileId = await this._ensureCardKnowledgeFile(card);
    if (!fileId) {
      return { skipped: true, reason: 'MODULE_ID_REQUIRED_FOR_CHUNK_INDEX' };
    }
    return embeddingAdapter.upsertKnowledgeChunks(fileId, card.module_id, null, chunks, 'bug_method_card', { userId: card.created_by });
  }

  async retrieve(query = {}) {
    const moduleText = [query.module, query.testMethod || query.test_method, query.testPoint || query.test_point, query.testContent || query.test_content].filter(Boolean).join(' ');
    const categories = ['bug_module_index', 'bug_method_index', 'bug_testpoint_index', 'bug_content_index', 'bug_method_card', 'bug_rag'];
    const results = await embeddingAdapter.hybridSearch(moduleText || query.keyword || '', 16, { categories });
    return results;
  }

  async generateGapReport(user, data = {}) {
    const moduleName = data.module;
    if (!moduleName) throw new Error('module不能为空');
    const cards = await this.listCards({ module: moduleName, status: 'approved', limit: 100 });
    const required = new Set();
    const actions = [];
    for (const card of cards) {
      for (const point of card.related_test_points) required.add(point);
      for (const content of card.recommended_test_content) actions.push(content);
    }
    const existing = new Set(data.existingTestPoints || data.existing_test_points || []);
    const missing = Array.from(required).filter(point => !existing.has(point));
    const reportId = newId('GAP');
    await pool.execute(
      `INSERT INTO bug_test_gap_reports
       (report_id, module, chip_version, existing_test_points, bug_derived_required_points,
        missing_test_points, recommended_actions, risk_summary, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        reportId,
        moduleName,
        data.chipVersion || data.chip_version || null,
        jsonValue(Array.from(existing)),
        jsonValue(Array.from(required)),
        jsonValue(missing),
        jsonValue(actions),
        `基于 ${cards.length} 张已审核Bug方法卡片，发现 ${missing.length} 个缺失测试点。`,
        user.id
      ]
    );
    return this.getGapReport(reportId);
  }

  async getGapReport(reportId) {
    const [rows] = await pool.execute('SELECT * FROM bug_test_gap_reports WHERE report_id = ?', [reportId]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      ...row,
      existing_test_points: safeJson(row.existing_test_points, []),
      bug_derived_required_points: safeJson(row.bug_derived_required_points, []),
      missing_test_points: safeJson(row.missing_test_points, []),
      recommended_actions: safeJson(row.recommended_actions, [])
    };
  }

  async listGapReports(filters = {}) {
    const conditions = [];
    const params = [];
    if (filters.module) { conditions.push('module = ?'); params.push(filters.module); }
    if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(`SELECT * FROM bug_test_gap_reports ${where} ORDER BY created_at DESC LIMIT 50`, params);
    return Promise.all(rows.map(row => this.getGapReport(row.report_id)));
  }
}

module.exports = new BugLearningService();
