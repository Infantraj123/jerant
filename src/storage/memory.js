'use strict';

/** In-memory storage: nothing survives a restart, nothing to do. */
class MemoryStore {
  load() { return null; }
  scheduleSave() {}
  flush() {}
  close() {}
}

module.exports = { MemoryStore };
