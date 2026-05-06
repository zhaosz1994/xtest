const pool = require('../db');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');
const PQueue = require('p-queue').default;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const DEADLOCK_ERROR_CODES = [1213, 1205];
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 200;

class FileParserService {
  constructor() {
    this.parseQueue = new PQueue({
      concurrency: parseInt(process.env.FILE_PARSE_CONCURRENCY) || 2
    });
  }

  isDeadlockError(error) {
    return DEADLOCK_ERROR_CODES.includes(error.errno) ||
      DEADLOCK_ERROR_CODES.includes(error.code) ||
      (error.message && error.message.includes('Deadlock'));
  }

  async retryOnDeadlock(fn, label = 'operation') {
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (this.isDeadlockError(error) && attempt < MAX_RETRY_ATTEMPTS) {
          const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1) + Math.random() * 100;
          logger.warn(`${label}遇到死锁，第${attempt}次重试`, { attempt, delay: Math.round(delay) });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }

  async parseAndChunk(fileId) {
    const [files] = await pool.execute(`
      SELECT f.*, COALESCE(m.name, '用例库文件') as module_name
      FROM module_knowledge_files f
      LEFT JOIN modules m ON f.module_id = m.id
      WHERE f.id = ? AND f.deleted_at IS NULL
    `, [fileId]);

    if (files.length === 0) return;

    const file = files[0];

    await this.retryOnDeadlock(async () => {
      await pool.execute(`
        UPDATE module_knowledge_files 
        SET parse_status = 'parsing' 
        WHERE id = ?
      `, [fileId]);
    }, `更新文件解析状态[fileId=${fileId}]`);

    try {
      const filePath = path.join(UPLOAD_DIR, file.file_path);
      const ext = file.file_ext.toLowerCase();

      let content = '';

      if (['docx', 'doc'].includes(ext)) {
        content = await this.parseDocx(filePath);
      } else if (['xlsx', 'xls'].includes(ext)) {
        content = await this.parseExcel(filePath);
      } else if (ext === 'pdf') {
        content = await this.parsePdf(filePath);
      } else if (ext === 'pptx') {
        content = await this.parsePptx(filePath);
      } else if (['txt', 'md'].includes(ext)) {
        content = await fs.readFile(filePath, 'utf-8');
      } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
        content = `[图片文件: ${file.name}]`;
      } else {
        content = await fs.readFile(filePath, 'utf-8').catch(() => `[不支持的文件类型: ${ext}]`);
      }

      if (!content || content.trim().length === 0) {
        throw new Error('文件内容为空');
      }

      const chunks = this.chunkContent(content, {
        chunkSize: 2000,
        overlap: 200,
        minChunkSize: 100
      });

      await this.saveChunks(fileId, file.module_id, chunks, file.library_id);

      await this.retryOnDeadlock(async () => {
        await pool.execute(`
          UPDATE module_knowledge_files 
          SET parse_status = 'parsed', 
              chunk_count = ?,
              total_tokens = ?,
              parsed_at = NOW()
          WHERE id = ?
        `, [chunks.length, chunks.reduce((sum, c) => sum + c.tokenCount, 0), fileId]);
      }, `更新文件解析完成状态[fileId=${fileId}]`);

      return { fileId, chunkCount: chunks.length };

    } catch (error) {
      await this.retryOnDeadlock(async () => {
        await pool.execute(`
          UPDATE module_knowledge_files 
          SET parse_status = 'failed', parse_error = ?
          WHERE id = ?
        `, [error.message, fileId]);
      }, `更新文件解析失败状态[fileId=${fileId}]`).catch(err => {
        logger.error('更新解析失败状态时出错', { fileId, error: err.message });
      });

      throw error;
    }
  }

  async parseDocx(filePath) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  async parseExcel(filePath) {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    let allContent = '';

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      allContent += `## 工作表: ${sheetName}\n\n`;

      if (jsonData.length > 0) {
        const headers = jsonData[0];
        allContent += '| ' + headers.join(' | ') + ' |\n';
        allContent += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          allContent += '| ' + row.map(cell => cell != null ? String(cell) : '').join(' | ') + ' |\n';
        }
        allContent += '\n';
      }
    }

    return allContent;
  }

  async parsePdf(filePath) {
    const pdfParse = require('pdf-parse');
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  }

  async parsePptx(filePath) {
    const { PPTXInHTMLOut } = require('pptx-in-html-out');
    const buffer = await fs.readFile(filePath);
    const converter = new PPTXInHTMLOut(buffer);
    const html = await converter.toHTML({ includeStyles: false });
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text;
  }

  chunkContent(content, options = {}) {
    const { chunkSize = 2000, overlap = 200, minChunkSize = 100 } = options;
    const chunks = [];
    let index = 0;
    let position = 0;

    while (position < content.length) {
      const oldPosition = position;
      let endPosition = Math.min(position + chunkSize, content.length);
      let chunkContent = content.slice(position, endPosition);

      if (endPosition < content.length) {
        const breakPoints = [
          chunkContent.lastIndexOf('。\n'),
          chunkContent.lastIndexOf('。\r\n'),
          chunkContent.lastIndexOf('。'),
          chunkContent.lastIndexOf('\n\n'),
          chunkContent.lastIndexOf('\n'),
          chunkContent.lastIndexOf('.')
        ].filter(bp => bp > minChunkSize);

        if (breakPoints.length > 0) {
          const breakPoint = Math.max(...breakPoints);
          chunkContent = chunkContent.slice(0, breakPoint + 1);
        }
      }

      const trimmed = chunkContent.trim();
      if (trimmed.length >= minChunkSize || (chunks.length === 0 && trimmed.length > 0)) {
        chunks.push({
          chunkIndex: index,
          chunkContent: trimmed,
          tokenCount: this.estimateTokens(trimmed),
          charCount: trimmed.length
        });
        index++;
      }

      position += chunkContent.length - overlap;
      if (position <= oldPosition) position = oldPosition + Math.min(chunkContent.length, minChunkSize);
    }

    return chunks;
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

  async saveChunks(fileId, moduleId, chunks, libraryId) {
    return this.retryOnDeadlock(async () => {
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        await connection.execute(`
          DELETE FROM ai_material_chunks WHERE file_id = ?
        `, [fileId]);

        if (chunks.length > 0) {
          const batchSize = 100;
          for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
            const values = [];
            for (const chunk of batch) {
              values.push(fileId, moduleId || null, libraryId || null, chunk.chunkIndex, chunk.chunkContent, chunk.tokenCount, chunk.charCount);
            }
            await connection.execute(`
              INSERT INTO ai_material_chunks
                (file_id, module_id, library_id, chunk_index, chunk_content, token_count, char_count)
              VALUES ${placeholders}
            `, values);
          }
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }, `保存文件分块[fileId=${fileId}]`);
  }

  asyncParseFile(fileId) {
    this.parseQueue.add(async () => {
      try {
        await this.parseAndChunk(fileId);
      } catch (error) {
        logger.error('文件解析失败', { fileId, error: error.message });
      }
    }).catch(err => {
      logger.error('异步解析任务异常', { fileId, error: err.message });
    });
  }

  async reparseFile(fileId) {
    await pool.execute(`
      UPDATE module_knowledge_files 
      SET parse_status = 'pending', parse_error = NULL
      WHERE id = ?
    `, [fileId]);

    return this.parseAndChunk(fileId);
  }

  async getChunksByFile(fileId) {
    const [chunks] = await pool.execute(`
      SELECT * FROM ai_material_chunks 
      WHERE file_id = ?
      ORDER BY chunk_index ASC
    `, [fileId]);

    return chunks;
  }

  async getChunksByModule(moduleId, fileIds = []) {
    let sql = `
      SELECT c.*, f.name as file_name, f.parse_status as file_parse_status
      FROM ai_material_chunks c
      JOIN module_knowledge_files f ON c.file_id = f.id
      WHERE c.module_id = ? AND f.deleted_at IS NULL
    `;
    const params = [moduleId];

    if (fileIds.length > 0) {
      const placeholders = fileIds.map(() => '?').join(',');
      sql += ` AND c.file_id IN (${placeholders})`;
      params.push(...fileIds);
    }

    sql += ` ORDER BY c.file_id, c.chunk_index ASC`;

    const [chunks] = await pool.execute(sql, params);
    return chunks;
  }
}

module.exports = new FileParserService();
