/**
 * 帖子详情页面逻辑
 */

let currentPostId = null;
let commentPage = 1;
const commentsPerPage = 10;
let postCache = null; // 缓存帖子数据

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('current-year').textContent = new Date().getFullYear();
    
    const urlParams = new URLSearchParams(window.location.search);
    currentPostId = urlParams.get('id');
    
    if (!currentPostId) {
        document.getElementById('post-content').innerHTML = `
            <div class="error-state">
                <div class="error-icon">❌</div>
                <p>帖子不存在</p>
                <a href="forum.html" class="back-btn">返回社区</a>
            </div>
        `;
        return;
    }
    
    await loadPostDetail();
});

async function loadPostDetail() {
    const postContentEl = document.getElementById('post-content');
    
    try {
        const token = localStorage.getItem('authToken');
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`/api/forum/posts/${currentPostId}`, { headers });
        const result = await response.json();
        
        if (!result.success) {
            postContentEl.innerHTML = `
                <div class="error-state">
                    <div class="error-icon">❌</div>
                    <p>${result.message || '帖子不存在或已被删除'}</p>
                    <a href="forum.html" class="back-btn">返回社区</a>
                </div>
            `;
            return;
        }
        
        // 兼容两种 API 返回格式
        const post = result.post || result.data?.post;
        const comments = result.comments || result.data?.comments || [];
        const commentPagination = result.commentPagination || result.data?.commentPagination || {};
        
        if (!post) {
            postContentEl.innerHTML = `
                <div class="error-state">
                    <div class="error-icon">❌</div>
                    <p>帖子数据格式错误</p>
                    <a href="forum.html" class="back-btn">返回社区</a>
                </div>
            `;
            return;
        }
        
        postCache = { post, comments, commentPagination };
        
        // 更新页面标题
        document.title = `${post.title} - xTest 社区`;
        
        // 渲染标签
        const tagsHtml = post.tags && post.tags.length > 0 
            ? post.tags.map(tag => `<span class="post-tag" style="background-color: ${tag.color}20; color: ${tag.color};">${escapeHtml(tag.name)}</span>`).join('') 
            : '';
        
        const renderedContent = markdownToHtml(post.content || '');
        
        postContentEl.innerHTML = `
            <article class="post-detail-article">
                <h1 class="post-detail-title">${escapeHtml(post.title)}</h1>
                <div class="post-detail-meta">
                    <span class="post-author">
                        <span class="author-avatar">${(post.author?.name || 'U').charAt(0).toUpperCase()}</span>
                        <span class="author-name">@${escapeHtml(post.author?.name || '匿名用户')}</span>
                    </span>
                    <span class="post-time">📅 ${formatTime(post.createdAt)}</span>
                    <span class="post-views">👁 ${post.viewCount || 0} 次浏览</span>
                    <span class="post-likes">❤️ ${post.likeCount || 0} 赞</span>
                    <span class="post-comments">💬 ${post.commentCount || 0} 评论</span>
                </div>
                ${tagsHtml ? `<div class="post-detail-tags">${tagsHtml}</div>` : ''}
                <div class="post-detail-body">
                    ${renderedContent}
                </div>
                <div class="post-detail-actions">
                    <button class="action-btn like-btn ${post.liked ? 'liked' : ''}" onclick="toggleLike()">
                        <span class="action-icon">${post.liked ? '❤️' : '🤍'}</span>
                        <span class="like-text">${post.liked ? '已赞' : '点赞'}</span>
                        <span class="like-count">${post.likeCount || 0}</span>
                    </button>
                </div>
            </article>
        `;
        
        // 显示评论表单（如果已登录）
        if (token) {
            document.getElementById('comment-form').style.display = 'block';
        }
        
        // 渲染评论
        renderComments(comments, commentPagination);
        
    } catch (error) {
        console.error('加载帖子详情失败:', error);
        postContentEl.innerHTML = `
            <div class="error-state">
                <div class="error-icon">❌</div>
                <p>加载失败: ${error.message}</p>
                <a href="forum.html" class="back-btn">返回社区</a>
            </div>
        `;
    }
}

function renderComments(comments, pagination) {
    const commentsListEl = document.getElementById('comments-list');
    
    document.getElementById('comment-count').textContent = `(${pagination.total || 0})`;
    
    if (!comments || comments.length === 0) {
        commentsListEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">💬</div>
                <p>暂无评论，快来抢沙发吧！</p>
            </div>
        `;
        document.getElementById('comments-pagination').innerHTML = '';
        return;
    }
    
    // 获取当前登录用户
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    
    // 判断是否可以删除评论（评论作者或管理员）
    const canDelete = (comment) => {
        if (!currentUser) return false;
        // 评论作者可以删除自己的评论
        if (comment.author && currentUser.id === comment.author.id) return true;
        // 管理员可以删除任何评论
        const role = currentUser.role;
        if (role === 'admin' || role === '管理员' || role === 'Administrator') return true;
        return false;
    };
    
    // 渲染单个评论
    const renderComment = (comment, isReply = false) => {
        const showDeleteBtn = canDelete(comment);
        
        return `
            <div class="comment-item ${isReply ? 'comment-reply' : ''}" data-id="${comment.id}">
                <div class="comment-avatar">${(comment.author?.name || 'U').charAt(0).toUpperCase()}</div>
                <div class="comment-body">
                    <div class="comment-header">
                        <span class="comment-author">@${escapeHtml(comment.author?.name || '匿名用户')}</span>
                        <span class="comment-time">${formatTime(comment.createdAt)}</span>
                        ${showDeleteBtn ? `<button class="comment-delete-btn" onclick="deleteComment(${comment.id})" title="删除评论">🗑️</button>` : ''}
                    </div>
                    <div class="comment-content">${markdownToHtml(comment.content || '')}</div>
                    ${comment.replies && comment.replies.length > 0 ? 
                        `<div class="comment-replies">${comment.replies.map(reply => renderComment(reply, true)).join('')}</div>` : ''}
                </div>
            </div>
        `;
    };
    
    commentsListEl.innerHTML = comments.map(comment => renderComment(comment)).join('');
    
    // 渲染分页
    renderCommentsPagination(pagination);
}

function renderCommentsPagination(pagination) {
    const paginationEl = document.getElementById('comments-pagination');
    
    if (!pagination || pagination.totalPages <= 1) {
        paginationEl.innerHTML = '';
        return;
    }
    
    const { page, totalPages } = pagination;
    
    let html = '';
    html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="goToCommentPage(${page - 1})">上一页</button>`;
    
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
            html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goToCommentPage(${i})">${i}</button>`;
        } else if (i === page - 3 || i === page + 3) {
            html += `<span class="page-ellipsis">...</span>`;
        }
    }
    
    html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="goToCommentPage(${page + 1})">下一页</button>`;
    
    paginationEl.innerHTML = html;
}

function goToCommentPage(page) {
    commentPage = page;
    // 重新加载帖子详情以获取评论
    loadPostDetail();
    document.querySelector('.comments-section').scrollIntoView({ behavior: 'smooth' });
}

async function toggleLike() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        showToast('请先登录', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/forum/posts/${currentPostId}/like`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 更新本地缓存状态
            if (postCache && postCache.post) {
                postCache.post.liked = result.data.liked;
                postCache.post.likeCount = result.data.likeCount;
            }
            
            // 直接更新UI，无需重新加载整个页面
            const likeBtn = document.querySelector('.like-btn');
            const likeCountEl = document.querySelector('.post-likes');
            
            if (likeBtn) {
                const isLiked = result.data.liked;
                likeBtn.className = `action-btn like-btn ${isLiked ? 'liked' : ''}`;
                likeBtn.innerHTML = `
                    <span class="action-icon">${isLiked ? '❤️' : '🤍'}</span>
                    <span class="like-text">${isLiked ? '已赞' : '点赞'}</span>
                    <span class="like-count">${result.data.likeCount || 0}</span>
                `;
            }
            
            // 更新顶部点赞数显示
            if (likeCountEl) {
                likeCountEl.textContent = `❤️ ${result.data.likeCount || 0} 赞`;
            }
        } else {
            showToast(result.message || '操作失败', 'error');
        }
    } catch (error) {
        console.error('点赞失败:', error);
        showToast('操作失败', 'error');
    }
}

async function submitComment() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        showToast('请先登录', 'error');
        return;
    }
    
    const commentInput = document.getElementById('comment-input');
    const content = commentInput.value.trim();
    
    if (!content) {
        showToast('请输入评论内容', 'error');
        return;
    }
    
    if (content.length > 500) {
        showToast('评论内容不能超过500字', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/forum/comments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                postId: currentPostId,
                content 
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            commentInput.value = '';
            document.getElementById('char-count').textContent = '0';
            commentPage = 1;
            await loadPostDetail(); // 重新加载帖子详情
        } else {
            showToast(result.message || '评论失败', 'error');
        }
    } catch (error) {
        console.error('评论失败:', error);
        showToast('评论失败', 'error');
    }
}

async function deleteComment(commentId) {
    const token = localStorage.getItem('authToken');
    if (!token) {
        showToast('请先登录', 'error');
        return;
    }
    
    showConfirm('确定要删除这条评论吗？此操作不可恢复。', async (confirmed) => {
        if (!confirmed) return;
        
        try {
            const response = await fetch(`/api/forum/comments/${commentId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast('评论已删除', 'success');
                // 从 DOM 中移除评论
                const commentEl = document.querySelector(`.comment-item[data-id="${commentId}"]`);
                if (commentEl) {
                    commentEl.remove();
                }
                // 更新评论数
                await loadPostDetail();
            } else {
                showToast(result.message || '删除失败', 'error');
            }
        } catch (error) {
            console.error('删除评论失败:', error);
            showToast('删除失败', 'error');
        }
    });
}

// 字数统计
document.addEventListener('DOMContentLoaded', () => {
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.addEventListener('input', () => {
            const count = commentInput.value.length;
            document.getElementById('char-count').textContent = count;
        });
    }
});

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

function markdownToHtml(text) {
    if (!text) return '';
    
    let processedText = text;
    const codeBlockCount = (text.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
        processedText = text + '\n```';
    }
    
    if (typeof marked !== 'undefined') {
        try {
            const markedInstance = marked || window.marked;
            if (markedInstance && typeof markedInstance.parse === 'function') {
                const html = markedInstance.parse(processedText, {
                    breaks: true,
                    gfm: true,
                    headerIds: false,
                    mangle: false
                });
                
                if (window.NotificationManager) {
                    return window.NotificationManager.parseMentions(html);
                }
                
                return html;
            }
        } catch (e) {
            console.error('Markdown解析失败:', e);
        }
    }
    
    let html = escapeHtml(text);
    
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    html = html.replace(/\n/g, '<br>');
    
    if (window.NotificationManager) {
        html = window.NotificationManager.parseMentions(html);
    }
    
    return html;
}
