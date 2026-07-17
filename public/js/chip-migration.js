class ChipMigrationPage {
    constructor() {
        this.token = localStorage.getItem('authToken') || localStorage.getItem('token');
        this.chipVersions = [];
        this.init();
    }

    async apiRequest(endpoint, options = {}) {
        const response = await fetch(endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                ...(options.headers || {})
            }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `请求失败 (${response.status})`);
        return data;
    }

    async init() {
        document.getElementById('migration-back-btn').addEventListener('click', () => window.history.back());
        document.getElementById('run-diff-btn').addEventListener('click', () => this.runDiff());
        document.getElementById('create-migration-task-btn').addEventListener('click', () => this.createMigrationTask());
        try {
            await this.loadChipVersions();
        } catch (error) {
            this.showToast('芯片版本加载失败：' + error.message, 'error');
        }
        await this.loadBugRag();
    }

    async loadChipVersions() {
        const response = await this.apiRequest('/api/chip-versions');
        this.chipVersions = response.success ? (response.data || []) : [];
        if (this.chipVersions.length === 0) {
            this.showToast('暂无可用芯片版本，请联系管理员配置', 'warning');
        }
        const options = this.chipVersions.map(chip => `<option value="${chip.id}">${this.escapeHtml(chip.name || chip.version_key)}</option>`).join('');
        document.getElementById('source-chip-select').innerHTML = options;
        document.getElementById('target-chip-select').innerHTML = options;
        if (this.chipVersions.length > 1) {
            document.getElementById('target-chip-select').selectedIndex = this.chipVersions.length - 1;
        }
    }

    async runDiff() {
        const sourceChipVersionId = document.getElementById('source-chip-select').value;
        const targetChipVersionId = document.getElementById('target-chip-select').value;
        if (!sourceChipVersionId || !targetChipVersionId) {
            this.showToast('请选择源/目标芯片', 'warning');
            return;
        }
        try {
            const [svd, sdk, inheritance] = await Promise.all([
                this.apiRequest('/api/svd/diff', { method: 'POST', body: JSON.stringify({ sourceChipVersionId, targetChipVersionId }) }),
                this.apiRequest('/api/sdk-ast/diff', { method: 'POST', body: JSON.stringify({ sourceChipVersionId, targetChipVersionId }) }),
                this.apiRequest(`/api/chip-versions/${targetChipVersionId}/inheritance`)
            ]);
            this.renderDiff('svd-diff-content', svd.data);
            this.renderDiff('sdk-diff-content', sdk.data);
            document.getElementById('inherit-points-content').innerHTML = (inheritance.data || []).map(chip =>
                `<div class="migration-row">${this.escapeHtml(chip.name || chip.version_key)}</div>`
            ).join('') || '无继承链';
            document.getElementById('regen-scripts-content').innerHTML = this.escapeHtml(`寄存器变化 ${svd.data.changed.length} 项，SDK变化 ${sdk.data.changed.length} 项，建议重生成相关脚本。`);
            this.showToast('差异分析完成', 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    renderDiff(elementId, diff) {
        const html = ['added', 'removed', 'changed'].map(type => {
            const items = diff?.[type] || [];
            return `<div class="migration-diff-section"><strong>${this.escapeHtml(type)} (${items.length})</strong>${items.slice(0, 20).map(item =>
                `<div class="migration-row">${this.escapeHtml(item.name || item.register_name || item.signature || JSON.stringify(item))}</div>`
            ).join('')}</div>`;
        }).join('');
        document.getElementById(elementId).innerHTML = html;
    }

    async loadBugRag() {
        try {
            const response = await this.apiRequest('/api/bug-rag?status=approved&limit=20');
            const items = response.data || [];
            document.getElementById('bug-rag-content').innerHTML = items.map(item =>
                `<div class="migration-row"><strong>${this.escapeHtml(item.title)}</strong><br>${this.escapeHtml(item.symptom || item.fix_suggestion || '')}</div>`
            ).join('') || '暂无高风险 Bug-RAG';
        } catch (error) {
            document.getElementById('bug-rag-content').textContent = 'Bug-RAG加载失败';
        }
    }

    async createMigrationTask() {
        const sourceChipVersionId = document.getElementById('source-chip-select').value;
        const targetChipVersionId = document.getElementById('target-chip-select').value;
        if (!sourceChipVersionId || !targetChipVersionId) {
            this.showToast('请选择源/目标芯片', 'warning');
            return;
        }
        if (sourceChipVersionId === targetChipVersionId) {
            this.showToast('源芯片与目标芯片不能相同', 'warning');
            return;
        }
        try {
            const response = await this.apiRequest('/api/adaptive-generation/create', {
                method: 'POST',
                body: JSON.stringify({
                    targetType: 'chip_migration',
                    targetId: `${sourceChipVersionId}_to_${targetChipVersionId}`,
                    queryText: '芯片迁移差异分析和测试脚本重生成',
                    chipVersionId: targetChipVersionId,
                    categories: ['register_map', 'register_field', 'sdk_api', 'bug_rag', 'execution_experience']
                })
            });
            if (response.success) this.showToast('迁移任务已创建', 'success');
            else throw new Error(response.message || '创建失败');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('migration-toast-container');
        const el = document.createElement('div');
        el.className = `migration-toast migration-toast-${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => new ChipMigrationPage());
