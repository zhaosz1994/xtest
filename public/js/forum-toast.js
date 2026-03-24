/**
 * 论坛Toast提示组件
 */

const ForumToast = {
    container: null,
    
    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'forum-toast-container';
            this.container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
            `;
            document.body.appendChild(this.container);
        }
    },
    
    show(message, type = 'success', duration = 3000) {
        this.init();
        
        const toast = document.createElement('div');
        toast.className = `forum-toast forum-toast-${type}`;
        toast.style.cssText = `
            padding: 12px 20px;
            border-radius: 6px;
            font-size: 14px;
            color: #fff;
            animation: slideIn 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        
        if (type === 'success') {
            toast.style.backgroundColor = '#28a745';
        } else if (type === 'error') {
            toast.style.backgroundColor = '#dc3545';
        } else if (type === 'warning') {
            toast.style.backgroundColor = '#f39c12';
        } else if (type === 'info') {
            toast.style.backgroundColor = '#1a73e8';
        }
        
        toast.textContent = message;
        this.container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },
    
    success(message) {
        this.show(message, 'success');
    },
    
    error(message) {
        this.show(message, 'error');
    },
    
    warning(message) {
        this.show(message, 'warning');
    },
    
    info(message) {
        this.show(message, 'info');
    }
};

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

function showToast(message, type = 'success') {
    ForumToast[type](message);
}

/**
 * 确认弹框组件
 */
function showConfirm(message, callback) {
    let modal = document.getElementById('forum-confirm-modal');
    
    if (!modal) {
        createConfirmModal();
        modal = document.getElementById('forum-confirm-modal');
    }
    
    const messageEl = document.getElementById('forum-confirm-message');
    if (messageEl) {
        messageEl.textContent = message;
    }
    
    window.forumConfirmCallback = callback;
    modal.style.display = 'flex';
}

function createConfirmModal() {
    const style = document.createElement('style');
    style.textContent = `
        .forum-confirm-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        }
        
        .forum-confirm-content {
            background: #fff;
            border-radius: 8px;
            width: 400px;
            max-width: 90%;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            animation: confirmFadeIn 0.2s ease;
        }
        
        @keyframes confirmFadeIn {
            from {
                opacity: 0;
                transform: scale(0.9);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }
        
        .forum-confirm-header {
            padding: 20px 24px;
            border-bottom: 1px solid #f0f0f0;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .forum-confirm-icon {
            font-size: 24px;
        }
        
        .forum-confirm-header h3 {
            margin: 0;
            font-size: 16px;
            color: #1a1a1a;
        }
        
        .forum-confirm-body {
            padding: 24px;
        }
        
        .forum-confirm-body p {
            margin: 0;
            font-size: 14px;
            color: #666;
            line-height: 1.6;
            white-space: pre-wrap;
        }
        
        .forum-confirm-footer {
            padding: 16px 24px;
            border-top: 1px solid #f0f0f0;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        
        .forum-confirm-btn {
            padding: 8px 20px;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
        }
        
        .forum-confirm-btn.cancel {
            background: #f5f5f5;
            color: #666;
            border: 1px solid #ddd;
        }
        
        .forum-confirm-btn.cancel:hover {
            background: #e8e8e8;
        }
        
        .forum-confirm-btn.confirm {
            background: #1a73e8;
            color: #fff;
        }
        
        .forum-confirm-btn.confirm:hover {
            background: #1557b0;
        }
    `;
    document.head.appendChild(style);
    
    const modal = document.createElement('div');
    modal.id = 'forum-confirm-modal';
    modal.className = 'forum-confirm-modal';
    modal.innerHTML = `
        <div class="forum-confirm-content">
            <div class="forum-confirm-header">
                <span class="forum-confirm-icon">⚠️</span>
                <h3>确认提示</h3>
            </div>
            <div class="forum-confirm-body">
                <p id="forum-confirm-message"></p>
            </div>
            <div class="forum-confirm-footer">
                <button class="forum-confirm-btn cancel" onclick="handleForumConfirmCancel()">取消</button>
                <button class="forum-confirm-btn confirm" onclick="handleForumConfirmOk()">确认</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function handleForumConfirmOk() {
    const modal = document.getElementById('forum-confirm-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (window.forumConfirmCallback) {
        window.forumConfirmCallback(true);
        window.forumConfirmCallback = null;
    }
}

function handleForumConfirmCancel() {
    const modal = document.getElementById('forum-confirm-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (window.forumConfirmCallback) {
        window.forumConfirmCallback(false);
        window.forumConfirmCallback = null;
    }
}
