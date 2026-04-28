const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('../middleware');
const vfsService = require('../services/vfsService');
const fileParserService = require('../services/fileParserService');
const webCrawlerService = require('../services/webCrawlerService');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const crawlLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: '爬虫调用过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['docx', 'doc', 'xlsx', 'xls', 'pdf', 'png', 'jpg', 'jpeg', 'txt', 'md', 'drawio', 'vsdx'];
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${ext}`));
    }
  }
});

router.get('/global-tree', authenticateToken, async (req, res) => {
  try {
    const tree = await vfsService.buildGlobalTree();
    res.json({ success: true, data: tree });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/tree/:moduleId', authenticateToken, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const tree = await vfsService.buildDirectoryTree(parseInt(moduleId));
    res.json({ success: true, data: tree });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/files/:moduleId', authenticateToken, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { parentId } = req.query;
    const files = await vfsService.getModuleFiles(parseInt(moduleId), parentId ? parseInt(parentId) : null);
    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/folder', authenticateToken, async (req, res) => {
  try {
    const { moduleId, parentId, name } = req.body;
    if (!moduleId || !name) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    const folderId = await vfsService.createFolder(
      parseInt(moduleId),
      parentId ? parseInt(parentId) : null,
      name,
      req.user.username
    );
    res.json({ success: true, data: { id: folderId } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { moduleId, parentId, conflictAction } = req.body;
    if (!req.file || !moduleId) {
      return res.status(400).json({ success: false, message: '缺少文件或模块ID' });
    }

    const parsedModuleId = parseInt(moduleId);
    const parsedParentId = parentId ? parseInt(parentId) : null;

    const conflict = await vfsService.handleSameNameFile(parsedModuleId, parsedParentId, req.file.originalname);

    if (conflict.hasConflict) {
      if (conflictAction === 'overwrite') {
        const result = await vfsService.overwriteFile(
          conflict.existingFile.id, req.file, parsedModuleId, parsedParentId, req.user.username
        );
        return res.json({ success: true, data: result });
      } else if (conflictAction === 'coexist') {
        const result = await vfsService.coexistFile(req.file, parsedModuleId, parsedParentId, req.user.username);
        return res.json({ success: true, data: result });
      } else {
        return res.json({
          success: true,
          data: { hasConflict: true, existingFile: conflict.existingFile },
          message: '检测到同名文件'
        });
      }
    }

    const result = await vfsService.uploadFile(req.file, parsedModuleId, parsedParentId, req.user.username);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/upload-batch', authenticateToken, upload.array('files', 10), async (req, res) => {
  try {
    const { moduleId, parentId } = req.body;
    if (!req.files || req.files.length === 0 || !moduleId) {
      return res.status(400).json({ success: false, message: '缺少文件或模块ID' });
    }

    const results = [];
    for (const file of req.files) {
      try {
        const result = await vfsService.uploadFile(
          file, parseInt(moduleId), parentId ? parseInt(parentId) : null, req.user.username
        );
        results.push({ filename: file.originalname, ...result });
      } catch (error) {
        results.push({ filename: file.originalname, error: error.message });
      }
    }

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/file/:moduleId/:fileId', authenticateToken, async (req, res) => {
  try {
    const { moduleId, fileId } = req.params;
    const result = await vfsService.deleteFile(parseInt(fileId), parseInt(moduleId));
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/file/rename', authenticateToken, async (req, res) => {
  try {
    const { fileId, moduleId, newName } = req.body;
    const result = await vfsService.renameFile(parseInt(fileId), parseInt(moduleId), newName);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/file/move', authenticateToken, async (req, res) => {
  try {
    const { fileId, moduleId, newParentId } = req.body;
    const result = await vfsService.moveFile(parseInt(fileId), parseInt(moduleId), newParentId ? parseInt(newParentId) : null);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/file/detail/:moduleId/:fileId', authenticateToken, async (req, res) => {
  try {
    const { moduleId, fileId } = req.params;
    const detail = await vfsService.getFileDetail(parseInt(fileId), parseInt(moduleId));
    if (!detail) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    res.json({ success: true, data: detail });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/file/description', authenticateToken, async (req, res) => {
  try {
    const { fileId, moduleId, description } = req.body;
    const result = await vfsService.updateFileDescription(parseInt(fileId), parseInt(moduleId), description);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/reorder', authenticateToken, async (req, res) => {
  try {
    const { moduleId, parentId, orderedIds } = req.body;
    const result = await vfsService.reorderFiles(parseInt(moduleId), parentId, orderedIds);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/chunks/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const chunks = await fileParserService.getChunksByFile(parseInt(fileId));
    res.json({ success: true, data: chunks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/file/content/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileInfo = await vfsService.getFilePath(parseInt(fileId));
    if (!fileInfo || !fileInfo.file_path) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }

    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar', '7z'];
    const ext = (fileInfo.file_ext || '').toLowerCase();
    if (binaryExts.includes(ext)) {
      return res.json({ success: true, data: { name: fileInfo.name, ext: fileInfo.file_ext, type: 'binary', content: null } });
    }

    const filePath = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), fileInfo.file_path);
    const fs = require('fs').promises;
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      res.json({ success: true, data: { name: fileInfo.name, ext: fileInfo.file_ext, type: 'text', content } });
    } catch (e) {
      if (e.code === 'ENOENT') {
        res.status(404).json({ success: false, message: '文件不存在' });
      } else {
        res.status(500).json({ success: false, message: '无法读取文件内容' });
      }
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/reparse/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const result = await fileParserService.reparseFile(parseInt(fileId));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/crawl', authenticateToken, crawlLimiter, async (req, res) => {
  try {
    const { url, moduleId, parentId, username, password, loginUrl, loginSelectors, waitFor, selector } = req.body;

    if (!url || !moduleId) {
      return res.status(400).json({ success: false, message: '缺少URL或模块ID' });
    }

    const result = await webCrawlerService.crawlAndSaveAsKnowledge(
      url, parseInt(moduleId), parentId ? parseInt(parentId) : null,
      req.user.username,
      { username, password, loginUrl, loginSelectors, waitFor, selector }
    );

    res.json({ success: result.success, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/crawl/preview', authenticateToken, crawlLimiter, async (req, res) => {
  try {
    const { url, username, password, loginUrl, loginSelectors, waitFor, selector } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, message: '缺少URL' });
    }

    const result = await webCrawlerService.crawl(url, {
      username, password, loginUrl, loginSelectors, waitFor, selector
    });

    res.json({ success: result.success, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/download/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileInfo = await vfsService.getFilePath(parseInt(fileId));

    if (!fileInfo || !fileInfo.file_path) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }

    const filePath = path.join(UPLOAD_DIR, fileInfo.file_path);

    try {
      await fs.access(filePath);
    } catch (e) {
      return res.status(404).json({ success: false, message: '文件已被删除' });
    }

    const encodedName = encodeURIComponent(fileInfo.name);
    res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: '文件读取失败' });
      }
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

router.get('/preview/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileInfo = await vfsService.getFilePath(parseInt(fileId));

    if (!fileInfo || !fileInfo.file_path) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }

    const filePath = path.join(UPLOAD_DIR, fileInfo.file_path);
    const ext = (fileInfo.file_ext || '').toLowerCase();

    try {
      await fs.access(filePath);
    } catch (e) {
      return res.status(404).json({ success: false, message: '文件已被删除' });
    }

    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) {
      const buffer = await fs.readFile(filePath);
      const base64 = buffer.toString('base64');
      const mimeType = ext === 'jpg' ? 'jpeg' : ext;
      return res.json({
        success: true,
        data: {
          type: 'image',
          name: fileInfo.name,
          content: `data:image/${mimeType};base64,${base64}`
        }
      });
    }

    if (ext === 'pdf') {
      return res.json({
        success: true,
        data: {
          type: 'pdf',
          name: fileInfo.name,
          url: `/api/knowledge/download/${fileId}`
        }
      });
    }

    if (['txt', 'md', 'markdown'].includes(ext)) {
      const content = await fs.readFile(filePath, 'utf-8');
      return res.json({
        success: true,
        data: {
          type: ext === 'md' || ext === 'markdown' ? 'markdown' : 'text',
          name: fileInfo.name,
          content
        }
      });
    }

    if (['docx', 'doc'].includes(ext)) {
      try {
        const mammoth = require('mammoth');
        const buffer = await fs.readFile(filePath);
        const result = await mammoth.convertToHtml({ buffer });
        return res.json({
          success: true,
          data: {
            type: 'html',
            name: fileInfo.name,
            content: result.value
          }
        });
      } catch (mammothErr) {
        return res.json({
          success: true,
          data: {
            type: 'html',
            name: fileInfo.name,
            content: '<p style="color:#64748b;text-align:center;padding:40px;">Word文档预览需要安装mammoth库<br><code>npm install mammoth</code></p>'
          }
        });
      }
    }

    if (['xlsx', 'xls'].includes(ext)) {
      return res.json({
        success: true,
        data: {
          type: 'html',
          name: fileInfo.name,
          content: '<p style="color:#64748b;text-align:center;padding:40px;">Excel文件暂不支持在线预览，请下载后查看</p>'
        }
      });
    }

    return res.json({
      success: false,
      message: '该文件类型暂不支持在线预览'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/batch-download', authenticateToken, async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要下载的文件' });
    }

    if (fileIds.length === 1) {
      const fileInfo = await vfsService.getFilePath(parseInt(fileIds[0]));
      if (!fileInfo || !fileInfo.file_path) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }
      const filePath = path.join(UPLOAD_DIR, fileInfo.file_path);
      const encodedName = encodeURIComponent(fileInfo.name);
      res.setHeader('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      const fileStream = require('fs').createReadStream(filePath);
      return fileStream.pipe(res);
    }

    const Archiver = require('archiver');
    const archive = Archiver('zip', { zlib: { level: 5 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="knowledge_files_${Date.now()}.zip"`);

    archive.pipe(res);

    for (const fileId of fileIds) {
      try {
        const fileInfo = await vfsService.getFilePath(parseInt(fileId));
        if (fileInfo && fileInfo.file_path) {
          const filePath = path.join(UPLOAD_DIR, fileInfo.file_path);
          try {
            await fs.access(filePath);
            archive.file(filePath, { name: fileInfo.name });
          } catch (e) {}
        }
      } catch (e) {}
    }

    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

router.post('/file-counts', authenticateToken, async (req, res) => {
  try {
    const { moduleIds } = req.body;
    if (!Array.isArray(moduleIds) || moduleIds.length === 0) {
      return res.json({ success: true, data: {} });
    }
    const counts = await vfsService.getModulesFileCounts(moduleIds);
    res.json({ success: true, data: counts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/folder-counts/:moduleId', authenticateToken, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const counts = await vfsService.getFoldersFileCounts(parseInt(moduleId));
    res.json({ success: true, data: counts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/stats/:moduleId', authenticateToken, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const pool = require('../db');

    const [rows] = await pool.execute(`
      SELECT 
        type,
        file_ext,
        parse_status,
        COUNT(*) as count,
        SUM(file_size) as total_size
      FROM module_knowledge_files
      WHERE module_id = ? AND deleted_at IS NULL
      GROUP BY type, file_ext, parse_status
    `, [parseInt(moduleId)]);

    const stats = {
      totalFiles: 0,
      totalFolders: 0,
      totalSize: 0,
      byType: {},
      byStatus: { pending: 0, parsing: 0, parsed: 0, failed: 0 }
    };

    for (const row of rows) {
      if (row.type === 'folder') {
        stats.totalFolders += row.count;
      } else {
        stats.totalFiles += row.count;
        stats.totalSize += (row.total_size || 0);

        if (row.file_ext) {
          stats.byType[row.file_ext] = (stats.byType[row.file_ext] || 0) + row.count;
        }

        if (row.parse_status && stats.byStatus.hasOwnProperty(row.parse_status)) {
          stats.byStatus[row.parse_status] += row.count;
        }
      }
    }

    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/download-folder/:moduleId/:folderId', authenticateToken, async (req, res) => {
  try {
    const { moduleId, folderId } = req.params;
    const parsedModuleId = parseInt(moduleId);
    const parsedFolderId = parseInt(folderId);

    const folderName = await vfsService.getFolderName(parsedFolderId);
    const files = await vfsService.getAllFilesInFolder(parsedFolderId, parsedModuleId);

    if (files.length === 0) {
      return res.status(404).json({ success: false, message: '文件夹为空或不存在' });
    }

    const Archiver = require('archiver');
    const archive = Archiver('zip', { zlib: { level: 5 } });

    const encodedName = encodeURIComponent(folderName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedName}.zip"; filename*=UTF-8''${encodedName}.zip`);

    archive.pipe(res);

    for (const file of files) {
      if (file.filePath) {
        const absolutePath = path.join(UPLOAD_DIR, file.filePath);
        try {
          await fs.access(absolutePath);
          archive.file(absolutePath, { name: file.archivePath });
        } catch (e) {}
      }
    }

    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

router.get('/download-module/:moduleId', authenticateToken, async (req, res) => {
  try {
    const { moduleId } = req.params;
    const parsedModuleId = parseInt(moduleId);

    const moduleName = await vfsService.getModuleName(parsedModuleId);
    const files = await vfsService.getAllFilesInModule(parsedModuleId);

    if (files.length === 0) {
      return res.status(404).json({ success: false, message: '模块为空或不存在' });
    }

    const Archiver = require('archiver');
    const archive = Archiver('zip', { zlib: { level: 5 } });

    const encodedName = encodeURIComponent(moduleName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedName}.zip"; filename*=UTF-8''${encodedName}.zip`);

    archive.pipe(res);

    for (const file of files) {
      if (file.filePath) {
        const absolutePath = path.join(UPLOAD_DIR, file.filePath);
        try {
          await fs.access(absolutePath);
          archive.file(absolutePath, { name: file.archivePath });
        } catch (e) {}
      }
    }

    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
});

module.exports = router;
