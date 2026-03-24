const express = require('express');
const router = express.Router();
const pool = require('../db');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 配置multer用于Excel文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'import-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// 配置multer用于图片上传
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/images');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'img-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const imageUpload = multer({
  storage: imageStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持JPG、PNG、GIF、WEBP格式的图片'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// 图片上传API
router.post('/upload-image', imageUpload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, message: '请选择图片文件' });
    }
    
    const imageUrl = `/uploads/images/${req.file.filename}`;
    
    res.json({
      success: true,
      message: '图片上传成功',
      data: {
        url: imageUrl,
        filename: req.file.filename,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('图片上传错误:', error);
    res.json({ success: false, message: '图片上传失败: ' + error.message });
  }
});

// 系统预设字段（补充缺失字段）
const SYSTEM_FIELDS = [
  { key: 'name', label: '用例名称', required: true },
  { key: 'module_name', label: '模块名称', required: true },
  { key: 'level1_name', label: '一级测试点', required: false },
  { key: 'priority', label: '优先级', required: false },
  { key: 'type', label: '用例类型', required: false },
  { key: 'precondition', label: '前置条件', required: false },
  { key: 'purpose', label: '测试目的', required: false },
  { key: 'steps', label: '测试步骤', required: false },
  { key: 'expected', label: '预期结果', required: false },
  { key: 'owner', label: '执行人', required: false },
  { key: 'status', label: '维护状态', required: false },
  { key: 'key_config', label: '关键配置', required: false },
  { key: 'remark', label: '备注', required: false },
  { key: 'bug_id', label: 'Bug ID', required: false },
  { key: 'method', label: '测试方式', required: false },
  { key: 'environment', label: '测试环境', required: false },
  { key: 'phase', label: '测试阶段', required: false }
];

/**
 * 导出模块结构（不包含测试用例）
 */
async function exportModuleStructure(req, res, libraryId, moduleIds, moduleId) {
  try {
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (libraryId) {
      whereClause += ' AND m.library_id = ?';
      params.push(libraryId);
    }
    if (moduleIds) {
      const ids = moduleIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        whereClause += ` AND m.id IN (${placeholders})`;
        params.push(...ids);
      }
    }
    if (moduleId) {
      whereClause += ' AND m.id = ?';
      params.push(moduleId);
    }
    
    const [modules] = await pool.execute(`
      SELECT 
        cl.name as library_name,
        m.name as module_name,
        m.order_index,
        (SELECT COUNT(*) FROM level1_points l1 WHERE l1.module_id = m.id) as level1_count
      FROM modules m
      LEFT JOIN case_libraries cl ON m.library_id = cl.id
      ${whereClause}
      ORDER BY cl.name, m.order_index, m.name
    `, params);
    
    if (modules.length === 0) {
      return res.json({ success: false, message: '没有可导出的模块数据' });
    }
    
    const headers = ['用例库名称', '模块名称', '排序索引', '一级测试点数量'];
    const data = modules.map(m => [
      m.library_name || '',
      m.module_name || '',
      m.order_index || 0,
      m.level1_count || 0
    ]);
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    XLSX.utils.book_append_sheet(wb, ws, '模块结构');
    
    const fileName = `模块结构_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error) {
    console.error('[导出模块结构] 错误:', error);
    res.json({ success: false, message: '导出失败: ' + error.message });
  }
}

/**
 * GET /api/excel/export
 * 导出测试用例到Excel
 */
router.get('/export', async (req, res) => {
  try {
    const { libraryId, moduleIds, moduleId, status, includeLevel1, includeCases } = req.query;
    
    console.log('[导出] 接收到的参数:', { libraryId, moduleIds, moduleId, status, includeLevel1, includeCases });
    
    // 解析参数
    const shouldIncludeLevel1 = includeLevel1 !== 'false';
    const shouldIncludeCases = includeCases !== 'false';
    
    console.log('[导出] 解析后的开关:', { shouldIncludeLevel1, shouldIncludeCases });
    
    // 如果不需要导出用例，只导出模块结构
    if (!shouldIncludeCases) {
      return await exportModuleStructure(req, res, libraryId, moduleIds, moduleId);
    }
    
    let whereClause = 'WHERE tc.is_deleted = 0';
    const params = [];
    
    if (libraryId) {
      whereClause += ' AND tc.library_id = ?';
      params.push(libraryId);
    }
    if (moduleIds) {
      console.log('[导出] 解析moduleIds:', moduleIds);
      const ids = moduleIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
      console.log('[导出] 解析后的ids:', ids);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        whereClause += ` AND tc.module_id IN (${placeholders})`;
        params.push(...ids);
        console.log('[导出] 添加模块过滤条件, ids:', ids);
      } else {
        console.warn('[导出] moduleIds参数存在但解析失败:', moduleIds);
        return res.json({ success: false, message: '模块ID参数格式错误' });
      }
    }
    if (moduleId) {
      whereClause += ' AND tc.module_id = ?';
      params.push(moduleId);
    }
    if (status) {
      whereClause += ' AND tc.status = ?';
      params.push(status);
    }
    
    console.log('[导出] 最终whereClause:', whereClause);
    console.log('[导出] 最终params:', params);
    
    // 查询测试用例及其关联数据
    const [cases] = await pool.execute(`
      SELECT 
        tc.id as case_id,
        cl.name as library_name,
        m.name as module_name,
        l1.name as level1_name,
        tc.name as case_name,
        tc.priority,
        tc.type,
        tc.precondition,
        tc.purpose,
        tc.steps,
        tc.expected,
        tc.owner,
        tc.status,
        tc.key_config,
        tc.remark,
        tc.created_at
      FROM test_cases tc
      LEFT JOIN modules m ON tc.module_id = m.id
      LEFT JOIN case_libraries cl ON tc.library_id = cl.id
      LEFT JOIN level1_points l1 ON tc.level1_id = l1.id
      ${whereClause}
      ORDER BY cl.name, m.name, l1.name, tc.id
    `, params);
    
    if (cases.length === 0) {
      return res.json({ success: false, message: '没有可导出的数据' });
    }
    
    // 获取用例ID列表
    const caseIds = cases.map(c => c.case_id);
    
    // 批量查询多对多关联数据
    const [environments] = await pool.execute(`
      SELECT tce.test_case_id, e.name as environment_name
      FROM test_case_environments tce
      JOIN environments e ON tce.environment_id = e.id
      WHERE tce.test_case_id IN (${caseIds.map(() => '?').join(',')})
    `, caseIds);
    
    const [methods] = await pool.execute(`
      SELECT tcm.test_case_id, tm.name as method_name
      FROM test_case_methods tcm
      JOIN test_methods tm ON tcm.method_id = tm.id
      WHERE tcm.test_case_id IN (${caseIds.map(() => '?').join(',')})
    `, caseIds);
    
    const [phases] = await pool.execute(`
      SELECT tcp.test_case_id, tp.name as phase_name
      FROM test_case_phases tcp
      JOIN test_phases tp ON tcp.phase_id = tp.id
      WHERE tcp.test_case_id IN (${caseIds.map(() => '?').join(',')})
    `, caseIds);
    
    const [types] = await pool.execute(`
      SELECT tct.test_case_id, tt.name as type_name
      FROM test_case_test_types tct
      JOIN test_types tt ON tct.type_id = tt.id
      WHERE tct.test_case_id IN (${caseIds.map(() => '?').join(',')})
    `, caseIds);
    
    // 构建关联数据映射
    const envMap = {};
    environments.forEach(e => {
      if (!envMap[e.test_case_id]) envMap[e.test_case_id] = [];
      envMap[e.test_case_id].push(e.environment_name);
    });
    
    const methodMap = {};
    methods.forEach(m => {
      if (!methodMap[m.test_case_id]) methodMap[m.test_case_id] = [];
      methodMap[m.test_case_id].push(m.method_name);
    });
    
    const phaseMap = {};
    phases.forEach(p => {
      if (!phaseMap[p.test_case_id]) phaseMap[p.test_case_id] = [];
      phaseMap[p.test_case_id].push(p.phase_name);
    });
    
    const typeMap = {};
    types.forEach(t => {
      if (!typeMap[t.test_case_id]) typeMap[t.test_case_id] = [];
      typeMap[t.test_case_id].push(t.type_name);
    });
    
    const headers = [
      '用例库名称', '模块名称', '一级测试点', '用例名称', '优先级', '用例类型',
      '前置条件', '测试目的', '测试步骤', '预期结果', '执行人', '维护状态',
      '测试环境', '测试方式', '测试阶段', '测试类型',
      '关键配置', '备注', '创建时间'
    ];
    
    const data = cases.map(c => [
      c.library_name || '',
      c.module_name || '',
      shouldIncludeLevel1 ? (c.level1_name || '') : '',
      c.case_name || '',
      c.priority || '',
      c.type || '',
      c.precondition || '',
      c.purpose || '',
      c.steps || '',
      c.expected || '',
      c.owner || '',
      c.status || '',  // 维护状态
      (envMap[c.case_id] || []).join(', '),
      (methodMap[c.case_id] || []).join(', '),
      (phaseMap[c.case_id] || []).join(', '),
      (typeMap[c.case_id] || []).join(', '),
      c.key_config || '',
      c.remark || '',
      c.created_at ? new Date(c.created_at).toLocaleString('zh-CN') : ''
    ]);
    
    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    
    // 设置列宽
    ws['!cols'] = [
      { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 30 }, { wch: 10 }, { wch: 15 },
      { wch: 30 }, { wch: 30 }, { wch: 40 }, { wch: 30 }, { wch: 15 }, { wch: 12 },
      { wch: 20 }, { wch: 30 }, { wch: 20 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, '测试用例');
    
    // 生成Buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // 设置响应头
    const filename = `测试用例导出_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', buffer.length);
    
    res.send(buffer);
    
  } catch (error) {
    console.error('导出Excel错误:', error);
    res.json({ success: false, message: '导出失败: ' + error.message });
  }
});

/**
 * POST /api/excel/import/parse-headers
 * 解析Excel表头
 */
router.post('/import/parse-headers', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, message: '请上传文件' });
    }
    
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // 获取表头（第一行）
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headers = [];
    
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      const cell = sheet[cellAddress];
      headers.push(cell ? String(cell.v).trim() : `列${col + 1}`);
    }
    
    // 保存文件路径供后续使用
    const fileInfo = {
      path: req.file.path,
      originalName: req.file.originalname,
      sheetName,
      totalRows: range.e.r
    };
    
    res.json({
      success: true,
      data: {
        headers,
        systemFields: SYSTEM_FIELDS,
        fileInfo,
        totalRows: range.e.r
      }
    });
    
  } catch (error) {
    console.error('解析Excel表头错误:', error);
    res.json({ success: false, message: '解析文件失败: ' + error.message });
  }
});

/**
 * POST /api/excel/import/execute
 * 执行导入
 */
router.post('/import/execute', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { filePath, mapping, libraryId, createMissingModules, createMissingLevel1 } = req.body;
    
    if (!filePath || !mapping || !libraryId) {
      return res.json({ success: false, message: '缺少必要参数' });
    }
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return res.json({ success: false, message: '文件不存在，请重新上传' });
    }
    
    // 读取Excel数据
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    if (jsonData.length < 2) {
      return res.json({ success: false, message: 'Excel文件没有数据行' });
    }
    
    // 获取表头和数据行
    const headers = jsonData[0];
    const dataRows = jsonData.slice(1);
    
    // 构建字段索引映射
    const fieldIndexMap = {};
    for (const [systemField, excelColumn] of Object.entries(mapping)) {
      if (excelColumn) {
        const colIndex = headers.findIndex(h => String(h).trim() === excelColumn);
        if (colIndex !== -1) {
          fieldIndexMap[systemField] = colIndex;
        }
      }
    }
    
    // 检查必填字段
    const missingRequired = SYSTEM_FIELDS
      .filter(f => f.required && fieldIndexMap[f.key] === undefined)
      .map(f => f.label);
    
    if (missingRequired.length > 0) {
      return res.json({ 
        success: false, 
        message: `缺少必填字段映射: ${missingRequired.join(', ')}` 
      });
    }
    
    await connection.beginTransaction();
    
    // 预加载模块和测试点
    const [existingModules] = await connection.execute(
      'SELECT id, name FROM modules WHERE library_id = ?',
      [libraryId]
    );
    const moduleMap = new Map(existingModules.map(m => [m.name, m.id]));
    
    const [existingLevel1] = await connection.execute(
      'SELECT l1.id, l1.name, l1.module_id FROM level1_points l1 ' +
      'JOIN modules m ON l1.module_id = m.id WHERE m.library_id = ?',
      [libraryId]
    );
    const level1Map = new Map();
    existingLevel1.forEach(l1 => {
      level1Map.set(`${l1.module_id}-${l1.name}`, l1.id);
    });

    // 预加载已有的测试用例名称集合，避免循环中频繁查库判断重复
    const [existingTestCases] = await connection.execute(
      'SELECT name, module_id FROM test_cases WHERE library_id = ? AND is_deleted = 0',
      [libraryId]
    );
    const caseNameModuleSet = new Set(existingTestCases.map(tc => `${tc.module_id}-${tc.name}`));
    
    // 预加载所有字典表 (环境, 阶段, 方式, 类型)
    const [envRows] = await connection.execute('SELECT id, name FROM environments');
    const envMap = new Map(envRows.map(r => [r.name.trim(), r.id]));
    
    const [phaseRows] = await connection.execute('SELECT id, name FROM test_phases');
    const phaseMap = new Map(phaseRows.map(r => [r.name.trim(), r.id]));
    
    const [methodRows] = await connection.execute('SELECT id, name FROM test_methods');
    const methodMap = new Map(methodRows.map(r => [r.name.trim(), r.id]));
    
    const [typeRows] = await connection.execute('SELECT id, name FROM test_types');
    const typeMap = new Map(typeRows.map(r => [r.name.trim(), r.id]));

    // 辅助函数：根据名称列表（逗号分隔）获取对应的字典ID数组
    const parseMapIds = (namesStr, mapData) => {
      if (!namesStr) return [];
      return namesStr.split(/[,,|]/) // 兼容中英文逗号或竖线
        .map(n => n.trim())
        .filter(n => n)
        .map(n => mapData.get(n))
        .filter(id => id !== undefined);
    };

    // 统计
    let successCount = 0;
    let skipCount = 0;
    const errors = [];
    
    // 批量插入优化：收集所有待插入的数据
    const casesToInsert = [];
    const batchSize = 100; // 每批插入100条
    
    // 处理每一行数据（仅收集数据， 不执行插入）
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      
      try {
        // 提取字段值
        const getValue = (field) => {
          const idx = fieldIndexMap[field];
          return idx !== undefined ? String(row[idx] || '').trim() : '';
        };
        
        const caseName = getValue('name');
        const moduleName = getValue('module_name');
        const level1Name = getValue('level1_name');
        
        if (!caseName || !moduleName) {
          skipCount++;
          continue;
        }
        
        // 获取或创建模块
        let moduleId = moduleMap.get(moduleName);
        if (!moduleId && createMissingModules) {
          const [moduleResult] = await connection.execute(
            'INSERT INTO modules (module_id, name, library_id, order_index) VALUES (?, ?, ?, ?)',
            ['MODULE_' + Date.now() + '_' + Math.floor(Math.random() * 10000), moduleName, libraryId, moduleMap.size]
          );
          moduleId = moduleResult.insertId;
          moduleMap.set(moduleName, moduleId);
        } else if (!moduleId) {
          errors.push(`第${rowNum}行: 模块"${moduleName}"不存在`);
          skipCount++;
          continue;
        }
        
        // 获取或创建一级测试点
        let level1Id = null;
        if (level1Name) {
          level1Id = level1Map.get(`${moduleId}-${level1Name}`);
          if (!level1Id && createMissingLevel1) {
            const [level1Result] = await connection.execute(
              'INSERT INTO level1_points (module_id, name, test_type, order_index) VALUES (?, ?, ?, ?)',
              [moduleId, level1Name, '功能测试', level1Map.size]
            );
            level1Id = level1Result.insertId;
            level1Map.set(`${moduleId}-${level1Name}`, level1Id);
          }
        }
        
        // 检查用例名称是否重复 (纯内存操作，极速)
        const caseSignature = `${moduleId}-${caseName}`;
        if (caseNameModuleSet.has(caseSignature)) {
          errors.push(`第${rowNum}行: 用例名称"${caseName}"在模块中已存在`);
          skipCount++;
          continue;
        }
        caseNameModuleSet.add(caseSignature);
        
        // 收集待插入数据及多对多关联缓存
        casesToInsert.push({
          caseId: 'CASE-' + Date.now() + '-' + Math.floor(Math.random() * 10000) + '-' + i, // 加上循环索引防止同时生成冲突
          caseName,
          priority: getValue('priority') || 'P2',
          type: getValue('type') || '功能测试',
          precondition: getValue('precondition'),
          purpose: getValue('purpose'),
          steps: getValue('steps'),
          expected: getValue('expected'),
          owner: getValue('owner') || null,
          status: getValue('status') || '维护中',
          key_config: getValue('key_config'),
          remark: getValue('remark'),
          libraryId,
          moduleId,
          level1Id,
          creator: req.user?.username || 'import',
          // 保留M2M ID列表用于后续二次插入
          environmentIds: parseMapIds(getValue('environment'), envMap),
          phaseIds: parseMapIds(getValue('phase'), phaseMap),
          methodIds: parseMapIds(getValue('method'), methodMap),
          typeIds: parseMapIds(getValue('type'), typeMap) // 这个type有时既填名称也用来做多对多
        });
        
      } catch (rowError) {
        errors.push(`第${rowNum}行: ${rowError.message}`);
        skipCount++;
      }
    }
    
    // 批量插入测试用例（分批提交， 避免长事务）
    for (let i = 0; i < casesToInsert.length; i += batchSize) {
      const batch = casesToInsert.slice(i, i + batchSize);
      
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      // 移除原有的bug_id和method直接插入
      const values = batch.flatMap(c => [
        c.caseId, c.caseName, c.priority, c.type, c.precondition, c.purpose,
        c.steps, c.expected, c.owner, c.status, c.key_config, c.remark,
        c.libraryId, c.moduleId, c.level1Id, c.creator
      ]);
      
      await connection.execute(
        `INSERT INTO test_cases (
          case_id, name, priority, type, precondition, purpose,
          steps, expected, owner, status, key_config, remark,
           library_id, module_id, level1_id, creator
        ) VALUES ${placeholders}`,
        values
      );

      // 获取刚才写入的 test_case 的自增ID以便关联插入外键表
      const batchCaseIds = batch.map(c => c.caseId);
      const idPlaceholders = batchCaseIds.map(() => '?').join(',');
      const [insertedRows] = await connection.execute(
        `SELECT id, case_id FROM test_cases WHERE case_id IN (${idPlaceholders})`,
        batchCaseIds
      );
      
      // 构造M2M的批量插入数据
      const envInserts = [];
      const phaseInserts = [];
      const methodInserts = [];
      const typeInserts = [];
      
      insertedRows.forEach(dbRow => {
        // 从内存里匹配回来原始数据对象
        const memoryObj = batch.find(b => b.caseId === dbRow.case_id);
        if (memoryObj) {
          if (memoryObj.environmentIds.length) {
            memoryObj.environmentIds.forEach(eid => envInserts.push([dbRow.id, eid]));
          }
          if (memoryObj.phaseIds.length) {
            memoryObj.phaseIds.forEach(pid => phaseInserts.push([dbRow.id, pid]));
          }
          if (memoryObj.methodIds.length) {
            memoryObj.methodIds.forEach(mid => methodInserts.push([dbRow.id, mid]));
          }
          if (memoryObj.typeIds.length) {
            memoryObj.typeIds.forEach(tid => typeInserts.push([dbRow.id, tid]));
          }
        }
      });
      
      // 批量插入M2M关系表
      if (envInserts.length > 0) {
        await connection.execute(
          `INSERT INTO test_case_environments (test_case_id, environment_id) VALUES ${envInserts.map(() => '(?, ?)').join(', ')}`,
          envInserts.flat()
        );
      }
      if (phaseInserts.length > 0) {
        await connection.execute(
          `INSERT INTO test_case_phases (test_case_id, phase_id) VALUES ${phaseInserts.map(() => '(?, ?)').join(', ')}`,
          phaseInserts.flat()
        );
      }
      if (methodInserts.length > 0) {
        await connection.execute(
          `INSERT INTO test_case_methods (test_case_id, method_id) VALUES ${methodInserts.map(() => '(?, ?)').join(', ')}`,
          methodInserts.flat()
        );
      }
      if (typeInserts.length > 0) {
        await connection.execute(
          `INSERT INTO test_case_test_types (test_case_id, type_id) VALUES ${typeInserts.map(() => '(?, ?)').join(', ')}`,
          typeInserts.flat()
        );
      }
      
      successCount += batch.length;
    }
    
    await connection.commit();
    
    // 删除临时文件
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('删除临时文件失败:', e.message);
    }
    
    res.json({
      success: true,
      message: `导入完成: 成功${successCount}条, 跳过${skipCount}条`,
      data: {
        successCount,
        skipCount,
        errors: errors.slice(0, 20)
      }
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('导入Excel错误:', error);
    res.json({ success: false, message: '导入失败: ' + error.message });
  } finally {
    connection.release();
  }
});

/**
 * GET /api/excel/template
 * 下载导入模板
 */
router.get('/template', (req, res) => {
  try {
    const headers = [
      '模块名称', '一级测试点', '用例名称', '优先级', '用例类型',
      '前置条件', '测试目的', '测试步骤', '预期结果', '执行人', '执行状态',
      '关键配置', '备注'
    ];
    
    const exampleData = [
      ['用户管理模块', '登录功能', '验证用户名密码正确登录', 'P1', '功能测试',
       '1. 系统已启动\n2. 数据库已连接', '验证登录功能正常', 
       '1. 打开登录页面\n2. 输入用户名admin\n3. 输入密码123456\n4. 点击登录按钮',
       '登录成功，跳转到首页', '张三', '维护中', '', ''],
      ['用户管理模块', '登录功能', '验证密码错误提示', 'P2', '功能测试',
       '1. 系统已启动', '验证密码错误时的提示信息',
       '1. 打开登录页面\n2. 输入正确用户名\n3. 输入错误密码\n4. 点击登录',
       '显示"密码错误"提示', '李四', '未执行', '', '']
    ];
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleData]);
    
    ws['!cols'] = [
      { wch: 20 }, { wch: 20 }, { wch: 30 }, { wch: 10 }, { wch: 15 },
      { wch: 30 }, { wch: 30 }, { wch: 40 }, { wch: 30 }, { wch: 15 }, { wch: 12 },
      { wch: 20 }, { wch: 30 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, '测试用例导入模板');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    const filename = encodeURIComponent('测试用例导入模板.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buffer);
    
  } catch (error) {
    console.error('生成模板错误:', error);
    res.json({ success: false, message: '生成模板失败' });
  }
});

/**
 * DELETE /api/excel/temp/:filename
 * 清理临时文件
 */
router.delete('/temp/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../uploads/temp', filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

module.exports = router;
