const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken, requireAdmin, isAdmin } = require('../middleware');
const logger = require('../services/logger');
const memoryEngine = require('../services/memoryEngine');

// GET /tree/:agentId - 获取记忆树结构
router.get('/tree/:agentId', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const data = await memoryEngine.getMemoryTree(agentId);
    res.json({ success: true, data: { global: data.global, libraries: data.libraries } });
  } catch (err) {
    logger.error('获取记忆树失败:', err);
    res.json({ success: false, message: '获取记忆树失败' });
  }
});

// GET /detail - 获取特定记忆节点内容
router.get('/detail', authenticateToken, async (req, res) => {
  try {
    const { agent_id, library_id, module_id } = req.query;
    if (!agent_id) {
      return res.json({ success: false, message: '缺少 agent_id 参数' });
    }
    const data = await memoryEngine.getMemoryDetail(agent_id, library_id || null, module_id || null);
    res.json({
      success: true,
      data: {
        content: data.content,
        charCount: data.charCount,
        lastDistilledAt: data.lastDistilledAt,
        level: data.level
      }
    });
  } catch (err) {
    logger.error('获取记忆详情失败:', err);
    res.json({ success: false, message: '获取记忆详情失败' });
  }
});

// PUT /update - 手动编辑记忆内容
router.put('/update', authenticateToken, async (req, res) => {
  try {
    const { agent_id, library_id, module_id, content } = req.body;
    if (!agent_id || content === undefined || content === null) {
      return res.json({ success: false, message: '缺少必要参数' });
    }
    await memoryEngine.updateMemory(agent_id, library_id || null, module_id || null, content);
    res.json({ success: true, message: '记忆更新成功' });
  } catch (err) {
    logger.error('更新记忆失败:', err);
    res.json({ success: false, message: '更新记忆失败' });
  }
});

// POST /distill - 手动触发记忆提炼（仅管理员）
router.post('/distill', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { agent_id, library_id, module_id } = req.body;
    if (!agent_id) {
      return res.json({ success: false, message: '缺少 agent_id 参数' });
    }
    const result = await memoryEngine.distillMemory(agent_id, library_id || null, module_id || null);
    res.json({ success: true, message: '记忆提炼完成', data: { distilledContent: result.distilledContent } });
  } catch (err) {
    logger.error('记忆提炼失败:', err);
    res.json({ success: false, message: '记忆提炼失败' });
  }
});

// GET /stats/:agentId - 获取记忆统计信息
router.get('/stats/:agentId', authenticateToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const data = await memoryEngine.getMemoryStats(agentId);
    res.json({
      success: true,
      data: {
        global: data.global,
        library: data.library,
        module: data.module,
        totalChars: data.totalChars,
        lastDistilledAt: data.lastDistilledAt
      }
    });
  } catch (err) {
    logger.error('获取记忆统计失败:', err);
    res.json({ success: false, message: '获取记忆统计失败' });
  }
});

// POST /reset/:agentId - 重置代理的全部记忆（仅管理员，需确认）
router.post('/reset/:agentId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { confirm } = req.body;
    if (!confirm) {
      return res.json({ success: false, message: '请确认重置操作' });
    }
    await memoryEngine.resetAllMemories(agentId);
    res.json({ success: true, message: '全部记忆已重置' });
  } catch (err) {
    logger.error('重置记忆失败:', err);
    res.json({ success: false, message: '重置记忆失败' });
  }
});

module.exports = router;
