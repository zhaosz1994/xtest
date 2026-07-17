const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, isAdmin } = require('../middleware');
const logger = require('../services/logger');
const path = require('path');
const fs = require('fs').promises;

const VALID_FILE_TYPES = ['soul', 'user', 'tools', 'rule', 'checklist', 'examples', 'glossary', 'template', 'custom', 'ref_doc', 'kb_doc'];

const CORE_FILE_TYPES = ['soul', 'user', 'tools'];

const MULTI_INSTANCE_TYPES = ['ref_doc', 'kb_doc', 'custom', 'rule', 'checklist', 'examples', 'glossary', 'template'];

const DEFAULT_SOUL_TEMPLATE = `# AI 助手

## 身份
你是一名AI助手，专门协助测试团队完成各类任务。

## 核心原则
1. 准确性优先
2. 建设性反馈
3. 规范遵循

## 输出格式
严格按照 JSON 格式输出结果。`;

const DEFAULT_USER_TEMPLATE = `# 用户偏好

## 待处理内容
{{content}}

## 上下文
{{context}}`;

const DEFAULT_TOOLS_TEMPLATE = '[]';

router.post('/init-config-files/:agentId', authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { agentId } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    const [agents] = await connection.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    if (!userIsAdmin && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限初始化此代理的配置文件' });
    }

    const [existing] = await connection.execute(
      'SELECT file_type FROM ai_sub_agent_config_files WHERE agent_id = ?',
      [agentId]
    );
    const existingTypes = new Set(existing.map(f => f.file_type));

    await connection.beginTransaction();

    const defaultConfigs = [
      {
        file_type: 'soul',
        file_name: 'Soul.md',
        content: DEFAULT_SOUL_TEMPLATE,
        description: '灵魂文件，定义代理的身份、原则和输出格式',
        is_required: 1,
        sort_order: 1
      },
      {
        file_type: 'user',
        file_name: 'User.md',
        content: DEFAULT_USER_TEMPLATE,
        description: '用户偏好文件，定义任务模板和变量插值',
        is_required: 1,
        sort_order: 2
      },
      {
        file_type: 'tools',
        file_name: 'Tools.md',
        content: DEFAULT_TOOLS_TEMPLATE,
        description: '工具配置文件，定义代理可调用的工具列表',
        is_required: 1,
        sort_order: 3
      }
    ];

    let createdCount = 0;

    for (const config of defaultConfigs) {
      if (!existingTypes.has(config.file_type)) {
        await connection.execute(
          `INSERT INTO ai_sub_agent_config_files
            (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [agentId, config.file_type, config.file_name, config.content, config.description, config.is_required, config.sort_order, userId]
        );
        createdCount++;
      }
    }

    await connection.commit();

    logger.info('初始化默认配置文件完成', { agentId, createdCount, userId });

    res.json({ success: true, message: '默认配置文件已初始化' });
  } catch (error) {
    if (connection) await connection.rollback();
    logger.error('初始化默认配置文件失败', { error: error.message, agentId: req.params.agentId });
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: '初始化默认配置文件失败' });
    }
  } finally {
    if (connection) connection.release();
  }
});

router.post('/batch-kb/:agentId', authenticateToken, async (req, res) => {
  let connection;
  try {
    const { agentId } = req.params;
    const { file_ids } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
      return res.json({ success: false, message: '请选择至少一个知识库文件' });
    }

    if (!file_ids.every(id => Number.isInteger(id) && id > 0)) {
      return res.json({ success: false, message: 'file_ids 包含无效的ID' });
    }

    if (file_ids.length > 100) {
      return res.json({ success: false, message: '单次最多选择100个文件' });
    }

    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    if (!userIsAdmin && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限添加此代理的配置文件' });
    }

    const [kbFiles] = await pool.execute(
      `SELECT mkf.id, mkf.name, mkf.file_path, mkf.file_ext, mkf.library_id,
              cl.name AS library_name, m.name AS module_name
       FROM module_knowledge_files mkf
       LEFT JOIN case_libraries cl ON mkf.library_id = cl.id
       LEFT JOIN modules m ON mkf.module_id = m.id
       WHERE mkf.id IN (${file_ids.map(() => '?').join(',')}) AND mkf.deleted_at IS NULL AND mkf.type = 'file'`,
      file_ids
    );

    if (kbFiles.length === 0) {
      return res.json({ success: false, message: '未找到有效的知识库文件' });
    }

    const [existingKbDocs] = await pool.execute(
      'SELECT source_file_id FROM ai_sub_agent_config_files WHERE agent_id = ? AND source_type = ? AND source_file_id IS NOT NULL',
      [agentId, 'kb_doc']
    );
    const existingSourceFileIds = new Set(existingKbDocs.map(f => Number(f.source_file_id)));

    const addedFiles = [];
    const skippedFiles = [];
    const failedFiles = [];
    const fileContentsMap = new Map();

    for (const kbFile of kbFiles) {
      if (existingSourceFileIds.has(kbFile.id)) {
        skippedFiles.push({ id: kbFile.id, name: kbFile.name, reason: '已添加' });
        continue;
      }

      let fileContent = '';

      try {
        const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'pdf', 'zip', 'rar', '7z'];
        const ext = (kbFile.file_ext || '').toLowerCase();

        if (binaryExts.includes(ext)) {
          fileContent = `[二进制文件: ${kbFile.name}]`;
        } else if (kbFile.file_path) {
          const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
          const resolvedUploadDir = path.resolve(uploadDir);
          const resolvedFilePath = path.resolve(path.join(uploadDir, kbFile.file_path));
          const normalizedUploadDir = resolvedUploadDir.replace(/\\/g, '/');
          const normalizedFilePath = resolvedFilePath.replace(/\\/g, '/');
          if (!normalizedFilePath.startsWith(normalizedUploadDir + '/') && normalizedFilePath !== normalizedUploadDir) {
            failedFiles.push({ id: kbFile.id, name: kbFile.name, reason: '非法路径' });
            continue;
          }
          try {
            fileContent = await fs.readFile(resolvedFilePath, 'utf-8');
          } catch (readErr) {
            if (readErr.code === 'ENOENT') {
              failedFiles.push({ id: kbFile.id, name: kbFile.name, reason: '文件不存在' });
              continue;
            }
            logger.warn('读取知识库文件失败', { fileId: kbFile.id, error: readErr.message });
            failedFiles.push({ id: kbFile.id, name: kbFile.name, reason: '读取文件失败' });
            continue;
          }
        } else {
          const [chunks] = await pool.execute(
            'SELECT chunk_content FROM ai_material_chunks WHERE file_id = ? ORDER BY chunk_index ASC',
            [kbFile.id]
          );
          if (chunks.length > 0) {
            fileContent = chunks.map(c => c.chunk_content).join('\n\n');
          } else {
            failedFiles.push({ id: kbFile.id, name: kbFile.name, reason: '无文件内容' });
            continue;
          }
        }
      } catch (contentErr) {
        logger.warn('读取知识库文件内容失败', { fileId: kbFile.id, error: contentErr.message });
        failedFiles.push({ id: kbFile.id, name: kbFile.name, reason: '读取内容失败' });
        continue;
      }

      if (fileContent && fileContent.length > 500000) {
        fileContent = fileContent.substring(0, 500000) + '\n\n[内容过长，已截断...]';
      }

      fileContentsMap.set(kbFile.id, { fileContent, kbFile });
    }

    if (fileContentsMap.size > 0) {
      connection = await pool.getConnection();

      const [maxSortResult] = await connection.execute(
        'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM ai_sub_agent_config_files WHERE agent_id = ?',
        [agentId]
      );
      let nextSortOrder = maxSortResult[0].max_sort + 1;

      await connection.beginTransaction();

      for (const [fileId, { fileContent, kbFile }] of fileContentsMap) {
        const sourcePathParts = [kbFile.library_name || '未知用例库'];
        if (kbFile.module_name) {
          sourcePathParts.push(kbFile.module_name);
        }
        sourcePathParts.push(kbFile.name);
        const sourcePath = sourcePathParts.join(' > ');

        await connection.execute(
          `INSERT INTO ai_sub_agent_config_files
            (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by,
             source_type, source_file_id, source_library_id, source_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          [
            agentId,
            'kb_doc',
            kbFile.name,
            fileContent,
            `来自知识库: ${sourcePath}`,
            0,
            nextSortOrder,
            userId,
            'kb_doc',
            kbFile.id,
            kbFile.library_id ?? null,
            sourcePath
          ]
        );

        addedFiles.push({ id: kbFile.id, name: kbFile.name });
        nextSortOrder++;
      }

      await connection.commit();
    }

    logger.info('批量添加知识库参考文档完成', {
      agentId,
      total: file_ids.length,
      added: addedFiles.length,
      skipped: skippedFiles.length,
      failed: failedFiles.length,
      userId
    });

    res.json({
      success: true,
      data: {
        added: addedFiles,
        skipped: skippedFiles,
        failed: failedFiles,
        totalAdded: addedFiles.length
      },
      message: `已添加 ${addedFiles.length} 个知识库文档${skippedFiles.length > 0 ? `，${skippedFiles.length} 个已存在被跳过` : ''}${failedFiles.length > 0 ? `，${failedFiles.length} 个添加失败` : ''}`
    });
  } catch (error) {
    if (connection) await connection.rollback();
    logger.error('批量添加知识库参考文档失败', { error: error.message, agentId: req.params.agentId });
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: '批量添加知识库参考文档失败' });
    }
  } finally {
    if (connection) connection.release();
  }
});

router.get('/:agentId', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    if (!userIsAdmin && agent.visibility === 'private' && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限查看此代理的配置文件' });
    }

    const [configFiles] = await pool.execute(
      `SELECT id, file_type, file_name, content, description, is_required, sort_order, version,
              source_type, source_file_id, source_library_id, source_path
       FROM ai_sub_agent_config_files
       WHERE agent_id = ?
       ORDER BY sort_order ASC`,
      [agentId]
    );

    res.json({
      success: true,
      data: configFiles.map(f => ({
        id: f.id,
        file_type: f.file_type,
        file_name: f.file_name,
        content: f.content,
        description: f.description,
        is_required: f.is_required,
        sort_order: f.sort_order,
        version: f.version,
        source_type: f.source_type || 'manual',
        source_file_id: f.source_file_id || null,
        source_library_id: f.source_library_id || null,
        source_path: f.source_path || null,
        charCount: f.content ? f.content.length : 0
      }))
    });
  } catch (error) {
    logger.error('获取配置文件列表失败', { error: error.message, agentId: req.params.agentId });
    res.status(500).json({ success: false, message: '获取配置文件列表失败' });
  }
});

router.put('/:agentId/:fileType', authenticateToken, async (req, res) => {
  try {
    const { agentId, fileType } = req.params;
    const { content, description, file_id, file_name } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    if (!VALID_FILE_TYPES.includes(fileType)) {
      return res.json({ success: false, message: 'fileType无效' });
    }

    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    if (!userIsAdmin && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限修改此代理的配置文件' });
    }

    if (file_id) {
      const [existing] = await pool.execute(
        'SELECT id, version FROM ai_sub_agent_config_files WHERE id = ? AND agent_id = ?',
        [file_id, agentId]
      );

      if (existing.length === 0) {
        return res.json({ success: false, message: '配置文件不存在' });
      }

      const currentVersion = existing[0].version || 1;

      const updates = [];
      const params = [];

      if (content !== undefined) {
        updates.push('content = ?');
        params.push(content);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        params.push(description);
      }
      if (file_name !== undefined) {
        updates.push('file_name = ?');
        params.push(file_name);
      }

      updates.push('version = ?');
      params.push(currentVersion + 1);

      params.push(file_id, agentId);

      await pool.execute(
        `UPDATE ai_sub_agent_config_files SET ${updates.join(', ')} WHERE id = ? AND agent_id = ?`,
        params
      );

      logger.info('配置文件更新成功', { agentId, fileType, fileId: file_id, userId, newVersion: currentVersion + 1 });
    } else {
      const [existing] = await pool.execute(
        'SELECT id, version FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
        [agentId, fileType]
      );

      if (existing.length > 0) {
        if (MULTI_INSTANCE_TYPES.includes(fileType)) {
          return res.json({ success: false, message: '多实例类型配置文件更新必须指定 file_id' });
        }

        const currentVersion = existing[0].version || 1;

        const updates = [];
        const params = [];

        if (content !== undefined) {
          updates.push('content = ?');
          params.push(content);
        }
        if (description !== undefined) {
          updates.push('description = ?');
          params.push(description);
        }

        updates.push('version = ?');
        params.push(currentVersion + 1);

        params.push(agentId, fileType);

        await pool.execute(
          `UPDATE ai_sub_agent_config_files SET ${updates.join(', ')} WHERE agent_id = ? AND file_type = ?`,
          params
        );

        logger.info('配置文件更新成功', { agentId, fileType, userId, newVersion: currentVersion + 1 });
      } else {
        const fileName = file_name || (fileType.charAt(0).toUpperCase() + fileType.slice(1));
        await pool.execute(
          `INSERT INTO ai_sub_agent_config_files
            (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
           VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?)`,
          [
            agentId,
            fileType,
            fileName,
            content || '',
            description || '',
            userId
          ]
        );

        logger.info('配置文件创建成功(Upsert)', { agentId, fileType, userId });
      }
    }

    res.json({ success: true, message: '配置文件已更新' });
  } catch (error) {
    logger.error('更新配置文件失败', { error: error.message, agentId: req.params.agentId, fileType: req.params.fileType });
    res.status(500).json({ success: false, message: '更新配置文件失败' });
  }
});

router.post('/:agentId', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { file_type, file_name, content, description, is_required, sort_order } = req.body;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    if (!file_type || content === undefined) {
      return res.json({ success: false, message: 'file_type和content为必填项' });
    }

    if (!VALID_FILE_TYPES.includes(file_type)) {
      return res.json({
        success: false,
        message: `file_type无效，合法值为: ${VALID_FILE_TYPES.join(', ')}`
      });
    }

    if (file_type === 'kb_doc') {
      return res.json({ success: false, message: 'kb_doc 类型请使用批量知识库接口添加' });
    }

    const [agents] = await pool.execute(
      'SELECT * FROM ai_sub_agents WHERE id = ?',
      [agentId]
    );

    if (agents.length === 0) {
      return res.json({ success: false, message: '代理不存在' });
    }

    const agent = agents[0];

    if (!userIsAdmin && agent.creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限添加此代理的配置文件' });
    }

    if (!MULTI_INSTANCE_TYPES.includes(file_type)) {
      const [existing] = await pool.execute(
        'SELECT id FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
        [agentId, file_type]
      );

      if (existing.length > 0) {
        return res.json({ success: false, message: '该类型的配置文件已存在，请使用更新接口' });
      }
    }

    const [result] = await pool.execute(
      `INSERT INTO ai_sub_agent_config_files
        (agent_id, file_type, file_name, content, description, is_required, sort_order, version, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        agentId,
        file_type,
        file_name || file_type,
        content,
        description || '',
        is_required || 0,
        sort_order || 0,
        userId
      ]
    );

    logger.info('配置文件添加成功', { agentId, fileType: file_type, userId, fileId: result.insertId });

    res.json({
      success: true,
      data: { id: result.insertId }
    });
  } catch (error) {
    logger.error('添加配置文件失败', { error: error.message, agentId: req.params.agentId });
    if (error.code === 'ER_DUP_ENTRY') {
      return res.json({ success: false, message: '该类型的配置文件已存在' });
    }
    res.status(500).json({ success: false, message: '添加配置文件失败' });
  }
});

router.delete('/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const userIsAdmin = isAdmin(req.user);

    const [files] = await pool.execute(
      'SELECT cf.*, a.creator_id AS agent_creator_id FROM ai_sub_agent_config_files cf JOIN ai_sub_agents a ON cf.agent_id = a.id WHERE cf.id = ?',
      [fileId]
    );

    if (files.length === 0) {
      return res.json({ success: false, message: '配置文件不存在' });
    }

    const file = files[0];

    if (CORE_FILE_TYPES.includes(file.file_type)) {
      return res.json({ success: false, message: 'soul/user/tools 类型的核心配置文件不允许删除' });
    }

    if (!userIsAdmin && file.agent_creator_id !== userId) {
      return res.status(403).json({ success: false, message: '您没有权限删除此配置文件' });
    }

    await pool.execute(
      'DELETE FROM ai_sub_agent_config_files WHERE id = ?',
      [fileId]
    );

    logger.info('配置文件删除成功', { fileId, fileType: file.file_type, userId });

    res.json({ success: true, message: '配置文件已删除' });
  } catch (error) {
    logger.error('删除配置文件失败', { error: error.message, fileId: req.params.fileId });
    res.status(500).json({ success: false, message: '删除配置文件失败' });
  }
});

module.exports = router;
