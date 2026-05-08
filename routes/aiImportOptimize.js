const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const importOptimizeService = require('../services/importOptimizeService');
const importOptimizeAdapter = require('../services/adapters/importOptimizeAdapter');
const logger = require('../services/logger');

router.post('/optimize', authenticateToken, async (req, res) => {
  try {
    const { library_id, module_id, imported_case_ids, source_file_name, agent_code, config, import_batch_id } = req.body;

    if (!library_id) {
      return res.json({ success: false, message: '请指定用例库' });
    }

    if (!imported_case_ids || !Array.isArray(imported_case_ids) || imported_case_ids.length === 0) {
      return res.json({ success: false, message: '请提供需要优化的用例ID列表' });
    }

    const result = await importOptimizeService.createOptimizeTask({
      library_id,
      module_id: module_id || null,
      imported_case_ids,
      source_file_name: source_file_name || null,
      agent_code: agent_code || 'case_import_optimizer',
      config: config || {},
      user_id: req.user.id,
      username: req.user.username,
      import_batch_id: import_batch_id || null
    });

    if (result.success && result.data && result.data.task_id) {
      try {
        await importOptimizeAdapter.syncToUnifiedTask(result.data.task_id);
      } catch (syncErr) {
        logger.error('同步导入优化任务到统一任务表失败', { error: syncErr.message, taskId: result.data.task_id });
      }
    }

    res.json(result);
  } catch (error) {
    logger.error('创建AI导入优化任务错误:', { error: error.message });
    res.json({ success: false, message: '创建任务失败: ' + error.message });
  }
});

router.get('/task/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const result = await importOptimizeService.getTaskStatus(taskId, req.user.id, req.user.role);
    res.json(result);
  } catch (error) {
    logger.error('查询AI导入优化任务状态错误:', { error: error.message });
    res.json({ success: false, message: '查询任务状态失败' });
  }
});

router.get('/tasks', authenticateToken, async (req, res) => {
  try {
    const { library_id, status, page, pageSize } = req.query;
    const result = await importOptimizeService.getTaskList({
      library_id: library_id || null,
      status: status || null,
      page: page || 1,
      pageSize: pageSize || 20,
      user_id: req.user.id
    });
    res.json(result);
  } catch (error) {
    logger.error('获取AI导入优化任务列表错误:', { error: error.message });
    res.json({ success: false, message: '获取任务列表失败' });
  }
});

router.post('/cancel/:taskId', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const result = await importOptimizeService.cancelTask(taskId, req.user.id, req.user.role);
    res.json(result);
  } catch (error) {
    logger.error('取消AI导入优化任务错误:', { error: error.message });
    res.json({ success: false, message: '取消任务失败' });
  }
});

router.post('/merge-with-overwrite', authenticateToken, async (req, res) => {
  try {
    const { task_id, temp_case_ids, overwrite_mode, fields_to_overwrite } = req.body;

    if (!temp_case_ids || !Array.isArray(temp_case_ids) || temp_case_ids.length === 0) {
      return res.json({ success: false, message: '请选择要合并的用例' });
    }

    const result = await importOptimizeService.mergeWithOverwrite({
      task_id,
      temp_case_ids,
      overwrite_mode: overwrite_mode || 'smart',
      fields_to_overwrite: fields_to_overwrite || null,
      user_id: req.user.id,
      user_role: req.user.role
    });

    res.json(result);
  } catch (error) {
    logger.error('覆盖合并错误:', { error: error.message });
    res.json({ success: false, message: '合并失败: ' + error.message });
  }
});

module.exports = router;
