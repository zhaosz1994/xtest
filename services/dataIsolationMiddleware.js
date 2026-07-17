const { Parser } = require('node-sql-parser');
const aiReadOnlyPool = require('../db-ai-readonly');
const { validateSQL } = require('./sqlSecurityValidator');
const logger = require('./logger');

const parser = new Parser();

class DataIsolationMiddleware {
  constructor(userId, userRole, userProjects = []) {
    this.userId = userId;
    this.userRole = userRole;
    this.userProjects = userProjects;
    this.isAdmin = userRole === '管理员' || userRole === 'admin' || userRole === 'Administrator';
  }

  async query(sql, params = []) {
    const validation = validateSQL(sql, params);
    
    if (!validation.valid) {
      throw new Error(`SQL验证失败: ${validation.errors.join('; ')}`);
    }
    
    const isolatedSQL = this.injectIsolationConditions(sql);
    
    logger.info('AI查询执行', {
      userId: this.userId,
      originalSQL: sql,
      isolatedSQL: isolatedSQL,
      tables: validation.tables
    });
    
    try {
      const [rows] = await aiReadOnlyPool.execute(isolatedSQL, params);
      return rows;
    } catch (error) {
      logger.error('AI查询执行失败', {
        userId: this.userId,
        sql: isolatedSQL,
        error: error.message
      });
      throw new Error(`数据库查询错误: ${error.message}`);
    }
  }

  injectIsolationConditions(sql) {
    if (this.isAdmin) {
      return sql;
    }
    
    try {
      const ast = parser.astify(sql);
      
      if (Array.isArray(ast)) {
        const modifiedAST = ast.map(statement => 
          this.modifyASTWithIsolation(statement)
        );
        return parser.sqlify(modifiedAST);
      } else {
        const modifiedAST = this.modifyASTWithIsolation(ast);
        return parser.sqlify(modifiedAST);
      }
    } catch (error) {
      logger.error('SQL改写失败', { sql, error: error.message });
      throw new Error(`SQL改写失败: ${error.message}`);
    }
  }

  modifyASTWithIsolation(ast) {
    if (!ast.from || ast.type.toLowerCase() !== 'select') {
      return ast;
    }
    
    for (const fromItem of ast.from) {
      const tableName = fromItem.table ? fromItem.table.toLowerCase() : null;
      
      if (!tableName) continue;
      
      const isolationCondition = this.getIsolationCondition(tableName, fromItem.as);
      
      if (isolationCondition) {
        if (!ast.where) {
          ast.where = isolationCondition;
        } else {
          ast.where = {
            type: 'binary_expr',
            operator: 'AND',
            left: ast.where,
            right: isolationCondition
          };
        }
      }
    }
    
    return ast;
  }

  getIsolationCondition(tableName, alias) {
    const tableAlias = alias || tableName;
    
    const isolationRules = {
      'test_cases': () => this.createProjectIsolation(tableAlias),
      'test_plans': () => this.createProjectIsolation(tableAlias),
      'test_reports': () => this.createProjectIsolation(tableAlias),
      'test_plan_cases': () => this.createProjectIsolation(tableAlias),
      'test_points': () => this.createProjectIsolation(tableAlias),
      'modules': () => this.createProjectIsolation(tableAlias),
      'snapshots': () => this.createProjectIsolation(tableAlias),
      'libraries': () => this.createProjectIsolation(tableAlias),
      'testpoints': () => this.createProjectIsolation(tableAlias),
      'chips': () => this.createProjectIsolation(tableAlias),
      'report_templates': () => this.createProjectIsolation(tableAlias),
      'environments': () => this.createProjectIsolation(tableAlias)
    };
    
    const rule = isolationRules[tableName];
    return rule ? rule() : null;
  }

  createProjectIsolation(tableAlias) {
    if (this.isAdmin || this.userProjects.length === 0) {
      return null;
    }
    
    if (this.userProjects.length === 1) {
      return {
        type: 'binary_expr',
        operator: '=',
        left: {
          type: 'column_ref',
          table: tableAlias,
          column: 'project_id'
        },
        right: {
          type: 'number',
          value: this.userProjects[0]
        }
      };
    }
    
    return {
      type: 'binary_expr',
      operator: 'IN',
      left: {
        type: 'column_ref',
        table: tableAlias,
        column: 'project_id'
      },
      right: {
        type: 'expr_list',
        value: this.userProjects.map(id => ({
          type: 'number',
          value: id
        }))
      }
    };
  }
}

async function createSecureExecutor(userId, userRole) {
  if (userId === undefined || userId === null) {
    logger.error('createSecureExecutor: userId 不能为空');
    throw new Error('userId 不能为空');
  }
  const userProjects = await getUserProjects(userId);
  return new DataIsolationMiddleware(userId, userRole, userProjects);
}

async function getUserProjects(userId) {
  if (userId === undefined || userId === null) {
    logger.error('getUserProjects: userId 不能为空');
    return [];
  }
  try {
    const [projects] = await aiReadOnlyPool.execute(`
      SELECT DISTINCT p.id
      FROM projects p
      WHERE p.creator_id = ? 
         OR p.id IN (
           SELECT project_id FROM project_members WHERE user_id = ?
         )
    `, [userId, userId]);
    
    return projects.map(p => p.id);
  } catch (error) {
    logger.error('获取用户项目列表失败', { userId, error: error.message });
    return [];
  }
}

module.exports = {
  DataIsolationMiddleware,
  createSecureExecutor,
  getUserProjects
};
