const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');
const { logActivity } = require('./history');
require('dotenv').config();

// 获取测试计划列表（支持分页）
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const { project, iteration, owner, status } = req.query;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    
    let countQuery = `
      SELECT COUNT(*) as total
      FROM test_plans tp
      WHERE 1=1
    `;
    
    let query = `
      SELECT 
        tp.id, 
        tp.name, 
        tp.owner, 
        tp.status, 
        tp.test_phase, 
        tp.project, 
        tp.iteration, 
        tp.pass_rate, 
        tp.tested_cases, 
        tp.total_cases, 
        tp.created_at, 
        tp.updated_at,
        u.username as owner_name,
        p.name as project_name
      FROM test_plans tp
      LEFT JOIN users u ON tp.owner = u.username
      LEFT JOIN projects p ON tp.project = p.code
      WHERE 1=1
    `;
    
    const params = [];
    
    if (project) {
      query += ' AND tp.project = ?';
      countQuery += ' AND tp.project = ?';
      params.push(project);
    }
    
    if (iteration) {
      query += ' AND tp.iteration = ?';
      countQuery += ' AND tp.iteration = ?';
      params.push(iteration);
    }
    
    if (owner) {
      query += ' AND tp.owner = ?';
      countQuery += ' AND tp.owner = ?';
      params.push(owner);
    }
    
    if (status) {
      query += ' AND tp.status = ?';
      countQuery += ' AND tp.status = ?';
      params.push(status);
    }
    
    // 获取总数
    const [countResult] = await pool.execute(countQuery, params);
    const total = countResult[0].total;
    
    // 添加排序和分页（使用模板字符串，因为MySQL不支持LIMIT/OFFSET参数化）
    query += ` ORDER BY tp.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    
    const [testPlans] = await pool.execute(query, params);
    
    const formattedPlans = testPlans.map(plan => ({
      id: plan.id,
      name: plan.name,
      owner: plan.owner,
      ownerName: plan.owner_name || plan.owner,
      status: plan.status,
      passRate: plan.pass_rate || 0,
      testedCases: plan.tested_cases || 0,
      totalCases: plan.total_cases || 0,
      resultDistribution: {
        pass: Math.floor((plan.pass_rate || 0) / 100 * (plan.tested_cases || 0)),
        fail: Math.floor(((100 - (plan.pass_rate || 0)) / 100) * (plan.tested_cases || 0)),
        pending: (plan.total_cases || 0) - (plan.tested_cases || 0)
      },
      testPhase: plan.test_phase,
      project: plan.project,
      projectName: plan.project_name || plan.project,
      iteration: plan.iteration,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at
    }));
    
    res.json({ 
      success: true, 
      testPlans: formattedPlans,
      pagination: {
        page: page,
        pageSize: pageSize,
        total: total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    console.error('获取测试计划列表错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建测试计划（带用例关联）
router.post('/create_with_rules', authenticateToken, async (req, res) => {
  const { name, owner, project, stage_id, software_id, iteration, description, start_date, end_date, actual_end_time, selectedCases } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  // 输入验证
  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, message: '测试计划名称不能为空' });
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // 获取测试阶段名称（如果有 stage_id）
    let testPhase = '未指定';
    if (stage_id) {
      try {
        const [stageRows] = await connection.execute(
          'SELECT name FROM test_stages WHERE id = ?',
          [stage_id]
        );
        if (stageRows.length > 0) {
          testPhase = stageRows[0].name;
        }
      } catch (e) {
        console.log('获取测试阶段名称失败:', e.message);
      }
    }
    
    const [result] = await connection.execute(`
      INSERT INTO test_plans (name, owner, status, test_phase, project, iteration, description, start_date, end_date, stage_id, software_id, total_cases, tested_cases, pass_rate)
      VALUES (?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `, [
      name.trim(),
      owner || currentUser.username,
      testPhase,
      project || '未指定',
      iteration || null,
      description || null,
      start_date || null,
      end_date || null,
      stage_id || null,
      software_id || null,
      selectedCases ? selectedCases.length : 0
    ]);
    
    const planId = result.insertId;
    
    if (selectedCases && selectedCases.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < selectedCases.length; i += batchSize) {
        const batch = selectedCases.slice(i, i + batchSize);
        const placeholders = batch.map(() => '(?, ?, ?)').join(',');
        const values = batch.flatMap(caseId => [planId, caseId, 'pending']);
        await connection.execute(`
          INSERT INTO test_plan_cases (plan_id, case_id, status) VALUES ${placeholders}
        `, values);
      }
      
      await connection.execute(`
        UPDATE test_plans SET total_cases = ? WHERE id = ?
      `, [selectedCases.length, planId]);
    }
    
    await connection.commit();
    
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '创建测试计划', `创建了测试计划 ${name}，关联 ${selectedCases ? selectedCases.length : 0} 条用例`, 'test_plan', planId, ipAddress, userAgent);
    
    res.json({ 
      success: true, 
      message: '测试计划创建成功',
      planId: planId,
      caseCount: selectedCases ? selectedCases.length : 0
    });
  } catch (error) {
    await connection.rollback();
    console.error('创建测试计划错误:', error);
    res.status(500).json({ success: false, message: '服务器错误: ' + error.message });
  } finally {
    connection.release();
  }
});

// 创建测试计划
router.post('/create', authenticateToken, async (req, res) => {
  const { name, owner, status, testPhase, project, iteration, description, startDate, endDate } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    const [result] = await pool.execute(`
      INSERT INTO test_plans (name, owner, status, test_phase, project, iteration, description, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, owner, status, testPhase, project, iteration, description, startDate || null, endDate || null]);
    
    // 记录操作日志
    const planId = result.insertId;
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '创建测试计划', `创建了测试计划 ${name}`, 'test_plan', planId, ipAddress, userAgent);
    
    res.json({ success: true, message: '测试计划创建成功' });
  } catch (error) {
    console.error('创建测试计划错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新测试计划（带用例关联）
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, owner, project, stage_id, software_id, iteration, description, start_date, end_date, actual_end_time, selectedCases } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  // 输入验证
  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, message: '测试计划名称不能为空' });
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // 获取测试阶段名称（如果有 stage_id）
    let testPhase = '未指定';
    if (stage_id) {
      try {
        const [stageRows] = await connection.execute(
          'SELECT name FROM test_stages WHERE id = ?',
          [stage_id]
        );
        if (stageRows.length > 0) {
          testPhase = stageRows[0].name;
        }
      } catch (e) {
        console.log('获取测试阶段名称失败:', e.message);
      }
    }
    
    await connection.execute(`
      UPDATE test_plans
      SET name = ?, owner = ?, test_phase = ?, project = ?, iteration = ?, description = ?, start_date = ?, end_date = ?, stage_id = ?, software_id = ?, actual_end_time = ?
      WHERE id = ?
    `, [
      name.trim(),
      owner,
      testPhase,
      project || '未指定',
      iteration || null,
      description || null,
      start_date || null,
      end_date || null,
      stage_id || null,
      software_id || null,
      actual_end_time || null,
      id
    ]);
    
    if (selectedCases && Array.isArray(selectedCases)) {
      await connection.execute('DELETE FROM test_plan_cases WHERE plan_id = ?', [id]);
      
      if (selectedCases.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < selectedCases.length; i += batchSize) {
          const batch = selectedCases.slice(i, i + batchSize);
          const placeholders = batch.map(() => '(?, ?, ?)').join(',');
          const values = batch.flatMap(caseId => [id, caseId, 'pending']);
          await connection.execute(`
            INSERT INTO test_plan_cases (plan_id, case_id, status) VALUES ${placeholders}
          `, values);
        }
      }
      
      await connection.execute(`
        UPDATE test_plans SET total_cases = ? WHERE id = ?
      `, [selectedCases.length, id]);
    }
    
    await connection.commit();
    
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '更新测试计划', `更新了测试计划 ${name}`, 'test_plan', parseInt(id), ipAddress, userAgent);
    
    res.json({ 
      success: true, 
      message: '测试计划更新成功',
      caseCount: selectedCases ? selectedCases.length : 0
    });
  } catch (error) {
    await connection.rollback();
    console.error('更新测试计划错误:', error);
    res.status(500).json({ success: false, message: '服务器错误: ' + error.message });
  } finally {
    connection.release();
  }
});

router.put('/update/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, owner, status, testPhase, project, iteration, description, startDate, endDate } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    await pool.execute(`
      UPDATE test_plans
      SET name = ?, owner = ?, status = ?, test_phase = ?, project = ?, iteration = ?, description = ?, start_date = ?, end_date = ?
      WHERE id = ?
    `, [name, owner, status, testPhase, project, iteration, description, startDate, endDate, id]);
    
    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '更新测试计划', `更新了测试计划 ${name}`, 'test_plan', parseInt(id), ipAddress, userAgent);
    
    res.json({ success: true, message: '测试计划更新成功' });
  } catch (error) {
    console.error('更新测试计划错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除测试计划
router.delete('/delete/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    // 获取测试计划信息
    const [plans] = await pool.execute('SELECT name FROM test_plans WHERE id = ?', [id]);
    if (plans.length === 0) {
      return res.status(404).json({ success: false, message: '测试计划不存在' });
    }
    
    await pool.execute('DELETE FROM test_plans WHERE id = ?', [id]);
    
    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '删除测试计划', `删除了测试计划 ${plans[0].name}`, 'test_plan', parseInt(id), ipAddress, userAgent);
    
    res.json({ success: true, message: '测试计划删除成功' });
  } catch (error) {
    console.error('删除测试计划错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取测试计划详情
router.get('/detail/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const [testPlans] = await pool.execute(`
      SELECT * FROM test_plans WHERE id = ?
    `, [id]);
    
    if (testPlans.length === 0) {
      return res.status(404).json({ success: false, message: '测试计划不存在' });
    }
    
    const plan = testPlans[0];
    
    // 获取测试计划关联的用例
    const [planCases] = await pool.execute(`
      SELECT tpc.case_id, tc.library_id, tc.module_id, tc.level1_id
      FROM test_plan_cases tpc
      LEFT JOIN test_cases tc ON tpc.case_id = tc.id
      WHERE tpc.plan_id = ?
    `, [id]);
    
    res.json({ 
      success: true, 
      plan: {
        id: plan.id,
        name: plan.name,
        owner: plan.owner,
        status: plan.status,
        testPhase: plan.test_phase,
        project: plan.project,
        iteration: plan.iteration,
        description: plan.description,
        startDate: plan.start_date,
        endDate: plan.end_date,
        passRate: plan.pass_rate || 0,
        testedCases: plan.tested_cases || 0,
        totalCases: plan.total_cases || 0,
        stage_id: plan.stage_id,
        software_id: plan.software_id,
        createdAt: plan.created_at,
        updatedAt: plan.updated_at,
        cases: planCases.map(c => ({
          case_id: c.case_id,
          library_id: c.library_id,
          module_id: c.module_id,
          level1_id: c.level1_id
        }))
      }
    });
  } catch (error) {
    console.error('获取测试计划详情错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取测试计划关联的用例详情列表
router.get('/:id/cases', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { page = 1, pageSize = 50, search = '', status = '' } = req.query;
  
  try {
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    
    let whereClause = 'tpc.plan_id = ?';
    const params = [id];
    
    if (search) {
      whereClause += ' AND (tc.name LIKE ? OR tc.case_id LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    if (status) {
      whereClause += ' AND tpc.status = ?';
      params.push(status);
    }
    
    const countQuery = `
      SELECT COUNT(*) as total
      FROM test_plan_cases tpc
      LEFT JOIN test_cases tc ON tpc.case_id = tc.id
      WHERE ${whereClause}
    `;
    const [countResult] = await pool.execute(countQuery, params);
    const total = countResult[0].total;
    
    const dataQuery = `
      SELECT 
        tpc.id as plan_case_id,
        tpc.case_id,
        tpc.status as execution_status,
        tpc.executor_id,
        tpc.execution_time,
        tpc.error_message,
        tpc.bug_id,
        tc.name,
        tc.priority,
        tc.type,
        tc.owner,
        tc.precondition,
        tc.purpose,
        tc.steps,
        tc.expected,
        tc.key_config,
        tc.remark,
        m.id as module_id,
        m.name as module_name,
        l1.id as level1_id,
        l1.name as level1_name,
        lib.id as library_id,
        lib.name as library_name
      FROM test_plan_cases tpc
      LEFT JOIN test_cases tc ON tpc.case_id = tc.id AND (tc.is_deleted = 0 OR tc.is_deleted IS NULL)
      LEFT JOIN modules m ON tc.module_id = m.id
      LEFT JOIN level1_points l1 ON tc.level1_id = l1.id
      LEFT JOIN case_libraries lib ON tc.library_id = lib.id
      WHERE ${whereClause}
      ORDER by tc.priority ASC, tc.id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    
    const [cases] = await pool.query(dataQuery, params);
    
    res.json({
      success: true,
      cases: cases.map(c => ({
        id: c.case_id,
        planCaseId: c.plan_case_id,
        caseId: c.case_id,
        name: c.name,
        priority: c.priority || 'P3',
        type: c.type,
        owner: c.owner || c.executor_id || '未分配',
        module: c.module_name,
        level1: c.level1_name,
        library: c.library_name,
        status: c.execution_status || 'pending',
        executor: c.executor_id,
        executionTime: c.execution_time,
        errorMessage: c.error_message,
        bugId: c.bug_id
      })),
      pagination: {
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        total: total,
        totalPages: Math.ceil(total / parseInt(pageSize))
      }
    });
  } catch (error) {
    console.error('获取测试计划用例列表错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新测试计划用例状态（带事务保护）
router.put('/:planId/cases/:caseId', authenticateToken, async (req, res) => {
  const { planId, caseId } = req.params;
  const { status, executor_id, error_message, bug_id } = req.body;
  const currentUser = req.user;
  
  const connection = await pool.getConnection();
  try {
    const validStatuses = ['pass', 'fail', 'blocked', 'pending', 'asic_hang', 'core_dump', 'traffic_drop'];
    if (!validStatuses.includes(status)) {
      connection.release();
      return res.status(400).json({ success: false, message: '无效的状态值' });
    }
    
    await connection.beginTransaction();
    
    await connection.execute(`
      UPDATE test_plan_cases 
      SET status = ?, 
          executor_id = ?, 
          error_message = ?,
          bug_id = ?,
          execution_time = CASE WHEN status = 'pending' AND ? != 'pending' THEN NOW() ELSE execution_time END,
          updated_at = NOW()
      WHERE plan_id = ? AND case_id = ?
    `, [status, executor_id || currentUser.username, error_message || null, bug_id || null, status, planId, caseId]);
    
    await updatePlanStatisticsWithTx(connection, planId);
    
    await connection.commit();
    connection.release();
    
    res.json({ success: true, message: '状态更新成功' });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('更新用例状态错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 批量更新测试计划用例状态（带事务保护）
router.put('/:planId/cases/batch', authenticateToken, async (req, res) => {
  const { planId } = req.params;
  const { caseIds, status, bug_id } = req.body;
  const currentUser = req.user;
  
  const connection = await pool.getConnection();
  try {
    const validStatuses = ['pass', 'fail', 'blocked', 'pending', 'asic_hang', 'core_dump', 'traffic_drop'];
    if (!validStatuses.includes(status)) {
      connection.release();
      return res.status(400).json({ success: false, message: '无效的状态值' });
    }
    
    if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
      connection.release();
      return res.status(400).json({ success: false, message: '请选择要更新的用例' });
    }
    
    await connection.beginTransaction();
    
    const placeholders = caseIds.map(() => '?').join(',');
    await connection.execute(`
      UPDATE test_plan_cases 
      SET status = ?, 
          executor_id = ?,
          bug_id = ?,
          execution_time = CASE WHEN status = 'pending' AND ? != 'pending' THEN NOW() ELSE execution_time END,
          updated_at = NOW()
      WHERE plan_id = ? AND case_id IN (${placeholders})
    `, [status, currentUser.username, bug_id || null, status, planId, ...caseIds]);
    
    await updatePlanStatisticsWithTx(connection, planId);
    
    await connection.commit();
    connection.release();
    
    res.json({ success: true, message: `已更新 ${caseIds.length} 个用例的状态` });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('批量更新用例状态错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新测试计划统计信息（带事务连接）
async function updatePlanStatisticsWithTx(connection, planId) {
  const [stats] = await connection.execute(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) as tested,
      SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) as passed
    FROM test_plan_cases
    WHERE plan_id = ?
  `, [planId]);
  
  if (stats.length > 0) {
    const { total, tested, passed } = stats[0];
    const passRate = tested > 0 ? Math.round((passed / tested) * 100) : 0;
    
    await connection.execute(`
      UPDATE test_plans 
      SET total_cases = ?, 
          tested_cases = ?, 
          pass_rate = ?,
          updated_at = NOW()
      WHERE id = ?
    `, [total, tested, passRate, planId]);
  }
}

// 更新测试计划统计信息（无事务版本，用于兼容旧代码）
async function updatePlanStatistics(planId) {
  const connection = await pool.getConnection();
  try {
    await updatePlanStatisticsWithTx(connection, planId);
  } finally {
    connection.release();
  }
}

module.exports = router;