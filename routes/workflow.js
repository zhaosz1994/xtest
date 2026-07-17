const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const workflowEngine = require('../services/workflowEngine');
const pool = require('../db');

router.use(authenticateToken);

// 列出所有工作流定义
router.get('/definitions', async (req, res) => {
  try {
    const definitions = await workflowEngine.listDefinitions();
    res.json({ success: true, data: definitions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取单个工作流定义
router.get('/definitions/:type', async (req, res) => {
  try {
    const definition = await workflowEngine.loadDefinition(req.params.type);
    res.json({ success: true, data: definition });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
});

// 创建/更新工作流定义
router.post('/definitions', async (req, res) => {
  try {
    const { workflow_type, name, description, definition } = req.body;
    if (!workflow_type || !name || !definition) {
      return res.status(400).json({ success: false, message: 'workflow_type, name, definition 不能为空' });
    }
    const result = await workflowEngine.saveDefinition(
      workflow_type, name, description, definition, req.user.id
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 获取工作流实例
router.get('/instances/:instanceId', async (req, res) => {
  try {
    const inst = await workflowEngine.getInstance(req.params.instanceId);
    if (!inst) return res.status(404).json({ success: false, message: '实例不存在' });
    res.json({ success: true, data: inst });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取任务的工作流实例
router.get('/tasks/:taskId/workflow', async (req, res) => {
  try {
    const inst = await workflowEngine.getTaskInstance(req.params.taskId);
    res.json({ success: true, data: inst });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 恢复暂停的工作流（审批通过后）
router.post('/instances/:instanceId/resume', async (req, res) => {
  try {
    const { decision = 'approved' } = req.body;
    const result = await workflowEngine.resumeWorkflow(req.params.instanceId, decision);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 使用工作流引擎启动任务
router.post('/tasks/:taskId/start-workflow', async (req, res) => {
  try {
    const pipelineOrchestrator = require('../services/pipelineOrchestrator');
    const { workflow_type = 'default' } = req.body;
    if (pipelineOrchestrator.isRunning(req.params.taskId)) {
      return res.status(409).json({ success: false, message: '该任务正在自动执行中' });
    }
    // 异步启动
    pipelineOrchestrator.startWithWorkflow(req.user, req.params.taskId, workflow_type).catch(error => {
      console.error('[Workflow] 自动执行异常:', error.message);
    });
    res.json({ success: true, message: '工作流已启动', data: { taskId: req.params.taskId, workflowType: workflow_type } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
