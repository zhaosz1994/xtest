const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'scripts');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dateDir = path.join(UPLOAD_DIR, 
            new Date().getFullYear().toString(),
            String(new Date().getMonth() + 1).padStart(2, '0')
        );
        if (!fs.existsSync(dateDir)) {
            fs.mkdirSync(dateDir, { recursive: true });
        }
        cb(null, dateDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedExts = ['.tcl', '.py', '.sh', '.txt', '.json', '.pl', '.rb', '.js', '.yaml', '.yml', '.xml', '.cfg', '.conf', '.ini'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('不支持的文件类型: ' + ext), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

function getFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

router.get('/testcases/:id/scripts', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const [scripts] = await pool.execute(`
            SELECT 
                id, test_case_id, script_name, script_type, description,
                file_path, file_size, original_filename,
                link_url, link_title, link_type, order_index,
                creator, created_at, updated_at
            FROM test_case_scripts
            WHERE test_case_id = ?
            ORDER BY order_index ASC, created_at ASC
        `, [id]);
        
        res.json({
            success: true,
            scripts: scripts,
            total: scripts.length
        });
        
    } catch (error) {
        logger.error('获取关联脚本失败:', { error: error.message });
        res.json({ success: false, message: '获取关联脚本失败: ' + error.message });
    }
});

router.get('/testcases/scripts/:scriptId', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        
        const [scripts] = await pool.execute(`
            SELECT 
                id, test_case_id, script_name, script_type, description,
                file_path, file_size, original_filename,
                link_url, link_title, link_type, order_index,
                creator, created_at, updated_at
            FROM test_case_scripts
            WHERE id = ?
        `, [scriptId]);
        
        if (scripts.length === 0) {
            return res.json({ success: false, message: '脚本不存在' });
        }
        
        res.json({
            success: true,
            script: scripts[0]
        });
        
    } catch (error) {
        logger.error('获取脚本详情失败:', { error: error.message });
        res.json({ success: false, message: '获取脚本详情失败: ' + error.message });
    }
});

router.post('/testcases/:id/scripts', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { script_name, script_type, description, file_path, file_size, original_filename, link_url, link_title, link_type } = req.body;
        const currentUser = req.user;
        
        if (!script_name || !script_name.trim()) {
            return res.json({ success: false, message: '脚本名称不能为空' });
        }
        
        const [caseRows] = await pool.execute('SELECT id FROM test_cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            return res.json({ success: false, message: '测试用例不存在' });
        }
        
        const [maxOrder] = await pool.execute(
            'SELECT COALESCE(MAX(order_index), -1) as max_order FROM test_case_scripts WHERE test_case_id = ?',
            [id]
        );
        const nextOrder = (maxOrder[0].max_order || -1) + 1;
        
        const [result] = await pool.execute(`
            INSERT INTO test_case_scripts 
            (test_case_id, script_name, script_type, description, file_path, file_size, original_filename, link_url, link_title, link_type, order_index, creator)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            script_name.trim(),
            script_type || 'tcl',
            description || '',
            file_path || null,
            file_size || null,
            original_filename || null,
            link_url || null,
            link_title || null,
            link_type || 'external',
            nextOrder,
            currentUser.username
        ]);
        
        const [newScript] = await pool.execute(
            'SELECT * FROM test_case_scripts WHERE id = ?',
            [result.insertId]
        );
        
        res.json({
            success: true,
            message: '脚本添加成功',
            script: newScript[0]
        });
        
    } catch (error) {
        logger.error('添加关联脚本失败:', { error: error.message });
        res.json({ success: false, message: '添加关联脚本失败: ' + error.message });
    }
});

router.put('/testcases/scripts/:scriptId', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        const { script_name, script_type, description, file_path, file_size, original_filename, link_url, link_title, link_type } = req.body;
        
        const [scriptRows] = await pool.execute('SELECT id FROM test_case_scripts WHERE id = ?', [scriptId]);
        if (scriptRows.length === 0) {
            return res.json({ success: false, message: '脚本不存在' });
        }
        
        if (!script_name || !script_name.trim()) {
            return res.json({ success: false, message: '脚本名称不能为空' });
        }
        
        await pool.execute(`
            UPDATE test_case_scripts 
            SET script_name = ?, script_type = ?, description = ?, 
                file_path = ?, file_size = ?, original_filename = ?,
                link_url = ?, link_title = ?, link_type = ?
            WHERE id = ?
        `, [
            script_name.trim(),
            script_type || 'tcl',
            description || '',
            file_path || null,
            file_size || null,
            original_filename || null,
            link_url || null,
            link_title || null,
            link_type || 'external',
            scriptId
        ]);
        
        const [updatedScript] = await pool.execute(
            'SELECT * FROM test_case_scripts WHERE id = ?',
            [scriptId]
        );
        
        res.json({
            success: true,
            message: '脚本更新成功',
            script: updatedScript[0]
        });
        
    } catch (error) {
        logger.error('更新关联脚本失败:', { error: error.message });
        res.json({ success: false, message: '更新关联脚本失败: ' + error.message });
    }
});

router.delete('/testcases/scripts/:scriptId', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        
        const [scriptRows] = await pool.execute('SELECT * FROM test_case_scripts WHERE id = ?', [scriptId]);
        if (scriptRows.length === 0) {
            return res.json({ success: false, message: '脚本不存在' });
        }
        
        const script = scriptRows[0];
        
        if (script.file_path) {
            try {
                if (fs.existsSync(script.file_path)) {
                    fs.unlinkSync(script.file_path);
                }
            } catch (e) {
                logger.warn('删除脚本文件失败:', { error: e.message });
            }
        }
        
        await pool.execute('DELETE FROM test_case_scripts WHERE id = ?', [scriptId]);
        
        res.json({
            success: true,
            message: '脚本删除成功'
        });
        
    } catch (error) {
        logger.error('删除关联脚本失败:', { error: error.message });
        res.json({ success: false, message: '删除关联脚本失败: ' + error.message });
    }
});

router.post('/testcases/scripts/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: '请选择要上传的文件' });
        }
        
        const fileHash = await getFileHash(req.file.path);
        
        res.json({
            success: true,
            file: {
                path: req.file.path,
                size: req.file.size,
                hash: fileHash,
                originalName: req.file.originalname,
                mimetype: req.file.mimetype
            }
        });
        
    } catch (error) {
        logger.error('上传脚本文件失败:', { error: error.message });
        res.json({ success: false, message: '上传脚本文件失败: ' + error.message });
    }
});

router.get('/testcases/scripts/download/:scriptId', authenticateToken, async (req, res) => {
    try {
        const { scriptId } = req.params;
        
        const [scripts] = await pool.execute(
            'SELECT * FROM test_case_scripts WHERE id = ?',
            [scriptId]
        );
        
        if (scripts.length === 0) {
            return res.status(404).json({ success: false, message: '脚本不存在' });
        }
        
        const script = scripts[0];
        
        if (!script.file_path) {
            return res.status(404).json({ success: false, message: '该脚本没有关联文件' });
        }
        
        if (!fs.existsSync(script.file_path)) {
            return res.status(404).json({ success: false, message: '文件不存在' });
        }
        
        const downloadName = script.original_filename || script.script_name;
        
        res.download(script.file_path, downloadName, (err) => {
            if (err) {
                console.error('文件下载失败:', err);
            }
        });
        
    } catch (error) {
        logger.error('下载脚本文件失败:', { error: error.message });
        res.status(500).json({ success: false, message: '下载脚本文件失败: ' + error.message });
    }
});

router.post('/testcases/scripts/batch', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        const { test_case_id, scripts } = req.body;
        const currentUser = req.user;
        
        if (!test_case_id) {
            return res.json({ success: false, message: '缺少测试用例ID' });
        }
        
        if (!Array.isArray(scripts) || scripts.length === 0) {
            return res.json({ success: false, message: '脚本列表不能为空' });
        }
        
        const [caseRows] = await connection.execute('SELECT id FROM test_cases WHERE id = ?', [test_case_id]);
        if (caseRows.length === 0) {
            return res.json({ success: false, message: '测试用例不存在' });
        }
        
        await connection.beginTransaction();
        
        const successScripts = [];
        const failScripts = [];
        
        const [maxOrder] = await connection.execute(
            'SELECT COALESCE(MAX(order_index), -1) as max_order FROM test_case_scripts WHERE test_case_id = ?',
            [test_case_id]
        );
        let nextOrder = (maxOrder[0].max_order || -1) + 1;
        
        for (const script of scripts) {
            try {
                if (!script.script_name || !script.script_name.trim()) {
                    failScripts.push({ script_name: script.script_name, reason: '脚本名称不能为空' });
                    continue;
                }
                
                const [result] = await connection.execute(`
                    INSERT INTO test_case_scripts 
                    (test_case_id, script_name, script_type, description, file_path, file_size, original_filename, link_url, link_title, link_type, order_index, creator)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    test_case_id,
                    script.script_name.trim(),
                    script.script_type || 'tcl',
                    script.description || '',
                    script.file_path || null,
                    script.file_size || null,
                    script.original_filename || null,
                    script.link_url || null,
                    script.link_title || null,
                    script.link_type || 'external',
                    nextOrder++,
                    currentUser.username
                ]);
                
                successScripts.push({
                    id: result.insertId,
                    script_name: script.script_name
                });
                
            } catch (e) {
                failScripts.push({ script_name: script.script_name, reason: e.message });
            }
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            message: `批量添加完成，成功 ${successScripts.length} 个，失败 ${failScripts.length} 个`,
            data: {
                success_count: successScripts.length,
                fail_count: failScripts.length,
                success_scripts: successScripts,
                fail_scripts: failScripts
            }
        });
        
    } catch (error) {
        await connection.rollback();
        logger.error('批量添加脚本失败:', { error: error.message });
        res.json({ success: false, message: '批量添加脚本失败: ' + error.message });
    } finally {
        connection.release();
    }
});

router.put('/testcases/:id/scripts/order', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { orders } = req.body;
        
        if (!Array.isArray(orders) || orders.length === 0) {
            return res.json({ success: false, message: '排序数据不能为空' });
        }
        
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();
            
            for (const item of orders) {
                await connection.execute(
                    'UPDATE test_case_scripts SET order_index = ? WHERE id = ? AND test_case_id = ?',
                    [item.order_index, item.script_id, id]
                );
            }
            
            await connection.commit();
            
            res.json({
                success: true,
                message: '排序更新成功'
            });
            
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
        
    } catch (error) {
        logger.error('更新脚本排序失败:', { error: error.message });
        res.json({ success: false, message: '更新脚本排序失败: ' + error.message });
    }
});

router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.json({ success: false, message: '文件大小超过限制（最大10MB）' });
        }
        return res.json({ success: false, message: '文件上传错误: ' + err.message });
    } else if (err) {
        return res.json({ success: false, message: err.message });
    }
    next();
});

module.exports = router;
