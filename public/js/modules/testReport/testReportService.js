const TestReportService = {
    testReports: [],
    currentPage: 1,
    pageSize: 50,

    async load(options = {}) {
        try {
            const page = options.page || this.currentPage;
            const pageSize = options.pageSize || this.pageSize;
            
            const response = await apiRequest('/reports/list', {
                method: 'POST',
                body: JSON.stringify({ page, pageSize })
            });

            if (response.success && response.reports) {
                this.testReports = response.reports;
                return { success: true, reports: this.testReports };
            } else {
                return { success: false, message: '获取报告失败' };
            }
        } catch (error) {
            console.error('加载测试报告错误:', error);
            return { success: false, message: error.message };
        }
    },

    async create(reportData) {
        try {
            showLoading('创建测试报告中...');
            const response = await apiRequest('/reports/create', {
                method: 'POST',
                body: JSON.stringify(reportData)
            });

            if (response.success) {
                showSuccessMessage('测试报告创建成功');
                DataEventManager.emit(DataEvents.TEST_REPORT_CHANGED, { action: 'create', reportData });
                return { success: true, reportId: response.reportId };
            } else {
                showErrorMessage(response.message || '创建失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('创建测试报告错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async delete(reportId) {
        try {
            showLoading('删除测试报告中...');
            const response = await apiRequest(`/reports/delete?id=${reportId}`, {
                method: 'DELETE'
            });

            if (response.success) {
                showSuccessMessage('测试报告删除成功');
                DataEventManager.emit(DataEvents.TEST_REPORT_CHANGED, { action: 'delete', reportId });
                return { success: true };
            } else {
                showErrorMessage(response.message || '删除失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('删除测试报告错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    async export(reportId, format = 'pdf') {
        try {
            showLoading('导出报告中...');
            const response = await apiRequest(`/reports/export?id=${reportId}&format=${format}`);

            if (response.success) {
                return { success: true, downloadUrl: response.downloadUrl };
            } else {
                showErrorMessage(response.message || '导出失败');
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('导出测试报告错误:', error);
            showErrorMessage(error.message);
            return { success: false, message: error.message };
        } finally {
            hideLoading();
        }
    },

    getById(reportId) {
        return this.testReports.find(r => r.id === reportId);
    },

    filter(predicate) {
        return this.testReports.filter(predicate);
    },

    getByProject(projectName) {
        return this.testReports.filter(r => r.project === projectName);
    },

    getByStatus(status) {
        return this.testReports.filter(r => r.status === status);
    },

    getRecent(limit = 10) {
        return this.testReports
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit);
    },

    calculateStatistics(reports) {
        if (!reports || reports.length === 0) {
            return {
                total: 0,
                completed: 0,
                inProgress: 0,
                avgPassRate: 0
            };
        }

        const completed = reports.filter(r => r.status === 'completed').length;
        const inProgress = reports.filter(r => r.status === 'in_progress').length;
        const avgPassRate = reports.reduce((sum, r) => sum + (r.passRate || 0), 0) / reports.length;

        return {
            total: reports.length,
            completed,
            inProgress,
            avgPassRate: Math.round(avgPassRate * 100) / 100
        };
    }
};

async function loadTestReports() {
    try {
        showLoading('加载测试报告中...');

        const testReportsData = await apiRequest('/reports/list');

        if (testReportsData.success && testReportsData.reports) {
            testReports = testReportsData.reports;
        } else {
            testReports = [];
        }

        if (typeof loadReportsData === 'function') {
            loadReportsData();
        }
        if (typeof updateReportsStats === 'function') {
            updateReportsStats(testReports);
        }

    } catch (error) {
        console.error('加载测试报告失败:', error);
        testReports = [];
        if (typeof loadReportsData === 'function') {
            loadReportsData();
        }
    } finally {
        hideLoading();
    }
}

function renderTestReportsTable(filteredReports = null) {
    const tableBody = document.getElementById('reports-table-body');
    if (!tableBody) return;

    const reportsToRender = filteredReports || testReports;

    if (reportsToRender.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="no-data">暂无测试报告</td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = reportsToRender.map(report => {
        const statusText = getStatusText(report.status);
        const statusClass = getStatusTagClass(report.status);

        return `
            <tr>
                <td>${report.name}</td>
                <td>${report.projectName || report.project}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
                <td>${report.passRate}%</td>
                <td>${report.testedCases}/${report.totalCases}</td>
                <td>${formatDate(report.createdAt)}</td>
                <td>
                    <button class="report-action-btn view" onclick="viewReport(${report.id})">查看</button>
                    <button class="report-action-btn export" onclick="exportReport(${report.id})">导出</button>
                    <button class="report-action-btn delete" onclick="deleteReport(${report.id})">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderProjectsList() {
    const tableBody = document.getElementById('projects-table-body');
    if (!tableBody || !projects) return;

    if (projects.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" class="no-data">暂无项目</td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = projects.map(project => `
        <tr>
            <td>${project.name}</td>
            <td>${project.reportCount || 0}</td>
            <td>${formatDate(project.createdAt)}</td>
            <td>
                <button class="project-action-btn view" onclick="selectProject('${project.name}')">查看报告</button>
            </td>
        </tr>
    `).join('');
}

function selectProject(projectName) {
    const projectReports = TestReportService.getByProject(projectName);
    renderProjectReports(projectReports);
}

function renderProjectReports(reports, page = 1, pageSize = 50) {
    const container = document.getElementById('project-reports-container');
    if (!container) return;

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageReports = reports.slice(startIndex, endIndex);

    if (pageReports.length === 0) {
        container.innerHTML = '<div class="no-data">该项目暂无报告</div>';
        return;
    }

    container.innerHTML = pageReports.map(report => `
        <div class="report-card">
            <h4>${report.name}</h4>
            <div class="report-info">
                <span>通过率: ${report.passRate}%</span>
                <span>用例: ${report.testedCases}/${report.totalCases}</span>
                <span>创建时间: ${formatDate(report.createdAt)}</span>
            </div>
            <div class="report-actions">
                <button onclick="viewReport(${report.id})">查看详情</button>
            </div>
        </div>
    `).join('');
}

async function deleteReport(reportId) {
    if (!(await showConfirmMessage('确定要删除这个测试报告吗？'))) return;
    
    const result = await TestReportService.delete(reportId);
    if (result.success) {
        await loadTestReports();
    }
}

async function exportReport(reportId, format = 'pdf') {
    const result = await TestReportService.export(reportId, format);
    if (result.success && result.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
    }
}
