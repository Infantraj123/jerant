'use strict';

// Express 5 (router@2) layers store mount paths only inside opaque matcher
// closures, so — unlike Express 4 — the mount prefix of a nested router
// cannot be reconstructed from the layer afterwards. Because jerant(app) is
// installed before routes are mounted, we instead record mount paths as
// mounting happens: .use() is wrapped so that router layers get tagged with
// their mount path (layer.__jerantMount). Wrapping the shared
// Router.prototype.use — found by walking the app's own router's prototype
// chain — covers every router created from the same express copy, whatever
// order routers are nested and attached in. Express 4 works without any of
// this (regexp reconstruction), but recorded paths take precedence there too.

function getStack(target) {
  if (Array.isArray(target.stack)) return target.stack; // a Router
  if (target._router && Array.isArray(target._router.stack)) return target._router.stack; // Express 4 app
  try {
    const router = target.router; // Express 5 app (throws on Express 4)
    if (router && Array.isArray(router.stack)) return router.stack;
  } catch { /* Express 4 deprecation throw */ }
  return null;
}

function getAppRouter(app) {
  if (app._router) return app._router;
  if (typeof app.lazyrouter === 'function') {
    try { app.lazyrouter(); } catch { /* not an Express 4 app */ }
    if (app._router) return app._router;
  }
  try {
    return app.router || null;
  } catch {
    return null;
  }
}

function flattenArgs(args) {
  const out = [];
  (function visit(list) {
    for (const item of list) {
      if (Array.isArray(item)) visit(item);
      else out.push(item);
    }
  })(args);
  return out;
}

function recordMounts(target, args) {
  const first = args[0];
  let mountPath = '/';
  if (typeof first === 'string') mountPath = first;
  else if (Array.isArray(first) && typeof first[0] === 'string') mountPath = first;

  const handlers = flattenArgs(args).filter((a) => typeof a === 'function');
  if (!handlers.length) return;
  const stack = getStack(target);
  if (!stack) return;

  // The layers for this .use() call were just pushed; scan a small window
  // from the end so repeated handlers elsewhere in the stack are untouched.
  const windowStart = Math.max(0, stack.length - handlers.length - 4);
  for (let i = stack.length - 1; i >= windowStart; i--) {
    const layer = stack[i];
    if (!layer || !handlers.includes(layer.handle)) continue;
    if (layer.handle && Array.isArray(layer.handle.stack)) {
      if (layer.__jerantMount === undefined) layer.__jerantMount = mountPath;
      instrumentMounts(layer.handle); // fallback wrap for exotic router types
    }
  }
}

function wrapUse(target) {
  const originalUse = target.use;
  target.use = function jerantUse(...args) {
    const result = originalUse.apply(this, args);
    try {
      recordMounts(this, args);
    } catch { /* mount tracking is best-effort */ }
    return result;
  };
}

function markPatched(target) {
  try {
    Object.defineProperty(target, '__jerantMountsPatched', { value: true, enumerable: false });
    return true;
  } catch {
    return false;
  }
}

/** Wrap use() on a single app/router instance. */
function instrumentMounts(target) {
  if (!target || typeof target.use !== 'function' || target.__jerantMountsPatched) return;
  if (!markPatched(target)) return;
  wrapUse(target);
}

/**
 * Wrap use() on the shared router prototype, discovered from the app's own
 * router so it is guaranteed to be the copy the app actually uses. Recording
 * only — the original use() behavior is untouched.
 */
function patchRouterPrototype(app) {
  try {
    const router = getAppRouter(app);
    if (!router) return;
    let proto = Object.getPrototypeOf(router);
    while (
      proto &&
      proto !== Function.prototype &&
      proto !== Object.prototype &&
      !Object.prototype.hasOwnProperty.call(proto, 'use')
    ) {
      proto = Object.getPrototypeOf(proto);
    }
    if (!proto || proto === Function.prototype || proto === Object.prototype) return;
    if (proto.__jerantMountsPatched || typeof proto.use !== 'function') return;
    if (!markPatched(proto)) return;
    wrapUse(proto);
  } catch { /* leave the router untouched */ }
}

module.exports = { instrumentMounts, patchRouterPrototype };
