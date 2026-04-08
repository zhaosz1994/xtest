const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');
const { logActivity } = require('./history');
const logger = require('../services/logger');

logger.debug('模块路由已加载');

// 获取模块列表（支持分页和按用例库过滤）
router.post('/list', async (req, res) => {
  try {
    console.log('接收到模块列表请求:', req.body);
    const { libraryId, page = 1, pageSize = 32 } = req.body;
    const offset = (page - 1) * pageSize;
    
    let query = `
      SELECT m.id, m.module_id, m.name, m.library_id, m.order_index,
             COUNT(tc.id) as case_count
      FROM modules m
      LEFT JOIN test_cases tc ON m.id = tc.module_id AND tc.is_deleted = 0
      WHERE 1=1
    `;
    let params = [];
    
    if (libraryId) {
      query += ' AND m.library_id = ?';
      params.push(libraryId);
    }
    
    // 使用模板字符串直接拼接 LIMIT 和 OFFSET，避免 mysql2 预处理语句的类型问题
    const limitValue = parseInt(pageSize);
    const offsetValue = parseInt(offset);
    
    query += ` GROUP BY m.id ORDER BY m.order_index ASC, m.created_at DESC LIMIT ${limitValue} OFFSET ${offsetValue}`;
    
    const [modules] = await pool.query(query, params);
    
    console.log('查询结果:', modules);
    
    res.json({ 
      success: true,
      modules: modules.map(module => ({
        id: module.id,
        name: module.name,
        orderIndex: module.order_index,
        caseCount: module.case_count || 0
      }))
    });
  } catch (error) {
    logger.error('获取模块列表错误:', { error: error.message });
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 添加模块
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { name, libraryId } = req.body;
    const currentUser = req.user;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    // 检查同一用例库下模块名称是否重复
    const [existing] = await pool.execute(
      'SELECT id FROM modules WHERE name = ? AND library_id = ?',
      [name, libraryId]
    );
    if (existing.length > 0) {
      return res.json({ 
        success: false, 
        message: '该用例库下已存在同名模块，请使用其他名称' 
      });
    }
    
    // 生成唯一的module_id
    const moduleId = 'MODULE_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    // 获取当前最大的order_index
    let orderIndex = 0;
    if (libraryId) {
      const [result] = await pool.execute(
        'SELECT MAX(order_index) as max_order FROM modules WHERE library_id = ?',
        [libraryId]
      );
      if (result[0].max_order !== null) {
        orderIndex = result[0].max_order + 1;
      }
    }
    
    const [insertResult] = await pool.execute(
      'INSERT INTO modules (module_id, name, library_id, order_index) VALUES (?, ?, ?, ?)',
      [moduleId, name, libraryId, orderIndex]
    );
    
    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '创建模块', `创建了模块 ${name}`, 'module', insertResult.insertId, ipAddress, userAgent);
    
    res.json({ success: true, message: '模块添加成功' });
  } catch (error) {
    logger.error('添加模块错误:', { error: error.message });
    res.json({ success: false, message: '服务器错误' });
  }
});

// 搜索模块
router.post('/search', async (req, res) => {
  try {
    const { libraryId, searchTerm, page = 1, pageSize = 32 } = req.body;
    const offset = (page - 1) * pageSize;
    
    let query = 'SELECT id, module_id, name, library_id, order_index FROM modules WHERE 1=1';
    let params = [];
    
    if (libraryId) {
      query += ' AND library_id = ?';
      params.push(libraryId);
    }
    
    if (searchTerm) {
      query += ' AND name LIKE ?';
      params.push('%' + searchTerm + '%');
    }
    
    // 使用模板字符串直接拼接 LIMIT 和 OFFSET，避免 mysql2 预处理语句的类型问题
    const limitValue = parseInt(pageSize);
    const offsetValue = parseInt(offset);
    
    query += ` ORDER BY order_index ASC, created_at DESC LIMIT ${limitValue} OFFSET ${offsetValue}`;
    
    const [modules] = await pool.execute(query, params);
    
    res.json({ 
      success: true,
      modules: modules.map(module => ({
        id: module.id,
        name: module.name,
        orderIndex: module.order_index
      }))
    });
  } catch (error) {
    logger.error('搜索模块错误:', { error: error.message });
    res.json({ success: false, message: '服务器错误' });
  }
});

// 调整模块顺序
router.post('/reorder', async (req, res) => {
  try {
    const { modules, libraryId } = req.body;
    
    if (!Array.isArray(modules) || !libraryId) {
      return res.json({ success: false, message: '参数错误' });
    }
    
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 更新每个模块的order_index
      for (let i = 0; i < modules.length; i++) {
        await connection.execute(
          'UPDATE modules SET order_index = ? WHERE name = ? AND library_id = ?',
          [i, modules[i], libraryId]
        );
      }
      
      await connection.commit();
      res.json({ success: true, message: '模块顺序调整成功' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error('调整模块顺序错误:', { error: error.message });
    res.json({ success: false, message: '服务器错误' });
  }
});

// 批量创建模块（用于测试）
router.post('/batchCreate', async (req, res) => {
  try {
    const { modules } = req.body;
    
    if (!Array.isArray(modules)) {
      return res.json({ success: false, message: '参数错误' });
    }
    
    for (const module of modules) {
      const moduleId = 'MODULE_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      await pool.execute(
        'INSERT INTO modules (module_id, name, library_id) VALUES (?, ?, ?)',
        [moduleId, module.name, module.libraryId]
      );
    }
    
    res.json({ success: true, message: '批量创建模块成功' });
  } catch (error) {
    logger.error('批量创建模块错误:', { error: error.message });
    res.json({ success: false, message: '服务器错误' });
  }
});

// 深度克隆模块（包含一级测试点和测试用例）
router.post('/clone', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { 
      sourceModuleId, 
      newModuleName, 
      targetLibraryId,
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
    
    if (!sourceModuleId || !newModuleName || !targetLibraryId) {
      return res.json({ success: false, message: '缺少必要参数' });
    }
    
    await connection.beginTransaction();
    
    // 1. 获取源模块信息
    const [sourceModules] = await connection.execute(
      'SELECT * FROM modules WHERE id = ?',
      [sourceModuleId]
    );
    
    if (sourceModules.length === 0) {
      await connection.rollback();
      return res.json({ success: false, message: '源模块不存在' });
    }
    
    const sourceModule = sourceModules[0];
    
    // 2. 创建新模块
    const newModuleId = 'MODULE_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const [moduleResult] = await connection.execute(
      'INSERT INTO modules (module_id, name, library_id, order_index) VALUES (?, ?, ?, ?)',
      [newModuleId, newModuleName, targetLibraryId, 0]
    );
    const newModuleDbId = moduleResult.insertId;
    
    console.log(`[克隆] 创建新模块: ${newModuleName}, ID: ${newModuleDbId}`);
    
    // ID映射表：old_id -> new_id
    const level1IdMap = new Map();
    const caseIdMap = new Map();
    let clonedLevel1Count = 0;
    let clonedCaseCount = 0;
    
    // 3. 克隆一级测试点
    if (includeLevel1Points) {
      const [level1Points] = await connection.execute(
        'SELECT * FROM level1_points WHERE module_id = ? ORDER BY order_index ASC',
        [sourceModuleId]
      );
      
      for (const level1 of level1Points) {
        const [level1Result] = await connection.execute(
          'INSERT INTO level1_points (module_id, name, test_type, order_index) VALUES (?, ?, ?, ?)',
          [newModuleDbId, level1.name, level1.test_type, level1.order_index]
        );
        
        level1IdMap.set(level1.id, level1Result.insertId);
        clonedLevel1Count++;
      }
      
      console.log(`[克隆] 克隆了 ${clonedLevel1Count} 个一级测试点`);
    }
    
    // 4. 克隆测试用例
    if (includeTestCases) {
      const [testCases] = await connection.execute(
        'SELECT * FROM test_cases WHERE module_id = ?',
        [sourceModuleId]
      );
      
      for (const tc of testCases) {
        // 生成新的case_id
        const newCaseId = 'CASE-' + new Date().toISOString().slice(0,10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 10000);
        
        // 确定level1_id的映射
        let newLevel1Id = null;
        if (tc.level1_id && level1IdMap.has(tc.level1_id)) {
          newLevel1Id = level1IdMap.get(tc.level1_id);
        }
        
        // 处理需要重置的字段
        let owner = tc.owner;
        let status = tc.status;
        
        if (clearOwner) {
          owner = currentUser.username;
        }
        if (clearTestStatus) {
          status = '维护中';
        }
        
        const [caseResult] = await connection.execute(
          `INSERT INTO test_cases (
            case_id, name, priority, type, precondition, purpose, 
            steps, expected, creator, library_id, module_id, level1_id,
            owner, status, method, key_config, remark
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newCaseId,
            tc.name,
            tc.priority,
            tc.type,
            tc.precondition,
            tc.purpose,
            tc.steps,
            tc.expected,
            currentUser.username,
            targetLibraryId,
            newModuleDbId,
            newLevel1Id,
            owner,
            status,
            tc.method || '自动化',
            tc.key_config,
            tc.remark
          ]
        );
        
        // 记录用例ID映射，用于后续克隆关联数据
        const newCaseDbId = caseResult.insertId;
        caseIdMap.set(tc.id, newCaseDbId);
        
        clonedCaseCount++;
      }
      
      console.log(`[克隆] 克隆了 ${clonedCaseCount} 个测试用例`);
      
      // 5. 克隆测试用例的多对多关联数据
      if (caseIdMap.size > 0) {
        // 克隆测试环境关联
        const [envRelations] = await connection.execute(
          `SELECT tce.* FROM test_case_environments tce
           JOIN test_cases tc ON tce.test_case_id = tc.id
           WHERE tc.module_id = ?`,
          [sourceModuleId]
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
           WHERE tc.module_id = ?`,
          [sourceModuleId]
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
           WHERE tc.module_id = ?`,
          [sourceModuleId]
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
           WHERE tc.module_id = ?`,
          [sourceModuleId]
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
           WHERE tc.module_id = ?`,
          [sourceModuleId]
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
             WHERE tc.module_id = ?`,
            [sourceModuleId]
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
          console.log(`[克隆] 已克隆测试用例项目关联`);
        }
        
        // 克隆执行记录（如果不清空执行记录）
        if (!clearExecutionRecords) {
          const [executionRecords] = await connection.execute(
            `SELECT cer.* FROM case_execution_records cer
             JOIN test_cases tc ON cer.case_id = tc.id
             WHERE tc.module_id = ?`,
            [sourceModuleId]
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
          console.log(`[克隆] 已克隆执行记录`);
        }
        
        console.log(`[克隆] 已克隆测试用例关联数据`);
      }
    }
    
    // 5. 记录操作日志
    await logActivity(
      currentUser.id, 
      currentUser.username, 
      currentUser.role, 
      '克隆模块', 
      `从模块 "${sourceModule.name}" 克隆创建新模块 "${newModuleName}"，包含 ${clonedLevel1Count} 个测试点，${clonedCaseCount} 个用例`, 
      'module', 
      newModuleDbId, 
      ipAddress, 
      userAgent
    );
    
    await connection.commit();
    
    res.json({ 
      success: true, 
      message: '模块克隆成功',
      data: {
        moduleId: newModuleDbId,
        moduleName: newModuleName,
        clonedLevel1Count,
        clonedCaseCount
      }
    });
    
  } catch (error) {
    await connection.rollback();
    logger.error('克隆模块错误:', { error: error.message });
    res.json({ success: false, message: '克隆失败: ' + error.message });
  } finally {
    connection.release();
  }
});

// 获取指定用例库下的模块列表（用于克隆选择）
router.get('/by-library/:libraryId', async (req, res) => {
  try {
    const { libraryId } = req.params;
    
    const [modules] = await pool.execute(
      'SELECT id, module_id, name FROM modules WHERE library_id = ? ORDER BY order_index ASC, created_at DESC',
      [libraryId]
    );
    
    res.json({ 
      success: true, 
      modules: modules.map(m => ({
        id: m.id,
        moduleId: m.module_id,
        name: m.name
      }))
    });
  } catch (error) {
    logger.error('获取模块列表错误:', { error: error.message });
    res.json({ success: false, message: '服务器错误' });
  }
});

// 获取指定项目关联的模块列表（通过测试用例关联）
router.get('/by-project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const [modules] = await pool.execute(`
      SELECT DISTINCT m.id, m.module_id, m.name, COUNT(DISTINCT tc.id) as case_count
      FROM modules m
      INNER JOIN test_cases tc ON m.id = tc.module_id
      INNER JOIN test_case_projects tcp ON tc.id = tcp.test_case_id
      WHERE tcp.project_id = ? AND (tc.is_deleted = 0 OR tc.is_deleted IS NULL)
      GROUP BY m.id, m.module_id, m.name
      ORDER BY m.order_index ASC, m.created_at DESC
    `, [projectId]);
    
    res.json({ 
      success: true, 
      modules: modules.map(m => ({
        id: m.id,
        moduleId: m.module_id,
        name: m.name,
        caseCount: m.case_count || 0
      }))
    });
  } catch (error) {
    logger.error('获取项目模块列表错误:', { error: error.message });
    res.json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;