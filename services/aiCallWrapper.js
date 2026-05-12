const logger = require('./logger');
const { getAIGenerationParams } = require('./aiService');

const _modelLastRequestTime = new Map();

function _getModelKey(aiConfig) {
  return aiConfig.model_id || aiConfig.endpoint || 'default';
}

function _getIntervalMs(aiConfig, genParams) {
  if (aiConfig.request_interval_ms && parseInt(aiConfig.request_interval_ms) > 0) {
    return parseInt(aiConfig.request_interval_ms);
  }
  if (genParams && genParams.request_interval && parseInt(genParams.request_interval) > 0) {
    return parseInt(genParams.request_interval);
  }
  return 0;
}

function _getMaxRetries(aiConfig, genParams) {
  if (aiConfig.max_retries !== undefined && aiConfig.max_retries !== null) {
    const v = parseInt(aiConfig.max_retries);
    if (!isNaN(v)) return Math.max(0, v);
  }
  if (genParams && genParams.max_retries !== undefined) {
    const v = parseInt(genParams.max_retries);
    if (!isNaN(v)) return Math.max(0, v);
  }
  return 3;
}

function _getRetryMode(aiConfig, genParams) {
  if (aiConfig.retry_mode === 'infinite') return 'infinite';
  if (genParams && genParams.retry_mode === 'infinite') return 'infinite';
  return 'finite';
}

async function waitForRateLimit(aiConfig, genParams) {
  const intervalMs = _getIntervalMs(aiConfig, genParams);
  if (intervalMs <= 0) return;

  const key = _getModelKey(aiConfig);
  const now = Date.now();
  const lastTime = _modelLastRequestTime.get(key) || 0;
  const elapsed = now - lastTime;

  if (elapsed < intervalMs) {
    const waitMs = intervalMs - elapsed;
    logger.debug('AI请求速率限制等待', {
      model: aiConfig.model_name,
      intervalMs,
      waitMs,
      key
    });
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

function recordRequestTime(aiConfig) {
  const key = _getModelKey(aiConfig);
  _modelLastRequestTime.set(key, Date.now());

  if (_modelLastRequestTime.size > 100) {
    const cutoff = Date.now() - 300000;
    for (const [k, v] of _modelLastRequestTime) {
      if (v < cutoff) _modelLastRequestTime.delete(k);
    }
  }
}

function getRetryDelay(retryCount, baseIntervalMs) {
  const baseDelay = baseIntervalMs || 5000;
  const delay = Math.min(baseDelay * Math.pow(1.5, retryCount), 120000);
  const jitter = delay * 0.1 * Math.random();
  return Math.round(delay + jitter);
}

async function callAIWithRetry(fn, aiConfig, logContext = {}) {
  const genParams = await getAIGenerationParams();
  const maxRetries = _getMaxRetries(aiConfig, genParams);
  const retryMode = _getRetryMode(aiConfig, genParams);
  const isInfinite = retryMode === 'infinite';
  const retryIntervalMs = _getIntervalMs(aiConfig, genParams) || 5000;

  let lastError = null;
  let attempt = 0;

  while (true) {
    attempt++;
    try {
      await waitForRateLimit(aiConfig, genParams);
      recordRequestTime(aiConfig);
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error;

      const isAuthError = error.response && error.response.status === 401;
      if (isAuthError) {
        logger.error('AI调用认证失败，不重试', {
          model: aiConfig.model_name,
          status: 401,
          attempt,
          ...logContext
        });
        throw error;
      }

      const shouldRetry = isInfinite || attempt <= maxRetries;
      if (!shouldRetry) {
        logger.error('AI调用重试耗尽', {
          model: aiConfig.model_name,
          attempt,
          maxRetries,
          retryMode,
          error: error.message,
          ...logContext
        });
        throw error;
      }

      const delayMs = getRetryDelay(attempt - 1, retryIntervalMs);
      logger.warn('AI调用失败，准备重试', {
        model: aiConfig.model_name,
        attempt,
        maxRetries: isInfinite ? '∞' : maxRetries,
        nextRetryInMs: delayMs,
        error: error.message,
        ...logContext
      });

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = {
  waitForRateLimit,
  recordRequestTime,
  getRetryDelay,
  callAIWithRetry
};
