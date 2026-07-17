const pool = require('../db');
const logger = require('./logger');

function toNullableInt(value) {
  if (value === null || value === undefined || value === '' || value === 'null') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

class ChipContextService {
  async list(options = {}) {
    const includeInactive = options.includeInactive === true || options.includeInactive === 'true';
    const sql = `
      SELECT cv.*, p.version_key AS parent_key, p.name AS parent_name
      FROM chip_versions cv
      LEFT JOIN chip_versions p ON cv.parent_id = p.id
      ${includeInactive ? '' : "WHERE cv.status = 'active'"}
      ORDER BY cv.generation_order ASC, cv.id ASC
    `;
    const [rows] = await pool.execute(sql);
    return rows;
  }

  async create(data) {
    const versionKey = String(data.versionKey || data.version_key || '').trim();
    const name = String(data.name || '').trim();
    if (!versionKey || !name) {
      throw new Error('缺少芯片版本标识或名称');
    }

    const parentId = toNullableInt(data.parentId || data.parent_id);
    const generationOrder = toNullableInt(data.generationOrder || data.generation_order) || 0;
    const status = data.status || 'active';
    const description = data.description || null;

    const [result] = await pool.execute(
      `INSERT INTO chip_versions (version_key, name, generation_order, parent_id, status, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [versionKey, name, generationOrder, parentId, status, description]
    );
    return { id: result.insertId, versionKey, name };
  }

  async update(id, data) {
    const chipId = toNullableInt(id);
    if (!chipId) throw new Error('无效芯片版本ID');

    const allowed = [];
    const params = [];
    const fieldMap = {
      versionKey: 'version_key',
      version_key: 'version_key',
      name: 'name',
      generationOrder: 'generation_order',
      generation_order: 'generation_order',
      parentId: 'parent_id',
      parent_id: 'parent_id',
      status: 'status',
      description: 'description'
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        allowed.push(`${column} = ?`);
        if (column === 'generation_order' || column === 'parent_id') {
          params.push(toNullableInt(data[key]));
        } else {
          params.push(data[key]);
        }
      }
    }

    if (allowed.length === 0) return { id: chipId, changed: false };
    params.push(chipId);
    await pool.execute(`UPDATE chip_versions SET ${allowed.join(', ')} WHERE id = ?`, params);
    return { id: chipId, changed: true };
  }

  async getById(id) {
    const chipId = toNullableInt(id);
    if (!chipId) return null;
    const [rows] = await pool.execute('SELECT * FROM chip_versions WHERE id = ?', [chipId]);
    return rows[0] || null;
  }

  async getByKey(versionKey) {
    if (!versionKey) return null;
    const [rows] = await pool.execute('SELECT * FROM chip_versions WHERE version_key = ?', [versionKey]);
    return rows[0] || null;
  }

  async remove(id) {
    const chipId = toNullableInt(id);
    if (!chipId) throw new Error('无效芯片版本ID');
    // 检查是否有子代系引用
    const [children] = await pool.execute('SELECT id FROM chip_versions WHERE parent_id = ? LIMIT 1', [chipId]);
    if (children.length > 0) throw new Error('该芯片代系有子代系引用,请先解除继承关系');
    // 检查是否被知识/测试点/用例绑定(有绑定则拦截删除)
    const [bindings] = await pool.execute(
      `SELECT 'knowledge_file' AS t, COUNT(*) AS c FROM module_knowledge_files WHERE chip_version_id = ?
       UNION ALL SELECT 'level1_point', COUNT(*) FROM level1_points WHERE chip_version_id = ?
       UNION ALL SELECT 'test_case', COUNT(*) FROM test_cases WHERE chip_version_id = ?`,
      [chipId, chipId, chipId]
    );
    const strictBindings = bindings.filter(b => b.c > 0);
    if (strictBindings.length > 0) {
      const detail = strictBindings.map(b => `${b.t}(${b.c})`).join(', ');
      throw new Error(`该芯片代系已被绑定(${detail}),请先迁移或解绑后再删除`);
    }
    await pool.execute('DELETE FROM chip_versions WHERE id = ?', [chipId]);
    return { id: chipId, deleted: true };
  }

  async getInheritanceChain(chipVersionId) {
    const startId = toNullableInt(chipVersionId);
    if (!startId) return [];

    const chain = [];
    const seen = new Set();
    let current = await this.getById(startId);
    while (current && !seen.has(current.id)) {
      chain.unshift(current);
      seen.add(current.id);
      current = current.parent_id ? await this.getById(current.parent_id) : null;
    }
    return chain;
  }

  async isCompatible(sourceChipVersionId, targetChipVersionId) {
    const sourceId = toNullableInt(sourceChipVersionId);
    const targetId = toNullableInt(targetChipVersionId);
    if (!sourceId || !targetId) return true;
    if (sourceId === targetId) return true;
    const targetChain = await this.getInheritanceChain(targetId);
    return targetChain.some(item => item.id === sourceId);
  }

  async resolveContext(options = {}) {
    const explicitId = toNullableInt(options.chipVersionId || options.chip_version_id);
    if (explicitId) {
      const chipVersion = await this.getById(explicitId);
      return this._buildResolvedContext(chipVersion, 'explicit');
    }

    const lookups = [
      { key: 'level1PointId', table: 'level1_points', column: 'id', source: 'level1_point' },
      { key: 'level1_point_id', table: 'level1_points', column: 'id', source: 'level1_point' },
      { key: 'testCaseId', table: 'test_cases', column: 'id', source: 'test_case' },
      { key: 'test_case_id', table: 'test_cases', column: 'id', source: 'test_case' },
      { key: 'knowledgeFileId', table: 'module_knowledge_files', column: 'id', source: 'knowledge_file' },
      { key: 'fileId', table: 'module_knowledge_files', column: 'id', source: 'knowledge_file' },
      { key: 'tclTaskId', table: 'tcl_generation_tasks', column: 'task_id', source: 'tcl_task' },
      { key: 'taskId', table: 'tcl_generation_tasks', column: 'task_id', source: 'tcl_task' }
    ];

    for (const lookup of lookups) {
      if (options[lookup.key] === undefined || options[lookup.key] === null || options[lookup.key] === '') continue;
      try {
        const [rows] = await pool.execute(
          `SELECT chip_version_id FROM ${lookup.table} WHERE ${lookup.column} = ? LIMIT 1`,
          [options[lookup.key]]
        );
        const chipId = rows[0]?.chip_version_id;
        if (chipId) {
          const chipVersion = await this.getById(chipId);
          return this._buildResolvedContext(chipVersion, lookup.source);
        }
      } catch (error) {
        logger.debug('芯片上下文反查失败', { lookup: lookup.source, error: error.message });
      }
    }

    return this._buildResolvedContext(null, 'generic');
  }

  async _buildResolvedContext(chipVersion, source) {
    const chain = chipVersion ? await this.getInheritanceChain(chipVersion.id) : [];
    return {
      chipVersion: chipVersion || null,
      chipVersionId: chipVersion?.id || null,
      source,
      inheritanceChain: chain,
      compatibleChipVersionIds: chain.map(item => item.id)
    };
  }

  async buildPromptContext(options = {}) {
    const context = options.chipVersion || options.inheritanceChain ? options : await this.resolveContext(options);
    if (!context.chipVersion) {
      return '## 芯片上下文\n- 当前芯片代系: 通用（未指定，允许使用通用知识；涉及具体寄存器地址/字段时必须有证据）';
    }

    const chainText = (context.inheritanceChain || [])
      .map(item => `${item.name}(${item.version_key})`)
      .join(' -> ');

    return `## 芯片上下文\n- 当前芯片代系: ${context.chipVersion.name}(${context.chipVersion.version_key})\n- 继承链: ${chainText || '无'}\n- 规则: 可继承上游代系通用知识，但寄存器地址、字段、SDK API 必须优先使用当前代系证据；证据不足时标记 needs_human。`;
  }
}

module.exports = new ChipContextService();
