const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const pool = require('../db');
const sdkAstService = require('../services/sdkAstService');

router.use(authenticateToken);

router.post('/index', async (req, res) => {
  try {
    const { fileIds, chipVersionId } = req.body;
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, message: '缺少fileIds' });
    }
    const data = await sdkAstService.index(fileIds, chipVersionId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/symbols', async (req, res) => {
  try {
    const conditions = [];
    const params = [];
    if (req.query.chipVersionId) {
      conditions.push('(s.chip_version_id IS NULL OR s.chip_version_id = ?)');
      params.push(parseInt(req.query.chipVersionId, 10));
    }
    if (req.query.symbolType) {
      conditions.push('s.symbol_type = ?');
      params.push(req.query.symbolType);
    }
    if (req.query.keyword) {
      conditions.push('(s.name LIKE ? OR s.signature LIKE ?)');
      params.push(`%${req.query.keyword}%`, `%${req.query.keyword}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT s.*, cv.version_key AS chip_version_key FROM sdk_api_symbols s LEFT JOIN chip_versions cv ON s.chip_version_id = cv.id ${where} ORDER BY s.symbol_type, s.name LIMIT 500`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/diff', async (req, res) => {
  try {
    const { sourceChipVersionId, targetChipVersionId } = req.body;
    if (!sourceChipVersionId || !targetChipVersionId) return res.status(400).json({ success: false, message: '缺少源/目标芯片版本' });
    const [source] = await pool.execute('SELECT symbol_type, name, signature FROM sdk_api_symbols WHERE chip_version_id = ?', [sourceChipVersionId]);
    const [target] = await pool.execute('SELECT symbol_type, name, signature FROM sdk_api_symbols WHERE chip_version_id = ?', [targetChipVersionId]);
    const targetMap = new Map(target.map(s => [`${s.symbol_type}:${s.name}`, s]));
    const sourceMap = new Map(source.map(s => [`${s.symbol_type}:${s.name}`, s]));
    const changed = source.filter(s => targetMap.has(`${s.symbol_type}:${s.name}`) && targetMap.get(`${s.symbol_type}:${s.name}`).signature !== s.signature);
    const removed = source.filter(s => !targetMap.has(`${s.symbol_type}:${s.name}`));
    const added = target.filter(s => !sourceMap.has(`${s.symbol_type}:${s.name}`));
    res.json({ success: true, data: { added, removed, changed } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
