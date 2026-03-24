const pool = require('./db');

async function updateOrderIndex() {
  try {
    console.log('=== 更新level1_points表的order_index ===\n');
    
    // 1. 获取所有level1_points记录，按created_at排序
    const [points] = await pool.execute('SELECT id, name, created_at FROM level1_points ORDER BY created_at ASC');
    
    console.log('当前记录（按创建时间排序）:');
    points.forEach((point, index) => {
      console.log(`${index + 1}. id: ${point.id}, name: ${point.name}, created_at: ${point.created_at}`);
    });
    
    // 2. 更新每条记录的order_index为其排序位置
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      await pool.execute(
        'UPDATE level1_points SET order_index = ? WHERE id = ?',
        [i, point.id]
      );
      console.log(`已更新 id=${point.id} 的order_index为 ${i}`);
    }
    
    // 3. 验证更新结果
    const [updatedPoints] = await pool.execute('SELECT id, name, order_index FROM level1_points ORDER BY order_index ASC');
    
    console.log('\n更新后结果:');
    updatedPoints.forEach(point => {
      console.log(`id: ${point.id}, name: ${point.name}, order_index: ${point.order_index}`);
    });
    
    console.log('\n=== 更新完成 ===');
    await pool.end();
    
  } catch (error) {
    console.error('更新失败:', error);
    await pool.end();
  }
}

updateOrderIndex();