const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');
const { logActivity } = require('./history');

// 获取用例库列表
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const [libraries] = await pool.execute(`
      SELECT 
        cl.*,
        (SELECT COUNT(*) FROM modules m WHERE m.library_id = cl.id) as actual_module_count
      FROM case_libraries cl
      ORDER BY cl.created_at DESC
    `);
    
    res.json({
      success: true,
      libraries: libraries.map(library => ({
        id: library.id,
        name: library.name,
        creator: library.creator,
        createdAt: library.created_at,
        moduleCount: library.actual_module_count || 0,
        config: library.config || ''
      }))
    });
  } catch (error) {
    console.error('获取用例库列表错误:', error);
    res.json({
      success: false,
      message: '获取用例库列表失败'
    });
  }
});

// 创建用例库
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { name, creator, createdAt, moduleCount, config } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    // 检查名称是否重复
    const [existing] = await pool.execute(
      'SELECT id FROM case_libraries WHERE name = ?',
      [name]
    );
    if (existing.length > 0) {
      return res.json({
        success: false,
        message: '用例库名称已存在，请使用其他名称'
      });
    }
    
    const [result] = await pool.execute(
      'INSERT INTO case_libraries (name, creator, created_at, module_count, config) VALUES (?, ?, ?, ?, ?)',
      [name, creator || currentUser.username, createdAt || new Date(), moduleCount || 0, config || '']
    );
    
    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '创建用例库', `创建了用例库 ${name}`, 'case_library', result.insertId, ipAddress, userAgent);
    
    res.json({
      success: true,
      libraryId: result.insertId
    });
  } catch (error) {
    console.error('创建用例库错误:', error);
    res.json({
      success: false,
      message: '创建用例库失败'
    });
  }
});

// 获取用例库详情
router.get('/detail/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [libraries] = await pool.execute(`
      SELECT 
        cl.*,
        (SELECT COUNT(*) FROM modules m WHERE m.library_id = cl.id) as actual_module_count
      FROM case_libraries cl
      WHERE cl.id = ?
    `, [id]);
    
    if (libraries.length === 0) {
      res.json({
        success: false,
        message: '用例库不存在'
      });
      return;
    }
    
    res.json({
      success: true,
      library: {
        id: libraries[0].id,
        name: libraries[0].name,
        creator: libraries[0].creator,
        createdAt: libraries[0].created_at,
        moduleCount: libraries[0].actual_module_count || 0,
        config: libraries[0].config || ''
      }
    });
  } catch (error) {
    console.error('获取用例库详情错误:', error);
    res.json({
      success: false,
      message: '获取用例库详情失败'
    });
  }
});

// 更新用例库
router.put('/update/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, moduleCount, config } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    await pool.execute(
      'UPDATE case_libraries SET name = ?, module_count = ?, config = ? WHERE id = ?',
      [name, moduleCount || 0, config || '', id]
    );
    
    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '更新用例库', `更新了用例库 ${name}`, 'case_library', parseInt(id), ipAddress, userAgent);
    
    res.json({
      success: true,
      message: '用例库更新成功'
    });
  } catch (error) {
    console.error('更新用例库错误:', error);
    res.json({
      success: false,
      message: '更新用例库失败'
    });
  }
});

// 删除用例库 - 高危操作，需要管理员权限
// 删除策略：级联删除（硬删除）- 在事务中删除所有关联数据
// 优化：先查询所有ID，再批量删除，避免子查询性能问题
router.delete('/:id', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    const { id } = req.params;
    
    // 获取用例库信息
    const [libraries] = await connection.execute('SELECT name FROM case_libraries WHERE id = ?', [id]);
    if (libraries.length === 0) {
      return res.json({ success: false, message: '用例库不存在' });
    }
    const libraryName = libraries[0].name;
    
    console.log(`[高危操作] 开始删除用例库 ID: ${id}`);
    const startTime = Date.now();
    
    // 开始事务
    await connection.beginTransaction();
    
    // 1. 获取该用例库下所有模块的ID
    const [modules] = await connection.execute(
      'SELECT id FROM modules WHERE library_id = ?',
      [id]
    );
    const moduleIds = modules.map(m => m.id);
    console.log(`[删除进度] 找到 ${moduleIds.length} 个模块`);
    
    if (moduleIds.length === 0) {
      // 没有关联模块，直接删除用例库
      const [result] = await connection.execute(
        'DELETE FROM case_libraries WHERE id = ?',
        [id]
      );
      
      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.json({ success: false, message: '用例库不存在或已被删除' });
      }
      
      await connection.commit();
      return res.json({ success: true, message: '用例库删除成功' });
    }
    
    // 2. 获取所有一级测试点的ID
    const modulePlaceholders = moduleIds.map(() => '?').join(',');
    const [level1Points] = await connection.execute(
      `SELECT id FROM level1_points WHERE module_id IN (${modulePlaceholders})`,
      moduleIds
    );
    const level1Ids = level1Points.map(l => l.id);
    console.log(`[删除进度] 找到 ${level1Ids.length} 个一级测试点`);
    
    if (level1Ids.length > 0) {
      const level1Placeholders = level1Ids.map(() => '?').join(',');
      
      // 3. 获取所有测试用例的ID
      const [testCases] = await connection.execute(
        `SELECT id FROM test_cases WHERE level1_id IN (${level1Placeholders})`,
        level1Ids
      );
      const testCaseIds = testCases.map(tc => tc.id);
      console.log(`[删除进度] 找到 ${testCaseIds.length} 个测试用例`);
      
      // 4. 批量删除测试用例项目关联（分批处理，每批1000条）
      if (testCaseIds.length > 0) {
        const batchSize = 1000;
        for (let i = 0; i < testCaseIds.length; i += batchSize) {
          const batch = testCaseIds.slice(i, i + batchSize);
          const batchPlaceholders = batch.map(() => '?').join(',');
          await connection.execute(
            `DELETE FROM test_case_projects WHERE test_case_id IN (${batchPlaceholders})`,
            batch
          );
        }
        console.log(`[删除进度] 已删除测试用例项目关联`);
      }
      
      // 5. 批量软删除测试用例（分批处理）
      if (testCaseIds.length > 0) {
        const batchSize = 1000;
        for (let i = 0; i < testCaseIds.length; i += batchSize) {
          const batch = testCaseIds.slice(i, i + batchSize);
          const batchPlaceholders = batch.map(() => '?').join(',');
          await connection.execute(
            `UPDATE test_cases SET is_deleted = 1, deleted_at = NOW() WHERE id IN (${batchPlaceholders})`,
            batch
          );
        }
        console.log(`[删除进度] 已软删除测试用例`);
      }
      
      // 6. 批量删除一级测试点
      const batchSize = 1000;
      for (let i = 0; i < level1Ids.length; i += batchSize) {
        const batch = level1Ids.slice(i, i + batchSize);
        const batchPlaceholders = batch.map(() => '?').join(',');
        await connection.execute(
          `DELETE FROM level1_points WHERE id IN (${batchPlaceholders})`,
          batch
        );
      }
      console.log(`[删除进度] 已删除一级测试点`);
    }
    
    // 7. 批量删除模块
    const batchSize = 1000;
    for (let i = 0; i < moduleIds.length; i += batchSize) {
      const batch = moduleIds.slice(i, i + batchSize);
      const batchPlaceholders = batch.map(() => '?').join(',');
      await connection.execute(
        `DELETE FROM modules WHERE id IN (${batchPlaceholders})`,
        batch
      );
    }
    console.log(`[删除进度] 已删除模块`);
    
    // 8. 最后删除用例库本身
    const [result] = await connection.execute(
      'DELETE FROM case_libraries WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.json({ success: false, message: '用例库不存在或已被删除' });
    }
    
    // 提交事务
    await connection.commit();
    
    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '删除用例库', `删除了用例库 ${libraryName}，包含 ${moduleIds.length} 个模块`, 'case_library', parseInt(id), ipAddress, userAgent);
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(`[高危操作完成] 用例库 ID: ${id} 已删除，耗时: ${duration}秒`);
    console.log(`  - 删除模块: ${moduleIds.length} 个`);
    console.log(`  - 删除一级测试点: ${level1Ids.length} 个`);
    
    res.json({
      success: true,
      message: '用例库删除成功',
      deletedData: {
        modules: moduleIds.length,
        level1Points: level1Ids.length
      }
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('删除用例库错误:', error);
    res.status(500).json({
      success: false,
      message: '删除用例库失败: ' + error.message
    });
  } finally {
    connection.release();
  }
});

// 兼容旧的删除路由
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  // 转发到新的删除路由
  req.url = `/${id}`;
  return router.handle(req, res, () => {});
});

/**
 * POST /api/libraries/clone
 * 深度克隆用例库（包含所有模块、测试点、测试用例）
 */
router.post('/clone', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { 
      sourceLibraryId, 
      newLibraryName,
      includeLevel1Points = true,
      includeTestCases = true,
      clearTestStatus = true,
      clearOwner = true,
      clearProjects = true,
      clearExecutionRecords = true
    } = req.body;
    
    const currentUser = req.user;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    if (!sourceLibraryId || !newLibraryName) {
      return res.json({ success: false, message: '缺少必要参数' });
    }
    
    await connection.beginTransaction();
    
    // 1. 获取源用例库信息
    const [sourceLibraries] = await connection.execute(
      'SELECT * FROM case_libraries WHERE id = ?',
      [sourceLibraryId]
    );
    
    if (sourceLibraries.length === 0) {
      await connection.rollback();
      return res.json({ success: false, message: '源用例库不存在' });
    }
    
    const sourceLibrary = sourceLibraries[0];
    
    // 2. 创建新用例库
    const [libraryResult] = await connection.execute(
      'INSERT INTO case_libraries (name, creator, created_at, module_count, config) VALUES (?, ?, NOW(), 0, ?)',
      [newLibraryName, currentUser.username, sourceLibrary.config || '']
    );
    const newLibraryId = libraryResult.insertId;
    
    console.log(`[克隆用例库] 创建新用例库: ${newLibraryName}, ID: ${newLibraryId}`);
    
    // 检查新用例库名称是否重复
    const [existingLibs] = await connection.execute(
      'SELECT id FROM case_libraries WHERE name = ? AND id != ?',
      [newLibraryName, newLibraryId]
    );
    if (existingLibs.length > 0) {
      await connection.rollback();
      return res.json({ success: false, message: '用例库名称已存在，请使用其他名称' });
    }
    
    // 统计变量
    let clonedModuleCount = 0;
    let clonedLevel1Count = 0;
    let clonedCaseCount = 0;
    
    // 3. 获取源用例库下所有模块
    const [modules] = await connection.execute(
      'SELECT * FROM modules WHERE library_id = ? ORDER BY order_index ASC',
      [sourceLibraryId]
    );
    
    console.log(`[克隆用例库] 找到 ${modules.length} 个模块待克隆`);
    
    // 4. 批量克隆模块（每批50个）
    const moduleOldIds = [];
    const moduleNewDbIds = [];
    for (const module of modules) {
      const newModuleId = 'MODULE_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      const [moduleResult] = await connection.execute(
        'INSERT INTO modules (module_id, name, library_id, order_index) VALUES (?, ?, ?, ?)',
        [newModuleId, module.name, newLibraryId, module.order_index]
      );
      moduleOldIds.push(module.id);
      moduleNewDbIds.push(moduleResult.insertId);
      clonedModuleCount++;
    }
    
    // 建立模块ID映射
    const moduleOldIdToNewId = new Map();
    for (let i = 0; i < moduleOldIds.length; i++) {
      moduleOldIdToNewId.set(moduleOldIds[i], moduleNewDbIds[i]);
    }
    
    // 5. 批量克隆一级测试点（每批100个）
    const level1IdMap = new Map();
    const caseIdMap = new Map();
    if (includeLevel1Points) {
      for (let i = 0; i < modules.length; i++) {
        const oldModuleId = moduleOldIds[i];
        const newModuleDbId = moduleNewDbIds[i];
        
        const [level1Points] = await connection.execute(
          'SELECT * FROM level1_points WHERE module_id = ? ORDER BY order_index ASC',
          [oldModuleId]
        );
        
        if (level1Points.length === 0) continue;
        
        // 分批插入测试点
        const batchSize = 100;
        for (let j = 0; j < level1Points.length; j += batchSize) {
          const batch = level1Points.slice(j, j + batchSize);
          const values = [];
          const placeholders = [];
          
          for (const l1 of batch) {
            placeholders.push('(?, ?, ?, ?)');
            values.push(newModuleDbId, l1.name, l1.test_type, l1.order_index);
          }
          
          await connection.execute(
            `INSERT INTO level1_points (module_id, name, test_type, order_index) VALUES ${placeholders.join(', ')}`,
            values
          );
          
          // 获取新插入的测试点ID
          const [newLevel1s] = await connection.execute(
            `SELECT id FROM level1_points WHERE module_id = ? ORDER BY id DESC LIMIT ${batch.length}`,
            [newModuleDbId]
          );
          
          // 建立ID映射
          for (let k = 0; k < batch.length; k++) {
            level1IdMap.set(batch[k].id, newLevel1s[k].id);
          }
        }
        
        clonedLevel1Count += level1Points.length;
      }
    }
    
    // 6. 批量克隆测试用例（每批100个）
    if (includeTestCases) {
      const baseTime = Date.now();
      let caseIndex = 0;
      
      for (let i = 0; i < modules.length; i++) {
        const oldModuleId = moduleOldIds[i];
        const newModuleDbId = moduleNewDbIds[i];
        
        const [testCases] = await connection.execute(
          'SELECT * FROM test_cases WHERE module_id = ? AND is_deleted = 0',
          [oldModuleId]
        );
        
        if (testCases.length === 0) continue;
        
        // 分批插入用例
        const batchSize = 50;
        for (let j = 0; j < testCases.length; j += batchSize) {
          const batch = testCases.slice(j, j + batchSize);
          const values = [];
          const placeholders = [];
          
          for (const tc of batch) {
            const newCaseId = `CASE-${baseTime}-${caseIndex++}`;
            const newLevel1Id = tc.level1_id ? (level1IdMap.get(tc.level1_id) || null) : null;
            const owner = clearOwner ? currentUser.username : tc.owner;
            const status = clearTestStatus ? '维护中' : tc.status;
            
            placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            values.push(
              newCaseId, tc.name, tc.priority, tc.type, tc.precondition, tc.purpose,
              tc.steps, tc.expected, currentUser.username, newLibraryId, newModuleDbId,
              newLevel1Id, owner, status, tc.key_config, tc.remark, tc.method
            );
          }
          
          await connection.execute(
            `INSERT INTO test_cases (
              case_id, name, priority, type, precondition, purpose, 
              steps, expected, creator, library_id, module_id, level1_id,
              owner, status, key_config, remark, method
            ) VALUES ${placeholders.join(', ')}`,
            values
          );
          
          // 获取新插入的用例ID，建立映射关系
          const [newCases] = await connection.execute(
            `SELECT id, case_id FROM test_cases WHERE module_id = ? ORDER BY id DESC LIMIT ${batch.length}`,
            [newModuleDbId]
          );
          
          // 建立 old_case.id -> new_case.id 映射
          for (let k = 0; k < batch.length; k++) {
            caseIdMap.set(batch[k].id, newCases[k].id);
          }
          
          clonedCaseCount += batch.length;
          
          if (clonedCaseCount % 5000 === 0) {
            console.log(`[克隆用例库] 已插入 ${clonedCaseCount} 条用例`);
          }
        }
      }
      
      // 6.5 克隆测试用例的多对多关联数据
      if (caseIdMap.size > 0) {
        console.log(`[克隆用例库] 开始克隆关联数据，用例数: ${caseIdMap.size}`);
        
        // 克隆测试环境关联
        const [envRelations] = await connection.execute(
          `SELECT tce.* FROM test_case_environments tce
           JOIN test_cases tc ON tce.test_case_id = tc.id
           WHERE tc.library_id = ?`,
          [sourceLibraryId]
        );
        
        for (const rel of envRelations) {
          const newCaseId = caseIdMap.get(rel.test_case_id);
          if (newCaseId) {
            await connection.execute(
              'INSERT INTO test_case_environments (test_case_id, environment_id) VALUES (?, ?)',
              [newCaseId, rel.environment_id]
            );
          }
        }
        
        // 克隆测试方式关联
        const [methodRelations] = await connection.execute(
          `SELECT tcm.* FROM test_case_methods tcm
           JOIN test_cases tc ON tcm.test_case_id = tc.id
           WHERE tc.library_id = ?`,
          [sourceLibraryId]
        );
        
        for (const rel of methodRelations) {
          const newCaseId = caseIdMap.get(rel.test_case_id);
          if (newCaseId) {
            await connection.execute(
              'INSERT INTO test_case_methods (test_case_id, method_id) VALUES (?, ?)',
              [newCaseId, rel.method_id]
            );
          }
        }
        
        // 克隆测试阶段关联
        const [phaseRelations] = await connection.execute(
          `SELECT tcp.* FROM test_case_phases tcp
           JOIN test_cases tc ON tcp.test_case_id = tc.id
           WHERE tc.library_id = ?`,
          [sourceLibraryId]
        );
        
        for (const rel of phaseRelations) {
          const newCaseId = caseIdMap.get(rel.test_case_id);
          if (newCaseId) {
            await connection.execute(
              'INSERT INTO test_case_phases (test_case_id, phase_id) VALUES (?, ?)',
              [newCaseId, rel.phase_id]
            );
          }
        }
        
        // 克隆测试类型关联
        const [typeRelations] = await connection.execute(
          `SELECT tct.* FROM test_case_test_types tct
           JOIN test_cases tc ON tct.test_case_id = tc.id
           WHERE tc.library_id = ?`,
          [sourceLibraryId]
        );
        
        for (const rel of typeRelations) {
          const newCaseId = caseIdMap.get(rel.test_case_id);
          if (newCaseId) {
            await connection.execute(
              'INSERT INTO test_case_test_types (test_case_id, type_id) VALUES (?, ?)',
              [newCaseId, rel.type_id]
            );
          }
        }
        
        // 克隆测试来源关联
        const [sourceRelations] = await connection.execute(
          `SELECT tcs.* FROM test_case_sources tcs
           JOIN test_cases tc ON tcs.test_case_id = tc.id
           WHERE tc.library_id = ?`,
          [sourceLibraryId]
        );
        
        for (const rel of sourceRelations) {
          const newCaseId = caseIdMap.get(rel.test_case_id);
          if (newCaseId) {
            await connection.execute(
              'INSERT INTO test_case_sources (test_case_id, source_id) VALUES (?, ?)',
              [newCaseId, rel.source_id]
            );
          }
        }
        
        // 克隆测试用例项目关联（如果不清空管理项目）
        if (!clearProjects) {
          const [projectRelations] = await connection.execute(
            `SELECT tcp.* FROM test_case_projects tcp
             JOIN test_cases tc ON tcp.test_case_id = tc.id
             WHERE tc.library_id = ?`,
            [sourceLibraryId]
          );
          
          for (const rel of projectRelations) {
            const newCaseId = caseIdMap.get(rel.test_case_id);
            if (newCaseId) {
              await connection.execute(
                'INSERT IGNORE INTO test_case_projects (test_case_id, project_id, progress_id, status_id, remark) VALUES (?, ?, ?, ?, ?)',
                [newCaseId, rel.project_id, rel.progress_id, rel.status_id, rel.remark]
              );
            }
          }
          console.log(`[克隆用例库] 已克隆测试用例项目关联`);
        }
        
        // 克隆执行记录（如果不清空执行记录）
        if (!clearExecutionRecords) {
          const [executionRecords] = await connection.execute(
            `SELECT cer.* FROM case_execution_records cer
             JOIN test_cases tc ON cer.case_id = tc.id
             WHERE tc.library_id = ?`,
            [sourceLibraryId]
          );
          
          for (const record of executionRecords) {
            const newCaseId = caseIdMap.get(record.case_id);
            if (newCaseId) {
              await connection.execute(
                `INSERT INTO case_execution_records (case_id, record_type, bug_id, bug_type, description, images, creator, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [newCaseId, record.record_type, record.bug_id, record.bug_type, record.description, record.images, record.creator, record.created_at]
              );
            }
          }
          console.log(`[克隆用例库] 已克隆执行记录`);
        }
        
        console.log(`[克隆用例库] 关联数据克隆完成`);
      }
    }
    
    // 7. 更新新用例库的模块数量
    await connection.execute(
      'UPDATE case_libraries SET module_count = ? WHERE id = ?',
      [clonedModuleCount, newLibraryId]
    );
    
    // 8. 记录操作日志
    await logActivity(
      currentUser.id, 
      currentUser.username, 
      currentUser.role, 
      '克隆用例库', 
      `从用例库 "${sourceLibrary.name}" 克隆创建新用例库 "${newLibraryName}"，包含 ${clonedModuleCount} 个模块，${clonedLevel1Count} 个测试点，${clonedCaseCount} 个用例`, 
      'case_library', 
      newLibraryId, 
      ipAddress, 
      userAgent
    );
    
    await connection.commit();
    
    console.log(`[克隆用例库完成] 新用例库ID: ${newLibraryId}`);
    console.log(`  - 克隆模块: ${clonedModuleCount} 个`);
    console.log(`  - 克隆测试点: ${clonedLevel1Count} 个`);
    console.log(`  - 克隆用例: ${clonedCaseCount} 个`);
    
    res.json({ 
      success: true, 
      message: '用例库克隆成功',
      data: {
        libraryId: newLibraryId,
        libraryName: newLibraryName,
        clonedModuleCount,
        clonedLevel1Count,
        clonedCaseCount
      }
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('克隆用例库错误:', error);
    res.json({ success: false, message: '克隆失败: ' + error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;