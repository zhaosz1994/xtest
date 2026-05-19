const MiddlewareBase = require('../MiddlewareBase');
const { ChunkType } = require('../ChunkType');

class ThinkingExtractorMiddleware extends MiddlewareBase {
  constructor() {
    super();
    this._inThinking = false;
    this._thinkingBuffer = '';
  }

  process(chunk) {
    if (chunk.type !== ChunkType.TEXT_DELTA) return chunk;

    let text = chunk.text;
    let normalText = '';
    const thinkingChunks = [];

    while (text.length > 0) {
      if (this._inThinking) {
        const endIdx = text.indexOf('</think]');
        if (endIdx >= 0) {
          this._thinkingBuffer += text.substring(0, endIdx);
          this._inThinking = false;
          thinkingChunks.push({
            type: ChunkType.THINKING_COMPLETE,
            text: this._thinkingBuffer
          });
          this._thinkingBuffer = '';
          text = text.substring(endIdx + '</think]'.length);
        } else {
          this._thinkingBuffer += text;
          thinkingChunks.push({
            type: ChunkType.THINKING_DELTA,
            text: text
          });
          text = '';
        }
      } else {
        const startIdx = text.indexOf('<think]');
        if (startIdx >= 0) {
          normalText += text.substring(0, startIdx);
          this._inThinking = true;
          thinkingChunks.push({ type: ChunkType.THINKING_START });
          text = text.substring(startIdx + '<think]'.length);
        } else {
          normalText += text;
          text = '';
        }
      }
    }

    if (thinkingChunks.length > 0 && normalText) {
      chunk.text = normalText;
      return chunk;
    }

    if (thinkingChunks.length > 0 && !normalText) {
      return thinkingChunks[0];
    }

    return chunk;
  }

  reset() {
    this._inThinking = false;
    this._thinkingBuffer = '';
  }
}

module.exports = ThinkingExtractorMiddleware;
