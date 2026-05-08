const pool = require('../db');
const { default: PQueue } = require('p-queue');
const logger = require('./logger');
const agentExecutionEngine = require('./agentExecutionEngine');
const { getUserAIConfig } = require('./aiService');
const llmResponseParser = require('./llmResponseParser');

class ImportOptimizeService {
  constructor() {
    this.apiQueue = new PQueue({ concurrency: 4 });
  }

  async createOptimizeTask({ library_id, module_id, imported_case_ids, source_file_name, agent_code, config, user_id, username, import_batch_id }) {
    if (!imported_case_ids || imported_case_ids.length === 0) {
      return { success: false, message: '没有需要优化的用例' };
    }

    const taskId = `IMP-OPT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 8)}`;

    const [cases] = await pool.execute(
      `SELECT id, case_id, name, priority, type, precondition, purpose, steps, expected, key_config, remark, module_id, level1_id
       FROM test_cases WHERE id IN (${imported_case_ids.map(() => '?').join(',')}) AND is_deleted = 0 AND library_id = ?`,
      [...imported_case_ids, library_id]
    );

    if (cases.length === 0) {
      return { success: false, message: '未找到有效的用例' };
    }

    const batches = this._splitIntoBatches(cases);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        `INSERT INTO ai_import_optimize_tasks
         (task_id, import_batch_id, library_id, module_id, user_id, username, status, total_cases, total_batches, agent_code, config, source_file_name, progress_message)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, '任务已创建，等待处理')`,
        [taskId, import_batch_id || null, library_id, module_id || null, user_id, username, cases.length, batches.length, agent_code || 'case_import_optimizer', JSON.stringify(config || {}), source_file_name || null]
      );

      for (const batch of batches) {
        const inputData = batch.cases.map(c => ({
          id: c.id,
          name: c.name || '',
          priority: c.priority || '',
          type: c.type || '',
          precondition: c.precondition || '',
          purpose: c.purpose || '',
          steps: c.steps || '',
          expected: c.expected || '',
          key_config: c.key_config || '',
          remark: c.remark || ''
        }));

        await connection.execute(
          `INSERT INTO ai_import_optimize_batches (task_id, batch_index, case_count, status, input_data)
           VALUES (?, ?, ?, 'pending', ?)`,
          [taskId, batch.batchIndex, batch.cases.length, JSON.stringify(inputData)]
        );

        for (const c of batch.cases) {
          await connection.execute(
            `INSERT INTO ai_import_case_mapping (task_id, formal_case_id, formal_case_name, batch_index, status)
             VALUES (?, ?, ?, ?, 'pending')`,
            [taskId, c.id, c.name, batch.batchIndex]
          );
        }
      }

      await connection.commit();

      logger.info('AI导入优化任务已创建', { taskId, totalCases: cases.length, totalBatches: batches.length });

      return {
        success: true,
        data: {
          task_id: taskId,
          status: 'pending',
          total_cases: cases.length,
          total_batches: batches.length,
          message: `AI优化任务已创建，共${cases.length}条用例，分为${batches.length}个批次`
        }
      };
    } catch (error) {
      await connection.rollback();
      logger.error('创建AI导入优化任务失败', { error: error.message });
      return { success: false, message: '创建任务失败: ' + error.message };
    } finally {
      connection.release();
    }
  }

  _splitIntoBatches(cases, maxPerBatch = 10) {
    const MAX_TOKENS_PER_BATCH = 4000;
    const batches = [];
    let currentBatch = [];
    let currentTokens = 0;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const estimatedTokens = this._estimateTokens(c);

      if (currentBatch.length > 0 && (currentTokens + estimatedTokens > MAX_TOKENS_PER_BATCH || currentBatch.length >= maxPerBatch)) {
        batches.push({
          batchIndex: batches.length,
          cases: currentBatch
        });
        currentBatch = [];
        currentTokens = 0;
      }

      currentBatch.push(c);
      currentTokens += estimatedTokens;
    }

    if (currentBatch.length > 0) {
      batches.push({
        batchIndex: batches.length,
        cases: currentBatch
      });
    }

    return batches;
  }

  _estimateTokens(caseData) {
    const fields = ['name', 'priority', 'type', 'precondition', 'purpose', 'steps', 'expected', 'key_config', 'remark'];
    let totalChars = 0;
    for (const field of fields) {
      totalChars += (caseData[field] || '').length;
    }
    return Math.ceil(totalChars / 2) + 100;
  }

  async processTask(taskId) {
    logger.info('开始处理AI导入优化任务', { taskId });

    try {
      const [result] = await pool.execute(
        `UPDATE ai_import_optimize_tasks SET status = 'processing', progress_message = '任务开始处理...' WHERE task_id = ? AND status IN ('pending', 'processing')`,
        [taskId]
      );
      if (result.affectedRows === 0) {
        logger.warn('任务已不在可处理状态，跳过', { taskId });
        return;
      }

      const [tasks] = await pool.execute(
        `SELECT * FROM ai_import_optimize_tasks WHERE task_id = ?`,
        [taskId]
      );

      if (tasks.length === 0) {
        logger.error('任务不存在', { taskId });
        return;
      }

      const task = tasks[0];

      const [batches] = await pool.execute(
        `SELECT * FROM ai_import_optimize_batches WHERE task_id = ? ORDER BY batch_index ASC`,
        [taskId]
      );

      let optimizedCases = 0;
      let failedCases = 0;

      const taskStartTime = task.started_at ? new Date(task.started_at).getTime() : Date.now();
      const TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

      for (const batch of batches) {
        // 检查任务是否已被取消
        const [currentTasks] = await pool.execute(
          `SELECT status FROM ai_import_optimize_tasks WHERE task_id = ?`,
          [taskId]
        );
        if (currentTasks.length > 0 && currentTasks[0].status === 'cancelled') {
          logger.info('任务已被取消，停止处理', { taskId });
          return;
        }

        if (Date.now() - taskStartTime > TASK_TIMEOUT_MS) {
          await pool.execute(
            `UPDATE ai_import_optimize_tasks SET status = 'failed', error_message = '任务执行超时（30分钟）', completed_at = NOW() WHERE task_id = ?`,
            [taskId]
          );
          return;
        }

        if (batch.status === 'completed') {
          optimizedCases += batch.case_count;
          continue;
        }

        try {
          await pool.execute(
            `UPDATE ai_import_optimize_batches SET status = 'processing', started_at = NOW() WHERE id = ?`,
            [batch.id]
          );

          const progress = Math.floor((batch.batch_index / batches.length) * 100);
          await pool.execute(
            `UPDATE ai_import_optimize_tasks SET progress = ?, progress_message = ?, processed_batches = ? WHERE task_id = ?`,
            [progress, `正在优化第 ${batch.batch_index + 1}/${batches.length} 批次...`, batch.batch_index, taskId]
          );

          let batchSuccess = false;
          let lastError = null;
          const maxRetries = 3;

          for (let retry = 0; retry < maxRetries; retry++) {
            try {
              const result = await this.apiQueue.add(() => this._processBatch(taskId, batch, task));
              if (result.success) {
                optimizedCases += result.optimizedCount;
                failedCases += result.failedCount;
                batchSuccess = true;
                break;
              } else {
                lastError = new Error('Batch processing returned failure');
                if (retry < maxRetries - 1) {
                  await new Promise(resolve => setTimeout(resolve, Math.pow(2, retry) * 1000));
                }
              }
            } catch (error) {
              lastError = error;
              if (retry < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, retry) * 1000));
              }
            }
          }

          if (!batchSuccess) {
            failedCases += batch.case_count;
            logger.error('批次处理重试耗尽', { taskId, batchIndex: batch.batch_index, error: lastError?.message });

            await pool.execute(
              `UPDATE ai_import_optimize_batches SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
              [(lastError?.message || '批次处理失败').substring(0, 500), batch.id]
            );
          }
        } catch (error) {
          logger.error('批次处理失败', { taskId, batchIndex: batch.batch_index, error: error.message });
          failedCases += batch.case_count;

          await pool.execute(
            `UPDATE ai_import_optimize_batches SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
            [error.message.substring(0, 500), batch.id]
          );
        }
      }

      const finalProgress = 100;
      if (optimizedCases === 0 && failedCases > 0) {
        await pool.execute(
          `UPDATE ai_import_optimize_tasks 
           SET status = 'failed', progress = ?, progress_message = ?, 
               processed_batches = ?, optimized_cases = ?, failed_cases = ?, error_message = ?, completed_at = NOW()
           WHERE task_id = ?`,
          [finalProgress, `优化失败：全部${failedCases}条用例均失败`, batches.length, optimizedCases, failedCases, '所有用例优化均失败', taskId]
        );
        logger.info('AI导入优化任务全部失败', { taskId, optimizedCases, failedCases });
      } else {
        await pool.execute(
          `UPDATE ai_import_optimize_tasks 
           SET status = 'completed', progress = ?, progress_message = ?, 
               processed_batches = ?, optimized_cases = ?, failed_cases = ?, completed_at = NOW()
           WHERE task_id = ?`,
          [finalProgress, `优化完成：成功${optimizedCases}条，失败${failedCases}条`, batches.length, optimizedCases, failedCases, taskId]
        );
        logger.info('AI导入优化任务完成', { taskId, optimizedCases, failedCases });
      }

      try {
        const importOptimizeAdapter = require('./adapters/importOptimizeAdapter');
        await importOptimizeAdapter.syncToUnifiedTask(taskId);
      } catch (syncErr) {
        logger.error('同步导入优化任务状态到统一任务表失败', { error: syncErr.message, taskId });
      }

    } catch (error) {
      logger.error('AI导入优化任务处理失败', { taskId, error: error.message });

      await pool.execute(
        `UPDATE ai_import_optimize_tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE task_id = ?`,
        [error.message.substring(0, 500), taskId]
      );

      try {
        const importOptimizeAdapter = require('./adapters/importOptimizeAdapter');
        await importOptimizeAdapter.syncToUnifiedTask(taskId);
      } catch (syncErr) {
        logger.error('同步失败导入优化任务状态到统一任务表失败', { error: syncErr.message, taskId });
      }
    }
  }

  async _processBatch(taskId, batch, task) {
    const inputData = typeof batch.input_data === 'string' ? JSON.parse(batch.input_data) : batch.input_data;

    const [priorities] = await pool.execute('SELECT name FROM test_priorities ORDER BY id');
    const [testTypes] = await pool.execute('SELECT name FROM test_types ORDER BY id');
    const [testPhases] = await pool.execute('SELECT name FROM test_phases ORDER BY id');
    const [testMethods] = await pool.execute('SELECT name FROM test_methods ORDER BY id');
    const [environments] = await pool.execute('SELECT name FROM environments ORDER BY id');

    const variables = {
      priorities: priorities.map(p => p.name).join('、'),
      test_types: testTypes.map(t => t.name).join('、'),
      test_phases: testPhases.map(p => p.name).join('、'),
      test_methods: testMethods.map(m => m.name).join('、'),
      environments: environments.map(e => e.name).join('、'),
      batch_index: String(batch.batch_index + 1),
      total_batches: String(task.total_batches),
      cases_json: JSON.stringify(inputData, null, 2)
    };

    const context = {
      libraryId: task.library_id,
      moduleId: task.module_id,
      sourceTaskId: taskId,
      userRole: 'user',
      username: task.username,
      source: 'import_optimize'
    };

    const agentResult = await agentExecutionEngine.executeAgent(
      task.agent_code || 'case_import_optimizer',
      task.user_id,
      variables,
      context
    );

    let optimizedCases = [];
    if (agentResult.success && agentResult.result) {
      const parsed = llmResponseParser.parse(agentResult.result);
      if (Array.isArray(parsed)) {
        optimizedCases = parsed;
      } else if (parsed && typeof parsed === 'object') {
        optimizedCases = Array.isArray(parsed.cases) ? parsed.cases : Array.isArray(parsed.data) ? parsed.data : [parsed];
      }
    }

    if (optimizedCases.length === 0) {
      await pool.execute(
        `UPDATE ai_import_optimize_batches SET status = 'failed', error_message = 'AI返回结果为空或无法解析', completed_at = NOW() WHERE id = ?`,
        [batch.id]
      );
      return { success: false, optimizedCount: 0, failedCount: inputData.length };
    }

    await pool.execute(
      `UPDATE ai_import_optimize_batches SET output_data = ?, status = 'completed', token_input = ?, token_output = ?, llm_model = ?, completed_at = NOW() WHERE id = ?`,
      [
        JSON.stringify(optimizedCases),
        agentResult.promptTokens || 0,
        agentResult.completionTokens || 0,
        agentResult.modelName || null,
        batch.id
      ]
    );

    let optimizedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < optimizedCases.length; i++) {
      const optimized = optimizedCases[i];
      const originalIndex = optimized.original_index !== undefined ? optimized.original_index : i;
      const originalCase = inputData[originalIndex];

      if (!originalCase) {
        failedCount++;
        continue;
      }

      try {
        const fieldChanges = this._computeFieldChanges(originalCase, optimized);

        const tempCaseId = `TC-IMP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        await pool.execute(
          `INSERT INTO temp_test_cases 
           (temp_case_id, task_id, source_type, source_task_id, formal_case_id, field_changes,
            module_id, name, priority, type, precondition, purpose, steps, expected, key_config, remark, status)
           VALUES (?, ?, 'import_optimize', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            tempCaseId, taskId, taskId, originalCase.id,
            JSON.stringify(fieldChanges),
            task.module_id || null,
            optimized.name || originalCase.name,
            optimized.priority || originalCase.priority || '中',
            optimized.type || originalCase.type || '功能测试',
            optimized.precondition || originalCase.precondition || '',
            optimized.purpose || originalCase.purpose || '',
            optimized.steps || originalCase.steps || '',
            optimized.expected || originalCase.expected || '',
            optimized.key_config || originalCase.key_config || '',
            optimized.remark || originalCase.remark || ''
          ]
        );

        await pool.execute(
          `UPDATE ai_import_case_mapping 
           SET temp_case_id = ?, status = 'optimized', optimization_notes = ?, field_changes = ?
           WHERE task_id = ? AND formal_case_id = ? AND batch_index = ?`,
          [
            tempCaseId,
            optimized.optimization_notes || '',
            JSON.stringify(fieldChanges),
            taskId, originalCase.id, batch.batch_index
          ]
        );

        optimizedCount++;
      } catch (error) {
        logger.error('写入优化结果失败', { taskId, batchIndex: batch.batch_index, error: error.message });
        failedCount++;
      }
    }

    return { success: true, optimizedCount, failedCount };
  }

  _computeFieldChanges(original, optimized) {
    const fieldsToCompare = ['name', 'priority', 'type', 'precondition', 'purpose', 'steps', 'expected', 'key_config', 'remark'];
    const changes = {};

    for (const field of fieldsToCompare) {
      const oldVal = (original[field] || '').trim();
      const newVal = (optimized[field] || '').trim();
      if (oldVal !== newVal && newVal !== '') {
        changes[field] = { old: oldVal, new: newVal };
      }
    }

    return changes;
  }

  async getTaskStatus(taskId, userId, userRole) {
    const [tasks] = await pool.execute(
      `SELECT * FROM ai_import_optimize_tasks WHERE task_id = ?`,
      [taskId]
    );

    if (tasks.length === 0) {
      return { success: false, message: '任务不存在' };
    }

    const task = tasks[0];

    // 所有权检查：请求用户必须是任务所有者或管理员
    if (task.user_id !== userId && !['admin', '管理员', 'Administrator'].includes(userRole)) {
      return { success: false, message: '无权查看此任务' };
    }

    return {
      success: true,
      data: {
        task_id: task.task_id,
        status: task.status,
        progress: task.progress,
        progress_message: task.progress_message,
        total_cases: task.total_cases,
        total_batches: task.total_batches,
        processed_batches: task.processed_batches,
        optimized_cases: task.optimized_cases,
        failed_cases: task.failed_cases,
        source_file_name: task.source_file_name,
        started_at: task.started_at,
        completed_at: task.completed_at,
        error_message: task.error_message,
        created_at: task.created_at
      }
    };
  }

  async getTaskList({ library_id, status, page = 1, pageSize = 20, user_id }) {
    let whereSql = `WHERE 1=1`;
    const params = [];

    if (library_id) {
      whereSql += ` AND library_id = ?`;
      params.push(library_id);
    }
    if (status) {
      whereSql += ` AND status = ?`;
      params.push(status);
    }
    if (user_id) {
      whereSql += ` AND user_id = ?`;
      params.push(user_id);
    }

    // COUNT 查询
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM ai_import_optimize_tasks ${whereSql}`,
      params
    );
    const total = countResult[0].total;

    // 分页查询
    const currentPage = Math.max(1, parseInt(page));
    const currentPageSize = Math.max(1, parseInt(pageSize));
    const offset = (currentPage - 1) * currentPageSize;

    const [tasks] = await pool.execute(
      `SELECT * FROM ai_import_optimize_tasks ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, currentPageSize, offset]
    );

    return {
      success: true,
      data: {
        tasks,
        total,
        page: currentPage,
        pageSize: currentPageSize
      }
    };
  }

  async cancelTask(taskId, userId, userRole) {
    const [tasks] = await pool.execute(
      `SELECT user_id, status FROM ai_import_optimize_tasks WHERE task_id = ?`,
      [taskId]
    );

    if (tasks.length === 0) {
      return { success: false, message: '任务不存在' };
    }

    const task = tasks[0];
    if (task.user_id !== userId && userRole !== 'admin' && userRole !== '管理员' && userRole !== 'Administrator') {
      return { success: false, message: '无权取消此任务' };
    }

    if (task.status !== 'pending' && task.status !== 'processing') {
      return { success: false, message: '只能取消待处理或处理中的任务' };
    }

    await pool.execute(
      `UPDATE ai_import_optimize_tasks SET status = 'cancelled', error_message = '用户手动取消', completed_at = NOW() WHERE task_id = ?`,
      [taskId]
    );

    await pool.execute(
      `UPDATE ai_import_optimize_batches SET status = 'failed', error_message = '任务已取消' WHERE task_id = ? AND status IN ('pending', 'processing')`,
      [taskId]
    );

    return { success: true, message: '任务已取消' };
  }

  async mergeWithOverwrite({ task_id, temp_case_ids, overwrite_mode, fields_to_overwrite, user_id, user_role }) {
    if (!temp_case_ids || temp_case_ids.length === 0) {
      return { success: false, message: '请选择要合并的用例' };
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const placeholders = temp_case_ids.map(() => '?').join(',');
      const [tempCases] = await connection.execute(
        `SELECT t.* FROM temp_test_cases t
         INNER JOIN ai_import_optimize_tasks a ON t.source_task_id = a.task_id
         WHERE t.temp_case_id IN (${placeholders}) AND t.source_type = 'import_optimize' AND t.status != 'merged'
         FOR UPDATE`,
        temp_case_ids
      );

      if (tempCases.length === 0) {
        await connection.rollback();
        return { success: false, message: '未找到可合并的临时用例' };
      }

      // 所有权检查：请求用户必须是任务所有者或管理员
      const taskOwnerId = tempCases[0].user_id;
      if (taskOwnerId !== user_id) {
        if (!user_role || !['admin', '管理员', 'Administrator'].includes(user_role)) {
          await connection.rollback();
          return { success: false, message: '无权合并此用例' };
        }
      }

      const mergedResults = [];
      let mergedCount = 0;
      let failedCount = 0;

      for (const tempCase of tempCases) {
        try {
          const formalCaseId = tempCase.formal_case_id;
          if (!formalCaseId) {
            failedCount++;
            continue;
          }

          const [formalCases] = await connection.execute(
            `SELECT * FROM test_cases WHERE id = ? AND is_deleted = 0`,
            [formalCaseId]
          );

          if (formalCases.length === 0) {
            failedCount++;
            continue;
          }

          const formalCase = formalCases[0];
          const fieldsToUpdate = this._getFieldsToUpdate(overwrite_mode, fields_to_overwrite, tempCase.field_changes);

          if (fieldsToUpdate.length === 0) {
            failedCount++;
            continue;
          }

          const setClauses = [];
          const values = [];

          const allowedFields = ['name', 'priority', 'type', 'precondition', 'purpose', 'steps', 'expected', 'key_config', 'remark'];
          for (const field of fieldsToUpdate) {
            if (!allowedFields.includes(field)) continue;
            const tempValue = tempCase[field];
            if (tempValue !== undefined && tempValue !== null) {
              setClauses.push(`${field} = ?`);
              values.push(tempValue);
            }
          }

          if (setClauses.length === 0) {
            failedCount++;
            continue;
          }

          values.push(formalCaseId);
          await connection.execute(
            `UPDATE test_cases SET ${setClauses.join(', ')} WHERE id = ?`,
            values
          );

          await connection.execute(
            `UPDATE temp_test_cases SET status = 'merged', merged_at = NOW() WHERE temp_case_id = ?`,
            [tempCase.temp_case_id]
          );

          await connection.execute(
            `UPDATE ai_import_case_mapping SET status = 'merged', merged_at = NOW(), merged_by = ? WHERE temp_case_id = ?`,
            [user_id, tempCase.temp_case_id]
          );

          mergedResults.push({
            formal_case_id: formalCaseId,
            temp_case_id: tempCase.temp_case_id,
            overwritten_fields: fieldsToUpdate,
            status: 'merged'
          });

          mergedCount++;
        } catch (error) {
          logger.error('覆盖合并单条用例失败', { tempCaseId: tempCase.temp_case_id, error: error.message });
          failedCount++;
        }
      }

      await connection.commit();

      return {
        success: true,
        data: {
          merged_count: mergedCount,
          failed_count: failedCount,
          details: mergedResults
        }
      };
    } catch (error) {
      await connection.rollback();
      logger.error('覆盖合并失败', { error: error.message });
      return { success: false, message: '合并失败: ' + error.message };
    } finally {
      connection.release();
    }
  }

  _getFieldsToUpdate(overwrite_mode, fields_to_overwrite, fieldChanges) {
    const allFields = ['name', 'priority', 'type', 'precondition', 'purpose', 'steps', 'expected', 'key_config', 'remark'];

    switch (overwrite_mode) {
      case 'full':
        return allFields;
      case 'partial':
        return fields_to_overwrite && fields_to_overwrite.length > 0 ? fields_to_overwrite : [];
      case 'smart':
      default:
        if (!fieldChanges) return allFields;
        try {
          const changes = typeof fieldChanges === 'string' ? JSON.parse(fieldChanges) : fieldChanges;
          return Object.keys(changes).filter(k => allFields.includes(k));
        } catch {
          return allFields;
        }
    }
  }

  async recoverInterruptedTasks() {
    try {
      // 先获取需要恢复的任务ID列表
      const [interruptedTasks] = await pool.execute(
        `SELECT task_id FROM ai_import_optimize_tasks WHERE status = 'processing'`
      );

      if (interruptedTasks.length === 0) {
        return;
      }

      const taskIds = interruptedTasks.map(t => t.task_id);
      const placeholders = taskIds.map(() => '?').join(',');

      // 重置任务状态为 pending
      const [result] = await pool.execute(
        `UPDATE ai_import_optimize_tasks
         SET status = 'pending', progress_message = '任务恢复中...'
         WHERE status = 'processing'`
      );

      if (result.affectedRows > 0) {
        logger.info('已恢复中断的导入优化任务', { count: result.affectedRows });

        // 重置 processing 批次回 pending
        await pool.execute(
          `UPDATE ai_import_optimize_batches SET status = 'pending', started_at = NULL
           WHERE task_id IN (${placeholders}) AND status = 'processing'`,
          taskIds
        );

        // 删除 processing 批次产生的孤立临时用例
        await pool.execute(
          `DELETE FROM temp_test_cases
           WHERE source_task_id IN (${placeholders}) AND source_type = 'import_optimize' AND status = 'pending'`,
          taskIds
        );

        // 重置对应 mapping 记录
        await pool.execute(
          `UPDATE ai_import_case_mapping SET status = 'pending', temp_case_id = NULL
           WHERE task_id IN (${placeholders}) AND status = 'optimized'`,
          taskIds
        );

        // 重新计算每个恢复任务的进度
        const [tasks] = await pool.execute(
          `SELECT task_id FROM ai_import_optimize_tasks WHERE status = 'pending' AND started_at IS NOT NULL`
        );
        for (const task of tasks) {
          const [batches] = await pool.execute(
            `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM ai_import_optimize_batches WHERE task_id = ?`,
            [task.task_id]
          );
          const progress = batches[0].total > 0 ? Math.floor((batches[0].completed / batches[0].total) * 100) : 0;
          await pool.execute(
            `UPDATE ai_import_optimize_tasks SET progress = ?, processed_batches = ? WHERE task_id = ?`,
            [progress, batches[0].completed, task.task_id]
          );
        }
      }
    } catch (error) {
      logger.error('恢复中断的导入优化任务失败', { error: error.message });
    }
  }
}

module.exports = new ImportOptimizeService();
