/**
 * Diagram Parser Service — Part 1: Diagram Knowledge Layer
 * 支持 drawio/vsdx/svg/pdf/OCR 解析,提取 nodes/edges,持久化到 DB,发布到向量库
 */
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

// === DrawIO 解析 ===

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

// === VSDX 解析 ===

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

// === SVG 解析 ===

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

// === OCR 微服务调用 ===

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

// === PDF 图形 ===

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
