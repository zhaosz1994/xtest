console.log('[Main] 模块化重构 - 核心模块已加载');

console.log('[Main] 可用的全局对象:');
console.log('  - API_BASE_URL:', typeof API_BASE_URL !== 'undefined' ? '已定义' : '未定义');
console.log('  - DataEvents:', typeof DataEvents !== 'undefined' ? '已定义' : '未定义');
console.log('  - DataEventManager:', typeof DataEventManager !== 'undefined' ? '已定义' : '未定义');
console.log('  - apiCache:', typeof apiCache !== 'undefined' ? '已定义' : '未定义');
console.log('  - Router:', typeof Router !== 'undefined' ? '已定义' : '未定义');

console.log('[Main] 可用的工具函数:');
console.log('  - debounce:', typeof debounce !== 'undefined' ? '已定义' : '未定义');
console.log('  - throttle:', typeof throttle !== 'undefined' ? '已定义' : '未定义');
console.log('  - formatDateTime:', typeof formatDateTime !== 'undefined' ? '已定义' : '未定义');
console.log('  - showLoading:', typeof showLoading !== 'undefined' ? '已定义' : '未定义');
console.log('  - showSuccessMessage:', typeof showSuccessMessage !== 'undefined' ? '已定义' : '未定义');
console.log('  - showErrorMessage:', typeof showErrorMessage !== 'undefined' ? '已定义' : '未定义');
