const pool = require('../db');
const { isAdmin } = require('../middleware');
const { safeJson, jsonValue, newId, parsePositiveInt } = require('./agentUtils');

const VALID_CATEGORIES = ['target_env', 'mode', 'severity', 'agent_role', 'task_status', 'resource_type'];

function mapCatalogItem(row) {
  return {
    ...row,
    metadata: safeJson(row.metadata, {})
  };
}

class AgentCatalogService {
  async listByCategory(category, { includeInactive = false } = {}) {
    if (!VALID_CATEGORIES.includes(category)) {
      throw new Error(`不支持的字典分类: ${category}`);
    }
    const conditions = ['category = ?'];
    const params = [category];
    if (!includeInactive) conditions.push("status = 'active'");
    const [rows] = await pool.execute(
      `SELECT * FROM agent_console_catalog WHERE ${conditions.join(' AND ')} ORDER BY sort_order ASC, id ASC`,
      params
    );
    return rows.map(mapCatalogItem);
  }

  async listAll({ includeInactive = false } = {}) {
    const where = includeInactive ? '' : "WHERE status = 'active'";
    const [rows] = await pool.query(
      `SELECT * FROM agent_console_catalog ${where} ORDER BY category ASC, sort_order ASC, id ASC`
    );
    const grouped = {};
    rows.forEach(row => {
      const item = mapCatalogItem(row);
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    });
    return grouped;
  }

  async createItem(user, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const { category, itemKey, itemLabel, sortOrder = 0, status = 'active', description = null, metadata = null } = data;
    if (!VALID_CATEGORIES.includes(category)) throw new Error(`不支持的字典分类: ${category}`);
    if (!itemKey || !itemLabel) throw new Error('itemKey 和 itemLabel 不能为空');
    await pool.execute(
      `INSERT INTO agent_console_catalog (category, item_key, item_label, sort_order, status, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [category, itemKey, itemLabel, parsePositiveInt(sortOrder, 0), status, description, jsonValue(metadata || {})]
    );
    const [rows] = await pool.execute(
      'SELECT * FROM agent_console_catalog WHERE category = ? AND item_key = ?',
      [category, itemKey]
    );
    return mapCatalogItem(rows[0]);
  }

  async updateItem(user, category, itemKey, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const [existing] = await pool.execute(
      'SELECT * FROM agent_console_catalog WHERE category = ? AND item_key = ?',
      [category, itemKey]
    );
    if (existing.length === 0) throw new Error('字典项不存在');
    const fields = [];
    const params = [];
    if (data.itemLabel !== undefined) { fields.push('item_label = ?'); params.push(data.itemLabel); }
    if (data.sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(parsePositiveInt(data.sortOrder, 0)); }
    if (data.status !== undefined) { fields.push('status = ?'); params.push(data.status); }
    if (data.description !== undefined) { fields.push('description = ?'); params.push(data.description); }
    if (data.metadata !== undefined) { fields.push('metadata = ?'); params.push(jsonValue(data.metadata || {})); }
    if (fields.length === 0) return mapCatalogItem(existing[0]);
    params.push(category, itemKey);
    await pool.execute(
      `UPDATE agent_console_catalog SET ${fields.join(', ')} WHERE category = ? AND item_key = ?`,
      params
    );
    const [rows] = await pool.execute(
      'SELECT * FROM agent_console_catalog WHERE category = ? AND item_key = ?',
      [category, itemKey]
    );
    return mapCatalogItem(rows[0]);
  }

  async deleteItem(user, category, itemKey, { soft = true } = {}) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    if (soft) {
      await pool.execute(
        "UPDATE agent_console_catalog SET status = 'inactive' WHERE category = ? AND item_key = ?",
        [category, itemKey]
      );
      return { softDeleted: true };
    }
    await pool.execute(
      'DELETE FROM agent_console_catalog WHERE category = ? AND item_key = ?',
      [category, itemKey]
    );
    return { deleted: true };
  }

  // ========== Agent Registry CRUD ==========
  async listAgents({ includeInactive = false } = {}) {
    const where = includeInactive ? 'WHERE deleted_at IS NULL' : 'WHERE deleted_at IS NULL AND status = \'online\'';
    const [rows] = await pool.query(`SELECT * FROM agent_registry ${where} ORDER BY id ASC`);
    return rows.map(row => ({
      ...row,
      allowed_tools: safeJson(row.allowed_tools, []),
      allowed_envs: safeJson(row.allowed_envs, []),
      allowed_modes: safeJson(row.allowed_modes, []),
      allowed_modules: safeJson(row.allowed_modules, []),
      requires_approval_for: safeJson(row.requires_approval_for, []),
      default_safety_policy: safeJson(row.default_safety_policy, {}),
      metrics: safeJson(row.metrics, {})
    }));
  }

  async createAgent(user, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const { agentId, displayName, role, version = 'v1', description = null, allowedTools = [], allowedEnvs = [], allowedModes = [], allowedModules = [], requiresApprovalFor = [], defaultSafetyPolicy = {}, status = 'online' } = data;
    if (!agentId || !displayName || !role) throw new Error('agentId/displayName/role 不能为空');
    const [existing] = await pool.execute('SELECT id FROM agent_registry WHERE agent_id = ?', [agentId]);
    if (existing.length > 0) throw new Error(`agent_id 已存在: ${agentId}`);
    await pool.execute(
      `INSERT INTO agent_registry (agent_id, display_name, role, version, description, allowed_tools, allowed_envs, allowed_modes, allowed_modules, requires_approval_for, default_safety_policy, status, metrics)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [agentId, displayName, role, version, description,
       jsonValue(allowedTools), jsonValue(allowedEnvs), jsonValue(allowedModes), jsonValue(allowedModules),
       jsonValue(requiresApprovalFor), jsonValue(defaultSafetyPolicy), status, jsonValue({})]
    );
    return this.getAgent(agentId);
  }

  async getAgent(agentId) {
    const [rows] = await pool.execute('SELECT * FROM agent_registry WHERE agent_id = ? AND deleted_at IS NULL', [agentId]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      ...row,
      allowed_tools: safeJson(row.allowed_tools, []),
      allowed_envs: safeJson(row.allowed_envs, []),
      allowed_modes: safeJson(row.allowed_modes, []),
      allowed_modules: safeJson(row.allowed_modules, []),
      requires_approval_for: safeJson(row.requires_approval_for, []),
      default_safety_policy: safeJson(row.default_safety_policy, {}),
      metrics: safeJson(row.metrics, {})
    };
  }

  async updateAgent(user, agentId, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const agent = await this.getAgent(agentId);
    if (!agent) throw new Error('Agent 不存在');
    const fields = [];
    const params = [];
    const map = {
      displayName: 'display_name',
      role: 'role',
      version: 'version',
      description: 'description',
      status: 'status'
    };
    Object.keys(map).forEach(k => {
      if (data[k] !== undefined) { fields.push(`${map[k]} = ?`); params.push(data[k]); }
    });
    const jsonMap = {
      allowedTools: 'allowed_tools',
      allowedEnvs: 'allowed_envs',
      allowedModes: 'allowed_modes',
      allowedModules: 'allowed_modules',
      requiresApprovalFor: 'requires_approval_for',
      defaultSafetyPolicy: 'default_safety_policy',
      metrics: 'metrics'
    };
    Object.keys(jsonMap).forEach(k => {
      if (data[k] !== undefined) { fields.push(`${jsonMap[k]} = ?`); params.push(jsonValue(data[k])); }
    });
    if (fields.length === 0) return agent;
    params.push(agentId);
    await pool.execute(`UPDATE agent_registry SET ${fields.join(', ')} WHERE agent_id = ?`, params);
    return this.getAgent(agentId);
  }

  async deleteAgent(user, agentId) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const agent = await this.getAgent(agentId);
    if (!agent) throw new Error('Agent 不存在');
    await pool.execute('UPDATE agent_registry SET deleted_at = NOW(), status = ? WHERE agent_id = ?', ['offline', agentId]);
    return { softDeleted: true, agentId };
  }

  // ========== env_resource CRUD ==========
  async listResources({ includeInactive = false } = {}) {
    const where = 'WHERE deleted_at IS NULL';
    const [rows] = await pool.query(`SELECT * FROM env_resource ${where} ORDER BY id ASC`);
    return rows.map(row => this._mapResourceRow(row));
  }

  _mapResourceRow(row) {
    return {
      ...row,
      capabilities: safeJson(row.capabilities, []),
      supported_chip_versions: safeJson(row.supported_chip_versions, []),
      supported_modules: safeJson(row.supported_modules, []),
      connection_profiles: safeJson(row.connection_profiles, {}),
      metadata: safeJson(row.metadata, {})
    };
  }

  async createResource(user, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const { resourceId, displayName, resourceType, capabilities = [], supportedChipVersions = [], supportedModules = [], connectionProfiles = {}, riskLevel = 'high' } = data;
    if (!resourceId || !displayName || !resourceType) throw new Error('resourceId/displayName/resourceType 不能为空');
    const [existing] = await pool.execute('SELECT id FROM env_resource WHERE resource_id = ?', [resourceId]);
    if (existing.length > 0) throw new Error(`resource_id 已存在: ${resourceId}`);
    await pool.execute(
      `INSERT INTO env_resource (resource_id, resource_type, display_name, status, capabilities, supported_chip_versions, supported_modules, connection_profiles, risk_level)
       VALUES (?, ?, ?, 'idle', ?, ?, ?, ?, ?)`,
      [resourceId, resourceType, displayName, jsonValue(capabilities), jsonValue(supportedChipVersions), jsonValue(supportedModules), jsonValue(connectionProfiles), riskLevel]
    );
    return this.getResource(resourceId);
  }

  async getResource(resourceId) {
    const [rows] = await pool.execute('SELECT * FROM env_resource WHERE resource_id = ? AND deleted_at IS NULL', [resourceId]);
    if (rows.length === 0) return null;
    return this._mapResourceRow(rows[0]);
  }

  async updateResource(user, resourceId, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const resource = await this.getResource(resourceId);
    if (!resource) throw new Error('资源不存在');
    const fields = [];
    const params = [];
    const map = {
      displayName: 'display_name',
      resourceType: 'resource_type',
      status: 'status',
      riskLevel: 'risk_level'
    };
    Object.keys(map).forEach(k => {
      if (data[k] !== undefined) { fields.push(`${map[k]} = ?`); params.push(data[k]); }
    });
    const jsonMap = {
      capabilities: 'capabilities',
      supportedChipVersions: 'supported_chip_versions',
      supportedModules: 'supported_modules',
      connectionProfiles: 'connection_profiles'
    };
    Object.keys(jsonMap).forEach(k => {
      if (data[k] !== undefined) { fields.push(`${jsonMap[k]} = ?`); params.push(jsonValue(data[k])); }
    });
    if (fields.length === 0) return resource;
    params.push(resourceId);
    await pool.execute(`UPDATE env_resource SET ${fields.join(', ')} WHERE resource_id = ?`, params);
    return this.getResource(resourceId);
  }

  async deleteResource(user, resourceId) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const resource = await this.getResource(resourceId);
    if (!resource) throw new Error('资源不存在');
    const [activeLeases] = await pool.execute(
      "SELECT lease_id FROM env_resource_lease WHERE resource_id = ? AND lease_status = 'active'",
      [resourceId]
    );
    if (activeLeases.length > 0) throw new Error(`资源有 ${activeLeases.length} 个活跃 Lease,无法删除`);
    await pool.execute('UPDATE env_resource SET deleted_at = NOW(), status = ? WHERE resource_id = ?', ['retired', resourceId]);
    return { softDeleted: true, resourceId };
  }

  validCategories() {
    return VALID_CATEGORIES;
  }
}

module.exports = new AgentCatalogService();
