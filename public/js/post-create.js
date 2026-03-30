/**
 * 发帖页面逻辑
 * 文件路径: public/js/post-create.js
 */

const PostCreate = {
    authToken: localStorage.getItem('authToken'),
    currentUser: JSON.parse(localStorage.getItem('currentUser') || 'null'),
    vditor: null,
    selectedTags: [],
    attachments: [],
    isSubmitting: false,
    draftTimer: null,
    lastDraftSave: null
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('current-year').textContent = new Date().getFullYear();
    
    if (!PostCreate.authToken || !PostCreate.currentUser) {
        showLoginRequired();
        return;
    }
    
    updateUserStatus();
    loadTags();
    initVditor();
    bindFormEvents();
    bindAttachmentEvents();
    loadDraft();
});

function updateUserStatus() {
    const userStatusEl = document.getElementById('user-status');
    
    if (PostCreate.authToken && PostCreate.currentUser) {
        userStatusEl.innerHTML = `
            <span class="user-name">${escapeHtml(PostCreate.currentUser.username)}</span>
            <a href="user-center.html" class="user-center-link">个人中心</a>
        `;
    } else {
        userStatusEl.innerHTML = `<a href="/" class="login-link">登录</a>`;
    }
}

function showLoginRequired() {
    const container = document.querySelector('.create-container');
    container.innerHTML = `
        <div class="login-required">
            <div class="login-required-icon">🔒</div>
            <h2 class="login-required-title">请先登录</h2>
            <p class="login-required-desc">登录后才能发布帖子</p>
            <a href="/" class="login-btn">前往登录</a>
        </div>
    `;
}

async function loadTags() {
    try {
        const response = await fetch('/api/forum/tags');
        const result = await response.json();
        
        if (result.success && result.data) {
            renderTags(result.data);
        }
    } catch (error) {
        console.error('加载标签失败:', error);
    }
}

function renderTags(tags) {
    const selectorEl = document.getElementById('tag-selector');
    
    if (!tags || tags.length === 0) {
        selectorEl.innerHTML = '<p class="form-hint">暂无可用标签</p>';
        return;
    }
    
    const filteredTags = tags.filter(tag => tag.name !== '全部');
    
    let html = filteredTags.map(tag => `
        <div class="tag-option" data-id="${tag.id}" onclick="toggleTag(${tag.id}, '${escapeHtml(tag.name)}', '${tag.color}')">
            <span class="tag-color" style="background-color: ${tag.color}"></span>
            ${escapeHtml(tag.name)}
        </div>
    `).join('');
    
    html += `
        <div class="custom-tag-input">
            <input type="text" id="custom-tag-input" placeholder="自定义标签..." maxlength="10">
            <button type="button" class="custom-tag-add-btn" onclick="addCustomTag()">+</button>
        </div>
    `;
    
    selectorEl.innerHTML = html;
    
    const customInput = document.getElementById('custom-tag-input');
    customInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomTag();
        }
    });
}

function addCustomTag() {
    const input = document.getElementById('custom-tag-input');
    const tagName = input.value.trim();
    
    if (!tagName) {
        return;
    }
    
    if (tagName.length > 10) {
        showToast('标签名称不能超过10个字符', 'error');
        return;
    }
    
    const existingTag = PostCreate.selectedTags.find(t => t.name === tagName);
    if (existingTag) {
        showToast('该标签已选中', 'error');
        input.value = '';
        return;
    }
    
    const tempId = 'custom_' + Date.now();
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    
    PostCreate.selectedTags.push({ 
        id: tempId, 
        name: tagName, 
        color: randomColor, 
        isCustom: true 
    });
    
    const selectorEl = document.getElementById('tag-selector');
    const customInputContainer = selectorEl.querySelector('.custom-tag-input');
    
    const newTagEl = document.createElement('div');
    newTagEl.className = 'tag-option selected custom-tag';
    newTagEl.dataset.id = tempId;
    newTagEl.dataset.custom = 'true';
    newTagEl.innerHTML = `
        <span class="tag-color" style="background-color: ${randomColor}"></span>
        ${escapeHtml(tagName)}
        <span class="tag-remove" onclick="event.stopPropagation(); removeCustomTag('${tempId}')">×</span>
    `;
    newTagEl.onclick = () => removeCustomTag(tempId);
    
    selectorEl.insertBefore(newTagEl, customInputContainer);
    
    input.value = '';
    showToast('自定义标签已添加', 'success');
}

function removeCustomTag(tempId) {
    const index = PostCreate.selectedTags.findIndex(t => t.id === tempId);
    if (index > -1) {
        PostCreate.selectedTags.splice(index, 1);
    }
    
    const tagEl = document.querySelector(`.tag-option[data-id="${tempId}"]`);
    if (tagEl) {
        tagEl.remove();
    }
}

function toggleTag(id, name, color) {
    const tagEl = document.querySelector(`.tag-option[data-id="${id}"]`);
    const index = PostCreate.selectedTags.findIndex(t => t.id === id);
    
    if (index > -1) {
        PostCreate.selectedTags.splice(index, 1);
        tagEl.classList.remove('selected');
    } else {
        PostCreate.selectedTags.push({ id, name, color });
        tagEl.classList.add('selected');
    }
}

function initVditor() {
    PostCreate.vditor = new Vditor('vditor', {
        cdn: '/vditor',
        height: 400,
        placeholder: '请输入帖子内容，支持 Markdown 语法...',
        theme: 'classic',
        counter: { enable: true },
        cache: { enable: false },
        upload: {
            url: '/api/forum/upload',
            accept: 'image/*',
            headers: () => ({
                'Authorization': `Bearer ${PostCreate.authToken}`
            }),
            handler: (files) => {
                return files.map(file => ({
                    success: 1,
                    data: { url: file.url || file.data?.url, alt: file.name }
                }));
            },
            format: (files, responseText) => {
                try {
                    const result = JSON.parse(responseText);
                    if (result.success === 1 && result.data) {
                        return result.data.url;
                    }
                    return null;
                } catch (e) {
                    console.error('解析上传响应失败:', e);
                    return null;
                }
            },
            success: (editor, msg) => console.log('图片上传成功:', msg),
            error: (msg) => {
                console.error('图片上传失败:', msg);
                showToast('图片上传失败，请重试', 'error');
            }
        },
        toolbar: [
            'emoji', 'headings', 'bold', 'italic', 'strike', '|',
            'line', 'quote', 'list', 'ordered-list', 'check', 'table', 'code', 'inline-code',
            'insert-before', 'insert-after', '|',
            'undo', 'redo', '|',
            'fullscreen', 'edit-mode',
            { name: 'preview', tip: '预览', icon: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>', click: () => PostCreate.vditor.preview() }
        ],
        preview: { url: '/api/forum/preview', parse: (markdown) => markdown },
        input: (value) => {
            clearTimeout(PostCreate.draftTimer);
            PostCreate.draftTimer = setTimeout(saveDraft, 3000);
        },
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

function bindFormEvents() {
    const form = document.getElementById('post-form');
    const titleInput = document.getElementById('post-title');
    const titleCount = document.getElementById('title-count');
    
    titleInput.addEventListener('input', () => {
        titleCount.textContent = titleInput.value.length;
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitPost();
    });
}

function bindAttachmentEvents() {
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
                'Authorization': `Bearer ${PostCreate.authToken}`
            },
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            PostCreate.attachments = PostCreate.attachments.concat(result.data);
            renderAttachmentList();
            showToast(`成功上传 ${result.data.length} 个文件`, 'success');
        } else {
            showToast(result.message || '上传失败', 'error');
        }
    } catch (error) {
        console.error('上传附件失败:', error);
        showToast('上传失败，请重试', 'error');
    }
}

function renderAttachmentList() {
    const listEl = document.getElementById('attachment-list');
    
    if (PostCreate.attachments.length === 0) {
        listEl.innerHTML = '';
        return;
    }
    
    listEl.innerHTML = PostCreate.attachments.map((att, index) => `
        <div class="attachment-item">
            <div class="attachment-icon">${getFileIcon(att.type)}</div>
            <div class="attachment-info">
                <span class="attachment-name">${escapeHtml(att.name)}</span>
                <span class="attachment-size">${formatFileSize(att.size)}</span>
            </div>
            <button type="button" class="attachment-remove" onclick="removeAttachment(${index})">✕</button>
        </div>
    `).join('');
}

function removeAttachment(index) {
    PostCreate.attachments.splice(index, 1);
    renderAttachmentList();
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

async function submitPost() {
    if (PostCreate.isSubmitting) return;
    
    const title = document.getElementById('post-title').value.trim();
    const content = PostCreate.vditor.getValue();
    
    if (!title) {
        showToast('请输入帖子标题', 'error');
        return;
    }
    
    if (title.length > 200) {
        showToast('标题不能超过200个字符', 'error');
        return;
    }
    
    if (!content || !content.trim()) {
        showToast('请输入帖子内容', 'error');
        return;
    }
    
    PostCreate.isSubmitting = true;
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = '发布中...';
    
    try {
        const isAnonymous = document.getElementById('anonymous-checkbox').checked;
        
        const response = await fetch('/api/forum/posts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${PostCreate.authToken}`
            },
            body: JSON.stringify({
                title: title,
                content: content,
                tags: PostCreate.selectedTags.map(t => t.name),
                attachments: PostCreate.attachments.map(a => a.id),
                isAnonymous: isAnonymous
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            localStorage.removeItem('forum-post-draft');
            showToast('帖子发布成功', 'success');
            setTimeout(() => {
                window.location.href = `post-detail.html?id=${result.data.id}`;
            }, 1000);
        } else {
            showToast(result.message || '发布失败', 'error');
            PostCreate.isSubmitting = false;
            submitBtn.disabled = false;
            submitBtn.textContent = '发布帖子';
        }
    } catch (error) {
        console.error('发布帖子失败:', error);
        showToast('发布失败，请重试', 'error');
        PostCreate.isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = '发布帖子';
    }
}

function saveDraft(showToast = false) {
    const title = document.getElementById('post-title').value.trim();
    const content = PostCreate.vditor ? PostCreate.vditor.getValue() : '';
    
    localStorage.setItem('forum-post-draft', JSON.stringify({
        title, content, tags: PostCreate.selectedTags, attachments: PostCreate.attachments, savedAt: new Date().toISOString()
    }));
    
    PostCreate.lastDraftSave = new Date();
    
    if (showToast) {
        showToast('草稿已保存', 'success');
    }
}

function loadDraft() {
    const draftStr = localStorage.getItem('forum-post-draft');
    if (!draftStr) return;
    
    try {
        const draft = JSON.parse(draftStr);
        const savedTime = new Date(draft.savedAt).toLocaleString('zh-CN');
        
        showConfirm(`发现保存的草稿（保存于 ${savedTime}），是否加载？`, (confirmed) => {
            if (confirmed) {
                if (draft.title) {
                    document.getElementById('post-title').value = draft.title;
                    document.getElementById('title-count').textContent = draft.title.length;
                }
                if (draft.content && PostCreate.vditor) {
                    PostCreate.vditor.setValue(draft.content);
                }
                if (draft.tags && draft.tags.length > 0) {
                    draft.tags.forEach(tag => {
                        const tagEl = document.querySelector(`.tag-option[data-id="${tag.id}"]`);
                        if (tagEl) {
                            tagEl.classList.add('selected');
                            PostCreate.selectedTags.push(tag);
                        }
                    });
                }
                if (draft.attachments && draft.attachments.length > 0) {
                    PostCreate.attachments = draft.attachments;
                    renderAttachmentList();
                }
            } else {
                localStorage.removeItem('forum-post-draft');
            }
        });
    } catch (e) {
        console.error('加载草稿失败:', e);
        localStorage.removeItem('forum-post-draft');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
