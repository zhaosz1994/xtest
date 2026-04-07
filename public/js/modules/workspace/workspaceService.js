const WorkspaceService = {
    dashboardData: null,

    async loadDashboard() {
        try {
            const response = await apiRequest('/workspace/dashboard');
            
            if (response.success) {
                this.dashboardData = response.data;
                return { success: true, data: this.dashboardData };
            } else {
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('加载工作台数据错误:', error);
            return { success: false, message: error.message };
        }
    },

    async getRecentActivities(limit = 10) {
        try {
            const response = await apiRequest(`/workspace/activities?limit=${limit}`);
            
            if (response.success) {
                return { success: true, activities: response.activities };
            } else {
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('获取最近活动错误:', error);
            return { success: false, message: error.message };
        }
    },

    async getMyTasks() {
        try {
            const response = await apiRequest('/workspace/my-tasks');
            
            if (response.success) {
                return { success: true, tasks: response.tasks };
            } else {
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('获取我的任务错误:', error);
            return { success: false, message: error.message };
        }
    },

    async getStatistics() {
        try {
            const response = await apiRequest('/workspace/statistics');
            
            if (response.success) {
                return { success: true, statistics: response.statistics };
            } else {
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('获取统计数据错误:', error);
            return { success: false, message: error.message };
        }
    },

    async getPendingReviews() {
        try {
            const response = await apiRequest('/workspace/pending-reviews');
            
            if (response.success) {
                return { success: true, reviews: response.reviews };
            } else {
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('获取待评审用例错误:', error);
            return { success: false, message: error.message };
        }
    },

    async getQuickLinks() {
        try {
            const response = await apiRequest('/workspace/quick-links');
            
            if (response.success) {
                return { success: true, links: response.links };
            } else {
                return { success: false, message: response.message };
            }
        } catch (error) {
            console.error('获取快捷链接错误:', error);
            return { success: false, message: error.message };
        }
    },

    calculateProgress(completed, total) {
        if (total === 0) return 0;
        return Math.round((completed / total) * 100);
    },

    getGreeting() {
        const hour = new Date().getHours();
        if (hour < 6) return '凌晨好';
        if (hour < 9) return '早上好';
        if (hour < 12) return '上午好';
        if (hour < 14) return '中午好';
        if (hour < 17) return '下午好';
        if (hour < 19) return '傍晚好';
        if (hour < 22) return '晚上好';
        return '夜深了';
    }
};

async function initWorkspace() {
    try {
        showLoading('加载工作台...');

        const dashboardResult = await WorkspaceService.loadDashboard();
        
        if (dashboardResult.success) {
            renderWorkspaceDashboard(dashboardResult.data);
        }

        const tasksResult = await WorkspaceService.getMyTasks();
        if (tasksResult.success) {
            renderMyTasks(tasksResult.tasks);
        }

        const reviewsResult = await WorkspaceService.getPendingReviews();
        if (reviewsResult.success) {
            renderPendingReviews(reviewsResult.reviews);
        }

        const statsResult = await WorkspaceService.getStatistics();
        if (statsResult.success) {
            renderStatistics(statsResult.statistics);
        }

    } catch (error) {
        console.error('初始化工作台错误:', error);
        showErrorMessage('加载工作台失败');
    } finally {
        hideLoading();
    }
}

function renderWorkspaceDashboard(data) {
    if (!data) return;

    const greetingEl = document.getElementById('workspace-greeting');
    if (greetingEl) {
        const greeting = WorkspaceService.getGreeting();
        greetingEl.textContent = `${greeting}，${currentUser?.username || '用户'}`;
    }

    const statsContainer = document.getElementById('workspace-stats');
    if (statsContainer && data.statistics) {
        const stats = data.statistics;
        statsContainer.innerHTML = `
            <div class="stat-card">
                <div class="stat-value">${stats.totalCases || 0}</div>
                <div class="stat-label">测试用例</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.totalPlans || 0}</div>
                <div class="stat-label">测试计划</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.totalReports || 0}</div>
                <div class="stat-label">测试报告</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.passRate || 0}%</div>
                <div class="stat-label">平均通过率</div>
            </div>
        `;
    }
}

function renderMyTasks(tasks) {
    const container = document.getElementById('my-tasks-container');
    if (!container) return;

    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<div class="no-data">暂无待办任务</div>';
        return;
    }

    container.innerHTML = tasks.slice(0, 5).map(task => `
        <div class="task-item">
            <div class="task-name">${task.name}</div>
            <div class="task-meta">
                <span class="task-type">${task.type}</span>
                <span class="task-deadline">${formatDate(task.deadline)}</span>
            </div>
        </div>
    `).join('');
}

function renderPendingReviews(reviews) {
    const container = document.getElementById('pending-reviews-container');
    if (!container) return;

    if (!reviews || reviews.length === 0) {
        container.innerHTML = '<div class="no-data">暂无待评审用例</div>';
        return;
    }

    container.innerHTML = reviews.slice(0, 5).map(review => `
        <div class="review-item">
            <div class="review-name">${review.caseName}</div>
            <div class="review-meta">
                <span class="review-creator">${review.creator}</span>
                <span class="review-date">${formatDate(review.createdAt)}</span>
            </div>
        </div>
    `).join('');
}

function renderStatistics(statistics) {
    const container = document.getElementById('statistics-container');
    if (!container) return;

    if (!statistics) {
        container.innerHTML = '<div class="no-data">暂无统计数据</div>';
        return;
    }

    const progress = WorkspaceService.calculateProgress(
        statistics.completedCases || 0,
        statistics.totalCases || 0
    );

    container.innerHTML = `
        <div class="stat-item">
            <div class="stat-label">用例完成进度</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="stat-value">${progress}%</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">本周新增用例</div>
            <div class="stat-value">${statistics.weeklyNewCases || 0}</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">本周执行用例</div>
            <div class="stat-value">${statistics.weeklyExecutedCases || 0}</div>
        </div>
    `;
}

async function loadWorkspaceData() {
    await initWorkspace();
}
