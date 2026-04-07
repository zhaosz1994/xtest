(function() {
    'use strict';

    const API_BASE_URL = window.location.origin;
    const MAX_ROWS = 500;

    let authToken = localStorage.getItem('authToken');
    let currentUser = null;
    let allUsers = [];

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
    const returnUrl = urlParams.get('returnUrl') || '';

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
    let originalData = [];
    let isSaving = false;
    let currentEditingIndex = null;
    let isNavigatingBack = false;

    let isAllLevel1Mode = false;
    let level1BatchData = [];

    const DrawerTagSelector = {
        init: function(containerId, options, selectedValues, onChange, triggerInitChange = false) {
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
        const filteredUsers = allUsers.filter(u => u.toLowerCase() !== 'admin');
        datalist.innerHTML = filteredUsers.map(u => `<option value="${escapeHtml(u)}">`).join('');
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

    async function loadExistingTestCases() {
        isAllLevel1Mode = !level1Id || level1Id === '';
        
        if (isAllLevel1Mode) {
            await loadAllLevel1TestCases();
        } else {
            await loadSpecificLevel1TestCases();
        }
    }

    async function loadSpecificLevel1TestCases() {
        try {
            const result = await apiRequest('/api/cases/list', {
                method: 'POST',
                body: JSON.stringify({
                    moduleId: moduleId,
                    level1Id: level1Id,
                    page: 1,
                    pageSize: MAX_ROWS
                })
            });

            if (result.success && result.testCases) {
                batchData = result.testCases.map(tc => ({
                    id: tc.id,
                    dbId: tc.id,
                    name: tc.name || '',
                    priority: tc.priority || '中',
                    type: tc.type || '功能测试',
                    owner: tc.owner || '',
                    phase: tc.phase || '集成测试',
                    env: Array.isArray(tc.environments) ? tc.environments.join(',') : (tc.env || ''),
                    precondition: tc.precondition || '',
                    purpose: tc.purpose || '',
                    steps: tc.steps || '',
                    expected: tc.expected || '',
                    key_config: tc.key_config || '',
                    remark: tc.remark || '',
                    environments: Array.isArray(tc.environments) ? tc.environments.join(',') : '',
                    methods: Array.isArray(tc.methods) ? tc.methods.join(',') : (tc.method || ''),
                    sources: Array.isArray(tc.sources) ? tc.sources.join(',') : '',
                    // 统一处理 projects 字段：确保转换为 JSON 字符串
                    projects: Array.isArray(tc.projects) ? JSON.stringify(tc.projects) : (tc.projects || '')
                }));
                
                originalData = JSON.parse(JSON.stringify(batchData));
            }
        } catch (error) {
            console.error('加载测试用例失败:', error);
            showErrorMessage('加载测试用例失败，请重试');
        }
    }

    async function loadAllLevel1TestCases() {
        try {
            const moduleLevel1Points = allLevel1Points.filter(p => String(p.module_id) === String(moduleId));
            
            const result = await apiRequest('/api/cases/list', {
                method: 'POST',
                body: JSON.stringify({
                    moduleId: moduleId,
                    level1Id: null,
                    page: 1,
                    pageSize: MAX_ROWS
                })
            });

            if (result.success) {
                const level1Map = new Map();
                
                moduleLevel1Points.forEach(point => {
                    level1Map.set(String(point.id), {
                        type: 'level1',
                        id: String(point.id),
                        dbId: parseInt(point.id),
                        name: point.name,
                        type_field: point.test_type || '功能测试',
                        expanded: true,
                        cases: []
                    });
                });
                
                level1Map.set('uncategorized', {
                    type: 'level1',
                    id: 'uncategorized',
                    dbId: null,
                    name: '未分类测试点',
                    type_field: '功能测试',
                    expanded: true,
                    cases: []
                });
                
                if (result.testCases && result.testCases.length > 0) {
                    result.testCases.forEach(tc => {
                        const level1IdKey = tc.level1Id ? String(tc.level1Id) : 'uncategorized';
                        
                        if (level1Map.has(level1IdKey)) {
                            level1Map.get(level1IdKey).cases.push({
                                id: tc.id,
                                dbId: tc.id,
                                name: tc.name || '',
                                priority: tc.priority || '中',
                                type: tc.type || '功能测试',
                                owner: tc.owner || '',
                                phase: tc.phase || '集成测试',
                                env: Array.isArray(tc.environments) ? tc.environments.join(',') : (tc.env || ''),
                                precondition: tc.precondition || '',
                                purpose: tc.purpose || '',
                                steps: tc.steps || '',
                                expected: tc.expected || '',
                                key_config: tc.key_config || '',
                                remark: tc.remark || '',
                                environments: Array.isArray(tc.environments) ? tc.environments.join(',') : '',
                                methods: Array.isArray(tc.methods) ? tc.methods.join(',') : (tc.method || ''),
                                sources: Array.isArray(tc.sources) ? tc.sources.join(',') : '',
                                // 统一处理 projects 字段：确保转换为 JSON 字符串
                                projects: Array.isArray(tc.projects) ? JSON.stringify(tc.projects) : (tc.projects || '')
                            });
                        }
                    });
                }
                
                level1BatchData = Array.from(level1Map.values()).filter(item => item.id !== 'uncategorized' || item.cases.length > 0);
                originalData = JSON.parse(JSON.stringify(level1BatchData));
            }
        } catch (error) {
            console.error('加载测试用例失败:', error);
            showErrorMessage('加载测试用例失败，请重试');
        }
    }

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
    function getTestMethods() {
        return configData.methods.length > 0 ? configData.methods.map(m => m.name) : TEST_METHODS;
    }
    function getTestSources() {
        return configData.sources.length > 0 ? configData.sources.map(s => s.name) : TEST_SOURCES;
    }
    function getUsers() {
        const users = allUsers.length > 0 ? allUsers : (currentUser ? [currentUser.username] : []);
        return users.filter(u => u.toLowerCase() !== 'admin');
    }

    function createEmptyRow(defaults = {}) {
        return {
            id: Date.now() + Math.random(),
            dbId: null,
            name: '',
            priority: defaults.priority || (getPriorities()[1] || '中'),
            type: defaults.type || (getTestTypes()[0] || '功能测试'),
            owner: defaults.owner || (currentUser ? currentUser.username : ''),
            phase: defaults.phase || (getTestPhases()[1] || '集成测试'),
            env: defaults.env || (getTestEnvs()[1] || '测试环境'),
            precondition: '',
            purpose: '',
            steps: '',
            expected: '',
            key_config: '',
            remark: '',
            environments: '',
            methods: '',
            sources: '',
            projects: ''
        };
    }

    function getRowHTML(row, index) {
        const priorities = getPriorities();
        const testTypes  = getTestTypes();
        const testPhases = getTestPhases();
        const testEnvs   = getTestEnvs();
        const users      = getUsers();
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
                    <select class="cell-select" data-field="owner" data-index="${index}">
                        ${users.map(u => `<option value="${u}" ${row.owner === u ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
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
        if (isAllLevel1Mode) {
            renderLevel1Table();
        } else {
            renderNormalTable();
        }
    }

    function renderNormalTable() {
        const tbody = document.getElementById('table-body');
        if (!tbody) return;

        const tableHeadNormal = document.getElementById('table-head-normal');
        const tableHeadLevel1 = document.getElementById('table-head-level1');
        const addRowSection = document.getElementById('add-row-section');
        const addLevel1Section = document.getElementById('add-level1-section');

        if (tableHeadNormal) tableHeadNormal.style.display = '';
        if (tableHeadLevel1) tableHeadLevel1.style.display = 'none';
        if (addRowSection) addRowSection.style.display = '';
        if (addLevel1Section) addLevel1Section.style.display = 'none';

        updateRowCountHint();

        const htmls = batchData.map((row, index) => {
            return `<tr data-row-index="${index}">${getRowHTML(row, index)}</tr>`;
        });
        tbody.innerHTML = htmls.join('');
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
                    <select class="cell-select" data-field="type_field" data-level1-index="${level1Index}" data-type="level1">
                        ${testTypes.map(t => `<option value="${t}" ${item.type_field === t ? 'selected' : ''}>${t}</option>`).join('')}
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

    function getCaseRowHTMLForLevel1(caseItem, level1Index, caseIndex, globalCaseIndex) {
        const priorities = getPriorities();
        const testTypes = getTestTypes();
        const testPhases = getTestPhases();
        const testEnvs = getTestEnvs();
        const users = getUsers();
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
                        ${priorities.map(p => `<option value="${p}" ${caseItem.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="cell-select" data-field="type" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-type="case">
                        ${testTypes.map(t => `<option value="${t}" ${caseItem.type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select class="cell-select" data-field="owner" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-type="case">
                        ${users.map(u => `<option value="${u}" ${caseItem.owner === u ? 'selected' : ''}>${u}</option>`).join('')}
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
                    <button class="action-btn copy-btn" data-action="copy" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-tooltip="复制">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete-btn" data-action="delete-case" data-level1-index="${level1Index}" data-case-index="${caseIndex}" data-tooltip="删除">
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

        const tableHeadNormal = document.getElementById('table-head-normal');
        const tableHeadLevel1 = document.getElementById('table-head-level1');
        const addRowSection = document.getElementById('add-row-section');
        const addLevel1Section = document.getElementById('add-level1-section');

        if (tableHeadNormal) tableHeadNormal.style.display = 'none';
        if (tableHeadLevel1) tableHeadLevel1.style.display = '';
        if (addRowSection) addRowSection.style.display = 'none';
        if (addLevel1Section) addLevel1Section.style.display = '';

        updateLevel1CountHint();

        let html = '';
        let globalCaseIndex = 0;

        level1BatchData.forEach((item, level1Index) => {
            html += getLevel1RowHTML(item, level1Index);
            
            if (item.expanded && item.cases && item.cases.length > 0) {
                html += getCaseTableHeaderHTML();
                item.cases.forEach((caseItem, caseIndex) => {
                    globalCaseIndex++;
                    html += getCaseRowHTMLForLevel1(caseItem, level1Index, caseIndex, globalCaseIndex);
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

        if (isAllLevel1Mode) {
            handleLevel1TableInput(event);
        } else {
            handleNormalTableInput(event);
        }
    }

    function handleNormalTableInput(event) {
        const target = event.target;
        const index = parseInt(target.dataset.index, 10);
        const field = target.dataset.field;
        const value = target.value;

        if (!isNaN(index) && field && batchData[index]) {
            batchData[index][field] = value;
        }
    }

    function handleLevel1TableInput(event) {
        const target = event.target;
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
    }

    function handleTableAction(event) {
        if (isAllLevel1Mode) {
            handleLevel1TableAction(event);
        } else {
            handleNormalTableAction(event);
        }
    }

    function handleNormalTableAction(event) {
        const target = event.target.closest('.action-btn');
        if (!target) return;

        const action = target.dataset.action;
        const index = parseInt(target.dataset.index, 10);

        if (isNaN(index)) return;

        if (action === 'copy') {
            copyRow(index);
        } else if (action === 'delete') {
            deleteRow(index);
        } else if (action === 'detail') {
            openDrawer(index);
        }
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
        } else if (action === 'detail') {
            openDrawerForLevel1Case(level1Index, caseIndex);
        } else if (action === 'copy') {
            copyCaseInLevel1(level1Index, caseIndex);
        } else if (action === 'delete-level1') {
            deleteLevel1(level1Index);
        } else if (action === 'delete-case') {
            deleteCaseInLevel1(level1Index, caseIndex);
        }
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
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条）`);
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

    function copyCaseInLevel1(level1Index, caseIndex) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        const cases = level1BatchData[level1Index].cases;
        if (caseIndex < 0 || caseIndex >= cases.length) return;
        
        let totalCases = 0;
        level1BatchData.forEach(item => {
            totalCases += (item.cases ? item.cases.length : 0);
        });
        if (totalCases >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条）`);
            return;
        }
        
        const original = cases[caseIndex];
        const copy = {
            ...original,
            id: Date.now() + Math.random(),
            dbId: null,
            name: original.name ? `${original.name}-Copy` : ''
        };
        
        cases.splice(caseIndex + 1, 0, copy);
        level1BatchData[level1Index].expanded = true;
        renderLevel1Table();
        showSuccessMessage('已复制用例');
    }

    async function deleteLevel1(level1Index) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;

        const level1Item = level1BatchData[level1Index];
        const caseCount = level1Item.cases ? level1Item.cases.length : 0;
        
        const message = caseCount > 0 
            ? `该测试点下有 ${caseCount} 个测试用例，删除测试点将同时删除这些用例，确定要删除吗？`
            : '确定要删除该测试点吗？';
        
        const confirmed = await showConfirmMessage(message);
        if (!confirmed) return;

        if (level1Item.dbId) {
            try {
                const result = await apiRequest(`/api/testpoints/level1/delete/${level1Item.dbId}`, {
                    method: 'DELETE'
                });

                if (!result.success) {
                    showErrorMessage(result.message || '删除失败');
                    return;
                }
            } catch (error) {
                console.error('删除一级测试点失败:', error);
                showErrorMessage('删除失败: ' + error.message);
                return;
            }
        }

        level1BatchData.splice(level1Index, 1);
        originalData = JSON.parse(JSON.stringify(level1BatchData));
        renderLevel1Table();
        showSuccessMessage('删除成功');
    }

    async function deleteCaseInLevel1(level1Index, caseIndex) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        
        const cases = level1BatchData[level1Index].cases;
        if (!cases || caseIndex < 0 || caseIndex >= cases.length) return;

        const caseItem = cases[caseIndex];
        
        const confirmed = await showConfirmMessage('确定要删除该测试用例吗？');
        if (!confirmed) return;

        if (caseItem.dbId) {
            try {
                const result = await apiRequest(`/api/cases/delete?id=${caseItem.dbId}`, {
                    method: 'DELETE'
                });

                if (!result.success) {
                    showErrorMessage(result.message || '删除失败');
                    return;
                }
            } catch (error) {
                console.error('删除测试用例失败:', error);
                showErrorMessage('删除失败: ' + error.message);
                return;
            }
        }

        cases.splice(caseIndex, 1);
        originalData = JSON.parse(JSON.stringify(level1BatchData));
        renderLevel1Table();
        showSuccessMessage('删除成功');
    }

    function openDrawerForLevel1Case(level1Index, caseIndex) {
        if (level1Index < 0 || level1Index >= level1BatchData.length) return;
        const cases = level1BatchData[level1Index].cases;
        if (caseIndex < 0 || caseIndex >= cases.length) return;

        currentEditingIndex = { level1Index, caseIndex };
        const row = cases[caseIndex];

        const drawerTitle = document.querySelector('.drawer-title');
        if (drawerTitle) {
            const caseName = row.name && row.name.trim() ? row.name.trim() : '（未命名）';
            drawerTitle.textContent = `编辑第 ${level1Index + 1}.${caseIndex + 1} 行详情 — ${caseName}`;
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

    function copyRow(index) {
        if (index < 0 || index >= batchData.length) return;
        syncDrawerToData();

        if (batchData.length >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条）`);
            return;
        }
        const originalRow = batchData[index];
        const newRow = {
            ...originalRow,
            id: Date.now() + Math.random(),
            dbId: null,
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
        
        showSuccessMessage('已复制到当前行下方');
    }

    async function deleteRow(index) {
        if (batchData.length <= 1) {
            showErrorMessage('至少保留一条数据');
            return;
        }

        if (index < 0 || index >= batchData.length) return;

        const row = batchData[index];
        
        const confirmed = await showConfirmMessage('确定要删除该行数据吗？');
        if (!confirmed) return;

        if (row.dbId) {
            try {
                const result = await apiRequest(`/api/cases/delete?id=${row.dbId}`, {
                    method: 'DELETE'
                });

                if (!result.success) {
                    showErrorMessage(result.message || '删除失败');
                    return;
                }
            } catch (error) {
                console.error('删除测试用例失败:', error);
                showErrorMessage('删除失败: ' + error.message);
                return;
            }
        }

        batchData.splice(index, 1);
        originalData = JSON.parse(JSON.stringify(batchData));
        
        const tbody = document.getElementById('table-body');
        if (tbody && tbody.children[index]) {
            tbody.children[index].remove();
        }
        
        updateIndicesFrom(index);
        updateRowCountHint();
        
        showSuccessMessage('删除成功');
    }

    function openDrawer(index) {
        if (index < 0 || index >= batchData.length) return;

        currentEditingIndex = index;
        const row = batchData[index];

        const drawerTitle = document.querySelector('.drawer-title');
        if (drawerTitle) {
            const caseName = row.name && row.name.trim() ? row.name.trim() : '（未命名）';
            drawerTitle.textContent = `编辑第 ${index + 1} 行详情 — ${caseName}`;
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

    function initDrawerTagSelectors(row) {
        const envOptions = getTestEnvs().map(e => ({ value: e, label: e }));
        const methodOptions = getTestMethods().map(m => ({ value: m, label: m }));
        const sourceOptions = getTestSources().map(s => ({ value: s, label: s }));

        const selectedEnvs = row.environments ? row.environments.split(',').map(e => e.trim()).filter(e => e) : [];
        const selectedMethods = row.methods ? row.methods.split(',').map(m => m.trim()).filter(m => m) : [];
        const selectedSources = row.sources ? row.sources.split(',').map(s => s.trim()).filter(s => s) : [];

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

    let drawerSelectedProjects = [];
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

            const parseProgresses = (r) => {
                if (r.success && r.data && r.data.testProgresses) return r.data.testProgresses;
                if (r.success && r.testProgresses) return r.testProgresses;
                if (Array.isArray(r)) return r;
                if (r.success && Array.isArray(r.data)) return r.data;
                if (Array.isArray(r.data)) return r.data;
                return [];
            };
            globalTestProgresses = parseProgresses(progressRes);

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
        const selectedRows = document.querySelectorAll('tr.pa-project-row.selected');
        selectedRows.forEach(row => {
            const projectId = row.dataset.id;
            const progressId = row.querySelector(`select[name="progress-${projectId}"]`)?.value;
            const statusId = row.querySelector(`select[name="status-${projectId}"]`)?.value;
            const remark = row.querySelector(`input[name="remark-${projectId}"]`)?.value;
            const assoc = drawerSelectedProjects.find(a => String(a.project_id) === String(projectId));
            
            if (assoc) {
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

    function syncDrawerToData() {
        if (currentEditingIndex === null) return;

        if (isAllLevel1Mode && typeof currentEditingIndex === 'object' && currentEditingIndex.level1Index !== undefined) {
            syncDrawerToLevel1Data();
        } else {
            syncDrawerToNormalData();
        }
    }

    function syncDrawerToNormalData() {
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

    function saveDrawerData() {
        if (currentEditingIndex === null) return;

        if (isAllLevel1Mode && typeof currentEditingIndex === 'object' && currentEditingIndex.level1Index !== undefined) {
            saveDrawerDataForLevel1();
        } else {
            saveDrawerDataNormal();
        }
    }

    function saveDrawerDataNormal() {
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
        
        showSuccessMessage('详情保存成功');
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
        
        showSuccessMessage('详情保存成功');
    }

    function addRow() {
        if (batchData.length >= MAX_ROWS) {
            showErrorMessage(`已达到最大行数限制（${MAX_ROWS}条）`);
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

        if (tbody) {
            const lastRow = tbody.lastElementChild;
            if (lastRow) {
                const nameInput = lastRow.querySelector('.cell-input[data-field="name"]');
                if (nameInput) nameInput.focus();
            }
        }
    }

    async function saveBatch() {
        if (isSaving) return false;

        if (currentEditingIndex !== null) {
            syncDrawerToData();
        }

        if (isAllLevel1Mode) {
            return await saveBatchForLevel1();
        } else {
            return await saveBatchNormal();
        }
    }

    async function saveBatchNormal() {
        const errors = validateData();
        if (errors.length > 0) {
            showErrorMessage(errors[0]);
            return false;
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
            const updatedCases = [];
            const newCases = [];

            batchData.forEach((row, index) => {
                const caseData = {
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
                };

                if (row.dbId) {
                    caseData.id = row.dbId;
                    const original = originalData.find(o => o.dbId === row.dbId);
                    if (!original || isCaseModified(row, original)) {
                        updatedCases.push(caseData);
                    }
                } else {
                    newCases.push(caseData);
                }
            });

            if (updatedCases.length === 0 && newCases.length === 0) {
                showSuccessMessage('没有需要保存的修改');
                return true;
            }

            const payload = {
                moduleId: moduleId,
                level1Id: level1Id,
                libraryId: libraryId,
                updatedCases: updatedCases,
                newCases: newCases
            };

            const result = await apiRequest('/api/testcases/batch-update', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (result.success) {
                showSaveSuccessBanner(result.data?.updatedCount || 0, result.data?.createdCount || 0);
                originalData = JSON.parse(JSON.stringify(batchData));
                return true;
            } else {
                showErrorMessage(result.message || '保存失败');
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

    async function saveBatchForLevel1() {
        const errors = validateLevel1Data();
        if (errors.length > 0) {
            showErrorMessage(errors[0]);
            return false;
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
            const updatedCases = [];
            const newCases = [];

            level1BatchData.forEach((item, level1Index) => {
                if (item.cases && item.cases.length > 0) {
                    item.cases.forEach((caseItem, caseIndex) => {
                        const caseData = {
                            tempId: caseItem.id,
                            name: caseItem.name.trim(),
                            priority: caseItem.priority,
                            type: caseItem.type,
                            owner: caseItem.owner || currentUser?.username || '',
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
                            sources: caseItem.sources || '',
                            level1_id: item.dbId || null
                        };

                        if (caseItem.dbId) {
                            caseData.id = caseItem.dbId;
                            const originalLevel1 = originalData.find(o => o.id === item.id);
                            if (originalLevel1 && originalLevel1.cases) {
                                const originalCase = originalLevel1.cases.find(c => c.dbId === caseItem.dbId);
                                if (!originalCase || isCaseModified(caseItem, originalCase)) {
                                    updatedCases.push(caseData);
                                }
                            } else {
                                updatedCases.push(caseData);
                            }
                        } else {
                            newCases.push(caseData);
                        }
                    });
                }
            });

            if (updatedCases.length === 0 && newCases.length === 0) {
                showSuccessMessage('没有需要保存的修改');
                return true;
            }

            const payload = {
                moduleId: moduleId,
                level1Id: null,
                libraryId: libraryId,
                updatedCases: updatedCases,
                newCases: newCases
            };

            const result = await apiRequest('/api/testcases/batch-update', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (result.success) {
                if (result.data?.createdCaseIds && result.data.createdCaseIds.length > 0) {
                    result.data.createdCaseIds.forEach(created => {
                        level1BatchData.forEach(item => {
                            if (item.cases) {
                                const caseItem = item.cases.find(c => c.id === created.tempId);
                                if (caseItem) {
                                    caseItem.dbId = created.dbId;
                                }
                            }
                        });
                    });
                }
                
                showSaveSuccessBanner(result.data?.updatedCount || 0, result.data?.createdCount || 0);
                originalData = JSON.parse(JSON.stringify(level1BatchData));
                return true;
            } else {
                showErrorMessage(result.message || '保存失败');
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

    function validateLevel1Data() {
        const errors = [];
        level1BatchData.forEach((item, level1Index) => {
            if (item.cases && item.cases.length > 0) {
                item.cases.forEach((caseItem, caseIndex) => {
                    if (!caseItem.name || caseItem.name.trim() === '') {
                        errors.push(`测试点 ${level1Index + 1} 的用例 ${caseIndex + 1}：用例名称不能为空`);
                    }
                });
            }
        });
        return errors;
    }

    function showSaveSuccessBanner(updatedCount, createdCount) {
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
                        <span>个测试用例已成功更新</span>
                    </div>
                    <div class="save-success-actions">
                        <button class="btn btn-primary btn-sm" id="banner-back-btn">返回列表</button>
                    </div>
                </div>
            `;
            document.querySelector('.batch-main').prepend(banner);

            document.getElementById('banner-back-btn').addEventListener('click', goBack);
        }
        
        let message = '';
        if (updatedCount > 0 && createdCount > 0) {
            message = `更新 ${updatedCount} 个，新建 ${createdCount} 个`;
        } else if (updatedCount > 0) {
            message = `更新 ${updatedCount} 个`;
        } else if (createdCount > 0) {
            message = `新建 ${createdCount} 个`;
        } else {
            message = '无变更';
        }
        
        document.getElementById('save-success-count').textContent = message;
        banner.style.display = 'block';
    }

    function validateData() {
        const errors = [];
        batchData.forEach((row, index) => {
            if (row.dbId && (!row.name || row.name.trim() === '')) {
                errors.push(`第 ${index + 1} 行：用例名称不能为空`);
            }
            if (!row.dbId && row.name && row.name.trim() !== '') {
                // 新增行有名称才校验
            }
        });
        return errors;
    }

    function hasUnsavedChanges() {
        if (isAllLevel1Mode) {
            return hasLevel1UnsavedChanges();
        } else {
            return hasNormalUnsavedChanges();
        }
    }

    function hasNormalUnsavedChanges() {
        if (batchData.length !== originalData.length) return true;
        
        for (let i = 0; i < batchData.length; i++) {
            const current = batchData[i];
            const original = originalData[i];
            
            if (!original) return true;
            
            if (isCaseModified(current, original)) {
                return true;
            }
        }
        
        return false;
    }

    function hasLevel1UnsavedChanges() {
        if (level1BatchData.length !== originalData.length) {
            return true;
        }
        
        for (let i = 0; i < level1BatchData.length; i++) {
            const current = level1BatchData[i];
            const original = originalData[i];
            
            if (!original) return true;
            
            if (current.name !== original.name || current.type_field !== original.type_field) {
                return true;
            }
            
            if (!current.cases || !original.cases) {
                if (current.cases || original.cases) return true;
                continue;
            }
            
            if (current.cases.length !== original.cases.length) return true;
            
            for (let j = 0; j < current.cases.length; j++) {
                if (isCaseModified(current.cases[j], original.cases[j])) {
                    return true;
                }
            }
        }
        
        return false;
    }

    function isCaseModified(current, original) {
        const fieldsToCompare = ['name', 'priority', 'type', 'owner', 'phase', 'env', 
                                 'precondition', 'purpose', 'steps', 'expected', 
                                 'key_config', 'remark', 'environments', 
                                 'methods', 'sources', 'level1_id'];
        
        for (const field of fieldsToCompare) {
            const currentValue = current[field] || '';
            const originalValue = original[field] || '';
            
            if (currentValue !== originalValue) {
                return true;
            }
        }
        
        const currentProjects = current.projects || '';
        const originalProjects = original.projects || '';
        
        if (typeof currentProjects === 'string' && typeof originalProjects === 'string') {
            if (currentProjects !== originalProjects) {
                return true;
            }
        } else {
            const currentJson = JSON.stringify(currentProjects);
            const originalJson = JSON.stringify(originalProjects);
            if (currentJson !== originalJson) {
                return true;
            }
        }
        
        return false;
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

    async function goBack() {
        if (hasUnsavedChanges()) {
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

    async function saveBatchAndReturn() {
        const success = await saveBatch();
        return success;
    }

    function navigateBack() {
        isNavigatingBack = true;
        if (returnUrl) {
            window.location.href = returnUrl;
        } else if (document.referrer && document.referrer.includes(window.location.host)) {
            window.history.back();
        } else {
            window.location.href = `/#/cases`;
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
        showSuccessMessage('已批量应用默认值');
    }

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
        const addLevel1Btn    = document.getElementById('add-level1-btn');
        const addCaseToLevel1Btn = document.getElementById('add-case-to-level1-btn');
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

        if (backBtn) backBtn.addEventListener('click', goBack);
        if (cancelBtn) cancelBtn.addEventListener('click', goBack);
        if (saveBtn) saveBtn.addEventListener('click', saveBatch);
        if (addRowBtn) addRowBtn.addEventListener('click', addRow);
        if (addLevel1Btn) addLevel1Btn.addEventListener('click', () => {
            showSuccessMessage('批量查看模式下暂不支持添加一级测试点');
        });
        if (addCaseToLevel1Btn) addCaseToLevel1Btn.addEventListener('click', () => {
            addCaseToLevel1();
        });

        if (tableBody) {
            tableBody.addEventListener('input', handleTableInput);
            tableBody.addEventListener('change', handleTableInput);
            tableBody.addEventListener('click', handleTableAction);
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
                toggleLevel1Dropdown(!document.getElementById('level1-panel')?.classList.contains('active'));
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

        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges() && !isNavigatingBack) {
                e.preventDefault();
                e.returnValue = '';
                return '';
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

    async function init() {
        if (!checkAuth()) return;

        showLoadingState();

        await Promise.all([
            loadConfigData(),
            loadAllLevel1Points(),
            loadUsers()
        ]);

        await loadExistingTestCases();

        initBreadcrumb();
        createBulkDefaultsModal();
        renderTable();
        initEventListeners();
        initDrawerResizer();
        initTableResizer();
        initLevel1PanelResizer();
        initDrawerScriptFileUpload();

        hideLoadingState();
    }

    function showLoadingState() {
        const tableBody = document.getElementById('table-body');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 60px 20px;">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">
                            <div class="loading-spinner" style="width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                            <span style="color: #64748b; font-size: 14px;">正在加载测试用例...</span>
                        </div>
                    </td>
                </tr>
            `;
        }
    }

    function hideLoadingState() {
        // Loading state is replaced by renderTable()
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

    // ========================================
    // 关联脚本管理功能
    // ========================================
    
    let currentDrawerScripts = [];
    let editingDrawerScriptIndex = -1;
    
    async function loadDrawerScripts(testCaseId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/testcases/${testCaseId}/scripts`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            const data = await response.json();
            
            if (data.success && data.scripts) {
                currentDrawerScripts = data.scripts;
            } else {
                currentDrawerScripts = [];
            }
            renderDrawerScriptsSummary();
        } catch (error) {
            console.error('加载关联脚本失败:', error);
            currentDrawerScripts = [];
            renderDrawerScriptsSummary();
        }
    }
    
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
        
        if (!listContainer || !emptyState) return;
        
        if (currentDrawerScripts.length > 0) {
            emptyState.style.display = 'none';
            listContainer.style.display = 'block';
            if (editBtn) editBtn.style.display = 'inline-flex';
            
            listContainer.innerHTML = currentDrawerScripts.map((script, index) => `
                <div class="drawer-script-item">
                    <span class="script-type-badge ${script.script_type}">${script.script_type.toUpperCase()}</span>
                    <span class="script-name">${escapeHtml(script.script_name)}</span>
                    ${script.file_path ? `<span class="script-file-indicator" title="已上传文件">📎</span>` : ''}
                    ${script.link_url ? `<a href="${escapeHtml(script.link_url)}" target="_blank" class="script-link">查看</a>` : ''}
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
            
            const hiddenInput = document.getElementById('drawer-scripts');
            if (hiddenInput) hiddenInput.value = JSON.stringify(currentDrawerScripts);
        } else {
            emptyState.style.display = 'block';
            listContainer.style.display = 'none';
            if (editBtn) editBtn.style.display = 'none';
            const hiddenInput = document.getElementById('drawer-scripts');
            if (hiddenInput) hiddenInput.value = '';
        }
    }
    
    function getDrawerScripts() {
        return currentDrawerScripts;
    }
    
    function clearDrawerScripts() {
        currentDrawerScripts = [];
        renderDrawerScriptsSummary();
    }
    
    async function saveDrawerScripts(testCaseId) {
        if (!testCaseId || currentDrawerScripts.length === 0) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/testcases/scripts/batch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    test_case_id: testCaseId,
                    scripts: currentDrawerScripts
                })
            });
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('保存关联脚本失败:', error);
            return { success: false, message: '保存关联脚本失败' };
        }
    }
    
    window.openDrawerScriptModal = openDrawerScriptModal;
    window.closeDrawerScriptModal = closeDrawerScriptModal;
    window.editDrawerScript = editDrawerScript;
    window.saveDrawerScript = saveDrawerScript;
    window.removeDrawerScript = removeDrawerScript;
    window.removeDrawerScriptFile = removeDrawerScriptFile;
    window.loadDrawerScripts = loadDrawerScripts;
    window.getDrawerScripts = getDrawerScripts;
    window.clearDrawerScripts = clearDrawerScripts;
    window.saveDrawerScripts = saveDrawerScripts;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();