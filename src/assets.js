'use strict';

// Self-hosted UI assets: serves swagger-ui-dist from node_modules under
// `${docsPath}/assets/*` so the docs work offline and under strict CSPs.
// Only an allowlisted set of file names is ever readable — no traversal.

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

function resolveDistDir() {
  try {
    return path.dirname(require.resolve('swagger-ui-dist/package.json'));
  } catch {
    return null;
  }
}

/** Express handler for GET `${docsPath}/assets/:file`. */
function createAssetsHandler() {
  const distDir = resolveDistDir();

  const handler = (req, res) => {
    const file = req.params.file;
    if (!distDir) {
      return res.status(500).type('text').send(
        'jerant: assets: "local" requires the swagger-ui-dist package — npm install swagger-ui-dist'
      );
    }
    if (!file || !ALLOWED_FILES.has(file)) {
      return res.status(404).type('text').send('Not found');
    }
    const fullPath = path.join(distDir, file);
    fs.readFile(fullPath, (err, data) => {
      if (err) return res.status(404).type('text').send('Not found');
      res.set('Content-Type', CONTENT_TYPES[path.extname(file)] || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.send(data);
    });
  };
  handler.__jerantInternal = true;
  return handler;
}

module.exports = { createAssetsHandler };
