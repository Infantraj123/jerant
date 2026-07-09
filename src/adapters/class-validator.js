'use strict';

// class-validator adapter (best-effort). Detects decorated classes by asking
// class-validator's metadata storage; requires class-validator to be
// installed in the host application.

const DECORATOR_TYPE_MAP = {
  isString: { type: 'string' },
  isEmail: { type: 'string', format: 'email' },
  isUuid: { type: 'string', format: 'uuid' },
  isUrl: { type: 'string', format: 'uri' },
  isDateString: { type: 'string', format: 'date-time' },
  isInt: { type: 'integer' },
  isNumber: { type: 'number' },
  isPositive: { type: 'number' },
  isNegative: { type: 'number' },
  isBoolean: { type: 'boolean' },
  isArray: { type: 'array' },
  isObject: { type: 'object' },
  isDate: { type: 'string', format: 'date-time' },
};

function getStorage() {
  try {
    // eslint-disable-next-line global-require
    const cv = require('class-validator');
    return typeof cv.getMetadataStorage === 'function' ? cv.getMetadataStorage() : null;
  } catch {
    return null;
  }
}

function getMetadatas(cls) {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const metas = storage.getTargetValidationMetadatas(cls, null, false, false);
    return Array.isArray(metas) && metas.length ? metas : null;
  } catch {
    return null;
  }
}

function isSchema(value) {
  if (typeof value !== 'function' || !value.prototype) return false;
  return !!getMetadatas(value);
}

function toJsonSchema(cls) {
  const metas = getMetadatas(cls);
  if (!metas) return {};
  const properties = {};
  const optional = new Set();

  for (const meta of metas) {
    const prop = meta.propertyName;
    if (!prop) continue;
    if (meta.type === 'conditionalValidation') {
      // @IsOptional registers a conditional validation entry.
      optional.add(prop);
      continue;
    }
    if (!properties[prop]) properties[prop] = {};
    const name = meta.name;
    const mapped = name && DECORATOR_TYPE_MAP[name];
    if (mapped) Object.assign(properties[prop], mapped);
    const constraints = meta.constraints || [];
    if (name === 'minLength') properties[prop].minLength = constraints[0];
    if (name === 'maxLength') properties[prop].maxLength = constraints[0];
    if (name === 'min') properties[prop].minimum = constraints[0];
    if (name === 'max') properties[prop].maximum = constraints[0];
    if (name === 'isEnum' && constraints[0] && typeof constraints[0] === 'object') {
      properties[prop].enum = Object.values(constraints[0]).filter((v) => typeof v !== 'function');
    }
  }

  for (const prop of Object.keys(properties)) {
    if (Object.keys(properties[prop]).length === 0) properties[prop] = { type: 'string' };
  }
  const required = Object.keys(properties).filter((p) => !optional.has(p));
  const out = { type: 'object', properties, title: cls.name };
  if (required.length) out.required = required;
  return out;
}

module.exports = { name: 'class-validator', isSchema, toJsonSchema };
