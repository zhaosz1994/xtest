const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 数据库配置（从 .env 文件读取，与 db.js 保持一致）
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 10000,
  timezone: '+08:00'
};

// 动态判断：如果环境变量里配了 Socket 就优先用 Socket，否则用 Host
if (process.env.DB_SOCKET) {
  dbConfig.socketPath = process.env.DB_SOCKET;
} else {
  dbConfig.host = process.env.DB_HOST || '127.0.0.1';
}

// 验证必要的环境变量是否存在
if (!dbConfig.user || !dbConfig.password || !dbConfig.database) {
  console.error('❌ 错误：缺少必要的数据库配置');
  console.error('请确保 .env 文件中包含以下配置：');
  console.error('  DB_USER=your_database_user');
  console.error('  DB_PASSWORD=your_database_password');
  console.error('  DB_NAME=your_database_name');
  console.error('\n提示：您可以复制 .env.example 文件为 .env 并填写实际值');
  process.exit(1);
}

async function exportDatabaseSchema() {
  let connection;
  
  try {
    // 连接数据库
    connection = await mysql.createConnection(dbConfig);
    console.log('数据库连接成功');
    
    // 获取所有表
    const [tables] = await connection.execute(`
      SELECT TABLE_NAME, TABLE_COMMENT 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = '${dbConfig.database}'
      ORDER BY TABLE_NAME
    `);
    
    console.log(`找到 ${tables.length} 个表`);
    
    let markdown = `# xtest 数据库架构文档\n\n`;
    markdown += `生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;
    markdown += `数据库：${dbConfig.database}\n\n`;
    markdown += `---\n\n`;
    
    markdown += `## 目录\n\n`;
    tables.forEach(table => {
      const tableName = table.TABLE_NAME;
      const tableComment = table.TABLE_COMMENT || '无注释';
      markdown += `- [${tableName}](#${tableName.toLowerCase()}) - ${tableComment}\n`;
    });
    markdown += `\n---\n\n`;
    
    // 获取每个表的详细信息
    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      const tableComment = table.TABLE_COMMENT || '无注释';
      
      console.log(`处理表：${tableName}`);
      
      markdown += `## ${tableName}\n\n`;
      markdown += `**说明：** ${tableComment}\n\n`;
      
      // 获取表结构
      const [columns] = await connection.execute(`
        SELECT 
          COLUMN_NAME as column_name,
          COLUMN_TYPE as column_type,
          IS_NULLABLE as is_nullable,
          COLUMN_DEFAULT as column_default,
          COLUMN_COMMENT as column_comment,
          COLUMN_KEY as column_key,
          EXTRA as extra
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${dbConfig.database}'
          AND TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
      `);
      
      markdown += `### 表结构\n\n`;
      markdown += `| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |\n`;
      markdown += `|--------|------|----------|--------|-----|------|------|\n`;
      
      for (const col of columns) {
        const keySymbol = {
          'PRI': '🔑 主键',
          'UNI': '✨ 唯一',
          'MUL': '🔗 索引',
          '': ''
        }[col.column_key] || col.column_key;
        
        const extraInfo = col.extra ? col.extra : '';
        const comment = col.column_comment || '';
        const nullable = col.is_nullable === 'YES' ? '是' : '否';
        const defaultValue = col.column_default !== null ? col.column_default : 'NULL';
        
        markdown += `| ${col.column_name} | ${col.column_type} | ${nullable} | ${defaultValue} | ${keySymbol} | ${extraInfo} | ${comment} |\n`;
      }
      
      markdown += `\n`;
      
      // 获取外键约束
      const [foreignKeys] = await connection.execute(`
        SELECT 
          kcu.COLUMN_NAME as column_name,
          kcu.CONSTRAINT_NAME as constraint_name,
          kcu.REFERENCED_TABLE_NAME as ref_table,
          kcu.REFERENCED_COLUMN_NAME as ref_column,
          rc.DELETE_RULE as delete_rule,
          rc.UPDATE_RULE as update_rule
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc 
          ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
          AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = '${dbConfig.database}'
          AND kcu.TABLE_NAME = '${tableName}'
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      `);
      
      if (foreignKeys.length > 0) {
        markdown += `### 外键关联\n\n`;
        markdown += `| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |\n`;
        markdown += `|------|--------|--------|----------|----------|----------|\n`;
        
        for (const fk of foreignKeys) {
          markdown += `| ${fk.column_name} | ${fk.constraint_name} | ${fk.ref_table} | ${fk.ref_column} | ${fk.delete_rule} | ${fk.update_rule} |\n`;
        }
        markdown += `\n`;
      }
      
      // 获取索引
      const [indexes] = await connection.execute(`
        SELECT 
          INDEX_NAME as index_name,
          COLUMN_NAME as column_name,
          SEQ_IN_INDEX as seq_in_index,
          NON_UNIQUE as non_unique,
          INDEX_TYPE as index_type
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = '${dbConfig.database}'
          AND TABLE_NAME = '${tableName}'
          AND INDEX_NAME != 'PRIMARY'
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `);
      
      if (indexes.length > 0) {
        markdown += `### 索引\n\n`;
        markdown += `| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |\n`;
        markdown += `|------|------|------|--------|------|\n`;
        
        let currentIndex = '';
        let indexColumns = [];
        
        for (const idx of indexes) {
          if (currentIndex !== idx.index_name) {
            if (currentIndex && indexColumns.length > 0) {
              const unique = indexes.find(i => i.index_name === currentIndex && i.non_unique == 0) ? '唯一' : '非唯一';
              const type = indexes.find(i => i.index_name === currentIndex)?.index_type || 'BTREE';
              markdown += `| ${currentIndex} | ${indexColumns.join(', ')} | - | ${unique} | ${type} |\n`;
            }
            currentIndex = idx.index_name;
            indexColumns = [idx.column_name];
          } else {
            indexColumns.push(idx.column_name);
          }
        }
        
        // 输出最后一个索引
        if (currentIndex && indexColumns.length > 0) {
          const unique = indexes.find(i => i.index_name === currentIndex && i.non_unique == 0) ? '唯一' : '非唯一';
          const type = indexes.find(i => i.index_name === currentIndex)?.index_type || 'BTREE';
          markdown += `| ${currentIndex} | ${indexColumns.join(', ')} | - | ${unique} | ${type} |\n`;
        }
        
        markdown += `\n`;
      }
      
      // 获取表数据量
      const [tableStats] = await connection.execute(`
        SELECT 
          TABLE_ROWS as table_rows,
          DATA_LENGTH as data_length,
          INDEX_LENGTH as index_length
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '${dbConfig.database}'
          AND TABLE_NAME = '${tableName}'
      `);
      
      if (tableStats.length > 0) {
        const stats = tableStats[0];
        const dataLengthMB = (stats.data_length / 1024 / 1024).toFixed(2);
        const indexLengthMB = (stats.index_length / 1024 / 1024).toFixed(2);
        markdown += `### 表统计\n\n`;
        markdown += `- 记录数：约 ${stats.table_rows} 条\n`;
        markdown += `- 数据大小：${dataLengthMB} MB\n`;
        markdown += `- 索引大小：${indexLengthMB} MB\n`;
        markdown += `\n`;
      }
      
      markdown += `---\n\n`;
    }
    
    // 添加表关联关系图
    markdown += `## 表关联关系\n\n`;
    markdown += `以下是数据库中所有外键关联关系的汇总：\n\n`;
    
    const [allForeignKeys] = await connection.execute(`
      SELECT 
        kcu.TABLE_NAME as table_name,
        kcu.COLUMN_NAME as column_name,
        kcu.CONSTRAINT_NAME as constraint_name,
        kcu.REFERENCED_TABLE_NAME as ref_table,
        kcu.REFERENCED_COLUMN_NAME as ref_column,
        rc.DELETE_RULE as delete_rule,
        rc.UPDATE_RULE as update_rule
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc 
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
      WHERE kcu.TABLE_SCHEMA = '${dbConfig.database}'
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY kcu.TABLE_NAME
    `);
    
    if (allForeignKeys.length > 0) {
      markdown += `### 外键关系列表\n\n`;
      markdown += `| 表名 | 字段 | 引用表 | 引用字段 | 删除规则 | 更新规则 |\n`;
      markdown += `|------|------|--------|----------|----------|----------|\n`;
      
      for (const fk of allForeignKeys) {
        markdown += `| ${fk.table_name} | ${fk.column_name} | ${fk.ref_table} | ${fk.ref_column} | ${fk.delete_rule} | ${fk.update_rule} |\n`;
      }
      markdown += `\n`;
      
      // 按引用表分组
      markdown += `### 按引用表分组\n\n`;
      const groupedByRef = {};
      allForeignKeys.forEach(fk => {
        if (!groupedByRef[fk.ref_table]) {
          groupedByRef[fk.ref_table] = [];
        }
        groupedByRef[fk.ref_table].push(fk);
      });
      
      for (const [refTable, fks] of Object.entries(groupedByRef)) {
        markdown += `#### ${refTable} 被以下表引用\n\n`;
        for (const fk of fks) {
          markdown += `- ${fk.table_name}.${fk.column_name} → ${refTable}.${fk.ref_column}\n`;
        }
        markdown += `\n`;
      }
    } else {
      markdown += `暂无外键关系。\n\n`;
    }
    
    // 写入文件
    const outputPath = path.join(__dirname, 'database-schema.md');
    fs.writeFileSync(outputPath, markdown, 'utf8');
    
    console.log(`\n✅ 数据库架构文档已生成：${outputPath}`);
    console.log(`共导出 ${tables.length} 个表的结构信息`);
    
  } catch (error) {
    console.error('导出数据库架构失败:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('数据库连接已关闭');
    }
  }
}

// 执行导出
exportDatabaseSchema();
