const express = require('express');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');
const router = express.Router();

router.get('/list', authenticateToken, async (req, res) => {
  try {
    const [projects] = await pool.execute('SELECT * FROM projects ORDER BY created_at DESC');
    res.json({ success: true, projects });
  } catch (error) {
    logger.error('获取项目列表失败:', { error: error.message });
    res.status(500).json({ success: false, message: '获取项目列表失败' });
  }
});

router.post('/add', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, code, description } = req.body;
    
    if (!name || !code) {
      return res.status(400).json({ success: false, message: '项目名称和代码不能为空' });
    }
    
    const [existing] = await pool.execute('SELECT * FROM projects WHERE code = ?', [code]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '项目代码已存在' });
    }
    
    const [result] = await pool.execute(
      'INSERT INTO projects (name, code, description) VALUES (?, ?, ?)',
      [name, code, description || '']
    );
    
    const [newProject] = await pool.execute('SELECT * FROM projects WHERE id = ?', [result.insertId]);
    
    res.json({ success: true, message: '项目添加成功', project: newProject[0] });
  } catch (error) {
    logger.error('添加项目失败:', { error: error.message });
    res.status(500).json({ success: false, message: '添加项目失败' });
  }
});

router.put('/update/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description } = req.body;
    
    if (!name || !code) {
      return res.status(400).json({ success: false, message: '项目名称和代码不能为空' });
    }
    
    const [existing] = await pool.execute('SELECT * FROM projects WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '项目不存在' });
    }
    
    const [codeExists] = await pool.execute('SELECT * FROM projects WHERE code = ? AND id != ?', [code, id]);
    if (codeExists.length > 0) {
      return res.status(400).json({ success: false, message: '项目代码已被使用' });
    }
    
    await pool.execute(
      'UPDATE projects SET name = ?, code = ?, description = ? WHERE id = ?',
      [name, code, description || '', id]
    );
    
    const [updatedProject] = await pool.execute('SELECT * FROM projects WHERE id = ?', [id]);
    
    res.json({ success: true, message: '项目更新成功', project: updatedProject[0] });
  } catch (error) {
    logger.error('更新项目失败:', { error: error.message });
    res.status(500).json({ success: false, message: '更新项目失败' });
  }
});

router.delete('/delete/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [existing] = await pool.execute('SELECT * FROM projects WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '项目不存在' });
    }
    
    await pool.execute('DELETE FROM projects WHERE id = ?', [id]);
    
    res.json({ success: true, message: '项目删除成功' });
  } catch (error) {
    logger.error('删除项目失败:', { error: error.message });
    res.status(500).json({ success: false, message: '删除项目失败' });
  }
});

router.post('/delete', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '项目名称不能为空' });
    }
    
    const [existing] = await pool.execute('SELECT * FROM projects WHERE name = ?', [name]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '项目不存在' });
    }
    
    await pool.execute('DELETE FROM projects WHERE name = ?', [name]);
    
    res.json({ success: true, message: '项目删除成功' });
  } catch (error) {
    logger.error('删除项目失败:', { error: error.message });
    res.status(500).json({ success: false, message: '删除项目失败' });
  }
});

module.exports = router;
