const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');

// 配置 Multer 存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(process.cwd(), 'uploads', 'templates');
    
    // 确保目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名：时间戳-原文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'template-' + uniqueSuffix + ext);
  }
});

// 文件过滤器：只允许 .md 和 .txt 文件
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.md', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('只支持 .md 和 .txt 格式的文件'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 限制 5MB
  }
});

// 获取所有模板列表
router.get('/list', async (req, res) => {
  try {
    const [templates] = await pool.execute(
      'SELECT id, name, description, file_path, file_type, is_default, created_by, created_at, updated_at FROM report_templates ORDER BY is_default DESC, created_at DESC'
    );
    
    res.json({
      success: true,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        filePath: t.file_path,
        fileType: t.file_type,
        isDefault: t.is_default,
        createdBy: t.created_by,
        createdAt: t.created_at,
        updatedAt: t.updated_at
      }))
    });
  } catch (error) {
    console.error('获取模板列表错误:', error);
    res.status(500).json({ success: false, message: '获取模板列表失败' });
  }
});

// 获取单个模板详情
router.get('/detail/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [templates] = await pool.execute(
      'SELECT * FROM report_templates WHERE id = ?',
      [id]
    );
    
    if (templates.length === 0) {
      return res.json({ success: false, message: '模板不存在' });
    }
    
    const template = templates[0];
    
    // 读取模板内容
    let content = '';
    try {
      content = fs.readFileSync(template.file_path, 'utf8');
    } catch (e) {
      console.error('读取模板文件错误:', e);
    }
    
    res.json({
      success: true,
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        filePath: template.file_path,
        fileType: template.file_type,
        isDefault: template.is_default,
        createdBy: template.created_by,
        createdAt: template.created_at,
        updatedBy: template.updated_by,
        updatedAt: template.updated_at,
        content: content
      }
    });
  } catch (error) {
    console.error('获取模板详情错误:', error);
    res.status(500).json({ success: false, message: '获取模板详情失败' });
  }
});

// 上传新模板
router.post('/upload', upload.single('template'), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, message: '请选择要上传的文件' });
    }
    
    const { name, description, isDefault, createdBy } = req.body;
    const filePath = req.file.path;
    const fileType = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    
    // 验证必填字段
    if (!name) {
      // 删除已上传的文件
      fs.unlinkSync(filePath);
      return res.json({ success: false, message: '模板名称不能为空' });
    }
    
    // 如果设为默认，先清除其他默认
    if (isDefault === 'true' || isDefault === true) {
      await pool.execute('UPDATE report_templates SET is_default = FALSE');
    }
    
    // 插入数据库
    const [result] = await pool.execute(
      'INSERT INTO report_templates (name, description, file_path, file_type, is_default, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description || '', filePath, fileType, isDefault === 'true' || isDefault === true, createdBy || 'admin']
    );
    
    res.json({
      success: true,
      message: '模板上传成功',
      templateId: result.insertId
    });
  } catch (error) {
    console.error('上传模板错误:', error);
    // 如果上传失败，删除已上传的文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: '上传模板失败: ' + error.message });
  }
});

// 更新模板信息
router.put('/update/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    await pool.execute(
      'UPDATE report_templates SET name = ?, description = ? WHERE id = ?',
      [name, description || '', id]
    );
    
    res.json({ success: true, message: '模板更新成功' });
  } catch (error) {
    console.error('更新模板错误:', error);
    res.status(500).json({ success: false, message: '更新模板失败' });
  }
});

// 更新模板内容
router.put('/update-content/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, updatedBy } = req.body;
    
    if (content === undefined) {
      return res.json({ success: false, message: '模板内容不能为空' });
    }
    
    // 获取模板文件路径
    const [templates] = await pool.execute(
      'SELECT file_path FROM report_templates WHERE id = ?',
      [id]
    );
    
    if (templates.length === 0) {
      return res.json({ success: false, message: '模板不存在' });
    }
    
    const filePath = templates[0].file_path;
    
    // 写入新内容
    fs.writeFileSync(filePath, content, 'utf8');
    
    // 更新编辑者信息
    await pool.execute(
      'UPDATE report_templates SET updated_by = ? WHERE id = ?',
      [updatedBy || 'unknown', id]
    );
    
    res.json({ success: true, message: '模板内容更新成功' });
  } catch (error) {
    console.error('更新模板内容错误:', error);
    res.status(500).json({ success: false, message: '更新模板内容失败' });
  }
});

// 设置默认模板
router.put('/set-default/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查模板是否存在
    const [templates] = await pool.execute('SELECT id FROM report_templates WHERE id = ?', [id]);
    if (templates.length === 0) {
      return res.json({ success: false, message: '模板不存在' });
    }
    
    // 清除所有默认
    await pool.execute('UPDATE report_templates SET is_default = FALSE');
    
    // 设置新的默认
    await pool.execute('UPDATE report_templates SET is_default = TRUE WHERE id = ?', [id]);
    
    res.json({ success: true, message: '默认模板设置成功' });
  } catch (error) {
    console.error('设置默认模板错误:', error);
    res.status(500).json({ success: false, message: '设置默认模板失败' });
  }
});

// 删除模板
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 获取模板信息
    const [templates] = await pool.execute('SELECT file_path, is_default FROM report_templates WHERE id = ?', [id]);
    
    if (templates.length === 0) {
      return res.json({ success: false, message: '模板不存在' });
    }
    
    const template = templates[0];
    
    // 不允许删除默认模板
    if (template.is_default) {
      return res.json({ success: false, message: '默认模板不允许删除，请先设置其他模板为默认' });
    }
    
    // 删除文件
    if (fs.existsSync(template.file_path)) {
      fs.unlinkSync(template.file_path);
    }
    
    // 删除数据库记录
    await pool.execute('DELETE FROM report_templates WHERE id = ?', [id]);
    
    res.json({ success: true, message: '模板删除成功' });
  } catch (error) {
    console.error('删除模板错误:', error);
    res.status(500).json({ success: false, message: '删除模板失败' });
  }
});

// 获取默认模板内容（供 AI 技能调用）
router.get('/default-content', async (req, res) => {
  try {
    const [templates] = await pool.execute(
      'SELECT file_path FROM report_templates WHERE is_default = TRUE LIMIT 1'
    );
    
    if (templates.length === 0) {
      return res.json({ 
        success: false, 
        message: '未设置默认模板',
        content: getDefaultFallbackTemplate()
      });
    }
    
    const filePath = templates[0].file_path;
    
    if (!fs.existsSync(filePath)) {
      return res.json({ 
        success: false, 
        message: '模板文件不存在',
        content: getDefaultFallbackTemplate()
      });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    res.json({
      success: true,
      content: content
    });
  } catch (error) {
    console.error('获取默认模板内容错误:', error);
    res.json({ 
      success: false, 
      message: '获取模板失败',
      content: getDefaultFallbackTemplate()
    });
  }
});

// 根据 ID 获取模板内容
router.get('/content/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [templates] = await pool.execute(
      'SELECT file_path FROM report_templates WHERE id = ?',
      [id]
    );
    
    if (templates.length === 0) {
      return res.json({ 
        success: false, 
        message: '模板不存在',
        content: getDefaultFallbackTemplate()
      });
    }
    
    const filePath = templates[0].file_path;
    
    if (!fs.existsSync(filePath)) {
      return res.json({ 
        success: false, 
        message: '模板文件不存在',
        content: getDefaultFallbackTemplate()
      });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    res.json({
      success: true,
      content: content
    });
  } catch (error) {
    console.error('获取模板内容错误:', error);
    res.json({ 
      success: false, 
      message: '获取模板失败',
      content: getDefaultFallbackTemplate()
    });
  }
});

// 降级备用模板
function getDefaultFallbackTemplate() {
  return `# {{项目名称}} 测试报告

## 测试概览
- 项目名称: {{项目名称}}
- 总用例数: {{总用例数}}
- 通过率: {{通过率}}

## 详细数据
{{详细数据}}

---
*本报告由 xTest AI 自动生成*`;
}

module.exports = router;
