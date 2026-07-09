'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { redact, REDACTED } = require('../src/redact');

test('redacts sensitive keys at any depth', () => {
  const out = redact({
    name: 'John',
    password: 'hunter2',
    nested: { apiKey: 'abc123', profile: { access_token: 'tok', bio: 'hi' } },
  });
  assert.equal(out.name, 'John');
  assert.equal(out.password, REDACTED);
  assert.equal(out.nested.apiKey, REDACTED);
  assert.equal(out.nested.profile.access_token, REDACTED);
  assert.equal(out.nested.profile.bio, 'hi');
});

test('redacts key variants regardless of separators and case', () => {
  const out = redact({ 'API-KEY': 'x', Client_Secret: 'y', SessionId: 'z', creditCardNumber: 'n' });
  assert.equal(out['API-KEY'], REDACTED);
  assert.equal(out.Client_Secret, REDACTED);
  assert.equal(out.SessionId, REDACTED);
  assert.equal(out.creditCardNumber, REDACTED);
});

test('redacts credential-shaped values under innocent keys', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM';
  const out = redact({ header: `Bearer ${jwt}`, note: jwt, plain: 'hello' });
  assert.equal(out.header, REDACTED);
  assert.equal(out.note, REDACTED);
  assert.equal(out.plain, 'hello');
});

test('supports custom redact keys and never mutates input', () => {
  const input = { internalCode: 'x-99', ok: true };
  const out = redact(input, ['internal_code']);
  assert.equal(out.internalCode, REDACTED);
  assert.equal(input.internalCode, 'x-99');
});

test('redacts inside arrays', () => {
  const out = redact([{ token: 'a' }, { token: 'b', v: 1 }]);
  assert.equal(out[0].token, REDACTED);
  assert.equal(out[1].token, REDACTED);
  assert.equal(out[1].v, 1);
});
