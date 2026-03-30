/**
 * 帖子编辑页面逻辑
 * 文件路径: public/js/post-edit.js
 */

const PostEdit = {
    postId: null,
    authToken: localStorage.getItem('authToken'),
    currentUser: JSON.parse(localStorage.getItem('currentUser') || 'null'),
    vditor: null,
    selectedTags: [],
    existingAttachments: [],
    newAttachments: [],
    deletedAttachmentIds: []
};

async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    if (PostEdit.authToken) {
        defaultOptions.headers['Authorization'] = `Bearer ${PostEdit.authToken}`;
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
    
    if (!PostEdit.authToken || !PostEdit.currentUser) {
        window.location.href = 'index.html';
        return;
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    PostEdit.postId = urlParams.get('id');
    
    if (!PostEdit.postId) {
        showToast('帖子ID不存在', 'error');
        setTimeout(() => window.location.href = 'user-center.html', 1500);
        return;
    }
    
    updateUserStatus();
    initVditor();
    await loadPostData();
    await loadTags();
    initForm();
    initAttachmentEvents();
});

function updateUserStatus() {
    const userStatusEl = document.getElementById('user-status');
    
    if (PostEdit.authToken && PostEdit.currentUser) {
        userStatusEl.innerHTML = `
            <span class="user-name">${escapeHtml(PostEdit.currentUser.username)}</span>
            <a href="user-center.html" class="user-center-link">个人中心</a>
        `;
    } else {
        userStatusEl.innerHTML = `<a href="index.html" class="login-link">登录</a>`;
    }
}

function initVditor() {
    PostEdit.vditor = new Vditor('vditor', {
        cdn: '/vditor',
        height: 400,
        placeholder: '请输入帖子内容，支持 Markdown 语法...',
        theme: 'classic',
        counter: {
            enable: true,
            type: 'markdown'
        },
        cache: {
            enable: false
        },
        upload: {
            url: '/api/forum/upload',
            headers: {
                Authorization: `Bearer ${PostEdit.authToken}`
            },
            fieldName: 'file[]',
            format: (files, responseText) => {
                const result = JSON.parse(responseText);
                if (result.success === 1) {
                    return JSON.stringify({
                        msg: '',
                        code: 0,
                        data: {
                            errFiles: [],
                            succMap: {
                                [result.data.name]: result.data.url
                            }
                        }
                    });
                }
                return JSON.stringify({
                    msg: result.msg || '上传失败',
                    code: 1,
                    data: { errFiles: [], succMap: {} }
                });
            },
            success: (editor, msg) => {
                console.log('上传成功:', msg);
            },
            error: (msg) => {
                console.error('上传失败:', msg);
                showToast('图片上传失败', 'error');
            }
        },
        toolbar: [
            'emoji',
            'headings',
            'bold',
            'italic',
            'strike',
            'link',
            '|',
            'list',
            'ordered-list',
            'check',
            'outdent',
            'indent',
            '|',
            'quote',
            'line',
            'code',
            'inline-code',
            '|',
            'upload',
            'table',
            '|',
            'undo',
            'redo',
            '|',
            'edit-mode',
            'preview',
            'fullscreen'
        ],
        hint: {
            at: async (value) => {
                try {
                    const response = await fetch('/api/users');
                    const result = await response.json();
                    if (result.success) {
                        const users = result.data.users || result.data || [];
                        const keyword = value.toLowerCase();
                        const filtered = users.filter(u => {
                            const n1 = (u.username || u.name || '').toLowerCase();
                            const n2 = (u.real_name || '').toLowerCase();
                            return n1.includes(keyword) || n2.includes(keyword);
                        }).slice(0, 10);
                        
                        return filtered.map(u => {
                            const displayName = u.username || u.name;
                            const realName = u.real_name ? `(${u.real_name})` : '';
                            return {
                                value: displayName,
                                html: `<div style="display:flex;align-items:center;gap:6px;">
                                    <div style="width:20px;height:20px;border-radius:50%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:10px;">${displayName.charAt(0).toUpperCase()}</div>
                                    <span>${escapeHtml(displayName)} <small style="color:#666">${escapeHtml(realName)}</small></span>
                                </div>`
                            };
                        });
                    }
                } catch (e) {
                    console.error('获取@用户列表失败:', e);
                }
                return [];
            }
        }
    });
}

async function loadPostData() {
    try {
        const result = await apiRequest(`/posts/${PostEdit.postId}`);
        
        if (!result.success) {
            showToast(result.message || '加载帖子失败', 'error');
            setTimeout(() => window.location.href = 'user-center.html', 1500);
            return;
        }
        
        const post = result.data.post;
        
        if (post.author.id !== PostEdit.currentUser.id) {
            const isAdmin = PostEdit.currentUser.role === '管理员' || 
                           PostEdit.currentUser.role === 'admin';
            if (!isAdmin) {
                showToast('您没有权限编辑此帖子', 'error');
                setTimeout(() => window.location.href = 'user-center.html', 1500);
                return;
            }
        }
        
        document.getElementById('post-id').value = post.id;
        document.getElementById('post-title').value = post.title;
        document.getElementById('title-count').textContent = post.title.length;
        
        const anonymousCheckbox = document.getElementById('anonymous-checkbox');
        if (anonymousCheckbox && post.isAnonymous !== undefined) {
            anonymousCheckbox.checked = post.isAnonymous;
        }
        
        PostEdit.selectedTags = post.tags ? post.tags.map(t => t.id) : [];
        
        if (post.attachments) {
            PostEdit.existingAttachments = post.attachments;
            renderExistingAttachments();
        }
        
        setTimeout(() => {
            if (PostEdit.vditor) {
                PostEdit.vditor.setValue(post.content);
            }
        }, 100);
        
    } catch (error) {
        console.error('加载帖子失败:', error);
        showToast('加载帖子失败', 'error');
    }
}

async function loadTags() {
    const tagSelector = document.getElementById('tag-selector');
    tagSelector.innerHTML = '<div class="loading">加载标签...</div>';
    
    try {
        const result = await apiRequest('/tags');
        
        if (result.success && result.data) {
            renderTags(result.data);
        }
    } catch (error) {
        console.error('加载标签失败:', error);
        tagSelector.innerHTML = '<p class="error">加载失败</p>';
    }
}

function renderTags(tags) {
    const tagSelector = document.getElementById('tag-selector');
    
    if (!tags || tags.length === 0) {
        tagSelector.innerHTML = '<p class="hint">暂无可用标签</p>';
        return;
    }
    
    const filteredTags = tags.filter(t => t.id !== 0);
    
    tagSelector.innerHTML = filteredTags.map(tag => {
        const isSelected = PostEdit.selectedTags.includes(tag.id);
        return `
            <div class="tag-option ${isSelected ? 'selected' : ''}" data-id="${tag.id}" onclick="toggleTag(${tag.id})">
                <span class="tag-color" style="background-color: ${tag.color}"></span>
                ${escapeHtml(tag.name)}
            </div>
        `;
    }).join('');
}

function toggleTag(tagId) {
    const tagEl = document.querySelector(`#tag-selector .tag-option[data-id="${tagId}"]`);
    const index = PostEdit.selectedTags.indexOf(tagId);
    
    if (index > -1) {
        PostEdit.selectedTags.splice(index, 1);
        tagEl.classList.remove('selected');
    } else {
        PostEdit.selectedTags.push(tagId);
        tagEl.classList.add('selected');
    }
}

function initForm() {
    const titleInput = document.getElementById('post-title');
    const titleCount = document.getElementById('title-count');
    
    titleInput.addEventListener('input', () => {
        titleCount.textContent = titleInput.value.length;
    });
    
    const form = document.getElementById('post-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitPost();
    });
}

async function submitPost() {
    const postId = document.getElementById('post-id').value;
    const title = document.getElementById('post-title').value.trim();
    const content = PostEdit.vditor.getValue();
    const isAnonymousCheckbox = document.getElementById('anonymous-checkbox');
    const isAnonymous = isAnonymousCheckbox ? isAnonymousCheckbox.checked : false;
    
    if (!title) {
        showToast('请输入标题', 'error');
        return;
    }
    
    if (!content) {
        showToast('请输入内容', 'error');
        return;
    }
    
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = '保存中...';
    
    try {
        const result = await apiRequest(`/posts/${postId}`, {
            method: 'PUT',
            body: JSON.stringify({
                title,
                content,
                tags: PostEdit.selectedTags,
                newAttachmentIds: PostEdit.newAttachments.map(a => a.id),
                deletedAttachmentIds: PostEdit.deletedAttachmentIds,
                isAnonymous
            })
        });
        
        if (result.success) {
            showToast('帖子更新成功', 'success');
            setTimeout(() => {
                window.location.href = 'post-detail.html?id=' + postId;
            }, 1000);
        } else {
            showToast(result.message || '更新失败', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '保存修改';
        }
    } catch (error) {
        console.error('更新帖子失败:', error);
        showToast('更新失败', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = '保存修改';
    }
}

function cancelEdit() {
    window.location.href = 'user-center.html';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function initAttachmentEvents() {
    const attachmentInput = document.getElementById('attachment-input');
    
    attachmentInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length === 0) return;
        
        await uploadAttachments(files);
        attachmentInput.value = '';
    });
}

async function uploadAttachments(files) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('files', file);
    }
    
    showToast('正在上传附件...', 'info');
    
    try {
        const response = await fetch('/api/forum/attachments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PostEdit.authToken}`
            },
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            PostEdit.newAttachments = PostEdit.newAttachments.concat(result.data);
            renderNewAttachments();
            showToast(`成功上传 ${result.data.length} 个文件`, 'success');
        } else {
            showToast(result.message || '上传失败', 'error');
        }
    } catch (error) {
        console.error('上传附件失败:', error);
        showToast('上传失败，请重试', 'error');
    }
}

function renderExistingAttachments() {
    const listEl = document.getElementById('attachment-list');
    
    let html = '';
    
    if (PostEdit.existingAttachments.length > 0) {
        html += '<div class="attachment-section"><h4>已有附件</h4>';
        PostEdit.existingAttachments.forEach(att => {
            html += `
                <div class="edit-attachment-item">
                    <span class="attachment-icon">${getFileIcon(att.file_type)}</span>
                    <span class="attachment-name">${escapeHtml(att.file_name)}</span>
                    <span class="attachment-size">${formatFileSize(att.file_size)}</span>
                    <div class="attachment-actions">
                        <a href="/api/forum/attachments/download/${att.id}" class="action-link" target="_blank">下载</a>
                        <button type="button" class="action-btn delete" onclick="deleteExistingAttachment(${att.id})">删除</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }
    
    if (PostEdit.newAttachments.length > 0) {
        html += '<div class="attachment-section"><h4>新上传</h4>';
        PostEdit.newAttachments.forEach((att, index) => {
            html += `
                <div class="edit-attachment-item new">
                    <span class="attachment-icon">${getFileIcon(att.type)}</span>
                    <span class="attachment-name">${escapeHtml(att.name)}</span>
                    <span class="attachment-size">${formatFileSize(att.size)}</span>
                    <button type="button" class="action-btn delete" onclick="removeNewAttachment(${index})">移除</button>
                </div>
            `;
        });
        html += '</div>';
    }
    
    listEl.innerHTML = html;
}

function renderNewAttachments() {
    renderExistingAttachments();
}

function deleteExistingAttachment(attId) {
    PostEdit.deletedAttachmentIds.push(attId);
    PostEdit.existingAttachments = PostEdit.existingAttachments.filter(a => a.id !== attId);
    renderExistingAttachments();
}

function removeNewAttachment(index) {
    PostEdit.newAttachments.splice(index, 1);
    renderExistingAttachments();
}

function getFileIcon(type) {
    const icons = {
        'image': '🖼️',
        'document': '📄',
        'code': '💻',
        'other': '📎'
    };
    return icons[type] || '📎';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
