const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware');
const toolService = require('../services/agentToolService');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const isAdminUser = req.user && (req.user.role === '管理员' || req.user.role === 'admin');
    const filters = {
      invocationType: req.query.invocationType,
      category: req.query.category,
      status: req.query.status,
      includeInactive: isAdminUser && req.query.includeInactive === 'true'
    };
    const data = await toolService.listTools(filters);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:toolId', authenticateToken, async (req, res) => {
  try {
    const tool = await toolService.getTool(req.params.toolId);
    if (!tool) return res.status(404).json({ success: false, message: '工具不存在' });
    res.json({ success: true, data: tool });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const tool = await toolService.createTool(req.user, req.body);
    res.json({ success: true, data: tool });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/:toolId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const tool = await toolService.updateTool(req.user, req.params.toolId, req.body);
    res.json({ success: true, data: tool });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/:toolId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const hard = req.query.hard === 'true';
    const result = await toolService.deleteTool(req.user, req.params.toolId, { hard });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 调用 HTTP 工具（支持跳板机隧道）
router.post('/:toolId/invoke', authenticateToken, async (req, res) => {
  try {
    const result = await toolService.invokeTool(req.params.toolId, req.body, {
      proxyOverride: req.body._proxyOverride || null,
    });
    res.json({ success: result.success, data: result.data, status: result.status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 测试工具连通性
router.post('/:toolId/test-connection', authenticateToken, async (req, res) => {
  try {
    const result = await toolService.testConnection(req.params.toolId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
