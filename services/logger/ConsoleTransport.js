const LEVEL_NAMES = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
  4: 'FATAL'
};

const LEVEL_COLORS = {
  DEBUG: '\x1b[36m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  FATAL: '\x1b[35m'
};

const RESET_COLOR = '\x1b[0m';

class ConsoleTransport {
  constructor(options = {}) {
    this.colorize = options.colorize !== false;
    this.timestamp = options.timestamp !== false;
  }

  write(logEntry) {
    const levelName = LEVEL_NAMES[logEntry.level] || 'INFO';
    const color = this.colorize ? LEVEL_COLORS[levelName] || '' : '';
    const reset = this.colorize ? RESET_COLOR : '';
    
    let output = logEntry.formatted;
    
    if (this.colorize) {
      const levelStart = output.indexOf(`[${levelName}]`);
      if (levelStart !== -1) {
        output = output.substring(0, levelStart) + 
                 color + `[${levelName}]` + reset + 
                 output.substring(levelStart + levelName.length + 2);
      }
    }
    
    const method = this.getConsoleMethod(logEntry.level);
    console[method](output);
  }

  getConsoleMethod(level) {
    switch (level) {
      case 0:
        return 'log';
      case 1:
        return 'log';
      case 2:
        return 'warn';
      case 3:
        return 'error';
      case 4:
        return 'error';
      default:
        return 'log';
    }
  }
}

module.exports = ConsoleTransport;
