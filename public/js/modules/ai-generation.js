/**
 * AI Generation Module
 * Extracted from ai-generation.html inline script
 */
let aiGenInitialized = false;

function initAIGeneration() {
    if (aiGenInitialized) return;
    aiGenInitialized = true;
    loadModules();
    loadAgents();

    const btnCreateSkill = document.getElementById('btnCreateSkill');
    const btnCancelSkill = document.getElementById('btnCancelSkill');
    const btnSaveSkill = document.getElementById('btnSaveSkill');
    const btnCloseSkillView = document.getElementById('btnCloseSkillView');
    const aiNewFolderName = document.getElementById('aiNewFolderName');

    if (btnCreateSkill) btnCreateSkill.addEventListener('click', showCreateSkillForm);
    if (btnCancelSkill) btnCancelSkill.addEventListener('click', hideCreateSkillForm);
    if (btnSaveSkill) btnSaveSkill.addEventListener('click', saveSkill);
    if (btnCloseSkillView) btnCloseSkillView.addEventListener('click', hideSkillViewPanel);

    if (aiNewFolderName) {
        aiNewFolderName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirmCreateFolder();
        });
    }

    restoreTabFromHash();
}

function restoreTabFromHash() {
    const hash = window.location.hash;
    const match = hash.match(/^#\/ai-generation\/(.+)$/);
    if (match) {
        const tab = match[1];
        const validTabs = ['generate', 'preview', 'review'];
        if (validTabs.includes(tab)) {
            switchTab(tab);
            return;
        }
    }
    switchTab('generate');
}

const AI_API_BASE = '';
let aiCurrentModuleId = null;
let aiCurrentLibraryId = null;
let aiCurrentParentId = null;
let aiSelectedFiles = new Set();
let aiCurrentTaskId = null;
let aiProgressInterval = null;
let allTempCases = [];
let selectedCases = new Set();
let expandedLibraries = new Set();
let expandedModules = new Set();
let expandedLevel1s = new Set();
let treeTableEventsInitialized = false;
let taskHistoryPage = 1;
let taskHistoryTotal = 0;
let taskHistoryPageSize = 10;
let caseTotal = 0;
let reviewPage = 1;
let reviewTotal = 0;
let reviewPageSize = 10;

function aiRenderPagination(containerId, currentPage, totalPages, total, onPageFn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    const start = (currentPage - 1) * (total === 0 ? 1 : Math.ceil(total / totalPages)) + 1;
    const end = Math.min(currentPage * Math.ceil(total / totalPages), total);
    let html = `<div class="pagination-stats">共 <strong>${total}</strong> 条</div>`;
    html += '<div class="pagination-btn-group">';
    html += `<button class="pagination-btn pagination-btn-nav" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}" data-fn="${onPageFn}">上一页</button>`;
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}" data-fn="${onPageFn}">${i}</button>`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += '<span class="pagination-ellipsis">...</span>';
        }
    }
    html += `<button class="pagination-btn pagination-btn-nav" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}" data-fn="${onPageFn}">下一页</button>`;
    html += '</div>';
    html += `<div class="pagination-jump">跳至 <input type="number" class="pagination-input" min="1" max="${totalPages}" value="${currentPage}"> 页 <button class="pagination-btn pagination-btn-jump" data-fn="${onPageFn}" data-jump="1">跳转</button></div>`;
    container.innerHTML = html;
    container.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', function() {
            const page = parseInt(this.dataset.page);
            const fn = this.dataset.fn;
            if (page >= 1 && page <= totalPages) {
                window[fn](page);
            }
        });
    });
    const jumpBtn = container.querySelector('button[data-jump]');
    const jumpInput = container.querySelector('.pagination-input');
    if (jumpBtn && jumpInput) {
        jumpBtn.addEventListener('click', function() {
            const fn = this.dataset.fn;
            const page = parseInt(jumpInput.value);
            if (page >= 1 && page <= totalPages) {
                window[fn](page);
            }
        });
        jumpInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const page = parseInt(this.value);
                const fn = jumpBtn.dataset.fn;
                if (page >= 1 && page <= totalPages) {
                    window[fn](page);
                }
            }
        });
    }
}
let currentLevel1Mode = 'auto';
let currentMergeMode = 'direct';
let conflictFileData = null;
let editingSkillId = null;

function aiEscapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function aiFormatDateTime(dateStr) {
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
        return '-';
    }
}

function aiGetAuthHeaders() {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function aiApiGet(url) {
    const res = await fetch(AI_API_BASE + url, { headers: aiGetAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function aiApiPost(url, data) {
    const res = await fetch(AI_API_BASE + url, {
        method: 'POST',
        headers: aiGetAuthHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function aiApiPut(url, data) {
    const res = await fetch(AI_API_BASE + url, {
        method: 'PUT',
        headers: aiGetAuthHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function aiApiDelete(url) {
    const res = await fetch(AI_API_BASE + url, {
        method: 'DELETE',
        headers: aiGetAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

let aiNotificationOffset = 0;

function aiNotify(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `ai-notification ai-notification-${type}`;
    el.textContent = message;
    const existingNotifications = document.querySelectorAll('#ai-generation-section .ai-notification');
    const offset = existingNotifications.length * 60;
    el.style.top = (20 + offset) + 'px';
    const section = document.getElementById('ai-generation-section');
    if (section) {
        section.appendChild(el);
    } else {
        document.body.appendChild(el);
    }
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => {
            el.remove();
        }, 300);
    }, 2700);
}

function aiShowConfirmMessage(message) {
    return new Promise((resolve) => {
        let modal = document.getElementById('ai-confirm-modal');
        if (!modal) {
            const style = document.createElement('style');
            style.id = 'ai-confirm-styles';
            style.textContent = `
                .ai-confirm-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 99999;
                }
                .ai-confirm-content {
                    background: #fff;
                    border-radius: 12px;
                    width: 400px;
                    max-width: 90%;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    animation: ai-confirm-in 0.2s ease;
                }
                @keyframes ai-confirm-in {
                    from { opacity: 0; transform: scale(0.9); }
                    to { opacity: 1; transform: scale(1); }
                }
                .ai-confirm-header {
                    padding: 20px 24px;
                    border-bottom: 1px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .ai-confirm-icon { font-size: 24px; }
                .ai-confirm-header h3 { margin: 0; font-size: 16px; color: #1e293b; }
                .ai-confirm-body { padding: 24px; }
                .ai-confirm-body p { margin: 0; font-size: 14px; color: #64748b; line-height: 1.6; }
                .ai-confirm-footer {
                    padding: 16px 24px;
                    border-top: 1px solid #e2e8f0;
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                }
                .ai-confirm-btn {
                    padding: 8px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    cursor: pointer;
                    border: none;
                    transition: all 0.2s;
                }
                .ai-confirm-btn.cancel { background: #f1f5f9; color: #64748b; }
                .ai-confirm-btn.cancel:hover { background: #e2e8f0; }
                .ai-confirm-btn.confirm { background: #6366f1; color: #fff; }
                .ai-confirm-btn.confirm:hover { background: #4f46e5; }
            `;
            document.head.appendChild(style);
            const modalHtml = `
                <div id="ai-confirm-modal" class="ai-confirm-modal" style="display: none;">
                    <div class="ai-confirm-content">
                        <div class="ai-confirm-header">
                            <span class="ai-confirm-icon">⚠️</span>
                            <h3>确认提示</h3>
                        </div>
                        <div class="ai-confirm-body">
                            <p id="ai-confirm-message"></p>
                        </div>
                        <div class="ai-confirm-footer">
                            <button class="ai-confirm-btn cancel" id="ai-confirm-cancel">取消</button>
                            <button class="ai-confirm-btn confirm" id="ai-confirm-ok">确认</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            modal = document.getElementById('ai-confirm-modal');
        }
        const messageEl = document.getElementById('ai-confirm-message');
        const okBtn = document.getElementById('ai-confirm-ok');
        const cancelBtn = document.getElementById('ai-confirm-cancel');
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

function showPromptModal(message, defaultValue = '') {
    return new Promise((resolve) => {
        let modal = document.getElementById('ai-prompt-modal');
        if (!modal) {
            const style = document.createElement('style');
            style.id = 'ai-prompt-styles';
            style.textContent = `
                .ai-prompt-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 99999;
                }
                .ai-prompt-content {
                    background: #fff;
                    border-radius: 12px;
                    width: 450px;
                    max-width: 90%;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    animation: ai-confirm-in 0.2s ease;
                }
                .ai-prompt-header {
                    padding: 20px 24px;
                    border-bottom: 1px solid #e2e8f0;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .ai-prompt-icon { font-size: 24px; }
                .ai-prompt-header h3 { margin: 0; font-size: 16px; color: #1e293b; }
                .ai-prompt-body { padding: 24px; }
                .ai-prompt-body p { margin: 0 0 12px; font-size: 14px; color: #64748b; }
                .ai-prompt-input {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 14px;
                    outline: none;
                    box-sizing: border-box;
                }
                .ai-prompt-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); }
                .ai-prompt-footer {
                    padding: 16px 24px;
                    border-top: 1px solid #e2e8f0;
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                }
                .ai-prompt-btn {
                    padding: 8px 20px;
                    border-radius: 8px;
                    font-size: 14px;
                    cursor: pointer;
                    border: none;
                    transition: all 0.2s;
                }
                .ai-prompt-btn.cancel { background: #f1f5f9; color: #64748b; }
                .ai-prompt-btn.cancel:hover { background: #e2e8f0; }
                .ai-prompt-btn.confirm { background: #6366f1; color: #fff; }
                .ai-prompt-btn.confirm:hover { background: #4f46e5; }
            `;
            document.head.appendChild(style);
            const modalHtml = `
                <div id="ai-prompt-modal" class="ai-prompt-modal" style="display: none;">
                    <div class="ai-prompt-content">
                        <div class="ai-prompt-header">
                            <span class="ai-prompt-icon">✏️</span>
                            <h3>请输入</h3>
                        </div>
                        <div class="ai-prompt-body">
                            <p id="ai-prompt-message"></p>
                            <input type="text" class="ai-prompt-input" id="ai-prompt-input">
                        </div>
                        <div class="ai-prompt-footer">
                            <button class="ai-prompt-btn cancel" id="ai-prompt-cancel">取消</button>
                            <button class="ai-prompt-btn confirm" id="ai-prompt-ok">确认</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            modal = document.getElementById('ai-prompt-modal');
        }
        const messageEl = document.getElementById('ai-prompt-message');
        const inputEl = document.getElementById('ai-prompt-input');
        const okBtn = document.getElementById('ai-prompt-ok');
        const cancelBtn = document.getElementById('ai-prompt-cancel');
        messageEl.textContent = message;
        inputEl.value = defaultValue;
        modal.style.display = 'flex';
        setTimeout(() => inputEl.focus(), 100);
        const cleanup = () => {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            inputEl.removeEventListener('keydown', handleEnter);
        };
        const handleOk = () => { cleanup(); resolve(inputEl.value || ''); };
        const handleCancel = () => { cleanup(); resolve(null); };
        const handleEnter = (e) => { if (e.key === 'Enter') handleOk(); };
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        inputEl.addEventListener('keydown', handleEnter);
    });
}

function switchTab(tab, options) {
    aiCloseAllModals();
    document.querySelectorAll('#ai-generation-section .tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('#ai-generation-section .ai-tab').forEach(el => el.classList.remove('active'));
    const tabContent = document.getElementById('tab-' + tab);
    tabContent.style.display = tab === 'preview' ? 'flex' : 'block';
    document.querySelector(`#ai-generation-section .ai-tab[data-tab="${tab}"]`).classList.add('active');

    const currentHash = window.location.hash;
    const newHash = `#/ai-generation/${tab}`;
    if (currentHash !== newHash) {
        history.replaceState(null, '', newHash);
    }

    if (tab === 'preview') {
        initTreeTableEvents();
        loadTaskFilter().then(() => {
            const taskFilter = document.getElementById('taskFilter');
            if (options && options.taskId) {
                taskFilter.value = options.taskId;
            } else if (!taskFilter.value) {
                taskFilter.value = 'all';
            }
            loadTempCases();
        });
    }
    if (tab === 'review') {
        if (typeof initAIReview === 'function') initAIReview();
        loadReviewList();
    }
}

async function loadModules() {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    if (!token) return;

    // 从 URL 参数读取知识库传过来的上下文（libraryId, moduleId）
    const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const prefillLibraryId = urlParams.get('libraryId');
    const prefillModuleId = urlParams.get('moduleId');

    try {
        const res = await aiApiGet('/api/libraries/list');
        if (res.success) {
            const libSelect = document.getElementById('librarySelect');
            const libraries = res.libraries || res.data || [];
            libraries.forEach(lib => {
                const opt = document.createElement('option');
                opt.value = lib.id;
                opt.textContent = lib.name;
                libSelect.appendChild(opt);
            });

            // 优先使用 URL 参数中的 libraryId，否则默认选第一个
            const targetLibraryId = prefillLibraryId || (libraries.length > 0 ? libraries[0].id : null);
            if (targetLibraryId) {
                aiCurrentLibraryId = parseInt(targetLibraryId);
                document.getElementById('librarySelect').value = aiCurrentLibraryId;
                await loadModulesByLibrary(aiCurrentLibraryId);

                // 如果 URL 参数中有 moduleId，自动选中并加载文件和测试点
                if (prefillModuleId) {
                    const moduleSelect = document.getElementById('moduleSelect');
                    if (moduleSelect) {
                        moduleSelect.value = prefillModuleId;
                        await onModuleChange();
                    }
                }
            }
        }
    } catch (e) {}
}

async function loadModulesByLibrary(libraryId) {
    if (!libraryId) return;
    try {
        const res = await aiApiPost('/api/modules/list', { libraryId: parseInt(libraryId), page: 1, pageSize: 100 });
        const select = document.getElementById('moduleSelect');
        select.innerHTML = '<option value="">请选择模块</option>';
        if (res.success) {
            const modules = res.modules || res.data?.modules || res.data || [];
            (Array.isArray(modules) ? modules : []).forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name;
                select.appendChild(opt);
            });
        }
    } catch (e) {}
}

async function onLibraryChange() {
    const libraryId = document.getElementById('librarySelect').value;
    aiCurrentLibraryId = libraryId ? parseInt(libraryId) : null;
    aiCurrentModuleId = null;
    aiSelectedFiles.clear();
    const moduleSelect = document.getElementById('moduleSelect');
    moduleSelect.innerHTML = '<option value="">请选择模块</option>';
    document.getElementById('fileList').innerHTML = '<div class="ai-empty"><div class="icon">📁</div><p>请先选择模块，然后从知识库选择文件</p></div>';
    if (aiCurrentLibraryId) {
        await loadModulesByLibrary(aiCurrentLibraryId);
    }
}

async function onModuleChange() {
    const moduleId = document.getElementById('moduleSelect').value;
    aiCurrentModuleId = moduleId ? parseInt(moduleId) : null;
    aiSelectedFiles.clear();
    if (aiCurrentModuleId) {
        await loadKnowledgeFiles();
        await loadAILevel1Points();
    } else {
        document.getElementById('fileList').innerHTML = '<div class="ai-empty"><div class="icon">📁</div><p>请先选择模块</p></div>';
    }
}

async function loadKnowledgeFiles() {
    if (!aiCurrentModuleId) return;
    try {
        const res = await aiApiGet(`/api/knowledge/files/${aiCurrentModuleId}`);
        if (res.success) {
            renderFileList(res.data);
        }
    } catch (e) {
        aiNotify('加载文件列表失败', 'error');
    }
}

function renderFileList(files) {
    const container = document.getElementById('fileList');
    if (!files || files.length === 0) {
        container.innerHTML = '<div class="ai-empty"><div class="icon">📁</div><p>暂无文件，请上传或从知识库管理中添加</p></div>';
        return;
    }

    container.innerHTML = files.map(f => {
        const isSelected = aiSelectedFiles.has(f.id);
        const icon = f.type === 'folder' ? '📁' : getFileIcon(f.file_ext);
        const statusBadge = f.type === 'file' ? getStatusBadge(f.parse_status) : '';
        const sizeStr = f.file_size ? aiFormatSize(f.file_size) : '';

        return `<div class="ai-file-item ${isSelected ? 'selected' : ''}" onclick="toggleFileSelection(${f.id})">
            <span class="ai-file-icon">${icon}</span>
            <div class="ai-file-info">
                <div class="ai-file-name">${aiEscapeHtml(f.name)}</div>
                <div class="ai-file-meta">${sizeStr} ${f.chunk_count ? `| ${f.chunk_count}块` : ''} ${statusBadge}</div>
            </div>
        </div>`;
    }).join('');
}

function getFileIcon(ext) {
    const icons = { docx: '📄', doc: '📄', xlsx: '📊', xls: '📊', pdf: '📕', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', md: '📝', txt: '📝' };
    return icons[ext] || '📄';
}

function getStatusBadge(status) {
    const map = { pending: '待解析', parsing: '解析中', parsed: '已解析 ✓', failed: '解析失败' };
    const cls = { pending: 'ai-status-pending', parsing: 'ai-status-parsing', parsed: 'ai-status-parsed', failed: 'ai-status-failed' };
    return `<span class="ai-status-badge ${cls[status] || ''}">${map[status] || status}</span>`;
}

function aiFormatSize(bytes) {
    if (bytes == null || bytes === 0) return '-';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function toggleFileSelection(fileId) {
    if (aiSelectedFiles.has(fileId)) {
        aiSelectedFiles.delete(fileId);
    } else {
        aiSelectedFiles.add(fileId);
    }
    updateFileRowSelection(fileId);
}

async function loadAILevel1Points() {
    if (!aiCurrentModuleId) return;
    try {
        const res = await aiApiGet(`/api/ai-generation/level1-points/${aiCurrentModuleId}`);
        if (res.success) {
            const points = res.data || [];
            const container = document.getElementById('existingLevel1List');
            container.innerHTML = points.map(p =>
                `<div class="ai-checkbox-item" data-name="${aiEscapeHtml(p.name).toLowerCase()}" onclick="toggleLevel1Item(this, ${p.id})">
                    <input type="checkbox" value="${p.id}" onchange="event.stopPropagation(); updateLevel1Count()">
                    <span>${aiEscapeHtml(p.name)} (${p.case_count}个用例)</span>
                </div>`
            ).join('');
            
            document.getElementById('level1TotalCount').textContent = `共: ${points.length}`;
            updateLevel1Count();
        }
    } catch (e) {}
}

function toggleLevel1Item(element, id) {
    const checkbox = element.querySelector('input[type="checkbox"]');
    checkbox.checked = !checkbox.checked;
    element.classList.toggle('active', checkbox.checked);
    updateLevel1Count();
}

function updateLevel1Count() {
    const checked = document.querySelectorAll('#existingLevel1List input[type="checkbox"]:checked').length;
    document.getElementById('level1SelectedCount').textContent = `已选: ${checked}`;
}

function filterLevel1Points() {
    const searchText = document.getElementById('level1SearchInput').value.toLowerCase();
    const items = document.querySelectorAll('#existingLevel1List .ai-checkbox-item');
    
    items.forEach(item => {
        const name = item.dataset.name || '';
        if (name.includes(searchText)) {
            item.classList.remove('filtered-out');
        } else {
            item.classList.add('filtered-out');
        }
    });
}

function selectAllLevel1() {
    const items = document.querySelectorAll('#existingLevel1List .ai-checkbox-item:not(.filtered-out)');
    items.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        checkbox.checked = true;
        item.classList.add('active');
    });
    updateLevel1Count();
}

function deselectAllLevel1() {
    const items = document.querySelectorAll('#existingLevel1List .ai-checkbox-item:not(.filtered-out)');
    items.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        checkbox.checked = false;
        item.classList.remove('active');
    });
    updateLevel1Count();
}

async function loadAgents() {
    try {
        const res = await aiApiGet('/api/ai-sub-agents/list?category=test_generation&is_enabled=true');
        const select = document.getElementById('agentSelect');
        if (res.success && res.data && res.data.length > 0) {
            select.innerHTML = '';
            let defaultSelected = false;
            (res.data || []).forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.textContent = a.displayName + (a.isSystem ? ' (内置)' : ' (自定义)');
                if (a.agentCode === 'generate_test_cases' && !defaultSelected) {
                    opt.selected = true;
                    defaultSelected = true;
                }
                select.appendChild(opt);
            });
            if (!defaultSelected && select.options.length > 0) {
                select.options[0].selected = true;
            }
        } else {
            select.innerHTML = '<option value="">暂无可用代理</option>';
        }
    } catch (e) {
        const select = document.getElementById('agentSelect');
        if (select) select.innerHTML = '<option value="">加载失败</option>';
    }
}

function selectLevel1Mode(mode) {
    currentLevel1Mode = mode;
    document.querySelectorAll('#level1ModeGroup .ai-radio-item').forEach(el => {
        el.classList.toggle('active', el.dataset.value === mode);
        const radio = el.querySelector('input[type="radio"]');
        if (radio) radio.checked = (radio.value === mode);
    });
    document.getElementById('existingLevel1Container').style.display = mode === 'existing' ? 'block' : 'none';
}

function selectMergeMode(mode) {
    currentMergeMode = mode;
    document.querySelectorAll('#mergeModeGroup .ai-radio-item').forEach(el => {
        el.classList.toggle('active', el.dataset.value === mode);
        const radio = el.querySelector('input[type="radio"]');
        if (radio) radio.checked = (radio.value === mode);
    });
    document.getElementById('reviewConfig').style.display = mode === 'review' ? 'block' : 'none';
}

async function showMergeModal() {
    if (selectedCases.size === 0) {
        aiNotify('请先选择要合并的用例', 'warning');
        return;
    }
    document.getElementById('mergeCaseCount').textContent = selectedCases.size;

    currentMergeMode = 'direct';
    document.querySelectorAll('#mergeModeGroup .ai-radio-item').forEach(el => {
        el.classList.toggle('active', el.dataset.value === 'direct');
        const radio = el.querySelector('input[type="radio"]');
        if (radio) radio.checked = (radio.value === 'direct');
    });
    document.getElementById('reviewConfig').style.display = 'none';

    try {
        const [usersRes, librariesRes] = await Promise.all([
            aiApiGet('/api/users/usernames'),
            aiApiGet('/api/libraries/list')
        ]);

        const mergeLibSelect = document.getElementById('mergeLibrarySelect');
        mergeLibSelect.innerHTML = '<option value="">请选择用例库</option>';
        if (librariesRes.success) {
            const libraries = librariesRes.libraries || librariesRes.data || [];
            libraries.forEach(lib => {
                const opt = document.createElement('option');
                opt.value = lib.id;
                opt.textContent = lib.name;
                mergeLibSelect.appendChild(opt);
            });
        }

        const reviewerList = document.getElementById('reviewerCheckboxList');
        reviewerList.innerHTML = '';
        if (usersRes.success && usersRes.usernames) {
            usersRes.usernames.filter(u => u !== 'admin').forEach(username => {
                const label = document.createElement('label');
                label.className = 'ai-checkbox-item';
                label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .15s;';
                label.onmouseover = function() { this.style.background = '#eef2ff'; };
                label.onmouseout = function() { this.style.background = ''; };
                label.innerHTML = `<input type="checkbox" value="${aiEscapeHtml(username)}" style="width:16px;height:16px;accent-color:var(--ai-primary);cursor:pointer;"><span style="font-size:14px;">${aiEscapeHtml(username)}</span>`;
                reviewerList.appendChild(label);
            });
        }
    } catch (e) {
        console.error('加载合并弹窗数据失败:', e);
    }

    initMergeModalDragResize();
    document.getElementById('aiGenOverlay').classList.add('show');
    document.getElementById('mergeModal').classList.add('open');
}

function closeMergeModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    const modal = document.getElementById('mergeModal');
    modal.classList.remove('open');
    modal.style.width = '';
    modal.style.height = '';
}

function initMergeModalDragResize() {
    const modal = document.getElementById('mergeModal');
    if (!modal || modal.dataset.dragInit === '1') return;
    modal.dataset.dragInit = '1';
    const resizer = modal.querySelector('.ai-modal-resizer');

    let isResizing = false;
    let resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;

    if (resizer) {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeStartW = modal.offsetWidth;
            resizeStartH = modal.offsetHeight;
            document.body.classList.add('ai-modal-resizing');
            e.preventDefault();
            e.stopPropagation();
        });
    }

    const handleMouseMove = (e) => {
        if (isResizing) {
            const newW = Math.max(450, resizeStartW + (e.clientX - resizeStartX));
            const newH = Math.max(350, resizeStartH + (e.clientY - resizeStartY));
            modal.style.width = Math.min(newW, window.innerWidth - 40) + 'px';
            modal.style.height = Math.min(newH, window.innerHeight - 40) + 'px';
        }
    };

    const handleMouseUp = () => {
        if (isResizing) {
            isResizing = false;
            document.body.classList.remove('ai-modal-resizing');
        }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

async function createTask() {
    if (!aiCurrentModuleId) {
        aiNotify('请先选择模块', 'warning');
        return;
    }

    const selectedLevel1Ids = [];
    if (currentLevel1Mode === 'existing') {
        document.querySelectorAll('#existingLevel1List input[type="checkbox"]:checked').forEach(cb => {
            selectedLevel1Ids.push(parseInt(cb.value));
        });
        if (selectedLevel1Ids.length === 0) {
            aiNotify('请选择至少一个一级测试点', 'warning');
            return;
        }
    }

    const data = {
        moduleId: aiCurrentModuleId,
        libraryId: document.getElementById('librarySelect').value || null,
        selectedFiles: Array.from(aiSelectedFiles),
        agentId: document.getElementById('agentSelect').value || null,
        caseCountLimit: parseInt(document.getElementById('caseCountLimit').value) || 20,
        enableDedup: document.getElementById('enableDedup').checked,
        similarityThreshold: parseInt(document.getElementById('similarityThreshold').value) / 100,
        level1Mode: currentLevel1Mode,
        selectedLevel1Ids
    };

    try {
        const res = await aiApiPost('/api/ai-generation/create', data);
        if (res.success) {
            aiCurrentTaskId = res.data.taskId;
            aiNotify('任务创建成功！', 'success');
            showProgressModal(aiCurrentTaskId);
            startProgressPolling(aiCurrentTaskId);
        } else {
            aiNotify(res.message || '创建任务失败', 'error');
        }
    } catch (e) {
        aiNotify('创建任务失败: ' + e.message, 'error');
    }
}

function showProgressModal(taskId) {
    document.getElementById('aiGenOverlay').classList.add('show');
    document.getElementById('progressModal').classList.add('open');
    document.getElementById('progressTaskId').textContent = `任务ID: ${taskId}`;
    resetProgressUI();
}

function resetProgressUI() {
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('stage' + i);
        el.className = 'ai-stage-icon ai-stage-waiting';
        el.textContent = i;
    }
    document.getElementById('statGenerated').textContent = '0';
    document.getElementById('statDuplicate').textContent = '0';
    document.getElementById('statEffective').textContent = '0';
}

function startProgressPolling(taskId) {
    if (aiProgressInterval) clearInterval(aiProgressInterval);
    aiProgressInterval = setInterval(async () => {
        try {
            const res = await aiApiGet(`/api/ai-generation/task/${taskId}`);
            if (res.success) {
                updateProgressUI(res.data);
                if (['completed', 'failed', 'cancelled'].includes(res.data.status)) {
                    clearInterval(aiProgressInterval);
                    aiProgressInterval = null;
                }
            }
        } catch (e) {}
    }, 3000);
}

function updateProgressUI(task) {
    const progress = task.progress || 0;
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('progressPercent').textContent = progress + '%';

    const stageMap = { init: 1, chunking: 2, mapping: 3, reducing: 4, finished: 5 };
    const currentStage = stageMap[task.stage] || 1;

    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('stage' + i);
        if (i < currentStage) {
            el.className = 'ai-stage-icon ai-stage-done';
            el.textContent = '✓';
        } else if (i === currentStage) {
            el.className = 'ai-stage-icon ai-stage-active';
            el.textContent = i;
        } else {
            el.className = 'ai-stage-icon ai-stage-waiting';
            el.textContent = i;
        }
    }

    if (task.stage === 'mapping') {
        document.getElementById('stage3Text').textContent = `AI生成用例 (${task.processed_chunks || 0}/${task.total_chunks || 0}块)`;
    }

    document.getElementById('statGenerated').textContent = task.total_cases || 0;
    document.getElementById('statDuplicate').textContent = task.duplicate_count || 0;
    document.getElementById('statEffective').textContent = (task.total_cases || 0) - (task.duplicate_count || 0);

    if (task.status === 'completed') {
        document.getElementById('stage5').className = 'ai-stage-icon ai-stage-done';
        document.getElementById('stage5').textContent = '✓';
        aiNotify('任务完成！正在加载用例...', 'success');
        clearInterval(aiProgressInterval);
        aiProgressInterval = null;
        setTimeout(() => {
            closeProgressModal();
            switchTab('preview', { taskId: task.task_id });
        }, 1500);
    } else if (task.status === 'failed') {
        aiNotify('任务失败: ' + (task.error_message || '未知错误'), 'error');
    }
}

function closeProgressModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    document.getElementById('progressModal').classList.remove('open');
}

async function cancelTask() {
    if (!aiCurrentTaskId) return;
    try {
        const res = await aiApiPost(`/api/ai-generation/cancel/${aiCurrentTaskId}`);
        if (res.success) {
            aiNotify('任务已取消', 'info');
            closeProgressModal();
        }
    } catch (e) {}
}

function openKnowledgeDrawer() {
    document.getElementById('aiGenOverlay').classList.add('show');
    document.getElementById('knowledgeDrawer').classList.add('open');
    initKnowledgeDrawerResize();
    
    const createFolderBtn = document.getElementById('createFolderBtn');
    const uploadFileBtn = document.getElementById('uploadFileBtn');
    
    if (aiCurrentModuleId) {
        createFolderBtn.disabled = false;
        uploadFileBtn.disabled = false;
        createFolderBtn.classList.remove('ai-btn-disabled');
        uploadFileBtn.classList.remove('ai-btn-disabled');
    } else {
        createFolderBtn.disabled = true;
        uploadFileBtn.disabled = true;
        createFolderBtn.classList.add('ai-btn-disabled');
        uploadFileBtn.classList.add('ai-btn-disabled');
    }
    
    loadKnowledgeTree();
}

function closeKnowledgeDrawer() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    document.getElementById('knowledgeDrawer').classList.remove('open');
}

function initKnowledgeDrawerResize() {
    const drawer = document.getElementById('knowledgeDrawer');
    const handle = document.getElementById('ai-drawer-resize-handle');
    if (!drawer || !handle) return;
    if (handle.dataset.resizeInit === '1') return;
    handle.dataset.resizeInit = '1';

    let isResizing = false;

    const handleMouseDown = (e) => {
        isResizing = true;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    };

    const handleMouseMove = (e) => {
        if (!isResizing) return;
        const newWidth = window.innerWidth - e.clientX;
        const minWidth = 400;
        const maxWidth = Math.round(window.innerWidth * 0.9);
        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        drawer.style.width = clampedWidth + 'px';
    };

    const handleMouseUp = () => {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

let knowledgeSortColumn = 'name';
let knowledgeSortDirection = 'asc';
let knowledgeTreeData = null;

async function loadKnowledgeTree() {
    try {
        let tree;
        if (aiCurrentModuleId) {
            const res = await aiApiGet(`/api/knowledge/tree/${aiCurrentModuleId}`);
            if (res.success) {
                tree = res.data;
            }
        } else {
            const res = await aiApiGet('/api/knowledge/global-tree');
            if (res.success) {
                tree = res.data;
            }
        }
        knowledgeTreeData = tree;
        renderKnowledgeTree(tree);
    } catch (e) {}
}

function renderKnowledgeTree(tree, container = null) {
    const el = container || document.getElementById('knowledgeTree');
    if (!tree || tree.length === 0) {
        el.innerHTML = '<div class="ai-knowledge-empty"><div class="icon">📁</div><p>知识库为空，请上传文件</p></div>';
        updateSelectionCount();
        return;
    }

    if (!container) {
        el.innerHTML = tree.map(node => {
            if (node.type === 'library') {
                const childCount = countFiles(node.children);
                return `<div class="ai-knowledge-group" id="group-library-${node.id}">
                    <div class="ai-knowledge-group-header" onclick="toggleKnowledgeGroup('library-${node.id}')">
                        <span><span class="group-icon">📚</span>${aiEscapeHtml(node.name)}<span class="group-count">${childCount} 个文件</span></span>
                        <span class="expand-icon">▼</span>
                    </div>
                    <div class="ai-knowledge-list" id="library-${node.id}"></div>
                </div>`;
            } else if (node.type === 'module') {
                const childCount = countFiles(node.children);
                return `<div class="ai-knowledge-group" id="group-module-${node.id}">
                    <div class="ai-knowledge-group-header" onclick="toggleKnowledgeGroup('module-${node.id}')">
                        <span><span class="group-icon">📦</span>${aiEscapeHtml(node.name)}<span class="group-count">${childCount} 个文件</span></span>
                        <span class="expand-icon">▼</span>
                    </div>
                    <div class="ai-knowledge-list" id="module-${node.id}"></div>
                </div>`;
            } else if (node.type === 'folder') {
                const childCount = countFiles(node.children);
                return `<div class="ai-knowledge-group" id="group-folder-${node.id}">
                    <div class="ai-knowledge-group-header" onclick="toggleKnowledgeGroup('folder-${node.id}')">
                        <span><span class="group-icon">📁</span>${aiEscapeHtml(node.name)}<span class="group-count">${childCount} 个文件</span></span>
                        <span class="expand-icon">▼</span>
                    </div>
                    <div class="ai-knowledge-list" id="folder-${node.id}"></div>
                </div>`;
            } else {
                return renderKnowledgeRow(node);
            }
        }).join('');

        tree.filter(n => n.type === 'library' && n.children).forEach(lib => {
            const libEl = document.getElementById('library-' + lib.id);
            if (libEl) renderKnowledgeList(lib.children, libEl);
        });

        tree.filter(n => n.type === 'module' && n.children).forEach(mod => {
            const modEl = document.getElementById('module-' + mod.id);
            if (modEl) renderKnowledgeList(mod.children, modEl);
        });

        tree.filter(n => n.type === 'folder' && n.children).forEach(folder => {
            const folderEl = document.getElementById('folder-' + folder.id);
            if (folderEl) renderKnowledgeList(folder.children, folderEl);
        });
    } else {
        renderKnowledgeList(tree, el);
    }
    updateSelectionCount();
}

function renderKnowledgeList(items, container) {
    if (!items || items.length === 0) {
        container.innerHTML = '';
        return;
    }

    const modules = items.filter(n => n.type === 'module');
    const folders = items.filter(n => n.type === 'folder');
    const files = items.filter(n => n.type !== 'folder' && n.type !== 'library' && n.type !== 'module');

    let html = '';

    if (modules.length > 0 || folders.length > 0 || files.length > 0) {
        html = `<div class="ai-knowledge-list-header">
            <div class="col col-checkbox"></div>
            <div class="col sortable ${knowledgeSortColumn === 'name' ? (knowledgeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" onclick="sortKnowledgeList('name')">名称</div>
            <div class="col sortable ${knowledgeSortColumn === 'type' ? (knowledgeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" onclick="sortKnowledgeList('type')">类型</div>
            <div class="col sortable ${knowledgeSortColumn === 'size' ? (knowledgeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" onclick="sortKnowledgeList('size')">大小</div>
            <div class="col sortable ${knowledgeSortColumn === 'status' ? (knowledgeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" onclick="sortKnowledgeList('status')">状态</div>
            <div class="col">操作</div>
        </div>
        <div class="ai-knowledge-list-body">`;
    }

    modules.forEach(mod => {
        const childCount = countFiles(mod.children);
        html += `<div class="ai-knowledge-row folder-row" onclick="toggleKnowledgeGroup('module-${mod.id}')">
            <div class="col-checkbox"></div>
            <div class="col-name">
                <span class="file-icon">📦</span>
                <span class="file-name">${aiEscapeHtml(mod.name)}</span>
                <span class="folder-indicator">(${childCount})</span>
            </div>
            <div class="col-type">模块</div>
            <div class="col-size">-</div>
            <div class="col-status">-</div>
            <div class="col-actions"></div>
        </div>
        <div class="ai-knowledge-list" id="module-${mod.id}" style="display:none;margin-left:16px;margin-top:4px;margin-bottom:4px;"></div>`;
    });

    folders.forEach(folder => {
        const childCount = countFiles(folder.children);
        html += `<div class="ai-knowledge-row folder-row" onclick="toggleKnowledgeGroup('folder-${folder.id}')">
            <div class="col-checkbox"></div>
            <div class="col-name">
                <span class="file-icon">📁</span>
                <span class="file-name">${aiEscapeHtml(folder.name)}</span>
                <span class="folder-indicator">(${childCount})</span>
            </div>
            <div class="col-type">文件夹</div>
            <div class="col-size">-</div>
            <div class="col-status">-</div>
            <div class="col-actions">
                <button class="action-btn" onclick="event.stopPropagation();deleteKnowledgeFile(${folder.id})" title="删除">🗑️</button>
            </div>
        </div>
        <div class="ai-knowledge-list" id="folder-${folder.id}" style="display:none;margin-left:16px;margin-top:4px;margin-bottom:4px;"></div>`;
    });

    const sortedFiles = sortKnowledgeFiles(files);
    sortedFiles.forEach(file => {
        html += renderKnowledgeRow(file);
    });

    if (modules.length > 0 || folders.length > 0 || files.length > 0) {
        html += '</div>';
    }
    container.innerHTML = html;

    modules.forEach(mod => {
        if (mod.children && mod.children.length > 0) {
            const modEl = document.getElementById('module-' + mod.id);
            if (modEl) renderKnowledgeList(mod.children, modEl);
        }
    });

    folders.forEach(folder => {
        if (folder.children && folder.children.length > 0) {
            const folderEl = document.getElementById('folder-' + folder.id);
            if (folderEl) renderKnowledgeList(folder.children, folderEl);
        }
    });
}

function renderKnowledgeRow(file) {
    const icon = getFileIcon(file.fileExt || file.file_ext);
    const statusBadge = getStatusBadge(file.parseStatus || file.parse_status);
    const isSelected = aiSelectedFiles.has(file.id);
    const fileType = (file.fileExt || file.file_ext || '').toUpperCase() || '文件';
    const fileSize = file.fileSize || file.file_size ? aiFormatSize(file.fileSize || file.file_size) : '-';

    return `<div class="ai-knowledge-row ${isSelected ? 'selected' : ''}" data-file-id="${file.id}" data-name="${aiEscapeHtml(file.name).toLowerCase()}" data-type="${fileType}" data-size="${file.fileSize || file.file_size || 0}" data-status="${file.parseStatus || file.parse_status || ''}">
        <div class="col-checkbox">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation();toggleFileSelection(${file.id});updateFileRowSelection(${file.id});">
        </div>
        <div class="col-name" onclick="event.stopPropagation();toggleFileSelection(${file.id});updateFileRowSelection(${file.id});">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${aiEscapeHtml(file.name)}</span>
        </div>
        <div class="col-type">${fileType}</div>
        <div class="col-size">${fileSize}</div>
        <div class="col-status">${statusBadge}</div>
        <div class="col-actions">
            <button class="action-btn" onclick="event.stopPropagation();viewFileContent(${file.id})" title="查看">👁️</button>
            <button class="action-btn" onclick="event.stopPropagation();deleteKnowledgeFile(${file.id})" title="删除">🗑️</button>
        </div>
    </div>`;
}

function countFiles(items) {
    if (!items) return 0;
    let count = 0;
    items.forEach(item => {
        if (item.type === 'folder') {
            count += countFiles(item.children);
        } else if (item.type !== 'library' && item.type !== 'module') {
            count++;
        }
    });
    return count;
}

function toggleKnowledgeGroup(groupId) {
    const groupEl = document.getElementById('group-' + groupId);
    const listEl = document.getElementById(groupId);
    if (groupEl) {
        groupEl.classList.toggle('collapsed');
    }
    if (listEl) {
        listEl.style.display = listEl.style.display === 'none' ? '' : 'none';
    }
}

function sortKnowledgeList(column) {
    if (knowledgeSortColumn === column) {
        knowledgeSortDirection = knowledgeSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        knowledgeSortColumn = column;
        knowledgeSortDirection = 'asc';
    }
    renderKnowledgeTree(knowledgeTreeData);
}

function sortKnowledgeFiles(files) {
    return [...files].sort((a, b) => {
        let valA, valB;
        switch (knowledgeSortColumn) {
            case 'name':
                valA = (a.name || '').toLowerCase();
                valB = (b.name || '').toLowerCase();
                break;
            case 'type':
                valA = (a.fileExt || a.file_ext || '').toLowerCase();
                valB = (b.fileExt || b.file_ext || '').toLowerCase();
                break;
            case 'size':
                valA = a.fileSize || a.file_size || 0;
                valB = b.fileSize || b.file_size || 0;
                break;
            case 'status':
                valA = a.parseStatus || a.parse_status || '';
                valB = b.parseStatus || b.parse_status || '';
                break;
            default:
                return 0;
        }
        if (valA < valB) return knowledgeSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return knowledgeSortDirection === 'asc' ? 1 : -1;
        return 0;
    });
}

function filterKnowledgeList() {
    const searchText = document.getElementById('knowledgeSearchInput').value.toLowerCase();
    const rows = document.querySelectorAll('#ai-generation-section .ai-knowledge-row');
    rows.forEach(row => {
        const name = row.dataset.name || '';
        if (name.includes(searchText)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

function updateSelectionCount() {
    const count = aiSelectedFiles.size;
    const countEl = document.getElementById('knowledgeSelectionCount');
    if (countEl) {
        countEl.textContent = `已选择 ${count} 个文件`;
    }
}

function updateFileRowSelection(fileId) {
    const row = document.querySelector(`#ai-generation-section .ai-knowledge-row[data-file-id="${fileId}"]`);
    if (row) {
        row.classList.toggle('selected', aiSelectedFiles.has(fileId));
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) {
            checkbox.checked = aiSelectedFiles.has(fileId);
        }
    }
    updateSelectionCount();
}

function createFolder() {
    document.getElementById('aiNewFolderName').value = '';
    document.getElementById('aiGenOverlay').classList.add('show');
    document.getElementById('createFolderModal').classList.add('open');
    setTimeout(() => document.getElementById('aiNewFolderName').focus(), 100);
}

function closeCreateFolderModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    document.getElementById('createFolderModal').classList.remove('open');
}

async function confirmCreateFolder() {
    const name = document.getElementById('aiNewFolderName').value.trim();
    if (!name) {
        aiNotify('请输入文件夹名称', 'warning');
        return;
    }
    try {
        await aiApiPost('/api/knowledge/folder', { moduleId: aiCurrentModuleId, parentId: aiCurrentParentId || null, name });
        closeCreateFolderModal();
        loadKnowledgeTree();
        aiNotify('文件夹创建成功', 'success');
    } catch (e) {
        aiNotify(e.message || '创建失败', 'error');
    }
}

function triggerUpload() {
    document.getElementById('aiFileInput').click();
}

async function handleFileUpload() {
    const files = document.getElementById('aiFileInput').files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        if (aiCurrentModuleId) {
            formData.append('moduleId', aiCurrentModuleId);
        }
        if (aiCurrentParentId) {
            formData.append('parentId', aiCurrentParentId);
        }

        try {
            const token = localStorage.getItem('authToken') || localStorage.getItem('token');
            const res = await fetch(AI_API_BASE + '/api/knowledge/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const result = await res.json();
            if (result.success) {
                if (result.data?.hasConflict) {
                    conflictFileData = { file, result };
                    showConflictModal(file.name, result.data.existingFile);
                } else {
                    aiNotify(`${file.name} 上传成功`, 'success');
                }
            } else {
                aiNotify(`${file.name} 上传失败: ${result.message}`, 'error');
            }
        } catch (e) {
            aiNotify(`${file.name} 上传失败: ${e.message}`, 'error');
        }
    }

    document.getElementById('aiFileInput').value = '';
    loadKnowledgeTree();
    loadKnowledgeFiles();
}

function showConflictModal(fileName, existingFile) {
    document.getElementById('conflictMessage').textContent = `当前目录下已存在文件 "${fileName}"，上传时间: ${existingFile.created_at}`;
    document.getElementById('aiGenOverlay').classList.add('show');
    document.getElementById('conflictModal').classList.add('open');
}

function closeConflictModal() {
    document.getElementById('conflictModal').classList.remove('open');
    conflictFileData = null;
}

function selectConflictAction(action) {
    document.querySelectorAll('#conflictOptions .ai-radio-item').forEach(el => {
        el.classList.toggle('active', el.dataset.value === action);
        const radio = el.querySelector('input[type="radio"]');
        if (radio) radio.checked = (radio.value === action);
    });
}

async function resolveConflict() {
    if (!conflictFileData) return;
    const action = document.querySelector('#conflictOptions .ai-radio-item.active')?.dataset.value || 'coexist';
    const formData = new FormData();
    formData.append('file', conflictFileData.file);
    if (aiCurrentModuleId) {
        formData.append('moduleId', aiCurrentModuleId);
    }
    formData.append('conflictAction', action);
    if (aiCurrentParentId) {
        formData.append('parentId', aiCurrentParentId);
    }

    try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch(AI_API_BASE + '/api/knowledge/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (result.success) {
            aiNotify('文件处理成功', 'success');
            closeConflictModal();
            loadKnowledgeTree();
            loadKnowledgeFiles();
        } else {
            aiNotify(result.message || '文件处理失败', 'error');
        }
    } catch (e) {
        aiNotify('文件处理失败: ' + e.message, 'error');
    }
}

async function viewFileContent(fileId) {
    try {
        const res = await aiApiGet(`/api/knowledge/file/content/${fileId}`);
        if (res.success) {
            document.getElementById('fileContentTitle').textContent = `📄 ${res.data.name}`;
            if (res.data.type === 'binary' || res.data.content === null) {
                document.getElementById('fileContentBody').textContent = '(此文件为二进制格式，不支持文本预览)';
            } else {
                document.getElementById('fileContentBody').textContent = res.data.content || '(文件内容为空或无法以文本形式显示)';
            }
            document.getElementById('aiGenOverlay').classList.add('show');
            document.getElementById('fileContentModal').classList.add('open');
        } else {
            aiNotify(res.message || '无法读取文件内容', 'error');
        }
    } catch (e) {
        aiNotify('读取文件内容失败', 'error');
    }
}

function closeFileContentModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    document.getElementById('fileContentModal').classList.remove('open');
}

async function deleteKnowledgeFile(fileId) {
    if (!(await aiShowConfirmMessage('确定要删除吗？'))) return;
    try {
        const moduleId = aiCurrentModuleId || document.getElementById('moduleSelect').value;
        if (!moduleId) { aiNotify('请先选择模块', 'warning'); return; }
        const params = new URLSearchParams();
        params.set('moduleId', moduleId);
        await aiApiDelete(`/api/knowledge/file/${fileId}?${params.toString()}`);
        aiSelectedFiles.delete(fileId);
        loadKnowledgeTree();
        loadKnowledgeFiles();
        aiNotify('删除成功', 'success');
    } catch (e) {}
}

function confirmFileSelection() {
    loadKnowledgeFiles();
    closeKnowledgeDrawer();
}

async function loadTaskFilter() {
    try {
        const res = await aiApiGet('/api/ai-generation/tasks?limit=50');
        if (res.success) {
            const select = document.getElementById('taskFilter');
            const prevValue = select.value;
            select.innerHTML = '<option value="all">全部未合并用例</option>';
            (res.data.tasks || []).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.task_id;
                opt.textContent = `${t.task_id} - ${t.module_name} (${t.status})`;
                select.appendChild(opt);
            });
            if (prevValue) {
                select.value = prevValue;
            }
        }
    } catch (e) {}
}

async function loadTempCases() {
    await loadTempCasesPage();
}

async function loadTempCasesPage() {
    const taskFilter = document.getElementById('taskFilter');
    const filterValue = taskFilter.value;
    if (!filterValue) {
        allTempCases = [];
        renderCaseTable([]);
        return;
    }

    try {
        const search = document.getElementById('caseSearch').value;
        const statusFilter = document.getElementById('statusFilter').value;
        const duplicateFilter = document.getElementById('duplicateFilter').value;

        let params = new URLSearchParams();
        params.set('pageSize', '9999');
        if (search) params.set('search', search);
        if (statusFilter) params.set('status', statusFilter);
        if (duplicateFilter !== '') params.set('isDuplicate', duplicateFilter);

        let res;
        if (filterValue === 'all') {
            res = await aiApiGet(`/api/temp-cases/all-active?${params.toString()}`);
        } else {
            res = await aiApiGet(`/api/temp-cases/list/${filterValue}?${params.toString()}`);
        }
        if (res.success) {
            allTempCases = res.data.cases || [];
            caseTotal = res.data.total || 0;
            renderCaseStats(res.data.stats);
            renderCaseTable(allTempCases);
            updateSelectedCount();
        }
    } catch (e) {}
}

function renderCaseStats(stats) {
    if (!stats) return;
    document.getElementById('caseStats').innerHTML = `
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.total || 0}</div><div class="ai-stat-label">总计</div></div>
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.pending || 0}</div><div class="ai-stat-label">待确认</div></div>
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.approved || 0}</div><div class="ai-stat-label">已批准</div></div>
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.duplicate || 0}</div><div class="ai-stat-label">重复</div></div>
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.merged || 0}</div><div class="ai-stat-label">已合并</div></div>
    `;
}

function renderCaseTable(cases) {
    const data = cases || allTempCases;
    const tbody = document.getElementById('caseTreeTableBody');
    if (!tbody) return;

    const libraryGroups = new Map();
    data.forEach(c => {
        const libKey = c.library_name || '未分类';
        if (!libraryGroups.has(libKey)) libraryGroups.set(libKey, new Map());
        const modKey = c.module_name || '未分类';
        if (!libraryGroups.get(libKey).has(modKey)) libraryGroups.get(libKey).set(modKey, new Map());
        const l1Key = c.level1_name || '未分类';
        if (!libraryGroups.get(libKey).get(modKey).has(l1Key)) libraryGroups.get(libKey).get(modKey).set(l1Key, []);
        libraryGroups.get(libKey).get(modKey).get(l1Key).push(c);
    });

    const statusMap = { pending: '待确认', approved: '已批准', rejected: '已拒绝', merged: '已合并' };
    let rows = '';

    function calcStats(arr) {
        let pending = 0, approved = 0, rejected = 0, duplicate = 0, merged = 0;
        arr.forEach(c => {
            if (c.status === 'pending') pending++;
            else if (c.status === 'approved') approved++;
            else if (c.status === 'rejected') rejected++;
            else if (c.status === 'merged') merged++;
            if (c.is_duplicate) duplicate++;
        });
        return { pending, approved, rejected, duplicate, merged, total: arr.length };
    }

    function statsBadges(s) {
        return `<span class="ai-tree-summary-badges">
            ${s.pending ? `<span class="ai-tree-summary-badge s-pending">${s.pending} 待确认</span>` : ''}
            ${s.approved ? `<span class="ai-tree-summary-badge s-approved">${s.approved} 已批准</span>` : ''}
            ${s.rejected ? `<span class="ai-tree-summary-badge s-rejected">${s.rejected} 已拒绝</span>` : ''}
            ${s.duplicate ? `<span class="ai-tree-summary-badge s-duplicate">${s.duplicate} 重复</span>` : ''}
            ${s.merged ? `<span class="ai-tree-summary-badge s-merged">${s.merged} 已合并</span>` : ''}
        </span>`;
    }

    function allCasesIn(modMap) {
        const arr = [];
        modMap.forEach(l1Map => l1Map.forEach(cases => arr.push(...cases)));
        return arr;
    }

    const caseSubHeader = (l1Key, modKey) => `<tr class="ai-tree-sub-header ai-tree-case-sub-header" data-type="case-header" data-l1-key="${aiEscapeHtml(l1Key)}" data-mod-key="${aiEscapeHtml(modKey)}">
        <th class="col-checkbox"></th>
        <th class="col-name">用例名称</th>
        <th class="col-purpose">测试目的</th>
        <th class="col-priority">优先级</th>
        <th class="col-type">类型</th>
        <th class="col-similarity">相似度</th>
        <th class="col-status">状态</th>
        <th class="col-time">生成时间</th>
        <th class="col-actions">操作</th>
    </tr>`;

    libraryGroups.forEach((modMap, libName) => {
        if (!expandedLibraries.has(libName)) expandedLibraries.add(libName);
        modMap.forEach((l1Map, modName) => {
            const modKey = libName + '::' + modName;
            if (!expandedModules.has(modKey)) expandedModules.add(modKey);
        });
    });

    libraryGroups.forEach((modMap, libName) => {
        const libExpanded = expandedLibraries.has(libName);
        const libAll = allCasesIn(modMap);
        const libStats = calcStats(libAll);
        const libChecked = libAll.every(c => selectedCases.has(c.temp_case_id));
        const libSome = libAll.some(c => selectedCases.has(c.temp_case_id));

        rows += `<tr class="ai-tree-group-row" data-lib="${aiEscapeHtml(libName)}" data-type="library">
            <td class="col-checkbox"><input type="checkbox" class="ai-tree-checkbox" ${libChecked ? 'checked' : ''} ${libSome && !libChecked ? 'style="opacity:0.5"' : ''} data-lib-check="${aiEscapeHtml(libName)}"></td>
            <td class="col-name" colspan="8">
                <div class="ai-tree-name-cell">
                    <span class="ai-tree-toggle ${libExpanded ? 'expanded' : ''}" data-lib-toggle="${aiEscapeHtml(libName)}">${libExpanded ? '▼' : '▶'}</span>
                    📁 ${aiEscapeHtml(libName)}
                    <span class="ai-tree-group-count">${libStats.total}</span>
                    ${statsBadges(libStats)}
                </div>
            </td>
        </tr>`;

        const libSubHeader = `<tr class="ai-tree-sub-header ai-tree-module-sub-header ${libExpanded ? '' : 'ai-tree-row-hidden'}" data-lib="${aiEscapeHtml(libName)}" data-type="module-header">
            <th class="col-checkbox"></th>
            <th class="col-name">模块名称</th>
            <th class="col-purpose" colspan="2">用例数</th>
            <th class="col-type" colspan="5">状态统计</th>
        </tr>`;

        if (libExpanded) {
            rows += libSubHeader;
        }

        modMap.forEach((l1Map, modName) => {
            const modKey = libName + '::' + modName;
            const modExpanded = expandedModules.has(modKey);
            const modAll = [];
            l1Map.forEach(cases => modAll.push(...cases));
            const modStats = calcStats(modAll);
            const modChecked = modAll.every(c => selectedCases.has(c.temp_case_id));
            const modSome = modAll.some(c => selectedCases.has(c.temp_case_id));

            rows += `<tr class="ai-tree-module-row ${libExpanded ? '' : 'ai-tree-row-hidden'}" data-lib="${aiEscapeHtml(libName)}" data-module="${aiEscapeHtml(modName)}" data-type="module" data-mod-key="${aiEscapeHtml(modKey)}">
                <td class="col-checkbox"><input type="checkbox" class="ai-tree-checkbox" ${modChecked ? 'checked' : ''} ${modSome && !modChecked ? 'style="opacity:0.5"' : ''} data-mod-check="${aiEscapeHtml(modKey)}"></td>
                <td class="col-name" colspan="8">
                    <div class="ai-tree-name-cell">
                        <span class="ai-tree-indent"></span>
                        <span class="ai-tree-toggle ${modExpanded ? 'expanded' : ''}" data-mod-toggle="${aiEscapeHtml(modKey)}">${modExpanded ? '▼' : '▶'}</span>
                        📦 ${aiEscapeHtml(modName)}
                        <span class="ai-tree-module-count">${modStats.total}</span>
                        ${statsBadges(modStats)}
                    </div>
                </td>
            </tr>`;

            const modSubHeader = `<tr class="ai-tree-sub-header ai-tree-level1-sub-header ${libExpanded && modExpanded ? '' : 'ai-tree-row-hidden'}" data-lib="${aiEscapeHtml(libName)}" data-module="${aiEscapeHtml(modName)}" data-type="level1-header" data-mod-key="${aiEscapeHtml(modKey)}">
                <th class="col-checkbox"></th>
                <th class="col-name">一级测试点</th>
                <th class="col-purpose" colspan="2">用例数</th>
                <th class="col-type" colspan="5">状态统计</th>
            </tr>`;

            if (libExpanded && modExpanded) {
                rows += modSubHeader;
            }

            l1Map.forEach((cases, level1Name) => {
                const l1Key = modKey + '::' + level1Name;
                const l1Expanded = expandedLevel1s.has(l1Key);
                const l1Stats = calcStats(cases);
                const l1Checked = cases.every(c => selectedCases.has(c.temp_case_id));
                const l1Some = cases.some(c => selectedCases.has(c.temp_case_id));

                rows += `<tr class="ai-tree-level1-row ${libExpanded && modExpanded ? '' : 'ai-tree-row-hidden'}" data-lib="${aiEscapeHtml(libName)}" data-module="${aiEscapeHtml(modName)}" data-level1="${aiEscapeHtml(level1Name)}" data-type="level1" data-l1-key="${aiEscapeHtml(l1Key)}" data-mod-key="${aiEscapeHtml(modKey)}">
                    <td class="col-checkbox"><input type="checkbox" class="ai-tree-checkbox" ${l1Checked ? 'checked' : ''} ${l1Some && !l1Checked ? 'style="opacity:0.5"' : ''} data-l1-check="${aiEscapeHtml(l1Key)}"></td>
                    <td class="col-name" colspan="8">
                        <div class="ai-tree-name-cell">
                            <span class="ai-tree-indent"></span>
                            <span class="ai-tree-indent"></span>
                            <span class="ai-tree-toggle ${l1Expanded ? 'expanded' : ''}" data-l1-toggle="${aiEscapeHtml(l1Key)}">${l1Expanded ? '▼' : '▶'}</span>
                            📂 ${aiEscapeHtml(level1Name)}
                            <span class="ai-tree-level1-count">${l1Stats.total}</span>
                            ${statsBadges(l1Stats)}
                        </div>
                    </td>
                </tr>`;

                if (libExpanded && modExpanded && l1Expanded) {
                    rows += caseSubHeader(l1Key, modKey);
                }

                cases.forEach(c => {
                    const priorityClass = c.priority === '高' ? 'ai-tag-high' : c.priority === '低' ? 'ai-tag-low' : 'ai-tag-medium';
                    const statusClass = `ai-status-${c.status}`;
                    const duplicateTag = c.is_duplicate ? `<span class="ai-status-badge ai-status-duplicate">⚠️ ${c.duplicate_score}%</span>` : '-';
                    const checked = selectedCases.has(c.temp_case_id) ? 'checked' : '';
                    const visible = libExpanded && modExpanded && l1Expanded;
                    const purposeText = c.purpose ? aiEscapeHtml(c.purpose.length > 80 ? c.purpose.substring(0, 80) + '...' : c.purpose) : '-';
                    const timeText = aiFormatDateTime(c.created_at);

                    rows += `<tr class="ai-tree-case-row ${visible ? '' : 'ai-tree-row-hidden'}" data-lib="${aiEscapeHtml(libName)}" data-module="${aiEscapeHtml(modName)}" data-level1="${aiEscapeHtml(level1Name)}" data-type="case" data-case-id="${aiEscapeHtml(c.temp_case_id)}" data-l1-key="${aiEscapeHtml(l1Key)}" data-mod-key="${aiEscapeHtml(modKey)}">
                        <td class="col-checkbox"><input type="checkbox" class="ai-tree-checkbox" ${checked} data-case-check="${aiEscapeHtml(c.temp_case_id)}"></td>
                        <td class="col-name">
                            <div class="ai-tree-name-cell">
                                <span class="ai-tree-indent"></span>
                                <span class="ai-tree-indent"></span>
                                <span class="ai-tree-indent"></span>
                                <a href="javascript:void(0)" class="ai-tree-case-name" data-view-case="${aiEscapeHtml(c.temp_case_id)}">${aiEscapeHtml(c.name)}</a>
                            </div>
                        </td>
                        <td class="col-purpose" title="${aiEscapeHtml(c.purpose || '')}">${purposeText}</td>
                        <td class="col-priority"><span class="ai-tag ${priorityClass}">${aiEscapeHtml(c.priority)}</span></td>
                        <td class="col-type" style="font-size:12px;">${aiEscapeHtml(c.type)}</td>
                        <td class="col-similarity">${duplicateTag}</td>
                        <td class="col-status"><span class="ai-status-badge ${statusClass}">${statusMap[c.status] || aiEscapeHtml(c.status)}</span></td>
                        <td class="col-time">${timeText}</td>
                        <td class="col-actions">
                            <div class="ai-tree-actions-cell">
                                <button class="ai-btn ai-btn-sm ai-btn-ghost" data-view-case="${aiEscapeHtml(c.temp_case_id)}">👁️</button>
                                <button class="ai-btn ai-btn-sm ai-btn-ghost" data-edit-case="${aiEscapeHtml(c.temp_case_id)}">✏️</button>
                                <button class="ai-btn ai-btn-sm ai-btn-ghost" data-delete-case="${aiEscapeHtml(c.temp_case_id)}">🗑️</button>
                            </div>
                        </td>
                    </tr>`;
                });
            });
        });
    });

    if (data.length === 0) {
        rows = `<tr class="ai-tree-case-row"><td colspan="9" style="text-align:center;color:var(--ai-text-secondary);padding:40px;">暂无临时用例</td></tr>`;
    }

    tbody.innerHTML = rows;
}

function filterCases() { loadTempCasesPage(1); }

function toggleCaseSelection(tempCaseId) {
    if (selectedCases.has(tempCaseId)) selectedCases.delete(tempCaseId);
    else selectedCases.add(tempCaseId);
    updateSelectedCount();
}

function toggleSelectAll() {
    const checked = document.getElementById('selectAll').checked;
    if (checked) {
        allTempCases.forEach(c => selectedCases.add(c.temp_case_id));
    } else {
        allTempCases.forEach(c => selectedCases.delete(c.temp_case_id));
    }
    document.querySelectorAll('[data-case-check]').forEach(cb => { cb.checked = checked; });
    document.querySelectorAll('[data-l1-check]').forEach(cb => { cb.checked = checked; cb.style.opacity = ''; });
    document.querySelectorAll('[data-mod-check]').forEach(cb => { cb.checked = checked; cb.style.opacity = ''; });
    document.querySelectorAll('[data-lib-check]').forEach(cb => { cb.checked = checked; cb.style.opacity = ''; });
    updateSelectedCount();
}

function clearAllSelections() {
    selectedCases.clear();
    document.querySelectorAll('[data-case-check]').forEach(cb => { cb.checked = false; });
    document.querySelectorAll('[data-l1-check]').forEach(cb => { cb.checked = false; cb.style.opacity = ''; });
    document.querySelectorAll('[data-mod-check]').forEach(cb => { cb.checked = false; cb.style.opacity = ''; });
    document.querySelectorAll('[data-lib-check]').forEach(cb => { cb.checked = false; cb.style.opacity = ''; });
    updateSelectedCount();
}

function toggleLibraryExpand(libName) {
    if (expandedLibraries.has(libName)) expandedLibraries.delete(libName);
    else expandedLibraries.add(libName);

    const isExpanded = expandedLibraries.has(libName);
    const toggleEl = document.querySelector(`[data-lib-toggle="${CSS.escape(libName)}"]`);
    if (toggleEl) {
        toggleEl.textContent = isExpanded ? '▼' : '▶';
        toggleEl.classList.toggle('expanded', isExpanded);
    }

    const libRow = document.querySelector(`.ai-tree-group-row[data-lib="${CSS.escape(libName)}"]`);
    if (!libRow) return;

    let sibling = libRow.nextElementSibling;
    while (sibling && !sibling.classList.contains('ai-tree-group-row')) {
        if (sibling.dataset.type === 'module-header' && sibling.dataset.lib === libName) {
            sibling.classList.toggle('ai-tree-row-hidden', !isExpanded);
        }
        if (sibling.dataset.type === 'module') {
            sibling.classList.toggle('ai-tree-row-hidden', !isExpanded);
            if (isExpanded) {
                const modKey = sibling.dataset.modKey;
                const modExpanded = expandedModules.has(modKey);
                const modToggle = sibling.querySelector('.ai-tree-toggle');
                if (modToggle) {
                    modToggle.textContent = modExpanded ? '▼' : '▶';
                    modToggle.classList.toggle('expanded', modExpanded);
                }
            }
        }
        if (sibling.dataset.type === 'level1-header') {
            if (isExpanded) {
                const modKey = sibling.dataset.modKey;
                const modExpanded = expandedModules.has(modKey);
                sibling.classList.toggle('ai-tree-row-hidden', !modExpanded);
            } else {
                sibling.classList.add('ai-tree-row-hidden');
            }
        }
        if (sibling.dataset.type === 'level1') {
            if (isExpanded) {
                const modKey = sibling.dataset.modKey;
                const modExpanded = expandedModules.has(modKey);
                sibling.classList.toggle('ai-tree-row-hidden', !modExpanded);
                if (modExpanded) {
                    const l1Key = sibling.dataset.l1Key;
                    const l1Expanded = expandedLevel1s.has(l1Key);
                    const l1Toggle = sibling.querySelector('.ai-tree-toggle');
                    if (l1Toggle) {
                        l1Toggle.textContent = l1Expanded ? '▼' : '▶';
                        l1Toggle.classList.toggle('expanded', l1Expanded);
                    }
                }
            } else {
                sibling.classList.add('ai-tree-row-hidden');
            }
        }
        if (sibling.dataset.type === 'case-header') {
            if (isExpanded) {
                const modKey = sibling.dataset.modKey;
                const l1Key = sibling.dataset.l1Key;
                const modExpanded = expandedModules.has(modKey);
                const l1Expanded = expandedLevel1s.has(l1Key);
                sibling.classList.toggle('ai-tree-row-hidden', !(modExpanded && l1Expanded));
            } else {
                sibling.classList.add('ai-tree-row-hidden');
            }
        }
        if (sibling.dataset.type === 'case') {
            if (isExpanded) {
                const modKey = sibling.dataset.modKey;
                const l1Key = sibling.dataset.l1Key;
                const modExpanded = expandedModules.has(modKey);
                const l1Expanded = expandedLevel1s.has(l1Key);
                sibling.classList.toggle('ai-tree-row-hidden', !(modExpanded && l1Expanded));
            } else {
                sibling.classList.add('ai-tree-row-hidden');
            }
        }
        sibling = sibling.nextElementSibling;
    }
}

function toggleModuleExpand(modKey) {
    if (expandedModules.has(modKey)) expandedModules.delete(modKey);
    else expandedModules.add(modKey);

    const isExpanded = expandedModules.has(modKey);
    const toggleEl = document.querySelector(`[data-mod-toggle="${CSS.escape(modKey)}"]`);
    if (toggleEl) {
        toggleEl.textContent = isExpanded ? '▼' : '▶';
        toggleEl.classList.toggle('expanded', isExpanded);
    }

    const modRow = document.querySelector(`.ai-tree-module-row[data-mod-key="${CSS.escape(modKey)}"]`);
    if (!modRow) return;

    let sibling = modRow.nextElementSibling;
    while (sibling && sibling.dataset.type !== 'library' && sibling.dataset.type !== 'module') {
        if (sibling.dataset.type === 'level1-header' && sibling.dataset.modKey === modKey) {
            sibling.classList.toggle('ai-tree-row-hidden', !isExpanded);
        }
        if (sibling.dataset.type === 'level1' && sibling.dataset.modKey === modKey) {
            sibling.classList.toggle('ai-tree-row-hidden', !isExpanded);
            if (isExpanded) {
                const l1Key = sibling.dataset.l1Key;
                const l1Expanded = expandedLevel1s.has(l1Key);
                const l1Toggle = sibling.querySelector('.ai-tree-toggle');
                if (l1Toggle) {
                    l1Toggle.textContent = l1Expanded ? '▼' : '▶';
                    l1Toggle.classList.toggle('expanded', l1Expanded);
                }
            }
        }
        if (sibling.dataset.type === 'case-header' && sibling.dataset.modKey === modKey) {
            if (isExpanded) {
                const l1Key = sibling.dataset.l1Key;
                const l1Expanded = expandedLevel1s.has(l1Key);
                sibling.classList.toggle('ai-tree-row-hidden', !l1Expanded);
            } else {
                sibling.classList.add('ai-tree-row-hidden');
            }
        }
        if (sibling.dataset.type === 'case' && sibling.dataset.modKey === modKey) {
            if (isExpanded) {
                const l1Key = sibling.dataset.l1Key;
                const l1Expanded = expandedLevel1s.has(l1Key);
                sibling.classList.toggle('ai-tree-row-hidden', !l1Expanded);
            } else {
                sibling.classList.add('ai-tree-row-hidden');
            }
        }
        sibling = sibling.nextElementSibling;
    }
}

function toggleAiTreeLevel1Expand(l1Key) {
    if (expandedLevel1s.has(l1Key)) expandedLevel1s.delete(l1Key);
    else expandedLevel1s.add(l1Key);

    const isExpanded = expandedLevel1s.has(l1Key);
    const toggleEl = document.querySelector(`[data-l1-toggle="${CSS.escape(l1Key)}"]`);
    if (toggleEl) {
        toggleEl.textContent = isExpanded ? '▼' : '▶';
        toggleEl.classList.toggle('expanded', isExpanded);
    }

    const l1Row = document.querySelector(`.ai-tree-level1-row[data-l1-key="${CSS.escape(l1Key)}"]`);
    if (!l1Row) return;

    let sibling = l1Row.nextElementSibling;
    while (sibling) {
        if (sibling.dataset.type === 'case-header' && sibling.dataset.l1Key === l1Key) {
            sibling.classList.toggle('ai-tree-row-hidden', !isExpanded);
            sibling = sibling.nextElementSibling;
            continue;
        }
        if (sibling.dataset.type === 'case' && sibling.dataset.l1Key === l1Key) {
            sibling.classList.toggle('ai-tree-row-hidden', !isExpanded);
            sibling = sibling.nextElementSibling;
            continue;
        }
        break;
    }
}

function initTreeTableEvents() {
    if (treeTableEventsInitialized) return;
    treeTableEventsInitialized = true;
    const container = document.getElementById('caseTreeTableContainer');
    if (!container) return;

    container.addEventListener('click', function(e) {
        const toggleLib = e.target.closest('[data-lib-toggle]');
        if (toggleLib) {
            e.stopPropagation();
            toggleLibraryExpand(toggleLib.dataset.libToggle);
            return;
        }

        const toggleMod = e.target.closest('[data-mod-toggle]');
        if (toggleMod) {
            e.stopPropagation();
            toggleModuleExpand(toggleMod.dataset.modToggle);
            return;
        }

        const toggleL1 = e.target.closest('[data-l1-toggle]');
        if (toggleL1) {
            e.stopPropagation();
            toggleAiTreeLevel1Expand(toggleL1.dataset.l1Toggle);
            return;
        }

        const groupRow = e.target.closest('.ai-tree-group-row');
        if (groupRow && !e.target.closest('.ai-tree-checkbox') && !e.target.closest('.ai-tree-toggle')) {
            toggleLibraryExpand(groupRow.dataset.lib);
            return;
        }

        const moduleRow = e.target.closest('.ai-tree-module-row');
        if (moduleRow && !e.target.closest('.ai-tree-checkbox') && !e.target.closest('.ai-tree-toggle')) {
            toggleModuleExpand(moduleRow.dataset.modKey);
            return;
        }

        const level1Row = e.target.closest('.ai-tree-level1-row');
        if (level1Row && !e.target.closest('.ai-tree-checkbox') && !e.target.closest('.ai-tree-toggle')) {
            toggleAiTreeLevel1Expand(level1Row.dataset.l1Key);
            return;
        }

        const viewBtn = e.target.closest('[data-view-case]');
        if (viewBtn) {
            viewCaseDetail(viewBtn.dataset.viewCase);
            return;
        }

        const editBtn = e.target.closest('[data-edit-case]');
        if (editBtn) {
            editCaseDetail(editBtn.dataset.editCase);
            return;
        }

        const deleteBtn = e.target.closest('[data-delete-case]');
        if (deleteBtn) {
            deleteCase(deleteBtn.dataset.deleteCase);
            return;
        }
    });

    container.addEventListener('change', function(e) {
        if (!e.target.classList.contains('ai-tree-checkbox')) return;

        if (e.target.dataset.caseCheck) {
            const caseId = e.target.dataset.caseCheck;
            if (e.target.checked) selectedCases.add(caseId);
            else selectedCases.delete(caseId);
            updateSelectedCount();
            updateParentCheckboxes();
        } else if (e.target.dataset.l1Check) {
            const l1Key = e.target.dataset.l1Check;
            const parts = l1Key.split('::');
            const libName = parts[0];
            const modName = parts[1];
            const level1Name = parts.slice(2).join('::');
            const casesInGroup = allTempCases.filter(c =>
                (c.library_name || '未分类') === libName && (c.module_name || '未分类') === modName && (c.level1_name || '未分类') === level1Name
            );
            if (e.target.checked) casesInGroup.forEach(c => selectedCases.add(c.temp_case_id));
            else casesInGroup.forEach(c => selectedCases.delete(c.temp_case_id));
            document.querySelectorAll('[data-case-check]').forEach(cb => {
                const row = cb.closest('tr');
                if (row && row.dataset.lib === libName && row.dataset.module === modName && row.dataset.level1 === level1Name) {
                    cb.checked = e.target.checked;
                }
            });
            updateSelectedCount();
            updateParentCheckboxes();
        } else if (e.target.dataset.modCheck) {
            const modKey = e.target.dataset.modCheck;
            const parts = modKey.split('::');
            const libName = parts[0];
            const modName = parts.slice(1).join('::');
            const casesInMod = allTempCases.filter(c =>
                (c.library_name || '未分类') === libName && (c.module_name || '未分类') === modName
            );
            if (e.target.checked) casesInMod.forEach(c => selectedCases.add(c.temp_case_id));
            else casesInMod.forEach(c => selectedCases.delete(c.temp_case_id));
            document.querySelectorAll('[data-case-check]').forEach(cb => {
                const row = cb.closest('tr');
                if (row && row.dataset.lib === libName && row.dataset.module === modName) cb.checked = e.target.checked;
            });
            document.querySelectorAll('[data-l1-check]').forEach(cb => {
                const l1Key = cb.dataset.l1Check;
                if (l1Key.startsWith(modKey + '::')) { cb.checked = e.target.checked; cb.style.opacity = ''; }
            });
            updateSelectedCount();
            updateParentCheckboxes();
        } else if (e.target.dataset.libCheck) {
            const libName = e.target.dataset.libCheck;
            const casesInLib = allTempCases.filter(c => (c.library_name || '未分类') === libName);
            if (e.target.checked) casesInLib.forEach(c => selectedCases.add(c.temp_case_id));
            else casesInLib.forEach(c => selectedCases.delete(c.temp_case_id));
            document.querySelectorAll('[data-case-check]').forEach(cb => {
                const row = cb.closest('tr');
                if (row && row.dataset.lib === libName) cb.checked = e.target.checked;
            });
            document.querySelectorAll('[data-l1-check]').forEach(cb => {
                if (cb.dataset.l1Check.startsWith(libName + '::')) { cb.checked = e.target.checked; cb.style.opacity = ''; }
            });
            document.querySelectorAll('[data-mod-check]').forEach(cb => {
                if (cb.dataset.modCheck.startsWith(libName + '::')) { cb.checked = e.target.checked; cb.style.opacity = ''; }
            });
            updateSelectedCount();
            updateParentCheckboxes();
        }
    });
}

function updateParentCheckboxes() {
    const libraryGroups = new Map();
    allTempCases.forEach(c => {
        const libKey = c.library_name || '未分类';
        if (!libraryGroups.has(libKey)) libraryGroups.set(libKey, new Map());
        const modKey = c.module_name || '未分类';
        if (!libraryGroups.get(libKey).has(modKey)) libraryGroups.get(libKey).set(modKey, new Map());
        const l1Key = c.level1_name || '未分类';
        if (!libraryGroups.get(libKey).get(modKey).has(l1Key)) libraryGroups.get(libKey).get(modKey).set(l1Key, []);
        libraryGroups.get(libKey).get(modKey).get(l1Key).push(c);
    });

    libraryGroups.forEach((modMap, libName) => {
        const allCasesInLib = [];
        modMap.forEach(l1Map => l1Map.forEach(cases => allCasesInLib.push(...cases)));
        const libCb = document.querySelector(`[data-lib-check="${CSS.escape(libName)}"]`);
        if (libCb) {
            const allChecked = allCasesInLib.every(c => selectedCases.has(c.temp_case_id));
            const someChecked = allCasesInLib.some(c => selectedCases.has(c.temp_case_id));
            libCb.checked = allChecked;
            libCb.style.opacity = someChecked && !allChecked ? '0.5' : '';
        }

        modMap.forEach((l1Map, modName) => {
            const modKey = libName + '::' + modName;
            const allCasesInMod = [];
            l1Map.forEach(cases => allCasesInMod.push(...cases));
            const modCb = document.querySelector(`[data-mod-check="${CSS.escape(modKey)}"]`);
            if (modCb) {
                const allChecked = allCasesInMod.every(c => selectedCases.has(c.temp_case_id));
                const someChecked = allCasesInMod.some(c => selectedCases.has(c.temp_case_id));
                modCb.checked = allChecked;
                modCb.style.opacity = someChecked && !allChecked ? '0.5' : '';
            }

            l1Map.forEach((cases, level1Name) => {
                const l1Key = modKey + '::' + level1Name;
                const l1Cb = document.querySelector(`[data-l1-check="${CSS.escape(l1Key)}"]`);
                if (l1Cb) {
                    const allChecked = cases.every(c => selectedCases.has(c.temp_case_id));
                    const someChecked = cases.some(c => selectedCases.has(c.temp_case_id));
                    l1Cb.checked = allChecked;
                    l1Cb.style.opacity = someChecked && !allChecked ? '0.5' : '';
                }
            });
        });
    });
}

function updateSelectedCount() {
    const countEl = document.getElementById('selectedCountBadge');
    const clearBtn = document.getElementById('clearSelectionBtn');
    if (countEl) {
        countEl.textContent = selectedCases.size;
        countEl.style.display = selectedCases.size > 0 ? 'inline-flex' : 'none';
    }
    if (clearBtn) {
        clearBtn.style.display = selectedCases.size > 0 ? 'inline-flex' : 'none';
    }
}

async function viewCaseDetail(tempCaseId) {
    try {
        const res = await aiApiGet(`/api/temp-cases/detail/${tempCaseId}`);
        if (res.success) {
            const c = res.data;
            document.getElementById('caseDetailBody').innerHTML = `
                <div class="ai-form-group"><label>用例名称</label><p>${aiEscapeHtml(c.name)}</p></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div class="ai-form-group"><label>优先级</label><p>${aiEscapeHtml(c.priority)}</p></div>
                    <div class="ai-form-group"><label>类型</label><p>${aiEscapeHtml(c.type)}</p></div>
                </div>
                <div class="ai-form-group"><label>前置条件</label><p>${aiEscapeHtml(c.precondition) || '无'}</p></div>
                <div class="ai-form-group"><label>测试目的</label><p>${aiEscapeHtml(c.purpose) || '无'}</p></div>
                <div class="ai-form-group"><label>测试步骤</label><pre style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:8px;">${aiEscapeHtml(c.steps)}</pre></div>
                <div class="ai-form-group"><label>预期结果</label><pre style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:8px;">${aiEscapeHtml(c.expected)}</pre></div>
                ${c.is_duplicate ? `<div class="ai-form-group"><label>查重信息</label><p>相似度: ${aiEscapeHtml(c.duplicate_score)}% ${c.duplicate_with_case_id ? `(与正式用例#${aiEscapeHtml(c.duplicate_with_case_id)}重复)` : ''}</p></div>` : ''}
            `;
            
            const saveBtn = document.getElementById('caseDetailSaveBtn');
            saveBtn.style.display = 'none';
            
            const footer = document.querySelector('#caseDetailModal .ai-modal-footer');
            let editBtn = document.getElementById('caseDetailEditBtn');
            if (!editBtn) {
                editBtn = document.createElement('button');
                editBtn.id = 'caseDetailEditBtn';
                editBtn.className = 'ai-btn ai-btn-primary';
                editBtn.textContent = '编辑';
                footer.insertBefore(editBtn, saveBtn);
            }
            editBtn.style.display = '';
            editBtn.onclick = function() { editCaseDetail(tempCaseId); };
            
            initCaseDetailDragResize();
            document.getElementById('aiGenOverlay').classList.add('show');
            document.getElementById('caseDetailModal').classList.add('open');
        }
    } catch (e) {}
}

async function editCaseDetail(tempCaseId) {
    try {
        const res = await aiApiGet(`/api/temp-cases/detail/${tempCaseId}`);
        if (res.success) {
            const c = res.data;
            document.getElementById('caseDetailBody').innerHTML = `
                <input type="hidden" id="editCaseId" value="${aiEscapeHtml(c.temp_case_id)}">
                <div class="ai-form-group"><label>用例名称</label><input type="text" id="editName" class="ai-input" value="${aiEscapeHtml(c.name)}"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div class="ai-form-group"><label>优先级</label><select id="editPriority" class="ai-select"><option ${c.priority==='高'?'selected':''}>高</option><option ${c.priority==='中'?'selected':''}>中</option><option ${c.priority==='低'?'selected':''}>低</option></select></div>
                    <div class="ai-form-group"><label>类型</label><select id="editType" class="ai-select"><option ${c.type==='功能测试'?'selected':''}>功能测试</option><option ${c.type==='性能测试'?'selected':''}>性能测试</option><option ${c.type==='异常测试'?'selected':''}>异常测试</option><option ${c.type==='压力测试'?'selected':''}>压力测试</option></select></div>
                </div>
                <div class="ai-form-group"><label>前置条件</label><textarea id="editPrecondition" class="ai-textarea">${aiEscapeHtml(c.precondition || '')}</textarea></div>
                <div class="ai-form-group"><label>测试目的</label><textarea id="editPurpose" class="ai-textarea">${aiEscapeHtml(c.purpose || '')}</textarea></div>
                <div class="ai-form-group"><label>测试步骤</label><textarea id="editSteps" class="ai-textarea" style="min-height:120px;">${aiEscapeHtml(c.steps)}</textarea></div>
                <div class="ai-form-group"><label>预期结果</label><textarea id="editExpected" class="ai-textarea" style="min-height:80px;">${aiEscapeHtml(c.expected)}</textarea></div>
            `;
            
            const saveBtn = document.getElementById('caseDetailSaveBtn');
            saveBtn.style.display = '';
            
            const editBtn = document.getElementById('caseDetailEditBtn');
            if (editBtn) {
                editBtn.style.display = 'none';
            }
            
            initCaseDetailDragResize();
            document.getElementById('aiGenOverlay').classList.add('show');
            document.getElementById('caseDetailModal').classList.add('open');
        }
    } catch (e) {}
}

async function saveCaseDetail() {
    const tempCaseId = document.getElementById('editCaseId')?.value;
    if (!tempCaseId) return;

    const updates = {
        name: document.getElementById('editName')?.value,
        priority: document.getElementById('editPriority')?.value,
        type: document.getElementById('editType')?.value,
        precondition: document.getElementById('editPrecondition')?.value,
        purpose: document.getElementById('editPurpose')?.value,
        steps: document.getElementById('editSteps')?.value,
        expected: document.getElementById('editExpected')?.value
    };

    try {
        await aiApiPut(`/api/temp-cases/update/${tempCaseId}`, updates);
        aiNotify('保存成功', 'success');
        closeCaseDetailModal();
        loadTempCases();
    } catch (e) {}
}

function closeCaseDetailModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    const modal = document.getElementById('caseDetailModal');
    modal.classList.remove('open');
    modal.style.width = '';
    modal.style.height = '';
}

function initCaseDetailDragResize() {
    const modal = document.getElementById('caseDetailModal');
    if (!modal || modal.dataset.dragInit === '1') return;
    modal.dataset.dragInit = '1';
    const resizer = modal.querySelector('.ai-modal-resizer');

    let isResizing = false;
    let resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;

    if (resizer) {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeStartW = modal.offsetWidth;
            resizeStartH = modal.offsetHeight;

            document.body.classList.add('ai-modal-resizing');
            e.preventDefault();
            e.stopPropagation();
        });
    }

    const handleMouseMove = (e) => {
        if (isResizing) {
            const newW = Math.max(600, resizeStartW + (e.clientX - resizeStartX));
            const newH = Math.max(400, resizeStartH + (e.clientY - resizeStartY));
            modal.style.width = Math.min(newW, window.innerWidth - 40) + 'px';
            modal.style.height = Math.min(newH, window.innerHeight - 40) + 'px';
        }
    };

    const handleMouseUp = () => {
        if (isResizing) {
            isResizing = false;
            document.body.classList.remove('ai-modal-resizing');
        }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

async function deleteCase(tempCaseId) {
    if (!(await aiShowConfirmMessage('确定要删除此用例吗？'))) return;
    try {
        await aiApiPost('/api/temp-cases/batch-delete', { tempCaseIds: [tempCaseId] });
        aiNotify('删除成功', 'success');
        loadTempCases();
    } catch (e) {}
}

async function batchEdit() {
    if (selectedCases.size === 0) { aiNotify('请先选择用例', 'warning'); return; }
    document.getElementById('batchEditCount').textContent = selectedCases.size;
    await loadBatchEditOptions();
    document.getElementById('aiGenOverlay').classList.add('show');
    document.getElementById('batchEditModal').classList.add('open');
}

async function loadBatchEditOptions() {
    try {
        const [usersRes, projectsRes] = await Promise.all([
            aiApiGet('/api/users/usernames'),
            aiApiGet('/api/projects/list')
        ]);
        
        const ownerSelect = document.getElementById('batchOwner');
        ownerSelect.innerHTML = '<option value="">留空则不修改</option>';
        if (usersRes.success && usersRes.usernames) {
            usersRes.usernames.filter(u => u !== 'admin').forEach(username => {
                const opt = document.createElement('option');
                opt.value = username;
                opt.textContent = username;
                ownerSelect.appendChild(opt);
            });
        }
        
        const projectList = document.getElementById('batchProjectList');
        projectList.innerHTML = '';
        if (projectsRes.success && projectsRes.projects) {
            projectsRes.projects.forEach(project => {
                const label = document.createElement('label');
                label.className = 'ai-checkbox-item';
                label.innerHTML = `<input type="checkbox" value="${project.id}"> ${aiEscapeHtml(project.name)}`;
                projectList.appendChild(label);
            });
        }
        
        document.querySelectorAll('#batchTypeList input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('#batchMethodList input[type="checkbox"]').forEach(cb => cb.checked = false);
    } catch (e) {
        console.error('加载批量编辑选项失败:', e);
    }
}

function closeBatchEditModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    document.getElementById('batchEditModal').classList.remove('open');
}

async function saveBatchEdit() {
    const updates = {};
    const owner = document.getElementById('batchOwner').value;
    const priority = document.getElementById('batchPriority').value;
    
    const selectedProjects = Array.from(document.querySelectorAll('#batchProjectList input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
    const selectedTypes = Array.from(document.querySelectorAll('#batchTypeList input[type="checkbox"]:checked')).map(cb => cb.value);
    const selectedMethods = Array.from(document.querySelectorAll('#batchMethodList input[type="checkbox"]:checked')).map(cb => cb.value);

    if (owner) updates.owner = owner;
    if (priority) updates.priority = priority;
    if (selectedProjects.length > 0) updates.project_ids = selectedProjects;
    if (selectedTypes.length > 0) updates.types = selectedTypes;
    if (selectedMethods.length > 0) updates.methods = selectedMethods;

    try {
        await aiApiPost('/api/temp-cases/batch-edit', {
            tempCaseIds: Array.from(selectedCases),
            updates
        });
        aiNotify('批量编辑成功', 'success');
        closeBatchEditModal();
        loadTempCases();
    } catch (e) {}
}

async function batchApprove() {
    if (selectedCases.size === 0) { aiNotify('请先选择用例', 'warning'); return; }
    try {
        await aiApiPost('/api/temp-cases/batch-approve', { tempCaseIds: Array.from(selectedCases) });
        aiNotify('批量批准成功', 'success');
        selectedCases.clear();
        updateSelectedCount();
        loadTempCases();
    } catch (e) {}
}

async function batchReject() {
    if (selectedCases.size === 0) { aiNotify('请先选择用例', 'warning'); return; }
    try {
        await aiApiPost('/api/temp-cases/batch-reject', { tempCaseIds: Array.from(selectedCases) });
        aiNotify('批量拒绝成功', 'success');
        selectedCases.clear();
        updateSelectedCount();
        loadTempCases();
    } catch (e) {}
}

async function batchDelete() {
    if (selectedCases.size === 0) { aiNotify('请先选择用例', 'warning'); return; }
    if (!(await aiShowConfirmMessage(`确定要删除 ${selectedCases.size} 个用例吗？`))) return;
    try {
        await aiApiPost('/api/temp-cases/batch-delete', { tempCaseIds: Array.from(selectedCases) });
        aiNotify('批量删除成功', 'success');
        selectedCases.clear();
        updateSelectedCount();
        loadTempCases();
    } catch (e) {}
}

async function executeMerge() {
    if (selectedCases.size === 0) {
        aiNotify('请先选择要合并的用例', 'warning');
        return;
    }

    const taskId = document.getElementById('taskFilter').value;
    const mergeLibraryId = document.getElementById('mergeLibrarySelect').value;

    if (currentMergeMode === 'direct' && !mergeLibraryId) {
        aiNotify('请选择目标用例库', 'warning');
        return;
    }

    try {
        let res;
        if (currentMergeMode === 'direct') {
            res = await aiApiPost('/api/temp-cases/batch-merge', {
                tempCaseIds: Array.from(selectedCases),
                taskId: taskId && taskId !== 'all' ? taskId : undefined,
                defaultOwner: '',
                libraryId: mergeLibraryId
            });
        } else {
            const reviewerIds = Array.from(document.querySelectorAll('#reviewerCheckboxList input[type="checkbox"]:checked')).map(cb => cb.value);
            const deadline = document.getElementById('reviewDeadline').value;

            if (reviewerIds.length === 0) {
                aiNotify('请选择评审人', 'warning');
                return;
            }

            const tid = taskId && taskId !== 'all' ? taskId : 'batch';
            res = await aiApiPost(`/api/temp-cases/submit-review/${tid}`, {
                tempCaseIds: Array.from(selectedCases),
                taskId: taskId && taskId !== 'all' ? taskId : undefined,
                libraryId: mergeLibraryId || undefined,
                reviewerIds,
                deadline
            });
        }

        if (res.success) {
            if (currentMergeMode === 'review') {
                aiNotify('已提交评审，等待评审人确认！', 'success');
            } else {
                aiNotify('已合并进库！', 'success');
            }
            closeMergeModal();
            selectedCases.clear();
            loadTempCases();
        } else {
            aiNotify(res.message || '操作失败', 'error');
        }
    } catch (e) {}
}

async function loadReviewList() {
    reviewPage = 1;
    await loadReviewPage();
}

async function loadReviewPage(page) {
    if (page !== undefined) reviewPage = page;
    try {
        const offset = (reviewPage - 1) * reviewPageSize;
        const res = await aiApiGet(`/api/temp-cases/pending-review?limit=${reviewPageSize}&offset=${offset}`);
        if (res.success) {
            const container = document.getElementById('reviewList');
            const tasks = res.data || [];
            reviewTotal = res.total || 0;
            const totalPages = Math.ceil(reviewTotal / reviewPageSize);
            if (reviewTotal === 0) {
                container.innerHTML = '<div class="ai-empty"><div class="icon">📋</div><p>暂无待评审任务</p></div>';
                aiRenderPagination('reviewPagination', reviewPage, 0, 0, 'loadReviewPage');
                return;
            }
            container.innerHTML = tasks.map(t => `
                <div class="ai-card" style="margin-bottom:12px;">
                    <div class="ai-card-body">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <h4>${aiEscapeHtml(t.module_name)} - ${aiEscapeHtml(t.task_id)}</h4>
                                <p style="font-size:13px;color:var(--ai-text-secondary);">提交人: ${aiEscapeHtml(t.creator_name)} | 待评审: ${t.pending_count}个用例</p>
                            </div>
                            <button class="ai-btn ai-btn-primary" data-task-id="${aiEscapeHtml(t.task_id)}">开始评审</button>
                        </div>
                    </div>
                </div>
            `).join('');
            container.querySelectorAll('button[data-task-id]').forEach(btn => {
                btn.addEventListener('click', function() {
                    startReview(this.dataset.taskId);
                });
            });
            aiRenderPagination('reviewPagination', reviewPage, totalPages, reviewTotal, 'loadReviewPage');
        }
    } catch (e) {}
}
window.loadReviewPage = loadReviewPage;

async function startReview(taskId) {
    try {
        const res = await aiApiGet(`/api/temp-cases/list/${taskId}?status=approved&review_status=pending`);
        if (res.success) {
            const cases = res.data.cases || [];
            if (cases.length === 0) {
                aiNotify('没有待评审的用例', 'info');
                return;
            }

            const reviews = [];
            for (const c of cases) {
                const approved = await aiShowConfirmMessage(`用例: ${c.name}\n\n点击"确认"批准，点击"取消"拒绝`);
                let comment = '';
                if (!approved) {
                    comment = await showPromptModal('请输入拒绝原因:') || '';
                }
                reviews.push({
                    tempCaseId: c.temp_case_id,
                    result: approved ? 'approved' : 'rejected',
                    comment
                });
            }

            const result = await aiApiPost(`/api/temp-cases/review/${taskId}`, { reviews });
            if (result.success) {
                aiNotify(`评审完成: 通过${result.data.approved}个, 拒绝${result.data.rejected}个`, 'success');
                loadReviewList();
            }
        }
    } catch (e) {}
}

function showCrawlModal() {
    if (!aiCurrentModuleId) { aiNotify('请先选择模块', 'warning'); return; }
    document.getElementById('aiGenOverlay').classList.add('show');
    document.getElementById('aiCrawlModal').classList.add('open');
}

function closeCrawlModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    document.getElementById('aiCrawlModal').classList.remove('open');
}

async function executeCrawl() {
    const url = document.getElementById('aiCrawlUrl').value;
    if (!url) { aiNotify('请输入URL', 'warning'); return; }

    try {
        aiNotify('正在爬取网页...', 'info');
        const res = await aiApiPost('/api/knowledge/crawl', {
            url,
            moduleId: aiCurrentModuleId,
            username: document.getElementById('aiCrawlUsername').value || undefined,
            password: document.getElementById('aiCrawlPassword').value || undefined
        });

        if (res.success) {
            aiNotify('网页爬取并保存成功！', 'success');
            closeCrawlModal();
            loadKnowledgeFiles();
            loadKnowledgeTree();
        } else {
            aiNotify(res.data?.error || '爬取失败', 'error');
        }
    } catch (e) {
        aiNotify('爬取失败: ' + e.message, 'error');
    }
}

function initTaskHistoryDragResize() {
    const modal = document.getElementById('taskHistoryModal');
    if (!modal || modal.dataset.dragInit === '1') return;
    modal.dataset.dragInit = '1';
    const resizer = modal.querySelector('.ai-modal-resizer');

    let isResizing = false;
    let resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;

    if (resizer) {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeStartW = modal.offsetWidth;
            resizeStartH = modal.offsetHeight;

            document.body.classList.add('ai-modal-resizing');
            e.preventDefault();
            e.stopPropagation();
        });
    }

    const handleMouseMove = (e) => {
        if (isResizing) {
            const newW = Math.max(600, resizeStartW + (e.clientX - resizeStartX));
            const newH = Math.max(400, resizeStartH + (e.clientY - resizeStartY));
            modal.style.width = Math.min(newW, window.innerWidth - 40) + 'px';
            modal.style.height = Math.min(newH, window.innerHeight - 40) + 'px';
        }
    };

    const handleMouseUp = () => {
        if (isResizing) {
            isResizing = false;
            document.body.classList.remove('ai-modal-resizing');
        }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

async function showTaskHistory() {
    taskHistoryPage = 1;
    await loadTaskHistoryPage();
}

async function loadTaskHistoryPage(page) {
    if (page !== undefined) taskHistoryPage = page;
    try {
        const offset = (taskHistoryPage - 1) * taskHistoryPageSize;
        const res = await aiApiGet(`/api/ai-generation/tasks?limit=${taskHistoryPageSize}&offset=${offset}`);
        if (res.success) {
            const tbody = document.getElementById('taskHistoryBody');
            const tasks = res.data.tasks || [];
            taskHistoryTotal = res.data.total || 0;
            const totalPages = Math.ceil(taskHistoryTotal / taskHistoryPageSize);
            if (taskHistoryTotal === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:60px 20px;color:var(--ai-text-secondary);font-size:15px;">暂无任务历史记录</td></tr>';
            } else {
                tbody.innerHTML = '';
                tasks.forEach(t => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${aiEscapeHtml(t.task_id)}</td>
                        <td>${aiEscapeHtml(t.module_name)}</td>
                        <td><span class="ai-status-badge ai-status-${aiEscapeHtml(t.status)}">${aiEscapeHtml(t.status)}</span></td>
                        <td>${t.total_cases || 0}</td>
                        <td>${aiFormatDateTime(t.created_at)}</td>
                    `;
                    const opsCell = document.createElement('td');
                    const viewB = document.createElement('button');
                    viewB.className = 'ai-btn ai-btn-sm ai-btn-ghost';
                    viewB.textContent = '查看';
                    viewB.dataset.taskId = t.task_id;
                    viewB.addEventListener('click', function() { viewTaskResult(this.dataset.taskId); });
                    opsCell.appendChild(viewB);
                    if (t.status === 'failed') {
                        const retryB = document.createElement('button');
                        retryB.className = 'ai-btn ai-btn-sm ai-btn-warning';
                        retryB.textContent = '重试';
                        retryB.dataset.taskId = t.task_id;
                        retryB.addEventListener('click', function() { retryTask(this.dataset.taskId); });
                        opsCell.appendChild(retryB);
                    }
                    tr.appendChild(opsCell);
                    tbody.appendChild(tr);
                });
            }
            aiRenderPagination('taskHistoryPagination', taskHistoryPage, totalPages, taskHistoryTotal, 'loadTaskHistoryPage');
            initTaskHistoryDragResize();
            document.getElementById('aiGenOverlay').classList.add('show');
            document.getElementById('taskHistoryModal').classList.add('open');
        } else {
            aiNotify(res.message || '获取任务历史失败', 'error');
        }
    } catch (e) {
        console.error('[AI Generation] showTaskHistory error:', e);
        aiNotify('获取任务历史失败，请检查网络连接', 'error');
    }
}
window.loadTaskHistoryPage = loadTaskHistoryPage;
window.loadTempCasesPage = loadTempCasesPage;

function viewTaskResult(taskId) {
    closeTaskHistoryModal();
    switchTab('preview', { taskId });
}

async function retryTask(taskId) {
    try {
        const res = await aiApiPost(`/api/ai-generation/retry/${taskId}`);
        if (res.success) {
            aiNotify('任务已重新提交', 'success');
            showTaskHistory();
        } else {
            aiNotify(res.message || '重试任务失败', 'error');
        }
    } catch (e) {
        console.error('[AI Generation] retryTask error:', e);
        aiNotify('重试任务失败，请检查网络连接', 'error');
    }
}

function closeTaskHistoryModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    const modal = document.getElementById('taskHistoryModal');
    modal.classList.remove('open');
    modal.style.width = '';
    modal.style.height = '';
}

function aiCloseAllModals() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    document.querySelectorAll('#ai-generation-section .ai-modal, #ai-generation-section .ai-drawer').forEach(el => el.classList.remove('open'));
}

function initSkillsDragResize() {
    const modal = document.getElementById('skillsModal');
    if (!modal || modal.dataset.dragInit === '1') return;
    modal.dataset.dragInit = '1';
    const resizer = modal.querySelector('.ai-modal-resizer');

    let isResizing = false;
    let resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;

    if (resizer) {
        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeStartW = modal.offsetWidth;
            resizeStartH = modal.offsetHeight;

            document.body.classList.add('ai-modal-resizing');
            e.preventDefault();
            e.stopPropagation();
        });
    }

    const handleMouseMove = (e) => {
        if (isResizing) {
            const newW = Math.max(700, resizeStartW + (e.clientX - resizeStartX));
            const newH = Math.max(450, resizeStartH + (e.clientY - resizeStartY));
            modal.style.width = Math.min(newW, window.innerWidth - 40) + 'px';
            modal.style.height = Math.min(newH, window.innerHeight - 40) + 'px';
        }
    };

    const handleMouseUp = () => {
        if (isResizing) {
            isResizing = false;
            document.body.classList.remove('ai-modal-resizing');
        }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

async function showSkillsManager() {
    try {
        const res = await aiApiGet('/api/ai-generation/skills');
        if (res.success) {
            renderSkillsList(res.data || []);
            document.getElementById('skillViewPanel').style.display = 'none';
            document.getElementById('skillEditForm').style.display = 'none';
            document.getElementById('skillsEmptyHint').style.display = 'flex';
            initSkillsDragResize();
            document.getElementById('aiGenOverlay').classList.add('show');
            document.getElementById('skillsModal').classList.add('open');
        }
    } catch (e) {}
}

let currentSelectedSkillId = null;

function renderSkillsList(skills) {
    const container = document.getElementById('skillsList');
    container.innerHTML = '';
    if (skills.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px 16px;color:var(--ai-text-secondary);font-size:14px;">暂无Skill<br>点击上方按钮新建</div>';
        return;
    }
    skills.forEach(s => {
        const card = document.createElement('div');
        card.className = 'ai-skill-card';
        card.dataset.skillId = s.id;
        if (currentSelectedSkillId === s.id) {
            card.classList.add('active');
        }
        card.innerHTML = `
            <div class="ai-skill-name">${aiEscapeHtml(s.displayName)} <span class="ai-skill-badge ${s.isSystem ? 'ai-skill-badge-system' : 'ai-skill-badge-custom'}">${s.isSystem ? '内置' : '自定义'}</span></div>
            <div class="ai-skill-desc">${aiEscapeHtml(s.description || '无描述')}</div>
        `;
        card.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            currentSelectedSkillId = s.id;
            document.querySelectorAll('#skillsList .ai-skill-card').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            viewSkill(s.id);
        });
        container.appendChild(card);
    });
}

async function viewSkill(id) {
    try {
        const res = await aiApiGet(`/api/ai-skills/detail/${id}`);
        if (res.success) {
            const skill = res.data || res.skill;
            currentSelectedSkillId = id;
            
            document.getElementById('skillViewTitle').textContent = skill.displayName || skill.display_name || '';
            document.getElementById('skillViewName').textContent = skill.name || '';
            const isSystem = skill.isSystem === true || skill.is_system === 1;
            document.getElementById('skillViewType').innerHTML = isSystem
                ? '<span class="ai-skill-badge ai-skill-badge-system">内置</span>'
                : '<span class="ai-skill-badge ai-skill-badge-custom">自定义</span>';
            document.getElementById('skillViewDesc').textContent = skill.description || '无描述';

            let systemPrompt = '', userTemplate = '';
            try {
                const def = typeof skill.definition === 'string' ? JSON.parse(skill.definition) : skill.definition;
                systemPrompt = def?.prompts?.system || '';
                userTemplate = def?.prompts?.userTemplate || '';
            } catch (e) {}
            document.getElementById('skillViewSystemPrompt').textContent = systemPrompt || '（未设置）';
            document.getElementById('skillViewUserTemplate').textContent = userTemplate || '（未设置）';

            const btnEdit = document.getElementById('btnEditSkill');
            if (isSystem) {
                btnEdit.style.display = 'none';
            } else {
                btnEdit.style.display = '';
                btnEdit.onclick = function() { editSkill(id); };
            }

            document.getElementById('skillsEmptyHint').style.display = 'none';
            document.getElementById('skillEditForm').style.display = 'none';
            document.getElementById('skillViewPanel').style.display = 'flex';
        }
    } catch (e) {
        console.error('[viewSkill] Error:', e);
    }
}

function showCreateSkillForm() {
    editingSkillId = null;
    currentSelectedSkillId = null;
    document.querySelectorAll('#skillsList .ai-skill-card').forEach(c => c.classList.remove('active'));
    document.getElementById('skillFormTitle').textContent = '新建Skill';
    document.getElementById('skillName').value = '';
    document.getElementById('skillDisplayName').value = '';
    document.getElementById('skillDescription').value = '';
    document.getElementById('skillSystemPrompt').value = '';
    document.getElementById('skillUserTemplate').value = '';
    document.getElementById('skillIsPublic').checked = true;
    document.getElementById('skillsEmptyHint').style.display = 'none';
    document.getElementById('skillViewPanel').style.display = 'none';
    document.getElementById('skillEditForm').style.display = 'flex';
}

function hideCreateSkillForm() {
    document.getElementById('skillEditForm').style.display = 'none';
    document.getElementById('skillsEmptyHint').style.display = 'flex';
    currentSelectedSkillId = null;
    document.querySelectorAll('#skillsList .ai-skill-card').forEach(c => c.classList.remove('active'));
}

function hideSkillViewPanel() {
    document.getElementById('skillViewPanel').style.display = 'none';
    document.getElementById('skillsEmptyHint').style.display = 'flex';
    currentSelectedSkillId = null;
    document.querySelectorAll('#skillsList .ai-skill-card').forEach(c => c.classList.remove('active'));
}

async function saveSkill() {
    const data = {
        name: document.getElementById('skillName').value,
        displayName: document.getElementById('skillDisplayName').value,
        description: document.getElementById('skillDescription').value,
        systemPrompt: document.getElementById('skillSystemPrompt').value,
        userPromptTemplate: document.getElementById('skillUserTemplate').value,
        isPublic: document.getElementById('skillIsPublic').checked
    };

    try {
        let res;
        if (editingSkillId) {
            res = await aiApiPut(`/api/ai-generation/skills/${editingSkillId}`, data);
        } else {
            res = await aiApiPost('/api/ai-generation/skills', data);
        }

        if (res.success) {
            aiNotify('Skill保存成功', 'success');
            const savedId = editingSkillId || res.data?.id;
            await showSkillsManager();
            if (savedId) {
                currentSelectedSkillId = savedId;
                viewSkill(savedId);
            }
        } else {
            aiNotify(res.message || '保存失败', 'error');
        }
    } catch (e) {}
}

async function editSkill(id) {
    try {
        const res = await aiApiGet(`/api/ai-skills/detail/${id}`);
        if (res.success) {
            const skill = res.data || res.skill;
            editingSkillId = id;
            document.getElementById('skillFormTitle').textContent = '编辑Skill';
            document.getElementById('skillName').value = skill.name || '';
            document.getElementById('skillDisplayName').value = skill.display_name || skill.displayName || '';
            document.getElementById('skillDescription').value = skill.description || '';

            try {
                const def = typeof skill.definition === 'string' ? JSON.parse(skill.definition) : skill.definition;
                document.getElementById('skillSystemPrompt').value = def?.prompts?.system || '';
                document.getElementById('skillUserTemplate').value = def?.prompts?.userTemplate || '';
            } catch (e) {}

            document.getElementById('skillIsPublic').checked = skill.is_public === 1 || skill.isPublic === true;
            document.getElementById('skillsEmptyHint').style.display = 'none';
            document.getElementById('skillViewPanel').style.display = 'none';
            document.getElementById('skillEditForm').style.display = 'flex';
        }
    } catch (e) {}
}

async function deleteSkill(id) {
    if (!(await aiShowConfirmMessage('确定要删除此Skill吗？'))) return;
    try {
        await aiApiDelete(`/api/ai-generation/skills/${id}`);
        aiNotify('Skill已删除', 'success');
        showSkillsManager();
    } catch (e) {}
}

function closeSkillsModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    const modal = document.getElementById('skillsModal');
    modal.classList.remove('open');
    modal.style.width = '';
    modal.style.height = '';
    hideCreateSkillForm();
    hideSkillViewPanel();
}

/**
 * 从知识库跳转到 AI 生成页面时，自动填充上下文
 * 在 script.js 的路由处理中调用
 */
function applyAIGenerationContext() {
    const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const libraryId = urlParams.get('libraryId');
    const moduleId = urlParams.get('moduleId');

    if (!libraryId && !moduleId) return;

    // 清掉 URL 参数，避免刷新时重复填充
    const cleanHash = window.location.hash.split('?')[0];
    history.replaceState(null, '', cleanHash);

    // 确保在 generate 标签页
    switchTab('generate');

    // 设置库
    const libSelect = document.getElementById('librarySelect');
    if (libraryId && libSelect) {
        libSelect.value = libraryId;
        aiCurrentLibraryId = parseInt(libraryId);
    }

    // 加载模块列表并选中目标模块
    if (libraryId) {
        loadModulesByLibrary(parseInt(libraryId)).then(() => {
            if (moduleId) {
                const moduleSelect = document.getElementById('moduleSelect');
                if (moduleSelect) {
                    moduleSelect.value = moduleId;
                    onModuleChange();
                }
            }
        });
    }
}