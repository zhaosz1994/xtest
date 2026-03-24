const mysql = require('mysql2/promise');

async function dropChipsTable() {
    try {
        const pool = mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: 'zsz12345',
            database: 'ctcsdk_testplan'
        });
        
        console.log('Connected to database');
        
        // 删除chips表
        await pool.execute('DROP TABLE IF EXISTS chips');
        console.log('Successfully dropped chips table');
        
        pool.end();
    } catch (error) {
        console.error('Error dropping chips table:', error.message);
    }
}

dropChipsTable();
