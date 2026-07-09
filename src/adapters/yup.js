'use strict';

// Yup adapter: converts the output of schema.describe() into JSON Schema.

const MAX_DEPTH = 12;

function isSchema(value) {
  return !!(value && typeof value === 'object' && value.__isYupSchema__ === true);
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
  const tests = desc.tests || [];
  const findTest = (name) => tests.find((t) => t.name === name);
  let out;

  switch (desc.type) {
    case 'object': {
      const properties = {};
      const required = [];
      for (const [key, child] of Object.entries(desc.fields || {})) {
        properties[key] = fromDescription(child, depth + 1);
        if (child.optional === false) required.push(key);
      }
      out = { type: 'object', properties };
      if (required.length) out.required = required;
      break;
    }
    case 'string': {
      out = { type: 'string' };
      if (findTest('email')) out.format = 'email';
      if (findTest('uuid')) out.format = 'uuid';
      if (findTest('url')) out.format = 'uri';
      if (findTest('datetime')) out.format = 'date-time';
      const min = findTest('min');
      if (min && min.params && min.params.min !== undefined) out.minLength = Number(min.params.min);
      const max = findTest('max');
      if (max && max.params && max.params.max !== undefined) out.maxLength = Number(max.params.max);
      const matches = findTest('matches');
      if (matches && matches.params && matches.params.regex) {
        out.pattern = matches.params.regex.source || String(matches.params.regex);
      }
      break;
    }
    case 'number': {
      out = { type: tests.some((t) => t.name === 'integer') ? 'integer' : 'number' };
      const min = findTest('min');
      if (min && min.params && min.params.min !== undefined) out.minimum = Number(min.params.min);
      const max = findTest('max');
      if (max && max.params && max.params.max !== undefined) out.maximum = Number(max.params.max);
      break;
    }
    case 'boolean': out = { type: 'boolean' }; break;
    case 'date': out = { type: 'string', format: 'date-time' }; break;
    case 'array':
      out = { type: 'array', items: desc.innerType ? fromDescription(desc.innerType, depth + 1) : {} };
      break;
    case 'mixed':
    default:
      out = {};
  }

  if (Array.isArray(desc.oneOf) && desc.oneOf.length) {
    const values = desc.oneOf.filter((v) => v !== undefined && v !== null && typeof v !== 'object');
    if (values.length) out.enum = values;
  }
  if (desc.nullable) out = addNull(out);
  if (desc.default !== undefined && (typeof desc.default !== 'object' || desc.default === null)) {
    out.default = desc.default;
  }
  if (desc.label) out.title = desc.label;
  return out;
}

function toJsonSchema(schema) {
  return fromDescription(schema.describe());
}

module.exports = { name: 'yup', isSchema, toJsonSchema };
