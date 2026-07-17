const { StringDecoder } = require('string_decoder');
const logger = require('../logger');

class SSEParser {
  constructor() {
    this._decoder = new StringDecoder('utf8');
    this._buffer = '';
    this._ended = false;
  }

  write(chunk) {
    if (this._ended) {
      this._decoder = new StringDecoder('utf8');
      this._ended = false;
    }
    this._buffer += this._decoder.write(chunk);
    return this._parseBuffer(false);
  }

  flush() {
    if (this._ended) return [];
    this._ended = true;
    const remaining = this._decoder.end();
    if (remaining) {
      this._buffer += remaining;
    }
    return this._parseBuffer(true);
  }

  _parseBuffer(isFinal) {
    const events = [];
    const lines = this._buffer.split('\n');
    this._buffer = isFinal ? '' : (lines.pop() || '');

    for (const line of lines) {
      const event = this._parseLine(line);
      if (event) events.push(event);
    }

    if (isFinal && this._buffer.trim()) {
      const event = this._parseLine(this._buffer);
      if (event) events.push(event);
      this._buffer = '';
    }

    return events;
  }

  _parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;

    const colonIndex = trimmed.indexOf(':');
    const data = trimmed.slice(colonIndex + 1).trim();

    if (data === '[DONE]') return { done: true };

    try {
      return { done: false, data: JSON.parse(data) };
    } catch (e) {
      logger.warn('SSE行JSON解析失败', {
        linePreview: trimmed.substring(0, 200),
        error: e.message
      });
      return { done: false, data: null, parseError: true, rawLine: trimmed };
    }
  }
}

module.exports = SSEParser;
