const rateLimit = require('express-rate-limit');
const logger = require('./logger');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        success: false,
        message: '登录尝试次数过多，请15分钟后再试'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('登录速率限制触发', {
            ip: req.ip,
            path: req.path
        });
        res.status(429).json({
            success: false,
            message: '登录尝试次数过多，请15分钟后再试'
        });
    }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: {
        success: false,
        message: '请求过于频繁，请稍后再试'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('API速率限制触发', {
            ip: req.ip,
            userId: req.user ? req.user.id : 'anonymous',
            path: req.path
        });
        res.status(429).json({
            success: false,
            message: '请求过于频繁，请稍后再试'
        });
    }
});

const dashboardLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: {
        success: false,
        message: 'Dashboard请求过于频繁，请稍后再试'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('Dashboard速率限制触发', {
            ip: req.ip,
            userId: req.user ? req.user.id : 'anonymous',
            path: req.path
        });
        res.status(429).json({
            success: false,
            message: 'Dashboard请求过于频繁，请稍后再试'
        });
    }
});

const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: {
        success: false,
        message: '写操作过于频繁，请稍后再试'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('写操作速率限制触发', {
            ip: req.ip,
            userId: req.user ? req.user.id : 'anonymous',
            path: req.path
        });
        res.status(429).json({
            success: false,
            message: '写操作过于频繁，请稍后再试'
        });
    }
});

const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: {
        success: false,
        message: 'AI功能调用过于频繁，请稍后再试'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn('AI速率限制触发', {
            ip: req.ip,
            userId: req.user ? req.user.id : 'anonymous',
            path: req.path
        });
        res.status(429).json({
            success: false,
            message: 'AI功能调用过于频繁，请稍后再试'
        });
    }
});

module.exports = {
    loginLimiter,
    apiLimiter,
    dashboardLimiter,
    writeLimiter,
    aiLimiter
};
