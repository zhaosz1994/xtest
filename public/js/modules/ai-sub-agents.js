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
    return div.innerHTML;
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
}

// =====================================================================
// 1. initSubAgentsConfig() - Initialize the module, bind events
// =====================================================================

function initSubAgentsConfig() {
    if (subAgentInitialized) return;
    subAgentInitialized = true;

    // 确保容器和样式已注入
    saEnsureContainer();
    saInjectStyles();

    // 绑定顶部按钮
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

    // 绑定参考文档 - 保存按钮
    const btnSaveRefDocs = document.getElementById('saBtnSaveRefDocs');
    if (btnSaveRefDocs) {
        btnSaveRefDocs.addEventListener('click', () => {
            if (saCurrentEditId) saveConfigFile(saCurrentEditId, 'ref_docs');
        });
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
            saCloseAllModals();
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
                    <input type="text" id="saInputModel" class="sa-input" placeholder="\u4F8B: gpt-4o" value="gpt-4o">
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
                <div class="sa-form-group">
                    <label>\u6392\u5E8F</label>
                    <input type="number" id="saInputSortOrder" class="sa-input" value="0" min="0">
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

            <!-- Tab: 参考文档 -->
            <div id="saTabRefdocs" class="sa-tab-content" style="display:none;">
                <div class="sa-refdocs-header">
                    <span>\u53C2\u8003\u6587\u6863\u5217\u8868</span>
                    <div>
                        <button class="sa-btn sa-btn-sm sa-btn-ghost" id="saBtnInitConfigFiles">\u521D\u59CB\u5316\u9ED8\u8BA4\u914D\u7F6E</button>
                        <button class="sa-btn sa-btn-sm sa-btn-primary" id="saBtnAddRefDoc">+ \u6DFB\u52A0\u6587\u6863</button>
                    </div>
                </div>
                <div id="saRefDocsList" class="sa-refdocs-list"></div>
                <div class="sa-md-editor-actions">
                    <button class="sa-btn sa-btn-primary" id="saBtnSaveRefDocs">\u4FDD\u5B58\u53C2\u8003\u6587\u6863</button>
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

        /* Dropdown */
        .sa-dropdown { position: relative; display: inline-block; }
        .sa-dropdown-toggle { padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; color: #475569; }
        .sa-dropdown-toggle:hover { border-color: #6366f1; }
        .sa-dropdown-menu { position: absolute; right: 0; top: 100%; margin-top: 4px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); min-width: 140px; z-index: 100; display: none; overflow: hidden; }
        .sa-dropdown-menu.show { display: block; }
        .sa-dropdown-item { display: block; width: 100%; padding: 8px 14px; border: none; background: none; text-align: left; font-size: 13px; color: #334155; cursor: pointer; transition: background .1s; }
        .sa-dropdown-item:hover { background: #f1f5f9; }
        .sa-dropdown-item.danger { color: #ef4444; }
        .sa-dropdown-item.danger:hover { background: #fef2f2; }

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
        .sa-refdocs-list { border: 1px solid #e2e8f0; border-radius: 8px; overflow: auto; flex: 1; min-height: 280px; }
        .sa-refdoc-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
        .sa-refdoc-item:last-child { border-bottom: none; }
        .sa-refdoc-item .sa-refdoc-name { flex: 1; font-size: 14px; color: #334155; }
        .sa-refdoc-item .sa-refdoc-path { font-size: 12px; color: #94a3b8; }
        .sa-refdoc-item-actions { display: flex; gap: 4px; }
        .sa-refdoc-empty { padding: 40px; text-align: center; color: #94a3b8; font-size: 14px; }

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
    `;
    document.head.appendChild(style);
}

// =====================================================================
// 2. loadSubAgentsList() - Load and render agent list table
// =====================================================================

async function loadSubAgentsList() {
    const tbody = document.getElementById('saAgentListBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#94a3b8;">\u52A0\u8F7D\u4E2D...</td></tr>`;

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
                <div class="sa-dropdown">
                    <button class="sa-dropdown-toggle" data-action="dropdown-toggle">\u64CD\u4F5C \u25BE</button>
                    <div class="sa-dropdown-menu">
                        <button class="sa-dropdown-item" data-action="edit" data-id="${agent.id}" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u270F\uFE0F \u7F16\u8F91</button>
                        <button class="sa-dropdown-item" data-action="copy" data-id="${agent.id}" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u{1F4CB} \u590D\u5236</button>
                        ${isSystem && isOverridden ? `<button class="sa-dropdown-item" data-action="restore" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u{1F504} \u6062\u590D\u9ED8\u8BA4</button>` : ''}
                        ${!isSystem ? `<button class="sa-dropdown-item danger" data-action="delete" data-id="${agent.id}" data-agent-code="${saEscapeHtml(agent.agentCode || agent.agent_code)}">\u{1F5D1}\uFE0F \u5220\u9664</button>` : ''}
                    </div>
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
    // Dropdown toggle
    const toggleBtn = e.target.closest('[data-action="dropdown-toggle"]');
    if (toggleBtn) {
        e.stopPropagation();
        const menu = toggleBtn.nextElementSibling;
        // 关闭所有其他下拉
        document.querySelectorAll('.sa-dropdown-menu.show').forEach(m => {
            if (m !== menu) m.classList.remove('show');
        });
        menu.classList.toggle('show');
        return;
    }

    // Dropdown items
    const item = e.target.closest('.sa-dropdown-item');
    if (item) {
        const action = item.dataset.action;
        const id = item.dataset.id;
        const agentCode = item.dataset.agentCode;

        // 关闭下拉菜单
        item.closest('.sa-dropdown-menu').classList.remove('show');

        if (action === 'edit') {
            openSubAgentModal(agentCode);
        } else if (action === 'copy') {
            saCopyAgent(id, agentCode);
        } else if (action === 'restore') {
            restoreDefault(agentCode);
        } else if (action === 'delete') {
            deleteSubAgent(id, agentCode);
        }
        return;
    }
}

function saHandleListChange(e) {
    const toggleInput = e.target.closest('[data-action="toggle"]');
    if (toggleInput) {
        const id = toggleInput.dataset.toggleId;
        toggleSubAgent(id);
    }
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.sa-dropdown')) {
        document.querySelectorAll('.sa-dropdown-menu.show').forEach(m => m.classList.remove('show'));
    }
});

// =====================================================================
// 3. openSubAgentModal(agentCode) - Open create/edit modal
// =====================================================================

async function openSubAgentModal(agentCode) {
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
                const agent = result.data || result.agent;
                saCurrentEditId = agent.id;
                saCurrentEditAgentCode = agent.agentCode || agent.agent_code;
                saCurrentEditIsSystem = agent.isSystem === 1 || agent.isSystem === true || agent.is_system === 1 || agent.is_system === true;
                saCurrentEditIsOverridden = agent.isOverridden === 1 || agent.isOverridden === true || agent.is_overridden === 1 || agent.is_overridden === true;

                document.getElementById('saModalTitle').textContent =
                    `\u7F16\u8F91\u667A\u80FD\u4F53: ${agent.displayName || agent.display_name || agent.agentCode || agent.agent_code}`;

                // 填充基本信息
                document.getElementById('saInputAgentCode').value = agent.agentCode || agent.agent_code || '';
                document.getElementById('saInputAgentCode').disabled = true; // 编辑时不可修改 code
                document.getElementById('saInputDisplayName').value = agent.displayName || agent.display_name || '';
                document.getElementById('saInputCategory').value = agent.category || '';
                document.getElementById('saInputDescription').value = agent.description || '';
                document.getElementById('saInputModel').value = agent.model || 'gpt-4o';
                document.getElementById('saInputMemoryEnabled').value = (agent.memoryEnabled === 1 || agent.memoryEnabled === true || agent.memory_enabled === 1 || agent.memory_enabled === true) ? '1' : '0';
                document.getElementById('saInputIsEnabled').value = (agent.isEnabled === 1 || agent.isEnabled === true || agent.is_enabled === 1 || agent.is_enabled === true) ? '1' : '0';
                document.getElementById('saInputSortOrder').value = agent.sort_order || 0;

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
    const inputs = ['saInputAgentCode', 'saInputDisplayName', 'saInputDescription', 'saInputModel', 'saInputSortOrder', 'saInputCategory'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.disabled = false; }
    });
    const saInputMemoryEnabled = document.getElementById('saInputMemoryEnabled');
    if (saInputMemoryEnabled) saInputMemoryEnabled.value = '1';
    const saInputIsEnabled = document.getElementById('saInputIsEnabled');
    if (saInputIsEnabled) saInputIsEnabled.value = '1';
    const saInputSoulMd = document.getElementById('saInputSoulMd');
    if (saInputSoulMd) saInputSoulMd.value = '';
    const saInputUserMd = document.getElementById('saInputUserMd');
    if (saInputUserMd) saInputUserMd.value = '';

    // 隐藏预览
    const soulPreview = document.getElementById('saSoulPreviewPane');
    if (soulPreview) soulPreview.style.display = 'none';
    const userPreview = document.getElementById('saUserPreviewPane');
    if (userPreview) userPreview.style.display = 'none';
}

function saSwitchModalTab(tabName) {
    // 切换 tab 按钮高亮
    document.querySelectorAll('#saAgentModal .sa-modal-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    // 切换 tab 内容
    const tabMap = { basic: 'saTabBasic', soul: 'saTabSoul', user: 'saTabUser', tools: 'saTabTools', refdocs: 'saTabRefdocs' };
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
    const paneId = type === 'soul' ? 'saSoulPreviewPane' : 'saUserPreviewPane';
    const textareaId = type === 'soul' ? 'saInputSoulMd' : 'saInputUserMd';
    const bodyId = type === 'soul' ? 'saSoulPreviewBody' : 'saUserPreviewBody';

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
        sort_order: sortOrder
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
        const result = await apiRequest(`/ai-sub-agents/config-files/${agentId}`);
        if (result.success) {
            const files = result.data || [];
            saConfigFilesCache = {};

            // 按 file_type 分类
            files.forEach(f => {
                saConfigFilesCache[f.file_type] = f;
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

            renderRefDocsList(files.filter(f => f.file_type === 'ref_doc' || f.file_type === 'custom'));
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
        container.innerHTML = '<div class="sa-refdoc-empty">\u6682\u65E0\u53C2\u8003\u6587\u6863\uFF0C\u70B9\u51FB\u201C\u6DFB\u52A0\u6587\u6863\u201D\u6216\u201C\u521D\u59CB\u5316\u9ED8\u8BA4\u914D\u7F6E\u201D</div>';
        return;
    }

    container.innerHTML = refDocs.map(doc => `
        <div class="sa-refdoc-item" data-file-id="${doc.id}">
            <div style="flex:1;">
                <div class="sa-refdoc-name">${saEscapeHtml(doc.file_name || doc.name || '\u672A\u547D\u540D')}</div>
                <div class="sa-refdoc-path">${saEscapeHtml(doc.file_path || '')} ${doc.updated_at ? '| ' + saFormatDateTime(doc.updated_at) : ''}</div>
            </div>
            <div class="sa-refdoc-item-actions">
                <button class="sa-btn sa-btn-sm sa-btn-ghost" data-action="edit-refdoc" data-file-id="${doc.id}" data-file-name="${saEscapeHtml(doc.file_name || doc.name || '')}">\u270F\uFE0F</button>
                <button class="sa-btn sa-btn-sm sa-btn-ghost" data-action="delete-refdoc" data-file-id="${doc.id}" data-file-name="${saEscapeHtml(doc.file_name || doc.name || '')}">\u{1F5D1}\uFE0F</button>
            </div>
        </div>
    `).join('');

    // 绑定参考文档操作事件
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
    // 弹出输入框让用户输入文档名和内容
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '\u6587\u6863\u540D\u79F0';

    const contentInput = document.createElement('textarea');
    contentInput.placeholder = '\u6587\u6863\u5185\u5BB9';
    contentInput.rows = 6;

    const dialog = saCreateInputDialog('\u6DFB\u52A0\u53C2\u8003\u6587\u6863', [
        { label: '\u6587\u6863\u540D\u79F0', input: nameInput },
        { label: '\u5185\u5BB9', input: contentInput }
    ]);

    dialog.onConfirm = async () => {
        const name = nameInput.value.trim();
        const content = contentInput.value.trim();
        if (!name) {
            if (typeof showErrorMessage === 'function') showErrorMessage('\u8BF7\u8F93\u5165\u6587\u6863\u540D\u79F0');
            return;
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
    // 先获取当前内容
    const doc = Object.values(saConfigFilesCache).find(f => f.id == fileId && f.file_type === 'ref_doc');
    const currentContent = doc ? (doc.content || '') : '';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = fileName;

    const contentInput = document.createElement('textarea');
    contentInput.rows = 8;
    contentInput.value = currentContent;

    const dialog = saCreateInputDialog('\u7F16\u8F91\u53C2\u8003\u6587\u6863', [
        { label: '\u6587\u6863\u540D\u79F0', input: nameInput },
        { label: '\u5185\u5BB9', input: contentInput }
    ]);

    dialog.onConfirm = async () => {
        const name = nameInput.value.trim();
        const content = contentInput.value.trim();
        if (!name) {
            if (typeof showErrorMessage === 'function') showErrorMessage('\u8BF7\u8F93\u5165\u6587\u6863\u540D\u79F0');
            return;
        }
        try {
            const result = await apiRequest(`/ai-sub-agents/config-files/${saCurrentEditId}/ref_doc`, {
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

// ---- Simple input dialog helper ----

function saCreateInputDialog(title, fields) {
    let modal = document.getElementById('sa-input-dialog');
    if (modal) modal.remove();

    const dialogEl = document.createElement('div');
    dialogEl.id = 'sa-input-dialog';
    dialogEl.className = 'sa-confirm-modal';
    dialogEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

    let fieldsHtml = fields.map(f => `
        <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#475569;">${saEscapeHtml(f.label)}</label>
        </div>
    `).join('');

    dialogEl.innerHTML = `
        <div style="background:#fff;border-radius:12px;width:480px;max-width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.15);animation:sa-confirm-in 0.2s ease;">
            <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;">
                <span style="font-size:24px;">\u270F\uFE0F</span>
                <h3 style="margin:0;font-size:16px;color:#1e293b;">${saEscapeHtml(title)}</h3>
            </div>
            <div style="padding:24px;" id="saInputDialogFields"></div>
            <div style="padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:12px;">
                <button class="sa-btn sa-btn-ghost" id="saInputDialogCancel">\u53D6\u6D88</button>
                <button class="sa-btn sa-btn-primary" id="saInputDialogOk">\u786E\u8BA4</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialogEl);

    const fieldsContainer = document.getElementById('saInputDialogFields');
    fields.forEach(f => {
        const label = document.createElement('label');
        label.style.cssText = 'display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#475569;';
        label.textContent = f.label;
        fieldsContainer.appendChild(label);
        f.input.style.cssText = 'width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:12px;';
        fieldsContainer.appendChild(f.input);
    });

    const dialog = { onConfirm: null };

    document.getElementById('saInputDialogCancel').addEventListener('click', () => {
        dialogEl.remove();
    });
    document.getElementById('saInputDialogOk').addEventListener('click', () => {
        if (dialog.onConfirm) dialog.onConfirm();
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
    } else if (fileType === 'ref_docs') {
        // 参考文档单独保存, 此处不做处理
        if (typeof showSuccessMessage === 'function') showSuccessMessage('\u53C2\u8003\u6587\u6863\u5DF2\u4FDD\u5B58');
        return;
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

    // 分离可用和已挂载
    const mountedSet = new Set(mountedTools.map(id => String(id)));
    const leftItems = [];  // 可用 (未挂载)
    const rightItems = []; // 已挂载

    availableTools.forEach(tool => {
        const toolId = String(tool.id || tool.tool_id || tool.name);
        const item = {
            id: toolId,
            name: tool.display_name || tool.name || tool.tool_name || toolId,
            description: tool.description || ''
        };
        if (mountedSet.has(toolId)) {
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
                    <div class="sa-transfer-item" data-tool-id="${saEscapeHtml(item.id)}" data-tool-name="${saEscapeHtml(item.name).toLowerCase()}">
                        <input type="checkbox" class="sa-transfer-checkbox" data-side="right" data-tool-id="${saEscapeHtml(item.id)}">
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
        const agent = detailResult.data || detailResult.agent;

        // 创建副本
        const copyData = {
            agent_code: (agent.agentCode || agent.agent_code) + '_copy',
            display_name: (agent.displayName || agent.display_name) + ' (\u526F\u672C)',
            category: agent.category,
            description: agent.description,
            model: agent.model,
            memory_enabled: agent.memoryEnabled || agent.memory_enabled,
            is_enabled: false,
            sort_order: agent.sort_order
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
