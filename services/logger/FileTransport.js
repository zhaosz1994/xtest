const fs = require('fs');
const fsp = require('fs').promises;
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

  async init() {
    const logDir = path.dirname(this.filename);
    
    try {
      await fsp.mkdir(logDir, { recursive: true });
    } catch (err) {
      console.error(`Failed to create log directory: ${err.message}`);
      return;
    }
    
    await this.createStream();
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
        this.writeQueue.push({ type: 'rotateByDate' });
        this.processQueue();
      }
    };
    
    setInterval(checkDateChange, 60000);
  }

  async rotateByDateChange() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const datedFilename = `${this.filename}.${timestamp}`;
    
    try {
      await fsp.rename(this.filename, datedFilename);
    } catch {
      // File might not exist, that's ok
    }
    
    this.currentDate = this.getCurrentDate();
    await this.createStream();
    this.currentSize = 0;
    
    this.cleanOldFiles(); // fire and forget
  }

  async createStream() {
    if (this.stream) {
      this.stream.end();
    }
    
    try {
      let size = 0;
      try {
        const stats = await fsp.stat(this.filename);
        size = stats.size;
      } catch {
        // File doesn't exist yet
      }
      this.currentSize = size;
      
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

  shouldRotate() {
    return this.currentSize >= this.maxFileSize;
  }

  async rotate() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    
    await this.shiftFiles();
    await this.createStream();
    this.currentSize = 0;
  }

  async shiftFiles() {
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const oldFile = `${this.filename}.${i}`;
      const newFile = `${this.filename}.${i + 1}`;
      
      try {
        await fsp.access(oldFile);
        if (i === this.maxFiles - 1) {
          try {
            await fsp.unlink(oldFile);
          } catch (err) {
            console.error(`Failed to delete old log file: ${err.message}`);
          }
        } else {
          try {
            await fsp.rename(oldFile, newFile);
          } catch (err) {
            console.error(`Failed to rename log file: ${err.message}`);
          }
        }
      } catch {
        // oldFile doesn't exist, skip
      }
    }
    
    try {
      await fsp.rename(this.filename, `${this.filename}.1`);
    } catch (err) {
      console.error(`Failed to rename current log file: ${err.message}`);
    }
  }

  async cleanOldFiles() {
    const logDir = path.dirname(this.filename);
    const baseName = path.basename(this.filename);
    
    try {
      const files = await fsp.readdir(logDir);
      const logFileNames = files.filter(f => f.startsWith(baseName) && f !== baseName);
      
      const logFiles = [];
      for (const f of logFileNames) {
        try {
          const stats = await fsp.stat(path.join(logDir, f));
          logFiles.push({
            name: f,
            path: path.join(logDir, f),
            time: stats.mtime.getTime()
          });
        } catch {
          // skip files that can't be stat'd
        }
      }
      
      logFiles.sort((a, b) => b.time - a.time);
      
      while (logFiles.length > this.maxFiles) {
        const oldestFile = logFiles.pop();
        try {
          await fsp.unlink(oldestFile.path);
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
    
    const logString = logEntry.formatted + '\n';
    const logBuffer = Buffer.from(logString, 'utf8');
    
    this.writeQueue.push({ type: 'write', data: logBuffer });
    this.processQueue();
  }

  async processQueue() {
    if (this.writing || this.writeQueue.length === 0) {
      return;
    }
    
    this.writing = true;
    
    while (this.writeQueue.length > 0) {
      const item = this.writeQueue.shift();
      
      if (item.type === 'rotateByDate') {
        await this.rotateByDateChange();
        continue;
      }
      
      const buffer = item.data;
      
      if (this.rotateByDate) {
        const currentDate = this.getCurrentDate();
        if (currentDate !== this.currentDate) {
          await this.rotateByDateChange();
        }
      }
      
      if (this.shouldRotate()) {
        await this.rotate();
      }
      
      if (this.stream && this.stream.writable) {
        await new Promise((resolve) => {
          this.stream.write(buffer, (err) => {
            if (err) {
              console.error(`Failed to write log: ${err.message}`);
            } else {
              this.currentSize += buffer.length;
            }
            resolve();
          });
        });
      }
    }
    
    this.writing = false;
  }

  end() {
    if (this.stream) {
      this.stream.end();
    }
  }
}

module.exports = FileTransport;
