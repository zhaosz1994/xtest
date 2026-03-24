/**
 * 通知系统前端逻辑
 * 文件路径: public/js/notification.js
 */

const NotificationManager = {
    initialized: false,
    unreadCount: 0,
    pollingInterval: null,
    token: null,
    validUsernames: null, // 缓存有效用户名列表
    
    init() {
        if (this.initialized) return;
        
        // 统一使用 authToken 键名
        this.token = localStorage.getItem('authToken');
        
        console.log('[通知系统] Token:', this.token ? '已获取' : '未找到');
        
        if (!this.token) return;
        
        this.createDropdownStructure();
        this.bindEvents();
        this.fetchUnreadCount();
        this.loadValidUsernames(); // 加载有效用户名列表，用于@提及验证
        
        this.pollingInterval = setInterval(() => this.fetchUnreadCount(), 30000);
        
        this.initialized = true;
    },
    
    createDropdownStructure() {
        const container = document.querySelector('.notification-dropdown-container');
        if (!container) return;
        
        // 检查是否已有下拉菜单
        if (container.querySelector('.notification-dropdown')) return;
        
        // 创建下拉菜单结构
        const dropdown = document.createElement('div');
        dropdown.className = 'notification-dropdown';
        dropdown.innerHTML = `
            <div class="notification-header">
                <h4>通知 <span id="notification-count-title">(0)</span></h4>
                <button class="mark-all-read-btn" id="mark-all-read-btn">全部已读</button>
            </div>
            <div class="notification-list" id="notification-list">
                <div style="padding: 20px; text-align: center; color: #999; font-size: 13px;">加载中...</div>
            </div>
            <div class="notification-footer">
                <button class="view-all-notifications-btn" id="view-all-notifications-btn">进入消息中心</button>
            </div>
        `;
        container.appendChild(dropdown);
    },
    
    bindEvents() {
        const bellBtn = document.getElementById('notification-bell-btn');
        const container = document.querySelector('.notification-dropdown-container');
        
        if (bellBtn && container) {
            // 点击外部关闭下拉菜单
            document.addEventListener('click', (e) => {
                if (!container.contains(e.target)) {
                    container.classList.remove('open');
                }
            });

            bellBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = container.classList.contains('open');
                if (isOpen) {
                    container.classList.remove('open');
                } else {
                    container.classList.add('open');
                    this.loadNotifications();
                }
            });
        }
        
        // 使用事件委托处理"全部已读"按钮
        document.addEventListener('click', (e) => {
            if (e.target.id === 'mark-all-read-btn') {
                e.stopPropagation();
                this.markAllAsRead();
            }
        });
        
        // 使用事件委托处理"进入消息中心"按钮
        document.addEventListener('click', (e) => {
            if (e.target.id === 'view-all-notifications-btn') {
                e.stopPropagation();
                // 跳转到消息中心页面
                window.location.href = '/messages.html';
            }
        });
        
        const notificationList = document.getElementById('notification-list');
        if (notificationList) {
            notificationList.addEventListener('click', (e) => {
                const item = e.target.closest('.notification-item');
                if (item && item.dataset.id && !item.classList.contains('read')) {
                    this.markAsRead(item.dataset.id, item);
                }
            });
        }
    },
    
    async fetchWithAuth(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
        };
        
        try {
            const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
            
            // 处理 401 未授权错误 (Token 过期或无效)
            if (response.status === 401) {
                console.warn('[通知系统] Token 已过期或无效，清除本地认证信息');
                localStorage.removeItem('authToken');
                localStorage.removeItem('currentUser');
                // 可选：跳转到登录页面
                // window.location.href = '/login.html';
                return null;
            }
            
            return response;
        } catch (error) {
            console.error('[通知系统] 请求失败:', error);
            return null;
        }
    },
    
    async fetchUnreadCount() {
        if (!this.token) return;
        try {
            const res = await this.fetchWithAuth('/api/notifications/unread');
            if (!res) return; // Token 过期或请求失败
            const data = await res.json();
            if (data && data.success) {
                const count = typeof data.count === 'number' ? data.count : 0;
                this.updateBadge(count);
                const forumContainer = document.getElementById('forum-notification-container');
                if (forumContainer) forumContainer.style.display = 'block';
            }
        } catch (e) {
            console.error('获取未读通知数量失败', e);
        }
    },
    
    updateBadge(count) {
        this.unreadCount = count;
        const badge = document.getElementById('notification-badge');
        const titleBadge = document.getElementById('notification-count-title');
        
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
        
        if (titleBadge) {
            titleBadge.textContent = `(${count})`;
        }
    },
    
    async loadNotifications() {
        const listEl = document.getElementById('notification-list');
        if (!listEl) return;
        
        listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; font-size: 13px;">加载中...</div>';
        
        try {
            const res = await this.fetchWithAuth('/api/notifications/list?page=1&pageSize=10');
            if (!res) {
                listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; font-size: 13px;">请先登录</div>';
                return;
            }
            const data = await res.json();
            
            console.log('[通知系统] API 返回数据:', data);
            
            if (data.success && data.notifications && data.notifications.length > 0) {
                console.log('[通知系统] 渲染通知列表, 数量:', data.notifications.length);
                listEl.innerHTML = data.notifications.map(notif => this.renderNotificationItem(notif)).join('');
            } else {
                console.log('[通知系统] 无通知数据');
                listEl.innerHTML = '<div style="padding: 30px 20px; text-align: center; color: #999; font-size: 13px;">暂无新通知</div>';
            }
        } catch (e) {
            console.error('[通知系统] 加载失败:', e);
            listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: red; font-size: 13px;">加载失败，请重试</div>';
        }
    },
    
    renderNotificationItem(notif) {
        let icon = '🔔';
        let actionText = '您有新通知';
        let link = '#';
        
        if (notif.type === 'mention') {
            icon = '💬';
            actionText = '在帖子或评论中 @ 了你';
            link = `/post-detail.html?id=${notif.target_id}`;
        } else if (notif.type === 'comment') {
            icon = '✏️';
            actionText = '评论了您的帖子';
            link = `/post-detail.html?id=${notif.target_id}`;
        } else if (notif.type === 'like') {
            icon = '❤️';
            actionText = '赞了您的帖子';
            link = `/post-detail.html?id=${notif.target_id}`;
        }
        
        const isReadClass = notif.is_read ? 'read' : 'unread';
        const date = new Date(notif.created_at).toLocaleString('zh-CN');
        const content = notif.content || notif.content_preview || '';
        
        return `
            <a href="${link}" class="notification-item ${isReadClass}" data-id="${notif.id}" style="display: block; padding: 12px 16px; border-bottom: 1px solid #f0f0f0; text-decoration: none; color: inherit;">
                <div style="display: flex; gap: 10px;">
                    <div style="font-size: 18px;">${icon}</div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 13px; color: #333; margin-bottom: 4px;">
                            <strong>${this.escapeHtml(notif.sender_name || '某人')}</strong> ${actionText}
                        </div>
                        ${content ? `<div style="font-size: 12px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">"${this.escapeHtml(content)}"</div>` : ''}
                        <div style="font-size: 11px; color: #999; margin-top: 6px;">${date}</div>
                    </div>
                    ${!notif.is_read ? '<div class="unread-dot" style="width: 8px; height: 8px; background: #007bff; border-radius: 50%; align-self: center;"></div>' : ''}
                </div>
            </a>
        `;
    },
    
    async markAsRead(id, itemEl) {
        try {
            const res = await this.fetchWithAuth(`/api/notifications/mark-read/${id}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                itemEl.classList.remove('unread');
                itemEl.classList.add('read');
                const dot = itemEl.querySelector('.unread-dot');
                if (dot) dot.remove();
                this.fetchUnreadCount();
            }
        } catch (e) {
            console.error('标记已读失败', e);
        }
    },
    
    async markAllAsRead() {
        try {
            const res = await this.fetchWithAuth('/api/notifications/mark-all-read', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                this.loadNotifications();
                this.fetchUnreadCount();
            }
        } catch (e) {
            console.error('标记全部已读失败', e);
        }
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * 加载有效用户名列表（用于验证@提及）
     */
    async loadValidUsernames() {
        try {
            // 使用公开接口获取用户名列表
            const res = await fetch('/api/users/usernames');
            if (!res) return;
            const data = await res.json();
            if (data.success && data.usernames) {
                this.validUsernames = new Set(data.usernames.map(u => u.toLowerCase()));
                console.log('[通知系统] 已加载用户名列表, 数量:', this.validUsernames.size);
            }
        } catch (e) {
            console.error('[通知系统] 加载用户名列表失败:', e);
        }
    },
    
    /**
     * 解析文本中的 @用户名 并转换为高亮链接
     * @param {string} text - 包含 @用户名 的文本
     * @returns {string} 转换后的 HTML
     */
    parseMentions(text) {
        if (!text) return '';
        
        // 匹配 @用户名 的模式 (支持中英文字符、数字和下划线)
        return text.replace(/@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g, (match, username) => {
            // 验证是否为有效用户名
            const isValidUser = this.validUsernames && this.validUsernames.has(username.toLowerCase());
            
            if (isValidUser) {
                // 有效用户名：高亮显示并添加链接
                return `<a href="/user-center.html?username=${encodeURIComponent(username)}" class="mention-highlight" style="color: #007bff; font-weight: 500; text-decoration: none; background-color: #e7f3ff; padding: 1px 4px; border-radius: 3px;">@${username}</a>`;
            } else {
                // 无效用户名：保持原样，不高亮
                return match;
            }
        });
    }
};

// 暴露到 window 对象，供其他模块使用
window.NotificationManager = NotificationManager;

document.addEventListener('DOMContentLoaded', () => {
    NotificationManager.init();
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    NotificationManager.init();
}
