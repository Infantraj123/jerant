'use strict';

// jerant — zero-config automatic API documentation for Express.
//
//   const express = require('express');
//   const { jerant } = require('jerant');
//   const app = express();
//   jerant(app);
//   app.listen(3000);   // docs at /docs, spec at /openapi.json

const { resolveOptions } = require('./options');
const { Registry } = require('./registry');
const { createAnalyzer } = require('./analyzer');
const { scanRoutes, getRootStack } = require('./scanner');
const { buildSpec } = require('./openapi');
const { renderDocsPage } = require('./docs-ui');
const { createStorage } = require('./storage');
const { createAssetsHandler } = require('./assets');
const { instrumentMounts, patchRouterPrototype } = require('./mounts');
const { validate, doc, setValidationErrorDefaults } = require('./validate');
const adapters = require('./adapters');

const INSTANCE = Symbol.for('jerant.instance');
// All live instances in this process; lets `npx jerant export` find the app.
const INSTANCES = Symbol.for('jerant.instances');
if (!globalThis[INSTANCES]) globalThis[INSTANCES] = [];

function jerant(app, options = {}) {
  if (!app || typeof app.use !== 'function' || typeof app.get !== 'function') {
    throw new TypeError('jerant(app): expected an Express application (or Router), got ' + typeof app);
  }
  if (app[INSTANCE]) return app[INSTANCE];

  const opts = resolveOptions(options);
  if (!opts.enabled) {
    const disabled = { enabled: false, options: opts, getSpec: () => null, refresh: () => null, flush: () => {}, close: () => {} };
    app[INSTANCE] = disabled;
    return disabled;
  }

  if (opts.validationError) setValidationErrorDefaults(opts.validationError);

  // Record router mount paths as they happen (required for Express 5,
  // where mount prefixes cannot be reconstructed from the router stack).
  instrumentMounts(app);
  if (opts.patchRouter) patchRouterPrototype(app);

  const registry = new Registry({
    maxObservations: opts.runtime.maxObservations,
    maxExamples: opts.runtime.maxExamples,
    maxBodyBytes: opts.runtime.maxBodyBytes,
    redactKeys: opts.redactKeys,
  });
  const storage = createStorage(opts.storage);
  const persisted = storage.load();
  if (persisted && typeof persisted.then === 'function') {
    // Async stores (Redis et al) hydrate the registry when they resolve.
    persisted.then((data) => { if (data) registry.loadJSON(data); }).catch(() => {});
  } else if (persisted) {
    registry.loadJSON(persisted);
  }

  if (opts.runtime.enabled) {
    app.use(createAnalyzer(
      registry,
      opts,
      () => storage.scheduleSave(() => registry.toJSON()),
      () => scanRoutes(app) // tags route objects with mount prefixes; no spec build
    ));
  }

  // Spec cache: routes rarely change after boot, but runtime analysis keeps
  // learning, so rebuild at most once per cacheTtlMs (and immediately when
  // the router stack grows).
  let cache = null;
  function getSpec(force = false) {
    const stackSize = getRootStack(app).length;
    const now = Date.now();
    if (!force && cache && cache.stackSize === stackSize && now - cache.builtAt < opts.cacheTtlMs) {
      return cache.spec;
    }
    const routes = scanRoutes(app);
    const spec = buildSpec({ routes, registry, opts });
    cache = { spec, builtAt: now, stackSize };
    return spec;
  }

  const openapiHandler = (req, res) => {
    res.json(getSpec());
  };
  openapiHandler.__jerantInternal = true;
  app.get(opts.openapiPath, openapiHandler);

  if (opts.assets === 'local') {
    app.get(`${opts.docsPath}/assets/:file`, createAssetsHandler());
  }

  const docsHtml = renderDocsPage(opts); // null with ui: false (spec only)
  if (docsHtml !== null) {
    const docsHandler = (req, res) => {
      res.type('html').send(docsHtml);
    };
    docsHandler.__jerantInternal = true;
    app.get(opts.docsPath, docsHandler);
  }

  const instance = {
    enabled: true,
    options: opts,
    registry,
    getSpec,
    refresh: () => getSpec(true),
    flush: () => storage.flush(() => registry.toJSON()),
    close: () => storage.close(),
  };
  app[INSTANCE] = instance;
  globalThis[INSTANCES].push(instance);
  return instance;
}

module.exports = jerant;
module.exports.jerant = jerant;
module.exports.default = jerant;
module.exports.validate = validate;
module.exports.doc = doc;
module.exports.adapters = adapters;
module.exports.jerantFastify = require('./frameworks/fastify').jerantFastify;
module.exports.jerantKoa = require('./frameworks/koa').jerantKoa;
module.exports.jerantHono = require('./frameworks/hono').jerantHono;
