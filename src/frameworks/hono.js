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

function scanHonoRoutes(app, isInternalPath) {
  const routes = [];
  const seen = new Set();
  for (const r of app.routes || []) {
    if (!r || typeof r.path !== 'string' || isInternalPath(r.path)) continue;
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

  let isInternalPath = () => false;
  const scan = () => scanHonoRoutes(app, isInternalPath);
  const core = createCore(options, { scan, routeCount: () => (app.routes || []).length });
  if (!core.enabled) {
    const disabled = disabledInstance(core.opts);
    app[INSTANCE] = disabled;
    return disabled;
  }
  const { opts, server } = core;
  isInternalPath = server.isInternalPath;

  if (opts.runtime.enabled) {
    app.use(async (c, next) => {
      await next();
      try {
        if (!core.sampleHit()) return;
        const pattern = c.req.routePath;
        if (typeof pattern !== 'string' || pattern.endsWith('*') || server.isInternalPath(pattern)) return;
        if (!core.shouldRecord(routeKey(c.req.method, pattern), c.req.method, pattern)) return;

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

  for (const routePath of server.routes) {
    const isAssets = routePath.endsWith('/:file');
    app.get(routePath, async (c) => {
      const path = isAssets ? routePath.slice(0, -':file'.length) + c.req.param('file') : routePath;
      const response = await server.handle({
        method: c.req.method, path, headers: c.req.raw.headers, query: c.req.query(), nativeReq: c,
      });
      if (!response) return c.notFound();
      return new Response(response.status === 304 ? null : response.body, {
        status: response.status,
        headers: response.headers,
      });
    });
  }

  const instance = core.instance();
  app[INSTANCE] = instance;
  return core.registerInstance(instance);
}

module.exports = { jerantHono };
