const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin, isAdmin } = require('../middleware');
const pool = require('../db');
const logger = require('../services/logger');
const unifiedTaskService = require('../services/unifiedTaskService');
const caseGenerationAdapter = require('../services/adapters/caseGenerationAdapter');

router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { taskType, targetType, targetId, targetName, config } = req.body;

    if (!taskType) {
      return res.status(400).json({ success: false, message: '缺少任务类型' });
    }

    if (!targetType || !targetId) {
      return res.status(400).json({ success: false, message: '缺少目标信息' });
    }

    if (!['overview_generation', 'key_config_generation'].includes(taskType)) {
      return res.status(400).json({ success: false, message: '不支持的任务类型' });
    }

    // 重复任务检查已移入createTask事务内（FOR UPDATE），此处不再单独查询
    try {
      const task = await unifiedTaskService.createTask(
        taskType,
        req.user.id,
        req.user.username,
        { type: targetType, id: targetId, name: targetName || '' },
        config || {}
      );

      res.json({ success: true, data: task });
    } catch (createError) {
      if (createError.code === 'DUPLICATE_TASK') {
        return res.json({
          success: false,
          message: '该目标已有进行中的任务',
          data: { taskId: createError.existingTaskId, status: createError.existingStatus }
        });
      }
      throw createError;
    }
  } catch (error) {
    logger.error('创建AI任务失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/running', authenticateToken, async (req, res) => {
  try {
    const isAdminUser = isAdmin(req.user);
    const tasks = isAdminUser
      ? await unifiedTaskService.getAllRunningTasks()
      : await unifiedTaskService.getRunningTasks(req.user.id);

    const enrichedTasks = [];
    for (const task of tasks) {
      const enriched = { ...task };

      if (task.task_type === 'case_generation') {
        try {
          const detail = await caseGenerationAdapter.getDetailedProgress(task.task_id);
          if (detail) {
            enriched.stageDetail = detail;
          }
        } catch (e) {
          logger.error('获取用例生成详细进度失败', { taskId: task.task_id, error: e.message });
        }
      }

      const config = (() => {
        try {
          return typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {});
        } catch (e) {
          return {};
        }
      })();
      enriched.configParsed = config;

      enrichedTasks.push(enriched);
    }

    res.json({ success: true, data: enrichedTasks });
  } catch (error) {
    logger.error('获取运行中任务失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { days } = req.query;
    const parsedDays = Math.min(Math.max(parseInt(days) || 7, 1), 90);
    const isAdminUser = isAdmin(req.user);
    const userId = isAdminUser ? null : req.user.id;
    const stats = await unifiedTaskService.getStats(parsedDays, userId);
    stats.isAdmin = isAdminUser;
    stats.days = parsedDays;
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('获取任务统计失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/cancel/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const cancelled = await unifiedTaskService.cancelTask(taskId, req.user.id);

    if (cancelled) {
      res.json({ success: true, message: '任务已取消' });
    } else {
      res.json({ success: false, message: '无法取消该任务（可能已开始处理或不存在）' });
    }
  } catch (error) {
    logger.error('取消任务失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/token-stats', authenticateToken, async (req, res) => {
  try {
    const { days } = req.query;
    const stats = await unifiedTaskService.getTokenStats(parseInt(days) || 7);
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('获取Token统计失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/batch/overview', authenticateToken, async (req, res) => {
  try {
    const { level1PointIds, conflictStrategy } = req.body;

    if (!level1PointIds || !Array.isArray(level1PointIds) || level1PointIds.length === 0) {
      return res.status(400).json({ success: false, message: '请至少选择一个测试点' });
    }

    if (level1PointIds.length > 50) {
      return res.status(400).json({ success: false, message: '单次批量生成不超过50个测试点' });
    }

    const validPointIds = level1PointIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);
    if (validPointIds.length === 0) {
      return res.status(400).json({ success: false, message: '无效的测试点ID' });
    }

    const results = [];

    for (const pointId of validPointIds) {
      try {
        // 冲突策略检查（非原子，仅作为快速预过滤，最终原子性由createTask事务保证）
        if (conflictStrategy === 'skip') {
          const [points] = await pool.execute(
            'SELECT summary FROM level1_points WHERE id = ?',
            [pointId]
          );
          if (points.length > 0 && points[0].summary) {
            results.push({ pointId, success: false, message: '跳过: 已有概述' });
            continue;
          }
        }

        const [points] = await pool.execute(
          'SELECT name FROM level1_points WHERE id = ?',
          [pointId]
        );
        const pointName = points.length > 0 ? points[0].name : '';

        const appendMode = conflictStrategy === 'append';

        try {
          const task = await unifiedTaskService.createTask(
            'overview_generation',
            req.user.id,
            req.user.username,
            { type: 'level1_point', id: pointId, name: pointName },
            { appendMode, conflictStrategy }
          );
          results.push({ pointId, success: true, taskId: task.taskId });
        } catch (createError) {
          if (createError.code === 'DUPLICATE_TASK') {
            results.push({ pointId, success: false, message: '已有进行中的任务' });
          } else {
            results.push({ pointId, success: false, message: createError.message });
          }
        }
      } catch (error) {
        results.push({ pointId, success: false, message: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      data: {
        total: results.length,
        successCount,
        failedCount: results.length - successCount,
        results
      },
      message: `已提交 ${successCount} 个概述生成任务到队列`
    });
  } catch (error) {
    logger.error('批量创建概述任务失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/batch/key-config', authenticateToken, async (req, res) => {
  try {
    const { caseIds, conflictStrategy } = req.body;

    if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
      return res.status(400).json({ success: false, message: '请至少选择一个用例' });
    }

    if (caseIds.length > 50) {
      return res.status(400).json({ success: false, message: '单次批量生成不超过50个用例' });
    }

    const validCaseIds = caseIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);
    if (validCaseIds.length === 0) {
      return res.status(400).json({ success: false, message: '无效的用例ID' });
    }

    const results = [];

    for (const caseId of validCaseIds) {
      try {
        // 冲突策略检查（非原子，仅作为快速预过滤，最终原子性由createTask事务保证）
        if (conflictStrategy === 'skip') {
          const [cases] = await pool.execute(
            'SELECT key_config FROM test_cases WHERE id = ?',
            [caseId]
          );
          if (cases.length > 0 && cases[0].key_config) {
            results.push({ caseId, success: false, message: '跳过: 已有关键配置' });
            continue;
          }
        }

        const [cases] = await pool.execute(
          'SELECT name, precondition, purpose, steps, expected FROM test_cases WHERE id = ?',
          [caseId]
        );

        if (cases.length === 0) {
          results.push({ caseId, success: false, message: '用例不存在' });
          continue;
        }

        const appendMode = conflictStrategy === 'append';

        try {
          const task = await unifiedTaskService.createTask(
            'key_config_generation',
            req.user.id,
            req.user.username,
            { type: 'test_case', id: caseId, name: cases[0].name },
            { appendMode, conflictStrategy, inputData: cases[0] }
          );
          results.push({ caseId, success: true, taskId: task.taskId });
        } catch (createError) {
          if (createError.code === 'DUPLICATE_TASK') {
            results.push({ caseId, success: false, message: '已有进行中的任务' });
          } else {
            results.push({ caseId, success: false, message: createError.message });
          }
        }
      } catch (error) {
        results.push({ caseId, success: false, message: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      data: {
        total: results.length,
        successCount,
        failedCount: results.length - successCount,
        results
      },
      message: `已提交 ${successCount} 个关键配置生成任务到队列`
    });
  } catch (error) {
    logger.error('批量创建关键配置任务失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/check-pending/:targetType/:targetId', authenticateToken, async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const { taskType } = req.query;

    let sql = `SELECT task_id, task_type, status, progress, progress_message FROM ai_unified_tasks
               WHERE target_type = ? AND target_id = ? AND status IN ('pending', 'processing')`;
    const params = [targetType, targetId];

    if (taskType) {
      sql += ' AND task_type = ?';
      params.push(taskType);
    }

    sql += ' LIMIT 1';

    const [tasks] = await pool.execute(sql, params);

    res.json({
      success: true,
      data: tasks.length > 0 ? tasks[0] : null,
      hasPending: tasks.length > 0
    });
  } catch (error) {
    logger.error('检查待处理任务失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/type-configs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [configs] = await pool.execute(
      'SELECT * FROM ai_task_type_configs ORDER BY priority DESC'
    );
    res.json({ success: true, data: configs });
  } catch (error) {
    logger.error('获取任务类型配置失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/type-configs/:taskType', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { taskType } = req.params;
    const { concurrency, timeoutMs, maxRetry, isEnabled } = req.body;

    const updates = [];
    const params = [];

    if (concurrency !== undefined) {
      const c = parseInt(concurrency);
      if (isNaN(c) || c < 1 || c > 10) {
        return res.status(400).json({ success: false, message: '并发数必须在1-10之间' });
      }
      updates.push('concurrency = ?');
      params.push(c);
    }
    if (timeoutMs !== undefined) {
      const t = parseInt(timeoutMs);
      if (isNaN(t) || t < 1000 || t > 3600000) {
        return res.status(400).json({ success: false, message: '超时时间必须在1000-3600000毫秒之间' });
      }
      updates.push('timeout_ms = ?');
      params.push(t);
    }
    if (maxRetry !== undefined) {
      const r = parseInt(maxRetry);
      if (isNaN(r) || r < 0 || r > 10) {
        return res.status(400).json({ success: false, message: '最大重试次数必须在0-10之间' });
      }
      updates.push('max_retry = ?');
      params.push(r);
    }
    if (isEnabled !== undefined) {
      updates.push('is_enabled = ?');
      params.push(isEnabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '没有需要更新的配置' });
    }

    params.push(taskType);

    await pool.execute(
      `UPDATE ai_task_type_configs SET ${updates.join(', ')} WHERE task_type = ?`,
      params
    );

    res.json({ success: true, message: '配置已更新' });
  } catch (error) {
    logger.error('更新任务类型配置失败', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
