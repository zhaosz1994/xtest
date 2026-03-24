const mysql = require('mysql2/promise');

// 从环境变量或配置文件获取数据库连接信息
const config = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'ctcsdk_testplan'
};

async function checkData() {
  try {
    // 创建连接池
    const pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    
    console.log('连接到数据库...');
    
    // 检查环境表
    console.log('\n1. 检查环境表数据:');
    const [environments] = await pool.execute('SELECT * FROM environments');
    console.log('环境数据:', JSON.stringify(environments, null, 2));
    
    // 检查测试方式表
    console.log('\n2. 检查测试方式表数据:');
    const [methods] = await pool.execute('SELECT * FROM test_methods');
    console.log('测试方式数据:', JSON.stringify(methods, null, 2));
    
    // 关闭连接池
    await pool.end();
    console.log('\n数据库连接已关闭');
    
  } catch (error) {
    console.error('操作失败:', error);
    console.error('错误代码:', error.code);
    console.error('错误消息:', error.message);
  }
}

checkData();
