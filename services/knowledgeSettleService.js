const pool = require('../db');
const logger = require('./logger');
const { jsonValue } = require('./agentUtils');

/**
 * 知识沉淀服务
 * 工作流完成后自动将生成物（设计理解、测试大纲、测试计划、测试结果、覆盖报告、经验教训）入库
 * 形成知识闭环，后续任务可检索复用
 */
class KnowledgeSettleService {
  constructor() {
    this.knowledgeService = null; // 由外部注入（用于嵌入索引）
  }

  setKnowledgeService(ks) {
    this.knowledgeService = ks;
  }

  /**
   * knowledge_settle: 知识沉淀节点
   */
  async run({ taskId, node, context, nodeResults, emit }) {
    emit('progress', { step: 'settling', message: '开始知识沉淀' });
    const config = node?.config || {};
    const items = [];

    // 1. 设计理解文档
    if (config.persist_understanding && nodeResults.learn_context?.output) {
      items.push(await this._settle(taskId, 'design_understanding', '设计理解文档', nodeResults.learn_context.output));
    }

    // 2. 测试派发结果（测试大纲/计划）
    if (config.persist_test_plan && nodeResults.test_dispatch?.output) {
      let casesData = [];
      try {
        const [cases] = await pool.execute(
          'SELECT id, name, description, status, priority, path_type FROM test_cases WHERE task_id = ? ORDER BY id',
          [taskId]
        );
        casesData = cases;
      } catch (e) { /* 忽略 */ }
      items.push(await this._settle(taskId, 'test_plan', '测试计划', {
        dispatch: nodeResults.test_dispatch.output,
        cases: casesData,
      }));
    }

    // 3. 测试结果
    if (nodeResults.test_hunt?.output) {
      items.push(await this._settle(taskId, 'test_results', '测试结果', {
        stats: nodeResults.test_hunt.output.stats,
        results: nodeResults.test_hunt.output.results?.slice(0, 100), // 限制大小
      }));
    }

    // 4. 交叉验证结果
    if (nodeResults.test_review?.output) {
      items.push(await this._settle(taskId, 'cross_validation', '交叉验证结果', {
        stats: nodeResults.test_review.output.stats,
        discrepancies: nodeResults.test_review.output.discrepancies,
      }));
    }

    // 5. 覆盖报告
    if (nodeResults.hard_constraint_check?.output) {
      items.push(await this._settle(taskId, 'coverage_report', '覆盖报告', nodeResults.hard_constraint_check.output));
    }

    // 6. 经验教训
    if (config.persist_lessons) {
      const lessons = this._extractLessons(taskId, nodeResults);
      if (lessons.length > 0) {
        items.push(await this._settle(taskId, 'lessons_learned', '经验教训', { lessons }));
      }
    }

    // 7. 生成嵌入向量（异步，不阻塞）
    if (this.knowledgeService) {
      for (const item of items) {
        this._embedAsync(item).catch(e => {
          logger.warn(`[KnowledgeSettle] 嵌入失败: ${e.message}`);
        });
      }
    }

    emit('progress', {
      step: 'settled',
      message: `知识沉淀完成: ${items.length} 条`,
      items: items.map(i => ({ id: i.id, type: i.type, title: i.title })),
    });

    return {
      status: 'completed',
      output: {
        settled_count: items.length,
        items: items.map(i => ({ id: i.id, type: i.type, title: i.title })),
      }
    };
  }

  /**
   * 持久化知识生成物
   */
  async _settle(taskId, type, title, content) {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    const [result] = await pool.execute(
      `INSERT INTO knowledge_artifacts (task_id, artifact_type, title, content, embedding_status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [taskId, type, `任务${taskId}-${title}`, contentStr]
    );
    return {
      id: result.insertId,
      type,
      title: `任务${taskId}-${title}`,
      content: contentStr,
    };
  }

  /**
   * 提取经验教训
   */
  _extractLessons(taskId, nodeResults) {
    const lessons = [];
    // 1. 测试执行中的错误
    const hunt = nodeResults.test_hunt?.output;
    if (hunt?.stats?.error > 0) {
      lessons.push({
        type: 'env',
        severity: 'warning',
        lesson: `${hunt.stats.error} 条用例因环境/连接问题失败`,
      });
    }
    // 2. 失败用例
    if (hunt?.stats?.fail > 0) {
      lessons.push({
        type: 'test_failure',
        severity: 'major',
        lesson: `${hunt.stats.fail} 条用例执行失败，需要分析原因`,
      });
    }
    // 3. 交叉验证不一致
    const review = nodeResults.test_review?.output;
    if (review?.discrepancies?.length > 0) {
      lessons.push({
        type: 'cross_validation',
        severity: 'critical',
        lesson: `${review.discrepancies.length} 处多路径验证不一致，可能存在深层 Bug`,
      });
    }
    // 4. 覆盖率不足
    const coverage = nodeResults.hard_constraint_check?.output;
    if (coverage && coverage.coverage_rate < 0.9) {
      lessons.push({
        type: 'coverage',
        severity: 'warning',
        lesson: `硬约束覆盖率 ${(coverage.coverage_rate * 100).toFixed(1)}% 未达标`,
      });
    }
    // 5. 补测轮次
    const completeness = nodeResults.test_completeness_gate?.output;
    if (completeness?.retest_count > 0) {
      lessons.push({
        type: 'retest',
        severity: 'info',
        lesson: `触发 ${completeness.retest_count} 轮补测`,
      });
    }
    return lessons;
  }

  /**
   * 异步生成嵌入向量
   */
  async _embedAsync(item) {
    if (!this.knowledgeService?.embedAndIndex) return;
    try {
      await this.knowledgeService.embedAndIndex(item.id, item.content);
      await pool.execute(
        'UPDATE knowledge_artifacts SET embedding_status = "embedded" WHERE id = ?',
        [item.id]
      );
    } catch (e) {
      await pool.execute(
        'UPDATE knowledge_artifacts SET embedding_status = "failed" WHERE id = ?',
        [item.id]
      );
    }
  }

  /**
   * 查询任务的知识生成物
   */
  async listArtifacts(taskId, filters = {}) {
    const conditions = ['task_id = ?'];
    const params = [taskId];
    if (filters.type) {
      conditions.push('artifact_type = ?');
      params.push(filters.type);
    }
    const [rows] = await pool.execute(
      `SELECT id, task_id, artifact_type, title, embedding_status, created_at
       FROM knowledge_artifacts WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC`,
      params
    );
    return rows;
  }

  /**
   * 获取知识生成物详情
   */
  async getArtifact(artifactId) {
    const [rows] = await pool.execute(
      'SELECT * FROM knowledge_artifacts WHERE id = ? LIMIT 1',
      [artifactId]
    );
    return rows[0] || null;
  }
}

module.exports = new KnowledgeSettleService();
module.exports.KnowledgeSettleService = KnowledgeSettleService;
