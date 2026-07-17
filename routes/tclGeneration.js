const express = require('express');
const router = express.Router();
const { authenticateToken, isAdmin } = require('../middleware');
const pool = require('../db');
const tclGenerationService = require('../services/tclGenerationService');
const testPointExpansionService = require('../services/testPointExpansionService');
const tclLearningService = require('../services/tclLearningService');
const scriptRunnerClient = require('../services/scriptRunnerClient');
const executionEnvironmentService = require('../services/executionEnvironmentService');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SCRIPTS_DIR = path.join(__dirname, '..', 'uploads', 'scripts');

router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const { moduleId, level1PointId, options } = req.body;
    if (!moduleId || !level1PointId) {
      return res.status(400).json({ success: false, message: '缺少moduleId或level1PointId' });
    }
    const taskId = `TCL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 8).toUpperCase()}`;
    const result = await tclGenerationService.generate(
      taskId,
      parseInt(moduleId),
      parseInt(level1PointId),
      req.user.id,
      options || {}
    );
    res.json({ success: result.success !== false, data: { taskId, ...result } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/task/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const [rows] = await pool.execute('SELECT * FROM tcl_generation_tasks WHERE task_id = ?', [taskId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    if (!isAdmin(req.user) && rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权访问该任务' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/tasks', authenticateToken, async (req, res) => {
  try {
    const { moduleId, libraryId } = req.query;
    let sql = 'SELECT * FROM tcl_generation_tasks WHERE 1=1';
    const params = [];
    if (!isAdmin(req.user)) {
      sql += ' AND user_id = ?';
      params.push(req.user.id);
    }
    if (moduleId) {
      sql += ' AND module_id = ?';
      params.push(parseInt(moduleId));
    }
    if (libraryId) {
      sql += ' AND library_id = ?';
      params.push(parseInt(libraryId));
    }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const [rows] = await pool.execute(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/expand-points', authenticateToken, async (req, res) => {
  try {
    const { taskId, moduleId, globalContext } = req.body;
    if (!taskId || !moduleId) {
      return res.status(400).json({ success: false, message: '缺少taskId或moduleId' });
    }
    let existingPoints = [];
    const [level1Rows] = await pool.execute('SELECT name, test_type, description FROM level1_points WHERE module_id = ?', [parseInt(moduleId)]);
    if (level1Rows.length > 0) {
      existingPoints = level1Rows;
    } else {
      const [tempRows] = await pool.execute('SELECT name, test_type, description FROM temp_level1_points WHERE module_id = ?', [parseInt(moduleId)]);
      existingPoints = tempRows;
    }
    const result = await testPointExpansionService.expand(taskId, parseInt(moduleId), existingPoints, globalContext || '');
    res.json({ success: true, data: { expandedCount: result.expandedCount, newPoints: result.newPoints } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/relearn-tcl', authenticateToken, async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, message: '缺少fileIds' });
    }
    const results = [];
    for (const fileId of fileIds) {
      try {
        const [files] = await pool.execute(
          'SELECT module_id FROM module_knowledge_files WHERE id = ? AND file_category = ?',
          [parseInt(fileId), 'tcl_script']
        );
        if (files.length === 0) {
          results.push({ fileId, success: false, message: '文件不存在或非TCL脚本' });
          continue;
        }
        const result = await tclLearningService.analyzeFromFile(parseInt(fileId), files[0].module_id);
        results.push({ fileId, success: result.success, data: result });
      } catch (error) {
        results.push({ fileId, success: false, message: error.message });
      }
    }
    res.json({ success: true, data: { results } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/runner/health', authenticateToken, async (req, res) => {
  try {
    const healthStatus = await scriptRunnerClient.healthCheck();
    res.json({ success: true, data: healthStatus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/download/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const [rows] = await pool.execute('SELECT script_file_path, user_id FROM tcl_generation_tasks WHERE task_id = ?', [taskId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    if (!isAdmin(req.user) && rows[0].user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权下载该任务脚本' });
    }
    const relativePath = rows[0].script_file_path;
    if (!relativePath) {
      return res.status(404).json({ success: false, message: '脚本文件路径不存在' });
    }
    const absolutePath = path.join(SCRIPTS_DIR, relativePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(relativePath)}"`);
    res.send(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, message: '脚本文件不存在' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/execution-environments', authenticateToken, async (req, res) => {
  try {
    const envs = await executionEnvironmentService.list(req.query);
    res.json({ success: true, data: envs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
