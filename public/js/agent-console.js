/**
 * Agent & Knowledge Console 前端逻辑
 * 覆盖设计文档第13章：Agent管理、任务审批、资源Lease、Bug学习、审计日志
 */
class AgentConsolePage {
    constructor() {
        this.token = localStorage.getItem('authToken') || localStorage.getItem('token');
        this.initialized = false;
        this.currentTaskId = null;
        this._workflowLoadToken = 0; // 工作流Tab加载取消令牌
        this._coverageLoadToken = 0; // 覆盖率Tab加载取消令牌
        this.catalog = { target_env: [], mode: [], severity: [], agent_role: [], task_status: [], resource_type: [], risk_level: [], resource_status: [], agent_status: [], task_type: [], bug_status: [] };
        this.modulesList = [];
        this.librariesList = [];
        this.isAdminUser = false;
    }

    async apiRequest(endpoint, options = {}, retryCount = 0) {
        const response = await fetch(endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                ...(options.headers || {})
            }
        });
        // 429 限流：自动重试（指数退避）
        if (response.status === 429 && retryCount < 2) {
            const delay = 800 * Math.pow(2, retryCount); // 800ms, 1600ms
            await new Promise(r => setTimeout(r, delay));
            return this.apiRequest(endpoint, options, retryCount + 1);
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `请求失败 (${response.status})`);
        return data;
    }

    // 统一使用系统内封装的确认弹框 (与 script.js 中 showConfirmModal 同源),
    // 避免出现原生浏览器 confirm() 弹窗与系统风格不一致
    confirmDialog(message) {
        if (typeof window.showConfirmMessage === 'function') {
            return window.showConfirmMessage(message);
        }
        if (typeof window.showConfirmModal === 'function') {
            return new Promise(resolve => window.showConfirmModal(message, resolve));
        }
        return Promise.resolve(confirm(message));
    }

    async init() {
        this.token = localStorage.getItem('authToken') || localStorage.getItem('token');
        // 与 script.js 的 getCurrentUserFull() 一致:优先 localStorage,缺省回退默认管理员(开发环境)
        let user = null;
        try {
            const u = localStorage.getItem('currentUser') || localStorage.getItem('user');
            if (u) user = JSON.parse(u);
        } catch (e) { user = null; }
        if (!user) user = { username: 'admin', role: '管理员' };
        this.isAdminUser = !!(
            user.role === '管理员' ||
            user.role === 'admin' ||
            user.role === 'Administrator'
        );
        this.applyAdminVisibility();
        // 每次进入页面都重新绑定事件(DOM 可能被路由切换重建)
        this.bindEvents();
        if (this.initialized) {
            await this.loadAll();
            return;
        }
        this.initialized = true;
        await this.loadCatalog();
        await this.loadChipVersions();
        await this.loadModulesList();
        await this.loadLibrariesList();
        await this.loadAll();
        // 从 URL query param 恢复上次的页面（刷新后保持当前 Tab）
        const validPages = ['overview', 'tasks', 'pipeline', 'resources', 'tools', 'knowledge', 'cta'];
        const urlParams = new URLSearchParams(window.location.search);
        const savedPage = urlParams.get('acPage');
        const initialPage = validPages.includes(savedPage) ? savedPage : 'overview';
        // init 阶段跳过按需刷新，因为 loadAll 已经加载了所有数据
        this.switchPage(initialPage, { skipReload: true });
    }

    applyAdminVisibility() {
        // 管理类按钮仅管理员可见
        const adminBtns = ['agent-console-config-btn', 'agent-console-tools-btn', 'agent-add-btn', 'resource-add-btn', 'bundle-add-btn'];
        adminBtns.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = this.isAdminUser ? '' : 'none';
        });
    }

    switchPage(pageName, options = {}) {
        if (!pageName) return;
        this.currentPage = pageName;
        const { skipReload = false } = options;
        // 用 URL search param 记忆当前页面，刷新后可恢复（不用 hash 避免和 Router 冲突）
        const url = new URL(window.location.href);
        if (url.searchParams.get('acPage') !== pageName) {
            url.searchParams.set('acPage', pageName);
            history.replaceState(null, '', url.toString());
        }
        // 切换 Tab 高亮
        document.querySelectorAll('.agent-console-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });
        // 切换页面视图
        document.querySelectorAll('.agent-console-page-view').forEach(view => {
            view.classList.toggle('active', view.dataset.page === pageName);
        });
        // 上下文栏（芯片/模块/环境/模式）只在概览和任务中心页面显示
        const contextBar = document.getElementById('agent-console-context-bar');
        if (contextBar) {
            contextBar.style.display = (pageName === 'overview' || pageName === 'tasks') ? '' : 'none';
        }
        // 进入特定页面时按需刷新（跳过 init 阶段的首次切换，因为 loadAll 已加载）
        // 但 CTA 页面必须重新初始化，因为它有独立的渲染逻辑
        if (skipReload && pageName !== 'cta') return;
        if (pageName === 'pipeline') this.loadPipelineBoard?.();
        if (pageName === 'tasks') this.loadTasks?.();
        if (pageName === 'resources') {
            this.loadResources?.();
            this.loadBundles?.();
            this.loadReservations?.();
        }
        if (pageName === 'knowledge') {
            this.loadBugLearning?.();
            this.loadModuleHealth?.(false);
            this.loadDiagrams?.();
        }
        if (pageName === 'cta') {
            this.initCtaV2Page?.();
        }
    }

    // ===== CTA 页面集成 =====

    initCtaV2Page() {
        // 不再创建 WorkflowBoard 实例，改用纯 HTML 渲染（避免 SVG 操作和全局事件监听导致卡顿）
        this._bindCtaV2Events();
        // 加载任务选择下拉框
        this._loadCtaTaskSelect();
        // 加载工作流定义（纯HTML卡片）
        this._loadCtaV2Workflow();
        // 加载SSH会话列表
        this.loadSshSessions?.();
        // 如果有当前任务，加载测试用例、Bug、覆盖率、硬约束
        if (this.currentTaskId) {
            this.loadTestCases?.();
            this.loadTestBugs?.();
            // 加载覆盖率详情
            try {
                if (typeof CoverageDetail !== 'undefined') {
                    this._coverageDetail = this._coverageDetail || new CoverageDetail(this.currentTaskId);
                    this._coverageDetail.taskId = this.currentTaskId;
                    this._coverageDetail.load(this.currentTaskId);
                }
            } catch (e) { console.warn('覆盖率加载失败:', e.message); }
            // 加载硬约束管理
            try {
                if (typeof HardConstraintsManager !== 'undefined') {
                    this._hardConstraints = this._hardConstraints || new HardConstraintsManager(this.currentTaskId);
                    this._hardConstraints.taskId = this.currentTaskId;
                    this._hardConstraints.load(this.currentTaskId);
                }
            } catch (e) { console.warn('硬约束加载失败:', e.message); }
        }
    }

    /**
     * 加载 CTA 页面的任务选择器（可搜索 + 状态筛选的下拉框）
     */
    async _loadCtaTaskSelect() {
        const searchInput = document.getElementById('cta-task-search');
        const dropdown = document.getElementById('cta-task-dropdown');
        const statusFilter = document.getElementById('cta-task-status-filter');
        const currentLabel = document.getElementById('cta-task-current');
        if (!searchInput || !dropdown) return;

        // 缓存任务列表
        if (!this._ctaTaskCache) {
            this._ctaTaskCache = [];
            try {
                const response = await this.apiRequest('/agent-console/tasks?limit=200');
                this._ctaTaskCache = response.data || [];
            } catch (e) {
                this._ctaTaskCache = [];
            }
        }

        // 显示当前选中的任务
        const updateCurrentLabel = () => {
            if (this.currentTaskId) {
                const t = this._ctaTaskCache.find(x => String(x.task_id) === String(this.currentTaskId));
                const name = t ? (t.objective || t.task_id) : this.currentTaskId;
                const status = t ? t.status : '';
                currentLabel.innerHTML = `<span style="font-weight:600;color:#4f46e5;">${this.escapeHtml(name)}</span> <span style="color:#94a3b8;">[${this.escapeHtml(status)}]</span>`;
                searchInput.value = '';
                searchInput.placeholder = '切换任务...';
            } else {
                currentLabel.textContent = '未选择任务';
                searchInput.placeholder = '搜索任务...';
            }
        };
        updateCurrentLabel();

        // 渲染下拉列表
        const renderDropdown = (query = '', status = '') => {
            let filtered = this._ctaTaskCache;
            if (status) {
                filtered = filtered.filter(t => t.status === status);
            }
            if (query) {
                const q = query.toLowerCase();
                filtered = filtered.filter(t =>
                    (t.objective || '').toLowerCase().includes(q) ||
                    (t.task_id || '').toLowerCase().includes(q) ||
                    (t.module_name || '').toLowerCase().includes(q)
                );
            }
            // 最多显示 50 条
            const display = filtered.slice(0, 50);
            const statusColors = {
                running: '#3b82f6', diagnosing: '#f59e0b', completed: '#10b981',
                failed: '#ef4444', draft: '#94a3b8', pending: '#94a3b8'
            };
            if (display.length === 0) {
                dropdown.innerHTML = '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:13px;">无匹配任务</div>';
            } else {
                dropdown.innerHTML = display.map(t => {
                    const sc = statusColors[t.status] || '#94a3b8';
                    const isCurrent = String(t.task_id) === String(this.currentTaskId);
                    // 构建悬浮卡片数据
                    const tooltipData = JSON.stringify({
                        objective: t.objective || '-',
                        taskId: t.task_id,
                        status: t.status,
                        statusColor: sc,
                        mode: t.mode || '-',
                        module: t.module_name || '通用',
                        chip: t.chip_version || '通用',
                        targetEnv: t.target_env || '-',
                        createdAt: this.formatDateTime(t.created_at),
                        approval: t.approval_required ? '需审批(' + (t.approval_status || 'pending') + ')' : '不需要',
                        lease: t.lease_id || null
                    }).replace(/"/g, '&quot;');
                    return `<div class="cta-task-item" data-task-id="${this.escapeHtml(t.task_id)}" data-tooltip='${tooltipData}' style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;${isCurrent ? 'background:#eef2ff;' : ''}" onmouseover="this.style.background='#f5f3ff';" onmouseout="this.style.background='${isCurrent ? '#eef2ff' : '#fff'}';">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:13px;font-weight:600;color:#1e293b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(t.objective || t.task_id)}</span>
                            <span style="font-size:11px;color:${sc};font-weight:600;margin-left:8px;white-space:nowrap;">[${this.escapeHtml(t.status)}]</span>
                        </div>
                        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${this.escapeHtml(t.task_id)} · ${this.escapeHtml(t.module_name || '通用')} · ${this.escapeHtml(t.mode || '')} · ${this.formatDateTime(t.created_at)}</div>
                    </div>`;
                }).join('') + (filtered.length > 50 ? `<div style="padding:8px;text-align:center;color:#94a3b8;font-size:11px;">还有 ${filtered.length - 50} 条，请搜索...</div>` : '');
            }
            // 绑定点击
            dropdown.querySelectorAll('.cta-task-item').forEach(item => {
                item.addEventListener('click', () => {
                    const taskId = item.dataset.taskId;
                    if (taskId) {
                        this.onTaskSelected(taskId);
                        dropdown.style.display = 'none';
                        updateCurrentLabel();
                    }
                });
                // 悬浮显示详细信息卡片
                item.addEventListener('mouseenter', (e) => {
                    this._showTaskHoverCard(item, e);
                });
                item.addEventListener('mouseleave', () => {
                    this._hideTaskHoverCard();
                });
            });
        };

        // 避免重复绑定
        if (searchInput.dataset.bound === '1') return;
        searchInput.dataset.bound = '1';

        // 输入时显示下拉并过滤
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim();
            const status = statusFilter?.value || '';
            renderDropdown(query, status);
            dropdown.style.display = 'block';
        });
        // 聚焦时显示全部
        searchInput.addEventListener('focus', () => {
            renderDropdown(searchInput.value.trim(), statusFilter?.value || '');
            dropdown.style.display = 'block';
        });
        // 状态筛选变化
        statusFilter?.addEventListener('change', () => {
            renderDropdown(searchInput.value.trim(), statusFilter.value);
            dropdown.style.display = 'block';
            searchInput.focus();
        });
        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.cta-task-picker-wrap') && !e.target.closest('#cta-task-status-filter')) {
                dropdown.style.display = 'none';
            }
        });
        // 清除按钮（在搜索框中按 Escape）
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                dropdown.style.display = 'none';
                updateCurrentLabel();
            }
        });
    }

    /**
     * 显示任务悬浮信息卡片
     */
    _showTaskHoverCard(item, event) {
        this._hideTaskHoverCard();
        let data;
        try { data = JSON.parse(item.dataset.tooltip); } catch { return; }
        if (!data) return;

        const card = document.createElement('div');
        card.className = 'cta-task-hover-card';
        card.innerHTML = `
            <div class="cth-header">
                <div class="cth-title">${this.escapeHtml(data.objective)}</div>
                <span class="cth-status" style="color:${data.statusColor};border-color:${data.statusColor};">${this.escapeHtml(data.status)}</span>
            </div>
            <div class="cth-body">
                <div class="cth-row"><span class="cth-label">Task ID</span><span class="cth-value mono">${this.escapeHtml(data.taskId)}</span></div>
                <div class="cth-row"><span class="cth-label">模块</span><span class="cth-value">${this.escapeHtml(data.module)}</span></div>
                <div class="cth-row"><span class="cth-label">芯片代系</span><span class="cth-value">${this.escapeHtml(data.chip)}</span></div>
                <div class="cth-row"><span class="cth-label">目标环境</span><span class="cth-value">${this.escapeHtml(data.targetEnv)}</span></div>
                <div class="cth-row"><span class="cth-label">模式</span><span class="cth-value">${this.escapeHtml(data.mode)}</span></div>
                <div class="cth-row"><span class="cth-label">创建时间</span><span class="cth-value">${this.escapeHtml(data.createdAt)}</span></div>
                <div class="cth-row"><span class="cth-label">审批</span><span class="cth-value">${this.escapeHtml(data.approval)}</span></div>
                ${data.lease ? `<div class="cth-row"><span class="cth-label">租约</span><span class="cth-value mono">${this.escapeHtml(data.lease)}</span></div>` : ''}
            </div>
        `;
        document.body.appendChild(card);

        // 定位
        const rect = item.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        let left = rect.right + 8;
        let top = rect.top;
        // 如果右侧空间不够，放左侧
        if (left + cardRect.width > window.innerWidth - 10) {
            left = rect.left - cardRect.width - 8;
        }
        // 如果下方溢出，上移
        if (top + cardRect.height > window.innerHeight - 10) {
            top = window.innerHeight - cardRect.height - 10;
        }
        card.style.left = left + 'px';
        card.style.top = top + 'px';
        card.style.opacity = '1';
        this._taskHoverCard = card;
    }

    /**
     * 隐藏任务悬浮信息卡片
     */
    _hideTaskHoverCard() {
        if (this._taskHoverCard) {
            this._taskHoverCard.remove();
            this._taskHoverCard = null;
        }
    }

    async _loadCtaV2Workflow() {
        const canvas = document.getElementById('workflow-canvas');
        if (!canvas) return;
        canvas.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">加载工作流定义...</div>';
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const myToken = ++this._workflowLoadToken;
        try {
            const typeSelect = document.getElementById('cta-workflow-type-select');
            const workflowType = typeSelect?.value || 'default';

            // 并行拉取工作流定义和实例（如果有当前任务）
            const fetches = [
                fetch(`/api/workflow/definitions/${encodeURIComponent(workflowType)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json().catch(() => ({ data: null })))
            ];
            if (this.currentTaskId) {
                fetches.push(
                    fetch(`/api/workflow/tasks/${encodeURIComponent(this.currentTaskId)}/workflow`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(r => r.json().catch(() => ({ data: null })))
                );
            }
            const [defRes, instRes] = await Promise.all(fetches);
            if (myToken !== this._workflowLoadToken) return;

            const def = defRes.data;
            const inst = instRes?.data || instRes?.instance || null;
            // 解析定义
            let definition = null;
            if (def) {
                if (def.definition_json) {
                    definition = typeof def.definition_json === 'string' ? JSON.parse(def.definition_json) : def.definition_json;
                } else if (def.nodes) {
                    definition = def;
                }
            }
            // 解析实例状态
            let nodeStates = {};
            let currentNode = null;
            if (inst) {
                try {
                    const ctx = typeof inst.context_json === 'string' ? JSON.parse(inst.context_json) : (inst.context_json || {});
                    if (ctx && ctx.nodeResults) {
                        for (const [nodeId, result] of Object.entries(ctx.nodeResults)) {
                            nodeStates[nodeId] = result.status || 'completed';
                        }
                    }
                    currentNode = (ctx && ctx.currentNode) || null;
                } catch (e) {}
            }
            if (definition && definition.nodes) {
                canvas.innerHTML = this._renderWorkflowHtml(definition, nodeStates, currentNode, inst);
            } else {
                canvas.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">未找到工作流定义</div>';
            }
        } catch (e) {
            if (myToken !== this._workflowLoadToken) return;
            canvas.innerHTML = `<div style="padding:16px;color:#ef4444;">加载失败: ${this.escapeHtml(e.message)}</div>`;
        }
    }

    _bindCtaV2Events() {
        if (this._ctaV2EventsBound) return;
        this._ctaV2EventsBound = true;

        // 工作流刷新
        document.getElementById('cta-workflow-refresh-btn')?.addEventListener('click', () => {
            this._loadCtaV2Workflow();
        });

        // 工作流类型切换
        document.getElementById('cta-workflow-type-select')?.addEventListener('change', () => {
            this._loadCtaV2Workflow();
        });

        // SSH会话刷新
        document.getElementById('cta-ssh-refresh-btn')?.addEventListener('click', () => this.loadSshSessions());
        // SSH会话创建
        document.getElementById('cta-ssh-create-btn')?.addEventListener('click', () => this.showSshSessionForm());
        // 测试用例刷新
        document.getElementById('cta-test-cases-refresh-btn')?.addEventListener('click', () => this.loadTestCases());
        // 测试Bug刷新
        document.getElementById('cta-test-bugs-refresh-btn')?.addEventListener('click', () => this.loadTestBugs());
    }

    // 加载SSH会话列表
    async loadSshSessions() {
        const container = document.getElementById('cta-ssh-sessions-list');
        if (!container) return;
        try {
            const data = await this.apiRequest('/ssh/sessions');
            const sessions = data.data || data.sessions || [];
            if (sessions.length === 0) {
                container.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">点击"新建会话"连接设备</div>';
                return;
            }
            container.innerHTML = sessions.map(s => `
                <div class="agent-console-list-item" style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid #f1f5f9;">
                    <span class="hc-tag hc-tag-${s.status === 'active' ? 'register' : 'state_machine'}">${s.status === 'active' ? '🟢' : '🔴'} ${s.status}</span>
                    <span style="flex:1;font-weight:500;">${s.host}:${s.port} (${s.username})</span>
                    <span style="color:#94a3b8;font-size:12px;">${s.device_type || 'generic'}</span>
                    <button class="agent-console-small-btn" onclick="window.agentConsolePage.closeSshSession('${s.session_id}')">关闭</button>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = `<div style="padding:16px;color:#ef4444;">加载SSH会话失败: ${e.message}</div>`;
        }
    }

    // SSH会话创建表单
    showSshSessionForm() {
        this.openModal?.('新建SSH会话', `
            <div class="agent-console-form-group">
                <label>主机地址</label>
                <input id="ssh-form-host" class="agent-console-input" placeholder="如: 192.168.1.100" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
            </div>
            <div class="agent-console-form-group">
                <label>端口</label>
                <input id="ssh-form-port" class="agent-console-input" type="number" value="22" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
            </div>
            <div class="agent-console-form-group">
                <label>用户名</label>
                <input id="ssh-form-username" class="agent-console-input" placeholder="如: admin" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
            </div>
            <div class="agent-console-form-group">
                <label>密码</label>
                <input id="ssh-form-password" class="agent-console-input" type="password" placeholder="密码" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
            </div>
            <div class="agent-console-form-group">
                <label>设备类型</label>
                <select id="ssh-form-device-type" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
                    <option value="generic">通用</option>
                    <option value="cisco">Cisco</option>
                    <option value="huawei">华为</option>
                    <option value="linux">Linux</option>
                </select>
            </div>
            <details style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:8px;">
                <summary style="cursor:pointer;font-size:13px;color:#6366f1;font-weight:500;">跳板机配置（可选）</summary>
                <div style="margin-top:8px;">
                    <div class="agent-console-form-group">
                        <label>跳板机地址</label>
                        <input id="ssh-form-jump-host" class="agent-console-input" placeholder="如: 10.0.0.1（留空=直连）" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
                    </div>
                    <div class="agent-console-form-group">
                        <label>跳板机端口</label>
                        <input id="ssh-form-jump-port" class="agent-console-input" type="number" value="22" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
                    </div>
                    <div class="agent-console-form-group">
                        <label>跳板机用户名</label>
                        <input id="ssh-form-jump-username" class="agent-console-input" placeholder="留空则使用目标设备用户名" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
                    </div>
                    <div class="agent-console-form-group">
                        <label>跳板机密码</label>
                        <input id="ssh-form-jump-password" class="agent-console-input" type="password" placeholder="跳板机密码" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:4px;">
                    </div>
                </div>
            </details>
        `, [
            { label: '取消', action: () => this.closeModal?.(), class: 'agent-console-btn-ghost' },
            { label: '连接', action: async () => {
                const host = document.getElementById('ssh-form-host')?.value.trim();
                const port = parseInt(document.getElementById('ssh-form-port')?.value) || 22;
                const username = document.getElementById('ssh-form-username')?.value.trim();
                const password = document.getElementById('ssh-form-password')?.value;
                const device_type = document.getElementById('ssh-form-device-type')?.value || 'generic';
                // 跳板机参数
                const jump_host = document.getElementById('ssh-form-jump-host')?.value.trim() || undefined;
                const jump_port = parseInt(document.getElementById('ssh-form-jump-port')?.value) || 22;
                const jump_username = document.getElementById('ssh-form-jump-username')?.value.trim() || undefined;
                const jump_password = document.getElementById('ssh-form-jump-password')?.value || undefined;
                if (!host || !username) { this.showToast('主机和用户名不能为空', 'warning'); return; }
                const body = { host, port, username, password, device_type, task_id: this.currentTaskId };
                if (jump_host) {
                    body.jump_host = jump_host;
                    body.jump_port = jump_port;
                    if (jump_username) body.jump_username = jump_username;
                    if (jump_password) body.jump_password = jump_password;
                }
                try {
                    await this.apiRequest('/ssh/sessions', {
                        method: 'POST',
                        body: JSON.stringify(body)
                    });
                    this.closeModal?.();
                    this.loadSshSessions();
                    this.showToast(jump_host ? `已通过跳板机 ${jump_host} 连接到 ${host}` : `已连接到 ${host}`, 'success');
                } catch (e) {
                    this.showToast('连接失败: ' + e.message, 'error');
                }
            }, class: 'agent-console-btn-primary' }
        ]);
    }

    async closeSshSession(sessionId) {
        const confirmed = await this.confirmDialog('确定关闭此SSH会话?');
        if (!confirmed) return;
        try {
            await this.apiRequest(`/ssh/sessions/${sessionId}`, { method: 'DELETE' });
            this.loadSshSessions();
        } catch (e) {
            this.showToast('关闭失败: ' + e.message, 'error');
        }
    }

    // 加载深度测试用例
    async loadTestCases() {
        const container = document.getElementById('cta-test-cases-list');
        if (!container) return;
        if (!this.currentTaskId) {
            container.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">请在任务中心选择一个任务后查看测试用例</div>';
            return;
        }
        try {
            const data = await this.apiRequest(`/deep-test/tasks/${encodeURIComponent(this.currentTaskId)}/test-cases`);
            let cases = data.data || data.cases || [];
            if (cases.length === 0) {
                cases = this._getMockTestCases();
            }
            this._tcList = cases; // 缓存供展开使用
            const summary = cases.reduce((acc, tc) => { acc[tc.status] = (acc[tc.status] || 0) + 1; return acc; }, {});
            const statusFilters = ['all', 'pass', 'fail', 'error', 'pending'];
            const summaryHtml = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:12px;flex-wrap:wrap;">
                <span>共 <strong style="color:#4f46e5;">${cases.length}</strong> 条</span>
                <button class="tc-filter-btn ${this._tcFilter === 'all' || !this._tcFilter ? 'active' : ''}" data-filter="all" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${!this._tcFilter || this._tcFilter === 'all' ? '#4f46e5' : '#64748b'};padding:2px 8px;border-radius:6px;${!this._tcFilter || this._tcFilter === 'all' ? 'background:#eef2ff;' : ''}">全部 ${cases.length}</button>
                <button class="tc-filter-btn ${this._tcFilter === 'pass' ? 'active' : ''}" data-filter="pass" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${this._tcFilter === 'pass' ? '#10b981' : '#64748b'};padding:2px 8px;border-radius:6px;${this._tcFilter === 'pass' ? 'background:#d1fae5;' : ''}">✅ ${summary.pass || 0}</button>
                <button class="tc-filter-btn ${this._tcFilter === 'fail' ? 'active' : ''}" data-filter="fail" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${this._tcFilter === 'fail' ? '#ef4444' : '#64748b'};padding:2px 8px;border-radius:6px;${this._tcFilter === 'fail' ? 'background:#fee2e2;' : ''}">❌ ${summary.fail || 0}</button>
                <button class="tc-filter-btn ${this._tcFilter === 'error' ? 'active' : ''}" data-filter="error" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${this._tcFilter === 'error' ? '#f59e0b' : '#64748b'};padding:2px 8px;border-radius:6px;${this._tcFilter === 'error' ? 'background:#fef3c7;' : ''}">⚠️ ${summary.error || 0}</button>
                <button class="tc-filter-btn ${this._tcFilter === 'pending' ? 'active' : ''}" data-filter="pending" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${this._tcFilter === 'pending' ? '#94a3b8' : '#64748b'};padding:2px 8px;border-radius:6px;${this._tcFilter === 'pending' ? 'background:#f1f5f9;' : ''}">⏳ ${summary.pending || 0}</button>
            </div>`;
            // 应用筛选
            let displayCases = cases;
            if (this._tcFilter && this._tcFilter !== 'all') {
                displayCases = cases.filter(tc => tc.status === this._tcFilter);
            }
            // 分页
            const pageSize = 20;
            const totalPages = Math.ceil(displayCases.length / pageSize);
            if (!this._tcPage || this._tcPage > totalPages) this._tcPage = 1;
            const startIdx = (this._tcPage - 1) * pageSize;
            const pageCases = displayCases.slice(startIdx, startIdx + pageSize);
            const paginationHtml = totalPages > 1 ? `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;border-top:1px solid #f1f5f9;font-size:12px;">
                <button id="tc-prev-page" ${this._tcPage <= 1 ? 'disabled' : ''} style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;color:#64748b;${this._tcPage <= 1 ? 'opacity:0.4;cursor:not-allowed;' : ''}">上一页</button>
                <span style="color:#64748b;">第 ${this._tcPage}/${totalPages} 页 (共 ${displayCases.length} 条)</span>
                <button id="tc-next-page" ${this._tcPage >= totalPages ? 'disabled' : ''} style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;color:#64748b;${this._tcPage >= totalPages ? 'opacity:0.4;cursor:not-allowed;' : ''}">下一页</button>
            </div>` : '';
            const listHtml = pageCases.length === 0
                ? '<div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;">该筛选条件下无匹配用例</div>'
                : pageCases.map((tc, idx) => {
                    const statusConfig = {
                        pass: { color: '#10b981', bg: '#d1fae5', icon: '✅', label: 'PASS' },
                        fail: { color: '#ef4444', bg: '#fee2e2', icon: '❌', label: 'FAIL' },
                        error: { color: '#f59e0b', bg: '#fef3c7', icon: '⚠️', label: 'ERROR' },
                        pending: { color: '#94a3b8', bg: '#f1f5f9', icon: '⏳', label: 'PENDING' },
                        running: { color: '#3b82f6', bg: '#dbeafe', icon: '🔄', label: 'RUNNING' }
                    }[tc.status] || { color: '#94a3b8', bg: '#f1f5f9', icon: '⏳', label: tc.status };
                    const globalIdx = startIdx + idx + 1;
                    const caseId = this.escapeHtml(tc.case_id || tc.id || `#${globalIdx}`);
                    const isExpanded = this._tcExpanded === (tc.case_id || tc.id || globalIdx);
                    return `
                        <div class="tc-row ${isExpanded ? 'tc-row-expanded' : ''}" data-tc-id="${this.escapeHtml(String(tc.case_id || tc.id || globalIdx))}" style="border-bottom:1px solid #f1f5f9;">
                            <div class="tc-row-header" style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;transition:background 0.12s;" onmouseover="this.style.background='#f8fafc';" onmouseout="this.style.background='${isExpanded ? '#f5f3ff' : '#fff'}';">
                                <span style="color:#94a3b8;font-size:11px;width:28px;text-align:right;flex-shrink:0;">${globalIdx}</span>
                                <span style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:4px;background:${statusConfig.bg};color:${statusConfig.color};font-size:10px;font-weight:700;min-width:50px;justify-content:center;flex-shrink:0;">${statusConfig.icon} ${statusConfig.label}</span>
                                <span style="font-size:13px;font-weight:600;color:#1e293b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(tc.name)}</span>
                                ${tc.priority ? `<span style="color:#6366f1;font-size:10px;font-weight:700;background:#eef2ff;padding:1px 5px;border-radius:4px;flex-shrink:0;">P${tc.priority}</span>` : ''}
                                ${tc.retest_count > 0 ? `<span style="color:#f59e0b;font-size:10px;font-weight:600;background:#fef3c7;padding:1px 5px;border-radius:4px;flex-shrink:0;">↻${tc.retest_count}</span>` : ''}
                                <span style="font-size:11px;color:#6366f1;font-family:monospace;font-weight:600;flex-shrink:0;background:#eef2ff;padding:1px 6px;border-radius:4px;">${caseId}</span>
                                <span style="font-size:10px;color:#cbd5e1;flex-shrink:0;transition:transform 0.2s;${isExpanded ? 'transform:rotate(90deg);' : ''}">▶</span>
                            </div>
                            ${isExpanded ? this._renderTestCaseDetail(tc) : ''}
                        </div>
                    `;
                }).join('');
            container.innerHTML = summaryHtml + listHtml + paginationHtml;
            // 绑定筛选按钮
            container.querySelectorAll('.tc-filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._tcFilter = btn.dataset.filter;
                    this._tcPage = 1;
                    this._tcExpanded = null;
                    this.loadTestCases();
                });
            });
            // 绑定行点击展开/收起
            container.querySelectorAll('.tc-row-header').forEach(header => {
                header.addEventListener('click', () => {
                    const tcId = header.parentElement.dataset.tcId;
                    this._tcExpanded = (this._tcExpanded === tcId) ? null : tcId;
                    this.loadTestCases();
                });
            });
            // 绑定分页
            const prevBtn = document.getElementById('tc-prev-page');
            const nextBtn = document.getElementById('tc-next-page');
            prevBtn?.addEventListener('click', () => { if (this._tcPage > 1) { this._tcPage--; this.loadTestCases(); } });
            nextBtn?.addEventListener('click', () => { this._tcPage++; this.loadTestCases(); });
        } catch (e) {
            container.innerHTML = `<div style="padding:16px;color:#ef4444;">加载测试用例失败: ${e.message}</div>`;
        }
    }

    /**
     * 渲染测试用例展开详情
     */
    _renderTestCaseDetail(tc) {
        const commands = typeof tc.command_list === 'string' ? safeJson(tc.command_list, []) : (tc.command_list || []);
        const expected = typeof tc.expected_result === 'string' ? safeJson(tc.expected_result, {}) : (tc.expected_result || {});
        const actualOutput = typeof tc.actual_output === 'string' ? tc.actual_output : (tc.actual_output ? JSON.stringify(tc.actual_output, null, 2) : null);
        return `
            <div style="padding:12px 12px 12px 48px;background:#fafaff;border-top:1px solid #ede9fe;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                        <div style="font-size:11px;font-weight:700;color:#6d28d9;margin-bottom:4px;">📋 描述</div>
                        <div style="font-size:12px;color:#475569;line-height:1.5;">${this.escapeHtml(tc.description || '-')}</div>
                    </div>
                    <div>
                        <div style="font-size:11px;font-weight:700;color:#6d28d9;margin-bottom:4px;">🎯 期望结果</div>
                        <div style="font-size:12px;color:#475569;">
                            <span style="background:#f1f5f9;padding:1px 6px;border-radius:4px;font-family:monospace;font-size:11px;">${this.escapeHtml(expected.type || '-')}</span>
                            → <span style="font-weight:600;color:#4f46e5;">${this.escapeHtml(String(expected.value ?? '-'))}</span>
                        </div>
                    </div>
                </div>
                ${commands.length > 0 ? `
                    <div style="margin-top:8px;">
                        <div style="font-size:11px;font-weight:700;color:#6d28d9;margin-bottom:4px;">💻 CLI 命令 (${commands.length})</div>
                        <div style="background:#0f172a;border-radius:6px;padding:8px 10px;font-family:'SF Mono','Monaco',monospace;font-size:11px;line-height:1.6;">
                            ${commands.map((cmd, i) => `<div style="color:#38bdf8;">$ <span style="color:#e2e8f0;">${this.escapeHtml(cmd)}</span></div>`).join('')}
                        </div>
                    </div>
                ` : ''}
                ${actualOutput ? `
                    <div style="margin-top:8px;">
                        <div style="font-size:11px;font-weight:700;color:#6d28d9;margin-bottom:4px;">📤 实际输出</div>
                        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px 10px;font-family:'SF Mono','Monaco',monospace;font-size:11px;color:#166534;white-space:pre-wrap;max-height:120px;overflow-y:auto;">${this.escapeHtml(actualOutput)}</div>
                    </div>
                ` : ''}
                <div style="margin-top:8px;display:flex;gap:12px;font-size:11px;color:#94a3b8;">
                    <span>路径: <code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;">${this.escapeHtml(tc.path_type || 'cli_command')}</code></span>
                    ${tc.executed_at ? `<span>执行时间: ${this.formatDateTime(tc.executed_at)}</span>` : ''}
                </div>
            </div>
        `;
    }

    _getMockTestCases() {
        return [
            { case_id: 'TC-001', name: '验证CBFC使能寄存器', description: '检查 QOS_CBFC_CTRL 寄存器 (0x4008) 的使能位是否可正确读写', status: 'pass', priority: 1, path_type: 'cli_command', command_list: ['qos cbfc enable port 1', 'show qos cbfc status port 1'], expected_result: { type: 'output_contains', value: 'enabled' }, actual_output: 'CBFC is enabled on port 1', retest_count: 0 },
            { case_id: 'TC-002', name: '验证PFC优先级3暂停帧', description: '发送优先级3的PFC暂停帧，验证端口2是否正确暂停转发', status: 'fail', priority: 1, path_type: 'cli_command', command_list: ['qos cbfc priority 3 enable port 1', 'show counter port 2'], expected_result: { type: 'output_contains', value: 'paused' }, actual_output: 'Port 2 forwarding: active', retest_count: 1 },
            { case_id: 'TC-003', name: '验证CBFC恢复机制', description: '停止发送PFC暂停帧后，验证端口在恢复时间内恢复转发', status: 'pass', priority: 2, path_type: 'cli_command', command_list: ['stop traffic', 'show counter port 2'], expected_result: { type: 'register_value', value: '0x1' }, actual_output: 'Port 2 forwarding: active, recovery_time: 12ms', retest_count: 0 },
            { case_id: 'TC-004', name: '验证QoS队列调度优先级', description: '配置8个队列优先级，发送混合流量验证调度顺序', status: 'error', priority: 2, path_type: 'cli_command', command_list: ['qos queue priority 0-7'], expected_result: { type: 'status_code', value: 0 }, actual_output: null, retest_count: 0 },
            { case_id: 'TC-005', name: '验证端口1计数器', description: '检查端口1的 rx_packets/tx_packets/loss_packets 计数器', status: 'pass', priority: 3, path_type: 'cli_command', command_list: ['show counter port 1'], expected_result: { type: 'output_contains', value: 'rx_packets' }, actual_output: 'rx_packets: 15234, tx_packets: 14982, loss_packets: 0', retest_count: 0 },
            { case_id: 'TC-006', name: '验证CBFC寄存器默认值', description: '检查 QOS_CBFC_CTRL 寄存器上电默认值是否为 0x1F', status: 'pending', priority: 3, path_type: 'cli_command', command_list: ['show register 0x4008'], expected_result: { type: 'register_value', value: '0x1F' }, actual_output: null, retest_count: 0 },
            { case_id: 'TC-007', name: '验证状态机IDLE->ACTIVE转换', description: '使能CBFC后验证状态从IDLE切换到ACTIVE', status: 'pending', priority: 2, path_type: 'cli_command', command_list: ['show qos cbfc state'], expected_result: { type: 'output_contains', value: 'ACTIVE' }, actual_output: null, retest_count: 0 },
        ];
    }

    // 加载测试Bug
    async loadTestBugs() {
        const container = document.getElementById('cta-test-bugs-list');
        if (!container) return;
        if (!this.currentTaskId) {
            container.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">请在任务中心选择一个任务后查看Bug</div>';
            return;
        }
        try {
            const data = await this.apiRequest(`/deep-test/tasks/${encodeURIComponent(this.currentTaskId)}/test-bugs`);
            let bugs = data.data || data.bugs || [];
            if (bugs.length === 0) {
                bugs = this._getMockTestBugs();
            }
            this._bugList = bugs;
            const summary = bugs.reduce((acc, b) => { acc[b.severity] = (acc[b.severity] || 0) + 1; return acc; }, {});
            const summaryHtml = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:12px;flex-wrap:wrap;">
                <span>共 <strong style="color:#4f46e5;">${bugs.length}</strong> 个</span>
                <button class="bug-filter-btn ${!this._bugFilter || this._bugFilter === 'all' ? 'active' : ''}" data-filter="all" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${!this._bugFilter || this._bugFilter === 'all' ? '#4f46e5' : '#64748b'};padding:2px 8px;border-radius:6px;${!this._bugFilter || this._bugFilter === 'all' ? 'background:#eef2ff;' : ''}">全部 ${bugs.length}</button>
                <button class="bug-filter-btn ${this._bugFilter === 'critical' ? 'active' : ''}" data-filter="critical" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${this._bugFilter === 'critical' ? '#ef4444' : '#64748b'};padding:2px 8px;border-radius:6px;${this._bugFilter === 'critical' ? 'background:#fee2e2;' : ''}">🔴 严重 ${summary.critical || 0}</button>
                <button class="bug-filter-btn ${this._bugFilter === 'major' ? 'active' : ''}" data-filter="major" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${this._bugFilter === 'major' ? '#f59e0b' : '#64748b'};padding:2px 8px;border-radius:6px;${this._bugFilter === 'major' ? 'background:#fef3c7;' : ''}">🟠 主要 ${summary.major || 0}</button>
                <button class="bug-filter-btn ${this._bugFilter === 'minor' ? 'active' : ''}" data-filter="minor" style="border:none;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${this._bugFilter === 'minor' ? '#3b82f6' : '#64748b'};padding:2px 8px;border-radius:6px;${this._bugFilter === 'minor' ? 'background:#dbeafe;' : ''}">🔵 一般 ${summary.minor || 0}</button>
            </div>`;
            // 应用筛选
            let displayBugs = bugs;
            if (this._bugFilter && this._bugFilter !== 'all') {
                displayBugs = bugs.filter(b => b.severity === this._bugFilter);
            }
            // 分页
            const pageSize = 20;
            const totalPages = Math.ceil(displayBugs.length / pageSize);
            if (!this._bugPage || this._bugPage > totalPages) this._bugPage = 1;
            const startIdx = (this._bugPage - 1) * pageSize;
            const pageBugs = displayBugs.slice(startIdx, startIdx + pageSize);
            const paginationHtml = totalPages > 1 ? `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;border-top:1px solid #f1f5f9;font-size:12px;">
                <button id="bug-prev-page" ${this._bugPage <= 1 ? 'disabled' : ''} style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;color:#64748b;${this._bugPage <= 1 ? 'opacity:0.4;cursor:not-allowed;' : ''}">上一页</button>
                <span style="color:#64748b;">第 ${this._bugPage}/${totalPages} 页 (共 ${displayBugs.length} 个)</span>
                <button id="bug-next-page" ${this._bugPage >= totalPages ? 'disabled' : ''} style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:pointer;color:#64748b;${this._bugPage >= totalPages ? 'opacity:0.4;cursor:not-allowed;' : ''}">下一页</button>
            </div>` : '';
            const listHtml = pageBugs.length === 0
                ? '<div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;">该筛选条件下无匹配Bug</div>'
                : pageBugs.map((b, idx) => {
                    const sevConfig = {
                        critical: { color: '#ef4444', bg: '#fee2e2', icon: '🔴', label: '严重' },
                        major: { color: '#f59e0b', bg: '#fef3c7', icon: '🟠', label: '主要' },
                        minor: { color: '#3b82f6', bg: '#dbeafe', icon: '🔵', label: '一般' },
                        info: { color: '#6b7280', bg: '#f1f5f9', icon: 'ℹ️', label: '提示' }
                    }[b.severity] || { color: '#94a3b8', bg: '#f1f5f9', icon: '❓', label: b.severity };
                    const statusConfig = {
                        open: { color: '#ef4444', label: '未修复' },
                        confirmed: { color: '#f59e0b', label: '已确认' },
                        fixed: { color: '#10b981', label: '已修复' },
                        closed: { color: '#94a3b8', label: '已关闭' }
                    };
                    const stCfg = statusConfig[b.status] || { color: '#94a3b8', label: b.status };
                    const globalIdx = startIdx + idx + 1;
                    const bugId = this.escapeHtml(b.bug_id || b.id || `#${globalIdx}`);
                    const isExpanded = this._bugExpanded === (b.bug_id || b.id || globalIdx);
                    return `
                        <div class="bug-row ${isExpanded ? 'bug-row-expanded' : ''}" data-bug-id="${this.escapeHtml(String(b.bug_id || b.id || globalIdx))}" style="border-bottom:1px solid #f1f5f9;">
                            <div class="bug-row-header" style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;transition:background 0.12s;" onmouseover="this.style.background='#f8fafc';" onmouseout="this.style.background='${isExpanded ? '#fef2f2' : '#fff'}';">
                                <span style="color:#94a3b8;font-size:11px;width:28px;text-align:right;flex-shrink:0;">${globalIdx}</span>
                                <span style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:4px;background:${sevConfig.bg};color:${sevConfig.color};font-size:10px;font-weight:700;min-width:48px;justify-content:center;flex-shrink:0;">${sevConfig.icon} ${sevConfig.label}</span>
                                <span style="font-size:13px;font-weight:600;color:#1e293b;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(b.title || b.description)}</span>
                                <span style="font-size:11px;color:${stCfg.color};font-weight:600;flex-shrink:0;">${stCfg.label}</span>
                                <span style="font-size:11px;color:#ef4444;font-family:monospace;font-weight:600;flex-shrink:0;background:#fee2e2;padding:1px 6px;border-radius:4px;">${bugId}</span>
                                <span style="font-size:10px;color:#cbd5e1;flex-shrink:0;transition:transform 0.2s;${isExpanded ? 'transform:rotate(90deg);' : ''}">▶</span>
                            </div>
                            ${isExpanded ? this._renderTestBugDetail(b) : ''}
                        </div>
                    `;
                }).join('');
            container.innerHTML = summaryHtml + listHtml + paginationHtml;
            // 绑定筛选
            container.querySelectorAll('.bug-filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._bugFilter = btn.dataset.filter;
                    this._bugPage = 1;
                    this._bugExpanded = null;
                    this.loadTestBugs();
                });
            });
            // 绑定展开/收起
            container.querySelectorAll('.bug-row-header').forEach(header => {
                header.addEventListener('click', () => {
                    const bugId = header.parentElement.dataset.bugId;
                    this._bugExpanded = (this._bugExpanded === bugId) ? null : bugId;
                    this.loadTestBugs();
                });
            });
            // 绑定分页
            const prevBtn = document.getElementById('bug-prev-page');
            const nextBtn = document.getElementById('bug-next-page');
            prevBtn?.addEventListener('click', () => { if (this._bugPage > 1) { this._bugPage--; this.loadTestBugs(); } });
            nextBtn?.addEventListener('click', () => { this._bugPage++; this.loadTestBugs(); });
        } catch (e) {
            container.innerHTML = `<div style="padding:16px;color:#ef4444;">加载Bug失败: ${e.message}</div>`;
        }
    }

    /**
     * 渲染 Bug 展开详情
     */
    _renderTestBugDetail(b) {
        return `
            <div style="padding:12px 12px 12px 48px;background:#fff5f5;border-top:1px solid #fecaca;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div>
                        <div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:4px;">📝 详细描述</div>
                        <div style="font-size:12px;color:#475569;line-height:1.5;">${this.escapeHtml(b.description || '-')}</div>
                    </div>
                    <div>
                        <div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:4px;">🔍 证据</div>
                        ${b.evidence ? `<div style="background:#0f172a;border-radius:6px;padding:8px 10px;font-family:'SF Mono','Monaco',monospace;font-size:11px;color:#fca5a5;white-space:pre-wrap;">${this.escapeHtml(b.evidence)}</div>` : '<div style="font-size:12px;color:#94a3b8;">无</div>'}
                    </div>
                </div>
                <div style="margin-top:8px;display:flex;gap:16px;font-size:11px;color:#64748b;flex-wrap:wrap;">
                    <span>类型: <code style="background:#fee2e2;padding:1px 4px;border-radius:3px;color:#ef4444;">${this.escapeHtml(b.bug_type || '-')}</code></span>
                    ${b.case_id ? `<span>关联用例: <code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;">${this.escapeHtml(b.case_id)}</code></span>` : ''}
                    ${b.detected_by ? `<span>发现者: <span style="font-weight:600;">${this.escapeHtml(b.detected_by)}</span></span>` : ''}
                    ${b.created_at ? `<span>发现时间: ${this.formatDateTime(b.created_at)}</span>` : ''}
                </div>
            </div>
        `;
    }

    _getMockTestBugs() {
        return [
            { bug_id: 'BG-001', title: 'PFC暂停帧未触发端口2暂停转发', description: '发送优先级3的PFC暂停帧后，端口2仍继续转发流量，未按预期暂停。怀疑 QOS_CBFC_CTRL 寄存器 (0x4008) 的 PFC 使能位未生效。', severity: 'critical', bug_type: 'functional', status: 'open', case_id: 'TC-002', detected_by: 'critic_agent_v1', evidence: 'expected: paused, actual: forwarding: active', created_at: '2026-07-16T10:15:30.000Z' },
            { bug_id: 'BG-002', title: 'CBFC恢复时间超过规格（12ms > 10ms）', description: '停止发送PFC暂停帧后，端口恢复转发的时间为12ms，超过设计规格的10ms上限。', severity: 'major', bug_type: 'performance', status: 'confirmed', case_id: 'TC-003', detected_by: 'critic_agent_v1', evidence: 'recovery_time: 12ms, spec: <=10ms', created_at: '2026-07-16T10:18:42.000Z' },
            { bug_id: 'BG-003', title: 'QoS队列调度顺序与配置不符', description: '配置队列0优先级最高，但实际调度中队列3先获得带宽。', severity: 'major', bug_type: 'functional', status: 'open', case_id: 'TC-004', detected_by: 'test_hunt', evidence: 'queue_0: priority=7, scheduled_last; queue_3: priority=4, scheduled_first', created_at: '2026-07-16T10:22:01.000Z' },
            { bug_id: 'BG-004', title: '端口1 loss_packets 计数器未清零', description: '重置计数器后发送流量，loss_packets 显示非零初始值。', severity: 'minor', bug_type: 'counter', status: 'fixed', case_id: 'TC-005', detected_by: 'critic_agent_v1', evidence: 'after reset: loss_packets=128 (expected 0)', created_at: '2026-07-16T10:25:15.000Z' },
        ];
    }

    // 当任务被选中时，更新CTA页面
    onTaskSelected(taskId) {
        this.currentTaskId = taskId;
        // 如果当前在CTA页面，重新加载
        if (this.currentPage === 'cta') {
            this.initCtaV2Page();
        }
    }

    async loadCatalog() {
        try {
            const response = await this.apiRequest('/agent-catalog');
            this.catalog = response.data || this.catalog;
            this.renderCatalogSelects();
        } catch (error) {
            console.warn('加载 catalog 失败,使用空列表:', error.message);
        }
    }

    async loadModulesList() {
        try {
            const response = await this.apiRequest('/agent-console/modules/list');
            this.modulesList = response.data || [];
            this.renderModuleSelect();
        } catch (error) {
            console.warn('加载模块列表失败:', error.message);
        }
    }

    async loadLibrariesList() {
        try {
            const response = await this.apiRequest('/agent-console/libraries/list');
            this.librariesList = response.data || [];
        } catch (error) {
            console.warn('加载用例库列表失败:', error.message);
        }
    }

    renderModuleSelect() {
        const moduleSelect = document.getElementById('agent-module-select');
        if (!moduleSelect) return;
        moduleSelect.innerHTML = '<option value="">通用(不指定)</option>' +
            (this.modulesList || []).map(m =>
                `<option value="${this.escapeHtml(m.name)}" data-module-id="${m.id}">${this.escapeHtml(m.name)}${m.taxonomy_path ? ' (' + this.escapeHtml(m.taxonomy_path) + ')' : ''}</option>`
            ).join('');
    }

    renderCatalogSelects() {
        const envSelect = document.getElementById('agent-env-select');
        const modeSelect = document.getElementById('agent-mode-select');
        const severitySelect = document.getElementById('bug-card-severity-select');
        const taskStatusFilter = document.getElementById('agent-task-status-filter');
        const bugStatusFilter = document.getElementById('bug-card-status-filter');
        if (envSelect) {
            envSelect.innerHTML = (this.catalog.target_env || []).map(item =>
                `<option value="${this.escapeHtml(item.item_key)}">${this.escapeHtml(item.item_label)}</option>`
            ).join('');
        }
        if (modeSelect) {
            modeSelect.innerHTML = (this.catalog.mode || []).map(item =>
                `<option value="${this.escapeHtml(item.item_key)}"${item.item_key === 'dry_run' ? ' selected' : ''}>${this.escapeHtml(item.item_label)}</option>`
            ).join('');
        }
        if (severitySelect) {
            severitySelect.innerHTML = (this.catalog.severity || []).map(item =>
                `<option value="${this.escapeHtml(item.item_key)}">${this.escapeHtml(item.item_label)}</option>`
            ).join('');
        }
        if (taskStatusFilter) {
            const current = taskStatusFilter.value;
            taskStatusFilter.innerHTML = '<option value="">全部状态</option>' +
                (this.catalog.task_status || []).map(item =>
                    `<option value="${this.escapeHtml(item.item_key)}">${this.escapeHtml(item.item_label)}</option>`
                ).join('');
            taskStatusFilter.value = current;
        }
        // 同步任务中心完整页 filter
        const fullTaskFilter = document.getElementById('agent-task-status-filter-full');
        if (fullTaskFilter) {
            const current = fullTaskFilter.value;
            fullTaskFilter.innerHTML = '<option value="">全部状态</option>' +
                (this.catalog.task_status || []).map(item =>
                    `<option value="${this.escapeHtml(item.item_key)}">${this.escapeHtml(item.item_label)}</option>`
                ).join('');
            fullTaskFilter.value = current;
        }
        if (bugStatusFilter) {
            const current = bugStatusFilter.value || 'approved';
            bugStatusFilter.innerHTML = '<option value="">全部</option>' +
                (this.catalog.bug_status || []).map(item =>
                    `<option value="${this.escapeHtml(item.item_key)}">${this.escapeHtml(item.item_label)}</option>`
                ).join('');
            bugStatusFilter.value = current;
        }
    }

    bindEvents() {
        // 顶部导航 Tab 切换 - 使用事件委托，确保动态生成的元素也能响应
        const nav = document.getElementById('agent-console-nav');
        if (nav && !nav._acBound) {
            nav._acBound = true;
            nav.addEventListener('click', (e) => {
                const btn = e.target.closest('.agent-console-nav-item');
                if (btn) this.switchPage(btn.dataset.page);
            });
        }
        // 页面内跳转按钮 (如"前往调度中心") - 事件委托
        document.querySelectorAll('.agent-console-page-view').forEach(view => {
            if (!view._acGotoBound) {
                view._acGotoBound = true;
                view.addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-goto-page]');
                    if (btn) this.switchPage(btn.dataset.gotoPage);
                });
            }
        });
        // 快捷键 1-6 切换页面 (只绑定一次)
        if (!document._acKeyBound) {
            document._acKeyBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
                const map = { '1':'overview', '2':'tasks', '3':'pipeline', '4':'resources', '5':'tools', '6':'knowledge' };
                if (map[e.key]) this.switchPage(map[e.key]);
            });
        }

        // 头部按钮
        document.getElementById('agent-console-back-btn').addEventListener('click', () => {
            if (typeof Router !== 'undefined' && Router.navigateTo) Router.navigateTo('workspace');
            else window.history.back();
        });
        document.getElementById('agent-console-refresh-btn').addEventListener('click', () => this.loadAll());
        document.getElementById('agent-console-audit-btn').addEventListener('click', () => this.showAuditLogs());
        document.getElementById('agent-console-config-btn').addEventListener('click', () => this.showConfigManager());
        document.getElementById('agent-console-tools-btn').addEventListener('click', () => this.showToolManager());
        document.getElementById('agent-console-review-btn').addEventListener('click', () => this.showKnowledgeReview());
        document.getElementById('agent-add-btn').addEventListener('click', () => this.showAgentForm());
        document.getElementById('resource-add-btn').addEventListener('click', () => this.showResourceForm());

        // 模块健康度
        document.getElementById('agent-module-health-refresh-btn').addEventListener('click', () => this.loadModuleHealth(true));

        // Diagram Center
        document.getElementById('agent-diagram-upload-btn').addEventListener('click', () => this.showDiagramUpload());
        document.getElementById('agent-diagram-refresh-btn').addEventListener('click', () => this.loadDiagrams());

        // 任务创建
        document.getElementById('agent-create-task-btn').addEventListener('click', () => this.createTask());
        document.getElementById('agent-generate-gap-btn').addEventListener('click', () => this.generateGapReport());
        document.getElementById('agent-task-refresh-btn').addEventListener('click', () => this.loadTasks());
        document.getElementById('agent-task-status-filter').addEventListener('change', () => this.loadTasks());
        // 任务中心(完整页)
        const fullRefresh = document.getElementById('agent-task-refresh-full-btn');
        const fullFilter = document.getElementById('agent-task-status-filter-full');
        if (fullRefresh) fullRefresh.addEventListener('click', () => this.loadTasks());
        if (fullFilter) fullFilter.addEventListener('change', () => this.loadTasks());

        // 资源管理
        document.getElementById('agent-lease-list-btn').addEventListener('click', () => this.showLeases());
        document.getElementById('agent-queue-list-btn').addEventListener('click', () => this.showQueue());

        // Part 5: Bundle 联合锁
        document.getElementById('bundle-add-btn').addEventListener('click', () => this.showBundleForm());
        document.getElementById('bundle-refresh-btn').addEventListener('click', () => this.loadBundles());

        // Part 6: EDA 预约 / 配额 / 抢占
        document.getElementById('reservation-add-btn').addEventListener('click', () => this.showReservationForm());
        document.getElementById('reservation-refresh-btn').addEventListener('click', () => this.loadReservations());
        document.getElementById('quota-view-btn').addEventListener('click', () => this.showQuotaPanel());

        // 芯片代系 / 模块 管理（统一入口）
        document.getElementById('agent-console-chip-module-btn')?.addEventListener('click', () => this.showChipModuleManager());

        // Traffic Studio
        document.getElementById('traffic-generate-btn').addEventListener('click', () => this.generateTrafficSpec());
        document.getElementById('traffic-template-btn').addEventListener('click', () => this.buildPacketTemplate());

        // SDK CLI
        document.getElementById('cli-dry-run-btn').addEventListener('click', () => this.dryRunCli());
        document.getElementById('cli-snapshot-btn').addEventListener('click', () => this.snapshotState());
        document.getElementById('cli-counters-btn').addEventListener('click', () => this.queryCounter());
        document.getElementById('cli-rollback-btn').addEventListener('click', () => this.generateRollback());

        // Bug Learning
        document.getElementById('bug-card-create-btn').addEventListener('click', () => this.createBugCard());
        document.getElementById('bug-retrieve-btn').addEventListener('click', () => this.retrieveBugCards());
        document.getElementById('bug-gaps-btn').addEventListener('click', () => this.showGapReports());
        document.getElementById('bug-card-status-filter').addEventListener('change', () => this.loadBugLearning());

        // 模态框关闭
        document.getElementById('agent-console-modal-close').addEventListener('click', () => this.closeModal());
        document.querySelector('.agent-console-modal-backdrop').addEventListener('click', () => this.closeModal());

        // Pipeline 调度中心
        document.getElementById('pipeline-refresh-btn')?.addEventListener('click', () => this.loadPipelineBoard());
        document.getElementById('pipeline-auto-toggle-btn')?.addEventListener('click', () => this.togglePipelineAuto());
        document.getElementById('pipeline-detail-close')?.addEventListener('click', () => this.closePipelineDetail());
        document.querySelectorAll('.pipeline-detail-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchPipelineTab(btn.dataset.tab));
        });
    }

    async loadAll() {
        this._showSkeletonBeforeLoad();
        await Promise.all([
            this.loadDashboard(),
            this.loadAgents(),
            this.loadResources(),
            this.loadTasks(),
            this.loadBugLearning(),
            this.loadModuleHealth(false),
            this.loadDiagrams(),
            this.loadBundles(),
            this.loadReservations(),
            this.loadPipelineBoard()
        ]).catch(error => this.showToast(error.message, 'error'));
    }

    async loadChipVersions() {
        try {
            const response = await this.apiRequest('/chip-versions');
            this.chipVersions = response.data || [];
            const select = document.getElementById('agent-chip-select');
            if (select) {
                select.innerHTML = '<option value="">通用芯片</option>' + this.chipVersions.map(chip =>
                    `<option value="${chip.id}" data-key="${this.escapeHtml(chip.version_key)}">${this.escapeHtml(chip.name || chip.version_key)}</option>`
                ).join('');
            }
        } catch (error) {
            this.showToast('芯片代系加载失败：' + error.message, 'warning');
        }
    }

    async loadDashboard() {
        const response = await this.apiRequest('/agent-console/dashboard');
        const data = response.data || {};
        const taskTotal = (data.tasks || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
        document.getElementById('agent-console-stats').innerHTML = [
            this.renderStat('任务总数', taskTotal),
            this.renderStat('在线 Agent', (data.agents || []).filter(item => item.status === 'online').reduce((sum, item) => sum + Number(item.count || 0), 0)),
            this.renderStat('空闲资源', data.resources?.idle || 0),
            this.renderStat('占用资源', data.resources?.leased || 0)
        ].join('');
    }

    renderStat(label, value) {
        // 生成迷你 sparkline (随机但稳定的趋势线，仅作视觉点缀)
        const seed = (label.length * 7 + Number(value) * 13) % 100;
        const points = Array.from({ length: 8 }, (_, i) => {
            const v = 40 + Math.sin((seed + i * 12) * 0.5) * 18 + (i * 2);
            return `${i * 12.5},${(50 - v).toFixed(1)}`;
        }).join(' ');
        const trendUp = Number(value) > 0;
        const trendColor = trendUp ? '#10b981' : '#94a3b8';
        return `<div class="agent-console-stat-card">
            <strong>${this.escapeHtml(value)}</strong>
            <span>${this.escapeHtml(label)}</span>
            <svg class="agent-console-sparkline" viewBox="0 0 100 50" preserveAspectRatio="none" width="100%" height="20">
                <polyline points="${points}" fill="none" stroke="${trendColor}" stroke-width="1.5" opacity="0.6"/>
            </svg>
        </div>`;
    }

    // 渲染骨架屏占位
    renderSkeleton(containerId, rows = 3) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = `<div class="agent-console-skeleton">${Array.from({ length: rows }, () => '<div class="agent-console-skeleton-row"></div>').join('')}</div>`;
    }

    // 加载前自动填充骨架屏
    _showSkeletonBeforeLoad() {
        ['agent-registry-list', 'agent-resource-list', 'agent-task-list', 'agent-task-list-overview',
         'agent-bundle-list', 'agent-reservation-list', 'bug-learning-list',
         'agent-module-health-list', 'agent-diagram-list', 'pipeline-board'].forEach(id => {
            const el = document.getElementById(id);
            if (el && el.hasAttribute('data-skeleton')) this.renderSkeleton(id, 3);
        });
    }

    async loadAgents() {
        const response = await this.apiRequest('/agent-console/agents');
        const list = response.data || [];
        document.getElementById('agent-registry-list').innerHTML = list.map(agent => {
            const adminActions = this.isAdminUser ? `
                <button class="agent-console-small-btn agent-edit-btn" type="button" data-agent-id="${this.escapeHtml(agent.agent_id)}">编辑</button>
                <button class="agent-console-small-btn agent-delete-btn" type="button" data-agent-id="${this.escapeHtml(agent.agent_id)}" style="color:#dc2626;">删除</button>
            ` : '';
            return `
            <div class="agent-console-row">
                <div>
                    <div class="agent-console-row-title">${this.escapeHtml(agent.display_name)}</div>
                    <div class="agent-console-row-subtitle">${this.escapeHtml(agent.role)} · ${this.escapeHtml((agent.allowed_modes || []).join(', '))}</div>
                </div>
                <div class="agent-console-row-actions">
                    <span class="agent-console-badge">${this.escapeHtml(agent.status)}</span>
                    <button class="agent-console-small-btn agent-detail-btn" type="button" data-agent-id="${this.escapeHtml(agent.agent_id)}">详情</button>
                    ${adminActions}
                </div>
            </div>
        `;
        }).join('') || this._renderEmpty('暂无 Agent');
        document.querySelectorAll('#agent-registry-list .agent-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => this.showAgentDetail(btn.dataset.agentId));
        });
        document.querySelectorAll('#agent-registry-list .agent-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => this.showAgentForm(btn.dataset.agentId));
        });
        document.querySelectorAll('#agent-registry-list .agent-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => this.deleteAgent(btn.dataset.agentId));
        });
    }

    async loadResources() {
        const response = await this.apiRequest('/resource-scheduler/resources');
        const list = response.data || [];
        document.getElementById('agent-resource-list').innerHTML = list.map(resource => {
            const badgeClass = resource.status === 'idle' ? 'agent-console-badge' : (resource.status === 'dirty' ? 'agent-console-badge agent-console-badge-danger' : 'agent-console-badge agent-console-badge-warning');
            const action = resource.status === 'idle'
                ? `<button class="agent-console-small-btn agent-resource-acquire-btn" type="button" data-resource-id="${this.escapeHtml(resource.resource_id)}">申请</button>`
                : `<button class="agent-console-small-btn agent-resource-queue-btn" type="button" data-resource-id="${this.escapeHtml(resource.resource_id)}">排队</button>`;
            const adminActions = this.isAdminUser ? `
                <button class="agent-console-small-btn resource-edit-btn" type="button" data-resource-id="${this.escapeHtml(resource.resource_id)}">编辑</button>
                <button class="agent-console-small-btn resource-delete-btn" type="button" data-resource-id="${this.escapeHtml(resource.resource_id)}" style="color:#dc2626;">删除</button>
            ` : '';
            return `
                <div class="agent-console-row">
                    <div>
                        <div class="agent-console-row-title">${this.escapeHtml(resource.display_name || resource.resource_id)}</div>
                        <div class="agent-console-row-subtitle">${this.escapeHtml(resource.resource_type)} · ${this.escapeHtml((resource.capabilities || []).join(', '))}</div>
                    </div>
                    <div class="agent-console-row-actions">
                        <span class="${badgeClass}">${this.escapeHtml(resource.status)}</span>
                        ${action}
                        ${adminActions}
                    </div>
                </div>
            `;
        }).join('') || this._renderEmpty('暂无资源');
        document.querySelectorAll('.agent-resource-acquire-btn').forEach(btn => {
            btn.addEventListener('click', () => this.acquireResource(btn.dataset.resourceId));
        });
        document.querySelectorAll('.agent-resource-queue-btn').forEach(btn => {
            btn.addEventListener('click', () => this.enqueueResource(btn.dataset.resourceId));
        });
        document.querySelectorAll('.resource-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => this.showResourceForm(btn.dataset.resourceId));
        });
        document.querySelectorAll('.resource-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => this.deleteResource(btn.dataset.resourceId));
        });
    }

    async loadTasks() {
        // 概览页只显示最近 5 条;任务中心显示 50 条
        const overviewFilter = document.getElementById('agent-task-status-filter')?.value || '';
        const fullFilter = document.getElementById('agent-task-status-filter-full')?.value || '';
        const statusFilter = overviewFilter || fullFilter;
        const params = new URLSearchParams({ limit: 50 });
        if (statusFilter) params.set('status', statusFilter);
        const response = await this.apiRequest(`/agent-console/tasks?${params.toString()}`);
        const list = response.data || [];
        const overviewList = list.slice(0, 5);
        const overviewHtml = overviewList.map(task => this._renderTaskRow(task)).join('') || this._renderEmpty('暂无任务');
        const fullHtml = list.map(task => this._renderTaskRow(task)).join('') || this._renderEmpty('暂无任务');

        const overviewEl = document.getElementById('agent-task-list-overview');
        const fullEl = document.getElementById('agent-task-list');
        if (overviewEl) overviewEl.innerHTML = overviewHtml;
        if (fullEl) fullEl.innerHTML = fullHtml;

        document.querySelectorAll('.agent-task-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => this.showTaskDetail(btn.dataset.taskId));
        });
        document.querySelectorAll('.agent-verdict-btn').forEach(btn => {
            btn.addEventListener('click', () => this.createJointVerdict(btn.dataset.taskId));
        });
    }

    _renderTaskRow(task) {
        const statusBadge = this.getStatusBadge(task.status);
        const approvalBadge = task.approval_required ? `<span class="agent-console-badge agent-console-badge-warning">需审批</span>` : '';
        return `
            <div class="agent-console-row">
                <div>
                    <div class="agent-console-row-title">${this.escapeHtml(task.objective || task.task_id)}</div>
                    <div class="agent-console-row-subtitle">${this.escapeHtml(task.task_id)} · ${this.escapeHtml(task.mode)} · ${this.escapeHtml(task.module_name || '-')} · ${this.formatDateTime(task.created_at)}</div>
                </div>
                <div class="agent-console-row-actions">
                    ${statusBadge}
                    ${approvalBadge}
                    <button class="agent-console-small-btn agent-task-detail-btn" type="button" data-task-id="${this.escapeHtml(task.task_id)}">详情</button>
                    <button class="agent-console-small-btn agent-verdict-btn" type="button" data-task-id="${this.escapeHtml(task.task_id)}">判定</button>
                </div>
            </div>
        `;
    }

    _renderEmpty(text) {
        return `<div class="agent-console-empty-state"><div class="agent-console-empty-icon">📭</div><div>${this.escapeHtml(text)}</div></div>`;
    }

    getStatusBadge(status) {
        const classMap = {
            'completed': 'agent-console-badge agent-console-badge-success',
            'running': 'agent-console-badge is-running',
            'diagnosing': 'agent-console-badge is-running',
            'pending': 'agent-console-badge agent-console-badge-warning',
            'paused': 'agent-console-badge agent-console-badge-warning',
            'waiting_for_critic_review': 'agent-console-badge agent-console-badge-warning',
            'approved': 'agent-console-badge agent-console-badge-success',
            'rejected': 'agent-console-badge agent-console-badge-danger',
            'cancelled': 'agent-console-badge agent-console-badge-danger',
            'failed': 'agent-console-badge agent-console-badge-danger',
            'draft': 'agent-console-badge'
        };
        const labelMap = {
            'waiting_for_critic_review': '待评审',
            'draft': '草稿'
        };
        const cls = classMap[status] || 'agent-console-badge';
        const label = labelMap[status] || status;
        return `<span class="${cls}">${this.escapeHtml(label)}</span>`;
    }

    async loadBugLearning() {
        const status = document.getElementById('bug-card-status-filter')?.value || 'approved';
        const response = await this.apiRequest(`/bug-learning/cards?status=${encodeURIComponent(status)}&limit=20`);
        const list = response.data || [];
        document.getElementById('bug-learning-list').innerHTML = list.map(card => `
            <div class="agent-console-row">
                <div>
                    <div class="agent-console-row-title">${this.escapeHtml(card.title)}</div>
                    <div class="agent-console-row-subtitle">${this.escapeHtml(card.bug_id)} · ${this.escapeHtml(card.module || '-')} · ${this.escapeHtml(card.severity || '-')} · ${this.escapeHtml((card.test_methods || []).join(', '))}</div>
                </div>
                <div class="agent-console-row-actions">
                    <span class="agent-console-badge ${card.status === 'approved' ? '' : 'agent-console-badge-warning'}">${this.escapeHtml(card.status)}</span>
                    <button class="agent-console-small-btn agent-bug-detail-btn" type="button" data-bug-id="${this.escapeHtml(card.bug_id)}">详情</button>
                    ${card.status === 'draft' ? `<button class="agent-console-small-btn agent-bug-approve-btn" type="button" data-bug-id="${this.escapeHtml(card.bug_id)}">审批</button>` : ''}
                </div>
            </div>
        `).join('') || this._renderEmpty('暂无 Bug 方法卡片');
        document.querySelectorAll('.agent-bug-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => this.showBugCardDetail(btn.dataset.bugId));
        });
        document.querySelectorAll('.agent-bug-approve-btn').forEach(btn => {
            btn.addEventListener('click', () => this.approveBugCard(btn.dataset.bugId));
        });
    }

    getContext() {
        const chipSelect = document.getElementById('agent-chip-select');
        const selected = chipSelect.options[chipSelect.selectedIndex];
        const moduleSelect = document.getElementById('agent-module-select');
        const selectedModule = moduleSelect.options[moduleSelect.selectedIndex];
        return {
            chipVersionId: chipSelect.value || null,
            chipVersion: selected?.dataset?.key || selected?.textContent || null,
            module: moduleSelect.value,
            moduleId: selectedModule?.dataset?.moduleId ? parseInt(selectedModule.dataset.moduleId) : null,
            targetEnv: document.getElementById('agent-env-select').value,
            mode: document.getElementById('agent-mode-select').value
        };
    }

    // ========== 任务管理 ==========
    async createTask() {
        const context = this.getContext();
        const objective = document.getElementById('agent-objective-input').value.trim();
        if (!objective) {
            this.showToast('请输入任务目标', 'warning');
            return;
        }
        const response = await this.apiRequest('/agent-console/tasks', {
            method: 'POST',
            body: JSON.stringify({
                objective,
                module: context.module,
                chipVersionId: context.chipVersionId,
                chipVersion: context.chipVersion,
                targetEnv: context.targetEnv,
                mode: context.mode,
                agents: ['planner_agent', 'sdk_cli_agent_v1', 'traffic_agent_v1', 'critic_agent_v1']
            })
        });
        if (response.success) {
            this.showToast('Agent任务卡已创建', 'success');
            document.getElementById('agent-objective-input').value = '';
            await this.loadTasks();
            await this.loadDashboard();
        }
    }

    async showTaskDetail(taskId) {
        try {
            const response = await this.apiRequest(`/agent-console/tasks/${encodeURIComponent(taskId)}`);
            const task = response.data;
            if (!task) return;
            this.currentTaskId = taskId;

            const artifacts = task.artifacts || {};
            const artifactsHtml = Object.keys(artifacts).length > 0
                ? Object.entries(artifacts).map(([k, v]) => `<div class="agent-console-detail-row"><span>${this.escapeHtml(k)}</span><code>${this.escapeHtml(typeof v === 'string' ? v : JSON.stringify(v))}</code></div>`).join('')
                : '<div class="agent-console-empty">无产物</div>';

            const verdict = task.verdict ? `<pre class="agent-console-output">${this.escapeHtml(JSON.stringify(task.verdict, null, 2))}</pre>` : '<div class="agent-console-empty">无判定结果</div>';

            const body = `
                <div class="agent-console-detail-section">
                    <h4>基本信息</h4>
                    <div class="agent-console-detail-row"><span>任务ID</span><strong>${this.escapeHtml(task.task_id)}</strong></div>
                    <div class="agent-console-detail-row"><span>状态</span><strong>${this.escapeHtml(task.status)}</strong></div>
                    <div class="agent-console-detail-row"><span>模式</span><strong>${this.escapeHtml(task.mode)}</strong></div>
                    <div class="agent-console-detail-row"><span>模块</span><strong>${this.escapeHtml(task.module_name || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>目标环境</span><strong>${this.escapeHtml(task.target_env || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>目标</span><span>${this.escapeHtml(task.objective)}</span></div>
                    <div class="agent-console-detail-row"><span>创建时间</span><span>${this.formatDateTime(task.created_at)}</span></div>
                    <div class="agent-console-detail-row"><span>需要审批</span><strong>${task.approval_required ? '是' : '否'}</strong></div>
                    <div class="agent-console-detail-row"><span>审批状态</span><strong>${this.escapeHtml(task.approval_status || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>租约ID</span><code>${this.escapeHtml(task.lease_id || '-')}</code></div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>产物</h4>
                    ${artifactsHtml}
                </div>
                <div class="agent-console-detail-section">
                    <h4>联合判定</h4>
                    ${verdict}
                </div>
            `;

            const footer = this.buildTaskFooter(task);
            this.openModal(`任务详情 - ${task.task_id}`, body, footer);
        } catch (error) {
            this.showToast('加载任务详情失败：' + error.message, 'error');
        }
    }

    buildTaskFooter(task) {
        const buttons = [];
        if (task.status === 'running') {
            buttons.push({ label: '暂停', class: 'agent-console-btn-secondary', action: () => this.updateTaskStatus(task.task_id, 'paused') });
        } else if (task.status === 'paused') {
            buttons.push({ label: '恢复', class: 'agent-console-btn-secondary', action: () => this.updateTaskStatus(task.task_id, 'running') });
        }
        if (['draft', 'pending', 'paused'].includes(task.status)) {
            buttons.push({ label: '取消任务', class: 'agent-console-btn-secondary', action: () => this.updateTaskStatus(task.task_id, 'cancelled') });
        }
        if (task.approval_required && task.approval_status === 'pending') {
            buttons.push({ label: '审批通过', class: 'agent-console-btn', action: () => this.approveTask(task.task_id, 'approved') });
            buttons.push({ label: '审批拒绝', class: 'agent-console-btn-secondary', action: () => this.approveTask(task.task_id, 'rejected') });
        }
        buttons.push({ label: '生成判定', class: 'agent-console-btn-secondary', action: () => { this.closeModal(); this.createJointVerdict(task.task_id); } });
        // 查看工作流：设置当前任务并跳转到 CTA 页面
        buttons.push({ label: '查看工作流', class: 'agent-console-btn', action: () => { this.onTaskSelected(task.task_id); this.closeModal(); this.switchPage('cta'); } });
        if (task.lease_id) {
            buttons.push({ label: '释放租约', class: 'agent-console-btn-secondary', action: () => this.releaseLease(task.lease_id) });
        }
        return buttons;
    }

    async updateTaskStatus(taskId, status) {
        try {
            await this.apiRequest(`/agent-console/tasks/${encodeURIComponent(taskId)}/status`, {
                method: 'POST',
                body: JSON.stringify({ status })
            });
            this.showToast(`任务状态已更新为 ${status}`, 'success');
            this.closeModal();
            await this.loadTasks();
            await this.loadDashboard();
        } catch (error) {
            this.showToast('更新任务状态失败：' + error.message, 'error');
        }
    }

    async approveTask(taskId, decision) {
        try {
            await this.apiRequest(`/agent-console/tasks/${encodeURIComponent(taskId)}/approval`, {
                method: 'POST',
                body: JSON.stringify({ decision })
            });
            this.showToast(`任务审批${decision === 'approved' ? '通过' : '已拒绝'}`, 'success');
            this.closeModal();
            await this.loadTasks();
        } catch (error) {
            this.showToast('审批失败：' + error.message, 'error');
        }
    }

    async createJointVerdict(taskId) {
        try {
            const response = await this.apiRequest(`/agent-console/tasks/${encodeURIComponent(taskId)}/joint-verdict`, {
                method: 'POST',
                body: JSON.stringify({
                    verdict: 'inconclusive',
                    trafficStats: { tx_packets: 0, rx_packets: 0, loss_packets: 0 },
                    cliCounters: {},
                    nextAction: '请补充真实 Traffic stats 与 SDK CLI counters 后重新判定'
                })
            });
            document.getElementById('joint-verdict-output').textContent = JSON.stringify(response.data.verdict || response.data, null, 2);
            this.showToast('联合判定已生成', 'success');
            await this.loadTasks();
        } catch (error) {
            this.showToast('生成判定失败：' + error.message, 'error');
        }
    }

    // ========== 资源管理 ==========
    async acquireResource(resourceId) {
        const context = this.getContext();
        const response = await this.apiRequest('/resource-scheduler/leases/acquire', {
            method: 'POST',
            body: JSON.stringify({
                resourceId,
                taskId: `MANUAL-${Date.now()}`,
                module: context.module,
                chipVersion: context.chipVersion,
                mode: context.mode,
                ttlMinutes: 60
            })
        });
        if (response.success) {
            this.showToast(response.data.acquired ? '资源租约已申请' : '资源不可用', response.data.acquired ? 'success' : 'warning');
            await this.loadResources();
            await this.loadDashboard();
        }
    }

    async enqueueResource(resourceId) {
        const context = this.getContext();
        const response = await this.apiRequest('/resource-scheduler/queue', {
            method: 'POST',
            body: JSON.stringify({
                resourceId,
                taskId: `QUEUE-TASK-${Date.now()}`,
                priority: context.mode === 'execute' ? 50 : 30,
                resourceRequirements: { module: context.module, chipVersion: context.chipVersion, targetEnv: context.targetEnv }
            })
        });
        if (response.success) {
            this.showToast('已加入资源等待队列', 'success');
        }
    }

    async showLeases() {
        try {
            const response = await this.apiRequest('/resource-scheduler/leases?mine=false');
            const leases = response.data || [];
            const body = leases.length === 0
                ? '<div class="agent-console-empty">暂无活跃 Lease</div>'
                : leases.map(l => `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(l.lease_id)}</div>
                            <div class="agent-console-row-subtitle">${this.escapeHtml(l.resource_id)} · ${this.escapeHtml(l.resource_type)} · 用户: ${this.escapeHtml(l.owner_username || l.owner_user || '-')} · 任务: ${this.escapeHtml(l.task_id || '-')}</div>
                            <div class="agent-console-row-subtitle">获取: ${this.formatDateTime(l.acquired_at)} · 过期: ${this.formatDateTime(l.expires_at)}</div>
                        </div>
                        <div class="agent-console-row-actions">
                            <span class="agent-console-badge ${l.lease_status === 'active' ? '' : 'agent-console-badge-warning'}">${this.escapeHtml(l.lease_status)}</span>
                            <button class="agent-console-small-btn agent-release-btn" type="button" data-lease-id="${this.escapeHtml(l.lease_id)}">释放</button>
                            <button class="agent-console-small-btn agent-renew-btn" type="button" data-lease-id="${this.escapeHtml(l.lease_id)}">续租</button>
                        </div>
                    </div>
                `).join('');
            this.openModal('资源 Lease 列表', `<div class="agent-console-list">${body}</div>`, []);
            document.querySelectorAll('.agent-release-btn').forEach(btn => {
                btn.addEventListener('click', () => this.releaseLease(btn.dataset.leaseId));
            });
            document.querySelectorAll('.agent-renew-btn').forEach(btn => {
                btn.addEventListener('click', () => this.renewLease(btn.dataset.leaseId));
            });
        } catch (error) {
            this.showToast('加载租约列表失败：' + error.message, 'error');
        }
    }

    async showQueue() {
        try {
            const response = await this.apiRequest('/resource-scheduler/leases?queue=true');
            const queue = response.data || [];
            const body = queue.length === 0
                ? '<div class="agent-console-empty">暂无排队任务</div>'
                : queue.map(q => `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(q.task_id || '-')}</div>
                            <div class="agent-console-row-subtitle">资源: ${this.escapeHtml(q.resource_id || '-')} · 优先级: ${this.escapeHtml(String(q.priority || '-'))} · 用户: ${this.escapeHtml(q.owner_username || q.owner_user || q.user_id || '-')}</div>
                        </div>
                        <span class="agent-console-badge agent-console-badge-warning">排队中</span>
                    </div>
                `).join('');
            this.openModal('资源等待队列', `<div class="agent-console-list">${body}</div>`, []);
        } catch (error) {
            this.showToast('加载队列失败：' + error.message, 'error');
        }
    }

    async releaseLease(leaseId) {
        try {
            await this.apiRequest(`/resource-scheduler/leases/${encodeURIComponent(leaseId)}/release`, {
                method: 'POST',
                body: JSON.stringify({ cleanupStatus: 'clean' })
            });
            this.showToast('租约已释放', 'success');
            await this.loadResources();
            await this.loadDashboard();
        } catch (error) {
            this.showToast('释放租约失败：' + error.message, 'error');
        }
    }

    async renewLease(leaseId) {
        try {
            await this.apiRequest(`/resource-scheduler/leases/${encodeURIComponent(leaseId)}/renew`, {
                method: 'POST',
                body: JSON.stringify({ ttlMinutes: 60 })
            });
            this.showToast('租约已续租 60 分钟', 'success');
        } catch (error) {
            this.showToast('续租失败：' + error.message, 'error');
        }
    }

    // ========== Bug 学习 ==========
    async createBugCard() {
        const title = document.getElementById('bug-card-title-input').value.trim();
        const module = document.getElementById('bug-card-module-input').value.trim();
        const severity = document.getElementById('bug-card-severity-select').value;
        if (!title) {
            this.showToast('请输入 Bug 卡片标题', 'warning');
            return;
        }
        try {
            const response = await this.apiRequest('/bug-learning/cards', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    module,
                    severity,
                    bugId: `BUG-${module || 'GEN'}-${Date.now()}`,
                    chipVersions: [],
                    submodules: [],
                    targetEnvs: [],
                    rootCause: '',
                    triggerConditions: [],
                    testMethods: [],
                    relatedTestPoints: [],
                    recommendedTestContent: [],
                    coverageGapImplication: '',
                    evidenceRefs: []
                })
            });
            if (response.success) {
                this.showToast('Bug 卡片已创建（草稿状态）', 'success');
                document.getElementById('bug-card-title-input').value = '';
                document.getElementById('bug-card-module-input').value = '';
                await this.loadBugLearning();
            }
        } catch (error) {
            this.showToast('创建 Bug 卡片失败：' + error.message, 'error');
        }
    }

    async showBugCardDetail(bugId) {
        try {
            const response = await this.apiRequest(`/bug-learning/cards?keyword=${encodeURIComponent(bugId)}&limit=1`);
            const card = (response.data || [])[0];
            if (!card) return;
            const body = `
                <div class="agent-console-detail-section">
                    <h4>Bug 卡片详情</h4>
                    <div class="agent-console-detail-row"><span>Bug ID</span><strong>${this.escapeHtml(card.bug_id)}</strong></div>
                    <div class="agent-console-detail-row"><span>标题</span><strong>${this.escapeHtml(card.title)}</strong></div>
                    <div class="agent-console-detail-row"><span>模块</span><strong>${this.escapeHtml(card.module || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>严重度</span><strong>${this.escapeHtml(card.severity)}</strong></div>
                    <div class="agent-console-detail-row"><span>状态</span><strong>${this.escapeHtml(card.status)}</strong></div>
                    <div class="agent-console-detail-row"><span>芯片代系</span><span>${this.escapeHtml((card.chip_versions || []).join(', '))}</span></div>
                    <div class="agent-console-detail-row"><span>子模块</span><span>${this.escapeHtml((card.submodules || []).join(', '))}</span></div>
                    <div class="agent-console-detail-row"><span>测试方法</span><span>${this.escapeHtml((card.test_methods || []).join(', '))}</span></div>
                    <div class="agent-console-detail-row"><span>触发条件</span><span>${this.escapeHtml((card.trigger_conditions || []).join('; '))}</span></div>
                    <div class="agent-console-detail-row"><span>根因</span><span>${this.escapeHtml(card.root_cause || '-')}</span></div>
                    <div class="agent-console-detail-row"><span>相关测试点</span><span>${this.escapeHtml((card.related_test_points || []).join(', '))}</span></div>
                    <div class="agent-console-detail-row"><span>推荐测试内容</span><span>${this.escapeHtml((card.recommended_test_content || []).join('; '))}</span></div>
                    <div class="agent-console-detail-row"><span>覆盖缺口</span><span>${this.escapeHtml(card.coverage_gap_implication || '-')}</span></div>
                    <div class="agent-console-detail-row"><span>证据引用</span><span>${this.escapeHtml((card.evidence_refs || []).join('; '))}</span></div>
                </div>
            `;
            const footer = card.status === 'draft'
                ? [{ label: '审批通过', class: 'agent-console-btn', action: () => this.approveBugCard(card.bug_id) }]
                : [];
            this.openModal(`Bug 卡片 - ${card.bug_id}`, body, footer);
        } catch (error) {
            this.showToast('加载 Bug 卡片详情失败：' + error.message, 'error');
        }
    }

    async approveBugCard(bugId) {
        try {
            await this.apiRequest(`/bug-learning/cards/${encodeURIComponent(bugId)}/approve`, { method: 'POST' });
            this.showToast('Bug 卡片已审批通过', 'success');
            this.closeModal();
            await this.loadBugLearning();
        } catch (error) {
            this.showToast('审批失败：' + error.message, 'error');
        }
    }

    async retrieveBugCards() {
        const keyword = document.getElementById('bug-retrieve-input').value.trim();
        if (!keyword) {
            this.showToast('请输入检索关键词', 'warning');
            return;
        }
        try {
            const response = await this.apiRequest('/bug-learning/retrieve', {
                method: 'POST',
                body: JSON.stringify({ keyword, module: this.getContext().module })
            });
            const results = response.data || [];
            const body = results.length === 0
                ? '<div class="agent-console-empty">未找到匹配结果</div>'
                : results.map(r => `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(r.title || r.metadata?.bugId || '检索结果')}</div>
                            <div class="agent-console-row-subtitle">类型: ${this.escapeHtml(r.fileCategory || r.metadata?.category || '-')} · 分数: ${this.escapeHtml(String(r.score || r.similarity || '-'))}</div>
                        </div>
                    </div>
                `).join('');
            this.openModal('Bug 向量检索结果', `<div class="agent-console-list">${body}</div>`, []);
        } catch (error) {
            this.showToast('检索失败：' + error.message, 'error');
        }
    }

    async showGapReports() {
        try {
            const module = this.getContext().module;
            const params = module ? `?module=${encodeURIComponent(module)}` : '';
            const response = await this.apiRequest(`/bug-learning/gap-reports${params}`);
            const reports = response.data || [];
            const body = reports.length === 0
                ? '<div class="agent-console-empty">暂无缺口报告，请先生成</div>'
                : reports.map(r => `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(r.report_id)}</div>
                            <div class="agent-console-row-subtitle">模块: ${this.escapeHtml(r.module)} · 状态: ${this.escapeHtml(r.status)} · 缺失测试点: ${this.escapeHtml(String((r.missing_test_points || []).length))}</div>
                            <div class="agent-console-row-subtitle">${this.escapeHtml(r.risk_summary || '')}</div>
                        </div>
                        <button class="agent-console-small-btn agent-gap-detail-btn" type="button" data-report-id="${this.escapeHtml(r.report_id)}">详情</button>
                    </div>
                `).join('');
            this.openModal('查漏补缺报告', `<div class="agent-console-list">${body}</div>`, []);
            document.querySelectorAll('.agent-gap-detail-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showGapReportDetail(btn.dataset.reportId));
            });
        } catch (error) {
            this.showToast('加载缺口报告失败：' + error.message, 'error');
        }
    }

    async showGapReportDetail(reportId) {
        try {
            const response = await this.apiRequest(`/bug-learning/gap-reports/${encodeURIComponent(reportId)}`);
            const r = response.data;
            if (!r) return;
            const body = `
                <div class="agent-console-detail-section">
                    <h4>缺口报告详情</h4>
                    <div class="agent-console-detail-row"><span>报告ID</span><strong>${this.escapeHtml(r.report_id)}</strong></div>
                    <div class="agent-console-detail-row"><span>模块</span><strong>${this.escapeHtml(r.module)}</strong></div>
                    <div class="agent-console-detail-row"><span>芯片代系</span><strong>${this.escapeHtml(r.chip_version || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>状态</span><strong>${this.escapeHtml(r.status)}</strong></div>
                    <div class="agent-console-detail-row"><span>风险摘要</span><span>${this.escapeHtml(r.risk_summary || '-')}</span></div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>已有测试点</h4>
                    <div>${this.escapeHtml((r.existing_test_points || []).join(', ')) || '<span class="agent-console-empty">无</span>'}</div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>Bug 衍生必需测试点</h4>
                    <div>${this.escapeHtml((r.bug_derived_required_points || []).join(', ')) || '<span class="agent-console-empty">无</span>'}</div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>缺失测试点</h4>
                    <div>${this.escapeHtml((r.missing_test_points || []).join(', ')) || '<span class="agent-console-empty">无</span>'}</div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>推荐行动</h4>
                    <div>${this.escapeHtml((r.recommended_actions || []).join('; ')) || '<span class="agent-console-empty">无</span>'}</div>
                </div>
            `;
            this.openModal(`缺口报告 - ${r.report_id}`, body, []);
        } catch (error) {
            this.showToast('加载报告详情失败：' + error.message, 'error');
        }
    }

    async generateGapReport() {
        const context = this.getContext();
        if (!context.module) {
            this.showToast('请先填写模块', 'warning');
            return;
        }
        try {
            const response = await this.apiRequest('/bug-learning/gap-reports', {
                method: 'POST',
                body: JSON.stringify({ module: context.module, chipVersion: context.chipVersion, existingTestPoints: [] })
            });
            if (response.success) {
                this.showToast(`查漏补缺报告已生成：${response.data.report_id}`, 'success');
            }
        } catch (error) {
            this.showToast('生成报告失败：' + error.message, 'error');
        }
    }

    // ========== Traffic Studio ==========
    async generateTrafficSpec() {
        const context = this.getContext();
        const intent = document.getElementById('traffic-intent-input').value.trim();
        try {
            const response = await this.apiRequest('/traffic-agent/flow-spec', {
                method: 'POST',
                body: JSON.stringify({
                    targetEnv: context.targetEnv,
                    topology: { direction: 'port1_to_port2' },
                    packetRequirements: { ether_type: 'ipv4', payload_len: [64, 512, 1518] },
                    trafficProfile: { mode: 'dry_run', rate_percent: 10, duration_sec: 30, seed: Date.now(), intent }
                })
            });
            document.getElementById('traffic-output').textContent = JSON.stringify(response.data, null, 2);
        } catch (error) {
            this.showToast('生成流量规格失败：' + error.message, 'error');
        }
    }

    async buildPacketTemplate() {
        try {
            const response = await this.apiRequest('/traffic-agent/packet-template', {
                method: 'POST',
                body: JSON.stringify({ ether_type: 'ipv4', vlan: 100, payload_len: 256 })
            });
            document.getElementById('traffic-output').textContent = JSON.stringify(response.data, null, 2);
        } catch (error) {
            this.showToast('构造报文模板失败：' + error.message, 'error');
        }
    }

    // ========== SDK CLI ==========
    async dryRunCli() {
        const commands = document.getElementById('cli-commands-input').value.split('\n').map(line => line.trim()).filter(Boolean);
        if (commands.length === 0) {
            this.showToast('请输入 CLI 命令', 'warning');
            return;
        }
        try {
            const response = await this.apiRequest('/sdk-cli-agent/commands/batch', {
                method: 'POST',
                body: JSON.stringify({ commands, mode: 'dry_run', stopOnError: true })
            });
            document.getElementById('cli-output').textContent = JSON.stringify(response.data, null, 2);
        } catch (error) {
            this.showToast('干跑失败：' + error.message, 'error');
        }
    }

    async snapshotState() {
        try {
            const response = await this.apiRequest('/sdk-cli-agent/snapshots', {
                method: 'POST',
                body: JSON.stringify({ mode: 'dry_run', taskId: this.currentTaskId || `SNAPSHOT-${Date.now()}` })
            });
            document.getElementById('cli-output').textContent = JSON.stringify(response.data, null, 2);
            this.showToast('快照已生成', 'success');
        } catch (error) {
            this.showToast('快照失败：' + error.message, 'error');
        }
    }

    async queryCounter() {
        try {
            const response = await this.apiRequest('/sdk-cli-agent/counters/query', {
                method: 'POST',
                body: JSON.stringify({ mode: 'dry_run', taskId: this.currentTaskId || `COUNTER-${Date.now()}`, counterName: 'port.all' })
            });
            document.getElementById('cli-output').textContent = JSON.stringify(response.data, null, 2);
        } catch (error) {
            this.showToast('查询计数器失败：' + error.message, 'error');
        }
    }

    async generateRollback() {
        try {
            const response = await this.apiRequest('/sdk-cli-agent/rollback/generate', {
                method: 'POST',
                body: JSON.stringify({ stateDiff: { configured: ['port enable 1'], rollback: ['port disable 1'] } })
            });
            document.getElementById('cli-output').textContent = JSON.stringify(response.data, null, 2);
            this.showToast('回滚计划已生成', 'success');
        } catch (error) {
            this.showToast('生成回滚失败：' + error.message, 'error');
        }
    }

    // ========== Agent 详情 ==========
    async showAgentDetail(agentId) {
        try {
            const response = await this.apiRequest('/agent-console/agents');
            const agent = (response.data || []).find(a => a.agent_id === agentId);
            if (!agent) return;
            // 拉取工具注册表,在详情页里展示每个工具的元信息
            let toolsMap = {};
            try {
                const toolsResp = await this.apiRequest('/agent-tools');
                (toolsResp.data || []).forEach(t => { toolsMap[t.tool_id] = t; });
            } catch (e) { /* 工具表未初始化时降级显示逗号分隔文本 */ }
            const renderToolCard = (toolId) => {
                const t = toolsMap[toolId];
                if (!t) {
                    return `
                        <div class="agent-console-tool-card tool-missing">
                            <div class="tool-card-header">
                                <strong>${this.escapeHtml(toolId)}</strong>
                                <span class="tool-type-badge tool-type-missing">未注册</span>
                            </div>
                            <div class="tool-card-desc">该工具未在工具注册表中找到,请到"工具管理"中创建</div>
                        </div>
                    `;
                }
                const typeColor = { script: '#0891b2', http: '#7c3aed', cli: '#ea580c', builtin: '#475569' };
                return `
                    <div class="agent-console-tool-card">
                        <div class="tool-card-header">
                            <strong>${this.escapeHtml(t.tool_id)}</strong>
                            <span class="tool-type-badge" style="background:${typeColor[t.invocation_type] || '#475569'};">${this.escapeHtml(t.invocation_type)}</span>
                            ${t.category ? `<span class="tool-card-category">[${this.escapeHtml(t.category)}]</span>` : ''}
                        </div>
                        <div class="tool-card-name">${this.escapeHtml(t.display_name)} · v${this.escapeHtml(t.version || '1')}</div>
                        ${t.description ? `<div class="tool-card-desc">${this.escapeHtml(t.description.length > 120 ? t.description.slice(0, 120) + '...' : t.description)}</div>` : ''}
                        <div class="tool-card-meta">
                            ${t.entry_point ? `<span>入口: <code>${this.escapeHtml(t.entry_point)}</code></span>` : ''}
                            ${t.language && t.language !== 'none' ? `<span>语言: ${this.escapeHtml(t.language)}</span>` : ''}
                            ${t.input_schema ? `<span>输入: ✓</span>` : '<span>输入: -</span>'}
                            ${t.output_schema ? `<span>输出: ✓</span>` : '<span>输出: -</span>'}
                        </div>
                        <button class="agent-console-small-btn tool-card-detail-btn" type="button" data-id="${this.escapeHtml(t.tool_id)}" style="margin-top:6px;">查看定义详情</button>
                    </div>
                `;
            };
            const toolsSection = (agent.allowed_tools || []).length === 0
                ? '<span class="agent-console-empty">无</span>'
                : (agent.allowed_tools || []).map(renderToolCard).join('');
            const body = `
                <div class="agent-console-detail-section">
                    <h4>Agent 详情</h4>
                    <div class="agent-console-detail-row"><span>Agent标识</span><strong>${this.escapeHtml(agent.agent_id)}</strong></div>
                    <div class="agent-console-detail-row"><span>名称</span><strong>${this.escapeHtml(agent.display_name)}</strong></div>
                    <div class="agent-console-detail-row"><span>角色</span><strong>${this.escapeHtml(agent.role)}</strong></div>
                    <div class="agent-console-detail-row"><span>版本</span><strong>${this.escapeHtml(agent.version || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>状态</span><strong>${this.escapeHtml(agent.status)}</strong></div>
                    <div class="agent-console-detail-row"><span>描述</span><span>${this.escapeHtml(agent.description || '-')}</span></div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>工具权限 <span style="font-weight:normal;font-size:12px;color:#64748b;">(共 ${(agent.allowed_tools || []).length} 个,点击查看 Schema)</span></h4>
                    <div class="agent-console-tool-list">${toolsSection}</div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>允许环境</h4>
                    <div>${this.escapeHtml((agent.allowed_envs || []).join(', ')) || '<span class="agent-console-empty">无</span>'}</div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>允许模式</h4>
                    <div>${this.escapeHtml((agent.allowed_modes || []).join(', ')) || '<span class="agent-console-empty">无</span>'}</div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>允许模块</h4>
                    <div>${this.escapeHtml((agent.allowed_modules || []).join(', ')) || '<span class="agent-console-empty">全部</span>'}</div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>需审批操作</h4>
                    <div>${this.escapeHtml((agent.requires_approval_for || []).join(', ')) || '<span class="agent-console-empty">无</span>'}</div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>安全策略</h4>
                    <pre class="agent-console-output">${this.escapeHtml(JSON.stringify(agent.default_safety_policy || {}, null, 2))}</pre>
                </div>
                <div class="agent-console-detail-section">
                    <h4>指标</h4>
                    <pre class="agent-console-output">${this.escapeHtml(JSON.stringify(agent.metrics || {}, null, 2))}</pre>
                </div>
            `;
            this.openModal(`Agent - ${agent.display_name}`, body, []);
            document.querySelectorAll('.tool-card-detail-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showToolDetail(btn.dataset.id));
            });
        } catch (error) {
            this.showToast('加载 Agent 详情失败：' + error.message, 'error');
        }
    }

    // ========== 审计日志 ==========
    async showAuditLogs() {
        try {
            const response = await this.apiRequest('/agent-console/audit-logs?limit=50');
            const logs = response.data || [];
            const body = logs.length === 0
                ? '<div class="agent-console-empty">暂无审计日志</div>'
                : logs.map(log => `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(log.audit_type || log.action || '-')}</div>
                            <div class="agent-console-row-subtitle">${this.escapeHtml(log.task_id || '-')} · 用户: ${this.escapeHtml(log.operator_username || log.user_id || '-')} · 模块: ${this.escapeHtml(log.module || '-')} · 模式: ${this.escapeHtml(log.mode || '-')}</div>
                            <div class="agent-console-row-subtitle">${this.formatDateTime(log.created_at)} · ${this.escapeHtml(log.verdict || '')} ${log.lease_id ? '· lease=' + this.escapeHtml(log.lease_id) : ''} ${log.resource_id ? '· resource=' + this.escapeHtml(log.resource_id) : ''}</div>
                        </div>
                    </div>
                `).join('');
            this.openModal('Agent 操作审计日志', `<div class="agent-console-list">${body}</div>`, []);
        } catch (error) {
            this.showToast('加载审计日志失败：' + error.message, 'error');
        }
    }

    // ========== 配置管理(字典) ==========
    async showConfigManager() {
        const tabs = ['target_env', 'mode', 'severity', 'agent_role', 'task_status', 'resource_type', 'risk_level', 'resource_status', 'agent_status', 'task_type', 'bug_status'];
        const tabLabels = { target_env: '目标环境', mode: '任务模式', severity: 'Bug严重度', agent_role: 'Agent角色', task_status: '任务状态', resource_type: '资源类型', risk_level: '风险等级', resource_status: '资源状态', agent_status: 'Agent状态', task_type: '任务类型', bug_status: 'Bug状态' };
        const tabsHtml = tabs.map(t => `<button class="agent-console-tab-btn" type="button" data-cat="${t}">${this.escapeHtml(tabLabels[t] || t)}</button>`).join('');
        const body = `
            <div class="agent-console-tabs">${tabsHtml}</div>
            <div class="agent-console-actions-row" style="margin:10px 0;">
                <input id="catalog-new-key" type="text" placeholder="键值(英文)" style="flex:1;min-width:120px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                <input id="catalog-new-label" type="text" placeholder="显示文本" style="flex:1;min-width:120px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                <input id="catalog-new-sort" type="number" placeholder="排序" style="width:80px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;" value="50">
                <button class="agent-console-btn" id="catalog-add-btn" type="button">新增</button>
            </div>
            <div id="catalog-items-container" class="agent-console-list"></div>
        `;
        this.openModal('配置管理 - 字典维护', body, []);
        let currentCat = 'target_env';
        const renderItems = (cat) => {
            currentCat = cat;
            const items = this.catalog[cat] || [];
            const html = items.length === 0 ? '<div class="agent-console-empty">暂无数据</div>' : items.map(item => {
                const statusBadge = item.status === 'inactive' ? '<span style="color:#94a3b8;">(停用)</span>' : '';
                return `
                <div class="agent-console-row catalog-row" data-key="${this.escapeHtml(item.item_key)}">
                    <div class="catalog-display-info">
                        <div class="agent-console-row-title">${this.escapeHtml(item.item_key)} ${statusBadge}</div>
                        <div class="agent-console-row-subtitle">${this.escapeHtml(item.item_label)} · 排序 ${this.escapeHtml(String(item.sort_order))} ${item.description ? '· ' + this.escapeHtml(item.description) : ''}</div>
                    </div>
                    <div class="agent-console-row-actions catalog-display-actions">
                        <button class="agent-console-small-btn catalog-toggle-btn" type="button" data-key="${this.escapeHtml(item.item_key)}">${item.status === 'active' ? '停用' : '启用'}</button>
                        <button class="agent-console-small-btn catalog-edit-btn" type="button" data-key="${this.escapeHtml(item.item_key)}">编辑</button>
                        <button class="agent-console-small-btn catalog-delete-btn" type="button" data-key="${this.escapeHtml(item.item_key)}" style="color:#dc2626;">删除</button>
                    </div>
                    <div class="catalog-row-edit" style="display:none;grid-column:1 / -1;flex-direction:column;gap:8px;">
                        <div class="agent-console-actions-row">
                            <input class="catalog-edit-label" type="text" value="${this.escapeHtml(item.item_label)}" placeholder="显示文本" style="flex:1;min-width:140px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                            <input class="catalog-edit-sort" type="number" value="${this.escapeHtml(String(item.sort_order))}" style="width:80px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                            <button class="agent-console-btn catalog-save-btn" type="button" data-key="${this.escapeHtml(item.item_key)}">保存</button>
                            <button class="agent-console-small-btn catalog-cancel-btn" type="button" data-key="${this.escapeHtml(item.item_key)}">取消</button>
                        </div>
                        <input class="catalog-edit-desc" type="text" value="${this.escapeHtml(item.description || '')}" placeholder="描述(可选)" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                    </div>
                </div>
                `;
            }).join('');
            document.getElementById('catalog-items-container').innerHTML = html;
            document.querySelectorAll('.catalog-toggle-btn').forEach(btn => {
                btn.addEventListener('click', () => this.toggleCatalogItem(currentCat, btn.dataset.key));
            });
            document.querySelectorAll('.catalog-edit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const row = btn.closest('.catalog-row');
                    if (!row) return;
                    row.querySelector('.catalog-display-info').style.display = 'none';
                    row.querySelector('.catalog-display-actions').style.display = 'none';
                    row.querySelector('.catalog-row-edit').style.display = 'flex';
                });
            });
            document.querySelectorAll('.catalog-cancel-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const row = btn.closest('.catalog-row');
                    if (!row) return;
                    row.querySelector('.catalog-display-info').style.display = '';
                    row.querySelector('.catalog-display-actions').style.display = '';
                    row.querySelector('.catalog-row-edit').style.display = 'none';
                });
            });
            document.querySelectorAll('.catalog-save-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const row = btn.closest('.catalog-row');
                    this.saveCatalogItem(currentCat, btn.dataset.key, row);
                });
            });
            document.querySelectorAll('.catalog-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => this.deleteCatalogItem(currentCat, btn.dataset.key));
            });
        };
        document.querySelectorAll('.agent-console-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.agent-console-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderItems(btn.dataset.cat);
            });
        });
        document.querySelector('.agent-console-tab-btn').click();
        document.getElementById('catalog-add-btn').addEventListener('click', async () => {
            const key = document.getElementById('catalog-new-key').value.trim();
            const label = document.getElementById('catalog-new-label').value.trim();
            const sort = parseInt(document.getElementById('catalog-new-sort').value) || 50;
            if (!key || !label) { this.showToast('请填写键值和显示文本', 'warning'); return; }
            try {
                await this.apiRequest('/agent-catalog/items', {
                    method: 'POST',
                    body: JSON.stringify({ category: currentCat, itemKey: key, itemLabel: label, sortOrder: sort, status: 'active' })
                });
                this.showToast('字典项已新增', 'success');
                await this.loadCatalog();
                renderItems(currentCat);
            } catch (error) {
                this.showToast('新增失败：' + error.message, 'error');
            }
        });
    }

    async toggleCatalogItem(category, itemKey) {
        const item = (this.catalog[category] || []).find(x => x.item_key === itemKey);
        if (!item) return;
        const newStatus = item.status === 'active' ? 'inactive' : 'active';
        try {
            await this.apiRequest(`/agent-catalog/items/${encodeURIComponent(category)}/${encodeURIComponent(itemKey)}`, {
                method: 'PUT',
                body: JSON.stringify({ status: newStatus })
            });
            this.showToast(newStatus === 'active' ? '已启用' : '已停用', 'success');
            await this.loadCatalog();
            const activeBtn = document.querySelector('.agent-console-tab-btn.active');
            if (activeBtn) activeBtn.click();
        } catch (error) {
            this.showToast('操作失败：' + error.message, 'error');
        }
    }

    async deleteCatalogItem(category, itemKey) {
        const confirmed = await this.confirmDialog(`确定删除字典项 ${itemKey}?`);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/agent-catalog/items/${encodeURIComponent(category)}/${encodeURIComponent(itemKey)}?hard=true`, {
                method: 'DELETE'
            });
            this.showToast('已硬删除', 'success');
            await this.loadCatalog();
            const activeBtn = document.querySelector('.agent-console-tab-btn.active');
            if (activeBtn) activeBtn.click();
        } catch (error) {
            this.showToast('删除失败：' + error.message, 'error');
        }
    }

    async saveCatalogItem(category, itemKey, rowEl) {
        if (!rowEl) return;
        const label = rowEl.querySelector('.catalog-edit-label').value.trim();
        const sort = parseInt(rowEl.querySelector('.catalog-edit-sort').value) || 50;
        const desc = rowEl.querySelector('.catalog-edit-desc').value.trim();
        if (!label) { this.showToast('显示文本不能为空', 'warning'); return; }
        try {
            await this.apiRequest(`/agent-catalog/items/${encodeURIComponent(category)}/${encodeURIComponent(itemKey)}`, {
                method: 'PUT',
                body: JSON.stringify({ itemLabel: label, sortOrder: sort, description: desc })
            });
            this.showToast('已更新', 'success');
            await this.loadCatalog();
            const activeBtn = document.querySelector('.agent-console-tab-btn.active');
            if (activeBtn) activeBtn.click();
        } catch (error) {
            this.showToast('保存失败：' + error.message, 'error');
        }
    }

    // ========== 工具管理 ==========
    async showToolManager() {
        const body = `
            <div class="agent-console-actions-row" style="margin-bottom:12px;">
                <input id="tool-filter-input" type="text" placeholder="按 tool_id / 名称 / 描述过滤" style="flex:1;min-width:200px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                <select id="tool-filter-type" style="padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                    <option value="">全部类型</option>
                    <option value="script">脚本</option>
                    <option value="http">HTTP服务</option>
                    <option value="cli">命令行</option>
                    <option value="builtin">内置</option>
                </select>
                <button class="agent-console-btn" id="tool-add-btn" type="button">新增工具</button>
            </div>
            <div id="tool-list-container" class="agent-console-list"></div>
        `;
        this.openModal('工具管理 - Agent 工具注册表', body, []);
        document.getElementById('tool-add-btn').addEventListener('click', () => this.showToolForm());
        const filterInput = document.getElementById('tool-filter-input');
        const filterType = document.getElementById('tool-filter-type');
        const renderTools = (tools) => {
            const kw = (filterInput.value || '').trim().toLowerCase();
            const typeF = filterType.value;
            const filtered = tools.filter(t => {
                if (typeF && t.invocation_type !== typeF) return false;
                if (!kw) return true;
                return (
                    String(t.tool_id || '').toLowerCase().includes(kw) ||
                    String(t.display_name || '').toLowerCase().includes(kw) ||
                    String(t.description || '').toLowerCase().includes(kw)
                );
            });
            const typeColor = { script: '#0891b2', http: '#7c3aed', cli: '#ea580c', builtin: '#475569' };
            const html = filtered.length === 0
                ? '<div class="agent-console-empty">暂无工具</div>'
                : filtered.map(t => `
                    <div class="agent-console-row tool-row" data-id="${this.escapeHtml(t.tool_id)}">
                        <div>
                            <div class="agent-console-row-title">
                                ${this.escapeHtml(t.tool_id)}
                                <span class="tool-type-badge" style="background:${typeColor[t.invocation_type] || '#475569'};color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;margin-left:6px;">${this.escapeHtml(t.invocation_type)}</span>
                                ${t.status !== 'active' ? `<span style="color:#94a3b8;margin-left:6px;">(${this.escapeHtml(t.status)})</span>` : ''}
                                ${t.category ? `<span style="color:#64748b;margin-left:6px;font-size:12px;">[${this.escapeHtml(t.category)}]</span>` : ''}
                            </div>
                            <div class="agent-console-row-subtitle">${this.escapeHtml(t.display_name)} · v${this.escapeHtml(t.version || '1')}${t.entry_point ? ' · ' + this.escapeHtml(t.entry_point) : ''}</div>
                            ${t.description ? `<div style="color:#475569;font-size:12px;margin-top:4px;">${this.escapeHtml(t.description.length > 100 ? t.description.slice(0, 100) + '...' : t.description)}</div>` : ''}
                        </div>
                        <div class="agent-console-row-actions">
                            <button class="agent-console-small-btn tool-detail-btn" type="button" data-id="${this.escapeHtml(t.tool_id)}">详情</button>
                            <button class="agent-console-small-btn tool-edit-btn" type="button" data-id="${this.escapeHtml(t.tool_id)}">编辑</button>
                            <button class="agent-console-small-btn tool-delete-btn" type="button" data-id="${this.escapeHtml(t.tool_id)}" style="color:#dc2626;">删除</button>
                        </div>
                    </div>
                `).join('');
            document.getElementById('tool-list-container').innerHTML = html;
            document.querySelectorAll('.tool-detail-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showToolDetail(btn.dataset.id));
            });
            document.querySelectorAll('.tool-edit-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showToolForm(btn.dataset.id));
            });
            document.querySelectorAll('.tool-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => this.deleteTool(btn.dataset.id));
            });
        };
        try {
            const resp = await this.apiRequest('/agent-tools?includeInactive=true');
            const allTools = resp.data || [];
            renderTools(allTools);
            filterInput.addEventListener('input', () => renderTools(allTools));
            filterType.addEventListener('change', () => renderTools(allTools));
        } catch (error) {
            this.showToast('加载工具失败：' + error.message, 'error');
        }
    }

    async showToolDetail(toolId) {
        try {
            const resp = await this.apiRequest(`/agent-tools/${encodeURIComponent(toolId)}`);
            const t = resp.data;
            if (!t) { this.showToast('工具不存在', 'warning'); return; }
            const inputStr = t.input_schema ? JSON.stringify(t.input_schema, null, 2) : '(无)';
            const outputStr = t.output_schema ? JSON.stringify(t.output_schema, null, 2) : '(无)';
            const authStr = t.auth_config ? JSON.stringify(t.auth_config, null, 2) : '(无)';
            const tagsStr = (t.tags || []).join(', ') || '(无)';
            const body = `
                <div style="display:flex;flex-direction:column;gap:14px;">
                    <div>
                        <h4 style="margin:0 0 6px 0;font-size:14px;color:#475569;">基本信息</h4>
                        <div style="background:#f8fafc;padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.7;">
                            <div><strong>工具ID:</strong> ${this.escapeHtml(t.tool_id)}</div>
                            <div><strong>名称:</strong> ${this.escapeHtml(t.display_name)}</div>
                            <div><strong>版本:</strong> ${this.escapeHtml(t.version || 'v1')}</div>
                            <div><strong>分类:</strong> ${this.escapeHtml(t.category || '-')}</div>
                            <div><strong>状态:</strong> ${this.escapeHtml(t.status)}</div>
                            <div><strong>调用方式:</strong> ${this.escapeHtml(t.invocation_type)}</div>
                            <div><strong>入口:</strong> ${this.escapeHtml(t.entry_point || '-')}</div>
                            <div><strong>语言:</strong> ${this.escapeHtml(t.language || '-')}</div>
                            <div><strong>超时:</strong> ${this.escapeHtml(String(t.timeout_ms || 30000))} ms</div>
                            <div><strong>内存上限:</strong> ${this.escapeHtml(String(t.max_memory_mb || 256))} MB</div>
                            <div><strong>标签:</strong> ${this.escapeHtml(tagsStr)}</div>
                        </div>
                    </div>
                    ${t.description ? `<div><h4 style="margin:0 0 6px 0;font-size:14px;color:#475569;">描述</h4><div style="background:#f8fafc;padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.6;">${this.escapeHtml(t.description)}</div></div>` : ''}
                    <div>
                        <h4 style="margin:0 0 6px 0;font-size:14px;color:#475569;">输入定义</h4>
                        <pre style="background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;font-size:12px;overflow-x:auto;max-height:300px;margin:0;">${this.escapeHtml(inputStr)}</pre>
                    </div>
                    <div>
                        <h4 style="margin:0 0 6px 0;font-size:14px;color:#475569;">输出定义</h4>
                        <pre style="background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;font-size:12px;overflow-x:auto;max-height:300px;margin:0;">${this.escapeHtml(outputStr)}</pre>
                    </div>
                    ${t.auth_config ? `<div><h4 style="margin:0 0 6px 0;font-size:14px;color:#475569;">认证配置</h4><pre style="background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;font-size:12px;overflow-x:auto;max-height:200px;margin:0;">${this.escapeHtml(authStr)}</pre></div>` : ''}
                    ${t.proxy_config ? `<div><h4 style="margin:0 0 6px 0;font-size:14px;color:#475569;">跳板机配置</h4><div style="background:#f0f9ff;padding:10px 14px;border-radius:8px;font-size:12px;color:#0c4a6e;">通过 <strong>${this.escapeHtml(t.proxy_config.jump_host)}</strong>:${t.proxy_config.jump_port || 22} 转发到 ${this.escapeHtml(t.entry_point || '')}</div></div>` : ''}
                    ${t.code_content ? `<div><h4 style="margin:0 0 6px 0;font-size:14px;color:#475569;">脚本内容</h4><pre style="background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;font-size:12px;overflow-x:auto;max-height:400px;margin:0;">${this.escapeHtml(t.code_content)}</pre></div>` : ''}
                </div>
            `;
            const buttons = [
                { label: '关闭', class: 'agent-console-btn-secondary', action: () => this.closeModal() }
            ];
            if (t.invocation_type === 'http') {
                buttons.unshift({ label: '测试连通性', class: 'agent-console-btn-secondary', action: async () => {
                    try {
                        const result = await this.apiRequest(`/agent-tools/${encodeURIComponent(t.tool_id)}/test-connection`, { method: 'POST' });
                        const d = result.data || result;
                        if (d.reachable) { this.showToast(`连通正常: ${d.message}`, 'success'); }
                        else { this.showToast(`不可达: ${d.message}`, 'error'); }
                    } catch (e) { this.showToast('测试失败: ' + e.message, 'error'); }
                }});
            }
            this.openModal(`工具详情 - ${t.tool_id}`, body, buttons);
        } catch (error) {
            this.showToast('加载工具详情失败：' + error.message, 'error');
        }
    }

    async showToolForm(toolId = null) {
        const isEdit = !!toolId;
        let tool = {
            toolId: '', displayName: '', description: '', version: 'v1', category: '',
            invocationType: 'builtin', entryPoint: '', language: 'none',
            codeContent: '', inputSchema: '', outputSchema: '', authConfig: '',
            timeoutMs: 30000, maxMemoryMb: 256, tags: [], status: 'active', proxyConfig: null
        };
        if (isEdit) {
            try {
                const resp = await this.apiRequest(`/agent-tools/${encodeURIComponent(toolId)}`);
                const raw = resp.data;
                if (raw) {
                    tool = {
                        toolId: raw.tool_id,
                        displayName: raw.display_name,
                        description: raw.description || '',
                        version: raw.version || 'v1',
                        category: raw.category || '',
                        invocationType: raw.invocation_type,
                        entryPoint: raw.entry_point || '',
                        language: raw.language || 'none',
                        codeContent: raw.code_content || '',
                        inputSchema: raw.input_schema ? JSON.stringify(raw.input_schema, null, 2) : '',
                        outputSchema: raw.output_schema ? JSON.stringify(raw.output_schema, null, 2) : '',
                        authConfig: raw.auth_config ? JSON.stringify(raw.auth_config, null, 2) : '',
                        timeoutMs: raw.timeout_ms || 30000,
                        maxMemoryMb: raw.max_memory_mb || 256,
                        tags: raw.tags || [],
                        status: raw.status || 'active',
                        proxyConfig: raw.proxy_config || null
                    };
                }
            } catch (error) {
                this.showToast('加载工具失败：' + error.message, 'error');
                return;
            }
        }
        const body = `
            <div class="agent-console-form">
                <h4 style="margin:0 0 10px 0;font-size:14px;color:#475569;">基本信息</h4>
                <div class="agent-console-form-row">
                    <label>工具ID *</label>
                    <input id="tool-form-id" type="text" value="${this.escapeHtml(tool.toolId)}" ${isEdit ? 'readonly style="background:#f1f5f9;color:#64748b;"' : ''} placeholder="如 traffic_tool_service">
                </div>
                <div class="agent-console-form-row">
                    <label>显示名称 *</label>
                    <input id="tool-form-name" type="text" value="${this.escapeHtml(tool.displayName)}" placeholder="如 Traffic Tool Service">
                </div>
                <div class="agent-console-form-row">
                    <label>分类</label>
                    <input id="tool-form-category" type="text" value="${this.escapeHtml(tool.category)}" placeholder="packet/traffic/capture/analysis/sdk/external">
                </div>
                <div class="agent-console-form-row">
                    <label>版本</label>
                    <input id="tool-form-version" type="text" value="${this.escapeHtml(tool.version)}" style="width:120px;">
                </div>
                <div class="agent-console-form-row">
                    <label>描述</label>
                    <textarea id="tool-form-desc" rows="3" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;font-family:inherit;resize:vertical;" placeholder="工具做什么,Agent 在什么场景下用它">${this.escapeHtml(tool.description)}</textarea>
                </div>

                <h4 style="margin:14px 0 10px 0;font-size:14px;color:#475569;">调用方式</h4>
                <div class="agent-console-form-row">
                    <label>调用类型</label>
                    <select id="tool-form-invocation" style="padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                        <option value="script" ${tool.invocationType === 'script' ? 'selected' : ''}>脚本 (in-process)</option>
                        <option value="http" ${tool.invocationType === 'http' ? 'selected' : ''}>HTTP 外部服务</option>
                        <option value="cli" ${tool.invocationType === 'cli' ? 'selected' : ''}>命令行</option>
                        <option value="builtin" ${tool.invocationType === 'builtin' ? 'selected' : ''}>内置</option>
                    </select>
                </div>
                <div class="agent-console-form-row">
                    <label>入口 (entry_point)</label>
                    <input id="tool-form-entry" type="text" value="${this.escapeHtml(tool.entryPoint)}" placeholder="HTTP URL / CLI 命令 / 脚本路径">
                </div>
                <div class="agent-console-form-row">
                    <label>脚本语言</label>
                    <select id="tool-form-language" style="padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                        <option value="none" ${tool.language === 'none' ? 'selected' : ''}>无</option>
                        <option value="javascript" ${tool.language === 'javascript' ? 'selected' : ''}>JavaScript</option>
                        <option value="python" ${tool.language === 'python' ? 'selected' : ''}>Python</option>
                        <option value="shell" ${tool.language === 'shell' ? 'selected' : ''}>Shell</option>
                    </select>
                </div>
                <div class="agent-console-form-row">
                    <label>超时 (ms)</label>
                    <input id="tool-form-timeout" type="number" value="${this.escapeHtml(String(tool.timeoutMs))}" style="width:140px;">
                    <label style="margin-left:20px;">内存上限 (MB)</label>
                    <input id="tool-form-memory" type="number" value="${this.escapeHtml(String(tool.maxMemoryMb))}" style="width:120px;">
                </div>
                <div class="agent-console-form-row">
                    <label>脚本内容 (script 类型填)</label>
                    <textarea id="tool-form-code" rows="8" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;font-family:'Menlo','Consolas',monospace;font-size:12px;resize:vertical;" placeholder="# 在此粘贴脚本代码">${this.escapeHtml(tool.codeContent)}</textarea>
                </div>

                <h4 style="margin:14px 0 10px 0;font-size:14px;color:#475569;">输入/输出定义 (JSON)</h4>
                <div class="agent-console-form-row">
                    <label>输入定义</label>
                    <textarea id="tool-form-input-schema" rows="6" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;font-family:'Menlo','Consolas',monospace;font-size:12px;resize:vertical;" placeholder='{"type":"object","properties":{}}'>${this.escapeHtml(tool.inputSchema)}</textarea>
                </div>
                <div class="agent-console-form-row">
                    <label>输出定义</label>
                    <textarea id="tool-form-output-schema" rows="6" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;font-family:'Menlo','Consolas',monospace;font-size:12px;resize:vertical;" placeholder='{"type":"object","properties":{}}'>${this.escapeHtml(tool.outputSchema)}</textarea>
                </div>
                <div class="agent-console-form-row">
                    <label>认证配置 (HTTP 类型)</label>
                    <textarea id="tool-form-auth" rows="4" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;font-family:'Menlo','Consolas',monospace;font-size:12px;resize:vertical;" placeholder='{"type":"bearer","token":"..."}'>${this.escapeHtml(tool.authConfig)}</textarea>
                </div>

                <details style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:10px;">
                    <summary style="cursor:pointer;font-size:13px;color:#6366f1;font-weight:500;">跳板机配置（可选，用于隔离网段的 HTTP 服务）</summary>
                    <div style="margin-top:8px;">
                        <div class="agent-console-form-row">
                            <label>跳板机地址</label>
                            <input id="tool-form-jump-host" type="text" value="${this.escapeHtml(tool.proxyConfig?.jump_host || '')}" placeholder="如: 10.0.0.1（留空=直连）" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                        </div>
                        <div style="display:flex;gap:12px;">
                            <div class="agent-console-form-row" style="flex:1;">
                                <label>跳板机端口</label>
                                <input id="tool-form-jump-port" type="number" value="${this.escapeHtml(tool.proxyConfig?.jump_port || 22)}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                            </div>
                            <div class="agent-console-form-row" style="flex:1;">
                                <label>跳板机用户名</label>
                                <input id="tool-form-jump-user" type="text" value="${this.escapeHtml(tool.proxyConfig?.jump_username || '')}" placeholder="root" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                            </div>
                        </div>
                        <div class="agent-console-form-row">
                            <label>跳板机 SSH 密钥路径</label>
                            <input id="tool-form-jump-key" type="text" value="${this.escapeHtml(tool.proxyConfig?.jump_key_path || '')}" placeholder="如: ~/.ssh/id_rsa" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                        </div>
                        <div style="font-size:12px;color:#94a3b8;margin-top:4px;">配置后，HTTP 请求将通过 SSH 隧道转发到目标服务（适用于 xtest 服务器无法直连的场景）</div>
                    </div>
                </details>

                <h4 style="margin:14px 0 10px 0;font-size:14px;color:#475569;">标签与状态</h4>
                <div class="agent-console-form-row">
                    <label>标签 (逗号分隔)</label>
                    <input id="tool-form-tags" type="text" value="${this.escapeHtml((tool.tags || []).join(', '))}" placeholder="traffic, packet, sdkctp">
                </div>
                <div class="agent-console-form-row">
                    <label>状态</label>
                    <select id="tool-form-status" style="padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                        <option value="active" ${tool.status === 'active' ? 'selected' : ''}>启用</option>
                        <option value="inactive" ${tool.status === 'inactive' ? 'selected' : ''}>停用</option>
                        <option value="maintenance" ${tool.status === 'maintenance' ? 'selected' : ''}>维护中</option>
                    </select>
                </div>
            </div>
        `;
        const buttons = [
            { label: '取消', class: 'agent-console-btn-secondary', action: () => this.closeModal() },
            { label: isEdit ? '保存修改' : '创建工具', class: '', action: () => this.submitToolForm(isEdit ? toolId : null) }
        ];
        this.openModal(isEdit ? `编辑工具 - ${toolId}` : '新增工具', body, buttons);
    }

    async submitToolForm(toolId) {
        const val = (id) => (document.getElementById(id)?.value || '').trim();
        const num = (id, dflt) => parseInt(document.getElementById(id)?.value) || dflt;
        const payload = {
            toolId: val('tool-form-id'),
            displayName: val('tool-form-name'),
            description: val('tool-form-desc'),
            version: val('tool-form-version') || 'v1',
            category: val('tool-form-category') || null,
            invocationType: document.getElementById('tool-form-invocation').value,
            entryPoint: val('tool-form-entry') || null,
            language: document.getElementById('tool-form-language').value,
            codeContent: document.getElementById('tool-form-code').value,
            timeoutMs: num('tool-form-timeout', 30000),
            maxMemoryMb: num('tool-form-memory', 256),
            tags: val('tool-form-tags').split(',').map(s => s.trim()).filter(Boolean),
            status: document.getElementById('tool-form-status').value
        };
        // JSON 字段:允许为空
        for (const [field, id] of [['inputSchema', 'tool-form-input-schema'], ['outputSchema', 'tool-form-output-schema'], ['authConfig', 'tool-form-auth']]) {
            const raw = val(id);
            if (raw) {
                try { payload[field] = JSON.parse(raw); }
                catch (e) { this.showToast(`${field} 不是合法 JSON: ${e.message}`, 'error'); return; }
            } else {
                payload[field] = null;
            }
        }
        // 跳板机配置
        const jumpHost = val('tool-form-jump-host');
        if (jumpHost) {
            payload.proxyConfig = {
                jump_host: jumpHost,
                jump_port: parseInt(val('tool-form-jump-port')) || 22,
                jump_username: val('tool-form-jump-user') || undefined,
                jump_key_path: val('tool-form-jump-key') || undefined
            };
        } else {
            payload.proxyConfig = null;
        }
        if (!payload.toolId) { this.showToast('工具ID不能为空', 'warning'); return; }
        if (!payload.displayName) { this.showToast('显示名称不能为空', 'warning'); return; }
        try {
            const url = toolId ? `/agent-tools/${encodeURIComponent(toolId)}` : '/agent-tools';
            const method = toolId ? 'PUT' : 'POST';
            await this.apiRequest(url, { method, body: JSON.stringify(payload) });
            this.showToast(toolId ? '已更新' : '已创建', 'success');
            this.closeModal();
            await this.showToolManager();
        } catch (error) {
            this.showToast('保存失败：' + error.message, 'error');
        }
    }

    async deleteTool(toolId) {
        const confirmed = await this.confirmDialog(`确定删除工具 ${toolId}? (软删除,可在数据库恢复)`);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/agent-tools/${encodeURIComponent(toolId)}`, { method: 'DELETE' });
            this.showToast('已删除', 'success');
            this.closeModal();
            await this.showToolManager();
        } catch (error) {
            this.showToast('删除失败：' + error.message, 'error');
        }
    }

    // ========== Part 2: 模块知识健康度 ==========
    async loadModuleHealth(recompute = false) {
        const listEl = document.getElementById('agent-module-health-list');
        if (!listEl) return;
        try {
            if (recompute) {
                // 逐个触发评分重算(异步,不阻塞 UI)
                this.showToast('正在重新计算模块健康度...', 'success');
            }
            const resp = await this.apiRequest('/agent-console/modules/health?limit=20');
            const modules = resp.data || [];
            if (modules.length === 0) {
                listEl.innerHTML = '<div class="agent-console-empty">暂无模块数据</div>';
                return;
            }
            listEl.innerHTML = modules.map(m => {
                const score = Number(m.health_score || 0);
                const scoreColor = score >= 70 ? '#16a34a' : (score >= 30 ? '#d97706' : '#dc2626');
                const breakdown = m.health_breakdown || {};
                const taxonomy = m.taxonomy_path ? `<span class="agent-console-badge">${this.escapeHtml(m.taxonomy_path)}</span>` : '';
                const breakdownBars = ['docCompleteness', 'drvSdkConsistency', 'bugCoverage', 'testPointCoverage', 'executionStability'].map(k => {
                    const v = Number(breakdown[k] || 0);
                    const color = v >= 70 ? '#16a34a' : (v >= 30 ? '#d97706' : '#dc2626');
                    return `<span title="${this.escapeHtml(k)}: ${v}" style="display:inline-block;width:32px;height:6px;background:#e2e8f0;border-radius:3px;margin-right:3px;position:relative;">
                        <span style="position:absolute;left:0;top:0;height:100%;width:${v}%;background:${color};border-radius:3px;"></span>
                    </span>`;
                }).join('');
                const checkedAt = this.formatDateTime(m.health_checked_at) !== '-' ? this.formatDateTime(m.health_checked_at) : '未评估';
                return `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(m.name)} ${taxonomy}</div>
                            <div class="agent-console-row-subtitle">${breakdownBars} 评估时间: ${this.escapeHtml(checkedAt)}</div>
                        </div>
                        <div class="agent-console-row-actions">
                            <strong style="font-size:20px;color:${scoreColor};">${score.toFixed(0)}</strong>
                            <button class="agent-console-small-btn module-health-recompute-btn" type="button" data-module-id="${m.id}">重算</button>
                            <button class="agent-console-small-btn module-taxonomy-btn" type="button" data-module-id="${m.id}" data-current-path="${this.escapeHtml(m.taxonomy_path || '')}">设置分类</button>
                        </div>
                    </div>
                `;
            }).join('');
            document.querySelectorAll('.module-health-recompute-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const moduleId = btn.dataset.moduleId;
                    btn.disabled = true;
                    btn.textContent = '计算中...';
                    try {
                        await this.apiRequest(`/agent-console/modules/${moduleId}/health`, { method: 'POST' });
                        this.showToast('已更新', 'success');
                        await this.loadModuleHealth(false);
                    } catch (e) {
                        this.showToast('重算失败: ' + e.message, 'error');
                        btn.disabled = false;
                        btn.textContent = '重算';
                    }
                });
            });
            document.querySelectorAll('.module-taxonomy-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showTaxonomyForm(btn.dataset.moduleId, btn.dataset.currentPath));
            });
        } catch (error) {
            listEl.innerHTML = `<div class="agent-console-empty">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    // ========== Part 4: 模块分类编辑 ==========
    async showTaxonomyForm(moduleId, currentPath) {
        let taxonomyOptions = [];
        try {
            const resp = await this.apiRequest('/agent-catalog/module-taxonomy');
            // 只取根分类 (level=1) 作为可选父分类,排除自身
            taxonomyOptions = (resp.data || []).filter(t => t.taxonomy_level === 1);
        } catch (e) { /* 列表可能为空 */ }
        const optionsHtml = taxonomyOptions.map(t =>
            `<option value="${this.escapeHtml(t.taxonomy_path)}" ${t.taxonomy_path === currentPath ? 'selected' : ''}>${this.escapeHtml(t.name)} (${this.escapeHtml(t.taxonomy_path)})</option>`
        ).join('');
        const bodyHtml = `
            <div class="agent-console-detail-section">
                <h4>设置模块分类</h4>
                <div class="agent-console-detail-row">
                    <span>模块 ID</span><strong>${this.escapeHtml(moduleId)}</strong>
                </div>
                <div class="agent-console-detail-row">
                    <span>当前分类</span><code>${this.escapeHtml(currentPath || '未分类')}</code>
                </div>
                <div class="agent-console-detail-row" style="grid-template-columns: 120px 1fr; align-items: center;">
                    <span>选择分类</span>
                    <select id="taxonomy-path-select" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
                        <option value="">-- 不分类 --</option>
                        ${optionsHtml}
                    </select>
                </div>
                <div class="agent-console-detail-row" style="grid-template-columns: 120px 1fr; align-items: center;">
                    <span>分类层级</span>
                    <input type="number" id="taxonomy-level-input" value="2" min="0" max="10" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;width:80px;">
                </div>
            </div>
        `;
        const footerButtons = [
            { label: '取消', action: () => this.closeModal(), class: 'agent-console-btn-secondary' },
            { label: '保存', action: () => this.submitTaxonomy(moduleId), class: '' }
        ];
        this.openModal('设置模块分类', bodyHtml, footerButtons);
    }

    async submitTaxonomy(moduleId) {
        const taxonomyPath = document.getElementById('taxonomy-path-select')?.value || '';
        const taxonomyLevel = parseInt(document.getElementById('taxonomy-level-input')?.value || '0', 10);
        try {
            await this.apiRequest(`/agent-catalog/modules/${moduleId}/taxonomy`, {
                method: 'PUT',
                body: JSON.stringify({ taxonomyPath, taxonomyLevel })
            });
            this.showToast('分类已更新', 'success');
            this.closeModal();
            await this.loadModuleHealth(false);
        } catch (error) {
            this.showToast('保存失败: ' + error.message, 'error');
        }
    }

    // ========== Part 1: Diagram Center ==========
    async loadDiagrams() {
        const listEl = document.getElementById('agent-diagram-list');
        if (!listEl) return;
        try {
            const resp = await this.apiRequest('/diagram/?limit=50');
            const diagrams = resp.data || [];
            if (diagrams.length === 0) {
                listEl.innerHTML = '<div class="agent-console-empty">暂无图形资产,点击"上传图形"开始</div>';
                return;
            }
            const statusColors = {
                pending: 'agent-console-badge-warning',
                parsing: 'agent-console-badge-warning',
                parsed: 'agent-console-badge',
                parse_failed: 'agent-console-badge-danger',
                reviewed: 'agent-console-badge',
                published: 'agent-console-badge'
            };
            listEl.innerHTML = diagrams.map(d => `
                <div class="agent-console-row">
                    <div>
                        <div class="agent-console-row-title">${this.escapeHtml(d.diagram_name || d.diagram_id)} <span class="agent-console-badge ${statusColors[d.parse_status] || ''}">${this.escapeHtml(d.parse_status)}</span></div>
                        <div class="agent-console-row-subtitle">${this.escapeHtml(d.source_file_type)} · 模块ID: ${this.escapeHtml(String(d.module_id || '-'))} · ${this.escapeHtml(d.diagram_type || 'other')} · ${this.formatDateTime(d.created_at)}</div>
                    </div>
                    <div class="agent-console-row-actions">
                        <button class="agent-console-small-btn diagram-detail-btn" type="button" data-diagram-id="${this.escapeHtml(d.diagram_id)}">详情</button>
                        ${d.parse_status === 'parsed' ? `<button class="agent-console-small-btn diagram-review-btn" type="button" data-diagram-id="${this.escapeHtml(d.diagram_id)}" style="color:#16a34a;">审核</button>` : ''}
                        ${this.isAdminUser ? `<button class="agent-console-small-btn diagram-delete-btn" type="button" data-diagram-id="${this.escapeHtml(d.diagram_id)}" style="color:#dc2626;">删除</button>` : ''}
                    </div>
                </div>
            `).join('');
            document.querySelectorAll('.diagram-detail-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showDiagramDetail(btn.dataset.diagramId));
            });
            document.querySelectorAll('.diagram-review-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showDiagramReview(btn.dataset.diagramId));
            });
            document.querySelectorAll('.diagram-delete-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const confirmed = await this.confirmDialog('确定删除该图形资产? (软删除)');
                    if (!confirmed) return;
                    try {
                        await this.apiRequest(`/diagram/${encodeURIComponent(btn.dataset.diagramId)}`, { method: 'DELETE' });
                        this.showToast('已删除', 'success');
                        await this.loadDiagrams();
                    } catch (e) { this.showToast('删除失败: ' + e.message, 'error'); }
                });
            });
        } catch (error) {
            listEl.innerHTML = `<div class="agent-console-empty">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    showDiagramUpload() {
        const moduleOptions = (this.modulesList || []).map(m => `<option value="${m.id}">${this.escapeHtml(m.name)}${m.taxonomy_path ? ' (' + this.escapeHtml(m.taxonomy_path) + ')' : ''}</option>`).join('');
        const libraryOptions = (this.librariesList || []).map(l => `<option value="${l.id}">${this.escapeHtml(l.name)}</option>`).join('');
        const bodyHtml = `
            <div class="agent-console-detail-section">
                <h4>上传图形文件</h4>
                <div class="agent-console-detail-row" style="grid-template-columns: 120px 1fr; align-items: center;">
                    <span>选择文件</span>
                    <input type="file" id="diagram-file-input" accept=".drawio,.vsdx,.svg,.png,.jpg,.jpeg,.pdf" style="font-size:13px;">
                </div>
                <div class="agent-console-detail-row" style="grid-template-columns: 120px 1fr; align-items: center;">
                    <span>模块</span>
                    <select id="diagram-module-id" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
                        <option value="">不关联模块</option>
                        ${moduleOptions}
                    </select>
                </div>
                <div class="agent-console-detail-row" style="grid-template-columns: 120px 1fr; align-items: center;">
                    <span>用例库 (可选)</span>
                    <select id="diagram-library-id" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
                        <option value="">不关联库</option>
                        ${libraryOptions}
                    </select>
                </div>
                <div style="margin-top:12px;padding:10px;background:#f1f5f9;border-radius:8px;font-size:12px;color:#64748b;">
                    支持 drawio / vsdx / svg / png / jpg / pdf. OCR 和 PDF 需 PaddleOCR 服务运行中. 上传后自动解析,需人工审核后发布.
                </div>
            </div>
        `;
        const footerButtons = [
            { label: '取消', action: () => this.closeModal(), class: 'agent-console-btn-secondary' },
            { label: '上传并解析', action: () => this.uploadDiagram(), class: '' }
        ];
        this.openModal('上传图形', bodyHtml, footerButtons);
    }

    async uploadDiagram() {
        const fileInput = document.getElementById('diagram-file-input');
        const moduleId = document.getElementById('diagram-module-id')?.value;
        const libraryId = document.getElementById('diagram-library-id')?.value;
        if (!fileInput || !fileInput.files[0]) {
            this.showToast('请选择文件', 'error');
            return;
        }
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        if (moduleId) formData.append('moduleId', moduleId);
        if (libraryId) formData.append('libraryId', libraryId);
        this.showToast('正在上传并解析...', 'success');
        try {
            const response = await fetch('/api/diagram/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` },
                body: formData
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || `上传失败 (${response.status})`);
            this.showToast(`解析成功: ${data.parse_type}, ${data.pages?.length || 0} 页`, 'success');
            this.closeModal();
            await this.loadDiagrams();
        } catch (error) {
            this.showToast('上传失败: ' + error.message, 'error');
        }
    }

    async showDiagramDetail(diagramId) {
        this.openModal('图形详情', '<div style="text-align:center;padding:20px;">加载中...</div>', []);
        try {
            const resp = await this.apiRequest(`/diagram/${encodeURIComponent(diagramId)}`);
            const d = resp.data || {};
            const nodes = d.nodes || [];
            const edges = d.edges || [];
            const reviews = d.reviews || [];
            const bodyHtml = `
                <div class="agent-console-detail-section">
                    <h4>基本信息</h4>
                    <div class="agent-console-detail-row"><span>Diagram ID</span><code>${this.escapeHtml(d.diagram_id)}</code></div>
                    <div class="agent-console-detail-row"><span>名称</span><strong>${this.escapeHtml(d.diagram_name || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>类型</span><strong>${this.escapeHtml(d.diagram_type || 'other')}</strong></div>
                    <div class="agent-console-detail-row"><span>源文件</span><code>${this.escapeHtml(d.source_file_type)}</code></div>
                    <div class="agent-console-detail-row"><span>解析状态</span><code>${this.escapeHtml(d.parse_status)}</code></div>
                    <div class="agent-console-detail-row"><span>模块 ID</span><strong>${this.escapeHtml(String(d.module_id || '-'))}</strong></div>
                    <div class="agent-console-detail-row"><span>页数</span><strong>${this.escapeHtml(String(d.page_count || 1))}</strong></div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>拓扑统计 (${nodes.length} 节点, ${edges.length} 连线)</h4>
                    <div style="max-height:200px;overflow-y:auto;background:#f8fafc;border-radius:8px;padding:10px;font-size:12px;">
                        <strong>节点类型分布:</strong><br>
                        ${this._diagramNodeStats(nodes)}<br><br>
                        <strong>连线类型分布:</strong><br>
                        ${this._diagramEdgeStats(edges)}
                    </div>
                </div>
                ${d.human_summary ? `
                <div class="agent-console-detail-section">
                    <h4>人工总结</h4>
                    <div style="background:#f8fafc;border-radius:8px;padding:10px;font-size:13px;white-space:pre-wrap;">${this.escapeHtml(d.human_summary)}</div>
                </div>` : ''}
                ${reviews.length > 0 ? `
                <div class="agent-console-detail-section">
                    <h4>审核历史 (${reviews.length})</h4>
                    ${reviews.map(r => `
                        <div class="agent-console-row">
                            <div>
                                <div class="agent-console-row-title">${this.escapeHtml(r.decision)} <span class="agent-console-badge">第 ${r.review_round} 轮</span></div>
                                <div class="agent-console-row-subtitle">${this.escapeHtml(r.reviewer_summary || '')}</div>
                            </div>
                            <div class="agent-console-row-subtitle">${this.formatDateTime(r.created_at)}</div>
                        </div>
                    `).join('')}
                </div>` : ''}
            `;
            this.openModal(`图形详情 - ${d.diagram_name || d.diagram_id}`, bodyHtml, []);
        } catch (error) {
            this.openModal('图形详情', `<div class="agent-console-empty">加载失败: ${this.escapeHtml(error.message)}</div>`, []);
        }
    }

    _diagramNodeStats(nodes) {
        const counts = {};
        nodes.forEach(n => { counts[n.semantic_type] = (counts[n.semantic_type] || 0) + 1; });
        return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ') || '无';
    }

    _diagramEdgeStats(edges) {
        const counts = {};
        edges.forEach(e => { counts[e.semantic_type] = (counts[e.semantic_type] || 0) + 1; });
        return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ') || '无';
    }

    showDiagramReview(diagramId) {
        const bodyHtml = `
            <div class="agent-console-detail-section">
                <h4>人工审核</h4>
                <div class="agent-console-detail-row" style="grid-template-columns: 120px 1fr; align-items: flex-start;">
                    <span>Module Owner 总结</span>
                    <textarea id="diagram-review-summary" rows="6" placeholder="必填: 描述该图形表达的模块功能、状态机、数据流等" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
                </div>
                <div class="agent-console-detail-row" style="grid-template-columns: 120px 1fr; align-items: center;">
                    <span>审核决定</span>
                    <select id="diagram-review-decision" style="padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">
                        <option value="approved">通过 (发布到向量库)</option>
                        <option value="changes_requested">需要修改</option>
                        <option value="rejected">驳回</option>
                    </select>
                </div>
                <div class="agent-console-detail-row" style="grid-template-columns: 120px 1fr; align-items: flex-start;">
                    <span>审核备注</span>
                    <textarea id="diagram-review-notes" rows="3" placeholder="可选" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
                </div>
            </div>
        `;
        const footerButtons = [
            { label: '取消', action: () => this.closeModal(), class: 'agent-console-btn-secondary' },
            { label: '提交审核', action: () => this.submitDiagramReview(diagramId), class: '' }
        ];
        this.openModal(`图形审核 - ${diagramId}`, bodyHtml, footerButtons);
    }

    async submitDiagramReview(diagramId) {
        const humanSummary = document.getElementById('diagram-review-summary')?.value?.trim();
        const decision = document.getElementById('diagram-review-decision')?.value;
        const reviewerNotes = document.getElementById('diagram-review-notes')?.value;
        if (!humanSummary) {
            this.showToast('Module Owner 总结不能为空', 'error');
            return;
        }
        try {
            const resp = await this.apiRequest(`/diagram/${encodeURIComponent(diagramId)}/review`, {
                method: 'POST',
                body: JSON.stringify({ humanSummary, decision, reviewerNotes })
            });
            const published = resp.data?.published;
            this.showToast(published ? '已审核通过并发布到向量库' : '已提交审核', 'success');
            this.closeModal();
            await this.loadDiagrams();
        } catch (error) {
            this.showToast('审核失败: ' + error.message, 'error');
        }
    }

    // ========== Part 3: 知识审核 ==========
    async showKnowledgeReview() {
        this.openModal('知识审核 - 待审核文件列表', '<div style="text-align:center;padding:20px;">加载中...</div>', []);
        try {
            const resp = await this.apiRequest('/knowledge/review/pending?limit=50');
            const files = resp.data || [];
            if (files.length === 0) {
                this.openModal('知识审核 - 待审核文件列表', '<div class="agent-console-empty">暂无待审核文件<br><small>上传文件并自动解析后,会进入待审核列表</small></div>', []);
                return;
            }
            const bodyHtml = files.map(f => {
                const statusBadge = f.review_status === 'auto_parsed'
                    ? '<span class="agent-console-badge agent-console-badge-warning">待审核</span>'
                    : '<span class="agent-console-badge">审核中</span>';
                const flags = f.conflict_flags ? '<span class="agent-console-badge agent-console-badge-danger" style="margin-left:6px;">有冲突</span>' : '';
                return `
                    <div class="agent-console-row" style="grid-template-columns: minmax(0,1fr) auto;">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(f.name)}</div>
                            <div class="agent-console-row-subtitle">
                                ${this.escapeHtml(f.file_ext || '')} · ${this.escapeHtml(f.file_category || '未分类')} ·
                                模块ID: ${this.escapeHtml(String(f.module_id || '-'))} ·
                                更新: ${this.formatDateTime(f.updated_at)}
                            </div>
                        </div>
                        <div class="agent-console-row-actions">
                            ${statusBadge}${flags}
                            <button class="agent-console-small-btn review-detail-btn" type="button" data-file-id="${f.id}">详情</button>
                            <button class="agent-console-small-btn review-approve-btn" type="button" data-file-id="${f.id}" style="color:#16a34a;">通过</button>
                            <button class="agent-console-small-btn review-reject-btn" type="button" data-file-id="${f.id}" style="color:#dc2626;">驳回</button>
                        </div>
                    </div>
                `;
            }).join('');
            this.openModal(`知识审核 - 待审核文件 (${files.length})`, bodyHtml, []);
            document.querySelectorAll('.review-approve-btn').forEach(btn => {
                btn.addEventListener('click', () => this.reviewFile(btn.dataset.fileId, 'approved'));
            });
            document.querySelectorAll('.review-reject-btn').forEach(btn => {
                btn.addEventListener('click', () => this.reviewFile(btn.dataset.fileId, 'rejected'));
            });
            document.querySelectorAll('.review-detail-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showReviewDetail(btn.dataset.fileId));
            });
        } catch (error) {
            this.openModal('知识审核', `<div class="agent-console-empty">加载失败: ${this.escapeHtml(error.message)}</div>`, []);
        }
    }

    async reviewFile(fileId, decision) {
        const label = decision === 'approved' ? '通过' : '驳回';
        const confirmed = await this.confirmDialog(`确定${label}该文件?`);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/knowledge/files/${fileId}/review`, {
                method: 'POST',
                body: JSON.stringify({ decision })
            });
            this.showToast(`已${label}`, 'success');
            await this.showKnowledgeReview();
        } catch (error) {
            this.showToast(`${label}失败: ` + error.message, 'error');
        }
    }

    async showReviewDetail(fileId) {
        try {
            const resp = await this.apiRequest(`/knowledge/files/${fileId}/review`);
            const data = resp.data || {};
            const file = data.file || {};
            const conflicts = data.conflicts || [];
            const conflictHtml = conflicts.length === 0
                ? '<div class="agent-console-empty">暂无冲突日志</div>'
                : conflicts.map(c => `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(c.conflict_type)} <span class="agent-console-badge agent-console-badge-${c.severity === 'critical' ? 'danger' : 'warning'}">${this.escapeHtml(c.severity)}</span></div>
                            <div class="agent-console-row-subtitle">${this.escapeHtml(c.description || '')}</div>
                        </div>
                        <div class="agent-console-row-subtitle">${this.formatDateTime(c.detected_at)}</div>
                    </div>
                `).join('');
            const bodyHtml = `
                <div class="agent-console-detail-section">
                    <h4>文件信息</h4>
                    <div class="agent-console-detail-row"><span>文件名</span><strong>${this.escapeHtml(file.name || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>分类</span><strong>${this.escapeHtml(file.file_category || '-')}</strong></div>
                    <div class="agent-console-detail-row"><span>解析状态</span><code>${this.escapeHtml(file.parse_status || '-')}</code></div>
                    <div class="agent-console-detail-row"><span>审核状态</span><code>${this.escapeHtml(file.review_status || '-')}</code></div>
                    <div class="agent-console-detail-row"><span>审核人</span><strong>${this.escapeHtml(String(file.reviewer_id || '-'))}</strong></div>
                    <div class="agent-console-detail-row"><span>审核时间</span><strong>${this.formatDateTime(file.reviewed_at)}</strong></div>
                    <div class="agent-console-detail-row"><span>取代文件</span><strong>${this.escapeHtml(String(file.supersedes || '-'))}</strong></div>
                </div>
                <div class="agent-console-detail-section">
                    <h4>冲突日志 (${conflicts.length})</h4>
                    <div class="agent-console-list">${conflictHtml}</div>
                </div>
            `;
            this.openModal('审核详情', bodyHtml, []);
        } catch (error) {
            this.showToast('加载详情失败: ' + error.message, 'error');
        }
    }

    // ========== Agent 表单 ==========
    async showAgentForm(agentId = null) {
        const isEdit = !!agentId;
        let agent = { allowedTools: [], allowedEnvs: [], allowedModes: [], allowedModules: [], requiresApprovalFor: [], defaultSafetyPolicy: {}, status: 'online', version: 'v1', role: '', displayName: '', agentId: '', description: '' };
        if (isEdit) {
            try {
                const resp = await this.apiRequest(`/agent-console/agents`);
                const raw = (resp.data || []).find(a => a.agent_id === agentId);
                if (raw) {
                    agent = {
                        agentId: raw.agent_id,
                        displayName: raw.display_name,
                        role: raw.role,
                        version: raw.version,
                        description: raw.description,
                        allowedTools: raw.allowed_tools || [],
                        allowedEnvs: raw.allowed_envs || [],
                        allowedModes: raw.allowed_modes || [],
                        allowedModules: raw.allowed_modules || [],
                        requiresApprovalFor: raw.requires_approval_for || [],
                        status: raw.status
                    };
                }
            } catch (error) { this.showToast('加载 Agent 失败：' + error.message, 'error'); return; }
        }
        const roleOptions = (this.catalog.agent_role || []).map(r => `<option value="${this.escapeHtml(r.item_key)}"${r.item_key === agent.role ? ' selected' : ''}>${this.escapeHtml(r.item_label)}</option>`).join('');
        const statusOptions = (this.catalog.agent_status || []).map(s => `<option value="${this.escapeHtml(s.item_key)}"${s.item_key === agent.status ? ' selected' : ''}>${this.escapeHtml(s.item_label)}</option>`).join('');
        let availableTools = [];
        try {
            const toolsResp = await this.apiRequest('/agent-tools');
            availableTools = toolsResp.data || [];
        } catch (e) { /* 工具表可能未初始化,允许为空 */ }
        const allowedToolsSet = new Set(agent.allowedTools || []);
        const toolsCheckboxHtml = availableTools.length === 0
            ? '<span style="color:#94a3b8;font-size:12px;">暂无已注册工具,可先到"工具管理"中创建</span>'
            : availableTools.map(t => `
                <label class="agent-console-checkbox-item">
                    <input type="checkbox" value="${this.escapeHtml(t.tool_id)}" ${allowedToolsSet.has(t.tool_id) ? 'checked' : ''}>
                    <span>${this.escapeHtml(t.tool_id)}</span>
                    <small style="color:#64748b;margin-left:4px;">${this.escapeHtml(t.display_name)}</small>
                </label>
            `).join('');
        const allowedEnvsSet = new Set(agent.allowedEnvs || []);
        const envsCheckboxHtml = (this.catalog.target_env || []).map(e => `
            <label class="agent-console-checkbox-item">
                <input type="checkbox" value="${this.escapeHtml(e.item_key)}" ${allowedEnvsSet.has(e.item_key) ? 'checked' : ''}>
                <span>${this.escapeHtml(e.item_label)}</span>
            </label>
        `).join('') || '<span style="color:#94a3b8;font-size:12px;">未配置环境,请先到配置管理添加</span>';
        const allowedModesSet = new Set(agent.allowedModes || []);
        const modesCheckboxHtml = (this.catalog.mode || []).map(m => `
            <label class="agent-console-checkbox-item">
                <input type="checkbox" value="${this.escapeHtml(m.item_key)}" ${allowedModesSet.has(m.item_key) ? 'checked' : ''}>
                <span>${this.escapeHtml(m.item_label)}</span>
            </label>
        `).join('') || '<span style="color:#94a3b8;font-size:12px;">未配置模式</span>';
        const allowedModulesSet = new Set(agent.allowedModules || []);
        const modulesCheckboxHtml = (this.modulesList || []).length === 0
            ? '<span style="color:#94a3b8;font-size:12px;">暂无模块(空=全部)</span>'
            : (this.modulesList || []).map(m => `
                <label class="agent-console-checkbox-item">
                    <input type="checkbox" value="${this.escapeHtml(m.name)}" ${allowedModulesSet.has(m.name) ? 'checked' : ''}>
                    <span>${this.escapeHtml(m.name)}</span>
                </label>
            `).join('');
        const body = `
            <div class="agent-console-form">
                ${isEdit ? '' : `
                <div class="agent-console-form-row">
                    <label>Agent标识 *</label>
                    <input id="form-agent-id" type="text" value="${this.escapeHtml(agent.agentId)}" placeholder="例如 my_agent_v1">
                </div>`}
                <div class="agent-console-form-row">
                    <label>显示名称 *</label>
                    <input id="form-agent-name" type="text" value="${this.escapeHtml(agent.displayName)}" placeholder="例如 My Custom Agent">
                </div>
                <div class="agent-console-form-row">
                    <label>角色 *</label>
                    <select id="form-agent-role">${roleOptions}</select>
                </div>
                <div class="agent-console-form-row">
                    <label>版本</label>
                    <input id="form-agent-version" type="text" value="${this.escapeHtml(agent.version || 'v1')}">
                </div>
                <div class="agent-console-form-row">
                    <label>描述</label>
                    <textarea id="form-agent-desc" rows="2">${this.escapeHtml(agent.description || '')}</textarea>
                </div>
                <div class="agent-console-form-row">
                    <label>允许工具</label>
                    <div id="form-agent-tools" class="agent-console-checkbox-group">
                        ${toolsCheckboxHtml}
                    </div>
                </div>
                <div class="agent-console-form-row">
                    <label>允许环境 (不勾=全部)</label>
                    <div id="form-agent-envs" class="agent-console-checkbox-group">
                        ${envsCheckboxHtml}
                    </div>
                </div>
                <div class="agent-console-form-row">
                    <label>允许模式 (不勾=全部)</label>
                    <div id="form-agent-modes" class="agent-console-checkbox-group">
                        ${modesCheckboxHtml}
                    </div>
                </div>
                <div class="agent-console-form-row">
                    <label>允许模块 (不勾=全部)</label>
                    <div id="form-agent-modules" class="agent-console-checkbox-group">
                        ${modulesCheckboxHtml}
                    </div>
                </div>
                <div class="agent-console-form-row">
                    <label>需审批操作(逗号分隔)</label>
                    <input id="form-agent-approval" type="text" value="${this.escapeHtml((agent.requiresApprovalFor || []).join(', '))}" placeholder="execute, autonomous">
                </div>
                <div class="agent-console-form-row">
                    <label>状态</label>
                    <select id="form-agent-status">${statusOptions}</select>
                </div>
            </div>
        `;
        const footer = [
            { label: isEdit ? '保存修改' : '创建 Agent', class: 'agent-console-btn', action: () => this.submitAgentForm(agentId) }
        ];
        this.openModal(isEdit ? `编辑 Agent - ${agentId}` : '新增 Agent', body, footer);
    }

    async submitAgentForm(agentId) {
        const parseList = (s) => (s || '').split(',').map(x => x.trim()).filter(Boolean);
        const data = {
            displayName: document.getElementById('form-agent-name').value.trim(),
            role: document.getElementById('form-agent-role').value,
            version: document.getElementById('form-agent-version').value.trim() || 'v1',
            description: document.getElementById('form-agent-desc').value.trim(),
            allowedTools: Array.from(document.querySelectorAll('#form-agent-tools input[type="checkbox"]:checked')).map(el => el.value),
            allowedEnvs: Array.from(document.querySelectorAll('#form-agent-envs input[type="checkbox"]:checked')).map(el => el.value),
            allowedModes: Array.from(document.querySelectorAll('#form-agent-modes input[type="checkbox"]:checked')).map(el => el.value),
            allowedModules: Array.from(document.querySelectorAll('#form-agent-modules input[type="checkbox"]:checked')).map(el => el.value),
            requiresApprovalFor: parseList(document.getElementById('form-agent-approval').value),
            status: document.getElementById('form-agent-status').value
        };
        if (!data.displayName || !data.role) { this.showToast('显示名称和角色不能为空', 'warning'); return; }
        try {
            if (agentId) {
                await this.apiRequest(`/agent-catalog/agents/${encodeURIComponent(agentId)}`, {
                    method: 'PUT', body: JSON.stringify(data)
                });
                this.showToast('Agent 已更新', 'success');
            } else {
                data.agentId = document.getElementById('form-agent-id').value.trim();
                if (!data.agentId) { this.showToast('Agent标识不能为空', 'warning'); return; }
                await this.apiRequest('/agent-catalog/agents', {
                    method: 'POST', body: JSON.stringify(data)
                });
                this.showToast('Agent 已创建', 'success');
            }
            this.closeModal();
            await this.loadAgents();
            await this.loadDashboard();
        } catch (error) {
            this.showToast('保存失败：' + error.message, 'error');
        }
    }

    async deleteAgent(agentId) {
        const confirmed = await this.confirmDialog(`确定删除 Agent ${agentId}?`);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/agent-catalog/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
            this.showToast('Agent 已删除', 'success');
            await this.loadAgents();
            await this.loadDashboard();
        } catch (error) {
            this.showToast('删除失败：' + error.message, 'error');
        }
    }

    // ========== Resource 表单 ==========
    async showResourceForm(resourceId = null) {
        const isEdit = !!resourceId;
        let resource = { resourceId: '', displayName: '', resourceType: 'CMODEL_INSTANCE', capabilities: [], supportedChipVersions: [], supportedModules: [], connectionProfiles: {}, riskLevel: 'high', status: 'idle' };
        if (isEdit) {
            try {
                const resp = await this.apiRequest('/resource-scheduler/resources');
                const raw = (resp.data || []).find(r => r.resource_id === resourceId);
                if (raw) {
                    resource = {
                        resourceId: raw.resource_id,
                        displayName: raw.display_name,
                        resourceType: raw.resource_type,
                        capabilities: raw.capabilities || [],
                        supportedChipVersions: raw.supported_chip_versions || [],
                        supportedModules: raw.supported_modules || [],
                        connectionProfiles: raw.connection_profiles || {},
                        riskLevel: raw.risk_level || 'high',
                        status: raw.status || 'idle'
                    };
                }
            } catch (error) { this.showToast('加载资源失败：' + error.message, 'error'); return; }
        }
        const typeOptions = (this.catalog.resource_type || []).map(t => `<option value="${this.escapeHtml(t.item_key)}" ${t.item_key === resource.resourceType ? 'selected' : ''}>${this.escapeHtml(t.item_label)}</option>`).join('');
        const riskOptions = (this.catalog.risk_level || []).map(r => `<option value="${this.escapeHtml(r.item_key)}" ${r.item_key === resource.riskLevel ? 'selected' : ''}>${this.escapeHtml(r.item_label)}</option>`).join('');
        const statusOptions = (this.catalog.resource_status || []).filter(s => s.status === 'active').map(s => `<option value="${this.escapeHtml(s.item_key)}" ${s.item_key === resource.status ? 'selected' : ''}>${this.escapeHtml(s.item_label)}</option>`).join('');
        const chipsSet = new Set(resource.supportedChipVersions || []);
        const chipsCheckboxHtml = (this.chipVersions || []).length === 0
            ? '<span style="color:#94a3b8;font-size:12px;">暂无芯片代系(空=全部)</span>'
            : (this.chipVersions || []).map(c => `
                <label class="agent-console-checkbox-item">
                    <input type="checkbox" value="${this.escapeHtml(c.chipVersion || c.chip_version || c.name)}" ${chipsSet.has(c.chipVersion || c.chip_version || c.name) ? 'checked' : ''}>
                    <span>${this.escapeHtml(c.chipVersion || c.chip_version || c.name || c.id)}</span>
                </label>
            `).join('');
        const modulesSet = new Set(resource.supportedModules || []);
        const modulesCheckboxHtml = (this.modulesList || []).length === 0
            ? '<span style="color:#94a3b8;font-size:12px;">暂无模块(空=全部)</span>'
            : (this.modulesList || []).map(m => `
                <label class="agent-console-checkbox-item">
                    <input type="checkbox" value="${this.escapeHtml(m.name)}" ${modulesSet.has(m.name) ? 'checked' : ''}>
                    <span>${this.escapeHtml(m.name)}</span>
                </label>
            `).join('');
        const body = `
            <div class="agent-console-form">
                ${isEdit ? '' : `
                <div class="agent-console-form-row">
                    <label>资源 ID *</label>
                    <input id="form-resource-id" type="text" value="${this.escapeHtml(resource.resourceId)}" placeholder="例如 CMODEL_INSTANCE_04">
                </div>`}
                <div class="agent-console-form-row">
                    <label>显示名称 *</label>
                    <input id="form-resource-name" type="text" value="${this.escapeHtml(resource.displayName)}" placeholder="例如 CModel instance 04">
                </div>
                <div class="agent-console-form-row">
                    <label>资源类型 *</label>
                    <select id="form-resource-type">${typeOptions}</select>
                </div>
                <div class="agent-console-form-row">
                    <label>能力(逗号分隔)</label>
                    <input id="form-resource-capabilities" type="text" value="${this.escapeHtml((resource.capabilities || []).join(', '))}" placeholder="sdk_cli, traffic, counter">
                </div>
                <div class="agent-console-form-row">
                    <label>支持的芯片代系 (不勾=全部)</label>
                    <div id="form-resource-chips" class="agent-console-checkbox-group">
                        ${chipsCheckboxHtml}
                    </div>
                </div>
                <div class="agent-console-form-row">
                    <label>支持的模块 (不勾=全部)</label>
                    <div id="form-resource-modules" class="agent-console-checkbox-group">
                        ${modulesCheckboxHtml}
                    </div>
                </div>
                <div class="agent-console-form-row">
                    <label>连接配置(JSON)</label>
                    <textarea id="form-resource-conn" rows="3" placeholder='{"sdk_cli": "cmodel://localhost:9000"}'>${this.escapeHtml(JSON.stringify(resource.connectionProfiles || {}, null, 2))}</textarea>
                </div>
                <div class="agent-console-form-row">
                    <label>风险等级</label>
                    <select id="form-resource-risk">${riskOptions}</select>
                </div>
                ${isEdit ? `
                <div class="agent-console-form-row">
                    <label>状态</label>
                    <select id="form-resource-status">${statusOptions}</select>
                </div>` : ''}
            </div>
        `;
        const footer = [
            { label: isEdit ? '保存修改' : '创建资源', class: 'agent-console-btn', action: () => this.submitResourceForm(resourceId) }
        ];
        this.openModal(isEdit ? `编辑资源 - ${resourceId}` : '新增资源', body, footer);
    }

    async submitResourceForm(resourceId) {
        const parseList = (s) => (s || '').split(',').map(x => x.trim()).filter(Boolean);
        let connProfile = {};
        try {
            connProfile = JSON.parse(document.getElementById('form-resource-conn').value || '{}');
        } catch (e) { this.showToast('连接配置 JSON 格式错误', 'warning'); return; }
        const data = {
            displayName: document.getElementById('form-resource-name').value.trim(),
            resourceType: document.getElementById('form-resource-type').value,
            capabilities: parseList(document.getElementById('form-resource-capabilities').value),
            supportedChipVersions: Array.from(document.querySelectorAll('#form-resource-chips input[type="checkbox"]:checked')).map(el => el.value),
            supportedModules: Array.from(document.querySelectorAll('#form-resource-modules input[type="checkbox"]:checked')).map(el => el.value),
            connectionProfiles: connProfile,
            riskLevel: document.getElementById('form-resource-risk').value
        };
        if (!data.displayName || !data.resourceType) { this.showToast('显示名称和资源类型不能为空', 'warning'); return; }
        try {
            if (resourceId) {
                data.status = document.getElementById('form-resource-status')?.value;
                await this.apiRequest(`/agent-catalog/resources/${encodeURIComponent(resourceId)}`, {
                    method: 'PUT', body: JSON.stringify(data)
                });
                this.showToast('资源已更新', 'success');
            } else {
                data.resourceId = document.getElementById('form-resource-id').value.trim();
                if (!data.resourceId) { this.showToast('资源 ID 不能为空', 'warning'); return; }
                await this.apiRequest('/agent-catalog/resources', {
                    method: 'POST', body: JSON.stringify(data)
                });
                this.showToast('资源已创建', 'success');
            }
            this.closeModal();
            await this.loadResources();
            await this.loadDashboard();
        } catch (error) {
            this.showToast('保存失败：' + error.message, 'error');
        }
    }

    async deleteResource(resourceId) {
        const confirmed = await this.confirmDialog(`确定删除资源 ${resourceId}?`);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/agent-catalog/resources/${encodeURIComponent(resourceId)}`, { method: 'DELETE' });
            this.showToast('资源已删除', 'success');
            await this.loadResources();
            await this.loadDashboard();
        } catch (error) {
            this.showToast('删除失败：' + error.message, 'error');
        }
    }

    // ========== Part 5: 资源 Bundle 联合锁 ==========
    async loadBundles() {
        try {
            const response = await this.apiRequest('/resource-scheduler/bundles');
            const list = response.data || [];
            document.getElementById('agent-bundle-list').innerHTML = list.map(bundle => {
                const badgeClass = bundle.status === 'idle' ? 'agent-console-badge' : (bundle.status === 'leased' ? 'agent-console-badge agent-console-badge-warning' : 'agent-console-badge agent-console-badge-danger');
                const acquireBtn = bundle.status === 'idle'
                    ? `<button class="agent-console-small-btn bundle-acquire-btn" type="button" data-bundle-id="${this.escapeHtml(bundle.bundle_id)}">申请</button>`
                    : `<button class="agent-console-small-btn bundle-release-btn" type="button" data-bundle-id="${this.escapeHtml(bundle.bundle_id)}">释放</button>`;
                const adminActions = this.isAdminUser ? `
                    <button class="agent-console-small-btn bundle-detail-btn" type="button" data-bundle-id="${this.escapeHtml(bundle.bundle_id)}">详情</button>
                    <button class="agent-console-small-btn bundle-delete-btn" type="button" data-bundle-id="${this.escapeHtml(bundle.bundle_id)}" style="color:#dc2626;">删除</button>
                ` : '';
                return `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(bundle.display_name || bundle.bundle_id)}</div>
                            <div class="agent-console-row-subtitle">${this.escapeHtml(bundle.bundle_id)} · ${bundle.item_count}项 · ${(bundle.compatible_modules || []).join(', ') || '通用'}</div>
                        </div>
                        <div class="agent-console-row-actions">
                            <span class="${badgeClass}">${this.escapeHtml(bundle.status)}</span>
                            ${acquireBtn}
                            ${adminActions}
                        </div>
                    </div>
                `;
            }).join('') || this._renderEmpty('暂无 Bundle');
            document.querySelectorAll('.bundle-acquire-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showBundleAcquireForm(btn.dataset.bundleId));
            });
            document.querySelectorAll('.bundle-release-btn').forEach(btn => {
                btn.addEventListener('click', () => this.releaseBundle(btn.dataset.bundleId));
            });
            document.querySelectorAll('.bundle-detail-btn').forEach(btn => {
                btn.addEventListener('click', () => this.showBundleDetail(btn.dataset.bundleId));
            });
            document.querySelectorAll('.bundle-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => this.deleteBundle(btn.dataset.bundleId));
            });
        } catch (error) {
            document.getElementById('agent-bundle-list').innerHTML = `<div class="agent-console-row-subtitle" style="color:#dc2626;">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    async showBundleForm() {
        if (!this.isAdminUser) { this.showToast('需要管理员权限', 'error'); return; }
        let resources = [];
        try {
            const resp = await this.apiRequest('/resource-scheduler/resources');
            resources = resp.data || [];
        } catch (e) { /* 允许空 */ }
        this._bundleFormResources = resources;
        const resourceOptions = '<option value="">选择资源</option>' + resources.map(r => `<option value="${this.escapeHtml(r.resource_id)}">${this.escapeHtml(r.resource_id)} (${this.escapeHtml(r.resource_type)})</option>`).join('');
        const moduleCheckboxes = (this.modulesList || []).map(m => `
            <label class="agent-console-checkbox-item">
                <input type="checkbox" class="bundle-form-module" value="${this.escapeHtml(m.name)}">
                <span>${this.escapeHtml(m.name)}</span>
            </label>
        `).join('') || '<span style="color:#94a3b8;font-size:12px;">暂无模块</span>';
        const bodyHtml = `
            <div class="agent-console-form-group">
                <label>Bundle ID</label>
                <input id="bundle-form-id" type="text" placeholder="留空自动生成 (BUNDLE-xxx)">
            </div>
            <div class="agent-console-form-group">
                <label>显示名称 *</label>
                <input id="bundle-form-name" type="text" placeholder="例如:IXIA+DUT联合环境">
            </div>
            <div class="agent-console-form-group">
                <label>兼容模块 (不勾=通用)</label>
                <div class="agent-console-checkbox-group">${moduleCheckboxes}</div>
            </div>
            <div class="agent-console-form-group">
                <label>资源项</label>
                <div id="bundle-form-items-container"></div>
                <button class="agent-console-small-btn" type="button" id="bundle-form-add-item" style="margin-top:6px;">+ 添加资源项</button>
            </div>
        `;
        this.openModal('新增 Bundle', bodyHtml, [
            { label: '取消', class: 'agent-console-btn-secondary', action: () => this.closeModal() },
            { label: '保存', class: '', action: () => this.submitBundleForm() }
        ]);
        this._bundleFormResourceOptions = resourceOptions;
        this._bundleItemCount = 0;
        const addBtn = document.getElementById('bundle-form-add-item');
        if (addBtn) addBtn.addEventListener('click', () => this._addBundleItemRow(resourceOptions));
        // 默认添加一行
        this._addBundleItemRow(resourceOptions);
    }

    _addBundleItemRow(resourceOptions) {
        this._bundleItemCount++;
        const container = document.getElementById('bundle-form-items-container');
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'agent-console-bundle-item-row';
        row.innerHTML = `
            <select class="bundle-item-resource">${resourceOptions}</select>
            <input class="bundle-item-role" type="text" placeholder="角色如 dut">
            <button class="agent-console-small-btn bundle-item-remove" type="button" style="color:#dc2626;">✕</button>
        `;
        row.querySelector('.bundle-item-remove').addEventListener('click', () => row.remove());
        container.appendChild(row);
    }

    async submitBundleForm() {
        const bundleId = document.getElementById('bundle-form-id').value.trim();
        const displayName = document.getElementById('bundle-form-name').value.trim();
        if (!displayName) { this.showToast('显示名称不能为空', 'error'); return; }
        const compatibleModules = Array.from(document.querySelectorAll('.bundle-form-module:checked')).map(el => el.value);
        const rows = document.querySelectorAll('#bundle-form-items-container .agent-console-detail-row');
        const items = [];
        const cleanupSequence = [];
        rows.forEach((row, i) => {
            const resourceId = row.querySelector('.bundle-item-resource').value;
            const role = row.querySelector('.bundle-item-role').value.trim() || null;
            if (resourceId) {
                items.push({ resourceId, role, sortOrder: i });
                cleanupSequence.push(resourceId);
            }
        });
        if (items.length === 0) { this.showToast('至少需要一个资源项', 'error'); return; }
        try {
            await this.apiRequest('/resource-scheduler/bundles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bundleId: bundleId || undefined,
                    displayName,
                    compatibleModules,
                    cleanupSequence,
                    items
                })
            });
            this.showToast('Bundle 已创建', 'success');
            this.closeModal();
            await this.loadBundles();
        } catch (error) {
            this.showToast('创建失败: ' + error.message, 'error');
        }
    }

    async showBundleDetail(bundleId) {
        try {
            const response = await this.apiRequest(`/resource-scheduler/bundles/${encodeURIComponent(bundleId)}`);
            const bundle = response.data;
            if (!bundle) { this.showToast('Bundle不存在', 'error'); return; }
            const itemsHtml = (bundle.items || []).map((item, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${this.escapeHtml(item.resource_id)}</td>
                    <td>${this.escapeHtml(item.role || '-')}</td>
                    <td>${item.sort_order}</td>
                </tr>
            `).join('');
            const bodyHtml = `
                <div class="agent-console-form-group">
                    <label>Bundle ID</label>
                    <div>${this.escapeHtml(bundle.bundle_id)}</div>
                </div>
                <div class="agent-console-form-group">
                    <label>显示名称</label>
                    <div>${this.escapeHtml(bundle.display_name)}</div>
                </div>
                <div class="agent-console-form-group">
                    <label>状态</label>
                    <div>${this.escapeHtml(bundle.status)}</div>
                </div>
                <div class="agent-console-form-group">
                    <label>兼容模块</label>
                    <div>${this.escapeHtml((bundle.compatible_modules || []).join(', ') || '-')}</div>
                </div>
                <div class="agent-console-form-group">
                    <label>清理顺序</label>
                    <div>${this.escapeHtml((bundle.cleanup_sequence || []).join(' → ') || '-')}</div>
                </div>
                <div class="agent-console-form-group">
                    <label>资源项 (${(bundle.items || []).length})</label>
                    <table class="agent-console-table" style="width:100%;border-collapse:collapse;margin-top:6px;">
                        <thead><tr style="background:#f3f4f6;"><th style="padding:6px;">#</th><th>资源ID</th><th>角色</th><th>顺序</th></tr></thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                </div>
            `;
            this.openModal(`Bundle 详情: ${bundleId}`, bodyHtml, [
                { label: '关闭', class: 'agent-console-btn-secondary', action: () => this.closeModal() }
            ]);
        } catch (error) {
            this.showToast('加载详情失败: ' + error.message, 'error');
        }
    }

    showBundleAcquireForm(bundleId) {
        const bodyHtml = `
            <div class="agent-console-form-group">
                <label>Bundle ID</label>
                <div>${this.escapeHtml(bundleId)}</div>
            </div>
            <div class="agent-console-form-group">
                <label>TTL (分钟) *</label>
                <input id="bundle-acquire-ttl" type="number" value="60" min="5" max="1440">
            </div>
            <div class="agent-console-form-group">
                <label>Task ID</label>
                <input id="bundle-acquire-taskid" type="text" placeholder="留空自动生成">
            </div>
            <div class="agent-console-form-group">
                <label>模块</label>
                <input id="bundle-acquire-module" type="text" placeholder="MODULE_A">
            </div>
            <div class="agent-console-form-group">
                <label>模式</label>
                <select id="bundle-acquire-mode">
                    <option value="dry_run">dry_run</option>
                    <option value="execute">execute</option>
                    <option value="autonomous">autonomous</option>
                </select>
            </div>
        `;
        this.openModal(`申请 Bundle: ${bundleId}`, bodyHtml, [
            { label: '取消', class: 'agent-console-btn-secondary', action: () => this.closeModal() },
            { label: '申请', class: '', action: () => this.submitBundleAcquire(bundleId) }
        ]);
    }

    async submitBundleAcquire(bundleId) {
        const ttlMinutes = parseInt(document.getElementById('bundle-acquire-ttl').value) || 60;
        const taskId = document.getElementById('bundle-acquire-taskid').value.trim() || undefined;
        const module = document.getElementById('bundle-acquire-module').value.trim() || undefined;
        const mode = document.getElementById('bundle-acquire-mode').value;
        try {
            const response = await this.apiRequest(`/resource-scheduler/bundles/${encodeURIComponent(bundleId)}/acquire`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ttlMinutes, taskId, module, mode })
            });
            if (response.data && response.data.acquired) {
                this.showToast(`Bundle 已申请成功, 租约: ${response.data.leaseId}, 锁定 ${response.data.resourceCount} 个资源`, 'success');
                this.closeModal();
                await this.loadBundles();
                await this.loadResources();
            } else {
                this.showToast(`申请失败: ${response.data?.reason || '未知原因'} (${response.data?.resourceId || ''})`, 'error');
            }
        } catch (error) {
            this.showToast('申请失败: ' + error.message, 'error');
        }
    }

    async releaseBundle(bundleId) {
        // 先查询 leases 找到对应 bundle 的 active lease
        const confirmed = await this.confirmDialog(`确定释放 Bundle ${bundleId}?`);
        if (!confirmed) return;
        try {
            const leaseResponse = await this.apiRequest('/resource-scheduler/leases?status=active');
            const leases = leaseResponse.data || [];
            const targetLease = leases.find(l => l.bundle_id === bundleId);
            if (!targetLease) { this.showToast('未找到该 Bundle 的 active lease', 'error'); return; }
            await this.apiRequest(`/resource-scheduler/bundles/release/${encodeURIComponent(targetLease.lease_id)}`, { method: 'POST' });
            this.showToast(`Bundle 已释放, ${targetLease.lease_id}`, 'success');
            await this.loadBundles();
            await this.loadResources();
        } catch (error) {
            this.showToast('释放失败: ' + error.message, 'error');
        }
    }

    async deleteBundle(bundleId) {
        const confirmed = await this.confirmDialog(`确定删除 Bundle ${bundleId}?`);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/resource-scheduler/bundles/${encodeURIComponent(bundleId)}`, { method: 'DELETE' });
            this.showToast('Bundle 已删除', 'success');
            await this.loadBundles();
        } catch (error) {
            this.showToast('删除失败: ' + error.message, 'error');
        }
    }

    // ========== Part 6: EDA 预约 / 配额 / 抢占 ==========
    async loadReservations() {
        try {
            const response = await this.apiRequest('/resource-scheduler/reservations');
            const list = response.data || [];
            document.getElementById('agent-reservation-list').innerHTML = list.map(r => {
                const badgeClass = r.status === 'confirmed' ? 'agent-console-badge' : (r.status === 'in_progress' ? 'agent-console-badge agent-console-badge-warning' : (r.status === 'cancelled' ? 'agent-console-badge agent-console-badge-danger' : 'agent-console-badge'));
                const priorityLabel = r.priority >= 80 ? `P${r.priority}` : `P${r.priority}`;
                return `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(r.resource_id)} <span style="color:#6b7280;font-size:12px;">[${priorityLabel}]</span></div>
                            <div class="agent-console-row-subtitle">${this.escapeHtml(r.reservation_id)} · ${this.formatDateTime(r.start_time)} → ${this.formatDateTime(r.end_time)} · ${this.escapeHtml(r.task_type)}</div>
                        </div>
                        <div class="agent-console-row-actions">
                            <span class="${badgeClass}">${this.escapeHtml(r.status)}</span>
                            ${['pending','confirmed','in_progress'].includes(r.status) ? `<button class="agent-console-small-btn reservation-cancel-btn" type="button" data-reservation-id="${this.escapeHtml(r.reservation_id)}">取消</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('') || this._renderEmpty('暂无预约');
            document.querySelectorAll('.reservation-cancel-btn').forEach(btn => {
                btn.addEventListener('click', () => this.cancelReservation(btn.dataset.reservationId));
            });
        } catch (error) {
            document.getElementById('agent-reservation-list').innerHTML = `<div class="agent-console-row-subtitle" style="color:#dc2626;">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    async showReservationForm() {
        const now = new Date();
        const later = new Date(now.getTime() + 60 * 60000);
        const fmt = d => d.toISOString().slice(0, 16);
        let resources = [];
        try {
            const resp = await this.apiRequest('/resource-scheduler/resources');
            resources = resp.data || [];
        } catch (e) { /* 允许空 */ }
        const resourceOptions = '<option value="">选择资源</option>' + resources.map(r => `<option value="${this.escapeHtml(r.resource_id)}">${this.escapeHtml(r.resource_id)} (${this.escapeHtml(r.resource_type)})</option>`).join('');
        const taskTypeOptions = (this.catalog.task_type || []).map(t => `<option value="${this.escapeHtml(t.item_key)}"${t.item_key === 'normal_execute' ? ' selected' : ''}>${this.escapeHtml(t.item_label)}</option>`).join('');
        const bodyHtml = `
            <div class="agent-console-form-group">
                <label>资源 *</label>
                <select id="reservation-resource-id">${resourceOptions}</select>
            </div>
            <div class="agent-console-form-group">
                <label>开始时间 *</label>
                <input id="reservation-start" type="datetime-local" value="${fmt(now)}">
            </div>
            <div class="agent-console-form-group">
                <label>结束时间 *</label>
                <input id="reservation-end" type="datetime-local" value="${fmt(later)}">
            </div>
            <div class="agent-console-form-group">
                <label>任务类型</label>
                <select id="reservation-task-type">${taskTypeOptions}</select>
            </div>
            <div class="agent-console-form-group">
                <label>备注</label>
                <textarea id="reservation-notes" rows="3" placeholder="可选"></textarea>
            </div>
        `;
        this.openModal('新增预约', bodyHtml, [
            { label: '取消', class: 'agent-console-btn-secondary', action: () => this.closeModal() },
            { label: '提交', class: '', action: () => this.submitReservationForm() }
        ]);
    }

    async submitReservationForm() {
        const resourceId = document.getElementById('reservation-resource-id').value;
        const startTime = document.getElementById('reservation-start').value;
        const endTime = document.getElementById('reservation-end').value;
        const taskType = document.getElementById('reservation-task-type').value;
        const notes = document.getElementById('reservation-notes').value.trim();
        if (!resourceId) { this.showToast('请选择资源', 'error'); return; }
        if (!startTime || !endTime) { this.showToast('开始/结束时间不能为空', 'error'); return; }
        try {
            const response = await this.apiRequest('/resource-scheduler/reservations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resourceId, startTime, endTime, taskType, notes })
            });
            if (response.success) {
                this.showToast(`预约成功: ${response.data.reservationId} (优先级 ${response.data.priority})`, 'success');
                this.closeModal();
                await this.loadReservations();
            } else {
                this.showToast('预约失败: ' + (response.message || '未知'), 'error');
            }
        } catch (error) {
            this.showToast('预约失败: ' + error.message, 'error');
        }
    }

    async cancelReservation(reservationId) {
        const confirmed = await this.confirmDialog(`确定取消预约 ${reservationId}?`);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/resource-scheduler/reservations/${encodeURIComponent(reservationId)}/cancel`, { method: 'POST' });
            this.showToast('预约已取消', 'success');
            await this.loadReservations();
        } catch (error) {
            this.showToast('取消失败: ' + error.message, 'error');
        }
    }

    async showQuotaPanel() {
        try {
            const response = await this.apiRequest('/resource-scheduler/quota');
            const list = response.data || [];
            const rowsHtml = list.map(q => {
                const used = q.used_today_minutes || 0;
                const total = q.daily_quota_minutes || 120;
                const pct = total > 0 ? Math.min(100, Math.round(used / total * 100)) : 0;
                const pctColor = pct >= 100 ? '#dc2626' : (pct >= 80 ? '#f59e0b' : '#10b981');
                return `
                    <tr>
                        <td>${this.escapeHtml(q.username || q.user_id || '-')}</td>
                        <td>${this.escapeHtml(q.resource_type)}</td>
                        <td>${used} / ${total} 分钟</td>
                        <td>
                            <div class="agent-console-progress">
                                <div class="agent-console-progress-bar" style="background:${pctColor};width:${pct}%;"></div>
                            </div>
                            <span style="margin-left:6px;font-size:12px;color:${pctColor};font-weight:600;">${pct}%</span>
                        </td>
                        <td>${this.escapeHtml(q.quota_date)}</td>
                    </tr>
                `;
            }).join('');
            // 加载用户列表用于下拉选择
            let usersOptions = '<option value="">选择用户</option>';
            try {
                const usersResp = await this.apiRequest('/users/list');
                const users = usersResp.users || usersResp.data || [];
                usersOptions += users.map(u => `<option value="${u.id}">${this.escapeHtml(u.username || u.name || ('用户' + u.id))}</option>`).join('');
            } catch (e) { /* 允许为空 */ }
            // 资源类型从 catalog 加载
            const resourceTypes = this.catalog.resource_type || [];
            const resourceTypeOptions = '<option value="">选择资源类型</option>' + resourceTypes.map(t => `<option value="${this.escapeHtml(t.item_key)}">${this.escapeHtml(t.item_label)}</option>`).join('');
            const adminQuotaForm = this.isAdminUser ? `
                <hr class="agent-console-divider">
                <h4 class="agent-console-section-title">⚙️ 设置用户配额</h4>
                <div class="agent-console-form-group">
                    <label>用户 *</label>
                    <select id="quota-set-user-id">${usersOptions}</select>
                </div>
                <div class="agent-console-form-group">
                    <label>资源类型 *</label>
                    <select id="quota-set-resource-type">${resourceTypeOptions}</select>
                </div>
                <div class="agent-console-form-group">
                    <label>日配额 (分钟)</label>
                    <input id="quota-set-daily" type="number" value="120" min="0">
                </div>
                <button class="agent-console-btn" id="quota-set-btn" type="button">保存配额</button>
            ` : '';
            const bodyHtml = `
                <h4 class="agent-console-section-title">📊 今日配额使用情况</h4>
                <table class="agent-console-table">
                    <thead><tr><th>用户</th><th>资源类型</th><th>已用/总额</th><th>使用率</th><th>日期</th></tr></thead>
                    <tbody>${rowsHtml || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#94a3b8;">暂无配额记录</td></tr>'}</tbody>
                </table>
                ${adminQuotaForm}
            `;
            this.openModal('资源配额', bodyHtml, [
                { label: '关闭', class: 'agent-console-btn-secondary', action: () => this.closeModal() }
            ]);
            if (this.isAdminUser) {
                document.getElementById('quota-set-btn')?.addEventListener('click', () => this.submitQuotaSet());
            }
        } catch (error) {
            this.showToast('加载配额失败: ' + error.message, 'error');
        }
    }

    async submitQuotaSet() {
        const userId = parseInt(document.getElementById('quota-set-user-id').value);
        const resourceType = document.getElementById('quota-set-resource-type').value;
        const dailyQuotaMinutes = parseInt(document.getElementById('quota-set-daily').value) || 120;
        if (!userId || !resourceType) { this.showToast('请选择用户和资源类型', 'error'); return; }
        try {
            await this.apiRequest('/resource-scheduler/quota', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, resourceType, dailyQuotaMinutes })
            });
            this.showToast('配额已保存', 'success');
            this.closeModal();
            await this.showQuotaPanel();
        } catch (error) {
            this.showToast('保存失败: ' + error.message, 'error');
        }
    }

    // ========== 芯片代系 / 模块 管理 ==========

    /**
     * 统一管理弹窗：左侧芯片代系树，右侧模块列表
     */
    async showChipModuleManager() {
        const bodyHtml = `
            <div class="cm-manager">
                <div class="cm-toolbar">
                    <button class="agent-console-small-btn cm-add-chip-btn" type="button">+ 新增芯片代系</button>
                    <button class="agent-console-small-btn cm-add-module-btn" type="button" style="margin-left:6px;" disabled>+ 新增模块</button>
                    <span class="cm-hint">点击左侧芯片代系查看其下属模块</span>
                </div>
                <div class="cm-body">
                    <div class="cm-left" id="cm-chip-list">
                        <div style="padding:20px;text-align:center;color:#94a3b8;">加载中...</div>
                    </div>
                    <div class="cm-right" id="cm-module-area">
                        <div style="padding:40px 20px;text-align:center;color:#94a3b8;">
                            <div style="font-size:28px;margin-bottom:8px;">👈</div>
                            <div>请选择左侧的芯片代系</div>
                            <div style="font-size:12px;margin-top:4px;">选中后可管理其下属模块</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        this.openModal('芯片代系 & 模块管理', bodyHtml, [
            { label: '关闭', class: 'agent-console-btn-secondary', action: () => this.closeModal() }
        ]);
        // 绑定按钮
        document.querySelector('.cm-add-chip-btn')?.addEventListener('click', () => this.showChipVersionForm(null));
        document.querySelector('.cm-add-module-btn')?.addEventListener('click', () => this.showModuleForm(null, this._selectedChipId));
        // 加载芯片列表
        await this._renderChipModuleTree();
    }

    /**
     * 渲染芯片代系树（左侧）
     */
    async _renderChipModuleTree() {
        const container = document.getElementById('cm-chip-list');
        if (!container) return;
        try {
            const response = await this.apiRequest('/chip-versions?includeInactive=true');
            const list = response.data || [];
            this.chipVersions = list;
            // 渲染"通用(不指定)"虚拟节点 + 各芯片代系
            let html = `<div class="cm-chip-item ${!this._selectedChipId ? 'active' : ''}" data-chip-id="">`;
            html += `<span class="cm-chip-icon">🌐</span><span class="cm-chip-name">通用(不指定)</span></div>`;
            for (const chip of list) {
                const active = String(this._selectedChipId) === String(chip.id) ? 'active' : '';
                html += `<div class="cm-chip-item ${active}" data-chip-id="${chip.id}">`;
                html += `<span class="cm-chip-icon">🔩</span>`;
                html += `<span class="cm-chip-name">${this.escapeHtml(chip.name)}</span>`;
                html += `<span class="cm-chip-key">${this.escapeHtml(chip.version_key)}</span>`;
                html += `<div class="cm-chip-actions">`;
                html += `<button class="cm-mini-btn cm-chip-edit" data-chip-id="${chip.id}" title="编辑">✏️</button>`;
                if (this.isAdminUser) html += `<button class="cm-mini-btn cm-chip-del" data-chip-id="${chip.id}" data-chip-name="${this.escapeHtml(chip.name)}" title="删除">🗑️</button>`;
                html += `</div></div>`;
            }
            container.innerHTML = html;
            // 绑定点击：选中芯片 -> 加载模块
            container.querySelectorAll('.cm-chip-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.cm-chip-actions')) return; // 点编辑/删除不触发选中
                    const chipId = item.dataset.chipId;
                    this._selectedChipId = chipId || null;
                    container.querySelectorAll('.cm-chip-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                    this._renderModulesForChip(chipId || null);
                    document.querySelector('.cm-add-module-btn')?.removeAttribute('disabled');
                });
            });
            // 编辑/删除按钮
            container.querySelectorAll('.cm-chip-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const chip = list.find(c => String(c.id) === btn.dataset.chipId);
                    this.showChipVersionForm(chip);
                });
            });
            container.querySelectorAll('.cm-chip-del').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteChipVersion(btn.dataset.chipId, btn.dataset.chipName).then(() => this._renderChipModuleTree());
                });
            });
        } catch (error) {
            container.innerHTML = `<div style="padding:10px;color:#dc2626;">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    /**
     * 渲染某个芯片代系下的模块列表（右侧）
     */
    async _renderModulesForChip(chipId) {
        const container = document.getElementById('cm-module-area');
        if (!container) return;
        try {
            const response = await this.apiRequest('/agent-console/modules/list');
            const allModules = response.data || [];
            this.modulesList = allModules;
            // 按芯片代系过滤：如果 chipId 为空，显示未关联芯片代系的模块
            const modules = chipId
                ? allModules.filter(m => String(m.chip_version_id) === String(chipId))
                : allModules.filter(m => !m.chip_version_id);
            const chipName = chipId
                ? (this.chipVersions.find(c => String(c.id) === String(chipId))?.name || '未知')
                : '通用';
            let html = `<div class="cm-module-header">`;
            html += `<span class="cm-module-title">${this.escapeHtml(chipName)} 的模块</span>`;
            html += `<span class="cm-module-count">${modules.length} 个</span>`;
            html += `</div>`;
            if (modules.length === 0) {
                html += `<div style="padding:30px;text-align:center;color:#94a3b8;">`;
                html += `<div style="font-size:24px;margin-bottom:6px;">📦</div>`;
                html += `该芯片代系下暂无模块<br>`;
                html += `<span style="font-size:12px;">点击上方"新增模块"添加</span></div>`;
            } else {
                html += `<div class="cm-module-list">`;
                for (const m of modules) {
                    html += `<div class="cm-module-item">`;
                    html += `<div class="cm-module-info">`;
                    html += `<div class="cm-module-name">${this.escapeHtml(m.name)}</div>`;
                    html += `<div class="cm-module-sub">${this.escapeHtml(m.module_id || '')}${m.taxonomy_path ? ' · ' + this.escapeHtml(m.taxonomy_path) : ''}</div>`;
                    html += `</div>`;
                    html += `<div class="cm-module-actions">`;
                    html += `<button class="cm-mini-btn cm-module-edit" data-module-id="${m.id}" title="编辑">✏️</button>`;
                    if (this.isAdminUser) html += `<button class="cm-mini-btn cm-module-del" data-module-id="${m.id}" data-module-name="${this.escapeHtml(m.name)}" title="删除">🗑️</button>`;
                    html += `</div></div>`;
                }
                html += `</div>`;
            }
            container.innerHTML = html;
            // 绑定编辑/删除
            container.querySelectorAll('.cm-module-edit').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mod = allModules.find(mo => String(mo.id) === btn.dataset.moduleId);
                    this.showModuleForm(mod, chipId);
                });
            });
            container.querySelectorAll('.cm-module-del').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.deleteModule(btn.dataset.moduleId, btn.dataset.moduleName).then(() => this._renderModulesForChip(chipId));
                });
            });
        } catch (error) {
            container.innerHTML = `<div style="padding:10px;color:#dc2626;">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    async showChipVersionManager() {
        await this._renderChipVersionList();
        const bodyHtml = `
            <div id="chip-version-manager-list"></div>
            <button class="agent-console-btn" id="chip-version-add-btn" type="button" style="margin-top:10px;">+ 新增芯片代系</button>
        `;
        this.openModal('芯片代系管理', bodyHtml, [
            { label: '关闭', class: 'agent-console-btn-secondary', action: () => this.closeModal() }
        ]);
        document.getElementById('chip-version-add-btn')?.addEventListener('click', () => this.showChipVersionForm(null));
    }

    async _renderChipVersionList() {
        const container = document.getElementById('chip-version-manager-list');
        if (!container) return;
        try {
            const response = await this.apiRequest('/chip-versions?includeInactive=true');
            const list = response.data || [];
            this.chipVersions = list;
            container.innerHTML = list.length === 0
                ? '<div style="padding:10px;color:#94a3b8;">暂无芯片代系</div>'
                : list.map(chip => `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(chip.name)} <span style="color:#64748b;font-size:12px;">[${this.escapeHtml(chip.version_key)}]</span></div>
                            <div class="agent-console-row-subtitle">顺序:${chip.generation_order ?? 0} · ${chip.parent_name ? '继承:' + this.escapeHtml(chip.parent_name) : '无继承'} · ${this.escapeHtml(chip.status || 'active')}</div>
                        </div>
                        <div class="agent-console-row-actions">
                            <button class="agent-console-small-btn chip-edit-btn" type="button" data-chip-id="${chip.id}">编辑</button>
                            ${this.isAdminUser ? `<button class="agent-console-small-btn chip-delete-btn" type="button" data-chip-id="${chip.id}" data-chip-name="${this.escapeHtml(chip.name)}" style="color:#dc2626;">删除</button>` : ''}
                        </div>
                    </div>
                `).join('');
            container.querySelectorAll('.chip-edit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const chip = list.find(c => String(c.id) === btn.dataset.chipId);
                    this.showChipVersionForm(chip);
                });
            });
            container.querySelectorAll('.chip-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => this.deleteChipVersion(btn.dataset.chipId, btn.dataset.chipName));
            });
        } catch (error) {
            container.innerHTML = `<div style="padding:10px;color:#dc2626;">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    showChipVersionForm(chip) {
        const isEdit = !!chip;
        const parentOptions = '<option value="">无继承(顶层)</option>' +
            (this.chipVersions || []).filter(c => !chip || c.id !== chip.id).map(c =>
                `<option value="${c.id}" ${chip && chip.parent_id === c.id ? 'selected' : ''}>${this.escapeHtml(c.name)} [${this.escapeHtml(c.version_key)}]</option>`
            ).join('');
        const bodyHtml = `
            <div class="agent-console-form">
                <div class="agent-console-form-row">
                    <label>标识 (version_key) *</label>
                    <input id="chip-form-key" type="text" value="${chip ? this.escapeHtml(chip.version_key) : ''}" placeholder="例如 Switch_Gen3_RevB">
                </div>
                <div class="agent-console-form-row">
                    <label>名称 *</label>
                    <input id="chip-form-name" type="text" value="${chip ? this.escapeHtml(chip.name) : ''}" placeholder="例如 Switch Gen3 RevB">
                </div>
                <div class="agent-console-form-row">
                    <label>代系顺序 (数字越小越靠前)</label>
                    <input id="chip-form-order" type="number" value="${chip ? (chip.generation_order ?? 0) : 0}">
                </div>
                <div class="agent-console-form-row">
                    <label>继承自</label>
                    <select id="chip-form-parent">${parentOptions}</select>
                </div>
                <div class="agent-console-form-row">
                    <label>状态</label>
                    <select id="chip-form-status">
                        <option value="active" ${chip && chip.status === 'active' ? 'selected' : ''}>启用</option>
                        <option value="inactive" ${chip && chip.status === 'inactive' ? 'selected' : ''}>停用</option>
                    </select>
                </div>
                <div class="agent-console-form-row">
                    <label>描述</label>
                    <textarea id="chip-form-desc" rows="2">${chip ? this.escapeHtml(chip.description || '') : ''}</textarea>
                </div>
            </div>
        `;
        this.openModal(isEdit ? '编辑芯片代系' : '新增芯片代系', bodyHtml, [
            { label: '取消', class: 'agent-console-btn-secondary', action: () => this.closeModal() },
            { label: '保存', class: '', action: () => this.submitChipVersionForm(chip?.id) }
        ]);
    }

    async submitChipVersionForm(chipId) {
        const data = {
            versionKey: document.getElementById('chip-form-key').value.trim(),
            name: document.getElementById('chip-form-name').value.trim(),
            generationOrder: parseInt(document.getElementById('chip-form-order').value) || 0,
            parentId: document.getElementById('chip-form-parent').value || null,
            status: document.getElementById('chip-form-status').value,
            description: document.getElementById('chip-form-desc').value.trim() || null
        };
        if (!data.versionKey || !data.name) { this.showToast('标识和名称不能为空', 'error'); return; }
        try {
            if (chipId) {
                await this.apiRequest(`/chip-versions/${chipId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
                this.showToast('芯片代系已更新', 'success');
            } else {
                await this.apiRequest('/chip-versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
                this.showToast('芯片代系已创建', 'success');
            }
            this.closeModal();
            // 刷新统一管理弹窗的树（如果打开的话）和下拉框
            if (document.getElementById('cm-chip-list')) await this._renderChipModuleTree();
            await this._renderChipVersionList?.();
            await this.loadChipVersions();
        } catch (error) {
            this.showToast('保存失败: ' + error.message, 'error');
        }
    }

    async deleteChipVersion(chipId, chipName) {
        const confirmed = await this.confirmDialog(`确定删除芯片代系 "${chipName}"?\n如果有知识/测试点/用例绑定将无法删除。`);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/chip-versions/${chipId}`, { method: 'DELETE' });
            this.showToast('芯片代系已删除', 'success');
            await this._renderChipVersionList();
            await this.loadChipVersions();
        } catch (error) {
            this.showToast('删除失败: ' + error.message, 'error');
        }
    }

    async showModuleManager() {
        await this._renderModuleList();
        const bodyHtml = `
            <div id="module-manager-list"></div>
            <button class="agent-console-btn" id="module-add-btn" type="button" style="margin-top:10px;">+ 新增模块</button>
        `;
        this.openModal('模块管理', bodyHtml, [
            { label: '关闭', class: 'agent-console-btn-secondary', action: () => this.closeModal() }
        ]);
        document.getElementById('module-add-btn')?.addEventListener('click', () => this.showModuleForm(null));
    }

    async _renderModuleList() {
        const container = document.getElementById('module-manager-list');
        if (!container) return;
        try {
            const response = await this.apiRequest('/agent-console/modules/list');
            const list = response.data || [];
            this.modulesList = list;
            container.innerHTML = list.length === 0
                ? '<div style="padding:10px;color:#94a3b8;">暂无模块</div>'
                : list.map(m => `
                    <div class="agent-console-row">
                        <div>
                            <div class="agent-console-row-title">${this.escapeHtml(m.name)} <span style="color:#64748b;font-size:12px;">[${this.escapeHtml(m.module_id || '')}]</span></div>
                            <div class="agent-console-row-subtitle">${m.taxonomy_path ? '分类:' + this.escapeHtml(m.taxonomy_path) : '未分类'}</div>
                        </div>
                        <div class="agent-console-row-actions">
                            <button class="agent-console-small-btn module-edit-btn" type="button" data-module-id="${m.id}">编辑</button>
                            ${this.isAdminUser ? `<button class="agent-console-small-btn module-delete-btn" type="button" data-module-id="${m.id}" data-module-name="${this.escapeHtml(m.name)}" style="color:#dc2626;">删除</button>` : ''}
                        </div>
                    </div>
                `).join('');
            container.querySelectorAll('.module-edit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mod = list.find(mo => String(mo.id) === btn.dataset.moduleId);
                    this.showModuleForm(mod);
                });
            });
            container.querySelectorAll('.module-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => this.deleteModule(btn.dataset.moduleId, btn.dataset.moduleName));
            });
        } catch (error) {
            container.innerHTML = `<div style="padding:10px;color:#dc2626;">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    showModuleForm(mod, chipVersionId = null) {
        const isEdit = !!mod;
        const effectiveChipId = mod?.chip_version_id || chipVersionId || '';
        // 芯片代系下拉选项
        const chipOptions = '<option value="">通用(不指定)</option>' +
            (this.chipVersions || []).map(c =>
                `<option value="${c.id}" ${String(effectiveChipId) === String(c.id) ? 'selected' : ''}>${this.escapeHtml(c.name)} [${this.escapeHtml(c.version_key)}]</option>`
            ).join('');
        const bodyHtml = `
            <div class="agent-console-form">
                <div class="agent-console-form-row">
                    <label>所属芯片代系</label>
                    <select id="module-form-chip">${chipOptions}</select>
                </div>
                <div class="agent-console-form-row">
                    <label>模块名称 *</label>
                    <input id="module-form-name" type="text" value="${mod ? this.escapeHtml(mod.name) : ''}" placeholder="例如 PFC">
                </div>
                <div class="agent-console-form-row">
                    <label>模块标识 (module_id)</label>
                    <input id="module-form-id" type="text" value="${mod ? this.escapeHtml(mod.module_id || '') : ''}" placeholder="例如 PFC(留空自动生成)">
                </div>
                <div class="agent-console-form-row">
                    <label>分类路径 (taxonomy_path)</label>
                    <input id="module-form-taxonomy" type="text" value="${mod ? this.escapeHtml(mod.taxonomy_path || '') : ''}" placeholder="例如 Front-end/PFC">
                </div>
            </div>
        `;
        this.openModal(isEdit ? '编辑模块' : '新增模块', bodyHtml, [
            { label: '取消', class: 'agent-console-btn-secondary', action: () => this.closeModal() },
            { label: '保存', class: '', action: () => this.submitModuleForm(mod?.id) }
        ]);
    }

    async submitModuleForm(moduleId) {
        const name = document.getElementById('module-form-name').value.trim();
        if (!name) { this.showToast('模块名称不能为空', 'error'); return; }
        const data = {
            name,
            moduleId: document.getElementById('module-form-id').value.trim() || undefined,
            taxonomyPath: document.getElementById('module-form-taxonomy').value.trim() || null,
            chipVersionId: document.getElementById('module-form-chip')?.value || null
        };
        try {
            if (moduleId) {
                await this.apiRequest('/modules/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: moduleId, ...data })
                });
                this.showToast('模块已更新', 'success');
            } else {
                await this.apiRequest('/modules/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                this.showToast('模块已创建', 'success');
            }
            this.closeModal();
            // 刷新统一管理弹窗的模块列表（如果打开的话）
            if (document.getElementById('cm-module-area') && this._selectedChipId !== undefined) {
                await this._renderModulesForChip(this._selectedChipId);
            }
            await this._renderModuleList?.();
            this.renderModuleSelect();
        } catch (error) {
            this.showToast('保存失败: ' + error.message, 'error');
        }
    }

    async deleteModule(moduleId, moduleName) {
        const confirmed = await this.confirmDialog(`确定删除模块 "${moduleName}"?`);
        if (!confirmed) return;
        try {
            await this.apiRequest('/modules/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: moduleId })
            });
            this.showToast('模块已删除', 'success');
            await this._renderModuleList();
            this.renderModuleSelect();
        } catch (error) {
            this.showToast('删除失败: ' + error.message, 'error');
        }
    }

    // ========== 模态框 ==========
    openModal(title, bodyHtml, footerButtons) {
        document.getElementById('agent-console-modal-title').textContent = title;
        document.getElementById('agent-console-modal-body').innerHTML = bodyHtml;
        const footer = document.getElementById('agent-console-modal-footer');
        footer.innerHTML = '';
        footerButtons.forEach(btn => {
            const el = document.createElement('button');
            el.className = `agent-console-btn ${btn.class || ''}`;
            el.textContent = btn.label;
            el.type = 'button';
            el.addEventListener('click', btn.action);
            footer.appendChild(el);
        });
        document.getElementById('agent-console-modal').style.display = 'flex';
    }

    closeModal() {
        document.getElementById('agent-console-modal').style.display = 'none';
    }

    // ========== 工具方法 ==========
    showToast(message, type = 'success') {
        const container = document.getElementById('agent-console-toast-container');
        const el = document.createElement('div');
        el.className = `agent-console-toast agent-console-toast-${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    formatDateTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        // 转换为北京时间 (UTC+8)
        const beijingTime = new Date(date.getTime() + (date.getTimezoneOffset() + 480) * 60000);
        const pad = n => String(n).padStart(2, '0');
        return `${beijingTime.getFullYear()}/${pad(beijingTime.getMonth() + 1)}/${pad(beijingTime.getDate())} ${pad(beijingTime.getHours())}:${pad(beijingTime.getMinutes())}`;
    }

    // ========== Pipeline 调度中心 ==========

    pipelineAutoRefresh = true;
    pipelinePollingTimer = null;
    pipelineCurrentTaskId = null;
    pipelineCurrentTab = 'timeline';
    pipelineFilters = { status: 'active', mode: '', moduleId: '' };

    async loadPipelineBoard() {
        const container = document.getElementById('pipeline-board');
        if (!container) return;
        try {
            const params = new URLSearchParams();
            if (this.pipelineFilters.status) params.set('status', this.pipelineFilters.status);
            if (this.pipelineFilters.mode) params.set('mode', this.pipelineFilters.mode);
            if (this.pipelineFilters.moduleId) params.set('moduleId', this.pipelineFilters.moduleId);
            params.set('limit', '30');
            const json = await this.apiRequest(`/api/agent-pipeline/board?${params.toString()}`);
            const data = json.data || {};
            this.renderPipelineSummary(data.summary || {});
            this.renderPipelineFilters();
            this.renderPipelineBoard(data.stages || [], data.tasks || []);
            this.renderPipelineAgentBar(data.agents || []);
            this.initPipelineSocket();
        } catch (error) {
            container.innerHTML = `<div class="pipeline-empty-stage">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    renderPipelineSummary(summary) {
        const bar = document.getElementById('pipeline-summary-bar');
        if (!bar) return;
        bar.innerHTML = `
            <div class="pipeline-summary-item running"><span class="val">${summary.running || 0}</span> 运行中</div>
            <div class="pipeline-summary-item blocked"><span class="val">${summary.blocked || 0}</span> 阻塞</div>
            <div class="pipeline-summary-item completed"><span class="val">${summary.completed || 0}</span> 已完成</div>
            <div class="pipeline-summary-item failed"><span class="val">${summary.failed || 0}</span> 失败</div>
        `;
    }

    renderPipelineFilters() {
        const bar = document.getElementById('pipeline-filters');
        if (!bar || bar.dataset.initialized) return;
        bar.dataset.initialized = '1';
        bar.innerHTML = `
            <div class="ac-filter-group">
                <span class="ac-filter-icon">⚡</span>
                <select id="pipeline-filter-status" class="ac-filter-select">
                    <option value="active">活跃任务</option>
                    <option value="completed">已完成</option>
                    <option value="">全部</option>
                </select>
            </div>
            <div class="ac-filter-group">
                <span class="ac-filter-icon">🎯</span>
                <select id="pipeline-filter-mode" class="ac-filter-select">
                    <option value="">全部模式</option>
                    <option value="dry_run">干跑</option>
                    <option value="execute">真执行</option>
                    <option value="advisory">咨询</option>
                    <option value="autonomous">自测试</option>
                </select>
            </div>
        `;
        document.getElementById('pipeline-filter-status').value = this.pipelineFilters.status;
        document.getElementById('pipeline-filter-status').addEventListener('change', (e) => {
            this.pipelineFilters.status = e.target.value;
            this.loadPipelineBoard();
        });
        document.getElementById('pipeline-filter-mode').addEventListener('change', (e) => {
            this.pipelineFilters.mode = e.target.value;
            this.loadPipelineBoard();
        });
    }

    renderPipelineBoard(stages, tasks) {
        const container = document.getElementById('pipeline-board');
        if (!container) return;
        const stageCols = stages.map(stage => {
            const stageTasks = tasks.filter(t => t.currentStage === stage.id);
            const cards = stageTasks.length > 0
                ? stageTasks.map(t => this.renderTaskCard(t)).join('')
                : '<div class="pipeline-empty-stage">—</div>';
            return `
                <div class="pipeline-stage-col">
                    <div class="pipeline-stage-header">
                        ${this.escapeHtml(stage.name)}
                        <span class="stage-role">${this.escapeHtml(stage.agentRole)}</span>
                    </div>
                    <div class="pipeline-stage-body">${cards}</div>
                </div>
            `;
        }).join('');
        container.innerHTML = stageCols;
        container.querySelectorAll('.pipeline-task-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                this.showPipelineDetail(card.dataset.taskId);
            });
        });
        container.querySelectorAll('.ptc-actions button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.executePipelineAction(btn.dataset.taskId, btn.dataset.action);
            });
        });
    }

    renderTaskCard(task) {
        const statusClass = `stage-${task.stageStatus}`;
        const dotColor = task.stageStatus === 'running' ? '#3b82f6'
            : task.stageStatus === 'passed' ? '#22c55e'
            : task.stageStatus === 'failed' ? '#ef4444'
            : task.stageStatus === 'blocked' ? '#f59e0b'
            : '#94a3b8';
        const statusLabel = task.stageStatus === 'running' ? '运行中'
            : task.stageStatus === 'passed' ? '已通过'
            : task.stageStatus === 'failed' ? '失败'
            : task.stageStatus === 'blocked' ? '阻塞'
            : task.stageStatus;
        const actions = this.renderTaskCardActions(task, { compact: true });
        return `
            <div class="pipeline-task-card ${statusClass}" data-task-id="${this.escapeHtml(task.taskId)}">
                <div class="ptc-id">${this.escapeHtml(task.taskId)}</div>
                <div class="ptc-module">${this.escapeHtml(task.moduleName || '通用')}</div>
                <div class="ptc-meta">
                    <span class="ptc-status-dot" style="background:${dotColor}"></span>
                    ${this.escapeHtml(statusLabel)}
                </div>
                ${task.activeAgent ? `<div class="ptc-agent">${this.escapeHtml(task.activeAgent)}</div>` : ''}
                ${task.leaseResourceId ? `<div class="ptc-sub">${this.escapeHtml(task.leaseResourceId)}</div>` : ''}
                <div class="ptc-sub">${this.escapeHtml(task.chipVersion || '')} · ${this.escapeHtml(task.mode || '')}</div>
                ${actions}
            </div>
        `;
    }

    renderTaskCardActions(task, options = {}) {
        const { compact = false } = options;
        const buttons = [];
        const isTerminal = ['completed','failed','cancelled'].includes(String(task.status).toLowerCase());
        const taskId = task.taskId || task.task_id;
        const btnClass = compact ? 'ptc-btn-sm' : 'ptc-btn';
        const containerClass = compact ? 'ptc-actions' : 'ptc-actions';
        const containerId = compact ? '' : 'id="pipeline-detail-actions"';
        if (task.status === 'waiting_for_critic_review' && task.approvalStatus === 'pending') {
            buttons.push(compact
                ? `<button class="${btnClass} ptc-btn-primary" data-task-id="${taskId}" data-action="approve">审批</button>`
                : `<button class="${btnClass} ptc-btn-primary" data-task-id="${taskId}" data-action="approve">✓ 审批通过</button>`);
            buttons.push(compact
                ? `<button class="${btnClass} ptc-btn-danger" data-task-id="${taskId}" data-action="reject">拒绝</button>`
                : `<button class="${btnClass} ptc-btn-danger" data-task-id="${taskId}" data-action="reject">✕ 拒绝</button>`);
        }
        if (!isTerminal) {
            buttons.push(compact
                ? `<button class="${btnClass} ptc-btn-primary" data-task-id="${taskId}" data-action="start">自动执行</button>`
                : `<button class="${btnClass} ptc-btn-primary" data-task-id="${taskId}" data-action="start">🚀 自动执行</button>`);
            buttons.push(compact
                ? `<button class="${btnClass} ptc-btn-danger" data-task-id="${taskId}" data-action="cancel">取消</button>`
                : `<button class="${btnClass} ptc-btn-danger" data-task-id="${taskId}" data-action="cancel">✕ 取消任务</button>`);
        }
        return buttons.length ? `<div class="${containerClass}" ${containerId}>${buttons.join('')}</div>` : '';
    }

    renderPipelineAgentBar(agents) {
        const bar = document.getElementById('pipeline-agent-bar');
        if (!bar) return;
        bar.innerHTML = (agents || []).map(a => {
            const dotClass = a.status === 'online' ? 'online' : a.status === 'maintenance' ? 'maintenance' : 'offline';
            const sessions = a.activeSessions || [];
            const taskInfo = a.activeTaskCount > 0 ? `执行 ${sessions.map(s => s.taskId).join(', ')}` : '空闲';
            return `
                <div class="pipeline-agent-chip">
                    <span class="agent-dot ${dotClass}"></span>
                    ${this.escapeHtml(a.displayName)}
                    <span class="agent-task-count">${a.activeTaskCount}</span>
                    <span style="font-size:10px;color:#94a3b8">${this.escapeHtml(taskInfo)}</span>
                </div>
            `;
        }).join('');
    }

    async showPipelineDetail(taskId) {
        this.pipelineCurrentTaskId = taskId;
        const panel = document.getElementById('pipeline-detail-panel');
        const body = document.getElementById('pipeline-detail-body');
        const title = document.getElementById('pipeline-detail-title');
        panel.style.display = 'flex';
        title.textContent = `任务详情: ${taskId}`;
        body.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8">加载中...</div>';
        try {
            const json = await this.apiRequest(`/api/agent-pipeline/tasks/${taskId}`);
            this.pipelineDetailData = json.data || {};
            this.renderPipelineDetailTab();
        } catch (error) {
            body.innerHTML = `<div style="color:#ef4444;padding:20px">加载失败: ${this.escapeHtml(error.message)}</div>`;
        }
    }

    switchPipelineTab(tab) {
        // CTA: 离开工作流Tab时清理WorkflowBoard实例，避免后台事件继续处理已移除的DOM
        if (this.pipelineCurrentTab === 'workflow' && tab !== 'workflow' && this._inlineWorkflowBoard) {
            try { this._inlineWorkflowBoard.destroy(); } catch (e) {}
            this._inlineWorkflowBoard = null;
        }
        this.pipelineCurrentTab = tab;
        document.querySelectorAll('.pipeline-detail-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        this.renderPipelineDetailTab();
    }

    renderPipelineDetailTab() {
        const body = document.getElementById('pipeline-detail-body');
        if (!body || !this.pipelineDetailData) return;
        const data = this.pipelineDetailData;
        switch (this.pipelineCurrentTab) {
            case 'timeline':
                body.innerHTML = this.renderPipelineTimeline(data);
                break;
            case 'events':
                body.innerHTML = this.renderPipelineEvents(data);
                break;
            case 'resources':
                body.innerHTML = this.renderPipelineResources(data);
                break;
            case 'artifacts':
                body.innerHTML = this.renderPipelineArtifacts(data);
                break;
            case 'context':
                body.innerHTML = this._renderContextTab(data);
                break;
            case 'workflow':
                this._renderWorkflowTab(body, data);
                break;
            case 'coverage':
                this._renderCoverageTab(body, data);
                break;
        }
    }

    // CTA: 工作流DAG看板Tab（简化版，避免SVG操作导致崩溃）
    _renderWorkflowTab(body, data) {
        const taskId = data.task?.task_id;
        // 先销毁旧的WorkflowBoard实例
        if (this._inlineWorkflowBoard) {
            try { this._inlineWorkflowBoard.destroy(); } catch (e) {}
            this._inlineWorkflowBoard = null;
        }
        // 显示加载中
        body.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">加载工作流...</div>';
        if (!taskId) {
            body.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">缺少taskId</div>';
            return;
        }
        // 直接用 fetch + HTML 渲染工作流定义和实例状态，不使用SVG
        this._loadWorkflowHtml(body, taskId);
    }

    async _loadWorkflowHtml(body, taskId) {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const myToken = ++this._workflowLoadToken; // 取消旧的请求
        try {
            // 并行拉取实例和定义
            const [instRes, defRes] = await Promise.all([
                fetch(`/api/workflow/tasks/${encodeURIComponent(taskId)}/workflow`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json().catch(() => ({ data: null }))),
                fetch(`/api/workflow/definitions/default`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json().catch(() => ({ data: null })))
            ]);
            if (myToken !== this._workflowLoadToken) return; // 已被新的请求取代
            const inst = instRes.data || instRes.instance;
            const def = defRes.data;
            // 解析定义
            let definition = null;
            if (def) {
                if (def.definition_json) {
                    definition = typeof def.definition_json === 'string' ? JSON.parse(def.definition_json) : def.definition_json;
                } else if (def.nodes) {
                    definition = def;
                }
            }
            // 解析实例状态
            let nodeStates = {};
            let currentNode = null;
            if (inst) {
                try {
                    const ctx = typeof inst.context_json === 'string' ? JSON.parse(inst.context_json) : (inst.context_json || {});
                    if (ctx && ctx.nodeResults) {
                        for (const [nodeId, result] of Object.entries(ctx.nodeResults)) {
                            nodeStates[nodeId] = result.status || 'completed';
                        }
                    }
                    currentNode = (ctx && ctx.currentNode) || null;
                } catch (e) {}
            }
            // 渲染HTML
            body.innerHTML = this._renderWorkflowHtml(definition, nodeStates, currentNode, inst);
        } catch (e) {
            if (myToken !== this._workflowLoadToken) return;
            body.innerHTML = `<div style="padding:16px;color:#ef4444;">加载工作流失败: ${this.escapeHtml(e.message)}</div>`;
        }
    }

    _renderWorkflowHtml(definition, nodeStates, currentNode, inst) {
        if (!definition || !definition.nodes) {
            return '<div style="padding:24px;text-align:center;color:#94a3b8;">未找到工作流定义</div>';
        }
        const nodes = definition.nodes;
        const edges = definition.edges || [];
        // 构建节点状态映射
        const statusColors = {
            pending: { bg: '#f1f5f9', border: '#cbd5e1', icon: '⏳', text: '#64748b' },
            running: { bg: '#eef2ff', border: '#6366f1', icon: '▶', text: '#4f46e5' },
            completed: { bg: '#ecfdf5', border: '#10b981', icon: '✅', text: '#059669' },
            failed: { bg: '#fef2f2', border: '#ef4444', icon: '❌', text: '#dc2626' },
            error: { bg: '#fef2f2', border: '#ef4444', icon: '❌', text: '#dc2626' },
            skipped: { bg: '#f8fafc', border: '#94a3b8', icon: '⏭️', text: '#64748b' }
        };
        // 提取 nodeResults 和 history 供详情面板使用
        let nodeResults = {};
        let history = [];
        if (inst) {
            try {
                const ctx = typeof inst.context_json === 'string' ? JSON.parse(inst.context_json) : (inst.context_json || {});
                nodeResults = ctx.nodeResults || {};
                history = ctx.history || [];
            } catch (e) {}
        }
        // 渲染节点卡片
        let html = '<div style="display:flex;flex-wrap:wrap;gap:12px;padding:12px;">';
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const status = nodeStates[node.id] || (currentNode === node.id ? 'running' : 'pending');
            const colors = statusColors[status] || statusColors.pending;
            const isCurrent = currentNode === node.id;
            // 查找入边（前置节点）
            const incoming = edges.filter(e => e.to === node.id);
            const hasLoop = incoming.some(e => {
                const fromNode = nodes.find(n => n.id === e.from);
                return fromNode && nodes.indexOf(fromNode) >= i;
            });
            // 检查该节点是否调用了 LLM
            const nodeResult = nodeResults[node.id];
            const llmUsed = nodeResult?.output?._llmUsed === true;
            const llmCalls = nodeResult?.output?._llmCalls || [];
            const llmBadge = llmUsed
                ? `<span style="font-size:10px;color:#8b5cf6;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:4px;padding:1px 5px;margin-left:4px;">AI</span>`
                : (llmCalls.length > 0
                    ? `<span style="font-size:10px;color:#94a3b8;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:1px 5px;margin-left:4px;" title="LLM调用失败，使用规则引擎">AI?</span>`
                    : '');
            html += `
                <div class="wf-node-card" data-node-id="${this.escapeHtml(node.id)}" style="
                    display:inline-block;
                    width:200px;
                    padding:12px;
                    border:2px solid ${colors.border};
                    border-radius:8px;
                    background:${colors.bg};
                    ${isCurrent ? 'box-shadow:0 0 8px rgba(99,102,241,0.4);' : ''}
                    cursor:pointer;
                    transition:transform 0.12s;
                ">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-weight:700;font-size:13px;color:#1e293b;">${this.escapeHtml(node.id)}</span>
                        <span style="font-size:16px;">${colors.icon}</span>
                    </div>
                    <div style="font-size:11px;color:${colors.text};font-weight:500;">${this.escapeHtml(node.label || node.handler || '')}</div>
                    <div style="font-size:10px;color:#94a3b8;margin-top:4px;">${status}${llmBadge}</div>
                </div>
            `;
            // 添加箭头
            if (i < nodes.length - 1) {
                html += '<div style="display:flex;align-items:center;color:#94a3b8;font-size:20px;padding:0 4px;">→</div>';
            }
        }
        html += '</div>';
        // 实例信息
        if (inst) {
            html += `<div style="padding:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
                实例ID: ${this.escapeHtml(inst.instance_id || '-')} | 
                状态: ${this.escapeHtml(inst.status || '-')} | 
                当前节点: ${this.escapeHtml(currentNode || '-')}
            </div>`;
        } else {
            html += '<div style="padding:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">该任务尚未启动工作流实例</div>';
        }
        // 节点详情面板
        html += '<div id="wf-node-detail" style="padding:16px;border-top:1px solid #e2e8f0;min-height:80px;">';
        html += '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:20px;">点击上方任意节点查看详细输入/输出和执行日志</div>';
        html += '</div>';
        // 存储数据供点击事件读取
        this._wfNodeResults = nodeResults;
        this._wfHistory = history;
        // 延迟绑定点击事件
        setTimeout(() => this._bindWorkflowNodeClicks(), 0);
        return html;
    }

    /**
     * 绑定工作流节点卡片点击事件
     */
    _bindWorkflowNodeClicks() {
        const cards = document.querySelectorAll('.wf-node-card');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                const nodeId = card.dataset.nodeId;
                this._showWorkflowNodeDetail(nodeId);
                cards.forEach(c => c.style.outline = '');
                card.style.outline = '2px solid #6366f1';
            });
        });
    }

    /**
     * 显示工作流节点详情
     */
    _showWorkflowNodeDetail(nodeId) {
        const container = document.getElementById('wf-node-detail');
        if (!container) return;
        const result = (this._wfNodeResults || {})[nodeId];
        const history = (this._wfHistory || []).filter(h => h.nodeId === nodeId);

        let html = `<div style="margin-bottom:12px;">
            <span style="font-size:15px;font-weight:700;color:#1e293b;">节点: ${this.escapeHtml(nodeId)}</span>`;
        if (result) {
            const statusColor = (result.status === 'error' || result.status === 'failed') ? '#dc2626'
                : result.status === 'completed' ? '#059669' : '#6366f1';
            html += ` <span style="font-size:12px;font-weight:600;color:${statusColor};">[${this.escapeHtml(result.status)}]</span>`;
            if (result.timestamp) {
                html += ` <span style="font-size:11px;color:#94a3b8;">${this.escapeHtml(this.formatDateTime(result.timestamp))}</span>`;
            }
        } else {
            html += ' <span style="font-size:12px;color:#94a3b8;">[尚未执行]</span>';
        }
        html += '</div>';

        if (result) {
            if (result.error) {
                html += `<div style="margin-bottom:12px;">
                    <div style="font-size:12px;font-weight:600;color:#dc2626;margin-bottom:4px;">错误信息</div>
                    <pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px;font-size:12px;color:#991b1b;white-space:pre-wrap;overflow-x:auto;">${this.escapeHtml(result.error)}</pre>
                </div>`;
            }
            // LLM 调用信息
            const llmCalls = result.output?._llmCalls || [];
            if (llmCalls.length > 0) {
                const llmUsed = result.output?._llmUsed === true;
                html += `<div style="margin-bottom:12px;">
                    <div style="font-size:12px;font-weight:600;color:#8b5cf6;margin-bottom:4px;">AI/LLM 调用 ${llmUsed ? '✅ 已使用' : '⚠️ 调用失败(回退规则引擎)'}</div>`;
                for (const call of llmCalls) {
                    html += `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:8px 10px;margin-bottom:6px;">
                        <div style="font-size:12px;font-weight:600;color:#6d28d9;">${this.escapeHtml(call.step || '-')}</div>
                        <div style="font-size:11px;color:#7c3aed;margin-top:3px;">Prompt: ${this.escapeHtml(call.prompt || '-')}</div>
                        <div style="font-size:10px;color:#94a3b8;margin-top:2px;">模型: ${this.escapeHtml(call.model || '-')} | 时间: ${this.escapeHtml(this.formatDateTime(call.timestamp) || '-')}</div>
                    </div>`;
                }
                html += '</div>';
            }
            // 输出（过滤掉 _llm 内部字段）
            if (result.output && Object.keys(result.output).length > 0) {
                const cleanOutput = { ...result.output };
                delete cleanOutput._llmCalls;
                delete cleanOutput._llmUsed;
                if (Object.keys(cleanOutput).length > 0) {
                    html += `<div style="margin-bottom:12px;">
                        <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:4px;">输出 (Output)</div>
                        <pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;font-size:12px;color:#334155;white-space:pre-wrap;overflow-x:auto;max-height:300px;">${this.escapeHtml(JSON.stringify(cleanOutput, null, 2))}</pre>
                    </div>`;
                }
            }
        }

        if (history.length > 0) {
            html += `<div>
                <div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:4px;">执行历史</div>
                <div style="font-size:11px;color:#64748b;">`;
            for (const h of history) {
                html += `<div style="padding:2px 0;">${this.escapeHtml(this.formatDateTime(h.timestamp) || '')} - ${this.escapeHtml(h.status)}</div>`;
            }
            html += '</div></div>';
        }

        if (!result && history.length === 0) {
            html += '<div style="color:#94a3b8;font-size:13px;padding:12px;">该节点尚未执行，无详细数据</div>';
        }

        container.innerHTML = html;
    }

    // CTA: 覆盖率详情Tab（简化版，直接HTML渲染）
    _renderCoverageTab(body, data) {
        const taskId = data.task?.task_id;
        body.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">加载覆盖率...</div>';
        if (!taskId) {
            body.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">缺少taskId</div>';
            return;
        }
        this._loadCoverageHtml(body, taskId);
    }

    async _loadCoverageHtml(body, taskId) {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const myToken = ++this._coverageLoadToken;
        try {
            const [constraintsRes, coverageRes] = await Promise.all([
                fetch(`/api/constraints/tasks/${encodeURIComponent(taskId)}/constraints`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json().catch(() => ({ data: [] }))),
                fetch(`/api/constraints/tasks/${encodeURIComponent(taskId)}/coverage`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json().catch(() => ({ data: {} })))
            ]);
            if (myToken !== this._coverageLoadToken) return;
            const constraints = constraintsRes.data || [];
            const coverage = coverageRes.data || {};
            // 计算汇总
            const groups = {};
            let totalCovered = 0, totalUncovered = 0, totalPending = 0;
            for (const c of constraints) {
                const type = c.constraint_type || 'other';
                if (!groups[type]) groups[type] = { covered: 0, uncovered: 0, pending: 0, total: 0 };
                groups[type].total++;
                if (c.coverage_status === 'covered') { groups[type].covered++; totalCovered++; }
                else if (c.coverage_status === 'uncovered') { groups[type].uncovered++; totalUncovered++; }
                else { groups[type].pending++; totalPending++; }
            }
            const total = constraints.length;
            const rate = total > 0 ? ((totalCovered / total) * 100).toFixed(1) : '0.0';
            const typeLabels = { register: '寄存器', state_machine: '状态机', parameter_matrix: '参数矩阵' };
            // 渲染
            let html = `
                <div style="padding:16px;">
                    <div style="display:flex;gap:24px;align-items:center;margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;">
                        <div style="font-size:28px;font-weight:700;color:${totalCovered > 0 ? '#10b981' : '#94a3b8'};">${rate}%</div>
                        <div style="font-size:12px;color:#64748b;">覆盖率</div>
                        <div style="margin-left:24px;display:flex;gap:16px;">
                            <span style="color:#10b981;">✅ 已覆盖: ${totalCovered}</span>
                            <span style="color:#ef4444;">❌ 未覆盖: ${totalUncovered}</span>
                            <span style="color:#f59e0b;">⏳ 待检查: ${totalPending}</span>
                            <span style="color:#64748b;">总计: ${total}</span>
                        </div>
                    </div>
            `;
            // 按类型分组
            for (const [type, stat] of Object.entries(groups)) {
                const groupRate = stat.total > 0 ? ((stat.covered / stat.total) * 100).toFixed(1) : '0.0';
                html += `
                    <div style="margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                            <span style="font-weight:600;font-size:13px;">${typeLabels[type] || type}</span>
                            <span style="font-size:12px;color:#64748b;">${groupRate}% (${stat.covered}/${stat.total})</span>
                        </div>
                        <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                            <div style="height:100%;width:${groupRate}%;background:#10b981;transition:width 0.3s;"></div>
                        </div>
                    </div>
                `;
            }
            // 约束列表
            if (constraints.length > 0) {
                html += '<div style="margin-top:16px;border-top:1px solid #e2e8f0;padding-top:12px;">';
                html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">约束清单</div>';
                for (const c of constraints.slice(0, 50)) {
                    const icon = c.coverage_status === 'covered' ? '✅' : (c.coverage_status === 'uncovered' ? '❌' : '⏳');
                    html += `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
                        <span>${icon}</span>
                        <span style="flex:1;font-weight:500;">${this.escapeHtml(c.constraint_key || c.constraint_name || '-')}</span>
                        <span style="color:#94a3b8;">${this.escapeHtml(c.source_doc || '')}</span>
                    </div>`;
                }
                html += '</div>';
            }
            html += '</div>';
            body.innerHTML = html;
        } catch (e) {
            if (myToken !== this._coverageLoadToken) return;
            body.innerHTML = `<div style="padding:16px;color:#ef4444;">加载覆盖率失败: ${this.escapeHtml(e.message)}</div>`;
        }
    }

    renderPipelineTimeline(data) {
        const stages = data.stageTimeline || [];
        const task = data.task;
        // 状态中文映射
        const statusLabel = { passed: '通过', failed: '失败', running: '运行中', draft: '草稿', diagnosing: '诊断中', pending: '待执行', waiting_for_critic_review: '待评审', completed: '已完成', cancelled: '已取消' };
        const taskStatus = task.status || 'draft';
        const statusText = statusLabel[taskStatus] || taskStatus;
        // 头部信息卡片
        let html = `<div class="pipeline-task-header">`;
        html += `<span class="pth-id">${this.escapeHtml(task.task_id)}</span>`;
        if (task.module_name) html += `<span class="pth-tag pth-module">📦 ${this.escapeHtml(task.module_name)}</span>`;
        if (task.chip_version) html += `<span class="pth-tag pth-chip">芯片 ${this.escapeHtml(task.chip_version)}</span>`;
        if (task.target_env) html += `<span class="pth-tag pth-env">🖥️ ${this.escapeHtml(task.target_env)}</span>`;
        if (task.mode) html += `<span class="pth-tag pth-mode">⚙️ ${this.escapeHtml(task.mode)}</span>`;
        html += `<span class="pth-status ${taskStatus}"><span class="dot"></span>${this.escapeHtml(statusText)}</span>`;
        html += `</div>`;
        // 时间线
        html += `<div class="pipeline-timeline">`;
        const icons = { created: '1', learn_context: '2', approval_gate: '3', execute_config: '4', execute_traffic: '5', critic_gate: '6', completed: '7' };
        for (const s of stages) {
            const icon = icons[s.stage] || '?';
            const stageStatus = s.status || 'pending';
            html += `<div class="pipeline-tl-stage ${stageStatus}">`;
            html += `<div class="pipeline-tl-circle">${icon}</div>`;
            html += `<div class="pipeline-tl-name">${this.escapeHtml(s.name)}</div>`;
            if (s.enteredAt) html += `<div class="pipeline-tl-time">${this.formatDateTime(s.enteredAt)}</div>`;
            if (s.durationSec !== null && s.durationSec !== undefined) html += `<div class="pipeline-tl-duration">${s.durationSec}s</div>`;
            if (s.agentId) html += `<div class="pipeline-tl-agent">${this.escapeHtml(s.agentId)}</div>`;
            if (stageStatus === 'running') html += `<div class="pipeline-tl-time" style="color:var(--ac-primary,#6366f1);font-weight:600">运行中...</div>`;
            if (stageStatus === 'pending') html += `<div class="pipeline-tl-time">待执行</div>`;
            html += `</div>`;
        }
        html += `</div>`;
        // 目标
        if (task.objective) {
            html += `<div class="pipeline-objective"><strong>🎯 目标:</strong>${this.escapeHtml(task.objective)}</div>`;
        }
        // Pipeline 执行错误/警告
        const sharedState = task.shared_state || {};
        const pipelineErrors = sharedState.pipeline_errors || [];
        if (pipelineErrors.length > 0) {
            html += `<div class="pipeline-errors-section">`;
            html += `<div class="pipeline-errors-title">⚠️ 执行告警 (${pipelineErrors.length})</div>`;
            for (const err of pipelineErrors) {
                const isWarn = err.level === 'warn';
                html += `<div class="pipeline-error-item ${isWarn ? 'pipeline-error-warn' : 'pipeline-error-error'}">
                    <span class="pipeline-error-icon">${isWarn ? '⚠️' : '❌'}</span>
                    <span class="pipeline-error-phase">${this.escapeHtml(err.phase || '-')}</span>
                    <span class="pipeline-error-msg">${this.escapeHtml(err.message)}</span>
                    ${err.detail ? `<span class="pipeline-error-detail">${this.escapeHtml(err.detail)}</span>` : ''}
                    ${err.timestamp ? `<span class="pipeline-error-time">${this.formatDateTime(err.timestamp)}</span>` : ''}
                </div>`;
            }
            html += `</div>`;
        }
        // 操作按钮
        const actions = this.renderTaskCardActions(task);
        if (actions) {
            html += `<div class="ptc-actions" style="margin-top:16px" id="pipeline-detail-actions">${actions}</div>`;
        }
        setTimeout(() => {
            const panel = document.getElementById('pipeline-detail-body');
            panel.querySelectorAll('#pipeline-detail-actions button').forEach(btn => {
                btn.addEventListener('click', () => this.executePipelineAction(btn.dataset.taskId, btn.dataset.action));
            });
        }, 0);
        return html;
    }

    renderPipelineEvents(data) {
        const events = data.events || [];
        const cliTraces = data.cliTraces || [];
        const trafficTraces = data.trafficTraces || [];
        let html = '<h4 class="pipeline-section-title">📋 事件流</h4>';
        if (events.length === 0) {
            html += '<div class="agent-console-empty-state"><div class="agent-console-empty-icon">📭</div><div>暂无事件</div></div>';
        } else {
            html += '<table class="pipeline-events-table"><thead><tr><th>时间</th><th>事件类型</th><th>发送者</th><th>接收者</th><th>Phase</th></tr></thead><tbody>';
            for (const e of events) {
                const isError = String(e.event_type).includes('FAIL') || String(e.event_type).includes('ERROR');
                html += `<tr>`;
                html += `<td>${this.formatDateTime(e.created_at)}</td>`;
                html += `<td class="event-type ${isError ? 'event-error' : ''}">${this.escapeHtml(e.event_type)}</td>`;
                html += `<td>${this.escapeHtml(e.sender_agent || '-')}</td>`;
                html += `<td>${this.escapeHtml(e.receiver_agent || '-')}</td>`;
                html += `<td>${this.escapeHtml(e.phase || '-')}</td>`;
                html += `</tr>`;
            }
            html += '</tbody></table>';
        }
        if (cliTraces.length > 0) {
            html += '<h4 class="pipeline-section-title" style="margin-top:20px">💻 SDK CLI 命令记录</h4>';
            html += '<table class="pipeline-events-table"><thead><tr><th>#</th><th>命令</th><th>状态</th><th>错误签名</th></tr></thead><tbody>';
            for (const c of cliTraces) {
                html += `<tr><td>${c.command_index}</td><td style="font-family:monospace;font-size:11px">${this.escapeHtml(String(c.command_text || '').substring(0, 120))}</td><td>${this.escapeHtml(c.status || '-')}</td><td>${this.escapeHtml(c.error_signature || '-')}</td></tr>`;
            }
            html += '</tbody></table>';
        }
        if (trafficTraces.length > 0) {
            html += '<h4 class="pipeline-section-title" style="margin-top:20px">🌐 流量运行记录</h4>';
            html += '<table class="pipeline-events-table"><thead><tr><th>Run ID</th><th>状态</th><th>开始</th><th>结束</th></tr></thead><tbody>';
            for (const t of trafficTraces) {
                html += `<tr><td>${this.escapeHtml(t.run_id)}</td><td>${this.escapeHtml(t.status || '-')}</td><td>${this.formatDateTime(t.started_at)}</td><td>${this.formatDateTime(t.completed_at)}</td></tr>`;
            }
            html += '</tbody></table>';
        }
        return html;
    }

    renderPipelineResources(data) {
        const leases = data.leases || [];
        const queues = data.queues || [];
        let html = '';
        if (leases.length === 0 && queues.length === 0) {
            return '<div class="agent-console-empty-state"><div class="agent-console-empty-icon">🔓</div><div>暂无资源锁和队列</div></div>';
        }
        if (leases.length > 0) html += '<h4 class="pipeline-section-title">🔒 资源锁</h4>';
        for (const l of leases) {
            const remaining = l.expires_at ? Math.max(0, Math.round((new Date(l.expires_at) - Date.now()) / 60000)) : '?';
            html += `
                <div class="pipeline-resource-card">
                    <div class="pr-header">
                        <span class="pr-id">${this.escapeHtml(l.resource_id)}</span>
                        <span class="pr-status ${l.lease_status}">${this.escapeHtml(l.lease_status)}</span>
                    </div>
                    <div class="pr-meta">
                        租约: ${this.escapeHtml(l.lease_id)}<br>
                        持有者: ${this.escapeHtml(l.owner_username || l.owner_user || '-')} | 任务: ${this.escapeHtml(l.task_id)}<br>
                        获取: ${this.formatDateTime(l.acquired_at)} | 过期: ${this.formatDateTime(l.expires_at)} | 剩余: ${remaining} 分钟<br>
                        模式: ${this.escapeHtml(l.mode || '-')} | 清理: ${this.escapeHtml(l.cleanup_status || '-')}
                    </div>
                </div>
            `;
        }
        if (queues.length > 0) html += '<h4 class="pipeline-section-title" style="margin-top:16px">⏳ 等待队列</h4>';
        for (const q of queues) {
            html += `
                <div class="pipeline-resource-card">
                    <div class="pr-header">
                        <span class="pr-id">队列: ${this.escapeHtml(q.queue_id)}</span>
                        <span class="pr-status">${this.escapeHtml(q.queue_status)}</span>
                    </div>
                    <div class="pr-meta">
                        任务: ${this.escapeHtml(q.task_id)} | 优先级: ${q.priority}<br>
                        创建: ${this.formatDateTime(q.created_at)}
                    </div>
                </div>
            `;
        }
        return html;
    }

    renderPipelineArtifacts(data) {
        const task = data.task;
        let html = '';
        if (task.verdict) {
            const v = task.verdict || {};
            const verdictClass = v.verdict === 'passed' ? 'passed' : v.verdict === 'failed' ? 'failed' : 'inconclusive';
            html += `<div class="pipeline-artifact-block">`;
            html += `<h4>✅ 联合判定</h4>`;
            html += `<span class="pipeline-verdict-badge ${verdictClass}">${this.escapeHtml(v.verdict === 'passed' ? '通过' : v.verdict === 'failed' ? '失败' : v.verdict === 'inconclusive' ? '不确定' : (v.verdict || '未知'))}</span>`;
            if (v.criteria) {
                html += `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">`;
                for (const [k, val] of Object.entries(v.criteria)) {
                    html += `<span style="font-size:12px;background:#f1f5f9;padding:4px 10px;border-radius:6px;"><strong>${this.escapeHtml(k)}:</strong> ${this.escapeHtml(String(val))}</span>`;
                }
                html += `</div>`;
            }
            if (v.next_action) html += `<div style="margin-top:10px;font-size:13px"><strong>下一步:</strong> ${this.escapeHtml(v.next_action)}</div>`;
            html += `</div>`;
        }
        if (task.artifacts && Object.keys(task.artifacts).length > 0) {
            html += `<div class="pipeline-artifact-block">`;
            html += `<h4>📦 产物</h4>`;
            html += `<pre>${this.escapeHtml(JSON.stringify(task.artifacts, null, 2))}</pre>`;
            html += `</div>`;
        }
        if (task.shared_state && Object.keys(task.shared_state).length > 0) {
            html += `<div class="pipeline-artifact-block">`;
            html += `<h4>🔄 共享状态</h4>`;
            html += `<pre>${this.escapeHtml(JSON.stringify(task.shared_state, null, 2))}</pre>`;
            html += `</div>`;
        }
        const auditLogs = data.auditLogs || [];
        if (auditLogs.length > 0) {
            html += `<div class="pipeline-artifact-block">`;
            html += `<h4>📝 审计日志 (最近 ${auditLogs.length} 条)</h4>`;
            html += `<table class="pipeline-events-table"><thead><tr><th>时间</th><th>类型</th><th>详情</th></tr></thead><tbody>`;
            for (const a of auditLogs) {
                html += `<tr><td>${this.formatDateTime(a.created_at)}</td><td class="event-type">${this.escapeHtml(a.audit_type)}</td><td style="font-size:11px">${this.escapeHtml(JSON.stringify(a.payload || {}).substring(0, 200))}</td></tr>`;
            }
            html += `</tbody></table>`;
            html += `</div>`;
        }
        if (!html) html = '<div class="agent-console-empty-state"><div class="agent-console-empty-icon">📦</div><div>暂无产物</div></div>';
        return html;
    }

    /**
     * 上下文 Tab：结构化展示 learn_context 阶段学习到的知识上下文 + CLI 执行计划
     */
    _renderContextTab(data) {
        const task = data.task || {};
        const artifacts = task.artifacts || {};
        const plan = artifacts.execution_plan || artifacts.cliPlan || {};
        const knowledgeSummary = artifacts.knowledge_summary || '';
        const sharedState = task.shared_state || {};

        // 如果没有 artifacts，显示空状态
        if (!plan.cli_commands && !knowledgeSummary && !plan.verification_points) {
            return '<div class="ctx-empty"><div class="ctx-empty-icon">📋</div><div class="ctx-empty-text">该任务尚未生成学习上下文</div><div class="ctx-empty-hint">启动自动执行后，Agent 会学习模块知识并生成执行计划</div></div>';
        }

        let html = '';

        // ===== 任务概况卡片 =====
        html += `<div class="ctx-section ctx-task-card">
            <div class="ctx-task-header">
                <div class="ctx-task-id">${this.escapeHtml(task.task_id || '-')}</div>
                <span class="ctx-task-mode">${this.escapeHtml(task.mode || '-')}</span>
            </div>
            <div class="ctx-task-meta">
                <div class="ctx-meta-item"><span class="ctx-meta-label">模块</span><span class="ctx-meta-value">${this.escapeHtml(task.module_name || '-')}</span></div>
                <div class="ctx-meta-item"><span class="ctx-meta-label">芯片代系</span><span class="ctx-meta-value">${this.escapeHtml(task.chip_version || '-')}</span></div>
                <div class="ctx-meta-item"><span class="ctx-meta-label">目标环境</span><span class="ctx-meta-value">${this.escapeHtml(task.target_env || '-')}</span></div>
                <div class="ctx-meta-item"><span class="ctx-meta-label">目标</span><span class="ctx-meta-value">${this.escapeHtml(task.objective || '-')}</span></div>
            </div>
        </div>`;

        // ===== CLI 执行计划 =====
        const planSource = plan._source === 'rule_engine' ? '规则引擎' : 'LLM 生成';
        const sourceBadge = plan._source
            ? `<span class="ctx-source-badge ${plan._source === 'rule_engine' ? 'ctx-source-rule' : 'ctx-source-llm'}">${planSource}</span>`
            : '';

        html += `<div class="ctx-section">
            <div class="ctx-section-title">
                <span class="ctx-section-icon">⚡</span>
                <span>CLI 执行计划</span>
                ${sourceBadge}
            </div>`;

        // CLI 命令列表
        if (plan.cli_commands && plan.cli_commands.length > 0) {
            html += `<div class="ctx-cmd-list">`;
            plan.cli_commands.forEach((cmd, i) => {
                html += `<div class="ctx-cmd-item">
                    <span class="ctx-cmd-num">${i + 1}</span>
                    <code class="ctx-cmd-code">${this.escapeHtml(cmd)}</code>
                    <button class="ctx-cmd-copy" onclick="navigator.clipboard?.writeText('${this.escapeHtml(cmd).replace(/'/g, "\\'")}')">复制</button>
                </div>`;
            });
            html += `</div>`;
        }

        // 流量描述
        if (plan.traffic_description) {
            html += `<div class="ctx-sub-card">
                <div class="ctx-sub-card-title">📡 流量描述</div>
                <div class="ctx-sub-card-body">${this.escapeHtml(plan.traffic_description)}</div>
            </div>`;
        }

        // 流量参数
        if (plan.traffic_profile) {
            const tp = plan.traffic_profile;
            html += `<div class="ctx-sub-card">
                <div class="ctx-sub-card-title">📊 流量参数</div>
                <div class="ctx-traffic-params">`;
            if (tp.rate_percent != null) html += `<div class="ctx-tp-item"><span>速率</span><strong>${tp.rate_percent}%</strong></div>`;
            if (tp.duration_sec != null) html += `<div class="ctx-tp-item"><span>持续时间</span><strong>${tp.duration_sec}s</strong></div>`;
            if (tp.packet_size != null) html += `<div class="ctx-tp-item"><span>包大小</span><strong>${tp.packet_size}B</strong></div>`;
            if (tp.src_port != null) html += `<div class="ctx-tp-item"><span>源端口</span><strong>${tp.src_port}</strong></div>`;
            if (tp.dst_port != null) html += `<div class="ctx-tp-item"><span>目的端口</span><strong>${tp.dst_port}</strong></div>`;
            html += `</div></div>`;
        }

        // 验证点
        if (plan.verification_points && plan.verification_points.length > 0) {
            html += `<div class="ctx-sub-card">
                <div class="ctx-sub-card-title">🔍 验证点</div>
                <div class="ctx-vp-list">`;
            plan.verification_points.forEach(vp => {
                html += `<div class="ctx-vp-item"><span class="ctx-vp-bullet"></span>${this.escapeHtml(vp)}</div>`;
            });
            html += `</div></div>`;
        }

        // 预期行为
        if (plan.expected_behavior) {
            html += `<div class="ctx-sub-card">
                <div class="ctx-sub-card-title">✅ 预期行为</div>
                <div class="ctx-sub-card-body ctx-expected">${this.escapeHtml(plan.expected_behavior)}</div>
            </div>`;
        }

        html += `</div>`;

        // ===== 知识上下文 =====
        if (knowledgeSummary) {
            html += `<div class="ctx-section">
                <div class="ctx-section-title">
                    <span class="ctx-section-icon">📚</span>
                    <span>知识上下文</span>
                    <span class="ctx-knowledge-count">${this._countKnowledgeItems(knowledgeSummary)} 条</span>
                </div>
                <div class="ctx-knowledge-body">${this._renderKnowledgeSummary(knowledgeSummary)}</div>
            </div>`;
        }

        // ===== 共享状态摘要 =====
        if (sharedState && Object.keys(sharedState).length > 0) {
            const phase = sharedState.phase || sharedState.status || '-';
            html += `<div class="ctx-section">
                <div class="ctx-section-title">
                    <span class="ctx-section-icon">🔄</span>
                    <span>执行状态</span>
                </div>
                <div class="ctx-shared-grid">
                    <div class="ctx-shared-item"><span class="ctx-shared-label">当前阶段</span><span class="ctx-shared-value ctx-phase-badge">${this.escapeHtml(phase)}</span></div>`;
            if (sharedState.retestCount != null) html += `<div class="ctx-shared-item"><span class="ctx-shared-label">补测轮次</span><span class="ctx-shared-value">${sharedState.retestCount}</span></div>`;
            if (sharedState.stats) {
                const s = sharedState.stats;
                html += `<div class="ctx-shared-item"><span class="ctx-shared-label">用例总数</span><span class="ctx-shared-value">${s.total || 0}</span></div>`;
                html += `<div class="ctx-shared-item"><span class="ctx-shared-label">通过</span><span class="ctx-shared-value ctx-pass">${s.pass || 0}</span></div>`;
                html += `<div class="ctx-shared-item"><span class="ctx-shared-label">失败</span><span class="ctx-shared-value ctx-fail">${s.fail || 0}</span></div>`;
                html += `<div class="ctx-shared-item"><span class="ctx-shared-label">错误</span><span class="ctx-shared-value ctx-error">${s.error || 0}</span></div>`;
            }
            html += `</div></div>`;
        }

        return html;
    }

    /**
     * 解析 knowledge_summary 纯文本，按分类渲染为结构化卡片
     */
    _renderKnowledgeSummary(text) {
        if (!text) return '<div class="ctx-knowledge-empty">暂无知识上下文</div>';
        const sections = [];
        let currentTitle = '';
        let currentItems = [];

        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            // 检测分类标题（如 "模块知识文件:" "测试点:" "已知Bug模式:"）
            if (/^[^\-]/.test(trimmed) && trimmed.endsWith(':')) {
                if (currentTitle && currentItems.length > 0) {
                    sections.push({ title: currentTitle, items: [...currentItems] });
                }
                currentTitle = trimmed.replace(/:$/, '');
                currentItems = [];
            } else if (trimmed.startsWith('-')) {
                currentItems.push(trimmed.replace(/^-\s*/, ''));
            } else if (currentTitle && !trimmed.startsWith('-')) {
                // 附加行
                currentItems[currentItems.length - 1] += ' ' + trimmed;
            }
        }
        if (currentTitle && currentItems.length > 0) {
            sections.push({ title: currentTitle, items: [...currentItems] });
        }

        if (sections.length === 0) {
            return `<div class="ctx-knowledge-raw">${this.escapeHtml(text)}</div>`;
        }

        const iconMap = { '模块知识文件': '📄', '测试点': '🎯', '已知Bug模式': '🐛' };
        let html = '';
        for (const sec of sections) {
            const icon = iconMap[sec.title] || '📌';
            html += `<div class="ctx-knowledge-group">
                <div class="ctx-kg-title">${icon} ${this.escapeHtml(sec.title)}</div>
                <div class="ctx-kg-items">`;
            for (const item of sec.items) {
                html += `<div class="ctx-kg-item">${this._renderKnowledgeItem(item)}</div>`;
            }
            html += `</div></div>`;
        }
        return html;
    }

    _renderKnowledgeItem(item) {
        // 解析 "[severity] title" 格式的 Bug 模式
        const bugMatch = item.match(/^\[(\w+)\]\s*(.+)/);
        if (bugMatch) {
            const sev = bugMatch[1].toLowerCase();
            const sevClass = sev === 'critical' ? 'ctx-sev-critical' : sev === 'high' ? 'ctx-sev-high' : 'ctx-sev-normal';
            return `<span class="ctx-sev-badge ${sevClass}">${this.escapeHtml(bugMatch[1])}</span> ${this.escapeHtml(bugMatch[2])}`;
        }
        // 普通文本
        return this.escapeHtml(item);
    }

    _countKnowledgeItems(text) {
        if (!text) return 0;
        return (text.match(/^-\s/gm) || []).length;
    }

    closePipelineDetail() {
        // CTA: 关闭详情面板时清理WorkflowBoard实例
        if (this._inlineWorkflowBoard) {
            try { this._inlineWorkflowBoard.destroy(); } catch (e) {}
            this._inlineWorkflowBoard = null;
        }
        document.getElementById('pipeline-detail-panel').style.display = 'none';
        this.pipelineCurrentTaskId = null;
    }

    async executePipelineAction(taskId, action) {
        // 自动执行走声明式工作流 API
        if (action === 'start') {
            const confirmed = await this.confirmDialog(`确认启动任务 ${taskId} 的自动执行?\n系统将自动:\n1. 环境准备 + 学习上下文\n2. 审批门控\n3. 测试派发 + 测试执行\n4. 完整性门控 + 硬约束裁决\n5. 知识沉淀`);
            if (!confirmed) return;
            try {
                await this.apiRequest(`/api/workflow/tasks/${taskId}/start-workflow`, { method: 'POST' });
                this.showToast('工作流已启动', 'success');
                this.loadPipelineBoard();
                if (this.pipelineCurrentTaskId === taskId) {
                    this.showPipelineDetail(taskId);
                }
            } catch (error) {
                this.showToast(`启动失败: ${error.message}`, 'error');
            }
            return;
        }
        let comment = '';
        if (action === 'approve' || action === 'reject') {
            // 使用系统封装的 openModal 收集审批备注
            comment = await this._collectActionComment(action === 'approve' ? '审批备注(可选):' : '拒绝原因(可选):');
        }
        const actionLabels = { pause: '暂停', resume: '恢复', cancel: '取消', approve: '审批通过', reject: '拒绝' };
        const confirmMsg = `确认${actionLabels[action] || action}该任务?`;
        const confirmed = await this.confirmDialog(confirmMsg);
        if (!confirmed) return;
        try {
            await this.apiRequest(`/api/agent-pipeline/tasks/${taskId}/action`, {
                method: 'POST',
                body: JSON.stringify({ action, comment })
            });
            this.showToast(`操作成功: ${actionLabels[action] || action}`, 'success');
            this.loadPipelineBoard();
            if (this.pipelineCurrentTaskId === taskId) {
                this.showPipelineDetail(taskId);
            }
        } catch (error) {
            this.showToast(`操作失败: ${error.message}`, 'error');
        }
    }

    /**
     * 使用系统封装的 openModal 收集审批备注/拒绝原因，替代原生 prompt()
     */
    _collectActionComment(label) {
        return new Promise(resolve => {
            this.openModal(label, `
                <div style="padding:8px 0;">
                    <textarea id="action-comment-input" style="width:100%;min-height:80px;padding:8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;resize:vertical;" placeholder="${this.escapeHtml(label)}"></textarea>
                </div>
            `, [
                { label: '取消', class: 'agent-console-btn-secondary', action: () => { this.closeModal(); resolve(''); } },
                { label: '确定', class: 'agent-console-btn-primary', action: () => {
                    const val = document.getElementById('action-comment-input')?.value?.trim() || '';
                    this.closeModal();
                    resolve(val);
                } }
            ]);
        });
    }

    togglePipelineAuto() {
        this.pipelineAutoRefresh = !this.pipelineAutoRefresh;
        const btn = document.getElementById('pipeline-auto-toggle-btn');
        if (btn) btn.textContent = `自动刷新: ${this.pipelineAutoRefresh ? '开' : '关'}`;
        if (this.pipelineAutoRefresh) {
            this.startPipelinePolling();
        } else {
            this.stopPipelinePolling();
        }
    }

    startPipelinePolling() {
        this.stopPipelinePolling();
        this.pipelinePollingTimer = setInterval(() => {
            this.loadPipelineBoard();
        }, 5000);
    }

    stopPipelinePolling() {
        if (this.pipelinePollingTimer) {
            clearInterval(this.pipelinePollingTimer);
            this.pipelinePollingTimer = null;
        }
    }

    initPipelineSocket() {
        if (this._pipelineSocketInit) return;
        this._pipelineSocketInit = true;
        if (window.socket) {
            window.socket.on('agent:task_created', () => this.loadPipelineBoard());
            window.socket.on('agent:task_stage_changed', (data) => {
                this.loadPipelineBoard();
                // 如果详情面板已打开且是同一个任务，自动刷新详情
                if (this.pipelineCurrentTaskId === data.taskId && document.getElementById('pipeline-detail-panel')?.style.display !== 'none') {
                    this.showPipelineDetail(data.taskId);
                }
            });
            window.socket.on('agent:task_status_changed', () => {
                this.loadPipelineBoard();
                // 如果详情面板已打开，自动刷新详情
                if (this.pipelineCurrentTaskId && document.getElementById('pipeline-detail-panel')?.style.display !== 'none') {
                    this.showPipelineDetail(this.pipelineCurrentTaskId);
                }
            });
            window.socket.on('agent:task_completed', (data) => {
                this.loadPipelineBoard();
                // 任务完成时刷新详情面板
                if (this.pipelineCurrentTaskId === data.taskId && document.getElementById('pipeline-detail-panel')?.style.display !== 'none') {
                    this.showPipelineDetail(data.taskId);
                }
                this.showToast(`任务 ${data.taskId} 已${data.status === 'completed' ? '完成' : data.status === 'failed' ? '失败' : '取消'}`, data.status === 'completed' ? 'success' : 'error');
            });
            window.socket.on('agent:approval_needed', (data) => {
                this.showToast(`任务 ${data.taskId} 需要审批`, 'warning');
            });
            window.socket.on('agent:approval_decided', () => this.loadPipelineBoard());
            window.socket.on('agent:event_emitted', (data) => {
                if (this.pipelineCurrentTaskId === data.taskId && this.pipelineCurrentTab === 'events') {
                    this.showPipelineDetail(data.taskId);
                }
            });
        }
        this.startPipelinePolling();
    }
}

window.agentConsolePage = window.agentConsolePage || new AgentConsolePage();

function initAgentConsole() {
    return window.agentConsolePage.init();
}

window.initAgentConsole = initAgentConsole;
