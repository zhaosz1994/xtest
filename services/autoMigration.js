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
