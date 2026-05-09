const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');
const logger = require('../services/logger');

router.get('/recent', authenticateToken, async (req, res) => {
  try {
    const limit = sanitizeLimit(req.query.limit);
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
    const limit = sanitizeLimit(req.query.limit);
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
    const days = sanitizeDays(req.query.days);
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
    const days = sanitizeDays(req.query.days);
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
    const days = sanitizeDays(req.query.days);
    
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
    const days = sanitizeDays(req.query.days);
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
    const days = sanitizeDays(req.query.days);
    
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

router.get('/agent-stats', authenticateToken, async (req, res) => {
  try {
    const days = sanitizeDays(req.query.days);

    const [agentStats] = await pool.execute(`
      SELECT 
        l.item_code AS agent_code,
        l.item_name AS display_name,
        COUNT(*) AS usage_count,
        COUNT(CASE WHEN l.status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN l.status = 'failed' THEN 1 END) AS failed_count,
        AVG(l.execution_time_ms) AS avg_execution_time,
        MAX(l.execution_time_ms) AS max_execution_time,
        MIN(l.execution_time_ms) AS min_execution_time,
        SUM(l.total_tokens) AS total_tokens,
        AVG(l.total_tokens) AS avg_tokens,
        COUNT(DISTINCT l.user_id) AS unique_users,
        COUNT(DISTINCT l.source) AS unique_sources
      FROM ai_agent_tool_usage_logs l
      WHERE l.item_type = 'sub_agent'
        AND l.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY l.item_code, l.item_name
      ORDER BY usage_count DESC
    `);

    const [sourceStats] = await pool.execute(`
      SELECT 
        source,
        COUNT(*) AS usage_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count,
        AVG(execution_time_ms) AS avg_execution_time
      FROM ai_agent_tool_usage_logs
      WHERE item_type = 'sub_agent'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND source IS NOT NULL
      GROUP BY source
      ORDER BY usage_count DESC
    `);

    const [dailyTrend] = await pool.execute(`
      SELECT 
        DATE(created_at) AS date,
        COUNT(*) AS total_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count
      FROM ai_agent_tool_usage_logs
      WHERE item_type = 'sub_agent'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    const [unregisteredAgents] = await pool.execute(`
      SELECT l.item_code AS agent_code, l.item_name AS display_name
      FROM ai_agent_tool_usage_logs l
      LEFT JOIN ai_sub_agents a ON l.item_code = a.agent_code
      WHERE l.item_type = 'sub_agent'
        AND a.id IS NULL
        AND l.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY l.item_code, l.item_name
    `);

    res.json({
      success: true,
      stats: {
        agents: agentStats,
        bySource: sourceStats,
        daily: dailyTrend,
        unregistered: unregisteredAgents
      }
    });
  } catch (error) {
    logger.error('获取Sub-Agent使用统计失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取Sub-Agent使用统计失败'
    });
  }
});

router.get('/tool-stats', authenticateToken, async (req, res) => {
  try {
    const days = sanitizeDays(req.query.days);

    const [toolStats] = await pool.execute(`
      SELECT 
        l.item_code AS tool_name,
        l.item_name AS display_name,
        COUNT(*) AS usage_count,
        COUNT(CASE WHEN l.status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN l.status = 'failed' THEN 1 END) AS failed_count,
        AVG(l.execution_time_ms) AS avg_execution_time,
        MAX(l.execution_time_ms) AS max_execution_time,
        MIN(l.execution_time_ms) AS min_execution_time,
        COUNT(DISTINCT l.user_id) AS unique_users,
        COUNT(DISTINCT l.source) AS unique_sources
      FROM ai_agent_tool_usage_logs l
      WHERE l.item_type = 'custom_tool'
        AND l.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY l.item_code, l.item_name
      ORDER BY usage_count DESC
    `);

    const [sourceStats] = await pool.execute(`
      SELECT 
        source,
        COUNT(*) AS usage_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count,
        AVG(execution_time_ms) AS avg_execution_time
      FROM ai_agent_tool_usage_logs
      WHERE item_type = 'custom_tool'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND source IS NOT NULL
      GROUP BY source
      ORDER BY usage_count DESC
    `);

    const [dailyTrend] = await pool.execute(`
      SELECT 
        DATE(created_at) AS date,
        COUNT(*) AS total_count,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count
      FROM ai_agent_tool_usage_logs
      WHERE item_type = 'custom_tool'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    const [unregisteredTools] = await pool.execute(`
      SELECT l.item_code AS tool_name, l.item_name AS display_name
      FROM ai_agent_tool_usage_logs l
      LEFT JOIN ai_custom_tools t ON l.item_code = t.tool_name
      WHERE l.item_type = 'custom_tool'
        AND t.id IS NULL
        AND l.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY l.item_code, l.item_name
    `);

    const [agentToolRelation] = await pool.execute(`
      SELECT 
        JSON_UNQUOTE(JSON_EXTRACT(l.context_info, '$.agentCode')) AS agent_code,
        l.item_code AS tool_name,
        COUNT(*) AS usage_count
      FROM ai_agent_tool_usage_logs l
      WHERE l.item_type = 'custom_tool'
        AND l.source = 'agent_loop'
        AND l.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
        AND JSON_EXTRACT(l.context_info, '$.agentCode') IS NOT NULL
      GROUP BY agent_code, l.item_code
      ORDER BY usage_count DESC
    `);

    res.json({
      success: true,
      stats: {
        tools: toolStats,
        bySource: sourceStats,
        daily: dailyTrend,
        unregistered: unregisteredTools,
        agentToolRelation: agentToolRelation
      }
    });
  } catch (error) {
    logger.error('获取自定义工具使用统计失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取自定义工具使用统计失败'
    });
  }
});

router.get('/agent-tool-overview', authenticateToken, async (req, res) => {
  try {
    const days = sanitizeDays(req.query.days);

    const [agentOverview] = await pool.execute(`
      SELECT 
        COUNT(*) AS total_agent_calls,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count,
        COUNT(DISTINCT item_code) AS unique_agents,
        AVG(execution_time_ms) AS avg_execution_time
      FROM ai_agent_tool_usage_logs
      WHERE item_type = 'sub_agent'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
    `);

    const [toolOverview] = await pool.execute(`
      SELECT 
        COUNT(*) AS total_tool_calls,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS success_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed_count,
        COUNT(DISTINCT item_code) AS unique_tools,
        AVG(execution_time_ms) AS avg_execution_time
      FROM ai_agent_tool_usage_logs
      WHERE item_type = 'custom_tool'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
    `);

    const [topAgents] = await pool.execute(`
      SELECT 
        item_code AS agent_code,
        item_name AS display_name,
        COUNT(*) AS usage_count
      FROM ai_agent_tool_usage_logs
      WHERE item_type = 'sub_agent'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY item_code, item_name
      ORDER BY usage_count DESC
      LIMIT 5
    `);

    const [topTools] = await pool.execute(`
      SELECT 
        item_code AS tool_name,
        item_name AS display_name,
        COUNT(*) AS usage_count
      FROM ai_agent_tool_usage_logs
      WHERE item_type = 'custom_tool'
        AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY item_code, item_name
      ORDER BY usage_count DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      overview: {
        agent: agentOverview[0],
        tool: toolOverview[0],
        topAgents,
        topTools
      }
    });
  } catch (error) {
    logger.error('获取Agent/Tool概览统计失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取Agent/Tool概览统计失败'
    });
  }
});

const ADMIN_ROLES = ['管理员', 'admin', 'Administrator'];

function sanitizeDays(days) {
  const d = parseInt(days) || 30;
  return Math.max(1, Math.min(365, d));
}

function sanitizeLimit(limit, max = 500) {
  const l = parseInt(limit) || 100;
  return Math.max(1, Math.min(max, l));
}

router.get('/request-logs', authenticateToken, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, triggerType, status, keyword, startDate, endDate } = req.query;
    const isAdminUser = ADMIN_ROLES.includes(req.user.role);

    const DATE_REGEX = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;
    if (startDate && !DATE_REGEX.test(startDate)) {
      return res.status(400).json({ success: false, message: 'startDate格式无效' });
    }
    if (endDate && !DATE_REGEX.test(endDate)) {
      return res.status(400).json({ success: false, message: 'endDate格式无效' });
    }

    let whereConditions = [];
    let params = [];

    if (!isAdminUser) {
      whereConditions.push('user_id = ?');
      params.push(req.user.id);
    }

    if (triggerType) {
      whereConditions.push('trigger_type = ?');
      params.push(triggerType);
    }
    if (status) {
      whereConditions.push('status = ?');
      params.push(status);
    }
    if (keyword) {
      const escapedKeyword = keyword.replace(/%/g, '\\%').replace(/_/g, '\\_');
      whereConditions.push('(LEFT(system_prompt, 500) LIKE ? OR LEFT(user_prompt, 500) LIKE ? OR LEFT(ai_response, 500) LIKE ?)');
      params.push(`%${escapedKeyword}%`, `%${escapedKeyword}%`, `%${escapedKeyword}%`);
    }
    if (startDate) {
      whereConditions.push('created_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      whereConditions.push('created_at <= ?');
      params.push(endDate);
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    const safePageSize = Math.max(1, Math.min(50, parseInt(pageSize) || 20));
    const safePage = Math.max(1, parseInt(page) || 1);
    const offset = (safePage - 1) * safePageSize;

    const [logs] = await pool.execute(`
      SELECT
        id, user_id, username, trigger_type, trigger_source, trigger_source_name,
        LEFT(system_prompt, 200) AS system_prompt_preview,
        LEFT(user_prompt, 200) AS user_prompt_preview,
        LEFT(ai_response, 200) AS ai_response_preview,
        prompt_tokens, completion_tokens, total_tokens,
        model_name, status, error_message, execution_time_ms,
        project_id, library_id, module_id, ip_address, created_at
      FROM ai_request_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${safePageSize} OFFSET ${offset}
    `, params);

    const countParams = [...params];
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) AS total FROM ai_request_logs ${whereClause}`,
      countParams
    );

    res.json({
      success: true,
      logs,
      isAdmin: isAdminUser,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total: countResult[0].total
      }
    });
  } catch (error) {
    logger.error('获取AI请求日志失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取AI请求日志失败'
    });
  }
});

router.get('/request-logs/stats', authenticateToken, async (req, res) => {
  try {
    const isAdminUser = ADMIN_ROLES.includes(req.user.role);

    let userCondition = '';
    let params = [];

    if (!isAdminUser) {
      userCondition = 'WHERE user_id = ?';
      params.push(req.user.id);
    }

    const [totalStats] = await pool.execute(`
      SELECT
        COUNT(*) AS totalRequests,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS successCount,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failedCount,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(AVG(total_tokens), 0) AS avgTokensPerRequest
      FROM ai_request_logs
      ${userCondition}
    `, params);

    const [byType] = await pool.execute(`
      SELECT
        trigger_type,
        COUNT(*) AS count,
        COALESCE(SUM(total_tokens), 0) AS tokens
      FROM ai_request_logs
      ${userCondition}
      GROUP BY trigger_type
      ORDER BY count DESC
    `, params);

    const [byModel] = await pool.execute(`
      SELECT
        model_name,
        COUNT(*) AS count,
        COALESCE(SUM(total_tokens), 0) AS tokens
      FROM ai_request_logs
      ${userCondition}
      GROUP BY model_name
      ORDER BY count DESC
    `, params);

    res.json({
      success: true,
      isAdmin: isAdminUser,
      stats: {
        totalRequests: totalStats[0].totalRequests || 0,
        successCount: totalStats[0].successCount || 0,
        failedCount: totalStats[0].failedCount || 0,
        totalTokens: totalStats[0].totalTokens || 0,
        avgTokensPerRequest: Math.round(totalStats[0].avgTokensPerRequest || 0),
        byType: byType || [],
        byModel: byModel || []
      }
    });
  } catch (error) {
    logger.error('获取AI请求日志统计失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取AI请求日志统计失败'
    });
  }
});

router.get('/request-logs/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdminUser = ADMIN_ROLES.includes(req.user.role);

    const [logs] = await pool.execute(
      `SELECT id, user_id, username, trigger_type, trigger_source, trigger_source_name,
        LEFT(system_prompt, 50000) AS system_prompt,
        LEFT(user_prompt, 50000) AS user_prompt,
        LEFT(ai_response, 50000) AS ai_response,
        prompt_tokens, completion_tokens, total_tokens, model_name,
        status, error_message, execution_time_ms,
        project_id, library_id, module_id, ip_address, created_at,
        LENGTH(system_prompt) AS system_prompt_length,
        LENGTH(user_prompt) AS user_prompt_length,
        LENGTH(ai_response) AS ai_response_length
      FROM ai_request_logs WHERE id = ?`,
      [id]
    );

    if (logs.length === 0) {
      return res.status(404).json({ success: false, message: '日志不存在' });
    }

    const log = logs[0];

    if (!isAdminUser && log.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权查看此日志' });
    }

    res.json({ success: true, log });
  } catch (error) {
    logger.error('获取AI请求日志详情失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取AI请求日志详情失败'
    });
  }
});

module.exports = router;
