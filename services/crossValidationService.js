const pool = require('../db');
const logger = require('./logger');
const { safeJson, jsonValue } = require('./agentUtils');
const sdkCliToolService = require('./sdkCliToolService');

/**
 * 多路径交叉验证服务
 * 对每条测试用例，用不同方式（CLI vs 寄存器写 vs 流量触发）验证同一功能
 * 结果不一致即标记 Bug
 */
class CrossValidationService {
  constructor() {
    this.sshService = null;
  }

  setSshService(sshService) {
    this.sshService = sshService;
  }

  /**
   * test_review: 多路径交叉验证
   */
  async review({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'cross_validating', message: '开始多路径交叉验证' });

    const paths = node?.config?.paths || ['cli_command', 'register_write'];
    const minPaths = node?.config?.min_paths || 2;

    // 获取已执行的测试用例
    const [testCases] = await pool.execute(
      'SELECT * FROM test_cases WHERE task_id = ? AND status IN ("pass","fail")',
      [taskId]
    );

    if (testCases.length === 0) {
      return {
        status: 'completed',
        output: { stats: { total_validated: 0, consistent: 0, inconsistent: 0 }, discrepancies: [], results: [] }
      };
    }

    const crossValidationResults = [];
    const discrepancies = [];

    for (const tc of testCases) {
      emit('progress', { step: 'validating', caseId: tc.id, caseName: tc.name });

      // 为每条用例生成多路径验证命令
      let validationCommands;
      try {
        validationCommands = await this._generateCrossValidationCommands(tc, paths, context);
      } catch (e) {
        logger.warn(`[CrossValidation] 生成验证命令失败: ${e.message}`);
        validationCommands = { cli_command: [], register_write: [], traffic_trigger: [] };
      }

      // 执行多路径验证
      const pathResults = {};
      for (const [pathType, commands] of Object.entries(validationCommands)) {
        if (!Array.isArray(commands) || commands.length === 0) continue;
        const results = [];
        for (const cmd of commands) {
          try {
            let result;
            if (this.sshService && context.sshSessionId) {
              result = await this.sshService.executeCommand(cmd, {
                timeout: 15000,
                sessionId: context.sshSessionId,
              });
            } else {
              result = await sdkCliToolService.runCommand(null, {
                command: cmd,
                sessionId: context.sshSessionId || 'mock',
                mode: context.mode || 'dry_run',
              });
            }
            results.push({
              command: cmd,
              output: result.stdout || result.output || '',
              exitCode: result.exitCode ?? result.exit_code ?? 0,
            });
          } catch (error) {
            results.push({ command: cmd, error: error.message });
          }
        }
        pathResults[pathType] = results;
      }

      const comparison = this._comparePathResults(pathResults, tc);
      crossValidationResults.push({
        caseId: tc.id,
        caseName: tc.name,
        pathResults,
        comparison,
      });

      if (!comparison.consistent) {
        discrepancies.push({
          caseId: tc.id,
          caseName: tc.name,
          detail: comparison.discrepancy,
          inconsistentPaths: comparison.inconsistentPaths,
        });
        // 记录 Bug 到 DB
        try {
          await pool.execute(
            `INSERT INTO test_bugs (task_id, test_case_id, bug_type, description, path_results, severity, status)
             VALUES (?, ?, "cross_validation_mismatch", ?, ?, "major", "open")`,
            [taskId, tc.id, comparison.discrepancy, jsonValue(pathResults)]
          );
          emit('bug_found', { caseId: tc.id, caseName: tc.name, detail: comparison.discrepancy });
        } catch (e) {
          logger.warn(`[CrossValidation] 记录Bug失败: ${e.message}`);
        }
      }
    }

    const stats = {
      total_validated: crossValidationResults.length,
      consistent: crossValidationResults.filter(r => r.comparison.consistent).length,
      inconsistent: discrepancies.length,
    };

    emit('progress', {
      step: 'validation_complete',
      message: `交叉验证完成: ${stats.consistent}/${stats.total_validated} 一致`,
      stats,
      discrepancies,
    });

    return {
      status: 'completed',
      output: { stats, discrepancies, results: crossValidationResults },
    };
  }

  /**
   * 用 LLM 生成多路径验证命令
   */
  async _generateCrossValidationCommands(testCase, paths, context) {
    // 获取 AI 配置
    let aiConfig = null;
    try {
      const { getUserAIConfig } = require('./aiService');
      const [taskRows] = await pool.execute('SELECT created_by FROM agent_tasks WHERE task_id = ? LIMIT 1', [testCase.task_id]);
      if (taskRows.length > 0) {
        aiConfig = await getUserAIConfig(taskRows[0].created_by);
      }
    } catch (e) {
      logger.warn(`[CrossValidation] 获取AI配置失败: ${e.message}`);
    }

    const commands = typeof testCase.command_list === 'string'
      ? safeJson(testCase.command_list, [])
      : (testCase.command_list || []);

    if (!aiConfig || !aiConfig.api_key) {
      // 规则兜底
      return this._generateRuleBasedCommands(commands, paths);
    }

    try {
      const axios = require('axios');
      const { buildAIHeaders } = require('./aiCallWrapper');
      const prompt = `你是芯片测试专家。请为以下测试用例生成多路径交叉验证命令。

原始测试用例: ${testCase.name} - ${testCase.description || ''}
原始命令: ${JSON.stringify(commands)}

请为以下路径分别生成验证命令:
${paths.map(p => `- ${p}`).join('\n')}

路径说明:
- cli_command: 通过设备CLI接口执行
- register_write: 直接读写寄存器地址
- traffic_trigger: 发送特定报文触发功能

输出JSON（仅输出JSON，不要其他文字）:
{"cli_command": ["命令1"], "register_write": ["命令1"], "traffic_trigger": ["命令1"]}`;

      const response = await axios.post(aiConfig.endpoint || aiConfig.api_url, {
        model: aiConfig.model_name || aiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      }, { headers: buildAIHeaders(aiConfig.provider, aiConfig.api_key), timeout: 30000 });
      const content = response.data?.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      logger.warn(`[CrossValidation] LLM生成失败，回退规则: ${e.message}`);
    }
    return this._generateRuleBasedCommands(commands, paths);
  }

  /**
   * 规则兜底生成验证命令
   */
  _generateRuleBasedCommands(originalCommands, paths) {
    const result = {};
    for (const p of paths) {
      if (p === 'cli_command') {
        result.cli_command = originalCommands.slice();
      } else if (p === 'register_write') {
        // 简单规则：把 show 命令改为 devmem 查询
        result.register_write = originalCommands.map(c => {
          if (c.startsWith('show ')) {
            return `devmem 0x4000 32`;
          }
          return c;
        });
      } else if (p === 'traffic_trigger') {
        result.traffic_trigger = originalCommands.map(c => `# 触发: ${c}`);
      }
    }
    return result;
  }

  /**
   * 比较多路径结果一致性
   */
  _comparePathResults(pathResults, testCase) {
    const paths = Object.keys(pathResults);
    if (paths.length < 2) {
      return { consistent: true, reason: '路径数不足2，无法交叉验证' };
    }
    // 计算每条路径的成功/失败判定
    const pathVerdicts = {};
    for (const [pathType, results] of Object.entries(pathResults)) {
      pathVerdicts[pathType] = {
        allSuccess: results.length > 0 && results.every(r => (r.exitCode ?? 0) === 0 && !r.error),
        hasError: results.some(r => r.error),
      };
    }
    const verdicts = Object.values(pathVerdicts);
    // 所有路径的成功状态一致
    const allConsistent = verdicts.every(v => v.allSuccess === verdicts[0].allSuccess);
    if (allConsistent) {
      return { consistent: true, pathVerdicts };
    }
    // 找出不一致的路径
    const inconsistentPaths = paths.filter(p => pathVerdicts[p].allSuccess !== verdicts[0].allSuccess);
    return {
      consistent: false,
      discrepancy: `路径 ${inconsistentPaths.join(', ')} 与其他路径结果不一致`,
      pathVerdicts,
      inconsistentPaths,
    };
  }

  /**
   * 获取交叉验证结果
   */
  async getResults(taskId) {
    const [bugs] = await pool.execute(
      'SELECT * FROM test_bugs WHERE task_id = ? AND bug_type = "cross_validation_mismatch" ORDER BY severity DESC, id DESC',
      [taskId]
    );
    return bugs.map(b => ({ ...b, path_results: safeJson(b.path_results, {}) }));
  }
}

module.exports = new CrossValidationService();
module.exports.CrossValidationService = CrossValidationService;
