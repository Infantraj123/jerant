'use strict';

// Optional helpers. jerant works with zero configuration, but validate()
// gives you real request validation + guaranteed 100%-confidence docs from
// one declaration, and doc() attaches metadata without validating anything.

const zod = require('./adapters/zod');
const joiAdapter = require('./adapters/joi');
const yupAdapter = require('./adapters/yup');
const ajvAdapter = require('./adapters/ajv');

const LOCATIONS = ['params', 'query', 'body'];

function buildValidator(raw) {
  if (zod.isSchema(raw)) {
    return (value) => {
      const result = raw.safeParse(value);
      if (result.success) return { value: result.data };
      const issues = (result.error && result.error.issues) || [];
      return {
        errors: issues.map((i) => ({ path: (i.path || []).join('.'), message: i.message })),
      };
    };
  }
  if (joiAdapter.isSchema(raw)) {
    return (value) => {
      const result = raw.validate(value, { abortEarly: false });
      if (!result.error) return { value: result.value };
      return {
        errors: result.error.details.map((d) => ({ path: (d.path || []).join('.'), message: d.message })),
      };
    };
  }
  if (yupAdapter.isSchema(raw)) {
    return (value) => {
      try {
        return { value: raw.validateSync(value, { abortEarly: false }) };
      } catch (err) {
        const inner = err.inner && err.inner.length ? err.inner : [err];
        return { errors: inner.map((e) => ({ path: e.path || '', message: e.message })) };
      }
    };
  }
  if (ajvAdapter.isCompiledValidator(raw)) {
    return (value) => {
      if (raw(value)) return { value };
      return {
        errors: (raw.errors || []).map((e) => ({
          path: (e.instancePath || '').replace(/^\//, '').replace(/\//g, '.'),
          message: e.message || 'invalid',
        })),
      };
    };
  }
  return null; // documentation-only schema (plain JSON Schema, class, ...)
}

/**
 * validate({ body, query, params, responses, summary, description, tags })
 *
 * Each of body/query/params accepts a Zod, Joi, Yup schema, a compiled AJV
 * validator, a plain JSON Schema, or a class-validator class. Schemas that
 * can be executed are enforced (400 on failure); the rest document only.
 */
function validate(config = {}) {
  const schemas = {};
  const validators = {};
  for (const location of LOCATIONS) {
    if (config[location] !== undefined && config[location] !== null) {
      schemas[location] = config[location];
      validators[location] = buildValidator(config[location]);
    }
  }

  let responses = null;
  if (config.responses && typeof config.responses === 'object') {
    responses = { ...config.responses };
  } else if (config.response !== undefined && config.response !== null) {
    responses = { 200: config.response };
  }

  const middleware = function jerantValidate(req, res, next) {
    const details = [];
    for (const location of LOCATIONS) {
      const validator = validators[location];
      if (!validator) continue;
      const result = validator(req[location] !== undefined ? req[location] : {});
      if (result.errors) {
        for (const err of result.errors) details.push({ location, ...err });
      } else if (location === 'body' && result.value !== undefined) {
        req.body = result.value; // parsed value (defaults/coercions applied)
      }
    }
    if (details.length) {
      return res.status(400).json({ error: 'Validation failed', details });
    }
    next();
  };

  middleware.__jerant = {
    schemas,
    responses,
    summary: config.summary,
    description: config.description,
    tags: config.tags,
    deprecated: config.deprecated,
    contentType: config.contentType,
    files: config.files,
  };
  return middleware;
}

/** doc(meta): a no-op middleware that only carries documentation metadata. */
function doc(config = {}) {
  const schemas = {};
  for (const location of LOCATIONS) {
    if (config[location] !== undefined && config[location] !== null) {
      schemas[location] = config[location];
    }
  }
  let responses = null;
  if (config.responses && typeof config.responses === 'object') responses = { ...config.responses };
  else if (config.response !== undefined && config.response !== null) responses = { 200: config.response };

  const middleware = function jerantDoc(req, res, next) { next(); };
  middleware.__jerant = {
    schemas,
    responses,
    summary: config.summary,
    description: config.description,
    tags: config.tags,
    deprecated: config.deprecated,
    contentType: config.contentType,
    files: config.files,
  };
  return middleware;
}

module.exports = { validate, doc };
