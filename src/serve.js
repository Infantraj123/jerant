'use strict';

// Framework-neutral serving of everything jerant puts on the wire: the
// OpenAPI document, the docs page, the theme stylesheet and self-hosted UI
// assets. Each adapter (Express, Fastify, Koa, Hono) translates its request
// into {method, path, headers, query} and writes back {status, headers, body}.
//
// Large-API guarantees:
//   - the spec is rebuilt in the background (stale-while-revalidate): a
//     request never waits for a rebuild, except the very first one;
//   - rebuilds happen only when routes or learned data actually changed,
//     at most once per cacheTtlMs;
//   - every payload is serialized once, carries a strong ETag (304s for
//     unchanged content) and is gzip/brotli-compressed off the event loop.

const crypto = require('crypto');
const zlib = require('zlib');
const { renderDocsPage, THEME_CSS } = require('./docs-ui');
const { createAssetsService } = require('./assets');

const BROTLI_OPTS = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } };
const MIN_COMPRESS_BYTES = 1024;

function hash(buf) {
  return crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 27);
}

/**
 * One immutable payload: body bytes + ETag, with compressed variants
 * produced lazily on the libuv threadpool and memoized.
 */
class Resource {
  constructor(body, contentType, cacheControl) {
    this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    this.contentType = contentType;
    this.cacheControl = cacheControl;
    this.etag = `"${hash(this.body)}"`;
    this.variants = new Map(); // encoding -> Promise<Buffer|null>
  }

  encoded(encoding) {
    if (encoding === 'identity' || this.body.length < MIN_COMPRESS_BYTES) return Promise.resolve(null);
    let pending = this.variants.get(encoding);
    if (!pending) {
      pending = new Promise((resolve) => {
        const done = (err, out) => resolve(err ? null : out);
        if (encoding === 'br') zlib.brotliCompress(this.body, BROTLI_OPTS, done);
        else zlib.gzip(this.body, { level: 6 }, done);
      });
      this.variants.set(encoding, pending);
    }
    return pending;
  }
}

function header(headers, name) {
  if (!headers) return '';
  const v = typeof headers.get === 'function' ? headers.get(name) : headers[name];
  return Array.isArray(v) ? v.join(',') : String(v || '');
}

function negotiate(acceptEncoding) {
  const accept = String(acceptEncoding || '').toLowerCase();
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return 'identity';
}

function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some((t) => {
    const tag = t.trim().replace(/^W\//, '');
    return tag === etag || tag === '*';
  });
}

/** Turn a Resource into a {status, headers, body} response for this request. */
async function respond(resource, headers, method = 'GET') {
  const base = {
    'Content-Type': resource.contentType,
    'Cache-Control': resource.cacheControl,
    ETag: resource.etag,
    Vary: 'Accept-Encoding',
  };
  if (etagMatches(header(headers, 'if-none-match'), resource.etag)) {
    return { status: 304, headers: base, body: Buffer.alloc(0) };
  }
  const encoding = negotiate(header(headers, 'accept-encoding'));
  const compressed = await resource.encoded(encoding);
  const body = compressed || resource.body;
  const out = { ...base, 'Content-Length': String(body.length) };
  if (compressed) out['Content-Encoding'] = encoding;
  return { status: 200, headers: out, body: method === 'HEAD' ? Buffer.alloc(0) : body };
}

// --- Auth -------------------------------------------------------------------

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createAuthCheck(auth) {
  if (!auth) return null;
  if (typeof auth === 'function') {
    return async (nativeReq) => {
      try { return (await auth(nativeReq)) === true; } catch { return false; }
    };
  }
  const realm = String(auth.realm || 'API Docs').replace(/"/g, '');
  const check = async (nativeReq, headers) => {
    const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header(headers, 'authorization'));
    if (!m) return false;
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i === -1) return false;
    // Evaluate both comparisons: no short-circuit timing signal.
    const userOk = safeEqual(decoded.slice(0, i), auth.username);
    const passOk = safeEqual(decoded.slice(i + 1), auth.password);
    return userOk && passOk;
  };
  check.challenge = `Basic realm="${realm}", charset="UTF-8"`;
  return check;
}

// --- Spec service -----------------------------------------------------------

/**
 * Owns the spec cache. `build()` returns a fresh spec object; `inputsKey()`
 * cheaply fingerprints the inputs (route count + registry version) so
 * unchanged apps never rebuild.
 */
function createSpecService({ opts, build, inputsKey }) {
  let current = null; // {spec, key, builtAt, resource, hash}
  let rebuildScheduled = false;
  let lastError = null;

  function rebuild() {
    const key = inputsKey();
    const spec = build();
    const meta = spec && spec['x-jerant'];
    let body;
    let contentHash;
    if (current && meta && typeof meta === 'object') {
      // Compare content without the timestamp so identical rebuilds keep
      // the old ETag (and clients keep their 304s).
      const generatedAt = meta.generatedAt;
      meta.generatedAt = current.spec['x-jerant'] && current.spec['x-jerant'].generatedAt;
      body = JSON.stringify(spec);
      contentHash = hash(body);
      if (contentHash === current.hash) {
        current = { ...current, key, builtAt: Date.now() };
        return current;
      }
      meta.generatedAt = generatedAt;
      body = JSON.stringify(spec);
    } else {
      body = JSON.stringify(spec);
      contentHash = hash(body);
    }
    current = {
      spec,
      key,
      builtAt: Date.now(),
      hash: contentHash,
      resource: new Resource(body, 'application/json; charset=utf-8', 'no-cache'),
    };
    lastError = null;
    return current;
  }

  function isStale() {
    return !current || (Date.now() - current.builtAt >= opts.cacheTtlMs && inputsKey() !== current.key);
  }

  function scheduleRebuild() {
    if (rebuildScheduled) return;
    rebuildScheduled = true;
    const timer = setImmediate(() => {
      rebuildScheduled = false;
      try {
        rebuild();
      } catch (err) {
        lastError = err;
        if (current) current = { ...current, builtAt: Date.now() }; // back off
        warn(err);
      }
    });
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    /** Synchronous programmatic access (CLI export, tests, getSpec()). */
    getSpec(force = false) {
      if (force || isStale()) rebuild();
      return current.spec;
    },
    /** Serving path: never blocks on a rebuild once a spec exists. */
    getResource() {
      if (!current) rebuild();
      else if (isStale()) scheduleRebuild();
      return current.resource;
    },
    get lastError() { return lastError; },
  };
}

let warned = false;
function warn(err) {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn('[jerant] spec rebuild failed; serving the previous document:', err && err.message);
}

// --- Request router ---------------------------------------------------------

/**
 * Build the handler for jerant's own endpoints. Returns
 * `handle({method, path, headers, query, nativeReq}) -> Promise<response|null>`
 * (null: not ours, fall through to the app) plus the route list adapters
 * register.
 */
function createServer({ opts, specService }) {
  const docsHtml = renderDocsPage(opts);
  const docsResource = docsHtml === null ? null : new Resource(docsHtml, 'text/html; charset=utf-8', 'no-cache');
  const themeResource = new Resource(THEME_CSS, 'text/css; charset=utf-8', 'public, max-age=3600');
  const themePath = `${opts.docsPath === '/' ? '' : opts.docsPath}/theme.css`;
  const assetsPrefix = `${opts.docsPath === '/' ? '' : opts.docsPath}/assets/`;
  const assets = opts.assets === 'local' ? createAssetsService() : null;
  const authCheck = createAuthCheck(opts.auth);

  const routes = [opts.openapiPath, themePath];
  if (docsResource) routes.push(opts.docsPath);
  if (assets) routes.push(`${assetsPrefix}:file`);

  function isInternalPath(path) {
    return path === opts.openapiPath || path === opts.docsPath || path === themePath ||
      (typeof path === 'string' && path.startsWith(assetsPrefix));
  }

  async function handle({ method, path, headers, query, nativeReq }) {
    if (method !== 'GET' && method !== 'HEAD') return null;
    let resolve;
    if (path === opts.openapiPath) {
      resolve = () => specService.getResource();
    } else if (path === opts.docsPath && docsResource) {
      resolve = () => docsResource;
    } else if (path === themePath) {
      resolve = () => themeResource;
    } else if (assets && path.startsWith(assetsPrefix)) {
      resolve = () => assets.get(path.slice(assetsPrefix.length), query && query.v);
    } else {
      return null;
    }

    if (authCheck && !(await authCheck(nativeReq, headers))) {
      const h = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
      if (authCheck.challenge) h['WWW-Authenticate'] = authCheck.challenge;
      return { status: 401, headers: h, body: Buffer.from('Unauthorized') };
    }

    let resource;
    try {
      resource = await resolve();
    } catch (err) {
      return {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        body: Buffer.from(`jerant: ${err && err.message ? err.message : 'internal error'}`),
      };
    }
    if (!resource) {
      return { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: Buffer.from('Not found') };
    }
    if (resource.error) {
      return { status: resource.status || 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: Buffer.from(resource.error) };
    }
    return respond(resource, headers, method);
  }

  return { handle, routes, isInternalPath, themePath, hasDocs: !!docsResource };
}

/** Write a jerant response through Node's ServerResponse (Express et al). */
function writeNode(res, response) {
  res.statusCode = response.status;
  for (const [k, v] of Object.entries(response.headers)) res.setHeader(k, v);
  res.end(response.body);
}

module.exports = { createServer, createSpecService, Resource, respond, writeNode, negotiate };
