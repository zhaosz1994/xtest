const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware');
const chipContextService = require('../services/chipContextService');
const pool = require('../db');

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const data = await chipContextService.list(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const result = await chipContextService.create(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await chipContextService.update(req.params.id, req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await chipContextService.remove(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/:id/inheritance', async (req, res) => {
  try {
    const data = await chipContextService.getInheritanceChain(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id/bindings', async (req, res) => {
  try {
    const chipId = parseInt(req.params.id, 10);
    if (!chipId) return res.status(400).json({ success: false, message: '无效芯片版本ID' });
    const [rows] = await pool.execute(
      `SELECT 'knowledge_file' AS target_type, COUNT(*) AS count FROM module_knowledge_files WHERE chip_version_id = ?
       UNION ALL SELECT 'ai_material_chunk', COUNT(*) FROM ai_material_chunks WHERE chip_version_id = ?
       UNION ALL SELECT 'level1_point', COUNT(*) FROM level1_points WHERE chip_version_id = ?
       UNION ALL SELECT 'test_case', COUNT(*) FROM test_cases WHERE chip_version_id = ?
       UNION ALL SELECT 'tcl_generation_task', COUNT(*) FROM tcl_generation_tasks WHERE chip_version_id = ?
       UNION ALL SELECT 'ai_case_generation_task', COUNT(*) FROM ai_case_generation_tasks WHERE chip_version_id = ?`,
      [chipId, chipId, chipId, chipId, chipId, chipId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
