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
    this.registerUserAITimeoutConfigMigration();
    this.registerAISubAgentPlatformV2Migration();
    
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

  async tableExists(tableName) {
    try {
      const [rows] = await pool.query(
        "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
        [tableName]
      );
      return rows[0].count > 0;
    } catch (error) {
      logger.error(`[数据库迁移] 检查表失败: ${tableName}`, error.message);
      return false;
    }
  }

  registerAISubAgentPlatformV2Migration() {
    this.registerMigration('ai_sub_agent_platform_v2_fields', async () => {
      console.log('  检查 AI Sub-Agent Platform V2 表结构...');

      let fixedCount = 0;
      let allExist = true;

      const aiSubAgentsFields = [
        { name: 'agent_type', def: "ENUM('generator','reviewer','analyzer','assistant') DEFAULT 'assistant' COMMENT '智能体类型' AFTER `category`" },
        { name: 'avatar', def: "VARCHAR(500) DEFAULT NULL COMMENT '头像URL' AFTER `description`" },
        { name: 'parent_agent_id', def: "INT DEFAULT NULL COMMENT '父Agent ID(用于Override继承)' AFTER `creator_id`" },
        { name: 'llm_model', def: "VARCHAR(100) DEFAULT NULL COMMENT '指定LLM模型(为空则用系统默认)' AFTER `parent_agent_id`" },
        { name: 'llm_temperature', def: "DECIMAL(3,2) DEFAULT 0.70 COMMENT 'LLM温度参数' AFTER `llm_model`" },
        { name: 'llm_max_tokens', def: "INT DEFAULT 4096 COMMENT 'LLM最大输出Token数' AFTER `llm_temperature`" },
        { name: 'max_retries', def: "INT DEFAULT 3 COMMENT '阶梯评审最大重试次数' AFTER `llm_max_tokens`" },
        { name: 'timeout_seconds', def: "INT DEFAULT 300 COMMENT '单次执行超时时间(秒)' AFTER `max_retries`" },
        { name: 'sort_order', def: "INT DEFAULT 0 COMMENT '排序顺序' AFTER `timeout_seconds`" },
        { name: 'version', def: "INT DEFAULT 1 COMMENT '版本号' AFTER `sort_order`" },
        { name: 'created_by', def: "INT DEFAULT NULL COMMENT '创建者ID' AFTER `version`" },
        { name: 'updated_by', def: "INT DEFAULT NULL COMMENT '更新者ID' AFTER `created_by`" }
      ];

      for (const field of aiSubAgentsFields) {
        const exists = await this.columnExists('ai_sub_agents', field.name);
        if (exists) {
          console.log(`    ✅ ai_sub_agents.${field.name} 存在`);
        } else {
          console.log(`    ⚠️ 缺失字段: ai_sub_agents.${field.name}, 正在添加...`);
          allExist = false;
          const added = await this.addColumnSafe('ai_sub_agents', field.name, field.def);
          if (added === true) {
            fixedCount++;
            console.log(`    ✅ 已添加: ai_sub_agents.${field.name}`);
          } else if (added === false) {
            return { status: 'error', message: `无法添加字段: ai_sub_agents.${field.name}` };
          }
        }
      }

      const aiMemoriesFields = [
        { name: 'memory_type', def: "ENUM('experience','correction','preference','glossary') DEFAULT 'experience' COMMENT '记忆类型' AFTER `level`" },
        { name: 'title', def: "VARCHAR(200) DEFAULT NULL COMMENT '记忆标题' AFTER `memory_type`" },
        { name: 'source', def: "ENUM('user_correction','auto_distill','manual','system') DEFAULT 'auto_distill' COMMENT '来源' AFTER `title`" },
        { name: 'relevance_score', def: "DECIMAL(5,2) DEFAULT 1.00 COMMENT '相关性分数(0-1)' AFTER `source`" },
        { name: 'access_count', def: "INT DEFAULT 0 COMMENT '被引用次数' AFTER `relevance_score`" },
        { name: 'last_accessed_at', def: "TIMESTAMP NULL DEFAULT NULL COMMENT '最后引用时间' AFTER `access_count`" },
        { name: 'is_active', def: "TINYINT(1) DEFAULT 1 COMMENT '是否激活(蒸馏后可归档)' AFTER `last_accessed_at`" },
        { name: 'token_count', def: "INT DEFAULT 0 COMMENT '预估Token数' AFTER `is_active`" },
        { name: 'version', def: "INT DEFAULT 1 COMMENT '版本号' AFTER `token_count`" },
        { name: 'created_by', def: "INT DEFAULT NULL COMMENT '创建者ID' AFTER `version`" }
      ];

      for (const field of aiMemoriesFields) {
        const exists = await this.columnExists('ai_sub_agent_memories', field.name);
        if (exists) {
          console.log(`    ✅ ai_sub_agent_memories.${field.name} 存在`);
        } else {
          console.log(`    ⚠️ 缺失字段: ai_sub_agent_memories.${field.name}, 正在添加...`);
          allExist = false;
          const added = await this.addColumnSafe('ai_sub_agent_memories', field.name, field.def);
          if (added === true) {
            fixedCount++;
            console.log(`    ✅ 已添加: ai_sub_agent_memories.${field.name}`);
          } else if (added === false) {
            return { status: 'error', message: `无法添加字段: ai_sub_agent_memories.${field.name}` };
          }
        }
      }

      const aiCustomToolsFields = [
        { name: 'category', def: "VARCHAR(50) DEFAULT 'general' COMMENT '分类' AFTER `description`" },
        { name: 'output_schema', def: "JSON DEFAULT NULL COMMENT '输出参数Schema(JSON)' AFTER `input_schema`" },
        { name: 'version', def: "INT DEFAULT 1 COMMENT '版本号' AFTER `requires_docker`" },
        { name: 'created_by', def: "INT DEFAULT NULL COMMENT '创建者ID' AFTER `version`" },
        { name: 'updated_by', def: "INT DEFAULT NULL COMMENT '更新者ID' AFTER `created_by`" }
      ];

      for (const field of aiCustomToolsFields) {
        const exists = await this.columnExists('ai_custom_tools', field.name);
        if (exists) {
          console.log(`    ✅ ai_custom_tools.${field.name} 存在`);
        } else {
          console.log(`    ⚠️ 缺失字段: ai_custom_tools.${field.name}, 正在添加...`);
          allExist = false;
          const added = await this.addColumnSafe('ai_custom_tools', field.name, field.def);
          if (added === true) {
            fixedCount++;
            console.log(`    ✅ 已添加: ai_custom_tools.${field.name}`);
          } else if (added === false) {
            return { status: 'error', message: `无法添加字段: ai_custom_tools.${field.name}` };
          }
        }
      }

      const aiReviewTasksFields = [
        { name: 'needs_human_cases', def: "INT DEFAULT 0 COMMENT '熔断需人工介入数' AFTER `modified_cases`" },
        { name: 'reflection_rounds', def: "INT DEFAULT 0 COMMENT '实际执行的反思轮数' AFTER `needs_human_cases`" }
      ];

      for (const field of aiReviewTasksFields) {
        const exists = await this.columnExists('ai_review_tasks', field.name);
        if (exists) {
          console.log(`    ✅ ai_review_tasks.${field.name} 存在`);
        } else {
          console.log(`    ⚠️ 缺失字段: ai_review_tasks.${field.name}, 正在添加...`);
          allExist = false;
          const added = await this.addColumnSafe('ai_review_tasks', field.name, field.def);
          if (added === true) {
            fixedCount++;
            console.log(`    ✅ 已添加: ai_review_tasks.${field.name}`);
          } else if (added === false) {
            return { status: 'error', message: `无法添加字段: ai_review_tasks.${field.name}` };
          }
        }
      }

      const aiReviewResultsFields = [
        { name: 'agent_id', def: "INT DEFAULT NULL COMMENT '执行的Agent ID' AFTER `temp_case_id`" },
        { name: 'reflection_history', def: "JSON DEFAULT NULL COMMENT '阶梯评审履历' AFTER `diff_detail`" },
        { name: 'final_rule_passed', def: "INT DEFAULT NULL COMMENT '最终通过的规则轮次' AFTER `reflection_history`" },
        { name: 'failed_rule', def: "INT DEFAULT NULL COMMENT '熔断的规则轮次' AFTER `final_rule_passed`" },
        { name: 'confidence_score', def: "DECIMAL(5,2) DEFAULT NULL COMMENT '置信度分数(0-100)' AFTER `failed_rule`" }
      ];

      for (const field of aiReviewResultsFields) {
        const exists = await this.columnExists('ai_review_results', field.name);
        if (exists) {
          console.log(`    ✅ ai_review_results.${field.name} 存在`);
        } else {
          console.log(`    ⚠️ 缺失字段: ai_review_results.${field.name}, 正在添加...`);
          allExist = false;
          const added = await this.addColumnSafe('ai_review_results', field.name, field.def);
          if (added === true) {
            fixedCount++;
            console.log(`    ✅ 已添加: ai_review_results.${field.name}`);
          } else if (added === false) {
            return { status: 'error', message: `无法添加字段: ai_review_results.${field.name}` };
          }
        }
      }

      const memoryChunksExists = await this.tableExists('ai_sub_agent_memory_chunks');
      if (memoryChunksExists) {
        console.log('    ✅ ai_sub_agent_memory_chunks 表存在');
      } else {
        console.log('    ⚠️ 缺失表: ai_sub_agent_memory_chunks, 正在创建...');
        allExist = false;
        try {
          await pool.query(`
            CREATE TABLE ai_sub_agent_memory_chunks (
              id INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
              memory_id INT NOT NULL COMMENT '关联的记忆ID',
              chunk_index INT NOT NULL COMMENT '分块索引',
              chunk_content TEXT NOT NULL COMMENT '分块内容',
              token_count INT DEFAULT 0 COMMENT '预估Token数',
              created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
              PRIMARY KEY (id),
              UNIQUE KEY uk_memory_chunk (memory_id, chunk_index),
              KEY idx_memory_id (memory_id),
              CONSTRAINT fk_chunk_memory FOREIGN KEY (memory_id) REFERENCES ai_sub_agent_memories (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI子智能体记忆分块表'
          `);
          fixedCount++;
          console.log('    ✅ 已创建: ai_sub_agent_memory_chunks');
        } catch (error) {
          logger.error('[数据库迁移] 创建 ai_sub_agent_memory_chunks 表失败', error.message);
          return { status: 'error', message: `无法创建表: ai_sub_agent_memory_chunks` };
        }
      }

      const toolVersionsExists = await this.tableExists('ai_tool_versions');
      if (toolVersionsExists) {
        console.log('    ✅ ai_tool_versions 表存在');
      } else {
        console.log('    ⚠️ 缺失表: ai_tool_versions, 正在创建...');
        allExist = false;
        try {
          await pool.query(`
            CREATE TABLE ai_tool_versions (
              id INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
              tool_id INT NOT NULL COMMENT '关联的工具ID',
              version INT NOT NULL COMMENT '版本号',
              execute_code LONGTEXT COMMENT '该版本的执行代码',
              input_schema JSON DEFAULT NULL COMMENT '该版本的输入Schema',
              change_note VARCHAR(500) DEFAULT NULL COMMENT '变更说明',
              created_by INT DEFAULT NULL COMMENT '创建者ID',
              created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
              PRIMARY KEY (id),
              UNIQUE KEY uk_tool_version (tool_id, version),
              KEY idx_tool_id (tool_id),
              CONSTRAINT fk_version_tool FOREIGN KEY (tool_id) REFERENCES ai_custom_tools (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI自定义工具版本表'
          `);
          fixedCount++;
          console.log('    ✅ 已创建: ai_tool_versions');
        } catch (error) {
          logger.error('[数据库迁移] 创建 ai_tool_versions 表失败', error.message);
          return { status: 'error', message: `无法创建表: ai_tool_versions` };
        }
      }

      if (allExist) {
        return { status: 'ok', message: 'AI Sub-Agent Platform V2 表结构完整' };
      } else if (fixedCount > 0) {
        return { status: 'fixed', message: `AI Sub-Agent Platform V2 已修复 ${fixedCount} 个结构问题` };
      } else {
        return { status: 'ok', message: '无需修复' };
      }
    });
  }

  registerUserAITimeoutConfigMigration() {
    this.registerMigration('users_ai_timeout_config_field', async () => {
      console.log('  检查 users 表 ai_timeout_config 字段...');

      const exists = await this.columnExists('users', 'ai_timeout_config');

      if (exists) {
        console.log('    ✅ 字段存在: ai_timeout_config');
        return { status: 'ok', message: 'ai_timeout_config 字段已存在' };
      }

      console.log('    ⚠️ 缺失字段: ai_timeout_config, 正在添加...');
      const added = await this.addColumnSafe('users', 'ai_timeout_config', "JSON DEFAULT NULL COMMENT '用户AI任务超时配置'");

      if (added === true) {
        console.log('    ✅ 已添加: ai_timeout_config');
        return { status: 'fixed', message: '已添加 ai_timeout_config 字段' };
      } else if (added === false) {
        return { status: 'error', message: '无法添加字段: ai_timeout_config' };
      }

      return { status: 'ok', message: '无需修复' };
    });
  }
}

const migrator = new DatabaseMigrator();
module.exports = migrator;
