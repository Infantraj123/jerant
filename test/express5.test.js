'use strict';

// Regression coverage for Express 5 (router@2), whose router internals
// differ from Express 4: no layer.regexp, opaque matchers, app.router
// instead of app._router. Installed as the "express5" npm alias.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express5');
const { z } = require('zod');

const { jerant, validate } = require('../src/index');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('express 5: routes, nested routers (any mount order), runtime analysis', async (t) => {
  const app = express();
  jerant(app, { title: 'E5' });
  app.use(express.json());

  app.post(
    '/users',
    validate({ body: z.object({ name: z.string(), email: z.string().email() }) }),
    (req, res) => res.status(201).json({ id: 1 })
  );

  // Hardest ordering: nest routers before attaching the tree to the app.
  const orders = express.Router();
  orders.get('/orders/:orderId', (req, res) => res.json({ id: req.params.orderId }));
  const api = express.Router();
  api.use('/v1', orders);
  app.use('/api', api);

  app.post('/echo', (req, res) => res.json({ ok: true }));

  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  await fetch(`${base}/api/v1/orders/9`);
  await fetch(`${base}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 42, password: 'x' }),
  });
  await new Promise((r) => setTimeout(r, 50));

  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.paths['/users'].post);
  assert.equal(spec.paths['/users'].post['x-jerant'].source, 'zod');

  const nested = spec.paths['/api/v1/orders/{orderId}'];
  assert.ok(nested, 'deeply nested router route discovered with full mount path');
  assert.equal(nested.get['x-jerant'].observations, 1);
  assert.equal(nested.get.parameters.find((p) => p.in === 'path').name, 'orderId');

  const echo = spec.paths['/echo'].post;
  assert.equal(echo['x-jerant'].source, 'runtime');
  assert.ok(!JSON.stringify(spec).includes('"x"'), 'password value never stored');

  const docs = await fetch(`${base}/docs`);
  assert.equal(docs.status, 200);

  // Validation still enforces on express 5.
  const bad = await fetch(`${base}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x', email: 'nope' }),
  });
  assert.equal(bad.status, 400);
});
