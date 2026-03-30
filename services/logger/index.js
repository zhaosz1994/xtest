const path = require('path');
const Logger = require('./Logger');
const FileTransport = require('./FileTransport');
const ConsoleTransport = require('./ConsoleTransport');

const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const logLevel = process.env.LOG_LEVEL || 'info';
const maxFileSize = parseInt(process.env.LOG_MAX_FILE_SIZE || '10', 10) * 1024 * 1024;
const maxFiles = parseInt(process.env.LOG_MAX_FILES || '5', 10);
const logConsole = process.env.LOG_CONSOLE !== 'false';

const transports = [
  new FileTransport({
    filename: path.join(logDir, 'app.log'),
    maxFileSize,
    maxFiles
  })
];

if (logConsole) {
  transports.push(new ConsoleTransport({
    colorize: true,
    timestamp: true
  }));
}

const logger = Logger.createLogger({
  level: logLevel,
  transports,
  defaultMeta: {
    module: 'app'
  }
});

logger.Logger = Logger;
logger.FileTransport = FileTransport;
logger.ConsoleTransport = ConsoleTransport;

module.exports = logger;
