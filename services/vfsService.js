const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

class VFSService {
  async buildDirectoryTree(moduleId, parentId = null, libraryId = null) {
    // 支持模块级别和用例库级别的文件树构建
    let query, params;
    if (moduleId) {
      query = `
        SELECT
          id, parent_id, name, type, file_ext, file_size,
          parse_status, chunk_count, total_tokens, created_at, updated_at,
          description, tags, is_enabled, sort_order, created_by
        FROM module_knowledge_files
        WHERE module_id = ? AND parent_id ${parentId ? '= ?' : 'IS NULL'}
          AND deleted_at IS NULL
        ORDER BY type DESC, sort_order ASC, name ASC
      `;
      params = parentId ? [moduleId, parentId] : [moduleId];
    } else if (libraryId) {
      // 用例库级别的文件夹：module_id 为 NULL，挂在 library_id 下
      query = `
        SELECT
          id, parent_id, name, type, file_ext, file_size,
          parse_status, chunk_count, total_tokens, created_at, updated_at,
          description, tags, is_enabled, sort_order, created_by
        FROM module_knowledge_files
        WHERE library_id = ? AND (module_id IS NULL OR module_id = 0)
          AND parent_id ${parentId ? '= ?' : 'IS NULL'}
          AND deleted_at IS NULL
        ORDER BY type DESC, sort_order ASC, name ASC
      `;
      params = parentId ? [libraryId, parentId] : [libraryId];
    } else {
      return [];
    }

    const [rows] = await pool.execute(query, params);

    const tree = [];
    for (const row of rows) {
      const node = {
        id: row.id,
        name: row.name,
        type: row.type,
        parseStatus: row.parse_status,
        chunkCount: row.chunk_count,
        totalTokens: row.total_tokens,
        description: row.description,
        tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
        isEnabled: row.is_enabled === 1,
        sortOrder: row.sort_order,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      if (row.type === 'folder') {
        node.children = await this.buildDirectoryTree(moduleId, row.id, libraryId);
      } else {
        node.fileExt = row.file_ext;
        node.fileSize = row.file_size;
      }

      tree.push(node);
    }

    return tree;
  }

  async createFolder(libraryId, moduleId, parentId, name, userId) {
    // libraryId 必填，moduleId 可选（为 null 时表示文件夹挂在用例库层级）
    if (!libraryId) {
      throw new Error('缺少用例库ID');
    }

    // 检查同名文件夹
    let checkQuery, checkParams;
    if (moduleId) {
      checkQuery = `
        SELECT id FROM module_knowledge_files
        WHERE module_id = ? AND parent_id ${parentId ? '= ?' : 'IS NULL'}
          AND name = ? AND type = 'folder' AND deleted_at IS NULL
      `;
      checkParams = parentId ? [moduleId, parentId, name] : [moduleId, name];
    } else {
      // 用例库层级：module_id 为 NULL
      checkQuery = `
        SELECT id FROM module_knowledge_files
        WHERE library_id = ? AND (module_id IS NULL OR module_id = 0)
          AND parent_id ${parentId ? '= ?' : 'IS NULL'}
          AND name = ? AND type = 'folder' AND deleted_at IS NULL
      `;
      checkParams = parentId ? [libraryId, parentId, name] : [libraryId, name];
    }

    const [existing] = await pool.execute(checkQuery, checkParams);

    if (existing.length > 0) {
      throw new Error('同名文件夹已存在');
    }

    const [result] = await pool.execute(`
      INSERT INTO module_knowledge_files
        (library_id, module_id, parent_id, name, type, created_by)
      VALUES (?, ?, ?, ?, 'folder', ?)
    `, [libraryId, moduleId || null, parentId || null, name, userId]);

    return result.insertId;
  }

  async uploadFile(file, moduleId, parentId, userId, libraryId) {
    const fileUuid = uuidv4();
    const fileExt = path.extname(file.originalname).slice(1).toLowerCase();
    const effectiveModuleId = moduleId || 'library_' + (libraryId || 'unknown');
    const relativePath = `knowledge/${effectiveModuleId}/${fileUuid}.${fileExt}`;
    const absolutePath = path.join(UPLOAD_DIR, relativePath);

    const dirPath = path.join(UPLOAD_DIR, 'knowledge', String(effectiveModuleId));
    await fs.mkdir(dirPath, { recursive: true });

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await fs.writeFile(absolutePath, file.buffer);

      const [result] = await connection.execute(`
        INSERT INTO module_knowledge_files
          (library_id, module_id, parent_id, name, type, file_path, file_size,
           file_ext, mime_type, created_by)
        VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)
      `, [libraryId || null, moduleId || null, parentId || null, file.originalname, relativePath,
          file.size, fileExt, file.mimetype, userId]);

      await connection.commit();

      const fileId = result.insertId;

      const FileParserService = require('./fileParserService');
      FileParserService.asyncParseFile(fileId);

      return { fileId, path: relativePath };

    } catch (error) {
      await connection.rollback();
      await fs.unlink(absolutePath).catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async handleSameNameFile(moduleId, parentId, fileName, libraryId) {
    let query, params;
    if (moduleId) {
      query = `
        SELECT id, name, created_at, chunk_count, parse_status
        FROM module_knowledge_files
        WHERE module_id = ? AND parent_id ${parentId ? '= ?' : 'IS NULL'}
          AND name = ? AND deleted_at IS NULL
      `;
      params = parentId ? [moduleId, parentId, fileName] : [moduleId, fileName];
    } else if (libraryId) {
      query = `
        SELECT id, name, created_at, chunk_count, parse_status
        FROM module_knowledge_files
        WHERE library_id = ? AND (module_id IS NULL OR module_id = 0)
          AND parent_id ${parentId ? '= ?' : 'IS NULL'}
          AND name = ? AND deleted_at IS NULL
      `;
      params = parentId ? [libraryId, parentId, fileName] : [libraryId, fileName];
    } else {
      return { hasConflict: false, existingFile: null };
    }

    const [existing] = await pool.execute(query, params);

    return {
      hasConflict: existing.length > 0,
      existingFile: existing[0] || null
    };
  }

  async overwriteFile(existingFileId, newFile, moduleId, parentId, userId, libraryId) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.execute(`
        DELETE FROM ai_material_chunks WHERE file_id = ?
      `, [existingFileId]);

      await connection.execute(`
        UPDATE module_knowledge_files
        SET deleted_at = NOW()
        WHERE id = ?
      `, [existingFileId]);

      const fileUuid = uuidv4();
      const fileExt = path.extname(newFile.originalname).slice(1).toLowerCase();
      const effectiveModuleId = moduleId || 'library_' + (libraryId || 'unknown');
      const relativePath = `knowledge/${effectiveModuleId}/${fileUuid}.${fileExt}`;
      const absolutePath = path.join(UPLOAD_DIR, relativePath);

      const dirPath = path.join(UPLOAD_DIR, 'knowledge', String(effectiveModuleId));
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(absolutePath, newFile.buffer);

      const [result] = await connection.execute(`
        INSERT INTO module_knowledge_files
          (library_id, module_id, parent_id, name, type, file_path, file_size,
           file_ext, mime_type, created_by)
        VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)
      `, [libraryId || null, moduleId || null, parentId || null, newFile.originalname, relativePath,
          newFile.size, fileExt, newFile.mimetype, userId]);

      await connection.commit();

      const FileParserService = require('./fileParserService');
      FileParserService.asyncParseFile(result.insertId);

      return { fileId: result.insertId, action: 'overwrite' };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async coexistFile(newFile, moduleId, parentId, userId, libraryId) {
    const fileUuid = uuidv4();
    const fileExt = path.extname(newFile.originalname).slice(1).toLowerCase();
    const effectiveModuleId = moduleId || 'library_' + (libraryId || 'unknown');
    const relativePath = `knowledge/${effectiveModuleId}/${fileUuid}.${fileExt}`;
    const absolutePath = path.join(UPLOAD_DIR, relativePath);

    const dirPath = path.join(UPLOAD_DIR, 'knowledge', String(effectiveModuleId));
    await fs.mkdir(dirPath, { recursive: true });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await fs.writeFile(absolutePath, newFile.buffer);

      const [result] = await connection.execute(`
        INSERT INTO module_knowledge_files
          (library_id, module_id, parent_id, name, type, file_path, file_size,
           file_ext, mime_type, created_by)
        VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)
      `, [libraryId || null, moduleId || null, parentId || null, newFile.originalname, relativePath,
          newFile.size, fileExt, newFile.mimetype, userId]);

      await connection.commit();

      const FileParserService = require('./fileParserService');
      FileParserService.asyncParseFile(result.insertId);

      return { fileId: result.insertId, action: 'coexist' };
    } catch (error) {
      await connection.rollback();
      await fs.unlink(absolutePath).catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteFile(fileId, moduleId, libraryId) {
    let query, params;
    if (moduleId) {
      query = `SELECT id, type, file_path FROM module_knowledge_files WHERE id = ? AND module_id = ? AND deleted_at IS NULL`;
      params = [fileId, moduleId];
    } else if (libraryId) {
      query = `SELECT id, type, file_path FROM module_knowledge_files WHERE id = ? AND library_id = ? AND (module_id IS NULL OR module_id = 0) AND deleted_at IS NULL`;
      params = [fileId, libraryId];
    } else {
      query = `SELECT id, type, file_path FROM module_knowledge_files WHERE id = ? AND deleted_at IS NULL`;
      params = [fileId];
    }

    const [files] = await pool.execute(query, params);

    if (files.length === 0) return false;

    const file = files[0];

    if (file.type === 'folder') {
      await this.recursiveDeleteFolder(fileId, moduleId, libraryId);
    } else {
      await pool.execute(`
        DELETE FROM ai_material_chunks WHERE file_id = ?
      `, [fileId]);

      await pool.execute(`
        UPDATE module_knowledge_files
        SET deleted_at = NOW()
        WHERE id = ?
      `, [fileId]);

      if (file.file_path) {
        const absolutePath = path.join(UPLOAD_DIR, file.file_path);
        await fs.unlink(absolutePath).catch(() => {});
      }
    }

    return true;
  }

  async recursiveDeleteFolder(folderId, moduleId, libraryId) {
    const [children] = await pool.execute(`
      SELECT id, type, file_path FROM module_knowledge_files
      WHERE parent_id = ? AND deleted_at IS NULL
    `, [folderId]);

    for (const child of children) {
      if (child.type === 'folder') {
        await this.recursiveDeleteFolder(child.id, moduleId, libraryId);
      } else {
        await pool.execute(`
          DELETE FROM ai_material_chunks WHERE file_id = ?
        `, [child.id]);

        if (child.file_path) {
          const absolutePath = path.join(UPLOAD_DIR, child.file_path);
          await fs.unlink(absolutePath).catch(() => {});
        }
      }
    }

    await pool.execute(`
      UPDATE module_knowledge_files
      SET deleted_at = NOW()
      WHERE id = ?
    `, [folderId]);
  }

  async renameFile(fileId, newName) {
    const [result] = await pool.execute(`
      UPDATE module_knowledge_files
      SET name = ?
      WHERE id = ? AND deleted_at IS NULL
    `, [newName, fileId]);

    return result.affectedRows > 0;
  }

  async moveFile(fileId, newParentId) {
    if (fileId === newParentId) return false;

    if (newParentId) {
      let currentId = newParentId;
      while (currentId) {
        if (currentId === fileId) return false;
        const [parents] = await pool.execute(`
          SELECT parent_id FROM module_knowledge_files
          WHERE id = ? AND deleted_at IS NULL
        `, [currentId]);
        currentId = parents.length > 0 ? parents[0].parent_id : null;
      }
    }

    const [result] = await pool.execute(`
      UPDATE module_knowledge_files
      SET parent_id = ?
      WHERE id = ? AND deleted_at IS NULL
    `, [newParentId || null, fileId]);

    return result.affectedRows > 0;
  }

  async getFileDetail(fileId) {
    const [files] = await pool.execute(`
      SELECT f.*,
        (SELECT COUNT(*) FROM ai_material_chunks WHERE file_id = f.id) as actual_chunk_count
      FROM module_knowledge_files f
      WHERE f.id = ? AND f.deleted_at IS NULL
    `, [fileId]);

    return files[0] || null;
  }

  async getModuleFiles(moduleId, parentId, libraryId) {
    let query, params;
    if (moduleId) {
      query = `
        SELECT f.id, f.parent_id, f.name, f.type, f.file_ext, f.file_size,
          f.parse_status, f.chunk_count, f.total_tokens, f.created_at, f.updated_at,
          f.description, f.created_by, f.sort_order, f.library_id,
          CASE WHEN f.type = 'folder' THEN (
            SELECT COUNT(*) FROM module_knowledge_files sub
            WHERE sub.parent_id = f.id AND sub.deleted_at IS NULL
          ) ELSE NULL END AS child_count
        FROM module_knowledge_files f
        WHERE f.module_id = ? AND f.parent_id ${parentId ? '= ?' : 'IS NULL'}
          AND f.deleted_at IS NULL
        ORDER BY f.type DESC, f.sort_order ASC, f.name ASC
      `;
      params = parentId ? [moduleId, parentId] : [moduleId];
    } else if (libraryId) {
      // 用例库级别的文件列表
      query = `
        SELECT f.id, f.parent_id, f.name, f.type, f.file_ext, f.file_size,
          f.parse_status, f.chunk_count, f.total_tokens, f.created_at, f.updated_at,
          f.description, f.created_by, f.sort_order, f.library_id,
          CASE WHEN f.type = 'folder' THEN (
            SELECT COUNT(*) FROM module_knowledge_files sub
            WHERE sub.parent_id = f.id AND sub.deleted_at IS NULL
          ) ELSE NULL END AS child_count
        FROM module_knowledge_files f
        WHERE f.library_id = ? AND (f.module_id IS NULL OR f.module_id = 0)
          AND f.parent_id ${parentId ? '= ?' : 'IS NULL'}
          AND f.deleted_at IS NULL
        ORDER BY f.type DESC, f.sort_order ASC, f.name ASC
      `;
      params = parentId ? [libraryId, parentId] : [libraryId];
    } else {
      return [];
    }

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  async getFilePath(fileId) {
    const [files] = await pool.execute(`
      SELECT file_path, name, file_ext FROM module_knowledge_files 
      WHERE id = ? AND deleted_at IS NULL
    `, [fileId]);

    return files[0] || null;
  }

  async updateFileDescription(fileId, description) {
    const [result] = await pool.execute(`
      UPDATE module_knowledge_files
      SET description = ?
      WHERE id = ? AND deleted_at IS NULL
    `, [description, fileId]);

    return result.affectedRows > 0;
  }

  async reorderFiles(orderedIds) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (let i = 0; i < orderedIds.length; i++) {
        await connection.execute(`
          UPDATE module_knowledge_files
          SET sort_order = ?
          WHERE id = ? AND deleted_at IS NULL
        `, [i, orderedIds[i]]);
      }
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async buildGlobalTree() {
    const [libraries] = await pool.execute(`
      SELECT id, name FROM case_libraries ORDER BY name
    `);

    const tree = [];
    for (const lib of libraries) {
      const libNode = {
        id: `lib_${lib.id}`,
        realId: lib.id,
        name: lib.name,
        type: 'library',
        children: []
      };

      // 1. 加载用例库级别的文件夹（module_id 为 NULL 的文件夹）
      const [libFolders] = await pool.execute(`
        SELECT id, name FROM module_knowledge_files
        WHERE library_id = ? AND (module_id IS NULL OR module_id = 0)
          AND parent_id IS NULL AND type = 'folder' AND deleted_at IS NULL
        ORDER BY sort_order ASC, name ASC
      `, [lib.id]);

      for (const folder of libFolders) {
        const folderNode = {
          id: `folder_${folder.id}`,
          realId: folder.id,
          name: folder.name,
          type: 'folder',
          libraryId: lib.id,
          children: await this.buildDirectoryTree(null, folder.id, lib.id)
        };
        libNode.children.push(folderNode);
      }

      // 2. 加载模块（一级测试点）
      const [modules] = await pool.execute(`
        SELECT id, name FROM modules WHERE library_id = ? ORDER BY name
      `, [lib.id]);

      for (const mod of modules) {
        const modNode = {
          id: `mod_${mod.id}`,
          realId: mod.id,
          name: mod.name,
          type: 'module',
          libraryId: lib.id,
          children: await this.buildDirectoryTree(mod.id)
        };
        libNode.children.push(modNode);
      }

      tree.push(libNode);
    }

    return tree;
  }

  async getAllFilesInFolder(folderId, moduleId, basePath = '') {
    const files = [];
    const [rows] = await pool.execute(`
      SELECT id, name, type, file_path, file_ext
      FROM module_knowledge_files
      WHERE parent_id = ? AND module_id = ? AND deleted_at IS NULL
      ORDER BY type DESC, name ASC
    `, [folderId, moduleId]);

    for (const row of rows) {
      const itemPath = basePath ? `${basePath}/${row.name}` : row.name;
      
      if (row.type === 'folder') {
        const childFiles = await this.getAllFilesInFolder(row.id, moduleId, itemPath);
        files.push(...childFiles);
      } else {
        files.push({
          id: row.id,
          name: row.name,
          filePath: row.file_path,
          fileExt: row.file_ext,
          archivePath: itemPath
        });
      }
    }

    return files;
  }

  async getAllFilesInModule(moduleId) {
    const files = [];
    const [rows] = await pool.execute(`
      SELECT id, name, type, file_path, file_ext
      FROM module_knowledge_files
      WHERE module_id = ? AND deleted_at IS NULL
      ORDER BY type DESC, name ASC
    `, [moduleId]);

    for (const row of rows) {
      if (row.type === 'folder') {
        const childFiles = await this.getAllFilesInFolder(row.id, moduleId, row.name);
        files.push(...childFiles);
      } else {
        files.push({
          id: row.id,
          name: row.name,
          filePath: row.file_path,
          fileExt: row.file_ext,
          archivePath: row.name
        });
      }
    }

    return files;
  }

  async getFolderName(folderId) {
    const [rows] = await pool.execute(`
      SELECT name FROM module_knowledge_files
      WHERE id = ? AND deleted_at IS NULL
    `, [folderId]);
    return rows[0]?.name || 'folder';
  }

  async getModuleName(moduleId) {
    const [rows] = await pool.execute(`
      SELECT name FROM modules WHERE id = ?
    `, [moduleId]);
    return rows[0]?.name || 'module';
  }

  async getModulesFileCounts(moduleIds) {
    if (!moduleIds || moduleIds.length === 0) return {};
    const placeholders = moduleIds.map(() => '?').join(',');
    const [rows] = await pool.execute(`
      SELECT module_id, COUNT(*) as file_count
      FROM module_knowledge_files
      WHERE module_id IN (${placeholders}) AND type = 'file' AND deleted_at IS NULL
      GROUP BY module_id
    `, moduleIds);
    const counts = {};
    for (const row of rows) {
      counts[row.module_id] = row.file_count;
    }
    return counts;
  }

  async getFoldersFileCounts(moduleId) {
    const [rows] = await pool.execute(`
      SELECT parent_id, COUNT(*) as file_count
      FROM module_knowledge_files
      WHERE module_id = ? AND type = 'file' AND deleted_at IS NULL AND parent_id IS NOT NULL
      GROUP BY parent_id
    `, [moduleId]);
    const counts = {};
    for (const row of rows) {
      counts[row.parent_id] = row.file_count;
    }
    return counts;
  }
}

module.exports = new VFSService();
