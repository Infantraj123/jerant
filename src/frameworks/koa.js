'use strict';

// Koa adapter (@koa/router). Pass the router(s) so routes can be scanned:
//
//   const Koa = require('koa');
//   const Router = require('@koa/router');
//   const { jerantKoa } = require('jerant');
//   const app = new Koa();
//   const router = new Router();
//   jerantKoa(app, { routers: [router] });
//
// Docs and spec are served by the jerant middleware itself; traffic is
// observed after downstream middleware runs (ctx.body is still the raw
// object there, no re-parsing needed).

const { createCore, disabledInstance } = require('./core');
const { routeKey } = require('../scanner');

const INSTANCE = Symbol.for('jerant.instance');

function scanKoaRouters(routers, internalPaths) {
  const routes = [];
  for (const router of routers) {
    const stack = (router && router.stack) || [];
    for (const layer of stack) {
      if (typeof layer.path !== 'string' || internalPaths.has(layer.path)) continue;
      const methods = (layer.methods || []).filter((m) => m !== 'HEAD');
      const handles = (layer.stack || []).filter((h) => typeof h === 'function');
      for (const method of methods) {
        routes.push({
          method: method.toUpperCase(),
          path: layer.path,
          key: routeKey(method, layer.path),
          handles,
          internal: false,
        });
      }
    }
  }
  return routes;
}

function jerantKoa(app, options = {}) {
  if (!app || typeof app.use !== 'function') {
    throw new TypeError('jerantKoa(app): expected a Koa application');
  }
  if (app[INSTANCE]) return app[INSTANCE];

  const { routers = [], ...rest } = options;
  const core = createCore(rest);
  if (!core.enabled) {
    const disabled = disabledInstance(core.opts);
    app[INSTANCE] = disabled;
    return disabled;
  }
  const { opts } = core;
  const internalPaths = new Set([opts.docsPath, opts.openapiPath]);
  const routerList = Array.isArray(routers) ? routers : [routers];
  const scan = () => scanKoaRouters(routerList, internalPaths);

  app.use(async (ctx, next) => {
    if (ctx.method === 'GET' && ctx.path === opts.docsPath && core.docsHtml !== null) {
      ctx.type = 'html';
      ctx.body = core.docsHtml;
      return;
    }
    if (ctx.method === 'GET' && ctx.path === opts.openapiPath) {
      ctx.body = core.getSpec(scan());
      return;
    }

    await next();

    if (!opts.runtime.enabled || !core.sampleHit()) return;
    // @koa/router exposes the matched pattern after routing.
    const pattern = ctx._matchedRoute;
    if (typeof pattern !== 'string' || internalPaths.has(pattern)) return;
    const body = ctx.body;
    core.record(routeKey(ctx.method, pattern), {
      body: ctx.request.body, // populated by koa-bodyparser and friends
      query: { ...ctx.query },
      params: ctx.params,
      status: ctx.status,
      responseBody: body && typeof body === 'object' && !Buffer.isBuffer(body) ? body : undefined,
      contentType: String(ctx.get('content-type') || '').split(';')[0].trim().toLowerCase() || undefined,
      fileFields: [],
    });
  });

  const instance = {
    enabled: true,
    options: opts,
    registry: core.registry,
    getSpec: (force) => core.getSpec(scan(), force),
    refresh: () => core.getSpec(scan(), true),
    flush: () => core.storage.flush(() => core.registry.toJSON()),
    close: () => core.storage.close(),
  };
  app[INSTANCE] = instance;
  return core.registerInstance(instance);
}

module.exports = { jerantKoa };
