const pool = require('../db');
const logger = require('./logger');

class DatabaseMigrator {
  constructor() {
    this.migrations = [];
    this.registeredMigrations = new Set();
  }

  registerMigration(name, checkAndFixFunction) {
    if (!this.registeredMigrations.has(name)) {
      this.migrations.push({ name, checkAndFixFunction });
      this.registeredMigrations.add(name);
    }
  }

  async runMigration(migration) {
    try {
      const result = await migration.checkAndFixFunction();
      return { name: migration.name, status: result.status, message: result.message };
    } catch (error) {
      logger.error(`[数据库迁移] ❌ 失败: ${migration.name}`, error.message);
      return { name: migration.name, status: 'error', error: error.message };
    }
  }

  async init() {
    this.registerAIOperationLogsMigration();
    
    logger.info('[数据库迁移] 开始检查...');
    console.log('\n🔄 数据库自动迁移检查...\n');
    
    const results = [];
    
    for (const migration of this.migrations) {
      const result = await this.runMigration(migration);
      results.push(result);
    }
    
    const fixedCount = results.filter(r => r.status === 'fixed').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    if (fixedCount > 0) {
      console.log(`\n✅ 数据库已自动修复 ${fixedCount} 个问题\n`);
    } else if (errorCount > 0) {
      console.log(`\n⚠️ 发现 ${errorCount} 个无法自动修复的问题，请手动处理\n`);
    } else {
      console.log('✅ 数据库结构正常，无需修复\n');
    }
    
    return results;
  }

  async columnExists(tableName, columnName) {
    try {
      const [rows] = await pool.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
          AND table_name = ? 
          AND column_name = ?
      `, [tableName, columnName]);
      
      return rows[0].count > 0;
    } catch (error) {
      logger.error(`[数据库迁移] 检查字段失败: ${tableName}.${columnName}`, error.message);
      return false;
    }
  }

  async addColumnSafe(tableName, columnName, definition) {
    const exists = await this.columnExists(tableName, columnName);
    
    if (!exists) {
      try {
        await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        logger.info(`[数据库迁移] 已添加字段: ${tableName}.${columnName}`);
        return true;
      } catch (error) {
        logger.error(`[数据库迁移] 添加字段失败: ${tableName}.${columnName}`, error.message);
        return false;
      }
    } else {
      return null; // 字段已存在
    }
  }

  async indexExists(tableName, indexName) {
    try {
      const [rows] = await pool.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.statistics 
        WHERE table_schema = DATABASE() 
          AND table_name = ? 
          AND index_name = ?
      `, [tableName, indexName]);
      
      return rows[0].count > 0;
    } catch (error) {
      return false;
    }
  }

  async createIndexSafe(tableName, indexName, columns) {
    const exists = await this.indexExists(tableName, indexName);
    
    if (!exists) {
      try {
        await pool.query(`CREATE INDEX ${indexName} ON ${tableName}(${columns})`);
        logger.info(`[数据库迁移] 已创建索引: ${tableName}.${indexName}`);
        return true;
      } catch (error) {
        logger.error(`[数据库迁移] 创建索引失败: ${tableName}.${indexName}`, error.message);
        return false;
      }
    }
    return null;
  }

  registerAIOperationLogsMigration() {
    this.registerMigration('ai_operation_logs_token_fields', async () => {
      console.log('  检查 ai_operation_logs 表字段...');
      
      const fields = [
        { name: 'prompt_tokens', def: 'INT DEFAULT 0 COMMENT \'提示词token数\' AFTER execution_time_ms' },
        { name: 'completion_tokens', def: 'INT DEFAULT 0 COMMENT \'完成token数\' AFTER prompt_tokens' },
        { name: 'total_tokens', def: 'INT DEFAULT 0 COMMENT \'总token数\' AFTER completion_tokens' },
        { name: 'model_name', def: 'VARCHAR(100) COMMENT \'使用的AI模型名称\' AFTER total_tokens' }
      ];
      
      let fixedCount = 0;
      let allExist = true;
      
      for (const field of fields) {
        const exists = await this.columnExists('ai_operation_logs', field.name);
        
        if (exists) {
          console.log(`    ✅ 字段存在: ${field.name}`);
        } else {
          console.log(`    ⚠️ 缺失字段: ${field.name}, 正在添加...`);
          allExist = false;
          
          const added = await this.addColumnSafe('ai_operation_logs', field.name, field.def);
          if (added === true) {
            fixedCount++;
            console.log(`    ✅ 已添加: ${field.name}`);
          } else if (added === false) {
            return { status: 'error', message: `无法添加字段: ${field.name}` };
          }
        }
      }
      
      // 创建索引
      const indexCreated = await this.createIndexSafe(
        'ai_operation_logs', 
        'idx_ai_logs_total_tokens', 
        'total_tokens'
      );
      
      if (allExist && !indexCreated) {
        return { status: 'ok', message: '所有字段和索引都已存在' };
      } else if (fixedCount > 0 || indexCreated === true) {
        return { status: 'fixed', message: `已修复 ${fixedCount} 个字段` };
      } else {
        return { status: 'ok', message: '无需修复' };
      }
    });
  }
}

const migrator = new DatabaseMigrator();
module.exports = migrator;
