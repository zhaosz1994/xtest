const { execFile } = require('child_process');
const path = require('path');
const util = require('util');
const pool = require('../db');
const logger = require('./logger');
const { safeJson, jsonValue, newId } = require('./agentUtils');

const execFileAsync = util.promisify(execFile);

/**
 * 硬约束覆盖裁决服务
 * 从设计文档提取寄存器/状态机/参数矩阵，测试后做机械比对
 */
class HardConstraintService {
  constructor() {
    this.scriptPath = path.join(__dirname, '..', 'scripts', 'cta_extensions', 'coverage_extractor.py');
  }

  /**
   * 从设计文档提取硬约束清单
   * 在 design_understand 阶段调用
   */
  async extractConstraints(taskId, designDocs) {
    const constraints = [];

    // 调用 Python 脚本提取硬约束
    try {
      const input = JSON.stringify({
        action: 'extract',
        documents: designDocs.map(d => ({ name: d.name || 'unknown', content: d.content || '' })),
      });
      const { stdout } = await execFileAsync('python3', [this.scriptPath], {
        input,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const result = JSON.parse(stdout);
      if (result.status === 'success' && Array.isArray(result.constraints)) {
        constraints.push(...result.constraints);
      }
    } catch (error) {
      logger.warn(`[HardConstraint] Python提取失败，回退LLM: ${error.message}`);
      const llmConstraints = await this._extractWithLLM(taskId, designDocs);
      constraints.push(...llmConstraints);
    }

    // 持久化到 DB（去重：相同 task_id + constraint_key 视为已存在）
    let inserted = 0;
    for (const c of constraints) {
      const [existing] = await pool.execute(
        'SELECT id FROM hard_constraints WHERE task_id = ? AND constraint_key = ? LIMIT 1',
        [taskId, c.key]
      );
      if (existing.length > 0) continue;
      await pool.execute(
        `INSERT INTO hard_constraints (task_id, constraint_type, constraint_key, constraint_value, source_doc, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [taskId, c.type, c.key, jsonValue(c.value), c.source || null]
      );
      inserted++;
    }
    logger.info(`[HardConstraint] 任务 ${taskId} 提取硬约束 ${inserted} 条（共 ${constraints.length} 条）`);
    return constraints;
  }

  /**
   * 硬约束覆盖裁决
   * 在 hard_constraint_check 阶段调用
   */
  async check({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'checking', message: '开始硬约束覆盖裁决' });

    // 获取所有硬约束
    const [constraints] = await pool.execute(
      'SELECT * FROM hard_constraints WHERE task_id = ? ORDER BY constraint_type, id',
      [taskId]
    );

    if (constraints.length === 0) {
      emit('warning', { message: '无硬约束清单，跳过机械比对' });
      return {
        status: 'completed',
        output: {
          coverage_rate: 1.0,
          covered: 0,
          uncovered: 0,
          uncovered_details: [],
          total: 0,
          message: '无硬约束清单',
        }
      };
    }

    // 获取测试执行结果
    const [testCases] = await pool.execute(
      'SELECT * FROM test_cases WHERE task_id = ? AND status IN ("pass","fail")',
      [taskId]
    );

    const testOutputs = testCases.map(tc => ({
      caseId: tc.id,
      commands: safeJson(tc.command_list, []),
      output: safeJson(tc.actual_output, []),
      verdict: tc.status,
    }));

    // 调用 Python 脚本做机械比对
    const input = JSON.stringify({
      action: 'compare',
      constraints: constraints.map(c => ({
        id: c.id,
        type: c.constraint_type,
        key: c.constraint_key,
        value: safeJson(c.constraint_value, {}),
      })),
      test_outputs: testOutputs,
    });

    let result;
    try {
      const { stdout } = await execFileAsync('python3', [this.scriptPath], {
        input,
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });
      result = JSON.parse(stdout);
    } catch (error) {
      emit('error', { message: '覆盖比对失败: ' + error.message });
      result = { status: 'error', covered: [], uncovered: constraints.map(c => c.id) };
    }

    // 更新约束状态
    if (Array.isArray(result.covered)) {
      for (const cid of result.covered) {
        await pool.execute(
          'UPDATE hard_constraints SET coverage_status = "covered", covered_at = NOW() WHERE id = ?',
          [cid]
        );
      }
    }
    if (Array.isArray(result.uncovered)) {
      for (const cid of result.uncovered) {
        await pool.execute(
          'UPDATE hard_constraints SET coverage_status = "uncovered", checked_at = NOW() WHERE id = ?',
          [cid]
        );
      }
    }

    const total = constraints.length;
    const coveredCount = result.covered?.length || 0;
    const uncoveredCount = result.uncovered?.length || 0;
    const coverageRate = total > 0 ? coveredCount / total : 1.0;

    // 获取未覆盖约束的详情
    const uncoveredIds = result.uncovered || [];
    const uncoveredDetails = constraints
      .filter(c => uncoveredIds.includes(c.id))
      .map(c => ({
        id: c.id,
        type: c.constraint_type,
        key: c.constraint_key,
        value: safeJson(c.constraint_value, {}),
        source: c.source_doc,
      }));

    emit('progress', {
      step: 'checked',
      message: `硬约束覆盖: ${coveredCount}/${total} (${(coverageRate * 100).toFixed(1)}%)`,
      coverageRate,
      uncovered: uncoveredDetails,
    });

    return {
      status: 'completed',
      output: {
        coverage_rate: coverageRate,
        covered: coveredCount,
        uncovered: uncoveredCount,
        uncovered_details: uncoveredDetails,
        total,
        message: `硬约束覆盖: ${coveredCount}/${total} (${(coverageRate * 100).toFixed(1)}%)`,
      }
    };
  }

  /**
   * LLM fallback 提取硬约束
   */
  async _extractWithLLM(taskId, designDocs) {
    try {
      const { getUserAIConfig } = require('./aiService');
      const { buildAIHeaders } = require('./aiCallWrapper');
      const axios = require('axios');
      const [taskRows] = await pool.execute('SELECT created_by FROM agent_tasks WHERE task_id = ? LIMIT 1', [taskId]);
      if (taskRows.length === 0) return [];
      const aiConfig = await getUserAIConfig(taskRows[0].created_by);
      if (!aiConfig || !aiConfig.api_key) return [];

      const prompt = `你是芯片设计文档分析专家。请从以下设计文档中提取硬约束清单：

1. 寄存器约束：所有可配置寄存器的地址、默认值、读写权限
2. 状态机约束：所有状态转换及其触发条件
3. 参数矩阵约束：所有配置参数的组合矩阵

文档内容:
${designDocs.map(d => d.content || '').join('\n---\n')}

请输出JSON数组（仅输出JSON，不要其他文字）：
[{
  "type": "register|state_machine|parameter_matrix",
  "key": "唯一标识",
  "value": { "具体约束内容" },
  "source": "文档名"
}]`;
      const response = await axios.post(aiConfig.endpoint || aiConfig.api_url, {
        model: aiConfig.model_name || aiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 4000,
      }, { headers: buildAIHeaders(aiConfig.provider, aiConfig.api_key), timeout: 60000 });
      const content = response.data?.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      logger.error(`[HardConstraint] LLM提取失败: ${e.message}`);
    }
    return [];
  }

  /**
   * 获取硬约束清单
   */
  async getConstraints(taskId, filters = {}) {
    const conditions = ['task_id = ?'];
    const params = [taskId];
    if (filters.type) { conditions.push('constraint_type = ?'); params.push(filters.type); }
    if (filters.status) { conditions.push('coverage_status = ?'); params.push(filters.status); }
    const [rows] = await pool.execute(
      `SELECT * FROM hard_constraints WHERE ${conditions.join(' AND ')} ORDER BY constraint_type, id`,
      params
    );
    return rows.map(r => ({ ...r, constraint_value: safeJson(r.constraint_value, {}) }));
  }

  /**
   * 手动添加硬约束
   */
  async addConstraint(taskId, data) {
    const { type, key, value, source } = data;
    if (!type || !key) throw new Error('type 和 key 不能为空');
    const [result] = await pool.execute(
      `INSERT INTO hard_constraints (task_id, constraint_type, constraint_key, constraint_value, source_doc, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [taskId, type, key, jsonValue(value || {}), source || null]
    );
    return { id: result.insertId, taskId, type, key, value, source };
  }

  /**
   * 删除硬约束
   */
  async deleteConstraint(taskId, constraintId) {
    const [result] = await pool.execute(
      'DELETE FROM hard_constraints WHERE id = ? AND task_id = ?',
      [constraintId, taskId]
    );
    return result.affectedRows > 0;
  }

  /**
   * 更新硬约束
   */
  async updateConstraint(taskId, constraintId, data) {
    const { type, key, value, source } = data;
    const updates = [];
    const params = [];
    if (type) { updates.push('constraint_type = ?'); params.push(type); }
    if (key) { updates.push('constraint_key = ?'); params.push(key); }
    if (value !== undefined) { updates.push('constraint_value = ?'); params.push(jsonValue(value || {})); }
    if (source !== undefined) { updates.push('source_doc = ?'); params.push(source || null); }
    if (updates.length === 0) throw new Error('没有可更新字段');
    params.push(constraintId, taskId);
    const [result] = await pool.execute(
      `UPDATE hard_constraints SET ${updates.join(', ')} WHERE id = ? AND task_id = ?`,
      params
    );
    if (result.affectedRows === 0) throw new Error('约束不存在或无权更新');
    return { id: constraintId, taskId, updated: updates.length };
  }

  /**
   * 获取覆盖率统计
   */
  async getCoverageStats(taskId) {
    const [rows] = await pool.execute(
      `SELECT constraint_type, status, COUNT(*) as cnt
       FROM hard_constraints WHERE task_id = ?
       GROUP BY constraint_type, status`,
      [taskId]
    );
    const stats = {};
    for (const r of rows) {
      if (!stats[r.constraint_type]) {
        stats[r.constraint_type] = { total: 0, covered: 0, uncovered: 0, pending: 0 };
      }
      stats[r.constraint_type].total += r.cnt;
      if (r.status === 'covered') stats[r.constraint_type].covered += r.cnt;
      else if (r.status === 'uncovered') stats[r.constraint_type].uncovered += r.cnt;
      else stats[r.constraint_type].pending += r.cnt;
    }
    return stats;
  }
}

module.exports = new HardConstraintService();
module.exports.HardConstraintService = HardConstraintService;
