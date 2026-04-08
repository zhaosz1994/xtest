const TestCaseService = {
    testCases: [],
    currentPage: 1,
    pageSize: 32,

    async load(options = {}) {
        try {
            const page = options.page || this.currentPage;
            const pageSize = options.pageSize || this.pageSize;
            
            const response = await apiRequest('/cases/list', {
                method: 'POST',
                body: JSON.stringify({ page, pageSize })
            });

            if (response.success && response.testCases) {
                this.testCases = response.testCases;
                return { success: true, testCases: this.testCases };
            } else {
                return { success: false, message: '获取用例失败' };
            }
        } catch (error) {
            console.error('加载用例错误:', error);
            return { success: false, message: error.message };
        }
    },

    async create(caseData) {
        try {
            showLoading('创建用例中...');
            const response = await apiRequest('/cases/create', {
                method: 'POST',
                body: JSON.stringify(caseData)
            });

            if (response.success) {
                showSuccessMessage('用例创建成功');
                DataEventManager.emit(DataEvents.TEST_CASE_CHANGED, { action: 'create', caseData });
                return { success: true, caseId: response.caseId };
            } else {
                showErrorMessage(response.message || '创建失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('创建用例错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async update(caseId, caseData) {
        try {
            showLoading('更新用例中...');
            const response = await apiRequest(`/cases/update?id=${caseId}`, {
                method: 'PUT',
                body: JSON.stringify(caseData)
            });

            if (response.success) {
                showSuccessMessage('用例更新成功');
                DataEventManager.emit(DataEvents.TEST_CASE_CHANGED, { action: 'update', caseId, caseData });
                return { success: true };
            } else {
                showErrorMessage(response.message || '更新失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('更新用例错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async delete(caseId) {
        try {
            showLoading('删除用例中...');
            const response = await apiRequest(`/cases/delete?id=${caseId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('用例删除成功');
                DataEventManager.emit(DataEvents.TEST_CASE_CHANGED, { action: 'delete', caseId });
                return { success: true };
            } else {
                showErrorMessage(response.message || '删除失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('删除用例错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async batchDelete(caseIds) {
        try {
            showLoading(`正在删除 ${caseIds.length} 个用例...`);
            const response = await apiRequest('/cases/batch-delete', {
                method: 'POST',
                body: JSON.stringify({ caseIds })
            });

            if (response.success) {
                showSuccessMessage(`成功删除 ${response.count} 个用例`);
                DataEventManager.emit(DataEvents.TEST_CASE_CHANGED, { action: 'batchDelete', caseIds });
                return { success: true, count: response.count };
            } else {
                showErrorMessage(response.message || '批量删除失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('批量删除用例错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async batchUpdateStatus(caseIds, status) {
        try {
            showLoading(`正在更新 ${caseIds.length} 个用例状态...`);
            const response = await apiRequest('/cases/batch-status', {
                method: 'POST',
                body: JSON.stringify({ caseIds, status })
            });

            if (response.success) {
                showSuccessMessage(`成功更新 ${response.count} 个用例状态`);
                DataEventManager.emit(DataEvents.TEST_CASE_CHANGED, { action: 'batchUpdate', caseIds, status });
                return { success: true, count: response.count };
            } else {
                showErrorMessage(response.message || '批量更新失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('批量更新用例状态错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    getById(caseId) {
        return this.testCases.find(c => c.id === caseId || c.caseId === caseId);
    },

    filter(predicate) {
        return this.testCases.filter(predicate);
    },

    search(keyword) {
        const lower = keyword.toLowerCase();
        return this.testCases.filter(c => 
            c.name?.toLowerCase().includes(lower) ||
            c.caseId?.toLowerCase().includes(lower) ||
            c.creator?.toLowerCase().includes(lower)
        );
    },

    getDefaultCases() {
        return [
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
};

async function loadTestCases() {
    try {
        showLoading('加载用例中...');

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
            testCases = TestCaseService.getDefaultCases();
        }

        if (document.getElementById('cases-table-body')) {
            renderCasesTable();
        }
    } catch (error) {
        console.error('加载用例错误:', error);
        testCases = TestCaseService.getDefaultCases();
        renderCasesTable();
    } finally {
        hideLoading();
    }
}

function renderCasesTable(filteredCases = null) {
    const tableBody = document.getElementById('cases-table-body');
    if (!tableBody) {
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

async function deleteTestCase() {
    const caseId = window.currentDeletingCaseId;
    if (!caseId) {
        showErrorMessage('用例ID不存在');
        return;
    }

    try {
        const result = await TestCaseService.delete(caseId);
        if (result.success) {
            await loadTestCases();
            closeModal();
        }
    } catch (error) {
        console.error('删除用例错误:', error);
    }
}
