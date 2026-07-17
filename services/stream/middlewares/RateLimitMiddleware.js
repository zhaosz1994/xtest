const MiddlewareBase = require('../MiddlewareBase');
const { ChunkType } = require('../ChunkType');

class RateLimitMiddleware extends MiddlewareBase {
  constructor(options = {}) {
    super();
    this._minIntervalMs = options.minIntervalMs || 50;
    this._buffer = '';
    this._lastEmitTime = 0;
    this._pendingFlush = null;
    this._onFlush = null;
  }

  process(chunk) {
    if (chunk.type !== ChunkType.TEXT_DELTA) {
      this._flush();
      return chunk;
    }

    this._buffer += chunk.text;
    const now = Date.now();

    if (now - this._lastEmitTime >= this._minIntervalMs) {
      return this._flush();
    }

    if (!this._pendingFlush) {
      this._pendingFlush = setTimeout(() => {
        this._pendingFlush = null;
        if (this._onFlush) {
          const flushedChunk = this._flush();
          if (flushedChunk) {
            this._onFlush(flushedChunk);
          }
        }
      }, this._minIntervalMs);
    }

    return null;
  }

  setOnFlush(callback) {
    this._onFlush = callback;
  }

  flush() {
    return this._flush();
  }

  _flush() {
    if (this._pendingFlush) {
      clearTimeout(this._pendingFlush);
      this._pendingFlush = null;
    }

    if (!this._buffer) return null;

    const chunk = {
      type: ChunkType.TEXT_DELTA,
      text: this._buffer
    };
    this._buffer = '';
    this._lastEmitTime = Date.now();
    return chunk;
  }

  reset() {
    this._buffer = '';
    this._lastEmitTime = 0;
    if (this._pendingFlush) {
      clearTimeout(this._pendingFlush);
      this._pendingFlush = null;
    }
    this._onFlush = null;
  }
}

module.exports = RateLimitMiddleware;
