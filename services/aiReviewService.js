const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const agentExecutionEngine = require('./agentExecutionEngine');
const diffGenerator = require('./diffGenerator');
const memoryEngine = require('./memoryEngine');
const llmResponseParser = require('./llmResponseParser');
const logger = require('./logger');
const PQueue = require('p-queue');

const MAX_CONCURRENT = 3;
const ORPHAN_THRESHOLD_MINUTES = 30;
const HEARTBEAT_INTERVAL_MS = 60000;

class AIReviewService {
    /**
     * 提交AI评审任务
     * @param {string} taskId - 来源生成任务ID
     * @param {number} agentId - 评审代理ID
     * @param {number} submitterId - 提交人ID
     * @param {Object} options - 选项
     * @param {number} options.autoApproveScore - 自动通过分数阈值
     * @param {number} options.concurrency - 并发数
     * @param {number} options.libraryId - 用例库ID
     * @param {number} options.moduleId - 模块ID
     * @returns {Object} { reviewTaskId, totalCases }
     */
    async submitReview(taskId, agentId, submitterId, options = {}) {
        try {
            // 1. 获取该任务的临时用例
            const [tempCases] = await pool.execute(
                'SELECT * FROM temp_test_cases WHERE task_id = ? AND is_duplicate = 0',
                [taskId]
            );

            if (tempCases.length === 0) {
                return { reviewTaskId: null, totalCases: 0, message: '没有待评审的用例' };
            }

            // 2. 创建ai_review_tasks记录
            const reviewTaskId = `RVT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 8).toUpperCase()}`;

            await pool.execute(`
                INSERT INTO ai_review_tasks
                    (review_task_id, source_task_id, submitter_id, agent_id, status, total_cases)
                VALUES (?, ?, ?, ?, 'pending', ?)
            `, [reviewTaskId, taskId, submitterId, agentId, tempCases.length]);

            // 3. 异步启动评审流程
            this._executeReview(
                reviewTaskId, agentId, submitterId, tempCases, options
            ).catch(err => {
                logger.error('异步评审执行异常', { reviewTaskId, error: err.message });
            });

            return { reviewTaskId, totalCases: tempCases.length };
        } catch (error) {
            logger.error('提交AI评审失败', { taskId, agentId, error: error.message });
            throw error;
        }
    }

    /**
     * 执行评审主流程
     * @param {string} reviewTaskId - 评审任务ID
     * @param {number} agentId - 代理ID
     * @param {number} submitterId - 提交人ID
     * @param {Array} tempCases - 临时用例列表
     * @param {Object} options - 选项
     */
    async _executeReview(reviewTaskId, agentId, submitterId, tempCases, options = {}) {
        const concurrency = options.concurrency || MAX_CONCURRENT;
        const autoApproveScore = options.autoApproveScore || 0;
        let heartbeatTimer = null;

        try {
            // 1. 标记任务为运行中
            await pool.execute(`
                UPDATE ai_review_tasks
                SET status = 'running', started_at = NOW()
                WHERE review_task_id = ?
            `, [reviewTaskId]);

            // 2. 启动心跳定时器
            heartbeatTimer = setInterval(async () => {
                try {
                    await pool.execute(`
                        UPDATE ai_review_tasks SET updated_at = CURRENT_TIMESTAMP WHERE review_task_id = ?
                    `, [reviewTaskId]);
                } catch (e) {
                    logger.error('心跳更新失败', { reviewTaskId, error: e.message });
                }
            }, HEARTBEAT_INTERVAL_MS);

            // 3. 使用PQueue控制并发
            const queue = new PQueue({ concurrency });
            let reviewedCount = 0;
            let approvedCount = 0;
            let rejectedCount = 0;
            let modifiedCount = 0;

            // 获取代理信息
            const [agents] = await pool.execute(
                'SELECT agent_code, display_name FROM ai_sub_agents WHERE id = ?',
                [agentId]
            );
            const agentCode = agents[0]?.agent_code || 'review_test_cases';

            // 获取提交人信息
            const [users] = await pool.execute(
                'SELECT id, username, role FROM users WHERE id = ?',
                [submitterId]
            );
            const userRole = users[0]?.role || '';
            const username = users[0]?.username || '';

            for (const tempCase of tempCases) {
                queue.add(async () => {
                    try {
                        // 准备模板变量
                        const variables = {
                            temp_cases_json: JSON.stringify([this._tempCaseToReviewFormat(tempCase)]),
                            module_name: tempCase.module_name || '',
                            module_description: tempCase.module_desc || '',
                            case_count: 1,
                            auto_approve_score: autoApproveScore,
                            review_focus: '规范性、完整性、一致性'
                        };

                        // 调用Agent执行引擎
                        const agentResult = await agentExecutionEngine.executeAgent(
                            agentCode,
                            submitterId,
                            variables,
                            {
                                libraryId: options.libraryId,
                                moduleId: options.moduleId || tempCase.module_id,
                                sourceTaskId: tempCase.task_id,
                                userRole,
                                username,
                                source: 'review'
                            }
                        );

                        // 解析评审结果
                        let reviewResults = [];
                        if (agentResult.success && agentResult.result) {
                            reviewResults = llmResponseParser.parseReviewResults(agentResult.result);
                        }

                        const reviewResult = reviewResults[0] || {
                            action: 'approve',
                            score: 0,
                            comment: agentResult.error || 'AI评审完成，无具体结果',
                            suggested_content: null
                        };

                        // 生成diff
                        const originalContent = this._extractCaseContent(tempCase);
                        const suggestedContent = reviewResult.suggested_content || null;
                        const diffSummary = suggestedContent
                            ? diffGenerator.generateDiffSummary(originalContent, suggestedContent)
                            : '';
                        const diffDetail = suggestedContent
                            ? diffGenerator.generateDiffDetail(originalContent, suggestedContent)
                            : [];

                        // 保存评审结果
                        await pool.execute(`
                            INSERT INTO ai_review_results
                                (review_task_id, temp_case_id, action, ai_comment, ai_score,
                                 original_content, suggested_content, diff_summary, diff_detail,
                                 tool_calls_log, memory_contribution)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE
                                action = VALUES(action), ai_comment = VALUES(ai_comment),
                                ai_score = VALUES(ai_score), suggested_content = VALUES(suggested_content),
                                diff_summary = VALUES(diff_summary), diff_detail = VALUES(diff_detail),
                                tool_calls_log = VALUES(tool_calls_log), memory_contribution = VALUES(memory_contribution)
                        `, [
                            reviewTaskId,
                            tempCase.temp_case_id,
                            reviewResult.action,
                            reviewResult.comment,
                            reviewResult.score,
                            JSON.stringify(originalContent),
                            suggestedContent ? JSON.stringify(suggestedContent) : null,
                            diffSummary,
                            JSON.stringify(diffDetail),
                            agentResult.toolCallsLog ? JSON.stringify(agentResult.toolCallsLog) : null,
                            agentResult.memoryContribution || null
                        ]);

                        // 更新临时用例的AI评审字段
                        await pool.execute(`
                            UPDATE temp_test_cases
                            SET ai_review_action = ?,
                                ai_review_comment = ?,
                                ai_review_score = ?,
                                ai_suggested_content = ?,
                                ai_diff_summary = ?,
                                ai_review_task_id = ?
                            WHERE temp_case_id = ?
                        `, [
                            reviewResult.action,
                            reviewResult.comment,
                            reviewResult.score,
                            suggestedContent ? JSON.stringify(suggestedContent) : null,
                            diffSummary,
                            reviewTaskId,
                            tempCase.temp_case_id
                        ]);

                        // 更新计数
                        reviewedCount++;
                        if (reviewResult.action === 'approve') approvedCount++;
                        else if (reviewResult.action === 'reject') rejectedCount++;
                        else if (reviewResult.action === 'modify') modifiedCount++;

                        // 更新任务统计
                        await pool.execute(`
                            UPDATE ai_review_tasks
                            SET reviewed_cases = ?, approved_cases = ?, rejected_cases = ?, modified_cases = ?
                            WHERE review_task_id = ?
                        `, [reviewedCount, approvedCount, rejectedCount, modifiedCount, reviewTaskId]);

                    } catch (caseError) {
                        logger.error('单条用例评审失败', {
                            reviewTaskId,
                            tempCaseId: tempCase.temp_case_id,
                            error: caseError.message
                        });

                        reviewedCount++;

                        // 记录失败结果
                        try {
                            await pool.execute(`
                                INSERT INTO ai_review_results
                                    (review_task_id, temp_case_id, action, ai_comment, ai_score)
                                VALUES (?, ?, 'reject', ?, 0)
                                ON DUPLICATE KEY UPDATE action = VALUES(action), ai_comment = VALUES(ai_comment)
                            `, [reviewTaskId, tempCase.temp_case_id, `评审失败: ${caseError.message}`]);
                        } catch (dbError) {
                            logger.error('保存评审失败记录异常', { reviewTaskId, error: dbError.message });
                        }

                        await pool.execute(`
                            UPDATE ai_review_tasks SET reviewed_cases = ? WHERE review_task_id = ?
                        `, [reviewedCount, reviewTaskId]);
                    }
                });
            }

            // 等待所有评审完成
            await queue.onIdle();

            // 4. 停止心跳
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }

            // 5. 标记任务完成
            await pool.execute(`
                UPDATE ai_review_tasks
                SET status = 'completed', completed_at = NOW()
                WHERE review_task_id = ?
            `, [reviewTaskId]);

            logger.info('AI评审任务完成', {
                reviewTaskId,
                totalCases: tempCases.length,
                approvedCount,
                rejectedCount,
                modifiedCount
            });

            // 5.1 通过WebSocket发送实时通知
            try {
                if (global.io) {
                    global.io.emit('ai_review_completed', {
                        reviewTaskId,
                        totalCases: tempCases.length,
                        approvedCount,
                        rejectedCount,
                        modifiedCount,
                        completedAt: new Date().toISOString()
                    });
                }
            } catch (socketError) {
                logger.warn('WebSocket通知发送失败', { error: socketError.message });
            }

            // 5.5 发送邮件通知
            try {
                const emailNotificationService = require('./emailNotificationService');
                const [agentRows] = await pool.execute('SELECT display_name FROM ai_sub_agents WHERE id = ?', [agentId]);
                const agentName = agentRows[0]?.display_name || 'AI评审员';
                // 统计本次评审中有Memory贡献的结果数
                const [memoryContribResults] = await pool.execute(
                    'SELECT COUNT(*) as cnt FROM ai_review_results WHERE review_task_id = ? AND memory_contribution IS NOT NULL AND memory_contribution != ""',
                    [reviewTaskId]
                );
                const memoryContribCount = memoryContribResults[0]?.cnt || 0;
                const memoryContribution = memoryContribCount > 0 ? `已参考${memoryContribCount}条经验记忆` : '';

                await emailNotificationService.sendToSingleUser('ai_review_complete', submitterId, {
                    taskName: `AI评审-${reviewTaskId}`,
                    agentName,
                    totalCases: tempCases.length,
                    approvedCount,
                    rejectedCount,
                    modifiedCount,
                    completedAt: new Date().toLocaleString('zh-CN'),
                    memoryContribution,
                    reviewLink: `${process.env.APP_URL || 'http://localhost:3000'}/#/ai-generation/review`
                });
            } catch (emailError) {
                logger.warn('AI评审完成邮件发送失败', { error: emailError.message });
            }

            // 6. 自动蒸馏记忆
            try {
                await memoryEngine.checkAndAutoDistill(agentId);
            } catch (distillError) {
                logger.warn('评审后自动蒸馏失败', { agentId, error: distillError.message });
            }

        } catch (error) {
            // 停止心跳
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
            }

            // 标记任务失败
            try {
                await pool.execute(`
                    UPDATE ai_review_tasks
                    SET status = 'failed', error_message = ?, completed_at = NOW()
                    WHERE review_task_id = ?
                `, [error.message, reviewTaskId]);
            } catch (dbError) {
                logger.error('标记评审任务失败时数据库异常', { reviewTaskId, error: dbError.message });
            }

            logger.error('AI评审任务执行失败', { reviewTaskId, error: error.message });
        }
    }

    /**
     * 获取评审任务状态
     * @param {string} reviewTaskId - 评审任务ID
     * @returns {Object|null} 任务状态
     */
    async getTaskStatus(reviewTaskId) {
        try {
            const [tasks] = await pool.execute(
                'SELECT * FROM ai_review_tasks WHERE review_task_id = ?',
                [reviewTaskId]
            );
            return tasks[0] || null;
        } catch (error) {
            logger.error('获取评审任务状态失败', { reviewTaskId, error: error.message });
            return null;
        }
    }

    /**
     * 获取评审任务的所有评审结果（支持筛选）
     * @param {string} reviewTaskId - 评审任务ID
     * @param {Object} filters - 筛选条件
     * @param {string} filters.action - 按AI动作筛选 (approve/reject/modify)
     * @param {string} filters.userDecision - 按用户决策筛选 (pending/accepted/rejected/modified_accepted)
     * @param {string} filters.search - 按用例名称搜索
     * @returns {Array} 评审结果数组
     */
    async getReviewResults(reviewTaskId, filters = {}) {
        try {
            let sql = `SELECT r.*, t.name as case_name
                       FROM ai_review_results r
                       LEFT JOIN temp_test_cases t ON r.temp_case_id = t.temp_case_id
                       WHERE r.review_task_id = ?`;
            const params = [reviewTaskId];

            if (filters.action) {
                sql += ' AND r.action = ?';
                params.push(filters.action);
            }
            if (filters.userDecision) {
                sql += ' AND r.user_decision = ?';
                params.push(filters.userDecision);
            }
            if (filters.search) {
                sql += ' AND (t.name LIKE ? OR r.ai_comment LIKE ?)';
                params.push(`%${filters.search}%`, `%${filters.search}%`);
            }

            sql += ' ORDER BY r.created_at ASC';

            const [results] = await pool.execute(sql, params);
            return results;
        } catch (error) {
            logger.error('获取评审结果失败', { reviewTaskId, error: error.message });
            return [];
        }
    }

    /**
     * 单条评审决策
     * @param {string} reviewTaskId - 评审任务ID
     * @param {string} tempCaseId - 临时用例ID
     * @param {string} decision - 决策: accepted/rejected/modified_accepted
     * @param {number} userId - 决策人ID
     * @param {string} userComment - 用户意见
     * @param {Object} userModifiedContent - 用户修改后的内容（modified_accepted时）
     * @returns {Object} 操作结果
     */
    async decideReviewResult(reviewTaskId, tempCaseId, decision, userId, userComment, userModifiedContent) {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // 更新评审结果
            await connection.execute(`
                UPDATE ai_review_results
                SET user_decision = ?, user_comment = ?, user_modified_content = ?,
                    decided_at = NOW(), decided_by = ?
                WHERE review_task_id = ? AND temp_case_id = ?
            `, [
                decision,
                userComment || '',
                userModifiedContent ? JSON.stringify(userModifiedContent) : null,
                userId,
                reviewTaskId,
                tempCaseId
            ]);

            // 更新临时用例
            await connection.execute(`
                UPDATE temp_test_cases
                SET ai_user_decision = ?
                WHERE temp_case_id = ?
            `, [decision, tempCaseId]);

            await connection.commit();

            // 如果是修改后接受，触发记忆蒸馏
            if (decision === 'modified_accepted' && userModifiedContent) {
                try {
                    // 获取评审结果中的suggested_content
                    const [results] = await pool.execute(
                        'SELECT suggested_content FROM ai_review_results WHERE review_task_id = ? AND temp_case_id = ?',
                        [reviewTaskId, tempCaseId]
                    );

                    if (results.length > 0 && results[0].suggested_content) {
                        const suggestedContent = typeof results[0].suggested_content === 'string'
                            ? JSON.parse(results[0].suggested_content)
                            : results[0].suggested_content;

                        // 获取评审任务的agent_id
                        const [tasks] = await pool.execute(
                            'SELECT agent_id FROM ai_review_tasks WHERE review_task_id = ?',
                            [reviewTaskId]
                        );

                        if (tasks.length > 0) {
                            const agentId = tasks[0].agent_id;

                            // 获取该用例所属的library_id和module_id，用于精准蒸馏到对应记忆节点
                            const [caseInfo] = await pool.execute(
                                'SELECT library_id, module_id FROM temp_test_cases WHERE temp_case_id = ?',
                                [tempCaseId]
                            );
                            const caseLibraryId = caseInfo[0]?.library_id || null;
                            const caseModuleId = caseInfo[0]?.module_id || null;

                            // 异步蒸馏，不阻塞主流程
                            memoryEngine.distillFromUserCorrection(
                                agentId,
                                caseLibraryId,
                                caseModuleId,
                                suggestedContent,
                                userModifiedContent
                            ).catch(err => {
                                logger.warn('异步记忆蒸馏失败', { reviewTaskId, tempCaseId, error: err.message });
                            });
                        }
                    }
                } catch (distillError) {
                    logger.warn('触发记忆蒸馏失败', { reviewTaskId, tempCaseId, error: distillError.message });
                }
            }

            return { success: true };
        } catch (error) {
            await connection.rollback();
            logger.error('评审决策失败', { reviewTaskId, tempCaseId, decision, error: error.message });
            return { success: false, error: error.message };
        } finally {
            connection.release();
        }
    }

    /**
     * 批量评审决策
     * @param {string} reviewTaskId - 评审任务ID
     * @param {Array} decisions - 决策列表 [{ tempCaseId, decision, userComment, userModifiedContent }]
     * @param {number} userId - 决策人ID
     * @returns {Object} { success, processedCount }
     */
    async batchDecide(reviewTaskId, decisions, userId) {
        if (!decisions || decisions.length === 0) {
            return { success: true, processedCount: 0 };
        }

        let processedCount = 0;
        const errors = [];

        for (const d of decisions) {
            const result = await this.decideReviewResult(
                reviewTaskId,
                d.tempCaseId,
                d.decision,
                userId,
                d.userComment,
                d.userModifiedContent
            );

            if (result.success) {
                processedCount++;
            } else {
                errors.push({ tempCaseId: d.tempCaseId, error: result.error });
            }
        }

        return {
            success: errors.length === 0,
            processedCount,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * 批量合并已接受的用例到正式test_cases表
     * @param {string} reviewTaskId - 评审任务ID
     * @param {number} userId - 操作人ID
     * @returns {Object} { mergedCount }
     */
    async batchMerge(reviewTaskId, userId) {
        try {
            // 获取评审任务信息
            const [tasks] = await pool.execute(
                'SELECT * FROM ai_review_tasks WHERE review_task_id = ?',
                [reviewTaskId]
            );

            if (tasks.length === 0) {
                return { mergedCount: 0, error: '评审任务不存在' };
            }

            const task = tasks[0];

            // 获取已接受/修改后接受的评审结果
            const [results] = await pool.execute(
                'SELECT temp_case_id, user_decision, user_modified_content FROM ai_review_results WHERE review_task_id = ? AND user_decision IN (?, ?)',
                [reviewTaskId, 'accepted', 'modified_accepted']
            );

            if (results.length === 0) {
                return { mergedCount: 0 };
            }

            const tempCaseIds = results.map(r => r.temp_case_id);

            // 对于modified_accepted的用例，先更新临时用例内容为用户修改后的内容
            for (const result of results) {
                if (result.user_decision === 'modified_accepted' && result.user_modified_content) {
                    const modifiedContent = typeof result.user_modified_content === 'string'
                        ? JSON.parse(result.user_modified_content)
                        : result.user_modified_content;

                    const fields = [];
                    const values = [];

                    for (const [key, value] of Object.entries(modifiedContent)) {
                        if (['name', 'priority', 'type', 'precondition', 'purpose', 'steps', 'expected', 'key_config', 'remark'].includes(key)) {
                            fields.push(`${key} = ?`);
                            values.push(value);
                        }
                    }

                    if (fields.length > 0) {
                        values.push(result.temp_case_id);
                        await pool.execute(
                            `UPDATE temp_test_cases SET ${fields.join(', ')} WHERE temp_case_id = ?`,
                            values
                        );
                    }
                }
            }

            // 标记临时用例为approved状态
            const placeholders = tempCaseIds.map(() => '?').join(',');
            await pool.execute(`
                UPDATE temp_test_cases
                SET status = 'approved'
                WHERE temp_case_id IN (${placeholders}) AND is_duplicate = 0
            `, tempCaseIds);

            // 使用reviewService的mergeApprovedCases模式进行合并
            const reviewService = require('./reviewService');

            // 获取来源任务ID以获取libraryId等信息
            const [sourceTasks] = await pool.execute(
                'SELECT * FROM ai_case_generation_tasks WHERE task_id = ?',
                [task.source_task_id]
            );

            const sourceTask = sourceTasks[0] || {};
            const mergeOptions = {
                libraryId: sourceTask.library_id,
                defaultOwner: '',
                creator: userId
            };

            const mergeResult = await reviewService.mergeApprovedCases(task.source_task_id, mergeOptions);

            return { mergedCount: mergeResult.mergedCount || 0 };
        } catch (error) {
            logger.error('批量合并失败', { reviewTaskId, userId, error: error.message });
            return { mergedCount: 0, error: error.message };
        }
    }

    /**
     * 获取单条用例的对比详情
     * @param {string} reviewTaskId - 评审任务ID
     * @param {string} tempCaseId - 临时用例ID
     * @returns {Object|null} 对比详情
     */
    async getCompareDetail(reviewTaskId, tempCaseId) {
        try {
            const [results] = await pool.execute(
                'SELECT * FROM ai_review_results WHERE review_task_id = ? AND temp_case_id = ?',
                [reviewTaskId, tempCaseId]
            );

            if (results.length === 0) {
                return null;
            }

            const result = results[0];

            // 解析JSON字段
            const originalContent = typeof result.original_content === 'string'
                ? JSON.parse(result.original_content)
                : result.original_content;
            const suggestedContent = typeof result.suggested_content === 'string'
                ? JSON.parse(result.suggested_content)
                : result.suggested_content;
            const diffDetail = typeof result.diff_detail === 'string'
                ? JSON.parse(result.diff_detail)
                : result.diff_detail;
            const userModifiedContent = typeof result.user_modified_content === 'string'
                ? JSON.parse(result.user_modified_content)
                : result.user_modified_content;

            return {
                reviewTaskId: result.review_task_id,
                tempCaseId: result.temp_case_id,
                action: result.action,
                aiComment: result.ai_comment,
                aiScore: result.ai_score,
                originalContent: originalContent || {},
                suggestedContent: suggestedContent || null,
                diffSummary: result.diff_summary || '',
                diffDetail: diffDetail || [],
                userDecision: result.user_decision,
                userComment: result.user_comment,
                userModifiedContent: userModifiedContent,
                toolCallsLog: result.tool_calls_log
                    ? (typeof result.tool_calls_log === 'string' ? JSON.parse(result.tool_calls_log) : result.tool_calls_log)
                    : null,
                memoryContribution: result.memory_contribution
            };
        } catch (error) {
            logger.error('获取对比详情失败', { reviewTaskId, tempCaseId, error: error.message });
            return null;
        }
    }

    /**
     * 清理孤儿任务（超时未更新的运行中任务）
     * @returns {Object} { cleanedCount }
     */
    async cleanupOrphanTasks() {
        try {
            const [result] = await pool.execute(`
                UPDATE ai_review_tasks
                SET status = 'failed', error_message = '任务超时，已自动清理', completed_at = NOW()
                WHERE status = 'running'
                AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
            `, [ORPHAN_THRESHOLD_MINUTES]);

            if (result.affectedRows > 0) {
                logger.warn('清理孤儿评审任务', { cleanedCount: result.affectedRows });
            }

            return { cleanedCount: result.affectedRows };
        } catch (error) {
            logger.error('清理孤儿任务失败', { error: error.message });
            return { cleanedCount: 0, error: error.message };
        }
    }

    /**
     * 将临时用例转换为评审格式
     * @param {Object} tempCase - 临时用例记录
     * @returns {Object} 评审格式的用例对象
     */
    _tempCaseToReviewFormat(tempCase) {
        return {
            temp_case_id: tempCase.temp_case_id,
            name: tempCase.name || '',
            priority: tempCase.priority || '中',
            type: tempCase.type || '功能测试',
            precondition: tempCase.precondition || '',
            purpose: tempCase.purpose || '',
            steps: tempCase.steps || '',
            expected: tempCase.expected || '',
            key_config: tempCase.key_config || '',
            remark: tempCase.remark || ''
        };
    }

    /**
     * 从临时用例中提取内容字段
     * @param {Object} tempCase - 临时用例记录
     * @returns {Object} 内容字段对象
     */
    _extractCaseContent(tempCase) {
        return {
            name: tempCase.name || '',
            priority: tempCase.priority || '中',
            type: tempCase.type || '功能测试',
            precondition: tempCase.precondition || '',
            purpose: tempCase.purpose || '',
            steps: tempCase.steps || '',
            expected: tempCase.expected || '',
            key_config: tempCase.key_config || '',
            remark: tempCase.remark || ''
        };
    }
}

module.exports = new AIReviewService();
