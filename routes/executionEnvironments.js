const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware');
const executionEnvironmentService = require('../services/executionEnvironmentService');

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const data = await executionEnvironmentService.list(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const data = await executionEnvironmentService.create(req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const data = await executionEnvironmentService.update(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
