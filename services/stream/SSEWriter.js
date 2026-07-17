const logger = require('../logger');
const { ChunkType } = require('./ChunkType');

class SSEWriter {
  constructor(res, options = {}) {
    this._res = res;
    this._heartbeatIntervalMs = options.heartbeatIntervalMs || 15000;
    this._forwardChunkTypes = options.forwardChunkTypes || [
      ChunkType.TEXT_DELTA,
      ChunkType.TEXT_COMPLETE,
      ChunkType.THINKING_START,
      ChunkType.THINKING_DELTA,
      ChunkType.THINKING_COMPLETE,
      ChunkType.TOOL_CALL_START,
      ChunkType.TOOL_CALL_COMPLETE,
      ChunkType.TOOL_RESULT,
      ChunkType.LLM_RESPONSE_COMPLETE,
      ChunkType.ERROR
    ];
    this._heartbeatTimer = null;
    this._closed = false;

    this._initSSE();
  }

  _initSSE() {
    this._res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    this._heartbeatTimer = setInterval(() => {
      if (this._closed) return;
      try {
        this._res.write(': heartbeat\n\n');
      } catch (e) {
        this.close();
      }
    }, this._heartbeatIntervalMs);
  }

  forwardChunk(chunk) {
    if (this._closed) return;
    if (!this._forwardChunkTypes.includes(chunk.type)) return;

    const eventType = chunk.type;
    const data = this._serializeChunk(chunk);
    this._send(eventType, data);
  }

  sendEvent(event, data) {
    if (this._closed) return;
    this._send(event, data);
  }

  sendDone(data = {}) {
    this._send('done', data);
    this.close();
  }

  sendError(message, code = 'stream_error') {
    this._send('error', { message, code });
    this.close();
  }

  _send(event, data) {
    try {
      const jsonStr = JSON.stringify(data);
      this._res.write(`event: ${event}\ndata: ${jsonStr}\n\n`);
    } catch (e) {
      logger.warn('SSE序列化或写入失败', { error: e.message, event });
      this.close();
    }
  }

  _serializeChunk(chunk) {
    switch (chunk.type) {
      case ChunkType.TEXT_DELTA:
        return { delta: chunk.text, full: chunk.fullText || '' };
      case ChunkType.TEXT_COMPLETE:
        return { text: chunk.text };
      case ChunkType.THINKING_START:
        return {};
      case ChunkType.THINKING_DELTA:
        return { delta: chunk.text, full: chunk.fullText || '' };
      case ChunkType.THINKING_COMPLETE:
        return { text: chunk.text, thinkingTimeMs: chunk.thinkingTimeMs || null };
      case ChunkType.TOOL_CALL_START:
        return { toolCallId: chunk.toolCallId, toolName: chunk.toolName };
      case ChunkType.TOOL_CALL_COMPLETE:
        return { toolCallId: chunk.toolCallId, toolName: chunk.toolName, arguments: typeof chunk.arguments === 'string' ? chunk.arguments.substring(0, 2000) : chunk.arguments };
      case ChunkType.TOOL_RESULT:
        return { toolCallId: chunk.toolCallId || '', toolName: chunk.toolName, result: chunk.result, success: chunk.success };
      case ChunkType.LLM_RESPONSE_COMPLETE:
        return {
          content: chunk.content,
          reasoning_content: chunk.reasoning_content,
          usage: chunk.usage,
          metrics: chunk.metrics
        };
      case ChunkType.ERROR:
        return { message: chunk.error?.message || 'Unknown error', code: chunk.error?.code || 'stream_error' };
      default:
        return { type: chunk.type };
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    try {
      this._res.end();
    } catch (e) {}
  }

  get isClosed() {
    return this._closed;
  }
}

module.exports = SSEWriter;
