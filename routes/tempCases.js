const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const batchEditService = require('../services/batchEditService');
const reviewService = require('../services/reviewService');
const pool = require('../db');

async function checkTaskAccess(taskId, userId, userRole) {
  const [tasks] = await pool.execute(`
    SELECT user_id FROM ai_case_generation_tasks WHERE task_id = ?
  `, [taskId]);

  if (tasks.length === 0) {
    return { allowed: false, reason: '任务不存在' };
  }

  if (tasks[0].user_id === userId || userRole === 'admin') {
    return { allowed: true };
  }

  return { allowed: false, reason: '您没有权限查看此任务的临时用例' };
}

async function checkBatchAccess(tempCaseIds, userId, userRole) {
  if (!tempCaseIds || tempCaseIds.length === 0) {
    return { allowed: false, reason: '未选择用例' };
  }
  const placeholders = tempCaseIds.map(() => '?').join(',');
  const [cases] = await pool.execute(`
    SELECT DISTINCT task_id FROM temp_test_cases WHERE temp_case_id IN (${placeholders})
  `, tempCaseIds);

  if (cases.length === 0) {
    return { allowed: false, reason: '用例不存在' };
  }

  for (const c of cases) {
    const access = await checkTaskAccess(c.task_id, userId, userRole);
    if (!access.allowed) return access;
  }

  return { allowed: true };
}

router.get('/list/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, isDuplicate, level1Name, search, page, pageSize } = req.query;

    const access = await checkTaskAccess(taskId, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    let sql = `SELECT tc.*, m.name as module_name, cl.name as library_name FROM temp_test_cases tc LEFT JOIN modules m ON tc.module_id = m.id LEFT JOIN case_libraries cl ON m.library_id = cl.id WHERE tc.task_id = ?`;
    let countSql = `SELECT COUNT(*) as total FROM temp_test_cases WHERE task_id = ?`;
    const params = [taskId];
    const countParams = [taskId];

    if (status) {
      sql += ` AND tc.status = ?`;
      countSql += ` AND status = ?`;
      params.push(status);
      countParams.push(status);
    }
    if (isDuplicate !== undefined) {
      sql += ` AND tc.is_duplicate = ?`;
      countSql += ` AND is_duplicate = ?`;
      params.push(parseInt(isDuplicate));
      countParams.push(parseInt(isDuplicate));
    }
    if (level1Name) {
      sql += ` AND tc.level1_name = ?`;
      countSql += ` AND level1_name = ?`;
      params.push(level1Name);
      countParams.push(level1Name);
    }
    if (search) {
      sql += ` AND (tc.name LIKE ? OR tc.purpose LIKE ?)`;
      countSql += ` AND (name LIKE ? OR purpose LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
      countParams.push(`%${search}%`, `%${search}%`);
    }

    const [countResult] = await pool.execute(countSql, countParams);

    const total = countResult[0].total;
    const currentPage = Math.max(1, parseInt(page) || 1);
    const currentPageSize = Math.max(1, Math.min(200, parseInt(pageSize) || 50));
    const offset = (currentPage - 1) * currentPageSize;

    sql += ` ORDER BY tc.created_at ASC LIMIT ${currentPageSize} OFFSET ${offset}`;

    const [cases] = await pool.execute(sql, params);

    const stats = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      merged: 0,
      duplicate: 0
    };

    const [statResult] = await pool.execute(`
      SELECT status, is_duplicate, COUNT(*) as count 
      FROM temp_test_cases 
      WHERE task_id = ?
      GROUP BY status, is_duplicate
    `, [taskId]);

    for (const row of statResult) {
      stats.total += row.count;
      if (row.status === 'pending') stats.pending += row.count;
      if (row.status === 'approved') stats.approved += row.count;
      if (row.status === 'rejected') stats.rejected += row.count;
      if (row.status === 'merged') stats.merged += row.count;
      if (row.is_duplicate === 1) stats.duplicate += row.count;
    }

    res.json({
      success: true,
      data: {
        cases,
        total,
        page: currentPage,
        pageSize: currentPageSize,
        stats
      }
    });
  } catch (error) {
    console.error('[tempCases] /list error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/detail/:tempCaseId', authenticateToken, async (req, res) => {
  try {
    const { tempCaseId } = req.params;
    const caseDetail = await batchEditService.getCaseDetail(tempCaseId);

    if (!caseDetail) {
      return res.status(404).json({ success: false, message: '用例不存在' });
    }

    const access = await checkTaskAccess(caseDetail.task_id, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    res.json({ success: true, data: caseDetail });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/update/:tempCaseId', authenticateToken, async (req, res) => {
  try {
    const { tempCaseId } = req.params;
    const updates = req.body;

    const caseDetail = await batchEditService.getCaseDetail(tempCaseId);
    if (!caseDetail) {
      return res.status(404).json({ success: false, message: '用例不存在' });
    }

    const access = await checkTaskAccess(caseDetail.task_id, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    const result = await batchEditService.updateSingleCase(tempCaseId, updates);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/batch-edit', authenticateToken, async (req, res) => {
  try {
    const { tempCaseIds, updates } = req.body;

    if (!tempCaseIds || tempCaseIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择用例' });
    }

    const access = await checkBatchAccess(tempCaseIds, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    const result = await batchEditService.batchUpdateTempCases(tempCaseIds, updates);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/batch-approve', authenticateToken, async (req, res) => {
  try {
    const { tempCaseIds } = req.body;

    if (!tempCaseIds || tempCaseIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择用例' });
    }

    const access = await checkBatchAccess(tempCaseIds, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    const result = await batchEditService.batchApproveCases(tempCaseIds);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/batch-reject', authenticateToken, async (req, res) => {
  try {
    const { tempCaseIds } = req.body;

    if (!tempCaseIds || tempCaseIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择用例' });
    }

    const access = await checkBatchAccess(tempCaseIds, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    const result = await batchEditService.batchRejectCases(tempCaseIds);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/batch-delete', authenticateToken, async (req, res) => {
  try {
    const { tempCaseIds } = req.body;

    if (!tempCaseIds || tempCaseIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择用例' });
    }

    const access = await checkBatchAccess(tempCaseIds, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    const result = await batchEditService.batchDeleteCases(tempCaseIds);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/merge/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { defaultOwner, projectIds, libraryId, creator } = req.body;

    const access = await checkTaskAccess(taskId, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    const result = await reviewService.mergeApprovedCases(taskId, {
      defaultOwner: defaultOwner || req.user.username,
      projectIds,
      libraryId,
      creator: creator || req.user.username
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/direct-merge/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { defaultOwner, projectIds, libraryId, creator } = req.body;

    const access = await checkTaskAccess(taskId, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    const result = await reviewService.directMerge(taskId, {
      defaultOwner: defaultOwner || req.user.username,
      projectIds,
      libraryId,
      creator: creator || req.user.username
    });

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/batch-merge', authenticateToken, async (req, res) => {
  try {
    const { tempCaseIds, taskId, defaultOwner, projectIds, libraryId, creator } = req.body;

    if (!tempCaseIds || tempCaseIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要合并的用例' });
    }

    console.log('[batch-merge] 开始合并:', { tempCaseIds, taskId, libraryId, user: req.user.username });

    const result = await reviewService.batchMerge(tempCaseIds, {
      taskId,
      defaultOwner: defaultOwner || req.user.username,
      projectIds,
      libraryId,
      creator: creator || req.user.username
    });

    console.log('[batch-merge] 合并完成:', result);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[batch-merge] 合并失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/submit-review/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { reviewerIds, deadline, tempCaseIds, libraryId } = req.body;

    console.log('[submit-review] 请求参数:', { taskId, reviewerIds, deadline, tempCaseIds: tempCaseIds?.length, libraryId });

    if (!reviewerIds || reviewerIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择评审人' });
    }

    if (taskId !== 'batch') {
      const access = await checkTaskAccess(taskId, req.user.id, req.user.role);
      if (!access.allowed) {
        return res.status(403).json({ success: false, message: access.reason });
      }
    }

    const effectiveTaskId = taskId === 'batch' ? (req.body.taskId || null) : taskId;
    console.log('[submit-review] effectiveTaskId:', effectiveTaskId);

    if (libraryId && effectiveTaskId) {
      await pool.execute(`
        UPDATE ai_case_generation_tasks SET library_id = ? WHERE task_id = ?
      `, [libraryId, effectiveTaskId]);
    }

    const result = await reviewService.submitForReview(effectiveTaskId, reviewerIds, deadline, tempCaseIds);
    console.log('[submit-review] 提交成功:', result);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[submit-review] 提交失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/review/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { reviews } = req.body;

    if (!reviews || reviews.length === 0) {
      return res.status(400).json({ success: false, message: '请提供评审结果' });
    }

    const result = await reviewService.submitReviewResults(taskId, reviews, req.user.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/review-history/:tempCaseId', authenticateToken, async (req, res) => {
  try {
    const { tempCaseId } = req.params;
    const history = await reviewService.getReviewHistory(tempCaseId);
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/pending-review', authenticateToken, async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const result = await reviewService.getPendingReviewTasks(req.user.id, {
      limit: parseInt(limit) || 10,
      offset: parseInt(offset) || 0
    });
    res.json({ success: true, data: result.tasks, total: result.total });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/level1-groups/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;

    const access = await checkTaskAccess(taskId, req.user.id, req.user.role);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    const [groups] = await pool.execute(`
      SELECT level1_name, is_new_level1, COUNT(*) as case_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN is_duplicate = 1 THEN 1 ELSE 0 END) as duplicate_count
      FROM temp_test_cases
      WHERE task_id = ?
      GROUP BY level1_name, is_new_level1
      ORDER BY MIN(created_at)
    `, [taskId]);

    res.json({ success: true, data: groups });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/all-active', authenticateToken, async (req, res) => {
  try {
    const { status, isDuplicate, search, page, pageSize } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    let taskWhere = `(t.user_id = ? OR ? = 'admin') AND t.status = 'completed' AND (t.expires_at IS NULL OR t.expires_at > NOW())`;
    const taskParams = [userId, userRole];

    const [tasks] = await pool.execute(`
      SELECT task_id, library_id FROM ai_case_generation_tasks t WHERE ${taskWhere}
    `, taskParams);

    if (tasks.length === 0) {
      return res.json({ success: true, data: { cases: [], total: 0, page: 1, pageSize: 50, stats: { total: 0, pending: 0, approved: 0, rejected: 0, merged: 0, duplicate: 0 } } });
    }

    const taskIdList = tasks.map(t => t.task_id);
    const taskLibraryMap = {};
    tasks.forEach(t => { if (t.library_id) taskLibraryMap[t.task_id] = t.library_id; });
    const placeholders = taskIdList.map(() => '?').join(',');

    let whereClause = `WHERE tc.task_id IN (${placeholders}) AND tc.status != 'merged'`;
    const params = [...taskIdList];

    if (status) {
      whereClause += ` AND tc.status = ?`;
      params.push(status);
    }
    if (isDuplicate !== undefined) {
      whereClause += ` AND tc.is_duplicate = ?`;
      params.push(parseInt(isDuplicate));
    }
    if (search) {
      whereClause += ` AND (tc.name LIKE ? OR tc.purpose LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    let countSql = `SELECT COUNT(*) as total FROM temp_test_cases tc ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const currentPage = Math.max(1, parseInt(page) || 1);
    const currentPageSize = Math.max(1, Math.min(200, parseInt(pageSize) || 50));
    const offset = (currentPage - 1) * currentPageSize;

    const [cases] = await pool.execute(
      `SELECT tc.*, m.name as module_name, cl.name as library_name FROM temp_test_cases tc LEFT JOIN modules m ON tc.module_id = m.id LEFT JOIN case_libraries cl ON m.library_id = cl.id ${whereClause} ORDER BY tc.created_at ASC LIMIT ${currentPageSize} OFFSET ${offset}`,
      params
    );

    const stats = { total: 0, pending: 0, approved: 0, rejected: 0, merged: 0, duplicate: 0 };
    const [statResult] = await pool.execute(`
      SELECT status, is_duplicate, COUNT(*) as count 
      FROM temp_test_cases 
      WHERE task_id IN (${placeholders}) AND status != 'merged'
      GROUP BY status, is_duplicate
    `, taskIdList);

    for (const row of statResult) {
      stats.total += row.count;
      if (row.status === 'pending') stats.pending += row.count;
      if (row.status === 'approved') stats.approved += row.count;
      if (row.status === 'rejected') stats.rejected += row.count;
      if (row.is_duplicate === 1) stats.duplicate += row.count;
    }

    res.json({
      success: true,
      data: { cases, total, page: currentPage, pageSize: currentPageSize, stats }
    });
  } catch (error) {
    console.error('[tempCases] /all-active error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
