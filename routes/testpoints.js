const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 安全解析 JSON 字段（处理 MySQL2 可能已自动解析的情况）
function safeParseJSON(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'object') {
        return value;
    }
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (e) {
            console.error('JSON 解析错误:', e);
            return null;
        }
    }
    return null;
}

// 图片上传配置
const recordImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../public/uploads/records');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
        cb(null, filename);
    }
});

const recordImageUpload = multer({
    storage: recordImageStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg', 
            'image/png', 
            'image/gif', 
            'image/webp',
            'image/bmp',
            'image/svg+xml',
            'image/tiff',
            'image/x-icon',
            'image/avif',
            'image/heic',
            'image/heif'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('不支持的图片格式'));
        }
    }
});

// 执行记录图片上传接口
router.post('/execution-records/upload-image', authenticateToken, recordImageUpload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '请选择图片文件' });
        }
        
        const imageUrl = `/uploads/records/${req.file.filename}`;
        
        res.json({
            success: true,
            url: imageUrl,
            filename: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        console.error('图片上传错误:', error);
        res.status(500).json({ success: false, message: '图片上传失败' });
    }
});

// 获取测试点列表
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const [testpoints] = await pool.execute('SELECT * FROM level2_points');
    res.json({ success: true, testpoints });
  } catch (error) {
    console.error('获取测试点列表错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取一级测试点列表
router.get('/level1/:moduleId', authenticateToken, async (req, res) => {
  const { moduleId } = req.params;
  const { keyword } = req.query;

  try {
    let query = `
      SELECT 
        l1.id, 
        l1.name, 
        l1.test_type, 
        l1.created_at, 
        l1.updated_at,
        l1.order_index,
        COUNT(tc.id) as test_case_count,
        m.name as module_name,
        m.id as module_id
      FROM level1_points l1
      JOIN modules m ON l1.module_id = m.id
      LEFT JOIN test_cases tc ON l1.id = tc.level1_id
      WHERE l1.module_id = ?
    `;
    
    const params = [moduleId];
    
    // 如果有搜索关键词，添加模糊搜索条件
    if (keyword && keyword.trim() !== '') {
      query += ` AND l1.name LIKE ?`;
      params.push(`%${keyword.trim()}%`);
    }
    
    query += ` GROUP BY l1.id, l1.name, l1.test_type, l1.created_at, l1.updated_at, l1.order_index, m.name, m.id ORDER BY l1.order_index ASC`;
    
    const [points] = await pool.execute(query, params);
    res.json({ success: true, level1Points: points });
  } catch (error) {
    console.error('获取一级测试点列表错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取当前用例库下的所有一级测试用例
router.post('/level1/all', authenticateToken, async (req, res) => {
  const { libraryId, keyword } = req.body;

  try {
    let query = `
      SELECT 
        l1.id, 
        l1.name, 
        l1.test_type, 
        l1.created_at, 
        l1.updated_at,
        l1.order_index,
        COUNT(tc.id) as test_case_count,
        m.name as module_name, 
        m.id as module_id
      FROM level1_points l1
      JOIN modules m ON l1.module_id = m.id
      LEFT JOIN test_cases tc ON l1.id = tc.level1_id
      WHERE m.library_id = ?
    `;
    
    const params = [libraryId];
    
    // 如果有搜索关键词，添加模糊搜索条件
    if (keyword && keyword.trim() !== '') {
      query += ` AND l1.name LIKE ?`;
      params.push(`%${keyword.trim()}%`);
    }
    
    query += ` GROUP BY l1.id, l1.name, l1.test_type, l1.created_at, l1.updated_at, l1.order_index, m.name, m.id ORDER BY m.order_index ASC, l1.order_index ASC`;
    
    const [points] = await pool.execute(query, params);
    res.json({ success: true, level1Points: points });
  } catch (error) {
    console.error('获取所有一级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 添加一级测试点
router.post('/level1/add', authenticateToken, async (req, res) => {
  const { module_id, name, test_type } = req.body;

  // 验证必填字段
  if (!module_id) {
    return res.json({ success: false, message: '模块ID不能为空' });
  }
  if (!name || !name.trim()) {
    return res.json({ success: false, message: '测试点名称不能为空' });
  }

  try {
    // 检查同一模块下测试点名称是否重复
    const [existing] = await pool.execute(
      'SELECT id FROM level1_points WHERE name = ? AND module_id = ?',
      [name, module_id]
    );
    if (existing.length > 0) {
      return res.json({ 
        success: false, 
        message: '该模块下已存在同名测试点，请使用其他名称' 
      });
    }
    
    // 获取当前模块下的最大order_index
    const [maxOrderResult] = await pool.execute(
      'SELECT IFNULL(MAX(order_index), -1) as max_order FROM level1_points WHERE module_id = ?',
      [module_id]
    );
    const orderIndex = maxOrderResult[0].max_order + 1;
    
    const [result] = await pool.execute(
      'INSERT INTO level1_points (module_id, name, test_type, order_index) VALUES (?, ?, ?, ?)',
      [module_id, name, test_type || '功能测试', orderIndex]
    );

    res.json({ 
      success: true,
      message: '一级测试点添加成功',
      data: {
        id: result.insertId,
        name,
        test_type: test_type || '功能测试',
        module_id,
        order_index: orderIndex
      }
    });
  } catch (error) {
    console.error('添加一级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 编辑一级测试点
router.put('/level1/edit/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, test_type } = req.body;

  try {
    await pool.execute(
      'UPDATE level1_points SET name = ?, test_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, test_type || '功能测试', id]
    );

    res.json({ success: true, message: '一级测试点编辑成功' });
  } catch (error) {
    console.error('编辑一级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取单个一级测试点详情
router.get('/level1/detail/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [points] = await pool.execute(
      'SELECT id, name, test_type, module_id, created_at, updated_at FROM level1_points WHERE id = ?',
      [id]
    );

    if (points.length > 0) {
      res.json({ success: true, testpoint: points[0] });
    } else {
      res.status(404).json({ success: false, message: '测试点不存在' });
    }
  } catch (error) {
    console.error('获取一级测试点详情错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除一级测试点
router.delete('/level1/delete/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 删除关联的测试用例
      await connection.execute('DELETE FROM test_cases WHERE level1_id = ?', [id]);
      
      // 删除关联的二级测试点
      await connection.execute('DELETE FROM level2_points WHERE level1_id = ?', [id]);
      
      // 删除一级测试点
      await connection.execute('DELETE FROM level1_points WHERE id = ?', [id]);
      
      // 提交事务
      await connection.commit();
      res.json({ success: true, message: '一级测试点删除成功' });
    } catch (error) {
      // 回滚事务
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除一级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 重新排序一级测试点
router.post('/level1/reorder', authenticateToken, async (req, res) => {
  const { level1Points } = req.body;

  try {
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 更新每个一级测试点的order_index
      for (const point of level1Points) {
        await connection.execute(
          'UPDATE level1_points SET order_index = ? WHERE id = ?',
          [point.orderIndex, point.id]
        );
      }
      
      // 提交事务
      await connection.commit();
      res.json({ success: true, message: '一级测试点顺序调整成功' });
    } catch (error) {
      // 回滚事务
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('重新排序一级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取二级测试点列表
router.get('/level2/:level1Id', authenticateToken, async (req, res) => {
  const { level1Id } = req.params;

  try {
    const [points] = await pool.execute('SELECT * FROM level2_points WHERE level1_id = ?', [level1Id]);
    res.json(points);
  } catch (error) {
    console.error('获取二级测试点列表错误:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 添加二级测试点
router.post('/level2/add', authenticateToken, async (req, res) => {
  const { level1_id, name, test_steps, expected_behavior, test_environment, case_name, remarks, chips } = req.body;

  try {
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 添加二级测试点
      const [result] = await connection.execute(
        'INSERT INTO level2_points (level1_id, name, test_steps, expected_behavior, test_environment, case_name, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [level1_id, name, test_steps, expected_behavior, test_environment, case_name, remarks]
      );

      const testpointId = result.insertId;

      // 添加芯片关联
      if (chips && Array.isArray(chips)) {
        for (const chip of chips) {
          // 确保chip_sequence总是有值
          const chipSequence = chip.chip_sequence || '';
          await connection.execute(
            'INSERT INTO testpoint_chips (testpoint_id, chip_id, chip_sequence) VALUES (?, ?, ?)',
            [testpointId, chip.id, chipSequence]
          );

          // 添加测试状态
          await connection.execute(
            'INSERT INTO testpoint_status (testpoint_id, chip_id, test_result) VALUES (?, ?, ?)',
            [testpointId, chip.id, chip.test_result || 'pending']
          );
        }
      }

      // 提交事务
      await connection.commit();
      res.json({ success: true, message: '二级测试点添加成功' });
    } catch (error) {
      // 回滚事务
      await connection.rollback();
      console.error('添加二级测试点事务错误:', error);
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('添加二级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误: ' + error.message });
  }
});

// 编辑二级测试点
router.put('/level2/edit/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, test_steps, expected_behavior, test_environment, case_name, remarks, chips } = req.body;

  try {
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 更新二级测试点
      await connection.execute(
        'UPDATE level2_points SET name = ?, test_steps = ?, expected_behavior = ?, test_environment = ?, case_name = ?, remarks = ? WHERE id = ?',
        [name, test_steps, expected_behavior, test_environment, case_name, remarks, id]
      );

      // 删除旧的芯片关联
      await connection.execute('DELETE FROM testpoint_chips WHERE testpoint_id = ?', [id]);
      await connection.execute('DELETE FROM testpoint_status WHERE testpoint_id = ?', [id]);


      // 添加新的芯片关联
      if (chips && Array.isArray(chips)) {
        for (const chip of chips) {
          // 确保chip_sequence总是有值
          const chipSequence = chip.chip_sequence || '';
          await connection.execute(
            'INSERT INTO testpoint_chips (testpoint_id, chip_id, chip_sequence) VALUES (?, ?, ?)',
            [id, chip.id, chipSequence]
          );

          // 添加测试状态
          await connection.execute(
            'INSERT INTO testpoint_status (testpoint_id, chip_id, test_result) VALUES (?, ?, ?)',
            [id, chip.id, chip.test_result || 'pending']
          );
        }
      }


      // 提交事务
      await connection.commit();
      res.json({ success: true, message: '二级测试点编辑成功' });
    } catch (error) {
      // 回滚事务
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('编辑二级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取测试点关联的芯片
router.get('/level2/:id/chips', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [chips] = await pool.execute(`
      SELECT 
        c.id, 
        c.chip_id,
        c.name,
        tc.chip_sequence,
        ts.test_result
      FROM chips c
      JOIN testpoint_chips tc ON c.id = tc.chip_id
      LEFT JOIN testpoint_status ts ON tc.testpoint_id = ts.testpoint_id AND tc.chip_id = ts.chip_id
      WHERE tc.testpoint_id = ?
      ORDER BY c.id
    `, [id]);

    res.json({ success: true, chips });
  } catch (error) {
    console.error('获取测试点关联芯片错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新测试点芯片状态
router.put('/level2/:id/chip-status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { chip_id, test_result } = req.body;

  try {
    await pool.execute(
      'UPDATE testpoint_status SET test_result = ?, updated_at = CURRENT_TIMESTAMP WHERE testpoint_id = ? AND chip_id = ?',
      [test_result, id, chip_id]
    );

    res.json({ success: true, message: '测试点芯片状态更新成功' });
  } catch (error) {
    console.error('更新测试点芯片状态错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取总体测试统计数据
router.get('/stats/overall', authenticateToken, async (req, res) => {
  const { chip_id } = req.query;

  try {
    let query = `
      SELECT 
        COUNT(DISTINCT ts.testpoint_id) as total_tests,
        SUM(CASE WHEN ts.test_result = 'pass' THEN 1 ELSE 0 END) as passed_tests,
        SUM(CASE WHEN ts.test_result = 'pending' THEN 1 ELSE 0 END) as pending_tests,
        SUM(CASE WHEN ts.test_result = 'fail' THEN 1 ELSE 0 END) as failed_tests,
        SUM(CASE WHEN ts.test_result = 'blocked' THEN 1 ELSE 0 END) as blocked_tests,
        CASE 
          WHEN COUNT(DISTINCT ts.testpoint_id) > 0 
          THEN ROUND((SUM(CASE WHEN ts.test_result = 'pass' THEN 1 ELSE 0 END) / COUNT(DISTINCT ts.testpoint_id)) * 100, 2)
          ELSE 0
        END as total_pass_rate
      FROM testpoint_status ts
    `;

    let modulePassRateQuery = `
      SELECT 
        m.name as module,
        COUNT(DISTINCT ts.testpoint_id) as total_tests,
        SUM(CASE WHEN ts.test_result = 'pass' THEN 1 ELSE 0 END) as passed_tests,
        CASE 
          WHEN COUNT(DISTINCT ts.testpoint_id) > 0 
          THEN ROUND((SUM(CASE WHEN ts.test_result = 'pass' THEN 1 ELSE 0 END) / COUNT(DISTINCT ts.testpoint_id)) * 100, 2)
          ELSE 0
        END as pass_rate
      FROM testpoint_status ts
      JOIN level2_points l2 ON ts.testpoint_id = l2.id
      JOIN level1_points l1 ON l2.level1_id = l1.id
      JOIN modules m ON l1.module_id = m.id
    `;

    let params = [];

    if (chip_id) {
      query += ' WHERE ts.chip_id = ?';
      modulePassRateQuery += ' WHERE ts.chip_id = ?';
      params.push(chip_id);
    }

    modulePassRateQuery += ' GROUP BY m.name ORDER BY m.id';

    // 获取总体统计
    const [overallStats] = await pool.execute(query, params);
    const stats = overallStats[0];

    // 获取各模块通过率
    const [moduleStats] = await pool.execute(modulePassRateQuery, params);
    const modulePassRates = moduleStats.map(item => ({
      module: item.module,
      passRate: item.pass_rate
    }));

    stats.module_pass_rates = modulePassRates;

    res.json({ success: true, stats });
  } catch (error) {
    console.error('获取总体测试统计数据错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除二级测试点
router.delete('/level2/delete/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 删除关联的芯片状态
      await connection.execute('DELETE FROM testpoint_status WHERE testpoint_id = ?', [id]);

      // 删除关联的芯片
      await connection.execute('DELETE FROM testpoint_chips WHERE testpoint_id = ?', [id]);

      // 删除测试点
      await connection.execute('DELETE FROM level2_points WHERE id = ?', [id]);

      // 提交事务
      await connection.commit();
      res.json({ success: true, message: '二级测试点删除成功' });
    } catch (error) {
      // 回滚事务
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除二级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ==================== 测试用例执行记录 API ====================

// 获取测试用例的执行记录列表
router.get('/execution-records/:caseId', authenticateToken, async (req, res) => {
  const { caseId } = req.params;
  
  try {
    const [records] = await pool.execute(`
      SELECT 
        id,
        record_type as type,
        bug_id as bugId,
        bug_type as bugType,
        description,
        images,
        creator,
        created_at as createdAt,
        updated_at as updatedAt
      FROM case_execution_records
      WHERE case_id = ?
      ORDER BY created_at DESC
    `, [caseId]);
    
    // 解析images JSON字段
    const parsedRecords = records.map(record => ({
      ...record,
      images: safeParseJSON(record.images) || []
    }));
    
    res.json({ success: true, records: parsedRecords });
  } catch (error) {
    console.error('获取执行记录错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 添加执行记录
router.post('/execution-records', authenticateToken, async (req, res) => {
  const { caseId, type, bugId, bugType, description, images } = req.body;
  const currentUser = req.user;
  
  // 输入验证
  if (!caseId) {
    return res.status(400).json({ success: false, message: '测试用例ID不能为空' });
  }
  
  if (!type || !['defect', 'other'].includes(type)) {
    return res.status(400).json({ success: false, message: '记录类型无效' });
  }
  
  if (type === 'defect' && (!bugId || bugId.trim() === '')) {
    return res.status(400).json({ success: false, message: '缺陷类型必须填写Bug ID' });
  }
  
  try {
    const imagesJson = images && images.length > 0 ? JSON.stringify(images) : null;
    
    const [result] = await pool.execute(`
      INSERT INTO case_execution_records (case_id, record_type, bug_id, bug_type, description, images, creator)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [caseId, type, bugId || null, bugType || null, description || null, imagesJson, currentUser.username]);
    
    // 获取新插入的记录
    const [newRecord] = await pool.execute(`
      SELECT 
        id,
        record_type as type,
        bug_id as bugId,
        bug_type as bugType,
        description,
        images,
        creator,
        created_at as createdAt,
        updated_at as updatedAt
      FROM case_execution_records
      WHERE id = ?
    `, [result.insertId]);
    
    res.json({ 
      success: true, 
      message: '执行记录添加成功',
      record: {
        ...newRecord[0],
        images: safeParseJSON(newRecord[0].images) || []
      }
    });
  } catch (error) {
    console.error('添加执行记录错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除执行记录
router.delete('/execution-records/:recordId', authenticateToken, async (req, res) => {
  const { recordId } = req.params;
  const currentUser = req.user;
  
  try {
    // 检查记录是否存在
    const [existing] = await pool.execute(
      'SELECT * FROM case_execution_records WHERE id = ?',
      [recordId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    
    await pool.execute('DELETE FROM case_execution_records WHERE id = ?', [recordId]);
    
    res.json({ success: true, message: '执行记录删除成功' });
  } catch (error) {
    console.error('删除执行记录错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 编辑执行记录
router.put('/execution-records/:recordId', authenticateToken, async (req, res) => {
  const { recordId } = req.params;
  const { type, bugId, bugType, description, images } = req.body;
  const currentUser = req.user;
  
  // 输入验证
  if (!type || !['defect', 'other'].includes(type)) {
    return res.status(400).json({ success: false, message: '记录类型无效' });
  }
  
  if (type === 'defect' && (!bugId || bugId.trim() === '')) {
    return res.status(400).json({ success: false, message: '缺陷类型必须填写Bug ID' });
  }
  
  try {
    // 检查记录是否存在
    const [existing] = await pool.execute(
      'SELECT * FROM case_execution_records WHERE id = ?',
      [recordId]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    
    const imagesJson = images && images.length > 0 ? JSON.stringify(images) : null;
    
    await pool.execute(`
      UPDATE case_execution_records 
      SET record_type = ?, bug_id = ?, bug_type = ?, description = ?, images = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [type, bugId || null, bugType || null, description || null, imagesJson, recordId]);
    
    // 获取更新后的记录
    const [updatedRecord] = await pool.execute(`
      SELECT 
        id,
        record_type as type,
        bug_id as bugId,
        bug_type as bugType,
        description,
        images,
        creator,
        created_at as createdAt,
        updated_at as updatedAt
      FROM case_execution_records
      WHERE id = ?
    `, [recordId]);
    
    res.json({ 
      success: true, 
      message: '执行记录更新成功',
      record: {
        ...updatedRecord[0],
        images: safeParseJSON(updatedRecord[0].images) || []
      }
    });
  } catch (error) {
    console.error('编辑执行记录错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;