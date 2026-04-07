const Router = {
    routes: {
        'workspace': { section: 'workspace', title: '我的工作台', requiresAuth: true },
        'dashboard': { section: 'dashboard', title: '测试管理', requiresAuth: true },
        'cases': { section: 'cases', title: '用例库', requiresAuth: true },
        'testplans': { section: 'testplans', title: '测试计划', requiresAuth: true },
        'reports': { section: 'reports', title: '测试报告', requiresAuth: true },
        'settings': { section: 'settings', title: '配置中心', requiresAuth: true },
        'login': { section: 'login', title: '登录', requiresAuth: false },
        'register': { section: 'register', title: '注册', requiresAuth: false }
    },

    defaultRoute: 'workspace',
    loginRoute: 'login',
    initialized: false,

    init() {
        if (this.initialized) {
            console.log('[Router] 已经初始化，跳过重复初始化');
            return;
        }
        this.initialized = true;
        console.log('[Router] 初始化路由系统');
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

        const hash = window.location.hash;
        const libraryIdMatch = hash.match(/libraryId=(\d+)/);
        if (sectionId === 'cases' && libraryIdMatch) {
            const urlLibraryId = parseInt(libraryIdMatch[1]);
            const library = caseLibraries.find(lib => lib.id == urlLibraryId);
            if (library) {
                console.log('[Router.showSection] 从URL恢复用例库详情:', library.name, 'ID:', urlLibraryId);
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
