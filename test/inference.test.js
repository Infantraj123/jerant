'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createNode, observe, nodeToJsonSchema, stabilityScore } = require('../src/inference');

test('merges observations into a stable schema with optional fields', () => {
  const node = createNode();
  observe(node, { name: 'John' });
  observe(node, { name: 'Alice', age: 25 });

  const schema = nodeToJsonSchema(node);
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties.name.type, 'string');
  assert.equal(schema.properties.age.type, 'integer');
  // name seen in every observation -> required; age seen once -> optional
  assert.deepEqual(schema.required, ['name']);
});

test('detects nullable values', () => {
  const node = createNode();
  observe(node, { nickname: 'jo' });
  observe(node, { nickname: null });
  const schema = nodeToJsonSchema(node);
  assert.deepEqual(schema.properties.nickname.type, ['string', 'null']);
});

test('handles nested objects and arrays', () => {
  const node = createNode();
  observe(node, { user: { id: 1, tags: ['a', 'b'] } });
  observe(node, { user: { id: 2, tags: ['c'] } });
  const schema = nodeToJsonSchema(node);
  const user = schema.properties.user;
  assert.equal(user.type, 'object');
  assert.equal(user.properties.id.type, 'integer');
  assert.equal(user.properties.tags.type, 'array');
  assert.equal(user.properties.tags.items.type, 'string');
});

test('conflicting types produce anyOf and lower stability', () => {
  const node = createNode();
  observe(node, { value: 'text' });
  observe(node, { value: 42 });
  const schema = nodeToJsonSchema(node);
  assert.ok(Array.isArray(schema.properties.value.anyOf));
  assert.ok(stabilityScore(node) < 1);
});

test('integer widens to number when floats appear', () => {
  const node = createNode();
  observe(node, { price: 10 });
  observe(node, { price: 10.5 });
  const schema = nodeToJsonSchema(node);
  assert.equal(schema.properties.price.type, 'number');
});

test('detects string formats from samples', () => {
  const node = createNode();
  observe(node, { email: 'a@example.com', when: '2026-01-01T10:00:00Z' });
  observe(node, { email: 'b@example.org', when: '2026-02-02T11:30:00Z' });
  const schema = nodeToJsonSchema(node);
  assert.equal(schema.properties.email.format, 'email');
  assert.equal(schema.properties.when.format, 'date-time');
});

test('nodes survive a JSON round-trip (persistence)', () => {
  const node = createNode();
  observe(node, { a: 1, b: { c: true } });
  const revived = JSON.parse(JSON.stringify(node));
  observe(revived, { a: 2 });
  const schema = nodeToJsonSchema(revived);
  assert.equal(schema.properties.a.type, 'integer');
  assert.deepEqual(schema.required, ['a']);
});
