'use strict';

const fs = require('fs');
const path = require('path');

/**
 * File persistence. Scheduled saves are debounced and written
 * asynchronously (tmp file + atomic rename) so a large registry never
 * blocks the event loop on disk I/O; at most one write is in flight and a
 * save requested meanwhile is coalesced into one follow-up write.
 * flush() stays synchronous (explicit flushes and process exit must land
 * before returning).
 */
class FileStore {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.debounceMs = options.debounceMs || 2000;
    this.timer = null;
    this.getData = null;
    this.writing = false;
    this.dirty = false;
    this.seq = 0;
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
      this.writeAsync();
    }, this.debounceMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  tmpPath() {
    this.seq += 1;
    return `${this.filePath}.${process.pid}.${this.seq}.tmp`;
  }

  serialize(getData) {
    const source = getData || this.getData;
    if (!source) return null;
    const data = typeof source === 'function' ? source() : source;
    return JSON.stringify(data);
  }

  /** Non-blocking write; resolves when the file is on disk (never rejects). */
  async writeAsync(getData) {
    if (this.writing) {
      this.dirty = true;
      return;
    }
    this.writing = true;
    try {
      do {
        this.dirty = false;
        const text = this.serialize(getData);
        if (text === null) break;
        const tmp = this.tmpPath();
        try {
          await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
          await fs.promises.writeFile(tmp, text);
          await fs.promises.rename(tmp, this.filePath);
        } catch {
          fs.promises.unlink(tmp).catch(() => {}); /* persistence is best-effort */
        }
      } while (this.dirty);
    } finally {
      this.writing = false;
    }
  }

  flush(getData) {
    try {
      const text = this.serialize(getData);
      if (text === null) return;
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.tmpPath();
      fs.writeFileSync(tmp, text);
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
