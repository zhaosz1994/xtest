class StreamConsumer {
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
      const headers = {
        'Content-Type': 'application/json',
        ...this.headers
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.body),
        credentials: 'same-origin',
        signal: this._abortController.signal
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let currentData = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith(': ')) continue;

          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7).trim();
          } else if (trimmed.startsWith('data: ')) {
            currentData += trimmed.slice(6);
          } else if (trimmed === '') {
            if (currentEvent && currentData) {
              try {
                const data = JSON.parse(currentData);
                this._handleEvent(currentEvent, data);
              } catch (e) {
                console.warn('StreamConsumer: SSE data JSON解析失败', e.message);
              }
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }

      if (currentEvent && currentData) {
        try {
          const data = JSON.parse(currentData);
          this._handleEvent(currentEvent, data);
        } catch (e) {}
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
        if (data.toolName !== undefined) {
          this.callbacks.onToolResult?.(data.toolName, data.result, data.success);
        } else if (data.tool !== undefined) {
          this.callbacks.onToolResult?.(data.tool, data.preview || '完成', true);
        }
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
