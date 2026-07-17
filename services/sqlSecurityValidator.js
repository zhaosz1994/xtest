const { Parser } = require('node-sql-parser');
const logger = require('./logger');

const parser = new Parser();

const ALLOWED_TABLES = [
  'test_cases',
  'test_plans',
  'test_reports',
  'test_points',
  'test_plan_cases',
  'projects',
  'modules',
  'snapshots',
  'libraries',
  'testpoints',
  'chips',
  'report_templates',
  'environments',
  'posts',
  'comments',
  'post_likes',
  'forum_attachments'
];

const FORBIDDEN_TABLES = [
  'users',
  'ai_models',
  'ai_skills',
  'user_skill_settings',
  'sessions',
  'notifications'
];

const ALLOWED_OPERATIONS = ['select'];

class SQLSecurityValidator {
  constructor() {
    this.parser = parser;
  }

  validate(sql, params = []) {
    const errors = [];
    
    try {
      const ast = this.parser.astify(sql);
      
      if (!Array.isArray(ast)) {
        this.validateAST(ast, errors);
        return {
          valid: errors.length === 0,
          errors: errors,
          tables: this.extractTables(ast),
          operation: this.getOperationType(ast)
        };
      }
      
      for (const statement of ast) {
        this.validateAST(statement, errors);
      }
      
      return {
        valid: errors.length === 0,
        errors: errors,
        tables: this.extractTables(ast),
        operation: this.getOperationType(ast)
      };
      
    } catch (error) {
      logger.error('SQL解析错误', { sql, error: error.message });
      return {
        valid: false,
        errors: [`SQL解析失败: ${error.message}`],
        tables: [],
        operation: null
      };
    }
  }

  validateAST(ast, errors) {
    if (!ast.type) {
      errors.push('无法识别的SQL语句类型');
      return;
    }
    
    const operation = ast.type.toLowerCase();
    
    if (!ALLOWED_OPERATIONS.includes(operation)) {
      errors.push(`不允许的操作类型: ${operation.toUpperCase()}。AI技能只允许执行SELECT查询`);
    }
    
    const tables = this.extractTablesFromAST(ast);
    
    for (const table of tables) {
      const tableName = table.table ? table.table.toLowerCase() : table.toLowerCase();
      
      if (FORBIDDEN_TABLES.includes(tableName)) {
        errors.push(`禁止访问敏感表: ${tableName}`);
      }
      
      if (ALLOWED_TABLES.length > 0 && !ALLOWED_TABLES.includes(tableName)) {
        if (!FORBIDDEN_TABLES.includes(tableName)) {
          errors.push(`表 ${tableName} 不在允许访问的白名单中`);
        }
      }
    }
    
    this.checkForDangerousPatterns(ast, errors);
  }

  extractTablesFromAST(ast) {
    const tables = [];
    
    if (ast.from) {
      for (const fromItem of ast.from) {
        if (fromItem.table) {
          tables.push(fromItem.table);
        }
        if (fromItem.as) {
          tables.push({ table: fromItem.table, alias: fromItem.as });
        }
      }
    }
    
    if (ast.join) {
      for (const joinItem of ast.join) {
        if (joinItem.table) {
          tables.push(joinItem.table);
        }
      }
    }
    
    if (ast._next) {
      tables.push(...this.extractTablesFromAST(ast._next));
    }
    
    return tables;
  }

  extractTables(ast) {
    if (Array.isArray(ast)) {
      const allTables = [];
      for (const statement of ast) {
        allTables.push(...this.extractTablesFromAST(statement));
      }
      return [...new Set(allTables.map(t => t.table || t))];
    }
    return [...new Set(this.extractTablesFromAST(ast).map(t => t.table || t))];
  }

  getOperationType(ast) {
    if (Array.isArray(ast) && ast.length > 0) {
      return ast[0].type ? ast[0].type.toLowerCase() : null;
    }
    return ast.type ? ast.type.toLowerCase() : null;
  }

  checkForDangerousPatterns(ast, errors) {
    const sqlStr = JSON.stringify(ast);
    
    const dangerousPatterns = [
      { pattern: /information_schema/i, message: '禁止访问系统信息表' },
      { pattern: /mysql\s*\./i, message: '禁止访问mysql系统数据库' },
      { pattern: /performance_schema/i, message: '禁止访问性能模式数据库' },
      { pattern: /sys\s*\./i, message: '禁止访问系统数据库' }
    ];
    
    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(sqlStr)) {
        errors.push(message);
      }
    }
  }

  extractTablesFromSQL(sql) {
    try {
      const ast = this.parser.astify(sql);
      return this.extractTables(ast);
    } catch (error) {
      logger.error('提取表名失败', { sql, error: error.message });
      return [];
    }
  }

  isSelectOnly(sql) {
    const result = this.validate(sql);
    return result.valid && result.operation === 'select';
  }
}

const sqlValidator = new SQLSecurityValidator();

function validateSQL(sql, params = []) {
  return sqlValidator.validate(sql, params);
}

function extractTablesFromSQL(sql) {
  return sqlValidator.extractTablesFromSQL(sql);
}

function isSelectOnly(sql) {
  return sqlValidator.isSelectOnly(sql);
}

module.exports = {
  SQLSecurityValidator,
  validateSQL,
  extractTablesFromSQL,
  isSelectOnly,
  ALLOWED_TABLES,
  FORBIDDEN_TABLES
};
