'use strict';

const { MemoryStore } = require('./memory');
const { FileStore } = require('./file');

/**
 * Adapter for user-supplied stores (Redis, S3, a shared DB — anything that
 * fixes the multi-instance file race). The custom store implements the small
 * contract { load(), save(data), close?() } — load may return a promise —
 * and this wrapper adds the debouncing jerant expects.
 */
class CustomStoreAdapter {
  constructor(store, options = {}) {
    if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') {
      throw new TypeError('jerant storage: a custom store must implement load() and save(data)');
    }
    this.store = store;
    this.debounceMs = options.debounceMs || 2000;
    this.timer = null;
    this.getData = null;
  }

  load() {
    try {
      return this.store.load();
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
      const result = this.store.save(data);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* persistence is best-effort */ }
  }

  close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
    try {
      if (typeof this.store.close === 'function') this.store.close();
    } catch { /* best-effort */ }
  }
}

function createStorage(storageOpts = {}) {
  if (storageOpts.store) {
    return new CustomStoreAdapter(storageOpts.store, storageOpts);
  }
  if (storageOpts.mode === 'file') {
    return new FileStore(storageOpts.path || '.jerant/data.json', storageOpts);
  }
  if (storageOpts.mode === 'custom') {
    throw new TypeError("jerant storage: mode 'custom' requires storage.store");
  }
  return new MemoryStore();
}

module.exports = { createStorage, MemoryStore, FileStore, CustomStoreAdapter };
