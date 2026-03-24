const mysql = require('mysql2/promise');

async function checkDatabase() {
    try {
        const pool = mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: 'zsz12345',
            database: 'ctcsdk_testplan'
        });
        
        console.log('Connected to database');
        
        // Check if level1_points table exists
        const [tables] = await pool.execute('SHOW TABLES');
        const hasLevel1Table = tables.some(table => table[Object.keys(table)[0]] === 'level1_points');
        console.log('level1_points table exists:', hasLevel1Table);
        
        // Check table structure
        if (hasLevel1Table) {
            const [columns] = await pool.execute('DESCRIBE level1_points');
            console.log('Table columns:');
            columns.forEach(col => console.log(`${col.Field}: ${col.Type}`));
        }
        
        // Check if module with id 1 exists
        const [modules] = await pool.execute('SELECT * FROM modules WHERE id = 1');
        console.log('Module with id 1 exists:', modules.length > 0);
        if (modules.length > 0) {
            console.log('Module name:', modules[0].name);
        }
        
        // Try to insert a test point
        try {
            await pool.execute(
                'INSERT INTO level1_points (module_id, name, test_type) VALUES (?, ?, ?)',
                [1, '测试测试点', '功能测试']
            );
            console.log('Test point inserted successfully');
        } catch (error) {
            console.error('Error inserting test point:', error.message);
        }
        
        pool.end();
    } catch (error) {
        console.error('Database connection error:', error.message);
    }
}

checkDatabase();