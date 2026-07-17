const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const pool = require('../db');
const { newId } = require('../services/agentUtils');

const execFileAsync = util.promisify(execFile);
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'cta_extensions', 'ssh_cli_bridge.py');
// 优先使用项目内置 venv，其次环境变量，最后系统 python3
const VENV_PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python');
const fs = require('fs');
const PYTHON_BIN = (() => {
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return process.env.SSH_PYTHON || 'python3';
})();

router.use(authenticateToken);

// 会话所有权验证中间件
async function checkSessionOwnership(req, res, next) {
  try {
    const [rows] = await pool.execute(
      'SELECT created_by FROM ssh_sessions WHERE session_id = ? LIMIT 1',
      [req.params.sessionId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'SSH会话不存在' });
    }
    // 管理员可操作所有会话，普通用户只能操作自己的会话
    if (rows[0].created_by !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ success: false, message: '无权操作此SSH会话' });
    }
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// 创建 SSH 会话
router.post('/sessions', async (req, res) => {
  try {
    const { host, port = 22, username, password, key_path, device_type = 'generic', resource_id, task_id,
            jump_host, jump_port = 22, jump_username, jump_password, jump_key_path } = req.body;
    if (!host || !username) {
      return res.status(400).json({ success: false, message: 'host 和 username 不能为空' });
    }
    // 构建传给 Python 脚本的参数（含跳板机）
    const payload = { action: 'create_session', host, port, username, password, key_path, device_type };
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
      return res.status(400).json({ success: false, message: result.error || 'SSH连接失败' });
    }
    // 持久化会话
    const sessionId = result.session_id;
    await pool.execute(
      `INSERT INTO ssh_sessions (session_id, host, port, username, device_type, resource_id, task_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [sessionId, host, port, username, device_type, resource_id || null, task_id || null, req.user.id]
    );
    res.json({ success: true, data: { session_id: sessionId, jump_host: jump_host || null } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 执行命令
router.post('/sessions/:sessionId/execute', checkSessionOwnership, async (req, res) => {
  try {
    const { command, timeout = 30 } = req.body;
    if (!command) return res.status(400).json({ success: false, message: 'command 不能为空' });
    const input = JSON.stringify({ action: 'execute', session_id: req.params.sessionId, command, timeout });
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
      input, timeout: timeout * 1000 + 10000, maxBuffer: 10 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (result.status === 'error' && result.error_type === 'connection_lost') {
      // 标记会话异常
      await pool.execute('UPDATE ssh_sessions SET status = "error" WHERE session_id = ?', [req.params.sessionId]).catch(() => {});
    }
    res.json({ success: result.status === 'success', data: result, message: result.error });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 批量执行
router.post('/sessions/:sessionId/batch', checkSessionOwnership, async (req, res) => {
  try {
    const { commands, timeout = 30 } = req.body;
    if (!Array.isArray(commands)) return res.status(400).json({ success: false, message: 'commands 必须是数组' });
    const input = JSON.stringify({ action: 'execute_batch', session_id: req.params.sessionId, commands, timeout });
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
      input, timeout: commands.length * timeout * 1000 + 30000, maxBuffer: 20 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 重连
router.post('/sessions/:sessionId/reconnect', checkSessionOwnership, async (req, res) => {
  try {
    const input = JSON.stringify({ action: 'reconnect', session_id: req.params.sessionId });
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
      input, timeout: 60000, maxBuffer: 2 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (result.status === 'success') {
      await pool.execute(
        'UPDATE ssh_sessions SET reconnect_count = reconnect_count + 1, last_reconnect_at = NOW(), status = "active" WHERE session_id = ?',
        [req.params.sessionId]
      );
    }
    res.json({ success: result.status === 'success', data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取快照
router.post('/sessions/:sessionId/snapshot', checkSessionOwnership, async (req, res) => {
  try {
    const input = JSON.stringify({ action: 'take_snapshot', session_id: req.params.sessionId });
    const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
      input, timeout: 60000, maxBuffer: 5 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (result.status === 'success') {
      // 保存快照到 DB
      const snapshotId = newId('SNAP');
      const snapshotData = JSON.stringify(result.snapshot);
      await pool.execute(
        `INSERT INTO sdk_snapshots (session_id, snapshot_id, snapshot_data, created_by)
         VALUES (?, ?, ?, ?)`,
        [req.params.sessionId, snapshotId, snapshotData, req.user.id]
      );
      return res.json({ success: true, data: { snapshot_id: snapshotId, snapshot: result.snapshot } });
    }
    res.json({ success: false, message: result.error });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 关闭会话
router.delete('/sessions/:sessionId', checkSessionOwnership, async (req, res) => {
  try {
    const input = JSON.stringify({ action: 'close_session', session_id: req.params.sessionId });
    await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], {
      input, timeout: 15000, maxBuffer: 1024 * 1024,
    });
    await pool.execute(
      'UPDATE ssh_sessions SET status = "closed", closed_at = NOW() WHERE session_id = ?',
      [req.params.sessionId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 列出当前用户的 SSH 会话
router.get('/sessions', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM ssh_sessions WHERE created_by = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
