const SSEParser = require('./SSEParser');
const ChunkConverter = require('./ChunkConverter');
const ContentAccumulator = require('./ContentAccumulator');
const { ChunkType } = require('./ChunkType');
const logger = require('../logger');

class StreamAdapter {
  constructor(options = {}) {
    this.onChunk = options.onChunk || null;
    this.middlewares = options.middlewares || [];
    this.idleTimeout = options.idleTimeout || null;
    this._parser = new SSEParser();
    this._converter = new ChunkConverter();
    this._accumulator = new ContentAccumulator();
  }

  get accumulator() {
    return this._accumulator;
  }

  processRawChunk(rawChunk) {
    if (!this._started) {
      this._started = true;
      this._emitChunk({ type: ChunkType.LLM_RESPONSE_CREATED });
    }

    this.idleTimeout?.reset();

    const sseEvents = this._parser.write(rawChunk);
    for (const event of sseEvents) {
      this._processSSEEvent(event);
    }
  }

  flush() {
    const sseEvents = this._parser.flush();
    for (const event of sseEvents) {
      this._processSSEEvent(event);
    }
  }

  finalize() {
    const accumulated = {
      text: this._accumulator.text,
      reasoning: this._accumulator.reasoning,
      usage: this._accumulator.usage,
      metrics: this._accumulator.getMetrics(),
      thinkingTimeMs: this._accumulator.thinkingTimeMs,
      finishReason: this._accumulator.finishReason,
      model: this._accumulator.model
    };

    const finishChunks = this._converter.convertFinish(accumulated);
    for (const chunk of finishChunks) {
      this._emitChunk(chunk);
    }

    for (const mw of this.middlewares) {
      if (typeof mw.flush === 'function') {
        const flushed = mw.flush();
        if (flushed) {
          this._emitChunk(flushed);
        }
      }
    }

    this.idleTimeout?.cleanup();

    if (this._accumulator.text.length === 0 && this._accumulator.contentChunkCount === 0) {
      logger.warn('AI流式响应内容为空', {
        model: this._accumulator.model,
        sseEventCount: this._accumulator.sseEventCount,
        contentChunkCount: this._accumulator.contentChunkCount,
        parseErrorCount: this._accumulator.parseErrorCount,
        finishReason: this._accumulator.finishReason,
        hasReasoningContent: this._accumulator.reasoning.length > 0,
        reasoningContentLength: this._accumulator.reasoning.length,
        usagePromptTokens: this._accumulator.usage.prompt_tokens,
        usageCompletionTokens: this._accumulator.usage.completion_tokens
      });
    }

    logger.info('AI流式响应统计', {
      model: this._accumulator.model,
      sseEventCount: this._accumulator.sseEventCount,
      contentChunkCount: this._accumulator.contentChunkCount,
      parseErrorCount: this._accumulator.parseErrorCount,
      fullContentLength: this._accumulator.text.length,
      reasoningContentLength: this._accumulator.reasoning.length,
      finishReason: this._accumulator.finishReason,
      usagePromptTokens: this._accumulator.usage.prompt_tokens,
      usageCompletionTokens: this._accumulator.usage.completion_tokens,
      metrics: this._accumulator.getMetrics()
    });

    const result = this._accumulator.toResult();
    result.tool_calls = this._converter.getToolCalls().length > 0
      ? this._converter.getToolCalls() : null;
    return result;
  }

  _processSSEEvent(event) {
    this._accumulator.incrementSSEEventCount();

    if (event.done) {
      if (!this._accumulator.finishReason) {
        this._accumulator.setFinishReason('stop');
      }
      return;
    }
    if (event.parseError || !event.data) {
      this._accumulator.incrementParseErrorCount();
      return;
    }

    const sseData = event.data;
    if (sseData.model) this._accumulator.setModel(sseData.model);
    if (sseData.usage) this._accumulator.updateUsage(sseData.usage);

    const choice = sseData.choices?.[0];
    if (choice?.finish_reason) {
      this._accumulator.setFinishReason(choice.finish_reason);
    }

    const chunks = this._converter.convert(event);
    for (const chunk of chunks) {
      if (chunk.type === ChunkType.TEXT_DELTA) {
        this._accumulator.appendText(chunk.text);
        chunk.fullText = this._accumulator.text;
      } else if (chunk.type === ChunkType.THINKING_DELTA) {
        this._accumulator.appendReasoning(chunk.text);
        chunk.fullText = this._accumulator.reasoning;
      }

      this._emitChunk(chunk);
    }
  }

  _emitChunk(chunk) {
    let processed = chunk;
    for (const mw of this.middlewares) {
      processed = mw.process(processed);
      if (!processed) return;
    }

    if (this.onChunk) {
      this.onChunk(processed);
    }
  }

  reset() {
    this._parser = new SSEParser();
    this._converter = new ChunkConverter();
    this._accumulator = new ContentAccumulator();
    this._started = false;
    for (const mw of this.middlewares) {
      if (typeof mw.reset === 'function') {
        mw.reset();
      }
    }
  }
}

module.exports = StreamAdapter;
