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
                        projectRelations.push([
                            dbId,
                            projectId,
                            assoc.owner || null,
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
            // 处理 parseInt 的空值或者无效值
            const safeProjectRelations = projectRelations.map(row => {
               // row: [test_case_id, project_id, owner, progress_id, status_id, remark]
               return [
                   row[0],
                   row[1],
                   row[2] || null,
                   isNaN(parseInt(row[3])) ? null : parseInt(row[3]),
                   isNaN(parseInt(row[4])) ? null : parseInt(row[4]),
                   row[5] || ''
               ];
            });
            const ph = safeProjectRelations.map(() => '(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').join(',');
            await connection.query(
                `INSERT IGNORE INTO test_case_projects (test_case_id, project_id, owner, progress_id, status_id, remark, created_at) VALUES ${ph}`,
                safeProjectRelations.flat()
            );
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
        console.error('批量创建测试用例错误:', error);
        console.error('错误堆栈:', error.stack);
        res.json({ success: false, message: '批量创建失败: ' + error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;
