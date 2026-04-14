const pool = require('../db');
const emailNotificationService = require('./emailNotificationService');

function extractMentions(text) {
    if (!text) return [];
    const mentionRegex = /@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g;
    const matches = [];
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
        matches.push(match[1]);
    }
    return [...new Set(matches)];
}

function generatePreview(text) {
    if (!text) return '';
    const cleanText = text.replace(/<[^>]*>?/gm, '').trim();
    return cleanText.length > 50 ? cleanText.substring(0, 50) + '...' : cleanText;
}

async function processMentions(content, senderId, targetId, sourceUrl, sourceType = 'post') {
    try {
        const mentionedUsernames = extractMentions(content);
        if (mentionedUsernames.length === 0) return;

        const [senders] = await pool.execute('SELECT username FROM users WHERE id = ?', [senderId]);
        const senderName = senders.length > 0 ? senders[0].username : '某人';

        const preview = generatePreview(content);

        const placeholders = mentionedUsernames.map(() => '?').join(',');
        const query = `
            SELECT id, username 
            FROM users 
            WHERE username IN (${placeholders}) AND status = 'active'
        `;
        const [users] = await pool.execute(query, mentionedUsernames);

        for (const user of users) {
            if (user.id === senderId) continue;

            const title = `${senderName} 在讨论中@了你`;
            await pool.execute(
                `INSERT INTO notifications (user_id, sender_id, type, target_id, title, content, content_preview) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [user.id, senderId, 'mention', targetId, title, preview, preview]
            );

            emailNotificationService.send({
                emailType: 'mention',
                to: user.id,
                data: {
                    senderName: senderName,
                    preview: preview,
                    sourceUrl: sourceUrl
                },
                options: { skipInApp: true }
            }).catch(e => console.error('发送@提醒邮件失败', e));
        }
    } catch (error) {
        console.error('处理 @ 提及过程出错:', error);
    }
}

async function notifyInteraction(targetUserId, senderId, interactionType, targetId, preview, sourceUrl) {
    try {
        if (!targetUserId || targetUserId === senderId) return;

        const [senders] = await pool.execute('SELECT username FROM users WHERE id = ?', [senderId]);
        const senderName = senders.length > 0 ? senders[0].username : '某人';

        const [users] = await pool.execute(
            'SELECT id FROM users WHERE id = ? AND status = "active"',
            [targetUserId]
        );

        if (users.length === 0) return;

        let title = '';
        if (interactionType === 'comment') {
            title = `${senderName} 评论了您的帖子`;
        } else if (interactionType === 'like') {
            title = `${senderName} 赞了您的帖子`;
        } else {
            title = `您有新的互动通知`;
        }

        await pool.execute(
            `INSERT INTO notifications (user_id, sender_id, type, target_id, title, content, content_preview) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [targetUserId, senderId, interactionType, targetId, title, preview, preview]
        );

        const emailType = interactionType === 'comment' ? 'comment' : 'like';
        emailNotificationService.send({
            emailType: emailType,
            to: targetUserId,
            data: {
                senderName: senderName,
                preview: preview,
                sourceUrl: sourceUrl
            },
            options: { skipInApp: true }
        }).catch(e => console.error('发送互动提醒邮件失败', e));

    } catch (error) {
        console.error('处理互动通知过程出错:', error);
    }
}

module.exports = {
    processMentions,
    notifyInteraction,
    generatePreview
};
