const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const rateLimit = require('express-rate-limit');
const { authenticateToken, fixFilenameEncoding } = require('../middleware');
const vfsService = require('../services/vfsService');
const fileParserService = require('../services/fileParserService');
const webCrawlerService = require('../services/webCrawlerService');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

let libreOfficeAvailable = null;

async function checkLibreOffice() {
  if (libreOfficeAvailable !== null) return libreOfficeAvailable;
  const { execFile } = require('child_process');
  const util = require('util');
  const execFileAsync = util.promisify(execFile);
  const candidates = process.platform === 'win32'
    ? ['soffice']
    : ['libreoffice', 'soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, ['--version'], { timeout: 5000 });
      libreOfficeAvailable = cmd;
      return cmd;
    } catch { }
  }
  libreOfficeAvailable = false;
  return false;
}

async function convertToPdfViaLibreOffice(inputPath) {
  const sofficeCmd = await checkLibreOffice();
  if (!sofficeCmd) return null;
  const libre = require('libreoffice-convert');
  libre.convertAsync = require('util').promisify(libre.convert);
  const inputBuffer = await fs.readFile(inputPath);
  const pdfBuffer = await libre.convertAsync(inputBuffer, '.pdf', undefined);
  const os = require('os');
  const tmpDir = path.join(os.tmpdir(), 'xtest-preview');
  await fs.mkdir(tmpDir, { recursive: true });
  const pdfPath = path.join(tmpDir, path.basename(inputPath, path.extname(inputPath)) + '-' + Date.now() + '.pdf');
  await fs.writeFile(pdfPath, pdfBuffer);
  return pdfPath;
}

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
    const allowedExts = ['docx', 'doc', 'xlsx', 'xls', 'pdf', 'png', 'jpg', 'jpeg', 'txt', 'md', 'drawio', 'vsdx', 'pptx'];
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
    const { parentId, libraryId } = req.query;
    const files = await vfsService.getModuleFiles(
      parseInt(moduleId),
      parentId ? parseInt(parentId) : null,
      libraryId ? parseInt(libraryId) : null
    );
    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取用例库级别的文件列表（用于浏览用例库下的文件夹内容）
router.get('/library-files/:libraryId', authenticateToken, async (req, res) => {
  try {
    const { libraryId } = req.params;
    const { parentId } = req.query;
    const files = await vfsService.getModuleFiles(
      null,
      parentId ? parseInt(parentId) : null,
      parseInt(libraryId)
    );
    res.json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/folder', authenticateToken, async (req, res) => {
  try {
    const { libraryId, moduleId, parentId, name } = req.body;
    if (!libraryId || !name) {
      return res.status(400).json({ success: false, message: '缺少必要参数（libraryId 和 name 为必填）' });
    }
    const folderId = await vfsService.createFolder(
      parseInt(libraryId),
      moduleId ? parseInt(moduleId) : null,
      parentId ? parseInt(parentId) : null,
      name,
      req.user.username
    );
    res.json({ success: true, data: { id: folderId } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/upload', authenticateToken, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: '文件大小超过20MB限制' });
      }
      return res.status(400).json({ success: false, message: err.message || '文件上传失败' });
    }
    next();
  });
}, fixFilenameEncoding, async (req, res) => {
  try {
    const { moduleId, parentId, conflictAction, libraryId } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, message: '缺少文件' });
    }
    if (!moduleId && !libraryId) {
      return res.status(400).json({ success: false, message: '缺少模块ID或用例库ID' });
    }

    const parsedModuleId = moduleId ? parseInt(moduleId) : null;
    const parsedParentId = parentId ? parseInt(parentId) : null;
    const parsedLibraryId = libraryId ? parseInt(libraryId) : null;

    const conflict = await vfsService.handleSameNameFile(parsedModuleId, parsedParentId, req.file.originalname, parsedLibraryId);

    if (conflict.hasConflict) {
      if (conflictAction === 'overwrite') {
        const result = await vfsService.overwriteFile(
          conflict.existingFile.id, req.file, parsedModuleId, parsedParentId, req.user.username, parsedLibraryId
        );
    return res.json({ success: true, data: result });
      } else if (conflictAction === 'coexist') {
        const result = await vfsService.coexistFile(req.file, parsedModuleId, parsedParentId, req.user.username, parsedLibraryId);
        return res.json({ success: true, data: result });
      } else {
        return res.json({
          success: true,
          data: { hasConflict: true, existingFile: conflict.existingFile },
          message: '检测到同名文件'
        });
      }
    }

    const result = await vfsService.uploadFile(req.file, parsedModuleId, parsedParentId, req.user.username, parsedLibraryId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/upload-batch', authenticateToken, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: '文件大小超过20MB限制' });
      }
      return res.status(400).json({ success: false, message: err.message || '文件上传失败' });
    }
    next();
  });
}, fixFilenameEncoding, async (req, res) => {
  try {
    const { moduleId, parentId, libraryId } = req.body;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: '缺少文件' });
    }
    if (!moduleId && !libraryId) {
      return res.status(400).json({ success: false, message: '缺少模块ID或用例库ID' });
    }

    const parsedLibraryId = libraryId ? parseInt(libraryId) : null;

    const results = [];
    for (const file of req.files) {
      try {
        const result = await vfsService.uploadFile(
          file, parseInt(moduleId), parentId ? parseInt(parentId) : null, req.user.username, parsedLibraryId
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

router.delete('/file/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { moduleId, libraryId } = req.query;
    const result = await vfsService.deleteFile(
      parseInt(fileId),
      moduleId ? parseInt(moduleId) : null,
      libraryId ? parseInt(libraryId) : null
    );
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/file/rename', authenticateToken, async (req, res) => {
  try {
    const { fileId, newName } = req.body;
    const result = await vfsService.renameFile(parseInt(fileId), newName);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/file/move', authenticateToken, async (req, res) => {
  try {
    const { fileId, newParentId } = req.body;
    const result = await vfsService.moveFile(parseInt(fileId), newParentId ? parseInt(newParentId) : null);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/file/detail/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const detail = await vfsService.getFileDetail(parseInt(fileId));
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
    const { fileId, description } = req.body;
    const result = await vfsService.updateFileDescription(parseInt(fileId), description);
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/reorder', authenticateToken, async (req, res) => {
  try {
    const { orderedIds } = req.body;
    const result = await vfsService.reorderFiles(orderedIds);
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
    const { chunkingStrategy } = req.body || {};
    const options = {};
    if (chunkingStrategy && ['structure_aware', 'semantic', 'parent_child', 'semantic_parent_child'].includes(chunkingStrategy)) {
      options.chunkingStrategy = chunkingStrategy;
      options.userId = req.user?.id || null;
    }
    const result = await fileParserService.reparseFile(parseInt(fileId), options);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/crawl', authenticateToken, crawlLimiter, async (req, res) => {
  try {
    const { url, moduleId, parentId, libraryId, username, password, loginUrl, loginSelectors, waitFor, selector } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, message: '缺少URL' });
    }
    if (!moduleId && !libraryId) {
      return res.status(400).json({ success: false, message: '缺少模块ID或用例库ID' });
    }

    const result = await webCrawlerService.crawlAndSaveAsKnowledge(
      url, parseInt(moduleId), parentId ? parseInt(parentId) : null,
      req.user.username,
      { username, password, loginUrl, loginSelectors, waitFor, selector, libraryId: libraryId ? parseInt(libraryId) : null }
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

router.get('/preview-pdf/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileInfo = await vfsService.getFileInfo(fileId);
    if (!fileInfo) return res.status(404).json({ success: false, message: '文件不存在' });
    const filePath = path.join(UPLOAD_DIR, fileInfo.stored_name);
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    const pdfPath = await convertToPdfViaLibreOffice(filePath);
    if (!pdfPath) return res.status(500).json({ success: false, message: 'PDF转换失败，请确认LibreOffice已安装' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    const pdfBuffer = await fs.readFile(pdfPath);
    res.send(pdfBuffer);
    try { await fs.unlink(pdfPath); } catch { }
  } catch (err) {
    res.status(500).json({ success: false, message: 'PDF预览失败' });
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
        const result = await mammoth.convertToHtml({ buffer }, {
          convertImage: mammoth.images.imgElement(function(image) {
            return image.readAsBase64String().then(function(imageBuffer) {
              return {
                src: "data:" + image.contentType + ";base64," + imageBuffer
              };
            });
          })
        });
        const hasImageWarnings = result.messages.some(m =>
          /Could not find image file|Image of type.*is unlikely/i.test(m.message)
        );
        if (hasImageWarnings) {
          try {
            const pdfResult = await convertToPdfViaLibreOffice(filePath);
            if (pdfResult) {
              return res.json({
                success: true,
                data: {
                  type: 'pdf',
                  name: fileInfo.name,
                  url: `/api/knowledge/preview-pdf/${fileInfo.id}`
                }
              });
            }
          } catch (loErr) { }
        }
        return res.json({
          success: true,
          data: {
            type: 'html',
            name: fileInfo.name,
            content: result.value,
            hasImageWarnings
          }
        });
      } catch (mammothErr) {
        try {
          const pdfResult = await convertToPdfViaLibreOffice(filePath);
          if (pdfResult) {
            return res.json({
              success: true,
              data: {
                type: 'pdf',
                name: fileInfo.name,
                url: `/api/knowledge/preview-pdf/${fileInfo.id}`
              }
            });
          }
        } catch (loErr) { }
        return res.json({
          success: true,
          data: {
            type: 'html',
            name: fileInfo.name,
            content: '<p style="color:#64748b;text-align:center;padding:40px;">Word文档预览失败</p>'
          }
        });
      }
    }

    if (['xlsx', 'xls'].includes(ext)) {
      try {
        const XLSX = require('xlsx');
        const buffer = await fs.readFile(filePath);
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheets = workbook.SheetNames;
        const sheetsHtml = {};
        for (const sheetName of sheets) {
          const sheet = workbook.Sheets[sheetName];
          sheetsHtml[sheetName] = XLSX.utils.sheet_to_html(sheet, { editable: false });
        }
        return res.json({
          success: true,
          data: {
            type: 'excel',
            name: fileInfo.name,
            sheets,
            sheetsHtml,
            activeSheet: sheets[0] || ''
          }
        });
      } catch (xlsxErr) {
        return res.json({
          success: true,
          data: {
            type: 'html',
            name: fileInfo.name,
            content: '<p style="color:#64748b;text-align:center;padding:40px;">Excel文件预览失败</p>'
          }
        });
      }
    }

    if (['pptx'].includes(ext)) {
      try {
        const { PPTXInHTMLOut } = require('pptx-in-html-out');
        const buffer = await fs.readFile(filePath);
        const converter = new PPTXInHTMLOut(buffer);
        const html = await converter.toHTML();
        return res.json({
          success: true,
          data: {
            type: 'html',
            name: fileInfo.name,
            content: html
          }
        });
      } catch (pptxErr) {
        return res.json({
          success: true,
          data: {
            type: 'html',
            name: fileInfo.name,
            content: '<p style="color:#64748b;text-align:center;padding:40px;">PPT文件预览失败</p>'
          }
        });
      }
    }

    if (['vsdx', 'drawio'].includes(ext)) {
      return res.json({
        success: true,
        data: {
          type: 'html',
          name: fileInfo.name,
          content: '<p style="color:#64748b;text-align:center;padding:40px;">该文件类型暂不支持在线预览<br>请下载后使用对应软件查看</p>'
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
