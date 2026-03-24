const pool = require('../db');
const emailService = require('./emailService');

/**
 * 提取文本中的 @username 
 * @param {string} text - 包含 @ 提及的文本
 * @returns {string[]} 匹配到的用户名数组
 */
function extractMentions(text) {
    if (!text) return [];
    // 匹配 @username 的模式 (支持中英文字符、数字和下划线，不包含空格)
    // 根据系统当前的用户名规则做适配
    const mentionRegex = /@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g;
    const matches = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
        matches.push(match[1]);
    }
    // 去重
    return [...new Set(matches)];
}

/**
 * 截取内容预览摘要
 */
function generatePreview(text) {
    if (!text) return '';
    const cleanText = text.replace(/<[^>]*>?/gm, '').trim();
    return cleanText.length > 50 ? cleanText.substring(0, 50) + '...' : cleanText;
}

/**
 * 处理 @ 提及
 * @param {string} content - 帖子或评论的完整内容
 * @param {number} senderId - 发送者 ID
 * @param {number} targetId - 帖子或评论的 ID (用于生成链接)
 * @param {string} sourceUrl - 来源链接 (如 /forum/post/123)
 * @param {string} sourceType - 来源类型: 'post' | 'comment'
 */
async function processMentions(content, senderId, targetId, sourceUrl, sourceType = 'post') {
    try {
        const mentionedUsernames = extractMentions(content);
        if (mentionedUsernames.length === 0) return;

        // 获取发送者信息
        const [senders] = await pool.execute('SELECT username FROM users WHERE id = ?', [senderId]);
        const senderName = senders.length > 0 ? senders[0].username : '某人';

        const preview = generatePreview(content);

        // 查找所有被提及的真实用户
        const placeholders = mentionedUsernames.map(() => '?').join(',');
        const query = `
            SELECT id, email, email_notify_mentions, username 
            FROM users 
            WHERE username IN (${placeholders}) AND status = 'active'
        `;
        const [users] = await pool.execute(query, mentionedUsernames);

        for (const user of users) {
             // 不要@自己
            if (user.id === senderId) continue;

            // 1. 写入站内通知 (同时设置 title 和 content 字段)
            const title = `${senderName} 在讨论中@了你`;
            await pool.execute(
                `INSERT INTO notifications (user_id, sender_id, type, target_id, title, content, content_preview) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [user.id, senderId, 'mention', targetId, title, preview, preview]
            );

            // 2. 判断是否需要发邮件
            if (user.email_notify_mentions == 1 && user.email) {
                const subject = `【xTest 社区】${senderName} 刚刚在论坛中@了你`;
                const link = `${process.env.APP_URL || 'http://localhost:3000'}${sourceUrl}`;
                const html = `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                        <h2 style="color: #333;">你在讨论中被提及啦！</h2>
                        <p><strong>${senderName}</strong> 在论坛中@了你。</p>
                        <div style="background-color: #f5f5f5; padding: 15px; border-left: 4px solid #007bff; margin: 20px 0;">
                            ${preview}
                        </div>
                        <a href="${link}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 4px;">点击查看详情</a>
                        <p style="color: #999; font-size: 12px; margin-top: 30px;">如果你不想接收此类邮件，可以在个人偏好设置中关闭提醒。</p>
                    </div>
                `;
                // 异步发送邮件，不阻塞
                emailService.sendEmail({
                    to: user.email,
                    subject: subject,
                    html: html,
                    emailType: 'notification'
                }).catch(e => console.error('发送@提醒邮件失败', e));
            }
        }
    } catch (error) {
        console.error('处理 @ 提及过程出错:', error);
    }
}

/**
 * 处理互动通知 (评论、点赞)
 * 当用户处于匿名模式时，不发送邮件通知给被互动的人，防止隐私泄露或只生成站内通知（这里为了安全，匿名互动甚至不生成针对个人带名字的通知。根据设计，匿名帖被回复也不通知原帖主，保持匿名性）。
 */
async function notifyInteraction(targetUserId, senderId, interactionType, targetId, preview, sourceUrl) {
    try {
        if (!targetUserId || targetUserId === senderId) return; // 自己互动自己不通知

        const [senders] = await pool.execute('SELECT username FROM users WHERE id = ?', [senderId]);
        const senderName = senders.length > 0 ? senders[0].username : '某人';

        const [users] = await pool.execute(
            'SELECT id, email, email_notify_comments, email_notify_likes FROM users WHERE id = ? AND status = "active"',
            [targetUserId]
        );

        if (users.length === 0) return;
        const targetUser = users[0];

        // 1. 写入站内通知 (同时设置 title 和 content 字段)
        let title = '';
        let actionText = '';
        if (interactionType === 'comment') {
            title = `${senderName} 评论了您的帖子`;
            actionText = '评论了您的帖子';
        } else if (interactionType === 'like') {
            title = `${senderName} 赞了您的帖子`;
            actionText = '赞了您的帖子';
        } else {
            title = `您有新的互动通知`;
            actionText = '与您互动';
        }
        
        await pool.execute(
            `INSERT INTO notifications (user_id, sender_id, type, target_id, title, content, content_preview) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [targetUserId, senderId, interactionType, targetId, title, preview, preview]
        );

        // 2. 发送邮件
        let shouldEmail = false;
        if (interactionType === 'comment' && targetUser.email_notify_comments == 1) {
            shouldEmail = true;
        } else if (interactionType === 'like' && targetUser.email_notify_likes == 1) {
            shouldEmail = true;
        }

        if (shouldEmail && targetUser.email) {
            const subject = `【xTest 社区】${senderName} ${actionText}`;
            const link = `${process.env.APP_URL || 'http://localhost:3000'}${sourceUrl}`;
            const html = `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #333;">新的互动通知</h2>
                    <p><strong>${senderName}</strong> ${actionText}。</p>
                    ${preview ? `<div style="background-color: #f5f5f5; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0;">${preview}</div>` : ''}
                    <a href="${link}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: #fff; text-decoration: none; border-radius: 4px;">点击查看详情</a>
                    <p style="color: #999; font-size: 12px; margin-top: 30px;">如果你不想接收此类邮件，可以在个人设置中关闭提醒。</p>
                </div>
            `;

            emailService.sendEmail({
                to: targetUser.email,
                subject: subject,
                html: html,
                emailType: 'notification'
            }).catch(e => console.error('发送互动提醒邮件失败', e));
        }

    } catch (error) {
        console.error('处理互动通知过程出错:', error);
    }
}

module.exports = {
    processMentions,
    notifyInteraction,
    generatePreview
};
