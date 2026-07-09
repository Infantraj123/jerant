'use strict';

const { MemoryStore } = require('./memory');
const { FileStore } = require('./file');

function createStorage(storageOpts = {}) {
  if (storageOpts.mode === 'file') {
    return new FileStore(storageOpts.path || '.jerant/data.json', storageOpts);
  }
  return new MemoryStore();
}

module.exports = { createStorage, MemoryStore, FileStore };
