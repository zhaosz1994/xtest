const pool = require('../db');
const logger = require('./logger');

class ReviewService {
  async generateCaseIds(count, libraryId, moduleId, isAI, connection) {
    const prefix = isAI ? 'CASE-AI' : 'CASE';
    const libraryStr = String(libraryId || 0).padStart(3, '0');
    const moduleStr = String(moduleId || 0).padStart(3, '0');
    const pattern = `${prefix}-${libraryStr}-${moduleStr}-%`;
    
    const [maxIdResult] = await (connection || pool).execute(`
      SELECT MAX(CAST(SUBSTRING_INDEX(case_id, '-', -1) AS UNSIGNED)) as max_num
      FROM test_cases
      WHERE case_id LIKE ?
    `, [pattern]);
    
    let startNum = (maxIdResult[0].max_num || 0) + 1;
    const caseIds = [];
    
    for (let i = 0; i < count; i++) {
      const sequenceStr = String(startNum + i).padStart(5, '0');
      caseIds.push(`${prefix}-${libraryStr}-${moduleStr}-${sequenceStr}`);
    }
    
    return caseIds;
  }
  async submitReviewResults(taskId, reviews, reviewerId) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      for (const review of reviews) {
        await connection.execute(`
          INSERT INTO case_review_records 
            (task_id, temp_case_id, reviewer_id, result, comment)
          VALUES (?, ?, ?, ?, ?)
        `, [taskId, review.tempCaseId, reviewerId, review.result, review.comment || '']);

        const newStatus = review.result === 'approved' ? 'approved' : 'rejected';
        const newReviewStatus = review.result === 'approved' ? 'approved' : 'rejected';

        await connection.execute(`
          UPDATE temp_test_cases 
          SET review_status = ?, 
              reviewer_id = ?,
              review_comment = ?,
              reviewed_at = NOW(),
              status = ?
          WHERE temp_case_id = ?
        `, [newReviewStatus, reviewerId, review.comment || '', newStatus, review.tempCaseId]);
      }

      await connection.commit();

      const approvedCases = reviews.filter(r => r.result === 'approved');
      const rejectedCases = reviews.filter(r => r.result === 'rejected');

      return {
        approved: approvedCases.length,
        rejected: rejectedCases.length
      };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async mergeApprovedCases(taskId, options = {}) {
    const { defaultOwner, projectIds } = options;

    const [tempCases] = await pool.execute(`
      SELECT * FROM temp_test_cases 
      WHERE task_id = ? AND status = 'approved'
    `, [taskId]);

    if (tempCases.length === 0) {
      return { mergedCount: 0 };
    }

    const level1PointService = require('./level1PointService');
    await level1PointService.mergeLevel1Points(taskId);

    const connection = await pool.getConnection();
    const mergedCaseIds = [];

    try {
      await connection.beginTransaction();

      const moduleGroups = {};
      for (const tempCase of tempCases) {
        const key = `${tempCase.module_id}`;
        if (!moduleGroups[key]) {
          moduleGroups[key] = [];
        }
        moduleGroups[key].push(tempCase);
      }

      const caseIdMap = {};
      for (const [moduleId, cases] of Object.entries(moduleGroups)) {
        const caseIds = await this.generateCaseIds(
          cases.length, 
          options.libraryId, 
          parseInt(moduleId), 
          true, 
          connection
        );
        cases.forEach((tempCase, index) => {
          caseIdMap[tempCase.temp_case_id] = caseIds[index];
        });
      }

      for (const tempCase of tempCases) {
        const owner = tempCase.owner || defaultOwner || '';
        const caseId = caseIdMap[tempCase.temp_case_id];

        const [result] = await connection.execute(`
          INSERT INTO test_cases 
            (case_id, module_id, library_id, level1_id, name, priority, type, 
             precondition, purpose, steps, expected, key_config, remark, 
             method, owner, creator, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [caseId, tempCase.module_id, options.libraryId || null, tempCase.level1_id,
            tempCase.name, tempCase.priority, tempCase.type,
            tempCase.precondition, tempCase.purpose, tempCase.steps,
            tempCase.expected, tempCase.key_config, tempCase.remark,
            tempCase.method || '手动', owner, options.creator || '']);

        const formalCaseId = result.insertId;
        mergedCaseIds.push(formalCaseId);

        if (tempCase.environments) {
          const envs = typeof tempCase.environments === 'string' ? JSON.parse(tempCase.environments) : tempCase.environments;
          if (Array.isArray(envs)) {
            for (const envId of envs) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_environments (test_case_id, environment_id) VALUES (?, ?)
              `, [formalCaseId, envId]);
            }
          }
        }

        if (tempCase.test_types) {
          const types = typeof tempCase.test_types === 'string' ? JSON.parse(tempCase.test_types) : tempCase.test_types;
          if (Array.isArray(types)) {
            for (const typeId of types) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_test_types (test_case_id, test_type_id) VALUES (?, ?)
              `, [formalCaseId, typeId]);
            }
          }
        }

        if (tempCase.phases) {
          const phases = typeof tempCase.phases === 'string' ? JSON.parse(tempCase.phases) : tempCase.phases;
          if (Array.isArray(phases)) {
            for (const phaseId of phases) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_phases (test_case_id, phase_id) VALUES (?, ?)
              `, [formalCaseId, phaseId]);
            }
          }
        }

        if (tempCase.sources) {
          const sources = typeof tempCase.sources === 'string' ? JSON.parse(tempCase.sources) : tempCase.sources;
          if (Array.isArray(sources)) {
            for (const sourceId of sources) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_sources (test_case_id, source_id) VALUES (?, ?)
              `, [formalCaseId, sourceId]);
            }
          }
        }

        if (tempCase.methods) {
          const methods = typeof tempCase.methods === 'string' ? JSON.parse(tempCase.methods) : tempCase.methods;
          if (Array.isArray(methods)) {
            for (const methodId of methods) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_methods (test_case_id, method_id) VALUES (?, ?)
              `, [formalCaseId, methodId]);
            }
          }
        }

        await connection.execute(`
          UPDATE temp_test_cases 
          SET status = 'merged', merged_case_id = ?, merged_at = NOW()
          WHERE id = ?
        `, [formalCaseId, tempCase.id]);
      }

      if (projectIds && projectIds.length > 0 && mergedCaseIds.length > 0) {
        for (const caseId of mergedCaseIds) {
          for (const projectId of projectIds) {
            await connection.execute(`
              INSERT IGNORE INTO test_case_projects 
                (test_case_id, project_id, owner, created_at)
              VALUES (?, ?, ?, NOW())
            `, [caseId, projectId, defaultOwner || '']);
          }
        }
      }

      for (let i = 0; i < tempCases.length; i++) {
        const tempCase = tempCases[i];
        const formalCaseId = mergedCaseIds[i];
        if (tempCase.project_id) {
          await connection.execute(`
            INSERT IGNORE INTO test_case_projects 
              (test_case_id, project_id, owner, created_at)
            VALUES (?, ?, ?, NOW())
          `, [formalCaseId, tempCase.project_id, tempCase.owner || defaultOwner || '']);
        }
        if (tempCase.project_ids) {
          const projectIdsList = typeof tempCase.project_ids === 'string' ? JSON.parse(tempCase.project_ids) : tempCase.project_ids;
          if (Array.isArray(projectIdsList)) {
            for (const projectId of projectIdsList) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_projects 
                  (test_case_id, project_id, owner, created_at)
                VALUES (?, ?, ?, NOW())
              `, [formalCaseId, projectId, tempCase.owner || defaultOwner || '']);
            }
          }
        }
      }

      await connection.execute(`
        UPDATE ai_case_generation_tasks 
        SET approved_count = ?
        WHERE task_id = ?
      `, [mergedCaseIds.length, taskId]);

      const tempCaseIds = tempCases.map(tc => tc.id);
      if (tempCaseIds.length > 0) {
        const placeholders = tempCaseIds.map(() => '?').join(',');
        await connection.execute(`
          DELETE FROM case_embedding_index 
          WHERE case_id IN (${placeholders}) AND case_type = 'temp'
        `, tempCaseIds);
      }

      await connection.commit();

      return { mergedCount: mergedCaseIds.length };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getReviewHistory(tempCaseId) {
    const [records] = await pool.execute(`
      SELECT r.*, u.username as reviewer_name
      FROM case_review_records r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.temp_case_id = ?
      ORDER BY r.created_at DESC
    `, [tempCaseId]);

    return records;
  }

  async getPendingReviewTasks(reviewerId, options = {}) {
    const limit = Math.max(1, Math.min(100, parseInt(options.limit) || 10));
    const offset = Math.max(0, parseInt(options.offset) || 0);

    const [countResult] = await pool.execute(`
      SELECT COUNT(DISTINCT t.task_id) as total
      FROM ai_case_generation_tasks t
      JOIN temp_test_cases tc ON tc.task_id = t.task_id
      JOIN modules m ON t.module_id = m.id
      JOIN users u ON t.user_id = u.id
      WHERE tc.review_status = 'pending' AND tc.reviewer_id = ?
    `, [reviewerId]);
    const total = countResult[0].total;

    const [tasks] = await pool.execute(`
      SELECT DISTINCT t.task_id, t.module_id, t.user_id, t.created_at,
        m.name as module_name,
        u.username as creator_name,
        (SELECT COUNT(*) FROM temp_test_cases WHERE task_id = t.task_id AND review_status = 'pending') as pending_count
      FROM ai_case_generation_tasks t
      JOIN temp_test_cases tc ON tc.task_id = t.task_id
      JOIN modules m ON t.module_id = m.id
      JOIN users u ON t.user_id = u.id
      WHERE tc.review_status = 'pending' AND tc.reviewer_id = ?
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, [reviewerId]);

    return { tasks, total };
  }

  async submitForReview(taskId, reviewerIds, deadline, tempCaseIds) {
    logger.debug('submitForReview 请求参数', { taskId, reviewerIds, deadline, tempCaseCount: tempCaseIds?.length });
    
    let tempCases;
    if (tempCaseIds && tempCaseIds.length > 0) {
      const placeholders = tempCaseIds.map(() => '?').join(',');
      logger.debug('submitForReview 使用 tempCaseIds 查询', { count: tempCaseIds.length });
      const [rows] = await pool.execute(`
        SELECT temp_case_id FROM temp_test_cases 
        WHERE temp_case_id IN (${placeholders}) AND status = 'approved'
      `, tempCaseIds);
      tempCases = rows;
    } else {
      logger.debug('submitForReview 使用 taskId 查询', { taskId });
      const [rows] = await pool.execute(`
        SELECT temp_case_id FROM temp_test_cases 
        WHERE task_id = ? AND status = 'approved'
      `, [taskId]);
      tempCases = rows;
    }

    if (tempCases.length === 0) {
      logger.info('submitForReview 没有找到待提交的用例');
      return { submitted: 0 };
    }

    const primaryReviewerId = reviewerIds && reviewerIds.length > 0 ? reviewerIds[0] : null;
    logger.debug('submitForReview 主要评审人', { primaryReviewerId });

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      for (const tempCase of tempCases) {
        logger.debug('submitForReview 更新用例', { tempCaseId: tempCase.temp_case_id });
        await connection.execute(`
          UPDATE temp_test_cases 
          SET review_status = 'pending',
              reviewer_id = ?,
              review_deadline = ?,
              status = 'approved'
          WHERE temp_case_id = ?
        `, [primaryReviewerId, deadline || null, tempCase.temp_case_id]);
      }

      await connection.commit();
      logger.info('submitForReview 提交成功', { count: tempCases.length });

      return { submitted: tempCases.length };

    } catch (error) {
      logger.error('submitForReview 更新失败', { error: error.message });
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async batchMerge(tempCaseIds, options = {}) {
    if (!tempCaseIds || tempCaseIds.length === 0) {
      return { mergedCount: 0 };
    }

    logger.debug('batchMerge 参数', { options });

    const placeholders = tempCaseIds.map(() => '?').join(',');

    const [tempCases] = await pool.execute(`
      SELECT * FROM temp_test_cases 
      WHERE temp_case_id IN (${placeholders}) AND is_duplicate = 0
    `, tempCaseIds);

    if (tempCases.length === 0) {
      return { mergedCount: 0 };
    }

    const updatePlaceholders = tempCaseIds.map(() => '?').join(',');
    await pool.execute(`
      UPDATE temp_test_cases 
      SET status = 'approved'
      WHERE temp_case_id IN (${updatePlaceholders}) AND is_duplicate = 0
    `, tempCaseIds);

    const approvedIds = tempCases.map(c => c.temp_case_id);

    const level1PointService = require('./level1PointService');
    const taskId = options.taskId || tempCases[0].task_id;
    if (taskId) {
      await level1PointService.mergeLevel1Points(taskId);
    }

    const connection = await pool.getConnection();
    const mergedCaseIds = [];

    try {
      await connection.beginTransaction();

      const moduleGroups = {};
      for (const tempCase of tempCases) {
        const key = `${tempCase.module_id}`;
        if (!moduleGroups[key]) {
          moduleGroups[key] = [];
        }
        moduleGroups[key].push(tempCase);
      }

      const caseIdMap = {};
      for (const [moduleId, cases] of Object.entries(moduleGroups)) {
        const caseIds = await this.generateCaseIds(
          cases.length, 
          options.libraryId, 
          parseInt(moduleId), 
          true, 
          connection
        );
        cases.forEach((tempCase, index) => {
          caseIdMap[tempCase.temp_case_id] = caseIds[index];
        });
      }

      for (const tempCase of tempCases) {
        const owner = tempCase.owner || options.defaultOwner || '';
        const caseId = caseIdMap[tempCase.temp_case_id];

        const [result] = await connection.execute(`
          INSERT INTO test_cases 
            (case_id, module_id, library_id, level1_id, name, priority, type, 
             precondition, purpose, steps, expected, key_config, remark, 
             method, owner, creator, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [caseId, tempCase.module_id, options.libraryId || null, tempCase.level1_id,
            tempCase.name, tempCase.priority, tempCase.type,
            tempCase.precondition, tempCase.purpose, tempCase.steps,
            tempCase.expected, tempCase.key_config, tempCase.remark,
            tempCase.method || '手动', owner, options.creator || '']);

        const formalCaseId = result.insertId;
        mergedCaseIds.push(formalCaseId);

        if (tempCase.environments) {
          const envs = typeof tempCase.environments === 'string' ? JSON.parse(tempCase.environments) : tempCase.environments;
          if (Array.isArray(envs)) {
            for (const envId of envs) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_environments (test_case_id, environment_id) VALUES (?, ?)
              `, [formalCaseId, envId]);
            }
          }
        }

        if (tempCase.test_types) {
          const types = typeof tempCase.test_types === 'string' ? JSON.parse(tempCase.test_types) : tempCase.test_types;
          if (Array.isArray(types)) {
            for (const typeId of types) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_test_types (test_case_id, test_type_id) VALUES (?, ?)
              `, [formalCaseId, typeId]);
            }
          }
        }

        if (tempCase.phases) {
          const phases = typeof tempCase.phases === 'string' ? JSON.parse(tempCase.phases) : tempCase.phases;
          if (Array.isArray(phases)) {
            for (const phaseId of phases) {
              await connection.execute(`
                INSERT IGNORE INTO test_case_phases (test_case_id, phase_id) VALUES (?, ?)
              `, [formalCaseId, phaseId]);
            }
          }
        }

        await connection.execute(`
          UPDATE temp_test_cases SET status = 'merged' WHERE temp_case_id = ?
        `, [tempCase.temp_case_id]);
      }

      await connection.commit();
      return { mergedCount: mergedCaseIds.length };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async directMerge(taskId, options = {}) {
    const [tempCases] = await pool.execute(`
      SELECT * FROM temp_test_cases 
      WHERE task_id = ? AND status = 'pending' AND is_duplicate = 0
    `, [taskId]);

    if (tempCases.length === 0) {
      return { mergedCount: 0 };
    }

    await pool.execute(`
      UPDATE temp_test_cases 
      SET status = 'approved'
      WHERE task_id = ? AND status = 'pending' AND is_duplicate = 0
    `, [taskId]);

    return this.mergeApprovedCases(taskId, options);
  }
}

module.exports = new ReviewService();
