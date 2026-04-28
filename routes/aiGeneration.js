const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const caseGeneratorService = require('../services/caseGeneratorService');
const level1PointService = require('../services/level1PointService');
const taskScheduler = require('../services/taskScheduler');
const pool = require('../db');

router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { moduleId, libraryId, selectedFiles, skillId, caseCountLimit, 
            enableDedup, similarityThreshold, level1Mode, selectedLevel1Ids,
            model, temperature, max_tokens, focusAreas } = req.body;

    if (!moduleId) {
      return res.status(400).json({ success: false, message: '缺少模块ID' });
    }

    const result = await caseGeneratorService.createTask(parseInt(moduleId), req.user.id, {
      libraryId,
      selectedFiles,
      skillId,
      caseCountLimit,
      enableDedup,
      similarityThreshold,
      level1Mode,
      selectedLevel1Ids,
      model,
      temperature,
      max_tokens,
      focusAreas
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/task/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await caseGeneratorService.getTaskStatus(taskId);

    if (!task) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    if (task.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '无权查看此任务' });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/tasks', authenticateToken, async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const result = await caseGeneratorService.getUserTasks(req.user.id, {
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/cancel/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const result = await taskScheduler.cancelTask(taskId, req.user.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/retry/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const result = await caseGeneratorService.retryTask(taskId, req.user.id);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/level1-points/:moduleId', authenticateToken, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const points = await level1PointService.getExistingLevel1Points(parseInt(moduleId));
    res.json({ success: true, data: points });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/temp-level1-points/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const points = await level1PointService.getTempLevel1Points(taskId);
    res.json({ success: true, data: points });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/temp-level1-approve', authenticateToken, async (req, res) => {
  try {
    const { tempLevel1Id, taskId } = req.body;
    await level1PointService.approveTempLevel1Point(tempLevel1Id, taskId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/temp-level1-reject', authenticateToken, async (req, res) => {
  try {
    const { tempLevel1Id, taskId } = req.body;
    await level1PointService.rejectTempLevel1Point(tempLevel1Id, taskId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/skills', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const [skills] = await pool.execute(`
      SELECT id, name, display_name, description, category, is_system, creator_id
      FROM ai_skills
      WHERE category = 'test_generation'
        AND is_enabled = 1
        AND (is_public = 1 OR creator_id = ?)
      ORDER BY is_system DESC, created_at DESC
    `, [userId]);

    res.json({
      success: true,
      data: skills.map(s => ({
        id: s.id,
        name: s.name,
        displayName: s.display_name,
        description: s.description,
        category: s.category,
        isSystem: s.is_system === 1,
        isOwner: s.creator_id === userId
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/skills', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, displayName, description, systemPrompt, userPromptTemplate, category, isPublic } = req.body;

    if (!name || !displayName) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    const definition = JSON.stringify({
      type: 'function',
      function: {
        name: name,
        description: description,
        parameters: {
          type: 'object',
          properties: {
            module_context: { type: 'object' },
            material_content: { type: 'string' }
          }
        }
      },
      prompts: {
        system: systemPrompt,
        userTemplate: userPromptTemplate
      }
    });

    const [result] = await pool.execute(`
      INSERT INTO ai_skills 
        (name, display_name, description, definition, category, is_system, is_public, creator_id, created_by)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `, [name, displayName, description, definition, category || 'test_generation',
        isPublic ? 1 : 0, userId, req.user.username]);

    res.json({
      success: true,
      data: { id: result.insertId, name }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/skills/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { displayName, description, systemPrompt, userPromptTemplate, isPublic } = req.body;
    const userId = req.user.id;

    const [existing] = await pool.execute(`
      SELECT id, is_system, creator_id, definition FROM ai_skills WHERE id = ?
    `, [id]);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Skill不存在' });
    }

    if (existing[0].is_system === 1) {
      return res.status(403).json({ success: false, message: '系统内置Skill不可修改' });
    }

    if (existing[0].creator_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '无权修改此Skill' });
    }

    let existingDef = {};
    try {
      existingDef = typeof existing[0].definition === 'string' 
        ? JSON.parse(existing[0].definition) 
        : (existing[0].definition || {});
    } catch (e) {}

    existingDef.prompts = {
      system: systemPrompt,
      userTemplate: userPromptTemplate
    };

    const definition = JSON.stringify(existingDef);

    await pool.execute(`
      UPDATE ai_skills 
      SET display_name = ?, description = ?, definition = ?, is_public = ?, updated_at = NOW()
      WHERE id = ? AND is_system = 0
    `, [displayName, description, definition, isPublic ? 1 : 0, id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/skills/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const [result] = await pool.execute(`
      DELETE FROM ai_skills 
      WHERE id = ? AND is_system = 0 AND creator_id = ?
    `, [id, userId]);

    res.json({ success: result.affectedRows > 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
