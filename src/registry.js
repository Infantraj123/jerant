'use strict';

// Metadata registry: holds everything learned from live traffic, keyed by
// "METHOD /path". Validation schemas are not stored here — they are
// re-detected from route handlers at spec-build time so they can never go
// stale. Runtime data is plain JSON, so persistence is a straight dump.

const { createNode, observe } = require('./inference');
const { redact } = require('./redact');
const { roughSize, jsonClone } = require('./util');

const DEFAULTS = {
  maxObservations: 1000,
  maxExamples: 3,
  maxBodyBytes: 100 * 1024,
  redactKeys: [],
};

function createRouteEntry() {
  return {
    body: createNode(),
    query: createNode(),
    params: createNode(),
    responses: {}, // status -> node
    examples: { request: [], response: {} }, // response: status -> [examples]
    observations: 0,
  };
}

class Registry {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.runtime = new Map();
    this.version = 0;
  }

  entry(key) {
    let entry = this.runtime.get(key);
    if (!entry) {
      entry = createRouteEntry();
      this.runtime.set(key, entry);
    }
    return entry;
  }

  /**
   * Record one observed request/response cycle. All inputs are redacted
   * before anything is stored. Called off the request path (setImmediate).
   */
  record(key, sample) {
    const { maxObservations, maxExamples, maxBodyBytes, redactKeys } = this.options;
    const entry = this.entry(key);
    if (entry.observations >= maxObservations) return;

    const body = sanitize(sample.body, redactKeys, maxBodyBytes);
    const query = sanitize(sample.query, redactKeys, maxBodyBytes);
    const params = sanitize(sample.params, redactKeys, maxBodyBytes);
    const responseBody = sanitize(sample.responseBody, redactKeys, maxBodyBytes);
    const status = String(sample.status || 200);

    if (body !== undefined && hasContent(body)) observe(entry.body, body);
    if (query !== undefined && hasContent(query)) observe(entry.query, query);
    if (params !== undefined && hasContent(params)) observe(entry.params, params);
    if (responseBody !== undefined) {
      if (!entry.responses[status]) entry.responses[status] = createNode();
      observe(entry.responses[status], responseBody);
    }

    if (body !== undefined && hasContent(body) && entry.examples.request.length < maxExamples) {
      entry.examples.request.push(body);
    }
    if (responseBody !== undefined) {
      if (!entry.examples.response[status]) entry.examples.response[status] = [];
      if (entry.examples.response[status].length < maxExamples) {
        entry.examples.response[status].push(responseBody);
      }
    }

    entry.observations += 1;
    this.version += 1;
  }

  get(key) {
    return this.runtime.get(key);
  }

  toJSON() {
    const routes = {};
    for (const [key, entry] of this.runtime) routes[key] = entry;
    return { formatVersion: 1, savedAt: new Date().toISOString(), routes };
  }

  loadJSON(data) {
    if (!data || data.formatVersion !== 1 || typeof data.routes !== 'object') return;
    for (const [key, entry] of Object.entries(data.routes || {})) {
      if (entry && typeof entry === 'object' && typeof entry.observations === 'number') {
        this.runtime.set(key, entry);
      }
    }
    this.version += 1;
  }
}

function hasContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function sanitize(value, redactKeys, maxBytes) {
  if (value === undefined) return undefined;
  if (roughSize(value, maxBytes) > maxBytes) return undefined;
  // jsonClone also protects against payloads the app mutates after res.json().
  return jsonClone(redact(value, redactKeys));
}

module.exports = { Registry };
