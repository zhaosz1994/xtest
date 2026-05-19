const ChunkType = Object.freeze({
  TEXT_START: 'text.start',
  TEXT_DELTA: 'text.delta',
  TEXT_COMPLETE: 'text.complete',

  THINKING_START: 'thinking.start',
  THINKING_DELTA: 'thinking.delta',
  THINKING_COMPLETE: 'thinking.complete',

  TOOL_CALL_START: 'tool_call.start',
  TOOL_CALL_DELTA: 'tool_call.delta',
  TOOL_CALL_COMPLETE: 'tool_call.complete',
  TOOL_RESULT: 'tool_result',

  LLM_RESPONSE_CREATED: 'llm_response.created',
  LLM_RESPONSE_COMPLETE: 'llm_response.complete',
  BLOCK_COMPLETE: 'block.complete',

  ERROR: 'error',
  HEARTBEAT: 'heartbeat'
});

module.exports = { ChunkType };
