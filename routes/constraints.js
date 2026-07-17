const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const hardConstraintService = require('../services/hardConstraintService');

router.use(authenticateToken);

// 获取任务的硬约束清单
router.get('/tasks/:taskId/constraints', async (req, res) => {
  try {
    const { type, status } = req.query;
    const data = await hardConstraintService.getConstraints(req.params.taskId, { type, status });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 手动添加硬约束
router.post('/tasks/:taskId/constraints', async (req, res) => {
  try {
    const data = await hardConstraintService.addConstraint(req.params.taskId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 更新硬约束
router.put('/tasks/:taskId/constraints/:constraintId', async (req, res) => {
  try {
    const data = await hardConstraintService.updateConstraint(req.params.taskId, parseInt(req.params.constraintId), req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 从设计文档提取硬约束
router.post('/tasks/:taskId/constraints/extract', async (req, res) => {
  try {
    const { documents } = req.body;
    if (!Array.isArray(documents)) {
      return res.status(400).json({ success: false, message: 'documents 必须是数组' });
    }
    const constraints = await hardConstraintService.extractConstraints(req.params.taskId, documents);
    res.json({ success: true, data: { extracted: constraints.length, constraints } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 执行覆盖比对
router.post('/tasks/:taskId/constraints/compare', async (req, res) => {
  try {
    const result = await hardConstraintService.check({
      taskId: req.params.taskId,
      node: { config: req.body || {} },
      context: {},
      nodeResults: {},
      emit: () => {},
    });
    res.json({ success: true, data: result.output });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 删除硬约束
router.delete('/tasks/:taskId/constraints/:constraintId', async (req, res) => {
  try {
    const ok = await hardConstraintService.deleteConstraint(req.params.taskId, parseInt(req.params.constraintId));
    if (!ok) return res.status(404).json({ success: false, message: '约束不存在' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取覆盖率统计
router.get('/tasks/:taskId/coverage', async (req, res) => {
  try {
    const stats = await hardConstraintService.getCoverageStats(req.params.taskId);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
