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

    const aiNewFolderName = document.getElementById('aiNewFolderName');

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

const AI_API_BASE = '/api';
let aiCurrentModuleId = null;
let aiCurrentLibraryId = null;
let aiCurrentParentId = null;
let aiSelectedFiles = new Set();
let aiPrefillFileIds = null;
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
let currentSelectedAgentId = null;

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
    if (typeof apiRequest === 'function') {
        return apiRequest(url, { method: 'GET' });
    }
    const res = await fetch(AI_API_BASE + url, { headers: aiGetAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function aiApiPost(url, data) {
    if (typeof apiRequest === 'function') {
        return apiRequest(url, { method: 'POST', body: JSON.stringify(data) });
    }
    const res = await fetch(AI_API_BASE + url, {
        method: 'POST',
        headers: aiGetAuthHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function aiApiPut(url, data) {
    if (typeof apiRequest === 'function') {
        return apiRequest(url, { method: 'PUT', body: JSON.stringify(data) });
    }
    const res = await fetch(AI_API_BASE + url, {
        method: 'PUT',
        headers: aiGetAuthHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function aiApiDelete(url) {
    if (typeof apiRequest === 'function') {
        return apiRequest(url, { method: 'DELETE' });
    }
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
    if (typeof showConfirmMessage === 'function') {
        return showConfirmMessage(message);
    }
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
                    background: var(--color-bg-elevated, #fff);
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
                    border-bottom: 1px solid var(--color-border-primary, #e2e8f0);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .ai-confirm-icon { font-size: 24px; }
                .ai-confirm-header h3 { margin: 0; font-size: 16px; color: var(--color-text-primary, #1e293b); }
                .ai-confirm-body { padding: 24px; }
                .ai-confirm-body p { margin: 0; font-size: 14px; color: var(--color-text-secondary, #64748b); line-height: 1.6; }
                .ai-confirm-footer {
                    padding: 16px 24px;
                    border-top: 1px solid var(--color-border-primary, #e2e8f0);
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
                .ai-confirm-btn.cancel { background: var(--color-bg-tertiary, #f1f5f9); color: var(--color-text-secondary, #64748b); }
                .ai-confirm-btn.cancel:hover { background: var(--color-border-primary, #e2e8f0); }
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
    if (typeof window.promptModal === 'function') {
        return window.promptModal(message, defaultValue);
    }
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
                    background: var(--color-bg-elevated, #fff);
                    border-radius: 12px;
                    width: 450px;
                    max-width: 90%;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    animation: ai-confirm-in 0.2s ease;
                }
                .ai-prompt-header {
                    padding: 20px 24px;
                    border-bottom: 1px solid var(--color-border-primary, #e2e8f0);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .ai-prompt-icon { font-size: 24px; }
                .ai-prompt-header h3 { margin: 0; font-size: 16px; color: var(--color-text-primary, #1e293b); }
                .ai-prompt-body { padding: 24px; }
                .ai-prompt-body p { margin: 0 0 12px; font-size: 14px; color: var(--color-text-secondary, #64748b); }
                .ai-prompt-input {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid var(--color-border-primary, #e2e8f0);
                    border-radius: 8px;
                    font-size: 14px;
                    outline: none;
                    box-sizing: border-box;
                    background: var(--color-bg-primary, #fff);
                    color: var(--color-text-primary, #1e293b);
                }
                .ai-prompt-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); }
                .ai-prompt-footer {
                    padding: 16px 24px;
                    border-top: 1px solid var(--color-border-primary, #e2e8f0);
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
                .ai-prompt-btn.cancel { background: var(--color-bg-tertiary, #f1f5f9); color: var(--color-text-secondary, #64748b); }
                .ai-prompt-btn.cancel:hover { background: var(--color-border-primary, #e2e8f0); }
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
        const res = await aiApiGet('/libraries/list');
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
        const res = await aiApiPost('/modules/list', { libraryId: parseInt(libraryId), page: 1, pageSize: 100 });
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
    updateFileSelectionInfo();
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
        if (aiPrefillFileIds) {
            selectSpecificFiles(aiPrefillFileIds);
            aiPrefillFileIds = null;
        } else {
            const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
            const prefillFiles = urlParams.get('selectedFiles');
            if (prefillFiles) {
                const fileIds = prefillFiles.split(',').map(Number).filter(n => !isNaN(n));
                selectSpecificFiles(fileIds);
            } else {
                selectAllFiles();
            }
        }
        await loadAILevel1Points();
    } else {
        document.getElementById('fileList').innerHTML = '<div class="ai-empty"><div class="icon">📁</div><p>请先选择模块</p></div>';
        updateFileSelectionInfo();
    }
}

async function loadKnowledgeFiles() {
    if (!aiCurrentModuleId) return;
    try {
        const res = await aiApiGet(`/knowledge/files/${aiCurrentModuleId}`);
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
        updateFileSelectionInfo();
        return;
    }

    container.innerHTML = files.map(f => {
        const isSelected = aiSelectedFiles.has(f.id);
        const icon = f.type === 'folder' ? '📁' : getFileIcon(f.file_ext);
        const statusBadge = f.type === 'file' ? getStatusBadge(f.parse_status) : '';
        const sizeStr = f.file_size ? aiFormatSize(f.file_size) : '';

        return `<div class="ai-file-item ${isSelected ? 'selected' : ''}" data-file-id="${f.id}">
            <input type="checkbox" class="ai-file-checkbox" ${isSelected ? 'checked' : ''} data-file-id="${f.id}">
            <span class="ai-file-icon">${icon}</span>
            <div class="ai-file-info">
                <div class="ai-file-name">${aiEscapeHtml(f.name)}</div>
                <div class="ai-file-meta">${sizeStr} ${f.chunk_count ? `| ${f.chunk_count}块` : ''} ${f.chunking_strategy && f.chunking_strategy !== 'structure_aware' ? `| ${aiEscapeHtml(f.chunking_strategy)}` : ''} ${statusBadge}</div>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.ai-file-item').forEach(item => {
        item.addEventListener('click', function(e) {
            if (e.target.classList.contains('ai-file-checkbox')) return;
            const fileId = parseInt(this.dataset.fileId);
            toggleFileSelection(fileId);
            updateFileListSelection(fileId);
        });
    });

    container.querySelectorAll('.ai-file-checkbox').forEach(cb => {
        cb.addEventListener('change', function(e) {
            e.stopPropagation();
            const fileId = parseInt(this.dataset.fileId);
            if (this.checked) {
                aiSelectedFiles.add(fileId);
            } else {
                aiSelectedFiles.delete(fileId);
            }
            updateFileListSelection(fileId);
        });
    });

    updateFileSelectionInfo();
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

function updateFileListSelection(fileId) {
    const item = document.querySelector(`#fileList .ai-file-item[data-file-id="${fileId}"]`);
    if (item) {
        item.classList.toggle('selected', aiSelectedFiles.has(fileId));
        const checkbox = item.querySelector('.ai-file-checkbox');
        if (checkbox) {
            checkbox.checked = aiSelectedFiles.has(fileId);
        }
    }
    updateFileSelectionInfo();
}

function updateFileSelectionInfo() {
    const infoEl = document.getElementById('fileSelectionInfo');
    if (infoEl) {
        const total = document.querySelectorAll('#fileList .ai-file-item').length;
        const selected = aiSelectedFiles.size;
        infoEl.textContent = `已选 ${selected}/${total} 个文件`;
    }
    const selectAllCb = document.getElementById('fileSelectAllCb');
    if (selectAllCb) {
        const total = document.querySelectorAll('#fileList .ai-file-item').length;
        selectAllCb.checked = total > 0 && aiSelectedFiles.size >= total;
        selectAllCb.indeterminate = aiSelectedFiles.size > 0 && aiSelectedFiles.size < total;
    }
}

function selectAllFiles() {
    document.querySelectorAll('#fileList .ai-file-item').forEach(item => {
        const fileId = parseInt(item.dataset.fileId);
        aiSelectedFiles.add(fileId);
        item.classList.add('selected');
        const checkbox = item.querySelector('.ai-file-checkbox');
        if (checkbox) checkbox.checked = true;
    });
    updateFileSelectionInfo();
    updateSelectionCount();
}

function selectSpecificFiles(fileIds) {
    const fileIdSet = new Set(fileIds);
    document.querySelectorAll('#fileList .ai-file-item').forEach(item => {
        const fileId = parseInt(item.dataset.fileId);
        if (fileIdSet.has(fileId)) {
            aiSelectedFiles.add(fileId);
            item.classList.add('selected');
            const checkbox = item.querySelector('.ai-file-checkbox');
            if (checkbox) checkbox.checked = true;
        }
    });
    updateFileSelectionInfo();
    updateSelectionCount();
}

function deselectAllFiles() {
    document.querySelectorAll('#fileList .ai-file-item').forEach(item => {
        const fileId = parseInt(item.dataset.fileId);
        aiSelectedFiles.delete(fileId);
        item.classList.remove('selected');
        const checkbox = item.querySelector('.ai-file-checkbox');
        if (checkbox) checkbox.checked = false;
    });
    updateFileSelectionInfo();
    updateSelectionCount();
}

function toggleFileSelectAll() {
    const cb = document.getElementById('fileSelectAllCb');
    if (cb.checked) {
        selectAllFiles();
    } else {
        deselectAllFiles();
    }
}

async function loadAILevel1Points() {
    if (!aiCurrentModuleId) return;
    try {
        const res = await aiApiGet(`/ai-generation/level1-points/${aiCurrentModuleId}`);
        if (res.success) {
            const points = res.data || [];
            const container = document.getElementById('existingLevel1List');
            container.innerHTML = points.map(p =>
                `<div class="ai-checkbox-item" data-name="${aiEscapeHtml(p.name).toLowerCase()}" data-level1-id="${p.id}">
                    <input type="checkbox" class="ai-level1-checkbox" value="${p.id}">
                    <span>${aiEscapeHtml(p.name)} (${p.case_count}个用例)</span>
                </div>`
            ).join('');

            container.querySelectorAll('.ai-checkbox-item').forEach(item => {
                item.addEventListener('click', function(e) {
                    if (e.target.classList.contains('ai-level1-checkbox')) return;
                    const id = parseInt(this.dataset.level1Id);
                    toggleLevel1Item(this, id);
                });
            });
            container.querySelectorAll('.ai-level1-checkbox').forEach(cb => {
                cb.addEventListener('change', function(e) {
                    e.stopPropagation();
                    updateLevel1Count();
                });
            });
            
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
        const res = await aiApiGet('/ai-sub-agents/list?category=test_generation&is_enabled=true');
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
            aiApiGet('/users/usernames'),
            aiApiGet('/libraries/list')
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
                label.onmouseover = function() { this.style.background = ThemeService.isDarkMode() ? 'rgba(99, 102, 241, 0.15)' : '#eef2ff'; };
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

    const selectedFiles = Array.from(aiSelectedFiles);
    
    try {
        const statusRes = await aiApiGet(`/ai-generation/check-chunks-status/${aiCurrentModuleId}?fileIds=${selectedFiles.join(',')}`);
        if (statusRes.success && !statusRes.data.hasPendingChunks && statusRes.data.total > 0) {
            const confirmed = await showConfirmDialog(
                '所选文件的所有文本块已处理完成',
                `共 ${statusRes.data.total} 个文本块，已完成 ${statusRes.data.completed} 个，失败 ${statusRes.data.failed} 个。\n\n是否重新生成这些文件的测试用例？\n（将重置文本块状态为待处理）`,
                '重新生成',
                '取消'
            );
            
            if (!confirmed) {
                return;
            }
            
            const resetRes = await aiApiPost('/ai-generation/reset-chunks', {
                moduleId: aiCurrentModuleId,
                fileIds: selectedFiles
            });
            
            if (!resetRes.success) {
                aiNotify('重置文本块状态失败: ' + resetRes.message, 'error');
                return;
            }
            
            aiNotify(`已重置 ${resetRes.data.affectedRows} 个文本块，开始生成用例...`, 'success');
        }
    } catch (e) {
        console.error('检查chunks状态失败:', e);
    }

    const data = {
        moduleId: aiCurrentModuleId,
        libraryId: document.getElementById('librarySelect').value || null,
        selectedFiles: selectedFiles,
        agentId: document.getElementById('agentSelect').value || null,
        caseCountLimit: parseInt(document.getElementById('caseCountLimit').value) || 20,
        enableDedup: document.getElementById('enableDedup').checked,
        similarityThreshold: parseInt(document.getElementById('similarityThreshold').value) / 100,
        level1Mode: currentLevel1Mode,
        selectedLevel1Ids,
        chunkingStrategy: document.getElementById('chunkingStrategy')?.value || 'structure_aware'
    };

    try {
        const res = await aiApiPost('/ai-generation/create', data);
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

function showConfirmDialog(title, message, confirmText = '确认', cancelText = '取消') {
    if (typeof showConfirmMessage === 'function') {
        return showConfirmMessage(`${title}\n${message}`);
    }
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'ai-modal-overlay show';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
        
        const dialog = document.createElement('div');
        const c = ThemeService.getColors();
        dialog.style.cssText = `background: ${c.bgSurface}; border-radius: 8px; padding: 24px; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);`;
        
        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; font-size: 18px; color: ${c.textPrimary};">${title}</h3>
            <p style="margin: 0 0 24px 0; color: ${c.textSecondary}; line-height: 1.6; white-space: pre-wrap;">${message}</p>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button class="btn-cancel" style="padding: 8px 16px; border: 1px solid ${c.border}; background: ${c.bgElevated}; border-radius: 6px; cursor: pointer; color: ${c.textSecondary};">${cancelText}</button>
                <button class="btn-confirm" style="padding: 8px 16px; border: none; background: ${c.primary}; color: white; border-radius: 6px; cursor: pointer;">${confirmText}</button>
            </div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        dialog.querySelector('.btn-confirm').onclick = () => {
            document.body.removeChild(overlay);
            resolve(true);
        };
        
        dialog.querySelector('.btn-cancel').onclick = () => {
            document.body.removeChild(overlay);
            resolve(false);
        };
        
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(false);
            }
        };
    });
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
            const res = await aiApiGet(`/ai-generation/task/${taskId}`);
            if (res.success) {
                updateProgressUI(res.data);
                if (['completed', 'partial_completed', 'failed', 'cancelled'].includes(res.data.status)) {
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
    } else if (task.status === 'partial_completed') {
        document.getElementById('stage5').className = 'ai-stage-icon ai-stage-done';
        document.getElementById('stage5').textContent = '✓';
        const failedInfo = task.failed_chunks ? `（${task.failed_chunks}个文本块处理失败）` : '';
        aiNotify(`任务部分完成${failedInfo}，已生成用例可在预览中查看`, 'warning');
        clearInterval(aiProgressInterval);
        aiProgressInterval = null;
        setTimeout(() => {
            closeProgressModal();
            switchTab('preview', { taskId: task.task_id });
        }, 2000);
    } else if (task.status === 'failed') {
        const errorMsg = task.error_message || task.progress_message || '未知错误（请查看服务器日志）';
        const errorDetail = task.error_stack ? `\n\n详细堆栈:\n${task.error_stack.substring(0, 500)}` : '';
        console.error('[AI Generation] 任务失败详情:', {
            taskId: task.task_id,
            error_message: task.error_message,
            error_stack: task.error_stack,
            progress_message: task.progress_message,
            stage: task.stage,
            progress: task.progress
        });
        aiNotify(`任务失败: ${errorMsg}${errorDetail}`, 'error');
    }
}

function closeProgressModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    document.getElementById('progressModal').classList.remove('open');
}

async function cancelTask() {
    if (!aiCurrentTaskId) return;
    try {
        const res = await aiApiPost(`/ai-generation/cancel/${aiCurrentTaskId}`);
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
        if (typeof apiCache !== 'undefined') {
            apiCache.deleteByPrefix('/knowledge/');
        }
        let tree;
        if (aiCurrentModuleId) {
            const res = await aiApiGet(`/knowledge/tree/${aiCurrentModuleId}`);
            if (res.success) {
                tree = res.data;
            }
        } else {
            const res = await aiApiGet('/knowledge/global-tree');
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
                    <div class="ai-knowledge-group-header" data-toggle-group="library-${node.id}">
                        <span><span class="group-icon">📚</span>${aiEscapeHtml(node.name)}<span class="group-count">${childCount} 个文件</span></span>
                        <span class="expand-icon">▼</span>
                    </div>
                    <div class="ai-knowledge-list" id="library-${node.id}"></div>
                </div>`;
            } else if (node.type === 'module') {
                const childCount = countFiles(node.children);
                return `<div class="ai-knowledge-group" id="group-module-${node.id}">
                    <div class="ai-knowledge-group-header" data-toggle-group="module-${node.id}">
                        <span><span class="group-icon">📦</span>${aiEscapeHtml(node.name)}<span class="group-count">${childCount} 个文件</span></span>
                        <span class="expand-icon">▼</span>
                    </div>
                    <div class="ai-knowledge-list" id="module-${node.id}"></div>
                </div>`;
            } else if (node.type === 'folder') {
                const childCount = countFiles(node.children);
                return `<div class="ai-knowledge-group" id="group-folder-${node.id}">
                    <div class="ai-knowledge-group-header" data-toggle-group="folder-${node.id}">
                        <span><span class="group-icon">📁</span>${aiEscapeHtml(node.name)}<span class="group-count">${childCount} 个文件</span></span>
                        <span class="expand-icon">▼</span>
                    </div>
                    <div class="ai-knowledge-list" id="folder-${node.id}"></div>
                </div>`;
            } else {
                return renderKnowledgeRow(node);
            }
        }).join('');

        el.querySelectorAll('[data-toggle-group]').forEach(header => {
            header.addEventListener('click', function() {
                toggleKnowledgeGroup(this.dataset.toggleGroup);
            });
        });

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
            <div class="col sortable ${knowledgeSortColumn === 'name' ? (knowledgeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" data-sort-col="name">名称</div>
            <div class="col sortable ${knowledgeSortColumn === 'type' ? (knowledgeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" data-sort-col="type">类型</div>
            <div class="col sortable ${knowledgeSortColumn === 'size' ? (knowledgeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" data-sort-col="size">大小</div>
            <div class="col sortable ${knowledgeSortColumn === 'status' ? (knowledgeSortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" data-sort-col="status">状态</div>
            <div class="col">操作</div>
        </div>
        <div class="ai-knowledge-list-body">`;
    }

    modules.forEach(mod => {
        const childCount = countFiles(mod.children);
        html += `<div class="ai-knowledge-row folder-row" data-toggle-group="module-${mod.id}">
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
        const folderRealId = folder.realId || folder.id;
        const folderLibId = folder.libraryId || '';
        html += `<div class="ai-knowledge-row folder-row" data-toggle-group="folder-${folder.id}">
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
                <button class="action-btn" data-delete-folder="${folderRealId}" data-library-id="${folderLibId}" title="删除">🗑️</button>
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

    container.querySelectorAll('[data-sort-col]').forEach(col => {
        col.addEventListener('click', function() {
            sortKnowledgeList(this.dataset.sortCol);
        });
    });

    container.querySelectorAll('.folder-row[data-toggle-group]').forEach(row => {
        row.addEventListener('click', function() {
            toggleKnowledgeGroup(this.dataset.toggleGroup);
        });
    });

    container.querySelectorAll('[data-delete-folder]').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const folderId = parseInt(this.dataset.deleteFolder);
            const libraryId = this.dataset.libraryId ? parseInt(this.dataset.libraryId) : null;
            deleteKnowledgeFile(folderId, libraryId);
        });
    });

    container.querySelectorAll('.ai-file-checkbox').forEach(cb => {
        cb.addEventListener('click', function(e) {
            e.stopPropagation();
            const fileId = parseInt(this.dataset.fileId);
            toggleFileSelection(fileId);
            updateFileRowSelection(fileId);
        });
    });

    container.querySelectorAll('.ai-file-name-toggle').forEach(name => {
        name.addEventListener('click', function(e) {
            e.stopPropagation();
            const fileId = parseInt(this.dataset.fileId);
            toggleFileSelection(fileId);
            updateFileRowSelection(fileId);
        });
    });

    container.querySelectorAll('.ai-view-file-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            viewFileContent(parseInt(this.dataset.fileId));
        });
    });

    container.querySelectorAll('.ai-delete-file-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            deleteKnowledgeFile(parseInt(this.dataset.fileId));
        });
    });

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
            <input type="checkbox" class="ai-file-checkbox" ${isSelected ? 'checked' : ''} data-file-id="${file.id}">
        </div>
        <div class="col-name ai-file-name-toggle" data-file-id="${file.id}">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${aiEscapeHtml(file.name)}</span>
        </div>
        <div class="col-type">${fileType}</div>
        <div class="col-size">${fileSize}</div>
        <div class="col-status">${statusBadge}</div>
        <div class="col-actions">
            <button class="action-btn ai-view-file-btn" data-file-id="${file.id}" title="查看">👁️</button>
            <button class="action-btn ai-delete-file-btn" data-file-id="${file.id}" title="删除">🗑️</button>
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
    const drawerSelectAllCb = document.getElementById('drawerSelectAllCb');
    if (drawerSelectAllCb) {
        const total = document.querySelectorAll('#knowledgeTree .ai-knowledge-row[data-file-id]').length;
        drawerSelectAllCb.checked = total > 0 && count >= total;
        drawerSelectAllCb.indeterminate = count > 0 && count < total;
    }
}

function selectAllKnowledgeFiles() {
    document.querySelectorAll('#knowledgeTree .ai-knowledge-row[data-file-id]').forEach(row => {
        const fileId = parseInt(row.dataset.fileId);
        aiSelectedFiles.add(fileId);
        row.classList.add('selected');
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = true;
    });
    updateSelectionCount();
}

function deselectAllKnowledgeFiles() {
    document.querySelectorAll('#knowledgeTree .ai-knowledge-row[data-file-id]').forEach(row => {
        const fileId = parseInt(row.dataset.fileId);
        aiSelectedFiles.delete(fileId);
        row.classList.remove('selected');
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = false;
    });
    updateSelectionCount();
}

function toggleDrawerSelectAll() {
    const cb = document.getElementById('drawerSelectAllCb');
    if (cb.checked) {
        selectAllKnowledgeFiles();
    } else {
        deselectAllKnowledgeFiles();
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
        await aiApiPost('/knowledge/folder', { moduleId: aiCurrentModuleId, parentId: aiCurrentParentId || null, name });
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
            if (!token) {
                aiNotify('请先登录', 'error');
                continue;
            }
            const res = await fetch(AI_API_BASE + '/knowledge/upload', {
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
        if (!token) {
            aiNotify('请先登录', 'error');
            return;
        }
        const res = await fetch(AI_API_BASE + '/knowledge/upload', {
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
        const res = await aiApiGet(`/knowledge/file/content/${fileId}`);
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

async function deleteKnowledgeFile(fileId, libraryId) {
    if (!(await aiShowConfirmMessage('确定要删除吗？'))) return;
    try {
        const moduleId = aiCurrentModuleId || document.getElementById('moduleSelect').value;
        const params = new URLSearchParams();
        if (moduleId) params.set('moduleId', moduleId);
        if (libraryId) params.set('libraryId', libraryId);
        const res = await aiApiDelete(`/knowledge/file/${fileId}?${params.toString()}`);
        if (res && res.success === false) {
            aiNotify('删除失败', 'error');
            return;
        }
        aiSelectedFiles.delete(fileId);
        loadKnowledgeTree();
        loadKnowledgeFiles();
        aiNotify('删除成功', 'success');
    } catch (e) {
        aiNotify('删除失败', 'error');
    }
}

function collectSelectedFilesFromTree(nodes, selectedIds) {
    const results = [];
    if (!nodes) return results;
    for (const node of nodes) {
        if (node.type !== 'library' && node.type !== 'module' && node.type !== 'folder' && selectedIds.has(node.id)) {
            results.push({
                id: node.id,
                name: node.name,
                type: node.type || 'file',
                file_ext: node.fileExt || node.file_ext || '',
                file_size: node.fileSize || node.file_size || 0,
                parse_status: node.parseStatus || node.parse_status || '',
                chunk_count: node.chunkCount || node.chunk_count || 0,
                chunking_strategy: node.chunkingStrategy || node.chunking_strategy || ''
            });
        }
        if (node.children) {
            results.push(...collectSelectedFilesFromTree(node.children, selectedIds));
        }
    }
    return results;
}

async function confirmFileSelection() {
    if (aiCurrentModuleId) {
        await loadKnowledgeFiles();
    } else {
        const selectedFiles = collectSelectedFilesFromTree(knowledgeTreeData, aiSelectedFiles);
        renderFileList(selectedFiles);
    }
    closeKnowledgeDrawer();
}

async function loadTaskFilter() {
    try {
        const res = await aiApiGet('/ai-generation/tasks?limit=50');
        if (res.success) {
            const select = document.getElementById('taskFilter');
            const prevValue = select.value;
            select.innerHTML = '<option value="all">全部未合并用例</option>';
            (res.data.tasks || []).forEach(t => {
                const statusLabels = {
                    pending: '等待中',
                    processing: '处理中',
                    completed: '已完成',
                    partial_completed: '部分完成',
                    failed: '失败',
                    cancelled: '已取消'
                };
                const opt = document.createElement('option');
                opt.value = t.task_id;
                const statusLabel = statusLabels[t.status] || t.status;
                const caseInfo = t.total_cases ? ` ${t.total_cases}条用例` : '';
                opt.textContent = `${t.task_id} - ${t.module_name} (${statusLabel}${caseInfo})`;
                select.appendChild(opt);
            });
            if (prevValue) {
                select.value = prevValue;
                if (!select.value) {
                    select.value = 'all';
                    loadTempCases();
                }
            }
        }
    } catch (e) {}
}

async function cleanupEmptyTasks() {
    const confirmed = await showConfirmDialog(
        '清理空任务',
        '将清理所有没有未处理用例的已完成/失败/取消任务，这些任务将从下拉列表中移除。确认继续？',
        '确认清理',
        '取消'
    );
    if (!confirmed) return;

    try {
        const res = await aiApiPost('/ai-generation/cleanup-empty-tasks');
        if (res.success) {
            const count = res.data.cleanedCount || 0;
            if (count > 0) {
                aiNotify(`已清理 ${count} 个空任务`, 'success');
                const taskFilter = document.getElementById('taskFilter');
                const prevValue = taskFilter.value;
                await loadTaskFilter();
                const cleanedIds = res.data.cleanedTaskIds || [];
                if (cleanedIds.includes(prevValue)) {
                    taskFilter.value = 'all';
                    await loadTempCases();
                }
            } else {
                aiNotify('没有可清理的空任务', 'info');
            }
        } else {
            aiNotify(res.message || '清理失败', 'error');
        }
    } catch (e) {
        aiNotify('清理空任务失败', 'error');
    }
}

document.getElementById('cleanupEmptyTasksBtn')?.addEventListener('click', cleanupEmptyTasks);

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
        const sourceTypeFilter = document.getElementById('sourceTypeFilter').value;

        let params = new URLSearchParams();
        params.set('pageSize', '9999');
        if (search) params.set('search', search);
        if (statusFilter) params.set('status', statusFilter);
        if (duplicateFilter !== '') params.set('isDuplicate', duplicateFilter);
        if (sourceTypeFilter) params.set('sourceType', sourceTypeFilter);

        let res;
        if (filterValue === 'all') {
            res = await aiApiGet(`/temp-cases/all-active?${params.toString()}`);
        } else {
            res = await aiApiGet(`/temp-cases/list/${filterValue}?${params.toString()}`);
        }
        if (res.success) {
            allTempCases = res.data.cases || [];
            caseTotal = res.data.total || 0;
            renderCaseStats(res.data.stats);
            renderCaseTable(allTempCases);
            updateSelectedCount();
            renderPartialCompletedWarningFromData(filterValue, res.data.taskStatus);
        }
    } catch (e) {}
}

function renderPartialCompletedWarningFromData(filterValue, taskStatus) {
    const warningContainer = document.getElementById('partialCompletedWarning');
    if (!warningContainer) return;

    if (filterValue === 'all' || !taskStatus) {
        warningContainer.style.display = 'none';
        return;
    }

    if (taskStatus.status === 'partial_completed') {
        const completedChunks = taskStatus.completed_chunks || 0;
        const failedChunks = taskStatus.failed_chunks || 0;
        const totalCases = taskStatus.total_cases || 0;
        warningContainer.innerHTML = `
            <div class="ai-partial-warning">
                <span class="ai-partial-warning-icon">⚠️</span>
                <span>此任务部分完成：成功${completedChunks}块，失败${failedChunks}块，已生成${totalCases}条用例。失败的文本块可点击"重试"重新生成。</span>
                <button class="ai-btn ai-btn-sm ai-btn-warning" id="partialRetryBtn" data-task-id="${aiEscapeHtml(filterValue)}">重试失败块</button>
            </div>
        `;
        warningContainer.style.display = 'block';
        const retryBtn = document.getElementById('partialRetryBtn');
        if (retryBtn) {
            retryBtn.addEventListener('click', function() {
                retryTaskAndRefresh(this.dataset.taskId);
            });
        }
    } else {
        warningContainer.style.display = 'none';
    }
}

async function renderPartialCompletedWarning(filterValue) {
    const warningContainer = document.getElementById('partialCompletedWarning');
    if (!warningContainer) return;

    if (filterValue === 'all') {
        warningContainer.style.display = 'none';
        return;
    }

    try {
        const taskRes = await aiApiGet(`/ai-generation/task/${filterValue}`);
        if (taskRes.success && taskRes.data.status === 'partial_completed') {
            const task = taskRes.data;
            const completedChunks = task.completed_chunks || 0;
            const failedChunks = task.failed_chunks || 0;
            const totalCases = task.total_cases || 0;
            warningContainer.innerHTML = `
                <div class="ai-partial-warning">
                    <span class="ai-partial-warning-icon">⚠️</span>
                    <span>此任务部分完成：成功${completedChunks}块，失败${failedChunks}块，已生成${totalCases}条用例。失败的文本块可点击"重试"重新生成。</span>
                    <button class="ai-btn ai-btn-sm ai-btn-warning" id="partialRetryBtn" data-task-id="${aiEscapeHtml(filterValue)}">重试失败块</button>
                </div>
            `;
            warningContainer.style.display = 'block';
            const retryBtn = document.getElementById('partialRetryBtn');
            if (retryBtn) {
                retryBtn.addEventListener('click', function() {
                    retryTask(this.dataset.taskId);
                });
            }
        } else {
            warningContainer.style.display = 'none';
        }
    } catch (e) {
        warningContainer.style.display = 'none';
    }
}

function renderCaseStats(stats) {
    if (!stats) return;
    document.getElementById('caseStats').innerHTML = `
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.total || 0}</div><div class="ai-stat-label">总计</div></div>
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.pending || 0}</div><div class="ai-stat-label">待确认</div></div>
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.approved || 0}</div><div class="ai-stat-label">已批准</div></div>
        <div class="ai-stat-card"><div class="ai-stat-value">${stats.rejected || 0}</div><div class="ai-stat-label">已拒绝</div></div>
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
                    const sourceBadge = c.source_type === 'import_optimize'
                        ? '<span class="ai-imp-source-badge ai-imp-import-optimize">导入优化</span>'
                        : '<span class="ai-imp-source-badge ai-imp-ai-generation">AI生成</span>';

                    rows += `<tr class="ai-tree-case-row ${visible ? '' : 'ai-tree-row-hidden'}" data-lib="${aiEscapeHtml(libName)}" data-module="${aiEscapeHtml(modName)}" data-level1="${aiEscapeHtml(level1Name)}" data-type="case" data-case-id="${aiEscapeHtml(c.temp_case_id)}" data-l1-key="${aiEscapeHtml(l1Key)}" data-mod-key="${aiEscapeHtml(modKey)}">
                        <td class="col-checkbox"><input type="checkbox" class="ai-tree-checkbox" ${checked} data-case-check="${aiEscapeHtml(c.temp_case_id)}"></td>
                        <td class="col-name">
                            <div class="ai-tree-name-cell">
                                <span class="ai-tree-indent"></span>
                                <span class="ai-tree-indent"></span>
                                <span class="ai-tree-indent"></span>
                                <a href="javascript:void(0)" class="ai-tree-case-name" data-view-case="${aiEscapeHtml(c.temp_case_id)}" data-source-type="${aiEscapeHtml(c.source_type || 'ai_generation')}">${aiEscapeHtml(c.name)}</a>
                                ${sourceBadge}
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
    const overwriteMergeBtn = document.getElementById('overwriteMergeBtn');
    if (countEl) {
        countEl.textContent = selectedCases.size;
        countEl.style.display = selectedCases.size > 0 ? 'inline-flex' : 'none';
    }
    if (clearBtn) {
        clearBtn.style.display = selectedCases.size > 0 ? 'inline-flex' : 'none';
    }
    // 覆盖合并按钮：仅当选中的用例中包含 import_optimize 类型时显示
    if (overwriteMergeBtn) {
        const hasImportOptimize = allTempCases.some(c => selectedCases.has(c.temp_case_id) && c.source_type === 'import_optimize');
        overwriteMergeBtn.style.display = hasImportOptimize ? 'inline-flex' : 'none';
    }
}

async function viewCaseDetail(tempCaseId) {
    try {
        const res = await aiApiGet(`/temp-cases/detail/${tempCaseId}`);
        if (res.success) {
            const c = res.data;

            // import_optimize 类型用例显示对比视图
            if (c.source_type === 'import_optimize' && c.formal_case_id) {
                await showCompareView(tempCaseId, c);
                return;
            }

            document.getElementById('caseDetailBody').innerHTML = `
                <div class="ai-form-group"><label>用例名称</label><p>${aiEscapeHtml(c.name)}</p></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div class="ai-form-group"><label>优先级</label><p>${aiEscapeHtml(c.priority)}</p></div>
                    <div class="ai-form-group"><label>类型</label><p>${aiEscapeHtml(c.type)}</p></div>
                </div>
                <div class="ai-form-group"><label>前置条件</label><p>${aiEscapeHtml(c.precondition) || '无'}</p></div>
                <div class="ai-form-group"><label>测试目的</label><p>${aiEscapeHtml(c.purpose) || '无'}</p></div>
                <div class="ai-form-group"><label>测试步骤</label><pre style="white-space:pre-wrap;background:var(--color-bg-secondary, #f8fafc);padding:12px;border-radius:8px;">${aiEscapeHtml(c.steps)}</pre></div>
                <div class="ai-form-group"><label>预期结果</label><pre style="white-space:pre-wrap;background:var(--color-bg-secondary, #f8fafc);padding:12px;border-radius:8px;">${aiEscapeHtml(c.expected)}</pre></div>
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

async function showCompareView(tempCaseId, tempCase) {
    try {
        const formalRes = await aiApiGet(`/temp-cases/formal-case/${tempCase.formal_case_id}`);
        if (!formalRes.success) {
            aiNotify('无法加载原始正式用例', 'error');
            return;
        }
        const formalCase = formalRes.data;

        let fieldChanges = {};
        if (tempCase.field_changes) {
            try {
                fieldChanges = typeof tempCase.field_changes === 'string'
                    ? JSON.parse(tempCase.field_changes)
                    : tempCase.field_changes;
            } catch (e) { fieldChanges = {}; }
        }

        const compareFields = [
            { key: 'name', label: '用例名称' },
            { key: 'priority', label: '优先级' },
            { key: 'type', label: '类型' },
            { key: 'precondition', label: '前置条件' },
            { key: 'purpose', label: '测试目的' },
            { key: 'steps', label: '测试步骤' },
            { key: 'expected', label: '预期结果' },
            { key: 'key_config', label: '关键配置' },
            { key: 'remark', label: '备注' }
        ];

        const changedCount = Object.keys(fieldChanges).filter(k => k !== '_optimization_notes').length;
        const optimizationNotes = tempCase.optimization_notes || '';

        let leftHtml = '';
        let rightHtml = '';
        for (const field of compareFields) {
            const oldVal = formalCase[field.key] || '';
            const newVal = tempCase[field.key] || '';
            const isChanged = fieldChanges.hasOwnProperty(field.key);
            const changedClass = isChanged ? ' changed' : '';
            const changeTag = isChanged ? ' <span style="color:#d97706;font-size:11px;">(已变更)</span>' : '';

            leftHtml += `
                <div class="ai-imp-compare-field${changedClass}">
                    <div class="ai-imp-compare-field-label">${aiEscapeHtml(field.label)}${changeTag}</div>
                    <div class="ai-imp-compare-field-value"><pre style="white-space:pre-wrap;margin:0;font-size:13px;">${aiEscapeHtml(oldVal) || '<span style="color:#94a3b8;">(空)</span>'}</pre></div>
                </div>
            `;
            rightHtml += `
                <div class="ai-imp-compare-field${changedClass}">
                    <div class="ai-imp-compare-field-label">${aiEscapeHtml(field.label)}${changeTag}</div>
                    <div class="ai-imp-compare-field-value"><pre style="white-space:pre-wrap;margin:0;font-size:13px;">${aiEscapeHtml(newVal) || '<span style="color:#94a3b8;">(空)</span>'}</pre></div>
                </div>
            `;
        }

        document.getElementById('caseDetailBody').innerHTML = `
            <div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
                <span class="ai-imp-source-badge ai-imp-import-optimize">导入优化</span>
                <span style="font-size:14px;color:var(--ai-text-secondary);">共 ${changedCount} 个字段变更</span>
            </div>
            <div class="ai-imp-compare-container">
                <div class="ai-imp-compare-panel">
                    <div class="ai-imp-compare-panel-header">原始用例 (ID: ${aiEscapeHtml(String(formalCase.id))})</div>
                    ${leftHtml}
                </div>
                <div class="ai-imp-compare-panel">
                    <div class="ai-imp-compare-panel-header">AI优化版本</div>
                    ${rightHtml}
                </div>
            </div>
            ${optimizationNotes ? `
                <div style="margin-top:16px;padding:12px 16px;background:var(--color-warning-bg, #fffbeb);border:1px solid var(--color-warning, #fde68a);border-radius:8px;">
                    <div style="font-size:13px;font-weight:600;color:var(--color-warning, #92400e);margin-bottom:4px;">优化说明</div>
                    <div style="font-size:13px;color:var(--color-text-secondary, #78350f);line-height:1.6;">${aiEscapeHtml(optimizationNotes)}</div>
                </div>
            ` : ''}
        `;

        const saveBtn = document.getElementById('caseDetailSaveBtn');
        saveBtn.style.display = 'none';

        const footer = document.querySelector('#caseDetailModal .ai-modal-footer');
        // 清除之前的按钮
        const oldEditBtn = document.getElementById('caseDetailEditBtn');
        if (oldEditBtn) oldEditBtn.remove();
        const oldRejectBtn = document.getElementById('caseDetailRejectBtn');
        if (oldRejectBtn) oldRejectBtn.remove();
        const oldAcceptEditBtn = document.getElementById('caseDetailAcceptEditBtn');
        if (oldAcceptEditBtn) oldAcceptEditBtn.remove();
        const oldAcceptOverwriteBtn = document.getElementById('caseDetailAcceptOverwriteBtn');
        if (oldAcceptOverwriteBtn) oldAcceptOverwriteBtn.remove();

        // 拒绝按钮
        const rejectBtn = document.createElement('button');
        rejectBtn.id = 'caseDetailRejectBtn';
        rejectBtn.className = 'ai-btn ai-btn-danger';
        rejectBtn.textContent = '拒绝';
        rejectBtn.addEventListener('click', async function() {
            if (!(await aiShowConfirmMessage('确定要拒绝此优化用例吗？'))) return;
            try {
                await aiApiPost('/temp-cases/batch-reject', { tempCaseIds: [tempCaseId] });
                aiNotify('已拒绝', 'success');
                aiCloseAllModals();
                loadTempCases();
            } catch (e) { aiNotify('操作失败', 'error'); }
        });
        footer.insertBefore(rejectBtn, saveBtn);

        // 编辑并接受按钮
        const acceptEditBtn = document.createElement('button');
        acceptEditBtn.id = 'caseDetailAcceptEditBtn';
        acceptEditBtn.className = 'ai-btn ai-btn-outline';
        acceptEditBtn.textContent = '编辑并接受';
        acceptEditBtn.addEventListener('click', function() {
            editCaseDetail(tempCaseId);
        });
        footer.insertBefore(acceptEditBtn, saveBtn);

        // 接受并覆盖按钮
        const acceptOverwriteBtn = document.createElement('button');
        acceptOverwriteBtn.id = 'caseDetailAcceptOverwriteBtn';
        acceptOverwriteBtn.className = 'ai-btn ai-btn-primary';
        acceptOverwriteBtn.textContent = '接受并覆盖';
        acceptOverwriteBtn.addEventListener('click', async function() {
            if (!(await aiShowConfirmMessage('确定要用AI优化版本覆盖原始正式用例吗？此操作不可撤销。'))) return;
            try {
                const res = await aiApiPost('/ai-import/merge-with-overwrite', {
                    temp_case_ids: [tempCaseId],
                    overwrite_mode: 'smart'
                });
                if (res.success) {
                    aiNotify(`覆盖合并成功，共合并 ${res.data.merged_count} 个用例`, 'success');
                    aiCloseAllModals();
                    loadTempCases();
                } else {
                    aiNotify(res.message || '覆盖合并失败', 'error');
                }
            } catch (e) { aiNotify('操作失败', 'error'); }
        });
        footer.insertBefore(acceptOverwriteBtn, saveBtn);

        initCaseDetailDragResize();
        document.getElementById('aiGenOverlay').classList.add('show');
        document.getElementById('caseDetailModal').classList.add('open');
    } catch (e) {
        aiNotify('加载对比视图失败', 'error');
    }
}

function showOverwriteMergeModal() {
    const importOptimizeCases = allTempCases.filter(c => selectedCases.has(c.temp_case_id) && c.source_type === 'import_optimize' && c.formal_case_id);
    if (importOptimizeCases.length === 0) {
        aiNotify('请选择导入优化类型的用例', 'warning');
        return;
    }

    // 创建模态框
    let modal = document.getElementById('ai-imp-merge-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'ai-imp-merge-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

    let caseRowsHtml = '';
    importOptimizeCases.forEach(c => {
        let changeSummary = '';
        try {
            const changes = typeof c.field_changes === 'string' ? JSON.parse(c.field_changes) : (c.field_changes || {});
            const changeKeys = Object.keys(changes).filter(k => k !== '_optimization_notes');
            changeSummary = changeKeys.map(k => aiEscapeHtml(k)).join(', ') || '无变更';
        } catch (e) {
            changeSummary = '无法解析';
        }
        caseRowsHtml += `
            <tr>
                <td style="padding:8px 12px;border-bottom:1px solid var(--color-border-primary, #e2e8f0);font-size:13px;">${aiEscapeHtml(c.name)}</td>
                <td style="padding:8px 12px;border-bottom:1px solid var(--color-border-primary, #e2e8f0);font-size:13px;">${changeSummary}</td>
            </tr>
        `;
    });

    modal.innerHTML = `
        <div class="ai-imp-merge-modal">
            <div class="ai-imp-merge-modal-header">
                <h3>覆盖合并到正式库</h3>
                <button class="ai-close-btn" id="aiImpMergeCloseBtn">&times;</button>
            </div>
            <div class="ai-imp-merge-modal-body">
                <div style="margin-bottom:16px;">
                    <p style="font-size:14px;color:var(--color-text-secondary, #475569);margin-bottom:12px;">以下 <strong>${importOptimizeCases.length}</strong> 个导入优化用例将覆盖合并到正式用例库：</p>
                    <table class="ai-imp-merge-table">
                        <thead>
                            <tr>
                                <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--color-text-secondary, #64748b);background:var(--color-bg-secondary, #f8fafc);border-bottom:1px solid var(--color-border-primary, #e2e8f0);">用例名称</th>
                                <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--color-text-secondary, #64748b);background:var(--color-bg-secondary, #f8fafc);border-bottom:1px solid var(--color-border-primary, #e2e8f0);">变更字段</th>
                            </tr>
                        </thead>
                        <tbody>${caseRowsHtml}</tbody>
                    </table>
                </div>
                <div style="margin-bottom:16px;">
                    <label style="display:block;font-size:14px;font-weight:500;margin-bottom:8px;color:var(--color-text-primary, #1e293b);">覆盖模式</label>
                    <div style="display:flex;gap:12px;flex-wrap:wrap;">
                        <label class="ai-radio-item active" data-merge-mode="smart">
                            <input type="radio" name="overwriteMode" value="smart" checked style="accent-color:var(--ai-primary);">
                            <span><strong>智能覆盖</strong> - 仅覆盖AI变更的字段</span>
                        </label>
                        <label class="ai-radio-item" data-merge-mode="full">
                            <input type="radio" name="overwriteMode" value="full" style="accent-color:var(--ai-primary);">
                            <span><strong>完全覆盖</strong> - 用AI版本覆盖所有字段</span>
                        </label>
                        <label class="ai-radio-item" data-merge-mode="partial">
                            <input type="radio" name="overwriteMode" value="partial" style="accent-color:var(--ai-primary);">
                            <span><strong>部分覆盖</strong> - 覆盖所有变更字段(含手动指定)</span>
                        </label>
                    </div>
                </div>
            </div>
            <div class="ai-imp-merge-modal-footer">
                <button class="ai-btn ai-btn-ghost" id="aiImpMergeCancelBtn">取消</button>
                <button class="ai-btn ai-btn-primary" id="aiImpMergeConfirmBtn">确认覆盖合并</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 事件绑定
    document.getElementById('aiImpMergeCloseBtn').addEventListener('click', function() {
        modal.remove();
    });
    document.getElementById('aiImpMergeCancelBtn').addEventListener('click', function() {
        modal.remove();
    });
    modal.addEventListener('click', function(e) {
        if (e.target === modal) modal.remove();
    });

    // 覆盖模式单选切换样式
    modal.querySelectorAll('input[name="overwriteMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            modal.querySelectorAll('.ai-radio-item').forEach(item => item.classList.remove('active'));
            this.closest('.ai-radio-item').classList.add('active');
        });
    });

    document.getElementById('aiImpMergeConfirmBtn').addEventListener('click', async function() {
        const overwriteMode = modal.querySelector('input[name="overwriteMode"]:checked').value;
        const tempCaseIds = importOptimizeCases.map(c => c.temp_case_id);

        try {
            const res = await aiApiPost('/ai-import/merge-with-overwrite', {
                temp_case_ids: tempCaseIds,
                overwrite_mode: overwriteMode
            });
            if (res.success) {
                aiNotify(`覆盖合并成功，共合并 ${res.data.merged_count} 个用例${res.data.failed_count > 0 ? '，失败 ' + res.data.failed_count + ' 个' : ''}`, 'success');
                modal.remove();
                selectedCases.clear();
                updateSelectedCount();
                loadTaskFilter();
                loadTempCases();
            } else {
                aiNotify(res.message || '覆盖合并失败', 'error');
            }
        } catch (e) {
            aiNotify('覆盖合并操作失败', 'error');
        }
    });
}

async function editCaseDetail(tempCaseId) {
    try {
        const res = await aiApiGet(`/temp-cases/detail/${tempCaseId}`);
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
        await aiApiPut(`/temp-cases/update/${tempCaseId}`, updates);
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
        await aiApiPost('/temp-cases/batch-delete', { tempCaseIds: [tempCaseId] });
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
            aiApiGet('/users/usernames'),
            aiApiGet('/projects/list')
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
                label.innerHTML = `<input type="checkbox" value="${parseInt(project.id) || 0}"> ${aiEscapeHtml(project.name)}`;
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
        await aiApiPost('/temp-cases/batch-edit', {
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
        await aiApiPost('/temp-cases/batch-approve', { tempCaseIds: Array.from(selectedCases) });
        aiNotify('批量批准成功', 'success');
        selectedCases.clear();
        updateSelectedCount();
        loadTempCases();
    } catch (e) {}
}

async function batchReject() {
    if (selectedCases.size === 0) { aiNotify('请先选择用例', 'warning'); return; }
    try {
        await aiApiPost('/temp-cases/batch-reject', { tempCaseIds: Array.from(selectedCases) });
        aiNotify('批量拒绝成功', 'success');
        selectedCases.clear();
        updateSelectedCount();
        loadTaskFilter();
        loadTempCases();
    } catch (e) {}
}

async function batchDelete() {
    if (selectedCases.size === 0) { aiNotify('请先选择用例', 'warning'); return; }
    if (!(await aiShowConfirmMessage(`确定要删除 ${selectedCases.size} 个用例吗？`))) return;
    try {
        await aiApiPost('/temp-cases/batch-delete', { tempCaseIds: Array.from(selectedCases) });
        aiNotify('批量删除成功', 'success');
        selectedCases.clear();
        updateSelectedCount();
        loadTaskFilter();
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
            res = await aiApiPost('/temp-cases/batch-merge', {
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
            res = await aiApiPost(`/temp-cases/submit-review/${tid}`, {
                tempCaseIds: Array.from(selectedCases),
                taskId: taskId && taskId !== 'all' ? taskId : undefined,
                libraryId: mergeLibraryId || undefined,
                reviewerIds,
                deadline
            });
        }

        if (res.success) {
            const mergedCount = res.data && res.data.mergedCount;
            if (currentMergeMode === 'review') {
                aiNotify('已提交评审，等待评审人确认！', 'success');
            } else if (mergedCount === 0) {
                aiNotify('没有可合并的用例（可能全部被标记为重复）', 'warning');
            } else {
                aiNotify(`已合并进库！共合并 ${mergedCount} 个用例`, 'success');
            }
            closeMergeModal();
            selectedCases.clear();
            loadTaskFilter();
            loadTempCases();
        } else {
            aiNotify(res.message || '操作失败', 'error');
        }
    } catch (e) {
        console.error('合并操作失败:', e);
        aiNotify(e.message || '合并操作失败，请重试', 'error');
    }
}

async function loadReviewList() {
    reviewPage = 1;
    await loadReviewPage();
}

async function loadReviewPage(page) {
    if (page !== undefined) reviewPage = page;
    try {
        const offset = (reviewPage - 1) * reviewPageSize;
        const res = await aiApiGet(`/temp-cases/pending-review?limit=${reviewPageSize}&offset=${offset}`);
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
        const res = await aiApiGet(`/temp-cases/list/${taskId}?status=approved&review_status=pending`);
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

            const result = await aiApiPost(`/temp-cases/review/${taskId}`, { reviews });
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
        const res = await aiApiPost('/knowledge/crawl', {
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
        const res = await aiApiGet(`/ai-generation/tasks?limit=${taskHistoryPageSize}&offset=${offset}`);
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
                    const statusLabels = {
                        pending: '等待中',
                        processing: '处理中',
                        completed: '已完成',
                        partial_completed: '部分完成',
                        failed: '失败',
                        cancelled: '已取消'
                    };
                    const statusLabel = statusLabels[t.status] || t.status;
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${aiEscapeHtml(t.task_id)}</td>
                        <td>${aiEscapeHtml(t.module_name)}</td>
                        <td><span class="ai-status-badge ai-status-${aiEscapeHtml(t.status)}">${aiEscapeHtml(statusLabel)}</span></td>
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
                    if (t.status === 'failed' || t.status === 'partial_completed') {
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
window.showOverwriteMergeModal = showOverwriteMergeModal;

function viewTaskResult(taskId) {
    closeTaskHistoryModal();
    switchTab('preview', { taskId });
}

async function retryTask(taskId) {
    try {
        const res = await aiApiPost(`/ai-generation/retry/${taskId}`);
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

async function retryTaskAndRefresh(taskId) {
    try {
        const res = await aiApiPost(`/ai-generation/retry/${taskId}`);
        if (res.success) {
            aiNotify('任务已重新提交，请稍候...', 'success');
            const warningContainer = document.getElementById('partialCompletedWarning');
            if (warningContainer) warningContainer.style.display = 'none';
            await loadTaskFilter();
            const taskFilter = document.getElementById('taskFilter');
            if (taskFilter) {
                taskFilter.value = taskId;
                await loadTempCasesPage();
            }
        } else {
            aiNotify(res.message || '重试任务失败', 'error');
        }
    } catch (e) {
        console.error('[AI Generation] retryTaskAndRefresh error:', e);
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

function initAgentsDragResize() {
    const modal = document.getElementById('agentsModal');
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

async function showAgentsViewer() {
    try {
        const res = await aiApiGet('/ai-sub-agents/list?category=test_generation');
        if (res.success) {
            renderAgentsList(res.data || []);
            document.getElementById('agentViewPanel').style.display = 'none';
            document.getElementById('agentsEmptyHint').style.display = 'flex';
            initAgentsDragResize();
            const closeViewBtn = document.getElementById('btnCloseAgentView');
            if (closeViewBtn && !closeViewBtn.dataset.bound) {
                closeViewBtn.dataset.bound = '1';
                closeViewBtn.addEventListener('click', function() {
                    document.getElementById('agentViewPanel').style.display = 'none';
                    document.getElementById('agentsEmptyHint').style.display = 'flex';
                    currentSelectedAgentId = null;
                    document.querySelectorAll('#agentsList .ai-skill-card').forEach(c => c.classList.remove('active'));
                });
            }
            document.getElementById('aiGenOverlay').classList.add('show');
            document.getElementById('agentsModal').classList.add('open');
        }
    } catch (e) {}
}

const CATEGORY_MAP = {
    'test_generation': '用例生成',
    'test_review': '用例评审',
    'data_analysis': '数据分析',
    'assistant': '通用助手'
};

function renderAgentsList(agents) {
    const container = document.getElementById('agentsList');
    container.innerHTML = '';
    if (agents.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px 16px;color:var(--ai-text-secondary);font-size:14px;">暂无可用代理<br>请在配置中心创建</div>';
        return;
    }
    agents.forEach(a => {
        const card = document.createElement('div');
        card.className = 'ai-skill-card';
        card.dataset.agentId = a.id;
        if (currentSelectedAgentId === a.id) {
            card.classList.add('active');
        }
        const statusIcon = a.isEnabled ? '✅' : '⏸️';
        const typeBadge = a.isSystem
            ? '<span class="ai-skill-badge ai-skill-badge-system">内置</span>'
            : (a.isOverridden
                ? '<span class="ai-skill-badge ai-skill-badge-system">内置</span><span class="ai-skill-badge ai-skill-badge-custom" style="margin-left:4px;">已自定义</span>'
                : '<span class="ai-skill-badge ai-skill-badge-custom">自定义</span>');
        card.innerHTML = `
            <div class="ai-skill-name">${aiEscapeHtml(a.displayName)} ${typeBadge}</div>
            <div class="ai-skill-desc">${statusIcon} ${aiEscapeHtml(a.description || '无描述')}</div>
        `;
        card.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            currentSelectedAgentId = a.id;
            document.querySelectorAll('#agentsList .ai-skill-card').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            viewAgentDetail(a.id, a.agentCode);
        });
        container.appendChild(card);
    });
}

async function viewAgentDetail(agentId, agentCode) {
    try {
        const res = await aiApiGet(`/ai-sub-agents/detail/${encodeURIComponent(agentCode)}`);
        if (res.success) {
            const agent = res.data.agent;
            const configFiles = res.data.configFiles || [];
            const memoryStats = res.data.memoryStats || {};
            currentSelectedAgentId = agentId;

            document.getElementById('agentViewTitle').textContent = agent.displayName || '';
            document.getElementById('agentViewCode').textContent = agent.agentCode || '';
            const isSystem = agent.isSystem === true || agent.is_system === 1;
            const isOverridden = agent.isOverridden === true;
            let typeHtml = isSystem
                ? '<span class="ai-skill-badge ai-skill-badge-system">内置</span>'
                : '<span class="ai-skill-badge ai-skill-badge-custom">自定义</span>';
            if (isOverridden) {
                typeHtml += ' <span class="ai-skill-badge ai-skill-badge-custom" style="margin-left:4px;">已自定义</span>';
            }
            document.getElementById('agentViewType').innerHTML = typeHtml;
            const categoryLabel = CATEGORY_MAP[agent.category] || agent.category || '-';
            document.getElementById('agentViewCategory').textContent = categoryLabel;
            document.getElementById('agentViewStatus').innerHTML = agent.isEnabled
                ? '<span style="color:#16a34a;">✅ 已启用</span>'
                : '<span style="color:#dc2626;">⏸️ 已禁用</span>';
            document.getElementById('agentViewDesc').textContent = agent.description || '无描述';
            document.getElementById('agentViewModel').textContent = agent.model || '默认模型';

            const memEnabled = agent.memoryEnabled;
            if (memEnabled) {
                const globalCount = (memoryStats.global && memoryStats.global.count) || 0;
                const libraryCount = (memoryStats.library && memoryStats.library.count) || 0;
                const moduleCount = (memoryStats.module && memoryStats.module.count) || 0;
                const totalChars = memoryStats.totalChars || 0;
                document.getElementById('agentViewMemory').innerHTML =
                    `<span style="color:${ThemeService.isDarkMode() ? '#34d399' : '#16a34a'};">✅ 已启用</span> — 全局: ${globalCount}条 | 用例库: ${libraryCount}条 | 模块: ${moduleCount}条 | 共 ${totalChars} 字符`;
            } else {
                document.getElementById('agentViewMemory').innerHTML = '<span style="color:#94a3b8;">⏸️ 未启用</span>';
            }

            const configSection = document.getElementById('agentConfigFilesSection');
            configSection.innerHTML = '';
            if (configFiles.length > 0) {
                const sectionTitle = document.createElement('div');
                sectionTitle.style.cssText = `margin-top:12px;margin-bottom:8px;font-weight:600;font-size:14px;color:var(--ai-text, ${ThemeService.getColor('textPrimary')});`;
                sectionTitle.textContent = '配置文件';
                configSection.appendChild(sectionTitle);
                configFiles.forEach(f => {
                    const FILE_TYPE_LABELS = {
                        'soul': 'Soul.md (灵魂)',
                        'user': 'User.md (用户模板)',
                        'tools': 'Tools.md (工具)',
                        'rule': 'Rule.md (规则链)',
                        'checklist': 'Checklist.md (检查清单)',
                        'examples': 'Examples.md (示例)',
                        'glossary': 'Glossary.md (术语表)',
                        'template': 'Template.md (模板)',
                        'ref_doc': '参考文档',
                        'custom': '自定义'
                    };
                    const label = FILE_TYPE_LABELS[f.fileType] || f.fileType;
                    const preview = (f.content || '').substring(0, 500);
                    const needEllipsis = (f.content || '').length > 500;
                    const row = document.createElement('div');
                    row.className = 'ai-skill-detail-row';
                    row.style.cssText = 'flex-direction:column;gap:6px;margin-bottom:8px;';
                    const pre = document.createElement('pre');
                    pre.className = 'ai-skill-detail-pre';
                    pre.style.cssText = 'overflow-y:auto;' + (needEllipsis ? 'position:relative;' : '');
                    pre.textContent = preview;
                    if (needEllipsis) {
                        const ellipsis = document.createElement('span');
                        const c = ThemeService.getColors();
                        ellipsis.style.cssText = `position:sticky;bottom:0;display:block;text-align:center;background:linear-gradient(transparent,${c.bgSurface} 70%);padding:12px 0 0;color:var(--ai-text-secondary, ${c.textSecondary});font-size:12px;cursor:pointer;`;
                        ellipsis.textContent = '...点击下方前往配置中心查看完整内容';
                        pre.appendChild(ellipsis);
                    }
                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'ai-skill-detail-label';
                    labelSpan.textContent = label;
                    row.appendChild(labelSpan);
                    row.appendChild(pre);
                    configSection.appendChild(row);
                });
            }

            const goBtn = document.getElementById('agentGoToConfig');
            goBtn.onclick = function() {
                closeAgentsModal();
                window.location.hash = '#/settings?config=ai-sub-agents';
            };

            document.getElementById('agentsEmptyHint').style.display = 'none';
            document.getElementById('agentViewPanel').style.display = 'flex';
        }
    } catch (e) {
        console.error('[viewAgentDetail] Error:', e);
    }
}

function closeAgentsModal() {
    document.getElementById('aiGenOverlay').classList.remove('show');
    const modal = document.getElementById('agentsModal');
    modal.classList.remove('open');
    modal.style.width = '';
    modal.style.height = '';
    currentSelectedAgentId = null;
    document.getElementById('agentViewPanel').style.display = 'none';
    document.getElementById('agentsEmptyHint').style.display = 'flex';
}

/**
 * 从知识库跳转到 AI 生成页面时，自动填充上下文
 * 在 script.js 的路由处理中调用
 */
function applyAIGenerationContext() {
    const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const libraryId = urlParams.get('libraryId');
    const moduleId = urlParams.get('moduleId');
    const selectedFiles = urlParams.get('selectedFiles');

    if (!libraryId && !moduleId) return;

    if (selectedFiles) {
        aiPrefillFileIds = selectedFiles.split(',').map(Number).filter(n => !isNaN(n));
    }

    const cleanHash = window.location.hash.split('?')[0];
    history.replaceState(null, '', cleanHash);

    switchTab('generate');

    const libSelect = document.getElementById('librarySelect');
    if (libraryId && libSelect) {
        libSelect.value = libraryId;
        aiCurrentLibraryId = parseInt(libraryId);
    }

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