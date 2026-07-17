const fs = require('fs').promises;
const path = require('path');
const pool = require('../db');
const axios = require('axios');
const executionGateService = require('./executionGateService');
const agentConsoleService = require('./agentConsoleService');
const { jsonValue, safeJson, newId, safePathSegment, resolveInsideRoot } = require('./agentUtils');

const ARTIFACT_ROOT = process.env.AGENT_ARTIFACT_DIR || path.join(__dirname, '..', 'uploads', 'agent-artifacts');
const DESTRUCTIVE_PATTERNS = [/\breset\s+chip\b/i, /\berase\s+flash\b/i, /\breboot\s+board\b/i, /\bfactory\s+reset\b/i];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

class SdkCliToolService {
  _assertCommandSafe(command, safetyPolicy = {}) {
    const denylist = safetyPolicy.denylist || [];
    const cmd = String(command || '').trim();
    if (!cmd) throw new Error('CLI命令不能为空');
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(cmd)) throw new Error('命令命中破坏性操作禁止规则');
    }
    for (const denied of denylist) {
      if (cmd.toLowerCase().includes(String(denied).toLowerCase())) {
        throw new Error(`命令命中denylist: ${denied}`);
      }
    }
    return cmd;
  }

  async openSession(user, data = {}) {
    const mode = String(data.mode || 'dry_run').toLowerCase();
    const gate = await executionGateService.checkAction({
      user,
      taskId: data.taskId || data.task_id,
      leaseId: data.leaseId || data.lease_id,
      action: 'open_session',
      mode,
      payload: data
    });
    if (!gate.allowed) {
      return { status: 'rejected', reason: gate.reason, message: 'Execution gate rejected this CLI session action.' };
    }
    const sessionId = safePathSegment(data.sessionId || data.session_id || newId('SDKCLI'));
    const prompt = data.prompt || 'sdk-cli>';
    const metadata = {
      target_env: data.targetEnv || data.target_env || null,
      connection_profile: data.connectionProfile || data.connection_profile || {},
      sdk_branch: data.sdkBranch || data.sdk_branch || null,
      sdk_version: data.sdkVersion || data.sdk_version || 'unknown',
      mode
    };
    if (data.agentSessionId || data.agent_session_id) {
      await agentConsoleService.getSession(user, data.agentSessionId || data.agent_session_id);
      await agentConsoleService.emitEvent({
        sessionId: data.agentSessionId || data.agent_session_id,
        taskId: data.taskId || data.task_id,
        eventType: 'CLI_SESSION_OPENED',
        senderAgent: 'sdk_cli_agent_v1',
        receiverAgent: 'traffic_agent_v1',
        phase: 'EXECUTE_CONFIG',
        payload: { sessionId, prompt, metadata }
      });
    }
    return { sessionId, session_id: sessionId, prompt, sdk_version: metadata.sdk_version, status: 'opened', metadata };
  }

  _parseOutput(command, stdout = '') {
    const lower = `${command}\n${stdout}`.toLowerCase();
    let parsedError = null;
    if (/unknown command|invalid|error|failed/.test(lower)) {
      parsedError = 'cli_command_error';
    }
    const counters = {};
    const counterMatches = stdout.matchAll(/([a-zA-Z0-9_]+)\s*[:=]\s*(\d+)/g);
    for (const match of counterMatches) {
      counters[match[1]] = Number(match[2]);
    }
    return { parsedError, counters, raw_length: stdout.length };
  }

  async runCommand(user, data = {}) {
    const mode = String(data.mode || 'dry_run').toLowerCase();
    const command = this._assertCommandSafe(data.command, data.safetyPolicy || data.safety_policy || {});
    const gate = await executionGateService.checkAction({
      user,
      taskId: data.taskId || data.task_id,
      leaseId: data.leaseId || data.lease_id,
      action: 'run_command',
      mode,
      payload: { ...data, command }
    });
    if (!gate.allowed) {
      return { status: 'rejected', reason: gate.reason, message: 'Execution gate rejected this CLI command.' };
    }
    const sessionId = safePathSegment(data.sessionId || data.session_id || 'standalone');
    const taskId = data.taskId || data.task_id ? safePathSegment(data.taskId || data.task_id) : null;
    const commandIndex = data.commandIndex || data.command_index || 1;

    // 连接路由：根据 resourceConnections.sdk_cli 的协议选择执行路径
    const resourceConnections = data.resourceConnections || {};
    const cliEndpoint = resourceConnections.sdk_cli || null;
    let stdout, stderr;

    if (cliEndpoint && mode !== 'dry_run' && mode !== 'generation') {
      const routeResult = await this._routeCliCommand(cliEndpoint, command, { sessionId, taskId, timeout: data.timeout || 30000 });
      stdout = routeResult.stdout;
      stderr = routeResult.stderr;
    } else {
      stdout = mode === 'dry_run' || mode === 'generation'
        ? `[dry-run] ${command}`
        : (data.mockStdout || data.stdout || `executed: ${command}`);
      stderr = data.stderr || '';
    }

    const parsed = this._parseOutput(command, stdout);
    const status = parsed.parsedError ? 'failed' : 'ok';
    const dir = resolveInsideRoot(ARTIFACT_ROOT, taskId || sessionId);
    await ensureDir(dir);
    const stdoutPath = path.join(dir, `cli_${Date.now()}_${commandIndex}.stdout.log`);
    const stderrPath = path.join(dir, `cli_${Date.now()}_${commandIndex}.stderr.log`);
    await fs.writeFile(stdoutPath, stdout);
    await fs.writeFile(stderrPath, stderr);
    await pool.execute(
      `INSERT INTO cli_command_trace
       (session_id, task_id, lease_id, command_index, command_text, stdout_path, stderr_path,
        parsed_result, status, error_signature, evidence_refs, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [sessionId, taskId, data.leaseId || data.lease_id || null, commandIndex, command, stdoutPath, stderrPath, jsonValue(parsed), status, parsed.parsedError, jsonValue(data.evidenceRefs || data.evidence_refs || [])]
    );
    if (data.agentSessionId || data.agent_session_id) {
      await agentConsoleService.getSession(user, data.agentSessionId || data.agent_session_id);
      await agentConsoleService.emitEvent({
        sessionId: data.agentSessionId || data.agent_session_id,
        taskId,
        eventType: status === 'ok' ? 'CLI_COMMAND_OK' : 'CONFIG_FAILED',
        senderAgent: 'sdk_cli_agent_v1',
        receiverAgent: 'traffic_agent_v1',
        phase: status === 'ok' ? 'EXECUTE_CONFIG' : 'diagnosing',
        payload: { command, status, parsed }
      });
    }
    return { sessionId, command, stdout, stderr, exit_status: status === 'ok' ? 0 : 1, parsed_error: parsed.parsedError, parsed_result: parsed, status, stdout_path: stdoutPath };
  }

  /**
   * 根据 connection_profiles URL 协议路由 CLI 命令执行
   * 支持协议: cmodel://, ssh://, http://
   */
  async _routeCliCommand(endpoint, command, options = {}) {
    const url = new URL(endpoint);
    const protocol = url.protocol.replace(':', '');

    switch (protocol) {
      case 'cmodel':
        return this._executeViaCmodel(endpoint, command, options);
      case 'ssh':
        return this._executeViaSsh(endpoint, command, options);
      case 'http':
      case 'https':
        return this._executeViaHttp(endpoint, command, options);
      default:
        throw new Error(`不支持的 CLI 连接协议: ${protocol}`);
    }
  }

  /**
   * cmodel:// 协议：通过 CModel REST API 执行命令
   * URL 格式: cmodel://instance01/sdk_cli → http://cmodel-host/api/cmodel/instance01/cli
   * 需要环境变量 CMODEL_API_BASE (默认 http://localhost:8080)
   */
  async _executeViaCmodel(endpoint, command, options = {}) {
    const apiBase = process.env.CMODEL_API_BASE || 'http://localhost:8080';
    // 解析 cmodel://instance01/sdk_cli → instance = instance01
    const url = new URL(endpoint);
    const instance = url.hostname;
    const api = `${apiBase}/api/cmodel/${instance}/cli`;
    try {
      const response = await axios.post(api, { command, session_id: options.sessionId }, { timeout: options.timeout || 30000 });
      return {
        stdout: response.data?.stdout || response.data?.output || '',
        stderr: response.data?.stderr || ''
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: `CModel CLI error: ${error.response?.data?.error || error.message}`
      };
    }
  }

  /**
   * ssh:// 协议：通过 SSH 执行命令（委托 sshService）
   * URL 格式: ssh://host:port → 建立SSH连接执行
   */
  async _executeViaSsh(endpoint, command, options = {}) {
    let sshService;
    try {
      sshService = require('./sshService');
    } catch {
      throw new Error('sshService 不可用，无法通过 SSH 执行命令');
    }
    const url = new URL(endpoint);
    const host = url.hostname;
    const port = url.port || 22;
    const sessionId = options.sessionId || `ssh-${host}`;
    const result = await sshService.executeCommand(command, { host, port: parseInt(port, 10), sessionId, timeout: options.timeout || 30000 });
    return {
      stdout: result.stdout || result.output || '',
      stderr: result.stderr || ''
    };
  }

  /**
   * http(s):// 协议：直接通过 HTTP POST 执行命令
   * 请求体: { command, session_id, task_id }
   */
  async _executeViaHttp(endpoint, command, options = {}) {
    try {
      const response = await axios.post(endpoint, {
        command,
        session_id: options.sessionId,
        task_id: options.taskId
      }, { timeout: options.timeout || 30000 });
      return {
        stdout: response.data?.stdout || response.data?.output || '',
        stderr: response.data?.stderr || ''
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: `HTTP CLI error: ${error.response?.data?.error || error.message}`
      };
    }
  }

  async runCommandBatch(user, data = {}) {
    const commands = Array.isArray(data.commands) ? data.commands : [];
    if (commands.length === 0) throw new Error('commands不能为空');
    const results = [];
    for (let i = 0; i < commands.length; i++) {
      const result = await this.runCommand(user, { ...data, command: commands[i], commandIndex: i + 1 });
      results.push(result);
      if (data.stopOnError !== false && result.status !== 'ok') break;
    }
    return { sessionId: data.sessionId || data.session_id || 'standalone', results, status: results.every(r => r.status === 'ok') ? 'ok' : 'failed' };
  }

  async snapshotState(user, data = {}) {
    const sessionId = safePathSegment(data.sessionId || data.session_id || 'standalone');
    const snapshotId = safePathSegment(newId('SNAP'));
    const taskSegment = data.taskId || data.task_id ? safePathSegment(data.taskId || data.task_id) : sessionId;
    const dir = resolveInsideRoot(ARTIFACT_ROOT, taskSegment);
    await ensureDir(dir);
    const snapshot = data.snapshot || { profile: data.snapshotProfile || data.snapshot_profile || {}, captured_at: new Date().toISOString() };
    const snapshotPath = path.join(dir, `${snapshotId}.json`);
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
    return { snapshotId, snapshot_id: snapshotId, snapshot_json_path: snapshotPath, snapshot };
  }

  _assertArtifactFile(filePath, taskId = null) {
    const rootPath = path.resolve(ARTIFACT_ROOT);
    const targetPath = path.resolve(String(filePath || ''));
    if (!targetPath.startsWith(rootPath + path.sep)) {
      throw new Error('非法快照路径');
    }
    if (taskId) {
      const taskRoot = resolveInsideRoot(ARTIFACT_ROOT, taskId);
      if (!targetPath.startsWith(taskRoot + path.sep)) {
        throw new Error('快照不属于当前任务');
      }
    }
    return targetPath;
  }

  async diffSnapshot(user, data = {}) {
    const taskId = data.taskId || data.task_id;
    if (!taskId) throw new Error('taskId不能为空');
    const gate = await executionGateService.checkAction({ user, taskId, action: 'diff_snapshot', mode: data.mode || 'dry_run' });
    if (!gate.allowed) throw new Error(gate.reason || '无权访问该任务');
    const beforePath = this._assertArtifactFile(data.beforeSnapshotPath || data.before_snapshot_path, taskId);
    const afterPath = this._assertArtifactFile(data.afterSnapshotPath || data.after_snapshot_path, taskId);
    const before = safeJson(await fs.readFile(beforePath, 'utf-8').catch(() => '{}'), {});
    const after = safeJson(await fs.readFile(afterPath, 'utf-8').catch(() => '{}'), {});
    const changed = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changed.push({ key, before: before[key], after: after[key] });
      }
    }
    return { changed, status: changed.length ? 'changed' : 'same' };
  }

  async queryCounter(user, data = {}) {
    const spec = data.counterSpec || data.counter_spec || {};
    const command = spec.command || `show counter ${spec.port || ''}`.trim();
    const result = await this.runCommand(user, { ...data, command, mode: data.mode || 'dry_run' });
    return { command, counter_values: result.parsed_result.counters || {}, raw: result.stdout };
  }

  async generateRollback(stateDiff = {}) {
    const changed = stateDiff.changed || [];
    const rollbackCommands = changed.map(item => `# rollback ${item.key} to ${JSON.stringify(item.before)}`);
    return { rollback_commands: rollbackCommands, status: rollbackCommands.length ? 'generated' : 'empty' };
  }

  async closeSession(data = {}) {
    return { sessionId: data.sessionId || data.session_id, close_status: 'closed' };
  }
}

module.exports = new SdkCliToolService();
