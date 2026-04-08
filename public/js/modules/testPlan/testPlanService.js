const TestPlanService = {
    testPlans: [],
    currentPage: 1,
    pageSize: 32,

    async load(options = {}) {
        try {
            const useCache = options.useCache !== false;
            const response = await apiRequest('/testplans/list', { useCache });

            if (response.success && response.testPlans) {
                this.testPlans = response.testPlans;
                return { success: true, testPlans: this.testPlans };
            } else {
                this.testPlans = this.getDefaultPlans();
                return { success: true, testPlans: this.testPlans };
            }
        } catch (error) {
            console.error('加载测试计划错误:', error);
            this.testPlans = this.getDefaultPlans();
            return { success: false, testPlans: this.testPlans };
        }
    },

    async create(planData) {
        try {
            showLoading('创建测试计划中...');
            const response = await apiRequest('/testplans/create', {
                method: 'POST',
                body: JSON.stringify(planData)
            });

            if (response.success) {
                showSuccessMessage('测试计划创建成功');
                DataEventManager.emit(DataEvents.TEST_PLAN_CHANGED, { action: 'create', planData });
                return { success: true, planId: response.planId };
            } else {
                showErrorMessage(response.message || '创建失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('创建测试计划错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async update(planId, planData) {
        try {
            showLoading('更新测试计划中...');
            const response = await apiRequest(`/testplans/update?id=${planId}`, {
                method: 'PUT',
                body: JSON.stringify(planData)
            });

            if (response.success) {
                showSuccessMessage('测试计划更新成功');
                DataEventManager.emit(DataEvents.TEST_PLAN_CHANGED, { action: 'update', planId, planData });
                return { success: true };
            } else {
                showErrorMessage(response.message || '更新失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('更新测试计划错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async delete(planId) {
        try {
            showLoading('删除测试计划中...');
            const response = await apiRequest(`/testplans/delete?id=${planId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('测试计划删除成功');
                DataEventManager.emit(DataEvents.TEST_PLAN_CHANGED, { action: 'delete', planId });
                return { success: true };
            } else {
                showErrorMessage(response.message || '删除失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('删除测试计划错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async execute(planId) {
        try {
            showLoading('启动测试计划中...');
            const response = await apiRequest(`/testplans/execute?id=${planId}`, {
                method: 'POST'
            });

            if (response.success) {
                showSuccessMessage('测试计划已启动');
                return { success: true };
            } else {
                showErrorMessage(response.message || '启动失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('启动测试计划错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async pause(planId) {
        try {
            showLoading('暂停测试计划中...');
            const response = await apiRequest(`/testplans/pause?id=${planId}`, {
                method: 'POST'
            });

            if (response.success) {
                showSuccessMessage('测试计划已暂停');
                return { success: true };
            } else {
                showErrorMessage(response.message || '暂停失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('暂停测试计划错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async resume(planId) {
        try {
            showLoading('恢复测试计划中...');
            const response = await apiRequest(`/testplans/resume?id=${planId}`, {
                method: 'POST'
            });

            if (response.success) {
                showSuccessMessage('测试计划已恢复');
                return { success: true };
            } else {
                showErrorMessage(response.message || '恢复失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('恢复测试计划错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    getById(planId) {
        return this.testPlans.find(p => p.id === planId);
    },

    filter(predicate) {
        return this.testPlans.filter(predicate);
    },

    getByStatus(status) {
        return this.testPlans.filter(p => p.status === status);
    },

    getByOwner(owner) {
        return this.testPlans.filter(p => p.owner === owner);
    },

    calculatePlanStatus(plan) {
        if (!plan) return 'not_started';
        
        if (plan.status === 'completed') return 'completed';
        if (plan.status === 'paused') return 'paused';
        if (plan.status === 'cancelled') return 'cancelled';
        
        if (plan.testedCases > 0 && plan.testedCases < plan.totalCases) {
            return 'in_progress';
        }
        
        if (plan.testedCases === plan.totalCases && plan.totalCases > 0) {
            return 'completed';
        }
        
        return 'not_started';
    },

    getDefaultPlans() {
        return [
            {
                id: 1,
                name: 'SDK功能测试计划',
                owner: 'admin',
                ownerName: '管理员',
                status: 'in_progress',
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
                status: 'not_started',
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
                status: 'completed',
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
                status: 'in_progress',
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
};

async function loadTestPlans() {
    try {
        showLoading('加载测试计划中...');

        const testPlansData = await apiRequest('/testplans/list', { useCache: false });

        if (testPlansData.success && testPlansData.testPlans) {
            testPlans = testPlansData.testPlans;
        } else {
            testPlans = TestPlanService.getDefaultPlans();
        }

        if (typeof loadTestPlanFilters === 'function') {
            await loadTestPlanFilters();
        }

        renderTestPlansTable();
    } catch (error) {
        console.error('加载测试计划错误:', error);
        testPlans = TestPlanService.getDefaultPlans();
        renderTestPlansTable();
    } finally {
        hideLoading();
    }
}

function renderTestPlansTable(filteredPlans = null) {
    const tableBody = document.getElementById('testplans-table-body');
    if (!tableBody) return;

    const plansToRender = filteredPlans || testPlans;

    if (plansToRender.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="no-data">暂无测试计划</td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = plansToRender.map(plan => {
        const status = TestPlanService.calculatePlanStatus(plan);
        const statusText = getStatusText(status);
        const statusClass = getStatusTagClass(status);

        return `
            <tr>
                <td>${plan.name}</td>
                <td>${plan.ownerName || plan.owner}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
                <td>${plan.passRate}%</td>
                <td>${plan.testedCases}/${plan.totalCases}</td>
                <td>${plan.projectName || plan.project}</td>
                <td>${plan.createdAt}</td>
                <td>
                    <button class="plan-action-btn view" onclick="viewTestPlanDetail(${plan.id})">查看</button>
                    <button class="plan-action-btn edit" onclick="editTestPlan(${plan.id})">编辑</button>
                    <button class="plan-action-btn delete" onclick="deleteTestPlan(${plan.id})">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function executeTestPlan(planId) {
    const result = await TestPlanService.execute(planId);
    if (result.success) {
        await loadTestPlans();
    }
}

async function pauseTestPlan(planId) {
    const result = await TestPlanService.pause(planId);
    if (result.success) {
        await loadTestPlans();
    }
}

async function resumeTestPlan(planId) {
    const result = await TestPlanService.resume(planId);
    if (result.success) {
        await loadTestPlans();
    }
}

async function deleteTestPlan(planId) {
    if (!(await showConfirmMessage('确定要删除这个测试计划吗？'))) return;
    
    const result = await TestPlanService.delete(planId);
    if (result.success) {
        await loadTestPlans();
    }
}

function filterTestPlans(status) {
    if (!status || status === 'all') {
        renderTestPlansTable();
    } else {
        const filtered = TestPlanService.getByStatus(status);
        renderTestPlansTable(filtered);
    }
}
