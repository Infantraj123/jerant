'use strict';

// Regression tests for the v0.1.3 bug fixes.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { z } = require('zod');

const { jerant } = require('../src/index');
const { scanRoutes } = require('../src/scanner');
const zodAdapter = require('../src/adapters/zod');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function url(server, pathname) {
  return `http://127.0.0.1:${server.address().port}${pathname}`;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('regex-mounted routers still appear in the docs (best-effort path)', () => {
  const app = express();
  const router = express.Router();
  router.get('/reports', (req, res) => res.json({ ok: true }));
  app.use(/^\/legacy/, router);

  const routes = scanRoutes(app);
  const found = routes.find((r) => r.method === 'GET' && r.path.includes('reports'));
  assert.ok(found, 'route under a regex mount must not vanish');
  assert.ok(found.path.includes('legacy'), `path should carry the mount pattern, got ${found.path}`);
});

test('runtime observations land on the pattern key for param-mounted routers', async (t) => {
  const app = express();
  const instance = jerant(app, { runtime: { maxObservations: 100 } });
  app.use(express.json());

  const orders = express.Router();
  orders.get('/:orderId', (req, res) => res.json({ id: req.params.orderId }));
  app.use('/users/:userId/orders', orders);

  instance.refresh(); // scan tags route objects with their mount prefix
  const server = await listen(app);
  t.after(() => server.close());

  await fetch(url(server, '/users/42/orders/7'));
  await fetch(url(server, '/users/99/orders/1'));
  await settle();

  const spec = instance.refresh();
  const op = spec.paths['/users/{userId}/orders/{orderId}'].get;
  assert.ok(op, 'pattern path must be documented');
  assert.equal(op['x-jerant'].observations, 2, 'observations must attach to the pattern key, not /users/42/...');
});

test('res.json/res.send wrappers are restored after the response', async (t) => {
  const app = express();
  jerant(app);
  app.use(express.json());

  let jsonAfterCall;
  app.get('/ping', (req, res) => {
    res.json({ ok: true });
    jsonAfterCall = res.json;
  });

  const server = await listen(app);
  t.after(() => server.close());

  await fetch(url(server, '/ping'));
  await settle();
  assert.equal(jsonAfterCall, express.response.json, 'res.json must be restored to the original');
});

test('double-installed analyzer never double-wraps a response', async (t) => {
  const app = express();
  const instance = jerant(app);
  // Simulate a second analyzer in the chain (e.g. jerant on app AND a router).
  const { createAnalyzer } = require('../src/analyzer');
  app.use(createAnalyzer(instance.registry, instance.options, null, null));
  app.get('/once', (req, res) => res.json({ n: 1 }));

  const server = await listen(app);
  t.after(() => server.close());

  await fetch(url(server, '/once'));
  await settle();

  const entry = instance.registry.get('GET /once');
  assert.ok(entry, 'route observed');
  assert.equal(entry.observations, 1, 'one request must record exactly one observation');
});

test('operationIds never collide (/user-profiles vs /user/profiles)', async () => {
  const app = express();
  const instance = jerant(app);
  app.get('/user-profiles', (req, res) => res.json([]));
  app.get('/user/profiles', (req, res) => res.json([]));

  const spec = instance.refresh();
  const a = spec.paths['/user-profiles'].get.operationId;
  const b = spec.paths['/user/profiles'].get.operationId;
  assert.ok(a && b);
  assert.notEqual(a, b, `operationIds must be unique, both were ${a}`);
});

test('zod: discriminatedUnion options stored as a Map still produce anyOf branches', () => {
  const str = { _def: { typeName: 'ZodString' }, safeParse() {} };
  const optionA = {
    _def: { typeName: 'ZodObject', shape: { kind: str } },
    safeParse() {},
  };
  const optionB = {
    _def: { typeName: 'ZodObject', shape: { kind: str, extra: str } },
    safeParse() {},
  };
  const union = {
    _def: {
      typeName: 'ZodDiscriminatedUnion',
      options: new Map([['a', optionA], ['b', optionB]]),
    },
    safeParse() {},
  };
  const schema = zodAdapter.toJsonSchema(union);
  assert.ok(Array.isArray(schema.anyOf));
  assert.equal(schema.anyOf.length, 2, 'Map options must not collapse to an empty anyOf');
  assert.equal(schema.anyOf[0].type, 'object');
});

test('zod v4 shapes: z.iso.date()/z.iso.time() and looseObject in the fallback walker', () => {
  // Fabricated v4 def shapes (the walker is structural, so these stand in
  // for a real zod@4 install).
  const isoDate = { _zod: { def: { type: 'iso_date' } }, safeParse() {} };
  const isoTime = { _zod: { def: { type: 'iso_time' } }, safeParse() {} };
  const stringWithTimeCheck = {
    _zod: {
      def: {
        type: 'string',
        checks: [{ _zod: { def: { check: 'string_format', format: 'time' } } }],
      },
    },
    safeParse() {},
  };
  const loose = {
    _zod: { def: { type: 'looseObject', shape: { name: isoDate } } },
    safeParse() {},
  };

  assert.deepEqual(zodAdapter.toJsonSchema(isoDate), { type: 'string', format: 'date' });
  assert.deepEqual(zodAdapter.toJsonSchema(isoTime), { type: 'string', format: 'time' });
  assert.equal(zodAdapter.toJsonSchema(stringWithTimeCheck).format, 'time');
  const looseSchema = zodAdapter.toJsonSchema(loose);
  assert.equal(looseSchema.type, 'object');
  assert.equal(looseSchema.additionalProperties, true);
});

test('zod: strict objects document additionalProperties: false', () => {
  const schema = zodAdapter.toJsonSchema(z.object({ id: z.string() }).strict());
  assert.equal(schema.additionalProperties, false);
});

test('app.all() documents HEAD and OPTIONS too', () => {
  const app = express();
  app.all('/anything', (req, res) => res.json({ ok: true }));
  const routes = scanRoutes(app);
  const methods = routes.filter((r) => r.path === '/anything').map((r) => r.method).sort();
  assert.deepEqual(methods, ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
});

test('index.d.ts declares every runtime export', () => {
  const fs = require('node:fs');
  const dts = fs.readFileSync(require.resolve('../index.d.ts'), 'utf8');
  const runtimeExports = Object.keys(require('../src/index'));
  for (const name of runtimeExports) {
    if (name === 'default') {
      assert.match(dts, /export default jerant/);
    } else {
      assert.ok(
        new RegExp(`export (?:function|const|interface|type)? ?${name}\\b`).test(dts),
        `index.d.ts is missing export "${name}"`
      );
    }
  }
});
