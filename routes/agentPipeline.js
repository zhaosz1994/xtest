const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const agentConsoleService = require('../services/agentConsoleService');
const pipelineOrchestrator = require('../services/pipelineOrchestrator');

router.use(authenticateToken);

// 看板数据
router.get('/board', async (req, res) => {
  try {
    const data = await agentConsoleService.getPipelineBoard(req.user, req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 任务详情
router.get('/tasks/:taskId', async (req, res) => {
  try {
    const data = await agentConsoleService.getPipelineTaskDetail(req.user, req.params.taskId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Agent 负载
router.get('/agents/load', async (req, res) => {
  try {
    const data = await agentConsoleService.getAgentLoad();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 任务操作 (approve/reject 需要管理员权限,由 approveTask 内部校验)
router.post('/tasks/:taskId/action', async (req, res) => {
  try {
    const { action, comment } = req.body;
    if (!action) return res.status(400).json({ success: false, message: 'action不能为空' });
    const data = await agentConsoleService.executePipelineAction(req.user, req.params.taskId, action, comment || '');
    res.json({ success: true, data });
  } catch (error) {
    const status = /管理员/.test(error.message) ? 403 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// 自动执行任务 (启动流水线)
router.post('/tasks/:taskId/start', async (req, res) => {
  try {
    const taskId = req.params.taskId;
    if (pipelineOrchestrator.isRunning(taskId)) {
      return res.status(409).json({ success: false, message: '该任务正在自动执行中' });
    }
    // 异步启动，不阻塞响应
    pipelineOrchestrator.start(req.user, taskId).catch(error => {
      console.error('[Pipeline] 自动执行异常:', error.message);
    });
    res.json({ success: true, message: '任务已启动自动执行', data: { taskId } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 查询任务执行状态
router.get('/tasks/:taskId/status', async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const isRunning = pipelineOrchestrator.isRunning(taskId);
    const runtime = isRunning ? pipelineOrchestrator.runningTasks.get(taskId) : null;
    res.json({ success: true, data: { isRunning, runtime } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
