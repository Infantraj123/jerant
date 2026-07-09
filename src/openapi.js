'use strict';

// OpenAPI 3.1 generator: joins scanned routes, detected validation schemas,
// and runtime-inferred schemas into a single document, picking the highest
// quality source per location and annotating every operation with its
// source and confidence.

const fs = require('fs');
const path = require('path');
const { detectSchema, expressValidator } = require('./adapters');
const { nodeToJsonSchema, stabilityScore } = require('./inference');
const {
  sourceConfidence,
  runtimeConfidence,
  sourceLabel,
  ROUTE_SCAN_CONFIDENCE,
} = require('./confidence');
const { jsonClone, pascalCase, isPlainObject } = require('./util');

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

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
      for (const field of ['summary', 'description', 'tags', 'deprecated']) {
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

function defaultProjectInfo() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    return { title: pkg.name, version: pkg.version, description: pkg.description };
  } catch {
    return {};
  }
}

function buildOperation({ route, runtime, components, opts }) {
  const oaPath = toOpenApiPath(route.path);
  const method = route.method.toLowerCase();
  const validation = detectValidation(route.handles);
  const op = {};
  const sources = {};

  if (validation.meta.summary) op.summary = validation.meta.summary;
  if (validation.meta.deprecated) op.deprecated = true;
  op.operationId = (method + componentName(route.method, oaPath, '')).replace(/^(\w)/, (c) => c.toLowerCase());

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
  }
  if (bodySchema) {
    const hoisted = maybeHoist(components, componentName(route.method, oaPath, 'Request'), bodySchema);
    const examples = runtime ? runtime.examples.request : [];
    op.requestBody = {
      required: bodyRequired,
      content: { 'application/json': mediaType(hoisted, examples) },
    };
  }

  // --- Responses ---
  const responses = {};
  if (validation.responses) {
    for (const [status, detected] of Object.entries(validation.responses)) {
      const hoisted = maybeHoist(
        components,
        componentName(route.method, oaPath, `Response${status}`),
        detected.schema
      );
      responses[status] = {
        description: statusDescription(status),
        content: { 'application/json': mediaType(hoisted) },
      };
      sources[`response:${status}`] = detected.source;
    }
  }
  if (runtime) {
    for (const [status, node] of Object.entries(runtime.responses)) {
      const examples = runtime.examples.response[status] || [];
      if (responses[status]) {
        // Validation schema wins; runtime contributes real examples.
        const media = responses[status].content['application/json'];
        if (!media.example && !media.examples && examples.length) {
          Object.assign(media, mediaType(media.schema, examples));
        }
        continue;
      }
      const schema = nodeToJsonSchema(node);
      const hoisted = maybeHoist(components, componentName(route.method, oaPath, `Response${status}`), schema);
      responses[status] = {
        description: statusDescription(status),
        content: { 'application/json': mediaType(hoisted, examples) },
      };
      if (!sources[`response:${status}`]) sources[`response:${status}`] = 'runtime';
    }
  }
  if (Object.keys(responses).length === 0) {
    responses['200'] = { description: 'Successful response' };
  }
  op.responses = responses;

  // --- Source + confidence ---
  const validationSources = Object.values(sources).filter((s) => s !== 'runtime');
  const observations = runtime ? runtime.observations : 0;
  let primarySource;
  let confidence;
  if (validationSources.length) {
    const distinct = [...new Set(validationSources)];
    primarySource = distinct.join(' + ');
    confidence = Math.min(...distinct.map(sourceConfidence));
  } else if (observations > 0) {
    primarySource = 'runtime';
    const stability = Math.min(
      ...['body', 'query', 'params'].map((loc) => (runtime[loc].count ? stabilityScore(runtime[loc]) : 1)),
      ...Object.values(runtime.responses).map((n) => stabilityScore(n))
    );
    confidence = runtimeConfidence(observations, stability);
  } else {
    primarySource = 'route-scan';
    confidence = ROUTE_SCAN_CONFIDENCE;
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

  // --- Tags ---
  if (validation.meta.tags && validation.meta.tags.length) {
    op.tags = [...validation.meta.tags];
  } else {
    const firstSegment = route.path.split('/').filter((s) => s && !s.startsWith(':'))[0];
    op.tags = [firstSegment || 'default'];
  }

  return { oaPath, method, op };
}

function statusDescription(status) {
  const code = Number(status);
  if (code >= 200 && code < 300) return 'Successful response';
  if (code >= 300 && code < 400) return 'Redirect';
  if (code >= 400 && code < 500) return 'Client error';
  if (code >= 500) return 'Server error';
  return 'Response';
}

function buildSpec({ routes, registry, opts }) {
  const projectInfo = defaultProjectInfo();
  const components = { schemas: {} };
  const paths = {};
  let documented = 0;

  for (const route of routes) {
    if (route.internal) continue;
    const runtime = registry.get(route.key);
    const { oaPath, method, op } = buildOperation({ route, runtime, components, opts });
    if (!paths[oaPath]) paths[oaPath] = {};
    paths[oaPath][method] = op;
    documented += 1;
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
  if (Object.keys(components.schemas).length) spec.components = components;
  spec['x-jerant'] = {
    generator: 'jerant',
    generatedAt: new Date().toISOString(),
    routes: documented,
  };
  return spec;
}

module.exports = { buildSpec, toOpenApiPath, detectValidation };
