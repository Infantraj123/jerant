'use strict';

// express-validator adapter. Unlike the schema-object adapters, this one
// inspects a route's middleware stack for validation chains (the functions
// returned by body()/query()/param()) and reconstructs per-location schemas
// from each chain's builder context. Everything is best-effort and wrapped
// in try/catch because the builder API is semi-internal.

const VALIDATOR_TYPE_MAP = {
  isEmail: { type: 'string', format: 'email' },
  isUUID: { type: 'string', format: 'uuid' },
  isURL: { type: 'string', format: 'uri' },
  isISO8601: { type: 'string', format: 'date-time' },
  isDate: { type: 'string', format: 'date' },
  isJWT: { type: 'string' },
  isInt: { type: 'integer' },
  isFloat: { type: 'number' },
  isNumeric: { type: 'number' },
  isDecimal: { type: 'number' },
  isBoolean: { type: 'boolean' },
  isArray: { type: 'array' },
  isObject: { type: 'object' },
  isString: { type: 'string' },
  isAlpha: { type: 'string' },
  isAlphanumeric: { type: 'string' },
  isMobilePhone: { type: 'string' },
  isPostalCode: { type: 'string' },
  isCreditCard: { type: 'string' },
  isIP: { type: 'string' },
};

const LOCATIONS = ['body', 'query', 'params'];

function isChain(handle) {
  return (
    typeof handle === 'function' &&
    handle.builder &&
    typeof handle.builder.build === 'function'
  );
}

function fieldSchemaFromContext(ctx) {
  const schema = { type: 'string' }; // express-validator fields are strings by default
  for (const item of ctx.stack || []) {
    const name = item.validator && item.validator.name;
    if (!name) continue;
    const mapped = VALIDATOR_TYPE_MAP[name];
    if (mapped) Object.assign(schema, mapped);
    if (name === 'isLength' && item.options && item.options[0]) {
      const { min, max } = item.options[0];
      if (typeof min === 'number') schema.minLength = min;
      if (typeof max === 'number') schema.maxLength = max;
    }
    if (name === 'isIn' && item.options && Array.isArray(item.options[0])) {
      schema.enum = item.options[0];
    }
  }
  return schema;
}

/**
 * Extract {body, query, params} JSON Schemas from a route's middleware
 * handles. Returns null when no express-validator chains are present.
 */
function extractFromHandles(handles) {
  const chains = (handles || []).filter(isChain);
  if (chains.length === 0) return null;

  const byLocation = {};
  for (const chain of chains) {
    let ctx;
    try {
      ctx = chain.builder.build();
    } catch {
      continue;
    }
    if (!ctx || !Array.isArray(ctx.fields)) continue;
    const locations = (ctx.locations && ctx.locations.length ? ctx.locations : ['body'])
      .filter((loc) => LOCATIONS.includes(loc));
    if (!locations.length) continue;

    const fieldSchema = fieldSchemaFromContext(ctx);
    const required = !ctx.optional;

    for (const location of locations) {
      if (!byLocation[location]) {
        byLocation[location] = { type: 'object', properties: {}, required: [] };
      }
      const target = byLocation[location];
      for (const field of ctx.fields) {
        if (typeof field !== 'string' || !field) continue;
        // Dotted paths like "user.name" become nested properties.
        const parts = field.split('.');
        let node = target;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!node.properties[part] || node.properties[part].type !== 'object') {
            node.properties[part] = { type: 'object', properties: {}, required: [] };
          }
          node = node.properties[part];
        }
        const leaf = parts[parts.length - 1];
        node.properties[leaf] = { ...fieldSchema };
        if (required && !node.required.includes(leaf)) node.required.push(leaf);
      }
    }
  }

  for (const schema of Object.values(byLocation)) {
    pruneEmptyRequired(schema);
  }
  return Object.keys(byLocation).length ? byLocation : null;
}

function pruneEmptyRequired(schema) {
  if (!schema || schema.type !== 'object') return;
  if (Array.isArray(schema.required) && schema.required.length === 0) delete schema.required;
  for (const child of Object.values(schema.properties || {})) pruneEmptyRequired(child);
}

module.exports = {
  name: 'express-validator',
  // Chains are middleware, not schema values, so isSchema always defers.
  isSchema: () => false,
  toJsonSchema: () => ({}),
  extractFromHandles,
  isChain,
};
