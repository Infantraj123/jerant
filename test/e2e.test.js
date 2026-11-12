'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { z } = require('zod');
const Joi = require('joi');
const { body } = require('express-validator');

const { jerant, validate } = require('../src/index');
const { REDACTED } = require('../src/redact');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function url(server, pathname) {
  return `http://127.0.0.1:${server.address().port}${pathname}`;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function buildApp() {
  const app = express();
  const instance = jerant(app, { title: 'Test API', version: '9.9.9', examples: 'captured' });
  app.use(express.json());

  // 1. Zod-validated route
  app.post(
    '/users',
    validate({
      summary: 'Create a user',
      tags: ['users'],
      body: z.object({
        name: z.string().min(1),
        email: z.string().email(),
        age: z.number().int().optional(),
      }),
      responses: {
        201: z.object({ id: z.number(), name: z.string() }),
      },
    }),
    (req, res) => res.status(201).json({ id: 1, name: req.body.name })
  );

  // 2. Joi-validated route on a nested router
  const api = express.Router();
  const orders = express.Router();
  orders.post(
    '/orders',
    validate({ body: Joi.object({ sku: Joi.string().required(), qty: Joi.number().integer().required() }) }),
    (req, res) => res.json({ accepted: true })
  );
  api.use('/v1', orders);
  app.use('/api', api);

  // 3. express-validator route (auto-detected, no jerant helpers)
  app.post('/subscribe', body('email').isEmail(), (req, res) => res.json({ subscribed: true }));

  // 4. Legacy routes with no validation at all
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.post('/payments', (req, res) =>
    res.json({ id: 'p_1', amount: req.body.amount, currency: req.body.currency || 'USD' })
  );
  app.get('/items/:itemId', (req, res) => res.json({ itemId: req.params.itemId }));

  return { app, instance };
}

test('e2e: docs and OpenAPI served from the same app and port', async (t) => {
  const { app } = buildApp();
  const server = await listen(app);
  t.after(() => server.close());

  // Feed the runtime analyzer some traffic on the unvalidated route.
  await fetch(url(server, '/payments'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 100, password: 'hunter2' }),
  });
  await fetch(url(server, '/payments'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: 25.5, currency: 'EUR' }),
  });
  await fetch(url(server, '/health'));
  await fetch(url(server, '/items/42?verbose=true'));
  await settle();

  const specRes = await fetch(url(server, '/openapi.json'));
  assert.equal(specRes.status, 200);
  const spec = await specRes.json();

  assert.equal(spec.openapi, '3.0.3');
  assert.equal(spec.info.title, 'Test API');
  assert.equal(spec.info.version, '9.9.9');

  // --- Zod route: full-fidelity docs ---
  const users = spec.paths['/users'].post;
  assert.equal(users.summary, 'Create a user');
  assert.deepEqual(users.tags, ['users']);
  assert.equal(users['x-jerant'].source, 'zod');
  assert.equal(users['x-jerant'].confidence, 100);
  assert.match(users.description, /Source:\*\* Zod/);
  assert.match(users.description, /Confidence:\*\* 100%/);
  const userBodyRef = users.requestBody.content['application/json'].schema;
  assert.ok(userBodyRef.$ref, 'request body schema should be hoisted into components');
  const userBody = spec.components.schemas[userBodyRef.$ref.split('/').pop()];
  assert.equal(userBody.properties.email.format, 'email');
  assert.ok(userBody.required.includes('email'));
  assert.ok(!userBody.required.includes('age'));
  assert.ok(users.responses['201'], 'declared 201 response is documented');

  // --- Joi route on a doubly-nested router ---
  const ordersOp = spec.paths['/api/v1/orders'].post;
  assert.equal(ordersOp['x-jerant'].source, 'joi');
  assert.equal(ordersOp['x-jerant'].confidence, 100);

  // --- express-validator route, detected without any jerant helpers ---
  const subscribe = spec.paths['/subscribe'].post;
  assert.equal(subscribe['x-jerant'].source, 'express-validator');
  const subSchema = subscribe.requestBody.content['application/json'].schema;
  const resolvedSub = subSchema.$ref ? spec.components.schemas[subSchema.$ref.split('/').pop()] : subSchema;
  assert.equal(resolvedSub.properties.email.format, 'email');

  // --- Legacy route: runtime inference with redaction ---
  const payments = spec.paths['/payments'].post;
  assert.equal(payments['x-jerant'].source, 'runtime');
  assert.ok(payments['x-jerant'].confidence >= 30 && payments['x-jerant'].confidence <= 90);
  assert.equal(payments['x-jerant'].observations, 2);
  const paySchema = payments.requestBody.content['application/json'].schema;
  const resolvedPay = paySchema.$ref ? spec.components.schemas[paySchema.$ref.split('/').pop()] : paySchema;
  assert.equal(resolvedPay.properties.amount.type, 'number');
  assert.ok(resolvedPay.properties.currency, 'currency learned from second observation');
  assert.deepEqual(resolvedPay.required, ['amount'], 'only always-present fields are required');
  const media = payments.requestBody.content['application/json'];
  const exampleText = JSON.stringify(media.example || media.examples || {});
  assert.ok(exampleText.includes(REDACTED), 'password example is redacted');
  assert.ok(!exampleText.includes('hunter2'), 'secret never appears in the spec');
  const payResponse = payments.responses['200'].content['application/json'];
  const respSchema = payResponse.schema.$ref
    ? spec.components.schemas[payResponse.schema.$ref.split('/').pop()]
    : payResponse.schema;
  assert.equal(respSchema.properties.id.type, 'string');

  // --- Path + query parameters ---
  const items = spec.paths['/items/{itemId}'].get;
  const pathParam = items.parameters.find((p) => p.in === 'path');
  assert.equal(pathParam.name, 'itemId');
  assert.equal(pathParam.required, true);
  const queryParam = items.parameters.find((p) => p.in === 'query' && p.name === 'verbose');
  assert.ok(queryParam, 'query params learned from traffic');

  // --- Never-called unvalidated route still appears via route scanning ---
  const health = spec.paths['/health'].get;
  assert.ok(health);

  // --- jerant's own endpoints are not documented ---
  assert.equal(spec.paths['/docs'], undefined);
  assert.equal(spec.paths['/openapi.json'], undefined);

  // --- Swagger UI on the same port ---
  const docsRes = await fetch(url(server, '/docs'));
  assert.equal(docsRes.status, 200);
  const html = await docsRes.text();
  assert.match(docsRes.headers.get('content-type'), /text\/html/);
  assert.ok(html.includes('swagger-ui'));
  assert.ok(html.includes('/openapi.json'));
});

test('e2e: validate() enforces schemas with 400 responses', async (t) => {
  const { app } = buildApp();
  const server = await listen(app);
  t.after(() => server.close());

  const bad = await fetch(url(server, '/users'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', email: 'not-an-email' }),
  });
  assert.equal(bad.status, 400);
  const problem = await bad.json();
  assert.equal(problem.error, 'Validation failed');
  assert.ok(problem.details.some((d) => d.path === 'email'));

  const good = await fetch(url(server, '/users'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
  });
  assert.equal(good.status, 201);
  assert.deepEqual(await good.json(), { id: 1, name: 'John' });

  const badOrder = await fetch(url(server, '/api/v1/orders'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qty: 'many' }),
  });
  assert.equal(badOrder.status, 400);
});

test('e2e: runtime schema improves as more traffic is observed', async (t) => {
  const app = express();
  jerant(app, { cacheTtlMs: 0 });
  app.use(express.json());
  app.post('/echo', (req, res) => res.json({ seen: true }));
  const server = await listen(app);
  t.after(() => server.close());

  const post = (payload) =>
    fetch(url(server, '/echo'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  const getSpec = async () => (await fetch(url(server, '/openapi.json?f=' + Math.random()))).json();

  await post({ name: 'John' });
  await settle();
  let spec = await getSpec();
  const firstConfidence = spec.paths['/echo'].post['x-jerant'].confidence;

  for (let i = 0; i < 10; i++) await post({ name: `user${i}`, age: 20 + i });
  await settle();
  // Stale-while-revalidate: this request triggers a background rebuild...
  await getSpec();
  await settle();
  // ...and the next one gets the rebuilt document.
  spec = await getSpec();
  const op = spec.paths['/echo'].post;
  assert.ok(op['x-jerant'].confidence > firstConfidence, 'confidence grows with observations');
  const schema = op.requestBody.content['application/json'].schema;
  const resolved = schema.$ref ? spec.components.schemas[schema.$ref.split('/').pop()] : schema;
  assert.equal(resolved.properties.age.type, 'integer');
  assert.deepEqual(resolved.required, ['name'], 'age stays optional (absent in first request)');
});

test('e2e: disabled via option registers nothing', async (t) => {
  const app = express();
  const instance = jerant(app, { enabled: false });
  assert.equal(instance.enabled, false);
  app.get('/ping', (req, res) => res.json({ pong: true }));
  const server = await listen(app);
  t.after(() => server.close());

  const res = await fetch(url(server, '/docs'));
  assert.equal(res.status, 404);
});

test('jerant is idempotent per app and rejects non-apps', () => {
  const app = express();
  const a = jerant(app);
  const b = jerant(app);
  assert.equal(a, b);
  assert.throws(() => jerant(null), TypeError);
  assert.throws(() => jerant({}), TypeError);
});
