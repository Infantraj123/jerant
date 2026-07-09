'use strict';

const { normalizePath } = require('./util');

const DEFAULTS = {
  enabled: true,
  docsPath: '/docs',
  openapiPath: '/openapi.json',
  title: undefined,
  version: undefined,
  description: undefined,
  servers: undefined,
  cdn: 'https://unpkg.com/swagger-ui-dist@5',
  cacheTtlMs: 2000,
  // Instrument the router prototype so nested-router mount paths are captured
  // on Express 5 regardless of mount order. Recording only; set false to opt out.
  patchRouter: true,
  redactKeys: [],
  runtime: {
    enabled: true,
    sampleRate: 1,
    maxExamples: 3,
    maxObservations: 1000,
    maxBodyBytes: 100 * 1024,
  },
  storage: {
    mode: 'memory', // 'memory' | 'file'
    path: '.jerant/data.json',
  },
};

function resolveOptions(options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options,
    runtime: { ...DEFAULTS.runtime, ...(options.runtime || {}) },
    storage: { ...DEFAULTS.storage, ...(options.storage || {}) },
  };
  if (process.env.JERANT_DISABLED === '1' || process.env.JERANT_DISABLED === 'true') {
    opts.enabled = false;
  }
  opts.docsPath = normalizePath(opts.docsPath);
  opts.openapiPath = normalizePath(opts.openapiPath);
  opts.runtime.sampleRate = Math.max(0, Math.min(1, Number(opts.runtime.sampleRate) || 0));
  opts.redactKeys = Array.isArray(opts.redactKeys) ? opts.redactKeys : [];
  return opts;
}

module.exports = { resolveOptions, DEFAULTS };
