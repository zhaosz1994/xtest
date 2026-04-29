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
                
                connection.release();
                
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
                connection.release();
                throw error;
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
            'ER_TABLE_EXISTS_ERROR',
            'ER_BAD_FIELD_ERROR'
        ];
        
        const ignorableMessages = [
            'Duplicate column name',
            'Duplicate key name',
            'Duplicate entry',
            'Table.*already exists',
            'Unknown column'
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
                        logger.info(`跳过已执行的迁移: ${migrationName}`);
                        continue;
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
     * JS 数据迁移钩子
     * 处理纯 SQL 无法胜任的复杂逻辑（如 JSON 解析、条件迁移等）
     * 每个迁移通过 schema_migrations 表做幂等保护，只执行一次
     */
    async runDataMigrations(executedMigrations) {
        const dataMigrations = [
            { name: 'migrate_ai_skills_to_custom_tools', fn: () => this.migrateAISkillsToCustomTools() },
            { name: 'seed_ai_sub_agents_and_memories', fn: () => this.seedAISubAgentsAndMemories() },
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
}

const autoMigration = new AutoMigration();

module.exports = autoMigration;
