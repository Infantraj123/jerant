'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { z } = require('zod');
const Joi = require('joi');
const yup = require('yup');
const Ajv = require('ajv');
const { body, query } = require('express-validator');

const { detectSchema, expressValidator } = require('../src/adapters');

test('zod: object with formats, optionals, nullable, enum', () => {
  const schema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    age: z.number().int().optional(),
    nickname: z.string().nullable(),
    role: z.enum(['admin', 'user']),
    tags: z.array(z.string()),
  });
  const detected = detectSchema(schema);
  assert.equal(detected.source, 'zod');
  const s = detected.schema;
  assert.equal(s.type, 'object');
  assert.equal(s.properties.email.format, 'email');
  assert.equal(s.properties.name.minLength, 2);
  assert.equal(s.properties.age.type, 'integer');
  assert.deepEqual(s.properties.nickname.type, ['string', 'null']);
  assert.deepEqual(s.properties.role.enum, ['admin', 'user']);
  assert.equal(s.properties.tags.items.type, 'string');
  assert.ok(s.required.includes('name'));
  assert.ok(s.required.includes('email'));
  assert.ok(!s.required.includes('age'));
});

test('zod: unions, defaults and nested objects', () => {
  const schema = z.object({
    id: z.union([z.string(), z.number()]),
    limit: z.number().default(10),
    address: z.object({ city: z.string() }),
  });
  const s = detectSchema(schema).schema;
  assert.ok(Array.isArray(s.properties.id.anyOf));
  assert.equal(s.properties.limit.default, 10);
  assert.equal(s.properties.address.properties.city.type, 'string');
});

test('joi: object with rules and presence', () => {
  const schema = Joi.object({
    sku: Joi.string().min(3).required(),
    qty: Joi.number().integer().min(1).required(),
    email: Joi.string().email(),
    status: Joi.string().valid('open', 'closed').required(),
    when: Joi.date(),
  });
  const detected = detectSchema(schema);
  assert.equal(detected.source, 'joi');
  const s = detected.schema;
  assert.equal(s.properties.sku.minLength, 3);
  assert.equal(s.properties.qty.type, 'integer');
  assert.equal(s.properties.qty.minimum, 1);
  assert.equal(s.properties.email.format, 'email');
  assert.deepEqual(s.properties.status.enum, ['open', 'closed']);
  assert.equal(s.properties.when.format, 'date-time');
  assert.deepEqual(s.required.sort(), ['qty', 'sku', 'status']);
});

test('yup: object with required, nullable and formats', () => {
  const schema = yup.object({
    name: yup.string().required().min(2),
    email: yup.string().email().required(),
    bio: yup.string().nullable(),
    score: yup.number().integer().max(100),
  });
  const detected = detectSchema(schema);
  assert.equal(detected.source, 'yup');
  const s = detected.schema;
  assert.equal(s.properties.name.minLength, 2);
  assert.equal(s.properties.email.format, 'email');
  assert.deepEqual(s.properties.bio.type, ['string', 'null']);
  assert.equal(s.properties.score.type, 'integer');
  assert.equal(s.properties.score.maximum, 100);
  assert.deepEqual(s.required.sort(), ['email', 'name']);
});

test('ajv: compiled validators and plain JSON Schema pass through', () => {
  const raw = {
    type: 'object',
    properties: { id: { type: 'integer' }, name: { type: 'string' } },
    required: ['id'],
  };
  const compiled = new Ajv().compile(raw);
  const fromCompiled = detectSchema(compiled);
  assert.equal(fromCompiled.source, 'ajv');
  assert.equal(fromCompiled.schema.properties.id.type, 'integer');

  const fromPlain = detectSchema({ ...raw, $schema: 'https://json-schema.org/draft/2020-12/schema' });
  assert.equal(fromPlain.source, 'ajv');
  assert.equal(fromPlain.schema.$schema, undefined);
  assert.deepEqual(fromPlain.schema.required, ['id']);
});

test('adapter priority: zod schema is never misdetected as JSON Schema', () => {
  const schema = z.object({ type: z.string(), properties: z.string() });
  assert.equal(detectSchema(schema).source, 'zod');
});

test('express-validator: chains reconstruct per-location schemas', () => {
  const handles = [
    body('email').isEmail(),
    body('age').optional().isInt(),
    body('role').isIn(['admin', 'user']),
    query('page').optional().isInt(),
    (req, res) => res.end(), // plain handler is ignored
  ];
  const extracted = expressValidator.extractFromHandles(handles);
  assert.ok(extracted.body);
  assert.equal(extracted.body.properties.email.format, 'email');
  assert.equal(extracted.body.properties.age.type, 'integer');
  assert.deepEqual(extracted.body.properties.role.enum, ['admin', 'user']);
  assert.ok(extracted.body.required.includes('email'));
  assert.ok(!extracted.body.required.includes('age'));
  assert.equal(extracted.query.properties.page.type, 'integer');
  assert.equal(expressValidator.extractFromHandles([(req, res) => res.end()]), null);
});
