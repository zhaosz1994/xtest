const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin, isAdmin } = require('../middleware');
const aiReviewService = require('../services/aiReviewService');
const logger = require('../services/logger');

/**
 * 检查用户是否有权限访问评审任务（提交人、评审人或管理员）
 * @param {Object} task - 评审任务记录
 * @param {number} userId - 当前用户ID
 * @param {boolean} userIsAdmin - 是否管理员
 * @returns {Promise<boolean>}
 */
async function canAccessReviewTask(task, userId, userIsAdmin) {
  if (userIsAdmin || task.submitter_id === userId) return true;

  // 检查是否是被分配的评审人（通过source_task_id关联case_reviewers）
  if (task.source_task_id) {
    const [reviewers] = await pool.execute(
      'SELECT 1 FROM case_reviewers cr JOIN temp_test_cases tc ON cr.case_id = tc.temp_case_id WHERE tc.task_id = ? AND cr.reviewer_id = ? LIMIT 1',
      [task.source_task_id, userId]
    );
    if (reviewers.length > 0) return true;
  }

  return false;
}

// POST /submit - 提交AI评审
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const {
      task_id, agent_id, auto_approve_score,
      concurrency, library_id, module_id
    } = req.body;
    const userId = req.user.id;

    if (!task_id || !agent_id) {
      return res.json({ success: false, message: 'task_id和agent_id为必填参数' });
    }

    // 检查代理是否存在且可用
    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ? AND is_enabled = 1',
      [agent_id]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在或已禁用' });
    }

    // 检查来源任务是否存在
    const [tasks] = await pool.execute(
      'SELECT task_id FROM ai_case_generation_tasks WHERE task_id = ?',
      [task_id]
    );

    if (tasks.length === 0) {
      return res.json({ success: false, message: '来源任务不存在' });
    }

    const result = await aiReviewService.submitReview(task_id, agent_id, userId, {
      autoApproveScore: auto_approve_score || 0,
      concurrency: concurrency || 3,
      libraryId: library_id || null,
      moduleId: module_id || null
    });

    if (result.reviewTaskId) {
      logger.info('AI评审任务提交成功', {
        reviewTaskId: result.reviewTaskId,
        taskId: task_id,
        agentId: agent_id,
        totalCases: result.totalCases,
        userId
      });

      res.json({
        success: true,
        data: {
          reviewTaskId: result.reviewTaskId,
          status: result.status || 'pending'
        }
      });
    } else {
      res.json({
        success: false,
        message: result.message || '没有待评审的用例'
      });
    }
  } catch (error) {
    logger.error('提交AI评审失败', { error: error.message });
    res.status(500).json({ success: false, message: '提交AI评审失败' });
  }
});

// GET /task/list - 获取当前用户的评审任务列表
router.get('/task/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    let query = 'SELECT rt.*, a.display_name AS agent_name FROM ai_review_tasks rt LEFT JOIN ai_sub_agents a ON rt.agent_id = a.id WHERE 1=1';
    const params = [];

    if (!userIsAdmin) {
      query += ' AND rt.submitter_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY rt.created_at DESC';

    const [tasks] = await pool.execute(query, params);

    res.json({
      success: true,
      data: tasks.map(t => ({
        review_task_id: t.review_task_id,
        source_task_id: t.source_task_id,
        agent_id: t.agent_id,
        agent_name: t.agent_name,
        status: t.status,
        total_cases: t.total_cases,
        reviewed_cases: t.reviewed_cases,
        approved_cases: t.approved_cases,
        rejected_cases: t.rejected_cases,
        modified_cases: t.modified_cases,
        progress: t.total_cases > 0 ? Math.round((t.reviewed_cases / t.total_cases) * 100) : 0,
        error_message: t.error_message,
        started_at: t.started_at,
        completed_at: t.completed_at,
        created_at: t.created_at,
        updated_at: t.updated_at
      }))
    });
  } catch (error) {
    logger.error('获取评审任务列表失败', { error: error.message });
    res.status(500).json({ success: false, message: '获取评审任务列表失败' });
  }
});

// GET /task/:reviewTaskId - 获取评审任务状态
router.get('/task/:reviewTaskId', authenticateToken, async (req, res) => {
  try {
    const { reviewTaskId } = req.params;

    const task = await aiReviewService.getTaskStatus(reviewTaskId);

    if (!task) {
      return res.json({ success: false, message: '评审任务不存在' });
    }

    // 权限检查：提交人、评审人或管理员可以查看
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);
    if (!await canAccessReviewTask(task, userId, userIsAdmin)) {
      return res.status(403).json({ success: false, message: '您没有权限查看此评审任务' });
    }

    res.json({
      success: true,
      data: {
        id: task.id,
        reviewTaskId: task.review_task_id,
        sourceTaskId: task.source_task_id,
        submitterId: task.submitter_id,
        agentId: task.agent_id,
        status: task.status,
        totalCases: task.total_cases,
        reviewedCases: task.reviewed_cases,
        approvedCases: task.approved_cases,
        rejectedCases: task.rejected_cases,
        modifiedCases: task.modified_cases,
        errorMessage: task.error_message,
        startedAt: task.started_at,
        completedAt: task.completed_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at
      }
    });
  } catch (error) {
    logger.error('获取评审任务状态失败', { error: error.message, reviewTaskId: req.params.reviewTaskId });
    res.status(500).json({ success: false, message: '获取评审任务状态失败' });
  }
});

// GET /results/:reviewTaskId - 获取评审结果列表
router.get('/results/:reviewTaskId', authenticateToken, async (req, res) => {
  try {
    const { reviewTaskId } = req.params;
    const { action, user_decision, search } = req.query;

    // 权限检查
    const task = await aiReviewService.getTaskStatus(reviewTaskId);
    if (!task) {
      return res.json({ success: false, message: '评审任务不存在' });
    }

    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);
    if (!await canAccessReviewTask(task, userId, userIsAdmin)) {
      return res.status(403).json({ success: false, message: '您没有权限查看此评审结果' });
    }

    const results = await aiReviewService.getReviewResults(reviewTaskId, {
      action,
      userDecision: user_decision,
      search
    });

    res.json({
      success: true,
      data: results.map(r => ({
        id: r.id,
        reviewTaskId: r.review_task_id,
        tempCaseId: r.temp_case_id,
        action: r.action,
        aiComment: r.ai_comment,
        aiScore: r.ai_score,
        originalContent: typeof r.original_content === 'string' ? JSON.parse(r.original_content) : r.original_content,
        suggestedContent: typeof r.suggested_content === 'string' ? JSON.parse(r.suggested_content) : r.suggested_content,
        diffSummary: r.diff_summary,
        diffDetail: typeof r.diff_detail === 'string' ? JSON.parse(r.diff_detail) : r.diff_detail,
        toolCallsLog: r.tool_calls_log ? (typeof r.tool_calls_log === 'string' ? JSON.parse(r.tool_calls_log) : r.tool_calls_log) : null,
        memoryContribution: r.memory_contribution,
        userDecision: r.user_decision,
        userComment: r.user_comment,
        userModifiedContent: r.user_modified_content ? (typeof r.user_modified_content === 'string' ? JSON.parse(r.user_modified_content) : r.user_modified_content) : null,
        decidedAt: r.decided_at,
        decidedBy: r.decided_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }))
    });
  } catch (error) {
    logger.error('获取评审结果列表失败', { error: error.message, reviewTaskId: req.params.reviewTaskId });
    res.status(500).json({ success: false, message: '获取评审结果列表失败' });
  }
});

// POST /decide - 单条评审决策
router.post('/decide', authenticateToken, async (req, res) => {
  try {
    const {
      review_task_id, temp_case_id, decision,
      user_comment, user_modified_content
    } = req.body;
    const userId = req.user.id;

    if (!review_task_id || !temp_case_id || !decision) {
      return res.json({ success: false, message: 'review_task_id、temp_case_id和decision为必填参数' });
    }

    // 验证decision值
    if (!['accepted', 'rejected', 'modified_accepted'].includes(decision)) {
      return res.json({ success: false, message: 'decision必须是accepted/rejected/modified_accepted之一' });
    }

    // 如果是modified_accepted，user_modified_content不能为空
    if (decision === 'modified_accepted' && !user_modified_content) {
      return res.json({ success: false, message: '修改后接受时必须提供user_modified_content' });
    }

    // 权限检查
    const task = await aiReviewService.getTaskStatus(review_task_id);
    if (!task) {
      return res.json({ success: false, message: '评审任务不存在' });
    }

    const userIsAdmin = isAdmin(req.user);
    if (!await canAccessReviewTask(task, userId, userIsAdmin)) {
      return res.status(403).json({ success: false, message: '您没有权限对此评审结果做决策' });
    }

    const result = await aiReviewService.decideReviewResult(
      review_task_id,
      temp_case_id,
      decision,
      userId,
      user_comment || '',
      user_modified_content || null
    );

    if (result.success) {
      logger.info('评审决策完成', { review_task_id, temp_case_id, decision, userId });
      res.json({ success: true, message: '决策已保存' });
    } else {
      res.json({ success: false, message: result.error || '决策保存失败' });
    }
  } catch (error) {
    logger.error('评审决策失败', { error: error.message });
    res.status(500).json({ success: false, message: '评审决策失败' });
  }
});

// POST /batch-decide - 批量评审决策
router.post('/batch-decide', authenticateToken, async (req, res) => {
  try {
    const { review_task_id, decisions } = req.body;
    const userId = req.user.id;

    if (!review_task_id || !decisions || !Array.isArray(decisions) || decisions.length === 0) {
      return res.json({ success: false, message: 'review_task_id和decisions数组为必填参数' });
    }

    // 权限检查
    const task = await aiReviewService.getTaskStatus(review_task_id);
    if (!task) {
      return res.json({ success: false, message: '评审任务不存在' });
    }

    const userIsAdmin = isAdmin(req.user);
    if (!await canAccessReviewTask(task, userId, userIsAdmin)) {
      return res.status(403).json({ success: false, message: '您没有权限对此评审结果做决策' });
    }

    // 验证每条决策
    for (const d of decisions) {
      if (!d.temp_case_id || !d.decision) {
        return res.json({ success: false, message: '每条决策必须包含temp_case_id和decision' });
      }
      if (!['accepted', 'rejected', 'modified_accepted'].includes(d.decision)) {
        return res.json({ success: false, message: `无效的decision值: ${d.decision}` });
      }
    }

    const result = await aiReviewService.batchDecide(review_task_id, decisions, userId);

    logger.info('批量评审决策完成', { review_task_id, processedCount: result.processedCount, userId });

    res.json({
      success: true,
      data: {
        processed: result.processedCount
      }
    });
  } catch (error) {
    logger.error('批量评审决策失败', { error: error.message });
    res.status(500).json({ success: false, message: '批量评审决策失败' });
  }
});

// POST /batch-merge - 批量合并已接受的用例
router.post('/batch-merge', authenticateToken, async (req, res) => {
  try {
    const { review_task_id } = req.body;
    const userId = req.user.id;

    if (!review_task_id) {
      return res.json({ success: false, message: 'review_task_id为必填参数' });
    }

    // 权限检查
    const task = await aiReviewService.getTaskStatus(review_task_id);
    if (!task) {
      return res.json({ success: false, message: '评审任务不存在' });
    }

    const userIsAdmin = isAdmin(req.user);
    if (!await canAccessReviewTask(task, userId, userIsAdmin)) {
      return res.status(403).json({ success: false, message: '您没有权限执行合并操作' });
    }

    // 检查任务是否已完成
    if (task.status !== 'completed') {
      return res.json({ success: false, message: '评审任务尚未完成，无法合并' });
    }

    const result = await aiReviewService.batchMerge(review_task_id, userId);

    logger.info('批量合并完成', { review_task_id, mergedCount: result.mergedCount, userId });

    res.json({
      success: true,
      data: {
        mergedCount: result.mergedCount
      }
    });
  } catch (error) {
    logger.error('批量合并失败', { error: error.message });
    res.status(500).json({ success: false, message: '批量合并失败' });
  }
});

// GET /compare/:reviewTaskId/:tempCaseId - 获取对比详情
router.get('/compare/:reviewTaskId/:tempCaseId', authenticateToken, async (req, res) => {
  try {
    const { reviewTaskId, tempCaseId } = req.params;

    // 权限检查
    const task = await aiReviewService.getTaskStatus(reviewTaskId);
    if (!task) {
      return res.json({ success: false, message: '评审任务不存在' });
    }

    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);
    if (!await canAccessReviewTask(task, userId, userIsAdmin)) {
      return res.status(403).json({ success: false, message: '您没有权限查看此对比详情' });
    }

    const detail = await aiReviewService.getCompareDetail(reviewTaskId, tempCaseId);

    if (!detail) {
      return res.json({ success: false, message: '对比详情不存在' });
    }

    res.json({
      success: true,
      data: {
        reviewTaskId: detail.reviewTaskId,
        tempCaseId: detail.tempCaseId,
        action: detail.action,
        original: detail.originalContent,
        suggested: detail.suggestedContent,
        diffSummary: detail.diffSummary,
        diffDetail: detail.diffDetail,
        aiComment: detail.aiComment,
        aiScore: detail.aiScore,
        memoryContribution: detail.memoryContribution,
        userDecision: detail.userDecision,
        userComment: detail.userComment,
        userModifiedContent: detail.userModifiedContent,
        toolCallsLog: detail.toolCallsLog
      }
    });
  } catch (error) {
    logger.error('获取对比详情失败', { error: error.message, reviewTaskId: req.params.reviewTaskId, tempCaseId: req.params.tempCaseId });
    res.status(500).json({ success: false, message: '获取对比详情失败' });
  }
});

module.exports = router;
