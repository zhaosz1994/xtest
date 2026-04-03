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

    async function loadExistingTestCases() {
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
                    projects: tc.projects || ''
                }));
                
                originalData = JSON.parse(JSON.stringify(batchData));
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
                <td class="actions-cell">
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
                    ${!row.dbId ? `
                    <button class="action-btn delete-btn" data-action="delete" data-index="${index}" data-tooltip="删除">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                    ` : ''}
                </td>
        `;
    }

    function renderTable() {
        const tbody = document.getElementById('table-body');
        if (!tbody) return;

        updateRowCountHint();

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
        } else if (action === 'delete') {
            deleteRow(index);
        } else if (action === 'detail') {
            openDrawer(index);
        }
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

        const confirmed = await showConfirmMessage('确定要删除该行数据吗？');
        if (!confirmed) return;

        batchData.splice(index, 1);
        
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
        if (isSaving) return;

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
                    updatedCases.push(caseData);
                } else {
                    newCases.push(caseData);
                }
            });

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
            } else {
                showErrorMessage(result.message || '保存失败');
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

    function goBack() {
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

        listEl.innerHTML = filteredPoints.map(point => `
            <div class="level1-dropdown-item ${point.id == level1Id ? 'selected' : ''}"
                 data-id="${point.id}"
                 data-module-id="${point.module_id}"
                 data-name="${escapeHtml(point.name)}"
                 data-module-name="${escapeHtml(point.module_name || '')}">
                <div class="level1-dropdown-item-name">${escapeHtml(point.name)}</div>
                <div class="level1-dropdown-item-module">${escapeHtml(point.module_name || '')}</div>
            </div>
        `).join('');

        if (filteredPoints.length === 0) {
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
        currentUrl.searchParams.set('level1Id', pointId);
        currentUrl.searchParams.set('level1Name', pointName);

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();