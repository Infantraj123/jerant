'use strict';

// Fastify adapter. Call BEFORE registering routes:
//
//   const fastify = require('fastify')();
//   const { jerantFastify } = require('jerant');
//   jerantFastify(fastify);
//
// Routes are collected via the onRoute hook (fastify route schemas become
// first-class documentation), traffic via onSend.

const { createCore, markerFromJsonSchemas, disabledInstance } = require('./core');
const { routeKey } = require('../scanner');

const INSTANCE = Symbol.for('jerant.instance');

function jerantFastify(fastify, options = {}) {
  if (!fastify || typeof fastify.addHook !== 'function' || typeof fastify.get !== 'function') {
    throw new TypeError('jerantFastify(fastify): expected a Fastify instance');
  }
  if (fastify[INSTANCE]) return fastify[INSTANCE];

  const core = createCore(options);
  if (!core.enabled) {
    const disabled = disabledInstance(core.opts);
    fastify[INSTANCE] = disabled;
    return disabled;
  }
  const { opts } = core;
  const internalPaths = new Set([opts.docsPath, opts.openapiPath]);

  const routes = [];
  fastify.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    const path = routeOptions.url;
    if (typeof path !== 'string' || internalPaths.has(path)) return;
    const handles = [];
    if (routeOptions.schema) {
      handles.push(markerFromJsonSchemas({
        body: routeOptions.schema.body,
        query: routeOptions.schema.querystring,
        params: routeOptions.schema.params,
        response: routeOptions.schema.response,
      }));
    }
    for (const h of [].concat(routeOptions.preHandler || [], routeOptions.handler || [])) {
      if (typeof h === 'function') handles.push(h);
    }
    for (const method of methods) {
      if (method === 'HEAD' && methods.length > 1) continue; // implicit GET twin
      routes.push({
        method: method.toUpperCase(),
        path,
        key: routeKey(method, path),
        handles,
        internal: false,
      });
    }
  });

  if (opts.runtime.enabled) {
    fastify.addHook('onSend', (request, reply, payload, done) => {
      try {
        if (core.sampleHit()) {
          const pattern = (request.routeOptions && request.routeOptions.url) || request.routerPath;
          if (typeof pattern === 'string' && !internalPaths.has(pattern)) {
            let responseBody;
            const type = String(reply.getHeader('content-type') || '');
            if (typeof payload === 'string' && type.includes('json')) {
              try { responseBody = JSON.parse(payload); } catch { /* not JSON */ }
            }
            core.record(routeKey(request.method, pattern), {
              body: request.body,
              query: request.query,
              params: request.params,
              status: reply.statusCode,
              responseBody,
              contentType: String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() || undefined,
              fileFields: [],
            });
          }
        }
      } catch { /* analysis must never break the app */ }
      done(null, payload);
    });
  }

  fastify.get(opts.openapiPath, (request, reply) => {
    reply.send(core.getSpec(routes));
  });
  if (core.docsHtml !== null) {
    fastify.get(opts.docsPath, (request, reply) => {
      reply.type('text/html').send(core.docsHtml);
    });
  }

  const instance = {
    enabled: true,
    options: opts,
    registry: core.registry,
    getSpec: (force) => core.getSpec(routes, force),
    refresh: () => core.getSpec(routes, true),
    flush: () => core.storage.flush(() => core.registry.toJSON()),
    close: () => core.storage.close(),
  };
  fastify[INSTANCE] = instance;
  return core.registerInstance(instance);
}

module.exports = { jerantFastify };
