const mysql = require('mysql2/promise');

// 数据库配置
const config = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'ctcsdk_testplan'
};

async function checkEnvironments() {
  try {
    // 创建连接
    const connection = await mysql.createConnection(config);
    console.log('数据库连接成功');

    // 检查环境表
    console.log('\n检查环境表数据:');
    const [environments] = await connection.execute('SELECT * FROM environments');
    console.log('环境数据:', environments);

    // 检查测试方式表
    console.log('\n检查测试方式表数据:');
    const [methods] = await connection.execute('SELECT * FROM methods');
    console.log('测试方式数据:', methods);

    // 关闭连接
    await connection.end();
    console.log('\n数据库连接已关闭');
  } catch (error) {
    console.error('操作失败:', error);
  }
}

checkEnvironments();
