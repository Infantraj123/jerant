'use strict';

/**
 * Normalize an Express-style path: single leading slash, no duplicate
 * slashes, no trailing slash (except root).
 */
function normalizePath(p) {
  let out = String(p || '/');
  if (!out.startsWith('/')) out = '/' + out;
  out = out.replace(/\/{2,}/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function joinPaths(prefix, p) {
  return normalizePath(`${prefix || ''}/${p || ''}`);
}

/** Deep clone via JSON round-trip. Drops functions/undefined, which is
 * what we want for anything headed into an OpenAPI document. */
function jsonClone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Approximate byte size of a value without fully serializing huge payloads. */
function roughSize(value, budget = Infinity, depth = 0) {
  if (value === null || value === undefined) return 4;
  const t = typeof value;
  if (t === 'string') return value.length + 2;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return 8;
  if (depth > 8) return 16;
  let size = 2;
  if (Array.isArray(value)) {
    for (const item of value) {
      size += roughSize(item, budget, depth + 1) + 1;
      if (size > budget) return size;
    }
    return size;
  }
  if (t === 'object') {
    for (const key of Object.keys(value)) {
      size += key.length + 4 + roughSize(value[key], budget, depth + 1);
      if (size > budget) return size;
    }
    return size;
  }
  return 8;
}

function pascalCase(str) {
  return String(str)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}

module.exports = {
  normalizePath,
  joinPaths,
  jsonClone,
  escapeHtml,
  isPlainObject,
  roughSize,
  pascalCase,
};
