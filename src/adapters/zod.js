'use strict';

// Zod adapter. Supports Zod v3 (via a structural walker over _def) and
// Zod v4 (via the module-level z.toJSONSchema when available, falling back
// to the walker, which also understands v4 def shapes).

const MAX_DEPTH = 12;

function getDef(schema) {
  if (!schema || typeof schema !== 'object') return null;
  return schema._def || (schema._zod && schema._zod.def) || null;
}

function isSchema(value) {
  return !!(
    value &&
    typeof value === 'object' &&
    typeof value.safeParse === 'function' &&
    getDef(value)
  );
}

function kindOf(schema) {
  const def = getDef(schema);
  if (!def) return null;
  const raw = def.typeName || def.type;
  if (!raw) return null;
  return String(raw).replace(/^Zod/, '').toLowerCase();
}

function addNull(schema) {
  const out = { ...schema };
  if (typeof out.type === 'string') out.type = [out.type, 'null'];
  else if (Array.isArray(out.type)) {
    if (!out.type.includes('null')) out.type = [...out.type, 'null'];
  } else if (out.anyOf) out.anyOf = [...out.anyOf, { type: 'null' }];
  else return { anyOf: [out, { type: 'null' }] };
  return out;
}

function checkKind(check) {
  if (!check) return null;
  if (check.kind) return check.kind;
  // Zod v4 stores checks as schema-like objects with their own defs.
  const def = check._zod && check._zod.def;
  if (def) return def.check || def.format || null;
  return null;
}

function checkValue(check) {
  if ('value' in check) return check.value;
  const def = check._zod && check._zod.def;
  return def ? def.value : undefined;
}

function walk(schema, depth = 0) {
  if (depth > MAX_DEPTH) return {};
  const def = getDef(schema);
  if (!def) return {};
  const kind = kindOf(schema);
  let out;

  switch (kind) {
    case 'string': {
      out = { type: 'string' };
      for (const check of def.checks || []) {
        const k = checkKind(check);
        if (k === 'email') out.format = 'email';
        else if (k === 'uuid' || k === 'guid') out.format = 'uuid';
        else if (k === 'url') out.format = 'uri';
        else if (k === 'datetime' || k === 'iso_datetime') out.format = 'date-time';
        else if (k === 'min' || k === 'min_length') out.minLength = checkValue(check);
        else if (k === 'max' || k === 'max_length') out.maxLength = checkValue(check);
        else if (k === 'regex' && check.regex) out.pattern = check.regex.source;
      }
      break;
    }
    // Zod v4 top-level string formats (z.email(), z.uuid(), ...)
    case 'email': out = { type: 'string', format: 'email' }; break;
    case 'uuid': case 'guid': out = { type: 'string', format: 'uuid' }; break;
    case 'url': out = { type: 'string', format: 'uri' }; break;
    case 'number': {
      out = { type: 'number' };
      for (const check of def.checks || []) {
        const k = checkKind(check);
        if (k === 'int') out.type = 'integer';
        else if (k === 'min' || k === 'greater_than') out.minimum = checkValue(check);
        else if (k === 'max' || k === 'less_than') out.maximum = checkValue(check);
      }
      break;
    }
    case 'int': out = { type: 'integer' }; break;
    case 'bigint': out = { type: 'integer' }; break;
    case 'boolean': out = { type: 'boolean' }; break;
    case 'date': out = { type: 'string', format: 'date-time' }; break;
    case 'array': {
      const item = def.type || def.element;
      out = { type: 'array', items: item ? walk(item, depth + 1) : {} };
      if (def.minLength && def.minLength.value != null) out.minItems = def.minLength.value;
      if (def.maxLength && def.maxLength.value != null) out.maxItems = def.maxLength.value;
      break;
    }
    case 'object': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape || {};
      const properties = {};
      const required = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = walk(child, depth + 1);
        if (!isOptionalSchema(child)) required.push(key);
      }
      out = { type: 'object', properties };
      if (required.length) out.required = required;
      break;
    }
    case 'optional': out = walk(def.innerType, depth + 1); break;
    case 'nullable': out = addNull(walk(def.innerType, depth + 1)); break;
    case 'default': {
      out = walk(def.innerType, depth + 1);
      try {
        const dv = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
        if (dv !== undefined && typeof dv !== 'function') out.default = dv;
      } catch { /* defaults that throw are skipped */ }
      break;
    }
    case 'catch': case 'readonly': case 'branded': case 'promise':
      out = walk(def.innerType || def.type || def.schema, depth + 1);
      break;
    case 'effects': out = walk(def.schema, depth + 1); break;
    case 'pipe': out = walk(def.in || def.out, depth + 1); break;
    case 'lazy': {
      try { out = walk(def.getter(), depth + 1); } catch { out = {}; }
      break;
    }
    case 'enum': {
      const values = Array.isArray(def.values)
        ? def.values
        : def.entries ? Object.values(def.entries) : [];
      out = { type: typeof values[0] === 'number' ? 'number' : 'string', enum: [...values] };
      break;
    }
    case 'nativeenum': {
      const values = Object.values(def.values || {}).filter((v) => typeof v !== 'function');
      out = { enum: values };
      break;
    }
    case 'literal': {
      const value = 'value' in def ? def.value : Array.isArray(def.values) ? def.values[0] : undefined;
      out = { const: value };
      const t = typeof value;
      if (t === 'string' || t === 'number' || t === 'boolean') out.type = t === 'number' ? 'number' : t;
      break;
    }
    case 'union': case 'discriminatedunion':
      out = { anyOf: (def.options || []).map((o) => walk(o, depth + 1)) };
      break;
    case 'intersection':
      out = { allOf: [walk(def.left, depth + 1), walk(def.right, depth + 1)] };
      break;
    case 'record':
      out = { type: 'object', additionalProperties: def.valueType ? walk(def.valueType, depth + 1) : {} };
      break;
    case 'map':
      out = { type: 'object', additionalProperties: def.valueType ? walk(def.valueType, depth + 1) : {} };
      break;
    case 'tuple':
      out = { type: 'array', prefixItems: (def.items || []).map((i) => walk(i, depth + 1)) };
      break;
    case 'set':
      out = { type: 'array', uniqueItems: true, items: def.valueType ? walk(def.valueType, depth + 1) : {} };
      break;
    case 'null': out = { type: 'null' }; break;
    case 'undefined': case 'void': out = { type: 'null' }; break;
    case 'any': case 'unknown': out = {}; break;
    case 'never': out = { not: {} }; break;
    default: out = {};
  }

  if (def.description && !out.description) out.description = def.description;
  return out;
}

function isOptionalSchema(schema) {
  const kind = kindOf(schema);
  if (kind === 'optional' || kind === 'default') return true;
  if (typeof schema.isOptional === 'function') {
    try { return schema.isOptional(); } catch { return false; }
  }
  return false;
}

function stripMetaKeys(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  delete schema.$schema;
  delete schema.$id;
  return schema;
}

function toJsonSchema(schema) {
  // Zod v4: prefer the official converter when the installed zod exposes it.
  if (schema._zod) {
    try {
      // eslint-disable-next-line global-require
      const z = require('zod');
      if (typeof z.toJSONSchema === 'function') {
        return stripMetaKeys(z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }));
      }
    } catch { /* zod not resolvable from here; use the walker */ }
  }
  return walk(schema);
}

module.exports = { name: 'zod', isSchema, toJsonSchema };
