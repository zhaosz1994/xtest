const fs = require('fs').promises;
const path = require('path');
const pool = require('../db');
const logger = require('./logger');
const embeddingAdapter = require('./embeddingAdapter');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

function toNullableInt(value) {
  if (value === null || value === undefined || value === '' || value === 'null') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

class SdkAstService {
  constructor() {
    this.runningIndexes = new Set();
  }

  async index(fileIds, chipVersionId = null) {
    const ids = Array.isArray(fileIds) ? fileIds : [fileIds];
    const parsedIds = ids.map(toNullableInt).filter(Boolean);
    if (parsedIds.length === 0) throw new Error('缺少文件ID');

    const results = [];
    for (const fileId of parsedIds) {
      results.push(await this._indexOne(fileId, chipVersionId));
    }
    return { indexedFiles: results.length, results };
  }

  async _getFile(fileId) {
    try {
      const [files] = await pool.execute(
        `SELECT id, module_id, library_id, name, file_path, file_ext, chip_version_id
         FROM module_knowledge_files
         WHERE id = ? AND deleted_at IS NULL`,
        [fileId]
      );
      return files[0] || null;
    } catch (error) {
      if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
      const [files] = await pool.execute(
        `SELECT id, module_id, library_id, name, file_path, file_ext
         FROM module_knowledge_files
         WHERE id = ? AND deleted_at IS NULL`,
        [fileId]
      );
      return files[0] ? { ...files[0], chip_version_id: null } : null;
    }
  }

  async _indexOne(fileId, chipVersionId) {
    if (this.runningIndexes.has(fileId)) {
      throw new Error(`该SDK文件正在索引中，请稍后重试: ${fileId}`);
    }
    this.runningIndexes.add(fileId);
    try {
      const file = await this._getFile(fileId);
      if (!file) throw new Error(`文件不存在: ${fileId}`);

      const effectiveChipVersionId = toNullableInt(chipVersionId) || file.chip_version_id || null;
      const content = await fs.readFile(path.join(UPLOAD_DIR, file.file_path), 'utf-8');
      const symbols = this._extractSymbols(content, file.name);

      const saved = [];
      let connection;
      try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        await connection.execute('SELECT id FROM module_knowledge_files WHERE id = ? FOR UPDATE', [fileId]);
        await connection.execute('DELETE FROM sdk_api_symbols WHERE file_id = ?', [fileId]);

        for (const symbol of symbols) {
          const [result] = await connection.execute(
            `INSERT INTO sdk_api_symbols
              (chip_version_id, file_id, symbol_type, name, signature, namespace, source_location, content, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              effectiveChipVersionId,
              fileId,
              symbol.symbolType,
              symbol.name,
              symbol.signature,
              symbol.namespace || null,
              symbol.sourceLocation || null,
              symbol.content || symbol.signature,
              JSON.stringify({ source: 'regex_ast', fileName: file.name })
            ]
          );
          saved.push({ ...symbol, id: result.insertId });
        }
        await connection.commit();
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        if (connection) connection.release();
      }

      await this._upsertChunks(file, saved, effectiveChipVersionId);
      logger.info('SDK符号索引完成', { fileId, symbolCount: saved.length });
      return { fileId, chipVersionId: effectiveChipVersionId, symbolCount: saved.length };
    } finally {
      this.runningIndexes.delete(fileId);
    }
  }

  _extractSymbols(content, fileName) {
    const symbols = [];
    const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const lines = withoutComments.split('\n');

    lines.forEach((line, idx) => {
      const macro = line.match(/^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?\s*(.*)$/);
      if (macro) {
        symbols.push({
          symbolType: 'macro',
          name: macro[1],
          signature: line.trim(),
          sourceLocation: `${fileName}:${idx + 1}`,
          content: line.trim()
        });
      }
    });

    const functionRe = /(?:^|\n)\s*((?:static\s+|extern\s+|inline\s+|const\s+|unsigned\s+|signed\s+|struct\s+|enum\s+|[A-Za-z_][\w\*\s]+\s+)+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}()]*(?:\([^)]*\)[^;{}()]*)*)\)\s*(?:;|\{)/g;
    let match;
    while ((match = functionRe.exec(withoutComments)) !== null) {
      const returnType = match[1].replace(/\s+/g, ' ').trim();
      const name = match[2];
      if (['if', 'for', 'while', 'switch', 'return', 'sizeof'].includes(name)) continue;
      symbols.push({
        symbolType: 'function',
        name,
        signature: `${returnType} ${name}(${match[3].replace(/\s+/g, ' ').trim()})`,
        sourceLocation: `${fileName}:${this._lineNumberAt(withoutComments, match.index)}`,
        content: match[0].trim().slice(0, 1000)
      });
    }

    const structRe = /typedef\s+struct\s*(?:[A-Za-z_][A-Za-z0-9_]*)?\s*\{([\s\S]*?)\}\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
    while ((match = structRe.exec(withoutComments)) !== null) {
      symbols.push({
        symbolType: 'struct',
        name: match[2],
        signature: `typedef struct ${match[2]}`,
        sourceLocation: `${fileName}:${this._lineNumberAt(withoutComments, match.index)}`,
        content: match[0].trim().slice(0, 2000)
      });
    }

    const enumRe = /typedef\s+enum\s*(?:[A-Za-z_][A-Za-z0-9_]*)?\s*\{([\s\S]*?)\}\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
    while ((match = enumRe.exec(withoutComments)) !== null) {
      symbols.push({
        symbolType: 'enum',
        name: match[2],
        signature: `typedef enum ${match[2]}`,
        sourceLocation: `${fileName}:${this._lineNumberAt(withoutComments, match.index)}`,
        content: match[0].trim().slice(0, 2000)
      });
    }

    const seen = new Set();
    return symbols.filter(symbol => {
      const key = `${symbol.symbolType}:${symbol.name}:${symbol.signature}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _lineNumberAt(text, index) {
    return text.slice(0, index).split('\n').length;
  }

  async _upsertChunks(file, symbols, chipVersionId) {
    if (symbols.length === 0) return;
    const chunks = symbols.map(symbol => {
      const content = `SDK ${symbol.symbolType}: ${symbol.name}\nSignature: ${symbol.signature || '-'}\nLocation: ${symbol.sourceLocation || '-'}\n${symbol.content || ''}`;
      return {
        chunkContent: content,
        tokenCount: 0,
        charCount: content.length,
        chunkingStrategy: 'knowledge',
        metadata: { category: 'sdk_api', symbolId: symbol.id, symbolType: symbol.symbolType, name: symbol.name }
      };
    });
    await embeddingAdapter.upsertKnowledgeChunks(file.id, file.module_id, file.library_id, chunks, 'sdk_api', { chipVersionId });
  }
}

module.exports = new SdkAstService();
