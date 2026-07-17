const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware');
const bugLearningService = require('../services/bugLearningService');

router.use(authenticateToken);

router.get('/cards', async (req, res) => {
  try {
    const data = await bugLearningService.listCards(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/cards', async (req, res) => {
  try {
    const data = await bugLearningService.createCard(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/cards/:bugId/approve', requireAdmin, async (req, res) => {
  try {
    const data = await bugLearningService.approve(req.user, req.params.bugId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/retrieve', async (req, res) => {
  try {
    const data = await bugLearningService.retrieve(req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/gap-reports', async (req, res) => {
  try {
    const data = await bugLearningService.listGapReports(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/gap-reports', async (req, res) => {
  try {
    const data = await bugLearningService.generateGapReport(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/gap-reports/:reportId', async (req, res) => {
  try {
    const data = await bugLearningService.getGapReport(req.params.reportId);
    if (!data) return res.status(404).json({ success: false, message: '报告不存在' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
