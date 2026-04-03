const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');

router.get('/summary', authenticateToken, async (req, res) => {
    try {
        const currentUser = req.user;

        const [pendingExecutions] = await pool.execute(
            `SELECT COUNT(DISTINCT tpc.id) as count
             FROM test_plan_cases tpc
             JOIN test_plans tp ON tpc.plan_id = tp.id
             WHERE tpc.executor_id = ? AND tpc.status = 'pending'`,
            [currentUser.username]
        );

        const [pendingReviews] = await pool.execute(
            `SELECT COUNT(*) as count
             FROM test_cases tc
             INNER JOIN case_reviewers cr ON tc.id = cr.case_id
             WHERE cr.reviewer_id = ? 
               AND cr.status = 'pending'
               AND tc.review_status = 'pending'`,
            [currentUser.id]
        );

        const [expiringPlans] = await pool.execute(
            `SELECT COUNT(DISTINCT tp.id) as count
             FROM test_plans tp
             JOIN test_plan_cases tpc ON tp.id = tpc.plan_id
             WHERE tpc.executor_id = ? 
             AND tp.end_date IS NOT NULL 
             AND tp.end_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)
             AND tp.status = '进行中'`,
            [currentUser.username]
        );

        const [weeklyCompleted] = await pool.execute(
            `SELECT COUNT(*) as count
             FROM test_plan_cases
             WHERE executor_id = ? 
             AND status != 'pending'
             AND execution_time >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`,
            [currentUser.username]
        );

        const [dailyCompleted] = await pool.execute(
            `SELECT DATE(execution_time) as date, COUNT(*) as count
             FROM test_plan_cases
             WHERE executor_id = ?
             AND status != 'pending'
             AND execution_time >= DATE_SUB(CURDATE(), INTERVAL 5 DAY)
             GROUP BY DATE(execution_time)
             ORDER BY date ASC`,
            [currentUser.username]
        );

        const dates = [];
        const dailyCompletedData = [];
        for (let i = 4; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            dates.push(dateStr);
            
            const found = dailyCompleted.find(d => d.date.toISOString().split('T')[0] === dateStr);
            dailyCompletedData.push(found ? found.count : 0);
        }

        res.json({
            success: true,
            data: {
                pending_executions: pendingExecutions[0].count,
                pending_reviews: pendingReviews[0].count,
                expiring_plans: expiringPlans[0].count,
                weekly_completed: weeklyCompleted[0].count,
                trend_data: {
                    daily_completed: dailyCompletedData,
                    dates: dates
                }
            }
        });

    } catch (error) {
        console.error('获取工作台概览失败:', error);
        res.json({ success: false, message: '获取工作台概览失败: ' + error.message });
    }
});

router.get('/pending-reviews', authenticateToken, async (req, res) => {
    try {
        const { page = 1, pageSize = 10 } = req.query;
        const currentUser = req.user;
        const limit = parseInt(pageSize);
        const offset = (parseInt(page) - 1) * limit;

        const [cases] = await pool.execute(
            `SELECT 
                tc.id,
                tc.case_id,
                tc.name,
                tc.priority,
                tc.review_submitted_at,
                m.name as module_name,
                creator.username as submitter_name,
                cr.status as reviewer_status
             FROM test_cases tc
             INNER JOIN case_reviewers cr ON tc.id = cr.case_id
             LEFT JOIN modules m ON tc.module_id = m.id
             LEFT JOIN users creator ON tc.creator = creator.username
             WHERE cr.reviewer_id = ? 
               AND cr.status = 'pending'
               AND tc.review_status = 'pending'
             ORDER BY tc.review_submitted_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            [currentUser.id]
        );

        const [countRows] = await pool.execute(
            `SELECT COUNT(*) as total 
             FROM test_cases tc
             INNER JOIN case_reviewers cr ON tc.id = cr.case_id
             WHERE cr.reviewer_id = ? 
               AND cr.status = 'pending'
               AND tc.review_status = 'pending'`,
            [currentUser.id]
        );

        const total = countRows[0].total;
        const totalPages = Math.ceil(total / pageSize);

        const casesWithTimeAgo = cases.map(c => ({
            ...c,
            time_ago: getTimeAgo(c.review_submitted_at)
        }));

        res.json({
            success: true,
            data: {
                cases: casesWithTimeAgo,
                pagination: {
                    page: parseInt(page),
                    pageSize: parseInt(pageSize),
                    total: total,
                    totalPages: totalPages
                }
            }
        });

    } catch (error) {
        console.error('获取待评审列表失败:', error);
        res.json({ success: false, message: '获取待评审列表失败: ' + error.message });
    }
});

router.get('/pending-executions', authenticateToken, async (req, res) => {
    try {
        const { page = 1, pageSize = 10 } = req.query;
        const currentUser = req.user;
        const limit = parseInt(pageSize);
        const offset = (parseInt(page) - 1) * limit;

        const [cases] = await pool.execute(
            `SELECT 
                tc.id,
                tc.case_id,
                tc.name,
                tc.priority,
                tp.id as plan_id,
                tp.name as plan_name,
                tp.end_date,
                m.name as module_name,
                DATEDIFF(tp.end_date, CURDATE()) as days_remaining
             FROM test_plan_cases tpc
             JOIN test_cases tc ON tpc.case_id = tc.id
             JOIN test_plans tp ON tpc.plan_id = tp.id
             LEFT JOIN modules m ON tc.module_id = m.id
             WHERE tpc.executor_id = ? AND tpc.status = 'pending'
             ORDER BY tp.end_date ASC
             LIMIT ${limit} OFFSET ${offset}`,
            [currentUser.username]
        );

        const [countRows] = await pool.execute(
            `SELECT COUNT(*) as total 
             FROM test_plan_cases 
             WHERE executor_id = ? AND status = 'pending'`,
            [currentUser.username]
        );

        const total = countRows[0].total;
        const totalPages = Math.ceil(total / pageSize);

        res.json({
            success: true,
            data: {
                cases: cases,
                pagination: {
                    page: parseInt(page),
                    pageSize: parseInt(pageSize),
                    total: total,
                    totalPages: totalPages
                }
            }
        });

    } catch (error) {
        console.error('获取待执行列表失败:', error);
        res.json({ success: false, message: '获取待执行列表失败: ' + error.message });
    }
});

router.get('/my-plans', authenticateToken, async (req, res) => {
    try {
        const { page = 1, pageSize = 10, status = 'active' } = req.query;
        const currentUser = req.user;
        const limit = parseInt(pageSize);
        const offset = (parseInt(page) - 1) * limit;

        let statusCondition = '';
        if (status === 'active') {
            statusCondition = "AND tp.status = '进行中'";
        } else if (status === 'completed') {
            statusCondition = "AND tp.status = '已完成'";
        }

        const [plans] = await pool.execute(
            `SELECT 
                tp.id,
                tp.name,
                tp.status,
                tp.start_date,
                tp.end_date,
                tp.total_cases,
                tp.tested_cases,
                tp.pass_rate,
                DATEDIFF(tp.end_date, CURDATE()) as days_remaining,
                COUNT(DISTINCT tpc.id) as my_cases
             FROM test_plans tp
             JOIN test_plan_cases tpc ON tp.id = tpc.plan_id
             WHERE tpc.executor_id = ? ${statusCondition}
             GROUP BY tp.id
             ORDER BY tp.end_date ASC
             LIMIT ${limit} OFFSET ${offset}`,
            [currentUser.username]
        );

        const [countRows] = await pool.execute(
            `SELECT COUNT(DISTINCT tp.id) as total 
             FROM test_plans tp
             JOIN test_plan_cases tpc ON tp.id = tpc.plan_id
             WHERE tpc.executor_id = ? ${statusCondition}`,
            [currentUser.username]
        );

        const total = countRows[0].total;
        const totalPages = Math.ceil(total / pageSize);

        const plansWithProgress = plans.map(p => ({
            ...p,
            progress_percentage: p.total_cases > 0 ? Math.round((p.tested_cases / p.total_cases) * 100) : 0
        }));

        res.json({
            success: true,
            data: {
                plans: plansWithProgress,
                pagination: {
                    page: parseInt(page),
                    pageSize: parseInt(pageSize),
                    total: total,
                    totalPages: totalPages
                }
            }
        });

    } catch (error) {
        console.error('获取我的计划失败:', error);
        res.json({ success: false, message: '获取我的计划失败: ' + error.message });
    }
});

router.get('/recent-activities', authenticateToken, async (req, res) => {
    try {
        const { days = 7, limit = 20 } = req.query;
        const currentUser = req.user;

        const [activities] = await pool.execute(
            `SELECT 
                id,
                action,
                description,
                entity_type,
                entity_id,
                created_at
             FROM activity_logs
             WHERE user_id = ?
             AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY created_at DESC
             LIMIT ?`,
            [currentUser.id, parseInt(days), parseInt(limit)]
        );

        const activitiesWithTimeAgo = activities.map(a => ({
            ...a,
            time_ago: getTimeAgo(a.created_at)
        }));

        res.json({
            success: true,
            data: {
                activities: activitiesWithTimeAgo
            }
        });

    } catch (error) {
        console.error('获取最近活动失败:', error);
        res.json({ success: false, message: '获取最近活动失败: ' + error.message });
    }
});

function getTimeAgo(dateString) {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    
    return date.toLocaleDateString('zh-CN');
}

module.exports = router;
