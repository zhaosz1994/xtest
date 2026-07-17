const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const deepTestService = require('../services/deepTestService');

router.use(authenticateToken);

// 获取任务的测试用例
router.get('/tasks/:taskId/test-cases', async (req, res) => {
  try {
    const { status, pathType } = req.query;
    const data = await deepTestService.listTestCases(req.params.taskId, { status, pathType });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取任务的测试 Bug
router.get('/tasks/:taskId/test-bugs', async (req, res) => {
  try {
    const data = await deepTestService.listTestBugs(req.params.taskId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取测试统计
router.get('/tasks/:taskId/test-stats', async (req, res) => {
  try {
    const data = await deepTestService.getTestStats(req.params.taskId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
