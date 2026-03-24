/**
 * 通知系统前端模块
 */
const NotificationSystem = {
    initialized: false,
    pollInterval: null,
    
    async init() {
        if (this.initialized) return;
        
        console.log('[通知系统] 初始化中...');
        
        // 检查用户是否登录
        const token = localStorage.getItem('authToken');
        if (!token) {
            console.log('[通知系统] 用户未登录，跳过初始化');
            return;
        }
        
        // 绑定事件
        this.bindEvents();
        
        // 获取未读数量
        await this.fetchUnreadCount();
        
        // 启动轮询
        this.startPolling();
        
        this.initialized = true;
        console.log('[通知系统] 初始化完成');
    },
    
    bindEvents() {
        const bellBtn = document.getElementById('notification-bell-btn');
        const dropdown = document.getElementById('notification-dropdown-container');
        
        if (bellBtn) {
            bellBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleDropdown();
            });
        }
        
        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (dropdown && !dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });
        
        // 全部已读按钮
        const markAllReadBtn = document.getElementById('mark-all-read-btn');
        if (markAllReadBtn) {
            markAllReadBtn.addEventListener('click', () => this.markAllRead());
        }
    },
    
    async fetchWithAuth(url, options = {}) {
        const token = localStorage.getItem('authToken');
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        try {
            const response = await fetch(url, {
                ...options,
                headers
            });
            
            if (!response.ok) {
                console.warn('[通知系统] HTTP错误:', response.status);
                return null;
            }
            
            const text = await response.text();
            if (!text) {
                return null;
            }
            
            return JSON.parse(text);
        } catch (error) {
            console.error('[通知系统] 请求失败:', error);
            return null;
        }
    },
    
    async fetchUnreadCount() {
        try {
            const result = await this.fetchWithAuth('/api/notifications/unread');
            
            // 安全检查 result
            if (result && typeof result === 'object' && result.success === true) {
                const count = typeof result.count === 'number' ? result.count : 0;
                this.updateBadge(count);
            } else {
                const errorMsg = result && typeof result === 'object' ? (result.message || '未知错误') : '响应格式错误';
                console.warn('[通知系统] 获取未读数量失败:', errorMsg);
                this.updateBadge(0);
            }
        } catch (error) {
            console.error('[通知系统] 获取未读通知数量失败:', error);
            this.updateBadge(0);
        }
    },
    
    updateBadge(count) {
        const badge = document.getElementById('notification-badge');
        const countTitle = document.getElementById('notification-count-title');
        
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
        
        if (countTitle) {
            countTitle.textContent = `(${count})`;
        }
    },
    
    async toggleDropdown() {
        const dropdown = document.getElementById('notification-dropdown-container');
        if (!dropdown) return;
        
        const isOpen = dropdown.classList.contains('open');
        
        if (!isOpen) {
            dropdown.classList.add('open');
            await this.fetchNotifications();
        } else {
            dropdown.classList.remove('open');
        }
    },
    
    async fetchNotifications() {
        const listContainer = document.getElementById('notification-list');
        if (!listContainer) return;
        
        listContainer.innerHTML = '<div class="notification-loading">加载中...</div>';
        
        try {
            const result = await this.fetchWithAuth('/api/notifications/list?page=1&pageSize=10');
            
            if (result && result.success && result.notifications) {
                this.renderNotifications(result.notifications);
            } else {
                listContainer.innerHTML = '<div class="notification-empty">暂无通知</div>';
            }
        } catch (error) {
            console.error('[通知系统] 获取通知列表失败:', error);
            listContainer.innerHTML = '<div class="notification-error">加载失败</div>';
        }
    },
    
    renderNotifications(notifications) {
        const listContainer = document.getElementById('notification-list');
        if (!listContainer) return;
        
        if (!notifications || notifications.length === 0) {
            listContainer.innerHTML = '<div class="notification-empty">暂无通知</div>';
            return;
        }
        
        listContainer.innerHTML = notifications.map(n => `
            <div class="notification-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
                <div class="notification-item-content">
                    <div class="notification-item-title">${this.escapeHtml(n.title || '系统通知')}</div>
                    <div class="notification-item-text">${this.escapeHtml(n.content || '')}</div>
                    <div class="notification-item-time">${this.formatTime(n.created_at)}</div>
                </div>
                ${!n.is_read ? '<button class="mark-read-btn" onclick="NotificationSystem.markRead(' + n.id + ')">标记已读</button>' : ''}
            </div>
        `).join('');
    },
    
    async markRead(id) {
        try {
            const result = await this.fetchWithAuth(`/api/notifications/mark-read/${id}`, {
                method: 'POST'
            });
            
            if (result && result.success) {
                await this.fetchUnreadCount();
                await this.fetchNotifications();
            }
        } catch (error) {
            console.error('[通知系统] 标记已读失败:', error);
        }
    },
    
    async markAllRead() {
        try {
            const result = await this.fetchWithAuth('/api/notifications/mark-all-read', {
                method: 'POST'
            });
            
            if (result && result.success) {
                await this.fetchUnreadCount();
                await this.fetchNotifications();
            }
        } catch (error) {
            console.error('[通知系统] 标记全部已读失败:', error);
        }
    },
    
    startPolling() {
        // 每60秒轮询一次
        this.pollInterval = setInterval(() => {
            this.fetchUnreadCount();
        }, 60000);
    },
    
    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    formatTime(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
        
        return date.toLocaleDateString('zh-CN');
    }
};

// 页面加载后初始化
setTimeout(() => {
    NotificationSystem.init();
}, 1000);
