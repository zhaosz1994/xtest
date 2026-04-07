console.log('========================================');
console.log('🚀 script.js 模块化重构 - 集成测试');
console.log('========================================');

const ModuleTest = {
    results: {
        passed: 0,
        failed: 0,
        total: 0
    },

    test(name, condition) {
        this.results.total++;
        if (condition) {
            this.results.passed++;
            console.log(`✅ ${name}`);
            return true;
        } else {
            this.results.failed++;
            console.error(`❌ ${name}`);
            return false;
        }
    },

    runAllTests() {
        console.log('\n📦 测试模块加载状态...\n');

        this.test('配置模块 - API_BASE_URL', typeof API_BASE_URL !== 'undefined');
        this.test('配置模块 - DataEvents', typeof DataEvents !== 'undefined');
        this.test('配置模块 - APP_CONFIG', typeof APP_CONFIG !== 'undefined');

        this.test('工具模块 - debounce', typeof debounce === 'function');
        this.test('工具模块 - throttle', typeof throttle === 'function');
        this.test('工具模块 - formatDateTime', typeof formatDateTime === 'function');
        this.test('工具模块 - getCurrentDateTime', typeof getCurrentDateTime === 'function');

        this.test('核心模块 - DataEventManager', typeof DataEventManager !== 'undefined');
        this.test('核心模块 - apiCache', typeof apiCache !== 'undefined');
        this.test('核心模块 - apiRequest', typeof apiRequest === 'function');
        this.test('核心模块 - Router', typeof Router !== 'undefined');

        this.test('UI组件 - showLoading', typeof showLoading === 'function');
        this.test('UI组件 - hideLoading', typeof hideLoading === 'function');
        this.test('UI组件 - showSuccessMessage', typeof showSuccessMessage === 'function');
        this.test('UI组件 - showErrorMessage', typeof showErrorMessage === 'function');

        this.test('服务层 - StorageService', typeof StorageService !== 'undefined');
        this.test('服务层 - ThemeService', typeof ThemeService !== 'undefined');
        this.test('服务层 - WebSocketService', typeof WebSocketService !== 'undefined');

        this.test('业务模块 - TestCaseService', typeof TestCaseService !== 'undefined');
        this.test('业务模块 - TestPlanService', typeof TestPlanService !== 'undefined');
        this.test('业务模块 - TestReportService', typeof TestReportService !== 'undefined');
        this.test('业务模块 - ModuleService', typeof ModuleService !== 'undefined');
        this.test('业务模块 - WorkspaceService', typeof WorkspaceService !== 'undefined');

        this.test('功能特性 - CommandPalette', typeof CommandPalette !== 'undefined');

        console.log('\n📊 测试结果统计:\n');
        console.log(`总计: ${this.results.total} 个测试`);
        console.log(`通过: ${this.results.passed} 个 ✅`);
        console.log(`失败: ${this.results.failed} 个 ❌`);
        console.log(`成功率: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);

        if (this.results.failed === 0) {
            console.log('\n🎉 所有模块测试通过！');
        } else {
            console.log('\n⚠️ 部分模块测试失败，请检查控制台错误信息');
        }

        console.log('\n========================================');
        console.log('测试完成');
        console.log('========================================\n');

        return this.results;
    },

    testModuleFunctionality() {
        console.log('\n🔧 测试模块功能...\n');

        if (typeof formatDateTime === 'function') {
            const now = formatDateTime(new Date());
            console.log(`formatDateTime 测试: ${now}`);
            this.test('formatDateTime 功能', now !== '-');
        }

        if (typeof getCurrentDateTime === 'function') {
            const current = getCurrentDateTime();
            console.log(`getCurrentDateTime 测试: ${current}`);
            this.test('getCurrentDateTime 功能', current.length > 0);
        }

        if (typeof DataEventManager !== 'undefined') {
            let eventTriggered = false;
            DataEventManager.on('test', () => {
                eventTriggered = true;
            });
            DataEventManager.emit('test');
            this.test('DataEventManager 功能', eventTriggered);
        }

        if (typeof StorageService !== 'undefined') {
            StorageService.set('test_key', 'test_value');
            const value = StorageService.get('test_key');
            this.test('StorageService 功能', value === 'test_value');
            StorageService.remove('test_key');
        }

        if (typeof ThemeService !== 'undefined') {
            const themes = ThemeService.getAvailableThemes();
            this.test('ThemeService 功能', themes.length > 0);
        }

        if (typeof TestCaseService !== 'undefined') {
            const defaultCases = TestCaseService.getDefaultCases();
            this.test('TestCaseService 功能', defaultCases.length > 0);
        }

        if (typeof TestPlanService !== 'undefined') {
            const defaultPlans = TestPlanService.getDefaultPlans();
            this.test('TestPlanService 功能', defaultPlans.length > 0);
        }

        if (typeof WorkspaceService !== 'undefined') {
            const greeting = WorkspaceService.getGreeting();
            this.test('WorkspaceService 功能', greeting.length > 0);
        }
    },

    showModuleInfo() {
        console.log('\n📋 模块信息:\n');

        if (typeof ModuleLoader !== 'undefined') {
            const loaded = ModuleLoader.getLoadedModules();
            const failed = ModuleLoader.getFailedModules();
            
            console.log(`已加载模块: ${loaded.length} 个`);
            console.log(`加载失败模块: ${failed.length} 个`);
            
            if (failed.length > 0) {
                console.log('失败模块列表:', failed);
            }
        }

        console.log('\n全局对象检查:');
        console.log('  - API_BASE_URL:', typeof API_BASE_URL !== 'undefined' ? '✅' : '❌');
        console.log('  - Router:', typeof Router !== 'undefined' ? '✅' : '❌');
        console.log('  - DataEventManager:', typeof DataEventManager !== 'undefined' ? '✅' : '❌');
        console.log('  - TestCaseService:', typeof TestCaseService !== 'undefined' ? '✅' : '❌');
        console.log('  - TestPlanService:', typeof TestPlanService !== 'undefined' ? '✅' : '❌');
        console.log('  - StorageService:', typeof StorageService !== 'undefined' ? '✅' : '❌');
        console.log('  - ThemeService:', typeof ThemeService !== 'undefined' ? '✅' : '❌');
    }
};

setTimeout(() => {
    ModuleTest.runAllTests();
    ModuleTest.testModuleFunctionality();
    ModuleTest.showModuleInfo();
}, 1000);

window.ModuleTest = ModuleTest;
