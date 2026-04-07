const ModuleService = {
    modules: [],
    currentPage: 1,
    pageSize: 32,

    async load(libraryId, options = {}) {
        try {
            const page = options.page || this.currentPage;
            const pageSize = options.pageSize || this.pageSize;
            
            const response = await apiRequest(`/modules/list?libraryId=${libraryId}`, {
                method: 'POST',
                body: JSON.stringify({ page, pageSize })
            });

            if (response.success && response.modules) {
                this.modules = response.modules;
                return { success: true, modules: this.modules };
            } else {
                return { success: false, message: '获取模块失败' };
            }
        } catch (error) {
            console.error('加载模块错误:', error);
            return { success: false, message: error.message };
        }
    },

    async create(moduleData) {
        try {
            showLoading('创建模块中...');
            const response = await apiRequest('/modules/create', {
                method: 'POST',
                body: JSON.stringify(moduleData)
            });

            if (response.success) {
                showSuccessMessage('模块创建成功');
                DataEventManager.emit(DataEvents.MODULE_CHANGED, { action: 'create', moduleData });
                return { success: true, moduleId: response.moduleId };
            } else {
                showErrorMessage(response.message || '创建失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('创建模块错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async update(moduleId, moduleData) {
        try {
            showLoading('更新模块中...');
            const response = await apiRequest(`/modules/update?id=${moduleId}`, {
                method: 'PUT',
                body: JSON.stringify(moduleData)
            });

            if (response.success) {
                showSuccessMessage('模块更新成功');
                DataEventManager.emit(DataEvents.MODULE_CHANGED, { action: 'update', moduleId, moduleData });
                return { success: true };
            } else {
                showErrorMessage(response.message || '更新失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('更新模块错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async delete(moduleId) {
        try {
            showLoading('删除模块中...');
            const response = await apiRequest(`/modules/delete?id=${moduleId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('模块删除成功');
                DataEventManager.emit(DataEvents.MODULE_CHANGED, { action: 'delete', moduleId });
                return { success: true };
            } else {
                showErrorMessage(response.message || '删除失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('删除模块错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async reorder(moduleOrders) {
        try {
            showLoading('调整模块顺序中...');
            const response = await apiRequest('/modules/reorder', {
                method: 'POST',
                body: JSON.stringify({ orders: moduleOrders })
            });

            if (response.success) {
                showSuccessMessage('模块顺序已更新');
                DataEventManager.emit(DataEvents.MODULE_CHANGED, { action: 'reorder', moduleOrders });
                return { success: true };
            } else {
                showErrorMessage(response.message || '更新失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('调整模块顺序错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    getById(moduleId) {
        return this.modules.find(m => m.id === moduleId);
    },

    filter(predicate) {
        return this.modules.filter(predicate);
    },

    search(keyword) {
        const lower = keyword.toLowerCase();
        return this.modules.filter(m => 
            m.name?.toLowerCase().includes(lower)
        );
    },

    getByParent(parentId) {
        return this.modules.filter(m => m.parentId === parentId);
    },

    getRootModules() {
        return this.modules.filter(m => !m.parentId);
    }
};

async function initModuleData() {
    try {
        if (!currentCaseLibraryId) {
            console.warn('当前用例库ID不存在');
            return;
        }

        const response = await ModuleService.load(currentCaseLibraryId);
        
        if (response.success) {
            moduleList = response.modules;
            updateModuleDisplay();
        } else {
            console.error('加载模块失败:', response.message);
            moduleList = [];
        }
    } catch (error) {
        console.error('初始化模块数据错误:', error);
        moduleList = [];
    }
}

function updateModuleDisplay() {
    const container = document.getElementById('modules-container');
    if (!container) return;

    if (moduleList.length === 0) {
        container.innerHTML = '<div class="no-data">暂无模块</div>';
        return;
    }

    container.innerHTML = moduleList.map(module => `
        <div class="module-item" data-module-id="${module.id}">
            <div class="module-name">${module.name}</div>
            <div class="module-actions">
                <button onclick="editModule(${module.id})">编辑</button>
                <button onclick="deleteModule(${module.id})">删除</button>
            </div>
        </div>
    `).join('');
}

async function openAddModuleModal() {
    const modal = document.getElementById('add-module-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeAddModuleModal() {
    const modal = document.getElementById('add-module-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function submitAddModuleForm() {
    const nameInput = document.getElementById('module-name');
    if (!nameInput || !nameInput.value.trim()) {
        showErrorMessage('请输入模块名称');
        return;
    }

    const moduleData = {
        name: nameInput.value.trim(),
        libraryId: currentCaseLibraryId,
        parentId: null
    };

    const result = await ModuleService.create(moduleData);
    if (result.success) {
        closeAddModuleModal();
        await initModuleData();
    }
}

async function editModule(moduleId) {
    const module = ModuleService.getById(moduleId);
    if (!module) {
        showErrorMessage('模块不存在');
        return;
    }

    const newName = await showPromptModal({
        title: '编辑模块',
        message: '请输入新的模块名称：',
        defaultValue: module.name,
        placeholder: '请输入模块名称'
    });
    
    if (newName && newName.trim() !== module.name) {
        const result = await ModuleService.update(moduleId, { name: newName.trim() });
        if (result.success) {
            await initModuleData();
        }
    }
}

async function deleteModule(moduleId) {
    if (!(await showConfirmMessage('确定要删除这个模块吗？相关的测试点也会被删除。'))) return;
    
    const result = await ModuleService.delete(moduleId);
    if (result.success) {
        await initModuleData();
    }
}

function initModuleSearch() {
    const searchInput = document.getElementById('module-search');
    if (!searchInput) return;

    searchInput.addEventListener('input', debounce((e) => {
        const keyword = e.target.value.trim();
        if (keyword) {
            const filtered = ModuleService.search(keyword);
            moduleList = filtered;
            updateModuleDisplay();
        } else {
            initModuleData();
        }
    }, 300));
}
