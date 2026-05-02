/**
 * AI Tools Module - 自定义工具工坊
 * Provides CRUD operations and test-run for custom AI tools
 */
let aiToolsInitialized = false;
let aiToolsEditingName = null; // null = create mode, string = edit mode

function initAIToolsConfig() {
    if (aiToolsInitialized) return;
    aiToolsInitialized = true;

    const btnCreateTool = document.getElementById('aitools-btn-create') || document.getElementById('create-ai-tool-btn');
    if (btnCreateTool) {
        if (!btnCreateTool.id || btnCreateTool.id === 'create-ai-tool-btn') btnCreateTool.id = 'aitools-btn-create';
        btnCreateTool.addEventListener('click', () => openToolModal(null));
    }

    const btnCloseModal = document.getElementById('aitools-modal-close');
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', closeToolModal);
    }

    const btnSaveTool = document.getElementById('aitools-btn-save');
    if (btnSaveTool) {
        btnSaveTool.addEventListener('click', saveTool);
    }

    const btnTestRun = document.getElementById('aitools-btn-test-run');
    if (btnTestRun) {
        btnTestRun.addEventListener('click', () => {
            const toolName = btnTestRun.dataset.toolName;
            if (toolName) testRunTool(toolName);
        });
    }

    const languageSelect = document.getElementById('aitools-language');
    if (languageSelect) {
        languageSelect.addEventListener('change', updateCodeHint);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('aitools-modal-overlay');
            if (overlay && overlay.style.display === 'flex') {
                closeToolModal();
            }
        }
    });
}

/* ------------------------------------------------------------------ */
/*  Load & Render Tools List                                          */
/* ------------------------------------------------------------------ */

async function loadAIToolsList() {
    let tableBody = document.getElementById('aitools-table-body') || document.getElementById('ai-tools-list-body');
    if (!tableBody) return;

    if (tableBody.id === 'ai-tools-list-body') {
        tableBody.id = 'aitools-table-body';
    }

    tableBody.innerHTML = `<tr><td colspan="6" class="aitools-loading">加载中...</td></tr>`;

    try {
        const result = await apiRequest('/ai-tools/list', { method: 'GET' });

        if (result.success && (result.data || result.tools)) {
            renderAIToolsTable(result.data || result.tools);
        } else {
            tableBody.innerHTML = `<tr><td colspan="6" class="aitools-empty">${escapeHtml(result.message || '暂无工具')}</td></tr>`;
        }
    } catch (error) {
        console.error('[AI Tools] 加载工具列表失败:', error);
        tableBody.innerHTML = `<tr><td colspan="6" class="aitools-error">加载失败，请重试</td></tr>`;
    }
}

function renderAIToolsTable(tools) {
    const tableBody = document.getElementById('aitools-table-body');
    if (!tableBody) return;

    if (!tools || tools.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="aitools-empty">暂无工具，点击上方按钮创建</td></tr>`;
        return;
    }

    tableBody.innerHTML = tools.map(tool => {
        const langBadge = tool.language === 'python'
            ? '<span class="aitools-badge aitools-badge-python">Python</span>'
            : '<span class="aitools-badge aitools-badge-js">JS</span>';

        const publicIcon = tool.is_public ? '&#10004;' : '&#10008;';
        const publicClass = tool.is_public ? 'aitools-yes' : 'aitools-no';

        const enabledHtml = tool.is_enabled
            ? '<span class="aitools-status aitools-status-on">启用</span>'
            : '<span class="aitools-status aitools-status-off">禁用</span>';

        return `
        <tr data-tool-name="${escapeHtml(tool.tool_name)}">
            <td class="aitools-col-name" title="${escapeHtml(tool.tool_name)}">${escapeHtml(tool.tool_name)}</td>
            <td title="${escapeHtml(tool.display_name || '')}">${escapeHtml(tool.display_name || '-')}</td>
            <td>${langBadge}</td>
            <td><span class="${publicClass}">${publicIcon}</span></td>
            <td>${enabledHtml}</td>
            <td class="aitools-col-actions">
                <button class="aitools-action-btn aitools-btn-edit" data-tool-name="${escapeHtml(tool.tool_name)}" title="编辑">编辑</button>
                <button class="aitools-action-btn aitools-btn-delete" data-tool-name="${escapeHtml(tool.tool_name)}" title="删除">删除</button>
                <button class="aitools-action-btn aitools-btn-test" data-tool-name="${escapeHtml(tool.tool_name)}" title="测试运行">测试</button>
            </td>
        </tr>`;
    }).join('');

    tableBody.querySelectorAll('.aitools-btn-edit').forEach(btn => {
        btn.addEventListener('click', function () {
            openToolModal(this.dataset.toolName);
        });
    });

    tableBody.querySelectorAll('.aitools-btn-delete').forEach(btn => {
        btn.addEventListener('click', function () {
            deleteTool(this.dataset.toolName);
        });
    });

    tableBody.querySelectorAll('.aitools-btn-test').forEach(btn => {
        btn.addEventListener('click', function () {
            quickTestTool(this.dataset.toolName);
        });
    });
}

/* ------------------------------------------------------------------ */
/*  Open / Close Modal                                                */
/* ------------------------------------------------------------------ */

async function openToolModal(toolName) {
    aiToolsEditingName = toolName;

    // 确保 modal 已注入
    ensureAIToolsModal();

    const overlay = document.getElementById('aitools-modal-overlay');
    if (!overlay) return;

    // Reset form
    resetToolForm();

    if (toolName) {
        // Edit mode - load detail
        try {
            const result = await apiRequest(`/ai-tools/detail/${encodeURIComponent(toolName)}`, { method: 'GET' });
            if (result.success && (result.data || result.tool)) {
                populateToolForm(result.data || result.tool);
            } else {
                showErrorMessage(result.message || '获取工具详情失败');
                return;
            }
        } catch (error) {
            console.error('[AI Tools] 获取工具详情失败:', error);
            showErrorMessage('获取工具详情失败');
            return;
        }
    }

    // Update modal title
    const modalTitle = document.getElementById('aitools-modal-title');
    if (modalTitle) {
        modalTitle.textContent = toolName ? '编辑工具' : '创建工具';
    }

    // Toggle tool_name field editability
    const toolNameInput = document.getElementById('aitools-tool-name');
    if (toolNameInput) {
        toolNameInput.readOnly = !!toolName;
    }

    // Set test-run button data
    const btnTestRun = document.getElementById('aitools-btn-test-run');
    if (btnTestRun) {
        btnTestRun.dataset.toolName = toolName || '';
    }

    // Update code hint
    updateCodeHint();

    overlay.style.display = 'flex';
}

function closeToolModal() {
    const overlay = document.getElementById('aitools-modal-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    aiToolsEditingName = null;
    resetToolForm();
}

function resetToolForm() {
    const fields = {
        'aitools-tool-name': '',
        'aitools-display-name': '',
        'aitools-description': '',
        'aitools-language': 'javascript',
        'aitools-code': '',
        'aitools-input-schema': '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
        'aitools-test-params': '{}',
        'aitools-test-result': ''
    };

    Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });

    const isPublicToggle = document.getElementById('aitools-is-public');
    if (isPublicToggle) isPublicToggle.checked = false;

    const resultArea = document.getElementById('aitools-test-result');
    if (resultArea) {
        resultArea.textContent = '';
        resultArea.className = 'aitools-test-result';
    }
}

function populateToolForm(tool) {
    const mapping = {
        'aitools-tool-name': tool.tool_name || '',
        'aitools-display-name': tool.display_name || '',
        'aitools-description': tool.description || '',
        'aitools-language': tool.language || 'javascript',
        'aitools-code': tool.code || tool.code_content || '',
        'aitools-input-schema': tool.input_schema ? (typeof tool.input_schema === 'string' ? tool.input_schema : JSON.stringify(tool.input_schema, null, 2)) : '{}',
    };

    Object.entries(mapping).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });

    const isPublicToggle = document.getElementById('aitools-is-public');
    if (isPublicToggle) isPublicToggle.checked = !!tool.is_public;
}

function updateCodeHint() {
    const langSelect = document.getElementById('aitools-language');
    const hintEl = document.getElementById('aitools-code-hint');
    if (!langSelect || !hintEl) return;

    if (langSelect.value === 'python') {
        hintEl.textContent = 'Python - 请定义 run(params) 函数，返回结果对象';
    } else {
        hintEl.textContent = 'JavaScript - 请导出 run(params) 函数，返回结果对象';
    }
}

/* ------------------------------------------------------------------ */
/*  Save Tool (Create / Update)                                       */
/* ------------------------------------------------------------------ */

async function saveTool() {
    const toolNameEl = document.getElementById('aitools-tool-name');
    const displayNameEl = document.getElementById('aitools-display-name');
    const descriptionEl = document.getElementById('aitools-description');
    const languageEl = document.getElementById('aitools-language');
    const isPublicEl = document.getElementById('aitools-is-public');
    const codeEl = document.getElementById('aitools-code');
    const schemaEl = document.getElementById('aitools-input-schema');

    const toolName = toolNameEl ? toolNameEl.value.trim() : '';
    const displayName = displayNameEl ? displayNameEl.value.trim() : '';
    const description = descriptionEl ? descriptionEl.value.trim() : '';
    const language = languageEl ? languageEl.value : 'javascript';
    const isPublic = isPublicEl ? isPublicEl.checked : false;
    const code = codeEl ? codeEl.value : '';
    const schemaRaw = schemaEl ? schemaEl.value.trim() : '{}';

    // Validation
    if (!toolName) {
        showErrorMessage('请输入工具名称');
        toolNameEl && toolNameEl.focus();
        return;
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(toolName)) {
        showErrorMessage('工具名称只能包含英文字母、数字、下划线和连字符，且以字母开头');
        toolNameEl && toolNameEl.focus();
        return;
    }

    if (!displayName) {
        showErrorMessage('请输入显示名称');
        displayNameEl && displayNameEl.focus();
        return;
    }

    if (!code.trim()) {
        showErrorMessage('请输入工具代码');
        codeEl && codeEl.focus();
        return;
    }

    let inputSchema;
    try {
        inputSchema = JSON.parse(schemaRaw || '{}');
    } catch (e) {
        showErrorMessage('输入参数 Schema 格式错误，请输入有效的 JSON');
        schemaEl && schemaEl.focus();
        return;
    }

    const payload = {
        tool_name: toolName,
        display_name: displayName,
        description: description,
        language: language,
        is_public: isPublic,
        code_content: code,
        input_schema: inputSchema
    };

    try {
        let result;

        if (aiToolsEditingName) {
            // Update
            result = await apiRequest(`/ai-tools/update/${encodeURIComponent(aiToolsEditingName)}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            // Create
            result = await apiRequest('/ai-tools/create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }

        if (result.success) {
            showSuccessMessage(aiToolsEditingName ? '工具更新成功' : '工具创建成功');
            closeToolModal();
            await loadAIToolsList();
        } else {
            showErrorMessage(result.message || '保存失败');
        }
    } catch (error) {
        console.error('[AI Tools] 保存工具失败:', error);
        showErrorMessage('保存工具失败，请重试');
    }
}

/* ------------------------------------------------------------------ */
/*  Delete Tool                                                       */
/* ------------------------------------------------------------------ */

async function deleteTool(toolName) {
    if (!toolName) return;

    const confirmed = await showConfirmMessage(`确定要删除工具 "${toolName}" 吗？此操作不可恢复。`);
    if (!confirmed) return;

    try {
        const result = await apiRequest(`/ai-tools/${encodeURIComponent(toolName)}`, {
            method: 'DELETE'
        });

        if (result.success) {
            showSuccessMessage('工具已删除');
            await loadAIToolsList();
        } else {
            showErrorMessage(result.message || '删除失败');
        }
    } catch (error) {
        console.error('[AI Tools] 删除工具失败:', error);
        showErrorMessage('删除工具失败，请重试');
    }
}

/* ------------------------------------------------------------------ */
/*  Test Run Tool                                                     */
/* ------------------------------------------------------------------ */

async function testRunTool(toolName) {
    const paramsEl = document.getElementById('aitools-test-params');
    const resultEl = document.getElementById('aitools-test-result');

    if (!paramsEl || !resultEl) return;

    const paramsRaw = paramsEl.value.trim();
    let params;
    try {
        params = JSON.parse(paramsRaw || '{}');
    } catch (e) {
        resultEl.textContent = '参数格式错误，请输入有效的 JSON';
        resultEl.className = 'aitools-test-result aitools-test-error';
        return;
    }

    // If no toolName (create mode), use the current form data
    const targetName = toolName || aiToolsEditingName;

    if (!targetName) {
        resultEl.textContent = '请先保存工具后再测试运行';
        resultEl.className = 'aitools-test-result aitools-test-error';
        return;
    }

    resultEl.textContent = '运行中...';
    resultEl.className = 'aitools-test-result aitools-test-running';

    try {
        const result = await apiRequest(`/ai-tools/test-run/${encodeURIComponent(targetName)}`, {
            method: 'POST',
            body: JSON.stringify({ params })
        });

        if (result.success) {
            const output = result.data && result.data.result ? result.data.result : result.output;
            resultEl.textContent = typeof output === 'string'
                ? output
                : JSON.stringify(output, null, 2);
            resultEl.className = 'aitools-test-result aitools-test-success';
        } else {
            resultEl.textContent = result.message || '运行失败';
            resultEl.className = 'aitools-test-result aitools-test-error';
        }
    } catch (error) {
        console.error('[AI Tools] 测试运行失败:', error);
        resultEl.textContent = '测试运行失败，请重试';
        resultEl.className = 'aitools-test-result aitools-test-error';
    }
}

async function quickTestTool(toolName) {
    if (!toolName) return;

    // Open the modal in edit mode first, then the user can test from there
    await openToolModal(toolName);

    // Scroll to test area
    const testArea = document.getElementById('aitools-test-area');
    if (testArea) {
        testArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/* ------------------------------------------------------------------ */
/*  Format Input Schema for Display                                   */
/* ------------------------------------------------------------------ */

function formatInputSchema(schema) {
    if (!schema) return '<span class="aitools-schema-empty">无参数定义</span>';

    let parsed = schema;
    if (typeof schema === 'string') {
        try {
            parsed = JSON.parse(schema);
        } catch (e) {
            return `<span class="aitools-schema-error">Schema 格式错误</span>`;
        }
    }

    if (!parsed || !parsed.properties || Object.keys(parsed.properties).length === 0) {
        return '<span class="aitools-schema-empty">无参数定义</span>';
    }

    const required = Array.isArray(parsed.required) ? parsed.required : [];
    const props = parsed.properties;

    const rows = Object.entries(props).map(([name, def]) => {
        const type = def.type || 'any';
        const desc = def.description || '';
        const isReq = required.includes(name);
        const reqBadge = isReq
            ? '<span class="aitools-schema-required">必填</span>'
            : '<span class="aitools-schema-optional">选填</span>';

        return `<div class="aitools-schema-row">
            <span class="aitools-schema-name">${escapeHtml(name)}</span>
            <span class="aitools-schema-type">${escapeHtml(type)}</span>
            ${reqBadge}
            ${desc ? `<span class="aitools-schema-desc">${escapeHtml(desc)}</span>` : ''}
        </div>`;
    });

    return `<div class="aitools-schema-table">${rows.join('')}</div>`;
}

/* ------------------------------------------------------------------ */
/*  Inject Modal HTML & Styles (if not present in page)               */
/* ------------------------------------------------------------------ */

function ensureAIToolsModal() {
    if (document.getElementById('aitools-modal')) return;

    // Styles
    const style = document.createElement('style');
    style.id = 'aitools-styles';
    style.textContent = `
        /* ---------- Table ---------- */
        .aitools-loading, .aitools-empty, .aitools-error {
            text-align: center;
            padding: 32px 0;
            color: #94a3b8;
            font-size: 14px;
        }
        .aitools-error { color: #ef4444; }

        .aitools-badge {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 600;
            line-height: 1.4;
        }
        .aitools-badge-js   { background: #fef3c7; color: #92400e; }
        .aitools-badge-python { background: #dbeafe; color: #1e40af; }

        .aitools-yes { color: #22c55e; font-size: 16px; }
        .aitools-no  { color: #ef4444; font-size: 16px; }

        .aitools-status {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 500;
        }
        .aitools-status-on  { background: #dcfce7; color: #166534; }
        .aitools-status-off { background: #f1f5f9; color: #64748b; }

        .aitools-col-name { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; }
        .aitools-col-actions { white-space: nowrap; }

        .aitools-action-btn {
            padding: 4px 12px;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            margin-right: 4px;
            transition: background 0.15s;
        }
        .aitools-btn-edit   { background: #ede9fe; color: #6d28d9; }
        .aitools-btn-edit:hover   { background: #ddd6fe; }
        .aitools-btn-delete { background: #fee2e2; color: #dc2626; }
        .aitools-btn-delete:hover { background: #fecaca; }
        .aitools-btn-test   { background: #dbeafe; color: #2563eb; }
        .aitools-btn-test:hover   { background: #bfdbfe; }

        /* ---------- Modal ---------- */
        .aitools-modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 99999;
        }
        .aitools-modal {
            background: #fff;
            border-radius: 16px;
            width: 960px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
            animation: aitools-modal-in 0.2s ease;
        }
        @keyframes aitools-modal-in {
            from { opacity: 0; transform: translateY(16px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .aitools-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 28px;
            border-bottom: 1px solid #e2e8f0;
        }
        .aitools-modal-header h3 {
            margin: 0;
            font-size: 18px;
            color: #1e293b;
        }
        .aitools-modal-close {
            background: none;
            border: none;
            font-size: 22px;
            color: #94a3b8;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 6px;
            transition: background 0.15s;
        }
        .aitools-modal-close:hover { background: #f1f5f9; color: #475569; }

        .aitools-modal-body { padding: 24px 28px; }

        /* ---------- Form ---------- */
        .aitools-form-row {
            display: flex;
            gap: 16px;
            margin-bottom: 16px;
        }
        .aitools-form-group {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .aitools-form-group label {
            font-size: 13px;
            font-weight: 600;
            color: #475569;
            margin-bottom: 6px;
        }
        .aitools-form-group input[type="text"],
        .aitools-form-group textarea,
        .aitools-form-group select {
            padding: 8px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 14px;
            color: #1e293b;
            background: #fff;
            transition: border-color 0.15s;
            outline: none;
        }
        .aitools-form-group input:focus,
        .aitools-form-group textarea:focus,
        .aitools-form-group select:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        .aitools-form-group input[readonly] {
            background: #f8fafc;
            color: #64748b;
        }

        .aitools-toggle-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 16px;
        }
        .aitools-toggle-row label {
            font-size: 13px;
            font-weight: 600;
            color: #475569;
        }

        /* ---------- Code Area ---------- */
        .aitools-code-section {
            margin-bottom: 20px;
        }
        .aitools-code-section .aitools-section-label {
            font-size: 13px;
            font-weight: 600;
            color: #475569;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .aitools-code-hint {
            font-size: 12px;
            font-weight: 400;
            color: #94a3b8;
        }
        .aitools-code-editor {
            width: 100%;
            min-height: 240px;
            padding: 12px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 13px;
            line-height: 1.6;
            color: #1e293b;
            background: #f8fafc;
            resize: vertical;
            outline: none;
            tab-size: 2;
        }
        .aitools-code-editor:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        /* ---------- Bottom Split: Schema + Test ---------- */
        .aitools-bottom-split {
            display: flex;
            gap: 20px;
        }
        .aitools-bottom-left,
        .aitools-bottom-right {
            flex: 1;
            min-width: 0;
        }
        .aitools-section-title {
            font-size: 13px;
            font-weight: 600;
            color: #475569;
            margin-bottom: 8px;
        }
        .aitools-schema-editor {
            width: 100%;
            min-height: 160px;
            padding: 12px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12px;
            line-height: 1.5;
            color: #1e293b;
            background: #f8fafc;
            resize: vertical;
            outline: none;
        }
        .aitools-schema-editor:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        /* ---------- Test Run Area ---------- */
        .aitools-test-params {
            width: 100%;
            min-height: 80px;
            padding: 10px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12px;
            line-height: 1.5;
            color: #1e293b;
            background: #f8fafc;
            resize: vertical;
            outline: none;
            margin-bottom: 10px;
        }
        .aitools-test-params:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        .aitools-btn-run {
            padding: 7px 20px;
            background: #6366f1;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
            margin-bottom: 12px;
        }
        .aitools-btn-run:hover { background: #4f46e5; }
        .aitools-btn-run:disabled { background: #a5b4fc; cursor: not-allowed; }

        .aitools-test-result {
            min-height: 60px;
            padding: 12px;
            border-radius: 8px;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-all;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #475569;
        }
        .aitools-test-running { color: #6366f1; border-color: #c7d2fe; background: #eef2ff; }
        .aitools-test-success { color: #166534; border-color: #bbf7d0; background: #f0fdf4; }
        .aitools-test-error   { color: #dc2626; border-color: #fecaca; background: #fef2f2; }

        /* ---------- Schema Display ---------- */
        .aitools-schema-table .aitools-schema-row {
            display: flex;
            gap: 8px;
            align-items: center;
            padding: 4px 0;
            font-size: 13px;
        }
        .aitools-schema-name { font-weight: 600; color: #1e293b; font-family: monospace; }
        .aitools-schema-type { color: #6366f1; font-size: 12px; }
        .aitools-schema-required {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 4px;
            background: #fee2e2;
            color: #dc2626;
        }
        .aitools-schema-optional {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 4px;
            background: #f1f5f9;
            color: #64748b;
        }
        .aitools-schema-desc { color: #94a3b8; font-size: 12px; }
        .aitools-schema-empty { color: #94a3b8; font-style: italic; }
        .aitools-schema-error { color: #ef4444; }

        /* ---------- Footer ---------- */
        .aitools-modal-footer {
            padding: 16px 28px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        .aitools-btn-cancel {
            padding: 8px 20px;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
            border: 1px solid #cbd5e1;
            background: #fff;
            color: #475569;
            transition: background 0.15s;
        }
        .aitools-btn-cancel:hover { background: #f8fafc; }
        .aitools-btn-save {
            padding: 8px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            background: #6366f1;
            color: #fff;
            transition: background 0.15s;
        }
        .aitools-btn-save:hover { background: #4f46e5; }
    `;
    document.head.appendChild(style);

    // Modal HTML
    const modalHtml = `
    <div id="aitools-modal-overlay" class="aitools-modal-overlay">
        <div id="aitools-modal" class="aitools-modal">
            <div class="aitools-modal-header">
                <h3 id="aitools-modal-title">创建工具</h3>
                <button id="aitools-modal-close" class="aitools-modal-close" title="关闭">&times;</button>
            </div>
            <div class="aitools-modal-body">
                <!-- Basic Info -->
                <div class="aitools-form-row">
                    <div class="aitools-form-group">
                        <label for="aitools-tool-name">工具名称</label>
                        <input type="text" id="aitools-tool-name" placeholder="例如: my_tool" autocomplete="off">
                    </div>
                    <div class="aitools-form-group">
                        <label for="aitools-display-name">显示名称</label>
                        <input type="text" id="aitools-display-name" placeholder="例如: 我的工具" autocomplete="off">
                    </div>
                </div>
                <div class="aitools-form-row">
                    <div class="aitools-form-group">
                        <label for="aitools-description">描述</label>
                        <input type="text" id="aitools-description" placeholder="工具功能描述" autocomplete="off">
                    </div>
                    <div class="aitools-form-group">
                        <label for="aitools-language">语言</label>
                        <select id="aitools-language">
                            <option value="javascript">JavaScript</option>
                            <option value="python">Python</option>
                        </select>
                    </div>
                </div>
                <div class="aitools-toggle-row">
                    <label for="aitools-is-public">公开</label>
                    <input type="checkbox" id="aitools-is-public">
                </div>

                <!-- Code Editor -->
                <div class="aitools-code-section">
                    <div class="aitools-section-label">
                        <span>工具代码</span>
                        <span id="aitools-code-hint" class="aitools-code-hint">JavaScript - 请导出 run(params) 函数，返回结果对象</span>
                    </div>
                    <textarea id="aitools-code" class="aitools-code-editor" placeholder="在此编写工具代码..." spellcheck="false"></textarea>
                </div>

                <!-- Bottom Split: Schema + Test -->
                <div class="aitools-bottom-split">
                    <div class="aitools-bottom-left">
                        <div class="aitools-section-title">输入参数 Schema (JSON)</div>
                        <textarea id="aitools-input-schema" class="aitools-schema-editor" spellcheck="false">{
  "type": "object",
  "properties": {},
  "required": []
}</textarea>
                    </div>
                    <div id="aitools-test-area" class="aitools-bottom-right">
                        <div class="aitools-section-title">测试运行</div>
                        <textarea id="aitools-test-params" class="aitools-test-params" placeholder="输入测试参数 JSON，例如: {&quot;key&quot;: &quot;value&quot;}" spellcheck="false">{}</textarea>
                        <button id="aitools-btn-test-run" class="aitools-btn-run" data-tool-name="">运行测试</button>
                        <div id="aitools-test-result" class="aitools-test-result"></div>
                    </div>
                </div>
            </div>
            <div class="aitools-modal-footer">
                <button id="aitools-btn-cancel" class="aitools-btn-cancel">取消</button>
                <button id="aitools-btn-save" class="aitools-btn-save">保存</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Re-bind modal-specific events after injection
    const btnCloseModal = document.getElementById('aitools-modal-close');
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', closeToolModal);
    }

    const btnCancel = document.getElementById('aitools-btn-cancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', closeToolModal);
    }

    const btnSave = document.getElementById('aitools-btn-save');
    if (btnSave) {
        btnSave.addEventListener('click', saveTool);
    }

    const btnTestRun = document.getElementById('aitools-btn-test-run');
    if (btnTestRun) {
        btnTestRun.addEventListener('click', function () {
            const toolName = this.dataset.toolName;
            testRunTool(toolName);
        });
    }

    const languageSelect = document.getElementById('aitools-language');
    if (languageSelect) {
        languageSelect.addEventListener('change', updateCodeHint);
    }

    // Tab key support in code editor
    const codeEditor = document.getElementById('aitools-code');
    if (codeEditor) {
        codeEditor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = codeEditor.selectionStart;
                const end = codeEditor.selectionEnd;
                codeEditor.value = codeEditor.value.substring(0, start) + '  ' + codeEditor.value.substring(end);
                codeEditor.selectionStart = codeEditor.selectionEnd = start + 2;
            }
        });
    }
}

/* ------------------------------------------------------------------ */
/*  Auto-init                                                          */
/* ------------------------------------------------------------------ */

// 模块通过 ModuleLoader 动态加载，DOMContentLoaded 可能已触发
// 使用已准备就绪的检查来正确处理两种情况
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        ensureAIToolsModal();
    });
} else {
    // DOM 已就绪（模块加载晚于 DOMContentLoaded）
    ensureAIToolsModal();
}

window.initAIToolsConfig = initAIToolsConfig;
window.loadAIToolsList = loadAIToolsList;
window.ensureAIToolsModal = ensureAIToolsModal;
window.openToolModal = openToolModal;
window.saveTool = saveTool;
window.deleteTool = deleteTool;
window.testRunTool = testRunTool;
window.formatInputSchema = formatInputSchema;
