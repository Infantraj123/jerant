'use strict';

// Tests for the large-API work: serving (ETag, compression, background
// rebuilds), spec size (shared default responses, 3.0 output), page script
// behavior, exclusions, transformSpec, auth, production mode, assets and
// non-blocking storage.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const { z } = require('zod');

const { jerant, validate, themeCss, jerantFastify } = require('../src/index');
const { toOpenApi30 } = require('../src/downgrade');
const { FileStore } = require('../src/storage/file');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function url(server, pathname) {
  return `http://127.0.0.1:${server.address().port}${pathname}`;
}

/** Raw GET (fetch transparently decompresses, hiding Content-Encoding). */
function rawGet(server, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url(server, pathname), { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('spec is served with an ETag, 304 on revalidation, and compressed', async (t) => {
  const app = express();
  jerant(app, { sourceScan: { enabled: false } });
  for (let i = 0; i < 40; i++) app.get(`/items${i}/:id`, (req, res) => res.json({ id: 1 }));
  const server = await listen(app);
  t.after(() => server.close());

  const first = await rawGet(server, '/openapi.json');
  assert.equal(first.status, 200);
  assert.ok(first.headers.etag, 'ETag set');
  assert.equal(first.headers.vary, 'Accept-Encoding');
  assert.equal(first.headers['cache-control'], 'no-cache');

  const again = await rawGet(server, '/openapi.json', { 'if-none-match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);

  const gz = await rawGet(server, '/openapi.json', { 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.ok(gz.body.length < first.body.length / 3, 'gzip shrinks the spec');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(gz.body)), JSON.parse(first.body));

  const br = await rawGet(server, '/openapi.json', { 'accept-encoding': 'gzip, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(br.body)), JSON.parse(first.body));

  const docs = await rawGet(server, '/docs', { 'accept-encoding': 'gzip' });
  assert.equal(docs.headers['content-encoding'], 'gzip');
  assert.ok(docs.headers.etag);
});

test('ETag stays stable when a rebuild produces identical content', async (t) => {
  const app = express();
  const instance = jerant(app, { cacheTtlMs: 0, sourceScan: { enabled: false } });
  app.get('/a', (req, res) => res.json({ ok: true }));
  const server = await listen(app);
  t.after(() => server.close());

  const a = await rawGet(server, '/openapi.json');
  instance.registry.version += 1; // inputs "changed" but output did not
  await rawGet(server, '/openapi.json');
  await settle();
  const b = await rawGet(server, '/openapi.json');
  assert.equal(a.headers.etag, b.headers.etag);
});

test('default responses are defined once in components.responses', () => {
  const app = express();
  const instance = jerant(app, {
    sourceScan: { enabled: false },
    defaultResponses: {
      401: { description: 'Unauthorized', schema: { type: 'object', properties: { error: { type: 'string' } } } },
      500: { description: 'Server error', schema: { type: 'object', properties: { error: { type: 'string' } } } },
    },
  });
  for (let i = 0; i < 50; i++) app.get(`/r${i}`, (req, res) => res.json({}));
  const spec = instance.refresh();
  assert.ok(spec.components.responses.Default401);
  assert.ok(spec.components.responses.Default500);
  for (const item of Object.values(spec.paths)) {
    assert.deepEqual(item.get.responses['401'], { $ref: '#/components/responses/Default401' });
  }
  const text = JSON.stringify(spec);
  assert.equal(text.split('"Unauthorized"').length - 1, 1, 'the 401 body appears exactly once');
});

test('openapi option: 3.0 by default (converted), 3.1 on request', () => {
  const build = (extra) => {
    const app = express();
    const instance = jerant(app, { sourceScan: { enabled: false }, ...extra });
    app.post(
      '/things',
      validate({ body: z.object({ name: z.string().nullable(), kind: z.literal('a'), n: z.number().positive() }) }),
      (req, res) => res.json({})
    );
    return instance.refresh();
  };

  const v30 = build({});
  assert.equal(v30.openapi, '3.0.3');
  const ref30 = v30.paths['/things'].post.requestBody.content['application/json'].schema.$ref;
  const body30 = v30.components.schemas[ref30.split('/').pop()];
  assert.equal(body30.properties.name.nullable, true);
  assert.ok(!Array.isArray(body30.properties.name.type), 'no type arrays in 3.0');
  assert.equal(body30.properties.kind.const, undefined, 'const converted');
  assert.deepEqual(body30.properties.kind.enum, ['a']);
  if (body30.properties.n.exclusiveMinimum !== undefined) {
    assert.equal(typeof body30.properties.n.exclusiveMinimum, 'boolean');
  }

  const v31 = build({ openapi: '3.1' });
  assert.equal(v31.openapi, '3.1.0');
});

test('toOpenApi30 never mutates its input', () => {
  const schema = { type: ['string', 'null'], const: 'x' };
  const spec = { openapi: '3.1.0', info: {}, paths: {}, components: { schemas: { S: schema } } };
  const out = toOpenApi30(spec);
  assert.deepEqual(schema, { type: ['string', 'null'], const: 'x' });
  assert.equal(out.components.schemas.S.nullable, true);
  assert.equal(out.components.schemas.S.type, 'string');
});

test('exclude: strings, method-qualified strings, RegExps and predicates', async (t) => {
  const app = express();
  const instance = jerant(app, {
    sourceScan: { enabled: false },
    exclude: ['/internal/*', 'GET /health', /^\/admin/, (r) => r.path === '/secret'],
  });
  app.get('/internal/metrics', (req, res) => res.json({}));
  app.get('/health', (req, res) => res.json({}));
  app.post('/health', (req, res) => res.json({}));
  app.get('/admin/users', (req, res) => res.json({}));
  app.get('/secret', (req, res) => res.json({}));
  app.get('/users', (req, res) => res.json([]));
  const server = await listen(app);
  t.after(() => server.close());

  await fetch(url(server, '/internal/metrics'));
  await settle();
  assert.equal(instance.registry.get('GET /internal/metrics'), undefined, 'excluded routes are not recorded');

  const spec = instance.refresh();
  assert.deepEqual(Object.keys(spec.paths).sort(), ['/health', '/users']);
  assert.ok(spec.paths['/health'].post && !spec.paths['/health'].get);
});

test('transformSpec edits the served document without corrupting the cache', () => {
  const app = express();
  let calls = 0;
  const instance = jerant(app, {
    sourceScan: { enabled: false },
    transformSpec(spec) {
      calls += 1;
      spec.info.title = 'Transformed';
      for (const item of Object.values(spec.paths)) for (const op of Object.values(item)) op.summary = 'x';
    },
  });
  app.get('/a', validate({ query: z.object({ q: z.string() }) }), (req, res) => res.json({}));
  const s1 = instance.refresh();
  const s2 = instance.refresh();
  assert.equal(s1.info.title, 'Transformed');
  assert.equal(s2.paths['/a'].get.summary, 'x');
  assert.equal(calls, 2);

  const replacing = jerant(express(), { transformSpec: () => ({ openapi: '3.0.3', info: { title: 'R', version: '1' }, paths: {} }) });
  assert.equal(replacing.refresh().info.title, 'R');
});

test('auth: basic credentials protect docs, spec and theme', async (t) => {
  const app = express();
  jerant(app, { auth: { username: 'admin', password: 's3cret' }, sourceScan: { enabled: false } });
  app.get('/open', (req, res) => res.json({ ok: true }));
  const server = await listen(app);
  t.after(() => server.close());

  for (const p of ['/docs', '/openapi.json', '/docs/theme.css']) {
    const denied = await fetch(url(server, p));
    assert.equal(denied.status, 401, `${p} denied`);
    assert.match(denied.headers.get('www-authenticate'), /^Basic realm=/);
  }
  const wrong = await fetch(url(server, '/openapi.json'), {
    headers: { authorization: 'Basic ' + Buffer.from('admin:nope').toString('base64') },
  });
  assert.equal(wrong.status, 401);
  const ok = await fetch(url(server, '/openapi.json'), {
    headers: { authorization: 'Basic ' + Buffer.from('admin:s3cret').toString('base64') },
  });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(url(server, '/open'))).status, 200, 'app routes are untouched');
});

test('auth: a function check receives the native request', async (t) => {
  const app = express();
  jerant(app, { auth: async (req) => req.headers['x-team'] === 'docs', sourceScan: { enabled: false } });
  const server = await listen(app);
  t.after(() => server.close());
  assert.equal((await fetch(url(server, '/openapi.json'))).status, 401);
  assert.equal((await fetch(url(server, '/openapi.json'), { headers: { 'x-team': 'docs' } })).status, 200);
});

test('auth: invalid config is rejected up front', () => {
  assert.throws(() => jerant(express(), { auth: { username: 'x' } }), /auth must be/);
});

test('production mode turns off learning and makes recording cheaper', async () => {
  const app = express();
  const instance = jerant(app, { mode: 'production', sourceScan: { enabled: false } });
  app.post('/unknown', (req, res) => res.json({}));
  assert.equal(instance.options.teachMode, false);
  assert.equal(instance.options.runtime.sampleRate, 0.1);
  const op = instance.refresh().paths['/unknown'].post;
  assert.equal(op['x-jerant'].learning, undefined);

  const server = await listen(app);
  try {
    const html = await (await fetch(url(server, '/docs'))).text();
    assert.ok(html.includes('var LEARNING = false'));
  } finally {
    server.close();
  }

  const overridden = jerant(express(), { mode: 'production', runtime: { sampleRate: 1 }, teachMode: true });
  assert.equal(overridden.options.runtime.sampleRate, 1, 'explicit options win');
  assert.equal(overridden.options.teachMode, true);
});

test('adaptive sampling: well-known routes stop paying for recording', () => {
  const { Registry } = require('../src/registry');
  const registry = new Registry({ adaptive: true, warmup: 10, maxObservations: 100000 });
  let recorded = 0;
  for (let i = 0; i < 5000; i++) {
    if (registry.wants('GET /x')) { registry.record('GET /x', { status: 200, responseBody: { ok: true } }); recorded++; }
  }
  assert.ok(recorded >= 10, 'warmup observations always recorded');
  // Recorded count grows ~sqrt(2 * warmup * n): ~316 of 5000 here, ~4.5k of 1M.
  assert.ok(recorded < 600, `adaptive sampling should record few of 5000 (recorded ${recorded})`);
});

test('examples are only stored when examples: "captured" uses them', async (t) => {
  const app = express();
  const instance = jerant(app, { sourceScan: { enabled: false } });
  app.use(express.json());
  app.post('/e', (req, res) => res.json({ ok: true }));
  const server = await listen(app);
  t.after(() => server.close());
  await fetch(url(server, '/e'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  await settle();
  const entry = instance.registry.get('POST /e');
  assert.equal(entry.observations, 1);
  assert.equal(entry.examples.request.length, 0);
});

test('docs page: one spec download, no auto-open, theme toggle, swaggerUi options', async (t) => {
  const app = express();
  jerant(app, { swaggerUi: { syntaxHighlight: false, docExpansion: 'none', onComplete: () => {} } });
  const server = await listen(app);
  t.after(() => server.close());
  const html = await (await fetch(url(server, '/docs'))).text();

  assert.ok(html.includes('spec: spec'), 'Swagger UI gets the already-fetched spec object');
  assert.ok(!/url:\s*SPEC_URL/.test(html), 'Swagger UI does not download the spec a second time');
  assert.ok(!html.includes('toggle.click()'), 'learning endpoints are not auto-opened');
  assert.ok(html.includes('MutationObserver') && html.includes('requestAnimationFrame'), 'incremental decoration');
  assert.ok(!/querySelectorAll\('\.opblock\[id\$=/.test(html), 'no per-operation document-wide queries');
  assert.ok(html.includes('id="jerant-theme"'), 'theme toggle');
  assert.ok(html.includes('data-theme'), 'theme boot script');
  assert.ok(html.includes('"syntaxHighlight":false'));
  assert.ok(!html.includes('onComplete'), 'functions are dropped (not serializable)');
});

test('theme CSS is exported and served for custom pages', async (t) => {
  assert.ok(themeCss.includes('[data-theme="light"]'));
  assert.ok(themeCss.includes('--bg-0: #000000'), 'dark theme is black');
  assert.ok(themeCss.includes('--bg-0: #ffffff'), 'light theme is white');

  let ctx;
  const app = express();
  jerant(app, { ui: (c) => { ctx = c; return `<style>${c.themeCss}</style>`; } });
  assert.equal(ctx.themeCssPath, '/docs/theme.css');
  const server = await listen(app);
  t.after(() => server.close());
  const res = await fetch(url(server, '/docs/theme.css'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
  assert.equal(await res.text(), themeCss);
});

test('local assets: cached in memory, immutable only for versioned URLs', async (t) => {
  const app = express();
  jerant(app, { assets: 'local' });
  const server = await listen(app);
  t.after(() => server.close());
  const version = require('swagger-ui-dist/package.json').version;

  const html = await (await fetch(url(server, '/docs'))).text();
  assert.ok(html.includes(`/docs/assets/swagger-ui-bundle.js?v=${version}`));

  const bare = await fetch(url(server, '/docs/assets/swagger-ui.css'));
  assert.equal(bare.status, 200);
  assert.ok(!/immutable/.test(bare.headers.get('cache-control')), 'unversioned URL must revalidate');
  assert.ok(bare.headers.get('etag'));

  const versioned = await fetch(url(server, `/docs/assets/swagger-ui.css?v=${version}`));
  assert.match(versioned.headers.get('cache-control'), /immutable/);

  const stale = await fetch(url(server, '/docs/assets/swagger-ui.css?v=0.0.1'));
  assert.ok(!/immutable/.test(stale.headers.get('cache-control')), 'a wrong version is not immutable');

  assert.equal((await fetch(url(server, '/docs/assets/..%2Fpackage.json'))).status, 404);
});

test('large API: 3000 routes build quickly and rebuilds reuse per-route analysis', () => {
  const app = express();
  const instance = jerant(app, {
    defaultResponses: { 401: { description: 'Unauthorized' }, 500: { description: 'Server error' } },
  });
  const router = express.Router();
  for (let i = 0; i < 1000; i++) {
    router.get(`/res${i}/:id`, validate({ params: z.object({ id: z.string() }) }), (req, res) => res.json({ id: req.params.id }));
    router.post(`/res${i}`, validate({ body: z.object({ name: z.string(), n: z.number() }) }), (req, res) => res.json({}));
    router.delete(`/res${i}/:id`, (req, res) => res.status(204).end());
  }
  app.use('/api', router);

  let t0 = process.hrtime.bigint();
  const spec = instance.refresh();
  const first = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(Object.keys(spec.paths).length, 2000);

  t0 = process.hrtime.bigint();
  instance.refresh();
  const second = Number(process.hrtime.bigint() - t0) / 1e6;

  assert.ok(first < 10000, `first build took ${first}ms`);
  assert.ok(second < first, `cached rebuild (${second}ms) should beat the first build (${first}ms)`);
});

test('fastify: spec served with ETag and gzip through the shared server', async (t) => {
  const fastify = require('fastify')();
  jerantFastify(fastify, { auth: { username: 'u', password: 'p' } });
  for (let i = 0; i < 20; i++) fastify.get(`/f${i}`, async () => ({ ok: true }));
  await fastify.listen({ port: 0 });
  t.after(() => fastify.close());
  const base = `http://127.0.0.1:${fastify.server.address().port}`;
  const auth = 'Basic ' + Buffer.from('u:p').toString('base64');

  assert.equal((await fetch(`${base}/openapi.json`)).status, 401);
  const res = await fetch(`${base}/openapi.json`, { headers: { authorization: auth } });
  assert.equal(res.status, 200);
  const etag = res.headers.get('etag');
  assert.ok(etag);
  assert.ok((await res.json()).paths['/f0']);
  const again = await fetch(`${base}/openapi.json`, { headers: { authorization: auth, 'if-none-match': etag } });
  assert.equal(again.status, 304);
});

test('file store: scheduled saves are written asynchronously and coalesced', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jerant-async-'));
  const file = path.join(dir, 'data.json');
  const store = new FileStore(file, { debounceMs: 5 });
  let n = 0;
  await Promise.all([store.writeAsync(() => ({ n: ++n })), store.writeAsync(() => ({ n: ++n }))]);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 2 }, 'second request coalesced into a follow-up write');
  store.scheduleSave(() => ({ n: 'scheduled' }));
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 'scheduled' });
  assert.deepEqual(fs.readdirSync(dir), ['data.json'], 'no tmp files left behind');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
