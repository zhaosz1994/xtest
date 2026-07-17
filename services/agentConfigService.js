const fs = require('fs').promises;
const path = require('path');
const pool = require('../db');
const logger = require('./logger');
const { safeJson, jsonValue } = require('./agentUtils');

/**
 * Agent 三件套配置服务
 * 每个 Agent 有: config.json (输入契约+工具+参数) + SOUL.md (角色人格) + USER.md (用户偏好)
 * 输入契约四要素: prereq (前置条件) / handoff (交接物) / accumulating (累积状态) / writes (可写资源)
 */
class AgentConfigService {
  constructor() {
    this.configDir = path.join(__dirname, '..', 'agent_configs');
    this.cache = new Map();
  }

  /**
   * 加载 Agent 配置（DB 优先，回退文件系统）
   */
  async loadAgentConfig(agentName) {
    if (this.cache.has(agentName)) {
      return this.cache.get(agentName);
    }
    let config = null;
    // 1. 从 DB 查找
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM agent_configs WHERE agent_name = ? AND status = "active" ORDER BY version DESC LIMIT 1',
        [agentName]
      );
      if (rows.length > 0) {
        config = {
          agentName: rows[0].agent_name,
          agentType: rows[0].agent_type,
          config: safeJson(rows[0].config_json, {}),
          soulMd: rows[0].soul_md || '',
          userMd: rows[0].user_md || '',
          version: rows[0].version,
        };
      }
    } catch (e) {
      logger.warn(`[AgentConfig] 从DB加载配置失败: ${e.message}`);
    }
    // 2. 回退到文件系统
    if (!config) {
      config = await this._loadFromFileSystem(agentName);
    }
    if (config) {
      this.cache.set(agentName, config);
    }
    return config;
  }

  /**
   * 从文件系统加载三件套
   */
  async _loadFromFileSystem(agentName) {
    try {
      // 安全检查：agentName 只允许字母数字下划线，防止路径遍历
      if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
        logger.warn(`[AgentConfig] 无效的 agentName: ${agentName}`);
        return null;
      }
      const agentDir = path.join(this.configDir, agentName);
      const configPath = path.join(agentDir, 'config.json');
      const soulPath = path.join(agentDir, 'SOUL.md');
      const userPath = path.join(agentDir, 'USER.md');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      let soulMd = '';
      let userMd = '';
      try { soulMd = await fs.readFile(soulPath, 'utf-8'); } catch {}
      try { userMd = await fs.readFile(userPath, 'utf-8'); } catch {}
      return {
        agentName,
        agentType: config.agent_type || 'ai',
        config,
        soulMd,
        userMd,
        version: 1,
        source: 'filesystem',
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取输入契约
   */
  async getInputContract(agentName) {
    const agentConfig = await this.loadAgentConfig(agentName);
    if (!agentConfig) return null;
    return agentConfig.config?.input_contract || {
      prereq: [],
      handoff: [],
      accumulating: [],
      writes: [],
    };
  }

  /**
   * 验证契约是否满足（前置条件检查）
   */
  async validateContract(agentName, nodeResults, sharedState) {
    const contract = await this.getInputContract(agentName);
    if (!contract) return { valid: true, missing: [] };
    const missing = [];
    // 检查 prereq（前置条件的节点是否已执行）
    if (Array.isArray(contract.prereq)) {
      for (const prereq of contract.prereq) {
        if (typeof prereq === 'string') {
          // prereq 是节点 id
          if (!nodeResults[prereq]) {
            missing.push(`前置节点 ${prereq} 未执行`);
          }
        } else if (typeof prereq === 'object' && prereq.node) {
          if (!nodeResults[prereq.node]) {
            missing.push(`前置节点 ${prereq.node} 未执行`);
          }
        }
      }
    }
    // 检查 sharedState 中的字段
    if (Array.isArray(contract.prereq)) {
      for (const prereq of contract.prereq) {
        if (typeof prereq === 'object' && prereq.state_key) {
          if (sharedState[prereq.state_key] === undefined) {
            missing.push(`共享状态缺少 ${prereq.state_key}`);
          }
        }
      }
    }
    return { valid: missing.length === 0, missing };
  }

  /**
   * 组装 Agent 完整上下文（用于 LLM 调用）
   */
  async buildAgentContext(agentName, nodeResults, sharedState) {
    const agentConfig = await this.loadAgentConfig(agentName);
    if (!agentConfig) {
      return {
        systemPrompt: '你是一个专业的芯片测试Agent。',
        tools: [],
        context: sharedState,
      };
    }
    // 组装系统提示词（SOUL.md + 输入契约）
    const contract = agentConfig.config?.input_contract || {};
    const handoff = contract.handoff || [];
    // 从 nodeResults 中提取交接物
    const handoffData = {};
    for (const h of handoff) {
      if (typeof h === 'string' && nodeResults[h]) {
        handoffData[h] = nodeResults[h].output;
      }
    }
    const systemPrompt = [
      agentConfig.soulMd || '你是一个专业的芯片测试Agent。',
      agentConfig.userMd ? `\n\n# 用户偏好\n${agentConfig.userMd}` : '',
      `\n\n# 输入契约\n交接物: ${JSON.stringify(handoffData).substring(0, 2000)}`,
      `\n# 共享状态\n${JSON.stringify(sharedState).substring(0, 2000)}`,
    ].join('');
    return {
      systemPrompt,
      tools: agentConfig.config?.tools || [],
      context: { ...sharedState, handoff: handoffData },
      config: agentConfig.config,
    };
  }

  /**
   * 保存 Agent 输出到 sharedState
   */
  async saveAgentOutput(agentName, output, sharedState) {
    const contract = await this.getInputContract(agentName);
    const writes = contract?.writes || [];
    const result = { ...sharedState };
    // 按 writes 声明写入
    for (const w of writes) {
      if (typeof w === 'string' && output[w] !== undefined) {
        result[w] = output[w];
      } else if (typeof w === 'object' && w.key && output[w.key] !== undefined) {
        if (w.strategy === 'append' && Array.isArray(result[w.key])) {
          result[w.key] = [...result[w.key], ...output[w.key]];
        } else if (w.strategy === 'merge' && typeof result[w.key] === 'object') {
          result[w.key] = { ...result[w.key], ...output[w.key] };
        } else {
          result[w.key] = output[w.key];
        }
      }
    }
    // 默认写入 output 字段
    if (output && Object.keys(output).length > 0 && writes.length === 0) {
      result[`${agentName}_output`] = output;
    }
    return result;
  }

  /**
   * 保存 Agent 配置到 DB
   */
  async saveAgentConfig(agentName, config, soulMd = '', userMd = '', agentType = 'ai') {
    const configJson = typeof config === 'string' ? config : JSON.stringify(config);
    // 版本递增
    const [existing] = await pool.execute(
      'SELECT MAX(version) as max_version FROM agent_configs WHERE agent_name = ?',
      [agentName]
    );
    const newVersion = (existing[0]?.max_version || 0) + 1;
    await pool.execute(
      `INSERT INTO agent_configs (agent_name, agent_type, config_json, soul_md, user_md, version, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [agentName, agentType, configJson, soulMd, userMd, newVersion]
    );
    // 旧版本归档
    await pool.execute(
      'UPDATE agent_configs SET status = "archived" WHERE agent_name = ? AND version < ?',
      [agentName, newVersion]
    );
    this.cache.delete(agentName);
    logger.info(`[AgentConfig] Agent 配置已保存: ${agentName} v${newVersion}`);
    return { agentName, version: newVersion };
  }

  /**
   * 列出所有 Agent 配置
   */
  async listAgentConfigs() {
    try {
      const [rows] = await pool.execute(
        'SELECT agent_name, agent_type, version, status, updated_at FROM agent_configs WHERE status = "active" ORDER BY agent_name'
      );
      return rows;
    } catch (e) {
      return [];
    }
  }

  /**
   * 获取 Agent 配置详情
   */
  async getAgentConfig(agentName) {
    return this.loadAgentConfig(agentName);
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new AgentConfigService();
module.exports.AgentConfigService = AgentConfigService;
