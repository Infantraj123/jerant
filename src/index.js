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
const { instrumentMounts, patchRouterPrototype } = require('./mounts');
const { validate, doc } = require('./validate');
const adapters = require('./adapters');

const INSTANCE = Symbol.for('jerant.instance');

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
  if (persisted) registry.loadJSON(persisted);

  if (opts.runtime.enabled) {
    app.use(createAnalyzer(registry, opts, () => storage.scheduleSave(() => registry.toJSON())));
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

  const docsHtml = renderDocsPage(opts);
  const docsHandler = (req, res) => {
    res.type('html').send(docsHtml);
  };
  docsHandler.__jerantInternal = true;
  app.get(opts.docsPath, docsHandler);

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
  return instance;
}

module.exports = jerant;
module.exports.jerant = jerant;
module.exports.default = jerant;
module.exports.validate = validate;
module.exports.doc = doc;
module.exports.adapters = adapters;
