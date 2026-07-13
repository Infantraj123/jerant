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
  cacheTtlMs: 2000,
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

function resolveOptions(options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options,
    runtime: { ...DEFAULTS.runtime, ...(options.runtime || {}) },
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
  return opts;
}

module.exports = { resolveOptions, DEFAULTS };
