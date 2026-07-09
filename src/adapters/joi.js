'use strict';

// Joi adapter: converts the output of schema.describe() (a plain object)
// into JSON Schema, so we never depend on Joi internals.

const MAX_DEPTH = 12;

function isSchema(value) {
  return !!(
    value &&
    typeof value === 'object' &&
    typeof value.describe === 'function' &&
    typeof value.validate === 'function' &&
    (value.$_root || value.isJoi === true) &&
    typeof value.type === 'string'
  );
}

function addNull(schema) {
  const out = { ...schema };
  if (typeof out.type === 'string') out.type = [out.type, 'null'];
  else if (out.anyOf) out.anyOf = [...out.anyOf, { type: 'null' }];
  else return { anyOf: [out, { type: 'null' }] };
  return out;
}

function fromDescription(desc, depth = 0) {
  if (!desc || depth > MAX_DEPTH) return {};
  const flags = desc.flags || {};
  const rules = desc.rules || [];
  const findRule = (name) => rules.find((r) => r.name === name);
  let out;

  switch (desc.type) {
    case 'object': {
      const properties = {};
      const required = [];
      for (const [key, child] of Object.entries(desc.keys || {})) {
        properties[key] = fromDescription(child, depth + 1);
        if (child.flags && child.flags.presence === 'required') required.push(key);
      }
      out = { type: 'object', properties };
      if (required.length) out.required = required;
      break;
    }
    case 'string': {
      out = { type: 'string' };
      if (findRule('email')) out.format = 'email';
      if (findRule('guid') || findRule('uuid')) out.format = 'uuid';
      if (findRule('uri')) out.format = 'uri';
      if (findRule('isoDate')) out.format = 'date-time';
      const min = findRule('min');
      if (min && min.args && typeof min.args.limit === 'number') out.minLength = min.args.limit;
      const max = findRule('max');
      if (max && max.args && typeof max.args.limit === 'number') out.maxLength = max.args.limit;
      const pattern = findRule('pattern');
      if (pattern && pattern.args && pattern.args.regex) {
        const src = String(pattern.args.regex);
        out.pattern = src.startsWith('/') ? src.slice(1, src.lastIndexOf('/')) : src;
      }
      break;
    }
    case 'number': {
      out = { type: rules.some((r) => r.name === 'integer') ? 'integer' : 'number' };
      const min = findRule('min');
      if (min && min.args && typeof min.args.limit === 'number') out.minimum = min.args.limit;
      const max = findRule('max');
      if (max && max.args && typeof max.args.limit === 'number') out.maximum = max.args.limit;
      if (findRule('positive')) out.exclusiveMinimum = 0;
      break;
    }
    case 'boolean': out = { type: 'boolean' }; break;
    case 'date': out = { type: 'string', format: 'date-time' }; break;
    case 'binary': out = { type: 'string', format: 'binary' }; break;
    case 'array': {
      const items = (desc.items || []).map((i) => fromDescription(i, depth + 1));
      out = {
        type: 'array',
        items: items.length === 0 ? {} : items.length === 1 ? items[0] : { anyOf: items },
      };
      const min = findRule('min');
      if (min && min.args && typeof min.args.limit === 'number') out.minItems = min.args.limit;
      const max = findRule('max');
      if (max && max.args && typeof max.args.limit === 'number') out.maxItems = max.args.limit;
      break;
    }
    case 'alternatives':
      out = { anyOf: (desc.matches || []).map((m) => fromDescription(m.schema, depth + 1)) };
      break;
    default:
      out = {};
  }

  const allow = Array.isArray(desc.allow) ? desc.allow : [];
  if (flags.only && allow.length) {
    const values = allow.filter((v) => v !== null && typeof v !== 'object');
    if (values.length) out.enum = values;
  }
  if (allow.includes(null)) out = addNull(out);
  if (flags.description) out.description = flags.description;
  if (flags.default !== undefined && (typeof flags.default !== 'object' || flags.default === null)) {
    out.default = flags.default;
  }
  if (desc.examples && desc.examples.length) out.examples = desc.examples.slice(0, 3);
  return out;
}

function toJsonSchema(schema) {
  return fromDescription(schema.describe());
}

module.exports = { name: 'joi', isSchema, toJsonSchema };
