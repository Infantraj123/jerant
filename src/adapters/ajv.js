'use strict';

// AJV adapter: accepts compiled AJV validator functions (which carry the
// source schema on `.schema`) and plain JSON Schema objects.

const { isPlainObject, jsonClone } = require('../util');

const JSON_SCHEMA_HINTS = ['type', 'properties', '$ref', 'anyOf', 'oneOf', 'allOf', 'enum', 'items', 'const'];

function isCompiledValidator(value) {
  return typeof value === 'function' && isPlainObject(value.schema);
}

function looksLikeJsonSchema(value) {
  if (!isPlainObject(value)) return false;
  // Other adapters own their schema objects; this is the fallback detector,
  // so only claim objects with recognizable JSON Schema keywords.
  if (typeof value.safeParse === 'function') return false;
  if (value.__isYupSchema__ || value.$_root || value.isJoi) return false;
  return JSON_SCHEMA_HINTS.some((key) => value[key] !== undefined);
}

function isSchema(value) {
  return isCompiledValidator(value) || looksLikeJsonSchema(value);
}

function stripMetaKeys(schema) {
  if (schema && typeof schema === 'object') {
    delete schema.$schema;
    delete schema.$id;
  }
  return schema;
}

function toJsonSchema(value) {
  const raw = isCompiledValidator(value) ? value.schema : value;
  return stripMetaKeys(jsonClone(raw) || {});
}

module.exports = { name: 'ajv', isSchema, toJsonSchema, isCompiledValidator };
