const logger = require('./logger');
const { getAIGenerationParams } = require('./aiService');
const axios = require('axios');
const StreamAdapter = require('./stream/StreamAdapter');
const { ChunkType } = require('./stream/ChunkType');
const IdleTimeoutController = require('./stream/IdleTimeoutController');

const _modelLastRequestTime = new Map();

function buildAIHeaders(provider, apiKey) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (provider === 'openrouter' || provider === 'openai-compatible') {
    headers['HTTP-Referer'] = 'https://xtest.app';
    headers['X-Title'] = 'XTest';
  }

  return headers;
}

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

  const plannedStartTime = Math.max(now, lastTime + intervalMs);
  _modelLastRequestTime.set(key, plannedStartTime);

  if (_modelLastRequestTime.size > 100) {
    const cutoff = Date.now() - 300000;
    for (const [k, v] of _modelLastRequestTime) {
      if (v < cutoff) _modelLastRequestTime.delete(k);
    }
  }

  if (now < plannedStartTime) {
    const waitMs = plannedStartTime - now;
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

async function callAIWithRetry(fn, aiConfig, logContext = {}, options = {}) {
  const { shouldAbort = null } = options;
  const genParams = await getAIGenerationParams();
  const maxRetries = _getMaxRetries(aiConfig, genParams);
  const retryMode = _getRetryMode(aiConfig, genParams);
  const isInfinite = retryMode === 'infinite';
  const retryIntervalMs = _getIntervalMs(aiConfig, genParams) || 5000;

  let lastError = null;
  let attempt = 0;

  while (true) {
    attempt++;
    if (shouldAbort && await shouldAbort()) {
      logger.info('AI调用被中止（任务已取消）', {
        model: aiConfig.model_name,
        attempt,
        ...logContext
      });
      throw new Error('任务已取消');
    }
    try {
      await waitForRateLimit(aiConfig, genParams);
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error;

      if (error.message === '任务已取消') throw error;

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

function _createCompatOnChunk(onChunk) {
  if (!onChunk) return null;
  return (chunk) => {
    if (chunk.type === ChunkType.TEXT_DELTA) {
      onChunk({
        type: 'content',
        content: chunk.text,
        fullContent: chunk.fullText
      });
    } else if (chunk.type === ChunkType.TOOL_CALL_START || chunk.type === ChunkType.TOOL_CALL_DELTA) {
      onChunk({
        type: 'tool_calls_delta',
        delta: chunk.argumentsDelta || null,
        toolCalls: null
      });
    } else if (chunk.type === ChunkType.THINKING_DELTA) {
      onChunk({
        type: 'reasoning_delta',
        text: chunk.text,
        fullText: chunk.fullText
      });
    }
  };
}

async function callAIStream(apiUrl, requestBody, headers, options = {}) {
  const {
    onChunk = null,
    timeout = 300000,
    signal = null,
    middlewares = [],
    idleTimeoutMs = null,
    onStreamChunk = null
  } = options;

  const streamRequestBody = { ...requestBody, stream: true };

  const idleController = idleTimeoutMs
    ? new IdleTimeoutController(idleTimeoutMs, signal)
    : null;
  const effectiveSignal = idleController?.signal || signal;

  const axiosOptions = {
    headers,
    timeout: timeout + 10000,
    responseType: 'stream',
    signal: effectiveSignal
  };

  const response = await axios.post(apiUrl, streamRequestBody, axiosOptions);

  return new Promise((resolve, reject) => {
    const stream = response.data;
    let settled = false;

    const adapter = new StreamAdapter({
      onChunk: onStreamChunk || _createCompatOnChunk(onChunk),
      middlewares,
      idleTimeout: idleController
    });

    adapter.accumulator.markStart();

    stream.on('data', (chunk) => {
      adapter.processRawChunk(chunk);
    });

    stream.on('end', () => {
      if (settled) return;
      settled = true;
      adapter.flush();
      const result = adapter.finalize();
      resolve(result);
    });

    stream.on('error', (err) => {
      if (settled) return;
      settled = true;
      logger.error('AI流式响应读取错误', {
        error: err.message,
        model: requestBody.model
      });
      reject(err);
    });

    stream.on('close', () => {
      if (!adapter.accumulator.finishReason) {
        adapter.accumulator.setFinishReason('interrupted');
        logger.warn('AI流式响应连接被关闭（未正常结束）', {
          model: requestBody.model
        });
      }
    });
  });
}

async function callAIStreamWithRetry(apiUrl, requestBody, headers, aiConfig, options = {}) {
  const { onChunk = null, logContext = {}, signal = null, shouldAbort = null, middlewares = [], idleTimeoutMs = null, onStreamChunk = null } = options;
  const genParams = await getAIGenerationParams();
  const maxRetries = _getMaxRetries(aiConfig, genParams);
  const retryMode = _getRetryMode(aiConfig, genParams);
  const isInfinite = retryMode === 'infinite';
  const retryIntervalMs = _getIntervalMs(aiConfig, genParams) || 5000;

  let lastError = null;
  let attempt = 0;

  while (true) {
    attempt++;
    if (shouldAbort && await shouldAbort()) {
      logger.info('AI流式调用被中止（任务已取消）', {
        model: aiConfig.model_name,
        attempt,
        ...logContext
      });
      throw new Error('任务已取消');
    }
    try {
      await waitForRateLimit(aiConfig, genParams);
      const result = await callAIStream(apiUrl, requestBody, headers, {
        onChunk,
        timeout: options.timeout || 300000,
        signal,
        middlewares,
        idleTimeoutMs,
        onStreamChunk
      });
      return result;
    } catch (error) {
      lastError = error;

      if (error.message === '任务已取消') throw error;

      const isAuthError = error.response && error.response.status === 401;
      if (isAuthError) {
        logger.error('AI流式调用认证失败，不重试', {
          model: aiConfig.model_name,
          status: 401,
          attempt,
          ...logContext
        });
        throw error;
      }

      const shouldRetry = isInfinite || attempt <= maxRetries;
      if (!shouldRetry) {
        logger.error('AI流式调用重试耗尽', {
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
      logger.warn('AI流式调用失败，准备重试', {
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
  buildAIHeaders,
  waitForRateLimit,
  recordRequestTime,
  getRetryDelay,
  callAIWithRetry,
  callAIStream,
  callAIStreamWithRetry,
  ChunkType
};
