/**
 * Knowledge Library Module
 */
let klEventListenersInitialized = false;

function klInvalidateApiCache() {
    if (typeof apiCache !== 'undefined') {
        apiCache.deleteByPrefix('/knowledge/');
    }
}

function initKnowledgeLibrary() {
    if (!klEventListenersInitialized) {
        klEventListenersInitialized = true;
        initKLEventListeners();
    }
    if (checkKLLoginStatus()) {
        loadKLLibraries();
    }
}

const KL_API_BASE = '';
let klCurrentLibraryId = null;
let klCurrentModuleId = null;
let klCurrentParentId = null;
let klCurrentFolderId = null; // 用于跟踪用例库级别的文件夹
let klCurrentFiles = [];
let klSelectedFiles = new Set();
let klViewMode = 'list';
let klSortField = 'name';
let klSortOrder = 'asc';
let klLibraries = [];
let klModulesMap = {};
let klLibraryFoldersMap = {}; // 用例库级别的文件夹 { libraryId: [folders] }
let klModuleFileCounts = {};
let klTreeData = [];
let klConfirmCallback = null;
let klContextMenuTarget = null;
let klTreeContextMenuTarget = null;
let klCurrentPreviewFileId = null;
let klNotificationOffset = 0;
let klPendingUploadFiles = [];
let klSelectedFileModuleMap = {};

function klEscapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML.replace(/'/g, '&#039;').replace(/"/g, '&quot;');
}

function klFormatDateTime(dateStr) {
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

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
    } catch (e) {
        return dateStr;
    }
}

function klGetAuthHeaders() {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function klApiGet(url) {
    const res = await fetch(KL_API_BASE + url, { headers: klGetAuthHeaders() });
    if (res.status === 401) { 
        showKLLoginPrompt();
        return null; 
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function showKLLoginPrompt() {
    const section = document.getElementById('knowledge-section');
    if (!section) return;
    section.querySelector('#treeContainer').innerHTML = '<div class="kl-empty"><div class="icon">🔐</div><div class="title">请先登录</div><p>您需要登录后才能访问知识库</p></div>';
    section.querySelector('#fileArea').innerHTML = '';
    // Try to navigate to login via Router if available
    if (typeof Router !== 'undefined' && Router.navigateTo) {
        Router.navigateTo('login');
    }
}

function checkKLLoginStatus() {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    if (!token) {
        showKLLoginPrompt();
        return false;
    }
    return true;
}

async function klApiPost(url, data) {
    const res = await fetch(KL_API_BASE + url, {
        method: 'POST', headers: klGetAuthHeaders(), body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function klApiPut(url, data) {
    const res = await fetch(KL_API_BASE + url, {
        method: 'PUT', headers: klGetAuthHeaders(), body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function klApiDelete(url) {
    const res = await fetch(KL_API_BASE + url, { method: 'DELETE', headers: klGetAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function klNotify(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `kl-notification kl-notification-${type}`;
    el.textContent = message;
    const existingNotifications = document.querySelectorAll('#knowledge-section .kl-notification');
    const offset = existingNotifications.length * 60;
    el.style.top = (20 + offset) + 'px';
    const section = document.getElementById('knowledge-section');
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

function klShowConfirm(message, callback, icon = '⚠️') {
    document.getElementById('confirmIcon').textContent = icon;
    document.getElementById('confirmMessage').textContent = message;
    klConfirmCallback = callback;
    klOpenModal('confirmModal');
}

function formatSize(bytes) {
    if (bytes == null || bytes === 0) return '-';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function getFileIcon(ext) {
    const icons = { docx: '📄', doc: '📄', xlsx: '📊', xls: '📊', pdf: '📕', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', md: '📝', txt: '📝', drawio: '📐', vsdx: '📐', pptx: '📽️' };
    return icons[ext] || '📄';
}

function getStatusBadge(status) {
    const map = { pending: '待解析', parsing: '解析中', parsed: '已解析', failed: '解析失败' };
    const cls = { pending: 'kl-status-pending', parsing: 'kl-status-parsing', parsed: 'kl-status-parsed', failed: 'kl-status-failed' };
    return `<span class="kl-status-badge ${cls[status] || ''}">${map[status] || status || '-'}</span>`;
}

function klOpenModal(id) {
    document.getElementById('overlay').classList.add('show');
    document.getElementById(id).classList.add('open');
}

function klCloseModal(id) {
    document.getElementById('overlay').classList.remove('show');
    document.getElementById(id).classList.remove('open');
}

let klUploading = false;

function closeKLModals() {
    const uploadModal = document.getElementById('uploadModal');
    if (uploadModal && uploadModal.classList.contains('open')) {
        return;
    }
    document.getElementById('overlay').classList.remove('show');
    document.querySelectorAll('#knowledge-section .kl-modal').forEach(el => el.classList.remove('open'));
    closeDetailPanel();
}

function openDetailPanel() {
    document.getElementById('overlay').classList.add('show');
    document.getElementById('detailPanel').classList.add('open');
}

function closeDetailPanel() {
    document.getElementById('detailPanel').classList.remove('open');
    if (!document.querySelector('#knowledge-section .kl-modal.open')) {
        document.getElementById('overlay').classList.remove('show');
    }
}

async function loadKLLibraries() {
    try {
        const res = await klApiGet('/api/libraries/list');
        if (res && res.success) {
            klLibraries = res.libraries || res.data || [];
            for (const lib of klLibraries) {
                try {
                    const modRes = await klApiPost('/api/modules/list', { libraryId: lib.id, page: 1, pageSize: 200 });
                    if (modRes && modRes.success) {
                        const mods = modRes.modules || modRes.data?.modules || modRes.data || [];
                        klModulesMap[lib.id] = Array.isArray(mods) ? mods : [];
                    }
                } catch (e) { klModulesMap[lib.id] = []; }

                // 加载用例库级别的文件夹
                try {
                    const folderRes = await klApiGet(`/api/knowledge/library-files/${lib.id}`);
                    if (folderRes && folderRes.success) {
                        klLibraryFoldersMap[lib.id] = (folderRes.data || []).filter(f => f.type === 'folder');
                    }
                } catch (e) { klLibraryFoldersMap[lib.id] = []; }
            }
            await loadModuleFileCounts();
            renderTree();
        }
    } catch (e) {
        document.getElementById('treeContainer').innerHTML = '<div class="kl-empty"><div class="icon">⚠️</div><p>加载失败，请刷新重试</p></div>';
    }
}

async function loadModuleFileCounts() {
    const allModuleIds = [];
    for (const lib of klLibraries) {
        const modules = klModulesMap[lib.id] || [];
        for (const mod of modules) {
            allModuleIds.push(mod.id);
        }
    }
    if (allModuleIds.length === 0) { klModuleFileCounts = {}; return; }
    try {
        const res = await klApiPost('/api/knowledge/file-counts', { moduleIds: allModuleIds });
        if (res && res.success) {
            klModuleFileCounts = res.data || {};
        }
    } catch (e) { klModuleFileCounts = {}; }
}

async function refreshTreeCounts() {
    await loadModuleFileCounts();
    renderTree();
}

function renderTree() {
    const container = document.getElementById('treeContainer');
    if (klLibraries.length === 0) {
        container.innerHTML = '<div class="kl-empty"><div class="icon">📚</div><p>暂无用例库</p></div>';
        return;
    }

    const savedCollapsed = new Set();
    container.querySelectorAll('.kl-tree-children.collapsed').forEach(el => {
        const node = el.closest('.kl-tree-node');
        if (node) savedCollapsed.add(node.dataset.id);
    });

    let html = '';
    for (const lib of klLibraries) {
        const modules = klModulesMap[lib.id] || [];
        const folders = klLibraryFoldersMap[lib.id] || [];
        const isCollapsed = savedCollapsed.has(String(lib.id));
        const totalChildren = modules.length + folders.length;
        html += `<div class="kl-tree-node" data-type="library" data-id="${lib.id}">
            <div class="kl-tree-node-row" data-type="library" data-id="${lib.id}">
                <span class="kl-tree-expand ${isCollapsed ? '' : 'expanded'}">▶</span>
                <span class="kl-tree-icon">📚</span>
                <span class="kl-tree-label">${klEscapeHtml(lib.name)}</span>
                <span class="kl-tree-count">${totalChildren}</span>
                <button class="kl-tree-action-btn kl-tree-add-btn" data-type="library" data-lib-id="${lib.id}" title="新建文件夹">+</button>
            </div>
            <div class="kl-tree-children ${isCollapsed ? 'collapsed' : ''}">`;

        // 渲染用例库级别的文件夹
        for (const folder of folders) {
            const childCount = folder.child_count || 0;
            const isActive = klCurrentFolderId === folder.id && !klCurrentModuleId;
            html += `<div class="kl-tree-node" data-type="folder" data-id="${folder.id}" data-lib-id="${lib.id}">
                <div class="kl-tree-node-row ${isActive ? 'active' : ''}" data-type="folder" data-id="${folder.id}" data-lib-id="${lib.id}">
                    <span class="kl-tree-expand empty">▶</span>
                    <span class="kl-tree-icon">📁</span>
                    <span class="kl-tree-label">${klEscapeHtml(folder.name)}</span>
                    ${childCount > 0 ? `<span class="kl-tree-count">${childCount}</span>` : ''}
                    <button class="kl-tree-action-btn kl-tree-add-btn" data-type="folder" data-folder-id="${folder.id}" data-lib-id="${lib.id}" title="新建子文件夹">+</button>
                    <button class="kl-tree-action-btn kl-tree-delete-btn" data-action="delete" data-type="folder" data-folder-id="${folder.id}" data-lib-id="${lib.id}" data-name="${klEscapeHtml(folder.name)}" title="删除文件夹">🗑</button>
                </div>
            </div>`;
        }

        // 渲染模块（一级测试点）
        for (const mod of modules) {
            const fileCount = klModuleFileCounts[mod.id] || 0;
            const isActive = klCurrentModuleId === mod.id;
            html += `<div class="kl-tree-node" data-type="module" data-id="${mod.id}" data-lib-id="${lib.id}">
                <div class="kl-tree-node-row ${isActive ? 'active' : ''}" data-type="module" data-id="${mod.id}" data-lib-id="${lib.id}">
                    <span class="kl-tree-expand empty">▶</span>
                    <span class="kl-tree-icon">📦</span>
                    <span class="kl-tree-label">${klEscapeHtml(mod.name)}</span>
                    <span class="kl-tree-count">${fileCount}</span>
                    <button class="kl-tree-action-btn kl-tree-add-btn" data-type="module" data-module-id="${mod.id}" title="新建文件夹">+</button>
                    <button class="kl-tree-action-btn" data-module-id="${mod.id}" title="下载模块">⬇</button>
                </div>
            </div>`;
        }
        html += `</div></div>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.kl-tree-node-row').forEach(row => {
        row.addEventListener('click', function(e) {
            if (e.target.closest('.kl-tree-action-btn')) return;
            const type = this.dataset.type;
            const id = parseInt(this.dataset.id);
            if (type === 'library') {
                const children = this.nextElementSibling;
                const expand = this.querySelector('.kl-tree-expand');
                if (children) {
                    children.classList.toggle('collapsed');
                    expand.classList.toggle('expanded');
                }
            } else if (type === 'module') {
                container.querySelectorAll('.kl-tree-node-row').forEach(r => r.classList.remove('active'));
                this.classList.add('active');
                klCurrentLibraryId = parseInt(this.dataset.libId);
                klCurrentModuleId = id;
                klCurrentParentId = null;
                klCurrentFolderId = null;
                loadModuleFiles();
                updateBreadcrumb();
            } else if (type === 'folder') {
                // 点击用例库级别的文件夹 — 右侧显示该文件夹内部的内容
                container.querySelectorAll('.kl-tree-node-row').forEach(r => r.classList.remove('active'));
                this.classList.add('active');
                klCurrentLibraryId = parseInt(this.dataset.libId);
                klCurrentModuleId = null;
                klCurrentFolderId = id;
                klCurrentParentId = id; // parentId 设为当前文件夹ID，这样右侧显示的是文件夹内部内容
                loadLibraryFolderFiles();
                updateBreadcrumb();
            }
        });
    });

    container.querySelectorAll('.kl-tree-action-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (this.classList.contains('kl-tree-add-btn')) {
                const type = this.dataset.type;
                if (type === 'library') {
                    const libId = parseInt(this.dataset.libId);
                    showNewFolderModalForLibrary(libId);
                } else if (type === 'module') {
                    const moduleId = parseInt(this.dataset.moduleId);
                    showNewFolderModalForModule(moduleId);
                } else if (type === 'folder') {
                    const folderId = parseInt(this.dataset.folderId);
                    const libId = parseInt(this.dataset.libId);
                    showNewFolderModalForLibraryFolder(folderId, libId);
                }
            } else if (this.classList.contains('kl-tree-delete-btn')) {
                const folderId = parseInt(this.dataset.folderId);
                const libId = parseInt(this.dataset.libId);
                const folderName = this.dataset.name;
                klShowConfirm(`确定要删除文件夹 "${klEscapeHtml(folderName)}" 吗？文件夹内的所有文件也将被删除。`, () => deleteTreeFolder(folderId, libId), '🗑️');
            } else {
                const moduleId = parseInt(this.dataset.moduleId);
                downloadModule(moduleId);
            }
        });
    });

    container.querySelectorAll('.kl-tree-node-row').forEach(row => {
        row.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            const type = this.dataset.type;
            const id = parseInt(this.dataset.id);
            if (type === 'folder') {
                klTreeContextMenuTarget = { type, id, libId: parseInt(this.dataset.libId), name: this.querySelector('.kl-tree-label').textContent };
                showTreeContextMenu(e.clientX, e.clientY);
            }
        });
    });
}

function updateBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    let html = '<div class="kl-breadcrumb-item" data-type="root">📚 全部知识库</div>';

    if (klCurrentLibraryId) {
        const lib = klLibraries.find(l => l.id === klCurrentLibraryId);
        if (lib) {
            html += '<span class="kl-breadcrumb-sep">›</span>';
            html += `<div class="kl-breadcrumb-item" data-type="library" data-id="${lib.id}">📚 ${klEscapeHtml(lib.name)}</div>`;
        }
    }

    if (klCurrentModuleId) {
        const modules = klModulesMap[klCurrentLibraryId] || [];
        const mod = modules.find(m => m.id === klCurrentModuleId);
        if (mod) {
            html += '<span class="kl-breadcrumb-sep">›</span>';
            html += `<div class="kl-breadcrumb-item current" data-type="module" data-id="${mod.id}">📦 ${klEscapeHtml(mod.name)}</div>`;
        }
    } else if (klCurrentFolderId) {
        // 用例库级别的文件夹
        const folders = klLibraryFoldersMap[klCurrentLibraryId] || [];
        const folder = folders.find(f => f.id === klCurrentFolderId);
        if (folder) {
            html += '<span class="kl-breadcrumb-sep">›</span>';
            html += `<div class="kl-breadcrumb-item current" data-type="folder" data-id="${folder.id}">📁 ${klEscapeHtml(folder.name)}</div>`;
        }
    } else {
        html = html.replace('kl-breadcrumb-item"', 'kl-breadcrumb-item current"');
    }

    bc.innerHTML = html;

    bc.querySelectorAll('.kl-breadcrumb-item').forEach(item => {
        item.addEventListener('click', function() {
            const type = this.dataset.type;
            if (type === 'root') {
                klCurrentLibraryId = null;
                klCurrentModuleId = null;
                klCurrentParentId = null;
                klCurrentFolderId = null;
                klCurrentFiles = [];
                renderFileArea();
                updateBreadcrumb();
                updateStats();
            } else if (type === 'library') {
                klCurrentModuleId = null;
                klCurrentParentId = null;
                klCurrentFolderId = null;
                klCurrentFiles = [];
                loadLibraryFolderFiles();
                updateBreadcrumb();
                updateStats();
            }
        });
    });
}

async function loadModuleFiles() {
    if (!klCurrentModuleId) return;
    try {
        const res = await klApiGet(`/api/knowledge/files/${klCurrentModuleId}${klCurrentParentId ? '?parentId=' + klCurrentParentId : ''}`);
        if (res && res.success) {
            klCurrentFiles = res.data || [];
            renderFileArea();
            updateStats();
        }
    } catch (e) {
        klNotify('加载文件列表失败', 'error');
    }
}

// 加载用例库级别文件夹的文件列表
async function loadLibraryFolderFiles() {
    if (!klCurrentLibraryId) return;
    try {
        const res = await klApiGet(`/api/knowledge/library-files/${klCurrentLibraryId}${klCurrentParentId ? '?parentId=' + klCurrentParentId : ''}`);
        if (res && res.success) {
            klCurrentFiles = res.data || [];
            renderFileArea();
            updateStats();
        }
    } catch (e) {
        klNotify('加载文件列表失败', 'error');
    }
}

function getFilteredFiles() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const typeFilter = document.getElementById('filterType').value;
    const statusFilter = document.getElementById('filterStatus').value;

    return klCurrentFiles.filter(f => {
        if (search && !f.name.toLowerCase().includes(search)) return false;
        if (typeFilter && f.file_ext !== typeFilter) return false;
        if (statusFilter && f.parse_status !== statusFilter) return false;
        return true;
    });
}

function sortFiles(files) {
    return [...files].sort((a, b) => {
        let va, vb;
        if (klSortField === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
        else if (klSortField === 'size') { va = a.file_size || 0; vb = b.file_size || 0; }
        else if (klSortField === 'type') { va = a.file_ext || ''; vb = b.file_ext || ''; }
        else if (klSortField === 'status') { va = a.parse_status || ''; vb = b.parse_status || ''; }
        else { va = a.name; vb = b.name; }

        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;

        if (va < vb) return klSortOrder === 'asc' ? -1 : 1;
        if (va > vb) return klSortOrder === 'asc' ? 1 : -1;
        return 0;
    });
}

function renderFileArea() {
    const emptyState = document.getElementById('emptyState');
    const listView = document.getElementById('fileListView');
    const gridView = document.getElementById('fileGridView');

    if (!klCurrentModuleId && !klCurrentFolderId && !klCurrentLibraryId) {
        emptyState.style.display = 'flex';
        listView.style.display = 'none';
        gridView.style.display = 'none';
        return;
    }

    const filtered = sortFiles(getFilteredFiles());

    if (filtered.length === 0) {
        let emptyActions = '';
        if (klCurrentFolderId && !klCurrentModuleId) {
            const folders = klLibraryFoldersMap[klCurrentLibraryId] || [];
            const currentFolder = folders.find(f => f.id === klCurrentFolderId);
            if (currentFolder) {
                emptyActions = `<button class="kl-btn kl-btn-danger kl-btn-sm kl-delete-folder-btn" data-folder-id="${klCurrentFolderId}" data-library-id="${klCurrentLibraryId}" data-folder-name="${klEscapeHtml(currentFolder.name)}" style="margin-top:12px;">🗑️ 删除此文件夹</button>`;
            }
        }
        emptyState.innerHTML = `<div class="icon">📁</div><div class="title">暂无文件</div><p>点击上方按钮上传文件或新建文件夹</p>${emptyActions}`;
        emptyState.style.display = 'flex';
        listView.style.display = 'none';
        gridView.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';

    const deleteFolderBtn = emptyState.querySelector('.kl-delete-folder-btn');
    if (deleteFolderBtn) {
        deleteFolderBtn.addEventListener('click', function() {
            const folderId = parseInt(this.dataset.folderId);
            const libraryId = parseInt(this.dataset.libraryId);
            const folderName = this.dataset.folderName;
            klShowConfirm(`确定要删除文件夹 "${folderName}" 吗？文件夹内的所有文件也将被删除。`, () => deleteTreeFolder(folderId, libraryId), '🗑️');
        });
    }

    if (klViewMode === 'list') {
        listView.style.display = 'block';
        gridView.style.display = 'none';
        renderListView(filtered);
    } else {
        listView.style.display = 'none';
        gridView.style.display = 'grid';
        renderGridView(filtered);
    }
}

function renderListView(files) {
    const body = document.getElementById('fileListBody');
    body.innerHTML = files.map(f => {
        const isFolder = f.type === 'folder';
        const icon = isFolder ? '📁' : getFileIcon(f.file_ext);
        const isSelected = klSelectedFiles.has(f.id);
        const nameClass = isFolder ? 'file-name is-folder' : 'file-name';

        return `<div class="kl-file-row ${isSelected ? 'selected' : ''} ${isFolder ? 'folder-row' : ''}" data-id="${f.id}" data-type="${f.type}" data-ext="${f.file_ext || ''}">
            <div class="col-checkbox"><input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${f.id}"></div>
            <div class="col-name">
                <span class="file-icon">${icon}</span>
                <span class="${nameClass}">${klEscapeHtml(f.name)}</span>
                ${isFolder && f.child_count != null ? `<span class="kl-file-child-count">${f.child_count}</span>` : ''}
            </div>
            <div class="col-type">${isFolder ? '文件夹' : (f.file_ext || '-').toUpperCase()}</div>
            <div class="col-size">${isFolder ? '-' : formatSize(f.file_size)}</div>
            <div class="col-status">${isFolder ? '-' : getStatusBadge(f.parse_status)}</div>
            <div class="col-actions">
                ${!isFolder ? `<button class="action-btn" data-action="preview" data-id="${f.id}" title="预览">👁</button>` : ''}
                <button class="action-btn" data-action="download" data-id="${f.id}" data-type="${f.type}" title="下载">⬇</button>
                <button class="action-btn" data-action="rename" data-id="${f.id}" data-name="${klEscapeHtml(f.name)}" title="重命名">✏</button>
                <button class="action-btn danger" data-action="delete" data-id="${f.id}" data-name="${klEscapeHtml(f.name)}" title="删除">🗑</button>
            </div>
        </div>`;
    }).join('');

    bindFileRowEvents(body);
}

function renderGridView(files) {
    const grid = document.getElementById('fileGridView');
    grid.innerHTML = files.map(f => {
        const isFolder = f.type === 'folder';
        const icon = isFolder ? '📁' : getFileIcon(f.file_ext);
        const isSelected = klSelectedFiles.has(f.id);

        return `<div class="kl-grid-card ${isSelected ? 'selected' : ''}" data-id="${f.id}" data-type="${f.type}">
            <div class="grid-checkbox"><input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${f.id}"></div>
            <div class="grid-actions">
                ${!isFolder ? `<button class="action-btn" data-action="download" data-id="${f.id}">⬇</button>` : ''}
                <button class="action-btn danger" data-action="delete" data-id="${f.id}" data-name="${klEscapeHtml(f.name)}">🗑</button>
            </div>
            <div class="grid-icon">${icon}</div>
            <div class="grid-name" title="${klEscapeHtml(f.name)}">${klEscapeHtml(f.name)}</div>
            <div class="grid-meta">${isFolder ? (f.child_count != null ? `${f.child_count} 项` : '文件夹') : formatSize(f.file_size)}</div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.kl-grid-card').forEach(card => {
        const id = parseInt(card.dataset.id);
        const type = card.dataset.type;

        card.addEventListener('click', function(e) {
            if (e.target.closest('.action-btn') || e.target.closest('.grid-checkbox')) return;
            if (type === 'folder') {
                enterFolder(id);
            } else {
                showFileDetail(id);
            }
        });

        card.querySelector('.grid-checkbox input').addEventListener('change', function(e) {
            e.stopPropagation();
            klToggleFileSelection(id);
        });
    });

    grid.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const action = this.dataset.action;
            const id = parseInt(this.dataset.id);
            if (action === 'download') downloadFile(id);
            else if (action === 'delete') {
                const name = this.dataset.name;
                klShowConfirm(`确定要删除 "${name}" 吗？`, () => deleteFile(id), '🗑️');
            }
        });
    });
}

function bindFileRowEvents(container) {
    container.querySelectorAll('.kl-file-row').forEach(row => {
        const id = parseInt(row.dataset.id);
        const type = row.dataset.type;

        row.addEventListener('click', function(e) {
            if (e.target.closest('.action-btn') || e.target.closest('input[type="checkbox"]')) return;
            if (type === 'folder') {
                enterFolder(id);
            } else {
                showFileDetail(id);
            }
        });

        row.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            klContextMenuTarget = id;
            showContextMenu(e.clientX, e.clientY, type);
        });

        row.querySelector('input[type="checkbox"]').addEventListener('change', function(e) {
            e.stopPropagation();
            klToggleFileSelection(id);
        });
    });

    container.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const action = this.dataset.action;
            const id = parseInt(this.dataset.id);
            const type = this.dataset.type;
            if (action === 'preview') previewFile(id);
            else if (action === 'download') {
                if (type === 'folder') {
                    downloadFolder(id);
                } else {
                    downloadFile(id);
                }
            }
            else if (action === 'rename') {
                const name = this.dataset.name;
                startRename(id, name);
            } else if (action === 'delete') {
                const name = this.dataset.name;
                if (type === 'folder') {
                    klShowConfirm(`确定要删除文件夹 "${klEscapeHtml(name)}" 吗？文件夹内的所有文件也将被删除。`, () => deleteTreeFolder(id, klCurrentLibraryId), '🗑️');
                } else {
                    klShowConfirm(`确定要删除 "${klEscapeHtml(name)}" 吗？`, () => deleteFile(id), '🗑️');
                }
            }
        });
    });
}

function enterFolder(folderId) {
    klCurrentParentId = folderId;
    if (klCurrentModuleId) {
        loadModuleFiles();
    } else if (klCurrentFolderId || klCurrentLibraryId) {
        // 用例库级别文件夹中进入子文件夹
        loadLibraryFolderFiles();
    }
}

function klToggleFileSelection(id) {
    if (klSelectedFiles.has(id)) {
        klSelectedFiles.delete(id);
        delete klSelectedFileModuleMap[id];
    } else {
        klSelectedFiles.add(id);
        klSelectedFileModuleMap[id] = {
            moduleId: klCurrentModuleId,
            libraryId: klCurrentLibraryId
        };
    }
    renderFileArea();
    updateBatchBar();
}

function updateBatchBar() {
    const bar = document.getElementById('batchBar');
    const count = document.getElementById('batchCount');
    if (klSelectedFiles.size > 0) {
        bar.classList.add('show');
        count.textContent = klSelectedFiles.size;
    } else {
        bar.classList.remove('show');
    }
}

function updateStats() {
    const files = klCurrentFiles.filter(f => f.type !== 'folder');
    document.getElementById('statTotal').textContent = files.length;
    const totalSize = files.reduce((sum, f) => sum + (f.file_size || 0), 0);
    document.getElementById('statSize').textContent = formatSize(totalSize);
    document.getElementById('statParsed').textContent = files.filter(f => f.parse_status === 'parsed').length;
    document.getElementById('statPending').textContent = files.filter(f => f.parse_status === 'pending' || !f.parse_status).length;
}

async function downloadFile(fileId) {
    try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch(KL_API_BASE + `/api/knowledge/download/${fileId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { showKLLoginPrompt(); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const contentDisposition = res.headers.get('content-disposition');
        let filename = 'download';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match) filename = match[1].replace(/['"]/g, '');
            try { filename = decodeURIComponent(filename); } catch (e) {}
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        klNotify('文件下载成功', 'success');
    } catch (e) {
        klNotify('下载失败: ' + e.message, 'error');
    }
}

async function downloadFolder(folderId) {
    if (!klCurrentModuleId) {
        klNotify('请先选择模块', 'warning');
        return;
    }
    try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch(KL_API_BASE + `/api/knowledge/download-folder/${klCurrentModuleId}/${folderId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { showKLLoginPrompt(); return; }
        if (!res.ok) {
            if (res.status === 404) {
                klNotify('文件夹为空或不存在', 'warning');
                return;
            }
            throw new Error(`HTTP ${res.status}`);
        }

        const contentDisposition = res.headers.get('content-disposition');
        let filename = 'folder.zip';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match) filename = match[1].replace(/['"]/g, '');
            try { filename = decodeURIComponent(filename); } catch (e) {}
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        klNotify('文件夹下载成功', 'success');
    } catch (e) {
        klNotify('下载失败: ' + e.message, 'error');
    }
}

async function downloadModule(moduleId) {
    try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch(KL_API_BASE + `/api/knowledge/download-module/${moduleId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { showKLLoginPrompt(); return; }
        if (!res.ok) {
            if (res.status === 404) {
                klNotify('模块为空或不存在', 'warning');
                return;
            }
            throw new Error(`HTTP ${res.status}`);
        }

        const contentDisposition = res.headers.get('content-disposition');
        let filename = 'module.zip';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match) filename = match[1].replace(/['"]/g, '');
            try { filename = decodeURIComponent(filename); } catch (e) {}
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        klNotify('模块下载成功', 'success');
    } catch (e) {
        klNotify('下载失败: ' + e.message, 'error');
    }
}

async function batchDownload() {
    if (klSelectedFiles.size === 0) { klNotify('请先选择文件', 'warning'); return; }
    try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch(KL_API_BASE + '/api/knowledge/batch-download', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileIds: Array.from(klSelectedFiles) })
        });
        if (res.status === 401) { showKLLoginPrompt(); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const contentDisposition = res.headers.get('content-disposition');
        let filename = `knowledge_files_${Date.now()}.zip`;
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match) filename = match[1].replace(/['"]/g, '');
            try { filename = decodeURIComponent(filename); } catch (e) {}
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        klNotify('批量下载成功', 'success');
    } catch (e) {
        klNotify('批量下载失败: ' + e.message, 'error');
    }
}

async function batchDelete() {
    if (klSelectedFiles.size === 0) { klNotify('请先选择文件', 'warning'); return; }
    klShowConfirm(`确定要删除选中的 ${klSelectedFiles.size} 个文件吗？`, async () => {
        let successCount = 0;
        for (const fileId of klSelectedFiles) {
            try {
                const params = new URLSearchParams();
                if (klCurrentModuleId) params.set('moduleId', klCurrentModuleId);
                if (klCurrentLibraryId) params.set('libraryId', klCurrentLibraryId);
                await klApiDelete(`/api/knowledge/file/${fileId}?${params.toString()}`);
                successCount++;
            } catch (e) {}
        }
        klSelectedFiles.clear();
        klSelectedFileModuleMap = {};
        klInvalidateApiCache();
        updateBatchBar();
        if (klCurrentModuleId) {
            loadModuleFiles();
        } else {
            loadLibraryFolderFiles();
        }
        klNotify(`已删除 ${successCount} 个文件`, 'success');
    }, '🗑️');
}

async function previewFile(fileId) {
    klCurrentPreviewFileId = fileId;
    klOpenModal('previewModal');
    document.getElementById('previewContent').innerHTML = '<div class="kl-loading"><div class="kl-spinner"></div></div>';
    document.getElementById('previewInfo').textContent = '加载中...';

    try {
        const res = await klApiGet(`/api/knowledge/preview/${fileId}`);
        if (res && res.success) {
            const data = res.data;
            document.getElementById('previewInfo').textContent = `${data.type || ''} - ${data.name || ''}`;
            renderPreviewContent(data);
        } else {
            document.getElementById('previewContent').innerHTML = `<div class="kl-preview-unsupported"><div class="icon">⚠️</div><p>${klEscapeHtml(res?.message || '预览失败')}</p></div>`;
        }
    } catch (e) {
        document.getElementById('previewContent').innerHTML = `<div class="kl-preview-unsupported"><div class="icon">⚠️</div><p>预览加载失败: ${klEscapeHtml(e.message)}</p></div>`;
    }
}

async function renderPreviewContent(data) {
    const container = document.getElementById('previewContent');

    if (data.type === 'image') {
        const safeSrc = String(data.content || '').replace(/^javascript:/i, '');
        container.innerHTML = '';
        const img = document.createElement('img');
        img.src = safeSrc;
        img.alt = 'preview';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '70vh';
        img.onerror = () => { container.innerHTML = '<div class="kl-preview-unsupported"><div class="icon">⚠️</div><p>图片加载失败</p></div>'; };
        container.appendChild(img);
    } else if (data.type === 'pdf') {
        const pdfUrl = data.url || '';
        container.innerHTML = '<div class="kl-loading"><div class="kl-spinner"></div></div>';
        try {
            const token = localStorage.getItem('authToken') || localStorage.getItem('token');
            const resp = await fetch(pdfUrl, { headers: { 'Authorization': `Bearer ${token}` } });
            if (resp.ok) {
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                container.innerHTML = '';
                const iframe = document.createElement('iframe');
                iframe.src = blobUrl;
                iframe.style.width = '100%';
                iframe.style.height = '70vh';
                iframe.style.border = 'none';
                container.appendChild(iframe);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            } else {
                container.innerHTML = '<div class="kl-preview-unsupported"><div class="icon">⚠️</div><p>PDF加载失败</p></div>';
            }
        } catch (e) {
            container.innerHTML = '<div class="kl-preview-unsupported"><div class="icon">⚠️</div><p>PDF加载失败</p></div>';
        }
    } else if (data.type === 'markdown') {
        if (typeof marked !== 'undefined' && marked.parse) {
            const rawHtml = marked.parse(data.content || '');
            container.innerHTML = `<div class="markdown-body">${typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : klEscapeHtml(data.content || '')}</div>`;
        } else {
            container.innerHTML = `<pre>${klEscapeHtml(data.content || '')}</pre>`;
        }
    } else if (data.type === 'text') {
        container.innerHTML = `<pre>${klEscapeHtml(data.content || '')}</pre>`;
    } else if (data.type === 'excel') {
        const sheets = data.sheets || [];
        const sheetsHtml = data.sheetsHtml || {};
        const activeSheet = data.activeSheet || sheets[0] || '';
        let html = '';
        if (sheets.length > 1) {
            html += '<div class="kl-excel-tabs">';
            for (const s of sheets) {
                html += `<button class="kl-excel-tab${s === activeSheet ? ' active' : ''}" data-sheet="${klEscapeHtml(s)}">${klEscapeHtml(s)}</button>`;
            }
            html += '</div>';
        }
        html += '<div class="kl-excel-content">';
        for (const s of sheets) {
            const display = s === activeSheet ? '' : 'display:none;';
            const sanitized = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(sheetsHtml[s] || '') : klEscapeHtml(sheetsHtml[s] || '');
            html += `<div class="kl-excel-sheet" data-sheet="${klEscapeHtml(s)}" style="${display}"><div class="markdown-body">${sanitized}</div></div>`;
        }
        html += '</div>';
        container.innerHTML = html;
        container.querySelectorAll('.kl-excel-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                container.querySelectorAll('.kl-excel-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const sheetName = tab.getAttribute('data-sheet');
                container.querySelectorAll('.kl-excel-sheet').forEach(sh => {
                    sh.style.display = sh.getAttribute('data-sheet') === sheetName ? '' : 'none';
                });
            });
        });
    } else if (data.type === 'html') {
        const purifyConfig = { ADD_TAGS: ['img'], ADD_ATTR: ['src'], ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$)|data:image\/)/i };
        const sanitized = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(data.content || '', purifyConfig) : klEscapeHtml(data.content || '');
        container.innerHTML = `<div class="markdown-body">${sanitized}</div>`;
    } else {
        container.innerHTML = `<div class="kl-preview-unsupported"><div class="icon">📄</div><p>该文件类型暂不支持在线预览</p><p style="font-size:13px;margin-top:8px;">请下载后查看</p></div>`;
    }
}

async function showFileDetail(fileId) {
    try {
        const res = await klApiGet(`/api/knowledge/file/detail/${fileId}`);
        if (res && res.success && res.data) {
            renderDetailPanel(res.data);
            openDetailPanel();
        }
    } catch (e) {
        klNotify('加载文件详情失败', 'error');
    }
}

function renderDetailPanel(file) {
    const body = document.getElementById('detailBody');
    const actions = document.getElementById('detailActions');
    const isFolder = file.type === 'folder';
    const previewableExts = ['docx', 'doc', 'xlsx', 'xls', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'txt', 'md', 'markdown', 'pptx'];
    const ext = (file.file_ext || '').toLowerCase();
    const canPreview = !isFolder && previewableExts.includes(ext);

    body.innerHTML = `
        ${canPreview ? '<div class="kl-detail-preview" id="detailPreview"></div>' : ''}
        <div class="kl-detail-info">
        <div class="kl-detail-row">
            <span class="kl-detail-label">文件名</span>
            <span class="kl-detail-value">${klEscapeHtml(file.name)}</span>
        </div>
        <div class="kl-detail-row">
            <span class="kl-detail-label">类型</span>
            <span class="kl-detail-value">${isFolder ? '📁 文件夹' : (file.file_ext || '-').toUpperCase()}</span>
        </div>
        ${!isFolder ? `<div class="kl-detail-row">
            <span class="kl-detail-label">大小</span>
            <span class="kl-detail-value">${formatSize(file.file_size)}</span>
        </div>` : ''}
        ${!isFolder ? `<div class="kl-detail-row">
            <span class="kl-detail-label">解析状态</span>
            <span class="kl-detail-value">${getStatusBadge(file.parse_status)}</span>
        </div>` : ''}
        ${!isFolder ? `<div class="kl-detail-row">
            <span class="kl-detail-label">文本块数</span>
            <span class="kl-detail-value">${file.chunk_count || file.actual_chunk_count || 0}</span>
        </div>` : ''}
        ${!isFolder ? `<div class="kl-detail-row">
            <span class="kl-detail-label">Token数</span>
            <span class="kl-detail-value">${file.total_tokens || '-'}</span>
        </div>` : ''}
        <div class="kl-detail-row">
            <span class="kl-detail-label">上传者</span>
            <span class="kl-detail-value">${klEscapeHtml(file.created_by || '-')}</span>
        </div>
        <div class="kl-detail-row">
            <span class="kl-detail-label">上传时间</span>
            <span class="kl-detail-value">${klFormatDateTime(file.created_at)}</span>
        </div>
        <div class="kl-detail-row">
            <span class="kl-detail-label">更新时间</span>
            <span class="kl-detail-value">${klFormatDateTime(file.updated_at)}</span>
        </div>
        ${file.description ? `<div class="kl-detail-row">
            <span class="kl-detail-label">描述</span>
            <span class="kl-detail-value">${klEscapeHtml(file.description)}</span>
        </div>` : ''}
        </div>
    `;

    if (canPreview) {
        loadDetailPreview(file.id, ext);
    }

    actions.innerHTML = '';
    if (!isFolder) {
        const previewBtn = document.createElement('button');
        previewBtn.className = 'kl-btn kl-btn-outline kl-btn-sm';
        previewBtn.textContent = '👁 预览';
        previewBtn.addEventListener('click', () => { closeDetailPanel(); previewFile(file.id); });
        actions.appendChild(previewBtn);

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'kl-btn kl-btn-outline kl-btn-sm';
        downloadBtn.textContent = '⬇ 下载';
        downloadBtn.addEventListener('click', () => downloadFile(file.id));
        actions.appendChild(downloadBtn);
    }

    const renameBtn = document.createElement('button');
    renameBtn.className = 'kl-btn kl-btn-ghost kl-btn-sm';
    renameBtn.textContent = '✏️ 重命名';
    renameBtn.addEventListener('click', () => { closeDetailPanel(); startRename(file.id, file.name); });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'kl-btn kl-btn-danger kl-btn-sm';
    deleteBtn.textContent = '🗑️ 删除';
    deleteBtn.addEventListener('click', () => {
        closeDetailPanel();
        klShowConfirm(`确定要删除 "${file.name}" 吗？`, () => deleteFile(file.id), '🗑️');
    });
    actions.appendChild(deleteBtn);
}

async function loadDetailPreview(fileId, ext) {
    const container = document.getElementById('detailPreview');
    if (!container) return;
    container.innerHTML = '<div class="kl-loading"><div class="kl-spinner"></div></div>';
    try {
        const res = await klApiGet(`/api/knowledge/preview/${fileId}`);
        if (!res || !res.success) {
            container.innerHTML = `<p style="color:${ThemeService.getColor('textMuted')};text-align:center;padding:20px;">预览加载失败</p>`;
            return;
        }
        const data = res.data;
        if (data.type === 'image') {
            container.innerHTML = `<img src="${klEscapeHtml(data.url || '')}" style="max-width:100%;border-radius:6px;" onerror="this.outerHTML='<p style=\\'color:${ThemeService.getColor('textMuted')};text-align:center;padding:20px;\\'>图片加载失败</p>'">`;
        } else if (data.type === 'pdf') {
            const pdfUrl = data.url || '';
            const token = localStorage.getItem('authToken') || localStorage.getItem('token');
            const resp = await fetch(pdfUrl, { headers: { 'Authorization': `Bearer ${token}` } });
            if (resp.ok) {
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                container.innerHTML = `<iframe src="${blobUrl}" style="width:100%;height:400px;border:none;border-radius:6px;"></iframe>`;
                setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
            } else {
                container.innerHTML = `<p style="color:${ThemeService.getColor('textMuted')};text-align:center;padding:20px;">PDF加载失败</p>`;
            }
        } else if (data.type === 'excel') {
            const sheets = data.sheets || [];
            const sheetsHtml = data.sheetsHtml || {};
            const activeSheet = data.activeSheet || sheets[0] || '';
            let html = '';
            if (sheets.length > 1) {
                html += '<div class="kl-detail-excel-tabs">';
                for (const s of sheets) {
                    html += `<button class="kl-detail-excel-tab${s === activeSheet ? ' active' : ''}" data-sheet="${klEscapeHtml(s)}">${klEscapeHtml(s)}</button>`;
                }
                html += '</div>';
            }
            const sanitized = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(sheetsHtml[activeSheet] || '') : klEscapeHtml(sheetsHtml[activeSheet] || '');
            html += `<div class="kl-detail-excel-content markdown-body">${sanitized}</div>`;
            container.innerHTML = html;
            container.querySelectorAll('.kl-detail-excel-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    container.querySelectorAll('.kl-detail-excel-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    const sheetName = tab.getAttribute('data-sheet');
                    const contentEl = container.querySelector('.kl-detail-excel-content');
                    if (contentEl) {
                        const s2 = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(sheetsHtml[sheetName] || '') : klEscapeHtml(sheetsHtml[sheetName] || '');
                        contentEl.innerHTML = s2;
                    }
                });
            });
        } else if (data.type === 'html') {
            const purifyConfig = { ADD_TAGS: ['img'], ADD_ATTR: ['src'], ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$)|data:image\/)/i };
            const sanitized = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(data.content || '', purifyConfig) : klEscapeHtml(data.content || '');
            container.innerHTML = `<div class="markdown-body">${sanitized}</div>`;
        } else if (data.type === 'markdown') {
            if (typeof marked !== 'undefined' && marked.parse) {
                const rawHtml = marked.parse(data.content || '');
                const sanitized = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : klEscapeHtml(data.content || '');
                container.innerHTML = `<div class="markdown-body">${sanitized}</div>`;
            } else {
                container.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;">${klEscapeHtml(data.content || '')}</pre>`;
            }
        } else if (data.type === 'text') {
            container.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;">${klEscapeHtml(data.content || '')}</pre>`;
        } else {
            container.innerHTML = `<p style="color:${ThemeService.getColor('textMuted')};text-align:center;padding:20px;">该类型暂不支持预览</p>`;
        }
    } catch (e) {
        container.innerHTML = `<p style="color:${ThemeService.getColor('textMuted')};text-align:center;padding:20px;">预览加载失败</p>`;
    }
}

async function deleteFile(fileId) {
    try {
        const params = new URLSearchParams();
        if (klCurrentModuleId) params.set('moduleId', klCurrentModuleId);
        if (klCurrentLibraryId) params.set('libraryId', klCurrentLibraryId);
        await klApiDelete(`/api/knowledge/file/${fileId}?${params.toString()}`);
        klInvalidateApiCache();
        klSelectedFiles.delete(fileId);
        delete klSelectedFileModuleMap[fileId];
        if (klCurrentModuleId) {
            loadModuleFiles();
        } else {
            loadLibraryFolderFiles();
        }
        updateBatchBar();
        refreshTreeCounts();
        klNotify('删除成功', 'success');
    } catch (e) {
        klNotify('删除失败', 'error');
    }
}

async function deleteTreeFolder(folderId, libraryId) {
    try {
        const params = new URLSearchParams();
        params.set('libraryId', libraryId);
        await klApiDelete(`/api/knowledge/file/${folderId}?${params.toString()}`);
        klInvalidateApiCache();
        if (klCurrentFolderId === folderId) {
            klCurrentFolderId = null;
            klCurrentParentId = null;
            const fileArea = document.getElementById('emptyState');
            const listView = document.getElementById('fileListView');
            const gridView = document.getElementById('fileGridView');
            if (fileArea) fileArea.style.display = 'flex';
            if (listView) listView.style.display = 'none';
            if (gridView) gridView.style.display = 'none';
            updateBreadcrumb();
        }
        await loadKLLibraries();
        klNotify('文件夹删除成功', 'success');
    } catch (e) {
        klNotify('文件夹删除失败', 'error');
    }
}

function showTreeContextMenu(x, y) {
    let menu = document.getElementById('treeContextMenu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'treeContextMenu';
        menu.className = 'kl-context-menu';
        menu.innerHTML = `
            <div class="kl-context-menu-item" data-action="rename">✏️ 重命名</div>
            <div class="kl-context-menu-sep"></div>
            <div class="kl-context-menu-item danger" data-action="delete">🗑️ 删除</div>
        `;
        document.body.appendChild(menu);

        menu.querySelectorAll('.kl-context-menu-item').forEach(item => {
            item.addEventListener('click', function() {
                const action = this.dataset.action;
                const target = klTreeContextMenuTarget;
                hideTreeContextMenu();
                if (!target) return;
                if (action === 'delete') {
                    klShowConfirm(`确定要删除文件夹 "${klEscapeHtml(target.name)}" 吗？文件夹内的所有文件也将被删除。`, () => deleteTreeFolder(target.id, target.libId), '🗑️');
                } else if (action === 'rename') {
                    startTreeFolderRename(target.id, target.name, target.libId);
                }
            });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#treeContextMenu')) hideTreeContextMenu();
        });
    }
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('show');
    if (x + 160 > window.innerWidth) menu.style.left = (x - 160) + 'px';
    if (y + 120 > window.innerHeight) menu.style.top = (y - 120) + 'px';
}

function hideTreeContextMenu() {
    const menu = document.getElementById('treeContextMenu');
    if (menu) menu.classList.remove('show');
    klTreeContextMenuTarget = null;
}

async function startTreeFolderRename(folderId, currentName, libraryId) {
    document.getElementById('renameInput').value = currentName;
    klOpenModal('renameModal');
    const confirmBtn = document.getElementById('btnConfirmRename');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.id = 'btnConfirmRename';
    newConfirmBtn.addEventListener('click', async () => {
        const newName = document.getElementById('renameInput').value.trim();
        if (!newName) { klNotify('请输入新名称', 'warning'); return; }
        try {
            await klApiPut('/api/knowledge/file/rename', { fileId: folderId, newName });
            klCloseModal('renameModal');
            klInvalidateApiCache();
            await loadKLLibraries();
            klNotify('重命名成功', 'success');
        } catch (e) {
            klNotify('重命名失败', 'error');
        }
    });
}

function startRename(fileId, currentName) {
    document.getElementById('renameInput').value = currentName;
    klOpenModal('renameModal');
    const confirmBtn = document.getElementById('btnConfirmRename');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.id = 'btnConfirmRename';
    newConfirmBtn.addEventListener('click', async () => {
        const newName = document.getElementById('renameInput').value.trim();
        if (!newName) { klNotify('请输入新名称', 'warning'); return; }
        try {
            await klApiPut('/api/knowledge/file/rename', { fileId, newName });
            klCloseModal('renameModal');
            klInvalidateApiCache();
            if (klCurrentModuleId) {
                loadModuleFiles();
            } else {
                loadLibraryFolderFiles();
            }
            klNotify('重命名成功', 'success');
        } catch (e) {
            klNotify('重命名失败', 'error');
        }
    });
    setTimeout(() => document.getElementById('renameInput').focus(), 100);
}

function populateModuleSelects() {
    const selects = ['uploadModuleSelect', 'folderModuleSelect', 'crawlModuleSelect'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        select.innerHTML = '<option value="">请选择模块</option>';
        for (const lib of klLibraries) {
            const modules = klModulesMap[lib.id] || [];
            if (modules.length > 0) {
                const group = document.createElement('optgroup');
                group.label = lib.name;
                // 添加用例库根目录选项
                const libOpt = document.createElement('option');
                libOpt.value = '';
                libOpt.textContent = `📁 ${lib.name}（用例库根目录）`;
                group.appendChild(libOpt);
                modules.forEach(mod => {
                    const opt = document.createElement('option');
                    opt.value = mod.id;
                    opt.textContent = mod.name;
                    if (klCurrentModuleId && mod.id === klCurrentModuleId) opt.selected = true;
                    group.appendChild(opt);
                });
                select.appendChild(group);
            }
        }
    });
}

function showNewFolderModalForLibrary(libId) {
    const lib = klLibraries.find(l => l.id === libId);
    if (!lib) return;

    const modules = klModulesMap[libId] || [];

    const hintGroup = document.getElementById('folderHintGroup');
    const hintText = document.getElementById('folderHintText');
    const moduleGroup = document.getElementById('folderModuleGroup');
    const select = document.getElementById('folderModuleSelect');

    // 提供选项：直接在用例库下创建文件夹，或选择某个模块
    hintText.textContent = `将在「${lib.name}」下创建文件夹`;
    hintGroup.style.display = 'block';
    moduleGroup.style.display = 'block';

    select.innerHTML = '<option value="">用例库根目录（直接挂在用例库下）</option>';
    const group = document.createElement('optgroup');
    group.label = '选择模块（测试点）';
    modules.forEach(mod => {
        const opt = document.createElement('option');
        opt.value = mod.id;
        opt.textContent = mod.name;
        group.appendChild(opt);
    });
    select.appendChild(group);

    // 存储当前用例库ID供创建时使用
    select.dataset.libraryId = libId;

    document.getElementById('newFolderName').value = '';
    klOpenModal('newFolderModal');
    setTimeout(() => document.getElementById('newFolderName').focus(), 100);
}

function showNewFolderModalForModule(moduleId) {
    const hintGroup = document.getElementById('folderHintGroup');
    const hintText = document.getElementById('folderHintText');
    const moduleGroup = document.getElementById('folderModuleGroup');
    const select = document.getElementById('folderModuleSelect');

    let moduleName = '';
    let libName = '';

    for (const lib of klLibraries) {
        const modules = klModulesMap[lib.id] || [];
        const mod = modules.find(m => m.id === moduleId);
        if (mod) {
            moduleName = mod.name;
            libName = lib.name;
            select.dataset.libraryId = lib.id;
            break;
        }
    }

    hintText.textContent = `将在「${libName}」的「${moduleName}」模块下创建文件夹`;
    hintGroup.style.display = 'block';
    moduleGroup.style.display = 'none';

    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = moduleId;
    opt.textContent = moduleName;
    opt.selected = true;
    select.appendChild(opt);

    document.getElementById('newFolderName').value = '';
    klOpenModal('newFolderModal');
    setTimeout(() => document.getElementById('newFolderName').focus(), 100);
}

// 在用例库级别文件夹下新建子文件夹
function showNewFolderModalForLibraryFolder(folderId, libId) {
    const lib = klLibraries.find(l => l.id === libId);
    const folders = klLibraryFoldersMap[libId] || [];
    const folder = folders.find(f => f.id === folderId);

    const hintGroup = document.getElementById('folderHintGroup');
    const hintText = document.getElementById('folderHintText');
    const moduleGroup = document.getElementById('folderModuleGroup');
    const select = document.getElementById('folderModuleSelect');

    hintText.textContent = `将在「${lib ? lib.name : ''}」的文件夹「${folder ? folder.name : ''}」下创建子文件夹`;
    hintGroup.style.display = 'block';
    moduleGroup.style.display = 'none';

    select.innerHTML = '';
    select.dataset.libraryId = libId;
    select.dataset.parentFolderId = folderId;

    document.getElementById('newFolderName').value = '';
    klOpenModal('newFolderModal');
    setTimeout(() => document.getElementById('newFolderName').focus(), 100);
}

function showContextMenu(x, y, fileType) {
    const menu = document.getElementById('contextMenu');
    const isFolder = fileType === 'folder';
    const previewItem = menu.querySelector('[data-action="preview"]');
    const downloadItem = menu.querySelector('[data-action="download"]');
    const detailItem = menu.querySelector('[data-action="detail"]');
    if (previewItem) previewItem.style.display = isFolder ? 'none' : '';
    if (downloadItem) downloadItem.style.display = isFolder ? 'none' : '';
    if (detailItem) detailItem.style.display = isFolder ? 'none' : '';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('show');

    if (x + 160 > window.innerWidth) menu.style.left = (x - 160) + 'px';
    if (y + 200 > window.innerHeight) menu.style.top = (y - 200) + 'px';
}

function hideContextMenu() {
    document.getElementById('contextMenu').classList.remove('show');
    klContextMenuTarget = null;
}

function initUploadZone() {
    const zone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    
    if (!zone || !fileInput) return;

    zone.addEventListener('click', () => {
        fileInput.click();
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            addFilesToPreview(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            addFilesToPreview(this.files);
            this.value = '';
        }
    });
}

function addFilesToPreview(files) {
    const newFiles = Array.from(files);
    const existingNames = new Set(klPendingUploadFiles.map(f => f.name));
    let duplicateCount = 0;
    newFiles.forEach(f => {
        if (existingNames.has(f.name)) {
            duplicateCount++;
        } else {
            klPendingUploadFiles.push(f);
            existingNames.add(f.name);
        }
    });
    if (duplicateCount > 0) {
        klNotify(`已跳过 ${duplicateCount} 个同名文件`, 'warning');
    }
    renderFilePreview();
}

function renderFilePreview() {
    const progressContainer = document.getElementById('uploadProgress');
    if (!progressContainer) return;
    
    progressContainer.innerHTML = '';
    
    if (klPendingUploadFiles.length === 0) return;

    const headerEl = document.createElement('div');
    headerEl.className = 'kl-preview-header';
    headerEl.innerHTML = `
        <span class="preview-title">待上传文件 (${klPendingUploadFiles.length} 个)</span>
        <div class="kl-preview-header-actions">
            <button class="kl-btn kl-btn-sm kl-btn-ghost" id="btnAddFiles">➕ 添加文件</button>
            <button class="kl-btn kl-btn-sm kl-btn-ghost" id="btnClearPreview">清空</button>
        </div>
    `;
    progressContainer.appendChild(headerEl);
    
    const listEl = document.createElement('div');
    listEl.className = 'kl-preview-list';
    
    klPendingUploadFiles.forEach((file, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'kl-upload-item';
        itemEl.dataset.index = index;
        itemEl.innerHTML = `
            <span class="upload-icon">${getFileIcon(file.name.split('.').pop())}</span>
            <span class="upload-name">${klEscapeHtml(file.name)}</span>
            <span class="upload-size">${formatFileSize(file.size)}</span>
            <button class="kl-btn kl-btn-sm kl-btn-ghost remove-file-btn" data-index="${index}">✕</button>
        `;
        listEl.appendChild(itemEl);
    });
    progressContainer.appendChild(listEl);
    
    const actionsEl = document.createElement('div');
    actionsEl.className = 'kl-preview-actions';
    actionsEl.innerHTML = `
        <button class="kl-btn kl-btn-primary" id="btnStartUpload">开始上传</button>
    `;
    progressContainer.appendChild(actionsEl);
    
    document.getElementById('btnAddFiles').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    document.getElementById('btnClearPreview').addEventListener('click', () => {
        klPendingUploadFiles = [];
        klUploading = false;
        progressContainer.innerHTML = '';
    });
    
    document.getElementById('btnStartUpload').addEventListener('click', function() {
        if (klPendingUploadFiles.length > 0) {
            this.disabled = true;
            this.textContent = '上传中...';
            this.style.opacity = '0.6';
            this.style.cursor = 'not-allowed';
            klHandleFileUpload(klPendingUploadFiles).catch(function(err) {
                console.error('[Knowledge Library] Upload error:', err);
                klUploading = false;
            });
        } else {
            klNotify('没有待上传的文件', 'warning');
        }
    });
    
    listEl.querySelectorAll('.remove-file-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            klPendingUploadFiles.splice(index, 1);
            renderFilePreview();
        });
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function klHandleFileUpload(files) {
    if (!files || files.length === 0) {
        klNotify('没有可上传的文件', 'warning');
        klUploading = false;
        return;
    }

    const moduleSelect = document.getElementById('uploadModuleSelect');
    const moduleIdValue = moduleSelect ? moduleSelect.value : null;
    const moduleId = moduleIdValue ? parseInt(moduleIdValue) : null;

    let uploadLibraryId = klCurrentLibraryId;
    if (!uploadLibraryId && moduleId && moduleSelect) {
        const selectedOpt = moduleSelect.options[moduleSelect.selectedIndex];
        if (selectedOpt) {
            const optGroup = selectedOpt.parentElement;
            if (optGroup && optGroup.tagName === 'OPTGROUP') {
                const libName = optGroup.label;
                const lib = klLibraries.find(l => l.name === libName);
                if (lib) {
                    uploadLibraryId = lib.id;
                }
            }
        }
    }

    if (!uploadLibraryId && (!moduleId || isNaN(moduleId))) {
        for (const lib of klLibraries) {
            const modules = klModulesMap[lib.id] || [];
            const hasMatchingModule = modules.some(m => m.id === moduleId);
            if (hasMatchingModule) {
                uploadLibraryId = lib.id;
                break;
            }
        }
    }

    if ((!moduleId || isNaN(moduleId)) && !uploadLibraryId) {
        klNotify('请先选择目标模块', 'warning');
        if (moduleSelect) {
            moduleSelect.style.borderColor = '#ef4444';
            moduleSelect.focus();
            setTimeout(() => { moduleSelect.style.borderColor = ''; }, 3000);
        }
        
        const progressContainer = document.getElementById('uploadProgress');
        if (progressContainer) {
            const errorEl = document.createElement('div');
            errorEl.className = 'kl-upload-error-message';
            const c = ThemeService.getColors();
            errorEl.style.cssText = `color:${c.danger};padding:12px;background:${c.dangerBg};border:1px solid ${c.danger}33;border-radius:6px;margin-top:8px;`;
            errorEl.innerHTML = '<strong>⚠️ 上传失败</strong><br>请先在上方选择目标模块后再点击上传';
            progressContainer.appendChild(errorEl);
        }
        klUploading = false;
        return;
    }

    const progressContainer = document.getElementById('uploadProgress');
    if (!progressContainer) {
        klNotify('上传失败：界面元素未找到', 'error');
        klUploading = false;
        return;
    }
    
    progressContainer.innerHTML = '';
    
    klUploading = true;
    
    const headerEl = document.createElement('div');
    headerEl.className = 'kl-preview-header';
    headerEl.innerHTML = `<span class="preview-title">上传进度</span>`;
    progressContainer.appendChild(headerEl);
    
    const listEl = document.createElement('div');
    listEl.className = 'kl-preview-list';
    progressContainer.appendChild(listEl);
    
    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
        const itemEl = document.createElement('div');
        itemEl.className = 'kl-upload-item';
        itemEl.innerHTML = `
            <span class="upload-icon">${getFileIcon(file.name.split('.').pop())}</span>
            <span class="upload-name">${klEscapeHtml(file.name)}</span>
            <div class="upload-progress"><div class="upload-progress-bar" style="width:0%"></div></div>
            <span class="upload-status">上传中...</span>
        `;
        listEl.appendChild(itemEl);

        const formData = new FormData();
        formData.append('file', file);
        if (moduleId && !isNaN(moduleId)) {
            formData.append('moduleId', moduleId);
        }
        if (klCurrentParentId) {
            formData.append('parentId', klCurrentParentId);
        }
        if (uploadLibraryId) {
            formData.append('libraryId', uploadLibraryId);
        }

        const progressBar = itemEl.querySelector('.upload-progress-bar');
        const statusEl = itemEl.querySelector('.upload-status');

        try {
            const token = localStorage.getItem('authToken') || localStorage.getItem('token');
            
            if (!token) {
                throw new Error('未登录，请重新登录后再试');
            }
            
            progressBar.style.width = '30%';
            statusEl.textContent = '上传中...';
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            try {
                const res = await fetch(KL_API_BASE + '/api/knowledge/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (res.status === 401) {
                    throw new Error('登录已过期，请重新登录后再试');
                }
                
                if (res.status === 413) {
                    throw new Error('文件太大，超过服务器限制');
                }
                
                if (!res.ok) {
                    const errorText = await res.text();
                    let errorMsg = `HTTP ${res.status}`;
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMsg = errorJson.message || errorMsg;
                    } catch (e) {
                        errorMsg = errorText.substring(0, 200) || errorMsg;
                    }
                    throw new Error(errorMsg);
                }
                
                const result = await res.json();

                if (result.success) {
                    progressBar.style.width = '100%';
                    statusEl.textContent = '✓ 成功';
                    statusEl.className = 'upload-status success';
                    successCount++;
                    
                    if (result.data && result.data.hasConflict) {
                        statusEl.textContent = '⚠ 同名文件';
                        statusEl.className = 'upload-status warning';
                        klNotify(`文件 "${file.name}" 已存在同名文件`, 'warning');
                    }
                } else {
                    throw new Error(result.message || '上传失败');
                }
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    throw new Error('上传超时（30秒），请检查网络连接或服务器状态');
                }
                if (fetchError.name === 'TypeError' && fetchError.message.includes('Failed to fetch')) {
                    throw new Error('网络连接失败，请检查服务器是否正常运行');
                }
                throw fetchError;
            }
        } catch (e) {
            progressBar.style.width = '100%';
            progressBar.style.background = '#ef4444';
            statusEl.textContent = '✗ 失败';
            statusEl.className = 'upload-status error';
            statusEl.title = e.message;
            failCount++;
            
            itemEl.title = `上传失败: ${e.message}`;
            console.error('[Knowledge Library] Upload error:', e);
        }
    }

    if (successCount > 0) {
        klInvalidateApiCache();
        klNotify(`成功上传 ${successCount} 个文件`, 'success');
    }
    if (failCount > 0) {
        klNotify(`${failCount} 个文件上传失败`, 'error');
    }

    klPendingUploadFiles = [];
    klUploading = false;

    const summaryEl = document.createElement('div');
    summaryEl.className = 'kl-upload-summary';
    const summaryType = failCount > 0 ? (successCount > 0 ? 'partial' : 'error') : 'success';
    const summaryIcon = summaryType === 'success' ? '✅' : summaryType === 'partial' ? '⚠️' : '❌';
    const c = ThemeService.getColors();
    const summaryBg = summaryType === 'success' ? c.successBg : summaryType === 'partial' ? c.warningBg : c.dangerBg;
    const summaryBorder = summaryType === 'success' ? `${c.success}44` : summaryType === 'partial' ? `${c.warning}44` : `${c.danger}44`;
    const summaryColor = summaryType === 'success' ? c.success : summaryType === 'partial' ? c.warning : c.danger;
    summaryEl.style.cssText = `margin-top:12px;padding:12px 16px;background:${summaryBg};border:1px solid ${summaryBorder};border-radius:8px;color:${summaryColor};`;
    summaryEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <span>${summaryIcon} 上传完成：${successCount} 个成功${failCount > 0 ? `，${failCount} 个失败` : ''}</span>
            <button class="kl-btn kl-btn-sm kl-btn-primary" id="btnUploadDone">完成</button>
        </div>
    `;
    progressContainer.appendChild(summaryEl);

    document.getElementById('btnUploadDone').addEventListener('click', () => {
        klCloseModal('uploadModal');
    });

    if (klCurrentModuleId === moduleId) {
        setTimeout(() => loadModuleFiles(), 500);
    } else if (klCurrentFolderId) {
        setTimeout(() => loadLibraryFolderFiles(), 500);
    } else if (uploadLibraryId || klCurrentLibraryId) {
        setTimeout(() => loadLibraryFolderFiles(), 500);
    }
    refreshTreeCounts();
}

function initDetailPanelResize() {
    const panel = document.getElementById('detailPanel');
    const handle = document.getElementById('detailResizeHandle');
    if (!panel || !handle) return;

    let isResizing = false;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = window.innerWidth - e.clientX;
        const minWidth = 320;
        const maxWidth = Math.round(window.innerWidth * 0.9);
        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        panel.style.width = clampedWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

function initSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('sidebarResizeHandle');
    if (!sidebar || !handle) return;

    const savedWidth = localStorage.getItem('kl-sidebar-width');
    if (savedWidth) {
        sidebar.style.width = savedWidth + 'px';
    }

    let isResizing = false;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const minWidth = 180;
        const maxWidth = Math.round(window.innerWidth * 0.4);
        const newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX));
        sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('kl-sidebar-width', parseInt(sidebar.style.width) || 280);
    });
}

function initPreviewModalResize() {
    const modal = document.getElementById('previewModal');
    if (!modal) return;

    let isResizing = false;
    let resizeType = '';
    let startX = 0, startY = 0, startWidth = 0, startHeight = 0;

    const savedSize = localStorage.getItem('kl-preview-modal-size');
    if (savedSize) {
        try {
            const size = JSON.parse(savedSize);
            modal.style.width = size.width + 'px';
            modal.style.height = size.height + 'px';
        } catch (e) {}
    }

    modal.addEventListener('mousedown', (e) => {
        const rect = modal.getBoundingClientRect();
        const edgeSize = 10;
        
        const onLeftEdge = e.clientX - rect.left < edgeSize;
        const onRightEdge = rect.right - e.clientX < edgeSize;
        const onTopEdge = e.clientY - rect.top < edgeSize;
        const onBottomEdge = rect.bottom - e.clientY < edgeSize;

        if (!onLeftEdge && !onRightEdge && !onTopEdge && !onBottomEdge) return;

        isResizing = true;
        if (onRightEdge && onBottomEdge) resizeType = 'se';
        else if (onLeftEdge && onBottomEdge) resizeType = 'sw';
        else if (onRightEdge && onTopEdge) resizeType = 'ne';
        else if (onLeftEdge && onTopEdge) resizeType = 'nw';
        else if (onRightEdge) resizeType = 'e';
        else if (onLeftEdge) resizeType = 'w';
        else if (onBottomEdge) resizeType = 's';
        else if (onTopEdge) resizeType = 'n';

        startX = e.clientX;
        startY = e.clientY;
        startWidth = rect.width;
        startHeight = rect.height;

        document.body.style.cursor = resizeType.includes('e') || resizeType.includes('w') ? 
            (resizeType.includes('n') || resizeType.includes('s') ? 
                (resizeType === 'ne' || resizeType === 'sw' ? 'nesw-resize' : 'nwse-resize') : 'col-resize') : 
            (resizeType.includes('n') || resizeType.includes('s') ? 'row-resize' : 'default');
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const minWidth = 400;
        const minHeight = 300;
        const maxWidth = window.innerWidth * 0.95;
        const maxHeight = window.innerHeight * 0.95;

        let newWidth = startWidth;
        let newHeight = startHeight;

        if (resizeType.includes('e')) {
            newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + (e.clientX - startX)));
        }
        if (resizeType.includes('w')) {
            newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth - (e.clientX - startX)));
        }
        if (resizeType.includes('s')) {
            newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + (e.clientY - startY)));
        }
        if (resizeType.includes('n')) {
            newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight - (e.clientY - startY)));
        }

        modal.style.width = newWidth + 'px';
        modal.style.height = newHeight + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        const rect = modal.getBoundingClientRect();
        localStorage.setItem('kl-preview-modal-size', JSON.stringify({
            width: rect.width,
            height: rect.height
        }));
    });
}

function handleAIGenerate() {
    if (klSelectedFiles.size === 0) {
        klNotify('请先选择文件后再点击AI生成', 'warning');
        return;
    }

    const fileIds = Array.from(klSelectedFiles);
    const moduleIds = new Set();
    const libraryIds = new Set();
    fileIds.forEach(id => {
        const info = klSelectedFileModuleMap[id];
        if (info) {
            moduleIds.add(info.moduleId);
            libraryIds.add(info.libraryId);
        } else {
            moduleIds.add(klCurrentModuleId);
            libraryIds.add(klCurrentLibraryId);
        }
    });

    if (moduleIds.size === 1) {
        const moduleId = moduleIds.values().next().value;
        const libraryId = libraryIds.values().next().value;
        startAIGeneration(moduleId, libraryId);
    } else {
        showAITargetModal(fileIds.length, libraryIds.size, moduleIds.size);
    }
}

function showAITargetModal(fileCount, libraryCount, moduleCount) {
    const fileInfo = document.getElementById('aiTargetFileInfo');
    if (libraryCount > 1) {
        fileInfo.textContent = `已选中 ${fileCount} 个文件，分布在 ${libraryCount} 个用例库中，请选择AI生成测试用例的目标位置`;
    } else {
        fileInfo.textContent = `已选中 ${fileCount} 个文件，分布在 ${moduleCount} 个模块中，请选择AI生成测试用例的目标位置`;
    }

    const librarySelect = document.getElementById('aiTargetLibrarySelect');
    librarySelect.innerHTML = '<option value="">请选择用例库</option>';
    for (const lib of klLibraries) {
        const opt = document.createElement('option');
        opt.value = lib.id;
        opt.textContent = lib.name;
        librarySelect.appendChild(opt);
    }

    const moduleSelect = document.getElementById('aiTargetModuleSelect');
    moduleSelect.innerHTML = '<option value="">请先选择用例库</option>';

    klOpenModal('aiGenerateTargetModal');
}

async function startAIGeneration(moduleId, libraryId) {
    const fileIds = Array.from(klSelectedFiles);
    const params = new URLSearchParams({
        libraryId: libraryId || '',
        moduleId: moduleId || '',
        selectedFiles: fileIds.join(',')
    });
    klSelectedFiles.clear();
    klSelectedFileModuleMap = {};
    updateBatchBar();
    renderFileArea();

    if (typeof Router !== 'undefined' && Router.navigateTo) {
        window.location.hash = `#/ai-generation?${params.toString()}`;
    }
}

function initKLEventListeners() {
    initDetailPanelResize();
    initSidebarResize();
    initPreviewModalResize();
    
    document.getElementById('btnCollapseSidebar').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('collapsed');
        document.getElementById('btnExpandSidebar').classList.add('visible');
    });

    document.getElementById('btnExpandSidebar').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('collapsed');
        document.getElementById('btnExpandSidebar').classList.remove('visible');
    });

    document.getElementById('btnUpload').addEventListener('click', () => {
        populateModuleSelects();
        document.getElementById('uploadProgress').innerHTML = '';
        klOpenModal('uploadModal');
    });

    document.getElementById('btnNewFolder').addEventListener('click', () => {
        populateModuleSelects();

        const hintGroup = document.getElementById('folderHintGroup');
        const moduleGroup = document.getElementById('folderModuleGroup');
        const select = document.getElementById('folderModuleSelect');

        if (klCurrentModuleId) {
            // 当前在模块（测试点）下
            const modules = klModulesMap[klCurrentLibraryId] || [];
            const mod = modules.find(m => m.id === klCurrentModuleId);
            const lib = klLibraries.find(l => l.id === klCurrentLibraryId);
            if (mod && lib) {
                document.getElementById('folderHintText').textContent = `将在「${lib.name}」的「${mod.name}」模块下创建文件夹`;
                hintGroup.style.display = 'block';
                moduleGroup.style.display = 'none';
                select.dataset.libraryId = klCurrentLibraryId;
            } else {
                hintGroup.style.display = 'none';
                moduleGroup.style.display = 'block';
            }
        } else if (klCurrentFolderId && klCurrentLibraryId) {
            // 当前在用例库级别的文件夹中
            const lib = klLibraries.find(l => l.id === klCurrentLibraryId);
            const folders = klLibraryFoldersMap[klCurrentLibraryId] || [];
            const folder = folders.find(f => f.id === klCurrentFolderId);
            document.getElementById('folderHintText').textContent = `将在文件夹「${folder ? folder.name : ''}」下创建子文件夹`;
            hintGroup.style.display = 'block';
            moduleGroup.style.display = 'none';
            select.dataset.libraryId = klCurrentLibraryId;
            select.dataset.parentFolderId = klCurrentFolderId;
        } else if (klCurrentLibraryId) {
            // 当前选中了用例库但没选模块
            showNewFolderModalForLibrary(klCurrentLibraryId);
            return;
        } else {
            hintGroup.style.display = 'none';
            moduleGroup.style.display = 'block';
        }

        document.getElementById('newFolderName').value = '';
        klOpenModal('newFolderModal');
        setTimeout(() => document.getElementById('newFolderName').focus(), 100);
    });

    document.getElementById('btnCrawl').addEventListener('click', () => {
        populateModuleSelects();
        document.getElementById('crawlUrl').value = '';
        document.getElementById('crawlUsername').value = '';
        document.getElementById('crawlPassword').value = '';
        klOpenModal('crawlModal');
    });

    document.getElementById('btnListView').addEventListener('click', () => {
        klViewMode = 'list';
        document.getElementById('btnListView').classList.add('active');
        document.getElementById('btnGridView').classList.remove('active');
        renderFileArea();
    });

    document.getElementById('btnGridView').addEventListener('click', () => {
        klViewMode = 'grid';
        document.getElementById('btnGridView').classList.add('active');
        document.getElementById('btnListView').classList.remove('active');
        renderFileArea();
    });

    document.getElementById('searchInput').addEventListener('input', () => renderFileArea());
    document.getElementById('filterType').addEventListener('change', () => renderFileArea());
    document.getElementById('filterStatus').addEventListener('change', () => renderFileArea());

    document.getElementById('checkAll').addEventListener('change', function() {
        if (this.checked) {
            klCurrentFiles.filter(f => f.type !== 'folder').forEach(f => {
                klSelectedFiles.add(f.id);
                klSelectedFileModuleMap[f.id] = { moduleId: klCurrentModuleId, libraryId: klCurrentLibraryId };
            });
        } else {
            klSelectedFiles.clear();
            klSelectedFileModuleMap = {};
        }
        renderFileArea();
        updateBatchBar();
    });

    document.getElementById('btnSelectAll').addEventListener('click', () => {
        klCurrentFiles.filter(f => f.type !== 'folder').forEach(f => {
            klSelectedFiles.add(f.id);
            klSelectedFileModuleMap[f.id] = { moduleId: klCurrentModuleId, libraryId: klCurrentLibraryId };
        });
        renderFileArea();
        updateBatchBar();
    });

    document.getElementById('btnBatchDownload').addEventListener('click', batchDownload);
    document.getElementById('btnBatchDelete').addEventListener('click', batchDelete);
    document.getElementById('btnBatchDownloadBar').addEventListener('click', batchDownload);
    document.getElementById('btnBatchDeleteBar').addEventListener('click', batchDelete);
    document.getElementById('btnBatchCancel').addEventListener('click', () => {
        klSelectedFiles.clear();
        klSelectedFileModuleMap = {};
        renderFileArea();
        updateBatchBar();
    });

    document.getElementById('btnCloseDetail').addEventListener('click', closeDetailPanel);
    document.getElementById('btnClosePreview').addEventListener('click', () => klCloseModal('previewModal'));
    document.getElementById('btnCloseUpload').addEventListener('click', () => klCloseModal('uploadModal'));
    document.getElementById('btnCancelUpload').addEventListener('click', () => klCloseModal('uploadModal'));
    document.getElementById('btnCloseNewFolder').addEventListener('click', () => klCloseModal('newFolderModal'));
    document.getElementById('btnCancelNewFolder').addEventListener('click', () => klCloseModal('newFolderModal'));
    document.getElementById('btnCloseRename').addEventListener('click', () => klCloseModal('renameModal'));
    document.getElementById('btnCancelRename').addEventListener('click', () => klCloseModal('renameModal'));
    document.getElementById('btnCloseCrawl').addEventListener('click', () => klCloseModal('crawlModal'));
    document.getElementById('btnCancelCrawl').addEventListener('click', () => klCloseModal('crawlModal'));
    document.getElementById('btnCloseConfirm').addEventListener('click', () => klCloseModal('confirmModal'));
    document.getElementById('btnConfirmCancel').addEventListener('click', () => klCloseModal('confirmModal'));

    document.getElementById('btnConfirmOk').addEventListener('click', () => {
        klCloseModal('confirmModal');
        if (klConfirmCallback) {
            klConfirmCallback();
            klConfirmCallback = null;
        }
    });

    document.getElementById('btnConfirmNewFolder').addEventListener('click', async () => {
        const select = document.getElementById('folderModuleSelect');
        const moduleIdValue = select.value;
        const moduleId = moduleIdValue ? parseInt(moduleIdValue) : null;
        const name = document.getElementById('newFolderName').value.trim();
        const libraryId = parseInt(select.dataset.libraryId);
        const parentFolderId = select.dataset.parentFolderId ? parseInt(select.dataset.parentFolderId) : null;

        if (!name) { klNotify('请输入文件夹名称', 'warning'); return; }
        if (!libraryId) { klNotify('缺少用例库信息', 'warning'); return; }

        try {
            await klApiPost('/api/knowledge/folder', {
                libraryId,
                moduleId: moduleId || null,
                parentId: parentFolderId || klCurrentParentId || null,
                name
            });
            klCloseModal('newFolderModal');
            klInvalidateApiCache();

            // 清理临时数据属性
            delete select.dataset.parentFolderId;

            // 刷新对应区域
            if (moduleId && klCurrentModuleId === moduleId) {
                loadModuleFiles();
            } else if (klCurrentFolderId || !moduleId) {
                loadLibraryFolderFiles();
            }

            // 重新加载左侧树（包括用例库级别的文件夹）
            await loadKLLibraries();
            klNotify('文件夹创建成功', 'success');
        } catch (e) {
            klNotify('创建失败: ' + e.message, 'error');
        }
    });

    document.getElementById('newFolderName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btnConfirmNewFolder').click();
    });

    document.getElementById('btnConfirmCrawl').addEventListener('click', async () => {
        const moduleId = parseInt(document.getElementById('crawlModuleSelect').value);
        const url = document.getElementById('crawlUrl').value;
        if (!moduleId) { klNotify('请选择目标模块', 'warning'); return; }
        if (!url) { klNotify('请输入URL', 'warning'); return; }
        try {
            klNotify('正在爬取网页...', 'info');
            const res = await klApiPost('/api/knowledge/crawl', {
                url, moduleId,
                username: document.getElementById('crawlUsername').value || undefined,
                password: document.getElementById('crawlPassword').value || undefined
            });
            if (res && res.success) {
                klInvalidateApiCache();
                klNotify('网页爬取并保存成功！', 'success');
                klCloseModal('crawlModal');
                if (klCurrentModuleId === moduleId) loadModuleFiles();
                refreshTreeCounts();
            } else {
                klNotify(res?.data?.error || '爬取失败', 'error');
            }
        } catch (e) {
            klNotify('爬取失败: ' + e.message, 'error');
        }
    });

    document.getElementById('btnPreviewDownload').addEventListener('click', () => {
        if (klCurrentPreviewFileId) downloadFile(klCurrentPreviewFileId);
    });

    document.getElementById('btnPreviewFullscreen').addEventListener('click', () => {
        const content = document.getElementById('previewContent');
        if (content.requestFullscreen) content.requestFullscreen();
        else if (content.webkitRequestFullscreen) content.webkitRequestFullscreen();
    });

    document.querySelectorAll('#knowledge-section .kl-file-list-header .col.sortable').forEach(col => {
        col.addEventListener('click', function() {
            const field = this.dataset.sort;
            if (klSortField === field) {
                klSortOrder = klSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                klSortField = field;
                klSortOrder = 'asc';
            }
            document.querySelectorAll('#knowledge-section .kl-file-list-header .col').forEach(c => {
                c.classList.remove('sort-asc', 'sort-desc');
            });
            this.classList.add(klSortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
            renderFileArea();
        });
    });

    document.querySelectorAll('#knowledge-section .kl-context-menu-item').forEach(item => {
        item.addEventListener('click', function() {
            const action = this.dataset.action;
            const id = klContextMenuTarget;
            hideContextMenu();
            if (!id) return;
            if (action === 'preview') previewFile(id);
            else if (action === 'download') downloadFile(id);
            else if (action === 'rename') {
                const file = klCurrentFiles.find(f => f.id === id);
                if (file) startRename(id, file.name);
            } else if (action === 'detail') showFileDetail(id);
            else if (action === 'delete') {
                const file = klCurrentFiles.find(f => f.id === id);
                if (file) {
                    if (file.type === 'folder') {
                        klShowConfirm(`确定要删除文件夹 "${klEscapeHtml(file.name)}" 吗？文件夹内的所有文件也将被删除。`, () => deleteTreeFolder(id, klCurrentLibraryId), '🗑️');
                    } else {
                        klShowConfirm(`确定要删除 "${klEscapeHtml(file.name)}" 吗？`, () => deleteFile(id), '🗑️');
                    }
                }
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.kl-context-menu')) hideContextMenu();
    });

    document.addEventListener('keydown', (e) => {
        const section = document.getElementById('knowledge-section');
        if (!section || section.style.display === 'none') return;
        if (e.key === 'Escape') {
            const uploadModal = document.getElementById('uploadModal');
            if (uploadModal && uploadModal.classList.contains('open')) return;
            closeKLModals();
            hideContextMenu();
        }
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }
    });

    initUploadZone();

    document.getElementById('btnAIGenerate').addEventListener('click', handleAIGenerate);

    document.getElementById('btnCloseAiTarget').addEventListener('click', () => klCloseModal('aiGenerateTargetModal'));
    document.getElementById('btnCancelAiTarget').addEventListener('click', () => klCloseModal('aiGenerateTargetModal'));

    document.getElementById('aiTargetLibrarySelect').addEventListener('change', function() {
        const libId = parseInt(this.value);
        const moduleSelect = document.getElementById('aiTargetModuleSelect');
        moduleSelect.innerHTML = '<option value="">请选择模块</option>';
        if (!libId) return;
        const modules = klModulesMap[libId] || [];
        modules.forEach(mod => {
            const opt = document.createElement('option');
            opt.value = mod.id;
            opt.textContent = mod.name;
            moduleSelect.appendChild(opt);
        });
    });

    document.getElementById('btnConfirmAiTarget').addEventListener('click', async () => {
        const libraryId = parseInt(document.getElementById('aiTargetLibrarySelect').value);
        const moduleId = parseInt(document.getElementById('aiTargetModuleSelect').value);
        if (!libraryId) { klNotify('请选择目标用例库', 'warning'); return; }
        if (!moduleId) { klNotify('请选择目标模块', 'warning'); return; }
        klCloseModal('aiGenerateTargetModal');
        await startAIGeneration(moduleId, libraryId);
    });
}
