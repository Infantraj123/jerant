'use strict';

// Response envelope modeling: many APIs wrap every payload in
// {success, message, data}. Declaring that wrapper once lets validate()
// response schemas stay about the data while the docs show the real shape.

const { detectSchema } = require('./adapters');
const { isPlainObject, jsonClone } = require('./util');

const DATA_SLOT = '$data';

// Shorthand property types: {success: 'boolean', data: '$data'}.
const TYPE_NAMES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

/**
 * Normalize the envelope option to
 * { schema: JSONSchema-with-$data-slot, statuses: Set|null }.
 * Returns null when no envelope is configured.
 */
function resolveEnvelope(option) {
  if (!option || typeof option !== 'object') return null;
  let raw = option;
  let statuses = null;
  if (option.schema) {
    raw = option.schema;
    if (Array.isArray(option.statuses)) statuses = new Set(option.statuses.map(String));
  }

  let schema = null;
  const detected = detectSchema(raw);
  if (detected) {
    schema = detected.schema;
  } else if (isPlainObject(raw)) {
    schema = raw.type || raw.properties || raw.anyOf || raw.allOf
      ? jsonClone(raw)
      : shorthandToSchema(raw);
  }
  if (!schema || !hasDataSlot(schema)) return null;
  return { schema, statuses };
}

function shorthandToSchema(shorthand) {
  const properties = {};
  const required = [];
  for (const [key, value] of Object.entries(shorthand)) {
    if (value === DATA_SLOT) {
      properties[key] = DATA_SLOT;
      required.push(key);
    } else if (typeof value === 'string' && TYPE_NAMES.has(value)) {
      properties[key] = { type: value };
      required.push(key);
    } else if (isPlainObject(value)) {
      properties[key] = jsonClone(value);
    }
  }
  return { type: 'object', properties, required };
}

function hasDataSlot(schema) {
  let found = false;
  (function scan(node) {
    if (found || node === null || typeof node !== 'object') {
      if (node === DATA_SLOT) found = true;
      return;
    }
    for (const value of Object.values(node)) {
      if (value === DATA_SLOT || (value && value[DATA_SLOT] === true)) { found = true; return; }
      if (value && typeof value === 'object') scan(value);
    }
  })(schema);
  return found;
}

/** Wrap a data schema in the envelope, filling the $data slot. */
function applyEnvelope(envelope, dataSchema) {
  const wrapped = jsonClone(envelope.schema);
  (function fill(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (value === DATA_SLOT || (isPlainObject(value) && value[DATA_SLOT] === true)) {
        node[key] = jsonClone(dataSchema) || {};
      } else if (value && typeof value === 'object') {
        fill(value);
      }
    }
  })(wrapped);
  return wrapped;
}

function envelopeAppliesTo(envelope, status) {
  if (envelope.statuses) return envelope.statuses.has(String(status));
  const code = Number(status);
  return code >= 200 && code < 300; // default: success responses only
}

/**
 * Normalize opts.defaultResponses to {status: {description, schema|null}}.
 * Values may be {description, schema} or a bare schema (any supported kind).
 */
function resolveDefaultResponses(option) {
  if (!option || typeof option !== 'object') return null;
  const out = {};
  for (const [status, value] of Object.entries(option)) {
    if (!/^\d{3}$/.test(status)) continue;
    let description = null;
    let rawSchema = value;
    if (isPlainObject(value) && ('description' in value || 'schema' in value)) {
      description = value.description ? String(value.description) : null;
      rawSchema = value.schema;
    }
    let schema = null;
    if (rawSchema !== undefined && rawSchema !== null) {
      const detected = detectSchema(rawSchema);
      if (detected) schema = detected.schema;
      else if (isPlainObject(rawSchema)) schema = jsonClone(rawSchema);
    }
    out[status] = { description, schema };
  }
  return Object.keys(out).length ? out : null;
}

module.exports = {
  resolveEnvelope,
  applyEnvelope,
  envelopeAppliesTo,
  resolveDefaultResponses,
  DATA_SLOT,
};
