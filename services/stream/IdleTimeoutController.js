const logger = require('../logger');

class IdleTimeoutController {
  constructor(timeoutMs = 30 * 60 * 1000, parentSignal = null) {
    this._timeoutMs = timeoutMs;
    this._abortController = new AbortController();
    this._timer = null;
    this._cleaned = false;
    this._parentSignal = null;
    this._parentAbortHandler = null;

    if (parentSignal) {
      if (parentSignal.aborted) {
        this._abortController.abort();
      } else {
        this._parentSignal = parentSignal;
        this._parentAbortHandler = () => {
          this._abortController.abort();
        };
        parentSignal.addEventListener('abort', this._parentAbortHandler);
      }
    }

    this._startTimer();
  }

  get signal() {
    return this._abortController.signal;
  }

  reset() {
    if (this._cleaned) return;
    clearTimeout(this._timer);
    this._startTimer();
  }

  cleanup() {
    this._cleaned = true;
    clearTimeout(this._timer);
    if (this._parentSignal && this._parentAbortHandler) {
      try {
        this._parentSignal.removeEventListener('abort', this._parentAbortHandler);
      } catch (e) {}
      this._parentSignal = null;
      this._parentAbortHandler = null;
    }
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
