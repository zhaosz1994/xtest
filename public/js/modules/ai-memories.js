/**
 * AI Memories Module - 记忆管理台
 * Provides tree view, content editing, distillation, and stats for AI agent memories
 */

let aiMemoriesInitialized = false;
let aiMemoriesCurrentAgentId = null;
let aiMemoriesCurrentNode = null; // { agentId, libraryId, moduleId, level }
let aiMemoriesIsEditing = false;
let aiMemoriesOriginalContent = '';

/* ------------------------------------------------------------------ */
/*  Initialization                                                    */
/* ------------------------------------------------------------------ */

function aimemInjectStyles() {
    if (document.getElementById('aimem-styles')) return;
    const style = document.createElement('style');
    style.id = 'aimem-styles';
    style.textContent = `
        .aimem-tree { font-size: 13px; }
        .aimem-tree-node { margin-bottom: 2px; }
        .aimem-tree-node-content { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
        .aimem-tree-node-content:hover { background: #e8f0fe; }
        .aimem-tree-node-content.aimem-tree-active { background: #d2e3fc; font-weight: 600; }
        .aimem-tree-icon { font-size: 16px; flex-shrink: 0; }
        .aimem-tree-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .aimem-tree-badge { font-size: 11px; color: #909399; white-space: nowrap; }
        .aimem-tree-prefix { color: #909399; margin-right: 2px; }
        .aimem-tree-children { margin-left: 20px; border-left: 1px dashed #dcdfe6; padding-left: 4px; }
        .aimem-tree-loading, .aimem-tree-empty, .aimem-tree-error { text-align: center; padding: 24px 0; color: #909399; font-size: 13px; }
        .aimem-tree-error { color: #ef4444; }
        .aimem-content-loading, .aimem-content-empty, .aimem-content-error { text-align: center; padding: 24px 0; color: #909399; font-size: 13px; }
        .aimem-content-error { color: #ef4444; }
        .aimem-content-view { font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
        .aimem-content-view pre { background: #f5f7fa; padding: 10px; border-radius: 6px; overflow-x: auto; }
        .aimem-content-view code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
        .aimem-content-edit { height: 100%; }
        .aimem-textarea { width: 100%; min-height: 300px; border: 1px solid #dcdfe6; border-radius: 6px; padding: 10px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.6; resize: vertical; }
        .aimem-textarea:focus { outline: none; border-color: #4f46e5; }
        .aimem-stat-item { margin-right: 16px; }
        .aimem-stat-warn { color: #e6a23c; font-weight: 600; }
        .aimem-stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .aimem-stats-card { background: #fff; border: 1px solid #e4e7ed; border-radius: 8px; padding: 12px; text-align: center; }
        .aimem-stats-card-label { font-size: 12px; color: #909399; margin-bottom: 4px; }
        .aimem-stats-card-value { font-size: 14px; font-weight: 600; color: #303133; }
        .aimem-stats-total { background: #f0f9ff; border-color: #93c5fd; }
        .aimem-stats-footer { margin-top: 8px; font-size: 12px; color: #909399; text-align: center; }
        .aimem-stats-empty, .aimem-stats-error { text-align: center; padding: 12px; color: #909399; font-size: 13px; }
        .aimem-content-placeholder { text-align: center; padding: 40px 0; color: #909399; font-size: 13px; }
    `;
    document.head.appendChild(style);
}

function initAIMemoriesConfig() {
    if (aiMemoriesInitialized) return;
    aiMemoriesInitialized = true;
    console.log('[AI Memories] Initializing...');

    aimemInjectStyles();

    const idMap = {
        'memory-agent-select': 'aimem-agent-select',
        'memory-main-container': 'aimem-main-container',
        'memory-tree-panel': 'aimem-tree-container',
        'memory-content-panel': 'aimem-content-area',
        'memory-stats-bar': 'aimem-content-stats',
        'reset-all-memories-btn': 'aimem-btn-reset-all'
    };
    for (const [oldId, newId] of Object.entries(idMap)) {
        const el = document.getElementById(oldId);
        if (el && !document.getElementById(newId)) {
            el.id = newId;
        }
    }

    // Agent dropdown change
    const agentSelect = document.getElementById('aimem-agent-select');
    if (agentSelect) {
        agentSelect.addEventListener('change', function () {
            const agentId = this.value;
            const mainContainer = document.getElementById('aimem-main-container');
            if (agentId) {
                aiMemoriesCurrentAgentId = agentId;
                if (mainContainer) mainContainer.style.display = '';
                loadMemoryTree(agentId);
                loadMemoryStats(agentId);
            } else {
                aiMemoriesCurrentAgentId = null;
                if (mainContainer) mainContainer.style.display = 'none';
                clearMemoryPanel();
            }
        });
    }

    // Edit button
    const btnEdit = document.getElementById('aimem-btn-edit');
    if (btnEdit) {
        btnEdit.addEventListener('click', editMemory);
    }

    // Save button
    const btnSave = document.getElementById('aimem-btn-save');
    if (btnSave) {
        btnSave.addEventListener('click', saveMemory);
    }

    // Cancel edit button
    const btnCancel = document.getElementById('aimem-btn-cancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', cancelEdit);
    }

    // Distill button
    const btnDistill = document.getElementById('aimem-btn-distill');
    if (btnDistill) {
        btnDistill.addEventListener('click', function () {
            if (!aiMemoriesCurrentNode) {
                showErrorMessage('请先选择一个记忆节点');
                return;
            }
            distillMemory(aiMemoriesCurrentNode.agentId, aiMemoriesCurrentNode.libraryId, aiMemoriesCurrentNode.moduleId);
        });
    }

    // Clear node button
    const btnClear = document.getElementById('aimem-btn-clear');
    if (btnClear) {
        btnClear.addEventListener('click', function () {
            if (!aiMemoriesCurrentNode) {
                showErrorMessage('请先选择一个记忆节点');
                return;
            }
            clearMemory(aiMemoriesCurrentNode.agentId, aiMemoriesCurrentNode.libraryId, aiMemoriesCurrentNode.moduleId);
        });
    }

    // Reset all button (admin only)
    const btnResetAll = document.getElementById('aimem-btn-reset-all');
    if (btnResetAll) {
        btnResetAll.addEventListener('click', function () {
            if (!aiMemoriesCurrentAgentId) {
                showErrorMessage('请先选择一个代理');
                return;
            }
            resetAllMemories(aiMemoriesCurrentAgentId);
        });
    }

    // Refresh button
    const btnRefresh = document.getElementById('aimem-btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', function () {
            if (aiMemoriesCurrentAgentId) {
                loadMemoryTree(aiMemoriesCurrentAgentId);
                loadMemoryStats(aiMemoriesCurrentAgentId);
                if (aiMemoriesCurrentNode) {
                    selectMemoryNode(aiMemoriesCurrentNode.agentId, aiMemoriesCurrentNode.libraryId, aiMemoriesCurrentNode.moduleId);
                }
            }
        });
    }

    // Apply admin visibility
    applyAdminControls();
}

/* ------------------------------------------------------------------ */
/*  Agent Dropdown                                                    */
/* ------------------------------------------------------------------ */

async function loadAgentDropdown() {
    const select = document.getElementById('aimem-agent-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- 请选择代理 --</option>';

    try {
        const result = await apiRequest('/ai-sub-agents/list', { method: 'GET' });

        if (result.success && result.data) {
            const agents = result.data;
            if (agents.length === 0) {
                select.innerHTML = '<option value="">暂无可用代理</option>';
                return;
            }

            agents.forEach(agent => {
                const opt = document.createElement('option');
                opt.value = agent.id;
                opt.textContent = agent.displayName + (agent.isSystem ? ' (系统)' : '');
                opt.dataset.agentCode = agent.agentCode || '';
                opt.dataset.memoryEnabled = agent.memoryEnabled ? '1' : '0';
                opt.dataset.distillThreshold = agent.memoryDistillThreshold || 2000;
                select.appendChild(opt);
            });

            // Auto-select first agent
            if (agents.length > 0) {
                select.value = agents[0].id;
                aiMemoriesCurrentAgentId = agents[0].id;
                const mainContainer = document.getElementById('aimem-main-container');
                if (mainContainer) mainContainer.style.display = '';
                loadMemoryTree(agents[0].id);
                loadMemoryStats(agents[0].id);
            }
        } else {
            select.innerHTML = '<option value="">加载失败</option>';
            showErrorMessage(result.message || '获取代理列表失败');
        }
    } catch (error) {
        console.error('[AI Memories] 加载代理列表失败:', error);
        select.innerHTML = '<option value="">加载失败</option>';
        showErrorMessage('获取代理列表失败');
    }
}

/* ------------------------------------------------------------------ */
/*  Memory Tree                                                       */
/* ------------------------------------------------------------------ */

async function loadMemoryTree(agentId) {
    const treeContainer = document.getElementById('aimem-tree-container');
    if (!treeContainer) return;

    treeContainer.innerHTML = '<div class="aimem-tree-loading">加载中...</div>';

    try {
        const result = await apiRequest('/ai-memories/tree/' + agentId, { method: 'GET', useCache: false });

        if (result.success && result.data) {
            renderMemoryTree(result.data);
        } else {
            treeContainer.innerHTML = '<div class="aimem-tree-empty">暂无记忆数据</div>';
        }
    } catch (error) {
        console.error('[AI Memories] 加载记忆树失败:', error);
        treeContainer.innerHTML = '<div class="aimem-tree-error">加载失败，请重试</div>';
    }
}

function renderMemoryTree(data) {
    const treeContainer = document.getElementById('aimem-tree-container');
    if (!treeContainer) return;

    const globalNodes = data.global || [];
    const libraries = data.libraries || [];

    if (globalNodes.length === 0 && libraries.length === 0) {
        treeContainer.innerHTML = '<div class="aimem-tree-empty">暂无记忆数据</div>';
        return;
    }

    let html = '<div class="aimem-tree">';

    // Global nodes
    if (globalNodes.length > 0) {
        const totalRules = countRules(globalNodes);
        const totalChars = globalNodes.reduce((sum, n) => sum + (n.charCount || 0), 0);
        html += `<div class="aimem-tree-node aimem-tree-global" data-agent-id="${escapeHtml(aiMemoriesCurrentAgentId)}" data-level="global">`;
        html += `<div class="aimem-tree-node-content">`;
        html += `<span class="aimem-tree-icon">&#127760;</span>`;
        html += `<span class="aimem-tree-label">全局基础记忆</span>`;
        html += `<span class="aimem-tree-badge">${totalRules}条规则, ${totalChars}字</span>`;
        html += `</div>`;
        html += `</div>`;
    }

    // Libraries
    if (libraries.length > 0) {
        libraries.forEach(lib => {
            const libModules = lib.modules || [];
            const libCharCount = lib.charCount || 0;
            const moduleCount = libModules.length;

            html += `<div class="aimem-tree-node aimem-tree-library">`;
            html += `<div class="aimem-tree-node-content" data-agent-id="${escapeHtml(aiMemoriesCurrentAgentId)}" data-library-id="${escapeHtml(String(lib.libraryId))}" data-level="library">`;
            html += `<span class="aimem-tree-icon">&#128193;</span>`;
            html += `<span class="aimem-tree-label">${escapeHtml(lib.libraryName)}</span>`;
            if (libCharCount > 0) {
                html += `<span class="aimem-tree-badge">${libCharCount}字</span>`;
            }
            html += `</div>`;

            // Modules under this library
            if (libModules.length > 0) {
                html += `<div class="aimem-tree-children">`;
                libModules.forEach((mod, idx) => {
                    const isLast = idx === libModules.length - 1;
                    const prefix = isLast ? '&#9492;&#9472;&#9472;' : '&#9500;&#9472;&#9472;';
                    html += `<div class="aimem-tree-node aimem-tree-module">`;
                    html += `<div class="aimem-tree-node-content" data-agent-id="${escapeHtml(aiMemoriesCurrentAgentId)}" data-library-id="${escapeHtml(String(lib.libraryId))}" data-module-id="${escapeHtml(String(mod.moduleId))}" data-level="module">`;
                    html += `<span class="aimem-tree-prefix">${prefix}</span>`;
                    html += `<span class="aimem-tree-label">${escapeHtml(mod.moduleName)}</span>`;
                    html += `<span class="aimem-tree-badge">${mod.charCount || 0}字</span>`;
                    html += `</div>`;
                    html += `</div>`;
                });
                html += `</div>`;
            }

            html += `</div>`;
        });
    }

    html += '</div>';
    treeContainer.innerHTML = html;

    // Bind click events on tree nodes
    bindTreeNodeEvents();
}

function bindTreeNodeEvents() {
    const treeContainer = document.getElementById('aimem-tree-container');
    if (!treeContainer) return;

    const nodeContents = treeContainer.querySelectorAll('.aimem-tree-node-content');
    nodeContents.forEach(nodeEl => {
        nodeEl.addEventListener('click', function () {
            const agentId = this.dataset.agentId;
            const libraryId = this.dataset.libraryId || '';
            const moduleId = this.dataset.moduleId || '';
            const level = this.dataset.level;

            // Highlight active node
            treeContainer.querySelectorAll('.aimem-tree-node-content').forEach(el => el.classList.remove('aimem-tree-active'));
            this.classList.add('aimem-tree-active');

            selectMemoryNode(agentId, libraryId ? parseInt(libraryId) : null, moduleId ? parseInt(moduleId) : null);
        });
    });
}

function countRules(nodes) {
    if (!nodes || nodes.length === 0) return 0;
    let count = 0;
    nodes.forEach(n => {
        if (n.content) {
            // Count non-empty lines as rules
            const lines = n.content.split('\n').filter(line => line.trim().length > 0);
            count += lines.length;
        }
    });
    return count;
}

/* ------------------------------------------------------------------ */
/*  Select Memory Node & Load Detail                                  */
/* ------------------------------------------------------------------ */

async function selectMemoryNode(agentId, libraryId, moduleId) {
    // Exit edit mode if active
    if (aiMemoriesIsEditing) {
        cancelEdit();
    }

    aiMemoriesCurrentNode = { agentId, libraryId, moduleId };

    const contentArea = document.getElementById('aimem-content-area');
    const statsBar = document.getElementById('aimem-content-stats');
    const actionBar = document.getElementById('aimem-content-actions');

    if (!contentArea) return;

    contentArea.innerHTML = '<div class="aimem-content-loading">加载中...</div>';

    // Build query params
    let queryParams = 'agent_id=' + agentId;
    if (libraryId) queryParams += '&library_id=' + libraryId;
    if (moduleId) queryParams += '&module_id=' + moduleId;

    try {
        const result = await apiRequest('/ai-memories/detail?' + queryParams, { method: 'GET', useCache: false });

        if (result.success && result.data) {
            const detail = result.data;
            renderMemoryDetail(detail);
        } else {
            contentArea.innerHTML = '<div class="aimem-content-empty">该节点暂无记忆内容</div>';
            if (statsBar) statsBar.innerHTML = '';
            if (actionBar) actionBar.style.display = 'none';
        }
    } catch (error) {
        console.error('[AI Memories] 加载记忆详情失败:', error);
        contentArea.innerHTML = '<div class="aimem-content-error">加载失败，请重试</div>';
    }
}

function renderMemoryDetail(detail) {
    const contentArea = document.getElementById('aimem-content-area');
    const statsBar = document.getElementById('aimem-content-stats');
    const actionBar = document.getElementById('aimem-content-actions');
    const levelLabel = document.getElementById('aimem-content-level');

    if (!contentArea) return;

    const content = detail.content || '';
    const charCount = detail.charCount || 0;
    const lastDistilledAt = detail.lastDistilledAt;
    const level = detail.level || 'global';

    // Level label
    const levelNames = { global: '全局基础记忆', library: '用例库记忆', module: '模块记忆' };
    if (levelLabel) {
        levelLabel.textContent = levelNames[level] || level;
    }

    // Render content as markdown-like display
    if (content) {
        contentArea.innerHTML = `<div class="aimem-content-view">${renderMarkdownContent(content)}</div>`;
    } else {
        contentArea.innerHTML = '<div class="aimem-content-empty">该节点暂无记忆内容</div>';
    }

    // Stats bar
    if (statsBar) {
        let statsHtml = `<span class="aimem-stat-item">字符数: <strong>${charCount}</strong></span>`;

        // Get distill threshold from selected agent
        const agentSelect = document.getElementById('aimem-agent-select');
        const selectedOption = agentSelect ? agentSelect.options[agentSelect.selectedIndex] : null;
        const threshold = selectedOption ? parseInt(selectedOption.dataset.distillThreshold) || 2000 : 2000;
        statsHtml += `<span class="aimem-stat-item">蒸馏阈值: <strong>${threshold}</strong></span>`;

        if (charCount > threshold) {
            statsHtml += `<span class="aimem-stat-warn">已超过阈值，建议蒸馏</span>`;
        }

        if (lastDistilledAt) {
            statsHtml += `<span class="aimem-stat-item">上次蒸馏: ${formatDateTime(lastDistilledAt)}</span>`;
        }

        statsBar.innerHTML = statsHtml;
    }

    // Show action bar
    if (actionBar) {
        actionBar.style.display = 'flex';
        // Show/hide distill button based on admin status
        const btnDistill = document.getElementById('aimem-btn-distill');
        if (btnDistill) {
            btnDistill.style.display = hasAdminRole() ? 'inline-flex' : 'none';
        }
    }

    // Store original content for edit/cancel
    aiMemoriesOriginalContent = content;
    aiMemoriesIsEditing = false;
}

function renderMarkdownContent(text) {
    if (!text) return '';
    // Simple markdown rendering for display
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // List items
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
}

/* ------------------------------------------------------------------ */
/*  Edit & Save Memory                                                */
/* ------------------------------------------------------------------ */

function editMemory() {
    if (!aiMemoriesCurrentNode) {
        showErrorMessage('请先选择一个记忆节点');
        return;
    }

    const contentArea = document.getElementById('aimem-content-area');
    if (!contentArea) return;

    aiMemoriesIsEditing = true;

    const currentContent = aiMemoriesOriginalContent || '';
    contentArea.innerHTML = `
        <div class="aimem-content-edit">
            <textarea id="aimem-edit-textarea" class="aimem-textarea" placeholder="输入记忆内容（支持Markdown格式）...">${escapeHtml(currentContent)}</textarea>
        </div>
    `;

    // Show save/cancel, hide edit
    const btnEdit = document.getElementById('aimem-btn-edit');
    const btnSave = document.getElementById('aimem-btn-save');
    const btnCancel = document.getElementById('aimem-btn-cancel');
    if (btnEdit) btnEdit.style.display = 'none';
    if (btnSave) btnSave.style.display = 'inline-flex';
    if (btnCancel) btnCancel.style.display = 'inline-flex';

    // Focus textarea
    const textarea = document.getElementById('aimem-edit-textarea');
    if (textarea) {
        textarea.focus();
        // Auto-resize
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(300, textarea.scrollHeight) + 'px';
        textarea.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.max(300, this.scrollHeight) + 'px';
        });
    }
}

function cancelEdit() {
    aiMemoriesIsEditing = false;

    // Re-render original content
    if (aiMemoriesCurrentNode) {
        renderMemoryDetail({
            content: aiMemoriesOriginalContent,
            charCount: aiMemoriesOriginalContent ? aiMemoriesOriginalContent.length : 0,
            lastDistilledAt: null,
            level: aiMemoriesCurrentNode.level || 'global'
        });
    }

    // Show edit, hide save/cancel
    const btnEdit = document.getElementById('aimem-btn-edit');
    const btnSave = document.getElementById('aimem-btn-save');
    const btnCancel = document.getElementById('aimem-btn-cancel');
    if (btnEdit) btnEdit.style.display = 'inline-flex';
    if (btnSave) btnSave.style.display = 'none';
    if (btnCancel) btnCancel.style.display = 'none';
}

async function saveMemory() {
    if (!aiMemoriesCurrentNode) {
        showErrorMessage('请先选择一个记忆节点');
        return;
    }

    const textarea = document.getElementById('aimem-edit-textarea');
    if (!textarea) return;

    const newContent = textarea.value.trim();

    const requestBody = {
        agent_id: parseInt(aiMemoriesCurrentNode.agentId),
        content: newContent
    };

    if (aiMemoriesCurrentNode.libraryId) {
        requestBody.library_id = aiMemoriesCurrentNode.libraryId;
    }
    if (aiMemoriesCurrentNode.moduleId) {
        requestBody.module_id = aiMemoriesCurrentNode.moduleId;
    }

    try {
        const result = await apiRequest('/ai-memories/update', {
            method: 'PUT',
            body: JSON.stringify(requestBody)
        });

        if (result.success) {
            showSuccessMessage('记忆更新成功');
            aiMemoriesOriginalContent = newContent;
            aiMemoriesIsEditing = false;

            // Refresh tree and detail
            loadMemoryTree(aiMemoriesCurrentAgentId);
            loadMemoryStats(aiMemoriesCurrentAgentId);
            selectMemoryNode(aiMemoriesCurrentNode.agentId, aiMemoriesCurrentNode.libraryId, aiMemoriesCurrentNode.moduleId);

            // Show edit, hide save/cancel
            const btnEdit = document.getElementById('aimem-btn-edit');
            const btnSave = document.getElementById('aimem-btn-save');
            const btnCancel = document.getElementById('aimem-btn-cancel');
            if (btnEdit) btnEdit.style.display = 'inline-flex';
            if (btnSave) btnSave.style.display = 'none';
            if (btnCancel) btnCancel.style.display = 'none';
        } else {
            showErrorMessage(result.message || '记忆更新失败');
        }
    } catch (error) {
        console.error('[AI Memories] 保存记忆失败:', error);
        showErrorMessage('记忆更新失败，请重试');
    }
}

/* ------------------------------------------------------------------ */
/*  Distill Memory (Admin Only)                                       */
/* ------------------------------------------------------------------ */

async function distillMemory(agentId, libraryId, moduleId) {
    if (!hasAdminRole()) {
        showErrorMessage('仅管理员可执行蒸馏操作');
        return;
    }

    const confirmed = await showConfirmMessage(
        '确定要对当前记忆节点执行蒸馏操作吗？蒸馏将通过AI压缩记忆内容，此操作不可撤销。'
    );
    if (!confirmed) return;

    const requestBody = {
        agent_id: parseInt(agentId)
    };
    if (libraryId) requestBody.library_id = libraryId;
    if (moduleId) requestBody.module_id = moduleId;

    try {
        if (typeof showLoading === 'function') showLoading('正在蒸馏记忆，请稍候...');

        const result = await apiRequest('/ai-memories/distill', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });

        if (typeof hideLoading === 'function') hideLoading();

        if (result.success) {
            showSuccessMessage('记忆蒸馏完成');
            // Refresh tree and detail
            loadMemoryTree(aiMemoriesCurrentAgentId);
            loadMemoryStats(aiMemoriesCurrentAgentId);
            if (aiMemoriesCurrentNode) {
                selectMemoryNode(aiMemoriesCurrentNode.agentId, aiMemoriesCurrentNode.libraryId, aiMemoriesCurrentNode.moduleId);
            }
        } else {
            showErrorMessage(result.message || '记忆蒸馏失败');
        }
    } catch (error) {
        if (typeof hideLoading === 'function') hideLoading();
        console.error('[AI Memories] 蒸馏记忆失败:', error);
        showErrorMessage('记忆蒸馏失败，请重试');
    }
}

async function clearMemory(agentId, libraryId, moduleId) {
    const confirmed = await showConfirmMessage(
        '确定要清空当前节点的记忆内容吗？此操作不可撤销。'
    );
    if (!confirmed) return;

    const requestBody = {
        agent_id: parseInt(agentId),
        content: ''
    };
    if (libraryId) requestBody.library_id = libraryId;
    if (moduleId) requestBody.module_id = moduleId;

    try {
        const result = await apiRequest('/ai-memories/update', {
            method: 'PUT',
            body: JSON.stringify(requestBody)
        });

        if (result.success) {
            showSuccessMessage('记忆已清空');
            aiMemoriesOriginalContent = '';

            loadMemoryTree(aiMemoriesCurrentAgentId);
            loadMemoryStats(aiMemoriesCurrentAgentId);
            if (aiMemoriesCurrentNode) {
                selectMemoryNode(aiMemoriesCurrentNode.agentId, aiMemoriesCurrentNode.libraryId, aiMemoriesCurrentNode.moduleId);
            }
        } else {
            showErrorMessage(result.message || '清空记忆失败');
        }
    } catch (error) {
        console.error('[AI Memories] 清空记忆失败:', error);
        showErrorMessage('清空记忆失败，请重试');
    }
}

async function resetAllMemories(agentId) {
    if (!hasAdminRole()) {
        showErrorMessage('仅管理员可执行重置操作');
        return;
    }

    const confirmed1 = await showConfirmMessage(
        '此操作将重置该代理的全部记忆（包括全局、用例库和模块级别），所有记忆数据将被永久删除！\n\n确定要继续吗？'
    );
    if (!confirmed1) return;

    const confirmed2 = await showConfirmMessage(
        '二次确认：这是不可逆操作，重置后所有记忆将无法恢复！\n\n请再次确认是否重置全部记忆？'
    );
    if (!confirmed2) return;

    try {
        if (typeof showLoading === 'function') showLoading('正在重置全部记忆...');

        const result = await apiRequest('/ai-memories/reset/' + agentId, {
            method: 'POST',
            body: JSON.stringify({ confirm: true })
        });

        if (typeof hideLoading === 'function') hideLoading();

        if (result.success) {
            showSuccessMessage('全部记忆已重置');
            aiMemoriesCurrentNode = null;
            aiMemoriesOriginalContent = '';

            // Refresh all
            loadMemoryTree(aiMemoriesCurrentAgentId);
            loadMemoryStats(aiMemoriesCurrentAgentId);
            clearContentPanel();
        } else {
            showErrorMessage(result.message || '重置记忆失败');
        }
    } catch (error) {
        if (typeof hideLoading === 'function') hideLoading();
        console.error('[AI Memories] 重置记忆失败:', error);
        showErrorMessage('重置记忆失败，请重试');
    }
}

/* ------------------------------------------------------------------ */
/*  Memory Stats                                                      */
/* ------------------------------------------------------------------ */

async function loadMemoryStats(agentId) {
    const statsContainer = document.getElementById('aimem-stats-container');
    if (!statsContainer) return;

    try {
        const result = await apiRequest('/ai-memories/stats/' + agentId, { method: 'GET', useCache: false });

        if (result.success && result.data) {
            renderMemoryStats(result.data);
        } else {
            statsContainer.innerHTML = '<div class="aimem-stats-empty">暂无统计数据</div>';
        }
    } catch (error) {
        console.error('[AI Memories] 加载统计信息失败:', error);
        statsContainer.innerHTML = '<div class="aimem-stats-error">加载统计失败</div>';
    }
}

function renderMemoryStats(stats) {
    const statsContainer = document.getElementById('aimem-stats-container');
    if (!statsContainer) return;

    const global = stats.global || { count: 0, totalChars: 0 };
    const library = stats.library || { count: 0, totalChars: 0 };
    const module = stats.module || { count: 0, totalChars: 0 };
    const totalChars = stats.totalChars || 0;
    const lastDistilledAt = stats.lastDistilledAt;

    let html = '<div class="aimem-stats-grid">';

    html += `<div class="aimem-stats-card">`;
    html += `<div class="aimem-stats-card-label">全局记忆</div>`;
    html += `<div class="aimem-stats-card-value">${global.count} 条 / ${global.totalChars} 字</div>`;
    html += `</div>`;

    html += `<div class="aimem-stats-card">`;
    html += `<div class="aimem-stats-card-label">用例库记忆</div>`;
    html += `<div class="aimem-stats-card-value">${library.count} 条 / ${library.totalChars} 字</div>`;
    html += `</div>`;

    html += `<div class="aimem-stats-card">`;
    html += `<div class="aimem-stats-card-label">模块记忆</div>`;
    html += `<div class="aimem-stats-card-value">${module.count} 条 / ${module.totalChars} 字</div>`;
    html += `</div>`;

    html += `<div class="aimem-stats-card aimem-stats-total">`;
    html += `<div class="aimem-stats-card-label">总计</div>`;
    html += `<div class="aimem-stats-card-value">${totalChars} 字</div>`;
    html += `</div>`;

    html += '</div>';

    if (lastDistilledAt) {
        html += `<div class="aimem-stats-footer">最近蒸馏时间: ${formatDateTime(lastDistilledAt)}</div>`;
    }

    statsContainer.innerHTML = html;
}

/* ------------------------------------------------------------------ */
/*  UI Helpers                                                        */
/* ------------------------------------------------------------------ */

function clearMemoryPanel() {
    const treeContainer = document.getElementById('aimem-tree-container');
    const statsContainer = document.getElementById('aimem-stats-container');
    if (treeContainer) treeContainer.innerHTML = '<div class="aimem-tree-empty">请选择一个代理</div>';
    if (statsContainer) statsContainer.innerHTML = '';
    clearContentPanel();
}

function clearContentPanel() {
    const contentArea = document.getElementById('aimem-content-area');
    const statsBar = document.getElementById('aimem-content-stats');
    const actionBar = document.getElementById('aimem-content-actions');
    const levelLabel = document.getElementById('aimem-content-level');

    if (contentArea) contentArea.innerHTML = '<div class="aimem-content-placeholder">请从左侧选择一个记忆节点</div>';
    if (statsBar) statsBar.innerHTML = '';
    if (actionBar) actionBar.style.display = 'none';
    if (levelLabel) levelLabel.textContent = '';

    aiMemoriesIsEditing = false;
    aiMemoriesCurrentNode = null;
    aiMemoriesOriginalContent = '';

    // Reset button visibility
    const btnEdit = document.getElementById('aimem-btn-edit');
    const btnSave = document.getElementById('aimem-btn-save');
    const btnCancel = document.getElementById('aimem-btn-cancel');
    if (btnEdit) btnEdit.style.display = 'inline-flex';
    if (btnSave) btnSave.style.display = 'none';
    if (btnCancel) btnCancel.style.display = 'none';
}

function hasAdminRole() {
    if (typeof Router !== 'undefined' && typeof Router.isAdmin === 'function') {
        return Router.isAdmin();
    }
    // Fallback: check currentUser directly
    if (typeof currentUser !== 'undefined' && currentUser) {
        const role = currentUser.role;
        return role === '管理员' || role === 'admin' || role === 'Administrator';
    }
    return false;
}

function applyAdminControls() {
    const btnResetAll = document.getElementById('aimem-btn-reset-all');
    const btnDistill = document.getElementById('aimem-btn-distill');

    const isAdmin = hasAdminRole();
    if (btnResetAll) btnResetAll.style.display = isAdmin ? 'inline-flex' : 'none';
    if (btnDistill) btnDistill.style.display = isAdmin ? 'inline-flex' : 'none';
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}/${month}/${day} ${hours}:${minutes}`;
    } catch (e) {
        return dateStr;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.initAIMemoriesConfig = initAIMemoriesConfig;
window.loadAgentDropdown = loadAgentDropdown;
window.loadMemoryTree = loadMemoryTree;
window.selectMemoryNode = selectMemoryNode;
window.distillMemory = distillMemory;
window.clearMemory = clearMemory;
window.resetAllMemories = resetAllMemories;
window.loadMemoryStats = loadMemoryStats;
