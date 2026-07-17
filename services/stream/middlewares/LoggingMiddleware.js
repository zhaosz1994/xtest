const MiddlewareBase = require('../MiddlewareBase');
const { ChunkType } = require('../ChunkType');
const logger = require('../../../logger');

class LoggingMiddleware extends MiddlewareBase {
  constructor(options = {}) {
    super();
    this._chunkCount = 0;
    this._startTime = null;
  }

  process(chunk) {
    if (!this._startTime) this._startTime = Date.now();
    this._chunkCount++;

    if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
      logger.info('AI流式响应完成(中间件)', {
        chunkCount: this._chunkCount,
        durationMs: Date.now() - this._startTime,
        usage: chunk.usage,
        metrics: chunk.metrics
      });
    } else if (chunk.type === ChunkType.ERROR) {
      logger.error('AI流式响应错误(中间件)', { error: chunk.error });
    }

    return chunk;
  }

  reset() {
    this._chunkCount = 0;
    this._startTime = null;
  }
}

module.exports = LoggingMiddleware;
