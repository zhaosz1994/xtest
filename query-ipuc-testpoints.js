const mysql = require('mysql2/promise');
require('dotenv').config();

async function queryIPUCTestPoints() {
  try {
    // 创建数据库连接
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });
    
    console.log('数据库连接成功');
    
    // 1. 查询模块IPUC的ID
    console.log('\n1. 查询模块IPUC的信息:');
    const [modules] = await connection.execute(
      'SELECT id, name FROM modules WHERE name = ?',
      ['IPUC']
    );
    
    if (modules.length === 0) {
      console.log('未找到模块IPUC');
      await connection.end();
      return;
    }
    
    const moduleId = modules[0].id;
    console.log(`模块IPUC的ID: ${moduleId}`);
    
    // 2. 查询模块IPUC下关联的一级测试点
    console.log('\n2. 模块IPUC下关联的一级测试点:');
    const [level1Points] = await connection.execute(
      'SELECT id, name, test_type, created_at, updated_at FROM level1_points WHERE module_id = ?',
      [moduleId]
    );
    
    if (level1Points.length === 0) {
      console.log('模块IPUC下没有关联的一级测试点');
      await connection.end();
      return;
    }
    
    console.log(`找到 ${level1Points.length} 个一级测试点:`);
    level1Points.forEach(point => {
      console.log(`  ID: ${point.id}, 名称: ${point.name}, 测试类型: ${point.test_type}, 创建时间: ${point.created_at}`);
    });
    
    // 3. 查询每个一级测试点下关联的下一级测试点
    console.log('\n3. 每个一级测试点下关联的下一级测试点:');
    for (const level1Point of level1Points) {
      const [level2Points] = await connection.execute(
        'SELECT id, name, test_steps, expected_behavior, test_environment, case_name FROM level2_points WHERE level1_id = ?',
        [level1Point.id]
      );
      
      console.log(`\n  一级测试点: ${level1Point.name} (ID: ${level1Point.id}) 下的测试点:`);
      if (level2Points.length === 0) {
        console.log('    没有关联的下一级测试点');
      } else {
        console.log(`    找到 ${level2Points.length} 个下一级测试点:`);
        level2Points.forEach(point => {
          console.log(`      ID: ${point.id}, 名称: ${point.name}, 用例名称: ${point.case_name}`);
        });
      }
    }
    
    // 关闭数据库连接
    await connection.end();
    console.log('\n数据库连接已关闭');
    
  } catch (error) {
    console.error('查询过程中发生错误:', error);
  }
}

// 执行查询
queryIPUCTestPoints();
