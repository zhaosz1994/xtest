const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');
const agentConsoleService = require('../services/agentConsoleService');

router.use(authenticateToken);

router.get('/dashboard', async (req, res) => {
  try {
    const data = await agentConsoleService.dashboard(req.user);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 模块列表(轻量,供下拉选择用)
router.get('/modules/list', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, module_id, name, taxonomy_path FROM modules ORDER BY taxonomy_path, name LIMIT 500'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 用例库列表(轻量,供下拉选择用)
router.get('/libraries/list', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name FROM case_libraries ORDER BY name LIMIT 100'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 模块新增 (Agent Console 管理)
router.post('/modules/create', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '模块名称不能为空' });
    let moduleId = req.body.moduleId || req.body.module_id;
    if (!moduleId) {
      moduleId = 'MOD_' + name.toUpperCase().replace(/[^A-Z0-9_]/g, '_').substring(0, 30) + '_' + Date.now().toString(36).toUpperCase().slice(-4);
    }
    const [exist] = await pool.execute('SELECT id FROM modules WHERE module_id = ? LIMIT 1', [moduleId]);
    if (exist.length > 0) return res.status(400).json({ success: false, message: '模块标识已存在' });
    const taxonomyPath = req.body.taxonomyPath || req.body.taxonomy_path || null;
    const libraryId = parseInt(req.body.libraryId || req.body.library_id) || null;
    const [result] = await pool.execute(
      'INSERT INTO modules (module_id, name, library_id, taxonomy_path) VALUES (?, ?, ?, ?)',
      [moduleId, name, libraryId, taxonomyPath]
    );
    res.json({ success: true, data: { id: result.insertId, moduleId, name, taxonomyPath } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 模块更新
router.post('/modules/update', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.body.id);
    if (!id) return res.status(400).json({ success: false, message: 'id不能为空' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '模块名称不能为空' });
    const moduleId = req.body.moduleId || req.body.module_id || null;
    const taxonomyPath = req.body.taxonomyPath || req.body.taxonomy_path || null;
    if (moduleId) {
      const [dup] = await pool.execute('SELECT id FROM modules WHERE module_id = ? AND id != ? LIMIT 1', [moduleId, id]);
      if (dup.length > 0) return res.status(400).json({ success: false, message: '模块标识已被其他模块占用' });
    }
    await pool.execute(
      'UPDATE modules SET name = ?, module_id = COALESCE(?, module_id), taxonomy_path = ? WHERE id = ?',
      [name, moduleId, taxonomyPath, id]
    );
    res.json({ success: true, data: { id, updated: true } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 模块删除 (检查绑定后才能删)
router.post('/modules/delete', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.body.id);
    if (!id) return res.status(400).json({ success: false, message: 'id不能为空' });
    const [bindings] = await pool.execute(
      `SELECT 'knowledge_file' AS t, COUNT(*) AS c FROM module_knowledge_files WHERE module_id = ?
       UNION ALL SELECT 'level1_point', COUNT(*) FROM level1_points WHERE module_id = ?
       UNION ALL SELECT 'test_case', COUNT(*) FROM test_cases WHERE module_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [id, id, id]
    );
    const bound = bindings.filter(b => b.c > 0);
    if (bound.length > 0) {
      const detail = bound.map(b => `${b.t}(${b.c})`).join(', ');
      return res.status(400).json({ success: false, message: `该模块有绑定数据(${detail}),请先迁移或清理后再删除` });
    }
    await pool.execute('DELETE FROM modules WHERE id = ?', [id]);
    res.json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ===== Part 2: 模块知识健康度 =====
router.get('/modules/health', async (req, res) => {
  try {
    const data = await agentConsoleService.listModuleHealth(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/modules/:moduleId/health', async (req, res) => {
  try {
    const moduleId = parseInt(req.params.moduleId, 10);
    if (!moduleId) return res.status(400).json({ success: false, message: 'moduleId 无效' });
    const data = await agentConsoleService.getModuleHealth(moduleId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const data = await agentConsoleService.listAuditLogs(req.user, req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/agents', async (req, res) => {
  try {
    const data = await agentConsoleService.listAgents(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/agents', requireAdmin, async (req, res) => {
  try {
    const data = await agentConsoleService.upsertAgent(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/tasks', async (req, res) => {
  try {
    const data = await agentConsoleService.listTasks(req.user, req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/tasks', async (req, res) => {
  try {
    const data = await agentConsoleService.createTask(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/tasks/:taskId', async (req, res) => {
  try {
    const data = await agentConsoleService.getTask(req.user, req.params.taskId);
    if (!data) return res.status(404).json({ success: false, message: '任务不存在' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.message.includes('无权') ? 403 : 500).json({ success: false, message: error.message });
  }
});

router.post('/tasks/:taskId/status', async (req, res) => {
  try {
    const data = await agentConsoleService.updateTaskStatus(req.user, req.params.taskId, req.body.status, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/tasks/:taskId/approval', requireAdmin, async (req, res) => {
  try {
    const data = await agentConsoleService.approveTask(req.user, req.params.taskId, req.body.decision || 'approved', req.body.comment || '');
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/tasks/:taskId/joint-verdict', async (req, res) => {
  try {
    const data = await agentConsoleService.createJointVerdict(req.user, req.params.taskId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/tasks/:taskId/sessions', async (req, res) => {
  try {
    const data = await agentConsoleService.createSession(req.user, req.params.taskId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/tasks/:taskId/bind-lease', async (req, res) => {
  try {
    const data = await agentConsoleService.bindLease(req.user, req.params.taskId, req.body.leaseId || req.body.lease_id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const data = await agentConsoleService.getSession(req.user, req.params.sessionId);
    if (!data) return res.status(404).json({ success: false, message: '会话不存在' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.message.includes('无权') ? 403 : 500).json({ success: false, message: error.message });
  }
});

router.get('/sessions/:sessionId/events', async (req, res) => {
  try {
    const data = await agentConsoleService.listEvents(req.user, req.params.sessionId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.message.includes('无权') ? 403 : 500).json({ success: false, message: error.message });
  }
});

router.post('/sessions/:sessionId/events', async (req, res) => {
  try {
    const session = await agentConsoleService.getSession(req.user, req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, message: '会话不存在' });
    const data = await agentConsoleService.emitEvent({
      sessionId: req.params.sessionId,
      taskId: session.task_id,
      eventType: req.body.eventType || req.body.event_type,
      senderAgent: req.body.senderAgent || req.body.sender_agent,
      receiverAgent: req.body.receiverAgent || req.body.receiver_agent,
      phase: req.body.phase,
      payload: req.body.payload
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
