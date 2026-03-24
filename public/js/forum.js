/**
 * 论坛模块主逻辑
 * 文件路径: public/js/forum.js
 */

const Forum = {
    currentPage: 1,
    pageSize: 20,
    currentTag: '',
    keyword: '',
    sortBy: 'time',
    authToken: localStorage.getItem('authToken'),
    currentUser: JSON.parse(localStorage.getItem('currentUser') || 'null')
};

async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    if (Forum.authToken) {
        defaultOptions.headers['Authorization'] = `Bearer ${Forum.authToken}`;
    }
    
    const response = await fetch(`/api/forum${url}`, {
        ...defaultOptions,
        ...options,
        headers: { ...defaultOptions.headers, ...options.headers }
    });
    
    return await response.json();
}

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    Forum.currentTag = urlParams.get('tag') || '';
    Forum.keyword = urlParams.get('keyword') || '';
    
    if (Forum.keyword) {
        document.getElementById('search-input').value = Forum.keyword;
    }
    
    document.getElementById('current-year').textContent = new Date().getFullYear();
    
    updateUserStatus();
    
    await Promise.all([
        loadTags(),
        loadPosts()
    ]);
    
    bindTagEvents();
    bindPostListEvents();
    bindSortEvents();
});

function updateUserStatus() {
    const userStatusEl = document.getElementById('user-status');
    const createBtn = document.getElementById('create-btn');
    
    if (!userStatusEl) return;
    
    if (Forum.authToken && Forum.currentUser) {
        userStatusEl.innerHTML = `
            <span class="user-name">${escapeHtml(Forum.currentUser.username)}</span>
            <a href="user-center.html" class="user-center-link">个人中心</a>
        `;
        if (createBtn) createBtn.style.display = 'inline-block';
    } else {
        userStatusEl.innerHTML = `
            <a href="/" class="login-link">登录</a>
        `;
        if (createBtn) createBtn.style.display = 'none';
    }
}

async function loadTags() {
    try {
        const result = await apiRequest('/tags');
        
        if (result.success && result.data) {
            renderTags(result.data);
        }
    } catch (error) {
        console.error('加载标签失败:', error);
    }
}

function renderTags(tags) {
    const tagListEl = document.getElementById('tag-list');
    
    if (!tagListEl) return;
    
    if (!tags || tags.length === 0) {
        tagListEl.innerHTML = '';
        return;
    }
    
    const filteredTags = tags.filter(tag => tag.name !== '全部');
    const isAdmin = Forum.currentUser && (Forum.currentUser.role === 'admin' || Forum.currentUser.role === '管理员');
    
    tagListEl.innerHTML = filteredTags.map(tag => `
        <a href="javascript:void(0)" 
           class="tag-item ${Forum.currentTag == tag.id ? 'active' : ''}" 
           data-tag="${tag.id}"
           style="background-color: ${tag.color}20; color: ${tag.color};">
            ${escapeHtml(tag.name)}
            <span class="tag-count">${tag.post_count || 0}</span>
            ${isAdmin ? `<button class="tag-delete-btn" onclick="event.stopPropagation(); deleteTag(${tag.id}, '${escapeHtml(tag.name)}')" title="删除标签">×</button>` : ''}
        </a>
    `).join('');
}

async function deleteTag(tagId, tagName) {
    const confirmed = await showConfirmDialog(`确定要删除标签"${tagName}"吗？\n\n删除后，使用该标签的帖子将不再关联此标签。`);
    if (!confirmed) {
        return;
    }
    
    try {
        const response = await fetch(`/api/forum/tags/${tagId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${Forum.authToken}`
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('标签已删除', 'success');
            await loadTags();
            if (Forum.currentTag == tagId) {
                Forum.currentTag = '';
                loadPosts();
            }
        } else {
            showToast(result.message || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除标签失败:', error);
        showToast('删除失败', 'error');
    }
}

let confirmCallback = null;

function showConfirmDialog(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const messageEl = document.getElementById('confirm-message');
        
        messageEl.textContent = message;
        modal.style.display = 'flex';
        
        confirmCallback = resolve;
    });
}

function closeConfirmModal(confirmed) {
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'none';
    
    if (confirmCallback) {
        confirmCallback(confirmed);
        confirmCallback = null;
    }
}

function bindTagEvents() {
    document.querySelectorAll('.tag-item').forEach(el => {
        el.addEventListener('click', (e) => {
            const tagId = e.currentTarget.dataset.tag;
            
            document.querySelectorAll('.tag-item').forEach(item => item.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            Forum.currentTag = tagId;
            Forum.currentPage = 1;
            loadPosts();
        });
    });
}

function bindSortEvents() {
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            Forum.sortBy = e.target.value;
            Forum.currentPage = 1;
            loadPosts();
        });
    }
}

async function loadPosts() {
    const postListEl = document.getElementById('post-list');
    if (!postListEl) return;
    
    postListEl.innerHTML = '<div class="loading">加载中...</div>';
    
    try {
        let url = `/posts?page=${Forum.currentPage}&pageSize=${Forum.pageSize}&sortBy=${Forum.sortBy}`;
        
        if (Forum.currentTag) {
            url += `&tag=${Forum.currentTag}`;
        }
        if (Forum.keyword) {
            url += `&keyword=${encodeURIComponent(Forum.keyword)}`;
        }
        
        const headers = {};
        if (Forum.authToken) {
            headers['Authorization'] = `Bearer ${Forum.authToken}`;
        }
        
        const response = await fetch(`/api/forum${url}`, { headers });
        const result = await response.json();
        
        if (result.success && result.data) {
            renderPosts(result.data.posts, result.data.pagination);
        } else {
            postListEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <p>暂无帖子</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('加载帖子失败:', error);
        postListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <p>加载失败，请刷新重试</p>
            </div>
        `;
    }
}

function renderPosts(posts, pagination) {
    const postListEl = document.getElementById('post-list');
    
    if (!posts || posts.length === 0) {
        postListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>暂无帖子，快来发布第一篇吧！</p>
            </div>
        `;
        return;
    }
    
    const isAdmin = Forum.currentUser && 
        (Forum.currentUser.role === 'admin' || Forum.currentUser.role === '管理员');
    const isLoggedIn = !!Forum.authToken;
    
    postListEl.innerHTML = posts.map(post => {
        const adminMenu = isAdmin ? `
            <div class="admin-dropdown" data-post-id="${post.id}">
                <button class="admin-dropdown-toggle" type="button">管理 ▾</button>
                <div class="admin-dropdown-menu">
                    <button class="admin-dropdown-item" data-action="pin" data-post-id="${post.id}" data-pinned="${post.isPinned ? 'true' : 'false'}">
                        ${post.isPinned ? '📌 取消置顶' : '📌 置顶帖子'}
                    </button>
                    <button class="admin-dropdown-item danger" data-action="delete" data-post-id="${post.id}">
                        🗑️ 删除帖子
                    </button>
                    <div class="admin-dropdown-divider"></div>
                    <button class="admin-dropdown-item" data-action="mute" data-post-id="${post.id}" data-author-id="${post.author.id}" data-author-name="${escapeHtml(post.author.name)}">
                        🚫 禁言作者
                    </button>
                </div>
            </div>
        ` : '';
        
        return `
            <article class="post-item" data-post-id="${post.id}">
                <h3 class="post-title">
                    ${post.isPinned ? '<span class="pinned-badge">置顶</span>' : ''}
                    <a href="post-detail.html?id=${post.id}">${escapeHtml(post.title)}</a>
                </h3>
                <p class="post-summary">${window.NotificationManager ? window.NotificationManager.parseMentions(escapeHtml(post.summary)) : escapeHtml(post.summary)}...</p>
                <div class="post-meta">
                    <span class="post-author">@${escapeHtml(post.author.name)}</span>
                    <span class="post-time">${formatTime(post.createdAt)}</span>
                    <span class="post-views">👁 ${post.viewCount}</span>
                    <span class="post-comments">💬 ${post.commentCount}</span>
                    <button class="like-btn ${post.liked ? 'liked' : ''}" 
                            data-action="like" 
                            data-post-id="${post.id}"
                            ${!isLoggedIn ? 'disabled title="请先登录"' : ''}>
                        <span class="like-icon">${post.liked ? '❤️' : '🤍'}</span>
                        <span class="like-count">${post.likeCount || 0}</span>
                    </button>
                    ${adminMenu}
                </div>
            </article>
        `;
    }).join('');
    
    renderPagination(pagination);
}

function renderPagination(pagination) {
    const paginationEl = document.getElementById('pagination');
    
    if (!paginationEl) return;
    
    if (!pagination || pagination.totalPages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }
    
    const { page, totalPages } = pagination;
    
    let html = '';
    
    html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">上一页</button>`;
    
    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(totalPages, page + 2);
    
    if (startPage > 1) {
        html += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
        if (startPage > 2) {
            html += `<span class="page-ellipsis">...</span>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span class="page-ellipsis">...</span>`;
        }
        html += `<button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }
    
    html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">下一页</button>`;
    
    paginationEl.innerHTML = html;
}

function goToPage(page) {
    Forum.currentPage = page;
    loadPosts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleSearch(event) {
    event.preventDefault();
    
    const keyword = document.getElementById('search-input').value.trim();
    Forum.keyword = keyword;
    Forum.currentPage = 1;
    
    const url = new URL(window.location);
    if (keyword) {
        url.searchParams.set('keyword', keyword);
    } else {
        url.searchParams.delete('keyword');
    }
    window.history.pushState({}, '', url);
    
    loadPosts();
}

// ==================== 事件委托 ====================

function bindPostListEvents() {
    const postListEl = document.getElementById('post-list');
    if (!postListEl) return;
    
    postListEl.addEventListener('click', async (e) => {
        const target = e.target;
        
        const likeBtn = target.closest('[data-action="like"]');
        if (likeBtn) {
            e.preventDefault();
            e.stopPropagation();
            await handleLike(likeBtn);
            return;
        }
        
        const dropdownToggle = target.closest('.admin-dropdown-toggle');
        if (dropdownToggle) {
            e.preventDefault();
            e.stopPropagation();
            toggleDropdown(dropdownToggle);
            return;
        }
        
        const actionBtn = target.closest('[data-action]');
        if (actionBtn && actionBtn.dataset.action !== 'like') {
            e.preventDefault();
            e.stopPropagation();
            await handleAdminAction(actionBtn);
            return;
        }
    });
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.admin-dropdown')) {
            document.querySelectorAll('.admin-dropdown.open').forEach(dropdown => {
                dropdown.classList.remove('open');
            });
        }
    });
}

function toggleDropdown(toggleBtn) {
    const dropdown = toggleBtn.closest('.admin-dropdown');
    const isOpen = dropdown.classList.contains('open');
    
    document.querySelectorAll('.admin-dropdown.open').forEach(d => {
        d.classList.remove('open');
    });
    
    if (!isOpen) {
        dropdown.classList.add('open');
    }
}

async function handleLike(btn) {
    if (!Forum.authToken) {
        showToast('请先登录', 'error');
        return;
    }
    
    const postId = btn.dataset.postId;
    const isLiked = btn.classList.contains('liked');
    
    const countEl = btn.querySelector('.like-count');
    const iconEl = btn.querySelector('.like-icon');
    const currentCount = parseInt(countEl.textContent) || 0;
    
    if (isLiked) {
        btn.classList.remove('liked');
        iconEl.textContent = '🤍';
        countEl.textContent = Math.max(0, currentCount - 1);
    } else {
        btn.classList.add('liked');
        iconEl.textContent = '❤️';
        countEl.textContent = currentCount + 1;
    }
    
    try {
        const response = await fetch(`/api/forum/posts/${postId}/like`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Forum.authToken}`
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            countEl.textContent = result.data.likeCount;
            if (result.data.liked) {
                btn.classList.add('liked');
                iconEl.textContent = '❤️';
            } else {
                btn.classList.remove('liked');
                iconEl.textContent = '🤍';
            }
            showToast(result.message, 'success');
        } else {
            btn.classList.toggle('liked', isLiked);
            iconEl.textContent = isLiked ? '❤️' : '🤍';
            countEl.textContent = currentCount;
            showToast(result.message || '操作失败', 'error');
        }
    } catch (error) {
        btn.classList.toggle('liked', isLiked);
        iconEl.textContent = isLiked ? '❤️' : '🤍';
        countEl.textContent = currentCount;
        showToast('网络错误，请重试', 'error');
    }
}

async function handleAdminAction(btn) {
    const action = btn.dataset.action;
    const postId = btn.dataset.postId;
    
    switch (action) {
        case 'pin':
            await handlePin(btn, postId);
            break;
        case 'delete':
            await handleDelete(postId);
            break;
        case 'mute':
            showMuteModal(btn.dataset.authorId, btn.dataset.authorName);
            break;
    }
    
    const dropdown = btn.closest('.admin-dropdown');
    if (dropdown) {
        dropdown.classList.remove('open');
    }
}

async function handlePin(btn, postId) {
    const isPinned = btn.dataset.pinned === 'true';
    const newPinned = !isPinned;
    
    try {
        const response = await fetch(`/api/forum/posts/${postId}/pin`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Forum.authToken}`
            },
            body: JSON.stringify({ pinned: newPinned })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            loadPosts();
        } else {
            showToast(result.message || '操作失败', 'error');
        }
    } catch (error) {
        showToast('网络错误，请重试', 'error');
    }
}

async function handleDelete(postId) {
    const confirmed = await showConfirmDialog('确定要删除这篇帖子吗？\n\n此操作不可撤销。');
    if (!confirmed) {
        return;
    }
    
    try {
        const response = await fetch(`/api/forum/posts/${postId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${Forum.authToken}`
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            loadPosts();
        } else {
            showToast(result.message || '删除失败', 'error');
        }
    } catch (error) {
        showToast('网络错误，请重试', 'error');
    }
}

function showMuteModal(authorId, authorName) {
    const existing = document.querySelector('.mute-modal-overlay');
    if (existing) existing.remove();
    
    const modalHtml = `
        <div class="mute-modal-overlay" id="mute-modal">
            <div class="mute-modal">
                <h3>禁言用户：${escapeHtml(authorName)}</h3>
                <label for="mute-days">禁言天数（1-365）：</label>
                <input type="number" id="mute-days" min="1" max="365" value="7" placeholder="输入天数">
                <div class="mute-modal-actions">
                    <button class="cancel-btn" onclick="closeMuteModal()">取消</button>
                    <button class="confirm-btn" onclick="submitMute('${authorId}')">确认禁言</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    requestAnimationFrame(() => {
        document.getElementById('mute-modal').classList.add('show');
    });
}

function closeMuteModal() {
    const modal = document.getElementById('mute-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 200);
    }
}

async function submitMute(authorId) {
    const daysInput = document.getElementById('mute-days');
    const days = parseInt(daysInput.value);
    
    if (!days || days < 1 || days > 365) {
        showToast('请输入有效的天数（1-365）', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/forum/users/${authorId}/mute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Forum.authToken}`
            },
            body: JSON.stringify({ days })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            closeMuteModal();
        } else {
            showToast(result.message || '操作失败', 'error');
        }
    } catch (error) {
        showToast('网络错误，请重试', 'error');
    }
}

function showToast(message, type = 'info') {
    const existing = document.querySelector('.forum-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `forum-toast forum-toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
