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

function scanKoaRouters(routers, isInternalPath) {
  const routes = [];
  for (const router of routers) {
    const stack = (router && router.stack) || [];
    for (const layer of stack) {
      if (typeof layer.path !== 'string' || isInternalPath(layer.path)) continue;
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
  const routerList = Array.isArray(routers) ? routers : [routers];
  let isInternalPath = () => false;
  const scan = () => scanKoaRouters(routerList, isInternalPath);
  const core = createCore(rest, {
    scan,
    routeCount: () => routerList.reduce((n, r) => n + ((r && r.stack && r.stack.length) || 0), 0),
  });
  if (!core.enabled) {
    const disabled = disabledInstance(core.opts);
    app[INSTANCE] = disabled;
    return disabled;
  }
  const { opts, server } = core;
  isInternalPath = server.isInternalPath;

  app.use(async (ctx, next) => {
    if ((ctx.method === 'GET' || ctx.method === 'HEAD') && server.isInternalPath(ctx.path)) {
      const response = await server.handle({
        method: ctx.method, path: ctx.path, headers: ctx.headers, query: ctx.query, nativeReq: ctx,
      });
      if (response) {
        ctx.status = response.status;
        ctx.set(response.headers);
        ctx.body = response.status === 304 ? null : response.body;
        return;
      }
    }

    await next();

    if (!opts.runtime.enabled || !core.sampleHit()) return;
    // @koa/router exposes the matched pattern after routing.
    const pattern = ctx._matchedRoute;
    if (typeof pattern !== 'string' || server.isInternalPath(pattern)) return;
    if (!core.shouldRecord(routeKey(ctx.method, pattern), ctx.method, pattern)) return;
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

  const instance = core.instance();
  app[INSTANCE] = instance;
  return core.registerInstance(instance);
}

module.exports = { jerantKoa };
