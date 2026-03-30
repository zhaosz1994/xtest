const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const { authenticateToken, requireAdmin } = require('./middleware');
const usersRouter = require('./routes/users');
const logger = require('./services/logger');
// 暂时注释掉模块路由，直接在server.js中实现
// const modulesRouter = require('./routes/modules');
const testpointsRouter = require('./routes/testpoints');
const chipsRouter = require('./routes/chips');
const historyModule = require('./routes/history');
const historyRouter = historyModule.router;
const { logActivity } = historyModule;
const snapshotsRouter = require('./routes/snapshots');
const excelRouter = require('./routes/excel');
const testplansRouter = require('./routes/testplans');
const reportsRouter = require('./routes/reports');
const projectsRouter = require('./routes/projects');
const librariesRouter = require('./routes/libraries');
const aiSkillsRouter = require('./routes/aiSkills');
const forumRouter = require('./routes/forum');
const http = require('http');
const socketIO = require('socket.io');
require('dotenv').config();

// 辅助函数：统一处理 INT 字段的空值
function parseIntField(value) {
    if (value === null || value === undefined || value === '' || value === 'null' || value === 'undefined') {
        return null;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
}

const app = express();
const PORT = process.env.PORT || 3000;

const cors_config = {
    origin: function (origin, callback) {
        const allowedOrigins = process.env.CORS_ORIGINS 
            ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
            : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://10.10.25.154:8000'];
        
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`[CORS] 拒绝来自 ${origin} 的请求`);
            callback(new Error('不允许的来源'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(cors_config));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 静态文件服务 - 暴露 public 目录
app.use(express.static(path.join(__dirname, 'public')));
// 额外暴露根目录的 CSS 和 JS 文件
app.use('/styles.css', express.static(path.join(__dirname, 'styles.css')));
app.use('/styles-dashboard.css', express.static(path.join(__dirname, 'styles-dashboard.css')));
app.use('/styles-theme.css', express.static(path.join(__dirname, 'styles-theme.css')));
app.use('/styles-design-system.css', express.static(path.join(__dirname, 'styles-design-system.css')));
app.use('/script.js', express.static(path.join(__dirname, 'script.js')));
app.use('/context-menu.css', express.static(path.join(__dirname, 'context-menu.css')));
app.use('/js', express.static(path.join(__dirname, 'js')));

// 根路径重定向到 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// 路由
app.use('/api/users', usersRouter);
// 暂时注释掉模块路由，直接在server.js中实现
// app.use('/api/modules', modulesRouter);
app.use('/api/testpoints', testpointsRouter);
app.use('/api/chips', chipsRouter);
app.use('/api/history', historyRouter);
app.use('/api/snapshots', snapshotsRouter);
app.use('/api/excel', excelRouter);
app.use('/api/testplans', testplansRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/libraries', librariesRouter);
app.use('/api/ai-skills', aiSkillsRouter.router);
app.use('/api/email', require('./routes/email'));
app.use('/api/templates', require('./routes/reportTemplates'));
app.use('/api/forum', forumRouter);
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/testcases', require('./routes/testcases'));

// 配置数据 API 端点（不带认证，供前端下拉框使用）
app.get('/priorities/list', async (req, res) => {
  try {
    const [priorities] = await pool.execute('SELECT id, name FROM test_priorities ORDER BY id');
    res.json({ success: true, priorities });
  } catch (error) {
    console.error('获取优先级列表错误:', error);
    res.json({ success: false, priorities: [], message: '获取失败' });
  }
});

app.get('/test-types/list', async (req, res) => {
  try {
    const [testTypes] = await pool.execute('SELECT id, name FROM test_types ORDER BY id');
    res.json({ success: true, testTypes });
  } catch (error) {
    console.error('获取测试类型列表错误:', error);
    res.json({ success: false, testTypes: [], message: '获取失败' });
  }
});

app.get('/test-phases/list', async (req, res) => {
  try {
    const [testPhases] = await pool.execute('SELECT id, name FROM test_phases ORDER BY id');
    res.json({ success: true, testPhases });
  } catch (error) {
    console.error('获取测试阶段列表错误:', error);
    res.json({ success: false, testPhases: [], message: '获取失败' });
  }
});

app.get('/environments/list', async (req, res) => {
  try {
    const [environments] = await pool.execute('SELECT id, name FROM environments ORDER BY id');
    res.json({ success: true, environments });
  } catch (error) {
    console.error('获取环境列表错误:', error);
    res.json({ success: false, environments: [], message: '获取失败' });
  }
});

// 用户列表 API（供前端负责人下拉框使用）
app.get('/users/list', async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT id, username FROM users ORDER BY username');
    res.json({ success: true, users });
  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.json({ success: false, users: [], message: '获取失败' });
  }
});

// 一级测试点列表 API（供批量创建用例页面使用）
app.post('/testpoints/level1/all', async (req, res) => {
  const { libraryId, keyword } = req.body;

  try {
    let query = `
      SELECT 
        l1.id, 
        l1.name, 
        l1.test_type, 
        l1.created_at, 
        l1.updated_at,
        l1.order_index,
        COUNT(tc.id) as test_case_count,
        m.name as module_name, 
        m.id as module_id
      FROM level1_points l1
      JOIN modules m ON l1.module_id = m.id
      LEFT JOIN test_cases tc ON l1.id = tc.level1_id
      WHERE m.library_id = ?
    `;
    
    const params = [libraryId];
    
    if (keyword && keyword.trim() !== '') {
      query += ' AND l1.name LIKE ?';
      params.push(`%${keyword.trim()}%`);
    }
    
    query += ' GROUP BY l1.id, l1.name, l1.test_type, l1.created_at, l1.updated_at, l1.order_index, m.name, m.id ORDER BY m.order_index ASC, l1.order_index ASC';
    
    const [points] = await pool.execute(query, params);
    res.json({ success: true, level1Points: points });
  } catch (error) {
    console.error('获取所有一级测试点错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 静态文件服务 - 用于访问上传的图片
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// 直接在server.js中实现模块路由
app.post('/api/modules/list', async (req, res) => {
  try {
    console.log('接收到模块列表请求:', req.body);
    const { libraryId, page = 1, pageSize = 32 } = req.body;
    const offset = (page - 1) * pageSize;
    
    let query = `
      SELECT 
        m.id, 
        m.module_id, 
        m.name, 
        m.library_id, 
        m.order_index,
        (SELECT COUNT(*) FROM level1_points l1 WHERE l1.module_id = m.id) as level1_count,
        (SELECT COUNT(*) FROM test_cases tc WHERE tc.module_id = m.id AND tc.is_deleted = 0) as case_count
      FROM modules m
      WHERE 1=1
    `;
    let params = [];
    
    if (libraryId) {
      query += ' AND m.library_id = ?';
      params.push(libraryId);
    }
    
    query += ` 
      ORDER BY m.order_index ASC, m.created_at DESC 
      LIMIT ${parseInt(pageSize)} OFFSET ${parseInt(offset)}
    `;
    
    console.log('执行SQL查询:', query);
    console.log('查询参数:', params);
    
    const [modules] = await pool.query(query, params);
    
    console.log('查询结果:', modules);
    
    res.json({ 
      success: true,
      modules: modules.map(module => ({
        id: module.id,
        name: module.name,
        orderIndex: module.order_index,
        level1Count: module.level1_count || 0,
        caseCount: module.case_count || 0
      }))
    });
  } catch (error) {
    console.error('获取模块列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

app.post('/api/modules/create', async (req, res) => {
  try {
    console.log('接收到创建模块请求:', req.body);
    const { name, libraryId, parentId } = req.body;
    
    // 验证模块名唯一性
    if (libraryId) {
      console.log('验证模块名唯一性:', { libraryId, name });
      const [existingModules] = await pool.execute(
        'SELECT COUNT(*) as count FROM modules WHERE library_id = ? AND name = ?',
        [libraryId, name]
      );
      console.log('唯一性检查结果:', existingModules[0]);
      
      if (existingModules[0].count > 0) {
        console.log('模块名已存在，拒绝创建');
        return res.json({ success: false, message: '该用例库下已存在同名模块' });
      }
    }
    
    // 生成唯一的module_id
    const moduleId = 'MODULE_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    // 获取当前最大的order_index
    let orderIndex = 0;
    if (libraryId) {
      const [result] = await pool.execute(
        'SELECT MAX(order_index) as max_order FROM modules WHERE library_id = ?',
        [libraryId]
      );
      if (result[0].max_order !== null) {
        orderIndex = result[0].max_order + 1;
      }
    }
    
    console.log('插入新模块:', { name, libraryId, moduleId, orderIndex, parentId });
    
    await pool.execute(
      'INSERT INTO modules (module_id, name, library_id, order_index, parent_id) VALUES (?, ?, ?, ?, ?)',
      [moduleId, name, libraryId, orderIndex, parentId || null]
    );
    
    res.json({ success: true, message: '模块添加成功' });
  } catch (error) {
    console.error('添加模块错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

app.post('/api/modules/update', async (req, res) => {
  try {
    console.log('接收到更新模块请求:', req.body);
    const { id, name, libraryId } = req.body;
    
    // 验证模块名唯一性
    if (libraryId) {
      console.log('验证模块名唯一性:', { libraryId, name, id });
      const [existingModules] = await pool.execute(
        'SELECT COUNT(*) as count FROM modules WHERE library_id = ? AND name = ? AND id != ?',
        [libraryId, name, id]
      );
      console.log('唯一性检查结果:', existingModules[0]);
      
      if (existingModules[0].count > 0) {
        console.log('模块名已存在，拒绝更新');
        return res.json({ success: false, message: '该用例库下已存在同名模块' });
      }
    }
    
    console.log('更新模块:', { id, name });
    
    await pool.execute(
      'UPDATE modules SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, id]
    );
    
    res.json({ success: true, message: '模块更新成功' });
  } catch (error) {
    console.error('更新模块错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

app.post('/api/modules/delete', async (req, res) => {
  try {
    console.log('接收到删除模块请求:', req.body);
    const { id, libraryId } = req.body;
    
    console.log('删除模块:', { id, libraryId });
    
    await pool.execute(
      'DELETE FROM modules WHERE id = ? AND library_id = ?',
      [id, libraryId]
    );
    
    res.json({ success: true, message: '模块删除成功' });
  } catch (error) {
    console.error('删除模块错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

app.post('/api/modules/search', async (req, res) => {
  try {
    console.log('接收到模块搜索请求:', req.body);
    const { libraryId, searchTerm, page = 1, pageSize = 32 } = req.body;
    const offset = (page - 1) * pageSize;
    
    let query = `
      SELECT 
        m.id, 
        m.module_id, 
        m.name, 
        m.library_id, 
        m.order_index, 
        COUNT(l1.id) as level1_count
      FROM modules m
      LEFT JOIN level1_points l1 ON m.id = l1.module_id
      WHERE 1=1
    `;
    let params = [];
    
    if (libraryId) {
      query += ' AND m.library_id = ?';
      params.push(libraryId);
    }
    
    if (searchTerm) {
      query += ' AND m.name LIKE ?';
      params.push('%' + searchTerm + '%');
    }
    
    query += ` 
      GROUP BY m.id, m.module_id, m.name, m.library_id, m.order_index 
      ORDER BY m.order_index ASC, m.created_at DESC 
      LIMIT ${parseInt(pageSize)} OFFSET ${parseInt(offset)}
    `;
    
    console.log('执行SQL查询:', query);
    console.log('查询参数:', params);
    
    const [modules] = await pool.query(query, params);
    
    console.log('查询结果:', modules);
    
    res.json({ 
      success: true,
      modules: modules.map(module => ({
        id: module.id,
        name: module.name,
        orderIndex: module.order_index,
        level1Count: module.level1_count
      }))
    });
  } catch (error) {
    console.error('搜索模块错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误' });
  }
});

app.post('/api/modules/reorder', async (req, res) => {
  try {
    console.log('接收到模块重排序请求:', req.body);
    const { modules, libraryId } = req.body;
    
    if (!Array.isArray(modules) || !libraryId) {
      return res.json({ success: false, message: '参数错误' });
    }
    
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 更新每个模块的order_index
      for (let i = 0; i < modules.length; i++) {
        await connection.execute(
          'UPDATE modules SET order_index = ? WHERE name = ? AND library_id = ?',
          [i, modules[i], libraryId]
        );
      }
      
      await connection.commit();
      res.json({ success: true, message: '模块顺序调整成功' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('调整模块顺序错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误' });
  }
});

app.post('/api/modules/batchCreate', async (req, res) => {
  try {
    console.log('接收到批量创建模块请求:', req.body);
    const { modules } = req.body;
    
    if (!Array.isArray(modules)) {
      return res.json({ success: false, message: '参数错误' });
    }
    
    for (const module of modules) {
      const moduleId = 'MODULE_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      await pool.execute(
        'INSERT INTO modules (module_id, name, library_id) VALUES (?, ?, ?)',
        [moduleId, module.name, module.libraryId]
      );
    }
    
    res.json({ success: true, message: '批量创建模块成功' });
  } catch (error) {
    console.error('批量创建模块错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误' });
  }
});

// 获取指定项目关联的模块列表（通过测试用例关联）
app.get('/api/modules/by-project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const [modules] = await pool.execute(`
      SELECT DISTINCT m.id, m.module_id, m.name, COUNT(DISTINCT tc.id) as case_count
      FROM modules m
      INNER JOIN test_cases tc ON m.id = tc.module_id
      INNER JOIN test_case_projects tcp ON tc.id = tcp.test_case_id
      WHERE tcp.project_id = ? AND (tc.is_deleted = 0 OR tc.is_deleted IS NULL)
      GROUP BY m.id, m.module_id, m.name
      ORDER BY m.order_index ASC, m.created_at DESC
    `, [projectId]);
    
    res.json({ 
      success: true, 
      modules: modules.map(m => ({
        id: m.id,
        moduleId: m.module_id,
        name: m.name,
        caseCount: m.case_count || 0
      }))
    });
  } catch (error) {
    console.error('获取项目模块列表错误:', error);
    res.json({ success: false, message: '服务器错误' });
  }
});

// 克隆模块（深度复制模块及其内容）
app.post('/api/modules/clone', authenticateToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { 
      sourceModuleId, 
      newModuleName, 
      targetLibraryId,
      includeLevel1Points = true,
      includeTestCases = true,
      resetExecutionStatus = true,
      resetBugId = true,
      resetOwner = true
    } = req.body;
    
    const currentUser = req.user;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');
    
    if (!sourceModuleId || !newModuleName || !targetLibraryId) {
      return res.json({ success: false, message: '缺少必要参数' });
    }
    
    await connection.beginTransaction();
    
    // 1. 获取源模块信息
    const [sourceModules] = await connection.execute(
      'SELECT * FROM modules WHERE id = ?',
      [sourceModuleId]
    );
    
    if (sourceModules.length === 0) {
      await connection.rollback();
      return res.json({ success: false, message: '源模块不存在' });
    }
    
    const sourceModule = sourceModules[0];
    
    // 2. 创建新模块
    const newModuleId = 'MODULE_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const [moduleResult] = await connection.execute(
      'INSERT INTO modules (module_id, name, library_id, order_index) VALUES (?, ?, ?, ?)',
      [newModuleId, newModuleName, targetLibraryId, 0]
    );
    const newModuleDbId = moduleResult.insertId;
    
    console.log(`[克隆] 创建新模块: ${newModuleName}, ID: ${newModuleDbId}`);
    
    // ID映射表：old_id -> new_id
    const level1IdMap = new Map();
    let clonedLevel1Count = 0;
    let clonedCaseCount = 0;
    
    // 3. 克隆一级测试点
    if (includeLevel1Points) {
      const [level1Points] = await connection.execute(
        'SELECT * FROM level1_points WHERE module_id = ? ORDER BY order_index ASC',
        [sourceModuleId]
      );
      
      for (const level1 of level1Points) {
        const [level1Result] = await connection.execute(
          'INSERT INTO level1_points (module_id, name, test_type, order_index) VALUES (?, ?, ?, ?)',
          [newModuleDbId, level1.name, level1.test_type, level1.order_index]
        );
        
        level1IdMap.set(level1.id, level1Result.insertId);
        clonedLevel1Count++;
      }
      
      console.log(`[克隆] 克隆了 ${clonedLevel1Count} 个一级测试点`);
    }
    
    // 4. 克隆测试用例
    if (includeTestCases) {
      const [testCases] = await connection.execute(
        'SELECT * FROM test_cases WHERE module_id = ?',
        [sourceModuleId]
      );
      
      // 测试用例ID映射表：old_id -> new_id
      const testCaseIdMap = new Map();
      
      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        // 生成新的case_id - 使用时间戳+索引+随机数确保唯一性
        const newCaseId = `CASE-${Date.now()}-${i}-${Math.floor(Math.random() * 100000)}`;
        
        // 确定level1_id的映射
        let newLevel1Id = null;
        if (tc.level1_id && level1IdMap.has(tc.level1_id)) {
          newLevel1Id = level1IdMap.get(tc.level1_id);
        }
        
        // 处理需要重置的字段
        let owner = tc.owner;
        let status = tc.status;
        
        if (resetOwner) {
          owner = null;
        }
        if (resetExecutionStatus) {
          status = '维护中';
        }
        
        // 插入新测试用例
        const [result] = await connection.execute(
          `INSERT INTO test_cases (
            case_id, name, priority, type, precondition, purpose, 
            steps, expected, creator, library_id, module_id, level1_id,
            owner, key_config, remark, method, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newCaseId,
            tc.name,
            tc.priority,
            tc.type,
            tc.precondition,
            tc.purpose,
            tc.steps,
            tc.expected,
            currentUser.username,
            targetLibraryId,
            newModuleDbId,
            newLevel1Id,
            owner,
            tc.key_config,
            tc.remark,
            tc.method,
            status
          ]
        );
        
        // 记录测试用例ID映射
        testCaseIdMap.set(tc.id, result.insertId);
        clonedCaseCount++;
      }
      
      console.log(`[克隆] 克隆了 ${clonedCaseCount} 个测试用例`);
      
      // 5. 克隆测试用例的关联环境
      if (testCaseIdMap.size > 0) {
        const [envRelations] = await connection.execute(
          `SELECT tce.test_case_id, tce.environment_id 
           FROM test_case_environments tce 
           JOIN test_cases tc ON tce.test_case_id = tc.id 
           WHERE tc.module_id = ?`,
          [sourceModuleId]
        );
        
        if (envRelations.length > 0) {
          const envInsertValues = envRelations
            .filter(rel => testCaseIdMap.has(rel.test_case_id))
            .map(rel => `(${testCaseIdMap.get(rel.test_case_id)}, ${rel.environment_id})`)
            .join(',');
          
          await connection.execute(
            `INSERT IGNORE INTO test_case_environments (test_case_id, environment_id) 
             VALUES ${envInsertValues}`
          );
        }
      }
      
      // 6. 克隆测试用例的关联来源
      if (testCaseIdMap.size > 0) {
        const [sourceRelations] = await connection.execute(
          `SELECT tcs.test_case_id, tcs.source_id 
           FROM test_case_sources tcs 
           JOIN test_cases tc ON tcs.test_case_id = tc.id 
           WHERE tc.module_id = ?`,
          [sourceModuleId]
        );
        
        if (sourceRelations.length > 0) {
          const sourceInsertValues = sourceRelations
            .filter(rel => testCaseIdMap.has(rel.test_case_id))
            .map(rel => `(${testCaseIdMap.get(rel.test_case_id)}, ${rel.source_id})`)
            .join(',');
          
          await connection.execute(
            `INSERT IGNORE INTO test_case_sources (test_case_id, source_id) 
             VALUES ${sourceInsertValues}`
          );
        }
      }
      
      // 7. 克隆测试用例的关联项目
      if (testCaseIdMap.size > 0) {
        const [projectRelations] = await connection.execute(
          `SELECT tcp.test_case_id, tcp.project_id, tcp.owner, tcp.progress_id, tcp.status_id, tcp.remark 
           FROM test_case_projects tcp 
           JOIN test_cases tc ON tcp.test_case_id = tc.id 
           WHERE tc.module_id = ?`,
          [sourceModuleId]
        );
        
        if (projectRelations.length > 0) {
          const projectInsertValues = projectRelations
            .filter(rel => testCaseIdMap.has(rel.test_case_id))
            .map(rel => {
              const newOwner = resetOwner ? null : rel.owner;
              return `(${testCaseIdMap.get(rel.test_case_id)}, ${rel.project_id}, ${newOwner ? `'${connection.escape(newOwner)}'` : 'NULL'}, ${rel.progress_id || 'NULL'}, ${rel.status_id || 'NULL'}, '${connection.escape(rel.remark || '')}', CURRENT_TIMESTAMP)`;
            })
            .join(',');
          
          await connection.execute(
            `INSERT IGNORE INTO test_case_projects (test_case_id, project_id, owner, progress_id, status_id, remark, created_at) 
             VALUES ${projectInsertValues}`
          );
        }
      }
      
      // 8. 克隆测试用例的关联测试阶段
      if (testCaseIdMap.size > 0) {
        const [phaseRelations] = await connection.execute(
          `SELECT tcp.test_case_id, tcp.phase_id 
           FROM test_case_phases tcp 
           JOIN test_cases tc ON tcp.test_case_id = tc.id 
           WHERE tc.module_id = ?`,
          [sourceModuleId]
        );
        
        if (phaseRelations.length > 0) {
          const phaseInsertValues = phaseRelations
            .filter(rel => testCaseIdMap.has(rel.test_case_id))
            .map(rel => `(${testCaseIdMap.get(rel.test_case_id)}, ${rel.phase_id})`)
            .join(',');
          
          await connection.execute(
            `INSERT IGNORE INTO test_case_phases (test_case_id, phase_id) 
             VALUES ${phaseInsertValues}`
          );
        }
      }
      
      // 9. 克隆测试用例的关联测试方式
      if (testCaseIdMap.size > 0) {
        const [methodRelations] = await connection.execute(
          `SELECT tcm.test_case_id, tcm.method_id 
           FROM test_case_methods tcm 
           JOIN test_cases tc ON tcm.test_case_id = tc.id 
           WHERE tc.module_id = ?`,
          [sourceModuleId]
        );
        
        if (methodRelations.length > 0) {
          const methodInsertValues = methodRelations
            .filter(rel => testCaseIdMap.has(rel.test_case_id))
            .map(rel => `(${testCaseIdMap.get(rel.test_case_id)}, ${rel.method_id})`)
            .join(',');
          
          await connection.execute(
            `INSERT IGNORE INTO test_case_methods (test_case_id, method_id) 
             VALUES ${methodInsertValues}`
          );
        }
      }
    }
    
    // 5. 记录操作日志
    await logActivity(
      currentUser.id, 
      currentUser.username, 
      currentUser.role, 
      '克隆模块', 
      `从模块 "${sourceModule.name}" 克隆创建新模块 "${newModuleName}"，包含 ${clonedLevel1Count} 个测试点，${clonedCaseCount} 个用例`, 
      'module', 
      newModuleDbId, 
      ipAddress, 
      userAgent
    );
    
    await connection.commit();
    
    res.json({ 
      success: true, 
      message: '模块克隆成功',
      data: {
        moduleId: newModuleDbId,
        moduleName: newModuleName,
        clonedLevel1Count,
        clonedCaseCount
      }
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('克隆模块错误:', error);
    res.json({ success: false, message: '克隆失败: ' + error.message });
  } finally {
    connection.release();
  }
});

// 获取指定用例库下的模块列表（用于克隆选择）
app.get('/api/modules/by-library/:libraryId', async (req, res) => {
  try {
    const { libraryId } = req.params;
    
    const [modules] = await pool.execute(
      'SELECT id, module_id, name FROM modules WHERE library_id = ? ORDER BY order_index ASC, created_at DESC',
      [libraryId]
    );
    
    res.json({ 
      success: true, 
      modules: modules.map(m => ({
        id: m.id,
        moduleId: m.module_id,
        name: m.name
      }))
    });
  } catch (error) {
    console.error('获取模块列表错误:', error);
    res.json({ success: false, message: '服务器错误' });
  }
});

// 添加一级测试点
app.post('/api/testpoints/level1/add', authenticateToken, async (req, res) => {
  try {
    console.log('接收到添加一级测试点请求:', req.body);
    const { name, test_type, module_id } = req.body;
    
    if (!name || !module_id) {
      return res.json({ success: false, message: '测试点名称和模块ID不能为空' });
    }
    
    const numericModuleId = parseInt(module_id);
    if (isNaN(numericModuleId)) {
      return res.json({ success: false, message: '模块ID无效' });
    }
    
    // 获取当前模块下最大的order_index
    const [existingPoints] = await pool.execute(
      'SELECT MAX(order_index) as max_order FROM level1_points WHERE module_id = ?',
      [numericModuleId]
    );
    const nextOrder = (existingPoints[0]?.max_order || 0) + 1;
    
    // 插入一级测试点
    const [result] = await pool.execute(
      'INSERT INTO level1_points (module_id, name, test_type, order_index) VALUES (?, ?, ?, ?)',
      [numericModuleId, name, test_type || '功能测试', nextOrder]
    );
    
    console.log('一级测试点添加成功，ID:', result.insertId);
    
    res.json({ 
      success: true, 
      message: '一级测试点添加成功',
      data: {
        id: result.insertId,
        name,
        test_type: test_type || '功能测试',
        module_id: numericModuleId,
        order_index: nextOrder
      }
    });
  } catch (error) {
    console.error('添加一级测试点错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取模块下的一级测试点列表
app.get('/api/testpoints/level1/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const numericModuleId = parseInt(moduleId);
    
    if (isNaN(numericModuleId)) {
      return res.json({ success: false, message: '模块ID无效' });
    }
    
    const [points] = await pool.execute(
      'SELECT * FROM level1_points WHERE module_id = ? ORDER BY order_index ASC, created_at ASC',
      [numericModuleId]
    );
    
    res.json({ 
      success: true, 
      points: points.map(p => ({
        id: p.id,
        name: p.name,
        test_type: p.test_type,
        module_id: p.module_id,
        order_index: p.order_index,
        created_at: p.created_at,
        updated_at: p.updated_at
      }))
    });
  } catch (error) {
    console.error('获取一级测试点列表错误:', error);
    res.json({ success: false, message: '服务器错误' });
  }
});


// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 测试端点
app.get('/api/test', (req, res) => {
  console.log('接收到测试请求');
  res.json({ success: true, message: '测试成功', timestamp: new Date().toISOString() });
});

// 测试用例管理路由
app.post('/api/cases/create', async (req, res) => {
  try {
    console.log('接收到创建测试用例请求:', req.body);
    const { 
      caseId, 
      name, 
      priority, 
      type, 
      precondition, 
      purpose, 
      steps, 
      expected, 
      creator, 
      owner,
      libraryId, 
      moduleId, 
      level1Id,
      projects,
      environments,
      methods,
      testTypes,
      testStatuses,
      phases
    } = req.body;
    
    // 验证必填字段
    if (!name || !moduleId || !environments || !Array.isArray(environments) || environments.length === 0 || !methods || !Array.isArray(methods) || methods.length === 0) {
      return res.json({ success: false, message: '测试用例名称、模块ID、测试环境和测试方式不能为空' });
    }
    
    // 确保phases是数组（如果提供的话）
    if (phases && !Array.isArray(phases)) {
      phases = [];
    }
    
    // 验证数据类型
    console.log('Data types:', {
      caseId: typeof caseId,
      name: typeof name,
      priority: typeof priority,
      type: typeof type,
      precondition: typeof precondition,
      purpose: typeof purpose,
      steps: typeof steps,
      expected: typeof expected,
      creator: typeof creator,
      libraryId: typeof libraryId,
      moduleId: typeof moduleId,
      level1Id: typeof level1Id,
      projects: typeof projects,
      environments: typeof environments,
      methods: typeof methods,
      testTypes: typeof testTypes,
      testStatuses: typeof testStatuses
    });
    
    // 确保所有参数都有默认值，避免undefined
    const safeCaseId = caseId || 'CASE_' + Date.now();
    const safePriority = priority || 'medium';
    const safeType = type || 'functional';
    const safePrecondition = precondition || '';
    const safePurpose = purpose || '';
    const safeSteps = steps || '';
    const safeExpected = expected || '';
    const safeCreator = creator || 'admin';
    const safeOwner = owner || safeCreator;
    const safeRemark = req.body.remark || '';
    
    // 转换类型
    const numericModuleId = parseInt(moduleId);
    const numericLevel1Id = level1Id ? parseInt(level1Id) : null;
    const numericLibraryId = libraryId ? parseInt(libraryId) : null;
    
    // 验证转换后的moduleId是否有效
    if (isNaN(numericModuleId)) {
      return res.json({ success: false, message: '模块ID无效，请选择正确的模块' });
    }
    
    console.log('Safe values:', {
      caseId: safeCaseId,
      priority: safePriority,
      type: safeType,
      precondition: safePrecondition,
      purpose: safePurpose,
      steps: safeSteps,
      expected: safeExpected,
      creator: safeCreator
    });
    
    console.log('Converted values:', {
      moduleId: numericModuleId,
      level1Id: numericLevel1Id,
      libraryId: numericLibraryId
    });
    
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 检查同一模块下测试用例名称是否重复
      const [existingCases] = await connection.execute(
        'SELECT id FROM test_cases WHERE name = ? AND module_id = ? AND is_deleted = 0',
        [name, numericModuleId]
      );
      if (existingCases.length > 0) {
        await connection.rollback();
        connection.release();
        return res.json({ 
          success: false, 
          message: '该模块下已存在同名测试用例，请使用其他名称' 
        });
      }
      
      // 首先创建测试用例记录
      const [result] = await connection.execute(
        `INSERT INTO test_cases (
          case_id, 
          name, 
          priority, 
          type, 
          precondition, 
          purpose, 
          steps, 
          expected, 
          creator, 
          owner,
          library_id, 
          module_id,
          level1_id,
          key_config,
          remark
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [safeCaseId, name, safePriority, safeType, safePrecondition, safePurpose, safeSteps, safeExpected, safeCreator, safeOwner, numericLibraryId, numericModuleId, numericLevel1Id, req.body.key_config || '', safeRemark]
      );
      
      const testCaseId = result.insertId;
      console.log('测试用例创建成功，ID:', testCaseId);
      
      // 处理项目关联
      if (projects && projects.length > 0) {
        // 如果提供了projectAssociations，则使用详细关联数据
        if (req.body.projectAssociations && Array.isArray(req.body.projectAssociations)) {
          for (const association of req.body.projectAssociations) {
            // 处理可能的undefined值，使用 parseIntField 统一处理 INT 字段
            const projectId = parseIntField(association.project_id || association.id);
            const progressId = parseIntField(association.progress_id || association.progressId);
            const statusId = parseIntField(association.status_id || association.statusId);
            const owner = association.owner || null;
            const remark = association.remark || '';
            
            if (projectId) {
              await connection.execute(
                `INSERT INTO test_case_projects (
                  test_case_id, 
                  project_id, 
                  progress_id,
                  status_id,
                  owner,
                  remark,
                  created_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [testCaseId, projectId, progressId, statusId, owner, remark]
              );
            }
          }
        } else {
          // 兼容旧版API，只使用项目ID
          for (const projectId of projects) {
            await connection.execute(
              `INSERT INTO test_case_projects (
                test_case_id, 
                project_id, 
                created_at
              ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
              [testCaseId, projectId]
            );
          }
        }
        console.log('项目关联添加成功');
      }
      
      // 处理环境关联
      if (environments && environments.length > 0) {
        for (const environmentId of environments) {
          await connection.execute(
            `INSERT INTO test_case_environments (
              test_case_id, 
              environment_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [testCaseId, environmentId]
          );
        }
        console.log('环境关联添加成功');
      }
      
      // 处理测试点来源关联
      const sources = req.body.sources;
      if (sources && sources.length > 0) {
        for (const sourceId of sources) {
          await connection.execute(
            `INSERT INTO test_case_sources (
              test_case_id, 
              source_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [testCaseId, sourceId]
          );
        }
        console.log('测试点来源关联添加成功');
      }
      
      // 处理测试方式关联
      if (methods && methods.length > 0) {
        for (const methodId of methods) {
          await connection.execute(
            `INSERT INTO test_case_methods (
              test_case_id, 
              method_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [testCaseId, methodId]
          );
        }
        console.log('测试方式关联添加成功');
      }
      
      // 处理测试类型关联
      if (testTypes && Array.isArray(testTypes) && testTypes.length > 0) {
        for (const testTypeId of testTypes) {
          await connection.execute(
            `INSERT INTO test_case_test_types (
              test_case_id, 
              test_type_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [testCaseId, testTypeId]
          );
        }
        console.log('测试类型关联添加成功');
      }
      
      // 处理测试状态关联
      if (testStatuses && Array.isArray(testStatuses) && testStatuses.length > 0) {
        for (const statusId of testStatuses) {
          await connection.execute(
            `INSERT INTO test_case_statuses (
              test_case_id, 
              status_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [testCaseId, statusId]
          );
        }
        console.log('测试状态关联添加成功');
      }
      
      // 处理测试阶段关联
      if (phases && Array.isArray(phases) && phases.length > 0) {
        for (const phaseId of phases) {
          await connection.execute(
            `INSERT INTO test_case_phases (
              test_case_id, 
              phase_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [testCaseId, phaseId]
          );
        }
        console.log('测试阶段关联添加成功');
      }
      
      await connection.commit();
      res.json({ success: true, message: '测试用例创建成功', testCaseId });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error('创建测试用例错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

app.post('/api/cases/list', async (req, res) => {
  try {
    console.log('接收到测试用例列表请求:', req.body);
    const { libraryId, moduleId, level1Id, page = 1, pageSize = 32 } = req.body;
    const offset = (page - 1) * pageSize;
    
    let query = 'SELECT id, case_id, name, priority, type, method, status, key_config, precondition, purpose, steps, expected, remark, creator, owner, library_id, module_id, level1_id, created_at, updated_at FROM test_cases WHERE 1=1';
    let params = [];
    
    // 转换为正确的数据类型，并确保是有效的数字
    const numericLibraryId = libraryId && libraryId !== 'all' ? parseInt(libraryId) : null;
    const numericModuleId = moduleId && moduleId !== 'all' ? parseInt(moduleId) : null;
    const numericLevel1Id = level1Id && level1Id !== 'all' ? parseInt(level1Id) : null;
    
    // 确保page和pageSize是有效的数字，默认为1和32
    const safePage = parseInt(page) || 1;
    const safePageSize = parseInt(pageSize) || 32;
    const safeOffset = (safePage - 1) * safePageSize;
    
    // 确保numericPageSize和numericOffset是有效的数字
    const numericPageSize = isNaN(safePageSize) ? 32 : safePageSize;
    const numericOffset = isNaN(safeOffset) ? 0 : safeOffset;
    
    if (numericLibraryId !== null && !isNaN(numericLibraryId)) {
      query += ' AND library_id = ?';
      params.push(numericLibraryId);
    }
    
    if (numericModuleId !== null && !isNaN(numericModuleId)) {
      query += ' AND module_id = ?';
      params.push(numericModuleId);
    }
    
    if (numericLevel1Id !== null && !isNaN(numericLevel1Id)) {
      query += ' AND level1_id = ?';
      params.push(numericLevel1Id);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(numericPageSize, numericOffset);
    
    console.log('执行SQL查询:', query);
    console.log('查询参数:', params);
    
    // 确保所有参数都是原始类型的数字
    const safeParams = params.map(param => {
      if (typeof param === 'number') {
        return param;
      } else if (typeof param === 'string') {
        return parseInt(param) || 0;
      } else {
        return 0;
      }
    });
    
    console.log('安全参数:', safeParams);
    
    // 使用query方法代替execute方法，可能对参数类型的处理更宽松
    const [testCases] = await pool.query(query, safeParams);
    
    // 获取所有测试用例的ID
    const testCaseIds = testCases.map(tc => tc.id);
    
    // 获取测试用例的关联环境
    let environmentsMap = new Map();
    if (testCaseIds.length > 0) {
      const envQuery = `
        SELECT tce.test_case_id, e.name 
        FROM test_case_environments tce 
        JOIN environments e ON tce.environment_id = e.id 
        WHERE tce.test_case_id IN (${testCaseIds.map(() => '?').join(',')})
      `;
      const [envResults] = await pool.query(envQuery, testCaseIds);
      envResults.forEach(result => {
        if (!environmentsMap.has(result.test_case_id)) {
          environmentsMap.set(result.test_case_id, []);
        }
        environmentsMap.get(result.test_case_id).push(result.name);
      });
    }
    
    // 获取测试用例的关联来源
    let sourcesMap = new Map();
    if (testCaseIds.length > 0) {
      const sourceQuery = `
        SELECT tcs.test_case_id, s.name 
        FROM test_case_sources tcs 
        JOIN test_sources s ON tcs.source_id = s.id 
        WHERE tcs.test_case_id IN (${testCaseIds.map(() => '?').join(',')})
      `;
      const [sourceResults] = await pool.query(sourceQuery, testCaseIds);
      sourceResults.forEach(result => {
        if (!sourcesMap.has(result.test_case_id)) {
          sourcesMap.set(result.test_case_id, []);
        }
        sourcesMap.get(result.test_case_id).push(result.name);
      });
    }
    
    // 获取测试用例的关联项目
    let projectsMap = new Map();
    if (testCaseIds.length > 0) {
      const projectQuery = `
        SELECT tcp.test_case_id, tcp.project_id, tcp.owner, tcp.progress_id, tcp.status_id, tcp.remark, p.name 
        FROM test_case_projects tcp 
        JOIN projects p ON tcp.project_id = p.id 
        WHERE tcp.test_case_id IN (${testCaseIds.map(() => '?').join(',')})
      `;
      const [projectResults] = await pool.query(projectQuery, testCaseIds);
      projectResults.forEach(result => {
        if (!projectsMap.has(result.test_case_id)) {
          projectsMap.set(result.test_case_id, []);
        }
        projectsMap.get(result.test_case_id).push({
          project_id: result.project_id,
          id: result.project_id,
          name: result.name,
          owner: result.owner,
          progress_id: result.progress_id,
          status_id: result.status_id,
          remark: result.remark
        });
      });
    }
    
    // 获取测试用例的关联方式
    let methodsMap = new Map();
    if (testCaseIds.length > 0) {
      const methodQuery = `
        SELECT tcm.test_case_id, tm.name 
        FROM test_case_methods tcm 
        JOIN test_methods tm ON tcm.method_id = tm.id 
        WHERE tcm.test_case_id IN (${testCaseIds.map(() => '?').join(',')})
      `;
      const [methodResults] = await pool.query(methodQuery, testCaseIds);
      methodResults.forEach(result => {
        if (!methodsMap.has(result.test_case_id)) {
          methodsMap.set(result.test_case_id, []);
        }
        methodsMap.get(result.test_case_id).push(result.name);
      });
    }
    
    // 获取测试用例的关联阶段
    let phasesMap = new Map();
    if (testCaseIds.length > 0) {
      const phaseQuery = `
        SELECT tcp.test_case_id, tp.name 
        FROM test_case_phases tcp 
        JOIN test_phases tp ON tcp.phase_id = tp.id 
        WHERE tcp.test_case_id IN (${testCaseIds.map(() => '?').join(',')})
      `;
      const [phaseResults] = await pool.query(phaseQuery, testCaseIds);
      phaseResults.forEach(result => {
        if (!phasesMap.has(result.test_case_id)) {
          phasesMap.set(result.test_case_id, []);
        }
        phasesMap.get(result.test_case_id).push(result.name);
      });
    }
    
    console.log('查询结果:', testCases);
    
    res.json({ 
      success: true,
      testCases: testCases.map(testCase => {
        // 获取关联的测试方式，如果没有则使用test_case表中的method字段
        const methods = methodsMap.get(testCase.id) || [];
        const method = methods.length > 0 ? methods[0] : (testCase.method || 'manual');
        
        // 获取关联的测试阶段
        const phases = phasesMap.get(testCase.id) || [];
        const phase = phases.length > 0 ? phases[0] : testCase.phase || '';
        
        return {
          id: testCase.id,
          caseId: testCase.case_id,
          name: testCase.name,
          priority: testCase.priority,
          type: testCase.type,
          method: method,
          phase: phase,
          status: testCase.status || '维护中',
          key_config: testCase.key_config || '',
          precondition: testCase.precondition || '',
          purpose: testCase.purpose || '',
          steps: testCase.steps || '',
          expected: testCase.expected || '',
          remark: testCase.remark || '',
          creator: testCase.creator,
          owner: testCase.owner || testCase.creator,
          libraryId: testCase.library_id,
          moduleId: testCase.module_id,
          level1Id: testCase.level1_id,
          environments: environmentsMap.get(testCase.id) || [],
          sources: sourcesMap.get(testCase.id) || [],
          methods: methods,
          phases: phases,
          projects: projectsMap.get(testCase.id) || [],
          createdAt: testCase.created_at,
          updatedAt: testCase.updated_at
        };
      })
    });
  } catch (error) {
    console.error('获取测试用例列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试用例
app.post('/api/cases/update', async (req, res) => {
  try {
    console.log('接收到更新测试用例请求:', req.body);
    const { 
      id, 
      caseId, 
      name, 
      priority, 
      type, 
      precondition, 
      purpose, 
      steps, 
      expected, 
      creator, 
      libraryId, 
      moduleId, 
      level1Id,
      projects,
      testTypes,
      testStatuses,
      phases,
      environments,
      methods,
      remark
    } = req.body;
    
    // 验证必填字段
    if (!id || !name || !moduleId) {
      return res.json({ success: false, message: '测试用例ID、名称和模块ID不能为空' });
    }
    
    // 转换类型
    const numericId = parseInt(id);
    const numericModuleId = parseInt(moduleId);
    const numericLevel1Id = level1Id ? parseInt(level1Id) : null;
    const numericLibraryId = libraryId ? parseInt(libraryId) : null;
    
    // 开始事务
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 更新测试用例记录，updated_at会自动更新
      const [result] = await connection.execute(
        `UPDATE test_cases SET 
          case_id = ?, 
          name = ?, 
          priority = ?, 
          type = ?, 
          precondition = ?, 
          purpose = ?, 
          steps = ?, 
          expected = ?, 
          creator = ?, 
          library_id = ?, 
          module_id = ?, 
          level1_id = ?, 
          key_config = ?,
          remark = ?, 
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [caseId, name, priority, type, precondition, purpose, steps, expected, creator, numericLibraryId, numericModuleId, numericLevel1Id, req.body.key_config || '', remark, numericId]
      );
      
      console.log('测试用例更新成功，影响行数:', result.affectedRows);
      
      // 只有当明确传递了projects或projectAssociations参数时才更新项目关联
      // 这样可以避免在保存测试用例时意外删除已有的关联项目
      if (projects !== undefined || req.body.projectAssociations !== undefined) {
        // 先删除现有的项目关联
        await connection.execute('DELETE FROM test_case_projects WHERE test_case_id = ?', [numericId]);
        
        // 处理项目关联
        if (projects && projects.length > 0) {
          // 如果提供了projectAssociations，则使用详细关联数据
          if (req.body.projectAssociations && Array.isArray(req.body.projectAssociations)) {
            for (const association of req.body.projectAssociations) {
              // 使用 parseIntField 统一处理 INT 字段
              const projectId = parseIntField(association.project_id || association.id);
              const progressId = parseIntField(association.progressId || association.progress_id);
              const statusId = parseIntField(association.statusId || association.status_id);
              
              await connection.execute(
                `INSERT INTO test_case_projects (
                  test_case_id, 
                  project_id, 
                  owner,
                  progress_id,
                  status_id,
                  remark,
                  created_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [numericId, projectId, association.owner || null, progressId, statusId, association.remark || '']
              );
            }
          } else {
            // 兼容旧版API，只使用项目ID
            for (const projectId of projects) {
              await connection.execute(
                `INSERT INTO test_case_projects (
                  test_case_id, 
                  project_id, 
                  created_at
                ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
                [numericId, projectId]
              );
            }
          }
          console.log('项目关联更新成功');
        }
      }
      
      // 先删除现有的测试类型关联
      await connection.execute('DELETE FROM test_case_test_types WHERE test_case_id = ?', [numericId]);
      
      // 处理测试类型关联
      if (testTypes && Array.isArray(testTypes) && testTypes.length > 0) {
        for (const testTypeId of testTypes) {
          await connection.execute(
            `INSERT INTO test_case_test_types (
              test_case_id, 
              test_type_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [numericId, testTypeId]
          );
        }
        console.log('测试类型关联更新成功');
      }
      
      // 先删除现有的测试状态关联
      await connection.execute('DELETE FROM test_case_statuses WHERE test_case_id = ?', [numericId]);
      
      // 处理测试状态关联
      if (testStatuses && Array.isArray(testStatuses) && testStatuses.length > 0) {
        for (const statusId of testStatuses) {
          await connection.execute(
            `INSERT INTO test_case_statuses (
              test_case_id, 
              status_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [numericId, statusId]
          );
        }
        console.log('测试状态关联更新成功');
      }
      
      // 先删除现有的测试阶段关联
      await connection.execute('DELETE FROM test_case_phases WHERE test_case_id = ?', [numericId]);
      
      // 处理测试阶段关联
      if (phases && Array.isArray(phases) && phases.length > 0) {
        for (const phaseId of phases) {
          await connection.execute(
            `INSERT INTO test_case_phases (
              test_case_id, 
              phase_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [numericId, phaseId]
          );
        }
        console.log('测试阶段关联更新成功');
      }
      
      // 先删除现有的测试环境关联
      await connection.execute('DELETE FROM test_case_environments WHERE test_case_id = ?', [numericId]);
      
      // 处理测试环境关联
      if (environments && Array.isArray(environments) && environments.length > 0) {
        for (const envId of environments) {
          await connection.execute(
            `INSERT INTO test_case_environments (
              test_case_id, 
              environment_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [numericId, envId]
          );
        }
        console.log('测试环境关联更新成功');
      }
      
      // 先删除现有的测试点来源关联
      await connection.execute('DELETE FROM test_case_sources WHERE test_case_id = ?', [numericId]);
      
      // 处理测试点来源关联
      const sources = req.body.sources;
      if (sources && Array.isArray(sources) && sources.length > 0) {
        for (const sourceId of sources) {
          await connection.execute(
            `INSERT INTO test_case_sources (
              test_case_id, 
              source_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [numericId, sourceId]
          );
        }
        console.log('测试点来源关联更新成功');
      }
      
      // 先删除现有的测试方式关联
      await connection.execute('DELETE FROM test_case_methods WHERE test_case_id = ?', [numericId]);
      
      // 处理测试方式关联
      if (methods && Array.isArray(methods) && methods.length > 0) {
        for (const methodId of methods) {
          await connection.execute(
            `INSERT INTO test_case_methods (
              test_case_id, 
              method_id, 
              created_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [numericId, methodId]
          );
        }
        console.log('测试方式关联更新成功');
      }
      
      await connection.commit();
      res.json({ success: true, message: '测试用例更新成功' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('更新测试用例错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 单独更新测试用例的项目关联
app.post('/api/cases/projects/update', authenticateToken, async (req, res) => {
  try {
    console.log('接收到更新测试用例项目关联请求:', req.body);
    const { testCaseId, projectAssociations } = req.body;
    
    if (!testCaseId) {
      return res.json({ success: false, message: '测试用例ID不能为空' });
    }
    
    let numericTestCaseId = null;
    
    // 判断testCaseId是数字ID还是字符串case_id
    if (typeof testCaseId === 'number' || !isNaN(Number(testCaseId))) {
      numericTestCaseId = parseInt(testCaseId);
    } else {
      // 是字符串case_id，需要查找对应的数字ID
      const [testCases] = await pool.execute(
        'SELECT id FROM test_cases WHERE case_id = ?',
        [testCaseId]
      );
      
      if (testCases.length === 0) {
        return res.json({ success: false, message: '找不到对应的测试用例' });
      }
      
      numericTestCaseId = testCases[0].id;
      console.log(`根据case_id "${testCaseId}" 找到数字ID: ${numericTestCaseId}`);
    }
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // 先删除现有的项目关联
      await connection.execute('DELETE FROM test_case_projects WHERE test_case_id = ?', [numericTestCaseId]);
      
      // 添加新的项目关联
      if (projectAssociations && Array.isArray(projectAssociations) && projectAssociations.length > 0) {
        for (const association of projectAssociations) {
          await connection.execute(
            `INSERT INTO test_case_projects (
              test_case_id, 
              project_id, 
              owner,
              progress_id,
              status_id,
              remark,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              numericTestCaseId, 
              parseIntField(association.project_id), 
              association.owner || null,
              parseIntField(association.progress_id),
              parseIntField(association.status_id),
              association.remark || null
            ]
          );
        }
        console.log('项目关联更新成功，数量:', projectAssociations.length);
      }
      
      await connection.commit();
      res.json({ success: true, message: '项目关联更新成功' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('更新项目关联错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 环境管理相关路由

// 检查环境和测试方式数据
app.get('/api/test/data', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // 获取环境数据
    const [environments] = await connection.execute('SELECT * FROM environments');
    
    // 获取测试方式数据
    const [methods] = await connection.execute('SELECT * FROM test_methods');
    
    // 获取测试类型数据
    const [testTypes] = await connection.execute('SELECT * FROM test_types');
    
    // 获取测试状态数据
    const [testStatuses] = await connection.execute('SELECT * FROM test_statuses');
    
    // 获取测试阶段数据
    const [phases] = await connection.execute('SELECT * FROM test_phases');
    
    connection.release();
    
    res.json({
      success: true,
      data: {
        environments,
        methods,
        testTypes,
        testStatuses,
        phases
      }
    });
  } catch (error) {
    console.error('检查数据失败:', error);
    res.json({ success: false, message: '检查数据失败', error: error.message });
  }
});

// 创建环境
app.post('/api/environments/create', async (req, res) => {
  try {
    console.log('接收到创建环境请求:', req.body);
    const { name, description, creator } = req.body;
    
    // 验证必填字段
    if (!name || !creator) {
      return res.json({ success: false, message: '环境名称和创建者不能为空' });
    }
    
    // 生成唯一的env_id
    const envId = 'ENV-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // 插入环境记录
    await pool.execute(
      `INSERT INTO environments (env_id, name, description, creator) 
       VALUES (?, ?, ?, ?)`,
      [envId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '环境创建成功', envId });
  } catch (error) {
    console.error('创建环境错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取环境列表
app.get('/api/environments/list', async (req, res) => {
  try {
    console.log('接收到获取环境列表请求');
    
    // 查询所有环境
    const [environments] = await pool.execute(
      `SELECT id, env_id, name, description, creator, created_at, updated_at 
       FROM environments 
       ORDER BY created_at DESC`
    );
    
    res.json({ success: true, environments });
  } catch (error) {
    console.error('获取环境列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个环境
app.get('/api/environments/get', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到获取单个环境请求:', { id });
    
    // 查询单个环境
    const [environments] = await pool.execute(
      `SELECT id, env_id, name, description, creator, created_at, updated_at 
       FROM environments 
       WHERE id = ?`,
      [id]
    );
    
    if (environments.length === 0) {
      return res.json({ success: false, message: '环境不存在' });
    }
    
    res.json({ success: true, environment: environments[0] });
  } catch (error) {
    console.error('获取单个环境错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新环境
app.post('/api/environments/update', async (req, res) => {
  try {
    console.log('接收到更新环境请求:', req.body);
    const { id, name, description } = req.body;
    
    // 验证必填字段
    if (!id || !name) {
      return res.json({ success: false, message: '环境ID和名称不能为空' });
    }
    
    // 更新环境记录
    await pool.execute(
      `UPDATE environments 
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '环境更新成功' });
  } catch (error) {
    console.error('更新环境错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除环境
app.delete('/api/environments/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除环境请求:', { id });
    
    // 验证必填字段
    if (!id) {
      return res.json({ success: false, message: '环境ID不能为空' });
    }
    
    // 删除环境记录
    await pool.execute(
      `DELETE FROM environments WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '环境删除成功' });
  } catch (error) {
    console.error('删除环境错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// ==================== 测试点来源管理API ====================

// 创建测试点来源
app.post('/api/test-sources/create', async (req, res) => {
  try {
    console.log('接收到创建测试点来源请求:', req.body);
    const { name, description, creator } = req.body;
    
    if (!name || !creator) {
      return res.json({ success: false, message: '测试点来源名称和创建者不能为空' });
    }
    
    const sourceId = 'SRC-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    await pool.execute(
      `INSERT INTO test_sources (source_id, name, description, creator) VALUES (?, ?, ?, ?)`,
      [sourceId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '测试点来源创建成功', sourceId });
  } catch (error) {
    console.error('创建测试点来源错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试点来源列表
app.get('/api/test-sources/list', async (req, res) => {
  try {
    const [sources] = await pool.execute(
      `SELECT id, source_id, name, description, creator, created_at, updated_at FROM test_sources ORDER BY created_at DESC`
    );
    res.json({ success: true, sources });
  } catch (error) {
    console.error('获取测试点来源列表错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个测试点来源
app.get('/api/test-sources/get', async (req, res) => {
  try {
    const { id } = req.query;
    const [sources] = await pool.execute(
      `SELECT id, source_id, name, description, creator, created_at, updated_at FROM test_sources WHERE id = ?`,
      [id]
    );
    
    if (sources.length === 0) {
      return res.json({ success: false, message: '测试点来源不存在' });
    }
    
    res.json({ success: true, source: sources[0] });
  } catch (error) {
    console.error('获取单个测试点来源错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试点来源
app.post('/api/test-sources/update', async (req, res) => {
  try {
    console.log('接收到更新测试点来源请求:', req.body);
    const { id, name, description } = req.body;
    
    if (!id || !name) {
      return res.json({ success: false, message: '测试点来源ID和名称不能为空' });
    }
    
    await pool.execute(
      `UPDATE test_sources SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '测试点来源更新成功' });
  } catch (error) {
    console.error('更新测试点来源错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试点来源
app.delete('/api/test-sources/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除测试点来源请求:', { id });
    
    if (!id) {
      return res.json({ success: false, message: '测试点来源ID不能为空' });
    }
    
    await pool.execute(`DELETE FROM test_sources WHERE id = ?`, [id]);
    
    res.json({ success: true, message: '测试点来源删除成功' });
  } catch (error) {
    console.error('删除测试点来源错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 测试类型管理相关路由

// 创建测试类型
app.post('/api/test-types/create', async (req, res) => {
  try {
    console.log('接收到创建测试类型请求:', req.body);
    const { name, description, creator } = req.body;
    
    // 验证必填字段
    if (!name || !creator) {
      return res.json({ success: false, message: '测试类型名称和创建者不能为空' });
    }
    
    // 生成唯一的type_id
    const typeId = 'TYPE-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // 插入测试类型记录
    await pool.execute(
      `INSERT INTO test_types (type_id, name, description, creator) 
       VALUES (?, ?, ?, ?)`,
      [typeId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '测试类型创建成功', typeId });
  } catch (error) {
    console.error('创建测试类型错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试类型列表
app.get('/api/test-types/list', async (req, res) => {
  try {
    console.log('接收到获取测试类型列表请求');
    
    // 查询所有测试类型
    const [testTypes] = await pool.execute(
      `SELECT id, type_id, name, description, creator, created_at, updated_at 
       FROM test_types 
       ORDER BY created_at DESC`
    );
    
    res.json({ success: true, testTypes });
  } catch (error) {
    console.error('获取测试类型列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个测试类型
app.get('/api/test-types/get', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到获取单个测试类型请求:', { id });
    
    // 查询单个测试类型
    const [testTypes] = await pool.execute(
      `SELECT id, type_id, name, description, creator, created_at, updated_at 
       FROM test_types 
       WHERE id = ?`,
      [id]
    );
    
    if (testTypes.length === 0) {
      return res.json({ success: false, message: '测试类型不存在' });
    }
    
    res.json({ success: true, testType: testTypes[0] });
  } catch (error) {
    console.error('获取单个测试类型错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试类型
app.post('/api/test-types/update', async (req, res) => {
  try {
    console.log('接收到更新测试类型请求:', req.body);
    const { id, name, description } = req.body;
    
    // 验证必填字段
    if (!id || !name) {
      return res.json({ success: false, message: '测试类型ID和名称不能为空' });
    }
    
    // 更新测试类型记录
    await pool.execute(
      `UPDATE test_types 
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '测试类型更新成功' });
  } catch (error) {
    console.error('更新测试类型错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试类型
app.delete('/api/test-types/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除测试类型请求:', { id });
    
    // 验证必填字段
    if (!id) {
      return res.json({ success: false, message: '测试类型ID不能为空' });
    }
    
    // 删除测试类型记录
    await pool.execute(
      `DELETE FROM test_types WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '测试类型删除成功' });
  } catch (error) {
    console.error('删除测试类型错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// ==================== 测试软件管理相关路由 ====================

// 创建测试软件
app.post('/api/test-softwares/create', async (req, res) => {
  try {
    console.log('接收到创建测试软件请求:', req.body);
    const { name, description, creator } = req.body;
    
    // 验证必填字段
    if (!name || !creator) {
      return res.json({ success: false, message: '测试软件名称和创建者不能为空' });
    }
    
    // 生成唯一的software_id
    const softwareId = 'SOFTWARE-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // 插入测试软件记录
    await pool.execute(
      `INSERT INTO test_softwares (software_id, name, description, creator) 
       VALUES (?, ?, ?, ?)`,
      [softwareId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '测试软件创建成功', softwareId });
  } catch (error) {
    console.error('创建测试软件错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试软件列表
app.get('/api/test-softwares/list', async (req, res) => {
  try {
    const [softwares] = await pool.execute(
      'SELECT * FROM test_softwares ORDER BY created_at DESC'
    );
    
    res.json({ success: true, softwares });
  } catch (error) {
    console.error('获取测试软件列表错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个测试软件
app.get('/api/test-softwares/get', async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.json({ success: false, message: '测试软件ID不能为空' });
    }
    
    const [softwares] = await pool.execute(
      'SELECT * FROM test_softwares WHERE id = ?',
      [id]
    );
    
    if (softwares.length === 0) {
      return res.json({ success: false, message: '测试软件不存在' });
    }
    
    res.json({ success: true, software: softwares[0] });
  } catch (error) {
    console.error('获取测试软件错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试软件
app.post('/api/test-softwares/update', async (req, res) => {
  try {
    const { id, name, description } = req.body;
    
    if (!id) {
      return res.json({ success: false, message: '测试软件ID不能为空' });
    }
    
    await pool.execute(
      `UPDATE test_softwares SET name = ?, description = ? WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '测试软件更新成功' });
  } catch (error) {
    console.error('更新测试软件错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试软件
app.delete('/api/test-softwares/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除测试软件请求:', { id });
    
    if (!id) {
      return res.json({ success: false, message: '测试软件ID不能为空' });
    }
    
    await pool.execute(
      `DELETE FROM test_softwares WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '测试软件删除成功' });
  } catch (error) {
    console.error('删除测试软件错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 测试阶段管理相关路由

// 创建测试阶段
app.post('/api/test-phases/create', async (req, res) => {
  try {
    console.log('接收到创建测试阶段请求:', req.body);
    const { name, description, creator } = req.body;
    
    // 验证必填字段
    if (!name || !creator) {
      return res.json({ success: false, message: '测试阶段名称和创建者不能为空' });
    }
    
    // 生成唯一的phase_id
    const phaseId = 'PHASE-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // 插入测试阶段记录
    await pool.execute(
      `INSERT INTO test_phases (phase_id, name, description, creator) 
       VALUES (?, ?, ?, ?)`,
      [phaseId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '测试阶段创建成功', phaseId });
  } catch (error) {
    console.error('创建测试阶段错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试阶段列表
app.get('/api/test-phases/list', async (req, res) => {
  try {
    console.log('接收到获取测试阶段列表请求');
    
    // 查询所有测试阶段
    const [testPhases] = await pool.execute(
      `SELECT id, phase_id, name, description, creator, created_at, updated_at 
       FROM test_phases 
       ORDER BY created_at DESC`
    );
    
    res.json({ success: true, testPhases });
  } catch (error) {
    console.error('获取测试阶段列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个测试阶段
app.get('/api/test-phases/get', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到获取单个测试阶段请求:', { id });
    
    // 查询单个测试阶段
    const [testPhases] = await pool.execute(
      `SELECT id, phase_id, name, description, creator, created_at, updated_at 
       FROM test_phases 
       WHERE id = ?`,
      [id]
    );
    
    if (testPhases.length === 0) {
      return res.json({ success: false, message: '测试阶段不存在' });
    }
    
    res.json({ success: true, testPhase: testPhases[0] });
  } catch (error) {
    console.error('获取单个测试阶段错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试阶段
app.post('/api/test-phases/update', async (req, res) => {
  try {
    console.log('接收到更新测试阶段请求:', req.body);
    const { id, name, description } = req.body;
    
    // 验证必填字段
    if (!id || !name) {
      return res.json({ success: false, message: '测试阶段ID和名称不能为空' });
    }
    
    // 更新测试阶段记录
    await pool.execute(
      `UPDATE test_phases 
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '测试阶段更新成功' });
  } catch (error) {
    console.error('更新测试阶段错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试阶段
app.delete('/api/test-phases/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除测试阶段请求:', { id });
    
    // 验证必填字段
    if (!id) {
      return res.json({ success: false, message: '测试阶段ID不能为空' });
    }
    
    // 删除测试阶段记录
    await pool.execute(
      `DELETE FROM test_phases WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '测试阶段删除成功' });
  } catch (error) {
    console.error('删除测试阶段错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 测试进度管理相关路由

// 创建测试进度
app.post('/api/test-progresses/create', async (req, res) => {
  try {
    console.log('接收到创建测试进度请求:', req.body);
    const { name, description, creator } = req.body;
    
    // 验证必填字段
    if (!name || !creator) {
      return res.json({ success: false, message: '测试进度名称和创建者不能为空' });
    }
    
    // 生成唯一的progress_id
    const progressId = 'PROGRESS-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // 插入测试进度记录
    await pool.execute(
      `INSERT INTO test_progresses (progress_id, name, description, creator) 
       VALUES (?, ?, ?, ?)`,
      [progressId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '测试进度创建成功', progressId });
  } catch (error) {
    console.error('创建测试进度错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试进度列表
app.get('/api/test-progresses/list', async (req, res) => {
  try {
    console.log('接收到获取测试进度列表请求');
    
    // 查询所有测试进度
    const [testProgresses] = await pool.execute(
      `SELECT id, progress_id, name, description, creator, created_at, updated_at 
       FROM test_progresses 
       ORDER BY created_at DESC`
    );
    
    res.json({ success: true, testProgresses });
  } catch (error) {
    console.error('获取测试进度列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取AI配置
app.get('/api/ai-config/get', async (req, res) => {
  try {
    console.log('接收到获取AI配置请求');
    
    const [configs] = await pool.execute(
      'SELECT config_key, config_value, description, updated_by, updated_at FROM ai_config'
    );
    
    const configMap = {};
    configs.forEach(config => {
      configMap[config.config_key] = {
        value: config.config_value,
        description: config.description,
        updated_by: config.updated_by,
        updated_at: config.updated_at
      };
    });
    
    res.json({ success: true, config: configMap });
  } catch (error) {
    console.error('获取AI配置错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 保存AI配置
app.post('/api/ai-config/save', async (req, res) => {
  try {
    console.log('接收到保存AI配置请求:', req.body);
    
    const { enabled, defaultModelId, username } = req.body;
    
    if (enabled !== undefined) {
      await pool.execute(
        'UPDATE ai_config SET config_value = ?, updated_by = ? WHERE config_key = ?',
        [enabled ? 'true' : 'false', username || 'admin', 'ai_enabled']
      );
    }
    
    if (defaultModelId !== undefined) {
      await pool.execute(
        'UPDATE ai_config SET config_value = ?, updated_by = ? WHERE config_key = ?',
        [defaultModelId, username || 'admin', 'default_model_id']
      );
    }
    
    res.json({ success: true, message: 'AI配置保存成功' });
  } catch (error) {
    console.error('保存AI配置错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取AI模型列表（支持 RBAC：管理员看全部，普通用户只看自己的）
app.get('/api/ai-models/list', authenticateToken, async (req, res) => {
  try {
    console.log('接收到获取AI模型列表请求');
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    
    // 支持中英文角色值判断管理员权限
    const isAdminRole = currentUserRole === '管理员' || currentUserRole === 'admin' || currentUserRole === 'Administrator';
    
    let query, params;
    if (isAdminRole) {
      query = `SELECT id, model_id, name, provider, api_key, endpoint, model_name, is_default, is_enabled, description, user_id, created_by, created_at, updated_at 
               FROM ai_models 
               ORDER BY is_default DESC, created_at ASC`;
      params = [];
    } else {
      query = `SELECT id, model_id, name, provider, api_key, endpoint, model_name, is_default, is_enabled, description, user_id, created_by, created_at, updated_at 
               FROM ai_models 
               WHERE user_id = ?
               ORDER BY is_default DESC, created_at ASC`;
      params = [currentUserId];
    }
    
    const [models] = await pool.execute(query, params);
    
    res.json({ 
      success: true, 
      models: models.map(m => ({
        ...m,
        canEdit: isAdminRole || m.user_id === currentUserId,
        canDelete: isAdminRole || m.user_id === currentUserId
      })),
      currentUser: {
        id: currentUserId,
        role: currentUserRole
      }
    });
  } catch (error) {
    console.error('获取AI模型列表错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个AI模型（支持 RBAC）
app.get('/api/ai-models/get', authenticateToken, async (req, res) => {
  try {
    const { modelId } = req.query;
    console.log('接收到获取单个AI模型请求:', { modelId });
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    
    const [models] = await pool.execute(
      `SELECT id, model_id, name, provider, api_key, endpoint, model_name, is_default, is_enabled, description, user_id, created_by, created_at, updated_at 
       FROM ai_models 
       WHERE model_id = ?`,
      [modelId]
    );
    
    if (models.length === 0) {
      return res.json({ success: false, message: 'AI模型不存在' });
    }
    
    const model = models[0];
    
    // 支持中英文角色值判断管理员权限
    const isAdminRole = currentUserRole === '管理员' || currentUserRole === 'admin' || currentUserRole === 'Administrator';
    
    if (!isAdminRole && model.user_id !== currentUserId) {
      return res.status(403).json({ success: false, message: '您没有权限查看此AI模型' });
    }
    
    res.json({ 
      success: true, 
      model: {
        ...model,
        canEdit: isAdminRole || model.user_id === currentUserId,
        canDelete: isAdminRole || model.user_id === currentUserId
      }
    });
  } catch (error) {
    console.error('获取AI模型错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 添加AI模型（支持 RBAC）
app.post('/api/ai-models/add', authenticateToken, async (req, res) => {
  try {
    console.log('接收到添加AI模型请求:', req.body);
    
    const { modelId, name, provider, apiKey, endpoint, modelName, isDefault, isEnabled, description } = req.body;
    const currentUserId = req.user.id;
    
    const [existingModels] = await pool.execute(
      'SELECT model_id FROM ai_models WHERE model_id = ?',
      [modelId]
    );
    
    if (existingModels.length > 0) {
      return res.json({ success: false, message: '模型ID已存在' });
    }
    
    if (isDefault) {
      // 支持中英文角色值判断管理员权限
      if (req.user.role === '管理员' || req.user.role === 'admin' || req.user.role === 'Administrator') {
        await pool.execute('UPDATE ai_models SET is_default = FALSE');
      }
    }
    
    await pool.execute(
      `INSERT INTO ai_models (model_id, name, provider, api_key, endpoint, model_name, is_default, is_enabled, description, user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [modelId, name, provider, apiKey, endpoint, modelName, isDefault ? true : false, isEnabled !== false, description || '', currentUserId, req.user.username]
    );
    
    res.json({ success: true, message: 'AI模型添加成功' });
  } catch (error) {
    console.error('添加AI模型错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新AI模型（支持 RBAC）
app.post('/api/ai-models/update', authenticateToken, async (req, res) => {
  try {
    console.log('接收到更新AI模型请求:', req.body);
    
    const { modelId, name, provider, apiKey, endpoint, modelName, isDefault, isEnabled, description } = req.body;
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    
    const [models] = await pool.execute(
      'SELECT id, user_id FROM ai_models WHERE model_id = ?',
      [modelId]
    );
    
    if (models.length === 0) {
      return res.json({ success: false, message: 'AI模型不存在' });
    }
    
    // 支持中英文角色值判断管理员权限
    const isAdminRole = currentUserRole === '管理员' || currentUserRole === 'admin' || currentUserRole === 'Administrator';
    
    if (!isAdminRole && models[0].user_id !== currentUserId) {
      return res.status(403).json({ success: false, message: '您没有权限修改此AI模型' });
    }
    
    if (isDefault && isAdminRole) {
      await pool.execute('UPDATE ai_models SET is_default = FALSE');
    }
    
    await pool.execute(
      `UPDATE ai_models 
       SET name = ?, provider = ?, api_key = ?, endpoint = ?, model_name = ?, is_default = ?, is_enabled = ?, description = ?
       WHERE model_id = ?`,
      [name, provider, apiKey, endpoint, modelName, isDefault ? true : false, isEnabled !== false, description || '', modelId]
    );
    
    res.json({ success: true, message: 'AI模型更新成功' });
  } catch (error) {
    console.error('更新AI模型错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除AI模型（支持 RBAC）
app.post('/api/ai-models/delete', authenticateToken, async (req, res) => {
  try {
    console.log('接收到删除AI模型请求:', req.body);
    
    const { modelId } = req.body;
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    
    const [models] = await pool.execute(
      'SELECT id, user_id FROM ai_models WHERE model_id = ?',
      [modelId]
    );
    
    if (models.length === 0) {
      return res.json({ success: false, message: 'AI模型不存在' });
    }
    
    // 支持中英文角色值判断管理员权限
    const isAdminRole = currentUserRole === '管理员' || currentUserRole === 'admin' || currentUserRole === 'Administrator';
    
    if (!isAdminRole && models[0].user_id !== currentUserId) {
      return res.status(403).json({ success: false, message: '您没有权限删除此AI模型' });
    }
    
    await pool.execute('DELETE FROM ai_models WHERE model_id = ?', [modelId]);
    
    res.json({ success: true, message: 'AI模型删除成功' });
  } catch (error) {
    console.error('删除AI模型错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 设置默认AI模型（仅管理员）
app.post('/api/ai-models/set-default', authenticateToken, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    console.log('接收到设置默认AI模型请求:', req.body);
    
    const { modelId } = req.body;
    
    await conn.beginTransaction();
    
    await conn.execute('UPDATE ai_models SET is_default = FALSE');
    
    await conn.execute('UPDATE ai_models SET is_default = TRUE WHERE model_id = ?', [modelId]);
    
    await conn.execute(
      'UPDATE ai_config SET config_value = ? WHERE config_key = ?',
      [modelId, 'default_model_id']
    );
    
    await conn.commit();
    
    res.json({ success: true, message: '默认AI模型设置成功' });
  } catch (error) {
    await conn.rollback();
    console.error('设置默认AI模型错误:', error);
    res.status(500).json({ success: false, message: '服务器错误', error: error.message });
  } finally {
    conn.release();
  }
});

// AI 数据分析 API - 支持 Function Calling
app.post('/api/ai/analyze', async (req, res) => {
  try {
    const { query, modelId, conversationHistory } = req.body;
    
    if (!query || query.trim() === '') {
      return res.json({ success: false, message: '请输入您的问题' });
    }
    
    // 获取AI模型配置
    let aiModel = null;
    
    if (modelId) {
      const [models] = await pool.execute(
        'SELECT * FROM ai_models WHERE (model_id = ? OR name = ?) AND is_enabled = TRUE',
        [modelId, modelId]
      );
      aiModel = models[0];
    }
    
    if (!aiModel) {
      aiModel = await getSystemDefaultAIConfig();
    }
    
    if (!aiModel) {
      return res.json({ success: false, message: '未找到可用的AI模型配置，请先在配置中心添加AI模型' });
    }
    
    if (!aiModel.api_key) {
      return res.json({ success: false, message: 'AI模型未配置API密钥，请先在配置中心配置' });
    }
    
    console.log('AI数据分析使用模型:', aiModel.name, '(' + aiModel.model_id + ')');
    
    // AI 数据分析 System Prompt
    const systemPrompt = `# Role (角色定位)
你是一个专属 xTest 测试管理系统的高级 AI 数据分析师兼智能体（Agent）。你的核心职责是通过调用外部数据库查询工具，为研发和测试人员提供精准的数据解答和报表分析。

# Database Schema (数据库字典)
请严格基于以下 xTest 的数据库结构来理解数据关系并编写 SQL：

## 核心业务与层级关系
- **case_libraries (用例库)**: id, name, creator, module_count
- **modules (模块)**: id, module_id, name, library_id, parent_id
- **level1_points (一级测试点)**: id, module_id, name, test_type
- **test_cases (测试用例)**: id, case_id, name, priority, type, owner, library_id, module_id, level1_id, status
- **projects (项目)**: id, name, code
- **users (用户)**: id, username, role

## 测试计划与执行
- **test_plans (测试计划)**: id, name, owner, status, test_phase, project, iteration, pass_rate, tested_cases, total_cases
- **test_plan_cases (计划用例执行记录)**: id, plan_id, case_id, status (Pass/Fail/Block/pending), execution_time
- **test_reports (测试报告)**: id, name, project, test_plan_id, summary, start_date, end_date

## 核心关联关系 (JOIN 依据)
- **用例与项目关联**: test_case_projects (test_case_id, project_id)
- **用例与状态关联**: test_case_statuses (test_case_id, status_id)
- **用例与进度关联**: test_case_progresses (test_case_id, progress_id)
- **用例与类型关联**: test_case_test_types (test_case_id, test_type_id)

## 数据层级结构说明
用例的完整树形结构为：case_libraries -> modules -> level1_points -> test_cases。查询特定模块或一/二级测试点下的用例时，请通过外键 library_id, module_id, level1_id 进行 INNER JOIN。

# Skills / Tools (技能与工具)
你拥有一个名为 query_database 的工具。
- **用途**：当用户询问具体的测试点、项目进度、用例状态、统计通过率、人员任务分配等需要从真实数据库获取数据的问题时，你**必须**调用此工具。
- **参数**：sql_query (字符串)。你需要根据用户的自然语言问题和 Database Schema，编写出精准的 MySQL 语句并传入此工具。

# Action Guidelines (执行准则)
1. **精准对应与联表查询**：
   - 严格使用提供的表名和字段名。模糊搜索名称时，请使用 LIKE '%关键字%'。
   - 涉及到"某项目的用例"时，必须通过 test_case_projects 关联表进行 JOIN。
   - 统计通过率时，请参考 test_plan_cases 中的 status 字段（Pass/Fail/Block）或直接查询 test_plans 里的 pass_rate 字段。
2. **安全防护 (Read-Only)**：你生成的 SQL 语句必须且只能是只读的 SELECT 语句。绝对禁止生成任何 INSERT, UPDATE, DELETE, DROP, ALTER 等破坏性操作。
3. **优雅的异常处理**：如果 query_database 返回的结果集为空 [] 或 {}，请友善地告知用户"当前系统中未查询到相关数据"，并结合 xTest 的业务逻辑给出 2-3 个排查建议（如：确认该模块名称是否拼写正确、确认用例是否已关联到对应项目）。
4. **规范化报告输出**：获取到真实数据后，请将 JSON 数据转换为表格、列表或易读的分析段落。并在每一次正式回答的末尾，一致性地附上：
   [时间戳: YYYY-MM-DD HH:mm:ss] | [数据来源: xTest 实时数据库]`;

    // 定义 Function Calling 工具
    // 基础工具：query_database
    const baseTools = [
      {
        type: 'function',
        function: {
          name: 'query_database',
          description: '执行 MySQL SELECT 查询获取 xTest 数据库中的真实数据。当用户询问具体的测试点、项目进度、用例状态、统计通过率、人员任务分配等问题时必须调用此工具。',
          parameters: {
            type: 'object',
            properties: {
              sql_query: {
                type: 'string',
                description: 'MySQL SELECT 查询语句，必须是只读的 SELECT 语句'
              }
            },
            required: ['sql_query']
          }
        }
      }
    ];
    
    // 获取启用的动态技能
    const { getEnabledSkillsAsTools } = require('./routes/aiSkills');
    let dynamicTools = [];
    try {
      dynamicTools = await getEnabledSkillsAsTools();
      console.log(`加载了 ${dynamicTools.length} 个动态AI技能`);
    } catch (error) {
      console.error('加载动态技能失败:', error);
    }
    
    // 合并基础工具和动态技能
    const tools = [...baseTools, ...dynamicTools];
    
    // 构建消息列表
    const messages = [
      { role: 'system', content: systemPrompt }
    ];
    
    // 如果有对话历史，添加到消息列表
    if (conversationHistory && Array.isArray(conversationHistory)) {
      conversationHistory.forEach(msg => {
        messages.push(msg);
      });
    }
    
    // 添加当前用户问题
    messages.push({ role: 'user', content: query });
    
    // 第一次调用 AI
    const response = await fetch(aiModel.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiModel.api_key}`
      },
      body: JSON.stringify({
        model: aiModel.model_name,
        messages: messages,
        tools: tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 2000
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI模型调用失败:', errorText);
      return res.json({ success: false, message: 'AI模型调用失败: ' + response.status });
    }
    
    const aiResult = await response.json();
    const assistantMessage = aiResult.choices?.[0]?.message;
    
    // 检查是否需要调用工具
    const toolCalls = assistantMessage?.tool_calls;
    
    if (toolCalls && toolCalls.length > 0) {
      console.log('AI 请求调用工具:', toolCalls.map(tc => tc.function.name).join(', '));
      
      // 处理所有工具调用
      const toolResults = [];
      
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        
        // 处理基础工具：query_database
        if (toolName === 'query_database') {
          const sql = args.sql_query;
          
          console.log('AI 生成的 SQL:', sql);
          
          // 安全校验：只允许 SELECT
          const normalizedSql = sql.trim().toUpperCase();
          if (!normalizedSql.startsWith('SELECT')) {
            toolResults.push({
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: '安全拦截：仅允许执行 SELECT 查询。' })
            });
            continue;
          }
          
          // 额外的安全检查：禁止危险操作
          const dangerousPatterns = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE'];
          const hasDangerousPattern = dangerousPatterns.some(pattern => normalizedSql.includes(pattern));
          
          if (hasDangerousPattern) {
            toolResults.push({
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: '安全拦截：检测到危险操作，仅允许 SELECT 查询。' })
            });
            continue;
          }
          
          try {
            // 执行数据库查询
            const [rows] = await pool.execute(sql);
            console.log('查询结果行数:', rows.length);
            
            toolResults.push({
              tool_call_id: toolCall.id,
              content: JSON.stringify(rows)
            });
          } catch (dbError) {
            console.error('数据库查询错误:', dbError.message);
            toolResults.push({
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: '数据库查询错误: ' + dbError.message })
            });
          }
        } else {
          // 处理动态技能
          console.log(`执行动态技能: ${toolName}`);
          
          try {
            const { executeSkillCode } = require('./routes/aiSkills');
            const result = await executeSkillCode(toolName, args);
            
            // 检查是否为报告生成类型的技能
            if (result && result.type === 'report_generation') {
              console.log('检测到报告生成技能，准备生成最终报告');
              
              // 构建报告生成的特殊提示词
              const reportPrompt = `你是一个专业的测试报告撰写专家。请根据以下数据和模板，生成一份完整的测试报告。

## 项目信息
- 项目名称: ${result.project.name}
- 项目编号: ${result.project.code}

## 统计数据
- 总用例数: ${result.statistics.totalCases}
- 已执行用例: ${result.statistics.testedCases}
- 通过用例: ${result.statistics.passedCases}
- 失败用例: ${result.statistics.failedCases}
- 阻塞用例: ${result.statistics.blockedCases}
- 未执行用例: ${result.statistics.pendingCases}
- 通过率: ${result.statistics.passRate}
- 执行进度: ${result.statistics.progress}

## 测试计划详情
${JSON.stringify(result.testPlans, null, 2)}

## 报告模板
${result.template}

## 要求
${result.instructions}

请严格按照模板格式，用专业自然的语言生成测试报告。`;

              // 用新的提示词调用 AI 生成报告
              const reportMessages = [
                { role: 'system', content: '你是一个专业的测试报告撰写专家，擅长根据数据生成结构清晰、内容专业的测试报告。' },
                { role: 'user', content: reportPrompt }
              ];
              
              const reportResponse = await fetch(aiModel.endpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${aiModel.api_key}`
                },
                body: JSON.stringify({
                  model: aiModel.model_name,
                  messages: reportMessages,
                  temperature: 0.3,
                  max_tokens: 4000
                })
              });
              
              if (reportResponse.ok) {
                const reportResult = await reportResponse.json();
                const reportContent = reportResult.choices?.[0]?.message?.content || '';
                
                // 返回生成的报告
                toolResults.push({
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({ 
                    type: 'report',
                    content: reportContent,
                    project: result.project,
                    statistics: result.statistics
                  })
                });
              } else {
                toolResults.push({
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({ error: '报告生成失败' })
                });
              }
            } else {
              // 普通技能，直接返回结果
              toolResults.push({
                tool_call_id: toolCall.id,
                content: JSON.stringify(result)
              });
            }
            
            console.log(`技能 ${toolName} 执行完成`);
          } catch (skillError) {
            console.error(`执行技能 ${toolName} 错误:`, skillError);
            toolResults.push({
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: '技能执行错误: ' + skillError.message })
            });
          }
        }
      }
      
      // 构建第二次调用的消息列表
      const secondMessages = [...messages, assistantMessage];
      
      // 检查是否有报告类型的结果
      let hasReportResult = false;
      let reportContent = null;
      
      toolResults.forEach(result => {
        try {
          const parsed = JSON.parse(result.content);
          if (parsed.type === 'report') {
            hasReportResult = true;
            reportContent = parsed;
          }
        } catch (e) {}
        
        secondMessages.push({
          role: 'tool',
          tool_call_id: result.tool_call_id,
          content: result.content
        });
      });
      
      // 如果有报告结果，直接返回报告内容
      if (hasReportResult && reportContent) {
        console.log('返回生成的测试报告');
        return res.json({
          success: true,
          answer: reportContent.content,
          isReport: true,
          reportData: {
            project: reportContent.project,
            statistics: reportContent.statistics
          },
          toolCalls: toolCalls.map(tc => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments)
          }))
        });
      }
      
      // 第二次调用 AI，让它处理查询结果
      // 使用 while 循环实现多轮对话，直到 AI 返回最终文本
      let currentMessages = [...secondMessages];
      let iteration = 0;
      const maxIterations = 10;
      let finalAnswer = '';
      let allToolCalls = [...toolCalls];
      
      while (iteration < maxIterations) {
        iteration++;
        console.log(`\n=== 第 ${iteration} 轮对话 ===`);
        
        const loopResponse = await fetch(aiModel.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiModel.api_key}`
          },
          body: JSON.stringify({
            model: aiModel.model_name,
            messages: currentMessages,
            tools: tools,
            tool_choice: 'auto',
            temperature: 0.3,
            max_tokens: 4000
          })
        });
        
        if (!loopResponse.ok) {
          const errorText = await loopResponse.text();
          console.error('AI 调用失败:', errorText);
          return res.json({ success: false, message: 'AI处理结果失败: ' + loopResponse.status });
        }
        
        const loopResult = await loopResponse.json();
        const loopAssistantMessage = loopResult.choices?.[0]?.message;
        
        if (!loopAssistantMessage) {
          console.error('AI 返回格式错误');
          return res.json({ success: false, message: 'AI返回格式错误' });
        }
        
        // 检查是否有新的工具调用
        const loopToolCalls = loopAssistantMessage.tool_calls;
        
        if (!loopToolCalls || loopToolCalls.length === 0) {
          // 没有工具调用，返回最终结果
          console.log('AI 返回最终文本回答');
          finalAnswer = loopAssistantMessage.content || '';
          break;
        }
        
        console.log(`AI 请求调用 ${loopToolCalls.length} 个工具:`, loopToolCalls.map(tc => tc.function.name).join(', '));
        
        // 将助手消息添加到对话历史
        currentMessages.push(loopAssistantMessage);
        allToolCalls.push(...loopToolCalls);
        
        // 处理所有工具调用
        for (const toolCall of loopToolCalls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          
          let toolResult;
          
          if (toolName === 'query_database') {
            const sql = args.sql_query;
            console.log('执行 SQL:', sql);
            
            // 安全校验
            const normalizedSql = sql.trim().toUpperCase();
            if (!normalizedSql.startsWith('SELECT')) {
              toolResult = { error: '安全拦截：仅允许执行 SELECT 查询。' };
            } else {
              const dangerousPatterns = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE'];
              const hasDangerousPattern = dangerousPatterns.some(pattern => normalizedSql.includes(pattern));
              
              if (hasDangerousPattern) {
                toolResult = { error: '安全拦截：检测到危险操作。' };
              } else {
                try {
                  const [rows] = await pool.execute(sql);
                  console.log('查询结果行数:', rows.length);
                  toolResult = rows;
                } catch (dbError) {
                  console.error('数据库查询错误:', dbError.message);
                  toolResult = { error: '数据库查询错误: ' + dbError.message };
                }
              }
            }
          } else {
            // 处理动态技能
            console.log(`执行动态技能: ${toolName}`);
            
            try {
              const { executeSkillCode } = require('./routes/aiSkills');
              toolResult = await executeSkillCode(toolName, args);
              console.log(`技能 ${toolName} 执行完成`);
            } catch (skillError) {
              console.error(`执行技能 ${toolName} 错误:`, skillError);
              toolResult = { error: '技能执行错误: ' + skillError.message };
            }
          }
          
          // 将工具结果添加到对话历史
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }
      }
      
      // 返回最终结果
      res.json({
        success: true,
        answer: finalAnswer,
        toolCalls: allToolCalls.map(tc => ({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments)
        }))
      });
      
    } else {
      // AI 直接回答，没有调用工具
      const content = assistantMessage?.content || '';
      
      res.json({
        success: true,
        answer: content,
        toolCalls: []
      });
    }
    
  } catch (error) {
    console.error('AI 数据分析错误:', error);
    res.json({ success: false, message: '服务器错误: ' + error.message });
  }
});

// 获取单个测试进度
app.get('/api/test-progresses/get', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到获取单个测试进度请求:', { id });
    
    // 查询单个测试进度
    const [testProgresses] = await pool.execute(
      `SELECT id, progress_id, name, description, creator, created_at, updated_at 
       FROM test_progresses 
       WHERE id = ?`,
      [id]
    );
    
    if (testProgresses.length === 0) {
      return res.json({ success: false, message: '测试进度不存在' });
    }
    
    res.json({ success: true, testProgress: testProgresses[0] });
  } catch (error) {
    console.error('获取单个测试进度错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试进度
app.post('/api/test-progresses/update', async (req, res) => {
  try {
    console.log('接收到更新测试进度请求:', req.body);
    const { id, name, description } = req.body;
    
    // 验证必填字段
    if (!id || !name) {
      return res.json({ success: false, message: '测试进度ID和名称不能为空' });
    }
    
    // 更新测试进度记录
    await pool.execute(
      `UPDATE test_progresses 
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '测试进度更新成功' });
  } catch (error) {
    console.error('更新测试进度错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试进度
app.delete('/api/test-progresses/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除测试进度请求:', { id });
    
    // 验证必填字段
    if (!id) {
      return res.json({ success: false, message: '测试进度ID不能为空' });
    }
    
    // 删除测试进度记录
    await pool.execute(
      `DELETE FROM test_progresses WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '测试进度删除成功' });
  } catch (error) {
    console.error('删除测试进度错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 测试状态管理相关路由

// 创建测试状态
app.post('/api/test-statuses/create', async (req, res) => {
  try {
    console.log('接收到创建测试状态请求:', req.body);
    const { name, description, creator } = req.body;
    
    // 验证必填字段
    if (!name || !creator) {
      return res.json({ success: false, message: '测试状态名称和创建者不能为空' });
    }
    
    // 生成唯一的status_id
    const statusId = 'STATUS-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // 插入测试状态记录
    await pool.execute(
      `INSERT INTO test_statuses (status_id, name, description, creator) 
       VALUES (?, ?, ?, ?)`,
      [statusId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '测试状态创建成功', statusId });
  } catch (error) {
    console.error('创建测试状态错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试状态列表
app.get('/api/test-statuses/list', async (req, res) => {
  try {
    console.log('接收到获取测试状态列表请求');
    
    // 查询所有测试状态（按sort_order排序）
    const [testStatuses] = await pool.execute(
      `SELECT id, status_id, name, description, creator, sort_order, is_active, status_category, created_at, updated_at 
       FROM test_statuses 
       WHERE is_active = 1
       ORDER BY sort_order ASC`
    );
    
    res.json({ success: true, testStatuses });
  } catch (error) {
    console.error('获取测试状态列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// ==================== 超链接配置 API ====================

// 获取超链接配置列表
app.get('/api/hyperlink-configs/list', async (req, res) => {
  try {
    const [configs] = await pool.execute(
      `SELECT id, name, prefix, description, sort_order, is_active, created_at, updated_at 
       FROM hyperlink_configs 
       WHERE is_active = 1
       ORDER BY sort_order ASC`
    );
    res.json({ success: true, configs });
  } catch (error) {
    console.error('获取超链接配置列表错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 添加超链接配置
app.post('/api/hyperlink-configs/add', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, prefix, description, sort_order } = req.body;
    
    if (!name || !prefix) {
      return res.json({ success: false, message: '名称和前缀不能为空' });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO hyperlink_configs (name, prefix, description, sort_order) VALUES (?, ?, ?, ?)`,
      [name, prefix, description || '', sort_order || 0]
    );
    
    res.json({ success: true, id: result.insertId, message: '添加成功' });
  } catch (error) {
    console.error('添加超链接配置错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新超链接配置
app.post('/api/hyperlink-configs/update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, name, prefix, description, sort_order } = req.body;
    
    if (!id || !name || !prefix) {
      return res.json({ success: false, message: 'ID、名称和前缀不能为空' });
    }
    
    await pool.execute(
      `UPDATE hyperlink_configs SET name = ?, prefix = ?, description = ?, sort_order = ? WHERE id = ?`,
      [name, prefix, description || '', sort_order || 0, id]
    );
    
    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    console.error('更新超链接配置错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除超链接配置
app.delete('/api/hyperlink-configs/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.execute(
      `UPDATE hyperlink_configs SET is_active = 0 WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除超链接配置错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个测试状态
app.get('/api/test-statuses/get', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到获取单个测试状态请求:', { id });
    
    // 查询单个测试状态
    const [testStatuses] = await pool.execute(
      `SELECT id, status_id, name, description, creator, created_at, updated_at 
       FROM test_statuses 
       WHERE id = ?`,
      [id]
    );
    
    if (testStatuses.length === 0) {
      return res.json({ success: false, message: '测试状态不存在' });
    }
    
    res.json({ success: true, testStatus: testStatuses[0] });
  } catch (error) {
    console.error('获取单个测试状态错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试状态
app.post('/api/test-statuses/update', async (req, res) => {
  try {
    console.log('接收到更新测试状态请求:', req.body);
    const { id, name, description } = req.body;
    
    // 验证必填字段
    if (!id || !name) {
      return res.json({ success: false, message: '测试状态ID和名称不能为空' });
    }
    
    // 更新测试状态记录
    await pool.execute(
      `UPDATE test_statuses 
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '测试状态更新成功' });
  } catch (error) {
    console.error('更新测试状态错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试状态
app.delete('/api/test-statuses/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除测试状态请求:', { id });
    
    // 验证必填字段
    if (!id) {
      return res.json({ success: false, message: '测试状态ID不能为空' });
    }
    
    // 删除测试状态记录
    await pool.execute(
      `DELETE FROM test_statuses WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '测试状态删除成功' });
  } catch (error) {
    console.error('删除测试状态错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// ==================== 优先级管理相关路由 ====================

// 创建优先级
app.post('/api/priorities/create', async (req, res) => {
  try {
    console.log('接收到创建优先级请求:', req.body);
    const { name, description, creator } = req.body;
    
    if (!name || !creator) {
      return res.json({ success: false, message: '优先级名称和创建者不能为空' });
    }
    
    const priorityId = 'PRIORITY-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    await pool.execute(
      `INSERT INTO test_priorities (priority_id, name, description, creator) 
       VALUES (?, ?, ?, ?)`,
      [priorityId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '优先级创建成功', priorityId });
  } catch (error) {
    console.error('创建优先级错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取优先级列表
app.get('/api/priorities/list', async (req, res) => {
  try {
    const [priorities] = await pool.execute(
      `SELECT id, priority_id, name, description, creator, created_at, updated_at 
       FROM test_priorities 
       ORDER BY id ASC`
    );
    
    res.json({ success: true, priorities });
  } catch (error) {
    console.error('获取优先级列表错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个优先级
app.get('/api/priorities/get', async (req, res) => {
  try {
    const { id } = req.query;
    
    const [priorities] = await pool.execute(
      `SELECT id, priority_id, name, description, creator, created_at, updated_at 
       FROM test_priorities 
       WHERE id = ?`,
      [id]
    );
    
    if (priorities.length === 0) {
      return res.json({ success: false, message: '优先级不存在' });
    }
    
    res.json({ success: true, priority: priorities[0] });
  } catch (error) {
    console.error('获取单个优先级错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新优先级
app.post('/api/priorities/update', async (req, res) => {
  try {
    const { id, name, description } = req.body;
    
    if (!id) {
      return res.json({ success: false, message: '优先级ID不能为空' });
    }
    
    await pool.execute(
      `UPDATE test_priorities SET name = ?, description = ? WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '优先级更新成功' });
  } catch (error) {
    console.error('更新优先级错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除优先级
app.delete('/api/priorities/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除优先级请求:', { id });
    
    if (!id) {
      return res.json({ success: false, message: '优先级ID不能为空' });
    }
    
    await pool.execute(
      `DELETE FROM test_priorities WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '优先级删除成功' });
  } catch (error) {
    console.error('删除优先级错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 测试方式管理相关路由

// 创建测试方式
app.post('/api/test-methods/create', async (req, res) => {
  try {
    console.log('接收到创建测试方式请求:', req.body);
    const { name, description, creator } = req.body;
    
    // 验证必填字段
    if (!name || !creator) {
      return res.json({ success: false, message: '测试方式名称和创建者不能为空' });
    }
    
    // 生成唯一的method_id
    const methodId = 'METHOD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    // 插入测试方式记录
    await pool.execute(
      `INSERT INTO test_methods (method_id, name, description, creator) 
       VALUES (?, ?, ?, ?)`,
      [methodId, name, description || '', creator]
    );
    
    res.json({ success: true, message: '测试方式创建成功', methodId });
  } catch (error) {
    console.error('创建测试方式错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试方式列表
app.get('/api/test-methods/list', async (req, res) => {
  try {
    console.log('接收到获取测试方式列表请求');
    
    // 查询所有测试方式
    const [testMethods] = await pool.execute(
      `SELECT id, method_id, name, description, creator, created_at, updated_at 
       FROM test_methods 
       ORDER BY created_at DESC`
    );
    
    res.json({ success: true, testMethods });
  } catch (error) {
    console.error('获取测试方式列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个测试方式
app.get('/api/test-methods/get', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到获取单个测试方式请求:', { id });
    
    // 查询单个测试方式
    const [testMethods] = await pool.execute(
      `SELECT id, method_id, name, description, creator, created_at, updated_at 
       FROM test_methods 
       WHERE id = ?`,
      [id]
    );
    
    if (testMethods.length === 0) {
      return res.json({ success: false, message: '测试方式不存在' });
    }
    
    res.json({ success: true, testMethod: testMethods[0] });
  } catch (error) {
    console.error('获取单个测试方式错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试方式
app.post('/api/test-methods/update', async (req, res) => {
  try {
    console.log('接收到更新测试方式请求:', req.body);
    const { id, name, description } = req.body;
    
    // 验证必填字段
    if (!id || !name) {
      return res.json({ success: false, message: '测试方式ID和名称不能为空' });
    }
    
    // 更新测试方式记录
    await pool.execute(
      `UPDATE test_methods 
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '测试方式更新成功' });
  } catch (error) {
    console.error('更新测试方式错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试方式
app.delete('/api/test-methods/delete', async (req, res) => {
  try {
    const { id } = req.query;
    console.log('接收到删除测试方式请求:', { id });
    
    // 验证必填字段
    if (!id) {
      return res.json({ success: false, message: '测试方式ID不能为空' });
    }
    
    // 删除测试方式记录
    await pool.execute(
      `DELETE FROM test_methods WHERE id = ?`,
      [id]
    );
    
    res.json({ success: true, message: '测试方式删除成功' });
  } catch (error) {
    console.error('删除测试方式错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 根据library_id、module_id和level1_id获取匹配的测试用例
app.get('/api/cases/match/:libraryId/:moduleId/:level1Id', async (req, res) => {
  try {
    const { libraryId, moduleId, level1Id } = req.params;
    const { keyword } = req.query; // 获取搜索关键词
    console.log('接收到匹配测试用例请求:', { libraryId, moduleId, level1Id, keyword });
    
    // 构建基础查询
    let query = `
      SELECT 
        tc.id, tc.case_id, tc.name, tc.priority, tc.type, tc.creator, tc.purpose,
        tc.precondition, tc.steps, tc.expected, tc.owner, tc.library_id, tc.module_id, tc.level1_id,
        tc.created_at, tc.updated_at, tc.remark, tc.key_config
      FROM test_cases tc
      WHERE tc.library_id = ? AND tc.module_id = ? AND tc.level1_id = ?
    `;
    
    const params = [libraryId, moduleId, level1Id];
    
    // 如果有搜索关键词，添加模糊搜索条件
    if (keyword && keyword.trim() !== '') {
      query += ` AND (tc.name LIKE ? OR tc.purpose LIKE ? OR tc.owner LIKE ?)`;
      const searchPattern = `%${keyword.trim()}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }
    
    query += ` ORDER BY tc.created_at DESC`;
    
    console.log('执行SQL查询:', query);
    console.log('查询参数:', params);
    
    const [testCases] = await pool.execute(query, params);
    
    console.log('查询结果:', testCases);
    
    // 获取测试用例环境信息
    const testCaseIds = testCases.map(tc => tc.id);
    let testCaseEnvironments = {};
    let testCaseMethods = {};
    let testCasePhases = {};
    let testCaseSources = {};
    
    if (testCaseIds.length > 0) {
      // 查询测试用例环境关联
      const envQuery = `
        SELECT tce.test_case_id, GROUP_CONCAT(e.name) as environments
        FROM test_case_environments tce
        JOIN environments e ON tce.environment_id = e.id
        WHERE tce.test_case_id IN (${testCaseIds.join(',')})
        GROUP BY tce.test_case_id
      `;
      const [envResults] = await pool.execute(envQuery);
      envResults.forEach(result => {
        testCaseEnvironments[result.test_case_id] = result.environments;
      });
      
      // 查询测试用例测试方式关联
      const methodQuery = `
        SELECT tcm.test_case_id, GROUP_CONCAT(tm.name) as methods
        FROM test_case_methods tcm
        JOIN test_methods tm ON tcm.method_id = tm.id
        WHERE tcm.test_case_id IN (${testCaseIds.join(',')})
        GROUP BY tcm.test_case_id
      `;
      const [methodResults] = await pool.execute(methodQuery);
      methodResults.forEach(result => {
        testCaseMethods[result.test_case_id] = result.methods;
      });
      
      // 查询测试用例测试阶段关联
      const phaseQuery = `
        SELECT tcp.test_case_id, GROUP_CONCAT(tp.name) as phases
        FROM test_case_phases tcp
        JOIN test_phases tp ON tcp.phase_id = tp.id
        WHERE tcp.test_case_id IN (${testCaseIds.join(',')})
        GROUP BY tcp.test_case_id
      `;
      const [phaseResults] = await pool.execute(phaseQuery);
      phaseResults.forEach(result => {
        testCasePhases[result.test_case_id] = result.phases;
      });
      
      // 查询测试用例测试点来源关联
      const sourceQuery = `
        SELECT tcs.test_case_id, GROUP_CONCAT(ts.name) as sources
        FROM test_case_sources tcs
        JOIN test_sources ts ON tcs.source_id = ts.id
        WHERE tcs.test_case_id IN (${testCaseIds.join(',')})
        GROUP BY tcs.test_case_id
      `;
      const [sourceResults] = await pool.execute(sourceQuery);
      sourceResults.forEach(result => {
        testCaseSources[result.test_case_id] = result.sources;
      });
    }
    
    // 将测试用例数据转换为前端需要的格式
    const formattedTestCases = testCases.map(testCase => ({
      id: testCase.id,
      name: testCase.name,
      caseId: testCase.case_id,
      priority: testCase.priority,
      type: testCase.type,
      precondition: testCase.precondition || '',
      creator: testCase.creator,
      createdAt: testCase.created_at,
      updatedAt: testCase.updated_at,
      remark: testCase.remark || '',
      key_config: testCase.key_config || '',
      // 添加模块ID、用例库ID和一级测试点ID
      moduleId: testCase.module_id,
      libraryId: testCase.library_id,
      level1Id: testCase.level1_id,
      // 悬浮面板需要的字段映射
      test_steps: testCase.steps || '',
      expected_behavior: testCase.expected || '',
      test_environment: testCaseEnvironments[testCase.id] || '',
      case_name: testCase.name,
      purpose: testCase.purpose || '',
      owner: testCase.owner || testCase.creator || '',
      test_method: testCaseMethods[testCase.id] || testCase.type || '',
      test_phase: testCasePhases[testCase.id] || '',
      test_source: testCaseSources[testCase.id] || ''
    }));
    
    res.json({ 
      success: true,
      testCases: formattedTestCases
    });
  } catch (error) {
    console.error('获取匹配测试用例错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试用例
app.put('/api/testcases/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, priority, owner, type, precondition, purpose, steps, expected, test_environment } = req.body;
    
    console.log('接收到更新测试用例请求:', { id, name, priority, owner, type, precondition, purpose, steps, expected, test_environment });
    
    // 更新test_cases表
    const updateQuery = `
      UPDATE test_cases 
      SET name = ?, priority = ?, owner = ?, type = ?, precondition = ?, purpose = ?, steps = ?, expected = ?
      WHERE id = ?
    `;
    
    const updateParams = [name, priority, owner, type, precondition, purpose, steps, expected, id];
    console.log('执行SQL更新:', updateQuery);
    console.log('更新参数:', updateParams);
    
    const [updateResult] = await pool.execute(updateQuery, updateParams);
    
    console.log('更新结果:', updateResult);
    
    if (updateResult.affectedRows === 0) {
      return res.json({ success: false, message: '测试用例不存在' });
    }
    
    // 更新测试用例环境关联
    if (test_environment) {
      // 先删除现有关联
      await pool.execute('DELETE FROM test_case_environments WHERE test_case_id = ?', [id]);
      
      // 添加新关联
      const environments = test_environment.split(',').map(env => env.trim());
      for (const envName of environments) {
        if (envName) {
          // 查找环境ID
          const [envResults] = await pool.execute('SELECT id FROM environments WHERE name = ?', [envName]);
          if (envResults.length > 0) {
            await pool.execute(
              'INSERT INTO test_case_environments (test_case_id, environment_id) VALUES (?, ?)',
              [id, envResults[0].id]
            );
          }
        }
      }
    }
    
    // 更新测试用例测试方式关联
    if (type) {
      // 先删除现有关联
      await pool.execute('DELETE FROM test_case_methods WHERE test_case_id = ?', [id]);
      
      // 添加新关联
      // 查找测试方式ID
      const [methodResults] = await pool.execute('SELECT id FROM test_methods WHERE name = ?', [type]);
      if (methodResults.length > 0) {
        await pool.execute(
          'INSERT INTO test_case_methods (test_case_id, method_id) VALUES (?, ?)',
          [id, methodResults[0].id]
        );
      }
    }
    
    res.json({ success: true, message: '测试用例更新成功' });
  } catch (error) {
    console.error('更新测试用例错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试类型列表
app.get('/api/testtypes/list', async (req, res) => {
  try {
    console.log('接收到获取测试类型列表请求');
    
    // 查询test_types表
    const query = 'SELECT id, name, description FROM test_types ORDER BY id ASC';
    
    const [testTypes] = await pool.execute(query);
    
    console.log('查询到的测试类型:', testTypes);
    
    res.json({ 
      success: true, 
      testTypes: testTypes.map(type => ({
        id: type.id,
        name: type.name,
        description: type.description || ''
      })) 
    });
  } catch (error) {
    console.error('获取测试类型列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试用例关联的项目
app.get('/api/testcases/:id/projects', async (req, res) => {
  try {
    let { id } = req.params;
    console.log('接收到获取测试用例关联项目请求:', { id });
    
    // 检查id是否为字符串（如CASE-20260118-8279），如果是则查找对应的整数id
    let testCaseId = id;
    if (isNaN(Number(id))) {
      // 是字符串，根据case_id查找对应的整数id
      const [testCases] = await pool.execute(
        'SELECT id FROM test_cases WHERE case_id = ?', [id]
      );
      
      if (testCases.length === 0) {
        // 如果没有找到对应的测试用例，返回空数组
        return res.json({ success: true, projects: [] });
      }
      
      testCaseId = testCases[0].id;
      console.log(`根据case_id ${id} 查找到整数id: ${testCaseId}`);
    } else {
      // 是数字，直接使用
      testCaseId = Number(id);
    }
    
    // 查询测试用例关联的项目，包含测试进度、测试状态、负责人和备注信息
    const query = `
      SELECT p.id, p.name, p.description, p.created_at,
             tcp.owner, tcp.progress_id, tcp.status_id, tcp.remark,
             tp.name as progress_name, ts.name as status_name
      FROM projects p
      JOIN test_case_projects tcp ON p.id = tcp.project_id
      LEFT JOIN test_progresses tp ON tcp.progress_id = tp.id
      LEFT JOIN test_statuses ts ON tcp.status_id = ts.id
      WHERE tcp.test_case_id = ?
      ORDER BY p.name ASC
    `;
    
    const [projects] = await pool.execute(query, [testCaseId]);
    
    console.log('查询到的测试用例关联项目:', projects);
    
    res.json({ success: true, projects: projects });
  } catch (error) {
    console.error('获取测试用例关联项目错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 初始化：确保test_case_projects表包含所有必要字段
async function initTestCaseProjectsTable() {
  try {
    // 获取当前表结构
    const [columns] = await pool.execute(
      "SHOW COLUMNS FROM test_case_projects"
    );
    
    const columnNames = columns.map(col => col.Field);
    console.log('test_case_projects当前字段:', columnNames);
    
    // 定义需要的字段
    const requiredFields = [
      { name: 'progress_id', type: 'INT', default: 'NULL' },
      { name: 'status_id', type: 'INT', default: 'NULL' },
      { name: 'remark', type: 'VARCHAR(128)', default: "''" },
      { name: 'owner', type: 'VARCHAR(50)', default: "''" },
      { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' }
    ];
    
    // 添加缺失的字段
    for (const field of requiredFields) {
      if (!columnNames.includes(field.name)) {
        await pool.execute(
          `ALTER TABLE test_case_projects ADD COLUMN ${field.name} ${field.type} DEFAULT ${field.default}`
        );
        console.log(`已添加${field.name}字段到test_case_projects表`);
      }
    }
    
    // 确保有唯一约束
    try {
      await pool.execute(
        "ALTER TABLE test_case_projects ADD UNIQUE KEY IF NOT EXISTS unique_test_case_project (test_case_id, project_id)"
      );
    } catch (error) {
      console.log('test_case_projects表已存在唯一约束');
    }
    
    console.log('test_case_projects表初始化完成');
  } catch (error) {
    console.error('初始化test_case_projects表失败:', error);
  }
}

// 更新测试用例关联的项目
app.put('/api/testcases/:id/projects', async (req, res) => {
  try {
    let { id } = req.params;
    const { associations, projectIds } = req.body;
    console.log('接收到更新测试用例关联项目请求:', { id, associations, projectIds });
    
    // 开始事务
    await pool.query('START TRANSACTION');
    
    try {
      // 检查id是否为字符串（如CASE-20260118-8279），如果是则查找对应的整数id
      let testCaseId = id;
      if (isNaN(Number(id))) {
        // 是字符串，根据case_id查找对应的整数id
        const [testCases] = await pool.execute(
          'SELECT id FROM test_cases WHERE case_id = ?', [id]
        );
        
        if (testCases.length === 0) {
          throw new Error(`测试用例不存在: ${id}`);
        }
        
        testCaseId = testCases[0].id;
        console.log(`根据case_id ${id} 查找到整数id: ${testCaseId}`);
      } else {
        // 是数字，直接使用
        testCaseId = Number(id);
      }
      
      // 删除现有关联
      await pool.execute('DELETE FROM test_case_projects WHERE test_case_id = ?', [testCaseId]);
      
      // 处理关联数据
      let insertValues = [];
      
      if (associations && Array.isArray(associations) && associations.length > 0) {
        // 处理详细关联信息，使用循环插入而不是批量插入，避免语法错误
        for (const assoc of associations) {
            const insertQuery = 'INSERT INTO test_case_projects (test_case_id, project_id, owner, progress_id, status_id, remark) VALUES (?, ?, ?, ?, ?, ?)';
            await pool.execute(insertQuery, [
                testCaseId, 
                assoc.project_id, 
                assoc.owner || '', 
                assoc.progress_id || '', 
                assoc.status_id || '', 
                assoc.remark || ''
            ]);
        }
        console.log('插入了', associations.length, '条关联项目记录');
        } else if (projectIds && Array.isArray(projectIds) && projectIds.length > 0) {
        // 兼容旧格式，只处理项目ID，使用循环插入
        for (const projectId of projectIds) {
            const insertQuery = 'INSERT INTO test_case_projects (test_case_id, project_id) VALUES (?, ?)';
            await pool.execute(insertQuery, [testCaseId, projectId]);
        }
        console.log('插入了', projectIds.length, '条关联项目记录（旧格式）');
        } else {
        console.log('没有关联项目数据需要保存');
        }
      
      // 提交事务
      await pool.query('COMMIT');
      
      console.log('测试用例关联项目更新成功:', { id, associations, projectIds });
      res.json({ success: true, message: '测试用例关联项目更新成功' });
    } catch (transactionError) {
      // 回滚事务
      await pool.query('ROLLBACK');
      throw transactionError;
    }
  } catch (error) {
    console.error('更新测试用例关联项目错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试管理统计数据
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    console.log('接收到获取测试管理统计数据请求');
    
    const [testCaseResult] = await pool.execute('SELECT COUNT(*) as count FROM test_cases');
    const testCaseCount = testCaseResult[0].count;
    
    const [testReportResult] = await pool.execute('SELECT COUNT(*) as count FROM test_reports');
    const testReportCount = testReportResult[0].count;
    
    const [testPlanResult] = await pool.execute('SELECT COUNT(*) as count FROM test_plans');
    const testPlanCount = testPlanResult[0].count;
    
    res.json({
      success: true,
      stats: {
        totalTestCases: testCaseCount,
        testReportCount: testReportCount,
        testPlanCount: testPlanCount
      }
    });
  } catch (error) {
    console.error('获取测试管理统计数据错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取项目测试进度数据
app.get('/api/dashboard/project-progress', async (req, res) => {
  try {
    console.log('接收到获取项目测试进度数据请求');
    
    const { projectId, owner, statusId, progressId, libraryId } = req.query;
    
    // 构建查询条件
    let whereClause = '1=1';
    const params = [];
    
    if (projectId && projectId !== 'all') {
      whereClause += ' AND p.id = ?';
      params.push(projectId);
    }
    
    if (owner && owner !== 'all') {
      whereClause += ' AND tcp.owner = ?';
      params.push(owner);
    }
    
    if (statusId && statusId !== 'all') {
      whereClause += ' AND tcp.status_id = ?';
      params.push(statusId);
    }
    
    if (progressId && progressId !== 'all') {
      whereClause += ' AND tcp.progress_id = ?';
      params.push(progressId);
    }
    
    if (libraryId && libraryId !== 'all') {
      whereClause += ' AND tc.library_id = ?';
      params.push(libraryId);
    }
    
    // 获取每个项目的测试进度统计
    const [projectStats] = await pool.execute(`
      SELECT 
        p.id,
        p.name as project_name,
        COUNT(tcp.id) as total_cases,
        SUM(CASE WHEN ts.status_category = 'passed' THEN 1 ELSE 0 END) as passed_count,
        SUM(CASE WHEN ts.status_category = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN ts.status_category = 'pending' OR ts.status_category IS NULL THEN 1 ELSE 0 END) as pending_count
      FROM projects p
      LEFT JOIN test_case_projects tcp ON p.id = tcp.project_id
      LEFT JOIN test_statuses ts ON tcp.status_id = ts.id
      LEFT JOIN test_cases tc ON tcp.test_case_id = tc.id
      WHERE ${whereClause}
      GROUP BY p.id, p.name
      ORDER BY total_cases DESC
    `, params);
    
    // 计算每个项目的通过率和进度
    const projectProgress = projectStats.map(project => {
      const totalTested = (project.passed_count || 0) + (project.failed_count || 0);
      const passRate = totalTested > 0 ? ((project.passed_count || 0) / totalTested * 100).toFixed(1) : 0;
      const progress = project.total_cases > 0 ? (totalTested / project.total_cases * 100).toFixed(1) : 0;
      
      return {
        projectId: project.id,
        projectName: project.project_name,
        totalCases: project.total_cases || 0,
        passedCount: project.passed_count || 0,
        failedCount: project.failed_count || 0,
        pendingCount: project.pending_count || 0,
        passRate: passRate + '%',
        progress: progress + '%'
      };
    });
    
    res.json({
      success: true,
      projectProgress
    });
  } catch (error) {
    console.error('获取项目测试进度数据错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取负责人任务分析数据
app.get('/api/dashboard/owner-analysis', async (req, res) => {
  try {
    console.log('接收到获取负责人任务分析数据请求');
    
    const { projectId, owner, statusId, progressId, libraryId } = req.query;
    
    // 构建查询条件
    let whereClause = 'tcp.owner IS NOT NULL AND tcp.owner != ""';
    const params = [];
    
    if (projectId && projectId !== 'all') {
      whereClause += ' AND tcp.project_id = ?';
      params.push(projectId);
    }
    
    if (owner && owner !== 'all') {
      whereClause += ' AND tcp.owner = ?';
      params.push(owner);
    }
    
    if (statusId && statusId !== 'all') {
      whereClause += ' AND tcp.status_id = ?';
      params.push(statusId);
    }
    
    if (progressId && progressId !== 'all') {
      whereClause += ' AND tcp.progress_id = ?';
      params.push(progressId);
    }
    
    if (libraryId && libraryId !== 'all') {
      whereClause += ' AND tc.library_id = ?';
      params.push(libraryId);
    }
    
    // 获取每个负责人的任务统计
    const [ownerStats] = await pool.execute(`
      SELECT 
        tcp.owner,
        COUNT(tcp.id) as total_tasks,
        SUM(CASE WHEN ts.status_category = 'passed' THEN 1 ELSE 0 END) as passed_count,
        SUM(CASE WHEN ts.status_category = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN ts.status_category = 'pending' OR ts.status_category IS NULL THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN tp.status_category = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN tp.status_category = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN tp.status_category IS NULL OR tp.status_category = 'not_started' THEN 1 ELSE 0 END) as not_started_count
      FROM test_case_projects tcp
      LEFT JOIN test_statuses ts ON tcp.status_id = ts.id
      LEFT JOIN test_progresses tp ON tcp.progress_id = tp.id
      LEFT JOIN test_cases tc ON tcp.test_case_id = tc.id
      WHERE ${whereClause}
      GROUP BY tcp.owner
      ORDER BY total_tasks DESC
    `, params);
    
    // 计算每个负责人的通过率
    const ownerAnalysis = ownerStats.map(owner => {
      const totalTested = (owner.passed_count || 0) + (owner.failed_count || 0);
      const passRate = totalTested > 0 ? ((owner.passed_count || 0) / totalTested * 100).toFixed(1) : 0;
      
      return {
        owner: owner.owner,
        totalTasks: owner.total_tasks || 0,
        passedCount: owner.passed_count || 0,
        failedCount: owner.failed_count || 0,
        pendingCount: owner.pending_count || 0,
        completedCount: owner.completed_count || 0,
        inProgressCount: owner.in_progress_count || 0,
        notStartedCount: owner.not_started_count || 0,
        passRate: passRate + '%'
      };
    });
    
    res.json({
      success: true,
      ownerAnalysis
    });
  } catch (error) {
    console.error('获取负责人任务分析数据错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试状态分布数据
app.get('/api/dashboard/status-distribution', async (req, res) => {
  try {
    console.log('接收到获取测试状态分布数据请求');
    
    const { projectId, owner, statusId, progressId, libraryId } = req.query;
    
    // 构建查询条件
    let whereClause = '1=1';
    const params = [];
    
    if (projectId && projectId !== 'all') {
      whereClause += ' AND tcp.project_id = ?';
      params.push(projectId);
    }
    
    if (owner && owner !== 'all') {
      whereClause += ' AND tcp.owner = ?';
      params.push(owner);
    }
    
    if (statusId && statusId !== 'all') {
      whereClause += ' AND tcp.status_id = ?';
      params.push(statusId);
    }
    
    if (progressId && progressId !== 'all') {
      whereClause += ' AND tcp.progress_id = ?';
      params.push(progressId);
    }
    
    if (libraryId && libraryId !== 'all') {
      whereClause += ' AND tc.library_id = ?';
      params.push(libraryId);
    }
    
    const [statusDistribution] = await pool.execute(`
      SELECT 
        ts.id,
        ts.name as status_name,
        COUNT(tcp.id) as count
      FROM test_statuses ts
      LEFT JOIN test_case_projects tcp ON ts.id = tcp.status_id
      LEFT JOIN test_cases tc ON tcp.test_case_id = tc.id
      WHERE ${whereClause}
      GROUP BY ts.id, ts.name
      ORDER BY count DESC
    `, params);
    
    res.json({
      success: true,
      statusDistribution
    });
  } catch (error) {
    console.error('获取测试状态分布数据错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试进度分布数据
app.get('/api/dashboard/progress-distribution', async (req, res) => {
  try {
    console.log('接收到获取测试进度分布数据请求');
    
    const { projectId, owner, statusId, progressId, libraryId } = req.query;
    
    // 构建查询条件
    let whereClause = '1=1';
    const params = [];
    
    if (projectId && projectId !== 'all') {
      whereClause += ' AND tcp.project_id = ?';
      params.push(projectId);
    }
    
    if (owner && owner !== 'all') {
      whereClause += ' AND tcp.owner = ?';
      params.push(owner);
    }
    
    if (statusId && statusId !== 'all') {
      whereClause += ' AND tcp.status_id = ?';
      params.push(statusId);
    }
    
    if (progressId && progressId !== 'all') {
      whereClause += ' AND tcp.progress_id = ?';
      params.push(progressId);
    }
    
    if (libraryId && libraryId !== 'all') {
      whereClause += ' AND tc.library_id = ?';
      params.push(libraryId);
    }
    
    const [progressDistribution] = await pool.execute(`
      SELECT 
        tp.id,
        tp.name as progress_name,
        COUNT(tcp.id) as count
      FROM test_progresses tp
      LEFT JOIN test_case_projects tcp ON tp.id = tcp.progress_id
      LEFT JOIN test_cases tc ON tcp.test_case_id = tc.id
      WHERE ${whereClause}
      GROUP BY tp.id, tp.name
      ORDER BY count DESC
    `, params);
    
    res.json({
      success: true,
      progressDistribution
    });
  } catch (error) {
    console.error('获取测试进度分布数据错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取通过率趋势数据
app.get('/api/dashboard/trend/pass-rate', async (req, res) => {
  try {
    console.log('接收到获取通过率趋势数据请求');
    
    const { projectId, owner, statusId, progressId, libraryId, days = 7 } = req.query;
    const daysNum = parseInt(days) || 7;
    
    // 构建查询条件
    let whereClause = '1=1';
    const params = [];
    
    if (projectId && projectId !== 'all') {
      whereClause += ' AND tcp.project_id = ?';
      params.push(projectId);
    }
    
    if (owner && owner !== 'all') {
      whereClause += ' AND tcp.owner = ?';
      params.push(owner);
    }
    
    if (libraryId && libraryId !== 'all') {
      whereClause += ' AND tc.library_id = ?';
      params.push(libraryId);
    }
    
    // 获取每日通过率趋势
    const trendQuery = `
      SELECT 
        DATE(tcp.updated_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN ts.name LIKE '%pass%' OR ts.name LIKE '%通过%' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN ts.name LIKE '%fail%' OR ts.name LIKE '%失败%' THEN 1 ELSE 0 END) as failed
      FROM test_case_projects tcp
      LEFT JOIN test_statuses ts ON tcp.status_id = ts.id
      LEFT JOIN test_cases tc ON tcp.test_case_id = tc.id
      WHERE ${whereClause} AND tcp.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(tcp.updated_at)
      ORDER BY date ASC
    `;
    params.push(daysNum);
    
    const [trendResults] = await pool.execute(trendQuery, params);
    
    // 生成日期标签
    const labels = [];
    const passRates = [];
    const passedCounts = [];
    const failedCounts = [];
    
    for (let i = daysNum - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      labels.push(date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));
      
      const dayData = trendResults.find(r => r.date && r.date.toISOString && r.date.toISOString().split('T')[0] === dateStr);
      if (dayData) {
        const total = (dayData.passed || 0) + (dayData.failed || 0);
        passRates.push(total > 0 ? ((dayData.passed / total) * 100).toFixed(1) : 0);
        passedCounts.push(dayData.passed || 0);
        failedCounts.push(dayData.failed || 0);
      } else {
        passRates.push(0);
        passedCounts.push(0);
        failedCounts.push(0);
      }
    }
    
    res.json({
      success: true,
      trendData: { labels, passRates, passedCounts, failedCounts }
    });
  } catch (error) {
    console.error('获取通过率趋势数据错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取执行次数趋势数据
app.get('/api/dashboard/trend/executions', async (req, res) => {
  try {
    console.log('接收到获取执行次数趋势数据请求');
    
    const { projectId, owner, statusId, progressId, libraryId, days = 7 } = req.query;
    const daysNum = parseInt(days) || 7;
    
    // 构建查询条件
    let whereClause = '1=1';
    const params = [];
    
    if (projectId && projectId !== 'all') {
      whereClause += ' AND tcp.project_id = ?';
      params.push(projectId);
    }
    
    if (owner && owner !== 'all') {
      whereClause += ' AND tcp.owner = ?';
      params.push(owner);
    }
    
    if (libraryId && libraryId !== 'all') {
      whereClause += ' AND tc.library_id = ?';
      params.push(libraryId);
    }
    
    // 获取每日执行次数趋势
    const trendQuery = `
      SELECT 
        DATE(tcp.updated_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN ts.name LIKE '%pass%' OR ts.name LIKE '%通过%' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN ts.name LIKE '%fail%' OR ts.name LIKE '%失败%' THEN 1 ELSE 0 END) as failed
      FROM test_case_projects tcp
      LEFT JOIN test_statuses ts ON tcp.status_id = ts.id
      LEFT JOIN test_cases tc ON tcp.test_case_id = tc.id
      WHERE ${whereClause} AND tcp.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(tcp.updated_at)
      ORDER BY date ASC
    `;
    params.push(daysNum);
    
    const [trendResults] = await pool.execute(trendQuery, params);
    
    // 生成日期标签
    const labels = [];
    const passedCounts = [];
    const failedCounts = [];
    
    for (let i = daysNum - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      labels.push(date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));
      
      const dayData = trendResults.find(r => r.date && r.date.toISOString && r.date.toISOString().split('T')[0] === dateStr);
      if (dayData) {
        passedCounts.push(dayData.passed || 0);
        failedCounts.push(dayData.failed || 0);
      } else {
        passedCounts.push(0);
        failedCounts.push(0);
      }
    }
    
    res.json({
      success: true,
      trendData: { labels, passedCounts, failedCounts }
    });
  } catch (error) {
    console.error('获取执行次数趋势数据错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试用例
app.delete('/api/testcases/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('接收到删除测试用例请求:', { id });
    
    // 开始事务
    await pool.query('START TRANSACTION');
    
    try {
      // 删除测试用例环境关联
      await pool.execute('DELETE FROM test_case_environments WHERE test_case_id = ?', [id]);
      
      // 删除测试用例测试方式关联
      await pool.execute('DELETE FROM test_case_methods WHERE test_case_id = ?', [id]);
      
      // 删除测试用例测试类型关联（正确的表名）
      await pool.execute('DELETE FROM test_case_test_types WHERE test_case_id = ?', [id]);
      
      // 删除测试用例测试状态关联
      await pool.execute('DELETE FROM test_case_statuses WHERE test_case_id = ?', [id]);
      
      // 删除测试用例项目关联
      await pool.execute('DELETE FROM test_case_projects WHERE test_case_id = ?', [id]);
      
      // 删除测试用例
      const deleteQuery = 'DELETE FROM test_cases WHERE id = ?';
      const [deleteResult] = await pool.execute(deleteQuery, [id]);
      
      if (deleteResult.affectedRows === 0) {
        await pool.query('ROLLBACK');
        return res.json({ success: false, message: '测试用例不存在' });
      }
      
      // 提交事务
      await pool.query('COMMIT');
      
      console.log('测试用例删除成功:', { id });
      res.json({ success: true, message: '测试用例删除成功' });
    } catch (transactionError) {
      // 回滚事务
      await pool.query('ROLLBACK');
      throw transactionError;
    }
  } catch (error) {
    console.error('删除测试用例错误:', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 初始化数据库
async function initDatabase() {
  try {
    console.log('开始初始化数据库...');
    
    // 连接到MySQL服务器
    const connection = await pool.getConnection();
    
    try {
      // 检查数据库是否存在（使用字符串拼接，兼容MySQL 4.1.22）
      const [databases] = await connection.execute(`SHOW DATABASES LIKE '${process.env.DB_NAME}'`);
      
      if (databases.length === 0) {
        // 创建数据库
        await connection.execute(`CREATE DATABASE ${process.env.DB_NAME}`);
        console.log(`数据库 ${process.env.DB_NAME} 创建成功`);
      } else {
        console.log(`数据库 ${process.env.DB_NAME} 已存在`);
      }
      
      // 不需要执行USE命令，因为已经在连接时指定了数据库名
      
      // 创建用户表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INT PRIMARY KEY AUTO_INCREMENT,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('用户表创建成功');
      
      // 确保users表有必要的拓展字段
      try {
        const [columns] = await connection.execute("SHOW COLUMNS FROM users");
        const columnNames = columns.map(c => c.Field);
        
        if (!columnNames.includes('status')) {
          await connection.execute(
            "ALTER TABLE users ADD COLUMN status ENUM('pending', 'active', 'disabled') DEFAULT 'active' COMMENT '用户状态: pending-待审核, active-正常, disabled-禁用'"
          );
          console.log('用户表status字段添加成功');
        } else {
          console.log('用户表status字段已存在');
        }

        // 添加统一的通知偏好字段
        if (!columnNames.includes('email_notify_mentions')) {
          await connection.execute("ALTER TABLE users ADD COLUMN email_notify_mentions BOOLEAN DEFAULT TRUE COMMENT '接收@提醒邮件'");
          await connection.execute("ALTER TABLE users ADD COLUMN email_notify_comments BOOLEAN DEFAULT TRUE COMMENT '接收评论提醒邮件'");
          await connection.execute("ALTER TABLE users ADD COLUMN email_notify_likes BOOLEAN DEFAULT FALSE COMMENT '接收被赞提醒邮件'");
          console.log('用户表邮件偏好通知字段添加成功');
        }
        
        // 添加 muted_until 字段（用户禁言到期时间）
        if (!columnNames.includes('muted_until')) {
          await connection.execute("ALTER TABLE users ADD COLUMN muted_until TIMESTAMP NULL COMMENT '禁言到期时间'");
          console.log('用户表muted_until字段添加成功');
        }

      } catch (error) {
        console.error('检查或添加用户表拓展字段错误:', error);
      }
      
      // 创建模块表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS modules (
          id INT PRIMARY KEY AUTO_INCREMENT,
          module_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          library_id INT,
          parent_id INT,
          order_index INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 确保library_id字段存在
      try {
        await connection.execute(`ALTER TABLE modules ADD COLUMN library_id INT`);
      } catch (error) {
        console.log('library_id字段已存在');
      }
      
      // 确保parent_id字段存在
      try {
        await connection.execute(`ALTER TABLE modules ADD COLUMN parent_id INT`);
      } catch (error) {
        console.log('parent_id字段已存在');
      }
      
      // 确保order_index字段存在
      try {
        await connection.execute(`ALTER TABLE modules ADD COLUMN order_index INT DEFAULT 0`);
      } catch (error) {
        console.log('order_index字段已存在');
      }
      console.log('模块表创建成功');
      
      // 创建一级测试点表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS level1_points (
          id INT PRIMARY KEY AUTO_INCREMENT,
          module_id INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          test_type VARCHAR(50) DEFAULT '功能测试',
          order_index INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      
      // 确保order_index字段存在
      try {
        await connection.execute(`ALTER TABLE level1_points ADD COLUMN order_index INT DEFAULT 0`);
      } catch (error) {
        console.log('level1_points表order_index字段已存在');
      }
      console.log('一级测试点表创建成功');
      
      // 创建芯片表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS chips (
          id INT PRIMARY KEY AUTO_INCREMENT,
          chip_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('芯片表创建成功');
      
      // 创建二级测试点表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS level2_points (
          id INT PRIMARY KEY AUTO_INCREMENT,
          level1_id INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          test_steps TEXT NOT NULL,
          expected_behavior TEXT NOT NULL,
          test_environment VARCHAR(255) NOT NULL,
          case_name VARCHAR(100) NOT NULL,
          remarks TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('二级测试点表创建成功');
      
      // 创建历史记录表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS history (
          id INT PRIMARY KEY AUTO_INCREMENT,
          user VARCHAR(50) NOT NULL,
          action VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          version VARCHAR(20) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 创建测试点芯片关联表（多对多）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS testpoint_chips (
          id INT PRIMARY KEY AUTO_INCREMENT,
          testpoint_id INT NOT NULL,
          chip_id INT NOT NULL,
          chip_sequence VARCHAR(255) NOT NULL DEFAULT '',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_testpoint_chip (testpoint_id, chip_id)
        )
      `);
      console.log('测试点芯片关联表创建成功');
      
      // 检查并修改现有表结构，添加默认值
      try {
        await connection.execute(`
          ALTER TABLE testpoint_chips 
          MODIFY COLUMN chip_sequence VARCHAR(255) NOT NULL DEFAULT ''
        `);
        console.log('测试点芯片关联表结构已更新');
      } catch (error) {
        console.log('测试点芯片关联表结构已是最新');
      }
      
      // 创建测试点状态表（每个芯片对应一个状态）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS testpoint_status (
          id INT PRIMARY KEY AUTO_INCREMENT,
          testpoint_id INT NOT NULL,
          chip_id INT NOT NULL,
          test_result VARCHAR(20) NOT NULL,
          test_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_testpoint_chip_status (testpoint_id, chip_id)
        )
      `);
      console.log('测试点状态表创建成功');
      
      // 创建历史快照表（用于版本恢复）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS history_snapshots (
          id INT PRIMARY KEY AUTO_INCREMENT,
          entity_type VARCHAR(50) NOT NULL, -- module, level1_point, level2_point, chip
          entity_id INT NOT NULL,
          snapshot_data TEXT NOT NULL, -- JSON格式的完整数据快照
          version VARCHAR(20) NOT NULL,
          user VARCHAR(50) NOT NULL,
          action VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('历史快照表创建成功');
      console.log('历史记录表创建成功');
      
      // 创建测试计划表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_plans (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL,
          owner VARCHAR(50) NOT NULL,
          status VARCHAR(20) NOT NULL,
          test_phase VARCHAR(50) NOT NULL,
          project VARCHAR(100) NOT NULL,
          iteration VARCHAR(50),
          description TEXT,
          start_date DATE,
          end_date DATE,
          pass_rate DECIMAL(5,2),
          tested_cases INT DEFAULT 0,
          total_cases INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试计划表创建成功');
      
      // 创建测试报告表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_reports (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL,
          creator VARCHAR(50) NOT NULL,
          creator_id INT,
          project VARCHAR(100) NOT NULL,
          iteration VARCHAR(50),
          test_plan_id INT,
          report_type VARCHAR(20) NOT NULL,
          summary TEXT,
          has_ai_analysis BOOLEAN DEFAULT FALSE,
          status VARCHAR(20) DEFAULT 'ready',
          job_id VARCHAR(100),
          start_date DATE,
          end_date DATE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (test_plan_id) REFERENCES test_plans(id) ON DELETE SET NULL
        )
      `);
      console.log('测试报告表创建成功');
      
      // 添加新字段（逐个添加，忽略已存在错误）
      const alterStatements = [
        'ALTER TABLE test_reports ADD COLUMN has_ai_analysis BOOLEAN DEFAULT FALSE',
        'ALTER TABLE test_reports ADD COLUMN status VARCHAR(20) DEFAULT "ready"',
        'ALTER TABLE test_reports ADD COLUMN job_id VARCHAR(100)',
        'ALTER TABLE test_reports ADD COLUMN creator_id INT'
      ];
      
      for (const sql of alterStatements) {
        try {
          await connection.execute(sql);
        } catch (e) {
          // 忽略字段已存在错误
          if (!e.message.includes('Duplicate column')) {
            console.log('添加字段警告:', e.message);
          }
        }
      }
      console.log('测试报告表字段检查完成');
      
      // 创建项目表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS projects (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL,
          code VARCHAR(50) UNIQUE NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('项目表创建成功');
      
      // 创建用例库表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS case_libraries (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL,
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          module_count INT DEFAULT 0,
          config TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('用例库表创建成功');
      
      // 创建用例库用例关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS case_library_cases (
          id INT AUTO_INCREMENT PRIMARY KEY,
          library_id INT NOT NULL,
          case_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_library_case (library_id, case_id)
        )
      `);
      console.log('用例库用例关联表创建成功');
      
      // 创建测试用例表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_cases (
          id INT PRIMARY KEY AUTO_INCREMENT,
          case_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          priority VARCHAR(20) NOT NULL,
          type VARCHAR(50) NOT NULL,
          precondition TEXT,
          purpose TEXT,
          steps TEXT NOT NULL,
          expected TEXT NOT NULL,
          creator VARCHAR(50) NOT NULL,
          library_id INT,
          module_id INT NOT NULL,
          level1_id INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试用例表创建成功');
      
      // 确保测试用例表有level1_id字段
      try {
        // 使用字符串拼接，因为MySQL 4.1.22不支持预处理语句中的问号占位符用于SHOW COLUMNS
        const [columns] = await connection.execute(
          "SHOW COLUMNS FROM test_cases LIKE 'level1_id'"
        );
        
        if (columns.length === 0) {
          // 字段不存在，添加level1_id字段
          await connection.execute('ALTER TABLE test_cases ADD COLUMN level1_id INT');
          console.log('测试用例表level1_id字段添加成功');
        } else {
          console.log('测试用例表level1_id字段已存在');
        }
      } catch (error) {
        console.error('检查或添加测试用例表level1_id字段错误:', error);
        // 忽略错误，继续执行
      }
      
      // 确保测试用例表有owner字段
      try {
        // 使用字符串拼接，因为MySQL 4.1.22不支持预处理语句中的问号占位符用于SHOW COLUMNS
        const [columns] = await connection.execute(
          "SHOW COLUMNS FROM test_cases LIKE 'owner'"
        );
        
        if (columns.length === 0) {
          // 字段不存在，添加owner字段
          await connection.execute('ALTER TABLE test_cases ADD COLUMN owner VARCHAR(50) NOT NULL DEFAULT "admin"');
          console.log('测试用例表owner字段添加成功');
        } else {
          console.log('测试用例表owner字段已存在');
        }
      } catch (error) {
        console.error('检查或添加测试用例表owner字段错误:', error);
        // 忽略错误，继续执行
      }
      
      // 确保测试用例表有remark字段
      try {
        // 使用字符串拼接，因为MySQL 4.1.22不支持预处理语句中的问号占位符用于SHOW COLUMNS
        const [columns] = await connection.execute(
          "SHOW COLUMNS FROM test_cases LIKE 'remark'"
        );
        
        if (columns.length === 0) {
          // 字段不存在，添加remark字段
          await connection.execute('ALTER TABLE test_cases ADD COLUMN remark TEXT');
          console.log('测试用例表remark字段添加成功');
        } else {
          console.log('测试用例表remark字段已存在');
        }
      } catch (error) {
        console.error('检查或添加测试用例表remark字段错误:', error);
        // 忽略错误，继续执行
      }
      
      // 确保测试用例表有key_config字段
      try {
        const [columns] = await connection.execute(
          "SHOW COLUMNS FROM test_cases LIKE 'key_config'"
        );
        
        if (columns.length === 0) {
          await connection.execute('ALTER TABLE test_cases ADD COLUMN key_config TEXT');
          console.log('测试用例表key_config字段添加成功');
        } else {
          console.log('测试用例表key_config字段已存在');
        }
      } catch (error) {
        console.error('检查或添加测试用例表key_config字段错误:', error);
      }
      
      // 确保测试用例表有method字段（测试方式）
      try {
        const [columns] = await connection.execute(
          "SHOW COLUMNS FROM test_cases LIKE 'method'"
        );
        
        if (columns.length === 0) {
          await connection.execute('ALTER TABLE test_cases ADD COLUMN method VARCHAR(50) DEFAULT "自动化"');
          console.log('测试用例表method字段添加成功');
        } else {
          console.log('测试用例表method字段已存在');
        }
      } catch (error) {
        console.error('检查或添加测试用例表method字段错误:', error);
      }
      
      // 确保测试用例表有status字段（测试状态）
      try {
        const [columns] = await connection.execute(
          "SHOW COLUMNS FROM test_cases LIKE 'status'"
        );
        
        if (columns.length === 0) {
          await connection.execute('ALTER TABLE test_cases ADD COLUMN status VARCHAR(50) DEFAULT "维护中"');
          console.log('测试用例表status字段添加成功');
        } else {
          console.log('测试用例表status字段已存在');
        }
      } catch (error) {
        console.error('检查或添加测试用例表status字段错误:', error);
      }
      
      // 确保 test_cases 表有 is_deleted 软删除字段
      try {
        const [columns] = await connection.execute(
          "SHOW COLUMNS FROM test_cases LIKE 'is_deleted'"
        );
        
        if (columns.length === 0) {
          await connection.execute('ALTER TABLE test_cases ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 COMMENT \'软删除标记\'');
          await connection.execute('ALTER TABLE test_cases ADD COLUMN deleted_at TIMESTAMP NULL COMMENT \'删除时间\'');
          console.log('测试用例表软删除字段添加成功');
        } else {
          console.log('测试用例表软删除字段已存在');
        }
      } catch (error) {
        console.error('检查或添加测试用例表软删除字段错误:', error);
      }
      
      // ==================== 先创建配置表（被其他表外键引用） ====================
      
      // 创建测试进度表（test_case_projects 外键依赖）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_progresses (
          id INT PRIMARY KEY AUTO_INCREMENT,
          progress_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          status_category VARCHAR(50) DEFAULT 'not_started' COMMENT '进度分类: not_started, in_progress, completed',
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试进度表创建成功');
      
      // 确保test_progresses表有status_category字段
      try {
        const [progressColumns] = await connection.execute("SHOW COLUMNS FROM test_progresses LIKE 'status_category'");
        if (progressColumns.length === 0) {
          await connection.execute("ALTER TABLE test_progresses ADD COLUMN status_category VARCHAR(50) DEFAULT 'not_started' COMMENT '进度分类: not_started, in_progress, completed'");
          console.log('test_progresses表status_category字段添加成功');
        }
      } catch (error) {
        console.log('检查test_progresses表status_category字段:', error.message);
      }
      
      // 创建测试状态表（test_case_projects 外键依赖）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_statuses (
          id INT PRIMARY KEY AUTO_INCREMENT,
          status_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          status_category VARCHAR(50) DEFAULT 'pending' COMMENT '状态分类: passed, failed, pending, blocked',
          sort_order INT DEFAULT 0 COMMENT '排序顺序',
          is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用',
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试状态表创建成功');
      
      // 确保test_statuses表有必要字段
      try {
        const [statusColumns] = await connection.execute("SHOW COLUMNS FROM test_statuses");
        const columnNames = statusColumns.map(c => c.Field);
        
        if (!columnNames.includes('status_category')) {
          await connection.execute("ALTER TABLE test_statuses ADD COLUMN status_category VARCHAR(50) DEFAULT 'pending' COMMENT '状态分类: passed, failed, pending, blocked'");
          console.log('test_statuses表status_category字段添加成功');
        }
        if (!columnNames.includes('sort_order')) {
          await connection.execute("ALTER TABLE test_statuses ADD COLUMN sort_order INT DEFAULT 0 COMMENT '排序顺序'");
          console.log('test_statuses表sort_order字段添加成功');
        }
        if (!columnNames.includes('is_active')) {
          await connection.execute("ALTER TABLE test_statuses ADD COLUMN is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用'");
          console.log('test_statuses表is_active字段添加成功');
        }
      } catch (error) {
        console.log('检查test_statuses表字段:', error.message);
      }
      
      // 创建测试用例项目关联表（现在可以安全创建，因为外键依赖的表已存在）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_case_projects (
          id INT PRIMARY KEY AUTO_INCREMENT,
          test_case_id INT NOT NULL,
          project_id INT NOT NULL,
          owner VARCHAR(50) DEFAULT '',
          progress_id INT,
          status_id INT,
          remark VARCHAR(128),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_test_case_project (test_case_id, project_id),
          FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (progress_id) REFERENCES test_progresses(id) ON DELETE SET NULL,
          FOREIGN KEY (status_id) REFERENCES test_statuses(id) ON DELETE SET NULL
        )
      `);
      console.log('测试用例项目关联表创建成功');
      
      // 确保test_case_projects表包含所有必要字段
      await initTestCaseProjectsTable();
      
      // 创建环境表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS environments (
          id INT PRIMARY KEY AUTO_INCREMENT,
          env_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('环境表创建成功');
      
      // 创建测试方式表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_methods (
          id INT PRIMARY KEY AUTO_INCREMENT,
          method_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试方式表创建成功');
      
      // 插入默认测试方式数据
      await connection.execute(`
        INSERT IGNORE INTO test_methods (method_id, name, description, creator) VALUES
        ('METHOD_001', '手动测试', '通过人工操作进行测试', 'admin'),
        ('METHOD_002', '自动化测试', '通过自动化脚本进行测试', 'admin')
      `);
      console.log('默认测试方式数据插入成功');
      
      // 插入默认环境数据
      await connection.execute(`
        INSERT IGNORE INTO environments (env_id, name, description, creator) VALUES
        ('ENV_001', '开发环境', '开发人员使用的环境', 'admin'),
        ('ENV_002', '测试环境', '测试人员使用的环境', 'admin'),
        ('ENV_003', '生产环境', '最终用户使用的环境', 'admin')
      `);
      console.log('默认环境数据插入成功');
      
      // 创建测试类型表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_types (
          id INT PRIMARY KEY AUTO_INCREMENT,
          type_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试类型表创建成功');
      
      // 创建测试阶段表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_phases (
          id INT PRIMARY KEY AUTO_INCREMENT,
          phase_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试阶段表创建成功');
      
      // 创建测试软件表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_softwares (
          id INT PRIMARY KEY AUTO_INCREMENT,
          software_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试软件表创建成功');
      
      // 插入默认测试软件数据
      await connection.execute(`
        INSERT IGNORE INTO test_softwares (software_id, name, description, creator) VALUES
        ('SOFTWARE_001', 'CTCSDK', 'Centec SDK测试软件', 'admin'),
        ('SOFTWARE_002', 'Cmodel', '芯片仿真模型测试', 'admin'),
        ('SOFTWARE_003', 'SAI', 'Switch Abstraction Interface测试', 'admin'),
        ('SOFTWARE_004', 'ECPU', '嵌入式CPU测试', 'admin')
      `);
      console.log('默认测试软件数据插入成功');
      
      // 创建优先级表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_priorities (
          id INT PRIMARY KEY AUTO_INCREMENT,
          priority_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('优先级表创建成功');
      
      // 插入默认优先级数据
      const [existingPriorities] = await connection.execute('SELECT COUNT(*) as count FROM test_priorities');
      if (existingPriorities[0].count === 0) {
        await connection.execute(`
          INSERT INTO test_priorities (priority_id, name, description, creator) VALUES
          ('PRIORITY_001', 'P0', '阻塞级 - 必须立即修复', 'admin'),
          ('PRIORITY_002', 'P1', '严重级 - 尽快修复', 'admin'),
          ('PRIORITY_003', 'P2', '一般级 - 计划修复', 'admin'),
          ('PRIORITY_004', 'P3', '提示级 - 可选修复', 'admin')
        `);
        console.log('默认优先级数据插入成功');
      }
      
      // 创建AI配置表（全局设置）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS ai_config (
          id INT PRIMARY KEY AUTO_INCREMENT,
          config_key VARCHAR(100) UNIQUE NOT NULL,
          config_value TEXT,
          description VARCHAR(255),
          updated_by VARCHAR(50),
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('AI配置表创建成功');
      
      // 创建AI模型表（支持多个模型配置）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS ai_models (
          id INT PRIMARY KEY AUTO_INCREMENT,
          model_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          provider VARCHAR(50) NOT NULL,
          api_key TEXT NOT NULL,
          endpoint VARCHAR(500) NOT NULL,
          model_name VARCHAR(100) NOT NULL,
          is_default BOOLEAN DEFAULT FALSE,
          is_enabled BOOLEAN DEFAULT TRUE,
          description TEXT,
          user_id INT COMMENT '用户ID',
          created_by VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('AI模型表创建成功');
      
      // 确保ai_models表有user_id字段
      try {
        const [modelColumns] = await connection.execute("SHOW COLUMNS FROM ai_models LIKE 'user_id'");
        if (modelColumns.length === 0) {
          await connection.execute("ALTER TABLE ai_models ADD COLUMN user_id INT COMMENT '用户ID'");
          console.log('ai_models表user_id字段添加成功');
        }
      } catch (error) {
        console.log('检查ai_models表user_id字段:', error.message);
      }
      
      // 创建AI技能表（动态技能库）
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS ai_skills (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100) UNIQUE NOT NULL COMMENT '技能标识名，如 analyze_pass_rate',
          display_name VARCHAR(200) COMMENT '技能显示名称',
          description TEXT COMMENT '技能描述',
          definition JSON COMMENT 'LLM Tool Schema 定义',
          execute_code TEXT COMMENT 'Node.js 可执行的 JS 脚本',
          category VARCHAR(50) DEFAULT 'general' COMMENT '技能分类',
          is_enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用',
          is_public BOOLEAN DEFAULT TRUE COMMENT '是否公开',
          is_system BOOLEAN DEFAULT FALSE COMMENT '是否系统内置',
          creator_id INT COMMENT '创建者ID',
          updater_id INT COMMENT '更新者ID',
          created_by VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_name (name),
          INDEX idx_enabled (is_enabled),
          INDEX idx_category (category),
          INDEX idx_creator_id (creator_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('AI技能表创建成功');
      
      // 确保ai_skills表有必要字段
      try {
        const [skillColumns] = await connection.execute("SHOW COLUMNS FROM ai_skills");
        const columnNames = skillColumns.map(c => c.Field);
        
        if (!columnNames.includes('is_public')) {
          await connection.execute("ALTER TABLE ai_skills ADD COLUMN is_public BOOLEAN DEFAULT TRUE COMMENT '是否公开'");
          console.log('ai_skills表is_public字段添加成功');
        }
        if (!columnNames.includes('creator_id')) {
          await connection.execute("ALTER TABLE ai_skills ADD COLUMN creator_id INT COMMENT '创建者ID'");
          console.log('ai_skills表creator_id字段添加成功');
        }
        if (!columnNames.includes('updater_id')) {
          await connection.execute("ALTER TABLE ai_skills ADD COLUMN updater_id INT COMMENT '更新者ID'");
          console.log('ai_skills表updater_id字段添加成功');
        }
      } catch (error) {
        console.log('检查ai_skills表字段:', error.message);
      }
      
      // 创建用户技能设置表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS user_skill_settings (
          id INT PRIMARY KEY AUTO_INCREMENT,
          user_id INT NOT NULL COMMENT '用户ID',
          skill_id INT NOT NULL COMMENT '技能ID',
          is_enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_skill (user_id, skill_id),
          INDEX idx_user_id (user_id),
          INDEX idx_skill_id (skill_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('用户技能设置表创建成功');
      
      // 创建报告模板表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS report_templates (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(200) NOT NULL COMMENT '模板名称',
          description TEXT COMMENT '模板描述',
          file_path VARCHAR(500) NOT NULL COMMENT '文件存储路径',
          file_type VARCHAR(20) DEFAULT 'md' COMMENT '文件类型：md/txt',
          is_default BOOLEAN DEFAULT FALSE COMMENT '是否默认模板',
          created_by VARCHAR(50) COMMENT '创建者',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_by VARCHAR(50) COMMENT '最后编辑者',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后编辑时间',
          INDEX idx_name (name),
          INDEX idx_default (is_default)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('报告模板表创建成功');
      
      // 创建超链接配置表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS hyperlink_configs (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL COMMENT '配置名称',
          prefix VARCHAR(500) NOT NULL COMMENT '链接前缀',
          description TEXT COMMENT '描述',
          sort_order INT DEFAULT 0 COMMENT '排序顺序',
          is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('超链接配置表创建成功');
      
      // ==================== 论坛模块表 ====================
      
      // 创建论坛帖子表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS forum_posts (
          id INT PRIMARY KEY AUTO_INCREMENT COMMENT '帖子ID',
          post_id VARCHAR(50) NOT NULL UNIQUE COMMENT '帖子唯一标识',
          author_id INT NOT NULL COMMENT '作者ID',
          title VARCHAR(200) NOT NULL COMMENT '帖子标题',
          content LONGTEXT NOT NULL COMMENT '帖子内容',
          content_html LONGTEXT COMMENT '帖子内容HTML渲染结果',
          view_count INT DEFAULT 0 COMMENT '浏览次数',
          comment_count INT DEFAULT 0 COMMENT '评论数量',
          like_count INT DEFAULT 0 COMMENT '点赞数量',
          is_pinned TINYINT(1) DEFAULT 0 COMMENT '是否置顶',
          is_locked TINYINT(1) DEFAULT 0 COMMENT '是否锁定',
          is_anonymous TINYINT(1) DEFAULT 0 COMMENT '是否匿名',
          status ENUM('normal', 'hidden', 'deleted') DEFAULT 'normal' COMMENT '帖子状态',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          INDEX idx_author_id (author_id),
          INDEX idx_status (status),
          INDEX idx_is_pinned (is_pinned),
          INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('论坛帖子表创建成功');
      
      // 创建论坛评论表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS forum_comments (
          id INT PRIMARY KEY AUTO_INCREMENT COMMENT '评论ID',
          comment_id VARCHAR(50) NOT NULL UNIQUE COMMENT '评论唯一标识',
          post_id INT NOT NULL COMMENT '帖子ID',
          author_id INT NOT NULL COMMENT '评论者ID',
          parent_id INT DEFAULT NULL COMMENT '父评论ID',
          reply_to_id INT DEFAULT NULL COMMENT '回复的评论ID',
          content TEXT NOT NULL COMMENT '评论内容',
          content_html TEXT COMMENT '评论内容HTML渲染结果',
          like_count INT DEFAULT 0 COMMENT '点赞数量',
          is_anonymous TINYINT(1) DEFAULT 0 COMMENT '是否匿名',
          status ENUM('normal', 'hidden', 'deleted') DEFAULT 'normal' COMMENT '评论状态',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          INDEX idx_post_id (post_id),
          INDEX idx_author_id (author_id),
          INDEX idx_parent_id (parent_id),
          INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('论坛评论表创建成功');
      
      // 创建论坛标签表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS forum_tags (
          id INT PRIMARY KEY AUTO_INCREMENT COMMENT '标签ID',
          name VARCHAR(50) NOT NULL UNIQUE COMMENT '标签名称',
          color VARCHAR(20) DEFAULT '#3498db' COMMENT '标签颜色',
          post_count INT DEFAULT 0 COMMENT '关联帖子数量',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('论坛标签表创建成功');
      
      // 创建帖子标签关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS forum_post_tags (
          id INT PRIMARY KEY AUTO_INCREMENT,
          post_id INT NOT NULL COMMENT '帖子ID',
          tag_id INT NOT NULL COMMENT '标签ID',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_post_tag (post_id, tag_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('帖子标签关联表创建成功');
      
      // 创建用户点赞表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS forum_likes (
          id INT PRIMARY KEY AUTO_INCREMENT,
          user_id INT NOT NULL COMMENT '用户ID',
          target_type ENUM('post', 'comment') NOT NULL COMMENT '点赞目标类型',
          target_id INT NOT NULL COMMENT '目标ID',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_target (user_id, target_type, target_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('用户点赞表创建成功');
      
      // 插入默认论坛标签
      const [tagCount] = await connection.execute('SELECT COUNT(*) as count FROM forum_tags');
      if (tagCount[0].count === 0) {
        await connection.execute(`
          INSERT INTO forum_tags (name, color) VALUES 
          ('经验分享', '#27ae60'),
          ('问题求助', '#e74c3c'),
          ('测试工具', '#3498db'),
          ('自动化测试', '#9b59b6'),
          ('性能测试', '#f39c12'),
          ('接口测试', '#1abc9c'),
          ('其他', '#95a5a6')
        `);
        console.log('默认论坛标签插入成功');
      }
      
      // 检查并添加 updated_by 字段（如果表已存在但没有该字段）
      try {
        const [templateColumns] = await connection.execute('SHOW COLUMNS FROM report_templates LIKE "updated_by"');
        if (templateColumns.length === 0) {
          await connection.execute('ALTER TABLE report_templates ADD COLUMN updated_by VARCHAR(50) COMMENT "最后编辑者" AFTER updated_at');
          console.log('报告模板表添加 updated_by 字段成功');
        }
      } catch (alterError) {
        console.log('检查/添加 updated_by 字段:', alterError.message);
      }
      
      // 插入默认报告模板示例
      const [templateCount] = await connection.execute('SELECT COUNT(*) as count FROM report_templates');
      if (templateCount[0].count === 0) {
        // 创建默认模板文件
        const defaultTemplatePath = path.join(process.cwd(), 'templates', 'project_report.md');
        const defaultTemplateContent = `# {{项目名称}} 测试报告

> **报告生成时间**: {{生成时间}}
> **报告生成人**: {{生成人}}

---

## 📊 一、测试概览

| 指标 | 数值 |
|------|------|
| **项目名称** | {{项目名称}} |
| **测试计划数量** | {{测试计划数量}} |
| **总用例数** | {{总用例数}} |
| **已执行用例** | {{已执行用例}} |
| **通过用例** | {{通过用例}} |
| **失败用例** | {{失败用例}} |
| **通过率** | {{通过率}} |

---

## ⚠️ 二、风险项分析

{{风险项列表}}

---

## 💡 三、改进建议

{{改进建议}}

---

*本报告由 xTest AI 自动生成*
`;
        
        // 确保模板目录存在
        const fs = require('fs');
        const templatesDir = path.join(process.cwd(), 'templates');
        if (!fs.existsSync(templatesDir)) {
          fs.mkdirSync(templatesDir, { recursive: true });
        }
        
        // 写入默认模板文件
        fs.writeFileSync(defaultTemplatePath, defaultTemplateContent);
        
        // 插入数据库记录
        await connection.execute(
          'INSERT INTO report_templates (name, description, file_path, file_type, is_default, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          ['默认测试报告模板', 'xTest 默认测试报告模板，包含测试概览、风险分析和改进建议', defaultTemplatePath, 'md', true, 'system']
        );
        console.log('默认报告模板插入成功');
      }
      
      // 插入默认AI技能示例
      const [skillCount] = await connection.execute('SELECT COUNT(*) as count FROM ai_skills');
      if (skillCount[0].count === 0) {
        // 技能1：查询测试统计
        const skill1Def = JSON.stringify({
          type: "function",
          function: {
            name: "query_test_statistics",
            description: "查询指定项目的测试统计数据，返回用例总数、通过率等信息",
            parameters: {
              type: "object",
              properties: {
                project_id: { type: "string", description: "项目ID" }
              },
              required: ["project_id"]
            }
          }
        });
        const skill1Code = `const [rows] = await dbPool.execute("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'Pass' THEN 1 ELSE 0 END) as passed FROM test_cases tc JOIN test_case_projects tcp ON tc.id = tcp.test_case_id WHERE tcp.project_id = ?", [args.project_id]); const result = rows[0]; return { total: result.total, passed: result.passed, passRate: result.total > 0 ? ((result.passed / result.total) * 100).toFixed(2) + "%" : "0%" };`;
        
        // 技能2：查询用户任务
        const skill2Def = JSON.stringify({
          type: "function",
          function: {
            name: "query_user_tasks",
            description: "查询指定用户负责的测试任务，返回任务列表",
            parameters: {
              type: "object",
              properties: {
                username: { type: "string", description: "用户名" }
              },
              required: ["username"]
            }
          }
        });
        const skill2Code = `const [rows] = await dbPool.execute("SELECT tp.id, tp.name, tp.status, tp.pass_rate FROM test_plans tp WHERE tp.owner = ? ORDER BY tp.created_at DESC LIMIT 10", [args.username]); return rows;`;
        
        // 技能3：分析模块覆盖
        const skill3Def = JSON.stringify({
          type: "function",
          function: {
            name: "analyze_module_coverage",
            description: "分析指定模块的测试覆盖情况",
            parameters: {
              type: "object",
              properties: {
                module_name: { type: "string", description: "模块名称（支持模糊匹配）" }
              },
              required: ["module_name"]
            }
          }
        });
        const skill3Code = `const [modules] = await dbPool.execute("SELECT id, name FROM modules WHERE name LIKE ?", ["%" + args.module_name + "%"]); if (modules.length === 0) return { error: "未找到匹配的模块" }; const results = []; for (const mod of modules) { const [level1] = await dbPool.execute("SELECT COUNT(*) as count FROM level1_points WHERE module_id = ?", [mod.id]); const [cases] = await dbPool.execute("SELECT COUNT(*) as count FROM test_cases tc JOIN level1_points l1 ON tc.level1_id = l1.id WHERE l1.module_id = ?", [mod.id]); results.push({ moduleName: mod.name, level1Count: level1[0].count, caseCount: cases[0].count }); } return results;`;
        
        // 技能4：基于模板生成测试报告（动态读取模板）
        const skill4Def = JSON.stringify({
          type: "function",
          function: {
            name: "generate_test_report",
            description: "根据项目数据生成专业的测试报告，支持指定模板",
            parameters: {
              type: "object",
              properties: {
                project_name: { type: "string", description: "项目名称（支持模糊匹配）" },
                template_id: { type: "string", description: "模板ID（可选，不指定则使用默认模板）" },
                report_type: { type: "string", description: "报告类型：summary（概要）或 detailed（详细）", enum: ["summary", "detailed"] }
              },
              required: ["project_name"]
            }
          }
        });
        const skill4Code = `const fs = require('fs'); const path = require('path'); const projectName = args.project_name; const templateId = args.template_id; const reportType = args.report_type || 'summary'; const [projects] = await dbPool.execute("SELECT id, name, code FROM projects WHERE name LIKE ?", ["%" + projectName + "%"]); if (projects.length === 0) return { error: "未找到匹配的项目: " + projectName }; const project = projects[0]; const [testPlans] = await dbPool.execute("SELECT id, name, status, pass_rate, total_cases, tested_cases, owner, created_at FROM test_plans WHERE project = ? ORDER BY created_at DESC", [project.name]); let totalCases = 0, testedCases = 0, passedCases = 0, failedCases = 0, blockedCases = 0; const planDetails = []; for (const plan of testPlans) { const [planCases] = await dbPool.execute("SELECT status, COUNT(*) as count FROM test_plan_cases WHERE plan_id = ? GROUP BY status", [plan.id]); let planPassed = 0, planFailed = 0, planBlocked = 0, planPending = 0; for (const pc of planCases) { if (pc.status === 'Pass') planPassed = pc.count; else if (pc.status === 'Fail') planFailed = pc.count; else if (pc.status === 'Block') planBlocked = pc.count; else planPending = pc.count; } const planTotal = planPassed + planFailed + planBlocked + planPending; totalCases += planTotal; testedCases += (planPassed + planFailed + planBlocked); passedCases += planPassed; failedCases += planFailed; blockedCases += planBlocked; planDetails.push({ name: plan.name, status: plan.status, total: planTotal, passed: planPassed, failed: planFailed, blocked: planBlocked, passRate: planTotal > 0 ? ((planPassed / (planPassed + planFailed + planBlocked)) * 100).toFixed(1) : 0 }); } const passRate = testedCases > 0 ? ((passedCases / testedCases) * 100).toFixed(1) : 0; const progress = totalCases > 0 ? ((testedCases / totalCases) * 100).toFixed(1) : 0; let template = ''; let templateName = '默认模板'; try { let templateQuery = 'SELECT file_path, name FROM report_templates WHERE is_default = TRUE LIMIT 1'; let queryParams = []; if (templateId) { templateQuery = 'SELECT file_path, name FROM report_templates WHERE id = ?'; queryParams = [templateId]; } const [templates] = await dbPool.execute(templateQuery, queryParams); if (templates.length > 0 && fs.existsSync(templates[0].file_path)) { template = fs.readFileSync(templates[0].file_path, 'utf8'); templateName = templates[0].name; } else { template = '# {{项目名称}} 测试报告\\n\\n## 测试概览\\n- 项目名称: {{项目名称}}\\n- 总用例数: {{总用例数}}\\n- 通过率: {{通过率}}\\n\\n## 详细数据\\n{{详细数据}}\\n\\n---\\n*本报告由 xTest AI 自动生成*'; } } catch (e) { template = '# {{项目名称}} 测试报告\\n\\n## 测试概览\\n- 项目名称: {{项目名称}}\\n- 总用例数: {{总用例数}}\\n- 通过率: {{通过率}}\\n\\n## 详细数据\\n{{详细数据}}\\n\\n---\\n*本报告由 xTest AI 自动生成*'; } return { type: 'report_generation', project: { id: project.id, name: project.name, code: project.code }, statistics: { totalCases, testedCases, passedCases, failedCases, blockedCases, pendingCases: totalCases - testedCases, passRate: passRate + '%', progress: progress + '%' }, testPlans: planDetails, template: template, templateName: templateName, instructions: "请根据以上数据，严格按照模板格式生成一份专业的测试报告。要求：1. 用专业自然的语言填充模板中的占位符；2. 表格数据要准确；3. 风险项要具体分析；4. 改进建议要切实可行。" };`;
        
        await connection.execute(
          `INSERT INTO ai_skills (name, display_name, description, definition, execute_code, category, is_enabled, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            'query_test_statistics', '查询测试统计', '查询指定项目的测试用例统计数据，包括总数、通过率等', skill1Def, skill1Code, 'statistics', true, true,
            'query_user_tasks', '查询用户任务', '查询指定用户负责的测试任务列表', skill2Def, skill2Code, 'task', true, true,
            'analyze_module_coverage', '分析模块覆盖', '分析指定模块的测试用例覆盖情况', skill3Def, skill3Code, 'analysis', true, true,
            'generate_test_report', '生成测试报告', '根据项目数据生成专业的测试报告，支持概要和详细两种模式', skill4Def, skill4Code, 'report', true, true
          ]
        );
        console.log('默认AI技能示例插入成功');
      }
      
      // 插入默认AI配置
      const [aiConfigCount] = await connection.execute('SELECT COUNT(*) as count FROM ai_config');
      if (aiConfigCount[0].count === 0) {
        await connection.execute(`
          INSERT INTO ai_config (config_key, config_value, description) VALUES
          ('ai_enabled', 'true', '是否启用AI功能'),
          ('default_model_id', '', '默认AI模型ID')
        `);
        console.log('默认AI配置插入成功');
      }
      
      // 插入默认AI模型配置
      const [aiModelsCount] = await connection.execute('SELECT COUNT(*) as count FROM ai_models');
      if (aiModelsCount[0].count === 0) {
        await connection.execute(`
          INSERT INTO ai_models (model_id, name, provider, api_key, endpoint, model_name, is_default, is_enabled, description, created_by) VALUES
          ('deepseek-default', 'DeepSeek', 'deepseek', '', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat', TRUE, TRUE, 'DeepSeek大模型', 'admin'),
          ('openai-default', 'OpenAI', 'openai', '', 'https://api.openai.com/v1/chat/completions', 'gpt-3.5-turbo', FALSE, TRUE, 'OpenAI大模型', 'admin'),
          ('zhipu-default', '智谱AI', 'zhipu', '', 'https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-4', FALSE, TRUE, '智谱AI大模型', 'admin')
        `);
        console.log('默认AI模型配置插入成功');
      }
      
      // 创建测试用例环境关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_case_environments (
          id INT PRIMARY KEY AUTO_INCREMENT,
          test_case_id INT NOT NULL,
          environment_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
          UNIQUE KEY unique_test_case_environment (test_case_id, environment_id)
        )
      `);
      console.log('测试用例环境关联表创建成功');
      
      // 创建测试用例测试方式关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_case_methods (
          id INT PRIMARY KEY AUTO_INCREMENT,
          test_case_id INT NOT NULL,
          method_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (method_id) REFERENCES test_methods(id) ON DELETE CASCADE,
          UNIQUE KEY unique_test_case_method (test_case_id, method_id)
        )
      `);
      console.log('测试用例测试方式关联表创建成功');
      
      // 创建测试点来源表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_sources (
          id INT PRIMARY KEY AUTO_INCREMENT,
          source_id VARCHAR(50) UNIQUE NOT NULL,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          creator VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('测试点来源表创建成功');
      
      // 插入默认测试点来源数据
      await connection.execute(`
        INSERT IGNORE INTO test_sources (source_id, name, description, creator) VALUES
        ('SOURCE_001', 'PRD', '产品需求文档', 'admin'),
        ('SOURCE_002', '客户需求', '客户提出的需求', 'admin'),
        ('SOURCE_003', '功能特性', '功能特性测试', 'admin'),
        ('SOURCE_004', '缺陷回归', '缺陷修复后的回归测试', 'admin'),
        ('SOURCE_005', '技术方案', '技术方案相关测试', 'admin')
      `);
      console.log('默认测试点来源数据插入成功');
      
      // 创建测试用例测试点来源关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_case_sources (
          id INT PRIMARY KEY AUTO_INCREMENT,
          test_case_id INT NOT NULL,
          source_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (source_id) REFERENCES test_sources(id) ON DELETE CASCADE,
          UNIQUE KEY unique_test_case_source (test_case_id, source_id)
        )
      `);
      console.log('测试用例测试点来源关联表创建成功');
      
      // 创建测试用例测试类型关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_case_test_types (
          id INT PRIMARY KEY AUTO_INCREMENT,
          test_case_id INT NOT NULL,
          test_type_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (test_type_id) REFERENCES test_types(id) ON DELETE CASCADE,
          UNIQUE KEY unique_test_case_test_type (test_case_id, test_type_id)
        )
      `);
      console.log('测试用例测试类型关联表创建成功');
      
      // 创建测试用例测试状态关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_case_statuses (
          id INT PRIMARY KEY AUTO_INCREMENT,
          test_case_id INT NOT NULL,
          status_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (status_id) REFERENCES test_statuses(id) ON DELETE CASCADE,
          UNIQUE KEY unique_test_case_status (test_case_id, status_id)
        )
      `);
      console.log('测试用例测试状态关联表创建成功');
      
      // 创建测试用例测试阶段关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_case_phases (
          id INT PRIMARY KEY AUTO_INCREMENT,
          test_case_id INT NOT NULL,
          phase_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (phase_id) REFERENCES test_phases(id) ON DELETE CASCADE,
          UNIQUE KEY unique_test_case_phase (test_case_id, phase_id)
        )
      `);
      console.log('测试用例测试阶段关联表创建成功');
      
      // 创建测试用例测试进度关联表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_case_progresses (
          id INT PRIMARY KEY AUTO_INCREMENT,
          test_case_id INT NOT NULL,
          progress_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          FOREIGN KEY (progress_id) REFERENCES test_progresses(id) ON DELETE CASCADE,
          UNIQUE KEY unique_test_case_progress (test_case_id, progress_id)
        )
      `);
      console.log('测试用例测试进度关联表创建成功');
      
      // 检查是否有管理员用户
      const [users] = await connection.execute('SELECT * FROM users WHERE role = ?', ['管理员']);
      if (users.length === 0) {
        // 创建默认管理员用户
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('ctc@2026.', 10);
        await connection.execute(
          'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)',
          ['admin', hashedPassword, '管理员', 'admin@example.com']
        );
        console.log('默认管理员用户创建成功');
      }
      
      // 检查是否有测试人员用户
      const [testers] = await connection.execute('SELECT * FROM users WHERE role = ?', ['测试人员']);
      if (testers.length === 0) {
        // 创建默认测试人员用户
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('tester123', 10);
        await connection.execute(
          'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)',
          ['tester1', hashedPassword, '测试人员', 'tester1@example.com']
        );
        console.log('默认测试人员用户创建成功');
      }
      
      // 检查是否有默认模块
      const [modules] = await connection.execute('SELECT * FROM modules');
      if (modules.length === 0) {
        // 创建默认模块
        await connection.execute('INSERT INTO modules (module_id, name) VALUES (?, ?)', ['module1', '模块1']);
        await connection.execute('INSERT INTO modules (module_id, name) VALUES (?, ?)', ['module2', '模块2']);
        await connection.execute('INSERT INTO modules (module_id, name) VALUES (?, ?)', ['module3', '模块3']);
        console.log('默认模块创建成功');
      }
      
      // 检查是否有默认芯片
      const [chips] = await connection.execute('SELECT * FROM chips');
      if (chips.length === 0) {
        // 创建默认芯片
        await connection.execute('INSERT INTO chips (chip_id, name, description) VALUES (?, ?, ?)', ['chip1', '芯片1', '默认测试芯片1']);
        await connection.execute('INSERT INTO chips (chip_id, name, description) VALUES (?, ?, ?)', ['chip2', '芯片2', '默认测试芯片2']);
        await connection.execute('INSERT INTO chips (chip_id, name, description) VALUES (?, ?, ?)', ['chip3', '芯片3', '默认测试芯片3']);
        console.log('默认芯片创建成功');
      }
      
      // ==================== 测试计划管理相关表 ====================
      
      // 确保test_plans表有stage_id和software_id字段
      try {
        await connection.execute(`ALTER TABLE test_plans ADD COLUMN stage_id INT COMMENT '测试阶段ID'`);
      } catch (error) {
        console.log('test_plans.stage_id字段已存在');
      }
      
      try {
        await connection.execute(`ALTER TABLE test_plans ADD COLUMN software_id INT COMMENT '测试软件ID'`);
      } catch (error) {
        console.log('test_plans.software_id字段已存在');
      }
      
      // 添加实际开始时间和实际完成时间字段
      try {
        await connection.execute(`ALTER TABLE test_plans ADD COLUMN actual_start_time DATETIME COMMENT '实际开始时间'`);
      } catch (error) {
        console.log('test_plans.actual_start_time字段已存在');
      }
      
      try {
        await connection.execute(`ALTER TABLE test_plans ADD COLUMN actual_end_time DATETIME COMMENT '实际完成时间'`);
      } catch (error) {
        console.log('test_plans.actual_end_time字段已存在');
      }
      
      console.log('测试计划表字段更新成功');
      
      // 创建测试计划动态规则表 (test_plan_rules)
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_plan_rules (
          id INT PRIMARY KEY AUTO_INCREMENT,
          plan_id INT NOT NULL,
          rule_type VARCHAR(30) NOT NULL COMMENT '规则类型: PRIORITY, AUTOMATION等',
          rule_name VARCHAR(100) COMMENT '规则名称',
          rule_config JSON NOT NULL COMMENT '规则配置JSON',
          priority INT DEFAULT 0 COMMENT '规则优先级',
          enabled TINYINT(1) DEFAULT 1 COMMENT '是否启用',
          created_by VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (plan_id) REFERENCES test_plans(id) ON DELETE CASCADE
        )
      `);
      console.log('测试计划动态规则表创建成功');
      
      // 创建测试计划用例执行快照表 (test_plan_cases)
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_plan_cases (
          id INT PRIMARY KEY AUTO_INCREMENT,
          plan_id INT NOT NULL,
          case_id INT NOT NULL,
          test_point_id INT COMMENT '一级测试点ID',
          module_id INT COMMENT '模块ID',
          executor_id VARCHAR(50) COMMENT '执行者ID',
          status VARCHAR(30) NOT NULL DEFAULT 'pending' COMMENT '执行状态: Pass, Fail, Block, ASIC_Hang, Core_Dump, Traffic_Drop, pending',
          execution_time TIMESTAMP NULL COMMENT '执行时间',
          duration INT COMMENT '执行耗时(秒)',
          log_path VARCHAR(500) COMMENT '日志文件路径',
          error_message TEXT COMMENT '错误信息',
          retry_count INT DEFAULT 0 COMMENT '重试次数',
          pfc_specific TINYINT(1) DEFAULT 0 COMMENT '是否为PFC专属测试',
          buffer_test TINYINT(1) DEFAULT 0 COMMENT '是否为Buffer测试',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (plan_id) REFERENCES test_plans(id) ON DELETE CASCADE,
          FOREIGN KEY (case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
          UNIQUE KEY unique_plan_case (plan_id, case_id)
        )
      `);
      console.log('测试计划用例执行快照表创建成功');
      
      // 确保 test_plan_cases 表有 bug_id 字段
      try {
        const [columns] = await connection.execute(
          "SHOW COLUMNS FROM test_plan_cases LIKE 'bug_id'"
        );
        
        if (columns.length === 0) {
          await connection.execute('ALTER TABLE test_plan_cases ADD COLUMN bug_id VARCHAR(100) COMMENT \'关联的缺陷ID\' AFTER error_message');
          console.log('test_plan_cases 表 bug_id 字段添加成功');
        } else {
          console.log('test_plan_cases 表 bug_id 字段已存在');
        }
      } catch (error) {
        console.error('检查或添加 test_plan_cases 表 bug_id 字段错误:', error);
      }
      
      // 创建测试执行日志表 (test_execution_logs)
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_execution_logs (
          id INT PRIMARY KEY AUTO_INCREMENT,
          plan_case_id INT NOT NULL,
          log_type VARCHAR(20) NOT NULL COMMENT '日志类型: INFO, WARNING, ERROR, DEBUG',
          message TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          metadata JSON COMMENT '额外元数据',
          FOREIGN KEY (plan_case_id) REFERENCES test_plan_cases(id) ON DELETE CASCADE
        )
      `);
      console.log('测试执行日志表创建成功');
      
      // 创建测试用例执行记录表 (case_execution_records)
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS case_execution_records (
          id INT PRIMARY KEY AUTO_INCREMENT,
          case_id INT NOT NULL COMMENT '测试用例ID',
          record_type ENUM('defect', 'other') NOT NULL COMMENT '记录类型: defect-缺陷, other-其他',
          bug_id VARCHAR(100) COMMENT 'Bug ID',
          description TEXT COMMENT '详细描述',
          images JSON COMMENT '图片列表JSON数组',
          creator VARCHAR(50) NOT NULL COMMENT '创建人',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_case_id (case_id),
          INDEX idx_created_at (created_at)
        ) COMMENT='测试用例执行记录表'
      `);
      console.log('测试用例执行记录表创建成功');
      
      // 检查并添加images字段（如果表已存在但没有该字段）
      try {
        await connection.execute(`
          ALTER TABLE case_execution_records ADD COLUMN images JSON COMMENT '图片列表JSON数组'
        `);
        console.log('执行记录表添加images字段成功');
      } catch (alterError) {
        if (alterError.code !== 'ER_DUP_FIELDNAME') {
          console.log('images字段可能已存在，跳过添加');
        }
      }
      
      // 检查并添加bug_type字段（如果表已存在但没有该字段）
      try {
        await connection.execute(`
          ALTER TABLE case_execution_records ADD COLUMN bug_type VARCHAR(50) COMMENT 'Bug类型' AFTER bug_id
        `);
        console.log('执行记录表添加bug_type字段成功');
      } catch (alterError) {
        if (alterError.code !== 'ER_DUP_FIELDNAME') {
          console.log('bug_type字段可能已存在，跳过添加');
        }
      }
      
      // 创建邮件配置表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS email_config (
          id INT PRIMARY KEY AUTO_INCREMENT,
          config_name VARCHAR(100) NOT NULL COMMENT '配置名称',
          email_type ENUM('smtp', 'self_hosted') NOT NULL DEFAULT 'smtp' COMMENT '邮件类型: smtp-企业邮箱, self_hosted-自建服务器',
          
          -- SMTP配置
          smtp_host VARCHAR(255) COMMENT 'SMTP服务器地址',
          smtp_port INT DEFAULT 587 COMMENT 'SMTP端口',
          smtp_secure BOOLEAN DEFAULT FALSE COMMENT '是否使用SSL/TLS',
          smtp_user VARCHAR(255) COMMENT 'SMTP用户名',
          smtp_password VARCHAR(255) COMMENT 'SMTP密码(加密存储)',
          
          -- 发件人信息
          sender_email VARCHAR(255) COMMENT '发件人邮箱',
          sender_name VARCHAR(100) COMMENT '发件人名称',
          
          -- 自建服务器配置
          self_hosted_api_url VARCHAR(255) COMMENT '自建服务器API地址',
          self_hosted_api_key VARCHAR(255) COMMENT '自建服务器API密钥',
          
          -- 其他配置
          is_default BOOLEAN DEFAULT FALSE COMMENT '是否默认配置',
          is_enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用',
          daily_limit INT DEFAULT 500 COMMENT '每日发送限制',
          sent_today INT DEFAULT 0 COMMENT '今日已发送数量',
          last_sent_date DATE COMMENT '最后发送日期',
          
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          
          INDEX idx_is_default (is_default),
          INDEX idx_is_enabled (is_enabled)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('邮件配置表创建成功');
      
      // 创建邮件发送日志表
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS email_logs (
          id INT PRIMARY KEY AUTO_INCREMENT,
          config_id INT COMMENT '使用的配置ID',
          recipient_email VARCHAR(255) NOT NULL COMMENT '收件人邮箱',
          recipient_name VARCHAR(100) COMMENT '收件人名称',
          subject VARCHAR(500) NOT NULL COMMENT '邮件主题',
          email_type VARCHAR(50) COMMENT '邮件类型: verification, notification, report等',
          status ENUM('pending', 'sent', 'failed') DEFAULT 'pending' COMMENT '发送状态',
          error_message TEXT COMMENT '错误信息',
          sent_at TIMESTAMP NULL COMMENT '发送时间',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          
          FOREIGN KEY (config_id) REFERENCES email_config(id) ON DELETE SET NULL,
          INDEX idx_recipient_email (recipient_email),
          INDEX idx_status (status),
          INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('邮件日志表创建成功');

      // 创建站内通知表 (Notifications)
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INT PRIMARY KEY AUTO_INCREMENT,
          user_id INT NOT NULL COMMENT '接收通知的用户ID',
          sender_id INT COMMENT '触发通知的用户ID(可选)',
          type VARCHAR(50) NOT NULL COMMENT '通知类型: mention, comment, like, system',
          target_id INT NOT NULL COMMENT '关联的目标ID (通常为帖子 post_id 或者评论 comment_id)',
          title VARCHAR(255) DEFAULT '系统通知' COMMENT '通知标题',
          content TEXT COMMENT '通知完整内容',
          content_preview VARCHAR(255) COMMENT '通知内容预览摘要',
          data JSON COMMENT '额外数据(JSON格式)',
          is_read BOOLEAN DEFAULT FALSE COMMENT '是否已读',
          read_at TIMESTAMP NULL COMMENT '已读时间',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          
          INDEX idx_notifications_user_id (user_id),
          INDEX idx_notifications_is_read (is_read),
          INDEX idx_notifications_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('通知记录表创建成功');
      
      // 插入默认邮件配置模板
      const [existingConfigs] = await connection.execute('SELECT COUNT(*) as count FROM email_config');
      if (existingConfigs[0].count === 0) {
        await connection.execute(`
          INSERT INTO email_config (config_name, email_type, smtp_host, smtp_port, smtp_secure, sender_name, is_default, is_enabled) VALUES
          ('企业邮箱SMTP', 'smtp', 'smtp.exmail.qq.com', 465, TRUE, 'xTest测试管理系统', TRUE, FALSE),
          ('自建邮件服务器', 'self_hosted', NULL, NULL, FALSE, 'xTest测试管理系统', FALSE, FALSE)
        `);
        console.log('默认邮件配置模板插入成功');
      }
      
      // 创建性能优化索引
      console.log('开始创建性能优化索引...');
      const indexQueries = [
        'CREATE INDEX idx_users_username ON users(username)',
        'CREATE INDEX idx_users_role ON users(role)',
        'CREATE INDEX idx_users_created_at ON users(created_at)',
        'CREATE INDEX idx_test_cases_library_id ON test_cases(library_id)',
        'CREATE INDEX idx_test_cases_module_id ON test_cases(module_id)',
        'CREATE INDEX idx_test_cases_owner ON test_cases(owner)',
        'CREATE INDEX idx_test_cases_status ON test_cases(status)',
        'CREATE INDEX idx_test_plans_owner ON test_plans(owner)',
        'CREATE INDEX idx_test_plans_status ON test_plans(status)',
        'CREATE INDEX idx_test_plans_project ON test_plans(project)',
        'CREATE INDEX idx_test_plans_created_at ON test_plans(created_at)',
        'CREATE INDEX idx_test_reports_creator_id ON test_reports(creator_id)',
        'CREATE INDEX idx_test_reports_project ON test_reports(project)',
        'CREATE INDEX idx_test_reports_status ON test_reports(status)',
        'CREATE INDEX idx_test_reports_created_at ON test_reports(created_at)',
        'CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id)',
        'CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at)'
      ];
      
      for (const indexQuery of indexQueries) {
        try {
          await connection.execute(indexQuery);
        } catch (idxError) {
          // 索引已存在则忽略错误 (错误码 1061 = ER_DUP_KEYNAME)
          if (idxError.errno !== 1061) {
            console.warn('创建索引警告:', idxError.message);
          }
        }
      }
      console.log('性能优化索引创建完成');
      
      console.log('数据库初始化完成');
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('数据库初始化失败:', error);
    console.error('错误代码:', error.errno);
    console.error('SQL状态:', error.sqlState);
    console.error('错误信息:', error.sqlMessage);
    console.warn('服务器将在没有数据库连接的情况下启动...');
    console.warn('某些功能可能无法正常工作');
  }
}

// ==================== 测试计划管理API ====================

// 获取测试阶段列表（从配置中心）
app.get('/api/configs/stages', async (req, res) => {
  try {
    const [stages] = await pool.execute(
      'SELECT id, name, description FROM test_phases ORDER BY id'
    );
    res.json({ success: true, stages });
  } catch (error) {
    console.error('获取测试阶段列表错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试软件列表（从配置中心）
app.get('/api/configs/softwares', async (req, res) => {
  try {
    const [softwares] = await pool.execute(
      'SELECT id, name, description FROM test_softwares ORDER BY id'
    );
    res.json({ success: true, softwares });
  } catch (error) {
    console.error('获取测试软件列表错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取筛选器配置选项（双引擎筛选器用）
// 获取筛选器配置选项（从数据库真实查询）
// 注意：如果表名不一致，请修改下方的 TABLE_CONFIG 对象中的表名
app.get('/api/configs/filter_options', async (req, res) => {
  // ==================== 表名配置（如需修改请在此处调整）====================
  const TABLE_CONFIG = {
    libraries: 'case_libraries',      // 用例库表
    priorities: 'test_priorities',    // 优先级表
    methods: 'test_methods',          // 测试方式表
    types: 'test_types',              // 测试类型表
    statuses: 'test_statuses'         // 测试状态表（注意：是复数形式）
  };
  
  // Mock数据兜底（当数据库查询失败时使用）
  const mockData = {
    libraries: [
      { id: 1, name: 'BCM 芯片基础用例库' },
      { id: 2, name: 'Centec 路由特性库' },
      { id: 3, name: 'SAI 接口测试库' },
      { id: 4, name: 'QoS 专项测试库' }
    ],
    priorities: [
      { id: 1, name: 'P0' },
      { id: 2, name: 'P1' },
      { id: 3, name: 'P2' },
      { id: 4, name: 'P3' }
    ],
    methods: [
      { id: 1, name: '自动化' },
      { id: 2, name: '纯手工' },
      { id: 3, name: '软硬协同' }
    ],
    types: [
      { id: 1, name: '功能测试' },
      { id: 2, name: '性能压测' },
      { id: 3, name: 'SDK 接口测试' },
      { id: 4, name: '异常注入' },
      { id: 5, name: '回归测试' }
    ],
    statuses: [
      { id: 1, name: 'Review中' },
      { id: 2, name: '已归档' },
      { id: 3, name: '维护中' },
      { id: 4, name: '废弃' }
    ]
  };
  
  try {
    // 使用 Promise.all 并发执行5条SQL查询，提高响应速度
    const [librariesResult, prioritiesResult, methodsResult, typesResult, statusesResult] = await Promise.all([
      // 用例库
      pool.execute(`SELECT id, name FROM ${TABLE_CONFIG.libraries} ORDER BY id`).catch(() => null),
      // 优先级
      pool.execute(`SELECT id, name FROM ${TABLE_CONFIG.priorities} ORDER BY id`).catch(() => null),
      // 测试方式
      pool.execute(`SELECT id, name FROM ${TABLE_CONFIG.methods} ORDER BY id`).catch(() => null),
      // 测试类型
      pool.execute(`SELECT id, name FROM ${TABLE_CONFIG.types} ORDER BY id`).catch(() => null),
      // 测试状态
      pool.execute(`SELECT id, name FROM ${TABLE_CONFIG.statuses} ORDER BY id`).catch(() => null)
    ]);
    
    // 提取查询结果
    const libraries = librariesResult ? librariesResult[0] : null;
    const priorities = prioritiesResult ? prioritiesResult[0] : null;
    const methods = methodsResult ? methodsResult[0] : null;
    const types = typesResult ? typesResult[0] : null;
    const statuses = statusesResult ? statusesResult[0] : null;
    
    // 判断是否需要使用Mock数据（所有查询都失败时使用）
    const allFailed = !libraries && !priorities && !methods && !types && !statuses;
    
    if (allFailed) {
      console.log('所有数据库查询失败，使用Mock数据兜底');
      return res.json({ success: true, data: mockData });
    }
    
    // 构建返回数据（查询成功用真实数据，失败用Mock数据）
    const result = {
      libraries: libraries && libraries.length > 0 ? libraries : mockData.libraries,
      priorities: priorities && priorities.length > 0 ? priorities : mockData.priorities,
      methods: methods && methods.length > 0 ? methods : mockData.methods,
      types: types && types.length > 0 ? types : mockData.types,
      statuses: statuses && statuses.length > 0 ? statuses : mockData.statuses
    };
    
    console.log('筛选器配置加载成功:', {
      libraries: result.libraries.length,
      priorities: result.priorities.length,
      methods: result.methods.length,
      types: result.types.length,
      statuses: result.statuses.length
    });
    
    res.json({ success: true, data: result });
    
  } catch (error) {
    console.error('获取筛选器配置选项错误:', error);
    // 出错时返回Mock数据
    res.json({ success: true, data: mockData });
  }
});

// 获取系统默认AI模型配置
async function getSystemDefaultAIConfig() {
  try {
    const [models] = await pool.execute(
      'SELECT * FROM ai_models WHERE is_default = TRUE AND is_enabled = TRUE LIMIT 1'
    );
    
    if (models.length === 0) {
      return null;
    }
    
    return models[0];
  } catch (error) {
    console.error('获取系统默认AI配置错误:', error);
    return null;
  }
}

// AI智能解析筛选条件
app.post('/api/testplans/ai_parse_filter', async (req, res) => {
  try {
    const { query, modelId, model } = req.body;
    
    if (!query || query.trim() === '') {
      return res.json({ success: false, message: '请输入筛选条件描述' });
    }
    
    // 获取AI模型配置 - 支持modelId或model参数
    let aiModel = null;
    const modelIdentifier = modelId || model;
    
    if (modelIdentifier) {
      const [models] = await pool.execute(
        'SELECT * FROM ai_models WHERE (model_id = ? OR name = ?) AND is_enabled = TRUE',
        [modelIdentifier, modelIdentifier]
      );
      aiModel = models[0];
    }
    
    // 如果没有指定模型，使用默认模型
    if (!aiModel) {
      aiModel = await getSystemDefaultAIConfig();
    }
    
    if (!aiModel) {
      return res.json({ success: false, message: '未找到可用的AI模型配置，请先在配置中心添加AI模型' });
    }
    
    if (!aiModel.api_key) {
      return res.json({ success: false, message: 'AI模型未配置API密钥，请先在配置中心配置' });
    }
    
    console.log('使用AI模型:', aiModel.name, '(' + aiModel.model_id + ')');
    
    // 构建System Prompt - 注入网络测试领域知识
    const systemPrompt = `你是一个网络交换芯片测试领域的智能筛选助手。你需要解析用户的自然语言描述，提取出结构化的筛选条件。

## 领域知识
1. PFC (Priority-based Flow Control) 帧本身不占用交换机缓存(Buffer Memory)，这是重要的物理特性
2. Buffer测试与PFC测试是两个独立的测试类别，不能混淆
3. SAI (Switch Abstraction Interface) 是交换机抽象接口，用于芯片测试
4. 常见测试模块包括：L2 Switching(VLAN, FDB, LAG, STP)、L3 Routing(Route, Next Hop, Neighbor)、QoS(PFC, ECN, WRED, Scheduler)、ACL、Mirror、Buffer Management
5. 用例库包括：BCM芯片基础用例库、Centec路由特性库、SAI接口测试库、QoS专项测试库
6. 测试优先级：P0(阻塞级) > P1(严重级) > P2(一般级) > P3(提示级)
7. 测试方式：自动化、纯手工、软硬协同
8. 测试类型：功能测试、性能压测、SDK接口测试、异常注入、回归测试
9. 测试状态：Review中、已归档、维护中、废弃

## 输出要求
请将用户的自然语言描述转换为以下JSON格式：
{
  "keywords": ["关键词1", "关键词2"],
  "libraryId": 1,
  "priorities": ["P0"],
  "methods": ["自动化"],
  "types": ["性能压测"],
  "statuses": ["已归档"],
  "modules": ["sai_route"]
}

注意：
- keywords: 从用户输入中提取的关键词数组
- libraryId: 用例库ID（数字），如1表示BCM芯片基础用例库，2表示Centec路由特性库
- priorities: 优先级数组，可选值：P0, P1, P2, P3
- methods: 测试方式数组，可选值：自动化, 纯手工, 软硬协同
- types: 测试类型数组，可选值：功能测试, 性能压测, SDK接口测试, 异常注入, 回归测试
- statuses: 测试状态数组，可选值：Review中, 已归档, 维护中, 废弃
- modules: 模块ID数组（如sai_route, sai_qos等）

只返回JSON，不要有其他解释。`;

    // 调用AI模型
    const response = await fetch(aiModel.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiModel.api_key}`
      },
      body: JSON.stringify({
        model: aiModel.model_name,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI模型调用失败:', errorText);
      return res.json({ success: false, message: 'AI模型调用失败: ' + response.status });
    }
    
    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || '';
    
    // 解析AI返回的JSON
    let parsedResult;
    try {
      // 尝试提取JSON部分
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        parsedResult = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('解析AI返回结果失败:', content);
      return res.json({ success: false, message: 'AI返回结果解析失败，请重试' });
    }
    
    // 确保返回结构完整 - 5个维度
    const result = {
      keywords: parsedResult.keywords || [],
      libraryId: parsedResult.libraryId || null,
      priorities: parsedResult.priorities || [],
      methods: parsedResult.methods || [],
      types: parsedResult.types || [],
      statuses: parsedResult.statuses || [],
      modules: parsedResult.modules || []
    };
    
    console.log('AI解析结果:', JSON.stringify(result, null, 2));
    res.json({ success: true, data: result });
    
  } catch (error) {
    console.error('AI解析筛选条件错误:', error);
    res.json({ success: false, message: '服务器错误: ' + error.message });
  }
});

// 获取测试资产树（四级结构：用例库 -> 模块 -> 一级测试点 -> 测试用例）
// 优化：支持懒加载，只加载指定层级的数据
app.get('/api/testassets/tree', async (req, res) => {
  try {
    const { library_id, priority_id, method_id, type_id, status_id, level, parent_id } = req.query;
    
    // 懒加载模式：根据 level 参数只加载指定层级的数据
    const loadLevel = level || 'all';
    
    // ========================================
    // 懒加载模式：只加载指定层级
    // ========================================
    if (loadLevel === 'libraries') {
      // 只加载用例库列表
      const [libraries] = await pool.execute('SELECT id, name FROM case_libraries ORDER BY id');
      const result = await Promise.all(libraries.map(async (lib) => {
        // 查询每个用例库下的用例数量
        const [countResult] = await pool.execute(
          'SELECT COUNT(*) as count FROM test_cases WHERE library_id = ?',
          [lib.id]
        );
        return {
          id: lib.id,
          name: lib.name,
          level: 1,
          type: 'library',
          caseCount: countResult[0].count,
          hasChildren: countResult[0].count > 0
        };
      }));
      return res.json({ success: true, tree: result });
    }
    
    if (loadLevel === 'modules' && parent_id) {
      // 加载指定用例库下的模块
      const [modules] = await pool.execute(
        'SELECT id, name FROM modules WHERE library_id = ? ORDER BY id',
        [parent_id]
      );
      const result = await Promise.all(modules.map(async (mod) => {
        // 查询每个模块下的用例数量
        const [countResult] = await pool.execute(
          `SELECT COUNT(*) as count FROM test_cases tc 
           INNER JOIN level1_points lp ON tc.level1_id = lp.id 
           WHERE lp.module_id = ?`,
          [mod.id]
        );
        return {
          id: mod.id,
          name: mod.name,
          level: 2,
          type: 'module',
          libraryId: parent_id,
          caseCount: countResult[0].count,
          hasChildren: countResult[0].count > 0
        };
      }));
      return res.json({ success: true, tree: result });
    }
    
    if (loadLevel === 'level1points' && parent_id) {
      // 加载指定模块下的一级测试点
      const [level1Points] = await pool.execute(
        'SELECT id, name FROM level1_points WHERE module_id = ? ORDER BY id',
        [parent_id]
      );
      const result = await Promise.all(level1Points.map(async (lp) => {
        // 查询每个测试点下的用例数量
        const [countResult] = await pool.execute(
          'SELECT COUNT(*) as count FROM test_cases WHERE level1_id = ?',
          [lp.id]
        );
        return {
          id: lp.id,
          name: lp.name,
          level: 3,
          type: 'level1',
          moduleId: parent_id,
          caseCount: countResult[0].count,
          hasChildren: countResult[0].count > 0
        };
      }));
      return res.json({ success: true, tree: result });
    }
    
    if (loadLevel === 'cases' && parent_id) {
      // 加载指定测试点下的用例（支持筛选）
      let caseQuery = `
        SELECT tc.id, tc.name, tc.case_id, tc.priority, tc.type, tc.level1_id,
               tc.precondition, tc.steps, tc.expected, tc.creator
        FROM test_cases tc
        WHERE tc.level1_id = ?
      `;
      const caseParams = [parent_id];
      
      // 优先级筛选
      if (priority_id) {
        const [priorityRows] = await pool.execute('SELECT name FROM test_priorities WHERE id = ?', [priority_id]);
        if (priorityRows.length > 0) {
          caseQuery += ' AND tc.priority = ?';
          caseParams.push(priorityRows[0].name);
        }
      }
      
      // 测试方式筛选
      if (method_id) {
        const [methodRows] = await pool.execute('SELECT name FROM test_methods WHERE id = ?', [method_id]);
        if (methodRows.length > 0) {
          caseQuery += ' AND tc.method = ?';
          caseParams.push(methodRows[0].name);
        }
      }
      
      // 测试类型筛选
      if (type_id) {
        const [typeRows] = await pool.execute('SELECT name FROM test_types WHERE id = ?', [type_id]);
        if (typeRows.length > 0) {
          caseQuery += ' AND tc.type = ?';
          caseParams.push(typeRows[0].name);
        }
      }
      
      // 测试状态筛选
      if (status_id) {
        const [statusRows] = await pool.execute('SELECT name FROM test_statuses WHERE id = ?', [status_id]);
        if (statusRows.length > 0) {
          caseQuery += ' AND tc.status = ?';
          caseParams.push(statusRows[0].name);
        }
      }
      
      caseQuery += ' ORDER BY tc.id LIMIT 500'; // 限制每次最多返回500条
      
      const [cases] = await pool.execute(caseQuery, caseParams);
      
      const result = cases.map(c => ({
        id: c.id,
        name: c.name,
        caseId: c.case_id,
        priority: c.priority,
        type: c.type,
        level: 4,
        nodeType: 'case',
        level1Id: c.level1_id,
        precondition: c.precondition,
        steps: c.steps,
        expected: c.expected,
        creator: c.creator
      }));
      
      return res.json({ success: true, tree: result });
    }
    
    // ========================================
    // 全量加载模式（兼容旧逻辑，但限制数量）
    // ========================================
    
    // 1. 获取用例库
    let libraryQuery = 'SELECT id, name FROM case_libraries';
    const libraryParams = [];
    if (library_id) {
      libraryQuery += ' WHERE id = ?';
      libraryParams.push(library_id);
    }
    libraryQuery += ' ORDER BY id';
    const [libraries] = await pool.execute(libraryQuery, libraryParams);
    
    // 2. 获取模块
    let moduleQuery = 'SELECT id, name, library_id FROM modules';
    const moduleParams = [];
    if (library_id) {
      moduleQuery += ' WHERE library_id = ?';
      moduleParams.push(library_id);
    }
    moduleQuery += ' ORDER BY id';
    const [modules] = await pool.execute(moduleQuery, moduleParams);
    
    // 3. 获取一级测试点
    const moduleIds = modules.map(m => m.id);
    let level1Query = 'SELECT id, name, module_id FROM level1_points';
    const level1Params = [];
    if (moduleIds.length > 0) {
      level1Query += ' WHERE module_id IN (' + moduleIds.map(() => '?').join(',') + ')';
      level1Params.push(...moduleIds);
    }
    level1Query += ' ORDER BY id';
    const [level1Points] = level1Params.length > 0 
      ? await pool.execute(level1Query, level1Params)
      : await pool.execute('SELECT id, name, module_id FROM level1_points ORDER BY id');
    
    // 4. 获取测试用例（限制数量，避免内存溢出）
    let caseQuery = `
      SELECT tc.id, tc.name, tc.case_id, tc.priority, tc.type, tc.level1_id,
             tc.precondition, tc.steps, tc.expected, tc.creator, tc.library_id
      FROM test_cases tc
      WHERE 1=1
    `;
    const caseParams = [];
    
    if (library_id) {
      caseQuery += ' AND tc.library_id = ?';
      caseParams.push(library_id);
    }
    
    if (priority_id) {
      const [priorityRows] = await pool.execute('SELECT name FROM test_priorities WHERE id = ?', [priority_id]);
      if (priorityRows.length > 0) {
        caseQuery += ' AND tc.priority = ?';
        caseParams.push(priorityRows[0].name);
      }
    }
    
    if (method_id) {
      const [methodRows] = await pool.execute('SELECT name FROM test_methods WHERE id = ?', [method_id]);
      if (methodRows.length > 0) {
        caseQuery += ' AND tc.method = ?';
        caseParams.push(methodRows[0].name);
      }
    }
    
    if (type_id) {
      const [typeRows] = await pool.execute('SELECT name FROM test_types WHERE id = ?', [type_id]);
      if (typeRows.length > 0) {
        caseQuery += ' AND tc.type = ?';
        caseParams.push(typeRows[0].name);
      }
    }
    
    if (status_id) {
      const [statusRows] = await pool.execute('SELECT name FROM test_statuses WHERE id = ?', [status_id]);
      if (statusRows.length > 0) {
        caseQuery += ' AND tc.status = ?';
        caseParams.push(statusRows[0].name);
      }
    }
    
    caseQuery += ' ORDER BY tc.id LIMIT 10000'; // 限制最多10000条
    
    const [cases] = await pool.execute(caseQuery, caseParams);
    
    // 构建四级树结构（保留所有用例库节点，包括空的）
    const tree = libraries.map(lib => {
      const libModules = modules
        .filter(mod => mod.library_id === lib.id)
        .map(mod => {
          const modLevel1Points = level1Points
            .filter(lp => lp.module_id === mod.id)
            .map(lp => {
              const lpCases = cases
                .filter(c => c.level1_id === lp.id)
                .map(c => ({
                  id: c.id,
                  name: c.name,
                  caseId: c.case_id,
                  priority: c.priority,
                  type: c.type,
                  level: 4,
                  type: 'case',
                  precondition: c.precondition,
                  steps: c.steps,
                  expected: c.expected,
                  creator: c.creator
                }));
              
              // 保留所有测试点节点（包括空的）
              return {
                id: lp.id,
                name: lp.name,
                level: 3,
                type: 'level1',
                children: lpCases
              };
            });
          
          // 保留所有模块节点（包括空的）
          return {
            id: mod.id,
            name: mod.name,
            level: 2,
            type: 'module',
            children: modLevel1Points
          };
        });
      
      // 保留所有用例库节点（包括空的）
      return {
        id: lib.id,
        name: lib.name,
        level: 1,
        type: 'library',
        children: libModules
      };
    });
    
    // 统计总数
    const totalCases = cases.length;
    const totalLevel1 = level1Points.length;
    const totalModules = modules.length;
    const totalLibraries = libraries.length;
    
    res.json({
      success: true,
      tree,
      stats: {
        totalLibraries,
        totalModules,
        totalLevel1,
        totalCases
      }
    });
  } catch (error) {
    console.error('获取测试资产树错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个测试用例详情
app.get('/api/testpoints/detail/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [cases] = await pool.execute(
      `SELECT id, case_id, name, priority, type, method, precondition, steps, expected, 
              creator, created_at, module_id, level1_id, library_id, owner, remark, key_config, status
       FROM test_cases WHERE id = ?`,
      [id]
    );
    
    if (cases.length === 0) {
      return res.json({ success: false, message: '用例不存在' });
    }
    
    const testCase = cases[0];
    
    // 获取关联的测试阶段
    const [phases] = await pool.execute(
      `SELECT p.name FROM test_case_phases tcp
       JOIN test_phases p ON tcp.phase_id = p.id
       WHERE tcp.test_case_id = ?`,
      [id]
    );
    testCase.test_phase = phases.map(p => p.name).join(',');
    
    // 获取关联的测试环境
    const [environments] = await pool.execute(
      `SELECT e.name FROM test_case_environments tce
       JOIN environments e ON tce.environment_id = e.id
       WHERE tce.test_case_id = ?`,
      [id]
    );
    testCase.test_environment = environments.map(e => e.name).join(',');
    
    // 获取关联的测试方式
    const [methods] = await pool.execute(
      `SELECT m.name FROM test_case_methods tcm
       JOIN test_methods m ON tcm.method_id = m.id
       WHERE tcm.test_case_id = ?`,
      [id]
    );
    testCase.test_method = methods.map(m => m.name).join(',');
    
    // 获取关联的测试点来源
    const [sources] = await pool.execute(
      `SELECT s.name FROM test_case_sources tcs
       JOIN test_sources s ON tcs.source_id = s.id
       WHERE tcs.test_case_id = ?`,
      [id]
    );
    testCase.test_source = sources.map(s => s.name).join(',');
    
    res.json({ success: true, data: testCase });
  } catch (error) {
    console.error('获取用例详情错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 创建测试计划（带规则）
app.post('/api/testplans/create_with_rules', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { 
      name, 
      owner, 
      project, 
      iteration, 
      description, 
      start_date, 
      end_date,
      stage_id,
      software_id,
      selectedCases,
      // 新的5个筛选维度
      library_id,
      priority_id,
      method_id,
      type_id,
      status_id
    } = req.body;
    
    console.log('创建测试计划请求:', { name, owner, project, stage_id, software_id, selectedCases: selectedCases?.length });
    
    // 1. 创建测试计划主记录
    const [planResult] = await connection.execute(
      `INSERT INTO test_plans (name, owner, status, test_phase, project, iteration, description, start_date, end_date, stage_id, software_id, total_cases, tested_cases)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [name, owner, stage_id || '未指定', project, iteration || null, description || null, start_date || null, end_date || null, stage_id || null, software_id || null]
    );
    
    const planId = planResult.insertId;
    console.log('测试计划创建成功, ID:', planId);
    
    // 2. 保存筛选规则（新的5个维度）
    const filterRules = {
      library_id: library_id || null,
      priority_id: priority_id || null,
      method_id: method_id || null,
      type_id: type_id || null,
      status_id: status_id || null
    };
    
    // 只有有筛选条件时才保存规则
    if (Object.values(filterRules).some(v => v !== null)) {
      await connection.execute(
        `INSERT INTO test_plan_rules (plan_id, rule_type, rule_name, rule_config, enabled, created_by)
         VALUES (?, 'FILTER', '筛选规则', ?, 1, ?)`,
        [planId, JSON.stringify(filterRules), owner]
      );
    }
    
    // 3. 批量插入用例快照
    let caseIdsToInsert = selectedCases || [];
    
    // 如果没有直接指定用例，但有筛选条件，则根据筛选条件查询用例
    if ((!caseIdsToInsert || caseIdsToInsert.length === 0) && 
        (library_id || priority_id || method_id || type_id || status_id)) {
      
      let querySql = 'SELECT id FROM test_cases WHERE 1=1';
      const queryParams = [];
      
      if (library_id) {
        querySql += ' AND library_id = ?';
        queryParams.push(library_id);
      }
      if (priority_id) {
        const [priorityRows] = await connection.execute('SELECT name FROM test_priorities WHERE id = ?', [priority_id]);
        if (priorityRows.length > 0) {
          querySql += ' AND priority = ?';
          queryParams.push(priorityRows[0].name);
        }
      }
      if (method_id) {
        const [methodRows] = await connection.execute('SELECT name FROM test_methods WHERE id = ?', [method_id]);
        if (methodRows.length > 0) {
          querySql += ' AND method = ?';
          queryParams.push(methodRows[0].name);
        }
      }
      if (type_id) {
        const [typeRows] = await connection.execute('SELECT name FROM test_types WHERE id = ?', [type_id]);
        if (typeRows.length > 0) {
          querySql += ' AND type = ?';
          queryParams.push(typeRows[0].name);
        }
      }
      if (status_id) {
        const [statusRows] = await connection.execute('SELECT name FROM test_statuses WHERE id = ?', [status_id]);
        if (statusRows.length > 0) {
          querySql += ' AND status = ?';
          queryParams.push(statusRows[0].name);
        }
      }
      
      const [cases] = await connection.execute(querySql, queryParams);
      caseIdsToInsert = cases.map(c => c.id);
      console.log(`根据筛选条件查询到 ${caseIdsToInsert.length} 条用例`);
    }
    
    if (caseIdsToInsert && caseIdsToInsert.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < caseIdsToInsert.length; i += batchSize) {
        const batch = caseIdsToInsert.slice(i, i + batchSize);
        const values = batch.map(caseId => `(${planId}, ${caseId}, 'pending')`).join(',');
        
        await connection.execute(
          `INSERT IGNORE INTO test_plan_cases (plan_id, case_id, status) VALUES ${values}`
        );
      }
      
      // 更新计划的总用例数
      await connection.execute(
        'UPDATE test_plans SET total_cases = ? WHERE id = ?',
        [caseIdsToInsert.length, planId]
      );
    }
    
    await connection.commit();
    
    res.json({ 
      success: true, 
      message: '测试计划创建成功', 
      planId,
      caseCount: selectedCases ? selectedCases.length : 0
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('创建测试计划错误:', error);
    res.json({ success: false, message: '服务器错误: ' + error.message });
  } finally {
    connection.release();
  }
});

// 自动同步执行结果（Webhook接口）
app.post('/api/testplans/auto_sync', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { 
      plan_id, 
      case_id, 
      case_external_id,
      status, 
      executor_id, 
      duration, 
      log_path, 
      error_message,
      pfc_specific,
      buffer_test,
      metadata
    } = req.body;
    
    console.log('接收到自动同步请求:', { plan_id, case_id, case_external_id, status });
    
    // 验证状态值
    const validStatuses = ['Pass', 'Fail', 'Block', 'ASIC_Hang', 'Core_Dump', 'Traffic_Drop', 'pending', 'Skip'];
    if (!validStatuses.includes(status)) {
      return res.json({ success: false, message: `无效的状态值: ${status}。有效值: ${validStatuses.join(', ')}` });
    }
    
    // 查找用例ID
    let targetCaseId = case_id;
    if (!targetCaseId && case_external_id) {
      const [caseResult] = await connection.execute(
        'SELECT id FROM test_cases WHERE case_id = ?',
        [case_external_id]
      );
      if (caseResult.length > 0) {
        targetCaseId = caseResult[0].id;
      }
    }
    
    if (!plan_id || !targetCaseId) {
      return res.json({ success: false, message: '缺少必要参数: plan_id 或 case_id' });
    }
    
    // 更新执行快照
    const [updateResult] = await connection.execute(
      `UPDATE test_plan_cases 
       SET status = ?, 
           executor_id = ?, 
           execution_time = CURRENT_TIMESTAMP, 
           duration = ?, 
           log_path = ?, 
           error_message = ?,
           pfc_specific = ?,
           buffer_test = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE plan_id = ? AND case_id = ?`,
      [
        status,
        executor_id || 'auto_sync',
        duration || null,
        log_path || null,
        error_message || null,
        pfc_specific ? 1 : 0,
        buffer_test ? 1 : 0,
        plan_id,
        targetCaseId
      ]
    );
    
    if (updateResult.affectedRows === 0) {
      // 如果没有更新到记录，可能需要创建
      await connection.execute(
        `INSERT INTO test_plan_cases (plan_id, case_id, status, executor_id, execution_time, duration, log_path, error_message, pfc_specific, buffer_test)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)`,
        [plan_id, targetCaseId, status, executor_id || 'auto_sync', duration || null, log_path || null, error_message || null, pfc_specific ? 1 : 0, buffer_test ? 1 : 0]
      );
    }
    
    // 记录执行日志
    await connection.execute(
      `INSERT INTO test_execution_logs (plan_case_id, log_type, message, metadata)
       SELECT id, 'INFO', ?, ? FROM test_plan_cases WHERE plan_id = ? AND case_id = ?`,
      [
        `执行状态更新: ${status}`,
        metadata ? JSON.stringify(metadata) : null,
        plan_id,
        targetCaseId
      ]
    );
    
    // 更新测试计划统计
    await updatePlanStatistics(connection, plan_id);
    
    await connection.commit();
    
    res.json({ 
      success: true, 
      message: '执行结果同步成功',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('自动同步错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  } finally {
    connection.release();
  }
});

// 更新测试计划统计
async function updatePlanStatistics(connection, planId) {
  const [stats] = await connection.execute(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'Pass' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN status = 'Fail' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'Block' THEN 1 ELSE 0 END) as blocked,
      SUM(CASE WHEN status = 'ASIC_Hang' THEN 1 ELSE 0 END) as asic_hang,
      SUM(CASE WHEN status = 'Core_Dump' THEN 1 ELSE 0 END) as core_dump,
      SUM(CASE WHEN status = 'Traffic_Drop' THEN 1 ELSE 0 END) as traffic_drop,
      SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) as tested
    FROM test_plan_cases
    WHERE plan_id = ?
  `, [planId]);
  
  const stat = stats[0];
  const passRate = stat.tested > 0 ? ((stat.passed / stat.tested) * 100).toFixed(2) : 0;
  
  await connection.execute(
    'UPDATE test_plans SET total_cases = ?, tested_cases = ?, pass_rate = ? WHERE id = ?',
    [stat.total, stat.tested, passRate, planId]
  );
}

// 获取测试计划报告
app.get('/api/testplans/:id/report', async (req, res) => {
  try {
    const planId = req.params.id;
    
    // 获取测试计划基本信息
    const [plans] = await connection.execute(
      'SELECT * FROM test_plans WHERE id = ?',
      [planId]
    );
    
    if (plans.length === 0) {
      return res.json({ success: false, message: '测试计划不存在' });
    }
    
    const plan = plans[0];
    
    // 获取环境基线
    const [matrix] = await connection.execute(
      'SELECT * FROM test_plan_matrix WHERE plan_id = ?',
      [planId]
    );
    
    // 获取执行统计
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_cases,
        SUM(CASE WHEN status = 'Pass' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status = 'Fail' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'Block' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN status = 'ASIC_Hang' THEN 1 ELSE 0 END) as asic_hang,
        SUM(CASE WHEN status = 'Core_Dump' THEN 1 ELSE 0 END) as core_dump,
        SUM(CASE WHEN status = 'Traffic_Drop' THEN 1 ELSE 0 END) as traffic_drop,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) as tested,
        AVG(CASE WHEN duration IS NOT NULL THEN duration ELSE NULL END) as avg_duration
      FROM test_plan_cases
      WHERE plan_id = ?
    `, [planId]);
    
    // 获取模块分布统计
    const [moduleStats] = await pool.execute(`
      SELECT 
        sm.module_id, sm.name as module_name,
        COUNT(*) as total,
        SUM(CASE WHEN tpc.status = 'Pass' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN tpc.status = 'Fail' THEN 1 ELSE 0 END) as failed
      FROM test_plan_cases tpc
      LEFT JOIN sai_modules sm ON tpc.module_id = sm.id
      WHERE tpc.plan_id = ?
      GROUP BY sm.id, sm.module_id, sm.name
      ORDER BY total DESC
    `, [planId]);
    
    // 获取优先级分布
    const [priorityStats] = await pool.execute(`
      SELECT 
        tc.priority,
        COUNT(*) as total,
        SUM(CASE WHEN tpc.status = 'Pass' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN tpc.status = 'Fail' THEN 1 ELSE 0 END) as failed
      FROM test_plan_cases tpc
      LEFT JOIN test_cases tc ON tpc.case_id = tc.id
      WHERE tpc.plan_id = ?
      GROUP BY tc.priority
    `, [planId]);
    
    // 获取PFC专属测试统计
    const [pfcStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Pass' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status = 'Fail' THEN 1 ELSE 0 END) as failed
      FROM test_plan_cases
      WHERE plan_id = ? AND pfc_specific = 1
    `, [planId]);
    
    // 获取失败用例详情
    const [failedCases] = await pool.execute(`
      SELECT 
        tpc.id, tpc.status, tpc.execution_time, tpc.duration, tpc.error_message, tpc.log_path,
        tc.case_id, tc.name as case_name, tc.priority,
        sm.module_id, sm.name as module_name
      FROM test_plan_cases tpc
      LEFT JOIN test_cases tc ON tpc.case_id = tc.id
      LEFT JOIN sai_modules sm ON tpc.module_id = sm.id
      WHERE tpc.plan_id = ? AND tpc.status IN ('Fail', 'ASIC_Hang', 'Core_Dump', 'Traffic_Drop')
      ORDER BY tpc.execution_time DESC
      LIMIT 100
    `, [planId]);
    
    const stat = stats[0];
    const passRate = stat.tested > 0 ? ((stat.passed / stat.tested) * 100).toFixed(2) : 0;
    
    const report = {
      success: true,
      timestamp: new Date().toISOString(),
      sources: {
        database: 'MySQL - test_plans, test_plan_cases, test_plan_matrix, sai_modules',
        generated_by: 'xTest Hardware Test Plan Management System',
        version: '1.0.0'
      },
      plan: {
        id: plan.id,
        name: plan.name,
        owner: plan.owner,
        status: plan.status,
        test_phase: plan.test_phase,
        project: plan.project,
        iteration: plan.iteration,
        start_date: plan.start_date,
        end_date: plan.end_date,
        created_at: plan.created_at,
        updated_at: plan.updated_at
      },
      matrix: matrix[0] || null,
      statistics: {
        total_cases: stat.total_cases || 0,
        tested_cases: stat.tested || 0,
        passed: stat.passed || 0,
        failed: stat.failed || 0,
        blocked: stat.blocked || 0,
        asic_hang: stat.asic_hang || 0,
        core_dump: stat.core_dump || 0,
        traffic_drop: stat.traffic_drop || 0,
        pending: stat.pending || 0,
        pass_rate: parseFloat(passRate),
        avg_duration: stat.avg_duration || 0
      },
      module_distribution: moduleStats,
      priority_distribution: priorityStats,
      pfc_statistics: {
        total: pfcStats[0]?.total || 0,
        passed: pfcStats[0]?.passed || 0,
        failed: pfcStats[0]?.failed || 0,
        note: 'PFC (Priority-based Flow Control) frames do not occupy switch buffer memory'
      },
      failed_cases: failedCases
    };
    
    res.json(report);
    
  } catch (error) {
    console.error('获取测试计划报告错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取测试计划列表
app.get('/api/testplans/list', async (req, res) => {
  try {
    const { project, status, test_phase } = req.query;
    
    let query = `
      SELECT tp.*, 
        tpm.asic_type, tpm.sdk_type, tpm.topology,
        (SELECT COUNT(*) FROM test_plan_cases WHERE plan_id = tp.id) as case_count
      FROM test_plans tp
      LEFT JOIN test_plan_matrix tpm ON tp.id = tpm.plan_id
      WHERE 1=1
    `;
    const params = [];
    
    if (project) {
      query += ' AND tp.project = ?';
      params.push(project);
    }
    
    if (status) {
      query += ' AND tp.status = ?';
      params.push(status);
    }
    
    if (test_phase) {
      query += ' AND tp.test_phase = ?';
      params.push(test_phase);
    }
    
    query += ' ORDER BY tp.created_at DESC';
    
    const [plans] = await pool.execute(query, params);
    
    res.json({ success: true, plans });
    
  } catch (error) {
    console.error('获取测试计划列表错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 获取单个测试计划详情
app.get('/api/testplans/:id', async (req, res) => {
  try {
    const planId = req.params.id;
    
    const [plans] = await pool.execute(
      'SELECT * FROM test_plans WHERE id = ?',
      [planId]
    );
    
    if (plans.length === 0) {
      return res.json({ success: false, message: '测试计划不存在' });
    }
    
    // 获取测试计划的用例列表（包含完整层级信息）
    const [cases] = await pool.execute(`
      SELECT tpc.*, tc.name as case_name, tc.module_id, tc.library_id, tc.level1_id
      FROM test_plan_cases tpc
      LEFT JOIN test_cases tc ON tpc.case_id = tc.id
      WHERE tpc.plan_id = ?
    `, [planId]);
    
    // 获取测试计划的规则
    let rules = [];
    try {
      const [rulesResult] = await pool.execute(
        'SELECT * FROM test_plan_rules WHERE plan_id = ? ORDER BY priority DESC',
        [planId]
      );
      rules = rulesResult;
    } catch (e) {
      // test_plan_rules 表可能不存在，忽略错误
    }
    
    // 获取配置中心的测试状态列表
    const [testStatuses] = await pool.execute(
      'SELECT id, status_id, name, description FROM test_statuses ORDER BY created_at'
    );
    
    // 统计每个测试状态对应的用例数量
    const statusStatistics = {};
    const statusColorMap = {};
    
    // 初始化所有状态的计数为0，并设置默认颜色
    const defaultColors = ['#52c41a', '#1890ff', '#faad14', '#ff4d4f', '#722ed1', '#13c2c2', '#eb2f96', '#909399'];
    testStatuses.forEach((status, index) => {
      statusStatistics[status.name] = 0;
      statusColorMap[status.name] = defaultColors[index % defaultColors.length];
    });
    
    // 使用子查询获取该计划所有用例的测试状态统计（避免IN子句占位符数量限制）
    const [caseStatusStats] = await pool.execute(`
      SELECT ts.name, COUNT(DISTINCT tcs.test_case_id) as count
      FROM test_case_statuses tcs
      JOIN test_statuses ts ON tcs.status_id = ts.id
      WHERE tcs.test_case_id IN (
        SELECT case_id FROM test_plan_cases WHERE plan_id = ?
      )
      GROUP BY ts.name
    `, [planId]);
    
    caseStatusStats.forEach(stat => {
      if (statusStatistics.hasOwnProperty(stat.name)) {
        statusStatistics[stat.name] = stat.count;
      }
    });
    
    res.json({ 
      success: true, 
      plan: {
        ...plans[0],
        cases: cases,
        total_cases: cases.length,
        tested_cases: cases.filter(c => c.status !== 'pending').length,
        pass_rate: cases.length > 0 
          ? Math.round(cases.filter(c => c.status === 'pass').length / cases.length * 100) 
          : 0,
        status_statistics: statusStatistics,
        status_colors: statusColorMap
      },
      rules: rules,
      test_statuses: testStatuses
    });
    
  } catch (error) {
    console.error('获取测试计划详情错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 预览计划用例
app.post('/api/testplans/preview_cases', async (req, res) => {
  try {
    const { selectedModules, priorities, rules } = req.body;
    
    let query = `
      SELECT COUNT(DISTINCT tc.id) as count
      FROM test_cases tc
      WHERE 1=1
    `;
    const params = [];
    
    if (selectedModules && selectedModules.length > 0) {
      query += ` AND tc.module_id IN (${selectedModules.map(() => '?').join(',')})`;
      params.push(...selectedModules);
    }
    
    if (priorities && priorities.length > 0) {
      query += ` AND tc.priority IN (${priorities.map(() => '?').join(',')})`;
      params.push(...priorities);
    }
    
    const [result] = await pool.execute(query, params);
    
    // 获取模块分布
    let moduleQuery = `
      SELECT sm.module_id, sm.name, COUNT(*) as count
      FROM test_cases tc
      LEFT JOIN sai_modules sm ON tc.module_id = sm.id
      WHERE 1=1
    `;
    const moduleParams = [];
    
    if (selectedModules && selectedModules.length > 0) {
      moduleQuery += ` AND tc.module_id IN (${selectedModules.map(() => '?').join(',')})`;
      moduleParams.push(...selectedModules);
    }
    
    if (priorities && priorities.length > 0) {
      moduleQuery += ` AND tc.priority IN (${priorities.map(() => '?').join(',')})`;
      moduleParams.push(...priorities);
    }
    
    moduleQuery += ' GROUP BY sm.id ORDER BY count DESC LIMIT 20';
    
    const [moduleDist] = await pool.execute(moduleQuery, moduleParams);
    
    res.json({ 
      success: true, 
      totalCases: result[0].count,
      moduleDistribution: moduleDist
    });
    
  } catch (error) {
    console.error('预览用例错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试计划状态
app.post('/api/testplans/:id/status', async (req, res) => {
  try {
    const planId = req.params.id;
    const { status } = req.body;
    
    const validStatuses = ['draft', 'running', 'paused', 'completed', 'archived', 'delayed', 'not_started'];
    if (!validStatuses.includes(status)) {
      return res.json({ success: false, message: '无效的状态值' });
    }
    
    // 根据状态更新不同的字段
    let updateSql = 'UPDATE test_plans SET status = ?, updated_at = CURRENT_TIMESTAMP';
    const updateParams = [status];
    
    if (status === 'running') {
      // 开始执行时，记录实际开始时间
      updateSql += ', actual_start_time = CURRENT_TIMESTAMP';
    } else if (status === 'completed') {
      // 完成时，记录实际完成时间
      updateSql += ', actual_end_time = CURRENT_TIMESTAMP';
    }
    
    updateSql += ' WHERE id = ?';
    updateParams.push(planId);
    
    await pool.execute(updateSql, updateParams);
    
    res.json({ success: true, message: '状态更新成功' });
    
  } catch (error) {
    console.error('更新测试计划状态错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试计划实际完成时间
app.post('/api/testplans/:id/end-time', async (req, res) => {
  try {
    const planId = req.params.id;
    const { actual_end_time } = req.body;
    
    await pool.execute(
      'UPDATE test_plans SET actual_end_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [actual_end_time, planId]
    );
    
    res.json({ success: true, message: '完成时间更新成功' });
    
  } catch (error) {
    console.error('更新测试计划完成时间错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 更新测试计划
app.put('/api/testplans/:id', async (req, res) => {
  try {
    const planId = req.params.id;
    const { name, owner, project, stage_id, software_id, iteration, description, start_date, end_date, actual_end_time, selectedCases } = req.body;
    
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // 更新测试计划基本信息
      await connection.execute(
        `UPDATE test_plans 
         SET name = ?, owner = ?, project = ?, stage_id = ?, software_id = ?, 
             iteration = ?, description = ?, start_date = ?, end_date = ?, actual_end_time = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name, owner, project, stage_id || null, software_id || null, iteration || null, description || null, start_date || null, end_date || null, actual_end_time || null, planId]
      );
      
      // 如果有选中的用例，更新用例关联
      if (selectedCases && selectedCases.length > 0) {
        // 先删除旧的关联
        await connection.execute('DELETE FROM test_plan_cases WHERE plan_id = ?', [planId]);
        
        // 批量插入新的关联
        const batchSize = 500;
        for (let i = 0; i < selectedCases.length; i += batchSize) {
          const batch = selectedCases.slice(i, i + batchSize);
          const values = batch.map(caseId => `(${planId}, ${caseId}, 'pending')`).join(',');
          
          await connection.execute(
            `INSERT IGNORE INTO test_plan_cases (plan_id, case_id, status) VALUES ${values}`
          );
        }
        
        // 更新计划的总用例数
        await connection.execute(
          'UPDATE test_plans SET total_cases = ? WHERE id = ?',
          [selectedCases.length, planId]
        );
      }
      
      await connection.commit();
      
      res.json({ success: true, message: '测试计划更新成功', caseCount: selectedCases ? selectedCases.length : 0 });
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    
  } catch (error) {
    console.error('更新测试计划错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 删除测试计划
app.delete('/api/testplans/:id', async (req, res) => {
  try {
    const planId = req.params.id;
    
    await pool.execute('DELETE FROM test_plans WHERE id = ?', [planId]);
    
    res.json({ success: true, message: '测试计划删除成功' });
    
  } catch (error) {
    console.error('删除测试计划错误:', error);
    res.json({ success: false, message: '服务器错误', error: error.message });
  }
});

// 启动服务器
async function startServer() {
  try {
    console.log('开始启动服务器...');
    await initDatabase();
    console.log('数据库初始化完成，开始监听端口...');
    
    // 创建HTTP服务器
    const server = http.createServer(app);
    
    // 配置Socket.io - 添加心跳检测
    const io = socketIO(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      pingInterval: 25000,  // 每25秒发送一次ping
      pingTimeout: 60000    // 60秒未响应则断开连接
    });
    
    // 存储在线用户
    const onlineUsersManager = require('./onlineUsersManager');
    
    // 处理Socket.io连接
    io.on('connection', (socket) => {
      console.log('新用户连接:', socket.id);
      
      // 处理用户登录
      socket.on('login', (user) => {
        onlineUsersManager.addOnlineUser(socket.id, user);
        console.log(`${user.username} 登录了`);
        io.emit('userConnected', user);
        io.emit('onlineUsers', onlineUsersManager.getAllOnlineUsers());
      });
      
      // 处理用户登出
      socket.on('logout', () => {
        const user = onlineUsersManager.getOnlineUser(socket.id);
        if (user) {
          console.log(`${user.username} 登出了`);
          onlineUsersManager.removeOnlineUser(socket.id);
          io.emit('userDisconnected', user);
          io.emit('onlineUsers', onlineUsersManager.getAllOnlineUsers());
        }
      });
      
      // 处理心跳响应
      socket.on('pong', () => {
        // 客户端响应心跳，连接正常
      });
      
      // 处理测试点更新
      socket.on('updateTestPoint', (data) => {
        console.log('测试点更新:', data);
        io.emit('testPointUpdated', data);
      });
      
      // 处理模块更新
      socket.on('updateModule', (data) => {
        console.log('模块更新:', data);
        io.emit('moduleUpdated', data);
      });
      
      // 处理用户断开连接
      socket.on('disconnect', () => {
        const user = onlineUsersManager.getOnlineUser(socket.id);
        if (user) {
          console.log(`${user.username} 断开连接了`);
          onlineUsersManager.removeOnlineUser(socket.id);
          io.emit('userDisconnected', user);
          io.emit('onlineUsers', onlineUsersManager.getAllOnlineUsers());
        }
      });
    });
    
    // 启动服务器
    server.listen(PORT, () => {
      logger.info(`服务器运行在 http://localhost:${PORT}`);
      logger.info('WebSocket服务已启动');
      logger.info('服务器启动成功，等待请求...');
    });
    
    server.on('error', (error) => {
      logger.error('服务器错误', { error: error.message, stack: error.stack });
    });
    
    function gracefulShutdown(signal) {
      logger.info(`收到 ${signal} 信号，正在关闭服务器...`);
      
      try {
        io.close();
        logger.info('WebSocket服务已关闭');
      } catch (error) {
        logger.error('关闭WebSocket服务时出错', { error: error.message });
      }
      
      try {
        server.close();
        logger.info('HTTP服务器已关闭');
      } catch (error) {
        logger.error('关闭HTTP服务器时出错', { error: error.message });
      }
      
      logger.info('服务器正在退出...');
      process.exit(0);
    }

// 监听进程终止信号 - 跨平台兼容
// SIGINT: Ctrl+C 终止信号 (Windows/macOS/Linux)
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// SIGTERM: 进程终止信号 (Linux容器/K8s/Docker/PM2 优雅关闭)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // 防止进程意外退出
    process.on('uncaughtException', (error) => {
      logger.fatal('未捕获的异常', { error: error.message, stack: error.stack });
    });
    
    process.on('unhandledRejection', (error) => {
      logger.error('未处理的Promise拒绝', { error: error?.message || String(error) });
    });
    
  } catch (error) {
    logger.fatal('服务器启动失败', { error: error.message, stack: error.stack });
  }
}

// 启动服务器
startServer();