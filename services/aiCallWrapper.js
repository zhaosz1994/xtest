const logger = require('./logger');
const { getAIGenerationParams } = require('./aiService');
const axios = require('axios');
const { StringDecoder } = require('string_decoder');

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

function _parseSSELine(line) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('data: ') || trimmedLine.startsWith('data:')) {
        const colonIndex = trimmedLine.indexOf(':');
        const data = trimmedLine.slice(colonIndex + 1).trim();
        if (data === '[DONE]') return { done: true };
        try {
            return { done: false, data: JSON.parse(data) };
        } catch (e) {
            logger.warn('SSE行JSON解析失败', {
                linePreview: trimmedLine.substring(0, 200),
                error: e.message
            });
            return { done: false, data: null, parseError: true, rawLine: trimmedLine };
        }
    }
    return null;
}

function _mergeToolCallDeltas(accumulated, delta) {
    if (!delta || !delta.tool_calls) return accumulated;

    for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!accumulated[idx]) {
            accumulated[idx] = {
                id: tc.id || '',
                type: 'function',
                function: {
                    name: tc.function?.name || '',
                    arguments: ''
                }
            };
        }
        if (tc.id) accumulated[idx].id = tc.id;
        if (tc.function?.name) accumulated[idx].function.name = tc.function.name;
        if (tc.function?.arguments) accumulated[idx].function.arguments += tc.function.arguments;
    }
    return accumulated;
}

async function callAIStream(apiUrl, requestBody, headers, options = {}) {
    const {
        onChunk = null,
        timeout = 300000,
        signal = null
    } = options;

    const streamRequestBody = { ...requestBody, stream: true };

    let fullContent = '';
    let reasoningContent = '';
    let toolCallsAccumulated = [];
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let finishReason = null;
    let model = '';
    let sseEventCount = 0;
    let contentChunkCount = 0;
    let parseErrorCount = 0;

    const axiosOptions = {
        headers,
        timeout: timeout + 10000,
        responseType: 'stream',
        signal
    };

    const response = await axios.post(apiUrl, streamRequestBody, axiosOptions);

    return new Promise((resolve, reject) => {
        const stream = response.data;
        const decoder = new StringDecoder('utf8');
        let buffer = '';

        stream.on('data', (chunk) => {
            buffer += decoder.write(chunk);
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const parsed = _parseSSELine(line);
                if (!parsed) continue;
                sseEventCount++;

                if (parsed.done) {
                    finishReason = finishReason || 'stop';
                    continue;
                }
                if (parsed.parseError || !parsed.data) {
                    parseErrorCount++;
                    continue;
                }

                const sseData = parsed.data;
                if (sseData.model) model = sseData.model;
                if (sseData.usage) {
                    usage = {
                        prompt_tokens: sseData.usage.prompt_tokens || 0,
                        completion_tokens: sseData.usage.completion_tokens || 0,
                        total_tokens: sseData.usage.total_tokens || 0
                    };
                }

                const choice = sseData.choices?.[0];
                if (!choice) continue;

                if (choice.finish_reason) {
                    finishReason = choice.finish_reason;
                }

                const delta = choice.delta;
                if (!delta) continue;

                if (delta.content) {
                    fullContent += delta.content;
                    contentChunkCount++;
                    if (onChunk) {
                        onChunk({
                            type: 'content',
                            content: delta.content,
                            fullContent
                        });
                    }
                }

                if (delta.reasoning_content) {
                    reasoningContent += delta.reasoning_content;
                }

                if (delta.tool_calls) {
                    toolCallsAccumulated = _mergeToolCallDeltas(toolCallsAccumulated, delta);
                    if (onChunk) {
                        onChunk({
                            type: 'tool_calls_delta',
                            delta: delta.tool_calls,
                            toolCalls: toolCallsAccumulated
                        });
                    }
                }
            }
        });

        stream.on('end', () => {
            const remaining = decoder.end();
            if (remaining) {
                buffer += remaining;
            }

            if (buffer.trim()) {
                const remainingLines = buffer.split('\n');
                for (const line of remainingLines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;

                    const parsed = _parseSSELine(trimmedLine);
                    if (!parsed) continue;
                    sseEventCount++;

                    if (parsed.done) {
                        finishReason = finishReason || 'stop';
                        continue;
                    }
                    if (parsed.parseError || !parsed.data) {
                        parseErrorCount++;
                        continue;
                    }

                    const sseData = parsed.data;
                    if (sseData.usage) {
                        usage = {
                            prompt_tokens: sseData.usage.prompt_tokens || 0,
                            completion_tokens: sseData.usage.completion_tokens || 0,
                            total_tokens: sseData.usage.total_tokens || 0
                        };
                    }

                    const choice = sseData.choices?.[0];
                    if (!choice) continue;

                    if (choice.finish_reason) {
                        finishReason = choice.finish_reason;
                    }

                    const delta = choice.delta;
                    if (!delta) continue;

                    if (delta.content) {
                        fullContent += delta.content;
                        contentChunkCount++;
                    }

                    if (delta.reasoning_content) {
                        reasoningContent += delta.reasoning_content;
                    }

                    if (delta.tool_calls) {
                        toolCallsAccumulated = _mergeToolCallDeltas(toolCallsAccumulated, delta);
                    }
                }
            }

            if (!fullContent && contentChunkCount === 0) {
                logger.warn('AI流式响应内容为空', {
                    model: requestBody.model,
                    sseEventCount,
                    contentChunkCount,
                    parseErrorCount,
                    finishReason,
                    hasReasoningContent: reasoningContent.length > 0,
                    reasoningContentLength: reasoningContent.length,
                    usagePromptTokens: usage.prompt_tokens,
                    usageCompletionTokens: usage.completion_tokens
                });
            }

            logger.info('AI流式响应统计', {
                model: model || requestBody.model,
                sseEventCount,
                contentChunkCount,
                parseErrorCount,
                fullContentLength: fullContent.length,
                reasoningContentLength: reasoningContent.length,
                finishReason,
                usagePromptTokens: usage.prompt_tokens,
                usageCompletionTokens: usage.completion_tokens
            });

            const result = {
                content: fullContent,
                reasoning_content: reasoningContent || null,
                tool_calls: toolCallsAccumulated.length > 0 ? toolCallsAccumulated : null,
                usage,
                finish_reason: finishReason,
                model
            };

            resolve(result);
        });

        stream.on('error', (err) => {
            logger.error('AI流式响应读取错误', {
                error: err.message,
                model: requestBody.model,
                sseEventCount,
                contentChunkCount,
                fullContentLength: fullContent.length
            });
            reject(err);
        });

        stream.on('close', () => {
            if (!finishReason) {
                finishReason = 'interrupted';
                logger.warn('AI流式响应连接被关闭（未正常结束）', {
                    model: requestBody.model,
                    sseEventCount,
                    contentChunkCount,
                    fullContentLength: fullContent.length
                });
            }
        });
    });
}

async function callAIStreamWithRetry(apiUrl, requestBody, headers, aiConfig, options = {}) {
    const { onChunk = null, logContext = {}, signal = null, shouldAbort = null } = options;
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
                signal
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
  callAIStreamWithRetry
};
