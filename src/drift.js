'use strict';

// Schema-vs-traffic drift detection: when a route has both a declared
// validation schema and enough observed traffic, compare the two and flag
// places where reality stopped matching the declaration. Findings are
// annotations only (x-jerant.drift) — nothing is ever blocked.

const MIN_OBSERVATIONS = 5;

/** Dominant observed type of an inference node ('string', 'object', ...). */
function dominantType(node) {
  let best = null;
  let bestCount = 0;
  for (const [type, count] of Object.entries(node.types || {})) {
    if (type !== 'null' && count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

function schemaTypes(schema) {
  if (!schema) return null;
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) return schema.type;
  if (schema.anyOf || schema.oneOf) {
    const list = [];
    for (const branch of schema.anyOf || schema.oneOf) {
      const t = schemaTypes(branch);
      if (t) list.push(...t);
    }
    return list.length ? list : null;
  }
  if (schema.properties) return ['object'];
  if (schema.items) return ['array'];
  if (schema.enum) return null; // enum types are checked by value, skip
  return null; // untyped ({}), anything goes
}

function typeCompatible(declared, observed) {
  if (!declared) return true;
  if (declared.includes(observed)) return true;
  if (observed === 'integer' && declared.includes('number')) return true;
  return false;
}

/** Compare one declared object schema against one observed node. */
function compareObject(schema, node, location, issues, prefix = '') {
  if (!schema || schema.type !== 'object' || !schema.properties) return;
  if (!node || !node.count || dominantType(node) !== 'object') return;
  const objectCount = (node.types && node.types.object) || 0;
  const props = node.props || {};

  for (const [name, childSchema] of Object.entries(schema.properties)) {
    const childNode = props[name];
    const fieldPath = prefix ? `${prefix}.${name}` : name;
    const required = Array.isArray(schema.required) && schema.required.includes(name);
    if (!childNode || !childNode.count) {
      if (required && objectCount >= MIN_OBSERVATIONS) {
        issues.push({
          location,
          field: fieldPath,
          issue: 'required-field-never-observed',
          detail: `declared required but absent from all ${objectCount} observed payloads`,
        });
      }
      continue;
    }
    const observed = dominantType(childNode);
    const declared = schemaTypes(childSchema);
    if (observed && !typeCompatible(declared, observed)) {
      issues.push({
        location,
        field: fieldPath,
        issue: 'type-mismatch',
        detail: `declared ${declared.join('|')}, observed ${observed}`,
      });
    } else if (observed === 'object' && childSchema.type === 'object') {
      compareObject(childSchema, childNode, location, issues, fieldPath);
    }
  }

  if (schema.additionalProperties === false) {
    for (const name of Object.keys(props)) {
      if (!schema.properties[name] && props[name].count > 0) {
        issues.push({
          location,
          field: prefix ? `${prefix}.${name}` : name,
          issue: 'undeclared-field',
          detail: 'observed in traffic but the schema forbids extra fields',
        });
      }
    }
  }
}

/**
 * Drift issues for one route. `validation` is detectValidation()'s result;
 * `runtime` is the registry entry. Returns [] when nothing drifted.
 */
function detectRouteDrift(validation, runtime) {
  const issues = [];
  if (!validation || !runtime || runtime.observations < MIN_OBSERVATIONS) return issues;

  for (const location of ['body', 'query', 'params']) {
    const declared = validation.schemas[location];
    const node = runtime[location];
    if (declared && node && node.count) {
      compareObject(declared.schema, node, location, issues);
    }
  }
  if (validation.responses) {
    for (const [status, declared] of Object.entries(validation.responses)) {
      const node = runtime.responses && runtime.responses[status];
      if (node && node.count) {
        compareObject(declared.schema, node, `response:${status}`, issues);
      }
    }
  }
  return issues.slice(0, 20);
}

module.exports = { detectRouteDrift, dominantType };
