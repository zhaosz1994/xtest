const pool = require('./db');

async function queryTestTypes() {
  try {
    console.log('=== 测试类型表结构 ===');
    // 查询表结构
    const [describeResult] = await pool.execute('DESCRIBE test_types');
    console.table(describeResult);
    
    console.log('\n=== 测试类型表数据 ===');
    // 查询表数据
    const [selectResult] = await pool.execute('SELECT * FROM test_types ORDER BY id ASC');
    console.table(selectResult);
    
    // 关闭连接池
    await pool.end();
  } catch (error) {
    console.error('查询测试类型失败:', error.message);
    process.exit(1);
  }
}

queryTestTypes();