'use strict';

// OpenAPI 3.1 -> 3.0.3 conversion. jerant builds 3.1-flavoured JSON Schema
// internally (type arrays, const, numeric exclusiveMinimum, examples
// arrays); Swagger UI renders 3.0 documents dramatically faster, so the
// served document defaults to 3.0. Never mutates its input: schema objects
// are shared with jerant's per-route caches.

const DROP_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$comment', '$anchor', '$dynamicRef', '$dynamicAnchor',
  'contentMediaType', 'contentEncoding', 'contentSchema',
  'unevaluatedProperties', 'unevaluatedItems', 'dependentRequired', 'dependentSchemas',
  'if', 'then', 'else', 'patternProperties', 'propertyNames', 'prefixItems', 'contains',
  'minContains', 'maxContains',
]);

const isNullSchema = (s) => s && typeof s === 'object' && s.type === 'null' && Object.keys(s).length === 1;

function convertSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  if (depth > 64) return {};
  if (schema.$ref) return { $ref: schema.$ref }; // 3.0: siblings of $ref are ignored

  const out = {};
  let nullable = false;
  for (const [key, value] of Object.entries(schema)) {
    if (DROP_KEYWORDS.has(key)) continue;
    switch (key) {
      case 'type': {
        if (Array.isArray(value)) {
          const types = value.filter((t) => t !== 'null');
          if (types.length !== value.length) nullable = true;
          if (types.length === 1) out.type = types[0];
          else if (types.length > 1) out.anyOf = types.map((t) => ({ type: t }));
        } else if (value === 'null') {
          nullable = true;
        } else {
          out.type = value;
        }
        break;
      }
      case 'const':
        out.enum = [value];
        break;
      case 'examples':
        if (Array.isArray(value) && value.length && out.example === undefined) out.example = value[0];
        break;
      case 'exclusiveMinimum':
      case 'exclusiveMaximum':
        if (typeof value === 'number') {
          out[key === 'exclusiveMinimum' ? 'minimum' : 'maximum'] = value;
          out[key] = true;
        } else {
          out[key] = value;
        }
        break;
      case 'properties': {
        const props = {};
        for (const [name, child] of Object.entries(value || {})) props[name] = convertSchema(child, depth + 1);
        out.properties = props;
        break;
      }
      case 'items':
        out.items = Array.isArray(value) ? {} : convertSchema(value, depth + 1);
        break;
      case 'additionalProperties':
      case 'not':
        out[key] = typeof value === 'object' ? convertSchema(value, depth + 1) : value;
        break;
      case 'anyOf':
      case 'oneOf':
      case 'allOf': {
        if (!Array.isArray(value)) break;
        let branches = value;
        if (key !== 'allOf' && branches.some(isNullSchema)) {
          nullable = true;
          branches = branches.filter((b) => !isNullSchema(b));
        }
        const converted = branches.map((b) => convertSchema(b, depth + 1));
        if (key !== 'allOf' && converted.length === 1) {
          const only = converted[0];
          if (only.$ref) out.allOf = [only];
          else Object.assign(out, only);
        } else if (converted.length) {
          out[key] = converted;
        }
        break;
      }
      default:
        out[key] = value;
    }
  }
  if (nullable) {
    if (!out.type && !out.anyOf && !out.oneOf && !out.allOf && !out.enum) out.type = 'string';
    out.nullable = true;
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  return out;
}

function convertContent(content) {
  if (!content || typeof content !== 'object') return content;
  const out = {};
  for (const [type, media] of Object.entries(content)) {
    out[type] = media && media.schema ? { ...media, schema: convertSchema(media.schema) } : media;
  }
  return out;
}

function convertResponses(responses) {
  if (!responses || typeof responses !== 'object') return responses;
  const out = {};
  for (const [status, response] of Object.entries(responses)) {
    out[status] = response && response.content
      ? { ...response, content: convertContent(response.content) }
      : response;
  }
  return out;
}

function convertParameters(parameters) {
  if (!Array.isArray(parameters)) return parameters;
  return parameters.map((p) => (p && p.schema ? { ...p, schema: convertSchema(p.schema) } : p));
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Convert a jerant-built OpenAPI 3.1 document into OpenAPI 3.0.3. */
function toOpenApi30(spec) {
  const out = { ...spec, openapi: '3.0.3' };
  const paths = {};
  for (const [p, item] of Object.entries(spec.paths || {})) {
    const nextItem = { ...item };
    if (item.parameters) nextItem.parameters = convertParameters(item.parameters);
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const nextOp = { ...op };
      if (op.parameters) nextOp.parameters = convertParameters(op.parameters);
      if (op.requestBody && op.requestBody.content) {
        nextOp.requestBody = { ...op.requestBody, content: convertContent(op.requestBody.content) };
      }
      if (op.responses) nextOp.responses = convertResponses(op.responses);
      nextItem[method] = nextOp;
    }
    paths[p] = nextItem;
  }
  out.paths = paths;
  if (spec.components) {
    const components = { ...spec.components };
    if (components.schemas) {
      components.schemas = {};
      for (const [name, schema] of Object.entries(spec.components.schemas)) {
        components.schemas[name] = convertSchema(schema);
      }
    }
    if (components.responses) components.responses = convertResponses(components.responses);
    out.components = components;
  }
  delete out.webhooks;
  delete out.jsonSchemaDialect;
  return out;
}

module.exports = { toOpenApi30, convertSchema };
