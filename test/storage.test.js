'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { FileStore } = require('../src/storage/file');
const { Registry } = require('../src/registry');
const { REDACTED } = require('../src/redact');

test('file store round-trips registry data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jerant-test-'));
  const file = path.join(dir, 'data.json');

  const registry = new Registry();
  registry.record('POST /users', {
    body: { name: 'John', password: 'hunter2' },
    query: {},
    params: {},
    status: 201,
    responseBody: { id: 1, name: 'John' },
  });

  const store = new FileStore(file);
  store.flush(() => registry.toJSON());
  store.close();

  const revived = new Registry();
  revived.loadJSON(new FileStore(file).load());
  const entry = revived.get('POST /users');
  assert.equal(entry.observations, 1);
  // Secrets were redacted before hitting disk.
  assert.equal(entry.examples.request[0].password, REDACTED);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('hunter2'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('registry caps observations and examples', () => {
  const registry = new Registry({ maxObservations: 5, maxExamples: 2 });
  for (let i = 0; i < 10; i++) {
    registry.record('GET /x', { body: { i }, status: 200, responseBody: { ok: true } });
  }
  const entry = registry.get('GET /x');
  assert.equal(entry.observations, 5);
  assert.equal(entry.examples.request.length, 2);
  assert.equal(entry.examples.response['200'].length, 2);
});

test('registry skips oversized payloads but still counts the response', () => {
  const registry = new Registry({ maxBodyBytes: 64 });
  registry.record('POST /big', {
    body: { blob: 'x'.repeat(10_000) },
    status: 200,
    responseBody: { ok: true },
  });
  const entry = registry.get('POST /big');
  assert.equal(entry.body.count, 0);
  assert.equal(entry.responses['200'].count, 1);
});
