const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../services/logger');

router.get('/preferences', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const prefs = await emailNotificationService.getAllNotificationPrefs(userId);
        res.json({ success: true, data: prefs });
    } catch (error) {
        logger.error('获取通知偏好失败:', { error: error.message });
        res.status(500).json({ success: false, message: '获取通知偏好失败' });
    }
});

router.put('/preferences/global', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { emailEnabled, quietHoursStart, quietHoursEnd } = req.body;
        await emailNotificationService.updateGlobalPrefs(userId, {
            emailEnabled,
            quietHoursStart,
            quietHoursEnd
        });
        res.json({ success: true, message: '全局偏好更新成功' });
    } catch (error) {
        logger.error('更新全局偏好失败:', { error: error.message });
        res.status(500).json({ success: false, message: '更新全局偏好失败' });
    }
});

router.put('/preferences/batch', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { preferences } = req.body;
        if (!Array.isArray(preferences) || preferences.length === 0) {
            return res.status(400).json({ success: false, message: 'preferences 必须是非空数组' });
        }
        await emailNotificationService.batchUpdateTypePrefs(userId, preferences);
        res.json({ success: true, message: '批量更新偏好成功' });
    } catch (error) {
        logger.error('批量更新通知偏好失败:', { error: error.message });
        res.status(500).json({ success: false, message: '批量更新通知偏好失败' });
    }
});

router.put('/preferences/:typeCode', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { typeCode } = req.params;
        const { emailEnabled, inAppEnabled } = req.body;
        if (emailEnabled === undefined && inAppEnabled === undefined) {
            return res.status(400).json({ success: false, message: '至少需要提供一个偏好设置' });
        }
        const currentPrefs = await emailNotificationService.getAllNotificationPrefs(userId);
        let currentType = null;
        for (const cat of currentPrefs.categories) {
            currentType = cat.types.find(t => t.typeCode === typeCode);
            if (currentType) break;
        }
        if (!currentType) {
            return res.status(404).json({ success: false, message: `邮件类型不存在: ${typeCode}` });
        }
        await emailNotificationService.updateTypePref(
            userId,
            typeCode,
            emailEnabled !== undefined ? emailEnabled : currentType.emailEnabled,
            inAppEnabled !== undefined ? inAppEnabled : currentType.inAppEnabled
        );
        res.json({ success: true, message: '偏好更新成功' });
    } catch (error) {
        logger.error('更新通知偏好失败:', { error: error.message });
        if (error.message.includes('强制发送')) {
            return res.status(400).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: '更新通知偏好失败' });
    }
});

router.post('/preferences/reset', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        await emailNotificationService.resetPrefs(userId);
        res.json({ success: true, message: '偏好已重置为默认值' });
    } catch (error) {
        logger.error('重置通知偏好失败:', { error: error.message });
        res.status(500).json({ success: false, message: '重置通知偏好失败' });
    }
});

module.exports = router;
