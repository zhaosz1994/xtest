const pool = require('./db');

async function queryTestCasesStructure() {
  try {
    console.log('=== 测试用例表结构 ===');
    // 查询test_cases表结构
    const [describeResult] = await pool.execute('DESCRIBE test_cases');
    console.table(describeResult);
    
    console.log('\n=== 测试用例项目关联表结构 ===');
    // 查询test_case_projects表结构（如果存在）
    try {
        const [projectDescribeResult] = await pool.execute('DESCRIBE test_case_projects');
        console.table(projectDescribeResult);
        
        console.log('\n=== 测试用例项目关联表数据 ===');
        const [projectDataResult] = await pool.execute('SELECT * FROM test_case_projects LIMIT 10');
        console.table(projectDataResult);
    } catch (e) {
        console.log('测试用例项目关联表不存在:', e.message);
    }
    
    // 关闭连接池
    await pool.end();
  } catch (error) {
    console.error('查询失败:', error.message);
    process.exit(1);
  }
}

queryTestCasesStructure();