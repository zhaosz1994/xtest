const pool = require('./db');

async function addLevel1IdToLevel1Points() {
    try {
        // 1. 首先添加一个允许NULL的level1_id字段
        await pool.execute('ALTER TABLE level1_points ADD COLUMN level1_id VARCHAR(50) UNIQUE');
        console.log('1. 成功为level1_points表添加允许NULL的level1_id字段');

        // 2. 为已存在的行生成唯一的level1_id值
        const [rows] = await pool.execute('SELECT id FROM level1_points WHERE level1_id IS NULL OR level1_id = \'\'');
        for (const row of rows) {
            const level1Id = 'LP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
            await pool.execute('UPDATE level1_points SET level1_id = ? WHERE id = ?', [level1Id, row.id]);
        }
        console.log('2. 成功为已存在的行生成唯一的level1_id值');

        // 3. 最后将level1_id字段修改为NOT NULL
        await pool.execute('ALTER TABLE level1_points MODIFY COLUMN level1_id VARCHAR(50) UNIQUE NOT NULL');
        console.log('3. 成功将level1_id字段修改为NOT NULL');

        await pool.end();
        console.log('所有操作完成');
    } catch (error) {
        console.error('操作失败:', error);
        await pool.end();
    }
}

addLevel1IdToLevel1Points();