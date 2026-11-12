'use strict';

// jerant — zero-config automatic API documentation for Express (plus
// Fastify, Koa and Hono adapters).
//
//   const express = require('express');
//   const { jerant } = require('jerant');
//   const app = express();
//   jerant(app);
//   app.listen(3000);   // docs at /docs, spec at /openapi.json

const { createCore, disabledInstance } = require('./frameworks/core');
const { createAnalyzer } = require('./analyzer');
const { scanRoutes, getRootStack } = require('./scanner');
const { writeNode } = require('./serve');
const { instrumentMounts, patchRouterPrototype } = require('./mounts');
const { validate, doc } = require('./validate');
const { themeCss } = require('./docs-ui');
const { toOpenApi30 } = require('./downgrade');
const adapters = require('./adapters');

const INSTANCE = Symbol.for('jerant.instance');

function jerant(app, options = {}) {
  if (!app || typeof app.use !== 'function' || typeof app.get !== 'function') {
    throw new TypeError('jerant(app): expected an Express application (or Router), got ' + typeof app);
  }
  if (app[INSTANCE]) return app[INSTANCE];

  const core = createCore(options, {
    scan: () => scanRoutes(app),
    // Cheap change detector: the root stack grows when routes/routers are added.
    routeCount: () => getRootStack(app).length,
  });
  if (!core.enabled) {
    const disabled = disabledInstance(core.opts);
    app[INSTANCE] = disabled;
    return disabled;
  }
  const { opts, server } = core;

  // Record router mount paths as they happen (required for Express 5,
  // where mount prefixes cannot be reconstructed from the router stack).
  instrumentMounts(app);
  if (opts.patchRouter) patchRouterPrototype(app);

  if (opts.runtime.enabled) {
    app.use(createAnalyzer(core, () => scanRoutes(app)));
  }

  // jerant's own endpoints: spec, docs page, theme.css, local assets.
  for (const routePath of server.routes) {
    const isAssets = routePath.endsWith('/:file');
    const handler = (req, res, next) => {
      const path = isAssets ? routePath.slice(0, -':file'.length) + req.params.file : routePath;
      server.handle({ method: req.method, path, headers: req.headers, query: req.query, nativeReq: req })
        .then((response) => (response ? writeNode(res, response) : next()), next);
    };
    handler.__jerantInternal = true;
    app.get(routePath, handler);
  }

  const instance = core.instance();
  app[INSTANCE] = instance;
  return core.registerInstance(instance);
}

module.exports = jerant;
module.exports.jerant = jerant;
module.exports.default = jerant;
module.exports.validate = validate;
module.exports.doc = doc;
module.exports.adapters = adapters;
module.exports.themeCss = themeCss;
module.exports.toOpenApi30 = toOpenApi30;
module.exports.jerantFastify = require('./frameworks/fastify').jerantFastify;
module.exports.jerantKoa = require('./frameworks/koa').jerantKoa;
module.exports.jerantHono = require('./frameworks/hono').jerantHono;
