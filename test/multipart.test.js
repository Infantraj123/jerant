'use strict';

// Form-data vs raw JSON: routes with upload middleware must be documented
// as multipart/form-data (with binary file fields), JSON routes as
// application/json.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const multer = require('multer');
const Joi = require('joi');

const { jerant, validate, doc } = require('../src/index');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('multipart routes are distinguished from raw JSON routes', async (t) => {
  const app = express();
  jerant(app);
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage() });

  // 1. Upload route: multer + Joi schema for the text fields
  app.post(
    '/enrollments',
    upload.fields([{ name: 'document', maxCount: 1 }, { name: 'license', maxCount: 1 }]),
    validate({ body: Joi.object({ provider_name: Joi.string().required() }) }),
    (req, res) => res.status(201).json({ ok: true, files: Object.keys(req.files || {}) })
  );

  // 2. Upload route documented explicitly, no traffic needed
  app.post(
    '/avatars',
    upload.single('avatar'),
    doc({ contentType: 'multipart/form-data', files: ['avatar'] }),
    (req, res) => res.json({ ok: true })
  );

  // 3. Plain raw-JSON route for contrast
  app.post(
    '/notes',
    validate({ body: Joi.object({ text: Joi.string().required() }) }),
    (req, res) => res.json({ ok: true })
  );

  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  // Send a real multipart request so runtime learns the file fields too.
  const form = new FormData();
  form.append('provider_name', 'Dr. Smith');
  form.append('document', new Blob(['fake-pdf'], { type: 'application/pdf' }), 'doc.pdf');
  const uploadRes = await fetch(`${base}/enrollments`, { method: 'POST', body: form });
  assert.equal(uploadRes.status, 201);
  await new Promise((r) => setTimeout(r, 50));

  const spec = await (await fetch(`${base}/openapi.json`)).json();

  // --- Route 1: multipart detected from multer, schema = Joi fields + binary files
  const enroll = spec.paths['/enrollments'].post;
  const enrollContent = enroll.requestBody.content;
  assert.ok(enrollContent['multipart/form-data'], 'documented as form-data');
  assert.ok(!enrollContent['application/json'], 'not documented as raw JSON');
  let schema = enrollContent['multipart/form-data'].schema;
  if (schema.$ref) schema = spec.components.schemas[schema.$ref.split('/').pop()];
  assert.equal(schema.properties.provider_name.type, 'string', 'Joi text field present');
  // 'document' observed at runtime; 'license' declared in multer but unobserved (multer hides it)
  assert.deepEqual(schema.properties.document, { type: 'string', format: 'binary' });

  // --- Route 2: multipart via explicit doc(), zero traffic
  const avatars = spec.paths['/avatars'].post;
  const avatarContent = avatars.requestBody.content;
  assert.ok(avatarContent['multipart/form-data']);
  let avatarSchema = avatarContent['multipart/form-data'].schema;
  if (avatarSchema.$ref) avatarSchema = spec.components.schemas[avatarSchema.$ref.split('/').pop()];
  assert.deepEqual(avatarSchema.properties.avatar, { type: 'string', format: 'binary' });

  // --- Route 3: stays raw JSON
  const notes = spec.paths['/notes'].post;
  assert.ok(notes.requestBody.content['application/json']);
  assert.ok(!notes.requestBody.content['multipart/form-data']);
});

test('generic req.file placeholder gives way to the observed field name', async (t) => {
  const app = express();
  // Source scan off: this covers the bundled-app case where only the live
  // function objects (and runtime traffic) are available.
  const instance = jerant(app, { sourceScan: { enabled: false } });
  const upload = multer({ storage: multer.memoryStorage() });
  app.post('/reports', upload.single('report'), (req, res) =>
    res.json({ ok: true, name: req.file && req.file.originalname })
  );

  // Before traffic: only the closure hides the field name, so document 'file'.
  let schema = instance.getSpec().paths['/reports'].post.requestBody
    .content['multipart/form-data'].schema;
  if (schema.$ref) schema = instance.getSpec().components.schemas[schema.$ref.split('/').pop()];
  assert.deepEqual(schema.properties.file, { type: 'string', format: 'binary' });

  const server = await listen(app);
  t.after(() => server.close());
  const form = new FormData();
  form.append('report', new Blob(['x'], { type: 'text/plain' }), 'r.txt');
  const res = await fetch(`http://127.0.0.1:${server.address().port}/reports`, {
    method: 'POST',
    body: form,
  });
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 50));

  // After traffic: the real field name replaces the placeholder.
  const spec = instance.refresh();
  schema = spec.paths['/reports'].post.requestBody.content['multipart/form-data'].schema;
  if (schema.$ref) schema = spec.components.schemas[schema.$ref.split('/').pop()];
  assert.deepEqual(schema.properties.report, { type: 'string', format: 'binary' });
  assert.ok(!schema.properties.file, 'generic placeholder removed once the name is known');
});

test('multer-only route (no schema, no traffic) still shows form-data', async (t) => {
  const app = express();
  const instance = jerant(app);
  const upload = multer({ storage: multer.memoryStorage() });
  app.post('/upload', upload.single('file'), (req, res) => res.json({ ok: true }));

  const spec = instance.getSpec();
  const op = spec.paths['/upload'].post;
  assert.ok(op.requestBody, 'requestBody present from static multer detection');
  assert.ok(op.requestBody.content['multipart/form-data']);
});
