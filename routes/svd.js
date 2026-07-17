const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const pool = require('../db');
const svdParserService = require('../services/svdParserService');

router.use(authenticateToken);

router.post('/parse', async (req, res) => {
  try {
    const { fileId, chipVersionId } = req.body;
    if (!fileId) return res.status(400).json({ success: false, message: '缺少fileId' });
    const data = await svdParserService.parse(fileId, chipVersionId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/registers', async (req, res) => {
  try {
    const conditions = [];
    const params = [];
    if (req.query.chipVersionId) {
      conditions.push('(r.chip_version_id IS NULL OR r.chip_version_id = ?)');
      params.push(parseInt(req.query.chipVersionId, 10));
    }
    if (req.query.keyword) {
      conditions.push('(r.peripheral_name LIKE ? OR r.register_name LIKE ?)');
      params.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT r.*, cv.version_key AS chip_version_key FROM chip_registers r LEFT JOIN chip_versions cv ON r.chip_version_id = cv.id ${where} ORDER BY r.peripheral_name, r.register_name LIMIT 500`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/registers/:id/fields', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM chip_register_fields WHERE register_id = ? ORDER BY bit_offset ASC', [parseInt(req.params.id, 10)]);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/diff', async (req, res) => {
  try {
    const { sourceChipVersionId, targetChipVersionId } = req.body;
    if (!sourceChipVersionId || !targetChipVersionId) return res.status(400).json({ success: false, message: '缺少源/目标芯片版本' });
    const [source] = await pool.execute('SELECT peripheral_name, register_name, absolute_address FROM chip_registers WHERE chip_version_id = ?', [sourceChipVersionId]);
    const [target] = await pool.execute('SELECT peripheral_name, register_name, absolute_address FROM chip_registers WHERE chip_version_id = ?', [targetChipVersionId]);
    const targetMap = new Map(target.map(r => [`${r.peripheral_name}.${r.register_name}`, r]));
    const sourceMap = new Map(source.map(r => [`${r.peripheral_name}.${r.register_name}`, r]));
    const changed = source.filter(r => targetMap.has(`${r.peripheral_name}.${r.register_name}`) && targetMap.get(`${r.peripheral_name}.${r.register_name}`).absolute_address !== r.absolute_address);
    const removed = source.filter(r => !targetMap.has(`${r.peripheral_name}.${r.register_name}`));
    const added = target.filter(r => !sourceMap.has(`${r.peripheral_name}.${r.register_name}`));
    res.json({ success: true, data: { added, removed, changed } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
