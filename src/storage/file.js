'use strict';

const fs = require('fs');
const path = require('path');

/**
 * File persistence: debounced async writes during operation (atomic
 * tmp+rename), plus a synchronous flush on process exit so learned schemas
 * survive restarts.
 */
class FileStore {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.debounceMs = options.debounceMs || 2000;
    this.timer = null;
    this.getData = null;
    this.exitHook = () => this.flush();
    process.once('exit', this.exitHook);
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  scheduleSave(getData) {
    this.getData = getData;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  flush(getData) {
    const source = getData || this.getData;
    if (!source) return;
    try {
      const data = typeof source === 'function' ? source() : source;
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.filePath);
    } catch { /* persistence is best-effort */ }
  }

  close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
    process.removeListener('exit', this.exitHook);
  }
}

module.exports = { FileStore };
