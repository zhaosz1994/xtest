const { ChunkType } = require('./ChunkType');
const logger = require('../logger');

class ChunkConverter {
  constructor() {
    this._toolCallsAccumulated = [];
  }

  convert(sseEvent) {
    if (sseEvent.done) {
      return [];
    }
    if (sseEvent.parseError || !sseEvent.data) {
      return [];
    }

    const sseData = sseEvent.data;
    const chunks = [];

    const choice = sseData.choices?.[0];
    if (!choice) return chunks;

    const delta = choice.delta;
    if (!delta) return chunks;

    if (delta.content) {
      chunks.push({
        type: ChunkType.TEXT_DELTA,
        text: delta.content
      });
    }

    if (delta.reasoning_content) {
      chunks.push({
        type: ChunkType.THINKING_DELTA,
        text: delta.reasoning_content
      });
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!this._toolCallsAccumulated[idx]) {
          this._toolCallsAccumulated[idx] = {
            id: tc.id || '',
            type: 'function',
            function: { name: tc.function?.name || '', arguments: '' }
          };
          chunks.push({
            type: ChunkType.TOOL_CALL_START,
            toolCallId: tc.id || `call_${idx}`,
            toolName: tc.function?.name || ''
          });
        }
        if (tc.id) this._toolCallsAccumulated[idx].id = tc.id;
        if (tc.function?.name) this._toolCallsAccumulated[idx].function.name = tc.function.name;
        if (tc.function?.arguments) {
          this._toolCallsAccumulated[idx].function.arguments += tc.function.arguments;
          chunks.push({
            type: ChunkType.TOOL_CALL_DELTA,
            toolCallId: this._toolCallsAccumulated[idx].id,
            argumentsDelta: tc.function.arguments
          });
        }
      }
    }

    return chunks;
  }

  convertFinish(accumulated) {
    const chunks = [];

    if (this._toolCallsAccumulated.length > 0) {
      for (const tc of this._toolCallsAccumulated) {
        if (tc) {
          chunks.push({
            type: ChunkType.TOOL_CALL_COMPLETE,
            toolCallId: tc.id,
            toolName: tc.function.name,
            arguments: tc.function.arguments
          });
        }
      }
    }

    if (accumulated.text !== undefined && accumulated.text !== null) {
      chunks.push({ type: ChunkType.TEXT_COMPLETE, text: accumulated.text });
    }

    if (accumulated.reasoning) {
      chunks.push({
        type: ChunkType.THINKING_COMPLETE,
        text: accumulated.reasoning,
        thinkingTimeMs: accumulated.thinkingTimeMs || null
      });
    }

    chunks.push({
      type: ChunkType.LLM_RESPONSE_COMPLETE,
      content: accumulated.text || '',
      reasoning_content: accumulated.reasoning || null,
      tool_calls: this._toolCallsAccumulated.length > 0 ? this._toolCallsAccumulated : null,
      usage: accumulated.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      metrics: accumulated.metrics || null,
      finish_reason: accumulated.finishReason || null,
      model: accumulated.model || ''
    });

    return chunks;
  }

  getToolCalls() {
    return this._toolCallsAccumulated;
  }

  reset() {
    this._toolCallsAccumulated = [];
  }
}

module.exports = ChunkConverter;
