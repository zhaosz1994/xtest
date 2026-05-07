const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const agentExecutionEngine = require('./agentExecutionEngine');
const reflectionPipeline = require('./reflectionPipeline');
const diffGenerator = require('./diffGenerator');
const memoryEngine = require('./memoryEngine');
const llmResponseParser = require('./llmResponseParser');
const logger = require('./logger');
const PQueue = require('p-queue').default;

const MAX_CONCURRENT = 3;
const ORPHAN_THRESHOLD_MINUTES = 30;
const HEARTBEAT_INTERVAL_MS = 60000;

class AIReviewService {
    async submitReview(taskId, agentId, submitterId, options = {}) {
        try {
            const [tempCases] = await pool.execute(
                'SELECT * FROM temp_test_cases WHERE task_id = ? AND is_duplicate = 0',
                [taskId]
            );

            if (tempCases.length === 0) {
                return { reviewTaskId: null, totalCases: 0, message: '没有待评审的用例' };
            }

            const reviewTaskId = `RVT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 8).toUpperCase()}`;

            await pool.execute(`
                INSERT INTO ai_review_tasks
                    (review_task_id, source_task_id, submitter_id, agent_id, status, total_cases)
                VALUES (?, ?, ?, ?, 'pending', ?)
            `, [reviewTaskId, taskId, submitterId, agentId, tempCases.length]);

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

    async _executeReview(reviewTaskId, agentId, submitterId, tempCases, options = {}) {
        const concurrency = options.concurrency || MAX_CONCURRENT;
        const autoApproveScore = options.autoApproveScore || 0;
        let heartbeatTimer = null;

        try {
            await pool.execute(`
                UPDATE ai_review_tasks
                SET status = 'running', started_at = NOW()
                WHERE review_task_id = ?
            `, [reviewTaskId]);

            heartbeatTimer = setInterval(async () => {
                try {
                    await pool.execute(`
                        UPDATE ai_review_tasks SET updated_at = CURRENT_TIMESTAMP WHERE review_task_id = ?
                    `, [reviewTaskId]);
                } catch (e) {
                    logger.error('心跳更新失败', { reviewTaskId, error: e.message });
                }
            }, HEARTBEAT_INTERVAL_MS);

            const queue = new PQueue({ concurrency });
            const caseResults = [];

            const [agents] = await pool.execute(
                'SELECT agent_code, display_name, max_retries FROM ai_sub_agents WHERE id = ?',
                [agentId]
            );
            const agentCode = agents[0]?.agent_code || 'review_test_cases';
            const agentMaxRetries = agents[0]?.max_retries || 3;

            const rules = await reflectionPipeline.loadRules(agentId);
            const useReflectionPipeline = rules.length > 0;

            if (useReflectionPipeline) {
                logger.info('阶梯式反思评审已启用', {
                    reviewTaskId,
                    agentId,
                    rulesCount: rules.length,
                    maxRetries: agentMaxRetries
                });
            }

            const [users] = await pool.execute(
                'SELECT id, username, role FROM users WHERE id = ?',
                [submitterId]
            );
            const userRole = users[0]?.role || '';
            const username = users[0]?.username || '';

            for (const tempCase of tempCases) {
                queue.add(async () => {
                    let caseResult = { tempCaseId: tempCase.temp_case_id, action: 'reject', error: null };

                    try {
                        const variables = {
                            temp_cases_json: JSON.stringify([this._tempCaseToReviewFormat(tempCase)]),
                            module_name: tempCase.module_name || '',
                            module_description: tempCase.module_desc || '',
                            case_count: 1,
                            auto_approve_score: autoApproveScore,
                            review_focus: '规范性、完整性、一致性'
                        };

                        let reviewResult;
                        let reflectionHistory = null;
                        let finalRulePassed = null;
                        let failedRule = null;
                        let confidenceScore = null;
                        let resolvedAgentId = agentId;
                        let toolCallsLog = null;
                        let memoryContribution = null;
                        let actualReflectionRounds = null;

                        if (useReflectionPipeline) {
                            const draft = this._tempCaseToReviewFormat(tempCase);
                            const pipelineResult = await reflectionPipeline.executeReflectionPipeline(
                                agentId,
                                draft,
                                rules,
                                {
                                    maxRetries: agentMaxRetries,
                                    userId: submitterId
                                }
                            );

                            reflectionHistory = pipelineResult.history || [];
                            finalRulePassed = pipelineResult.final_rule_passed || null;
                            failedRule = pipelineResult.failed_rule || null;
                            actualReflectionRounds = pipelineResult.total_rounds || 0;

                            if (pipelineResult.status === 'needs_human') {
                                reviewResult = {
                                    action: 'needs_human',
                                    score: 0,
                                    comment: '阶梯评审熔断: 规则#' + pipelineResult.failed_rule + '连续' + agentMaxRetries + '次未通过，需人工介入',
                                    suggested_content: null
                                };
                            } else {
                                const revisedDraft = pipelineResult.draft || draft;
                                const hasChanges = JSON.stringify(revisedDraft) !== JSON.stringify(draft);

                                reviewResult = {
                                    action: hasChanges ? 'modify' : 'approve',
                                    score: 0,
                                    comment: pipelineResult.last_rule_summary || '阶梯式反思评审全部通过',
                                    suggested_content: hasChanges ? revisedDraft : null
                                };
                            }

                            confidenceScore = this._calculateConfidenceScore(reflectionHistory, failedRule);
                        } else {
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

                            resolvedAgentId = agentResult.agentId || agentId;
                            toolCallsLog = agentResult.toolCallsLog ? JSON.stringify(agentResult.toolCallsLog) : null;
                            memoryContribution = agentResult.memoryContribution || null;

                            let reviewResults = [];
                            if (agentResult.success && agentResult.result) {
                                reviewResults = llmResponseParser.parseReviewResults(agentResult.result);
                            }

                            reviewResult = reviewResults[0] || {
                                action: 'approve',
                                score: 0,
                                comment: agentResult.error || 'AI评审完成，无具体结果',
                                suggested_content: null
                            };
                        }

                        const originalContent = this._extractCaseContent(tempCase);
                        const suggestedContent = reviewResult.suggested_content || null;
                        const diffSummary = suggestedContent
                            ? diffGenerator.generateDiffSummary(originalContent, suggestedContent)
                            : '';
                        const diffDetail = suggestedContent
                            ? diffGenerator.generateDiffDetail(originalContent, suggestedContent)
                            : [];

                        await pool.execute(`
                            INSERT INTO ai_review_results
                                (review_task_id, temp_case_id, agent_id, action, ai_comment, ai_score,
                                 original_content, suggested_content, diff_summary, diff_detail,
                                 tool_calls_log, memory_contribution,
                                 reflection_history, final_rule_passed, failed_rule, confidence_score)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE
                                agent_id = VALUES(agent_id),
                                action = VALUES(action), ai_comment = VALUES(ai_comment),
                                ai_score = VALUES(ai_score), suggested_content = VALUES(suggested_content),
                                diff_summary = VALUES(diff_summary), diff_detail = VALUES(diff_detail),
                                tool_calls_log = VALUES(tool_calls_log), memory_contribution = VALUES(memory_contribution),
                                reflection_history = VALUES(reflection_history),
                                final_rule_passed = VALUES(final_rule_passed),
                                failed_rule = VALUES(failed_rule),
                                confidence_score = VALUES(confidence_score)
                        `, [
                            reviewTaskId,
                            tempCase.temp_case_id,
                            resolvedAgentId,
                            reviewResult.action,
                            reviewResult.comment,
                            reviewResult.score,
                            JSON.stringify(originalContent),
                            suggestedContent ? JSON.stringify(suggestedContent) : null,
                            diffSummary,
                            JSON.stringify(diffDetail),
                            toolCallsLog,
                            memoryContribution,
                            reflectionHistory ? JSON.stringify(reflectionHistory) : null,
                            finalRulePassed,
                            failedRule,
                            confidenceScore
                        ]);

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

                        caseResult = { tempCaseId: tempCase.temp_case_id, action: reviewResult.action, error: null };

                    } catch (caseError) {
                        logger.error('单条用例评审失败', {
                            reviewTaskId,
                            tempCaseId: tempCase.temp_case_id,
                            error: caseError.message
                        });

                        caseResult = { tempCaseId: tempCase.temp_case_id, action: 'reject', error: caseError.message };

                        try {
                            await pool.execute(`
                                INSERT INTO ai_review_results
                                    (review_task_id, temp_case_id, agent_id, action, ai_comment, ai_score)
                                VALUES (?, ?, ?, 'reject', ?, 0)
                                ON DUPLICATE KEY UPDATE action = VALUES(action), ai_comment = VALUES(ai_comment)
                            `, [reviewTaskId, tempCase.temp_case_id, agentId, '评审失败: ' + caseError.message]);
                        } catch (dbError) {
                            logger.error('保存评审失败记录异常', { reviewTaskId, error: dbError.message });
                        }
                    }

                    caseResults.push(caseResult);
                });
            }

            await queue.onIdle();

            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }

            let approvedCount = 0;
            let rejectedCount = 0;
            let modifiedCount = 0;
            let needsHumanCount = 0;
            for (const cr of caseResults) {
                if (cr.action === 'approve') approvedCount++;
                else if (cr.action === 'reject') rejectedCount++;
                else if (cr.action === 'modify') modifiedCount++;
                else if (cr.action === 'needs_human') needsHumanCount++;
            }
            const reviewedCount = caseResults.length;

            const finalStatus = needsHumanCount > 0 ? 'needs_human' : 'completed';
            let totalReflectionRounds = 0;
            if (useReflectionPipeline) {
                try {
                    const [roundsResult] = await pool.execute(
                        'SELECT reflection_history FROM ai_review_results WHERE review_task_id = ? AND reflection_history IS NOT NULL LIMIT 1',
                        [reviewTaskId]
                    );
                    if (roundsResult.length > 0) {
                        const hist = typeof roundsResult[0].reflection_history === 'string'
                            ? JSON.parse(roundsResult[0].reflection_history)
                            : roundsResult[0].reflection_history;
                        if (Array.isArray(hist)) {
                            totalReflectionRounds = hist.length;
                        }
                    }
                } catch (e) {
                    totalReflectionRounds = rules.length;
                }
            }

            await pool.execute(`
                UPDATE ai_review_tasks
                SET status = ?, completed_at = NOW(), reviewed_cases = ?,
                    approved_cases = ?, rejected_cases = ?, modified_cases = ?,
                    needs_human_cases = ?, reflection_rounds = ?
                WHERE review_task_id = ?
            `, [finalStatus, reviewedCount, approvedCount, rejectedCount, modifiedCount, needsHumanCount, totalReflectionRounds, reviewTaskId]);

            logger.info('AI评审任务完成', {
                reviewTaskId,
                totalCases: tempCases.length,
                approvedCount,
                rejectedCount,
                modifiedCount,
                needsHumanCount,
                finalStatus,
                totalReflectionRounds
            });

            try {
                if (global.io) {
                    global.io.emit('ai_review_completed', {
                        reviewTaskId,
                        totalCases: tempCases.length,
                        approvedCount,
                        rejectedCount,
                        modifiedCount,
                        needsHumanCount,
                        finalStatus,
                        completedAt: new Date().toISOString()
                    });
                }
            } catch (socketError) {
                logger.warn('WebSocket通知发送失败', { error: socketError.message });
            }

            try {
                const emailNotificationService = require('./emailNotificationService');
                const [agentRows] = await pool.execute('SELECT display_name FROM ai_sub_agents WHERE id = ?', [agentId]);
                const agentName = agentRows[0]?.display_name || 'AI评审员';
                const [memoryContribResults] = await pool.execute(
                    'SELECT COUNT(*) as cnt FROM ai_review_results WHERE review_task_id = ? AND memory_contribution IS NOT NULL AND memory_contribution != ""',
                    [reviewTaskId]
                );
                const memoryContribCount = memoryContribResults[0]?.cnt || 0;
                const memoryContribution = memoryContribCount > 0 ? '已参考' + memoryContribCount + '条经验记忆' : '';

                if (finalStatus === 'needs_human') {
                    const [failedResults] = await pool.execute(
                        'SELECT failed_rule, reflection_history FROM ai_review_results WHERE review_task_id = ? AND action = ?',
                        [reviewTaskId, 'needs_human']
                    );
                    const failedRuleInfo = failedResults.map(r => '规则#' + r.failed_rule).join(', ');
                    const historyPreview = failedResults.length > 0 && failedResults[0].reflection_history
                        ? (typeof failedResults[0].reflection_history === 'string' ? JSON.parse(failedResults[0].reflection_history) : failedResults[0].reflection_history)
                            .map(h => h.text || h).slice(-5).join('\n')
                        : '无详细履历';

                    await emailNotificationService.sendToSingleUser('ai_review_circuit_break', submitterId, {
                        taskName: 'AI评审熔断-' + reviewTaskId,
                        agentName,
                        totalCases: tempCases.length,
                        needsHumanCount,
                        failedRuleInfo,
                        historyPreview,
                        completedAt: new Date().toLocaleString('zh-CN'),
                        reviewLink: (process.env.APP_URL || 'http://localhost:3000') + '/#/ai-generation/review'
                    });

                    const [reviewerRows] = await pool.execute(
                        'SELECT DISTINCT cr.reviewer_id FROM case_reviewers cr JOIN temp_test_cases tc ON cr.case_id = tc.temp_case_id JOIN ai_review_results ar ON ar.temp_case_id = tc.temp_case_id WHERE ar.review_task_id = ? AND cr.reviewer_id != ?',
                        [reviewTaskId, submitterId]
                    );
                    for (const reviewer of reviewerRows) {
                        await emailNotificationService.sendToSingleUser('ai_review_circuit_break', reviewer.reviewer_id, {
                            taskName: 'AI评审熔断-' + reviewTaskId,
                            agentName,
                            totalCases: tempCases.length,
                            needsHumanCount,
                            failedRuleInfo,
                            historyPreview,
                            completedAt: new Date().toLocaleString('zh-CN'),
                            reviewLink: (process.env.APP_URL || 'http://localhost:3000') + '/#/ai-generation/review'
                        }).catch(e => logger.warn('熔断通知评审人邮件发送失败', { reviewerId: reviewer.reviewer_id, error: e.message }));
                    }
                } else {
                    await emailNotificationService.sendToSingleUser('ai_review_complete', submitterId, {
                        taskName: 'AI评审-' + reviewTaskId,
                        agentName,
                        totalCases: tempCases.length,
                        approvedCount,
                        rejectedCount,
                        modifiedCount,
                        completedAt: new Date().toLocaleString('zh-CN'),
                        memoryContribution,
                        reviewLink: (process.env.APP_URL || 'http://localhost:3000') + '/#/ai-generation/review'
                    });
                }
            } catch (emailError) {
                logger.warn('AI评审完成邮件发送失败', { error: emailError.message });
            }

            try {
                await memoryEngine.checkAndAutoDistill(agentId);
            } catch (distillError) {
                logger.warn('评审后自动蒸馏失败', { agentId, error: distillError.message });
            }

        } catch (error) {
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
            }

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

    async decideReviewResult(reviewTaskId, tempCaseId, decision, userId, userComment, userModifiedContent) {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

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

            await connection.execute(`
                UPDATE temp_test_cases
                SET ai_user_decision = ?
                WHERE temp_case_id = ?
            `, [decision, tempCaseId]);

            await connection.commit();

            if (decision === 'modified_accepted' && userModifiedContent) {
                try {
                    const [results] = await pool.execute(
                        'SELECT suggested_content FROM ai_review_results WHERE review_task_id = ? AND temp_case_id = ?',
                        [reviewTaskId, tempCaseId]
                    );

                    if (results.length > 0 && results[0].suggested_content) {
                        const suggestedContent = typeof results[0].suggested_content === 'string'
                            ? JSON.parse(results[0].suggested_content)
                            : results[0].suggested_content;

                        const [tasks] = await pool.execute(
                            'SELECT agent_id, submitter_id FROM ai_review_tasks WHERE review_task_id = ?',
                            [reviewTaskId]
                        );

                        if (tasks.length > 0) {
                            const agentId = tasks[0].agent_id;
                            const submitterId = tasks[0].submitter_id;

                            const [caseInfo] = await pool.execute(
                                'SELECT library_id, module_id FROM temp_test_cases WHERE temp_case_id = ?',
                                [tempCaseId]
                            );
                            const caseLibraryId = caseInfo[0]?.library_id || null;
                            const caseModuleId = caseInfo[0]?.module_id || null;

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

            try {
                const emailNotificationService = require('./emailNotificationService');
                const [taskRows] = await pool.execute(
                    'SELECT submitter_id, agent_id FROM ai_review_tasks WHERE review_task_id = ?',
                    [reviewTaskId]
                );
                if (taskRows.length > 0 && taskRows[0].submitter_id !== userId) {
                    const [agentRows] = await pool.execute('SELECT display_name FROM ai_sub_agents WHERE id = ?', [taskRows[0].agent_id]);
                    const agentName = agentRows[0]?.display_name || 'AI评审员';
                    const decisionLabel = { accepted: '采纳', rejected: '拒绝', modified_accepted: '修改后采纳' };

                    await emailNotificationService.sendToSingleUser('ai_review_decision', taskRows[0].submitter_id, {
                        taskName: 'AI评审决策-' + reviewTaskId,
                        agentName,
                        decision: decisionLabel[decision] || decision,
                        userComment: userComment || '',
                        decidedAt: new Date().toLocaleString('zh-CN'),
                        reviewLink: (process.env.APP_URL || 'http://localhost:3000') + '/#/ai-generation/review'
                    });
                }
            } catch (emailError) {
                logger.warn('用户决策邮件发送失败', { error: emailError.message });
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

    async batchMerge(reviewTaskId, userId) {
        try {
            const [tasks] = await pool.execute(
                'SELECT * FROM ai_review_tasks WHERE review_task_id = ?',
                [reviewTaskId]
            );

            if (tasks.length === 0) {
                return { mergedCount: 0, error: '评审任务不存在' };
            }

            const task = tasks[0];

            const [results] = await pool.execute(
                'SELECT temp_case_id, user_decision, user_modified_content FROM ai_review_results WHERE review_task_id = ? AND user_decision IN (?, ?)',
                [reviewTaskId, 'accepted', 'modified_accepted']
            );

            if (results.length === 0) {
                return { mergedCount: 0 };
            }

            const tempCaseIds = results.map(r => r.temp_case_id);

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

            const placeholders = tempCaseIds.map(() => '?').join(',');
            await pool.execute(`
                UPDATE temp_test_cases
                SET status = 'approved'
                WHERE temp_case_id IN (${placeholders}) AND is_duplicate = 0
            `, tempCaseIds);

            const reviewService = require('./reviewService');

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
                memoryContribution: result.memory_contribution,
                reflectionHistory: result.reflection_history
                    ? (typeof result.reflection_history === 'string' ? JSON.parse(result.reflection_history) : result.reflection_history)
                    : null,
                finalRulePassed: result.final_rule_passed || null,
                failedRule: result.failed_rule || null,
                confidenceScore: result.confidence_score || null,
                agentId: result.agent_id || null
            };
        } catch (error) {
            logger.error('获取对比详情失败', { reviewTaskId, tempCaseId, error: error.message });
            return null;
        }
    }

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

    _calculateConfidenceScore(reflectionHistory, failedRule) {
        if (!reflectionHistory || !Array.isArray(reflectionHistory) || reflectionHistory.length === 0) {
            return null;
        }

        if (failedRule) {
            return 0;
        }

        let totalRetries = 0;
        let passedCount = 0;

        for (const entry of reflectionHistory) {
            if (typeof entry === 'object' && entry.type) {
                if (entry.type === 'passed') passedCount++;
                else if (entry.type === 'retry' || entry.type === 'error') totalRetries++;
            } else if (typeof entry === 'string') {
                if (entry.includes('通过')) passedCount++;
                else if (entry.includes('修正') || entry.includes('异常')) totalRetries++;
            }
        }

        if (passedCount === 0) {
            return 0;
        }

        const score = Math.max(0, Math.min(100, Math.round(100 - (totalRetries / (totalRetries + passedCount)) * 50)));
        return score;
    }
}

module.exports = new AIReviewService();
