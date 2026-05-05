class Level1PointsList {
    constructor() {
        this.level1Points = [];
        this.testCases = {};
        this.currentPage = 1;
        this.pageSize = 20;
        this.totalPages = 0;
        this.expandedItems = new Set();
        this.currentLibraryId = null;
        this.currentModuleId = null;
        this.currentTestCase = null;
        this.searchKeyword = '';
        this.filters = {};
        this.authToken = localStorage.getItem('authToken');
        
        this.init();
    }

    async apiRequest(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : 
                    endpoint.startsWith('/api') ? endpoint : 
                    endpoint.startsWith('/') ? `/api${endpoint}` : `/api/${endpoint}`;
        
        this.authToken = localStorage.getItem('authToken');
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }
        
        try {
            const response = await fetch(url, {
                ...options,
                headers
            });
            
            if (!response.ok) {
                let errorMessage = '请求失败';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.message || errorMessage;
                } catch (e) {
                    errorMessage = `请求失败 (${response.status})`;
                }
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('API请求失败:', error);
            throw error;
        }
    }

    async init() {
        this.bindEvents();
        this.parseUrlParams();
        await this.loadLevel1Points();
    }

    parseUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        this.currentLibraryId = urlParams.get('libraryId');
        this.currentModuleId = urlParams.get('moduleId');
        
        const libraryName = urlParams.get('libraryName') || '用例库';
        const moduleName = urlParams.get('moduleName') || '模块';
        
        document.getElementById('breadcrumb-library').textContent = libraryName;
        document.getElementById('breadcrumb-module').textContent = moduleName;
    }

    bindEvents() {
        document.getElementById('back-btn').addEventListener('click', () => this.goBack());
        document.getElementById('search-input').addEventListener('input', (e) => this.handleSearch(e));
        document.getElementById('filter-btn').addEventListener('click', () => this.toggleFilterPanel());
        document.getElementById('expand-all-btn').addEventListener('click', () => this.toggleExpandAll());
        document.getElementById('add-level1-btn').addEventListener('click', () => this.addLevel1Point());
        document.getElementById('empty-add-btn').addEventListener('click', () => this.addLevel1Point());
        
        document.getElementById('drawer-close-btn').addEventListener('click', () => this.closeDrawer());
        document.getElementById('drawer-cancel-btn').addEventListener('click', () => this.closeDrawer());
        document.getElementById('drawer-overlay').addEventListener('click', () => this.closeDrawer());
        document.getElementById('drawer-save-btn').addEventListener('click', () => this.saveTestCase());
        document.getElementById('drawer-save-btn-bottom').addEventListener('click', () => this.saveTestCase());
        document.getElementById('drawer-save-continue-btn').addEventListener('click', () => this.saveTestCase(true));
        document.getElementById('drawer-delete-btn').addEventListener('click', () => this.deleteTestCase());
        
        document.getElementById('filter-close-btn').addEventListener('click', () => this.toggleFilterPanel());
        document.getElementById('filter-reset-btn').addEventListener('click', () => this.resetFilters());
        document.getElementById('filter-apply-btn').addEventListener('click', () => this.applyFilters());
        
        document.getElementById('retry-btn').addEventListener('click', () => this.loadLevel1Points());
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeDrawer();
                this.closeFilterPanel();
            }
        });
    }

    async loadLevel1Points() {
        try {
            this.showLoading();
            
            const body = {};
            
            if (this.currentLibraryId) {
                body.libraryId = this.currentLibraryId;
            }
            
            if (this.searchKeyword) {
                body.keyword = this.searchKeyword;
            }
            
            const response = await this.apiRequest('/testpoints/level1/all', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            
            if (response.success && response.level1Points) {
                this.level1Points = response.level1Points;
                this.totalPages = Math.ceil(this.level1Points.length / this.pageSize);
                this.renderLevel1List();
            } else {
                throw new Error(response.message || '加载失败');
            }
        } catch (error) {
            console.error('加载一级测试点失败:', error);
            this.showError(error.message);
        } finally {
            this.hideLoading();
        }
    }

    renderLevel1List() {
        const container = document.getElementById('level1-list');
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        const pageData = this.level1Points.slice(startIndex, endIndex);
        
        if (pageData.length === 0) {
            this.showEmpty();
            return;
        }
        
        this.hideEmpty();
        this.hideError();
        
        container.innerHTML = pageData.map((point, index) => this.renderLevel1Item(point, startIndex + index + 1)).join('');
        
        this.renderPagination();
        this.bindLevel1ItemEvents();
    }

    renderLevel1Item(point, index) {
        const isExpanded = this.expandedItems.has(point.id);
        const testCaseCount = point.test_case_count || 0;
        const bugCount = point.bug_count || 0;
        const testType = point.test_type || '功能测试';
        const summary = point.summary || point.overview || '';
        const updatedAt = point.updated_at || point.updateTime || '';
        
        return `
            <div class="level1-item ${isExpanded ? 'expanded' : ''}" data-id="${point.id}">
                <div class="level1-item-header">
                    <button class="expand-btn" data-id="${point.id}">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18l6-6-6-6"/>
                        </svg>
                    </button>
                    <div class="level1-number">TP-${String(index).padStart(3, '0')}</div>
                    <div class="level1-name" title="${this.escapeHtml(point.name)}">${this.escapeHtml(point.name)}</div>
                    <div class="level1-summary" title="${this.escapeHtml(summary)}">${this.escapeHtml(summary)}</div>
                    <div class="level1-count">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                        </svg>
                        <span class="level1-count-value">${testCaseCount}</span>
                        <span>用例</span>
                    </div>
                    <div class="level1-bug-count ${bugCount === 0 ? 'hidden' : ''}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M12 8v4M12 16h.01"></path>
                        </svg>
                        <span class="level1-bug-value">${bugCount}</span>
                        <span>缺陷</span>
                    </div>
                    <div class="level1-updated-time">${this.formatDateTime(updatedAt)}</div>
                    <div class="level1-actions">
                        <button class="level1-action-btn edit-btn" data-id="${point.id}" title="编辑">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="level1-action-btn delete-btn" data-id="${point.id}" title="删除">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="test-cases-container ${isExpanded ? 'expanded' : ''}" data-id="${point.id}">
                    <div class="test-cases-list" data-id="${point.id}">
                        <div class="loading-state" style="padding: 20px; text-align: center;">
                            <div class="loading-spinner"></div>
                            <p style="margin: 12px 0 0; font-size: 13px; color: #64748b;">加载测试用例...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    bindLevel1ItemEvents() {
        document.querySelectorAll('.expand-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleExpand(btn.dataset.id);
            });
        });
        
        document.querySelectorAll('.level1-item-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (!e.target.closest('.level1-action-btn')) {
                    const id = header.closest('.level1-item').dataset.id;
                    this.toggleExpand(id);
                }
            });
        });
        
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editLevel1Point(btn.dataset.id);
            });
        });
        
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteLevel1Point(btn.dataset.id);
            });
        });
    }

    async toggleExpand(level1Id) {
        const item = document.querySelector(`.level1-item[data-id="${level1Id}"]`);
        const container = document.querySelector(`.test-cases-container[data-id="${level1Id}"]`);
        
        if (this.expandedItems.has(level1Id)) {
            this.expandedItems.delete(level1Id);
            item.classList.remove('expanded');
            container.classList.remove('expanded');
        } else {
            this.expandedItems.add(level1Id);
            item.classList.add('expanded');
            container.classList.add('expanded');
            
            if (!this.testCases[level1Id]) {
                await this.loadTestCases(level1Id);
            } else {
                this.renderTestCases(level1Id, this.testCases[level1Id]);
            }
        }
        
        this.updateExpandAllButton();
    }

    async loadTestCases(level1Id) {
        try {
            const listContainer = document.querySelector(`.test-cases-list[data-id="${level1Id}"]`);
            listContainer.innerHTML = `
                <div class="loading-state" style="padding: 20px; text-align: center;">
                    <div class="loading-spinner"></div>
                    <p style="margin: 12px 0 0; font-size: 13px; color: #64748b;">加载测试用例...</p>
                </div>
            `;
            
            const response = await this.apiRequest('/api/cases/list', {
                method: 'POST',
                body: JSON.stringify({
                    level1Id: level1Id,
                    page: 1,
                    pageSize: 1000
                })
            });
            
            if (response.success && response.testCases) {
                this.testCases[level1Id] = response.testCases;
                this.renderTestCases(level1Id, response.testCases);
            } else {
                throw new Error(response.message || '加载测试用例失败');
            }
        } catch (error) {
            console.error('加载测试用例失败:', error);
            const listContainer = document.querySelector(`.test-cases-list[data-id="${level1Id}"]`);
            listContainer.innerHTML = `
                <div class="error-state" style="padding: 20px; text-align: center;">
                    <p style="margin: 0; font-size: 13px; color: #ef4444;">加载失败：${this.escapeHtml(error.message)}</p>
                </div>
            `;
        }
    }

    renderTestCases(level1Id, testCases) {
        const listContainer = document.querySelector(`.test-cases-list[data-id="${level1Id}"]`);
        
        if (testCases.length === 0) {
            listContainer.innerHTML = `
                <div style="padding: 20px; text-align: center;">
                    <p style="margin: 0 0 12px; font-size: 13px; color: #94a3b8;">暂无测试用例</p>
                </div>
                <button class="add-test-case-btn" data-level1-id="${level1Id}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    <span>添加测试用例</span>
                </button>
            `;
        } else {
            listContainer.innerHTML = `
                <div class="test-case-header">
                    <div class="test-case-header-status"></div>
                    <div class="test-case-header-name">名称</div>
                    <div class="test-case-header-purpose">测试目的</div>
                    <div class="test-case-header-type">测试类型</div>
                    <div class="test-case-header-priority">优先级</div>
                    <div class="test-case-header-bug">缺陷</div>
                    <div class="test-case-header-owner">负责人</div>
                    <div class="test-case-header-actions">操作</div>
                </div>
            ` + testCases.map(tc => this.renderTestCaseItem(tc)).join('') + `
                <button class="add-test-case-btn" data-level1-id="${level1Id}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    <span>添加测试用例</span>
                </button>
            `;
        }
        
        this.bindTestCaseEvents();
    }

    renderTestCaseItem(testCase) {
        const status = this.getTestCaseStatus(testCase);
        const priority = testCase.priority || '中';
        const testType = testCase.type || '功能测试';
        const bugCount = testCase.bug_count || 0;
        const purpose = testCase.purpose ? testCase.purpose.replace(/\n/g, ' ').substring(0, 60) : '-';
        
        return `
            <div class="test-case-item" data-id="${testCase.id}">
                <div class="test-case-status ${status}">
                    ${this.getStatusIcon(status)}
                </div>
                <div class="test-case-name" title="${this.escapeHtml(testCase.name)}">${this.escapeHtml(testCase.name)}</div>
                <div class="test-case-purpose" title="${this.escapeHtml(testCase.purpose || '')}">${this.escapeHtml(purpose)}</div>
                <div class="test-case-type ${testType}">${this.escapeHtml(testType)}</div>
                <div class="test-case-priority ${priority}">${priority}</div>
                <div class="test-case-bug-count ${bugCount > 0 ? 'has-bug' : ''}">${bugCount}</div>
                <div class="test-case-owner">${this.escapeHtml(testCase.owner || '-')}</div>
                <div class="test-case-actions">
                    <button class="test-case-action-btn edit-testcase-btn" data-id="${testCase.id}" title="编辑">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    getTestCaseStatus(testCase) {
        if (testCase.has_defect) return 'has-defect';
        if (testCase.executed) return 'executed';
        return 'not-executed';
    }

    getStatusIcon(status) {
        const icons = {
            'executed': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
            'not-executed': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>',
            'has-defect': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4M12 16h.01"></path></svg>'
        };
        return icons[status] || icons['not-executed'];
    }

    bindTestCaseEvents() {
        document.querySelectorAll('.test-case-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.test-case-action-btn')) {
                    this.openDrawer(item.dataset.id);
                }
            });
        });
        
        document.querySelectorAll('.edit-testcase-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openDrawer(btn.dataset.id);
            });
        });
        
        document.querySelectorAll('.add-test-case-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.addTestCase(btn.dataset.level1Id);
            });
        });
    }

    async openDrawer(testCaseId) {
        try {
            const response = await this.apiRequest(`/testcases/${testCaseId}`);
            
            if (response.success && response.testCase) {
                this.currentTestCase = response.testCase;
                this.fillDrawerForm(response.testCase);
                this.showDrawer();
            } else {
                throw new Error(response.message || '加载测试用例详情失败');
            }
        } catch (error) {
            console.error('加载测试用例详情失败:', error);
            this.showToast(error.message, 'error');
        }
    }

    fillDrawerForm(testCase) {
        document.getElementById('testcase-id').value = testCase.id;
        document.getElementById('testcase-name').value = testCase.name || '';
        document.getElementById('testcase-priority').value = testCase.priority || '中';
        document.getElementById('testcase-type').value = testCase.type || '功能测试';
        document.getElementById('testcase-phase').value = testCase.phase || '集成测试';
        document.getElementById('testcase-env').value = testCase.env || '测试环境';
        document.getElementById('testcase-owner').value = testCase.owner || '';
        document.getElementById('testcase-precondition').value = testCase.precondition || '';
        document.getElementById('testcase-purpose').value = testCase.purpose || '';
        document.getElementById('testcase-steps').value = testCase.steps || '';
        document.getElementById('testcase-expected').value = testCase.expected || '';
        document.getElementById('testcase-key-config').value = testCase.key_config || '';
        document.getElementById('testcase-remark').value = testCase.remark || '';
        
        document.getElementById('drawer-created-time').textContent = this.formatDateTime(testCase.created_at);
        document.getElementById('drawer-updated-time').textContent = this.formatDateTime(testCase.updated_at);
    }

    showDrawer() {
        document.getElementById('drawer-overlay').classList.add('active');
        document.getElementById('testcase-drawer').classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    closeDrawer() {
        document.getElementById('drawer-overlay').classList.remove('active');
        document.getElementById('testcase-drawer').classList.remove('open');
        document.body.style.overflow = '';
        this.currentTestCase = null;
    }

    async saveTestCase(continueEditing = false) {
        try {
            const testCaseId = document.getElementById('testcase-id').value;
            const data = {
                name: document.getElementById('testcase-name').value,
                priority: document.getElementById('testcase-priority').value,
                type: document.getElementById('testcase-type').value,
                phase: document.getElementById('testcase-phase').value,
                env: document.getElementById('testcase-env').value,
                owner: document.getElementById('testcase-owner').value,
                precondition: document.getElementById('testcase-precondition').value,
                purpose: document.getElementById('testcase-purpose').value,
                steps: document.getElementById('testcase-steps').value,
                expected: document.getElementById('testcase-expected').value,
                key_config: document.getElementById('testcase-key-config').value,
                remark: document.getElementById('testcase-remark').value
            };
            
            if (!data.name || !data.name.trim()) {
                throw new Error('用例名称不能为空');
            }
            
            const saveBtn = continueEditing ? 
                document.getElementById('drawer-save-continue-btn') : 
                document.getElementById('drawer-save-btn');
            const btnText = saveBtn.querySelector('.btn-text');
            const btnLoading = saveBtn.querySelector('.btn-loading');
            
            if (btnText) btnText.style.display = 'none';
            if (btnLoading) btnLoading.style.display = 'inline-flex';
            
            const response = await this.apiRequest(`/testcases/${testCaseId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            
            if (response.success) {
                this.showToast('保存成功', 'success');
                
                if (!continueEditing) {
                    this.closeDrawer();
                }
                
                await this.loadLevel1Points();
                
                if (this.currentTestCase && this.currentTestCase.level1_id) {
                    delete this.testCases[this.currentTestCase.level1_id];
                }
            } else {
                throw new Error(response.message || '保存失败');
            }
        } catch (error) {
            console.error('保存测试用例失败:', error);
            this.showToast(error.message, 'error');
        } finally {
            const saveBtns = [document.getElementById('drawer-save-btn'), document.getElementById('drawer-save-continue-btn')];
            saveBtns.forEach(btn => {
                const btnText = btn.querySelector('.btn-text');
                const btnLoading = btn.querySelector('.btn-loading');
                if (btnText) btnText.style.display = 'inline';
                if (btnLoading) btnLoading.style.display = 'none';
            });
        }
    }

    async deleteTestCase() {
        if (!(await showConfirmMessage('确定要删除这个测试用例吗？此操作无法撤销。'))) {
            return;
        }
        
        try {
            const testCaseId = document.getElementById('testcase-id').value;
            const response = await this.apiRequest(`/testcases/${testCaseId}`, {
                method: 'DELETE'
            });
            
            if (response.success) {
                this.showToast('删除成功', 'success');
                this.closeDrawer();
                
                if (this.currentTestCase && this.currentTestCase.level1_id) {
                    delete this.testCases[this.currentTestCase.level1_id];
                }
                
                await this.loadLevel1Points();
            } else {
                throw new Error(response.message || '删除失败');
            }
        } catch (error) {
            console.error('删除测试用例失败:', error);
            this.showToast(error.message, 'error');
        }
    }

    toggleExpandAll() {
        const btn = document.getElementById('expand-all-btn');
        const btnText = btn.querySelector('.btn-text');
        const allExpanded = this.expandedItems.size === this.level1Points.length;
        
        if (allExpanded) {
            this.expandedItems.clear();
            document.querySelectorAll('.level1-item').forEach(item => {
                item.classList.remove('expanded');
            });
            document.querySelectorAll('.test-cases-container').forEach(container => {
                container.classList.remove('expanded');
            });
            btnText.textContent = '全展开';
        } else {
            this.level1Points.forEach((point, index) => {
                setTimeout(() => {
                    if (!this.expandedItems.has(point.id)) {
                        this.toggleExpand(point.id);
                    }
                }, index * 50);
            });
            btnText.textContent = '全收起';
        }
    }

    updateExpandAllButton() {
        const btn = document.getElementById('expand-all-btn');
        const btnText = btn.querySelector('.btn-text');
        const allExpanded = this.expandedItems.size === this.level1Points.length && this.level1Points.length > 0;
        
        btnText.textContent = allExpanded ? '全收起' : '全展开';
    }

    handleSearch(e) {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.searchKeyword = e.target.value.trim();
            this.currentPage = 1;
            this.loadLevel1Points();
        }, 300);
    }

    toggleFilterPanel() {
        const panel = document.getElementById('filter-panel');
        const overlay = document.getElementById('drawer-overlay');
        
        if (panel.style.display === 'none') {
            panel.style.display = 'flex';
            overlay.classList.add('active');
        } else {
            panel.style.display = 'none';
            overlay.classList.remove('active');
        }
    }

    closeFilterPanel() {
        document.getElementById('filter-panel').style.display = 'none';
        document.getElementById('drawer-overlay').classList.remove('active');
    }

    resetFilters() {
        document.querySelectorAll('#filter-panel input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
        document.getElementById('filter-case-count-min').value = '';
        document.getElementById('filter-case-count-max').value = '';
        document.getElementById('filter-date-start').value = '';
        document.getElementById('filter-date-end').value = '';
    }

    applyFilters() {
        this.filters = {
            testTypes: Array.from(document.querySelectorAll('#filter-test-type input:checked')).map(cb => cb.value),
            caseCountMin: document.getElementById('filter-case-count-min').value,
            caseCountMax: document.getElementById('filter-case-count-max').value,
            dateStart: document.getElementById('filter-date-start').value,
            dateEnd: document.getElementById('filter-date-end').value
        };
        
        this.closeFilterPanel();
        this.currentPage = 1;
        this.loadLevel1Points();
    }

    renderPagination() {
        const container = document.getElementById('pagination');
        
        if (this.totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let html = '';
        
        html += `<button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} onclick="app.goToPage(${this.currentPage - 1})">上一页</button>`;
        
        for (let i = 1; i <= this.totalPages; i++) {
            if (i === 1 || i === this.totalPages || (i >= this.currentPage - 2 && i <= this.currentPage + 2)) {
                html += `<button class="pagination-btn ${i === this.currentPage ? 'active' : ''}" onclick="app.goToPage(${i})">${i}</button>`;
            } else if (i === this.currentPage - 3 || i === this.currentPage + 3) {
                html += `<span style="padding: 0 8px;">...</span>`;
            }
        }
        
        html += `<button class="pagination-btn" ${this.currentPage === this.totalPages ? 'disabled' : ''} onclick="app.goToPage(${this.currentPage + 1})">下一页</button>`;
        
        container.innerHTML = html;
    }

    goToPage(page) {
        if (page < 1 || page > this.totalPages) return;
        this.currentPage = page;
        this.renderLevel1List();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    addLevel1Point() {
        this.showToast('新建测试点功能开发中...', 'warning');
    }

    editLevel1Point(id) {
        this.showToast('编辑测试点功能开发中...', 'warning');
    }

    deleteLevel1Point(id) {
        this.showToast('删除测试点功能开发中...', 'warning');
    }

    addTestCase(level1Id) {
        const level1Point = this.level1Points.find(p => p.id == level1Id);
        const level1Name = level1Point ? encodeURIComponent(level1Point.name) : '';
        
        let moduleIdVal = this.currentModuleId || '';
        let moduleNameVal = document.getElementById('breadcrumb-module').textContent || '';
        
        if (!moduleIdVal && level1Point) {
            moduleIdVal = level1Point.module_id || level1Point.moduleId || '';
            if (level1Point.module_name || level1Point.moduleName) {
                moduleNameVal = level1Point.module_name || level1Point.moduleName;
            }
        }
        
        const urlParams = new URLSearchParams();
        urlParams.append('libraryId', this.currentLibraryId || '');
        urlParams.append('moduleId', moduleIdVal);
        urlParams.append('level1Id', level1Id);
        urlParams.append('libraryName', encodeURIComponent(document.getElementById('breadcrumb-library').textContent));
        urlParams.append('moduleName', encodeURIComponent(moduleNameVal));
        if (level1Name) {
            urlParams.append('level1Name', level1Name);
        }
        
        window.location.href = `/batch-create-cases.html?${urlParams.toString()}`;
    }

    showLoading() {
        document.getElementById('loading-state').style.display = 'flex';
        document.getElementById('level1-list').innerHTML = '';
    }

    hideLoading() {
        document.getElementById('loading-state').style.display = 'none';
    }

    showEmpty() {
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('level1-list').innerHTML = '';
        document.getElementById('pagination').innerHTML = '';
    }

    hideEmpty() {
        document.getElementById('empty-state').style.display = 'none';
    }

    showError(message) {
        document.getElementById('error-state').style.display = 'flex';
        document.getElementById('error-message').textContent = message;
        document.getElementById('level1-list').innerHTML = '';
        document.getElementById('pagination').innerHTML = '';
    }

    hideError() {
        document.getElementById('error-state').style.display = 'none';
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                ${type === 'success' ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>' : ''}
                ${type === 'error' ? '<circle cx="12" cy="12" r="10"></circle><path d="M12 8v4M12 16h.01"></path>' : ''}
                ${type === 'warning' ? '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>' : ''}
            </svg>
            <span>${this.escapeHtml(message)}</span>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    goBack() {
        if (document.referrer) {
            window.history.back();
        } else {
            window.location.href = '/';
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/'/g, '&#039;');
    }

    formatDateTime(dateString) {
        if (!dateString) return '-';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString;
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}/${month}/${day} ${hours}:${minutes}`;
        } catch (e) {
            return dateString;
        }
    }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new Level1PointsList();
});
