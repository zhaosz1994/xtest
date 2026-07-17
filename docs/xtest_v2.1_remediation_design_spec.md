# xTest V2.1 增强功能详细设计 — 补救开发规格书

> **用途**: 直接交给 TRAE IDE + GLM-5.2 逐模块实现
> **项目路径**: `/Users/zhao/Desktop/my_projects/xtest`
> **技术栈**: Node.js + Express + MySQL + 前端原生JS(非Vue/React)
> **日期**: 2026-07-06

---

## Part 1: Diagram Knowledge Layer (P0)

### 1.1 数据库 Migration

文件 `migrations/20260710_diagram_knowledge_layer.sql`:

```sql
CREATE TABLE IF NOT EXISTS `diagram_asset` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `diagram_id` VARCHAR(128) NOT NULL COMMENT '唯一标识 DIAG-xxx',
  `module_id` INT DEFAULT NULL,
  `library_id` INT DEFAULT NULL,
  `chip_version_id` INT DEFAULT NULL,
  `source_file_id` INT DEFAULT NULL COMMENT '关联 module_knowledge_files.id',
  `source_file_path` VARCHAR(512) NOT NULL,
  `source_file_type` ENUM('drawio','vsdx','svg','png','jpg','jpeg','pdf_figure') NOT NULL,
  `diagram_type` ENUM('state_machine','data_path','control_path','block_diagram','pipeline','topology','timing','other') DEFAULT 'other',
  `diagram_name` VARCHAR(256) DEFAULT NULL,
  `page_count` INT DEFAULT 1,
  `parse_status` ENUM('pending','parsing','parsed','parse_failed','reviewed','published') DEFAULT 'pending',
  `parse_error` TEXT DEFAULT NULL,
  `auto_extracted_metadata` JSON DEFAULT NULL,
  `human_summary` TEXT DEFAULT NULL COMMENT 'Module Owner人工总结(必填)',
  `reviewer_id` INT DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `published_at` DATETIME DEFAULT NULL,
  `rendered_preview_path` VARCHAR(512) DEFAULT NULL,
  `created_by` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_diagram_id` (`diagram_id`),
  KEY `idx_module_id` (`module_id`),
  KEY `idx_parse_status` (`parse_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `diagram_node` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `diagram_id` VARCHAR(128) NOT NULL,
  `page_index` INT DEFAULT 0,
  `node_id` VARCHAR(128) NOT NULL COMMENT '原图节点ID',
  `text` TEXT NOT NULL,
  `semantic_type` ENUM('state','action','condition','register','counter','queue','module','port','decision','node','unknown') DEFAULT 'node',
  `bbox` JSON DEFAULT NULL,
  `style` VARCHAR(256) DEFAULT NULL,
  `confidence` DECIMAL(4,2) DEFAULT 1.00,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_diagram_id` (`diagram_id`),
  KEY `idx_semantic_type` (`semantic_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `diagram_edge` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `diagram_id` VARCHAR(128) NOT NULL,
  `page_index` INT DEFAULT 0,
  `edge_id` VARCHAR(128) NOT NULL,
  `source_node_id` VARCHAR(128) DEFAULT NULL,
  `source_text` TEXT DEFAULT NULL,
  `target_node_id` VARCHAR(128) DEFAULT NULL,
  `target_text` TEXT DEFAULT NULL,
  `label` TEXT DEFAULT NULL,
  `semantic_type` ENUM('transition','timeout','drop','error','enable','disable','config','trigger','data_flow','control_flow','unknown') DEFAULT 'transition',
  `confidence` DECIMAL(4,2) DEFAULT 1.00,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_diagram_id` (`diagram_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `diagram_review` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `diagram_id` VARCHAR(128) NOT NULL,
  `reviewer_id` INT NOT NULL,
  `review_round` INT DEFAULT 1,
  `decision` ENUM('approved','rejected','changes_requested') NOT NULL,
  `reviewer_summary` TEXT,
  `reviewer_notes` TEXT,
  `previous_human_summary` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_diagram_id` (`diagram_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 1.2 后端服务 diagramParserService.js

文件 `services/diagramParserService.js`:

核心函数清单(完整实现见下方代码):

- `parseDrawio(filePath)` — XML解析mxGraphModel,提取nodes/edges
- `parseVsdx(filePath)` — ZIP解压+Visio XML解析
- `parseSvg(filePath)` — SVG DOM解析
- `parseImageViaOcr(filePath)` — 调用PaddleOCR微服务
- `autoParse(filePath, fileType)` — 统一入口,按文件类型分发
- `persistDiagramIr(diagramId, parseResult)` — 写入DB
- `publishToVectorIndex(diagramAsset)` — 审核通过后发布到向量库

```javascript
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const unzipper = require('unzipper');
const pool = require('../db');
const { newId } = require('./agentUtils');
const embeddingAdapter = require('./embeddingAdapter');
const logger = require('./logger');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  trimValues: true
});

// === 工具函数 ===

function ensureArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function decodeDrawioText(text) {
  if (!text) return '';
  return String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferNodeType(text, style) {
  style = style || '';
  if (/IDLE|WAIT|DROP|RECOVER|ERROR|DONE|ACTIVE|ENABLED|DISABLED/i.test(text)) return 'state';
  if (/TIMER|THRESH|COUNTER|REG|STATUS|REGISTER/i.test(text)) return 'register';
  if (/QUEUE|MMU|PFC|ACL|PARSER|SCHEDULER|VOQ|EGRESS|INGRESS/i.test(text)) return 'module';
  if (/rhombus|decision/i.test(style)) return 'decision';
  if (/port|interface|lane/i.test(text)) return 'port';
  return 'node';
}

function inferEdgeType(label) {
  if (/timeout|timer|expired/i.test(label)) return 'timeout';
  if (/drop|error|invalid|fail/i.test(label)) return 'drop';
  if (/enable|config|cli|set/i.test(label)) return 'enable';
  if (/disable|clear|reset/i.test(label)) return 'disable';
  if (/trigger|start|begin/i.test(label)) return 'trigger';
  return 'transition';
}

function inferDiagramType(nodes, edges) {
  const stateNodes = nodes.filter(function(n) { return n.semantic_type === 'state'; }).length;
  const decisionNodes = nodes.filter(function(n) { return n.semantic_type === 'decision'; }).length;
  const moduleNodes = nodes.filter(function(n) { return n.semantic_type === 'module'; }).length;
  if (stateNodes >= 2 && edges.length >= 1) return 'state_machine';
  if (moduleNodes >= 3) return 'block_diagram';
  if (decisionNodes >= 2) return 'pipeline';
  return 'other';
}

function diagramIrToMarkdown(nodes, edges) {
  let md = '### 拓扑自动提取\n\n| Source | Label | Target |\n| :--- | :--- | :--- |\n';
  for (const e of edges) {
    md += '| `' + (e.source_text || e.source_node_id || '-').substring(0, 50) + '` | ' + (e.label || '→').substring(0, 80) + ' | `' + (e.target_text || e.target_node_id || '-').substring(0, 50) + '` |\n';
  }
  if (!edges.length) md += '| - | 未识别到连线，需要Module Owner补充 | - |\n';
  if (nodes.length) {
    md += '\n**识别到的节点：**\n';
    for (const n of nodes) md += '- [' + n.semantic_type + '] ' + n.text.substring(0, 100) + '\n';
  }
  return md;
}

// === DrawIO解析 ===

function parseDrawio(filePath) {
  const xmlData = fs.readFileSync(filePath, 'utf-8');
  const jsonObj = xmlParser.parse(xmlData);
  const diagrams = ensureArray(jsonObj.mxfile ? jsonObj.mxfile.diagram : jsonObj.diagram);
  const pages = [];
  for (const diagram of diagrams) {
    const graph = diagram.mxGraphModel || jsonObj.mxGraphModel || {};
    const cells = ensureArray(graph.root ? graph.root.mxCell : []);
    const nodeMap = new Map();
    const nodes = [];
    const edges = [];
    for (const cell of cells) {
      const id = String(cell.id || '');
      const value = decodeDrawioText(cell.value || '');
      const isEdge = cell.edge === '1' || cell.edge === true;
      const isVertex = cell.vertex === '1' || cell.vertex === true;
      const geo = cell.mxGeometry || {};
      if (isVertex && value) {
        const semanticType = inferNodeType(value, cell.style || '');
        const node = { id: id, text: value, semantic_type: semanticType, bbox: { x: Number(geo.x || 0), y: Number(geo.y || 0), width: Number(geo.width || 0), height: Number(geo.height || 0) }, style: cell.style || '', confidence: 0.98 };
        nodeMap.set(id, node);
        nodes.push(node);
      }
    }
    for (const cell of cells) {
      if (cell.edge === '1' || cell.edge === true) {
        const label = decodeDrawioText(cell.value || '');
        const sourceId = cell.source || '';
        const targetId = cell.target || '';
        edges.push({ id: String(cell.id || 'edge_' + edges.length), source_node_id: sourceId, source_text: (nodeMap.get(sourceId) || {}).text || '', target_node_id: targetId, target_text: (nodeMap.get(targetId) || {}).text || '', label: label, semantic_type: inferEdgeType(label), confidence: 0.95 });
      }
    }
    pages.push({ page_name: diagram.name || 'Page', nodes: nodes, edges: edges, markdown_topology: diagramIrToMarkdown(nodes, edges) });
  }
  return { status: 'ok', source_file: filePath, source_type: 'drawio', pages: pages };
}

// === VSDX解析 ===

async function parseVsdx(filePath, extractDir) {
  const extractPath = extractDir || filePath + '_extracted';
  await fs.promises.mkdir(extractPath, { recursive: true });
  await new Promise(function(resolve, reject) {
    fs.createReadStream(filePath).pipe(unzipper.Extract({ path: extractPath })).on('close', resolve).on('error', reject);
  });
  const pagesDir = path.join(extractPath, 'visio', 'pages');
  if (!fs.existsSync(pagesDir)) return { status: 'failed', reason: 'VSDX_PAGES_DIR_NOT_FOUND', pages: [] };
  const pageFiles = fs.readdirSync(pagesDir).filter(function(f) { return f.endsWith('.xml'); });
  const pages = [];
  for (const pageFile of pageFiles) {
    const pageXml = fs.readFileSync(path.join(pagesDir, pageFile), 'utf-8');
    const pageJson = xmlParser.parse(pageXml);
    const shapes = ensureArray(pageJson.PageContents ? pageJson.PageContents.Shapes ? pageJson.PageContents.Shapes.Shape : [] : []);
    const connects = ensureArray(pageJson.PageContents ? pageJson.PageContents.Connects ? pageJson.PageContents.Connects.Connect : [] : []);
    const nodeMap = new Map();
    const nodes = [];
    for (const shape of shapes) {
      const id = String(shape.ID || shape.id || '');
      const text = decodeDrawioText(shape.Text || '');
      if (!id || !text) continue;
      const node = { id: id, text: text, semantic_type: inferNodeType(text, shape.Master || ''), bbox: [], style: shape.Master || '', confidence: 0.85 };
      nodeMap.set(id, node);
      nodes.push(node);
    }
    const edges = connects.map(function(c, idx) {
      return { id: 'connect_' + idx, source_node_id: String(c.FromSheet || ''), source_text: (nodeMap.get(String(c.FromSheet || '')) || {}).text || '', target_node_id: String(c.ToSheet || ''), target_text: (nodeMap.get(String(c.ToSheet || '')) || {}).text || '', label: '', semantic_type: 'transition', confidence: 0.75 };
    });
    pages.push({ page_name: pageFile, nodes: nodes, edges: edges, markdown_topology: diagramIrToMarkdown(nodes, edges) });
  }
  return { status: 'ok', source_file: filePath, source_type: 'vsdx', pages: pages };
}

// === SVG解析 ===

function parseSvg(filePath) {
  const xmlData = fs.readFileSync(filePath, 'utf-8');
  const jsonObj = xmlParser.parse(xmlData);
  const texts = ensureArray(jsonObj.svg ? jsonObj.svg.text : jsonObj.text);
  const nodes = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const content = typeof t === 'string' ? t : (t['#text'] || t.text || '');
    const decoded = decodeDrawioText(content);
    if (decoded) nodes.push({ id: 'svg_text_' + i, text: decoded, semantic_type: inferNodeType(decoded, ''), bbox: [], style: '', confidence: 0.70 });
  }
  return { status: 'ok', source_file: filePath, source_type: 'svg', pages: [{ page_name: 'SVG', nodes: nodes, edges: [], markdown_topology: diagramIrToMarkdown(nodes, []) }] };
}

// === OCR微服务调用 ===

async function parseImageViaOcr(filePath, ocrEndpoint) {
  const FormData = require('form-data');
  const axios = require('axios');
  const endpoint = ocrEndpoint || process.env.OCR_ENDPOINT || 'http://127.0.0.1:8866';
  const form = new FormData();
  form.append('images', fs.createReadStream(filePath));
  try {
    const response = await axios.post(endpoint + '/predict/ocr_system', form, { headers: form.getHeaders(), timeout: 60000 });
    const rawResults = response.data.results || [];
    const rawTexts = rawResults.map(function(r) { return typeof r === 'string' ? r : (r.text || ''); });
    const keywords = extractHardwareKeywords(rawTexts);
    return {
      status: 'ok', source_file: filePath, source_type: 'image_ocr', raw_text_dump: rawTexts.join('\n'), extracted_keywords: keywords,
      pages: [{ page_name: 'OCR', nodes: keywords.map(function(kw, i) { return { id: 'ocr_kw_' + i, text: kw, semantic_type: inferNodeType(kw, ''), bbox: [], style: '', confidence: 0.60 }; }), edges: [], markdown_topology: '> OCR仅提取关键词，拓扑需人工补充\n\n**关键词：**\n' + keywords.map(function(k) { return '- `' + k + '`'; }).join('\n') }]
    };
  } catch (error) {
    logger.error('OCR调用失败', { error: error.message, endpoint: endpoint });
    return { status: 'failed', reason: 'OCR_SERVICE_UNAVAILABLE', message: error.message, pages: [] };
  }
}

function extractHardwareKeywords(rawTexts) {
  const keywordRegex = /[A-Z][A-Z0-9_]{3,}/g;
  const allText = Array.isArray(rawTexts) ? rawTexts.join(' ') : String(rawTexts);
  return Array.from(new Set((allText.match(keywordRegex) || []).filter(function(k) { return k.length >= 4; })));
}

// === PDF图形 ===

async function parsePdfFigure(filePath) {
  const { exec } = require('child_process');
  const tmpDir = filePath + '_pages';
  await fs.promises.mkdir(tmpDir, { recursive: true });
  return new Promise(function(resolve) {
    exec('pdftoppm -png -r 200 "' + filePath + '" "' + tmpDir + '/page"', async function(error) {
      if (error) { resolve({ status: 'failed', reason: 'PDF_TO_PNG_FAILED', message: error.message }); return; }
      const files = (await fs.promises.readdir(tmpDir)).filter(function(f) { return f.endsWith('.png'); });
      const pages = [];
      for (const file of files) {
        const result = await parseImageViaOcr(path.join(tmpDir, file));
        if (result.status === 'ok' && result.pages.length) pages.push(result.pages[0]);
      }
      resolve({ status: 'ok', source_file: filePath, source_type: 'pdf_figure', pages: pages });
    });
  });
}

// === 统一入口 ===

async function autoParse(filePath, fileType) {
  const ext = (fileType || path.extname(filePath).slice(1).toLowerCase()).replace('.', '');
  if (ext === 'drawio') return parseDrawio(filePath);
  if (ext === 'vsdx') return await parseVsdx(filePath);
  if (ext === 'svg') return parseSvg(filePath);
  if (['png', 'jpg', 'jpeg'].includes(ext)) return await parseImageViaOcr(filePath);
  if (ext === 'pdf') return await parsePdfFigure(filePath);
  return { status: 'failed', reason: 'UNSUPPORTED_FILE_TYPE', ext: ext };
}

// === 持久化 ===

async function persistDiagramIr(diagramId, parseResult, moduleId, createdBy) {
  for (const page of parseResult.pages) {
    for (const node of page.nodes) {
      await pool.execute('INSERT INTO diagram_node (diagram_id, page_index, node_id, text, semantic_type, bbox, style, confidence) VALUES (?,?,?,?,?,?,?,?)', [diagramId, page.page_index || 0, node.id, node.text, node.semantic_type, JSON.stringify(node.bbox || {}), node.style || '', node.confidence || 1.0]);
    }
    for (const edge of page.edges) {
      await pool.execute('INSERT INTO diagram_edge (diagram_id, page_index, edge_id, source_node_id, source_text, target_node_id, target_text, label, semantic_type, confidence) VALUES (?,?,?,?,?,?,?,?,?,?)', [diagramId, page.page_index || 0, edge.id, edge.source_node_id || '', edge.source_text || '', edge.target_node_id || '', edge.target_text || '', edge.label || '', edge.semantic_type, edge.confidence || 1.0]);
    }
  }
  const firstPage = parseResult.pages[0];
  const diagramType = inferDiagramType(firstPage ? firstPage.nodes : [], firstPage ? firstPage.edges : []);
  await pool.execute('UPDATE diagram_asset SET parse_status = "parsed", diagram_type = ?, auto_extracted_metadata = ? WHERE diagram_id = ?', [diagramType, JSON.stringify({ keywords: parseResult.extracted_keywords || [], raw_text: (parseResult.raw_text_dump || '').substring(0, 5000) }), diagramId]);
}

// === 发布到向量库 ===

async function publishToVectorIndex(diagramAsset) {
  if (!diagramAsset.human_summary) throw new Error('缺少Module Owner人工总结，不能发布');
  const chunkText = '【Module Owner 总结】：' + diagramAsset.human_summary + '\n\n【自动提取拓扑】：\n' + (diagramAsset.auto_extracted_metadata ? diagramAsset.auto_extracted_metadata.markdown_topology || '' : '');
  if (diagramAsset.module_id) {
    const chunks = [{ chunkContent: chunkText, tokenCount: 0, charCount: chunkText.length, chunkingStrategy: 'diagram_knowledge', fileCategory: 'diagram_knowledge_card', metadata: { diagramId: diagramAsset.diagram_id, diagramType: diagramAsset.diagram_type, sourceFileType: diagramAsset.source_file_type }, chunkIndex: 0 }];
    const [existing] = await pool.execute('SELECT id FROM module_knowledge_files WHERE name = ? AND module_id = ? AND type = "file" AND deleted_at IS NULL LIMIT 1', ['Diagram-' + diagramAsset.diagram_id + '.md', diagramAsset.module_id]);
    let fileId;
    if (existing.length > 0) {
      fileId = existing[0].id;
    } else {
      const [result] = await pool.execute('INSERT INTO module_knowledge_files (module_id, parent_id, name, type, file_path, file_size, file_ext, mime_type, parse_status, created_by, file_category) VALUES (?, NULL, ?, "file", NULL, 0, "md", "text/markdown", "parsed", ?, "diagram_knowledge_card")', [diagramAsset.module_id, 'Diagram-' + diagramAsset.diagram_id + '.md', String(diagramAsset.created_by || '')]);
      fileId = result.insertId;
    }
    await embeddingAdapter.upsertKnowledgeChunks(fileId, diagramAsset.module_id, null, chunks, 'diagram_knowledge_card', { userId: diagramAsset.created_by });
  }
  await pool.execute('UPDATE diagram_asset SET parse_status = "published", published_at = NOW() WHERE diagram_id = ?', [diagramAsset.diagram_id]);
}

module.exports = { autoParse, persistDiagramIr, publishToVectorIndex, parseDrawio, parseVsdx, parseSvg, parseImageViaOcr, extractHardwareKeywords, inferDiagramType, diagramIrToMarkdown, newDiagramId: function() { return newId('DIAG'); } };
```

### 1.3 路由 diagramUpload.js

文件 `routes/diagramUpload.js`:

```javascript
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
  destination: function(req, file, cb) { const dir = path.join(UPLOAD_DIR, 'diagrams'); require('fs').mkdirSync(dir, { recursive: true }); cb(null, dir); },
  filename: function(req, file, cb) { cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')); }
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter: function(req, file, cb) { const exts = ['.drawio','.vsdx','.svg','.png','.jpg','.jpeg','.pdf']; const ext = path.extname(file.originalname).toLowerCase(); if (exts.includes(ext)) cb(null, true); else cb(new Error('不支持的文件类型: ' + ext)); } });

router.use(authenticateToken);

// 上传并自动解析
router.post('/upload', upload.single('file'), async function(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '未收到文件' });
    const { moduleId, libraryId, chipVersionId } = req.body;
    const diagramId = newId('DIAG');
    const filePath = req.file.path;
    const fileType = path.extname(req.file.originalname).slice(1).toLowerCase();
    await pool.execute('INSERT INTO diagram_asset (diagram_id, module_id, library_id, chip_version_id, source_file_path, source_file_type, parse_status, created_by) VALUES (?,?,?,?,?,?,"pending",?)', [diagramId, moduleId || null, libraryId || null, chipVersionId || null, filePath, fileType, req.user.id]);
    await pool.execute('UPDATE diagram_asset SET parse_status = "parsing" WHERE diagram_id = ?', [diagramId]);
    const parseResult = await diagramParserService.autoParse(filePath, fileType);
    if (parseResult.status === 'ok') {
      await diagramParserService.persistDiagramIr(diagramId, parseResult, moduleId, req.user.id);
      return res.json({ success: true, diagram_id: diagramId, phase: 'Auto_Parse_Completed', parse_type: parseResult.source_type, pages: parseResult.pages.map(function(p) { return { page_name: p.page_name, node_count: p.nodes.length, edge_count: p.edges.length, markdown_topology: (p.markdown_topology || '').substring(0, 500) }; }), extracted_keywords: parseResult.extracted_keywords || [], requires_human_review: true, review_reason: 'IMAGE_TOPOLOGY_NEEDS_HUMAN_CONFIRMATION' });
    } else {
      await pool.execute('UPDATE diagram_asset SET parse_status = "parse_failed", parse_error = ? WHERE diagram_id = ?', [JSON.stringify(parseResult), diagramId]);
      return res.status(500).json({ success: false, diagram_id: diagramId, phase: 'Parse_Failed', reason: parseResult.reason || parseResult.status, message: parseResult.message });
    }
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
});

// 获取详情
router.get('/:diagramId', async function(req, res) {
  try {
    const [assets] = await pool.execute('SELECT * FROM diagram_asset WHERE diagram_id = ? AND deleted_at IS NULL', [req.params.diagramId]);
    if (assets.length === 0) return res.status(404).json({ success: false, message: '图形资产不存在' });
    const [nodes] = await pool.execute('SELECT * FROM diagram_node WHERE diagram_id = ? ORDER BY page_index, id', [req.params.diagramId]);
    const [edges] = await pool.execute('SELECT * FROM diagram_edge WHERE diagram_id = ? ORDER BY page_index, id', [req.params.diagramId]);
    const [reviews] = await pool.execute('SELECT * FROM diagram_review WHERE diagram_id = ? ORDER BY review_round DESC', [req.params.diagramId]);
    res.json({ success: true, data: Object.assign({}, assets[0], { nodes: nodes, edges: edges, reviews: reviews }) });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 列表
router.get('/', async function(req, res) {
  try {
    const conditions = ['deleted_at IS NULL']; const params = [];
    if (req.query.moduleId) { conditions.push('module_id = ?'); params.push(req.query.moduleId); }
    if (req.query.parseStatus) { conditions.push('parse_status = ?'); params.push(req.query.parseStatus); }
    const [rows] = await pool.execute('SELECT * FROM diagram_asset WHERE ' + conditions.join(' AND ') + ' ORDER BY created_at DESC LIMIT 100', params);
    res.json({ success: true, data: rows });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 提交人工审核
router.post('/:diagramId/review', async function(req, res) {
  try {
    const { humanSummary, decision, reviewerNotes } = req.body;
    if (!humanSummary || !humanSummary.trim()) return res.status(400).json({ success: false, message: 'humanSummary不能为空' });
    const [assets] = await pool.execute('SELECT * FROM diagram_asset WHERE diagram_id = ? AND deleted_at IS NULL', [req.params.diagramId]);
    if (assets.length === 0) return res.status(404).json({ success: false, message: '图形资产不存在' });
    const asset = assets[0];
    const [lastReview] = await pool.execute('SELECT MAX(review_round) as max_round FROM diagram_review WHERE diagram_id = ?', [req.params.diagramId]);
    const nextRound = (lastReview[0] && lastReview[0].max_round || 0) + 1;
    await pool.execute('INSERT INTO diagram_review (diagram_id, reviewer_id, review_round, decision, reviewer_summary, reviewer_notes, previous_human_summary) VALUES (?,?,?,?,?,?,?)', [req.params.diagramId, req.user.id, nextRound, decision || 'changes_requested', humanSummary, reviewerNotes || null, asset.human_summary]);
    await pool.execute('UPDATE diagram_asset SET human_summary = ?, reviewer_id = ?, reviewed_at = NOW(), parse_status = CASE WHEN ? = "approved" THEN "reviewed" ELSE parse_status END WHERE diagram_id = ?', [humanSummary, req.user.id, decision || 'changes_requested', req.params.diagramId]);
    if (decision === 'approved') {
      const [updated] = await pool.execute('SELECT * FROM diagram_asset WHERE diagram_id = ?', [req.params.diagramId]);
      await diagramParserService.publishToVectorIndex(updated[0]);
    }
    res.json({ success: true, data: { diagram_id: req.params.diagramId, decision: decision || 'changes_requested', published: decision === 'approved' } });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 删除(软删除)
router.delete('/:diagramId', requireAdmin, async function(req, res) {
  try { await pool.execute('UPDATE diagram_asset SET deleted_at = NOW() WHERE diagram_id = ?', [req.params.diagramId]); res.json({ success: true, message: '已软删除' }); }
  catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

module.exports = router;
```

### 1.4 server.js 注册

在 `server.js` 已有的路由注册区域添加:
```javascript
app.use('/api/diagram', require('./routes/diagramUpload'));
```

### 1.5 安装依赖

```bash
npm install fast-xml-parser unzipper form-data
```

### 1.6 PaddleOCR Docker部署

```bash
docker run -d -p 8866:8866 --name paddle_ocr --restart unless-stopped paddlepaddle/paddleocr:latest paddleocr --port=8866
curl http://127.0.0.1:8866/healthz
```

---

## Part 2: 模块知识健康度

### 2.1 Migration

文件 `migrations/20260711_knowledge_health.sql`:

```sql
ALTER TABLE modules ADD COLUMN health_score DECIMAL(5,2) DEFAULT 0 COMMENT '知识健康度评分(0-100)';
ALTER TABLE modules ADD COLUMN health_checked_at DATETIME NULL;
ALTER TABLE modules ADD COLUMN health_breakdown JSON DEFAULT NULL COMMENT '各维度得分明细';
```

### 2.2 在 agentConsoleService.js 新增 getModuleHealth 方法

```javascript
async getModuleHealth(moduleId) {
  const [docRows] = await pool.execute('SELECT COUNT(*) as total, SUM(CASE WHEN parse_status = "parsed" THEN 1 ELSE 0 END) as parsed FROM module_knowledge_files WHERE module_id = ? AND deleted_at IS NULL', [moduleId]);
  const docTotal = docRows[0].total || 0;
  const docParsed = docRows[0].parsed || 0;
  const docScore = docTotal === 0 ? 0 : Math.round((docParsed / docTotal) * 100);
  const [conflictRows] = await pool.execute('SELECT COUNT(*) as conflicts FROM module_knowledge_files WHERE module_id = ? AND deleted_at IS NULL AND parse_status = "conflict"', [moduleId]);
  const consistencyScore = docTotal === 0 ? 0 : Math.max(0, 100 - (conflictRows[0].conflicts || 0) * 10);
  const [bugRows] = await pool.execute('SELECT COUNT(*) as total FROM bug_method_cards WHERE module_id = ? AND status = "approved"', [moduleId]);
  const [gapRows] = await pool.execute('SELECT COUNT(*) as gaps FROM bug_test_gap_reports WHERE module = (SELECT name FROM modules WHERE id = ?) AND status = "open"', [moduleId]);
  const bugScore = Math.min(100, (bugRows[0].total || 0) * 10 - (gapRows[0].gaps || 0) * 5);
  const [tpRows] = await pool.execute('SELECT COUNT(*) as total FROM level1_points WHERE module_id = ? AND deleted_at IS NULL', [moduleId]);
  const tpScore = Math.min(100, (tpRows[0].total || 0) * 5);
  const [execRows] = await pool.execute('SELECT COUNT(*) as total, SUM(CASE WHEN verdict IS NOT NULL AND JSON_EXTRACT(verdict, "$.verdict") = "passed" THEN 1 ELSE 0 END) as passed FROM agent_tasks WHERE module_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)', [moduleId]);
  const execTotal = execRows[0].total || 0;
  const execPassed = execRows[0].passed || 0;
  const stabilityScore = execTotal === 0 ? 50 : Math.round((execPassed / execTotal) * 100);
  const healthScore = Math.round(docScore * 0.25 + consistencyScore * 0.20 + Math.max(0, bugScore) * 0.20 + tpScore * 0.20 + stabilityScore * 0.15);
  const breakdown = { docCompleteness: docScore, drvSdkConsistency: consistencyScore, bugCoverage: Math.max(0, bugScore), testPointCoverage: tpScore, executionStability: stabilityScore };
  await pool.execute('UPDATE modules SET health_score = ?, health_checked_at = NOW(), health_breakdown = ? WHERE id = ?', [healthScore, JSON.stringify(breakdown), moduleId]);
  return { moduleId, healthScore, breakdown };
}
```

---

## Part 3: 知识导入审核流程

### 3.1 Migration `migrations/20260712_knowledge_review.sql`

```sql
ALTER TABLE module_knowledge_files ADD COLUMN review_status ENUM('draft','auto_parsed','under_review','approved','rejected','published') DEFAULT 'draft';
ALTER TABLE module_knowledge_files ADD COLUMN reviewer_id INT DEFAULT NULL;
ALTER TABLE module_knowledge_files ADD COLUMN reviewed_at DATETIME DEFAULT NULL;
ALTER TABLE module_knowledge_files ADD COLUMN supersedes INT DEFAULT NULL COMMENT '取代的旧文件ID';
ALTER TABLE module_knowledge_files ADD COLUMN conflict_flags JSON DEFAULT NULL;

CREATE TABLE IF NOT EXISTS knowledge_conflict_log (
  id BIGINT NOT NULL AUTO_INCREMENT,
  file_id INT NOT NULL,
  conflict_type ENUM('drv_mismatch','cli_sdk_mismatch','version_conflict','test_point_outdated','reset_value_mismatch','threshold_mismatch','enum_mismatch') NOT NULL,
  severity ENUM('critical','high','medium','low') NOT NULL,
  description TEXT,
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  resolved_by INT DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_file_id (file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.2 修改 fileParserService.js

在 `parseAndChunk()` 成功后，改为设为`auto_parsed`而非`parsed`，增加审核门禁。

### 3.3 新增审核路由在 routes/knowledge.js

```javascript
router.post('/files/:fileId/review', authenticateToken, async function(req, res) {
  const { decision } = req.body;
  const status = decision === 'approved' ? 'published' : 'rejected';
  await pool.execute('UPDATE module_knowledge_files SET review_status = ?, reviewer_id = ?, reviewed_at = NOW() WHERE id = ?', [status, req.user.id, req.params.fileId]);
  if (decision === 'approved') await pool.execute('UPDATE module_knowledge_files SET parse_status = "parsed" WHERE id = ?', [req.params.fileId]);
  res.json({ success: true, status: status });
});
```

---

## Part 4: Module Taxonomy 标准分类树

### 4.1 Migration `migrations/20260713_module_taxonomy.sql`

```sql
ALTER TABLE modules ADD COLUMN taxonomy_path VARCHAR(512) DEFAULT NULL;
ALTER TABLE modules ADD COLUMN parent_module_id INT DEFAULT NULL;
ALTER TABLE modules ADD COLUMN taxonomy_level INT DEFAULT 0;

INSERT IGNORE INTO modules (name, description, taxonomy_path, taxonomy_level, created_at) VALUES
('Front-end / Ingress', '前端/入方向', 'Front-end/Ingress', 1, NOW()),
('Buffer / MMU', '缓存/内存管理', 'Buffer/MMU', 1, NOW()),
('Fabric / Scheduling', '交换结构/调度', 'Fabric/Scheduling', 1, NOW()),
('Egress', '出方向', 'Egress', 1, NOW()),
('Telemetry / OAM', '遥测/操作管理', 'Telemetry/OAM', 1, NOW()),
('Port / MAC / PCS / SerDes', '端口/物理层', 'Port/MAC/PCS', 1, NOW()),
('SDK / CLI / DRV Common', 'SDK/CLI/DRV公共', 'SDK/CLI/DRV', 1, NOW());
```

### 4.2 路由在 routes/agentCatalog.js 新增

```javascript
router.get('/module-taxonomy', authenticateToken, async function(req, res) {
  const [rows] = await pool.execute('SELECT id, name, description, taxonomy_path FROM modules WHERE taxonomy_path IS NOT NULL ORDER BY taxonomy_path');
  res.json({ success: true, data: rows });
});
```

---

## Part 5: 资源 Bundle 联合锁

### 5.1 Migration `migrations/20260714_resource_bundle.sql`

```sql
CREATE TABLE IF NOT EXISTS env_resource_bundle (
  id BIGINT NOT NULL AUTO_INCREMENT,
  bundle_id VARCHAR(128) NOT NULL UNIQUE,
  display_name VARCHAR(256) NOT NULL,
  status ENUM('idle','leased','maintenance','offline') DEFAULT 'idle',
  compatible_modules JSON DEFAULT NULL,
  cleanup_sequence JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS env_resource_bundle_item (
  id BIGINT NOT NULL AUTO_INCREMENT,
  bundle_id VARCHAR(128) NOT NULL,
  resource_id VARCHAR(128) NOT NULL,
  sort_order INT DEFAULT 0,
  role VARCHAR(64) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_bundle_id (bundle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.2 在 resourceSchedulerService.js 新增 acquireBundle / releaseBundle

```javascript
async acquireBundle(user, data) {
  const bundleId = data.bundleId || data.bundle_id;
  const [bundle] = await pool.execute('SELECT * FROM env_resource_bundle WHERE bundle_id = ?', [bundleId]);
  if (bundle.length === 0) throw new Error('Bundle不存在');
  const [items] = await pool.execute('SELECT * FROM env_resource_bundle_item WHERE bundle_id = ? ORDER BY sort_order', [bundleId]);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of items) {
      const [rows] = await connection.execute('SELECT status FROM env_resource WHERE resource_id = ? FOR UPDATE', [item.resource_id]);
      if (rows.length === 0 || rows[0].status !== 'idle') { await connection.rollback(); return { acquired: false, reason: 'BUNDLE_RESOURCE_BUSY', resourceId: item.resource_id }; }
    }
    const leaseId = newId('LEASE');
    const ttl = Math.max(5, Math.min(parseInt(data.ttlMinutes || 60), 1440));
    for (const item of items) {
      await connection.execute('UPDATE env_resource SET status = "leased", current_lease_id = ? WHERE resource_id = ?', [leaseId, item.resource_id]);
      await connection.execute('INSERT INTO env_resource_lease (lease_id, resource_id, resource_type, owner_user, owner_user_id, task_id, module, chip_version, mode, lease_status, acquired_at, expires_at, bound_resources, cleanup_policy) VALUES (?,?,?,?,?,?,?,?,?,"active",NOW(),DATE_ADD(NOW(),INTERVAL ? MINUTE),?,"rollback_and_release")', [leaseId, item.resource_id, item.role, user.username, user.id, data.taskId || newId('AT'), data.module, data.chipVersion, data.mode || 'dry_run', ttl, JSON.stringify(items.map(function(i){return i.resource_id;}))]);
    }
    await connection.execute('UPDATE env_resource_bundle SET status = "leased" WHERE bundle_id = ?', [bundleId]);
    await connection.commit();
    return { acquired: true, leaseId: leaseId };
  } catch (error) { await connection.rollback().catch(function(){}); throw error; }
  finally { connection.release(); }
}
```

---

## Part 6: EDA 预约/配额/抢占

### 6.1 Migration `migrations/20260715_eda_reservation.sql`

```sql
CREATE TABLE IF NOT EXISTS eda_reservation (
  id BIGINT NOT NULL AUTO_INCREMENT,
  reservation_id VARCHAR(128) NOT NULL UNIQUE,
  resource_id VARCHAR(128) NOT NULL,
  user_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  status ENUM('pending','confirmed','in_progress','completed','cancelled') DEFAULT 'pending',
  task_type ENUM('release_gate','nightly_regression','module_owner_debug','normal_execute','dry_run','exploratory') DEFAULT 'normal_execute',
  priority INT DEFAULT 50,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS resource_quota (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  daily_quota_minutes INT DEFAULT 120,
  used_today_minutes INT DEFAULT 0,
  quota_date DATE NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_type_date (user_id, resource_type, quota_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 6.2 路由在 routes/resourceScheduler.js 新增

```javascript
router.post('/reservations', authenticateToken, async function(req, res) {
  const { resourceId, startTime, endTime, taskType, notes } = req.body;
  const priority = { release_gate: 100, nightly_regression: 80, module_owner_debug: 70, normal_execute: 50, dry_run: 30, exploratory: 20 }[taskType] || 50;
  const reservationId = newId('RSV');
  await pool.execute('INSERT INTO eda_reservation (reservation_id, resource_id, user_id, start_time, end_time, task_type, priority, notes) VALUES (?,?,?,?,?,?,?,?)', [reservationId, resourceId, req.user.id, startTime, endTime, taskType || 'normal_execute', priority, notes]);
  res.json({ success: true, reservationId: reservationId });
});

router.get('/quota', authenticateToken, async function(req, res) {
  const today = new Date().toISOString().split('T')[0];
  const [rows] = await pool.execute('SELECT * FROM resource_quota WHERE user_id = ? AND quota_date = ?', [req.user.id, today]);
  res.json({ success: true, data: rows });
});

router.post('/preempt', authenticateToken, requireAdmin, async function(req, res) {
  const result = await resourceSchedulerService.forceRelease(req.user, req.body.leaseId, 'preempted');
  res.json({ success: true, data: result });
});
```

---

## Part 7: Agent Console UI页面

### 7.1 在 server.js 注册路由

```javascript
app.get('/agent-console', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'agent-console.html')); });
app.get('/agent-console/*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'agent-console.html')); });
```

### 7.2 创建 public/agent-console.html

这是一个单页应用(SPA)，包含7个tab页面。核心结构:

- 左侧Sidebar: Dashboard / Diagram Center / Tasks / Agents / Bug Center / Resources / Knowledge
- 右侧Content Area: 根据tab切换内容
- Human Review Modal: 图形审核弹窗

关键JS函数:
- `api(method, url, body)` — 统一API调用
- `navigateTo(page)` — 页面切换
- `loadDashboard()` — 加载统计数据
- `loadDiagramCenter()` — 图形列表+上传
- `loadTasks()` — 任务列表
- `loadAgents()` — Agent列表
- `loadBugCenter()` — Bug卡片列表
- `loadResources()` — 资源状态看板
- `uploadDiagram(file, moduleId)` — 上传图形文件
- `showReviewModal(diagramId)` — 显示审核弹窗
- `submitReview(decision)` — 提交审核结果

> 由于HTML代码量较大(约500行)，建议在TRAE IDE中让GLM-5.2根据上述结构自动生成完整HTML。关键是: 纯HTML+内联CSS+原生JS(无框架)，调用上述API接口。

---

## 实施顺序

1. **Part 1** Diagram Layer (P0, 1-2周) — 最高优先级
2. **Part 2+3** 知识健康度+审核流程 (1周)
3. **Part 4** Module Taxonomy (2天)
4. **Part 5** 资源Bundle (3天)
5. **Part 6** EDA预约 (3天)
6. **Part 7** UI页面 (1-2周)