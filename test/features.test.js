'use strict';

// Tests for the v0.2 features (security, validation errors, envelope,
// default responses, tags, UIs, CLI) and the v0.3 additions (drift,
// prisma tracing, custom storage, diff).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFile } = require('node:child_process');
const express = require('express');
const { z } = require('zod');

const { jerant, validate } = require('../src/index');
const { parsePrismaSchema, modelBodySchema } = require('../src/prisma');
const { diffSpecs } = require('../src/cli');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function url(server, pathname) {
  return `http://127.0.0.1:${server.address().port}${pathname}`;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function deref(spec, schema) {
  if (schema && schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return spec.components.schemas[name];
  }
  return schema;
}

// --- 8. security ---

test('security: "bearer" shorthand registers the scheme and a global requirement', () => {
  const app = express();
  const instance = jerant(app, { security: 'bearer' });
  app.get('/private', (req, res) => res.json({ ok: true }));

  const spec = instance.refresh();
  assert.deepEqual(spec.components.securitySchemes.bearerAuth, {
    type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
  });
  assert.deepEqual(spec.security, [{ bearerAuth: [] }]);
});

test('security: per-route validate({security: []}) marks a route public', () => {
  const app = express();
  const instance = jerant(app, { security: 'bearer' });
  app.get('/login', validate({ security: [] }), (req, res) => res.json({}));
  app.get('/me', (req, res) => res.json({}));

  const spec = instance.refresh();
  assert.deepEqual(spec.paths['/login'].get.security, [], 'security: [] must override the global default');
  assert.equal(spec.paths['/me'].get.security, undefined, 'default routes inherit the global requirement');
});

test('security: auth middleware is auto-detected from its source', () => {
  const app = express();
  const instance = jerant(app);

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
    next();
  }
  app.get('/secure', requireAuth, (req, res) => res.json({ ok: true }));
  app.get('/open', (req, res) => res.json({ ok: true }));

  const spec = instance.refresh();
  assert.deepEqual(spec.paths['/secure'].get.security, [{ bearerAuth: [] }]);
  assert.ok(spec.components.securitySchemes.bearerAuth, 'detected scheme must be registered');
  assert.equal(spec.paths['/open'].get.security, undefined);
});

// --- 9. customizable validation error ---

test('validationError: status and formatter reshape the failure response', async (t) => {
  const app = express();
  jerant(app, {
    validationError: {
      status: 422,
      formatter: ({ details }) => ({ success: false, errors: details.map((d) => d.message) }),
    },
  });
  app.use(express.json());
  app.post('/users', validate({ body: z.object({ name: z.string() }) }), (req, res) => res.json({}));

  const server = await listen(app);
  t.after(() => server.close());

  const res = await fetch(url(server, '/users'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
});

// --- 11. envelope + default responses ---

test('envelope: declared response schemas are wrapped once, documented everywhere', () => {
  const app = express();
  const instance = jerant(app, {
    envelope: { success: 'boolean', message: 'string', data: '$data' },
    defaultResponses: {
      401: { description: 'Not signed in', schema: { type: 'object', properties: { error: { type: 'string' } } } },
    },
  });
  app.get(
    '/profile',
    validate({ response: z.object({ name: z.string() }) }),
    (req, res) => res.json({ success: true, data: { name: 'x' } })
  );

  const spec = instance.refresh();
  const op = spec.paths['/profile'].get;
  const wrapped = deref(spec, op.responses['200'].content['application/json'].schema);
  assert.equal(wrapped.properties.success.type, 'boolean');
  assert.equal(wrapped.properties.message.type, 'string');
  assert.equal(wrapped.properties.data.properties.name.type, 'string', 'the $data slot holds the declared schema');

  // Default responses are defined once and referenced, not copied.
  assert.equal(op.responses['401'].$ref, '#/components/responses/Default401');
  const shared = spec.components.responses.Default401;
  assert.equal(shared.description, 'Not signed in');
  const errSchema = shared.content['application/json'].schema;
  assert.equal(errSchema.properties.error.type, 'string');
});

// --- examples: type-name placeholder values ---

test('examples: placeholder mode shows type names as values ({email: "email"})', async (t) => {
  const app = express();
  const instance = jerant(app); // 'placeholder' is the default
  app.use(express.json());
  app.post(
    '/signup',
    validate({
      body: z.object({
        email: z.string().email(),
        password: z.string(),
        age: z.number().int().optional(),
        score: z.number().optional(),
        active: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
      }),
      response: z.object({ id: z.number() }),
    }),
    (req, res) => res.json({ id: 1 })
  );

  const server = await listen(app);
  t.after(() => server.close());
  // Real traffic must NOT leak into examples in placeholder mode.
  await fetch(url(server, '/signup'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'real@person.com', password: 'hunter2' }),
  });
  await settle();

  const spec = instance.refresh();
  const media = spec.paths['/signup'].post.requestBody.content['application/json'];
  assert.deepEqual(media.example, {
    email: 'email',
    password: 'string',
    age: 'number',
    score: 'float',
    active: 'boolean',
    tags: ['string'],
  });
  assert.ok(!JSON.stringify(spec).includes('real@person.com'), 'captured payloads never surface');

  const resMedia = spec.paths['/signup'].post.responses['200'].content['application/json'];
  assert.deepEqual(resMedia.example, { id: 'float' });
});

// --- 12. tags metadata ---

test('tags: top-level metadata controls descriptions and ordering', () => {
  const app = express();
  const instance = jerant(app, {
    tags: [{ name: 'orders', description: 'Order management' }, 'users'],
  });
  app.get('/users', (req, res) => res.json([]));
  app.get('/orders', (req, res) => res.json([]));

  const spec = instance.refresh();
  assert.deepEqual(spec.tags, [
    { name: 'orders', description: 'Order management' },
    { name: 'users' },
  ]);
});

// --- 13/14. UIs and local assets ---

test('ui: redoc and scalar pages render; local assets serve swagger-ui-dist', async (t) => {
  const redocApp = express();
  jerant(redocApp, { ui: 'redoc' });
  const scalarApp = express();
  jerant(scalarApp, { ui: 'scalar', docsPath: '/reference' });
  const localApp = express();
  jerant(localApp, { assets: 'local' });

  const servers = await Promise.all([listen(redocApp), listen(scalarApp), listen(localApp)]);
  t.after(() => servers.forEach((s) => s.close()));

  const redocHtml = await (await fetch(url(servers[0], '/docs'))).text();
  assert.ok(redocHtml.includes('redoc'), 'redoc page rendered');

  const scalarHtml = await (await fetch(url(servers[1], '/reference'))).text();
  assert.ok(scalarHtml.includes('api-reference'), 'scalar page rendered');

  const docsHtml = await (await fetch(url(servers[2], '/docs'))).text();
  assert.ok(docsHtml.includes('/docs/assets/swagger-ui-bundle.js'), 'swagger page points at local assets');
  const css = await fetch(url(servers[2], '/docs/assets/swagger-ui.css'));
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const denied = await fetch(url(servers[2], '/docs/assets/package.json'));
  assert.equal(denied.status, 404, 'non-allowlisted files must not be readable');
});

// --- teach mode: low-confidence operations become exercisable ---

test('teachMode: <50% confidence routes get an open free-form body and learn from it', async (t) => {
  const app = express();
  const instance = jerant(app, { sourceScan: { enabled: false } });
  app.use(express.json());
  // Opaque handler: no schema, no field reads -> route-scan only (25%).
  const opaque = (req, res) => res.json(Object.assign({}, { ok: true }));
  app.post('/mystery', opaque);

  let spec = instance.refresh();
  let op = spec.paths['/mystery'].post;
  assert.ok(op['x-jerant'].confidence < 50);
  assert.equal(op['x-jerant'].learning, true, 'low-confidence op is marked learning');
  const media = op.requestBody.content['application/json'];
  assert.equal(media.schema.additionalProperties, true, 'free-form editable body offered');

  // A user sends a payload through the open editor -> the docs learn it.
  const server = await listen(app);
  t.after(() => server.close());

  // The docs page ships the teach panel (query/header/body editors).
  const docsHtml = await (await fetch(url(server, '/docs'))).text();
  for (const marker of ['jerant-teach', 'form-data', 'url-encoded', 'add query param', 'add header']) {
    assert.ok(docsHtml.includes(marker), `docs page missing teach panel piece: ${marker}`);
  }
  await fetch(url(server, '/mystery'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'ABC', qty: 2 }),
  });
  await settle();

  spec = instance.refresh();
  op = spec.paths['/mystery'].post;
  assert.ok(op['x-jerant'].confidence >= 40, 'confidence rises after the taught request');
  const learned = deref(spec, op.requestBody.content['application/json'].schema);
  assert.equal(learned.properties.code.type, 'string', 'taught fields are documented');
  assert.equal(learned.properties.qty.type, 'integer');

  // Off switch.
  const strictApp = express();
  const strictInstance = jerant(strictApp, { teachMode: false, sourceScan: { enabled: false } });
  strictApp.post('/mystery', opaque);
  const strictOp = strictInstance.refresh().paths['/mystery'].post;
  assert.equal(strictOp.requestBody, undefined, 'teachMode: false adds nothing');
  assert.equal(strictOp['x-jerant'].learning, undefined);
});

// --- ui: false / custom page ---

test('ui: false serves only the spec; a custom page/renderer replaces the UI', async (t) => {
  const bareApp = express();
  jerant(bareApp, { ui: false });
  bareApp.get('/mydocs', (req, res) => res.send('<h1>my own ui</h1>'));

  const htmlApp = express();
  jerant(htmlApp, { ui: { html: '<html><body>custom page</body></html>' } });

  const fnApp = express();
  jerant(fnApp, {
    title: 'Fn API',
    ui: ({ openapiPath, title }) => `<html><body>${title} spec at ${openapiPath}</body></html>`,
  });

  const servers = await Promise.all([listen(bareApp), listen(htmlApp), listen(fnApp)]);
  t.after(() => servers.forEach((s) => s.close()));

  assert.equal((await fetch(url(servers[0], '/docs'))).status, 404, 'ui: false leaves docsPath alone');
  assert.equal((await fetch(url(servers[0], '/openapi.json'))).status, 200, 'the spec is still served');
  assert.ok((await (await fetch(url(servers[0], '/mydocs'))).text()).includes('my own ui'));

  assert.ok((await (await fetch(url(servers[1], '/docs'))).text()).includes('custom page'));

  const fnHtml = await (await fetch(url(servers[2], '/docs'))).text();
  assert.ok(fnHtml.includes('Fn API spec at /openapi.json'), 'renderer receives openapiPath and title');
});

// --- 10/18. CLI export + diff ---

test('cli: export writes the OpenAPI document for an app entry file', async () => {
  const bin = path.resolve(__dirname, '../bin/jerant.js');
  const entry = path.resolve(__dirname, 'fixtures/cli-app.js');
  const stdout = await new Promise((resolve, reject) => {
    execFile(process.execPath, [bin, 'export', entry, '--wait', '100'], { timeout: 15000 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
  const spec = JSON.parse(stdout);
  assert.equal(spec.info.title, 'CLI Fixture API');
  assert.ok(spec.paths['/things'].get);
  assert.ok(spec.paths['/things'].post);
});

test('cli: diff flags breaking changes and exits clean on additions', () => {
  const oldSpec = {
    paths: {
      '/users': {
        post: {
          requestBody: { content: { 'application/json': { schema: {
            type: 'object', properties: { name: { type: 'string' } }, required: ['name'],
          } } } },
          responses: { 200: { content: { 'application/json': { schema: {
            type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } },
          } } } } },
        },
      },
      '/legacy': { get: { responses: { 200: { description: 'ok' } } } },
    },
  };
  const newSpec = {
    paths: {
      '/users': {
        post: {
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: { name: { type: 'string' }, email: { type: 'string' } },
            required: ['name', 'email'],
          } } } },
          responses: { 200: { content: { 'application/json': { schema: {
            type: 'object', properties: { id: { type: 'string' } },
          } } } } },
        },
      },
      '/users/{id}': { get: { responses: { 200: { description: 'ok' } } } },
    },
  };

  const { breaking, info } = diffSpecs(oldSpec, newSpec);
  assert.ok(breaking.some((f) => f.includes('operation removed') && f.includes('/legacy')));
  assert.ok(breaking.some((f) => f.includes('new required request property "email"')));
  assert.ok(breaking.some((f) => f.includes('type changed integer -> string')));
  assert.ok(breaking.some((f) => f.includes('property "name" removed')));
  assert.ok(info.some((f) => f.includes('operation added')));

  const clean = diffSpecs(oldSpec, oldSpec);
  assert.equal(clean.breaking.length, 0);
  assert.equal(clean.info.length, 0);
});

// --- 15. custom storage ---

test('storage: a custom store (Redis-style) round-trips registry data', async (t) => {
  const saved = {};
  const store = {
    load: async () => saved.data || null, // async like a real Redis client
    save: (data) => { saved.data = data; },
  };

  const app = express();
  const instance = jerant(app, { storage: { mode: 'custom', store } });
  app.use(express.json());
  app.get('/widgets', (req, res) => res.json([{ id: 1 }]));

  const server = await listen(app);
  t.after(() => server.close());
  await fetch(url(server, '/widgets'));
  await settle();
  instance.flush();

  assert.ok(saved.data, 'custom store received a save');
  assert.ok(saved.data.routes['GET /widgets'], 'observations persisted through the custom store');

  // A second app hydrates from the same store.
  const app2 = express();
  const instance2 = jerant(app2, { storage: { mode: 'custom', store } });
  app2.get('/widgets', (req, res) => res.json([{ id: 1 }]));
  await settle(); // async load resolves
  const spec = instance2.refresh();
  assert.equal(spec.paths['/widgets'].get['x-jerant'].observations, 1);
});

// --- 16. prisma-aware tracing ---

test('prisma: schema.prisma parsing maps scalar types, enums and optionality', () => {
  const fs = require('node:fs');
  const text = fs.readFileSync(path.resolve(__dirname, 'fixtures/prisma/schema.prisma'), 'utf8');
  const parsed = parsePrismaSchema(text);

  const body = modelBodySchema(parsed, 'user');
  assert.equal(body.properties.email.type, 'string');
  assert.equal(body.properties.name.type, 'string');
  assert.equal(body.properties.age.type, 'integer');
  assert.deepEqual(body.properties.role.enum, ['ADMIN', 'MEMBER']);
  assert.equal(body.properties.id, undefined, 'server-managed @id fields are not client input');
  assert.equal(body.properties.createdAt, undefined, '@default fields are not client input');
  assert.equal(body.properties.posts, undefined, 'relations are not client input');
  assert.deepEqual(body.required.sort(), ['email', 'name']);
});

test('prisma: handlers writing req.body into prisma models get typed body docs', () => {
  const app = express();
  const instance = jerant(app, {
    sourceScan: { enabled: false },
    prisma: { schemaPath: path.resolve(__dirname, 'fixtures/prisma/schema.prisma') },
  });
  app.use(express.json());
  const prisma = { user: { create: async () => ({}) } };
  app.post('/users', async (req, res) => {
    const user = await prisma.user.create({ data: req.body });
    res.status(201).json(user);
  });

  const spec = instance.refresh();
  const op = spec.paths['/users'].post;
  const body = deref(spec, op.requestBody.content['application/json'].schema);
  assert.equal(body.properties.email.type, 'string');
  assert.equal(body.properties.age.type, 'integer');
  assert.equal(op['x-jerant'].sources.body, 'prisma');
  assert.equal(op['x-jerant'].confidence, 75);
});

// --- 17. drift detection ---

test('drift: responses that stop matching the declared schema are flagged', async (t) => {
  const app = express();
  const instance = jerant(app);
  app.use(express.json());
  app.get(
    '/stats',
    validate({ response: z.object({ count: z.number() }) }),
    (req, res) => res.json({ count: 'five' }) // reality drifted from the declaration
  );

  const server = await listen(app);
  t.after(() => server.close());
  for (let i = 0; i < 6; i++) await fetch(url(server, '/stats'));
  await settle();

  const spec = instance.refresh();
  const drift = spec.paths['/stats'].get['x-jerant'].drift;
  assert.ok(drift, 'drift issues must be annotated');
  assert.ok(drift.some((d) => d.issue === 'type-mismatch' && d.field === 'count'));
  assert.ok(spec['x-jerant'].drift.some((d) => d.path === '/stats'), 'spec-level drift summary present');
});
