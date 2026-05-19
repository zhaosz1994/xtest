class ContentAccumulator {
  constructor() {
    this.reset();
  }

  reset() {
    this.text = '';
    this.reasoning = '';
    this.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    this.model = '';
    this.finishReason = null;
    this._startTimestamp = null;
    this._firstTokenTimestamp = null;
    this._thinkingStartTimestamp = null;
    this._contentChunkCount = 0;
    this._sseEventCount = 0;
    this._parseErrorCount = 0;
  }

  markStart() {
    this._startTimestamp = Date.now();
  }

  markFirstToken() {
    if (this._firstTokenTimestamp === null && this._startTimestamp !== null) {
      this._firstTokenTimestamp = Date.now();
    }
  }

  markThinkingStart() {
    if (this._thinkingStartTimestamp === null) {
      this._thinkingStartTimestamp = Date.now();
    }
  }

  appendText(delta) {
    this.text += delta;
    this._contentChunkCount++;
    this.markFirstToken();
  }

  appendReasoning(delta) {
    this.reasoning += delta;
    this.markThinkingStart();
  }

  updateUsage(usage) {
    if (usage) {
      this.usage = {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0
      };
    }
  }

  setModel(model) {
    if (model) this.model = model;
  }

  setFinishReason(reason) {
    if (reason) this.finishReason = reason;
  }

  incrementSSEEventCount() {
    this._sseEventCount++;
  }

  incrementParseErrorCount() {
    this._parseErrorCount++;
  }

  getMetrics() {
    if (!this._startTimestamp) return null;
    const now = Date.now();
    const firstToken = this._firstTokenTimestamp;
    const start = this._startTimestamp;
    const ttftMs = firstToken ? (firstToken - start) : 0;
    const completionMs = firstToken ? (now - firstToken) : (now - start);
    const completionTokens = this.usage.completion_tokens || 0;
    const tokensPerSecond = completionMs > 0 ? (completionTokens / (completionMs / 1000)) : 0;

    return {
      ttftMs,
      completionMs,
      tokensPerSecond: Math.round(tokensPerSecond * 100) / 100,
      totalMs: now - start
    };
  }

  get thinkingTimeMs() {
    if (!this._thinkingStartTimestamp) return null;
    const end = this._firstTokenTimestamp || Date.now();
    const duration = end - this._thinkingStartTimestamp;
    return duration > 0 ? duration : null;
  }

  get contentChunkCount() {
    return this._contentChunkCount;
  }

  get sseEventCount() {
    return this._sseEventCount;
  }

  get parseErrorCount() {
    return this._parseErrorCount;
  }

  toResult() {
    return {
      content: this.text,
      reasoning_content: this.reasoning || null,
      usage: this.usage,
      finish_reason: this.finishReason,
      model: this.model,
      metrics: this.getMetrics()
    };
  }
}

module.exports = ContentAccumulator;
