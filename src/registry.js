'use strict';

// Metadata registry: holds everything learned from live traffic, keyed by
// "METHOD /path". Validation schemas are not stored here — they are
// re-detected from route handlers at spec-build time so they can never go
// stale. Runtime data is plain JSON, so persistence is a straight dump.

const { createNode, observe } = require('./inference');
const { redactInPlace, compileRedactKeys } = require('./redact');

const DEFAULTS = {
  maxObservations: 1000,
  maxExamples: 3,
  maxBodyBytes: 100 * 1024,
  redactKeys: [],
  // Store example payloads (only shown with examples: 'captured').
  keepExamples: true,
  // Adaptive sampling: after `warmup` observations a route records further
  // requests with probability warmup / observations.
  adaptive: false,
  warmup: 50,
};

function createRouteEntry() {
  return {
    body: createNode(),
    query: createNode(),
    params: createNode(),
    responses: {}, // status -> node
    examples: { request: [], response: {} }, // response: status -> [examples]
    contentTypes: {}, // request media type -> count
    fileFields: {}, // multipart file field name -> count
    observations: 0,
  };
}

class Registry {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.runtime = new Map();
    this.version = 0;
    this.redactSet = compileRedactKeys(this.options.redactKeys);
  }

  /**
   * Cheap pre-check, callable on the request path: false when this route
   * has learned enough that the sample would be thrown away anyway.
   */
  wants(key) {
    const entry = this.runtime.get(key);
    if (!entry) return true;
    const { maxObservations, adaptive, warmup } = this.options;
    if (entry.observations >= maxObservations) return false;
    if (adaptive && entry.observations >= warmup && Math.random() * entry.observations >= warmup) return false;
    return true;
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
    const { maxObservations, maxBodyBytes, keepExamples } = this.options;
    const maxExamples = keepExamples ? this.options.maxExamples : 0;
    const redactKeys = this.redactSet;
    const entry = this.entry(key);
    if (entry.observations >= maxObservations) return;

    const body = sanitize(sample.body, redactKeys, maxBodyBytes);
    const query = sanitize(sample.query, redactKeys, maxBodyBytes);
    const params = sanitize(sample.params, redactKeys, maxBodyBytes);
    const responseBody = sanitize(sample.responseBody, redactKeys, maxBodyBytes);
    const status = String(sample.status || 200);

    if (sample.contentType && /^[\w.+-]+\/[\w.+-]+$/.test(sample.contentType)) {
      if (!entry.contentTypes) entry.contentTypes = {};
      entry.contentTypes[sample.contentType] = (entry.contentTypes[sample.contentType] || 0) + 1;
    }
    if (Array.isArray(sample.fileFields)) {
      if (!entry.fileFields) entry.fileFields = {};
      for (const field of sample.fileFields.slice(0, 20)) {
        if (typeof field === 'string' && field) {
          entry.fileFields[field] = (entry.fileFields[field] || 0) + 1;
        }
      }
    }

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
      if (maxExamples && !entry.examples.response[status]) entry.examples.response[status] = [];
      if (maxExamples && entry.examples.response[status].length < maxExamples) {
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

/**
 * One serialization pass does three jobs: honors toJSON (Dates, ORM
 * documents), measures the payload against maxBytes, and yields a private
 * copy (safe from later mutation by the app) that is then redacted in place.
 */
function sanitize(value, redactKeys, maxBytes) {
  if (value === undefined) return undefined;
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    return undefined; // circular / BigInt payloads are skipped
  }
  if (text === undefined || text.length > maxBytes) return undefined;
  return redactInPlace(JSON.parse(text), redactKeys);
}

module.exports = { Registry };
