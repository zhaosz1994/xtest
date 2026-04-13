const pool = require('../db');
const logger = require('./logger');

class AuditLogService {
    static async log({ userId, username, userRole, action, targetType, targetId, details, ipAddress, userAgent, beforeData, afterData }) {
        try {
            await pool.execute(
                `INSERT INTO audit_logs 
                 (user_id, username, user_role, action, target_type, target_id, details, ip_address, user_agent, before_data, after_data, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    userId || null,
                    username || 'system',
                    userRole || null,
                    action,
                    targetType || null,
                    targetId || null,
                    details || null,
                    ipAddress || null,
                    userAgent || null,
                    beforeData ? JSON.stringify(beforeData) : null,
                    afterData ? JSON.stringify(afterData) : null
                ]
            );
        } catch (error) {
            logger.error('审计日志写入失败:', { error: error.message, action, targetType, targetId });
        }
    }

    static async logModuleAction({ userId, username, userRole, action, moduleId, moduleName, details, ipAddress, userAgent, beforeData, afterData }) {
        return AuditLogService.log({
            userId, username, userRole,
            action: `module.${action}`,
            targetType: 'module',
            targetId: moduleId,
            details: details || `${action}模块: ${moduleName}`,
            ipAddress, userAgent,
            beforeData, afterData
        });
    }

    static async logProjectAction({ userId, username, userRole, action, projectId, projectName, details, ipAddress, userAgent, beforeData, afterData }) {
        return AuditLogService.log({
            userId, username, userRole,
            action: `project.${action}`,
            targetType: 'project',
            targetId: projectId,
            details: details || `${action}项目: ${projectName}`,
            ipAddress, userAgent,
            beforeData, afterData
        });
    }

    static async logUserAction({ userId, username, userRole, action, targetUserId, targetUsername, details, ipAddress, userAgent, beforeData, afterData }) {
        return AuditLogService.log({
            userId, username, userRole,
            action: `user.${action}`,
            targetType: 'user',
            targetId: targetUserId,
            details: details || `${action}用户: ${targetUsername}`,
            ipAddress, userAgent,
            beforeData, afterData
        });
    }

    static async logForumAction({ userId, username, userRole, action, postId, details, ipAddress, userAgent, beforeData, afterData }) {
        return AuditLogService.log({
            userId, username, userRole,
            action: `forum.${action}`,
            targetType: 'forum_post',
            targetId: postId,
            details,
            ipAddress, userAgent,
            beforeData, afterData
        });
    }

    static async logExportAction({ userId, username, userRole, action, targetType, targetId, details, ipAddress, userAgent }) {
        return AuditLogService.log({
            userId, username, userRole,
            action: `export.${action}`,
            targetType: targetType || 'export',
            targetId,
            details,
            ipAddress, userAgent
        });
    }

    static async getLogs({ page = 1, pageSize = 20, action, targetType, userId, startDate, endDate }) {
        const offset = (page - 1) * pageSize;
        const conditions = [];
        const params = [];

        if (action) {
            conditions.push('action LIKE ?');
            params.push(`${action}%`);
        }
        if (targetType) {
            conditions.push('target_type = ?');
            params.push(targetType);
        }
        if (userId) {
            conditions.push('user_id = ?');
            params.push(userId);
        }
        if (startDate) {
            conditions.push('created_at >= ?');
            params.push(startDate);
        }
        if (endDate) {
            conditions.push('created_at <= ?');
            params.push(endDate);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
            params
        );

        const [rows] = await pool.execute(
            `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(pageSize)} OFFSET ${parseInt(offset)}`,
            params
        );

        return {
            total: countResult[0].total,
            page,
            pageSize,
            items: rows
        };
    }
}

async function ensureAuditLogsTable() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                username VARCHAR(100),
                user_role VARCHAR(50),
                action VARCHAR(100) NOT NULL,
                target_type VARCHAR(50),
                target_id VARCHAR(100),
                details TEXT,
                ip_address VARCHAR(45),
                user_agent TEXT,
                before_data JSON,
                after_data JSON,
                created_at DATETIME NOT NULL,
                INDEX idx_action (action),
                INDEX idx_target (target_type, target_id),
                INDEX idx_user (user_id),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        logger.info('审计日志表已就绪');
    } catch (error) {
        logger.error('创建审计日志表失败:', { error: error.message });
    }
}

ensureAuditLogsTable();

module.exports = AuditLogService;
