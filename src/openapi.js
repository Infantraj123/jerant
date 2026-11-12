'use strict';

// OpenAPI generator (3.1 internally, downgraded to 3.0 by default): joins scanned routes, detected validation schemas,
// and runtime-inferred schemas into a single document, picking the highest
// quality source per location and annotating every operation with its
// source and confidence.

const fs = require('fs');
const path = require('path');
const { detectSchema, expressValidator } = require('./adapters');
const { analyzeHandles } = require('./static-analysis');
const { loadSourceIndex, scanRouteSource } = require('./source-scan');
const { nodeToJsonSchema, stabilityScore } = require('./inference');
const {
  sourceConfidence,
  runtimeConfidence,
  sourceLabel,
  ROUTE_SCAN_CONFIDENCE,
} = require('./confidence');
const { jsonClone, pascalCase, isPlainObject } = require('./util');
const {
  resolveSecurity,
  normalizeRequirement,
  detectRouteSecurity,
  requirementForDetected,
} = require('./security');
const { resolveEnvelope, applyEnvelope, envelopeAppliesTo, resolveDefaultResponses } = require('./envelope');
const { detectRouteDrift } = require('./drift');
const { loadPrismaSchema, modelBodySchema } = require('./prisma');
const { toOpenApi30 } = require('./downgrade');

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

// Middleware function names that mark a route as consuming multipart/form-data.
const MULTIPART_MIDDLEWARE_NAMES = new Set(['multerMiddleware', 'fileupload', 'busboy']);

function detectMultipartMiddleware(handles) {
  return (handles || []).some(
    (h) => typeof h === 'function' && MULTIPART_MIDDLEWARE_NAMES.has(h.name)
  );
}

function dominantContentType(runtime) {
  const counts = (runtime && runtime.contentTypes) || {};
  let best = null;
  let bestCount = 0;
  for (const [type, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

function toOpenApiPath(expressPath) {
  let out = expressPath
    .replace(/:([A-Za-z0-9_]+)\([^)]*\)/g, '{$1}') // :id(\d+) -> {id}
    .replace(/:([A-Za-z0-9_]+)\??/g, '{$1}');      // :id / :id? -> {id}
  if (!out.startsWith('/')) out = '/' + out;
  return out;
}

function pathParamNames(oaPath) {
  const names = [];
  const re = /\{([^}]+)\}/g;
  let match;
  while ((match = re.exec(oaPath))) names.push(match[1]);
  return names;
}

/**
 * Inspect a route's middleware handles for validation metadata:
 * our validate()/doc() markers, schemas attached as handle.schema/_schema,
 * and express-validator chains.
 */
function detectValidation(handles) {
  const result = { schemas: {}, responses: null, meta: {} };

  for (const handle of handles || []) {
    if (!handle) continue;
    const marker = handle.__jerant;
    if (marker) {
      for (const location of ['body', 'query', 'params']) {
        const raw = marker.schemas && marker.schemas[location];
        if (raw === undefined || raw === null || result.schemas[location]) continue;
        const detected = detectSchema(raw);
        if (detected) result.schemas[location] = detected;
      }
      if (marker.responses && !result.responses) {
        result.responses = {};
        for (const [status, raw] of Object.entries(marker.responses)) {
          const detected = detectSchema(raw);
          if (detected) result.responses[status] = detected;
        }
      }
      for (const field of ['summary', 'description', 'tags', 'deprecated', 'contentType', 'files', 'security']) {
        if (marker[field] !== undefined && result.meta[field] === undefined) {
          result.meta[field] = marker[field];
        }
      }
      continue;
    }

    // Conventions used by various validation middlewares: the schema (or a
    // {body, query, params} bundle) hangs off the middleware function.
    const attached = handle.schema || handle._schema;
    if (attached) {
      const direct = detectSchema(attached);
      if (direct && !result.schemas.body) {
        result.schemas.body = direct;
      } else if (isPlainObject(attached)) {
        for (const location of ['body', 'query', 'params']) {
          if (attached[location] && !result.schemas[location]) {
            const detected = detectSchema(attached[location]);
            if (detected) result.schemas[location] = detected;
          }
        }
      }
    }
  }

  // express-validator chains (each chain is its own middleware handle).
  try {
    const extracted = expressValidator.extractFromHandles(handles);
    if (extracted) {
      for (const location of ['body', 'query', 'params']) {
        if (extracted[location] && !result.schemas[location]) {
          result.schemas[location] = { source: 'express-validator', schema: extracted[location] };
        }
      }
    }
  } catch { /* best-effort */ }

  return result;
}

function componentName(method, oaPath, suffix) {
  const segments = oaPath
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      const param = seg.match(/^\{(.+)\}$/);
      return param ? 'By' + pascalCase(param[1]) : pascalCase(seg);
    });
  return pascalCase(method.toLowerCase()) + (segments.join('') || 'Root') + suffix;
}

function registerComponent(components, name, schema) {
  const serialized = JSON.stringify(schema);
  let candidate = name;
  let counter = 2;
  while (components.schemas[candidate] !== undefined) {
    if (JSON.stringify(components.schemas[candidate]) === serialized) {
      return { $ref: `#/components/schemas/${candidate}` };
    }
    candidate = `${name}${counter++}`;
  }
  components.schemas[candidate] = schema;
  return { $ref: `#/components/schemas/${candidate}` };
}

function maybeHoist(components, name, schema) {
  if (
    schema &&
    schema.type === 'object' &&
    isPlainObject(schema.properties) &&
    Object.keys(schema.properties).length > 0
  ) {
    return registerComponent(components, name, schema);
  }
  return schema;
}

function mediaType(schema, examples) {
  const media = { schema };
  if (examples && examples.length) {
    if (examples.length === 1) {
      media.example = examples[0];
    } else {
      media.examples = {};
      examples.forEach((ex, i) => {
        media.examples[`example${i + 1}`] = { value: ex };
      });
    }
  }
  return media;
}

/**
 * Type-name example generated from a schema: every leaf value is its format
 * or type name — {email: 'email', password: 'string', age: 'number'}.
 */
function placeholderExample(schema, depth = 0) {
  if (depth > 6 || !schema || typeof schema !== 'object') return 'string';
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const branches = schema.anyOf || schema.oneOf || schema.allOf;
  if (Array.isArray(branches) && branches.length) {
    return placeholderExample(branches[0], depth + 1);
  }
  let type = schema.type;
  if (Array.isArray(type)) type = type.find((t) => t !== 'null') || 'null';
  if (!type) {
    if (schema.properties) type = 'object';
    else if (schema.items) type = 'array';
  }
  switch (type) {
    case 'object': {
      const out = {};
      for (const [key, child] of Object.entries(schema.properties || {})) {
        out[key] = placeholderExample(child, depth + 1);
      }
      return out;
    }
    case 'array':
      return [placeholderExample(schema.items || {}, depth + 1)];
    case 'integer': return 'number';
    case 'number': return 'float';
    case 'boolean': return 'boolean';
    case 'null': return null;
    default:
      return schema.format ? String(schema.format) : 'string';
  }
}

/**
 * Media object for one content type, honoring opts.examples:
 * 'placeholder' (default) shows type-name values, 'captured' shows real
 * (redacted) traffic payloads, false emits no example at all.
 */
function buildMedia(opts, schema, hoisted, captured) {
  if (opts.examples === 'captured') return mediaType(hoisted, captured);
  const media = { schema: hoisted };
  if (opts.examples !== false) media.example = placeholderExample(schema);
  return media;
}

let projectInfoCache = null;
function defaultProjectInfo() {
  const file = path.join(process.cwd(), 'package.json');
  if (projectInfoCache && projectInfoCache.file === file) return projectInfoCache.info;
  let info = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    info = { title: pkg.name, version: pkg.version, description: pkg.description };
  } catch { /* no package.json */ }
  projectInfoCache = { file, info };
  return info;
}

function sameHandles(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Route analysis that only depends on the handler functions (validation
 * schema detection, handler-source mining). It is by far the most expensive
 * part of a build, so it is cached per route across rebuilds and recomputed
 * only when the route's handler list changes.
 */
function routeAnalysis(route, sourceIndex, routeCache) {
  const cached = routeCache && routeCache.get(route.key);
  if (cached && sameHandles(cached.handles, route.handles) && cached.sourceIndex === sourceIndex) {
    return cached;
  }
  const entry = {
    handles: route.handles,
    sourceIndex,
    validation: detectValidation(route.handles),
    // Deepest fallback: mine the handler source for fields the code actually
    // reads (req.body.x, req.query.x, req.files.doc, res.status codes), both
    // from the live function objects and from the project's source files.
    statics: mergeScanFindings(
      analyzeHandles(route.handles),
      scanRouteSource(sourceIndex, route.method, route.path)
    ),
  };
  if (routeCache) routeCache.set(route.key, entry);
  return entry;
}

/** Fold project-source findings into the per-function analysis result. */
function mergeScanFindings(statics, scan) {
  if (!scan) return statics;
  const union = (a, b) => [...new Set([...a, ...b])];
  const merged = {
    bodyFields: union(statics.bodyFields, scan.bodyFields),
    queryFields: union(statics.queryFields, scan.queryFields),
    paramsFields: union(statics.paramsFields, scan.paramsFields),
    fileFields: union(statics.fileFields, scan.fileFields),
    usesFiles: statics.usesFiles || scan.usesFiles || scan.multipart,
    genericFile: statics.genericFile,
    statusCodes: union(statics.statusCodes, scan.statusCodes),
    prismaModels: union(statics.prismaModels || [], scan.prismaModels || []),
  };
  // Upload config in source names the real fields — drop the req.file guess.
  if (scan.fileFields.length && statics.genericFile) {
    merged.fileFields = merged.fileFields.filter((f) => f !== 'file' || scan.fileFields.includes('file'));
    merged.genericFile = false;
  }
  return merged;
}

function uniqueOperationId(base, usedOperationIds) {
  let id = base;
  let counter = 2;
  // '/user-profiles' and '/user/profiles' collapse to the same PascalCase
  // name; a numeric suffix keeps every operationId unique for codegen.
  while (usedOperationIds.has(id)) id = `${base}_${counter++}`;
  usedOperationIds.add(id);
  return id;
}

function buildOperation({ route, runtime, components, opts, sourceIndex, usedOperationIds, ctx }) {
  const oaPath = toOpenApiPath(route.path);
  const method = route.method.toLowerCase();
  const { validation, statics: cachedStatics } = routeAnalysis(route, sourceIndex, ctx.routeCache);
  // Shallow copies: per-build edits must never leak into the route cache.
  const statics = { ...cachedStatics };
  const op = {};
  const sources = {};

  if (validation.meta.summary) op.summary = validation.meta.summary;
  if (validation.meta.deprecated) op.deprecated = true;
  op.operationId = uniqueOperationId(
    componentName(route.method, oaPath, '').replace(/^(\w)/, (c) => c.toLowerCase()),
    usedOperationIds
  );

  // --- Parameters (path + query) ---
  const parameters = [];
  const paramSchemaProps =
    (validation.schemas.params && validation.schemas.params.schema.properties) ||
    (runtime && runtime.params.count ? nodeToJsonSchema(runtime.params).properties : null) ||
    {};
  for (const name of pathParamNames(oaPath)) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: paramSchemaProps[name] || { type: 'string' },
    });
  }
  if (validation.schemas.params) sources.params = validation.schemas.params.source;

  let querySchema = null;
  if (validation.schemas.query) {
    querySchema = validation.schemas.query.schema;
    sources.query = validation.schemas.query.source;
  } else if (runtime && runtime.query.count) {
    querySchema = nodeToJsonSchema(runtime.query);
    sources.query = 'runtime';
    // Code may read query fields no traffic has exercised yet.
    for (const field of statics.queryFields) {
      if (!querySchema.properties[field]) {
        querySchema.properties[field] = {};
        sources.query = 'runtime + code-analysis';
      }
    }
  } else if (statics.queryFields.length) {
    querySchema = {
      type: 'object',
      properties: Object.fromEntries(statics.queryFields.map((f) => [f, {}])),
    };
    sources.query = 'code-analysis';
  }
  if (querySchema && querySchema.type === 'object' && querySchema.properties) {
    const requiredList = querySchema.required || [];
    for (const [name, schema] of Object.entries(querySchema.properties)) {
      parameters.push({
        name,
        in: 'query',
        required: requiredList.includes(name),
        schema,
      });
    }
  }
  if (parameters.length) op.parameters = parameters;

  // --- Request body ---
  let bodySchema = null;
  let bodyRequired = false;
  if (validation.schemas.body) {
    bodySchema = validation.schemas.body.schema;
    bodyRequired = true;
    sources.body = validation.schemas.body.source;
  } else if (runtime && runtime.body.count && !BODYLESS_METHODS.has(route.method)) {
    bodySchema = nodeToJsonSchema(runtime.body);
    sources.body = 'runtime';
    if (bodySchema.type === 'object' && bodySchema.properties) {
      for (const field of statics.bodyFields) {
        if (!bodySchema.properties[field]) {
          bodySchema.properties[field] = {};
          sources.body = 'runtime + code-analysis';
        }
      }
    }
  } else if (statics.bodyFields.length && !BODYLESS_METHODS.has(route.method)) {
    bodySchema = {
      type: 'object',
      properties: Object.fromEntries(statics.bodyFields.map((f) => [f, {}])),
    };
    sources.body = 'code-analysis';
  }
  // Prisma-aware tracing: the handler (or its service layer) writes request
  // data into a prisma model, so schema.prisma names and types the fields.
  if (ctx.prismaSchema && statics.prismaModels && statics.prismaModels.length &&
      !validation.schemas.body && !BODYLESS_METHODS.has(route.method)) {
    const modelSchema = modelBodySchema(ctx.prismaSchema, statics.prismaModels[0]);
    if (modelSchema) {
      if (!bodySchema) {
        bodySchema = modelSchema;
        sources.body = 'prisma';
      } else if (bodySchema.type === 'object' && bodySchema.properties) {
        // Fill in types for untyped fields; add model fields not seen yet.
        for (const [name, fieldSchema] of Object.entries(modelSchema.properties)) {
          const existing = bodySchema.properties[name];
          if (!existing || Object.keys(existing).length === 0) {
            bodySchema.properties[name] = fieldSchema;
          }
        }
        if (!bodySchema.required && modelSchema.required) {
          bodySchema.required = modelSchema.required.filter((f) => bodySchema.properties[f]);
          if (!bodySchema.required.length) delete bodySchema.required;
        }
        if (sources.body && !sources.body.includes('prisma')) {
          sources.body = `${sources.body} + prisma`;
        }
      }
    }
  }
  // Distinguish form-data uploads from raw JSON payloads. Priority:
  // explicit declaration > upload middleware on the route (multer et al)
  // > media type observed in live traffic > JSON.
  const requestContentType =
    validation.meta.contentType ||
    (detectMultipartMiddleware(route.handles) || statics.usesFiles ? 'multipart/form-data' : null) ||
    (runtime && dominantContentType(runtime)) ||
    'application/json';
  const isMultipart = requestContentType === 'multipart/form-data' ||
    requestContentType === 'application/x-www-form-urlencoded';

  if (isMultipart || requestContentType !== 'application/json') {
    // File fields: declared via validate({files: [...]}) or seen at runtime.
    const knownFileFields = [
      ...(Array.isArray(validation.meta.files) ? validation.meta.files : []),
      ...Object.keys((runtime && runtime.fileFields) || {}),
    ];
    // The generic req.file placeholder gives way once a real name is known.
    const staticFileFields = statics.fileFields.filter(
      (f) => !(f === 'file' && statics.genericFile && knownFileFields.length)
    );
    const fileFieldNames = new Set([...knownFileFields, ...staticFileFields]);
    if (requestContentType === 'multipart/form-data' && (fileFieldNames.size || bodySchema || !BODYLESS_METHODS.has(route.method))) {
      const base = bodySchema && bodySchema.type === 'object'
        ? jsonClone(bodySchema)
        : { type: 'object', properties: {} };
      if (!base.properties) base.properties = {};
      for (const name of fileFieldNames) {
        base.properties[name] = { type: 'string', format: 'binary' };
      }
      bodySchema = base;
    }
  }

  if (bodySchema) {
    const hoisted = maybeHoist(components, componentName(route.method, oaPath, 'Request'), bodySchema);
    const examples = !isMultipart && runtime ? runtime.examples.request : [];
    op.requestBody = {
      required: bodyRequired,
      content: { [requestContentType]: buildMedia(opts, bodySchema, hoisted, examples) },
    };
  }

  // --- Responses ---
  const responses = {};
  if (validation.responses) {
    for (const [status, detected] of Object.entries(validation.responses)) {
      // The declared schema describes the data; the envelope (when configured)
      // describes the wrapper every response actually ships in.
      const schema = ctx.envelope && envelopeAppliesTo(ctx.envelope, status)
        ? applyEnvelope(ctx.envelope, detected.schema)
        : detected.schema;
      const hoisted = maybeHoist(
        components,
        componentName(route.method, oaPath, `Response${status}`),
        schema
      );
      responses[status] = {
        description: statusDescription(status),
        content: { 'application/json': buildMedia(opts, schema, hoisted, []) },
      };
      sources[`response:${status}`] = detected.source;
    }
  }
  if (runtime) {
    for (const [status, node] of Object.entries(runtime.responses)) {
      const examples = runtime.examples.response[status] || [];
      if (responses[status]) {
        // Validation schema wins; captured mode lets runtime add real examples.
        if (opts.examples === 'captured') {
          const media = responses[status].content['application/json'];
          if (!media.example && !media.examples && examples.length) {
            Object.assign(media, mediaType(media.schema, examples));
          }
        }
        continue;
      }
      const schema = nodeToJsonSchema(node);
      const hoisted = maybeHoist(components, componentName(route.method, oaPath, `Response${status}`), schema);
      responses[status] = {
        description: statusDescription(status),
        content: { 'application/json': buildMedia(opts, schema, hoisted, examples) },
      };
      if (!sources[`response:${status}`]) sources[`response:${status}`] = 'runtime';
    }
  }
  // Status codes the handler source mentions but nothing else documented.
  const documentedElsewhere = Object.keys(responses).length > 0;
  for (const status of statics.statusCodes) {
    if (!responses[status]) {
      responses[status] = { description: `${statusDescription(status)} (detected in handler code)` };
      sources[`response:${status}`] = 'code-analysis';
    }
  }
  // A handler that only sets error statuses explicitly (res.status(404))
  // still has an implicit 200 success path (res.json / res.send).
  if (!documentedElsewhere && !Object.keys(responses).some((s) => Number(s) < 400)) {
    responses['200'] = { description: 'Successful response' };
  }
  // App-wide default responses (401/500 error shapes etc.) fill statuses
  // nothing route-specific documented. They live once in
  // components.responses; operations only carry a $ref.
  if (ctx.defaultResponses) {
    for (const status of Object.keys(ctx.defaultResponses)) {
      if (!responses[status]) responses[status] = { $ref: `#/components/responses/${defaultResponseName(status)}` };
    }
  }
  op.responses = responses;

  // --- Security ---
  // Route-level validate({security}) wins ([] marks a public route); then
  // auth middleware detected on the route; the app-wide default needs no
  // per-operation entry.
  if (validation.meta.security !== undefined) {
    const requirement = normalizeRequirement(validation.meta.security, ctx.security.schemes);
    if (requirement !== null) op.security = requirement;
  } else if (ctx.security.autoDetect) {
    const detected = detectRouteSecurity(route.handles);
    if (detected) {
      const requirement = requirementForDetected(detected, ctx.security.schemes);
      if (requirement && !ctx.security.defaultRequirement) op.security = requirement;
    }
  }

  // --- Drift (declared schema vs observed traffic) ---
  const drift = opts.driftDetection !== false ? detectRouteDrift(validation, runtime) : [];

  // --- Source + confidence ---
  const INFERRED = new Set(['runtime', 'code-analysis', 'prisma']);
  const isInferred = (s) => s.split(' + ').every((part) => INFERRED.has(part));
  const sourceValues = Object.values(sources);
  const validationSources = sourceValues.filter((s) => !isInferred(s));
  const usedCodeAnalysis = sourceValues.some((s) => s.split(' + ').includes('code-analysis'));
  const usedPrisma = sourceValues.some((s) => s.split(' + ').includes('prisma'));
  const observations = runtime ? runtime.observations : 0;
  let primarySource;
  let confidence;
  if (validationSources.length) {
    const distinct = [...new Set(validationSources)];
    primarySource = distinct.join(' + ');
    confidence = Math.min(...distinct.map(sourceConfidence));
  } else if (observations > 0) {
    primarySource = ['runtime', usedCodeAnalysis && 'code-analysis', usedPrisma && 'prisma']
      .filter(Boolean)
      .join(' + ');
    const stability = Math.min(
      ...['body', 'query', 'params'].map((loc) => (runtime[loc].count ? stabilityScore(runtime[loc]) : 1)),
      ...Object.values(runtime.responses).map((n) => stabilityScore(n))
    );
    confidence = runtimeConfidence(observations, stability);
  } else if (usedPrisma) {
    primarySource = usedCodeAnalysis ? 'code-analysis + prisma' : 'prisma';
    confidence = sourceConfidence('prisma');
  } else if (usedCodeAnalysis || statics.fileFields.length) {
    primarySource = 'code-analysis';
    confidence = sourceConfidence('code-analysis');
  } else {
    primarySource = 'route-scan';
    confidence = ROUTE_SCAN_CONFIDENCE;
  }

  // --- Teach mode: make low-confidence operations exercisable in the UI ---
  // A route jerant knows little about gets an open, free-form JSON body so
  // users can send real payloads from the docs; every request they send is
  // observed by the analyzer and raises the confidence.
  const teachable = opts.teachMode !== false && confidence < 50;
  if (teachable && !op.requestBody && !BODYLESS_METHODS.has(route.method)) {
    op.requestBody = {
      required: false,
      description: 'Schema not learned yet — send a real payload here and the docs will learn it.',
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: true },
          example: {},
        },
      },
    };
  }

  const sourceText = primarySource
    .split(' + ')
    .map(sourceLabel)
    .join(' + ');
  const badge = `**Source:** ${sourceText} · **Confidence:** ${confidence}%` +
    (observations ? ` · **Observed requests:** ${observations}` : '');
  op.description = validation.meta.description
    ? `${validation.meta.description}\n\n${badge}`
    : badge;
  op['x-jerant'] = {
    source: primarySource,
    confidence,
    sources,
    observations,
  };
  if (teachable) op['x-jerant'].learning = true;
  if (drift.length) op['x-jerant'].drift = drift;

  // --- Tags ---
  if (validation.meta.tags && validation.meta.tags.length) {
    op.tags = [...validation.meta.tags];
  } else {
    // Group by the first meaningful segment: '/api/v1/users/...' -> 'users'.
    const segments = route.path.split('/').filter((s) => s && !s.startsWith(':'));
    const generic = (s) => s === 'api' || /^v\d+$/i.test(s);
    const firstSegment = segments.find((s) => !generic(s)) || segments[0];
    op.tags = [firstSegment || 'default'];
  }

  return { oaPath, method, op };
}

function defaultResponseName(status) {
  return `Default${status}`;
}

/** components.responses entries for opts.defaultResponses. */
function buildDefaultResponseComponents(ctx, opts) {
  const out = {};
  for (const [status, config] of Object.entries(ctx.defaultResponses || {})) {
    const entry = { description: config.description || statusDescription(status) };
    if (config.schema) {
      const schema = ctx.envelope && envelopeAppliesTo(ctx.envelope, status)
        ? applyEnvelope(ctx.envelope, config.schema)
        : config.schema;
      entry.content = { 'application/json': buildMedia(opts, schema, schema, []) };
    }
    out[defaultResponseName(status)] = entry;
  }
  return out;
}

function statusDescription(status) {
  const code = Number(status);
  if (code >= 200 && code < 300) return 'Successful response';
  if (code >= 300 && code < 400) return 'Redirect';
  if (code >= 400 && code < 500) return 'Client error';
  if (code >= 500) return 'Server error';
  return 'Response';
}

/**
 * Build the OpenAPI document. `cache` (optional, owned by the caller and
 * reused across builds) holds per-route analysis so rebuilds of large APIs
 * only redo the cheap, traffic-dependent parts.
 */
function buildSpec({ routes, registry, opts, cache }) {
  const projectInfo = defaultProjectInfo();
  const components = { schemas: {} };
  const paths = {};
  const usedOperationIds = new Set();
  let documented = 0;
  let sourceIndex = null;
  try {
    sourceIndex = loadSourceIndex(opts.sourceScan);
  } catch { /* source scanning must never break spec generation */ }

  const ctx = {
    security: resolveSecurity(opts.security),
    envelope: resolveEnvelope(opts.envelope),
    defaultResponses: resolveDefaultResponses(opts.defaultResponses),
    prismaSchema: null,
    routeCache: cache ? (cache.routes || (cache.routes = new Map())) : null,
  };
  try {
    ctx.prismaSchema = loadPrismaSchema(opts.prisma);
  } catch { /* prisma parsing must never break spec generation */ }

  const driftSummary = [];
  for (const route of routes) {
    if (route.internal) continue;
    if (opts.isExcluded && opts.isExcluded(route.method, route.path)) continue;
    const runtime = registry.get(route.key);
    const { oaPath, method, op } = buildOperation({
      route, runtime, components, opts, sourceIndex, usedOperationIds, ctx,
    });
    if (!paths[oaPath]) paths[oaPath] = {};
    paths[oaPath][method] = op;
    documented += 1;
    if (op['x-jerant'].drift) {
      driftSummary.push({ path: oaPath, method: method.toUpperCase(), issues: op['x-jerant'].drift });
    }
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: opts.title || projectInfo.title || 'API Documentation',
      version: opts.version || projectInfo.version || '1.0.0',
    },
    paths,
  };
  const description = opts.description || projectInfo.description;
  if (description) spec.info.description = description;
  if (opts.servers && opts.servers.length) spec.servers = jsonClone(opts.servers);
  if (opts.tags) spec.tags = jsonClone(opts.tags);
  if (Object.keys(ctx.security.schemes).length) {
    components.securitySchemes = ctx.security.schemes;
  }
  if (ctx.security.defaultRequirement && ctx.security.defaultRequirement.length) {
    spec.security = ctx.security.defaultRequirement;
  }
  if (ctx.defaultResponses) components.responses = buildDefaultResponseComponents(ctx, opts);
  if (Object.keys(components.schemas).length || components.securitySchemes || components.responses) {
    spec.components = components;
    if (!Object.keys(components.schemas).length) delete components.schemas;
  }
  spec['x-jerant'] = {
    generator: 'jerant',
    generatedAt: new Date().toISOString(),
    routes: documented,
  };
  if (driftSummary.length) spec['x-jerant'].drift = driftSummary;

  let out = opts.openapi === '3.1' ? spec : toOpenApi30(spec);
  if (typeof opts.transformSpec === 'function') {
    // The hook gets a private deep copy: it may mutate freely without
    // corrupting schema objects cached for the next build.
    const copy = jsonClone(out);
    const result = opts.transformSpec(copy);
    out = result && typeof result === 'object' ? result : copy;
  }
  return out;
}

module.exports = { buildSpec, toOpenApiPath, detectValidation };
