const Router = {
    routes: {
        'workspace': { section: 'workspace', title: '工作台', requiresAuth: true },
        'dashboard': { section: 'dashboard', title: '数据面板', requiresAuth: true },
        'cases': { section: 'cases', title: '用例库', requiresAuth: true },
        'testplans': { section: 'testplans', title: '测试计划', requiresAuth: true },
        'reports': { section: 'reports', title: '测试报告', requiresAuth: true },
        'settings': { section: 'settings', title: '配置中心', requiresAuth: true },
        'knowledge': { section: 'knowledge', title: '知识库', requiresAuth: true },
        'ai-generation': { section: 'ai-generation', title: 'AI生成', requiresAuth: true },
        'agent-console': { section: 'agent-console', title: 'Agent控制台', requiresAuth: true },
        'login': { section: 'login', title: '登录', requiresAuth: false },
        'register': { section: 'register', title: '注册', requiresAuth: false }
    },

    defaultRoute: 'workspace',
    loginRoute: 'login',
    initialized: false,

    init() {
        if (this.initialized) {
            return;
        }
        this.initialized = true;
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

        if (!route) {
            console.warn('[Router] 未知路由，跳转到默认页面');
            this.navigateTo(this.defaultRoute);
            return;
        }

        if (route.requiresAuth && !this.isAuthenticated()) {
            this.navigateTo('login');
            return;
        }

        if (route.requiresAdmin && !this.isAdmin()) {
            showErrorMessage('只有管理员才能访问此页面');
            this.navigateTo(this.defaultRoute);
            return;
        }

        if (!route.requiresAuth && this.isAuthenticated()) {
            if (routeName === 'login' || routeName === 'register') {
                this.navigateTo(this.defaultRoute);
                return;
            }
        }

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

        const hash = window.location.hash;
        const libraryIdMatch = hash.match(/libraryId=(\d+)/);
        if (sectionId === 'cases' && libraryIdMatch) {
            const urlLibraryId = parseInt(libraryIdMatch[1]);
            const library = caseLibraries.find(lib => lib.id == urlLibraryId);
            if (library) {
                currentCaseLibraryId = urlLibraryId;

                const currentCaseLibraryElement = document.getElementById('current-case-library');
                if (currentCaseLibraryElement) {
                    currentCaseLibraryElement.textContent = library.name;
                }

                sectionId = 'case-management';
            }
        }

        document.querySelectorAll('section').forEach(section => {
            section.style.display = 'none';
        });

        const targetSection = document.getElementById(`${sectionId}-section`);
        if (targetSection) {
            const flexSections = ['knowledge-section', 'ai-generation-section'];
            targetSection.style.display = flexSections.includes(targetSection.id) ? 'flex' : 'block';
        }

        const loginSection = document.getElementById('login-section');
        const registerSection = document.getElementById('register-section');
        if (loginSection) loginSection.style.display = 'none';
        if (registerSection) registerSection.style.display = 'none';

        const testlinkContainer = document.querySelector('.testlink-container');
        if (testlinkContainer) {
            testlinkContainer.style.display = 'flex';
        }

        switch (sectionId) {
            case 'cases':
                initModuleData().then(() => {
                    loadAllLevel1Points();
                });
                break;
            case 'case-management':
                clearLevel1PointsDisplay();
                currentModulePage = 1;
                initModuleData();
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
            case 'workspace':
                initWorkspace();
                break;
            case 'knowledge':
                if (typeof initKnowledgeLibrary === 'function') initKnowledgeLibrary();
                break;
            case 'ai-generation':
                if (typeof initAIGeneration === 'function') initAIGeneration();
                if (typeof applyAIGenerationContext === 'function') applyAIGenerationContext();
                break;
            case 'agent-console':
                if (typeof initAgentConsole === 'function') initAgentConsole();
                break;
            case 'dashboard':
                loadRecentLogins();
                updateStats();
                break;
        }
    },

    showLoginSection() {
        document.querySelectorAll('section').forEach(section => {
            section.style.display = 'none';
        });

        const testlinkContainer = document.querySelector('.testlink-container');
        if (testlinkContainer) {
            testlinkContainer.style.display = 'none';
        }

        const loginSection = document.getElementById('login-section');
        if (loginSection) {
            loginSection.style.display = 'flex';
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
