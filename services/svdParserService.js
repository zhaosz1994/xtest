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

function decodeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function textOf(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : null;
}

function blocksOf(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const blocks = [];
  let match;
  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value).trim();
  if (/^0x/i.test(str)) return parseInt(str, 16);
  const parsed = parseInt(str, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

class SvdParserService {
  constructor() {
    this.runningParses = new Set();
  }

  async _getFile(parsedFileId) {
    try {
      const [files] = await pool.execute(
        `SELECT id, module_id, library_id, name, file_path, file_ext, chip_version_id
         FROM module_knowledge_files
         WHERE id = ? AND deleted_at IS NULL`,
        [parsedFileId]
      );
      return files[0] || null;
    } catch (error) {
      if (error.code !== 'ER_BAD_FIELD_ERROR') throw error;
      const [files] = await pool.execute(
        `SELECT id, module_id, library_id, name, file_path, file_ext
         FROM module_knowledge_files
         WHERE id = ? AND deleted_at IS NULL`,
        [parsedFileId]
      );
      return files[0] ? { ...files[0], chip_version_id: null } : null;
    }
  }

  async parse(fileId, chipVersionId = null) {
    const parsedFileId = toNullableInt(fileId);
    if (!parsedFileId) throw new Error('无效文件ID');
    if (this.runningParses.has(parsedFileId)) {
      throw new Error('该SVD文件正在解析中，请稍后重试');
    }
    this.runningParses.add(parsedFileId);

    try {
      const file = await this._getFile(parsedFileId);
      if (!file) throw new Error('文件不存在');

      const effectiveChipVersionId = toNullableInt(chipVersionId) || file.chip_version_id || null;
      const content = await fs.readFile(path.join(UPLOAD_DIR, file.file_path), 'utf-8');
      const registers = this._extractRegisters(content);

      const savedRegisters = [];
      let connection;
      try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        await connection.execute('SELECT id FROM module_knowledge_files WHERE id = ? FOR UPDATE', [parsedFileId]);
        await connection.execute('DELETE FROM chip_register_fields WHERE register_id IN (SELECT id FROM chip_registers WHERE source_file_id = ?)', [parsedFileId]);
        await connection.execute('DELETE FROM chip_registers WHERE source_file_id = ?', [parsedFileId]);

        for (const reg of registers) {
          const [result] = await connection.execute(
            `INSERT INTO chip_registers
              (chip_version_id, source_file_id, peripheral_name, register_name, base_address,
               address_offset, absolute_address, description, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              effectiveChipVersionId,
              parsedFileId,
              reg.peripheralName,
              reg.registerName,
              reg.baseAddress,
              reg.addressOffset,
              reg.absoluteAddress,
              reg.description,
              JSON.stringify({ source: 'svd', fileName: file.name })
            ]
          );
          const registerId = result.insertId;
          savedRegisters.push({ ...reg, id: registerId });

          for (const field of reg.fields) {
            await connection.execute(
              `INSERT INTO chip_register_fields
                (register_id, field_name, bit_offset, bit_width, lsb, msb, access, description, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                registerId,
                field.name,
                field.bitOffset,
                field.bitWidth,
                field.lsb,
                field.msb,
                field.access,
                field.description,
                JSON.stringify({ source: 'svd' })
              ]
            );
          }
        }
        await connection.commit();
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        if (connection) connection.release();
      }

      await this._upsertChunks(file, savedRegisters, effectiveChipVersionId);
      logger.info('SVD寄存器解析完成', { fileId: parsedFileId, registerCount: savedRegisters.length });
      return { fileId: parsedFileId, chipVersionId: effectiveChipVersionId, registerCount: savedRegisters.length };
    } finally {
      this.runningParses.delete(parsedFileId);
    }
  }

  _extractRegisters(xml) {
    const peripheralBlocks = blocksOf(xml, 'peripheral');
    const registers = [];

    for (const peripheralXml of peripheralBlocks) {
      const peripheralName = textOf(peripheralXml, 'name') || 'UNKNOWN_PERIPHERAL';
      const baseAddress = parseNumber(textOf(peripheralXml, 'baseAddress'));
      const registerBlocks = blocksOf(peripheralXml, 'register');

      for (const registerXml of registerBlocks) {
        const registerName = textOf(registerXml, 'name');
        if (!registerName) continue;
        const addressOffset = parseNumber(textOf(registerXml, 'addressOffset'));
        const absoluteAddress = baseAddress !== null && addressOffset !== null ? baseAddress + addressOffset : null;
        const fields = blocksOf(registerXml, 'field').map(fieldXml => this._extractField(fieldXml)).filter(Boolean);
        registers.push({
          peripheralName,
          registerName,
          baseAddress,
          addressOffset,
          absoluteAddress,
          description: textOf(registerXml, 'description'),
          fields
        });
      }
    }

    return registers;
  }

  _extractField(fieldXml) {
    const name = textOf(fieldXml, 'name');
    if (!name) return null;
    let bitOffset = parseNumber(textOf(fieldXml, 'bitOffset'));
    let bitWidth = parseNumber(textOf(fieldXml, 'bitWidth'));
    let lsb = parseNumber(textOf(fieldXml, 'lsb'));
    let msb = parseNumber(textOf(fieldXml, 'msb'));

    const bitRange = textOf(fieldXml, 'bitRange');
    if (bitRange) {
      const rangeMatch = bitRange.match(/\[(\d+)\s*:\s*(\d+)\]/);
      if (rangeMatch) {
        msb = parseInt(rangeMatch[1], 10);
        lsb = parseInt(rangeMatch[2], 10);
      }
    }

    if ((bitOffset === null || bitWidth === null) && lsb !== null && msb !== null) {
      bitOffset = Math.min(lsb, msb);
      bitWidth = Math.abs(msb - lsb) + 1;
    }
    if ((lsb === null || msb === null) && bitOffset !== null && bitWidth !== null) {
      lsb = bitOffset;
      msb = bitOffset + bitWidth - 1;
    }

    return {
      name,
      bitOffset,
      bitWidth,
      lsb,
      msb,
      access: textOf(fieldXml, 'access'),
      description: textOf(fieldXml, 'description')
    };
  }

  async _upsertChunks(file, registers, chipVersionId) {
    const registerChunks = registers.map(reg => ({
      chunkContent: `Register ${reg.peripheralName}.${reg.registerName}\nBase: ${reg.baseAddress !== null ? '0x' + reg.baseAddress.toString(16) : '-'}\nOffset: ${reg.addressOffset !== null ? '0x' + reg.addressOffset.toString(16) : '-'}\nAddress: ${reg.absoluteAddress !== null ? '0x' + reg.absoluteAddress.toString(16) : '-'}\nDescription: ${reg.description || '-'}`,
      tokenCount: 0,
      charCount: 0,
      chunkingStrategy: 'knowledge',
      metadata: { category: 'register_map', registerId: reg.id, registerName: reg.registerName, peripheralName: reg.peripheralName },
      fileCategory: 'register_map'
    }));

    const fieldChunks = [];
    for (const reg of registers) {
      for (const field of reg.fields) {
        const content = `Register Field ${reg.peripheralName}.${reg.registerName}.${field.name}\nBits: ${field.msb ?? '-'}:${field.lsb ?? '-'} (offset=${field.bitOffset ?? '-'}, width=${field.bitWidth ?? '-'})\nAccess: ${field.access || '-'}\nDescription: ${field.description || '-'}`;
        fieldChunks.push({
          chunkContent: content,
          tokenCount: 0,
          charCount: content.length,
          chunkingStrategy: 'knowledge',
          metadata: { category: 'register_field', registerId: reg.id, registerName: reg.registerName, fieldName: field.name },
          fileCategory: 'register_field'
        });
      }
    }

    const chunks = [...registerChunks, ...fieldChunks].map(chunk => ({
      ...chunk,
      charCount: chunk.charCount || chunk.chunkContent.length
    }));

    if (chunks.length > 0) {
      await embeddingAdapter.upsertKnowledgeChunks(file.id, file.module_id, file.library_id, chunks, 'register_map', { chipVersionId });
    }
  }
}

module.exports = new SvdParserService();
