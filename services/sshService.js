/**
 * CTA SSH 服务单例
 * 封装 Python ssh_cli_bridge.py 调用，提供 executeCommand/reconnect 接口
 * 供 deepTestService、crossValidationService、agentErrorHandler 注入使用
 */
const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const logger = require('./logger');

const execFileAsync = util.promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'cta_extensions', 'ssh_cli_bridge.py');
// 优先使用项目内置 venv，其次环境变量，最后系统 python3
const VENV_PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python');
const fs = require('fs');
const PYTHON_BIN = (() => {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return process.env.SSH_PYTHON || 'python3';
})();
const DEFAULT_TIMEOUT = parseInt(process.env.SSH_COMMAND_TIMEOUT_MS || '30000', 10);

class SshService {
  /**
   * 在指定 SSH 会话上执行命令
   * @param {string} command - 要执行的命令
   * @param {Object} options - { timeout, sessionId }
   * @returns {Promise<{stdout, stderr, exitCode, status}>}
   */
  async executeCommand(command, options = {}) {
    const { timeout = DEFAULT_TIMEOUT / 1000, sessionId } = options;
    if (!sessionId) {
      throw new Error('SSH executeCommand 缺少 sessionId');
    }
    const input = JSON.stringify({
      action: 'execute',
      session_id: sessionId,
      command,
      timeout: typeof timeout === 'number' && timeout > 100 ? Math.floor(timeout / 1000) : timeout
    });
    const timeoutMs = (typeof timeout === 'number' && timeout > 100 ? timeout : timeout * 1000) + 10000;
    try {
      const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
        input, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
      });
      const result = JSON.parse(stdout);
      if (result.status !== 'success') {
        const err = new Error(result.error || 'SSH 命令执行失败');
        err.code = result.error_type === 'connection_lost' ? 'ECONNRESET' : 'SSH_ERROR';
        err.error_type = result.error_type;
        throw err;
      }
      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exit_code ?? 0,
        output: result.stdout || '',
        status: 'success'
      };
    } catch (error) {
      logger.error('[SshService] executeCommand 失败', { sessionId, error: error.message });
      throw error;
    }
  }

  /**
   * 重连 SSH 会话
   * @param {string} sessionId - 会话ID
   * @returns {Promise<{status}>}
   */
  async reconnect(sessionId) {
    const input = JSON.stringify({ action: 'reconnect', session_id: sessionId });
    try {
      const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
        input, timeout: 60000, maxBuffer: 2 * 1024 * 1024,
      });
      const result = JSON.parse(stdout);
      if (result.status !== 'success') {
        throw new Error(result.error || 'SSH 重连失败');
      }
      logger.info('[SshService] SSH 重连成功', { sessionId });
      return { status: 'success', sessionId };
    } catch (error) {
      logger.error('[SshService] SSH 重连失败', { sessionId, error: error.message });
      throw error;
    }
  }

  /**
   * 创建 SSH 会话
   * @param {Object} config - { host, port, username, password, key_path, device_type,
   *   jump_host, jump_port, jump_username, jump_password, jump_key_path }
   * @returns {Promise<{sessionId, status}>}
   */
  async createSession(config = {}) {
    const { host, port = 22, username, password, key_path, device_type = 'generic',
            jump_host, jump_port = 22, jump_username, jump_password, jump_key_path } = config;
    if (!host || !username) throw new Error('host 和 username 不能为空');
    const payload = { action: 'create_session', host, port, username, password, key_path, device_type };
    // 跳板机参数透传
    if (jump_host) {
      payload.jump_host = jump_host;
      payload.jump_port = jump_port;
      payload.jump_username = jump_username || username;
      if (jump_password) payload.jump_password = jump_password;
      if (jump_key_path) payload.jump_key_path = jump_key_path;
    }
    const input = JSON.stringify(payload);
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
      input, timeout: 60000, maxBuffer: 2 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (result.status !== 'success') {
      throw new Error(result.error || 'SSH 连接失败');
    }
    return { sessionId: result.session_id, status: 'success' };
  }

  /**
   * 关闭 SSH 会话
   * @param {string} sessionId
   */
  async closeSession(sessionId) {
    const input = JSON.stringify({ action: 'close_session', session_id: sessionId });
    try {
      await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
        input, timeout: 10000, maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      logger.warn('[SshService] 关闭会话失败', { sessionId, error: error.message });
    }
  }
}

module.exports = new SshService();
module.exports.SshService = SshService;
