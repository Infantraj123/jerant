'use strict';

// Schema inference engine: merges observed JSON payloads into a statistical
// tree ("nodes"), then renders that tree as JSON Schema. Nodes are plain
// JSON-serializable objects so the whole tree can be persisted as-is.

const MAX_DEPTH = 8;
const MAX_ARRAY_SAMPLE = 20;
const MAX_STRING_SAMPLES = 5;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function valueType(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) return 'string';
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  if (t === 'boolean' || t === 'string') return t;
  if (t === 'object') return 'object';
  return 'string';
}

function createNode() {
  return { count: 0, types: {}, props: null, items: null, samples: null };
}

/** Merge one observed value into a node. */
function observe(node, value, depth = 0) {
  node.count += 1;
  const t = valueType(value);
  node.types[t] = (node.types[t] || 0) + 1;
  if (depth > MAX_DEPTH) return;

  if (t === 'object') {
    if (!node.props) node.props = {};
    for (const key of Object.keys(value)) {
      if (!node.props[key]) node.props[key] = createNode();
      observe(node.props[key], value[key], depth + 1);
    }
  } else if (t === 'array') {
    if (!node.items) node.items = createNode();
    for (const item of value.slice(0, MAX_ARRAY_SAMPLE)) {
      observe(node.items, item, depth + 1);
    }
  } else if (t === 'string') {
    if (!node.samples) node.samples = [];
    if (node.samples.length < MAX_STRING_SAMPLES && !node.samples.includes(value)) {
      node.samples.push(value.length > 200 ? value.slice(0, 200) : value);
    }
  }
}

function detectStringFormat(samples) {
  if (!samples || samples.length === 0) return undefined;
  const all = (re) => samples.every((s) => re.test(s));
  if (all(EMAIL_PATTERN)) return 'email';
  if (all(UUID_PATTERN)) return 'uuid';
  if (all(DATE_TIME_PATTERN)) return 'date-time';
  if (all(DATE_PATTERN)) return 'date';
  return undefined;
}

/** Render a node as JSON Schema (OpenAPI 3.1 / JSON Schema 2020-12 subset). */
function nodeToJsonSchema(node) {
  if (!node || !node.count) return {};
  const nullCount = node.types.null || 0;
  const nullable = nullCount > 0;
  let types = Object.keys(node.types).filter((t) => t !== 'null');
  if (types.includes('integer') && types.includes('number')) {
    types = types.filter((t) => t !== 'integer');
  }

  const schemas = types.map((t) => {
    if (t === 'object') {
      const properties = {};
      const required = [];
      const objectCount = node.types.object || 0;
      for (const [key, child] of Object.entries(node.props || {})) {
        properties[key] = nodeToJsonSchema(child);
        // A property is required only when it appeared in every observed object.
        if (child.count >= objectCount) required.push(key);
      }
      const schema = { type: 'object', properties };
      if (required.length) schema.required = required.sort();
      return schema;
    }
    if (t === 'array') {
      return { type: 'array', items: node.items ? nodeToJsonSchema(node.items) : {} };
    }
    if (t === 'string') {
      const schema = { type: 'string' };
      const format = detectStringFormat(node.samples);
      if (format) schema.format = format;
      return schema;
    }
    return { type: t };
  });

  let result;
  if (schemas.length === 0) {
    return nullable ? { type: 'null' } : {};
  }
  if (schemas.length === 1) {
    result = schemas[0];
  } else {
    result = { anyOf: schemas };
  }
  if (nullable) {
    if (typeof result.type === 'string') result.type = [result.type, 'null'];
    else if (result.anyOf) result.anyOf.push({ type: 'null' });
  }
  return result;
}

/**
 * How internally consistent the observations are, 0..1. A node observed as a
 * string sometimes and a number other times scores low; uniform types score 1.
 */
function stabilityScore(node) {
  if (!node || !node.count) return 1;
  const scores = [];
  (function walk(n) {
    if (!n || !n.count) return;
    const max = Math.max(...Object.values(n.types));
    scores.push(max / n.count);
    if (n.props) for (const child of Object.values(n.props)) walk(child);
    if (n.items) walk(n.items);
  })(node);
  if (scores.length === 0) return 1;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

module.exports = {
  createNode,
  observe,
  nodeToJsonSchema,
  stabilityScore,
  valueType,
};
