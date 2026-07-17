#!/usr/bin/env node

const mysql = require('mysql2/promise');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function createAIReadOnlyUser() {
  let connection;
  
  try {
    console.log('========================================');
    console.log('AI只读数据库用户配置工具');
    console.log('========================================\n');
    
    const dbName = process.env.DB_NAME || 'xtest';
    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbSocket = process.env.DB_SOCKET;
    
    console.log(`数据库: ${dbName}`);
    console.log(`主机: ${dbSocket || dbHost}\n`);
    
    const aiUserPassword = await question('请输入AI只读用户的密码（直接回车使用默认密码）: ');
    const password = aiUserPassword.trim() || 'AI_Readonly_2026_Secure!';
    
    console.log('\n正在连接数据库...');
    
    const config = dbSocket ? {
      socketPath: dbSocket,
      user: dbUser,
      password: dbPassword,
      database: dbName
    } : {
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      database: dbName
    };
    
    connection = await mysql.createConnection(config);
    
    console.log('数据库连接成功\n');
    
    console.log('步骤1: 创建AI只读用户...');
    try {
      await connection.execute(`CREATE USER IF NOT EXISTS 'ai_readonly'@'%' IDENTIFIED BY '${password}'`);
      console.log('✓ 用户创建成功\n');
    } catch (error) {
      if (error.code === 'ER_CANNOT_USER') {
        console.log('✓ 用户已存在，更新密码...\n');
        await connection.execute(`ALTER USER 'ai_readonly'@'%' IDENTIFIED BY '${password}'`);
      } else {
        throw error;
      }
    }
    
    console.log('步骤2: 撤销所有现有权限...');
    try {
      await connection.execute('REVOKE ALL PRIVILEGES ON *.* FROM \'ai_readonly\'@\'%\'');
      console.log('✓ 权限已清理\n');
    } catch (error) {
      console.log('✓ 无需清理权限\n');
    }
    
    console.log('步骤3: 授予SELECT权限...');
    await connection.execute(`GRANT SELECT ON ${dbName}.* TO 'ai_readonly'@'%'`);
    console.log(`✓ 已授予 ${dbName}.* 的SELECT权限\n`);
    
    console.log('步骤4: 刷新权限...');
    await connection.execute('FLUSH PRIVILEGES');
    console.log('✓ 权限已刷新\n');
    
    console.log('步骤5: 验证用户权限...');
    const [grants] = await connection.execute('SHOW GRANTS FOR \'ai_readonly\'@\'%\'');
    console.log('✓ 用户权限：');
    grants.forEach(grant => {
      console.log(`  - ${Object.values(grant)[0]}`);
    });
    
    console.log('\n========================================');
    console.log('✓ AI只读用户配置完成！');
    console.log('========================================\n');
    
    console.log('请将以下配置添加到 .env 文件中：');
    console.log('========================================');
    console.log(`AI_DB_USER=ai_readonly`);
    console.log(`AI_DB_PASSWORD=${password}`);
    console.log('========================================\n');
    
    console.log('安全提示：');
    console.log('1. 请妥善保管AI数据库用户密码');
    console.log('2. AI用户只有SELECT权限，无法执行DELETE、UPDATE、INSERT等操作');
    console.log('3. 建议定期更换密码');
    console.log('4. 如需更细粒度的权限控制，请手动编辑 create-ai-readonly-user.sql\n');
    
  } catch (error) {
    console.error('\n❌ 配置失败:', error.message);
    console.error('\n可能的原因：');
    console.error('1. 数据库连接失败，请检查 .env 配置');
    console.error('2. 当前用户没有创建新用户的权限');
    console.error('3. 数据库服务器不允许远程连接');
    console.error('\n解决方案：');
    console.error('1. 使用root用户执行此脚本');
    console.error('2. 或者手动执行 scripts/create-ai-readonly-user.sql 中的SQL语句\n');
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
    rl.close();
  }
}

createAIReadOnlyUser();
