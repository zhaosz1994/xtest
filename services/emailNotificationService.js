const pool = require('../db');
const emailService = require('./emailService');
const logger = require('./logger');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const CATEGORY_NAMES = {
    social: '社区互动',
    business: '测试业务',
    approval: '审批流程',
    announcement: '系统公告',
    digest: '定期汇总'
};

const CATEGORY_ICONS = {
    social: '💬',
    business: '📋',
    approval: '✅',
    announcement: '📢',
    digest: '📊'
};

async function getEmailTypeConfig(typeCode) {
    const [rows] = await pool.execute(
        'SELECT * FROM email_types WHERE type_code = ? AND is_active = TRUE',
        [typeCode]
    );
    return rows.length > 0 ? rows[0] : null;
}

async function getUserNotificationPrefs(userId) {
    const [rows] = await pool.execute(
        'SELECT type_code, email_enabled, in_app_enabled FROM user_notification_prefs WHERE user_id = ?',
        [userId]
    );
    const prefs = {};
    rows.forEach(row => {
        prefs[row.type_code] = {
            emailEnabled: !!row.email_enabled,
            inAppEnabled: !!row.in_app_enabled
        };
    });
    return prefs;
}

async function getUserGlobalPrefs(userId) {
    const [rows] = await pool.execute(
        'SELECT email_global_enabled, email_quiet_hours_start, email_quiet_hours_end FROM users WHERE id = ?',
        [userId]
    );
    if (rows.length === 0) return null;
    return {
        emailGlobalEnabled: rows[0].email_global_enabled !== 0 && rows[0].email_global_enabled !== false,
        quietHoursStart: rows[0].email_quiet_hours_start,
        quietHoursEnd: rows[0].email_quiet_hours_end
    };
}

function isInQuietHours(startTime, endTime) {
    if (!startTime || !endTime) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
}

async function shouldSendEmail(userId, emailType, options = {}) {
    if (options.forceSend) {
        return { shouldSend: true, reason: 'force_send' };
    }
    const typeConfig = await getEmailTypeConfig(emailType);
    if (!typeConfig || !typeConfig.is_active) {
        return { shouldSend: false, reason: 'type_disabled' };
    }
    if (typeConfig.is_required) {
        return { shouldSend: true, reason: 'required_type' };
    }
    const [users] = await pool.execute(
        'SELECT id, email, status, email_global_enabled, email_quiet_hours_start, email_quiet_hours_end FROM users WHERE id = ?',
        [userId]
    );
    if (users.length === 0) return { shouldSend: false, reason: 'user_not_found' };
    const user = users[0];
    if (user.status !== 'active') return { shouldSend: false, reason: 'user_inactive' };
    if (!user.email) return { shouldSend: false, reason: 'no_email' };
    if (!user.email_global_enabled) return { shouldSend: false, reason: 'global_disabled' };
    const [prefs] = await pool.execute(
        'SELECT email_enabled FROM user_notification_prefs WHERE user_id = ? AND type_code = ?',
        [userId, emailType]
    );
    if (prefs.length > 0 && !prefs[0].email_enabled) {
        return { shouldSend: false, reason: 'type_disabled_by_user' };
    }
    if (isInQuietHours(user.email_quiet_hours_start, user.email_quiet_hours_end)) {
        if (emailType !== 'urgent' && typeConfig.category !== 'account') {
            return { shouldSend: false, reason: 'quiet_hours' };
        }
    }
    return { shouldSend: true, reason: 'normal' };
}

async function shouldSendInApp(userId, emailType) {
    const typeConfig = await getEmailTypeConfig(emailType);
    if (!typeConfig || !typeConfig.supports_in_app) return false;
    const [prefs] = await pool.execute(
        'SELECT in_app_enabled FROM user_notification_prefs WHERE user_id = ? AND type_code = ?',
        [userId, emailType]
    );
    if (prefs.length > 0 && !prefs[0].in_app_enabled) return false;
    return true;
}

function renderTemplate(templatePath, data) {
    const templates = getTemplateRenderers();
    const renderer = templates[templatePath];
    if (renderer) return renderer(data);
    return renderGenericTemplate(data);
}

function getTemplateRenderers() {
    return {
        case_review_submit: (d) => renderCaseReviewSubmit(d),
        case_review: (d) => renderCaseReview(d),
        plan_assigned: (d) => renderPlanAssigned(d),
        plan_status: (d) => renderPlanStatus(d),
        plan_deadline: (d) => renderPlanDeadline(d),
        plan_progress_alert: (d) => renderPlanProgressAlert(d),
        report_ready: (d) => renderReportReady(d),
        mention: (d) => renderMention(d),
        comment: (d) => renderComment(d),
        like: (d) => renderLike(d),
        user_audit: (d) => renderUserAudit(d),
        audit_result: (d) => renderAuditResult(d),
        role_change: (d) => renderRoleChange(d),
        defect_created: (d) => renderDefectCreated(d),
        defect_status: (d) => renderDefectStatus(d),
        task_assigned: (d) => renderTaskAssigned(d),
        task_deadline: (d) => renderTaskDeadline(d),
        ai_review_complete: (d) => renderAIReviewComplete(d),
        ai_review_result: (d) => renderAIReviewResult(d),
        ai_key_config_complete: (d) => renderAIKeyConfigComplete(d),
        ai_overview_complete: (d) => renderAIOverviewComplete(d)
    };
}

function emailBase(title, color) {
    return {
        header: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="border-bottom: 2px solid ${color}; padding-bottom: 15px; margin-bottom: 20px;"><h1 style="color: ${color}; font-size: 22px; margin: 0;">${title}</h1></div>`,
        footer: `<div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px; color: #999; font-size: 12px; text-align: center;"><p>此邮件由 xTest 测试管理系统自动发送</p><p>如不想接收此类邮件，请在<a href="${APP_URL}/settings/notifications" style="color: #007bff;">消息提醒设置</a>中关闭</p></div></div>`
    };
}

function infoBox(content, color = '#007bff') {
    return `<div style="background-color: #f5f5f5; padding: 15px; border-left: 4px solid ${color}; margin: 20px 0;">${content}</div>`;
}

function actionButton(text, url, color = '#007bff') {
    return `<div style="text-align: center; margin: 20px 0;"><a href="${url}" style="display: inline-block; padding: 12px 30px; background-color: ${color}; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">${text}</a></div>`;
}

function renderCaseReviewSubmit(d) {
    const base = emailBase('📋 测试用例评审通知', '#007bff');
    const casesHtml = d.caseList
        ? d.caseList.map(c => `<div style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>${c.caseName}</strong> <span style="color:#666;margin-left:10px;">${c.caseId || ''}</span> <span style="color:#999;margin-left:10px;">优先级：${c.priority || ''}</span></div>`).join('')
        : infoBox(`<h3 style="margin:0 0 10px;color:#333;">${d.caseName || ''}</h3><p style="margin:5px 0;"><strong>用例编号：</strong>${d.caseId || ''}</p><p style="margin:5px 0;"><strong>优先级：</strong>${d.priority || ''}</p><p style="margin:5px 0;"><strong>所属模块：</strong>${d.moduleName || ''}</p><p style="margin:5px 0;"><strong>提交时间：</strong>${d.submittedAt || ''}</p>${d.comment ? `<p style="margin:10px 0 0;"><strong>评审说明：</strong>${d.comment}</p>` : ''}`);
    return `${base.header}<p>尊敬的 <strong>${d.reviewerName || ''}</strong>，您好！</p><p><strong>${d.submitterName || ''}</strong> 提交了${d.caseList ? ` <strong>${d.caseCount}</strong> 个` : ''}测试用例，需要您进行评审。</p>${d.caseList ? `<div style="background-color:#f5f5f5;padding:15px;margin:20px 0;">${casesHtml}</div>` : casesHtml}<p>请尽快完成评审，如有疑问请联系提交人。</p>${actionButton(d.caseList ? '查看待评审列表' : '立即评审', d.reviewLink || d.reviewListLink || '#')}${base.footer}`;
}

function renderCaseReview(d) {
    const isApproved = d.result === '通过' || d.result === 'approved';
    const color = isApproved ? '#28a745' : '#dc3545';
    const icon = isApproved ? '✅' : '❌';
    const base = emailBase(`${icon} 测试用例评审${isApproved ? '通过' : '驳回'}`, color);
    const resultBox = isApproved
        ? infoBox(`<h3 style="margin:0 0 10px;color:#333;">${d.caseName || ''}</h3><p style="margin:5px 0;"><strong>用例编号：</strong>${d.caseId || ''}</p><p style="margin:5px 0;"><strong>评审人：</strong>${d.reviewerName || ''}</p><p style="margin:5px 0;"><strong>评审时间：</strong>${d.reviewedAt || ''}</p>${d.comment ? `<p style="margin:10px 0 0;"><strong>评审意见：</strong>${d.comment}</p>` : ''}`, '#28a745')
        : infoBox(`<h3 style="margin:0 0 10px;color:#333;">${d.caseName || ''}</h3><p style="margin:5px 0;"><strong>用例编号：</strong>${d.caseId || ''}</p><p style="margin:5px 0;"><strong>评审人：</strong>${d.reviewerName || ''}</p><p style="margin:5px 0;"><strong>评审时间：</strong>${d.reviewedAt || ''}</p>`, '#dc3545') +
          (d.comment ? `<div style="background-color:#fff3cd;padding:15px;border-left:4px solid #ffc107;margin:20px 0;"><h4 style="margin:0 0 10px;color:#856404;">驳回原因：</h4><p style="margin:0;">${d.comment}</p>${d.suggestion ? `<h4 style="margin:15px 0 10px;color:#856404;">修改建议：</h4><p style="margin:0;">${d.suggestion}</p>` : ''}</div>` : '');
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>您提交的测试用例${isApproved ? '已通过评审' : '未通过评审，请根据评审意见进行修改'}。</p>${resultBox}${isApproved ? '<p>用例已进入可用状态，可在测试计划中关联使用。</p>' : '<p>修改完成后可重新提交评审。</p>'}${actionButton(isApproved ? '查看用例详情' : '修改用例', d.caseLink || '#', color)}${base.footer}`;
}

function renderPlanAssigned(d) {
    const base = emailBase('📋 测试计划分配通知', '#007bff');
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>您被 <strong>${d.assignerName || ''}</strong> 分配了新的测试计划。</p>${infoBox(`<h3 style="margin:0 0 10px;color:#333;">${d.planName || ''}</h3><p style="margin:5px 0;"><strong>项目：</strong>${d.projectName || ''}</p>${d.iteration ? `<p style="margin:5px 0;"><strong>迭代：</strong>${d.iteration}</p>` : ''}<p style="margin:5px 0;"><strong>测试阶段：</strong>${d.testPhase || ''}</p><p style="margin:5px 0;"><strong>用例数量：</strong>${d.caseCount || 0} 个</p>${d.startDate ? `<p style="margin:5px 0;"><strong>开始日期：</strong>${d.startDate}</p>` : ''}${d.endDate ? `<p style="margin:5px 0;"><strong>截止日期：</strong>${d.endDate}</p>` : ''}${d.description ? `<p style="margin:10px 0 0;"><strong>计划描述：</strong>${d.description}</p>` : ''}`)}<p>请在截止日期前完成测试任务，如有疑问请联系计划创建者。</p>${actionButton('查看测试计划', d.planLink || '#')}${base.footer}`;
}

function renderPlanStatus(d) {
    const base = emailBase('📊 测试计划状态变更', '#17a2b8');
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>测试计划 <strong>${d.planName || ''}</strong> 的状态已变更。</p>${infoBox(`<p style="margin:5px 0;"><strong>原状态：</strong>${d.oldStatus || ''}</p><p style="margin:5px 0;"><strong>新状态：</strong><span style="color:#17a2b8;font-weight:bold;">${d.newStatus || ''}</span></p><p style="margin:5px 0;"><strong>变更时间：</strong>${d.changedAt || ''}</p>${d.changedBy ? `<p style="margin:5px 0;"><strong>操作人：</strong>${d.changedBy}</p>` : ''}`)}${actionButton('查看测试计划', d.planLink || '#')}${base.footer}`;
}

function renderPlanDeadline(d) {
    const base = emailBase('⏰ 测试计划即将到期提醒', '#ffc107');
    const progressPercent = d.progressPercent || 0;
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>您的测试计划即将到期，请关注进度。</p>${infoBox(`<h3 style="margin:0 0 10px;color:#856404;">${d.planName || ''}</h3><p style="margin:5px 0;"><strong>截止日期：</strong>${d.endDate || ''}</p><p style="margin:5px 0;"><strong>剩余天数：</strong><span style="color:#dc3545;font-weight:bold;">${d.remainingDays || 0} 天</span></p><p style="margin:5px 0;"><strong>当前进度：</strong>${d.testedCases || 0} / ${d.totalCases || 0}</p><div style="background-color:#e9ecef;height:20px;border-radius:10px;margin:10px 0;"><div style="background-color:#28a745;height:100%;border-radius:10px;width:${progressPercent}%;"></div></div><p style="margin:5px 0;"><strong>通过率：</strong>${d.passRate || 0}%</p>`, '#ffc107')}<p>请合理安排时间，确保按时完成测试任务。</p>${actionButton('查看测试计划', d.planLink || '#', '#ffc107')}${base.footer}`;
}

function renderPlanProgressAlert(d) {
    const base = emailBase('⚠️ 测试计划进度预警', '#dc3545');
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>测试计划 <strong>${d.planName || ''}</strong> 的进度存在异常，请及时关注。</p>${infoBox(`<h3 style="margin:0 0 10px;color:#333;">${d.planName || ''}</h3><p style="margin:5px 0;"><strong>通过率：</strong>${d.passRate || 0}%</p><p style="margin:5px 0;"><strong>当前进度：</strong>${d.testedCases || 0} / ${d.totalCases || 0}</p><p style="margin:10px 0 0;color:#dc3545;"><strong>预警原因：</strong>${d.alertReason || ''}</p>`, '#dc3545')}<p>请尽快处理，避免影响项目进度。</p>${actionButton('查看测试计划', d.planLink || '#', '#dc3545')}${base.footer}`;
}

function renderReportReady(d) {
    const base = emailBase('📄 测试报告已生成', '#28a745');
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>您的测试报告 <strong>${d.reportName || ''}</strong> 已生成完成。</p>${actionButton('查看报告', d.reportLink || '#', '#28a745')}${base.footer}`;
}

function renderMention(d) {
    const base = emailBase('💬 你在讨论中被提及啦！', '#007bff');
    return `${base.header}<p><strong>${d.senderName || ''}</strong> 在论坛中@了你。</p>${d.preview ? infoBox(d.preview) : ''}${actionButton('点击查看详情', d.sourceUrl || '#')}${base.footer}`;
}

function renderComment(d) {
    const base = emailBase('💬 新的互动通知', '#28a745');
    return `${base.header}<p><strong>${d.senderName || ''}</strong> 评论了您的帖子。</p>${d.preview ? infoBox(d.preview, '#28a745') : ''}${actionButton('点击查看详情', d.sourceUrl || '#', '#28a745')}${base.footer}`;
}

function renderLike(d) {
    const base = emailBase('👍 新的互动通知', '#6f42c1');
    return `${base.header}<p><strong>${d.senderName || ''}</strong> 赞了您的帖子。</p>${d.preview ? infoBox(d.preview, '#6f42c1') : ''}${actionButton('点击查看详情', d.sourceUrl || '#', '#6f42c1')}${base.footer}`;
}

function renderUserAudit(d) {
    const base = emailBase('👥 新用户注册待审核', '#fd7e14');
    return `${base.header}<p>有新用户注册等待审核。</p>${infoBox(`<p style="margin:5px 0;"><strong>用户名：</strong>${d.newUsername || ''}</p><p style="margin:5px 0;"><strong>注册时间：</strong>${d.registerTime || ''}</p><p style="margin:5px 0;"><strong>邮箱：</strong>${d.email || ''}</p>`, '#fd7e14')}${actionButton('前往审核', `${APP_URL}/?action=users_config`, '#fd7e14')}${base.footer}`;
}

function renderAuditResult(d) {
    const isApproved = d.approved === true || d.approved === 1;
    const color = isApproved ? '#28a745' : '#dc3545';
    const base = emailBase(`${isApproved ? '✅' : '❌'} 账号审核结果`, color);
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>您的账号审核${isApproved ? '已通过' : '未通过'}。</p>${d.comment ? infoBox(`<p><strong>审核意见：</strong>${d.comment}</p>`, color) : ''}${isApproved ? actionButton('立即登录', APP_URL, color) : ''}${base.footer}`;
}

function renderRoleChange(d) {
    const base = emailBase('🔐 角色权限变更通知', '#6f42c1');
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>您的角色权限已变更。</p>${infoBox(`<p style="margin:5px 0;"><strong>原角色：</strong>${d.oldRole || ''}</p><p style="margin:5px 0;"><strong>新角色：</strong><span style="color:#6f42c1;font-weight:bold;">${d.newRole || ''}</span></p>`, '#6f42c1')}${base.footer}`;
}

function renderDefectCreated(d) {
    const base = emailBase('🐛 新缺陷记录', '#dc3545');
    return `${base.header}<p>有新的缺陷被记录。</p>${infoBox(`<h3 style="margin:0 0 10px;color:#333;">${d.defectTitle || ''}</h3><p style="margin:5px 0;"><strong>创建人：</strong>${d.creatorName || ''}</p><p style="margin:5px 0;"><strong>创建时间：</strong>${d.createdAt || ''}</p>${d.description ? `<p style="margin:10px 0 0;"><strong>描述：</strong>${d.description}</p>` : ''}`, '#dc3545')}${d.defectLink ? actionButton('查看缺陷详情', d.defectLink, '#dc3545') : ''}${base.footer}`;
}

function renderDefectStatus(d) {
    const base = emailBase('🐛 缺陷状态更新', '#17a2b8');
    return `${base.header}<p>缺陷 <strong>${d.defectTitle || ''}</strong> 的状态已更新。</p>${infoBox(`<p style="margin:5px 0;"><strong>原状态：</strong>${d.oldStatus || ''}</p><p style="margin:5px 0;"><strong>新状态：</strong><span style="color:#17a2b8;font-weight:bold;">${d.newStatus || ''}</span></p><p style="margin:5px 0;"><strong>更新人：</strong>${d.changedBy || ''}</p>`, '#17a2b8')}${d.defectLink ? actionButton('查看缺陷详情', d.defectLink, '#17a2b8') : ''}${base.footer}`;
}

function renderTaskAssigned(d) {
    const base = emailBase('📝 新任务分配通知', '#007bff');
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>您被分配了新的任务。</p>${infoBox(`<h3 style="margin:0 0 10px;color:#333;">${d.taskTitle || ''}</h3>${d.description ? `<p style="margin:5px 0;"><strong>描述：</strong>${d.description}</p>` : ''}${d.dueDate ? `<p style="margin:5px 0;"><strong>截止日期：</strong>${d.dueDate}</p>` : ''}<p style="margin:5px 0;"><strong>分配人：</strong>${d.assignerName || ''}</p>`, '#007bff')}${d.taskLink ? actionButton('查看任务详情', d.taskLink) : ''}${base.footer}`;
}

function renderTaskDeadline(d) {
    const base = emailBase('⏰ 任务即将到期提醒', '#ffc107');
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>您的任务即将到期，请关注进度。</p>${infoBox(`<h3 style="margin:0 0 10px;color:#856404;">${d.taskTitle || ''}</h3><p style="margin:5px 0;"><strong>截止日期：</strong>${d.dueDate || ''}</p><p style="margin:5px 0;"><strong>剩余天数：</strong><span style="color:#dc3545;font-weight:bold;">${d.remainingDays || 0} 天</span></p>`, '#ffc107')}${d.taskLink ? actionButton('查看任务详情', d.taskLink, '#ffc107') : ''}${base.footer}`;
}

function renderGenericTemplate(d) {
    const base = emailBase('📢 系统通知', '#007bff');
    return `${base.header}<p>尊敬的用户，您好！</p><p>您有一条新的通知。</p>${d.content ? infoBox(d.content) : ''}${base.footer}`;
}

function renderAIReviewComplete(d) {
    const base = emailBase('🤖 AI辅助评审完成', '#6366f1');
    const statsHtml = `<div style="display:flex;gap:12px;margin:15px 0;">
        <div style="flex:1;text-align:center;padding:10px;background:#f0fdf4;border-radius:6px;"><div style="font-size:24px;font-weight:bold;color:#16a34a;">${d.approvedCount || 0}</div><div style="font-size:12px;color:#666;">通过</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:#fef2f2;border-radius:6px;"><div style="font-size:24px;font-weight:bold;color:#dc2626;">${d.rejectedCount || 0}</div><div style="font-size:12px;color:#666;">拒绝</div></div>
        <div style="flex:1;text-align:center;padding:10px;background:#fffbeb;border-radius:6px;"><div style="font-size:24px;font-weight:bold;color:#d97706;">${d.modifiedCount || 0}</div><div style="font-size:12px;color:#666;">建议修改</div></div>
    </div>`;
    const memoryNote = d.memoryContribution ? `<p style="color:#6366f1;font-size:13px;">💾 ${d.memoryContribution}</p>` : '';
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>AI辅助评审任务已完成，以下是评审摘要：</p>${infoBox(`<h3 style="margin:0 0 10px;color:#4338ca;">${d.taskName || 'AI评审任务'}</h3><p style="margin:5px 0;"><strong>评审智能体：</strong>${d.agentName || ''}</p><p style="margin:5px 0;"><strong>用例总数：</strong>${d.totalCases || 0}</p><p style="margin:5px 0;"><strong>完成时间：</strong>${d.completedAt || ''}</p>`)}${statsHtml}${memoryNote}${d.reviewLink ? actionButton('查看评审结果', d.reviewLink, '#6366f1') : ''}${base.footer}`;
}

function renderAIReviewResult(d) {
    const base = emailBase('🤖 AI评审结果通知', '#6366f1');
    const actionLabel = { approve: '✅ 通过', reject: '❌ 拒绝', modify: '✏️ 建议修改' }[d.action] || d.action;
    const actionColor = { approve: '#16a34a', reject: '#dc2626', modify: '#d97706' }[d.action] || '#6366f1';
    const diffHtml = d.diffSummary ? `<div style="background:#f8f9fa;padding:10px;border-radius:4px;margin:10px 0;font-size:13px;"><strong>修改摘要：</strong>${d.diffSummary}</div>` : '';
    const memoryNote = d.memoryContribution ? `<p style="color:#6366f1;font-size:13px;">💾 ${d.memoryContribution}</p>` : '';
    return `${base.header}<p>尊敬的 <strong>${d.reviewerName || ''}</strong>，您好！</p><p>AI评审智能体 <strong>${d.agentName || ''}</strong> 已完成对以下用例的评审：</p>${infoBox(`<h3 style="margin:0 0 10px;color:#4338ca;">${d.caseName || ''}</h3><p style="margin:5px 0;"><strong>AI评审动作：</strong><span style="color:${actionColor};font-weight:bold;">${actionLabel}</span></p><p style="margin:5px 0;"><strong>AI评分：</strong>${d.aiScore || '-'}/10</p>${d.aiComment ? `<p style="margin:5px 0;"><strong>AI意见：</strong>${d.aiComment}</p>` : ''}`)}${diffHtml}${memoryNote}${d.reviewLink ? actionButton('查看详情并决策', d.reviewLink, '#6366f1') : ''}${base.footer}`;
}

function renderAIKeyConfigComplete(d) {
    const base = emailBase('🤖 AI关键配置生成完成', '#6366f1');
    const resultPreview = d.result ? `<div style="background:#f8f9fa;padding:12px;border-radius:6px;margin:15px 0;font-size:13px;white-space:pre-wrap;max-height:200px;overflow-y:auto;">${d.result.substring(0, 500)}${d.result.length > 500 ? '...' : ''}</div>` : '';
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>AI关键配置生成任务已完成：</p>${infoBox(`<h3 style="margin:0 0 10px;color:#4338ca;">${d.caseName || '未命名用例'}</h3><p style="margin:5px 0;"><strong>生成状态：</strong><span style="color:#16a34a;font-weight:bold;">✅ 成功</span></p>`)}${resultPreview}<p>请在消息中心查看完整结果，或返回用例编辑页面查看已自动填入的配置。</p>${base.footer}`;
}

function renderAIOverviewComplete(d) {
    const base = emailBase('🤖 AI概述生成完成', '#6366f1');
    const resultPreview = d.result ? `<div style="background:#f8f9fa;padding:12px;border-radius:6px;margin:15px 0;font-size:13px;white-space:pre-wrap;max-height:200px;overflow-y:auto;">${d.result.substring(0, 500)}${d.result.length > 500 ? '...' : ''}</div>` : '';
    return `${base.header}<p>尊敬的 <strong>${d.userName || ''}</strong>，您好！</p><p>AI概述生成任务已完成：</p>${infoBox(`<h3 style="margin:0 0 10px;color:#4338ca;">${d.pointName || '未命名测试点'}</h3><p style="margin:5px 0;"><strong>生成状态：</strong><span style="color:#16a34a;font-weight:bold;">✅ 成功</span></p>`)}${resultPreview}<p>请在消息中心查看完整结果，或返回测试点编辑页面查看已自动填入的概述。</p>${base.footer}`;
}

async function sendToSingleUser(emailType, userId, data, options = {}) {
    const [users] = await pool.execute(
        'SELECT id, email, username FROM users WHERE id = ?',
        [userId]
    );
    if (users.length === 0) {
        return { userId, status: 'skipped', reason: 'user_not_found' };
    }
    const user = users[0];
    const check = await shouldSendEmail(userId, emailType, options);
    if (!check.shouldSend) {
        return { userId, email: user.email, status: 'skipped', reason: check.reason };
    }
    const typeConfig = await getEmailTypeConfig(emailType);
    if (!typeConfig) {
        return { userId, status: 'failed', reason: 'type_not_found' };
    }
    const templateData = { ...data, userName: data.userName || user.username, preferenceLink: `${APP_URL}/settings/notifications` };
    const html = renderTemplate(typeConfig.template_path, templateData);
    let subject = typeConfig.template_subject || '【xTest】系统通知';
    Object.keys(templateData).forEach(key => {
        subject = subject.replace(new RegExp(`\\{${key}\\}`, 'g'), templateData[key] || '');
    });
    try {
        const result = await emailService.sendEmail({
            to: user.email,
            subject: subject,
            html: html,
            emailType: emailType
        });
        return { userId, email: user.email, status: result.success ? 'sent' : 'failed', reason: result.success ? null : result.message };
    } catch (error) {
        logger.error('邮件发送失败:', { error: error.message, emailType, userId });
        return { userId, email: user.email, status: 'failed', reason: error.message };
    }
}

async function createInAppNotification(userId, emailType, data, typeConfig) {
    if (!typeConfig || !typeConfig.supports_in_app) return;
    const shouldInApp = await shouldSendInApp(userId, emailType);
    if (!shouldInApp) return;
    let title = typeConfig.type_name || '系统通知';
    if (data.caseName) title = `${typeConfig.type_name} - ${data.caseName}`;
    else if (data.planName) title = `${typeConfig.type_name} - ${data.planName}`;
    else if (data.defectTitle) title = `${typeConfig.type_name} - ${data.defectTitle}`;
    else if (data.taskTitle) title = `${typeConfig.type_name} - ${data.taskTitle}`;
    else if (data.newUsername) title = `${typeConfig.type_name} - ${data.newUsername}`;
    const content = data.comment || data.description || data.alertReason || '';
    const preview = content.length > 100 ? content.substring(0, 100) + '...' : content;
    let targetId = null;
    if (data.caseId || data.planId) targetId = data.caseId || data.planId;
    await pool.execute(
        `INSERT INTO notifications (user_id, type, target_id, title, content, content_preview, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [userId, emailType, targetId, title, preview, preview, JSON.stringify(data)]
    );
}

async function send(params) {
    const { emailType, to, data, options = {} } = params;
    if (!emailType || !to) {
        return { success: false, message: '缺少必要参数: emailType, to' };
    }
    const typeConfig = await getEmailTypeConfig(emailType);
    if (!typeConfig) {
        return { success: false, message: `邮件类型不存在或已禁用: ${emailType}` };
    }
    const userIds = Array.isArray(to) ? to : [to];
    const results = {
        success: true,
        sentCount: 0,
        skippedCount: 0,
        failedCount: 0,
        details: []
    };
    const concurrencyLimit = 5;
    const chunks = [];
    for (let i = 0; i < userIds.length; i += concurrencyLimit) {
        chunks.push(userIds.slice(i, i + concurrencyLimit));
    }
    for (const chunk of chunks) {
        const promises = chunk.map(userId => sendToSingleUser(emailType, userId, data, options));
        const chunkResults = await Promise.allSettled(promises);
        for (const result of chunkResults) {
            if (result.status === 'fulfilled') {
                const detail = result.value;
                results.details.push(detail);
                if (detail.status === 'sent') results.sentCount++;
                else if (detail.status === 'skipped') results.skippedCount++;
                else results.failedCount++;
                if (!options.skipInApp && (detail.status === 'sent' || detail.status === 'skipped')) {
                    try {
                        await createInAppNotification(detail.userId, emailType, data, typeConfig);
                    } catch (e) {
                        logger.error('创建站内通知失败:', { error: e.message });
                    }
                }
            } else {
                results.failedCount++;
                results.details.push({ status: 'failed', reason: result.reason?.message || 'unknown' });
            }
        }
    }
    return results;
}

async function getAllNotificationPrefs(userId) {
    const [userRows] = await pool.execute(
        'SELECT role FROM users WHERE id = ?',
        [userId]
    );
    const userRole = userRows.length > 0 ? userRows[0].role : '';
    const isAdmin = userRole === '管理员' || userRole === 'admin' || userRole === 'Administrator';
    const [types] = await pool.execute(
        'SELECT * FROM email_types WHERE is_active = TRUE ORDER BY sort_order ASC'
    );
    const [prefs] = await pool.execute(
        'SELECT type_code, email_enabled, in_app_enabled FROM user_notification_prefs WHERE user_id = ?',
        [userId]
    );
    const prefsMap = {};
    prefs.forEach(p => {
        prefsMap[p.type_code] = { emailEnabled: !!p.email_enabled, inAppEnabled: !!p.in_app_enabled };
    });
    const globalPrefs = await getUserGlobalPrefs(userId);
    const categories = [];
    const categoryOrder = ['social', 'business', 'approval', 'announcement', 'digest'];
    categoryOrder.forEach(catCode => {
        const catTypes = types.filter(t => {
            if (t.category !== catCode) return false;
            if (t.role_restriction === 'admin' && !isAdmin) return false;
            return true;
        });
        if (catTypes.length === 0) return;
        const category = {
            code: catCode,
            name: CATEGORY_NAMES[catCode] || catCode,
            icon: CATEGORY_ICONS[catCode] || '📋',
            types: catTypes.map(t => {
                const pref = prefsMap[t.type_code] || { emailEnabled: !!t.default_email_enabled, inAppEnabled: !!t.default_in_app_enabled };
                return {
                    typeCode: t.type_code,
                    typeName: t.type_name,
                    description: t.description || '',
                    emailEnabled: pref.emailEnabled,
                    inAppEnabled: pref.inAppEnabled,
                    isRequired: !!t.is_required,
                    canToggleEmail: !t.is_required,
                    canToggleInApp: t.supports_in_app && !t.is_required,
                    supportsInApp: !!t.supports_in_app
                };
            })
        };
        categories.push(category);
    });
    return {
        global: {
            emailEnabled: globalPrefs ? globalPrefs.emailGlobalEnabled : true,
            quietHoursStart: globalPrefs ? (globalPrefs.quietHoursStart ? globalPrefs.quietHoursStart.toString().substring(0, 5) : null) : null,
            quietHoursEnd: globalPrefs ? (globalPrefs.quietHoursEnd ? globalPrefs.quietHoursEnd.toString().substring(0, 5) : null) : null
        },
        categories: categories
    };
}

async function updateGlobalPrefs(userId, prefs) {
    const { emailEnabled, quietHoursStart, quietHoursEnd } = prefs;
    await pool.execute(
        `UPDATE users SET email_global_enabled = ?, email_quiet_hours_start = ?, email_quiet_hours_end = ?, updated_at = NOW() WHERE id = ?`,
        [
            emailEnabled === undefined ? 1 : (emailEnabled ? 1 : 0),
            quietHoursStart || null,
            quietHoursEnd || null,
            userId
        ]
    );
}

async function updateTypePref(userId, typeCode, emailEnabled, inAppEnabled) {
    const typeConfig = await getEmailTypeConfig(typeCode);
    if (!typeConfig) throw new Error(`邮件类型不存在: ${typeCode}`);
    if (typeConfig.is_required && emailEnabled === false) {
        throw new Error('强制发送类型不能关闭邮件通知');
    }
    await pool.execute(
        `INSERT INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE email_enabled = ?, in_app_enabled = ?, updated_at = NOW()`,
        [userId, typeCode, emailEnabled ? 1 : 0, inAppEnabled ? 1 : 0, emailEnabled ? 1 : 0, inAppEnabled ? 1 : 0]
    );
}

async function batchUpdateTypePrefs(userId, preferences) {
    const currentPrefs = await getAllNotificationPrefs(userId);
    const typeMap = {};
    for (const cat of currentPrefs.categories) {
        for (const t of cat.types) {
            typeMap[t.typeCode] = t;
        }
    }
    for (const pref of preferences) {
        const current = typeMap[pref.typeCode];
        if (!current) continue;
        await updateTypePref(
            userId,
            pref.typeCode,
            pref.emailEnabled !== undefined ? pref.emailEnabled : current.emailEnabled,
            pref.inAppEnabled !== undefined ? pref.inAppEnabled : current.inAppEnabled
        );
    }
}

async function resetPrefs(userId) {
    const [types] = await pool.execute('SELECT type_code, default_email_enabled, default_in_app_enabled FROM email_types WHERE is_active = TRUE');
    for (const t of types) {
        await pool.execute(
            `INSERT INTO user_notification_prefs (user_id, type_code, email_enabled, in_app_enabled)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE email_enabled = ?, in_app_enabled = ?, updated_at = NOW()`,
            [userId, t.type_code, t.default_email_enabled ? 1 : 0, t.default_in_app_enabled ? 1 : 0, t.default_email_enabled ? 1 : 0, t.default_in_app_enabled ? 1 : 0]
        );
    }
    await pool.execute(
        'UPDATE users SET email_global_enabled = TRUE, email_quiet_hours_start = NULL, email_quiet_hours_end = NULL, updated_at = NOW() WHERE id = ?',
        [userId]
    );
}

async function sendAIGenerationCompletionNotification(taskId) {
    try {
        const [tasks] = await pool.execute(`
            SELECT t.*, u.username, u.email, m.name as module_name
            FROM ai_case_generation_tasks t
            JOIN users u ON t.user_id = u.id
            JOIN modules m ON t.module_id = m.id
            WHERE t.task_id = ?
        `, [taskId]);

        if (tasks.length === 0) return { success: false };

        const task = tasks[0];

        return await send({
            emailType: 'ai_generation_complete',
            to: task.user_id,
            data: {
                taskId: task.task_id,
                moduleName: task.module_name,
                totalCases: task.total_cases,
                duplicateCount: task.duplicate_count,
                status: task.status,
                username: task.username
            },
            options: { skipInApp: false }
        });
    } catch (error) {
        logger.error('发送AI生成完成通知失败:', { error: error.message });
        return { success: false, error: error.message };
    }
}

module.exports = {
    send,
    shouldSendEmail,
    getAllNotificationPrefs,
    updateGlobalPrefs,
    updateTypePref,
    batchUpdateTypePrefs,
    resetPrefs,
    getUserNotificationPrefs,
    getUserGlobalPrefs,
    getEmailTypeConfig,
    renderTemplate,
    sendAIGenerationCompletionNotification
};
