const express = require('express');
const router = express.Router();
const { authenticateToken, isAdmin } = require('../middleware');
const adaptiveWorkflowService = require('../services/adaptiveWorkflowService');
const evidenceService = require('../services/evidenceService');

router.use(authenticateToken);

router.post('/create', async (req, res) => {
  try {
    const data = await adaptiveWorkflowService.createAdaptiveTask(req.body, req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/task/:taskId', async (req, res) => {
  try {
    const data = await adaptiveWorkflowService.getTask(req.params.taskId);
    if (!data) return res.status(404).json({ success: false, message: '任务不存在' });
    if (!isAdmin(req.user) && data.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权访问该任务' });
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/evidence/:targetType/:targetId', async (req, res) => {
  try {
    const options = isAdmin(req.user) ? {} : { createdBy: req.user.id };
    const data = await evidenceService.getEvidenceSummary(req.params.targetType, req.params.targetId, options);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
