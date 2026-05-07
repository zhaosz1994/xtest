const pool = require('../db');

class BatchEditService {
  async batchUpdateTempCases(tempCaseIds, updates) {
    const fields = [];
    const values = [];

    if (updates.owner !== undefined) {
      fields.push('owner = ?');
      values.push(updates.owner);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.method !== undefined) {
      fields.push('method = ?');
      values.push(updates.method);
    }
    if (updates.environments !== undefined) {
      fields.push('environments = ?');
      values.push(JSON.stringify(updates.environments));
    }
    if (updates.testTypes !== undefined) {
      fields.push('test_types = ?');
      values.push(JSON.stringify(updates.testTypes));
    }
    if (updates.sources !== undefined) {
      fields.push('sources = ?');
      values.push(JSON.stringify(updates.sources));
    }
    if (updates.phases !== undefined) {
      fields.push('phases = ?');
      values.push(JSON.stringify(updates.phases));
    }
    if (updates.methods !== undefined) {
      fields.push('methods = ?');
      values.push(JSON.stringify(updates.methods));
    }
    if (updates.level1Id !== undefined) {
      fields.push('level1_id = ?');
      values.push(updates.level1Id);
    }
    if (updates.level1Name !== undefined) {
      fields.push('level1_name = ?');
      values.push(updates.level1Name);
    }
    if (updates.project_id !== undefined) {
      fields.push('project_id = ?');
      values.push(updates.project_id);
    }
    if (updates.project_ids !== undefined) {
      fields.push('project_ids = ?');
      values.push(JSON.stringify(updates.project_ids));
    }
    if (updates.types !== undefined) {
      fields.push('test_types = ?');
      values.push(JSON.stringify(updates.types));
    }

    fields.push('user_modified = 1');

    if (fields.length === 1) return { updated: 0 };

    const placeholders = tempCaseIds.map(() => '?').join(',');

    const [result] = await pool.execute(`
      UPDATE temp_test_cases 
      SET ${fields.join(', ')}
      WHERE temp_case_id IN (${placeholders})
    `, [...values, ...tempCaseIds]);

    return { updated: result.affectedRows };
  }

  async batchApproveCases(tempCaseIds) {
    if (!tempCaseIds || tempCaseIds.length === 0) return { updated: 0 };

    const placeholders = tempCaseIds.map(() => '?').join(',');

    const [result] = await pool.execute(`
      UPDATE temp_test_cases 
      SET status = 'approved'
      WHERE temp_case_id IN (${placeholders}) AND status = 'pending'
    `, tempCaseIds);

    return { updated: result.affectedRows };
  }

  async batchRejectCases(tempCaseIds) {
    if (!tempCaseIds || tempCaseIds.length === 0) return { updated: 0 };

    const placeholders = tempCaseIds.map(() => '?').join(',');

    const [result] = await pool.execute(`
      UPDATE temp_test_cases 
      SET status = 'rejected'
      WHERE temp_case_id IN (${placeholders}) AND status IN ('pending', 'approved')
    `, tempCaseIds);

    return { updated: result.affectedRows };
  }

  async batchDeleteCases(tempCaseIds) {
    if (!tempCaseIds || tempCaseIds.length === 0) return { deleted: 0 };

    const placeholders = tempCaseIds.map(() => '?').join(',');
    
    const [taskInfo] = await pool.execute(`
      SELECT DISTINCT task_id FROM temp_test_cases 
      WHERE temp_case_id IN (${placeholders})
    `, tempCaseIds);

    const [result] = await pool.execute(`
      DELETE FROM temp_test_cases 
      WHERE temp_case_id IN (${placeholders})
    `, tempCaseIds);

    if (taskInfo.length > 0) {
      const reviewService = require('./reviewService');
      setImmediate(() => {
        taskInfo.forEach(({ task_id }) => {
          reviewService.checkAndCleanupTask(task_id).catch(err => {
            const logger = require('./logger');
            logger.error('后台清理任务失败', { taskId: task_id, error: err.message });
          });
        });
      });
    }

    return { deleted: result.affectedRows };
  }

  async updateSingleCase(tempCaseId, updates) {
    const fields = [];
    const values = [];

    const allowedFields = ['name', 'priority', 'type', 'precondition', 'purpose', 
      'steps', 'expected', 'key_config', 'remark', 'method', 'owner',
      'level1_id', 'level1_name'];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updates[field]);
      }
    }

    const jsonFields = ['environments', 'test_types', 'sources', 'phases', 'methods'];
    for (const field of jsonFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(JSON.stringify(updates[field]));
      }
    }

    if (fields.length === 0) return { updated: 0 };

    fields.push('user_modified = 1');

    values.push(tempCaseId);

    const [result] = await pool.execute(`
      UPDATE temp_test_cases 
      SET ${fields.join(', ')}
      WHERE temp_case_id = ?
    `, values);

    return { updated: result.affectedRows };
  }

  async getCaseDetail(tempCaseId) {
    const [cases] = await pool.execute(`
      SELECT * FROM temp_test_cases WHERE temp_case_id = ?
    `, [tempCaseId]);

    return cases[0] || null;
  }
}

module.exports = new BatchEditService();
