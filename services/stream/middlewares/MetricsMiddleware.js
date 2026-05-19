const MiddlewareBase = require('../MiddlewareBase');
const { ChunkType } = require('../ChunkType');

class MetricsMiddleware extends MiddlewareBase {
  constructor() {
    super();
    this._startTimestamp = null;
    this._firstTokenTimestamp = null;
    this._firstThinkingTimestamp = null;
    this._tokenCount = 0;
  }

  process(chunk) {
    if (!this._startTimestamp) this._startTimestamp = Date.now();

    if (chunk.type === ChunkType.TEXT_DELTA || chunk.type === ChunkType.THINKING_DELTA) {
      if (this._firstTokenTimestamp === null) {
        this._firstTokenTimestamp = Date.now();
      }
      this._tokenCount++;
    }

    if (chunk.type === ChunkType.THINKING_DELTA && !this._firstThinkingTimestamp) {
      this._firstThinkingTimestamp = Date.now();
    }

    if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE && !chunk.metrics) {
      const now = Date.now();
      chunk.metrics = {
        ttftMs: this._firstTokenTimestamp
          ? (this._firstTokenTimestamp - this._startTimestamp) : 0,
        totalMs: now - this._startTimestamp,
        chunkCount: this._tokenCount
      };
    }

    return chunk;
  }

  reset() {
    this._startTimestamp = null;
    this._firstTokenTimestamp = null;
    this._firstThinkingTimestamp = null;
    this._tokenCount = 0;
  }
}

module.exports = MetricsMiddleware;
