'use strict';

const { normalizePath } = require('./util');

const DEFAULTS = {
  enabled: true,
  docsPath: '/docs',
  openapiPath: '/openapi.json',
  title: undefined,
  version: undefined,
  description: undefined,
  servers: undefined,
  // Which documentation UI renders at docsPath: 'swagger' | 'redoc' |
  // 'scalar', false to serve only the spec (bring your own UI elsewhere),
  // {html: '...'} for a custom page, or (opts) => html.
  ui: 'swagger',
  cdn: 'https://unpkg.com/swagger-ui-dist@5',
  // 'cdn' loads UI assets from `cdn`; 'local' serves swagger-ui-dist from
  // node_modules under `${docsPath}/assets` (offline / strict-CSP setups).
  assets: 'cdn',
  // Minimum interval between spec rebuilds. Rebuilds run in the background
  // (stale-while-revalidate) and only when routes or learned data changed.
  cacheTtlMs: 5000,
  // OpenAPI version of the served document: '3.0' (default — Swagger UI
  // renders 3.0 specs far faster) or '3.1'.
  openapi: '3.0',
  // 'development' | 'production'. Production turns off the learning
  // features (teach mode, learning chips) and makes traffic recording
  // cheaper. Default: from NODE_ENV.
  mode: undefined,
  // Light/dark docs theme: 'auto' follows the OS and remembers the toggle.
  theme: 'auto',
  // Extra Swagger UI configuration merged over jerant's defaults
  // (JSON-serializable values only: docExpansion, syntaxHighlight, ...).
  swaggerUi: undefined,
  // Routes left out of the docs and the analyzer: strings ('/internal/*',
  // 'GET /health'), RegExps, or a (route) => boolean predicate.
  exclude: undefined,
  // (spec) => spec | void — last-chance hook to edit the document before
  // it is served or exported.
  transformSpec: undefined,
  // Put docs + spec behind auth: {username, password} (HTTP Basic) or a
  // (req) => boolean | Promise<boolean> check on the framework's request.
  auth: undefined,
  // Instrument the router prototype so nested-router mount paths are captured
  // on Express 5 regardless of mount order. Recording only; set false to opt out.
  patchRouter: true,
  redactKeys: [],
  // Authentication modeling. false disables entirely (including auto-detection);
  // 'bearer' | 'apiKey' | 'basic' registers that scheme and requires it globally;
  // an object gives full control: { schemes, default, autoDetect }.
  security: undefined,
  // Response shape for validate() failures: { status, formatter(ctx) }.
  validationError: undefined,
  // Document a response wrapper ({success, message, data}) once and apply it
  // to every declared response schema: { schema, statuses }.
  envelope: undefined,
  // Responses added to every operation that does not already document that
  // status: { '401': { description, schema } }.
  defaultResponses: undefined,
  // Top-level tag metadata: [{name, description}] or {name: description}.
  // Also controls group ordering in the UI.
  tags: undefined,
  // Compare declared schemas against observed traffic and annotate mismatches
  // in x-jerant.drift.
  driftDetection: true,
  // Example payloads in the docs: 'placeholder' shows type-name values
  // ({email: 'email', password: 'string'}), 'captured' shows real (redacted)
  // traffic payloads, false emits no examples.
  examples: 'placeholder',
  // Operations with confidence < 50 open in the docs with an editable
  // free-form request so users can send real payloads; observed requests
  // teach the docs and raise the confidence.
  teachMode: true,
  runtime: {
    enabled: true,
    sampleRate: 1,
    maxExamples: 3,
    maxObservations: 1000,
    maxBodyBytes: 100 * 1024,
    // Once a route has `warmup` observations, record further requests with
    // probability warmup / observations — well-known routes cost ~nothing.
    adaptive: true,
    warmup: 50,
  },
  storage: {
    mode: 'memory', // 'memory' | 'file' | 'custom'
    path: '.jerant/data.json',
    store: undefined, // mode 'custom': an object implementing the Store interface
  },
  // Scan the app's own source files for handler code that Function.toString
  // cannot see (wrapped handlers, multer field names, named controllers).
  sourceScan: {
    enabled: true,
    dir: undefined, // default: directory of the entry script
    maxFiles: 400,
    maxFileBytes: 512 * 1024,
  },
  // Enrich code-analysis body schemas with field types from schema.prisma
  // when handlers pass request data to prisma.<model>.create/update.
  prisma: {
    enabled: true,
    schemaPath: undefined, // default: ./prisma/schema.prisma or ./schema.prisma
  },
};

/** Normalize opts.tags to an ordered [{name, description}] list (or null). */
function normalizeTags(tags) {
  if (!tags) return null;
  if (Array.isArray(tags)) {
    const out = [];
    for (const tag of tags) {
      if (typeof tag === 'string') out.push({ name: tag });
      else if (tag && typeof tag.name === 'string') {
        const entry = { name: tag.name };
        if (tag.description) entry.description = String(tag.description);
        out.push(entry);
      }
    }
    return out.length ? out : null;
  }
  if (typeof tags === 'object') {
    const out = Object.entries(tags).map(([name, description]) => (
      description ? { name, description: String(description) } : { name }
    ));
    return out.length ? out : null;
  }
  return null;
}

// Defaults that change in production mode; explicit options still win.
const PRODUCTION_DEFAULTS = {
  teachMode: false,
  runtime: { sampleRate: 0.1, maxObservations: 200, warmup: 20 },
};

/** Compile opts.exclude into a (method, path) => boolean matcher (or null). */
function compileExclude(exclude) {
  if (!exclude) return null;
  const list = Array.isArray(exclude) ? exclude : [exclude];
  const tests = [];
  for (const rule of list) {
    if (typeof rule === 'function') {
      tests.push((method, path) => { try { return !!rule({ method, path }); } catch { return false; } });
    } else if (rule instanceof RegExp) {
      tests.push((method, path) => { rule.lastIndex = 0; return rule.test(path); });
    } else if (typeof rule === 'string' && rule.trim()) {
      const m = rule.trim().match(/^([A-Za-z]+)\s+(\S+)$/);
      const ruleMethod = m ? m[1].toUpperCase() : null;
      const pattern = normalizePath(m ? m[2] : rule.trim());
      const re = new RegExp('^' + pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      tests.push((method, path) => (!ruleMethod || ruleMethod === method) && re.test(path));
    }
  }
  if (!tests.length) return null;
  return (method, path) => tests.some((t) => t(String(method).toUpperCase(), path));
}

function resolveOptions(options = {}) {
  const mode = options.mode === 'production' || options.mode === 'development'
    ? options.mode
    : (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const prod = mode === 'production';
  const opts = {
    ...DEFAULTS,
    ...(prod ? { teachMode: PRODUCTION_DEFAULTS.teachMode } : {}),
    ...options,
    mode,
    runtime: {
      ...DEFAULTS.runtime,
      ...(prod ? PRODUCTION_DEFAULTS.runtime : {}),
      ...(options.runtime || {}),
    },
    storage: { ...DEFAULTS.storage, ...(options.storage || {}) },
    sourceScan: { ...DEFAULTS.sourceScan, ...(options.sourceScan || {}) },
    prisma: { ...DEFAULTS.prisma, ...(options.prisma || {}) },
  };
  if (process.env.JERANT_DISABLED === '1' || process.env.JERANT_DISABLED === 'true') {
    opts.enabled = false;
  }
  opts.docsPath = normalizePath(opts.docsPath);
  opts.openapiPath = normalizePath(opts.openapiPath);
  const customUi = opts.ui === false ||
    typeof opts.ui === 'function' ||
    (opts.ui && typeof opts.ui === 'object' && typeof opts.ui.html === 'string');
  if (!customUi) {
    opts.ui = ['swagger', 'redoc', 'scalar'].includes(opts.ui) ? opts.ui : 'swagger';
  }
  opts.assets = opts.assets === 'local' ? 'local' : 'cdn';
  opts.tags = normalizeTags(opts.tags);
  if (opts.examples !== 'captured' && opts.examples !== false) opts.examples = 'placeholder';
  opts.runtime.sampleRate = Math.max(0, Math.min(1, Number(opts.runtime.sampleRate) || 0));
  opts.redactKeys = Array.isArray(opts.redactKeys) ? opts.redactKeys : [];
  opts.openapi = String(opts.openapi).startsWith('3.1') ? '3.1' : '3.0';
  opts.theme = ['dark', 'light'].includes(opts.theme) ? opts.theme : 'auto';
  opts.swaggerUi = opts.swaggerUi && typeof opts.swaggerUi === 'object' ? opts.swaggerUi : {};
  opts.isExcluded = compileExclude(opts.exclude);
  opts.cacheTtlMs = Math.max(0, Number(opts.cacheTtlMs) || 0);
  opts.runtime.warmup = Math.max(1, Number(opts.runtime.warmup) || 50);
  if (opts.auth !== undefined && opts.auth !== null && typeof opts.auth !== 'function' &&
      !(typeof opts.auth === 'object' && typeof opts.auth.username === 'string' && typeof opts.auth.password === 'string')) {
    throw new TypeError('jerant: auth must be {username, password} or a (req) => boolean function');
  }
  return opts;
}

module.exports = { resolveOptions, compileExclude, DEFAULTS };
