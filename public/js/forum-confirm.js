/**
 * 论坛确认弹框组件
 * 文件路径: public/js/forum-confirm.js
 */

const ForumConfirm = {
    callback: null
};

function showForumConfirm(message, onConfirm, onCancel) {
    const modal = document.getElementById('forum-confirm-modal');
    const messageEl = document.getElementById('forum-confirm-message');
    
    if (!modal) {
        createForumConfirmModal();
        return showForumConfirm(message, onConfirm, onCancel);
    }
    
    messageEl.textContent = message;
    ForumConfirm.callback = { onConfirm, onCancel };
    modal.style.display = 'flex';
}

function createForumConfirmModal() {
    const modalHtml = `
        <div id="forum-confirm-modal" class="forum-confirm-modal" style="display: none;">
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
        </div>
    `;
    
    const style = document.createElement('style');
    style.id = 'forum-confirm-styles';
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
            animation: forum-confirm-in 0.2s ease;
        }
        
        @keyframes forum-confirm-in {
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
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function handleForumConfirmOk() {
    const modal = document.getElementById('forum-confirm-modal');
    modal.style.display = 'none';
    
    if (ForumConfirm.callback && ForumConfirm.callback.onConfirm) {
        ForumConfirm.callback.onConfirm();
    }
    ForumConfirm.callback = null;
}

function handleForumConfirmCancel() {
    const modal = document.getElementById('forum-confirm-modal');
    modal.style.display = 'none';
    
    if (ForumConfirm.callback && ForumConfirm.callback.onCancel) {
        ForumConfirm.callback.onCancel();
    }
    ForumConfirm.callback = null;
}

function forumConfirm(message) {
    return new Promise((resolve) => {
        showForumConfirm(message, () => resolve(true), () => resolve(false));
    });
}
