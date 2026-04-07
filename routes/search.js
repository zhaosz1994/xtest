const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function validateSearchParams({ keyword, types, limit, offset }) {
    if (!keyword || typeof keyword !== 'string') {
        return { valid: false, message: '搜索关键词不能为空' };
    }
    
    if (keyword.trim().length < 2) {
        return { valid: false, message: '搜索关键词至少需要 2 个字符' };
    }
    
    if (keyword.length > 100) {
        return { valid: false, message: '搜索关键词不能超过 100 个字符' };
    }
    
    if (types && types !== 'all') {
        const validTypes = ['testplan', 'case', 'post', 'comment', 'script'];
        const inputTypes = types.split(',').map(t => t.trim());
        const invalidTypes = inputTypes.filter(t => !validTypes.includes(t));
        if (invalidTypes.length > 0) {
            return { valid: false, message: `无效的搜索类型: ${invalidTypes.join(', ')}` };
        }
    }
    
    return { valid: true };
}

async function searchTestPlans(keyword, limit, offset) {
    const searchPattern = `%${keyword}%`;
    
    try {
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total
            FROM test_plans
            WHERE name LIKE ? 
               OR project LIKE ? 
               OR owner LIKE ?
               OR test_phase LIKE ?
        `, [searchPattern, searchPattern, searchPattern, searchPattern]);
        
        const total = countResult[0].total;
        
        const [rows] = await pool.execute(`
            SELECT 
                tp.id,
                tp.name,
                tp.project,
                tp.status,
                tp.owner,
                tp.test_phase,
                tp.pass_rate,
                tp.total_cases,
                tp.tested_cases,
                tp.updated_at,
                p.name as project_name
            FROM test_plans tp
            LEFT JOIN projects p ON tp.project = p.code
            WHERE tp.name LIKE ? 
               OR tp.project LIKE ? 
               OR tp.owner LIKE ?
               OR tp.test_phase LIKE ?
            ORDER BY tp.updated_at DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `, [searchPattern, searchPattern, searchPattern, searchPattern]);
        
        return {
            total,
            hasMore: total > offset + limit,
            items: rows.map(row => ({
                id: row.id,
                name: row.name,
                project: row.project,
                projectName: row.project_name || row.project,
                status: row.status,
                owner: row.owner,
                testPhase: row.test_phase,
                passRate: row.pass_rate || 0,
                totalCases: row.total_cases || 0,
                testedCases: row.tested_cases || 0,
                updatedAt: row.updated_at
            }))
        };
    } catch (error) {
        console.error('搜索测试计划错误:', error);
        return { total: 0, hasMore: false, items: [], error: error.message };
    }
}

async function searchTestCases(keyword, limit, offset, userId) {
    const searchPattern = `%${keyword}%`;
    
    try {
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total
            FROM test_cases tc
            LEFT JOIN modules m ON tc.module_id = m.id
            WHERE tc.name LIKE ? 
               OR tc.purpose LIKE ?
               OR m.name LIKE ?
        `, [searchPattern, searchPattern, searchPattern]);
        
        const total = countResult[0].total;
        
        const [rows] = await pool.execute(`
            SELECT 
                tc.id,
                tc.name,
                tc.priority,
                tc.type,
                tc.updated_at,
                m.id as module_id,
                m.name as module_name
            FROM test_cases tc
            LEFT JOIN modules m ON tc.module_id = m.id
            WHERE tc.name LIKE ? 
               OR tc.purpose LIKE ?
               OR m.name LIKE ?
            ORDER BY tc.updated_at DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `, [searchPattern, searchPattern, searchPattern]);
        
        return {
            total,
            hasMore: total > offset + limit,
            items: rows.map(row => ({
                id: row.id,
                name: row.name,
                module: row.module_name || '未分类',
                moduleId: row.module_id,
                priority: row.priority,
                type: row.type || '功能测试',
                updatedAt: row.updated_at
            }))
        };
    } catch (error) {
        console.error('搜索测试用例错误:', error);
        return { total: 0, hasMore: false, items: [], error: error.message };
    }
}

async function searchPosts(keyword, limit, offset) {
    const hasChinese = /[\u4e00-\u9fa5]/.test(keyword);
    
    try {
        let countResult, rows;
        
        if (hasChinese) {
            const searchPattern = `%${keyword}%`;
            
            const [count] = await pool.execute(`
                SELECT COUNT(*) as total
                FROM forum_posts
                WHERE status = 'normal' 
                  AND (title LIKE ? OR content LIKE ?)
            `, [searchPattern, searchPattern]);
            countResult = count;
            
            const [data] = await pool.execute(`
                SELECT 
                    p.id,
                    p.post_id,
                    p.title,
                    p.content,
                    p.view_count,
                    p.comment_count,
                    p.like_count,
                    p.is_anonymous,
                    p.created_at,
                    u.id as author_id,
                    u.username as author_name
                FROM forum_posts p
                LEFT JOIN users u ON p.author_id = u.id
                WHERE p.status = 'normal' 
                  AND (p.title LIKE ? OR p.content LIKE ?)
                ORDER BY p.is_pinned DESC, p.created_at DESC
                LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
            `, [searchPattern, searchPattern]);
            rows = data;
        } else {
            const [count] = await pool.execute(`
                SELECT COUNT(*) as total
                FROM forum_posts
                WHERE status = 'normal'
                  AND MATCH(title, content) AGAINST (? IN BOOLEAN MODE)
            `, [keyword]);
            countResult = count;
            
            const [data] = await pool.execute(`
                SELECT 
                    p.id,
                    p.post_id,
                    p.title,
                    p.content,
                    p.view_count,
                    p.comment_count,
                    p.like_count,
                    p.is_anonymous,
                    p.created_at,
                    u.id as author_id,
                    u.username as author_name
                FROM forum_posts p
                LEFT JOIN users u ON p.author_id = u.id
                WHERE p.status = 'normal'
                  AND MATCH(p.title, p.content) AGAINST (? IN BOOLEAN MODE)
                ORDER BY p.is_pinned DESC, p.created_at DESC
                LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
            `, [keyword]);
            rows = data;
        }
        
        const total = countResult[0].total;
        
        return {
            total,
            hasMore: total > offset + limit,
            items: rows.map(row => ({
                id: row.id,
                postId: row.post_id,
                title: row.title,
                summary: escapeHtml(row.content ? row.content.substring(0, 150).replace(/[#*`>\-\s]/g, ' ').trim() : ''),
                author: row.is_anonymous ? '匿名工程师' : row.author_name,
                authorId: row.is_anonymous ? null : row.author_id,
                isAnonymous: row.is_anonymous === 1,
                viewCount: row.view_count,
                commentCount: row.comment_count,
                likeCount: row.like_count || 0,
                createdAt: row.created_at
            }))
        };
    } catch (error) {
        console.error('搜索论坛帖子错误:', error);
        return { total: 0, hasMore: false, items: [], error: error.message };
    }
}

async function searchComments(keyword, limit, offset) {
    const searchPattern = `%${keyword}%`;
    
    try {
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total
            FROM forum_comments c
            JOIN forum_posts p ON c.post_id = p.id
            WHERE c.status = 'normal' 
              AND p.status = 'normal'
              AND c.content LIKE ?
        `, [searchPattern]);
        
        const total = countResult[0].total;
        
        const [rows] = await pool.execute(`
            SELECT 
                c.id,
                c.content,
                c.post_id,
                c.is_anonymous,
                c.created_at,
                p.title as post_title,
                u.id as author_id,
                u.username as author_name
            FROM forum_comments c
            JOIN forum_posts p ON c.post_id = p.id
            LEFT JOIN users u ON c.author_id = u.id
            WHERE c.status = 'normal' 
              AND p.status = 'normal'
              AND c.content LIKE ?
            ORDER BY c.created_at DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `, [searchPattern]);
        
        return {
            total,
            hasMore: total > offset + limit,
            items: rows.map(row => ({
                id: row.id,
                content: row.content,
                contentPreview: row.content ? row.content.substring(0, 100) : '',
                postId: row.post_id,
                postTitle: row.post_title,
                author: row.is_anonymous ? '匿名工程师' : row.author_name,
                authorId: row.is_anonymous ? null : row.author_id,
                isAnonymous: row.is_anonymous === 1,
                createdAt: row.created_at
            }))
        };
    } catch (error) {
        console.error('搜索论坛评论错误:', error);
        return { total: 0, hasMore: false, items: [], error: error.message };
    }
}

async function searchScripts(keyword, limit, offset) {
    const searchPattern = `%${keyword}%`;
    
    try {
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total
            FROM test_case_scripts
            WHERE script_name LIKE ? 
               OR description LIKE ?
        `, [searchPattern, searchPattern]);
        
        const total = countResult[0].total;
        
        const [rows] = await pool.execute(`
            SELECT 
                s.id,
                s.script_name,
                s.script_type,
                s.description,
                s.test_case_id,
                s.link_url,
                s.link_title,
                s.created_at,
                tc.name as case_name,
                tc.case_id,
                m.name as module_name
            FROM test_case_scripts s
            LEFT JOIN test_cases tc ON s.test_case_id = tc.id
            LEFT JOIN modules m ON tc.module_id = m.id
            WHERE s.script_name LIKE ? 
               OR s.description LIKE ?
            ORDER BY s.created_at DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `, [searchPattern, searchPattern]);
        
        return {
            total,
            hasMore: total > offset + limit,
            items: rows.map(row => ({
                id: row.id,
                scriptName: row.script_name,
                scriptType: row.script_type,
                description: row.description ? row.description.substring(0, 100) : '',
                testCaseId: row.test_case_id,
                caseName: row.case_name,
                caseId: row.case_id,
                moduleName: row.module_name || '未分类',
                linkUrl: row.link_url,
                linkTitle: row.link_title,
                createdAt: row.created_at
            }))
        };
    } catch (error) {
        console.error('搜索脚本错误:', error);
        return { total: 0, hasMore: false, items: [], error: error.message };
    }
}

router.get('/search', authenticateToken, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { keyword, types = 'all', limit = 5, offset = 0 } = req.query;
        const userId = req.user.id;
        
        console.log('[搜索请求] 参数:', { keyword, types, limit, offset, limitType: typeof limit, offsetType: typeof offset });
        
        const validation = validateSearchParams({ keyword, types, limit, offset });
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_PARAMS',
                    message: validation.message
                }
            });
        }
        
        const searchTerm = keyword.trim();
        const limitNum = Math.min(Math.max(1, parseInt(limit) || 5), 20);
        const offsetNum = Math.max(0, parseInt(offset) || 0);
        
        console.log('[搜索请求] 转换后:', { limitNum, offsetNum, limitNumType: typeof limitNum, offsetNumType: typeof offsetNum });
        
        const typeList = types === 'all' 
            ? ['testplan', 'case', 'post', 'comment', 'script'] 
            : types.split(',').map(t => t.trim()).filter(t => 
                ['testplan', 'case', 'post', 'comment', 'script'].includes(t)
              );
        
        const results = {};
        const searchPromises = [];
        
        if (typeList.includes('testplan')) {
            searchPromises.push(
                searchTestPlans(searchTerm, limitNum, offsetNum)
                    .then(r => { results.testPlans = r; })
                    .catch(e => { results.testPlans = { total: 0, items: [], error: e.message }; })
            );
        }
        
        if (typeList.includes('case')) {
            searchPromises.push(
                searchTestCases(searchTerm, limitNum, offsetNum, userId)
                    .then(r => { results.testCases = r; })
                    .catch(e => { results.testCases = { total: 0, items: [], error: e.message }; })
            );
        }
        
        if (typeList.includes('post')) {
            searchPromises.push(
                searchPosts(searchTerm, limitNum, offsetNum)
                    .then(r => { results.posts = r; })
                    .catch(e => { results.posts = { total: 0, items: [], error: e.message }; })
            );
        }
        
        if (typeList.includes('comment')) {
            searchPromises.push(
                searchComments(searchTerm, limitNum, offsetNum)
                    .then(r => { results.comments = r; })
                    .catch(e => { results.comments = { total: 0, items: [], error: e.message }; })
            );
        }
        
        if (typeList.includes('script')) {
            searchPromises.push(
                searchScripts(searchTerm, limitNum, offsetNum)
                    .then(r => { results.scripts = r; })
                    .catch(e => { results.scripts = { total: 0, items: [], error: e.message }; })
            );
        }
        
        await Promise.all(searchPromises);
        
        const totalResults = Object.values(results).reduce((sum, r) => sum + (r.total || 0), 0);
        
        res.json({
            success: true,
            data: results,
            meta: {
                keyword: searchTerm,
                types: typeList,
                searchTime: Date.now() - startTime,
                totalResults
            }
        });
        
    } catch (error) {
        console.error('搜索错误:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: '搜索服务暂时不可用，请稍后重试'
            }
        });
    }
});

module.exports = router;
