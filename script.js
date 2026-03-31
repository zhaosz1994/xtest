// 全局变量
let currentUser = null;
let authToken = null;
let socket = null;
let onlineUsers = [];
// 数据存储
let modules = [];
let mockUsers = [];
let historyRecords = [];
let chips = [];
let projects = [];

// ==================== 全局事件发布/订阅系统 ====================
const DataEventManager = {
    events: {},
    
    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
        return () => this.off(event, callback);
    },
    
    off(event, callback) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(cb => cb !== callback);
    },
    
    emit(event, data = {}) {
        if (!this.events[event]) return;
        this.events[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`事件处理器错误 [${event}]:`, error);
            }
        });
    }
};

const DataEvents = {
    TEST_CASE_CHANGED: 'testCaseDataChanged',
    MODULE_CHANGED: 'moduleDataChanged',
    LEVEL1_POINT_CHANGED: 'level1PointChanged',
    EXECUTION_RECORD_CHANGED: 'executionRecordChanged',
    DASHBOARD_REFRESH: 'dashboardRefresh'
};

// ==================== 轻量级 Hash 路由系统 ====================

const Router = {
    routes: {
        'dashboard': { section: 'dashboard', title: '测试管理', requiresAuth: true },
        'cases': { section: 'cases', title: '用例库', requiresAuth: true },
        'testplans': { section: 'testplans', title: '测试计划', requiresAuth: true },
        'reports': { section: 'reports', title: '测试报告', requiresAuth: true },
        'settings': { section: 'settings', title: '配置中心', requiresAuth: true },
        'login': { section: 'login', title: '登录', requiresAuth: false },
        'register': { section: 'register', title: '注册', requiresAuth: false }
    },

    defaultRoute: 'dashboard',
    loginRoute: 'login',

    init() {
        window.addEventListener('hashchange', () => this.handleRouteChange());
        this.handleRouteChange();
    },

    navigateTo(routeName) {
        if (!routeName || !this.routes[routeName]) {
            routeName = this.defaultRoute;
        }
        window.location.hash = '#/' + routeName;
    },

    getCurrentRoute() {
        const hash = window.location.hash.slice(2) || '';
        return hash.split('?')[0].split('/')[0] || this.defaultRoute;
    },

    getRouteParams() {
        const hash = window.location.hash.slice(2) || '';
        const queryString = hash.split('?')[1] || '';
        const params = {};
        if (queryString) {
            queryString.split('&').forEach(pair => {
                const [key, value] = pair.split('=');
                params[decodeURIComponent(key)] = decodeURIComponent(value || '');
            });
        }
        return params;
    },

    handleRouteChange() {
        const routeName = this.getCurrentRoute();
        const route = this.routes[routeName];

        console.log('[Router] 路由变化:', routeName, route);
        console.log('[Router] 是否已认证:', this.isAuthenticated());

        if (!route) {
            console.warn('[Router] 未知路由，跳转到默认页面');
            this.navigateTo(this.defaultRoute);
            return;
        }

        if (route.requiresAuth && !this.isAuthenticated()) {
            console.log('[Router] 需要登录，跳转到登录页');
            this.navigateTo('login');
            return;
        }

        if (route.requiresAdmin && !this.isAdmin()) {
            console.log('[Router] 需要管理员权限');
            showErrorMessage('只有管理员才能访问此页面');
            this.navigateTo(this.defaultRoute);
            return;
        }

        if (!route.requiresAuth && this.isAuthenticated()) {
            if (routeName === 'login' || routeName === 'register') {
                console.log('[Router] 已登录，跳转到首页');
                this.navigateTo(this.defaultRoute);
                return;
            }
        }

        console.log('[Router] 显示页面:', route.section);
        this.showSection(route.section, route.title);

        document.title = route.title + ' - xTest';

        this.updateNavigation(routeName);
    },

    isAuthenticated() {
        return !!(authToken && currentUser);
    },

    isAdmin() {
        return !!(currentUser && (
            currentUser.role === '管理员' ||
            currentUser.role === 'admin' ||
            currentUser.role === 'Administrator'
        ));
    },

    showSection(sectionId, title) {
        if (sectionId === 'login' || sectionId === 'register') {
            this.showLoginSection();
            return;
        }

        document.querySelectorAll('section').forEach(section => {
            section.style.display = 'none';
        });

        const targetSection = document.getElementById(`${sectionId}-section`);
        if (targetSection) {
            targetSection.style.display = 'block';
        }

        const loginSection = document.getElementById('login-section');
        const registerSection = document.getElementById('register-section');
        if (loginSection) loginSection.style.display = 'none';
        if (registerSection) registerSection.style.display = 'none';

        const testlinkContainer = document.querySelector('.testlink-container');
        if (testlinkContainer) {
            testlinkContainer.style.display = 'block';
        }

        // 根据不同页面加载对应数据
        switch (sectionId) {
            case 'cases':
                initModuleData().then(() => {
                    loadAllLevel1Points();
                });
                break;
            case 'testplans':
                loadTestPlans().then(() => {
                    initTestPlanFilters();
                });
                renderTestCasesTable();
                break;
            case 'reports':
                loadTestReports();
                loadProjects();
                initReportFilters();
                break;
            case 'settings':
                applyMenuVisibilityByRole();
                loadUsers();
                loadProjects();
                initConfigCenter();
                break;
            case 'dashboard':
                loadRecentLogins();
                updateStats();
                break;
        }
    },

    showLoginSection() {
        console.log('[Router] 显示登录页面');
        
        document.querySelectorAll('section').forEach(section => {
            section.style.display = 'none';
        });

        const testlinkContainer = document.querySelector('.testlink-container');
        if (testlinkContainer) {
            testlinkContainer.style.display = 'none';
            console.log('[Router] 隐藏testlink-container');
        }

        const loginSection = document.getElementById('login-section');
        if (loginSection) {
            loginSection.style.display = 'flex';
            console.log('[Router] 显示login-section');
        } else {
            console.error('[Router] 未找到login-section元素');
        }
    },

    updateNavigation(routeName) {
        document.querySelectorAll('.nav-item, .sidebar-link').forEach(link => {
            link.classList.remove('active');
            const href = link.getAttribute('href');
            if (href === `#${routeName}` || href === `#/${routeName}`) {
                link.classList.add('active');
            }
        });
    }
};

function navigateTo(routeName) {
    Router.navigateTo(routeName);
}

function handleRouteChange() {
    Router.handleRouteChange();
}

// ==================== 结束 Hash 路由系统 ====================

// API响应缓存
const apiCache = {
    data: {},
    timestamps: {},
    ttl: 5 * 60 * 1000, // 默认缓存5分钟

    get(key) {
        const cached = this.data[key];
        const timestamp = this.timestamps[key];
        if (cached && timestamp && (Date.now() - timestamp < this.ttl)) {
            return cached;
        }
        return null;
    },

    set(key, value, customTtl) {
        this.data[key] = value;
        this.timestamps[key] = Date.now();
        if (customTtl) {
            setTimeout(() => this.delete(key), customTtl);
        }
    },

    delete(key) {
        if (this.data.hasOwnProperty(key)) {
            delete this.data[key];
        }
        if (this.timestamps.hasOwnProperty(key)) {
            delete this.timestamps[key];
        }
        console.log(`[缓存清除] ${key}`);
    },

    deleteByPrefix(prefix) {
        let count = 0;
        Object.keys(this.data).forEach(key => {
            if (key.startsWith(prefix)) {
                delete this.data[key];
                delete this.timestamps[key];
                count++;
            }
        });
        if (count > 0) {
            console.log(`[缓存批量清除] 前缀 "${prefix}" 匹配 ${count} 条缓存`);
        }
    },

    clear() {
        this.data = {};
        this.timestamps = {};
    }
};

// 统一过滤负责人列表（过滤掉admin用户）
function filterOwners(users) {
    if (!users || !Array.isArray(users)) return [];
    return users.filter(user => user.username && user.username.toLowerCase() !== 'admin');
}

// 当前用例库ID
let currentCaseLibraryId = 2; // 默认使用U12项目的ID

// 测试计划模块选择
let selectedModules = [];

// 模块管理相关变量
let moduleList = [];
let currentModulePage = 1;
const modulesPerPage = 32;

// 一级测试点相关变量
let level1Points = [];
let currentLevel1Page = 1;
const level1PointsPerPage = 32;
let selectedModuleId = null;

// 搜索关键词
let level1SearchKeyword = '';
let testCaseSearchKeyword = '';

// 测试用例分页
let currentTestCasePage = 1;

// 当前选中的一级测试点ID和名称
let selectedLevel1PointId = null;
let selectedLevel1PointName = null;
// 当前用例库编号、模块编号和一级测试点编号
let currentLibraryId = null;
let currentModuleId = null;

// ========================================
// 防抖函数
// ========================================
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 节流函数
// ========================================
function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ========================================
// 测试点列表拖拽调整宽度
// ========================================
function initCaseListResizer() {
    const wrapper = document.getElementById('case-list-wrapper');
    const resizer = document.getElementById('case-list-resizer');
    
    if (!wrapper || !resizer) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    const minWidth = 400;
    const maxWidthRatio = 0.6;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = wrapper.offsetWidth;
        
        resizer.classList.add('dragging');
        document.body.classList.add('case-list-resizing');
        
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        const newWidth = startWidth + deltaX;
        const maxWidth = window.innerWidth * maxWidthRatio;
        
        if (newWidth >= minWidth && newWidth <= maxWidth) {
            wrapper.style.flex = 'none';
            wrapper.style.width = newWidth + 'px';
        } else if (newWidth < minWidth) {
            wrapper.style.flex = 'none';
            wrapper.style.width = minWidth + 'px';
        } else if (newWidth > maxWidth) {
            wrapper.style.flex = 'none';
            wrapper.style.width = maxWidth + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('dragging');
            document.body.classList.remove('case-list-resizing');
        }
    });

    resizer.addEventListener('dblclick', () => {
        wrapper.style.flex = '1';
        wrapper.style.width = '';
    });
}

function initFloatingPanelResizer() {
    const panel = document.getElementById('test-points-floating-panel');
    const resizer = document.getElementById('floating-panel-resizer');
    
    if (!panel || !resizer) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    const minWidth = 600;
    const maxWidthRatio = 0.95;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        
        resizer.classList.add('dragging');
        document.body.classList.add('floating-panel-resizing');
        
        e.preventDefault();
        e.stopPropagation();
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
            document.body.classList.remove('floating-panel-resizing');
        }
    });

    resizer.addEventListener('dblclick', () => {
        panel.style.width = '70%';
    });
}

// ========================================
// 搜索事件绑定
// ========================================
function initSearchEvents() {
    // 一级测试点搜索
    const level1SearchInput = document.getElementById('level1-search-input');
    if (level1SearchInput) {
        const debouncedLevel1Search = debounce((value) => {
            level1SearchKeyword = value.trim();
            currentLevel1Page = 1; // 重置页码
            if (selectedModuleId) {
                loadLevel1Points(selectedModuleId);
            } else if (currentCaseLibraryId) {
                loadAllLevel1Points();
            }
        }, 500);

        level1SearchInput.addEventListener('input', (e) => {
            debouncedLevel1Search(e.target.value);
        });
    }

    // 测试用例搜索
    const testCaseSearchInput = document.getElementById('testcase-search-input');
    if (testCaseSearchInput) {
        const debouncedTestCaseSearch = debounce((value) => {
            console.log('🔍 触发[测试用例]搜索，关键字:', value);
            testCaseSearchKeyword = value.trim();
            currentTestCasePage = 1; // 重置页码
            // 重新加载测试用例列表
            if (selectedLevel1PointId) {
                refreshTestCasesList();
            }
        }, 500);

        testCaseSearchInput.addEventListener('input', (e) => {
            debouncedTestCaseSearch(e.target.value);
        });
    }
}

// ========================================
// 主题系统
// ========================================

const ThemeSystem = {
    theme: 'light',
    storageKey: 'xtest-theme',

    init() {
        const savedTheme = localStorage.getItem(this.storageKey);
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        this.theme = savedTheme || (prefersDark ? 'dark' : 'light');
        this.apply(this.theme);
        this.bindEvents();
    },

    toggle() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        this.apply(this.theme);
        localStorage.setItem(this.storageKey, this.theme);

        // 触发主题变更事件
        window.dispatchEvent(new CustomEvent('themechange', {
            detail: { theme: this.theme }
        }));
    },

    apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);

        // 更新主题切换按钮图标
        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
            toggle.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到暗黑模式');
        }
    },

    bindEvents() {
        // 监听系统主题变化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem(this.storageKey)) {
                this.theme = e.matches ? 'dark' : 'light';
                this.apply(this.theme);
            }
        });
    },

    isDark() {
        return this.theme === 'dark';
    }
};

// ========================================
// 命令面板系统
// ========================================

const CommandPalette = {
    isOpen: false,
    selectedIndex: 0,
    commands: [],
    filteredCommands: [],

    init() {
        this.commands = this.getCommands();
        this.render();
        this.bindEvents();
    },

    getCommands() {
        return [
            {
                id: 'new-testplan',
                title: '新建测试计划',
                description: '创建一个新的测试计划',
                icon: '📋',
                shortcut: ['N', 'P'],
                action: () => { addTestPlan(); }
            },
            {
                id: 'new-testcase',
                title: '新建测试用例',
                description: '创建一个新的测试用例',
                icon: '📝',
                shortcut: ['N', 'C'],
                action: () => { addTestCase(); }
            },
            {
                id: 'search-testplan',
                title: '搜索测试计划',
                description: '快速查找测试计划',
                icon: '🔍',
                shortcut: ['/'],
                action: () => {
                    navigateTo('testplans');
                    setTimeout(() => {
                        document.getElementById('testplan-search-input')?.focus();
                    }, 100);
                }
            },
            {
                id: 'dashboard',
                title: '仪表盘',
                description: '查看测试概览',
                icon: '📊',
                shortcut: ['G', 'D'],
                action: () => { navigateTo('dashboard'); }
            },
            {
                id: 'testplans',
                title: '测试计划',
                description: '管理测试计划',
                icon: '📋',
                shortcut: ['G', 'P'],
                action: () => { navigateTo('testplans'); }
            },
            {
                id: 'cases',
                title: '用例管理',
                description: '管理测试用例',
                icon: '📁',
                shortcut: ['G', 'C'],
                action: () => { navigateTo('cases'); }
            },
            {
                id: 'reports',
                title: '测试报告',
                description: '查看测试报告',
                icon: '📈',
                shortcut: ['G', 'R'],
                action: () => { navigateTo('reports'); }
            },
            {
                id: 'settings',
                title: '配置中心',
                description: '系统配置管理',
                icon: '⚙️',
                shortcut: ['G', 'S'],
                action: () => { navigateTo('settings'); }
            },
            {
                id: 'toggle-theme',
                title: '切换主题',
                description: '在浅色和暗黑模式之间切换',
                icon: '🌙',
                shortcut: ['T', 'T'],
                action: () => { ThemeSystem.toggle(); }
            },
            {
                id: 'ai-assistant',
                title: 'AI知识问答',
                description: '打开AI助手',
                icon: '🤖',
                shortcut: ['A', 'I'],
                action: () => { openAIAssistant(); }
            }
        ];
    },

    render() {
        const palette = document.createElement('div');
        palette.id = 'command-palette';
        palette.className = 'command-palette';
        palette.innerHTML = `
            <div class="command-palette-container">
                <div class="command-palette-input-wrapper">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.35-4.35"></path>
                    </svg>
                    <input type="text" class="command-palette-input" id="command-input" placeholder="输入命令或搜索..." autocomplete="off">
                    <div class="shortcut-hint">
                        <kbd>ESC</kbd> 关闭
                    </div>
                </div>
                <div class="command-palette-results" id="command-results"></div>
            </div>
        `;

        document.body.appendChild(palette);
        this.element = palette;
        this.input = palette.querySelector('#command-input');
        this.results = palette.querySelector('#command-results');
    },

    open() {
        this.isOpen = true;
        this.selectedIndex = 0;
        this.element.classList.add('active');
        this.input.value = '';
        this.filter('');
        this.input.focus();
    },

    close() {
        this.isOpen = false;
        this.element.classList.remove('active');
    },

    filter(query) {
        const q = query.toLowerCase().trim();

        if (!q) {
            this.filteredCommands = this.commands;
        } else {
            this.filteredCommands = this.commands.filter(cmd =>
                cmd.title.toLowerCase().includes(q) ||
                cmd.description.toLowerCase().includes(q) ||
                cmd.id.toLowerCase().includes(q)
            );
        }

        this.renderResults();
    },

    renderResults() {
        if (this.filteredCommands.length === 0) {
            this.results.innerHTML = `
                <div class="empty-state" style="padding: 32px;">
                    <div class="empty-state-emoji">🔍</div>
                    <div class="empty-state-title">未找到匹配的命令</div>
                    <div class="empty-state-description">尝试其他关键词</div>
                </div>
            `;
            return;
        }

        this.results.innerHTML = this.filteredCommands.map((cmd, index) => `
            <div class="command-palette-item ${index === this.selectedIndex ? 'selected' : ''}" 
                 data-index="${index}">
                <div class="command-palette-item-icon">${cmd.icon}</div>
                <div class="command-palette-item-content">
                    <div class="command-palette-item-title">${cmd.title}</div>
                    <div class="command-palette-item-description">${cmd.description}</div>
                </div>
                ${cmd.shortcut ? `
                    <div class="command-palette-item-shortcut">
                        ${cmd.shortcut.map(k => `<kbd>${k}</kbd>`).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');

        // 绑定点击事件
        this.results.querySelectorAll('.command-palette-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.execute(index);
            });
        });
    },

    execute(index) {
        const cmd = this.filteredCommands[index];
        if (cmd && cmd.action) {
            this.close();
            cmd.action();
        }
    },

    selectNext() {
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
        this.renderResults();
    },

    selectPrev() {
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.renderResults();
    },

    bindEvents() {
        // 全局快捷键
        document.addEventListener('keydown', (e) => {
            // Ctrl+K 或 Cmd+K 打开命令面板
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                if (this.isOpen) {
                    this.close();
                } else {
                    this.open();
                }
            }

            // ESC 关闭
            if (e.key === 'Escape' && this.isOpen) {
                e.preventDefault();
                this.close();
            }

            // 命令面板内的键盘导航
            if (this.isOpen) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.selectNext();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.selectPrev();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.execute(this.selectedIndex);
                }
            }
        });

        // 输入过滤
        this.input.addEventListener('input', (e) => {
            this.filter(e.target.value);
        });

        // 点击背景关闭
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.close();
            }
        });
    }
};

// ========================================
// 游戏化系统
// ========================================

const GamificationSystem = {
    achievements: [],

    // 显示终端风格成功提示
    showTerminalSuccess(title, details) {
        const toast = document.createElement('div');
        toast.className = 'terminal-success';
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 10000;
            min-width: 400px;
            animation: terminalSuccess 0.5s ease;
        `;

        toast.innerHTML = `
            <div class="terminal-success-header">
                <div class="dots">
                    <span class="dot red"></span>
                    <span class="dot yellow"></span>
                    <span class="dot green"></span>
                </div>
                <span style="margin-left: 12px; font-weight: bold;">xTest Terminal</span>
            </div>
            <div class="terminal-success-content">
                <div><span class="prompt">$</span> <span class="command">run_tests --all</span></div>
                <div style="margin-top: 8px;">
                    <span class="result">[OK] ${title}</span>
                </div>
                ${details ? `<div style="margin-top: 4px; color: var(--color-text-secondary);">${details}</div>` : ''}
                <div style="margin-top: 8px;">
                    <span class="prompt">$</span> <span style="animation: blink 1s infinite;">_</span>
                </div>
            </div>
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'terminalFadeOut 0.5s ease forwards';
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    },

    // 显示有趣的空状态
    showEmptyState(container, type = 'default') {
        const states = {
            'no-tests': {
                emoji: '(╯°□°)╯︵ ┻━┻',
                title: '竟然没有测试计划？',
                description: '快来创建第一个测试计划吧！',
                ascii: `
    ╭━━━━╮
    ┃ ◉  ┃
    ╰━━━━╯
                `
            },
            'no-bugs': {
                emoji: '🎉',
                title: '太棒了！没有发现Bug！',
                description: '继续保持，代码质量很棒！',
                ascii: `
  _____ _                 _     __   __          
 |_   _| |__   __ _ _ __ | | __ \\ \\ / /__  _   _ 
   | | | '_ \\ / _\` | '_ \\| |/ /  \\ V / _ \\| | | |
   | | | | | | (_| | | | |   <    | | (_) | |_| |
   |_| |_| |_|\\__,_|_| |_|_|\\_\\   |_|\\___/ \\__,_|
                `
            },
            'no-cases': {
                emoji: '📝',
                title: '还没有测试用例',
                description: '开始编写你的第一个测试用例吧！',
                ascii: `
    ┌────────────────┐
    │  新建用例...   │
    └────────────────┘
                `
            },
            'default': {
                emoji: '🔍',
                title: '暂无数据',
                description: '这里空空如也',
                ascii: ''
            }
        };

        const state = states[type] || states['default'];

        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-emoji">${state.emoji}</div>
                <div class="empty-state-title">${state.title}</div>
                <div class="empty-state-description">${state.description}</div>
                ${state.ascii ? `<pre class="empty-state-ascii">${state.ascii}</pre>` : ''}
            </div>
        `;
    },

    // 创建XP进度条
    createXPProgress(container, current, max, label = '经验值') {
        const percent = Math.min((current / max) * 100, 100);
        container.innerHTML = `
            <div class="xp-progress-wrapper">
                <div class="xp-progress-header">
                    <span class="xp-label">${label}</span>
                    <span class="xp-value mono">${current} / ${max}</span>
                </div>
                <div class="xp-progress">
                    <div class="xp-progress-bar" style="width: ${percent}%"></div>
                    <span class="xp-progress-text">${Math.round(percent)}%</span>
                </div>
            </div>
        `;
    }
};

// 添加CSS动画
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    @keyframes terminalSuccess {
        from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.9);
        }
        to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }
    }
    
    @keyframes terminalFadeOut {
        from {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }
        to {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.9);
        }
    }
    
    @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
    }
    
    .xp-progress-wrapper {
        width: 100%;
    }
    
    .xp-progress-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 14px;
    }
    
    .xp-label {
        color: var(--color-text-secondary);
    }
    
    .xp-value {
        color: var(--color-text-primary);
        font-weight: 600;
    }
`;
document.head.appendChild(styleSheet);

// 防抖函数
// API基础URL - 动态获取当前主机地址，支持跨平台部署
const API_BASE_URL = (function () {
    const origin = window.location.origin;
    return origin + '/api';
})();

// 显示加载状态
function showLoading(message = '加载中...') {
    const loadingElement = document.createElement('div');
    loadingElement.id = 'loading-overlay';
    loadingElement.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(255, 255, 255, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-size: 18px;
        font-weight: bold;
    `;
    loadingElement.textContent = message;
    document.body.appendChild(loadingElement);
}

// 隐藏加载状态
function hideLoading() {
    const loadingElement = document.getElementById('loading-overlay');
    if (loadingElement) {
        loadingElement.remove();
    }
}

// 显示成功消息提示
// 切换密码可见性
function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        button.innerHTML = `
            <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
        `;
    } else {
        input.type = 'password';
        button.innerHTML = `
            <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
        `;
    }
}

// ========================================
// 骨架屏和加载状态管理
// ========================================

const SkeletonLoader = {
    // 渲染表格骨架屏
    renderTableSkeleton(containerId, rows = 5, cols = 6) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let skeletonHtml = '<div class="skeleton-wrapper">';
        for (let i = 0; i < rows; i++) {
            skeletonHtml += '<div class="skeleton-row" style="display: flex; gap: 16px; margin-bottom: 12px;">';
            for (let j = 0; j < cols; j++) {
                const width = j === 0 ? '60px' : j === 1 ? '200px' : '100px';
                skeletonHtml += `<div class="skeleton" style="height: 20px; width: ${width};"></div>`;
            }
            skeletonHtml += '</div>';
        }
        skeletonHtml += '</div>';

        container.innerHTML = skeletonHtml;
    },

    // 渲染卡片骨架屏
    renderCardSkeleton(containerId, count = 4) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let skeletonHtml = '<div class="skeleton-wrapper" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">';
        for (let i = 0; i < count; i++) {
            skeletonHtml += `
                <div class="skeleton-card" style="padding: 20px; background: var(--color-bg-primary); border-radius: 12px; border: 1px solid var(--color-border-primary);">
                    <div class="skeleton skeleton-text" style="width: 60%; height: 14px; margin-bottom: 12px;"></div>
                    <div class="skeleton skeleton-title" style="height: 32px; width: 80%;"></div>
                </div>
            `;
        }
        skeletonHtml += '</div>';

        container.innerHTML = skeletonHtml;
    },

    // 渲染列表骨架屏
    renderListSkeleton(containerId, count = 5) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let skeletonHtml = '<div class="skeleton-wrapper">';
        for (let i = 0; i < count; i++) {
            skeletonHtml += `
                <div style="display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid var(--color-border-primary);">
                    <div class="skeleton skeleton-avatar"></div>
                    <div style="flex: 1;">
                        <div class="skeleton skeleton-text" style="width: 40%;"></div>
                        <div class="skeleton skeleton-text" style="width: 60%; margin-top: 8px;"></div>
                    </div>
                </div>
            `;
        }
        skeletonHtml += '</div>';

        container.innerHTML = skeletonHtml;
    },

    // 移除骨架屏
    removeSkeleton(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const skeletonWrapper = container.querySelector('.skeleton-wrapper');
        if (skeletonWrapper) {
            skeletonWrapper.remove();
        }
    }
};

// 加载状态管理
const LoadingState = {
    // 显示按钮加载状态
    showButtonLoading(buttonId, loadingText = '处理中...') {
        const button = document.getElementById(buttonId);
        if (!button) return;

        button.disabled = true;
        button.dataset.originalText = button.innerHTML;
        button.innerHTML = `
            <span class="loading-spinner loading-spinner-sm"></span>
            <span>${loadingText}</span>
        `;
        button.classList.add('btn-loading');
    },

    // 隐藏按钮加载状态
    hideButtonLoading(buttonId) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        button.disabled = false;
        if (button.dataset.originalText) {
            button.innerHTML = button.dataset.originalText;
            delete button.dataset.originalText;
        }
        button.classList.remove('btn-loading');
    },

    // 显示全屏加载
    showFullscreenLoading(message = '加载中...') {
        let overlay = document.getElementById('fullscreen-loading');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'fullscreen-loading';
            overlay.innerHTML = `
                <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;">
                    <div style="background: white; padding: 32px; border-radius: 16px; text-align: center;">
                        <div class="loading-spinner loading-spinner-lg" style="margin: 0 auto 16px;"></div>
                        <div style="color: var(--gray-700); font-size: 14px;">${message}</div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }
    },

    // 隐藏全屏加载
    hideFullscreenLoading() {
        const overlay = document.getElementById('fullscreen-loading');
        if (overlay) {
            overlay.remove();
        }
    }
};

// 显示成功消息
function showSuccessMessage(message) {
    // 获取提示元素
    const toast = document.getElementById('success-toast');
    const content = toast?.querySelector('.success-toast-content');

    if (content) {
        // 设置消息内容
        content.textContent = message;

        // 显示提示
        toast.style.display = 'block';
        toast.classList.remove('fade-out');

        // 1秒后开始淡出
        setTimeout(() => {
            toast.classList.add('fade-out');

            // 淡出动画结束后隐藏元素
            setTimeout(() => {
                toast.style.display = 'none';
            }, 300);
        }, 1000);
    } else {
        console.log('成功:', message);
    }
}

// 显示Toast提示（兼容函数）
function showToast(message, type = 'info') {
    switch (type) {
        case 'success':
            showSuccessMessage(message);
            break;
        case 'error':
            showErrorMessage(message);
            break;
        case 'warning':
            console.warn('警告:', message);
            showErrorMessage(message);
            break;
        default:
            console.log('提示:', message);
            showSuccessMessage(message);
    }
}

// 显示错误消息模态框
function showErrorMessage(message) {
    const modal = document.getElementById('error-modal');
    const errorMessage = document.getElementById('error-message');
    if (errorMessage && modal) {
        errorMessage.textContent = message;
        modal.style.display = 'block';
    } else {
        console.error('错误模态框元素未找到:', { modalExists: !!modal, errorMessageExists: !!errorMessage });
        console.error('错误消息:', message);
        console.warn('showErrorMessage: 模态框元素不存在，已在控制台输出错误');
    }
}

// 关闭错误消息模态框
function closeErrorModal() {
    const modal = document.getElementById('error-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 确认模态框回调函数
let confirmCallback = null;

// 显示确认消息模态框（回调函数版本）
function showConfirmModal(message, callback) {
    const modal = document.getElementById('confirm-modal');
    const confirmMessage = document.getElementById('confirm-message');

    if (!modal || !confirmMessage) {
        // 如果模态框不存在，使用原生确认框
        const result = confirm(message);
        if (callback) callback(result);
        return;
    }

    // 处理消息中的换行符
    confirmMessage.textContent = message;
    confirmMessage.style.whiteSpace = 'pre-wrap';
    modal.style.display = 'flex'; // 使用flex以保持居中

    // 保存回调函数到window对象
    window.confirmCallback = callback;
}

// 显示确认消息模态框（Promise版本）
function showConfirmMessage(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const confirmMessage = document.getElementById('confirm-message');
        confirmMessage.textContent = message;
        modal.style.display = 'flex'; // 使用flex以保持居中

        // 保存回调函数
        window.confirmCallback = resolve;
    });
}

// 处理API响应
async function handleApiResponse(response) {
    try {
        // 检查响应是否为JSON
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'API请求失败');
            }
            return data;
        } else {
            // 不是JSON响应，可能是HTML 404页面
            throw new Error('服务器返回非JSON响应');
        }
    } catch (error) {
        // 如果解析JSON失败，返回错误
        throw new Error('API响应解析失败: ' + error.message);
    }
}

// 刷新 Token 的函数
async function refreshToken() {
    try {
        const response = await fetch(`${API_BASE_URL}/users/refresh-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Token刷新失败');
        }

        const data = await response.json();
        
        if (data.success && data.token) {
            authToken = data.token;
            currentUser = data.user;
            
            // 更新 localStorage
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            console.log('[Token刷新] Token已自动刷新');
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('[Token刷新] 刷新失败:', error);
        return false;
    }
}

// 发送API请求（支持缓存和自动刷新token）
async function apiRequest(endpoint, options = {}) {
    const { useCache = true, cacheTtl, method = 'GET', skipRetry = false } = options;

    // 对于GET请求，检查缓存
    if (method === 'GET' && useCache) {
        const cached = apiCache.get(endpoint);
        if (cached) {
            console.log(`[缓存命中] ${endpoint}`);
            return cached;
        }
    } else if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        console.log(`[API请求] ${method} ${endpoint}`);
    }

    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers
        });

        // 检查响应状态
        if (!response.ok) {
            // 如果是403错误且不是刷新token的请求，尝试刷新token
            if (response.status === 403 && !skipRetry && authToken) {
                console.log('[API请求] Token可能已过期，尝试刷新...');
                
                const refreshed = await refreshToken();
                
                if (refreshed) {
                    // 使用新token重试请求
                    headers['Authorization'] = `Bearer ${authToken}`;
                    console.log('[API请求] 使用新token重试请求');
                    
                    const retryResponse = await fetch(url, {
                        ...options,
                        headers
                    });
                    
                    if (retryResponse.ok) {
                        const result = await handleApiResponse(retryResponse);
                        
                        // 对于成功的GET请求，缓存结果
                        if (method === 'GET' && result.success && useCache) {
                            apiCache.set(endpoint, result, cacheTtl);
                        }
                        
                        return result;
                    }
                } else {
                    // Token刷新失败，清除登录状态并跳转到登录页
                    console.log('[API请求] Token刷新失败，需要重新登录');
                    authToken = null;
                    currentUser = null;
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('currentUser');
                    
                    // 显示提示
                    showNetworkError('登录已过期，请重新登录');
                    
                    // 延迟跳转到登录页
                    setTimeout(() => {
                        if (typeof showLoginSection === 'function') {
                            showLoginSection();
                        }
                    }, 1500);
                    
                    return { success: false, message: '登录已过期，请重新登录', _authExpired: true };
                }
            }
            
            // 对于404等错误，尝试获取响应文本
            try {
                const text = await response.text();
                // 检查是否是HTML
                if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                    return { success: false, message: '服务器返回HTML页面 (404 Not Found)' };
                } else {
                    return { success: false, message: text };
                }
            } catch {
                return { success: false, message: `服务器错误: ${response.status} ${response.statusText}` };
            }
        }

        const result = await handleApiResponse(response);

        // 对于成功的GET请求，缓存结果
        if (method === 'GET' && result.success && useCache) {
            apiCache.set(endpoint, result, cacheTtl);
        }

        // 对于修改数据的请求，清除相关缓存
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            const basePath = endpoint.split('?')[0];
            apiCache.delete(basePath);

            // 清除列表缓存 - 提取基础路径
            const pathParts = basePath.split('/');
            if (pathParts.length >= 2) {
                const resourceBase = pathParts.slice(0, 2).join('/');
                apiCache.delete(resourceBase + '/list');
            }

            // 清除可能的变体
            apiCache.delete(basePath.replace('/create', '/list'));
            apiCache.delete(basePath.replace('/update', '/list'));
            apiCache.delete(basePath.replace('/delete', '/list'));

            // 清除带ID的子资源缓存（如 /testpoints/execution-records -> /testpoints/execution-records/123）
            if (pathParts.length >= 2) {
                const baseResource = pathParts.slice(0, pathParts.length).join('/');
                apiCache.deleteByPrefix(baseResource);
            }
        }

        return result;
    } catch (error) {
        console.error('API请求错误:', error);

        if (error.name === 'TypeError' || error.message.includes('fetch')) {
            showNetworkError('网络连接失败，请检查网络设置');
        } else if (error.message.includes('JSON') || error.message.includes('parse')) {
            showNetworkError('服务器响应格式错误');
        }

        return { success: false, message: error.message || '服务器连接失败', _error: true };
    }
}

function showNetworkError(message) {
    const existingBanner = document.getElementById('network-error-banner');
    if (existingBanner) {
        existingBanner.querySelector('.error-message').textContent = message;
        return;
    }

    const banner = document.createElement('div');
    banner.id = 'network-error-banner';
    banner.style.css = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        padding: 12px 20px;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        font-size: 14px;
    `;
    banner.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="12" x2="12" y2="17"></line>
            <line x1="12" y1="12" x2="12" y2="17"></line>
        </svg>
        <span class="error-message">${escapeHtml(message)}</span>
        <button onclick="this.parentElement.remove()" style="background: rgba(255,255,255,0.2); border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-left: 12px;">关闭</button>
    `;

    document.body.appendChild(banner);

    setTimeout(() => {
        if (banner.parentElement) {
            banner.remove();
        }
    }, 5000);
}

// 从后端加载数据
async function loadData() {
    try {
        showLoading('加载数据中...');

        // 加载用户数据
        try {
            const usersData = await apiRequest('/users/list', { useCache: false });
            if (usersData.success && usersData.users) {
                mockUsers = usersData.users;
            } else {
                // 加载失败时使用默认数据
                mockUsers = [
                    { username: 'admin', password: 'ctc@2026.', role: '管理员', email: 'admin@example.com' },
                    { username: 'tester1', password: 'tester123', role: '测试人员', email: 'tester1@example.com' }
                ];
            }
        } catch (error) {
            console.error('加载用户数据失败:', error);
            // 加载失败时使用默认数据
            mockUsers = [
                { username: 'admin', password: 'ctc@2026.', role: '管理员', email: 'admin@example.com' },
                { username: 'tester1', password: 'tester123', role: '测试人员', email: 'tester1@example.com' }
            ];
        }

        // 加载历史记录
        try {
            const historyData = await apiRequest('/history/list', { useCache: false });
            if (historyData.success && historyData.history) {
                historyRecords = historyData.history;
            } else {
                // 加载失败时使用默认数据
                historyRecords = [
                    { time: '2026-01-13 10:00:00', user: 'admin', action: '添加', content: '添加了模块1', version: 'v1.0' },
                    { time: '2026-01-13 10:30:00', user: 'tester1', action: '修改', content: '修改了测试点1', version: 'v1.1' }
                ];
            }
        } catch (error) {
            console.error('加载历史记录失败:', error);
            // 加载失败时使用默认数据
            historyRecords = [
                { time: '2026-01-13 10:00:00', user: 'admin', action: '添加', content: '添加了模块1', version: 'v1.0' },
                { time: '2026-01-13 10:30:00', user: 'tester1', action: '修改', content: '修改了测试点1', version: 'v1.1' }
            ];
        }

        // 加载模块数据
        try {
            const modulesData = await apiRequest('/modules/list', {
                method: 'POST',
                body: JSON.stringify({ libraryId: currentCaseLibraryId || 2, page: 1, pageSize: 100 })
            });
            if (modulesData.success && modulesData.modules) {
                modules = modulesData.modules;
            } else {
                // 加载失败时使用默认数据
                modules = [
                    { id: 'module1', name: '模块1' },
                    { id: 'module2', name: '模块2' },
                    { id: 'module3', name: '模块3' }
                ];
            }
        } catch (error) {
            console.error('加载模块数据失败:', error);
            // 加载失败时使用默认数据
            modules = [
                { id: 'module1', name: '模块1' },
                { id: 'module2', name: '模块2' },
                { id: 'module3', name: '模块3' }
            ];
        }

        // 加载芯片数据
        try {
            const chipsData = await apiRequest('/chips/list', { useCache: false });
            if (chipsData.success && chipsData.chips) {
                chips = chipsData.chips;
            } else {
                // 加载失败时使用默认数据
                chips = [
                    { id: 1, chip_id: 'chip1', name: '芯片1', description: '默认测试芯片1' },
                    { id: 2, chip_id: 'chip2', name: '芯片2', description: '默认测试芯片2' },
                    { id: 3, chip_id: 'chip3', name: '芯片3', description: '默认测试芯片3' }
                ];
            }
        } catch (error) {
            console.error('加载芯片数据失败:', error);
            // 加载失败时使用默认数据
            chips = [
                { id: 1, chip_id: 'chip1', name: '芯片1', description: '默认测试芯片1' },
                { id: 2, chip_id: 'chip2', name: '芯片2', description: '默认测试芯片2' },
                { id: 3, chip_id: 'chip3', name: '芯片3', description: '默认测试芯片3' }
            ];
        }
    } catch (error) {
        console.error('加载数据失败:', error);
        // 加载失败时使用默认数据
        mockUsers = [
            { username: 'admin', password: 'ctc@2026.', role: '管理员', email: 'admin@example.com' },
            { username: 'tester1', password: 'tester123', role: '测试人员', email: 'tester1@example.com' }
        ];
        historyRecords = [
            { time: '2026-01-13 10:00:00', user: 'admin', action: '添加', content: '添加了模块1', version: 'v1.0' },
            { time: '2026-01-13 10:30:00', user: 'tester1', action: '修改', content: '修改了测试点1', version: 'v1.1' }
        ];
        modules = [
            { id: 'module1', name: '模块1' },
            { id: 'module2', name: '模块2' },
            { id: 'module3', name: '模块3' }
        ];
    } finally {
        hideLoading();
    }
}

// 初始化WebSocket连接
function initWebSocket() {
    try {
        // 创建WebSocket连接 - 动态获取当前主机地址，支持跨平台部署
        const wsOrigin = window.location.origin;
        socket = io(wsOrigin);

        // 连接成功
        socket.on('connect', () => {
            console.log('WebSocket连接成功');
            // 如果用户已登录，发送登录事件
            if (currentUser && currentUser.username) {
                socket.emit('login', currentUser);
            }
        });

        // 连接失败
        socket.on('disconnect', () => {
            console.log('WebSocket连接断开');
        });

        // 监听用户登录
        socket.on('userConnected', (user) => {
            console.log(`${user.username} 登录了`);
            updateOnlineUsersDisplay();
        });

        // 监听用户登出
        socket.on('userDisconnected', (user) => {
            console.log(`${user.username} 登出了`);
            updateOnlineUsersDisplay();
        });

        // 监听在线用户更新
        socket.on('onlineUsers', (users) => {
            const uniqueUsersMap = new Map();
            users.forEach(user => {
                if (user && user.username) {
                    uniqueUsersMap.set(user.username, user);
                }
            });
            onlineUsers = Array.from(uniqueUsersMap.values());
            updateOnlineUsersDisplay();
        });

        // 监听测试点更新
        socket.on('testPointUpdated', (data) => {
            console.log('测试点更新:', data);
            // 这里可以添加更新测试点的逻辑
        });

        // 监听模块更新
        socket.on('moduleUpdated', (data) => {
            console.log('模块更新:', data);
            // 这里可以添加更新模块的逻辑
            // 重新加载模块数据，确保显示最新的模块列表
            initModuleData();
        });
    } catch (error) {
        console.error('WebSocket初始化失败:', error);
        // WebSocket连接失败不影响其他功能
    }
}

// 更新在线用户显示
function updateOnlineUsersDisplay() {
    // 这里可以添加更新在线用户显示的逻辑
    console.log('在线用户:', onlineUsers.map(user => user.username));
}

// 测试计划数据
let testPlans = [];

// 测试报告数据
let testReports = [];

// 用例数据
let testCases = [];

// 加载测试计划
async function loadTestPlans() {
    try {
        showLoading('加载测试计划中...');

        // 调用API获取测试计划
        const testPlansData = await apiRequest('/testplans/list', { useCache: false });

        if (testPlansData.success && testPlansData.testPlans) {
            testPlans = testPlansData.testPlans;
        } else {
            // 使用默认数据
            testPlans = [
                {
                    id: 1,
                    name: 'SDK功能测试计划',
                    owner: 'admin',
                    ownerName: '管理员',
                    status: '进行中',
                    passRate: 85,
                    testedCases: 120,
                    totalCases: 150,
                    resultDistribution: { pass: 102, fail: 18, pending: 30 },
                    testPhase: '集成测试',
                    project: 'M12',
                    projectName: 'M12项目',
                    iteration: 'v1.0',
                    createdAt: '2026-01-10',
                    updatedAt: '2026-01-13'
                },
                {
                    id: 2,
                    name: 'SDK性能测试计划',
                    owner: 'tester1',
                    ownerName: '测试人员1',
                    status: '未开始',
                    passRate: 0,
                    testedCases: 0,
                    totalCases: 80,
                    resultDistribution: { pass: 0, fail: 0, pending: 80 },
                    testPhase: '性能测试',
                    project: 'M4',
                    projectName: 'M4项目',
                    iteration: 'v1.0',
                    createdAt: '2026-01-09',
                    updatedAt: '2026-01-09'
                },
                {
                    id: 3,
                    name: 'SDK兼容性测试计划',
                    owner: 'admin',
                    ownerName: '管理员',
                    status: '已完成',
                    passRate: 95,
                    testedCases: 60,
                    totalCases: 60,
                    resultDistribution: { pass: 57, fail: 3, pending: 0 },
                    testPhase: '兼容性测试',
                    project: 'IPU',
                    projectName: 'IPU项目',
                    iteration: 'v1.0',
                    createdAt: '2026-01-05',
                    updatedAt: '2026-01-08'
                },
                {
                    id: 4,
                    name: 'SDK安全测试计划',
                    owner: 'tester2',
                    ownerName: '测试人员2',
                    status: '进行中',
                    passRate: 45,
                    testedCases: 20,
                    totalCases: 40,
                    resultDistribution: { pass: 9, fail: 11, pending: 20 },
                    testPhase: '安全测试',
                    project: 'NPU',
                    projectName: 'NPU项目',
                    iteration: 'v1.0',
                    createdAt: '2026-01-08',
                    updatedAt: '2026-01-12'
                }
            ];
        }

        // 加载过滤组件数据
        await loadTestPlanFilters();

        // 渲染测试计划表格
        renderTestPlansTable();
    } catch (error) {
        console.error('加载测试计划错误:', error);
        // 使用默认数据
        testPlans = [
            {
                id: 1,
                name: 'SDK功能测试计划',
                owner: 'admin',
                status: 'in_progress',
                passRate: 85,
                testedCases: 120,
                totalCases: 150,
                resultDistribution: { pass: 102, fail: 18, pending: 30 },
                testPhase: '集成测试',
                project: 'CTCSDK项目',
                iteration: 'v1.0',
                createdAt: '2026-01-10',
                updatedAt: '2026-01-13'
            },
            {
                id: 2,
                name: 'SDK性能测试计划',
                owner: 'tester1',
                status: 'not_started',
                passRate: 0,
                testedCases: 0,
                totalCases: 80,
                resultDistribution: { pass: 0, fail: 0, pending: 80 },
                testPhase: '性能测试',
                project: 'CTCSDK项目',
                iteration: 'v1.0',
                createdAt: '2026-01-09',
                updatedAt: '2026-01-09'
            },
            {
                id: 3,
                name: 'SDK兼容性测试计划',
                owner: 'admin',
                status: 'completed',
                passRate: 95,
                testedCases: 60,
                totalCases: 60,
                resultDistribution: { pass: 57, fail: 3, pending: 0 },
                testPhase: '兼容性测试',
                project: 'CTCSDK项目',
                iteration: 'v1.0',
                createdAt: '2026-01-05',
                updatedAt: '2026-01-08'
            },
            {
                id: 4,
                name: 'SDK安全测试计划',
                owner: 'admin',
                status: 'blocked',
                passRate: 45,
                testedCases: 20,
                totalCases: 40,
                resultDistribution: { pass: 9, fail: 11, pending: 20 },
                testPhase: '安全测试',
                project: 'CTCSDK项目',
                iteration: 'v1.0',
                createdAt: '2026-01-08',
                updatedAt: '2026-01-12'
            }
        ];
        renderTestPlansTable();
    } finally {
        hideLoading();
    }
}

// 加载测试计划过滤组件数据
async function loadTestPlanFilters() {
    try {
        // 加载项目列表
        const projectsResponse = await apiRequest('/projects/list');
        const projectSelect = document.getElementById('testplan-project-filter');
        if (projectSelect && projectsResponse.success && projectsResponse.projects) {
            projectSelect.innerHTML = '<option value="">全部项目</option>' +
                projectsResponse.projects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        }

        // 加载用户列表（负责人）
        const usersResponse = await apiRequest('/users/list');
        const ownerSelect = document.getElementById('testplan-owner-filter');
        if (ownerSelect && usersResponse.success && usersResponse.users) {
            const filteredUsers = filterOwners(usersResponse.users);
            ownerSelect.innerHTML = '<option value="">全部负责人</option>' +
                filteredUsers.map(u => `<option value="${u.username}">${u.username}</option>`).join('');
        }

        // 迭代列表（从测试计划中提取）
        const iterationSelect = document.getElementById('testplan-iteration-filter');
        if (iterationSelect && testPlans) {
            const iterations = [...new Set(testPlans.map(p => p.iteration).filter(Boolean))];
            iterationSelect.innerHTML = '<option value="">全部迭代</option>' +
                iterations.map(i => `<option value="${i}">${i}</option>`).join('');
        }

    } catch (error) {
        console.error('加载过滤组件数据错误:', error);
    }
}

// 防抖函数
// 应用测试计划过滤
function applyTestPlanFilters() {
    const statusFilter = document.getElementById('testplan-status-filter');
    const projectFilter = document.getElementById('testplan-project-filter');
    const iterationFilter = document.getElementById('testplan-iteration-filter');
    const ownerFilter = document.getElementById('testplan-owner-filter');
    const searchInput = document.getElementById('testplan-search-input');
    const sortSelect = document.getElementById('testplan-sort-select');

    const status = statusFilter ? statusFilter.value : '';
    const project = projectFilter ? projectFilter.value : '';
    const iteration = iterationFilter ? iterationFilter.value : '';
    const owner = ownerFilter ? ownerFilter.value : '';
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const sortBy = sortSelect ? sortSelect.value : 'default';

    // 状态映射（中文 -> 英文）
    const statusMap = {
        '未开始': ['not_started', 'draft', 'pending'],
        '进行中': ['in_progress', 'running', 'delayed'],  // delayed（延期执行中）也算进行中
        '已完成': ['completed', 'finished']
    };

    let filteredPlans = testPlans.filter(plan => {
        // 计算实际状态（用于筛选）
        const actualStatus = calculatePlanStatus(plan);
        
        // 状态筛选（使用计算后的实际状态）
        if (status) {
            const statusValues = statusMap[status] || [status];
            if (!statusValues.includes(actualStatus)) return false;
        }
        // 项目筛选
        if (project && plan.project !== project) return false;
        // 迭代筛选
        if (iteration && plan.iteration !== iteration) return false;
        // 负责人筛选
        if (owner && plan.owner !== owner) return false;
        // 搜索筛选
        if (search && !plan.name.toLowerCase().includes(search)) return false;
        return true;
    });
    
    // 排序
    if (sortBy === 'created_at') {
        filteredPlans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortBy === 'name') {
        filteredPlans.sort((a, b) => a.name.localeCompare(b.name));
    }

    renderTestPlansTable(filteredPlans);
}

// 渲染测试计划表格
function renderTestPlansTable(filteredPlans = null) {
    const tableBody = document.getElementById('testplan-table-body');
    const plansToRender = filteredPlans || testPlans;

    if (plansToRender.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="no-data">暂无测试计划</td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = plansToRender.map(plan => {
        // 计算测试进度百分比
        const progressPercent = plan.totalCases > 0
            ? Math.round((plan.testedCases / plan.totalCases) * 100)
            : 0;

        // 计算实际状态（考虑延期）
        const actualStatus = calculatePlanStatus(plan);

        // 获取状态标签样式
        const statusTagClass = getStatusTagClass(actualStatus);

        // 判断执行按钮显示执行还是暂停
        const isRunning = actualStatus === 'running' || actualStatus === 'delayed';
        const executeBtnHtml = isRunning
            ? `<button class="action-btn pause-btn" onclick="pauseTestPlan(${plan.id})" title="暂停">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="6" y="4" width="4" height="16"></rect>
                    <rect x="14" y="4" width="4" height="16"></rect>
                </svg>
            </button>`
            : `<button class="action-btn execute-btn" onclick="executeTestPlan(${plan.id})" title="执行">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
            </button>`;

        return `
            <tr data-plan-id="${plan.id}">
                <td><a href="#" class="plan-name" onclick="viewTestPlanDetail(${plan.id}); return false;">${plan.name}</a></td>
                <td>${plan.ownerName || plan.owner}</td>
                <td><span class="status-tag ${statusTagClass}">${getStatusText(actualStatus)}</span></td>
                <td>
                    ${renderProgressBar(plan.passRate, 'pass-rate')}
                </td>
                <td>
                    ${renderProgressBar(progressPercent, 'progress')}
                </td>
                <td>${plan.projectName || plan.project || '-'}</td>
                <td>${plan.iteration || '-'}</td>
                <td class="actions-cell">
                    ${executeBtnHtml}
                    <button class="action-btn report-btn" onclick="generateReportFromTestPlan(${plan.id})" title="生成报告">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                    </button>
                    <button class="action-btn edit-btn" onclick="editTestPlan(${plan.id})" title="编辑">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn detail-btn" onclick="viewTestPlanDetail(${plan.id})" title="详情">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                    </button>
                    <button class="action-btn delete-btn" onclick="deleteTestPlan(${plan.id})" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 获取状态标签样式类
function getStatusTagClass(status) {
    const statusMap = {
        'not_started': 'status-tag-not-started',
        'pending': 'status-tag-not-started',
        'draft': 'status-tag-not-started',
        '未开始': 'status-tag-not-started',
        'running': 'status-tag-running',
        'in_progress': 'status-tag-running',
        '执行中': 'status-tag-running',
        '进行中': 'status-tag-running',
        'delayed': 'status-tag-delayed',
        '延期执行中': 'status-tag-delayed',
        'completed': 'status-tag-completed',
        '已完成': 'status-tag-completed',
        '完成': 'status-tag-completed',
        'paused': 'status-tag-paused',
        '已暂停': 'status-tag-paused',
        'blocked': 'status-tag-error'
    };
    return statusMap[status] || 'status-tag-default';
}

// 计算测试计划的实际状态（考虑延期）
function calculatePlanStatus(plan) {
    const now = new Date();
    const endDate = plan.end_date ? new Date(plan.end_date) : null;
    const progressPercent = plan.totalCases > 0 ? Math.round((plan.testedCases / plan.totalCases) * 100) : 0;

    // 如果已完成（进度100%或通过率100%）
    if (progressPercent >= 100 || plan.passRate >= 100) {
        return 'completed';
    }

    // 如果状态是暂停
    if (plan.status === 'paused') {
        return 'paused';
    }

    // 如果状态是执行中或运行中
    if (plan.status === 'running' || plan.status === 'in_progress') {
        // 检查是否延期：当前时间超过结束时间且进度未100%
        if (endDate && now > endDate && progressPercent < 100) {
            return 'delayed';
        }
        return 'running';
    }

    // 默认返回原状态
    return plan.status || 'not_started';
}

// 执行测试计划
async function executeTestPlan(planId) {
    try {
        showLoading('加载测试计划...');

        // 获取测试计划详情
        const response = await apiRequest(`/testplans/${planId}`);

        hideLoading();

        if (response.success && response.plan) {
            const plan = response.plan;

            // 显示执行确认弹框
            showConfirmModal(`确定要执行测试计划「${plan.name}」吗？\n\n包含 ${plan.total_cases || 0} 条测试用例`, async (confirmed) => {
                if (confirmed) {
                    try {
                        showLoading('启动执行...');

                        // 更新状态为运行中
                        const updateResponse = await apiRequest(`/testplans/${planId}/status`, {
                            method: 'POST',
                            body: JSON.stringify({ status: 'running' })
                        });

                        hideLoading();

                        if (updateResponse.success) {
                            showSuccessMessage('测试计划已开始执行');
                            await loadTestPlans();
                        } else {
                            showErrorMessage('启动失败: ' + (updateResponse.message || '未知错误'));
                        }
                    } catch (error) {
                        hideLoading();
                        showErrorMessage('启动失败: ' + error.message);
                    }
                }
            });
        } else {
            showErrorMessage('获取测试计划失败');
        }
    } catch (error) {
        hideLoading();
        showErrorMessage('加载失败: ' + error.message);
    }
}

// 暂停测试计划
async function pauseTestPlan(planId) {
    try {
        showLoading('暂停测试计划...');

        // 更新状态为暂停
        const updateResponse = await apiRequest(`/testplans/${planId}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: 'paused' })
        });

        hideLoading();

        if (updateResponse.success) {
            showSuccessMessage('测试计划已暂停');
            await loadTestPlans();
        } else {
            showErrorMessage('暂停失败: ' + (updateResponse.message || '未知错误'));
        }
    } catch (error) {
        hideLoading();
        showErrorMessage('暂停失败: ' + error.message);
    }
}

// 编辑测试计划
async function editTestPlan(planId) {
    try {
        showLoading('加载测试计划...');

        // 获取测试计划详情
        const response = await apiRequest(`/testplans/detail/${planId}`);

        hideLoading();

        if (response.success && response.plan) {
            const plan = response.plan;

            if (plan.cases && plan.cases.length > 0) {
                window.selectedCases = new Set(plan.cases.map(c => {
                    const id = c.case_id || c.id;
                    const numId = typeof id === 'string' ? parseInt(id) : id;
                    return numId;
                }));

                window.selectedCasesHierarchy = {
                    libraries: new Set(),
                    modules: new Set(),
                    level1Points: new Set()
                };

                plan.cases.forEach(c => {
                    if (c.library_id) window.selectedCasesHierarchy.libraries.add(c.library_id);
                    if (c.module_id) window.selectedCasesHierarchy.modules.add(c.module_id);
                    if (c.level1_id) window.selectedCasesHierarchy.level1Points.add(c.level1_id);
                });

                window.parentSelectedCounts = computeParentSelectedCounts(plan.cases);

                console.log('编辑模式: 已加载用例ID数量:', window.selectedCases.size);
                console.log('编辑模式: 父节点选中计数:', window.parentSelectedCounts);
            } else {
                window.selectedCases = new Set();
                window.selectedCasesHierarchy = {
                    libraries: new Set(),
                    modules: new Set(),
                    level1Points: new Set()
                };
                window.parentSelectedCounts = {
                    libraries: {},
                    modules: {},
                    level1Points: {}
                };
            }

            // 存储当前编辑的计划ID
            window.currentEditingPlanId = planId;

            // 打开高级测试计划模态框（会初始化资产树）
            await openAdvancedTestPlanModal();

            // 编辑模式：自动展开已选中用例的父节点路径
            if (window.selectedCases.size > 0) {
                await autoExpandSelectedPaths();
            }

            // 填充表单数据
            document.getElementById('testplan-name').value = plan.name || '';
            document.getElementById('testplan-iteration').value = plan.iteration || '';
            // 日期需要转换为 YYYY-MM-DD 格式
            document.getElementById('testplan-start-date').value = plan.startDate || plan.start_date ? formatDateForInput(plan.startDate || plan.start_date) : '';
            document.getElementById('testplan-end-date').value = plan.endDate || plan.end_date ? formatDateForInput(plan.endDate || plan.end_date) : '';
            document.getElementById('testplan-description').value = plan.description || '';

            // 设置实际完成时间（datetime-local 格式：YYYY-MM-DDTHH:MM）
            if (plan.actual_end_time) {
                document.getElementById('testplan-actual-end-time').value = formatDateTimeForInput(plan.actual_end_time);
            } else {
                document.getElementById('testplan-actual-end-time').value = '';
            }

            // 设置负责人
            if (plan.owner) {
                const ownerSelect = document.getElementById('testplan-owner');
                if (ownerSelect) {
                    ownerSelect.value = plan.owner;
                }
            }

            // 设置项目
            if (plan.project) {
                const projectSelect = document.getElementById('testplan-project');
                if (projectSelect) {
                    projectSelect.value = plan.project;
                }
            }

            // 设置测试阶段
            if (plan.stage_id) {
                const stageSelect = document.getElementById('testplan-stage');
                if (stageSelect) {
                    stageSelect.value = plan.stage_id;
                }
            }

            // 设置测试软件
            if (plan.software_id) {
                const softwareSelect = document.getElementById('testplan-software');
                if (softwareSelect) {
                    softwareSelect.value = plan.software_id;
                }
            }

            // 更新模态框标题
            const modalHeader = document.querySelector('#advanced-testplan-modal .modal-header h3');
            if (modalHeader) {
                modalHeader.textContent = '📝 编辑测试计划';
            }

            // 显示实际完成时间字段（编辑模式）
            const actualEndTimeGroup = document.getElementById('testplan-actual-end-time-group');
            if (actualEndTimeGroup) {
                actualEndTimeGroup.style.display = 'block';
            }

            // 更新用例数量显示
            updateCaseCount();

            showSuccessMessage('测试计划数据已加载，可进行编辑');
        } else {
            showErrorMessage('获取测试计划失败');
        }
    } catch (error) {
        hideLoading();
        showErrorMessage('加载失败: ' + error.message);
    }
}

// 生成饼图SVG
function generatePieChart(statistics, colors) {
    const total = Object.values(statistics).reduce((a, b) => a + b, 0);
    if (total === 0) {
        return `
            <svg width="150" height="150" viewBox="0 0 150 150">
                <circle cx="75" cy="75" r="60" fill="#f3f4f6" stroke="#e5e7eb" stroke-width="1"/>
                <text x="75" y="75" text-anchor="middle" dominant-baseline="middle" fill="#9ca3af" font-size="14">暂无数据</text>
            </svg>
        `;
    }

    const defaultColors = ['#52c41a', '#1890ff', '#faad14', '#ff4d4f', '#722ed1', '#13c2c2', '#eb2f96', '#909399'];
    let startAngle = -90;
    let paths = '';
    let colorIndex = 0;

    Object.entries(statistics).forEach(([name, count]) => {
        if (count === 0) return;

        const percentage = (count / total) * 100;
        const angle = (count / total) * 360;
        const endAngle = startAngle + angle;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = 75 + 60 * Math.cos(startRad);
        const y1 = 75 + 60 * Math.sin(startRad);
        const x2 = 75 + 60 * Math.cos(endRad);
        const y2 = 75 + 60 * Math.sin(endRad);

        const largeArc = angle > 180 ? 1 : 0;
        const color = colors[name] || defaultColors[colorIndex % defaultColors.length];

        if (angle >= 360) {
            paths += `<circle cx="75" cy="75" r="60" fill="${color}"/>`;
        } else {
            paths += `<path d="M 75 75 L ${x1} ${y1} A 60 60 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}"/>`;
        }

        startAngle = endAngle;
        colorIndex++;
    });

    return `
        <svg width="150" height="150" viewBox="0 0 150 150">
            ${paths}
            <circle cx="75" cy="75" r="35" fill="white"/>
            <text x="75" y="70" text-anchor="middle" dominant-baseline="middle" fill="#1f2937" font-size="18" font-weight="bold">${total}</text>
            <text x="75" y="88" text-anchor="middle" dominant-baseline="middle" fill="#6b7280" font-size="10">总计</text>
        </svg>
    `;
}

// 查看测试计划详情
async function viewTestPlanDetail(planId) {
    try {
        showLoading('加载测试计划详情...');

        const response = await apiRequest(`/testplans/${planId}`);

        hideLoading();

        if (response.success && response.plan) {
            const plan = response.plan;

            // 计算计划工期
            const plannedDuration = calculateDuration(plan.start_date, plan.end_date);

            // 计算实际工期
            const actualDuration = calculateDuration(plan.actual_start_time, plan.actual_end_time);

            const modalHtml = `
                <div id="testplan-detail-modal" class="modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); z-index: 10000; justify-content: center; align-items: center;">
                    <div class="modal-content" style="background: white; border-radius: 16px; width: 900px; max-width: 95%; max-height: 85vh; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
                        <div class="modal-header" style="padding: 20px 24px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #1f2937;">📋 测试计划详情</h3>
                            <button class="close-btn" onclick="closeTestPlanDetailModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #6b7280;">&times;</button>
                        </div>
                        <div class="modal-body" style="padding: 24px; overflow-y: auto; max-height: calc(85vh - 80px);">
                            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
                                <div>
                                    <label style="font-size: 12px; color: #6b7280; font-weight: 600;">计划名称</label>
                                    <div style="font-size: 16px; color: #1f2937; margin-top: 4px;">${plan.name || '-'}</div>
                                </div>
                                <div>
                                    <label style="font-size: 12px; color: #6b7280; font-weight: 600;">负责人</label>
                                    <div style="font-size: 16px; color: #1f2937; margin-top: 4px;">${plan.owner || '-'}</div>
                                </div>
                                <div>
                                    <label style="font-size: 12px; color: #6b7280; font-weight: 600;">状态</label>
                                    <div style="margin-top: 4px;"><span class="status-tag ${getStatusTagClass(plan.status)}">${getStatusText(plan.status)}</span></div>
                                </div>
                                <div>
                                    <label style="font-size: 12px; color: #6b7280; font-weight: 600;">关联项目</label>
                                    <div style="font-size: 16px; color: #1f2937; margin-top: 4px;">${plan.project_name || plan.project || '-'}</div>
                                </div>
                                <div>
                                    <label style="font-size: 12px; color: #6b7280; font-weight: 600;">迭代版本</label>
                                    <div style="font-size: 16px; color: #1f2937; margin-top: 4px;">${plan.iteration || '-'}</div>
                                </div>
                                <div>
                                    <label style="font-size: 12px; color: #6b7280; font-weight: 600;">创建时间</label>
                                    <div style="font-size: 16px; color: #1f2937; margin-top: 4px;">${formatDateTime(plan.created_at)}</div>
                                </div>
                            </div>
                            
                            <!-- 工期信息 -->
                            <div style="margin-top: 24px; padding: 20px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; border: 1px solid #e2e8f0;">
                                <h4 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #374151;">📅 工期信息</h4>
                                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
                                    <!-- 计划工期 -->
                                    <div style="padding: 16px; background: white; border-radius: 10px; border: 1px solid #e5e7eb;">
                                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                                            <span style="font-size: 16px;">📋</span>
                                            <span style="font-size: 13px; font-weight: 600; color: #6b7280;">计划工期</span>
                                        </div>
                                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
                                            ${formatDate(plan.start_date)} → ${formatDate(plan.end_date)}
                                        </div>
                                        <div style="font-size: 14px; font-weight: 600; color: #1f2937;">
                                            ${plannedDuration.text}
                                        </div>
                                    </div>
                                    
                                    <!-- 实际工期 -->
                                    <div style="padding: 16px; background: white; border-radius: 10px; border: 1px solid #e5e7eb;">
                                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                                            <span style="font-size: 16px;">⏱️</span>
                                            <span style="font-size: 13px; font-weight: 600; color: #6b7280;">实际工期</span>
                                        </div>
                                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
                                            ${formatDateTime(plan.actual_start_time) || '未开始'} → ${formatDateTime(plan.actual_end_time) || '未完成'}
                                        </div>
                                        <div style="font-size: 14px; font-weight: 600; color: #1f2937;">
                                            ${actualDuration.text}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div style="margin-top: 20px;">
                                <label style="font-size: 12px; color: #6b7280; font-weight: 600;">计划描述</label>
                                <div style="font-size: 14px; color: #374151; margin-top: 4px; padding: 12px; background: #f9fafb; border-radius: 8px;">${plan.description || '暂无描述'}</div>
                            </div>
                            
                            <div style="margin-top: 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                                <div style="padding: 16px; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 12px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: 700; color: #059669;">${plan.total_cases || 0}</div>
                                    <div style="font-size: 12px; color: #047857; margin-top: 4px;">总用例数</div>
                                </div>
                                <div style="padding: 16px; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 12px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: 700; color: #2563eb;">${plan.tested_cases || 0}</div>
                                    <div style="font-size: 12px; color: #1d4ed8; margin-top: 4px;">已执行</div>
                                </div>
                                <div style="padding: 16px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: 700; color: #d97706;">${plan.pass_rate || 0}%</div>
                                    <div style="font-size: 12px; color: #b45309; margin-top: 4px;">通过率</div>
                                </div>
                            </div>
                            
                            <!-- 测试结果统计 -->
                            <div style="margin-top: 24px; padding: 20px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; border: 1px solid #e2e8f0;">
                                <h4 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #374151;">📊 测试结果统计</h4>
                                <div style="display: flex; align-items: center; gap: 24px;">
                                    <!-- 饼图 -->
                                    <div style="flex-shrink: 0;">
                                        ${generatePieChart(plan.status_statistics || {}, plan.status_colors || {})}
                                    </div>
                                    <!-- 图例 -->
                                    <div style="flex: 1; display: flex; flex-wrap: wrap; gap: 12px;">
                                        ${Object.entries(plan.status_statistics || {}).map(([statusName, count]) => {
                const color = plan.status_colors?.[statusName] || '#909399';
                const total = Object.values(plan.status_statistics || {}).reduce((a, b) => a + b, 0);
                const percent = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
                return `
                                                <div style="padding: 12px 16px; background: white; border-radius: 8px; border: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px; min-width: 120px;">
                                                    <div style="width: 12px; height: 12px; border-radius: 50%; background: ${color};"></div>
                                                    <div>
                                                        <div style="font-size: 16px; font-weight: 700; color: #1f2937;">${count} <span style="font-size: 12px; color: #6b7280; font-weight: normal;">(${percent}%)</span></div>
                                                        <div style="font-size: 12px; color: #6b7280;">${statusName}</div>
                                                    </div>
                                                </div>
                                            `;
            }).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                            <button class="secondary-btn" onclick="closeTestPlanDetailModal()">关闭</button>
                            <button class="primary-btn" onclick="editTestPlan(${planId}); closeTestPlanDetailModal();">编辑</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', modalHtml);
        } else {
            showErrorMessage('获取测试计划失败');
        }
    } catch (error) {
        hideLoading();
        showErrorMessage('加载失败: ' + error.message);
    }
}

// 关闭测试计划详情弹框
function closeTestPlanDetailModal() {
    const modal = document.getElementById('testplan-detail-modal');
    if (modal) {
        modal.remove();
    }
}

// 格式化日期时间
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
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

// 格式化日期（不带时间）
function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
    } catch (e) {
        return dateStr;
    }
}

// 格式化日期为 HTML input[type="date"] 所需的格式 (YYYY-MM-DD)
function formatDateForInput(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        return '';
    }
}

// 格式化日期时间为 HTML input[type="datetime-local"] 所需的格式 (YYYY-MM-DDTHH:MM)
function formatDateTimeForInput(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch (e) {
        return '';
    }
}

// 计算工期（工作日和周末天数）
function calculateDuration(startDate, endDate) {
    if (!startDate || !endDate) {
        return { workdays: 0, weekends: 0, total: 0, text: '-' };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { workdays: 0, weekends: 0, total: 0, text: '-' };
    }

    let workdays = 0;
    let weekends = 0;

    const current = new Date(start);
    while (current <= end) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            weekends++;
        } else {
            workdays++;
        }
        current.setDate(current.getDate() + 1);
    }

    const total = workdays + weekends;
    const text = `工作日 ${workdays} 天，周末 ${weekends} 天`;

    return { workdays, weekends, total, text };
}

// 计算工期天数（不包括当天）
function calculateDurationDays(startDate, endDate) {
    if (!startDate || !endDate) {
        return { workdays: 0, weekends: 0, total: 0, text: '-' };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { workdays: 0, weekends: 0, total: 0, text: '-' };
    }

    let workdays = 0;
    let weekends = 0;

    // 从开始日期的下一天开始计算
    const current = new Date(start);
    current.setDate(current.getDate() + 1);

    while (current <= end) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            weekends++;
        } else {
            workdays++;
        }
        current.setDate(current.getDate() + 1);
    }

    const total = workdays + weekends;
    const text = total > 0 ? `工作日 ${workdays} 天，周末 ${weekends} 天` : '-';

    return { workdays, weekends, total, text };
}

// 删除测试计划
async function deleteTestPlan(planId) {
    // 检查权限：只有管理员可以删除
    if (!currentUser || currentUser.role !== '管理员') {
        showErrorMessage('只有管理员可以删除测试计划');
        return;
    }

    // 获取测试计划信息
    const plan = testPlans.find(p => p.id === planId);
    if (!plan) {
        showErrorMessage('测试计划不存在');
        return;
    }

    // 使用确认弹框
    showConfirmModal(`确定要删除测试计划「${plan.name}」吗？此操作不可恢复。`, async (confirmed) => {
        if (confirmed) {
            try {
                showLoading('删除中...');
                const response = await apiRequest(`/testplans/delete/${planId}`, {
                    method: 'DELETE'
                });

                hideLoading();

                if (response.success) {
                    showSuccessMessage('测试计划删除成功');
                    await loadTestPlans();
                } else {
                    showErrorMessage(response.message || '删除失败');
                }
            } catch (error) {
                hideLoading();
                console.error('删除测试计划错误:', error);
                showErrorMessage('删除失败: ' + error.message);
            }
        }
    });
}

// 渲染测试用例表格
function renderTestCasesTable() {
    const tableBody = document.getElementById('testplan-cases-body');
    
    if (!tableBody) {
        console.log('[renderTestCasesTable] 当前页面不包含表格元素，跳过渲染');
        return;
    }

    // 使用模拟数据
    const testCasesData = [
        {
            id: 1,
            name: 'SDK初始化测试',
            maintainer: 'admin',
            priority: 'high',
            type: '功能测试',
            executor: 'tester1',
            result: 'pass',
            lastExecuted: '2026-01-13 10:00:00'
        },
        {
            id: 2,
            name: 'SDK配置测试',
            maintainer: 'admin',
            priority: 'medium',
            type: '功能测试',
            executor: 'tester1',
            result: 'pass',
            lastExecuted: '2026-01-13 10:30:00'
        },
        {
            id: 3,
            name: 'SDK性能测试',
            maintainer: 'admin',
            priority: 'high',
            type: '性能测试',
            executor: 'tester1',
            result: 'pending',
            lastExecuted: ''
        },
        {
            id: 4,
            name: 'SDK兼容性测试',
            maintainer: 'admin',
            priority: 'medium',
            type: '兼容性测试',
            executor: 'tester1',
            result: 'fail',
            lastExecuted: '2026-01-13 11:00:00'
        }
    ];

    if (testCasesData.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="no-data">暂无测试用例</td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = testCasesData.map(testCase => `
        <tr>
            <td>${testCase.id}</td>
            <td>${testCase.name}</td>
            <td>${testCase.maintainer}</td>
            <td><span class="priority-badge ${testCase.priority}">${getPriorityText(testCase.priority)}</span></td>
            <td>${testCase.type}</td>
            <td>${testCase.executor}</td>
            <td><span class="status-badge ${testCase.result}">${getStatusText(testCase.result)}</span></td>
            <td>${testCase.lastExecuted || '未执行'}</td>
        </tr>
    `).join('');
}

// 加载用例
async function loadTestCases() {
    try {
        showLoading('加载用例中...');

        // 调用API获取用例 - 使用POST请求并传递必要参数
        const testCasesData = await apiRequest('/cases/list', {
            method: 'POST',
            body: JSON.stringify({
                page: 1,
                pageSize: 32
            })
        });

        if (testCasesData.success && testCasesData.testCases) {
            testCases = testCasesData.testCases;
        } else {
            // 使用默认数据，确保包含remark字段
            testCases = [
                {
                    id: 1,
                    caseId: 'CASE-001',
                    name: 'SDK初始化测试',
                    testSuite: '功能测试用例',
                    priority: 'high',
                    status: 'active',
                    creator: 'admin',
                    createdAt: '2026-01-01',
                    updatedAt: '2026-01-10',
                    remark: '这是一个测试备注'
                },
                {
                    id: 2,
                    caseId: 'CASE-002',
                    name: 'SDK配置测试',
                    testSuite: '功能测试用例',
                    priority: 'medium',
                    status: 'active',
                    creator: 'tester1',
                    createdAt: '2026-01-02',
                    updatedAt: '2026-01-11',
                    remark: ''
                },
                {
                    id: 3,
                    caseId: 'CASE-003',
                    name: 'SDK性能测试',
                    testSuite: '性能测试用例',
                    priority: 'high',
                    status: 'active',
                    creator: 'admin',
                    createdAt: '2026-01-03',
                    updatedAt: '2026-01-08',
                    remark: '性能测试备注'
                },
                {
                    id: 4,
                    caseId: 'CASE-004',
                    name: '旧版SDK兼容性测试',
                    testSuite: '兼容性测试用例',
                    priority: 'low',
                    status: 'deprecated',
                    creator: 'tester1',
                    createdAt: '2026-01-04',
                    updatedAt: '2026-01-06',
                    remark: '兼容性测试备注'
                }
            ];
        }

        // 渲染用例表格
        if (document.getElementById('cases-table-body')) {
            renderCasesTable();
        } else {
            console.log('cases-table-body not found, skipping render');
        }
    } catch (error) {
        console.error('加载用例错误:', error);
        // 使用默认数据，确保包含remark字段
        testCases = [
            {
                id: 1,
                caseId: 'CASE-001',
                name: 'SDK初始化测试',
                testSuite: '功能测试用例',
                priority: 'high',
                status: 'active',
                creator: 'admin',
                createdAt: '2026-01-01',
                updatedAt: '2026-01-10',
                remark: '这是一个测试备注'
            },
            {
                id: 2,
                caseId: 'CASE-002',
                name: 'SDK配置测试',
                testSuite: '功能测试用例',
                priority: 'medium',
                status: 'active',
                creator: 'tester1',
                createdAt: '2026-01-02',
                updatedAt: '2026-01-11',
                remark: ''
            },
            {
                id: 3,
                caseId: 'CASE-003',
                name: 'SDK性能测试',
                testSuite: '性能测试用例',
                priority: 'high',
                status: 'active',
                creator: 'admin',
                createdAt: '2026-01-03',
                updatedAt: '2026-01-08',
                remark: '性能测试备注'
            },
            {
                id: 4,
                caseId: 'CASE-004',
                name: '旧版SDK兼容性测试',
                testSuite: '兼容性测试用例',
                priority: 'low',
                status: 'deprecated',
                creator: 'tester1',
                createdAt: '2026-01-04',
                updatedAt: '2026-01-06',
                remark: '兼容性测试备注'
            }
        ];
        renderCasesTable();
    } finally {
        hideLoading();
    }
}

// 渲染用例表格
function renderCasesTable(filteredCases = null) {
    const tableBody = document.getElementById('cases-table-body');
    if (!tableBody) {
        console.log('cases-table-body not found, skipping render');
        return;
    }

    const casesToRender = filteredCases || testCases;

    if (casesToRender.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="no-data">暂无用例</td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = casesToRender.map(testCase => `
        <tr>
            <td>${testCase.name}</td>
            <td>${testCase.creator}</td>
            <td>${testCase.createdAt}</td>
            <td>${testCase.updatedAt}</td>
            <td>
                <button class="case-action-btn edit">编辑</button>
                <button class="case-action-btn delete">删除</button>
                <button class="case-action-btn execute">执行</button>
            </td>
        </tr>
    `).join('');
}

// 加载测试报告
async function loadTestReports() {
    try {
        showLoading('加载测试报告中...');

        // 调用API获取测试报告
        const testReportsData = await apiRequest('/reports/list');

        if (testReportsData.success && testReportsData.reports) {
            testReports = testReportsData.reports;
        } else {
            testReports = [];
        }

        // 渲染新的报告Dashboard
        loadReportsData();
        updateReportsStats(testReports);

    } catch (error) {
        console.error('加载测试报告失败:', error);
        testReports = [];
        loadReportsData();
    } finally {
        hideLoading();
    }
}

// 渲染项目列表
function renderProjectsList() {
    const tableBody = document.getElementById('projects-table-body');
    const reportsPanel = document.getElementById('reports-panel');

    if (!tableBody) {
        console.log('projects-table-body元素不存在，跳过渲染');
        return;
    }

    if (reportsPanel) {
        reportsPanel.style.display = 'none';
    }

    if (projects && projects.length > 0) {
        tableBody.innerHTML = projects.map(project => `
            <tr onclick="selectProject('${project.name}')">
                <td>${project.name}</td>
                <td>${currentUser ? currentUser.username : 'admin'}</td>
                <td>${formatDateTime(project.createdAt || project.created_at || '')}</td>
            </tr>
        `).join('');
    } else {
        tableBody.innerHTML = `
            <tr>
                <td colspan="3" class="no-data">暂无项目</td>
            </tr>
        `;
    }
}
// 选择项目并显示相关报告
function selectProject(projectName) {
    console.log('selectProject called with:', projectName);
    // 更新选中项目名称
    const selectedProjectNameElement = document.getElementById('selected-project-name');
    if (selectedProjectNameElement) {
        selectedProjectNameElement.textContent = `${projectName} - 测试报告`;
    }

    // 筛选该项目的报告
    const projectReports = testReports.filter(report => report.project === projectName);
    console.log('Project reports found:', projectReports.length);

    // 显示右侧面板
    const reportsPanel = document.getElementById('reports-panel');
    if (reportsPanel) {
        reportsPanel.style.display = 'block';
        console.log('Reports panel displayed');
    }

    // 渲染报告表格（带分页）
    console.log('Calling renderProjectReports');
    renderProjectReports(projectReports, 1, 50);
}
// 渲染项目报告表格（支持分页）
function renderProjectReports(reports, page = 1, pageSize = 50) {
    console.log('renderProjectReports called with:', reports.length, 'reports');
    const tableBody = document.getElementById('project-reports-body');
    const reportsPanel = document.getElementById('reports-panel');

    if (!reports || reports.length === 0) {
        if (reportsPanel) {
            reportsPanel.style.display = 'block';
        }
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="3" class="no-data">暂无测试报告</td>
                </tr>
            `;
        }
        // 隐藏分页控件
        const paginationElement = document.getElementById('reports-pagination');
        if (paginationElement) {
            paginationElement.style.display = 'none';
        }
        return;
    }

    // 计算分页信息
    const totalItems = reports.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedReports = reports.slice(startIndex, endIndex);

    // 显示右侧面板
    if (reportsPanel) {
        reportsPanel.style.display = 'block';
    }

    // 渲染报告表格
    if (tableBody) {
        tableBody.innerHTML = paginatedReports.map(report => `
            <tr>
                <td><span class="report-name-link" onclick="viewReportDetail(${report.id})">${report.name}</span></td>
                <td>${report.creator}</td>
                <td>${formatDateTime(report.createdAt)}</td>
            </tr>
        `).join('');
    }

    // 渲染分页控件
    console.log('Calling renderPagination');
    renderPagination('reports-pagination', page, totalPages, (newPage) => {
        renderProjectReports(reports, newPage, pageSize);
    });
}

// 按项目分组渲染测试报告（保留以兼容其他调用）
function renderTestReportsByProject(filteredReports = null) {
    // 调用新的渲染方法
    renderProjectsList();
}

// 渲染测试报告表格（保留旧方法以兼容其他调用）
function renderTestReportsTable(filteredReports = null) {
    // 调用新的渲染方法
    renderProjectsList();
}

// 获取状态文本
function getStatusText(status) {
    const statusMap = {
        not_started: '未开始',
        pending: '未开始',
        draft: '未开始',
        running: '执行中',
        in_progress: '执行中',
        delayed: '延期执行中',
        completed: '完成',
        paused: '已暂停',
        blocked: '阻塞',
        pass: '通过',
        fail: '失败',
        active: '活跃',
        deprecated: '已废弃'
    };
    return statusMap[status] || status;
}

// 渲染分页控件
function renderPagination(containerId, currentPage, totalPages, pageChangeCallback, totalItems = 0) {
    console.log('renderPagination called with:', containerId, currentPage, totalPages, totalItems);
    const container = document.getElementById(containerId);
    if (!container) {
        console.log('Container not found, creating one');
        const parent = document.getElementById('project-reports-table');
        if (parent) {
            console.log('Parent found:', parent.id);
            const paginationDiv = document.createElement('div');
            paginationDiv.id = containerId;
            paginationDiv.className = 'pagination-container';
            parent.parentNode.insertBefore(paginationDiv, parent.nextSibling);
            console.log('Pagination container created');
        } else {
            console.error('Parent element not found for pagination');
        }
        return;
    }

    if (totalPages <= 1) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.className = 'pagination-container';
    container.innerHTML = '';

    // 左侧数据统计
    const statsSpan = document.createElement('span');
    statsSpan.className = 'pagination-stats';
    if (totalItems > 0) {
        statsSpan.innerHTML = `共 <strong>${totalItems.toLocaleString()}</strong> 条数据`;
    } else {
        statsSpan.innerHTML = `第 <strong>${currentPage}</strong> / <strong>${totalPages}</strong> 页`;
    }
    container.appendChild(statsSpan);

    // 分页按钮组
    const btnGroup = document.createElement('div');
    btnGroup.className = 'pagination-btn-group';

    // 首页按钮
    const firstBtn = document.createElement('button');
    firstBtn.className = 'pagination-btn pagination-btn-nav';
    firstBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>`;
    firstBtn.disabled = currentPage === 1;
    firstBtn.title = '首页';
    firstBtn.onclick = () => pageChangeCallback(1);
    btnGroup.appendChild(firstBtn);

    // 上一页按钮
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination-btn pagination-btn-nav';
    prevBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
    prevBtn.disabled = currentPage === 1;
    prevBtn.title = '上一页';
    prevBtn.onclick = () => {
        if (currentPage > 1) pageChangeCallback(currentPage - 1);
    };
    btnGroup.appendChild(prevBtn);

    // 智能页码生成函数 - 最多显示5个连续页码
    const generatePageNumbers = (current, total) => {
        const pages = [];

        if (total <= 7) {
            // 总页数<=7，全部显示
            for (let i = 1; i <= total; i++) {
                pages.push(i);
            }
        } else {
            // 总页数>7，智能折叠显示
            pages.push(1); // 始终显示第1页

            // 计算中间显示范围
            let rangeStart = Math.max(2, current - 2);
            let rangeEnd = Math.min(total - 1, current + 2);

            // 调整范围确保至少显示3个页码
            if (rangeEnd - rangeStart < 2) {
                if (rangeStart === 2) {
                    rangeEnd = Math.min(total - 1, rangeStart + 2);
                } else if (rangeEnd === total - 1) {
                    rangeStart = Math.max(2, rangeEnd - 2);
                }
            }

            // 左侧省略号
            if (rangeStart > 2) {
                pages.push('left-ellipsis');
            }

            // 中间页码
            for (let i = rangeStart; i <= rangeEnd; i++) {
                pages.push(i);
            }

            // 右侧省略号
            if (rangeEnd < total - 1) {
                pages.push('right-ellipsis');
            }

            // 始终显示最后一页
            pages.push(total);
        }

        return pages;
    };

    const pageNumbers = generatePageNumbers(currentPage, totalPages);

    pageNumbers.forEach(page => {
        if (page === 'left-ellipsis' || page === 'right-ellipsis') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'pagination-ellipsis';
            ellipsis.textContent = '•••';
            btnGroup.appendChild(ellipsis);
        } else {
            const pageBtn = document.createElement('button');
            pageBtn.className = `pagination-btn ${page === currentPage ? 'active' : ''}`;
            pageBtn.textContent = page;
            pageBtn.onclick = () => pageChangeCallback(page);
            btnGroup.appendChild(pageBtn);
        }
    });

    // 下一页按钮
    const nextBtn = document.createElement('button');
    nextBtn.className = 'pagination-btn pagination-btn-nav';
    nextBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.title = '下一页';
    nextBtn.onclick = () => {
        if (currentPage < totalPages) pageChangeCallback(currentPage + 1);
    };
    btnGroup.appendChild(nextBtn);

    // 末页按钮
    const lastBtn = document.createElement('button');
    lastBtn.className = 'pagination-btn pagination-btn-nav';
    lastBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>`;
    lastBtn.disabled = currentPage === totalPages;
    lastBtn.title = '末页';
    lastBtn.onclick = () => pageChangeCallback(totalPages);
    btnGroup.appendChild(lastBtn);

    container.appendChild(btnGroup);

    // 快速跳转
    const jumpDiv = document.createElement('div');
    jumpDiv.className = 'pagination-jump';
    jumpDiv.innerHTML = `
        <span>跳至</span>
        <input type="number" min="1" max="${totalPages}" value="${currentPage}" class="pagination-input" id="${containerId}-jump-input" onkeydown="if(event.key==='Enter'){window.paginationJump('${containerId}', ${totalPages})}">
        <span>页</span>
        <button class="pagination-btn pagination-btn-jump" onclick="window.paginationJump('${containerId}', ${totalPages})">GO</button>
    `;
    container.appendChild(jumpDiv);

    // 存储回调函数供跳转使用
    window[`paginationCallback_${containerId}`] = pageChangeCallback;
}

// 分页跳转函数
window.paginationJump = function (containerId, totalPages) {
    const input = document.getElementById(`${containerId}-jump-input`);
    const callback = window[`paginationCallback_${containerId}`];
    if (input && callback) {
        let page = parseInt(input.value);
        if (isNaN(page) || page < 1) page = 1;
        if (page > totalPages) page = totalPages;
        callback(page);
    }
};

// 获取优先级文本
function getPriorityText(priority) {
    const priorityMap = {
        high: '高',
        medium: '中',
        low: '低'
    };
    return priorityMap[priority] || priority;
}

// 格式化日期时间
function formatDateTime(dateString) {
    if (!dateString) return '';
    // 处理 ISO 格式日期
    if (dateString.includes('T') && dateString.includes('Z')) {
        return dateString.replace('T', ' ').replace(/\.\d+Z$/, '');
    }
    // 处理普通日期格式
    return dateString;
}

// 获取当前日期时间（格式：YYYY-MM-DD HH:MM:SS，北京时间）
function getCurrentDateTime() {
    const now = new Date();
    // 转换为北京时间（UTC+8）
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 获取当前日期（格式：YYYY-MM-DD，北京时间）
function getCurrentDate() {
    const now = new Date();
    // 转换为北京时间（UTC+8）
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 筛选测试计划
function filterTestPlans(status) {
    let filteredPlans = testPlans;

    switch (status) {
        case 'my':
            filteredPlans = testPlans.filter(plan => plan.owner === (currentUser ? currentUser.username : 'admin'));
            break;
        case 'pending':
            filteredPlans = testPlans.filter(plan => {
                const actualStatus = calculatePlanStatus(plan);
                return actualStatus === 'not_started' || actualStatus === 'running' || actualStatus === 'delayed' || actualStatus === 'paused';
            });
            break;
        case 'completed':
            filteredPlans = testPlans.filter(plan => {
                const actualStatus = calculatePlanStatus(plan);
                return actualStatus === 'completed';
            });
            break;
        case 'all':
        default:
            filteredPlans = testPlans;
            break;
    }

    renderTestPlansTable(filteredPlans);
}
// 清空已选择的模块
function clearSelectedModules() {
    selectedModules = [];
    // 这里可以添加更新模块选择UI的逻辑
}

// 添加测试计划
function addTestPlan() {
    const modal = document.getElementById('add-testplan-modal');
    modal.style.display = 'block';

    // 初始化项目数据
    if (projects.length === 0) {
        // 使用默认项目数据
        projects = [
            { name: 'u1234' },
            { name: 'u123' },
            { name: 'project1' },
            { name: 'project2' }
        ];
    }

    // 初始化项目多选组件
    initProjectMultiSelect();

    // 初始化模块选择
    initModuleSelection();

    // 设置负责人默认值为当前登录用户
    const ownerInput = document.getElementById('plan-owner');
    if (ownerInput) {
        ownerInput.value = currentUser ? currentUser.username : 'admin';
    }

    // 初始化测试计划名称字符计数器
    const nameInput = document.getElementById('plan-name');
    const counter = document.getElementById('plan-name-counter');
    if (nameInput && counter) {
        // 初始化计数器
        counter.textContent = `0/64`;

        // 移除旧的事件监听器，避免重复添加
        nameInput.removeEventListener('input', updateCharacterCount);

        // 添加新的事件监听器
        nameInput.addEventListener('input', updateCharacterCount);
    }
}
// 更新字符计数
function updateCharacterCount() {
    const counter = document.getElementById('plan-name-counter');
    if (counter) {
        const length = this.value.length;
        counter.textContent = `${length}/64`;
    }
}

// 初始化模块选择
async function initModuleSelection() {
    try {
        showLoading('加载模块数据中...');

        // API调用逻辑
        const modulesData = await apiRequest('/modules/list', {
            method: 'POST',
            body: JSON.stringify({
                libraryId: currentCaseLibraryId || 1,
                page: 1,
                pageSize: 100 // 加载更多模块用于选择
            })
        });

        let availableModules = [];
        if (modulesData.success && modulesData.modules) {
            availableModules = modulesData.modules;
        } else {
            // 加载失败时使用默认数据
            availableModules = [
                { id: 1, name: 'IPC' },
                { id: 2, name: '无线编解码' },
                { id: 3, name: '云平台管理' }
            ];
        }

        // 这里可以添加模块选择UI的初始化逻辑
        console.log('可用模块:', availableModules);

    } catch (error) {
        console.error('初始化模块选择错误:', error);
    } finally {
        hideLoading();
    }
}

// 测试大数据集
async function testLargeDatasets() {
    try {
        showLoading('测试大数据集...');

        console.log('开始测试大数据集');

        // 测试创建大量模块
        const testModules = [];
        for (let i = 1; i <= 100; i++) { // 先测试100个模块
            testModules.push({
                name: `测试模块-${i}`,
                libraryId: currentCaseLibraryId || 1
            });
        }

        // 批量创建模块
        const createData = await apiRequest('/modules/batchCreate', {
            method: 'POST',
            body: JSON.stringify({
                modules: testModules
            })
        });

        console.log('批量创建模块结果:', createData);

        // 测试加载大量模块
        const loadData = await apiRequest('/modules/list', {
            method: 'POST',
            body: JSON.stringify({
                libraryId: currentCaseLibraryId || 1,
                page: 1,
                pageSize: 1000
            })
        });

        console.log('加载模块结果:', loadData);
        if (loadData.success && loadData.modules) {
            console.log('加载的模块数量:', loadData.modules.length);
        }

        showSuccessMessage('大数据集测试完成');

    } catch (error) {
        console.error('大数据集测试错误:', error);
        showErrorMessage('大数据集测试失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 优化性能的批量操作函数
async function batchOperation(operation, data, batchSize = 100) {
    try {
        const batches = [];
        for (let i = 0; i < data.length; i += batchSize) {
            batches.push(data.slice(i, i + batchSize));
        }

        const results = [];
        for (const batch of batches) {
            const result = await apiRequest(operation, {
                method: 'POST',
                body: JSON.stringify({ batch })
            });
            results.push(result);
        }

        return { success: true, results };
    } catch (error) {
        console.error('批量操作错误:', error);
        return { success: false, error: error.message };
    }
}

// 模块名称输入事件处理函数（用于移除监听器）
function moduleNameInputHandler() {
    const counter = document.getElementById('module-name-counter');
    if (counter) {
        counter.textContent = `${this.value.length}/32`;
    }
}

// 打开添加模块模态框
async function openAddModuleModal() {
    const modal = document.getElementById('add-module-modal');
    modal.style.display = 'block';

    // 重置为新建模式
    toggleModuleCreateMode('new');

    // 初始化模块名称字符计数器
    const nameInput = document.getElementById('module-name');
    const counter = document.getElementById('module-name-counter');
    if (nameInput && counter) {
        counter.textContent = `0/32`;
        // 先移除旧的监听器，再添加新的，避免内存泄漏
        nameInput.removeEventListener('input', moduleNameInputHandler);
        nameInput.addEventListener('input', moduleNameInputHandler);
    }

    // 加载用例库列表（用于克隆选择）
    await loadLibrariesForClone();
}

// 切换模块创建模式（新建/克隆）
function toggleModuleCreateMode(mode) {
    const newSection = document.getElementById('new-module-form-section');
    const cloneSection = document.getElementById('clone-module-form-section');
    const submitBtn = document.getElementById('add-module-submit-btn');
    const newCard = document.getElementById('mode-card-new');
    const cloneCard = document.getElementById('mode-card-clone');

    if (mode === 'new') {
        newSection.style.display = 'block';
        cloneSection.style.display = 'none';
        submitBtn.textContent = '确定';
        newCard.classList.add('active');
        cloneCard.classList.remove('active');
    } else {
        newSection.style.display = 'none';
        cloneSection.style.display = 'block';
        submitBtn.textContent = '开始克隆';
        newCard.classList.remove('active');
        cloneCard.classList.add('active');
    }
}

// 加载用例库列表（用于克隆选择）
async function loadLibrariesForClone() {
    try {
        const data = await apiRequest('/libraries/list');
        const select = document.getElementById('clone-source-library');

        if (select && data.success && data.libraries) {
            select.innerHTML = '<option value="">请选择用例库</option>';
            data.libraries.forEach(lib => {
                select.innerHTML += `<option value="${lib.id}">${escapeHtml(lib.name)}</option>`;
            });
        }
    } catch (error) {
        console.error('加载用例库列表失败:', error);
    }
}

// 加载模块列表（用于克隆选择）
async function loadModulesForClone(libraryId) {
    const moduleSelect = document.getElementById('clone-source-module');

    if (!libraryId) {
        moduleSelect.innerHTML = '<option value="">请先选择用例库</option>';
        moduleSelect.disabled = true;
        return;
    }

    try {
        const data = await apiRequest(`/modules/by-library/${libraryId}`);

        if (data.success && data.modules) {
            moduleSelect.innerHTML = '<option value="">请选择源模块</option>';
            data.modules.forEach(mod => {
                moduleSelect.innerHTML += `<option value="${mod.id}">${escapeHtml(mod.name)}</option>`;
            });
            moduleSelect.disabled = false;
        }
    } catch (error) {
        console.error('加载模块列表失败:', error);
    }
}

// 关闭添加模块模态框
function closeAddModuleModal() {
    const modal = document.getElementById('add-module-modal');
    modal.style.display = 'none';

    // 重置表单
    document.getElementById('add-module-form')?.reset();
    document.getElementById('clone-module-form')?.reset();

    const counter = document.getElementById('module-name-counter');
    if (counter) counter.textContent = '0/32';

    // 重置为新建模式
    toggleModuleCreateMode('new');
}

// 提交添加模块表单
async function submitAddModuleForm() {
    // 检查当前激活的卡片来判断创建模式
    const cloneCard = document.getElementById('mode-card-clone');
    const createMode = cloneCard && cloneCard.classList.contains('active') ? 'clone' : 'new';

    if (createMode === 'clone') {
        await submitCloneModuleForm();
    } else {
        await submitNewModuleForm();
    }
}

// 提交新建模块表单
async function submitNewModuleForm() {
    try {
        showLoading('添加模块中...');

        const moduleName = document.getElementById('module-name').value.trim();
        if (!moduleName) {
            showErrorMessage('模块名称不能为空');
            return;
        }

        // 前端验证：检查模块名是否已存在
        if (currentCaseLibraryId) {
            const existingModules = moduleList.filter(module =>
                module.name === moduleName
            );
            if (existingModules.length > 0) {
                showErrorMessage('该用例库下已存在同名模块');
                return;
            }
        }

        // API调用逻辑
        const createData = await apiRequest('/modules/create', {
            method: 'POST',
            body: JSON.stringify({
                name: moduleName,
                libraryId: currentCaseLibraryId || 2
            })
        });

        console.log('添加模块:', moduleName, createData);

        if (createData.success) {
            closeAddModuleModal();
            await initModuleData();
            
            // 发布事件：模块变更
            DataEventManager.emit(DataEvents.MODULE_CHANGED, { 
                action: 'add', 
                moduleName: moduleName 
            });
            
            showSuccessMessage('模块添加成功');
        } else {
            showErrorMessage('模块添加失败: ' + (createData.message || '未知错误'));
        }
    } catch (error) {
        console.error('添加模块错误:', error);
        showErrorMessage('添加模块失败: ' + (error.message || '未知错误'));
    } finally {
        hideLoading();
    }
}

// 提交克隆模块表单
async function submitCloneModuleForm() {
    try {
        const newModuleName = document.getElementById('clone-module-name').value.trim();
        const sourceModuleId = document.getElementById('clone-source-module').value;
        const sourceLibraryId = document.getElementById('clone-source-library').value;

        console.log('[克隆模块] 表单数据:', {
            newModuleName,
            sourceModuleId,
            sourceLibraryId
        });

        if (!newModuleName) {
            showErrorMessage('请输入新模块名称');
            return;
        }
        if (!sourceLibraryId) {
            showErrorMessage('请选择源用例库');
            return;
        }
        if (!sourceModuleId) {
            showErrorMessage('请选择源模块');
            return;
        }

        const includeLevel1Points = document.getElementById('clone-include-level1').checked;
        const includeTestCases = document.getElementById('clone-include-cases').checked;
        const clearTestStatus = document.getElementById('clone-reset-status').checked;
        const clearOwner = document.getElementById('clone-reset-owner').checked;
        const clearProjects = document.getElementById('clone-clear-projects').checked;
        const clearExecutionRecords = document.getElementById('clone-clear-records').checked;

        console.log('[克隆模块] 复选框状态:', {
            includeLevel1Points,
            includeTestCases,
            clearTestStatus,
            clearOwner,
            clearProjects,
            clearExecutionRecords
        });

        // 如果勾选了测试用例但没有勾选一级测试点，提示用户
        if (includeTestCases && !includeLevel1Points) {
            const confirmResult = await showConfirmMessage(
                '您勾选了"包含测试用例"但没有勾选"包含一级测试点"。\n\n' +
                '这会导致克隆的测试用例失去与测试点的关联，在树结构中可能不可见。\n\n' +
                '是否继续？'
            );
            if (!confirmResult) {
                return;
            }
        }

        showLoading('正在克隆模块...');

        const requestBody = {
            sourceModuleId: parseInt(sourceModuleId),
            newModuleName: newModuleName,
            targetLibraryId: currentCaseLibraryId || 2,
            includeLevel1Points,
            includeTestCases,
            clearTestStatus,
            clearOwner,
            clearProjects,
            clearExecutionRecords
        };

        console.log('[克隆模块] 请求参数:', requestBody);

        const result = await apiRequest('/modules/clone', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });

        console.log('[克隆模块] API返回结果:', result);

        hideLoading();

        if (result.success) {
            closeAddModuleModal();
            await initModuleData();

            const msg = result.data
                ? `模块克隆成功！已克隆 ${result.data.clonedLevel1Count} 个测试点，${result.data.clonedCaseCount} 个用例`
                : '模块克隆成功';
            showSuccessMessage(msg);
        } else {
            showErrorMessage('克隆失败: ' + (result.message || '未知错误'));
        }
    } catch (error) {
        hideLoading();
        console.error('克隆模块错误:', error);
        showErrorMessage('克隆模块失败: ' + error.message);
    }
}

// 打开调整模块顺序模态框
async function openReorderModulesModal() {
    const modal = document.getElementById('reorder-modules-modal');
    modal.style.display = 'block';

    // 加载模块数据
    await loadModulesForReordering();
}

// 关闭调整模块顺序模态框
function closeReorderModulesModal() {
    const modal = document.getElementById('reorder-modules-modal');
    modal.style.display = 'none';
}

// 加载模块数据用于重排序
async function loadModulesForReordering() {
    const reorderList = document.getElementById('reorder-list');
    if (!reorderList) {
        console.error('reorder-list元素不存在');
        return;
    }

    try {
        showLoading('加载模块数据中...');

        // 清空现有选项
        reorderList.innerHTML = '';

        // 打印调试信息
        console.log('=== 加载模块数据用于重排序 ===');

        // 1. 直接测试使用模块列表API
        console.log('直接测试API调用:');

        try {
            const testUrl = 'http://localhost:3000/api/modules/list';
            const testData = {
                libraryId: 2, // 尝试使用固定libraryId
                page: 1,
                pageSize: 100
            };

            console.log('测试URL:', testUrl);
            console.log('测试数据:', testData);

            const response = await fetch(testUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(testData)
            });

            console.log('响应状态:', response.status);
            console.log('响应头:', response.headers);

            const responseText = await response.text();
            console.log('响应文本:', responseText);

            // 尝试解析JSON
            let responseJson = null;
            try {
                responseJson = JSON.parse(responseText);
                console.log('解析后的JSON:', responseJson);
            } catch (parseError) {
                console.error('JSON解析错误:', parseError);
            }

            let modules = [];
            if (responseJson && responseJson.success && responseJson.modules) {
                modules = responseJson.modules;
                console.log('从API获取到的模块:', modules);
            } else {
                // 2. API调用失败，使用硬编码测试数据作为备用
                console.log('API调用失败，使用测试数据');
                modules = [
                    { id: 1, name: 'IPC', orderIndex: 0 },
                    { id: 2, name: 'IPMC', orderIndex: 1 },
                    { id: 3, name: '无线编解码', orderIndex: 2 },
                    { id: 4, name: '云平台管理', orderIndex: 3 },
                    { id: 5, name: 'IPUC', orderIndex: 4 },
                    { id: 6, name: 'FDB', orderIndex: 5 },
                    { id: 7, name: 'SSS', orderIndex: 6 }
                ];
            }

            // 3. 渲染模块
            console.log('准备渲染模块:', modules.length, '个');
            modules.forEach((module, index) => {
                const li = document.createElement('li');
                li.className = 'reorder-item';
                li.innerHTML = `
                    <span class="reorder-item-name">${module.name}</span>
                `;
                li.draggable = true;

                // 添加拖拽事件监听器
                li.addEventListener('dragstart', handleDragStart);
                li.addEventListener('dragover', handleDragOver);
                li.addEventListener('drop', handleDrop);

                reorderList.appendChild(li);
                console.log('已渲染模块:', module.name);
            });

            console.log('渲染完成，列表子元素数量:', reorderList.children.length);

        } catch (apiError) {
            console.error('API测试错误:', apiError);

            // 直接显示测试数据
            const testModules = [
                { id: 1, name: 'IPC', orderIndex: 0 },
                { id: 2, name: 'IPMC', orderIndex: 1 },
                { id: 3, name: '无线编解码', orderIndex: 2 },
                { id: 4, name: '云平台管理', orderIndex: 3 },
                { id: 5, name: 'IPUC', orderIndex: 4 },
                { id: 6, name: 'FDB', orderIndex: 5 },
                { id: 7, name: 'SSS', orderIndex: 6 }
            ];

            testModules.forEach((module, index) => {
                const li = document.createElement('li');
                li.className = 'reorder-item';
                li.innerHTML = `
                    <span class="reorder-item-name">${module.name}</span>
                `;
                li.draggable = true;

                li.addEventListener('dragstart', handleDragStart);
                li.addEventListener('dragover', handleDragOver);
                li.addEventListener('drop', handleDrop);

                reorderList.appendChild(li);
            });
        }

    } catch (error) {
        console.error('加载模块数据用于重排序错误:', error);
        console.error('错误堆栈:', error.stack);
        showErrorMessage('加载模块数据失败: ' + (error.message || '未知错误'));
    } finally {
        hideLoading();
    }
}

// 拖拽开始事件
function handleDragStart(e) {
    this.classList.add('dragging');
    e.dataTransfer.setData('text/plain', this.innerHTML);
    e.dataTransfer.effectAllowed = 'move';
}

// 拖拽经过事件
function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // 计算插入位置
    const dragging = document.querySelector('.dragging');
    const siblings = Array.from(this.parentNode.children).filter(child => !child.classList.contains('dragging'));

    const afterElement = siblings.find(sibling => {
        const rect = sibling.getBoundingClientRect();
        return e.clientY <= rect.top + rect.height / 2;
    });

    if (afterElement) {
        this.parentNode.insertBefore(dragging, afterElement);
    } else {
        this.parentNode.appendChild(dragging);
    }
}

// 放置事件
function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('dragging');
}

// 提交调整模块顺序表单
async function submitReorderModulesForm() {
    try {
        showLoading('调整模块顺序中...');

        const reorderList = document.getElementById('reorder-list');
        const items = reorderList.querySelectorAll('.reorder-item');

        const reorderedModules = Array.from(items).map(item => {
            return item.querySelector('.reorder-item-name').textContent;
        });

        console.log('调整后的模块顺序:', reorderedModules);

        // API调用逻辑
        const updateData = await apiRequest('/modules/reorder', {
            method: 'POST',
            body: JSON.stringify({
                modules: reorderedModules,
                libraryId: currentCaseLibraryId || 1
            })
        });

        console.log('调整模块顺序结果:', updateData);

        if (updateData.success) {
            // 关闭模态框
            closeReorderModulesModal();

            // 重新从数据库加载模块列表
            await initModuleData();

            // 显示成功消息
            showSuccessMessage('模块顺序调整成功');
        } else {
            showErrorMessage('模块顺序调整失败: ' + (updateData.message || '未知错误'));
        }
    } catch (error) {
        console.error('调整模块顺序错误:', error);
        showErrorMessage('调整模块顺序失败: ' + (error.message || '未知错误'));
    } finally {
        hideLoading();
    }
}

// 添加测试报告
function addTestReport() {
    const modal = document.getElementById('add-testreport-modal');
    modal.style.display = 'block';

    // 初始化步骤导航
    initTestReportModalSteps();
}
// 初始化模块数据
async function initModuleData() {
    try {
        // 显示加载状态
        const moduleSection = document.querySelector('.case-nav-section');
        if (moduleSection) {
            moduleSection.style.opacity = '0.7';
        }

        // API调用逻辑
        const modulesData = await apiRequest('/modules/list', {
            method: 'POST',
            body: JSON.stringify({
                libraryId: currentCaseLibraryId || 2,
                page: currentModulePage,
                pageSize: modulesPerPage
            })
        });

        if (modulesData.success && modulesData.modules) {
            moduleList = modulesData.modules;
        } else {
            // 没有默认模块数据，只显示"所有用例"
            moduleList = [];
        }

        // 更新模块显示
        updateModuleDisplay();

        // 初始化搜索功能
        initModuleSearch();

        // 初始化事件监听器（只初始化一次）
        if (!window.dataEventListenersInitialized) {
            initDataEventListeners();
            window.dataEventListenersInitialized = true;
        }

        // 自动加载当前用例库的所有一级测试点
        await loadAllLevel1Points();
    } catch (error) {
        console.error('初始化模块数据错误:', error);
        // 没有默认模块数据，只显示"所有用例"
        moduleList = [];

        // 更新模块显示
        updateModuleDisplay();

        // 初始化搜索功能
        initModuleSearch();

        // 即使出错也尝试加载所有一级测试点
        await loadAllLevel1Points();
    } finally {
        // 隐藏加载状态
        const moduleSection = document.querySelector('.case-nav-section');
        if (moduleSection) {
            moduleSection.style.opacity = '1';
        }
        hideLoading();
    }
}

// 初始化模块搜索功能
function initModuleSearch() {
    const searchInput = document.querySelector('.case-nav-section .search-input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(async function () {
            const searchTerm = this.value.toLowerCase().trim();
            await filterModules(searchTerm);
        }, 300));
    }
}

// ==================== 事件监听器初始化 ====================
function initDataEventListeners() {
    // 监听测试用例变更事件 - 刷新模块树统计
    DataEventManager.on(DataEvents.TEST_CASE_CHANGED, async (data) => {
        console.log('[事件] 测试用例变更:', data);
        // 刷新模块树统计数字
        await initModuleData();
    });

    // 监听一级测试点变更事件 - 刷新模块树统计
    DataEventManager.on(DataEvents.LEVEL1_POINT_CHANGED, async (data) => {
        console.log('[事件] 一级测试点变更:', data);
        // 刷新模块树统计数字
        await initModuleData();
    });

    // 监听执行记录变更事件 - 刷新测试用例列表
    DataEventManager.on(DataEvents.EXECUTION_RECORD_CHANGED, async (data) => {
        console.log('[事件] 执行记录变更:', data);
        // 刷新测试用例列表
        if (selectedLevel1PointId) {
            const testCases = await getLevel2TestPoints(selectedLevel1PointId);
            updateFloatingPanelContent(testCases);
        }
    });

    // 监听仪表盘刷新事件
    DataEventManager.on(DataEvents.DASHBOARD_REFRESH, async (data) => {
        console.log('[事件] 仪表盘刷新:', data);
        // 刷新仪表盘数据
        if (typeof loadDashboardData === 'function') {
            await loadDashboardData();
        }
    });

    // 监听模块变更事件 - 刷新模块树和仪表盘
    DataEventManager.on(DataEvents.MODULE_CHANGED, async (data) => {
        console.log('[事件] 模块变更:', data);
        // 刷新模块树
        await initModuleData();
        // 同时触发仪表盘刷新
        DataEventManager.emit(DataEvents.DASHBOARD_REFRESH, { source: 'moduleChanged' });
    });
}

// 过滤模块
async function filterModules(searchTerm) {
    try {
        showLoading('搜索模块中...');

        // API调用逻辑
        const searchData = await apiRequest('/modules/search', {
            method: 'POST',
            body: JSON.stringify({
                libraryId: currentCaseLibraryId || 1,
                searchTerm: searchTerm,
                page: currentModulePage,
                pageSize: modulesPerPage
            })
        });

        let filteredModules = [];
        if (searchData.success && searchData.modules) {
            filteredModules = searchData.modules;
        } else {
            // 搜索失败时使用本地过滤
            filteredModules = moduleList.filter(module =>
                module.name.toLowerCase().includes(searchTerm)
            );
        }

        const caseNavList = document.querySelector('.case-nav-list');
        if (!caseNavList) return;

        // 保存当前选中状态
        const activeItem = caseNavList.querySelector('.case-nav-item.active');
        const activeName = activeItem ? activeItem.querySelector('.case-nav-name').textContent : '所有用例';

        // 清空现有模块（只保留"所有用例"）
        const items = caseNavList.querySelectorAll('.case-nav-item');
        items.forEach(item => {
            const itemName = item.querySelector('.case-nav-name').textContent;
            if (itemName !== '所有用例') {
                item.remove();
            }
        });

        // 确保"所有用例"项存在
        let allCasesItem = caseNavList.querySelector('.case-nav-item');
        if (!allCasesItem) {
            allCasesItem = document.createElement('li');
            allCasesItem.className = 'case-nav-item active';
            allCasesItem.innerHTML = '<span class="case-nav-name">所有用例</span>';
            caseNavList.appendChild(allCasesItem);
        }

        // 计算分页
        const totalPages = Math.ceil(filteredModules.length / modulesPerPage);
        const startIndex = (currentModulePage - 1) * modulesPerPage;
        const endIndex = startIndex + modulesPerPage;
        const currentPageModules = filteredModules.slice(startIndex, endIndex);

        // 添加模块项
        currentPageModules.forEach(module => {
            const li = document.createElement('li');
            li.className = 'case-nav-item';
            li.innerHTML = `
                <span class="case-nav-name">${module.name}</span><span class="case-nav-count">(${module.level1Count || 0})</span>
            `;

            // 添加点击事件
            li.addEventListener('click', async function () {
                // 移除其他项的活跃状态
                caseNavList.querySelectorAll('.case-nav-item').forEach(item => {
                    item.classList.remove('active');
                });
                // 添加当前项的活跃状态
                this.classList.add('active');

                // 获取当前选中的模块信息
                const moduleName = this.querySelector('.case-nav-name').textContent;
                const selectedModule = filteredModules.find(m => m.name === moduleName);

                // 设置当前模块
                window.currentModule = selectedModule;

                // 加载一级测试点
                if (selectedModule && selectedModule.id) {
                    await loadLevel1Points(selectedModule.id);
                }
            });

            caseNavList.appendChild(li);
        });

        // 恢复活跃状态
        caseNavList.querySelectorAll('.case-nav-item').forEach(item => {
            const itemName = item.querySelector('.case-nav-name').textContent;
            if (itemName === activeName) {
                item.classList.add('active');
            }
        });

        // 更新分页控件
        updateModulePagination(totalPages);
    } catch (error) {
        console.error('过滤模块错误:', error);
        // 降级到本地过滤
        const caseNavList = document.querySelector('.case-nav-list');
        if (!caseNavList) return;

        const items = caseNavList.querySelectorAll('.case-nav-item:not(.active)');
        items.forEach(item => {
            const moduleName = item.querySelector('.case-nav-name').textContent.toLowerCase();
            if (searchTerm === '' || moduleName.includes(searchTerm)) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
    } finally {
        hideLoading();
    }
}

// 更新模块显示
function updateModuleDisplay() {
    const caseNavList = document.querySelector('.case-nav-list');
    if (!caseNavList) return;

    // 清空一级测试点显示（切换用例库或模块列表时）
    clearLevel1PointsDisplay();

    // 保存当前选中状态
    const activeItem = caseNavList.querySelector('.case-nav-item.active');
    const activeName = activeItem ? activeItem.querySelector('.case-nav-name').textContent : '所有用例';

    // 清空现有模块（只保留"所有用例"）
    const items = caseNavList.querySelectorAll('.case-nav-item');
    items.forEach(item => {
        const itemName = item.querySelector('.case-nav-name').textContent;
        if (itemName !== '所有用例') {
            item.remove();
        }
    });

    // 确保"所有用例"项存在并设为活跃状态
    let allCasesItem = caseNavList.querySelector('.case-nav-item');
    if (!allCasesItem) {
        allCasesItem = document.createElement('li');
        allCasesItem.className = 'case-nav-item active';
        allCasesItem.innerHTML = '<span class="case-nav-name">所有用例</span>';
        caseNavList.appendChild(allCasesItem);
    } else {
        // 确保"所有用例"是活跃状态
        allCasesItem.classList.add('active');
    }

    // 为"所有用例"项添加点击事件
    allCasesItem.addEventListener('click', function () {
        // 移除其他项的活跃状态
        caseNavList.querySelectorAll('.case-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        // 添加当前项的活跃状态
        this.classList.add('active');

        // 加载当前用例库下的所有一级测试用例
        loadAllLevel1Points();
    });

    // 计算分页
    const totalPages = Math.ceil(moduleList.length / modulesPerPage);
    const startIndex = (currentModulePage - 1) * modulesPerPage;
    const endIndex = startIndex + modulesPerPage;
    const currentPageModules = moduleList.slice(startIndex, endIndex);

    // 使用文档片段优化DOM操作
    const fragment = document.createDocumentFragment();

    // 添加模块项
    currentPageModules.forEach(module => {
        const li = document.createElement('li');
        li.className = 'case-nav-item';
        li.innerHTML = `
                <span class="case-nav-name">${module.name}</span><span class="case-nav-count">(${module.level1Count || 0})</span>
                <span class="module-actions">
                    <button class="module-action-btn" data-module-id="${module.id}" title="操作">...</button>
                </span>
            `;

        // 添加点击事件
        li.addEventListener('click', function () {
            // 移除其他项的活跃状态
            caseNavList.querySelectorAll('.case-nav-item').forEach(item => {
                item.classList.remove('active');
            });
            // 添加当前项的活跃状态
            this.classList.add('active');

            // 设置当前模块
            window.currentModule = module;

            // 加载该模块的一级测试点
            loadLevel1Points(module.id);
        });

        fragment.appendChild(li);
    });

    // 一次性添加所有模块
    caseNavList.appendChild(fragment);

    // 恢复活跃状态
    caseNavList.querySelectorAll('.case-nav-item').forEach(item => {
        const itemName = item.querySelector('.case-nav-name').textContent;
        if (itemName === activeName) {
            item.classList.add('active');
        }
    });

    // 更新分页控件
    updateModulePagination(totalPages);

    // 初始化模块操作按钮
    initModuleActionButtons();
}


// 更新模块分页控件
function updateModulePagination(totalPages) {
    let paginationContainer = document.getElementById('module-pagination');

    // 如果分页容器不存在，创建它
    if (!paginationContainer) {
        const caseNavSection = document.querySelector('.case-nav-section');
        if (caseNavSection) {
            paginationContainer = document.createElement('div');
            paginationContainer.id = 'module-pagination';
            paginationContainer.className = 'module-pagination';
            caseNavSection.appendChild(paginationContainer);
        }
    }

    // 清空现有分页
    if (paginationContainer) {
        paginationContainer.innerHTML = '';

        // 只在模块数量超过一页时显示分页
        if (totalPages > 1) {
            paginationContainer.style.display = 'flex';
            paginationContainer.style.justifyContent = 'center';
            paginationContainer.style.alignItems = 'center';
            paginationContainer.style.gap = '4px';
            paginationContainer.style.marginTop = '16px';
            paginationContainer.style.paddingTop = '16px';
            paginationContainer.style.borderTop = '1px solid #e4e7ed';

            // 上一页按钮
            const prevButton = document.createElement('button');
            prevButton.textContent = '上一页';
            prevButton.className = 'pagination-btn pagination-btn-nav';
            prevButton.disabled = currentModulePage === 1;
            prevButton.onclick = function () {
                if (currentModulePage > 1) {
                    currentModulePage--;
                    updateModuleDisplay();
                }
            };
            paginationContainer.appendChild(prevButton);

            // 智能页码生成
            const generatePageNumbers = (current, total) => {
                const pages = [];
                if (total <= 7) {
                    for (let i = 1; i <= total; i++) pages.push(i);
                } else {
                    pages.push(1);
                    let startPage = Math.max(2, current - 2);
                    let endPage = Math.min(total - 1, current + 2);

                    if (startPage > 2) pages.push('ellipsis-left');
                    for (let i = startPage; i <= endPage; i++) pages.push(i);
                    if (endPage < total - 1) pages.push('ellipsis-right');
                    pages.push(total);
                }
                return pages;
            };

            const pageNumbers = generatePageNumbers(currentModulePage, totalPages);
            pageNumbers.forEach(page => {
                if (page === 'ellipsis-left' || page === 'ellipsis-right') {
                    const ellipsis = document.createElement('span');
                    ellipsis.className = 'pagination-ellipsis';
                    ellipsis.textContent = '•••';
                    paginationContainer.appendChild(ellipsis);
                } else {
                    const pageButton = document.createElement('button');
                    pageButton.textContent = page;
                    pageButton.className = `pagination-btn ${page === currentModulePage ? 'active' : ''}`;
                    pageButton.onclick = function () {
                        currentModulePage = page;
                        updateModuleDisplay();
                    };
                    paginationContainer.appendChild(pageButton);
                }
            });

            // 下一页按钮
            const nextButton = document.createElement('button');
            nextButton.textContent = '下一页';
            nextButton.className = 'pagination-btn pagination-btn-nav';
            nextButton.disabled = currentModulePage === totalPages;
            nextButton.onclick = function () {
                if (currentModulePage < totalPages) {
                    currentModulePage++;
                    updateModuleDisplay();
                }
            };
            paginationContainer.appendChild(nextButton);
        } else {
            paginationContainer.style.display = 'none';
        }
    }
}

// 初始化模块操作按钮
function initModuleActionButtons() {
    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .case-nav-item {
            position: relative;
            padding: 8px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .case-nav-item:hover {
            background-color: #f5f7fa;
        }
        
        .module-actions {
            position: absolute;
            right: 16px;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        
        .case-nav-item:hover .module-actions {
            opacity: 1;
        }
        
        .module-action-btn {
            background: none;
            border: none;
            font-size: 14px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
        }
        
        .module-action-btn:hover {
            background-color: #e4e7ed;
        }
        
        .module-menu {
            position: absolute;
            background: white;
            border: 1px solid #dcdfe6;
            border-radius: 4px;
            box-shadow: 0 2px 12px 0 rgba(0,0,0,0.1);
            z-index: 1000;
            min-width: 120px;
            padding: 4px 0;
        }
        
        .module-menu-item {
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
        }
        
        .module-menu-item:hover {
            background-color: #ecf5ff;
        }
        
        .module-menu-item.separator {
            border-top: 1px solid #ebeef5;
            margin: 4px 0;
            padding: 0;
            cursor: default;
        }
        
        .module-menu-item.separator:hover {
            background: none;
        }
    `;
    document.head.appendChild(style);

    // 添加模块操作按钮事件
    const actionButtons = document.querySelectorAll('.module-action-btn');
    actionButtons.forEach(button => {
        button.addEventListener('click', function (e) {
            e.stopPropagation();
            const moduleId = this.getAttribute('data-module-id');
            const moduleName = this.closest('.case-nav-item').querySelector('.case-nav-name').textContent;
            showModuleMenu(e.pageX, e.pageY, moduleId, moduleName);
        });
    });
}

// 显示模块菜单
function showModuleMenu(x, y, moduleId, moduleName) {
    // 移除已存在的菜单
    const existingMenu = document.querySelector('.module-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    // 创建菜单
    const menu = document.createElement('div');
    menu.className = 'module-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
        <div class="module-menu-item" data-action="rename" data-module-id="${moduleId}">重命名</div>
        <div class="module-menu-item" data-action="add-submodule" data-module-id="${moduleId}">新建子模块</div>
        <div class="module-menu-item" data-action="delete" data-module-id="${moduleId}">删除</div>
    `;

    document.body.appendChild(menu);

    // 点击菜单项
    menu.querySelectorAll('.module-menu-item').forEach(item => {
        item.addEventListener('click', function () {
            const action = this.getAttribute('data-action');
            handleModuleAction(action, moduleId, moduleName);
            menu.remove();
        });
    });

    // 点击外部关闭菜单
    document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    });
}

// 处理模块操作
async function handleModuleAction(action, moduleId, moduleName) {
    switch (action) {
        case 'rename':
            await renameModule(moduleId, moduleName);
            break;
        case 'add-submodule':
            await addSubModule(moduleId, moduleName);
            break;
        case 'delete':
            await deleteModule(moduleId, moduleName);
            break;
    }
}

// 编辑模块相关变量
let currentEditModuleId = null;

// 打开编辑模块模态框
function openEditModuleModal(moduleId, currentName) {
    currentEditModuleId = moduleId;

    const modal = document.getElementById('edit-module-modal');
    const nameInput = document.getElementById('edit-module-name');
    const counter = document.getElementById('edit-module-name-counter');

    nameInput.value = currentName;
    counter.textContent = `${currentName.length}/32`;

    // 添加输入事件监听器
    nameInput.addEventListener('input', function () {
        counter.textContent = `${this.value.length}/32`;
    });

    modal.style.display = 'block';
}

// 关闭编辑模块模态框
function closeEditModuleModal() {
    const modal = document.getElementById('edit-module-modal');
    modal.style.display = 'none';
    currentEditModuleId = null;
}

// 提交编辑模块表单
async function submitEditModuleForm() {
    const nameInput = document.getElementById('edit-module-name');
    const newName = nameInput.value.trim();

    if (!newName) {
        showErrorMessage('模块名称不能为空');
        return;
    }

    if (newName.length > 32) {
        showErrorMessage('模块名称不能超过32个字符');
        return;
    }

    try {
        showLoading('重命名模块中...');

        // 验证模块名唯一性
        const existingModules = moduleList.filter(module =>
            module.name === newName && module.id != currentEditModuleId
        );
        if (existingModules.length > 0) {
            showErrorMessage('该用例库下已存在同名模块');
            return;
        }

        // API调用逻辑
        const renameData = await apiRequest('/modules/update', {
            method: 'POST',
            body: JSON.stringify({
                id: currentEditModuleId,
                name: newName,
                libraryId: currentCaseLibraryId
            })
        });

        if (renameData.success) {
            await initModuleData();
            closeEditModuleModal();
            showSuccessMessage('模块重命名成功');
        } else {
            showErrorMessage('模块重命名失败: ' + (renameData.message || '重命名失败，请稍后重试'));
        }
    } catch (error) {
        console.error('重命名模块错误:', error);
        showErrorMessage('模块重命名失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 重命名模块
async function renameModule(moduleId, currentName) {
    openEditModuleModal(moduleId, currentName);
}

// 新建子模块
async function addSubModule(moduleId, parentName) {
    openAddSubModuleModal(moduleId, parentName);
}

// 打开新建子模块模态框
function openAddSubModuleModal(moduleId, parentName) {
    const nameInput = document.getElementById('submodule-name');
    const counter = document.getElementById('submodule-name-counter');
    
    nameInput.value = parentName + '子模块';
    document.getElementById('submodule-parent-name').value = parentName;
    document.getElementById('submodule-parent-id').value = moduleId;
    
    if (counter) {
        counter.textContent = `${nameInput.value.length}/32`;
    }
    
    // 添加输入事件监听器
    nameInput.oninput = function() {
        if (counter) {
            counter.textContent = `${this.value.length}/32`;
        }
    };
    
    document.getElementById('add-submodule-modal').style.display = 'block';
}

// 关闭新建子模块模态框
function closeAddSubModuleModal() {
    const modal = document.getElementById('add-submodule-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    const form = document.getElementById('add-submodule-form');
    if (form) {
        form.reset();
    }
}

// 提交新建子模块表单
async function submitAddSubModuleForm() {
    const subModuleName = document.getElementById('submodule-name').value.trim();
    const parentId = document.getElementById('submodule-parent-id').value;
    
    if (!subModuleName) {
        showErrorMessage('子模块名称不能为空');
        return;
    }

    try {
        showLoading('创建子模块中...');

        // 验证模块名唯一性
        const existingModules = moduleList.filter(module =>
            module.name === subModuleName
        );
        if (existingModules.length > 0) {
            showErrorMessage('该用例库下已存在同名模块');
            return;
        }

        // API调用逻辑
        const createData = await apiRequest('/modules/create', {
            method: 'POST',
            body: JSON.stringify({
                name: subModuleName,
                libraryId: currentCaseLibraryId,
                parentId: parentId
            })
        });

        if (createData.success) {
            closeAddSubModuleModal();
            await initModuleData();
            showSuccessMessage('子模块创建成功');
        } else {
            showErrorMessage('子模块创建失败: ' + (createData.message || '创建失败，请稍后重试'));
        }
    } catch (error) {
        console.error('创建子模块错误:', error);
        showErrorMessage('子模块创建失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除模块
async function deleteModule(moduleId, moduleName) {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    if (!(await showConfirmMessage(`确定要删除模块 "${moduleName}" 吗？`))) return;

    try {
        showLoading('删除模块中...');

        // API调用逻辑
        const deleteData = await apiRequest('/modules/delete', {
            method: 'POST',
            body: JSON.stringify({
                id: moduleId,
                libraryId: currentCaseLibraryId
            })
        });

        if (deleteData.success) {
            await initModuleData();
            // 清空一级测试点显示
            clearLevel1PointsDisplay();
            
            // 发布事件：模块变更
            DataEventManager.emit(DataEvents.MODULE_CHANGED, { 
                action: 'delete', 
                moduleId: moduleId,
                moduleName: moduleName
            });
            
            showSuccessMessage('模块删除成功');
        } else {
            showErrorMessage('模块删除失败: ' + (deleteData.message || '删除失败，请稍后重试'));
        }
    } catch (error) {
        console.error('删除模块错误:', error);
        showErrorMessage('模块删除失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 加载所有一级测试用例
async function loadAllLevel1Points() {
    try {
        showLoading('加载所有一级测试用例中...');

        selectedModuleId = null;
        currentLevel1Page = 1;

        // API调用逻辑，添加搜索关键词参数
        const pointsData = await apiRequest('/testpoints/level1/all', {
            method: 'POST',
            body: JSON.stringify({
                libraryId: currentCaseLibraryId,
                keyword: level1SearchKeyword || ''
            })
        });

        let fetchedPoints = [];
        if (Array.isArray(pointsData)) {
            fetchedPoints = pointsData;
        } else if (pointsData && pointsData.testpoints) {
            fetchedPoints = pointsData.testpoints;
        } else if (pointsData && pointsData.success && pointsData.data) {
            fetchedPoints = pointsData.data;
        } else if (pointsData && pointsData.success && pointsData.level1Points) {
            fetchedPoints = pointsData.level1Points;
        } else {
            // 加载失败时使用空数据
            console.log('API调用失败，使用空数据');
            fetchedPoints = [];
        }

        // 保存到全局变量
        level1Points = fetchedPoints;

        // 将数据保存到本地缓存
        try {
            // 创建一个包含模块名映射的缓存对象
            const level1PointsWithModule = fetchedPoints.map(point => ({
                ...point,
                module_name: point.module_name || '',
                module_id: point.module_id || 0
            }));

            // 保存到localStorage
            localStorage.setItem('level1Points', JSON.stringify(level1PointsWithModule));
            console.log('一级测试点数据已保存到本地缓存');

            // 保存当前用例库ID
            localStorage.setItem('currentCaseLibraryId', JSON.stringify(currentCaseLibraryId));
        } catch (error) {
            console.error('保存一级测试点数据到本地缓存失败:', error);
        }

        // 更新一级测试点显示
        updateLevel1PointsDisplay();
    } catch (error) {
        console.error('加载所有一级测试用例错误:', error);
        // 加载失败时使用空数据
        level1Points = [];

        // 更新一级测试点显示
        updateLevel1PointsDisplay();
    } finally {
        hideLoading();
    }
}

// 加载一级测试点数据
async function loadLevel1Points(moduleId) {
    try {
        showLoading('加载一级测试点中...');

        if (!moduleId) {
            // 当moduleId为null时，加载所有一级测试用例
            await loadAllLevel1Points();
            return;
        }

        selectedModuleId = moduleId;
        currentLevel1Page = 1;

        // 构建URL，添加搜索关键词参数
        let url = `/testpoints/level1/${moduleId}`;
        if (level1SearchKeyword) {
            url += `?keyword=${encodeURIComponent(level1SearchKeyword)}`;
        }

        console.log('[一级测试点] 请求URL:', url);

        // API调用逻辑 - 禁用缓存以获取最新数据
        const pointsData = await apiRequest(url, { useCache: false });

        console.log('[一级测试点] API返回数据:', pointsData);
        console.log('[一级测试点] 数据类型:', typeof pointsData);

        let fetchedPoints = [];
        if (Array.isArray(pointsData)) {
            fetchedPoints = pointsData;
            console.log('[一级测试点] 数据是数组，长度:', fetchedPoints.length);
        } else if (pointsData && pointsData.testpoints) {
            fetchedPoints = pointsData.testpoints;
            console.log('[一级测试点] 使用 testpoints 字段，长度:', fetchedPoints.length);
        } else if (pointsData && pointsData.success && pointsData.data) {
            fetchedPoints = pointsData.data;
            console.log('[一级测试点] 使用 data 字段，长度:', fetchedPoints.length);
        } else if (pointsData && pointsData.success && pointsData.level1Points) {
            fetchedPoints = pointsData.level1Points;
            console.log('[一级测试点] 使用 level1Points 字段，长度:', fetchedPoints.length);
        } else {
            // 加载失败时使用空数据
            console.log('[一级测试点] API调用失败，使用空数据');
            fetchedPoints = [];
        }

        // 保存到全局变量
        level1Points = fetchedPoints;
        console.log('[一级测试点] 已保存到全局变量，长度:', level1Points.length);

        // 将数据保存到本地缓存
        try {
            // 创建一个包含模块名映射的缓存对象
            const level1PointsWithModule = fetchedPoints.map(point => ({
                ...point,
                module_name: point.module_name || '',
                module_id: point.module_id || 0
            }));

            // 保存到localStorage
            localStorage.setItem('level1Points', JSON.stringify(level1PointsWithModule));
            console.log('一级测试点数据已保存到本地缓存');

            // 保存当前用例库ID
            localStorage.setItem('currentCaseLibraryId', JSON.stringify(currentCaseLibraryId));
        } catch (error) {
            console.error('保存一级测试点数据到本地缓存失败:', error);
        }

        // 更新一级测试点显示
        updateLevel1PointsDisplay();
    } catch (error) {
        console.error('加载一级测试点错误:', error);
        // 加载失败时使用空数据
        level1Points = [];

        // 更新一级测试点显示
        updateLevel1PointsDisplay();
    } finally {
        hideLoading();
    }
}

// 更新一级测试点显示
function updateLevel1PointsDisplay() {
    const level1List = document.getElementById('level1-list');
    if (!level1List) {
        console.error('[一级测试点] 未找到 level1-list 元素');
        return;
    }

    console.log('[一级测试点] 开始更新显示，总数据量:', level1Points.length);

    const totalPages = Math.ceil(level1Points.length / level1PointsPerPage);
    const startIndex = (currentLevel1Page - 1) * level1PointsPerPage;
    const endIndex = startIndex + level1PointsPerPage;
    const currentPagePoints = level1Points.slice(startIndex, endIndex);

    console.log('[一级测试点] 当前页数据量:', currentPagePoints.length, '总页数:', totalPages);

    if (currentPagePoints.length === 0) {
        level1List.innerHTML = `
            <div class="level1-list-header">
                <div>编号</div>
                <div>名称</div>
                <div>测试类型</div>
                <div>用例数量</div>
                <div>更新时间</div>
            </div>
            <div class="level1-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                </svg>
                <span class="level1-empty-state-text">暂无一级测试点</span>
            </div>
        `;
    } else {
        level1List.innerHTML = `
            <div class="level1-list-header">
                <div>编号</div>
                <div>名称</div>
                <div>测试类型</div>
                <div>用例数量</div>
                <div>更新时间</div>
            </div>
            ${currentPagePoints.map((point, index) => {
            const testCaseCount = point.test_case_count || point.testCaseCount || 0;
            const testType = point.test_type || '功能测试';
            const typeClass = testType.includes('性能') ? 'performance' :
                testType.includes('兼容') ? 'compatibility' :
                    testType.includes('安全') ? 'security' : 'functional';
            const updateTime = formatDateTime(point.updated_at || point.updatedAt || point.created_at || point.createdAt || '');

            return `
                    <div class="level1-list-item" data-point-id="${point.id}">
                        <div class="level1-number">${startIndex + index + 1}</div>
                        <div class="level1-name">${point.name}</div>
                        <div>
                            <span class="level1-type-badge ${typeClass}">${testType}</span>
                        </div>
                        <div class="level1-count">
                            <span class="level1-count-value">${testCaseCount}</span>
                            <span class="level1-count-label">用例</span>
                        </div>
                        <div class="level1-time">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 6v6l4 2"></path>
                            </svg>
                            ${updateTime}
                        </div>
                    </div>
                `;
        }).join('')}
        `;
    }

    updateLevel1Pagination(totalPages);
    initLevel1PointClickEvents();
}

// 更新一级测试点分页控件
function updateLevel1Pagination(totalPages) {
    let paginationContainer = document.getElementById('level1-pagination');

    // 如果分页容器不存在，创建它
    if (!paginationContainer) {
        const caseList = document.querySelector('.case-list');
        if (caseList) {
            paginationContainer = document.createElement('div');
            paginationContainer.id = 'level1-pagination';
            paginationContainer.className = 'module-pagination';
            caseList.appendChild(paginationContainer);
        }
    }

    // 清空现有分页
    if (paginationContainer) {
        paginationContainer.innerHTML = '';

        // 只在一级测试点数量超过一页时显示分页
        if (totalPages > 1) {
            paginationContainer.style.display = 'flex';
            paginationContainer.style.justifyContent = 'center';
            paginationContainer.style.alignItems = 'center';
            paginationContainer.style.gap = '4px';
            paginationContainer.style.marginTop = '16px';
            paginationContainer.style.paddingTop = '16px';
            paginationContainer.style.borderTop = '1px solid #e4e7ed';

            // 上一页按钮
            const prevButton = document.createElement('button');
            prevButton.textContent = '上一页';
            prevButton.className = 'pagination-btn pagination-btn-nav';
            prevButton.disabled = currentLevel1Page === 1;
            prevButton.onclick = function () {
                if (currentLevel1Page > 1) {
                    currentLevel1Page--;
                    updateLevel1PointsDisplay();
                }
            };
            paginationContainer.appendChild(prevButton);

            // 智能页码生成
            const generatePageNumbers = (current, total) => {
                const pages = [];
                if (total <= 7) {
                    for (let i = 1; i <= total; i++) pages.push(i);
                } else {
                    pages.push(1);
                    let startPage = Math.max(2, current - 2);
                    let endPage = Math.min(total - 1, current + 2);

                    if (startPage > 2) pages.push('ellipsis-left');
                    for (let i = startPage; i <= endPage; i++) pages.push(i);
                    if (endPage < total - 1) pages.push('ellipsis-right');
                    pages.push(total);
                }
                return pages;
            };

            const pageNumbers = generatePageNumbers(currentLevel1Page, totalPages);
            pageNumbers.forEach(page => {
                if (page === 'ellipsis-left' || page === 'ellipsis-right') {
                    const ellipsis = document.createElement('span');
                    ellipsis.className = 'pagination-ellipsis';
                    ellipsis.textContent = '•••';
                    paginationContainer.appendChild(ellipsis);
                } else {
                    const pageButton = document.createElement('button');
                    pageButton.textContent = page;
                    pageButton.className = `pagination-btn ${page === currentLevel1Page ? 'active' : ''}`;
                    pageButton.onclick = function () {
                        currentLevel1Page = page;
                        updateLevel1PointsDisplay();
                    };
                    paginationContainer.appendChild(pageButton);
                }
            });

            // 下一页按钮
            const nextButton = document.createElement('button');
            nextButton.textContent = '下一页';
            nextButton.className = 'pagination-btn pagination-btn-nav';
            nextButton.disabled = currentLevel1Page === totalPages;
            nextButton.onclick = function () {
                if (currentLevel1Page < totalPages) {
                    currentLevel1Page++;
                    updateLevel1PointsDisplay();
                }
            };
            paginationContainer.appendChild(nextButton);
        } else {
            paginationContainer.style.display = 'none';
        }
    }
}

// 初始化一级测试点事件
function initLevel1PointClickEvents() {
    const level1ListItems = document.querySelectorAll('.level1-list-item');
    const panel = document.getElementById('test-points-floating-panel');

    let showPanelTimer = null;
    let hidePanelTimer = null;
    let currentPointId = null;

    level1ListItems.forEach(item => {
        item.addEventListener('click', function () {
            level1ListItems.forEach(otherItem => {
                otherItem.classList.remove('active');
            });
            this.classList.add('active');

            const pointId = this.getAttribute('data-point-id');
            const pointName = this.querySelector('.level1-name')?.textContent || '';
            if (pointId) {
                console.log('Selected level 1 point:', pointId, pointName);
                selectedLevel1PointId = pointId;
                selectedLevel1PointName = pointName;
                currentLibraryId = currentCaseLibraryId;
                currentModuleId = selectedModuleId;

                toggleFloatingPanel(pointId, this);
            }
        });

        item.addEventListener('mouseenter', function () {
            clearTimeout(showPanelTimer);
            clearTimeout(hidePanelTimer);

            const pointId = this.getAttribute('data-point-id');
            const pointName = this.querySelector('.level1-name')?.textContent || '';
            if (pointId) {
                currentPointId = pointId;

                showPanelTimer = setTimeout(() => {
                    selectedLevel1PointId = pointId;
                    selectedLevel1PointName = pointName;
                    currentLibraryId = currentCaseLibraryId;
                    currentModuleId = selectedModuleId;

                    showFloatingPanel(pointId, this);
                }, 200);
            }
        });

        item.addEventListener('mouseleave', function (event) {
            clearTimeout(showPanelTimer);

            if (panel && !panel.classList.contains('fixed')) {
                hidePanelTimer = setTimeout(() => {
                    let isMouseOverPanel = false;
                    try {
                        const elements = document.elementsFromPoint(event.clientX, event.clientY);
                        isMouseOverPanel = elements.some(el => el === panel || panel.contains(el));
                    } catch (error) {
                        console.error('检查鼠标位置错误:', error);
                        return;
                    }

                    if (!isMouseOverPanel) {
                        hideFloatingPanel();
                    }
                }, 300);
            }
        });
    });

    if (panel) {
        panel.addEventListener('mouseenter', function () {
            clearTimeout(showPanelTimer);
            clearTimeout(hidePanelTimer);
        });

        panel.addEventListener('mouseleave', function () {
            if (!this.classList.contains('fixed')) {
                hidePanelTimer = setTimeout(() => {
                    hideFloatingPanel();
                }, 200);
            }
        });

        panel.addEventListener('click', function (event) {
            if (!event.target.closest('.close-panel-btn') && !event.target.closest('.add-case-btn')) {
                if (!this.classList.contains('fixed')) {
                    this.classList.add('fixed');
                }
            }
        });
    }

    const caseListContent = document.querySelector('.case-list-content');
    if (caseListContent) {
        caseListContent.addEventListener('mouseleave', function (event) {
            if (panel && !panel.classList.contains('fixed')) {
                let isMouseOverPanel = false;
                try {
                    const elements = document.elementsFromPoint(event.clientX, event.clientY);
                    isMouseOverPanel = elements.some(el => el === panel || panel.contains(el));
                } catch (error) {
                    console.error('检查鼠标位置错误:', error);
                }

                if (!isMouseOverPanel) {
                    clearTimeout(hidePanelTimer);
                    hideFloatingPanel();
                }
            }
        });
    }
}

// 显示悬浮面板
async function showFloatingPanel(pointId, rowElement) {
    try {
        const panel = document.getElementById('test-points-floating-panel');
        const loading = document.getElementById('floating-panel-loading');
        const table = document.getElementById('test-points-table');
        const subtitle = document.getElementById('floating-panel-subtitle');

        if (!panel) return;

        panel.style.display = 'block';

        setTimeout(() => {
            panel.classList.add('show');
        }, 10);

        if (loading) loading.style.display = 'block';
        if (table) table.style.display = 'none';

        const testItems = await getLevel2TestPoints(pointId);

        if (subtitle) {
            subtitle.textContent = `共 ${testItems.length} 个测试点`;
        }

        updateFloatingPanelContent(testItems);

        if (loading) loading.style.display = 'none';
        if (table) table.style.display = 'table';

        // 初始化拖拽功能
        initFloatingPanelDrag();

    } catch (error) {
        console.error('显示悬浮面板错误:', error);
        const panel = document.getElementById('test-points-floating-panel');
        if (panel) {
            panel.classList.remove('show');
            setTimeout(() => {
                panel.style.display = 'none';
            }, 300);
        }
    }
}

// 隐藏悬浮面板
function hideFloatingPanel() {
    const panel = document.getElementById('test-points-floating-panel');
    if (panel) {
        panel.classList.remove('show');

        setTimeout(() => {
            panel.style.display = 'none';
            panel.classList.remove('fixed');
        }, 300);
    }
}

// 切换悬浮面板固定状态
async function toggleFloatingPanel(pointId, rowElement) {
    const panel = document.getElementById('test-points-floating-panel');
    if (!panel) return;

    if (panel.classList.contains('fixed')) {
        // 取消固定
        panel.classList.remove('fixed');
        hideFloatingPanel();
    } else {
        // 固定面板
        await showFloatingPanel(pointId, rowElement);
        panel.classList.add('fixed');
        // 固定时保持当前位置，避免位置突变导致页面滑动
        // 移除不必要的位置设置
    }
}

// 关闭悬浮面板
function closeFloatingPanel() {
    resetFloatingPanelPosition();
    hideFloatingPanel();
}

// 初始化浮动面板拖拽功能
function initFloatingPanelDrag() {
    const panel = document.getElementById('test-points-floating-panel');
    const header = panel?.querySelector('.floating-panel-header');
    
    if (!panel || !header) return;
    
    if (panel.dataset.dragInitialized === 'true') return;
    panel.dataset.dragInitialized = 'true';

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.close-panel-btn') || e.target.closest('.add-case-btn') || 
            e.target.closest('button') || e.target.closest('input')) return;
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        
        panel.style.right = 'auto';
        panel.style.left = startLeft + 'px';
        panel.style.top = startTop + 'px';
        
        document.body.classList.add('panel-dragging');
        
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        let newLeft = startLeft + deltaX;
        let newTop = startTop + deltaY;
        
        // 边界限制
        const maxLeft = window.innerWidth - panel.offsetWidth - 10;
        const maxTop = window.innerHeight - 100;
        
        newLeft = Math.max(10, Math.min(newLeft, maxLeft));
        newTop = Math.max(10, Math.min(newTop, maxTop));
        
        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.classList.remove('panel-dragging');
        }
    });
}

// 重置浮动面板位置
function resetFloatingPanelPosition() {
    const panel = document.getElementById('test-points-floating-panel');
    if (panel) {
        panel.style.left = '';
        panel.style.top = '';
        panel.style.right = '';
    }
}

// 刷新测试用例列表（搜索时调用）
async function refreshTestCasesList() {
    if (!selectedLevel1PointId) {
        console.log('没有选中的一级测试点，无法刷新');
        return;
    }

    try {
        const panel = document.getElementById('test-points-floating-panel');
        const loading = document.getElementById('floating-panel-loading');
        const table = document.getElementById('test-points-table');
        const subtitle = document.getElementById('floating-panel-subtitle');

        if (!panel) return;

        // 显示加载状态
        if (loading) loading.style.display = 'block';
        if (table) table.style.display = 'none';

        // 重新获取测试用例数据
        const testItems = await getLevel2TestPoints(selectedLevel1PointId);

        // 更新副标题
        if (subtitle) {
            subtitle.textContent = `共 ${testItems.length} 个测试点`;
        }

        // 更新列表内容
        updateFloatingPanelContent(testItems);

        // 隐藏加载状态
        if (loading) loading.style.display = 'none';
        if (table) table.style.display = 'table';

    } catch (error) {
        console.error('刷新测试用例列表错误:', error);
    }
}

// 获取匹配的测试用例数据
async function getLevel2TestPoints(level1Id) {
    try {
        // 验证必要的ID
        console.log('getLevel2TestPoints called with:', { level1Id, currentLibraryId, currentModuleId });

        let moduleId = currentModuleId;
        let libraryId = currentLibraryId;

        // 如果缺少libraryId，尝试使用currentCaseLibraryId
        if (!libraryId) {
            libraryId = currentCaseLibraryId;
        }

        // 如果缺少moduleId，尝试从本地缓存中获取对应测试点的模块ID
        if (!moduleId && level1Id) {
            console.log('尝试从本地缓存获取测试点的模块ID，level1Id:', level1Id);

            // 打印当前level1Points数组的内容，检查数据结构
            console.log('当前level1Points数组长度:', level1Points.length);
            if (level1Points.length > 0) {
                console.log('第一个测试点数据:', level1Points[0]);
            }

            try {
                // 从本地缓存获取一级测试点数据
                const cachedPointsJson = localStorage.getItem('level1Points');
                console.log('本地缓存中的level1Points:', cachedPointsJson);
                const cachedPoints = JSON.parse(cachedPointsJson || '[]');

                console.log('解析后的本地缓存数据长度:', cachedPoints.length);
                if (cachedPoints.length > 0) {
                    console.log('本地缓存中第一个测试点数据:', cachedPoints[0]);
                }

                // 查找测试点，处理ID类型不匹配的情况
                const targetPoint = cachedPoints.find(point =>
                    String(point.id) === String(level1Id)
                );

                if (targetPoint) {
                    console.log('找到的测试点数据:', targetPoint);
                    if (targetPoint.module_id) {
                        moduleId = targetPoint.module_id;
                        console.log('从本地缓存获取到模块ID:', moduleId);
                    } else {
                        console.error('测试点数据中没有module_id字段:', targetPoint);
                    }
                } else {
                    // 尝试从当前level1Points数组中查找，同样处理ID类型不匹配
                    const currentPoint = level1Points.find(point =>
                        String(point.id) === String(level1Id)
                    );

                    if (currentPoint) {
                        console.log('从当前数据数组找到的测试点:', currentPoint);
                        if (currentPoint.module_id) {
                            moduleId = currentPoint.module_id;
                            console.log('从当前数据数组获取到模块ID:', moduleId);
                        } else {
                            console.error('当前数据数组中的测试点没有module_id字段:', currentPoint);
                        }
                    } else {
                        // 尝试遍历查找，打印更多信息
                        console.log('遍历所有当前测试点查找:', level1Id);
                        level1Points.forEach((point, index) => {
                            console.log(`测试点${index}: id=${point.id}, type=${typeof point.id}, level1Id=${level1Id}, type=${typeof level1Id}, match=${String(point.id) === String(level1Id)}`);
                        });

                        console.error('无法获取测试点的模块ID，测试点不在缓存或当前数据中');
                        return [];
                    }
                }
            } catch (cacheError) {
                console.error('读取本地缓存失败:', cacheError);
                return [];
            }
        }

        if (!libraryId || !moduleId || !level1Id) {
            console.error('仍然缺少必要的ID信息:', { libraryId, moduleId, level1Id });
            return [];
        }

        // API调用逻辑 - 调用新的匹配测试用例端点，添加搜索关键词参数
        let url = `/cases/match/${libraryId}/${moduleId}/${level1Id}`;
        if (testCaseSearchKeyword) {
            url += `?keyword=${encodeURIComponent(testCaseSearchKeyword)}`;
        }

        const pointsData = await apiRequest(url, { useCache: false });

        console.log('API返回的测试用例数据:', pointsData);

        if (pointsData && pointsData.success && pointsData.testCases) {
            console.log('获取到匹配的测试用例:', pointsData.testCases);
            return pointsData.testCases;
        } else if (Array.isArray(pointsData)) {
            console.log('获取到匹配的测试用例数组:', pointsData);
            return pointsData;
        } else {
            // 加载失败时使用空数据
            console.log('API调用失败，使用空数据');
            return [];
        }
    } catch (error) {
        console.error('获取匹配测试用例错误:', error);
        return [];
    }
}

// 更新悬浮面板内容
function updateFloatingPanelContent(testItems) {
    const testPointsBody = document.getElementById('test-points-body');
    if (!testPointsBody) return;

    if (testItems.length === 0) {
        testPointsBody.innerHTML = `
            <tr>
                <td colspan="7" class="no-data">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px;">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5">
                            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                        </svg>
                        <span style="color: #94a3b8; font-size: 13px;">暂无测试点数据</span>
                    </div>
                </td>
            </tr>
        `;
    } else {
        testPointsBody.innerHTML = testItems.map((item, index) => {
            const testType = item.test_method || item.type || '功能测试';
            const typeClass = testType.includes('性能') ? 'performance' :
                testType.includes('兼容') ? 'compatibility' :
                    testType.includes('安全') ? 'security' : 'functional';

            return `
                <tr class="test-case-row" data-case-id="${item.id}" style="cursor: pointer;">
                    <td style="font-weight: 500; color: #64748b;">${index + 1}</td>
                    <td style="font-weight: 500; color: #1e293b;">${item.name || '-'}</td>
                    <td style="color: #64748b; font-size: 12px;">${item.purpose || '-'}</td>
                    <td style="color: #64748b;">${item.owner || item.creator || '-'}</td>
                    <td>
                        <span class="level1-type-badge ${typeClass}" style="font-size: 10px; padding: 3px 8px;">
                            ${testType}
                        </span>
                    </td>
                    <td style="color: #64748b; font-size: 12px;">${item.test_environment || '-'}</td>
                    <td style="color: #94a3b8; font-size: 12px;">${formatDateTime(item.updatedAt || item.updated_at || item.createdAt || item.created_at || '')}</td>
                </tr>
            `;
        }).join('');

        const testCaseRows = testPointsBody.querySelectorAll('.test-case-row');
        testCaseRows.forEach(row => {
            row.addEventListener('click', () => {
                const caseId = parseInt(row.dataset.caseId);
                const testCase = testItems.find(item => item.id === caseId);
                if (testCase) {
                    openTestCaseDetailModal(testCase);
                }
            });
        });
    }
}

// 清空一级测试点显示
function clearLevel1PointsDisplay() {
    const caseListBody = document.getElementById('case-list-body');
    if (!caseListBody) return;

    caseListBody.innerHTML = `
        <tr>
            <td colspan="5" class="no-data">请选择左侧功能模块</td>
        </tr>
    `;

    // 隐藏分页控件
    const paginationContainer = document.getElementById('level1-pagination');
    if (paginationContainer) {
        paginationContainer.style.display = 'none';
    }
}

// ========================================
// 标签选择器组件
// ========================================

const TagSelector = {
    // 初始化标签选择器
    init: function (containerId, options, selectedValues = [], onChange = null) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const tagsContainer = container.querySelector('.tag-selector-tags');
        const dropdown = container.querySelector('.tag-selector-dropdown');

        // 存储数据
        container._options = options;
        container._selectedValues = [...selectedValues];
        container._onChange = onChange;

        // 渲染已选标签
        this.renderTags(container);

        // 渲染下拉选项
        this.renderDropdown(container);

        // 绑定点击事件 - 使用标识位防止重复绑定
        if (!container.dataset.eventBound) {
            tagsContainer.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove-tag')) {
                    const value = e.target.parentElement.dataset.value;
                    this.removeValue(container, value);
                } else {
                    this.toggleDropdown(container);
                }
            });
            // 设置标识位，确保只绑定一次
            container.dataset.eventBound = 'true';
        }
    },

    // 渲染已选标签
    renderTags: function (container) {
        const tagsContainer = container.querySelector('.tag-selector-tags');
        const selectedValues = container._selectedValues || [];

        if (selectedValues.length === 0) {
            tagsContainer.innerHTML = '<span class="tag-selector-placeholder">点击选择...</span>';
        } else {
            tagsContainer.innerHTML = selectedValues.map(value => {
                const option = container._options.find(opt => opt.value === value);
                return `
                    <span class="tag-selector-tag" data-value="${value}">
                        ${option ? option.label : value}
                        <span class="remove-tag">×</span>
                    </span>
                `;
            }).join('');
        }
    },

    // 渲染下拉选项
    renderDropdown: function (container) {
        const dropdown = container.querySelector('.tag-selector-dropdown');
        const options = container._options || [];
        const selectedValues = container._selectedValues || [];

        dropdown.innerHTML = options.map(option => {
            const isSelected = selectedValues.includes(option.value);
            return `
                <div class="tag-selector-option ${isSelected ? 'selected' : ''}" data-value="${option.value}">
                    <span class="checkbox"></span>
                    <span>${option.label}</span>
                </div>
            `;
        }).join('');

        // 绑定选项点击事件
        dropdown.querySelectorAll('.tag-selector-option').forEach(optionEl => {
            optionEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = optionEl.dataset.value;
                this.toggleValue(container, value);
            });
        });
    },

    // 切换下拉框显示
    toggleDropdown: function (container) {
        const dropdown = container.querySelector('.tag-selector-dropdown');
        const tagsContainer = container.querySelector('.tag-selector-tags');
        const isShowing = dropdown.classList.contains('show');

        if (!isShowing) {
            // 计算位置
            const rect = tagsContainer.getBoundingClientRect();
            dropdown.style.top = `${rect.bottom + 4}px`;
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.width = `${rect.width}px`;
            dropdown.classList.add('show');
        } else {
            dropdown.classList.remove('show');
        }

        // 点击外部关闭
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

    // 切换值
    toggleValue: function (container, value) {
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

        // 触发回调
        if (container._onChange) {
            container._onChange(selectedValues);
        }
    },

    // 移除值
    removeValue: function (container, value) {
        const selectedValues = container._selectedValues || [];
        const index = selectedValues.indexOf(value);

        if (index > -1) {
            selectedValues.splice(index, 1);
            container._selectedValues = selectedValues;
            this.renderTags(container);
            this.renderDropdown(container);

            // 触发回调
            if (container._onChange) {
                container._onChange(selectedValues);
            }
        }
    },

    // 获取选中值
    getValues: function (containerId) {
        const container = document.getElementById(containerId);
        return container ? (container._selectedValues || []) : [];
    },

    // 设置选中值
    setValues: function (containerId, values) {
        const container = document.getElementById(containerId);
        if (container) {
            container._selectedValues = [...values];
            this.renderTags(container);
            this.renderDropdown(container);
        }
    }
};

// 标签页切换功能
function initCaseDetailTabs() {
    const tabs = document.querySelectorAll('.case-tab');
    const contents = document.querySelectorAll('.case-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // 更新标签状态
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 更新内容显示
            contents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `tab-${targetTab}`) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// 打开测试用例详情编辑模态框
async function openTestCaseDetailModal(testCase) {
    // 保存当前测试用例数据，用于取消操作时恢复
    window.currentEditingTestCase = testCase;
    currentEditingTestCaseId = testCase.id;

    // 更新头部信息
    document.getElementById('detail-case-id-display').textContent = testCase.caseId || testCase.case_id || 'CASE-0000';
    document.getElementById('detail-case-title').textContent = testCase.name || '测试用例名称';
    document.getElementById('detail-creator-display').textContent = testCase.creator || 'admin';
    document.getElementById('detail-created-at-display').textContent = formatDateTime(testCase.createdAt || testCase.created_at || '');
    document.getElementById('detail-owner-display').textContent = testCase.owner || testCase.creator || 'admin';

    // 更新优先级徽章
    const priorityBadge = document.getElementById('detail-priority-badge');
    priorityBadge.className = 'case-priority-badge';
    const priority = testCase.priority || '中';
    if (priority === '高' || priority === 'high' || priority === 'P0' || priority === 'P1') {
        priorityBadge.classList.add('priority-high');
        priorityBadge.textContent = priority === 'P0' ? 'P0 阻塞级' : priority === 'P1' ? 'P1 严重级' : '高优先级';
    } else if (priority === '低' || priority === 'low' || priority === 'P3' || priority === 'P4') {
        priorityBadge.classList.add('priority-low');
        priorityBadge.textContent = priority === 'P3' ? 'P3 一般级' : priority === 'P4' ? 'P4 建议级' : '低优先级';
    } else {
        priorityBadge.classList.add('priority-medium');
        priorityBadge.textContent = priority === 'P2' ? 'P2 次要级' : '中优先级';
    }

    // 填充表单数据
    document.getElementById('detail-case-name').value = testCase.name || '';
    document.getElementById('detail-case-id').value = testCase.caseId || testCase.case_id || '';
    document.getElementById('detail-case-priority').value = priority;
    document.getElementById('detail-case-owner').value = testCase.owner || testCase.creator || '';
    document.getElementById('detail-case-precondition').value = testCase.precondition || '';
    document.getElementById('detail-case-purpose').value = testCase.purpose || '';
    document.getElementById('detail-case-steps').value = testCase.test_steps || testCase.steps || '';
    document.getElementById('detail-case-expected').value = testCase.expected_behavior || testCase.expected || '';
    document.getElementById('detail-case-key-config').value = testCase.key_config || '';
    document.getElementById('detail-case-remark').value = testCase.remark || '';
    document.getElementById('detail-case-creator').value = testCase.creator || '';
    document.getElementById('detail-case-created-at').value = formatDateTime(testCase.createdAt || testCase.created_at || '');
    document.getElementById('detail-case-updated-at').value = formatDateTime(testCase.updatedAt || testCase.updated_at || '');

    // 设置模块ID和一级测试点ID（用于保存时使用）
    selectedModuleId = testCase.module_id || testCase.moduleId || null;
    selectedLevel1PointId = testCase.level1_id || testCase.level1Id || null;
    currentCaseLibraryId = testCase.library_id || testCase.libraryId || null;

    // 加载优先级
    await loadPrioritiesForDetail(testCase.priority);

    // 加载测试类型
    await loadTestTypesForDetail(testCase.type || '');

    // 加载测试阶段
    await loadPhasesForDetail(testCase.test_phase || '');

    // 加载测试环境
    await loadEnvironmentsForDetail(testCase.test_environment || '');

    // 加载测试方式
    await loadMethodsForDetail(testCase.test_method || testCase.type);

    // 加载测试点来源
    await loadSourcesForDetail(testCase.test_source || '');

    // 加载关联项目
    await loadTestCaseProjects(testCase.id);

    // 初始化标签页
    initCaseDetailTabs();

    // 重置到第一个标签页
    document.querySelectorAll('.case-tab').forEach((tab, index) => {
        if (index === 0) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    document.querySelectorAll('.case-tab-content').forEach((content, index) => {
        if (index === 0) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    // 初始化执行记录
    initExecutionRecords(testCase.id);

    // 显示模态框
    const modal = document.getElementById('test-case-detail-modal');
    modal.style.display = 'block';
}

// 加载测试环境用于测试用例详情
async function loadEnvironmentsForDetail(testEnvironment) {
    try {
        // 调用API加载环境
        const environmentsData = await apiRequest('/environments/list');

        let environmentList = [];
        if (environmentsData.success && environmentsData.environments) {
            environmentList = environmentsData.environments;
        } else if (Array.isArray(environmentsData)) {
            environmentList = environmentsData;
        }

        // 解析测试用例的测试环境（可能是逗号分隔的字符串）
        const selectedEnvNames = typeof testEnvironment === 'string'
            ? testEnvironment.split(',').map(env => env.trim()).filter(env => env)
            : [];

        // 转换为选项格式（value使用ID，label使用名称）
        const options = environmentList.map(env => ({
            value: String(env.id || env.env_id),
            label: env.name
        }));

        // 根据名称找到对应的ID
        const selectedEnvIds = selectedEnvNames.map(name => {
            const env = environmentList.find(e => e.name === name);
            return env ? String(env.id || env.env_id) : null;
        }).filter(id => id !== null);

        // 初始化标签选择器
        TagSelector.init(
            'detail-case-environments-selector',
            options,
            selectedEnvIds,
            (values) => {
                // 更新隐藏的select元素
                const hiddenSelect = document.getElementById('detail-case-environments');
                if (hiddenSelect) {
                    hiddenSelect.innerHTML = values.map(v => `<option value="${v}" selected>${v}</option>`).join('');
                }
            }
        );

    } catch (error) {
        console.error('加载测试环境失败:', error);
    }
}

// 加载测试点来源用于测试用例详情
async function loadSourcesForDetail(testSources) {
    try {
        const sourcesData = await apiRequest('/test-sources/list');

        let sourceList = [];
        if (sourcesData.success && sourcesData.sources) {
            sourceList = sourcesData.sources;
        }

        const selectedSourceNames = typeof testSources === 'string'
            ? testSources.split(',').map(source => source.trim()).filter(source => source)
            : [];

        const options = sourceList.map(source => ({
            value: String(source.id),
            label: source.name
        }));

        const selectedSourceIds = selectedSourceNames.map(name => {
            const source = sourceList.find(s => s.name === name);
            return source ? String(source.id) : null;
        }).filter(id => id !== null);

        TagSelector.init(
            'detail-case-sources-selector',
            options,
            selectedSourceIds,
            (values) => {
                const hiddenSelect = document.getElementById('detail-case-sources');
                if (hiddenSelect) {
                    hiddenSelect.innerHTML = values.map(v => `<option value="${v}" selected>${v}</option>`).join('');
                }
            }
        );

    } catch (error) {
        console.error('加载测试点来源失败:', error);
    }
}

// 加载测试阶段用于测试用例详情
async function loadPhasesForDetail(testPhases) {
    try {
        // 调用API加载测试阶段
        const phasesData = await apiRequest('/test-phases/list');

        let phaseList = [];
        if (phasesData.success && phasesData.testPhases) {
            phaseList = phasesData.testPhases;
        }

        // 解析测试用例的测试阶段（可能是逗号分隔的字符串）
        const selectedPhaseNames = typeof testPhases === 'string'
            ? testPhases.split(',').map(phase => phase.trim()).filter(phase => phase)
            : [];

        // 转换为选项格式（value使用ID，label使用名称）
        const options = phaseList.map(phase => ({
            value: String(phase.id),
            label: phase.name
        }));

        // 根据名称找到对应的ID
        const selectedPhaseIds = selectedPhaseNames.map(name => {
            const phase = phaseList.find(p => p.name === name);
            return phase ? String(phase.id) : null;
        }).filter(id => id !== null);

        // 初始化标签选择器
        TagSelector.init(
            'detail-case-phases-selector',
            options,
            selectedPhaseIds,
            (values) => {
                // 更新隐藏的select元素
                const hiddenSelect = document.getElementById('detail-case-phases');
                if (hiddenSelect) {
                    hiddenSelect.innerHTML = values.map(v => `<option value="${v}" selected>${v}</option>`).join('');
                }
            }
        );

    } catch (error) {
        console.error('加载测试阶段失败:', error);
    }
}

// 加载测试方式用于测试用例详情
async function loadMethodsForDetail(testMethod) {
    try {
        // 调用API加载测试方式
        const methodsData = await apiRequest('/test-methods/list');

        let methodList = [];
        if (methodsData.success && methodsData.testMethods) {
            methodList = methodsData.testMethods;
        } else if (Array.isArray(methodsData)) {
            methodList = methodsData;
        }

        // 解析测试用例的测试方式
        const selectedMethodNames = typeof testMethod === 'string'
            ? testMethod.split(',').map(val => val.trim()).filter(val => val)
            : [];

        // 转换为选项格式（value使用ID，label使用名称）
        const options = methodList.map(method => ({
            value: String(method.id || method.method_id),
            label: method.name
        }));

        // 根据名称找到对应的ID
        const selectedMethodIds = selectedMethodNames.map(name => {
            const method = methodList.find(m => m.name === name);
            return method ? String(method.id || method.method_id) : null;
        }).filter(id => id !== null);

        // 初始化标签选择器
        TagSelector.init(
            'detail-case-methods-selector',
            options,
            selectedMethodIds,
            (values) => {
                // 更新隐藏的select元素
                const hiddenSelect = document.getElementById('detail-case-methods');
                if (hiddenSelect) {
                    hiddenSelect.innerHTML = values.map(v => `<option value="${v}" selected>${v}</option>`).join('');
                }
            }
        );

    } catch (error) {
        console.error('加载测试方式失败:', error);
    }
}

// 加载优先级用于测试用例详情
async function loadPrioritiesForDetail(selectedPriority) {
    try {
        const prioritiesData = await apiRequest('/priorities/list');

        let priorityList = [];
        if (prioritiesData.success && prioritiesData.priorities) {
            priorityList = prioritiesData.priorities;
        } else if (Array.isArray(prioritiesData)) {
            priorityList = prioritiesData;
        }

        const prioritySelect = document.getElementById('detail-case-priority');
        if (!prioritySelect) {
            console.error('找不到优先级下拉框元素');
            return;
        }

        prioritySelect.innerHTML = '<option value="">请选择优先级</option>';

        priorityList.forEach(priority => {
            const option = document.createElement('option');
            option.value = priority.name;
            option.textContent = priority.name;
            if (priority.description) {
                option.textContent += ` - ${priority.description}`;
            }
            if (priority.name === selectedPriority) {
                option.selected = true;
            }
            prioritySelect.appendChild(option);
        });

        if (!selectedPriority && priorityList.length > 0) {
            prioritySelect.value = priorityList[0].name;
        }

    } catch (error) {
        console.error('加载优先级失败:', error);
        const prioritySelect = document.getElementById('detail-case-priority');
        if (prioritySelect) {
            prioritySelect.innerHTML = `
                <option value="P0" ${selectedPriority === 'P0' ? 'selected' : ''}>P0 - 阻塞级</option>
                <option value="P1" ${selectedPriority === 'P1' ? 'selected' : ''}>P1 - 严重级</option>
                <option value="P2" ${selectedPriority === 'P2' ? 'selected' : ''}>P2 - 一般级</option>
                <option value="P3" ${selectedPriority === 'P3' ? 'selected' : ''}>P3 - 提示级</option>
            `;
        }
    }
}

// 加载测试类型用于测试用例详情
async function loadTestTypesForDetail(selectedType) {
    try {
        const testTypesData = await apiRequest('/test-types/list');

        let testTypeList = [];
        if (testTypesData.success && testTypesData.testTypes) {
            testTypeList = testTypesData.testTypes;
        } else if (Array.isArray(testTypesData)) {
            testTypeList = testTypesData;
        }

        const typeSelect = document.getElementById('detail-case-type');
        if (!typeSelect) {
            console.error('找不到测试类型下拉框元素');
            return;
        }

        typeSelect.innerHTML = '<option value="">请选择测试类型</option>';

        testTypeList.forEach(type => {
            const option = document.createElement('option');
            option.value = type.name;
            option.textContent = type.name;
            if (type.name === selectedType) {
                option.selected = true;
            }
            typeSelect.appendChild(option);
        });

        if (!selectedType && testTypeList.length > 0) {
            typeSelect.value = testTypeList[0].name;
        }

    } catch (error) {
        console.error('加载测试类型失败:', error);
        const typeSelect = document.getElementById('detail-case-type');
        if (typeSelect) {
            typeSelect.innerHTML = `
                <option value="功能测试" ${selectedType === '功能测试' ? 'selected' : ''}>功能测试</option>
                <option value="性能测试" ${selectedType === '性能测试' ? 'selected' : ''}>性能测试</option>
                <option value="安全测试" ${selectedType === '安全测试' ? 'selected' : ''}>安全测试</option>
                <option value="兼容性测试" ${selectedType === '兼容性测试' ? 'selected' : ''}>兼容性测试</option>
            `;
        }
    }
}

// 加载测试用例的关联项目
// 获取测试用例关联的项目详情
async function getTestCaseProjectDetails(testCaseId) {
    try {
        console.log('getTestCaseProjectDetails 被调用，testCaseId:', testCaseId);
        const endpoint = `/testcases/${testCaseId}/projects`;
        console.log('调用API端点:', endpoint);

        const data = await apiRequest(endpoint, { useCache: false });
        console.log('getTestCaseProjectDetails API返回:', JSON.stringify(data, null, 2));

        let projects = [];

        // 首先检查最直接的格式：服务器返回的 { success: true, projects: [...] }
        if (data.success && Array.isArray(data.projects)) {
            projects = data.projects;
        }
        // 检查嵌套格式：{ status: 200, data: { success: true, projects: [...] }, success: true }
        else if (data.success && data.data && data.data.success && Array.isArray(data.data.projects)) {
            projects = data.data.projects;
        }
        // 检查嵌套格式：{ data: { success: true, projects: [...] } }
        else if (data.data && data.data.success && Array.isArray(data.data.projects)) {
            projects = data.data.projects;
        }
        // 检查直接返回数组的情况
        else if (Array.isArray(data)) {
            projects = data;
        }
        // 检查格式：{ success: true, data: [...] }
        else if (data.success && Array.isArray(data.data)) {
            projects = data.data;
        }
        // 检查格式：{ data: [...] }
        else if (Array.isArray(data.data)) {
            projects = data.data;
        }

        console.log('解析后的关联项目:', JSON.stringify(projects, null, 2));
        return projects;
    } catch (error) {
        console.error('获取测试用例项目详情失败:', error);
        console.error('错误堆栈:', error.stack);
        return [];
    }
}

async function loadTestCaseProjects(testCaseId) {
    try {
        console.log('[loadTestCaseProjects] 开始加载，testCaseId:', testCaseId);
        const container = document.getElementById('detail-case-projects-list');

        if (!container) {
            console.log('[loadTestCaseProjects] 关联项目容器不存在，跳过加载');
            return;
        }

        console.log('[loadTestCaseProjects] 找到容器，开始加载数据...');

        container.innerHTML = `
            <div class="pa-loading">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                </svg>
                <span>加载项目中...</span>
            </div>
        `;

        let associatedProjects = [];

        try {
            associatedProjects = await getTestCaseProjectDetails(testCaseId);
            console.log('[loadTestCaseProjects] 获取到的关联项目:', associatedProjects);
            console.log('[loadTestCaseProjects] 关联项目数量:', associatedProjects ? associatedProjects.length : 0);
        } catch (error) {
            console.error('[loadTestCaseProjects] 获取关联项目详情错误:', error);
        }

        console.log('[loadTestCaseProjects] 检查条件: associatedProjects=', associatedProjects, 'length=', associatedProjects ? associatedProjects.length : 'null');

        if (!associatedProjects || associatedProjects.length === 0) {
            console.log('[loadTestCaseProjects] 条件为真，显示"暂无关联项目"');
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <p>暂无关联项目</p>
                    <button type="button" onclick="openEditTestCaseProjectAssociationsModal()" class="btn btn-sm btn-primary">添加关联</button>
                </div>
            `;
            return;
        }

        console.log('[loadTestCaseProjects] 条件为假，开始渲染项目列表...');

        let projectsHtml = '';
        associatedProjects.forEach(project => {
            let statusClass = 'status-pending';
            let statusText = project.status_name || '待开始';
            if (statusText.includes('完成') || statusText.includes('通过')) {
                statusClass = 'status-completed';
            } else if (statusText.includes('进行') || statusText.includes('测试中')) {
                statusClass = 'status-active';
            }

            projectsHtml += `
                <div class="case-project-item">
                    <div class="case-project-info">
                        <div class="case-project-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                        </div>
                        <div>
                            <div class="case-project-name">${project.name || '未命名项目'}</div>
                            <div class="case-project-status">
                                <span class="pa-card-status ${statusClass}" style="padding: 2px 6px; font-size: 11px;">${statusText}</span>
                                <span style="margin-left: 8px; color: #64748b; font-size: 12px;">${project.progress_name || '未设置进度'}</span>
                            </div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 13px; color: #1e293b;">${project.owner || '未设置负责人'}</div>
                        <div style="font-size: 12px; color: #94a3b8;">${project.remark || '无备注'}</div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = projectsHtml;
    } catch (error) {
        console.error('加载测试用例项目关联失败:', error);
        const container = document.getElementById('detail-case-projects-list');

        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 8v4"></path>
                        <path d="M12 16h.01"></path>
                    </svg>
                    <p>加载项目失败</p>
                    <button type="button" onclick="loadTestCaseProjects('${testCaseId}')" class="btn btn-sm btn-secondary">重试</button>
                </div>
            `;
        }
    }
}

// 全选项目（注释掉，因为已经移除了复选框）
function selectAllProjects() {
    try {
        console.log('全选项目功能已禁用，因为已移除复选框');
        /*
        const container = document.getElementById('detail-case-projects-container');
        if (container) {
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
            });
        }
        */
    } catch (error) {
        console.error('全选项目出错:', error);
    }
}

// 取消全选项目（注释掉，因为已经移除了复选框）
function deselectAllProjects() {
    try {
        console.log('取消全选项目功能已禁用，因为已移除复选框');
        /*
        const container = document.getElementById('detail-case-projects-container');
        if (container) {
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        }
        */
    } catch (error) {
        console.error('取消全选项目出错:', error);
    }
}

// 关闭测试用例详情编辑模态框
function closeTestCaseDetailModal() {
    const modal = document.getElementById('test-case-detail-modal');
    modal.style.display = 'none';

    // 清空当前编辑的测试用例
    window.currentEditingTestCase = null;

    // 清空detail-case-id输入框的值，确保下次打开时不会保留旧值
    const caseIdInput = document.getElementById('detail-case-id');
    if (caseIdInput) {
        caseIdInput.value = '';
        console.log('已清空detail-case-id输入框的值');
    }
}

// ==================== 执行记录功能 ====================

// 当前用例ID（用于执行记录）
let currentExecutionCaseId = null;

// 获取当前用户名
function getCurrentUsername() {
    return window.currentUser?.username || 'admin';
}

// 格式化日期时间
function formatDateTimeLocal(date) {
    const d = date || new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// 切换执行记录表单显示
function toggleExecutionRecordForm() {
    const form = document.getElementById('execution-record-form');
    if (form) {
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) {
            resetExecutionRecordForm();
        }
    }
}

// 重置执行记录表单
function resetExecutionRecordForm() {
    const radios = document.querySelectorAll('input[name="record-type"]');
    radios.forEach(radio => radio.checked = false);

    const bugIdInput = document.getElementById('record-bug-id');
    if (bugIdInput) {
        bugIdInput.value = '';
    }

    const descInput = document.getElementById('record-description');
    if (descInput) {
        descInput.value = '';
    }

    const bugIdRow = document.getElementById('bug-id-row');
    if (bugIdRow) {
        bugIdRow.style.display = 'none';
    }

    // 重置图片上传状态
    pendingRecordImages = [];
    renderRecordImagePreviews();
}

// 取消执行记录表单
function cancelExecutionRecordForm() {
    const form = document.getElementById('execution-record-form');
    if (form) {
        form.classList.add('hidden');
        resetExecutionRecordForm();
    }
}

// 处理记录类型变化
async function handleRecordTypeChange() {
    const selectedType = document.querySelector('input[name="record-type"]:checked');
    const bugIdRow = document.getElementById('bug-id-row');

    if (selectedType && selectedType.value === 'defect') {
        bugIdRow.style.display = 'block';
        // 加载 Bug 类型选项
        await loadBugTypeOptions();
    } else {
        bugIdRow.style.display = 'none';
        const bugIdInput = document.getElementById('record-bug-id');
        if (bugIdInput) {
            bugIdInput.value = '';
        }
        const bugTypeSelect = document.getElementById('record-bug-type');
        if (bugTypeSelect) {
            bugTypeSelect.value = '';
        }
    }
}

// 加载 Bug 类型选项
async function loadBugTypeOptions() {
    const bugTypeSelect = document.getElementById('record-bug-type');
    if (!bugTypeSelect) return;
    
    try {
        const response = await apiRequest('/hyperlink-configs/list');
        if (response.success && response.configs) {
            bugTypeSelect.innerHTML = '<option value="">选择类型</option>';
            response.configs.forEach(config => {
                const option = document.createElement('option');
                option.value = config.name;
                option.textContent = config.name;
                option.dataset.prefix = config.prefix;
                bugTypeSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('加载Bug类型选项失败:', error);
    }
}

// 提交执行记录
async function submitExecutionRecord() {
    const selectedType = document.querySelector('input[name="record-type"]:checked');

    // 校验记录类型
    if (!selectedType) {
        showErrorMessage('请选择记录类型');
        return;
    }

    const recordType = selectedType.value;
    const bugIdInput = document.getElementById('record-bug-id');
    const descInput = document.getElementById('record-description');

    // 如果是缺陷类型，校验Bug ID
    if (recordType === 'defect') {
        const bugId = bugIdInput ? bugIdInput.value.trim() : '';
        if (!bugId) {
            showErrorMessage('请输入Bug ID');
            return;
        }
    }

    // 检查是否有当前用例ID
    if (!currentExecutionCaseId) {
        showErrorMessage('无法获取测试用例ID，请重新打开详情页');
        return;
    }

    // 收集数据
    const images = pendingRecordImages
        .filter(img => img.status === 'done' && img.url)
        .map(img => ({ url: img.url, name: img.name }));

    // 获取 Bug 类型
    const bugTypeSelect = document.getElementById('record-bug-type');
    const bugType = bugTypeSelect ? bugTypeSelect.value : '';

    const recordData = {
        caseId: currentExecutionCaseId,
        type: recordType,
        bugId: recordType === 'defect' ? (bugIdInput ? bugIdInput.value.trim() : '') : null,
        bugType: recordType === 'defect' ? bugType : null,
        description: descInput ? descInput.value.trim() : '',
        images: images
    };

    try {
        showLoading('添加执行记录中...');

        // 调用后端API保存记录
        const response = await apiRequest('/testpoints/execution-records', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(recordData)
        });

        hideLoading();

        if (response.success) {
            // 重新加载执行记录列表
            await loadExecutionRecords(currentExecutionCaseId);

            // 隐藏表单并重置
            cancelExecutionRecordForm();

            // 发布事件：执行记录变更
            DataEventManager.emit(DataEvents.EXECUTION_RECORD_CHANGED, { 
                action: 'add', 
                caseId: currentExecutionCaseId 
            });

            // 显示成功提示
            showSuccessMessage('执行记录添加成功');
        } else {
            showErrorMessage(response.message || '添加失败');
        }
    } catch (error) {
        hideLoading();
        console.error('添加执行记录错误:', error);
        showErrorMessage('添加执行记录失败: ' + error.message);
    }
}

// 加载执行记录
async function loadExecutionRecords(caseId) {
    try {
        const response = await apiRequest(`/testpoints/execution-records/${caseId}`, { useCache: false });

        if (response.success && response.records) {
            // 保存到全局变量，供编辑时使用
            window.currentExecutionRecords = response.records;
            renderExecutionRecords(response.records);
        } else {
            window.currentExecutionRecords = [];
            renderExecutionRecords([]);
        }
    } catch (error) {
        console.error('加载执行记录错误:', error);
        window.currentExecutionRecords = [];
        renderExecutionRecords([]);
    }
}

// 渲染执行记录列表
async function renderExecutionRecords(records) {
    const timeline = document.getElementById('execution-records-timeline');
    const emptyState = document.getElementById('execution-records-empty');

    if (!timeline) return;

    // 控制空状态显示
    if (emptyState) {
        emptyState.style.display = records.length === 0 ? 'flex' : 'none';
    }

    // 渲染时间轴
    if (records.length === 0) {
        timeline.innerHTML = '';
        return;
    }

    // 加载超链接配置
    let hyperlinkConfigs = [];
    try {
        const response = await apiRequest('/hyperlink-configs/list');
        if (response.success && response.configs) {
            hyperlinkConfigs = response.configs;
        }
    } catch (error) {
        console.error('加载超链接配置失败:', error);
    }

    timeline.innerHTML = records.map(record => {
        const isDefect = record.type === 'defect';
        const typeLabel = isDefect ? '缺陷' : '其他';
        const typeClass = isDefect ? 'defect' : 'other';

        const typeIcon = isDefect
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

        // 生成 Bug ID 链接
        let bugIdHtml = '';
        if (record.bugId) {
            let bugUrl = record.bugId;
            const bugType = record.bugType || '';
            
            // 查找对应的超链接配置
            if (bugType && hyperlinkConfigs.length > 0) {
                const config = hyperlinkConfigs.find(c => c.name === bugType);
                if (config && config.prefix) {
                    bugUrl = config.prefix + record.bugId;
                }
            }
            
            bugIdHtml = `<a href="${bugUrl}" target="_blank" class="bug-id-tag">
                ${bugType ? `<span style="background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 4px;">${escapeHtml(bugType)}</span>` : ''}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                ${escapeHtml(record.bugId)}
            </a>`;
        }

        const descriptionHtml = record.description
            ? `<div class="timeline-content">${escapeHtml(record.description)}</div>`
            : '';

        // 图片显示
        const images = record.images || [];
        const imagesHtml = images.length > 0
            ? `<div class="timeline-images">
                ${images.map(img => `
                    <div class="timeline-image-item" onclick="previewImageFullscreen('${img.url}')">
                        <img src="${img.url}" alt="${img.name || '图片'}" loading="lazy">
                    </div>
                `).join('')}
               </div>`
            : '';

        const createdAt = record.createdAt || record.created_at || '';

        return `
            <div class="timeline-item" data-record-id="${record.id}" onclick="viewExecutionRecordDetail(event, ${record.id})" style="cursor: pointer;">
                <div class="timeline-header">
                    <span class="record-type-tag ${typeClass}">
                        ${typeIcon}
                        ${typeLabel}
                    </span>
                    ${bugIdHtml}
                    <div class="timeline-actions" onclick="event.stopPropagation();">
                        <button class="timeline-action-btn edit-btn" onclick="editExecutionRecord(${record.id})" title="编辑">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="timeline-action-btn delete-btn-red" onclick="deleteExecutionRecord(${record.id})" title="删除" style="background: #fee2e2; color: #dc2626; border: 1px solid #fecaca;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                ${descriptionHtml}
                ${imagesHtml}
                <div class="timeline-footer">
                    <span class="timeline-footer-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        ${escapeHtml(record.creator || '')}
                    </span>
                    <span class="timeline-footer-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        ${formatDateTime(createdAt)}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

// HTML转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 显示Bug详情（Mock）
function showBugDetail(bugId) {
    showSuccessMessage(`查看Bug详情: ${bugId}`);
}

// 初始化执行记录（在打开测试用例详情时调用）
async function initExecutionRecords(caseId) {
    // 设置当前用例ID
    currentExecutionCaseId = caseId;

    // 隐藏表单
    const form = document.getElementById('execution-record-form');
    if (form) {
        form.classList.add('hidden');
    }

    // 重置图片上传状态
    pendingRecordImages = [];
    renderRecordImagePreviews();

    // 绑定图片上传事件
    bindRecordImageUploadEvents();

    // 从数据库加载执行记录
    await loadExecutionRecords(caseId);
}

// 待上传的图片列表
let pendingRecordImages = [];

// 绑定图片上传事件
function bindRecordImageUploadEvents() {
    const fileInput = document.getElementById('record-image-input');
    const previewContainer = document.getElementById('record-images-preview');
    const textarea = document.getElementById('record-description');

    if (fileInput) {
        fileInput.removeEventListener('change', handleRecordImageSelect);
        fileInput.addEventListener('change', handleRecordImageSelect);
    }

    // 支持拖拽上传
    if (previewContainer) {
        previewContainer.removeEventListener('dragover', handleRecordDragOver);
        previewContainer.removeEventListener('drop', handleRecordDrop);
        previewContainer.addEventListener('dragover', handleRecordDragOver);
        previewContainer.addEventListener('drop', handleRecordDrop);
    }

    // 支持粘贴上传
    if (textarea) {
        textarea.removeEventListener('paste', handlePasteImage);
        textarea.addEventListener('paste', handlePasteImage);
    }
}

// 处理拖拽（执行记录图片上传）
function handleRecordDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drag-over');
}

function handleRecordDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
        processImageFiles(files);
    }
}

// 处理粘贴图片
function handlePasteImage(e) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) {
                processImageFiles([file]);
            }
        }
    }
}

// 处理图片选择
function handleRecordImageSelect(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
        processImageFiles(files);
    }
}

// 处理图片文件
async function processImageFiles(files) {
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            showErrorMessage(`${file.name} 不是有效的图片文件`);
            continue;
        }

        if (file.size > 10 * 1024 * 1024) {
            showErrorMessage(`${file.name} 超过10MB限制`);
            continue;
        }

        // 创建预览
        const reader = new FileReader();
        reader.onload = async (e) => {
            const imageData = {
                file: file,
                preview: e.target.result,
                name: file.name,
                size: file.size,
                status: 'pending', // pending, uploading, done, error
                url: null
            };
            pendingRecordImages.push(imageData);
            renderRecordImagePreviews();

            // 自动上传
            await uploadRecordImage(imageData);
        };
        reader.readAsDataURL(file);
    }
}

// 上传单张图片
async function uploadRecordImage(imageData) {
    imageData.status = 'uploading';
    renderRecordImagePreviews();

    try {
        const formData = new FormData();
        formData.append('image', imageData.file);

        const response = await fetch('/api/testpoints/execution-records/upload-image', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            imageData.status = 'done';
            imageData.url = result.url;
            showSuccessMessage('图片上传成功');
        } else {
            imageData.status = 'error';
            showErrorMessage(result.message || '图片上传失败');
        }
    } catch (error) {
        imageData.status = 'error';
        showErrorMessage('图片上传失败: ' + error.message);
    }

    renderRecordImagePreviews();
}

// 渲染图片预览
function renderRecordImagePreviews() {
    const container = document.getElementById('record-images-preview');
    if (!container) return;

    container.innerHTML = pendingRecordImages.map((img, index) => {
        const statusIcon = img.status === 'uploading' 
            ? '<div class="image-uploading"><div class="spinner"></div></div>'
            : img.status === 'error' 
            ? '<div class="image-error">❌</div>'
            : '';

        return `
            <div class="record-image-preview-item" data-index="${index}">
                <img src="${img.preview}" alt="${img.name}" onclick="previewImageFullscreen('${img.preview}')">
                ${statusIcon}
                <button class="remove-image-btn" onclick="removeRecordImage(${index})">×</button>
            </div>
        `;
    }).join('');
}

// 删除待上传的图片
function removeRecordImage(index) {
    pendingRecordImages.splice(index, 1);
    renderRecordImagePreviews();
}

// 全屏预览图片
function previewImageFullscreen(src) {
    const modal = document.createElement('div');
    modal.className = 'image-preview-modal';
    modal.innerHTML = `
        <div class="image-preview-content">
            <img src="${src}" alt="预览" id="preview-image">
            <button class="close-preview-btn" onclick="this.parentElement.parentElement.remove()" title="关闭 (ESC)">×</button>
            <div class="image-preview-controls" style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; background: rgba(0,0,0,0.6); padding: 8px 16px; border-radius: 20px;">
                <button onclick="zoomPreviewImage(-0.2)" style="background: none; border: none; color: #fff; font-size: 20px; cursor: pointer;" title="缩小">−</button>
                <span id="zoom-level" style="color: #fff; font-size: 14px; line-height: 24px;">100%</span>
                <button onclick="zoomPreviewImage(0.2)" style="background: none; border: none; color: #fff; font-size: 20px; cursor: pointer;" title="放大">+</button>
                <button onclick="resetPreviewImage()" style="background: none; border: none; color: #fff; font-size: 14px; cursor: pointer; margin-left: 8px;" title="重置">重置</button>
                <button onclick="this.closest('.image-preview-modal').remove()" style="background: none; border: none; color: #fff; font-size: 14px; cursor: pointer; margin-left: 8px; padding: 4px 12px; border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;" title="关闭预览">关闭</button>
            </div>
            <div style="position: absolute; top: 20px; left: 50%; transform: translateX(-50%); color: rgba(255,255,255,0.6); font-size: 12px; pointer-events: none;">按 ESC 或点击背景关闭</div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 点击背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // ESC 键关闭
    const handleEsc = function(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
    
    // 图片缩放和拖拽功能
    const img = document.getElementById('preview-image');
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX, startY;
    
    window.zoomPreviewImage = function(delta) {
        scale = Math.max(0.5, Math.min(3, scale + delta));
        updateImageTransform();
    };
    
    window.resetPreviewImage = function() {
        scale = 1;
        translateX = 0;
        translateY = 0;
        updateImageTransform();
    };
    
    function updateImageTransform() {
        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        document.getElementById('zoom-level').textContent = Math.round(scale * 100) + '%';
        img.classList.toggle('zoomed', scale > 1);
    }
    
    // 鼠标滚轮缩放
    modal.addEventListener('wheel', function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        scale = Math.max(0.5, Math.min(3, scale + delta));
        updateImageTransform();
    });
    
    // 拖拽功能
    img.addEventListener('mousedown', function(e) {
        if (scale > 1) {
            isDragging = true;
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
            img.style.cursor = 'grabbing';
        }
    });
    
    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateImageTransform();
        }
    });
    
    document.addEventListener('mouseup', function() {
        isDragging = false;
        img.style.cursor = scale > 1 ? 'move' : 'zoom-in';
    });
}

// 编辑执行记录
async function editExecutionRecord(recordId) {
    console.log('editExecutionRecord called:', recordId);
    
    // 从当前加载的记录中找到要编辑的记录
    const record = window.currentExecutionRecords ? window.currentExecutionRecords.find(r => r.id === recordId) : null;
    
    if (!record) {
        showErrorMessage('找不到执行记录');
        return;
    }
    
    // 加载超链接配置
    let bugTypeOptions = '<option value="">选择类型</option>';
    try {
        const response = await apiRequest('/hyperlink-configs/list');
        if (response.success && response.configs) {
            response.configs.forEach(config => {
                const selected = record.bugType === config.name ? 'selected' : '';
                bugTypeOptions += `<option value="${config.name}" ${selected}>${config.name}</option>`;
            });
        }
    } catch (error) {
        console.error('加载Bug类型选项失败:', error);
    }
    
    // 创建编辑模态框
    const existingModal = document.getElementById('edit-record-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'edit-record-modal';
    modal.style.cssText = 'display: flex !important; position: fixed !important; z-index: 99999 !important; left: 0 !important; top: 0 !important; width: 100% !important; height: 100% !important; background-color: rgba(0,0,0,0.5) !important; align-items: center !important; justify-content: center !important; visibility: visible !important; opacity: 1 !important;';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px; background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
            <div class="modal-header" style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 16px;">编辑执行记录</h3>
                <button class="modal-close" onclick="closeEditRecordModal()" style="background: none; border: none; font-size: 20px; cursor: pointer;">&times;</button>
            </div>
            <div class="modal-body" style="padding: 20px;">
                <div class="form-field">
                    <label class="form-label" style="display: block; margin-bottom: 4px; font-weight: 500;">记录类型</label>
                    <select id="edit-record-type" class="form-select" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" onchange="toggleEditBugIdField()">
                        <option value="defect" ${record.type === 'defect' ? 'selected' : ''}>缺陷</option>
                        <option value="other" ${record.type === 'other' ? 'selected' : ''}>其他</option>
                    </select>
                </div>
                <div class="form-field" id="edit-bug-id-field" style="${record.type === 'defect' ? '' : 'display: none;'} margin-top: 12px;">
                    <label class="form-label" style="display: block; margin-bottom: 4px; font-weight: 500;">Bug ID</label>
                    <div style="display: flex; gap: 12px; align-items: flex-end;">
                        <div style="flex: 1;">
                            <input type="text" id="edit-record-bug-id" class="form-input" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;" value="${record.bugId || ''}" placeholder="请输入Bug ID">
                        </div>
                        <div style="width: 150px;">
                            <select id="edit-record-bug-type" class="form-select" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;">
                                ${bugTypeOptions}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="form-field" style="margin-top: 12px;">
                    <label class="form-label" style="display: block; margin-bottom: 4px; font-weight: 500;">描述</label>
                    <textarea id="edit-record-description" class="form-textarea" rows="4" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical;" placeholder="请输入描述...">${record.description || ''}</textarea>
                </div>
                <div class="form-field" style="margin-top: 12px;">
                    <label class="form-label" style="display: block; margin-bottom: 4px; font-weight: 500;">图片</label>
                    <div id="edit-record-images-preview" class="record-images-preview"></div>
                    <input type="file" id="edit-record-image-input" accept="image/*" multiple style="display: none;">
                    <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 8px; padding: 6px 12px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer;" onclick="document.getElementById('edit-record-image-input').click()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; vertical-align: middle;">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        添加图片
                    </button>
                </div>
            </div>
            <div class="modal-footer" style="padding: 16px 20px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                <button class="btn btn-secondary" onclick="closeEditRecordModal()" style="padding: 8px 16px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer;">取消</button>
                <button class="btn btn-primary" onclick="saveEditRecord(${recordId})" style="padding: 8px 16px; border: none; background: #4f46e5; color: #fff; border-radius: 6px; cursor: pointer;">保存</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    console.log('Edit modal created and appended');
    
    // 初始化编辑图片
    window.editRecordImages = (record.images || []).map(img => ({...img, status: 'done'}));
    renderEditRecordImages();
    
    // 绑定图片上传事件
    const imageInput = document.getElementById('edit-record-image-input');
    if (imageInput) {
        imageInput.addEventListener('change', handleEditImageSelect);
    }
}

function toggleEditBugIdField() {
    const typeSelect = document.getElementById('edit-record-type');
    const bugIdField = document.getElementById('edit-bug-id-field');
    if (typeSelect && bugIdField) {
        bugIdField.style.display = typeSelect.value === 'defect' ? 'block' : 'none';
    }
}

function closeEditRecordModal() {
    const modal = document.getElementById('edit-record-modal');
    if (modal) {
        modal.remove();
    }
    window.editRecordImages = [];
}

function renderEditRecordImages() {
    const container = document.getElementById('edit-record-images-preview');
    if (!container || !window.editRecordImages) return;
    
    container.innerHTML = window.editRecordImages.map((img, index) => {
        return `
            <div class="record-image-preview-item" data-index="${index}">
                <img src="${img.url || img.preview}" alt="${img.name || '图片'}" onclick="previewImageFullscreen('${img.url || img.preview}')">
                ${img.status === 'uploading' ? '<div class="image-uploading"><div class="spinner"></div></div>' : ''}
                <button class="remove-image-btn" onclick="removeEditRecordImage(${index})">×</button>
            </div>
        `;
    }).join('');
}

async function handleEditImageSelect(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 10 * 1024 * 1024) continue;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            const imageData = {
                file: file,
                preview: e.target.result,
                name: file.name,
                status: 'uploading',
                url: null
            };
            window.editRecordImages.push(imageData);
            renderEditRecordImages();
            
            // 上传图片
            try {
                const formData = new FormData();
                formData.append('image', file);
                
                const response = await fetch('/api/testpoints/execution-records/upload-image', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: formData
                });
                
                const result = await response.json();
                if (result.success) {
                    imageData.status = 'done';
                    imageData.url = result.url;
                } else {
                    imageData.status = 'error';
                }
            } catch (error) {
                imageData.status = 'error';
            }
            renderEditRecordImages();
        };
        reader.readAsDataURL(file);
    }
}

function removeEditRecordImage(index) {
    if (window.editRecordImages) {
        window.editRecordImages.splice(index, 1);
        renderEditRecordImages();
    }
}

async function saveEditRecord(recordId) {
    const typeSelect = document.getElementById('edit-record-type');
    const bugIdInput = document.getElementById('edit-record-bug-id');
    const bugTypeSelect = document.getElementById('edit-record-bug-type');
    const descInput = document.getElementById('edit-record-description');
    
    const type = typeSelect.value;
    const bugId = bugIdInput ? bugIdInput.value.trim() : '';
    const bugType = bugTypeSelect ? bugTypeSelect.value : '';
    const description = descInput ? descInput.value.trim() : '';
    
    // 验证
    if (type === 'defect' && !bugId) {
        showErrorMessage('缺陷类型必须填写Bug ID');
        return;
    }
    
    // 收集图片
    const images = window.editRecordImages
        .filter(img => img.status === 'done' && img.url)
        .map(img => ({ url: img.url, name: img.name }));
    
    try {
        showLoading('保存中...');
        
        const result = await apiRequest(`/testpoints/execution-records/${recordId}`, {
            method: 'PUT',
            body: JSON.stringify({ type, bugId, bugType, description, images })
        });
        
        if (result.success) {
            showSuccessMessage('执行记录更新成功');
            closeEditRecordModal();
            // 重新加载执行记录
            await loadExecutionRecords(currentExecutionCaseId);
        } else {
            showErrorMessage(result.message || '更新失败');
        }
    } catch (error) {
        console.error('保存执行记录失败:', error);
        showErrorMessage('保存失败');
    } finally {
        hideLoading();
    }
}

// 查看执行记录详情
async function viewExecutionRecordDetail(event, recordId) {
    // 阻止事件冒泡
    if (event) {
        event.stopPropagation();
    }
    
    // 从当前加载的记录中找到要查看的记录
    const record = window.currentExecutionRecords ? window.currentExecutionRecords.find(r => r.id === recordId) : null;
    
    if (!record) {
        showErrorMessage('找不到执行记录');
        return;
    }
    
    // 创建详情模态框
    const existingModal = document.getElementById('record-detail-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const typeClass = record.type === 'defect' ? 'defect' : 'other';
    const typeLabel = record.type === 'defect' ? '缺陷' : '其他';
    const typeIcon = record.type === 'defect' 
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.41 1.41l1.41-1.41 7.06 7.06-1.41 1.41 1.41 1.41-1.41 1.41-7.07-7.06z"></path><circle cx="12" cy="12" r="10"></circle></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    
    // 获取超链接配置并生成 Bug ID 链接
    let bugIdHtml = '';
    if (record.bugId) {
        try {
            const response = await apiRequest('/hyperlink-configs/list');
            let bugUrl = record.bugId;
            let bugTypeLabel = record.bugType || '';
            
            if (response.success && response.configs && record.bugType) {
                const config = response.configs.find(c => c.name === record.bugType);
                if (config && config.prefix) {
                    bugUrl = config.prefix + record.bugId;
                }
            }
            
            bugIdHtml = `<div style="margin-top: 12px;">
                <span style="font-weight: 500; color: #6b7280;">Bug ID: </span>
                ${bugTypeLabel ? `<span style="background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 8px;">${escapeHtml(bugTypeLabel)}</span>` : ''}
                <a href="${bugUrl}" target="_blank" style="color: #2563eb; text-decoration: underline;">${escapeHtml(record.bugId)}</a>
            </div>`;
        } catch (error) {
            console.error('获取超链接配置失败:', error);
            bugIdHtml = `<div style="margin-top: 12px;"><span style="font-weight: 500; color: #6b7280;">Bug ID: </span><span>${escapeHtml(record.bugId)}</span></div>`;
        }
    }
    
    const descriptionHtml = record.description
        ? `<div style="margin-top: 16px; padding: 16px; background: #f9fafb; border-radius: 8px; white-space: pre-wrap; word-break: break-word;">${escapeHtml(record.description)}</div>`
        : '<div style="margin-top: 16px; padding: 16px; background: #f9fafb; border-radius: 8px; color: #9ca3af; font-style: italic;">暂无描述</div>';
    
    // 图片显示
    const images = record.images || [];
    const imagesHtml = images.length > 0
        ? `<div style="margin-top: 16px;">
            <div style="font-weight: 500; margin-bottom: 8px;">图片 (${images.length}张)</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px;">
                ${images.map(img => `
                    <div style="position: relative; border-radius: 8px; overflow: hidden; cursor: pointer;" onclick="previewImageFullscreen('${img.url}')">
                        <img src="${img.url}" alt="${img.name || '图片'}" style="width: 100%; height: 120px; object-fit: cover;">
                    </div>
                `).join('')}
            </div>
           </div>`
        : '<div style="margin-top: 16px; color: #9ca3af; font-style: italic;">暂无图片</div>';
    
    const createdAt = record.createdAt || record.created_at || '';
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'record-detail-modal';
    modal.style.cssText = 'display: flex !important; position: fixed !important; z-index: 99999 !important; left: 0 !important; top: 0 !important; width: 100% !important; height: 100% !important; background-color: rgba(0,0,0,0.5) !important; align-items: center !important; justify-content: center !important; visibility: visible !important; opacity: 1 !important;';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
            <div class="modal-header" style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px;">
                    <span class="record-type-tag ${typeClass}" style="padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                        ${typeIcon}
                        ${typeLabel}
                    </span>
                    执行记录详情
                </h3>
                <button class="modal-close" onclick="closeRecordDetailModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #6b7280;">&times;</button>
            </div>
            <div class="modal-body" style="padding: 20px; max-height: 60vh; overflow-y: auto;">
                ${bugIdHtml}
                ${descriptionHtml}
                ${imagesHtml}
                <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; color: #6b7280; font-size: 13px;">
                    <span style="display: flex; align-items: center; gap: 4px;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        ${escapeHtml(record.creator || '未知')}
                    </span>
                    <span style="display: flex; align-items: center; gap: 4px;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        ${formatDateTime(createdAt)}
                    </span>
                </div>
            </div>
            <div class="modal-footer" style="padding: 16px 20px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                <button class="btn btn-secondary" onclick="closeRecordDetailModal()" style="padding: 8px 16px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer;">关闭</button>
                <button class="btn btn-primary" onclick="editExecutionRecord(${recordId}); closeRecordDetailModal();" style="padding: 8px 16px; border: none; background: #4f46e5; color: #fff; border-radius: 6px; cursor: pointer;">编辑</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 点击模态框背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeRecordDetailModal();
        }
    });
}

// 关闭执行记录详情模态框
function closeRecordDetailModal() {
    const modal = document.getElementById('record-detail-modal');
    if (modal) {
        modal.remove();
    }
}

// 删除执行记录
async function deleteExecutionRecord(recordId) {
    if (!(await showConfirmMessage('确定要删除这条执行记录吗？'))) {
        return;
    }
    
    try {
        showLoading('删除中...');
        
        const result = await apiRequest(`/testpoints/execution-records/${recordId}`, {
            method: 'DELETE'
        });
        
        if (result.success) {
            showSuccessMessage('执行记录删除成功');
            // 重新加载执行记录
            await loadExecutionRecords(currentExecutionCaseId);
            
            // 发布事件：执行记录变更
            DataEventManager.emit(DataEvents.EXECUTION_RECORD_CHANGED, { 
                action: 'delete', 
                caseId: currentExecutionCaseId 
            });
        } else {
            showErrorMessage(result.message || '删除失败');
        }
    } catch (error) {
        console.error('删除执行记录失败:', error);
        showErrorMessage('删除失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 保存测试用例详情
async function saveTestCaseDetail() {
    try {
        // 获取当前测试用例ID，首先检查window.currentEditingTestCase
        let testCaseId = null;
        let isNewCase = true;

        if (window.currentEditingTestCase) {
            testCaseId = window.currentEditingTestCase.id;
            isNewCase = testCaseId === 'new' || testCaseId === '';
        } else {
            // 如果window.currentEditingTestCase为null，尝试从DOM元素获取
            const caseIdInput = document.getElementById('detail-case-id');
            if (caseIdInput && caseIdInput.value) {
                testCaseId = caseIdInput.value;
                isNewCase = false;
            } else {
                testCaseId = 'new';
                isNewCase = true;
            }
        }

        console.log('saveTestCaseDetail被调用，testCaseId:', testCaseId, 'isNewCase:', isNewCase);

        // 获取 libraryId 和 moduleId（优先从 currentEditingTestCase 获取）
        let libraryId = currentCaseLibraryId;
        let moduleId = selectedModuleId;
        
        if ((!libraryId || !moduleId) && window.currentEditingTestCase) {
            libraryId = libraryId || window.currentEditingTestCase.library_id || window.currentEditingTestCase.libraryId;
            moduleId = moduleId || window.currentEditingTestCase.module_id || window.currentEditingTestCase.moduleId;
            console.log('从 currentEditingTestCase 获取 ID:', { libraryId, moduleId });
        }

        // 获取选中的测试阶段（从TagSelector组件获取）
        const selectedPhases = TagSelector.getValues('detail-case-phases-selector') || [];

        // 获取选中的测试环境（从TagSelector组件获取）
        const selectedEnvironments = TagSelector.getValues('detail-case-environments-selector') || [];

        // 获取选中的测试方式（从TagSelector组件获取）
        const selectedMethods = TagSelector.getValues('detail-case-methods-selector') || [];

        // 获取选中的测试点来源（从TagSelector组件获取）
        const selectedSources = TagSelector.getValues('detail-case-sources-selector') || [];

        // 获取选中的项目及其关联数据
        // 对于编辑用例详情页面，关联项目通过编辑按钮单独处理，这里不需要处理
        // 关联项目的保存逻辑已经在saveProjectAssociations函数中实现
        console.log('编辑用例详情页面的关联项目通过编辑按钮单独处理，这里不直接处理页面上的关联项目信息');

        // 获取表单数据
        const formData = {
            id: testCaseId,
            caseId: document.getElementById('detail-case-id').value,
            name: document.getElementById('detail-case-name').value.trim(),
            priority: document.getElementById('detail-case-priority').value,
            type: document.getElementById('detail-case-type').value,
            precondition: document.getElementById('detail-case-precondition').value.trim(),
            purpose: document.getElementById('detail-case-purpose').value.trim(),
            steps: document.getElementById('detail-case-steps').value.trim(),
            expected: document.getElementById('detail-case-expected').value.trim(),
            key_config: document.getElementById('detail-case-key-config').value.trim(),
            remark: document.getElementById('detail-case-remark').value.trim(),
            creator: document.getElementById('detail-case-creator').value,
            owner: document.getElementById('detail-case-owner').value.trim(),
            libraryId: libraryId,
            moduleId: moduleId,
            level1Id: selectedLevel1PointId,
            // 注意：不传递projects和projectAssociations参数，避免删除已有的关联项目
            // 关联项目通过saveProjectAssociations函数单独处理
            phases: selectedPhases.map(id => parseInt(id)), // 转换为数字数组
            environments: selectedEnvironments.map(id => parseInt(id)), // 转换为数字数组
            methods: selectedMethods.map(id => parseInt(id)), // 转换为数字数组
            sources: selectedSources.map(id => parseInt(id)) // 转换为数字数组
        };

        // 验证必填字段
        if (!formData.name) {
            showErrorMessage('测试项名称不能为空');
            return;
        }

        // 调用API更新测试用例
        showLoading('保存测试用例中...');

        // 根据当前编辑状态调用不同的API端点
        let saveData;

        if (isNewCase) {
            // 新建用例，调用/cases/create端点
            console.log('新建测试用例，调用/cases/create端点');
            saveData = await apiRequest('/cases/create', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
        } else {
            // 编辑用例，调用/cases/update端点
            console.log('编辑测试用例，调用/cases/update端点');
            saveData = await apiRequest('/cases/update', {
                method: 'POST',
                body: JSON.stringify(formData)
            });
        }

        // 保存level1_id供后续刷新使用 - 使用当前激活的测试点ID而不是测试用例的level1_id
        const level1Id = selectedLevel1PointId;

        // 确保libraryId和moduleId不为空（用于后续刷新操作）
        if (!libraryId || !moduleId) {
            console.error('libraryId或moduleId为空，尝试从UI获取');
            // 尝试从选中的模块获取libraryId和moduleId
            const activeModuleEl = document.querySelector('.case-nav-item.active');
            if (activeModuleEl) {
                const uiModuleId = activeModuleEl.dataset.moduleId;
                const uiLibraryId = document.querySelector('.case-library-item.active')?.dataset.libraryId;
                if (uiModuleId) {
                    moduleId = uiModuleId;
                }
                if (uiLibraryId) {
                    libraryId = uiLibraryId;
                }
                console.log('从UI重新获取到的ID:', { libraryId, moduleId });
            }
        }

        if (saveData.success) {
            // 关闭模态框
            closeTestCaseDetailModal();

            // 刷新一级测试点列表以更新名称显示
            if (moduleId) {
                await loadLevel1Points(moduleId);
            }

            // 刷新悬浮面板（Drawer）数据
            const activeModuleEl = document.querySelector('.case-nav-item.active');
            if (activeModuleEl && activeModuleEl !== document.querySelector('.case-nav-item:first-child')) {
                if (level1Id) {
                    const level1Points = await getLevel2TestPoints(level1Id);
                    updateFloatingPanelContent(level1Points);
                }
            }

            // 使用之前定义的testCaseId变量，对于新建用例，使用返回的testCaseId
            let finalTestCaseId = testCaseId;
            if (isNewCase && saveData.testCaseId) {
                // 新建用例，使用返回的testCaseId
                finalTestCaseId = saveData.testCaseId;
                console.log('新建测试用例成功，返回的测试用例ID:', finalTestCaseId);
            }

            // 无论是新建用例还是编辑用例，都检查本地存储中的临时关联项目数据
            console.log('检查本地存储中的临时关联项目数据...');
            const tempAssociations = sessionStorage.getItem('tempProjectAssociations');
            console.log('从本地存储读取到的临时关联项目数据:', tempAssociations);
            if (tempAssociations) {
                try {
                    const associations = JSON.parse(tempAssociations);
                    console.log('解析后的临时关联项目数据:', associations);

                    if (associations.length > 0) {
                        // 调用API更新测试用例关联项目
                        try {
                            console.log('准备保存临时关联项目到数据库，测试用例ID:', finalTestCaseId);
                            console.log('API路径:', `/testcases/${finalTestCaseId}/projects`);
                            console.log('API请求数据:', { associations });

                            // 调用API保存关联项目
                            const updateResponse = await apiRequest(`/testcases/${finalTestCaseId}/projects`, {
                                method: 'PUT',
                                body: JSON.stringify({ associations })
                            });

                            console.log('API响应:', updateResponse);
                            if (updateResponse.success) {
                                console.log('临时关联项目保存成功');
                                // 清除本地存储中的临时数据
                                localStorage.removeItem('tempProjectAssociations');
                                console.log('已清除本地存储中的临时关联项目数据');
                            } else {
                                console.error('临时关联项目保存失败:', updateResponse.message);
                                showErrorMessage('关联项目保存失败: ' + updateResponse.message);
                            }
                        } catch (error) {
                            console.error('保存临时关联项目失败:', error);
                            showErrorMessage('关联项目保存失败: ' + error.message);
                        }
                    } else {
                        console.log('解析后的临时关联项目数据为空数组，不需要保存');
                        localStorage.removeItem('tempProjectAssociations');
                        console.log('已清除本地存储中的空临时关联项目数据');
                    }
                } catch (parseError) {
                    console.error('解析本地存储中的临时关联项目数据失败:', parseError);
                    localStorage.removeItem('tempProjectAssociations');
                    console.log('已清除本地存储中的无效临时关联项目数据');
                }
            } else {
                console.log('本地存储中没有临时关联项目数据');
            }

            showSuccessMessage('测试用例保存成功');
        } else {
            showErrorMessage('测试用例保存失败: ' + (saveData.message || '保存失败，请稍后重试'));
        }
    } catch (error) {
        console.error('保存测试用例错误:', error);
        showErrorMessage('测试用例保存失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除测试用例
async function deleteTestCase() {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    if (!window.currentEditingTestCase) {
        showErrorMessage('未找到要删除的测试用例');
        return;
    }

    // 确认删除
    if (!(await showConfirmMessage('确定要删除该测试用例吗？此操作不可恢复。'))) {
        return;
    }

    try {
        showLoading('删除测试用例中...');

        const testCaseId = window.currentEditingTestCase.id;
        const deletedLevel1Id = window.currentEditingTestCase.level1_id || window.currentEditingTestCase.level1Id;
        
        const deleteData = await apiRequest(`/testcases/${testCaseId}`, {
            method: 'DELETE'
        });

        if (deleteData.success) {
            closeTestCaseDetailModal();

            // 刷新一级测试点列表（更新数量）
            if (currentModuleId) {
                await loadLevel1Points(currentModuleId);
            }

            // 刷新测试用例列表
            if (selectedLevel1PointId) {
                const testCases = await getLevel2TestPoints(selectedLevel1PointId);
                updateFloatingPanelContent(testCases);
            } else if (deletedLevel1Id) {
                // 如果 selectedLevel1PointId 为空，尝试使用被删除用例的 level1_id
                const testCases = await getLevel2TestPoints(deletedLevel1Id);
                updateFloatingPanelContent(testCases);
            }

            // 发布事件：测试用例数据变更
            DataEventManager.emit(DataEvents.TEST_CASE_CHANGED, { 
                action: 'delete', 
                moduleId: currentModuleId,
                level1Id: deletedLevel1Id
            });

            showSuccessMessage('测试用例删除成功');
        } else {
            showErrorMessage('测试用例删除失败: ' + (deleteData.message || '删除失败，请稍后重试'));
        }
    } catch (error) {
        console.error('删除测试用例错误:', error);
        showErrorMessage('测试用例删除失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 打开添加一级测试点模态框
async function openAddLevel1PointModal() {
    const modal = document.getElementById('add-level1-point-modal');
    
    // 从配置中心加载测试类型
    try {
        const testTypesData = await apiRequest('/test-types/list');
        const typeSelect = document.getElementById('level1-point-type');
        
        if (testTypesData && testTypesData.success && Array.isArray(testTypesData.testTypes) && testTypesData.testTypes.length > 0) {
            typeSelect.innerHTML = testTypesData.testTypes.map(type => 
                `<option value="${type.name}">${type.name}</option>`
            ).join('');
        } else {
            typeSelect.innerHTML = `
                <option value="功能测试">功能测试</option>
                <option value="性能测试">性能测试</option>
                <option value="兼容性测试">兼容性测试</option>
                <option value="安全测试">安全测试</option>
            `;
        }
    } catch (error) {
        console.error('加载测试类型失败:', error);
    }
    
    modal.style.display = 'block';
    
    // 初始化拖拽调整宽度功能
    initLevel1PointModalResizer('add');
}

// 关闭添加一级测试点模态框
function closeAddLevel1PointModal() {
    const modal = document.getElementById('add-level1-point-modal');
    modal.style.display = 'none';

    // 重置表单
    document.getElementById('add-level1-point-form').reset();
    
    // 重置模态框位置和宽度
    resetLevel1PointModalPosition('add');
}

// 初始化一级测试点模态框的拖拽调整宽度功能
function initLevel1PointModalResizer(type) {
    const contentId = type === 'add' ? 'add-level1-point-content' : 'edit-level1-point-content';
    const resizerId = type === 'add' ? 'add-level1-point-resizer' : 'edit-level1-point-resizer';
    
    const modalContent = document.getElementById(contentId);
    const resizer = document.getElementById(resizerId);
    const modalHeader = modalContent?.querySelector('.modal-header');
    
    if (!modalContent || !resizer) return;
    
    if (modalContent.dataset.resizerInitialized === 'true') return;
    modalContent.dataset.resizerInitialized = 'true';

    let isResizing = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startLeft = 0;
    let startTop = 0;
    const minWidth = 400;
    const maxWidthRatio = 0.95;

    // 调整宽度功能
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = modalContent.offsetWidth;
        
        resizer.classList.add('dragging');
        document.body.classList.add('modal-resizing');
        
        e.preventDefault();
        e.stopPropagation();
    });

    // 拖拽移动功能（通过header）
    if (modalHeader) {
        modalHeader.addEventListener('mousedown', (e) => {
            if (e.target.closest('.close') || e.target.closest('.close-btn') || e.target.closest('button')) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = modalContent.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            
            modalContent.style.position = 'fixed';
            modalContent.style.left = startLeft + 'px';
            modalContent.style.top = startTop + 'px';
            modalContent.style.margin = '0';
            
            document.body.classList.add('modal-dragging');
            
            e.preventDefault();
        });
    }

    document.addEventListener('mousemove', (e) => {
        // 调整宽度
        if (isResizing) {
            const deltaX = e.clientX - startX;
            const newWidth = startWidth + deltaX;
            const maxWidth = window.innerWidth * maxWidthRatio;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                modalContent.style.width = newWidth + 'px';
                modalContent.style.maxWidth = newWidth + 'px';
            } else if (newWidth < minWidth) {
                modalContent.style.width = minWidth + 'px';
                modalContent.style.maxWidth = minWidth + 'px';
            } else if (newWidth > maxWidth) {
                modalContent.style.width = maxWidth + 'px';
                modalContent.style.maxWidth = maxWidth + 'px';
            }
        }
        
        // 拖拽移动
        if (isDragging) {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            let newLeft = startLeft + deltaX;
            let newTop = startTop + deltaY;
            
            // 边界限制
            const maxLeft = window.innerWidth - modalContent.offsetWidth - 10;
            const maxTop = window.innerHeight - 100;
            
            newLeft = Math.max(10, Math.min(newLeft, maxLeft));
            newTop = Math.max(10, Math.min(newTop, maxTop));
            
            modalContent.style.left = newLeft + 'px';
            modalContent.style.top = newTop + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('dragging');
            document.body.classList.remove('modal-resizing');
        }
        if (isDragging) {
            isDragging = false;
            document.body.classList.remove('modal-dragging');
        }
    });

    // 双击重置宽度
    resizer.addEventListener('dblclick', () => {
        modalContent.style.width = '';
        modalContent.style.maxWidth = '520px';
    });
}

// 重置一级测试点模态框位置
function resetLevel1PointModalPosition(type) {
    const contentId = type === 'add' ? 'add-level1-point-content' : 'edit-level1-point-content';
    const modalContent = document.getElementById(contentId);
    if (modalContent) {
        modalContent.style.position = '';
        modalContent.style.left = '';
        modalContent.style.top = '';
        modalContent.style.margin = '';
        modalContent.style.width = '';
        modalContent.style.maxWidth = '520px';
    }
}

// 提交添加一级测试点表单
async function submitAddLevel1PointForm() {
    try {
        showLoading('添加一级测试点中...');

        const pointName = document.getElementById('level1-point-name').value.trim();
        const pointType = document.getElementById('level1-point-type').value;

        if (!pointName) {
            showErrorMessage('一级测试点名称不能为空');
            return;
        }

        if (!selectedModuleId) {
            showErrorMessage('请先选择左侧功能模块');
            return;
        }

        // 检查登录状态
        if (!authToken) {
            // 尝试自动登录
            console.log('未登录，尝试自动登录...');
            try {
                const loginData = await apiRequest('/users/login', {
                    method: 'POST',
                    body: JSON.stringify({
                        username: 'admin',
                        password: 'ctc@2026.'
                    })
                });

                console.log('自动登录结果:', loginData);

                if (loginData.token) {
                    currentUser = loginData.user || { username: 'admin', role: '管理员' };
                    authToken = loginData.token;
                    console.log('自动登录成功');
                } else if (loginData.success === false && loginData.message) {
                    console.error('自动登录失败:', loginData.message);
                }
            } catch (error) {
                console.error('自动登录失败:', error);
            }
        }

        // 准备API请求数据
        const requestData = {
            name: pointName,
            test_type: pointType,
            module_id: selectedModuleId
        };

        console.log('准备添加一级测试点:', requestData);
        console.log('登录状态:', authToken ? '已登录' : '未登录');

        // API调用逻辑 - 使用正确的端点
        let createData = null;
        try {
            createData = await apiRequest('/testpoints/level1/add', {
                method: 'POST',
                body: JSON.stringify(requestData)
            });

            console.log('API调用结果:', createData);
        } catch (error) {
            console.error('API调用失败:', error);
        }

        // 检查API调用结果
        if (createData && (createData.message === '一级测试点添加成功' || createData.success)) {
            console.log('[一级测试点] 添加成功，准备刷新列表');

            // 关闭模态框
            closeAddLevel1PointModal();

            // 重新加载一级测试点数据
            console.log('[一级测试点] 调用 loadLevel1Points，moduleId:', selectedModuleId);
            await loadLevel1Points(selectedModuleId);

            // 发布事件：一级测试点变更
            DataEventManager.emit(DataEvents.LEVEL1_POINT_CHANGED, { 
                action: 'add', 
                moduleId: selectedModuleId,
                pointName: pointName
            });

            // 显示成功消息
            showSuccessMessage('一级测试点添加成功（已保存到数据库）');
        } else {
            // 检查是否是认证问题
            if (!authToken) {
                showErrorMessage('请先登录系统');
                // 跳转到登录页面
                const loginSection = document.getElementById('login-section');
                if (loginSection) {
                    // 隐藏所有其他部分
                    const sections = document.querySelectorAll('section[id$="-section"]');
                    sections.forEach(section => {
                        section.style.display = 'none';
                    });
                    // 显示登录部分
                    loginSection.style.display = 'block';
                }
            } else if (createData && createData.message === '访问令牌缺失' || createData.message === '访问令牌无效') {
                // 令牌无效，尝试重新登录
                console.log('令牌无效，尝试重新登录...');
                try {
                    const loginData = await apiRequest('/users/login', {
                        method: 'POST',
                        body: JSON.stringify({
                            username: 'admin',
                            password: 'ctc@2026.'
                        })
                    });

                    if (loginData.token) {
                        currentUser = loginData.user || { username: 'admin', role: '管理员' };
                        authToken = loginData.token;
                        console.log('重新登录成功');

                        // 再次尝试添加测试点
                        const retryData = await apiRequest('/testpoints/level1/add', {
                            method: 'POST',
                            body: JSON.stringify(requestData)
                        });

                        if (retryData && retryData.message === '一级测试点添加成功') {
                            // 关闭模态框
                            closeAddLevel1PointModal();

                            // 重新加载一级测试点数据
                            await loadLevel1Points(selectedModuleId);

                            // 显示成功消息
                            showSuccessMessage('一级测试点添加成功（已保存到数据库）');
                            return;
                        }
                    }
                } catch (error) {
                    console.error('重新登录失败:', error);
                }

                // 尝试本地添加
                console.log('API调用失败，尝试本地添加一级测试点');

                // 创建新的测试点对象
                const newPoint = {
                    id: Date.now().toString(), // 生成临时ID
                    level1_id: 'LP-' + Date.now() + '-' + Math.floor(Math.random() * 1000), // 生成临时level1_id
                    name: pointName,
                    test_type: pointType,
                    module_id: selectedModuleId,
                    updated_at: getCurrentDateTime()
                };

                // 添加到本地数组
                level1Points.push(newPoint);

                // 更新显示
                updateLevel1PointsDisplay();

                // 关闭模态框
                closeAddLevel1PointModal();

                // 显示成功消息
                showSuccessMessage('一级测试点添加成功（本地）');
            } else {
                // 其他错误，尝试本地添加
                console.log('API调用失败，尝试本地添加一级测试点');

                // 创建新的测试点对象
                const newPoint = {
                    id: Date.now().toString(), // 生成临时ID
                    level1_id: 'LP-' + Date.now() + '-' + Math.floor(Math.random() * 1000), // 生成临时level1_id
                    name: pointName,
                    test_type: pointType,
                    module_id: selectedModuleId,
                    updated_at: getCurrentDateTime()
                };

                // 添加到本地数组
                level1Points.push(newPoint);

                // 更新显示
                updateLevel1PointsDisplay();

                // 关闭模态框
                closeAddLevel1PointModal();

                // 显示成功消息
                showSuccessMessage('一级测试点添加成功（本地）');
            }
        }
    } catch (error) {
        console.error('添加一级测试点错误:', error);

        // 尝试本地添加
        const pointName = document.getElementById('level1-point-name').value.trim();
        const pointType = document.getElementById('level1-point-type').value;

        if (pointName && selectedModuleId) {
            // 创建新的测试点对象
            const newPoint = {
                id: Date.now().toString(), // 生成临时ID
                level1_id: 'LP-' + Date.now() + '-' + Math.floor(Math.random() * 1000), // 生成临时level1_id
                name: pointName,
                test_type: pointType,
                module_id: selectedModuleId,
                updated_at: getCurrentDateTime()
            };

            // 添加到本地数组
            level1Points.push(newPoint);

            // 更新显示
            updateLevel1PointsDisplay();

            // 关闭模态框
            closeAddLevel1PointModal();

            // 显示成功消息
            showSuccessMessage('一级测试点添加成功（本地）');
        } else {
            showErrorMessage('一级测试点添加失败: ' + (error.message || '未知错误'));
        }
    } finally {
        hideLoading();
    }
}

// 管理报告模板
function manageReportTemplates() {
    const modal = document.getElementById('template-management-modal');
    modal.style.display = 'block';
}

// 关闭模板管理模态框
function closeTemplateManagementModal() {
    const modal = document.getElementById('template-management-modal');
    modal.style.display = 'none';
}

// 新建报告模板
function addReportTemplate() {
    showErrorMessage('新建报告模板功能即将上线，敬请期待！');
    // 这里将来可以实现打开新建模板模态框的功能
}

// 编辑报告模板
function editReportTemplate(templateId) {
    showErrorMessage('编辑报告模板功能即将上线，敬请期待！');
    // 这里将来可以实现打开编辑模板模态框的功能
}

// 搜索测试用例
function searchTestCases() {
    console.log('搜索测试用例');
    // 这里可以实现搜索测试用例的功能
    showErrorMessage('搜索测试用例功能即将上线，敬请期待！');
}

// 搜索测试计划
function searchTestPlans() {
    console.log('搜索测试计划');
    // 这里可以实现搜索测试计划的功能
    showErrorMessage('搜索测试计划功能即将上线，敬请期待！');
}

// 搜索测试报告
function searchTestReports() {
    console.log('搜索测试报告');
    // 这里可以实现搜索测试报告的功能
    showErrorMessage('搜索测试报告功能即将上线，敬请期待！');
}

// 分析测试数据
function analyzeTestData() {
    console.log('分析测试数据');
    // 这里可以实现分析测试数据的功能
    showErrorMessage('分析测试数据功能即将上线，敬请期待！');
}

// 添加用户
function addUser() {
    const modal = document.getElementById('add-user-modal');
    const header = modal.querySelector('.modal-header h3');
    header.textContent = '添加用户';
    // 重置表单
    document.getElementById('add-user-form').reset();
    modal.style.display = 'block';
}

// 编辑用户
function editUser(userId) {
    const modal = document.getElementById('add-user-modal');
    const header = modal.querySelector('.modal-header h3');
    header.textContent = '编辑用户';

    // 从 mockUsers 数组中获取完整用户数据
    const user = mockUsers.find(u => u.id === userId);
    
    if (user) {
        document.getElementById('user-username').value = user.username;
        document.getElementById('user-username').disabled = true;
        document.getElementById('user-email').value = user.email || '';
        document.getElementById('user-password').value = '********';

        let roleValue = 'tester';
        const roleText = user.role || '';
        if (roleText === '管理员' || roleText === 'admin') {
            roleValue = 'admin';
        } else if (roleText === '测试人员' || roleText === 'tester') {
            roleValue = 'tester';
        } else if (roleText === '查看人员' || roleText === 'viewer') {
            roleValue = 'viewer';
        } else if (roleText === '开发人员' || roleText === 'developer') {
            roleValue = 'developer';
        } else if (roleText === '项目经理' || roleText === 'project_manager') {
            roleValue = 'project_manager';
        } else if (roleText === '测试经理' || roleText === 'test_manager') {
            roleValue = 'test_manager';
        }
        document.getElementById('user-role').value = roleValue;
        
        // 保存用户ID供后续使用
        modal.dataset.editUserId = userId;
    } else {
        showErrorMessage('无法获取用户信息');
        return;
    }

    modal.style.display = 'block';
}

// 删除用户
async function deleteUser(userId) {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    // 从DOM行上直接获取用户名，不依赖mockUsers数组
    const row = document.querySelector(`tr[data-user-id="${userId}"]`);
    let username = '';
    if (row) {
        const usernameCell = row.querySelector('td:first-child');
        if (usernameCell) {
            username = usernameCell.textContent.replace('(系统)', '').trim();
        }
    }

    if (!username) {
        showErrorMessage('无法获取用户信息');
        return;
    }

    if (!(await showConfirmMessage(`确定要删除用户 "${username}" 吗？`))) return;

    try {
        showLoading('删除用户中...');

        // 调用API删除用户
        const deleteData = await apiRequest('/users/delete', {
            method: 'POST',
            body: JSON.stringify({ username })
        });

        // 处理不同的返回格式
        if (deleteData.message === '用户删除成功' || deleteData.success) {
            // 清除缓存
            apiCache.delete('/users/list');
            // 重新加载用户列表
            await loadUsers(currentSearchTerm, usersCurrentPage);
            showSuccessMessage('用户删除成功');
        } else {
            showErrorMessage('用户删除失败: ' + (deleteData.message || '删除失败，请稍后重试'));
        }
    } catch (error) {
        console.error('删除用户错误:', error);
        showErrorMessage('用户删除失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 关闭用户模态框
function closeUserModal() {
    const modal = document.getElementById('add-user-modal');
    modal.style.display = 'none';
    // 重置用户名输入框为可编辑
    document.getElementById('user-username').disabled = false;
}


// 提交用户表单
async function submitUserForm() {
    try {
        const modal = document.getElementById('add-user-modal');
        const header = modal.querySelector('.modal-header h3');
        const isEdit = header.textContent === '编辑用户';

        showLoading(isEdit ? '编辑用户中...' : '创建用户中...');

        // 角色值转换（英文 -> 中文，统一存储格式）
        const roleValue = document.getElementById('user-role').value;
        const roleMapToDb = {
            'admin': '管理员',
            'tester': '测试人员',
            'viewer': '查看人员',
            'developer': '开发人员',
            'project_manager': '项目经理',
            'test_manager': '测试经理'
        };

        // 获取表单数据
        const formData = {
            username: document.getElementById('user-username').value,
            email: document.getElementById('user-email').value,
            role: roleMapToDb[roleValue] || roleValue // 转换为中文角色名
        };

        // 只有在创建用户或修改密码时才包含密码字段
        const passwordValue = document.getElementById('user-password').value;
        if (!isEdit || passwordValue !== '********') {
            formData.password = passwordValue;
        }

        let apiUrl = '/users/add';
        if (isEdit) {
            apiUrl = '/users/update';
        }

        // 调用API创建或更新用户
        const responseData = await apiRequest(apiUrl, {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        console.log(isEdit ? '编辑用户API响应:' : '创建用户API响应:', responseData);

        // 处理不同的返回格式
        const successMessage = isEdit ? '用户更新成功' : '用户添加成功';
        if (responseData.message === successMessage || responseData.success) {
            // 重新加载用户列表
            console.log(isEdit ? '用户编辑成功，重新加载用户列表' : '用户创建成功，重新加载用户列表');
            await loadUsers();

            // 关闭模态框
            closeUserModal();

            // 清空表单
            document.getElementById('add-user-form').reset();

            // 记录历史
            addHistoryRecord(isEdit ? '编辑用户' : '创建用户', `${isEdit ? '编辑了' : '创建了'}用户 ${formData.username}`);

            showSuccessMessage(isEdit ? '用户编辑成功' : '用户创建成功');
        } else {
            // 对于编辑用户，如果错误信息是关于用户名已存在，我们可以忽略，因为用户名是不可修改的
            if (isEdit && responseData.message && responseData.message.includes('用户名已存在')) {
                // 忽略用户名已存在错误，继续处理
                console.log('忽略用户名已存在错误，继续处理编辑操作');
                await loadUsers();
                closeUserModal();
                document.getElementById('add-user-form').reset();
                addHistoryRecord('编辑用户', `编辑了用户 ${formData.username}`);
                showSuccessMessage('用户编辑成功');
            } else {
                showErrorMessage((isEdit ? '编辑' : '创建') + '用户失败: ' + (responseData.message || (isEdit ? '编辑失败' : '创建失败') + '，请稍后重试'));
            }
        }
    } catch (error) {
        console.error((isEdit ? '编辑' : '创建') + '用户错误:', error);
        showErrorMessage((isEdit ? '编辑' : '创建') + '用户失败: ' + error.message);
    } finally {
        hideLoading();
    }
}



// 用户管理分页状态
let usersCurrentPage = 1;
let usersPageSize = 20;
let usersTotal = 0;
let usersTotalPages = 0;
let currentSearchTerm = '';

// 加载用户列表
async function loadUsers(searchTerm = '', page = 1) {
    try {
        console.log('开始加载用户列表');

        currentSearchTerm = searchTerm;
        usersCurrentPage = page;

        let apiUrl = `/users/list?page=${page}&pageSize=${usersPageSize}`;
        if (searchTerm) {
            apiUrl += `&search=${encodeURIComponent(searchTerm)}`;
        }

        console.log('调用API:', apiUrl);
        const usersData = await apiRequest(apiUrl, { useCache: false });

        console.log('API响应:', usersData);

        if (Array.isArray(usersData)) {
            mockUsers = usersData;
            usersTotal = usersData.length;
            usersTotalPages = 1;
        } else if (usersData.success && usersData.users) {
            mockUsers = usersData.users;
            usersTotal = usersData.pagination?.total || usersData.users.length;
            usersTotalPages = usersData.pagination?.totalPages || 1;
        } else if (usersData.message) {
            console.log('后端返回错误信息:', usersData.message);
            mockUsers = [];
            usersTotal = 0;
            usersTotalPages = 0;
        } else {
            mockUsers = [];
            usersTotal = 0;
            usersTotalPages = 0;
        }

        updateUsersConfig();
        updateUsersPagination();

        console.log('用户列表加载完成');
    } catch (error) {
        console.error('加载用户列表失败:', error);
        mockUsers = [];
        updateUsersConfig();
    }
}

// 更新用户分页控件
function updateUsersPagination() {
    const paginationInfo = document.getElementById('users-pagination-info');
    const pageInfo = document.getElementById('users-page-info');
    const prevBtn = document.getElementById('users-prev-btn');
    const nextBtn = document.getElementById('users-next-btn');

    if (paginationInfo) {
        paginationInfo.textContent = `共 ${usersTotal} 条记录`;
    }
    if (pageInfo) {
        pageInfo.textContent = `第 ${usersCurrentPage} / ${usersTotalPages} 页`;
    }
    if (prevBtn) {
        prevBtn.disabled = usersCurrentPage <= 1;
    }
    if (nextBtn) {
        nextBtn.disabled = usersCurrentPage >= usersTotalPages;
    }
}

// 用户分页跳转
function goToUsersPage(direction) {
    if (direction === 'prev' && usersCurrentPage > 1) {
        loadUsers(currentSearchTerm, usersCurrentPage - 1);
    } else if (direction === 'next' && usersCurrentPage < usersTotalPages) {
        loadUsers(currentSearchTerm, usersCurrentPage + 1);
    }
}


// 更新用户管理页面
function updateUsersConfig() {
    const usersBody = document.getElementById('users-config-body');
    if (usersBody) {
        console.log('更新用户管理页面表格');

        if (mockUsers && mockUsers.length > 0) {
            usersBody.innerHTML = mockUsers.map(user => {
                const status = user.status || 'active';
                let statusLabel = '';
                let statusClass = '';

                if (status === 'pending') {
                    statusLabel = '待审核';
                    statusClass = 'status-pending';
                } else if (status === 'active') {
                    statusLabel = '正常';
                    statusClass = 'status-active';
                } else if (status === 'disabled') {
                    statusLabel = '已禁用';
                    statusClass = 'status-disabled';
                }

                const isAdmin = user.username && user.username.toLowerCase() === 'admin';

                // 角色显示映射（统一显示中文）
                const roleMap = {
                    'admin': '管理员',
                    'tester': '测试人员',
                    'viewer': '查看人员',
                    'developer': '开发人员',
                    'project_manager': '项目经理',
                    'test_manager': '测试经理',
                    'Administrator': '管理员'
                };
                const roleDisplay = roleMap[user.role] || user.role || '用户';

                let approveBtn = '';
                if (!isAdmin && status === 'pending') {
                    approveBtn = `<button class="config-action-btn approve" onclick="approveUser(${user.id}, 'active')" title="通过审核">通过</button>`;
                } else if (!isAdmin && status === 'disabled') {
                    approveBtn = `<button class="config-action-btn approve" onclick="approveUser(${user.id}, 'active')" title="启用账号">启用</button>`;
                }

                let disableBtn = '';
                if (!isAdmin && status === 'active') {
                    disableBtn = `<button class="config-action-btn disable" onclick="approveUser(${user.id}, 'disabled')" title="禁用账号">禁用</button>`;
                }

                let deleteBtn = '';
                if (!isAdmin) {
                    deleteBtn = `<button class="config-action-btn delete" onclick="deleteUser(${user.id})">删除</button>`;
                }

                return `
                    <tr data-user-id="${user.id}">
                        <td>${escapeHtml(user.username)}${isAdmin ? ' <span style="color:#6366f1;font-size:11px;">(系统)</span>' : ''}</td>
                        <td>${escapeHtml(roleDisplay)}</td>
                        <td>${escapeHtml(user.email)}</td>
                        <td><span class="status-tag ${statusClass}">${statusLabel}</span></td>
                        <td>${user.created_at ? formatDate(user.created_at) : '-'}</td>
                        <td>
                            <button class="config-action-btn edit" onclick="editUser(${user.id})">编辑</button>
                            ${approveBtn}
                            ${disableBtn}
                            ${deleteBtn}
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            usersBody.innerHTML = `
                <tr>
                    <td colspan="6" class="no-data">暂无用户</td>
                </tr>
            `;
        }
    } else {
        console.error('用户管理页面表格元素未找到');
    }
}

// 审核用户（通过/禁用/启用）
async function approveUser(userId, status) {
    try {
        // 检查是否为管理员禁用自己的账号
        if (status === 'disabled' && currentUser && currentUser.id === userId) {
            showErrorMessage('不能禁用自己的账号');
            return;
        }

        const statusText = status === 'active' ? (status === 'active' ? '启用' : '通过审核') : '禁用';

        if (!(await showConfirmMessage(`确定要${statusText}该用户吗？`))) {
            return;
        }

        showLoading('处理中...');

        const result = await apiRequest(`/users/${userId}/approve`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });

        hideLoading();

        if (result.success || result.message) {
            showSuccessMessage(result.message || '操作成功');
            await loadUsers();
        } else {
            showErrorMessage('操作失败');
        }
    } catch (error) {
        hideLoading();
        console.error('审核用户错误:', error);
        showErrorMessage('操作失败: ' + error.message);
    }
}

// 搜索用户（实时搜索)
let searchTimeout = null;
function debounceSearchUsers(value) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        loadUsers(value);
    }, 300);
}

async function searchUsersImmediate(searchTerm) {
    await loadUsers(searchTerm);
}

// 搜索用户
async function searchUsers() {
    const searchInput = document.getElementById('user-search-input');
    const searchTerm = searchInput ? searchInput.value.trim() : '';
    await loadUsers(searchTerm);
}

// 加载最近登录人员
async function loadRecentLogins() {
    try {
        console.log('加载最近登录人员');

        // 调用API获取真实的最近活动数据
        const historyData = await apiRequest('/history/list');

        if (historyData.success && historyData.history) {
            // 处理API返回的数据，确保格式正确
            const recentLogins = historyData.history.map((item, index) => ({
                rank: index + 1,
                username: item.username || '未知用户',
                role: item.role || '未知角色',
                loginTime: item.timestamp || item.time || new Date().toLocaleString(),
                lastAction: item.description || item.action || '未知操作',
                status: item.status || '离线'
            }));

            // 更新最近登录人员表格
            updateRecentLoginsTable(recentLogins);
        } else {
            // API调用失败，使用空数据
            updateRecentLoginsTable([]);
        }
    } catch (error) {
        console.error('加载最近登录人员失败:', error);
        // 错误情况下使用空数据
        updateRecentLoginsTable([]);
    }
}

// 更新最近登录人员表格
function updateRecentLoginsTable(logins) {
    const loginsBody = document.getElementById('recent-logins-body');
    if (loginsBody) {
        if (logins && logins.length > 0) {
            loginsBody.innerHTML = logins.map(login => {
                // 格式化时间
                let formattedTime = login.loginTime;
                if (formattedTime && formattedTime.includes('T')) {
                    formattedTime = formatDateTime(formattedTime);
                }

                return `
                <tr>
                    <td>${login.rank}</td>
                    <td>${login.username}</td>
                    <td>${login.role}</td>
                    <td>${formattedTime}</td>
                    <td>${login.lastAction}</td>
                    <td>${login.status}</td>
                </tr>
            `}).join('');
        } else {
            loginsBody.innerHTML = `
                <tr>
                    <td colspan="6" class="no-data">暂无操作记录</td>
                </tr>
            `;
        }
    }
}

// 初始化测试报告模态框步骤
function initTestReportModalSteps() {
    const nextBtn = document.getElementById('next-step-btn');
    const prevBtn = document.getElementById('prev-step-btn');
    const submitBtn = document.getElementById('submit-testreport-btn');

    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            goToNextStep();
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', function () {
            goToPrevStep();
        });
    }

    // 模板选择功能
    const templateItems = document.querySelectorAll('.template-item');
    templateItems.forEach(item => {
        item.addEventListener('click', function () {
            templateItems.forEach(t => t.classList.remove('selected'));
            this.classList.add('selected');
            const radio = this.querySelector('input[type="radio"]');
            if (radio) {
                radio.checked = true;
            }
        });
    });

    // 项目树展开/折叠功能
    initProjectTree();

    // 测试计划选择功能
    initTestPlanSelection();
}

// 初始化项目树
function initProjectTree() {
    const projectHeaders = document.querySelectorAll('.project-header');
    projectHeaders.forEach(header => {
        header.addEventListener('click', function () {
            const projectItem = this.closest('.project-item');
            if (projectItem) {
                const children = projectItem.querySelector('.project-children');
                if (children) {
                    projectItem.classList.toggle('expanded');
                    if (projectItem.classList.contains('expanded')) {
                        children.style.display = 'block';
                    } else {
                        children.style.display = 'none';
                    }
                }
            }
        });
    });

    // 项目选择功能
    const projectItems = document.querySelectorAll('.project-item');
    projectItems.forEach(item => {
        if (!item.querySelector('.project-header')) {
            item.addEventListener('click', function () {
                selectModalProject(item);
            });
        }
    });
}

// 选择模态框中的项目
function selectModalProject(projectItem) {
    if (!projectItem) return;

    // 移除其他项目的选中状态
    document.querySelectorAll('.project-item').forEach(item => {
        item.classList.remove('selected');
    });

    // 添加当前项目的选中状态
    projectItem.classList.add('selected');

    // 加载测试计划
    const projectNameElement = projectItem.querySelector('.project-name');
    if (projectNameElement) {
        loadTestPlansForProject(projectNameElement.textContent);
    }
}

// 为项目加载测试计划
function loadTestPlansForProject(projectName) {
    const tableBody = document.getElementById('test-plan-table-body');
    if (tableBody) {
        // 模拟测试计划数据
        const testPlans = [
            { name: 'SDK功能测试计划', owner: 'admin', status: '进行中', phase: '集成测试' },
            { name: 'SDK性能测试计划', owner: 'tester1', status: '未开始', phase: '性能测试' },
            { name: 'SDK兼容性测试计划', owner: 'admin', status: '已完成', phase: '兼容性测试' }
        ];

        if (testPlans.length > 0) {
            tableBody.innerHTML = testPlans.map((plan, index) => `
                <tr>
                    <td><input type="checkbox" class="test-plan-checkbox" data-plan="${index}"></td>
                    <td>${plan.name}</td>
                    <td>${plan.owner}</td>
                    <td>${plan.status}</td>
                    <td>${plan.phase}</td>
                </tr>
            `).join('');

            // 初始化测试计划复选框
            initTestPlanCheckboxes();
        } else {
            tableBody.innerHTML = `
                <tr class="no-data">
                    <td colspan="5">该项目下暂无测试计划</td>
                </tr>
            `;
        }
    }
}

// 初始化测试计划复选框
function initTestPlanCheckboxes() {
    const checkboxes = document.querySelectorAll('.test-plan-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function () {
            updateSelectedCount();
        });
    });

    // 全选功能
    const selectAll = document.querySelector('.select-all');
    if (selectAll) {
        selectAll.addEventListener('change', function () {
            checkboxes.forEach(checkbox => {
                checkbox.checked = this.checked;
            });
            updateSelectedCount();
        });
    }
}

// 更新已选测试计划数量
function updateSelectedCount() {
    const checkedBoxes = document.querySelectorAll('.test-plan-checkbox:checked');
    const count = checkedBoxes.length;
    const header = document.querySelector('.test-plan-header h4');
    if (header) {
        header.textContent = `测试计划列表（已选 ${count} 条）`;
    }
}

// 初始化测试计划选择
function initTestPlanSelection() {
    // 搜索功能
    const projectSearch = document.querySelector('.project-search');
    if (projectSearch) {
        projectSearch.addEventListener('input', function () {
            // 实现项目搜索功能
        });
    }

    const testPlanSearch = document.querySelector('.test-plan-search');
    if (testPlanSearch) {
        testPlanSearch.addEventListener('input', function () {
            // 实现测试计划搜索功能
        });
    }
}

// 进入下一步
function goToNextStep() {
    const currentStep = getCurrentStep();
    if (currentStep < 2) {
        showStep(currentStep + 1);
    }
}

// 进入上一步
function goToPrevStep() {
    const currentStep = getCurrentStep();
    if (currentStep > 1) {
        showStep(currentStep - 1);
    }
}

// 获取当前步骤
function getCurrentStep() {
    const activeStep = document.querySelector('.step-item.active');
    return activeStep ? parseInt(activeStep.dataset.step) : 1;
}

// 显示指定步骤
function showStep(stepNumber) {
    // 隐藏所有步骤内容
    document.querySelectorAll('.step-content').forEach(content => {
        content.style.display = 'none';
    });

    // 显示当前步骤内容
    const currentContent = document.querySelector(`.step-content[data-step="${stepNumber}"]`);
    if (currentContent) {
        currentContent.style.display = 'block';
    }

    // 更新步骤导航状态
    document.querySelectorAll('.step-item').forEach(item => {
        item.classList.remove('active');
        if (parseInt(item.dataset.step) === stepNumber) {
            item.classList.add('active');
        }
    });

    // 更新按钮状态
    const nextBtn = document.getElementById('next-step-btn');
    const prevBtn = document.getElementById('prev-step-btn');
    const submitBtn = document.getElementById('submit-testreport-btn');

    if (stepNumber === 1) {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'inline-block';
        submitBtn.style.display = 'none';
    } else if (stepNumber === 2) {
        prevBtn.style.display = 'inline-block';
        nextBtn.style.display = 'none';
        submitBtn.style.display = 'inline-block';
    }
}

// 添加用例
function addTestCase() {
    openAddTestCaseModal();
}

function batchCreateTestCases() {
    if (!selectedModuleId) {
        openBatchCreateSelectModal();
        return;
    }
    
    const currentLibraryIdVal = currentCaseLibraryId || '';
    let currentLibraryNameVal = '';
    const currentModuleNameVal = window.currentModule ? window.currentModule.name : '';
    
    if (caseLibraries && currentCaseLibraryId) {
        const currentLib = caseLibraries.find(lib => lib.id == currentCaseLibraryId);
        if (currentLib) {
            currentLibraryNameVal = currentLib.name || '';
        }
    }
    
    let url = `/batch-create-cases.html?moduleId=${selectedModuleId}&libraryId=${currentLibraryIdVal}&moduleName=${encodeURIComponent(currentModuleNameVal)}&libraryName=${encodeURIComponent(currentLibraryNameVal)}&returnUrl=${encodeURIComponent(window.location.href)}`;
    
    if (selectedLevel1PointId) {
        url += `&level1Id=${selectedLevel1PointId}&level1Name=${encodeURIComponent(selectedLevel1PointName || '')}`;
    }
    
    // 在新浏览器页签中打开批量创建页面
    window.open(url, '_blank');
}

let batchCreateSelectedLibrary = null;
let batchCreateSelectedModule = null;
let batchCreateSelectedLevel1 = null;

async function openBatchCreateSelectModal() {
    let modal = document.getElementById('batch-create-select-modal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'batch-create-select-modal';
        modal.className = 'modal';
        modal.style.cssText = 'display: none; z-index: 99999;';
        modal.innerHTML = `
            <div class="modal-overlay" onclick="closeBatchCreateSelectModal()"></div>
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>选择创建位置</h3>
                    <span class="close" onclick="closeBatchCreateSelectModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">用例库 <span style="color: #ff4d4f;">*</span></label>
                        <select id="batch-select-library" class="form-control" style="width: 100%; padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px;" onchange="onBatchSelectLibrary(this.value)">
                            <option value="">请选择用例库</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">模块 <span style="color: #ff4d4f;">*</span></label>
                        <select id="batch-select-module" class="form-control" style="width: 100%; padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px;" onchange="onBatchSelectModule(this.value)" disabled>
                            <option value="">请先选择用例库</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">一级测试点 <span style="color: #999;">(可选)</span></label>
                        <select id="batch-select-level1" class="form-control" style="width: 100%; padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px;" onchange="onBatchSelectLevel1(this.value)" disabled>
                            <option value="">请先选择模块</option>
                        </select>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding: 12px 24px; border-top: 1px solid #f0f0f0; background: #fafafa;">
                    <button class="btn btn-secondary" onclick="closeBatchCreateSelectModal()">取消</button>
                    <button class="btn btn-primary" id="batch-create-confirm-btn" onclick="confirmBatchCreate()">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    batchCreateSelectedLibrary = null;
    batchCreateSelectedModule = null;
    batchCreateSelectedLevel1 = null;
    
    const librarySelect = document.getElementById('batch-select-library');
    const moduleSelect = document.getElementById('batch-select-module');
    const level1Select = document.getElementById('batch-select-level1');
    
    librarySelect.innerHTML = '<option value="">请选择用例库</option>';
    moduleSelect.innerHTML = '<option value="">请先选择用例库</option>';
    moduleSelect.disabled = true;
    level1Select.innerHTML = '<option value="">请先选择模块</option>';
    level1Select.disabled = true;
    
    try {
        const result = await apiRequest('/libraries/list', { useCache: false });
        if (result.success && result.libraries) {
            result.libraries.forEach(lib => {
                const option = document.createElement('option');
                option.value = lib.id;
                option.textContent = lib.name;
                option.dataset.name = lib.name;
                if (currentCaseLibraryId && lib.id == currentCaseLibraryId) {
                    option.selected = true;
                }
                librarySelect.appendChild(option);
            });
            
            if (currentCaseLibraryId) {
                await onBatchSelectLibrary(currentCaseLibraryId);
            }
        }
    } catch (error) {
        console.error('加载用例库列表失败:', error);
    }
    
    modal.style.display = 'flex';
}

function closeBatchCreateSelectModal() {
    const modal = document.getElementById('batch-create-select-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function onBatchSelectLibrary(libraryId) {
    const moduleSelect = document.getElementById('batch-select-module');
    const level1Select = document.getElementById('batch-select-level1');
    
    batchCreateSelectedLibrary = null;
    batchCreateSelectedModule = null;
    batchCreateSelectedLevel1 = null;
    
    level1Select.innerHTML = '<option value="">请先选择模块</option>';
    level1Select.disabled = true;
    
    if (!libraryId) {
        moduleSelect.innerHTML = '<option value="">请先选择用例库</option>';
        moduleSelect.disabled = true;
        return;
    }
    
    const librarySelect = document.getElementById('batch-select-library');
    const selectedOption = librarySelect.options[librarySelect.selectedIndex];
    batchCreateSelectedLibrary = {
        id: libraryId,
        name: selectedOption.dataset.name || selectedOption.textContent
    };
    
    moduleSelect.innerHTML = '<option value="">加载中...</option>';
    moduleSelect.disabled = true;
    
    try {
        const result = await apiRequest('/modules/list', {
            method: 'POST',
            body: JSON.stringify({ libraryId: libraryId, page: 1, pageSize: 1000 })
        });
        
        moduleSelect.innerHTML = '<option value="">请选择模块</option>';
        
        if (result.success && result.modules && result.modules.length > 0) {
            result.modules.forEach(mod => {
                const option = document.createElement('option');
                option.value = mod.id;
                option.textContent = mod.name;
                option.dataset.name = mod.name;
                moduleSelect.appendChild(option);
            });
            moduleSelect.disabled = false;
        } else {
            moduleSelect.innerHTML = '<option value="">该用例库下暂无模块</option>';
        }
    } catch (error) {
        console.error('加载模块列表失败:', error);
        moduleSelect.innerHTML = '<option value="">加载失败</option>';
    }
}

async function onBatchSelectModule(moduleId) {
    const level1Select = document.getElementById('batch-select-level1');
    
    batchCreateSelectedModule = null;
    batchCreateSelectedLevel1 = null;
    
    if (!moduleId) {
        level1Select.innerHTML = '<option value="">请先选择模块</option>';
        level1Select.disabled = true;
        return;
    }
    
    const moduleSelect = document.getElementById('batch-select-module');
    const selectedOption = moduleSelect.options[moduleSelect.selectedIndex];
    batchCreateSelectedModule = {
        id: moduleId,
        name: selectedOption.dataset.name || selectedOption.textContent
    };
    
    level1Select.innerHTML = '<option value="">加载中...</option>';
    level1Select.disabled = true;
    
    try {
        const result = await apiRequest(`/testpoints/level1/${moduleId}`, { useCache: false });
        
        level1Select.innerHTML = '<option value="">不指定（可选）</option>';
        
        if (result.success && result.level1Points && result.level1Points.length > 0) {
            result.level1Points.forEach(l1 => {
                const option = document.createElement('option');
                option.value = l1.id;
                option.textContent = l1.name;
                option.dataset.name = l1.name;
                level1Select.appendChild(option);
            });
            level1Select.disabled = false;
        } else {
            level1Select.innerHTML = '<option value="">该模块下暂无一级测试点</option>';
            level1Select.disabled = false;
        }
    } catch (error) {
        console.error('加载一级测试点列表失败:', error);
        level1Select.innerHTML = '<option value="">加载失败</option>';
        level1Select.disabled = false;
    }
}

function onBatchSelectLevel1(level1Id) {
    if (!level1Id) {
        batchCreateSelectedLevel1 = null;
        return;
    }
    
    const level1Select = document.getElementById('batch-select-level1');
    const selectedOption = level1Select.options[level1Select.selectedIndex];
    batchCreateSelectedLevel1 = {
        id: level1Id,
        name: selectedOption.dataset.name || selectedOption.textContent
    };
}

async function confirmBatchCreate() {
    if (!batchCreateSelectedLibrary || !batchCreateSelectedModule) {
        showErrorMessage('请选择用例库和模块');
        return;
    }
    
    const libraryId = batchCreateSelectedLibrary.id;
    const libraryName = batchCreateSelectedLibrary.name;
    const moduleId = batchCreateSelectedModule.id;
    const moduleName = batchCreateSelectedModule.name;
    const level1Id = batchCreateSelectedLevel1 ? batchCreateSelectedLevel1.id : '';
    const level1Name = batchCreateSelectedLevel1 ? batchCreateSelectedLevel1.name : '';
    
    closeBatchCreateSelectModal();
    
    let url = `/batch-create-cases.html?moduleId=${moduleId}&libraryId=${libraryId}&moduleName=${encodeURIComponent(moduleName)}&libraryName=${encodeURIComponent(libraryName)}&returnUrl=${encodeURIComponent(window.location.href)}`;
    
    if (level1Id) {
        url += `&level1Id=${level1Id}&level1Name=${encodeURIComponent(level1Name)}`;
    }
    
    window.location.href = url;
}

// 加载测试阶段列表用于测试用例创建
async function loadTestPhasesForTestCase() {
    try {
        const phaseSelect = document.getElementById('case-phases');
        if (!phaseSelect) {
            console.error('case-phases element not found');
            return;
        }

        const response = await apiRequest('/test-phases/list', { useCache: false });

        if (response.success) {
            phaseSelect.innerHTML = '';
            response.testPhases.forEach(phase => {
                const option = document.createElement('option');
                option.value = phase.id || phase.phase_id;
                option.textContent = phase.name;
                phaseSelect.appendChild(option);
            });
        } else {
            console.error('加载测试阶段列表失败:', response.message);
            phaseSelect.innerHTML = '<option value="">加载测试阶段失败</option>';
        }
    } catch (error) {
        console.error('加载测试阶段列表错误:', error);
        const phaseSelect = document.getElementById('case-phases');
        if (phaseSelect) {
            phaseSelect.innerHTML = '<option value="">加载测试阶段失败</option>';
        }
    }
}

// 当前新建用例步骤
let currentAddCaseStep = 1;
const totalAddCaseSteps = 3;

// 打开测试用例创建模态框（支持关联到选中模块）
async function openAddTestCaseModal() {
    try {
        // 检查是否已选择模块
        if (!selectedModuleId) {
            showErrorMessage('请先选择一个模块，然后再创建测试用例');
            return;
        }

        const modal = document.getElementById('add-case-modal');
        if (!modal) {
            console.error('add-case-modal element not found');
            return;
        }

        console.log('[新建用例] 已选择模块ID:', selectedModuleId);

        // 重置步骤
        currentAddCaseStep = 1;
        updateAddCaseStepUI();

        modal.style.display = 'block';

        // 并行加载数据
        const [phasesData, environmentsData, methodsData, typesData, sourcesData, prioritiesData] = await Promise.all([
            apiRequest('/test-phases/list').catch(e => ({ success: false, testPhases: [] })),
            apiRequest('/environments/list').catch(e => ({ success: false, environments: [] })),
            apiRequest('/test-methods/list').catch(e => ({ success: false, testMethods: [] })),
            apiRequest('/test-types/list').catch(e => ({ success: false, testTypes: [] })),
            apiRequest('/test-sources/list').catch(e => ({ success: false, sources: [] })),
            apiRequest('/priorities/list').catch(e => ({ success: false, priorities: [] }))
        ]);

        // 初始化测试阶段选择器
        const phasesList = phasesData.testPhases || [];
        const phaseOptions = phasesList.map(phase => ({
            value: String(phase.id || phase.phase_id),
            label: phase.name
        }));
        TagSelector.init('case-phases-selector', phaseOptions, []);

        // 初始化测试环境选择器
        const envList = environmentsData.environments || environmentsData || [];
        const envOptions = envList.map(env => ({
            value: String(env.id || env.env_id),
            label: env.name
        }));
        TagSelector.init('case-environments-selector', envOptions, []);

        // 初始化测试方式选择器
        const methodsList = methodsData.testMethods || methodsData || [];
        const methodOptions = methodsList.map(method => ({
            value: String(method.id || method.method_id),
            label: method.name
        }));
        TagSelector.init('case-methods-selector', methodOptions, []);

        // 初始化测试点来源选择器
        const sourcesList = sourcesData.sources || [];
        const sourceOptions = sourcesList.map(source => ({
            value: String(source.id || source.source_id),
            label: source.name
        }));
        TagSelector.init('case-sources-selector', sourceOptions, []);

        // 加载测试类型
        const testTypeSelect = document.getElementById('case-type');
        if (testTypeSelect) {
            const typesList = typesData.testTypes || [];
            testTypeSelect.innerHTML = typesList.map(type =>
                `<option value="${type.name}">${type.name}</option>`
            ).join('') || '<option value="功能测试">功能测试</option>';
        }

        // 加载优先级
        const prioritySelect = document.getElementById('case-priority');
        if (prioritySelect) {
            const prioritiesList = prioritiesData.priorities || [];
            if (prioritiesList.length > 0) {
                prioritySelect.innerHTML = prioritiesList.map(priority =>
                    `<option value="${priority.name}">${priority.name}${priority.description ? ' - ' + priority.description : ''}</option>`
                ).join('');
                prioritySelect.value = prioritiesList[0].name;
            } else {
                prioritySelect.innerHTML = `
                    <option value="P0">P0 - 阻塞级</option>
                    <option value="P1">P1 - 严重级</option>
                    <option value="P2" selected>P2 - 一般级</option>
                    <option value="P3">P3 - 提示级</option>
                `;
            }
        }

        // 设置负责人默认值为当前登录用户
        const caseOwner = document.getElementById('case-owner');
        if (caseOwner) {
            caseOwner.value = currentUser ? currentUser.username : 'admin';
        }

        // 如果有选中的模块，确保测试用例能关联到该模块
        if (selectedModuleId) {
            console.log('打开测试用例创建模态框，关联到模块:', selectedModuleId);
        }

        // 更新关联项目摘要
        updateNewCaseProjectsSummary();
        
        // 初始化模态框拖拽调整宽度
        initAddCaseModalResizer();

    } catch (error) {
        console.error('Error in openAddTestCaseModal:', error);
        console.error('Error stack:', error.stack);
    }
}

// 更新步骤UI
function updateAddCaseStepUI() {
    // 更新步骤指示器
    document.querySelectorAll('.ac-step').forEach((step, index) => {
        const stepNum = index + 1;
        step.classList.remove('active', 'completed');
        if (stepNum < currentAddCaseStep) {
            step.classList.add('completed');
        } else if (stepNum === currentAddCaseStep) {
            step.classList.add('active');
        }
    });

    // 更新步骤连接线
    document.querySelectorAll('.ac-step-line').forEach((line, index) => {
        const lineNum = index + 1;
        line.classList.toggle('completed', lineNum < currentAddCaseStep);
    });

    // 更新步骤内容
    document.querySelectorAll('.ac-step-content').forEach((content, index) => {
        content.classList.toggle('active', index + 1 === currentAddCaseStep);
    });

    // 更新按钮显示
    const prevBtn = document.getElementById('ac-prev-btn');
    const nextBtn = document.getElementById('ac-next-btn');
    const submitBtn = document.getElementById('ac-submit-btn');

    if (prevBtn) prevBtn.style.display = currentAddCaseStep > 1 ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = currentAddCaseStep < totalAddCaseSteps ? 'flex' : 'none';
    if (submitBtn) submitBtn.style.display = currentAddCaseStep === totalAddCaseSteps ? 'flex' : 'none';

    // 如果切换到步骤3（关联项目），更新关联项目摘要
    if (currentAddCaseStep === 3) {
        console.log('[关联项目] 切换到步骤3，更新关联项目摘要');
        updateNewCaseProjectsSummary();
    }
}

// 下一步
function nextAddCaseStep() {
    // 验证当前步骤
    if (!validateAddCaseStep(currentAddCaseStep)) {
        return;
    }

    if (currentAddCaseStep < totalAddCaseSteps) {
        currentAddCaseStep++;
        updateAddCaseStepUI();
    }
}

// 上一步
function prevAddCaseStep() {
    if (currentAddCaseStep > 1) {
        currentAddCaseStep--;
        updateAddCaseStepUI();
    }
}

// 验证步骤
function validateAddCaseStep(step) {
    if (step === 1) {
        const caseName = document.getElementById('case-name');
        const caseOwner = document.getElementById('case-owner');

        if (!caseName || !caseName.value.trim()) {
            showErrorMessage('请输入用例名称');
            caseName?.focus();
            return false;
        }

        if (!caseOwner || !caseOwner.value.trim()) {
            showErrorMessage('请输入负责人');
            caseOwner?.focus();
            return false;
        }

        // 验证测试环境和测试方式
        const envValues = TagSelector.getValues('case-environments-selector');
        const methodValues = TagSelector.getValues('case-methods-selector');

        if (envValues.length === 0) {
            showErrorMessage('请选择至少一个测试环境');
            return false;
        }

        if (methodValues.length === 0) {
            showErrorMessage('请选择至少一个测试方式');
            return false;
        }
    }

    return true;
}

// 更新新建用例的项目关联摘要
function updateNewCaseProjectsSummary() {
    const summaryContainer = document.getElementById('new-case-projects-summary');
    if (!summaryContainer) {
        console.error('[关联项目] 未找到 new-case-projects-summary 元素');
        return;
    }

    // 从localStorage获取临时关联项目
    const tempAssociations = JSON.parse(localStorage.getItem('tempProjectAssociations') || '[]');
    console.log('[关联项目] 从localStorage读取到的数据:', tempAssociations);
    console.log('[关联项目] 关联项目数量:', tempAssociations.length);

    if (tempAssociations.length === 0) {
        console.log('[关联项目] 没有关联项目，显示空状态');
        summaryContainer.innerHTML = `
            <div class="ac-projects-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <p>暂未关联项目</p>
                <button type="button" onclick="editProjectAssociations()" class="btn btn-sm btn-primary">添加关联</button>
            </div>
        `;
    } else {
        console.log('[关联项目] 有关联项目，显示列表');
        summaryContainer.innerHTML = `
            <div class="ac-projects-table">
                <table class="projects-summary-table">
                    <thead>
                        <tr>
                            <th>项目</th>
                            <th>负责人</th>
                            <th>进度</th>
                            <th>状态</th>
                            <th>备注</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tempAssociations.map(assoc => {
            console.log('[关联项目] 渲染关联项目:', assoc);
            const statusClass = assoc.status_id == 1 ? 'status-pending' : assoc.status_id == 3 ? 'status-completed' : 'status-active';
            const statusText = assoc.status_id == 1 ? '待开始' : assoc.status_id == 3 ? '已完成' : '进行中';
            return `
                            <tr>
                                <td><span class="project-name">项目 #${assoc.project_id}</span></td>
                                <td>${assoc.owner || '-'}</td>
                                <td>${assoc.progress_id ? `进度 ${assoc.progress_id}` : '-'}</td>
                                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                                <td>${assoc.remark || '-'}</td>
                            </tr>
                        `;
        }).join('')}
                    </tbody>
                </table>
            </div>
            <div style="margin-top: 12px;">
                <button type="button" onclick="editProjectAssociations()" class="btn btn-sm btn-secondary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    编辑关联
                </button>
            </div>
        `;
    }
}

// 加载测试类型列表用于测试用例创建
async function loadTestTypesForTestCase() {
    try {
        const testTypeSelect = document.getElementById('case-type');
        if (!testTypeSelect) {
            console.error('case-type element not found');
            return;
        }

        // 显示加载状态
        testTypeSelect.innerHTML = `
            <option value="">加载测试类型中...</option>
        `;

        // 调用API加载测试类型
        console.log('开始调用API获取测试类型列表...');
        try {
            const testTypesData = await apiRequest('/test-types/list');
            console.log('API返回结果:', testTypesData);

            if (testTypesData && testTypesData.success && Array.isArray(testTypesData.testTypes)) {
                // 清空现有选项
                testTypeSelect.innerHTML = '';

                console.log('获取到测试类型数量:', testTypesData.testTypes.length);

                // 添加测试类型选项
                testTypesData.testTypes.forEach(type => {
                    console.log('添加测试类型:', type);
                    const option = document.createElement('option');
                    option.value = type.name; // 使用名称作为value，与test_cases表的type字段兼容
                    option.textContent = type.name;
                    testTypeSelect.appendChild(option);
                });

                // 默认选中第一个选项
                if (testTypesData.testTypes.length > 0) {
                    testTypeSelect.value = testTypesData.testTypes[0].name;
                }
            } else {
                console.error('API返回数据格式不符合预期:', testTypesData);
                // 加载失败时使用默认选项
                testTypeSelect.innerHTML = `
                    <option value="功能测试">功能测试</option>
                    <option value="性能测试">性能测试</option>
                    <option value="兼容性测试">兼容性测试</option>
                    <option value="安全测试">安全测试</option>
                `;
            }
        } catch (apiError) {
            console.error('调用API获取测试类型失败:', apiError);
            // API调用失败时使用默认选项
            testTypeSelect.innerHTML = `
                <option value="功能测试">功能测试</option>
                <option value="性能测试">性能测试</option>
                <option value="兼容性测试">兼容性测试</option>
                <option value="安全测试">安全测试</option>
            `;
        }
    } catch (error) {
        console.error('加载测试类型列表错误:', error);
        console.error('错误堆栈:', error.stack);

        // 加载失败时使用默认选项
        const testTypeSelect = document.getElementById('case-type');
        if (testTypeSelect) {
            testTypeSelect.innerHTML = `
                <option value="功能测试">功能测试</option>
                <option value="性能测试">性能测试</option>
                <option value="兼容性测试">兼容性测试</option>
                <option value="安全测试">安全测试</option>
            `;
        }
    }
}

// 加载测试环境列表用于测试用例创建
async function loadEnvironmentsForTestCase() {
    try {
        const environmentSelect = document.getElementById('case-environments');
        if (!environmentSelect) {
            console.error('case-environments element not found');
            return;
        }

        // 显示加载状态
        environmentSelect.innerHTML = `
            <option value="">加载测试环境中...</option>
        `;

        // 调用API加载环境
        const environmentsData = await apiRequest('/environments/list');

        let environmentList = [];
        if (environmentsData.success && environmentsData.environments) {
            environmentList = environmentsData.environments;
        } else if (Array.isArray(environmentsData)) {
            // 兼容旧版本API直接返回环境数组
            environmentList = environmentsData;
        }

        // 更新下拉选项
        environmentSelect.innerHTML = `
            ${environmentList.map(env => `
                <option value="${env.id || env.env_id}">${env.name}</option>
            `).join('')}
        `;

    } catch (error) {
        console.error('加载测试环境列表错误:', error);
        const environmentSelect = document.getElementById('case-environments');
        if (environmentSelect) {
            environmentSelect.innerHTML = `
                <option value="">加载环境失败，请刷新重试</option>
            `;
        }
    }
}

// 加载测试方式列表用于测试用例创建
async function loadTestMethodsForTestCase() {
    try {
        const methodSelect = document.getElementById('case-methods');
        if (!methodSelect) {
            console.error('case-methods element not found');
            return;
        }

        // 显示加载状态
        methodSelect.innerHTML = `
            <option value="">加载测试方式中...</option>
        `;

        // 调用API加载测试方式
        const methodsData = await apiRequest('/test-methods/list');

        let methodList = [];
        if (methodsData.success && methodsData.testMethods) {
            methodList = methodsData.testMethods;
        } else if (Array.isArray(methodsData)) {
            // 兼容旧版本API直接返回测试方式数组
            methodList = methodsData;
        }

        // 更新下拉选项
        methodSelect.innerHTML = `
            ${methodList.map(method => `
                <option value="${method.id}">${method.name}</option>
            `).join('')}
        `;

    } catch (error) {
        console.error('加载测试方式列表错误:', error);
        const methodSelect = document.getElementById('case-methods');
        if (methodSelect) {
            methodSelect.innerHTML = `
                <option value="">加载测试方式失败，请刷新重试</option>
            `;
        }
    }
}

// 加载功能模块列表用于测试用例创建
async function loadModulesForTestCase() {
    try {
        const moduleSelect = document.getElementById('case-module');
        if (!moduleSelect) {
            console.error('case-module element not found');
            return;
        }

        // 显示加载状态
        moduleSelect.innerHTML = `
            <option value="">加载模块中...</option>
        `;

        // 调用API加载模块
        const modulesData = await apiRequest('/modules/list', {
            method: 'POST',
            body: JSON.stringify({
                libraryId: currentCaseLibraryId || 1,
                page: 1,
                pageSize: 100
            })
        });

        let moduleList = [];
        if (modulesData.success && modulesData.modules) {
            moduleList = modulesData.modules;
        } else {
            // 使用默认模块数据
            moduleList = [
                { id: 1, name: 'IPC' },
                { id: 2, name: '无线编解码' },
                { id: 3, name: '云平台管理' }
            ];
        }

        // 渲染模块列表
        if (moduleList.length === 0) {
            moduleSelect.innerHTML = `
                <option value="">暂无模块</option>
            `;
        } else {
            let options = `<option value="">请选择功能模块</option>`;
            moduleList.forEach(module => {
                options += `<option value="${module.id}">${module.name}</option>`;
            });
            moduleSelect.innerHTML = options;
        }
    } catch (error) {
        console.error('加载模块列表错误:', error);
        const moduleSelect = document.getElementById('case-module');
        if (moduleSelect) {
            moduleSelect.innerHTML = `
                <option value="">加载模块失败</option>
            `;
        }
    }
}

// 加载项目列表用于关联
// 加载测试进度列表
async function loadTestProgresses() {
    try {
        const response = await apiRequest('/test-progresses/list', { useCache: false });
        console.log('loadTestProgresses API返回:', response);
        // 处理多种可能的数据结构
        let testProgresses = [];
        if (response.success && response.data && response.data.success) {
            // 嵌套结构：{ status: 200, data: { success: true, testProgresses: [...] }, success: true }
            testProgresses = response.data.testProgresses || [];
        } else if (response.data && response.data.success) {
            // 嵌套结构：{ data: { success: true, testProgresses: [...] } }
            testProgresses = response.data.testProgresses || [];
        } else if (response.success && response.testProgresses) {
            // 直接结构：{ success: true, testProgresses: [...] }
            testProgresses = response.testProgresses || [];
        } else if (Array.isArray(response)) {
            // 直接返回数组
            testProgresses = response;
        } else if (response.success && Array.isArray(response.data)) {
            // 结构：{ success: true, data: [...] }
            testProgresses = response.data;
        } else if (Array.isArray(response.data)) {
            // 结构：{ data: [...] }
            testProgresses = response.data;
        }

        console.log('解析后的testProgresses:', testProgresses);
        return testProgresses;
    } catch (error) {
        console.error('加载测试进度列表错误:', error);
        // 使用默认测试进度数据
        const defaultProgresses = [
            { id: 1, progress_id: 1, name: '已完成' },
            { id: 2, progress_id: 2, name: '未开始' },
            { id: 3, progress_id: 3, name: '测试中' }
        ];
        console.log('使用默认测试进度数据:', defaultProgresses);
        return defaultProgresses;
    }
}

// 加载测试状态列表
async function loadTestStatuses() {
    try {
        const response = await apiRequest('/test-statuses/list', { useCache: false });
        console.log('loadTestStatuses API返回:', response);
        // 处理多种可能的数据结构
        let testStatuses = [];
        if (response.success && response.data && response.data.success) {
            // 嵌套结构：{ status: 200, data: { success: true, testStatuses: [...] }, success: true }
            testStatuses = response.data.testStatuses || [];
        } else if (response.data && response.data.success) {
            // 嵌套结构：{ data: { success: true, testStatuses: [...] } }
            testStatuses = response.data.testStatuses || [];
        } else if (response.success && response.testStatuses) {
            // 直接结构：{ success: true, testStatuses: [...] }
            testStatuses = response.testStatuses || [];
        } else if (Array.isArray(response)) {
            // 直接返回数组
            testStatuses = response;
        } else if (response.success && Array.isArray(response.data)) {
            // 结构：{ success: true, data: [...] }
            testStatuses = response.data;
        } else if (Array.isArray(response.data)) {
            // 结构：{ data: [...] }
            testStatuses = response.data;
        }

        console.log('解析后的testStatuses:', testStatuses);
        return testStatuses;
    } catch (error) {
        console.error('加载测试状态列表错误:', error);
        // 使用默认测试状态数据
        const defaultStatuses = [
            { id: 1, status_id: 1, name: 'PASS' },
            { id: 2, status_id: 2, name: 'FAIL' },
            { id: 3, status_id: 3, name: 'BLOCK' }
        ];
        console.log('使用默认测试状态数据:', defaultStatuses);
        return defaultStatuses;
    }
}

// 加载项目列表用于新建测试用例
async function loadProjectsForAssociation() {
    try {
        const container = document.getElementById('new-case-projects-container');

        if (!container) {
            // 容器不存在，显示普通日志，不显示错误信息
            console.log('关联项目容器不存在，跳过加载');
            return;
        }

        // 显示加载状态
        container.innerHTML = '<div style="text-align: center; color: #909399; padding: 20px;">加载项目中...</div>';

        // 并行加载数据，但允许单个请求失败
        let projectsData = { success: false, projects: [] };
        let testProgresses = [];
        let testStatuses = [];

        try {
            projectsData = await apiRequest('/projects/list');
        } catch (error) {
            console.error('加载项目列表错误:', error);
        }

        try {
            testProgresses = await loadTestProgresses();
        } catch (error) {
            console.error('加载测试进度错误:', error);
        }

        try {
            testStatuses = await loadTestStatuses();
        } catch (error) {
            console.error('加载测试状态错误:', error);
        }

        let projectList = [];
        // 处理API返回的嵌套结构
        if (projectsData.success && projectsData.data && projectsData.data.success && projectsData.data.projects) {
            projectList = projectsData.data.projects;
        } else if (projectsData.data && projectsData.data.success && projectsData.data.projects) {
            projectList = projectsData.data.projects;
        } else if (projectsData.success && projectsData.projects) {
            projectList = projectsData.projects;
        } else if (Array.isArray(projectsData)) {
            projectList = projectsData;
        } else if (projectsData.success && Array.isArray(projectsData.data)) {
            projectList = projectsData.data;
        } else if (Array.isArray(projectsData.data)) {
            projectList = projectsData.data;
        } else {
            // 使用默认项目数据
            projectList = [
                { id: 1, name: 'CTCSDK项目', creator: 'admin', createdAt: '2026-01-01' },
                { id: 2, name: 'U12芯片项目', creator: 'zhaosz', createdAt: '2026-01-14' }
            ];
        }

        // 渲染项目列表
        if (projectList.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #909399; padding: 20px;">暂无项目</div>';
        } else {
            const projectsHtml = projectList.map(project => `
                <div class="project-item">
                    <label>
                        <!-- 注释掉复选框，不显示 -->
                        <!-- <input type="checkbox" name="project-${project.id}" value="${project.id}"> -->
                        ${project.name || '未命名项目'}
                    </label>
                    <select name="progress-${project.id}">
                        ${testProgresses.map(progress => `
                            <option value="${progress.id || progress.progress_id}">${progress.name}</option>
                        `).join('')}
                    </select>
                    <select name="status-${project.id}">
                        ${testStatuses.map(status => `
                            <option value="${status.id || status.status_id}">${status.name}</option>
                        `).join('')}
                    </select>
                    <textarea name="remark-${project.id}" placeholder="请输入备注" maxlength="256" rows="1" style="width: 100%;"></textarea>
                </div>
            `).join('');
            container.innerHTML = projectsHtml;
        }
    } catch (error) {
        console.error('加载项目列表错误:', error);
        const container = document.getElementById('new-case-projects-container');

        if (container) {
            container.innerHTML = '<div style="text-align: center; color: #f56c6c; padding: 20px;">加载项目失败</div>';
        }
    }
}

// 打开编辑关联项目模态框
function editProjectAssociations() {
    try {
        // 调试信息：函数被调用
        console.log('editProjectAssociations 函数被调用');

        // 获取当前编辑的测试用例ID
        const caseIdInput = document.getElementById('detail-case-id');

        // 调试信息：输出caseIdInput元素
        console.log('caseIdInput 元素:', caseIdInput);

        // 调试信息：输出caseIdInput的值
        if (caseIdInput) {
            console.log('caseIdInput.value:', caseIdInput.value);
        } else {
            console.log('caseIdInput 为 null/undefined');
        }

        // 如果找不到元素或者值为空，设置为'new'表示新建操作
        if (caseIdInput && caseIdInput.value) {
            currentEditingTestCaseId = caseIdInput.value;
        } else {
            console.log('未找到测试用例ID，按新建操作处理');
            currentEditingTestCaseId = 'new';
        }

        // 调试信息：输出最终的currentEditingTestCaseId
        console.log('最终的 currentEditingTestCaseId:', currentEditingTestCaseId);

        // 显示模态框
        const modal = document.getElementById('edit-project-associations-modal');
        if (modal) {
            // 更新模态框标题
            const title = modal.querySelector('.modal-header h3');
            if (title) {
                // 检查当前操作是新建还是编辑
                const isNewTestCase = currentEditingTestCaseId === 'new' || currentEditingTestCaseId === '';
                title.textContent = isNewTestCase ? '新建用例编辑关联项目页面' : '编辑用例关联项目页面';
            }
            modal.style.display = 'block';
        } else {
            throw new Error('无法找到编辑关联项目模态框');
        }

        // 加载项目数据到模态框
        loadProjectsForEditModal();
    } catch (error) {
        console.error('打开编辑关联项目模态框错误:', error);
        showErrorMessage('打开编辑关联项目模态框失败: ' + error.message);
    }
}

// 当前正在编辑的测试用例ID
let currentEditingTestCaseId = null;

// 打开编辑用例项目关联模态框
function openEditTestCaseProjectAssociationsModal() {
    try {
        // 调试信息：函数被调用
        console.log('openEditTestCaseProjectAssociationsModal 函数被调用');

        // 获取当前编辑的测试用例ID
        const caseIdInput = document.getElementById('detail-case-id');

        // 调试信息：输出caseIdInput元素
        console.log('caseIdInput 元素:', caseIdInput);

        // 调试信息：输出caseIdInput的值
        if (caseIdInput) {
            console.log('caseIdInput.value:', caseIdInput.value);
        } else {
            console.log('caseIdInput 为 null/undefined');
        }

        // 如果找不到元素或者值为空，设置为'new'表示新建操作
        if (caseIdInput && caseIdInput.value) {
            currentEditingTestCaseId = caseIdInput.value;
        } else {
            console.log('未找到测试用例ID，按新建操作处理');
            currentEditingTestCaseId = 'new';
        }

        // 调试信息：输出最终的currentEditingTestCaseId
        console.log('最终的 currentEditingTestCaseId:', currentEditingTestCaseId);

        // 打开模态框
        const modal = document.getElementById('edit-project-associations-modal');
        if (modal) {
            // 更新模态框标题
            const title = modal.querySelector('.modal-header h3');
            if (title) {
                // 检查当前操作是新建还是编辑
                const isNewTestCase = currentEditingTestCaseId === 'new' || currentEditingTestCaseId === '';
                title.textContent = isNewTestCase ? '新建用例编辑关联项目页面' : '编辑用例关联项目页面';
            }

            // 显示模态框
            modal.style.display = 'block';

            // 加载项目列表用于编辑
            loadProjectsForEditModal();
        } else {
            throw new Error('无法找到编辑关联项目模态框');
        }
    } catch (error) {
        console.error('打开编辑用例项目关联模态框失败:', error);
        showErrorMessage('打开编辑用例项目关联模态框失败: ' + error.message);
    }
}

// 关闭编辑关联项目模态框
function closeEditProjectAssociationsModal() {
    const modal = document.getElementById('edit-project-associations-modal');
    if (modal) {
        modal.style.display = 'none';
        // 重置当前编辑的测试用例ID
        currentEditingTestCaseId = null;
    }
}

// 全选编辑模态框中的项目
function selectAllEditProjects() {
    try {
        const container = document.getElementById('edit-projects-container');
        if (container) {
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
            });
        }
    } catch (error) {
        console.error('全选项目错误:', error);
    }
}

// 取消全选编辑模态框中的项目
function deselectAllEditProjects() {
    try {
        const container = document.getElementById('edit-projects-container');
        if (container) {
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        }
    } catch (error) {
        console.error('取消全选项目错误:', error);
    }
}

// 加载项目数据到编辑模态框
async function loadProjectsForEditModal() {
    try {
        const tbody = document.getElementById('pa-projects-tbody');
        const loadingState = document.getElementById('pa-loading-state');
        const emptyState = document.getElementById('pa-empty-state');
        const tableContainer = document.querySelector('.pa-table-container');

        if (!tbody) {
            console.error('pa-projects-tbody 元素不存在');
            return;
        }

        // 显示加载状态
        if (loadingState) loadingState.style.display = 'flex';
        if (tableContainer) tableContainer.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';

        // 并行加载数据
        const [projectsData, testProgresses, testStatuses, usersData] = await Promise.all([
            apiRequest('/projects/list').catch(e => ({ success: false, projects: [] })),
            loadTestProgresses().catch(e => []),
            loadTestStatuses().catch(e => []),
            apiRequest('/users/list').catch(e => ({ success: false, users: [] }))
        ]);

        // 加载当前测试用例的关联项目
        let testCaseAssociations = [];
        const isEditOperation = currentEditingTestCaseId && currentEditingTestCaseId !== 'new' && currentEditingTestCaseId !== '';
        if (isEditOperation) {
            testCaseAssociations = await getTestCaseProjectDetails(currentEditingTestCaseId).catch(e => []);
        }

        // 处理项目列表
        let projectList = [];
        if (projectsData.success && projectsData.data && projectsData.data.success && projectsData.data.projects) {
            projectList = projectsData.data.projects;
        } else if (projectsData.data && projectsData.data.success && projectsData.data.projects) {
            projectList = projectsData.data.projects;
        } else if (projectsData.success && projectsData.projects) {
            projectList = projectsData.projects;
        } else if (Array.isArray(projectsData)) {
            projectList = projectsData;
        }

        // 处理用户列表
        let users = [];
        let usersList = [];
        if (Array.isArray(usersData)) {
            usersList = usersData;
        } else if (usersData.success && Array.isArray(usersData.users)) {
            usersList = usersData.users;
        } else if (usersData.users && Array.isArray(usersData.users)) {
            usersList = usersData.users;
        }

        // 过滤用户
        users = usersList.filter(user => {
            if (!user.username) return false;
            const normalizedRole = (user.role || '').toLowerCase();
            const username = user.username.toLowerCase();
            if (username === 'root' || username === 'admin') return false;
            if (normalizedRole === '测试人员' || normalizedRole === 'tester' || normalizedRole === 'test') return true;
            if (normalizedRole === '管理员' || normalizedRole === 'admin') return true;
            return false;
        });

        // 创建关联项目映射表
        const associationsMap = {};
        if (Array.isArray(testCaseAssociations)) {
            testCaseAssociations.forEach(association => {
                const projectId = association.project_id || association.id;
                if (projectId) {
                    associationsMap[projectId] = association;
                }
            });
        }

        // 更新统计信息
        updateProjectAssociationStats(projectList.length, Object.keys(associationsMap).length);

        // 渲染项目表格
        if (loadingState) loadingState.style.display = 'none';

        if (projectList.length > 0) {
            if (emptyState) emptyState.style.display = 'none';
            if (tableContainer) tableContainer.style.display = 'block';

            const rowsHtml = projectList.map(project => {
                const isAssociated = associationsMap[project.id] !== undefined;
                const association = associationsMap[project.id] || {};
                const selectedOwner = association.owner || '';
                const selectedProgress = association.progress_id || '';
                const selectedStatus = association.status_id || '';
                const remark = association.remark || '';

                return `
                    <tr class="pa-table-row ${isAssociated ? 'selected' : ''}" data-project-id="${project.id}" data-project-name="${(project.name || '').toLowerCase()}">
                        <td class="pa-col-checkbox">
                            <input type="checkbox" class="pa-row-checkbox" ${isAssociated ? 'checked' : ''} onchange="toggleProjectRowSelection(${project.id}, this.checked)">
                        </td>
                        <td class="pa-col-name">
                            <div class="pa-project-name">${project.name || '未命名项目'}</div>
                            <div class="pa-project-desc">${project.description || ''}</div>
                        </td>
                        <td class="pa-col-owner">
                            <select class="pa-table-select" name="owner-${project.id}" ${!isAssociated ? 'disabled' : ''}>
                                <option value="">请选择</option>
                                ${users.map(user => {
                    const isSelected = (user.id || user.user_id || user.username).toString() === selectedOwner.toString();
                    return `<option value="${user.id || user.user_id || user.username}" ${isSelected ? 'selected' : ''}>${user.username}</option>`;
                }).join('')}
                            </select>
                        </td>
                        <td class="pa-col-progress">
                            <select class="pa-table-select" name="progress-${project.id}" ${!isAssociated ? 'disabled' : ''}>
                                ${testProgresses.map(progress => {
                    const isSelected = (progress.id || progress.progress_id).toString() === selectedProgress.toString();
                    return `<option value="${progress.id || progress.progress_id}" ${isSelected ? 'selected' : ''}>${progress.name}</option>`;
                }).join('')}
                            </select>
                        </td>
                        <td class="pa-col-status">
                            <select class="pa-table-select" name="status-${project.id}" ${!isAssociated ? 'disabled' : ''}>
                                ${testStatuses.map(status => {
                    const isSelected = (status.id || status.status_id).toString() === selectedStatus.toString();
                    return `<option value="${status.id || status.status_id}" ${isSelected ? 'selected' : ''}>${status.name}</option>`;
                }).join('')}
                            </select>
                        </td>
                        <td class="pa-col-remark">
                            <input type="text" class="pa-table-input" name="remark-${project.id}" value="${remark}" placeholder="输入备注..." ${!isAssociated ? 'disabled' : ''}>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rowsHtml;

            // 更新全选复选框状态
            updateSelectAllCheckbox();

        } else {
            if (tableContainer) tableContainer.style.display = 'none';
            if (emptyState) emptyState.style.display = 'flex';
        }

    } catch (error) {
        console.error('加载项目列表错误:', error);
        const loadingState = document.getElementById('pa-loading-state');
        const emptyState = document.getElementById('pa-empty-state');
        if (loadingState) loadingState.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.innerHTML = `
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 8v4"></path>
                    <path d="M12 16h.01"></path>
                </svg>
                <p>加载项目失败</p>
                <button type="button" onclick="loadProjectsForEditModal()" class="btn btn-secondary">重试</button>
            `;
        }
    }
}

// 更新项目关联统计信息
function updateProjectAssociationStats(total, selected) {
    const totalCountEl = document.getElementById('pa-total-count');
    const selectedCountEl = document.getElementById('pa-selected-count');

    if (totalCountEl) totalCountEl.textContent = total;
    if (selectedCountEl) selectedCountEl.textContent = selected;
}

// 切换项目卡片选中状态
function toggleProjectCardSelection(projectId) {
    const card = document.querySelector(`.pa-project-card[data-project-id="${projectId}"]`);
    if (card) {
        card.classList.toggle('selected');
        updateSelectedCount();
    }
}

// 更新选中数量
function updateSelectedCount() {
    const selectedRows = document.querySelectorAll('.pa-table-row.selected:not(.filtered-out)');
    const selectedCountEl = document.getElementById('pa-selected-count');
    if (selectedCountEl) {
        selectedCountEl.textContent = selectedRows.length;
    }
}

// 搜索筛选项目
function filterProjectAssociations() {
    const searchInput = document.getElementById('pa-search-input');
    const searchTerm = (searchInput.value || '').toLowerCase().trim();
    const rows = document.querySelectorAll('.pa-table-row');

    rows.forEach(row => {
        const projectName = (row.dataset.projectName || '').toLowerCase();
        if (searchTerm === '' || projectName.includes(searchTerm)) {
            row.classList.remove('filtered-out');
        } else {
            row.classList.add('filtered-out');
        }
    });

    // 更新全选复选框状态
    updateSelectAllCheckbox();
}

// 切换项目行选中状态
function toggleProjectRowSelection(projectId, checked) {
    const row = document.querySelector(`.pa-table-row[data-project-id="${projectId}"]`);
    if (row) {
        if (checked) {
            row.classList.add('selected');
        } else {
            row.classList.remove('selected');
        }

        // 启用/禁用表单控件
        const selects = row.querySelectorAll('.pa-table-select');
        const inputs = row.querySelectorAll('.pa-table-input');

        selects.forEach(select => {
            select.disabled = !checked;
        });

        inputs.forEach(input => {
            input.disabled = !checked;
        });

        updateSelectedCount();
        updateSelectAllCheckbox();
    }
}

// 全选项目
function selectAllEditProjects() {
    const rows = document.querySelectorAll('.pa-table-row:not(.filtered-out)');
    rows.forEach(row => {
        row.classList.add('selected');
        const checkbox = row.querySelector('.pa-row-checkbox');
        if (checkbox) checkbox.checked = true;

        // 启用表单控件
        const selects = row.querySelectorAll('.pa-table-select');
        const inputs = row.querySelectorAll('.pa-table-input');
        selects.forEach(select => select.disabled = false);
        inputs.forEach(input => input.disabled = false);
    });
    updateSelectedCount();
    updateSelectAllCheckbox();
}

// 取消全选项目
function deselectAllEditProjects() {
    const rows = document.querySelectorAll('.pa-table-row.selected');
    rows.forEach(row => {
        row.classList.remove('selected');
        const checkbox = row.querySelector('.pa-row-checkbox');
        if (checkbox) checkbox.checked = false;

        // 禁用表单控件
        const selects = row.querySelectorAll('.pa-table-select');
        const inputs = row.querySelectorAll('.pa-table-input');
        selects.forEach(select => select.disabled = true);
        inputs.forEach(input => input.disabled = true);
    });
    updateSelectedCount();
    updateSelectAllCheckbox();
}

// 通过表头复选框切换全选
function toggleAllProjectsFromCheckbox(checked) {
    if (checked) {
        selectAllEditProjects();
    } else {
        deselectAllEditProjects();
    }
}

// 更新全选复选框状态
function updateSelectAllCheckbox() {
    const totalRows = document.querySelectorAll('.pa-table-row:not(.filtered-out)').length;
    const selectedRows = document.querySelectorAll('.pa-table-row.selected:not(.filtered-out)').length;
    const selectAllCheckbox = document.getElementById('pa-select-all-checkbox');

    if (selectAllCheckbox) {
        selectAllCheckbox.checked = totalRows > 0 && totalRows === selectedRows;
        selectAllCheckbox.indeterminate = selectedRows > 0 && selectedRows < totalRows;
    }
}

// 保存关联项目信息
async function saveProjectAssociations() {
    try {
        const tbody = document.getElementById('pa-projects-tbody');
        if (!tbody) {
            console.error('pa-projects-tbody不存在');
            return;
        }

        // 获取所有选中的行
        const selectedRows = tbody.querySelectorAll('.pa-table-row.selected');
        console.log('选中的项目行数量:', selectedRows.length);

        const associations = [];

        // 遍历所有选中的行，收集关联数据
        selectedRows.forEach((row, index) => {
            const projectId = parseInt(row.dataset.projectId);
            console.log(`项目行${index}的projectId:`, projectId);

            if (!isNaN(projectId)) {
                // 获取其他关联数据
                const ownerSelect = row.querySelector('select[name^="owner-"]');
                const progressSelect = row.querySelector('select[name^="progress-"]');
                const statusSelect = row.querySelector('select[name^="status-"]');
                const remarkInput = row.querySelector('input[name^="remark-"]');

                // 处理空值，将空字符串转换为 null
                const progressId = progressSelect && progressSelect.value ? progressSelect.value : null;
                const statusId = statusSelect && statusSelect.value ? statusSelect.value : null;

                const association = {
                    project_id: projectId,
                    owner: ownerSelect ? ownerSelect.value : null,
                    progress_id: progressId,
                    status_id: statusId,
                    remark: remarkInput ? remarkInput.value : ''
                };

                console.log('收集到关联项目:', association);
                associations.push(association);
            }
        });

        console.log('最终收集到的关联项目:', associations);

        // 检查是否有window.currentEditingTestCase对象
        let isNewCase = true;
        let testCaseId = null;

        if (window.currentEditingTestCase && window.currentEditingTestCase.id) {
            isNewCase = window.currentEditingTestCase.id === 'new' || window.currentEditingTestCase.id === '';
            testCaseId = window.currentEditingTestCase.id;
        } else {
            // 如果没有window.currentEditingTestCase对象，使用currentEditingTestCaseId变量
            isNewCase = currentEditingTestCaseId === 'new' || currentEditingTestCaseId === '';
            testCaseId = currentEditingTestCaseId;
        }

        console.log('保存关联项目，isNewCase:', isNewCase, 'testCaseId:', testCaseId);

        if (!isNewCase && testCaseId) {
            // 编辑现有用例，直接保存到数据库
            console.log('编辑用例关联项目，保存到数据库');
            showLoading('保存关联项目...');

            const result = await apiRequest('/cases/projects/update', {
                method: 'POST',
                body: JSON.stringify({
                    testCaseId: testCaseId,
                    projectAssociations: associations
                })
            });

            if (result.success) {
                showSuccessMessage('关联项目保存成功');
                // 清除缓存 - 关键修复
                apiCache.delete(`/testcases/${testCaseId}/projects`);
                console.log('已清除关联项目缓存');
                // 清除本地存储中的临时数据（如果有的话）
                localStorage.removeItem('tempProjectAssociations');
                console.log('已清除本地存储中的临时关联项目数据');
                // 关闭模态框
                closeEditProjectAssociationsModal();
                // 刷新项目列表
                loadTestCaseProjects(testCaseId);
            } else {
                showErrorMessage(result.message || '保存关联项目失败');
            }
            // 隐藏加载状态
            hideLoading();
        } else {
            // 新建用例，保存到本地存储
            console.log('[关联项目] 新建用例关联项目，保存到本地存储');
            console.log('[关联项目] 保存的关联数据:', associations);
            localStorage.setItem('tempProjectAssociations', JSON.stringify(associations));
            console.log('[关联项目] 已保存到localStorage，验证:', localStorage.getItem('tempProjectAssociations'));
            // 关闭模态框
            closeEditProjectAssociationsModal();
            // 更新新建用例页面的项目摘要
            console.log('[关联项目] 准备调用 updateNewCaseProjectsSummary');
            updateNewCaseProjectsSummary();
            showSuccessMessage('关联项目已保存到本地，待测试用例保存时一并提交');
        }
    } catch (error) {
        console.error('保存关联项目错误:', error);
        showErrorMessage('保存关联项目失败');
    }
}

// 全选新建测试用例的项目（注释掉，因为已经移除了复选框）
function selectAllNewCaseProjects() {
    try {
        console.log('全选新建测试用例项目功能已禁用，因为已移除复选框');
        /*
        const container = document.getElementById('new-case-projects-container');
        if (container) {
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
            });
        }
        */
    } catch (error) {
        console.error('全选新建测试用例项目出错:', error);
    }
}

// 取消全选新建测试用例的项目（注释掉，因为已经移除了复选框）
function deselectAllNewCaseProjects() {
    try {
        console.log('取消全选新建测试用例项目功能已禁用，因为已移除复选框');
        /*
        const container = document.getElementById('new-case-projects-container');
        if (container) {
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        }
        */
    } catch (error) {
        console.error('取消全选新建测试用例项目出错:', error);
    }
}

// 关闭测试用例模态框
function closeTestCaseModal() {
    const modal = document.getElementById('add-case-modal');
    modal.style.display = 'none';

    // 重置步骤
    currentAddCaseStep = 1;
    updateAddCaseStepUI();

    // 清空表单
    const form = document.getElementById('add-case-form');
    if (form) {
        form.reset();
    }

    // 重置TagSelector组件
    TagSelector.setValues('case-phases-selector', []);
    TagSelector.setValues('case-environments-selector', []);
    TagSelector.setValues('case-methods-selector', []);
    TagSelector.setValues('case-sources-selector', []);

    // 清除临时关联项目数据
    localStorage.removeItem('tempProjectAssociations');

    // 重置模态框位置
    resetAddCaseModalPosition();

    console.log('[新建用例] 模态框已关闭，状态已重置');
}

// 初始化新建测试用例模态框的拖拽调整宽度功能
function initAddCaseModalResizer() {
    const modalContent = document.getElementById('add-case-content');
    const resizer = document.getElementById('add-case-resizer');
    const modalHeader = modalContent?.querySelector('.add-case-header');
    
    if (!modalContent || !resizer) return;
    
    if (modalContent.dataset.resizerInitialized === 'true') return;
    modalContent.dataset.resizerInitialized = 'true';

    let isResizing = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startLeft = 0;
    let startTop = 0;
    const minWidth = 600;
    const maxWidthRatio = 0.95;

    // 调整宽度功能
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = modalContent.offsetWidth;
        
        resizer.classList.add('dragging');
        document.body.classList.add('modal-resizing');
        
        e.preventDefault();
        e.stopPropagation();
    });

    // 拖拽移动功能（通过header）
    if (modalHeader) {
        modalHeader.addEventListener('mousedown', (e) => {
            if (e.target.closest('.close-modal') || e.target.closest('button')) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = modalContent.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            
            modalContent.style.position = 'fixed';
            modalContent.style.left = startLeft + 'px';
            modalContent.style.top = startTop + 'px';
            modalContent.style.margin = '0';
            
            document.body.classList.add('modal-dragging');
            
            e.preventDefault();
        });
    }

    document.addEventListener('mousemove', (e) => {
        // 调整宽度
        if (isResizing) {
            const deltaX = e.clientX - startX;
            const newWidth = startWidth + deltaX;
            const maxWidth = window.innerWidth * maxWidthRatio;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                modalContent.style.width = newWidth + 'px';
                modalContent.style.maxWidth = newWidth + 'px';
            } else if (newWidth < minWidth) {
                modalContent.style.width = minWidth + 'px';
                modalContent.style.maxWidth = minWidth + 'px';
            } else if (newWidth > maxWidth) {
                modalContent.style.width = maxWidth + 'px';
                modalContent.style.maxWidth = maxWidth + 'px';
            }
        }
        
        // 拖拽移动
        if (isDragging) {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            let newLeft = startLeft + deltaX;
            let newTop = startTop + deltaY;
            
            // 边界限制
            const maxLeft = window.innerWidth - modalContent.offsetWidth - 10;
            const maxTop = window.innerHeight - 100;
            
            newLeft = Math.max(10, Math.min(newLeft, maxLeft));
            newTop = Math.max(10, Math.min(newTop, maxTop));
            
            modalContent.style.left = newLeft + 'px';
            modalContent.style.top = newTop + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('dragging');
            document.body.classList.remove('modal-resizing');
        }
        if (isDragging) {
            isDragging = false;
            document.body.classList.remove('modal-dragging');
        }
    });

    // 双击重置宽度
    resizer.addEventListener('dblclick', () => {
        modalContent.style.width = '';
        modalContent.style.maxWidth = '800px';
    });
}

// 重置模态框位置
function resetAddCaseModalPosition() {
    const modalContent = document.getElementById('add-case-content');
    if (modalContent) {
        modalContent.style.position = '';
        modalContent.style.left = '';
        modalContent.style.top = '';
        modalContent.style.margin = '';
        modalContent.style.width = '';
        modalContent.style.maxWidth = '';
    }
}

// 提交测试用例表单
async function submitTestCaseForm() {
    try {
        console.log('=== 开始提交测试用例表单 ===');
        showLoading('创建测试用例中...');

        // 生成测试用例编号
        const caseId = generateTestCaseId();
        console.log('Generated caseId:', caseId);

        // 从localStorage获取临时关联项目
        const tempAssociations = JSON.parse(localStorage.getItem('tempProjectAssociations') || '[]');
        console.log('Temp associations from localStorage:', tempAssociations);

        // 获取表单数据
        console.log('Getting form data...');
        const caseName = document.getElementById('case-name');
        const casePriority = document.getElementById('case-priority');
        const caseType = document.getElementById('case-type');
        const casePrecondition = document.getElementById('case-precondition');
        const casePurpose = document.getElementById('case-purpose');
        const caseSteps = document.getElementById('case-steps');
        const caseExpected = document.getElementById('case-expected');
        const caseRemark = document.getElementById('case-remark');
        const caseOwner = document.getElementById('case-owner');

        // 从TagSelector组件获取选中值
        const selectedPhases = TagSelector.getValues('case-phases-selector').map(id => parseInt(id));
        const selectedEnvironments = TagSelector.getValues('case-environments-selector').map(id => parseInt(id));
        const selectedMethods = TagSelector.getValues('case-methods-selector').map(id => parseInt(id));
        const selectedSources = TagSelector.getValues('case-sources-selector').map(id => parseInt(id));

        console.log('Selected values:', {
            phases: selectedPhases,
            environments: selectedEnvironments,
            methods: selectedMethods,
            sources: selectedSources
        });

        // 提取项目ID数组，兼容现有API
        const projectIds = tempAssociations.map(assoc => assoc.project_id);

        const formData = {
            caseId: caseId,
            name: caseName ? caseName.value : '',
            priority: casePriority ? casePriority.value : 'medium',
            type: caseType ? caseType.value : 'functional',
            precondition: casePrecondition ? casePrecondition.value : '',
            purpose: casePurpose ? casePurpose.value : '',
            steps: caseSteps ? caseSteps.value : '',
            expected: caseExpected ? caseExpected.value : '',
            key_config: document.getElementById('case-key-config') ? document.getElementById('case-key-config').value : '',
            remark: caseRemark ? caseRemark.value : '',
            creator: currentUser ? currentUser.username : 'admin',
            owner: caseOwner ? caseOwner.value : currentUser ? currentUser.username : 'admin',
            libraryId: currentCaseLibraryId,
            moduleId: selectedModuleId,
            level1Id: selectedLevel1PointId,
            projects: projectIds,
            projectAssociations: tempAssociations,
            phases: selectedPhases,
            environments: selectedEnvironments,
            methods: selectedMethods,
            sources: selectedSources
        };

        console.log('Form data:', formData);
        console.log('[新建用例] 验证字段:', {
            moduleId: formData.moduleId,
            moduleIdType: typeof formData.moduleId,
            selectedEnvironments: selectedEnvironments,
            selectedEnvironmentsLength: selectedEnvironments.length,
            selectedMethods: selectedMethods,
            selectedMethodsLength: selectedMethods.length,
            selectedModuleId: selectedModuleId,
            selectedLevel1PointId: selectedLevel1PointId
        });

        // 验证必填字段
        if (!formData.name) {
            console.error('测试用例名称不能为空');
            showErrorMessage('测试用例名称不能为空');
            hideLoading();
            return;
        }
        if (!formData.moduleId || selectedEnvironments.length === 0 || selectedMethods.length === 0) {
            console.error('[新建用例] 缺少必填字段:', {
                moduleId: formData.moduleId,
                moduleIdValid: !!formData.moduleId,
                environments: selectedEnvironments,
                environmentsValid: selectedEnvironments.length > 0,
                methods: selectedMethods,
                methodsValid: selectedMethods.length > 0
            });
            showErrorMessage('模块ID、测试环境和测试方式不能为空');
            hideLoading();
            return;
        }

        // 调用API创建测试用例
        console.log('Calling API to create test case...');

        const createData = await apiRequest('/cases/create', {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        console.log('API response:', createData);

        if (createData.success) {
            console.log('测试用例创建成功');

            // 清除本地存储中的临时关联项目数据（已在创建时一并保存）
            localStorage.removeItem('tempProjectAssociations');

            // 关闭模态框
            closeTestCaseModal();

            // 刷新一级测试点列表（更新测试用例数量统计）
            if (selectedModuleId) {
                console.log('[新建用例] 刷新一级测试点列表');
                await loadLevel1Points(selectedModuleId);
            }

            // 重新加载测试用例列表
            await loadTestCases();

            // 发布事件：测试用例变更
            DataEventManager.emit(DataEvents.TEST_CASE_CHANGED, { 
                action: 'add', 
                moduleId: selectedModuleId,
                level1Id: formData.level1Id
            });

            // 记录历史
            addHistoryRecord('创建测试用例', `创建了测试用例 ${formData.name}`);

            showSuccessMessage('测试用例创建成功');
        } else {
            console.error('测试用例创建失败:', createData.message);
            showErrorMessage('创建测试用例失败: ' + (createData.message || '创建失败，请稍后重试'));
        }
    } catch (error) {
        console.error('创建测试用例错误:', error);
        console.error('Error stack:', error.stack);
        showErrorMessage('创建测试用例失败: ' + error.message);
    } finally {
        hideLoading();
        console.log('=== 测试用例表单提交完成 ===');
    }
}

// 生成测试用例编号
function generateTestCaseId() {
    // 生成格式：CASE-YYYYMMDD-XXXX
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

    return `CASE-${year}${month}${day}-${random}`;
}

// 查看报告详情
let currentReportId = null;
let currentReportDrawerId = null;
let currentReportMarkdown = '';
let isMarkdownView = false;
let currentReportData = null;
let reportChartInstances = {};
let defectsCurrentPage = 1;
const DEFECTS_PAGE_SIZE = 20;

function viewReportDetail(reportId) {
    currentReportId = reportId;
    isMarkdownView = false;
    showSection('report-detail');
    loadReportDetail(reportId);
}

// 打开测试报告详情抽屉
function openReportDetailDrawer(reportId, event) {
    if (event) {
        event.stopPropagation();
    }

    currentReportDrawerId = reportId;

    const drawer = document.getElementById('report-detail-drawer');
    const overlay = document.getElementById('report-detail-drawer-overlay');

    if (drawer && overlay) {
        loadReportDrawerData(reportId);
        overlay.classList.add('active');
        drawer.classList.add('active');
    }
}

// 关闭测试报告详情抽屉
function closeReportDetailDrawer() {
    const drawer = document.getElementById('report-detail-drawer');
    const overlay = document.getElementById('report-detail-drawer-overlay');

    if (drawer && overlay) {
        drawer.classList.remove('active');
        overlay.classList.remove('active');
    }
}

// 加载测试报告抽屉数据
async function loadReportDrawerData(reportId) {
    const contentArea = document.getElementById('report-drawer-content');
    const titleEl = document.getElementById('report-drawer-title');

    if (!contentArea) return;

    contentArea.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--color-text-secondary, #6b7280);">
            <div class="loading-spinner"></div>
            <p style="margin-top: 12px;">加载报告详情中...</p>
        </div>
    `;

    try {
        const reportData = await apiRequest(`/reports/detail/${reportId}`);

        if (reportData.success && reportData.report) {
            const report = reportData.report;

            if (titleEl) {
                titleEl.textContent = report.name || '测试报告详情';
            }

            const testPlanId = report.testPlanId || report.test_plan_id;

            let statisticsHtml = '';
            if (testPlanId) {
                try {
                    const previewData = await apiRequest(`/reports/preview/${testPlanId}`);
                    if (previewData.success) {
                        const stats = previewData.statistics;
                        statisticsHtml = `
                            <div class="drawer-section">
                                <h4 class="section-title">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                                        <path d="M18 20V10M12 20V4M6 20v-6"></path>
                                    </svg>
                                    执行统计
                                </h4>
                                <div class="progress-stats">
                                    <div class="stat-item">
                                        <div class="stat-value">${stats.total || 0}</div>
                                        <div class="stat-label">总用例数</div>
                                    </div>
                                    <div class="stat-item passed">
                                        <div class="stat-value">${stats.passed || 0}</div>
                                        <div class="stat-label">通过</div>
                                    </div>
                                    <div class="stat-item failed">
                                        <div class="stat-value">${stats.failed || 0}</div>
                                        <div class="stat-label">失败</div>
                                    </div>
                                    <div class="stat-item pending">
                                        <div class="stat-value">${stats.notRun || 0}</div>
                                        <div class="stat-label">未执行</div>
                                    </div>
                                </div>
                                <div class="pass-rate-display">
                                    <span class="pass-rate-label">通过率</span>
                                    <span class="pass-rate-value">${stats.passRate || 0}%</span>
                                </div>
                            </div>
                        `;
                    }
                } catch (e) {
                    console.log('获取统计数据失败:', e);
                }
            }

            let summaryContent = report.summary || '';
            try {
                const markdownData = await apiRequest(`/reports/markdown/${reportId}`);
                if (markdownData.success && markdownData.markdown) {
                    const summaryMatch = markdownData.markdown.match(/## 二、总结与评估\n\n([\s\S]*?)(?=\n---|\n## 三|$)/);
                    if (summaryMatch && summaryMatch[1]) {
                        summaryContent = summaryMatch[1].trim();
                    }
                }
            } catch (e) {
                console.log('获取Markdown内容失败:', e);
            }

            let summaryHtml = '';
            if (summaryContent) {
                // 使用 marked.js 将 Markdown 转换为 HTML
                let renderedSummary = summaryContent;
                if (typeof marked !== 'undefined') {
                    try {
                        renderedSummary = marked.parse(summaryContent);
                    } catch (e) {
                        console.log('Markdown渲染失败:', e);
                    }
                }
                
                summaryHtml = `
                    <div class="drawer-section">
                        <h4 class="section-title">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                            </svg>
                            测试总结
                        </h4>
                        <div class="summary-content markdown-body">${renderedSummary}</div>
                    </div>
                `;
            }

            contentArea.innerHTML = `
                <div class="drawer-section">
                    <h4 class="section-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                            <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"></path>
                        </svg>
                        基本信息
                    </h4>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="info-label">报告名称</span>
                            <span class="info-value">${report.name || '-'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">创建人</span>
                            <span class="info-value">${report.creator || report.creator_id || '-'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">创建时间</span>
                            <span class="info-value">${formatDateTime(report.createdAt || report.created_at)}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">报告类型</span>
                            <span class="info-value">${report.type || report.report_type || '标准报告'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">关联项目</span>
                            <span class="info-value">${report.project || '-'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">关联测试计划</span>
                            <span class="info-value">${report.testPlan || report.test_plan || '-'}</span>
                        </div>
                    </div>
                </div>
                ${statisticsHtml}
                ${summaryHtml}
            `;
        } else {
            contentArea.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--color-text-secondary, #6b7280);">
                    <p>无法加载报告详情</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('加载报告详情失败:', error);
        contentArea.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--color-text-secondary, #6b7280);">
                <p>加载失败: ${error.message}</p>
            </div>
        `;
    }
}

// 从抽屉查看完整报告
function viewReportDetailFromDrawer() {
    if (currentReportDrawerId) {
        closeReportDetailDrawer();
        setTimeout(() => {
            viewReportDetail(currentReportDrawerId);
        }, 300);
    }
}

async function loadReportDetail(reportId) {
    try {
        showLoading('加载报告详情中...');

        const reportData = await apiRequest(`/reports/detail/${reportId}`);
        let testPlanId = null;

        const currentReportNameEl = document.getElementById('current-report-name');
        const reportNameInputEl = document.getElementById('report-name-input');
        const reportTesterEl = document.getElementById('report-tester');
        const reportStartTimeEl = document.getElementById('report-start-time');
        const reportEndTimeEl = document.getElementById('report-end-time');
        const reportProjectEl = document.getElementById('report-project');
        const reportIterationEl = document.getElementById('report-iteration');
        const reportTypeEl = document.getElementById('report-type');
        const reportSummaryTextEl = document.getElementById('report-summary-text');

        if (reportData.success && reportData.report) {
            const report = reportData.report;
            testPlanId = report.testPlanId;
            if (currentReportNameEl) currentReportNameEl.textContent = report.name;
            if (reportNameInputEl) reportNameInputEl.value = report.name;
            if (reportTesterEl) reportTesterEl.textContent = report.creator || '-';
            if (reportStartTimeEl) reportStartTimeEl.textContent = report.startDate || '-';
            if (reportEndTimeEl) reportEndTimeEl.textContent = report.endDate || '-';
            if (reportProjectEl) reportProjectEl.textContent = report.project || '-';
            if (reportIterationEl) reportIterationEl.textContent = report.iteration || '-';
            if (reportTypeEl) reportTypeEl.textContent = report.type || '-';

            if (report.summary && report.summary.startsWith('#')) {
                currentReportMarkdown = report.summary;
            }
        } else {
            if (currentReportNameEl) currentReportNameEl.textContent = '测试报告';
            if (reportNameInputEl) reportNameInputEl.value = '测试报告';
            if (reportTesterEl) reportTesterEl.textContent = '-';
            if (reportStartTimeEl) reportStartTimeEl.textContent = '-';
            if (reportEndTimeEl) reportEndTimeEl.textContent = '-';
            if (reportProjectEl) reportProjectEl.textContent = '-';
            if (reportIterationEl) reportIterationEl.textContent = '-';
            if (reportTypeEl) reportTypeEl.textContent = '-';
            if (reportSummaryTextEl) reportSummaryTextEl.value = '';
        }

        try {
            const markdownData = await apiRequest(`/reports/markdown/${reportId}`);
            if (markdownData.success && markdownData.markdown) {
                currentReportMarkdown = markdownData.markdown;
                extractSummaryFromMarkdown();
            }
        } catch (e) {
            console.log('未找到Markdown内容');
        }

        if (testPlanId) {
            try {
                const previewData = await apiRequest(`/reports/preview/${testPlanId}`);
                if (previewData.success) {
                    currentReportData = previewData;
                    updateDashboardCards(previewData.statistics);
                    updateOverviewInfo(previewData.testPlan);
                    initReportCharts(previewData);
                    renderDefectsTable(previewData.failedCases || []);
                }
            } catch (e) {
                console.log('未找到详细统计数据:', e);
                initReportCharts(null);
            }
        } else {
            console.log('报告未关联测试计划，无法加载详细统计数据');
            initReportCharts(null);
        }
    } catch (error) {
        console.error('加载报告详情错误:', error);
        const currentReportNameEl = document.getElementById('current-report-name');
        const reportNameInputEl = document.getElementById('report-name-input');
        if (currentReportNameEl) currentReportNameEl.textContent = '测试报告';
        if (reportNameInputEl) reportNameInputEl.value = '测试报告';
        initReportCharts(null);
    } finally {
        hideLoading();
    }
}

function updateOverviewInfo(testPlan) {
    if (!testPlan) return;

    const testerEl = document.getElementById('report-tester');
    if (testerEl && testPlan.ownerDistribution) {
        testerEl.textContent = formatOwnerDisplay(testPlan.ownerDistribution);
    } else if (testerEl && testPlan.owner) {
        testerEl.textContent = testPlan.owner;
    }

    const durationEl = document.getElementById('report-duration');
    if (durationEl && testPlan.duration) {
        durationEl.textContent = testPlan.duration.display || '-';
    }

    const phaseEl = document.getElementById('report-phase');
    if (phaseEl && testPlan.testPhase) {
        phaseEl.textContent = testPlan.testPhase;
    }

    const softwareEl = document.getElementById('report-software');
    if (softwareEl) {
        const software = testPlan.software || '-';
        const version = testPlan.softwareVersion;
        softwareEl.textContent = version && version !== '-' ? `${software} (v${version})` : software;
    }
}
function formatOwnerDisplay(ownerDistribution) {
    if (!ownerDistribution || ownerDistribution.length === 0) {
        return '未分配';
    }
    return ownerDistribution.map(o => `${o.owner} (${o.percentage}%)`).join(', ');
}
function extractSummaryFromMarkdown() {
    const summaryDisplay = document.getElementById('report-summary-display');
    const summaryTextarea = document.getElementById('report-summary-text');
    if (!currentReportMarkdown) return;

    const summaryMatch = currentReportMarkdown.match(/## 二、总结与评估\n\n([\s\S]*?)(?=\n---|\n## 三|$)/);
    if (summaryMatch && summaryMatch[1]) {
        const summaryContent = summaryMatch[1].trim();
        
        // 更新隐藏的textarea（用于编辑）
        if (summaryTextarea) {
            summaryTextarea.value = summaryContent;
        }
        
        // 渲染Markdown到显示区域
        if (summaryDisplay) {
            if (typeof marked !== 'undefined') {
                try {
                    summaryDisplay.innerHTML = marked.parse(summaryContent);
                } catch (e) {
                    console.log('Markdown渲染失败:', e);
                    summaryDisplay.innerHTML = `<pre>${escapeHtml(summaryContent)}</pre>`;
                }
            } else {
                summaryDisplay.innerHTML = `<pre>${escapeHtml(summaryContent)}</pre>`;
            }
        }
    }
}

function updateDashboardCards(statistics) {
    const totalCasesEl = document.getElementById('report-total-cases');
    const passRateEl = document.getElementById('report-pass-rate');
    const notRunEl = document.getElementById('report-notrun-count');
    const failCountEl = document.getElementById('report-fail-count');
    
    if (!totalCasesEl && !passRateEl && !notRunEl && !failCountEl) {
        console.log('[updateDashboardCards] 当前页面不包含报告卡片元素，跳过更新');
        return;
    }
    
    if (!statistics) {
        if (totalCasesEl) totalCasesEl.textContent = '0';
        if (passRateEl) passRateEl.textContent = '0%';
        if (notRunEl) notRunEl.textContent = '0';
        if (failCountEl) failCountEl.textContent = '0';
        return;
    }

    if (totalCasesEl) totalCasesEl.textContent = statistics.total.toLocaleString();

    if (passRateEl) {
        passRateEl.textContent = statistics.passRate + '%';
        passRateEl.className = 'card-value ' + (parseFloat(statistics.passRate) >= 80 ? 'pass-rate-good' : parseFloat(statistics.passRate) >= 60 ? 'pass-rate-warning' : 'pass-rate-danger');
    }

    if (notRunEl) notRunEl.textContent = statistics.notRun.toLocaleString();

    if (failCountEl) {
        failCountEl.textContent = statistics.failed.toLocaleString();
        if (statistics.severeDefects && statistics.severeDefects > 0) {
            failCountEl.innerHTML = `${statistics.failed.toLocaleString()} <span class="severe-badge">${statistics.severeDefects} 严重</span>`;
        }
    }
}

function toggleReportView() {
    const traditionalView = document.getElementById('report-traditional-view');
    const markdownView = document.getElementById('report-markdown-view');
    const toggleText = document.getElementById('view-toggle-text');

    if (isMarkdownView) {
        traditionalView.style.display = 'block';
        markdownView.style.display = 'none';
        toggleText.textContent = 'Markdown视图';
        isMarkdownView = false;
    } else {
        traditionalView.style.display = 'none';
        markdownView.style.display = 'block';
        toggleText.textContent = '传统视图';
        isMarkdownView = true;
        renderMarkdownContent();
    }
}

function renderMarkdownContent() {
    const container = document.getElementById('report-markdown-content');
    if (!container) return;

    if (currentReportMarkdown && typeof marked !== 'undefined') {
        container.innerHTML = marked.parse(currentReportMarkdown);
    } else if (currentReportMarkdown) {
        container.innerHTML = `<pre style="white-space: pre-wrap;">${escapeHtml(currentReportMarkdown)}</pre>`;
    } else {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                <p>暂无Markdown报告内容</p>
                <p>请先生成测试报告</p>
            </div>
        `;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function generateReportFromTestPlan(testPlanId) {
    console.log(`[生成报告] 开始生成测试报告，testPlanId: ${testPlanId}`);
    try {
        showLoading('正在生成测试报告...');

        const result = await apiRequest(`/reports/generate/${testPlanId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ useAI: true })
        });

        if (result.success) {
            currentReportMarkdown = result.markdown;
            currentReportId = result.reportId;

            document.getElementById('current-report-name').textContent = result.reportName;
            document.getElementById('report-name-input').value = result.reportName;

            showToast('报告生成成功', 'success');

            if (isMarkdownView) {
                renderMarkdownContent();
            }

            return result;
        } else {
            showToast(result.message || '报告生成失败', 'error');
        }
    } catch (error) {
        console.error('生成报告错误:', error);
        showToast('报告生成失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function copyMarkdownContent() {
    if (!currentReportMarkdown) {
        showToast('暂无Markdown内容', 'warning');
        return;
    }

    navigator.clipboard.writeText(currentReportMarkdown).then(() => {
        showToast('Markdown内容已复制到剪贴板', 'success');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败', 'error');
    });
}

function downloadMarkdownFile() {
    if (!currentReportMarkdown) {
        showToast('暂无Markdown内容', 'warning');
        return;
    }

    const reportName = document.getElementById('report-name-input')?.value || '测试报告';
    const fileName = `${reportName}_${new Date().toISOString().split('T')[0]}.md`;

    const blob = new Blob([currentReportMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('报告已下载', 'success');
}

async function regenerateReport() {
    if (!currentReportId) {
        showToast('请先选择测试计划', 'warning');
        return;
    }

    try {
        const reportData = await apiRequest(`/reports/detail/${currentReportId}`);
        if (reportData.success && reportData.report) {
            const testPlanName = reportData.report.testPlan;
            if (testPlanName) {
                const testPlans = await apiRequest('/testplans/list');
                const plan = testPlans.testPlans?.find(p => p.name === testPlanName);
                if (plan) {
                    await generateReportFromTestPlan(plan.id);
                }
            }
        }
    } catch (error) {
        console.error('重新生成报告错误:', error);
        showToast('重新生成失败', 'error');
    }
}

function exportReportMarkdown() {
    downloadMarkdownFile();
}

function initReportCharts(reportData) {
    Object.values(reportChartInstances).forEach(chart => {
        if (chart) chart.destroy();
    });
    reportChartInstances = {};

    if (!reportData) {
        initExecutionDonutChart({ passed: 0, failed: 0, blocked: 0, notRun: 0 });
        initModuleStackedBarChart({});
        return;
    }

    initExecutionDonutChart(reportData.statistics);
    initModuleStackedBarChart(reportData.moduleDistribution);
}

function initExecutionDonutChart(statistics) {
    const container = document.getElementById('execution-donut-chart');
    if (!container || typeof Chart === 'undefined') return;

    if (reportChartInstances.executionDonut) {
        reportChartInstances.executionDonut.destroy();
    }

    const data = [
        statistics?.passed || 0,
        statistics?.failed || 0,
        statistics?.blocked || 0,
        statistics?.notRun || 0
    ];

    const total = data.reduce((a, b) => a + b, 0);

    reportChartInstances.executionDonut = new Chart(container, {
        type: 'doughnut',
        data: {
            labels: ['通过', '失败', '阻塞', '未执行'],
            datasets: [{
                data: data,
                backgroundColor: ['#52c41a', '#ff4d4f', '#fa8c16', '#d9d9d9'],
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        padding: 15,
                        usePointStyle: true,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw;
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${context.label}: ${value.toLocaleString()} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function initModuleStackedBarChart(moduleDistribution) {
    const container = document.getElementById('module-bar-chart');
    if (!container || typeof Chart === 'undefined') return;

    if (reportChartInstances.moduleBar) {
        reportChartInstances.moduleBar.destroy();
    }

    const modules = Object.keys(moduleDistribution || {});
    const passedData = [];
    const failedData = [];
    const blockedData = [];
    const notRunData = [];

    modules.forEach(module => {
        const stats = moduleDistribution[module];
        passedData.push(stats.passed || 0);
        failedData.push(stats.failed || 0);
        blockedData.push(stats.blocked || 0);
        notRunData.push(stats.notRun || 0);
    });

    const displayModules = modules.length > 20 ? modules.slice(0, 20) : modules;
    const displayPassed = modules.length > 20 ? passedData.slice(0, 20) : passedData;
    const displayFailed = modules.length > 20 ? failedData.slice(0, 20) : failedData;
    const displayBlocked = modules.length > 20 ? blockedData.slice(0, 20) : blockedData;
    const displayNotRun = modules.length > 20 ? notRunData.slice(0, 20) : notRunData;

    reportChartInstances.moduleBar = new Chart(container, {
        type: 'bar',
        data: {
            labels: displayModules,
            datasets: [
                {
                    label: '通过',
                    data: displayPassed,
                    backgroundColor: '#52c41a',
                    borderRadius: 2
                },
                {
                    label: '失败',
                    data: displayFailed,
                    backgroundColor: '#ff4d4f',
                    borderRadius: 2
                },
                {
                    label: '阻塞',
                    data: displayBlocked,
                    backgroundColor: '#fa8c16',
                    borderRadius: 2
                },
                {
                    label: '未执行',
                    data: displayNotRun,
                    backgroundColor: '#d9d9d9',
                    borderRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'x',
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        font: { size: 10 }
                    },
                    grid: { display: false }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: {
                        callback: function (value) {
                            return value.toLocaleString();
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        padding: 15,
                        usePointStyle: true,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `${context.dataset.label}: ${context.raw.toLocaleString()}`;
                        }
                    }
                }
            }
        }
    });
}

function renderDefectsTable(failedCases) {
    const tableBody = document.getElementById('defects-table-body');
    const paginationContainer = document.getElementById('defects-pagination');

    if (!tableBody) return;

    if (!failedCases || failedCases.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="no-data" style="text-align: center; padding: 20px; color: #999;">
                    暂无失败用例
                </td>
            </tr>
        `;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const totalItems = failedCases.length;
    const totalPages = Math.ceil(totalItems / DEFECTS_PAGE_SIZE);
    const startIndex = (defectsCurrentPage - 1) * DEFECTS_PAGE_SIZE;
    const endIndex = Math.min(startIndex + DEFECTS_PAGE_SIZE, totalItems);
    const pageData = failedCases.slice(startIndex, endIndex);

    tableBody.innerHTML = pageData.map((tc, index) => {
        const bugLink = tc.bugId
            ? `<a href="javascript:void(0)" class="bug-link" onclick="openBugDetail('${tc.bugId}')">${tc.bugId}</a>`
            : '-';

        return `
            <tr>
                <td>${startIndex + index + 1}</td>
                <td>${tc.caseId || tc.id || '-'}</td>
                <td class="case-name-cell" title="${escapeHtml(tc.name || '')}">${escapeHtml(tc.name || '-')}</td>
                <td>${tc.module || '-'}</td>
                <td><span class="priority-tag priority-${(tc.priority || 'P2').toLowerCase()}">${tc.priority || 'P2'}</span></td>
                <td>${tc.owner || '-'}</td>
                <td>${bugLink}</td>
            </tr>
        `;
    }).join('');

    if (paginationContainer && totalPages > 1) {
        paginationContainer.innerHTML = `
            <div class="pagination-controls">
                <span class="pagination-info">共 ${totalItems} 条，第 ${defectsCurrentPage}/${totalPages} 页</span>
                <div class="pagination-buttons">
                    <button class="pagination-btn" onclick="goToDefectsPage(1)" ${defectsCurrentPage === 1 ? 'disabled' : ''}>首页</button>
                    <button class="pagination-btn" onclick="goToDefectsPage(${defectsCurrentPage - 1})" ${defectsCurrentPage === 1 ? 'disabled' : ''}>上一页</button>
                    <button class="pagination-btn" onclick="goToDefectsPage(${defectsCurrentPage + 1})" ${defectsCurrentPage === totalPages ? 'disabled' : ''}>下一页</button>
                    <button class="pagination-btn" onclick="goToDefectsPage(${totalPages})" ${defectsCurrentPage === totalPages ? 'disabled' : ''}>末页</button>
                </div>
            </div>
        `;
    } else if (paginationContainer) {
        paginationContainer.innerHTML = `<span class="pagination-info">共 ${totalItems} 条记录</span>`;
    }
}

function goToDefectsPage(page) {
    if (!currentReportData || !currentReportData.failedCases) return;

    const totalPages = Math.ceil(currentReportData.failedCases.length / DEFECTS_PAGE_SIZE);
    if (page < 1 || page > totalPages) return;

    defectsCurrentPage = page;
    renderDefectsTable(currentReportData.failedCases);
}

function openBugDetail(bugId) {
    if (bugId) {
        window.open(`/bug/${bugId}`, '_blank');
    }
}

// 添加用例库
function addCaseLibrary() {
    console.log('添加用例库');
    // 打开新建用例库模态框
    const modal = document.getElementById('add-case-library-modal');
    if (modal) {
        modal.style.display = 'block';
    } else {
        console.error('新建用例库模态框未找到');
    }
}

// 用例库数据
let caseLibraries = [];

// 加载用例库列表用例库列表
async function loadCaseLibraries() {
    try {
        showLoading('加载用例库列表中...');

        console.log('加载用例库列表');

        const librariesData = await apiRequest('/libraries/list', { useCache: false });

        console.log('从API获取的用例库数据:', librariesData);

        if (librariesData.success && librariesData.libraries) {
            console.log('成功加载用例库数量:', librariesData.libraries.length);
            caseLibraries = librariesData.libraries;
        } else {
            console.warn('API加载失败，使用空数据');
            caseLibraries = [];
        }

        renderCaseLibrariesTable();
    } catch (error) {
        console.error('加载用例库错误:', error);
        caseLibraries = [];
        renderCaseLibrariesTable();
    } finally {
        hideLoading();
    }
}

// 渲染用例库列表
function renderCaseLibrariesTable() {
    console.log('渲染用例库列表:', caseLibraries);
    const tableBody = document.getElementById('case-library-body');

    if (!tableBody) {
        console.error('用例库表格体未找到');
        return;
    }

    // 更新计数显示
    const countElement = document.querySelector('.case-library-count');
    if (countElement) {
        countElement.textContent = `共 ${caseLibraries.length} 个`;
    }

    if (caseLibraries.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="padding: 60px 20px; text-align: center;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5">
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                        </svg>
                        <span style="color: #94a3b8; font-size: 14px;">暂无用例库，点击上方按钮创建</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = caseLibraries.map(library => {
        console.log('渲染用例库:', library);
        const moduleCount = library.moduleCount || library.module_count || 0;

        // 获取当前用户信息，判断是否为管理员
        const currentUser = getCurrentUserFull();
        const isAdmin = currentUser && (currentUser.role === '管理员' || currentUser.role === 'admin');

        return `
            <tr data-library-id="${library.id}">
                <td>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                            </svg>
                        </div>
                        <span class="case-library-name">${library.name || '未命名'}</span>
                    </div>
                </td>
                <td style="color: #64748b;">${library.creator || library.owner || 'admin'}</td>
                <td style="color: #64748b;">${formatDateTime(library.createdAt || library.created_at || '')}</td>
                <td style="text-align: right;">
                    <span style="display: inline-flex; align-items: center; gap: 4px; background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%); padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; color: #6366f1;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="7" height="7"></rect>
                            <rect x="14" y="3" width="7" height="7"></rect>
                            <rect x="14" y="14" width="7" height="7"></rect>
                            <rect x="3" y="14" width="7" height="7"></rect>
                        </svg>
                        ${moduleCount}
                    </span>
                </td>
                <td style="text-align: center;">
                    ${isAdmin ? `
                        <button class="delete-library-btn" data-library-id="${library.id}" data-library-name="${(library.name || '未命名').replace(/"/g, '&quot;')}" title="删除用例库">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"></path>
                            </svg>
                            删除
                        </button>
                    ` : `
                        <button disabled title="仅管理员可执行此操作" style="background: #f3f4f6; border: 1px solid #e5e7eb; color: #9ca3af; padding: 6px 12px; border-radius: 6px; cursor: not-allowed; font-size: 12px; display: inline-flex; align-items: center; gap: 4px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                            </svg>
                            删除
                        </button>
                    `}
                </td>
            </tr>
        `;
    }).join('');

    // 绑定删除按钮事件
    const deleteButtons = tableBody.querySelectorAll('.delete-library-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', function (e) {
            // 阻止事件冒泡，防止触发行点击事件
            e.stopPropagation();
            e.preventDefault();

            const libraryId = this.getAttribute('data-library-id');
            const libraryName = this.getAttribute('data-library-name');
            deleteLibrary(libraryId, libraryName);
        });
    });
}

// 用例库创建模式切换
let currentLibraryCreateMode = 'new';

function toggleLibraryCreateMode(mode) {
    currentLibraryCreateMode = mode;
    
    const newCard = document.getElementById('lib-mode-card-new');
    const cloneCard = document.getElementById('lib-mode-card-clone');
    const newForm = document.getElementById('new-library-form-section');
    const cloneForm = document.getElementById('clone-library-form-section');
    const submitBtn = document.getElementById('case-library-submit-btn');
    
    if (mode === 'new') {
        newCard.classList.add('active');
        cloneCard.classList.remove('active');
        newForm.style.display = 'block';
        cloneForm.style.display = 'none';
        submitBtn.textContent = '创建';
    } else {
        newCard.classList.remove('active');
        cloneCard.classList.add('active');
        newForm.style.display = 'none';
        cloneForm.style.display = 'block';
        submitBtn.textContent = '开始克隆';
        
        // 加载源用例库列表
        loadLibrariesForLibraryClone();
    }
}

// 加载源用例库列表（用于克隆用例库）
async function loadLibrariesForLibraryClone() {
    try {
        const result = await apiRequest('/libraries/list');
        
        if (result.success) {
            const select = document.getElementById('clone-source-library-select');
            select.innerHTML = '<option value="">请选择源用例库</option>';
            
            result.libraries.forEach(lib => {
                const option = document.createElement('option');
                option.value = lib.id;
                option.textContent = lib.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('加载用例库列表失败:', error);
    }
}

// 获取当前用户信息（完整对象）
function getCurrentUserFull() {
    // 优先使用全局变量 currentUser
    if (currentUser) {
        return currentUser;
    }

    // 尝试从 localStorage 获取
    try {
        const userStr = localStorage.getItem('user') || localStorage.getItem('currentUser') || sessionStorage.getItem('user');
        if (userStr) {
            return JSON.parse(userStr);
        }
    } catch (error) {
        console.error('获取用户信息失败:', error);
    }

    // 如果都没有，返回默认管理员（开发环境）
    console.warn('未找到用户信息，返回默认管理员');
    return { username: 'admin', role: '管理员' };
}

// 删除用例库 - 高危操作，需要二次确认
async function deleteLibrary(libraryId, libraryName) {
    console.log('deleteLibrary 被调用:', { libraryId, libraryName });

    // 获取当前用户信息
    const user = getCurrentUserFull();
    console.log('当前用户:', user);

    const isAdmin = user && (user.role === '管理员' || user.role === 'admin');
    console.log('是否管理员:', isAdmin);

    if (!isAdmin) {
        showErrorMessage('权限不足：仅管理员可以删除用例库');
        return;
    }

    // 显示删除确认弹窗
    showDeleteConfirmModal(libraryId, libraryName);
}

// 显示删除确认弹窗
function showDeleteConfirmModal(libraryId, libraryName) {
    // 创建弹窗HTML
    const modalHtml = `
        <div id="delete-confirm-modal" class="modal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); z-index: 10000; justify-content: center; align-items: center;">
            <div class="modal-content" style="background: white; border-radius: 16px; width: 480px; max-width: 90%; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
                <div class="modal-header" style="padding: 20px 24px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 12px;">
                    <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2">
                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #1f2937;">高危操作确认</h3>
                        <p style="margin: 4px 0 0 0; font-size: 13px; color: #6b7280;">删除用例库将清空所有关联数据</p>
                    </div>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <div style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: flex-start; gap: 12px;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;">
                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                            </svg>
                            <div>
                                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #991b1b;">警告：此操作不可恢复！</p>
                                <p style="margin: 0; font-size: 13px; color: #7f1d1d;">删除用例库 <strong>"${libraryName}"</strong> 将同时删除其下所有的模块、测试点和测试用例数据。</p>
                            </div>
                        </div>
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 8px;">
                            请输入 <strong style="color: #dc2626;">${libraryName}</strong> 以确认删除：
                        </label>
                        <input type="text" id="delete-confirm-input" placeholder="请输入用例库名称" style="width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; outline: none; transition: all 0.2s;" onfocus="this.style.borderColor='#dc2626'" onblur="this.style.borderColor='#e5e7eb'">
                    </div>
                    <div id="delete-error-msg" style="color: #dc2626; font-size: 13px; margin-top: 8px; display: none;"></div>
                </div>
                <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                    <button onclick="closeDeleteConfirmModal()" style="padding: 10px 20px; border: 1px solid #d1d5db; border-radius: 8px; background: white; color: #374151; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;">取消</button>
                    <button id="confirm-delete-btn" onclick="confirmDeleteLibrary(${libraryId}, '${libraryName.replace(/'/g, "\\'")}')" style="padding: 10px 20px; border: none; border-radius: 8px; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: white; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;">确认删除</button>
                </div>
            </div>
        </div>
    `;

    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 聚焦输入框
    setTimeout(() => {
        const input = document.getElementById('delete-confirm-input');
        if (input) input.focus();
    }, 100);
}

// 关闭删除确认弹窗
function closeDeleteConfirmModal() {
    const modal = document.getElementById('delete-confirm-modal');
    if (modal) {
        modal.remove();
    }
}

// 确认删除用例库
async function confirmDeleteLibrary(libraryId, libraryName) {
    const input = document.getElementById('delete-confirm-input');
    const errorMsg = document.getElementById('delete-error-msg');
    const confirmBtn = document.getElementById('confirm-delete-btn');

    if (!input) return;

    const inputValue = input.value.trim();

    // 校验输入的名称是否匹配
    if (inputValue !== libraryName) {
        errorMsg.textContent = '输入的名称不匹配，请重新输入';
        errorMsg.style.display = 'block';
        input.style.borderColor = '#dc2626';
        return;
    }

    // 禁用按钮，显示加载状态
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span style="display: inline-flex; align-items: center; gap: 6px;"><svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path></svg>删除中...</span>';

    try {
        const token = localStorage.getItem('authToken');

        const response = await fetch(`/api/libraries/${libraryId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();

        if (result.success) {
            // 关闭弹窗
            closeDeleteConfirmModal();

            // 显示成功提示
            showSuccessMessage('用例库删除成功');

            // 重新加载用例库列表
            await loadCaseLibraries();
        } else {
            errorMsg.textContent = result.message || '删除失败，请稍后重试';
            errorMsg.style.display = 'block';
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '确认删除';
        }
    } catch (error) {
        console.error('删除用例库错误:', error);
        errorMsg.textContent = '网络错误，请稍后重试';
        errorMsg.style.display = 'block';
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '确认删除';
    }
}

// 验证用例库数据库持久化
async function verifyCaseLibraryPersistence() {
    try {
        showLoading('验证数据库持久化中...');

        console.log('开始验证用例库持久化...');

        // 清空本地缓存
        caseLibraries = [];

        // 重新从数据库加载
        await loadCaseLibraries();

        console.log('验证完成，当前用例库数量:', caseLibraries.length);

        if (caseLibraries.length > 0) {
            console.log('持久化的用例库:', caseLibraries);

            // 更新计数显示
            const countElement = document.querySelector('.case-library-count');
            if (countElement) {
                countElement.textContent = `共 ${caseLibraries.length} 个`;
            }

            showSuccessMessage(`数据库持久化验证成功！\n当前共有 ${caseLibraries.length} 个用例库\n最新的用例库: ${caseLibraries[caseLibraries.length - 1]?.name || '无'}`);
        } else {
            showErrorMessage('数据库中暂无用例库');
        }

    } catch (error) {
        console.error('验证持久化错误:', error);
        showErrorMessage('验证数据库持久化失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 导入用例
function importTestCases() {
    console.log('导入用例');
    // 这里将实现导入用例功能
}

// 配置中心功能
function initConfigCenter() {
    // 初始化左侧菜单点击事件
    initConfigSidebar();

    // 配置标签点击事件（兼容旧版）
    document.addEventListener('click', function (e) {
        // 处理新版左侧菜单项点击
        if (e.target.closest('.menu-item')) {
            const menuItem = e.target.closest('.menu-item');
            const panelId = menuItem.dataset.panel;

            if (panelId) {
                // 更新菜单项状态
                document.querySelectorAll('.menu-item').forEach(item => {
                    item.classList.remove('active');
                });
                menuItem.classList.add('active');

                // 更新面板显示
                document.querySelectorAll('.config-panel').forEach(panel => {
                    panel.classList.remove('active');
                });

                const targetPanel = document.getElementById(panelId);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                }

                // 更新 URL hash
                const configName = menuItem.getAttribute('href')?.replace('#config=', '');
                if (configName) {
                    history.replaceState(null, '', `#config=${configName}`);
                }

                // 触发对应的数据加载
                loadConfigPanelData(panelId);
            }
        }

        // 处理旧版标签点击（兼容）
        if (e.target.classList.contains('config-tab')) {
            const tabName = e.target.dataset.tab;

            // 更新标签状态
            document.querySelectorAll('.config-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            e.target.classList.add('active');

            // 更新面板显示
            document.querySelectorAll('.config-panel').forEach(panel => {
                panel.classList.remove('active');
            });
            document.getElementById(`${tabName}-config`).classList.add('active');

            // 触发对应的数据加载
            loadConfigPanelData(`${tabName}-config`);
        }
    });

    // 从 URL hash 恢复配置面板状态
    restoreConfigPanelFromHash();
}

// 初始化配置中心侧边栏
function initConfigSidebar() {
    // 根据用户角色动态隐藏菜单
    applyMenuVisibilityByRole();
    
    // 监听 URL hash 变化
    window.addEventListener('hashchange', function () {
        restoreConfigPanelFromHash();
    });
}

// 根据用户角色动态隐藏菜单项
function applyMenuVisibilityByRole() {
    const userRole = currentUser?.role;
    // 支持中英文角色值判断管理员权限
    const isAdmin = userRole === '管理员' || userRole === 'admin' || userRole === 'Administrator';
    
    // 先重置所有菜单项和菜单组的显示状态
    document.querySelectorAll('.menu-item').forEach(item => {
        item.style.display = '';
    });
    document.querySelectorAll('.menu-group').forEach(group => {
        group.style.display = '';
    });
    
    // 先移除所有active状态
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelectorAll('.config-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    // 非管理员隐藏的菜单组
    const adminOnlyMenuGroups = [
        'users-config',        // 用户管理
        'email-config',        // 邮件配置
        'projects-config',     // 项目配置
        'environment-config',  // 测试环境
        'test-progress-config',// 测试进度
        'report-templates-config', // 报告模板
        'test-phase-config',   // 测试阶段
        'test-type-config',    // 测试类型
        'test-status-config',  // 测试状态
        'priority-config',     // 优先级
        'test-method-config',  // 测试方式
        'test-software-config',// 测试软件
        'test-source-config'   // 测试点来源
    ];
    
    if (!isAdmin) {
        // 隐藏管理员专属菜单组
        adminOnlyMenuGroups.forEach(panelId => {
            const menuItem = document.querySelector(`.menu-item[data-panel="${panelId}"]`);
            if (menuItem) {
                menuItem.style.display = 'none';
            }
        });
        
        // 隐藏包含隐藏菜单项的菜单组标题
        document.querySelectorAll('.menu-group').forEach(group => {
            const visibleItems = group.querySelectorAll('.menu-item:not([style*="display: none"])');
            if (visibleItems.length === 0) {
                group.style.display = 'none';
            }
        });
        
        // 非管理员默认显示个人设置面板
        const profileMenuItem = document.querySelector('.menu-item[data-panel="profile-config"]');
        if (profileMenuItem) {
            profileMenuItem.classList.add('active');
        }
        const profilePanel = document.getElementById('profile-config');
        if (profilePanel) {
            profilePanel.classList.add('active');
        }
        // 加载个人设置数据（仅已登录用户）
        if (currentUser) {
            loadProfileData();
        }
    } else {
        // 管理员默认显示用户管理
        const usersMenuItem = document.querySelector('.menu-item[data-panel="users-config"]');
        if (usersMenuItem) {
            usersMenuItem.classList.add('active');
        }
        const usersPanel = document.getElementById('users-config');
        if (usersPanel) {
            usersPanel.classList.add('active');
        }
    }
}

// 从 URL hash 恢复配置面板
function restoreConfigPanelFromHash() {
    const hash = window.location.hash;
    const configMatch = hash.match(/#config=(.+)/);

    if (configMatch) {
        const configName = configMatch[1];
        const menuItem = document.querySelector(`.menu-item[href="#config=${configName}"]`);

        if (menuItem) {
            // 模拟点击菜单项
            menuItem.click();
        }
    }
}

// 加载配置面板数据
function loadConfigPanelData(panelId) {
    // 根据面板 ID 加载对应数据
    const dataLoaders = {
        'profile-config': loadProfileData,
        'notifications-config': loadNotificationPrefs,
        'users-config': loadUsers,
        'email-config': loadEmailConfigs,
        'hyperlink-config': loadHyperlinkConfigs,
        'projects-config': loadProjects,
        'environment-config': loadEnvironments,
        'test-source-config': loadTestSources,
        'test-method-config': loadTestMethods,
        'test-type-config': loadTestTypes,
        'test-status-config': loadTestStatusConfigs,
        'priority-config': loadPriorities,
        'test-phase-config': loadTestPhases,
        'test-progress-config': loadTestProgressConfigs,
        'test-software-config': loadTestSoftwares,
        'report-templates-config': loadReportTemplates,
        'ai-config-config': initAIConfigPage,
        'ai-skills-config': loadAISkills
    };

    const loader = dataLoaders[panelId];
    if (loader && typeof loader === 'function') {
        console.log('加载配置面板数据:', panelId);
        loader();
    } else {
        console.warn('未找到配置面板加载函数:', panelId);
    }
}

// ========================================
// 个人设置功能
// ========================================

let profileEmail = '';

async function loadProfileData() {
    try {
        const result = await apiRequest('/users/profile', { useCache: false });
        if (result.success && result.data) {
            const user = result.data;
            
            document.getElementById('profile-avatar').textContent = user.username.charAt(0).toUpperCase();
            document.getElementById('profile-username').textContent = user.username;
            document.getElementById('profile-role').textContent = user.role;
            
            profileEmail = user.email || '';
            document.getElementById('profile-email-display').textContent = profileEmail || '未设置';
        } else {
            console.error('加载用户信息失败:', result);
            showErrorMessage(result.message || '加载用户信息失败');
        }
    } catch (error) {
        console.error('加载用户信息失败:', error);
        showErrorMessage('加载用户信息失败');
    }
}

function showEditEmailModal() {
    document.getElementById('modal-current-email').value = profileEmail || '';
    document.getElementById('modal-new-email').value = '';
    document.getElementById('edit-email-modal').style.display = 'flex';
}

function closeEditEmailModal() {
    document.getElementById('edit-email-modal').style.display = 'none';
}

async function submitEmailChange() {
    const newEmail = document.getElementById('modal-new-email').value.trim();
    
    if (!newEmail) {
        showErrorMessage('请输入新邮箱地址');
        return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
        showErrorMessage('邮箱格式不正确');
        return;
    }
    
    try {
        const result = await apiRequest('/users/email', {
            method: 'PUT',
            body: JSON.stringify({ email: newEmail })
        });
        
        if (result.success) {
            showSuccessMessage('邮箱修改成功');
            profileEmail = newEmail;
            document.getElementById('profile-email-display').textContent = newEmail;
            closeEditEmailModal();
        } else {
            showErrorMessage(result.message || '修改失败');
        }
    } catch (error) {
        console.error('修改邮箱失败:', error);
        showErrorMessage('修改邮箱失败');
    }
}

function showEditPasswordModal() {
    document.getElementById('modal-current-password').value = '';
    document.getElementById('modal-new-password').value = '';
    document.getElementById('modal-confirm-password').value = '';
    document.getElementById('edit-password-modal').style.display = 'flex';
}

function closeEditPasswordModal() {
    document.getElementById('edit-password-modal').style.display = 'none';
}

async function submitPasswordChange() {
    const currentPassword = document.getElementById('modal-current-password').value;
    const newPassword = document.getElementById('modal-new-password').value;
    const confirmPassword = document.getElementById('modal-confirm-password').value;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
        showErrorMessage('请填写所有密码字段');
        return;
    }
    
    if (newPassword.length < 6) {
        showErrorMessage('新密码长度不能少于6位');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showErrorMessage('两次输入的新密码不一致');
        return;
    }
    
    try {
        const result = await apiRequest('/users/password', {
            method: 'PUT',
            body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
        });
        
        if (result.success) {
            showSuccessMessage('密码修改成功');
            closeEditPasswordModal();
        } else {
            showErrorMessage(result.message || '修改失败');
        }
    } catch (error) {
        console.error('修改密码失败:', error);
        showErrorMessage('修改密码失败');
    }
}

// ========================================
// 消息提醒设置功能
// ========================================

async function loadNotificationPrefs() {
    try {
        const result = await apiRequest('/users/preferences');
        if (result.success && result.data) {
            const prefs = result.data;
            document.getElementById('pref-email-mentions').checked = prefs.email_notify_mentions;
            document.getElementById('pref-email-comments').checked = prefs.email_notify_comments;
            document.getElementById('pref-email-likes').checked = prefs.email_notify_likes;
        }
    } catch (error) {
        console.error('加载消息提醒配置失败:', error);
        showErrorMessage('加载提醒配置失败');
    }
}

async function saveNotificationPrefs() {
    const btn = document.getElementById('save-notification-prefs-btn');
    btn.disabled = true;
    btn.textContent = '保存中...';
    
    const prefs = {
        email_notify_mentions: document.getElementById('pref-email-mentions').checked,
        email_notify_comments: document.getElementById('pref-email-comments').checked,
        email_notify_likes: document.getElementById('pref-email-likes').checked
    };
    
    try {
        const result = await apiRequest('/users/preferences', {
            method: 'PUT',
            body: JSON.stringify(prefs)
        });
        
        if (result.success) {
            showSuccessMessage('消息提醒配置已保存');
        } else {
            showErrorMessage(result.message || '保存失败');
        }
    } catch (error) {
        console.error('保存消息提醒配置失败:', error);
        showErrorMessage('保存配置失败');
    } finally {
        btn.disabled = false;
        btn.textContent = '保存设置';
    }
}

// 绑定保存按钮事件
document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('save-notification-prefs-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveNotificationPrefs);
    }
});

// ========================================
// 邮件配置功能
// ========================================

let emailConfigsList = [];

// 加载邮件配置列表
async function loadEmailConfigs() {
    try {
        const result = await apiRequest('/email/configs');
        if (result.success) {
            emailConfigsList = result.configs;
            renderEmailConfigsTable(result.configs);
            await loadEmailStats();
        }
    } catch (error) {
        console.error('加载邮件配置失败:', error);
    }
}

// 渲染邮件配置表格
function renderEmailConfigsTable(configs) {
    const tbody = document.getElementById('email-config-body');
    if (!tbody) return;

    if (configs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="no-data">暂无邮件配置</td></tr>';
        return;
    }

    tbody.innerHTML = configs.map(config => `
        <tr>
            <td>
                ${config.config_name}
                ${config.is_default ? '<span style="background: #007bff; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 6px;">默认</span>' : ''}
            </td>
            <td>${config.email_type === 'smtp' ? '企业邮箱SMTP' : '自建服务器'}</td>
            <td>${config.smtp_host || '-'}</td>
            <td>${config.sender_name || '-'}<br><small style="color: #666;">${config.sender_email || ''}</small></td>
            <td>
                <span style="color: ${config.is_enabled ? '#28a745' : '#dc3545'};">
                    ${config.is_enabled ? '✓ 已启用' : '✗ 已禁用'}
                </span>
            </td>
            <td>${config.sent_today || 0} / ${config.daily_limit || 500}</td>
            <td>
                <button class="action-btn edit-btn" onclick="editEmailConfig(${config.id})" title="编辑">✏️</button>
                <button class="action-btn test-btn" onclick="quickTestEmail(${config.id})" title="测试">🧪</button>
                ${!config.is_default ? `<button class="action-btn delete-btn" onclick="deleteEmailConfig(${config.id})" title="删除">🗑️</button>` : ''}
            </td>
        </tr>
    `).join('');
}

// 加载邮件统计
async function loadEmailStats() {
    try {
        const result = await apiRequest('/email/stats');
        if (result.success) {
            const stats = result.stats;
            document.getElementById('email-today-sent').textContent = stats.today?.total || 0;
            document.getElementById('email-today-success').textContent = stats.today?.sent || 0;
            document.getElementById('email-today-failed').textContent = stats.today?.failed || 0;

            // 计算剩余配额
            const defaultConfig = emailConfigsList.find(c => c.is_default);
            const remaining = defaultConfig ? (defaultConfig.daily_limit - (defaultConfig.sent_today || 0)) : 500;
            document.getElementById('email-remaining').textContent = Math.max(0, remaining);
        }
    } catch (error) {
        console.error('加载邮件统计失败:', error);
    }
}

// 切换邮件配置字段显示
function toggleEmailConfigFields() {
    const emailType = document.getElementById('email-type').value;
    const smtpFields = document.getElementById('smtp-config-fields');
    const selfHostedFields = document.getElementById('self-hosted-config-fields');

    if (emailType === 'smtp') {
        smtpFields.style.display = 'block';
        selfHostedFields.style.display = 'none';
    } else {
        smtpFields.style.display = 'none';
        selfHostedFields.style.display = 'block';
    }
}

// 打开添加邮件配置模态框
function openAddEmailConfigModal() {
    document.getElementById('email-modal-title').textContent = '添加邮件配置';
    document.getElementById('email-config-form').reset();
    document.getElementById('email-config-id').value = '';
    document.getElementById('smtp-port').value = '587';
    document.getElementById('daily-limit').value = '500';
    document.getElementById('email-is-enabled').checked = true;
    toggleEmailConfigFields();
    document.getElementById('email-config-modal').style.display = 'flex';
}

// 编辑邮件配置
async function editEmailConfig(id) {
    try {
        const result = await apiRequest(`/email/configs/${id}`);
        if (result.success) {
            const config = result.config;
            document.getElementById('email-modal-title').textContent = '编辑邮件配置';
            document.getElementById('email-config-id').value = config.id;
            document.getElementById('email-config-name').value = config.config_name;
            document.getElementById('email-type').value = config.email_type;
            document.getElementById('smtp-host').value = config.smtp_host || '';
            document.getElementById('smtp-port').value = config.smtp_port || 587;
            document.getElementById('smtp-user').value = config.smtp_user || '';
            document.getElementById('smtp-secure').checked = config.smtp_secure;
            document.getElementById('sender-email').value = config.sender_email || '';
            document.getElementById('sender-name').value = config.sender_name || '';
            document.getElementById('self-hosted-api-url').value = config.self_hosted_api_url || '';
            document.getElementById('daily-limit').value = config.daily_limit || 500;
            document.getElementById('email-is-enabled').checked = config.is_enabled;
            document.getElementById('email-is-default').checked = config.is_default;

            toggleEmailConfigFields();
            document.getElementById('email-config-modal').style.display = 'flex';
        }
    } catch (error) {
        console.error('获取邮件配置失败:', error);
        showToast('获取邮件配置失败', 'error');
    }
}

// 切换密码可见性
function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    
    button.innerHTML = isPassword 
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
}

// 关闭邮件配置模态框
function closeEmailConfigModal() {
    document.getElementById('email-config-modal').style.display = 'none';
}

// 保存邮件配置
async function saveEmailConfig() {
    const id = document.getElementById('email-config-id').value;
    const config = {
        config_name: document.getElementById('email-config-name').value,
        email_type: document.getElementById('email-type').value,
        smtp_host: document.getElementById('smtp-host').value,
        smtp_port: parseInt(document.getElementById('smtp-port').value) || 587,
        smtp_secure: document.getElementById('smtp-secure').checked,
        smtp_user: document.getElementById('smtp-user').value,
        smtp_password: document.getElementById('smtp-password').value,
        sender_email: document.getElementById('sender-email').value,
        sender_name: document.getElementById('sender-name').value,
        self_hosted_api_url: document.getElementById('self-hosted-api-url').value,
        self_hosted_api_key: document.getElementById('self-hosted-api-key').value,
        daily_limit: parseInt(document.getElementById('daily-limit').value) || 500,
        is_enabled: document.getElementById('email-is-enabled').checked,
        is_default: document.getElementById('email-is-default').checked
    };

    if (!config.config_name) {
        showToast('请输入配置名称', 'error');
        return;
    }

    try {
        let result;
        if (id) {
            result = await apiRequest(`/email/configs/${id}`, {
                method: 'PUT',
                body: JSON.stringify(config)
            });
        } else {
            result = await apiRequest('/email/configs', {
                method: 'POST',
                body: JSON.stringify(config)
            });
        }

        if (result.success) {
            showToast(id ? '邮件配置更新成功' : '邮件配置创建成功', 'success');
            closeEmailConfigModal();
            loadEmailConfigs();
        } else {
            showToast(result.message || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存邮件配置失败:', error);
        showToast('保存失败', 'error');
    }
}

// 删除邮件配置
async function deleteEmailConfig(id) {
    if (!(await showConfirmMessage('确定要删除此邮件配置吗？'))) return;

    try {
        const result = await apiRequest(`/email/configs/${id}`, { method: 'DELETE' });
        if (result.success) {
            showToast('邮件配置删除成功', 'success');
            loadEmailConfigs();
        } else {
            showToast(result.message || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除邮件配置失败:', error);
        showToast('删除失败', 'error');
    }
}

// 打开测试邮件模态框
function openTestEmailModal() {
    // 填充配置选项
    const select = document.getElementById('test-email-config');
    select.innerHTML = '<option value="">默认配置</option>' +
        emailConfigsList.filter(c => c.is_enabled).map(c =>
            `<option value="${c.id}">${c.config_name}</option>`
        ).join('');

    document.getElementById('test-email-modal').style.display = 'flex';
}

// 关闭测试邮件模态框
function closeTestEmailModal() {
    document.getElementById('test-email-modal').style.display = 'none';
}

// ==================== 超链接配置管理 ====================

// 加载超链接配置列表
async function loadHyperlinkConfigs() {
    const tbody = document.getElementById('hyperlink-config-body');
    if (!tbody) return;

    try {
        const result = await apiRequest('/hyperlink-configs/list');
        
        if (result.success && result.configs) {
            if (result.configs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无配置</td></tr>';
                return;
            }

            tbody.innerHTML = result.configs.map(config => `
                <tr data-id="${config.id}">
                    <td><strong>${escapeHtml(config.name)}</strong></td>
                    <td><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${escapeHtml(config.prefix)}</code></td>
                    <td>${escapeHtml(config.description || '-')}</td>
                    <td>${config.sort_order || 0}</td>
                    <td>${formatDateTime(config.created_at)}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="action-btn edit" onclick="editHyperlinkConfig(${config.id})" title="编辑">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                            <button class="action-btn delete" onclick="deleteHyperlinkConfig(${config.id})" title="删除">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }
    } catch (error) {
        console.error('加载超链接配置失败:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">加载失败</td></tr>';
    }
}

// 添加超链接配置按钮事件
document.getElementById('add-hyperlink-config-btn')?.addEventListener('click', () => {
    openHyperlinkConfigModal();
});

// 打开超链接配置模态框
function openHyperlinkConfigModal(config = null) {
    const modal = document.getElementById('hyperlink-config-modal');
    const title = document.getElementById('hyperlink-modal-title');
    const form = document.getElementById('hyperlink-config-form');
    
    if (config) {
        title.textContent = '编辑超链接配置';
        document.getElementById('hyperlink-config-id').value = config.id;
        document.getElementById('hyperlink-config-name').value = config.name;
        document.getElementById('hyperlink-config-prefix').value = config.prefix;
        document.getElementById('hyperlink-config-description').value = config.description || '';
        document.getElementById('hyperlink-config-sort').value = config.sort_order || 0;
    } else {
        title.textContent = '添加超链接配置';
        form.reset();
        document.getElementById('hyperlink-config-id').value = '';
    }
    
    modal.style.display = 'flex';
}

// 关闭超链接配置模态框
function closeHyperlinkConfigModal() {
    document.getElementById('hyperlink-config-modal').style.display = 'none';
}

// 保存超链接配置
async function saveHyperlinkConfig() {
    const id = document.getElementById('hyperlink-config-id').value;
    const name = document.getElementById('hyperlink-config-name').value.trim();
    const prefix = document.getElementById('hyperlink-config-prefix').value.trim();
    const description = document.getElementById('hyperlink-config-description').value.trim();
    const sort_order = parseInt(document.getElementById('hyperlink-config-sort').value) || 0;

    if (!name || !prefix) {
        showErrorMessage('名称和前缀不能为空');
        return;
    }

    try {
        const url = id ? '/hyperlink-configs/update' : '/hyperlink-configs/add';
        const body = id ? { id, name, prefix, description, sort_order } : { name, prefix, description, sort_order };
        
        const result = await apiRequest(url, {
            method: 'POST',
            body: JSON.stringify(body)
        });

        if (result.success) {
            showSuccessMessage(id ? '更新成功' : '添加成功');
            closeHyperlinkConfigModal();
            loadHyperlinkConfigs();
        } else {
            showErrorMessage(result.message || '操作失败');
        }
    } catch (error) {
        console.error('保存超链接配置失败:', error);
        showErrorMessage('操作失败');
    }
}

// 编辑超链接配置
async function editHyperlinkConfig(id) {
    try {
        const result = await apiRequest('/hyperlink-configs/list');
        if (result.success && result.configs) {
            const config = result.configs.find(c => c.id === id);
            if (config) {
                openHyperlinkConfigModal(config);
            }
        }
    } catch (error) {
        console.error('获取配置失败:', error);
        showErrorMessage('获取配置失败');
    }
}

// 删除超链接配置
async function deleteHyperlinkConfig(id) {
    if (!(await showConfirmMessage('确定要删除这个超链接配置吗？'))) {
        return;
    }

    try {
        const result = await apiRequest(`/hyperlink-configs/${id}`, { method: 'DELETE' });
        if (result.success) {
            showSuccessMessage('删除成功');
            loadHyperlinkConfigs();
        } else {
            showErrorMessage(result.message || '删除失败');
        }
    } catch (error) {
        console.error('删除超链接配置失败:', error);
        showErrorMessage('删除失败');
    }
}

// 快速测试邮件
function quickTestEmail(configId) {
    document.getElementById('test-email-config').value = configId;
    document.getElementById('test-email-to').value = '';
    document.getElementById('test-email-modal').style.display = 'flex';
}

// 发送测试邮件
async function sendTestEmail() {
    const to = document.getElementById('test-email-to').value;
    const configId = document.getElementById('test-email-config').value;

    if (!to) {
        showToast('请输入收件人邮箱', 'error');
        return;
    }

    try {
        showToast('正在发送测试邮件...', 'info');
        const result = await apiRequest('/email/test', {
            method: 'POST',
            body: JSON.stringify({ to, configId: configId || null })
        });

        if (result.success) {
            showToast('测试邮件发送成功，请检查收件箱', 'success');
            closeTestEmailModal();
            loadEmailStats();
        } else {
            showToast(result.message || '发送失败', 'error');
        }
    } catch (error) {
        console.error('发送测试邮件失败:', error);
        showToast('发送失败', 'error');
    }
}

// 邮件配置按钮事件
document.addEventListener('click', function (e) {
    if (e.target.id === 'add-email-config-btn' || e.target.closest('#add-email-config-btn')) {
        openAddEmailConfigModal();
    }
    if (e.target.id === 'test-email-btn' || e.target.closest('#test-email-btn')) {
        openTestEmailModal();
    }
    if (e.target.id === 'view-email-logs-btn' || e.target.closest('#view-email-logs-btn')) {
        viewEmailLogs();
    }
});

// 查看邮件发送日志
async function viewEmailLogs() {
    try {
        const result = await apiRequest('/email/logs?pageSize=50');
        if (result.success) {
            const logs = result.logs;
            let logsHtml = `
                <div style="max-height: 400px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">收件人</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">主题</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">类型</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">状态</th>
                                <th style="padding: 8px; text-align: left; border-bottom: 1px solid #ddd;">时间</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            if (logs.length === 0) {
                logsHtml += '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #999;">暂无发送记录</td></tr>';
            } else {
                logs.forEach(log => {
                    const statusColor = log.status === 'sent' ? '#28a745' : (log.status === 'failed' ? '#dc3545' : '#ffc107');
                    const statusText = log.status === 'sent' ? '成功' : (log.status === 'failed' ? '失败' : '待发送');
                    logsHtml += `
                        <tr>
                            <td style="padding: 8px; border-bottom: 1px solid #eee;">${log.recipient_email}</td>
                            <td style="padding: 8px; border-bottom: 1px solid #eee; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${log.subject}</td>
                            <td style="padding: 8px; border-bottom: 1px solid #eee;">${log.email_type || '-'}</td>
                            <td style="padding: 8px; border-bottom: 1px solid #eee;"><span style="color: ${statusColor};">${statusText}</span></td>
                            <td style="padding: 8px; border-bottom: 1px solid #eee;">${log.created_at || '-'}</td>
                        </tr>
                    `;
                });
            }

            logsHtml += '</tbody></table></div>';

            // 使用确认模态框显示日志
            const modal = document.getElementById('confirm-modal');
            document.querySelector('#confirm-modal .modal-header h3').textContent = '📋 邮件发送日志';
            document.getElementById('confirm-message').innerHTML = logsHtml;
            document.querySelector('#confirm-modal .modal-footer').style.display = 'none';
            modal.style.display = 'flex';
        }
    } catch (error) {
        console.error('获取邮件日志失败:', error);
        showToast('获取邮件日志失败', 'error');
    }
}

// 保存系统配置
document.addEventListener('click', function (e) {
    if (e.target.id === 'save-system-config') {
        saveSystemConfig();
    }
});

// 保存集成配置
document.addEventListener('click', function (e) {
    if (e.target.id === 'save-integration-config') {
        saveIntegrationConfig();
    }
});

// 添加用户
document.addEventListener('click', function (e) {
    if (e.target.id === 'add-user-btn' || e.target.closest('#add-user-btn')) {
        addUser();
    }
});

// 添加项目
document.addEventListener('click', function (e) {
    if (e.target.id === 'add-project-btn' || e.target.closest('#add-project-btn')) {
        addProject();
    }
});

// 添加环境
document.addEventListener('click', function (e) {
    if (e.target.id === 'add-environment-btn') {
        addEnvironment();
    }
    else if (e.target.id === 'add-test-source-btn') {
        openAddTestSourceModal();
    }
    else if (e.target.id === 'add-test-method-btn') {
        addTestMethod();
    }
    else if (e.target.id === 'add-test-type-btn') {
        addTestType();
    }
    else if (e.target.id === 'add-test-software-btn') {
        addTestSoftware();
    }
    else if (e.target.id === 'add-test-status-btn') {
        addTestStatus();
    }
    else if (e.target.id === 'add-priority-btn') {
        addPriority();
    }
    else if (e.target.id === 'add-test-phase-btn') {
        addTestPhase();
    }
    else if (e.target.id === 'add-test-progress-btn') {
        addTestProgress();
    }
});

// 用户管理表格按钮事件委托
document.addEventListener('click', function (e) {
    // 用户编辑按钮
    if (e.target.classList.contains('config-action-btn') && e.target.classList.contains('edit') && e.target.closest('#users-config')) {
        const row = e.target.closest('tr');
        const userId = row.dataset.userId;
        if (userId) editUser(parseInt(userId));
    }
    // 用户删除按钮
    else if (e.target.classList.contains('config-action-btn') && e.target.classList.contains('delete') && e.target.closest('#users-config')) {
        const row = e.target.closest('tr');
        const userId = row.dataset.userId;
        if (userId) deleteUser(parseInt(userId));
    }
    // 项目编辑按钮
    else if (e.target.classList.contains('config-action-btn') && e.target.classList.contains('edit') && e.target.closest('#projects-config')) {
        const row = e.target.closest('tr');
        const projectName = row.cells[0].textContent;
        const projectCode = row.cells[1].textContent;
        editProject(projectName, projectCode);
    }
    // 项目删除按钮
    else if (e.target.classList.contains('config-action-btn') && e.target.classList.contains('delete') && e.target.closest('#projects-config')) {
        const row = e.target.closest('tr');
        const projectName = row.cells[0].textContent;
        deleteProject(projectName);
    }
});

// 加载项目列表
async function loadProjects() {
    try {
        console.log('开始加载项目列表');

        try {
            // 尝试调用API加载项目列表
            console.log('调用API: /projects/list');
            const projectsData = await apiRequest('/projects/list', { useCache: false });

            console.log('API响应:', projectsData);

            // 处理不同的返回格式
            if (Array.isArray(projectsData)) {
                // 后端直接返回项目数组
                console.log('后端直接返回项目数组:', projectsData);
                // 转换 snake_case 到 camelCase
                projects = projectsData.map(project => ({
                    ...project,
                    createdAt: project.createdAt || project.created_at
                }));
            } else if (projectsData.success && projectsData.projects) {
                // 后端返回 { success: true, projects: [...] } 格式
                console.log('后端返回标准格式:', projectsData.projects);
                // 转换 snake_case 到 camelCase
                projects = projectsData.projects.map(project => ({
                    ...project,
                    createdAt: project.createdAt || project.created_at
                }));
            } else if (projectsData.message) {
                // 后端返回错误信息
                console.log('后端返回错误信息:', projectsData.message);
                // 即使返回错误信息，也继续执行（可能是权限问题）
            } else {
                // 加载失败时使用默认数据
                console.log('API调用失败，使用默认数据');
                // 如果没有项目数据，使用默认项目
                if (projects.length === 0) {
                    projects = [
                        { name: 'CTCSDK项目', code: 'CTCSDK', description: 'SDK功能测试项目', createdAt: '2026-01-01' }
                    ];
                }
            }
        } catch (error) {
            console.error('API调用失败，使用默认数据:', error);
            // 即使API调用失败，也继续执行
            // 如果没有项目数据，使用默认项目
            if (projects.length === 0) {
                projects = [
                    { name: 'CTCSDK项目', code: 'CTCSDK', description: 'SDK功能测试项目', createdAt: '2026-01-01' }
                ];
            }
        }

        // 更新项目管理页面
        console.log('更新项目管理页面');
        updateProjectsTable();
        // 更新测试报告页面的项目列表
        try {
            renderProjectsList();
        } catch (e) {
            console.log('renderProjectsList跳过:', e.message);
        }
        // 更新测试计划模态框的项目多选组件
        loadProjectsToMultiSelect();

        console.log('项目列表加载完成');
    } catch (error) {
        console.error('加载项目列表失败:', error);
        // 加载失败时使用默认数据
        console.log('捕获到错误，使用默认数据');
        // 如果没有项目数据，使用默认项目
        if (projects.length === 0) {
            projects = [
                { name: 'CTCSDK项目', code: 'CTCSDK', description: 'SDK功能测试项目', createdAt: '2026-01-01' }
            ];
        }
        // 更新项目管理页面
        console.log('更新项目管理页面');
        updateProjectsTable();
        // 更新测试报告页面的项目列表
        try {
            renderProjectsList();
        } catch (e) {
            console.log('renderProjectsList跳过:', e.message);
        }
    }
}

// 更新项目表格
function updateProjectsTable() {
    const projectsBody = document.getElementById('projects-config-body');
    if (projectsBody) {
        console.log('更新项目管理页面表格');

        // 使用存储的项目数据
        if (projects && projects.length > 0) {
            projectsBody.innerHTML = projects.map(project => `
                <tr>
                    <td>${project.name}</td>
                    <td>${project.code}</td>
                    <td>${project.description}</td>
                    <td>${formatDateTime(project.createdAt || project.created_at || '')}</td>
                    <td>
                        <button class="config-action-btn edit">编辑</button>
                        <button class="config-action-btn delete">删除</button>
                    </td>
                </tr>
            `).join('');
        } else {
            projectsBody.innerHTML = `
                <tr>
                    <td colspan="5" class="no-data">暂无项目</td>
                </tr>
            `;
        }
    } else {
        console.error('项目管理页面表格元素未找到');
    }
}

// 保存系统配置
async function saveSystemConfig() {
    try {
        showLoading('保存系统配置中...');

        const configData = {
            systemName: document.getElementById('system-name').value,
            adminEmail: document.getElementById('admin-email').value,
            systemLanguage: document.getElementById('system-language').value,
            loginTimeout: document.getElementById('login-timeout').value,
            passwordComplexity: document.getElementById('password-complexity').value
        };

        // 调用API保存配置
        const saveData = await apiRequest('/config/system', {
            method: 'POST',
            body: JSON.stringify(configData)
        });

        if (saveData.success) {
            showSuccessMessage('系统配置保存成功');
        } else {
            showErrorMessage('系统配置保存失败: ' + (saveData.message || '保存失败，请稍后重试'));
        }
    } catch (error) {
        console.error('保存系统配置错误:', error);
        showErrorMessage('系统配置保存失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 保存集成配置
async function saveIntegrationConfig() {
    try {
        showLoading('保存集成配置中...');

        const configData = {
            jiraUrl: document.getElementById('jira-url').value,
            jiraToken: document.getElementById('jira-token').value,
            jenkinsUrl: document.getElementById('jenkins-url').value,
            jenkinsUsername: document.getElementById('jenkins-username').value,
            jenkinsToken: document.getElementById('jenkins-token').value
        };

        // 调用API保存配置
        const saveData = await apiRequest('/config/integration', {
            method: 'POST',
            body: JSON.stringify(configData)
        });

        if (saveData.success) {
            showSuccessMessage('集成配置保存成功');
        } else {
            showErrorMessage('集成配置保存失败: ' + (saveData.message || '保存失败，请稍后重试'));
        }
    } catch (error) {
        console.error('保存集成配置错误:', error);
        showErrorMessage('集成配置保存失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 添加项目
function addProject() {
    const modal = document.getElementById('add-project-modal');
    const header = modal.querySelector('.modal-header h3');
    header.textContent = '添加项目';
    // 重置表单
    document.getElementById('add-project-form').reset();
    modal.style.display = 'block';
}

// 编辑项目
function editProject(projectName, projectCode) {
    const modal = document.getElementById('add-project-modal');
    const header = modal.querySelector('.modal-header h3');
    header.textContent = '编辑项目';

    // 从 projects 数组中获取完整项目数据
    const project = projects.find(p => p.name === projectName || p.code === projectCode);
    
    if (project) {
        document.getElementById('project-name').value = project.name || '';
        document.getElementById('project-code').value = project.code || '';
        document.getElementById('project-description').value = project.description || '';
        
        // 保存项目ID供后续使用
        modal.dataset.editProjectId = project.id;
        modal.dataset.editProjectCode = project.code;
    } else {
        // 如果找不到项目数据，使用传入的参数
        document.getElementById('project-name').value = projectName;
        document.getElementById('project-code').value = projectCode;
        document.getElementById('project-description').value = '';
    }

    modal.style.display = 'block';
}

// 删除项目
async function deleteProject(projectName) {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    if (!(await showConfirmMessage(`确定要删除项目 "${projectName}" 吗？`))) return;

    try {
        showLoading('删除项目中...');

        // 调用API删除项目
        const deleteData = await apiRequest('/projects/delete', {
            method: 'POST',
            body: JSON.stringify({ name: projectName })
        });

        // 处理不同的返回格式
        if (deleteData.message === '项目删除成功' || deleteData.success) {
            // 从本地数据中移除项目
            projects = projects.filter(project => project.name !== projectName);
            // 重新加载项目列表
            await loadProjects();
            showSuccessMessage('项目删除成功');
        } else {
            showErrorMessage('项目删除失败: ' + (deleteData.message || '删除失败，请稍后重试'));
        }
    } catch (error) {
        console.error('删除项目错误:', error);
        showErrorMessage('项目删除失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 关闭项目模态框
function closeProjectModal() {
    const modal = document.getElementById('add-project-modal');
    modal.style.display = 'none';
}

// 提交项目表单
async function submitProjectForm() {
    try {
        showLoading('添加项目中...');

        // 获取表单数据
        const formData = {
            name: document.getElementById('project-name').value,
            code: document.getElementById('project-code').value,
            description: document.getElementById('project-description').value
        };

        try {
            // 尝试调用API创建项目
            const createData = await apiRequest('/projects/add', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            console.log('创建项目API响应:', createData);

            // 处理不同的返回格式
            if (createData.message === '项目添加成功' || createData.success) {
                // 添加新项目到存储
                const newProject = {
                    ...formData,
                    createdAt: getCurrentDateTime() // 当前日期时间
                };
                projects.push(newProject);

                // 重新加载项目列表
                console.log('项目创建成功，重新加载项目列表');
                await loadProjects();

                // 关闭模态框
                closeProjectModal();

                // 清空表单
                document.getElementById('add-project-form').reset();

                // 记录历史
                addHistoryRecord('创建项目', `创建了项目 ${formData.name}`);

                showSuccessMessage('项目创建成功');
            } else {
                // 检查是否是JSON解析错误或HTML响应错误
                if (createData.message && (createData.message.includes('JSON') || createData.message.includes('DOCTYPE') || createData.message.includes('HTML') || createData.message.includes('token'))) {
                    console.error('API返回非JSON响应，使用模拟数据:', createData.message);
                    // 模拟成功创建项目
                    console.log('模拟项目创建成功，重新加载项目列表');

                    // 添加新项目到存储
                    const newProject = {
                        ...formData,
                        createdAt: getCurrentDateTime() // 当前日期时间
                    };
                    projects.push(newProject);

                    // 重新加载项目列表
                    await loadProjects();

                    // 关闭模态框
                    closeProjectModal();

                    // 清空表单
                    document.getElementById('add-project-form').reset();

                    // 记录历史
                    addHistoryRecord('创建项目', `创建了项目 ${formData.name}`);

                    showSuccessMessage('项目创建成功');
                } else {
                    showErrorMessage('创建项目失败: ' + (createData.message || '创建失败，请稍后重试'));
                }
            }
        } catch (error) {
            console.error('API调用失败，使用模拟数据:', error);
            // 即使API调用失败，也模拟成功创建项目
            // 这样用户体验更好，后续后端实现后会自动使用真实API

            // 添加新项目到存储
            const newProject = {
                ...formData,
                createdAt: getCurrentDateTime() // 当前日期时间
            };
            projects.push(newProject);

            // 重新加载项目列表
            console.log('模拟项目创建成功，重新加载项目列表');
            await loadProjects();

            // 关闭模态框
            closeProjectModal();

            // 清空表单
            document.getElementById('add-project-form').reset();

            // 记录历史
            addHistoryRecord('创建项目', `创建了项目 ${formData.name}`);

            showSuccessMessage('项目创建成功');
        }
    } catch (error) {
        console.error('创建项目错误:', error);
        showErrorMessage('创建项目失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 加载环境列表
async function loadEnvironments() {
    try {
        showLoading('加载环境列表中...');

        const response = await apiRequest('/environments/list', { useCache: false });

        if (response.success) {
            updateEnvironmentTable(response.environments);
        } else {
            console.error('加载环境列表失败:', response.message);
            updateEnvironmentTable([]);
        }
    } catch (error) {
        console.error('加载环境列表错误:', error);
        updateEnvironmentTable([]);
    } finally {
        hideLoading();
    }
}

// 更新环境表格
function updateEnvironmentTable(environments) {
    const environmentBody = document.getElementById('environment-config-body');
    if (environmentBody) {
        if (environments && environments.length > 0) {
            environmentBody.innerHTML = environments.map(environment => `
                <tr>
                    <td>${environment.name}</td>
                    <td>${environment.description || '-'}</td>
                    <td>${environment.creator || 'admin'}</td>
                    <td>${environment.created_at || environment.createdAt || '-'}</td>
                    <td>
                        <button class="config-action-btn edit" onclick="editEnvironment(${environment.id || environment.env_id})">编辑</button>
                        <button class="config-action-btn delete" onclick="deleteEnvironment(${environment.id || environment.env_id})">删除</button>
                    </td>
                </tr>
            `).join('');
        } else {
            environmentBody.innerHTML = `
                <tr>
                    <td colspan="5" class="no-data">暂无环境数据</td>
                </tr>
            `;
        }
    }
}

// 添加环境
function addEnvironment() {
    console.log('添加环境');
    const modal = document.getElementById('add-environment-modal');
    modal.style.display = 'block';
    // 重置表单和编辑状态
    document.getElementById('add-environment-form').reset();
    window.currentEditingEnvironment = null;
}

// 添加测试方式
function addTestMethod() {
    console.log('添加测试方式');
    const modal = document.getElementById('add-test-method-modal');
    modal.style.display = 'block';
    // 重置表单和编辑状态
    document.getElementById('add-test-method-form').reset();
    window.currentEditingTestMethod = null;
}

// 编辑环境
async function editEnvironment(environmentId) {
    try {
        showLoading('加载环境信息中...');

        const response = await apiRequest(`/environments/get?id=${environmentId}`);

        if (response.success) {
            const environment = response.environment;
            window.currentEditingEnvironment = environment;

            // 填充表单
            document.getElementById('environment-name').value = environment.name;
            document.getElementById('environment-description').value = environment.description || '';

            // 显示模态框
            const modal = document.getElementById('add-environment-modal');
            modal.style.display = 'block';
        } else {
            showErrorMessage('加载环境信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('编辑环境错误:', error);
        showErrorMessage('加载环境信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除环境
async function deleteEnvironment(environmentId) {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    // 首先确保没有加载遮罩
    hideLoading();

    // 使用setTimeout确保confirm在新的事件循环中执行，避免与其他事件冲突
    setTimeout(async function () {
        // 显示确认对话框
        if (!(await showConfirmMessage('确定要删除这个环境吗？'))) {
            return;
        }

        try {
            showLoading('删除环境中...');

            const response = await apiRequest(`/environments/delete?id=${environmentId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('环境删除成功');
                await loadEnvironments();
            } else {
                showErrorMessage('环境删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除环境错误:', error);
            showErrorMessage('环境删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }, 0);
}

// 关闭测试计划模态框
function closeTestPlanModal() {
    const modal = document.getElementById('add-testplan-modal');
    modal.style.display = 'none';
}

// 关闭测试报告模态框
function closeTestReportModal() {
    const modal = document.getElementById('add-testreport-modal');
    modal.style.display = 'none';
}

// 关闭用例库模态框
function closeCaseLibraryModal() {
    const modal = document.getElementById('add-case-library-modal');
    modal.style.display = 'none';
    
    // 重置为新建模式
    currentLibraryCreateMode = 'new';
    toggleLibraryCreateMode('new');
    
    // 清空表单
    const newForm = document.getElementById('add-case-library-form');
    if (newForm) newForm.reset();
    
    const cloneNameInput = document.getElementById('clone-library-name');
    if (cloneNameInput) cloneNameInput.value = '';
    
    const sourceSelect = document.getElementById('clone-source-library-select');
    if (sourceSelect) sourceSelect.selectedIndex = 0;
}

// 提交用例库表单
async function submitCaseLibraryForm() {
    if (currentLibraryCreateMode === 'clone') {
        return submitCloneLibraryForm();
    }
    
    try {
        showLoading('创建用例库中...');

        const caseLibraryNameInput = document.getElementById('case-library-name');
        const caseLibraryConfigInput = document.getElementById('case-library-config');

        if (!caseLibraryNameInput) {
            throw new Error('用例库名称输入框未找到');
        }

        const rawName = caseLibraryNameInput.value || '';
        const trimmedName = rawName.trim();

        const formData = {
            name: trimmedName,
            creator: currentUser ? currentUser.username : 'admin',
            createdAt: getCurrentDateTime(),
            moduleCount: 0,
            config: caseLibraryConfigInput ? caseLibraryConfigInput.value : ''
        };

        if (!formData.name || formData.name.length === 0) {
            throw new Error('请输入用例库名称');
        }

        const createData = await apiRequest('/libraries/create', {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        if (createData.success) {
            caseLibraries = [];
            await loadCaseLibraries();
            closeCaseLibraryModal();
            
            const form = document.getElementById('add-case-library-form');
            if (form) form.reset();
            
            const counter = document.getElementById('case-library-name-counter');
            if (counter) counter.textContent = '0/64';

            addHistoryRecord('创建用例库', `创建了用例库 ${formData.name}`);

            if (createData.libraryId) {
                currentCaseLibraryId = createData.libraryId;
                const currentCaseLibraryElement = document.getElementById('current-case-library');
                if (currentCaseLibraryElement) {
                    currentCaseLibraryElement.textContent = formData.name;
                }
                showSection('case-management');
                clearLevel1PointsDisplay();
                currentModulePage = 1;
                initModuleData();
            }

            showSuccessMessage('用例库创建成功');
        } else {
            showErrorMessage('创建用例库失败: ' + (createData.message || '创建失败'));
        }
    } catch (error) {
        showErrorMessage('创建用例库失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 提交克隆用例库表单
async function submitCloneLibraryForm() {
    try {
        const sourceLibraryId = document.getElementById('clone-source-library-select').value;
        const newLibraryName = document.getElementById('clone-library-name').value.trim();
        
        if (!sourceLibraryId) {
            showErrorMessage('请选择源用例库');
            return;
        }
        
        if (!newLibraryName) {
            showErrorMessage('请输入新用例库名称');
            return;
        }
        
        const includeLevel1Points = document.getElementById('clone-lib-include-level1').checked;
        const includeTestCases = document.getElementById('clone-lib-include-cases').checked;
        const clearTestStatus = document.getElementById('clone-lib-reset-status').checked;
        const clearOwner = document.getElementById('clone-lib-reset-owner').checked;
        const clearProjects = document.getElementById('clone-lib-clear-projects').checked;
        const clearExecutionRecords = document.getElementById('clone-lib-clear-records').checked;
        
        showLoading('正在克隆用例库...');
        
        const requestBody = {
            sourceLibraryId: parseInt(sourceLibraryId),
            newLibraryName,
            includeLevel1Points,
            includeTestCases,
            clearTestStatus,
            clearOwner,
            clearProjects,
            clearExecutionRecords
        };
        
        const result = await apiRequest('/libraries/clone', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });
        
        hideLoading();
        
        if (result.success) {
            closeCaseLibraryModal();
            
            const data = result.data || {};
            let message = `用例库克隆成功！\n`;
            if (data.clonedModuleCount) message += `已克隆 ${data.clonedModuleCount} 个模块\n`;
            if (data.clonedLevel1Count) message += `已克隆 ${data.clonedLevel1Count} 个测试点\n`;
            if (data.clonedCaseCount) message += `已克隆 ${data.clonedCaseCount} 个用例`;
            showSuccessMessage(message);
            
            caseLibraries = [];
            await loadCaseLibraries();
        } else {
            showErrorMessage('克隆失败: ' + (result.message || '未知错误'));
        }
    } catch (error) {
        hideLoading();
        showErrorMessage('克隆用例库失败: ' + error.message);
    }
}

// 提交测试计划表单
async function submitTestPlanForm() {
    try {
        // 验证测试计划名称
        const planName = document.getElementById('plan-name').value.trim();
        if (!planName) {
            showErrorMessage('测试计划名称不能为空');
            return;
        }

        showLoading('创建测试计划中...');

        // 获取表单数据
        const formData = {
            name: planName,
            owner: document.getElementById('plan-owner').value,
            testPhase: document.getElementById('plan-phase').value,
            project: document.getElementById('plan-project').value,
            iteration: document.getElementById('plan-iteration').value,
            status: 'not_started', // 默认状态
            description: '', // 默认描述
            startDate: getCurrentDate(), // 默认开始日期为今天
            endDate: getCurrentDate(), // 默认结束日期为今天
            modules: selectedModules || [] // 关联的模块
        };

        // 调用API创建测试计划
        const createData = await apiRequest('/testplans/create', {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        if (createData.success) {
            // 重新加载测试计划
            await loadTestPlans();

            // 关闭模态框
            closeTestPlanModal();

            // 清空表单
            document.getElementById('add-testplan-form').reset();

            // 清空已选择的项目
            clearSelectedProjects();

            // 清空已选择的模块
            clearSelectedModules();

            // 记录历史
            addHistoryRecord('创建测试计划', `创建了测试计划 ${formData.name}`);

            showSuccessMessage('测试计划创建成功');
        } else {
            showErrorMessage('创建测试计划失败: ' + (createData.message || '创建失败，请稍后重试'));
        }
    } catch (error) {
        console.error('创建测试计划错误:', error);
        showErrorMessage('创建测试计划失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 初始化多选组件
function initProjectMultiSelect() {
    const multiSelectInput = document.getElementById('project-multi-select');
    const dropdown = document.getElementById('project-dropdown');
    const searchInput = document.getElementById('project-search');
    const optionsContainer = document.getElementById('project-options');
    const hiddenInput = document.getElementById('plan-project');

    if (!multiSelectInput || !dropdown || !searchInput || !optionsContainer || !hiddenInput) {
        return;
    }

    // 设置下拉框最大高度
    optionsContainer.style.maxHeight = '300px';
    optionsContainer.style.overflowY = 'auto';

    // 切换下拉框显示/隐藏
    multiSelectInput.addEventListener('click', function () {
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        multiSelectInput.parentElement.classList.toggle('open');
    });

    // 点击其他地方关闭下拉框
    document.addEventListener('click', function (event) {
        if (!multiSelectInput.contains(event.target) && !dropdown.contains(event.target)) {
            dropdown.style.display = 'none';
            multiSelectInput.parentElement.classList.remove('open');
        }
    });

    // 搜索功能
    searchInput.addEventListener('input', function () {
        const searchTerm = this.value.toLowerCase();
        const options = optionsContainer.querySelectorAll('.multi-select-option');

        options.forEach(option => {
            const text = option.textContent.toLowerCase();
            option.style.display = text.includes(searchTerm) ? 'block' : 'none';
        });
    });

    // 加载项目数据
    loadProjectsToMultiSelect();
}

// 加载项目数据到多选组件
function loadProjectsToMultiSelect() {
    const optionsContainer = document.getElementById('project-options');
    if (!optionsContainer) return;

    // 清空现有选项
    optionsContainer.innerHTML = '';

    console.log('加载项目数据到多选组件:', projects);

    // 加载项目数据
    if (projects && projects.length > 0) {
        projects.forEach(project => {
            const option = document.createElement('div');
            option.className = 'multi-select-option';
            option.innerHTML = `
                <label for="project-${project.name}">${project.name}</label>
                <input type="checkbox" value="${project.name}" id="project-${project.name}">
            `;

            // 处理选择事件
            const checkbox = option.querySelector('input[type="checkbox"]');

            // 直接绑定change事件
            checkbox.addEventListener('change', function () {
                if (this.checked) {
                    addSelectedProject(project.name);
                } else {
                    removeSelectedProject(project.name);
                }
            });

            // 处理整行点击事件
            option.addEventListener('click', function (event) {
                // 防止点击标签时触发两次事件
                if (event.target.tagName !== 'LABEL' && event.target.tagName !== 'INPUT') {
                    // 直接切换checkbox状态
                    checkbox.checked = !checkbox.checked;
                    // 手动触发change事件
                    const changeEvent = new Event('change');
                    checkbox.dispatchEvent(changeEvent);
                }
            });

            // 处理标签点击事件
            const label = option.querySelector('label');
            label.addEventListener('click', function (event) {
                // 标签点击会自动触发checkbox的change事件
                // 不需要额外处理
            });

            optionsContainer.appendChild(option);
        });
    } else {
        optionsContainer.innerHTML = '<div class="multi-select-option" style="color: #999; cursor: not-allowed;">暂无项目数据</div>';
    }
}
// 添加已选择的项目
function addSelectedProject(projectName) {
    const container = document.getElementById('selected-projects-container');
    const hiddenInput = document.getElementById('plan-project');

    if (!container || !hiddenInput) return;

    // 检查是否已经添加过
    const existingTag = container.querySelector(`[data-project="${projectName}"]`);
    if (existingTag) return;

    // 创建标签
    const tag = document.createElement('div');
    tag.className = 'selected-project-tag';
    tag.setAttribute('data-project', projectName);
    tag.innerHTML = `
        ${projectName}
        <span class="remove-tag" onclick="removeSelectedProject('${projectName}')">&times;</span>
    `;

    container.appendChild(tag);

    // 更新隐藏输入值
    updateHiddenProjectInput();
}

// 移除已选择的项目
function removeSelectedProject(projectName) {
    const container = document.getElementById('selected-projects-container');
    const checkbox = document.getElementById(`project-${projectName}`);

    if (!container) return;

    // 移除标签
    const tag = container.querySelector(`[data-project="${projectName}"]`);
    if (tag) {
        tag.remove();
    }

    // 取消勾选 - 只设置状态，不触发事件
    if (checkbox) {
        checkbox.checked = false;
    }

    // 更新隐藏输入值
    updateHiddenProjectInput();
}

// 更新隐藏输入值
function updateHiddenProjectInput() {
    const container = document.getElementById('selected-projects-container');
    const hiddenInput = document.getElementById('plan-project');

    if (!container || !hiddenInput) return;

    const selectedProjects = [];
    const tags = container.querySelectorAll('.selected-project-tag');

    tags.forEach(tag => {
        selectedProjects.push(tag.getAttribute('data-project'));
    });

    hiddenInput.value = selectedProjects.join(',');
}

// 清空已选择的项目
function clearSelectedProjects() {
    const container = document.getElementById('selected-projects-container');
    const hiddenInput = document.getElementById('plan-project');
    const checkboxes = document.querySelectorAll('#project-options input[type="checkbox"]');

    if (container) {
        container.innerHTML = '';
    }

    if (hiddenInput) {
        hiddenInput.value = '';
    }

    if (checkboxes) {
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
    }
}

// 提交测试报告表单
async function submitTestReportForm() {
    try {
        showLoading('创建测试报告中...');

        // 获取选中的测试计划
        const selectedPlans = [];
        const checkedBoxes = document.querySelectorAll('.test-plan-checkbox:checked');
        checkedBoxes.forEach(checkbox => {
            const row = checkbox.closest('tr');
            if (row) {
                selectedPlans.push({
                    name: row.cells[1].textContent,
                    owner: row.cells[2].textContent,
                    status: row.cells[3].textContent,
                    phase: row.cells[4].textContent
                });
            }
        });

        // 获取第一个选中的测试计划作为主要关联计划
        const primaryTestPlan = selectedPlans.length > 0 ? selectedPlans[0].name : '';

        // 获取表单数据 - 匹配后端API要求
        const formData = {
            name: document.getElementById('report-name').value,
            creator: currentUser ? currentUser.username : 'admin',
            project: 'CTCSDK项目', // 默认项目
            iteration: 'v1.0', // 默认迭代
            testPlan: primaryTestPlan,
            type: 'daily', // 默认报告类型
            summary: `包含 ${selectedPlans.length} 个测试计划的报告`,
            startDate: getCurrentDate(),
            endDate: getCurrentDate()
        };

        // 调用API创建测试报告
        const createData = await apiRequest('/reports/create', {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        if (createData.success) {
            // 重新加载测试报告
            await loadTestReports();

            // 关闭模态框
            closeTestReportModal();

            // 清空表单
            document.getElementById('add-testreport-form').reset();

            // 记录历史
            addHistoryRecord('创建测试报告', `创建了测试报告 ${formData.name}`);

            showSuccessMessage('测试报告创建成功');
        } else {
            showErrorMessage('创建测试报告失败: ' + (createData.message || '创建失败，请稍后重试'));
        }
    } catch (error) {
        console.error('创建测试报告错误:', error);
        showErrorMessage('创建测试报告失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 检查当前用户是否为管理员
function isAdmin() {
    return !!(currentUser && (currentUser.role === '管理员' || currentUser.role === 'admin' || currentUser.role === 'Administrator'));
}

// 用户登录
async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const rememberMe = true;
    try {
        showLoading('登录中...');

        const loginData = await apiRequest('/users/login', {
            method: 'POST',
            body: JSON.stringify({ username, password, rememberMe })
        });

        if (loginData.token) {
            currentUser = loginData.user;
            authToken = loginData.token;

            localStorage.setItem('authToken', authToken);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            console.log('[登录] Token已保存到localStorage');

            document.documentElement.classList.add('authenticated');

            localStorage.setItem('rememberedUsername', username);
            console.log('[登录] 已记住用户名:', username);

            // 发送WebSocket登录事件
            if (socket && socket.connected) {
                socket.emit('login', currentUser);
            }

            // 安全地更新用户信息
            const userInfoElement = document.getElementById('user-info');
            if (userInfoElement) {
                // 清空内容并重新构建
                userInfoElement.innerHTML = '';
                // 创建用户文本（只显示用户名，不显示角色）
                const userText = document.createTextNode(`${currentUser.username} `);
                userInfoElement.appendChild(userText);
                // 创建登出按钮
                const logoutBtn = document.createElement('button');
                logoutBtn.id = 'logout-btn';
                logoutBtn.className = 'secondary-btn';
                logoutBtn.textContent = '登出';
                logoutBtn.style.display = 'inline-block';
                userInfoElement.appendChild(logoutBtn);
            }

            // 隐藏登录/注册页面，显示首页
            const loginSection = document.getElementById('login-section');
            if (loginSection) {
                loginSection.style.display = 'none';
            }

            const registerSection = document.getElementById('register-section');
            if (registerSection) {
                registerSection.style.display = 'none';
            }

            // 根据角色显示/隐藏相应功能
            const usersLink = document.querySelector('nav a[href="#users"]');
            if (usersLink) {
                // 支持中英文角色值判断管理员权限
                if (currentUser.role === '管理员' || currentUser.role === 'admin' || currentUser.role === 'Administrator') {
                    usersLink.style.display = 'block';
                } else {
                    usersLink.style.display = 'none';
                }
            }

            // 控制配置中心导航链接的显示
            console.log('登录成功后，currentUser完整信息:', currentUser);

            // 查找所有导航链接，确认选择器是否正确
            const allNavLinks = document.querySelectorAll('.nav-left a.nav-item');
            console.log('所有导航链接:', allNavLinks);

            const settingsLink = document.querySelector('.nav-left a[href="#/settings"]');
            console.log('找到的配置中心链接元素:', settingsLink);

            if (settingsLink) {
                // 所有登录用户都可以看到配置中心链接
                settingsLink.style.display = 'block';
                console.log('登录成功，显示配置中心链接');
            } else {
                console.error('未找到配置中心链接元素');
            }

            // 显示登出按钮
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.style.display = 'inline-block';
            }

            // 重新加载数据
            await loadData();
            await loadProjects();
            await loadCaseLibraries();

            // 如果当前在配置中心页面，刷新配置数据
            const currentRoute = Router.getCurrentRoute();
            if (currentRoute === 'settings') {
                console.log('[登录] 当前在配置中心，刷新数据');
                applyMenuVisibilityByRole();
                loadUsers();
                loadProjects();
            }

            // 加载最近登录人员
            await loadRecentLogins();

            // 记录登录历史
            addHistoryRecord('登录', `用户 ${currentUser.username} 登录系统`);

            // 使用路由系统跳转到首页
            Router.navigateTo('dashboard');
        } else {
            // 处理登录失败情况（包括审核状态）
            const errorMsg = loginData.message || '用户名或密码错误';
            showErrorMessage('登录失败: ' + errorMsg);
        }
    } catch (error) {
        console.error('登录错误:', error);
        showErrorMessage('登录失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 注册功能
async function register() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const email = document.getElementById('reg-email').value;

    try {
        showLoading('注册中...');

        // 调用注册API
        const registerData = await apiRequest('/users/register', {
            method: 'POST',
            body: JSON.stringify({ username, password, email, role: '测试人员' })
        });

        // 检查注册是否成功 - 兼容不同的返回格式
        const isSuccess = registerData.success || registerData.message === '注册成功';

        if (isSuccess) {
            // 更新用户列表
            await loadData();

            // 记录注册历史
            addHistoryRecord('注册', `新用户 ${username} 注册为测试人员`);

            showSuccessMessage('注册成功，请等待管理员审核后方可登录');

            // 切换到登录页面
            document.getElementById('register-section').style.display = 'none';
            document.getElementById('login-section').style.display = 'flex';
        } else {
            showErrorMessage('注册失败: ' + (registerData.message || '注册失败，请稍后重试'));
        }
    } catch (error) {
        console.error('注册错误:', error);
        showErrorMessage('注册失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 登出功能
function logout() {
    console.log('[登出] 开始执行登出操作');
    
    if (socket && socket.connected && currentUser) {
        socket.emit('logout');
    }

    const username = currentUser ? currentUser.username : '未知用户';
    
    currentUser = null;
    authToken = null;

    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    console.log('[登出] 已清除localStorage中的登录信息');
    console.log('[登出] currentUser:', currentUser, 'authToken:', authToken);

    document.documentElement.classList.remove('authenticated');

    // 更新用户信息
    const userInfoElement = document.getElementById('user-info');
    if (userInfoElement) {
        userInfoElement.innerHTML = '未登录 <button id="logout-btn" class="secondary-btn" style="display: none;">登出</button>';
    }

    // 隐藏配置中心导航链接
    const settingsLink = document.querySelector('.nav-left a[href="#/settings"]');
    if (settingsLink) {
        settingsLink.style.display = 'none';
        console.log('登出后，隐藏配置中心链接');
    }

    // 记录登出历史
    addHistoryRecord('登出', `用户 ${username} 登出系统`);
    
    // 使用路由系统导航到登录页面
    console.log('[登出] 准备导航到登录页面');
    Router.navigateTo('login');
    console.log('[登出] 导航命令已执行，当前hash:', window.location.hash);
}

// 添加历史记录
function addHistoryRecord(action, content) {
    const historyRecord = {
        time: formatDateTime(new Date()),
        user: currentUser ? currentUser.username : '系统',
        action: action,
        content: content,
        version: 'v1.0'
    };

    historyRecords.unshift(historyRecord);
    updateHistoryTable();
}

// 更新历史记录表格
function updateHistoryTable() {
    const historyTableBody = document.querySelector('#history-table tbody');
    if (historyTableBody) {
        historyTableBody.innerHTML = historyRecords.map(record => `
            <tr>
                <td>${record.time}</td>
                <td>${record.user}</td>
                <td>${record.action}</td>
                <td>${record.content}</td>
                <td>
                    <button class="history-action-btn">查看</button>
                </td>
            </tr>
        `).join('');
    }
}

// 图表实例存储
let chartInstances = {};

// 更新用户表格
function updateUsersTable() {
    const usersTableBody = document.querySelector('#users-table tbody');
    if (usersTableBody) {
        usersTableBody.innerHTML = mockUsers.map(user => `
            <tr>
                <td>${user.username}</td>
                <td>${user.role}</td>
                <td>${user.email}</td>
                <td>
                    <button class="edit-user-btn">编辑</button>
                    <button class="delete-user-btn">删除</button>
                </td>
            </tr>
        `).join('');
    }
}

// 初始化模块
function initModules() {
    // 这里可以添加初始化模块的逻辑
}

// 更新统计数据
async function updateStats() {
    try {
        // 更新数据来源显示
        const dataSourceEl = document.getElementById('data-source');
        if (dataSourceEl) dataSourceEl.textContent = '实时数据';

        // 获取测试管理统计数据
        const statsData = await apiRequest('/dashboard/stats');

        if (statsData.success) {
            const stats = statsData.stats;

            // 更新统计卡片
            const testcaseCountEl = document.getElementById('testcase-count');
            if (testcaseCountEl) testcaseCountEl.textContent = stats.totalTestCases || 0;

            const testReportCountEl = document.getElementById('test-report-count');
            if (testReportCountEl) testReportCountEl.textContent = stats.testReportCount || 0;

            const testPlanCountEl = document.getElementById('test-plan-count');
            if (testPlanCountEl) testPlanCountEl.textContent = stats.testPlanCount || 0;
        }

        // 更新最后刷新时间
        updateLastRefreshTime();

        // 加载筛选器选项
        await loadDashboardFilters();

        // 初始化图表
        await initDashboardCharts();

        // 加载详细数据表格
        await loadDashboardTables();

    } catch (error) {
        console.error('更新统计数据错误:', error);
    }
}

function updateLastRefreshTime() {
    const lastRefreshTimeEl = document.getElementById('last-refresh-time');
    if (lastRefreshTimeEl) {
        const now = new Date();
        lastRefreshTimeEl.textContent = formatDateTime(now);
    }
}

async function refreshDashboardData() {
    const refreshBtn = document.querySelector('.btn-refresh-data');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; animation: spin 1s linear infinite;">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            刷新中...
        `;
    }

    try {
        await updateStats();
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
                刷新数据
            `;
        }
    }
}

function drillDownToCases(type) {
    const filters = getCurrentFilters();

    // 添加权限过滤
    if (currentUser && currentUser.role !== '管理员') {
        filters.owner = currentUser.username;
    }

    switch (type) {
        case 'total':
            // 显示所有用例
            break;
        case 'passed':
            // 筛选通过的用例
            filters.statusFilter = 'passed';
            break;
        case 'failed':
            // 筛选失败的用例
            filters.statusFilter = 'failed';
            break;
        case 'pending':
            // 筛选待测试的用例
            filters.statusFilter = 'pending';
            break;
        case 'passRate':
            // 显示所有已测试用例
            break;
        case 'recentExecutions':
            // 显示最近执行的用例
            filters.recentDays = 7;
            break;
    }

    // 跳转到用例库页面并应用筛选
    window.location.hash = '#case-library';

    // 应用筛选到用例库
    setTimeout(() => {
        applyFiltersToCaseLibrary(filters);
    }, 100);
}

function applyFiltersToCaseLibrary(filters) {
    // 更新URL参数以便分享
    const url = new URL(window.location);
    Object.keys(filters).forEach(key => {
        if (filters[key] && filters[key] !== 'all') {
            url.searchParams.set(key, filters[key]);
        }
    });
    window.history.pushState({}, '', url);

    // 触发用例库筛选更新
    if (typeof loadCasesWithFilters === 'function') {
        loadCasesWithFilters(filters);
    }
}

function navigateToReports() {
    window.location.hash = '#test-reports';
}

function navigateToPlans() {
    window.location.hash = '#test-plans';
}

// 加载筛选器选项
async function loadDashboardFilters() {
    try {
        // 加载项目列表
        const projectsData = await apiRequest('/projects/list');
        if (projectsData.success && projectsData.projects) {
            const projectFilter = document.getElementById('project-filter');
            if (projectFilter) {
                projectFilter.innerHTML = '<option value="all">所有项目</option>';
                projectsData.projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.id;
                    option.textContent = project.name;
                    projectFilter.appendChild(option);
                });
            }
        }

        // 加载用户列表（负责人）
        const usersData = await apiRequest('/users/list');
        if (Array.isArray(usersData)) {
            const filteredUsers = filterOwners(usersData);
            const ownerFilter = document.getElementById('owner-filter');
            if (ownerFilter) {
                ownerFilter.innerHTML = '<option value="all">所有负责人</option>';
                filteredUsers.forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.username;
                    option.textContent = user.username;
                    ownerFilter.appendChild(option);
                });
            }
        }

        // 加载测试状态列表
        const statusData = await apiRequest('/test-statuses/list');
        if (statusData.success && statusData.testStatuses) {
            const statusFilter = document.getElementById('status-filter');
            if (statusFilter) {
                statusFilter.innerHTML = '<option value="all">所有状态</option>';
                statusData.testStatuses.forEach(status => {
                    const option = document.createElement('option');
                    option.value = status.id;
                    option.textContent = status.name;
                    statusFilter.appendChild(option);
                });
            }
        }

        // 加载测试进度列表
        const progressData = await apiRequest('/test-progresses/list');
        if (progressData.success && progressData.testProgresses) {
            const progressFilter = document.getElementById('progress-filter');
            if (progressFilter) {
                progressFilter.innerHTML = '<option value="all">所有进度</option>';
                progressData.testProgresses.forEach(progress => {
                    const option = document.createElement('option');
                    option.value = progress.id;
                    option.textContent = progress.name;
                    progressFilter.appendChild(option);
                });
            }
        }

        // 加载用例库列表
        const librariesData = await apiRequest('/libraries/list');
        if (librariesData.success && librariesData.libraries) {
            const libraryFilter = document.getElementById('library-filter');
            if (libraryFilter) {
                libraryFilter.innerHTML = '<option value="all">所有用例库</option>';
                librariesData.libraries.forEach(library => {
                    const option = document.createElement('option');
                    option.value = library.id;
                    option.textContent = library.name;
                    libraryFilter.appendChild(option);
                });
            }
        }

    } catch (error) {
        console.error('加载筛选器选项错误:', error);
    }
}

// 初始化仪表板图表
async function initDashboardCharts() {
    try {
        // 销毁之前的图表实例
        Object.values(chartInstances).forEach(chart => {
            if (chart) {
                chart.destroy();
            }
        });
        chartInstances = {};

        // 额外销毁所有 canvas 上的图表实例
        const chartIds = [
            'pass-rate-trend-chart',
            'execution-trend-chart',
            'project-progress-chart',
            'status-distribution-chart',
            'owner-tasks-chart',
            'owner-pass-rate-chart',
            'progress-trend-chart'
        ];
        
        chartIds.forEach(id => {
            const canvas = document.getElementById(id);
            if (canvas) {
                const existingChart = Chart.getChart(canvas);
                if (existingChart) {
                    existingChart.destroy();
                }
            }
        });

        // 初始化通过率趋势图表
        await initPassRateTrendChart(7);

        // 初始化执行次数趋势图表
        await initExecutionTrendChart(7);

        // 初始化项目测试进度图表
        await initProjectProgressChart();

        // 初始化测试状态分布图表
        await initStatusDistributionChart();

        // 初始化负责人任务图表
        await initOwnerTasksChart();

        // 初始化负责人通过率图表
        await initOwnerPassRateChart();

        // 初始化测试进度趋势图表
        await initProgressTrendChart();

    } catch (error) {
        console.error('初始化图表错误:', error);
    }
}

let currentTrendPeriod = 7;

async function switchTrendPeriod(days) {
    currentTrendPeriod = days;

    // 更新按钮状态
    document.querySelectorAll('.trend-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // 重新加载趋势图
    await initPassRateTrendChart(days);
    await initExecutionTrendChart(days);
    await initProgressTrendChart();
}

async function initPassRateTrendChart(days) {
    const ctx = document.getElementById('pass-rate-trend-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    try {
        const filters = getCurrentFilters();
        filters.days = days;
        const data = await apiRequest(`/dashboard/trend/pass-rate?${new URLSearchParams(filters).toString()}`);

        if (!data.success || !data.trendData) {
            // 如果API不可用，使用模拟数据
            const mockData = generateMockTrendData(days);
            renderPassRateTrendChart(ctx, mockData);
            return;
        }

        renderPassRateTrendChart(ctx, data.trendData);
    } catch (error) {
        console.error('初始化通过率趋势图表错误:', error);
        const mockData = generateMockTrendData(days);
        renderPassRateTrendChart(ctx, mockData);
    }
}

function renderPassRateTrendChart(ctx, trendData) {
    if (chartInstances.passRateTrendChart) {
        chartInstances.passRateTrendChart.destroy();
    }

    chartInstances.passRateTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trendData.labels,
            datasets: [{
                label: '通过率 (%)',
                data: trendData.passRates,
                borderColor: 'rgba(82, 196, 26, 1)',
                backgroundColor: 'rgba(82, 196, 26, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: {
                        display: true,
                        text: '通过率 (%)'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });
}

async function initExecutionTrendChart(days) {
    const ctx = document.getElementById('execution-trend-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    try {
        const filters = getCurrentFilters();
        filters.days = days;
        const data = await apiRequest(`/dashboard/trend/executions?${new URLSearchParams(filters).toString()}`);

        if (!data.success || !data.trendData) {
            // 如果API不可用，使用模拟数据
            const mockData = generateMockTrendData(days);
            renderExecutionTrendChart(ctx, mockData);
            return;
        }

        renderExecutionTrendChart(ctx, data.trendData);
    } catch (error) {
        console.error('初始化执行次数趋势图表错误:', error);
        const mockData = generateMockTrendData(days);
        renderExecutionTrendChart(ctx, mockData);
    }
}

function renderExecutionTrendChart(ctx, trendData) {
    if (chartInstances.executionTrendChart) {
        chartInstances.executionTrendChart.destroy();
    }

    chartInstances.executionTrendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: trendData.labels,
            datasets: [
                {
                    label: '通过',
                    data: trendData.passedCounts,
                    backgroundColor: 'rgba(82, 196, 26, 0.8)'
                },
                {
                    label: '失败',
                    data: trendData.failedCounts,
                    backgroundColor: 'rgba(255, 77, 79, 0.8)'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: '执行次数'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });
}

function generateMockTrendData(days) {
    const labels = [];
    const passRates = [];
    const passedCounts = [];
    const failedCounts = [];

    for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));

        passRates.push(Math.floor(Math.random() * 30 + 70));
        passedCounts.push(Math.floor(Math.random() * 20 + 5));
        failedCounts.push(Math.floor(Math.random() * 10 + 1));
    }

    return { labels, passRates, passedCounts, failedCounts };
}

// 初始化项目测试进度图表
async function initProjectProgressChart() {
    const ctx = document.getElementById('project-progress-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    try {
        const filters = getCurrentFilters();
        const data = await apiRequest(`/dashboard/project-progress?${new URLSearchParams(filters).toString()}`);
        if (!data.success || !data.projectProgress) return;

        const projects = data.projectProgress.slice(0, 10); // 只显示前10个项目

        if (chartInstances.projectProgressChart) {
            chartInstances.projectProgressChart.destroy();
        }

        chartInstances.projectProgressChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: projects.map(p => p.projectName),
                datasets: [
                    {
                        label: '通过',
                        data: projects.map(p => p.passedCount),
                        backgroundColor: 'rgba(82, 196, 26, 0.8)',
                        borderColor: 'rgba(82, 196, 26, 1)',
                        borderWidth: 1
                    },
                    {
                        label: '失败',
                        data: projects.map(p => p.failedCount),
                        backgroundColor: 'rgba(255, 77, 79, 0.8)',
                        borderColor: 'rgba(255, 77, 79, 1)',
                        borderWidth: 1
                    },
                    {
                        label: '待测试',
                        data: projects.map(p => p.pendingCount),
                        backgroundColor: 'rgba(102, 102, 102, 0.8)',
                        borderColor: 'rgba(102, 102, 102, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '用例数量'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    }
                }
            }
        });
    } catch (error) {
        console.error('初始化项目测试进度图表错误:', error);
    }
}

// 初始化测试状态分布图表
async function initStatusDistributionChart() {
    const ctx = document.getElementById('status-distribution-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    try {
        const filters = getCurrentFilters();
        const data = await apiRequest(`/dashboard/status-distribution?${new URLSearchParams(filters).toString()}`);
        if (!data.success || !data.statusDistribution) return;

        const statuses = data.statusDistribution.filter(s => s.count > 0);

        if (chartInstances.statusDistributionChart) {
            chartInstances.statusDistributionChart.destroy();
        }

        const colors = [
            'rgba(82, 196, 26, 0.8)',
            'rgba(255, 77, 79, 0.8)',
            'rgba(102, 102, 102, 0.8)',
            'rgba(250, 140, 22, 0.8)',
            'rgba(24, 144, 255, 0.8)',
            'rgba(114, 46, 209, 0.8)'
        ];

        chartInstances.statusDistributionChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: statuses.map(s => s.status_name || '未设置'),
                datasets: [{
                    data: statuses.map(s => s.count),
                    backgroundColor: colors.slice(0, statuses.length),
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            usePointStyle: true
                        }
                    }
                },
                cutout: '60%'
            }
        });
    } catch (error) {
        console.error('初始化测试状态分布图表错误:', error);
    }
}

// 初始化负责人任务图表
async function initOwnerTasksChart() {
    const ctx = document.getElementById('owner-tasks-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    try {
        const filters = getCurrentFilters();
        const data = await apiRequest(`/dashboard/owner-analysis?${new URLSearchParams(filters).toString()}`);
        if (!data.success || !data.ownerAnalysis) return;

        const owners = data.ownerAnalysis.slice(0, 10); // 只显示前10个负责人

        if (chartInstances.ownerTasksChart) {
            chartInstances.ownerTasksChart.destroy();
        }

        chartInstances.ownerTasksChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: owners.map(o => o.owner),
                datasets: [
                    {
                        label: '已完成',
                        data: owners.map(o => o.completedCount),
                        backgroundColor: 'rgba(82, 196, 26, 0.8)',
                        borderColor: 'rgba(82, 196, 26, 1)',
                        borderWidth: 1
                    },
                    {
                        label: '进行中',
                        data: owners.map(o => o.inProgressCount),
                        backgroundColor: 'rgba(24, 144, 255, 0.8)',
                        borderColor: 'rgba(24, 144, 255, 1)',
                        borderWidth: 1
                    },
                    {
                        label: '未开始',
                        data: owners.map(o => o.notStartedCount),
                        backgroundColor: 'rgba(102, 102, 102, 0.8)',
                        borderColor: 'rgba(102, 102, 102, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '任务数量'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    }
                }
            }
        });
    } catch (error) {
        console.error('初始化负责人任务图表错误:', error);
    }
}

// 初始化负责人通过率图表
async function initOwnerPassRateChart() {
    const ctx = document.getElementById('owner-pass-rate-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    try {
        const data = await apiRequest('/dashboard/owner-analysis');
        if (!data.success || !data.ownerAnalysis) return;

        const owners = data.ownerAnalysis.slice(0, 10); // 只显示前10个负责人

        if (chartInstances.ownerPassRateChart) {
            chartInstances.ownerPassRateChart.destroy();
        }

        chartInstances.ownerPassRateChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: owners.map(o => o.owner),
                datasets: [{
                    label: '通过率 (%)',
                    data: owners.map(o => parseFloat(o.passRate) || 0),
                    backgroundColor: owners.map(o => {
                        const rate = parseFloat(o.passRate) || 0;
                        if (rate >= 80) return 'rgba(82, 196, 26, 0.8)';
                        if (rate >= 60) return 'rgba(250, 140, 22, 0.8)';
                        return 'rgba(255, 77, 79, 0.8)';
                    }),
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: '通过率 (%)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    } catch (error) {
        console.error('初始化负责人通过率图表错误:', error);
    }
}

// 初始化测试进度趋势图表
async function initProgressTrendChart() {
    const ctx = document.getElementById('progress-trend-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    // 销毁之前的图表实例
    if (chartInstances.progressTrendChart) {
        chartInstances.progressTrendChart.destroy();
        chartInstances.progressTrendChart = null;
    }

    try {
        const filters = getCurrentFilters();
        filters.days = currentTrendPeriod || 7;
        const data = await apiRequest(`/dashboard/trend/progress?${new URLSearchParams(filters).toString()}`);

        if (!data.success || !data.trendData) {
            // 如果API不可用，显示无数据提示
            ctx.parentElement.innerHTML = '<div class="no-data-message" style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;">暂无趋势数据</div>';
            return;
        }

        const trendData = data.trendData;
        
        // 如果没有数据集，显示无数据提示
        if (!trendData.datasets || trendData.datasets.length === 0) {
            ctx.parentElement.innerHTML = '<div class="no-data-message" style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;">暂无趋势数据</div>';
            return;
        }

        chartInstances.progressTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: trendData.labels,
                datasets: trendData.datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '用例数量'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    } catch (error) {
        console.error('初始化测试进度趋势图表错误:', error);
        ctx.parentElement.innerHTML = '<div class="no-data-message" style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;">加载失败</div>';
    }
}

// 加载详细数据表格
async function loadDashboardTables() {
    try {
        // 加载项目测试详情表格
        await loadProjectDetailsTable();

        // 加载负责人任务详情表格
        await loadOwnerDetailsTable();

    } catch (error) {
        console.error('加载详细数据表格错误:', error);
    }
}

// 加载项目测试详情表格
async function loadProjectDetailsTable() {
    const tbody = document.getElementById('project-details-body');
    if (!tbody) return;

    try {
        const filters = getCurrentFilters();
        const data = await apiRequest(`/dashboard/project-progress?${new URLSearchParams(filters).toString()}`);
        if (!data.success || !data.projectProgress) {
            tbody.innerHTML = '<tr><td colspan="7" class="no-data">暂无数据</td></tr>';
            return;
        }

        if (data.projectProgress.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="no-data">暂无数据</td></tr>';
            return;
        }

        tbody.innerHTML = data.projectProgress.map(project => `
            <tr>
                <td>${project.projectName}</td>
                <td>${project.totalCases}</td>
                <td style="color: #52c41a;">${project.passedCount}</td>
                <td style="color: #ff4d4f;">${project.failedCount}</td>
                <td style="color: #8c8c8c;">${project.pendingCount}</td>
                <td>${project.passRate}</td>
                <td>
                    ${renderProgressBar(project.progress, 'progress')}
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('加载项目测试详情表格错误:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="no-data">加载失败</td></tr>';
    }
}

// 加载负责人任务详情表格
async function loadOwnerDetailsTable() {
    const tbody = document.getElementById('owner-details-body');
    if (!tbody) return;

    try {
        const data = await apiRequest('/dashboard/owner-analysis');
        if (!data.success || !data.ownerAnalysis) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无数据</td></tr>';
            return;
        }

        if (data.ownerAnalysis.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无数据</td></tr>';
            return;
        }

        tbody.innerHTML = data.ownerAnalysis.map(owner => `
            <tr>
                <td>${owner.owner}</td>
                <td>${owner.totalTasks}</td>
                <td style="color: #52c41a;">${owner.completedCount}</td>
                <td style="color: #1890ff;">${owner.inProgressCount}</td>
                <td style="color: #8c8c8c;">${owner.notStartedCount}</td>
                <td>${owner.passRate}</td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('加载负责人任务详情表格错误:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">加载失败</td></tr>';
    }
}

// 获取进度条样式类
function getProgressClass(progress) {
    const progressValue = parseFloat(progress) || 0;
    if (progressValue >= 80) return 'success';
    if (progressValue >= 50) return 'warning';
    return 'danger';
}

function renderProgressBar(value, type = 'progress') {
    const percent = Math.min(Math.max(parseFloat(value) || 0, 0), 100);
    let colorClass = '';

    if (type === 'progress') {
        colorClass = 'progress-blue';
    } else if (type === 'pass-rate') {
        if (percent >= 90) {
            colorClass = 'progress-green';
        } else if (percent >= 60) {
            colorClass = 'progress-orange';
        } else {
            colorClass = 'progress-red';
        }
    }

    return `
        <div class="progress-container">
            <div class="progress-bar ${colorClass}" style="width: ${percent}%;"></div>
            <span class="progress-text">${percent.toFixed(1)}%</span>
        </div>
    `;
}

// 应用仪表板筛选器
async function applyDashboardFilters() {
    const projectFilter = document.getElementById('project-filter');
    const ownerFilter = document.getElementById('owner-filter');
    const statusFilter = document.getElementById('status-filter');
    const progressFilter = document.getElementById('progress-filter');
    const libraryFilter = document.getElementById('library-filter');

    const filters = {
        projectId: projectFilter ? projectFilter.value : 'all',
        owner: ownerFilter ? ownerFilter.value : 'all',
        statusId: statusFilter ? statusFilter.value : 'all',
        progressId: progressFilter ? progressFilter.value : 'all',
        libraryId: libraryFilter ? libraryFilter.value : 'all'
    };

    console.log('应用筛选器:', filters);

    // 重新加载数据
    await updateStats();
}

// 重置仪表板筛选器
function resetDashboardFilters() {
    const projectFilter = document.getElementById('project-filter');
    const ownerFilter = document.getElementById('owner-filter');
    const statusFilter = document.getElementById('status-filter');
    const progressFilter = document.getElementById('progress-filter');
    const libraryFilter = document.getElementById('library-filter');

    if (projectFilter) projectFilter.value = 'all';
    if (ownerFilter) ownerFilter.value = 'all';
    if (statusFilter) statusFilter.value = 'all';
    if (progressFilter) progressFilter.value = 'all';
    if (libraryFilter) libraryFilter.value = 'all';

    // 重新加载数据
    updateStats();
}

// 导出项目数据
async function exportProjectData() {
    console.log('导出项目数据');
    
    try {
        const filters = getCurrentFilters();
        const data = await apiRequest(`/dashboard/project-progress?${new URLSearchParams(filters).toString()}`);
        
        if (!data.success || !data.projectProgress || data.projectProgress.length === 0) {
            showErrorMessage('没有可导出的数据');
            return;
        }
        
        const headers = ['项目名称', '用例总数', '通过', '失败', '待测试', '通过率', '进度'];
        const rows = data.projectProgress.map(project => [
            project.projectName,
            project.totalCases,
            project.passedCount,
            project.failedCount,
            project.pendingCount,
            project.passRate,
            project.progress
        ]);
        
        exportToExcel('项目测试详情', headers, rows, '项目测试详情');
        showSuccessMessage('导出成功');
    } catch (error) {
        console.error('导出项目数据错误:', error);
        showErrorMessage('导出失败: ' + error.message);
    }
}

// 导出负责人数据
async function exportOwnerData() {
    console.log('导出负责人数据');
    
    try {
        const data = await apiRequest('/dashboard/owner-analysis');
        
        if (!data.success || !data.ownerAnalysis || data.ownerAnalysis.length === 0) {
            showErrorMessage('没有可导出的数据');
            return;
        }
        
        const headers = ['负责人', '任务总数', '已完成', '进行中', '未开始', '通过率'];
        const rows = data.ownerAnalysis.map(owner => [
            owner.owner,
            owner.totalTasks,
            owner.completedCount,
            owner.inProgressCount,
            owner.notStartedCount,
            owner.passRate
        ]);
        
        exportToExcel('负责人任务详情', headers, rows, '负责人任务详情');
        showSuccessMessage('导出成功');
    } catch (error) {
        console.error('导出负责人数据错误:', error);
        showErrorMessage('导出失败: ' + error.message);
    }
}

// 通用导出Excel函数
function exportToExcel(sheetName, headers, rows, filename) {
    const BOM = '\uFEFF';
    let csvContent = BOM + headers.join(',') + '\n';
    
    rows.forEach(row => {
        const escapedRow = row.map(cell => {
            const cellStr = String(cell || '');
            if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                return '"' + cellStr.replace(/"/g, '""') + '"';
            }
            return cellStr;
        });
        csvContent += escapedRow.join(',') + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 初始化图表
function initCharts() {
    // 销毁之前的图表实例
    Object.values(chartInstances).forEach(chart => {
        if (chart) {
            chart.destroy();
        }
    });
    chartInstances = {};

    // 各模块测试通过率图表
    const passRateCtx = document.getElementById('pass-rate-chart');
    if (passRateCtx && typeof Chart !== 'undefined') {
        chartInstances.passRateChart = new Chart(passRateCtx, {
            type: 'bar',
            data: {
                labels: ['模块1', '模块2', '模块3', '模块4', '模块5'],
                datasets: [{
                    label: '测试通过率',
                    data: [85, 78, 92, 65, 88],
                    backgroundColor: 'rgba(24, 144, 255, 0.6)',
                    borderColor: 'rgba(24, 144, 255, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: '通过率 (%)'
                        }
                    }
                }
            }
        });
    }

    // 测试状态分布图表
    const statusDistributionCtx = document.getElementById('status-distribution-chart');
    if (statusDistributionCtx && typeof Chart !== 'undefined') {
        chartInstances.statusDistributionChart = new Chart(statusDistributionCtx, {
            type: 'doughnut',
            data: {
                labels: ['通过', '失败', '待测试', '阻塞'],
                datasets: [{
                    data: [102, 18, 30, 5],
                    backgroundColor: [
                        'rgba(82, 196, 26, 0.6)',
                        'rgba(255, 77, 79, 0.6)',
                        'rgba(102, 102, 102, 0.6)',
                        'rgba(250, 140, 22, 0.6)'
                    ],
                    borderColor: [
                        'rgba(82, 196, 26, 1)',
                        'rgba(255, 77, 79, 1)',
                        'rgba(102, 102, 102, 1)',
                        'rgba(250, 140, 22, 1)'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    // 各芯片测试通过率图表
    const chipPassRateCtx = document.getElementById('chip-pass-rate-chart');
    if (chipPassRateCtx && typeof Chart !== 'undefined') {
        chartInstances.chipPassRateChart = new Chart(chipPassRateCtx, {
            type: 'line',
            data: {
                labels: ['芯片1', '芯片2', '芯片3'],
                datasets: [{
                    label: '测试通过率',
                    data: [88, 75, 90],
                    backgroundColor: 'rgba(82, 196, 26, 0.2)',
                    borderColor: 'rgba(82, 196, 26, 1)',
                    borderWidth: 2,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: '通过率 (%)'
                        }
                    }
                }
            }
        });
    }

    // 芯片测试点数量分布图表
    const chipTestpointCountCtx = document.getElementById('chip-testpoint-count-chart');
    if (chipTestpointCountCtx && typeof Chart !== 'undefined') {
        chartInstances.chipTestpointCountChart = new Chart(chipTestpointCountCtx, {
            type: 'bar',
            data: {
                labels: ['芯片1', '芯片2', '芯片3'],
                datasets: [{
                    label: '测试点数量',
                    data: [45, 38, 37],
                    backgroundColor: 'rgba(250, 140, 22, 0.6)',
                    borderColor: 'rgba(250, 140, 22, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '测试点数量'
                        }
                    }
                }
            }
        });
    }
}

// 显示指定部分
function showSection(sectionId) {
    // 配置中心页面需要管理员权限
    if (sectionId === 'settings') {
        if (!isAdmin()) {
            showErrorMessage('只有管理员才能访问配置中心');
            // 不允许访问，返回
            return;
        }
    }

    // 隐藏所有部分
    document.querySelectorAll('section').forEach(section => {
        section.style.display = 'none';
    });

    // 显示指定部分
    const targetSection = document.getElementById(`${sectionId}-section`);
    if (targetSection) {
        targetSection.style.display = 'block';
    }

    // 更新导航链接状态
    document.querySelectorAll('.nav-item, .sidebar-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${sectionId}`) {
            link.classList.add('active');
        }
    });

    // 当显示用例库页面时，加载所有一级测试用例
    if (sectionId === 'cases') {
        // 初始化模块数据
        initModuleData().then(() => {
            // 加载当前用例库下的所有一级测试用例
            loadAllLevel1Points();
        });
    }
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', async function () {
    ThemeSystem.init();

    CommandPalette.init();

    initWebSocket();

    initSearchEvents();

    initCaseListResizer();

    initFloatingPanelResizer();

    const savedToken = localStorage.getItem('authToken');
    const savedUser = localStorage.getItem('currentUser');

    if (savedToken && savedUser) {
        try {
            authToken = savedToken;
            currentUser = JSON.parse(savedUser);
            console.log('[页面加载] 已从localStorage恢复登录状态:', currentUser.username);

            const userInfoElement = document.getElementById('user-info');
            if (userInfoElement) {
                userInfoElement.innerHTML = '';
                // 创建用户文本（只显示用户名，不显示角色）
                const userText = document.createTextNode(`${currentUser.username} `);
                userInfoElement.appendChild(userText);
                const logoutBtn = document.createElement('button');
                logoutBtn.id = 'logout-btn';
                logoutBtn.className = 'secondary-btn';
                logoutBtn.textContent = '登出';
                logoutBtn.style.display = 'inline-block';
                userInfoElement.appendChild(logoutBtn);
            }

            const loginSection = document.getElementById('login-section');
            if (loginSection) {
                loginSection.style.display = 'none';
            }

            const registerSection = document.getElementById('register-section');
            if (registerSection) {
                registerSection.style.display = 'none';
            }

            const testlinkContainer = document.querySelector('.testlink-container');
            if (testlinkContainer) {
                testlinkContainer.style.display = 'flex';
            }

            // 只有已登录用户才加载业务数据
            await loadData();
            await loadProjects();
            await loadCaseLibraries();
        } catch (e) {
            console.error('[页面加载] 恢复登录状态失败:', e);
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
        }
    }

    const rememberedUsername = localStorage.getItem('rememberedUsername');

    if (rememberedUsername) {
        const usernameInput = document.getElementById('username');
        if (usernameInput) {
            usernameInput.value = rememberedUsername;
            console.log('[登录] 已自动填充记住的用户名:', rememberedUsername);
        }
    }

    // 初始化 Hash 路由系统
    Router.init();

    // 绑定主题切换按钮事件
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => ThemeSystem.toggle());
    }

    // 绑定命令面板按钮事件
    const commandPaletteBtn = document.getElementById('command-palette-btn');
    if (commandPaletteBtn) {
        commandPaletteBtn.addEventListener('click', () => CommandPalette.open());
    }

    // 根据当前用户角色控制配置中心导航链接的显示
    console.log('页面加载时，currentUser:', currentUser);

    const settingsLink = document.querySelector('.nav-left a[href="#/settings"]');
    console.log('页面加载时找到的配置中心链接:', settingsLink);

    if (settingsLink) {
        // 所有登录用户都可以看到配置中心链接
        if (currentUser) {
            settingsLink.style.display = 'block';
            console.log('用户已登录，显示配置中心链接');
        } else {
            settingsLink.style.display = 'none';
            console.log('用户未登录，隐藏配置中心链接');
        }
    }

    // 初始化配置中心（仅已登录用户）
    if (currentUser) {
        initConfigCenter();
    }

    // 初始化模块数据（仅已登录用户）
    if (currentUser) {
        initModuleData();
    }

    // 顶部导航栏搜索功能
    const topSearchInput = document.querySelector('.nav-right .search-input');
    if (topSearchInput) {
        topSearchInput.addEventListener('input', debounce(function () {
            const searchTerm = this.value.trim();
            if (searchTerm) {
                // 这里可以实现全局搜索功能
                console.log('全局搜索:', searchTerm);
                // 可以根据当前页面进行相应的搜索
                const currentSection = document.querySelector('section[style*="display: block"]');
                if (currentSection) {
                    if (currentSection.id === 'testplans-section') {
                        filterTestPlansWithSearch(searchTerm);
                    } else if (currentSection.id === 'reports-section') {
                        filterTestReports(searchTerm);
                    } else if (currentSection.id === 'cases-section') {
                        filterTestCases(searchTerm);
                    }
                }
            }
        }, 300));
    }

    // 登录表单提交
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            e.preventDefault();
            console.log('Login form submitted');
            login();
        });
    }

    // 注册表单提交
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', function (e) {
            e.preventDefault();
            console.log('Register form submitted');
            register();
        });
    }

    // 导航链接点击 - 使用路由系统
    document.addEventListener('click', function (e) {
        if (e.target.classList.contains('nav-item') || e.target.classList.contains('sidebar-link')) {
            e.preventDefault();
            const href = e.target.getAttribute('href');
            // 从 href="#/dashboard" 格式中提取路由名称
            const routeName = href.replace(/^#\/?/, '');
            console.log('[Navigation] 点击导航链接:', routeName);

            // 使用路由系统导航
            Router.navigateTo(routeName);
        }
    });

    // 用例管理页面按钮点击事件
    document.addEventListener('click', function (e) {
        // 导入用例按钮
        if (e.target.textContent === '导入用例' && e.target.classList.contains('secondary-btn')) {
            importTestCases();
        }
        // 导出用例按钮
        if (e.target.textContent === '导出用例' && e.target.classList.contains('secondary-btn')) {
            exportTestCases();
        }
        // 新建用例按钮
        if (e.target.textContent.trim() === '新建用例' && e.target.classList.contains('primary-btn')) {
            addTestCase();
        }
    });

    // 用户信息点击事件（未登录时显示登录页面）
    document.addEventListener('click', function (e) {
        if (e.target.closest('#user-info') && !currentUser) {
            // 显示登录页面
            showSection('login');
        }
    });

    // 登出按钮点击事件
    document.addEventListener('click', function (e) {
        if (e.target.id === 'logout-btn') {
            logout();
        }
    });

    // 测试计划标签点击
    document.addEventListener('click', function (e) {
        if (e.target.classList.contains('testplan-tab')) {
            const parentSection = e.target.closest('section');

            // 移除所有标签的active类
            document.querySelectorAll('.testplan-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            e.target.classList.add('active');

            const status = e.target.dataset.status;

            // 根据所在的section执行不同的筛选
            if (parentSection.id === 'testplans-section') {
                filterTestPlans(status);
            }
        }
    });

    // 新增测试计划按钮
    document.addEventListener('click', function (e) {
        if (e.target.id === 'add-testplan-button') {
            addTestPlan();
        }
    });

    // 新增测试报告按钮
    document.addEventListener('click', function (e) {
        if (e.target.id === 'add-report-button') {
            addTestReport();
        }
    });

    // 用例库按钮点击
    document.addEventListener('click', function (e) {
        if (e.target.id === 'add-case-button') {
            e.stopPropagation();
            console.log('点击了添加用例按钮');
            addTestCase();
        }
    });

    // 新建用例库按钮点击
    document.addEventListener('click', function (e) {
        if (e.target.id === 'add-case-library-btn') {
            e.stopPropagation();
            console.log('点击了添加用例库按钮');
            addCaseLibrary();
        }
    });

    // 测试计划模态框关闭按钮
    document.addEventListener('click', function (e) {
        if (e.target.id === 'close-testplan-modal' || e.target.id === 'cancel-testplan-btn') {
            closeTestPlanModal();
        }
    });

    // 测试计划模态框提交按钮
    document.addEventListener('click', function (e) {
        if (e.target.id === 'submit-testplan-btn') {
            submitTestPlanForm();
        }
    });

    // 测试报告模态框关闭按钮
    document.addEventListener('click', function (e) {
        if (e.target.id === 'close-testreport-modal' || e.target.id === 'cancel-testreport-btn') {
            closeTestReportModal();
        }
    });

    // 测试报告模态框提交按钮
    document.addEventListener('click', function (e) {
        if (e.target.id === 'submit-testreport-btn') {
            submitTestReportForm();
        }
    });

    // 新建用例库模态框关闭按钮
    document.addEventListener('click', function (e) {
        if (e.target.id === 'close-case-library-modal' || e.target.id === 'cancel-case-library-btn') {
            closeCaseLibraryModal();
        }
    });

    // 新建用例库模态框提交按钮
    document.addEventListener('click', function (e) {
        if (e.target.id === 'submit-case-library-btn') {
            submitCaseLibraryForm();
        }
    });

    // 用例库名称输入框字符计数器
    document.addEventListener('input', function (e) {
        if (e.target.id === 'case-library-name') {
            const input = e.target;
            const counter = document.getElementById('case-library-name-counter');
            const length = input.value.length;
            const maxLength = input.maxLength > 0 ? input.maxLength : 64; // 默认最大长度为64
            counter.textContent = `${length}/${maxLength}`;
        }
    });

    // 用例库名称点击事件（处理从用例库列表页面的点击）
    document.addEventListener('click', function (e) {
        const row = e.target.closest('.case-library-table tbody tr[data-library-id]');
        if (row) {
            const libraryId = row.getAttribute('data-library-id');
            const library = caseLibraries.find(lib => lib.id == libraryId);

            if (library) {
                let caseLibraryName = library.name;
                console.log('点击用例库:', caseLibraryName);

                currentCaseLibraryId = library.id;
                console.log('设置当前用例库ID:', currentCaseLibraryId);

                showSection('case-management');

                const currentCaseLibraryElement = document.getElementById('current-case-library');
                if (currentCaseLibraryElement) {
                    currentCaseLibraryElement.textContent = caseLibraryName;
                }

                // 清空一级测试点显示
                clearLevel1PointsDisplay();
                currentModulePage = 1;
                initModuleData();
            }
        }
    });

    // 用例库名称点击事件（处理用例管理详情页面中的点击 - 下拉菜单触发）
    document.addEventListener('click', function (e) {
        if (e.target.id === 'current-case-library' || e.target.closest('.case-library-breadcrumb')) {
            e.preventDefault();
            e.stopPropagation();
            console.log('点击当前用例库名称，触发下拉菜单');
            toggleCaseLibraryDropdown();
        }
    });

    // 点击模态框外部关闭
    window.addEventListener('click', function (e) {
        const testPlanModal = document.getElementById('add-testplan-modal');
        if (e.target === testPlanModal) {
            closeTestPlanModal();
        }

        const testReportModal = document.getElementById('add-testreport-modal');
        if (e.target === testReportModal) {
            closeTestReportModal();
        }

        const caseLibraryModal = document.getElementById('add-case-library-modal');
        if (e.target === caseLibraryModal) {
            closeCaseLibraryModal();
        }
    });

    // 登录/注册链接点击
    document.addEventListener('click', function (e) {
        if (e.target.getAttribute('href') === '#register') {
            e.preventDefault();
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('register-section').style.display = 'flex';
        } else if (e.target.getAttribute('href') === '#login') {
            e.preventDefault();
            document.getElementById('register-section').style.display = 'none';
            document.getElementById('login-section').style.display = 'flex';
        }
    });

    // 点击页面其他地方关闭用例库下拉菜单
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.case-library-breadcrumb') && !e.target.closest('.case-library-dropdown')) {
            closeCaseLibraryDropdown();
        }
    });
});

// 测试管理页面可视化功能

// 初始化测试管理页面数据
function initDashboardData() {
    console.log('初始化测试管理页面数据');

    // 加载筛选器数据
    loadFilterData();

    // 加载统计数据
    loadDashboardStats();

    // 渲染图表
    renderAllCharts();
}

// 加载筛选器数据
async function loadFilterData() {
    try {
        // 加载用例库数据
        const libraryData = await apiRequest('/libraries/list');
        if (libraryData.success) {
            populateSelectOptions('library-filter', libraryData.libraries, 'name', 'id');
        }

        // 加载项目数据
        const projectData = await apiRequest('/projects/list');
        if (projectData.success) {
            populateSelectOptions('project-filter', projectData.projects, 'name', 'id');
        }

        // 加载测试用例数据以获取负责人列表
        const casesData = await apiRequest('/cases/list', {
            method: 'POST',
            body: JSON.stringify({ page: 1, pageSize: 100 })
        });
        if (casesData.success) {
            const owners = [...new Set(casesData.testCases.map(c => c.owner))];
            populateSelectOptions('owner-filter', owners.map(owner => ({ name: owner, id: owner })), 'name', 'id');
        }

        // 添加筛选器变化事件
        addFilterChangeEvents();
    } catch (error) {
        console.error('加载筛选器数据失败:', error);
    }
}

// 填充下拉选择框选项
function populateSelectOptions(selectId, data, labelKey, valueKey) {
    const select = document.getElementById(selectId);
    if (!select) return;

    // 保留第一个选项（所有...）
    const firstOption = select.firstElementChild;
    select.innerHTML = '';
    select.appendChild(firstOption);

    // 添加数据选项
    data.forEach(item => {
        const option = document.createElement('option');
        option.value = item[valueKey];
        option.textContent = item[labelKey];
        select.appendChild(option);
    });
}

// 添加筛选器变化事件
function addFilterChangeEvents() {
    const libraryFilter = document.getElementById('library-filter');
    const projectFilter = document.getElementById('project-filter');
    const ownerFilter = document.getElementById('owner-filter');

    [libraryFilter, projectFilter, ownerFilter].forEach(filter => {
        if (filter) {
            filter.addEventListener('change', () => {
                console.log('筛选器变化，重新加载数据');
                loadDashboardStats();
                renderAllCharts();
            });
        }
    });
}

// 加载仪表盘统计数据
async function loadDashboardStats() {
    try {
        const testcaseCountEl = document.getElementById('testcase-count');
        const testplanCountEl = document.getElementById('testplan-count');
        const testreportCountEl = document.getElementById('testreport-count');
        
        if (!testcaseCountEl && !testplanCountEl && !testreportCountEl) {
            console.log('[loadDashboardStats] 当前页面不包含统计元素，跳过加载');
            return;
        }

        const filters = getCurrentFilters();

        if (testcaseCountEl) {
            const casesData = await apiRequest('/cases/list', {
                method: 'POST',
                body: JSON.stringify({ ...filters, page: 1, pageSize: 100 })
            });
            if (casesData.success) {
                testcaseCountEl.textContent = casesData.testCases?.length || 0;
            }
        }

        if (testplanCountEl) {
            const plansData = await apiRequest('/testplans/list');
            if (plansData.success) {
                testplanCountEl.textContent = plansData.testPlans?.length || 0;
            }
        }

        if (testreportCountEl) {
            const reportsData = await apiRequest('/reports/list');
            if (reportsData.success) {
                testreportCountEl.textContent = reportsData.reports?.length || 0;
            }
        }

    } catch (error) {
        console.error('加载仪表盘统计数据失败:', error);
    }
}

// 获取当前筛选条件
function getCurrentFilters() {
    return {
        libraryId: document.getElementById('library-filter')?.value || 'all',
        projectId: document.getElementById('project-filter')?.value || 'all',
        owner: document.getElementById('owner-filter')?.value || 'all'
    };
}

// 渲染所有图表
function renderAllCharts() {
    // 销毁之前的图表实例
    Object.values(chartInstances).forEach(chart => {
        if (chart) {
            chart.destroy();
        }
    });

    renderStatusDistributionChart();
    renderPhaseDistributionChart();
    renderPriorityDistributionChart();
    renderTypeDistributionChart();
    renderProjectDistributionChart();
    renderOwnerDistributionChart();
    renderLibraryDistributionChart();
    renderProgressTrendChart();
}

// 渲染测试状态分布图表
function renderStatusDistributionChart() {
    const ctx = document.getElementById('status-distribution-chart');
    if (!ctx) return;

    // 使用模拟数据
    const statusData = {
        labels: ['通过', '失败', '未测试', '阻塞'],
        datasets: [{
            data: [65, 15, 15, 5],
            backgroundColor: ['#4CAF50', '#F44336', '#FFC107', '#9C27B0'],
            borderWidth: 0
        }]
    };

    chartInstances.statusDistributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: statusData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// 渲染测试阶段分布图表
function renderPhaseDistributionChart() {
    const ctx = document.getElementById('phase-distribution-chart');
    if (!ctx) return;

    // 使用模拟数据
    const phaseData = {
        labels: ['规划阶段', '设计阶段', '执行阶段', '总结阶段'],
        datasets: [{
            data: [20, 30, 40, 10],
            backgroundColor: ['#2196F3', '#00BCD4', '#FF9800', '#795548'],
            borderWidth: 0
        }]
    };

    chartInstances.phaseDistributionChart = new Chart(ctx, {
        type: 'doughnut',
        data: phaseData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// 渲染测试用例优先级分布图表
function renderPriorityDistributionChart() {
    const ctx = document.getElementById('priority-distribution-chart');
    if (!ctx) return;

    // 使用模拟数据
    const priorityData = {
        labels: ['高', '中', '低'],
        datasets: [{
            data: [30, 50, 20],
            backgroundColor: ['#F44336', '#FFC107', '#4CAF50'],
            borderWidth: 0
        }]
    };

    chartInstances.priorityDistributionChart = new Chart(ctx, {
        type: 'pie',
        data: priorityData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// 渲染测试用例类型分布图表
function renderTypeDistributionChart() {
    const ctx = document.getElementById('type-distribution-chart');
    if (!ctx) return;

    // 使用模拟数据
    const typeData = {
        labels: ['功能测试', '性能测试', '安全测试', '兼容性测试'],
        datasets: [{
            data: [50, 20, 15, 15],
            backgroundColor: ['#4CAF50', '#2196F3', '#F44336', '#9C27B0'],
            borderWidth: 0
        }]
    };

    chartInstances.typeDistributionChart = new Chart(ctx, {
        type: 'pie',
        data: typeData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// 渲染按项目分布测试用例图表
function renderProjectDistributionChart() {
    const ctx = document.getElementById('project-distribution-chart');
    if (!ctx) return;

    // 使用模拟数据
    const projectData = {
        labels: ['项目A', '项目B', '项目C', '项目D', '项目E'],
        datasets: [{
            label: '测试用例数量',
            data: [120, 80, 60, 40, 20],
            backgroundColor: '#2196F3',
            borderWidth: 1
        }]
    };

    chartInstances.projectDistributionChart = new Chart(ctx, {
        type: 'bar',
        data: projectData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 渲染按负责人分布测试用例图表
function renderOwnerDistributionChart() {
    const ctx = document.getElementById('owner-distribution-chart');
    if (!ctx) return;

    // 使用模拟数据
    const ownerData = {
        labels: ['张三', '李四', '王五', '赵六'],
        datasets: [{
            label: '测试用例数量',
            data: [90, 75, 65, 50],
            backgroundColor: '#4CAF50',
            borderWidth: 1
        }]
    };

    chartInstances.ownerDistributionChart = new Chart(ctx, {
        type: 'bar',
        data: ownerData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 渲染按用例库分布测试用例图表
function renderLibraryDistributionChart() {
    const ctx = document.getElementById('library-distribution-chart');
    if (!ctx) return;

    // 使用模拟数据
    const libraryData = {
        labels: ['用例库1', '用例库2', '用例库3'],
        datasets: [{
            label: '测试用例数量',
            data: [150, 120, 80],
            backgroundColor: '#FF9800',
            borderWidth: 1
        }]
    };

    chartInstances.libraryDistributionChart = new Chart(ctx, {
        type: 'bar',
        data: libraryData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 渲染测试进度趋势图表
function renderProgressTrendChart() {
    const ctx = document.getElementById('progress-trend-chart');
    if (!ctx) return;

    // 使用模拟数据
    const progressData = {
        labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
        datasets: [{
            label: '完成用例数',
            data: [50, 80, 120, 150, 180, 200],
            borderColor: '#2196F3',
            backgroundColor: 'rgba(33, 150, 243, 0.1)',
            tension: 0.4,
            fill: true
        }]
    };

    chartInstances.progressTrendChart = new Chart(ctx, {
        type: 'line',
        data: progressData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 页面加载完成后初始化测试管理页面数据
document.addEventListener('DOMContentLoaded', function () {
    // 初始化测试计划表格的事件委托
    initTestPlanTableEvents();

    // 监听测试管理页面显示事件
    document.addEventListener('click', function (e) {
        if (e.target.closest('a[href="#/dashboard"]')) {
            setTimeout(initDashboardData, 100);
        }
    });

    // 初始加载
    if (window.location.hash === '#dashboard' || !window.location.hash) {
        setTimeout(initDashboardData, 500);
    }
});

// 初始化页面（使用默认数据）
function initPageWithDefaultData() {
    // 使用默认数据
    const mockUsers = [
        { username: 'admin', password: 'ctc@2026.', role: '管理员', email: 'zhaosz@centec.com' }
    ];

    const historyRecords = [
        { time: '2026-01-13 10:00:00', user: 'admin', action: '添加', content: '添加了模块1', version: 'v1.0' },
        { time: '2026-01-13 10:30:00', user: 'tester1', action: '修改', content: '修改了测试点1', version: 'v1.1' }
    ];

    const modules = [
        { id: 'module1', name: '模块1' },
        { id: 'module2', name: '模块2' },
        { id: 'module3', name: '模块3' }
    ];

    const chips = [
        { id: 1, chip_id: 'chip1', name: '芯片1', description: '默认测试芯片1' },
        { id: 2, chip_id: 'chip2', name: '芯片2', description: '默认测试芯片2' },
        { id: 3, chip_id: 'chip3', name: '芯片3', description: '默认测试芯片3' }
    ];

    // 显示登录页面
    document.getElementById('login-section').style.display = 'flex';

    // 初始化历史记录表格
    updateHistoryTable();

    // 初始化用户表格
    updateUsersTable();

    // 初始化模块
    initModules();

    // 初始化统计数据
    updateStats();

    // 初始化用例库列表
    loadCaseLibraries();
}

// 初始化测试计划页面的筛选功能
function initTestPlanFilters() {
    // 加载筛选数据
    loadTestPlanFilters();
    
    // 搜索功能
    const searchInput = document.querySelector('#testplans-section .filter-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function () {
            applyTestPlanFilters();
        }, 300));
    }

    // 排序功能
    const sortSelect = document.getElementById('testplan-sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', function () {
            applyTestPlanFilters();
        });
    }

    // 状态筛选功能
    const statusSelect = document.getElementById('testplan-status-filter');
    if (statusSelect) {
        statusSelect.addEventListener('change', function () {
            applyTestPlanFilters();
        });
    }
    
    // 项目筛选功能
    const projectSelect = document.getElementById('testplan-project-filter');
    if (projectSelect) {
        projectSelect.addEventListener('change', function () {
            applyTestPlanFilters();
        });
    }
    
    // 迭代筛选功能
    const iterationSelect = document.getElementById('testplan-iteration-filter');
    if (iterationSelect) {
        iterationSelect.addEventListener('change', function () {
            applyTestPlanFilters();
        });
    }
    
    // 负责人筛选功能
    const ownerSelect = document.getElementById('testplan-owner-filter');
    if (ownerSelect) {
        ownerSelect.addEventListener('change', function () {
            applyTestPlanFilters();
        });
    }
}

// 初始化测试报告页面的筛选功能
function initReportFilters() {
    // 搜索功能
    const searchInput = document.querySelector('#reports-section .filter-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function () {
            const searchTerm = this.value.trim();
            filterTestReports(searchTerm);
        }, 300));
    }

    // 排序功能
    const sortSelect = document.querySelector('#reports-section .filter-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', function () {
            const sortBy = this.value;
            sortTestReports(sortBy);
        });
    }
}

// 初始化用例页面的筛选功能
function initCaseFilters() {
    // 搜索功能 - 只匹配测试用例搜索框，不匹配用例库搜索框
    const searchInput = document.querySelector('#cases-section .test-case-search .filter-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function () {
            const searchTerm = this.value.trim();
            filterTestCases(searchTerm);
        }, 300));
    }

    // 为用例库搜索框添加阻止默认行为的处理，防止页面跳转
    const caseLibrarySearchInput = document.querySelector('#cases-section .case-library-search .filter-search');
    if (caseLibrarySearchInput) {
        // 阻止表单提交行为
        caseLibrarySearchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                // 这里可以添加用例库搜索的逻辑
                console.log('用例库搜索:', this.value);
            }
        });

        // 阻止点击事件的默认行为
        caseLibrarySearchInput.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }
}

// 带搜索的测试计划筛选
function filterTestPlansWithSearch(searchTerm) {
    let filteredPlans = testPlans;

    if (searchTerm) {
        filteredPlans = testPlans.filter(plan =>
            plan.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            plan.owner.toLowerCase().includes(searchTerm.toLowerCase()) ||
            plan.project.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }

    renderTestPlansTable(filteredPlans);
}

// 测试计划排序
function sortTestPlans(sortBy) {
    let sortedPlans = [...testPlans];

    switch (sortBy) {
        case '创建时间':
            sortedPlans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
        case '名称':
            sortedPlans.sort((a, b) => a.name.localeCompare(b.name));
            break;
        default:
            break;
    }

    renderTestPlansTable(sortedPlans);
}

// 测试计划状态筛选
function filterTestPlansByStatus(status) {
    let filteredPlans = testPlans;

    if (status !== '全部') {
        // 映射状态值
        const statusMap = {
            '未开始': 'not_started',
            '进行中': 'in_progress',
            '已完成': 'completed',
            '阻塞': 'blocked'
        };

        const actualStatus = statusMap[status] || status;
        filteredPlans = testPlans.filter(plan => plan.status === actualStatus);
    }

    renderTestPlansTable(filteredPlans);
}

// 测试报告搜索
function filterTestReports(searchTerm) {
    let filteredReports = testReports;

    if (searchTerm) {
        filteredReports = testReports.filter(report =>
            report.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            report.creator.toLowerCase().includes(searchTerm.toLowerCase()) ||
            report.project.toLowerCase().includes(searchTerm.toLowerCase()) ||
            report.testPlan.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }

    renderTestReportsTable(filteredReports);
}

// 测试报告排序
function sortTestReports(sortBy) {
    let sortedReports = [...testReports];

    switch (sortBy) {
        case '创建时间':
            sortedReports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            break;
        case '名称':
            sortedReports.sort((a, b) => a.name.localeCompare(b.name));
            break;
        default:
            break;
    }

    renderTestReportsTable(sortedReports);
}

// 测试用例搜索
function filterTestCases(searchTerm) {
    let filteredCases = testCases;

    if (searchTerm) {
        filteredCases = testCases.filter(testCase =>
            testCase.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            testCase.caseId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            testCase.testSuite.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }

    renderCasesTable(filteredCases);
}

// 切换用例库下拉菜单
function toggleCaseLibraryDropdown() {
    const dropdown = document.querySelector('.case-library-dropdown');
    if (dropdown && dropdown.style.display === 'block') {
        // 如果下拉菜单已显示，则关闭
        dropdown.style.display = 'none';
    } else {
        // 如果下拉菜单不存在或已隐藏，重新创建（确保选中状态正确）
        createCaseLibraryDropdown();
    }
}

// 关闭用例库下拉菜单
function closeCaseLibraryDropdown() {
    const dropdown = document.querySelector('.case-library-dropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

// 更新用例库下拉菜单中的数量显示
function updateCaseLibraryDropdownCount() {
    const viewAllLi = document.querySelector('.case-library-dropdown .view-all');
    if (viewAllLi) {
        viewAllLi.textContent = `查看所有用例库(${caseLibraries ? caseLibraries.length : 0})`;
    }
}

// 创建用例库下拉菜单
function createCaseLibraryDropdown() {
    const caseLibraryBreadcrumb = document.querySelector('.case-library-breadcrumb');
    if (!caseLibraryBreadcrumb) return;

    const existingDropdown = document.querySelector('.case-library-dropdown');
    if (existingDropdown) {
        existingDropdown.remove();
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'case-library-dropdown';
    dropdown.style.display = 'block';

    const searchBox = document.createElement('div');
    searchBox.className = 'search-box';
    searchBox.innerHTML = `
        <input type="text" placeholder="搜索用例库..." class="search-input" id="library-search-input">
    `;

    const newLibraryBtn = document.createElement('button');
    newLibraryBtn.className = 'new-library-btn';
    newLibraryBtn.textContent = '新建用例库';
    newLibraryBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeCaseLibraryDropdown();
        addCaseLibrary();
    });

    const ul = document.createElement('ul');
    ul.className = 'library-list';
    ul.id = 'library-list-container';

    function renderLibraryList(filterText = '') {
        ul.innerHTML = '';

        const filteredLibraries = caseLibraries && caseLibraries.length > 0
            ? caseLibraries.filter(library =>
                library.name.toLowerCase().includes(filterText.toLowerCase())
            )
            : [];

        if (filteredLibraries.length > 0) {
            filteredLibraries.forEach(library => {
                const li = document.createElement('li');

                const currentLibraryName = document.getElementById('current-case-library');
                const isActive = currentLibraryName && currentLibraryName.textContent === library.name;
                if (isActive) {
                    li.className = 'active';
                }

                li.textContent = library.name;
                li.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (library.id) {
                        currentCaseLibraryId = library.id;
                    }
                    document.getElementById('current-case-library').textContent = library.name;
                    closeCaseLibraryDropdown();
                    // 先清空一级测试点显示
                    clearLevel1PointsDisplay();
                    currentModulePage = 1;
                    // 加载新用例库的模块列表
                    initModuleData();
                });
                ul.appendChild(li);
            });
        } else if (filterText) {
            const li = document.createElement('li');
            li.className = 'no-result';
            li.textContent = `未找到 "${filterText}" 相关用例库`;
            ul.appendChild(li);
        } else {
            const li = document.createElement('li');
            li.className = 'no-result';
            li.textContent = '暂无用例库，请先新建';
            ul.appendChild(li);
        }
    }

    renderLibraryList();

    const viewAllLi = document.createElement('div');
    viewAllLi.className = 'view-all';
    viewAllLi.textContent = `查看所有用例库 (${caseLibraries ? caseLibraries.length : 0})`;
    viewAllLi.addEventListener('click', function (e) {
        e.stopPropagation();
        loadCaseLibraries();
        showSection('cases');
        closeCaseLibraryDropdown();
    });

    dropdown.appendChild(searchBox);
    dropdown.appendChild(newLibraryBtn);
    dropdown.appendChild(ul);
    dropdown.appendChild(viewAllLi);

    caseLibraryBreadcrumb.appendChild(dropdown);

    const searchInput = document.getElementById('library-search-input');
    if (searchInput) {
        searchInput.focus();
        searchInput.addEventListener('input', function (e) {
            renderLibraryList(e.target.value);
        });
        searchInput.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeCaseLibraryDropdown();
            }
        });
    }
}



// 关闭添加环境模态框
function closeEnvironmentModal() {
    const modal = document.getElementById('add-environment-modal');
    modal.style.display = 'none';
    document.getElementById('add-environment-form').reset();
}

// 提交添加环境表单
async function submitEnvironmentForm() {
    try {
        // 初始化编辑状态变量，确保它总是有值
        if (typeof window.currentEditingEnvironment === 'undefined') {
            window.currentEditingEnvironment = null;
        }

        const environmentName = document.getElementById('environment-name').value.trim();
        const environmentDescription = document.getElementById('environment-description').value.trim();

        if (!environmentName) {
            showErrorMessage('测试环境名称不能为空');
            return;
        }

        showLoading('处理环境中...');

        const isEditing = window.currentEditingEnvironment && typeof window.currentEditingEnvironment === 'object';
        const endpoint = isEditing ? '/environments/update' : '/environments/create';
        const requestData = {
            name: environmentName,
            description: environmentDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingEnvironment.id || window.currentEditingEnvironment.env_id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closeEnvironmentModal();
            showSuccessMessage(isEditing ? '环境编辑成功' : '环境添加成功');
            await loadEnvironments(); // 刷新环境列表
        } else {
            showErrorMessage((isEditing ? '环境编辑' : '环境添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理环境错误:', error);
        showErrorMessage('环境处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 测试点来源管理相关函数

// 加载测试点来源列表
async function loadTestSources() {
    try {
        showLoading('加载测试点来源列表中...');

        const response = await apiRequest('/test-sources/list', { useCache: false });

        if (response.success) {
            const sources = response.sources || [];
            const tbody = document.getElementById('test-source-config-body');

            if (sources.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="no-data">暂无测试点来源数据</td></tr>';
            } else {
                tbody.innerHTML = sources.map(source => `
                    <tr>
                        <td>${source.name}</td>
                        <td>${source.description || '-'}</td>
                        <td>${source.creator}</td>
                        <td>${formatDateTime(source.created_at)}</td>
                        <td>
                            <button class="config-action-btn edit" onclick="editTestSource(${source.id})">编辑</button>
                            <button class="config-action-btn delete" onclick="deleteTestSource(${source.id})">删除</button>
                        </td>
                    </tr>
                `).join('');
            }
        } else {
            showErrorMessage('加载测试点来源列表失败: ' + response.message);
        }
    } catch (error) {
        console.error('加载测试点来源列表错误:', error);
        showErrorMessage('加载测试点来源列表失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 打开添加测试点来源模态框
function openAddTestSourceModal() {
    window.currentEditingTestSource = null;
    document.getElementById('add-test-source-modal').style.display = 'block';
    document.getElementById('add-test-source-form').reset();
}

// 关闭测试点来源模态框
function closeTestSourceModal() {
    document.getElementById('add-test-source-modal').style.display = 'none';
    window.currentEditingTestSource = null;
    document.getElementById('add-test-source-form').reset();
}

// 编辑测试点来源
async function editTestSource(sourceId) {
    try {
        showLoading('加载测试点来源信息...');

        const response = await apiRequest(`/test-sources/get?id=${sourceId}`);

        if (response.success && response.source) {
            window.currentEditingTestSource = response.source;
            document.getElementById('test-source-name').value = response.source.name || '';
            document.getElementById('test-source-description').value = response.source.description || '';
            document.getElementById('add-test-source-modal').style.display = 'block';
        } else {
            showErrorMessage('加载测试点来源信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('加载测试点来源信息错误:', error);
        showErrorMessage('加载测试点来源信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除测试点来源
async function deleteTestSource(sourceId) {
    if (!(await showConfirmMessage('确定要删除这个测试点来源吗？'))) {
        return;
    }

    try {
        showLoading('删除测试点来源中...');

        const response = await apiRequest(`/test-sources/delete?id=${sourceId}`, {
            method: 'DELETE'
        });

        if (response.success) {
            showSuccessMessage('测试点来源删除成功');
            await loadTestSources();
        } else {
            showErrorMessage('删除测试点来源失败: ' + response.message);
        }
    } catch (error) {
        console.error('删除测试点来源错误:', error);
        showErrorMessage('删除测试点来源失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 提交添加测试点来源表单
async function submitTestSourceForm() {
    try {
        if (typeof window.currentEditingTestSource === 'undefined') {
            window.currentEditingTestSource = null;
        }

        const sourceName = document.getElementById('test-source-name').value.trim();
        const sourceDescription = document.getElementById('test-source-description').value.trim();

        if (!sourceName) {
            showErrorMessage('测试点来源名称不能为空');
            return;
        }

        showLoading('处理测试点来源中...');

        const isEditing = window.currentEditingTestSource && typeof window.currentEditingTestSource === 'object';
        const endpoint = isEditing ? '/test-sources/update' : '/test-sources/create';
        const requestData = {
            name: sourceName,
            description: sourceDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingTestSource.id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closeTestSourceModal();
            showSuccessMessage(isEditing ? '测试点来源编辑成功' : '测试点来源添加成功');
            await loadTestSources();
        } else {
            showErrorMessage((isEditing ? '测试点来源编辑' : '测试点来源添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理测试点来源错误:', error);
        showErrorMessage('测试点来源处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 测试方式管理相关函数

// 加载测试方式列表
async function loadTestMethods() {
    try {
        showLoading('加载测试方式列表中...');

        const response = await apiRequest('/test-methods/list', { useCache: false });

        if (response.success) {
            const testMethodBody = document.getElementById('test-method-config-body');
            if (testMethodBody) {
                if (response.testMethods.length > 0) {
                    testMethodBody.innerHTML = response.testMethods.map(method => `
                        <tr>
                            <td>${method.name}</td>
                            <td>${method.description || '-'}</td>
                            <td>${method.creator || 'admin'}</td>
                            <td>${method.created_at || method.createdAt || '-'}</td>
                            <td>
                                <button class="config-action-btn edit" onclick="editTestMethod(${method.id || method.method_id})">编辑</button>
                                <button class="config-action-btn delete" onclick="deleteTestMethod(${method.id || method.method_id})">删除</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    testMethodBody.innerHTML = `
                        <tr>
                            <td colspan="5" class="no-data">暂无测试方式数据</td>
                        </tr>
                    `;
                }
            }
        } else {
            console.error('加载测试方式列表失败:', response.message);
        }
    } catch (error) {
        console.error('加载测试方式列表错误:', error);
    } finally {
        hideLoading();
    }
}

// 关闭测试方式模态框
function closeTestMethodModal() {
    const modal = document.getElementById('add-test-method-modal');
    modal.style.display = 'none';
    document.getElementById('add-test-method-form').reset();
    window.currentEditingTestMethod = null;
}

// 编辑测试方式
async function editTestMethod(methodId) {
    try {
        showLoading('加载测试方式信息中...');

        const response = await apiRequest(`/test-methods/get?id=${methodId}`);

        if (response.success) {
            const testMethod = response.testMethod;
            window.currentEditingTestMethod = testMethod;

            // 填充表单
            document.getElementById('test-method-name').value = testMethod.name;
            document.getElementById('test-method-description').value = testMethod.description || '';

            // 显示模态框
            const modal = document.getElementById('add-test-method-modal');
            modal.style.display = 'block';
        } else {
            showErrorMessage('加载测试方式信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('编辑测试方式错误:', error);
        showErrorMessage('加载测试方式信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除测试方式
async function deleteTestMethod(methodId) {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    // 首先确保没有加载遮罩
    hideLoading();

    // 使用setTimeout确保confirm在新的事件循环中执行，避免与其他事件冲突
    setTimeout(async function () {
        // 显示确认对话框
        if (!(await showConfirmMessage('确定要删除这个测试方式吗？'))) {
            return;
        }

        try {
            showLoading('删除测试方式中...');

            const response = await apiRequest(`/test-methods/delete?id=${methodId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('测试方式删除成功');
                await loadTestMethods();
            } else {
                showErrorMessage('测试方式删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除测试方式错误:', error);
            showErrorMessage('测试方式删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }, 0);
}

// 提交测试方式表单
async function submitTestMethodForm() {
    try {
        // 初始化编辑状态变量，确保它总是有值
        if (typeof window.currentEditingTestMethod === 'undefined') {
            window.currentEditingTestMethod = null;
        }

        const testMethodName = document.getElementById('test-method-name').value.trim();
        const testMethodDescription = document.getElementById('test-method-description').value.trim();

        if (!testMethodName) {
            showErrorMessage('测试方式名称不能为空');
            return;
        }

        showLoading('处理测试方式中...');

        const isEditing = window.currentEditingTestMethod && typeof window.currentEditingTestMethod === 'object';
        const endpoint = isEditing ? '/test-methods/update' : '/test-methods/create';
        const requestData = {
            name: testMethodName,
            description: testMethodDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingTestMethod.id || window.currentEditingTestMethod.method_id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closeTestMethodModal();
            showSuccessMessage(isEditing ? '测试方式编辑成功' : '测试方式添加成功');
            await loadTestMethods(); // 刷新测试方式列表
        } else {
            showErrorMessage((isEditing ? '测试方式编辑' : '测试方式添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理测试方式错误:', error);
        showErrorMessage('测试方式处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 测试类型管理相关函数

// 加载测试类型列表
async function loadTestTypes() {
    try {
        showLoading('加载测试类型列表中...');

        const response = await apiRequest('/test-types/list', { useCache: false });

        if (response.success) {
            const testTypeBody = document.getElementById('test-type-config-body');
            if (testTypeBody) {
                if (response.testTypes.length > 0) {
                    testTypeBody.innerHTML = response.testTypes.map(type => `
                        <tr>
                            <td>${type.name}</td>
                            <td>${type.description || '-'}</td>
                            <td>${type.creator || 'admin'}</td>
                            <td>${type.created_at || type.createdAt || '-'}</td>
                            <td>
                                <button class="config-action-btn edit" onclick="editTestType(${type.id || type.type_id})">编辑</button>
                                <button class="config-action-btn delete" onclick="deleteTestType(${type.id || type.type_id})">删除</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    testTypeBody.innerHTML = `
                        <tr>
                            <td colspan="5" class="no-data">暂无测试类型数据</td>
                        </tr>
                    `;
                }
            }
        } else {
            console.error('加载测试类型列表失败:', response.message);
        }
    } catch (error) {
        console.error('加载测试类型列表错误:', error);
    } finally {
        hideLoading();
    }
}

// 添加测试类型
function addTestType() {
    console.log('添加测试类型');
    const modal = document.getElementById('add-test-type-modal');
    modal.style.display = 'block';
    // 重置表单和编辑状态
    document.getElementById('add-test-type-form').reset();
    window.currentEditingTestType = null;
}

// 关闭测试类型模态框
function closeTestTypeModal() {
    const modal = document.getElementById('add-test-type-modal');
    modal.style.display = 'none';
    document.getElementById('add-test-type-form').reset();
    window.currentEditingTestType = null;
}

// 编辑测试类型
async function editTestType(typeId) {
    try {
        showLoading('加载测试类型信息中...');

        const response = await apiRequest(`/test-types/get?id=${typeId}`);

        if (response.success) {
            const testType = response.testType;
            window.currentEditingTestType = testType;

            // 填充表单
            document.getElementById('test-type-name').value = testType.name;
            document.getElementById('test-type-description').value = testType.description || '';

            // 显示模态框
            const modal = document.getElementById('add-test-type-modal');
            modal.style.display = 'block';
        } else {
            showErrorMessage('加载测试类型信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('编辑测试类型错误:', error);
        showErrorMessage('加载测试类型信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除测试类型
async function deleteTestType(typeId) {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    // 首先确保没有加载遮罩
    hideLoading();

    // 使用setTimeout确保confirm在新的事件循环中执行，避免与其他事件冲突
    setTimeout(async function () {
        // 显示确认对话框
        if (!(await showConfirmMessage('确定要删除这个测试类型吗？'))) {
            return;
        }

        try {
            showLoading('删除测试类型中...');

            const response = await apiRequest(`/test-types/delete?id=${typeId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('测试类型删除成功');
                await loadTestTypes();
            } else {
                showErrorMessage('测试类型删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除测试类型错误:', error);
            showErrorMessage('测试类型删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }, 0);
}

// 提交测试类型表单
async function submitTestTypeForm() {
    try {
        // 初始化编辑状态变量，确保它总是有值
        if (typeof window.currentEditingTestType === 'undefined') {
            window.currentEditingTestType = null;
        }

        const testTypeName = document.getElementById('test-type-name').value.trim();
        const testTypeDescription = document.getElementById('test-type-description').value.trim();

        if (!testTypeName) {
            showErrorMessage('测试类型名称不能为空');
            return;
        }

        showLoading('处理测试类型中...');

        const isEditing = window.currentEditingTestType && typeof window.currentEditingTestType === 'object';
        const endpoint = isEditing ? '/test-types/update' : '/test-types/create';
        const requestData = {
            name: testTypeName,
            description: testTypeDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingTestType.id || window.currentEditingTestType.type_id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closeTestTypeModal();
            showSuccessMessage(isEditing ? '测试类型编辑成功' : '测试类型添加成功');
            await loadTestTypes(); // 刷新测试类型列表
        } else {
            showErrorMessage((isEditing ? '测试类型编辑' : '测试类型添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理测试类型错误:', error);
        showErrorMessage('测试类型处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// ==================== 测试软件管理相关函数 ====================

// 加载测试软件列表
async function loadTestSoftwares() {
    try {
        showLoading('加载测试软件列表中...');

        const response = await apiRequest('/test-softwares/list', { useCache: false });

        if (response.success) {
            const testSoftwareBody = document.getElementById('test-software-config-body');
            if (testSoftwareBody) {
                if (response.softwares.length > 0) {
                    testSoftwareBody.innerHTML = response.softwares.map(software => `
                        <tr>
                            <td>${software.name}</td>
                            <td>${software.description || '-'}</td>
                            <td>${software.creator || 'admin'}</td>
                            <td>${software.created_at || software.createdAt || '-'}</td>
                            <td>
                                <button class="config-action-btn edit" onclick="editTestSoftware(${software.id || software.software_id})">编辑</button>
                                <button class="config-action-btn delete" onclick="deleteTestSoftware(${software.id || software.software_id})">删除</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    testSoftwareBody.innerHTML = `
                        <tr>
                            <td colspan="5" class="no-data">暂无测试软件数据</td>
                        </tr>
                    `;
                }
            }
        } else {
            console.error('加载测试软件列表失败:', response.message);
        }
    } catch (error) {
        console.error('加载测试软件列表错误:', error);
    } finally {
        hideLoading();
    }
}

// 添加测试软件
function addTestSoftware() {
    console.log('添加测试软件');
    const modal = document.getElementById('add-test-software-modal');
    modal.style.display = 'block';
    // 重置表单和编辑状态
    document.getElementById('add-test-software-form').reset();
    window.currentEditingTestSoftware = null;
}

// 关闭测试软件模态框
function closeTestSoftwareModal() {
    const modal = document.getElementById('add-test-software-modal');
    modal.style.display = 'none';
    document.getElementById('add-test-software-form').reset();
    window.currentEditingTestSoftware = null;
}

// 编辑测试软件
async function editTestSoftware(softwareId) {
    try {
        showLoading('加载测试软件信息中...');

        const response = await apiRequest(`/test-softwares/get?id=${softwareId}`);

        if (response.success) {
            const testSoftware = response.software;
            window.currentEditingTestSoftware = testSoftware;

            // 填充表单
            document.getElementById('test-software-name').value = testSoftware.name;
            document.getElementById('test-software-description').value = testSoftware.description || '';

            // 显示模态框
            const modal = document.getElementById('add-test-software-modal');
            modal.style.display = 'block';
        } else {
            showErrorMessage('加载测试软件信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('编辑测试软件错误:', error);
        showErrorMessage('加载测试软件信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除测试软件
async function deleteTestSoftware(softwareId) {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    // 首先确保没有加载遮罩
    hideLoading();

    // 使用setTimeout确保confirm在新的事件循环中执行，避免与其他事件冲突
    setTimeout(async function () {
        // 显示确认对话框
        if (!(await showConfirmMessage('确定要删除这个测试软件吗？'))) {
            return;
        }

        try {
            showLoading('删除测试软件中...');

            const response = await apiRequest(`/test-softwares/delete?id=${softwareId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('测试软件删除成功');
                await loadTestSoftwares();
            } else {
                showErrorMessage('测试软件删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除测试软件错误:', error);
            showErrorMessage('测试软件删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }, 0);
}

// 提交测试软件表单
async function submitTestSoftwareForm() {
    try {
        // 初始化编辑状态变量，确保它总是有值
        if (typeof window.currentEditingTestSoftware === 'undefined') {
            window.currentEditingTestSoftware = null;
        }

        const testSoftwareName = document.getElementById('test-software-name').value.trim();
        const testSoftwareDescription = document.getElementById('test-software-description').value.trim();

        if (!testSoftwareName) {
            showErrorMessage('测试软件名称不能为空');
            return;
        }

        showLoading('处理测试软件中...');

        const isEditing = window.currentEditingTestSoftware && typeof window.currentEditingTestSoftware === 'object';
        const endpoint = isEditing ? '/test-softwares/update' : '/test-softwares/create';
        const requestData = {
            name: testSoftwareName,
            description: testSoftwareDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingTestSoftware.id || window.currentEditingTestSoftware.software_id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closeTestSoftwareModal();
            showSuccessMessage(isEditing ? '测试软件编辑成功' : '测试软件添加成功');
            await loadTestSoftwares(); // 刷新测试软件列表
        } else {
            showErrorMessage((isEditing ? '测试软件编辑' : '测试软件添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理测试软件错误:', error);
        showErrorMessage('测试软件处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 测试阶段管理相关函数

// 加载测试阶段列表
async function loadTestPhases() {
    try {
        showLoading('加载测试阶段列表中...');

        const response = await apiRequest('/test-phases/list', { useCache: false });

        if (response.success) {
            const testPhaseBody = document.getElementById('test-phase-config-body');
            if (testPhaseBody) {
                if (response.testPhases.length > 0) {
                    testPhaseBody.innerHTML = response.testPhases.map(phase => `
                        <tr>
                            <td>${phase.name}</td>
                            <td>${phase.description || '-'}</td>
                            <td>${phase.creator || 'admin'}</td>
                            <td>${phase.created_at || phase.createdAt || '-'}</td>
                            <td>
                                <button class="config-action-btn edit" onclick="editTestPhase(${phase.id || phase.phase_id})">编辑</button>
                                <button class="config-action-btn delete" onclick="deleteTestPhase(${phase.id || phase.phase_id})">删除</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    testPhaseBody.innerHTML = `
                        <tr>
                            <td colspan="5" class="no-data">暂无测试阶段数据</td>
                        </tr>
                    `;
                }
            }
        } else {
            console.error('加载测试阶段列表失败:', response.message);
        }
    } catch (error) {
        console.error('加载测试阶段列表错误:', error);
    } finally {
        hideLoading();
    }
}

// 添加测试阶段
function addTestPhase() {
    console.log('添加测试阶段');
    const modal = document.getElementById('add-test-phase-modal');
    modal.style.display = 'block';
    // 重置表单和编辑状态
    document.getElementById('add-test-phase-form').reset();
    window.currentEditingTestPhase = null;
}

// 关闭测试阶段模态框
function closeTestPhaseModal() {
    const modal = document.getElementById('add-test-phase-modal');
    modal.style.display = 'none';
    document.getElementById('add-test-phase-form').reset();
    window.currentEditingTestPhase = null;
}

// 编辑测试阶段
async function editTestPhase(phaseId) {
    try {
        showLoading('加载测试阶段信息中...');

        const response = await apiRequest(`/test-phases/get?id=${phaseId}`);

        if (response.success) {
            const testPhase = response.testPhase;
            window.currentEditingTestPhase = testPhase;

            // 填充表单
            document.getElementById('test-phase-name').value = testPhase.name;
            document.getElementById('test-phase-description').value = testPhase.description || '';

            // 显示模态框
            const modal = document.getElementById('add-test-phase-modal');
            modal.style.display = 'block';
        } else {
            showErrorMessage('加载测试阶段信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('编辑测试阶段错误:', error);
        showErrorMessage('加载测试阶段信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除测试阶段
async function deleteTestPhase(phaseId) {
    // 检查是否为管理员角色
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    // 首先确保没有加载遮罩
    hideLoading();

    // 使用setTimeout确保confirm在新的事件循环中执行，避免与其他事件冲突
    setTimeout(async function () {
        // 显示确认对话框
        if (!(await showConfirmMessage('确定要删除这个测试阶段吗？'))) {
            return;
        }

        try {
            showLoading('删除测试阶段中...');

            const response = await apiRequest(`/test-phases/delete?id=${phaseId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('测试阶段删除成功');
                await loadTestPhases();
            } else {
                showErrorMessage('测试阶段删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除测试阶段错误:', error);
            showErrorMessage('测试阶段删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }, 0);
}

// 提交测试阶段表单
async function submitTestPhaseForm() {
    try {
        // 初始化编辑状态变量，确保它总是有值
        if (typeof window.currentEditingTestPhase === 'undefined') {
            window.currentEditingTestPhase = null;
        }

        const testPhaseName = document.getElementById('test-phase-name').value.trim();
        const testPhaseDescription = document.getElementById('test-phase-description').value.trim();

        if (!testPhaseName) {
            showErrorMessage('测试阶段名称不能为空');
            return;
        }

        showLoading('处理测试阶段中...');

        const isEditing = window.currentEditingTestPhase && typeof window.currentEditingTestPhase === 'object';
        const endpoint = isEditing ? '/test-phases/update' : '/test-phases/create';
        const requestData = {
            name: testPhaseName,
            description: testPhaseDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingTestPhase.id || window.currentEditingTestPhase.phase_id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closeTestPhaseModal();
            showSuccessMessage(isEditing ? '测试阶段编辑成功' : '测试阶段添加成功');
            await loadTestPhases(); // 刷新测试阶段列表
        } else {
            showErrorMessage((isEditing ? '测试阶段编辑' : '测试阶段添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理测试阶段错误:', error);
        showErrorMessage('测试阶段处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 测试进度管理相关函数

// 加载测试进度列表
async function loadTestProgressConfigs() {
    try {
        showLoading('加载测试进度列表中...');

        const response = await apiRequest('/test-progresses/list');

        if (response.success) {
            const testProgressBody = document.getElementById('test-progress-config-body');
            if (testProgressBody) {
                if (response.testProgresses.length > 0) {
                    testProgressBody.innerHTML = response.testProgresses.map(progress => `
                        <tr>
                            <td>${progress.name}</td>
                            <td>${progress.description || '-'}</td>
                            <td>${progress.creator || 'admin'}</td>
                            <td>${progress.created_at || progress.createdAt || '-'}</td>
                            <td>
                                <button class="config-action-btn edit" onclick="editTestProgress(${progress.id || progress.progress_id})">编辑</button>
                                <button class="config-action-btn delete" onclick="deleteTestProgress(${progress.id || progress.progress_id})">删除</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    testProgressBody.innerHTML = `
                        <tr>
                            <td colspan="5" class="no-data">暂无测试进度数据</td>
                        </tr>
                    `;
                }
            }
        } else {
            console.error('加载测试进度列表失败:', response.message);
        }
    } catch (error) {
        console.error('加载测试进度列表错误:', error);
    } finally {
        hideLoading();
    }
}

// 添加测试进度
function addTestProgress() {
    console.log('添加测试进度');
    const modal = document.getElementById('add-test-progress-modal');
    modal.style.display = 'block';
    // 重置表单和编辑状态
    document.getElementById('add-test-progress-form').reset();
    window.currentEditingTestProgress = null;
}

// 关闭测试进度模态框
function closeTestProgressModal() {
    const modal = document.getElementById('add-test-progress-modal');
    modal.style.display = 'none';
    document.getElementById('add-test-progress-form').reset();
    window.currentEditingTestProgress = null;
}

// 编辑测试进度
async function editTestProgress(progressId) {
    try {
        showLoading('加载测试进度信息中...');

        const response = await apiRequest(`/test-progresses/get?id=${progressId}`);

        if (response.success) {
            const testProgress = response.testProgress;
            window.currentEditingTestProgress = testProgress;

            // 填充表单
            document.getElementById('test-progress-name').value = testProgress.name;
            document.getElementById('test-progress-description').value = testProgress.description || '';

            // 显示模态框
            const modal = document.getElementById('add-test-progress-modal');
            modal.style.display = 'block';
        } else {
            showErrorMessage('加载测试进度信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('编辑测试进度错误:', error);
        showErrorMessage('加载测试进度信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除测试进度
async function deleteTestProgress(progressId) {
    // 首先确保没有加载遮罩
    hideLoading();

    // 使用setTimeout确保confirm在新的事件循环中执行，避免与其他事件冲突
    setTimeout(async function () {
        // 显示确认对话框
        if (!(await showConfirmMessage('确定要删除这个测试进度吗？'))) {
            return;
        }

        try {
            showLoading('删除测试进度中...');

            const response = await apiRequest(`/test-progresses/delete?id=${progressId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('测试进度删除成功');
                await loadTestProgressConfigs();
            } else {
                showErrorMessage('测试进度删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除测试进度错误:', error);
            showErrorMessage('测试进度删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }, 0);
}

// 提交测试进度表单
async function submitTestProgressForm() {
    try {
        // 初始化编辑状态变量，确保它总是有值
        if (typeof window.currentEditingTestProgress === 'undefined') {
            window.currentEditingTestProgress = null;
        }

        const testProgressName = document.getElementById('test-progress-name').value.trim();
        const testProgressDescription = document.getElementById('test-progress-description').value.trim();

        if (!testProgressName) {
            showErrorMessage('测试进度名称不能为空');
            return;
        }

        showLoading('处理测试进度中...');

        const isEditing = window.currentEditingTestProgress && typeof window.currentEditingTestProgress === 'object';
        const endpoint = isEditing ? '/test-progresses/update' : '/test-progresses/create';
        const requestData = {
            name: testProgressName,
            description: testProgressDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingTestProgress.id || window.currentEditingTestProgress.progress_id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closeTestProgressModal();
            showSuccessMessage(isEditing ? '测试进度编辑成功' : '测试进度添加成功');
            await loadTestProgressConfigs(); // 刷新测试进度列表
        } else {
            showErrorMessage((isEditing ? '测试进度编辑' : '测试进度添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理测试进度错误:', error);
        showErrorMessage('测试进度处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 测试状态管理相关函数

// 加载测试状态列表
async function loadTestStatusConfigs() {
    try {
        showLoading('加载测试状态列表中...');

        const response = await apiRequest('/test-statuses/list', { useCache: false });

        if (response.success) {
            const testStatusBody = document.getElementById('test-status-config-body');
            if (testStatusBody) {
                if (response.testStatuses.length > 0) {
                    testStatusBody.innerHTML = response.testStatuses.map(status => `
                        <tr>
                            <td>${status.name}</td>
                            <td>${status.description || '-'}</td>
                            <td>${status.creator || 'admin'}</td>
                            <td>${status.created_at || status.createdAt || '-'}</td>
                            <td>
                                <button class="config-action-btn edit" onclick="editTestStatus(${status.id || status.status_id})">编辑</button>
                                <button class="config-action-btn delete" onclick="deleteTestStatus(${status.id || status.status_id})">删除</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    testStatusBody.innerHTML = `
                        <tr>
                            <td colspan="5" class="no-data">暂无测试状态数据</td>
                        </tr>
                    `;
                }
            }
        } else {
            console.error('加载测试状态列表失败:', response.message);
        }
    } catch (error) {
        console.error('加载测试状态列表错误:', error);
    } finally {
        hideLoading();
    }
}

// 添加测试状态
function addTestStatus() {
    console.log('添加测试状态');
    const modal = document.getElementById('add-test-status-modal');
    modal.style.display = 'block';
    // 重置表单和编辑状态
    document.getElementById('add-test-status-form').reset();
    window.currentEditingTestStatus = null;
}

// 关闭测试状态模态框
function closeTestStatusModal() {
    const modal = document.getElementById('add-test-status-modal');
    modal.style.display = 'none';
    document.getElementById('add-test-status-form').reset();
    window.currentEditingTestStatus = null;
}

// 编辑测试状态
async function editTestStatus(statusId) {
    try {
        showLoading('加载测试状态信息中...');

        const response = await apiRequest(`/test-statuses/get?id=${statusId}`);

        if (response.success) {
            const testStatus = response.testStatus;
            window.currentEditingTestStatus = testStatus;

            // 填充表单
            document.getElementById('test-status-name').value = testStatus.name;
            document.getElementById('test-status-description').value = testStatus.description || '';

            // 显示模态框
            const modal = document.getElementById('add-test-status-modal');
            modal.style.display = 'block';
        } else {
            showErrorMessage('加载测试状态信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('编辑测试状态错误:', error);
        showErrorMessage('加载测试状态信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除测试状态
async function deleteTestStatus(statusId) {
    // 首先确保没有加载遮罩
    hideLoading();

    // 使用setTimeout确保confirm在新的事件循环中执行，避免与其他事件冲突
    setTimeout(async function () {
        // 显示确认对话框
        if (!(await showConfirmMessage('确定要删除这个测试状态吗？'))) {
            return;
        }

        try {
            showLoading('删除测试状态中...');

            const response = await apiRequest(`/test-statuses/delete?id=${statusId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('测试状态删除成功');
                await loadTestStatusConfigs();
            } else {
                showErrorMessage('测试状态删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除测试状态错误:', error);
            showErrorMessage('测试状态删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }, 0);
}

// 提交测试状态表单
async function submitTestStatusForm() {
    try {
        // 初始化编辑状态变量，确保它总是有值
        if (typeof window.currentEditingTestStatus === 'undefined') {
            window.currentEditingTestStatus = null;
        }

        const testStatusName = document.getElementById('test-status-name').value.trim();
        const testStatusDescription = document.getElementById('test-status-description').value.trim();

        if (!testStatusName) {
            showErrorMessage('测试状态名称不能为空');
            return;
        }

        showLoading('处理测试状态中...');

        const isEditing = window.currentEditingTestStatus && typeof window.currentEditingTestStatus === 'object';
        const endpoint = isEditing ? '/test-statuses/update' : '/test-statuses/create';
        const requestData = {
            name: testStatusName,
            description: testStatusDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingTestStatus.id || window.currentEditingTestStatus.status_id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closeTestStatusModal();
            showSuccessMessage(isEditing ? '测试状态编辑成功' : '测试状态添加成功');
            await loadTestStatusConfigs(); // 刷新测试状态列表
        } else {
            showErrorMessage((isEditing ? '测试状态编辑' : '测试状态添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理测试状态错误:', error);
        showErrorMessage('测试状态处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// ==================== 优先级管理相关函数 ====================

// 加载优先级列表
async function loadPriorities() {
    try {
        showLoading('加载优先级列表中...');

        const response = await apiRequest('/priorities/list', { useCache: false });

        if (response.success) {
            const priorityBody = document.getElementById('priority-config-body');
            if (priorityBody) {
                if (response.priorities && response.priorities.length > 0) {
                    priorityBody.innerHTML = response.priorities.map(priority => `
                        <tr>
                            <td>${priority.name}</td>
                            <td>${priority.description || '-'}</td>
                            <td>${priority.creator || 'admin'}</td>
                            <td>${priority.created_at || priority.createdAt || '-'}</td>
                            <td>
                                <button class="config-action-btn edit" onclick="editPriority(${priority.id || priority.priority_id})">编辑</button>
                                <button class="config-action-btn delete" onclick="deletePriority(${priority.id || priority.priority_id})">删除</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    priorityBody.innerHTML = `
                        <tr>
                            <td colspan="5" class="no-data">暂无优先级数据</td>
                        </tr>
                    `;
                }
            }
        } else {
            console.error('加载优先级列表失败:', response.message);
        }
    } catch (error) {
        console.error('加载优先级列表错误:', error);
    } finally {
        hideLoading();
    }
}

// 添加优先级
function addPriority() {
    console.log('添加优先级');
    const modal = document.getElementById('add-priority-modal');
    modal.style.display = 'block';
    document.getElementById('add-priority-form').reset();
    window.currentEditingPriority = null;
}

// 关闭优先级模态框
function closePriorityModal() {
    const modal = document.getElementById('add-priority-modal');
    modal.style.display = 'none';
    document.getElementById('add-priority-form').reset();
    window.currentEditingPriority = null;
}

// 编辑优先级
async function editPriority(priorityId) {
    try {
        showLoading('加载优先级信息中...');

        const response = await apiRequest(`/priorities/get?id=${priorityId}`);

        if (response.success) {
            const priority = response.priority;
            window.currentEditingPriority = priority;

            document.getElementById('priority-name').value = priority.name;
            document.getElementById('priority-description').value = priority.description || '';

            const modal = document.getElementById('add-priority-modal');
            modal.style.display = 'block';
        } else {
            showErrorMessage('加载优先级信息失败: ' + response.message);
        }
    } catch (error) {
        console.error('编辑优先级错误:', error);
        showErrorMessage('加载优先级信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除优先级
async function deletePriority(priorityId) {
    if (!isAdmin()) {
        showErrorMessage('只有管理员才能执行删除操作');
        return;
    }

    hideLoading();

    setTimeout(async function () {
        if (!(await showConfirmMessage('确定要删除这个优先级吗？'))) {
            return;
        }

        try {
            showLoading('删除优先级中...');

            const response = await apiRequest(`/priorities/delete?id=${priorityId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('优先级删除成功');
                await loadPriorities();
            } else {
                showErrorMessage('优先级删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除优先级错误:', error);
            showErrorMessage('优先级删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }, 0);
}

// 提交优先级表单
async function submitPriorityForm() {
    try {
        if (typeof window.currentEditingPriority === 'undefined') {
            window.currentEditingPriority = null;
        }

        const priorityName = document.getElementById('priority-name').value.trim();
        const priorityDescription = document.getElementById('priority-description').value.trim();

        if (!priorityName) {
            showErrorMessage('优先级名称不能为空');
            return;
        }

        showLoading('处理优先级中...');

        const isEditing = window.currentEditingPriority && typeof window.currentEditingPriority === 'object';
        const endpoint = isEditing ? '/priorities/update' : '/priorities/create';
        const requestData = {
            name: priorityName,
            description: priorityDescription,
            creator: currentUser ? currentUser.username : 'admin'
        };

        if (isEditing) {
            requestData.id = window.currentEditingPriority.id || window.currentEditingPriority.priority_id;
        }

        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        if (response.success) {
            closePriorityModal();
            showSuccessMessage(isEditing ? '优先级编辑成功' : '优先级添加成功');
            await loadPriorities();
        } else {
            showErrorMessage((isEditing ? '优先级编辑' : '优先级添加') + '失败: ' + response.message);
        }
    } catch (error) {
        console.error('处理优先级错误:', error);
        showErrorMessage('优先级处理失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 调整一级测试点顺序相关函数

// 打开调整一级测试点顺序的模态框
function openEditLevel1PointsModal() {
    const modal = document.getElementById('edit-level1-points-modal');
    modal.style.display = 'block';

    // 加载一级测试点数据
    loadLevel1PointsForSorting();

    // 初始化拖拽功能
    initLevel1PointsSortable();
}

// 关闭调整一级测试点顺序的模态框
function closeEditLevel1PointsModal() {
    const modal = document.getElementById('edit-level1-points-modal');
    modal.style.display = 'none';
}

// 加载一级测试点数据用于排序
async function loadLevel1PointsForSorting() {
    try {
        showLoading('加载一级测试点数据中...');

        console.log('=== 加载一级测试点数据用于排序 ===');
        console.log('window.currentModule:', window.currentModule);
        console.log('selectedModuleId:', typeof selectedModuleId !== 'undefined' ? selectedModuleId : '未定义');

        if (typeof selectedModuleId !== 'undefined' && selectedModuleId) {
            currentModuleId = selectedModuleId;
            console.log('使用selectedModuleId:', currentModuleId);
        } else if (window.currentModule && window.currentModule.id) {
            currentModuleId = window.currentModule.id;
            console.log('使用window.currentModule.id:', currentModuleId);
        }

        const apiUrl = `/testpoints/level1/${currentModuleId}`;
        console.log('调用API:', apiUrl);

        const response = await apiRequest(apiUrl, { useCache: false });  // 删除后必须跳过缓存
        console.log('API响应:', response);

        const sortableContainer = document.getElementById('level1-points-sortable');
        const countElement = document.getElementById('level1-sort-count');

        if (!sortableContainer) {
            console.error('未找到level1-points-sortable容器');
            return;
        }

        sortableContainer.innerHTML = '';

        if (response.success) {
            const level1Points = response.level1Points || [];
            console.log('解析到的一级测试点:', level1Points);

            if (countElement) {
                countElement.textContent = level1Points.length;
            }

            if (level1Points.length === 0) {
                sortableContainer.innerHTML = `
                    <div class="level1-sort-empty">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <span>暂无一级测试点数据</span>
                    </div>
                `;
                return;
            }

            level1Points.forEach((point, index) => {
                const pointElement = document.createElement('div');
                pointElement.className = 'level1-point-sort-item';
                pointElement.dataset.id = point.id;
                pointElement.innerHTML = `
                    <div class="level1-sort-item-content">
                        <div class="level1-sort-item-left">
                            <div class="level1-sort-drag-handle">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="9" cy="5" r="1"></circle>
                                    <circle cx="9" cy="12" r="1"></circle>
                                    <circle cx="9" cy="19" r="1"></circle>
                                    <circle cx="15" cy="5" r="1"></circle>
                                    <circle cx="15" cy="12" r="1"></circle>
                                    <circle cx="15" cy="19" r="1"></circle>
                                </svg>
                            </div>
                            <div class="level1-sort-item-index">${index + 1}</div>
                            <span class="level1-sort-item-name">${point.name}</span>
                        </div>
                        <div class="level1-sort-item-actions">
                            <button class="level1-sort-edit-btn" onclick="editLevel1Point(${point.id})">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                                编辑
                            </button>
                            <button class="level1-sort-delete-btn" onclick="deleteLevel1Point(${point.id})">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                                删除
                            </button>
                        </div>
                    </div>
                `;
                pointElement.draggable = true;
                sortableContainer.appendChild(pointElement);
            });
        } else {
            console.error('加载一级测试点数据失败:', response.message);
            if (countElement) countElement.textContent = '0';
            sortableContainer.innerHTML = `
                <div class="level1-sort-error">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                    <span>加载失败: ${response.message || '未知错误'}</span>
                </div>
            `;
        }
    } catch (error) {
        console.error('加载一级测试点数据错误:', error);
        console.error('错误堆栈:', error.stack);
        const sortableContainer = document.getElementById('level1-points-sortable');
        const countElement = document.getElementById('level1-sort-count');
        if (countElement) countElement.textContent = '0';
        if (sortableContainer) {
            sortableContainer.innerHTML = `
                <div class="level1-sort-error">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                    <span>加载失败: ${error.message || '网络错误'}</span>
                </div>
            `;
        }
    } finally {
        hideLoading();
    }
}

// 初始化拖拽功能
function initLevel1PointsSortable() {
    const sortableContainer = document.getElementById('level1-points-sortable');
    if (!sortableContainer) return;

    let draggedElement = null;

    function getDraggableElement(target) {
        return target.closest('.level1-point-sort-item');
    }

    sortableContainer.addEventListener('dragstart', function (e) {
        const draggable = getDraggableElement(e.target);
        if (draggable) {
            draggedElement = draggable;
            draggable.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        }
    });

    sortableContainer.addEventListener('dragend', function (e) {
        const draggable = getDraggableElement(e.target);
        if (draggable) {
            draggable.classList.remove('dragging');
            draggedElement = null;
        }
        document.querySelectorAll('.level1-point-sort-item').forEach(item => {
            item.classList.remove('drag-over');
        });
    });

    sortableContainer.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    sortableContainer.addEventListener('dragenter', function (e) {
        const draggable = getDraggableElement(e.target);
        if (draggable && draggable !== draggedElement) {
            draggable.classList.add('drag-over');
        }
    });

    sortableContainer.addEventListener('dragleave', function (e) {
        const draggable = getDraggableElement(e.target);
        if (draggable) {
            draggable.classList.remove('drag-over');
        }
    });

    sortableContainer.addEventListener('drop', function (e) {
        e.preventDefault();
        if (draggedElement) {
            const targetDraggable = getDraggableElement(e.target);
            if (targetDraggable) {
                targetDraggable.classList.remove('drag-over');
            }

            const afterElement = getDragAfterElement(sortableContainer, e.clientY);
            if (afterElement == null) {
                sortableContainer.appendChild(draggedElement);
            } else {
                sortableContainer.insertBefore(draggedElement, afterElement);
            }

            updateSortItemIndexes();
        }
    });

    const draggableItems = sortableContainer.querySelectorAll('.level1-point-sort-item');
    draggableItems.forEach(item => {
        item.draggable = true;
    });
}

function updateSortItemIndexes() {
    const items = document.querySelectorAll('.level1-point-sort-item');
    items.forEach((item, index) => {
        const indexElement = item.querySelector('.level1-sort-item-index');
        if (indexElement) {
            indexElement.textContent = index + 1;
        }
    });
}

// 获取拖拽元素应该放置在哪个元素之后
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.level1-point-sort-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// 保存调整后的一级测试点顺序
async function saveLevel1PointsOrder() {
    try {
        showLoading('保存一级测试点顺序中...');

        const sortableContainer = document.getElementById('level1-points-sortable');
        const sortableItems = sortableContainer.querySelectorAll('.level1-point-sort-item');

        // 收集调整后的顺序
        const orderedPoints = [];
        sortableItems.forEach((item, index) => {
            orderedPoints.push({
                id: parseInt(item.dataset.id),
                orderIndex: index
            });
        });

        // 调用API保存顺序
        const response = await apiRequest('/testpoints/level1/reorder', {
            method: 'POST',
            body: JSON.stringify({ level1Points: orderedPoints })
        });

        if (response.success) {
            closeEditLevel1PointsModal();
            showSuccessMessage('一级测试点顺序调整成功');

            // 刷新一级测试点列表
            if (typeof loadLevel1Points === 'function') {
                // 获取当前模块ID（用独立变量名避免遮蔽全局 currentModuleId）
                let moduleIdToRefresh = currentModuleId || 1;
                if (typeof selectedModuleId !== 'undefined' && selectedModuleId) {
                    moduleIdToRefresh = selectedModuleId;
                } else if (window.currentModule && window.currentModule.id) {
                    moduleIdToRefresh = window.currentModule.id;
                }

                // 刷新一级测试点列表
                await loadLevel1Points(moduleIdToRefresh);
            }
        } else {
            showErrorMessage('一级测试点顺序调整失败: ' + response.message);
        }
    } catch (error) {
        console.error('保存一级测试点顺序错误:', error);
        showErrorMessage('一级测试点顺序调整失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 编辑一级测试点
async function editLevel1Point(pointId) {
    console.log('编辑一级测试点:', pointId);
    closeEditLevel1PointsModal();
    await openEditLevel1PointModal(pointId);
}

// 打开编辑一级测试点模态框
async function openEditLevel1PointModal(pointId) {
    try {
        showLoading('加载测试点数据中...');

        const response = await apiRequest(`/testpoints/level1/detail/${pointId}`);

        if (response.success && response.testpoint) {
            const point = response.testpoint;

            document.getElementById('edit-level1-point-id').value = point.id;
            document.getElementById('edit-level1-point-name').value = point.name || '';
            
            // 从配置中心加载测试类型
            const typeSelect = document.getElementById('edit-level1-point-type');
            try {
                const testTypesData = await apiRequest('/test-types/list');
                if (testTypesData && testTypesData.success && Array.isArray(testTypesData.testTypes) && testTypesData.testTypes.length > 0) {
                    typeSelect.innerHTML = testTypesData.testTypes.map(type => 
                        `<option value="${type.name}">${type.name}</option>`
                    ).join('');
                } else {
                    typeSelect.innerHTML = `
                        <option value="功能测试">功能测试</option>
                        <option value="性能测试">性能测试</option>
                        <option value="兼容性测试">兼容性测试</option>
                        <option value="安全测试">安全测试</option>
                    `;
                }
            } catch (error) {
                console.error('加载测试类型失败:', error);
            }
            
            typeSelect.value = point.test_type || point.type || '功能测试';

            const counter = document.getElementById('edit-level1-point-name-counter');
            if (counter) {
                counter.textContent = `${(point.name || '').length}/64`;
            }

            document.getElementById('edit-level1-point-modal').style.display = 'block';
            
            // 初始化拖拽调整宽度功能
            initLevel1PointModalResizer('edit');
        } else {
            showErrorMessage('加载测试点数据失败: ' + (response.message || '未知错误'));
        }
    } catch (error) {
        console.error('打开编辑一级测试点模态框错误:', error);
        showErrorMessage('加载测试点数据失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 关闭编辑一级测试点模态框
function closeEditLevel1PointModal() {
    const modal = document.getElementById('edit-level1-point-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    const form = document.getElementById('edit-level1-point-form');
    if (form) {
        form.reset();
    }
    
    // 重置模态框位置和宽度
    resetLevel1PointModalPosition('edit');
}

// 提交编辑一级测试点表单
async function submitEditLevel1PointForm() {
    try {
        showLoading('保存测试点中...');

        const pointId = document.getElementById('edit-level1-point-id').value;
        const pointName = document.getElementById('edit-level1-point-name').value.trim();
        const pointType = document.getElementById('edit-level1-point-type').value;

        if (!pointName) {
            showErrorMessage('测试点名称不能为空');
            return;
        }

        const response = await apiRequest(`/testpoints/level1/edit/${pointId}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: pointName,
                test_type: pointType
            })
        });

        if (response.success) {
            showSuccessMessage('一级测试点更新成功');
            closeEditLevel1PointModal();
            // 同时刷新：排序弹窗列表 + 主页面一级测试点列表
            await loadLevel1PointsForSorting();
            console.log('[编辑一级测试点] currentModuleId:', currentModuleId);
            console.log('[编辑一级测试点] selectedModuleId:', typeof selectedModuleId !== 'undefined' ? selectedModuleId : '未定义');
            console.log('[编辑一级测试点] window.currentModule:', window.currentModule);
            
            let moduleIdToRefresh = currentModuleId;
            if (!moduleIdToRefresh && typeof selectedModuleId !== 'undefined' && selectedModuleId) {
                moduleIdToRefresh = selectedModuleId;
            }
            if (!moduleIdToRefresh && window.currentModule && window.currentModule.id) {
                moduleIdToRefresh = window.currentModule.id;
            }
            
            console.log('[编辑一级测试点] 最终使用的 moduleId:', moduleIdToRefresh);
            
            if (moduleIdToRefresh) {
                await loadLevel1Points(moduleIdToRefresh);
            } else {
                console.warn('[编辑一级测试点] 无法确定要刷新的模块ID');
            }
        } else {
            showErrorMessage('更新失败: ' + (response.message || '未知错误'));
        }
    } catch (error) {
        console.error('提交编辑一级测试点表单错误:', error);
        showErrorMessage('更新失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除一级测试点
async function deleteLevel1Point(pointId) {
    if (await showConfirmMessage('确定要删除这个一级测试点吗？')) {
        try {
            showLoading('删除一级测试点中...');

            const response = await apiRequest(`/testpoints/level1/delete/${pointId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('一级测试点删除成功');
                
                // 发布事件：一级测试点变更
                DataEventManager.emit(DataEvents.LEVEL1_POINT_CHANGED, { 
                    action: 'delete', 
                    pointId: pointId 
                });
                
                // 刷新模块列表（更新模块名称右侧的一级测试点数量）
                await initModuleData();
                
                // 刷新一级测试点列表
                let moduleIdToRefresh = currentModuleId;
                if (!moduleIdToRefresh && typeof selectedModuleId !== 'undefined' && selectedModuleId) {
                    moduleIdToRefresh = selectedModuleId;
                }
                if (!moduleIdToRefresh && window.currentModule && window.currentModule.id) {
                    moduleIdToRefresh = window.currentModule.id;
                }
                
                if (moduleIdToRefresh) {
                    await loadLevel1Points(moduleIdToRefresh);
                }
                
                // 清空测试用例列表显示
                updateFloatingPanelContent([]);
            } else {
                showErrorMessage('一级测试点删除失败: ' + response.message);
            }
        } catch (error) {
            console.error('删除一级测试点错误:', error);
            showErrorMessage('一级测试点删除失败: ' + error.message);
        } finally {
            hideLoading();
        }
    }
}

// ========================================
// AI配置管理功能
// ========================================

// AI配置缓存
let aiConfigCache = null;
let aiModelsCache = [];
let editingAIModelId = null;

// 加载AI配置
async function loadAIConfig() {
    try {
        const response = await apiRequest('/ai-config/get');
        if (response.success) {
            aiConfigCache = response.config;
            return response.config;
        }
        return null;
    } catch (error) {
        console.error('加载AI配置错误:', error);
        return null;
    }
}

// 加载AI模型列表
async function loadAIModels() {
    try {
        const response = await apiRequest('/ai-models/list');
        if (response.success) {
            aiModelsCache = response.models;
            return response.models;
        }
        return [];
    } catch (error) {
        console.error('加载AI模型列表错误:', error);
        return [];
    }
}

// ========================================
// AI 技能管理
// ========================================

let currentEditingSkillId = null;

// 加载AI技能列表（支持 RBAC）
async function loadAISkills() {
    try {
        const response = await apiRequest('/ai-skills/list');
        const tableBody = document.getElementById('ai-skills-config-body');

        if (!tableBody) return;

        const currentUserId = response.currentUser?.id;
        // 支持中英文角色值判断管理员权限
        const isAdmin = response.currentUser?.role === '管理员' || response.currentUser?.role === 'admin' || response.currentUser?.role === 'Administrator';

        if (response.success && response.skills && response.skills.length > 0) {
            const rows = response.skills.map(skill => {
                const isCreator = skill.creatorId === currentUserId;
                const canEdit = skill.canEdit;
                const canDelete = skill.canDelete;
                
                const formatTime = (dateStr) => {
                    if (!dateStr) return '-';
                    return formatDateTime(dateStr);
                };
                
                const creatorLabel = skill.creatorName 
                    ? skill.creatorName + (isCreator ? ' <span style="color:#4f46e5;">(我)</span>' : '')
                    : '-';
                const updaterLabel = skill.updaterName 
                    ? skill.updaterName + (skill.updaterId === currentUserId ? ' <span style="color:#4f46e5;">(我)</span>' : '')
                    : '-';
                
                const editOnClick = canEdit ? 'editAISkill(' + skill.id + ')' : '';
                const deleteOnClick = canDelete && !skill.isSystem ? 'deleteAISkill(' + skill.id + ')' : '';
                
                return '<tr data-skill-id="' + skill.id + '">' +
                    '<td><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 12px;">' + (skill.name || '') + '</code></td>' +
                    '<td>' + (skill.displayName || '-') + '</td>' +
                    '<td style="font-size: 12px; color: #6b7280;">' + ((skill.description || '-').substring(0, 40)) + (skill.description && skill.description.length > 40 ? '...' : '') + '</td>' +
                    '<td><span style="background: #eef2ff; color: #4f46e5; padding: 2px 8px; border-radius: 4px; font-size: 11px;">' + (skill.category || 'general') + '</span></td>' +
                    '<td>' +
                        '<label class="switch-label" style="position: relative; display: inline-block; width: 36px; height: 20px;">' +
                            '<input type="checkbox" class="switch-input" ' + (skill.isEnabled ? 'checked' : '') + ' onchange="toggleSkillStatus(' + skill.id + ')" style="opacity: 0; width: 0; height: 0;">' +
                            '<span class="switch-slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ' + (skill.isEnabled ? '#10b981' : '#ccc') + '; border-radius: 10px; transition: .3s;"></span>' +
                        '</label>' +
                    '</td>' +
                    '<td style="font-size: 11px;">' +
                        '<div>' + creatorLabel + ' (' + formatTime(skill.createdAt) + ')</div>' +
                        '<div style="color:#9ca3af;">' + updaterLabel + ' (' + formatTime(skill.updatedAt) + ')</div>' +
                    '</td>' +
                    '<td>' +
                        '<span style="background: ' + (skill.isPublic ? '#d1fae5' : '#fef3c7') + '; color: ' + (skill.isPublic ? '#065f46' : '#92400e') + '; padding: 2px 8px; border-radius: 4px; font-size: 11px;">' +
                            (skill.isPublic ? '公共' : '私有') +
                        '</span>' +
                        (skill.isSystem ? '<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 4px;">系统</span>' : '') +
                    '</td>' +
                    '<td>' +
                        '<div style="display: flex; gap: 4px;">' +
                            '<button class="config-action-btn ' + (canEdit ? 'edit' : 'disabled') + '" onclick="' + editOnClick + '" title="' + (canEdit ? '编辑' : '无编辑权限') + '" ' + (!canEdit ? 'disabled' : '') + '>' +
                                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                                    '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>' +
                                    '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>' +
                                '</svg>' +
                            '</button>' +
                            '<button class="config-action-btn ' + (!canDelete || skill.isSystem ? 'disabled' : 'delete') + '" onclick="' + deleteOnClick + '" title="' + (skill.isSystem ? '系统内置不可删除' : canDelete ? '删除' : '无删除权限') + '" ' + (!canDelete || skill.isSystem ? 'disabled' : '') + '>' +
                                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                                    '<path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>' +
                                '</svg>' +
                            '</button>' +
                        '</div>' +
                    '</td>' +
                '</tr>';
            });
            tableBody.innerHTML = rows.join('');
        } else {
            tableBody.innerHTML = '<tr><td colspan="8" class="no-data">暂无AI技能，点击上方按钮新建</td></tr>';
        }
    } catch (error) {
        console.error('加载AI技能列表错误:', error);
    }
}

// 切换技能启用状态（仅影响当前用户）
async function toggleSkillStatus(skillId) {
    try {
        const response = await apiRequest(`/ai-skills/toggle/${skillId}`, {
            method: 'POST'
        });
        
        if (response.success) {
            showSuccessMessage(response.message);
            await loadAISkills();
        } else {
            showErrorMessage(response.message || '操作失败');
        }
    } catch (error) {
        console.error('切换技能状态错误:', error);
        showErrorMessage('操作失败');
    }
}

// 打开AI技能模态框
function openAISkillModal(skill = null) {
    const modal = document.getElementById('ai-skill-modal');
    const title = document.getElementById('ai-skill-modal-title');
    const warning = document.getElementById('ai-skill-edit-warning');
    const publicCheckbox = document.getElementById('ai-skill-public-checkbox');
    const publicGroup = document.getElementById('ai-skill-public-group');

    if (skill) {
        title.textContent = '编辑AI技能';
        currentEditingSkillId = skill.id;

        document.getElementById('ai-skill-name-input').value = skill.name;
        document.getElementById('ai-skill-display-name-input').value = skill.displayName || '';
        document.getElementById('ai-skill-description-input').value = skill.description || '';
        document.getElementById('ai-skill-category-select').value = skill.category || 'general';
        document.getElementById('ai-skill-enabled-select').value = skill.isEnabled ? 'true' : 'false';
        document.getElementById('ai-skill-definition-input').value = typeof skill.definition === 'string' ? skill.definition : JSON.stringify(skill.definition, null, 2);
        document.getElementById('ai-skill-code-input').value = skill.executeCode || '';
        
        if (publicCheckbox) {
            publicCheckbox.checked = skill.isPublic || false;
        }

        if (skill.isSystem) {
            document.getElementById('ai-skill-code-input').disabled = true;
            warning.style.display = 'inline';
        } else {
            document.getElementById('ai-skill-code-input').disabled = false;
            warning.style.display = 'none';
        }
        
        if (publicGroup) {
            publicGroup.style.display = skill.isSystem ? 'none' : 'flex';
        }
    } else {
        title.textContent = '新建AI技能';
        currentEditingSkillId = null;

        document.getElementById('ai-skill-name-input').value = '';
        document.getElementById('ai-skill-display-name-input').value = '';
        document.getElementById('ai-skill-description-input').value = '';
        document.getElementById('ai-skill-category-select').value = 'general';
        document.getElementById('ai-skill-enabled-select').value = 'true';
        document.getElementById('ai-skill-definition-input').value = '';
        document.getElementById('ai-skill-code-input').value = '';
        document.getElementById('ai-skill-code-input').disabled = false;
        warning.style.display = 'none';
        
        if (publicCheckbox) {
            publicCheckbox.checked = false;
        }
        if (publicGroup) {
            publicGroup.style.display = 'flex';
        }
    }

    modal.style.display = 'flex';
}

// 关闭AI技能模态框
function closeAISkillModal() {
    document.getElementById('ai-skill-modal').style.display = 'none';
    currentEditingSkillId = null;
}

// 编辑AI技能
async function editAISkill(skillId) {
    try {
        const response = await apiRequest(`/ai-skills/detail/${skillId}`);
        if (response.success && response.skill) {
            openAISkillModal(response.skill);
        } else {
            showErrorMessage('获取技能详情失败');
        }
    } catch (error) {
        console.error('获取技能详情错误:', error);
        showErrorMessage('获取技能详情失败');
    }
}

// 保存AI技能
async function saveAISkill() {
    const name = document.getElementById('ai-skill-name-input').value.trim();
    const displayName = document.getElementById('ai-skill-display-name-input').value.trim();
    const description = document.getElementById('ai-skill-description-input').value.trim();
    const category = document.getElementById('ai-skill-category-select').value;
    const definition = document.getElementById('ai-skill-definition-input').value.trim();
    const executeCode = document.getElementById('ai-skill-code-input').value.trim();
    const makePublicCheckbox = document.getElementById('ai-skill-public-checkbox');
    const makePublicAndEnableAll = makePublicCheckbox ? makePublicCheckbox.checked : false;

    if (!name) {
        showErrorMessage('请输入技能标识名');
        return;
    }

    if (!definition) {
        showErrorMessage('请输入技能定义');
        return;
    }

    if (!executeCode && !currentEditingSkillId) {
        showErrorMessage('请输入执行代码');
        return;
    }

    try {
        JSON.parse(definition);
    } catch (e) {
        showErrorMessage('技能定义必须是有效的JSON格式');
        return;
    }

    try {
        let response;

        if (currentEditingSkillId) {
            response = await apiRequest(`/ai-skills/update/${currentEditingSkillId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name,
                    displayName,
                    description,
                    definition,
                    executeCode,
                    category,
                    isPublic: makePublicAndEnableAll
                })
            });
        } else {
            response = await apiRequest('/ai-skills/create', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    displayName,
                    description,
                    definition,
                    executeCode,
                    category,
                    makePublicAndEnableAll
                })
            });
        }

        if (response.success) {
            showSuccessMessage(currentEditingSkillId ? '技能更新成功' : '技能创建成功');
            closeAISkillModal();
            await loadAISkills();
        } else {
            showErrorMessage(response.message || '保存失败');
        }
    } catch (error) {
        console.error('保存AI技能错误:', error);
        showErrorMessage('保存失败: ' + error.message);
    }
}

// 删除AI技能
async function deleteAISkill(skillId) {
    if (!(await showConfirmMessage('确定要删除这个AI技能吗？此操作不可恢复。'))) {
        return;
    }

    try {
        const response = await apiRequest(`/ai-skills/${skillId}`, {
            method: 'DELETE'
        });

        if (response.success) {
            showSuccessMessage('技能删除成功');
            await loadAISkills();
        } else {
            showErrorMessage(response.message || '删除失败');
        }
    } catch (error) {
        console.error('删除AI技能错误:', error);
        showErrorMessage('删除失败: ' + error.message);
    }
}

// ========================================
// 报告模板管理
// ========================================

let selectedTemplateFile = null;

// 加载报告模板列表
async function loadReportTemplates() {
    try {
        const response = await apiRequest('/templates/list');
        const tableBody = document.getElementById('report-templates-config-body');

        if (!tableBody) return;

        if (response.success && response.templates && response.templates.length > 0) {
            tableBody.innerHTML = response.templates.map(template => `
                <tr data-template-id="${template.id}">
                    <td>
                        <strong>${template.name}</strong>
                        ${template.isDefault ? '<span style="background: #d1fae5; color: #065f46; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 8px;">默认</span>' : ''}
                    </td>
                    <td style="font-size: 12px; color: #6b7280;">${template.description || '-'}</td>
                    <td><span style="background: #eef2ff; color: #4f46e5; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${template.fileType.toUpperCase()}</span></td>
                    <td>
                        <span style="background: ${template.isDefault ? '#d1fae5' : '#f3f4f6'}; color: ${template.isDefault ? '#065f46' : '#6b7280'}; padding: 2px 8px; border-radius: 4px; font-size: 11px;">
                            ${template.isDefault ? '默认' : '可用'}
                        </span>
                    </td>
                    <td style="font-size: 12px;">${template.createdAt ? formatDate(template.createdAt) : '-'}</td>
                    <td>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            <button class="config-action-btn view" onclick="viewTemplateContent(${template.id})" title="查看内容">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                            ${!template.isDefault ? `
                                <button class="config-action-btn star" onclick="setTemplateAsDefault(${template.id})" title="设为默认模板">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                                    </svg>
                                </button>
                                <button class="config-action-btn delete" onclick="deleteReportTemplate(${template.id})" title="删除模板">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tableBody.innerHTML = '<tr><td colspan="6" class="no-data">暂无报告模板，点击上方按钮上传</td></tr>';
        }
    } catch (error) {
        console.error('加载报告模板列表错误:', error);
    }
}

// 打开模板上传模态框
function openTemplateUploadModal() {
    const modal = document.getElementById('template-upload-modal');
    modal.style.display = 'flex';

    // 重置表单
    document.getElementById('template-upload-form').reset();
    selectedTemplateFile = null;
    document.getElementById('template-file-selected').style.display = 'none';
    document.getElementById('template-drop-zone').querySelector('.file-upload-hint').style.display = 'block';
}

// 关闭模板上传模态框
function closeTemplateUploadModal() {
    document.getElementById('template-upload-modal').style.display = 'none';
    selectedTemplateFile = null;
}

// 清除选中的模板文件
function clearSelectedTemplate() {
    selectedTemplateFile = null;
    document.getElementById('template-file-selected').style.display = 'none';
    document.getElementById('template-drop-zone').querySelector('.file-upload-hint').style.display = 'block';
    document.getElementById('template-file-input').value = '';
}

// 上传模板
async function uploadTemplate() {
    const name = document.getElementById('template-name-input').value.trim();
    const description = document.getElementById('template-description-input').value.trim();
    const isDefault = document.getElementById('template-default-checkbox').checked;

    if (!name) {
        showErrorMessage('请输入模板名称');
        return;
    }

    if (!selectedTemplateFile) {
        showErrorMessage('请选择模板文件');
        return;
    }

    const formData = new FormData();
    formData.append('template', selectedTemplateFile);
    formData.append('name', name);
    formData.append('description', description);
    formData.append('isDefault', isDefault);
    formData.append('createdBy', currentUser?.username || 'admin');

    try {
        showLoading('上传模板中...');

        const response = await fetch('/api/templates/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            showSuccessMessage('模板上传成功');
            closeTemplateUploadModal();
            await loadReportTemplates();
        } else {
            showErrorMessage(result.message || '上传失败');
        }
    } catch (error) {
        console.error('上传模板错误:', error);
        showErrorMessage('上传失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 查看模板内容
async function viewTemplateContent(templateId) {
    try {
        const response = await apiRequest(`/templates/detail/${templateId}`);

        if (response.success && response.template) {
            const template = response.template;

            // 创建一个模态框显示模板内容
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'flex';
            modal.id = 'template-view-modal';
            modal.innerHTML = `
                <div class="modal-content" style="width: 900px; max-width: 95%; max-height: 90vh;">
                    <div class="modal-header">
                        <h3 id="template-modal-title">${template.name}</h3>
                        <button class="close-btn" onclick="closeTemplateViewModal()">&times;</button>
                    </div>
                    <div class="modal-body" style="padding: 0;">
                        <div id="template-view-mode" style="padding: 20px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <span style="background: #eef2ff; color: #4f46e5; padding: 4px 12px; border-radius: 6px; font-size: 12px;">${template.fileType.toUpperCase()}</span>
                                    ${template.isDefault ? '<span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 6px; font-size: 12px;">默认模板</span>' : ''}
                                </div>
                                <div style="display: flex; gap: 8px;">
                                    <button class="secondary-btn" onclick="switchToEditMode(${templateId})">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                        </svg>
                                        编辑内容
                                    </button>
                                    <button class="secondary-btn" onclick="copyTemplateContent()">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                        </svg>
                                        复制
                                    </button>
                                </div>
                            </div>
                            <pre id="template-content-display" style="background: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.6; white-space: pre-wrap; max-height: 50vh; overflow-y: auto; border: 1px solid #e5e7eb;">${escapeHtml(template.content || '')}</pre>
                            
                            <!-- 创建和编辑信息 - 上下两行样式 -->
                            <div class="template-meta-info">
                                <div class="meta-row">
                                    <div class="meta-icon created">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"></path>
                                            <circle cx="12" cy="7" r="4"></circle>
                                        </svg>
                                    </div>
                                    <div class="meta-details">
                                        <span class="meta-label">创建者</span>
                                        <span class="meta-user">${template.createdBy || 'system'}</span>
                                        <span class="meta-time">${formatDate(template.createdAt)}</span>
                                    </div>
                                </div>
                                <div class="meta-row">
                                    <div class="meta-icon updated">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                        </svg>
                                    </div>
                                    <div class="meta-details">
                                        <span class="meta-label">最后编辑</span>
                                        <span class="meta-user">${template.updatedBy || template.createdBy || 'system'}</span>
                                        <span class="meta-time">${template.updatedBy ? formatDate(template.updatedAt) : '从未编辑'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div id="template-edit-mode" style="display: none; padding: 20px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                                <span style="font-size: 14px; color: #6b7280;">编辑模板内容（支持 Markdown 格式）</span>
                                <div style="display: flex; gap: 8px;">
                                    <button class="secondary-btn" onclick="switchToViewMode()">取消</button>
                                    <button class="primary-btn" onclick="saveTemplateContent(${templateId})">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"></path>
                                            <polyline points="17,21 17,13 7,13 7,21"></polyline>
                                            <polyline points="7,3 7,8 15,8"></polyline>
                                        </svg>
                                        保存
                                    </button>
                                </div>
                            </div>
                            <textarea id="template-content-editor" style="width: 100%; min-height: 50vh; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; font-family: 'Fira Code', 'Monaco', 'Consolas', monospace; font-size: 13px; line-height: 1.6; resize: vertical; background: #f8fafc;">${escapeHtml(template.content || '')}</textarea>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // 存储当前模板 ID
            window.currentTemplateId = templateId;
        }
    } catch (error) {
        console.error('获取模板内容错误:', error);
    }
}

// 关闭模板查看模态框
function closeTemplateViewModal() {
    const modal = document.getElementById('template-view-modal');
    if (modal) {
        modal.remove();
    }
    window.currentTemplateId = null;
}

// 切换到编辑模式
function switchToEditMode(templateId) {
    document.getElementById('template-view-mode').style.display = 'none';
    document.getElementById('template-edit-mode').style.display = 'block';

    // 更新标题
    document.getElementById('template-modal-title').innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: middle;">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        编辑模板
    `;
}

// 切换到查看模式
function switchToViewMode() {
    document.getElementById('template-edit-mode').style.display = 'none';
    document.getElementById('template-view-mode').style.display = 'block';

    // 恢复标题
    const modal = document.getElementById('template-view-modal');
    if (modal) {
        const title = modal.querySelector('.modal-header h3');
        title.textContent = '模板内容';
    }
}

// 保存模板内容
async function saveTemplateContent(templateId) {
    const content = document.getElementById('template-content-editor').value;
    const updatedBy = currentUser?.username || 'admin';

    try {
        showLoading('保存模板内容...');

        const response = await apiRequest(`/templates/update-content/${templateId}`, {
            method: 'PUT',
            body: JSON.stringify({ content, updatedBy })
        });

        if (response.success) {
            showSuccessMessage('模板内容保存成功');

            // 更新显示内容
            document.getElementById('template-content-display').textContent = content;

            switchToViewMode();

            await loadReportTemplates();
        } else {
            showErrorMessage(response.message || '保存失败');
        }
    } catch (error) {
        console.error('保存模板内容错误:', error);
        showErrorMessage('保存失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 复制模板内容
function copyTemplateContent() {
    const content = document.getElementById('template-content-display').textContent;
    navigator.clipboard.writeText(content).then(() => {
        showSuccessMessage('模板内容已复制到剪贴板');
    }).catch(err => {
        console.error('复制失败:', err);
        showErrorMessage('复制失败');
    });
}

// 设置模板为默认
async function setTemplateAsDefault(templateId) {
    try {
        const response = await apiRequest(`/templates/set-default/${templateId}`, {
            method: 'PUT'
        });

        if (response.success) {
            showSuccessMessage('默认模板设置成功');
            await loadReportTemplates();
        } else {
            showErrorMessage(response.message || '设置失败');
        }
    } catch (error) {
        console.error('设置默认模板错误:', error);
        showErrorMessage('设置失败');
    }
}

// 删除报告模板
async function deleteReportTemplate(templateId) {
    if (!(await showConfirmMessage('确定要删除这个报告模板吗？'))) {
        return;
    }

    try {
        const response = await apiRequest(`/templates/${templateId}`, {
            method: 'DELETE'
        });

        if (response.success) {
            showSuccessMessage('模板删除成功');
            await loadReportTemplates();
        } else {
            showErrorMessage(response.message || '删除失败');
        }
    } catch (error) {
        console.error('删除报告模板错误:', error);
        showErrorMessage('删除失败: ' + error.message);
    }
}

// HTML 转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 初始化模板文件上传区域
document.addEventListener('DOMContentLoaded', function () {
    // 模板上传按钮点击
    document.getElementById('upload-template-btn')?.addEventListener('click', openTemplateUploadModal);

    // 文件选择区域点击
    const dropZone = document.getElementById('template-drop-zone');
    const fileInput = document.getElementById('template-file-input');

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        // 文件选择
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleTemplateFileSelect(e.target.files[0]);
            }
        });

        // 拖拽上传
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');

            if (e.dataTransfer.files.length > 0) {
                handleTemplateFileSelect(e.dataTransfer.files[0]);
            }
        });
    }
});

// 处理模板文件选择
function handleTemplateFileSelect(file) {
    const allowedTypes = ['.md', '.txt'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!allowedTypes.includes(ext)) {
        showErrorMessage('只支持 .md 和 .txt 格式的文件');
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showErrorMessage('文件大小不能超过 5MB');
        return;
    }

    selectedTemplateFile = file;

    document.getElementById('template-drop-zone').querySelector('.file-upload-hint').style.display = 'none';
    document.getElementById('template-file-selected').style.display = 'flex';
    document.getElementById('selected-template-name').textContent = file.name;
}

// 初始化AI配置页面
async function initAIConfigPage() {
    // 加载全局配置
    const config = await loadAIConfig();
    if (config) {
        const enabledSelect = document.getElementById('ai-enabled-select');
        if (enabledSelect && config.ai_enabled) {
            enabledSelect.value = config.ai_enabled.value;
        }
    }

    // 加载AI模型列表
    await renderAIModelsList();
}

// 渲染AI模型列表
async function renderAIModelsList() {
    const tbody = document.getElementById('ai-models-config-body');
    if (!tbody) return;

    const models = await loadAIModels();

    if (models.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="no-data">暂无AI模型配置</td></tr>';
        return;
    }

    tbody.innerHTML = models.map(model => `
        <tr>
            <td>${model.name || '-'}</td>
            <td>${getProviderName(model.provider)}</td>
            <td title="${model.endpoint || ''}">${truncateText(model.endpoint, 30)}</td>
            <td>
                <span class="status-badge ${model.is_enabled ? 'active' : 'inactive'}">
                    ${model.is_enabled ? '启用' : '禁用'}
                </span>
            </td>
            <td>
                ${model.is_default ? '<span class="default-badge">⭐ 默认</span>' : '-'}
            </td>
            <td>
                <button class="config-action-btn test" onclick="testAIModelConnection('${model.model_id}')">测试</button>
                <button class="config-action-btn edit" onclick="editAIModel('${model.model_id}')">编辑</button>
                ${!model.is_default ? `<button class="config-action-btn" onclick="setDefaultAIModel('${model.model_id}')">设为默认</button>` : ''}
                ${!model.is_default ? `<button class="config-action-btn delete" onclick="deleteAIModel('${model.model_id}')">删除</button>` : ''}
            </td>
        </tr>
    `).join('');
}

// 获取提供商名称
function getProviderName(provider) {
    const providerNames = {
        'deepseek': 'DeepSeek',
        'openai': 'OpenAI',
        'zhipu': '智谱AI',
        'anthropic': 'Anthropic',
        'custom': '自定义'
    };
    return providerNames[provider] || provider;
}

// 截断文本
function truncateText(text, maxLength) {
    if (!text) return '-';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// 打开AI模型模态框
function openAIModelModal(isEdit = false) {
    const modal = document.getElementById('ai-model-modal');
    const title = document.getElementById('ai-model-modal-title');

    if (modal) {
        modal.style.display = 'flex';
        if (title) {
            title.textContent = isEdit ? '编辑AI模型' : '添加AI模型';
        }
    }
}

// 关闭AI模型模态框
function closeAIModelModal() {
    const modal = document.getElementById('ai-model-modal');
    if (modal) {
        modal.style.display = 'none';
    }

    // 清空表单
    document.getElementById('ai-model-id-input').value = '';
    document.getElementById('ai-model-name-input').value = '';
    document.getElementById('ai-model-provider-select').value = 'deepseek';
    document.getElementById('ai-model-name-api-input').value = '';
    document.getElementById('ai-model-api-key-input').value = '';
    document.getElementById('ai-model-endpoint-input').value = '';
    document.getElementById('ai-model-default-select').value = 'false';
    document.getElementById('ai-model-enabled-select').value = 'true';
    document.getElementById('ai-model-description-input').value = '';

    editingAIModelId = null;
}

// 编辑AI模型
async function editAIModel(modelId) {
    try {
        showLoading();
        const response = await apiRequest(`/ai-models/get?modelId=${modelId}`);

        if (response.success && response.model) {
            const model = response.model;
            editingAIModelId = modelId;

            document.getElementById('ai-model-id-input').value = model.model_id;
            document.getElementById('ai-model-id-input').disabled = true; // 编辑时不能修改ID
            document.getElementById('ai-model-name-input').value = model.name || '';
            document.getElementById('ai-model-provider-select').value = model.provider || 'deepseek';
            document.getElementById('ai-model-name-api-input').value = model.model_name || '';
            document.getElementById('ai-model-api-key-input').value = model.api_key || '';
            document.getElementById('ai-model-endpoint-input').value = model.endpoint || '';
            document.getElementById('ai-model-default-select').value = model.is_default ? 'true' : 'false';
            document.getElementById('ai-model-enabled-select').value = model.is_enabled ? 'true' : 'false';
            document.getElementById('ai-model-description-input').value = model.description || '';

            openAIModelModal(true);
        } else {
            showErrorMessage('获取模型信息失败');
        }
    } catch (error) {
        console.error('编辑AI模型错误:', error);
        showErrorMessage('获取模型信息失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 保存AI模型
async function saveAIModel() {
    const modelId = document.getElementById('ai-model-id-input').value.trim();
    const name = document.getElementById('ai-model-name-input').value.trim();
    const provider = document.getElementById('ai-model-provider-select').value;
    const modelName = document.getElementById('ai-model-name-api-input').value.trim();
    const apiKey = document.getElementById('ai-model-api-key-input').value.trim();
    const endpoint = document.getElementById('ai-model-endpoint-input').value.trim();
    const isDefault = document.getElementById('ai-model-default-select').value === 'true';
    const isEnabled = document.getElementById('ai-model-enabled-select').value === 'true';
    const description = document.getElementById('ai-model-description-input').value.trim();

    // 验证必填字段
    if (!modelId || !name || !modelName || !apiKey || !endpoint) {
        showErrorMessage('请填写所有必填字段');
        return;
    }

    const modelData = {
        modelId,
        name,
        provider,
        modelName,
        apiKey,
        endpoint,
        isDefault,
        isEnabled,
        description,
        username: currentUser ? currentUser.username : 'admin'
    };

    try {
        showLoading();

        let response;
        if (editingAIModelId) {
            // 更新
            response = await apiRequest('/ai-models/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelData)
            });
        } else {
            // 添加
            response = await apiRequest('/ai-models/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelData)
            });
        }

        if (response.success) {
            showSuccessMessage(editingAIModelId ? 'AI模型更新成功' : 'AI模型添加成功');
            closeAIModelModal();
            await renderAIModelsList();
        } else {
            showErrorMessage(response.message || '保存失败');
        }
    } catch (error) {
        console.error('保存AI模型错误:', error);
        showErrorMessage('保存失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 删除AI模型
async function deleteAIModel(modelId) {
    if (!(await showConfirmMessage('确定要删除这个AI模型吗？'))) {
        return;
    }

    try {
        showLoading();
        const response = await apiRequest('/ai-models/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId })
        });

        if (response.success) {
            showSuccessMessage('AI模型删除成功');
            await renderAIModelsList();
        } else {
            showErrorMessage(response.message || '删除失败');
        }
    } catch (error) {
        console.error('删除AI模型错误:', error);
        showErrorMessage('删除失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 设置默认AI模型
async function setDefaultAIModel(modelId) {
    try {
        showLoading();
        const response = await apiRequest('/ai-models/set-default', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId })
        });

        if (response.success) {
            showSuccessMessage('默认AI模型设置成功');
            await renderAIModelsList();
        } else {
            showErrorMessage(response.message || '设置失败');
        }
    } catch (error) {
        console.error('设置默认AI模型错误:', error);
        showErrorMessage('设置失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 获取默认AI模型
async function getDefaultAIModel() {
    try {
        const models = await loadAIModels();
        const defaultModel = models.find(m => m.is_default && m.is_enabled);
        return defaultModel || null;
    } catch (error) {
        console.error('获取默认AI模型错误:', error);
        return null;
    }
}

// 测试AI模型连接
async function testAIModelConnection(modelId) {
    try {
        showLoading();

        // 获取模型信息
        const response = await apiRequest(`/ai-models/get?modelId=${modelId}`);
        if (!response.success || !response.model) {
            showErrorMessage('获取模型信息失败');
            return;
        }

        const model = response.model;

        if (!model.api_key) {
            showErrorMessage('该模型未配置API密钥，请先编辑模型配置');
            return;
        }

        // 显示测试状态
        const statusDiv = document.getElementById('ai-config-status');
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.className = 'config-status loading';
            statusDiv.innerHTML = `🔄 正在测试模型 "${model.name}" 连接...`;
        }

        // 构建测试请求
        const testBody = {
            model: model.model_name,
            messages: [{ role: 'user', content: 'Hello' }],
            max_tokens: 10
        };

        const headers = {
            'Content-Type': 'application/json'
        };

        // 根据提供商设置认证方式
        if (model.provider === 'anthropic') {
            headers['x-api-key'] = model.api_key;
            headers['anthropic-version'] = '2023-06-01';
        } else {
            headers['Authorization'] = `Bearer ${model.api_key}`;
        }

        const testResponse = await fetch(model.endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(testBody)
        });

        if (testResponse.ok) {
            if (statusDiv) {
                statusDiv.className = 'config-status success';
                statusDiv.innerHTML = `✅ 模型 "${model.name}" 连接成功！AI服务可用`;
            }
            showSuccessMessage('AI模型连接测试成功');
        } else {
            let errorMessage = '未知错误';
            try {
                const contentType = testResponse.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await testResponse.json();
                    errorMessage = errorData.error?.message || errorData.message || JSON.stringify(errorData);
                } else {
                    errorMessage = await testResponse.text();
                }
            } catch (parseError) {
                errorMessage = `HTTP ${testResponse.status}: ${testResponse.statusText}`;
            }

            if (statusDiv) {
                statusDiv.className = 'config-status error';
                statusDiv.innerHTML = `❌ 模型 "${model.name}" 连接失败: ${errorMessage}`;
            }
            showErrorMessage('连接测试失败: ' + errorMessage);
        }
    } catch (error) {
        console.error('测试AI模型连接错误:', error);
        const statusDiv = document.getElementById('ai-config-status');
        if (statusDiv) {
            statusDiv.className = 'config-status error';
            statusDiv.innerHTML = `❌ 连接测试失败: ${error.message}`;
        }
        showErrorMessage('连接测试失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 绑定AI配置事件
document.addEventListener('DOMContentLoaded', function () {
    // 添加AI模型按钮
    const addAIModelBtn = document.getElementById('add-ai-model-btn');
    if (addAIModelBtn) {
        addAIModelBtn.addEventListener('click', function () {
            editingAIModelId = null;
            document.getElementById('ai-model-id-input').disabled = false;
            openAIModelModal(false);
        });
    }

    // AI启用状态变化
    const aiEnabledSelect = document.getElementById('ai-enabled-select');
    if (aiEnabledSelect) {
        aiEnabledSelect.addEventListener('change', async function () {
            try {
                const response = await apiRequest('/ai-config/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        enabled: this.value === 'true',
                        username: currentUser ? currentUser.username : 'admin'
                    })
                });

                if (response.success) {
                    showSuccessMessage('AI功能状态已更新');
                }
            } catch (error) {
                console.error('更新AI启用状态错误:', error);
            }
        });
    }

    // 提供商选择变化时自动填充默认端点
    const providerSelect = document.getElementById('ai-model-provider-select');
    if (providerSelect) {
        providerSelect.addEventListener('change', function () {
            const endpointInput = document.getElementById('ai-model-endpoint-input');
            if (!endpointInput) return;

            switch (this.value) {
                case 'deepseek':
                    endpointInput.value = 'https://api.deepseek.com/v1/chat/completions';
                    break;
                case 'openai':
                    endpointInput.value = 'https://api.openai.com/v1/chat/completions';
                    break;
                case 'zhipu':
                    endpointInput.value = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
                    break;
                case 'anthropic':
                    endpointInput.value = 'https://api.anthropic.com/v1/messages';
                    break;
            }
        });
    }
});

// ========================================
// AI知识问答功能
// ========================================

// 打开AI助手模态框
async function openAIAssistant() {
    const modal = document.getElementById('ai-assistant-modal');
    if (modal) {
        modal.classList.add('show');

        // 重置位置到屏幕中央
        const content = modal.querySelector('.ai-modal-content');
        if (content) {
            content.style.left = '50%';
            content.style.top = '50%';
            content.style.transform = 'translate(-50%, -50%)';
        }

        // 初始化拖动功能
        initAIModalDrag();

        // 从后端加载配置
        const config = await loadAIConfig();
        if (config) {
            // 检查是否启用AI功能
            if (config.ai_enabled && config.ai_enabled.value === 'false') {
                showErrorMessage('AI功能已禁用，请联系管理员启用');
                modal.classList.remove('show');
                return;
            }
        }

        // 加载可用的AI模型列表
        await loadAvailableModels();

        // 聚焦到输入框
        setTimeout(() => {
            const input = document.getElementById('ai-input');
            if (input) input.focus();
        }, 100);
    }
}

// 加载可用的AI模型列表
async function loadAvailableModels() {
    const modelSelect = document.getElementById('ai-model-select');
    if (!modelSelect) return;

    try {
        const response = await apiRequest('/ai-models/list');
        if (response.success && response.models) {
            // 只显示启用的模型
            const enabledModels = response.models.filter(m => m.is_enabled);

            if (enabledModels.length === 0) {
                modelSelect.innerHTML = '<option value="">暂无可用模型</option>';
                return;
            }

            modelSelect.innerHTML = enabledModels.map(model =>
                `<option value="${model.model_id}" ${model.is_default ? 'selected' : ''}>
                    ${model.name} ${model.is_default ? '(默认)' : ''}
                </option>`
            ).join('');
        }
    } catch (error) {
        console.error('加载AI模型列表错误:', error);
        modelSelect.innerHTML = '<option value="">加载失败</option>';
    }
}

// 关闭AI助手模态框
function closeAIAssistant() {
    const modal = document.getElementById('ai-assistant-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// 初始化AI模态框拖动功能
function initAIModalDrag() {
    const modal = document.getElementById('ai-assistant-modal');
    const content = modal?.querySelector('.ai-modal-content');
    const header = modal?.querySelector('.ai-modal-header');

    if (!modal || !content || !header) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    // 鼠标按下事件
    header.addEventListener('mousedown', (e) => {
        // 如果点击的是关闭按钮，不触发拖动
        if (e.target.closest('.ai-close-btn')) return;

        isDragging = true;

        // 获取当前位置
        const rect = content.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        // 移除 transform，使用绝对定位
        content.style.transform = 'none';
        content.style.left = startLeft + 'px';
        content.style.top = startTop + 'px';
        content.style.margin = '0';

        // 添加拖动样式
        content.style.cursor = 'grabbing';
        header.style.cursor = 'grabbing';

        e.preventDefault();
    });

    // 鼠标移动事件
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = startLeft + deltaX;
        let newTop = startTop + deltaY;

        // 边界限制
        const maxLeft = window.innerWidth - content.offsetWidth;
        const maxTop = window.innerHeight - content.offsetHeight;

        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        content.style.left = newLeft + 'px';
        content.style.top = newTop + 'px';
    });

    // 鼠标释放事件
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            content.style.cursor = '';
            header.style.cursor = 'grab';
        }
    });

    // 设置header初始样式
    header.style.cursor = 'grab';
    header.style.userSelect = 'none';
}

// 发送AI查询
async function sendAIQuery() {
    const input = document.getElementById('ai-input');
    const message = input.value.trim();

    if (!message) {
        showErrorMessage('请输入您的问题');
        return;
    }

    // 获取选择的模型
    const modelSelect = document.getElementById('ai-model-select');
    const selectedModelId = modelSelect ? modelSelect.value : '';

    // 添加用户消息到聊天容器
    addChatMessage('user', message);

    // 清空输入框
    input.value = '';

    // 显示加载状态
    const loadingMessage = addChatMessage('loading', '正在思考中...');

    try {
        // 调用后端 AI 分析接口
        const response = await apiRequest('/ai/analyze', {
            method: 'POST',
            body: JSON.stringify({
                query: message,
                modelId: selectedModelId
            })
        });

        // 移除加载消息
        removeChatMessage(loadingMessage);

        if (response.success) {
            // 检查是否为报告类型
            if (response.isReport) {
                addChatMessage('assistant', response.answer, true);
            } else {
                addChatMessage('assistant', response.answer);
            }
        } else {
            addChatMessage('assistant', `抱歉，处理您的问题时出现错误: ${response.message || '未知错误'}`);
        }

    } catch (error) {
        console.error('AI查询错误:', error);
        removeChatMessage(loadingMessage);
        addChatMessage('assistant', `抱歉，处理您的问题时出现错误: ${error.message}`);
    }
}

// 收集上下文数据
async function gatherContextData(query) {
    const context = {
        query: query,
        timestamp: new Date().toISOString(),
        data: {}
    };

    try {
        // 根据查询内容决定获取哪些数据
        const queryLower = query.toLowerCase();

        // 获取测试统计数据
        if (queryLower.includes('统计') || queryLower.includes('通过率') || queryLower.includes('概览')) {
            const statsResponse = await apiRequest('/dashboard/stats');
            if (statsResponse.success) {
                context.data.stats = statsResponse.stats;
            }
        }

        // 获取项目数据
        if (queryLower.includes('项目') || queryLower.includes('进度')) {
            const projectsResponse = await apiRequest('/dashboard/project-progress');
            if (projectsResponse.success) {
                context.data.projects = projectsResponse.projectProgress;
            }
        }

        // 获取负责人数据
        if (queryLower.includes('负责人') || queryLower.includes('人员') || queryLower.includes('任务')) {
            const ownersResponse = await apiRequest('/dashboard/owner-analysis');
            if (ownersResponse.success) {
                context.data.owners = ownersResponse.ownerAnalysis;
            }
        }

        // 获取测试用例数据
        if (queryLower.includes('用例') || queryLower.includes('测试点')) {
            const casesResponse = await apiRequest('/testcases/list?page=1&pageSize=100');
            if (casesResponse.success) {
                context.data.testCases = casesResponse.testCases;
            }
        }

        // 获取用例库数据
        if (queryLower.includes('用例库') || queryLower.includes('库')) {
            const librariesResponse = await apiRequest('/libraries/list');
            if (librariesResponse.success) {
                context.data.libraries = librariesResponse.libraries;
            }
        }

        // 获取状态分布数据
        if (queryLower.includes('状态') || queryLower.includes('分布')) {
            const statusResponse = await apiRequest('/dashboard/status-distribution');
            if (statusResponse.success) {
                context.data.statusDistribution = statusResponse.statusDistribution;
            }
        }

        // 获取趋势数据
        if (queryLower.includes('趋势') || queryLower.includes('最近') || queryLower.includes('天')) {
            const trendResponse = await apiRequest('/dashboard/trend/pass-rate?days=7');
            if (trendResponse.success) {
                context.data.trend = trendResponse.trendData;
            }
        }

    } catch (error) {
        console.error('收集上下文数据错误:', error);
    }

    return context;
}

// 调用大模型API
async function callLLMApi(query, contextData, apiKey, model, customEndpoint, modelName) {
    // 构建提示词
    const systemPrompt = `你是一个专业的测试管理助手。你可以访问以下测试数据来回答用户的问题：

数据库上下文信息：
${JSON.stringify(contextData, null, 2)}

请基于以上数据回答用户的问题。回答要求：
1. 使用中文回答
2. 数据要准确，引用具体数字
3. 如果需要表格展示，使用Markdown表格格式
4. 如果需要代码，使用Markdown代码块格式
5. 回答要简洁明了，突出重点`;

    let endpoint = customEndpoint || '';
    let headers = {
        'Content-Type': 'application/json'
    };

    let requestBody = {
        model: modelName || '',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
        ],
        temperature: 0.7,
        max_tokens: 2000
    };

    // 根据选择的模型配置API
    switch (model) {
        case 'deepseek':
            if (!endpoint) endpoint = 'https://api.deepseek.com/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            if (!modelName) requestBody.model = 'deepseek-chat';
            break;
        case 'openai':
            if (!endpoint) endpoint = 'https://api.openai.com/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            if (!modelName) requestBody.model = 'gpt-3.5-turbo';
            break;
        case 'zhipu':
            if (!endpoint) endpoint = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            if (!modelName) requestBody.model = 'glm-4';
            break;
        case 'anthropic':
            if (!endpoint) endpoint = 'https://api.anthropic.com/v1/messages';
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            if (!modelName) requestBody.model = 'claude-3-sonnet-20240229';
            break;
        default:
            if (!endpoint) throw new Error('自定义模型需要配置API端点');
            headers['Authorization'] = `Bearer ${apiKey}`;
            if (!modelName) requestBody.model = 'custom-model';
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'API调用失败');
        }

        const data = await response.json();
        return data.choices[0].message.content;

    } catch (error) {
        console.error('调用LLM API错误:', error);
        throw error;
    }
}

// 添加聊天消息
function addChatMessage(role, content, isReport = false) {
    const container = document.getElementById('ai-chat-container');
    if (!container) return null;

    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'ai-avatar';
    avatar.textContent = role === 'user' ? '我' : 'AI';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'ai-message-content';

    if (role === 'loading') {
        contentDiv.innerHTML = '<span class="loading-dots">思考中...</span>';
    } else if (isReport) {
        // 报告类型，添加特殊样式和下载按钮
        contentDiv.innerHTML = `
            <div class="ai-report-container">
                <div class="ai-report-header">
                    <span class="ai-report-icon">📊</span>
                    <span class="ai-report-title">测试报告</span>
                    <button class="ai-report-download-btn" onclick="downloadReport(this)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
                        </svg>
                        下载
                    </button>
                </div>
                <div class="ai-report-content">${parseMarkdown(content)}</div>
            </div>
        `;
    } else {
        // 解析Markdown内容
        contentDiv.innerHTML = parseMarkdown(content);
    }

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    container.appendChild(messageDiv);

    // 滚动到底部
    container.scrollTop = container.scrollHeight;

    return messageDiv;
}

// 下载报告
function downloadReport(btn) {
    const reportContent = btn.closest('.ai-report-container').querySelector('.ai-report-content');
    if (!reportContent) return;

    // 获取报告文本
    const reportText = reportContent.innerText;

    // 创建下载
    const blob = new Blob([reportText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `测试报告_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 移除聊天消息
function removeChatMessage(messageElement) {
    if (messageElement && messageElement.parentNode) {
        messageElement.parentNode.removeChild(messageElement);
    }
}

// 解析Markdown内容
function parseMarkdown(text) {
    if (!text) return '';

    // 转义HTML
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 代码块
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 表格
    html = html.replace(/\|(.+)\|\n\|[-|: ]+\|\n((?:\|.+\|\n?)+)/g, function (match, header, body) {
        const headers = header.split('|').filter(h => h.trim());
        const rows = body.trim().split('\n');

        let table = '<table><thead><tr>';
        headers.forEach(h => {
            table += `<th>${h.trim()}</th>`;
        });
        table += '</tr></thead><tbody>';

        rows.forEach(row => {
            const cells = row.split('|').filter(c => c.trim());
            table += '<tr>';
            cells.forEach(c => {
                table += `<td>${c.trim()}</td>`;
            });
            table += '</tr>';
        });

        table += '</tbody></table>';
        return table;
    });

    // 标题
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

    // 粗体和斜体
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 列表
    html = html.replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // 换行
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    return `<p>${html}</p>`;
}

// 快捷建议按钮点击
function askSuggestion(question) {
    const input = document.getElementById('ai-input');
    if (input) {
        input.value = question;
        sendAIQuery();
    }
}

// 绑定Enter键发送
document.addEventListener('DOMContentLoaded', function () {
    const aiInput = document.getElementById('ai-input');
    if (aiInput) {
        aiInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAIQuery();
            }
        });

        // 自动调整高度
        aiInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
    }

    // 点击模态框外部关闭
    const aiModal = document.getElementById('ai-assistant-modal');
    if (aiModal) {
        aiModal.addEventListener('click', function (e) {
            if (e.target === this) {
                closeAIAssistant();
            }
        });
    }
});

// ==================== 测试计划管理 ====================

// 全局变量
let currentTestPlanStep = 1;
let assetsTreeData = [];
window.selectedCases = new Set();  // 使用 window.selectedCases 确保全局可访问
let testPlanReportData = null;

// 打开高级测试计划模态框
async function openAdvancedTestPlanModal() {
    document.getElementById('advanced-testplan-modal').style.display = 'block';
    currentTestPlanStep = 1;
    updateWizardSteps();

    // 隐藏实际完成时间字段（新建模式）
    const actualEndTimeGroup = document.getElementById('testplan-actual-end-time-group');
    if (actualEndTimeGroup) {
        actualEndTimeGroup.style.display = 'none';
    }

    // 加载负责人列表
    await loadOwnersForTestPlan();

    // 加载项目列表
    await loadProjectsForTestPlan();

    // 加载测试阶段和测试软件
    await loadStagesAndSoftwares();

    // 加载筛选器配置选项
    await loadFilterOptions();

    // 加载AI模型列表
    await loadAIModelsForFilter();

    // 加载测试资产树（必须在loadFilterOptions之后）
    await initAssetsTree();
}

// 加载负责人列表（过滤掉admin）
async function loadOwnersForTestPlan() {
    try {
        const usersData = await apiRequest('/users/list');
        const ownerSelect = document.getElementById('testplan-owner');

        if (!ownerSelect) return;

        // 使用统一过滤函数过滤掉admin用户
        const filteredUsers = filterOwners(Array.isArray(usersData) ? usersData : (usersData.users || []));

        ownerSelect.innerHTML = '<option value="">请选择负责人</option>';

        filteredUsers.forEach(user => {
            const option = document.createElement('option');
            option.value = user.username;
            option.textContent = user.username;
            ownerSelect.appendChild(option);
        });
    } catch (error) {
        console.error('加载负责人列表失败:', error);
        const ownerSelect = document.getElementById('testplan-owner');
        if (ownerSelect) {
            ownerSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }
}

// 关闭高级测试计划模态框
function closeAdvancedTestPlanModal() {
    document.getElementById('advanced-testplan-modal').style.display = 'none';
    resetTestPlanForm();
}

// 重置表单
function resetTestPlanForm() {
    currentTestPlanStep = 1;
    window.selectedCases.clear();

    window.selectedCasesHierarchy = {
        libraries: new Set(),
        modules: new Set(),
        level1Points: new Set()
    };
    window.parentSelectedCounts = {
        libraries: {},
        modules: {},
        level1Points: {}
    };

    const nameEl = document.getElementById('testplan-name');
    const projectEl = document.getElementById('testplan-project');
    const iterationEl = document.getElementById('testplan-iteration');
    const startDateEl = document.getElementById('testplan-start-date');
    const endDateEl = document.getElementById('testplan-end-date');
    const descriptionEl = document.getElementById('testplan-description');

    if (nameEl) nameEl.value = '';
    if (projectEl) projectEl.selectedIndex = 0;
    if (iterationEl) iterationEl.value = '';
    if (startDateEl) startDateEl.value = '';
    if (endDateEl) endDateEl.value = '';
    if (descriptionEl) descriptionEl.value = '';

    // 重置筛选器（新的5个维度）
    const libraryEl = document.getElementById('filter-library');
    const priorityEl = document.getElementById('filter-priority');
    const methodEl = document.getElementById('filter-method');
    const typeEl = document.getElementById('filter-type');
    const statusEl = document.getElementById('filter-status');
    const aiFilterEl = document.getElementById('ai-filter-input');

    if (libraryEl) libraryEl.value = '';
    if (priorityEl) priorityEl.value = '';
    if (methodEl) methodEl.value = '';
    if (typeEl) typeEl.value = '';
    if (statusEl) statusEl.value = '';
    if (aiFilterEl) aiFilterEl.value = '';

    updateWizardSteps();
    updateCaseCount();
}

// 加载测试阶段和测试软件
async function loadStagesAndSoftwares() {
    try {
        // 加载测试阶段
        const stagesResponse = await apiRequest('/configs/stages');
        const stageSelect = document.getElementById('testplan-stage');
        if (stagesResponse.success && stagesResponse.stages) {
            stageSelect.innerHTML = '<option value="">请选择阶段</option>' +
                stagesResponse.stages.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }

        // 加载测试软件
        const softwaresResponse = await apiRequest('/configs/softwares');
        const softwareSelect = document.getElementById('testplan-software');
        if (softwaresResponse.success && softwaresResponse.softwares) {
            softwareSelect.innerHTML = '<option value="">请选择软件</option>' +
                softwaresResponse.softwares.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
    } catch (error) {
        console.error('加载配置失败:', error);
    }
}

// 全局变量：存储筛选器配置数据（用于AI回显时文本到ID的映射）
let filterConfigData = {
    libraries: [],
    priorities: [],
    methods: [],
    types: [],
    statuses: []
};

// 加载筛选器配置选项（双引擎筛选器 - 5个维度，统一对象数组格式）
async function loadFilterOptions() {
    try {
        const response = await apiRequest('/configs/filter_options');

        if (response.success && response.data) {
            const data = response.data;

            // 保存配置数据到全局变量（用于AI回显时文本到ID的映射）
            filterConfigData = {
                libraries: data.libraries || [],
                priorities: data.priorities || [],
                methods: data.methods || [],
                types: data.types || [],
                statuses: data.statuses || []
            };

            // 统一渲染函数：将对象数组渲染为select选项（不触发change事件）
            const renderSelectOptions = (selectId, options, placeholder) => {
                const select = document.getElementById(selectId);
                if (select && options && options.length > 0) {
                    // 临时移除 onchange 事件，避免触发筛选
                    const originalOnchange = select.onchange;
                    select.onchange = null;

                    // 所有数据都是对象数组格式：[{id: 1, name: "xxx"}, ...]
                    select.innerHTML = `<option value="">${placeholder}</option>` +
                        options.map(item => `<option value="${item.id}">${item.name}</option>`).join('');

                    // 恢复 onchange 事件
                    select.onchange = originalOnchange;
                }
            };

            // 渲染5个下拉框
            renderSelectOptions('filter-library', data.libraries, '全部用例库');
            renderSelectOptions('filter-priority', data.priorities, '全部优先级');
            renderSelectOptions('filter-method', data.methods, '全部方式');
            renderSelectOptions('filter-type', data.types, '全部类型');
            renderSelectOptions('filter-status', data.statuses, '全部状态');

            console.log('筛选器配置加载成功:', {
                libraries: data.libraries?.length || 0,
                priorities: data.priorities?.length || 0,
                methods: data.methods?.length || 0,
                types: data.types?.length || 0,
                statuses: data.statuses?.length || 0
            });
        }
    } catch (error) {
        console.error('加载筛选器配置失败:', error);
    }
}

// 根据名称查找ID（用于AI回显时文本到ID的映射）
function findIdByName(configKey, name) {
    const config = filterConfigData[configKey];
    if (!config || !name) return null;

    const item = config.find(c => c.name === name || c.name.includes(name) || name.includes(c.name));
    return item ? item.id : null;
}

// 加载AI模型列表（筛选器用）
async function loadAIModelsForFilter() {
    try {
        const response = await apiRequest('/ai-models/list');
        const modelSelect = document.getElementById('ai-model-select');

        if (response.success && response.models) {
            const defaultModel = response.models.find(m => m.is_default);
            modelSelect.innerHTML = '<option value="">默认模型</option>' +
                response.models
                    .filter(m => m.is_enabled)
                    .map(m => `<option value="${m.model_id}" ${m.is_default ? 'selected' : ''}>${m.name}</option>`)
                    .join('');
        }
    } catch (error) {
        console.error('加载AI模型列表失败:', error);
    }
}

// 初始化测试资产树（懒加载模式）
async function initAssetsTree() {
    try {
        const treeContainer = document.getElementById('test-assets-tree');
        if (!treeContainer) {
            return;
        }

        treeContainer.innerHTML = '<div class="tree-loading"><div class="loading-spinner"></div><span>加载资产树...</span></div>';

        // 使用懒加载：只加载用例库列表
        const response = await apiRequest('/testassets/tree?level=libraries');

        if (response.success) {
            assetsTreeData = response.tree || [];

            // 渲染资产树（只渲染用例库层级）
            if (assetsTreeData.length === 0) {
                treeContainer.innerHTML = '<div class="tree-loading"><span>没有用例库</span></div>';
            } else {
                const treeHtml = renderLazyAssetsTree(assetsTreeData);
                treeContainer.innerHTML = treeHtml;

                // 编辑模式：更新一级节点的勾选状态
                if (window.selectedCases.size > 0 && window.selectedCasesHierarchy) {
                    updateLevel1CheckboxStates();
                }
            }

            // 绑定事件
            bindAssetsTreeEvents();

            // 更新统计
            updateCaseCount();
        } else {
            treeContainer.innerHTML = '<div class="tree-loading"><span>加载失败: ' + (response.message || '未知错误') + '</span></div>';
        }
    } catch (error) {
        console.error('初始化资产树失败:', error);
        const container = document.getElementById('test-assets-tree');
        if (container) {
            container.innerHTML = '<div class="tree-loading"><span>加载失败: ' + error.message + '</span></div>';
        }
    }
}

// 自动展开已选中用例的父节点路径（编辑模式）
async function autoExpandSelectedPaths() {
    if (!window.selectedCasesHierarchy) return;

    const librariesToExpand = Array.from(window.selectedCasesHierarchy.libraries || []);
    const modulesToExpand = Array.from(window.selectedCasesHierarchy.modules || []);
    const level1PointsToExpand = Array.from(window.selectedCasesHierarchy.level1Points || []);

    console.log('自动展开路径 - 用例库:', librariesToExpand);
    console.log('自动展开路径 - 模块:', modulesToExpand);
    console.log('自动展开路径 - 一级测试点:', level1PointsToExpand);

    // 展开用例库节点（一级）
    for (const libraryId of librariesToExpand) {
        const libraryNode = document.querySelector(`.tree-node[data-level="1"][data-id="${libraryId}"]`);
        if (libraryNode && libraryNode.dataset.loaded !== 'true') {
            const expandIcon = libraryNode.querySelector('.tree-expand-icon');
            if (expandIcon) {
                await toggleLazyTreeNode(expandIcon);
            }
        }
    }

    // 等待 DOM 更新
    await new Promise(resolve => setTimeout(resolve, 100));

    // 展开模块节点（二级）
    for (const moduleId of modulesToExpand) {
        const moduleNode = document.querySelector(`.tree-node[data-level="2"][data-id="${moduleId}"]`);
        if (moduleNode && moduleNode.dataset.loaded !== 'true') {
            const expandIcon = moduleNode.querySelector('.tree-expand-icon');
            if (expandIcon) {
                await toggleLazyTreeNode(expandIcon);
            }
        }
    }

    // 等待 DOM 更新
    await new Promise(resolve => setTimeout(resolve, 100));

    // 展开一级测试点节点（三级）
    for (const level1Id of level1PointsToExpand) {
        const level1Node = document.querySelector(`.tree-node[data-level="3"][data-id="${level1Id}"]`);
        if (level1Node && level1Node.dataset.loaded !== 'true') {
            const expandIcon = level1Node.querySelector('.tree-expand-icon');
            if (expandIcon) {
                await toggleLazyTreeNode(expandIcon);
            }
        }
    }

    // 等待 DOM 更新
    await new Promise(resolve => setTimeout(resolve, 100));

    // 最后更新所有节点的勾选状态
    updateTreeCheckboxStates();

    console.log('自动展开路径完成');
}

// 更新一级节点（用例库）的勾选状态
function updateLevel1CheckboxStates() {
    const libraryNodes = document.querySelectorAll('.tree-node[data-level="1"]');

    libraryNodes.forEach(nodeEl => {
        const nodeId = parseInt(nodeEl.dataset.id);
        const checkbox = nodeEl.querySelector(':scope > .tree-node-content > .tree-checkbox');
        const nodeCaseCount = parseInt(nodeEl.dataset.caseCount || 0);

        if (!checkbox) return;

        const selectedCount = window.parentSelectedCounts?.libraries?.[nodeId] || 0;

        if (nodeCaseCount > 0 && selectedCount === nodeCaseCount) {
            checkbox.checked = true;
            checkbox.indeterminate = false;
            nodeEl.classList.add('selected');
            nodeEl.classList.remove('partial');
        } else if (selectedCount > 0) {
            checkbox.checked = false;
            checkbox.indeterminate = true;
            nodeEl.classList.add('partial');
            nodeEl.classList.remove('selected');
        } else {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            nodeEl.classList.remove('selected', 'partial');
        }
    });
}

// 渲染懒加载资产树（初始只渲染用例库层级）
function renderLazyAssetsTree(libraries) {
    if (!libraries || libraries.length === 0) return '';

    const htmlParts = libraries.map(lib => {
        const hasChildren = lib.hasChildren || lib.caseCount > 0;
        const caseCount = lib.caseCount ? `<span class="tree-case-count">${lib.caseCount.toLocaleString()} 条</span>` : '';

        const selectedCount = window.parentSelectedCounts?.libraries?.[lib.id] || 0;
        const totalCount = lib.caseCount || 0;

        let selectedClass = '';
        let checkedAttr = '';
        let dataIndeterminate = '';

        if (totalCount > 0 && selectedCount === totalCount) {
            selectedClass = 'selected';
            checkedAttr = 'checked';
        } else if (selectedCount > 0) {
            selectedClass = 'partial';
            dataIndeterminate = 'true';
        }

        return `
            <div class="tree-node ${selectedClass}" 
                 id="node-lib-${lib.id}"
                 data-id="${lib.id}" 
                 data-level="1" 
                 data-type="library"
                 data-loaded="false"
                 data-case-count="${lib.caseCount || 0}">
                <div class="tree-node-content">
                    ${hasChildren ? '<span class="tree-expand-icon" onclick="event.stopPropagation(); toggleLazyTreeNode(this)">▶</span>' : '<span class="tree-expand-icon" style="visibility: hidden;">▶</span>'}
                    <input type="checkbox" 
                           class="tree-checkbox" 
                           data-node-id="${lib.id}" 
                           data-level="1"
                           data-indeterminate="${dataIndeterminate}"
                           ${checkedAttr}>
                    <span class="tree-icon">📚</span>
                    <span class="tree-label" onclick="event.stopPropagation(); toggleLazyTreeNode(this)">${lib.name}</span>
                    ${caseCount}
                </div>
                <div class="tree-children" style="display: none;"></div>
            </div>
        `;
    });

    setTimeout(() => {
        document.querySelectorAll('.tree-checkbox[data-indeterminate="true"]').forEach(checkbox => {
            checkbox.indeterminate = true;
        });
    }, 0);

    return htmlParts.join('');
}

// 懒加载展开节点
async function toggleLazyTreeNode(element) {
    const nodeContent = element.closest('.tree-node-content') || element.parentElement;
    const node = nodeContent.parentElement;
    const expandIcon = nodeContent.querySelector('.tree-expand-icon');
    const childrenContainer = node.querySelector('.tree-children');

    const nodeId = node.dataset.id;
    const nodeLevel = parseInt(node.dataset.level);
    const nodeType = node.dataset.type;
    const isLoaded = node.dataset.loaded === 'true';
    const isExpanded = node.classList.contains('expanded');

    if (isExpanded) {
        // 收起
        node.classList.remove('expanded');
        childrenContainer.style.display = 'none';
        expandIcon.textContent = '▶';
    } else {
        // 展开
        node.classList.add('expanded');
        childrenContainer.style.display = 'block';
        expandIcon.textContent = '▼';

        // 如果还没有加载子节点，则懒加载
        if (!isLoaded) {
            childrenContainer.innerHTML = '<div class="tree-loading" style="padding: 8px 16px;"><span>加载中...</span></div>';

            try {
                let levelParam = '';
                switch (nodeLevel) {
                    case 1: levelParam = 'modules'; break;
                    case 2: levelParam = 'level1points'; break;
                    case 3: levelParam = 'cases'; break;
                }

                const response = await apiRequest(`/testassets/tree?level=${levelParam}&parent_id=${nodeId}`);

                if (response.success && response.tree) {
                    const childrenHtml = renderLazyTreeChildren(response.tree, nodeLevel + 1);
                    childrenContainer.innerHTML = childrenHtml;
                    node.dataset.loaded = 'true';

                    // 加载完子节点后，更新勾选状态（编辑模式时）
                    if (window.selectedCases.size > 0) {
                        // 更新当前节点的子节点勾选状态
                        updateChildrenCheckboxStates(node);
                        // 向上更新父节点勾选状态
                        updateParentCheckboxStatesUpward(node);
                    }
                } else {
                    childrenContainer.innerHTML = '<div class="tree-loading"><span>加载失败</span></div>';
                }
            } catch (error) {
                console.error('懒加载子节点失败:', error);
                childrenContainer.innerHTML = '<div class="tree-loading"><span>加载失败</span></div>';
            }
        } else {
            // 已加载的节点，展开时也需要更新勾选状态
            if (window.selectedCases.size > 0) {
                updateChildrenCheckboxStates(node);
                updateParentCheckboxStatesUpward(node);
            }
        }
    }
}

// 更新子节点的勾选状态
function updateChildrenCheckboxStates(parentNode) {
    const childrenCheckboxes = parentNode.querySelectorAll(':scope > .tree-children > .tree-node > .tree-node-content > .tree-checkbox');

    childrenCheckboxes.forEach(checkbox => {
        const nodeEl = checkbox.closest('.tree-node');
        let nodeId = nodeEl.dataset.id;
        nodeId = typeof nodeId === 'string' ? parseInt(nodeId) : nodeId;
        const nodeLevel = parseInt(nodeEl.dataset.level);
        const nodeCaseCount = parseInt(nodeEl.dataset.caseCount || 0);

        if (nodeLevel === 4) {
            const isSelected = window.selectedCases && window.selectedCases.has(nodeId);
            checkbox.checked = isSelected;
            checkbox.indeterminate = false;

            if (isSelected) {
                nodeEl.classList.add('selected');
                nodeEl.classList.remove('partial');
            } else {
                nodeEl.classList.remove('selected', 'partial');
            }
        } else if (nodeLevel === 3) {
            const selectedCount = window.parentSelectedCounts?.level1Points?.[nodeId] || 0;
            const totalCount = nodeCaseCount;

            if (totalCount > 0 && selectedCount === totalCount) {
                checkbox.checked = true;
                checkbox.indeterminate = false;
                nodeEl.classList.add('selected');
                nodeEl.classList.remove('partial');
            } else if (selectedCount > 0) {
                checkbox.checked = false;
                checkbox.indeterminate = true;
                nodeEl.classList.add('partial');
                nodeEl.classList.remove('selected');
            } else {
                checkbox.checked = false;
                checkbox.indeterminate = false;
                nodeEl.classList.remove('selected', 'partial');
            }
        } else if (nodeLevel === 2) {
            const selectedCount = window.parentSelectedCounts?.modules?.[nodeId] || 0;
            const totalCount = nodeCaseCount;

            if (totalCount > 0 && selectedCount === totalCount) {
                checkbox.checked = true;
                checkbox.indeterminate = false;
                nodeEl.classList.add('selected');
                nodeEl.classList.remove('partial');
            } else if (selectedCount > 0) {
                checkbox.checked = false;
                checkbox.indeterminate = true;
                nodeEl.classList.add('partial');
                nodeEl.classList.remove('selected');
            } else {
                checkbox.checked = false;
                checkbox.indeterminate = false;
                nodeEl.classList.remove('selected', 'partial');
            }
        } else if (nodeLevel === 1) {
            const selectedCount = window.parentSelectedCounts?.libraries?.[nodeId] || 0;
            const totalCount = nodeCaseCount;

            if (totalCount > 0 && selectedCount === totalCount) {
                checkbox.checked = true;
                checkbox.indeterminate = false;
                nodeEl.classList.add('selected');
                nodeEl.classList.remove('partial');
            } else if (selectedCount > 0) {
                checkbox.checked = false;
                checkbox.indeterminate = true;
                nodeEl.classList.add('partial');
                nodeEl.classList.remove('selected');
            } else {
                checkbox.checked = false;
                checkbox.indeterminate = false;
                nodeEl.classList.remove('selected', 'partial');
            }
        }
    });
}

// 向上更新父节点勾选状态（数据驱动版本）
function updateParentCheckboxStatesUpward(nodeElement) {
    let currentNode = nodeElement.parentElement?.closest('.tree-node');

    while (currentNode) {
        const checkbox = currentNode.querySelector(':scope > .tree-node-content > .tree-checkbox');
        if (!checkbox) break;

        const nodeId = parseInt(currentNode.dataset.id);
        const nodeLevel = parseInt(currentNode.dataset.level);
        const nodeCaseCount = parseInt(currentNode.dataset.caseCount || 0);

        const selectedCount = getSelectedCountForLevel(nodeLevel, nodeId);

        if (nodeCaseCount > 0 && selectedCount === nodeCaseCount) {
            checkbox.checked = true;
            checkbox.indeterminate = false;
            currentNode.classList.add('selected');
            currentNode.classList.remove('partial');
        } else if (selectedCount > 0) {
            checkbox.checked = false;
            checkbox.indeterminate = true;
            currentNode.classList.add('partial');
            currentNode.classList.remove('selected');
        } else {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            currentNode.classList.remove('selected', 'partial');
        }

        currentNode = currentNode.parentElement?.closest('.tree-node');
    }
}

// 渲染懒加载子节点
function renderLazyTreeChildren(nodes, level) {
    if (!nodes || nodes.length === 0) return '<div style="padding: 8px 16px; color: #999;">暂无数据</div>';

    const icons = {
        1: '📚',
        2: '📦',
        3: '📁',
        4: '📄'
    };

    const levelPrefix = {
        1: 'lib',
        2: 'mod',
        3: 'point',
        4: 'case'
    };

    const htmlParts = [];

    nodes.forEach(node => {
        const hasChildren = node.hasChildren || (node.caseCount && node.caseCount > 0);
        const icon = icons[level] || '📄';
        const prefix = levelPrefix[level] || 'node';
        const isCase = level === 4;
        const caseCountDisplay = !isCase && node.caseCount ? `<span class="tree-case-count">${node.caseCount.toLocaleString()} 条</span>` : '';

        const nodeId = typeof node.id === 'string' ? parseInt(node.id) : node.id;
        let selectedClass = '';
        let checkedAttr = '';
        let dataIndeterminate = '';

        if (isCase) {
            const isSelected = window.selectedCases && window.selectedCases.has(nodeId);
            selectedClass = isSelected ? 'selected' : '';
            checkedAttr = isSelected ? 'checked' : '';
        } else {
            const selectedCount = getSelectedCountForLevel(level, nodeId);
            const totalCount = node.caseCount || 0;

            if (totalCount > 0 && selectedCount === totalCount) {
                selectedClass = 'selected';
                checkedAttr = 'checked';
            } else if (selectedCount > 0) {
                selectedClass = 'partial';
                dataIndeterminate = 'true';
            }
        }

        htmlParts.push(`
            <div class="tree-node ${selectedClass}" 
                 id="node-${prefix}-${node.id}"
                 data-id="${node.id}" 
                 data-level="${level}" 
                 data-type="${node.type || ''}"
                 data-loaded="${isCase ? 'true' : 'false'}"
                 data-case-count="${node.caseCount || 0}">
                <div class="tree-node-content">
                    ${hasChildren ? '<span class="tree-expand-icon" onclick="event.stopPropagation(); toggleLazyTreeNode(this)">▶</span>' : '<span class="tree-expand-icon" style="visibility: hidden;">▶</span>'}
                    <input type="checkbox" 
                           class="tree-checkbox" 
                           data-node-id="${node.id}" 
                           data-level="${level}"
                           data-indeterminate="${dataIndeterminate}"
                           ${checkedAttr}>
                    <span class="tree-icon">${icon}</span>
                    <span class="tree-label" ${isCase ? `onclick="event.stopPropagation(); viewCaseReadonlyDetail(${node.id})"` : 'onclick="event.stopPropagation(); toggleLazyTreeNode(this)"'}>${node.name}</span>
                    ${caseCountDisplay}
                    ${isCase && node.priority ? `<span class="tree-priority-badge priority-${node.priority}">${getPriorityText(node.priority)}</span>` : ''}
                </div>
                ${hasChildren ? '<div class="tree-children" style="display: none;"></div>' : ''}
            </div>
        `);
    });

    setTimeout(() => {
        document.querySelectorAll('.tree-checkbox[data-indeterminate="true"]').forEach(checkbox => {
            checkbox.indeterminate = true;
        });
    }, 0);

    return htmlParts.join('');
}

// 获取指定层级的选中计数
function getSelectedCountForLevel(level, nodeId) {
    if (!window.parentSelectedCounts) return 0;

    switch (level) {
        case 1:
            return window.parentSelectedCounts.libraries?.[nodeId] || 0;
        case 2:
            return window.parentSelectedCounts.modules?.[nodeId] || 0;
        case 3:
            return window.parentSelectedCounts.level1Points?.[nodeId] || 0;
        default:
            return 0;
    }
}

// 渲染资产树（四级结构）
// 性能优化：使用层级前缀避免ID冲突，支持10000+用例
function renderAssetsTree(tree, level = 1) {
    if (!tree || tree.length === 0) return '';

    const icons = {
        1: '📚',  // 用例库
        2: '📦',  // 模块
        3: '📁',  // 一级测试点
        4: '📄'   // 测试用例
    };

    // 层级前缀映射（解决ID冲突问题）
    const levelPrefix = {
        1: 'lib',
        2: 'mod',
        3: 'point',
        4: 'case'
    };

    // 第一级（用例库）默认展开
    const defaultExpanded = level === 1 ? 'expanded' : '';
    const prefix = levelPrefix[level] || 'node';

    return tree.map(node => {
        const hasChildren = node.children && node.children.length > 0;
        const icon = icons[level] || '📄';
        const isCase = level === 4;
        const checkboxId = `chk-${prefix}-${node.id}`;

        // 统计用例数量（用于显示）
        let caseCount = '';
        if (!isCase && hasChildren) {
            const count = countAllCases(node);
            caseCount = `<span class="tree-case-count">${count} 条</span>`;
        }

        // 存储用例ID列表（用于级联选择时的快速访问）
        let caseIdsAttr = '';
        if (!isCase) {
            const allCaseIds = getAllCaseIds(node);
            caseIdsAttr = `data-case-ids="${allCaseIds.join(',')}"`;
        }

        return `
            <div class="tree-node ${defaultExpanded}" 
                 id="node-${prefix}-${node.id}"
                 data-id="${node.id}" 
                 data-level="${level}" 
                 data-type="${node.type || ''}"
                 ${caseIdsAttr}>
                <div class="tree-node-content">
                    ${hasChildren ? '<span class="tree-expand-icon" onclick="event.stopPropagation(); toggleTreeNodeExpand(this)">▶</span>' : '<span class="tree-expand-icon" style="visibility: hidden;">▶</span>'}
                    <input type="checkbox" 
                           id="${checkboxId}" 
                           class="tree-checkbox" 
                           data-node-id="${node.id}" 
                           data-level="${level}">
                    <span class="tree-icon">${icon}</span>
                    <span class="tree-label" ${isCase ? `onclick="event.stopPropagation(); viewCaseReadonlyDetail(${node.id})"` : 'onclick="event.stopPropagation(); toggleTreeNodeExpand(this)"'}>${node.name}</span>
                    ${caseCount}
                </div>
                ${hasChildren ? `<div class="tree-children">${renderAssetsTree(node.children, level + 1)}</div>` : ''}
            </div>
        `;
    }).join('');
}

// 获取节点下所有用例ID（用于级联选择的快速访问）
// 性能优化：递归收集ID，避免DOM查询
function getAllCaseIds(node) {
    // 检查是否是用例节点（level=4 或 type='case'）
    if (node.level === 4 || node.type === 'case') {
        return [node.id];
    }
    // 检查是否有子节点
    if (!node.children || node.children.length === 0) {
        return [];
    }
    // 递归收集所有子节点的用例ID
    return node.children.flatMap(child => getAllCaseIds(child));
}

// 统计节点下所有用例数
function countAllCases(node) {
    if (node.level === 4 || node.type === 'case') return 1;
    if (!node.children || node.children.length === 0) return 0;
    return node.children.reduce((sum, child) => sum + countAllCases(child), 0);
}

// 绑定资产树事件（使用事件委托优化性能）
// 性能优化：只在根容器绑定一个事件，支持10000+节点
function bindAssetsTreeEvents() {
    const treeContainer = document.getElementById('test-assets-tree');
    if (!treeContainer) {
        console.warn('资产树容器不存在');
        return;
    }

    // 移除旧的事件监听器（避免重复绑定）
    treeContainer.removeEventListener('change', handleTreeCheckboxChangeEvent);

    // 使用事件委托：只在根容器绑定change事件
    treeContainer.addEventListener('change', handleTreeCheckboxChangeEvent);

    console.log('资产树事件绑定完成（事件委托模式）');
}

// 事件委托处理函数
function handleTreeCheckboxChangeEvent(event) {
    if (event.target.classList.contains('tree-checkbox')) {
        // 阻止事件冒泡，避免重复处理
        event.stopPropagation();
        handleTreeCheckboxChange(event.target);
    }
}

// 切换节点展开/折叠
function toggleTreeNodeExpand(element) {
    const node = element.closest('.tree-node');
    if (!node) return;
    node.classList.toggle('expanded');
}

// 核心交互：处理Checkbox状态变化
// 支持懒加载模式：如果子节点未加载，先加载再选择
async function handleTreeCheckboxChange(checkbox) {
    const nodeId = parseInt(checkbox.dataset.nodeId);
    const level = parseInt(checkbox.dataset.level);
    const nodeElement = checkbox.closest('.tree-node');

    if (!nodeElement || isNaN(nodeId)) {
        return;
    }

    const isChecked = checkbox.checked;

    if (level === 4) {
        handleCaseSelection(nodeId, isChecked, nodeElement);

        if (isChecked) {
            nodeElement.classList.add('selected');
            nodeElement.classList.remove('partial');
        } else {
            nodeElement.classList.remove('selected');
            nodeElement.classList.remove('partial');
        }
    } else {
        // 上三级 - 级联选择所有子用例（可能需要先加载）
        await handleParentSelection(nodeElement, isChecked);
    }

    // 向上冒泡更新父节点状态
    updateParentCheckboxStates(nodeElement);

    // 更新选中计数
    updateCaseCount();
}

// 处理用例选择（底层节点）
function handleCaseSelection(caseId, isSelected, nodeElement) {
    if (isSelected) {
        window.selectedCases.add(caseId);
    } else {
        window.selectedCases.delete(caseId);
    }

    // 更新父节点选中计数
    updateParentSelectedCountsForCase(caseId, isSelected, nodeElement);
}

// 更新用例对应的父节点选中计数
function updateParentSelectedCountsForCase(caseId, isSelected, nodeElement) {
    if (!window.parentSelectedCounts) {
        window.parentSelectedCounts = {
            libraries: {},
            modules: {},
            level1Points: {}
        };
    }

    // 从 DOM 中向上查找父节点
    let currentNode = nodeElement;
    const parentIds = {
        library: null,
        module: null,
        level1: null
    };

    while (currentNode) {
        const level = parseInt(currentNode.dataset.level);
        const id = parseInt(currentNode.dataset.id);

        if (level === 1) parentIds.library = id;
        else if (level === 2) parentIds.module = id;
        else if (level === 3) parentIds.level1 = id;

        currentNode = currentNode.parentElement?.closest('.tree-node');
    }

    // 更新计数
    if (parentIds.library) {
        const current = window.parentSelectedCounts.libraries[parentIds.library] || 0;
        window.parentSelectedCounts.libraries[parentIds.library] = isSelected ? current + 1 : Math.max(0, current - 1);
    }
    if (parentIds.module) {
        const current = window.parentSelectedCounts.modules[parentIds.module] || 0;
        window.parentSelectedCounts.modules[parentIds.module] = isSelected ? current + 1 : Math.max(0, current - 1);
    }
    if (parentIds.level1) {
        const current = window.parentSelectedCounts.level1Points[parentIds.level1] || 0;
        window.parentSelectedCounts.level1Points[parentIds.level1] = isSelected ? current + 1 : Math.max(0, current - 1);
    }
}

// 处理父节点选择（级联选择）
// 懒加载模式：不递归加载所有子节点，而是记录选中状态
async function handleParentSelection(nodeElement, isSelected) {
    const caseIdsAttr = nodeElement.dataset.caseIds;
    const isLoaded = nodeElement.dataset.loaded === 'true';
    const caseCount = parseInt(nodeElement.dataset.caseCount || '0');

    // 如果已有 caseIds，直接使用
    if (caseIdsAttr && caseIdsAttr.trim() !== '') {
        const caseIds = caseIdsAttr.split(',')
            .map(id => parseInt(id.trim()))
            .filter(id => !isNaN(id) && id > 0);

        if (caseIds.length > 0) {
            // 批量更新状态
            if (isSelected) {
                caseIds.forEach(id => window.selectedCases.add(id));
            } else {
                caseIds.forEach(id => window.selectedCases.delete(id));
            }

            // 更新当前节点样式
            if (isSelected) {
                nodeElement.classList.add('selected');
                nodeElement.classList.remove('partial');
            } else {
                nodeElement.classList.remove('selected');
                nodeElement.classList.remove('partial');
            }

            // 更新所有子节点的Checkbox视觉状态
            updateChildrenCheckboxStates(nodeElement, isSelected);
            return;
        }
    }

    // 检查是否已有子节点（已展开但未收集 caseIds）
    const childrenContainer = nodeElement.querySelector('.tree-children');
    if (childrenContainer && childrenContainer.children.length > 0) {
        // 已有子节点，直接更新子节点 checkbox 状态
        // 递归处理所有子节点
        const childNodes = childrenContainer.querySelectorAll(':scope > .tree-node');

        for (const childNode of childNodes) {
            const childCheckbox = childNode.querySelector('.tree-node-content > .tree-checkbox');
            const childLevel = parseInt(childNode.dataset.level);

            if (childCheckbox) {
                // 更新 checkbox 状态
                childCheckbox.checked = isSelected;
                childCheckbox.indeterminate = false;

                // 更新节点样式
                if (isSelected) {
                    childNode.classList.add('selected');
                    childNode.classList.remove('partial');
                } else {
                    childNode.classList.remove('selected');
                    childNode.classList.remove('partial');
                }

                // 如果子节点不是用例，递归处理
                if (childLevel !== 4) {
                    await handleParentSelection(childNode, isSelected);
                } else {
                    // 第四级是用例，更新 selectedCases
                    const caseId = parseInt(childNode.dataset.id);
                    if (!isNaN(caseId)) {
                        if (isSelected) {
                            window.selectedCases.add(caseId);
                        } else {
                            window.selectedCases.delete(caseId);
                        }
                    }
                }
            }
        }

        // 更新当前节点样式
        if (isSelected) {
            nodeElement.classList.add('selected');
            nodeElement.classList.remove('partial');
        } else {
            nodeElement.classList.remove('selected');
            nodeElement.classList.remove('partial');
        }

        return;
    }

    // 懒加载模式：子节点未加载
    // 策略：只加载直接子节点，不递归加载所有后代
    if (!isLoaded && caseCount > 0) {
        if (childrenContainer) {
            childrenContainer.innerHTML = '<div class="tree-loading" style="padding: 8px 16px;"><span>加载中...</span></div>';
            childrenContainer.style.display = 'block';
            nodeElement.classList.add('expanded');
            const expandIcon = nodeElement.querySelector('.tree-expand-icon');
            if (expandIcon) expandIcon.textContent = '▼';
        }

        // 只加载直接子节点
        await loadDirectChildrenOnly(nodeElement, isSelected);
    } else {
        // 没有子节点，更新样式
        updateSingleNodeStyle(nodeElement, isSelected);
    }
}

// 只加载直接子节点（不递归）
async function loadDirectChildrenOnly(nodeElement, isSelected) {
    const nodeId = nodeElement.dataset.id;
    const nodeLevel = parseInt(nodeElement.dataset.level);
    const childrenContainer = nodeElement.querySelector('.tree-children');

    if (!childrenContainer) return;

    let levelParam = '';
    switch (nodeLevel) {
        case 1: levelParam = 'modules'; break;
        case 2: levelParam = 'level1points'; break;
        case 3: levelParam = 'cases'; break;
    }

    try {
        const response = await apiRequest(`/testassets/tree?level=${levelParam}&parent_id=${nodeId}`);

        if (response.success && response.tree) {
            const children = response.tree;
            const childrenHtml = renderLazyTreeChildren(children, nodeLevel + 1);
            childrenContainer.innerHTML = childrenHtml;
            nodeElement.dataset.loaded = 'true';

            // 如果是测试点层级（level 3），子节点是用例
            if (nodeLevel === 3) {
                const caseIds = children.map(c => c.id);
                nodeElement.dataset.caseIds = caseIds.join(',');

                // 批量更新选中状态
                if (isSelected) {
                    caseIds.forEach(id => window.selectedCases.add(id));
                } else {
                    caseIds.forEach(id => window.selectedCases.delete(id));
                }

                // 更新当前节点样式
                if (isSelected) {
                    nodeElement.classList.add('selected');
                    nodeElement.classList.remove('partial');
                } else {
                    nodeElement.classList.remove('selected');
                    nodeElement.classList.remove('partial');
                }

                // 更新子节点 checkbox 状态
                updateChildrenCheckboxStates(nodeElement, isSelected);
            } else {
                // 非测试点层级，子节点是模块或测试点
                // 更新当前节点样式
                if (isSelected) {
                    nodeElement.classList.add('selected');
                    nodeElement.classList.remove('partial');
                } else {
                    nodeElement.classList.remove('selected');
                    nodeElement.classList.remove('partial');
                }

                // 对于每个子节点，如果需要选中，递归处理
                if (isSelected) {
                    const childNodes = childrenContainer.querySelectorAll(':scope > .tree-node');
                    for (const childNode of childNodes) {
                        // 如果子节点有子节点，继续加载
                        const childCaseCount = parseInt(childNode.dataset.caseCount || '0');
                        if (childCaseCount > 0) {
                            await loadDirectChildrenOnly(childNode, isSelected);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('加载子节点失败:', error);
        childrenContainer.innerHTML = '<div class="tree-loading"><span>加载失败</span></div>';
    }
}

// 更新单个节点样式（用于空子节点的边缘场景）
function updateSingleNodeStyle(nodeElement, isSelected) {
    if (isSelected) {
        nodeElement.classList.add('selected');
        nodeElement.classList.remove('partial');
    } else {
        nodeElement.classList.remove('selected');
        nodeElement.classList.remove('partial');
    }
}

// 更新子节点的Checkbox状态
// 性能优化：批量DOM操作，使用querySelectorAll
function updateChildrenCheckboxStates(parentNode, isChecked) {
    const childCheckboxes = parentNode.querySelectorAll('.tree-checkbox');

    // 批量更新DOM（减少重排重绘）
    childCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        checkbox.indeterminate = false;

        // 更新节点样式
        const node = checkbox.closest('.tree-node');
        if (node) {
            if (isChecked) {
                node.classList.add('selected');
                node.classList.remove('partial');
            } else {
                node.classList.remove('selected');
                node.classList.remove('partial');
            }
        }
    });
}

// 向上冒泡更新父节点Checkbox状态（支持半选状态）
// 懒加载模式：如果没有 caseIds，则检查子节点的 checkbox 状态
function updateParentCheckboxStates(nodeElement) {
    let currentNode = nodeElement.parentElement?.closest('.tree-node');

    while (currentNode) {
        const checkbox = currentNode.querySelector(':scope > .tree-node-content > .tree-checkbox');

        if (!checkbox) {
            currentNode = currentNode.parentElement?.closest('.tree-node');
            continue;
        }

        // 策略1：使用 caseIds 计算（如果有）
        const caseIdsAttr = currentNode.dataset.caseIds;

        if (caseIdsAttr && caseIdsAttr.trim() !== '') {
            const allCaseIds = caseIdsAttr.split(',')
                .map(id => parseInt(id.trim()))
                .filter(id => !isNaN(id) && id > 0);

            if (allCaseIds.length > 0) {
                let selectedCount = 0;
                for (const caseId of allCaseIds) {
                    if (window.selectedCases.has(caseId)) {
                        selectedCount++;
                    }
                }

                updateCheckboxByCount(checkbox, currentNode, selectedCount, allCaseIds.length);
                currentNode = currentNode.parentElement?.closest('.tree-node');
                continue;
            }
        }

        // 策略2：递归检查所有后代节点的 checkbox 状态
        const childrenContainer = currentNode.querySelector(':scope > .tree-children');
        if (childrenContainer) {
            // 获取所有四级用例节点的 checkbox
            const allCaseCheckboxes = currentNode.querySelectorAll('.tree-node[data-level="4"] > .tree-node-content > .tree-checkbox');

            if (allCaseCheckboxes.length > 0) {
                let checkedCount = 0;

                allCaseCheckboxes.forEach(cb => {
                    if (cb.checked && !cb.indeterminate) {
                        checkedCount++;
                    }
                });

                const total = allCaseCheckboxes.length;

                updateCheckboxByCount(checkbox, currentNode, checkedCount, total);
            } else {
                // 如果没有四级节点，检查直接子节点的状态
                const childCheckboxes = childrenContainer.querySelectorAll(':scope > .tree-node > .tree-node-content > .tree-checkbox');

                if (childCheckboxes.length > 0) {
                    let checkedCount = 0;
                    let indeterminateCount = 0;

                    childCheckboxes.forEach(cb => {
                        if (cb.indeterminate) {
                            indeterminateCount++;
                        } else if (cb.checked) {
                            checkedCount++;
                        }
                    });

                    const total = childCheckboxes.length;

                    if (indeterminateCount > 0 || (checkedCount > 0 && checkedCount < total)) {
                        // 半选
                        checkbox.checked = false;
                        checkbox.indeterminate = true;
                        currentNode.classList.remove('selected');
                        currentNode.classList.add('partial');
                    } else if (checkedCount === total) {
                        // 全选
                        checkbox.checked = true;
                        checkbox.indeterminate = false;
                        currentNode.classList.add('selected');
                        currentNode.classList.remove('partial');
                    } else {
                        // 未选
                        checkbox.checked = false;
                        checkbox.indeterminate = false;
                        currentNode.classList.remove('selected', 'partial');
                    }
                }
            }
        }

        currentNode = currentNode.parentElement?.closest('.tree-node');
    }
}

// 根据 count 更新 checkbox 状态
function updateCheckboxByCount(checkbox, nodeElement, selectedCount, totalCount) {
    if (selectedCount === 0) {
        checkbox.checked = false;
        checkbox.indeterminate = false;
        nodeElement.classList.remove('selected', 'partial');
    } else if (selectedCount === totalCount) {
        checkbox.checked = true;
        checkbox.indeterminate = false;
        nodeElement.classList.add('selected');
        nodeElement.classList.remove('partial');
    } else {
        checkbox.checked = false;
        checkbox.indeterminate = true;
        nodeElement.classList.remove('selected');
        nodeElement.classList.add('partial');
    }
}

// 初始化树的选中状态（根据selectedCases Set）
// 性能优化：只在初始化时调用，避免频繁DOM操作
function initializeTreeSelectionState() {
    if (window.selectedCases.size === 0) return;

    const treeContainer = document.getElementById('test-assets-tree');
    if (!treeContainer) return;

    // 更新所有用例节点的Checkbox
    const caseCheckboxes = treeContainer.querySelectorAll('.tree-checkbox[data-level="4"]');
    caseCheckboxes.forEach(checkbox => {
        const caseId = parseInt(checkbox.dataset.nodeId);
        if (isNaN(caseId)) return;

        checkbox.checked = window.selectedCases.has(caseId);

        const node = checkbox.closest('.tree-node');
        if (node) {
            if (window.selectedCases.has(caseId)) {
                node.classList.add('selected');
            } else {
                node.classList.remove('selected');
            }
        }
    });

    // 更新所有父节点的状态
    const parentNodes = treeContainer.querySelectorAll('.tree-node[data-level="1"], .tree-node[data-level="2"], .tree-node[data-level="3"]');
    parentNodes.forEach(parentNode => {
        updateParentCheckboxStates(parentNode);
    });
}

// 展开所有资产（懒加载模式：只展开已加载的节点）
async function expandAllAssets() {
    const treeContainer = document.getElementById('test-assets-tree');
    if (!treeContainer) return;

    // 递归展开所有节点
    async function expandNode(node) {
        const isLoaded = node.dataset.loaded === 'true';
        const caseCount = parseInt(node.dataset.caseCount || '0');
        const level = parseInt(node.dataset.level);

        // 如果有子节点但未加载，先加载
        if (!isLoaded && caseCount > 0 && level < 4) {
            const nodeId = node.dataset.id;
            let levelParam = '';
            switch (level) {
                case 1: levelParam = 'modules'; break;
                case 2: levelParam = 'level1points'; break;
                case 3: levelParam = 'cases'; break;
            }

            try {
                const response = await apiRequest(`/testassets/tree?level=${levelParam}&parent_id=${nodeId}`);
                if (response.success && response.tree) {
                    const childrenContainer = node.querySelector('.tree-children');
                    if (childrenContainer) {
                        childrenContainer.innerHTML = renderLazyTreeChildren(response.tree, level + 1);
                        node.dataset.loaded = 'true';
                    }
                }
            } catch (error) {
                console.error('展开节点失败:', error);
            }
        }

        // 展开节点
        node.classList.add('expanded');
        const childrenContainer = node.querySelector('.tree-children');
        if (childrenContainer) {
            childrenContainer.style.display = 'block';
        }
        const expandIcon = node.querySelector('.tree-expand-icon');
        if (expandIcon) {
            expandIcon.textContent = '▼';
        }

        // 递归展开子节点
        if (childrenContainer) {
            const childNodes = childrenContainer.querySelectorAll(':scope > .tree-node');
            for (const childNode of childNodes) {
                await expandNode(childNode);
            }
        }
    }

    const rootNodes = treeContainer.querySelectorAll(':scope > .tree-node');
    for (const node of rootNodes) {
        await expandNode(node);
    }
}

// 折叠所有资产
function collapseAllAssets() {
    const treeContainer = document.getElementById('test-assets-tree');
    if (!treeContainer) return;

    treeContainer.querySelectorAll('.tree-node').forEach(node => {
        node.classList.remove('expanded');
        const childrenContainer = node.querySelector('.tree-children');
        if (childrenContainer) {
            childrenContainer.style.display = 'none';
        }
        const expandIcon = node.querySelector('.tree-expand-icon');
        if (expandIcon) {
            expandIcon.textContent = '▶';
        }
    });
}

// 全选资产（懒加载模式：先加载所有节点再选择）
async function selectAllAssets() {
    // 先展开所有节点（会自动加载）
    await expandAllAssets();

    // 然后选择所有用例
    const treeContainer = document.getElementById('test-assets-tree');
    if (!treeContainer) return;

    treeContainer.querySelectorAll('.tree-checkbox[data-level="4"]').forEach(checkbox => {
        const caseId = parseInt(checkbox.dataset.nodeId);
        if (!isNaN(caseId) && !window.selectedCases.has(caseId)) {
            window.selectedCases.add(caseId);
            checkbox.checked = true;
            const node = checkbox.closest('.tree-node');
            if (node) {
                node.classList.add('selected');
            }
        }
    });

    updateCaseCount();

    // 更新所有父节点状态
    treeContainer.querySelectorAll('.tree-node:not([data-level="4"])').forEach(node => {
        updateParentCheckboxStates(node);
    });
}

// 取消全选
function deselectAllAssets() {
    window.selectedCases.clear();
    document.querySelectorAll('.assets-tree .tree-node').forEach(node => {
        node.classList.remove('selected');
        node.classList.remove('partial');
        // 触发change事件确保UI同步
        const checkbox = node.querySelector('.tree-checkbox');
        if (checkbox) {
            checkbox.dispatchEvent(new Event('change'));
        }
    });
    updateCaseCount();
}

// 计算父节点的选中计数（方案B：数据驱动）
function computeParentSelectedCounts(cases) {
    const counts = {
        libraries: {},
        modules: {},
        level1Points: {}
    };

    if (!cases || !Array.isArray(cases)) return counts;

    cases.forEach(c => {
        if (c.library_id) {
            counts.libraries[c.library_id] = (counts.libraries[c.library_id] || 0) + 1;
        }
        if (c.module_id) {
            counts.modules[c.module_id] = (counts.modules[c.module_id] || 0) + 1;
        }
        if (c.level1_id) {
            counts.level1Points[c.level1_id] = (counts.level1Points[c.level1_id] || 0) + 1;
        }
    });

    return counts;
}

// 更新用例数量
function updateCaseCount() {
    const countEl = document.getElementById('selected-case-count');
    if (countEl) {
        countEl.textContent = window.selectedCases.size;
    }
}

// 更新资源树的勾选状态（编辑测试计划时使用）
function updateTreeCheckboxStates() {
    console.log('updateTreeCheckboxStates 被调用, window.selectedCases.size:', window.selectedCases.size);

    // 获取所有四级用例节点
    const level4Nodes = document.querySelectorAll('#test-assets-tree .tree-node[data-level="4"]');

    console.log('找到四级节点数量:', level4Nodes.length);

    level4Nodes.forEach(node => {
        let caseId = node.dataset.id;
        caseId = typeof caseId === 'string' ? parseInt(caseId) : caseId;
        const checkbox = node.querySelector(':scope > .tree-node-content > .tree-checkbox');

        if (checkbox && !isNaN(caseId)) {
            const isSelected = window.selectedCases.has(caseId);
            checkbox.checked = isSelected;
            checkbox.indeterminate = false;

            // 更新节点样式
            if (isSelected) {
                node.classList.add('selected');
                node.classList.remove('partial');
            } else {
                node.classList.remove('selected');
                node.classList.remove('partial');
            }

            console.log(`四级节点勾选状态: caseId=${caseId}, isSelected=${isSelected}`);
        }
    });

    // 更新所有父节点的勾选状态
    updateAllParentCheckboxStates();
}

// 更新所有父节点的勾选状态
function updateAllParentCheckboxStates() {
    // 从下往上更新：先更新三级，再二级，最后一级
    const level3Nodes = document.querySelectorAll('#test-assets-tree .tree-node[data-level="3"]');
    const level2Nodes = document.querySelectorAll('#test-assets-tree .tree-node[data-level="2"]');
    const level1Nodes = document.querySelectorAll('#test-assets-tree .tree-node[data-level="1"]');

    // 更新三级节点
    level3Nodes.forEach(node => {
        updateParentCheckboxState(node);
    });

    // 更新二级节点
    level2Nodes.forEach(node => {
        updateParentCheckboxState(node);
    });

    // 更新一级节点
    level1Nodes.forEach(node => {
        updateParentCheckboxState(node);
    });
}

// 更新单个父节点的勾选状态
function updateParentCheckboxState(nodeElement) {
    const checkbox = nodeElement.querySelector(':scope > .tree-node-content > .tree-checkbox');
    if (!checkbox) return;

    const childrenContainer = nodeElement.querySelector(':scope > .tree-children');
    if (!childrenContainer) return;

    // 获取所有四级用例子节点的勾选状态
    const level4Checkboxes = nodeElement.querySelectorAll('.tree-node[data-level="4"] > .tree-node-content > .tree-checkbox');

    if (level4Checkboxes.length === 0) {
        // 如果没有四级节点，检查直接子节点
        const childCheckboxes = childrenContainer.querySelectorAll(':scope > .tree-node > .tree-node-content > .tree-checkbox');

        if (childCheckboxes.length === 0) return;

        let checkedCount = 0;
        let indeterminateCount = 0;

        childCheckboxes.forEach(cb => {
            if (cb.indeterminate) {
                indeterminateCount++;
            } else if (cb.checked) {
                checkedCount++;
            }
        });

        const total = childCheckboxes.length;

        if (indeterminateCount > 0 || (checkedCount > 0 && checkedCount < total)) {
            checkbox.checked = false;
            checkbox.indeterminate = true;
            nodeElement.classList.remove('selected');
            nodeElement.classList.add('partial');
        } else if (checkedCount === total) {
            checkbox.checked = true;
            checkbox.indeterminate = false;
            nodeElement.classList.add('selected');
            nodeElement.classList.remove('partial');
        } else {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            nodeElement.classList.remove('selected', 'partial');
        }
    } else {
        // 有四级节点，根据四级节点状态计算
        let checkedCount = 0;

        level4Checkboxes.forEach(cb => {
            if (cb.checked && !cb.indeterminate) {
                checkedCount++;
            }
        });

        const total = level4Checkboxes.length;

        if (checkedCount === 0) {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            nodeElement.classList.remove('selected', 'partial');
        } else if (checkedCount === total) {
            checkbox.checked = true;
            checkbox.indeterminate = false;
            nodeElement.classList.add('selected');
            nodeElement.classList.remove('partial');
        } else {
            checkbox.checked = false;
            checkbox.indeterminate = true;
            nodeElement.classList.remove('selected');
            nodeElement.classList.add('partial');
        }
    }
}

// 防抖定时器
let filterDebounceTimer = null;

// 筛选资产树（带防抖）
async function filterAssetsTree() {
    // 如果是编辑模式，不执行筛选（避免清空已选中的用例）
    if (window.currentEditingPlanId) {
        console.log('编辑模式：跳过筛选，保留已选中用例');
        return;
    }

    // 清除之前的定时器
    if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer);
    }

    // 设置新的定时器，300ms后执行
    filterDebounceTimer = setTimeout(async () => {
        // 筛选条件改变时，清空选中状态
        window.selectedCases.clear();
        await initAssetsTree();
    }, 300);
}

// 传统精准筛选（带防抖）
async function applyTraditionalFilter() {
    // 如果是编辑模式，不执行筛选（避免清空已选中的用例）
    if (window.currentEditingPlanId) {
        console.log('编辑模式：跳过筛选，保留已选中用例');
        return;
    }

    // 清除之前的定时器
    if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer);
    }

    // 设置新的定时器，300ms后执行
    filterDebounceTimer = setTimeout(async () => {
        // 筛选条件改变时，清空选中状态
        window.selectedCases.clear();

        // 获取筛选参数
        const libraryEl = document.getElementById('filter-library');
        const priorityEl = document.getElementById('filter-priority');
        const methodEl = document.getElementById('filter-method');
        const typeEl = document.getElementById('filter-type');
        const statusEl = document.getElementById('filter-status');

        const libraryId = libraryEl ? libraryEl.value : '';
        const priorityId = priorityEl ? priorityEl.value : '';
        const methodId = methodEl ? methodEl.value : '';
        const typeId = typeEl ? typeEl.value : '';
        const statusId = statusEl ? statusEl.value : '';

        // 如果有筛选条件，使用全量加载模式（带限制）
        if (libraryId || priorityId || methodId || typeId || statusId) {
            await initAssetsTreeWithFilters({
                library_id: libraryId,
                priority_id: priorityId,
                method_id: methodId,
                type_id: typeId,
                status_id: statusId
            });
        } else {
            // 没有筛选条件，使用懒加载模式
            await initAssetsTree();
        }
    }, 300);
}

// 带筛选条件的资产树加载
async function initAssetsTreeWithFilters(filters) {
    try {
        const treeContainer = document.getElementById('test-assets-tree');
        if (!treeContainer) return;

        treeContainer.innerHTML = '<div class="tree-loading"><div class="loading-spinner"></div><span>加载资产树...</span></div>';

        // 构建查询参数
        const params = new URLSearchParams();
        if (filters.library_id) params.append('library_id', filters.library_id);
        if (filters.priority_id) params.append('priority_id', filters.priority_id);
        if (filters.method_id) params.append('method_id', filters.method_id);
        if (filters.type_id) params.append('type_id', filters.type_id);
        if (filters.status_id) params.append('status_id', filters.status_id);

        const url = `/testassets/tree?${params.toString()}`;
        const response = await apiRequest(url);

        if (response.success) {
            assetsTreeData = response.tree || [];

            if (assetsTreeData.length === 0) {
                treeContainer.innerHTML = '<div class="tree-loading"><span>没有符合筛选条件的用例</span></div>';
            } else {
                // 使用全量渲染（筛选结果通常较少）
                const treeHtml = renderAssetsTree(assetsTreeData);
                treeContainer.innerHTML = treeHtml;
            }

            bindAssetsTreeEvents();
            updateCaseCount();
        } else {
            treeContainer.innerHTML = '<div class="tree-loading"><span>加载失败: ' + (response.message || '未知错误') + '</span></div>';
        }
    } catch (error) {
        console.error('加载筛选资产树失败:', error);
        const container = document.getElementById('test-assets-tree');
        if (container) {
            container.innerHTML = '<div class="tree-loading"><span>加载失败: ' + error.message + '</span></div>';
        }
    }
}

// AI智能筛选处理
async function handleAIFilter() {
    const input = document.getElementById('ai-filter-input').value.trim();
    if (!input) {
        showErrorMessage('请输入筛选条件描述');
        return;
    }

    const modelId = document.getElementById('ai-model-select').value;
    const btn = document.getElementById('ai-filter-btn');
    const btnText = btn.querySelector('.btn-text');
    const btnSpinner = btn.querySelector('.btn-spinner');
    const statusText = document.getElementById('ai-status-text');

    // 设置按钮为加载状态（静默Loading，不使用全局遮罩）
    btn.disabled = true;
    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline';
    statusText.style.display = 'inline';

    try {
        const response = await apiRequest('/testplans/ai_parse_filter', {
            method: 'POST',
            body: JSON.stringify({
                query: input,
                modelId: modelId || null,
                model: modelId || null
            })
        });

        if (response.success && response.data) {
            const result = response.data;

            // UI回显 - 自动填充传统筛选器（强制触发change事件）
            applyAIResultToFilter(result);

            // 显示AI解析结果
            showAIResultSummary(result);

            showSuccessMessage('AI解析成功，已自动应用筛选条件');
        } else {
            showErrorMessage('AI解析失败: ' + (response.message || '未知错误'));
        }
    } catch (error) {
        console.error('AI筛选处理错误:', error);
        showErrorMessage('AI筛选处理失败: ' + error.message);
    } finally {
        // 恢复按钮状态
        btn.disabled = false;
        btnText.style.display = 'inline';
        btnSpinner.style.display = 'none';
        statusText.style.display = 'none';
    }
}

// 将AI解析结果应用到筛选器UI（强制触发change事件 - 5个维度，支持文本到ID映射）
function applyAIResultToFilter(result) {
    // 用例库回显（AI可能返回ID或名称）
    if (result.libraryId) {
        const librarySelect = document.getElementById('filter-library');
        if (librarySelect) {
            // 如果是数字直接用，否则尝试查找ID
            const id = typeof result.libraryId === 'number' ? result.libraryId : findIdByName('libraries', result.libraryId);
            if (id) {
                librarySelect.value = id;
                librarySelect.classList.add('ai-highlight');
                setTimeout(() => librarySelect.classList.remove('ai-highlight'), 1000);
                librarySelect.dispatchEvent(new Event('change'));
            }
        }
    }

    // 优先级回显（AI返回名称，需要转换为ID）
    if (result.priorities && result.priorities.length > 0) {
        const prioritySelect = document.getElementById('filter-priority');
        if (prioritySelect) {
            const id = findIdByName('priorities', result.priorities[0]);
            if (id) {
                prioritySelect.value = id;
                prioritySelect.classList.add('ai-highlight');
                setTimeout(() => prioritySelect.classList.remove('ai-highlight'), 1000);
                prioritySelect.dispatchEvent(new Event('change'));
            }
        }
    }

    // 测试方式回显（AI返回名称，需要转换为ID）
    if (result.methods && result.methods.length > 0) {
        const methodSelect = document.getElementById('filter-method');
        if (methodSelect) {
            const id = findIdByName('methods', result.methods[0]);
            if (id) {
                methodSelect.value = id;
                methodSelect.classList.add('ai-highlight');
                setTimeout(() => methodSelect.classList.remove('ai-highlight'), 1000);
                methodSelect.dispatchEvent(new Event('change'));
            }
        }
    }

    // 测试类型回显（AI返回名称，需要转换为ID）
    if (result.types && result.types.length > 0) {
        const typeSelect = document.getElementById('filter-type');
        if (typeSelect) {
            const id = findIdByName('types', result.types[0]);
            if (id) {
                typeSelect.value = id;
                typeSelect.classList.add('ai-highlight');
                setTimeout(() => typeSelect.classList.remove('ai-highlight'), 1000);
                typeSelect.dispatchEvent(new Event('change'));
            }
        }
    }

    // 测试状态回显（AI返回名称，需要转换为ID）
    if (result.statuses && result.statuses.length > 0) {
        const statusSelect = document.getElementById('filter-status');
        if (statusSelect) {
            const id = findIdByName('statuses', result.statuses[0]);
            if (id) {
                statusSelect.value = id;
                statusSelect.classList.add('ai-highlight');
                setTimeout(() => statusSelect.classList.remove('ai-highlight'), 1000);
                statusSelect.dispatchEvent(new Event('change'));
            }
        }
    }
}

// 显示AI解析结果摘要
function showAIResultSummary(result) {
    const parts = [];

    if (result.keywords && result.keywords.length > 0) {
        parts.push(`关键词: ${result.keywords.join(', ')}`);
    }
    if (result.libraryId) {
        const librarySelect = document.getElementById('filter-library');
        if (librarySelect) {
            const selectedOption = librarySelect.options[librarySelect.selectedIndex];
            if (selectedOption && selectedOption.value) {
                parts.push(`用例库: ${selectedOption.text}`);
            }
        }
    }
    if (result.priorities && result.priorities.length > 0) {
        parts.push(`优先级: ${result.priorities.join(', ')}`);
    }
    if (result.methods && result.methods.length > 0) {
        parts.push(`方式: ${result.methods.join(', ')}`);
    }
    if (result.types && result.types.length > 0) {
        parts.push(`类型: ${result.types.join(', ')}`);
    }
    if (result.statuses && result.statuses.length > 0) {
        parts.push(`状态: ${result.statuses.join(', ')}`);
    }
    if (result.modules && result.modules.length > 0) {
        parts.push(`模块: ${result.modules.join(', ')}`);
    }

    if (parts.length > 0) {
        console.log('AI解析结果:', parts.join(' | '));
    }
}

// 清除所有筛选条件
function clearAllFilters() {
    const libraryEl = document.getElementById('filter-library');
    const priorityEl = document.getElementById('filter-priority');
    const methodEl = document.getElementById('filter-method');
    const typeEl = document.getElementById('filter-type');
    const statusEl = document.getElementById('filter-status');
    const aiFilterEl = document.getElementById('ai-filter-input');

    if (libraryEl) libraryEl.value = '';
    if (priorityEl) priorityEl.value = '';
    if (methodEl) methodEl.value = '';
    if (typeEl) typeEl.value = '';
    if (statusEl) statusEl.value = '';
    if (aiFilterEl) aiFilterEl.value = '';

    // 清空选中状态
    window.selectedCases.clear();

    // 重新加载资产树（懒加载模式）
    initAssetsTree();

    showSuccessMessage('筛选条件已清除');
}

// 更新向导步骤
function updateWizardSteps() {
    // 更新步骤指示器
    document.querySelectorAll('.wizard-step').forEach((step, index) => {
        const stepNum = index + 1;
        step.classList.remove('active', 'completed');
        if (stepNum < currentTestPlanStep) {
            step.classList.add('completed');
        } else if (stepNum === currentTestPlanStep) {
            step.classList.add('active');
        }
    });

    // 更新面板显示
    document.querySelectorAll('.wizard-panel').forEach((panel, index) => {
        panel.classList.remove('active');
        if (index + 1 === currentTestPlanStep) {
            panel.classList.add('active');
        }
    });

    // 更新按钮状态
    const prevBtn = document.getElementById('testplan-prev-btn');
    const nextBtn = document.getElementById('testplan-next-btn');
    const submitBtn = document.getElementById('testplan-submit-btn');

    prevBtn.style.display = currentTestPlanStep > 1 ? 'block' : 'none';
    nextBtn.style.display = currentTestPlanStep < 2 ? 'block' : 'none';
    submitBtn.style.display = currentTestPlanStep === 2 ? 'block' : 'none';
}

// 上一步
function prevTestPlanStep() {
    if (currentTestPlanStep > 1) {
        currentTestPlanStep--;
        updateWizardSteps();
    }
}

// 下一步
function nextTestPlanStep() {
    if (!validateCurrentStep()) {
        return;
    }

    if (currentTestPlanStep < 2) {
        currentTestPlanStep++;
        updateWizardSteps();
    }
}

// 验证当前步骤
function validateCurrentStep() {
    switch (currentTestPlanStep) {
        case 1:
            const name = document.getElementById('testplan-name').value.trim();
            const owner = document.getElementById('testplan-owner').value;
            const project = document.getElementById('testplan-project').value;
            const stage = document.getElementById('testplan-stage').value;
            const software = document.getElementById('testplan-software').value;

            if (!name) {
                showErrorMessage('请输入计划名称');
                return false;
            }
            if (!owner) {
                showErrorMessage('请选择负责人');
                return false;
            }
            if (!project) {
                showErrorMessage('请选择所属项目');
                return false;
            }
            if (!stage) {
                showErrorMessage('请选择测试阶段');
                return false;
            }
            if (!software) {
                showErrorMessage('请选择测试软件');
                return false;
            }
            break;

        case 2:
            if (window.selectedCases.size === 0) {
                showErrorMessage('请至少选择一条测试用例');
                return false;
            }
            break;
    }

    return true;
}

// 提交测试计划
async function submitAdvancedTestPlan() {
    if (!validateCurrentStep()) {
        return;
    }

    const isEditMode = !!window.currentEditingPlanId;
    showLoading(isEditMode ? '更新测试计划中...' : '创建测试计划中...');

    try {
        // 基础信息
        const name = document.getElementById('testplan-name').value.trim();
        const project = document.getElementById('testplan-project').value;
        const stage_id = document.getElementById('testplan-stage').value;
        const software_id = document.getElementById('testplan-software').value;
        const iteration = document.getElementById('testplan-iteration').value.trim();
        const startDate = document.getElementById('testplan-start-date').value;
        const endDate = document.getElementById('testplan-end-date').value;
        const description = document.getElementById('testplan-description').value.trim();
        const actualEndTime = document.getElementById('testplan-actual-end-time').value;

        // 筛选条件（新的5个维度）
        const library_id = document.getElementById('filter-library').value;
        const priority_id = document.getElementById('filter-priority').value;
        const method_id = document.getElementById('filter-method').value;
        const type_id = document.getElementById('filter-type').value;
        const status_id = document.getElementById('filter-status').value;

        // 优化：如果用例数量过多，只发送筛选条件，让后端查询
        const hasFilters = library_id || priority_id || method_id || type_id || status_id;
        const caseCount = window.selectedCases.size;
        const MAX_CASES_TO_SEND = 10000; // 最多发送 10000 个用例 ID

        const requestBody = {
            name,
            owner: document.getElementById('testplan-owner').value,
            project,
            stage_id,
            software_id,
            iteration,
            description,
            start_date: startDate || null,
            end_date: endDate || null,
            actual_end_time: actualEndTime || null,
            // 筛选条件
            library_id,
            priority_id,
            method_id,
            type_id,
            status_id
        };

        // 如果有筛选条件且用例数量过多，只发送筛选条件
        // 否则发送用例 ID 数组
        if (hasFilters && caseCount > MAX_CASES_TO_SEND) {
            // 只发送筛选条件，后端会根据筛选条件查询
            console.log(`用例数量 ${caseCount} 超过限制 ${MAX_CASES_TO_SEND}，只发送筛选条件`);
        } else {
            // 发送用例 ID 数组
            requestBody.selectedCases = Array.from(window.selectedCases);
        }

        let response;

        if (isEditMode) {
            // 编辑模式：更新现有计划
            response = await apiRequest(`/testplans/${window.currentEditingPlanId}`, {
                method: 'PUT',
                body: JSON.stringify(requestBody)
            });
        } else {
            // 新建模式：创建新计划
            response = await apiRequest('/testplans/create_with_rules', {
                method: 'POST',
                body: JSON.stringify(requestBody)
            });
        }

        hideLoading();

        if (response.success) {
            showSuccessMessage(isEditMode ? '测试计划更新成功' : `测试计划创建成功，共选择 ${response.caseCount || window.selectedCases.size} 条用例`);
            closeAdvancedTestPlanModal();

            // 清除编辑模式标记
            window.currentEditingPlanId = null;

            if (typeof loadTestPlans === 'function') {
                loadTestPlans();
            }
        } else {
            showErrorMessage((isEditMode ? '更新失败: ' : '创建失败: ') + response.message);
        }

    } catch (error) {
        hideLoading();
        console.error((isEditMode ? '更新测试计划失败:' : '创建测试计划失败:'), error);
        showErrorMessage((isEditMode ? '更新失败: ' : '创建失败: ') + error.message);
    }
}

// 关闭测试计划报告模态框
function closeTestPlanReportModal() {
    document.getElementById('testplan-report-modal').style.display = 'none';
}

// 导出测试计划报告
function exportTestPlanReport() {
    if (!testPlanReportData) {
        showErrorMessage('没有可导出的报告数据');
        return;
    }
    showSuccessMessage('报告导出功能开发中');
}

// ==================== 测试用例只读详情 ====================

// 查看测试用例只读详情
async function viewCaseReadonlyDetail(caseId) {
    showLoading('加载用例详情...');

    try {
        const response = await apiRequest(`/testpoints/detail/${caseId}`);

        if (response.success && response.data) {
            const caseData = response.data;

            // 填充数据
            document.getElementById('case-detail-name').textContent = caseData.name || '-';
            document.getElementById('case-detail-id').textContent = caseData.case_id || '-';

            // 优先级
            const priorityEl = document.getElementById('case-detail-priority');
            priorityEl.textContent = caseData.priority || '-';
            priorityEl.className = 'case-detail-value';
            if (caseData.priority) {
                priorityEl.classList.add('priority-' + caseData.priority.toLowerCase());
            }

            // 执行方式（对应数据库的 method 字段）
            const methodEl = document.getElementById('case-detail-type');
            methodEl.textContent = caseData.method || caseData.type || '-';
            methodEl.className = 'case-detail-value';
            if (caseData.method === '自动化') {
                methodEl.classList.add('type-auto');
            } else if (caseData.method === '手动' || caseData.method === '手工') {
                methodEl.classList.add('type-manual');
            }

            // 前置条件
            document.getElementById('case-detail-precondition').textContent = caseData.precondition || '无';

            // 测试步骤
            document.getElementById('case-detail-steps').textContent = caseData.steps || '无';

            // 预期结果
            document.getElementById('case-detail-expected').textContent = caseData.expected || '无';

            // 创建人和创建时间
            document.getElementById('case-detail-creator').textContent = caseData.creator || '-';
            document.getElementById('case-detail-created').textContent = caseData.created_at || '-';

            // 显示模态框
            document.getElementById('case-readonly-detail-modal').style.display = 'block';
        } else {
            showErrorMessage('获取用例详情失败: ' + (response.message || '未知错误'));
        }
    } catch (error) {
        console.error('获取用例详情错误:', error);
        showErrorMessage('获取用例详情失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

// 关闭测试用例只读详情模态框
function closeCaseReadonlyModal() {
    document.getElementById('case-readonly-detail-modal').style.display = 'none';
}

// 加载项目列表
async function loadProjectsForTestPlan() {
    try {
        const response = await apiRequest('/projects/list');
        const select = document.getElementById('testplan-project');

        if (response.success && response.projects) {
            select.innerHTML = '<option value="">请选择项目</option>' +
                response.projects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        }
    } catch (error) {
        console.error('加载项目列表失败:', error);
    }
}

// 关闭测试计划报告模态框
function closeTestPlanReportModal() {
    document.getElementById('testplan-report-modal').style.display = 'none';
}

// 查看测试计划报告
async function viewTestPlanReport(planId) {
    showLoading('加载报告...');

    try {
        const response = await apiRequest(`/testplans/${planId}/report`);

        if (response.success) {
            testPlanReportData = response;
            renderTestPlanReport(response);
            document.getElementById('testplan-report-modal').style.display = 'block';
        } else {
            showErrorMessage('加载报告失败: ' + response.message);
        }

        hideLoading();
    } catch (error) {
        hideLoading();
        showErrorMessage('加载报告失败: ' + error.message);
    }
}

// 渲染测试计划报告
function renderTestPlanReport(data) {
    const container = document.getElementById('testplan-report-content');

    const statusClass = data.plan.status === 'completed' ? 'completed' :
        data.plan.status === 'running' ? 'running' : 'draft';
    const statusText = data.plan.status === 'completed' ? '已完成' :
        data.plan.status === 'running' ? '执行中' : '草稿';

    container.innerHTML = `
        <div class="report-header">
            <div>
                <div class="report-title">${data.plan.name}</div>
                <div class="report-meta">
                    项目: ${data.plan.project} | 阶段: ${data.plan.test_phase} | 
                    负责人: ${data.plan.owner} | 创建时间: ${formatDateTime(data.plan.created_at)}
                </div>
            </div>
            <div class="report-status ${statusClass}">${statusText}</div>
        </div>
        
        ${data.matrix ? `
        <div class="report-section">
            <div class="report-section-title">🔧 环境基线</div>
            <div class="report-stats-grid">
                <div class="report-stat-card">
                    <div class="report-stat-value">${data.matrix.asic_type || '-'}</div>
                    <div class="report-stat-label">ASIC类型</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value">${data.matrix.sdk_type || '-'}</div>
                    <div class="report-stat-label">SDK类型</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value">${data.matrix.topology || '-'}</div>
                    <div class="report-stat-label">拓扑结构</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value">${data.matrix.sdk_version || '-'}</div>
                    <div class="report-stat-label">SDK版本</div>
                </div>
            </div>
        </div>
        ` : ''}
        
        <div class="report-section">
            <div class="report-section-title">📊 执行统计</div>
            <div class="report-stats-grid">
                <div class="report-stat-card">
                    <div class="report-stat-value">${data.statistics.total_cases}</div>
                    <div class="report-stat-label">总用例数</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value pass">${data.statistics.passed}</div>
                    <div class="report-stat-label">通过</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value fail">${data.statistics.failed}</div>
                    <div class="report-stat-label">失败</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value warning">${data.statistics.blocked}</div>
                    <div class="report-stat-label">阻塞</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value fail">${data.statistics.asic_hang}</div>
                    <div class="report-stat-label">ASIC Hang</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value" style="color: #722ed1;">${data.statistics.core_dump}</div>
                    <div class="report-stat-label">Core Dump</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value warning">${data.statistics.traffic_drop}</div>
                    <div class="report-stat-label">Traffic Drop</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value">${data.statistics.pass_rate}%</div>
                    <div class="report-stat-label">通过率</div>
                </div>
            </div>
        </div>
        
        ${data.pfc_statistics && data.pfc_statistics.total > 0 ? `
        <div class="report-section">
            <div class="report-section-title">⚡ PFC专属测试统计</div>
            <p style="font-size: 13px; color: #666; margin-bottom: 12px;">
                💡 ${data.pfc_statistics.note}
            </p>
            <div class="report-stats-grid">
                <div class="report-stat-card">
                    <div class="report-stat-value">${data.pfc_statistics.total}</div>
                    <div class="report-stat-label">PFC测试数</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value pass">${data.pfc_statistics.passed}</div>
                    <div class="report-stat-label">通过</div>
                </div>
                <div class="report-stat-card">
                    <div class="report-stat-value fail">${data.pfc_statistics.failed}</div>
                    <div class="report-stat-label">失败</div>
                </div>
            </div>
        </div>
        ` : ''}
        
        ${data.failed_cases && data.failed_cases.length > 0 ? `
        <div class="report-section">
            <div class="report-section-title">❌ 失败用例列表</div>
            <table class="config-table">
                <thead>
                    <tr>
                        <th>用例ID</th>
                        <th>用例名称</th>
                        <th>模块</th>
                        <th>状态</th>
                        <th>执行时间</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.failed_cases.map(c => `
                        <tr>
                            <td>${c.case_id || '-'}</td>
                            <td>${c.case_name || '-'}</td>
                            <td>${c.module_name || '-'}</td>
                            <td>${renderHWStatusTag(c.status)}</td>
                            <td>${formatDateTime(c.execution_time) || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}
        
        <div class="report-section" style="font-size: 12px; color: #666;">
            <p><strong>报告生成时间:</strong> ${data.timestamp}</p>
            <p><strong>数据来源:</strong> ${data.sources.database}</p>
            <p><strong>系统版本:</strong> ${data.sources.version}</p>
        </div>
    `;
}

// 渲染硬件特殊状态标签
function renderHWStatusTag(status) {
    const statusMap = {
        'ASIC_Hang': { class: 'asic-hang', text: 'ASIC Hang' },
        'Core_Dump': { class: 'core-dump', text: 'Core Dump' },
        'Traffic_Drop': { class: 'traffic-drop', text: 'Traffic Drop' },
        'Fail': { class: 'asic-hang', text: '失败' },
        'Pass': { class: '', text: '通过' },
        'Block': { class: 'traffic-drop', text: '阻塞' }
    };

    const info = statusMap[status] || { class: '', text: status };

    if (info.class) {
        return `<span class="hw-status-tag ${info.class}">${info.text}</span>`;
    }
    return info.text;
}

// 导出测试计划报告
function exportTestPlanReport() {
    if (!testPlanReportData) {
        showErrorMessage('没有可导出的报告数据');
        return;
    }

    const data = testPlanReportData;
    const reportText = `
测试计划执行报告
================

计划名称: ${data.plan.name}
项目: ${data.plan.project}
阶段: ${data.plan.test_phase}
负责人: ${data.plan.owner}
状态: ${data.plan.status}

环境基线
--------
ASIC类型: ${data.matrix?.asic_type || '-'}
SDK类型: ${data.matrix?.sdk_type || '-'}
拓扑结构: ${data.matrix?.topology || '-'}
SDK版本: ${data.matrix?.sdk_version || '-'}

执行统计
--------
总用例数: ${data.statistics.total_cases}
通过: ${data.statistics.passed}
失败: ${data.statistics.failed}
阻塞: ${data.statistics.blocked}
ASIC Hang: ${data.statistics.asic_hang}
Core Dump: ${data.statistics.core_dump}
Traffic Drop: ${data.statistics.traffic_drop}
通过率: ${data.statistics.pass_rate}%

PFC专属测试
-----------
${data.pfc_statistics ? `
PFC测试数: ${data.pfc_statistics.total}
通过: ${data.pfc_statistics.passed}
失败: ${data.pfc_statistics.failed}
说明: ${data.pfc_statistics.note}
` : '无'}

报告生成时间: ${data.timestamp}
数据来源: ${data.sources.database}
系统版本: ${data.sources.version}
    `.trim();

    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `testplan_report_${data.plan.id}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ========================================
   测试报告页面重构 - JavaScript逻辑
   ======================================== */

// 抽屉状态管理
let drawerState = {
    currentStep: 1,
    selectedDimension: null,
    selectedTarget: null,
    selectedTemplate: null,
    splitOptions: {
        byType: false,
        byPriority: false,
        byMethod: false
    },
    reportName: '',
    reportDesc: '',
    enableAI: true
};

// 异步任务管理
let asyncTasks = [];
let taskPollingInterval = null;

// 打开抽屉
async function openReportDrawer() {
    const overlay = document.getElementById('report-drawer-overlay');
    const drawer = document.getElementById('report-drawer');

    if (overlay && drawer) {
        overlay.classList.add('active');
        drawer.classList.add('active');
        document.body.style.overflow = 'hidden';

        resetDrawerState();
        window.drawerDataLoaded = false;
        
        // 等待数据加载完成后再显示步骤
        const loaded = await loadDrawerData();
        if (loaded) {
            // 重新渲染步骤1的内容
            renderDrawerStep1Content();
            showDrawerStep(1);
        }
    }
}

// 渲染步骤1的内容
function renderDrawerStep1Content() {
    const stepContent = document.getElementById('drawer-step-1');
    if (!stepContent) return;
    
    stepContent.innerHTML = `
        <h3>选择数据维度</h3>
        <p class="step-desc">请选择报告的数据来源维度</p>
        
        <div class="dimension-cards">
            <div class="dimension-card" data-dimension="testplan" onclick="selectDimension('testplan')">
                <div class="dimension-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                    </svg>
                </div>
                <div class="dimension-info">
                    <h4>测试计划</h4>
                    <p>基于测试计划生成报告</p>
                </div>
            </div>
            
            <div class="dimension-card" data-dimension="project" onclick="selectDimension('project')">
                <div class="dimension-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                    </svg>
                </div>
                <div class="dimension-info">
                    <h4>所属项目</h4>
                    <p>基于项目维度生成报告</p>
                </div>
            </div>
            
            <div class="dimension-card" data-dimension="module" onclick="selectDimension('module')">
                <div class="dimension-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 6h16M4 12h16M4 18h16"></path>
                    </svg>
                </div>
                <div class="dimension-info">
                    <h4>指定模块</h4>
                    <p>选择特定模块生成报告</p>
                </div>
            </div>
            
            <div class="dimension-card" data-dimension="library" onclick="selectDimension('library')">
                <div class="dimension-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 19.5A2.5 2.5 0 016.5 17H20"></path>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"></path>
                    </svg>
                </div>
                <div class="dimension-info">
                    <h4>用例库</h4>
                    <p>基于整个用例库生成报告</p>
                </div>
            </div>
        </div>
    `;
}

// 关闭抽屉
function closeReportDrawer() {
    const overlay = document.getElementById('report-drawer-overlay');
    const drawer = document.getElementById('report-drawer');

    if (overlay && drawer) {
        overlay.classList.remove('active');
        drawer.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// 重置抽屉状态
function resetDrawerState() {
    drawerState = {
        currentStep: 1,
        selectedDimension: null,
        selectedTarget: null,
        selectedTemplate: null,
        splitOptions: { byType: false, byPriority: false, byMethod: false },
        reportName: '',
        reportDesc: '',
        enableAI: true
    };

    updateStepIndicator();
    // 不在这里调用 showStep(1)，等数据加载完成后再调用

    document.querySelectorAll('.dimension-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelectorAll('.template-card').forEach(card => {
        card.classList.remove('selected');
    });
}

// 加载抽屉数据
async function loadDrawerData() {
    // 检查登录状态
    if (!authToken) {
        console.warn('[loadDrawerData] 未登录，尝试从 localStorage 恢复 token');
        const savedToken = localStorage.getItem('authToken');
        if (savedToken) {
            authToken = savedToken;
            console.log('[loadDrawerData] 已从 localStorage 恢复 token');
        } else {
            console.error('[loadDrawerData] 无法获取 token，请先登录');
            showToast('请先登录', 'error');
            return false;
        }
    }
    
    // 显示加载状态
    const stepContent = document.getElementById('drawer-step-1');
    if (stepContent) {
        stepContent.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px;">
                <div class="loading-spinner" style="width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <p style="margin-top: 16px; color: #64748b;">正在加载数据...</p>
            </div>
        `;
    }
    
    try {
        console.log('[loadDrawerData] 开始加载数据...');
        
        // 并行加载所有数据以提高速度
        const [projectsRes, testPlansRes, modulesRes, librariesRes] = await Promise.all([
            apiRequest('/projects/list'),
            apiRequest('/testplans/list'),
            apiRequest('/modules/list', {
                method: 'POST',
                body: JSON.stringify({ pageSize: 1000 })
            }),
            apiRequest('/libraries/list')
        ]);
        
        if (projectsRes.success) {
            window.drawerProjects = projectsRes.projects || [];
        }

        if (testPlansRes.success) {
            window.drawerTestPlans = testPlansRes.testPlans || [];
        }

        if (modulesRes.success) {
            window.drawerModules = modulesRes.modules || [];
        }

        if (librariesRes.success) {
            window.drawerLibraries = librariesRes.libraries || [];
            console.log('[loadDrawerData] 用例库加载成功:', window.drawerLibraries.length, '个');
        } else {
            console.error('[loadDrawerData] 用例库加载失败:', librariesRes.message);
        }
        
        // 标记数据已加载
        window.drawerDataLoaded = true;
        console.log('[loadDrawerData] 数据加载完成');
        return true;
    } catch (error) {
        console.error('加载抽屉数据失败:', error);
        showToast('加载数据失败，请重试', 'error');
        return false;
    }
}

// 更新步骤指示器
function updateStepIndicator() {
    const steps = document.querySelectorAll('.step-indicator .step');
    const lines = document.querySelectorAll('.step-indicator .step-line');

    steps.forEach((step, index) => {
        const stepNum = index + 1;
        step.classList.remove('active', 'completed');

        if (stepNum < drawerState.currentStep) {
            step.classList.add('completed');
        } else if (stepNum === drawerState.currentStep) {
            step.classList.add('active');
        }
    });

    lines.forEach((line, index) => {
        if (index < drawerState.currentStep - 1) {
            line.style.background = 'var(--color-primary, #6366f1)';
        } else {
            line.style.background = 'var(--color-border-primary, #e5e7eb)';
        }
    });
}

// 显示指定步骤（报告抽屉）
function showDrawerStep(stepNum) {
    document.querySelectorAll('.drawer-step-content').forEach(content => {
        content.style.display = 'none';
    });

    const currentContent = document.getElementById(`drawer-step-${stepNum}`);
    if (currentContent) {
        currentContent.style.display = 'block';
    }

    const prevBtn = document.getElementById('drawer-prev-btn');
    const nextBtn = document.getElementById('drawer-next-btn');
    const submitBtn = document.getElementById('drawer-submit-btn');

    if (prevBtn) prevBtn.style.display = stepNum > 1 ? 'inline-flex' : 'none';
    if (nextBtn) nextBtn.style.display = stepNum < 4 ? 'inline-flex' : 'none';
    if (submitBtn) submitBtn.style.display = stepNum === 4 ? 'inline-flex' : 'none';

    if (stepNum === 2) {
        renderTargetSelection();
    } else if (stepNum === 4) {
        renderConfigSummary();
        generateDefaultReportName();
    }
}

// 下一步
async function nextDrawerStep() {
    // 检查数据是否已加载
    if (!window.drawerDataLoaded) {
        showToast('数据正在加载中，请稍候...', 'warning');
        return;
    }
    
    if (!validateDrawerStep()) {
        return;
    }

    if (drawerState.currentStep < 4) {
        drawerState.currentStep++;
        updateStepIndicator();
        showDrawerStep(drawerState.currentStep);
    }
}

// 上一步
function prevDrawerStep() {
    if (drawerState.currentStep > 1) {
        drawerState.currentStep--;
        updateStepIndicator();
        showDrawerStep(drawerState.currentStep);
    }
}

// 验证当前步骤（报告生成抽屉）
function validateDrawerStep() {
    switch (drawerState.currentStep) {
        case 1:
            if (!drawerState.selectedDimension) {
                showToast('请选择数据维度', 'warning');
                return false;
            }
            return true;
        case 2:
            if (!drawerState.selectedTarget) {
                showToast('请选择分析目标', 'warning');
                return false;
            }
            return true;
        case 3:
            if (!drawerState.selectedTemplate) {
                showToast('请选择分析模板', 'warning');
                return false;
            }
            return true;
        case 4:
            const nameInput = document.getElementById('drawer-report-name');
            if (!nameInput || !nameInput.value.trim()) {
                showToast('请输入报告名称', 'warning');
                return false;
            }
            return true;
        default:
            return true;
    }
}

// 选择数据维度
function selectDimension(dimension) {
    drawerState.selectedDimension = dimension;
    drawerState.selectedTarget = null;

    document.querySelectorAll('.dimension-card').forEach(card => {
        card.classList.remove('selected');
    });

    const selectedCard = document.querySelector(`.dimension-card[data-dimension="${dimension}"]`);
    if (selectedCard) {
        selectedCard.classList.add('selected');
    }
}

// 渲染目标选择区域
function renderTargetSelection() {
    const targetArea = document.getElementById('target-selection-area');
    if (!targetArea) return;

    let html = '<h4>选择分析目标</h4>';

    switch (drawerState.selectedDimension) {
        case 'testplan':
            html += `
                <select class="target-select" id="target-select-main" onchange="selectTarget(this.value)">
                    <option value="">请选择测试计划</option>
                    ${(window.drawerTestPlans || []).map(plan =>
                `<option value="${plan.id}">${plan.name} (${plan.project || '-'})</option>`
            ).join('')}
                </select>
            `;
            break;

        case 'project':
            html += `
                <select class="target-select" id="target-select-main" onchange="selectTarget(this.value)">
                    <option value="">请选择项目</option>
                    ${(window.drawerProjects || []).map(project =>
                `<option value="${project.id}">${project.name}</option>`
            ).join('')}
                </select>
            `;
            break;

        case 'module':
            html += `
                <div class="cascade-selects">
                    <div class="select-row">
                        <select class="target-select" id="target-select-library" onchange="loadModulesByLibrary(this.value)">
                            <option value="">请选择用例库</option>
                            ${(window.drawerLibraries || []).map(library =>
                `<option value="${library.id}">${library.name}</option>`
            ).join('')}
                        </select>
                    </div>
                    <div class="select-row">
                        <select class="target-select" id="target-select-module" onchange="selectTarget(this.value)" disabled>
                            <option value="">请先选择用例库</option>
                        </select>
                    </div>
                </div>
            `;
            break;

        case 'library':
            html += `
                <select class="target-select" id="target-select-main" onchange="selectTarget(this.value)">
                    <option value="">请选择用例库</option>
                    ${(window.drawerLibraries || []).map(library =>
                `<option value="${library.id}">${library.name}</option>`
            ).join('')}
                </select>
            `;
            break;
    }

    targetArea.innerHTML = html;
}

// 根据项目加载模块
async function loadModulesByProject(projectId) {
    const moduleSelect = document.getElementById('target-select-module');
    if (!moduleSelect) return;

    if (!projectId) {
        moduleSelect.innerHTML = '<option value="">请先选择项目</option>';
        moduleSelect.disabled = true;
        return;
    }

    moduleSelect.innerHTML = '<option value="">加载中...</option>';
    moduleSelect.disabled = false;

    try {
        // 通过API获取项目关联的模块
        const result = await apiRequest('/modules/by-project/' + projectId, {
            method: 'GET'
        });

        if (result.success && result.modules) {
            moduleSelect.innerHTML = `
                <option value="">请选择模块</option>
                ${result.modules.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
            `;
        } else {
            moduleSelect.innerHTML = '<option value="">暂无模块</option>';
        }
    } catch (error) {
        console.error('加载模块失败:', error);
        moduleSelect.innerHTML = '<option value="">加载失败</option>';
    }
}

// 根据用例库加载模块
async function loadModulesByLibrary(libraryId) {
    const moduleSelect = document.getElementById('target-select-module');
    if (!moduleSelect) {
        console.error('[loadModulesByLibrary] 找不到模块选择器元素');
        return;
    }

    if (!libraryId) {
        moduleSelect.innerHTML = '<option value="">请先选择用例库</option>';
        moduleSelect.disabled = true;
        return;
    }

    moduleSelect.innerHTML = '<option value="">加载中...</option>';
    moduleSelect.disabled = false;

    try {
        console.log('[loadModulesByLibrary] 开始加载模块, libraryId:', libraryId);
        
        // 通过API获取用例库关联的模块
        const result = await apiRequest('/modules/search', {
            method: 'POST',
            body: JSON.stringify({ libraryId: libraryId })
        });

        console.log('[loadModulesByLibrary] API 返回结果:', result);

        if (!result) {
            moduleSelect.innerHTML = '<option value="">API 返回空结果</option>';
            return;
        }

        if (result.success && result.modules) {
            if (result.modules.length === 0) {
                moduleSelect.innerHTML = '<option value="">该用例库暂无模块</option>';
            } else {
                moduleSelect.innerHTML = `
                    <option value="">请选择模块</option>
                    ${result.modules.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
                `;
                console.log('[loadModulesByLibrary] 加载了', result.modules.length, '个模块');
            }
        } else {
            moduleSelect.innerHTML = `<option value="">${result.message || '暂无模块'}</option>`;
        }
    } catch (error) {
        console.error('[loadModulesByLibrary] 加载模块失败:', error);
        moduleSelect.innerHTML = '<option value="">加载失败</option>';
    }
}

// 选择目标
function selectTarget(targetId) {
    drawerState.selectedTarget = targetId;
}

// 更新报告预览
function updateReportPreview() {
    drawerState.splitOptions.byType = document.getElementById('split-by-type')?.checked || false;
    drawerState.splitOptions.byPriority = document.getElementById('split-by-priority')?.checked || false;
    drawerState.splitOptions.byMethod = document.getElementById('split-by-method')?.checked || false;
}

// 选择模板
function selectTemplate(template) {
    const templateCard = document.querySelector(`.template-card[data-template="${template}"]`);
    if (templateCard && templateCard.classList.contains('disabled')) {
        return;
    }

    drawerState.selectedTemplate = template;

    document.querySelectorAll('.template-card').forEach(card => {
        card.classList.remove('selected');
    });

    if (templateCard) {
        templateCard.classList.add('selected');
    }
}

// 渲染配置摘要
function renderConfigSummary() {
    const summaryItems = document.getElementById('config-summary-items');
    if (!summaryItems) return;

    const dimensionLabels = {
        'testplan': '测试计划',
        'project': '所属项目',
        'module': '指定模块',
        'library': '用例库'
    };

    const templateLabels = {
        'standard': '常规汇总与回归',
        'hardware': '硬件底层专项分析',
        'performance': '性能测试专项',
        'ai-deep': 'AI深度分析报告'
    };

    const splitLabels = [];
    if (drawerState.splitOptions.byType) splitLabels.push('测试类型');
    if (drawerState.splitOptions.byPriority) splitLabels.push('优先级');
    if (drawerState.splitOptions.byMethod) splitLabels.push('测试方式');

    let targetName = drawerState.selectedTarget || '-';
    if (drawerState.selectedDimension === 'testplan') {
        const plan = (window.drawerTestPlans || []).find(p => p.id == drawerState.selectedTarget);
        if (plan) targetName = plan.name;
    } else if (drawerState.selectedDimension === 'project') {
        const project = (window.drawerProjects || []).find(p => p.id == drawerState.selectedTarget);
        if (project) targetName = project.name;
    }

    summaryItems.innerHTML = `
        <div class="config-item">
            <span class="config-label">数据维度</span>
            <span class="config-value">${dimensionLabels[drawerState.selectedDimension] || '-'}</span>
        </div>
        <div class="config-item">
            <span class="config-label">关联目标</span>
            <span class="config-value">${targetName}</span>
        </div>
        <div class="config-item">
            <span class="config-label">分析模板</span>
            <span class="config-value">${templateLabels[drawerState.selectedTemplate] || '-'}</span>
        </div>
        <div class="config-item">
            <span class="config-label">维度拆分</span>
            <span class="config-value">${splitLabels.length > 0 ? splitLabels.join('、') : '无'}</span>
        </div>
        <div class="config-item">
            <span class="config-label">AI分析</span>
            <span class="config-value">${drawerState.enableAI ? '已启用' : '未启用'}</span>
        </div>
    `;
}

// 生成默认报告名称
function generateDefaultReportName() {
    const nameInput = document.getElementById('drawer-report-name');
    if (!nameInput) return;

    const dimensionLabels = {
        'testplan': '测试计划',
        'project': '项目',
        'module': '模块',
        'library': '用例库'
    };

    let targetName = '';
    if (drawerState.selectedDimension === 'testplan') {
        const plan = (window.drawerTestPlans || []).find(p => p.id == drawerState.selectedTarget);
        if (plan) targetName = plan.name;
    } else if (drawerState.selectedDimension === 'project') {
        const project = (window.drawerProjects || []).find(p => p.id == drawerState.selectedTarget);
        if (project) targetName = project.name;
    }

    const date = new Date().toISOString().split('T')[0];
    const defaultName = `${targetName}_${dimensionLabels[drawerState.selectedDimension]}报告_${date}`;

    nameInput.value = defaultName;
    drawerState.reportName = defaultName;
}

// 提交报告生成任务
async function submitReportTask() {
    if (!validateDrawerStep()) {
        return;
    }

    const nameInput = document.getElementById('drawer-report-name');
    const descInput = document.getElementById('drawer-report-desc');
    const aiCheckbox = document.getElementById('enable-ai-analysis');

    drawerState.reportName = nameInput?.value || '';
    drawerState.reportDesc = descInput?.value || '';
    drawerState.enableAI = aiCheckbox?.checked || false;

    const taskConfig = {
        dimension: drawerState.selectedDimension,
        targetId: drawerState.selectedTarget,
        template: drawerState.selectedTemplate,
        splitOptions: drawerState.splitOptions,
        reportName: drawerState.reportName,
        reportDesc: drawerState.reportDesc,
        enableAI: drawerState.enableAI
    };

    closeReportDrawer();

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const taskName = drawerState.reportName;

    addAsyncTask({
        id: taskId,
        name: taskName,
        progress: 0,
        status: '初始化中...',
        config: taskConfig
    });

    try {
        const result = await apiRequest('/reports/async-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskConfig)
        });

        if (result.success) {
            updateAsyncTask(taskId, { jobId: result.jobId });
            startTaskPolling(taskId, result.jobId);
            showToast('报告生成任务已提交', 'success');
            // 立即刷新报告列表，显示生成中的报告
            loadReportsData();
        } else {
            updateAsyncTask(taskId, {
                progress: 100,
                status: '提交失败',
                error: result.message
            });
            showToast('任务提交失败: ' + result.message, 'error');
        }
    } catch (error) {
        console.error('提交任务失败:', error);
        updateAsyncTask(taskId, {
            progress: 100,
            status: '提交失败',
            error: error.message
        });
        showToast('任务提交失败', 'error');
    }
}

// 添加异步任务
function addAsyncTask(task) {
    asyncTasks.push(task);
    renderAsyncTasks();
    showAsyncTasksPanel();
}

// 更新异步任务
function updateAsyncTask(taskId, updates) {
    const task = asyncTasks.find(t => t.id === taskId);
    if (task) {
        Object.assign(task, updates);
        renderAsyncTasks();
    }
}

// 渲染异步任务列表
function renderAsyncTasks() {
    const tasksList = document.getElementById('tasks-list');
    const taskCountBadge = document.getElementById('task-count-badge');

    if (!tasksList) return;

    const runningTasks = asyncTasks.filter(t => t.progress < 100);

    if (taskCountBadge) {
        taskCountBadge.textContent = `${runningTasks.length} 个任务`;
    }

    tasksList.innerHTML = asyncTasks.map(task => `
        <div class="task-item" data-task-id="${task.id}">
            <div class="task-info">
                <div class="task-name">${task.name}</div>
                <div class="task-progress">
                    ${renderProgressBar(task.progress, 'progress')}
                </div>
            </div>
            <span class="task-status">${task.status}</span>
            ${task.progress < 100 ? `
                <div class="task-actions">
                    <button class="task-cancel-btn" onclick="cancelAsyncTask('${task.id}')" title="取消任务">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

// 显示异步任务面板
function showAsyncTasksPanel() {
    const panel = document.getElementById('async-tasks-panel');
    if (panel && asyncTasks.length > 0) {
        panel.style.display = 'block';
    }
}

// 隐藏异步任务面板
function hideAsyncTasksPanel() {
    const panel = document.getElementById('async-tasks-panel');
    if (panel) {
        panel.style.display = 'none';
    }
}

// 开始任务轮询
function startTaskPolling(taskId, jobId) {
    const pollInterval = setInterval(async () => {
        try {
            const result = await apiRequest(`/reports/job-status/${jobId}`);

            if (result.success) {
                const status = result.status || 'processing';
                const progress = result.progress || 0;
                
                console.log(`[任务轮询] taskId: ${taskId}, jobId: ${jobId}, status: ${status}, progress: ${progress}, reportId: ${result.reportId}`);
                
                updateAsyncTask(taskId, {
                    progress: progress,
                    status: status === 'completed' ? '已完成' : status === 'failed' ? '失败' : status === 'processing' ? '处理中...' : status
                });

                if (progress >= 100 || status === 'completed') {
                    clearInterval(pollInterval);

                    updateAsyncTask(taskId, {
                        reportId: result.reportId,
                        status: '已完成'
                    });

                    loadReportsData();
                    showToast('报告生成完成', 'success');
                }

                if (status === 'failed' || result.error) {
                    clearInterval(pollInterval);
                    updateAsyncTask(taskId, {
                        progress: 100,
                        status: '失败',
                        error: result.error || '生成失败'
                    });
                    loadReportsData();
                }
            }
        } catch (error) {
            console.error('轮询任务状态失败:', error);
        }
    }, 2000);
}

// 取消异步任务
function cancelAsyncTask(taskId) {
    const task = asyncTasks.find(t => t.id === taskId);
    if (task && task.jobId) {
        apiRequest(`/reports/cancel-job/${task.jobId}`, { method: 'POST' })
            .catch(err => console.error('取消任务失败:', err));
    }

    asyncTasks = asyncTasks.filter(t => t.id !== taskId);
    renderAsyncTasks();

    if (asyncTasks.length === 0) {
        hideAsyncTasksPanel();
    }

    showToast('任务已取消', 'info');
}

// 加载报告数据
async function loadReportsData() {
    try {
        const result = await apiRequest('/reports/list');

        if (result.success) {
            allReportsData = result.reports || [];
            renderReportsTable(allReportsData);
            updateReportsStats(allReportsData);
        }
    } catch (error) {
        console.error('加载报告数据失败:', error);
    }
}

// 渲染报告表格
function renderReportsTable(reports) {
    const tbody = document.getElementById('reports-table-body');
    if (!tbody) return;

    if (reports.length === 0) {
        tbody.innerHTML = `
            <tr class="no-data-row">
                <td colspan="6">
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <p>暂无测试报告</p>
                        <span>点击右上角"新建测试报告"开始创建</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = reports.map(report => {
        const createdAt = report.createdAt || report.created_at;
        const name = report.name || '未命名报告';
        const project = report.project || '-';
        const testPlan = report.testPlan || report.test_plan || '-';
        const reportType = report.type || report.report_type || 'standard';
        const status = report.status || 'ready';

        const dimensionMap = {
            'testplan': '测试计划',
            'project': '所属项目',
            'module': '指定模块',
            'library': '用例库',
            'standard': '标准报告',
            'AI生成': 'AI分析报告',
            'daily': '日报'
        };
        const dimension = dimensionMap[reportType] || '测试计划';

        return `
        <tr class="clickable-row" onclick="openReportDetailDrawer(${report.id}, event)">
            <td>
                <div class="report-name-cell">
                    <div class="report-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                    </div>
                    <span class="report-title">${name}</span>
                </div>
            </td>
            <td>
                <span class="dimension-tag">${dimension}</span>
            </td>
            <td>
                <a href="#" class="target-link" onclick="event.stopPropagation(); viewReportDetail(${report.id})">${project}</a>
            </td>
            <td>
                <span class="status-badge ${status}">
                    ${getStatusIcon(status)}
                    ${getStatusText(status)}
                </span>
            </td>
            <td>${formatDateTime(createdAt)}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn-small" onclick="event.stopPropagation(); viewReportDetail(${report.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        查看
                    </button>
                    <button class="action-btn-small" onclick="event.stopPropagation(); downloadReport(${report.id})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        下载
                    </button>
                    ${canDeleteReport(report) ? `
                    <button class="action-btn-small delete-btn" onclick="event.stopPropagation(); deleteReport(${report.id})" style="color: #ef4444;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        删除
                    </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `}).join('');
}

// 获取状态图标
function getStatusIcon(status) {
    switch (status) {
        case 'ready':
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        case 'generating':
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
        case 'failed':
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        default:
            return '';
    }
}

// 获取状态文本
function getStatusText(status) {
    switch (status) {
        case 'ready': return '就绪';
        case 'generating': return '生成中';
        case 'failed': return '失败';
        default: return '就绪';
    }
}

// 格式化日期时间
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
}

// 更新报告统计
function updateReportsStats(reports) {
    const totalEl = document.getElementById('total-reports-count');
    const weekEl = document.getElementById('week-reports-count');
    const aiEl = document.getElementById('ai-reports-count');
    const runningEl = document.getElementById('running-tasks-count');

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 兼容两种日期字段名：createdAt 和 created_at
    const weekReports = reports.filter(r => {
        const dateStr = r.createdAt || r.created_at;
        if (!dateStr) return false;
        return new Date(dateStr) > weekAgo;
    });

    const aiReports = reports.filter(r => r.has_ai_analysis || r.hasAiAnalysis);
    const runningReports = reports.filter(r => r.status === 'generating');

    if (totalEl) totalEl.textContent = reports.length;
    if (weekEl) weekEl.textContent = weekReports.length;
    if (aiEl) aiEl.textContent = aiReports.length;
    if (runningEl) runningEl.textContent = runningReports.length;

    const totalSpan = document.getElementById('total-reports');
    if (totalSpan) totalSpan.textContent = reports.length;
}

// 筛选报告
function filterReports() {
    const statusFilter = document.getElementById('report-status-filter')?.value || '';
    const projectFilter = document.getElementById('report-project-filter')?.value || '';
    const searchText = document.getElementById('report-search-input')?.value?.toLowerCase() || '';

    // 从已加载的数据中筛选
    const filteredReports = allReportsData.filter(report => {
        // 状态筛选
        if (statusFilter && report.status !== statusFilter) {
            return false;
        }

        // 项目筛选
        if (projectFilter && report.project !== projectFilter) {
            return false;
        }

        // 搜索筛选
        if (searchText) {
            const name = (report.name || '').toLowerCase();
            if (!name.includes(searchText)) {
                return false;
            }
        }

        return true;
    });

    // 重新渲染表格
    renderReportsTable(filteredReports);
    updateReportsStats(filteredReports);
}

// 存储所有报告数据用于筛选
let allReportsData = [];

// 分页
function changeReportPage(direction) {
    // TODO: 实现分页逻辑
}

// 下载报告
async function downloadReport(reportId) {
    try {
        const result = await apiRequest(`/reports/markdown/${reportId}`);

        if (result.success && result.markdown) {
            const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `report_${reportId}_${new Date().toISOString().split('T')[0]}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast('报告下载成功', 'success');
        } else {
            showToast('获取报告内容失败', 'error');
        }
    } catch (error) {
        console.error('下载报告失败:', error);
        showToast('下载失败', 'error');
    }
}

// 判断用户是否有权限删除报告
function canDeleteReport(report) {
    if (!currentUser) return false;

    // 管理员可以删除
    if (currentUser.role === '管理员' || currentUser.role === 'admin' || currentUser.role === 'Administrator') {
        return true;
    }

    // 创建者可以删除
    const creatorId = report.creator_id || report.creatorId;
    const creatorName = report.creator;

    if (creatorId && currentUser.id == creatorId) {
        return true;
    }

    if (creatorName && currentUser.username === creatorName) {
        return true;
    }

    return false;
}

// 删除测试报告
async function deleteReport(reportId) {
    const confirmed = await showConfirmDialog('确定要删除此测试报告吗？删除后无法恢复。');
    if (!confirmed) return;

    try {
        showLoading('删除中...');
        console.log('开始删除报告, ID:', reportId);
        const result = await apiRequest(`/reports/${reportId}`, {
            method: 'DELETE'
        });

        console.log('删除结果:', result);

        if (result.success) {
            showSuccessMessage('报告删除成功');
            console.log('开始重新加载报告列表...');
            // 重新加载报告列表和统计数据
            await loadReportsData();
            console.log('报告列表重新加载完成');
            // 同时更新Dashboard统计
            if (typeof loadDashboardStats === 'function') {
                loadDashboardStats();
            }
        } else {
            showErrorMessage(result.message || '删除失败');
        }
    } catch (error) {
        console.error('删除报告失败:', error);
        showErrorMessage('删除失败');
    } finally {
        hideLoading();
    }
}

// 显示确认对话框
function showConfirmDialog(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const messageEl = document.getElementById('confirm-message');

        if (modal && messageEl) {
            messageEl.textContent = message;
            modal.style.display = 'flex';

            // 设置确认回调
            window.confirmCallback = resolve;
        } else {
            // 如果模态框不存在，使用原生确认框
            resolve(confirm(message));
        }
    });
}

// 关闭确认对话框
function closeConfirmModal(confirmed) {
    const modal = document.getElementById('confirm-modal');
    if (modal) {
        modal.style.display = 'none';
    }

    if (window.confirmCallback) {
        window.confirmCallback(confirmed);
        window.confirmCallback = null;
    }
}

/* ========================================
   测试计划详情抽屉 - JavaScript逻辑
   ======================================== */

// 当前抽屉显示的测试计划ID
let currentDrawerPlanId = null;
// 抽屉中的测试用例数据
let drawerCasesData = [];

// 初始化测试计划表格的事件委托
function initTestPlanTableEvents() {
    const tableBody = document.getElementById('testplan-table-body');
    if (!tableBody) return;

    // 使用事件委托监听表格行的点击
    tableBody.addEventListener('click', function (e) {
        // 检查点击目标是否为链接、按钮或其子元素
        let target = e.target;

        // 向上查找，判断是否点击了链接或按钮
        while (target && target !== tableBody) {
            if (target.tagName === 'A' || target.tagName === 'BUTTON') {
                // 点击的是链接或按钮，不触发抽屉
                return;
            }
            target = target.parentElement;
        }

        // 点击的是表格行，获取测试计划ID并打开抽屉
        const row = e.target.closest('tr');
        if (row) {
            const planId = row.getAttribute('data-plan-id');
            if (planId) {
                openTestPlanDrawer(parseInt(planId));
            }
        }
    });
}

// 打开测试计划抽屉
async function openTestPlanDrawer(planId) {
    const overlay = document.getElementById('testplan-drawer-overlay');
    const drawer = document.getElementById('testplan-drawer');

    if (!overlay || !drawer) {
        console.error('抽屉元素不存在');
        return;
    }

    currentDrawerPlanId = planId;

    // 显示抽屉
    overlay.classList.add('active');
    drawer.classList.add('active');
    document.body.style.overflow = 'hidden';

    // 加载测试计划详情
    await loadTestPlanDrawerData(planId);
}

// 关闭测试计划抽屉
function closeTestPlanDrawer() {
    const overlay = document.getElementById('testplan-drawer-overlay');
    const drawer = document.getElementById('testplan-drawer');

    if (overlay && drawer) {
        overlay.classList.remove('active');
        drawer.classList.remove('active');
        document.body.style.overflow = '';
    }

    currentDrawerPlanId = null;
    drawerCasesData = [];
}

// 加载抽屉数据
async function loadTestPlanDrawerData(planId) {
    try {
        // 获取测试计划信息
        const plan = testPlans.find(p => p.id === planId);
        if (!plan) {
            showToast('测试计划不存在', 'error');
            closeTestPlanDrawer();
            return;
        }

        // 更新标题
        const titleEl = document.getElementById('testplan-drawer-title');
        if (titleEl) {
            titleEl.textContent = plan.name || '测试计划详情';
        }

        // 渲染基本信息
        renderDrawerInfo(plan);

        // 加载关联的测试用例（会在加载完成后刷新进度统计）
        await loadDrawerCases(planId);

    } catch (error) {
        console.error('加载抽屉数据失败:', error);
        showToast('加载数据失败', 'error');
    }
}

// 渲染基本信息
function renderDrawerInfo(plan) {
    const infoGrid = document.getElementById('testplan-info-grid');
    if (!infoGrid) return;

    infoGrid.innerHTML = `
        <div class="info-item">
            <span class="label">负责人</span>
            <span class="value">${plan.ownerName || plan.owner || '-'}</span>
        </div>
        <div class="info-item">
            <span class="label">状态</span>
            <span class="value">${getStatusText(plan.status) || '-'}</span>
        </div>
        <div class="info-item">
            <span class="label">关联项目</span>
            <span class="value">${plan.projectName || plan.project || '-'}</span>
        </div>
        <div class="info-item">
            <span class="label">关联迭代</span>
            <span class="value">${plan.iteration || '-'}</span>
        </div>
        <div class="info-item">
            <span class="label">开始时间</span>
            <span class="value">${formatDateTime(plan.startDate || plan.start_date)}</span>
        </div>
        <div class="info-item">
            <span class="label">结束时间</span>
            <span class="value">${formatDateTime(plan.endDate || plan.end_date)}</span>
        </div>
        <div class="info-item">
            <span class="label">创建时间</span>
            <span class="value">${formatDateTime(plan.createdAt || plan.created_at)}</span>
        </div>
        <div class="info-item">
            <span class="label">通过率</span>
            <span class="value">${plan.passRate || 0}%</span>
        </div>
    `;
}

// 重新计算测试计划统计数据
function recalculatePlanStats(plan, cases) {
    if (!cases || !Array.isArray(cases)) return;

    const totalCases = cases.length;
    let testedCases = 0;
    let passedCases = 0;
    let failedCases = 0;
    let blockedCases = 0;
    let pendingCases = 0;

    cases.forEach(tc => {
        const status = tc.status || 'pending';
        if (status === 'pass') {
            testedCases++;
            passedCases++;
        } else if (status === 'fail') {
            testedCases++;
            failedCases++;
        } else if (status === 'blocked') {
            testedCases++;
            blockedCases++;
        } else if (status === 'asic_hang' || status === 'core_dump' || status === 'traffic_drop') {
            testedCases++;
            failedCases++;
        } else {
            pendingCases++;
        }
    });

    plan.totalCases = totalCases;
    plan.testedCases = testedCases;
    plan.passedCases = passedCases;
    plan.failedCases = failedCases;
    plan.blockedCases = blockedCases;
    plan.pendingCases = pendingCases;
    plan.passRate = testedCases > 0 ? Math.round((passedCases / testedCases) * 100) : 0;
}

// 渲染进度统计
function renderDrawerProgress(plan) {
    const progressStats = document.getElementById('testplan-progress-stats');
    if (!progressStats) return;

    const totalCases = plan.totalCases || 0;
    const testedCases = plan.testedCases || 0;
    const passedCases = plan.passedCases || 0;
    const failedCases = plan.failedCases || 0;
    const blockedCases = plan.blockedCases || 0;
    const pendingCases = totalCases - testedCases;

    progressStats.innerHTML = `
        <div class="stat-item passed">
            <div class="stat-value">${passedCases}</div>
            <div class="stat-label">通过</div>
        </div>
        <div class="stat-item failed">
            <div class="stat-value">${failedCases}</div>
            <div class="stat-label">失败</div>
        </div>
        <div class="stat-item blocked">
            <div class="stat-value">${blockedCases}</div>
            <div class="stat-label">阻塞</div>
        </div>
        <div class="stat-item pending">
            <div class="stat-value">${pendingCases}</div>
            <div class="stat-label">未执行</div>
        </div>
    `;
}

// 加载关联的测试用例
async function loadDrawerCases(planId) {
    const casesList = document.getElementById('testplan-cases-list');
    const caseCount = document.getElementById('testplan-case-count');

    if (!casesList) return;

    console.log('loadDrawerCases called with planId:', planId, 'type:', typeof planId);

    casesList.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--color-text-secondary, #6b7280);">
            <div class="loading-spinner"></div>
            <p style="margin-top: 12px;">加载用例中...</p>
        </div>
    `;

    try {
        const result = await apiRequest(`/testplans/${planId}/cases?pageSize=10000`);

        console.log('loadDrawerCases API result:', result.success, 'cases count:', result.cases?.length);

        if (result.success && result.cases) {
            drawerCasesData = result.cases;
        } else {
            drawerCasesData = [];
        }

        if (caseCount) {
            caseCount.textContent = drawerCasesData.length;
        }

        console.log('loadDrawerCases drawerCasesData first item:', drawerCasesData[0]);
        renderDrawerCasesList(drawerCasesData, planId);

        const plan = testPlans.find(p => p.id === planId);
        console.log('loadDrawerCases found plan:', plan ? 'yes' : 'no', 'plan id:', plan?.id);
        if (plan) {
            recalculatePlanStats(plan, drawerCasesData);
            console.log('loadDrawerCases stats calculated:', { passedCases: plan.passedCases, failedCases: plan.failedCases, blockedCases: plan.blockedCases, pendingCases: plan.pendingCases });
            renderDrawerProgress(plan);
        } else {
            console.log('loadDrawerCases testPlans:', testPlans.map(p => p.id));
        }

    } catch (error) {
        console.error('加载用例失败:', error);
        drawerCasesData = [];
        if (caseCount) {
            caseCount.textContent = '0';
        }
        renderDrawerCasesList([], planId);
    }
}

// 渲染用例列表
function renderDrawerCasesList(cases, planId) {
    const casesList = document.getElementById('testplan-cases-list');
    if (!casesList) return;

    if (cases.length === 0) {
        casesList.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--color-text-secondary, #6b7280);">
                <p>暂无关联的测试用例</p>
            </div>
        `;
        return;
    }

    casesList.innerHTML = cases.map(tc => {
        const priorityClass = (tc.priority || 'P3').toLowerCase();
        const statusClass = getStatusClass(tc.status);
        const statusText = getStatusText(tc.status);
        const safeCaseName = (tc.name || '').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '');

        return `
            <div class="case-item">
                <span class="case-id">${tc.caseId || tc.case_id || `#${tc.id}`}</span>
                <span class="case-name clickable" title="${escapeHtml(tc.name)}" onclick="openDrawerCaseDetail(${tc.id})">${escapeHtml(tc.name)}</span>
                <span class="case-priority">
                    <span class="priority-tag ${priorityClass}">${tc.priority || 'P3'}</span>
                </span>
                <span class="case-status">
                    <span class="status-tag-small ${statusClass} clickable" data-case-id="${tc.id}" data-plan-id="${planId}" data-status="${tc.status || 'pending'}" data-name="${escapeHtml(safeCaseName)}">${statusText}</span>
                </span>
            </div>
        `;
    }).join('');
    
    // 绑定点击事件
    casesList.querySelectorAll('.status-tag-small.clickable').forEach(tag => {
        tag.addEventListener('click', function(e) {
            e.stopPropagation();
            const caseId = this.dataset.caseId;
            const planId = this.dataset.planId;
            const status = this.dataset.status;
            const name = this.dataset.name;
            showCaseStatusEditor(caseId, planId, status, name);
        });
    });
}

// 从滑屉打开测试用例详情编辑模态框
async function openDrawerCaseDetail(caseId) {
    // 始终从API获取完整数据，因为滑屉数据是简化版
    try {
        showLoading('加载用例详情...');
        const result = await apiRequest(`/testpoints/detail/${caseId}`);
        if (result.success && result.data) {
            const testCase = result.data;
            
            // 不关闭滑屉，保持打开状态以便用户继续操作
            // closeTestPlanDrawer();
            
            // 打开测试用例详情模态框
            await openTestCaseDetailModal(testCase);
        } else {
            showToast('获取用例详情失败', 'error');
        }
    } catch (error) {
        console.error('加载用例详情失败:', error);
        showToast('加载用例详情失败', 'error');
    } finally {
        hideLoading();
    }
}

// 获取状态显示文本
function getStatusText(status) {
    const statusTextMap = {
        'pass': '通过',
        'fail': '失败',
        'blocked': '阻塞',
        'pending': '未执行',
        'asic_hang': 'ASIC挂起',
        'core_dump': '核心转储',
        'traffic_drop': '流量丢失'
    };
    return statusTextMap[status] || status || '未执行';
}

// 显示用例状态编辑器
async function showCaseStatusEditor(caseId, planId, currentStatus, caseName) {
    console.log('showCaseStatusEditor called:', { caseId, planId, currentStatus, caseName });
    
    const existingModal = document.getElementById('case-status-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // 从API获取状态选项
    let statusOptions = [
        { value: 'pending', label: '未执行' },
        { value: 'pass', label: '通过' },
        { value: 'fail', label: '失败' },
        { value: 'blocked', label: '阻塞' },
        { value: 'asic_hang', label: 'ASIC挂起' },
        { value: 'core_dump', label: '核心转储' },
        { value: 'traffic_drop', label: '流量丢失' }
    ];
    
    try {
        const result = await apiRequest('/test-statuses/list');
        if (result.success && result.testStatuses && result.testStatuses.length > 0) {
            statusOptions = result.testStatuses.map(s => ({
                value: s.name,
                label: s.name,
                description: s.description
            }));
        }
    } catch (e) {
        console.log('获取状态列表失败，使用默认值:', e);
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'case-status-modal';
    modal.dataset.caseId = caseId;
    modal.dataset.planId = planId;
    modal.style.cssText = 'display: flex !important; position: fixed !important; z-index: 99999 !important; left: 0 !important; top: 0 !important; width: 100% !important; height: 100% !important; background-color: rgba(0,0,0,0.5) !important; align-items: center !important; justify-content: center !important; visibility: visible !important; opacity: 1 !important;';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px; background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
            <div class="modal-header" style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 16px;">编辑用例状态</h3>
                <button class="modal-close" onclick="closeCaseStatusModal()" style="background: none; border: none; font-size: 20px; cursor: pointer;">&times;</button>
            </div>
            <div class="modal-body" style="padding: 20px;">
                <div style="margin-bottom: 16px;">
                    <label style="font-weight: 500; color: #6b7280; display: block; margin-bottom: 4px;">用例名称</label>
                    <p style="margin: 0; font-size: 14px; color: #374151;">${escapeHtml(caseName)}</p>
                </div>
                <div class="form-field">
                    <label class="form-label" style="display: block; margin-bottom: 4px; font-weight: 500;">执行状态</label>
                    <select id="case-status-select" class="form-select" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px;">
                        ${statusOptions.map(opt => `
                            <option value="${opt.value}" ${currentStatus === opt.value ? 'selected' : ''}>${opt.label}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="form-field" id="error-message-field" style="display: none; margin-top: 12px;">
                    <label class="form-label" style="display: block; margin-bottom: 4px; font-weight: 500;">错误信息</label>
                    <textarea id="case-error-message" class="form-textarea" rows="3" placeholder="请输入错误描述..." style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical;"></textarea>
                </div>
            </div>
            <div class="modal-footer" style="padding: 16px 20px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 12px;">
                <button class="btn btn-secondary" onclick="closeCaseStatusModal()" style="padding: 8px 16px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; cursor: pointer;">取消</button>
                <button class="btn btn-primary" id="save-case-status-btn" style="padding: 8px 16px; border: none; background: #4f46e5; color: #fff; border-radius: 6px; cursor: pointer;">保存</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    console.log('Modal created and appended:', modal);
    
    // 确保模态框可见
    setTimeout(() => {
        modal.style.opacity = '1';
        modal.style.visibility = 'visible';
    }, 10);
    
    // 绑定保存按钮点击事件
    const saveBtn = document.getElementById('save-case-status-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            saveCaseStatus(caseId, planId);
        });
    }

    const statusSelect = document.getElementById('case-status-select');
    if (statusSelect) {
        statusSelect._statusChangeHandler = function () {
            const errorField = document.getElementById('error-message-field');
            if (errorField) {
                const needsError = ['fail', 'blocked', 'asic_hang', 'core_dump', 'traffic_drop'].includes(this.value);
                errorField.style.display = needsError ? 'block' : 'none';
            }
        };
        statusSelect.addEventListener('change', statusSelect._statusChangeHandler);
    }

    if (['fail', 'blocked', 'asic_hang', 'core_dump', 'traffic_drop'].includes(currentStatus)) {
        const errorField = document.getElementById('error-message-field');
        if (errorField) {
            errorField.style.display = 'block';
        }
    }
}

function closeCaseStatusModal() {
    const modal = document.getElementById('case-status-modal');
    if (modal) {
        const statusSelect = document.getElementById('case-status-select');
        if (statusSelect && statusSelect._statusChangeHandler) {
            statusSelect.removeEventListener('change', statusSelect._statusChangeHandler);
            statusSelect._statusChangeHandler = null;
        }
        modal.remove();
    }
}

async function saveCaseStatus(caseId, planId) {
    const statusSelect = document.getElementById('case-status-select');
    const errorMessageField = document.getElementById('case-error-message');

    const newStatus = statusSelect.value;
    const errorMessage = errorMessageField ? errorMessageField.value : '';

    console.log('saveCaseStatus - newStatus:', newStatus);
    console.log('saveCaseStatus - sending to backend:', { status: newStatus, error_message: errorMessage });

    try {
        showLoading('保存中...');

        const result = await apiRequest(`/testplans/${planId}/cases/${caseId}`, {
            method: 'PUT',
            body: JSON.stringify({
                status: newStatus,
                error_message: errorMessage
            })
        });

        if (result.success) {
            showSuccessMessage('状态更新成功');
            closeCaseStatusModal();

            const numericCaseId = parseInt(caseId);
            const numericPlanId = parseInt(planId);

            console.log('saveCaseStatusDebug', { currentDrawerPlanId, numericPlanId, numericCaseId, drawerCasesDataLength: drawerCasesData.length });

            if (currentDrawerPlanId !== numericPlanId) {
                console.warn('抽屉已切换到其他计划，跳过UI更新');
                return;
            }

            const caseItem = drawerCasesData.find(c => c.id === numericCaseId || c.caseId === numericCaseId);
            console.log('caseItem found:', caseItem ? 'yes' : 'no', 'id type:', typeof caseItem?.id, 'caseId type:', typeof caseItem?.caseId);
            if (caseItem) {
                caseItem.status = newStatus;
            } else {
                console.log('drawerCasesData ids:', drawerCasesData.map(c => c.id));
            }

            renderDrawerCasesList(drawerCasesData, numericPlanId);

            const plan = testPlans.find(p => p.id === numericPlanId);
            console.log('plan found:', plan ? 'yes' : 'no');
            if (plan) {
                recalculatePlanStats(plan, drawerCasesData);
                renderDrawerProgress(plan);
                renderDrawerInfo(plan);
            }

            if (typeof loadTestPlans === 'function') {
                loadTestPlans();
            }
        } else {
            showErrorMessage('更新失败: ' + (result.message || '未知错误'));
        }
    } catch (error) {
        console.error('保存状态失败:', error);
        showErrorMessage('保存失败: ' + error.message);
    } finally {
        hideLoading();
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 获取状态样式类
function getStatusClass(status) {
    const statusMap = {
        '通过': 'pass',
        'pass': 'pass',
        '失败': 'fail',
        'fail': 'fail',
        '阻塞': 'blocked',
        'blocked': 'blocked',
        '未执行': 'pending',
        'pending': 'pending'
    };
    return statusMap[status] || 'pending';
}

// 筛选抽屉中的用例
function filterDrawerCases() {
    const searchText = document.getElementById('drawer-case-search')?.value?.toLowerCase() || '';
    const statusFilter = document.getElementById('drawer-status-filter')?.value || '';

    let filtered = drawerCasesData;

    if (searchText) {
        filtered = filtered.filter(tc =>
            (tc.name || '').toLowerCase().includes(searchText) ||
            (tc.caseId || tc.case_id || '').toLowerCase().includes(searchText)
        );
    }

    if (statusFilter) {
        filtered = filtered.filter(tc => tc.status === statusFilter);
    }

    renderDrawerCasesList(filtered);

    // 更新数量显示
    const caseCount = document.getElementById('testplan-case-count');
    if (caseCount) {
        caseCount.textContent = `${filtered.length}/${drawerCasesData.length}`;
    }
}

// ==================== Excel导入导出功能 ====================

// 导入状态
let importCurrentStep = 1;
let importFileInfo = null;
let importExcelHeaders = [];
let importSystemFields = [];

// 系统字段定义
const IMPORT_SYSTEM_FIELDS = [
    { key: 'name', label: '用例名称', required: true },
    { key: 'module_name', label: '模块名称', required: true },
    { key: 'level1_name', label: '一级测试点', required: false },
    { key: 'priority', label: '优先级', required: false },
    { key: 'type', label: '用例类型', required: false },
    { key: 'precondition', label: '前置条件', required: false },
    { key: 'purpose', label: '测试目的', required: false },
    { key: 'steps', label: '测试步骤', required: false },
    { key: 'expected', label: '预期结果', required: false },
    { key: 'owner', label: '执行人', required: false },
    { key: 'status', label: '执行状态', required: false },
    { key: 'key_config', label: '关键配置', required: false },
    { key: 'remark', label: '备注', required: false }
];

// 打开导入弹窗
function openImportExcelModal() {
    if (!currentCaseLibraryId) {
        showErrorMessage('请先选择一个用例库');
        return;
    }
    
    const modal = document.getElementById('import-excel-modal');
    if (modal) {
        modal.style.display = 'block';
        importCurrentStep = 1;
        updateImportStepUI();
        resetImportForm();
    }
}

// 关闭导入弹窗
function closeImportExcelModal() {
    const modal = document.getElementById('import-excel-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    resetImportForm();
}

// 重置导入表单
function resetImportForm() {
    importFileInfo = null;
    importExcelHeaders = [];
    
    const fileInput = document.getElementById('excel-file-input');
    if (fileInput) fileInput.value = '';
    
    const fileInfoEl = document.getElementById('selected-file-info');
    if (fileInfoEl) fileInfoEl.style.display = 'none';
    
    const nextBtn = document.getElementById('import-next-btn');
    if (nextBtn) nextBtn.disabled = true;
    
    const progressEl = document.getElementById('import-progress');
    if (progressEl) progressEl.style.display = 'none';
    
    const resultEl = document.getElementById('import-result');
    if (resultEl) resultEl.style.display = 'none';
}

// 更新步骤UI
function updateImportStepUI() {
    for (let i = 1; i <= 3; i++) {
        const stepEl = document.getElementById(`import-step-${i}`);
        const contentEl = document.getElementById(`import-step-content-${i}`);
        
        if (stepEl) {
            stepEl.classList.remove('active', 'completed');
            if (i < importCurrentStep) {
                stepEl.classList.add('completed');
            } else if (i === importCurrentStep) {
                stepEl.classList.add('active');
            }
        }
        
        if (contentEl) {
            contentEl.style.display = i === importCurrentStep ? 'block' : 'none';
        }
    }
    
    const prevBtn = document.getElementById('import-prev-btn');
    const nextBtn = document.getElementById('import-next-btn');
    
    if (prevBtn) {
        prevBtn.style.display = importCurrentStep > 1 ? 'inline-block' : 'none';
    }
    
    if (nextBtn) {
        if (importCurrentStep === 3) {
            nextBtn.textContent = '开始导入';
        } else {
            nextBtn.textContent = '下一步';
        }
    }
}

// 处理文件选择
async function handleExcelFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ];
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (!validTypes.includes(file.type) && !['xlsx', 'xls'].includes(ext)) {
        showErrorMessage('请选择Excel文件(.xlsx或.xls)');
        return;
    }
    
    if (file.size > 50 * 1024 * 1024) {
        showErrorMessage('文件大小不能超过50MB');
        return;
    }
    
    // 显示文件信息
    document.getElementById('selected-file-info').style.display = 'block';
    document.getElementById('selected-file-name').textContent = file.name;
    document.getElementById('selected-file-size').textContent = formatFileSize(file.size);
    
    // 上传并解析表头
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        showLoading('正在解析文件...');
        
        const response = await fetch('/api/excel/import/parse-headers', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        hideLoading();
        
        if (result.success) {
            importFileInfo = result.data.fileInfo;
            importExcelHeaders = result.data.headers;
            importSystemFields = result.data.systemFields;
            
            document.getElementById('import-next-btn').disabled = false;
            showSuccessMessage(`文件解析成功，共${result.data.totalRows}行数据`);
        } else {
            showErrorMessage(result.message || '文件解析失败');
        }
    } catch (error) {
        hideLoading();
        showErrorMessage('文件上传失败: ' + error.message);
    }
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 清除选中的文件
function clearSelectedFile() {
    document.getElementById('excel-file-input').value = '';
    document.getElementById('selected-file-info').style.display = 'none';
    document.getElementById('import-next-btn').disabled = true;
    importFileInfo = null;
    importExcelHeaders = [];
}

// 下一步
function nextImportStep() {
    if (importCurrentStep === 1) {
        if (!importFileInfo) {
            showErrorMessage('请先选择文件');
            return;
        }
        importCurrentStep = 2;
        updateImportStepUI();
        renderFieldMapping();
    } else if (importCurrentStep === 2) {
        // 验证必填字段映射
        const mapping = getFieldMapping();
        const missingRequired = IMPORT_SYSTEM_FIELDS
            .filter(f => f.required && !mapping[f.key])
            .map(f => f.label);
        
        if (missingRequired.length > 0) {
            showErrorMessage(`请映射必填字段: ${missingRequired.join(', ')}`);
            return;
        }
        
        importCurrentStep = 3;
        updateImportStepUI();
        renderImportSummary();
    } else if (importCurrentStep === 3) {
        executeImport();
    }
}

// 上一步
function prevImportStep() {
    if (importCurrentStep > 1) {
        importCurrentStep--;
        updateImportStepUI();
    }
}

// 渲染字段映射
function renderFieldMapping() {
    document.getElementById('excel-row-count').textContent = importFileInfo.totalRows;
    
    const listEl = document.getElementById('field-mapping-list');
    listEl.innerHTML = '';
    
    IMPORT_SYSTEM_FIELDS.forEach(field => {
        const row = document.createElement('div');
        row.className = 'mapping-row';
        
        // 自动匹配
        let autoMatch = '';
        const matchedHeader = importExcelHeaders.find(h => {
            const hLower = h.toLowerCase();
            const fLower = field.label.toLowerCase();
            return hLower.includes(fLower) || fLower.includes(hLower);
        });
        if (matchedHeader) autoMatch = matchedHeader;
        
        row.innerHTML = `
            <div class="mapping-col">
                ${field.label}${field.required ? '<span class="required-field">*</span>' : ''}
            </div>
            <div class="mapping-col">
                <select id="mapping-${field.key}" onchange="updateMappingStatus()">
                    <option value="">-- 不映射 --</option>
                    ${importExcelHeaders.map(h => 
                        `<option value="${h}" ${h === autoMatch ? 'selected' : ''}>${h}</option>`
                    ).join('')}
                </select>
            </div>
        `;
        
        listEl.appendChild(row);
    });
}

// 获取字段映射
function getFieldMapping() {
    const mapping = {};
    IMPORT_SYSTEM_FIELDS.forEach(field => {
        const select = document.getElementById(`mapping-${field.key}`);
        if (select && select.value) {
            mapping[field.key] = select.value;
        }
    });
    return mapping;
}

// 更新映射状态
function updateMappingStatus() {
    const mapping = getFieldMapping();
    const allRequiredMapped = IMPORT_SYSTEM_FIELDS
        .filter(f => f.required)
        .every(f => mapping[f.key]);
    
    document.getElementById('import-next-btn').disabled = !allRequiredMapped;
}

// 渲染导入摘要
function renderImportSummary() {
    const libraryName = document.getElementById('current-case-library')?.textContent || '当前用例库';
    document.getElementById('import-target-library').textContent = libraryName;
    document.getElementById('import-total-rows').textContent = importFileInfo.totalRows;
}

// 执行导入
async function executeImport() {
    const mapping = getFieldMapping();
    const createMissingModules = document.getElementById('create-missing-modules').checked;
    const createMissingLevel1 = document.getElementById('create-missing-level1').checked;
    
    // 显示进度
    document.getElementById('import-progress').style.display = 'block';
    document.getElementById('import-result').style.display = 'none';
    document.getElementById('import-next-btn').disabled = true;
    
    const progressFill = document.getElementById('import-progress-fill');
    const progressText = document.getElementById('import-progress-text');
    
    progressFill.style.width = '30%';
    progressText.textContent = '正在导入数据...';
    
    try {
        const response = await fetch('/api/excel/import/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filePath: importFileInfo.path,
                mapping,
                libraryId: currentCaseLibraryId,
                createMissingModules,
                createMissingLevel1
            })
        });
        
        const result = await response.json();
        
        progressFill.style.width = '100%';
        
        if (result.success) {
            document.getElementById('import-progress').style.display = 'none';
            document.getElementById('import-result').style.display = 'block';
            document.getElementById('import-result-text').textContent = result.message;
            
            // 刷新用例列表
            await loadTestCases();
        } else {
            progressText.textContent = '导入失败';
            showErrorMessage(result.message || '导入失败');
        }
    } catch (error) {
        progressText.textContent = '导入失败';
        showErrorMessage('导入失败: ' + error.message);
    }
}

// 导出测试用例 - 打开导出选项弹窗
async function exportTestCases() {
    if (!currentCaseLibraryId) {
        showErrorMessage('请先选择一个用例库');
        return;
    }
    
    // 打开导出选项弹窗
    openExportOptionsModal();
}

// 导出选项弹窗相关变量
let exportSelectedModules = [];

// 打开导出选项弹窗
async function openExportOptionsModal() {
    const modal = document.getElementById('export-options-modal');
    if (modal) {
        modal.style.display = 'block';
        
        // 设置当前用例库名称
        const libraryName = document.getElementById('current-case-library')?.textContent || '当前用例库';
        document.getElementById('export-library-name').textContent = libraryName;
        
        // 加载模块列表
        await loadExportModulesList();
    }
}

// 关闭导出选项弹窗
function closeExportOptionsModal() {
    const modal = document.getElementById('export-options-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    exportSelectedModules = [];
}

// 加载导出模块列表
async function loadExportModulesList() {
    console.log('[导出模块列表] 开始加载, currentCaseLibraryId:', currentCaseLibraryId);
    
    try {
        const result = await apiRequest('/modules/list', {
            method: 'POST',
            body: JSON.stringify({ libraryId: currentCaseLibraryId, pageSize: 1000 })
        });
        
        console.log('[导出模块列表] API返回结果:', result);
        
        if (result.success) {
            const listEl = document.getElementById('export-modules-list');
            if (!listEl) {
                console.error('[导出模块列表] 未找到export-modules-list元素');
                return;
            }
            
            listEl.innerHTML = '';
            
            const modules = result.modules || [];
            console.log('[导出模块列表] 模块数量:', modules.length);
            
            if (modules.length === 0) {
                listEl.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 20px;">当前用例库暂无模块</div>';
                return;
            }
            
            modules.forEach(module => {
                const item = document.createElement('div');
                item.className = 'export-module-item';
                item.dataset.moduleId = module.id;
                item.dataset.moduleName = module.name;
                
                item.innerHTML = `
                    <input type="checkbox" id="export-module-${module.id}" style="display: none;">
                    <span class="checkbox-custom"></span>
                    <span class="module-name">${module.name}</span>
                    <span class="module-count">${module.caseCount || 0} 条用例</span>
                `;
                
                item.addEventListener('click', function() {
                    const checkbox = this.querySelector('input[type="checkbox"]');
                    checkbox.checked = !checkbox.checked;
                    this.classList.toggle('selected', checkbox.checked);
                    updateExportButtonState();
                });
                
                listEl.appendChild(item);
            });
            
            // 默认全选
            selectAllExportModules(true);
        } else {
            console.error('[导出模块列表] API返回失败:', result.message);
        }
    } catch (error) {
        console.error('[导出模块列表] 加载失败:', error);
        showErrorMessage('加载模块列表失败');
    }
}

// 全选/取消全选导出模块
function selectAllExportModules(selectAll) {
    const items = document.querySelectorAll('.export-module-item');
    items.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        checkbox.checked = selectAll;
        item.classList.toggle('selected', selectAll);
    });
    updateExportButtonState();
}

// 更新导出按钮状态
function updateExportButtonState() {
    const selectedItems = document.querySelectorAll('.export-module-item.selected');
    const confirmBtn = document.getElementById('export-confirm-btn');
    
    if (confirmBtn) {
        confirmBtn.disabled = selectedItems.length === 0;
        
        if (selectedItems.length > 0) {
            confirmBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                导出Excel (${selectedItems.length}个模块)
            `;
        } else {
            confirmBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                导出Excel
            `;
        }
    }
}

// 确认导出
async function confirmExport() {
    const selectedItems = document.querySelectorAll('.export-module-item.selected');
    
    if (selectedItems.length === 0) {
        showErrorMessage('请至少选择一个模块');
        return;
    }
    
    const moduleIds = Array.from(selectedItems).map(item => item.dataset.moduleId);
    const includeLevel1 = document.getElementById('export-include-level1').checked;
    const includeCases = document.getElementById('export-include-cases').checked;
    
    closeExportOptionsModal();
    
    // 使用后台下载方式，避免页面卡顿
    const moduleIdsParam = moduleIds.join(',');
    const libraryName = document.getElementById('current-case-library')?.textContent || '测试用例';
    const filename = `${libraryName}_导出_${new Date().toISOString().slice(0,10)}.xlsx`;
    
    // 显示提示
    showSuccessMessage('正在后台导出，请稍候...');
    
    // 使用隐藏的iframe下载，避免阻塞页面
    const downloadUrl = `/api/excel/export?libraryId=${currentCaseLibraryId}&moduleIds=${moduleIdsParam}&includeLevel1=${includeLevel1}&includeCases=${includeCases}`;
    
    // 创建隐藏的a标签触发下载
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // 延迟显示成功提示
    setTimeout(() => {
        showSuccessMessage('导出文件已开始下载');
    }, 1000);
}

// 初始化拖拽上传
document.addEventListener('DOMContentLoaded', function() {
    const uploadArea = document.getElementById('upload-area');
    
    if (uploadArea) {
        uploadArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const fileInput = document.getElementById('excel-file-input');
                fileInput.files = files;
                handleExcelFileSelect({ target: fileInput });
            }
        });
    }
});