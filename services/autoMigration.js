const fs = require('fs').promises;
const path = require('path');
const pool = require('../db');
const logger = require('./logger');

class AutoMigration {
    constructor() {
        this.migrationsDir = path.join(__dirname, '../migrations');
        this.initSqlPath = path.join(__dirname, '../deploy-offline/init-sql/init.sql');
    }

    async ensureMigrationsTable() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
                \`id\` int NOT NULL AUTO_INCREMENT,
                \`migration_name\` varchar(255) NOT NULL,
                \`executed_at\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                \`rollback_script\` text,
                PRIMARY KEY (\`id\`),
                UNIQUE KEY \`migration_name\` (\`migration_name\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
        `;
        
        await pool.query(createTableSQL);
        logger.info('迁移记录表已就绪');
    }

    async getExecutedMigrations() {
        try {
            const [rows] = await pool.query(
                'SELECT migration_name FROM schema_migrations ORDER BY id'
            );
            return rows.map(row => row.migration_name);
        } catch (error) {
            logger.error('获取已执行迁移列表失败', { error: error.message });
            return [];
        }
    }

    async recordMigration(migrationName, rollbackScript = null) {
        try {
            await pool.query(
                'INSERT IGNORE INTO schema_migrations (migration_name, rollback_script) VALUES (?, ?)',
                [migrationName, rollbackScript]
            );
            return true;
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                logger.info(`迁移记录已存在: ${migrationName}`);
                return true;
            }
            throw error;
        }
    }

    async executeSQLFile(filePath, migrationName) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            
            const statements = this.parseSQLStatements(content);
            
            if (statements.length === 0) {
                logger.info(`迁移文件为空或无有效SQL: ${migrationName}`);
                await this.recordMigration(migrationName);
                return { success: true, migrationName };
            }
            
            const connection = await pool.getConnection();
            
            try {
                let successCount = 0;
                let skipCount = 0;
                const errors = [];
                
                for (const statement of statements) {
                    if (!statement.trim()) continue;
                    
                    try {
                        await connection.query(statement);
                        successCount++;
                    } catch (error) {
                        if (this.isIgnorableError(error)) {
                            skipCount++;
                            logger.debug(`忽略可接受的错误: ${error.message}`);
                        } else {
                            errors.push({
                                statement: statement.substring(0, 100) + '...',
                                error: error.message
                            });
                        }
                    }
                }
                
                await this.recordMigration(migrationName);
                
                if (errors.length > 0 && successCount === 0) {
                    logger.error(`迁移执行失败: ${migrationName}`, { 
                        errors: errors.map(e => e.error).join('; ')
                    });
                    return { success: false, migrationName, error: errors.map(e => e.error).join('; ') };
                }
                
                logger.info(`迁移执行成功: ${migrationName}`, {
                    successStatements: successCount,
                    skippedStatements: skipCount,
                    errorCount: errors.length
                });
                
                return { success: true, migrationName };
                
            } catch (error) {
                throw error;
            } finally {
                connection.release();
            }
            
        } catch (error) {
            logger.error(`迁移执行失败: ${migrationName}`, { error: error.message });
            return { success: false, migrationName, error: error.message };
        }
    }

    isIgnorableError(error) {
        const ignorableCodes = [
            'ER_DUP_FIELDNAME',
            'ER_DUP_KEYNAME',
            'ER_DUP_ENTRY',
            'ER_TABLE_EXISTS_ERROR'
        ];
        
        const ignorableMessages = [
            'Duplicate column name',
            'Duplicate key name',
            'Duplicate entry',
            'Table.*already exists'
        ];
        
        if (ignorableCodes.includes(error.code)) {
            return true;
        }
        
        if (ignorableMessages.some(msg => new RegExp(msg, 'i').test(error.message))) {
            return true;
        }
        
        return false;
    }

    parseSQLStatements(content) {
        const statements = [];
        let currentStatement = '';
        let inDelimiter = false;
        let customDelimiter = ';';
        let inBlock = false;
        
        const lines = content.split('\n');
        
        for (let line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.toUpperCase().startsWith('DELIMITER ')) {
                customDelimiter = trimmedLine.substring(10).trim();
                inDelimiter = true;
                continue;
            }
            
            if (trimmedLine.startsWith('--') || trimmedLine.startsWith('/*') || trimmedLine === '') {
                continue;
            }
            
            if (trimmedLine.toUpperCase().includes('CREATE PROCEDURE') || 
                trimmedLine.toUpperCase().includes('CREATE FUNCTION') ||
                trimmedLine.toUpperCase().includes('CREATE TRIGGER')) {
                inBlock = true;
            }
            
            currentStatement += line + '\n';
            
            if (inBlock && trimmedLine.toUpperCase() === 'END') {
                inBlock = false;
                const stmt = currentStatement.trim();
                if (stmt) {
                    statements.push(stmt);
                }
                currentStatement = '';
                continue;
            }
            
            if (inDelimiter && trimmedLine.endsWith(customDelimiter)) {
                const stmt = currentStatement.slice(0, -customDelimiter.length).trim();
                if (stmt && !stmt.startsWith('DELIMITER')) {
                    statements.push(stmt);
                }
                currentStatement = '';
                inDelimiter = false;
                customDelimiter = ';';
            } else if (!inDelimiter && !inBlock && trimmedLine.endsWith(';')) {
                const stmt = currentStatement.trim();
                if (stmt) {
                    statements.push(stmt);
                }
                currentStatement = '';
            }
        }
        
        if (currentStatement.trim()) {
            statements.push(currentStatement.trim());
        }
        
        return statements.filter(s => {
            const trimmed = s.trim();
            return trimmed && 
                   !trimmed.startsWith('DELIMITER') && 
                   !trimmed.startsWith('LOCK TABLES') &&
                   !trimmed.startsWith('UNLOCK TABLES') &&
                   !trimmed.startsWith('/*!') &&
                   !trimmed.includes('SET @MYSQLDUMP_TEMP_LOG_BIN');
        });
    }

    async checkAndCreateBaseTables() {
        logger.info('检查基础表结构...');
        
        const baseTables = [
            'users', 'modules', 'test_cases', 'test_plans', 'projects',
            'environments', 'test_priorities', 'test_types', 'test_phases',
            'test_methods', 'test_sources', 'test_statuses', 'test_progresses',
            'chips', 'case_libraries', 'ai_config', 'ai_models', 'ai_skills',
            'activity_logs', 'history', 'history_snapshots'
        ];
        
        try {
            const [tables] = await pool.query(
                "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
            );
            
            const existingTables = tables.map(t => t.TABLE_NAME.toLowerCase());
            const missingTables = baseTables.filter(t => !existingTables.includes(t.toLowerCase()));
            
            if (missingTables.length > 0) {
                logger.info(`发现缺失的基础表: ${missingTables.join(', ')}`);
                return true;
            }
            
            logger.info('所有基础表已存在');
            return false;
        } catch (error) {
            logger.error('检查基础表失败', { error: error.message });
            return true;
        }
    }

    async runMigrations() {
        try {
            logger.info('开始自动数据库迁移...');
            
            await this.ensureMigrationsTable();
            
            const executedMigrations = await this.getExecutedMigrations();
            logger.info(`已执行的迁移数量: ${executedMigrations.length}`);
            
            const needsInit = await this.checkAndCreateBaseTables();
            
            if (needsInit && !executedMigrations.includes('init_base_schema')) {
                logger.info('执行基础数据库初始化...');
                const result = await this.executeSQLFile(
                    this.initSqlPath,
                    'init_base_schema'
                );
                
                if (!result.success) {
                    logger.error('基础数据库初始化失败', { error: result.error });
                    return { success: false, error: result.error };
                }
            }
            
            let migrationsDirExists = false;
            try {
                await fs.access(this.migrationsDir);
                migrationsDirExists = true;
            } catch (e) {
                logger.info('migrations 目录不存在，跳过增量迁移');
            }
            
            if (migrationsDirExists) {
                const files = await fs.readdir(this.migrationsDir);
                const sqlFiles = files
                    .filter(f => f.endsWith('.sql'))
                    .sort();
                
                logger.info(`发现 ${sqlFiles.length} 个迁移文件`);
                
                const results = [];
                for (const file of sqlFiles) {
                    const migrationName = file.replace('.sql', '');
                    
                    if (executedMigrations.includes(migrationName)) {
                        const needsRerun = await this.checkMigrationNeedsRerun(migrationName);
                        if (!needsRerun) {
                            logger.info(`跳过已执行的迁移: ${migrationName}`);
                            continue;
                        }
                        logger.info(`迁移 ${migrationName} 已记录但表缺失，重新执行...`);
                    }
                    
                    const filePath = path.join(this.migrationsDir, file);
                    const result = await this.executeSQLFile(filePath, migrationName);
                    results.push(result);
                }
                
                const failedMigrations = results.filter(r => !r.success);
                if (failedMigrations.length > 0) {
                    logger.error(`${failedMigrations.length} 个迁移执行失败`);
                    return { 
                        success: false, 
                        failedMigrations: failedMigrations.map(m => m.migrationName)
                    };
                }
                
                const successCount = results.filter(r => r.success).length;
                logger.info(`成功执行 ${successCount} 个新迁移`);
            }

            // JS 数据迁移钩子（处理纯 SQL 无法胜任的逻辑）
            await this.runDataMigrations(executedMigrations);

            logger.info('数据库迁移完成');
            return { success: true };
            
        } catch (error) {
            logger.error('数据库迁移过程出错', { 
                error: error.message, 
                stack: error.stack 
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * 检查迁移是否需要重新执行
     * 如果迁移已记录但关键表不存在，则需要重新执行
     */
    async checkMigrationNeedsRerun(migrationName) {
        const migrationTableChecks = {
            'add_ai_sub_agent_platform': ['ai_sub_agents', 'ai_custom_tools', 'ai_sub_agent_memories', 'ai_review_tasks', 'ai_review_results'],
            'add_ai_sub_agent_platform_v2': ['ai_sub_agent_memory_chunks', 'ai_tool_versions'],
            'ai_generation_system': ['module_knowledge_files', 'ai_material_chunks', 'ai_case_generation_tasks', 'temp_test_cases'],
            'add_library_id_to_knowledge_files': ['module_knowledge_files'],
            'add_ai_agent_tool_usage_logs': ['ai_agent_tool_usage_logs'],
            'add_ai_operation_logs': ['ai_operation_logs'],
            'add_ai_import_optimize': ['ai_import_optimize_tasks', 'ai_import_optimize_batches', 'ai_import_case_mapping'],
            'fix_ai_import_optimize_agent': ['ai_sub_agents'],
            '20260509_add_chunking_strategy': ['ai_material_chunks'],
            '20260509_add_global_local_architecture': ['ai_case_generation_tasks']
        };

        const migrationColumnChecks = {
            '20260509_add_chunking_strategy': [
                { table: 'ai_material_chunks', column: 'chunk_type' },
                { table: 'ai_material_chunks', column: 'parent_chunk_id' },
                { table: 'ai_material_chunks', column: 'chunking_strategy' },
                { table: 'module_knowledge_files', column: 'chunking_strategy' }
            ],
            '20260509_add_global_local_architecture': [
                { table: 'ai_case_generation_tasks', column: 'global_context' },
                { table: 'ai_case_generation_tasks', column: 'skeleton_level1_json' },
                { table: 'temp_test_cases', column: 'level1_source' }
            ]
        };

        const tablesToCheck = migrationTableChecks[migrationName];
        if (tablesToCheck && tablesToCheck.length > 0) {
            for (const tableName of tablesToCheck) {
                const exists = await this.checkTableExists(tableName);
                if (!exists) {
                    logger.info(`表 ${tableName} 不存在，迁移 ${migrationName} 需要重新执行`);
                    return true;
                }
            }
        }

        const columnsToCheck = migrationColumnChecks[migrationName];
        if (columnsToCheck && columnsToCheck.length > 0) {
            for (const col of columnsToCheck) {
                const exists = await this.checkColumnExists(col.table, col.column);
                if (!exists) {
                    logger.info(`列 ${col.table}.${col.column} 不存在，迁移 ${migrationName} 需要重新执行`);
                    return true;
                }
            }
        }

        return false;
    }

    async checkColumnExists(tableName, columnName) {
        const [rows] = await pool.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
            [tableName, columnName]
        );
        return rows.length > 0;
    }

    /**
     * JS 数据迁移钩子
     * 处理纯 SQL 无法胜任的复杂逻辑（如 JSON 解析、条件迁移等）
     * 每个迁移通过 schema_migrations 表做幂等保护，只执行一次
     */
    async runDataMigrations(executedMigrations) {
        const dataMigrations = [
            { name: 'migrate_ai_skills_to_custom_tools', fn: () => this.migrateAISkillsToCustomTools() },
            { name: 'seed_ai_sub_agents_and_memories', fn: () => this.seedAISubAgentsAndMemories() },
            { name: 'add_ai_task_notification_types', fn: () => this.addAITaskNotificationTypes() },
            { name: 'seed_default_config_files', fn: () => this.seedDefaultConfigFiles() },
            { name: 'seed_default_rule_config_files', fn: () => this.seedDefaultRuleConfigFiles() },
            { name: 'seed_ai_generation_params', fn: () => this.seedAIGenerationParams() },
            { name: 'ensure_builtin_sub_agents', fn: () => this.ensureBuiltinSubAgents() },
            { name: 'ensure_case_import_optimizer_agent', fn: () => this.ensureCaseImportOptimizerAgent() },
        ];

        for (const migration of dataMigrations) {
            if (executedMigrations.includes(migration.name)) {
                logger.info(`跳过已执行的JS数据迁移: ${migration.name}`);
                continue;
            }

            try {
                logger.info(`执行JS数据迁移: ${migration.name}`);
                const result = await migration.fn();

                if (result.success) {
                    await this.recordMigration(migration.name);
                    logger.info(`JS数据迁移成功: ${migration.name}`, { detail: result.detail || '' });
                } else {
                    logger.error(`JS数据迁移失败: ${migration.name}`, { error: result.error });
                }
            } catch (error) {
                logger.error(`JS数据迁移异常: ${migration.name}`, { error: error.message });
            }
        }
    }

    /**
     * 将 ai_skills 表数据迁移到 ai_custom_tools 表
     * - 从 definition.function.parameters 提取 input_schema
     * - execute_code → code_content
     * - 自动设置 category 和 allowed_tables
     */
    async migrateAISkillsToCustomTools() {
        try {
            // 检查源表是否存在
            const sourceExists = await this.checkTableExists('ai_skills');
            if (!sourceExists) {
                return { success: true, detail: 'ai_skills 表不存在，跳过迁移' };
            }

            // 检查目标表是否存在
            const targetExists = await this.checkTableExists('ai_custom_tools');
            if (!targetExists) {
                return { success: true, detail: 'ai_custom_tools 表不存在，跳过迁移（可能建表迁移尚未执行）' };
            }

            // 读取 ai_skills 数据
            const [skills] = await pool.query('SELECT * FROM ai_skills ORDER BY id');
            if (skills.length === 0) {
                return { success: true, detail: 'ai_skills 表为空，无需迁移' };
            }

            // 读取 ai_custom_tools 已有的 tool_name（用于跳过重复）
            const [existing] = await pool.query('SELECT tool_name FROM ai_custom_tools');
            const existingNames = new Set(existing.map(t => t.tool_name));

            let inserted = 0;
            let skipped = 0;

            for (const skill of skills) {
                if (existingNames.has(skill.name)) {
                    skipped++;
                    continue;
                }

                // 从 LLM Tool Schema 的 definition.function.parameters 提取 input_schema
                let inputSchema = null;
                if (skill.definition) {
                    try {
                        const def = typeof skill.definition === 'string'
                            ? JSON.parse(skill.definition)
                            : skill.definition;
                        if (def.function && def.function.parameters) {
                            inputSchema = JSON.stringify(def.function.parameters);
                        } else {
                            inputSchema = JSON.stringify(def);
                        }
                    } catch (e) {
                        logger.warn(`ai_skills "${skill.name}" 的 definition 解析失败，input_schema 设为 null`);
                    }
                }

                await pool.execute(
                    `INSERT INTO ai_custom_tools
                        (tool_name, display_name, description, input_schema, language, code_content,
                         is_public, is_system, is_enabled, creator_id, updater_id,
                         timeout_ms, max_memory_mb, allowed_tables, requires_docker, category)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        skill.name,
                        skill.display_name || skill.name,
                        skill.description || null,
                        inputSchema,
                        'javascript',
                        skill.execute_code || null,
                        skill.is_public !== undefined ? skill.is_public : 1,
                        skill.is_system !== undefined ? skill.is_system : 0,
                        skill.is_enabled !== undefined ? skill.is_enabled : 1,
                        skill.creator_id || null,
                        null,
                        10000,
                        128,
                        null,
                        0,
                        skill.category || 'general'
                    ]
                );

                inserted++;
            }

            // 设置合理的 category
            const categoryUpdates = [
                { name: 'query_test_statistics', category: 'statistics' },
                { name: 'query_user_tasks', category: 'task' },
                { name: 'analyze_module_coverage', category: 'analysis' },
                { name: 'generate_test_report', category: 'report' },
                { name: 'generate_test_cases', category: 'generation' },
                { name: 'generate_functional_cases', category: 'generation' },
                { name: 'generate_performance_cases', category: 'generation' },
                { name: 'generate_exception_cases', category: 'generation' }
            ];

            for (const { name, category } of categoryUpdates) {
                try {
                    await pool.execute(
                        'UPDATE ai_custom_tools SET category = ? WHERE tool_name = ? AND (category IS NULL OR category = ?)',
                        [category, name, 'general']
                    );
                } catch (e) {
                    // 忽略不存在的工具
                }
            }

            // 设置 allowed_tables 数据库访问控制
            const tableAccess = [
                { name: 'query_test_statistics', tables: JSON.stringify(['test_cases', 'test_case_projects', 'projects']) },
                { name: 'query_user_tasks', tables: JSON.stringify(['test_plans']) },
                { name: 'analyze_module_coverage', tables: JSON.stringify(['modules', 'level1_points', 'test_cases']) },
                { name: 'generate_test_report', tables: JSON.stringify(['projects', 'test_plans', 'test_plan_cases', 'report_templates']) },
                { name: 'generate_test_cases', tables: JSON.stringify(['modules', 'level1_points', 'test_cases', 'projects']) },
                { name: 'generate_functional_cases', tables: JSON.stringify(['modules', 'level1_points', 'test_cases']) },
                { name: 'generate_performance_cases', tables: JSON.stringify(['modules', 'level1_points', 'test_cases']) },
                { name: 'generate_exception_cases', tables: JSON.stringify(['modules', 'level1_points', 'test_cases']) }
            ];

            for (const { name, tables } of tableAccess) {
                try {
                    await pool.execute(
                        'UPDATE ai_custom_tools SET allowed_tables = ? WHERE tool_name = ? AND allowed_tables IS NULL',
                        [tables, name]
                    );
                } catch (e) {
                    // 忽略不存在的工具
                }
            }

            const detail = `插入 ${inserted} 条, 跳过 ${skipped} 条`;
            return { success: true, detail };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 确保 ai_sub_agents 表有基础数据 + 每个智能体都有初始记忆种子
     * - 从 ai_skills 迁移智能体（如果 ai_sub_agents 为空）
     * - 插入内置 review_test_cases 智能体（如果不存在）
     * - 为每个系统智能体插入 global 级别记忆种子
     */
    async seedAISubAgentsAndMemories() {
        try {
            const agentsExists = await this.checkTableExists('ai_sub_agents');
            if (!agentsExists) {
                return { success: true, detail: 'ai_sub_agents 表不存在，跳过' };
            }

            let detail = '';

            // 1. 从 ai_skills 迁移智能体到 ai_sub_agents（如果目标表为空且源表有数据）
            const [existingAgents] = await pool.query('SELECT COUNT(*) as cnt FROM ai_sub_agents');
            if (existingAgents[0].cnt === 0) {
                const skillsExists = await this.checkTableExists('ai_skills');
                if (skillsExists) {
                    const [skills] = await pool.query('SELECT * FROM ai_skills ORDER BY id');
                    if (skills.length > 0) {
                        for (const skill of skills) {
                            try {
                                await pool.execute(
                                    `INSERT IGNORE INTO ai_sub_agents
                                        (agent_code, display_name, description, category, is_system, allow_qa, is_enabled, creator_id, visibility, memory_enabled, memory_distill_threshold)
                                     VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'public', 1, 2000)`,
                                    [
                                        skill.name,
                                        skill.display_name || skill.name,
                                        (skill.description || '').substring(0, 255),
                                        ['test_generation', 'test_review', 'qa_assistant'].includes(skill.category) ? skill.category : 'qa_assistant',
                                        skill.is_system ? 1 : 0,
                                        skill.creator_id || null
                                    ]
                                );
                            } catch (e) {
                                logger.warn(`迁移智能体 ${skill.name} 失败: ${e.message}`);
                            }
                        }
                        detail += `从 ai_skills 迁移了 ${skills.length} 个智能体; `;
                    }
                }
            }

            // 2. 确保内置 review_test_cases 智能体存在
            const [reviewAgent] = await pool.query(
                "SELECT id FROM ai_sub_agents WHERE agent_code = 'review_test_cases' AND is_system = 1 LIMIT 1"
            );

            if (reviewAgent.length === 0) {
                const [result] = await pool.execute(
                    `INSERT INTO ai_sub_agents
                        (agent_code, display_name, description, category, is_system, allow_qa, is_enabled, visibility, memory_enabled, memory_distill_threshold)
                     VALUES ('review_test_cases', '测试用例评审', '对测试用例进行自动化评审，检查规范性、完整性、一致性和覆盖率，提供修改建议', 'test_review', 1, 1, 1, 'public', 1, 2000)`
                );
                detail += '插入内置 review_test_cases 智能体; ';
            }

            // 2.1 确保内置 generate_overview 智能体存在
            const [overviewAgent] = await pool.query(
                "SELECT id FROM ai_sub_agents WHERE agent_code = 'generate_overview' AND is_system = 1 LIMIT 1"
            );

            if (overviewAgent.length === 0) {
                const [overviewResult] = await pool.execute(
                    `INSERT INTO ai_sub_agents
                        (agent_code, display_name, description, category, is_system, allow_qa, is_enabled, visibility, memory_enabled, memory_distill_threshold)
                     VALUES ('generate_overview', '概述生成', '根据一级测试点下的测试用例内容，AI自动生成简洁的测试点概述（summary），帮助快速了解测试范围和重点', 'test_generation', 1, 0, 1, 'public', 1, 2000)`
                );
                const overviewAgentId = overviewResult.insertId;
                detail += '插入内置 generate_overview 智能体; ';
                await this._seedOverviewConfigFiles(overviewAgentId);
                detail += '插入 generate_overview 配置文件; ';
            } else {
                await this._seedOverviewConfigFiles(overviewAgent[0].id);
            }

            // 2.2 确保内置 generate_key_config 智能体存在
            const [keyConfigAgent] = await pool.query(
                "SELECT id FROM ai_sub_agents WHERE agent_code = 'generate_key_config' AND is_system = 1 LIMIT 1"
            );

            if (keyConfigAgent.length === 0) {
                const [keyConfigResult] = await pool.execute(
                    `INSERT INTO ai_sub_agents
                        (agent_code, display_name, description, category, is_system, allow_qa, is_enabled, visibility, memory_enabled, memory_distill_threshold)
                     VALUES ('generate_key_config', '关键配置生成', '根据测试用例的名称、前置条件、目的、步骤和预期结果，AI自动生成关键配置信息（命令、参数、环境变量等）', 'test_generation', 1, 0, 1, 'public', 1, 2000)`
                );
                const keyConfigAgentId = keyConfigResult.insertId;
                detail += '插入内置 generate_key_config 智能体; ';
                await this._seedKeyConfigConfigFiles(keyConfigAgentId);
                detail += '插入 generate_key_config 配置文件; ';
            } else {
                await this._seedKeyConfigConfigFiles(keyConfigAgent[0].id);
            }

            // 3. 为每个没有记忆的系统智能体，插入 global 级别记忆种子
            const memoriesExists = await this.checkTableExists('ai_sub_agent_memories');
            if (!memoriesExists) {
                return { success: true, detail: detail || 'ai_sub_agent_memories 表不存在，跳过记忆种子' };
            }

            const [systemAgents] = await pool.query(
                'SELECT id, agent_code, display_name FROM ai_sub_agents WHERE is_system = 1'
            );

            // 每个系统智能体的记忆种子
            const memorySeeds = {
                'review_test_cases': {
                    content: '## 评审基础规范\n- 用例名称必须以模块名开头\n- 预期结果必须包含具体数值或明确状态\n- 步骤编号统一使用 1. 2. 3. 格式\n- 优先级只允许：高/中/低\n- 每条用例至少覆盖1个异常场景',
                    charCount: 95
                },
                'query_test_statistics': {
                    content: '## 统计查询知识\n- 查询测试统计数据时优先使用聚合函数 COUNT/SUM\n- 通过率计算: SUM(Pass) / COUNT(*) * 100\n- 需关联 test_case_projects 表按项目筛选\n- 返回结果需包含 total, passed, passRate 三个字段',
                    charCount: 85
                },
                'query_user_tasks': {
                    content: '## 用户任务查询知识\n- 按用户名查询 test_plans 表的 owner 字段\n- 默认返回最近10条任务，按创建时间倒序\n- 返回字段: id, name, status, pass_rate\n- status 值: pending/in_progress/completed',
                    charCount: 82
                },
                'analyze_module_coverage': {
                    content: '## 模块覆盖分析知识\n- 使用 LIKE 模糊匹配模块名\n- 需关联 level1_points 和 test_cases 表\n- 计算每个模块的 level1 数量和用例数量\n- 覆盖率 = 有用例的level1数 / 总level1数',
                    charCount: 88
                },
                'generate_test_report': {
                    content: '## 报告生成知识\n- 优先使用项目名称模糊匹配查询\n- 需聚合 test_plans 和 test_plan_cases 的数据\n- 支持概要(summary)和详细(detailed)两种模式\n- 模板优先从 report_templates 表获取',
                    charCount: 88
                },
                'generate_test_cases': {
                    content: '## 用例生成知识\n- 生成前需了解模块上下文和已有用例\n- 每条用例需包含: 名称、前置条件、步骤、预期结果\n- 需覆盖正常/异常/边界三类场景\n- 优先级根据功能重要性设定',
                    charCount: 85
                },
                'generate_overview': {
                    content: '## 概述生成知识\n- 概述长度控制在50-200字\n- 概括测试点的主要测试内容和方向\n- 多个方向按重要性简要列举\n- 语言简洁专业，避免冗余\n- 优先参考该测试点下的用例实际内容',
                    charCount: 82
                },
                'generate_key_config': {
                    content: '## 关键配置生成知识\n- 关键配置包括: 命令、参数值、环境变量、数据准备、端口配置等\n- 从前置条件中提取环境要求\n- 从步骤中提取操作命令和参数\n- 格式: "配置项: 值" 或 "- 配置说明"\n- 无特殊配置时输出 "无特殊配置要求"',
                    charCount: 95
                }
            };

            let memoriesInserted = 0;
            for (const agent of systemAgents) {
                const seed = memorySeeds[agent.agent_code];
                if (!seed) continue;

                // 检查该智能体是否已有 global 记忆
                const [existing] = await pool.query(
                    'SELECT id FROM ai_sub_agent_memories WHERE agent_id = ? AND level = ? AND library_id IS NULL AND module_id IS NULL LIMIT 1',
                    [agent.id, 'global']
                );

                if (existing.length > 0) continue;

                try {
                    await pool.execute(
                        `INSERT INTO ai_sub_agent_memories (agent_id, library_id, module_id, level, content, char_count)
                         VALUES (?, NULL, NULL, 'global', ?, ?)`,
                        [agent.id, seed.content, seed.charCount]
                    );
                    memoriesInserted++;
                } catch (e) {
                    logger.warn(`插入智能体 ${agent.agent_code} 记忆种子失败: ${e.message}`);
                }
            }

            if (memoriesInserted > 0) {
                detail += `插入 ${memoriesInserted} 条记忆种子; `;
            }

            return { success: true, detail: detail || '智能体和记忆数据均已完成' };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async checkTableExists(tableName) {
        const [rows] = await pool.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
            [tableName]
        );
        return rows.length > 0;
    }

    async getMigrationStatus() {
        try {
            await this.ensureMigrationsTable();
            
            const executedMigrations = await this.getExecutedMigrations();
            
            let pendingMigrations = [];
            
            try {
                await fs.access(this.migrationsDir);
                const files = await fs.readdir(this.migrationsDir);
                const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();
                
                pendingMigrations = sqlFiles
                    .filter(f => !executedMigrations.includes(f.replace('.sql', '')))
                    .map(f => f.replace('.sql', ''));
            } catch (e) {
                // migrations 目录不存在
            }
            
            return {
                executed: executedMigrations,
                pending: pendingMigrations,
                totalExecuted: executedMigrations.length,
                totalPending: pendingMigrations.length
            };
        } catch (error) {
            logger.error('获取迁移状态失败', { error: error.message });
            throw error;
        }
    }

    async addAITaskNotificationTypes() {
        try {
            const emailTypesExists = await this.checkTableExists('email_types');
            if (!emailTypesExists) {
                return { success: true, detail: 'email_types 表不存在，跳过' };
            }

            await pool.query(`
                INSERT IGNORE INTO email_types (type_code, type_name, category, description, is_required, default_email_enabled, default_in_app_enabled, template_subject, template_path, supports_in_app, role_restriction, sort_order) VALUES
                ('ai_key_config_complete', 'AI关键配置生成完成', 'business', 'AI异步生成关键配置完成时通知用户', FALSE, FALSE, TRUE, '【xTest】AI关键配置生成完成 - {caseName}', 'ai_key_config_complete', TRUE, NULL, 230),
                ('ai_overview_complete', 'AI概述生成完成', 'business', 'AI异步生成一级测试点概述完成时通知用户', FALSE, FALSE, TRUE, '【xTest】AI概述生成完成 - {pointName}', 'ai_overview_complete', TRUE, NULL, 231)
            `);

            return { success: true, detail: 'AI任务通知类型添加成功' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async _seedOverviewConfigFiles(agentId) {
        if (!agentId) return;
        try {
            const [existingSoul] = await pool.query(
                'SELECT id FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
                [agentId, 'soul']
            );
            if (existingSoul.length === 0) {
                await pool.execute(
                    `INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, description, is_required, sort_order, version)
                     VALUES (?, 'soul', 'soul.md', ?, '概述生成智能体核心人设', 1, 1, 1)`,
                    [agentId, `# 概述生成

## 身份
你是一个专业的测试管理专家。你的任务是根据一级测试点下的所有测试用例内容，生成一段简洁的概述（summary），帮助测试人员快速了解该测试点的测试范围和重点。

## 能力
- 分析测试用例的名称、步骤、预期结果等信息
- 提炼测试点的核心测试方向和重点
- 生成50-200字的简洁专业概述

## 输出格式
请直接输出概述文本，不需要任何标题、格式标记或JSON包裹。`]
                );
            }

            const [existingUser] = await pool.query(
                'SELECT id FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
                [agentId, 'user']
            );
            if (existingUser.length === 0) {
                await pool.execute(
                    `INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, description, is_required, sort_order, version)
                     VALUES (?, 'user', 'user.md', ?, '概述生成用户提示模板', 1, 2, 1)`,
                    [agentId, `请为以下一级测试点生成概述：

## 测试点信息
- 测试点名称: {{pointName}}
- 测试类型: {{testType}}
- 测试用例数量: {{caseCount}}

## 测试用例详情
{{caseInfo}}

请根据以上测试用例的内容，生成一段简洁的概述，总结该测试点的测试内容和目的。`]
                );
            }
        } catch (err) {
            logger.error('种子 generate_overview 配置文件失败:', { error: err.message });
        }
    }

    async _seedKeyConfigConfigFiles(agentId) {
        if (!agentId) return;
        try {
            const [existingSoul] = await pool.query(
                'SELECT id FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
                [agentId, 'soul']
            );
            if (existingSoul.length === 0) {
                await pool.execute(
                    `INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, description, is_required, sort_order, version)
                     VALUES (?, 'soul', 'soul.md', ?, '关键配置生成智能体核心人设', 1, 1, 1)`,
                    [agentId, `# 关键配置生成

## 身份
你是一个专业的测试工程师。你的任务是根据测试用例的信息，生成该用例的"关键配置"内容。

## 能力
- 从前置条件中提取环境要求
- 从步骤中提取操作命令和参数
- 识别关键的配置项、命令、参数、环境变量、数据准备等

## 输出格式
每行一个配置点，使用 "配置项: 值" 或 "- 配置说明" 的格式。如果没有特殊配置，输出 "无特殊配置要求"。不要输出JSON格式。`]
                );
            }

            const [existingUser] = await pool.query(
                'SELECT id FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
                [agentId, 'user']
            );
            if (existingUser.length === 0) {
                await pool.execute(
                    `INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, description, is_required, sort_order, version)
                     VALUES (?, 'user', 'user.md', ?, '关键配置生成用户提示模板', 1, 2, 1)`,
                    [agentId, `请为以下测试用例生成关键配置：

- 用例名称: {{caseName}}
- 前置条件: {{precondition}}
- 测试目的: {{purpose}}
- 测试步骤: {{steps}}
- 预期结果: {{expected}}`]
                );
            }
        } catch (err) {
            logger.error('种子 generate_key_config 配置文件失败:', { error: err.message });
        }
    }

    async seedDefaultConfigFiles() {
        try {
            const agentsExists = await this.checkTableExists('ai_sub_agents');
            if (!agentsExists) {
                return { success: true, detail: 'ai_sub_agents 表不存在，跳过' };
            }

            const configFilesExists = await this.checkTableExists('ai_sub_agent_config_files');
            if (!configFilesExists) {
                return { success: true, detail: 'ai_sub_agent_config_files 表不存在，跳过' };
            }

            const [agents] = await pool.query('SELECT id, agent_code, display_name, description, category FROM ai_sub_agents');
            if (agents.length === 0) {
                return { success: true, detail: '没有智能体需要处理' };
            }

            let inserted = 0;

            const defaultSoulTemplate = `# AI 助手

## 身份
你是一名AI助手，专门协助测试团队完成各类任务。

## 核心原则
1. 准确性优先
2. 建设性反馈
3. 规范遵循

## 输出格式
严格按照 JSON 格式输出结果。`;

            const defaultUserTemplate = `# 用户偏好

## 待处理内容
{{content}}

## 上下文
{{context}}`;

            for (const agent of agents) {
                const [existingFiles] = await pool.query(
                    'SELECT file_type, content FROM ai_sub_agent_config_files WHERE agent_id = ?',
                    [agent.id]
                );
                const existingMap = new Map();
                existingFiles.forEach(f => existingMap.set(f.file_type, f.content || ''));

                if (!existingMap.has('soul') || !existingMap.get('soul').trim()) {
                    const customSoul = this._getCustomSoulTemplate(agent.agent_code, agent.display_name, agent.description, agent.category);
                    if (!existingMap.has('soul')) {
                        await pool.execute(
                            `INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, description, is_required, sort_order, version)
                             VALUES (?, 'soul', 'Soul.md', ?, '智能体核心人设文件', 1, 1, 1)`,
                            [agent.id, customSoul]
                        );
                    } else {
                        await pool.execute(
                            `UPDATE ai_sub_agent_config_files SET content = ? WHERE agent_id = ? AND file_type = 'soul'`,
                            [customSoul, agent.id]
                        );
                    }
                    inserted++;
                }

                if (!existingMap.has('user') || !existingMap.get('user').trim()) {
                    const customUser = this._getCustomUserTemplate(agent.agent_code);
                    if (!existingMap.has('user')) {
                        await pool.execute(
                            `INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, description, is_required, sort_order, version)
                             VALUES (?, 'user', 'User.md', ?, '用户提示模板', 1, 2, 1)`,
                            [agent.id, customUser]
                        );
                    } else {
                        await pool.execute(
                            `UPDATE ai_sub_agent_config_files SET content = ? WHERE agent_id = ? AND file_type = 'user'`,
                            [customUser, agent.id]
                        );
                    }
                    inserted++;
                }

                const existingTools = existingMap.get('tools') || '[]';
                let existingToolsArr = [];
                try {
                    existingToolsArr = JSON.parse(existingTools);
                } catch (e) {}
                if (!Array.isArray(existingToolsArr)) existingToolsArr = [];
                
                if (existingToolsArr.length === 0) {
                    const defaultTools = this._getDefaultTools(agent.agent_code, agent.category);
                    if (defaultTools.length > 0) {
                        if (!existingMap.has('tools')) {
                            await pool.execute(
                                `INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, description, is_required, sort_order, version)
                                 VALUES (?, 'tools', 'Tools.md', ?, '工具配置文件', 1, 3, 1)`,
                                [agent.id, JSON.stringify(defaultTools)]
                            );
                        } else {
                            await pool.execute(
                                `UPDATE ai_sub_agent_config_files SET content = ? WHERE agent_id = ? AND file_type = 'tools'`,
                                [JSON.stringify(defaultTools), agent.id]
                            );
                        }
                        inserted++;
                    }
                }

                if (!existingMap.has('rule')) {
                    continue;
                }
            }

            return { success: true, detail: `为 ${agents.length} 个智能体插入了 ${inserted} 个默认配置文件` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async seedDefaultRuleConfigFiles() {
        try {
            const agentsExists = await this.checkTableExists('ai_sub_agents');
            if (!agentsExists) {
                return { success: true, detail: 'ai_sub_agents 表不存在，跳过' };
            }

            const configFilesExists = await this.checkTableExists('ai_sub_agent_config_files');
            if (!configFilesExists) {
                return { success: true, detail: 'ai_sub_agent_config_files 表不存在，跳过' };
            }

            const [enumCheck] = await pool.query(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_sub_agent_config_files' AND COLUMN_NAME = 'file_type'"
            );
            if (enumCheck.length > 0 && !enumCheck[0].COLUMN_TYPE.includes('rule')) {
                await pool.query(
                    "ALTER TABLE `ai_sub_agent_config_files` MODIFY COLUMN `file_type` ENUM('soul','user','tools','rule','checklist','examples','glossary','template','custom') NOT NULL COMMENT '配置文件类型'"
                );
                logger.info('ai_sub_agent_config_files.file_type ENUM 已补充 rule 值');
            }

            const [agents] = await pool.query('SELECT id, agent_code, category FROM ai_sub_agents WHERE is_system = 1');
            if (agents.length === 0) {
                return { success: true, detail: '没有系统智能体需要处理' };
            }

            let inserted = 0;

            for (const agent of agents) {
                const [existing] = await pool.query(
                    'SELECT id FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ?',
                    [agent.id, 'rule']
                );

                if (existing.length > 0) continue;

                const customRule = this._getCustomRuleTemplate(agent.agent_code, agent.category);
                if (!customRule) continue;

                await pool.execute(
                    `INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, description, is_required, sort_order, version)
                     VALUES (?, 'rule', 'Rule.md', ?, '评审/校验规则文件', 0, 6, 1)`,
                    [agent.id, customRule]
                );
                inserted++;
            }

            return { success: true, detail: `为 ${inserted} 个系统智能体补充了 Rule.md 配置文件` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    _getCustomSoulTemplate(agentCode, displayName, description, category) {
        const templates = {
            'query_test_statistics': `# 测试统计查询助手

## 身份
你是一名专业的测试数据分析师，专门负责查询和分析测试统计数据。

## 核心能力
1. 查询测试用例执行统计
2. 分析测试覆盖率
3. 统计缺陷分布
4. 生成测试报告数据

## 输出格式
严格按照 JSON 格式输出统计结果，包含清晰的字段说明。`,

            'query_user_tasks': `# 用户任务查询助手

## 身份
你是一名任务管理助手，专门负责查询和管理用户的测试任务。

## 核心能力
1. 查询用户待办任务
2. 统计任务完成情况
3. 追踪任务进度
4. 提醒任务截止时间

## 输出格式
严格按照 JSON 格式输出任务列表和状态信息。`,

            'review_test_cases': `# AI 评审员

## 身份
你是一名资深的测试用例评审专家，拥有 10 年以上的软件测试经验。

## 核心原则
1. **准确性优先**：评审意见必须基于事实，不得臆测
2. **建设性反馈**：拒绝时必须给出具体改进建议
3. **规范遵循**：严格遵循项目测试用例编写规范

## 评审维度
1. 用例名称是否清晰准确
2. 前置条件是否完整
3. 测试步骤是否可执行
4. 预期结果是否明确可验证

## 输出格式
严格按照 JSON 格式输出评审结果。`
        };

        if (templates[agentCode]) {
            return templates[agentCode];
        }

        return `# ${displayName || agentCode}

## 身份
${description || '你是一名AI助手，专门协助测试团队完成各类任务。'}

## 核心原则
1. 准确性优先
2. 建设性反馈
3. 规范遵循

## 输出格式
严格按照 JSON 格式输出结果。`;
    }

    _getCustomUserTemplate(agentCode) {
        const templates = {
            'query_test_statistics': `# 统计查询参数

## 查询条件
- 时间范围: {{timeRange}}
- 项目: {{project}}
- 模块: {{module}}

## 输出要求
{{outputRequirements}}`,

            'query_user_tasks': `# 任务查询参数

## 用户信息
- 用户ID: {{userId}}
- 用户名: {{username}}

## 查询条件
- 任务状态: {{status}}
- 时间范围: {{timeRange}}`,

            'review_test_cases': `# 待评审用例

## 用例信息
{{temp_cases_json}}

## 模块上下文
- 模块名称: {{module_name}}
- 模块描述: {{module_description}}

## 评审要求
- 评审数量: {{case_count}} 条
- 自动通过阈值: {{auto_approve_score}}`
        };

        if (templates[agentCode]) {
            return templates[agentCode];
        }

        return `# 用户偏好

## 待处理内容
{{content}}

## 上下文
{{context}}`;
    }

    _getDefaultTools(agentCode, category) {
        const toolMappings = {
            'query_test_statistics': ['query_test_statistics'],
            'query_user_tasks': ['query_user_tasks'],
            'analyze_module_coverage': ['analyze_module_coverage'],
            'generate_test_report': ['generate_test_report'],
            'review_test_cases': ['spec_checker', 'duplication_checker', 'coverage_analyzer', 'consistency_checker'],
            'generate_overview': [],
            'generate_key_config': [],
            'generate_test_cases': [],
            'generate_functional_cases': [],
            'generate_performance_cases': [],
            'generate_exception_cases': []
        };

        if (toolMappings[agentCode]) {
            return toolMappings[agentCode];
        }

        if (category === 'test_review') {
            return ['spec_checker', 'duplication_checker'];
        }

        if (category === 'test_generation') {
            return [];
        }

        return [];
    }

    _getCustomRuleTemplate(agentCode, category) {
        const templates = {
            'review_test_cases': `# 评审规则链

## 规则 #1: 格式与规范检查
**检查维度**: 必填字段、格式规范、命名规范、优先级
**判定标准**: 4项全部满足->通过，1项不满足->修正后通过
**检查项**:
- 用例名称是否包含模块名前缀且格式规范
- 前置条件是否完整且可满足
- 测试步骤是否有编号且可执行
- 预期结果是否明确可验证

## 规则 #2: 深度规则检查
**检查维度**: 逻辑覆盖、边界值、性能风险、数据流、依赖关系
**判定标准**: 5项全部满足->通过，1项不满足->修正后通过，2项及以上->需重写
**检查项**:
- 是否覆盖正常/异常/边界场景
- 边界值是否合理
- 是否存在性能风险
- 数据流是否正确
- 依赖关系是否清晰

## 规则 #3: 业务逻辑验证
**检查维度**: 业务正确性、预期合理性、风险识别、完整性
**判定标准**: 4项全部满足->通过，1项不满足->修正后通过，2项及以上->需重写
**检查项**:
- 业务逻辑是否正确
- 预期结果是否合理
- 是否识别潜在风险
- 用例是否完整覆盖业务场景`,

            'generate_test_cases': `# 生成校验规则链

## 规则 #1: 格式完整性检查
**检查维度**: 必填字段、格式规范
**判定标准**: 全部满足->通过，1项不满足->修正后通过
**检查项**:
- 用例名称是否包含模块名前缀
- 前置条件是否明确（无则填"无"）
- 测试步骤是否有编号且可执行
- 预期结果是否明确可验证

## 规则 #2: 场景覆盖检查
**检查维度**: 正常/异常/边界场景覆盖
**判定标准**: 至少覆盖正常+1类异常->通过
**检查项**:
- 是否覆盖正常流程
- 是否覆盖异常输入场景
- 是否考虑边界值情况
- 用例之间是否有重复`,

            'generate_functional_cases': `# 功能用例生成校验规则链

## 规则 #1: 格式完整性检查
**检查维度**: 必填字段、格式规范
**判定标准**: 全部满足->通过，1项不满足->修正后通过
**检查项**:
- 用例名称是否包含模块名前缀且格式规范
- 前置条件是否明确（无则填"无"）
- 测试步骤是否有编号且可执行
- 预期结果是否明确可验证

## 规则 #2: 功能覆盖检查
**检查维度**: 功能点覆盖、场景完整性
**判定标准**: 核心功能全覆盖->通过
**检查项**:
- 是否覆盖正向功能流程
- 是否覆盖异常输入场景
- 是否考虑边界值情况
- 功能路径是否完整`,

            'generate_performance_cases': `# 性能用例生成校验规则链

## 规则 #1: 格式完整性检查
**检查维度**: 必填字段、性能指标
**判定标准**: 全部满足->通过
**检查项**:
- 用例名称是否包含模块名前缀
- 是否定义性能指标（并发数/响应时间/吞吐量）
- 测试步骤是否包含负载施加方式
- 预期结果是否包含量化阈值

## 规则 #2: 性能场景合理性
**检查维度**: 场景设计、指标合理性
**判定标准**: 指标可量化且合理->通过
**检查项**:
- 并发数设定是否合理
- 响应时间阈值是否可达成
- 是否考虑渐增负载场景
- 是否包含稳定性测试场景`,

            'generate_exception_cases': `# 异常用例生成校验规则链

## 规则 #1: 格式完整性检查
**检查维度**: 必填字段、异常描述
**判定标准**: 全部满足->通过
**检查项**:
- 用例名称是否包含模块名前缀
- 前置条件是否说明异常触发前提
- 测试步骤是否描述异常触发方式
- 预期结果是否描述异常处理行为

## 规则 #2: 异常场景覆盖
**检查维度**: 异常类型覆盖、处理合理性
**判定标准**: 覆盖主要异常类型->通过
**检查项**:
- 是否覆盖输入异常场景
- 是否覆盖环境异常场景
- 是否覆盖边界溢出场景
- 异常处理预期是否合理`
        };

        if (templates[agentCode]) {
            return templates[agentCode];
        }

        if (category === 'test_review') {
            return `# 评审规则链

## 规则 #1: 格式与规范检查
**检查维度**: 必填字段、格式规范
**判定标准**: 全部满足->通过，1项不满足->修正后通过
**检查项**:
- 用例名称是否规范
- 前置条件是否完整
- 测试步骤是否有编号且可执行
- 预期结果是否明确可验证

## 规则 #2: 内容质量检查
**检查维度**: 逻辑正确性、场景覆盖
**判定标准**: 核心项满足->通过
**检查项**:
- 逻辑是否正确
- 是否覆盖关键场景
- 预期结果是否合理`;
        }

        if (category === 'test_generation') {
            return `# 生成校验规则链

## 规则 #1: 格式完整性检查
**检查维度**: 必填字段、格式规范
**判定标准**: 全部满足->通过
**检查项**:
- 用例名称是否包含模块名前缀
- 前置条件是否明确
- 测试步骤是否有编号且可执行
- 预期结果是否明确可验证

## 规则 #2: 场景覆盖检查
**检查维度**: 正常/异常场景覆盖
**判定标准**: 至少覆盖正常+1类异常->通过
**检查项**:
- 是否覆盖正常流程
- 是否覆盖异常场景
- 用例之间是否有重复`;
        }

        return null;
    }

    async ensureBuiltinSubAgents() {
        try {
            const agentsExists = await this.checkTableExists('ai_sub_agents');
            if (!agentsExists) {
                return { success: true, detail: 'ai_sub_agents 表不存在，跳过' };
            }

            let detail = '';

            const builtinAgents = [
                {
                    agent_code: 'generate_overview',
                    display_name: '概述生成',
                    description: '根据一级测试点下的测试用例内容，AI自动生成简洁的测试点概述（summary），帮助快速了解测试范围和重点',
                    category: 'test_generation',
                    allow_qa: 0,
                    seedFn: 'overview'
                },
                {
                    agent_code: 'generate_key_config',
                    display_name: '关键配置生成',
                    description: '根据测试用例的名称、前置条件、目的、步骤和预期结果，AI自动生成关键配置信息（命令、参数、环境变量等）',
                    category: 'test_generation',
                    allow_qa: 0,
                    seedFn: 'keyConfig'
                }
            ];

            for (const agent of builtinAgents) {
                const [existing] = await pool.query(
                    'SELECT id FROM ai_sub_agents WHERE agent_code = ? AND is_system = 1 LIMIT 1',
                    [agent.agent_code]
                );

                if (existing.length === 0) {
                    const [result] = await pool.execute(
                        `INSERT INTO ai_sub_agents
                            (agent_code, display_name, description, category, is_system, allow_qa, is_enabled, visibility, memory_enabled, memory_distill_threshold)
                         VALUES (?, ?, ?, ?, 1, ?, 1, 'public', 1, 2000)`,
                        [agent.agent_code, agent.display_name, agent.description, agent.category, agent.allow_qa]
                    );
                    const agentId = result.insertId;
                    detail += `插入内置 ${agent.agent_code} 智能体; `;

                    if (agent.seedFn === 'overview') {
                        await this._seedOverviewConfigFiles(agentId);
                        detail += `插入 ${agent.agent_code} 配置文件; `;
                    } else if (agent.seedFn === 'keyConfig') {
                        await this._seedKeyConfigConfigFiles(agentId);
                        detail += `插入 ${agent.agent_code} 配置文件; `;
                    }
                } else {
                    if (agent.seedFn === 'overview') {
                        await this._seedOverviewConfigFiles(existing[0].id);
                    } else if (agent.seedFn === 'keyConfig') {
                        await this._seedKeyConfigConfigFiles(existing[0].id);
                    }
                }
            }

            const memoriesExists = await this.checkTableExists('ai_sub_agent_memories');
            if (memoriesExists) {
                const memorySeeds = {
                    'generate_overview': {
                        content: '## 概述生成知识\n- 概述长度控制在50-200字\n- 概括测试点的主要测试内容和方向\n- 多个方向按重要性简要列举\n- 语言简洁专业，避免冗余\n- 优先参考该测试点下的用例实际内容',
                        charCount: 82
                    },
                    'generate_key_config': {
                        content: '## 关键配置生成知识\n- 关键配置包括: 命令、参数值、环境变量、数据准备、端口配置等\n- 从前置条件中提取环境要求\n- 从步骤中提取操作命令和参数\n- 格式: "配置项: 值" 或 "- 配置说明"\n- 无特殊配置时输出 "无特殊配置要求"',
                        charCount: 85
                    }
                };

                for (const agentCode of Object.keys(memorySeeds)) {
                    const [agentRows] = await pool.query(
                        'SELECT id FROM ai_sub_agents WHERE agent_code = ? AND is_system = 1 LIMIT 1',
                        [agentCode]
                    );
                    if (agentRows.length === 0) continue;

                    const sa = agentRows[0];
                    const seed = memorySeeds[agentCode];

                    const [existingMemory] = await pool.query(
                        'SELECT id FROM ai_sub_agent_memories WHERE agent_id = ? AND level = ? AND library_id IS NULL AND module_id IS NULL LIMIT 1',
                        [sa.id, 'global']
                    );

                    if (existingMemory.length === 0) {
                        try {
                            await pool.execute(
                                `INSERT INTO ai_sub_agent_memories (agent_id, library_id, module_id, level, content, char_count)
                                 VALUES (?, NULL, NULL, 'global', ?, ?)`,
                                [sa.id, seed.content, seed.charCount]
                            );
                            detail += `插入 ${agentCode} 记忆种子; `;
                        } catch (memErr) {
                            logger.warn(`插入 ${agentCode} 记忆种子失败: ${memErr.message}`);
                        }
                    }
                }
            }

            return { success: true, detail: detail || '所有内置智能体已存在，无需操作' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async ensureCaseImportOptimizerAgent() {
        try {
            const agentsExists = await this.checkTableExists('ai_sub_agents');
            if (!agentsExists) {
                return { success: true, detail: 'ai_sub_agents 表不存在，跳过' };
            }

            const configFilesExists = await this.checkTableExists('ai_sub_agent_config_files');
            if (!configFilesExists) {
                return { success: true, detail: 'ai_sub_agent_config_files 表不存在，跳过' };
            }

            const [existing] = await pool.query(
                'SELECT id FROM ai_sub_agents WHERE agent_code = ? AND is_system = 1 LIMIT 1',
                ['case_import_optimizer']
            );

            let agentId;
            let detail = '';

            if (existing.length === 0) {
                const [result] = await pool.execute(
                    `INSERT INTO ai_sub_agents
                        (agent_code, display_name, description, category, agent_type, is_system, allow_qa, is_enabled, visibility, memory_enabled,
                         llm_temperature, llm_max_tokens, max_retries, timeout_seconds, sort_order)
                     VALUES (?, ?, ?, ?, 'analyzer', 1, 0, 1, 'public', 0, 0.30, 4096, 2, 180, 50)`,
                    ['case_import_optimizer', '用例导入优化专家', '对导入的测试用例进行规范化补全，包括补全测试目的、前置条件、详细步骤、预期结果，规范化测试类型和优先级', '用例评审']
                );
                agentId = result.insertId;
                detail += '插入 case_import_optimizer 智能体; ';
            } else {
                agentId = existing[0].id;
                detail += 'case_import_optimizer 智能体已存在; ';
            }

            const configFiles = [
                {
                    file_type: 'soul',
                    file_name: 'soul.md',
                    content: '# 用例导入优化专家\n\n## 身份\n你是一位资深的测试用例质量审核专家，专注于对导入的测试用例进行规范化补全和优化。\n\n## 核心原则\n1. **保留优先**：用户原始填写的内容优先保留，仅补全缺失或明显不规范的字段\n2. **最小改动**：不做过度润色，保持用户的原始表达风格\n3. **规范对齐**：测试类型、优先级等枚举字段必须严格对齐系统字典\n4. **逻辑一致**：补全的内容必须与已有字段逻辑一致，不能矛盾\n5. **可执行性**：测试步骤必须具备可执行性，预期结果必须可验证\n\n## 输出格式\n严格输出 JSON 数组，每个元素对应一条优化后的用例，包含所有字段（包括未修改的字段）。\n\n## 禁止事项\n- 禁止删除用户已有的有效内容\n- 禁止修改用例名称（除非明显错别字）\n- 禁止凭空编造与用例无关的步骤\n- 禁止输出非 JSON 格式的内容',
                    sort_order: 1
                },
                {
                    file_type: 'user',
                    file_name: 'user.md',
                    content: '## 任务\n请对以下导入的测试用例进行规范化优化。\n\n## 系统字典\n- 优先级选项：{{priorities}}\n- 测试类型选项：{{test_types}}\n- 测试阶段选项：{{test_phases}}\n- 测试方式选项：{{test_methods}}\n- 测试环境选项：{{environments}}\n\n## 待优化用例（批次 {{batch_index}}/{{total_batches}}）\n```json\n{{cases_json}}\n```\n\n## 优化要求\n1. 如果 `purpose`（测试目的）为空，根据用例名称和步骤推断补全\n2. 如果 `precondition`（前置条件）为空，根据步骤内容推断补全\n3. 如果 `steps`（测试步骤）过于简略（少于3步或每步少于10字），补充详细操作步骤\n4. 如果 `expected`（预期结果）过于简略，补充可验证的预期结果\n5. 如果 `priority`（优先级）为空或不在系统字典中，根据用例影响范围推断\n6. 如果 `type`（测试类型）不在系统字典中，映射到最接近的系统类型\n7. 如果 `key_config`（关键配置）为空且步骤涉及配置，补充关键配置说明\n\n## 输出格式\n```json\n[\n  {\n    "original_index": 0,\n    "name": "用例名称（保留原文）",\n    "priority": "高|中|低（必须为系统字典值）",\n    "type": "功能测试|性能测试|...（必须为系统字典值）",\n    "precondition": "补全后的前置条件",\n    "purpose": "补全后的测试目的",\n    "steps": "补全后的测试步骤",\n    "expected": "补全后的预期结果",\n    "key_config": "补全后的关键配置（如无则为空字符串）",\n    "remark": "备注（保留原文）",\n    "optimization_notes": "简述做了哪些优化"\n  }\n]\n```',
                    sort_order: 2
                },
                {
                    file_type: 'tools',
                    file_name: 'tools.md',
                    content: '## 可用工具\n\n### lookup_test_types\n查询系统中的测试类型字典，用于校验和映射测试类型。\n\n### lookup_priorities\n查询系统中的优先级字典，用于校验和映射优先级。\n\n### lookup_similar_cases\n根据用例名称搜索相似用例，参考已有用例的写法风格。',
                    sort_order: 3
                },
                {
                    file_type: 'rule',
                    file_name: 'rule.md',
                    content: '## 评审规则链\n\n### Rule 1: 字段完整性检查\n- 检查所有必填字段（name, steps, expected）是否非空\n- 检查建议填写字段（purpose, precondition, priority）是否非空\n- 如有空字段，要求补全\n\n### Rule 2: 枚举值合规检查\n- priority 必须在系统字典值中\n- type 必须在系统字典值中\n- 如不合规，要求修正\n\n### Rule 3: 内容质量检查\n- steps 至少包含 2 个步骤\n- expected 必须可验证\n- purpose 不应为用例名称的简单重复\n- 如不合规，要求优化\n\n### Rule 4: 改动幅度检查\n- 对比原始用例和优化后用例\n- name 字段改动率不超过 20%\n- 已有有效内容的字段改动率不超过 30%\n- 如改动过大，要求回退到更保守的版本',
                    sort_order: 4
                },
                {
                    file_type: 'checklist',
                    file_name: 'checklist.md',
                    content: '## 输出检查清单\n\n- [ ] 输出为合法 JSON 数组\n- [ ] 每条用例包含 original_index 字段\n- [ ] priority 值在系统字典中\n- [ ] type 值在系统字典中\n- [ ] purpose 非空\n- [ ] precondition 非空\n- [ ] steps 至少 2 步\n- [ ] expected 非空且可验证\n- [ ] name 与原始名称差异不超过 20%\n- [ ] 每条用例包含 optimization_notes',
                    sort_order: 5
                }
            ];

            for (const cf of configFiles) {
                const [existingFile] = await pool.query(
                    'SELECT id FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = ? LIMIT 1',
                    [agentId, cf.file_type]
                );

                if (existingFile.length === 0) {
                    await pool.execute(
                        'INSERT INTO ai_sub_agent_config_files (agent_id, file_type, file_name, content, sort_order) VALUES (?, ?, ?, ?, ?)',
                        [agentId, cf.file_type, cf.file_name, cf.content, cf.sort_order]
                    );
                    detail += `插入 ${cf.file_type} 配置文件; `;
                }
            }

            return { success: true, detail: detail || 'case_import_optimizer 智能体配置完整，无需操作' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async seedAIGenerationParams() {
        try {
            const aiConfigExists = await this.checkTableExists('ai_config');
            if (!aiConfigExists) {
                return { success: true, detail: 'ai_config 表不存在，跳过' };
            }

            const globalParams = [
                { key: 'temperature', value: '0.3', desc: '全局模型温度参数(0-2)' },
                { key: 'max_tokens', value: '4000', desc: '全局最大输出Token数' },
                { key: 'top_p', value: '1.0', desc: 'Top-P核采样阈值(0-1)' },
                { key: 'frequency_penalty', value: '0', desc: '频率惩罚(-2到2)' },
                { key: 'presence_penalty', value: '0', desc: '存在惩罚(-2到2)' },
                { key: 'tool_choice', value: 'auto', desc: '工具调用方式(auto/required/none)' },
                { key: 'response_format', value: 'text', desc: '响应格式(text/json_object)' },
                { key: 'request_timeout', value: '120000', desc: '请求超时时间(毫秒)' },
                { key: 'max_retries', value: '3', desc: '最大重试次数' },
                { key: 'ai_rate_limit', value: '10', desc: 'AI速率限制(次/分钟)' },
                { key: 'request_interval', value: '0', desc: '请求间隔(毫秒)' },
                { key: 'retry_mode', value: 'finite', desc: '重试模式(finite/infinite)' },
                { key: 'seed', value: '', desc: '随机种子(留空则随机)' }
            ];

            const sceneParams = [
                { key: 'scene_data_analysis', value: '{"temperature":"0.3","max_tokens":"2000","max_context_rounds":"10"}', desc: '数据分析助手场景参数' },
                { key: 'scene_case_generation', value: '{"temperature":"0.7","max_tokens":"4000","max_context_chars":"1000"}', desc: '用例生成场景参数' },
                { key: 'scene_report_analysis', value: '{"temperature":"0.3","max_tokens":"2000"}', desc: '报告分析场景参数' },
                { key: 'scene_memory_distillation', value: '{"temperature":"0.3","max_tokens":"800"}', desc: '记忆蒸馏场景参数' }
            ];

            let inserted = 0;
            let skipped = 0;

            for (const param of [...globalParams, ...sceneParams]) {
                try {
                    const [existing] = await pool.query(
                        'SELECT config_key FROM ai_config WHERE config_key = ?',
                        [param.key]
                    );
                    if (existing.length > 0) {
                        skipped++;
                        continue;
                    }
                    await pool.execute(
                        'INSERT INTO ai_config (config_key, config_value, description) VALUES (?, ?, ?)',
                        [param.key, param.value, param.desc]
                    );
                    inserted++;
                } catch (err) {
                    if (err.code === 'ER_DUP_ENTRY') {
                        skipped++;
                    } else {
                        logger.warn(`插入AI生成参数 ${param.key} 失败: ${err.message}`);
                    }
                }
            }

            try {
                const [existingScene] = await pool.query(
                    "SELECT config_value FROM ai_config WHERE config_key = 'scene_case_generation'"
                );
                if (existingScene.length > 0) {
                    const currentVal = JSON.parse(existingScene[0].config_value || '{}');
                    if (currentVal.max_context_chars === undefined) {
                        currentVal.max_context_chars = '1000';
                        await pool.execute(
                            "UPDATE ai_config SET config_value = ? WHERE config_key = 'scene_case_generation'",
                            [JSON.stringify(currentVal)]
                        );
                        logger.info('已为scene_case_generation补充max_context_chars参数');
                    }
                }
            } catch (updateErr) {
                logger.warn('更新scene_case_generation参数失败: ' + updateErr.message);
            }

            return { success: true, detail: `插入 ${inserted} 条, 跳过 ${skipped} 条` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

const autoMigration = new AutoMigration();

module.exports = autoMigration;
