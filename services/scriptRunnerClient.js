const axios = require('axios');
const logger = require('./logger');
const executionEnvironmentService = require('./executionEnvironmentService');
const { validateRunnerUrl } = require('./urlSecurity');

class ScriptRunnerClient {
  constructor() {
    this.agentUrl = process.env.SCRIPT_RUNNER_URL || null;
    this.enabled = !!this.agentUrl;
  }

  async _resolveEnvironment(options = {}) {
    let env = null;
    if (options.executionEnvId) {
      env = await executionEnvironmentService.getById(options.executionEnvId).catch(() => null);
    }
    if (!env && options.executionEnvKey) {
      env = await executionEnvironmentService.getByKey(options.executionEnvKey).catch(() => null);
    }
    return env;
  }

  _buildUrl(agentUrl, pathname) {
    validateRunnerUrl(agentUrl);
    return `${String(agentUrl).replace(/\/+$/, '')}${pathname}`;
  }

  async execute(tclContent, options = {}) {
    const env = await this._resolveEnvironment(options);
    const agentUrl = env?.runner_url || this.agentUrl;
    const timeout = options.timeout || env?.default_timeout_sec || 300;

    if (!agentUrl) {
      return { status: 'skipped', reason: 'ScriptRunner Agent未配置', execution_env_id: env?.id || null };
    }

    try {
      const taskId = options.taskId || `tcl_${Date.now()}`;
      const response = await axios.post(this._buildUrl(agentUrl, '/api/runner/execute'), {
        task_id: taskId,
        script_content: tclContent,
        target_device: options.targetDevice || null,
        timeout,
        execution_env_id: env?.id || options.executionEnvId || null,
        execution_env_key: env?.env_key || options.executionEnvKey || null,
        env_vars: options.envVars || {},
        options: options.options || {}
      }, {
        timeout: timeout * 1000 + 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      const result = response.data || {};
      return {
        task_id: result.task_id || taskId,
        status: result.status || 'unknown',
        exit_code: result.exit_code ?? null,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        execution_time: result.execution_time ?? null,
        execution_env_id: env?.id || options.executionEnvId || null,
        execution_env_key: env?.env_key || options.executionEnvKey || null,
        timestamp: result.timestamp || new Date().toISOString()
      };
    } catch (error) {
      const status = error.response?.status;
      const message = status ? `HTTP ${status}: ${error.response?.statusText || error.message}` : error.message;
      logger.error('ScriptRunner执行请求失败', { error: message });
      return { status: 'error', error: message, execution_env_id: env?.id || options.executionEnvId || null };
    }
  }

  async healthCheck(options = {}) {
    const env = await this._resolveEnvironment(options);
    const agentUrl = env?.runner_url || this.agentUrl;
    if (!agentUrl) {
      return { status: 'disabled', execution_env_id: env?.id || null };
    }

    try {
      const response = await axios.get(this._buildUrl(agentUrl, '/api/runner/health'), { timeout: 5000 });
      return { status: 'healthy', execution_env_id: env?.id || null, ...(response.data || {}) };
    } catch (error) {
      const status = error.response?.status;
      const message = status ? `HTTP ${status}: ${error.response?.statusText || error.message}` : error.message;
      logger.error('ScriptRunner健康检查失败', { error: message });
      return { status: 'unreachable', error: message, execution_env_id: env?.id || null };
    }
  }
}

module.exports = new ScriptRunnerClient();
