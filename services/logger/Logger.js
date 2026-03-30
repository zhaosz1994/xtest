const path = require('path');
const fs = require('fs');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4
};

const LEVEL_NAMES = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
  4: 'FATAL'
};

class Logger {
  constructor(options = {}) {
    this.level = this.parseLevel(options.level || 'info');
    this.transports = options.transports || [];
    this.defaultMeta = options.defaultMeta || {};
  }

  parseLevel(level) {
    if (typeof level === 'number') {
      return level;
    }
    const upperLevel = level.toUpperCase();
    return LOG_LEVELS[upperLevel] !== undefined ? LOG_LEVELS[upperLevel] : LOG_LEVELS.INFO;
  }

  formatTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = this.formatTimestamp();
    const levelName = LEVEL_NAMES[level] || 'INFO';
    const module = meta.module || this.defaultMeta.module || 'app';
    const requestId = meta.requestId || this.defaultMeta.requestId;
    
    let formattedMessage = `[${timestamp}] [${levelName}] [${module}]`;
    
    if (requestId) {
      formattedMessage += ` [${requestId}]`;
    }
    
    formattedMessage += ` ${message}`;
    
    const metaCopy = { ...meta };
    delete metaCopy.module;
    delete metaCopy.requestId;
    
    if (Object.keys(metaCopy).length > 0) {
      try {
        formattedMessage += ` ${JSON.stringify(metaCopy)}`;
      } catch (e) {
        formattedMessage += ` [Meta serialization failed]`;
      }
    }
    
    return formattedMessage;
  }

  log(level, message, meta = {}) {
    if (level < this.level) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message, meta);
    const logEntry = {
      level,
      message,
      meta: { ...this.defaultMeta, ...meta },
      timestamp: new Date(),
      formatted: formattedMessage
    };

    for (const transport of this.transports) {
      try {
        transport.write(logEntry);
      } catch (err) {
        console.error(`Logger transport error: ${err.message}`);
      }
    }
  }

  debug(message, meta = {}) {
    this.log(LOG_LEVELS.DEBUG, message, meta);
  }

  info(message, meta = {}) {
    this.log(LOG_LEVELS.INFO, message, meta);
  }

  warn(message, meta = {}) {
    this.log(LOG_LEVELS.WARN, message, meta);
  }

  error(message, meta = {}) {
    this.log(LOG_LEVELS.ERROR, message, meta);
  }

  fatal(message, meta = {}) {
    this.log(LOG_LEVELS.FATAL, message, meta);
  }

  setLevel(level) {
    this.level = this.parseLevel(level);
  }

  child(meta = {}) {
    const childLogger = new Logger({
      level: this.level,
      transports: this.transports,
      defaultMeta: { ...this.defaultMeta, ...meta }
    });
    return childLogger;
  }

  addTransport(transport) {
    this.transports.push(transport);
  }

  static createLogger(options = {}) {
    return new Logger(options);
  }
}

Logger.LEVELS = LOG_LEVELS;

module.exports = Logger;
