'use strict';

// Adapter registry. Detection order matters: the AJV adapter's plain-object
// detector is greedy, so every specific adapter must run before it.

const zod = require('./zod');
const joi = require('./joi');
const yup = require('./yup');
const ajv = require('./ajv');
const expressValidator = require('./express-validator');
const classValidator = require('./class-validator');

const SCHEMA_ADAPTERS = [zod, joi, yup, classValidator, ajv];

/**
 * Detect which validation library a raw schema value belongs to and convert
 * it to JSON Schema. Returns {source, schema} or null.
 */
function detectSchema(value) {
  if (value === null || value === undefined) return null;
  for (const adapter of SCHEMA_ADAPTERS) {
    try {
      if (adapter.isSchema(value)) {
        return { source: adapter.name, schema: adapter.toJsonSchema(value) || {} };
      }
    } catch {
      // A broken adapter must never take the host app down.
    }
  }
  return null;
}

module.exports = {
  detectSchema,
  adapters: { zod, joi, yup, ajv, expressValidator, classValidator },
  expressValidator,
};
