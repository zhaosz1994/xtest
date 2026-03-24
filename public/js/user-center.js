/**
 * 个人中心逻辑
 * 文件路径: public/js/user-center.js
 */

const UserCenter = {
    authToken: localStorage.getItem('authToken'),
    currentUser: JSON.parse(localStorage.getItem('currentUser') || 'null'),
    postPage: 1,
    postKeyword: '',
    commentPage: 1,
    commentKeyword: '',
    userPage: 1,
    userKeyword: '',
    limit: 10
};

function isAdmin() {
    if (!UserCenter.currentUser) return false;
    const role = UserCenter.currentUser.role;
    return role === 'admin' || role === '管理员' || role === 'Administrator';
}

async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    if (UserCenter.authToken) {
        defaultOptions.headers['Authorization'] = `Bearer ${UserCenter.authToken}`;
    }
    
    const response = await fetch(`/api/forum${url}`, {
        ...defaultOptions,
        ...options,
        headers: { ...defaultOptions.headers, ...options.headers }
    });
    
    return await response.json();
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('current-year').textContent = new Date().getFullYear();
    
    if (!UserCenter.authToken || !UserCenter.currentUser) {
        window.location.href = 'index.html';
        return;
    }
    
    initUserInfo();
    initTabs();
    initSearchEvents();
    
    // 如果是管理员，显示用户管理标签页
    if (isAdmin()) {
        document.getElementById('user-management-tab').style.display = 'inline-block';
    }
    
    await loadMyPosts();
});

function initUserInfo() {
    const avatar = document.getElementById('user-avatar');
    const name = document.getElementById('user-name');
    const role = document.getElementById('user-role');
    const userStatus = document.getElementById('user-status');
    
    if (UserCenter.currentUser) {
        avatar.textContent = UserCenter.currentUser.username.charAt(0).toUpperCase();
        name.textContent = UserCenter.currentUser.username;
        // 隐藏角色显示
        if (role) {
            role.style.display = 'none';
        }
        userStatus.innerHTML = `<span class="user-name">${escapeHtml(UserCenter.currentUser.username)}</span>`;
    }
}

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.dataset.tab;
            
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            
            e.target.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            
            if (tabId === 'my-comments') {
                loadMyComments();
            } else if (tabId === 'user-management') {
                loadUsers();
            } else if (tabId === 'recycle-bin') {
                loadRecycleBin();
            }
        });
    });
}

function initSearchEvents() {
    const postSearchInput = document.getElementById('post-search-input');
    const commentSearchInput = document.getElementById('comment-search-input');
    
    postSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPosts();
    });
    
    commentSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchComments();
    });
}

function searchPosts() {
    UserCenter.postPage = 1;
    UserCenter.postKeyword = document.getElementById('post-search-input').value.trim();
    loadMyPosts();
}

function searchComments() {
    UserCenter.commentPage = 1;
    UserCenter.commentKeyword = document.getElementById('comment-search-input').value.trim();
    loadMyComments();
}

async function loadMyPosts() {
    const postListEl = document.getElementById('post-list');
    postListEl.innerHTML = '<div class="loading">加载中...</div>';
    
    const { postPage, postKeyword, limit } = UserCenter;
    const params = new URLSearchParams({
        page: postPage,
        limit: limit
    });
    if (postKeyword) {
        params.append('keyword', postKeyword);
    }
    
    try {
        const result = await apiRequest(`/posts/my?${params.toString()}`);
        
        if (result.success) {
            renderMyPosts(result.data);
            renderPagination(
                result.total,
                result.page,
                result.limit,
                'post-pagination',
                (page) => {
                    UserCenter.postPage = page;
                    loadMyPosts();
                }
            );
        } else {
            postListEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <p>${result.message || '加载失败'}</p>
                </div>
            `;
            document.getElementById('post-pagination').innerHTML = '';
        }
    } catch (error) {
        console.error('加载帖子失败:', error);
        postListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <p>加载失败</p>
            </div>
        `;
        document.getElementById('post-pagination').innerHTML = '';
    }
}

function renderMyPosts(posts) {
    const postListEl = document.getElementById('post-list');
    
    if (!posts || posts.length === 0) {
        postListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <p>${UserCenter.postKeyword ? '未找到匹配的帖子' : '暂无帖子，<a href="post-create.html">发布第一篇帖子</a>'}</p>
            </div>
        `;
        return;
    }
    
    postListEl.innerHTML = posts.map(post => `
        <div class="my-post-item" data-id="${post.id}">
            <div class="my-post-header">
                <h4 class="my-post-title">
                    <a href="post-detail.html?id=${post.id}">${escapeHtml(post.title)}</a>
                    ${post.isAnonymous ? '<span class="badge-anonymous">👁️ 已匿名发布</span>' : ''}
                </h4>
                <div class="my-post-actions">
                    <button class="action-btn edit" onclick="window.location.href='post-edit.html?id=${post.id}'">编辑</button>
                    <button class="action-btn delete" onclick="deletePost(${post.id})">删除</button>
                </div>
            </div>
            <p class="my-post-summary">${escapeHtml(post.summary)}</p>
            <div class="my-post-meta">
                <span>👁 ${post.viewCount} 次浏览</span>
                <span>💬 ${post.commentCount} 条评论</span>
                <span>📅 ${formatTime(post.createdAt)}</span>
            </div>
        </div>
    `).join('');
}

async function loadMyComments() {
    const commentListEl = document.getElementById('comment-list');
    commentListEl.innerHTML = '<div class="loading">加载中...</div>';
    
    const { commentPage, commentKeyword, limit } = UserCenter;
    const params = new URLSearchParams({
        page: commentPage,
        limit: limit
    });
    if (commentKeyword) {
        params.append('keyword', commentKeyword);
    }
    
    try {
        const result = await apiRequest(`/comments/my?${params.toString()}`);
        
        if (result.success) {
            renderMyComments(result.data);
            renderPagination(
                result.total,
                result.page,
                result.limit,
                'comment-pagination',
                (page) => {
                    UserCenter.commentPage = page;
                    loadMyComments();
                }
            );
        } else {
            commentListEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">💬</div>
                    <p>${result.message || '加载失败'}</p>
                </div>
            `;
            document.getElementById('comment-pagination').innerHTML = '';
        }
    } catch (error) {
        console.error('加载评论失败:', error);
        commentListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <p>加载失败: ${error.message}</p>
            </div>
        `;
        document.getElementById('comment-pagination').innerHTML = '';
    }
}

function renderMyComments(comments) {
    const commentListEl = document.getElementById('comment-list');
    
    if (!comments || comments.length === 0) {
        commentListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💬</div>
                <p>${UserCenter.commentKeyword ? '未找到匹配的评论' : '暂无评论'}</p>
            </div>
        `;
        return;
    }
    
    commentListEl.innerHTML = comments.map(comment => `
        <div class="comment-item">
            <div class="comment-post-title">
                回复: <a href="post-detail.html?id=${comment.postId}">${escapeHtml(comment.postTitle || '帖子')}</a>
                ${comment.isAnonymous ? '<span class="badge-anonymous">👁️ 已匿名发布</span>' : ''}
            </div>
            <div class="comment-content">${escapeHtml(comment.content)}</div>
            <div class="comment-time">${formatTime(comment.createdAt)}</div>
        </div>
    `).join('');
}

function renderPagination(total, currentPage, limit, containerId, callback) {
    const container = document.getElementById(containerId);
    
    if (!container) return;
    
    const totalPages = Math.ceil(total / limit);
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '';
    
    html += `<button class="page-btn" ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">上一页</button>`;
    
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage + 1 < maxVisible) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
        html += `<button class="page-btn" data-page="1">1</button>`;
        if (startPage > 2) {
            html += `<span class="page-ellipsis">...</span>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span class="page-ellipsis">...</span>`;
        }
        html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }
    
    html += `<button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">下一页</button>`;
    
    container.innerHTML = html;
    
    container.querySelectorAll('.page-btn:not(:disabled)').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = parseInt(btn.dataset.page);
            if (page && page !== currentPage) {
                callback(page);
            }
        });
    });
}

let editSelectedTags = [];

async function openEditModal(postId, title, content, tags) {
    document.getElementById('edit-post-id').value = postId;
    document.getElementById('edit-title').value = title;
    document.getElementById('edit-content').value = content;
    
    editSelectedTags = tags || [];
    await loadEditTags();
    
    document.getElementById('edit-modal').style.display = 'flex';
}

async function loadEditTags() {
    const tagSelector = document.getElementById('edit-tag-selector');
    tagSelector.innerHTML = '<div class="loading">加载标签...</div>';
    
    try {
        const result = await apiRequest('/tags');
        
        if (result.success && result.data) {
            renderEditTags(result.data);
        }
    } catch (error) {
        console.error('加载标签失败:', error);
        tagSelector.innerHTML = '<p class="error">加载失败</p>';
    }
}

function renderEditTags(tags) {
    const tagSelector = document.getElementById('edit-tag-selector');
    
    if (!tags || tags.length === 0) {
        tagSelector.innerHTML = '<p class="hint">暂无可用标签</p>';
        return;
    }
    
    tagSelector.innerHTML = tags.map(tag => {
        const isSelected = editSelectedTags.some(t => t.id === tag.id);
        return `
            <div class="tag-option ${isSelected ? 'selected' : ''}" data-id="${tag.id}" onclick="toggleEditTag(${tag.id})">
                <span class="tag-color" style="background-color: ${tag.color}"></span>
                ${escapeHtml(tag.name)}
            </div>
        `;
    }).join('');
}

function toggleEditTag(tagId) {
    const tagEl = document.querySelector(`#edit-tag-selector .tag-option[data-id="${tagId}"]`);
    const index = editSelectedTags.findIndex(id => id === tagId);
    
    if (index > -1) {
        editSelectedTags.splice(index, 1);
        tagEl.classList.remove('selected');
    } else {
        editSelectedTags.push(tagId);
        tagEl.classList.add('selected');
    }
}

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

async function saveEditPost() {
    const postId = document.getElementById('edit-post-id').value;
    const title = document.getElementById('edit-title').value.trim();
    const content = document.getElementById('edit-content').value.trim();
    
    if (!title) {
        showToast('请输入标题', 'error');
        return;
    }
    
    if (!content) {
        showToast('请输入内容', 'error');
        return;
    }
    
    try {
        const result = await apiRequest(`/posts/${postId}`, {
            method: 'PUT',
            body: JSON.stringify({ title, content, tags: editSelectedTags })
        });
        
        if (result.success) {
            showToast('更新成功', 'success');
            closeEditModal();
            await loadMyPosts();
        } else {
            showToast(result.message || '更新失败', 'error');
        }
    } catch (error) {
        console.error('更新帖子失败:', error);
        showToast('更新失败', 'error');
    }
}

async function deletePost(postId) {
    showConfirm('确定要删除这篇帖子吗？此操作不可恢复。', async (confirmed) => {
        if (!confirmed) return;
        
        try {
            const result = await apiRequest(`/posts/${postId}`, {
                method: 'DELETE'
            });
            
            if (result.success) {
                showToast('删除成功', 'success');
                await loadMyPosts();
            } else {
                showToast(result.message || '删除失败', 'error');
            }
        } catch (error) {
            console.error('删除帖子失败:', error);
            showToast('删除失败', 'error');
        }
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeForJs(text) {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

// ==================== 用户管理功能 ====================

async function loadUsers() {
    const userListEl = document.getElementById('user-list');
    userListEl.innerHTML = '<div class="loading">加载中...</div>';
    
    const { userPage, userKeyword, limit } = UserCenter;
    const params = new URLSearchParams({
        page: userPage,
        pageSize: limit
    });
    if (userKeyword) {
        params.append('search', userKeyword);
    }
    
    try {
        const response = await fetch(`/api/users/list?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${UserCenter.authToken}`
            }
        });
        const result = await response.json();
        
        if (result.success) {
            renderUsers(result.users);
            renderPagination(
                result.pagination.total,
                result.pagination.page,
                result.pagination.pageSize || limit,
                'user-pagination',
                (page) => {
                    UserCenter.userPage = page;
                    loadUsers();
                }
            );
        } else {
            userListEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">👥</div>
                    <p>${result.message || '加载失败'}</p>
                </div>
            `;
            document.getElementById('user-pagination').innerHTML = '';
        }
    } catch (error) {
        console.error('加载用户列表失败:', error);
        userListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <p>加载失败: ${error.message}</p>
            </div>
        `;
        document.getElementById('user-pagination').innerHTML = '';
    }
}

function renderUsers(users) {
    const userListEl = document.getElementById('user-list');
    
    if (!users || users.length === 0) {
        userListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <p>${UserCenter.userKeyword ? '未找到匹配的用户' : '暂无用户'}</p>
            </div>
        `;
        return;
    }
    
    userListEl.innerHTML = users.map(user => {
        const isMuted = user.muted_until && new Date(user.muted_until) > new Date();
        const mutedUntil = isMuted ? formatMutedTime(user.muted_until) : null;
        
        return `
            <div class="user-item" data-id="${user.id}">
                <div class="user-item-info">
                    <div class="user-item-avatar">${(user.username || 'U').charAt(0).toUpperCase()}</div>
                    <div class="user-item-details">
                        <div class="user-item-name">
                            ${escapeHtml(user.username)}
                            <span class="user-item-role">${escapeHtml(user.role || '用户')}</span>
                            ${isMuted ? '<span class="badge-muted">🔇 已禁言</span>' : ''}
                        </div>
                        <div class="user-item-meta">
                            <span>邮箱: ${escapeHtml(user.email || '未设置')}</span>
                            <span>状态: ${user.status === 'active' ? '✅ 正常' : '❌ 禁用'}</span>
                            <span>注册: ${formatTime(user.created_at)}</span>
                        </div>
                        ${isMuted ? `<div class="muted-info">禁言至: ${mutedUntil}</div>` : ''}
                    </div>
                </div>
                <div class="user-item-actions">
                    ${user.id !== UserCenter.currentUser.id ? `
                        ${isMuted ? 
                            `<button class="action-btn unmute" onclick="unmuteUser(${user.id})">解除禁言</button>` :
                            `<button class="action-btn mute" onclick="showMuteModal(${user.id}, '${escapeHtml(user.username)}')">禁言</button>`
                        }
                    ` : '<span class="self-badge">当前用户</span>'}
                </div>
            </div>
        `;
    }).join('');
}

function formatMutedTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function searchUsers() {
    UserCenter.userPage = 1;
    UserCenter.userKeyword = document.getElementById('user-search-input').value.trim();
    loadUsers();
}

let currentMuteUserId = null;

function showMuteModal(userId, username) {
    currentMuteUserId = userId;
    
    const modalHtml = `
        <div id="mute-modal" class="modal" style="display: flex;">
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3>禁言用户: ${escapeHtml(username)}</h3>
                    <span class="modal-close" onclick="closeMuteModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>禁言时长</label>
                        <select id="mute-duration" class="form-input">
                            <option value="1">1 小时</option>
                            <option value="24">1 天</option>
                            <option value="72">3 天</option>
                            <option value="168" selected>1 周</option>
                            <option value="720">1 个月</option>
                            <option value="8760">永久</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>禁言原因（可选）</label>
                        <textarea id="mute-reason" class="form-textarea" rows="3" placeholder="请输入禁言原因..."></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeMuteModal()">取消</button>
                    <button class="btn btn-danger" onclick="muteUser()">确认禁言</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeMuteModal() {
    const modal = document.getElementById('mute-modal');
    if (modal) {
        modal.remove();
    }
    currentMuteUserId = null;
}

async function muteUser() {
    if (!currentMuteUserId) return;
    
    const durationHours = parseInt(document.getElementById('mute-duration').value);
    const reason = document.getElementById('mute-reason').value.trim();
    
    // 将小时转换为天数（向上取整，最少1天）
    const days = Math.max(1, Math.ceil(durationHours / 24));
    
    try {
        const response = await fetch(`/api/forum/users/${currentMuteUserId}/mute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${UserCenter.authToken}`
            },
            body: JSON.stringify({ days, reason })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('禁言成功', 'success');
            closeMuteModal();
            await loadUsers();
        } else {
            showToast(result.message || '禁言失败', 'error');
        }
    } catch (error) {
        console.error('禁言用户失败:', error);
        showToast('禁言失败', 'error');
    }
}

async function unmuteUser(userId) {
    showConfirm('确定要解除该用户的禁言状态吗？', async (confirmed) => {
        if (!confirmed) return;
        
        try {
            const response = await fetch(`/api/forum/users/${userId}/mute`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${UserCenter.authToken}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast('已解除禁言', 'success');
                await loadUsers();
            } else {
                showToast(result.message || '解除禁言失败', 'error');
            }
        } catch (error) {
            console.error('解除禁言失败:', error);
            showToast('解除禁言失败', 'error');
        }
    });
}

// ==================== 回收站功能 ====================

async function loadRecycleBin() {
    const deletedPostsList = document.getElementById('deleted-posts-list');
    const deletedCommentsList = document.getElementById('deleted-comments-list');
    
    deletedPostsList.innerHTML = '<div class="loading">加载中...</div>';
    deletedCommentsList.innerHTML = '<div class="loading">加载中...</div>';
    
    try {
        const response = await fetch('/api/forum/recycle-bin', {
            headers: {
                'Authorization': `Bearer ${UserCenter.authToken}`
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            renderDeletedPosts(result.data.posts || []);
            renderDeletedComments(result.data.comments || []);
        } else {
            deletedPostsList.innerHTML = `<div class="empty-state">加载失败</div>`;
            deletedCommentsList.innerHTML = `<div class="empty-state">加载失败</div>`;
        }
    } catch (error) {
        console.error('加载回收站失败:', error);
        deletedPostsList.innerHTML = `<div class="empty-state">加载失败</div>`;
        deletedCommentsList.innerHTML = `<div class="empty-state">加载失败</div>`;
    }
}

function renderDeletedPosts(posts) {
    const deletedPostsList = document.getElementById('deleted-posts-list');
    
    if (!posts || posts.length === 0) {
        deletedPostsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <p>暂无已删除的帖子</p>
            </div>
        `;
        return;
    }
    
    deletedPostsList.innerHTML = posts.map(post => `
        <div class="deleted-item" data-id="${post.id}">
            <div class="deleted-item-info">
                <div class="deleted-item-title">${escapeHtml(post.title)}</div>
                <div class="deleted-item-meta">
                    <span>创建: ${formatTime(post.createdAt)}</span>
                    <span>删除: ${formatTime(post.deletedAt)}</span>
                </div>
            </div>
            <div class="deleted-item-actions">
                <button class="restore-btn" onclick="restorePost(${post.id})">🔄 恢复</button>
            </div>
        </div>
    `).join('');
}

function renderDeletedComments(comments) {
    const deletedCommentsList = document.getElementById('deleted-comments-list');
    
    if (!comments || comments.length === 0) {
        deletedCommentsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <p>暂无已删除的评论</p>
            </div>
        `;
        return;
    }
    
    deletedCommentsList.innerHTML = comments.map(comment => `
        <div class="deleted-item" data-id="${comment.id}">
            <div class="deleted-item-info">
                <div class="deleted-item-content">${escapeHtml(comment.contentPreview || comment.content)}</div>
                <div class="deleted-item-meta">
                    <span>帖子: ${escapeHtml(comment.postTitle || '未知')}</span>
                    <span>创建: ${formatTime(comment.createdAt)}</span>
                    <span>删除: ${formatTime(comment.deletedAt)}</span>
                </div>
            </div>
            <div class="deleted-item-actions">
                <button class="restore-btn" onclick="restoreComment(${comment.id})">🔄 恢复</button>
            </div>
        </div>
    `).join('');
}

async function restorePost(postId) {
    showConfirm('确定要恢复这篇帖子吗？', async (confirmed) => {
        if (!confirmed) return;
        
        try {
            const response = await fetch(`/api/forum/posts/${postId}/restore`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${UserCenter.authToken}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast('帖子已恢复', 'success');
                await loadRecycleBin();
            } else {
                showToast(result.message || '恢复失败', 'error');
            }
        } catch (error) {
            console.error('恢复帖子失败:', error);
            showToast('恢复失败', 'error');
        }
    });
}

async function restoreComment(commentId) {
    showConfirm('确定要恢复这条评论吗？', async (confirmed) => {
        if (!confirmed) return;
        
        try {
            const response = await fetch(`/api/forum/comments/${commentId}/restore`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${UserCenter.authToken}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast('评论已恢复', 'success');
                await loadRecycleBin();
            } else {
                showToast(result.message || '恢复失败', 'error');
            }
        } catch (error) {
            console.error('恢复评论失败:', error);
            showToast('恢复失败', 'error');
        }
    });
}
