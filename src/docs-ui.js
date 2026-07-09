'use strict';

const { escapeHtml } = require('./util');

/**
 * Render the /docs HTML page: Swagger UI (assets from a configurable CDN)
 * pointed at the app's own /openapi.json, with endpoint search enabled.
 */
function renderDocsPage(opts) {
  const title = escapeHtml(opts.title || 'API Documentation');
  const cdn = escapeHtml(opts.cdn);
  const specUrl = escapeHtml(opts.openapiPath);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — API Docs</title>
  <link rel="stylesheet" href="${cdn}/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .jerant-topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 20px; background: #1b1b1f; color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .jerant-topbar .name { font-weight: 600; font-size: 15px; }
    .jerant-topbar .name span { color: #7ee787; }
    .jerant-topbar a { color: #9ecbff; font-size: 13px; text-decoration: none; }
    .jerant-topbar a:hover { text-decoration: underline; }
    .swagger-ui .info { margin: 24px 0; }
  </style>
</head>
<body>
  <div class="jerant-topbar">
    <div class="name">${title} <span>&middot; jerant</span></div>
    <a href="${specUrl}">openapi.json</a>
  </div>
  <div id="swagger-ui"></div>
  <script src="${cdn}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.addEventListener('load', function () {
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(opts.openapiPath)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        filter: true,
        tryItOutEnabled: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout'
      });
    });
  </script>
</body>
</html>`;
}

module.exports = { renderDocsPage };
