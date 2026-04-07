(function() {
    'use strict';

    const API_BASE_URL = window.location.origin;
    const MAX_ROWS = 200; // P2修复：限制最多200行

    let authToken = localStorage.getItem('authToken');
    let currentUser = null;
    let allUsers = []; // P2修复：用于负责人自动补全

    try {
        const userStr = localStorage.getItem('currentUser');
        if (userStr) {
            currentUser = JSON.parse(userStr);
        }
    } catch (e) {
        console.error('解析用户信息失败:', e);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const moduleId = urlParams.get('moduleId');
    const level1Id = urlParams.get('level1Id');
    const libraryId = urlParams.get('libraryId');
    const moduleName = urlParams.get('moduleName') || '未知模块';
    const libraryName = urlParams.get('libraryName') || '未知用例库';
    const level1Name = urlParams.get('level1Name') || '';
    // P1修复：returnUrl 参数，由入口函数显式传递，避免依赖 referrer
    const returnUrl = urlParams.get('returnUrl') || '';
    // 从上级页面传入的默认负责人（URL 参数 owner 优先，其次读取 localStorage 中的当前登录用户）
    let defaultOwner = urlParams.get('owner') || '';
    // defaultOwner 不存在时，延迟等待 currentUser 加载，在 init 开始前赋化

    // sessionStorage 缓存 key（不同模块/测试点之间不共享）
    const DRAFT_KEY = `batch_draft_${moduleId}_${level1Id || 'all'}`;

    let allLevel1Points = [];
    let configData = {
        priorities: [],
        testTypes: [],
        testPhases: [],
        environments: [],
        methods: [],
        sources: []
    };

    const PRIORITIES = ['高', '中', '低'];
    const TEST_TYPES = ['功能测试', '性能测试', '安全测试', '兼容性测试', '接口测试', 'UI测试', '回归测试', '冒烟测试'];
    const TEST_PHASES = ['单元测试', '集成测试', '系统测试', '验收测试'];
    const TEST_ENVIRONMENTS = ['开发环境', '测试环境', '预发布环境', '生产环境', '仿真环境'];
    const TEST_METHODS = ['手工测试', '自动化测试', '探索性测试', '回归测试'];
    const TEST_SOURCES = ['需求文档', '设计文档', '用户反馈', '缺陷分析', '竞品分析'];

    let batchData = [];
    let isSaving = false;
    let currentEditingIndex = null;

    // ─────────────────────────────────────────────────────────────────
    // 全部测试点模式 - 二级嵌套数据结构
    // ─────────────────────────────────────────────────────────────────
    let isAllLevel1Mode = false;
    let level1BatchData = [];

    // ─────────────────────────────────────────────────────────────────
    // TagSelector 标签多选组件
    // ─────────────────────────────────────────────────────────────────
    const DrawerTagSelector = {
        init: function(containerId, options, selectedValues, onChange) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const tagsContainer = container.querySelector('.tag-selector-tags');
            const dropdown = container.querySelector('.tag-selector-dropdown');

            container._options = options || [];
            container._selectedValues = selectedValues || [];
            container._onChange = onChange;

            this.renderTags(container);
            this.renderDropdown(container);

            if (!container.dataset.eventBound) {
                tagsContainer.addEventListener('click', (e) => {
                    if (e.target.classList.contains('remove-tag')) {
                        const value = e.target.parentElement.dataset.value;
                        this.removeValue(container, value);
                    } else {
                        this.toggleDropdown(container);
                    }
                });
                container.dataset.eventBound = 'true';
            }
        },

        renderTags: function(container) {
            const tagsContainer = container.querySelector('.tag-selector-tags');
            const selectedValues = container._selectedValues || [];

            if (selectedValues.length === 0) {
                tagsContainer.innerHTML = '<span class="tag-selector-placeholder">点击选择...</span>';
            } else {
                tagsContainer.innerHTML = selectedValues.map(value => {
                    const option = container._options.find(opt => opt.value === value);
                    return `
                        <span class="tag-selector-tag" data-value="${escapeHtml(value)}">
                            ${escapeHtml(option ? option.label : value)}
                            <span class="remove-tag">×</span>
                        </span>
                    `;
                }).join('');
            }
        },

        renderDropdown: function(container) {
            const dropdown = container.querySelector('.tag-selector-dropdown');
            const options = container._options || [];
            const selectedValues = container._selectedValues || [];

            dropdown.innerHTML = options.map(option => {
                const isSelected = selectedValues.includes(option.value);
                return `
                    <div class="tag-selector-option ${isSelected ? 'selected' : ''}" data-value="${escapeHtml(option.value)}">
                        <span class="checkbox"></span>
                        <span>${escapeHtml(option.label)}</span>
                    </div>
                `;
            }).join('');

            dropdown.querySelectorAll('.tag-selector-option').forEach(optionEl => {
                optionEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const value = optionEl.dataset.value;
                    this.toggleValue(container, value);
                });
            });
        },

        toggleDropdown: function(container) {
            const dropdown = container.querySelector('.tag-selector-dropdown');
            const tagsContainer = container.querySelector('.tag-selector-tags');
            const isShowing = dropdown.classList.contains('show');

            if (!isShowing) {
                dropdown.style.top = '';
                dropdown.style.left = '';
                dropdown.style.width = '';
                dropdown.classList.add('show');
            } else {
                dropdown.classList.remove('show');
            }

            const closeDropdown = (e) => {
                if (!container.contains(e.target)) {
                    dropdown.classList.remove('show');
                    document.removeEventListener('click', closeDropdown);
                }
            };

            setTimeout(() => {
                document.addEventListener('click', closeDropdown);
            }, 0);
        },

        toggleValue: function(container, value) {
            const selectedValues = container._selectedValues || [];
            const index = selectedValues.indexOf(value);

            if (index > -1) {
                selectedValues.splice(index, 1);
            } else {
                selectedValues.push(value);
            }

            container._selectedValues = selectedValues;
            this.renderTags(container);
            this.renderDropdown(container);

            if (container._onChange) {
                container._onChange(selectedValues);
            }
        },

        removeValue: function(container, value) {
            const selectedValues = container._selectedValues || [];
            const index = selectedValues.indexOf(value);

            if (index > -1) {
                selectedValues.splice(index, 1);
                container._selectedValues = selectedValues;
                this.renderTags(container);
                this.renderDropdown(container);

                if (container._onChange) {
                    container._onChange(selectedValues);
                }
            }
        },

        getValues: function(containerId) {
            const container = document.getElementById(containerId);
            return container ? (container._selectedValues || []) : [];
        },

        setValues: function(containerId, values) {
            const container = document.getElementById(containerId);
            if (container) {
                container._selectedValues = [...(values || [])];
                this.renderTags(container);
                this.renderDropdown(container);
            }
        }
    };

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function hasDetailData(row) {
        return !!(row.precondition || row.purpose || row.steps || row.expected ||
                  row.key_config || row.remark || row.projects || row.environments ||
                  row.methods || row.sources);
    }

    function showSuccessMessage(message) {
        const toast = document.getElementById('success-toast');
        const content = toast?.querySelector('.success-toast-content');
        if (content && toast) {
            content.textContent = message;
            toast.style.display = 'block';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 3000);
        }
    }

    function showErrorMessage(message) {
        const modal = document.getElementById('error-modal');
        const errorMessage = document.getElementById('error-message');
        if (errorMessage && modal) {
            errorMessage.textContent = message;
            modal.style.display = 'flex';
        }
    }

    function showConfirmMessage(message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            const confirmMessage = document.getElementById('confirm-message');
            const confirmOk = document.getElementById('confirm-ok');
            const confirmCancel = document.getElementById('confirm-cancel');

            if (confirmMessage && modal) {
                confirmMessage.textContent = message;
                modal.style.display = 'flex';

                const cleanup = () => {
                    confirmOk.removeEventListener('click', handleOk);
                    confirmCancel.removeEventListener('click', handleCancel);
                    modal.style.display = 'none';
                };
                const handleOk = () => { cleanup(); resolve(true); };
                const handleCancel = () => { cleanup(); resolve(false); };

                confirmOk.addEventListener('click', handleOk);
                confirmCancel.addEventListener('click', handleCancel);
            } else {
                resolve(false);
            }
        });
    }

    function hasUnsavedData() {
        if (isAllLevel1Mode) {
            return level1BatchData.some(item => {
                if (item.name && item.name.trim()) return true;
                return item.cases.some(c => c.name && c.name.trim());
            });
        }
        return batchData.some(row => row.name && row.name.trim() !== '');
    }

    function showUnsavedModal() {
        return new Promise((resolve) => {
            const modal = document.getElementById('unsaved-modal');
            const btnCancel = document.getElementById('unsaved-cancel');
            const btnSaveAndBack = document.getElementById('unsaved-save-and-back');
            const btnBackOnly = document.getElementById('unsaved-back-only');

            if (!modal) {
                resolve('back');
                return;
            }

            modal.style.display = 'flex';

            const cleanup = () => {
                btnCancel.removeEventListener('click', handleCancel);
                btnSaveAndBack.removeEventListener('click', handleSaveAndBack);
                btnBackOnly.removeEventListener('click', handleBackOnly);
                modal.style.display = 'none';
            };

            const handleCancel = () => { cleanup(); resolve('cancel'); };
            const handleSaveAndBack = () => { cleanup(); resolve('save_and_back'); };
            const handleBackOnly = () => { cleanup(); resolve('back'); };

            btnCancel.addEventListener('click', handleCancel);
            btnSaveAndBack.addEventListener('click', handleSaveAndBack);
            btnBackOnly.addEventListener('click', handleBackOnly);
        });
    }

    // P1修复：统一不带 /api 前缀（与主站script.js保持一致）
    async function apiRequest(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        try {
            const response = await fetch(url, { ...options, headers });
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('API请求错误:', error);
            return { success: false, message: '网络请求失败' };
        }
    }

    async function loadConfigData() {
        try {
            const [prioritiesRes, typesRes, phasesRes, envsRes, methodsRes, sourcesRes] = await Promise.all([
                apiRequest('/api/priorities/list'),
                apiRequest('/api/test-types/list'),
                apiRequest('/api/test-phases/list'),
                apiRequest('/api/environments/list'),
                apiRequest('/api/test-methods/list'),
                apiRequest('/api/test-sources/list')
            ]);

            if (prioritiesRes.success && prioritiesRes.priorities) {
                configData.priorities = prioritiesRes.priorities;
            }
            if (typesRes.success && typesRes.testTypes) {
                configData.testTypes = typesRes.testTypes;
            }
            if (phasesRes.success && phasesRes.testPhases) {
                configData.testPhases = phasesRes.testPhases;
            }
            if (envsRes.success && envsRes.environments) {
                configData.environments = envsRes.environments;
            }
            if (methodsRes && methodsRes.success && methodsRes.testMethods) {
                configData.methods = methodsRes.testMethods;
            }
            if (sourcesRes && sourcesRes.success && sourcesRes.sources) {
                configData.sources = sourcesRes.sources;
            }
        } catch (error) {
            console.error('加载配置数据失败:', error);
        }
    }

    // P2修复：加载用户列表用于负责人自动补全
    async function loadUsers() {
        try {
            const res = await apiRequest('/users/list');
            if (res.success && res.users) {
                allUsers = res.users.map(u => u.username);
                updateOwnerDatalist();
            }
        } catch (error) {
            console.error('加载用户列表失败:', error);
        }
    }

    function updateOwnerDatalist() {
        let datalist = document.getElementById('owner-datalist');
        if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = 'owner-datalist';
            document.body.appendChild(datalist);
        }
        datalist.innerHTML = allUsers.map(u => `<option value="${escapeHtml(u)}">`).join('');
    }

    async function loadAllLevel1Points() {
        try {
            const result = await apiRequest('/testpoints/level1/all', {
                method: 'POST',
                body: JSON.stringify({ libraryId: libraryId })
            });

            if (result.success && result.level1Points) {
                allLevel1Points = result.level1Points;
            }
        } catch (error) {
            console.error('加载一级测试点列表失败:', error);
        }
    }

    // ── 获取当前配置列表（优先用API数据，否则回退硬编码常量）────────
    function getPriorities() {
        return configData.priorities.length > 0 ? configData.priorities.map(p => p.name) : PRIORITIES;
    }
    function getTestTypes() {
        return configData.testTypes.length > 0 ? configData.testTypes.map(t => t.name) : TEST_TYPES;
    }
    function getTestPhases() {
        return configData.testPhases.length > 0 ? configData.testPhases.map(p => p.name) : TEST_PHASES;
    }
    function getTestEnvs() {
        return configData.environments.length > 0 ? configData.environments.map(e => e.name) : TEST_ENVIRONMENTS;
    }
    function getUsers() {
        const users = allUsers.length > 0 ? allUsers : (currentUser ? [currentUser.username] : []);
        return users.filter(u => u.toLowerCase() !== 'admin');
    }

    function createEmptyRow(defaults = {}) {
        return {
            id: Date.now() + Math.random(),
            name: '',
            priority: defaults.priority || (getPriorities()[1] || '中'),
            type: defaults.type || (getTestTypes()[0] || '功能测试'),
            owner: defaults.owner || (currentUser ? currentUser.username : ''),
            phase: defaults.phase || (getTestPhases()[1] || '集成测试'),
            env: defaults.env || (getTestEnvs()[1] || '测试环境')
        };
    }

    // ─────────────────────────────────────────────────────────────────
    // 全部测试点模式 - 一级测试点相关函数
    // ─────────────────────────────────────────────────────────────────
    function createEmptyLevel1() {
        return {
            type: 'level1',
            id: 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: '',
            priority: '中',
            owner: defaultOwner || (currentUser ? currentUser.username : ''),
            expanded: true,
            cases: [createEmptyRow()]
        };
    }

    function getLevel1RowHTML(item, level1Index) {
        const testTypes = getTestTypes();
        const caseCount = item.cases ? item.cases.length : 0;
        const hasCases = caseCount > 0;
        const expandIconClass = item.expanded ? 'expanded' : (hasCases ? '' : 'empty');
        
        return `
            <tr class="level1-row" data-level1-index="${level1Index}" data-type="level1">
                <td class="level1-expand-cell">
                    <span class="level1-expand-icon ${expandIconClass}" data-action="toggle-expand" data-level1-index="${level1Index}">
                        ${hasCases ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>` : ''}
                    </span>
                </td>
                <td class="level1-index-cell">
                    <span style="font-weight: 600; color: #1890ff;">${level1Index + 1}</span>
                </td>
                <td>
                    <div class="level1-name-cell">
                        <span class="folder-icon">📁</span>
                        <input type="text"
                               class="cell-input"
                               data-field="name"
                               data-level1-index="${level1Index}"
                               data-type="level1"
                               value="${escapeHtml(item.name)}"
                               placeholder="请输入测试点名称"
                               maxlength="100"
                               style="font-weight: 600;">
                    </div>
                </td>
                <td>
                    <select class="cell-select" data-field="type" data-level1-index="${level1Index}" data-type="level1">
                        ${testTypes.map(t => `<option value="${t}" ${item.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </td>
                <td class="col-level1-actions" colspan="4">
                    <div class="level1-actions">
                    <button class="action-btn add-case-btn" data-action="add-case" data-level1-index="${level1Index}" data-tooltip="添加测试用例">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <button class="action-btn copy-btn" data-action="copy-level1" data-level1-index="${level1Index}" data-tooltip="复制测试点">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete-btn" data-action="delete-level1" data-level1-index="${level1Index}" data-tooltip="删除测试点">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function getCaseTableHeaderHTML() {
        return `
            <tr class="case-header-row">
                <th class="col-expand" style="width: 40px;"></th>
                <th class="col-index">#</th>
                <th class="col-name">测试用例名称</th>
                <th class="col-priority">优先级</th>
                <th class="col-type">测试类型</th>
                <th class="col-owner">负责人</th>
                <th class="col-phase">测试阶段</th>
                <th class="col-env">测试环境</th>
                <th class="col-actions">操作</th>
            </tr>
        `;
    }

    function getCaseRowHTML(caseItem, level1Index, caseIndex, globalCaseIndex) {
        const testTypes = getTestTypes();
        const testPhases = getTestPhases();
        const testEnvs = getTestEnvs();
        const collapsed = !level1BatchData[level1Index]?.expanded;
        
        return `
            <tr class="case-row ${collapsed ? 'collapsed' : ''}" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-type="case">
                <td class="level1-expand-cell"></td>
                <td class="col-index-cell">
                    <span style="color: #52c41a; font-weight: 600;">${globalCaseIndex}</span>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="color: #52c41a; font-size: 14px;">📄</span>
                        <input type="text"
                               class="cell-input"
                               data-field="name"
                               data-level1-index="${level1Index}"
                               data-case-index="${caseIndex}"
                               data-type="case"
                               value="${escapeHtml(caseItem.name)}"
                               placeholder="请输入用例名称"
                               maxlength="100">
                    </div>
                </td>
                <td>
                    <select class="cell-select" data-field="priority" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-type="case">
                        ${getPriorities().map(p => `<option value="${p}" ${caseItem.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="cell-select" data-field="type" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-type="case">
                        ${testTypes.map(t => `<option value="${t}" ${caseItem.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="cell-select" data-field="owner" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-type="case">
                        ${getUsers().map(u => `<option value="${u}" ${caseItem.owner === u ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="cell-select" data-field="phase" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-type="case">
                        ${testPhases.map(p => `<option value="${p}" ${caseItem.phase === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="cell-select" data-field="env" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-type="case">
                        ${testEnvs.map(e => `<option value="${e}" ${caseItem.env === e ? 'selected' : ''}>${e}</option>`).join('')}
                    </select>
                </td>
                <td class="col-actions">
                    <div class="actions-cell">
                    <button class="action-btn detail-btn ${hasDetailData(caseItem) ? 'has-detail' : ''}" data-action="detail" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-tooltip="${hasDetailData(caseItem) ? '已完善详情' : '详细信息'}">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                    </button>
                    <button class="action-btn clone-btn" data-action="clone" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-tooltip="从库中克隆已有用例">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="10" cy="10" r="7"></circle>
                            <line x1="21" y1="21" x2="15" y2="15"></line>
                            <line x1="10" y1="7" x2="10" y2="13"></line>
                            <line x1="7" y1="10" x2="13" y2="10"></line>
                        </svg>
                    </button>
                    <button class="action-btn copy-btn" data-action="copy" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-tooltip="复制">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete-btn" data-action="delete" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-tooltip="删除">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function renderLevel1Table() {
        const tbody = document.getElementById('table-body');
        if (!tbody) return;

        const table = document.getElementById('batch-table');
        if (table) {
            table.classList.add('level1-mode');
        }

        updateLevel1CountHint();
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(level1BatchData)); } catch(_) {}

        let html = '';
        let globalCaseIndex = 0;

        level1BatchData.forEach((item, level1Index) => {
            html += getLevel1RowHTML(item, level1Index);
            
            if (item.expanded && item.cases && item.cases.length > 0) {
                html += getCaseTableHeaderHTML();
                item.cases.forEach((caseItem, caseIndex) => {
                    globalCaseIndex++;
                    html += getCaseRowHTML(caseItem, level1Index, caseIndex, globalCaseIndex);
                });
            }
        });

        tbody.innerHTML = html;
        updateAddCaseButtonState();
    }

    function updateLevel1CountHint() {
        const hint = document.getElementById('level1-count-hint');
        if (hint) {
            const level1Count = level1BatchData.length;
            let totalCases = 0;
            level1BatchData.forEach(item => {
                totalCases += (item.cases ? item.cases.length : 0);
            });
            hint.textContent = `共 ${level1Count} 个测试点，${totalCases} 条用例`;
        }
    }

    function updateAddCaseButtonState() {
        const btn = document.getElementById('add-case-to-level1-btn');
        if (btn) {
            btn.disabled = level1BatchData.length === 0;
        }
    }

    function toggleLevel1Expand(level1Index) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        
        level1BatchData[level1Index].expanded = !level1BatchData[level1Index].expanded;
        renderLevel1Table();
    }

    function addLevel1Row() {
        if (level1BatchData.length >= MAX_ROWS) {
            showErrorMessage(`已达到最大限制（${MAX_ROWS}条），请分批提交`);
            return;
        }
        
        const newLevel1 = createEmptyLevel1();
        level1BatchData.push(newLevel1);
        renderLevel1Table();
        
        const tbody = document.getElementById('table-body');
        if (tbody) {
            const lastLevel1Row = tbody.querySelector(`tr[data-level1-index="${level1BatchData.length - 1}"]`);
            if (lastLevel1Row) {
                const nameInput = lastLevel1Row.querySelector('.cell-input[data-field="name"]');
                if (nameInput) nameInput.focus();
            }
        }
        
        showSuccessMessage('已添加新测试点');
    }

    function addCaseToLevel1(level1Index) {
        if (level1Index === undefined || level1Index === null) {
            if (level1BatchData.length === 0) {
                showErrorMessage('请先添加一级测试点');
                return;
            }
            level1Index = level1BatchData.length - 1;
        }
        
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        
        let totalCases = 0;
        level1BatchData.forEach(item => {
            totalCases += (item.cases ? item.cases.length : 0);
        });
        if (totalCases >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条），请分批提交`);
            return;
        }
        
        level1BatchData[level1Index].cases.push(createEmptyRow());
        level1BatchData[level1Index].expanded = true;
        renderLevel1Table();
        
        const tbody = document.getElementById('table-body');
        if (tbody) {
            const caseRows = tbody.querySelectorAll(`tr.case-row[data-level1-index="${level1Index}"]`);
            if (caseRows.length > 0) {
                const lastCaseRow = caseRows[caseRows.length - 1];
                const nameInput = lastCaseRow.querySelector('.cell-input[data-field="name"]');
                if (nameInput) nameInput.focus();
            }
        }
    }

    function handleLevel1TableInput(event) {
        const target = event.target;
        if (!target.matches('.cell-input, .cell-select')) return;

        const rowType = target.dataset.type;
        const level1Index = parseInt(target.dataset.level1Index, 10);
        const field = target.dataset.field;
        const value = target.value;

        if (isNaN(level1Index) || !field) return;

        if (rowType === 'level1') {
            if (level1BatchData[level1Index]) {
                level1BatchData[level1Index][field] = value;
            }
        } else if (rowType === 'case') {
            const caseIndex = parseInt(target.dataset.caseIndex, 10);
            if (!isNaN(caseIndex) && level1BatchData[level1Index] && level1BatchData[level1Index].cases[caseIndex]) {
                level1BatchData[level1Index].cases[caseIndex][field] = value;
            }
        }
        
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(level1BatchData)); } catch(_) {}
    }

    function handleLevel1TableAction(event) {
        const target = event.target.closest('.action-btn, .level1-expand-icon');
        if (!target) return;

        const action = target.dataset.action;
        const level1Index = parseInt(target.dataset.level1Index, 10);
        const caseIndex = parseInt(target.dataset.caseIndex, 10);

        if (action === 'toggle-expand') {
            event.preventDefault();
            event.stopPropagation();
            toggleLevel1Expand(level1Index);
        } else if (action === 'add-case') {
            addCaseToLevel1(level1Index);
        } else if (action === 'copy-level1') {
            copyLevel1Row(level1Index);
        } else if (action === 'delete-level1') {
            deleteLevel1Row(level1Index);
        } else if (action === 'detail') {
            openDrawerForCase(level1Index, caseIndex);
        } else if (action === 'clone') {
            window.openCloneCaseModalForLevel1(level1Index, caseIndex);
        } else if (action === 'copy') {
            copyCaseInLevel1(level1Index, caseIndex);
        } else if (action === 'delete') {
            deleteCaseInLevel1(level1Index, caseIndex);
        }
    }

    function copyLevel1Row(level1Index) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        
        if (level1BatchData.length >= MAX_ROWS) {
            showErrorMessage(`已达到最大限制（${MAX_ROWS}条），请分批提交`);
            return;
        }
        
        const original = level1BatchData[level1Index];
        const copy = {
            ...original,
            id: 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: original.name ? `${original.name}-Copy` : '',
            cases: original.cases.map(c => ({
                ...c,
                id: Date.now() + Math.random(),
                name: c.name ? `${c.name}-Copy` : ''
            }))
        };
        
        level1BatchData.splice(level1Index + 1, 0, copy);
        renderLevel1Table();
        showSuccessMessage('已复制测试点');
    }

    async function deleteLevel1Row(level1Index) {
        if (level1BatchData.length <= 1) {
            showErrorMessage('至少保留一个测试点');
            return;
        }
        
        const item = level1BatchData[level1Index];
        const caseCount = item.cases ? item.cases.length : 0;
        
        let message = `确定要删除测试点「${item.name || '未命名'}」吗？`;
        if (caseCount > 0) {
            message += `\n该测试点下有 ${caseCount} 个测试用例，将一并删除。`;
        }
        
        const confirmed = await showConfirmMessage(message);
        if (!confirmed) return;
        
        level1BatchData.splice(level1Index, 1);
        renderLevel1Table();
        showSuccessMessage('删除成功');
    }

    function copyCaseInLevel1(level1Index, caseIndex) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        const cases = level1BatchData[level1Index].cases;
        if (caseIndex < 0 || caseIndex >= cases.length) return;
        
        let totalCases = 0;
        level1BatchData.forEach(item => {
            totalCases += (item.cases ? item.cases.length : 0);
        });
        if (totalCases >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条），请分批提交`);
            return;
        }
        
        const original = cases[caseIndex];
        const copy = {
            ...original,
            id: Date.now() + Math.random(),
            name: original.name ? `${original.name}-Copy` : ''
        };
        
        cases.splice(caseIndex + 1, 0, copy);
        level1BatchData[level1Index].expanded = true;
        renderLevel1Table();
        showSuccessMessage('已复制用例');
    }

    async function deleteCaseInLevel1(level1Index, caseIndex) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        const cases = level1BatchData[level1Index].cases;
        if (cases.length <= 1) {
            showErrorMessage('每个测试点至少保留一条用例');
            return;
        }
        
        const confirmed = await showConfirmMessage('确定要删除该用例吗？');
        if (!confirmed) return;
        
        cases.splice(caseIndex, 1);
        renderLevel1Table();
        showSuccessMessage('删除成功');
    }

    function openDrawerForCase(level1Index, caseIndex) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        const cases = level1BatchData[level1Index].cases;
        if (caseIndex < 0 || caseIndex >= cases.length) return;

        currentEditingIndex = { level1Index, caseIndex };
        const row = cases[caseIndex];

        const drawerTitle = document.querySelector('.drawer-title');
        if (drawerTitle) {
            const caseName = row.name && row.name.trim() ? row.name.trim() : '（未命名）';
            drawerTitle.textContent = `编辑用例详情 — ${caseName}`;
        }

        const preconditionEl = document.getElementById('drawer-precondition');
        const purposeEl = document.getElementById('drawer-purpose');
        const stepsEl = document.getElementById('drawer-steps');
        const expectedEl = document.getElementById('drawer-expected');
        const keyConfigEl = document.getElementById('drawer-key-config');
        const remarkEl = document.getElementById('drawer-remark');

        if (preconditionEl) preconditionEl.value = row.precondition || '';
        if (purposeEl) purposeEl.value = row.purpose || '';
        if (stepsEl) stepsEl.value = row.steps || '';
        if (expectedEl) expectedEl.value = row.expected || '';
        if (keyConfigEl) keyConfigEl.value = row.key_config || '';
        if (remarkEl) remarkEl.value = row.remark || '';

        initDrawerTagSelectors(row);
        initDrawerProjects(row);

        const drawerOverlay = document.getElementById('drawer-overlay');
        const drawer = document.getElementById('detail-drawer');

        if (drawerOverlay) drawerOverlay.classList.add('active');
        if (drawer) drawer.classList.add('active');
    }

    function syncDrawerToLevel1Data() {
        if (!currentEditingIndex || currentEditingIndex.level1Index === undefined) return;
        const { level1Index, caseIndex } = currentEditingIndex;
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        const cases = level1BatchData[level1Index].cases;
        if (caseIndex < 0 || caseIndex >= cases.length) return;

        cases[caseIndex].precondition = document.getElementById('drawer-precondition')?.value || '';
        cases[caseIndex].purpose = document.getElementById('drawer-purpose')?.value || '';
        cases[caseIndex].steps = document.getElementById('drawer-steps')?.value || '';
        cases[caseIndex].expected = document.getElementById('drawer-expected')?.value || '';
        cases[caseIndex].key_config = document.getElementById('drawer-key-config')?.value || '';
        cases[caseIndex].remark = document.getElementById('drawer-remark')?.value || '';
        cases[caseIndex].environments = DrawerTagSelector.getValues('drawer-environments-selector').join(',');
        cases[caseIndex].methods = DrawerTagSelector.getValues('drawer-methods-selector').join(',');
        cases[caseIndex].sources = DrawerTagSelector.getValues('drawer-sources-selector').join(',');
        cases[caseIndex].projects = document.getElementById('drawer-projects')?.value || '';
    }

    function saveDrawerDataForLevel1() {
        if (!currentEditingIndex || currentEditingIndex.level1Index === undefined) return;
        
        const { level1Index, caseIndex } = currentEditingIndex;
        if (level1Index < 0 || level1Index >= level1BatchData.length) {
            showErrorMessage('数据不存在');
            closeDrawer();
            return;
        }
        
        syncDrawerToLevel1Data();
        closeDrawer();
        
        const tbody = document.getElementById('table-body');
        if (tbody) {
            const caseRow = tbody.querySelector(`tr.case-row[data-level1-index="${level1Index}"][data-case-index="${caseIndex}"]`);
            if (caseRow) {
                const btn = caseRow.querySelector('.detail-btn');
                if (btn) {
                    const hasDetail = hasDetailData(level1BatchData[level1Index].cases[caseIndex]);
                    if (hasDetail) {
                        btn.classList.add('has-detail');
                        btn.setAttribute('data-tooltip', '已完善详情');
                    } else {
                        btn.classList.remove('has-detail');
                        btn.setAttribute('data-tooltip', '详细信息');
                    }
                }
            }
        }
        
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(level1BatchData)); } catch(_) {}
        showSuccessMessage('详情保存成功');
    }

    function validateLevel1Data() {
        const errors = [];
        level1BatchData.forEach((item, level1Index) => {
            if (!item.name || item.name.trim() === '') {
                errors.push(`测试点 ${level1Index + 1}：测试点名称不能为空`);
            }
            if (!item.cases || item.cases.length === 0) {
                errors.push(`测试点 ${level1Index + 1}：至少需要一条测试用例`);
            } else {
                item.cases.forEach((caseItem, caseIndex) => {
                    if (!caseItem.name || caseItem.name.trim() === '') {
                        errors.push(`测试点 ${level1Index + 1} 的用例 ${caseIndex + 1}：用例名称不能为空`);
                    }
                });
            }
        });
        return errors;
    }

    async function saveBatchForLevel1() {
        if (isSaving) return;

        if (currentEditingIndex !== null && currentEditingIndex.level1Index !== undefined) {
            syncDrawerToLevel1Data();
        }

        const errors = validateLevel1Data();
        if (errors.length > 0) {
            showErrorMessage(errors[0]);
            return;
        }

        isSaving = true;
        const saveBtn = document.getElementById('save-btn');
        const btnText = saveBtn?.querySelector('.btn-text');
        const btnLoading = saveBtn?.querySelector('.btn-loading');

        if (saveBtn) {
            saveBtn.disabled = true;
            if (btnText) btnText.style.display = 'none';
            if (btnLoading) btnLoading.style.display = 'flex';
        }

        try {
            const payload = {
                moduleId: moduleId,
                libraryId: libraryId,
                level1Points: level1BatchData.map(item => ({
                    name: item.name.trim(),
                    priority: item.priority,
                    owner: item.owner || currentUser?.username || '',
                    cases: item.cases.map(caseItem => ({
                        name: caseItem.name.trim(),
                        priority: caseItem.priority,
                        type: caseItem.type,
                        owner: caseItem.owner || item.owner || currentUser?.username || '',
                        phase: caseItem.phase,
                        env: caseItem.env,
                        precondition: caseItem.precondition || '',
                        purpose: caseItem.purpose || '',
                        steps: caseItem.steps || '',
                        expected: caseItem.expected || '',
                        key_config: caseItem.key_config || '',
                        remark: caseItem.remark || '',
                        projects: caseItem.projects || '',
                        environments: caseItem.environments || '',
                        methods: caseItem.methods || '',
                        sources: caseItem.sources || ''
                    }))
                }))
            };

            const result = await apiRequest('/api/testpoints/level1/batch-create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (result.success) {
                try { sessionStorage.removeItem(DRAFT_KEY); } catch(_) {}
                showSaveSuccessBanner(result.data?.caseCount || 0);
            } else {
                showErrorMessage(result.message || '批量创建失败');
            }
        } catch (error) {
            console.error('保存错误:', error);
            showErrorMessage('保存失败，请重试');
        } finally {
            isSaving = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                if (btnText) btnText.style.display = 'inline';
                if (btnLoading) btnLoading.style.display = 'none';
            }
        }
    }

    function hasUnsavedDataForLevel1() {
        return level1BatchData.some(item => {
            if (item.name && item.name.trim()) return true;
            return item.cases.some(c => c.name && c.name.trim());
        });
    }

    function applyBulkDefaultsToLevel1(priority, type, phase, env, scope) {
        level1BatchData.forEach((item, level1Index) => {
            if (priority && (scope === 'all' || !item.priority)) {
                item.priority = priority;
            }
            if (item.cases) {
                item.cases.forEach((caseItem, caseIndex) => {
                    const isTarget = scope === 'all' || (scope === 'empty' && !caseItem.name.trim());
                    if (isTarget) {
                        if (priority) caseItem.priority = priority;
                        if (type) caseItem.type = type;
                        if (phase) caseItem.phase = phase;
                        if (env) caseItem.env = env;
                    }
                });
            }
        });
        
        renderLevel1Table();
        closeBulkDefaultsModal();
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(level1BatchData)); } catch(_) {}
        showSuccessMessage('已批量应用默认值');
    }

    function getRowHTML(row, index) {
        const priorities = getPriorities();
        const testTypes  = getTestTypes();
        const testPhases = getTestPhases();
        const testEnvs   = getTestEnvs();
        return `
                <td class="col-index-cell">${index + 1}</td>
                <td>
                    <input type="text"
                           class="cell-input"
                           data-field="name"
                           data-index="${index}"
                           value="${escapeHtml(row.name)}"
                           placeholder="请输入用例名称"
                           maxlength="100">
                </td>
                <td>
                    <select class="cell-select" data-field="priority" data-index="${index}">
                        ${priorities.map(p => `<option value="${p}" ${row.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="cell-select" data-field="type" data-index="${index}">
                        ${testTypes.map(t => `<option value="${t}" ${row.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <input type="text"
                           class="cell-input"
                           data-field="owner"
                           data-index="${index}"
                           value="${escapeHtml(row.owner)}"
                           placeholder="负责人"
                           maxlength="50"
                           list="owner-datalist">
                </td>
                <td>
                    <select class="cell-select" data-field="phase" data-index="${index}">
                        ${testPhases.map(p => `<option value="${p}" ${row.phase === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="cell-select" data-field="env" data-index="${index}">
                        ${testEnvs.map(e => `<option value="${e}" ${row.env === e ? 'selected' : ''}>${e}</option>`).join('')}
                    </select>
                </td>
                <td class="col-actions">
                    <div class="actions-cell">
                    <button class="action-btn detail-btn ${hasDetailData(row) ? 'has-detail' : ''}" data-action="detail" data-index="${index}" data-tooltip="${hasDetailData(row) ? '已完善详情' : '详细信息'}">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                    </button>
                    <button class="action-btn clone-btn" data-action="clone" data-index="${index}" data-tooltip="从库中克隆已有用例">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="10" cy="10" r="7"></circle>
                            <line x1="21" y1="21" x2="15" y2="15"></line>
                            <line x1="10" y1="7" x2="10" y2="13"></line>
                            <line x1="7" y1="10" x2="13" y2="10"></line>
                        </svg>
                    </button>
                    <button class="action-btn copy-btn" data-action="copy" data-index="${index}" data-tooltip="复制">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete-btn" data-action="delete" data-index="${index}" data-tooltip="删除">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                    </div>
                </td>
        `;
    }

    function renderTable() {
        const tbody = document.getElementById('table-body');
        if (!tbody) return;

        updateRowCountHint();
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(batchData)); } catch(_) {}

        const htmls = batchData.map((row, index) => {
            return `<tr data-row-index="${index}">${getRowHTML(row, index)}</tr>`;
        });
        tbody.innerHTML = htmls.join('');
    }

    function updateIndicesFrom(startIndex) {
        const tbody = document.getElementById('table-body');
        if (!tbody) return;
        for (let i = startIndex; i < batchData.length; i++) {
            const tr = tbody.children[i];
            if (!tr) continue;
            tr.dataset.rowIndex = i;
            const indexCell = tr.querySelector('.col-index-cell');
            if (indexCell) indexCell.textContent = i + 1;
            tr.querySelectorAll('[data-index]').forEach(el => {
                el.dataset.index = i;
            });
        }
    }

    // P2修复：行数提示
    function updateRowCountHint() {
        let hint = document.getElementById('row-count-hint');
        if (!hint) return;
        const count = batchData.length;
        hint.textContent = `共 ${count} 条`;
        hint.style.color = count >= MAX_ROWS ? '#ff4d4f' : '#999';
    }

    function handleTableInput(event) {
        const target = event.target;
        if (!target.matches('.cell-input, .cell-select')) return;

        const index = parseInt(target.dataset.index, 10);
        const field = target.dataset.field;
        const value = target.value;

        if (!isNaN(index) && field && batchData[index]) {
            batchData[index][field] = value;
        }
    }

    function handleTableAction(event) {
        const target = event.target.closest('.action-btn');
        if (!target) return;

        const action = target.dataset.action;
        const index = parseInt(target.dataset.index, 10);

        if (isNaN(index)) return;

        if (action === 'copy') {
            copyRow(index);
        } else if (action === 'clone') {
            window.openCloneCaseModal(index);
        } else if (action === 'delete') {
            deleteRow(index);
        } else if (action === 'detail') {
            openDrawer(index);
        }
    }

    function copyRow(index) {
        if (index < 0 || index >= batchData.length) return;
        // 如果当前正在编辑该行，先把抽屉里准备保存的内容同步进来
        syncDrawerToData();

        if (batchData.length >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条），请分批提交`);
            return;
        }
        const originalRow = batchData[index];
        const newRow = {
            ...originalRow,
            id: Date.now() + Math.random(),
            name: originalRow.name ? `${originalRow.name}-Copy` : ''
        };

        batchData.splice(index + 1, 0, newRow);
        
        const tbody = document.getElementById('table-body');
        if (tbody) {
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = index + 1;
            tr.innerHTML = getRowHTML(newRow, index + 1);
            const refNode = tbody.children[index + 1];
            if (refNode) tbody.insertBefore(tr, refNode);
            else tbody.appendChild(tr);
        }
        
        updateIndicesFrom(index + 1);
        updateRowCountHint();
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(batchData)); } catch(_) {}
        
        showSuccessMessage('已复制到当前行下方');
    }

    async function deleteRow(index) {
        if (batchData.length <= 1) {
            showErrorMessage('至少保留一条数据');
            return;
        }

        if (index < 0 || index >= batchData.length) return;

        const confirmed = await showConfirmMessage('确定要删除该行数据吗？');
        if (!confirmed) return;

        batchData.splice(index, 1);
        
        const tbody = document.getElementById('table-body');
        if (tbody && tbody.children[index]) {
            tbody.children[index].remove();
        }
        
        updateIndicesFrom(index);
        updateRowCountHint();
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(batchData)); } catch(_) {}
        
        showSuccessMessage('删除成功');
    }

    // P2修复：抽屉标题显示行号和用例名称
    function openDrawer(index) {
        if (index < 0 || index >= batchData.length) return;

        currentEditingIndex = index;
        const row = batchData[index];

        // 更新抽屉标题
        const drawerTitle = document.querySelector('.drawer-title');
        if (drawerTitle) {
            const caseName = row.name && row.name.trim() ? row.name.trim() : '（未命名）';
            drawerTitle.textContent = `编辑第 ${index + 1} 行详情 — ${caseName}`;
        }

        // 测试内容字段
        const preconditionEl = document.getElementById('drawer-precondition');
        const purposeEl = document.getElementById('drawer-purpose');
        const stepsEl = document.getElementById('drawer-steps');
        const expectedEl = document.getElementById('drawer-expected');
        const keyConfigEl = document.getElementById('drawer-key-config');
        const remarkEl = document.getElementById('drawer-remark');

        if (preconditionEl) preconditionEl.value = row.precondition || '';
        if (purposeEl) purposeEl.value = row.purpose || '';
        if (stepsEl) stepsEl.value = row.steps || '';
        if (expectedEl) expectedEl.value = row.expected || '';
        if (keyConfigEl) keyConfigEl.value = row.key_config || '';
        if (remarkEl) remarkEl.value = row.remark || '';

        // 初始化 TagSelector 组件
        initDrawerTagSelectors(row);

        // 初始化关联项目（异步加载项目列表）
        initDrawerProjects(row);

        const drawerOverlay = document.getElementById('drawer-overlay');
        const drawer = document.getElementById('detail-drawer');

        if (drawerOverlay) drawerOverlay.classList.add('active');
        if (drawer) drawer.classList.add('active');
    }

    // 初始化 Drawer 中的 TagSelector 组件
    function initDrawerTagSelectors(row) {
        // 获取选项列表
        const envOptions = getTestEnvs().map(e => ({ value: e, label: e }));
        const methodOptions = getTestMethods().map(m => ({ value: m, label: m }));
        const sourceOptions = getTestSources().map(s => ({ value: s, label: s }));

        // 解析已选值
        const selectedEnvs = row.environments ? row.environments.split(',').map(e => e.trim()).filter(e => e) : [];
        const selectedMethods = row.methods ? row.methods.split(',').map(m => m.trim()).filter(m => m) : [];
        const selectedSources = row.sources ? row.sources.split(',').map(s => s.trim()).filter(s => s) : [];

        // 初始化 TagSelector
        DrawerTagSelector.init('drawer-environments-selector', envOptions, selectedEnvs, (values) => {
            if (currentEditingIndex !== null && batchData[currentEditingIndex]) {
                batchData[currentEditingIndex].environments = values.join(',');
            }
        });

        DrawerTagSelector.init('drawer-methods-selector', methodOptions, selectedMethods, (values) => {
            if (currentEditingIndex !== null && batchData[currentEditingIndex]) {
                batchData[currentEditingIndex].methods = values.join(',');
            }
        });

        DrawerTagSelector.init('drawer-sources-selector', sourceOptions, selectedSources, (values) => {
            if (currentEditingIndex !== null && batchData[currentEditingIndex]) {
                batchData[currentEditingIndex].sources = values.join(',');
            }
        });
    }

    function getTestMethods() {
        return configData.methods.length > 0 ? configData.methods.map(m => m.name) : TEST_METHODS;
    }

    function getTestSources() {
        return configData.sources.length > 0 ? configData.sources.map(s => s.name) : TEST_SOURCES;
    }

    // ─────────────────────────────────────────────────────────────────
    // 关联项目功能
    // ─────────────────────────────────────────────────────────────────
    let drawerSelectedProjects = []; // 保存对象列表: { project_id, owner, progress_id, status_id, remark }
    let allProjects = [];
    let globalTestProgresses = [];
    let globalTestStatuses = [];

    async function loadAllProjects() {
        try {
            const [projectsRes, progressRes, statusRes] = await Promise.all([
                apiRequest('/api/projects/list'),
                apiRequest('/api/test-progresses/list'),
                apiRequest('/api/test-statuses/list')
            ]);

            if (projectsRes.success && projectsRes.projects) {
                allProjects = projectsRes.projects;
            }

            // 解析测试进度（兼容多种响应结构）
            const parseProgresses = (r) => {
                if (r.success && r.data && r.data.testProgresses) return r.data.testProgresses;
                if (r.success && r.testProgresses) return r.testProgresses;
                if (Array.isArray(r)) return r;
                if (r.success && Array.isArray(r.data)) return r.data;
                if (Array.isArray(r.data)) return r.data;
                return [];
            };
            globalTestProgresses = parseProgresses(progressRes);

            // 解析测试状态（兼容多种响应结构）
            const parseStatuses = (r) => {
                if (r.success && r.data && r.data.testStatuses) return r.data.testStatuses;
                if (r.success && r.testStatuses) return r.testStatuses;
                if (Array.isArray(r)) return r;
                if (r.success && Array.isArray(r.data)) return r.data;
                if (Array.isArray(r.data)) return r.data;
                return [];
            };
            globalTestStatuses = parseStatuses(statusRes);

        } catch (error) {
            console.error('加载项目列表失败:', error);
        }
    }

    async function initDrawerProjects(row) {
        // 确保项目列表已加载，以便能正确显示项目名称
        if (allProjects.length === 0) {
            await loadAllProjects();
        }
        
        try {
            const projectsValue = row.projects || '';
            if (typeof projectsValue === 'string') {
                if (projectsValue.startsWith('[')) {
                    drawerSelectedProjects = JSON.parse(projectsValue);
                } else {
                    drawerSelectedProjects = projectsValue.split(',').map(id => id.trim()).filter(id => id).map(id => ({
                        project_id: id,
                        progress_id: '',
                        status_id: '',
                        remark: ''
                    }));
                }
            } else if (Array.isArray(projectsValue)) {
                drawerSelectedProjects = [...projectsValue];
            } else {
                drawerSelectedProjects = [];
            }
        } catch (e) {
            drawerSelectedProjects = [];
        }
        renderDrawerProjects();
    }

    function renderDrawerProjects() {
        const emptyEl = document.getElementById('drawer-projects-empty');
        const listEl = document.getElementById('drawer-projects-list');
        const hiddenInput = document.getElementById('drawer-projects');
        const editBtn = document.getElementById('drawer-edit-projects-btn');

        if (!emptyEl || !listEl) return;

        if (drawerSelectedProjects.length === 0) {
            emptyEl.style.display = 'flex';
            listEl.style.display = 'none';
            if(editBtn) editBtn.style.display = 'none';
        } else {
            emptyEl.style.display = 'none';
            listEl.style.display = 'flex';
            if(editBtn) editBtn.style.display = 'inline-block';

            listEl.innerHTML = drawerSelectedProjects.map(assoc => {
                const projectId = assoc.project_id || assoc.id;
                const project = allProjects.find(p => String(p.id) === String(projectId) || p.project_id === projectId);
                const projectName = project ? project.name : projectId;
                return `
                    <span class="drawer-project-tag" data-id="${escapeHtml(String(projectId))}">
                        ${escapeHtml(projectName)}
                        <span class="remove-project" onclick="removeDrawerProject('${escapeHtml(String(projectId))}')">×</span>
                    </span>
                `;
            }).join('');
        }

        if (hiddenInput) {
            hiddenInput.value = JSON.stringify(drawerSelectedProjects);
        }
    }

    window.openDrawerProjectSelector = async function() {
        const modal = document.getElementById('drawer-project-selector-modal');
        if (!modal) return;

        if (allProjects.length === 0) {
            await loadAllProjects();
        }

        renderProjectSelectorList();
        modal.style.display = 'flex';
    };

    window.closeDrawerProjectSelector = function() {
        const modal = document.getElementById('drawer-project-selector-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    };

    function renderProjectSelectorList(filter = '') {
        const listEl = document.getElementById('drawer-project-selector-list');
        const selectedCountEl = document.getElementById('drawer-pa-selected-count');
        const totalCountEl = document.getElementById('drawer-pa-total-count');
        const selectAllCheckbox = document.getElementById('drawer-pa-select-all-checkbox');
        
        if (!listEl) return;

        let filteredProjects = allProjects;
        if (filter) {
            const lowerFilter = filter.toLowerCase();
            filteredProjects = allProjects.filter(p => 
                p.name && p.name.toLowerCase().includes(lowerFilter)
            );
        }

        if (totalCountEl) totalCountEl.textContent = allProjects.length;
        if (selectedCountEl) selectedCountEl.textContent = drawerSelectedProjects.length;

        if (filteredProjects.length === 0) {
            listEl.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: #909399;">暂无项目</td></tr>';
            return;
        }

        let allSelected = true;
        
        listEl.innerHTML = filteredProjects.map(project => {
            const assoc = drawerSelectedProjects.find(a => String(a.project_id) === String(project.id));
            const isSelected = !!assoc;
            if (!isSelected) allSelected = false;
            
            // 取当前正在编辑行的负责人，或已存储在 assoc 中的实际负责人
            const rowOwner = (currentEditingIndex !== null && batchData[currentEditingIndex])
                ? (batchData[currentEditingIndex].owner || '')
                : '';
            const displayOwner = (assoc && assoc.owner) ? assoc.owner : rowOwner;

            return `
                <tr class="pa-project-row ${isSelected ? 'selected' : ''}" data-id="${project.id}" data-owner="${escapeHtml(displayOwner)}">
                    <td class="pa-col-checkbox">
                        <input type="checkbox" class="drawer-project-item-cb" value="${project.id}" ${isSelected ? 'checked' : ''} onchange="toggleDrawerProjectCheckbox(this)">
                    </td>
                    <td class="pa-col-name" onclick="toggleDrawerProjectCheckboxFromRow('${project.id}')" style="cursor: pointer;">
                        ${escapeHtml(project.name || '未命名项目')}
                    </td>
                    <td class="pa-col-owner">
                        <span class="pa-owner-text">${escapeHtml(displayOwner) || '<span style="color:#bbb">继承行负责人</span>'}</span>
                    </td>
                    <td class="pa-col-progress">
                        <select class="form-select pa-select" name="progress-${project.id}">
                            <option value="">请选择</option>
                            ${globalTestProgresses.map(p => `<option value="${p.id || p.progress_id}" ${assoc && String(assoc.progress_id) === String(p.id || p.progress_id) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                        </select>
                    </td>
                    <td class="pa-col-status">
                        <select class="form-select pa-select" name="status-${project.id}">
                            <option value="">请选择</option>
                            ${globalTestStatuses.map(s => `<option value="${s.id || s.status_id}" ${assoc && String(assoc.status_id) === String(s.id || s.status_id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                        </select>
                    </td>
                    <td class="pa-col-remark">
                        <input type="text" class="form-input pa-input" name="remark-${project.id}" value="${escapeHtml(assoc ? (assoc.remark || '') : '')}" placeholder="备注">
                    </td>
                </tr>
            `;
        }).join('');
        
        if (selectAllCheckbox) selectAllCheckbox.checked = filteredProjects.length > 0 && allSelected;
    }

    window.filterDrawerProjects = function() {
        const searchInput = document.getElementById('drawer-project-search');
        const filter = searchInput ? searchInput.value : '';
        renderProjectSelectorList(filter);
    };

    window.toggleDrawerProjectCheckbox = function(checkboxEl) {
        toggleDrawerProjectSelection(checkboxEl.value, checkboxEl.checked);
    };

    window.toggleDrawerProjectCheckboxFromRow = function(projectId) {
        const checkboxEl = document.querySelector(`.drawer-project-item-cb[value="${projectId}"]`);
        if (checkboxEl) {
            checkboxEl.checked = !checkboxEl.checked;
            toggleDrawerProjectSelection(projectId, checkboxEl.checked);
        }
    };

    window.toggleDrawerProjectSelection = function(projectId, isSelected) {
        const index = drawerSelectedProjects.findIndex(a => String(a.project_id) === String(projectId));
        if (isSelected && index === -1) {
            drawerSelectedProjects.push({ project_id: projectId });
        } else if (!isSelected && index > -1) {
            drawerSelectedProjects.splice(index, 1);
        }
        
        const selectedCountEl = document.getElementById('drawer-pa-selected-count');
        if (selectedCountEl) selectedCountEl.textContent = drawerSelectedProjects.length;
        
        const rowEl = document.querySelector(`tr.pa-project-row[data-id="${projectId}"]`);
        if (rowEl) {
            if (isSelected) rowEl.classList.add('selected');
            else rowEl.classList.remove('selected');
        }
    };
    
    window.selectAllDrawerProjects = function() {
        document.querySelectorAll('.drawer-project-item-cb').forEach(cb => {
            if (!cb.checked) {
                cb.checked = true;
                toggleDrawerProjectSelection(cb.value, true);
            }
        });
        document.getElementById('drawer-pa-select-all-checkbox').checked = true;
    };

    window.deselectAllDrawerProjects = function() {
        document.querySelectorAll('.drawer-project-item-cb').forEach(cb => {
            if (cb.checked) {
                cb.checked = false;
                toggleDrawerProjectSelection(cb.value, false);
            }
        });
        document.getElementById('drawer-pa-select-all-checkbox').checked = false;
    };
    
    window.toggleAllDrawerProjectsFromCheckbox = function(isChecked) {
        if (isChecked) {
            window.selectAllDrawerProjects();
        } else {
            window.deselectAllDrawerProjects();
        }
    };

    window.removeDrawerProject = function(projectId) {
        const index = drawerSelectedProjects.findIndex(a => String(a.project_id) === String(projectId));
        if (index > -1) {
            drawerSelectedProjects.splice(index, 1);
            renderDrawerProjects();
        }
    };

    window.confirmDrawerProjectSelection = function() {
        // 更新页面上选中的项目的状态、阶段等字段
        const selectedRows = document.querySelectorAll('tr.pa-project-row.selected');
        selectedRows.forEach(row => {
            const projectId = row.dataset.id;
            const progressId = row.querySelector(`select[name="progress-${projectId}"]`)?.value;
            const statusId = row.querySelector(`select[name="status-${projectId}"]`)?.value;
            const remark = row.querySelector(`input[name="remark-${projectId}"]`)?.value;
            const assoc = drawerSelectedProjects.find(a => String(a.project_id) === String(projectId));
            
            if (assoc) {
                // ✅ 修复：负责人在表格里是用 data-owner 存储的，而不是 select 元素
                assoc.owner = row.dataset.owner || '';
                assoc.progress_id = progressId;
                assoc.status_id = statusId;
                assoc.remark = remark;
            }
        });
        
        renderDrawerProjects();
        closeDrawerProjectSelector();
    };

    function closeDrawer() {
        const drawerOverlay = document.getElementById('drawer-overlay');
        const drawer = document.getElementById('detail-drawer');

        if (drawerOverlay) drawerOverlay.classList.remove('active');
        if (drawer) drawer.classList.remove('active');

        currentEditingIndex = null;
    }

    // 将抄屉内当前填写的内容实时同步到 batchData（不关闭抄屉）
    function syncDrawerToData() {
        if (currentEditingIndex === null) return;
        const rowIndex = currentEditingIndex;
        if (rowIndex < 0 || rowIndex >= batchData.length) return;

        batchData[rowIndex].precondition = document.getElementById('drawer-precondition')?.value || '';
        batchData[rowIndex].purpose      = document.getElementById('drawer-purpose')?.value || '';
        batchData[rowIndex].steps        = document.getElementById('drawer-steps')?.value || '';
        batchData[rowIndex].expected     = document.getElementById('drawer-expected')?.value || '';
        batchData[rowIndex].key_config   = document.getElementById('drawer-key-config')?.value || '';
        batchData[rowIndex].remark       = document.getElementById('drawer-remark')?.value || '';

        batchData[rowIndex].environments = DrawerTagSelector.getValues('drawer-environments-selector').join(',');
        batchData[rowIndex].methods      = DrawerTagSelector.getValues('drawer-methods-selector').join(',');
        batchData[rowIndex].sources      = DrawerTagSelector.getValues('drawer-sources-selector').join(',');

        batchData[rowIndex].projects = document.getElementById('drawer-projects')?.value || '';
    }

    function saveDrawerData() {
        if (currentEditingIndex === null) return;

        // 全部测试点模式
        if (isAllLevel1Mode && typeof currentEditingIndex === 'object' && currentEditingIndex.level1Index !== undefined) {
            saveDrawerDataForLevel1();
            return;
        }

        const rowIndex = currentEditingIndex;
        if (rowIndex < 0 || rowIndex >= batchData.length) {
            showErrorMessage('数据不存在');
            closeDrawer();
            return;
        }

        syncDrawerToData();
        closeDrawer();
        
        const tbody = document.getElementById('table-body');
        if (tbody && tbody.children[rowIndex]) {
            const tr = tbody.children[rowIndex];
            const btn = tr.querySelector('.detail-btn');
            if (btn) {
                const hasDetail = hasDetailData(batchData[rowIndex]);
                if (hasDetail) {
                    btn.classList.add('has-detail');
                    btn.setAttribute('data-tooltip', '已完善详情');
                } else {
                    btn.classList.remove('has-detail');
                    btn.setAttribute('data-tooltip', '详细信息');
                }
            }
        }
        
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(batchData)); } catch(_) {}
        showSuccessMessage('详情保存成功');
    }

    // P2修复：增加行数上限检查
    function addRow() {
        if (batchData.length >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条），请先保存当前数据再继续添加`);
            return;
        }
        const newRow = createEmptyRow();
        const newIndex = batchData.length;
        batchData.push(newRow);
        
        const tbody = document.getElementById('table-body');
        if (tbody) {
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = newIndex;
            tr.innerHTML = getRowHTML(newRow, newIndex);
            tbody.appendChild(tr);
        }
        
        updateRowCountHint();
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(batchData)); } catch(_) {}

        if (tbody) {
            const lastRow = tbody.lastElementChild;
            if (lastRow) {
                const nameInput = lastRow.querySelector('.cell-input[data-field="name"]');
                if (nameInput) nameInput.focus();
            }
        }
    }

    // P2修复：批量应用默认值功能
    function applyBulkDefaults() {
        const modal = document.getElementById('bulk-defaults-modal');
        if (modal) modal.style.display = 'flex';
    }

    function closeBulkDefaultsModal() {
        const modal = document.getElementById('bulk-defaults-modal');
        if (modal) modal.style.display = 'none';
    }

    function confirmBulkDefaults() {
        const priority = document.getElementById('bulk-priority')?.value;
        const type     = document.getElementById('bulk-type')?.value;
        const phase    = document.getElementById('bulk-phase')?.value;
        const env      = document.getElementById('bulk-env')?.value;
        const scope    = document.querySelector('input[name="bulk-scope"]:checked')?.value || 'empty';

        // 全部测试点模式
        if (isAllLevel1Mode) {
            applyBulkDefaultsToLevel1(priority, type, phase, env, scope);
            return;
        }

        const tbody = document.getElementById('table-body');
        let changed = 0;
        
        batchData.forEach((row, index) => {
            const isTarget = scope === 'all' || (scope === 'empty' && !row.name.trim());
            const applyToAll = scope === 'all';
            let rowChanged = false;

            if (priority && (applyToAll || !row.priority)) { row.priority = priority; rowChanged = true; changed++; }
            if (type     && (applyToAll || !row.type))     { row.type = type; rowChanged = true; }
            if (phase    && (applyToAll || !row.phase))    { row.phase = phase; rowChanged = true; }
            if (env      && (applyToAll || !row.env))      { row.env = env; rowChanged = true; }
            
            if (rowChanged && tbody && tbody.children[index]) {
                const tr = tbody.children[index];
                if (priority) { const el = tr.querySelector('.cell-select[data-field="priority"]'); if (el) el.value = row.priority; }
                if (type)     { const el = tr.querySelector('.cell-select[data-field="type"]'); if (el) el.value = row.type; }
                if (phase)    { const el = tr.querySelector('.cell-select[data-field="phase"]'); if (el) el.value = row.phase; }
                if (env)      { const el = tr.querySelector('.cell-select[data-field="env"]'); if (el) el.value = row.env; }
            }
        });

        closeBulkDefaultsModal();
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(batchData)); } catch(_) {}
        showSuccessMessage('已批量应用默认值');
    }

    function validateData() {
        const errors = [];
        batchData.forEach((row, index) => {
            if (!row.name || row.name.trim() === '') {
                errors.push(`第 ${index + 1} 行：用例名称不能为空`);
            }
        });
        return errors;
    }

    // P1修复：直接调用 saveBatch，通过 isSaving 标志防止重复提交（放弃误用的 debounce）
    async function saveBatch() {
        if (isSaving) return;

        // 全部测试点模式
        if (isAllLevel1Mode) {
            return saveBatchForLevel1();
        }

        // ✅ 修复：如果用户处于"编辑详情"的侧滑抽屉中，尚未点击"保存详情"就直接点击上面的"批量保存"按钮
        // 需要自动将抽屉里的最新内容（如"关键配置"、"前置条件"等）强制同步进 batchData，否则会丢失！
        if (currentEditingIndex !== null) {
            syncDrawerToData();
        }

        const errors = validateData();
        if (errors.length > 0) {
            showErrorMessage(errors[0]);
            return;
        }

        isSaving = true;
        const saveBtn = document.getElementById('save-btn');
        const btnText = saveBtn?.querySelector('.btn-text');
        const btnLoading = saveBtn?.querySelector('.btn-loading');

        if (saveBtn) {
            saveBtn.disabled = true;
            if (btnText) btnText.style.display = 'none';
            if (btnLoading) btnLoading.style.display = 'flex';
        }

        try {
            const payload = {
                moduleId: moduleId,
                level1Id: level1Id,
                libraryId: libraryId,
                cases: batchData.map(row => ({
                    name: row.name.trim(),
                    priority: row.priority,
                    type: row.type,
                    owner: row.owner || currentUser?.username || '',
                    phase: row.phase,
                    env: row.env,
                    precondition: row.precondition || '',
                    purpose: row.purpose || '',
                    steps: row.steps || '',
                    expected: row.expected || '',
                    key_config: row.key_config || '',
                    remark: row.remark || '',
                    projects: row.projects || '',
                    environments: row.environments || '',
                    methods: row.methods || '',
                    sources: row.sources || ''
                }))
            };

            const result = await apiRequest('/api/testcases/batch-create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (result.success) {
                // 保存成功后清除草稿缓存
                try { sessionStorage.removeItem(DRAFT_KEY); } catch(_) {}
                showSaveSuccessBanner(result.data?.count || batchData.length);
            } else {
                showErrorMessage(result.message || '批量创建失败');
            }
        } catch (error) {
            console.error('保存错误:', error);
            showErrorMessage('保存失败，请重试');
        } finally {
            isSaving = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                if (btnText) btnText.style.display = 'inline';
                if (btnLoading) btnLoading.style.display = 'none';
            }
        }
    }

    // P2修复：保存成功后显示 Banner，提供两个选项
    function showSaveSuccessBanner(count) {
        let banner = document.getElementById('save-success-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'save-success-banner';
            banner.className = 'save-success-banner';
            banner.innerHTML = `
                <div class="save-success-banner-inner">
                    <div class="save-success-icon">✓</div>
                    <div class="save-success-text">
                        <strong id="save-success-count"></strong>
                        <span>个测试用例已成功创建</span>
                    </div>
                    <div class="save-success-actions">
                        <button class="btn btn-secondary btn-sm" id="banner-continue-btn">继续添加</button>
                        <button class="btn btn-primary btn-sm" id="banner-back-btn">返回列表</button>
                    </div>
                </div>
            `;
            document.querySelector('.batch-main').prepend(banner);

            document.getElementById('banner-back-btn').addEventListener('click', goBack);
            document.getElementById('banner-continue-btn').addEventListener('click', () => {
                banner.style.display = 'none';
                try { sessionStorage.removeItem(DRAFT_KEY); } catch(_) {}
                batchData = [createEmptyRow()];
                renderTable();
                showSuccessMessage('已清空，可继续添加');
            });
        }
        document.getElementById('save-success-count').textContent = count;
        banner.style.display = 'block';
    }

    // P1修复：returnUrl 优先，其次 history.back()，最后 hash 路由跳转
    async function goBack() {
        if (hasUnsavedData()) {
            const result = await showUnsavedModal();
            if (result === 'cancel') {
                return;
            } else if (result === 'save_and_back') {
                const errors = validateData();
                if (errors.length > 0) {
                    showErrorMessage(errors[0]);
                    return;
                }
                const success = await saveBatchAndReturn();
                if (!success) return;
            }
        }
        navigateBack();
    }

    function navigateBack() {
        if (returnUrl) {
            window.location.href = returnUrl;
        } else if (document.referrer && document.referrer.includes(window.location.host)) {
            window.history.back();
        } else {
            window.location.href = `/#/cases`;
        }
    }

    async function saveBatchAndReturn() {
        if (isSaving) return false;

        if (currentEditingIndex !== null) {
            syncDrawerToData();
        }

        isSaving = true;
        const saveBtn = document.getElementById('save-btn');
        const btnText = saveBtn?.querySelector('.btn-text');
        const btnLoading = saveBtn?.querySelector('.btn-loading');

        if (saveBtn) {
            saveBtn.disabled = true;
            if (btnText) btnText.style.display = 'none';
            if (btnLoading) btnLoading.style.display = 'flex';
        }

        try {
            const payload = {
                moduleId: moduleId,
                level1Id: level1Id,
                libraryId: libraryId,
                cases: batchData.map(row => ({
                    name: row.name.trim(),
                    priority: row.priority,
                    type: row.type,
                    owner: row.owner || currentUser?.username || '',
                    phase: row.phase,
                    env: row.env,
                    precondition: row.precondition || '',
                    purpose: row.purpose || '',
                    steps: row.steps || '',
                    expected: row.expected || '',
                    key_config: row.key_config || '',
                    remark: row.remark || '',
                    projects: row.projects || '',
                    environments: row.environments || '',
                    methods: row.methods || '',
                    sources: row.sources || ''
                }))
            };

            const result = await apiRequest('/api/testcases/batch-create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (result.success) {
                try { sessionStorage.removeItem(DRAFT_KEY); } catch(_) {}
                showSuccessMessage(`成功创建 ${result.data?.count || batchData.length} 个测试用例`);
                return true;
            } else {
                showErrorMessage(result.message || '批量创建失败');
                return false;
            }
        } catch (error) {
            console.error('保存错误:', error);
            showErrorMessage('保存失败，请重试');
            return false;
        } finally {
            isSaving = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                if (btnText) btnText.style.display = 'inline';
                if (btnLoading) btnLoading.style.display = 'none';
            }
        }
    }

    function initBreadcrumb() {
        const libraryEl = document.getElementById('breadcrumb-library');
        const moduleEl = document.getElementById('breadcrumb-module');
        const level1NameEl = document.getElementById('breadcrumb-level1-name');

        if (libraryEl) libraryEl.textContent = libraryName;
        if (moduleEl) moduleEl.textContent = moduleName;
        if (level1NameEl) level1NameEl.textContent = level1Name || '全部测试点';
    }

    function renderLevel1Dropdown(keyword = '') {
        const listEl = document.getElementById('level1-dropdown-list');
        if (!listEl) return;

        let filteredPoints = allLevel1Points;
        if (keyword && keyword.trim() !== '') {
            const lowerKeyword = keyword.trim().toLowerCase();
            filteredPoints = allLevel1Points.filter(point =>
                point.name.toLowerCase().includes(lowerKeyword) ||
                (point.module_name && point.module_name.toLowerCase().includes(lowerKeyword))
            );
        }

        let html = '';
        
        if (!keyword || keyword.trim() === '') {
            const isAllSelected = !level1Id || level1Id === '';
            html += `
                <div class="level1-dropdown-item ${isAllSelected ? 'selected' : ''}"
                     data-id=""
                     data-module-id=""
                     data-name="全部测试点"
                     data-module-name="">
                    <div class="level1-dropdown-item-name">全部测试点</div>
                    <div class="level1-dropdown-item-module">查看所有测试点</div>
                </div>
            `;
        }

        html += filteredPoints.map(point => `
            <div class="level1-dropdown-item ${point.id == level1Id ? 'selected' : ''}"
                 data-id="${point.id}"
                 data-module-id="${point.module_id}"
                 data-name="${escapeHtml(point.name)}"
                 data-module-name="${escapeHtml(point.module_name || '')}">
                <div class="level1-dropdown-item-name">${escapeHtml(point.name)}</div>
                <div class="level1-dropdown-item-module">${escapeHtml(point.module_name || '')}</div>
            </div>
        `).join('');

        listEl.innerHTML = html;

        if (filteredPoints.length === 0 && (keyword && keyword.trim() !== '')) {
            listEl.innerHTML = '<div class="level1-dropdown-empty">暂无匹配的一级测试点</div>';
        }
    }

    function toggleLevel1Dropdown(show) {
        const panel = document.getElementById('level1-panel');
        const overlay = document.getElementById('level1-panel-overlay');
        const clickableItem = document.getElementById('breadcrumb-level1');

        if (!panel || !clickableItem) return;

        if (show) {
            panel.classList.add('active');
            if (overlay) overlay.classList.add('active');
            clickableItem.classList.add('active');
            renderLevel1Dropdown();
            const searchInput = document.getElementById('level1-search-input');
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
        } else {
            panel.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
            clickableItem.classList.remove('active');
        }
    }

    async function selectLevel1Point(pointId, pointName, newModuleId, newModuleName) {
        const currentUrl = new URL(window.location.href);
        
        if (pointId && pointId !== '') {
            currentUrl.searchParams.set('level1Id', pointId);
            currentUrl.searchParams.set('level1Name', pointName);
        } else {
            currentUrl.searchParams.delete('level1Id');
            currentUrl.searchParams.delete('level1Name');
        }

        if (newModuleId && newModuleId != moduleId) {
            currentUrl.searchParams.set('moduleId', newModuleId);
            if (newModuleName) {
                currentUrl.searchParams.set('moduleName', newModuleName);
            }
        }

        window.location.href = currentUrl.toString();
    }

    // P2修复：创建批量默认值设置弹窗（动态注入 DOM）
    function createBulkDefaultsModal() {
        if (document.getElementById('bulk-defaults-modal')) return;

        const priorities = getPriorities();
        const testTypes  = getTestTypes();
        const testPhases = getTestPhases();
        const testEnvs   = getTestEnvs();

        const modal = document.createElement('div');
        modal.id = 'bulk-defaults-modal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-overlay" id="bulk-modal-overlay"></div>
            <div class="modal-content" style="max-width: 440px;">
                <div class="modal-header">
                    <span class="modal-icon confirm-icon">⚙</span>
                    <h3>批量设置默认值</h3>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom:12px; font-size:13px; color:#666;">留空的字段将保持原值不变。</div>
                    <div class="bulk-field-row">
                        <label>优先级</label>
                        <select id="bulk-priority" class="bulk-select">
                            <option value="">不修改</option>
                            ${priorities.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>
                    <div class="bulk-field-row">
                        <label>测试类型</label>
                        <select id="bulk-type" class="bulk-select">
                            <option value="">不修改</option>
                            ${testTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
                        </select>
                    </div>
                    <div class="bulk-field-row">
                        <label>测试阶段</label>
                        <select id="bulk-phase" class="bulk-select">
                            <option value="">不修改</option>
                            ${testPhases.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>
                    <div class="bulk-field-row">
                        <label>测试环境</label>
                        <select id="bulk-env" class="bulk-select">
                            <option value="">不修改</option>
                            ${testEnvs.map(e => `<option value="${e}">${e}</option>`).join('')}
                        </select>
                    </div>
                    <div class="bulk-scope-row">
                        <label style="font-weight:500; margin-bottom:8px; display:block;">应用范围</label>
                        <label class="radio-label">
                            <input type="radio" name="bulk-scope" value="all" checked> 应用到所有行
                        </label>
                        <label class="radio-label">
                            <input type="radio" name="bulk-scope" value="empty"> 仅应用到空行
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="bulk-cancel-btn">取消</button>
                    <button class="btn btn-primary" id="bulk-confirm-btn">应用</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('bulk-modal-overlay').addEventListener('click', closeBulkDefaultsModal);
        document.getElementById('bulk-cancel-btn').addEventListener('click', closeBulkDefaultsModal);
        document.getElementById('bulk-confirm-btn').addEventListener('click', confirmBulkDefaults);
    }

    function initEventListeners() {
        const backBtn         = document.getElementById('back-btn');
        const cancelBtn       = document.getElementById('cancel-btn');
        const saveBtn         = document.getElementById('save-btn');
        const addRowBtn       = document.getElementById('add-row-btn');
        const tableBody       = document.getElementById('table-body');
        const errorModalClose = document.getElementById('error-modal-close');
        const breadcrumbLevel1    = document.getElementById('breadcrumb-level1');
        const level1SearchInput   = document.getElementById('level1-search-input');
        const level1DropdownList  = document.getElementById('level1-dropdown-list');
        const drawerOverlay   = document.getElementById('drawer-overlay');
        const drawerCloseBtn  = document.getElementById('drawer-close-btn');
        const drawerCancelBtn = document.getElementById('drawer-cancel');
        const drawerSaveBtn   = document.getElementById('drawer-save');
        const bulkDefaultsBtn = document.getElementById('bulk-defaults-btn');
        
        // 全部测试点模式的按钮
        const addLevel1Btn = document.getElementById('add-level1-btn');
        const addCaseToLevel1Btn = document.getElementById('add-case-to-level1-btn');

        if (backBtn) backBtn.addEventListener('click', goBack);

        if (cancelBtn) {
            cancelBtn.addEventListener('click', goBack);
        }

        // P1修复：直接调用 saveBatch，不再使用 debounce
        if (saveBtn) {
            saveBtn.addEventListener('click', saveBatch);
        }

        // 指定测试点模式的添加按钮
        if (addRowBtn) addRowBtn.addEventListener('click', addRow);
        
        // 全部测试点模式的按钮
        if (addLevel1Btn) addLevel1Btn.addEventListener('click', addLevel1Row);
        if (addCaseToLevel1Btn) addCaseToLevel1Btn.addEventListener('click', () => addCaseToLevel1());

        if (tableBody) {
            if (isAllLevel1Mode) {
                tableBody.addEventListener('input', handleLevel1TableInput);
                tableBody.addEventListener('change', handleLevel1TableInput);
                tableBody.addEventListener('click', handleLevel1TableAction);
            } else {
                tableBody.addEventListener('input', handleTableInput);
                tableBody.addEventListener('change', handleTableInput);
                tableBody.addEventListener('click', handleTableAction);
            }
        }

        if (errorModalClose) {
            errorModalClose.addEventListener('click', () => {
                const modal = document.getElementById('error-modal');
                if (modal) modal.style.display = 'none';
            });
        }

        if (breadcrumbLevel1) {
            breadcrumbLevel1.addEventListener('click', (e) => {
                e.stopPropagation();
                const dropdown = document.getElementById('level1-dropdown');
                toggleLevel1Dropdown(!dropdown || dropdown.style.display !== 'block');
            });
        }

        if (level1SearchInput) {
            level1SearchInput.addEventListener('input', (e) => {
                renderLevel1Dropdown(e.target.value);
            });
        }

        if (level1DropdownList) {
            level1DropdownList.addEventListener('click', (e) => {
                const item = e.target.closest('.level1-dropdown-item');
                if (item) {
                    selectLevel1Point(item.dataset.id, item.dataset.name, item.dataset.moduleId, item.dataset.moduleName);
                }
            });
        }

        if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);
        if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);
        if (drawerCancelBtn) drawerCancelBtn.addEventListener('click', closeDrawer);
        if (drawerSaveBtn) drawerSaveBtn.addEventListener('click', saveDrawerData);

        if (bulkDefaultsBtn) bulkDefaultsBtn.addEventListener('click', applyBulkDefaults);

        if (typeof window.createCloneCaseModal === 'function') {
            window.createCloneCaseModal();
        }

        const level1PanelCloseBtn = document.getElementById('level1-panel-close-btn');
        const level1PanelOverlay = document.getElementById('level1-panel-overlay');
        
        if (level1PanelCloseBtn) {
            level1PanelCloseBtn.addEventListener('click', () => toggleLevel1Dropdown(false));
        }
        if (level1PanelOverlay) {
            level1PanelOverlay.addEventListener('click', () => toggleLevel1Dropdown(false));
        }

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => {
                overlay.closest('.modal').style.display = 'none';
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal').forEach(modal => {
                    modal.style.display = 'none';
                });
                toggleLevel1Dropdown(false);
                closeDrawer();
            }
        });

        initDrawerProjectModalDrag();
    }

    // 初始化Drawer的项目拉取菜单的拖拽支持
    function initDrawerProjectModalDrag() {
        const modal = document.getElementById('drawer-project-selector-modal');
        const modalContent = modal?.querySelector('.modal-content');
        const header = modalContent?.querySelector('.modal-header');

        if (!modal || !modalContent || !header) return;
        if (modalContent.dataset.dragInitialized === 'true') return;
        modalContent.dataset.dragInitialized = 'true';

        // ── 拖拽移动（长按 500ms 才激活，允许文字选择） ─────────
        let isDragging = false;
        let dragLockTimer = null;
        let dragReady = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;

        header.style.cursor = 'default'; // 默认不显示 move 游标

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.close') || e.target.closest('.close-modal') || e.target.closest('button')) return;

            startX = e.clientX;
            startY = e.clientY;
            dragReady = false;

            // 长按 500ms 才激活拖拽
            dragLockTimer = setTimeout(() => {
                dragReady = true;
                const rect = modalContent.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;

                if (modalContent.style.position !== 'absolute') {
                    modalContent.style.position = 'absolute';
                    modalContent.style.left = startLeft + 'px';
                    modalContent.style.top = startTop + 'px';
                    modalContent.style.margin = '0';
                    modalContent.style.transform = 'none';
                }

                isDragging = true;
                header.style.cursor = 'move';
                document.body.classList.add('modal-dragging');
            }, 500);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const newLeft = Math.max(10, Math.min(startLeft + (e.clientX - startX), window.innerWidth - modalContent.offsetWidth - 10));
            const newTop  = Math.max(10, Math.min(startTop  + (e.clientY - startY), window.innerHeight - 100));
            modalContent.style.left = newLeft + 'px';
            modalContent.style.top  = newTop  + 'px';
        });

        document.addEventListener('mouseup', () => {
            clearTimeout(dragLockTimer);
            if (isDragging) {
                isDragging = false;
                dragReady = false;
                header.style.cursor = 'default';
                document.body.classList.remove('modal-dragging');
            }
        });

        // ── Resize 手柄（右下角） ─────────────────────────────────
        const resizer = document.createElement('div');
        resizer.className = 'pa-modal-resizer';
        resizer.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M11 10a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
        </svg>`;
        modalContent.appendChild(resizer);

        let isResizing = false;
        let resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeStartW = modalContent.offsetWidth;
            resizeStartH = modalContent.offsetHeight;
            document.body.classList.add('modal-resizing');
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newW = Math.max(600, resizeStartW + (e.clientX - resizeStartX));
            const newH = Math.max(400, resizeStartH + (e.clientY - resizeStartY));
            modalContent.style.width  = Math.min(newW, window.innerWidth - 40) + 'px';
            modalContent.style.height = Math.min(newH, window.innerHeight - 40) + 'px';
            // 滚动区域随之伸缩
            const body = modalContent.querySelector('.project-association-body');
            if (body) {
                const headerH = modalContent.querySelector('.modal-header')?.offsetHeight || 0;
                const toolbarH = modalContent.querySelector('.pa-toolbar')?.offsetHeight || 0;
                const footerH = modalContent.querySelector('.modal-footer')?.offsetHeight || 0;
                body.style.maxHeight = (modalContent.offsetHeight - headerH - toolbarH - footerH - 2) + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.classList.remove('modal-resizing');
            }
        });
    }

    function checkAuth() {
        if (!authToken || !currentUser) {
            window.location.href = '/#/login';
            return false;
        }
        return true;
    }

    let needSelectLocation = false;
    let locationSelectData = {
        libraries: [],
        modules: [],
        level1Points: []
    };

    function checkParams() {
        if (!moduleId || moduleName === '未知模块') {
            needSelectLocation = true;
            return true;
        }
        return true;
    }

    function createLocationSelectModal() {
        if (document.getElementById('location-select-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'location-select-modal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-overlay" id="location-modal-overlay"></div>
            <div class="modal-content" style="max-width: 480px;">
                <div class="modal-header">
                    <span class="modal-icon confirm-icon">📁</span>
                    <h3>选择创建位置</h3>
                    <button type="button" class="close" id="location-modal-close" style="background:none; border:none; font-size:20px; cursor:pointer; margin-left:auto;">&times;</button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div class="location-field-row">
                        <label class="location-field-label">用例库 <span class="required">*</span></label>
                        <select id="location-library-select" class="location-select">
                            <option value="">请选择用例库</option>
                        </select>
                    </div>
                    <div class="location-field-row">
                        <label class="location-field-label">模块 <span class="required">*</span></label>
                        <select id="location-module-select" class="location-select" disabled>
                            <option value="">请选择模块</option>
                        </select>
                    </div>
                    <div class="location-field-row">
                        <label class="location-field-label">一级测试点 <span style="color:#999;">(可选)</span></label>
                        <select id="location-level1-select" class="location-select" disabled>
                            <option value="">请选择一级测试点</option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="location-cancel-btn">取消</button>
                    <button class="btn btn-primary" id="location-confirm-btn" disabled>确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('location-modal-overlay').addEventListener('click', closeLocationSelectModal);
        document.getElementById('location-modal-close').addEventListener('click', closeLocationSelectModal);
        document.getElementById('location-cancel-btn').addEventListener('click', closeLocationSelectModal);
        document.getElementById('location-confirm-btn').addEventListener('click', confirmLocationSelection);

        document.getElementById('location-library-select').addEventListener('change', onLocationLibraryChange);
        document.getElementById('location-module-select').addEventListener('change', onLocationModuleChange);
    }

    function openLocationSelectModal() {
        const modal = document.getElementById('location-select-modal');
        if (modal) {
            modal.style.display = 'flex';
            loadLocationLibraries();
        }
    }

    function closeLocationSelectModal() {
        const modal = document.getElementById('location-select-modal');
        if (modal) modal.style.display = 'none';
        if (needSelectLocation) {
            if (returnUrl) {
                window.location.href = returnUrl;
            } else if (document.referrer) {
                window.history.back();
            } else {
                window.location.href = '/#/';
            }
        }
    }

    async function loadLocationLibraries() {
        const libSelect = document.getElementById('location-library-select');
        try {
            const res = await apiRequest('/api/libraries/list');
            if (res.success && res.libraries) {
                locationSelectData.libraries = res.libraries;
                libSelect.innerHTML = '<option value="">请选择用例库</option>' + 
                    res.libraries.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
            }
        } catch (e) {
            console.error('Load libraries failed', e);
            libSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    async function onLocationLibraryChange(e) {
        const libId = e.target.value;
        const modSelect = document.getElementById('location-module-select');
        const lv1Select = document.getElementById('location-level1-select');
        const confirmBtn = document.getElementById('location-confirm-btn');

        modSelect.innerHTML = '<option value="">请选择模块</option>';
        lv1Select.innerHTML = '<option value="">请选择一级测试点</option>';
        lv1Select.disabled = true;
        confirmBtn.disabled = true;
        locationSelectData.modules = [];
        locationSelectData.level1Points = [];

        if (!libId) {
            modSelect.disabled = true;
            return;
        }

        modSelect.disabled = false;
        modSelect.innerHTML = '<option value="">加载中...</option>';

        try {
            const res = await apiRequest(`/api/modules/by-library/${libId}`);
            if (res.success && res.modules) {
                locationSelectData.modules = res.modules;
                modSelect.innerHTML = '<option value="">请选择模块</option>' + 
                    res.modules.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
            } else {
                modSelect.innerHTML = '<option value="">暂无模块</option>';
            }
        } catch (e) {
            console.error('Load modules failed', e);
            modSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    async function onLocationModuleChange(e) {
        const modId = e.target.value;
        const lv1Select = document.getElementById('location-level1-select');
        const confirmBtn = document.getElementById('location-confirm-btn');

        lv1Select.innerHTML = '<option value="">请选择一级测试点</option>';
        locationSelectData.level1Points = [];

        if (!modId) {
            lv1Select.disabled = true;
            confirmBtn.disabled = true;
            return;
        }

        lv1Select.disabled = false;
        lv1Select.innerHTML = '<option value="">加载中...</option>';
        confirmBtn.disabled = false;

        try {
            const res = await apiRequest(`/api/testpoints/level1/${modId}`);
            const pointsList = res.level1Points || res.points || [];
            if (res.success && pointsList.length > 0) {
                locationSelectData.level1Points = pointsList;
                lv1Select.innerHTML = '<option value="">请选择一级测试点</option>' + 
                    pointsList.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
            } else {
                lv1Select.innerHTML = '<option value="">暂无一级测试点</option>';
            }
        } catch (e) {
            console.error('Load level1 points failed', e);
            lv1Select.innerHTML = '<option value="">加载失败</option>';
        }
    }

    function confirmLocationSelection() {
        const libId = document.getElementById('location-library-select').value;
        const modId = document.getElementById('location-module-select').value;
        const lv1Id = document.getElementById('location-level1-select').value;

        if (!libId || !modId) {
            showErrorMessage('请选择用例库和模块');
            return;
        }

        const libName = locationSelectData.libraries.find(l => String(l.id) === String(libId))?.name || '';
        const modName = locationSelectData.modules.find(m => String(m.id) === String(modId))?.name || '';
        const lv1Name = locationSelectData.level1Points.find(p => String(p.id) === String(lv1Id))?.name || '';

        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('libraryId', libId);
        currentUrl.searchParams.set('libraryName', libName);
        currentUrl.searchParams.set('moduleId', modId);
        currentUrl.searchParams.set('moduleName', modName);
        if (lv1Id) {
            currentUrl.searchParams.set('level1Id', lv1Id);
            currentUrl.searchParams.set('level1Name', lv1Name);
        } else {
            currentUrl.searchParams.delete('level1Id');
            currentUrl.searchParams.delete('level1Name');
        }

        window.location.href = currentUrl.toString();
    }

    async function init() {
        if (!checkAuth()) return;
        if (!checkParams()) return;

        if (needSelectLocation) {
            createLocationSelectModal();
            openLocationSelectModal();
            return;
        }

        // 判断是否为"全部测试点"模式
        isAllLevel1Mode = !level1Id;

        await Promise.all([
            loadConfigData(),
            loadAllLevel1Points(),
            loadUsers()
        ]);

        if (!defaultOwner && currentUser) {
            defaultOwner = currentUser.username || currentUser.name || currentUser.login || '';
        }

        let restored = false;
        try {
            const saved = sessionStorage.getItem(DRAFT_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (isAllLevel1Mode) {
                    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type === 'level1') {
                        level1BatchData = parsed;
                        restored = true;
                    }
                } else {
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        batchData = parsed;
                        restored = true;
                    }
                }
            }
        } catch (_) {}

        if (!restored) {
            if (isAllLevel1Mode) {
                level1BatchData = [createEmptyLevel1()];
            } else {
                batchData = [createEmptyRow()];
            }
        }

        // 根据模式显示/隐藏相应的UI元素
        const addRowSection = document.getElementById('add-row-section');
        const addLevel1Section = document.getElementById('add-level1-section');
        const tableHeadNormal = document.getElementById('table-head-normal');
        const tableHeadLevel1 = document.getElementById('table-head-level1');
        
        if (isAllLevel1Mode) {
            if (addRowSection) addRowSection.style.display = 'none';
            if (addLevel1Section) addLevel1Section.style.display = 'flex';
            if (tableHeadNormal) tableHeadNormal.style.display = 'none';
            if (tableHeadLevel1) tableHeadLevel1.style.display = '';
        } else {
            if (addRowSection) addRowSection.style.display = 'flex';
            if (addLevel1Section) addLevel1Section.style.display = 'none';
            if (tableHeadNormal) tableHeadNormal.style.display = '';
            if (tableHeadLevel1) tableHeadLevel1.style.display = 'none';
        }

        initBreadcrumb();
        createBulkDefaultsModal();
        initDrawerScriptFileUpload();
        
        if (isAllLevel1Mode) {
            renderLevel1Table();
        } else {
            renderTable();
        }
        
        initEventListeners();
        initDrawerResizer();
        initTableResizer();
        initLevel1PanelResizer();
    }

    function initLevel1PanelResizer() {
        const panel = document.getElementById('level1-panel');
        const resizer = document.getElementById('level1-panel-resizer');
        
        if (!panel || !resizer) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        const minWidth = 320;
        const maxWidthRatio = 0.8;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            
            resizer.classList.add('dragging');
            document.body.classList.add('level1-panel-resizing');
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaX = startX - e.clientX;
            const newWidth = startWidth + deltaX;
            const maxWidth = window.innerWidth * maxWidthRatio;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                panel.style.width = newWidth + 'px';
            } else if (newWidth < minWidth) {
                panel.style.width = minWidth + 'px';
            } else if (newWidth > maxWidth) {
                panel.style.width = maxWidth + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('dragging');
                document.body.classList.remove('level1-panel-resizing');
            }
        });

        resizer.addEventListener('dblclick', () => {
            panel.style.width = '480px';
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Drawer 拖拽调整宽度功能
    // ─────────────────────────────────────────────────────────────────
    function initDrawerResizer() {
        const drawer = document.getElementById('detail-drawer');
        const resizer = document.getElementById('drawer-resizer');
        
        if (!drawer || !resizer) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        const minWidth = 320;
        const maxWidthRatio = 0.8;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = drawer.offsetWidth;
            
            resizer.classList.add('dragging');
            document.body.classList.add('drawer-resizing');
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaX = startX - e.clientX;
            const newWidth = startWidth + deltaX;
            const maxWidth = window.innerWidth * maxWidthRatio;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                drawer.style.width = newWidth + 'px';
            } else if (newWidth < minWidth) {
                drawer.style.width = minWidth + 'px';
            } else if (newWidth > maxWidth) {
                drawer.style.width = maxWidth + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('dragging');
                document.body.classList.remove('drawer-resizing');
            }
        });

        resizer.addEventListener('dblclick', () => {
            drawer.style.width = '640px';
        });
    }

    function initTableResizer() {
        const tableWrapper = document.getElementById('table-wrapper');
        const resizer = document.getElementById('table-resizer');
        
        if (!tableWrapper || !resizer) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        const minWidth = 800;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = tableWrapper.offsetWidth;
            
            resizer.classList.add('dragging');
            document.body.classList.add('table-resizing');
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const deltaX = e.clientX - startX;
            const newWidth = startWidth + deltaX;
            const maxWidth = window.innerWidth - 48;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                tableWrapper.style.width = newWidth + 'px';
                tableWrapper.style.maxWidth = newWidth + 'px';
            } else if (newWidth < minWidth) {
                tableWrapper.style.width = minWidth + 'px';
                tableWrapper.style.maxWidth = minWidth + 'px';
            } else if (newWidth > maxWidth) {
                tableWrapper.style.width = maxWidth + 'px';
                tableWrapper.style.maxWidth = maxWidth + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('dragging');
                document.body.classList.remove('table-resizing');
            }
        });

        resizer.addEventListener('dblclick', () => {
            tableWrapper.style.width = '';
            tableWrapper.style.maxWidth = '';
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 从现有数据库克隆用例功能 (Clone Existing Case Feature)
    // ────────────────────────────────────────────────────────────────────────
    let currentCloneTargetIndex = null;
    let currentCloneCasesList = [];

    window.createCloneCaseModal = function() {
        if (document.getElementById('clone-case-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'clone-case-modal';
        modal.className = 'modal pa-modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-overlay" id="clone-modal-overlay"></div>
            <div class="modal-content pa-modal-content" id="clone-modal-content" style="width: 840px; height: 640px; max-width: 90vw; display: flex; flex-direction: column;">
                <div class="modal-header pa-modal-header" id="clone-modal-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7"></circle><line x1="21" y1="21" x2="15" y2="15"></line><line x1="10" y1="7" x2="10" y2="13"></line><line x1="7" y1="10" x2="13" y2="10"></line></svg>
                        <h3 style="margin: 0; font-size: 16px;">从库中克隆用例</h3>
                    </div>
                    <button type="button" class="close" id="clone-modal-close" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
                </div>
                <div class="clone-toolbar">
                    <div class="clone-filter-group">
                        <label class="clone-filter-label">用例库</label>
                        <select id="clone-lib-select" class="form-select pa-select" onchange="window.fetchModulesForClone(this.value)"><option value="">加载中...</option></select>
                    </div>
                    <div class="clone-filter-group">
                        <label class="clone-filter-label">模块</label>
                        <select id="clone-mod-select" class="form-select pa-select" onchange="window.fetchLevel1ForClone(this.value)"><option value="">所有模块</option></select>
                    </div>
                    <div class="clone-filter-group">
                        <label class="clone-filter-label">一级测试点</label>
                        <select id="clone-lv1-select" class="form-select pa-select" onchange="window.fetchCloneCases()"><option value="all">包含所有测试点</option></select>
                    </div>
                    <div class="clone-filter-group" style="flex: 2; min-width: 180px;">
                        <label class="clone-filter-label">用例关键字</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="clone-search-input" class="form-input pa-input" placeholder="输入名称或ID过滤查询结果..." oninput="window.renderCloneCaseList()" onkeypress="if(event.key==='Enter') window.fetchCloneCases()">
                            <button class="btn btn-primary btn-sm" onclick="window.fetchCloneCases()" style="flex-shrink:0;">刷新服务器</button>
                        </div>
                    </div>
                </div>
                <div class="clone-list-container">
                    <table class="clone-cases-table" id="clone-cases-table">
                        <thead>
                            <tr>
                                <th style="width:40px; text-align:center;">选择</th>
                                <th>用例名称</th>
                                <th style="width:120px;">级别 / 方式</th>
                                <th style="width:100px;">创建人</th>
                            </tr>
                        </thead>
                        <tbody id="clone-cases-tbody">
                            <tr><td colspan="4" style="text-align:center; padding: 40px; color: #94a3b8;">正在加载可用用例...</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="modal-footer" style="padding: 16px; display: flex; justify-content: flex-end; gap: 12px; background: #fff;">
                    <span id="clone-selection-hint" style="margin-right: auto; align-self: center; font-size: 13px; color: #64748b;">未选择待克隆的源用例</span>
                    <button class="btn btn-secondary" id="clone-cancel-btn">取消</button>
                    <button class="btn btn-primary" id="clone-confirm-btn" disabled>确认克隆至下一行</button>
                </div>
                <div class="pa-modal-resizer" id="clone-modal-resizer">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M11 10a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
                    </svg>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('clone-modal-close').addEventListener('click', window.closeCloneCaseModal);
        document.getElementById('clone-cancel-btn').addEventListener('click', window.closeCloneCaseModal);
        document.getElementById('clone-confirm-btn').addEventListener('click', window.confirmCloneCase);
        document.getElementById('clone-modal-overlay').addEventListener('click', window.closeCloneCaseModal);

        window.initCloneModalDrag();
    };

    window.initCloneModalDrag = function() {
        const content = document.getElementById('clone-modal-content');
        const header = document.getElementById('clone-modal-header');
        const resizer = document.getElementById('clone-modal-resizer');
        if (!content || content.dataset.dragInitialized === 'true') return;
        content.dataset.dragInitialized = 'true';

        let isDragging = false, dragLockTimer = null, startX = 0, startY = 0, startLeft = 0, startTop = 0;
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            startX = e.clientX; startY = e.clientY;
            dragLockTimer = setTimeout(() => {
                const rect = content.getBoundingClientRect();
                startLeft = rect.left; startTop = rect.top;
                if (content.style.position !== 'absolute') {
                    content.style.position = 'absolute';
                    content.style.left = startLeft + 'px';
                    content.style.top = startTop + 'px';
                    content.style.transform = 'none'; content.style.margin = '0';
                }
                isDragging = true;
                header.style.cursor = 'move';
                document.body.classList.add('modal-dragging');
            }, 100);
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            content.style.left = Math.max(10, Math.min(startLeft + (e.clientX - startX), window.innerWidth - content.offsetWidth - 10)) + 'px';
            content.style.top  = Math.max(10, Math.min(startTop + (e.clientY - startY), window.innerHeight - header.offsetHeight - 10)) + 'px';
        });
        document.addEventListener('mouseup', () => {
            clearTimeout(dragLockTimer);
            if (isDragging) { isDragging = false; header.style.cursor = 'default'; document.body.classList.remove('modal-dragging'); }
        });

        let isResizing = false, rStartX = 0, rStartY = 0, rStartW = 0, rStartH = 0;
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true; rStartX = e.clientX; rStartY = e.clientY;
            rStartW = content.offsetWidth; rStartH = content.offsetHeight;
            document.body.classList.add('modal-resizing');
            e.preventDefault(); e.stopPropagation();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            content.style.width  = Math.max(500, Math.min(rStartW + (e.clientX - rStartX), window.innerWidth - 40)) + 'px';
            content.style.height = Math.max(400, Math.min(rStartH + (e.clientY - rStartY), window.innerHeight - 40)) + 'px';
        });
        document.addEventListener('mouseup', () => { if (isResizing) { isResizing = false; document.body.classList.remove('modal-resizing'); } });
    };

    window.openCloneCaseModal = async function(index) {
        if (batchData.length >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条），请分批提交`);
            return;
        }
        currentCloneTargetIndex = index;
        const modal = document.getElementById('clone-case-modal');
        if (modal) modal.style.display = 'flex';
        
        document.getElementById('clone-search-input').value = '';
        currentCloneCasesList = [];
        window.renderCloneCaseList();

        try {
            const libSelect = document.getElementById('clone-lib-select');
            const res = await apiRequest('/api/libraries/list');
            if (res.success && res.libraries) {
                libSelect.innerHTML = '<option value="all">所有用例库</option>' + res.libraries.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
                libSelect.value = libraryId || 'all';
                await window.fetchModulesForClone(libSelect.value);
            }
        } catch (e) {
            console.error('Fetch libraries failed', e);
        }
    };

    window.fetchModulesForClone = async function(libId) {
        const modSelect = document.getElementById('clone-mod-select');
        modSelect.innerHTML = '<option value="">加载中...</option>';
        if (!libId || libId === 'all') { modSelect.innerHTML = '<option value="all">所有模块</option>'; await window.fetchLevel1ForClone('all'); return; }
        try {
            const res = await apiRequest(`/api/modules/by-library/${libId}`);
            if (res.success && res.modules) {
                modSelect.innerHTML = '<option value="all">所有模块</option>' + res.modules.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
                if (String(libId) === String(libraryId) && moduleId) modSelect.value = moduleId;
                await window.fetchLevel1ForClone(modSelect.value);
            }
        } catch (e) {
            console.error('Fetch modules failed', e);
        }
    };

    window.fetchLevel1ForClone = async function(modId) {
        const lv1Select = document.getElementById('clone-lv1-select');
        lv1Select.innerHTML = '<option value="all">包含所有测试点</option>';
        if (!modId || modId === 'all') { await window.fetchCloneCases(); return; }
        try {
            const res = await apiRequest(`/api/testpoints/level1/${modId}`);
            const pointsList = res.level1Points || res.points;
            if (res.success && pointsList) {
                lv1Select.innerHTML = '<option value="all">包含所有测试点</option>' + pointsList.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
                if (String(modId) === String(moduleId) && typeof level1Id !== 'undefined') lv1Select.value = level1Id || 'all';
                await window.fetchCloneCases();
            }
        } catch (e) {
            console.error('Fetch level1 points failed', e);
        }
    };

    window.fetchCloneCases = async function() {
        const tbody = document.getElementById('clone-cases-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color: #94a3b8;">加载中，可能包含大量用例...</td></tr>';
        
        const libId = document.getElementById('clone-lib-select').value;
        const modId = document.getElementById('clone-mod-select').value;
        const lv1Id = document.getElementById('clone-lv1-select').value;

        try {
            const result = await apiRequest('/api/cases/list', {
                method: 'POST',
                body: JSON.stringify({ libraryId: libId || 'all', moduleId: modId || 'all', level1Id: lv1Id || 'all', page: 1, pageSize: 9999 })
            });
            if (result.success && result.testCases) {
                currentCloneCasesList = result.testCases;
                window.renderCloneCaseList();
            } else {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color: #ef4444;">获取用例失败</td></tr>';
            }
        } catch (error) {
            console.error('Fetch cases error:', error);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color: #ef4444;">请求出错</td></tr>';
        }
    };

    window.renderCloneCaseList = function() {
        const tbody = document.getElementById('clone-cases-tbody');
        const keyword = (document.getElementById('clone-search-input')?.value || '').toLowerCase();
        
        let filtered = currentCloneCasesList;
        if (keyword) {
            filtered = filtered.filter(c => c.name.toLowerCase().includes(keyword) || (c.caseId && c.caseId.toLowerCase().includes(keyword)));
        }

        if (!filtered || filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color: #94a3b8;">未匹配到相应的测试用例记录</td></tr>';
            window.selectCloneCase(null);
            return;
        }

        tbody.innerHTML = filtered.map(c => `
            <tr class="clone-case-row" data-id="${c.id}" onclick="window.selectCloneCase(${c.id})">
                <td style="text-align:center;"><input type="radio" name="clone_case_radio" value="${c.id}" style="pointer-events:none;"></td>
                <td>
                    <div class="clone-case-name">${escapeHtml(c.name)}</div>
                    <div style="font-size:11px; color:#94a3b8; font-family: monospace;">${escapeHtml(c.caseId || '')}</div>
                </td>
                <td style="font-size:12px;">
                    <span style="color:#0ea5e9;">${escapeHtml(c.priority)}</span><br>
                    <span style="color:#64748b;">${escapeHtml(c.type)}</span> / <span style="color:#64748b;">${escapeHtml(c.method || 'manual')}</span>
                </td>
                <td style="font-size:12px;">${escapeHtml(c.creator)}</td>
            </tr>
        `).join('');

        window.selectCloneCase(null);
    };

    window.selectCloneCase = function(id) {
        document.querySelectorAll('.clone-case-row').forEach(row => {
            row.classList.remove('selected');
            const radio = row.querySelector('input[type="radio"]');
            if (radio) radio.checked = false;
        });
        const btn = document.getElementById('clone-confirm-btn');
        const hint = document.getElementById('clone-selection-hint');
        if (id) {
            const tr = document.querySelector(`.clone-case-row[data-id="${id}"]`);
            if (tr) {
                tr.classList.add('selected');
                tr.querySelector('input[type="radio"]').checked = true;
            }
            btn.disabled = false;
            const targetCase = currentCloneCasesList.find(c => String(c.id) === String(id));
            hint.innerHTML = `即将克隆新模板：<strong style="color:#0f172a;">${escapeHtml(targetCase.name)}</strong>`;
        } else {
            btn.disabled = true;
            hint.textContent = '请选中列表中你需要克隆的测试用例底板';
        }
    };

    window.closeCloneCaseModal = function() {
        const modal = document.getElementById('clone-case-modal');
        if (modal) modal.style.display = 'none';
        currentCloneTargetIndex = null;
    };

    window.confirmCloneCase = async function() {
        const selectedRadio = document.querySelector('input[name="clone_case_radio"]:checked');
        if (!selectedRadio || currentCloneTargetIndex === null) return;
        
        const targetCase = currentCloneCasesList.find(c => String(c.id) === String(selectedRadio.value));
        if (!targetCase) return;

        // 若当前有打开了修改中的抽屉，先提交保存缓冲数据以防破坏草稿数据连续性
        syncDrawerToData();
        
        if (batchData.length >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条）`);
            return;
        }

        // 处理环境字段，优先使用environments数组，如果没有则使用单个env
        let envValue = '';
        if (targetCase.environments && Array.isArray(targetCase.environments) && targetCase.environments.length > 0) {
            envValue = targetCase.environments.join(',');
        } else if (targetCase.env) {
            envValue = targetCase.env;
        }

        // 处理来源字段
        let sourcesValue = '';
        if (targetCase.sources && Array.isArray(targetCase.sources) && targetCase.sources.length > 0) {
            sourcesValue = targetCase.sources.join(',');
        }

        // 处理测试阶段字段
        let phaseValue = '';
        if (targetCase.phases && Array.isArray(targetCase.phases) && targetCase.phases.length > 0) {
            phaseValue = targetCase.phases[0];
        } else if (targetCase.phase) {
            phaseValue = targetCase.phase;
        }

        // 处理测试方式字段
        let methodsValue = targetCase.method ? targetCase.method : 'manual';
        if (targetCase.methods && Array.isArray(targetCase.methods) && targetCase.methods.length > 0) {
            methodsValue = targetCase.methods[0];
        }

        // ★ 关键修复：优先用 defaultOwner（页面传入的负责人），其次当前登录用户，最后才原用例负责人
        //   这里先算好 effectiveOwner，再统一赋给行本身和各项目关联
        const effectiveOwner = defaultOwner
            || (typeof currentUser !== 'undefined' ? (currentUser?.username || '') : '')
            || targetCase.owner
            || '';

        // 处理项目字段 - 将负责人设置为 effectiveOwner
        let projectsValue = [];
        if (targetCase.projects && Array.isArray(targetCase.projects) && targetCase.projects.length > 0) {
            projectsValue = targetCase.projects.map(p => ({
                ...p,
                owner: effectiveOwner  // ★ 直接赋值，不留空，避免后端保存到数据库时变为 NULL
            }));
        }

        const newRow = {
            id: Date.now() + Math.random(),
            name: targetCase.name + '-Clone',
            priority: targetCase.priority,
            type: targetCase.type,
            owner: effectiveOwner,  // ★ 同样使用已计算好的 effectiveOwner
            phase: phaseValue,
            env: envValue,
            precondition: targetCase.precondition || '',
            purpose: targetCase.purpose || '',
            steps: targetCase.steps || '',
            expected: targetCase.expected || '',
            remark: targetCase.remark || '',
            key_config: targetCase.key_config || '',
            environments: envValue,
            methods: methodsValue,
            sources: sourcesValue,
            projects: projectsValue
        };
        
        const index = currentCloneTargetIndex;
        batchData.splice(index + 1, 0, newRow);
        
        const tbody = document.getElementById('table-body');
        if (tbody) {
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = index + 1;
            tr.innerHTML = getRowHTML(newRow, index + 1);
            const refNode = tbody.children[index + 1];
            if (refNode) tbody.insertBefore(tr, refNode);
            else tbody.appendChild(tr);
        }
        
        updateIndicesFrom(index + 1);
        updateRowCountHint();
        try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(batchData)); } catch(_) {}
        
        window.closeCloneCaseModal();
        showSuccessMessage(`成功克隆「${targetCase.name}」到第 ${index + 2} 行`);
    };

    // ========================================
    // 关联脚本管理功能
    // ========================================
    
    let currentDrawerScripts = [];
    let editingDrawerScriptIndex = -1;
    
    function openDrawerScriptModal() {
        editingDrawerScriptIndex = -1;
        document.getElementById('drawer-script-modal-title').textContent = '添加关联脚本';
        document.getElementById('drawer-script-form').reset();
        document.getElementById('drawer-script-id').value = '';
        document.getElementById('drawer-script-file-path').value = '';
        document.getElementById('drawer-script-file-size').value = '';
        document.getElementById('drawer-script-original-filename').value = '';
        document.querySelector('input[name="drawer-link-type"][value="external"]').checked = true;
        
        const filePreview = document.getElementById('drawer-script-file-preview');
        const uploadContent = document.getElementById('drawer-script-upload-content');
        if (filePreview) filePreview.style.display = 'none';
        if (uploadContent) uploadContent.style.display = 'block';
        
        document.getElementById('drawer-script-modal').style.display = 'block';
    }
    
    function closeDrawerScriptModal() {
        document.getElementById('drawer-script-modal').style.display = 'none';
        editingDrawerScriptIndex = -1;
    }
    
    function editDrawerScript(index) {
        const script = currentDrawerScripts[index];
        if (!script) return;
        
        editingDrawerScriptIndex = index;
        document.getElementById('drawer-script-modal-title').textContent = '编辑关联脚本';
        document.getElementById('drawer-script-name-input').value = script.script_name || '';
        document.getElementById('drawer-script-type-input').value = script.script_type || 'tcl';
        document.getElementById('drawer-script-desc-input').value = script.description || '';
        document.getElementById('drawer-script-link-input').value = script.link_url || '';
        document.getElementById('drawer-script-link-title-input').value = script.link_title || '';
        document.getElementById('drawer-script-file-path').value = script.file_path || '';
        document.getElementById('drawer-script-file-size').value = script.file_size || '';
        document.getElementById('drawer-script-original-filename').value = script.original_filename || '';
        
        const linkType = script.link_type || 'external';
        const linkTypeRadio = document.querySelector(`input[name="drawer-link-type"][value="${linkType}"]`);
        if (linkTypeRadio) linkTypeRadio.checked = true;
        
        const filePreview = document.getElementById('drawer-script-file-preview');
        const uploadContent = document.getElementById('drawer-script-upload-content');
        
        if (script.file_path) {
            document.getElementById('drawer-script-file-name').textContent = script.original_filename || script.script_name;
            if (filePreview) filePreview.style.display = 'flex';
            if (uploadContent) uploadContent.style.display = 'none';
        } else {
            if (filePreview) filePreview.style.display = 'none';
            if (uploadContent) uploadContent.style.display = 'block';
        }
        
        document.getElementById('drawer-script-modal').style.display = 'block';
    }
    
    function saveDrawerScript() {
        const name = document.getElementById('drawer-script-name-input').value.trim();
        const type = document.getElementById('drawer-script-type-input').value;
        const desc = document.getElementById('drawer-script-desc-input').value.trim();
        const linkUrl = document.getElementById('drawer-script-link-input').value.trim();
        const linkTitle = document.getElementById('drawer-script-link-title-input').value.trim();
        const linkType = document.querySelector('input[name="drawer-link-type"]:checked').value;
        const filePath = document.getElementById('drawer-script-file-path').value;
        const fileSize = document.getElementById('drawer-script-file-size').value;
        const originalFilename = document.getElementById('drawer-script-original-filename').value;
        
        if (!name) {
            showErrorMessage('请输入脚本名称');
            return;
        }
        
        const scriptData = {
            script_name: name,
            script_type: type,
            description: desc,
            link_url: linkUrl || null,
            link_title: linkTitle || null,
            link_type: linkType,
            file_path: filePath || null,
            file_size: fileSize ? parseInt(fileSize) : null,
            original_filename: originalFilename || null
        };
        
        if (editingDrawerScriptIndex >= 0) {
            currentDrawerScripts[editingDrawerScriptIndex] = scriptData;
        } else {
            currentDrawerScripts.push(scriptData);
        }
        
        renderDrawerScriptsSummary();
        closeDrawerScriptModal();
    }
    
    function removeDrawerScript(index) {
        if (confirm('确定要删除此脚本吗？')) {
            currentDrawerScripts.splice(index, 1);
            renderDrawerScriptsSummary();
        }
    }
    
    function removeDrawerScriptFile() {
        document.getElementById('drawer-script-file-path').value = '';
        document.getElementById('drawer-script-file-size').value = '';
        document.getElementById('drawer-script-original-filename').value = '';
        
        const filePreview = document.getElementById('drawer-script-file-preview');
        const uploadContent = document.getElementById('drawer-script-upload-content');
        if (filePreview) filePreview.style.display = 'none';
        if (uploadContent) uploadContent.style.display = 'block';
        
        document.getElementById('drawer-script-file-input').value = '';
    }
    
    function initDrawerScriptFileUpload() {
        const fileInput = document.getElementById('drawer-script-file-input');
        const uploadArea = document.getElementById('drawer-script-upload-area');
        
        if (!fileInput || !uploadArea) return;
        
        uploadArea.addEventListener('click', (e) => {
            if (e.target.closest('.btn-remove-file')) return;
            fileInput.click();
        });
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleDrawerScriptFileUpload(files[0]);
            }
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleDrawerScriptFileUpload(e.target.files[0]);
            }
        });
    }
    
    async function handleDrawerScriptFileUpload(file) {
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            showErrorMessage('文件大小不能超过10MB');
            return;
        }
        
        const allowedExts = ['.tcl', '.py', '.sh', '.txt', '.json', '.pl', '.rb', '.js', '.yaml', '.yml', '.xml', '.cfg', '.conf', '.ini'];
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!allowedExts.includes(ext)) {
            showErrorMessage('不支持的文件类型: ' + ext);
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('/api/testcases/scripts/upload', {
                method: 'POST',
                body: formData,
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                document.getElementById('drawer-script-file-path').value = data.file.path;
                document.getElementById('drawer-script-file-size').value = data.file.size;
                document.getElementById('drawer-script-original-filename').value = data.file.originalName;
                
                document.getElementById('drawer-script-file-name').textContent = data.file.originalName;
                document.getElementById('drawer-script-file-preview').style.display = 'flex';
                document.getElementById('drawer-script-upload-content').style.display = 'none';
                
                const nameInput = document.getElementById('drawer-script-name-input');
                if (!nameInput.value) {
                    nameInput.value = data.file.originalName;
                }
                
                showSuccessMessage('文件上传成功');
            } else {
                showErrorMessage(data.message || '上传失败');
            }
        } catch (error) {
            console.error('上传文件失败:', error);
            showErrorMessage('上传文件失败');
        }
    }
    
    function renderDrawerScriptsSummary() {
        const listContainer = document.getElementById('drawer-scripts-list');
        const emptyState = document.getElementById('drawer-scripts-empty');
        const editBtn = document.getElementById('drawer-edit-scripts-btn');
        
        if (currentDrawerScripts.length > 0) {
            emptyState.style.display = 'none';
            listContainer.style.display = 'block';
            editBtn.style.display = 'inline-flex';
            
            listContainer.innerHTML = currentDrawerScripts.map((script, index) => `
                <div class="drawer-script-item">
                    <span class="script-type-badge ${script.script_type}">${script.script_type.toUpperCase()}</span>
                    <span class="script-name">${escapeHtml(script.script_name)}</span>
                    ${script.file_path ? `<span class="script-file-indicator" title="已上传文件">📎</span>` : ''}
                    ${script.link_url ? `<a href="${escapeHtml(script.link_url)}" class="script-link">查看</a>` : ''}
                    <button type="button" class="btn-icon" onclick="editDrawerScript(${index})" title="编辑">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4-9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button type="button" class="btn-icon btn-danger" onclick="removeDrawerScript(${index})" title="删除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `).join('');
            
            document.getElementById('drawer-scripts').value = JSON.stringify(currentDrawerScripts);
        } else {
            emptyState.style.display = 'block';
            listContainer.style.display = 'none';
            editBtn.style.display = 'none';
            document.getElementById('drawer-scripts').value = '';
        }
    }
    
    function getDrawerScripts() {
        return currentDrawerScripts;
    }
    
    function clearDrawerScripts() {
        currentDrawerScripts = [];
        renderDrawerScriptsSummary();
    }
    
    window.openDrawerScriptModal = openDrawerScriptModal;
    window.closeDrawerScriptModal = closeDrawerScriptModal;
    window.editDrawerScript = editDrawerScript;
    window.saveDrawerScript = saveDrawerScript;
    window.removeDrawerScript = removeDrawerScript;
    window.removeDrawerScriptFile = removeDrawerScriptFile;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
