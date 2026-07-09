'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { analyzeHandles } = require('../src/static-analysis');
const { jerant } = require('../src/index');

test('extracts body fields: direct access, destructuring, aliases, brackets', () => {
  const handler = (req, res) => {
    const { name, email: userEmail, age = 18 } = req.body;
    const data = req.body;
    const city = data.city;
    const zip = req.body['postal_code'];
    if (req.body.notes) res.status(201).json({ name, userEmail, age, city, zip });
    else res.status(400).json({ error: 'bad' });
  };
  const found = analyzeHandles([handler]);
  assert.deepEqual(
    found.bodyFields.sort(),
    ['age', 'city', 'email', 'name', 'notes', 'postal_code']
  );
  assert.deepEqual(found.statusCodes.sort(), ['201', '400']);
});

test('extracts query and params fields and file usage', () => {
  const handler = (req, res) => {
    const page = req.query.page;
    const { search, limit } = req.query;
    const id = req.params.id;
    const doc = req.files.document;
    const license = req.files['license_file'];
    res.json({ page, search, limit, id, ok: !!doc && !!license });
  };
  const found = analyzeHandles([handler]);
  assert.deepEqual(found.queryFields.sort(), ['limit', 'page', 'search']);
  assert.deepEqual(found.paramsFields, ['id']);
  assert.deepEqual(found.fileFields.sort(), ['document', 'license_file']);
  assert.equal(found.usesFiles, true);
});

test('req.file alone marks multipart with a generic file field', () => {
  const handler = (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({ size: req.file.size });
  };
  const found = analyzeHandles([handler]);
  assert.equal(found.usesFiles, true);
  assert.ok(found.fileFields.includes('file'));
});

test('ignores noise: prototype methods, internal handlers, unrelated objects', () => {
  const handler = (req, res) => {
    const keys = Object.keys(req.body); // no fields readable here
    something.body.fake; // not req.body
    res.json({ n: keys.length });
  };
  const internal = (req, res, next) => { req.body.leaked; next(); };
  internal.__jerantInternal = true;
  const found = analyzeHandles([handler, internal]);
  assert.deepEqual(found.bodyFields, []);
});

test('e2e: unvalidated, traffic-less routes get documented from handler code', async () => {
  const app = express();
  const instance = jerant(app);
  app.use(express.json());

  // Legacy JSON route: fields only exist in handler code
  app.post('/payments', (req, res) => {
    const { amount, currency } = req.body;
    if (!amount) return res.status(422).json({ error: 'amount required' });
    res.status(201).json({ id: 'p_1', amount, currency });
  });

  // Legacy upload route: multipart only visible via req.files usage
  app.post('/import', (req, res) => {
    const sheet = req.files.spreadsheet;
    const mode = req.query.mode;
    res.json({ ok: !!sheet, mode });
  });

  const spec = instance.getSpec();

  const payments = spec.paths['/payments'].post;
  assert.equal(payments['x-jerant'].source, 'code-analysis');
  assert.equal(payments['x-jerant'].confidence, 55);
  let schema = payments.requestBody.content['application/json'].schema;
  if (schema.$ref) schema = spec.components.schemas[schema.$ref.split('/').pop()];
  assert.deepEqual(Object.keys(schema.properties).sort(), ['amount', 'currency']);
  assert.ok(payments.responses['201'], 'status detected from code');
  assert.ok(payments.responses['422'], 'error status detected from code');

  const imp = spec.paths['/import'].post;
  assert.ok(imp.requestBody.content['multipart/form-data'], 'form-data inferred from req.files');
  let impSchema = imp.requestBody.content['multipart/form-data'].schema;
  if (impSchema.$ref) impSchema = spec.components.schemas[impSchema.$ref.split('/').pop()];
  assert.deepEqual(impSchema.properties.spreadsheet, { type: 'string', format: 'binary' });
  const queryParam = (imp.parameters || []).find((p) => p.in === 'query');
  assert.equal(queryParam && queryParam.name, 'mode');
});

test('e2e: code-analysis fields merge into runtime observations', async (t) => {
  const app = express();
  jerant(app);
  app.use(express.json());
  app.post('/orders', (req, res) => {
    // Handler also reads a field traffic never sent
    const coupon = req.body.coupon_code;
    res.json({ sku: req.body.sku, coupon });
  });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());

  await fetch(`http://127.0.0.1:${server.address().port}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'A1' }),
  });
  await new Promise((r) => setTimeout(r, 50));

  const spec = await (await fetch(`http://127.0.0.1:${server.address().port}/openapi.json`)).json();
  const op = spec.paths['/orders'].post;
  assert.equal(op['x-jerant'].sources.body, 'runtime + code-analysis');
  let schema = op.requestBody.content['application/json'].schema;
  if (schema.$ref) schema = spec.components.schemas[schema.$ref.split('/').pop()];
  assert.equal(schema.properties.sku.type, 'string', 'observed field is typed');
  assert.ok('coupon_code' in schema.properties, 'code-only field still documented');
});
