/**
 * 论坛模块路由 - 修复版
 * 文件路径: routes/forum.js
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db');
const jwt = require('jsonwebtoken');
const notificationService = require('../services/notificationService');

// ==================== 常量定义 ====================

// 角色枚举 - 统一角色判断
const ROLES = {
    ADMIN: 'admin',
    ADMIN_CN: '管理员',
    isAdmin: (role) => role === ROLES.ADMIN || role === ROLES.ADMIN_CN
};

/**
 * 禁言状态检查中间件
 * 在发帖、评论前检查用户是否处于禁言期
 */
const checkMuted = async (req, res, next) => {
    const userId = req.user?.id;
    
    if (!userId) {
        return res.status(401).json({ 
            success: false, 
            message: '未登录' 
        });
    }
    
    try {
        const [users] = await pool.execute(
            `SELECT muted_until FROM users WHERE id = ?`,
            [userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: '用户不存在' 
            });
        }
        
        const mutedUntil = users[0].muted_until;
        
        if (mutedUntil && new Date(mutedUntil) > new Date()) {
            const remainingTime = Math.ceil((new Date(mutedUntil) - new Date()) / (1000 * 60 * 60 * 24));
            return res.status(403).json({ 
                success: false, 
                message: `您已被禁言，还需等待 ${remainingTime} 天后解禁`,
                data: { 
                    mutedUntil: mutedUntil,
                    remainingDays: remainingTime
                }
            });
        }
        
        next();
    } catch (error) {
        console.error('检查禁言状态错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '服务器错误' 
        });
    }
};

// 速率限制器 - 简单内存实现
const uploadRateLimiter = {
    uploads: new Map(),
    limit: 10,
    windowMs: 60 * 1000,
    check(userId) {
        const now = Date.now();
        const userUploads = this.uploads.get(userId) || [];
        const recentUploads = userUploads.filter(time => now - time < this.windowMs);
        
        if (recentUploads.length >= this.limit) {
            return { allowed: false, remaining: 0, resetIn: Math.ceil((recentUploads[0] + this.windowMs - now) / 1000) };
        }
        
        recentUploads.push(now);
        this.uploads.set(userId, recentUploads);
        
        return { allowed: true, remaining: this.limit - recentUploads.length, resetIn: this.windowMs / 1000 };
    },
    cleanup() {
        const now = Date.now();
        for (const [userId, uploads] of this.uploads.entries()) {
            const recentUploads = uploads.filter(time => now - time < this.windowMs);
            if (recentUploads.length === 0) {
                this.uploads.delete(userId);
            } else {
                this.uploads.set(userId, recentUploads);
            }
        }
    }
};

setInterval(() => uploadRateLimiter.cleanup(), 60 * 1000);

const MAX_FILE_SIZE_MB = parseInt(process.env.FORUM_MAX_FILE_SIZE_MB) || 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const FILE_TYPES = {
    IMAGE: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    DOCUMENT: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.md', '.txt'],
    CODE: ['.c', '.cpp', '.h', '.hpp', '.py', '.tcl', '.sh', '.json', '.xml', '.yaml', '.yml', '.js', '.ts', '.java', '.go', '.rs'],
    ARCHIVE: ['.zip', '.tar', '.gz', '.rar']
};

// ==================== 中间件配置 ====================

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: '未登录，请先登录' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Token无效或已过期' });
        }
        req.user = user;
        next();
    });
};

const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (!err) {
                req.user = user;
            }
            next();
        });
    } else {
        next();
    }
};

// ==================== 工具函数 ====================

// 生成UUID
function generateId(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
}

// 获取文件类型
function getFileType(mimetype, ext) {
    if (FILE_TYPES.IMAGE.includes(mimetype)) return 'image';
    if (FILE_TYPES.DOCUMENT.includes(ext.toLowerCase())) return 'document';
    if (FILE_TYPES.CODE.includes(ext.toLowerCase())) return 'code';
    if (FILE_TYPES.ARCHIVE.includes(ext.toLowerCase())) return 'archive';
    return 'other';
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 转义HTML
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==================== 文件上传配置 ====================

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = req.user?.id || 'anonymous';
        const uploadDir = path.join(__dirname, '../public/uploads/forum', String(userId));
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
        cb(null, filename);
    }
});

const imageUpload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

const attachmentUpload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

// ==================== API 路由 ====================

/**
 * POST /api/forum/upload
 * 图片上传接口（带速率限制）
 */
router.post('/upload', authenticateToken, (req, res, next) => {
    const rateCheck = uploadRateLimiter.check(req.user.id);
    if (!rateCheck.allowed) {
        return res.status(429).json({ 
            success: 0, 
            msg: `上传过于频繁，请 ${rateCheck.resetIn} 秒后再试` 
        });
    }
    next();
}, imageUpload.single('file[]'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: 0, msg: '请选择要上传的图片' });
        }
        
        const userId = req.user.id;
        const fileUrl = `/uploads/forum/${userId}/${req.file.filename}`;
        
        console.log(`[论坛] 用户 ${req.user.username} 上传图片: ${fileUrl}`);
        
        res.json({
            success: 1,
            msg: '上传成功',
            data: { url: fileUrl, alt: req.file.originalname, name: req.file.filename }
        });
    } catch (error) {
        console.error('图片上传错误:', error);
        res.status(500).json({ success: 0, msg: '服务器错误' });
    }
});

/**
 * POST /api/forum/attachments
 * 附件上传接口（带速率限制）
 */
router.post('/attachments', authenticateToken, (req, res, next) => {
    const rateCheck = uploadRateLimiter.check(req.user.id);
    if (!rateCheck.allowed) {
        return res.status(429).json({ 
            success: false, 
            message: `上传过于频繁，请 ${rateCheck.resetIn} 秒后再试` 
        });
    }
    next();
}, attachmentUpload.array('files', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.json({ success: false, message: '请选择要上传的文件' });
        }
        
        const uploaderId = req.user.id;
        const attachments = [];
        
        for (const file of req.files) {
            const ext = path.extname(file.originalname).toLowerCase();
            const fileType = getFileType(file.mimetype, ext);
            
            const [result] = await pool.execute(
                `INSERT INTO forum_attachments (uploader_id, file_name, file_path, file_size, file_type, mime_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [uploaderId, file.originalname, `/uploads/forum/${uploaderId}/${file.filename}`, file.size, fileType, file.mimetype]
            );
            
            attachments.push({
                id: result.insertId,
                name: file.originalname,
                url: `/uploads/forum/${uploaderId}/${file.filename}`,
                size: file.size,
                type: fileType
            });
        }
        
        res.json({ success: true, message: `成功上传 ${attachments.length} 个文件`, data: attachments });
    } catch (error) {
        console.error('附件上传错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * GET /api/forum/attachments/download/:id
 * 下载附件
 */
router.get('/attachments/download/:id', async (req, res) => {
    const attachmentId = req.params.id;
    
    try {
        const [attachments] = await pool.execute(
            `SELECT * FROM forum_attachments WHERE id = ?`,
            [attachmentId]
        );
        
        if (attachments.length === 0) {
            return res.status(404).json({ success: false, message: '附件不存在' });
        }
        
        const attachment = attachments[0];
        
        await pool.execute(
            `UPDATE forum_attachments SET download_count = download_count + 1 WHERE id = ?`,
            [attachmentId]
        );
        
        const filePath = path.join(__dirname, '../public', attachment.file_path);
        res.download(filePath, attachment.file_name);
    } catch (error) {
        console.error('下载附件错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * POST /api/forum/posts
 * 创建帖子 - 使用事务保护，支持自动创建标签和匿名发布
 */
router.post('/posts', authenticateToken, checkMuted, async (req, res) => {
    const { title, content, tags, attachments, isAnonymous } = req.body;
    const authorId = req.user.id;
    const isAnonymousFlag = isAnonymous ? 1 : 0;
    
    if (!title || !title.trim()) {
        return res.json({ success: false, message: '帖子标题不能为空' });
    }
    if (!content || !content.trim()) {
        return res.json({ success: false, message: '帖子内容不能为空' });
    }
    if (title.length > 200) {
        return res.json({ success: false, message: '帖子标题不能超过200个字符' });
    }
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const postId = generateId('POST');
        
        const [result] = await connection.execute(
            `INSERT INTO forum_posts (post_id, author_id, is_anonymous, title, content, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
            [postId, authorId, isAnonymousFlag, title.trim(), content]
        );
        
        const insertedPostId = result.insertId;
        
        if (tags && Array.isArray(tags) && tags.length > 0) {
            const tagIds = [];
            
            for (const tagName of tags) {
                if (!tagName || typeof tagName !== 'string') continue;
                
                const trimmedName = tagName.trim();
                if (!trimmedName || trimmedName === '全部') continue;
                
                let [existingTags] = await connection.execute(
                    `SELECT id FROM forum_tags WHERE name = ?`,
                    [trimmedName]
                );
                
                let tagId;
                if (existingTags.length > 0) {
                    tagId = existingTags[0].id;
                } else {
                    const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
                    const [tagResult] = await connection.execute(
                        `INSERT INTO forum_tags (name, color, post_count, created_at) VALUES (?, ?, 0, NOW())`,
                        [trimmedName, randomColor]
                    );
                    tagId = tagResult.insertId;
                    console.log(`[论坛] 自动创建新标签: ${trimmedName} (ID: ${tagId})`);
                }
                
                if (tagId && !tagIds.includes(tagId)) {
                    tagIds.push(tagId);
                }
            }
            
            for (const tagId of tagIds) {
                await connection.execute(
                    `INSERT INTO forum_post_tags (post_id, tag_id) VALUES (?, ?)`,
                    [insertedPostId, tagId]
                );
                await connection.execute(
                    `UPDATE forum_tags SET post_count = post_count + 1 WHERE id = ?`,
                    [tagId]
                );
            }
        }
        
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
            for (const attachmentId of attachments) {
                await connection.execute(
                    `UPDATE forum_attachments SET post_id = ? WHERE id = ?`,
                    [insertedPostId, attachmentId]
                );
            }
        }
        
        await connection.commit();
        
        console.log(`[论坛] 用户 ${req.user.username} 创建帖子: ${postId}`);

        // 异步处理提及通知
        notificationService.processMentions(content, authorId, insertedPostId, `/forum/post/${postId}`, 'post').catch(e => console.error(e));
        
        res.json({
            success: true,
            message: '帖子发布成功',
            data: { id: insertedPostId, postId: postId }
        });
    } catch (error) {
        await connection.rollback();
        console.error('创建帖子错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    } finally {
        connection.release();
    }
});

/**
 * GET /api/forum/posts
 * 分页获取帖子列表（可选认证，用于显示点赞状态）
 */
router.get('/posts', optionalAuth, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 50);
    const tag = req.query.tag;
    const keyword = req.query.keyword;
    const authorId = req.query.authorId;
    const sortBy = req.query.sortBy || 'time';
    
    const offset = (page - 1) * pageSize;
    const userId = req.user ? req.user.id : null;
    
    try {
        let whereClause = "WHERE p.status = 'normal'";
        let params = [];
        
        if (tag) {
            whereClause += ` AND EXISTS (SELECT 1 FROM forum_post_tags pt WHERE pt.post_id = p.id AND pt.tag_id = ?)`;
            params.push(tag);
        }
        
        if (authorId) {
            whereClause += ` AND p.author_id = ?`;
            params.push(authorId);
        }
        
        if (keyword && keyword.trim()) {
            const searchTerm = keyword.trim();
            const hasChinese = /[\u4e00-\u9fa5]/.test(searchTerm);
            
            if (hasChinese) {
                whereClause += ` AND (p.title LIKE ? OR p.content LIKE ?)`;
                const likeTerm = `%${searchTerm}%`;
                params.push(likeTerm, likeTerm);
            } else {
                whereClause += ` AND MATCH(p.title, p.content) AGAINST (? IN BOOLEAN MODE)`;
                params.push(searchTerm);
            }
        }
        
        let orderClause = 'p.is_pinned DESC, p.created_at DESC';
        if (sortBy === 'likes') {
            orderClause = 'p.is_pinned DESC, p.like_count DESC, p.created_at DESC';
        } else if (sortBy === 'comments') {
            orderClause = 'p.is_pinned DESC, p.comment_count DESC, p.created_at DESC';
        }
        
        const [posts] = await pool.query(
            `SELECT 
                p.id, p.post_id, p.title, p.content, p.view_count, p.comment_count, p.like_count,
                p.is_pinned, p.is_anonymous, p.created_at, p.updated_at,
                u.id as author_id, u.username as author_name, u.role as author_role,
                GROUP_CONCAT(DISTINCT CONCAT(t.name, '::', t.color) SEPARATOR '||' ) as tag_data
            FROM forum_posts p
            LEFT JOIN users u ON p.author_id = u.id
            LEFT JOIN forum_post_tags pt ON p.id = pt.post_id
            LEFT JOIN forum_tags t ON pt.tag_id = t.id
            ${whereClause}
            GROUP BY p.id
            ORDER BY ${orderClause}
            LIMIT ${pageSize} OFFSET ${offset}`,
            params
        );
        
        const [countResult] = await pool.query(
            `SELECT COUNT(DISTINCT p.id) as total FROM forum_posts p ${whereClause}`,
            params
        );
        
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / pageSize);
        
        let likedPostIds = [];
        if (userId && posts.length > 0) {
            const postIds = posts.map(p => p.id);
            const placeholders = postIds.map(() => '?').join(',');
            const [likes] = await pool.execute(
                `SELECT DISTINCT target_id FROM forum_likes 
                 WHERE user_id = ? AND target_type = 'post' AND target_id IN (${placeholders})`,
                [userId, ...postIds]
            );
            likedPostIds = likes.map(l => l.target_id);
        }
        
        const formattedPosts = posts.map(post => {
            let tags = [];
            if (post.tag_data) {
                tags = post.tag_data.split('||').map(item => {
                    const [name, color] = item.split('::');
                    return { name, color: color || '#3498db' };
                });
            }
            
            const isAnonymous = post.is_anonymous === 1;
            
            return {
                id: post.id,
                postId: post.post_id,
                title: post.title,
                summary: escapeHtml(post.content.substring(0, 150).replace(/[#*`>\-\s]/g, ' ').trim()),
                viewCount: post.view_count,
                commentCount: post.comment_count,
                likeCount: post.like_count || 0,
                isPinned: post.is_pinned === 1,
                isAnonymous: isAnonymous,
                liked: likedPostIds.includes(post.id),
                createdAt: post.created_at,
                author: {
                    id: isAnonymous ? null : post.author_id,
                    name: isAnonymous ? '匿名工程师' : post.author_name,
                    role: isAnonymous ? null : post.author_role
                },
                tags: tags
            };
        });
        
        res.json({
            success: true,
            data: {
                posts: formattedPosts,
                pagination: { page, pageSize, total, totalPages }
            }
        });
    } catch (error) {
        console.error('获取帖子列表错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * GET /api/forum/posts/my
 * 获取我的帖子 - 支持搜索和分页，返回 is_anonymous 状态
 */
router.get('/posts/my', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const keyword = (req.query.keyword || '').trim();
    const offset = (page - 1) * limit;
    
    try {
        let whereClause = 'p.author_id = ? AND p.status = ?';
        const params = [userId, 'normal'];
        
        if (keyword) {
            whereClause += ' AND p.title LIKE ?';
            params.push(`%${keyword}%`);
        }
        
        const [posts] = await pool.query(
            `SELECT 
                p.id, p.post_id, p.title, p.content, p.view_count, p.comment_count,
                p.is_anonymous, p.created_at, p.updated_at, p.status
            FROM forum_posts p
            WHERE ${whereClause}
            ORDER BY p.created_at DESC
            LIMIT ${limit} OFFSET ${offset}`,
            params
        );
        
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM forum_posts p WHERE ${whereClause}`,
            params
        );
        
        const total = countResult[0].total;
        
        const formattedPosts = posts.map(post => ({
            id: post.id,
            postId: post.post_id,
            title: post.title,
            summary: post.content.substring(0, 150).replace(/[#*`>\-\s]/g, ' ').trim(),
            viewCount: post.view_count,
            commentCount: post.comment_count,
            isAnonymous: post.is_anonymous === 1,
            status: post.status,
            createdAt: post.created_at,
            updatedAt: post.updated_at
        }));
        
        res.json({
            success: true,
            data: formattedPosts,
            total: total,
            page: page,
            limit: limit
        });
    } catch (error) {
        console.error('获取我的帖子错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * GET /api/forum/posts/:id
 * 获取单个帖子详情
 */
router.get('/posts/:id', async (req, res) => {
    const postId = req.params.id;
    const commentPage = parseInt(req.query.commentPage) || 1;
    const commentPageSize = Math.min(parseInt(req.query.commentPageSize) || 20, 50);
    const skipViewCount = req.query.skipViewCount === '1';
    
    try {
        const [posts] = await pool.execute(
            `SELECT 
                p.*, 
                u.id as author_id, u.username as author_name, u.role as author_role
            FROM forum_posts p
            LEFT JOIN users u ON p.author_id = u.id
            WHERE (p.id = ? OR p.post_id = ?) AND p.status = 'normal'`,
            [postId, postId]
        );
        
        if (posts.length === 0) {
            return res.status(404).json({ success: false, message: '帖子不存在' });
        }
        
        const post = posts[0];
        
        if (!skipViewCount) {
            await pool.execute(
                `UPDATE forum_posts SET view_count = view_count + 1 WHERE id = ?`,
                [post.id]
            );
        }
        
        const [tags] = await pool.execute(
            `SELECT t.id, t.name, t.color 
            FROM forum_tags t
            JOIN forum_post_tags pt ON t.id = pt.tag_id
            WHERE pt.post_id = ?`,
            [post.id]
        );
        
        let attachments = [];
        try {
            [attachments] = await pool.execute(
                `SELECT id, file_name, file_path, file_size, file_type, download_count, mime_type
                FROM forum_attachments 
                WHERE post_id = ?`,
                [post.id]
            );
        } catch (attError) {
            console.warn('获取附件失败，可能表不存在:', attError.message);
        }
        
        // 评论分页
        const commentOffset = (commentPage - 1) * commentPageSize;
        const [comments] = await pool.query(
            `SELECT 
                c.id, c.comment_id, c.content, c.parent_id, c.is_anonymous, c.created_at,
                u.id as author_id, u.username as author_name, u.role as author_role
            FROM forum_comments c
            LEFT JOIN users u ON c.author_id = u.id
            WHERE c.post_id = ? AND c.status = 'normal'
            ORDER BY c.created_at ASC
            LIMIT ${commentPageSize} OFFSET ${commentOffset}`,
            [post.id]
        );
        
        const [commentCount] = await pool.execute(
            `SELECT COUNT(*) as total FROM forum_comments WHERE post_id = ? AND status = 'normal'`,
            [post.id]
        );
        
        const commentMap = {};
        const rootComments = [];
        
        comments.forEach(comment => {
            const isAnonymous = comment.is_anonymous === 1;
            commentMap[comment.id] = {
                id: comment.id,
                commentId: comment.comment_id,
                content: comment.content,
                parentId: comment.parent_id,
                isAnonymous: isAnonymous,
                createdAt: comment.created_at,
                author: {
                    id: isAnonymous ? null : comment.author_id,
                    name: isAnonymous ? '匿名工程师' : comment.author_name,
                    role: isAnonymous ? null : comment.author_role
                },
                replies: []
            };
        });
        
        comments.forEach(comment => {
            if (comment.parent_id && commentMap[comment.parent_id]) {
                commentMap[comment.parent_id].replies.push(commentMap[comment.id]);
            } else if (!comment.parent_id) {
                rootComments.push(commentMap[comment.id]);
            }
        });
        
        const postIsAnonymous = post.is_anonymous === 1;
        
        // 检查当前用户是否点赞了该帖子
        let liked = false;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'xtest-secret-key-2024');
                const userId = decoded.id || decoded.userId;
                
                if (userId) {
                    const [likeResult] = await pool.execute(
                        `SELECT id FROM forum_likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?`,
                        [userId, post.id]
                    );
                    liked = likeResult.length > 0;
                }
            } catch (e) {
                // Token 无效或过期，忽略
            }
        }
        
        res.json({
            success: true,
            data: {
                post: {
                    id: post.id,
                    postId: post.post_id,
                    title: post.title,
                    content: post.content,
                    viewCount: post.view_count,
                    likeCount: post.like_count || 0,
                    commentCount: post.comment_count,
                    isPinned: post.is_pinned === 1,
                    isLocked: post.is_locked === 1,
                    isAnonymous: postIsAnonymous,
                    liked: liked,
                    createdAt: post.created_at,
                    updatedAt: post.updated_at,
                    author: {
                        id: postIsAnonymous ? null : post.author_id,
                        name: postIsAnonymous ? '匿名工程师' : post.author_name,
                        role: postIsAnonymous ? null : post.author_role
                    },
                    tags: tags,
                    attachments: attachments
                },
                comments: rootComments,
                commentPagination: {
                    page: commentPage,
                    pageSize: commentPageSize,
                    total: commentCount[0].total,
                    totalPages: Math.ceil(commentCount[0].total / commentPageSize)
                }
            }
        });
    } catch (error) {
        console.error('获取帖子详情错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * PUT /api/forum/posts/:id
 * 更新帖子 - 同步更新标签和附件
 */
router.put('/posts/:id', authenticateToken, async (req, res) => {
    const postId = req.params.id;
    const { title, content, tags, newAttachmentIds, deletedAttachmentIds, isAnonymous } = req.body;
    const userId = req.user.id;
    
    if (!title || !title.trim()) {
        return res.json({ success: false, message: '帖子标题不能为空' });
    }
    if (!content || !content.trim()) {
        return res.json({ success: false, message: '帖子内容不能为空' });
    }
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const [posts] = await connection.execute(
            `SELECT id, author_id FROM forum_posts WHERE id = ? OR post_id = ?`,
            [postId, postId]
        );
        
        if (posts.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '帖子不存在' });
        }
        
        const actualPostId = posts[0].id;
        const isOwner = posts[0].author_id === userId;
        const isAdmin = ROLES.isAdmin(req.user.role);
        
        if (!isOwner && !isAdmin) {
            await connection.rollback();
            return res.json({ success: false, message: '无权编辑此帖子' });
        }
        
        const isAnonymousFlag = isAnonymous ? 1 : 0;
        await connection.execute(
            `UPDATE forum_posts SET title = ?, content = ?, is_anonymous = ?, updated_at = NOW() WHERE id = ?`,
            [title.trim(), content, isAnonymousFlag, actualPostId]
        );
        
        if (deletedAttachmentIds && Array.isArray(deletedAttachmentIds) && deletedAttachmentIds.length > 0) {
            for (const attId of deletedAttachmentIds) {
                await connection.execute(
                    `DELETE FROM forum_attachments WHERE id = ? AND post_id = ?`,
                    [attId, actualPostId]
                );
            }
            console.log(`[论坛] 删除附件: ${deletedAttachmentIds.join(', ')}`);
        }
        
        if (newAttachmentIds && Array.isArray(newAttachmentIds) && newAttachmentIds.length > 0) {
            for (const attId of newAttachmentIds) {
                await connection.execute(
                    `UPDATE forum_attachments SET post_id = ? WHERE id = ?`,
                    [actualPostId, attId]
                );
            }
            console.log(`[论坛] 关联新附件: ${newAttachmentIds.join(', ')}`);
        }
        
        if (tags !== undefined && Array.isArray(tags)) {
            const [oldTags] = await connection.execute(
                `SELECT tag_id FROM forum_post_tags WHERE post_id = ?`,
                [actualPostId]
            );
            
            for (const oldTag of oldTags) {
                await connection.execute(
                    `UPDATE forum_tags SET post_count = GREATEST(post_count - 1, 0) WHERE id = ?`,
                    [oldTag.tag_id]
                );
            }
            
            await connection.execute(
                `DELETE FROM forum_post_tags WHERE post_id = ?`,
                [actualPostId]
            );
            
            for (const tagId of tags) {
                const [tagRows] = await connection.execute(
                    `SELECT id FROM forum_tags WHERE id = ?`,
                    [tagId]
                );
                
                if (tagRows.length > 0) {
                    await connection.execute(
                        `INSERT INTO forum_post_tags (post_id, tag_id) VALUES (?, ?)`,
                        [actualPostId, tagId]
                    );
                    await connection.execute(
                        `UPDATE forum_tags SET post_count = post_count + 1 WHERE id = ?`,
                        [tagId]
                    );
                }
            }
        }
        
        await connection.commit();
        
        console.log(`[论坛] 用户 ${req.user.username} 更新帖子: ${postId}`);
        
        res.json({ success: true, message: '帖子更新成功' });
    } catch (error) {
        await connection.rollback();
        console.error('更新帖子错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    } finally {
        connection.release();
    }
});

/**
 * DELETE /api/forum/posts/:id
 * 删除帖子 (软删除) - 同步更新标签计数
 */
router.delete('/posts/:id', authenticateToken, async (req, res) => {
    const postId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const [posts] = await connection.execute(
            `SELECT id, author_id FROM forum_posts WHERE id = ? OR post_id = ?`,
            [postId, postId]
        );
        
        if (posts.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '帖子不存在' });
        }
        
        if (posts[0].author_id !== userId && !ROLES.isAdmin(userRole)) {
            await connection.rollback();
            return res.json({ success: false, message: '无权删除此帖子' });
        }
        
        const actualPostId = posts[0].id;
        
        const [postTags] = await connection.execute(
            `SELECT tag_id FROM forum_post_tags WHERE post_id = ?`,
            [actualPostId]
        );
        
        for (const pt of postTags) {
            await connection.execute(
                `UPDATE forum_tags SET post_count = GREATEST(post_count - 1, 0) WHERE id = ?`,
                [pt.tag_id]
            );
        }
        
        await connection.execute(
            `DELETE FROM forum_post_tags WHERE post_id = ?`,
            [actualPostId]
        );
        
        await connection.execute(
            `UPDATE forum_posts SET status = 'deleted' WHERE id = ?`,
            [actualPostId]
        );
        
        await connection.commit();
        
        console.log(`[论坛] 用户 ${req.user.username} 删除帖子: ${postId}`);
        
        res.json({ success: true, message: '帖子已删除' });
    } catch (error) {
        await connection.rollback();
        console.error('删除帖子错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    } finally {
        connection.release();
    }
});

/**
 * POST /api/forum/comments
 * 发表评论 - 支持匿名发布
 */
router.post('/comments', authenticateToken, checkMuted, async (req, res) => {
    const { postId, content, parentId, replyToId, isAnonymous } = req.body;
    const authorId = req.user.id;
    const isAnonymousFlag = isAnonymous ? 1 : 0;
    
    if (!postId) {
        return res.json({ success: false, message: '帖子ID不能为空' });
    }
    if (!content || !content.trim()) {
        return res.json({ success: false, message: '评论内容不能为空' });
    }
    if (content.length > 2000) {
        return res.json({ success: false, message: '评论内容不能超过2000个字符' });
    }
    
    try {
        const [posts] = await pool.execute(
            `SELECT id, is_locked FROM forum_posts WHERE id = ? OR post_id = ?`,
            [postId, postId]
        );
        
        if (posts.length === 0) {
            return res.json({ success: false, message: '帖子不存在' });
        }
        
        if (posts[0].is_locked === 1) {
            return res.json({ success: false, message: '帖子已锁定，无法评论' });
        }
        
        const actualPostId = posts[0].id;
        const commentId = generateId('CMT');
        const actualReplyToId = replyToId || parentId || null;
        
        const [result] = await pool.execute(
            `INSERT INTO forum_comments (comment_id, post_id, author_id, is_anonymous, parent_id, reply_to_id, content, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [commentId, actualPostId, authorId, isAnonymousFlag, parentId || null, actualReplyToId, content.trim()]
        );
        
        await pool.execute(
            `UPDATE forum_posts SET comment_count = comment_count + 1 WHERE id = ?`,
            [actualPostId]
        );
        
        console.log(`[论坛] 用户 ${req.user.username} 发表评论: ${commentId}${isAnonymousFlag ? ' (匿名)' : ''}`);

        // 异步触发通知
        try {
            // 1. 处理 @ 提及
            notificationService.processMentions(content, authorId, actualPostId, `/forum/post/${postId}`, 'comment').catch(e => console.error(e));

            // 2. 如果这篇帖子不是匿名发布的，通知原帖作者
            const [originalPosts] = await pool.execute('SELECT author_id, is_anonymous, title FROM forum_posts WHERE id = ?', [actualPostId]);
            if (originalPosts.length > 0) {
                const op = originalPosts[0];
                if (op.is_anonymous !== 1) { // 只有非匿名帖子才发被互动通知
                    const preview = notificationService.generatePreview(content);
                    notificationService.notifyInteraction(op.author_id, authorId, 'comment', actualPostId, preview, `/forum/post/${postId}`).catch(e => console.error(e));
                }
            }
        } catch (notifErr) {
            console.error('触发评论通知时出错', notifErr);
        }
        
        res.json({
            success: true,
            message: '评论发表成功',
            data: { id: result.insertId, commentId: commentId, isAnonymous: isAnonymousFlag === 1 }
        });
    } catch (error) {
        console.error('发表评论错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * DELETE /api/forum/comments/:id
 * 删除评论 - 级联更新子评论
 */
router.delete('/comments/:id', authenticateToken, async (req, res) => {
    const commentId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const [comments] = await connection.execute(
            `SELECT id, author_id, post_id FROM forum_comments WHERE id = ?`,
            [commentId]
        );
        
        if (comments.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '评论不存在' });
        }
        
        if (comments[0].author_id !== userId && !ROLES.isAdmin(userRole)) {
            await connection.rollback();
            return res.json({ success: false, message: '无权删除此评论' });
        }
        
        const postId = comments[0].post_id;
        
        // 获取所有子评论
        const [childComments] = await connection.execute(
            `SELECT id FROM forum_comments WHERE parent_id = ? AND status = 'normal'`,
            [commentId]
        );
        
        const totalDeleted = 1 + childComments.length;
        
        // 软删除当前评论
        await connection.execute(
            `UPDATE forum_comments SET status = 'deleted' WHERE id = ?`,
            [commentId]
        );
        
        // 软删除所有子评论
        if (childComments.length > 0) {
            await connection.execute(
                `UPDATE forum_comments SET status = 'deleted' WHERE parent_id = ?`,
                [commentId]
            );
        }
        
        // 更新帖子评论数
        await connection.execute(
            `UPDATE forum_posts SET comment_count = GREATEST(comment_count - ?, 0) WHERE id = ?`,
            [totalDeleted, postId]
        );
        
        await connection.commit();
        
        console.log(`[论坛] 用户 ${req.user.username} 删除评论: ${commentId}（包含 ${childComments.length} 条子评论）`);
        
        res.json({ success: true, message: `评论已删除（包含 ${childComments.length} 条子评论）` });
    } catch (error) {
        await connection.rollback();
        console.error('删除评论错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    } finally {
        connection.release();
    }
});

/**
 * GET /api/forum/comments/my
 * 获取我的评论 - 支持搜索和分页，返回 is_anonymous 状态
 */
router.get('/comments/my', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const keyword = (req.query.keyword || '').trim();
    const offset = (page - 1) * limit;
    
    try {
        let whereClause = 'c.author_id = ? AND c.status = ?';
        const params = [userId, 'normal'];
        
        if (keyword) {
            whereClause += ' AND c.content LIKE ?';
            params.push(`%${keyword}%`);
        }
        
        const [comments] = await pool.query(
            `SELECT 
                c.id, c.comment_id, c.content, c.is_anonymous, c.created_at, c.post_id,
                p.title as post_title
            FROM forum_comments c
            JOIN forum_posts p ON c.post_id = p.id
            WHERE ${whereClause}
            ORDER BY c.created_at DESC
            LIMIT ${limit} OFFSET ${offset}`,
            params
        );
        
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM forum_comments c WHERE ${whereClause}`,
            params
        );
        
        const total = countResult[0].total;
        
        const formattedComments = comments.map(comment => ({
            id: comment.id,
            commentId: comment.comment_id,
            content: comment.content,
            isAnonymous: comment.is_anonymous === 1,
            postId: comment.post_id,
            postTitle: comment.post_title,
            createdAt: comment.created_at
        }));
        
        res.json({
            success: true,
            data: formattedComments,
            total: total,
            page: page,
            limit: limit
        });
    } catch (error) {
        console.error('获取我的评论错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * GET /api/forum/recycle-bin
 * 获取回收站内容（已删除的帖子和评论）
 */
router.get('/recycle-bin', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    
    try {
        // 获取最近删除的10条帖子
        const [deletedPosts] = await pool.execute(
            `SELECT id, post_id, title, content, created_at, updated_at 
            FROM forum_posts 
            WHERE author_id = ? AND status = 'deleted' 
            ORDER BY updated_at DESC 
            LIMIT 10`,
            [userId]
        );
        
        // 获取最近删除的10条评论
        const [deletedComments] = await pool.execute(
            `SELECT c.id, c.comment_id, c.content, c.created_at, c.updated_at, c.post_id, p.title as post_title
            FROM forum_comments c
            LEFT JOIN forum_posts p ON c.post_id = p.id
            WHERE c.author_id = ? AND c.status = 'deleted' 
            ORDER BY c.updated_at DESC 
            LIMIT 10`,
            [userId]
        );
        
        res.json({
            success: true,
            data: {
                posts: deletedPosts.map(post => ({
                    id: post.id,
                    postId: post.post_id,
                    title: post.title,
                    contentPreview: post.content ? post.content.substring(0, 100) + '...' : '',
                    createdAt: post.created_at,
                    deletedAt: post.updated_at
                })),
                comments: deletedComments.map(comment => ({
                    id: comment.id,
                    commentId: comment.comment_id,
                    content: comment.content,
                    contentPreview: comment.content ? comment.content.substring(0, 50) + '...' : '',
                    postId: comment.post_id,
                    postTitle: comment.post_title,
                    createdAt: comment.created_at,
                    deletedAt: comment.updated_at
                }))
            }
        });
    } catch (error) {
        console.error('获取回收站错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * POST /api/forum/posts/:id/restore
 * 恢复已删除的帖子
 */
router.post('/posts/:id/restore', authenticateToken, async (req, res) => {
    const postId = req.params.id;
    const userId = req.user.id;
    
    try {
        // 检查帖子是否存在且属于当前用户
        const [posts] = await pool.execute(
            `SELECT id FROM forum_posts WHERE id = ? AND author_id = ? AND status = 'deleted'`,
            [postId, userId]
        );
        
        if (posts.length === 0) {
            return res.json({ success: false, message: '帖子不存在或无权恢复' });
        }
        
        // 恢复帖子
        await pool.execute(
            `UPDATE forum_posts SET status = 'normal', updated_at = NOW() WHERE id = ?`,
            [postId]
        );
        
        res.json({ success: true, message: '帖子已恢复' });
    } catch (error) {
        console.error('恢复帖子错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * POST /api/forum/comments/:id/restore
 * 恢复已删除的评论
 */
router.post('/comments/:id/restore', authenticateToken, async (req, res) => {
    const commentId = req.params.id;
    const userId = req.user.id;
    
    try {
        // 检查评论是否存在且属于当前用户
        const [comments] = await pool.execute(
            `SELECT id FROM forum_comments WHERE id = ? AND author_id = ? AND status = 'deleted'`,
            [commentId, userId]
        );
        
        if (comments.length === 0) {
            return res.json({ success: false, message: '评论不存在或无权恢复' });
        }
        
        // 恢复评论
        await pool.execute(
            `UPDATE forum_comments SET status = 'normal', updated_at = NOW() WHERE id = ?`,
            [commentId]
        );
        
        res.json({ success: true, message: '评论已恢复' });
    } catch (error) {
        console.error('恢复评论错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * GET /api/forum/tags
 * 获取标签列表 - 包含"全部"标签计数
 */
router.get('/tags', async (req, res) => {
    try {
        const [totalCount] = await pool.execute(
            `SELECT COUNT(*) as total FROM forum_posts WHERE status = 'normal'`
        );
        
        const [tags] = await pool.execute(
            `SELECT id, name, color, post_count FROM forum_tags ORDER BY post_count DESC`
        );
        
        const allTag = {
            id: 0,
            name: '全部',
            color: '#666666',
            post_count: totalCount[0].total
        };
        
        res.json({ success: true, data: [allTag, ...tags] });
    } catch (error) {
        console.error('获取标签列表错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * DELETE /api/forum/tags/:id
 * 删除标签（管理员）
 */
router.delete('/tags/:id', authenticateToken, async (req, res) => {
    const tagId = req.params.id;
    const userRole = req.user.role;
    
    if (!ROLES.isAdmin(userRole)) {
        return res.json({ success: false, message: '无权执行此操作' });
    }
    
    if (tagId == 0 || tagId == '0') {
        return res.json({ success: false, message: '不能删除"全部"标签' });
    }
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const [tags] = await connection.execute(
            `SELECT id, name FROM forum_tags WHERE id = ?`,
            [tagId]
        );
        
        if (tags.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '标签不存在' });
        }
        
        await connection.execute(
            `DELETE FROM forum_post_tags WHERE tag_id = ?`,
            [tagId]
        );
        
        await connection.execute(
            `DELETE FROM forum_tags WHERE id = ?`,
            [tagId]
        );
        
        await connection.commit();
        
        console.log(`[论坛] 管理员 ${req.user.username} 删除标签: ${tags[0].name}`);
        
        res.json({ success: true, message: '标签已删除' });
    } catch (error) {
        await connection.rollback();
        console.error('删除标签错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    } finally {
        connection.release();
    }
});



/**
 * PUT /api/forum/posts/:id/pin
 * 置顶/取消置顶帖子（管理员）
 */
router.put('/posts/:id/pin', authenticateToken, async (req, res) => {
    const postId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;
    const { pinned } = req.body;
    
    if (!ROLES.isAdmin(userRole)) {
        return res.json({ success: false, message: '无权执行此操作' });
    }
    
    try {
        const [posts] = await pool.execute(
            `SELECT id FROM forum_posts WHERE id = ? OR post_id = ?`,
            [postId, postId]
        );
        
        if (posts.length === 0) {
            return res.json({ success: false, message: '帖子不存在' });
        }
        
        await pool.execute(
            `UPDATE forum_posts SET is_pinned = ? WHERE id = ?`,
            [pinned ? 1 : 0, posts[0].id]
        );
        
        console.log(`[论坛] 管理员 ${req.user.username} ${pinned ? '置顶' : '取消置顶'}帖子: ${postId}`);
        
        res.json({ success: true, message: pinned ? '帖子已置顶' : '已取消置顶' });
    } catch (error) {
        console.error('置顶帖子错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * PUT /api/forum/posts/:id/lock
 * 锁定/解锁帖子（管理员）
 */
router.put('/posts/:id/lock', authenticateToken, async (req, res) => {
    const postId = req.params.id;
    const userRole = req.user.role;
    const { locked } = req.body;
    
    if (!ROLES.isAdmin(userRole)) {
        return res.json({ success: false, message: '无权执行此操作' });
    }
    
    try {
        const [posts] = await pool.execute(
            `SELECT id FROM forum_posts WHERE id = ? OR post_id = ?`,
            [postId, postId]
        );
        
        if (posts.length === 0) {
            return res.json({ success: false, message: '帖子不存在' });
        }
        
        await pool.execute(
            `UPDATE forum_posts SET is_locked = ? WHERE id = ?`,
            [locked ? 1 : 0, posts[0].id]
        );
        
        console.log(`[论坛] 管理员 ${req.user.username} ${locked ? '锁定' : '解锁'}帖子: ${postId}`);
        
        res.json({ success: true, message: locked ? '帖子已锁定' : '帖子已解锁' });
    } catch (error) {
        console.error('锁定帖子错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ==================== 新增中间件 ====================

/**
 * 管理员权限校验中间件
 * 验证当前用户是否拥有管理员权限
 */
const checkAdmin = (req, res, next) => {
    const userRole = req.user?.role;
    
    if (!ROLES.isAdmin(userRole)) {
        return res.status(403).json({ 
            success: false, 
            message: '权限不足，此操作需要管理员权限' 
        });
    }
    
    next();
};

// ==================== 点赞功能（增强版）====================

/**
 * POST /api/forum/posts/:id/like
 * 点赞/取消点赞帖子
 * 使用事务确保 forum_likes 与 like_count 同步
 */
router.post('/posts/:id/like', authenticateToken, async (req, res) => {
    const postId = req.params.id;
    const userId = req.user.id;
    
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const [posts] = await connection.execute(
            `SELECT id FROM forum_posts WHERE id = ? OR post_id = ?`,
            [postId, postId]
        );
        
        if (posts.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '帖子不存在' });
        }
        
        const actualPostId = posts[0].id;
        
        const [existingLikes] = await connection.execute(
            `SELECT id FROM forum_likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?`,
            [userId, actualPostId]
        );
        
        let liked;
        let likeCount;
        
        if (existingLikes.length > 0) {
            await connection.execute(
                `DELETE FROM forum_likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?`,
                [userId, actualPostId]
            );
            await connection.execute(
                `UPDATE forum_posts SET like_count = GREATEST(0, like_count - 1) WHERE id = ?`,
                [actualPostId]
            );
            liked = false;
        } else {
            await connection.execute(
                `INSERT INTO forum_likes (user_id, target_type, target_id, created_at) VALUES (?, 'post', ?, NOW())`,
                [userId, actualPostId]
            );
            await connection.execute(
                `UPDATE forum_posts SET like_count = like_count + 1 WHERE id = ?`,
                [actualPostId]
            );
            liked = true;
        }
        
        const [result] = await connection.execute(
            `SELECT like_count FROM forum_posts WHERE id = ?`,
            [actualPostId]
        );
        likeCount = result[0].like_count;
        
        await connection.commit();

        // 触发点赞通知 (仅在新增点赞时通知原帖作者且帖子非匿名)
        if (liked) {
            try {
                const [originalPosts] = await pool.execute('SELECT author_id, is_anonymous, post_id FROM forum_posts WHERE id = ?', [actualPostId]);
                if (originalPosts.length > 0) {
                    const op = originalPosts[0];
                    if (op.is_anonymous !== 1) { 
                        notificationService.notifyInteraction(op.author_id, userId, 'like', actualPostId, '', `/forum/post/${op.post_id}`).catch(e => console.error(e));
                    }
                }
            } catch (notifErr) {
                console.error('触发点赞通知时出错', notifErr);
            }
        }
        
        res.json({ 
            success: true, 
            message: liked ? '点赞成功' : '已取消点赞', 
            data: { liked, likeCount }
        });
    } catch (error) {
        await connection.rollback();
        console.error('点赞操作错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    } finally {
        connection.release();
    }
});

// ==================== 管理员操作 ====================

/**
 * POST /api/forum/users/:id/mute
 * 禁言用户（管理员）
 * @param {number} days - 禁言天数
 */
router.post('/users/:id/mute', authenticateToken, checkAdmin, async (req, res) => {
    const targetUserId = req.params.id;
    const { days } = req.body;
    const operatorId = req.user.id;
    
    if (!days || days < 1 || days > 365) {
        return res.json({ 
            success: false, 
            message: '禁言天数必须在 1-365 之间' 
        });
    }
    
    if (parseInt(targetUserId) === parseInt(operatorId)) {
        return res.json({ 
            success: false, 
            message: '不能对自己执行禁言操作' 
        });
    }
    
    try {
        const [users] = await pool.execute(
            `SELECT id, username, muted_until FROM users WHERE id = ?`,
            [targetUserId]
        );
        
        if (users.length === 0) {
            return res.json({ success: false, message: '用户不存在' });
        }
        
        const targetUser = users[0];
        
        const now = new Date();
        const currentMutedUntil = targetUser.muted_until ? new Date(targetUser.muted_until) : now;
        const baseTime = currentMutedUntil > now ? currentMutedUntil : now;
        const mutedUntil = new Date(baseTime.getTime() + days * 24 * 60 * 60 * 1000);
        
        await pool.execute(
            `UPDATE users SET muted_until = ? WHERE id = ?`,
            [mutedUntil, targetUserId]
        );
        
        console.log(`[论坛] 管理员 ${req.user.username} 禁言用户 ${targetUser.username} ${days} 天，至 ${mutedUntil.toLocaleString()}`);
        
        res.json({ 
            success: true, 
            message: `已禁言用户 ${days} 天`,
            data: { 
                mutedUntil: mutedUntil.toISOString(),
                days: days
            }
        });
    } catch (error) {
        console.error('禁言用户错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

/**
 * DELETE /api/forum/users/:id/mute
 * 解除禁言（管理员）
 */
router.delete('/users/:id/mute', authenticateToken, checkAdmin, async (req, res) => {
    const targetUserId = req.params.id;
    
    try {
        const [users] = await pool.execute(
            `SELECT id, username FROM users WHERE id = ?`,
            [targetUserId]
        );
        
        if (users.length === 0) {
            return res.json({ success: false, message: '用户不存在' });
        }
        
        await pool.execute(
            `UPDATE users SET muted_until = NULL WHERE id = ?`,
            [targetUserId]
        );
        
        console.log(`[论坛] 管理员 ${req.user.username} 解除用户 ${users[0].username} 的禁言`);
        
        res.json({ success: true, message: '已解除禁言' });
    } catch (error) {
        console.error('解除禁言错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

module.exports = router;
