/**
 * AI Sub-Agent Orchestrator Module (智能体编排台)
 * Manages sub-agent CRUD, config files, tool transfer box, and override logic.
 */
let subAgentInitialized = false;

// ---- Module-level state ----
let saCurrentEditId = null;          // 当前编辑的 agent id (null = 新建)
let saCurrentEditAgentCode = null;   // 当前编辑的 agent_code
let saCurrentEditIsSystem = false;   // 当前编辑的是否为系统内置智能体
let saCurrentEditIsOverridden = false; // 当前编辑的智能体是否已被自定义覆盖
let saConfigFilesCache = {};         // config files 缓存 { soul_md, user_md, tools_md, ref_docs }
let saAvailableTools = [];           // 全部可用工具列表
let saMountedToolIds = [];           // 已挂载工具 ID 列表
let saMemoryStats = null;            // 当前智能体的记忆统计

// ---- Utility helpers (follow project standards) ----

function saEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function saFormatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}/${month}/${day} ${hours}:${minutes}`;
    } catch (e) {
        return dateStr;
    }
}

/**
 * 确认弹窗 (Promise 版本, 遵循项目规范)
 */
function saShowConfirm(message) {
    return new Promise((resolve) => {
        if (typeof showConfirmMessage === 'function') {
            showConfirmMessage(message).then(resolve);
            return;
        }
        // Fallback: 创建确认弹窗
        let modal = document.getElementById('sa-confirm-modal');
        if (!modal) {
            const style = document.createElement('style');
            style.id = 'sa-confirm-styles';
            style.textContent = `
                .sa-confirm-modal {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.5); display: flex; align-items: center;
                    justify-content: center; z-index: 99999;
                }
                .sa-confirm-content {
                    background: #fff; border-radius: 12px; width: 400px; max-width: 90%;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.15); animation: sa-confirm-in 0.2s ease;
                }
                @keyframes sa-confirm-in {
                    from { opacity: 0; transform: scale(0.9); }
                    to { opacity: 1; transform: scale(1); }
                }
                .sa-confirm-header {
                    padding: 20px 24px; border-bottom: 1px solid #e2e8f0;
                    display: flex; align-items: center; gap: 12px;
                }
                .sa-confirm-icon { font-size: 24px; }
                .sa-confirm-header h3 { margin: 0; font-size: 16px; color: #1e293b; }
                .sa-confirm-body { padding: 24px; }
                .sa-confirm-body p { margin: 0; font-size: 14px; color: #64748b; line-height: 1.6; }
                .sa-confirm-footer {
                    padding: 16px 24px; border-top: 1px solid #e2e8f0;
                    display: flex; justify-content: flex-end; gap: 12px;
                }
                .sa-confirm-btn {
                    padding: 8px 20px; border-radius: 8px; font-size: 14px;
                    cursor: pointer; border: none; transition: all 0.2s;
                }
                .sa-confirm-btn.cancel { background: #f1f5f9; color: #64748b; }
                .sa-confirm-btn.cancel:hover { background: #e2e8f0; }
                .sa-confirm-btn.confirm { background: #6366f1; color: #fff; }
                .sa-confirm-btn.confirm:hover { background: #4f46e5; }
            `;
            document.head.appendChild(style);
            const modalHtml = `
                <div id="sa-confirm-modal" class="sa-confirm-modal" style="display:none;">
                    <div class="sa-confirm-content">
                        <div class="sa-confirm-header">
                            <span class="sa-confirm-icon">\u26A0\uFE0F</span>
                            <h3>\u786E\u8BA4\u63D0\u793A</h3>
                        </div>
                        <div class="sa-confirm-body"><p id="sa-confirm-message"></p></div>
                        <div class="sa-confirm-footer">
                            <button class="sa-confirm-btn cancel" id="sa-confirm-cancel">\u53D6\u6D88</button>
                            <button class="sa-confirm-btn confirm" id="sa-confirm-ok">\u786E\u8BA4</button>
                        </div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            modal = document.getElementById('sa-confirm-modal');
        }
        const messageEl = document.getElementById('sa-confirm-message');
        const okBtn = document.getElementById('sa-confirm-ok');
        const cancelBtn = document.getElementById('sa-confirm-cancel');
        messageEl.textContent = message;
        modal.style.display = 'flex';
        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };
        const handleOk = () => { cleanup(); resolve(true); };
        const handleCancel = () => { cleanup(); resolve(false); };
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

// ---- Category badge helper ----

function saGetCategoryBadge(category) {
    const map = {
        '\u7528\u4F8B\u8BC4\u5BA1': { cls: 'sa-badge-blue', label: '\u7528\u4F8B\u8BC4\u5BA1' },
        '\u7528\u4F8B\u751F\u6210': { cls: 'sa-badge-green', label: '\u7528\u4F8B\u751F\u6210' },
        '\u95EE\u7B54\u52A9\u624B': { cls: 'sa-badge-orange', label: '\u95EE\u7B54\u52A9\u624B' },
        '\u4EE3\u7801\u5BA1\u67E5': { cls: 'sa-badge-purple', label: '\u4EE3\u7801\u5BA1\u67E5' },
        '\u6587\u6863\u751F\u6210': { cls: 'sa-badge-cyan', label: '\u6587\u6863\u751F\u6210' },
        '\u6570\u636E\u5206\u6790': { cls: 'sa-badge-pink', label: '\u6570\u636E\u5206\u6790' }
    };
    const info = map[category];
    if (info) {
        return `<span class="sa-badge ${info.cls}">${saEscapeHtml(info.label)}</span>`;
    }
    return `<span class="sa-badge sa-badge-default">${saEscapeHtml(category || '-')}</span>`;
}

// ---- Modal open / close ----

function saOpenModal(modalId) {
    const overlay = document.getElementById('saOverlay');
    const modal = document.getElementById(modalId);
    if (overlay) overlay.classList.add('show');
    if (modal) modal.classList.add('open');
}

function saCloseModal(modalId) {
    const overlay = document.getElementById('saOverlay');
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
    // 如果没有其他打开的 modal, 也关闭 overlay
    const anyOpen = document.querySelector('.sa-modal.open');
    if (!anyOpen && overlay) overlay.classList.remove('show');
}

function saCloseAllModals() {
    const overlay = document.getElementById('saOverlay');
    if (overlay) overlay.classList.remove('show');
    document.querySelectorAll('#sub-agents-section .sa-modal').forEach(el => el.classList.remove('open'));
    saCloseKbDrawer();
}

// =====================================================================
// 1. initSubAgentsConfig() - Initialize the module, bind events
// =====================================================================

function initSubAgentsConfig() {
    if (subAgentInitialized) return;
    subAgentInitialized = true;

    saEnsureContainer();
    saInjectStyles();

    loadAvailableModels();

    const btnCreate = document.getElementById('saBtnCreateAgent');
    if (btnCreate) {
        btnCreate.addEventListener('click', () => openSubAgentModal(null));
    }

    // 绑定编辑弹窗内的 tab 切换
    const modalTabs = document.querySelectorAll('#saAgentModal .sa-modal-tab');
    modalTabs.forEach(tab => {
        tab.addEventListener('click', function () {
            const targetTab = this.dataset.tab;
            saSwitchModalTab(targetTab);
        });
    });

    // 绑定保存按钮
    const btnSave = document.getElementById('saBtnSaveAgent');
    if (btnSave) {
        btnSave.addEventListener('click', saveSubAgent);
    }

    // 绑定关闭 / 取消按钮
    const btnCloseModal = document.getElementById('saBtnCloseAgentModal');
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => saCloseModal('saAgentModal'));
    }
    const btnCancelModal = document.getElementById('saBtnCancelAgentModal');
    if (btnCancelModal) {
        btnCancelModal.addEventListener('click', () => saCloseModal('saAgentModal'));
    }

    // 绑定 Soul.md / User.md 预览按钮
    const btnPreviewSoul = document.getElementById('saBtnPreviewSoul');
    if (btnPreviewSoul) {
        btnPreviewSoul.addEventListener('click', () => saTogglePreview('soul'));
    }
    const btnPreviewUser = document.getElementById('saBtnPreviewUser');
    if (btnPreviewUser) {
        btnPreviewUser.addEventListener('click', () => saTogglePreview('user'));
    }
    const btnPreviewRule = document.getElementById('saBtnPreviewRule');
    if (btnPreviewRule) {
        btnPreviewRule.addEventListener('click', () => saTogglePreview('rule'));
    }

    // 绑定 config 文件保存按钮
    const btnSaveSoul = document.getElementById('saBtnSaveSoul');
    if (btnSaveSoul) {
        btnSaveSoul.addEventListener('click', () => {
            if (saCurrentEditId) saveConfigFile(saCurrentEditId, 'soul_md');
        });
    }
    const btnSaveUser = document.getElementById('saBtnSaveUser');
    if (btnSaveUser) {
        btnSaveUser.addEventListener('click', () => {
            if (saCurrentEditId) saveConfigFile(saCurrentEditId, 'user_md');
        });
    }
    const btnSaveRule = document.getElementById('saBtnSaveRule');
    if (btnSaveRule) {
        btnSaveRule.addEventListener('click', () => {
            if (saCurrentEditId) saveConfigFile(saCurrentEditId, 'rule_md');
        });
    }

    // 绑定初始化默认配置按钮
    const btnInitConfigs = document.getElementById('saBtnInitConfigFiles');
    if (btnInitConfigs) {
        btnInitConfigs.addEventListener('click', () => {
            if (saCurrentEditId) initDefaultConfigFiles(saCurrentEditId);
        });
    }

    // 绑定参考文档 - 添加按钮
    const btnAddRefDoc = document.getElementById('saBtnAddRefDoc');
    if (btnAddRefDoc) {
        btnAddRefDoc.addEventListener('click', saAddRefDocRow);
    }

    // 绑定参考文档 - 从知识库选择按钮
    const btnSelectFromKB = document.getElementById('saBtnSelectFromKB');
    if (btnSelectFromKB) {
        btnSelectFromKB.addEventListener('click', saOpenKbDrawer);
    }

    // 绑定 Tools.md 穿梭框操作
    const btnToolsSelectAll = document.getElementById('saBtnToolsSelectAll');
    if (btnToolsSelectAll) {
        btnToolsSelectAll.addEventListener('click', () => saTransferAllTools('right'));
    }
    const btnToolsDeselectAll = document.getElementById('saBtnToolsDeselectAll');
    if (btnToolsDeselectAll) {
        btnToolsDeselectAll.addEventListener('click', () => saTransferAllTools('left'));
    }
    const btnToolsSelectSelected = document.getElementById('saBtnToolsSelectSelected');
    if (btnToolsSelectSelected) {
        btnToolsSelectSelected.addEventListener('click', () => saTransferSelectedTools('right'));
    }
    const btnToolsDeselectSelected = document.getElementById('saBtnToolsDeselectSelected');
    if (btnToolsDeselectSelected) {
        btnToolsDeselectSelected.addEventListener('click', () => saTransferSelectedTools('left'));
    }
    const btnSaveTools = document.getElementById('saBtnSaveTools');
    if (btnSaveTools) {
        btnSaveTools.addEventListener('click', () => {
            if (saCurrentEditId) saveConfigFile(saCurrentEditId, 'tools_md');
        });
    }

    // 绑定列表区事件委托
    const listContainer = document.getElementById('saAgentListBody');
    if (listContainer) {
        listContainer.addEventListener('click', saHandleListClick);
        listContainer.addEventListener('change', saHandleListChange);
    }

    // ESC 关闭弹窗
    document.addEventListener('keydown', (e) => {
        const section = document.getElementById('sub-agents-section');
        if (!section || section.style.display === 'none') return;
        if (e.key === 'Escape') {
            const kbOverlay = document.getElementById('saKbOverlay');
            if (kbOverlay && kbOverlay.classList.contains('show')) {
                saCloseKbDrawer();
                return;
            }
            if (document.getElementById('wfViewerModal')) {
                closeWorkflowViewer();
            } else {
                saCloseAllModals();
            }
        }
    });
}

// ---- Ensure DOM container exists ----

function saEnsureContainer() {
    let section = document.getElementById('sub-agents-section') || document.getElementById('ai-sub-agents-config');
    if (!section) return;

    if (!document.getElementById('saAgentListBody')) {
        const existingTbody = document.getElementById('sub-agents-list-body');
        if (existingTbody) {
            existingTbody.id = 'saAgentListBody';
        } else {
            const listArea = section.querySelector('.sa-list-area') || section.querySelector('.config-section') || section;
            listArea.innerHTML = `
            <div class="sa-list-header">
                <h3>\u667A\u80FD\u4F53\u5217\u8868</h3>
                <button class="sa-btn sa-btn-primary" id="saBtnCreateAgent">+ \u65B0\u5EFA\u667A\u80FD\u4F53</button>
            </div>
            <div class="sa-table-wrapper">
                <table class="sa-table">
                    <thead>
                        <tr>
                            <th>Agent Code</th>
                            <th>\u663E\u793A\u540D\u79F0</th>
                            <th>\u5206\u7C7B</th>
                            <th>\u8BB0\u5FC6</th>
                            <th>\u72B6\u6001</th>
                            <th>\u64CD\u4F5C</th>
                        </tr>
                    </thead>
                    <tbody id="saAgentListBody"></tbody>
                </table>
            </div>
        `;
        }
    }

    const btnCreate = document.getElementById('create-sub-agent-btn');
    if (btnCreate && !document.getElementById('saBtnCreateAgent')) {
        btnCreate.id = 'saBtnCreateAgent';
    }

    if (!document.getElementById('saAgentModal')) {
        const modalHtml = saBuildEditModalHtml();
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    if (!document.getElementById('saOverlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'saOverlay';
        overlay.className = 'sa-overlay';
        document.body.appendChild(overlay);
    }
}

// ---- Build edit modal HTML ----

function saBuildEditModalHtml() {
    return `
    <div id="saAgentModal" class="sa-modal">
        <div class="sa-modal-header">
            <h3 id="saModalTitle">\u65B0\u5EFA\u667A\u80FD\u4F53</h3>
            <button class="sa-modal-close" id="saBtnCloseAgentModal">&times;</button>
        </div>
        <div id="saOverrideBanner" class="sa-override-banner" style="display:none;">
            \u26A0\uFE0F \u60A8\u6B63\u5728\u4FEE\u6539\u7CFB\u7EDF\u5185\u7F6E\u667A\u80FD\u4F53\uFF0C\u4FDD\u5B58\u540E\u5C06\u521B\u5EFA\u60A8\u7684\u79C1\u6709\u7248\u672C
        </div>
        <div class="sa-modal-tabs">
            <button class="sa-modal-tab active" data-tab="basic">\u57FA\u672C\u4FE1\u606F</button>
            <button class="sa-modal-tab" data-tab="soul">Soul.md</button>
            <button class="sa-modal-tab" data-tab="user">User.md</button>
            <button class="sa-modal-tab" data-tab="tools">Tools.md</button>
            <button class="sa-modal-tab" data-tab="rule">Rule.md</button>
            <button class="sa-modal-tab" data-tab="refdocs">\u53C2\u8003\u6587\u6863</button>
        </div>
        <div class="sa-modal-body">
            <!-- Tab: 基本信息 -->
            <div id="saTabBasic" class="sa-tab-content active">
                <div class="sa-form-group">
                    <label>Agent Code <span class="sa-required">*</span></label>
                    <input type="text" id="saInputAgentCode" class="sa-input" placeholder="\u4F8B: case_reviewer" maxlength="64">
                </div>
                <div class="sa-form-group">
                    <label>\u663E\u793A\u540D\u79F0 <span class="sa-required">*</span></label>
                    <input type="text" id="saInputDisplayName" class="sa-input" placeholder="\u4F8B: \u7528\u4F8B\u8BC4\u5BA1\u52A9\u624B" maxlength="128">
                </div>
                <div class="sa-form-group">
                    <label>\u5206\u7C7B</label>
                    <input type="text" id="saInputCategory" class="sa-input" placeholder="\u8F93\u5165\u81EA\u5B9A\u4E49\u5206\u7C7B\u6216\u4ECE\u4E0B\u65B9\u9009\u62E9" list="saCategoryList" maxlength="64">
                    <datalist id="saCategoryList">
                        <option value="\u7528\u4F8B\u8BC4\u5BA1">
                        <option value="\u7528\u4F8B\u751F\u6210">
                        <option value="\u95EE\u7B54\u52A9\u624B">
                        <option value="\u4EE3\u7801\u5BA1\u67E5">
                        <option value="\u6587\u6863\u751F\u6210">
                        <option value="\u6570\u636E\u5206\u6790">
                    </datalist>
                    <div style="margin-top:6px;font-size:12px;color:#94a3b8;">\u53EF\u8F93\u5165\u81EA\u5B9A\u4E49\u5206\u7C7B\uFF0C\u6216\u4ECE\u4E0B\u62C9\u5217\u8868\u4E2D\u9009\u62E9\u5E38\u7528\u5206\u7C7B</div>
                </div>
                <div class="sa-form-group">
                    <label>\u63CF\u8FF0</label>
                    <textarea id="saInputDescription" class="sa-textarea" rows="3" placeholder="\u667A\u80FD\u4F53\u7684\u529F\u80FD\u63CF\u8FF0"></textarea>
                </div>
                <div class="sa-form-group">
                    <label>\u6A21\u578B</label>
                    <select id="saInputModel" class="sa-select">
                        <option value="">-- \u52A0\u8F7D\u4E2D --</option>
                    </select>
                </div>
                <div class="sa-form-section-title" style="margin-top:16px;padding-bottom:8px;border-bottom:1px solid var(--color-border-primary, #e2e8f0);font-size:13px;font-weight:600;color:var(--color-text-secondary, #475569);">\u{1F3A7} LLM \u53C2\u6570\u914D\u7F6E</div>
                <div class="sa-form-row">
                    <div class="sa-form-group">
                        <label>\u6E29\u5EA6 (Temperature)</label>
                        <input type="number" id="saInputTemperature" class="sa-input" value="0.7" min="0" max="2" step="0.1" placeholder="0.7">
                        <div class="sa-field-hint" style="font-size:11px;color:#94a3b8;margin-top:4px;">\u63A7\u5236\u8F93\u51FA\u968F\u673A\u6027\uFF0C0-2\uFF0C\u9ED8\u8BA40.7</div>
                    </div>
                    <div class="sa-form-group">
                        <label>\u6700\u5927Token\u6570</label>
                        <input type="number" id="saInputMaxTokens" class="sa-input" value="4096" min="100" max="128000" step="100" placeholder="4096">
                        <div class="sa-field-hint" style="font-size:11px;color:#94a3b8;margin-top:4px;">\u5355\u6B21\u8F93\u51FA\u6700\u5927\u957F\u5EA6\uFF0C\u9ED8\u8BA44096</div>
                    </div>
                </div>
                <div class="sa-form-row">
                    <div class="sa-form-group">
                        <label>\u6700\u5927\u91CD\u8BD5\u6B21\u6570</label>
                        <input type="number" id="saInputMaxRetries" class="sa-input" value="3" min="0" max="10" step="1" placeholder="3">
                        <div class="sa-field-hint" style="font-size:11px;color:#94a3b8;margin-top:4px;">\u8C03\u7528\u5931\u8D25\u540E\u91CD\u8BD5\u6B21\u6570\uFF0C\u9ED8\u8BA43</div>
                    </div>
                    <div class="sa-form-group">
                        <label>\u8D85\u65F6\u65F6\u95F4(\u79D2)</label>
                        <input type="number" id="saInputTimeout" class="sa-input" value="300" min="10" max="3600" step="10" placeholder="300">
                        <div class="sa-field-hint" style="font-size:11px;color:#94a3b8;margin-top:4px;">\u5355\u6B21\u6267\u884C\u8D85\u65F6\uFF0C\u9ED8\u8BA4300\u79D2</div>
                    </div>
                </div>
                <div class="sa-form-row">
                    <div class="sa-form-group">
                        <label>\u542F\u7528\u8BB0\u5FC6</label>
                        <select id="saInputMemoryEnabled" class="sa-select">
                            <option value="1">\u662F</option>
                            <option value="0">\u5426</option>
                        </select>
                    </div>
                    <div class="sa-form-group">
                        <label>\u542F\u7528\u72B6\u6001</label>
                        <select id="saInputIsEnabled" class="sa-select">
                            <option value="1">\u542F\u7528</option>
                            <option value="0">\u7981\u7528</option>
                        </select>
                    </div>
                </div>
                <div class="sa-form-row">
                    <div class="sa-form-group">
                        <label>\u6D41\u5F0F\u8F93\u51FA</label>
                        <select id="saInputStreamMode" class="sa-select">
                            <option value="auto">\u81EA\u52A8\uFF08QA\u6D41\u5F0F/\u4EFB\u52A1\u975E\u6D41\u5F0F\uFF09</option>
                            <option value="always">\u59CB\u7EC8\u6D41\u5F0F</option>
                            <option value="never">\u59CB\u7EC8\u975E\u6D41\u5F0F</option>
                        </select>
                    </div>
                    <div class="sa-form-group">
                        <label>\u6392\u5E8F</label>
                        <input type="number" id="saInputSortOrder" class="sa-input" value="0" min="0">
                    </div>
                </div>
            </div>

            <!-- Tab: Soul.md -->
            <div id="saTabSoul" class="sa-tab-content" style="display:none;">
                <div class="sa-md-editor-layout">
                    <div class="sa-md-editor-pane">
                        <div class="sa-md-editor-toolbar">
                            <span>Soul.md \u7F16\u8F91\u5668</span>
                            <button class="sa-btn sa-btn-sm sa-btn-ghost" id="saBtnPreviewSoul">\u9884\u89C8</button>
                        </div>
                        <textarea id="saInputSoulMd" class="sa-md-textarea" placeholder="\u8F93\u5165 Soul.md \u5185\u5BB9..."></textarea>
                    </div>
                    <div class="sa-md-preview-pane" id="saSoulPreviewPane" style="display:none;">
                        <div class="sa-md-preview-toolbar">Soul.md \u9884\u89C8</div>
                        <div class="sa-md-preview-body" id="saSoulPreviewBody"></div>
                    </div>
                </div>
                <div class="sa-md-editor-actions">
                    <button class="sa-btn sa-btn-primary" id="saBtnSaveSoul">\u4FDD\u5B58 Soul.md</button>
                </div>
            </div>

            <!-- Tab: User.md -->
            <div id="saTabUser" class="sa-tab-content" style="display:none;">
                <div class="sa-md-editor-layout">
                    <div class="sa-md-editor-pane">
                        <div class="sa-md-editor-toolbar">
                            <span>User.md \u7F16\u8F91\u5668</span>
                            <button class="sa-btn sa-btn-sm sa-btn-ghost" id="saBtnPreviewUser">\u9884\u89C8</button>
                        </div>
                        <textarea id="saInputUserMd" class="sa-md-textarea" placeholder="\u8F93\u5165 User.md \u5185\u5BB9..."></textarea>
                    </div>
                    <div class="sa-md-preview-pane" id="saUserPreviewPane" style="display:none;">
                        <div class="sa-md-preview-toolbar">User.md \u9884\u89C8</div>
                        <div class="sa-md-preview-body" id="saUserPreviewBody"></div>
                    </div>
                </div>
                <div class="sa-md-editor-actions">
                    <button class="sa-btn sa-btn-primary" id="saBtnSaveUser">\u4FDD\u5B58 User.md</button>
                </div>
            </div>

            <!-- Tab: Tools.md -->
            <div id="saTabTools" class="sa-tab-content" style="display:none;">
                <div id="saTransferBoxContainer" class="sa-transfer-box"></div>
                <div class="sa-md-editor-actions">
                    <button class="sa-btn sa-btn-primary" id="saBtnSaveTools">\u4FDD\u5B58 Tools.md</button>
                </div>
            </div>

            <!-- Tab: Rule.md -->
            <div id="saTabRule" class="sa-tab-content" style="display:none;">
                <div class="sa-md-editor-layout">
                    <div class="sa-md-editor-pane">
                        <div class="sa-md-editor-toolbar">
                            <span>Rule.md \u7F16\u8F91\u5668</span>
                            <button class="sa-btn sa-btn-sm sa-btn-ghost" id="saBtnPreviewRule">\u9884\u89C8</button>
                        </div>
                        <textarea id="saInputRuleMd" class="sa-md-textarea" placeholder="\u8F93\u5165 Rule.md \u5185\u5BB9\uFF0C\u5B9A\u4E49\u9636\u68AF\u5F0F\u8BC4\u5BA1\u89C4\u5219\u94FE..."></textarea>
                    </div>
                    <div class="sa-md-preview-pane" id="saRulePreviewPane" style="display:none;">
                        <div class="sa-md-preview-toolbar">Rule.md \u9884\u89C8</div>
                        <div class="sa-md-preview-body" id="saRulePreviewBody"></div>
                    </div>
                </div>
                <div class="sa-md-editor-actions">
                    <button class="sa-btn sa-btn-primary" id="saBtnSaveRule">\u4FDD\u5B58 Rule.md</button>
                </div>
            </div>

            <!-- Tab: 参考文档 -->
            <div id="saTabRefdocs" class="sa-tab-content" style="display:none;">
                <div class="sa-refdocs-header">
                    <span>\u53C2\u8003\u6587\u6863\u5217\u8868</span>
                    <div class="sa-refdocs-actions">
                        <button class="sa-btn sa-btn-sm sa-btn-ghost" id="saBtnInitConfigFiles">\u521D\u59CB\u5316\u9ED8\u8BA4\u914D\u7F6E</button>
                        <button class="sa-btn sa-btn-sm sa-btn-ghost" id="saBtnAddRefDoc">+ \u624B\u52A8\u6DFB\u52A0</button>
                        <button class="sa-btn sa-btn-sm sa-btn-primary" id="saBtnSelectFromKB">\uD83D\uDCDA \u4ECE\u77E5\u8BC6\u5E93\u9009\u62E9</button>
                    </div>
                </div>
                <div id="saRefDocsList" class="sa-refdocs-list"></div>
                <div class="sa-refdocs-tip" style="margin-top:12px;font-size:12px;color:#94a3b8;text-align:center;">
                    \u63D0\u793A\uFF1A\u6DFB\u52A0\u3001\u7F16\u8F91\u3001\u5220\u9664\u64CD\u4F5C\u5747\u4E3A\u5373\u65F6\u4FDD\u5B58
                </div>
            </div>
        </div>
        <div class="sa-modal-footer">
            <button class="sa-btn sa-btn-ghost" id="saBtnCancelAgentModal">\u53D6\u6D88</button>
            <button class="sa-btn sa-btn-primary" id="saBtnSaveAgent">\u4FDD\u5B58</button>
        </div>
    </div>`;
}

// ---- Inject styles ----

function saInjectStyles() {
    if (document.getElementById('sa-sub-agents-styles')) return;
    const style = document.createElement('style');
    style.id = 'sa-sub-agents-styles';
    style.textContent = `
        /* Overlay */
        .sa-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.45); z-index: 11001; display: none; }
        .sa-overlay.show { display: block; }

        /* Modal */
        .sa-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border-radius: 12px; width: 720px; min-width: 600px; max-width: 92vw; height: 680px; min-height: 500px; max-height: 88vh; display: none; flex-direction: column; z-index: 11002; box-shadow: 0 8px 40px rgba(0,0,0,0.18); resize: both; overflow: hidden; }
        .sa-modal.open { display: flex; }
        .sa-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid #e2e8f0; }
        .sa-modal-header h3 { margin: 0; font-size: 17px; color: #1e293b; }
        .sa-modal-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #94a3b8; padding: 4px 8px; border-radius: 6px; transition: all .15s; }
        .sa-modal-close:hover { background: #f1f5f9; color: #475569; }

        /* Override banner */
        .sa-override-banner { padding: 10px 24px; background: #fef3c7; color: #92400e; font-size: 13px; border-bottom: 1px solid #fde68a; }

        /* Tabs */
        .sa-modal-tabs { display: flex; border-bottom: 1px solid #e2e8f0; padding: 0 24px; gap: 0; }
        .sa-modal-tab { padding: 10px 16px; border: none; background: none; cursor: pointer; font-size: 14px; color: #64748b; border-bottom: 2px solid transparent; transition: all .15s; }
        .sa-modal-tab:hover { color: #334155; }
        .sa-modal-tab.active { color: #6366f1; border-bottom-color: #6366f1; font-weight: 500; }

        /* Tab content */
        .sa-tab-content { display: none; padding: 20px 24px; overflow-y: auto; flex: 1; min-height: 0; }
        .sa-tab-content.active { display: block; }
        
        /* Modal body */
        .sa-modal-body { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
        .sa-modal-body > .sa-tab-content { flex: 1; display: none; }
        .sa-modal-body > .sa-tab-content.active { display: flex; flex-direction: column; }

        /* Form elements */
        .sa-form-group { margin-bottom: 16px; }
        .sa-form-group label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #475569; }
        .sa-required { color: #ef4444; }
        .sa-input, .sa-select, .sa-textarea { width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none; transition: border-color .15s; box-sizing: border-box; }
        .sa-input:focus, .sa-select:focus, .sa-textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
        .sa-textarea { resize: vertical; font-family: 'SF Mono', 'Fira Code', monospace; }
        .sa-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

        /* Buttons */
        .sa-btn { padding: 8px 16px; border-radius: 8px; font-size: 14px; cursor: pointer; border: none; transition: all .15s; display: inline-flex; align-items: center; gap: 6px; }
        .sa-btn-primary { background: #6366f1; color: #fff; }
        .sa-btn-primary:hover { background: #4f46e5; }
        .sa-btn-ghost { background: transparent; color: #64748b; }
        .sa-btn-ghost:hover { background: #f1f5f9; }
        .sa-btn-danger { background: #ef4444; color: #fff; }
        .sa-btn-danger:hover { background: #dc2626; }
        .sa-btn-warning { background: #f59e0b; color: #fff; }
        .sa-btn-warning:hover { background: #d97706; }
        .sa-btn-sm { padding: 4px 10px; font-size: 12px; }

        /* Table */
        .sa-table { width: 100%; border-collapse: collapse; }
        .sa-table th { text-align: left; padding: 10px 12px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; background: #f8fafc; }
        .sa-table td { padding: 10px 12px; font-size: 14px; color: #334155; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .sa-table tr:hover td { background: #f8fafc; }

        /* Badges */
        .sa-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
        .sa-badge-blue { background: #dbeafe; color: #1d4ed8; }
        .sa-badge-green { background: #dcfce7; color: #15803d; }
        .sa-badge-orange { background: #ffedd5; color: #c2410c; }
        .sa-badge-purple { background: #f3e8ff; color: #7c3aed; }
        .sa-badge-cyan { background: #cffafe; color: #0891b2; }
        .sa-badge-pink { background: #fce7f3; color: #be185d; }
        .sa-badge-default { background: #f1f5f9; color: #64748b; }
        .sa-badge-overridden { background: #fef3c7; color: #92400e; font-size: 11px; }

        /* Toggle switch */
        .sa-toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
        .sa-toggle input { opacity: 0; width: 0; height: 0; }
        .sa-toggle-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #cbd5e1; border-radius: 22px; transition: .3s; }
        .sa-toggle-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: .3s; }
        .sa-toggle input:checked + .sa-toggle-slider { background: #6366f1; }
        .sa-toggle input:checked + .sa-toggle-slider:before { transform: translateX(18px); }

        /* Action buttons */
        .sa-action-btns { display: flex; gap: 6px; flex-wrap: nowrap; }
        .sa-action-btn { padding: 4px 10px; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; transition: background 0.15s; white-space: nowrap; }
        .sa-btn-edit { background: #ede9fe; color: #6d28d9; }
        .sa-btn-edit:hover { background: #ddd6fe; }
        .sa-btn-copy { background: #dbeafe; color: #2563eb; }
        .sa-btn-copy:hover { background: #bfdbfe; }
        .sa-btn-restore { background: #fef3c7; color: #b45309; }
        .sa-btn-restore:hover { background: #fde68a; }
        .sa-btn-delete { background: #fee2e2; color: #dc2626; }
        .sa-btn-delete:hover { background: #fecaca; }

        /* MD editor layout */
        .sa-md-editor-layout { display: flex; gap: 16px; flex: 1; min-height: 280px; }
        .sa-md-editor-pane { flex: 1; display: flex; flex-direction: column; min-height: 0; }
        .sa-md-preview-pane { flex: 1; display: flex; flex-direction: column; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; min-height: 0; }
        .sa-md-editor-toolbar, .sa-md-preview-toolbar { padding: 8px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .sa-md-textarea { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-size: 13px; line-height: 1.6; resize: none; outline: none; font-family: 'SF Mono', 'Fira Code', monospace; min-height: 200px; }
        .sa-md-textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
        .sa-md-preview-body { flex: 1; padding: 16px; overflow-y: auto; font-size: 14px; line-height: 1.7; min-height: 200px; }
        .sa-md-editor-actions { margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; }

        /* Transfer box */
        .sa-transfer-box { display: flex; gap: 12px; flex: 1; min-height: 280px; align-items: stretch; }
        .sa-transfer-panel { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
        .sa-transfer-panel-header { padding: 8px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 500; color: #475569; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .sa-transfer-panel-body { flex: 1; overflow-y: auto; padding: 4px 0; min-height: 200px; }
        .sa-transfer-item { padding: 6px 12px; font-size: 13px; color: #334155; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background .1s; }
        .sa-transfer-item:hover { background: #f1f5f9; }
        .sa-transfer-item.selected { background: #eef2ff; }
        .sa-transfer-item input[type="checkbox"] { accent-color: #6366f1; }
        .sa-transfer-actions { display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 0 4px; flex-shrink: 0; }
        .sa-transfer-action-btn { width: 32px; height: 32px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #64748b; transition: all .15s; }
        .sa-transfer-action-btn:hover:not(:disabled) { border-color: #6366f1; color: #6366f1; background: #eef2ff; }
        .sa-transfer-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sa-transfer-search { padding: 8px; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
        .sa-transfer-search input { width: 100%; padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; outline: none; }
        .sa-transfer-search input:focus { border-color: #6366f1; }

        /* Ref docs */
        .sa-refdocs-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-shrink: 0; }
        .sa-refdocs-header span { font-size: 14px; font-weight: 500; color: #334155; }
        .sa-refdocs-actions { display: flex; gap: 8px; align-items: center; }
        .sa-refdocs-list { border: 1px solid #e2e8f0; border-radius: 8px; overflow: auto; flex: 1; min-height: 280px; }
        .sa-refdoc-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
        .sa-refdoc-item:last-child { border-bottom: none; }
        .sa-refdoc-item .sa-refdoc-name { flex: 1; font-size: 14px; color: #334155; display: flex; align-items: center; gap: 8px; }
        .sa-refdoc-item .sa-refdoc-path { font-size: 12px; color: #94a3b8; }
        .sa-refdoc-item-actions { display: flex; gap: 4px; }
        .sa-refdoc-empty { padding: 40px; text-align: center; color: #94a3b8; font-size: 14px; }
        .sa-refdoc-source-badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
        .sa-refdoc-source-badge.manual { background: #f1f5f9; color: #64748b; }
        .sa-refdoc-source-badge.kb_doc { background: #f3e8ff; color: #7c3aed; }
        .sa-refdoc-source-info { font-size: 12px; color: #94a3b8; margin-top: 2px; }

        /* KB Drawer */
        .sa-kb-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.35); z-index: 11003; display: none; }
        .sa-kb-overlay.show { display: block; }
        .sa-kb-drawer { position: fixed; top: 0; right: -520px; width: 480px; height: 100vh; background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,0.12); z-index: 11004; display: flex; flex-direction: column; transition: right 0.3s ease; }
        .sa-kb-drawer.open { right: 0; }
        .sa-kb-drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
        .sa-kb-drawer-header h3 { margin: 0; font-size: 16px; color: #1e293b; }
        .sa-kb-drawer-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #94a3b8; padding: 4px 8px; border-radius: 6px; }
        .sa-kb-drawer-close:hover { background: #f1f5f9; color: #475569; }
        .sa-kb-drawer-search { padding: 12px 20px; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
        .sa-kb-drawer-search input { width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; outline: none; box-sizing: border-box; }
        .sa-kb-drawer-search input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
        .sa-kb-drawer-selectall { padding: 8px 20px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; font-size: 13px; color: #64748b; }
        .sa-kb-drawer-body { flex: 1; overflow-y: auto; padding: 0; min-height: 0; }
        .sa-kb-drawer-footer { padding: 12px 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
        .sa-kb-drawer-footer .sa-kb-selected-count { font-size: 13px; color: #64748b; }
        .sa-kb-group { border-bottom: 1px solid #f1f5f9; }
        .sa-kb-group-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; cursor: pointer; font-size: 14px; color: #334155; font-weight: 500; background: #f8fafc; }
        .sa-kb-group-header:hover { background: #f1f5f9; }
        .sa-kb-group-header .sa-kb-group-icon { margin-right: 8px; }
        .sa-kb-group-header .sa-kb-group-count { font-size: 12px; color: #94a3b8; font-weight: 400; margin-left: 8px; }
        .sa-kb-group-header .sa-kb-expand-icon { font-size: 12px; color: #94a3b8; transition: transform 0.2s; }
        .sa-kb-group-header.collapsed .sa-kb-expand-icon { transform: rotate(-90deg); }
        .sa-kb-group-list { overflow: hidden; }
        .sa-kb-group-list.collapsed { display: none; }
        .sa-kb-file-row { display: flex; align-items: center; gap: 10px; padding: 8px 20px 8px 32px; font-size: 13px; color: #334155; border-bottom: 1px solid #f8fafc; }
        .sa-kb-file-row:hover { background: #f8fafc; }
        .sa-kb-file-row.disabled { opacity: 0.5; pointer-events: none; }
        .sa-kb-file-row input[type="checkbox"] { accent-color: #6366f1; flex-shrink: 0; }
        .sa-kb-file-row .sa-kb-file-icon { flex-shrink: 0; }
        .sa-kb-file-row .sa-kb-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sa-kb-file-row .sa-kb-file-ext { font-size: 11px; color: #94a3b8; text-transform: uppercase; flex-shrink: 0; }
        .sa-kb-file-row .sa-kb-file-added { font-size: 11px; color: #f59e0b; flex-shrink: 0; }
        .sa-kb-module-header { display: flex; align-items: center; gap: 8px; padding: 8px 20px 8px 28px; cursor: pointer; font-size: 13px; color: #475569; background: #fafbfc; border-bottom: 1px solid #f8fafc; }
        .sa-kb-module-header:hover { background: #f1f5f9; }
        .sa-kb-module-header .sa-kb-expand-icon { font-size: 11px; color: #94a3b8; transition: transform 0.2s; }
        .sa-kb-module-header.collapsed .sa-kb-expand-icon { transform: rotate(-90deg); }
        .sa-kb-module-list { overflow: hidden; }
        .sa-kb-module-list.collapsed { display: none; }
        .sa-kb-empty { padding: 40px; text-align: center; color: #94a3b8; font-size: 14px; }
        .sa-kb-loading { display: flex; align-items: center; justify-content: center; padding: 40px; color: #94a3b8; }
        .sa-kb-spinner { width: 24px; height: 24px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: sa-kb-spin 0.8s linear infinite; margin-right: 8px; }
        @keyframes sa-kb-spin { to { transform: rotate(360deg); } }
        .sa-kb-resize-handle { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; cursor: col-resize; z-index: 11005; }
        .sa-kb-resize-handle:hover, .sa-kb-resize-handle.active { background: #6366f1; }

        /* Footer */
        .sa-modal-footer { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 24px; border-top: 1px solid #e2e8f0; }

        /* List header */
        .sa-list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .sa-list-header h3 { margin: 0; font-size: 18px; color: #1e293b; }
        .sa-table-wrapper { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; }

        /* Empty state */
        .sa-empty { text-align: center; padding: 60px 20px; color: #94a3b8; }
        .sa-empty-icon { font-size: 40px; margin-bottom: 12px; }
        .sa-empty-text { font-size: 14px; }

        /* Memory stats badge */
        .sa-memory-stats { font-size: 12px; color: #64748b; margin-top: 4px; }

        /* Workflow button */
        .sa-btn-workflow { color: #6366f1 !important; }
        .sa-btn-workflow:hover { background: #eef2ff !important; }

        /* ===== Workflow Viewer ===== */
        .wf-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 11001; display: block; }
        .wf-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #fff; border-radius: 12px; width: 95vw; max-width: 1400px; height: 90vh; display: flex; flex-direction: column; z-index: 11002; box-shadow: 0 8px 40px rgba(0,0,0,0.2); overflow: hidden; }
        .wf-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
        .wf-modal-header h3 { margin: 0; font-size: 17px; color: #1e293b; }
        .wf-modal-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #94a3b8; padding: 4px 8px; border-radius: 6px; transition: all .15s; }
        .wf-modal-close:hover { background: #f1f5f9; color: #475569; }
        .wf-modal-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }
        .wf-sidebar { width: 180px; flex-shrink: 0; border-right: 1px solid #e2e8f0; padding: 12px 0; overflow-y: auto; }
        @media (max-width: 700px) { .wf-modal-body { flex-direction: column; } .wf-sidebar { width: 100%; border-right: none; border-bottom: 1px solid #e2e8f0; display: flex; flex-wrap: wrap; padding: 8px; gap: 4px; } .wf-nav-item { padding: 6px 12px; border-left: none; border-bottom: 2px solid transparent; } .wf-nav-item.active { border-bottom-color: #6366f1; border-left-color: transparent; } }
        .wf-nav-item { padding: 10px 20px; cursor: pointer; font-size: 14px; color: #64748b; transition: all .15s; border-left: 3px solid transparent; }
        .wf-nav-item:hover { background: #f8fafc; color: #334155; }
        .wf-nav-item.active { background: #eef2ff; color: #6366f1; border-left-color: #6366f1; font-weight: 500; }
        .wf-content { flex: 1; overflow-y: auto; padding: 24px; min-width: 0; }

        .wf-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #94a3b8; }
        .wf-spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: wf-spin 0.8s linear infinite; margin-bottom: 12px; }
        @keyframes wf-spin { to { transform: rotate(360deg); } }
        .wf-error { text-align: center; padding: 60px; color: #ef4444; font-size: 15px; }
        .wf-hidden { display: none !important; }

        .wf-card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
        @media (max-width: 1100px) { .wf-card-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 700px) { .wf-card-grid { grid-template-columns: 1fr; } }
        .wf-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
        .wf-card-title { padding: 10px 16px; font-size: 14px; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; background: #f1f5f9; }
        .wf-card-body { padding: 12px 16px; }

        .wf-kv { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 13px; }
        .wf-k { color: #64748b; flex-shrink: 0; margin-right: 12px; }
        .wf-v { color: #1e293b; text-align: right; word-break: break-all; }

        .wf-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; color: #fff; font-weight: 500; }
        .wf-badge-warn { background: #f59e0b; color: #fff; }
        .wf-badge-success { background: #10b981; color: #fff; }
        .wf-badge-error { background: #ef4444; color: #fff; }
        .wf-badge-info { background: #3b82f6; color: #fff; }
        .wf-badge-tool { background: #6366f1; color: #fff; margin: 2px; }
        .wf-badge-lang { background: #8b5cf6; color: #fff; }
        .wf-badge-table { background: #06b6d4; color: #fff; margin: 1px; }

        .wf-empty-hint { text-align: center; color: #94a3b8; font-size: 13px; padding: 8px; }

        .wf-flow-diagram { margin-top: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
        .wf-flow-title { font-size: 15px; font-weight: 600; color: #334155; margin-bottom: 16px; text-align: center; }
        .wf-flow-steps { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
        .wf-flow-step { text-align: center; padding: 12px 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; min-width: 100px; }
        .wf-flow-step-dim { opacity: 0.5; }
        .wf-flow-icon { font-size: 24px; margin-bottom: 4px; }
        .wf-flow-label { font-size: 13px; font-weight: 500; color: #334155; }
        .wf-flow-desc { font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .wf-flow-arrow { font-size: 20px; color: #94a3b8; }

        .wf-section { margin-bottom: 24px; }
        .wf-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .wf-section-header h4 { margin: 0; font-size: 15px; color: #1e293b; }

        .wf-prompt-block { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
        .wf-source-block { padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
        .wf-source-block:last-child { border-bottom: none; }
        .wf-source-soul { border-left: 4px solid #3b82f6; }
        .wf-source-memory { border-left: 4px solid #8b5cf6; }
        .wf-source-user { border-left: 4px solid #10b981; }
        .wf-source-vars { border-left: 4px solid #f59e0b; }
        .wf-source-rendered { border-left: 4px solid #06b6d4; }
        .wf-source-refdoc { border-left: 4px solid #ec4899; }
        .wf-source-label { font-size: 12px; color: #64748b; margin-bottom: 6px; font-weight: 500; }

        .wf-pre { background: #1e293b; color: #e2e8f0; padding: 12px 16px; border-radius: 6px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; margin: 0; }
        .wf-pre.wf-collapsed { max-height: 120px; overflow: hidden; position: relative; }
        .wf-pre.wf-collapsed::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 40px; background: linear-gradient(transparent, #1e293b); pointer-events: none; }

        .wf-toggle-expand, .wf-rule-toggle { background: none; border: 1px solid #e2e8f0; padding: 4px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; color: #6366f1; margin-top: 6px; }
        .wf-toggle-expand:hover, .wf-rule-toggle:hover { background: #eef2ff; }
        .wf-copy-btn { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; color: #475569; }
        .wf-copy-btn:hover { background: #e2e8f0; }
        .wf-assembled-note { margin-top: 8px; padding: 8px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; font-size: 12px; color: #92400e; }

        .wf-vars-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
        .wf-var-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .wf-var-name { font-family: monospace; color: #6366f1; background: #eef2ff; padding: 2px 6px; border-radius: 3px; }
        .wf-var-val { color: #64748b; }

        .wf-tool-group { margin-bottom: 8px; }
        .wf-tool-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; cursor: pointer; transition: all .15s; }
        .wf-tool-card:hover { border-color: #6366f1; box-shadow: 0 2px 8px rgba(99,102,241,0.1); }
        .wf-tool-name { font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 4px; }
        .wf-tool-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #64748b; }
        .wf-tool-desc { flex: 1; }
        .wf-tool-tables { margin-top: 6px; font-size: 12px; color: #64748b; }
        .wf-tool-detail { margin-top: 4px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background: #fff; }

        .wf-loop-diagram { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
        .wf-loop-round { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .wf-loop-node { padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 500; }
        .wf-loop-llm { background: #dbeafe; color: #1d4ed8; border: 1px solid #93c5fd; }
        .wf-loop-tool { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
        .wf-loop-arrow { font-size: 12px; color: #64748b; }
        .wf-loop-note { font-size: 11px; color: #94a3b8; margin-top: 8px; text-align: center; }
        .wf-sandbox-info { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }

        .wf-pipeline-timeline { padding-left: 0; }
        .wf-rule-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
        .wf-rule-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
        .wf-rule-order { background: #6366f1; color: #fff; padding: 2px 10px; border-radius: 4px; font-size: 13px; font-weight: 600; }
        .wf-rule-filename { font-size: 13px; color: #475569; font-weight: 500; }
        .wf-rule-badges { display: flex; gap: 6px; flex-wrap: wrap; }
        .wf-rule-body { margin-bottom: 8px; }
        .wf-rule-logic { padding: 8px 0; }
        .wf-rule-flow { display: flex; flex-direction: column; gap: 6px; }
        .wf-flow-mini { display: flex; align-items: center; gap: 6px; font-size: 12px; flex-wrap: wrap; }
        .wf-node-mini { padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 500; }
        .wf-node-llm { background: #dbeafe; color: #1d4ed8; }
        .wf-node-check { background: #fef3c7; color: #92400e; }
        .wf-node-pass { background: #dcfce7; color: #15803d; }
        .wf-node-retry { background: #fee2e2; color: #991b1b; }
        .wf-arrow-mini { color: #94a3b8; }
        .wf-rule-connector { text-align: center; padding: 4px; color: #94a3b8; font-size: 12px; }
        .wf-rule-result { margin-top: 12px; }
        .wf-rule-result-pass { padding: 8px 12px; background: #dcfce7; border-radius: 6px; font-size: 13px; color: #15803d; margin-bottom: 6px; }
        .wf-rule-result-fail { padding: 8px 12px; background: #fee2e2; border-radius: 6px; font-size: 13px; color: #991b1b; }

        .wf-memory-layout { display: flex; gap: 24px; margin-bottom: 16px; }
        @media (max-width: 900px) { .wf-memory-layout { flex-direction: column; } }
        .wf-memory-tree { flex: 0 0 240px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
        @media (max-width: 900px) { .wf-memory-tree { flex: none; } }
        .wf-memory-process { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
        .wf-tree-level { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; }
        .wf-tree-indent { padding-left: 24px; }
        .wf-tree-indent-2 { padding-left: 48px; }
        .wf-tree-icon { font-size: 16px; }
        .wf-tree-name { color: #334155; font-weight: 500; }
        .wf-tree-count { color: #64748b; font-size: 12px; margin-left: auto; }
        .wf-process-step { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; }
        .wf-process-num { width: 24px; height: 24px; border-radius: 50%; background: #6366f1; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0; }
        .wf-process-text { font-size: 13px; color: #334155; line-height: 1.5; }
        .wf-process-truncate .wf-process-num { background: #f59e0b; }
        .wf-memory-status { margin-bottom: 16px; }
        .wf-memory-preview { margin-top: 16px; }

        .wf-seq-diagram { background: #fafbfc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px 16px 16px; overflow-x: auto; }
        .wf-stable { width: 100%; min-width: 700px; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
        .wf-sth { padding: 0 0 16px; text-align: center; font-weight: 500; font-size: 12px; color: #64748b; border: none; background: none; }
        .wf-actor-icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; background: #fff; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.06); font-size: 18px; margin-bottom: 6px; }
        .wf-actor-name { display: block; font-size: 11px; color: #475569; letter-spacing: 0.02em; }
        .wf-td { position: relative; height: 48px; vertical-align: top; padding: 0; }
        .wf-td::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: #e2e8f0; transform: translateX(-0.5px); pointer-events: none; }
        .wf-dot { position: absolute; left: 50%; top: 0; width: 10px; height: 10px; border-radius: 50%; transform: translate(-50%, -1px); border: 2px solid #fff; z-index: 3; box-shadow: 0 0 0 1px rgba(0,0,0,0.06); }
        .wf-dot-req { background: #4f46e5; }
        .wf-dot-res { background: #059669; }
        .wf-line-req, .wf-line-res { position: absolute; top: 4px; height: 2px; z-index: 2; }
        .wf-line-req { background: #4f46e5; }
        .wf-line-res { background: #059669; background: repeating-linear-gradient(90deg, #059669 0, #059669 6px, transparent 6px, transparent 10px); }
        .wf-line-req::after, .wf-line-res::after { content: ''; position: absolute; top: 50%; width: 0; height: 0; border-style: solid; transform: translateY(-50%); }
        .wf-line-req::after { right: -6px; border-width: 5px 0 5px 7px; border-color: transparent transparent transparent #4f46e5; }
        .wf-line-res::after { left: -6px; border-width: 5px 7px 5px 0; border-color: transparent #059669 transparent transparent; }
        .wf-label-container { position: absolute; top: 14px; z-index: 4; display: flex; justify-content: center; pointer-events: none; }
        .wf-label { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; line-height: 1.5; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; pointer-events: auto; }
        .wf-label-req { color: #4338ca; background: rgba(238, 242, 255, 0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 1px 4px rgba(79,70,229,0.10); }
        .wf-label-res { color: #065f46; background: rgba(236, 253, 245, 0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 1px 4px rgba(5,150,105,0.10); }
        .wf-note-row td { position: relative; height: 36px; vertical-align: middle; padding: 0; }
        .wf-note-row td::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: #e2e8f0; transform: translateX(-0.5px); pointer-events: none; }
        .wf-note-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 14px; border-radius: 12px; font-size: 11px; font-weight: 600; color: #6366f1; background: #fff; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); position: relative; z-index: 3; }
        .wf-note-line-l, .wf-note-line-r { position: absolute; top: 50%; height: 1px; z-index: 1; }
        .wf-note-line-l { right: calc(50% + 60px); left: 0; background: linear-gradient(90deg, transparent, #e2e8f0); }
        .wf-note-line-r { left: calc(50% + 60px); right: 0; background: linear-gradient(270deg, transparent, #e2e8f0); }

        .wf-full-prompt { position: absolute; left: -9999px; }

        /* Dark theme */
        [data-theme="dark"] .wf-modal { background: #1e293b; }
        [data-theme="dark"] .wf-modal-header { border-bottom-color: #334155; }
        [data-theme="dark"] .wf-modal-header h3 { color: #e2e8f0; }
        [data-theme="dark"] .wf-modal-close { color: #64748b; }
        [data-theme="dark"] .wf-modal-close:hover { background: #334155; color: #e2e8f0; }
        [data-theme="dark"] .wf-sidebar { border-right-color: #334155; }
        [data-theme="dark"] .wf-nav-item { color: #94a3b8; }
        [data-theme="dark"] .wf-nav-item:hover { background: #334155; color: #e2e8f0; }
        [data-theme="dark"] .wf-nav-item.active { background: #1e1b4b; color: #818cf8; border-left-color: #818cf8; }
        [data-theme="dark"] .wf-content { color: #e2e8f0; }
        [data-theme="dark"] .wf-card { background: #334155; border-color: #475569; }
        [data-theme="dark"] .wf-card-title { background: #1e293b; border-bottom-color: #475569; color: #e2e8f0; }
        [data-theme="dark"] .wf-card-body { background: #334155; }
        [data-theme="dark"] .wf-k { color: #94a3b8; }
        [data-theme="dark"] .wf-v { color: #e2e8f0; }
        [data-theme="dark"] .wf-section-header h4 { color: #e2e8f0; }
        [data-theme="dark"] .wf-prompt-block { border-color: #475569; }
        [data-theme="dark"] .wf-source-block { border-bottom-color: #475569; }
        [data-theme="dark"] .wf-source-label { color: #94a3b8; }
        [data-theme="dark"] .wf-pre { background: #0f172a; color: #e2e8f0; }
        [data-theme="dark"] .wf-pre.wf-collapsed::after { background: linear-gradient(transparent, #0f172a); }
        [data-theme="dark"] .wf-assembled-note { background: #422006; border-color: #92400e; color: #fbbf24; }
        [data-theme="dark"] .wf-toggle-expand, [data-theme="dark"] .wf-rule-toggle { border-color: #475569; color: #818cf8; }
        [data-theme="dark"] .wf-toggle-expand:hover, [data-theme="dark"] .wf-rule-toggle:hover { background: #1e1b4b; }
        [data-theme="dark"] .wf-copy-btn { background: #334155; border-color: #475569; color: #e2e8f0; }
        [data-theme="dark"] .wf-copy-btn:hover { background: #475569; }
        [data-theme="dark"] .wf-tool-card { background: #334155; border-color: #475569; }
        [data-theme="dark"] .wf-tool-card:hover { border-color: #818cf8; }
        [data-theme="dark"] .wf-tool-name { color: #e2e8f0; }
        [data-theme="dark"] .wf-tool-detail { background: #1e293b; border-color: #475569; }
        [data-theme="dark"] .wf-loop-diagram, [data-theme="dark"] .wf-sandbox-info { background: #334155; border-color: #475569; }
        [data-theme="dark"] .wf-rule-card { background: #334155; border-color: #475569; }
        [data-theme="dark"] .wf-rule-result-pass { background: #064e3b; color: #6ee7b7; }
        [data-theme="dark"] .wf-rule-result-fail { background: #7f1d1d; color: #fca5a5; }
        [data-theme="dark"] .wf-memory-tree, [data-theme="dark"] .wf-memory-process { background: #334155; border-color: #475569; }
        [data-theme="dark"] .wf-tree-name { color: #e2e8f0; }
        [data-theme="dark"] .wf-tree-count { color: #94a3b8; }
        [data-theme="dark"] .wf-process-text { color: #e2e8f0; }
        [data-theme="dark"] .wf-flow-diagram { background: #334155; border-color: #475569; }
        [data-theme="dark"] .wf-flow-step { background: #1e293b; border-color: #475569; }
        [data-theme="dark"] .wf-flow-label { color: #e2e8f0; }
        [data-theme="dark"] .wf-empty-hint { color: #64748b; }
        [data-theme="dark"] .wf-seq-diagram { background: #1e293b; border-color: #334155; }
        [data-theme="dark"] .wf-sth { color: #94a3b8; }
        [data-theme="dark"] .wf-actor-icon { background: #334155; border-color: #475569; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        [data-theme="dark"] .wf-actor-name { color: #94a3b8; }
        [data-theme="dark"] .wf-td::before { background: #334155; }
        [data-theme="dark"] .wf-dot { border-color: #1e293b; box-shadow: 0 0 0 1px rgba(255,255,255,0.06); }
        [data-theme="dark"] .wf-dot-req { background: #818cf8; }
        [data-theme="dark"] .wf-dot-res { background: #34d399; }
        [data-theme="dark"] .wf-line-req { background: #818cf8; }
        [data-theme="dark"] .wf-line-res { background: repeating-linear-gradient(90deg, #34d399 0, #34d399 6px, transparent 6px, transparent 10px); }
        [data-theme="dark"] .wf-line-req::after { border-color: transparent transparent transparent #818cf8; }
        [data-theme="dark"] .wf-line-res::after { border-color: transparent #34d399 transparent transparent; }
        [data-theme="dark"] .wf-label-req { color: #c7d2fe; background: rgba(49,46,129,0.6); box-shadow: 0 1px 4px rgba(129,140,248,0.15); }
        [data-theme="dark"] .wf-label-res { color: #a7f3d0; background: rgba(6,78,59,0.6); box-shadow: 0 1px 4px rgba(52,211,153,0.15); }
        [data-theme="dark"] .wf-note-row td::before { background: #334155; }
        [data-theme="dark"] .wf-note-badge { color: #a5b4fc; background: #334155; border-color: #475569; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        [data-theme="dark"] .wf-note-line-l { background: linear-gradient(90deg, transparent, #475569); }
        [data-theme="dark"] .wf-note-line-r { background: linear-gradient(270deg, transparent, #475569); }

        [data-theme="dark"] .sa-confirm-box { background: #1e293b; }
        [data-theme="dark"] .sa-confirm-header { border-bottom-color: #334155; }
        [data-theme="dark"] .sa-confirm-header h3 { color: #e2e8f0; }
        [data-theme="dark"] .sa-confirm-body p { color: #94a3b8; }
        [data-theme="dark"] .sa-confirm-footer { border-top-color: #334155; }
        [data-theme="dark"] .sa-confirm-btn.cancel { background: #334155; color: #94a3b8; }
        [data-theme="dark"] .sa-confirm-btn.cancel:hover { background: #475569; }
        [data-theme="dark"] .sa-modal { background: #1e293b; }
        [data-theme="dark"] .sa-modal-header { border-bottom-color: #334155; }
        [data-theme="dark"] .sa-modal-header h3 { color: #e2e8f0; }
        [data-theme="dark"] .sa-modal-close { color: #94a3b8; }
        [data-theme="dark"] .sa-modal-close:hover { background: #334155; color: #e2e8f0; }
        [data-theme="dark"] .sa-modal-tabs { border-bottom-color: #334155; }
        [data-theme="dark"] .sa-modal-tab { color: #94a3b8; }
        [data-theme="dark"] .sa-modal-tab:hover { color: #e2e8f0; }
        [data-theme="dark"] .sa-modal-tab.active { color: #818cf8; border-bottom-color: #818cf8; }
        [data-theme="dark"] .sa-modal-footer { border-top-color: #334155; }
        [data-theme="dark"] .sa-form-group label { color: #94a3b8; }
        [data-theme="dark"] .sa-input, [data-theme="dark"] .sa-select, [data-theme="dark"] .sa-textarea { border-color: #334155; background: #0f172a; color: #e2e8f0; }
        [data-theme="dark"] .sa-input:focus, [data-theme="dark"] .sa-select:focus, [data-theme="dark"] .sa-textarea:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.1); }
        [data-theme="dark"] .sa-btn-ghost { color: #94a3b8; }
        [data-theme="dark"] .sa-btn-ghost:hover { background: #334155; }
        [data-theme="dark"] .sa-table th { color: #94a3b8; border-bottom-color: #475569; background: #1e293b; }
        [data-theme="dark"] .sa-table td { color: #c9d1d9; border-bottom-color: #21262d; }
        [data-theme="dark"] .sa-table tr:hover td { background: #1e293b; }
        [data-theme="dark"] .sa-badge-default { background: #334155; color: #94a3b8; }
        [data-theme="dark"] .sa-table-wrapper { border-color: #334155; }
        [data-theme="dark"] .sa-toggle-slider { background: #475569; }
        [data-theme="dark"] .sa-toggle-slider:before { background: #e2e8f0; }
        [data-theme="dark"] .sa-md-preview-pane { border-color: #334155; }
        [data-theme="dark"] .sa-md-editor-toolbar, [data-theme="dark"] .sa-md-preview-toolbar { background: #1e293b; border-bottom-color: #334155; color: #94a3b8; }
        [data-theme="dark"] .sa-md-textarea { border-color: #334155; background: #0f172a; color: #e2e8f0; }
        [data-theme="dark"] .sa-transfer-panel { border-color: #334155; }
        [data-theme="dark"] .sa-transfer-panel-header { background: #1e293b; border-bottom-color: #334155; color: #94a3b8; }
        [data-theme="dark"] .sa-transfer-item { color: #c9d1d9; }
        [data-theme="dark"] .sa-transfer-item:hover { background: #334155; }
        [data-theme="dark"] .sa-transfer-action-btn { background: #1e293b; border-color: #334155; color: #94a3b8; }
        [data-theme="dark"] .sa-transfer-search { border-bottom-color: #334155; }
        [data-theme="dark"] .sa-transfer-search input { border-color: #334155; background: #0f172a; color: #e2e8f0; }
        [data-theme="dark"] .sa-refdocs-header span { color: #c9d1d9; }
        [data-theme="dark"] .sa-refdocs-list { border-color: #334155; }
        [data-theme="dark"] .sa-refdoc-item { border-bottom-color: #21262d; }
        [data-theme="dark"] .sa-refdoc-item .sa-refdoc-name { color: #c9d1d9; }
        [data-theme="dark"] .sa-list-header h3 { color: #e2e8f0; }
        [data-theme="dark"] .sa-memory-stats { color: #94a3b8; }
        [data-theme="dark"] .wf-spinner { border-color: #334155; }
        [data-theme="dark"] .wf-var-val { color: #94a3b8; }
        [data-theme="dark"] .wf-tool-meta { color: #94a3b8; }
        [data-theme="dark"] .wf-tool-tables { color: #94a3b8; }
        [data-theme="dark"] .wf-loop-arrow { color: #94a3b8; }
        [data-theme="dark"] .wf-rule-filename { color: #94a3b8; }
    `;
    document.head.appendChild(style);
}

let saAvailableModels = [];

async function loadAvailableModels() {
    try {
        const result = await apiRequest('/ai-sub-agents/available-models', { useCache: true });
        if (result.success && result.data) {
            saAvailableModels = result.data;
            renderModelSelect();
        }
    } catch (e) {
        console.error('[Sub-Agents] loadAvailableModels error:', e);
        saAvailableModels = [{ id: 'gpt-4o', name: 'gpt-4o', displayName: 'GPT-4o (默认)', isDefault: true }];
        renderModelSelect();
    }
}

function renderModelSelect(currentModel) {
    const select = document.getElementById('saInputModel');
    if (!select) return;
    
    const defaultModel = saAvailableModels.find(m => m.isDefault)?.name || saAvailableModels[0]?.name || 'gpt-4o';
    const selectedModel = currentModel || defaultModel;
    
    select.innerHTML = saAvailableModels.map(m => 
        `<option value="${m.name}" ${m.name === selectedModel ? 'selected' : ''}>${m.displayName || m.name}${m.isDefault ? ' (默认)' : ''}</option>`
    ).join('');
}

// =====================================================================
// 2. loadSubAgentsList() - Load and render agent list table
// =====================================================================

async function loadSubAgentsList() {
    const tbody = document.getElementById('saAgentListBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:${ThemeService.getColor('textMuted')};">\u52A0\u8F7D\u4E2D...</td></tr>`;

    try {
        const result = await apiRequest('/ai-sub-agents/list');
        if (result.success) {
            const agents = result.data || result.agents || [];
            if (agents.length === 0) {
                tbody.innerHTML = `
                    <tr><td colspan="6">
                        <div class="sa-empty">
                            <div class="sa-empty-icon">\u{1F916}</div>
                            <div class="sa-empty-text">\u6682\u65E0\u667A\u80FD\u4F53\uFF0C\u70B9\u51FB\u53F3\u4E0A\u89D2\u201C\u65B0\u5EFA\u667A\u80FD\u4F53\u201D\u5F00\u59CB</div>
                        </div>
                    </td></tr>`;
                return;
            }
            renderAgentListTable(agents);
        } else {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444;">${saEscapeHtml(result.message || '\u52A0\u8F7D\u5931\u8D25')}</td></tr>`;
            if (typeof showErrorMessage === 'function') {
                showErrorMessage(result.message || '\u52A0\u8F7D\u667A\u80FD\u4F53\u5217\u8868\u5931\u8D25');
            }
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444;">\u7F51\u7EDC\u9519\u8BEF</td></tr>`;
        if (typeof showErrorMessage === 'function') {
            showErrorMessage('\u52A0\u8F7D\u667A\u80FD\u4F53\u5217\u8868\u5931\u8D25: ' + e.message);
        }
    }
}

function renderAgentListTable(agents) {
    const tbody = document.getElementById('saAgentListBody');
    if (!tbody) return;

    tbody.innerHTML = agents.map(agent => {
        const isSystem = agent.isSystem === 1 || agent.isSystem === true || agent.is_system === 1 || agent.is_system === true;
        const isOverridden = agent.isOverridden === 1 || agent.isOverridden === true || agent.is_overridden === 1 || agent.is_overridden === true;
        const isEnabled = agent.isEnabled === 1 || agent.isEnabled === true || agent.is_enabled === 1 || agent.is_enabled === true;
        const memoryEnabled = agent.memoryEnabled === 1 || agent.memoryEnabled === true || agent.memory_enabled === 1 || agent.memory_enabled === true;

        const ms = agent.memoryStats || {};
        const totalCount = (ms.global && ms.global.count || 0) + (ms.library && ms.library.count || 0) + (ms.module && ms.module.count || 0);
        const memoryStatsHtml = memoryEnabled ? `<div class="sa-memory-stats">${totalCount} \u6761\u8BB0\u5F55</div>` : '';

        return `
        <tr data-agent-id="${agent.id}" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}" data-is-system="${isSystem}">
            <td>
                <span style="font-family:monospace;font-size:13px;">${saEscapeHtml(agent.agentCode || agent.agent_code)}</span>
                ${isOverridden ? '<span class="sa-badge sa-badge-overridden" style="margin-left:6px;">\u{1F3F7}\uFE0F \u5DF2\u81EA\u5B9A\u4E49</span>' : ''}
            </td>
            <td>${saEscapeHtml(agent.displayName || agent.display_name)}</td>
            <td>${saGetCategoryBadge(agent.category)}</td>
            <td>${memoryEnabled ? '\u2705' : '\u274C'}
                ${memoryStatsHtml}
            </td>
            <td>
                <label class="sa-toggle">
                    <input type="checkbox" ${isEnabled ? 'checked' : ''} data-toggle-id="${agent.id}" data-action="toggle">
                    <span class="sa-toggle-slider"></span>
                </label>
            </td>
            <td>
                <div class="sa-action-btns">
                    <button class="sa-action-btn sa-btn-edit" data-action="edit" data-id="${agent.id}" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u270F\uFE0F \u7F16\u8F91</button>
                    <button class="sa-action-btn sa-btn-workflow" data-action="workflow" data-id="${agent.id}" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u{1F50D} \u5DE5\u4F5C\u6D41</button>
                    <button class="sa-action-btn sa-btn-copy" data-action="copy" data-id="${agent.id}" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u{1F4CB} \u590D\u5236</button>
                    ${isSystem && isOverridden ? `<button class="sa-action-btn sa-btn-restore" data-action="restore" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u{1F504} \u6062\u590D</button>` : ''}
                    ${!isSystem ? `<button class="sa-action-btn sa-btn-delete" data-action="delete" data-id="${agent.id}" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u{1F5D1}\uFE0F \u5220\u9664</button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

async function loadMemoryStatsBadge(agentId) {
    try {
        const result = await apiRequest(`/ai-memories/stats/${agentId}`, { useCache: true });
        if (result.success && result.data) {
            const row = document.querySelector(`tr[data-agent-id="${agentId}"]`);
            if (row) {
                const memoryCell = row.querySelectorAll('td')[3];
                const stats = result.data;
                const statsHtml = `<div class="sa-memory-stats">${stats.total_count || 0} \u6761\u8BB0\u5F55</div>`;
                memoryCell.insertAdjacentHTML('beforeend', statsHtml);
            }
        }
    } catch (e) {
        // 静默失败
    }
}

// ---- List event handlers (delegated) ----

function saHandleListClick(e) {
    const btn = e.target.closest('.sa-action-btn');
    if (btn) {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const agentCode = btn.dataset.agentCode;

        if (action === 'edit') {
            openSubAgentModal(agentCode);
        } else if (action === 'workflow') {
            openWorkflowViewer(agentCode);
        } else if (action === 'copy') {
            saCopyAgent(id, agentCode);
        } else if (action === 'restore') {
            restoreDefault(agentCode);
        } else if (action === 'delete') {
            deleteSubAgent(id, agentCode);
        }
    }
}

function saHandleListChange(e) {
    const toggleInput = e.target.closest('[data-action="toggle"]');
    if (toggleInput) {
        const id = toggleInput.dataset.toggleId;
        toggleSubAgent(id);
    }
}

// =====================================================================
// 3. openSubAgentModal(agentCode) - Open create/edit modal
// =====================================================================

async function openSubAgentModal(agentCode) {
    saCloseKbDrawer();

    // Reset state
    saCurrentEditId = null;
    saCurrentEditAgentCode = null;
    saCurrentEditIsSystem = false;
    saCurrentEditIsOverridden = false;
    saConfigFilesCache = {};
    saAvailableTools = [];
    saMountedToolIds = [];

    // Reset form
    saResetModalForm();

    if (agentCode) {
        // 编辑模式: 加载详情
        document.getElementById('saModalTitle').textContent = '\u52A0\u8F7D\u4E2D...';
        saOpenModal('saAgentModal');

        try {
            const result = await apiRequest(`/ai-sub-agents/detail/${encodeURIComponent(agentCode)}`);
            if (result.success) {
                const agent = result.data.agent;
                saCurrentEditId = agent.id;
                saCurrentEditAgentCode = agent.agentCode || agent.agent_code;
                saCurrentEditIsSystem = agent.isSystem === 1 || agent.isSystem === true || agent.is_system === 1 || agent.is_system === true;
                saCurrentEditIsOverridden = agent.isOverridden === 1 || agent.isOverridden === true || agent.is_overridden === 1 || agent.is_overridden === true;

                document.getElementById('saModalTitle').textContent =
                    `\u7F16\u8F91\u667A\u80FD\u4F53: ${agent.displayName || agent.display_name || agent.agentCode || agent.agent_code}`;

                // 填充基本信息
                document.getElementById('saInputAgentCode').value = agent.agentCode || agent.agent_code || '';
                document.getElementById('saInputAgentCode').disabled = true;
                document.getElementById('saInputDisplayName').value = agent.displayName || agent.display_name || '';
                document.getElementById('saInputCategory').value = agent.category || '';
                document.getElementById('saInputDescription').value = agent.description || '';
                renderModelSelect(agent.model);
                document.getElementById('saInputMemoryEnabled').value = (agent.memoryEnabled === 1 || agent.memoryEnabled === true || agent.memory_enabled === 1 || agent.memory_enabled === true) ? '1' : '0';
                document.getElementById('saInputIsEnabled').value = (agent.isEnabled === 1 || agent.isEnabled === true || agent.is_enabled === 1 || agent.is_enabled === true) ? '1' : '0';
                const streamModeSelect = document.getElementById('saInputStreamMode');
                if (streamModeSelect) streamModeSelect.value = agent.streamMode || agent.stream_mode || 'auto';
                document.getElementById('saInputSortOrder').value = agent.sortOrder || agent.sort_order || 0;

                document.getElementById('saInputTemperature').value = agent.llmTemperature || agent.llm_temperature || 0.7;
                document.getElementById('saInputMaxTokens').value = agent.llmMaxTokens || agent.llm_max_tokens || 4096;
                document.getElementById('saInputMaxRetries').value = agent.maxRetries || agent.max_retries || 3;
                document.getElementById('saInputTimeout').value = agent.timeoutSeconds || agent.timeout_seconds || 300;

                // Override banner
                const banner = document.getElementById('saOverrideBanner');
                if (saCurrentEditIsSystem) {
                    banner.style.display = 'block';
                } else {
                    banner.style.display = 'none';
                }

                // 加载配置文件
                await loadConfigFiles(agent.id);

                // 加载工具穿梭框
                await loadToolsForTransfer(agent.id);
            } else {
                if (typeof showErrorMessage === 'function') {
                    showErrorMessage(result.message || '\u52A0\u8F7D\u667A\u80FD\u4F53\u8BE6\u60C5\u5931\u8D25');
                }
                saCloseModal('saAgentModal');
            }
        } catch (e) {
            if (typeof showErrorMessage === 'function') {
                showErrorMessage('\u52A0\u8F7D\u667A\u80FD\u4F53\u8BE6\u60C5\u5931\u8D25: ' + e.message);
            }
            saCloseModal('saAgentModal');
        }
    } else {
        // 新建模式
        document.getElementById('saModalTitle').textContent = '\u65B0\u5EFA\u667A\u80FD\u4F53';
        document.getElementById('saInputAgentCode').disabled = false;
        document.getElementById('saOverrideBanner').style.display = 'none';

        // 清空配置文件区域
        document.getElementById('saInputSoulMd').value = '';
        document.getElementById('saInputUserMd').value = '';
        document.getElementById('saTransferBoxContainer').innerHTML = '<div class="sa-empty"><div class="sa-empty-icon">\u{1F527}</div><div class="sa-empty-text">\u4FDD\u5B58\u667A\u80FD\u4F53\u540E\u53EF\u914D\u7F6E\u5DE5\u5177</div></div>';
        document.getElementById('saRefDocsList').innerHTML = '<div class="sa-refdoc-empty">\u6682\u65E0\u53C2\u8003\u6587\u6863</div>';

        // 加载全部工具供选择
        await loadToolsForTransfer(null);

        saOpenModal('saAgentModal');
    }

    // 默认切到基本信息 tab
    saSwitchModalTab('basic');
}

function saResetModalForm() {
    const inputs = ['saInputAgentCode', 'saInputDisplayName', 'saInputDescription', 'saInputSortOrder', 'saInputCategory'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.disabled = false; }
    });
    renderModelSelect(null);
    const saInputMemoryEnabled = document.getElementById('saInputMemoryEnabled');
    if (saInputMemoryEnabled) saInputMemoryEnabled.value = '1';
    const saInputIsEnabled = document.getElementById('saInputIsEnabled');
    if (saInputIsEnabled) saInputIsEnabled.value = '1';
    const saInputSoulMd = document.getElementById('saInputSoulMd');
    if (saInputSoulMd) saInputSoulMd.value = '';
    const saInputUserMd = document.getElementById('saInputUserMd');
    if (saInputUserMd) saInputUserMd.value = '';
    const saInputRuleMd = document.getElementById('saInputRuleMd');
    if (saInputRuleMd) saInputRuleMd.value = '';

    const saInputTemperature = document.getElementById('saInputTemperature');
    if (saInputTemperature) saInputTemperature.value = '0.7';
    const saInputMaxTokens = document.getElementById('saInputMaxTokens');
    if (saInputMaxTokens) saInputMaxTokens.value = '4096';
    const saInputMaxRetries = document.getElementById('saInputMaxRetries');
    if (saInputMaxRetries) saInputMaxRetries.value = '3';
    const saInputTimeout = document.getElementById('saInputTimeout');
    if (saInputTimeout) saInputTimeout.value = '300';

    // 隐藏预览
    const soulPreview = document.getElementById('saSoulPreviewPane');
    if (soulPreview) soulPreview.style.display = 'none';
    const userPreview = document.getElementById('saUserPreviewPane');
    if (userPreview) userPreview.style.display = 'none';
    const rulePreview = document.getElementById('saRulePreviewPane');
    if (rulePreview) rulePreview.style.display = 'none';
}

function saSwitchModalTab(tabName) {
    // 切换 tab 按钮高亮
    document.querySelectorAll('#saAgentModal .sa-modal-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    // 切换 tab 内容
    const tabMap = { basic: 'saTabBasic', soul: 'saTabSoul', user: 'saTabUser', tools: 'saTabTools', rule: 'saTabRule', refdocs: 'saTabRefdocs' };
    Object.entries(tabMap).forEach(([key, panelId]) => {
        const panel = document.getElementById(panelId);
        if (panel) {
            if (key === tabName) {
                panel.style.display = 'block';
                panel.classList.add('active');
            } else {
                panel.style.display = 'none';
                panel.classList.remove('active');
            }
        }
    });
}

// ---- Markdown preview toggle ----

function saTogglePreview(type) {
    const paneId = type === 'soul' ? 'saSoulPreviewPane' : type === 'rule' ? 'saRulePreviewPane' : 'saUserPreviewPane';
    const textareaId = type === 'soul' ? 'saInputSoulMd' : type === 'rule' ? 'saInputRuleMd' : 'saInputUserMd';
    const bodyId = type === 'soul' ? 'saSoulPreviewBody' : type === 'rule' ? 'saRulePreviewBody' : 'saUserPreviewBody';

    const pane = document.getElementById(paneId);
    const textarea = document.getElementById(textareaId);
    const body = document.getElementById(bodyId);

    if (!pane || !textarea || !body) return;

    if (pane.style.display === 'none') {
        pane.style.display = 'flex';
        // 渲染 Markdown
        const content = textarea.value || '';
        if (typeof marked !== 'undefined' && marked.parse) {
            const rawHtml = marked.parse(content);
            body.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : rawHtml;
        } else {
            body.innerHTML = `<pre style="white-space:pre-wrap;">${saEscapeHtml(content)}</pre>`;
        }
    } else {
        pane.style.display = 'none';
    }
}

// =====================================================================
// 4. saveSubAgent() - Save agent (create or update)
// =====================================================================

async function saveSubAgent() {
    const agentCode = document.getElementById('saInputAgentCode').value.trim();
    const displayName = document.getElementById('saInputDisplayName').value.trim();
    const category = document.getElementById('saInputCategory').value;
    const description = document.getElementById('saInputDescription').value.trim();
    const model = document.getElementById('saInputModel').value.trim();
    const memoryEnabled = document.getElementById('saInputMemoryEnabled').value === '1';
    const isEnabled = document.getElementById('saInputIsEnabled').value === '1';
    const sortOrder = parseInt(document.getElementById('saInputSortOrder').value) || 0;

    const temperature = parseFloat(document.getElementById('saInputTemperature').value) || 0.7;
    const maxTokens = parseInt(document.getElementById('saInputMaxTokens').value) || 4096;
    const maxRetries = parseInt(document.getElementById('saInputMaxRetries').value) || 3;
    const timeoutSeconds = parseInt(document.getElementById('saInputTimeout').value) || 300;

    // 验证
    if (!agentCode) {
        if (typeof showErrorMessage === 'function') showErrorMessage('Agent Code \u4E0D\u80FD\u4E3A\u7A7A');
        return;
    }
    if (!displayName) {
        if (typeof showErrorMessage === 'function') showErrorMessage('\u663E\u793A\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A');
        return;
    }

    const data = {
        agent_code: agentCode,
        display_name: displayName,
        category,
        description,
        model: model || 'gpt-4o',
        memory_enabled: memoryEnabled,
        is_enabled: isEnabled,
        sort_order: sortOrder,
        llm_temperature: temperature,
        llm_max_tokens: maxTokens,
        max_retries: maxRetries,
        timeout_seconds: timeoutSeconds,
        stream_mode: document.getElementById('saInputStreamMode') ? document.getElementById('saInputStreamMode').value : 'auto'
    };

    try {
        let result;
        if (saCurrentEditId) {
            // 更新
            result = await apiRequest(`/ai-sub-agents/update/${saCurrentEditId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            // 新建
            result = await apiRequest('/ai-sub-agents/create', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }

        if (result.success) {
            if (typeof showSuccessMessage === 'function') {
                showSuccessMessage(saCurrentEditId ? '\u667A\u80FD\u4F53\u66F4\u65B0\u6210\u529F' : '\u667A\u80FD\u4F53\u521B\u5EFA\u6210\u529F');
            }
            saCloseModal('saAgentModal');
            await loadSubAgentsList();

            // 如果是新建, 刷新后可拿到 id, 然后打开编辑以配置文件
            if (!saCurrentEditId && result.data && result.data.id) {
                // 可选: 自动打开编辑弹窗
            }
        } else {
            if (typeof showErrorMessage === 'function') {
                showErrorMessage(result.message || '\u4FDD\u5B58\u5931\u8D25');
            }
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') {
            showErrorMessage('\u4FDD\u5B58\u5931\u8D25: ' + e.message);
        }
    }
}

// =====================================================================
// 5. deleteSubAgent(id, agentCode) - Delete agent with confirmation
// =====================================================================

async function deleteSubAgent(id, agentCode) {
    const confirmed = await saShowConfirm(`\u786E\u5B9A\u8981\u5220\u9664\u667A\u80FD\u4F53 "${agentCode}" \u5417\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`);
    if (!confirmed) return;

    try {
        const result = await apiRequest(`/ai-sub-agents/${id}`, {
            method: 'DELETE'
        });
        if (result.success) {
            if (typeof showSuccessMessage === 'function') {
                showSuccessMessage('\u667A\u80FD\u4F53\u5DF2\u5220\u9664');
            }
            await loadSubAgentsList();
        } else {
            if (typeof showErrorMessage === 'function') {
                showErrorMessage(result.message || '\u5220\u9664\u5931\u8D25');
            }
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') {
            showErrorMessage('\u5220\u9664\u5931\u8D25: ' + e.message);
        }
    }
}

// =====================================================================
// 6. toggleSubAgent(id) - Toggle enabled status
// =====================================================================

async function toggleSubAgent(id) {
    try {
        const result = await apiRequest(`/ai-sub-agents/toggle/${id}`, {
            method: 'POST'
        });
        if (result.success) {
            if (typeof showSuccessMessage === 'function') {
                showSuccessMessage('\u72B6\u6001\u5DF2\u5207\u6362');
            }
            // 不需要重新加载整个列表, 但为保持数据一致性还是刷新
            await loadSubAgentsList();
        } else {
            if (typeof showErrorMessage === 'function') {
                showErrorMessage(result.message || '\u5207\u6362\u72B6\u6001\u5931\u8D25');
            }
            // 恢复开关状态
            await loadSubAgentsList();
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') {
            showErrorMessage('\u5207\u6362\u72B6\u6001\u5931\u8D25: ' + e.message);
        }
        await loadSubAgentsList();
    }
}

// =====================================================================
// 7. restoreDefault(agentCode) - Restore system default
// =====================================================================

async function restoreDefault(agentCode) {
    const confirmed = await saShowConfirm(`\u786E\u5B9A\u8981\u6062\u590D\u667A\u80FD\u4F53 "${agentCode}" \u7684\u7CFB\u7EDF\u9ED8\u8BA4\u914D\u7F6E\u5417\uFF1F\u60A8\u7684\u79C1\u6709\u8986\u76D6\u5C06\u88AB\u5220\u9664\u3002`);
    if (!confirmed) return;

    try {
        const result = await apiRequest(`/ai-sub-agents/override/${encodeURIComponent(agentCode)}`, {
            method: 'DELETE'
        });
        if (result.success) {
            if (typeof showSuccessMessage === 'function') {
                showSuccessMessage('\u5DF2\u6062\u590D\u7CFB\u7EDF\u9ED8\u8BA4\u914D\u7F6E');
            }
            await loadSubAgentsList();
        } else {
            if (typeof showErrorMessage === 'function') {
                showErrorMessage(result.message || '\u6062\u590D\u9ED8\u8BA4\u5931\u8D25');
            }
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') {
            showErrorMessage('\u6062\u590D\u9ED8\u8BA4\u5931\u8D25: ' + e.message);
        }
    }
}

// =====================================================================
// 8. loadConfigFiles(agentId) - Load config files for the edit modal
// =====================================================================

async function loadConfigFiles(agentId) {
    if (!agentId) return;

    try {
        const result = await apiRequest(`/ai-sub-agents/config-files/${agentId}`, { useCache: false });
        if (result.success) {
            const files = result.data || [];
            saConfigFilesCache = {};

            files.forEach(f => {
                if (f.file_type === 'ref_doc' || f.file_type === 'kb_doc' || f.file_type === 'custom') {
                    if (!saConfigFilesCache['_refDocs']) {
                        saConfigFilesCache['_refDocs'] = [];
                    }
                    saConfigFilesCache['_refDocs'].push(f);
                } else {
                    saConfigFilesCache[f.file_type] = f;
                }
            });

            // 填充 Soul.md
            const soulFile = saConfigFilesCache['soul'];
            const soulTextarea = document.getElementById('saInputSoulMd');
            if (soulTextarea) {
                soulTextarea.value = soulFile ? (soulFile.content || '') : '';
            }

            const userFile = saConfigFilesCache['user'];
            const userTextarea = document.getElementById('saInputUserMd');
            if (userTextarea) {
                userTextarea.value = userFile ? (userFile.content || '') : '';
            }

            const ruleFiles = files.filter(f => f.file_type === 'rule');
            const ruleTextarea = document.getElementById('saInputRuleMd');
            if (ruleTextarea) {
                ruleTextarea.value = ruleFiles.map(f => f.content || '').join('\n\n---\n\n');
            }

            renderRefDocsList(files.filter(f => f.file_type === 'ref_doc' || f.file_type === 'custom' || f.file_type === 'kb_doc'));
        }
    } catch (e) {
        console.error('[Sub-Agents] loadConfigFiles error:', e);
    }
}

// ---- Render reference docs list ----

function renderRefDocsList(refDocs) {
    const container = document.getElementById('saRefDocsList');
    if (!container) return;

    if (!refDocs || refDocs.length === 0) {
        container.innerHTML = '<div class="sa-refdoc-empty">\u6682\u65E0\u53C2\u8003\u6587\u6863\uFF0C\u70B9\u51FB\u201C\u624B\u52A8\u6DFB\u52A0\u201D\u6216\u201C\u4ECE\u77E5\u8BC6\u5E93\u9009\u62E9\u201D</div>';
        return;
    }

    container.innerHTML = refDocs.map(doc => {
        const sourceType = doc.source_type || (doc.file_type === 'kb_doc' ? 'kb_doc' : 'manual');
        const badgeClass = sourceType === 'kb_doc' ? 'kb_doc' : 'manual';
        const badgeText = sourceType === 'kb_doc' ? '\u77E5\u8BC6\u5E93' : '\u624B\u52A8';
        const sourceInfo = doc.source_path ? `<div class="sa-refdoc-source-info">\u6765\u6E90: ${saEscapeHtml(doc.source_path)}</div>` : '';

        return `
        <div class="sa-refdoc-item" data-file-id="${doc.id}" data-source-type="${sourceType}">
            <div style="flex:1;">
                <div class="sa-refdoc-name">
                    ${saEscapeHtml(doc.file_name || doc.name || '\u672A\u547D\u540D')}
                    <span class="sa-refdoc-source-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="sa-refdoc-path">${saEscapeHtml(doc.file_path || '')} ${doc.updated_at ? '| ' + saFormatDateTime(doc.updated_at) : ''}</div>
                ${sourceInfo}
            </div>
            <div class="sa-refdoc-item-actions">
                <button class="sa-btn sa-btn-sm sa-btn-ghost" data-action="edit-refdoc" data-file-id="${doc.id}" data-file-name="${saEscapeHtml(doc.file_name || doc.name || '')}">\u270F\uFE0F</button>
                <button class="sa-btn sa-btn-sm sa-btn-ghost" data-action="delete-refdoc" data-file-id="${doc.id}" data-file-name="${saEscapeHtml(doc.file_name || doc.name || '')}">\u{1F5D1}\uFE0F</button>
            </div>
        </div>
        `;
    }).join('');

    container.querySelectorAll('[data-action="edit-refdoc"]').forEach(btn => {
        btn.addEventListener('click', function () {
            const fileId = this.dataset.fileId;
            const fileName = this.dataset.fileName;
            saEditRefDoc(fileId, fileName);
        });
    });
    container.querySelectorAll('[data-action="delete-refdoc"]').forEach(btn => {
        btn.addEventListener('click', async function () {
            const fileId = this.dataset.fileId;
            const fileName = this.dataset.fileName;
            const confirmed = await saShowConfirm(`\u786E\u5B9A\u5220\u9664\u53C2\u8003\u6587\u6863 "${fileName}" \u5417\uFF1F`);
            if (!confirmed) return;
            await saDeleteRefDoc(fileId);
        });
    });
}

// ---- Add / Edit / Delete ref doc ----

function saAddRefDocRow() {
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '\u6587\u6863\u540D\u79F0';

    const contentInput = document.createElement('textarea');
    contentInput.placeholder = '\u6587\u6863\u5185\u5BB9';
    contentInput.rows = 12;

    const dialog = saCreateInputDialog('\u6DFB\u52A0\u53C2\u8003\u6587\u6863', [
        { label: '\u6587\u6863\u540D\u79F0', input: nameInput },
        { label: '\u5185\u5BB9', input: contentInput }
    ]);

    dialog.onConfirm = async () => {
        const name = nameInput.value.trim();
        const content = contentInput.value.trim();
        if (!name) {
            if (typeof showErrorMessage === 'function') showErrorMessage('\u8BF7\u8F93\u5165\u6587\u6863\u540D\u79F0');
            return false;
        }
        try {
            const result = await apiRequest(`/ai-sub-agents/config-files/${saCurrentEditId}`, {
                method: 'POST',
                body: JSON.stringify({
                    file_type: 'ref_doc',
                    file_name: name,
                    content: content
                })
            });
            if (result.success) {
                if (typeof showSuccessMessage === 'function') showSuccessMessage('\u6587\u6863\u5DF2\u6DFB\u52A0');
                await loadConfigFiles(saCurrentEditId);
            } else {
                if (typeof showErrorMessage === 'function') showErrorMessage(result.message || '\u6DFB\u52A0\u5931\u8D25');
            }
        } catch (e) {
            if (typeof showErrorMessage === 'function') showErrorMessage('\u6DFB\u52A0\u5931\u8D25: ' + e.message);
        }
    };
}

async function saEditRefDoc(fileId, fileName) {
    const refDocs = saConfigFilesCache['_refDocs'] || [];
    const doc = refDocs.find(f => f.id === Number(fileId));
    if (!doc) {
        if (typeof showErrorMessage === 'function') showErrorMessage('\u672A\u627E\u5230\u6587\u6863\u4FE1\u606F');
        return;
    }
    const currentContent = doc.content || '';
    const isKbDoc = doc.file_type === 'kb_doc';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = fileName;

    const contentInput = document.createElement('textarea');
    contentInput.rows = 12;
    contentInput.value = currentContent;

    const dialogTitle = isKbDoc ? '\u7F16\u8F91\u77E5\u8BC6\u5E93\u6587\u6863' : '\u7F16\u8F91\u53C2\u8003\u6587\u6863';
    const dialog = saCreateInputDialog(dialogTitle, [
        { label: '\u6587\u6863\u540D\u79F0', input: nameInput },
        { label: '\u5185\u5BB9', input: contentInput }
    ]);

    dialog.onConfirm = async () => {
        const name = nameInput.value.trim();
        const content = contentInput.value.trim();
        if (!name) {
            if (typeof showErrorMessage === 'function') showErrorMessage('\u8BF7\u8F93\u5165\u6587\u6863\u540D\u79F0');
            return false;
        }
        try {
            const result = await apiRequest(`/ai-sub-agents/config-files/${saCurrentEditId}/${doc.file_type || 'ref_doc'}`, {
                method: 'PUT',
                body: JSON.stringify({
                    file_id: fileId,
                    file_name: name,
                    content: content
                })
            });
            if (result.success) {
                if (typeof showSuccessMessage === 'function') showSuccessMessage('\u6587\u6863\u5DF2\u66F4\u65B0');
                await loadConfigFiles(saCurrentEditId);
            } else {
                if (typeof showErrorMessage === 'function') showErrorMessage(result.message || '\u66F4\u65B0\u5931\u8D25');
            }
        } catch (e) {
            if (typeof showErrorMessage === 'function') showErrorMessage('\u66F4\u65B0\u5931\u8D25: ' + e.message);
        }
    };
}

async function saDeleteRefDoc(fileId) {
    try {
        const result = await apiRequest(`/ai-sub-agents/config-files/${fileId}`, {
            method: 'DELETE'
        });
        if (result.success) {
            if (typeof showSuccessMessage === 'function') showSuccessMessage('\u6587\u6863\u5DF2\u5220\u9664');
            await loadConfigFiles(saCurrentEditId);
        } else {
            if (typeof showErrorMessage === 'function') showErrorMessage(result.message || '\u5220\u9664\u5931\u8D25');
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') showErrorMessage('\u5220\u9664\u5931\u8D25: ' + e.message);
    }
}

// =====================================================================
// Knowledge Base Drawer - Select documents from knowledge base
// =====================================================================

let saKbSelectedFiles = new Set();
let saKbTreeData = null;
let saKbExistingSourceIds = new Set();

function saGetFileIcon(ext) {
    if (!ext) return '\uD83D\uDCC4';
    const e = ext.toLowerCase();
    if (['md', 'markdown'].includes(e)) return '\uD83D\uDCDD';
    if (['txt'].includes(e)) return '\uD83D\uDCC4';
    if (['doc', 'docx'].includes(e)) return '\uD83D\uDCD1';
    if (['xls', 'xlsx'].includes(e)) return '\uD83D\uDCCA';
    if (['pdf'].includes(e)) return '\uD83D\uDCD5';
    if (['ppt', 'pptx'].includes(e)) return '\uD83D\uDCD8';
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(e)) return '\uD83D\uDDBC\uFE0F';
    if (['zip', 'rar', '7z'].includes(e)) return '\uD83D\uDCE6';
    return '\uD83D\uDCC4';
}

function saCountFilesInTree(items, depth) {
    if (!items || (depth || 0) > 20) return 0;
    let count = 0;
    items.forEach(item => {
        if (item.type === 'folder' || item.type === 'module') {
            count += saCountFilesInTree(item.children, (depth || 0) + 1);
        } else if (item.type !== 'library') {
            count++;
        }
    });
    return count;
}

function saEnsureKbDrawer() {
    let overlay = document.getElementById('saKbOverlay');
    let drawer = document.getElementById('saKbDrawer');
    if (overlay && drawer) return;

    overlay = document.createElement('div');
    overlay.id = 'saKbOverlay';
    overlay.className = 'sa-kb-overlay';

    drawer = document.createElement('div');
    drawer.id = 'saKbDrawer';
    drawer.className = 'sa-kb-drawer';
    drawer.innerHTML = `
        <div class="sa-kb-resize-handle" id="saKbResizeHandle"></div>
        <div class="sa-kb-drawer-header">
            <h3>\uD83D\uDCDA \u9009\u62E9\u77E5\u8BC6\u5E93\u6587\u6863</h3>
            <button class="sa-kb-drawer-close" id="saKbCloseBtn">\u2715</button>
        </div>
        <div class="sa-kb-drawer-search">
            <input type="text" id="saKbSearchInput" placeholder="\u641C\u7D22\u6587\u4EF6\u540D\u79F0...">
        </div>
        <div class="sa-kb-drawer-selectall">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" id="saKbSelectAllCb"> \u5168\u9009
            </label>
            <span id="saKbSelectionCount">\u5DF2\u9009 0 \u4E2A\u6587\u4EF6</span>
        </div>
        <div class="sa-kb-drawer-body" id="saKbBody">
            <div class="sa-kb-loading"><div class="sa-kb-spinner"></div>\u52A0\u8F7D\u4E2D...</div>
        </div>
        <div class="sa-kb-drawer-footer">
            <span class="sa-kb-selected-count" id="saKbFooterCount">\u5DF2\u9009 0 \u4E2A\u6587\u4EF6</span>
            <div style="display:flex;gap:8px;">
                <button class="sa-btn sa-btn-ghost" id="saKbCancelBtn">\u53D6\u6D88</button>
                <button class="sa-btn sa-btn-primary" id="saKbConfirmBtn">\u786E\u8BA4\u9009\u62E9</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    overlay.addEventListener('click', saCloseKbDrawer);
    document.getElementById('saKbCloseBtn').addEventListener('click', saCloseKbDrawer);
    document.getElementById('saKbCancelBtn').addEventListener('click', saCloseKbDrawer);
    document.getElementById('saKbConfirmBtn').addEventListener('click', saConfirmKbSelection);
    document.getElementById('saKbSearchInput').addEventListener('input', saFilterKbTree);
    document.getElementById('saKbSelectAllCb').addEventListener('change', saToggleKbSelectAll);

    saInitKbDrawerResize();
}

let saKbResizeMouseMoveHandler = null;
let saKbResizeMouseUpHandler = null;

function saInitKbDrawerResize() {
    const handle = document.getElementById('saKbResizeHandle');
    const drawer = document.getElementById('saKbDrawer');
    if (!handle || !drawer) return;
    if (handle.dataset.resizeInit === '1') return;
    handle.dataset.resizeInit = '1';

    let isResizing = false;
    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    saKbResizeMouseMoveHandler = (e) => {
        if (!isResizing) return;
        const newWidth = window.innerWidth - e.clientX;
        const minWidth = 400;
        const maxWidth = Math.round(window.innerWidth * 0.9);
        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        drawer.style.width = clampedWidth + 'px';
    };
    saKbResizeMouseUpHandler = () => {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', saKbResizeMouseMoveHandler);
    document.addEventListener('mouseup', saKbResizeMouseUpHandler);
}

async function saOpenKbDrawer() {
    if (!saCurrentEditId) return;

    saKbSelectedFiles = new Set();

    const refDocs = saConfigFilesCache['_refDocs'] || [];
    saKbExistingSourceIds = new Set();
    refDocs.forEach(doc => {
        if (doc.source_type === 'kb_doc' && doc.source_file_id) {
            saKbExistingSourceIds.add(Number(doc.source_file_id));
        }
    });

    saEnsureKbDrawer();

    const overlay = document.getElementById('saKbOverlay');
    const drawer = document.getElementById('saKbDrawer');
    overlay.classList.add('show');
    drawer.classList.add('open');

    document.getElementById('saKbSearchInput').value = '';
    document.getElementById('saKbSelectAllCb').checked = false;
    saUpdateKbSelectionCount();

    await saLoadKbTree();
}

function saCloseKbDrawer() {
    const overlay = document.getElementById('saKbOverlay');
    const drawer = document.getElementById('saKbDrawer');
    if (overlay) overlay.classList.remove('show');
    if (drawer) drawer.classList.remove('open');
    saKbSelectedFiles = new Set();
    saKbTreeData = null;
    if (saKbResizeMouseMoveHandler) {
        document.removeEventListener('mousemove', saKbResizeMouseMoveHandler);
        saKbResizeMouseMoveHandler = null;
    }
    if (saKbResizeMouseUpHandler) {
        document.removeEventListener('mouseup', saKbResizeMouseUpHandler);
        saKbResizeMouseUpHandler = null;
    }
    const handle = document.getElementById('saKbResizeHandle');
    if (handle) handle.dataset.resizeInit = '0';
}

async function saLoadKbTree() {
    const body = document.getElementById('saKbBody');
    if (!body) return;

    body.innerHTML = '<div class="sa-kb-loading"><div class="sa-kb-spinner"></div>\u52A0\u8F7D\u4E2D...</div>';

    try {
        const result = await apiRequest('/knowledge/global-tree', { useCache: false });
        if (result && result.success) {
            saKbTreeData = result.data;
            if (!saKbTreeData || saKbTreeData.length === 0) {
                body.innerHTML = '<div class="sa-kb-empty">\u77E5\u8BC6\u5E93\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u4E0A\u4F20\u6587\u4EF6</div>';
                return;
            }
            saRenderKbTree(saKbTreeData);
        } else {
            const errMsg = (result && result.message) ? saEscapeHtml(result.message) : '\u672A\u77E5\u9519\u8BEF';
            console.error('[KB Drawer] API\u8FD4\u56DE\u5931\u8D25:', result);
            body.innerHTML = `<div class="sa-kb-empty">\u52A0\u8F7D\u77E5\u8BC6\u5E93\u5931\u8D25: ${errMsg}</div>`;
        }
    } catch (e) {
        console.error('[KB Drawer] \u52A0\u8F7D\u5F02\u5E38:', e);
        body.innerHTML = `<div class="sa-kb-empty">\u52A0\u8F7D\u77E5\u8BC6\u5E93\u5931\u8D25: ${saEscapeHtml(e.message || '')}</div>`;
    }
}

function saRenderKbTree(tree) {
    const body = document.getElementById('saKbBody');
    if (!body) return;

    if (!tree || tree.length === 0) {
        body.innerHTML = '<div class="sa-kb-empty">\u77E5\u8BC6\u5E93\u4E3A\u7A7A\uFF0C\u8BF7\u5148\u4E0A\u4F20\u6587\u4EF6</div>';
        saUpdateKbSelectionCount();
        return;
    }

    body.innerHTML = tree.map(lib => saRenderKbLibrary(lib)).join('');

    body.querySelectorAll('.sa-kb-group-header').forEach(header => {
        header.addEventListener('click', function () {
            const groupId = this.dataset.groupId;
            const list = document.getElementById(groupId);
            if (list) {
                this.classList.toggle('collapsed');
                list.classList.toggle('collapsed');
            }
        });
    });

    body.querySelectorAll('.sa-kb-module-header').forEach(header => {
        header.addEventListener('click', function () {
            const moduleId = this.dataset.moduleId;
            const list = document.getElementById(moduleId);
            if (list) {
                this.classList.toggle('collapsed');
                list.classList.toggle('collapsed');
            }
        });
    });

    body.querySelectorAll('.sa-kb-file-checkbox').forEach(cb => {
        cb.addEventListener('click', function (e) {
            e.stopPropagation();
            const fileId = Number(this.dataset.fileId);
            if (saKbExistingSourceIds.has(fileId)) return;
            if (this.checked) {
                saKbSelectedFiles.add(fileId);
            } else {
                saKbSelectedFiles.delete(fileId);
            }
            saUpdateKbSelectionCount();
        });
    });

    saUpdateKbSelectionCount();
}

function saRenderKbLibrary(lib) {
    const fileCount = saCountFilesInTree(lib.children);
    const groupId = `sa-kb-lib-${lib.realId || lib.id}`;

    let childrenHtml = '';
    if (lib.children && lib.children.length > 0) {
        childrenHtml = lib.children.map(child => {
            if (child.type === 'module') {
                return saRenderKbModule(child);
            } else if (child.type === 'folder') {
                return saRenderKbFolder(child, 1);
            } else {
                return saRenderKbFile(child);
            }
        }).join('');
    }

    return `
    <div class="sa-kb-group">
        <div class="sa-kb-group-header" data-group-id="${groupId}">
            <span><span class="sa-kb-group-icon">\uD83D\uDCDA</span>${saEscapeHtml(lib.name)}<span class="sa-kb-group-count">${fileCount} \u4E2A\u6587\u4EF6</span></span>
            <span class="sa-kb-expand-icon">\u25BC</span>
        </div>
        <div class="sa-kb-group-list" id="${groupId}">${childrenHtml}</div>
    </div>`;
}

function saRenderKbModule(mod) {
    const fileCount = saCountFilesInTree(mod.children);
    const moduleId = `sa-kb-mod-${mod.realId || mod.id}`;

    let childrenHtml = '';
    if (mod.children && mod.children.length > 0) {
        childrenHtml = mod.children.map(child => {
            if (child.type === 'folder') {
                return saRenderKbFolder(child, 1);
            } else {
                return saRenderKbFile(child);
            }
        }).join('');
    }

    return `
    <div class="sa-kb-module-header" data-module-id="${moduleId}">
        <span class="sa-kb-expand-icon">\u25BC</span>
        <span>\uD83D\uDCE6 ${saEscapeHtml(mod.name)}</span>
        <span style="font-size:12px;color:#94a3b8;">(${fileCount})</span>
    </div>
    <div class="sa-kb-module-list" id="${moduleId}">${childrenHtml}</div>`;
}

function saRenderKbFolder(folder, depth) {
    if ((depth || 0) > 20) return '';
    const fileCount = saCountFilesInTree(folder.children, 0);
    const folderId = `sa-kb-folder-${folder.realId || folder.id}`;

    let childrenHtml = '';
    if (folder.children && folder.children.length > 0) {
        childrenHtml = folder.children.map(child => {
            if (child.type === 'folder') {
                return saRenderKbFolder(child, (depth || 0) + 1);
            } else {
                return saRenderKbFile(child);
            }
        }).join('');
    }

    return `
    <div class="sa-kb-module-header" data-module-id="${folderId}">
        <span class="sa-kb-expand-icon">\u25BC</span>
        <span>\uD83D\uDCC1 ${saEscapeHtml(folder.name)}</span>
        <span style="font-size:12px;color:#94a3b8;">(${fileCount})</span>
    </div>
    <div class="sa-kb-module-list" id="${folderId}">${childrenHtml}</div>`;
}

function saRenderKbFile(file) {
    const fileId = file.realId || file.id;
    const ext = file.file_ext || file.fileExt || '';
    const icon = saGetFileIcon(ext);
    const isExisting = saKbExistingSourceIds.has(Number(fileId));
    const isSelected = saKbSelectedFiles.has(Number(fileId));

    return `
    <div class="sa-kb-file-row ${isExisting ? 'disabled' : ''}" data-file-id="${fileId}" data-file-name="${saEscapeHtml(file.name || '')}">
        <input type="checkbox" class="sa-kb-file-checkbox" data-file-id="${fileId}" ${isSelected ? 'checked' : ''} ${isExisting ? 'disabled' : ''}>
        <span class="sa-kb-file-icon">${icon}</span>
        <span class="sa-kb-file-name">${saEscapeHtml(file.name || '\u672A\u547D\u540D')}</span>
        ${ext ? `<span class="sa-kb-file-ext">${saEscapeHtml(ext)}</span>` : ''}
        ${isExisting ? '<span class="sa-kb-file-added">\u5DF2\u6DFB\u52A0</span>' : ''}
    </div>`;
}

function saUpdateKbSelectionCount() {
    const count = saKbSelectedFiles.size;
    const countEl = document.getElementById('saKbSelectionCount');
    const footerCountEl = document.getElementById('saKbFooterCount');
    if (countEl) countEl.textContent = `\u5DF2\u9009 ${count} \u4E2A\u6587\u4EF6`;
    if (footerCountEl) footerCountEl.textContent = `\u5DF2\u9009 ${count} \u4E2A\u6587\u4EF6`;

    const selectAllCb = document.getElementById('saKbSelectAllCb');
    if (selectAllCb) {
        const allCheckboxes = document.querySelectorAll('#saKbBody .sa-kb-file-checkbox:not(:disabled)');
        const total = allCheckboxes.length;
        selectAllCb.checked = total > 0 && count >= total;
        selectAllCb.indeterminate = count > 0 && count < total;
    }
}

function saToggleKbSelectAll() {
    const cb = document.getElementById('saKbSelectAllCb');
    const allCheckboxes = document.querySelectorAll('#saKbBody .sa-kb-file-checkbox:not(:disabled)');

    if (cb.checked) {
        allCheckboxes.forEach(checkbox => {
            const fileId = Number(checkbox.dataset.fileId);
            saKbSelectedFiles.add(fileId);
            checkbox.checked = true;
        });
    } else {
        allCheckboxes.forEach(checkbox => {
            const fileId = Number(checkbox.dataset.fileId);
            saKbSelectedFiles.delete(fileId);
            checkbox.checked = false;
        });
    }
    saUpdateKbSelectionCount();
}

function saFilterKbTree() {
    const searchText = document.getElementById('saKbSearchInput').value.toLowerCase();
    const body = document.getElementById('saKbBody');
    if (!body) return;

    if (!searchText) {
        body.querySelectorAll('.sa-kb-file-row').forEach(row => row.style.display = '');
        body.querySelectorAll('.sa-kb-group').forEach(group => group.style.display = '');
        return;
    }

    body.querySelectorAll('.sa-kb-group').forEach(group => {
        group.style.display = 'none';
    });

    body.querySelectorAll('.sa-kb-file-row').forEach(row => {
        const name = (row.dataset.fileName || '').toLowerCase();
        if (name.includes(searchText)) {
            row.style.display = '';
            let parent = row.parentElement;
            while (parent && parent !== body) {
                if (parent.classList.contains('sa-kb-module-list') || parent.classList.contains('sa-kb-group-list')) {
                    parent.classList.remove('collapsed');
                }
                if (parent.classList.contains('sa-kb-group')) {
                    parent.style.display = '';
                    const header = parent.querySelector(':scope > .sa-kb-group-header');
                    if (header) header.classList.remove('collapsed');
                }
                parent = parent.parentElement;
            }
            const parentList = row.closest('.sa-kb-module-list');
            if (parentList) parentList.classList.remove('collapsed');
            const prevHeader = parentList ? parentList.previousElementSibling : null;
            if (prevHeader && prevHeader.classList.contains('sa-kb-module-header')) {
                prevHeader.classList.remove('collapsed');
            }
        } else {
            row.style.display = 'none';
        }
    });
}

async function saConfirmKbSelection() {
    if (saKbSelectedFiles.size === 0) {
        if (typeof showErrorMessage === 'function') showErrorMessage('\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u6587\u4EF6');
        return;
    }

    const fileIds = Array.from(saKbSelectedFiles);

    try {
        const confirmBtn = document.getElementById('saKbConfirmBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '\u6DFB\u52A0\u4E2D...';
        }

        const result = await apiRequest(`/ai-sub-agents/config-files/batch-kb/${saCurrentEditId}`, {
            method: 'POST',
            body: JSON.stringify({ file_ids: fileIds })
        });

        if (result.success) {
            const data = result.data || {};
            if (typeof showSuccessMessage === 'function') {
                showSuccessMessage(result.message || `\u5DF2\u6DFB\u52A0 ${data.totalAdded || 0} \u4E2A\u77E5\u8BC6\u5E93\u6587\u6863`);
            }
            saCloseKbDrawer();
            await loadConfigFiles(saCurrentEditId);
        } else {
            if (typeof showErrorMessage === 'function') showErrorMessage(result.message || '\u6DFB\u52A0\u5931\u8D25');
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') showErrorMessage('\u6DFB\u52A0\u77E5\u8BC6\u5E93\u6587\u6863\u5931\u8D25: ' + e.message);
    } finally {
        const confirmBtn = document.getElementById('saKbConfirmBtn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '\u786E\u8BA4\u9009\u62E9';
        }
    }
}

// ---- Simple input dialog helper ----

function saCreateInputDialog(title, fields) {
    let modal = document.getElementById('sa-input-dialog');
    if (modal) modal.remove();

    const dialogEl = document.createElement('div');
    dialogEl.id = 'sa-input-dialog';
    dialogEl.className = 'sa-confirm-modal';
    dialogEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

    const c = ThemeService.getColors();
    let fieldsHtml = fields.map(f => `
        <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:${c.textSecondary};">${saEscapeHtml(f.label)}</label>
        </div>
    `).join('');

    dialogEl.innerHTML = `
        <div style="background:${c.bgSurface};border-radius:12px;width:640px;max-width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.15);animation:sa-confirm-in 0.2s ease;">
            <div style="padding:20px 24px;border-bottom:1px solid ${c.border};display:flex;align-items:center;gap:12px;">
                <span style="font-size:24px;">\u270F\uFE0F</span>
                <h3 style="margin:0;font-size:16px;color:${c.textPrimary};">${saEscapeHtml(title)}</h3>
            </div>
            <div style="padding:24px;max-height:60vh;overflow-y:auto;" id="saInputDialogFields"></div>
            <div style="padding:16px 24px;border-top:1px solid ${c.border};display:flex;justify-content:flex-end;gap:12px;">
                <button class="sa-btn sa-btn-ghost" id="saInputDialogCancel">\u53D6\u6D88</button>
                <button class="sa-btn sa-btn-primary" id="saInputDialogOk">\u786E\u8BA4</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialogEl);

    const fieldsContainer = document.getElementById('saInputDialogFields');
    fields.forEach(f => {
        const label = document.createElement('label');
        const c = ThemeService.getColors();
        label.style.cssText = `display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:${c.textSecondary};`;
        label.textContent = f.label;
        fieldsContainer.appendChild(label);
        
        if (f.input.tagName === 'TEXTAREA') {
            f.input.style.cssText = `width:100%;padding:12px;border:1px solid ${c.border};border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:16px;font-family:'SF Mono','Fira Code',monospace;line-height:1.6;resize:vertical;min-height:200px;background:${c.inputBg};color:${c.textPrimary};`;
        } else {
            f.input.style.cssText = `width:100%;padding:8px 12px;border:1px solid ${c.border};border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:16px;background:${c.inputBg};color:${c.textPrimary};`;
        }
        fieldsContainer.appendChild(f.input);
    });

    const dialog = { onConfirm: null };

    document.getElementById('saInputDialogCancel').addEventListener('click', () => {
        dialogEl.remove();
    });
    document.getElementById('saInputDialogOk').addEventListener('click', async () => {
        if (dialog.onConfirm) {
            const result = await dialog.onConfirm();
            if (result === false) return;
        }
        dialogEl.remove();
    });

    // Focus first input
    if (fields.length > 0 && fields[0].input) {
        setTimeout(() => fields[0].input.focus(), 100);
    }

    return dialog;
}

// =====================================================================
// 9. saveConfigFile(agentId, fileType) - Save a config file
// =====================================================================

async function saveConfigFile(agentId, fileType) {
    if (!agentId || !fileType) return;

    let content = '';
    let fileName = '';

    if (fileType === 'soul_md' || fileType === 'soul') {
        content = document.getElementById('saInputSoulMd').value;
        fileName = 'Soul.md';
        fileType = 'soul';
    } else if (fileType === 'user_md' || fileType === 'user') {
        content = document.getElementById('saInputUserMd').value;
        fileName = 'User.md';
        fileType = 'user';
    } else if (fileType === 'tools_md' || fileType === 'tools') {
        content = JSON.stringify(saMountedToolIds);
        fileName = 'Tools.md';
        fileType = 'tools';
    } else if (fileType === 'rule_md' || fileType === 'rule') {
        content = document.getElementById('saInputRuleMd').value;
        fileName = 'Rule.md';
        fileType = 'rule';
    }

    try {
        const result = await apiRequest(`/ai-sub-agents/config-files/${agentId}/${fileType}`, {
            method: 'PUT',
            body: JSON.stringify({ content, file_name: fileName })
        });
        if (result.success) {
            if (typeof showSuccessMessage === 'function') {
                showSuccessMessage(`${fileName} \u4FDD\u5B58\u6210\u529F`);
            }
            // 刷新缓存
            await loadConfigFiles(agentId);
        } else {
            if (typeof showErrorMessage === 'function') {
                showErrorMessage(result.message || `${fileName} \u4FDD\u5B58\u5931\u8D25`);
            }
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') {
            showErrorMessage(`${fileName} \u4FDD\u5B58\u5931\u8D25: ` + e.message);
        }
    }
}

// =====================================================================
// 10. initDefaultConfigFiles(agentId) - Initialize default config files
// =====================================================================

async function initDefaultConfigFiles(agentId) {
    if (!agentId) return;

    const confirmed = await saShowConfirm('\u786E\u5B9A\u8981\u521D\u59CB\u5316\u9ED8\u8BA4\u914D\u7F6E\u6587\u4EF6\u5417\uFF1F\u5C06\u8865\u5145\u7F3A\u5931\u7684\u914D\u7F6E\u3002');
    if (!confirmed) return;

    try {
        const result = await apiRequest(`/ai-sub-agents/config-files/init-config-files/${agentId}`, {
            method: 'POST'
        });
        if (result.success) {
            if (typeof showSuccessMessage === 'function') {
                showSuccessMessage('\u9ED8\u8BA4\u914D\u7F6E\u5DF2\u521D\u59CB\u5316');
            }
            await loadConfigFiles(agentId);
        } else {
            if (typeof showErrorMessage === 'function') {
                showErrorMessage(result.message || '\u521D\u59CB\u5316\u9ED8\u8BA4\u914D\u7F6E\u5931\u8D25');
            }
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') {
            showErrorMessage('\u521D\u59CB\u5316\u9ED8\u8BA4\u914D\u7F6E\u5931\u8D25: ' + e.message);
        }
    }
}

// =====================================================================
// 11. loadToolsForTransfer(agentId) - Load tools for the transfer box
// =====================================================================

async function loadToolsForTransfer(agentId) {
    try {
        // 获取全部工具列表
        const toolsResult = await apiRequest('/ai-tools/list', { useCache: true });
        if (toolsResult.success) {
            saAvailableTools = toolsResult.data || toolsResult.tools || [];
        } else {
            saAvailableTools = [];
        }

        // 获取当前智能体已挂载的工具
        saMountedToolIds = [];
        if (agentId) {
            const toolsConfig = saConfigFilesCache['tools'];
            if (toolsConfig && toolsConfig.content) {
                try {
                    const parsed = JSON.parse(toolsConfig.content);
                    if (Array.isArray(parsed)) {
                        saMountedToolIds = parsed;
                    }
                } catch (e) {
                    // content 可能不是 JSON, 尝试按行解析
                    const lines = toolsConfig.content.split('\n').map(l => l.trim()).filter(l => l);
                    saMountedToolIds = lines;
                }
            }
        }

        renderTransferBox(saAvailableTools, saMountedToolIds);
    } catch (e) {
        console.error('[Sub-Agents] loadToolsForTransfer error:', e);
        const container = document.getElementById('saTransferBoxContainer');
        if (container) {
            container.innerHTML = '<div class="sa-empty"><div class="sa-empty-icon">\u26A0\uFE0F</div><div class="sa-empty-text">\u52A0\u8F7D\u5DE5\u5177\u5217\u8868\u5931\u8D25</div></div>';
        }
    }
}

// =====================================================================
// 12. renderTransferBox(availableTools, mountedTools) - Render transfer box
// =====================================================================

function renderTransferBox(availableTools, mountedTools) {
    const container = document.getElementById('saTransferBoxContainer');
    if (!container) return;

    const mountedSet = new Set(mountedTools.map(id => String(id)));
    const leftItems = [];
    const rightItems = [];

    availableTools.forEach(tool => {
        const toolId = String(tool.id || tool.tool_id || '');
        const toolName = tool.tool_name || tool.name || '';
        const item = {
            id: toolId,
            name: tool.display_name || tool.name || tool.tool_name || toolId,
            description: tool.description || ''
        };
        if (mountedSet.has(toolId) || mountedSet.has(toolName)) {
            rightItems.push(item);
        } else {
            leftItems.push(item);
        }
    });

    container.innerHTML = `
        <div class="sa-transfer-panel" id="saTransferLeft">
            <div class="sa-transfer-panel-header">
                <span>\u53EF\u7528\u5DE5\u5177</span>
                <span style="font-size:12px;color:#94a3b8;" id="saTransferLeftCount">${leftItems.length} \u4E2A</span>
            </div>
            <div class="sa-transfer-search">
                <input type="text" id="saTransferLeftSearch" placeholder="\u641C\u7D22\u5DE5\u5177...">
            </div>
            <div class="sa-transfer-panel-body" id="saTransferLeftBody">
                ${leftItems.map(item => `
                    <div class="sa-transfer-item" data-tool-id="${saEscapeHtml(item.id)}" data-tool-name="${saEscapeHtml(item.name).toLowerCase()}">
                        <input type="checkbox" class="sa-transfer-checkbox" data-side="left" data-tool-id="${saEscapeHtml(item.id)}">
                        <span>${saEscapeHtml(item.name)}</span>
                    </div>
                `).join('')}
                ${leftItems.length === 0 ? '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;">\u65E0\u53EF\u7528\u5DE5\u5177</div>' : ''}
            </div>
        </div>
        <div class="sa-transfer-actions">
            <button class="sa-transfer-action-btn" id="saBtnToolsSelectSelected" title="\u9009\u4E2D\u7684\u79FB\u5230\u53F3\u4FA7">&gt;</button>
            <button class="sa-transfer-action-btn" id="saBtnToolsSelectAll" title="\u5168\u90E8\u79FB\u5230\u53F3\u4FA7">&gt;&gt;</button>
            <button class="sa-transfer-action-btn" id="saBtnToolsDeselectSelected" title="\u9009\u4E2D\u7684\u79FB\u5230\u5DE6\u4FA7">&lt;</button>
            <button class="sa-transfer-action-btn" id="saBtnToolsDeselectAll" title="\u5168\u90E8\u79FB\u5230\u5DE6\u4FA7">&lt;&lt;</button>
        </div>
        <div class="sa-transfer-panel" id="saTransferRight">
            <div class="sa-transfer-panel-header">
                <span>\u5DF2\u6302\u8F7D\u5DE5\u5177</span>
                <span style="font-size:12px;color:#94a3b8;" id="saTransferRightCount">${rightItems.length} \u4E2A</span>
            </div>
            <div class="sa-transfer-search">
                <input type="text" id="saTransferRightSearch" placeholder="\u641C\u7D22\u5DF2\u6302\u8F7D\u5DE5\u5177...">
            </div>
            <div class="sa-transfer-panel-body" id="saTransferRightBody">
                ${rightItems.map(item => `
                    <div class="sa-transfer-item selected" data-tool-id="${saEscapeHtml(item.id)}" data-tool-name="${saEscapeHtml(item.name).toLowerCase()}">
                        <input type="checkbox" class="sa-transfer-checkbox" data-side="right" data-tool-id="${saEscapeHtml(item.id)}" checked>
                        <span>${saEscapeHtml(item.name)}</span>
                    </div>
                `).join('')}
                ${rightItems.length === 0 ? '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;">\u5C1A\u672A\u6302\u8F7D\u5DE5\u5177</div>' : ''}
            </div>
        </div>
    `;

    // 绑定穿梭框搜索
    const leftSearch = document.getElementById('saTransferLeftSearch');
    if (leftSearch) {
        leftSearch.addEventListener('input', function () {
            const keyword = this.value.toLowerCase();
            document.querySelectorAll('#saTransferLeftBody .sa-transfer-item').forEach(item => {
                const name = item.dataset.toolName || '';
                item.style.display = name.includes(keyword) ? '' : 'none';
            });
        });
    }
    const rightSearch = document.getElementById('saTransferRightSearch');
    if (rightSearch) {
        rightSearch.addEventListener('input', function () {
            const keyword = this.value.toLowerCase();
            document.querySelectorAll('#saTransferRightBody .sa-transfer-item').forEach(item => {
                const name = item.dataset.toolName || '';
                item.style.display = name.includes(keyword) ? '' : 'none';
            });
        });
    }

    // 绑定穿梭框行点击选中
    container.querySelectorAll('.sa-transfer-item').forEach(item => {
        item.addEventListener('click', function (e) {
            if (e.target.tagName === 'INPUT') return;
            const checkbox = this.querySelector('.sa-transfer-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                this.classList.toggle('selected', checkbox.checked);
            }
        });
    });

    // 重新绑定穿梭按钮 (因为 innerHTML 重建了 DOM)
    const btnSelectAll = document.getElementById('saBtnToolsSelectAll');
    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', () => saTransferAllTools('right'));
    }
    const btnDeselectAll = document.getElementById('saBtnToolsDeselectAll');
    if (btnDeselectAll) {
        btnDeselectAll.addEventListener('click', () => saTransferAllTools('left'));
    }
    const btnSelectSelected = document.getElementById('saBtnToolsSelectSelected');
    if (btnSelectSelected) {
        btnSelectSelected.addEventListener('click', () => saTransferSelectedTools('right'));
    }
    const btnDeselectSelected = document.getElementById('saBtnToolsDeselectSelected');
    if (btnDeselectSelected) {
        btnDeselectSelected.addEventListener('click', () => saTransferSelectedTools('left'));
    }
}

// ---- Transfer box operations ----

function saTransferSelectedTools(direction) {
    const side = direction === 'right' ? 'left' : 'right';
    const targetSide = direction === 'right' ? 'right' : 'left';

    const sourceBody = document.getElementById(side === 'left' ? 'saTransferLeftBody' : 'saTransferRightBody');
    const targetBody = document.getElementById(targetSide === 'right' ? 'saTransferRightBody' : 'saTransferLeftBody');
    if (!sourceBody || !targetBody) return;

    const checkedItems = sourceBody.querySelectorAll('.sa-transfer-checkbox:checked');
    if (checkedItems.length === 0) {
        if (typeof showErrorMessage === 'function') showErrorMessage('\u8BF7\u5148\u9009\u62E9\u5DE5\u5177');
        return;
    }

    checkedItems.forEach(cb => {
        const item = cb.closest('.sa-transfer-item');
        if (!item) return;

        const toolId = item.dataset.toolId;
        const toolName = item.querySelector('span').textContent;

        // 从源列表移除
        item.remove();

        // 添加到目标列表
        const newItem = document.createElement('div');
        newItem.className = 'sa-transfer-item';
        newItem.dataset.toolId = toolId;
        newItem.dataset.toolName = toolName.toLowerCase();
        newItem.innerHTML = `
            <input type="checkbox" class="sa-transfer-checkbox" data-side="${targetSide}" data-tool-id="${saEscapeHtml(toolId)}">
            <span>${saEscapeHtml(toolName)}</span>
        `;
        newItem.addEventListener('click', function (e) {
            if (e.target.tagName === 'INPUT') return;
            const checkbox = this.querySelector('.sa-transfer-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                this.classList.toggle('selected', checkbox.checked);
            }
        });
        targetBody.appendChild(newItem);

        // 更新 mountedToolIds
        if (direction === 'right') {
            saMountedToolIds.push(toolId);
        } else {
            saMountedToolIds = saMountedToolIds.filter(id => String(id) !== String(toolId));
        }
    });

    saUpdateTransferCounts();
}

function saTransferAllTools(direction) {
    const side = direction === 'right' ? 'left' : 'right';
    const sourceBody = document.getElementById(side === 'left' ? 'saTransferLeftBody' : 'saTransferRightBody');
    const targetBody = document.getElementById(direction === 'right' ? 'saTransferRightBody' : 'saTransferLeftBody');
    if (!sourceBody || !targetBody) return;

    const allItems = sourceBody.querySelectorAll('.sa-transfer-item');
    allItems.forEach(item => {
        const toolId = item.dataset.toolId;
        const toolName = item.querySelector('span').textContent;

        item.remove();

        const targetSide = direction === 'right' ? 'right' : 'left';
        const newItem = document.createElement('div');
        newItem.className = 'sa-transfer-item';
        newItem.dataset.toolId = toolId;
        newItem.dataset.toolName = toolName.toLowerCase();
        newItem.innerHTML = `
            <input type="checkbox" class="sa-transfer-checkbox" data-side="${targetSide}" data-tool-id="${saEscapeHtml(toolId)}">
            <span>${saEscapeHtml(toolName)}</span>
        `;
        newItem.addEventListener('click', function (e) {
            if (e.target.tagName === 'INPUT') return;
            const checkbox = this.querySelector('.sa-transfer-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                this.classList.toggle('selected', checkbox.checked);
            }
        });
        targetBody.appendChild(newItem);

        if (direction === 'right') {
            if (!saMountedToolIds.includes(toolId)) {
                saMountedToolIds.push(toolId);
            }
        } else {
            saMountedToolIds = saMountedToolIds.filter(id => String(id) !== String(toolId));
        }
    });

    saUpdateTransferCounts();
}

function saUpdateTransferCounts() {
    const leftCount = document.querySelectorAll('#saTransferLeftBody .sa-transfer-item').length;
    const rightCount = document.querySelectorAll('#saTransferRightBody .sa-transfer-item').length;
    const leftCountEl = document.getElementById('saTransferLeftCount');
    const rightCountEl = document.getElementById('saTransferRightCount');
    if (leftCountEl) leftCountEl.textContent = `${leftCount} \u4E2A`;
    if (rightCountEl) rightCountEl.textContent = `${rightCount} \u4E2A`;
}

// ---- Copy agent ----

async function saCopyAgent(id, agentCode) {
    const confirmed = await saShowConfirm(`\u786E\u5B9A\u8981\u590D\u5236\u667A\u80FD\u4F53 "${agentCode}" \u5417\uFF1F\u5C06\u521B\u5EFA\u4E00\u4E2A\u526F\u672C\u3002`);
    if (!confirmed) return;

    try {
        // 先获取详情
        const detailResult = await apiRequest(`/ai-sub-agents/detail/${encodeURIComponent(agentCode)}`);
        if (!detailResult.success) {
            if (typeof showErrorMessage === 'function') showErrorMessage(detailResult.message || '\u83B7\u53D6\u667A\u80FD\u4F53\u8BE6\u60C5\u5931\u8D25');
            return;
        }
        const agent = detailResult.data.agent;

        // 创建副本
        const copyData = {
            agent_code: (agent.agentCode || agent.agent_code) + '_copy',
            display_name: (agent.displayName || agent.display_name) + ' (\u526F\u672C)',
            category: agent.category,
            description: agent.description,
            model: agent.model,
            memory_enabled: agent.memoryEnabled || agent.memory_enabled,
            is_enabled: false,
            sort_order: agent.sortOrder || agent.sort_order
        };

        const result = await apiRequest('/ai-sub-agents/create', {
            method: 'POST',
            body: JSON.stringify(copyData)
        });
        if (result.success) {
            if (typeof showSuccessMessage === 'function') showSuccessMessage('\u667A\u80FD\u4F53\u5DF2\u590D\u5236');
            await loadSubAgentsList();
        } else {
            if (typeof showErrorMessage === 'function') showErrorMessage(result.message || '\u590D\u5236\u5931\u8D25');
        }
    } catch (e) {
        if (typeof showErrorMessage === 'function') showErrorMessage('\u590D\u5236\u5931\u8D25: ' + e.message);
    }
}

// =====================================================================
// Workflow Viewer (工作流查看器)
// =====================================================================

let wfData = null;
let wfCurrentView = 'overview';
let wfRequestCounter = 0;

async function openWorkflowViewer(agentCode) {
    if (!agentCode) return;

    const existing = document.getElementById('wfViewerModal');
    if (existing) existing.remove();
    const existingOverlay = document.getElementById('wfOverlay');
    if (existingOverlay) existingOverlay.remove();

    wfRequestCounter++;
    const currentRequest = wfRequestCounter;

    const overlay = document.createElement('div');
    overlay.id = 'wfOverlay';
    overlay.className = 'wf-overlay';
    document.body.appendChild(overlay);

    const modal = document.createElement('div');
    modal.id = 'wfViewerModal';
    modal.className = 'wf-modal';
    modal.innerHTML = `
        <div class="wf-modal-header">
            <h3 id="wfModalTitle">\u{1F50D} \u5DE5\u4F5C\u6D41\u67E5\u770B \u2014 \u52A0\u8F7D\u4E2D...</h3>
            <button class="wf-modal-close" id="wfBtnClose">&times;</button>
        </div>
        <div class="wf-modal-body">
            <div class="wf-sidebar" id="wfSidebar">
                <div class="wf-nav-item active" data-view="overview">\u{1F4CA} \u603B\u89C8</div>
                <div class="wf-nav-item" data-view="prompt">\u{1F4CB} \u63D0\u793A\u8BCD</div>
                <div class="wf-nav-item" data-view="tools">\u{1F527} \u5DE5\u5177</div>
                <div class="wf-nav-item" data-view="pipeline">\u{1F504} \u8BC4\u5BA1</div>
                <div class="wf-nav-item" data-view="memory">\u{1F9E0} \u8BB0\u5FC6</div>
                <div class="wf-nav-item" data-view="sequence">\u23F1 \u65F6\u5E8F</div>
            </div>
            <div class="wf-content" id="wfContent">
                <div class="wf-loading">
                    <div class="wf-spinner"></div>
                    <p>\u6B63\u5728\u52A0\u8F7D\u5DE5\u4F5C\u6D41\u6570\u636E...</p>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('wfBtnClose').addEventListener('click', closeWorkflowViewer);
    document.getElementById('wfOverlay').addEventListener('click', closeWorkflowViewer);

    document.querySelectorAll('#wfSidebar .wf-nav-item').forEach(item => {
        item.addEventListener('click', function () {
            const view = this.dataset.view;
            wfSwitchView(view);
        });
    });

    try {
        const result = await apiRequest(`/ai-sub-agents/workflow/${encodeURIComponent(agentCode)}`);
        if (currentRequest !== wfRequestCounter) return;
        if (result.success) {
            wfData = result.data;
            document.getElementById('wfModalTitle').textContent =
                `\u{1F50D} \u5DE5\u4F5C\u6D41\u67E5\u770B \u2014 ${saEscapeHtml(wfData.agent.displayName)} (${saEscapeHtml(wfData.agent.agentCode)})`;
            wfSwitchView('overview');
        } else {
            document.getElementById('wfContent').innerHTML =
                `<div class="wf-error">\u52A0\u8F7D\u5931\u8D25: ${saEscapeHtml(result.message || '\u672A\u77E5\u9519\u8BEF')}</div>`;
        }
    } catch (e) {
        document.getElementById('wfContent').innerHTML =
            `<div class="wf-error">\u7F51\u7EDC\u9519\u8BEF: ${saEscapeHtml(e.message)}</div>`;
    }
}

function closeWorkflowViewer() {
    const modal = document.getElementById('wfViewerModal');
    const overlay = document.getElementById('wfOverlay');
    if (modal) modal.remove();
    if (overlay) overlay.remove();
    wfData = null;
    wfCurrentView = 'overview';
}

function wfSwitchView(view) {
    wfCurrentView = view;
    document.querySelectorAll('#wfSidebar .wf-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });
    const content = document.getElementById('wfContent');
    if (!content || !wfData) return;

    switch (view) {
        case 'overview': content.innerHTML = renderWfOverview(wfData); break;
        case 'prompt': content.innerHTML = renderWfPrompt(wfData); break;
        case 'tools': content.innerHTML = renderWfTools(wfData); break;
        case 'pipeline': content.innerHTML = renderWfPipeline(wfData); break;
        case 'memory': content.innerHTML = renderWfMemory(wfData); break;
        case 'sequence': content.innerHTML = renderWfSequence(wfData); break;
        default: content.innerHTML = '<div class="wf-error">\u672A\u77E5\u89C6\u56FE</div>';
    }
    wfBindEvents(view);
}

function wfBindEvents(view) {
    if (view === 'prompt') {
        document.querySelectorAll('.wf-copy-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const targetId = this.dataset.copyTarget;
                const el = document.getElementById(targetId);
                if (el) {
                    const text = el.innerText || el.textContent;
                    navigator.clipboard.writeText(text).then(() => {
                        if (typeof showSuccessMessage === 'function') showSuccessMessage('\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F');
                    }).catch(() => {
                        if (typeof showErrorMessage === 'function') showErrorMessage('\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236');
                    });
                }
            });
        });
        document.querySelectorAll('.wf-toggle-expand').forEach(btn => {
            btn.addEventListener('click', function () {
                const targetId = this.dataset.target;
                const el = document.getElementById(targetId);
                if (el) el.classList.toggle('wf-collapsed');
                this.textContent = el.classList.contains('wf-collapsed') ? '\u5C55\u5F00' : '\u6536\u8D77';
            });
        });
    }
    if (view === 'tools') {
        document.querySelectorAll('.wf-tool-card').forEach(card => {
            card.addEventListener('click', function () {
                const detail = this.nextElementSibling;
                if (detail && detail.classList.contains('wf-tool-detail')) {
                    detail.classList.toggle('wf-hidden');
                }
            });
        });
    }
    if (view === 'pipeline') {
        document.querySelectorAll('.wf-rule-toggle').forEach(btn => {
            btn.addEventListener('click', function () {
                const targetId = this.dataset.target;
                const el = document.getElementById(targetId);
                if (el) el.classList.toggle('wf-collapsed');
                this.textContent = el.classList.contains('wf-collapsed') ? '\u5C55\u5F00\u89C4\u5219\u5185\u5BB9' : '\u6536\u8D77\u89C4\u5219\u5185\u5BB9';
            });
        });
    }
    if (view === 'memory') {
        document.querySelectorAll('.wf-toggle-expand').forEach(btn => {
            btn.addEventListener('click', function () {
                const targetId = this.dataset.target;
                const el = document.getElementById(targetId);
                if (el) el.classList.toggle('wf-collapsed');
                this.textContent = el.classList.contains('wf-collapsed') ? '\u5C55\u5F00' : '\u6536\u8D77';
            });
        });
    }
}

function renderWfOverview(d) {
    const a = d.agent;
    const catColors = { '\u7528\u4F8B\u8BC4\u5BA1': '#3b82f6', '\u7528\u4F8B\u751F\u6210': '#10b981', '\u95EE\u7B54\u52A9\u624B': '#f59e0b', '\u4EE3\u7801\u5BA1\u67E5': '#8b5cf6', '\u6587\u6863\u751F\u6210': '#06b6d4', '\u6570\u636E\u5206\u6790': '#ec4899' };
    const catColor = catColors[a.category] || '#6b7280';
    const overrideLabel = d.resolvedFrom === 'private_override' ?
        `<div class="wf-badge wf-badge-warn">\u{1F3F7}\uFE0F \u79C1\u6709\u8986\u76D6\u7248\u672C${d.systemVersion ? ' (\u7CFB\u7EDF: ' + saEscapeHtml(d.systemVersion.displayName) + ')' : ''}</div>` : '';
    const cfgFiles = d.configFiles || [];
    const soulExists = cfgFiles.some(f => f.fileType === 'soul');
    const userExists = cfgFiles.some(f => f.fileType === 'user');
    const toolsExists = cfgFiles.some(f => f.fileType === 'tools');
    const ruleExists = cfgFiles.some(f => f.fileType === 'rule');
    const refDocCount = cfgFiles.filter(f => f.fileType === 'ref_doc' || f.fileType === 'kb_doc' || f.fileType === 'checklist' || f.fileType === 'examples' || f.fileType === 'glossary' || f.fileType === 'template' || f.fileType === 'custom').length;
    const ruleCount = d.reflectionPipeline.rules.length;
    const toolCount = d.tools.parsed.length;
    const memStats = d.memory.stats;
    const memTotal = (memStats.global.count || 0) + (memStats.library.count || 0) + (memStats.module.count || 0);

    return `
    <div class="wf-overview">
        ${overrideLabel}
        <div class="wf-card-grid">
            <div class="wf-card">
                <div class="wf-card-title">\u{1F4CB} \u57FA\u672C\u4FE1\u606F</div>
                <div class="wf-card-body">
                    <div class="wf-kv"><span class="wf-k">Code</span><span class="wf-v" style="font-family:monospace">${saEscapeHtml(a.agentCode)}</span></div>
                    <div class="wf-kv"><span class="wf-k">\u540D\u79F0</span><span class="wf-v">${saEscapeHtml(a.displayName)}</span></div>
                    <div class="wf-kv"><span class="wf-k">\u5206\u7C7B</span><span class="wf-v"><span class="wf-badge" style="background:${catColor}">${saEscapeHtml(a.category || '-')}</span></span></div>
                    <div class="wf-kv"><span class="wf-k">\u72B6\u6001</span><span class="wf-v">${a.isEnabled ? '\u2705 \u542F\u7528' : '\u274C \u7981\u7528'}</span></div>
                    <div class="wf-kv"><span class="wf-k">\u8BB0\u5FC6</span><span class="wf-v">${a.memoryEnabled ? '\u2705 \u5F00\u542F' : '\u274C \u5173\u95ED'}</span></div>
                    <div class="wf-kv"><span class="wf-k">\u7CFB\u7EDF\u5185\u7F6E</span><span class="wf-v">${a.isSystem ? '\u2705' : '\u274C'}</span></div>
                </div>
            </div>
            <div class="wf-card">
                <div class="wf-card-title">\u{1F916} \u6A21\u578B\u914D\u7F6E</div>
                <div class="wf-card-body">
                    <div class="wf-kv"><span class="wf-k">\u6A21\u578B</span><span class="wf-v">${saEscapeHtml(d.aiConfig ? d.aiConfig.model : '\u672A\u914D\u7F6E')}</span></div>
                    <div class="wf-kv"><span class="wf-k">\u6E29\u5EA6</span><span class="wf-v">${d.aiConfig ? d.aiConfig.temperature : '-'}</span></div>
                    <div class="wf-kv"><span class="wf-k">Max Tokens</span><span class="wf-v">${d.aiConfig ? d.aiConfig.maxTokens : '-'}</span></div>
                    <div class="wf-kv"><span class="wf-k">\u573A\u666F</span><span class="wf-v">${d.aiConfig ? saEscapeHtml(d.aiConfig.scene) : '-'}</span></div>
                    <div class="wf-kv"><span class="wf-k">Endpoint</span><span class="wf-v" style="font-size:11px">${d.aiConfig ? saEscapeHtml(d.aiConfig.endpoint) : '-'}</span></div>
                </div>
            </div>
            <div class="wf-card">
                <div class="wf-card-title">\u{1F527} \u5DE5\u5177\u6302\u8F7D</div>
                <div class="wf-card-body">
                    <div class="wf-kv"><span class="wf-k">\u5DF2\u6302\u8F7D</span><span class="wf-v">${toolCount} \u4E2A</span></div>
                    ${d.tools.details.slice(0, 5).map(t => `<div class="wf-kv"><span class="wf-k">\u{1F529}</span><span class="wf-v">${saEscapeHtml(t.toolName)}</span></div>`).join('')}
                    ${toolCount > 5 ? `<div class="wf-kv"><span class="wf-k">\u2026</span><span class="wf-v">\u53E6 ${toolCount - 5} \u4E2A</span></div>` : ''}
                    ${toolCount === 0 ? '<div class="wf-empty-hint">\u672A\u6302\u8F7D\u5DE5\u5177</div>' : ''}
                </div>
            </div>
            <div class="wf-card">
                <div class="wf-card-title">\u{1F4DD} \u914D\u7F6E\u6587\u4EF6</div>
                <div class="wf-card-body">
                    <div class="wf-kv"><span class="wf-k">Soul.md</span><span class="wf-v">${soulExists ? '\u2705' : '\u274C'}</span></div>
                    <div class="wf-kv"><span class="wf-k">User.md</span><span class="wf-v">${userExists ? '\u2705' : '\u274C'}</span></div>
                    <div class="wf-kv"><span class="wf-k">Tools.md</span><span class="wf-v">${toolsExists ? '\u2705' : '\u274C'}</span></div>
                    <div class="wf-kv"><span class="wf-k">Rule.md</span><span class="wf-v">${ruleExists ? '\u2705' : '\u274C'}</span></div>
                    <div class="wf-kv"><span class="wf-k">\u53C2\u8003\u6587\u6863</span><span class="wf-v">${refDocCount} \u4E2A</span></div>
                </div>
            </div>
            <div class="wf-card">
                <div class="wf-card-title">\u{1F504} \u8BC4\u5BA1\u89C4\u5219</div>
                <div class="wf-card-body">
                    <div class="wf-kv"><span class="wf-k">\u89C4\u5219\u6570</span><span class="wf-v">${ruleCount} \u6761</span></div>
                    <div class="wf-kv"><span class="wf-k">\u6700\u5927\u91CD\u8BD5</span><span class="wf-v">3 \u6B21</span></div>
                    <div class="wf-kv"><span class="wf-k">\u8F93\u51FA\u683C\u5F0F</span><span class="wf-v">JSON</span></div>
                    ${ruleCount === 0 ? '<div class="wf-empty-hint">\u672A\u914D\u7F6E\u8BC4\u5BA1\u89C4\u5219</div>' : ''}
                </div>
            </div>
            <div class="wf-card">
                <div class="wf-card-title">\u{1F9E0} \u8BB0\u5FC6\u7EDF\u8BA1</div>
                <div class="wf-card-body">
                    <div class="wf-kv"><span class="wf-k">\u5168\u5C40</span><span class="wf-v">${memStats.global.count} \u6761 / ${memStats.global.totalChars} \u5B57</span></div>
                    <div class="wf-kv"><span class="wf-k">\u5E93\u7EA7</span><span class="wf-v">${memStats.library.count} \u6761 / ${memStats.library.totalChars} \u5B57</span></div>
                    <div class="wf-kv"><span class="wf-k">\u6A21\u5757</span><span class="wf-v">${memStats.module.count} \u6761 / ${memStats.module.totalChars} \u5B57</span></div>
                    <div class="wf-kv"><span class="wf-k">\u603B\u8BA1</span><span class="wf-v">${memTotal} \u6761</span></div>
                    <div class="wf-kv"><span class="wf-k">\u84B8\u998F\u9608\u503C</span><span class="wf-v">${d.memory.distillThreshold} \u5B57</span></div>
                </div>
            </div>
        </div>
        <div class="wf-flow-diagram">
            <div class="wf-flow-title">\u5DE5\u4F5C\u6D41\u9AA8\u67B6</div>
            <div class="wf-flow-steps">
                <div class="wf-flow-step">
                    <div class="wf-flow-icon">\u{1F4C5}</div>
                    <div class="wf-flow-label">\u914D\u7F6E\u52A0\u8F7D</div>
                    <div class="wf-flow-desc">Soul+User+Tools</div>
                </div>
                <div class="wf-flow-arrow">\u2192</div>
                <div class="wf-flow-step">
                    <div class="wf-flow-icon">\u{1F4DD}</div>
                    <div class="wf-flow-label">\u63D0\u793A\u8BCD\u7EC4\u88C5</div>
                    <div class="wf-flow-desc">+\u8BB0\u5FC6+\u53C2\u8003</div>
                </div>
                <div class="wf-flow-arrow">\u2192</div>
                <div class="wf-flow-step">
                    <div class="wf-flow-icon">\u{1F916}</div>
                    <div class="wf-flow-label">LLM\u8C03\u7528</div>
                    <div class="wf-flow-desc">${saEscapeHtml(d.aiConfig ? d.aiConfig.model : 'N/A')}</div>
                </div>
                <div class="wf-flow-arrow">\u2192</div>
                <div class="wf-flow-step${toolCount > 0 ? '' : ' wf-flow-step-dim'}">
                    <div class="wf-flow-icon">\u{1F527}</div>
                    <div class="wf-flow-label">\u5DE5\u5177\u5FAA\u73AF</div>
                    <div class="wf-flow-desc">${toolCount > 0 ? '\u6700\u591A5\u8F6E' : '\u65E0\u5DE5\u5177'}</div>
                </div>
                <div class="wf-flow-arrow">\u2192</div>
                <div class="wf-flow-step">
                    <div class="wf-flow-icon">\u{1F4E6}</div>
                    <div class="wf-flow-label">\u7ED3\u679C\u8F93\u51FA</div>
                    <div class="wf-flow-desc">\u6700\u7EC8\u54CD\u5E94</div>
                </div>
            </div>
        </div>
    </div>`;
}

function renderWfPrompt(d) {
    const sp = d.promptAssembly.systemPrompt;
    const up = d.promptAssembly.userPrompt;
    return `
    <div class="wf-prompt">
        <div class="wf-section">
            <div class="wf-section-header">
                <h4>System Prompt</h4>
                <button class="wf-copy-btn" data-copy-target="wfSysPromptFull">\u{1F4CB} \u590D\u5236\u5B8C\u6574 System Prompt</button>
            </div>
            <div class="wf-prompt-block">
                <div class="wf-source-block wf-source-soul">
                    <div class="wf-source-label">\u{1F4C4} \u6765\u6E90: Soul.md (${sp.soul.charCount} \u5B57\u7B26)</div>
                    <pre class="wf-pre wf-collapsed" id="wfSysSoul">${saEscapeHtml(sp.soul.content)}</pre>
                    <button class="wf-toggle-expand" data-target="wfSysSoul">\u5C55\u5F00</button>
                </div>
                ${sp.memory.content ? `
                <div class="wf-source-block wf-source-memory">
                    <div class="wf-source-label">\u{1F9E0} \u6765\u6E90: \u8BB0\u5FC6\u4E0A\u4E0B\u6587 (Memory_Context, ${sp.memory.charCount} \u5B57\u7B26) ${sp.memory.truncated ? '<span class="wf-badge wf-badge-warn">\u5DF2\u622A\u65AD</span>' : ''}</div>
                    <pre class="wf-pre wf-collapsed" id="wfSysMemory">${saEscapeHtml(sp.memory.content)}</pre>
                    <button class="wf-toggle-expand" data-target="wfSysMemory">\u5C55\u5F00</button>
                </div>` : ''}
            </div>
            <div class="wf-assembled-note">
                <strong>\u7EC4\u88C5\u516C\u5F0F:</strong> System Prompt = Soul.md ${sp.memory.content ? '+ \u8BB0\u5FC6\u4E0A\u4E0B\u6587' : '(\u65E0\u8BB0\u5FC6)'}
            </div>
            <div class="wf-full-prompt" id="wfSysPromptFull" style="display:none">${saEscapeHtml(sp.soul.content)}${sp.memory.content ? '\n\n' + saEscapeHtml(sp.memory.content) : ''}</div>
        </div>

        <div class="wf-section">
            <div class="wf-section-header">
                <h4>User Prompt</h4>
                <button class="wf-copy-btn" data-copy-target="wfUserPromptFull">\u{1F4CB} \u590D\u5236\u5B8C\u6574 User Prompt</button>
            </div>
            <div class="wf-prompt-block">
                <div class="wf-source-block wf-source-user">
                    <div class="wf-source-label">\u{1F4C4} \u6765\u6E90: User.md (\u6A21\u677F, ${up.template.charCount} \u5B57\u7B26)</div>
                    <pre class="wf-pre wf-collapsed" id="wfUserTemplate">${saEscapeHtml(up.template.content || '(\u7A7A)')}</pre>
                    <button class="wf-toggle-expand" data-target="wfUserTemplate">\u5C55\u5F00</button>
                </div>
                ${Object.keys(up.variables).length > 0 ? `
                <div class="wf-source-block wf-source-vars">
                    <div class="wf-source-label">\u{1F527} \u53D8\u91CF\u63D2\u503C (\u793A\u4F8B\u503C)</div>
                    <div class="wf-vars-grid">
                        ${Object.entries(up.variables).map(([k, v]) => `<div class="wf-var-item"><span class="wf-var-name">{{${saEscapeHtml(k)}}}</span><span class="wf-var-val">${saEscapeHtml(String(v))}</span></div>`).join('')}
                    </div>
                </div>` : ''}
                <div class="wf-source-block wf-source-rendered">
                    <div class="wf-source-label">\u{1F4DD} \u6E32\u67D3\u540E\u7684 User Prompt (${up.renderedCharCount} \u5B57\u7B26)</div>
                    <pre class="wf-pre wf-collapsed" id="wfUserRendered">${saEscapeHtml(up.rendered || '(\u7A7A)')}</pre>
                    <button class="wf-toggle-expand" data-target="wfUserRendered">\u5C55\u5F00</button>
                </div>
                ${up.refDocs.length > 0 ? up.refDocs.map((doc, i) => `
                <div class="wf-source-block wf-source-refdoc">
                    <div class="wf-source-label">\u{1F4CE} \u6765\u6E90: \u53C2\u8003\u6587\u6863 [${saEscapeHtml(doc.type)}] ${saEscapeHtml(doc.name)} (${doc.charCount} \u5B57\u7B26)</div>
                    <pre class="wf-pre wf-collapsed" id="wfRefDoc${i}">${saEscapeHtml(doc.content)}</pre>
                    <button class="wf-toggle-expand" data-target="wfRefDoc${i}">\u5C55\u5F00</button>
                </div>`).join('') : ''}
            </div>
            <div class="wf-assembled-note">
                <strong>\u7EC4\u88C5\u516C\u5F0F:</strong> User Prompt = User.md(\u53D8\u91CF\u63D2\u503C) ${up.refDocs.length > 0 ? '+ \u53C2\u8003\u6587\u6863(\u6309sort_order\u8FFD\u52A0)' : '(\u65E0\u53C2\u8003\u6587\u6863)'}
            </div>
            <div class="wf-full-prompt" id="wfUserPromptFull" style="display:none">${saEscapeHtml(up.fullContent)}</div>
        </div>
    </div>`;
}

function renderWfTools(d) {
    const t = d.tools;
    return `
    <div class="wf-tools">
        <div class="wf-section">
            <div class="wf-section-header"><h4>\u{1F4C4} \u5DE5\u5177\u914D\u7F6E\u89E3\u6790</h4></div>
            <div class="wf-tools-raw">
                <div class="wf-source-label">Tools.md \u539F\u59CB\u5185\u5BB9:</div>
                <pre class="wf-pre">${saEscapeHtml(t.rawConfig || '(\u7A7A)')}</pre>
            </div>
            ${t.parsed.length > 0 ? `
            <div class="wf-tools-parsed">
                <div class="wf-source-label">\u89E3\u6790\u7ED3\u679C: ${t.parsed.length} \u4E2A\u5DE5\u5177</div>
                <div class="wf-tools-list">
                    ${t.parsed.map(name => `<span class="wf-badge wf-badge-tool">${saEscapeHtml(name)}</span>`).join(' ')}
                </div>
            </div>` : '<div class="wf-empty-hint">\u672A\u6302\u8F7D\u4EFB\u4F55\u5DE5\u5177</div>'}
        </div>

        ${t.details.length > 0 ? `
        <div class="wf-section">
            <div class="wf-section-header"><h4>\u{1F527} \u5DF2\u6302\u8F7D\u5DE5\u5177\u8BE6\u60C5 (${t.details.length}\u4E2A)</h4></div>
            ${t.details.map(tool => `
            <div class="wf-tool-group">
                <div class="wf-tool-card">
                    <div class="wf-tool-name">${saEscapeHtml(tool.toolName)}</div>
                    <div class="wf-tool-meta">
                        <span class="wf-badge wf-badge-lang">${saEscapeHtml(tool.language)}</span>
                        <span class="wf-tool-desc">${saEscapeHtml(tool.description || tool.displayName)}</span>
                    </div>
                    ${tool.allowedTables && tool.allowedTables.length > 0 ? `<div class="wf-tool-tables">\u5141\u8BB8\u8868: ${tool.allowedTables.map(tb => `<span class="wf-badge wf-badge-table">${saEscapeHtml(tb)}</span>`).join(' ')}</div>` : ''}
                </div>
                <div class="wf-tool-detail wf-hidden">
                    <div class="wf-source-label">Function Calling JSON:</div>
                    <pre class="wf-pre">${saEscapeHtml(JSON.stringify(tool.functionCallingJson, null, 2))}</pre>
                </div>
            </div>`).join('')}
        </div>` : ''}

        <div class="wf-section">
            <div class="wf-section-header"><h4>\u{1F504} Agentic Loop (\u6700\u591A${t.agenticLoop.maxRounds}\u8F6E)</h4></div>
            <div class="wf-loop-diagram">
                <div class="wf-loop-round">
                    <div class="wf-loop-node wf-loop-llm">LLM \u8C03\u7528</div>
                    <div class="wf-loop-arrow">\u2193 \u8FD4\u56DE tool_calls</div>
                    <div class="wf-loop-node wf-loop-tool">\u6267\u884C\u5DE5\u5177 (sandbox)</div>
                    <div class="wf-loop-arrow">\u2193 \u5DE5\u5177\u7ED3\u679C</div>
                    <div class="wf-loop-node wf-loop-llm">\u518D\u6B21\u8C03\u7528 LLM</div>
                    <div class="wf-loop-note">\u5FAA\u73AF\u76F4\u5230 LLM \u4E0D\u518D\u8FD4\u56DE tool_calls \u6216\u8FBE\u5230\u6700\u5927\u8F6E\u6B21</div>
                </div>
            </div>
            <div class="wf-sandbox-info">
                <div class="wf-source-label">\u{1F6E1}\uFE0F \u6C99\u7BB1\u6267\u884C\u73AF\u5883</div>
                <div class="wf-kv"><span class="wf-k">JS \u5DE5\u5177</span><span class="wf-v">vm.Script \u6C99\u7BB1, \u767D\u540D\u5355\u5168\u5C40\u53D8\u91CF, 33\u79CD\u5371\u9669\u6A21\u5F0F\u68C0\u6D4B</span></div>
                <div class="wf-kv"><span class="wf-k">Python \u5DE5\u5177</span><span class="wf-v">Docker \u5BB9\u5668: --network none --memory=128m --cpus=0.5 --pids-limit=50</span></div>
                <div class="wf-kv"><span class="wf-k">DB \u8BBF\u95EE</span><span class="wf-v">\u7528\u6237\u7EA7\u6570\u636E\u9694\u79BB, SQL\u6CE8\u5165\u6821\u9A8C, \u8868\u7EA7\u767D\u540D\u5355\u63A7\u5236</span></div>
                <div class="wf-kv"><span class="wf-k">\u5B89\u5168\u9650\u5236</span><span class="wf-v">\u7981\u6B62 require/import/process/eval/child_process/fs \u7B49</span></div>
            </div>
        </div>
    </div>`;
}

function renderWfPipeline(d) {
    const rp = d.reflectionPipeline;
    return `
    <div class="wf-pipeline">
        <div class="wf-section">
            <div class="wf-section-header"><h4>\u{1F504} \u9636\u68AF\u5F0F\u53CD\u601D\u8BC4\u5BA1\u7BA1\u9053</h4></div>
            ${rp.rules.length === 0 ? '<div class="wf-empty-hint">\u672A\u914D\u7F6E\u8BC4\u5BA1\u89C4\u5219 (Rule.md \u4E3A\u7A7A)</div>' : ''}
            <div class="wf-pipeline-timeline">
                ${rp.rules.map((rule, i) => `
                <div class="wf-rule-card">
                    <div class="wf-rule-header">
                        <div class="wf-rule-order">Rule ${rule.sortOrder}</div>
                        <div class="wf-rule-filename">${saEscapeHtml(rule.fileName || 'Rule.md')}</div>
                        <div class="wf-rule-badges">
                            <span class="wf-badge wf-badge-info">\u6700\u5927\u91CD\u8BD5: ${rule.maxRetries}</span>
                            <span class="wf-badge wf-badge-info">response_format: ${rule.responseFormat}</span>
                        </div>
                    </div>
                    <div class="wf-rule-body">
                        <div class="wf-source-label">\u89C4\u5219\u5185\u5BB9 (\u4F5C\u4E3A System Prompt \u53D1\u7ED9 LLM):</div>
                        <pre class="wf-pre wf-collapsed" id="wfRule${i}">${saEscapeHtml(rule.content || '(\u7A7A)')}</pre>
                        <button class="wf-rule-toggle" data-target="wfRule${i}">\u5C55\u5F00\u89C4\u5219\u5185\u5BB9</button>
                    </div>
                    <div class="wf-rule-logic">
                        <div class="wf-rule-flow">
                            <div class="wf-flow-mini">
                                <span class="wf-node-mini wf-node-llm">LLM\u8C03\u7528</span>
                                <span class="wf-arrow-mini">\u2192</span>
                                <span class="wf-node-mini wf-node-check">passed?</span>
                                <span class="wf-arrow-mini">\u2705</span>
                                <span class="wf-node-mini wf-node-pass">\u901A\u8FC7\u2192\u4E0B\u4E00\u6761</span>
                            </div>
                            <div class="wf-flow-mini">
                                <span class="wf-node-mini wf-node-check">passed?</span>
                                <span class="wf-arrow-mini">\u274C</span>
                                <span class="wf-node-mini wf-node-retry">\u4FEE\u6B63\u8349\u7A3F+\u91CD\u8BD5</span>
                                <span class="wf-arrow-mini">\u2190</span>
                                <span class="wf-node-mini wf-node-llm">\u91CD\u65B0\u8C03\u7528LLM</span>
                            </div>
                        </div>
                    </div>
                    ${i < rp.rules.length - 1 ? '<div class="wf-rule-connector">\u2B07\uFE0F \u901A\u8FC7\u540E\u8FDB\u5165\u4E0B\u4E00\u6761\u89C4\u5219</div>' : ''}
                </div>`).join('')}
                ${rp.rules.length > 0 ? `
                <div class="wf-rule-result">
                    <div class="wf-rule-result-pass">\u2705 \u5168\u90E8\u901A\u8FC7: status='passed', draft=\u6700\u7EC8\u4FEE\u6B63\u540E\u7684\u8349\u7A3F</div>
                    <div class="wf-rule-result-fail">\u274C \u7194\u65AD: \u4EFB\u4E00\u89C4\u5219\u91CD\u8BD53\u6B21\u672A\u901A\u8FC7 \u2192 status='needs_human', failed_rule=\u6700\u540E\u5931\u8D25\u7684\u89C4\u5219\u5E8F\u53F7</div>
                </div>` : ''}
            </div>
        </div>
        <div class="wf-section">
            <div class="wf-section-header"><h4>\u{1F4CB} \u8BC4\u5BA1\u8F93\u51FA\u683C\u5F0F</h4></div>
            <pre class="wf-pre">${saEscapeHtml(JSON.stringify(rp.outputFormat, null, 2))}</pre>
            <div class="wf-source-label">User Prompt \u7EC4\u6210: \u5F53\u524D\u8349\u7A3F JSON + \u524D\u5E8F\u8BC4\u5BA1\u5C65\u5386 + \u8F93\u51FA\u683C\u5F0F\u8981\u6C42</div>
        </div>
    </div>`;
}

function renderWfMemory(d) {
    const m = d.memory;
    const sp = d.promptAssembly.systemPrompt;
    return `
    <div class="wf-memory">
        <div class="wf-section">
            <div class="wf-section-header"><h4>\u{1F9E0} \u8BB0\u5FC6\u4E0A\u4E0B\u6587\u62FC\u88C5</h4></div>
            <div class="wf-memory-status">
                ${m.enabled ? '<span class="wf-badge wf-badge-success">\u2705 \u8BB0\u5FC6\u5DF2\u542F\u7528</span>' : '<span class="wf-badge wf-badge-error">\u274C \u8BB0\u5FC6\u672A\u542F\u7528</span>'}
                ${m.isFullPreview ? '<span class="wf-badge wf-badge-warn" style="margin-left:8px">\u26A0\uFE0F \u5168\u91CF\u9884\u89C8\u6A21\u5F0F: \u5B9E\u9645\u8FD0\u884C\u65F6\u4EC5\u52A0\u8F7D\u5339\u914D\u5F53\u524D\u7528\u4F8B\u5E93/\u6A21\u5757\u7684\u8BB0\u5FC6</span>' : ''}
            </div>
            <div class="wf-memory-layout">
                <div class="wf-memory-tree">
                    <div class="wf-source-label">\u8BB0\u5FC6\u6811</div>
                    <div class="wf-tree-level">
                        <span class="wf-tree-icon">\u{1F30D}</span>
                        <span class="wf-tree-name">\u5168\u5C40</span>
                        <span class="wf-tree-count">${m.stats.global.count} \u6761 / ${m.stats.global.totalChars} \u5B57</span>
                    </div>
                    <div class="wf-tree-level wf-tree-indent">
                        <span class="wf-tree-icon">\u{1F4DA}</span>
                        <span class="wf-tree-name">\u5E93\u7EA7</span>
                        <span class="wf-tree-count">${m.stats.library.count} \u6761 / ${m.stats.library.totalChars} \u5B57</span>
                    </div>
                    <div class="wf-tree-level wf-tree-indent-2">
                        <span class="wf-tree-icon">\u{1F4E6}</span>
                        <span class="wf-tree-name">\u6A21\u5757</span>
                        <span class="wf-tree-count">${m.stats.module.count} \u6761 / ${m.stats.module.totalChars} \u5B57</span>
                    </div>
                </div>
                <div class="wf-memory-process">
                    <div class="wf-source-label">\u62FC\u88C5\u8FC7\u7A0B</div>
                    <div class="wf-process-step">
                        <div class="wf-process-num">1</div>
                        <div class="wf-process-text">\u67E5\u8BE2\u5339\u914D\u8BB0\u5FC6: WHERE agent_id = ? AND (level='global' OR (level='library' AND library_id=?) OR (level='module' AND module_id=?))</div>
                    </div>
                    <div class="wf-process-step">
                        <div class="wf-process-num">2</div>
                        <div class="wf-process-text">\u8BA1\u7B97\u603B\u5B57\u7B26\u6570: ${m.totalCharCount} \u5B57 ${m.totalCharCount > m.charLimit ? '<span class="wf-badge wf-badge-warn">\u8D85\u8FC7\u9650\u5236!</span>' : '<span class="wf-badge wf-badge-success">\u5728\u9650\u5236\u5185</span>'}</div>
                    </div>
                    ${m.truncationSteps.length > 0 ? m.truncationSteps.map(step => `
                    <div class="wf-process-step wf-process-truncate">
                        <div class="wf-process-num">\u2702\uFE0F</div>
                        <div class="wf-process-text">${step.action === 'remove_module' ? '\u79FB\u9664\u6A21\u5757\u7EA7\u8BB0\u5FC6' : step.action === 'truncate_library' ? '\u622A\u65AD\u5E93\u7EA7\u8BB0\u5FC6' : '\u622A\u65AD\u5168\u5C40\u8BB0\u5FC6'}: -${step.charsRemoved}\u5B57, \u5269\u4F59 ${step.remaining}\u5B57</div>
                    </div>`).join('') : ''}
                    <div class="wf-process-step">
                        <div class="wf-process-num">3</div>
                        <div class="wf-process-text">\u5305\u88C5\u4E3A XML \u683C\u5F0F: &lt;Memory_Context&gt;...&lt;/Memory_Context&gt;</div>
                    </div>
                    <div class="wf-process-step">
                        <div class="wf-process-num">4</div>
                        <div class="wf-process-text">\u62FC\u63A5\u5230 System Prompt \u672B\u5C3E</div>
                    </div>
                </div>
            </div>
            ${sp.memory.content ? `
            <div class="wf-memory-preview">
                <div class="wf-source-label">\u6700\u7EC8\u6CE8\u5165\u7684\u8BB0\u5FC6\u4E0A\u4E0B\u6587 (${sp.memory.charCount} \u5B57\u7B26):</div>
                <pre class="wf-pre wf-collapsed" id="wfMemoryPreview">${saEscapeHtml(sp.memory.content)}</pre>
                <button class="wf-toggle-expand" data-target="wfMemoryPreview">\u5C55\u5F00</button>
            </div>` : ''}
        </div>
        <div class="wf-section">
            <div class="wf-section-header"><h4>\u{1F525} \u84B8\u998F\u673A\u5236</h4></div>
            <div class="wf-kv"><span class="wf-k">\u84B8\u998F\u9608\u503C</span><span class="wf-v">${m.distillThreshold} \u5B57\u7B26</span></div>
            <div class="wf-kv"><span class="wf-k">\u5B57\u7B26\u4E0A\u9650</span><span class="wf-v">${m.charLimit} \u5B57\u7B26</span></div>
            <div class="wf-kv"><span class="wf-k">\u84B8\u998F\u573A\u666F</span><span class="wf-v">${saEscapeHtml(m.distillScene)}</span></div>
            <div class="wf-kv"><span class="wf-k">\u81EA\u52A8\u84B8\u998F</span><span class="wf-v">checkAndAutoDistill() \u68C0\u67E5\u8D85\u9608\u503C\u8BB0\u5FC6</span></div>
            <div class="wf-kv"><span class="wf-k">\u7528\u6237\u4FEE\u6B63\u84B8\u998F</span><span class="wf-v">\u7528\u6237diff \u2192 \u5408\u5E76\u7CBE\u70BC \u2192 \u66F4\u65B0\u8BB0\u5FC6</span></div>
            <div class="wf-kv"><span class="wf-k">\u84B8\u998F\u8F93\u51FA\u4E0A\u9650</span><span class="wf-v">500 \u5B57\u7B26</span></div>
        </div>
    </div>`;
}

function renderWfSequence(d) {
    const hasTools = d.tools.parsed.length > 0;
    const hasRules = d.reflectionPipeline.rules.length > 0;
    const hasMemory = d.promptAssembly.systemPrompt.memory.content.length > 0;
    const a = d.agent;
    const COLS = ['user', 'engine', 'config', 'memory', 'llm'];
    const COL_ICONS = { user: '\u{1F464}', engine: '\u2699\uFE0F', config: '\u{1F4C5}', memory: '\u{1F9E0}', llm: '\u{1F916}' };
    const COL_NAMES = { user: '\u7528\u6237', engine: '\u7F16\u6392\u5668', config: '\u914D\u7F6E', memory: '\u8BB0\u5FC6', llm: 'LLM' };

    function seqMsg(from, to, label, opts = {}) {
        const fromIdx = COLS.indexOf(from);
        const toIdx = COLS.indexOf(to);
        if (fromIdx < 0 || toIdx < 0) return '';
        const isRight = toIdx > fromIdx;
        const span = Math.abs(toIdx - fromIdx);
        const isReturn = opts.returnMsg || false;
        const dotCls = isReturn ? 'wf-dot wf-dot-res' : 'wf-dot wf-dot-req';
        const lineCls = isReturn ? 'wf-line-res' : 'wf-line-req';
        const labelCls = isReturn ? 'wf-label wf-label-res' : 'wf-label wf-label-req';
        const widthPct = span * 100;
        const lineLeft = isRight ? '50%' : `-${widthPct - 50}%`;
        const labelLeft = isRight ? '50%' : `-${widthPct - 50}%`;

        let tds = '';
        for (let i = 0; i < COLS.length; i++) {
            if (i === fromIdx) {
                tds += `<td class="wf-td"><span class="${dotCls}"></span><span class="${lineCls}" style="left:${lineLeft};width:${widthPct}%"></span><span class="wf-label-container" style="left:${labelLeft};width:${widthPct}%"><span class="${labelCls}">${label}</span></span></td>`;
            } else if (i === toIdx) {
                tds += `<td class="wf-td"><span class="${dotCls}"></span></td>`;
            } else {
                tds += `<td class="wf-td"></td>`;
            }
        }
        return `<tr>${tds}</tr>`;
    }

    function seqNote(label, opts = {}) {
        const midIdx = Math.floor(COLS.length / 2);
        let tds = '';
        for (let i = 0; i < COLS.length; i++) {
            if (i === midIdx) {
                tds += `<td style="position:relative;height:36px;vertical-align:middle;padding:0"><span class="wf-note-line-l"></span><span class="wf-note-badge">${label}</span><span class="wf-note-line-r"></span></td>`;
            } else {
                tds += `<td class="wf-note-row" style="height:36px"></td>`;
            }
        }
        return `<tr class="wf-note-row">${tds}</tr>`;
    }

    let msgRows = '';
    msgRows += seqMsg('user', 'engine', `\u89E6\u53D1\u6267\u884C (agentCode=${saEscapeHtml(a.agentCode)})`);
    msgRows += seqMsg('engine', 'config', '_resolveAgent() Override\u5F15\u64CE');
    msgRows += seqMsg('config', 'engine', '\u79C1\u6709\u8986\u76D6 / \u7CFB\u7EDF\u9ED8\u8BA4 / \u516C\u5F00\u4EE3\u7406', { returnMsg: true });
    msgRows += seqMsg('engine', 'config', '_loadConfigFiles() \u52A0\u8F7Dsoul/user/tools/rules/ref_docs');
    msgRows += seqMsg('config', 'engine', 'Map { soul, user, tools, rules[], ref_docs[] }', { returnMsg: true });
    if (hasMemory) {
        msgRows += seqMsg('engine', 'memory', 'assembleContext() JIT\u62FC\u88C5');
        msgRows += seqMsg('memory', 'engine', '&lt;Memory_Context&gt;...&lt;/Memory_Context&gt;', { returnMsg: true });
    }
    msgRows += seqNote(`\u2699\uFE0F \u7EC4\u88C5 Prompt: System = Soul.md${hasMemory ? ' + Memory_Context' : ''} | User = User.md(\u53D8\u91CF\u63D2\u503C)${d.promptAssembly.userPrompt.refDocs.length > 0 ? ' + \u53C2\u8003\u6587\u6863' : ''}`, { isDivider: true });
    msgRows += seqMsg('engine', 'llm', `_callLLM() messages=[{system},{user}]${hasTools ? ' tools=[...]' : ''}`);
    msgRows += seqMsg('llm', 'engine', `{ content, tool_calls${hasTools ? ' (\u53EF\u80FD\u5B58\u5728)' : ''} }`, { returnMsg: true });
    if (hasTools) {
        msgRows += seqNote('\u{1F504} Agentic Loop (\u6700\u591A5\u8F6E)', { isDivider: true });
        msgRows += seqMsg('engine', 'config', '_executeToolCalls() \u6267\u884C\u5DE5\u5177 (sandbox)');
        msgRows += seqMsg('config', 'engine', '{ success, result }', { returnMsg: true });
        msgRows += seqMsg('engine', 'llm', '_callLLMWithToolResults() messages+tool_results');
        msgRows += seqMsg('llm', 'engine', '{ content: "\u6700\u7EC8\u7ED3\u679C" } (\u65E0tool_calls, \u5FAA\u73AF\u7ED3\u675F)', { returnMsg: true });
    }
    if (hasRules) {
        msgRows += seqNote('\u{1F504} \u9636\u68AF\u5F0F\u53CD\u601D\u8BC4\u5BA1\u7BA1\u9053', { isDivider: true });
        d.reflectionPipeline.rules.forEach((rule, i) => {
            msgRows += seqMsg('engine', 'llm', `Rule ${rule.sortOrder}: system=rule.content, user=\u8349\u7A3F+\u5C65\u5386`);
            msgRows += seqMsg('llm', 'engine', '{ passed, summary, revised_draft, confidence }', { returnMsg: true });
            if (i < d.reflectionPipeline.rules.length - 1) {
                msgRows += seqNote('\u2705 \u901A\u8FC7 \u2192 \u8FDB\u5165\u4E0B\u4E00\u6761\u89C4\u5219');
            }
        });
    }
    msgRows += seqNote('\u{1F4E6} \u8FD4\u56DE\u7ED3\u679C', { isDivider: true });
    msgRows += seqMsg('engine', 'user', '{ success, result, toolCallsLog, memoryContribution }', { returnMsg: true });

    return `
    <div class="wf-sequence">
        <div class="wf-section">
            <div class="wf-section-header"><h4>\u23F1 \u5B8C\u6574\u4EA4\u4E92\u65F6\u5E8F</h4></div>
            <div class="wf-seq-diagram">
                <table class="wf-stable">
                    <thead>
                        <tr>${COLS.map(c => `<th class="wf-sth"><span class="wf-actor-icon">${COL_ICONS[c]}</span><span class="wf-actor-name">${COL_NAMES[c]}</span></th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${msgRows}
                    </tbody>
                </table>
            </div>
        </div>
        ${d.aiConfig ? `
        <div class="wf-section">
            <div class="wf-section-header"><h4>\u{1F4CB} LLM \u8BF7\u6C42\u4F53\u7ED3\u6784</h4></div>
            <pre class="wf-pre">${saEscapeHtml(JSON.stringify({
                model: d.aiConfig.model,
                messages: [
                    { role: 'system', content: '...(Soul.md + Memory_Context)' },
                    { role: 'user', content: '...(User.md \u53D8\u91CF\u63D2\u503C + \u53C2\u8003\u6587\u6863)' }
                ],
                temperature: d.aiConfig.temperature,
                max_tokens: d.aiConfig.maxTokens,
                ...(hasTools ? { tools: d.tools.functionCallingList, tool_choice: d.aiConfig.toolChoice } : {}),
                ...(d.aiConfig.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {})
            }, null, 2))}</pre>
        </div>` : ''}
    </div>`;
}

// =====================================================================
// Exports
// =====================================================================

// init 函数 - 供模块加载器调用
function init() {
    initSubAgentsConfig();
}

// 数据加载函数 - 供外部调用或手动刷新
function loadSubAgentsData() {
    return loadSubAgentsList();
}

window.initSubAgentsConfig = initSubAgentsConfig;
window.loadSubAgentsList = loadSubAgentsList;
window.loadSubAgentsData = loadSubAgentsData;
window.openSubAgentModal = openSubAgentModal;
window.saveSubAgent = saveSubAgent;
window.deleteSubAgent = deleteSubAgent;
window.toggleSubAgent = toggleSubAgent;
window.restoreDefault = restoreDefault;
window.openWorkflowViewer = openWorkflowViewer;
