'use strict';

// Route scanner: walks the Express router stack (Express 4 and 5) and
// returns every registered route, including routes on nested routers,
// without requiring any annotations.

const { joinPaths, normalizePath } = require('./util');
const { instrumentMounts } = require('./mounts');

// Mount prefix recorded on route objects during scanning so the runtime
// analyzer can rebuild the exact scan-time key (req.baseUrl contains real
// param values, e.g. /users/42, which would orphan observations).
const ROUTE_PREFIX = Symbol.for('jerant.routePrefix');

function getRootStack(app) {
  if (app._router && Array.isArray(app._router.stack)) return app._router.stack;
  if (typeof app.lazyrouter === 'function') {
    try { app.lazyrouter(); } catch { /* not an Express 4 app */ }
    if (app._router && Array.isArray(app._router.stack)) return app._router.stack;
  }
  try {
    // Express 5 exposes a lazily-created router here; Express 4 throws.
    const router = app.router;
    if (router && Array.isArray(router.stack)) return router.stack;
  } catch { /* Express 4 deprecation throw */ }
  if (Array.isArray(app.stack)) return app.stack; // a bare Router was passed
  return [];
}

/**
 * Reconstruct the mount path of a router layer from its regexp + keys.
 * Handles the patterns emitted by path-to-regexp for both Express 4 and 5.
 * Returns null when the pattern is too exotic to reverse.
 */
function layerMountPath(layer) {
  const regexp = layer.regexp;
  if (!regexp) return '';
  if (regexp.fast_slash || regexp.source === '^\\/?$' || regexp.source === '^\\/?(?=\\/|$)') return '';

  let src = regexp.source;
  let keyIndex = 0;
  const keys = layer.keys || [];

  src = src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '') // express 4 mount suffix: \/?(?=\/|$)
    .replace(/\(\?=\\\/\|\$\)$/, '')       // express 5 mount suffix: (?=\/|$)
    .replace(/\(\?:\\\/\)\?$/, '')
    .replace(/\\\/\?$/, '')
    .replace(/\$$/, '');

  // Named/positional parameter capture groups → :name
  src = src.replace(/\(\?:\(\[\^\\?\/]\+\?\)\)|\(\[\^\\?\/]\+\?\)|\(\(\?:\[\^\\?\/]\+\?\)\)/g, () => {
    const key = keys[keyIndex++];
    return ':' + (key && key.name !== undefined ? key.name : `param${keyIndex}`);
  });

  src = src.replace(/\\\//g, '/');

  // If regex artifacts remain we cannot reliably reverse the mount path.
  if (/[\^$()[\]?+*{}|\\]/.test(src)) return null;
  return src;
}

/**
 * Best-effort mount path for regex mounts that cannot be reversed exactly
 * (app.use(/^\/v[12]/, router)). The raw pattern is kept in the path so the
 * routes still appear in the docs instead of silently vanishing.
 */
function fallbackMountPath(layer) {
  const regexp = layer.regexp;
  if (!regexp || !regexp.source) return '';
  const src = regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?:\\\/\)\?$/, '')
    .replace(/\\\/\?$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');
  return src;
}

function routePaths(route) {
  return Array.isArray(route.path) ? route.path : [route.path];
}

// Methods an OpenAPI path item can express (TRACE excluded as noise).
const OPENAPI_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function routeMethods(route) {
  const methods = Object.keys(route.methods || {}).filter((m) => route.methods[m]);
  // router.all() marks the route '_all'; app.all() on Express 4 registers
  // every Node HTTP method (ACL, PROPFIND, ...) individually. Either way,
  // document the full OpenAPI-expressible set and nothing more.
  if (methods.includes('_all')) return [...OPENAPI_METHODS];
  return methods.filter((m) => OPENAPI_METHODS.includes(m));
}

/**
 * Scan an Express app (or Router) and return
 * [{method, path, handles, internal}] for every registered route.
 */
function scanRoutes(app) {
  const out = [];
  const seen = new Set();

  function walk(stack, prefix, depth) {
    if (!Array.isArray(stack) || depth > 16) return;
    for (const layer of stack) {
      if (layer.route) {
        const handles = (layer.route.stack || []).map((l) => l.handle).filter(Boolean);
        const internal = handles.some((h) => h && h.__jerantInternal);
        if (layer.route[ROUTE_PREFIX] === undefined) layer.route[ROUTE_PREFIX] = prefix;
        for (const path of routePaths(layer.route)) {
          if (typeof path !== 'string') continue;
          const fullPath = joinPaths(prefix, path);
          for (const method of routeMethods(layer.route)) {
            const key = `${method.toUpperCase()} ${fullPath}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              method: method.toUpperCase(),
              path: fullPath,
              key,
              handles,
              internal,
            });
          }
        }
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        // Prefer the mount path recorded at .use() time (required on
        // Express 5); fall back to regexp reconstruction (Express 4).
        const recorded = layer.__jerantMount;
        const mounts = recorded !== undefined
          ? (Array.isArray(recorded) ? recorded : [recorded])
          : [layerMountPath(layer)];
        for (const mount of mounts) {
          const resolved = mount === null ? fallbackMountPath(layer) : mount;
          walk(layer.handle.stack, joinPaths(prefix, resolved), depth + 1);
        }
        instrumentMounts(layer.handle); // future mounts on this router get recorded
      }
    }
  }

  walk(getRootStack(app), '', 0);
  return out;
}

function routeKey(method, path) {
  return `${String(method).toUpperCase()} ${normalizePath(path)}`;
}

module.exports = { scanRoutes, getRootStack, routeKey, layerMountPath, ROUTE_PREFIX };
