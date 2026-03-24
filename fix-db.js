const mysql = require('mysql2/promise');

async function fixDatabase() {
    try {
        const pool = mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: 'zsz12345',
            database: 'ctcsdk_testplan'
        });
        
        console.log('Connected to database');
        
        // Add test_type column to level1_points table
        try {
            await pool.execute('ALTER TABLE level1_points ADD COLUMN test_type VARCHAR(50) DEFAULT "功能测试"');
            console.log('Added test_type column to level1_points table');
        } catch (error) {
            console.log('test_type column already exists:', error.message);
        }
        
        // Check if modules table has any data
        const [modules] = await pool.execute('SELECT * FROM modules');
        console.log('Number of modules:', modules.length);
        
        if (modules.length === 0) {
            // Insert default module
            await pool.execute('INSERT INTO modules (name) VALUES (?)', ['默认模块']);
            console.log('Inserted default module');
        }
        
        // Get first module
        const [firstModule] = await pool.execute('SELECT * FROM modules LIMIT 1');
        console.log('First module:', firstModule[0]);
        
        pool.end();
    } catch (error) {
        console.error('Error:', error.message);
    }
}

fixDatabase();