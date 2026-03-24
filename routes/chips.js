const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');

// 获取芯片列表
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const [chips] = await pool.execute('SELECT * FROM chips');
    res.json({ success: true, chips });
  } catch (error) {
    console.error('获取芯片列表错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 添加芯片
router.post('/add', authenticateToken, requireAdmin, async (req, res) => {
  const { chip_id, name, description } = req.body;

  try {
    // 检查芯片ID是否已存在
    const [existingChips] = await pool.execute('SELECT * FROM chips WHERE chip_id = ?', [chip_id]);
    if (existingChips.length > 0) {
      return res.status(400).json({ success: false, message: '芯片ID已存在' });
    }

    // 添加新芯片
    await pool.execute(
      'INSERT INTO chips (chip_id, name, description) VALUES (?, ?, ?)',
      [chip_id, name, description || '']
    );

    res.json({ success: true, message: '芯片添加成功' });
  } catch (error) {
    console.error('添加芯片错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 编辑芯片
router.put('/edit/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  try {
    await pool.execute(
      'UPDATE chips SET name = ?, description = ? WHERE id = ?',
      [name, description || '', id]
    );

    res.json({ success: true, message: '芯片编辑成功' });
  } catch (error) {
    console.error('编辑芯片错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除芯片
router.delete('/delete/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // 检查是否有关联的测试点
    const [testpointChips] = await pool.execute('SELECT * FROM testpoint_chips WHERE chip_id = ?', [id]);
    if (testpointChips.length > 0) {
      return res.status(400).json({ success: false, message: '该芯片已关联测试点，无法删除' });
    }

    // 删除芯片
    await pool.execute('DELETE FROM chips WHERE id = ?', [id]);

    res.json({ success: true, message: '芯片删除成功' });
  } catch (error) {
    console.error('删除芯片错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 按芯片统计测试点数量
router.get('/stats/testpoint-count', authenticateToken, async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT c.id, c.name, COUNT(tc.testpoint_id) as testpoint_count
      FROM chips c
      LEFT JOIN testpoint_chips tc ON c.id = tc.chip_id
      GROUP BY c.id, c.name
      ORDER BY c.id
    `);

    res.json({ success: true, stats });
  } catch (error) {
    console.error('按芯片统计测试点数量错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 按芯片统计测试通过率
router.get('/stats/pass-rate', authenticateToken, async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT 
        c.id, 
        c.name, 
        COUNT(ts.testpoint_id) as total_tests,
        SUM(CASE WHEN ts.test_result = 'pass' THEN 1 ELSE 0 END) as passed_tests,
        CASE 
          WHEN COUNT(ts.testpoint_id) > 0 
          THEN ROUND((SUM(CASE WHEN ts.test_result = 'pass' THEN 1 ELSE 0 END) / COUNT(ts.testpoint_id)) * 100, 2)
          ELSE 0
        END as pass_rate
      FROM chips c
      LEFT JOIN testpoint_chips tc ON c.id = tc.chip_id
      LEFT JOIN testpoint_status ts ON tc.testpoint_id = ts.testpoint_id AND tc.chip_id = ts.chip_id
      GROUP BY c.id, c.name
      ORDER BY c.id
    `);

    res.json({ success: true, stats });
  } catch (error) {
    console.error('按芯片统计测试通过率错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 按芯片统计测试状态分布
router.get('/stats/status-distribution', authenticateToken, async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT 
        c.id, 
        c.name, 
        ts.test_result,
        COUNT(*) as count
      FROM chips c
      LEFT JOIN testpoint_chips tc ON c.id = tc.chip_id
      LEFT JOIN testpoint_status ts ON tc.testpoint_id = ts.testpoint_id AND tc.chip_id = ts.chip_id
      WHERE ts.test_result IS NOT NULL
      GROUP BY c.id, c.name, ts.test_result
      ORDER BY c.id, ts.test_result
    `);

    // 整理数据格式
    const result = {};
    stats.forEach(row => {
      if (!result[row.id]) {
        result[row.id] = {
          id: row.id,
          name: row.name,
          distribution: {}
        };
      }
      result[row.id].distribution[row.test_result] = row.count;
    });

    res.json({ success: true, stats: Object.values(result) });
  } catch (error) {
    console.error('按芯片统计测试状态分布错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;