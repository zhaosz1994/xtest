const mysql = require('mysql2/promise');

async function queryAllTables() {
    try {
        const pool = mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: 'zsz12345',
            database: 'ctcsdk_testplan'
        });
        
        console.log('Connected to database');
        
        // Get all tables
        const [tablesResult] = await pool.execute('SHOW TABLES');
        const tables = tablesResult.map(table => table[Object.keys(table)[0]]);
        
        console.log(`\nFound ${tables.length} tables:`);
        tables.forEach((table, index) => {
            console.log(`${index + 1}. ${table}`);
        });
        
        // For each table, get structure and content
        for (const table of tables) {
            console.log(`\n\n========================================`);
            console.log(`TABLE: ${table}`);
            console.log(`========================================`);
            
            // Get table structure
            console.log(`\nStructure:`);
            const [columns] = await pool.execute(`DESCRIBE ${table}`);
            columns.forEach(col => {
                console.log(`${col.Field}: ${col.Type} ${col.Null === 'YES' ? '(NULL)' : '(NOT NULL)'} ${col.Key} ${col.Default || ''}`);
            });
            
            // Get table content
            console.log(`\nContent:`);
            try {
                const [rows] = await pool.execute(`SELECT * FROM ${table}`);
                if (rows.length === 0) {
                    console.log('No data');
                } else {
                    console.log(`Found ${rows.length} rows:`);
                    rows.forEach((row, index) => {
                        console.log(`\nRow ${index + 1}:`);
                        for (const [key, value] of Object.entries(row)) {
                            console.log(`  ${key}: ${value}`);
                        }
                    });
                }
            } catch (error) {
                console.error('Error getting table content:', error.message);
            }
        }
        
        pool.end();
    } catch (error) {
        console.error('Database connection error:', error.message);
    }
}

queryAllTables();
