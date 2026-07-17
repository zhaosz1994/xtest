const logger = require('./logger');

/**
 * Agent 5层容错处理器
 * L1: 超时重试（指数退避）
 * L2: 限流重试（HTTP 429）
 * L3: 瞬断重试（SSH断连→重连）
 * L4: 上下文溢出修复（截断+摘要保留）
 * L5: 空响应修复（注入提示重试）
 */
class AgentErrorHandler {
  constructor(config = {}) {
    this.maxRetries = parseInt(process.env.AGENT_MAX_RETRIES || config.maxRetries || 3);
    this.baseDelayMs = parseInt(process.env.AGENT_BASE_DELAY_MS || config.baseDelayMs || 1000);
    this.maxDelayMs = parseInt(process.env.AGENT_MAX_DELAY_MS || config.maxDelayMs || 30000);
  }

  /**
   * L1: 超时重试（指数退避）
   */
  async withTimeoutRetry(fn, timeoutMs = 60000) {
    let attempt = 0;
    while (attempt <= this.maxRetries) {
      try {
        return await this._withTimeout(fn, timeoutMs);
      } catch (error) {
        const isTimeout = error.code === 'TIMEOUT' || error.message?.includes('timeout') || error.message?.includes('Timeout');
        if (isTimeout && attempt < this.maxRetries) {
          const delay = this._exponentialBackoff(attempt);
          logger.warn(`[AgentErrorHandler] L1 超时重试 ${attempt + 1}/${this.maxRetries}，等待 ${delay}ms`);
          await this._sleep(delay);
          attempt++;
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * L2: 限流重试 (HTTP 429)
   */
  async withRateLimitRetry(fn) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        const isRateLimited = error.response?.status === 429 || error.status === 429 || error.code === 429;
        if (isRateLimited && attempt < this.maxRetries) {
          // 读取 Retry-After 头
          const retryAfterHeader = error.response?.headers?.['retry-after'];
          const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader) * 1000 : this._exponentialBackoff(attempt);
          const delay = Math.min(retryAfter, this.maxDelayMs);
          logger.warn(`[AgentErrorHandler] L2 限流重试 ${attempt + 1}/${this.maxRetries}，等待 ${delay}ms`);
          await this._sleep(delay);
          attempt++;
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * L3: 瞬断重试 (SSH断连 → 重连)
   */
  async withTransientRetry(fn, sshService = null, sessionId = null) {
    let attempt = 0;
    while (attempt <= this.maxRetries) {
      try {
        return await fn();
      } catch (error) {
        if (this._isTransientError(error) && attempt < this.maxRetries) {
          logger.warn(`[AgentErrorHandler] L3 瞬断重试 ${attempt + 1}/${this.maxRetries}: ${error.message}`);
          // 尝试重连 SSH
          if (sshService && sessionId) {
            try {
              await sshService.reconnect(sessionId);
              logger.info(`[AgentErrorHandler] SSH 重连成功: ${sessionId}`);
            } catch (reconnectError) {
              logger.error(`[AgentErrorHandler] SSH 重连失败: ${reconnectError.message}`);
            }
          }
          await this._sleep(this._exponentialBackoff(attempt));
          attempt++;
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * L4: 上下文溢出修复（截断 + 摘要保留）
   */
  async withContextOverflowFix(messages, llmCall, config = {}) {
    const maxTokens = config.maxTokens || 32000;
    const maxContextTokens = maxTokens - 4000; // 预留输出 token
    if (this._estimateTokens(messages) <= maxContextTokens) {
      return llmCall(messages);
    }
    logger.warn(`[AgentErrorHandler] L4 上下文溢出，进行截断+摘要（${this._estimateTokens(messages)} tokens > ${maxContextTokens}）`);
    const truncated = this._truncateMessages(messages, maxContextTokens);
    // 将截断部分生成摘要
    const summary = this._summarizeContext(messages);
    // 在开头注入摘要
    truncated.unshift({
      role: 'system',
      content: `[历史上下文摘要]: ${summary}`
    });
    return llmCall(truncated);
  }

  /**
   * L5: 空响应修复（注入提示重试）
   */
  async withEmptyResponseFix(llmCall, messages) {
    let attempt = 0;
    let currentMessages = [...messages];
    while (attempt <= 2) {
      const response = await llmCall(currentMessages);
      const content = response?.content || response?.choices?.[0]?.message?.content || '';
      if (content.trim().length > 0) {
        return response;
      }
      if (attempt < 2) {
        logger.warn(`[AgentErrorHandler] L5 空响应重试 ${attempt + 1}/2`);
        currentMessages = [...currentMessages, { role: 'user', content: '你的上一次回复为空。请重新生成回复。' }];
        attempt++;
      } else {
        return {
          ...response,
          content: '[空响应兜底回复]',
          fallback: true
        };
      }
    }
  }

  /**
   * 组合容错：L1+L2+L3
   */
  async executeWithFullResilience(fn, options = {}) {
    const { timeoutMs = 60000, sshService = null, sessionId = null } = options;
    // 包装顺序：L2限流 → L1超时 → L3瞬断
    const wrappedWithL2 = async () => this.withRateLimitRetry(fn);
    const wrappedWithL1 = async () => this.withTimeoutRetry(wrappedWithL2, timeoutMs);
    if (sshService && sessionId) {
      return this.withTransientRetry(wrappedWithL1, sshService, sessionId);
    }
    return wrappedWithL1();
  }

  /**
   * 完整容错：L1+L2+L3 + L4+L5（用于 LLM 调用）
   */
  async executeLLMWithFullResilience(messages, llmCall, options = {}) {
    const { timeoutMs = 120000, sshService = null, sessionId = null, maxTokens = 32000 } = options;
    // L4+L5 包装 LLM 调用
    const llmWithL5 = (msgs) => this.withEmptyResponseFix(llmCall, msgs);
    const llmWithL4 = (msgs) => this.withContextOverflowFix(msgs, llmWithL5, { maxTokens });
    // L1+L2+L3 包装整体调用
    return this.executeWithFullResilience(() => llmWithL4(messages), { timeoutMs, sshService, sessionId });
  }

  // ===== 辅助方法 =====

  _withTimeout(fn, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Object.assign(new Error(`操作超时 (${ms}ms)`), { code: 'TIMEOUT' }));
      }, ms);
      Promise.resolve(fn())
        .then(r => { clearTimeout(timer); resolve(r); })
        .catch(e => { clearTimeout(timer); reject(e); });
    });
  }

  _exponentialBackoff(attempt) {
    const delay = Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
    return delay + Math.floor(Math.random() * 1000); // 抖动
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _isTransientError(error) {
    const transientCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH'];
    const transientMessages = ['socket hang up', 'connection reset', 'write ECONNRESET', 'connect ETIMEDOUT', 'connection_lost'];
    if (transientCodes.includes(error.code)) return true;
    return transientMessages.some(m => error.message?.toLowerCase().includes(m.toLowerCase()));
  }

  _estimateTokens(messages) {
    // 粗略估算：3 字符 ≈ 1 token
    return Math.ceil(JSON.stringify(messages).length / 3);
  }

  _truncateMessages(messages, maxTokens) {
    const system = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    while (this._estimateTokens([...system, ...nonSystem]) > maxTokens) {
      if (nonSystem.length <= 2) break; // 至少保留最后 2 条
      nonSystem.shift();
    }
    return [...system, ...nonSystem];
  }

  _summarizeContext(messages) {
    // 简单摘要：提取 tool 消息和 assistant 的关键内容
    const toolMessages = messages.filter(m => m.role === 'tool');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const summaryParts = [];
    if (toolMessages.length > 0) {
      summaryParts.push(`工具调用结果 ${toolMessages.length} 条`);
    }
    if (assistantMessages.length > 0) {
      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      const content = (typeof lastAssistant.content === 'string' ? lastAssistant.content : JSON.stringify(lastAssistant.content)).substring(0, 300);
      summaryParts.push(`最后助手回复: ${content}`);
    }
    return summaryParts.join('；') || '无历史上下文';
  }
}

module.exports = new AgentErrorHandler();
module.exports.AgentErrorHandler = AgentErrorHandler;
