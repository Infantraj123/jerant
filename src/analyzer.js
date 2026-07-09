'use strict';

// Runtime traffic analyzer. Installed as the first middleware so its
// response wrappers see every JSON response. All schema work happens in
// setImmediate after the response has finished — nothing blocks the
// request path.

const { routeKey } = require('./scanner');

function createAnalyzer(registry, opts, onRecord) {
  const sampleRate = opts.runtime.sampleRate;
  const internalPaths = new Set([opts.docsPath, opts.openapiPath]);

  const analyzer = function jerantAnalyzer(req, res, next) {
    if (sampleRate < 1 && Math.random() > sampleRate) return next();

    let responseBody;
    let captured = false;

    const originalJson = res.json;
    res.json = function json(body) {
      if (!captured) {
        responseBody = body;
        captured = true;
      }
      return originalJson.call(this, body);
    };

    const originalSend = res.send;
    res.send = function send(body) {
      if (!captured) {
        if (typeof body === 'string') {
          const type = String(this.get('Content-Type') || '');
          if (type.includes('json')) {
            try {
              responseBody = JSON.parse(body);
              captured = true;
            } catch { /* not JSON after all */ }
          }
        } else if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
          responseBody = body;
          captured = true;
        }
      }
      return originalSend.call(this, body);
    };

    res.on('finish', () => {
      const route = req.route;
      if (!route) return; // unmatched request (404 etc.)
      const handlerStack = route.stack || [];
      if (handlerStack.some((l) => l.handle && l.handle.__jerantInternal)) return;

      const routePath = Array.isArray(route.path) ? route.path[0] : route.path;
      if (typeof routePath !== 'string') return;
      const fullPath = (req.baseUrl || '') + routePath;
      if (internalPaths.has(fullPath)) return;

      const sample = {
        body: req.body,
        query: req.query,
        params: req.params,
        status: res.statusCode,
        responseBody: captured ? responseBody : undefined,
      };
      const key = routeKey(req.method, fullPath);

      setImmediate(() => {
        try {
          registry.record(key, sample);
          if (onRecord) onRecord();
        } catch { /* analysis must never break the app */ }
      });
    });

    next();
  };

  analyzer.__jerantInternal = true;
  return analyzer;
}

module.exports = { createAnalyzer };
