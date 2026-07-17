/**
 * CTA 硬约束清单管理
 * 覆盖改进报告 6.4 节：硬约束列表、手动添加/编辑、批量导入、导出覆盖率报告
 *
 * 依赖：
 * - /api/constraints/tasks/:taskId/constraints (CRUD)
 * - /api/constraints/extract (批量提取)
 * - /api/constraints/compare (比对)
 */
class HardConstraintsManager {
    constructor(taskId, options = {}) {
        this.taskId = taskId;
        this.container = options.container || document.getElementById('hard-constraints-manager');
        this.filterType = '';
        this.filterStatus = '';
        this.constraints = [];
        if (!this.container) {
            console.warn('[HardConstraintsManager] 容器不存在');
            return;
        }
    }

    async load(taskId) {
        this.taskId = taskId || this.taskId;
        if (!this.taskId) return;
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        try {
            const params = new URLSearchParams();
            if (this.filterType) params.append('type', this.filterType);
            if (this.filterStatus) params.append('status', this.filterStatus);
            const res = await fetch(`/api/constraints/tasks/${encodeURIComponent(this.taskId)}/constraints?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json().catch(() => ({ data: [] }));
            this.constraints = data.data || data.constraints || [];
            this._render();
        } catch (e) {
            this.container.innerHTML = `<div class="hc-error">加载硬约束失败: ${this._escape(e.message)}</div>`;
        }
    }

    _render() {
        const types = ['register', 'state_machine', 'parameter_matrix'];
        const statuses = ['pending', 'covered', 'uncovered'];
        let html = `
            <div class="hc-header">
                <h3 class="hc-title">硬约束管理</h3>
                <div class="hc-actions">
                    <button class="hc-btn hc-btn-secondary" id="hc-extract">批量提取</button>
                    <button class="hc-btn hc-btn-secondary" id="hc-compare">执行比对</button>
                    <button class="hc-btn hc-btn-secondary" id="hc-export">导出报告</button>
                    <button class="hc-btn hc-btn-primary" id="hc-add">+ 新增约束</button>
                </div>
            </div>
            <div class="hc-filters">
                <select id="hc-filter-type" class="hc-select">
                    <option value="">全部类型</option>
                    ${types.map(t => `<option value="${t}" ${this.filterType === t ? 'selected' : ''}>${this._typeLabel(t)}</option>`).join('')}
                </select>
                <select id="hc-filter-status" class="hc-select">
                    <option value="">全部状态</option>
                    ${statuses.map(s => `<option value="${s}" ${this.filterStatus === s ? 'selected' : ''}>${this._statusLabel(s)}</option>`).join('')}
                </select>
            </div>
            <div class="hc-table-wrap">
                <table class="hc-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>类型</th>
                            <th>名称</th>
                            <th>来源</th>
                            <th>覆盖状态</th>
                            <th>覆盖证据</th>
                            <th>创建时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        for (const c of this.constraints) {
            const statusIcon = c.coverage_status === 'covered' ? '✅'
                : c.coverage_status === 'uncovered' ? '❌' : '⏳';
            html += `
                <tr class="hc-row hc-status-${c.coverage_status || 'pending'}">
                    <td>${c.id}</td>
                    <td><span class="hc-tag hc-tag-${c.constraint_type}">${this._typeLabel(c.constraint_type)}</span></td>
                    <td class="hc-name">${this._escape(c.constraint_name)}</td>
                    <td class="hc-source">${this._escape(c.source || '-')}</td>
                    <td>${statusIcon} ${this._statusLabel(c.coverage_status)}</td>
                    <td class="hc-evidence">${this._escape(c.coverage_evidence || '-')}</td>
                    <td>${this._fmtTime(c.created_at)}</td>
                    <td>
                        <button class="hc-row-btn" data-action="edit" data-id="${c.id}">编辑</button>
                        <button class="hc-row-btn hc-row-btn-danger" data-action="delete" data-id="${c.id}">删除</button>
                    </td>
                </tr>
            `;
        }
        if (this.constraints.length === 0) {
            html += '<tr><td colspan="8" class="hc-empty">暂无硬约束，点击"批量提取"或"新增约束"</td></tr>';
        }
        html += `
                    </tbody>
                </table>
            </div>
        `;
        this.container.innerHTML = html;

        // 绑定事件
        const bind = (id, handler) => {
            const el = this.container.querySelector(id);
            if (el) el.addEventListener('click', handler);
        };
        bind('#hc-extract', () => this._onExtract());
        bind('#hc-compare', () => this._onCompare());
        bind('#hc-export', () => this._onExport());
        bind('#hc-add', () => this._onAddEdit(null));
        const typeFilter = this.container.querySelector('#hc-filter-type');
        if (typeFilter) typeFilter.addEventListener('change', (e) => { this.filterType = e.target.value; this.load(); });
        const statusFilter = this.container.querySelector('#hc-filter-status');
        if (statusFilter) statusFilter.addEventListener('change', (e) => { this.filterStatus = e.target.value; this.load(); });
        this.container.querySelectorAll('.hc-row-btn[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                const id = btn.getAttribute('data-id');
                if (action === 'edit') this._onAddEdit(id);
                else if (action === 'delete') this._onDelete(id);
            });
        });
    }

    _onAddEdit(id) {
        const c = id ? this.constraints.find(x => String(x.id) === String(id)) : null;
        const modal = document.createElement('div');
        modal.className = 'hc-modal';
        modal.innerHTML = `
            <div class="hc-modal-content">
                <div class="hc-modal-header">${c ? '编辑约束' : '新增约束'}</div>
                <div class="hc-modal-body">
                    <div class="hc-form-group">
                        <label>类型</label>
                        <select id="hc-form-type" class="hc-input">
                            <option value="register" ${c?.constraint_type === 'register' ? 'selected' : ''}>寄存器</option>
                            <option value="state_machine" ${c?.constraint_type === 'state_machine' ? 'selected' : ''}>状态机</option>
                            <option value="parameter_matrix" ${c?.constraint_type === 'parameter_matrix' ? 'selected' : ''}>参数矩阵</option>
                        </select>
                    </div>
                    <div class="hc-form-group">
                        <label>名称</label>
                        <input id="hc-form-name" class="hc-input" value="${this._escape(c?.constraint_key || c?.constraint_name || '')}" placeholder="如: PORT_PFC_CFG_REG"/>
                    </div>
                    <div class="hc-form-group">
                        <label>来源</label>
                        <input id="hc-form-source" class="hc-input" value="${this._escape(c?.source_doc || c?.source || '')}" placeholder="如: APP_NOTE_CH3"/>
                    </div>
                    <div class="hc-form-group">
                        <label>详情(JSON)</label>
                        <textarea id="hc-form-detail" class="hc-input hc-textarea" placeholder='{"address":"0x1234","bits":"[0:3]"}'>${this._escape(typeof c?.constraint_value === 'object' ? JSON.stringify(c?.constraint_value, null, 2) : (c?.constraint_value || c?.constraint_detail || ''))}</textarea>
                    </div>
                </div>
                <div class="hc-modal-footer">
                    <button class="hc-btn hc-btn-secondary" data-action="cancel">取消</button>
                    <button class="hc-btn hc-btn-primary" data-action="save">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', async (e) => {
            const action = e.target.getAttribute('data-action');
            if (action === 'cancel') { modal.remove(); return; }
            if (action !== 'save') return;
            const type = modal.querySelector('#hc-form-type').value;
            const name = modal.querySelector('#hc-form-name').value.trim();
            const source = modal.querySelector('#hc-form-source').value.trim();
            const detail = modal.querySelector('#hc-form-detail').value.trim();
            if (!name) { this._notify('名称不能为空', 'warning'); return; }
            const token = localStorage.getItem('authToken') || localStorage.getItem('token');
            try {
                const baseUrl = `/api/constraints/tasks/${encodeURIComponent(this.taskId)}/constraints`;
                const url = c ? `${baseUrl}/${c.id}` : baseUrl;
                const method = c ? 'PUT' : 'POST';
                // 后端字段名: type/key/value/source（前端用 name/detail 映射到 key/value）
                const body = { type, key: name, value: detail ? this._safeJsonParse(detail, {}) : {}, source };
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(body)
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    modal.remove();
                    this._notify(c ? '约束已更新' : '约束已创建', 'success');
                    this.load();
                } else {
                    this._notify('保存失败: ' + (data.message || res.status), 'error');
                }
            } catch (err) {
                this._notify('保存失败: ' + err.message, 'error');
            }
        });
    }

    async _onDelete(id) {
        const confirmed = await this._confirm('确定删除此约束?');
        if (!confirmed) return;
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        try {
            await fetch(`/api/constraints/tasks/${encodeURIComponent(this.taskId)}/constraints/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            this._notify('约束已删除', 'success');
            this.load();
        } catch (e) {
            this._notify('删除失败: ' + e.message, 'error');
        }
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
            const extracted = data.data?.extracted || 0;
            this._notify(`提取完成: 新增 ${extracted} 条约束`, 'success');
            this.load();
        } catch (e) {
            this._notify('提取失败: ' + e.message, 'error');
        }
    }

    async _onCompare() {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        try {
            const res = await fetch(`/api/constraints/tasks/${encodeURIComponent(this.taskId)}/constraints/compare`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({})
            });
            const data = await res.json().catch(() => ({}));
            const result = data.data || {};
            this._notify(`比对完成: 已覆盖 ${result.covered || 0}，未覆盖 ${result.uncovered || 0}`, 'success');
            this.load();
        } catch (e) {
            this._notify('比对失败: ' + e.message, 'error');
        }
    }

    _onExport() {
        const rows = [['ID', '类型', '名称', '来源', '覆盖状态', '覆盖证据', '创建时间']];
        for (const c of this.constraints) {
            rows.push([c.id, c.constraint_type, c.constraint_name, c.source || '', c.coverage_status || 'pending', c.coverage_evidence || '', c.created_at || '']);
        }
        const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `constraints_task_${this.taskId}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    _typeLabel(t) {
        return { register: '寄存器', state_machine: '状态机', parameter_matrix: '参数矩阵' }[t] || t || '-';
    }
    _statusLabel(s) {
        return { covered: '已覆盖', uncovered: '未覆盖', pending: '待检查' }[s] || s || '待检查';
    }
    _fmtTime(t) {
        if (!t) return '-';
        try {
            const date = new Date(t);
            if (Number.isNaN(date.getTime())) return '-';
            // 转换为北京时间 (UTC+8)
            const beijingTime = new Date(date.getTime() + (date.getTimezoneOffset() + 480) * 60000);
            const pad = n => String(n).padStart(2, '0');
            return `${beijingTime.getFullYear()}/${pad(beijingTime.getMonth() + 1)}/${pad(beijingTime.getDate())} ${pad(beijingTime.getHours())}:${pad(beijingTime.getMinutes())}`;
        } catch { return String(t); }
    }
    _escape(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    _safeJsonParse(s, fallback) {
        try { return JSON.parse(s); } catch { return fallback; }
    }

    /**
     * 统一通知：优先使用系统封装的 showToast，回退到 console
     */
    _notify(message, type) {
        if (typeof window.agentConsolePage !== 'undefined' && window.agentConsolePage.showToast) {
            window.agentConsolePage.showToast(message, type || 'info');
        } else {
            console.log(`[HardConstraints] ${type}: ${message}`);
        }
    }

    /**
     * 统一确认弹框：优先使用系统封装的 confirmDialog，回退到原生 confirm
     */
    _confirm(message) {
        if (typeof window.agentConsolePage !== 'undefined' && window.agentConsolePage.confirmDialog) {
            return window.agentConsolePage.confirmDialog(message);
        }
        return Promise.resolve(confirm(message));
    }
}

window.HardConstraintsManager = HardConstraintsManager;
