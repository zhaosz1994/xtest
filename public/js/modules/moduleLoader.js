const ModuleLoader = {
    modules: [
        // AI 扩展模块 — script.js 中未包含，需要动态加载
        { name: 'ai-sub-agents', loaded: false, required: false },
        { name: 'ai-tools', loaded: false, required: false },
        { name: 'ai-memories', loaded: false, required: false },
        { name: 'ai-review', loaded: false, required: false }
    ],

    // 以下模块已内嵌在 script.js 中，不可重复加载（会导致 const/函数重定义冲突）：
    // - config/constants     → API_BASE_URL, DataEvents, APP_CONFIG, ROUTES, STATUS, PRIORITY
    // - utils/helpers        → 工具函数
    // - core/eventManager    → DataEventManager
    // - core/apiClient       → apiRequest, apiCache
    // - core/router          → Router
    // - components/notifications/toast → showLoading, hideLoading, showSuccessMessage 等
    // - services/storage     → StorageService
    // - services/theme       → ThemeService
    // - services/websocket   → WebSocket
    // - testCase/testCaseService  → TestCaseService
    // - testPlan/testPlanService  → TestPlanService
    // - testReport/testReportService → TestReportService
    // - module/moduleService → ModuleService
    // - workspace/workspaceService  → WorkspaceService, initWorkspace
    // - features/commandPalette     → CommandPalette
    // - features/gamification       → (不存在)
    // - features/search             → (不存在)

    loadedCount: 0,
    totalCount: 0,

    init() {
        this.totalCount = this.modules.length;
        this.loadAllModules();
    },

    loadAllModules() {
        const startTime = performance.now();

        this.modules.forEach(module => {
            try {
                const script = document.createElement('script');
                script.src = `/js/modules/${module.name}.js`;
                script.async = false;

                script.onload = () => {
                    module.loaded = true;
                    this.loadedCount++;
                    this.updateProgress();
                };

                script.onerror = () => {
                    console.error(`[ModuleLoader] ✗ ${module.name} 加载失败`);
                    if (module.required) {
                        this.handleRequiredModuleError(module.name);
                    }
                };

                document.head.appendChild(script);
            } catch (error) {
                console.error(`[ModuleLoader] 加载 ${module.name} 时出错:`, error);
            }
        });

        window.addEventListener('load', () => {
            this.initializeModules();
        });
    },

    updateProgress() {
        // AI 模块加载进度 — 仅打印日志，不覆盖页面上的 loading 状态
        console.log(`[ModuleLoader] 模块加载进度: ${this.loadedCount}/${this.totalCount}`);
    },

    handleRequiredModuleError(moduleName) {
        console.error(`[ModuleLoader] 必需模块 ${moduleName} 加载失败，应用可能无法正常运行`);

        if (typeof showErrorMessage === 'function') {
            showErrorMessage(`核心模块 ${moduleName} 加载失败，请刷新页面重试`);
        }
    },

    initializeModules() {
        // 核心模块（Router, ThemeService, CommandPalette 等）已在 script.js 中初始化
        // 这里只负责 AI 扩展模块的初始化通知
        console.log('[ModuleLoader] AI 扩展模块加载完成:', this.getLoadedModules().join(', '));
        this.emit('modulesLoaded');
    },

    listeners: {},

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    },

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[ModuleLoader] 事件处理器错误 [${event}]:`, error);
            }
        });
    },

    getModuleStatus(moduleName) {
        const module = this.modules.find(m => m.name === moduleName);
        return module ? { loaded: module.loaded, required: module.required } : null;
    },

    getLoadedModules() {
        return this.modules.filter(m => m.loaded).map(m => m.name);
    },

    getFailedModules() {
        return this.modules.filter(m => !m.loaded).map(m => m.name);
    },

    isModuleLoaded(moduleName) {
        const module = this.modules.find(m => m.name === moduleName);
        return module ? module.loaded : false;
    },

    reloadModule(moduleName) {
        const module = this.modules.find(m => m.name === moduleName);
        if (!module) {
            console.warn(`[ModuleLoader] 模块 ${moduleName} 不存在`);
            return false;
        }

        const oldScripts = document.querySelectorAll(`script[src*="${moduleName}"]`);
        oldScripts.forEach(script => script.remove());

        module.loaded = false;
        this.loadedCount = this.modules.filter(m => m.loaded).length;

        const script = document.createElement('script');
        script.src = `/js/modules/${moduleName}.js`;

        script.onload = () => {
            module.loaded = true;
            this.loadedCount++;
        };

        script.onerror = () => {
            console.error(`[ModuleLoader] ✗ ${moduleName} 重新加载失败`);
        };

        document.head.appendChild(script);
        return true;
    }
};

(function() {
    ModuleLoader.init();
})();
