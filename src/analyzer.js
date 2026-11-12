'use strict';

// Runtime traffic analyzer. Installed as the first middleware so its
// response wrappers see every JSON response. All schema work happens in
// setImmediate after the response has finished — nothing blocks the
// request path.

const { routeKey, ROUTE_PREFIX } = require('./scanner');
const { joinPaths } = require('./util');

// Guards against instrumenting the same response twice (jerant installed on
// both an app and a mounted router, re-entry via next('route'), ...).
const INSTRUMENTED = Symbol.for('jerant.resInstrumented');

function createAnalyzer(core, onFirstRequest) {
  const { opts, server } = core;
  const sampleRate = opts.runtime.sampleRate;
  let firstRequestSeen = false;

  const analyzer = function jerantAnalyzer(req, res, next) {
    if (!firstRequestSeen) {
      firstRequestSeen = true;
      // Trigger an initial route scan off the request path so route objects
      // carry their mount prefix before observations are keyed.
      if (onFirstRequest) setImmediate(() => { try { onFirstRequest(); } catch { /* best-effort */ } });
    }
    if (res[INSTRUMENTED]) return next();
    if (sampleRate < 1 && !(Math.random() < sampleRate)) return next();
    res[INSTRUMENTED] = true;

    let responseBody;
    let captured = false;

    const originalJson = res.json;
    const wrappedJson = function json(body) {
      if (!captured) {
        responseBody = body;
        captured = true;
      }
      restore();
      return originalJson.call(this, body);
    };
    res.json = wrappedJson;

    const originalSend = res.send;
    const wrappedSend = function send(body) {
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
      restore();
      return originalSend.call(this, body);
    };
    res.send = wrappedSend;

    // Put the original methods back once we have what we need. Only our own
    // wrappers are removed — if another library patched on top of them,
    // its patch is left untouched.
    function restore() {
      if (res.json === wrappedJson) res.json = originalJson;
      if (res.send === wrappedSend) res.send = originalSend;
    }

    res.on('finish', () => {
      restore();
      const route = req.route;
      if (!route) return; // unmatched request (404 etc.)
      const handlerStack = route.stack || [];
      if (handlerStack.some((l) => l.handle && l.handle.__jerantInternal)) return;

      const routePath = Array.isArray(route.path) ? route.path[0] : route.path;
      if (typeof routePath !== 'string') return;
      // Prefer the mount prefix recorded at scan time: req.baseUrl contains
      // resolved param values (/users/42), which would never match the
      // scanned pattern key (/users/:id).
      const prefix = route[ROUTE_PREFIX];
      const fullPath = prefix !== undefined
        ? joinPaths(prefix, routePath)
        : (req.baseUrl || '') + routePath;
      if (server.isInternalPath(fullPath)) return;
      const key = routeKey(req.method, fullPath);
      // Excluded, saturated or adaptively-skipped routes cost nothing more.
      if (!core.shouldRecord(key, req.method, fullPath)) return;

      // Media type only (no header values are ever stored) plus multipart
      // file field names populated by upload middleware (multer et al).
      const contentType = String(req.headers['content-type'] || '')
        .split(';')[0].trim().toLowerCase() || undefined;
      const fileFields = [];
      if (req.file && req.file.fieldname) fileFields.push(req.file.fieldname);
      if (req.files) {
        if (Array.isArray(req.files)) {
          for (const f of req.files) if (f && f.fieldname) fileFields.push(f.fieldname);
        } else if (typeof req.files === 'object') {
          fileFields.push(...Object.keys(req.files));
        }
      }

      const sample = {
        body: req.body,
        query: req.query,
        params: req.params,
        status: res.statusCode,
        responseBody: captured ? responseBody : undefined,
        contentType,
        fileFields,
      };
      core.record(key, sample);
    });

    next();
  };

  analyzer.__jerantInternal = true;
  return analyzer;
}

module.exports = { createAnalyzer };
