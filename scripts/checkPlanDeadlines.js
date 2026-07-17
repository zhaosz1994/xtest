const pool = require('../db');
const emailNotificationService = require('../services/emailNotificationService');
const logger = require('../services/logger');

async function checkPlanDeadlines() {
    try {
        const [upcomingPlans] = await pool.execute(`
            SELECT tp.id, tp.name, tp.owner, tp.end_date, tp.tested_cases, tp.total_cases, tp.pass_rate,
                   DATEDIFF(tp.end_date, CURDATE()) as remaining_days,
                   u.id as owner_id
            FROM test_plans tp
            LEFT JOIN users u ON tp.owner = u.username
            WHERE tp.status IN ('进行中', 'in_progress', '未开始', 'not_started')
              AND tp.end_date IS NOT NULL
              AND DATEDIFF(tp.end_date, CURDATE()) IN (1, 3)
        `);

        for (const plan of upcomingPlans) {
            if (plan.owner_id) {
                const progressPercent = plan.total_cases > 0
                    ? Math.round((plan.tested_cases / plan.total_cases) * 100)
                    : 0;

                await emailNotificationService.send({
                    emailType: 'plan_deadline',
                    to: plan.owner_id,
                    data: {
                        planName: plan.name,
                        endDate: plan.end_date ? new Date(plan.end_date).toLocaleDateString('zh-CN') : '',
                        remainingDays: plan.remaining_days,
                        testedCases: plan.tested_cases || 0,
                        totalCases: plan.total_cases || 0,
                        progressPercent: progressPercent,
                        passRate: plan.pass_rate || 0,
                        planLink: `${process.env.APP_URL || 'http://localhost:3000'}/?action=view_plan&id=${plan.id}`
                    }
                });
            }
        }

        logger.info('计划到期检查完成', { upcomingCount: upcomingPlans.length });
        return upcomingPlans.length;
    } catch (error) {
        logger.error('计划到期检查失败:', { error: error.message });
        return 0;
    }
}

async function checkPlanProgress() {
    try {
        const [alertPlans] = await pool.execute(`
            SELECT tp.id, tp.name, tp.owner, tp.pass_rate, tp.tested_cases, tp.total_cases, tp.status,
                   DATEDIFF(tp.end_date, CURDATE()) as remaining_days,
                   u.id as owner_id
            FROM test_plans tp
            LEFT JOIN users u ON tp.owner = u.username
            WHERE tp.status IN ('进行中', 'in_progress')
        `);

        let alertCount = 0;
        for (const plan of alertPlans) {
            if (!plan.owner_id) continue;

            let alertReason = '';
            const passRate = plan.pass_rate || 0;
            const testedCases = plan.tested_cases || 0;
            const totalCases = plan.total_cases || 0;

            if (passRate < 70) {
                alertReason = `通过率过低（${passRate}%），低于70%阈值`;
            } else if (plan.remaining_days !== null && plan.remaining_days <= 3 && totalCases > 0 && (testedCases / totalCases) < 0.5) {
                alertReason = `距离截止日期仅剩${plan.remaining_days}天，但进度不足50%`;
            }

            if (alertReason) {
                alertCount++;
                await emailNotificationService.send({
                    emailType: 'plan_progress_alert',
                    to: plan.owner_id,
                    data: {
                        planName: plan.name,
                        passRate: passRate,
                        testedCases: testedCases,
                        totalCases: totalCases,
                        alertReason: alertReason,
                        planLink: `${process.env.APP_URL || 'http://localhost:3000'}/?action=view_plan&id=${plan.id}`
                    }
                });
            }
        }

        logger.info('计划进度预警检查完成', { alertCount });
        return alertCount;
    } catch (error) {
        logger.error('计划进度预警检查失败:', { error: error.message });
        return 0;
    }
}

async function run() {
    logger.info('开始执行计划检查定时任务');
    const deadlineCount = await checkPlanDeadlines();
    const progressCount = await checkPlanProgress();
    logger.info('计划检查定时任务执行完成', { deadlineCount, progressCount });
    return { deadlineCount, progressCount };
}

if (require.main === module) {
    run().then(result => {
        console.log('计划检查任务执行完成:', JSON.stringify(result));
        process.exit(0);
    }).catch(error => {
        console.error('计划检查任务失败:', error);
        process.exit(1);
    });
}

module.exports = { checkPlanDeadlines, checkPlanProgress, run };
