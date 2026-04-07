const WebSocketService = {
    socket: null,
    isConnected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    reconnectDelay: 3000,
    listeners: {},

    connect() {
        if (this.socket && this.isConnected) {
            console.log('[WebSocket] 已经连接，无需重复连接');
            return;
        }

        try {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${window.location.host}`;
            
            console.log('[WebSocket] 正在连接:', wsUrl);
            this.socket = io(wsUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: this.reconnectDelay
            });

            this.setupEventHandlers();
        } catch (error) {
            console.error('[WebSocket] 连接失败:', error);
            this.handleConnectionError(error);
        }
    },

    setupEventHandlers() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('[WebSocket] 连接成功');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            if (currentUser && authToken) {
                this.socket.emit('user:login', {
                    userId: currentUser.id,
                    username: currentUser.username,
                    token: authToken
                });
            }

            this.emit('connected');
        });

        this.socket.on('disconnect', (reason) => {
            console.log('[WebSocket] 断开连接:', reason);
            this.isConnected = false;
            this.emit('disconnected', { reason });
        });

        this.socket.on('connect_error', (error) => {
            console.error('[WebSocket] 连接错误:', error);
            this.handleConnectionError(error);
        });

        this.socket.on('reconnect', (attemptNumber) => {
            console.log('[WebSocket] 重连成功，尝试次数:', attemptNumber);
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        this.socket.on('reconnect_failed', () => {
            console.error('[WebSocket] 重连失败，已达到最大重试次数');
            this.emit('reconnect_failed');
        });

        this.socket.on('user:online', (data) => {
            console.log('[WebSocket] 用户上线:', data);
            this.emit('user_online', data);
        });

        this.socket.on('user:offline', (data) => {
            console.log('[WebSocket] 用户下线:', data);
            this.emit('user_offline', data);
        });

        this.socket.on('online:users', (users) => {
            console.log('[WebSocket] 在线用户列表:', users);
            this.emit('online_users', users);
        });

        this.socket.on('notification:new', (notification) => {
            console.log('[WebSocket] 新通知:', notification);
            this.emit('notification', notification);
        });

        this.socket.on('module:update', (data) => {
            console.log('[WebSocket] 模块更新:', data);
            this.emit('module_update', data);
        });

        this.socket.on('testcase:update', (data) => {
            console.log('[WebSocket] 用例更新:', data);
            this.emit('testcase_update', data);
        });
    },

    handleConnectionError(error) {
        this.reconnectAttempts++;
        console.error(`[WebSocket] 连接错误 (尝试 ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn('[WebSocket] WebSocket连接失败不影响其他功能');
        }
    },

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    },

    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    },

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[WebSocket] 事件处理器错误 [${event}]:`, error);
            }
        });
    },

    send(event, data) {
        if (!this.socket || !this.isConnected) {
            console.warn('[WebSocket] 未连接，无法发送消息');
            return false;
        }

        try {
            this.socket.emit(event, data);
            return true;
        } catch (error) {
            console.error('[WebSocket] 发送消息失败:', error);
            return false;
        }
    },

    disconnect() {
        if (this.socket) {
            console.log('[WebSocket] 主动断开连接');
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    },

    getStatus() {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts
        };
    }
};

function initWebSocket() {
    if (!currentUser || !authToken) {
        console.log('[WebSocket] 用户未登录，跳过 WebSocket 连接');
        return;
    }

    WebSocketService.connect();

    WebSocketService.on('user_online', (data) => {
        if (typeof updateOnlineUsersDisplay === 'function') {
            updateOnlineUsersDisplay();
        }
    });

    WebSocketService.on('user_offline', (data) => {
        if (typeof updateOnlineUsersDisplay === 'function') {
            updateOnlineUsersDisplay();
        }
    });

    WebSocketService.on('online_users', (users) => {
        onlineUsers = users;
        if (typeof updateOnlineUsersDisplay === 'function') {
            updateOnlineUsersDisplay();
        }
    });

    WebSocketService.on('notification', (notification) => {
        if (typeof showSuccessMessage === 'function') {
            showSuccessMessage(notification.message);
        }
    });

    WebSocketService.on('module_update', (data) => {
        DataEventManager.emit(DataEvents.MODULE_CHANGED, data);
    });

    WebSocketService.on('testcase_update', (data) => {
        DataEventManager.emit(DataEvents.TEST_CASE_CHANGED, data);
    });
}

function updateOnlineUsersDisplay() {
    const container = document.getElementById('online-users-list');
    if (!container || !onlineUsers) return;

    if (onlineUsers.length === 0) {
        container.innerHTML = '<div class="no-data">暂无在线用户</div>';
        return;
    }

    container.innerHTML = onlineUsers.map(user => `
        <div class="online-user-item">
            <div class="user-avatar">${user.username.charAt(0).toUpperCase()}</div>
            <div class="user-name">${user.username}</div>
        </div>
    `).join('');
}
