/**
 * Diagram Upload Routes — Part 1: Diagram Knowledge Layer
 * 上传/列表/详情/审核/删除 图形资产
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authenticateToken, requireAdmin } = require('../middleware');
const diagramParserService = require('../services/diagramParserService');
const pool = require('../db');
const { newId } = require('../services/agentUtils');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const dir = path.join(UPLOAD_DIR, 'diagrams');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const exts = ['.drawio', '.vsdx', '.svg', '.png', '.jpg', '.jpeg', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (exts.includes(ext)) cb(null, true);
    else cb(new Error('不支持的文件类型: ' + ext));
  }
});

router.use(authenticateToken);

// 上传并自动解析
router.post('/upload', upload.single('file'), async function(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '未收到文件' });
    const { moduleId, libraryId, chipVersionId } = req.body;
    const diagramId = newId('DIAG');
    const filePath = req.file.path;
    const fileType = path.extname(req.file.originalname).slice(1).toLowerCase();
    await pool.execute(
      'INSERT INTO diagram_asset (diagram_id, module_id, library_id, chip_version_id, source_file_path, source_file_type, parse_status, created_by) VALUES (?,?,?,?,?,?,"pending",?)',
      [diagramId, moduleId || null, libraryId || null, chipVersionId || null, filePath, fileType, req.user.id]
    );
    await pool.execute('UPDATE diagram_asset SET parse_status = "parsing" WHERE diagram_id = ?', [diagramId]);
    const parseResult = await diagramParserService.autoParse(filePath, fileType);
    if (parseResult.status === 'ok') {
      await diagramParserService.persistDiagramIr(diagramId, parseResult, moduleId, req.user.id);
      return res.json({
        success: true,
        diagram_id: diagramId,
        phase: 'Auto_Parse_Completed',
        parse_type: parseResult.source_type,
        pages: parseResult.pages.map(function(p) {
          return { page_name: p.page_name, node_count: p.nodes.length, edge_count: p.edges.length, markdown_topology: (p.markdown_topology || '').substring(0, 500) };
        }),
        extracted_keywords: parseResult.extracted_keywords || [],
        requires_human_review: true,
        review_reason: 'IMAGE_TOPOLOGY_NEEDS_HUMAN_CONFIRMATION'
      });
    } else {
      await pool.execute('UPDATE diagram_asset SET parse_status = "parse_failed", parse_error = ? WHERE diagram_id = ?', [JSON.stringify(parseResult), diagramId]);
      return res.status(500).json({ success: false, diagram_id: diagramId, phase: 'Parse_Failed', reason: parseResult.reason || parseResult.status, message: parseResult.message });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 获取详情 (含 nodes/edges/reviews)
router.get('/:diagramId', async function(req, res) {
  try {
    const [assets] = await pool.execute('SELECT * FROM diagram_asset WHERE diagram_id = ? AND deleted_at IS NULL', [req.params.diagramId]);
    if (assets.length === 0) return res.status(404).json({ success: false, message: '图形资产不存在' });
    const [nodes] = await pool.execute('SELECT * FROM diagram_node WHERE diagram_id = ? ORDER BY page_index, id', [req.params.diagramId]);
    const [edges] = await pool.execute('SELECT * FROM diagram_edge WHERE diagram_id = ? ORDER BY page_index, id', [req.params.diagramId]);
    const [reviews] = await pool.execute('SELECT * FROM diagram_review WHERE diagram_id = ? ORDER BY review_round DESC', [req.params.diagramId]);
    res.json({ success: true, data: Object.assign({}, assets[0], { nodes: nodes, edges: edges, reviews: reviews }) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 列表
router.get('/', async function(req, res) {
  try {
    const conditions = ['deleted_at IS NULL'];
    const params = [];
    if (req.query.moduleId) { conditions.push('module_id = ?'); params.push(req.query.moduleId); }
    if (req.query.parseStatus) { conditions.push('parse_status = ?'); params.push(req.query.parseStatus); }
    const [rows] = await pool.execute('SELECT * FROM diagram_asset WHERE ' + conditions.join(' AND ') + ' ORDER BY created_at DESC LIMIT 100', params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 提交人工审核 (含 humanSummary 必填)
router.post('/:diagramId/review', async function(req, res) {
  try {
    const { humanSummary, decision, reviewerNotes } = req.body;
    if (!humanSummary || !humanSummary.trim()) return res.status(400).json({ success: false, message: 'humanSummary不能为空' });
    const [assets] = await pool.execute('SELECT * FROM diagram_asset WHERE diagram_id = ? AND deleted_at IS NULL', [req.params.diagramId]);
    if (assets.length === 0) return res.status(404).json({ success: false, message: '图形资产不存在' });
    const asset = assets[0];
    const [lastReview] = await pool.execute('SELECT MAX(review_round) as max_round FROM diagram_review WHERE diagram_id = ?', [req.params.diagramId]);
    const nextRound = (lastReview[0] && lastReview[0].max_round || 0) + 1;
    await pool.execute(
      'INSERT INTO diagram_review (diagram_id, reviewer_id, review_round, decision, reviewer_summary, reviewer_notes, previous_human_summary) VALUES (?,?,?,?,?,?,?)',
      [req.params.diagramId, req.user.id, nextRound, decision || 'changes_requested', humanSummary, reviewerNotes || null, asset.human_summary]
    );
    await pool.execute(
      'UPDATE diagram_asset SET human_summary = ?, reviewer_id = ?, reviewed_at = NOW(), parse_status = CASE WHEN ? = "approved" THEN "reviewed" ELSE parse_status END WHERE diagram_id = ?',
      [humanSummary, req.user.id, decision || 'changes_requested', req.params.diagramId]
    );
    if (decision === 'approved') {
      const [updated] = await pool.execute('SELECT * FROM diagram_asset WHERE diagram_id = ?', [req.params.diagramId]);
      await diagramParserService.publishToVectorIndex(updated[0]);
    }
    res.json({ success: true, data: { diagram_id: req.params.diagramId, decision: decision || 'changes_requested', published: decision === 'approved' } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 删除 (软删除)
router.delete('/:diagramId', requireAdmin, async function(req, res) {
  try {
    await pool.execute('UPDATE diagram_asset SET deleted_at = NOW() WHERE diagram_id = ?', [req.params.diagramId]);
    res.json({ success: true, message: '已软删除' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
