#!/usr/bin/env node

const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

class DatabaseChecker {
  constructor() {
    this.connection = null;
    this.results = {
      timestamp: new Date().toISOString(),
      database: process.env.DB_NAME,
      checks: [],
      summary: {
        total_checks: 0,
        passed: 0,
        warnings: 0,
        errors: 0
      }
    };
  }

  async connect() {
    try {
      const dbConfig = {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      };

      if (process.env.DB_SOCKET) {
        dbConfig.socketPath = process.env.DB_SOCKET;
      } else {
        dbConfig.host = process.env.DB_HOST || '127.0.0.1';
      }

      this.connection = await mysql.createConnection(dbConfig);
      console.log('✓ 数据库连接成功');
      return true;
    } catch (error) {
      console.error('✗ 数据库连接失败:', error.message);
      return false;
    }
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.end();
      console.log('✓ 数据库连接已关闭');
    }
  }

  addCheck(category, name, status, message, details = null) {
    const check = {
      category,
      name,
      status,
      message,
      details,
      timestamp: new Date().toISOString()
    };
    this.results.checks.push(check);
    this.results.summary.total_checks++;
    
    if (status === 'pass') {
      this.results.summary.passed++;
      console.log(`  ✓ [${category}] ${name}: ${message}`);
    } else if (status === 'warning') {
      this.results.summary.warnings++;
      console.log(`  ⚠ [${category}] ${name}: ${message}`);
    } else if (status === 'error') {
      this.results.summary.errors++;
      console.log(`  ✗ [${category}] ${name}: ${message}`);
    }
  }

  async checkTablesExist() {
    console.log('\n=== 检查表是否存在 ===');
    
    const expectedTables = [
      'users', 'projects', 'modules', 'test_cases', 'test_plans',
      'test_plan_cases', 'test_reports', 'test_methods', 'test_phases',
      'test_types', 'test_sources', 'test_statuses', 'test_progresses',
      'test_priorities', 'test_softwares', 'environments', 'chips',
      'activity_logs', 'ai_config', 'ai_models', 'ai_skills',
      'case_libraries', 'case_library_cases', 'case_execution_records',
      'email_config', 'email_logs', 'forum_posts', 'forum_comments',
      'forum_tags', 'forum_post_tags', 'forum_likes', 'notifications',
      'report_templates', 'hyperlink_configs', 'level1_points', 'level2_points',
      'history', 'history_snapshots', 'testpoint_chips', 'testpoint_status',
      'user_skill_settings', 'test_case_environments', 'test_case_methods',
      'test_case_phases', 'test_case_progresses', 'test_case_projects',
      'test_case_sources', 'test_case_statuses', 'test_case_test_types',
      'test_execution_logs', 'test_plan_rules'
    ];

    try {
      const [rows] = await this.connection.query('SHOW TABLES');
      const existingTables = rows.map(row => Object.values(row)[0]);
      
      for (const table of expectedTables) {
        if (existingTables.includes(table)) {
          this.addCheck('表存在性', table, 'pass', '表存在');
        } else {
          this.addCheck('表存在性', table, 'error', '表不存在');
        }
      }

      const unexpectedTables = existingTables.filter(t => !expectedTables.includes(t));
      if (unexpectedTables.length > 0) {
        this.addCheck('表存在性', '额外表', 'warning', 
          `发现 ${unexpectedTables.length} 个未预期的表: ${unexpectedTables.join(', ')}`);
      }
    } catch (error) {
      this.addCheck('表存在性', '检查失败', 'error', error.message);
    }
  }

  async checkTableStructures() {
    console.log('\n=== 检查表结构 ===');
    
    const criticalTables = ['users', 'test_cases', 'test_plans', 'test_reports'];
    
    for (const table of criticalTables) {
      try {
        const [columns] = await this.connection.query(`DESCRIBE ${table}`);
        
        const hasPrimaryKey = columns.some(col => col.Key === 'PRI');
        if (!hasPrimaryKey) {
          this.addCheck('表结构', `${table}主键`, 'error', '缺少主键');
        } else {
          this.addCheck('表结构', `${table}主键`, 'pass', '主键存在');
        }

        const hasTimestamp = columns.some(col => 
          col.Field.includes('created_at') || col.Field.includes('updated_at')
        );
        if (hasTimestamp) {
          this.addCheck('表结构', `${table}时间戳`, 'pass', '时间戳字段存在');
        } else {
          this.addCheck('表结构', `${table}时间戳`, 'warning', '缺少时间戳字段');
        }

        const nullFields = columns.filter(col => col.Null === 'YES' && col.Default === null);
        if (nullFields.length > 0) {
          this.addCheck('表结构', `${table}可空字段`, 'warning', 
            `${nullFields.length} 个字段可为NULL且无默认值`);
        }
      } catch (error) {
        this.addCheck('表结构', `${table}检查`, 'error', error.message);
      }
    }
  }

  async checkIndexes() {
    console.log('\n=== 检查索引 ===');
    
    const criticalIndexes = [
      { table: 'users', index: 'username' },
      { table: 'users', index: 'email' },
      { table: 'test_cases', index: 'case_id' },
      { table: 'test_plans', index: 'idx_test_plans_status' },
      { table: 'test_reports', index: 'idx_test_reports_status' },
      { table: 'activity_logs', index: 'idx_activity_logs_user_id' }
    ];

    for (const { table, index } of criticalIndexes) {
      try {
        const [indexes] = await this.connection.query(`SHOW INDEX FROM ${table}`);
        const indexExists = indexes.some(idx => idx.Key_name === index);
        
        if (indexExists) {
          this.addCheck('索引', `${table}.${index}`, 'pass', '索引存在');
        } else {
          this.addCheck('索引', `${table}.${index}`, 'warning', '索引不存在');
        }
      } catch (error) {
        this.addCheck('索引', `${table}.${index}`, 'error', error.message);
      }
    }
  }

  async checkForeignKeys() {
    console.log('\n=== 检查外键约束 ===');
    
    try {
      const [foreignKeys] = await this.connection.query(`
        SELECT 
          TABLE_NAME,
          COLUMN_NAME,
          REFERENCED_TABLE_NAME,
          REFERENCED_COLUMN_NAME,
          CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [process.env.DB_NAME]);

      const fkCount = foreignKeys.length;
      if (fkCount > 0) {
        this.addCheck('外键约束', '外键数量', 'pass', `发现 ${fkCount} 个外键约束`);
        
        for (const fk of foreignKeys) {
          const [orphaned] = await this.connection.query(`
            SELECT COUNT(*) as count
            FROM ${fk.TABLE_NAME} t1
            LEFT JOIN ${fk.REFERENCED_TABLE_NAME} t2 ON t1.${fk.COLUMN_NAME} = t2.${fk.REFERENCED_COLUMN_NAME}
            WHERE t1.${fk.COLUMN_NAME} IS NOT NULL AND t2.${fk.REFERENCED_COLUMN_NAME} IS NULL
          `);
          
          if (orphaned[0].count > 0) {
            this.addCheck('外键约束', `${fk.TABLE_NAME}.${fk.COLUMN_NAME}`, 'warning',
              `发现 ${orphaned[0].count} 条孤立记录`);
          } else {
            this.addCheck('外键约束', `${fk.TABLE_NAME}.${fk.COLUMN_NAME}`, 'pass',
              '无孤立记录');
          }
        }
      } else {
        this.addCheck('外键约束', '外键数量', 'warning', '未发现外键约束');
      }
    } catch (error) {
      this.addCheck('外键约束', '检查失败', 'error', error.message);
    }
  }

  async checkDataIntegrity() {
    console.log('\n=== 检查数据完整性 ===');
    
    const integrityChecks = [
      {
        name: '用户数据',
        query: 'SELECT COUNT(*) as count FROM users WHERE username IS NULL OR email IS NULL',
        expected: 0
      },
      {
        name: '测试用例数据',
        query: 'SELECT COUNT(*) as count FROM test_cases WHERE name IS NULL OR priority IS NULL',
        expected: 0
      },
      {
        name: '测试计划数据',
        query: 'SELECT COUNT(*) as count FROM test_plans WHERE name IS NULL OR owner IS NULL',
        expected: 0
      },
      {
        name: '重复用户名',
        query: 'SELECT COUNT(*) as count FROM (SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1) as dup',
        expected: 0
      },
      {
        name: '重复邮箱',
        query: 'SELECT COUNT(*) as count FROM (SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1) as dup',
        expected: 0
      }
    ];

    for (const check of integrityChecks) {
      try {
        const [result] = await this.connection.query(check.query);
        const count = result[0].count;
        
        if (count === check.expected) {
          this.addCheck('数据完整性', check.name, 'pass', '数据完整');
        } else {
          this.addCheck('数据完整性', check.name, 'error', 
            `发现 ${count} 条问题数据`);
        }
      } catch (error) {
        this.addCheck('数据完整性', check.name, 'error', error.message);
      }
    }
  }

  async checkTableStatistics() {
    console.log('\n=== 检查表统计信息 ===');
    
    try {
      const [tables] = await this.connection.query(`
        SELECT 
          TABLE_NAME,
          TABLE_ROWS,
          DATA_LENGTH,
          INDEX_LENGTH,
          DATA_FREE,
          AUTO_INCREMENT
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_ROWS DESC
      `, [process.env.DB_NAME]);

      const emptyTables = tables.filter(t => t.TABLE_ROWS === 0);
      const largeTables = tables.filter(t => t.TABLE_ROWS > 10000);
      const fragmentedTables = tables.filter(t => t.DATA_FREE > 0);

      this.addCheck('表统计', '表总数', 'pass', `共 ${tables.length} 个表`);
      this.addCheck('表统计', '空表', 'warning', `${emptyTables.length} 个表无数据`);
      this.addCheck('表统计', '大表', largeTables.length > 0 ? 'warning' : 'pass', 
        `${largeTables.length} 个表超过10000行`);
      this.addCheck('表统计', '碎片', fragmentedTables.length > 0 ? 'warning' : 'pass',
        `${fragmentedTables.length} 个表存在碎片`);

      for (const table of fragmentedTables.slice(0, 5)) {
        this.addCheck('表碎片', table.TABLE_NAME, 'warning',
          `碎片大小: ${(table.DATA_FREE / 1024 / 1024).toFixed(2)} MB`);
      }
    } catch (error) {
      this.addCheck('表统计', '检查失败', 'error', error.message);
    }
  }

  async checkDatabaseHealth() {
    console.log('\n=== 检查数据库健康状态 ===');
    
    try {
      const [variables] = await this.connection.query('SHOW VARIABLES LIKE "max_connections"');
      const [status] = await this.connection.query('SHOW STATUS LIKE "Threads_connected"');
      
      const maxConnections = parseInt(variables[0].Value);
      const currentConnections = parseInt(status[0].Value);
      const connectionUsage = (currentConnections / maxConnections * 100).toFixed(2);
      
      if (connectionUsage > 80) {
        this.addCheck('数据库健康', '连接使用率', 'warning', 
          `当前使用率: ${connectionUsage}%`);
      } else {
        this.addCheck('数据库健康', '连接使用率', 'pass', 
          `当前使用率: ${connectionUsage}%`);
      }

      const [innodbStatus] = await this.connection.query('SHOW ENGINE INNODB STATUS');
      const innodbStatusText = innodbStatus[0].Status;
      
      if (innodbStatusText.includes('ERROR')) {
        this.addCheck('数据库健康', 'InnoDB状态', 'error', '发现错误');
      } else {
        this.addCheck('数据库健康', 'InnoDB状态', 'pass', '状态正常');
      }
    } catch (error) {
      this.addCheck('数据库健康', '检查失败', 'error', error.message);
    }
  }

  async checkSecuritySettings() {
    console.log('\n=== 检查安全设置 ===');
    
    try {
      const [users] = await this.connection.query(`
        SELECT User, Host, authentication_string 
        FROM mysql.user 
        WHERE User NOT IN ('mysql.sys', 'mysql.session', 'mysql.infoschema')
      `);

      const usersWithoutPassword = users.filter(u => !u.authentication_string);
      if (usersWithoutPassword.length > 0) {
        this.addCheck('安全设置', '用户密码', 'error',
          `${usersWithoutPassword.length} 个用户无密码`);
      } else {
        this.addCheck('安全设置', '用户密码', 'pass', '所有用户都有密码');
      }

      const rootUsers = users.filter(u => u.User === 'root' && u.Host !== 'localhost');
      if (rootUsers.length > 0) {
        this.addCheck('安全设置', 'root远程访问', 'warning',
          'root用户允许远程访问');
      } else {
        this.addCheck('安全设置', 'root远程访问', 'pass', 'root仅本地访问');
      }
    } catch (error) {
      this.addCheck('安全设置', '检查失败', 'error', error.message);
    }
  }

  generateReport() {
    const reportPath = path.join(__dirname, '..', 'database-check-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
    console.log(`\n✓ 报告已生成: ${reportPath}`);

    console.log('\n=== 检查摘要 ===');
    console.log(`总检查项: ${this.results.summary.total_checks}`);
    console.log(`✓ 通过: ${this.results.summary.passed}`);
    console.log(`⚠ 警告: ${this.results.summary.warnings}`);
    console.log(`✗ 错误: ${this.results.summary.errors}`);

    const healthScore = (
      (this.results.summary.passed / this.results.summary.total_checks) * 100
    ).toFixed(2);
    console.log(`\n健康度评分: ${healthScore}%`);

    if (this.results.summary.errors > 0) {
      console.log('\n⚠ 发现错误，请检查详细报告');
      process.exit(1);
    } else if (this.results.summary.warnings > 0) {
      console.log('\n⚠ 发现警告，建议检查');
      process.exit(0);
    } else {
      console.log('\n✓ 所有检查通过');
      process.exit(0);
    }
  }

  async run() {
    console.log('========================================');
    console.log('  数据库完整性检查工具');
    console.log('  数据库: ' + process.env.DB_NAME);
    console.log('  时间: ' + new Date().toLocaleString('zh-CN'));
    console.log('========================================');

    const connected = await this.connect();
    if (!connected) {
      process.exit(1);
    }

    try {
      await this.checkTablesExist();
      await this.checkTableStructures();
      await this.checkIndexes();
      await this.checkForeignKeys();
      await this.checkDataIntegrity();
      await this.checkTableStatistics();
      await this.checkDatabaseHealth();
      await this.checkSecuritySettings();
      
      this.generateReport();
    } catch (error) {
      console.error('\n✗ 检查过程中发生错误:', error);
      process.exit(1);
    } finally {
      await this.disconnect();
    }
  }
}

const checker = new DatabaseChecker();
checker.run();
