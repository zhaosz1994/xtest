const ModuleLoader = {
    modules: [
        { name: 'config/constants', loaded: false, required: true },
        { name: 'utils/helpers', loaded: false, required: true },
        { name: 'core/eventManager', loaded: false, required: true },
        { name: 'core/apiClient', loaded: false, required: true },
        { name: 'core/router', loaded: false, required: true },
        { name: 'components/notifications/toast', loaded: false, required: true },
        { name: 'services/storage', loaded: false, required: false },
        { name: 'services/theme', loaded: false, required: false },
        { name: 'services/websocket', loaded: false, required: false },
        { name: 'testCase/testCaseService', loaded: false, required: false },
        { name: 'testPlan/testPlanService', loaded: false, required: false },
        { name: 'testReport/testReportService', loaded: false, required: false },
        { name: 'module/moduleService', loaded: false, required: false },
        { name: 'workspace/workspaceService', loaded: false, required: false },
        { name: 'features/commandPalette', loaded: false, required: false },
        { name: 'features/gamification', loaded: false, required: false },
        { name: 'features/search', loaded: false, required: false }
    ],

    loadedCount: 0,
    totalCount: 0,

    init() {
        this.totalCount = this.modules.length;
        console.log(`[ModuleLoader] 开始加载 ${this.totalCount} 个模块...`);
        
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
                    
                    console.log(`[ModuleLoader] ✓ ${module.name} (${this.loadedCount}/${this.totalCount})`);
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
            const endTime = performance.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2);
            
            console.log(`[ModuleLoader] 所有模块加载完成，耗时 ${duration}s`);
            console.log(`[ModuleLoader] 成功: ${this.loadedCount}/${this.totalCount}`);
            
            this.initializeModules();
        });
    },

    updateProgress() {
        const progress = Math.round((this.loadedCount / this.totalCount) * 100);
        
        if (typeof showLoading === 'function') {
            showLoading(`加载模块中... ${progress}%`);
        }
    },

    handleRequiredModuleError(moduleName) {
        console.error(`[ModuleLoader] 必需模块 ${moduleName} 加载失败，应用可能无法正常运行`);
        
        if (typeof showErrorMessage === 'function') {
            showErrorMessage(`核心模块 ${moduleName} 加载失败，请刷新页面重试`);
        }
    },

    initializeModules() {
        console.log('[ModuleLoader] 初始化模块...');
        
        if (typeof StorageService !== 'undefined') {
            console.log('[ModuleLoader] ✓ StorageService 已就绪');
        }
        
        if (typeof ThemeService !== 'undefined') {
            ThemeService.init();
            console.log('[ModuleLoader] ✓ ThemeService 已初始化');
        }
        
        if (typeof Router !== 'undefined') {
            Router.init();
            console.log('[ModuleLoader] ✓ Router 已初始化');
        }
        
        if (typeof CommandPalette !== 'undefined') {
            CommandPalette.init();
            console.log('[ModuleLoader] ✓ CommandPalette 已初始化');
        }
        
        console.log('[ModuleLoader] 所有模块初始化完成');
        
        if (typeof hideLoading === 'function') {
            hideLoading();
        }
        
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
            console.log(`[ModuleLoader] ✓ ${moduleName} 重新加载成功`);
        };
        
        script.onerror = () => {
            console.error(`[ModuleLoader] ✗ ${moduleName} 重新加载失败`);
        };
        
        document.head.appendChild(script);
        return true;
    }
};

(function() {
    console.log('[ModuleLoader] 模块加载器已就绪');
})();
