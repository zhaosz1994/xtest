/**
 * AI Review Module
 * AI辅助评审功能前端模块
 */
(function() {
    'use strict';

    let aiReviewInitialized = false;

// 模块状态
let aiReviewCurrentTaskId = null;
let aiReviewResults = [];
let aiReviewSelectedIds = new Set();
let aiReviewPollingTimer = null;
let aiReviewAgents = [];
let aiReviewFilterAction = '';
let aiReviewFilterDecision = '';
let aiReviewSearchKeyword = '';

/**
 * 初始化AI评审模块
 */
function initAIReview() {
    if (aiReviewInitialized) return;
    aiReviewInitialized = true;
    initAIReviewEventListeners();
    loadAISubAgents();
}

/**
 * 初始化事件监听
 */
function initAIReviewEventListeners() {
    // 子标签切换
    const aiTab = document.getElementById('aiReviewSubTab');
    const humanTab = document.getElementById('humanReviewSubTab');
    if (aiTab) {
        aiTab.addEventListener('click', function () {
            switchReviewSubTab('ai');
        });
    }
    if (humanTab) {
        humanTab.addEventListener('click', function () {
            switchReviewSubTab('human');
        });
    }

    // 筛选栏
    const filterAction = document.getElementById('ai-review-action-filter');
    const filterDecision = document.getElementById('ai-review-decision-filter');
    const searchInput = document.getElementById('ai-review-search');

    if (filterAction) {
        filterAction.addEventListener('change', function () {
            aiReviewFilterAction = this.value;
            applyAIReviewFilters();
        });
    }
    if (filterDecision) {
        filterDecision.addEventListener('change', function () {
            aiReviewFilterDecision = this.value;
            applyAIReviewFilters();
        });
    }
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function () {
            aiReviewSearchKeyword = this.value.trim().toLowerCase();
            applyAIReviewFilters();
        }, 300));
    }

    // 批量操作按钮
    const batchApproveBtn = document.getElementById('ai-review-batch-accept-btn');
    const batchRejectBtn = document.getElementById('ai-review-batch-reject-btn');
    const batchMergeBtn = document.getElementById('ai-review-batch-merge-btn');

    if (batchApproveBtn) {
        batchApproveBtn.addEventListener('click', function () {
            batchDecide(aiReviewCurrentTaskId, 'accepted');
        });
    }
    if (batchRejectBtn) {
        batchRejectBtn.addEventListener('click', function () {
            batchDecide(aiReviewCurrentTaskId, 'rejected');
        });
    }
    if (batchMergeBtn) {
        batchMergeBtn.addEventListener('click', function () {
            batchMerge(aiReviewCurrentTaskId);
        });
    }

    // 全选复选框
    const selectAllCb = document.getElementById('ai-review-select-all');
    if (selectAllCb) {
        selectAllCb.addEventListener('change', function () {
            const checked = this.checked;
            aiReviewSelectedIds.clear();
            if (checked) {
                aiReviewResults.forEach(r => aiReviewSelectedIds.add(r.temp_case_id));
            }
            updateAIReviewCheckboxes();
            updateAIReviewBatchButtons();
        });
    }

    // 提交评审对话框中的AI评审选项
    const enableAiCb = document.getElementById('enable-ai-review-checkbox');
    if (enableAiCb) {
        enableAiCb.addEventListener('change', function () {
            const aiOptions = document.getElementById('ai-review-options');
            if (aiOptions) {
                aiOptions.style.display = this.checked ? 'block' : 'none';
            }
        });
    }

    // Agent下拉框变化
    const agentSelect = document.getElementById('ai-review-agent-select');
    if (agentSelect) {
        agentSelect.addEventListener('change', function () {
            updateAgentInfoCard(this.value);
        });
    }

    // 对比模态框中的决策区域
    const compareModal = document.getElementById('aiCompareModal');
    if (compareModal) {
        compareModal.addEventListener('click', function (e) {
            const radio = e.target.closest('input[name="compareDecision"]');
            if (radio) {
                const editArea = document.getElementById('aiCompareEditArea');
                if (editArea) {
                    editArea.style.display = (radio.value === 'modified_accepted' || radio.value === 'edit_accept') ? 'block' : 'none';
                }
            }

            const confirmBtn = e.target.closest('#aiCompareConfirmBtn');
            if (confirmBtn) {
                submitCompareDecision();
            }

            const cancelBtn = e.target.closest('#aiCompareCancelBtn') || e.target.closest('#aiCompareCancelBtn2');
            if (cancelBtn) {
                closeCompareModal();
            }
        });
    }

    // 结果表格事件委托
    const resultsBody = document.getElementById('ai-review-results-body');
    if (resultsBody) {
        resultsBody.addEventListener('click', function (e) {
            const viewBtn = e.target.closest('[data-action="view-compare"]');
            if (viewBtn) {
                const taskId = viewBtn.dataset.taskId;
                const tempCaseId = viewBtn.dataset.tempCaseId;
                openCompareModal(taskId, tempCaseId);
                return;
            }

            const decideBtn = e.target.closest('[data-action="decide"]');
            if (decideBtn) {
                const taskId = decideBtn.dataset.taskId;
                const tempCaseId = decideBtn.dataset.tempCaseId;
                const decision = decideBtn.dataset.decision;
                decideReviewResult(taskId, tempCaseId, decision);
                return;
            }
        });

        resultsBody.addEventListener('change', function (e) {
            if (e.target.classList.contains('ai-review-row-checkbox')) {
                const tempCaseId = e.target.dataset.tempCaseId;
                if (e.target.checked) {
                    aiReviewSelectedIds.add(tempCaseId);
                } else {
                    aiReviewSelectedIds.delete(tempCaseId);
                }
                updateAIReviewBatchButtons();
                updateAIReviewSelectAllState();
            }
        });
    }
}

/**
 * 切换评审子标签
 */
function switchReviewSubTab(tab) {
    const humanTab = document.getElementById('humanReviewSubTab');
    const aiTab = document.getElementById('aiReviewSubTab');
    const humanContent = document.getElementById('manual-review-container');
    const aiContent = document.getElementById('ai-review-container');

    const activeStyle = 'padding:8px 16px;cursor:pointer;border-bottom:2px solid #6366f1;color:#6366f1;font-weight:500;';
    const inactiveStyle = 'padding:8px 16px;cursor:pointer;color:#606266;';

    if (tab === 'ai') {
        if (humanTab) { humanTab.classList.remove('active'); humanTab.style.cssText = inactiveStyle; }
        if (aiTab) { aiTab.classList.add('active'); aiTab.style.cssText = activeStyle; }
        if (humanContent) humanContent.style.display = 'none';
        if (aiContent) aiContent.style.display = 'block';
        loadAIReviewTasks();
    } else {
        if (aiTab) { aiTab.classList.remove('active'); aiTab.style.cssText = inactiveStyle; }
        if (humanTab) { humanTab.classList.add('active'); humanTab.style.cssText = activeStyle; }
        if (aiContent) aiContent.style.display = 'none';
        if (humanContent) humanContent.style.display = 'block';
    }
}

/**
 * 加载AI评审任务列表
 */
async function loadAIReviewTasks() {
    const container = document.getElementById('ai-review-tasks-list');
    if (!container) return;

    try {
        const result = await apiRequest('/ai-review/task/list', { method: 'GET', useCache: false });
        if (result.success) {
            const tasks = result.data || [];
            if (tasks.length === 0) {
                container.innerHTML = '<div class="ai-review-empty"><div class="icon">📋</div><p>暂无AI评审任务</p></div>';
                return;
            }
            container.innerHTML = tasks.map(task => renderTaskCard(task)).join('');
            bindTaskCardEvents(container);
        } else {
            showErrorMessage(result.message || '加载AI评审任务失败');
        }
    } catch (e) {
        console.error('[AI Review] loadAIReviewTasks error:', e);
        showErrorMessage('加载AI评审任务失败，请检查网络连接');
    }
}

/**
 * 渲染任务卡片
 */
function renderTaskCard(task) {
    const statusMap = {
        pending: '待处理',
        running: '评审中',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消',
        needs_human: '需人工介入'
    };
    const statusClassMap = {
        pending: 'ai-review-status-pending',
        running: 'ai-review-status-running',
        completed: 'ai-review-status-completed',
        failed: 'ai-review-status-failed',
        cancelled: 'ai-review-status-cancelled',
        needs_human: 'ai-review-status-needs-human'
    };
    const progress = task.progress || 0;

    return '<div class="ai-review-task-card" data-task-id="' + escapeHtml(task.review_task_id) + '">' +
        '<div class="ai-review-task-header">' +
            '<div class="ai-review-task-info">' +
                '<h4>' + escapeHtml(task.module_name || task.review_task_id) + '</h4>' +
                '<span class="ai-review-status-badge ' + (statusClassMap[task.status] || '') + '">' + escapeHtml(statusMap[task.status] || task.status) + '</span>' +
            '</div>' +
            '<div class="ai-review-task-meta">' +
                '<span>' + aiReviewFormatDateTime(task.created_at) + '</span>' +
                '<span>Agent: ' + escapeHtml(task.agent_name || '默认') + '</span>' +
            '</div>' +
        '</div>' +
        (task.status === 'running' ?
            '<div class="ai-review-task-progress">' +
                '<div class="ai-review-progress-bar"><div class="ai-review-progress-fill" style="width:' + progress + '%"></div></div>' +
                '<span class="ai-review-progress-text">' + progress + '%</span>' +
            '</div>' : '') +
        '<div class="ai-review-task-footer">' +
            '<span>用例数: ' + (task.total_cases || 0) + '</span>' +
            (task.needs_human_cases > 0 ? '<span class="ai-review-needs-human-count">⚠️ 需人工介入: ' + task.needs_human_cases + '</span>' : '') +
            (task.reflection_rounds > 0 ? '<span class="ai-review-reflection-rounds">🔄 反思轮数: ' + task.reflection_rounds + '</span>' : '') +
            '<button class="ai-btn ai-btn-sm ai-btn-primary" data-action="view-results" data-task-id="' + escapeHtml(task.review_task_id) + '">查看结果</button>' +
        '</div>' +
    '</div>';
}

/**
 * 绑定任务卡片事件
 */
function bindTaskCardEvents(container) {
    container.querySelectorAll('[data-action="view-results"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const taskId = this.dataset.taskId;
            showAIReviewResults(taskId);
        });
    });
}

/**
 * 显示指定任务的AI评审结果
 */
async function showAIReviewResults(reviewTaskId) {
    aiReviewCurrentTaskId = reviewTaskId;
    aiReviewSelectedIds.clear();

    const resultsContainer = document.getElementById('ai-review-results-area');
    const taskListContainer = document.getElementById('ai-review-tasks-list');

    if (taskListContainer) taskListContainer.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'block';

    // 返回按钮
    const backBtn = document.getElementById('ai-review-back-btn');
    if (backBtn) {
        backBtn.onclick = function () {
            if (taskListContainer) taskListContainer.style.display = 'block';
            if (resultsContainer) resultsContainer.style.display = 'none';
            stopPolling();
            aiReviewCurrentTaskId = null;
        };
    }

    try {
        const result = await apiRequest('/ai-review/results/' + reviewTaskId, { method: 'GET', useCache: false });
        if (result.success) {
            aiReviewResults = result.data || [];
            renderStatsCards(aiReviewResults);
            renderResultsTable(aiReviewResults);
            updateAIReviewBatchButtons();

            // 检查任务状态，若还在运行则开始轮询
            const taskResult = await apiRequest('/ai-review/task/' + reviewTaskId, { method: 'GET', useCache: false });
            if (taskResult.success && taskResult.data && taskResult.data.status === 'running') {
                pollTaskStatus(reviewTaskId);
            }
        } else {
            showErrorMessage(result.message || '加载评审结果失败');
        }
    } catch (e) {
        console.error('[AI Review] showAIReviewResults error:', e);
        showErrorMessage('加载评审结果失败，请检查网络连接');
    }
}

/**
 * 渲染统计卡片
 */
function renderStatsCards(results) {
    const container = document.getElementById('ai-review-stats-cards');
    if (!container) return;

    let approved = 0;
    let rejected = 0;
    let modified = 0;
    let pending = 0;
    let needsHuman = 0;
    let memoryCount = 0;

    results.forEach(function (r) {
        const decision = r.userDecision || r.user_decision || r.decision || r.human_decision || '';
        const action = r.action || r.ai_action || '';
        if (action === 'needs_human') {
            needsHuman++;
        } else if (decision === 'accepted') approved++;
        else if (decision === 'rejected') rejected++;
        else if (decision === 'edit_accept' || decision === 'modified_accepted' || decision === 'modified') modified++;
        else pending++;

        if (r.memory_count && r.memory_count > memoryCount) {
            memoryCount = r.memory_count;
        }
    });

    container.innerHTML =
        '<div class="ai-review-stat-card ai-review-stat-approved">' +
            '<div class="ai-review-stat-icon">✅</div>' +
            '<div class="ai-review-stat-value">' + approved + '</div>' +
            '<div class="ai-review-stat-label">通过</div>' +
        '</div>' +
        '<div class="ai-review-stat-card ai-review-stat-rejected">' +
            '<div class="ai-review-stat-icon">❌</div>' +
            '<div class="ai-review-stat-value">' + rejected + '</div>' +
            '<div class="ai-review-stat-label">拒绝</div>' +
        '</div>' +
        '<div class="ai-review-stat-card ai-review-stat-modified">' +
            '<div class="ai-review-stat-icon">✏️</div>' +
            '<div class="ai-review-stat-value">' + modified + '</div>' +
            '<div class="ai-review-stat-label">建议修改</div>' +
        '</div>' +
        (needsHuman > 0 ?
            '<div class="ai-review-stat-card ai-review-stat-needs-human">' +
                '<div class="ai-review-stat-icon">⚠️</div>' +
                '<div class="ai-review-stat-value">' + needsHuman + '</div>' +
                '<div class="ai-review-stat-label">需人工介入</div>' +
            '</div>' : '') +
        '<div class="ai-review-stat-card ai-review-stat-pending">' +
            '<div class="ai-review-stat-icon">⏳</div>' +
            '<div class="ai-review-stat-value">' + pending + '</div>' +
            '<div class="ai-review-stat-label">待决策</div>' +
        '</div>';

    const memoryNote = document.getElementById('ai-review-memory-note');
    if (memoryNote) {
        if (memoryCount > 0) {
            memoryNote.textContent = '💾 已参考' + memoryCount + '条模块经验';
            memoryNote.style.display = 'inline-block';
        } else {
            memoryNote.style.display = 'none';
        }
    }
}

/**
 * 渲染结果表格
 */
function renderResultsTable(results) {
    const tbody = document.getElementById('ai-review-results-body');
    if (!tbody) return;

    if (!results || results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--ai-text-secondary);">暂无评审结果</td></tr>';
        return;
    }

    tbody.innerHTML = results.map(function (r) {
        return renderResultRow(r);
    }).join('');
}

/**
 * 渲染单行结果
 */
function renderResultRow(result) {
    const tempCaseId = result.tempCaseId || result.temp_case_id || '';
    const caseName = result.caseName || result.case_name || result.name || '';
    const action = result.action || result.ai_action || '';
    const score = result.aiScore != null ? result.aiScore : (result.ai_score != null ? result.ai_score : '-');
    const diffSummary = result.diffSummary || result.diff_summary || '';
    const decision = result.userDecision || result.user_decision || result.decision || result.human_decision || '';
    const confidenceScore = result.confidenceScore != null ? result.confidenceScore : (result.confidence_score != null ? result.confidence_score : null);
    const reflectionHistory = result.reflectionHistory || result.reflection_history || null;
    const reflectionRounds = (reflectionHistory && Array.isArray(reflectionHistory)) ? reflectionHistory.length : 0;
    const taskId = aiReviewCurrentTaskId || '';

    const actionMap = {
        add: '新增',
        modify: '修改',
        delete: '删除',
        keep: '保留',
        approve: '通过',
        reject: '拒绝',
        needs_human: '需人工介入'
    };
    const actionClassMap = {
        add: 'ai-review-action-add',
        modify: 'ai-review-action-modify',
        delete: 'ai-review-action-delete',
        keep: 'ai-review-action-keep',
        approve: 'ai-review-action-approve',
        reject: 'ai-review-action-reject',
        needs_human: 'ai-review-action-needs-human'
    };
    const decisionMap = {
        accepted: '已采纳',
        rejected: '已拒绝',
        edit_accept: '编辑采纳',
        modified_accepted: '编辑采纳',
        modified: '已修改',
        pending: '待决策'
    };
    const decisionClassMap = {
        accepted: 'ai-review-decision-accepted',
        rejected: 'ai-review-decision-rejected',
        edit_accept: 'ai-review-decision-modified',
        modified_accepted: 'ai-review-decision-modified',
        modified: 'ai-review-decision-modified',
        pending: 'ai-review-decision-pending'
    };

    const displayAction = actionMap[action] || action;
    const displayDecision = decisionMap[decision] || decision || '待决策';
    const effectiveDecision = decision || 'pending';
    const isChecked = aiReviewSelectedIds.has(tempCaseId) ? 'checked' : '';

    let decisionHtml = '<span class="ai-review-decision-badge ' + (decisionClassMap[effectiveDecision] || 'ai-review-decision-pending') + '">' + escapeHtml(displayDecision) + '</span>';

    // 操作按钮
    let actionsHtml = '<button class="ai-btn ai-btn-sm ai-btn-ghost" data-action="view-compare" data-task-id="' + escapeHtml(taskId) + '" data-temp-case-id="' + escapeHtml(tempCaseId) + '">查看</button>';

    if (effectiveDecision === 'pending') {
        actionsHtml += ' <button class="ai-btn ai-btn-sm ai-btn-success" data-action="decide" data-task-id="' + escapeHtml(taskId) + '" data-temp-case-id="' + escapeHtml(tempCaseId) + '" data-decision="accepted">采纳</button>';
        actionsHtml += ' <button class="ai-btn ai-btn-sm ai-btn-danger" data-action="decide" data-task-id="' + escapeHtml(taskId) + '" data-temp-case-id="' + escapeHtml(tempCaseId) + '" data-decision="rejected">拒绝</button>';
    }

    return '<tr data-temp-case-id="' + escapeHtml(tempCaseId) + '">' +
        '<td><input type="checkbox" class="ai-review-row-checkbox" data-temp-case-id="' + escapeHtml(tempCaseId) + '" ' + isChecked + '></td>' +
        '<td class="ai-review-case-name">' + escapeHtml(caseName) + '</td>' +
        '<td><span class="ai-review-action-badge ' + (actionClassMap[action] || '') + '">' + escapeHtml(displayAction) + '</span></td>' +
        '<td>' + (typeof score === 'number' ? '<span class="ai-review-score">' + score + '</span>' : score) + '</td>' +
        '<td>' + (confidenceScore != null ? '<span class="ai-review-confidence' + (confidenceScore >= 80 ? ' ai-confidence-high' : confidenceScore >= 50 ? ' ai-confidence-medium' : ' ai-confidence-low') + '">' + confidenceScore + '</span>' : '-') + '</td>' +
        '<td>' + (reflectionRounds > 0 ? '<span class="ai-review-rounds">' + reflectionRounds + '</span>' : '-') + '</td>' +
        '<td class="ai-review-diff-summary">' + escapeHtml(diffSummary) + '</td>' +
        '<td>' + decisionHtml + '</td>' +
        '<td class="ai-review-actions">' + actionsHtml + '</td>' +
    '</tr>';
}

/**
 * 应用筛选条件
 */
function applyAIReviewFilters() {
    let filtered = aiReviewResults.slice();

    if (aiReviewFilterAction) {
        filtered = filtered.filter(function (r) {
            return (r.ai_action || '') === aiReviewFilterAction;
        });
    }

    if (aiReviewFilterDecision) {
        filtered = filtered.filter(function (r) {
            const d = r.decision || r.human_decision || 'pending';
            return d === aiReviewFilterDecision;
        });
    }

    if (aiReviewSearchKeyword) {
        filtered = filtered.filter(function (r) {
            const name = (r.case_name || r.name || '').toLowerCase();
            const summary = (r.diff_summary || '').toLowerCase();
            return name.includes(aiReviewSearchKeyword) || summary.includes(aiReviewSearchKeyword);
        });
    }

    renderResultsTable(filtered);
}

/**
 * 打开对比详情模态框
 */
async function openCompareModal(reviewTaskId, tempCaseId) {
    const modal = document.getElementById('aiCompareModal');
    if (!modal) return;

    try {
        const result = await apiRequest('/ai-review/compare/' + reviewTaskId + '/' + tempCaseId, { method: 'GET', useCache: false });
        if (result.success) {
            const data = result.data || {};
            renderCompareModal(data, reviewTaskId, tempCaseId);
            modal.style.display = 'flex';
        } else {
            showErrorMessage(result.message || '加载对比详情失败');
        }
    } catch (e) {
        console.error('[AI Review] openCompareModal error:', e);
        showErrorMessage('加载对比详情失败，请检查网络连接');
    }
}

/**
 * 渲染对比模态框内容
 */
function renderCompareModal(data, reviewTaskId, tempCaseId) {
    const originalContent = document.getElementById('aiCompareOriginal');
    const suggestedContent = document.getElementById('aiCompareSuggested');
    const diffSection = document.getElementById('aiCompareDiff');
    const memoryNote = document.getElementById('aiCompareMemoryNote');
    const commentSection = document.getElementById('aiCompareComment');
    const editArea = document.getElementById('aiCompareEditArea');
    const editTextarea = document.getElementById('aiCompareEditText');

    if (originalContent) {
        originalContent.innerHTML = renderCaseContent(data.original || {});
    }

    if (suggestedContent) {
        suggestedContent.innerHTML = renderCaseContent(data.suggested || data.ai_suggested || {});
    }

    if (diffSection) {
        const diffContent = data.diffSummary || data.diff_summary || data.diffDetail || data.diff_detail || data.diff || '无差异摘要';
        diffSection.innerHTML = '<h4>Diff摘要</h4><div class="ai-compare-diff-body">' + escapeHtml(diffContent).replace(/\n/g, '<br>') + '</div>';
    }

    if (memoryNote) {
        const memCount = data.memory_count || 0;
        if (memCount > 0) {
            memoryNote.textContent = '💾 已参考' + memCount + '条模块经验';
            memoryNote.style.display = 'block';
        } else {
            memoryNote.style.display = 'none';
        }
    }

    if (commentSection) {
        let commentHtml = '<h4>评审详情</h4>';

        commentHtml += '<div class="ai-compare-basic-info">';
        const actionLabel = { approve: '通过', reject: '拒绝', modify: '建议修改', needs_human: '需人工介入' };
        commentHtml += '<div class="ai-compare-info-item"><span class="ai-compare-info-label">评审结果:</span> <span class="ai-review-action-badge ' + (actionLabel[data.action] ? 'ai-review-action-' + data.action : '') + '">' + escapeHtml(actionLabel[data.action] || data.action || '-') + '</span></div>';

        if (data.aiScore != null) {
            commentHtml += '<div class="ai-compare-info-item"><span class="ai-compare-info-label">评审分数:</span> ' + data.aiScore + '</div>';
        }

        if (data.confidenceScore != null) {
            commentHtml += '<div class="ai-compare-info-item"><span class="ai-compare-info-label">置信度:</span> <span class="ai-compare-confidence-value' +
                (data.confidenceScore >= 80 ? ' ai-confidence-high' : data.confidenceScore >= 50 ? ' ai-confidence-medium' : ' ai-confidence-low') +
                '">' + data.confidenceScore + '</span>/100</div>';
        }

        if (data.failedRule != null) {
            commentHtml += '<div class="ai-compare-failed-rule">⚠️ 熔断规则: 规则#' + data.failedRule + '</div>';
        }

        if (data.finalRulePassed != null) {
            commentHtml += '<div class="ai-compare-passed-rule">✅ 最终通过规则: 规则#' + data.finalRulePassed + '</div>';
        }
        commentHtml += '</div>';

        commentHtml += '<div class="ai-compare-comment-body">' + escapeHtml(data.aiComment || data.ai_comment || data.comment || '无评审意见') + '</div>';

        commentSection.innerHTML = commentHtml;
    }

    renderReflectionTimeline(data.reflectionHistory || data.reflection_history, data.failedRule != null ? data.failedRule : (data.failed_rule != null ? data.failed_rule : null));

    const radios = document.querySelectorAll('input[name="compareDecision"]');
    radios.forEach(function (r) { r.checked = false; });

    if (editArea) editArea.style.display = 'none';
    if (editTextarea) editTextarea.value = formatSuggestedContent(data.suggested || data.ai_suggested || {});

    const userComment = document.getElementById('aiCompareUserComment');
    if (userComment) userComment.value = '';

    modal.dataset.reviewTaskId = reviewTaskId;
    modal.dataset.tempCaseId = tempCaseId;
}

function renderReflectionTimeline(history, failedRule) {
    let container = document.getElementById('aiCompareReflectionTimeline');
    if (!container) {
        const modal = document.getElementById('aiCompareModal');
        if (!modal) return;
        const modalBody = modal.querySelector('.ai-compare-modal-body') || modal.querySelector('.modal-body');
        if (!modalBody) return;
        const timelineDiv = document.createElement('div');
        timelineDiv.id = 'aiCompareReflectionTimeline';
        timelineDiv.className = 'ai-compare-reflection-timeline';
        modalBody.appendChild(timelineDiv);
        container = timelineDiv;
    }

    if (!history || !Array.isArray(history) || history.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    let html = '<h4>阶梯评审履历</h4><div class="ai-reflection-timeline">';

    history.forEach(function (entry, index) {
        let isPassed = false;
        let isCircuitBreak = false;
        let entryType = '';
        let displayText = '';

        if (typeof entry === 'object' && entry.type) {
            entryType = entry.type;
            displayText = entry.text || entry.summary || '';
            isPassed = entryType === 'passed';
            isCircuitBreak = failedRule != null && entryType === 'error' && index === history.length - 1;
        } else if (typeof entry === 'string') {
            displayText = entry;
            isPassed = entry.includes('通过');
            isCircuitBreak = failedRule != null && (entry.includes('异常') || entry.includes('熔断')) && index === history.length - 1;
        }

        const statusClass = isPassed ? 'ai-timeline-passed' : (isCircuitBreak ? 'ai-timeline-circuit-break' : 'ai-timeline-retry');
        const icon = isPassed ? '✅' : (isCircuitBreak ? '🔴' : '🔄');

        html += '<div class="ai-timeline-item ' + statusClass + '">' +
            '<div class="ai-timeline-icon">' + icon + '</div>' +
            '<div class="ai-timeline-content">' +
                '<div class="ai-timeline-text">' + escapeHtml(displayText) + '</div>' +
            '</div>' +
        '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

/**
 * 渲染用例内容为HTML
 */
function renderCaseContent(caseData) {
    if (!caseData || Object.keys(caseData).length === 0) {
        return '<div class="ai-compare-empty">无内容</div>';
    }

    let html = '';
    const fields = [
        { key: 'name', label: '用例名称' },
        { key: 'priority', label: '优先级' },
        { key: 'type', label: '类型' },
        { key: 'precondition', label: '前置条件' },
        { key: 'purpose', label: '测试目的' },
        { key: 'steps', label: '测试步骤' },
        { key: 'expected', label: '预期结果' }
    ];

    fields.forEach(function (field) {
        const value = caseData[field.key];
        if (value != null && value !== '') {
            const isLongText = ['steps', 'expected', 'precondition', 'purpose'].indexOf(field.key) !== -1;
            html += '<div class="ai-compare-field">' +
                '<label>' + escapeHtml(field.label) + '</label>' +
                (isLongText
                    ? '<pre class="ai-compare-pre">' + escapeHtml(value) + '</pre>'
                    : '<span>' + escapeHtml(value) + '</span>') +
            '</div>';
        }
    });

    return html || '<div class="ai-compare-empty">无内容</div>';
}

/**
 * 将建议内容格式化为可编辑文本
 */
function formatSuggestedContent(suggested) {
    if (!suggested) return '';
    const lines = [];
    if (suggested.name) lines.push('用例名称: ' + suggested.name);
    if (suggested.priority) lines.push('优先级: ' + suggested.priority);
    if (suggested.type) lines.push('类型: ' + suggested.type);
    if (suggested.precondition) lines.push('前置条件: ' + suggested.precondition);
    if (suggested.purpose) lines.push('测试目的: ' + suggested.purpose);
    if (suggested.steps) lines.push('测试步骤:\n' + suggested.steps);
    if (suggested.expected) lines.push('预期结果:\n' + suggested.expected);
    return lines.join('\n\n');
}

/**
 * 提交对比模态框中的决策
 */
async function submitCompareDecision() {
    const modal = document.getElementById('aiCompareModal');
    if (!modal) return;

    const reviewTaskId = modal.dataset.reviewTaskId;
    const tempCaseId = modal.dataset.tempCaseId;

    const selectedRadio = document.querySelector('input[name="compareDecision"]:checked');
    if (!selectedRadio) {
        showErrorMessage('请选择决策');
        return;
    }

    let decision = selectedRadio.value;
    let editedContent = null;
    let comment = '';

    if (decision === 'edit_accept') {
        const editTextarea = document.getElementById('aiCompareEditText');
        if (editTextarea && editTextarea.value.trim()) {
            editedContent = editTextarea.value.trim();
        }
        decision = 'modified_accepted';
    }

    const userComment = document.getElementById('aiCompareUserComment');
    if (userComment) {
        comment = userComment.value.trim();
    }

    try {
        const body = {
            review_task_id: reviewTaskId,
            temp_case_id: tempCaseId,
            decision: decision,
            comment: comment
        };
        if (editedContent) {
            body.user_modified_content = editedContent;
        }

        const result = await apiRequest('/ai-review/decide', {
            method: 'POST',
            body: JSON.stringify(body)
        });

        if (result.success) {
            showSuccessMessage('决策已提交');
            closeCompareModal();
            showAIReviewResults(reviewTaskId);
        } else {
            showErrorMessage(result.message || '决策提交失败');
        }
    } catch (e) {
        console.error('[AI Review] submitCompareDecision error:', e);
        showErrorMessage('决策提交失败，请检查网络连接');
    }
}

/**
 * 关闭对比模态框
 */
function closeCompareModal() {
    const modal = document.getElementById('aiCompareModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * 对单条评审结果做出决策
 */
async function decideReviewResult(reviewTaskId, tempCaseId, decision) {
    const decisionLabelMap = {
        accepted: '采纳',
        rejected: '拒绝',
        edit_accept: '编辑后采纳',
        modified_accepted: '编辑后采纳'
    };

    const confirmed = await showConfirmMessage('确定要' + (decisionLabelMap[decision] || decision) + '此评审结果吗？');
    if (!confirmed) return;

    try {
        const result = await apiRequest('/ai-review/decide', {
            method: 'POST',
            body: JSON.stringify({
                review_task_id: reviewTaskId,
                temp_case_id: tempCaseId,
                decision: decision
            })
        });

        if (result.success) {
            showSuccessMessage('决策已提交');
            const item = aiReviewResults.find(function (r) {
                return r.temp_case_id === tempCaseId;
            });
            if (item) {
                item.decision = decision;
                item.human_decision = decision;
            }
            renderStatsCards(aiReviewResults);
            renderResultsTable(aiReviewResults);
            updateAIReviewBatchButtons();
        } else {
            showErrorMessage(result.message || '决策提交失败');
        }
    } catch (e) {
        console.error('[AI Review] decideReviewResult error:', e);
        showErrorMessage('决策提交失败，请检查网络连接');
    }
}

/**
 * 批量决策
 */
async function batchDecide(reviewTaskId, decision) {
    if (aiReviewSelectedIds.size === 0) {
        showErrorMessage('请先选择要操作的评审结果');
        return;
    }

    const decisionLabelMap = {
        accepted: '采纳',
        rejected: '拒绝'
    };

    const confirmed = await showConfirmMessage('确定要批量' + (decisionLabelMap[decision] || decision) + ' ' + aiReviewSelectedIds.size + ' 条评审结果吗？');
    if (!confirmed) return;

    try {
        const result = await apiRequest('/ai-review/batch-decide', {
            method: 'POST',
            body: JSON.stringify({
                review_task_id: reviewTaskId,
                decisions: Array.from(aiReviewSelectedIds).map(function(id) {
                    return { temp_case_id: id, decision: decision };
                })
            })
        });

        if (result.success) {
            showSuccessMessage('批量' + (decisionLabelMap[decision] || decision) + '成功');
            aiReviewSelectedIds.clear();
            // 刷新结果
            showAIReviewResults(reviewTaskId);
        } else {
            showErrorMessage(result.message || '批量操作失败');
        }
    } catch (e) {
        console.error('[AI Review] batchDecide error:', e);
        showErrorMessage('批量操作失败，请检查网络连接');
    }
}

/**
 * 批量合并已采纳的用例
 */
async function batchMerge(reviewTaskId) {
    if (!reviewTaskId) {
        showErrorMessage('请先选择评审任务');
        return;
    }

    // 统计已采纳数量
    const acceptedCount = aiReviewResults.filter(function (r) {
        return (r.decision || r.human_decision) === 'accepted' || (r.decision || r.human_decision) === 'edit_accept';
    }).length;

    if (acceptedCount === 0) {
        showErrorMessage('没有已采纳的用例可合并');
        return;
    }

    const confirmed = await showConfirmMessage('确定要将 ' + acceptedCount + ' 条已采纳的用例合并进库吗？');
    if (!confirmed) return;

    try {
        const result = await apiRequest('/ai-review/batch-merge', {
            method: 'POST',
            body: JSON.stringify({
                review_task_id: reviewTaskId
            })
        });

        if (result.success) {
            const mergedCount = result.data && (result.data.mergedCount || result.data.merged_count) ? (result.data.mergedCount || result.data.merged_count) : acceptedCount;
            showSuccessMessage('已成功合并 ' + mergedCount + ' 条用例进库');
            // 刷新结果
            showAIReviewResults(reviewTaskId);
        } else {
            showErrorMessage(result.message || '合并进库失败');
        }
    } catch (e) {
        console.error('[AI Review] batchMerge error:', e);
        showErrorMessage('合并进库失败，请检查网络连接');
    }
}

/**
 * 轮询任务状态
 */
function pollTaskStatus(reviewTaskId) {
    stopPolling();

    aiReviewPollingTimer = setInterval(async function () {
        try {
            const result = await apiRequest('/ai-review/task/' + reviewTaskId, { method: 'GET', useCache: false });
            if (result.success) {
                const task = result.data || {};
                updatePollingUI(task);

                if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'needs_human') {
                    stopPolling();
                    if (task.status === 'completed') {
                        showSuccessMessage('AI评审任务已完成');
                        showAIReviewResults(reviewTaskId);
                    } else if (task.status === 'failed') {
                        showErrorMessage('AI评审任务失败: ' + (task.error_message || task.errorMessage || '未知错误'));
                    } else if (task.status === 'needs_human') {
                        if (typeof showSuccessMessage === 'function') showSuccessMessage('AI评审任务需要人工介入');
                        showAIReviewResults(reviewTaskId);
                    }
                }
            }
        } catch (e) {
            console.error('[AI Review] pollTaskStatus error:', e);
        }
    }, 5000);
}

/**
 * 停止轮询
 */
function stopPolling() {
    if (aiReviewPollingTimer) {
        clearInterval(aiReviewPollingTimer);
        aiReviewPollingTimer = null;
    }
}

/**
 * 更新轮询UI
 */
function updatePollingUI(task) {
    const progress = task.progress || 0;
    const progressFill = document.querySelector('.ai-review-task-card[data-task-id="' + CSS.escape(task.review_task_id || '') + '"] .ai-review-progress-fill');
    const progressText = document.querySelector('.ai-review-task-card[data-task-id="' + CSS.escape(task.review_task_id || '') + '"] .ai-review-progress-text');

    if (progressFill) {
        progressFill.style.width = progress + '%';
    }
    if (progressText) {
        progressText.textContent = progress + '%';
    }
}

/**
 * 更新复选框状态
 */
function updateAIReviewCheckboxes() {
    const checkboxes = document.querySelectorAll('.ai-review-row-checkbox');
    checkboxes.forEach(function (cb) {
        cb.checked = aiReviewSelectedIds.has(cb.dataset.tempCaseId);
    });
    updateAIReviewSelectAllState();
}

/**
 * 更新全选复选框状态
 */
function updateAIReviewSelectAllState() {
    const selectAllCb = document.getElementById('ai-review-select-all');
    if (!selectAllCb) return;

    if (aiReviewResults.length === 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
        return;
    }

    const allChecked = aiReviewResults.every(function (r) {
        return aiReviewSelectedIds.has(r.temp_case_id);
    });
    const someChecked = aiReviewResults.some(function (r) {
        return aiReviewSelectedIds.has(r.temp_case_id);
    });

    selectAllCb.checked = allChecked;
    selectAllCb.indeterminate = someChecked && !allChecked;
}

/**
 * 更新批量操作按钮状态
 */
function updateAIReviewBatchButtons() {
    const count = aiReviewSelectedIds.size;
    const batchApproveBtn = document.getElementById('ai-review-batch-accept-btn');
    const batchRejectBtn = document.getElementById('ai-review-batch-reject-btn');

    if (batchApproveBtn) {
        batchApproveBtn.disabled = count === 0;
        batchApproveBtn.textContent = '批量采纳' + (count > 0 ? ' (' + count + ')' : '');
    }
    if (batchRejectBtn) {
        batchRejectBtn.disabled = count === 0;
        batchRejectBtn.textContent = '批量拒绝' + (count > 0 ? ' (' + count + ')' : '');
    }
}

/**
 * 加载AI子代理列表
 */
async function loadAISubAgents() {
    try {
        const result = await apiRequest('/ai-sub-agents/list', { method: 'GET', useCache: true });
        if (result.success) {
            aiReviewAgents = result.data || [];
            populateAgentDropdown();
        }
    } catch (e) {
        console.error('[AI Review] loadAISubAgents error:', e);
    }
}

/**
 * 填充Agent下拉框
 */
function populateAgentDropdown() {
    const select = document.getElementById('ai-review-agent-select');
    if (!select) return;

    select.innerHTML = '<option value="">默认Agent</option>';
    aiReviewAgents.forEach(function (agent) {
        const option = document.createElement('option');
        option.value = agent.id || agent.agent_id || '';
        option.textContent = escapeHtml(agent.displayName || agent.display_name || agent.name || 'Unknown Agent');
        select.appendChild(option);
    });
}

/**
 * 更新Agent信息卡片
 */
function updateAgentInfoCard(agentId) {
    const infoCard = document.getElementById('ai-review-agent-info');
    if (!infoCard) return;

    if (!agentId) {
        infoCard.innerHTML = '<div class="ai-review-agent-info-default">使用默认Agent进行评审</div>';
        return;
    }

    const agent = aiReviewAgents.find(function (a) {
        return String(a.id || a.agent_id) === String(agentId);
    });

    if (agent) {
        infoCard.innerHTML =
            '<div class="ai-review-agent-info">' +
                '<div class="ai-review-agent-name">' + escapeHtml(agent.displayName || agent.display_name || agent.name || '') + '</div>' +
                '<div class="ai-review-agent-desc">' + escapeHtml(agent.description || '无描述') + '</div>' +
                (agent.capabilities || agent.category ? '<div class="ai-review-agent-capabilities">' + escapeHtml(agent.capabilities || agent.category || '') + '</div>' : '') +
            '</div>';
    } else {
        infoCard.innerHTML = '<div class="ai-review-agent-info-default">未找到该Agent信息</div>';
    }
}

/**
 * 获取提交评审对话框中的AI评审配置
 * 供外部提交评审时调用
 */
function getAIReviewConfig() {
    const enableCb = document.getElementById('enableAIReviewCheckbox');
    if (!enableCb || !enableCb.checked) {
        return null;
    }

    const agentSelect = document.getElementById('ai-review-agent-select');
    const autoApproveScore = document.getElementById('ai-review-auto-score');
    const concurrency = document.getElementById('ai-review-concurrency');

    return {
        enableAIReview: true,
        agentId: agentSelect ? agentSelect.value : '',
        autoApproveScore: autoApproveScore ? parseFloat(autoApproveScore.value) : 0,
        concurrency: concurrency ? parseInt(concurrency.value) || 1 : 1
    };
}

/**
 * 提交AI评审任务
 * 供外部提交评审时调用
 */
async function submitAIReview(taskData) {
    const aiConfig = getAIReviewConfig();
    if (!aiConfig) return null;

    const payload = {
        task_id: taskData.task_id || taskData.taskId,
        agent_id: aiConfig.agentId,
        auto_approve_score: aiConfig.autoApproveScore,
        concurrency: aiConfig.concurrency,
        library_id: taskData.library_id || taskData.libraryId,
        module_id: taskData.module_id || taskData.moduleId
    };

    try {
        const result = await apiRequest('/ai-review/submit', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (result.success) {
            showSuccessMessage('AI评审任务已提交');
            return result.data;
        } else {
            showErrorMessage(result.message || 'AI评审任务提交失败');
            return null;
        }
    } catch (e) {
        console.error('[AI Review] submitAIReview error:', e);
        showErrorMessage('AI评审任务提交失败，请检查网络连接');
        return null;
    }
}

/**
 * XSS防护 - 转义HTML
 */
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML.replace(/'/g, '&#039;').replace(/"/g, '&quot;');
}

function aiReviewFormatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return year + '/' + month + '/' + day + ' ' + hours + ':' + minutes;
    } catch (e) {
        return '-';
    }
}

/**
 * 防抖函数
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction() {
        const args = arguments;
        const later = function () {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

    window.initAIReview = initAIReview;
    window.loadAIReviewTasks = loadAIReviewTasks;
    window.showAIReviewResults = showAIReviewResults;
    window.openCompareModal = openCompareModal;
    window.decideReviewResult = decideReviewResult;
    window.batchDecide = batchDecide;
    window.batchMerge = batchMerge;
})();
