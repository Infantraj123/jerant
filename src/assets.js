'use strict';

// Self-hosted UI assets: serves swagger-ui-dist from node_modules under
// `${docsPath}/assets/*` so the docs work offline and under strict CSPs.
// Only an allowlisted set of file names is ever readable — no traversal.
//
// Files are read once and kept in memory (with ETag + compressed variants).
// The docs page links them as `...?v=<swagger-ui-dist version>`; only such
// versioned URLs are cached as immutable — a bare URL must revalidate,
// because its content changes when swagger-ui-dist is upgraded.

const fs = require('fs');
const path = require('path');

const ALLOWED_FILES = new Set([
  'swagger-ui.css',
  'swagger-ui.css.map',
  'swagger-ui-bundle.js',
  'swagger-ui-bundle.js.map',
  'swagger-ui-standalone-preset.js',
  'swagger-ui-standalone-preset.js.map',
  'oauth2-redirect.html',
  'favicon-16x16.png',
  'favicon-32x32.png',
]);

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=0, must-revalidate';

function resolveDist() {
  try {
    const pkgFile = require.resolve('swagger-ui-dist/package.json');
    const version = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version || null;
    return { dir: path.dirname(pkgFile), version };
  } catch {
    return null;
  }
}

/** swagger-ui-dist version used to fingerprint asset URLs (null if absent). */
function assetVersion() {
  const dist = resolveDist();
  return dist ? dist.version : null;
}

function createAssetsService() {
  // Lazy-required to avoid a circular import (serve.js requires us).
  const { Resource } = require('./serve');
  const dist = resolveDist();
  const cache = new Map(); // `${file}|${immutable}` -> Promise<Resource|null>

  return {
    version: dist ? dist.version : null,
    /** Resource for an allowlisted file, null when unknown, {error} when the package is missing. */
    get(file, requestedVersion) {
      if (!dist) {
        return {
          status: 500,
          error: 'jerant: assets: "local" requires the swagger-ui-dist package — npm install swagger-ui-dist',
        };
      }
      if (!file || !ALLOWED_FILES.has(file)) return null;
      const immutable = !!requestedVersion && requestedVersion === dist.version;
      const key = `${file}|${immutable}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = fs.promises.readFile(path.join(dist.dir, file)).then(
          (data) => new Resource(
            data,
            CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
            immutable ? IMMUTABLE : REVALIDATE
          ),
          () => { cache.delete(key); return null; }
        );
        cache.set(key, pending);
      }
      return pending;
    },
  };
}

module.exports = { createAssetsService, assetVersion, ALLOWED_FILES };
