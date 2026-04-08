const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');
const { logActivity } = require('./history');

router.post('/batch-create', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const { moduleId, level1Id, libraryId, cases } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');

        // ── 参数校验 ─────────────────────────────────────────────
        if (!moduleId) {
            return res.json({ success: false, message: '缺少必要参数：moduleId' });
        }
        if (!Array.isArray(cases) || cases.length === 0) {
            return res.json({ success: false, message: '测试用例数据不能为空' });
        }
        if (cases.length > 200) {
            return res.json({ success: false, message: '单次批量创建不能超过200条，请分批提交' });
        }
        const invalidCases = cases.filter(c => !c.name || c.name.trim() === '');
        if (invalidCases.length > 0) {
            return res.json({ success: false, message: '存在用例名称为空的数据，请检查后重试' });
        }

        await connection.beginTransaction();

        // ── 验证模块存在 ─────────────────────────────────────────
        const [moduleRows] = await connection.execute(
            'SELECT id, name FROM modules WHERE id = ?',
            [moduleId]
        );
        if (moduleRows.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '指定的模块不存在' });
        }
        const moduleName = moduleRows[0].name;

        // ── 获取用例库ID ─────────────────────────────────────────
        let libraryIdValue = libraryId;
        if (!libraryIdValue) {
            const [libraryRows] = await connection.execute(
                'SELECT library_id FROM modules WHERE id = ?',
                [moduleId]
            );
            if (libraryRows.length > 0) {
                libraryIdValue = libraryRows[0].library_id;
            }
        }

        // ── 预加载关联数据映射表（避免循环内重复查询）────────────
        const uniqueEnvNames   = [...new Set(cases.map(c => c.env).filter(Boolean))];
        
        // 收集单个phase字段和phases数组中的所有测试阶段
        const collectPhases = (c) => {
            const phases = [];
            if (c.phase) phases.push(c.phase);
            if (c.phases && Array.isArray(c.phases)) phases.push(...c.phases);
            return phases;
        };
        const uniquePhaseNames = [...new Set(cases.flatMap(collectPhases).filter(Boolean))];
        
        const uniqueTypeNames  = [...new Set(cases.map(c => c.type).filter(Boolean))];
        
        // 收集逗号分隔的多选值（来源、方式、环境扩展）
        const flatSplit = (arr) => arr.filter(Boolean).map(s => s.split(',')).flat().map(s => s.trim()).filter(Boolean);
        const uniqueSourceNames = [...new Set(flatSplit(cases.map(c => c.sources)))];
        const uniqueMethodNames = [...new Set(flatSplit(cases.map(c => c.methods)))];
        const drawerEnvNames    = [...new Set(flatSplit(cases.map(c => c.environments)))];
        const allEnvNames       = [...new Set([...uniqueEnvNames, ...drawerEnvNames])];

        const envMap   = new Map();
        const phaseMap = new Map();
        const typeMap  = new Map();
        const sourceMap = new Map();
        const methodMap = new Map();

        if (allEnvNames.length > 0) {
            const placeholders = allEnvNames.map(() => '?').join(',');
            const [rows] = await connection.execute(
                `SELECT id, name FROM environments WHERE name IN (${placeholders})`,
                allEnvNames
            );
            rows.forEach(r => envMap.set(r.name, r.id));
        }
        if (uniquePhaseNames.length > 0) {
            const placeholders = uniquePhaseNames.map(() => '?').join(',');
            const [rows] = await connection.execute(
                `SELECT id, name FROM test_phases WHERE name IN (${placeholders})`,
                uniquePhaseNames
            );
            rows.forEach(r => phaseMap.set(r.name, r.id));
        }
        if (uniqueTypeNames.length > 0) {
            const placeholders = uniqueTypeNames.map(() => '?').join(',');
            const [rows] = await connection.execute(
                `SELECT id, name FROM test_types WHERE name IN (${placeholders})`,
                uniqueTypeNames
            );
            rows.forEach(r => typeMap.set(r.name, r.id));
        }
        if (uniqueSourceNames.length > 0) {
            const placeholders = uniqueSourceNames.map(() => '?').join(',');
            const [rows] = await connection.execute(
                `SELECT id, name FROM test_sources WHERE name IN (${placeholders})`,
                uniqueSourceNames
            );
            rows.forEach(r => sourceMap.set(r.name, r.id));
        }
        if (uniqueMethodNames.length > 0) {
            const placeholders = uniqueMethodNames.map(() => '?').join(',');
            const [rows] = await connection.execute(
                `SELECT id, name FROM test_methods WHERE name IN (${placeholders})`,
                uniqueMethodNames
            );
            rows.forEach(r => methodMap.set(r.name, r.id));
        }

        // ── 批量 INSERT 主表 ──────────────────────────────────────
        const crypto = require('crypto');
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const caseValues   = [];
        const caseParams   = [];
        const generatedIds = [];

        for (let i = 0; i < cases.length; i++) {
            const caseData = cases[i];
            const caseId = `CASE-${today}-${crypto.randomUUID().split('-')[0]}-${i}`;
            generatedIds.push(caseId);
            caseValues.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            caseParams.push(
                caseId,
                caseData.name.trim(),
                caseData.priority || '中',
                caseData.type || '功能测试',
                caseData.precondition || '',
                caseData.purpose || '',               // ✅ 修复：写入用户填写的测试目的
                caseData.steps || '',
                caseData.expected || '',
                currentUser.username,
                libraryIdValue,
                moduleId,
                level1Id || null,
                caseData.owner || currentUser.username,
                '维护中',
                'manual',
                caseData.remark || '',
                caseData.key_config || ''             // ✅ 修复：写入用户填写的关键配置
            );
        }

        await connection.query(
            `INSERT INTO test_cases (
                case_id, name, priority, type, precondition, purpose,
                steps, expected, creator, library_id, module_id, level1_id,
                owner, status, method, remark, key_config
            ) VALUES ${caseValues.join(',')}`,
            caseParams
        );

        // ── 查询刚插入的记录 ID（按 case_id 精确匹配）────────────
        const idPlaceholders = generatedIds.map(() => '?').join(',');
        const [insertedRows] = await connection.query(
            `SELECT id, case_id, name FROM test_cases WHERE case_id IN (${idPlaceholders})`,
            generatedIds
        );

        // 构建 case_id → db id 映射
        const dbIdMap = new Map();
        insertedRows.forEach(r => dbIdMap.set(r.case_id, r.id));

        const createdCases = [];
        const envRelations   = [];
        const phaseRelations = [];
        const typeRelations  = [];
        const sourceRelations = [];
        const methodRelations = [];
        const projectRelations = [];

        for (let i = 0; i < cases.length; i++) {
            const caseData  = cases[i];
            const myCaseId  = generatedIds[i];
            const dbId      = dbIdMap.get(myCaseId);
            if (!dbId) continue;

            createdCases.push({ id: dbId, caseId: myCaseId, name: caseData.name.trim() });

            if (caseData.env && envMap.has(caseData.env)) {
                envRelations.push([dbId, envMap.get(caseData.env)]);
            }
            
            // 处理单个phase字段
            if (caseData.phase && phaseMap.has(caseData.phase)) {
                phaseRelations.push([dbId, phaseMap.get(caseData.phase)]);
            }
            
            // 处理phases数组
            if (caseData.phases && Array.isArray(caseData.phases)) {
                caseData.phases.forEach(phase => {
                    if (phase && phaseMap.has(phase)) {
                        phaseRelations.push([dbId, phaseMap.get(phase)]);
                    }
                });
            }
            if (caseData.type && typeMap.has(caseData.type)) {
                typeRelations.push([dbId, typeMap.get(caseData.type)]);
            }
            if (caseData.projects) {
                let projs = [];
                if (typeof caseData.projects === 'string') {
                    try { projs = JSON.parse(caseData.projects); } catch(_) {}
                } else if (Array.isArray(caseData.projects)) {
                    projs = caseData.projects;
                }
                projs.forEach(assoc => {
                    const projectId = parseInt(assoc.project_id || assoc.id);
                    if (!isNaN(projectId)) {
                        // 如果项目没有指定负责人，则使用用例的负责人
                        const projectOwner = assoc.owner || caseData.owner || currentUser.username;
                        projectRelations.push([
                            dbId,
                            projectId,
                            projectOwner,
                            assoc.progressId || assoc.progress_id || null,
                            assoc.statusId || assoc.status_id || null,
                            assoc.remark || ''
                        ]);
                    }
                });
            }

            if (caseData.sources) {
                const sNames = typeof caseData.sources === 'string' ? caseData.sources.split(',').map(s=>s.trim()).filter(Boolean) : [];
                sNames.forEach(n => {
                    if (sourceMap.has(n)) sourceRelations.push([dbId, sourceMap.get(n)]);
                });
            }
            if (caseData.methods) {
                const mNames = typeof caseData.methods === 'string' ? caseData.methods.split(',').map(m=>m.trim()).filter(Boolean) : [];
                mNames.forEach(n => {
                    if (methodMap.has(n)) methodRelations.push([dbId, methodMap.get(n)]);
                });
            }
            if (caseData.environments) {
                const eNames = typeof caseData.environments === 'string' ? caseData.environments.split(',').map(e=>e.trim()).filter(Boolean) : [];
                eNames.forEach(n => {
                    if (envMap.has(n)) envRelations.push([dbId, envMap.get(n)]);
                });
            }
        }

        // ── 批量写入关联表 ────────────────────────────────────────
        if (envRelations.length > 0) {
            const ph = envRelations.map(() => '(?, ?)').join(',');
            await connection.query(
                `INSERT IGNORE INTO test_case_environments (test_case_id, environment_id) VALUES ${ph}`,
                envRelations.flat()
            );
        }
        if (phaseRelations.length > 0) {
            const ph = phaseRelations.map(() => '(?, ?)').join(',');
            await connection.query(
                `INSERT IGNORE INTO test_case_phases (test_case_id, phase_id) VALUES ${ph}`,
                phaseRelations.flat()
            );
        }
        if (typeRelations.length > 0) {
            const ph = typeRelations.map(() => '(?, ?)').join(',');
            await connection.query(
                `INSERT IGNORE INTO test_case_test_types (test_case_id, test_type_id) VALUES ${ph}`,
                typeRelations.flat()
            );
        }
        if (sourceRelations.length > 0) {
            const ph = sourceRelations.map(() => '(?, ?)').join(',');
            await connection.query(
                `INSERT IGNORE INTO test_case_sources (test_case_id, source_id) VALUES ${ph}`,
                sourceRelations.flat()
            );
        }
        if (methodRelations.length > 0) {
            const ph = methodRelations.map(() => '(?, ?)').join(',');
            await connection.query(
                `INSERT IGNORE INTO test_case_methods (test_case_id, method_id) VALUES ${ph}`,
                methodRelations.flat()
            );
        }
        if (projectRelations.length > 0) {
            const safeProjectRelations = projectRelations.map(row => {
               const progressId = isNaN(parseInt(row[3])) ? null : parseInt(row[3]);
               const statusId = isNaN(parseInt(row[4])) ? null : parseInt(row[4]);
               return [row[0], row[1], row[2] || null, progressId, statusId, row[5] || ''];
            });

            let projectRelationsResult = { affectedRows: 0, duplicateCount: 0 };
            try {
                const ph = safeProjectRelations.map(() => '(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').join(',');
                const [result] = await connection.query(
                    `INSERT INTO test_case_projects (test_case_id, project_id, owner, progress_id, status_id, remark, created_at) VALUES ${ph}
                     ON DUPLICATE KEY UPDATE owner = VALUES(owner), progress_id = VALUES(progress_id), status_id = VALUES(status_id), remark = VALUES(remark)`,
                    safeProjectRelations.flat()
                );
                projectRelationsResult.affectedRows = result.affectedRows || 0;
            } catch (err) {
                console.error('[批量创建] 项目关联插入失败:', err.message);
            }

            const insertedCount = safeProjectRelations.length;
            if (projectRelationsResult.affectedRows > insertedCount) {
                projectRelationsResult.duplicateCount = projectRelationsResult.affectedRows - insertedCount;
                console.log(`[批量创建] 项目关联: 新增 ${insertedCount}, 更新 ${projectRelationsResult.duplicateCount}`);
            }
        }

        // ── 记录操作日志 ──────────────────────────────────────────
        await logActivity(
            currentUser.id,
            currentUser.username,
            currentUser.role,
            '批量创建测试用例',
            `在模块 "${moduleName}" 下批量创建了 ${createdCases.length} 个测试用例`,
            'test_case',
            moduleId,
            ipAddress,
            userAgent
        );

        await connection.commit();
        console.log(`[批量创建] 成功创建 ${createdCases.length} 个测试用例`);

        res.json({
            success: true,
            message: `成功创建 ${createdCases.length} 个测试用例`,
            data: { count: createdCases.length, cases: createdCases }
        });

    } catch (error) {
        await connection.rollback();
        logger.error('批量创建测试用例错误:', { error: error.message });
        console.error('错误堆栈:', error.stack);
        res.json({ success: false, message: '批量创建失败: ' + error.message });
    } finally {
        connection.release();
    }
});

router.post('/:id/submit-review', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { id } = req.params;
        const { reviewer_id, reviewer_ids, comment } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');

        const reviewerIdList = reviewer_ids || (reviewer_id ? [reviewer_id] : []);
        
        if (!reviewerIdList || reviewerIdList.length === 0) {
            return res.json({ success: false, message: '请选择至少一位评审人' });
        }

        await connection.beginTransaction();

        const [caseRows] = await connection.execute(
            'SELECT id, case_id, name, review_status, creator, owner FROM test_cases WHERE id = ?',
            [id]
        );

        if (caseRows.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '测试用例不存在' });
        }

        const caseData = caseRows[0];

        if (caseData.review_status !== 'draft' && caseData.review_status !== 'rejected') {
            await connection.rollback();
            return res.json({ success: false, message: '当前用例状态不允许提交评审' });
        }

        const isAdmin = currentUser.role === '管理员' || currentUser.role === 'admin' || currentUser.role === 'Administrator';
        const isCreator = caseData.creator === currentUser.username;
        const isOwner = caseData.owner === currentUser.username;
        
        if (!isAdmin && !isCreator && !isOwner) {
            await connection.rollback();
            return res.json({ success: false, message: '只有用例创建者、负责人或管理员才能提交评审' });
        }

        const placeholders = reviewerIdList.map(() => '?').join(',');
        const [reviewerRows] = await connection.execute(
            `SELECT id, username FROM users WHERE id IN (${placeholders})`,
            reviewerIdList
        );

        if (reviewerRows.length !== reviewerIdList.length) {
            await connection.rollback();
            return res.json({ success: false, message: '部分评审人不存在' });
        }

        const reviewerNames = reviewerRows.map(r => r.username).join('、');

        await connection.execute(
            `UPDATE test_cases 
             SET review_status = 'pending', 
                 reviewer_id = ?, 
                 review_submitted_at = CURRENT_TIMESTAMP,
                 review_completed_at = NULL
             WHERE id = ?`,
            [reviewerIdList[0], id]
        );

        await connection.execute(
            `DELETE FROM case_reviewers WHERE case_id = ?`,
            [id]
        );

        for (const reviewerId of reviewerIdList) {
            await connection.execute(
                `INSERT INTO case_reviewers (case_id, reviewer_id, status, created_at)
                 VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`,
                [id, reviewerId]
            );
        }

        await connection.execute(
            `INSERT INTO review_records (case_id, reviewer_id, submitter_id, action, comment)
             VALUES (?, ?, ?, 'submit', ?)`,
            [id, reviewerIdList[0], currentUser.id, comment || '']
        );

        await logActivity(
            currentUser.id,
            currentUser.username,
            currentUser.role,
            '提交评审',
            `提交测试用例 [${caseData.name}] 进行评审，评审人：${reviewerNames}`,
            'test_case',
            id,
            ipAddress,
            userAgent
        );

        await connection.commit();

        const io = req.app.get('io');
        if (io) {
            for (const reviewerId of reviewerIdList) {
                io.emit('review:submitted', {
                    caseId: id,
                    caseName: caseData.name,
                    submitterName: currentUser.username,
                    reviewerId: reviewerId,
                    submittedAt: new Date().toISOString()
                });
            }
        }

        res.json({
            success: true,
            message: `已提交评审，共${reviewerIdList.length}位评审人`,
            data: {
                case_id: parseInt(id),
                review_status: 'pending',
                reviewer_ids: reviewerIdList,
                reviewer_names: reviewerNames,
                submitted_at: new Date().toISOString()
            }
        });

    } catch (error) {
        await connection.rollback();
        logger.error('提交评审失败:', { error: error.message });
        res.json({ success: false, message: '提交评审失败: ' + error.message });
    } finally {
        connection.release();
    }
});

router.post('/:id/review', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { id } = req.params;
        const { action, comment, suggestion } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');

        if (!action || !['approve', 'reject'].includes(action)) {
            return res.json({ success: false, message: '无效的评审操作' });
        }

        if (action === 'reject') {
            if (!comment || comment.trim().length < 1) {
                return res.json({ success: false, message: '驳回原因不能为空' });
            }
            if (comment.length > 500) {
                return res.json({ success: false, message: '评审意见不能超过500个字符' });
            }
        }

        if (comment && comment.length > 500) {
            return res.json({ success: false, message: '评审意见不能超过500个字符' });
        }

        await connection.beginTransaction();

        const [caseRows] = await connection.execute(
            `SELECT tc.id, tc.case_id, tc.name, tc.review_status, tc.reviewer_id, 
                    tc.creator, m.name as module_name, tc.priority
             FROM test_cases tc
             LEFT JOIN modules m ON tc.module_id = m.id
             WHERE tc.id = ?`,
            [id]
        );

        if (caseRows.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '测试用例不存在' });
        }

        const caseData = caseRows[0];

        if (caseData.review_status !== 'pending') {
            await connection.rollback();
            return res.json({ success: false, message: '当前用例不在待评审状态' });
        }

        const [reviewerRows] = await connection.execute(
            `SELECT id, status FROM case_reviewers WHERE case_id = ? AND reviewer_id = ?`,
            [id, currentUser.id]
        );

        if (reviewerRows.length === 0) {
            await connection.rollback();
            return res.json({ success: false, message: '您不是该用例的评审人' });
        }

        if (reviewerRows[0].status !== 'pending') {
            await connection.rollback();
            return res.json({ success: false, message: '您已完成评审，请勿重复操作' });
        }

        const reviewerAction = action === 'approve' ? 'approved' : 'rejected';
        const actionText = action === 'approve' ? '通过' : '驳回';

        await connection.execute(
            `UPDATE case_reviewers 
             SET status = ?, comment = ?, reviewed_at = CURRENT_TIMESTAMP
             WHERE case_id = ? AND reviewer_id = ?`,
            [reviewerAction, comment || '', id, currentUser.id]
        );

        const [allReviewers] = await connection.execute(
            `SELECT id, reviewer_id, status FROM case_reviewers WHERE case_id = ?`,
            [id]
        );

        const allApproved = allReviewers.every(r => r.status === 'approved');
        const anyRejected = allReviewers.some(r => r.status === 'rejected');
        const allReviewed = allReviewers.every(r => r.status !== 'pending');

        let newCaseStatus = 'pending';
        if (anyRejected) {
            newCaseStatus = 'rejected';
        } else if (allApproved) {
            newCaseStatus = 'approved';
        }

        if (newCaseStatus !== 'pending') {
            await connection.execute(
                `UPDATE test_cases 
                 SET review_status = ?, 
                     review_completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [newCaseStatus, id]
            );
        }

        const reviewComment = action === 'reject' && suggestion
            ? `${comment}\n\n修改建议：\n${suggestion}`
            : comment;

        let submitterId = currentUser.id;
        if (caseData.creator) {
            const [creatorResult] = await connection.execute(
                'SELECT id FROM users WHERE username = ?',
                [caseData.creator]
            );
            if (creatorResult.length > 0 && creatorResult[0].id) {
                submitterId = creatorResult[0].id;
            }
        }

        await connection.execute(
            `INSERT INTO review_records (case_id, reviewer_id, submitter_id, action, comment)
             VALUES (?, ?, ?, ?, ?)`,
            [id, currentUser.id, submitterId, action, reviewComment || '']
        );

        await logActivity(
            currentUser.id,
            currentUser.username,
            currentUser.role,
            action === 'approve' ? '通过评审' : '驳回评审',
            `${actionText}测试用例 [${caseData.name}] 的评审${newCaseStatus !== 'pending' ? `，用例最终状态：${newCaseStatus === 'approved' ? '已通过' : '已驳回'}` : ''}`,
            'test_case',
            id,
            ipAddress,
            userAgent
        );

        await connection.commit();

        const io = req.app.get('io');
        if (io && caseData.creator) {
            io.emit('review:completed', {
                caseId: id,
                caseName: caseData.name,
                reviewerName: currentUser.username,
                action: action,
                reviewedAt: new Date().toISOString(),
                finalStatus: newCaseStatus
            });
        }

        const reviewedCount = allReviewers.filter(r => r.status !== 'pending').length;
        const totalCount = allReviewers.length;

        res.json({
            success: true,
            message: newCaseStatus !== 'pending' 
                ? `评审完成，用例${newCaseStatus === 'approved' ? '已通过' : '已驳回'}`
                : `评审已记录（${reviewedCount}/${totalCount}人已评审）`,
            data: {
                case_id: parseInt(id),
                review_status: newCaseStatus,
                reviewer_name: currentUser.username,
                reviewed_at: new Date().toISOString(),
                review_progress: {
                    reviewed: reviewedCount,
                    total: totalCount,
                    all_approved: allApproved,
                    any_rejected: anyRejected
                }
            }
        });

    } catch (error) {
        await connection.rollback();
        logger.error('执行评审失败:', { error: error.message });
        res.json({ success: false, message: '评审失败: ' + error.message });
    } finally {
        connection.release();
    }
});

router.get('/:id/review-history', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const [caseRows] = await pool.execute(
            `SELECT tc.id, tc.review_status, tc.review_submitted_at, tc.creator as submitter_name
             FROM test_cases tc
             WHERE tc.id = ?`,
            [id]
        );

        if (caseRows.length === 0) {
            return res.json({ success: false, message: '测试用例不存在' });
        }

        const caseInfo = caseRows[0];

        // 获取当前待评审的评审人信息（如果是待评审状态）
        let reviewerInfo = null;
        if (caseInfo.review_status === 'pending') {
            const [reviewerRows] = await pool.execute(
                `SELECT cr.reviewer_id, u.username as reviewer_name
                 FROM case_reviewers cr
                 LEFT JOIN users u ON cr.reviewer_id = u.id
                 WHERE cr.case_id = ? AND cr.status = 'pending'
                 LIMIT 1`,
                [id]
            );
            if (reviewerRows.length > 0) {
                reviewerInfo = reviewerRows[0];
            }
        }

        const [records] = await pool.execute(
            `SELECT 
                rr.id,
                rr.action,
                rr.comment,
                rr.created_at,
                reviewer.username as reviewer_name,
                submitter.username as submitter_name
             FROM review_records rr
             LEFT JOIN users reviewer ON rr.reviewer_id = reviewer.id
             LEFT JOIN users submitter ON rr.submitter_id = submitter.id
             WHERE rr.case_id = ?
             ORDER BY rr.created_at DESC`,
            [id]
        );

        res.json({
            success: true,
            data: {
                case_id: parseInt(id),
                current_status: caseInfo.review_status,
                review_submitted_at: caseInfo.review_submitted_at,
                reviewer_id: reviewerInfo ? reviewerInfo.reviewer_id : null,
                reviewer_name: reviewerInfo ? reviewerInfo.reviewer_name : null,
                submitter_name: caseInfo.submitter_name,
                review_records: records
            }
        });

    } catch (error) {
        logger.error('获取评审历史失败:', { error: error.message });
        res.json({ success: false, message: '获取评审历史失败: ' + error.message });
    }
});

router.get('/review/pending', authenticateToken, async (req, res) => {
    try {
        const { page = 1, pageSize = 20 } = req.query;
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
                cr.status as my_review_status
             FROM case_reviewers cr
             JOIN test_cases tc ON cr.case_id = tc.id
             LEFT JOIN modules m ON tc.module_id = m.id
             LEFT JOIN users creator ON tc.creator = creator.username
             WHERE cr.reviewer_id = ? AND cr.status = 'pending' AND tc.review_status = 'pending'
             ORDER BY tc.review_submitted_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            [currentUser.id]
        );

        const [countRows] = await pool.execute(
            `SELECT COUNT(*) as total 
             FROM case_reviewers cr
             JOIN test_cases tc ON cr.case_id = tc.id
             WHERE cr.reviewer_id = ? AND cr.status = 'pending' AND tc.review_status = 'pending'`,
            [currentUser.id]
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
        logger.error('获取待评审列表失败:', { error: error.message });
        res.json({ success: false, message: '获取待评审列表失败: ' + error.message });
    }
});

router.get('/:id/review-progress', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const [caseRows] = await pool.execute(
            'SELECT id, review_status FROM test_cases WHERE id = ?',
            [id]
        );

        if (caseRows.length === 0) {
            return res.json({ success: false, message: '测试用例不存在' });
        }

        const [reviewers] = await pool.execute(
            `SELECT 
                cr.id,
                cr.reviewer_id,
                cr.status,
                cr.comment,
                cr.reviewed_at,
                u.username as reviewer_name
             FROM case_reviewers cr
             LEFT JOIN users u ON cr.reviewer_id = u.id
             WHERE cr.case_id = ?
             ORDER BY cr.created_at ASC`,
            [id]
        );

        const total = reviewers.length;
        const approved = reviewers.filter(r => r.status === 'approved').length;
        const rejected = reviewers.filter(r => r.status === 'rejected').length;
        const pending = reviewers.filter(r => r.status === 'pending').length;

        res.json({
            success: true,
            data: {
                case_id: parseInt(id),
                review_status: caseRows[0].review_status,
                reviewers: reviewers,
                summary: {
                    total: total,
                    approved: approved,
                    rejected: rejected,
                    pending: pending,
                    all_approved: approved === total && total > 0,
                    any_rejected: rejected > 0
                }
            }
        });

    } catch (error) {
        logger.error('获取评审进度失败:', { error: error.message });
        res.json({ success: false, message: '获取评审进度失败: ' + error.message });
    }
});

router.post('/batch-submit-review', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { case_ids, reviewer_ids, comment } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');
        
        if (!case_ids || !Array.isArray(case_ids) || case_ids.length === 0) {
            return res.json({ success: false, message: '请选择要提交评审的用例' });
        }
        
        if (case_ids.length > 50) {
            return res.json({ success: false, message: '单次最多提交50个用例' });
        }
        
        if (!reviewer_ids || !Array.isArray(reviewer_ids) || reviewer_ids.length === 0) {
            return res.json({ success: false, message: '请选择至少一位评审人' });
        }
        
        if (comment && comment.length > 500) {
            return res.json({ success: false, message: '评审说明不能超过500个字符' });
        }
        
        const placeholders = reviewer_ids.map(() => '?').join(',');
        const [reviewers] = await connection.execute(
            `SELECT id, username FROM users WHERE id IN (${placeholders}) AND status = 'active'`,
            reviewer_ids
        );
        
        if (reviewers.length !== reviewer_ids.length) {
            return res.json({ success: false, message: '部分评审人不存在或已禁用' });
        }
        
        const casePlaceholders = case_ids.map(() => '?').join(',');
        const [cases] = await connection.execute(
            `SELECT id, case_id, name, review_status, creator, owner 
             FROM test_cases 
             WHERE id IN (${casePlaceholders})`,
            case_ids
        );
        
        const successCases = [];
        const failCases = [];
        
        for (const caseItem of cases) {
            if (caseItem.review_status !== 'draft' && caseItem.review_status !== 'rejected') {
                failCases.push({
                    id: caseItem.id,
                    case_id: caseItem.case_id,
                    name: caseItem.name,
                    reason: '用例状态不允许提交评审'
                });
                continue;
            }
            
            const isAdmin = currentUser.role === '管理员' || currentUser.role === 'admin' || currentUser.role === 'Administrator';
            const isCreator = caseItem.creator === currentUser.username;
            const isOwner = caseItem.owner === currentUser.username;
            
            if (!isAdmin && !isCreator && !isOwner) {
                failCases.push({
                    id: caseItem.id,
                    case_id: caseItem.case_id,
                    name: caseItem.name,
                    reason: '只有用例创建者、负责人或管理员才能提交评审'
                });
                continue;
            }
            
            await connection.execute(
                `UPDATE test_cases 
                 SET review_status = 'pending',
                     review_submitted_at = CURRENT_TIMESTAMP,
                     review_completed_at = NULL
                 WHERE id = ?`,
                [caseItem.id]
            );
            
            await connection.execute(
                `DELETE FROM case_reviewers WHERE case_id = ?`,
                [caseItem.id]
            );
            
            for (const reviewerId of reviewer_ids) {
                await connection.execute(
                    `INSERT INTO case_reviewers (case_id, reviewer_id, status, created_at)
                     VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`,
                    [caseItem.id, reviewerId]
                );
            }
            
            for (const reviewerId of reviewer_ids) {
                await connection.execute(
                    `INSERT INTO review_records (case_id, reviewer_id, submitter_id, action, comment, created_at)
                     VALUES (?, ?, ?, 'submit', ?, CURRENT_TIMESTAMP)`,
                    [caseItem.id, reviewerId, currentUser.id, comment || '']
                );
            }
            
            successCases.push({
                id: caseItem.id,
                case_id: caseItem.case_id,
                name: caseItem.name
            });
        }
        
        if (successCases.length > 0) {
            const reviewerNames = reviewers.map(r => r.username).join('、');
            await logActivity(
                currentUser.id,
                currentUser.username,
                currentUser.role,
                '批量提交评审',
                `批量提交 ${successCases.length} 个测试用例给 ${reviewerNames} 进行评审`,
                'test_case',
                null,
                ipAddress,
                userAgent
            );
        }
        
        await connection.commit();
        
        if (successCases.length > 0) {
            const io = req.app.get('io');
            if (io) {
                const reviewerNames = reviewers.map(r => r.username);
                io.emit('review:batch_submitted', {
                    count: successCases.length,
                    submitterName: currentUser.username,
                    reviewerIds: reviewer_ids,
                    reviewerNames: reviewerNames,
                    submittedAt: new Date().toISOString()
                });
            }
        }
        
        res.json({
            success: true,
            message: successCases.length === case_ids.length 
                ? '批量提交评审成功' 
                : '批量提交评审完成，部分用例提交失败',
            data: {
                success_count: successCases.length,
                fail_count: failCases.length,
                success_cases: successCases,
                fail_cases: failCases
            }
        });
        
    } catch (error) {
        await connection.rollback();
        logger.error('批量提交评审错误:', { error: error.message });
        res.json({ success: false, message: '批量提交评审失败: ' + error.message });
    } finally {
        connection.release();
    }
});

router.post('/batch-review', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { case_ids, action, comment } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');
        
        if (!case_ids || !Array.isArray(case_ids) || case_ids.length === 0) {
            return res.json({ success: false, message: '请选择要评审的用例' });
        }
        
        if (case_ids.length > 50) {
            return res.json({ success: false, message: '单次最多评审50个用例' });
        }
        
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.json({ success: false, message: '无效的评审操作' });
        }
        
        if (action === 'reject' && (!comment || comment.trim().length < 1)) {
            return res.json({ success: false, message: '驳回原因不能为空' });
        }
        
        if (comment && comment.length > 500) {
            return res.json({ success: false, message: '评审意见不能超过500个字符' });
        }
        
        const placeholders = case_ids.map(() => '?').join(',');
        const [cases] = await connection.execute(
            `SELECT tc.id, tc.case_id, tc.name, tc.review_status, tc.reviewer_id, 
                    tc.creator, u.id as creator_id, u.username as creator_name
             FROM test_cases tc
             LEFT JOIN users u ON tc.creator = u.username
             WHERE tc.id IN (${placeholders})`,
            case_ids
        );
        
        const successCases = [];
        const failCases = [];
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        const actionText = action === 'approve' ? '通过' : '驳回';
        
        for (const caseItem of cases) {
            if (caseItem.review_status !== 'pending') {
                failCases.push({
                    id: caseItem.id,
                    case_id: caseItem.case_id,
                    name: caseItem.name,
                    reason: '用例状态不是"待评审"'
                });
                continue;
            }
            
            const [reviewerRows] = await connection.execute(
                `SELECT id, status FROM case_reviewers WHERE case_id = ? AND reviewer_id = ?`,
                [caseItem.id, currentUser.id]
            );
            
            if (reviewerRows.length === 0) {
                failCases.push({
                    id: caseItem.id,
                    case_id: caseItem.case_id,
                    name: caseItem.name,
                    reason: '您不是该用例的评审人'
                });
                continue;
            }
            
            if (reviewerRows[0].status !== 'pending') {
                failCases.push({
                    id: caseItem.id,
                    case_id: caseItem.case_id,
                    name: caseItem.name,
                    reason: '您已完成评审，请勿重复操作'
                });
                continue;
            }
            
            const reviewerAction = action === 'approve' ? 'approved' : 'rejected';
            
            await connection.execute(
                `UPDATE case_reviewers 
                 SET status = ?, comment = ?, reviewed_at = CURRENT_TIMESTAMP
                 WHERE case_id = ? AND reviewer_id = ?`,
                [reviewerAction, comment || '', caseItem.id, currentUser.id]
            );
            
            await connection.execute(
                `UPDATE test_cases 
                 SET review_status = ?,
                     review_completed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [newStatus, caseItem.id]
            );
            
            const submitterId = caseItem.creator_id || currentUser.id;
            
            await connection.execute(
                `INSERT INTO review_records (case_id, reviewer_id, submitter_id, action, comment, created_at)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [caseItem.id, currentUser.id, submitterId, action, comment || '']
            );
            
            successCases.push({
                id: caseItem.id,
                case_id: caseItem.case_id,
                name: caseItem.name,
                new_status: newStatus,
                creator_id: caseItem.creator_id,
                creator_name: caseItem.creator_name
            });
        }
        
        if (successCases.length > 0) {
            await logActivity(
                currentUser.id,
                currentUser.username,
                currentUser.role,
                action === 'approve' ? '批量通过评审' : '批量驳回评审',
                `批量${actionText} ${successCases.length} 个测试用例的评审`,
                'test_case',
                null,
                ipAddress,
                userAgent
            );
        }
        
        await connection.commit();
        
        if (successCases.length > 0) {
            const io = req.app.get('io');
            if (io) {
                const creatorNotifications = {};
                successCases.forEach(c => {
                    if (c.creator_id && !creatorNotifications[c.creator_id]) {
                        creatorNotifications[c.creator_id] = {
                            count: 0,
                            creator_name: c.creator_name
                        };
                    }
                    if (c.creator_id) {
                        creatorNotifications[c.creator_id].count++;
                    }
                });
                
                Object.entries(creatorNotifications).forEach(([creatorId, data]) => {
                    io.emit('review:batch_completed', {
                        count: data.count,
                        action: action,
                        reviewerName: currentUser.username,
                        creatorId: parseInt(creatorId),
                        completedAt: new Date().toISOString()
                    });
                });
            }
        }
        
        res.json({
            success: true,
            message: successCases.length === case_ids.length 
                ? '批量评审成功' 
                : '批量评审完成，部分用例评审失败',
            data: {
                success_count: successCases.length,
                fail_count: failCases.length,
                success_cases: successCases,
                fail_cases: failCases
            }
        });
        
    } catch (error) {
        await connection.rollback();
        logger.error('批量评审错误:', { error: error.message });
        res.json({ success: false, message: '批量评审失败: ' + error.message });
    } finally {
        connection.release();
    }
});

router.get('/pending-submit', authenticateToken, async (req, res) => {
    try {
        const { page = 1, pageSize = 20 } = req.query;
        const currentUser = req.user;
        const limit = parseInt(pageSize);
        const offset = (parseInt(page) - 1) * limit;
        
        const [cases] = await pool.execute(
            `SELECT tc.id, tc.case_id, tc.name, tc.priority, tc.review_status,
                    tc.created_at, m.name as module_name
             FROM test_cases tc
             LEFT JOIN modules m ON tc.module_id = m.id
             WHERE tc.creator = ? AND tc.review_status IN ('draft', 'rejected')
             ORDER BY tc.created_at DESC
             LIMIT ${limit} OFFSET ${offset}`,
            [currentUser.username]
        );
        
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM test_cases 
             WHERE creator = ? AND review_status IN ('draft', 'rejected')`,
            [currentUser.username]
        );
        
        res.json({
            success: true,
            data: {
                cases: cases,
                pagination: {
                    page: parseInt(page),
                    pageSize: parseInt(pageSize),
                    total: countResult[0].total,
                    totalPages: Math.ceil(countResult[0].total / pageSize)
                }
            }
        });
        
    } catch (error) {
        logger.error('获取待提交评审用例列表失败:', { error: error.message });
        res.json({ success: false, message: '获取待提交评审用例列表失败: ' + error.message });
    }
});

router.post('/batch-update', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const { moduleId, level1Id, libraryId, updatedCases, newCases } = req.body;
        const currentUser = req.user;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');

        if (!moduleId) {
            return res.json({ success: false, message: '缺少必要参数：moduleId' });
        }

        await connection.beginTransaction();

        let updatedCount = 0;
        let createdCount = 0;

        // 处理更新的用例
        if (Array.isArray(updatedCases) && updatedCases.length > 0) {
            for (const caseData of updatedCases) {
                if (!caseData.id || !caseData.name || caseData.name.trim() === '') continue;

                await connection.execute(
                    `UPDATE test_cases SET 
                        name = ?, priority = ?, type = ?, owner = ?, 
                        key_config = ?, precondition = ?, purpose = ?, 
                        steps = ?, expected = ?, remark = ?,
                        updated_at = NOW()
                     WHERE id = ?`,
                    [
                        caseData.name.trim(),
                        caseData.priority,
                        caseData.type,
                        caseData.owner || '',
                        caseData.key_config || '',
                        caseData.precondition || '',
                        caseData.purpose || '',
                        caseData.steps || '',
                        caseData.expected || '',
                        caseData.remark || '',
                        caseData.id
                    ]
                );

                // 更新关联表
                // 删除旧的关联数据
                await connection.execute('DELETE FROM test_case_environments WHERE test_case_id = ?', [caseData.id]);
                await connection.execute('DELETE FROM test_case_phases WHERE test_case_id = ?', [caseData.id]);
                await connection.execute('DELETE FROM test_case_test_types WHERE test_case_id = ?', [caseData.id]);
                await connection.execute('DELETE FROM test_case_sources WHERE test_case_id = ?', [caseData.id]);
                await connection.execute('DELETE FROM test_case_methods WHERE test_case_id = ?', [caseData.id]);

                // 重新插入环境
                if (caseData.env && caseData.env.trim()) {
                    const envNames = caseData.env.split(',').map(e => e.trim()).filter(Boolean);
                    for (const envName of envNames) {
                        const [envRows] = await connection.execute(
                            'SELECT id FROM environments WHERE name = ?',
                            [envName]
                        );
                        if (envRows.length > 0) {
                            await connection.execute(
                                'INSERT IGNORE INTO test_case_environments (test_case_id, environment_id) VALUES (?, ?)',
                                [caseData.id, envRows[0].id]
                            );
                        }
                    }
                }

                // 插入 environments（多选）
                if (caseData.environments && caseData.environments.trim()) {
                    const envNames = caseData.environments.split(',').map(e => e.trim()).filter(Boolean);
                    for (const envName of envNames) {
                        const [envRows] = await connection.execute(
                            'SELECT id FROM environments WHERE name = ?',
                            [envName]
                        );
                        if (envRows.length > 0) {
                            await connection.execute(
                                'INSERT IGNORE INTO test_case_environments (test_case_id, environment_id) VALUES (?, ?)',
                                [caseData.id, envRows[0].id]
                            );
                        }
                    }
                }

                // 插入阶段
                if (caseData.phase) {
                    const [phaseRows] = await connection.execute(
                        'SELECT id FROM test_phases WHERE name = ?',
                        [caseData.phase]
                    );
                    if (phaseRows.length > 0) {
                        await connection.execute(
                            'INSERT IGNORE INTO test_case_phases (test_case_id, phase_id) VALUES (?, ?)',
                            [caseData.id, phaseRows[0].id]
                        );
                    }
                }

                // 插入类型
                if (caseData.type) {
                    const [typeRows] = await connection.execute(
                        'SELECT id FROM test_types WHERE name = ?',
                        [caseData.type]
                    );
                    if (typeRows.length > 0) {
                        await connection.execute(
                            'INSERT IGNORE INTO test_case_test_types (test_case_id, test_type_id) VALUES (?, ?)',
                            [caseData.id, typeRows[0].id]
                        );
                    }
                }

                // 插入来源
                if (caseData.sources && caseData.sources.trim()) {
                    const sourceNames = caseData.sources.split(',').map(s => s.trim()).filter(Boolean);
                    for (const sourceName of sourceNames) {
                        const [sourceRows] = await connection.execute(
                            'SELECT id FROM test_sources WHERE name = ?',
                            [sourceName]
                        );
                        if (sourceRows.length > 0) {
                            await connection.execute(
                                'INSERT IGNORE INTO test_case_sources (test_case_id, source_id) VALUES (?, ?)',
                                [caseData.id, sourceRows[0].id]
                            );
                        }
                    }
                }

                // 插入方式
                if (caseData.methods && caseData.methods.trim()) {
                    const methodNames = caseData.methods.split(',').map(m => m.trim()).filter(Boolean);
                    for (const methodName of methodNames) {
                        const [methodRows] = await connection.execute(
                            'SELECT id FROM test_methods WHERE name = ?',
                            [methodName]
                        );
                        if (methodRows.length > 0) {
                            await connection.execute(
                                'INSERT IGNORE INTO test_case_methods (test_case_id, method_id) VALUES (?, ?)',
                                [caseData.id, methodRows[0].id]
                            );
                        }
                    }
                }

                // 更新项目关联
                if (caseData.projects) {
                    let projects = [];
                    if (typeof caseData.projects === 'string') {
                        try { projects = JSON.parse(caseData.projects); } catch(_) {}
                    } else if (Array.isArray(caseData.projects)) {
                        projects = caseData.projects;
                    }

                    // 先删除旧的项目关联
                    await connection.execute('DELETE FROM test_case_projects WHERE test_case_id = ?', [caseData.id]);

                    // 插入新的项目关联
                    for (const proj of projects) {
                        const projectId = parseInt(proj.project_id || proj.id);
                        if (!isNaN(projectId)) {
                            const projectOwner = proj.owner || caseData.owner || currentUser.username;
                            await connection.execute(
                                `INSERT INTO test_case_projects (test_case_id, project_id, owner, progress_id, status_id, remark)
                                 VALUES (?, ?, ?, ?, ?, ?)`,
                                [
                                    caseData.id,
                                    projectId,
                                    projectOwner,
                                    parseInt(proj.progressId || proj.progress_id) || null,
                                    parseInt(proj.statusId || proj.status_id) || null,
                                    proj.remark || ''
                                ]
                            );
                        }
                    }
                }

                updatedCount++;
            }
        }

        // 处理新增的用例（复用批量创建的逻辑）
        const createdCaseIds = [];
        
        if (Array.isArray(newCases) && newCases.length > 0) {
            const validNewCases = newCases.filter(c => c.name && c.name.trim() !== '');
            console.log('有效newCases数量:', validNewCases.length);
            
            if (validNewCases.length > 0) {
                // 预加载关联数据映射表
                const uniqueEnvNames   = [...new Set(validNewCases.map(c => c.env).filter(Boolean))];
                const collectPhases = (c) => { const phases = []; if (c.phase) phases.push(c.phase); return phases; };
                const uniquePhaseNames = [...new Set(validNewCases.flatMap(collectPhases).filter(Boolean))];
                const uniqueTypeNames  = [...new Set(validNewCases.map(c => c.type).filter(Boolean))];
                const flatSplit = (arr) => arr.filter(Boolean).map(s => s.split(',')).flat().map(s => s.trim()).filter(Boolean);
                const uniqueSourceNames = [...new Set(flatSplit(validNewCases.map(c => c.sources)))];
                const uniqueMethodNames = [...new Set(flatSplit(validNewCases.map(c => c.methods)))];
                const drawerEnvNames    = [...new Set(flatSplit(validNewCases.map(c => c.environments)))];
                const allEnvNames       = [...new Set([...uniqueEnvNames, ...drawerEnvNames])];

                const envMap = new Map();
                const phaseMap = new Map();
                const typeMap = new Map();
                const sourceMap = new Map();
                const methodMap = new Map();

                if (allEnvNames.length > 0) {
                    const placeholders = allEnvNames.map(() => '?').join(',');
                    const [rows] = await connection.execute(`SELECT id, name FROM environments WHERE name IN (${placeholders})`, allEnvNames);
                    rows.forEach(r => envMap.set(r.name, r.id));
                }
                if (uniquePhaseNames.length > 0) {
                    const placeholders = uniquePhaseNames.map(() => '?').join(',');
                    const [rows] = await connection.execute(`SELECT id, name FROM test_phases WHERE name IN (${placeholders})`, uniquePhaseNames);
                    rows.forEach(r => phaseMap.set(r.name, r.id));
                }
                if (uniqueTypeNames.length > 0) {
                    const placeholders = uniqueTypeNames.map(() => '?').join(',');
                    const [rows] = await connection.execute(`SELECT id, name FROM test_types WHERE name IN (${placeholders})`, uniqueTypeNames);
                    rows.forEach(r => typeMap.set(r.name, r.id));
                }
                if (uniqueSourceNames.length > 0) {
                    const placeholders = uniqueSourceNames.map(() => '?').join(',');
                    const [rows] = await connection.execute(`SELECT id, name FROM test_sources WHERE name IN (${placeholders})`, uniqueSourceNames);
                    rows.forEach(r => sourceMap.set(r.name, r.id));
                }
                if (uniqueMethodNames.length > 0) {
                    const placeholders = uniqueMethodNames.map(() => '?').join(',');
                    const [rows] = await connection.execute(`SELECT id, name FROM test_methods WHERE name IN (${placeholders})`, uniqueMethodNames);
                    rows.forEach(r => methodMap.set(r.name, r.id));
                }

                for (const caseData of validNewCases) {
                    console.log('创建新用例:', {
                        name: caseData.name,
                        level1_id: caseData.level1_id,
                        level1Id: caseData.level1Id,
                        moduleId: moduleId,
                        requestLevel1Id: level1Id
                    });
                    
                    // 生成用例编号
                    const [countResult] = await connection.execute('SELECT COUNT(*) as cnt FROM test_cases');
                    const caseNum = (countResult[0].cnt || 0) + 1;
                    const caseId = `CASE-${String(caseNum).padStart(4, '0')}`;

                    const [result] = await connection.execute(
                        `INSERT INTO test_cases (
                            case_id, name, priority, type, owner, library_id, module_id, level1_id,
                            key_config, precondition, purpose, steps, expected, remark, creator
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            caseId,
                            caseData.name.trim(),
                            caseData.priority,
                            caseData.type,
                            caseData.owner || currentUser.username,
                            libraryId || null,
                            moduleId,
                            caseData.level1_id || caseData.level1Id || level1Id || null,
                            caseData.key_config || '',
                            caseData.precondition || '',
                            caseData.purpose || '',
                            caseData.steps || '',
                            caseData.expected || '',
                            caseData.remark || '',
                            currentUser.username
                        ]
                    );

                    const dbId = result.insertId;

                    // 插入关联数据
                    if (caseData.env && envMap.has(caseData.env)) {
                        await connection.execute('INSERT IGNORE INTO test_case_environments (test_case_id, environment_id) VALUES (?, ?)', [dbId, envMap.get(caseData.env)]);
                    }

                    if (caseData.phase && phaseMap.has(caseData.phase)) {
                        await connection.execute('INSERT IGNORE INTO test_case_phases (test_case_id, phase_id) VALUES (?, ?)', [dbId, phaseMap.get(caseData.phase)]);
                    }

                    if (caseData.type && typeMap.has(caseData.type)) {
                        await connection.execute('INSERT IGNORE INTO test_case_test_types (test_case_id, test_type_id) VALUES (?, ?)', [dbId, typeMap.get(caseData.type)]);
                    }

                    if (caseData.environments) {
                        const envNames = typeof caseData.environments === 'string' ? caseData.environments.split(',').map(e=>e.trim()).filter(Boolean) : [];
                        envNames.forEach(n => { if (envMap.has(n)) connection.execute('INSERT IGNORE INTO test_case_environments (test_case_id, environment_id) VALUES (?, ?)', [dbId, envMap.get(n)]); });
                    }

                    if (caseData.sources) {
                        const sNames = typeof caseData.sources === 'string' ? caseData.sources.split(',').map(s=>s.trim()).filter(Boolean) : [];
                        sNames.forEach(n => { if (sourceMap.has(n)) connection.execute('INSERT IGNORE INTO test_case_sources (test_case_id, source_id) VALUES (?, ?)', [dbId, sourceMap.get(n)]); });
                    }

                    if (caseData.methods) {
                        const mNames = typeof caseData.methods === 'string' ? caseData.methods.split(',').map(m=>m.trim()).filter(Boolean) : [];
                        mNames.forEach(n => { if (methodMap.has(n)) connection.execute('INSERT IGNORE INTO test_case_methods (test_case_id, method_id) VALUES (?, ?)', [dbId, methodMap.get(n)]); });
                    }

                    if (caseData.projects) {
                        let projs = [];
                        if (typeof caseData.projects === 'string') {
                            try { projs = JSON.parse(caseData.projects); } catch(_) {}
                        } else if (Array.isArray(caseData.projects)) {
                            projs = caseData.projects;
                        }
                        projs.forEach(assoc => {
                            const projectId = parseInt(assoc.project_id || assoc.id);
                            if (!isNaN(projectId)) {
                                const projectOwner = assoc.owner || caseData.owner || currentUser.username;
                                connection.execute(
                                    `INSERT INTO test_case_projects (test_case_id, project_id, owner, progress_id, status_id, remark) VALUES (?, ?, ?, ?, ?, ?)`,
                                    [dbId, projectId, projectOwner, parseInt(assoc.progressId || assoc.progress_id) || null, parseInt(assoc.statusId || assoc.status_id) || null, assoc.remark || '']
                                );
                            }
                        });
                    }

                    createdCaseIds.push({
                        tempId: caseData.tempId || null,
                        dbId: dbId,
                        name: caseData.name.trim()
                    });
                    createdCount++;
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: '批量更新成功',
            data: {
                updatedCount: updatedCount,
                createdCount: createdCount,
                createdCaseIds: createdCaseIds
            }
        });

    } catch (error) {
        await connection.rollback();
        logger.error('批量更新错误:', { error: error.message });
        res.json({ success: false, message: '批量更新失败: ' + error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;
