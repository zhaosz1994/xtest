const pool = require('../db');
const logger = require('./logger');
const { safeJson, jsonValue, newId } = require('./agentUtils');
const sdkCliToolService = require('./sdkCliToolService');

/**
 * 深度测试闭环服务
 * 实现 test_dispatch → test_hunt → test_review_gate → test_review → test_completeness_gate 闭环
 * 覆盖不足时自动回到 test_dispatch 触发补测
 */
class DeepTestService {
  constructor() {
    this.sshService = null; // 由外部注入
  }

  /**
   * 设置 SSH 服务（用于真机执行）
   */
  setSshService(sshService) {
    this.sshService = sshService;
  }

  /**
   * test_dispatch: 测试用例派发
   * 将测试点展开为具体可执行的测试用例，分批派发
   */
  async dispatch({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'dispatching', message: '开始派发测试用例' });

    // 获取已展开的测试点（从上下文或前序节点结果）
    const testpoints = context.testpoints || nodeResults.expand_testpoints?.output?.testpoints || [];

    // 获取已有测试用例（补测场景）
    const [existingCases] = await pool.execute(
      'SELECT testpoint_id FROM test_cases WHERE task_id = ? AND status != "archived"',
      [taskId]
    );
    const coveredPoints = new Set(existingCases.map(c => c.testpoint_id));
    const uncoveredPoints = testpoints.filter(tp => !coveredPoints.has(tp.id));

    // 如果没有未覆盖点，也尝试加载已有用例（用于重新执行）
    let pointsToDispatch = uncoveredPoints;
    if (pointsToDispatch.length === 0 && testpoints.length === 0) {
      // 既无测试点也无未覆盖点，生成基础用例
      pointsToDispatch = [{ id: null, name: '基础功能验证', description: '基础功能验证', category: 'functional', priority: 5 }];
    }

    // 生成新测试用例
    const batchSize = node?.config?.batch_size || 10;
    const batches = [];
    for (let i = 0; i < pointsToDispatch.length; i += batchSize) {
      const batch = pointsToDispatch.slice(i, i + batchSize);
      const testCases = await this._generateTestCases(taskId, batch, context, emit);
      batches.push(testCases);
    }

    // 持久化测试用例
    let totalCases = 0;
    for (const batch of batches) {
      for (const tc of batch) {
        await pool.execute(
          `INSERT INTO test_cases (case_id, task_id, testpoint_id, name, description, command_list, expected_result, status, priority, path_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, "pending", ?, ?)`,
          [newId('TC'), taskId, tc.testpointId, tc.name, tc.description, jsonValue(tc.commands), jsonValue(tc.expected), tc.priority || 5, tc.pathType || 'cli_command']
        );
        totalCases++;
      }
    }

    // 记录 retest 计数
    const retestCount = (context.retestCount || 0) + 1;
    context.retestCount = retestCount;
    context.uncoveredPoints = uncoveredPoints.length;

    emit('progress', {
      step: 'dispatched',
      message: `派发 ${totalCases} 条测试用例（第${retestCount}轮）`,
      totalCases,
      retestRound: retestCount,
    });

    return {
      status: 'completed',
      output: {
        total_cases: totalCases,
        batches: batches.length,
        retest_count: retestCount,
        uncovered_points: uncoveredPoints.length,
      }
    };
  }

  /**
   * 调用 LLM 或使用规则生成测试用例
   */
  async _generateTestCases(taskId, testpoints, context, emit) {
    const cases = [];
    // 获取任务的 AI 配置
    let aiConfig = null;
    try {
      const { getUserAIConfig } = require('./aiService');
      const [taskRows] = await pool.execute('SELECT created_by FROM agent_tasks WHERE task_id = ? LIMIT 1', [taskId]);
      if (taskRows.length > 0) {
        aiConfig = await getUserAIConfig(taskRows[0].created_by);
      }
    } catch (e) {
      logger.warn(`[DeepTest] 获取AI配置失败: ${e.message}`);
    }

    for (const tp of testpoints) {
      // 优先用 LLM 生成
      let tc = null;
      if (aiConfig && aiConfig.api_key) {
        try {
          tc = await this._generateWithLLM(tp, context, aiConfig);
        } catch (e) {
          logger.warn(`[DeepTest] LLM生成失败，回退规则: ${e.message}`);
        }
      }
      if (!tc) {
        tc = this._generateWithRules(tp, context);
      }
      cases.push({ ...tc, testpointId: tp.id });
    }
    return cases;
  }

  /**
   * 用 LLM 生成测试用例
   */
  async _generateWithLLM(testpoint, context, aiConfig) {
    const axios = require('axios');
    const { buildAIHeaders } = require('./aiCallWrapper');
    const headers = buildAIHeaders(aiConfig.provider, aiConfig.api_key);
    const prompt = `你是芯片测试专家。请为以下测试点生成具体的CLI测试命令：

测试点: ${testpoint.name}
描述: ${testpoint.description || ''}
分类: ${testpoint.category || 'functional'}
优先级: ${testpoint.priority || 5}

设备信息: ${JSON.stringify(context.deviceInfo || {})}
已有配置: ${JSON.stringify(context.existingConfig || {})}

请输出JSON格式（仅输出JSON，不要其他文字）：
{
  "name": "用例名称",
  "description": "用例描述",
  "commands": ["命令1", "命令2"],
  "expected": { "type": "output_contains|register_value|status_code", "value": "期望值" }
}`;
    const response = await axios.post(aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions', {
      model: aiConfig.model_name || aiConfig.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
    }, { headers, timeout: 30000 });
    const content = response.data?.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('LLM 响应无有效 JSON');
  }

  /**
   * 规则引擎生成测试用例（兜底）
   */
  _generateWithRules(testpoint, context) {
    const name = testpoint.name || '默认用例';
    return {
      name: `验证: ${name}`,
      description: testpoint.description || `对 ${name} 进行基础验证`,
      commands: ['show version', 'show running-config', `show ${name.toLowerCase().replace(/\s+/g, '_')}`],
      expected: { type: 'status_code', value: 0 },
      priority: testpoint.priority || 5,
      pathType: 'cli_command',
    };
  }

  /**
   * test_hunt: 测试执行
   * 执行测试用例，捕获输出
   */
  async hunt({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'hunting', message: '开始执行测试用例' });

    const [cases] = await pool.execute(
      'SELECT * FROM test_cases WHERE task_id = ? AND status = "pending" ORDER BY priority DESC, id ASC',
      [taskId]
    );

    if (cases.length === 0) {
      return {
        status: 'completed',
        output: { stats: { total: 0, pass: 0, fail: 0, error: 0 }, results: [] }
      };
    }

    const parallelSessions = node?.config?.parallel_sessions || 1;
    const timeoutPerCommand = node?.config?.timeout_per_command_ms || 30000;
    const results = [];

    // 分批并发执行
    for (let i = 0; i < cases.length; i += parallelSessions) {
      const batch = cases.slice(i, i + parallelSessions);
      const batchResults = await Promise.all(
        batch.map(tc => this._executeTestCase(tc, context, timeoutPerCommand, emit))
      );
      results.push(...batchResults);
    }

    // 更新测试用例状态
    for (const result of results) {
      await pool.execute(
        'UPDATE test_cases SET status = ?, actual_output = ?, executed_at = NOW() WHERE id = ?',
        [result.verdict, jsonValue(result.output), result.caseId]
      );
    }

    const stats = {
      total: results.length,
      pass: results.filter(r => r.verdict === 'pass').length,
      fail: results.filter(r => r.verdict === 'fail').length,
      error: results.filter(r => r.verdict === 'error').length,
    };

    emit('progress', {
      step: 'hunt_complete',
      message: `执行完成: ${stats.pass}pass/${stats.fail}fail/${stats.error}error`,
      stats,
    });

    return { status: 'completed', output: { stats, results } };
  }

  /**
   * 执行单条测试用例
   */
  async _executeTestCase(testCase, context, timeoutMs, emit) {
    const commands = typeof testCase.command_list === 'string'
      ? safeJson(testCase.command_list, [])
      : (testCase.command_list || []);
    const outputs = [];
    let verdict = 'pass';

    // 获取资源连接配置
    const resourceConnections = context.resourceConnections || {};
    const cliEndpoint = resourceConnections.sdk_cli || null;

    for (const cmd of commands) {
      try {
        emit('command_exec', { caseId: testCase.id, command: cmd });
        let result;
        if (cliEndpoint && context.mode !== 'dry_run' && context.mode !== 'generation') {
          // 通过 connection_profiles 指定的端点执行（cmodel/ssh/http）
          result = await sdkCliToolService.runCommand(null, {
            command: cmd,
            sessionId: context.sshSessionId || 'deep-test',
            mode: context.mode || 'execute',
            resourceConnections,
          });
        } else if (this.sshService && context.sshSessionId) {
          // 回退1: SSH 真机执行
          result = await this.sshService.executeCommand(cmd, {
            timeout: timeoutMs,
            sessionId: context.sshSessionId,
          });
        } else {
          // 回退2: SDK CLI 模拟执行
          result = await sdkCliToolService.runCommand(null, {
            command: cmd,
            sessionId: context.sshSessionId || 'mock',
            mode: context.mode || 'dry_run',
          });
        }
        outputs.push({
          command: cmd,
          output: result.stdout || result.output || '',
          stderr: result.stderr || '',
          exitCode: result.exitCode ?? result.exit_code ?? 0,
        });
        if ((result.exitCode ?? result.exit_code ?? 0) !== 0) verdict = 'fail';
      } catch (error) {
        outputs.push({ command: cmd, error: error.message });
        verdict = 'error';
        break;
      }
    }

    // 与期望结果比对
    const expected = typeof testCase.expected_result === 'string'
      ? safeJson(testCase.expected_result, {})
      : (testCase.expected_result || {});
    if (verdict === 'pass' && expected.type) {
      verdict = this._compareResult(outputs, expected);
    }

    return { caseId: testCase.id, verdict, output: outputs };
  }

  /**
   * 结果比对
   */
  _compareResult(outputs, expected) {
    switch (expected.type) {
      case 'output_contains':
        return outputs.some(o => o.output?.includes(expected.value)) ? 'pass' : 'fail';
      case 'register_value':
        return outputs.some(o => o.output?.includes(expected.value)) ? 'pass' : 'fail';
      case 'status_code':
        return outputs.every(o => o.exitCode === 0) ? 'pass' : 'fail';
      default:
        return 'pass';
    }
  }

  /**
   * test_review_gate: 测试评审门控（快速检查）
   */
  async reviewGate({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'review_gate', message: '测试评审门控检查中' });
    const huntResult = nodeResults.test_hunt?.output;
    if (!huntResult) {
      return { status: 'completed', output: { verdict: 'retry', reason: '无执行结果' } };
    }
    const { stats } = huntResult;
    // 超过 50% 错误，可能是环境问题，重试
    if (stats.error > stats.total * 0.5 && stats.total > 0) {
      return { status: 'completed', output: { verdict: 'retry', reason: '错误率过高，疑似环境问题' } };
    }
    if (stats.fail === 0 && stats.error === 0) {
      return { status: 'completed', output: { verdict: 'pass', reason: '全部通过' } };
    }
    return { status: 'completed', output: { verdict: 'pass', reason: '存在失败用例，进入交叉验证' } };
  }

  /**
   * test_completeness_gate: 完整性门控
   * 判断覆盖是否足够，不足则触发补测
   */
  async completenessGate({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'completeness_gate', message: '完整性门控检查中' });
    const retestCount = context.retestCount || 0;
    const maxRetestLoops = node?.config?.max_retest_loops || 3;
    const coverageThreshold = node?.config?.check_coverage_threshold || 0.9;

    // 计算覆盖率
    let coverageRate = 0;
    let gapCount = 0;
    let gaps = [];

    if (node?.config?.check_hard_constraints && context.hardConstraints) {
      const hardConstraintResult = nodeResults.hard_constraint_check?.output;
      if (hardConstraintResult) {
        coverageRate = hardConstraintResult.coverage_rate || 0;
        gapCount = hardConstraintResult.uncovered?.length || 0;
        gaps = hardConstraintResult.uncovered || [];
      }
    } else {
      // 测试点覆盖率
      const totalTestpoints = context.testpoints?.length || 0;
      const [executedCases] = await pool.execute(
        'SELECT COUNT(DISTINCT testpoint_id) as covered FROM test_cases WHERE task_id = ? AND status IN ("pass","fail") AND testpoint_id IS NOT NULL',
        [taskId]
      );
      const covered = executedCases[0]?.covered || 0;
      coverageRate = totalTestpoints > 0 ? covered / totalTestpoints : 1.0;
      gapCount = totalTestpoints - covered;
    }

    const coverageMet = coverageRate >= coverageThreshold;
    emit('progress', {
      step: 'completeness_checked',
      message: `覆盖率: ${(coverageRate * 100).toFixed(1)}%, 阈值: ${(coverageThreshold * 100).toFixed(1)}%`,
      coverageRate,
      gapCount,
      coverageMet,
    });

    if (!coverageMet && retestCount < maxRetestLoops) {
      context.coverageGaps = gaps;
      return {
        status: 'completed',
        output: {
          coverage_met: false,
          coverage_rate: coverageRate,
          gap_count: gapCount,
          gaps,
          retest_count: retestCount,
          message: `覆盖率不足(${(coverageRate * 100).toFixed(1)}%)，触发第${retestCount + 1}轮补测`,
        }
      };
    }
    if (!coverageMet) {
      emit('warning', { message: `已达最大补测次数 ${maxRetestLoops}，覆盖率 ${(coverageRate * 100).toFixed(1)}%，继续后续流程` });
    }
    return {
      status: 'completed',
      output: {
        coverage_met: true,
        coverage_rate: coverageRate,
        gap_count: gapCount,
        retest_count: retestCount,
        message: `覆盖率${coverageMet ? '达标' : '未达标但已达最大补测次数'}: ${(coverageRate * 100).toFixed(1)}%`,
      }
    };
  }

  /**
   * 查询任务的测试用例
   */
  async listTestCases(taskId, filters = {}) {
    const conditions = ['task_id = ?'];
    const params = [taskId];
    if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
    if (filters.pathType) { conditions.push('path_type = ?'); params.push(filters.pathType); }
    const [rows] = await pool.execute(
      `SELECT * FROM test_cases WHERE ${conditions.join(' AND ')} ORDER BY priority DESC, id ASC`,
      params
    );
    return rows.map(r => ({
      ...r,
      command_list: safeJson(r.command_list, []),
      expected_result: safeJson(r.expected_result, {}),
      actual_output: safeJson(r.actual_output, []),
    }));
  }

  /**
   * 查询任务的测试 Bug
   */
  async listTestBugs(taskId) {
    const [rows] = await pool.execute(
      'SELECT * FROM test_bugs WHERE task_id = ? ORDER BY severity DESC, id DESC',
      [taskId]
    );
    return rows.map(r => ({ ...r, path_results: safeJson(r.path_results, {}) }));
  }

  /**
   * 获取测试统计
   */
  async getTestStats(taskId) {
    const [rows] = await pool.execute(
      `SELECT status, COUNT(*) as cnt FROM test_cases WHERE task_id = ? GROUP BY status`,
      [taskId]
    );
    const stats = { total: 0, pass: 0, fail: 0, error: 0, pending: 0 };
    for (const r of rows) {
      stats[r.status] = r.cnt;
      stats.total += r.cnt;
    }
    return stats;
  }
}

module.exports = new DeepTestService();
module.exports.DeepTestService = DeepTestService;
