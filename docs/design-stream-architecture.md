# XTest AI 数据流处理架构重构设计报告

> 借鉴 Cherry Studio 开源项目的设计理念，针对 XTest 系统的 AI 流式调用架构进行系统性升级

---

## 一、现状分析

### 1.1 现有架构总览

```
前端 (ai-sub-agents.js)
  ├── 配置 stream_mode (auto/always/never)  ← 仅配置，未消费SSE
  ├── 无 EventSource / ReadableStream 消费逻辑
  │
路由层
  ├── aiQA.js /ask-stream        → SSE推送 (唯一SSE端点)
  ├── aiGeneration.js            → callAIStreamWithRetry 但不推送SSE
  ├── aiSubAgents.js             → stream_mode CRUD
  │
服务层 (8个服务全部走流式通道)
  ├── agentExecutionEngine.js    → callAIStreamWithRetry (带onChunk)
  ├── caseGeneratorService.js    → callAIStreamWithRetry (无onChunk)
  ├── level1PointService.js      → callAIStreamWithRetry (无onChunk)
  ├── reflectionPipeline.js      → callAIStreamWithRetry (无onChunk)
  ├── memoryEngine.js            → callAIStreamWithRetry (无onChunk)
  ├── keyConfigGenerationHandler → callAIStreamWithRetry (无onChunk)
  ├── overviewGenerationHandler  → callAIStreamWithRetry (无onChunk)
  ├── summaryGenerator.js        → callAIStreamWithRetry (无onChunk)
  │
底层
  └── aiCallWrapper.js
       ├── callAIStream()           → SSE解析 + StringDecoder
       └── callAIStreamWithRetry()  → 重试 + 取消检测
```

### 1.2 现有问题诊断

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| P1 | **无统一Chunk类型系统** | 高 | `onChunk` 只区分 `content` 和 `tool_calls_delta`，缺少 thinking/错误/生命周期等事件类型 |
| P2 | **SSE解析与业务逻辑耦合** | 高 | `_parseSSELine()` 和 `_mergeToolCallDeltas()` 直接写在 `callAIStream()` 内部，无法复用和扩展 |
| P3 | **无中间件机制** | 高 | 日志、错误处理、速率控制等横切关注点硬编码在主流程中，新增处理逻辑需修改核心代码 |
| P4 | **无空闲超时控制** | 中 | 长时间推理模型（如DeepSeek-R1）可能思考30分钟+，当前只有固定timeout，会误杀活跃连接 |
| P5 | **前端未消费SSE** | 高 | `/ask-stream` 端点已实现，但前端无 EventSource 消费逻辑，stream_mode 配置形同虚设 |
| P6 | **无性能指标采集** | 中 | 缺少首Token时间(TTFT)、生成速度(tokens/s)等关键指标 |
| P7 | **thinking内容未独立流化** | 中 | `reasoning_content` 仅在最终结果中返回，无法实时展示推理过程 |
| P8 | **SSE推送层不统一** | 中 | 只有 `aiQA.js` 实现了SSE推送，其他场景（AI评审对话、导入优化对话）无法复用 |
| P9 | **stream_mode判断逻辑缺失** | 中 | 数据库字段已就绪，但 `executeAgent` 和 `executeAgentStream` 是两个独立方法，调用方自行选择 |

### 1.3 与 Cherry Studio 的差距对比

| 维度 | Cherry Studio | XTest 现状 | 差距 |
|------|--------------|-----------|------|
| 流类型系统 | 20+ ChunkType 枚举 | 2种 (content, tool_calls_delta) | 缺少 thinking/error/lifecycle 等 |
| 适配器模式 | AiSdkToChunkAdapter 独立类 | 逻辑内嵌在 callAIStream() | 无法复用和测试 |
| 中间件管道 | 可插拔中间件 + 洋葱模型 | 无 | 横切关注点硬编码 |
| 空闲超时 | IdleTimeoutController (30min, 可重置) | 固定 timeout | 长推理场景被误杀 |
| 思考过程 | 独立 THINKING_START/DELTA/COMPLETE 流 | 仅最终结果中返回 | 无法实时展示 |
| 性能指标 | TTFT + 生成速度 + 完整 metrics | 仅 token 计数 | 缺少延迟指标 |
| SSE推送 | 统一 StreamProcessingService + 回调 | 仅 aiQA.js 手动实现 | 不可复用 |
| 前端消费 | React + 事件驱动回调 | 无 SSE 消费 | 完全缺失 |

---

## 二、设计目标

1. **结构化流事件**：建立统一的 ChunkType 类型系统，覆盖文本/思考/工具调用/错误/生命周期等全部事件
2. **适配器解耦**：将 SSE 解析、Chunk 转换、内容累积从 `callAIStream()` 中抽离为独立的 `StreamAdapter`
3. **中间件管道**：实现可插拔的中间件机制，横切关注点（日志、错误处理、速率控制、思考提取）独立维护
4. **空闲超时**：引入可重置的 IdleTimeoutController，保护长时间推理连接
5. **统一SSE推送**：封装 SSE 推送工具，所有需要流式推送的场景复用同一套基础设施
6. **前端SSE消费**：实现前端 EventSource 消费框架，支持 stream_mode 配置生效
7. **性能可观测**：采集 TTFT、生成速度等关键指标，为性能优化提供数据支撑
8. **向后兼容**：所有改动对现有调用方透明，不破坏任何现有功能

---

## 三、核心设计

### 3.1 ChunkType 类型系统

借鉴 Cherry Studio 的 `ChunkType` 枚举，定义 XTest 的流式事件类型体系。

#### 3.1.1 类型定义

```javascript
// services/stream/ChunkType.js

const ChunkType = Object.freeze({
  // === 文本相关 ===
  TEXT_START: 'text.start',           // 文本输出开始
  TEXT_DELTA: 'text.delta',           // 文本增量内容
  TEXT_COMPLETE: 'text.complete',     // 文本输出完成（含完整文本）

  // === 思考/推理相关 ===
  THINKING_START: 'thinking.start',   // 推理过程开始
  THINKING_DELTA: 'thinking.delta',   // 推理增量内容
  THINKING_COMPLETE: 'thinking.complete', // 推理过程完成（含完整推理文本）

  // === 工具调用相关 ===
  TOOL_CALL_START: 'tool_call.start',     // 工具调用开始
  TOOL_CALL_DELTA: 'tool_call.delta',     // 工具调用参数增量
  TOOL_CALL_COMPLETE: 'tool_call.complete', // 工具调用完成（含完整参数）
  TOOL_RESULT: 'tool_result',             // 工具执行结果

  // === 生命周期事件 ===
  LLM_RESPONSE_CREATED: 'llm_response.created',  // LLM开始响应
  LLM_RESPONSE_COMPLETE: 'llm_response.complete', // LLM响应完成
  BLOCK_COMPLETE: 'block.complete',               // 一个完整块结束（含usage）

  // === 错误 ===
  ERROR: 'error',                     // 流中发生错误

  // === 心跳 ===
  HEARTBEAT: 'heartbeat'              // 保活心跳
});
```

#### 3.1.2 Chunk 数据结构

每种 ChunkType 对应的 Chunk 数据结构：

```javascript
// 文本增量
{ type: 'text.delta', text: '增量文本', fullText: '累积完整文本' }

// 文本完成
{ type: 'text.complete', text: '完整文本' }

// 思考增量
{ type: 'thinking.delta', text: '增量推理内容', fullText: '累积完整推理' }

// 思考完成
{ type: 'thinking.complete', text: '完整推理内容', thinkingTimeMs: 5200 }

// 工具调用开始
{ type: 'tool_call.start', toolCallId: 'call_xxx', toolName: 'search_cases' }

// 工具调用增量
{ type: 'tool_call.delta', toolCallId: 'call_xxx', argumentsDelta: '{"li' }

// 工具调用完成
{ type: 'tool_call.complete', toolCallId: 'call_xxx', toolName: 'search_cases', arguments: '{"library_id":1}' }

// 工具结果
{ type: 'tool_result', toolCallId: 'call_xxx', toolName: 'search_cases', result: {...}, success: true }

// LLM响应完成（含usage和metrics）
{
  type: 'llm_response.complete',
  content: '完整回复',
  reasoning_content: '完整推理',
  usage: { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 },
  metrics: { ttftMs: 1200, tokensPerSecond: 45.2, totalMs: 11000 }
}

// 错误
{ type: 'error', error: { message: '...', code: 'stream_error' } }

// 心跳
{ type: 'heartbeat', timestamp: 1716000000000 }
```

#### 3.1.3 与现有 onChunk 的映射

| 现有 onChunk.type | 新 ChunkType | 说明 |
|-------------------|-------------|------|
| `content` | `TEXT_DELTA` + `TEXT_COMPLETE` | 拆分为增量和完成两个事件 |
| `tool_calls_delta` | `TOOL_CALL_DELTA` + `TOOL_CALL_COMPLETE` | 拆分为增量和完成两个事件 |
| _(无)_ | `THINKING_START/DELTA/COMPLETE` | 新增：推理过程流化 |
| _(无)_ | `LLM_RESPONSE_CREATED/COMPLETE` | 新增：生命周期事件 |
| _(无)_ | `ERROR` | 新增：流内错误事件 |
| _(无)_ | `TOOL_RESULT` | 新增：工具执行结果事件 |

---

### 3.2 StreamAdapter 适配器层

借鉴 Cherry Studio 的 `AiSdkToChunkAdapter`，将 SSE 解析和 Chunk 转换从 `callAIStream()` 中抽离。

#### 3.2.1 架构定位

```
                  改造前                              改造后
┌─────────────────────────┐    ┌──────────────────────────────────────┐
│   callAIStream()        │    │   callAIStream()                     │
│   ├── SSE解析            │    │   ├── HTTP请求 + 流获取              │
│   ├── StringDecoder     │    │   └── StreamAdapter.processStream()  │
│   ├── JSON解析           │    │         ├── SSEParser (解析层)       │
│   ├── content累积        │    │         ├── ChunkConverter (转换层)  │
│   ├── reasoning累积      │    │         └── ContentAccumulator (累积)│
│   ├── tool_calls合并     │    │                                      │
│   ├── onChunk回调        │    │                                      │
│   └── 结果组装           │    │                                      │
└─────────────────────────┘    └──────────────────────────────────────┘
```

#### 3.2.2 SSEParser — SSE 协议解析器

```javascript
// services/stream/SSEParser.js

const { StringDecoder } = require('string_decoder');
const logger = require('../logger');

class SSEParser {
  constructor() {
    this._decoder = new StringDecoder('utf8');
    this._buffer = '';
  }

  /**
   * 写入原始字节块，返回解析出的SSE事件数组
   * @param {Buffer} chunk - 原始TCP字节块
   * @returns {Array} 解析出的事件数组 [{done, data}, ...]
   */
  write(chunk) {
    this._buffer += this._decoder.write(chunk);
    return this._parseBuffer(false);
  }

  /**
   * 刷新剩余缓冲区（流结束时调用）
   * @returns {Array} 剩余解析出的事件数组
   */
  flush() {
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
```

#### 3.2.3 ChunkConverter — SSE数据到Chunk的转换器

```javascript
// services/stream/ChunkConverter.js

const { ChunkType } = require('./ChunkType');
const logger = require('../logger');

class ChunkConverter {
  constructor() {
    this._toolCallsAccumulated = [];
  }

  /**
   * 将SSE事件数据转换为Chunk数组
   * 一个SSE事件可能产生0~N个Chunk
   * @param {Object} sseEvent - {done, data, parseError}
   * @returns {Array} Chunk数组
   */
  convert(sseEvent) {
    if (sseEvent.done) {
      return [{ type: ChunkType.LLM_RESPONSE_CREATED }];
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

    // 文本内容
    if (delta.content) {
      chunks.push({
        type: ChunkType.TEXT_DELTA,
        text: delta.content
      });
    }

    // 推理/思考内容
    if (delta.reasoning_content) {
      chunks.push({
        type: ChunkType.THINKING_DELTA,
        text: delta.reasoning_content
      });
    }

    // 工具调用增量
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

  /**
   * 生成finish事件对应的Chunk
   * @param {Object} sseData - 包含usage的SSE数据
   * @param {Object} accumulated - 累积的完整内容
   * @returns {Array} Chunk数组
   */
  convertFinish(sseData, accumulated) {
    const chunks = [];

    // 工具调用完成
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

    // 文本完成
    if (accumulated.text) {
      chunks.push({ type: ChunkType.TEXT_COMPLETE, text: accumulated.text });
    }

    // 思考完成
    if (accumulated.reasoning) {
      chunks.push({
        type: ChunkType.THINKING_COMPLETE,
        text: accumulated.reasoning,
        thinkingTimeMs: accumulated.thinkingTimeMs || null
      });
    }

    // 响应完成
    const usage = sseData?.usage || accumulated.usage || {};
    chunks.push({
      type: ChunkType.LLM_RESPONSE_COMPLETE,
      content: accumulated.text || '',
      reasoning_content: accumulated.reasoning || null,
      tool_calls: this._toolCallsAccumulated.length > 0 ? this._toolCallsAccumulated : null,
      usage: {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0
      },
      metrics: accumulated.metrics || null
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
```

#### 3.2.4 ContentAccumulator — 内容累积器

```javascript
// services/stream/ContentAccumulator.js

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
    this.markFirstToken();
  }

  appendReasoning(delta) {
    this.reasoning += delta;
    this.markFirstToken();
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
    return end - this._thinkingStartTimestamp;
  }

  toResult() {
    return {
      content: this.text,
      reasoning_content: this.reasoning || null,
      tool_calls: null, // 由 ChunkConverter 提供
      usage: this.usage,
      finish_reason: this.finishReason,
      model: this.model,
      metrics: this.getMetrics()
    };
  }
}
```

#### 3.2.5 StreamAdapter — 顶层编排

```javascript
// services/stream/StreamAdapter.js

const { SSEParser } = require('./SSEParser');
const { ChunkConverter } = require('./ChunkConverter');
const { ContentAccumulator } = require('./ContentAccumulator');
const { ChunkType } = require('./ChunkType');
const logger = require('../logger');

class StreamAdapter {
  /**
   * @param {Object} options
   * @param {Function} options.onChunk - Chunk回调 (chunk) => void
   * @param {Array} options.middlewares - 中间件数组
   * @param {Object} options.idleTimeout - IdleTimeoutHandle
   */
  constructor(options = {}) {
    this.onChunk = options.onChunk || null;
    this.middlewares = options.middlewares || [];
    this.idleTimeout = options.idleTimeout || null;
    this._parser = new SSEParser();
    this._converter = new ChunkConverter();
    this._accumulator = new ContentAccumulator();
  }

  /**
   * 处理一个原始字节块
   * @param {Buffer} rawChunk - 原始TCP字节块
   */
  processRawChunk(rawChunk) {
    this.idleTimeout?.reset();

    const sseEvents = this._parser.write(rawChunk);
    for (const event of sseEvents) {
      this._processSSEEvent(event);
    }
  }

  /**
   * 刷新剩余缓冲区（流结束时调用）
   */
  flush() {
    const sseEvents = this._parser.flush();
    for (const event of sseEvents) {
      this._processSSEEvent(event);
    }
  }

  /**
   * 处理流结束，生成完成事件
   * @returns {Object} 最终结果
   */
  finalize() {
    const result = this._accumulator.toResult();
    result.tool_calls = this._converter.getToolCalls().length > 0
      ? this._converter.getToolCalls() : null;

    const finishChunks = this._converter.convertFinish(
      { usage: this._accumulator.usage },
      {
        text: this._accumulator.text,
        reasoning: this._accumulator.reasoning,
        usage: this._accumulator.usage,
        metrics: this._accumulator.getMetrics(),
        thinkingTimeMs: this._accumulator.thinkingTimeMs
      }
    );

    for (const chunk of finishChunks) {
      this._emitChunk(chunk);
    }

    this.idleTimeout?.cleanup();
    return result;
  }

  _processSSEEvent(event) {
    if (event.done) {
      this._accumulator.setFinishReason(this._accumulator.finishReason || 'stop');
      return;
    }
    if (event.parseError || !event.data) return;

    const sseData = event.data;
    if (sseData.model) this._accumulator.setModel(sseData.model);
    if (sseData.usage) this._accumulator.updateUsage(sseData.usage);

    const choice = sseData.choices?.[0];
    if (choice?.finish_reason) {
      this._accumulator.setFinishReason(choice.finish_reason);
    }

    const chunks = this._converter.convert(event);
    for (const chunk of chunks) {
      // 同步累积
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
    // 中间件管道处理
    let processed = chunk;
    for (const mw of this.middlewares) {
      processed = mw.process(processed);
      if (!processed) return; // 中间件吞掉了这个chunk
    }

    if (this.onChunk) {
      this.onChunk(processed);
    }
  }

  reset() {
    this._parser = new SSEParser();
    this._converter = new ChunkConverter();
    this._accumulator = new ContentAccumulator();
  }
}

module.exports = { StreamAdapter, SSEParser, ChunkConverter, ContentAccumulator };
```

---

### 3.3 中间件管道

借鉴 Cherry Studio 的中间件架构，实现可插拔的流处理中间件。

#### 3.3.1 中间件接口

```javascript
// services/stream/MiddlewareBase.js

class MiddlewareBase {
  /**
   * 处理一个Chunk，返回处理后的Chunk或null（吞掉）
   * @param {Object} chunk - 输入Chunk
   * @returns {Object|null} 处理后的Chunk，或null表示吞掉
   */
  process(chunk) {
    return chunk;
  }

  /**
   * 重置中间件状态（新流开始时调用）
   */
  reset() {}
}

module.exports = MiddlewareBase;
```

#### 3.3.2 内置中间件

##### (1) LoggingMiddleware — 流式日志中间件

```javascript
// services/stream/middlewares/LoggingMiddleware.js

const MiddlewareBase = require('../MiddlewareBase');
const { ChunkType } = require('../ChunkType');
const logger = require('../../logger');

class LoggingMiddleware extends MiddlewareBase {
  constructor(options = {}) {
    super();
    this._logLevel = options.logLevel || 'debug';
    this._chunkCount = 0;
    this._startTime = null;
  }

  process(chunk) {
    if (!this._startTime) this._startTime = Date.now();
    this._chunkCount++;

    // 生命周期事件记录为info级别
    if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
      logger.info('AI流式响应完成', {
        chunkCount: this._chunkCount,
        durationMs: Date.now() - this._startTime,
        usage: chunk.usage,
        metrics: chunk.metrics
      });
    } else if (chunk.type === ChunkType.ERROR) {
      logger.error('AI流式响应错误', { error: chunk.error });
    }

    return chunk;
  }

  reset() {
    this._chunkCount = 0;
    this._startTime = null;
  }
}
```

##### (2) ThinkingExtractorMiddleware — 思考过程提取中间件

```javascript
// services/stream/middlewares/ThinkingExtractorMiddleware.js

const MiddlewareBase = require('../MiddlewareBase');
const { ChunkType } = require('../ChunkType');

/**
 * 从文本内容中提取 <think/> 标签包裹的思考过程
 * 适用于不原生支持 reasoning_content 但模型输出中包含 <think/> 标签的场景
 */
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
    const extraChunks = [];

    // 简化处理：检测 <think/> 标签边界
    while (text.length > 0) {
      if (this._inThinking) {
        const endIdx = text.indexOf('</think]');
        if (endIdx >= 0) {
          this._thinkingBuffer += text.substring(0, endIdx);
          this._inThinking = false;
          extraChunks.push({
            type: ChunkType.THINKING_COMPLETE,
            text: this._thinkingBuffer
          });
          this._thinkingBuffer = '';
          text = text.substring(endIdx + '</think]'.length);
        } else {
          this._thinkingBuffer += text;
          extraChunks.push({
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
          extraChunks.push({ type: ChunkType.THINKING_START });
          text = text.substring(startIdx + '<think]'.length);
        } else {
          normalText += text;
          text = '';
        }
      }
    }

    // 如果有思考内容被提取，修改原始chunk的text为非思考部分
    if (extraChunks.length > 0) {
      if (normalText) {
        chunk.text = normalText;
        // 先发送思考chunks，再返回修改后的文本chunk
        for (const ec of extraChunks) {
          this._emitToNext(ec);
        }
        return chunk;
      }
      return null; // 吞掉纯思考的文本chunk
    }

    return chunk;
  }

  reset() {
    this._inThinking = false;
    this._thinkingBuffer = '';
  }
}
```

##### (3) RateLimitMiddleware — 推送速率控制中间件

```javascript
// services/stream/middlewares/RateLimitMiddleware.js

const MiddlewareBase = require('../MiddlewareBase');
const { ChunkType } = require('../ChunkType');

/**
 * 控制向UI推送TEXT_DELTA的频率，避免渲染压力过大
 * 策略：合并短时间内的多个delta为一个批次推送
 */
class RateLimitMiddleware extends MiddlewareBase {
  constructor(options = {}) {
    super();
    this._minIntervalMs = options.minIntervalMs || 50; // 最小推送间隔
    this._buffer = '';
    this._lastEmitTime = 0;
    this._pendingFlush = null;
  }

  process(chunk) {
    if (chunk.type !== ChunkType.TEXT_DELTA) {
      // 非文本delta事件，先flush缓冲区
      this._flush();
      return chunk;
    }

    this._buffer += chunk.text;
    const now = Date.now();

    if (now - this._lastEmitTime >= this._minIntervalMs) {
      return this._flush();
    }

    // 还没到推送时间，缓冲起来
    if (!this._pendingFlush) {
      this._pendingFlush = setTimeout(() => this._flush(), this._minIntervalMs);
    }

    return null; // 暂时吞掉
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
  }
}
```

##### (4) MetricsMiddleware — 性能指标采集中间件

```javascript
// services/stream/middlewares/MetricsMiddleware.js

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

    // 将metrics注入到LLM_RESPONSE_COMPLETE事件
    if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
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
```

---

### 3.4 IdleTimeoutController — 空闲超时控制

借鉴 Cherry Studio 的 `IdleTimeoutController`，解决长时间推理被固定 timeout 误杀的问题。

```javascript
// services/stream/IdleTimeoutController.js

const logger = require('../logger');

class IdleTimeoutController {
  /**
   * @param {number} timeoutMs - 空闲超时时间（毫秒），默认30分钟
   * @param {AbortSignal} [parentSignal] - 父级取消信号
   */
  constructor(timeoutMs = 30 * 60 * 1000, parentSignal = null) {
    this._timeoutMs = timeoutMs;
    this._abortController = new AbortController();
    this._timer = null;
    this._cleaned = false;

    // 如果父级信号被触发，也级联取消
    if (parentSignal) {
      if (parentSignal.aborted) {
        this._abortController.abort();
      } else {
        parentSignal.addEventListener('abort', () => {
          this._abortController.abort();
        });
      }
    }

    this._startTimer();
  }

  /**
   * 获取AbortSignal，传递给axios等HTTP客户端
   */
  get signal() {
    return this._abortController.signal;
  }

  /**
   * 重置空闲计时器（每收到一个chunk调用一次）
   */
  reset() {
    if (this._cleaned) return;
    clearTimeout(this._timer);
    this._startTimer();
  }

  /**
   * 清理计时器（流结束时调用）
   */
  cleanup() {
    this._cleaned = true;
    clearTimeout(this._timer);
  }

  _startTimer() {
    this._timer = setTimeout(() => {
      if (!this._cleaned) {
        logger.warn('AI流式连接空闲超时，主动断开', {
          timeoutMs: this._timeoutMs
        });
        this._abortController.abort();
      }
    }, this._timeoutMs);
  }
}

module.exports = IdleTimeoutController;
```

---

### 3.5 改造后的 callAIStream

将 `callAIStream()` 改造为使用 StreamAdapter：

```javascript
// services/aiCallWrapper.js 中的 callAIStream 改造

const { StreamAdapter } = require('./stream/StreamAdapter');
const { ChunkType } = require('./stream/ChunkType');
const IdleTimeoutController = require('./stream/IdleTimeoutController');

async function callAIStream(apiUrl, requestBody, headers, options = {}) {
  const {
    onChunk = null,
    timeout = 300000,
    signal = null,
    middlewares = [],
    idleTimeoutMs = null
  } = options;

  const streamRequestBody = { ...requestBody, stream: true };

  // 空闲超时控制
  const idleController = idleTimeoutMs
    ? new IdleTimeoutController(idleTimeoutMs, signal)
    : null;

  const effectiveSignal = idleController?.signal || signal;

  const axiosOptions = {
    headers,
    timeout: timeout + 10000,
    responseType: 'stream',
    signal: effectiveSignal
  };

  const response = await axios.post(apiUrl, streamRequestBody, axiosOptions);

  return new Promise((resolve, reject) => {
    const stream = response.data;

    const adapter = new StreamAdapter({
      onChunk,
      middlewares,
      idleTimeout: idleController
    });

    adapter._accumulator.markStart();

    stream.on('data', (chunk) => {
      adapter.processRawChunk(chunk);
    });

    stream.on('end', () => {
      adapter.flush();
      const result = adapter.finalize();
      resolve(result);
    });

    stream.on('error', (err) => {
      logger.error('AI流式响应读取错误', {
        error: err.message,
        model: requestBody.model
      });
      reject(err);
    });

    stream.on('close', () => {
      if (!adapter._accumulator.finishReason) {
        adapter._accumulator.setFinishReason('interrupted');
        logger.warn('AI流式响应连接被关闭（未正常结束）', {
          model: requestBody.model
        });
      }
    });
  });
}
```

---

### 3.6 统一SSE推送层

封装 SSE 推送工具，所有需要流式推送的场景复用同一套基础设施。

#### 3.6.1 SSEWriter — SSE 响应写入器

```javascript
// services/stream/SSEWriter.js

const logger = require('../logger');
const { ChunkType } = require('./ChunkType');

class SSEWriter {
  /**
   * @param {http.ServerResponse} res - Express Response对象
   * @param {Object} options
   * @param {number} options.heartbeatIntervalMs - 心跳间隔，默认15000ms
   * @param {Array<string>} options.forwardChunkTypes - 需要转发给客户端的ChunkType列表
   */
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

  /**
   * 将Chunk转发为SSE事件
   * @param {Object} chunk - 标准Chunk对象
   */
  forwardChunk(chunk) {
    if (this._closed) return;
    if (!this._forwardChunkTypes.includes(chunk.type)) return;

    const eventType = chunk.type;
    const data = this._serializeChunk(chunk);
    this._send(eventType, data);
  }

  /**
   * 发送自定义SSE事件
   */
  sendEvent(event, data) {
    if (this._closed) return;
    this._send(event, data);
  }

  /**
   * 发送完成事件并关闭连接
   */
  sendDone(data = {}) {
    this._send('done', data);
    this.close();
  }

  /**
   * 发送错误事件并关闭连接
   */
  sendError(message, code = 'stream_error') {
    this._send('error', { message, code });
    this.close();
  }

  _send(event, data) {
    try {
      this._res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      logger.warn('SSE写入失败（客户端可能已断开）', { error: e.message });
      this.close();
    }
  }

  _serializeChunk(chunk) {
    switch (chunk.type) {
      case ChunkType.TEXT_DELTA:
        return { delta: chunk.text, full: chunk.fullText };
      case ChunkType.TEXT_COMPLETE:
        return { text: chunk.text };
      case ChunkType.THINKING_START:
        return {};
      case ChunkType.THINKING_DELTA:
        return { delta: chunk.text, full: chunk.fullText };
      case ChunkType.THINKING_COMPLETE:
        return { text: chunk.text, thinkingTimeMs: chunk.thinkingTimeMs };
      case ChunkType.TOOL_CALL_START:
        return { toolCallId: chunk.toolCallId, toolName: chunk.toolName };
      case ChunkType.TOOL_CALL_COMPLETE:
        return { toolCallId: chunk.toolCallId, toolName: chunk.toolName, arguments: chunk.arguments };
      case ChunkType.TOOL_RESULT:
        return { toolCallId: chunk.toolCallId, toolName: chunk.toolName, result: chunk.result, success: chunk.success };
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
        return chunk;
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
```

#### 3.6.2 路由层使用示例

改造后的 `aiQA.js /ask-stream`：

```javascript
const SSEWriter = require('../services/stream/SSEWriter');
const { ChunkType } = require('../services/stream/ChunkType');

router.post('/ask-stream', authenticateToken, async (req, res) => {
  // ... 权限校验、参数校验同现有逻辑 ...

  const sseWriter = new SSEWriter(res);

  req.on('close', () => {
    sseWriter.close();
  });

  const streamCallbacks = {
    onContent: (deltaContent, fullContent) => {
      sseWriter.forwardChunk({
        type: ChunkType.TEXT_DELTA,
        text: deltaContent,
        fullText: fullContent
      });
    },
    onToolCall: (toolCalls) => {
      for (const tc of toolCalls) {
        sseWriter.forwardChunk({
          type: ChunkType.TOOL_CALL_START,
          toolCallId: tc.id || tc.function?.name,
          toolName: tc.function?.name || tc.name || 'unknown'
        });
      }
    },
    onToolResult: (toolName, result) => {
      sseWriter.forwardChunk({
        type: ChunkType.TOOL_RESULT,
        toolName,
        result: typeof result === 'string' ? result.substring(0, 500) : result,
        success: true
      });
    },
    onRound: (round, maxRounds) => {
      sseWriter.sendEvent('round', { round, maxRounds });
    }
  };

  try {
    const result = await agentExecutionEngine.executeAgentStream(
      agent_code, userId, variables, context, streamCallbacks
    );

    if (result.success) {
      sseWriter.sendDone({
        answer: result.result,
        memoryContribution: result.memoryContribution,
        toolCallsLog: result.toolCallsLog,
        executionTimeMs: result.executionTimeMs
      });
    } else {
      sseWriter.sendError(result.error || 'QA问答执行失败');
    }
  } catch (error) {
    sseWriter.sendError(error.message);
  }
});
```

---

### 3.7 前端 SSE 消费框架

#### 3.7.1 StreamConsumer — 前端SSE消费基类

```javascript
// public/js/modules/stream-consumer.js

class StreamConsumer {
  /**
   * @param {Object} options
   * @param {string} options.url - SSE端点URL
   * @param {Object} options.body - POST请求体
   * @param {Object} options.callbacks - 事件回调
   * @param {Function} options.callbacks.onTextDelta - (delta, fullText) => void
   * @param {Function} options.callbacks.onTextComplete - (text) => void
   * @param {Function} options.callbacks.onThinkingStart - () => void
   * @param {Function} options.callbacks.onThinkingDelta - (delta, fullText) => void
   * @param {Function} options.callbacks.onThinkingComplete - (text, thinkingTimeMs) => void
   * @param {Function} options.callbacks.onToolCallStart - (toolCallId, toolName) => void
   * @param {Function} options.callbacks.onToolCallComplete - (toolCallId, toolName, arguments) => void
   * @param {Function} options.callbacks.onToolResult - (toolName, result, success) => void
   * @param {Function} options.callbacks.onDone - (data) => void
   * @param {Function} options.callbacks.onError - (message, code) => void
   * @param {Function} options.callbacks.onRound - (round, maxRounds) => void
   * @param {Object} options.headers - 额外请求头
   */
  constructor(options) {
    this.url = options.url;
    this.body = options.body;
    this.callbacks = options.callbacks || {};
    this.headers = options.headers || {};
    this._abortController = null;
    this._fullText = '';
    this._fullThinking = '';
  }

  async start() {
    this._abortController = new AbortController();
    this._fullText = '';
    this._fullThinking = '';

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...this.headers
        },
        body: JSON.stringify(this.body),
        signal: this._abortController.signal
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              this._handleEvent(currentEvent, data);
            } catch (e) {}
            currentEvent = '';
          } else if (line.startsWith(': ')) {
            // 心跳注释，忽略
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.callbacks.onError?.(error.message, 'fetch_error');
      }
    }
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort();
    }
  }

  _handleEvent(event, data) {
    switch (event) {
      case 'text.delta':
        this._fullText += data.delta || '';
        this.callbacks.onTextDelta?.(data.delta, this._fullText);
        break;
      case 'text.complete':
        this.callbacks.onTextComplete?.(data.text);
        break;
      case 'thinking.start':
        this._fullThinking = '';
        this.callbacks.onThinkingStart?.();
        break;
      case 'thinking.delta':
        this._fullThinking += data.delta || '';
        this.callbacks.onThinkingDelta?.(data.delta, this._fullThinking);
        break;
      case 'thinking.complete':
        this.callbacks.onThinkingComplete?.(data.text, data.thinkingTimeMs);
        break;
      case 'tool_call.start':
        this.callbacks.onToolCallStart?.(data.toolCallId, data.toolName);
        break;
      case 'tool_call.complete':
        this.callbacks.onToolCallComplete?.(data.toolCallId, data.toolName, data.arguments);
        break;
      case 'tool_result':
        this.callbacks.onToolResult?.(data.toolName, data.result, data.success);
        break;
      case 'round':
        this.callbacks.onRound?.(data.round, data.maxRounds);
        break;
      case 'done':
        this.callbacks.onDone?.(data);
        break;
      case 'error':
        this.callbacks.onError?.(data.message, data.code);
        break;
    }
  }
}

window.StreamConsumer = StreamConsumer;
```

#### 3.7.2 QA 对话页面使用示例

```javascript
// 在QA对话页面中使用
const consumer = new StreamConsumer({
  url: '/api/ai/qa/ask-stream',
  body: {
    agent_code: selectedAgent,
    question: userQuestion,
    library_id: currentLibraryId,
    module_id: currentModuleId
  },
  callbacks: {
    onTextDelta: (delta, fullText) => {
      updateAnswerDisplay(fullText);
    },
    onThinkingStart: () => {
      showThinkingIndicator();
    },
    onThinkingDelta: (delta, fullThinking) => {
      updateThinkingDisplay(fullThinking);
    },
    onThinkingComplete: (text, thinkingTimeMs) => {
      hideThinkingIndicator();
    },
    onToolCallStart: (id, name) => {
      addToolCallIndicator(name, 'pending');
    },
    onToolResult: (name, result, success) => {
      updateToolCallIndicator(name, success ? 'success' : 'error');
    },
    onRound: (round, maxRounds) => {
      updateRoundIndicator(round, maxRounds);
    },
    onDone: (data) => {
      finalizeAnswer(data);
    },
    onError: (message) => {
      showError(message);
    }
  }
});

consumer.start();
```

---

### 3.8 stream_mode 判断逻辑

在 `agentExecutionEngine.js` 中实现 `stream_mode` 的自动判断：

```javascript
/**
 * 根据stream_mode和调用场景决定是否使用流式
 * @param {Object} agent - 代理记录
 * @param {string} source - 调用来源 ('qa', 'qa_stream', 'task', 'import_optimize')
 * @returns {boolean} 是否使用流式
 */
_shouldUseStream(agent, source) {
  const streamMode = agent.stream_mode || 'auto';

  switch (streamMode) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'auto':
    default:
      // QA场景使用流式，批量任务场景使用非流式
      return source === 'qa_stream' || source === 'qa';
  }
}

/**
 * 统一执行入口，根据stream_mode自动选择执行方式
 */
async execute(agentCode, userId, variables, context, streamCallbacks = {}) {
  const agent = await this._resolveAgent(agentCode, userId);
  if (!agent) {
    return { success: false, result: null, error: `代理 "${agentCode}" 不存在` };
  }

  const useStream = this._shouldUseStream(agent, context.source);

  if (useStream) {
    return this.executeAgentStream(agentCode, userId, variables, context, streamCallbacks);
  } else {
    return this.executeAgent(agentCode, userId, variables, context);
  }
}
```

---

## 四、文件结构规划

```
services/stream/                    ← 新增目录
├── ChunkType.js                    ← Chunk类型枚举
├── SSEParser.js                    ← SSE协议解析器
├── ChunkConverter.js               ← SSE数据→Chunk转换器
├── ContentAccumulator.js           ← 内容累积器
├── StreamAdapter.js                ← 顶层流适配器
├── SSEWriter.js                    ← SSE响应写入器
├── IdleTimeoutController.js        ← 空闲超时控制器
├── MiddlewareBase.js               ← 中间件基类
└── middlewares/
    ├── LoggingMiddleware.js        ← 日志中间件
    ├── ThinkingExtractorMiddleware.js ← 思考提取中间件
    ├── RateLimitMiddleware.js      ← 推送速率控制中间件
    └── MetricsMiddleware.js        ← 性能指标中间件

public/js/modules/
└── stream-consumer.js              ← 前端SSE消费框架

改造文件：
├── services/aiCallWrapper.js       ← callAIStream改用StreamAdapter
├── services/agentExecutionEngine.js ← 新增execute()统一入口 + stream_mode判断
├── routes/aiQA.js                  ← 改用SSEWriter
└── views/...                       ← QA对话页面引入stream-consumer.js
```

---

## 五、迁移策略

### 5.1 分阶段实施

| 阶段 | 内容 | 风险 | 依赖 |
|------|------|------|------|
| **Phase 1** | ChunkType + SSEParser + ChunkConverter + ContentAccumulator + StreamAdapter | 低 | 无 |
| **Phase 2** | 改造 callAIStream 使用 StreamAdapter | 中 | Phase 1 |
| **Phase 3** | IdleTimeoutController | 低 | Phase 2 |
| **Phase 4** | 中间件管道 (Logging → Metrics → ThinkingExtractor → RateLimit) | 低 | Phase 2 |
| **Phase 5** | SSEWriter 统一推送层 | 低 | Phase 1 |
| **Phase 6** | 前端 StreamConsumer + QA对话对接 | 中 | Phase 5 |
| **Phase 7** | agentExecutionEngine 统一入口 + stream_mode 判断 | 中 | Phase 6 |

### 5.2 向后兼容保证

1. **callAIStream 接口不变**：`callAIStream(apiUrl, requestBody, headers, options)` 签名保持一致，`options` 新增字段均为可选
2. **onChunk 回调兼容**：现有 `onChunk({ type: 'content', content, fullContent })` 格式继续支持，通过内部适配层转换
3. **返回值兼容**：`callAIStream` 返回的 `{ content, reasoning_content, tool_calls, usage, finish_reason, model }` 结构不变，新增 `metrics` 字段
4. **现有服务零改动**：caseGeneratorService、level1PointService、reflectionPipeline 等服务无需任何修改
5. **SSE事件格式兼容**：前端 StreamConsumer 支持新格式，同时 `/ask-stream` 的 `content` 事件格式保持兼容

### 5.3 灰度策略

- Phase 1-4 完成后，通过环境变量 `USE_STREAM_ADAPTER=true` 控制是否启用新适配器
- 默认关闭，验证无误后切换为默认开启
- 旧代码路径保留，可通过环境变量回退

---

## 六、性能考量

### 6.1 内存占用

| 组件 | 预估内存 | 说明 |
|------|---------|------|
| SSEParser | ~1KB | 仅缓冲区字符串 |
| ChunkConverter | ~2KB | tool_calls累积数组 |
| ContentAccumulator | ~内容大小 | 文本+推理内容累积（与现有一致） |
| 中间件 | ~1KB | 各中间件内部状态极小 |

**结论**：新架构不会增加显著内存开销。

### 6.2 延迟影响

- SSEParser 和 ChunkConverter 均为同步操作，处理延迟 < 0.1ms/chunk
- 中间件管道为同步链式调用，每增加一个中间件增加 < 0.05ms
- RateLimitMiddleware 会合并短间隔delta，实际减少推送次数，降低整体延迟

### 6.3 与现有架构的性能对比

| 指标 | 现有架构 | 新架构 | 变化 |
|------|---------|--------|------|
| SSE解析延迟 | ~0.05ms/chunk | ~0.08ms/chunk | +0.03ms（可忽略） |
| 内存占用 | ~内容大小 | ~内容大小 + 5KB | +5KB（可忽略） |
| 首Token延迟 | 无测量 | TTFT精确测量 | 新增能力 |
| 推理过程可见性 | 不可见 | 实时可见 | 新增能力 |
| 错误可观测性 | 日志 | 日志 + ERROR事件 | 增强 |

---

## 七、测试策略

### 7.1 单元测试

| 测试对象 | 测试要点 |
|---------|---------|
| SSEParser | UTF-8跨包截断、[DONE]识别、JSON解析失败容错、空行处理 |
| ChunkConverter | content/reasoning/tool_calls转换、边界条件 |
| ContentAccumulator | 累积正确性、metrics计算、reset |
| StreamAdapter | 端到端SSE→Chunk流程、中间件管道 |
| IdleTimeoutController | 超时触发、reset重置、cleanup清理 |
| SSEWriter | SSE格式正确性、心跳、客户端断开处理 |
| 各中间件 | 独立逻辑正确性 |

### 7.2 集成测试

| 测试场景 | 验证要点 |
|---------|---------|
| QA流式对话 | 端到端SSE推送 + 前端消费 |
| 批量用例生成 | 内部流式调用，结果与改造前一致 |
| DeepSeek-R1推理 | thinking内容实时推送，空闲超时不误杀 |
| 工具调用循环 | TOOL_CALL/TOOL_RESULT事件正确推送 |
| stream_mode切换 | auto/always/never三种模式行为正确 |
| 网络中断恢复 | ERROR事件正确触发，重试逻辑正常 |

### 7.3 回归测试

- 所有现有AI功能（用例生成、测试点提取、反思管道、记忆蒸馏）结果不变
- 现有API接口（/ask、/generate-overview等）行为不变
- 现有轮询机制（批量任务状态查询）不受影响

---

## 八、总结

本设计报告借鉴 Cherry Studio 的以下核心设计理念：

1. **ChunkType 类型系统** → 解决流事件类型不统一的问题
2. **适配器模式（AiSdkToChunkAdapter）** → 解决 SSE 解析与业务逻辑耦合的问题
3. **中间件管道** → 解决横切关注点硬编码的问题
4. **IdleTimeoutController** → 解决长推理连接被误杀的问题
5. **StreamProcessor 回调机制** → 解决 SSE 推送层不统一的问题
6. **首Token计时 + metrics** → 解决性能不可观测的问题

同时充分考虑了 XTest 系统的特殊性：
- Node.js 后端（非 Electron + React）
- 批量任务场景为主（非纯对话场景）
- 已有成熟的流式调用基础设施
- 需要严格向后兼容

所有改动对现有调用方透明，可分阶段实施，每阶段独立可验证。
