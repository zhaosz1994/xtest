const express = require('express');
const router = express.Router();
const pool = require('../db');

// 创建历史快照
router.post('/create', async (req, res) => {
  const { entity_type, entity_id, snapshot_data, version, user, action } = req.body;
  
  try {
    await pool.execute(
      'INSERT INTO history_snapshots (entity_type, entity_id, snapshot_data, version, user, action) VALUES (?, ?, ?, ?, ?, ?)',
      [entity_type, entity_id, snapshot_data, version, user, action]
    );
    
    res.json({ success: true, message: '历史快照创建成功' });
  } catch (error) {
    console.error('创建历史快照错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取指定实体的历史快照
router.get('/:entity_type/:entity_id', async (req, res) => {
  const { entity_type, entity_id } = req.params;
  
  try {
    const [snapshots] = await pool.execute(
      'SELECT * FROM history_snapshots WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC',
      [entity_type, entity_id]
    );
    
    res.json({ success: true, snapshots });
  } catch (error) {
    console.error('获取历史快照错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 恢复到指定版本
router.post('/restore/:snapshot_id', async (req, res) => {
  const { snapshot_id } = req.params;
  
  try {
    // 获取快照数据
    const [snapshots] = await pool.execute(
      'SELECT * FROM history_snapshots WHERE id = ?',
      [snapshot_id]
    );
    
    if (snapshots.length === 0) {
      return res.status(404).json({ success: false, message: '快照不存在' });
    }
    
    const snapshot = snapshots[0];
    const { entity_type, entity_id, snapshot_data } = snapshot;
    const snapshotObj = JSON.parse(snapshot_data);
    
    // 根据实体类型执行恢复操作
    switch (entity_type) {
      case 'module':
        // 恢复模块
        await pool.execute(
          'UPDATE modules SET name = ? WHERE id = ?',
          [snapshotObj.name, entity_id]
        );
        break;
        
      case 'level1_point':
        // 恢复一级测试点
        await pool.execute(
          'UPDATE level1_points SET name = ? WHERE id = ?',
          [snapshotObj.name, entity_id]
        );
        break;
        
      case 'level2_point':
        // 恢复二级测试点
        await pool.execute(
          'UPDATE level2_points SET name = ?, test_steps = ?, expected_behavior = ?, chip_sequence = ?, test_result = ?, test_environment = ?, case_name = ?, remarks = ? WHERE id = ?',
          [
            snapshotObj.name,
            snapshotObj.test_steps,
            snapshotObj.expected_behavior,
            snapshotObj.chip_sequence,
            snapshotObj.test_result,
            snapshotObj.test_environment,
            snapshotObj.case_name,
            snapshotObj.remarks,
            entity_id
          ]
        );
        break;
        
      default:
        return res.status(400).json({ success: false, message: '无效的实体类型' });
    }
    
    res.json({ success: true, message: '版本恢复成功' });
  } catch (error) {
    console.error('恢复版本错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;