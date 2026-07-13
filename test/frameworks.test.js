'use strict';

// Fastify / Koa / Hono adapter tests against the real frameworks.

const { test } = require('node:test');
const assert = require('node:assert');

const { jerantFastify, jerantKoa, jerantHono } = require('../src/index');

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('fastify: routes, schemas, runtime analysis, docs and spec', async (t) => {
  const fastify = require('fastify')();
  const instance = jerantFastify(fastify, { title: 'Fastify API' });

  fastify.post('/users', {
    schema: {
      body: {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
        required: ['name'],
      },
      response: {
        201: { type: 'object', properties: { id: { type: 'integer' } } },
      },
    },
  }, async (request, reply) => {
    reply.code(201);
    return { id: 1 };
  });
  fastify.get('/users/:id', async (request) => ({ id: Number(request.params.id), name: 'x' }));

  await fastify.listen({ port: 0 });
  t.after(() => fastify.close());
  const base = `http://127.0.0.1:${fastify.server.address().port}`;

  await fetch(`${base}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'ada', age: 36 }),
  });
  await fetch(`${base}/users/7`);
  await settle();

  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.info.title, 'Fastify API');

  const post = spec.paths['/users'].post;
  const bodySchema = post.requestBody.content['application/json'].schema;
  const resolved = bodySchema.$ref ? spec.components.schemas[bodySchema.$ref.split('/').pop()] : bodySchema;
  assert.equal(resolved.properties.name.type, 'string', 'fastify route schema documented');
  assert.ok(post.responses['201'], 'fastify response schema documented');

  const get = spec.paths['/users/{id}'].get;
  assert.equal(get['x-jerant'].observations, 1, 'runtime traffic observed under the pattern key');

  const docs = await (await fetch(`${base}/docs`)).text();
  assert.ok(docs.includes('swagger-ui'), 'docs page served');
  assert.ok(instance.getSpec());
});

test('koa: @koa/router routes, runtime analysis, docs and spec', async (t) => {
  const Koa = require('koa');
  const Router = require('@koa/router');

  const app = new Koa();
  const router = new Router();
  const instance = jerantKoa(app, { title: 'Koa API', routers: [router] });

  router.get('/items/:itemId', (ctx) => {
    ctx.body = { itemId: ctx.params.itemId, price: 9.5 };
  });
  router.post('/items', (ctx) => {
    ctx.status = 201;
    ctx.body = { created: true };
  });
  app.use(router.routes()).use(router.allowedMethods());

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  await fetch(`${base}/items/42`);
  await settle();

  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.info.title, 'Koa API');
  assert.ok(spec.paths['/items/{itemId}'].get, 'koa router route documented');
  assert.ok(spec.paths['/items'].post);
  assert.equal(spec.paths['/items/{itemId}'].get['x-jerant'].observations, 1);

  const docs = await (await fetch(`${base}/docs`)).text();
  assert.ok(docs.includes('swagger-ui'));
  assert.ok(instance.getSpec());
});

test('hono: routes, runtime analysis, docs and spec', async (t) => {
  const { Hono } = require('hono');
  const { serve } = (() => {
    try { return require('@hono/node-server'); } catch { return {}; }
  })();

  const app = new Hono();
  const instance = jerantHono(app, { title: 'Hono API' });

  app.get('/books/:id', (c) => c.json({ id: c.req.param('id'), title: 'x' }));
  app.post('/books', async (c) => {
    const body = await c.req.json();
    return c.json({ created: true, title: body.title }, 201);
  });

  // Drive the app through its fetch handler (no HTTP server needed).
  const dispatch = (path, init) => app.request(path, init);

  const res = await dispatch('/books/1');
  assert.equal(res.status, 200);
  await dispatch('/books', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Dune' }),
  });
  await settle();

  const spec = await (await dispatch('/openapi.json')).json();
  assert.equal(spec.info.title, 'Hono API');
  assert.ok(spec.paths['/books/{id}'].get, 'hono route documented');
  assert.equal(spec.paths['/books/{id}'].get['x-jerant'].observations, 1);
  const post = spec.paths['/books'].post;
  assert.equal(post['x-jerant'].observations, 1);

  const docs = await (await dispatch('/docs')).text();
  assert.ok(docs.includes('swagger-ui'));
  assert.ok(instance.getSpec());
  void serve;
});
