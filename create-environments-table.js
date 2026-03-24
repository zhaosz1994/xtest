const pool = require('./db');

async function createEnvironmentsTable() {
    try {
        // 创建环境表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS environments (
                id INT PRIMARY KEY AUTO_INCREMENT,
                env_id VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                creator VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('成功创建环境表');
        
        await pool.end();
    } catch (error) {
        console.error('创建环境表失败:', error);
        await pool.end();
    }
}

createEnvironmentsTable();