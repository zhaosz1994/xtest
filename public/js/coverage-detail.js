/**
 * CTA 覆盖率详情页
 * 覆盖改进报告 6.3 节：硬约束清单展示、覆盖状态、覆盖率环形图、未覆盖项详情
 *
 * 依赖：
 * - /api/constraints/tasks/:taskId/constraints
 * - /api/constraints/coverage?taskId=xxx
 */
class CoverageDetail {
    constructor(taskId, options = {}) {
        this.taskId = taskId;
        this.container = options.container || document.getElementById('coverage-detail');
        if (!this.container) {
            console.warn('[CoverageDetail] 容器不存在');
            return;
        }
    }

    async load(taskId) {
        this.taskId = taskId || this.taskId;
        if (!this.taskId) return;
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        try {
            const [constraintsRes, coverageRes] = await Promise.all([
                fetch(`/api/constraints/tasks/${encodeURIComponent(this.taskId)}/constraints`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json().catch(() => ({ data: [] }))),
                fetch(`/api/constraints/tasks/${encodeURIComponent(this.taskId)}/coverage`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => r.json().catch(() => ({ data: {} })))
            ]);
            this.constraints = constraintsRes.data || constraintsRes.constraints || [];
            // 后端返回按类型分组的对象，转换为前端期望的 groups + summary 结构
            const rawCoverage = coverageRes.data || {};
            this.coverage = this._normalizeCoverage(rawCoverage);
            this._render();
        } catch (e) {
            this.container.innerHTML = `<div class="cd-error">加载覆盖率数据失败: ${this._escape(e.message)}</div>`;
        }
    }

    _render() {
        const summary = this.coverage.summary || {};
        const groups = this.coverage.groups || [];
        const totalCovered = summary.covered || 0;
        const totalUncovered = summary.uncovered || 0;
        const totalPending = summary.pending || 0;
        const total = totalCovered + totalUncovered + totalPending;
        const coverageRate = total > 0 ? ((totalCovered / total) * 100).toFixed(1) : '0.0';

        let html = `
            <div class="cd-header">
                <h3 class="cd-title">覆盖率详情</h3>
                <div class="cd-actions">
                    <button class="cd-btn cd-btn-secondary" id="cd-refresh">刷新</button>
                    <button class="cd-btn cd-btn-secondary" id="cd-extract">从设计文档提取</button>
                </div>
            </div>
            <div class="cd-overview">
                <div class="cd-donut">
                    <svg viewBox="0 0 120 120" width="120" height="120">
                        ${this._renderDonut(totalCovered, totalUncovered, totalPending, total)}
                        <text x="60" y="56" text-anchor="middle" font-size="22" font-weight="700" fill="#1e293b">${coverageRate}%</text>
                        <text x="60" y="74" text-anchor="middle" font-size="10" fill="#64748b">覆盖率</text>
                    </svg>
                </div>
                <div class="cd-overview-stats">
                    <div class="cd-stat cd-stat-covered"><span class="cd-stat-num">${totalCovered}</span><span class="cd-stat-label">已覆盖</span></div>
                    <div class="cd-stat cd-stat-uncovered"><span class="cd-stat-num">${totalUncovered}</span><span class="cd-stat-label">未覆盖</span></div>
                    <div class="cd-stat cd-stat-pending"><span class="cd-stat-num">${totalPending}</span><span class="cd-stat-label">待检查</span></div>
                    <div class="cd-stat cd-stat-total"><span class="cd-stat-num">${total}</span><span class="cd-stat-label">总约束</span></div>
                </div>
            </div>
            <div class="cd-groups">
        `;

        for (const group of groups) {
            const groupRate = group.total > 0 ? ((group.covered / group.total) * 100).toFixed(1) : '0.0';
            const typeLabel = {
                register: '寄存器',
                state_machine: '状态机',
                parameter_matrix: '参数矩阵'
            }[group.constraint_type] || group.constraint_type;
            html += `
                <div class="cd-group" data-type="${group.constraint_type}">
                    <div class="cd-group-header">
                        <span class="cd-group-title">${typeLabel}</span>
                        <span class="cd-group-rate">${groupRate}% (${group.covered}/${group.total})</span>
                    </div>
                    <div class="cd-group-bar">
                        <div class="cd-group-bar-covered" style="width:${groupRate}%"></div>
                    </div>
                    <div class="cd-group-items">
            `;
            for (const item of (group.items || [])) {
                const statusIcon = item.coverage_status === 'covered' ? '✅'
                    : item.coverage_status === 'uncovered' ? '❌' : '⏳';
                const statusClass = `cd-item-${item.coverage_status || 'pending'}`;
                html += `
                    <div class="cd-item ${statusClass}" data-id="${item.id}">
                        <span class="cd-item-icon">${statusIcon}</span>
                        <span class="cd-item-name">${this._escape(item.constraint_name)}</span>
                        <span class="cd-item-source">${this._escape(item.source || '')}</span>
                        ${item.coverage_status === 'uncovered' ? `<button class="cd-item-btn" data-action="suggest" data-id="${item.id}">建议补测</button>` : ''}
                    </div>
                `;
            }
            html += `
                    </div>
                </div>
            `;
        }

        html += '</div>';
        this.container.innerHTML = html;

        // 绑定事件
        const refreshBtn = this.container.querySelector('#cd-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.load());
        const extractBtn = this.container.querySelector('#cd-extract');
        if (extractBtn) extractBtn.addEventListener('click', () => this._onExtract());
        this.container.querySelectorAll('.cd-item-btn[data-action="suggest"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                this._onSuggest(id);
            });
        });
    }

    _renderDonut(covered, uncovered, pending, total) {
        if (total === 0) {
            return `<circle cx="60" cy="60" r="45" fill="none" stroke="#e2e8f0" stroke-width="14"/>`;
        }
        const r = 45;
        const circumference = 2 * Math.PI * r;
        const coveredLen = (covered / total) * circumference;
        const uncoveredLen = (uncovered / total) * circumference;
        const pendingLen = (pending / total) * circumference;
        // 使用 stroke-dasharray 绘制
        return `
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="#10b981" stroke-width="14"
                stroke-dasharray="${coveredLen} ${circumference - coveredLen}" stroke-dashoffset="0" transform="rotate(-90 60 60)"/>
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="#ef4444" stroke-width="14"
                stroke-dasharray="${uncoveredLen} ${circumference - uncoveredLen}" stroke-dashoffset="${-coveredLen}" transform="rotate(-90 60 60)"/>
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="#f59e0b" stroke-width="14"
                stroke-dasharray="${pendingLen} ${circumference - pendingLen}" stroke-dashoffset="${-(coveredLen + uncoveredLen)}" transform="rotate(-90 60 60)"/>
        `;
    }

    async _onExtract() {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        try {
            const res = await fetch(`/api/constraints/tasks/${encodeURIComponent(this.taskId)}/constraints/extract`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ documents: [] })
            });
            const data = await res.json().catch(() => ({}));
            if (data.success !== false) {
                const extracted = data.data?.extracted || 0;
                this._notify(`提取完成: 新增 ${extracted} 条硬约束`, 'success');
                this.load();
            } else {
                this._notify('提取失败: ' + (data.message || '未知错误'), 'error');
            }
        } catch (e) {
            this._notify('提取失败: ' + e.message, 'error');
        }
    }

    _onSuggest(constraintId) {
        // 查找约束详情
        const c = this.constraints.find(x => String(x.id) === String(constraintId));
        if (!c) return;
        const suggestion = `建议补测用例:\n约束: ${c.constraint_name || c.constraint_key}\n类型: ${c.constraint_type}\n来源: ${c.source || c.source_doc || '-'}\n\n建议:\n1. 基于此约束设计针对性测试用例\n2. 通过 ${c.constraint_type === 'register' ? '寄存器读' : 'CLI 查询'} 验证约束值\n3. 在 test_dispatch 节点中补充此约束`;
        this._notify(suggestion, 'info');
    }

    /**
     * 统一通知方法：优先使用系统封装的 showToast，回退到 console
     */
    _notify(message, type) {
        if (typeof window.agentConsolePage !== 'undefined' && window.agentConsolePage.showToast) {
            window.agentConsolePage.showToast(message, type || 'info');
        } else {
            console.log(`[CoverageDetail] ${type}: ${message}`);
        }
    }

    _escape(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /**
     * 将后端按类型分组的覆盖率对象转换为前端期望的 groups + summary 结构
     * 后端格式: { register: {total, covered, uncovered, pending}, state_machine: {...} }
     * 前端格式: { groups: [{constraint_type, total, covered, uncovered, pending, items: []}], summary: {covered, uncovered, pending} }
     */
    _normalizeCoverage(rawCoverage) {
        const groups = [];
        let totalCovered = 0, totalUncovered = 0, totalPending = 0;
        for (const [type, stat] of Object.entries(rawCoverage || {})) {
            const total = stat.total || 0;
            const covered = stat.covered || 0;
            const uncovered = stat.uncovered || 0;
            const pending = stat.pending || 0;
            totalCovered += covered;
            totalUncovered += uncovered;
            totalPending += pending;
            groups.push({ constraint_type: type, total, covered, uncovered, pending, items: [] });
        }
        return { groups, summary: { covered: totalCovered, uncovered: totalUncovered, pending: totalPending } };
    }
}

window.CoverageDetail = CoverageDetail;
