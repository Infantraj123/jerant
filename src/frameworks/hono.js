'use strict';

// Hono adapter (Node runtime). Call before registering routes:
//
//   const { Hono } = require('hono');
//   const { jerantHono } = require('jerant');
//   const app = new Hono();
//   jerantHono(app);
//
// Routes come from app.routes; traffic is observed in a middleware that
// clones the Response after downstream handlers run.

const { createCore, disabledInstance } = require('./core');
const { routeKey } = require('../scanner');

const INSTANCE = Symbol.for('jerant.instance');

function scanHonoRoutes(app, internalPaths) {
  const routes = [];
  const seen = new Set();
  for (const r of app.routes || []) {
    if (!r || typeof r.path !== 'string' || internalPaths.has(r.path)) continue;
    if (r.method === 'ALL' || typeof r.handler !== 'function') continue;
    // Middleware registered via app.use shows up with path '/*'.
    if (r.path.endsWith('*')) continue;
    const key = routeKey(r.method, r.path);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({
      method: r.method.toUpperCase(),
      path: r.path,
      key,
      handles: [r.handler],
      internal: false,
    });
  }
  return routes;
}

function jerantHono(app, options = {}) {
  if (!app || typeof app.use !== 'function' || !('routes' in app)) {
    throw new TypeError('jerantHono(app): expected a Hono application');
  }
  if (app[INSTANCE]) return app[INSTANCE];

  const core = createCore(options);
  if (!core.enabled) {
    const disabled = disabledInstance(core.opts);
    app[INSTANCE] = disabled;
    return disabled;
  }
  const { opts } = core;
  const internalPaths = new Set([opts.docsPath, opts.openapiPath]);
  const scan = () => scanHonoRoutes(app, internalPaths);

  if (opts.runtime.enabled) {
    app.use(async (c, next) => {
      await next();
      try {
        if (!core.sampleHit()) return;
        const pattern = c.req.routePath;
        if (typeof pattern !== 'string' || pattern.endsWith('*') || internalPaths.has(pattern)) return;

        const contentType = String(c.req.header('content-type') || '').split(';')[0].trim().toLowerCase();
        let body;
        if (contentType === 'application/json') {
          try { body = await c.req.json(); } catch { /* unparseable body */ }
        }
        let responseBody;
        const resType = String(c.res.headers.get('content-type') || '');
        if (resType.includes('json')) {
          try { responseBody = await c.res.clone().json(); } catch { /* not JSON */ }
        }
        core.record(routeKey(c.req.method, pattern), {
          body,
          query: c.req.query(),
          params: c.req.param(),
          status: c.res.status,
          responseBody,
          contentType: contentType || undefined,
          fileFields: [],
        });
      } catch { /* analysis must never break the app */ }
    });
  }

  app.get(opts.openapiPath, (c) => c.json(core.getSpec(scan())));
  if (core.docsHtml !== null) {
    app.get(opts.docsPath, (c) => c.html(core.docsHtml));
  }

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

module.exports = { jerantHono };
