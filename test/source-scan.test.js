'use strict';

// Project source scan: documenting a project that uses NO validation library,
// where the interesting facts live only in the source files — wrapped
// handlers, multer field config, controllers referenced by name.

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const { jerant } = require('../src/index');
const { loadSourceIndex, scanRouteSource, clearSourceScanCache } = require('../src/source-scan');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'scan-app');

function fixtureSpec() {
  const { createApp } = require('./fixtures/scan-app/app');
  const app = createApp();
  const instance = jerant(app, { sourceScan: { dir: FIXTURE_DIR } });
  return instance.getSpec();
}

function resolveSchema(spec, op, contentType) {
  let schema = op.requestBody.content[contentType].schema;
  if (schema.$ref) schema = spec.components.schemas[schema.$ref.split('/').pop()];
  return schema;
}

test('scan finds fields of controllers referenced by name', () => {
  clearSourceScanCache();
  const index = loadSourceIndex({ dir: FIXTURE_DIR });
  const found = scanRouteSource(index, 'POST', '/api/users');
  assert.deepEqual(found.bodyFields.sort(), ['email', 'password', 'role']);
  assert.deepEqual(found.statusCodes.sort(), ['201', '422']);
});

test('scan sees through wrapper closures (asyncHandler)', () => {
  const index = loadSourceIndex({ dir: FIXTURE_DIR });
  const found = scanRouteSource(index, 'PATCH', '/api/users/:id');
  assert.deepEqual(found.bodyFields.sort(), ['bio', 'displayName']);
});

test('scan recovers multer field names from route config', () => {
  const index = loadSourceIndex({ dir: FIXTURE_DIR });
  const kyc = scanRouteSource(index, 'POST', '/api/uploads/kyc');
  assert.equal(kyc.multipart, true);
  assert.deepEqual(kyc.fileFields.sort(), ['id_back', 'id_front']);

  const gallery = scanRouteSource(index, 'POST', '/api/uploads/gallery');
  assert.deepEqual(gallery.fileFields, ['photos']);

  const avatar = scanRouteSource(index, 'POST', '/api/uploads/avatar');
  assert.deepEqual(avatar.fileFields, ['avatar']);
});

test('e2e: validation-free project is documented from its source files', () => {
  const spec = fixtureSpec();

  // Wrapped inline handler: fields recovered from the route file text.
  const patch = spec.paths['/api/users/{id}'].patch;
  const patchSchema = resolveSchema(spec, patch, 'application/json');
  assert.deepEqual(Object.keys(patchSchema.properties).sort(), ['bio', 'displayName']);
  assert.equal(patch['x-jerant'].source, 'code-analysis');

  // Named controller: body fields and both status codes, plus implicit 200
  // is NOT added because the handler declares 201.
  const create = spec.paths['/api/users'].post;
  const createSchema = resolveSchema(spec, create, 'application/json');
  assert.deepEqual(Object.keys(createSchema.properties).sort(), ['email', 'password', 'role']);
  assert.deepEqual(Object.keys(create.responses).sort(), ['201', '422']);

  // Handler with only res.status(404): implicit 200 success path kept.
  const getOne = spec.paths['/api/users/{id}'].get;
  assert.deepEqual(Object.keys(getOne.responses).sort(), ['200', '404']);

  // Multer .fields() config: multipart with the real binary field names.
  const kyc = spec.paths['/api/uploads/kyc'].post;
  const kycSchema = resolveSchema(spec, kyc, 'multipart/form-data');
  assert.deepEqual(kycSchema.properties.id_front, { type: 'string', format: 'binary' });
  assert.deepEqual(kycSchema.properties.id_back, { type: 'string', format: 'binary' });

  // Multer .single(): the real name replaces the generic req.file guess.
  const avatar = spec.paths['/api/uploads/avatar'].post;
  const avatarSchema = resolveSchema(spec, avatar, 'multipart/form-data');
  assert.deepEqual(avatarSchema.properties.avatar, { type: 'string', format: 'binary' });
  assert.ok(!avatarSchema.properties.file, 'generic placeholder replaced by configured name');
  assert.equal(typeof avatarSchema.properties.caption, 'object', 'text field from handler code');

  // Multer .array()
  const gallery = spec.paths['/api/uploads/gallery'].post;
  const gallerySchema = resolveSchema(spec, gallery, 'multipart/form-data');
  assert.deepEqual(gallerySchema.properties.photos, { type: 'string', format: 'binary' });
});

test('payload flow: fields discovered at the SQL insert in the service layer', () => {
  const index = loadSourceIndex({ dir: FIXTURE_DIR });
  // handler -> orders.insertOrder(req.body) -> INSERT INTO orders (...)
  const found = scanRouteSource(index, 'POST', '/api/orders');
  assert.deepEqual(found.bodyFields.sort(), ['coupon_code', 'customer_id', 'items']);
  assert.deepEqual(found.statusCodes, ['201']);
});

test('payload flow: fields discovered at a query-builder update object', () => {
  const index = loadSourceIndex({ dir: FIXTURE_DIR });
  // handler -> orders.reviseOrder(id, req.body) -> .update({status, notes, updated_at})
  const found = scanRouteSource(index, 'PUT', '/api/orders/:id');
  assert.ok(found.bodyFields.includes('status'));
  assert.ok(found.bodyFields.includes('notes'));
  assert.ok(
    !found.bodyFields.includes('updated_at'),
    'columns not read from the payload are not request fields'
  );
});

test('scan is off when disabled and ambiguous root paths are skipped', () => {
  clearSourceScanCache();
  assert.equal(loadSourceIndex({ enabled: false }), null);

  const index = loadSourceIndex({ dir: FIXTURE_DIR });
  // '/nope' exists nowhere.
  assert.equal(scanRouteSource(index, 'GET', '/nope'), null);
});
