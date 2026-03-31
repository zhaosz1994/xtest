const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');
const reportService = require('../services/reportService');
const { getUserAIConfig } = require('../services/aiService');
const { logActivity } = require('./history');
require('dotenv').config();

// 获取测试报告列表（支持分页）
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const { project, status, creator } = req.query;
    
    // 构建查询条件
    let whereClause = '1=1';
    const params = [];
    
    if (project) {
      whereClause += ' AND r.project = ?';
      params.push(project);
    }
    
    if (status) {
      whereClause += ' AND r.status = ?';
      params.push(status);
    }
    
    if (creator) {
      whereClause += ' AND r.creator = ?';
      params.push(creator);
    }
    
    // 获取总数
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM test_reports r WHERE ${whereClause}`,
      params
    );
    const total = countResult[0].total;
    
    // 获取分页数据（使用模板字符串，因为MySQL不支持LIMIT/OFFSET参数化）
    const [testReports] = await pool.execute(`
      SELECT r.id, r.name, r.creator, r.creator_id, r.project, r.iteration, 
             r.report_type, r.summary, r.has_ai_analysis, r.status, r.job_id,
             r.start_date, r.end_date,
             t.name as test_plan_name,
             r.created_at, r.updated_at
      FROM test_reports r
      LEFT JOIN test_plans t ON r.test_plan_id = t.id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `, params);
    
    const formattedReports = testReports.map(report => ({
      id: report.id,
      name: report.name,
      creator: report.creator,
      creatorId: report.creator_id,
      project: report.project,
      iteration: report.iteration,
      testPlan: report.test_plan_name || '',
      type: report.report_type,
      summary: report.summary,
      hasAiAnalysis: report.has_ai_analysis === 1 || report.has_ai_analysis === true,
      status: report.status || 'ready',
      jobId: report.job_id,
      startDate: report.start_date,
      endDate: report.end_date,
      createdAt: report.created_at,
      updatedAt: report.updated_at
    }));
    
    res.json({ 
      success: true, 
      reports: formattedReports,
      pagination: {
        page: page,
        pageSize: pageSize,
        total: total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    console.error('获取测试报告列表错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建测试报告
router.post('/create', authenticateToken, async (req, res) => {
  const { name, creator, project, iteration, testPlan, type, summary, startDate, endDate } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    // 查找测试计划ID
    let testPlanId = null;
    if (testPlan) {
      const [testPlans] = await pool.execute('SELECT id FROM test_plans WHERE name = ?', [testPlan]);
      if (testPlans.length > 0) {
        testPlanId = testPlans[0].id;
      }
    }
    
    const [result] = await pool.execute(`
      INSERT INTO test_reports (name, creator, creator_id, project, iteration, test_plan_id, report_type, summary, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, creator, currentUser.id, project, iteration, testPlanId, type, summary, startDate || null, endDate || null]);
    
    // 记录操作日志
    const reportId = result.insertId;
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '创建测试报告', `创建了测试报告 ${name}`, 'test_report', reportId, ipAddress, userAgent);
    
    res.json({ success: true, message: '测试报告创建成功' });
  } catch (error) {
    console.error('创建测试报告错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新测试报告
router.put('/update/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, creator, project, iteration, testPlan, type, summary, startDate, endDate } = req.body;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    // 查找测试计划ID
    let testPlanId = null;
    if (testPlan) {
      const [testPlans] = await pool.execute('SELECT id FROM test_plans WHERE name = ?', [testPlan]);
      if (testPlans.length > 0) {
        testPlanId = testPlans[0].id;
      }
    }
    
    await pool.execute(`
      UPDATE test_reports
      SET name = ?, creator = ?, project = ?, iteration = ?, test_plan_id = ?, report_type = ?, summary = ?, start_date = ?, end_date = ?
      WHERE id = ?
    `, [name, creator, project, iteration, testPlanId, type, summary, startDate, endDate, id]);
    
    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '更新测试报告', `更新了测试报告 ${name}`, 'test_report', parseInt(id), ipAddress, userAgent);
    
    res.json({ success: true, message: '测试报告更新成功' });
  } catch (error) {
    console.error('更新测试报告错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除测试报告
router.delete('/delete/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const currentUser = req.user;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  
  try {
    // 获取测试报告信息
    const [reports] = await pool.execute('SELECT name FROM test_reports WHERE id = ?', [id]);
    if (reports.length === 0) {
      return res.status(404).json({ success: false, message: '测试报告不存在' });
    }
    
    await pool.execute('DELETE FROM test_reports WHERE id = ?', [id]);
    
    // 记录操作日志
    await logActivity(currentUser.id, currentUser.username, currentUser.role, '删除测试报告', `删除了测试报告 ${reports[0].name}`, 'test_report', parseInt(id), ipAddress, userAgent);
    
    res.json({ success: true, message: '测试报告删除成功' });
  } catch (error) {
    console.error('删除测试报告错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取测试报告详情
router.get('/detail/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const [testReports] = await pool.execute(`
      SELECT r.*, t.name as test_plan_name, r.test_plan_id, r.report_type, r.summary
      FROM test_reports r
      LEFT JOIN test_plans t ON r.test_plan_id = t.id
      WHERE r.id = ?
    `, [id]);
    
    if (testReports.length === 0) {
      return res.status(404).json({ success: false, message: '测试报告不存在' });
    }
    
    const report = testReports[0];
    res.json({ 
      success: true, 
      report: {
        id: report.id,
        name: report.name,
        creator: report.creator,
        project: report.project,
        iteration: report.iteration,
        testPlan: report.test_plan_name || '',
        testPlanId: report.test_plan_id,
        type: report.report_type,
        summary: report.summary,
        startDate: report.start_date,
        endDate: report.end_date,
        createdAt: report.created_at,
        updatedAt: report.updated_at
      }
    });
  } catch (error) {
    console.error('获取测试报告详情错误:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

router.post('/generate/:testPlanId', authenticateToken, async (req, res) => {
  const { testPlanId } = req.params;
  const { useAI = true } = req.body;
  const currentUserId = req.user.id;
  
  try {
    const reportData = await reportService.assembleReportData(testPlanId);
    
    let aiAnalysis = null;
    if (useAI) {
      try {
        const aiModel = await getUserAIConfig(currentUserId);
        
        if (aiModel) {
          aiAnalysis = await generateAIAnalysis(reportData, aiModel);
        }
      } catch (aiError) {
        console.error('AI分析生成失败:', aiError);
      }
    }
    
    const markdownContent = reportService.generateMarkdownReport(reportData, aiAnalysis);
    
    const reportName = `${reportData.testPlan.project || '测试'}_${reportData.testPlan.name || '报告'}_${new Date().toISOString().split('T')[0]}`;
    
    const [existingReport] = await pool.execute(
      'SELECT id, summary FROM test_reports WHERE test_plan_id = ? ORDER BY created_at DESC LIMIT 1',
      [testPlanId]
    );
    
    let reportId;
    let filePath;
    
    if (existingReport.length > 0) {
      reportId = existingReport[0].id;
      const oldFilePath = existingReport[0].summary;
      if (oldFilePath && oldFilePath.startsWith('/')) {
        await reportService.deleteReportFile(oldFilePath);
      }
      filePath = await reportService.saveReportToFile(reportId, markdownContent);
      await pool.execute(`
        UPDATE test_reports 
        SET name = ?, summary = ?, start_date = ?, end_date = ?, updated_at = NOW()
        WHERE id = ?
      `, [reportName, filePath, reportData.testPlan.startDate, reportData.testPlan.endDate, reportId]);
    } else {
      const [result] = await pool.execute(`
        INSERT INTO test_reports (name, creator, project, iteration, test_plan_id, report_type, summary, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        reportName,
        reportData.testPlan.owner,
        reportData.testPlan.project,
        reportData.testPlan.iteration,
        testPlanId,
        'AI生成',
        '',
        reportData.testPlan.startDate,
        reportData.testPlan.endDate
      ]);
      reportId = result.insertId;
      filePath = await reportService.saveReportToFile(reportId, markdownContent);
      await pool.execute('UPDATE test_reports SET summary = ? WHERE id = ?', [filePath, reportId]);
    }
    
    res.json({
      success: true,
      reportId: reportId,
      reportName: reportName,
      markdown: markdownContent,
      statistics: reportData.statistics,
      moduleDistribution: reportData.moduleDistribution,
      priorityDistribution: reportData.priorityDistribution
    });
  } catch (error) {
    console.error('生成测试报告错误:', error);
    res.status(500).json({ success: false, message: '生成报告失败: ' + error.message });
  }
});

router.get('/preview/:testPlanId', authenticateToken, async (req, res) => {
  const { testPlanId } = req.params;
  
  try {
    const reportData = await reportService.assembleReportData(testPlanId);
    const markdownContent = reportService.generateMarkdownReport(reportData, null);
    
    res.json({
      success: true,
      markdown: markdownContent,
      statistics: reportData.statistics,
      moduleDistribution: reportData.moduleDistribution,
      priorityDistribution: reportData.priorityDistribution,
      ownerDistribution: reportData.ownerDistribution,
      failedCases: reportData.failedCases,
      testCases: reportData.testCases,
      testPlan: reportData.testPlan
    });
  } catch (error) {
    console.error('预览测试报告错误:', error);
    res.status(500).json({ success: false, message: '预览报告失败: ' + error.message });
  }
});

router.get('/markdown/:reportId', authenticateToken, async (req, res) => {
  const { reportId } = req.params;
  
  try {
    const [reports] = await pool.execute(
      'SELECT summary FROM test_reports WHERE id = ?',
      [reportId]
    );
    
    if (reports.length === 0) {
      return res.status(404).json({ success: false, message: '报告不存在' });
    }
    
    const summary = reports[0].summary || '';
    let markdown = '';
    
    if (summary.startsWith('/') || summary.includes('report-')) {
      markdown = await reportService.readReportFromFile(summary) || '';
    } else {
      markdown = summary;
    }
    
    res.json({
      success: true,
      markdown: markdown
    });
  } catch (error) {
    console.error('获取报告Markdown错误:', error);
    res.status(500).json({ success: false, message: '获取报告失败' });
  }
});

router.get('/hardware-knowledge', authenticateToken, async (req, res) => {
  try {
    const knowledge = reportService.getHardwareKnowledge();
    res.json({
      success: true,
      knowledge: knowledge
    });
  } catch (error) {
    console.error('获取硬件知识错误:', error);
    res.status(500).json({ success: false, message: '获取硬件知识失败' });
  }
});

async function generateAIAnalysis(reportData, aiModel) {
  const reportService = require('../services/reportService');
  
  const HARDWARE_KNOWLEDGE = reportService.getHardwareKnowledge();
  
  const SYSTEM_PROMPT = `【强制分析原则】
你是一个专业的网络芯片测试分析专家。在分析报文丢弃 (Traffic_Drop) 或流控相关的测试日志时，必须严格遵守以下底层硬件逻辑：
PFC (Priority Flow Control) 帧本身并不占用交换机缓存。
绝对禁止在报告中推导出"由于 PFC 帧过多导致 Buffer 溢出/耗尽"之类的错误结论。如果出现丢包，请引导排查入向映射、死锁或队列调度配置等方向。

${HARDWARE_KNOWLEDGE}

【报告格式规范】
1. 所有分析结论必须基于实际测试数据
2. 时间戳和数据来源必须准确标注
3. 问题分析需要给出具体的模块和用例ID
4. 建议措施需要具体可执行

请严格按照 function calling 的参数格式返回分析结果。`;

  // 直接复用 reportService 已精确计算的失败用例列表
  const failedCases = reportData.failedCases || [];

  // 使用统一的状态判定逻辑获取阻塞用例
  const blockedCases = reportData.testCases.filter(tc => {
    const status = (tc.status || tc.status_name || tc.execution_status || '').toLowerCase();
    return status === '阻塞' || status === 'blocked' || status === 'block';
  });

  // Map-Reduce: 按模块聚合失败用例
  const failedByModule = {};
  failedCases.forEach(tc => {
    const moduleName = tc.module || '未分类';
    if (!failedByModule[moduleName]) {
      failedByModule[moduleName] = { count: 0, cases: [], statusBreakdown: {} };
    }
    failedByModule[moduleName].count++;
    failedByModule[moduleName].cases.push({
      id: tc.caseId || tc.id,
      name: tc.name,
      status: tc.status
    });
    
    const status = tc.status;
    failedByModule[moduleName].statusBreakdown[status] = (failedByModule[moduleName].statusBreakdown[status] || 0) + 1;
  });

  // 生成聚合后的失败用例摘要
  let failedCasesSummary = '';
  const moduleEntries = Object.entries(failedByModule);
  
  if (moduleEntries.length <= 10) {
    failedCasesSummary = moduleEntries.map(([module, data]) => 
      `- ${module}: ${data.count}个失败用例 (${Object.entries(data.statusBreakdown).map(([s, c]) => `${s}: ${c}`).join(', ')})`
    ).join('\n');
  } else {
    failedCasesSummary = `### 失败用例模块分布（共${failedCases.length}个用例，${moduleEntries.length}个模块）\n\n`;
    failedCasesSummary += moduleEntries.slice(0, 15).map(([module, data]) => 
      `- ${module}: ${data.count}个失败用例`
    ).join('\n');
    if (moduleEntries.length > 15) {
      failedCasesSummary += `\n- ... 及其他 ${moduleEntries.length - 15} 个模块`;
    }
  }

  const userPrompt = `请分析以下测试数据并生成报告分析：

## 测试计划信息
- 项目: ${reportData.testPlan.project || '-'}
- 测试计划: ${reportData.testPlan.name || '-'}
- 测试阶段: ${reportData.testPlan.testPhase || '-'}
- 测试负责人: ${reportData.testPlan.owner || '-'}

## 测试统计数据
- 总用例数: ${reportData.statistics.total}
- 通过数: ${reportData.statistics.passed}
- 失败数: ${reportData.statistics.failed}
- 阻塞数: ${reportData.statistics.blocked}
- 未执行: ${reportData.statistics.notRun}
- 通过率: ${reportData.statistics.passRate}%

## 模块覆盖情况
${Object.entries(reportData.moduleDistribution).slice(0, 20).map(([name, stats]) => 
  `- ${name}: 总数${stats.total}, 通过${stats.passed}, 失败${stats.failed}`
).join('\n')}

## 失败用例模块分布
${failedCasesSummary}

## 典型失败用例详情（前10条）
${failedCases.slice(0, 10).map(tc => 
  `- 用例ID: ${tc.caseId || tc.id}, 名称: ${tc.name}, 模块: ${tc.module || '-'}, 状态: ${tc.status}, 错误: ${(tc.errorMessage || '-').substring(0, 100)}`
).join('\n')}

## 阻塞用例详情（前10条）
${blockedCases.slice(0, 10).map(tc => 
  `- 用例ID: ${tc.caseId || tc.id}, 名称: ${tc.name}, 模块: ${tc.module || '-'}`
).join('\n')}

请根据以上数据，调用 fill_report_analysis 函数返回分析结果。`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    const response = await fetch(aiModel.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiModel.api_key}`
      },
      body: JSON.stringify({
        model: aiModel.model_name,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'fill_report_analysis',
            description: '根据提供的测试执行数据，提炼并填充测试报告的总结与评估板块',
            parameters: {
              type: 'object',
              properties: {
                test_strategy: {
                  type: 'string',
                  description: '测试策略【明确测试范围】：根据关联的 module_id 和 test_type，总结本次测试覆盖的功能模块和主要策略。'
                },
                test_summary: {
                  type: 'string',
                  description: '测试总结【明确可否发布】：基于整体 pass_rate、核心缺陷情况，给出明确的结论（例如：达到发布标准，或存在致命缺陷建议暂缓发布）。'
                },
                legacy_issues: {
                  type: 'string',
                  description: '遗留重要问题【明确问题及影响】：重点分析状态为 Fail, ASIC_Hang, Core_Dump, Traffic_Drop 的用例，提取关键 error_message，说明对系统的具体影响。'
                },
                limitations: {
                  type: 'string',
                  description: '限制【明确限制原因】：分析状态为 Block 的用例，或者测试环境中未能覆盖的边界条件，说明本次测试的局限性。'
                }
              },
              required: ['test_strategy', 'test_summary', 'legacy_issues', 'limitations']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'fill_report_analysis' } },
        temperature: 0.3
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`AI API请求失败: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];
      
      if (!choice.message) {
        console.warn('大模型返回格式异常: 缺少 message 字段');
        return null;
      }
      
      const toolCalls = choice.message.tool_calls;
      
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        const firstToolCall = toolCalls[0];
        
        if (!firstToolCall.function || !firstToolCall.function.arguments) {
          console.warn('大模型返回格式异常: tool_calls 结构不完整');
          return null;
        }
        
        let functionArgs = {};
        try {
          const argsStr = firstToolCall.function.arguments;
          if (typeof argsStr === 'string' && argsStr.trim()) {
            functionArgs = JSON.parse(argsStr);
          } else if (typeof argsStr === 'object') {
            functionArgs = argsStr;
          }
        } catch (parseError) {
          console.warn('大模型返回格式破损，使用降级解析:', parseError.message);
          const argsStr = String(firstToolCall.function.arguments);
          const strategyMatch = argsStr.match(/"test_strategy"\s*:\s*"([^"]*)"/);
          const summaryMatch = argsStr.match(/"test_summary"\s*:\s*"([^"]*)"/);
          const issuesMatch = argsStr.match(/"legacy_issues"\s*:\s*"([^"]*)"/);
          const limitationsMatch = argsStr.match(/"limitations"\s*:\s*"([^"]*)"/);
          
          if (strategyMatch) functionArgs.test_strategy = strategyMatch[1];
          if (summaryMatch) functionArgs.test_summary = summaryMatch[1];
          if (issuesMatch) functionArgs.legacy_issues = issuesMatch[1];
          if (limitationsMatch) functionArgs.limitations = limitationsMatch[1];
        }
        
        return {
          summary: `### 测试策略\n\n${functionArgs.test_strategy || '本次测试覆盖了主要功能模块。'}\n\n### 测试总结\n\n${functionArgs.test_summary || '测试按计划完成。'}`,
          riskAnalysis: `### 遗留重要问题\n\n${functionArgs.legacy_issues || '暂无遗留问题。'}`,
          suggestions: `### 测试限制\n\n${functionArgs.limitations || '本次测试覆盖了主要场景。'}`,
          structured: functionArgs
        };
      }
      
      const aiContent = choice.message.content || '';
      if (aiContent) {
        const sections = parseAIContent(aiContent);
        return {
          summary: sections.summary || '### 测试总结\n\n本次测试按计划完成。',
          riskAnalysis: sections.riskAnalysis || '### 风险评估\n\n当前测试结果整体稳定。',
          suggestions: sections.suggestions || '### 改进建议\n\n建议增加测试覆盖。'
        };
      }
      
      console.warn('大模型返回格式异常: 无法解析内容');
      return null;
    }
    
    return null;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('AI分析超时（60秒）');
    } else {
      console.error('AI分析生成异常:', error);
    }
    return null;
  }
}

function parseAIContent(content) {
  const sections = {
    summary: '',
    riskAnalysis: '',
    suggestions: ''
  };
  
  const summaryMatch = content.match(/###\s*测试总结([\s\S]*?)(?=###|$)/i);
  if (summaryMatch) {
    sections.summary = '### 测试总结' + summaryMatch[1].trim();
  }
  
  const riskMatch = content.match(/###\s*风险评估([\s\S]*?)(?=###|$)/i);
  if (riskMatch) {
    sections.riskAnalysis = '### 风险评估' + riskMatch[1].trim();
  }
  
  const suggestMatch = content.match(/###\s*改进建议([\s\S]*?)(?=###|$)/i);
  if (suggestMatch) {
    sections.suggestions = '### 改进建议' + suggestMatch[1].trim();
  }
  
  return sections;
}

// 异步任务存储 (生产环境应使用Redis)
const asyncJobs = new Map();

// 异步生成报告API
router.post('/async-generate', authenticateToken, async (req, res) => {
  const { dimension, targetId, template, splitOptions, reportName, reportDesc, enableAI } = req.body;
  
  try {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    asyncJobs.set(jobId, {
      id: jobId,
      status: 'pending',
      progress: 0,
      message: '任务已创建',
      createdAt: new Date(),
      userId: req.user.id,
      username: req.user.username,
      config: { dimension, targetId, template, splitOptions, reportName, reportDesc, enableAI }
    });
    
    processAsyncJob(jobId, req.body).catch(err => {
      console.error('异步任务执行错误:', err);
      const job = asyncJobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.error = err.message;
        job.progress = 100;
      }
    });
    
    res.json({
      success: true,
      jobId: jobId,
      message: '任务已提交'
    });
  } catch (error) {
    console.error('创建异步任务错误:', error);
    res.status(500).json({ success: false, message: '创建任务失败' });
  }
});

// 获取任务状态API
router.get('/job-status/:jobId', authenticateToken, async (req, res) => {
  const { jobId } = req.params;
  
  try {
    const job = asyncJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
      reportId: job.reportId,
      error: job.error
    });
  } catch (error) {
    console.error('获取任务状态错误:', error);
    res.status(500).json({ success: false, message: '获取任务状态失败' });
  }
});

// 取消任务API
router.post('/cancel-job/:jobId', authenticateToken, async (req, res) => {
  const { jobId } = req.params;
  
  try {
    const job = asyncJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    
    if (job.status === 'pending' || job.status === 'processing') {
      job.status = 'cancelled';
      job.message = '任务已取消';
      asyncJobs.delete(jobId);
    }
    
    res.json({ success: true, message: '任务已取消' });
  } catch (error) {
    console.error('取消任务错误:', error);
    res.status(500).json({ success: false, message: '取消任务失败' });
  }
});

// 异步任务处理函数
async function processAsyncJob(jobId, config) {
  const job = asyncJobs.get(jobId);
  if (!job) return;
  
  let reportId = null;
  
  try {
    console.log(`[报告生成] 开始处理任务 ${jobId}, 配置:`, JSON.stringify(config, null, 2));
    
    job.status = 'processing';
    job.message = '正在创建报告记录...';
    job.progress = 5;
    
    // 先创建一个生成中的报告记录
    const finalReportName = config.reportName || `测试报告_${new Date().toISOString().split('T')[0]}`;
    console.log(`[报告生成] 创建报告记录: ${finalReportName}`);
    
    const [result] = await pool.execute(`
      INSERT INTO test_reports (name, creator, creator_id, project, iteration, report_type, status, job_id, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      finalReportName,
      job.username || '系统生成',
      job.userId || null,
      '',
      '',
      config.template || 'AI生成',
      'generating',
      jobId,
      null,
      null
    ]);
    reportId = result.insertId;
    job.reportId = reportId;
    console.log(`[报告生成] 报告记录创建成功, ID: ${reportId}`);
    
    job.progress = 10;
    job.message = '正在组装数据...';
    
    let reportData;
    
    // 确保 targetId 是整数
    const targetId = parseInt(config.targetId, 10);
    if (isNaN(targetId)) {
      throw new Error(`无效的目标ID: ${config.targetId}`);
    }
    
    console.log(`[报告生成] 数据维度: ${config.dimension}, 目标ID: ${targetId}`);
    
    switch (config.dimension) {
      case 'testplan':
        console.log(`[报告生成] 按测试计划组装数据, testPlanId: ${targetId}`);
        reportData = await reportService.assembleReportData(targetId);
        break;
      case 'project':
        console.log(`[报告生成] 按项目组装数据, projectId: ${targetId}`);
        reportData = await assembleReportByProject(targetId);
        break;
      case 'module':
        console.log(`[报告生成] 按模块组装数据, moduleId: ${targetId}`);
        reportData = await assembleReportByModule(targetId);
        break;
      case 'library':
        console.log(`[报告生成] 按用例库组装数据, libraryId: ${targetId}`);
        reportData = await assembleReportByLibrary(targetId);
        break;
      default:
        throw new Error(`不支持的数据维度: ${config.dimension}`);
    }
    
    console.log(`[报告生成] 数据组装完成, 统计数据:`, JSON.stringify(reportData?.statistics, null, 2));
    
    job.progress = 40;
    job.message = '数据组装完成，正在生成报告...';
    
    let aiAnalysis = null;
    if (config.enableAI) {
      job.message = '正在进行AI分析...';
      job.progress = 50;
      
      try {
        const aiModel = await getUserAIConfig(job.userId);
        
        if (aiModel) {
          aiAnalysis = await generateAIAnalysis(reportData, aiModel);
        }
      } catch (aiError) {
        console.error('[报告生成] AI分析生成失败:', aiError);
      }
    }
    
    job.progress = 70;
    job.message = '正在生成Markdown...';
    
    console.log(`[报告生成] 开始生成Markdown内容`);
    const markdownContent = reportService.generateMarkdownReport(reportData, aiAnalysis);
    console.log(`[报告生成] Markdown内容生成完成, 长度: ${markdownContent.length}`);
    
    job.progress = 85;
    job.message = '正在保存报告...';
    
    const hasAiAnalysis = aiAnalysis ? true : false;
    
    // 更新已创建的报告记录
    await pool.execute(`
      UPDATE test_reports 
      SET project = ?, iteration = ?, test_plan_id = ?, summary = ?, has_ai_analysis = ?, status = ?, start_date = ?, end_date = ?
      WHERE id = ?
    `, [
      reportData.testPlan?.project || '',
      reportData.testPlan?.iteration || '',
      config.dimension === 'testplan' ? config.targetId : null,
      '',
      hasAiAnalysis,
      'ready',
      reportData.testPlan?.startDate || null,
      reportData.testPlan?.endDate || null,
      reportId
    ]);
    
    console.log(`[报告生成] 开始保存报告文件`);
    const filePath = await reportService.saveReportToFile(reportId, markdownContent);
    console.log(`[报告生成] 报告文件保存成功: ${filePath}`);
    
    await pool.execute('UPDATE test_reports SET summary = ? WHERE id = ?', [filePath, reportId]);
    
    job.progress = 100;
    job.status = 'completed';
    job.message = '报告生成完成';
    job.reportId = reportId;
    
    console.log(`[报告生成] 任务 ${jobId} 完成, 报告ID: ${reportId}`);
    
  } catch (error) {
    console.error('[报告生成] 异步任务处理错误:', error);
    console.error('[报告生成] 错误堆栈:', error.stack);
    console.error('[报告生成] 任务配置:', JSON.stringify(config, null, 2));
    
    job.status = 'failed';
    job.error = error.message;
    job.progress = 100;
    
    // 更新报告状态为失败
    if (reportId) {
      try {
        await pool.execute('UPDATE test_reports SET status = ? WHERE id = ?', ['failed', reportId]);
      } catch (e) {
        console.error('[报告生成] 更新报告状态失败:', e);
      }
    }
  }
}

// 按项目组装报告数据
async function assembleReportByProject(projectId) {
  const connection = await pool.getConnection();
  
  try {
    const [projects] = await connection.execute(
      'SELECT * FROM projects WHERE id = ?',
      [projectId]
    );
    
    if (projects.length === 0) {
      throw new Error('项目不存在');
    }
    
    const project = projects[0];
    
    const [testCases] = await connection.execute(`
      SELECT tc.*, m.name as module_name
      FROM test_cases tc
      LEFT JOIN modules m ON tc.module_id = m.id
      LEFT JOIN test_case_projects tcp ON tc.id = tcp.test_case_id
      WHERE tcp.project_id = ? AND (tc.is_deleted = 0 OR tc.is_deleted IS NULL)
    `, [projectId]);
    
    const stats = reportService.calculateStatistics(testCases);
    
    const moduleStats = {};
    testCases.forEach(tc => {
      const moduleName = tc.module_name || '未分类';
      if (!moduleStats[moduleName]) {
        moduleStats[moduleName] = { total: 0, passed: 0, failed: 0, blocked: 0, notRun: 0 };
      }
      moduleStats[moduleName].total++;
      const status = (tc.status_name || tc.status || '').toLowerCase();
      if (status === '通过' || status === 'pass') moduleStats[moduleName].passed++;
      else if (status === '失败' || status === 'fail') moduleStats[moduleName].failed++;
      else if (status === '阻塞' || status === 'blocked') moduleStats[moduleName].blocked++;
      else moduleStats[moduleName].notRun++;
    });
    
    return {
      testPlan: {
        project: project.name,
        name: `${project.name} 项目汇总`,
        owner: project.owner || '-'
      },
      statistics: stats,
      moduleDistribution: moduleStats,
      priorityDistribution: {},
      testCases: testCases
    };
  } finally {
    connection.release();
  }
}

// 按模块组装报告数据
async function assembleReportByModule(moduleId) {
  const connection = await pool.getConnection();
  
  try {
    const [modules] = await connection.execute(
      'SELECT m.*, l.name as library_name FROM modules m LEFT JOIN case_libraries l ON m.library_id = l.id WHERE m.id = ?',
      [moduleId]
    );
    
    if (modules.length === 0) {
      throw new Error('模块不存在');
    }
    
    const module = modules[0];
    
    const [testCases] = await connection.execute(`
      SELECT tc.*, m.name as module_name
      FROM test_cases tc
      LEFT JOIN modules m ON tc.module_id = m.id
      WHERE tc.module_id = ? AND (tc.is_deleted = 0 OR tc.is_deleted IS NULL)
    `, [moduleId]);
    
    const stats = reportService.calculateStatistics(testCases);
    
    return {
      testPlan: {
        project: module.library_name || '-',
        name: `${module.name} 模块报告`,
        owner: '-'
      },
      statistics: stats,
      moduleDistribution: { [module.name]: { total: testCases.length, passed: stats.passed, failed: stats.failed, blocked: stats.blocked, notRun: stats.notRun } },
      priorityDistribution: {},
      testCases: testCases
    };
  } finally {
    connection.release();
  }
}

// 按用例库组装报告数据
async function assembleReportByLibrary(libraryId) {
  const connection = await pool.getConnection();
  
  try {
    const [libraries] = await connection.execute(
      'SELECT * FROM case_libraries WHERE id = ?',
      [libraryId]
    );
    
    if (libraries.length === 0) {
      throw new Error('用例库不存在');
    }
    
    const library = libraries[0];
    
    // 直接使用test_cases表中的library_id字段查询
    const [testCases] = await connection.execute(`
      SELECT tc.*, m.name as module_name
      FROM test_cases tc
      LEFT JOIN modules m ON tc.module_id = m.id
      WHERE tc.library_id = ? AND (tc.is_deleted = 0 OR tc.is_deleted IS NULL)
    `, [libraryId]);
    
    const stats = reportService.calculateStatistics(testCases);
    
    const moduleStats = {};
    testCases.forEach(tc => {
      const moduleName = tc.module_name || '未分类';
      if (!moduleStats[moduleName]) {
        moduleStats[moduleName] = { total: 0, passed: 0, failed: 0, blocked: 0, notRun: 0 };
      }
      moduleStats[moduleName].total++;
      const status = (tc.status_name || tc.status || '').toLowerCase();
      if (status === '通过' || status === 'pass') moduleStats[moduleName].passed++;
      else if (status === '失败' || status === 'fail') moduleStats[moduleName].failed++;
      else if (status === '阻塞' || status === 'blocked') moduleStats[moduleName].blocked++;
      else moduleStats[moduleName].notRun++;
    });
    
    // 按优先级统计
    const priorityStats = {};
    testCases.forEach(tc => {
      const priority = tc.priority || 'P3';
      if (!priorityStats[priority]) {
        priorityStats[priority] = { total: 0, passed: 0, failed: 0 };
      }
      priorityStats[priority].total++;
      const status = (tc.status_name || tc.status || '').toLowerCase();
      if (status === '通过' || status === 'pass') priorityStats[priority].passed++;
      else if (status === '失败' || status === 'fail') priorityStats[priority].failed++;
    });
    
    return {
      testPlan: {
        project: '-',
        name: `${library.name} 用例库报告`,
        owner: library.creator || '-',
        iteration: '-',
        testPhase: '-'
      },
      statistics: stats,
      moduleDistribution: moduleStats,
      priorityDistribution: priorityStats,
      testCases: testCases
    };
  } finally {
    connection.release();
  }
}

// 删除测试报告（权限：管理员或创建者）
router.delete('/:id', authenticateToken, async (req, res) => {
  const reportId = req.params.id;
  const userId = req.user.id;
  const userRole = req.user.role;
  
  try {
    const connection = await pool.getConnection();
    
    try {
      // 获取报告信息
      const [reports] = await connection.execute(
        'SELECT * FROM test_reports WHERE id = ?',
        [reportId]
      );
      
      if (reports.length === 0) {
        connection.release();
        return res.status(404).json({ success: false, message: '报告不存在' });
      }
      
      const report = reports[0];
      
      // 权限检查：管理员或创建者可以删除
      const isAdmin = userRole === '管理员' || userRole === 'admin';
      const isCreator = report.creator_id == userId || report.creator == req.user.username;
      
      if (!isAdmin && !isCreator) {
        connection.release();
        return res.status(403).json({ 
          success: false, 
          message: '您没有权限删除此报告，只有管理员或创建者可以删除' 
        });
      }
      
      // 删除报告文件
      if (report.summary) {
        const fs = require('fs');
        const path = require('path');
        
        if (report.summary.startsWith('/') || report.summary.includes('report-')) {
          const filePath = report.summary;
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[报告] 已删除报告文件: ${filePath}`);
          }
        }
      }
      
      // 删除数据库记录
      await connection.execute('DELETE FROM test_reports WHERE id = ?', [reportId]);
      
      connection.release();
      
      res.json({ success: true, message: '报告删除成功' });
      
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除报告错误:', error);
    res.status(500).json({ success: false, message: '删除报告失败' });
  }
});

module.exports = router;