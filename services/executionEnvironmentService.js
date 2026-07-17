const pool = require('../db');
const { normalizeRunnerUrl } = require('./urlSecurity');

function toNullableInt(value) {
  if (value === null || value === undefined || value === '' || value === 'null') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

class ExecutionEnvironmentService {
  async list(options = {}) {
    const includeInactive = options.includeInactive === true || options.includeInactive === 'true';
    const [rows] = await pool.execute(
      `SELECT * FROM execution_environments ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY id ASC`
    );
    return rows;
  }

  async getById(id) {
    const envId = toNullableInt(id);
    if (!envId) return null;
    const [rows] = await pool.execute('SELECT * FROM execution_environments WHERE id = ?', [envId]);
    return rows[0] || null;
  }

  async getByKey(key) {
    if (!key) return null;
    const [rows] = await pool.execute('SELECT * FROM execution_environments WHERE env_key = ?', [String(key)]);
    return rows[0] || null;
  }

  async create(data) {
    const envKey = String(data.envKey || data.env_key || '').trim();
    const name = String(data.name || '').trim();
    if (!envKey || !name) throw new Error('缺少执行环境标识或名称');
    const [result] = await pool.execute(
      `INSERT INTO execution_environments
        (env_key, name, env_type, runner_url, default_timeout_sec, description, metadata, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        envKey,
        name,
        data.envType || data.env_type || null,
        normalizeRunnerUrl(data.runnerUrl || data.runner_url),
        toNullableInt(data.defaultTimeoutSec || data.default_timeout_sec) || 300,
        data.description || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.isActive === false || data.is_active === 0 ? 0 : 1
      ]
    );
    return { id: result.insertId };
  }

  async update(id, data) {
    const envId = toNullableInt(id);
    if (!envId) throw new Error('无效执行环境ID');
    const fields = [];
    const params = [];
    const map = {
      envKey: 'env_key',
      env_key: 'env_key',
      name: 'name',
      envType: 'env_type',
      env_type: 'env_type',
      runnerUrl: 'runner_url',
      runner_url: 'runner_url',
      defaultTimeoutSec: 'default_timeout_sec',
      default_timeout_sec: 'default_timeout_sec',
      description: 'description',
      metadata: 'metadata',
      isActive: 'is_active',
      is_active: 'is_active'
    };
    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      fields.push(`${column} = ?`);
      if (column === 'default_timeout_sec') params.push(toNullableInt(data[key]) || 300);
      else if (column === 'runner_url') params.push(normalizeRunnerUrl(data[key]));
      else if (column === 'metadata') params.push(data[key] ? JSON.stringify(data[key]) : null);
      else if (column === 'is_active') params.push(data[key] === false || data[key] === 0 ? 0 : 1);
      else params.push(data[key]);
    }
    if (fields.length === 0) return { id: envId, changed: false };
    params.push(envId);
    await pool.execute(`UPDATE execution_environments SET ${fields.join(', ')} WHERE id = ?`, params);
    return { id: envId, changed: true };
  }
}

module.exports = new ExecutionEnvironmentService();
