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

async function manageAILogsAging() {
  let connection;
  
  try {
    console.log('========================================');
    console.log('AI操作日志老化管理工具');
    console.log('========================================\n');
    
    const dbName = process.env.DB_NAME || 'xtest';
    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbSocket = process.env.DB_SOCKET;
    
    console.log(`数据库: ${dbName}`);
    console.log(`主机: ${dbSocket || dbHost}\n`);
    
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
    
    console.log('步骤1: 查看当前日志统计');
    console.log('----------------------------------------');
    
    const [stats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_logs,
        MIN(created_at) as oldest_log,
        MAX(created_at) as newest_log,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
      FROM ai_operation_logs
    `);
    
    const stat = stats[0];
    console.log(`总日志数: ${stat.total_logs}`);
    console.log(`最早日志: ${stat.oldest_log}`);
    console.log(`最新日志: ${stat.newest_log}`);
    console.log(`成功操作: ${stat.success_count}`);
    console.log(`失败操作: ${stat.failed_count}\n`);
    
    console.log('步骤2: 查看日志按月份分布');
    console.log('----------------------------------------');
    
    const [monthlyStats] = await connection.execute(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as log_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
      FROM ai_operation_logs
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12
    `);
    
    console.log('月份\t\t总数\t成功\t失败');
    console.log('----------------------------------------');
    monthlyStats.forEach(row => {
      console.log(`${row.month}\t\t${row.log_count}\t${row.success_count}\t${row.failed_count}`);
    });
    console.log();
    
    console.log('步骤3: 检查事件调度器状态');
    console.log('----------------------------------------');
    
    const [eventScheduler] = await connection.execute("SHOW VARIABLES LIKE 'event_scheduler'");
    const isEnabled = eventScheduler[0].Value === 'ON';
    console.log(`事件调度器状态: ${isEnabled ? '✓ 已启用' : '✗ 未启用'}`);
    
    if (!isEnabled) {
      console.log('\n警告: 事件调度器未启用，自动清理功能不会执行');
      const enable = await question('是否启用事件调度器？;
      if (enable.toLowerCase() === 'y') {
        await connection.execute('SET GLOBAL event_scheduler = ON');
        console.log('✓ 事件调度器已启用\n');
      }
    }
    
    const [events] = await connection.execute("SHOW EVENTS WHERE Name = 'clean_old_ai_operation_logs'");
    if (events.length > 0) {
      console.log('✓ 自动清理事件已配置');
      console.log(`  事件状态: ${events[0].Status}`);
      console.log(`  执行间隔: ${events[0].Interval_field} ${events[0].Interval_value}`);
    } else {
      console.log('✗ 自动清理事件未配置');
    }
    console.log();
    
    console.log('步骤4: 选择老化策略');
    console.log('----------------------------------------');
    console.log('1. 保留30天（高频使用场景）');
    console.log('2. 保留60天（平衡方案）');
    console.log('3. 保留90天（当前默认）');
    console.log('4. 保留180天（长期审计）');
    console.log('5. 保留365天（年度审计）');
    console.log('6. 分级老化（失败日志保留更久）');
    console.log('7. 手动清理指定天数的日志');
    console.log('8. 归档旧日志到归档表');
    console.log('9. 禁用自动清理');
    console.log('0. 退出');
    console.log();
    
    const choice = await question('请选择操作 (0-9): ');
    
    switch (choice) {
      case '1':
        await setAgingPolicy(connection, 30);
        break;
      case '2':
        await setAgingPolicy(connection, 60);
        break;
      case '3':
        await setAgingPolicy(connection, 90);
        break;
      case '4':
        await setAgingPolicy(connection, 180);
        break;
      case '5':
        await setAgingPolicy(connection, 365);
        break;
      case '6':
        await setTieredAgingPolicy(connection);
        break;
      case '7':
        await manualCleanup(connection);
        break;
      case '8':
        await archiveOldLogs(connection);
        break;
      case '9':
        await disableAutoCleanup(connection);
        break;
      case '0':
        console.log('\n退出程序');
        break;
      default:
        console.log('\n无效选择');
    }
    
  } catch (error) {
    console.error('\n❌ 操作失败:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
    rl.close();
  }
}

async function setAgingPolicy(connection, days) {
  console.log(`\n配置保留${days}天的老化策略...`);
  
  await connection.execute('DROP EVENT IF EXISTS clean_old_ai_operation_logs');
  
  await connection.execute(`
    CREATE EVENT clean_old_ai_operation_logs
    ON SCHEDULE EVERY 1 DAY
    STARTS CURRENT_TIMESTAMP
    DO
      DELETE FROM ai_operation_logs 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ${days} DAY)
  `);
  
  console.log(`✓ 已配置保留${days}天的自动清理策略`);
  console.log('  每天自动执行一次清理\n');
}

async function setTieredAgingPolicy(connection) {
  console.log('\n配置分级老化策略...');
  
  await connection.execute('DROP EVENT IF EXISTS clean_old_ai_operation_logs');
  
  await connection.execute(`
    CREATE EVENT clean_old_ai_operation_logs
    ON SCHEDULE EVERY 1 DAY
    STARTS CURRENT_TIMESTAMP
    DO
      BEGIN
        DELETE FROM ai_operation_logs 
        WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
          AND status = 'success';
        
        DELETE FROM ai_operation_logs 
        WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)
          AND status = 'failed';
      END
  `);
  
  console.log('✓ 已配置分级老化策略');
  console.log('  成功日志保留90天');
  console.log('  失败日志保留180天\n');
}

async function manualCleanup(connection) {
  const days = await question('请输入要清理多少天前的日志: ');
  const daysNum = parseInt(days);
  
  if (isNaN(daysNum) || daysNum <= 0) {
    console.log('无效的天数');
    return;
  }
  
  const [countResult] = await connection.execute(`
    SELECT COUNT(*) as count
    FROM ai_operation_logs
    WHERE created_at < DATE_SUB(NOW(), INTERVAL ${daysNum} DAY)
  `);
  
  const count = countResult[0].count;
  console.log(`\n将删除 ${count} 条日志`);
  
  const confirm = await question('确认删除？;
  if (confirm.toLowerCase() === 'y') {
    await connection.execute(`
      DELETE FROM ai_operation_logs
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ${daysNum} DAY)
    `);
    console.log(`✓ 已删除 ${count} 条日志\n`);
  } else {
    console.log('已取消\n');
  }
}

async function archiveOldLogs(connection) {
  const days = await question('请输入要归档多少天前的日志: ');
  const daysNum = parseInt(days);
  
  if (isNaN(daysNum) || daysNum <= 0) {
    console.log('无效的天数');
    return;
  }
  
  console.log('\n创建归档表...');
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS ai_operation_logs_archive (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      username VARCHAR(100),
      skill_name VARCHAR(100) NOT NULL,
      skill_id INT,
      operation_type VARCHAR(20) NOT NULL,
      sql_query TEXT,
      sql_params TEXT,
      tables_accessed VARCHAR(500),
      result_count INT DEFAULT 0,
      execution_time_ms INT,
      status VARCHAR(20) NOT NULL DEFAULT 'success',
      error_message TEXT,
      ip_address VARCHAR(50),
      user_agent VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      INDEX idx_user_id (user_id),
      INDEX idx_created_at (created_at),
      INDEX idx_archived_at (archived_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✓ 归档表已创建');
  
  const [countResult] = await connection.execute(`
    SELECT COUNT(*) as count
    FROM ai_operation_logs
    WHERE created_at < DATE_SUB(NOW(), INTERVAL ${daysNum} DAY)
  `);
  
  const count = countResult[0].count;
  console.log(`将归档 ${count} 条日志`);
  
  const confirm = await question('确认归档？;
  if (confirm.toLowerCase() === 'y') {
    await connection.execute(`
      INSERT INTO ai_operation_logs_archive
      SELECT *, NOW() as archived_at
      FROM ai_operation_logs
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ${daysNum} DAY)
    `);
    
    await connection.execute(`
      DELETE FROM ai_operation_logs
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ${daysNum} DAY)
    `);
    
    console.log(`✓ 已归档并删除 ${count} 条日志\n`);
  } else {
    console.log('已取消\n');
  }
}

async function disableAutoCleanup(connection) {
  const confirm = await question('确认禁用自动清理？;
  if (confirm.toLowerCase() === 'y') {
    await connection.execute('DROP EVENT IF EXISTS clean_old_ai_operation_logs');
    console.log('✓ 自动清理已禁用\n');
    console.log('警告: 日志将永久保存，请定期手动清理\n');
  } else {
    console.log('已取消\n');
  }
}

manageAILogsAging();
