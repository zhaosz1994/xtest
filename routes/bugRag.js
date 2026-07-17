const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware');
const bugRagService = require('../services/bugRagService');

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const data = await bugRagService.list(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/candidate', async (req, res) => {
  try {
    const data = await bugRagService.createCandidate({ ...req.body, createdBy: req.user.id });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const data = await bugRagService.approve(req.params.id, req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const data = await bugRagService.reject(req.params.id, req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
