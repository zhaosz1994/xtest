const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');
const logger = require('../services/logger');

router.get('/recent', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const [logs] = await pool.execute(`
      SELECT 
        id,
        user_id,
        username,
        skill_name,
        skill_id,
        operation_type,
        sql_query,
        sql_params,
        tables_accessed,
        result_count,
        execution_time_ms,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        model_name,
        status,
        error_message,
        ip_address,
        created_at
      FROM ai_operation_logs
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    
    res.json({
      success: true,
      logs: logs
    });
  } catch (error) {
    logger.error('获取AI操作日志失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取AI操作日志失败'
    });
  }
});

router.get('/failed', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const [logs] = await pool.execute(`
      SELECT 
        id,
        user_id,
        username,
        skill_name,
        skill_id,
        operation_type,
        sql_query,
        sql_params,
        tables_accessed,
        result_count,
        execution_time_ms,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        model_name,
        status,
        error_message,
        ip_address,
        created_at
      FROM ai_operation_logs
      WHERE status = 'failed'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    
    res.json({
      success: true,
      logs: logs
    });
  } catch (error) {
    logger.error('获取失败AI操作日志失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取失败AI操作日志失败'
    });
  }
});

router.get('/skill-stats', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const [stats] = await pool.execute(`
      SELECT 
        skill_name,
        COUNT(*) as usage_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        AVG(execution_time_ms) as avg_execution_time,
        MAX(execution_time_ms) as max_execution_time,
        MIN(execution_time_ms) as min_execution_time,
        SUM(total_tokens) as total_tokens,
        AVG(total_tokens) as avg_tokens
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY skill_name
      ORDER BY usage_count DESC
    `);
    
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    logger.error('获取AI技能使用统计失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取AI技能使用统计失败'
    });
  }
});

router.get('/user-stats', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const [stats] = await pool.execute(`
      SELECT 
        user_id,
        username,
        COUNT(*) as usage_count,
        COUNT(DISTINCT skill_name) as unique_skills_used,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        AVG(execution_time_ms) as avg_execution_time,
        SUM(total_tokens) as total_tokens,
        AVG(total_tokens) as avg_tokens
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY user_id, username
      ORDER BY usage_count DESC
    `);
    
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    logger.error('获取用户AI使用统计失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取用户AI使用统计失败'
    });
  }
});

router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const [totalStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_operations,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        AVG(execution_time_ms) as avg_execution_time,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT skill_name) as unique_skills,
        SUM(total_tokens) as total_tokens,
        AVG(total_tokens) as avg_tokens
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
    `);
    
    const [dailyStats] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        SUM(total_tokens) as total_tokens
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    
    const [topSkills] = await pool.execute(`
      SELECT 
        skill_name,
        COUNT(*) as usage_count,
        SUM(total_tokens) as total_tokens
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY skill_name
      ORDER BY usage_count DESC
      LIMIT 10
    `);
    
    const [topUsers] = await pool.execute(`
      SELECT 
        username,
        COUNT(*) as usage_count,
        SUM(total_tokens) as total_tokens
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY username
      ORDER BY usage_count DESC
      LIMIT 10
    `);
    
    res.json({
      success: true,
      overview: {
        total: totalStats[0],
        daily: dailyStats,
        topSkills: topSkills,
        topUsers: topUsers
      }
    });
  } catch (error) {
    logger.error('获取AI操作概览失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取AI操作概览失败'
    });
  }
});

router.get('/timeline', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const [timeline] = await pool.execute(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d %H:00') as hour,
        COUNT(*) as total_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        SUM(total_tokens) as total_tokens
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d %H:00')
      ORDER BY hour DESC
    `);
    
    res.json({
      success: true,
      timeline: timeline
    });
  } catch (error) {
    logger.error('获取AI操作时间线失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取AI操作时间线失败'
    });
  }
});

router.get('/token-stats', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const [totalTokenStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_operations,
        SUM(total_tokens) as total_tokens,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        AVG(total_tokens) as avg_tokens_per_operation,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT model_name) as unique_models
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND total_tokens > 0
    `);
    
    const [userTokenStats] = await pool.execute(`
      SELECT 
        user_id,
        username,
        COUNT(*) as operation_count,
        SUM(total_tokens) as total_tokens,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        AVG(total_tokens) as avg_tokens_per_operation
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND total_tokens > 0
      GROUP BY user_id, username
      ORDER BY total_tokens DESC
      LIMIT 20
    `);
    
    const [modelTokenStats] = await pool.execute(`
      SELECT 
        model_name,
        COUNT(*) as operation_count,
        SUM(total_tokens) as total_tokens,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        AVG(total_tokens) as avg_tokens_per_operation
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND total_tokens > 0
      GROUP BY model_name
      ORDER BY total_tokens DESC
    `);
    
    const [dailyTokenStats] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as operation_count,
        SUM(total_tokens) as total_tokens,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens
      FROM ai_operation_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND total_tokens > 0
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    
    res.json({
      success: true,
      stats: {
        total: totalTokenStats[0],
        byUser: userTokenStats,
        byModel: modelTokenStats,
        daily: dailyTokenStats
      }
    });
  } catch (error) {
    logger.error('获取Token统计失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取Token统计失败'
    });
  }
});

module.exports = router;
