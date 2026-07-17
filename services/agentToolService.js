const pool = require('../db');
const { isAdmin } = require('../middleware');
const { safeJson, jsonValue, parsePositiveInt } = require('./agentUtils');
const { spawn } = require('child_process');
const axios = require('axios');
const http = require('http');
const url = require('url');
const net = require('net');
const logger = require('./logger');

const VALID_INVOCATION_TYPES = ['script', 'http', 'cli', 'builtin'];
const VALID_LANGUAGES = ['javascript', 'python', 'shell', 'none'];
const VALID_STATUSES = ['active', 'inactive', 'maintenance'];

function mapTool(row) {
  if (!row) return null;
  return {
    ...row,
    input_schema: safeJson(row.input_schema, null),
    output_schema: safeJson(row.output_schema, null),
    auth_config: safeJson(row.auth_config, null),
    tags: safeJson(row.tags, []),
    metadata: safeJson(row.metadata, {}),
    proxy_config: safeJson(row.proxy_config, null)
  };
}

class AgentToolService {
  async listTools(filters = {}) {
    const conditions = ['deleted_at IS NULL'];
    const params = [];
    if (filters.invocationType) {
      conditions.push('invocation_type = ?');
      params.push(filters.invocationType);
    }
    if (filters.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    } else if (!filters.includeInactive) {
      conditions.push("status = 'active'");
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await pool.execute(
      `SELECT * FROM agent_tool_registry ${where} ORDER BY category ASC, tool_id ASC`,
      params
    );
    return rows.map(mapTool);
  }

  async getTool(toolId) {
    const [rows] = await pool.execute(
      'SELECT * FROM agent_tool_registry WHERE tool_id = ? AND deleted_at IS NULL LIMIT 1',
      [toolId]
    );
    return mapTool(rows[0]);
  }

  async createTool(user, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const toolId = data.toolId || data.tool_id;
    if (!toolId) throw new Error('toolId 不能为空');
    if (!data.displayName && !data.display_name) throw new Error('displayName 不能为空');
    const invocationType = data.invocationType || data.invocation_type || 'builtin';
    if (!VALID_INVOCATION_TYPES.includes(invocationType)) {
      throw new Error(`invocationType 必须是 ${VALID_INVOCATION_TYPES.join('/')}`);
    }
    const language = data.language || 'none';
    if (!VALID_LANGUAGES.includes(language)) {
      throw new Error(`language 必须是 ${VALID_LANGUAGES.join('/')}`);
    }
    const status = data.status || 'active';
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`status 必须是 ${VALID_STATUSES.join('/')}`);
    }
    const [existing] = await pool.execute(
      'SELECT id FROM agent_tool_registry WHERE tool_id = ? AND deleted_at IS NULL',
      [toolId]
    );
    if (existing.length > 0) throw new Error(`tool_id 已存在: ${toolId}`);
    await pool.execute(
      `INSERT INTO agent_tool_registry
       (tool_id, display_name, description, version, category, invocation_type, entry_point, language,
        code_content, input_schema, output_schema, auth_config, timeout_ms, max_memory_mb, tags, metadata, proxy_config, status, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        toolId,
        data.displayName || data.display_name,
        data.description || null,
        data.version || 'v1',
        data.category || null,
        invocationType,
        data.entryPoint || data.entry_point || null,
        language,
        data.codeContent || data.code_content || null,
        jsonValue(data.inputSchema || data.input_schema || null),
        jsonValue(data.outputSchema || data.output_schema || null),
        jsonValue(data.authConfig || data.auth_config || null),
        parsePositiveInt(data.timeoutMs || data.timeout_ms, 30000),
        parsePositiveInt(data.maxMemoryMb || data.max_memory_mb, 256),
        jsonValue(data.tags || []),
        jsonValue(data.metadata || {}),
        jsonValue(data.proxyConfig || data.proxy_config || null),
        status,
        user.id
      ]
    );
    return this.getTool(toolId);
  }

  async updateTool(user, toolId, data) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const tool = await this.getTool(toolId);
    if (!tool) throw new Error('工具不存在');
    const fields = [];
    const params = [];
    const scalarMap = {
      displayName: 'display_name',
      description: 'description',
      version: 'version',
      category: 'category',
      entryPoint: 'entry_point',
      language: 'language',
      codeContent: 'code_content',
      timeoutMs: 'timeout_ms',
      maxMemoryMb: 'max_memory_mb',
      status: 'status'
    };
    Object.keys(scalarMap).forEach(k => {
      if (data[k] !== undefined) {
        if (k === 'language' && !VALID_LANGUAGES.includes(data[k])) {
          throw new Error(`language 必须是 ${VALID_LANGUAGES.join('/')}`);
        }
        if (k === 'status' && !VALID_STATUSES.includes(data[k])) {
          throw new Error(`status 必须是 ${VALID_STATUSES.join('/')}`);
        }
        fields.push(`${scalarMap[k]} = ?`);
        params.push(data[k]);
      }
    });
    if (data.invocationType || data.invocation_type) {
      const v = data.invocationType || data.invocation_type;
      if (!VALID_INVOCATION_TYPES.includes(v)) {
        throw new Error(`invocationType 必须是 ${VALID_INVOCATION_TYPES.join('/')}`);
      }
      fields.push('invocation_type = ?');
      params.push(v);
    }
    const jsonMap = {
      inputSchema: 'input_schema',
      outputSchema: 'output_schema',
      authConfig: 'auth_config',
      tags: 'tags',
      metadata: 'metadata',
      proxyConfig: 'proxy_config'
    };
    Object.keys(jsonMap).forEach(k => {
      if (data[k] !== undefined) {
        fields.push(`${jsonMap[k]} = ?`);
        params.push(jsonValue(data[k]));
      }
    });
    if (fields.length === 0) return tool;
    params.push(toolId);
    await pool.execute(
      `UPDATE agent_tool_registry SET ${fields.join(', ')} WHERE tool_id = ?`,
      params
    );
    return this.getTool(toolId);
  }

  async deleteTool(user, toolId, { hard = false } = {}) {
    if (!isAdmin(user)) throw new Error('需要管理员权限');
    const tool = await this.getTool(toolId);
    if (!tool) throw new Error('工具不存在');
    if (hard) {
      await pool.execute('DELETE FROM agent_tool_registry WHERE tool_id = ?', [toolId]);
      return { hardDeleted: true, toolId };
    }
    await pool.execute(
      'UPDATE agent_tool_registry SET deleted_at = NOW(), status = ? WHERE tool_id = ?',
      ['inactive', toolId]
    );
    return { softDeleted: true, toolId };
  }

  /**
   * 调用工具（支持 HTTP 类型 + SSH 跳板机隧道）
   * @param {string} toolId - 工具ID
   * @param {Object} params - 调用参数 { api_name, ...args }
   * @param {Object} options - { proxyOverride } 可覆盖跳板机配置
   */
  async invokeTool(toolId, params = {}, options = {}) {
    const tool = await this.getTool(toolId);
    if (!tool) throw new Error('工具不存在');
    if (tool.status !== 'active') throw new Error(`工具状态为 ${tool.status}，无法调用`);
    if (tool.invocation_type !== 'http') {
      throw new Error(`仅支持 HTTP 类型工具调用，当前类型: ${tool.invocation_type}`);
    }
    if (!tool.entry_point) throw new Error('工具未配置 entry_point');

    // 解析跳板机配置：优先 options.proxyOverride，其次 tool.proxy_config，最后 tool.metadata.proxy
    const proxyConfig = options.proxyOverride || tool.proxy_config || (tool.metadata && tool.metadata.proxy) || null;
    const targetUrl = new URL(tool.entry_point);
    const targetHost = targetUrl.hostname;
    const targetPort = parseInt(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);

    if (proxyConfig && proxyConfig.jump_host) {
      // === 跳板机模式：建立 SSH 隧道后通过本地端口转发 ===
      return this._invokeViaSshTunnel(tool, params, proxyConfig, targetUrl);
    } else {
      // === 直连模式：直接发起 HTTP 请求 ===
      return this._invokeDirect(tool, params, targetUrl);
    }
  }

  /**
   * 直连模式：直接对 entry_point 发起 HTTP 请求
   */
  async _invokeDirect(tool, params, targetUrl) {
    const apiName = params.api_name || params.apiName || '';
    const requestPath = apiName ? `/api/${apiName}` : targetUrl.pathname;
    const requestUrl = targetUrl.origin + requestPath;
    return this._doHttpRequest(tool, requestUrl, params);
  }

  /**
   * 跳板机模式：通过 SSH 端口转发建立隧道，再通过本地端口发起 HTTP 请求
   * 原理: ssh -L localPort:targetHost:targetPort jumpUser@jumpHost -N
   */
  async _invokeViaSshTunnel(tool, params, proxy, targetUrl) {
    const targetHost = targetUrl.hostname;
    const targetPort = parseInt(targetUrl.port) || (targetUrl.protocol === 'https:' ? 443 : 80);
    const jumpHost = proxy.jump_host;
    const jumpPort = proxy.jump_port || 22;
    const jumpUser = proxy.jump_username || process.env.SSH_JUMP_USERNAME || 'root';
    const jumpKey = proxy.jump_key_path || process.env.SSH_JUMP_KEY_PATH || null;
    const jumpPassword = proxy.jump_password || null;

    // 找一个可用的本地端口
    const localPort = await this._findFreePort(18000, 18999);
    const sshArgs = [
      '-L', `${localPort}:${targetHost}:${targetPort}`,
      '-N', '-o', 'StrictHostKeyChecking=no',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ConnectTimeout=10',
      '-p', String(jumpPort),
    ];
    if (jumpKey) {
      sshArgs.push('-i', jumpKey);
    }
    sshArgs.push(`${jumpUser}@${jumpHost}`);

    logger.info(`[ToolProxy] 建立 SSH 隧道: localhost:${localPort} -> ${jumpHost} -> ${targetHost}:${targetPort}`);

    // 启动 SSH 隧道子进程
    const sshProc = spawn('ssh', sshArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let sshReady = false;
    let sshError = '';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!sshReady) {
          sshProc.kill('SIGTERM');
          reject(new Error(`SSH 隧道建立超时: ${sshError || '未知原因'}`));
        }
      }, 15000);

      sshProc.stderr.on('data', (data) => {
        const msg = data.toString();
        // SSH 隧道就绪的标志：stderr 中不再报错，且进程仍在运行
        if (msg.includes('remote forwarding') || msg.includes('Listening') || (!sshReady && !msg.includes('Error') && !msg.includes('error'))) {
          // 等待一小段时间确保隧道建立
          if (!sshReady) {
            setTimeout(async () => {
              sshReady = true;
              clearTimeout(timeout);
              try {
                // 通过本地端口发起 HTTP 请求
                const localUrl = `http://127.0.0.1:${localPort}`;
                const apiName = params.api_name || params.apiName || '';
                const requestUrl = localUrl + (apiName ? `/api/${apiName}` : '');
                const result = await this._doHttpRequest(tool, requestUrl, params);
                sshProc.kill('SIGTERM');
                resolve(result);
              } catch (err) {
                sshProc.kill('SIGTERM');
                reject(new Error(`通过隧道调用失败: ${err.message}`));
              }
            }, 1000);
          }
        }
        if (msg.includes('error') || msg.includes('Error') || msg.includes('refused') || msg.includes('denied')) {
          sshError = msg.trim();
        }
      });

      sshProc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`SSH 隧道启动失败: ${err.message}. 请确认系统已安装 ssh 客户端`));
      });

      sshProc.on('exit', (code) => {
        clearTimeout(timeout);
        if (!sshReady && code !== 0) {
          reject(new Error(`SSH 隧道建立失败 (exit=${code}): ${sshError}`));
        }
      });
    });
  }

  /**
   * 执行 HTTP 请求（带认证）
   */
  async _doHttpRequest(tool, baseUrl, params) {
    const timeout = tool.timeout_ms || 30000;
    const headers = { 'Content-Type': 'application/json' };

    // 认证配置
    if (tool.auth_config) {
      const auth = typeof tool.auth_config === 'string' ? JSON.parse(tool.auth_config) : tool.auth_config;
      if (auth.type === 'bearer' && auth.token) {
        headers['Authorization'] = `Bearer ${auth.token}`;
      } else if (auth.type === 'header' && auth.header_name && auth.header_value) {
        headers[auth.header_name] = auth.header_value;
      } else if (auth.type === 'basic' && auth.username && auth.password) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      }
    }

    const method = params._method || 'POST';
    const body = params._method === 'GET' ? undefined : { ...params };
    delete body._method;
    delete body.api_name;
    delete body.apiName;

    const response = await axios({
      method,
      url: baseUrl,
      headers,
      data: body,
      timeout,
      validateStatus: () => true, // 不抛异常，返回原始状态码
    });

    return {
      status: response.status,
      data: response.data,
      success: response.status >= 200 && response.status < 300,
    };
  }

  /**
   * 查找可用本地端口
   */
  _findFreePort(start, end) {
    return new Promise((resolve) => {
      const tryPort = (port) => {
        if (port > end) { resolve(0); return; }
        const server = net.createServer();
        server.listen(port, '127.0.0.1', () => {
          server.close(() => resolve(port));
        });
        server.on('error', () => tryPort(port + 1));
      };
      tryPort(start);
    });
  }

  /**
   * 测试工具连通性（不调用实际 API，仅验证 entry_point 或 SSH 隧道是否可达）
   */
  async testConnection(toolId) {
    const tool = await this.getTool(toolId);
    if (!tool) throw new Error('工具不存在');
    if (tool.invocation_type !== 'http') {
      return { reachable: true, message: `非 HTTP 工具 (${tool.invocation_type})，跳过连通性测试` };
    }
    const proxyConfig = tool.proxy_config || (tool.metadata && tool.metadata.proxy) || null;
    if (proxyConfig && proxyConfig.jump_host) {
      // 测试 SSH 隧道可达性
      try {
        const localPort = await this._findFreePort(19000, 19999);
        const targetUrl = new URL(tool.entry_point);
        const targetHost = targetUrl.hostname;
        const targetPort = parseInt(targetUrl.port) || 80;
        const result = await new Promise((resolve, reject) => {
          const sshArgs = [
            '-L', `${localPort}:${targetHost}:${targetPort}`,
            '-N', '-o', 'StrictHostKeyChecking=no',
            '-o', 'ExitOnForwardFailure=yes',
            '-o', 'ConnectTimeout=10',
            '-p', String(proxyConfig.jump_port || 22),
          ];
          if (proxyConfig.jump_key_path) sshArgs.push('-i', proxyConfig.jump_key_path);
          sshArgs.push(`${proxyConfig.jump_username || 'root'}@${proxyConfig.jump_host}`);
          const proc = spawn('ssh', sshArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
          const timeout = setTimeout(() => { proc.kill(); resolve({ ok: true, message: `SSH 隧道可建立 (localhost:${localPort} -> ${proxyConfig.jump_host} -> ${targetHost}:${targetPort})` }); }, 3000);
          proc.on('error', (err) => { clearTimeout(timeout); reject(new Error(`SSH 启动失败: ${err.message}`)); });
          proc.stderr.on('data', (d) => { if (d.toString().includes('error') || d.toString().includes('refused')) { clearTimeout(timeout); proc.kill(); reject(new Error(d.toString().trim())); } });
        });
        return { reachable: true, ...result };
      } catch (err) {
        return { reachable: false, message: err.message };
      }
    } else {
      // 直连模式：发 HEAD 请求
      try {
        const resp = await axios.head(tool.entry_point, { timeout: 5000, validateStatus: () => true });
        return { reachable: resp.status < 500, message: `HTTP ${resp.status}` };
      } catch (err) {
        return { reachable: false, message: err.message };
      }
    }
  }
}

module.exports = new AgentToolService();
