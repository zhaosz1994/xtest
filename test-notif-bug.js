const pool = require('./db');

async function test() {
  try {
    const userId = 1;
    const pageSize = '10';
    const offset = 0;
    
    // Test the exact query
    const [notifications] = await pool.execute(`
      SELECT 
        n.id,
        n.title,
        COALESCE(n.content, n.content_preview) as content,
        n.content_preview,
        n.type,
        n.is_read,
        n.created_at,
        n.data,
        n.sender_id,
        u.username as sender_name
      FROM notifications n
      LEFT JOIN users u ON n.sender_id = u.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(pageSize), parseInt(offset)]);
    
    console.log('Success:', notifications.length);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    process.exit(0);
  }
}

test();
