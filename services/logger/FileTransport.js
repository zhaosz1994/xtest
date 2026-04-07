const fs = require('fs');
const path = require('path');

class FileTransport {
  constructor(options = {}) {
    this.filename = options.filename || path.join(process.cwd(), 'logs', 'app.log');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024;
    this.maxFiles = options.maxFiles || 5;
    this.rotateByDate = options.rotateByDate !== false;
    this.currentDate = this.getCurrentDate();
    this.stream = null;
    this.currentSize = 0;
    this.initialized = false;
    this.writeQueue = [];
    this.writing = false;
    
    this.init();
  }

  init() {
    const logDir = path.dirname(this.filename);
    
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (err) {
        console.error(`Failed to create log directory: ${err.message}`);
        return;
      }
    }
    
    this.createStream();
    this.initialized = true;
    
    if (this.rotateByDate) {
      this.startDailyRotation();
    }
  }

  getCurrentDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  startDailyRotation() {
    const checkDateChange = () => {
      const currentDate = this.getCurrentDate();
      if (currentDate !== this.currentDate) {
        this.rotateByDateChange();
      }
    };
    
    setInterval(checkDateChange, 60000);
  }

  rotateByDateChange() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const datedFilename = `${this.filename}.${timestamp}`;
    
    if (fs.existsSync(this.filename)) {
      try {
        fs.renameSync(this.filename, datedFilename);
      } catch (err) {
        console.error(`Failed to rename log file for date rotation: ${err.message}`);
      }
    }
    
    this.currentDate = this.getCurrentDate();
    this.createStream();
    this.currentSize = 0;
    
    this.cleanOldFiles();
  }

  createStream() {
    if (this.stream) {
      this.stream.end();
    }
    
    try {
      const stats = fs.existsSync(this.filename) ? fs.statSync(this.filename) : null;
      this.currentSize = stats ? stats.size : 0;
      
      this.stream = fs.createWriteStream(this.filename, {
        flags: 'a',
        encoding: 'utf8'
      });
      
      this.stream.on('error', (err) => {
        console.error(`Log file stream error: ${err.message}`);
      });
    } catch (err) {
      console.error(`Failed to create log stream: ${err.message}`);
    }
  }

  getFileSize(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch (err) {
      return 0;
    }
  }

  shouldRotate() {
    return this.currentSize >= this.maxFileSize;
  }

  rotate() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    
    this.shiftFiles();
    this.createStream();
    this.currentSize = 0;
  }

  shiftFiles() {
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const oldFile = `${this.filename}.${i}`;
      const newFile = `${this.filename}.${i + 1}`;
      
      if (fs.existsSync(oldFile)) {
        if (i === this.maxFiles - 1) {
          try {
            fs.unlinkSync(oldFile);
          } catch (err) {
            console.error(`Failed to delete old log file: ${err.message}`);
          }
        } else {
          try {
            fs.renameSync(oldFile, newFile);
          } catch (err) {
            console.error(`Failed to rename log file: ${err.message}`);
          }
        }
      }
    }
    
    if (fs.existsSync(this.filename)) {
      try {
        fs.renameSync(this.filename, `${this.filename}.1`);
      } catch (err) {
        console.error(`Failed to rename current log file: ${err.message}`);
      }
    }
  }

  cleanOldFiles() {
    const logDir = path.dirname(this.filename);
    const baseName = path.basename(this.filename);
    
    try {
      const files = fs.readdirSync(logDir);
      const logFiles = files
        .filter(f => f.startsWith(baseName) && f !== baseName)
        .map(f => ({
          name: f,
          path: path.join(logDir, f),
          time: fs.statSync(path.join(logDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);
      
      while (logFiles.length > this.maxFiles) {
        const oldestFile = logFiles.pop();
        try {
          fs.unlinkSync(oldestFile.path);
        } catch (err) {
          console.error(`Failed to delete old log file: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`Failed to clean old log files: ${err.message}`);
    }
  }

  write(logEntry) {
    if (!this.initialized || !this.stream) {
      return;
    }
    
    if (this.rotateByDate) {
      const currentDate = this.getCurrentDate();
      if (currentDate !== this.currentDate) {
        this.rotateByDateChange();
      }
    }
    
    const logString = logEntry.formatted + '\n';
    const logBuffer = Buffer.from(logString, 'utf8');
    
    this.writeQueue.push(logBuffer);
    this.processQueue();
  }

  processQueue() {
    if (this.writing || this.writeQueue.length === 0) {
      return;
    }
    
    this.writing = true;
    
    const writeNext = () => {
      if (this.writeQueue.length === 0) {
        this.writing = false;
        return;
      }
      
      const buffer = this.writeQueue.shift();
      
      if (this.shouldRotate()) {
        this.rotate();
      }
      
      if (this.stream && this.stream.writable) {
        this.stream.write(buffer, (err) => {
          if (err) {
            console.error(`Failed to write log: ${err.message}`);
          } else {
            this.currentSize += buffer.length;
          }
          writeNext();
        });
      } else {
        writeNext();
      }
    };
    
    writeNext();
  }

  end() {
    if (this.stream) {
      this.stream.end();
    }
  }
}

module.exports = FileTransport;
