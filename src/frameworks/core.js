'use strict';

// Framework-agnostic core shared by the Fastify/Koa/Hono adapters: options,
// registry + persistence, spec cache and the docs page. Each adapter only
// supplies route scanning, request observation and response serving.

const { resolveOptions } = require('../options');
const { Registry } = require('../registry');
const { buildSpec } = require('../openapi');
const { createStorage } = require('../storage');
const { setValidationErrorDefaults } = require('../validate');
const { createServer, createSpecService } = require('../serve');

const INSTANCES = Symbol.for('jerant.instances');
if (!globalThis[INSTANCES]) globalThis[INSTANCES] = [];

/**
 * `scan()` returns the framework's current route list; `routeCount()` is a
 * cheap fingerprint of it (defaults to scan().length).
 */
function createCore(options = {}, { scan, routeCount } = {}) {
  const opts = resolveOptions(options);
  if (!opts.enabled) return { opts, enabled: false };

  if (opts.validationError) setValidationErrorDefaults(opts.validationError);

  const registry = new Registry({
    maxObservations: opts.runtime.maxObservations,
    maxExamples: opts.runtime.maxExamples,
    maxBodyBytes: opts.runtime.maxBodyBytes,
    redactKeys: opts.redactKeys,
    keepExamples: opts.examples === 'captured',
    adaptive: opts.runtime.adaptive !== false,
    warmup: opts.runtime.warmup,
  });
  const storage = createStorage(opts.storage);
  const persisted = storage.load();
  if (persisted && typeof persisted.then === 'function') {
    persisted.then((data) => { if (data) registry.loadJSON(data); }).catch(() => {});
  } else if (persisted) {
    registry.loadJSON(persisted);
  }

  const buildCache = {}; // per-route analysis, reused across rebuilds
  const countRoutes = routeCount || (() => scan().length);
  const specService = createSpecService({
    opts,
    build: () => buildSpec({ routes: scan(), registry, opts, cache: buildCache }),
    inputsKey: () => `${countRoutes()}:${registry.version}`,
  });
  const server = createServer({ opts, specService });

  /** Request-path gate: sampling, exclusions and per-route saturation. */
  function shouldRecord(key, method, path) {
    if (!opts.runtime.enabled) return false;
    if (opts.isExcluded && opts.isExcluded(method, path)) return false;
    return registry.wants(key);
  }

  const save = () => storage.scheduleSave(() => registry.toJSON());

  function record(key, sample) {
    setImmediate(() => {
      try {
        registry.record(key, sample);
        save();
      } catch { /* analysis must never break the app */ }
    });
  }

  const core = {
    enabled: true,
    opts,
    registry,
    storage,
    specService,
    server,
    getSpec: (force) => specService.getSpec(force),
    record,
    save,
    shouldRecord,
    sampleHit: () => opts.runtime.sampleRate >= 1 || Math.random() < opts.runtime.sampleRate,
    /** The public instance object every adapter returns. */
    instance() {
      return {
        enabled: true,
        options: opts,
        registry,
        getSpec: (force) => specService.getSpec(force),
        refresh: () => specService.getSpec(true),
        flush: () => storage.flush(() => registry.toJSON()),
        close: () => storage.close(),
      };
    },
    registerInstance(instance) {
      globalThis[INSTANCES].push(instance);
      return instance;
    },
  };
  return core;
}

/** Turn a bundle of plain JSON schemas (fastify-style) into the __jerant
 * marker handle detectValidation understands. */
function markerFromJsonSchemas({ body, query, params, response } = {}) {
  const marker = function jerantFrameworkSchemas() {};
  const responses = {};
  for (const [status, schema] of Object.entries(response || {})) {
    if (/^\d{3}$/.test(status) && schema && typeof schema === 'object') responses[status] = schema;
  }
  marker.__jerant = {
    schemas: {
      ...(body ? { body } : {}),
      ...(query ? { query } : {}),
      ...(params ? { params } : {}),
    },
    responses: Object.keys(responses).length ? responses : null,
  };
  return marker;
}

const disabledInstance = (opts) => ({
  enabled: false,
  options: opts,
  getSpec: () => null,
  refresh: () => null,
  flush: () => {},
  close: () => {},
});

module.exports = { createCore, markerFromJsonSchemas, disabledInstance };
