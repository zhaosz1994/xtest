const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware');
const catalogService = require('../services/agentCatalogService');
const pool = require('../db');

// ========== Agent Registry CRUD ==========
// 注意:必须放在通用 catalog 路由之前,否则会被 /:category 拦截
router.get('/agents', authenticateToken, async (req, res) => {
  try {
    const includeInactive = req.user && (req.user.role === '管理员' || req.user.role === 'admin');
    const data = await catalogService.listAgents({ includeInactive });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/agents', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await catalogService.createAgent(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/agents/:agentId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await catalogService.updateAgent(req.user, req.params.agentId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/agents/:agentId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await catalogService.deleteAgent(req.user, req.params.agentId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ========== env_resource CRUD ==========
router.get('/resources', authenticateToken, async (req, res) => {
  try {
    const includeInactive = req.user && (req.user.role === '管理员' || req.user.role === 'admin');
    const data = await catalogService.listResources({ includeInactive });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/resources', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await catalogService.createResource(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/resources/:resourceId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await catalogService.updateResource(req.user, req.params.resourceId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/resources/:resourceId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await catalogService.deleteResource(req.user, req.params.resourceId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ========== Part 4: Module Taxonomy 标准分类树 ==========
// 返回所有已分类的模块(taxonomy_path 不为空),按 taxonomy_path 排序
router.get('/module-taxonomy', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, module_id, taxonomy_path, parent_module_id, taxonomy_level FROM modules WHERE taxonomy_path IS NOT NULL ORDER BY taxonomy_path'
    ).catch(err => {
      // taxonomy_path 列可能未迁移,容错返回空列表
      if (err.code === 'ER_BAD_FIELD_ERROR' || /Unknown column 'taxonomy_path'/.test(err.message)) {
        return [[]];
      }
      throw err;
    });
    res.json({ success: true, data: rows || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 给模块设置分类(管理员)
router.put('/modules/:moduleId/taxonomy', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { taxonomyPath, parentModuleId, taxonomyLevel } = req.body;
    if (!taxonomyPath) {
      return res.status(400).json({ success: false, message: 'taxonomyPath 必填' });
    }
    await pool.execute(
      'UPDATE modules SET taxonomy_path = ?, parent_module_id = ?, taxonomy_level = ? WHERE id = ?',
      [taxonomyPath, parentModuleId || null, taxonomyLevel || 0, parseInt(moduleId)]
    );
    res.json({ success: true, moduleId: parseInt(moduleId), taxonomyPath });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== 字典项 CRUD ==========
// 路径前缀 /items 避免与 /agents /resources 冲突
router.get('/', authenticateToken, async (req, res) => {
  try {
    const includeInactive = req.user && (req.user.role === '管理员' || req.user.role === 'admin');
    const data = await catalogService.listAll({ includeInactive });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/items/:category', authenticateToken, async (req, res) => {
  try {
    const includeInactive = req.user && (req.user.role === '管理员' || req.user.role === 'admin');
    const data = await catalogService.listByCategory(req.params.category, { includeInactive });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post('/items', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await catalogService.createItem(req.user, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/items/:category/:itemKey', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await catalogService.updateItem(req.user, req.params.category, req.params.itemKey, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/items/:category/:itemKey', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const hard = req.query.hard === 'true';
    const data = await catalogService.deleteItem(req.user, req.params.category, req.params.itemKey, { soft: !hard });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
