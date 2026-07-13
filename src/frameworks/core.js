'use strict';

// Framework-agnostic core shared by the Fastify/Koa/Hono adapters: options,
// registry + persistence, spec cache and the docs page. Each adapter only
// supplies route scanning, request observation and response serving.

const { resolveOptions } = require('../options');
const { Registry } = require('../registry');
const { buildSpec } = require('../openapi');
const { renderDocsPage } = require('../docs-ui');
const { createStorage } = require('../storage');
const { setValidationErrorDefaults } = require('../validate');

const INSTANCES = Symbol.for('jerant.instances');
if (!globalThis[INSTANCES]) globalThis[INSTANCES] = [];

function createCore(options = {}) {
  const opts = resolveOptions(options);
  if (!opts.enabled) return { opts, enabled: false };

  if (opts.validationError) setValidationErrorDefaults(opts.validationError);

  const registry = new Registry({
    maxObservations: opts.runtime.maxObservations,
    maxExamples: opts.runtime.maxExamples,
    maxBodyBytes: opts.runtime.maxBodyBytes,
    redactKeys: opts.redactKeys,
  });
  const storage = createStorage(opts.storage);
  const persisted = storage.load();
  if (persisted && typeof persisted.then === 'function') {
    persisted.then((data) => { if (data) registry.loadJSON(data); }).catch(() => {});
  } else if (persisted) {
    registry.loadJSON(persisted);
  }

  let cache = null;
  function getSpec(routes, force = false) {
    const now = Date.now();
    if (!force && cache && cache.routeCount === routes.length && now - cache.builtAt < opts.cacheTtlMs) {
      return cache.spec;
    }
    const spec = buildSpec({ routes, registry, opts });
    cache = { spec, builtAt: now, routeCount: routes.length };
    return spec;
  }

  function record(key, sample) {
    setImmediate(() => {
      try {
        registry.record(key, sample);
        storage.scheduleSave(() => registry.toJSON());
      } catch { /* analysis must never break the app */ }
    });
  }

  const core = {
    enabled: true,
    opts,
    registry,
    storage,
    getSpec,
    record,
    docsHtml: renderDocsPage(opts),
    sampleHit: () => opts.runtime.sampleRate >= 1 || Math.random() <= opts.runtime.sampleRate,
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
