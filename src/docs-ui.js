'use strict';

const { escapeHtml } = require('./util');

// UI asset sources when opts.cdn is left at its swagger-ui default.
const REDOC_CDN = 'https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js';
const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';

// Dark purple/lavender theme tokens. Method badge hues validated for the
// dark surface (OKLCH lightness band, chroma floor, CVD separation, ≥3:1
// contrast) — method identity is never color-alone: every badge carries its
// text label.
const THEME_CSS = `
    :root {
      --bg-0: #0f0d17;          /* page */
      --bg-1: #171326;          /* panels */
      --bg-2: #1f1a33;          /* raised */
      --bg-3: #282041;          /* hover */
      --border: #2b2344;
      --border-strong: #3b3060;
      --text-1: #ece8f8;
      --text-2: #a89fc7;
      --text-3: #7d739e;
      --accent: #8b5cf6;        /* purple */
      --accent-2: #a78bfa;      /* lavender */
      --accent-3: #c4b5fd;      /* light lavender */
      --accent-soft: rgba(139, 92, 246, 0.14);
      --get: #8b5cf6;
      --post: #10a877;
      --put: #c98500;
      --patch: #0e9db5;
      --delete: #e0447a;
      --neutral-method: #5f5680;
      --good: #10a877;
      --warn: #c98500;
      --bad: #e0447a;
      --radius: 10px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body { margin: 0; background: var(--bg-0); color: var(--text-1); font-family: var(--font); }
    ::selection { background: rgba(167, 139, 250, 0.35); }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: var(--bg-0); }
    ::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 6px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }

    /* --- Header --- */
    .jerant-header {
      background: linear-gradient(135deg, #191033 0%, #241543 55%, #2d1a52 100%);
      border-bottom: 1px solid var(--border-strong);
      padding: 22px 28px 18px;
    }
    .jerant-header .row {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      max-width: 1460px; margin: 0 auto;
    }
    .jerant-header .brand { display: flex; align-items: baseline; gap: 10px; margin-right: auto; }
    .jerant-header .title { font-size: 20px; font-weight: 700; letter-spacing: -0.2px; }
    .jerant-header .title .by {
      color: var(--accent-3); font-weight: 600; font-size: 12px;
      background: var(--accent-soft); border: 1px solid var(--border-strong);
      padding: 2px 8px; border-radius: 999px; margin-left: 8px; vertical-align: 2px;
    }
    .jerant-header .version {
      font-family: var(--mono); font-size: 12px; color: var(--accent-3);
      border: 1px solid var(--border-strong); border-radius: 999px; padding: 2px 9px;
      background: rgba(139, 92, 246, 0.10);
    }
    .jerant-actions { display: flex; gap: 8px; }
    .jerant-btn {
      appearance: none; border: 1px solid var(--border-strong); background: var(--bg-2);
      color: var(--text-1); font: 600 12.5px var(--font); padding: 7px 13px;
      border-radius: 8px; cursor: pointer; transition: background .15s, border-color .15s;
      text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
    }
    .jerant-btn:hover { background: var(--bg-3); border-color: var(--accent); }
    .jerant-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .jerant-btn.primary:hover { background: var(--accent-2); border-color: var(--accent-2); }

    /* --- Stat tiles (label + value; values wear text tokens) --- */
    .jerant-stats {
      display: flex; gap: 10px; flex-wrap: wrap;
      max-width: 1460px; margin: 16px auto 0;
    }
    .jerant-tile {
      background: rgba(23, 19, 38, 0.72); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 10px 16px; min-width: 118px;
    }
    .jerant-tile .label { font-size: 11px; color: var(--text-2); letter-spacing: .2px; }
    .jerant-tile .value { font-size: 20px; font-weight: 600; color: var(--text-1); margin-top: 2px; }
    .jerant-tile .value .unit { font-size: 12px; color: var(--text-3); font-weight: 500; }
    .jerant-tile.warn .value { color: var(--warn); }
    .jerant-tile .sub { font-size: 11px; color: var(--text-3); margin-top: 1px; }

    /* --- Swagger UI: base + typography --- */
    #swagger-ui { max-width: 1460px; margin: 0 auto; padding: 8px 20px 60px; }
    .swagger-ui, .swagger-ui .info .title, .swagger-ui .info li, .swagger-ui .info p,
    .swagger-ui .info table, .swagger-ui label, .swagger-ui .opblock-tag,
    .swagger-ui .opblock .opblock-summary-description, .swagger-ui table thead tr th,
    .swagger-ui table thead tr td, .swagger-ui .parameter__name, .swagger-ui .parameter__type,
    .swagger-ui .response-col_status, .swagger-ui .response-col_links,
    .swagger-ui .opblock-description-wrapper p, .swagger-ui .opblock-external-docs-wrapper p,
    .swagger-ui .opblock-title_normal p, .swagger-ui .tab li, .swagger-ui section.models h4,
    .swagger-ui section.models h5, .swagger-ui .model-title, .swagger-ui .model,
    .swagger-ui .prop-type, .swagger-ui .checkbox p, .swagger-ui .dialog-ux .modal-ux-content p,
    .swagger-ui .dialog-ux .modal-ux-content h4, .swagger-ui .dialog-ux .modal-ux-header h3,
    .swagger-ui .auth-container .errors, .swagger-ui .errors-wrapper .errors h4,
    .swagger-ui .scheme-container .schemes > label, .swagger-ui .loading-container .loading::after,
    .swagger-ui .btn, .swagger-ui select, .swagger-ui .response-col_description__inner div.markdown,
    .swagger-ui .renderedMarkdown p {
      color: var(--text-1); font-family: var(--font);
    }
    .swagger-ui .info { margin: 28px 0 12px; }
    .swagger-ui .info .title small { background: var(--accent); }
    .swagger-ui .info .title small.version-stamp { background: var(--accent-2); }
    .swagger-ui .info .description, .swagger-ui .info .description p,
    .swagger-ui .markdown p, .swagger-ui .markdown li { color: var(--text-2); }
    .swagger-ui .info a, .swagger-ui a, .swagger-ui .response-col_links { color: var(--accent-2); }
    .swagger-ui .info a:hover, .swagger-ui a:hover { color: var(--accent-3); }
    .swagger-ui .markdown code, .swagger-ui .renderedMarkdown code {
      background: var(--bg-2); color: var(--accent-3); border: 1px solid var(--border);
    }

    /* --- Filter / search --- */
    .swagger-ui .filter-container { margin: 6px 0 4px; }
    .swagger-ui .filter .operation-filter-input {
      background: var(--bg-1); border: 1px solid var(--border); color: var(--text-1);
      border-radius: 8px; padding: 9px 12px; width: 100%; max-width: 430px;
      font-family: var(--font);
    }
    .swagger-ui .filter .operation-filter-input:focus {
      outline: none; border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    /* --- Tag groups --- */
    .swagger-ui .opblock-tag {
      border-bottom: 1px solid var(--border); font-size: 17px;
      transition: background .15s; border-radius: 8px 8px 0 0;
    }
    .swagger-ui .opblock-tag:hover { background: var(--bg-1); }
    .swagger-ui .opblock-tag small { color: var(--text-2); }
    .swagger-ui .opblock-tag svg, .swagger-ui .expand-operation svg,
    .swagger-ui .expand-methods svg, .swagger-ui .arrow, .swagger-ui .model-toggle::after,
    .swagger-ui svg:not(:root) { fill: var(--text-2); }
    .swagger-ui .model-toggle::after {
      background: none; content: '▸'; color: var(--text-2); font-size: 13px; line-height: 20px;
    }
    .swagger-ui .model-toggle { transform: none; transition: none; }
    .swagger-ui .model-toggle.collapsed::after { content: '▸'; }
    .swagger-ui .model-toggle:not(.collapsed)::after { content: '▾'; }

    /* --- Operation blocks --- */
    .swagger-ui .opblock {
      background: var(--bg-1); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: 0 1px 2px rgba(0,0,0,.35);
      margin-bottom: 12px; overflow: hidden;
    }
    .swagger-ui .opblock:hover { border-color: var(--border-strong); }
    .swagger-ui .opblock .opblock-summary { border: none; padding: 8px 12px; }
    .swagger-ui .opblock .opblock-summary-path,
    .swagger-ui .opblock .opblock-summary-path__deprecated {
      color: var(--text-1); font-family: var(--mono); font-size: 14.5px;
    }
    .swagger-ui .opblock .opblock-summary-description { color: var(--text-2); font-size: 12.5px; }
    .swagger-ui .opblock .opblock-summary-method {
      border-radius: 7px; font-weight: 700; font-size: 12px; min-width: 76px;
      text-shadow: none; font-family: var(--font);
    }
    .swagger-ui .opblock.opblock-get    { border-left: 3px solid var(--get); }
    .swagger-ui .opblock.opblock-post   { border-left: 3px solid var(--post); }
    .swagger-ui .opblock.opblock-put    { border-left: 3px solid var(--put); }
    .swagger-ui .opblock.opblock-patch  { border-left: 3px solid var(--patch); }
    .swagger-ui .opblock.opblock-delete { border-left: 3px solid var(--delete); }
    .swagger-ui .opblock.opblock-head, .swagger-ui .opblock.opblock-options
      { border-left: 3px solid var(--neutral-method); }
    .swagger-ui .opblock-get .opblock-summary-method    { background: var(--get); }
    .swagger-ui .opblock-post .opblock-summary-method   { background: var(--post); }
    .swagger-ui .opblock-put .opblock-summary-method    { background: var(--put); }
    .swagger-ui .opblock-patch .opblock-summary-method  { background: var(--patch); }
    .swagger-ui .opblock-delete .opblock-summary-method { background: var(--delete); }
    .swagger-ui .opblock-head .opblock-summary-method,
    .swagger-ui .opblock-options .opblock-summary-method { background: var(--neutral-method); }
    .swagger-ui .opblock .opblock-section-header {
      background: var(--bg-2); border: none; box-shadow: none;
    }
    .swagger-ui .opblock .opblock-section-header h4,
    .swagger-ui .opblock .opblock-section-header > label { color: var(--text-1); }
    .swagger-ui .opblock-body pre.microlight {
      background: #120e1f !important; color: var(--accent-3) !important;
      border-radius: 8px; font-family: var(--mono);
    }
    .swagger-ui .opblock-body pre.microlight span { color: inherit !important; }
    .swagger-ui .opblock-deprecated { opacity: .65; }

    /* --- Tables / parameters / responses --- */
    .swagger-ui table thead tr th, .swagger-ui table thead tr td {
      border-bottom: 1px solid var(--border); color: var(--text-2); font-size: 12px;
    }
    .swagger-ui .parameters-col_description input,
    .swagger-ui .parameters-col_description select,
    .swagger-ui input[type=text], .swagger-ui input[type=password],
    .swagger-ui input[type=search], .swagger-ui input[type=email],
    .swagger-ui input[type=file], .swagger-ui textarea, .swagger-ui select {
      background: var(--bg-2); border: 1px solid var(--border); color: var(--text-1);
      border-radius: 7px;
    }
    .swagger-ui input:focus, .swagger-ui textarea:focus, .swagger-ui select:focus {
      outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .swagger-ui select {
      background: var(--bg-2) url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="%23a89fc7" viewBox="0 0 16 16"%3E%3Cpath d="M8 11L3 6h10z"/%3E%3C/svg%3E') right 8px center no-repeat;
    }
    .swagger-ui .parameter__name.required::after { color: var(--bad); }
    .swagger-ui .parameter__name { color: var(--text-1); }
    .swagger-ui .parameter__type, .swagger-ui .parameter__deprecated,
    .swagger-ui .parameter__in, .swagger-ui .prop-format { color: var(--text-3); }
    .swagger-ui .response-col_status { color: var(--text-1); font-family: var(--mono); }
    .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5 { color: var(--text-1); }
    .swagger-ui .response .response-col_description { color: var(--text-2); }
    .swagger-ui td.response-col_links { color: var(--text-3); }

    /* --- Buttons --- */
    .swagger-ui .btn {
      border-radius: 8px; border: 1px solid var(--border-strong);
      background: var(--bg-2); color: var(--text-1); box-shadow: none;
      transition: background .15s, border-color .15s;
    }
    .swagger-ui .btn:hover { background: var(--bg-3); }
    .swagger-ui .btn.execute { background: var(--accent); border-color: var(--accent); color: #fff; }
    .swagger-ui .btn.execute:hover { background: var(--accent-2); border-color: var(--accent-2); }
    .swagger-ui .btn.cancel { border-color: var(--bad); color: var(--bad); background: transparent; }
    .swagger-ui .btn.authorize {
      border-color: var(--accent); color: var(--accent-3); background: var(--accent-soft);
    }
    .swagger-ui .btn.authorize svg { fill: var(--accent-3); }
    .swagger-ui .try-out__btn { border-color: var(--accent-2); color: var(--accent-3); }
    .swagger-ui .copy-to-clipboard { background: var(--bg-3); border-radius: 6px; }
    .swagger-ui .copy-to-clipboard button { background: none; }

    /* --- Schemes / servers bar --- */
    .swagger-ui .scheme-container {
      background: var(--bg-1); box-shadow: none; border-bottom: 1px solid var(--border);
      padding: 14px 0; margin: 0 0 14px;
    }

    /* --- Models --- */
    .swagger-ui section.models {
      border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-1);
    }
    .swagger-ui section.models.is-open h4 { border-bottom: 1px solid var(--border); }
    .swagger-ui section.models .model-container {
      background: var(--bg-2); border-radius: 8px; margin: 10px 16px;
    }
    .swagger-ui section.models .model-container:hover { background: var(--bg-3); }
    .swagger-ui .model { color: var(--text-2); font-family: var(--mono); }
    .swagger-ui .model .property.primitive { color: var(--text-3); }
    .swagger-ui .model-title { color: var(--text-1); }
    .swagger-ui .model .renderedMarkdown p { color: var(--text-3); }

    /* --- Authorize modal --- */
    .swagger-ui .dialog-ux .backdrop-ux { background: rgba(8, 6, 15, 0.75); }
    .swagger-ui .dialog-ux .modal-ux {
      background: var(--bg-1); border: 1px solid var(--border-strong); border-radius: 12px;
    }
    .swagger-ui .dialog-ux .modal-ux-header { border-bottom: 1px solid var(--border); }
    .swagger-ui .dialog-ux .modal-ux-header .close-modal svg { fill: var(--text-2); }
    .swagger-ui .auth-container { border-bottom: 1px solid var(--border); }
    .swagger-ui .auth-container .wrapper code,
    .swagger-ui .auth-container .wrapper label { color: var(--text-2); }
    .swagger-ui .auth-btn-wrapper { justify-content: flex-start; gap: 8px; }

    /* --- Confidence chips --- */
    .jerant-chip {
      margin-left: auto; margin-right: 8px; padding: 2.5px 9px; border-radius: 999px;
      font-size: 11px; font-weight: 700; white-space: nowrap; font-family: var(--font);
      border: 1px solid transparent;
    }
    .jerant-chip.c-high { background: rgba(16,168,119,.16); color: #4bd4a6; border-color: rgba(16,168,119,.4); }
    .jerant-chip.c-mid  { background: rgba(201,133,0,.16);  color: #e8b04a; border-color: rgba(201,133,0,.4); }
    .jerant-chip.c-low  { background: rgba(224,68,122,.14); color: #ef7ba2; border-color: rgba(224,68,122,.4); }
    .jerant-chip.c-none { background: var(--bg-3); color: var(--text-2); border-color: var(--border-strong); }

    /* --- Learning mode (confidence < 50): open + editable --- */
    .swagger-ui .opblock.jerant-learning { border-style: dashed; border-color: var(--accent); }
    .swagger-ui .opblock.jerant-learning .opblock-summary::before {
      content: '◌'; color: var(--accent-3); margin-right: 6px; font-size: 13px;
    }
    .swagger-ui .opblock:not(.is-open) .jerant-teach { display: none; }
    .jerant-teach {
      margin: 0 12px 12px; border: 1px dashed var(--border-strong); border-radius: 8px;
      background: rgba(139, 92, 246, 0.05); padding: 14px 16px; font-family: var(--font);
    }
    .jerant-teach .jt-head { font-size: 13px; font-weight: 700; color: var(--accent-3); }
    .jerant-teach .jt-head span { font-weight: 400; color: var(--text-2); margin-left: 8px; font-size: 12px; }
    .jerant-teach h5 {
      margin: 14px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
      color: var(--text-2); font-weight: 600;
    }
    .jerant-teach .jt-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
    .jerant-teach input[type=text], .jerant-teach textarea, .jerant-teach select {
      background: var(--bg-2); border: 1px solid var(--border); color: var(--text-1);
      border-radius: 7px; padding: 7px 10px; font: 12.5px var(--mono); flex: 1; min-width: 0;
    }
    .jerant-teach input[type=file] { color: var(--text-2); font: 12px var(--font); flex: 1; }
    .jerant-teach input:focus, .jerant-teach textarea:focus, .jerant-teach select:focus {
      outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);
    }
    .jerant-teach .jt-row select.jt-type { flex: 0 0 84px; }
    .jerant-teach textarea { width: 100%; min-height: 96px; resize: vertical; }
    .jerant-teach .jt-mini {
      appearance: none; background: none; border: 1px dashed var(--border-strong);
      color: var(--text-2); border-radius: 7px; padding: 5px 11px; font: 600 11.5px var(--font);
      cursor: pointer;
    }
    .jerant-teach .jt-mini:hover { color: var(--accent-3); border-color: var(--accent); }
    .jerant-teach .jt-x {
      appearance: none; background: none; border: none; color: var(--text-3);
      font-size: 15px; cursor: pointer; padding: 0 4px; flex: 0 0 auto;
    }
    .jerant-teach .jt-x:hover { color: var(--bad); }
    .jerant-teach .jt-send-row { display: flex; gap: 10px; align-items: center; margin-top: 14px; }
    .jerant-teach .jt-send {
      appearance: none; background: var(--accent); border: 1px solid var(--accent); color: #fff;
      font: 700 12.5px var(--font); padding: 8px 18px; border-radius: 8px; cursor: pointer;
    }
    .jerant-teach .jt-send:hover { background: var(--accent-2); border-color: var(--accent-2); }
    .jerant-teach .jt-send[disabled] { opacity: .6; cursor: wait; }
    .jerant-teach .jt-note { font-size: 12px; color: var(--text-2); }
    .jerant-teach .jt-note.ok { color: #4bd4a6; }
    .jerant-teach .jt-note.err { color: #ef7ba2; }
    .jerant-teach .jt-result {
      margin-top: 10px; background: #120e1f; border: 1px solid var(--border);
      border-radius: 8px; padding: 10px 12px; display: none;
    }
    .jerant-teach .jt-result .jt-status { font: 700 12px var(--mono); margin-bottom: 6px; }
    .jerant-teach .jt-result .jt-status.s2 { color: #4bd4a6; }
    .jerant-teach .jt-result .jt-status.s4, .jerant-teach .jt-result .jt-status.s5 { color: #ef7ba2; }
    .jerant-teach .jt-result pre {
      margin: 0; color: var(--accent-3); font: 12px var(--mono);
      white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow: auto;
    }

    /* --- Responsive --- */
    @media (max-width: 720px) {
      .jerant-header { padding: 16px; }
      .jerant-tile { flex: 1 1 40%; }
      #swagger-ui { padding: 4px 8px 40px; }
    }`;

// Header markup: brand row + actions + stat tile row (filled client-side).
function headerHtml(title, specUrl) {
  return `  <header class="jerant-header">
    <div class="row">
      <div class="brand">
        <span class="title">${title}<span class="by">jerant</span></span>
        <span class="version" id="jerant-version"></span>
      </div>
      <div class="jerant-actions">
        <button class="jerant-btn" id="jerant-toggle-all" type="button">Expand all</button>
        <button class="jerant-btn" id="jerant-copy-url" type="button">Copy spec URL</button>
        <a class="jerant-btn primary" id="jerant-download" href="${specUrl}" download="openapi.json">Download JSON</a>
      </div>
    </div>
    <div class="jerant-stats" id="jerant-stats" hidden>
      <div class="jerant-tile"><div class="label">Endpoints</div><div class="value" id="jt-endpoints">–</div></div>
      <div class="jerant-tile"><div class="label">Tag groups</div><div class="value" id="jt-tags">–</div></div>
      <div class="jerant-tile"><div class="label">Schemas</div><div class="value" id="jt-schemas">–</div></div>
      <div class="jerant-tile"><div class="label">Avg confidence</div><div class="value" id="jt-confidence">–</div></div>
      <div class="jerant-tile" id="jt-drift-tile" hidden><div class="label">⚠ Drift issues</div><div class="value" id="jt-drift">–</div><div class="sub">schema vs traffic</div></div>
      <div class="jerant-tile" id="jt-learning-tile" hidden><div class="label">◌ Learning</div><div class="value" id="jt-learning">–</div><div class="sub">try a request to teach them</div></div>
    </div>
  </header>`;
}

// Client script: stats tiles, confidence chips, expand/collapse, copy URL,
// "/" to focus the endpoint filter, and the teach panel — an open editor
// (query, path params, headers, raw JSON / form-data / url-encoded body)
// injected into low-confidence operations so users can exercise them and
// let the analyzer learn. Plain ES5-ish, no template literals.
const HEADER_SCRIPT = `
    (function () {
      var meta = {};

      function ingestSpec(spec) {
        var endpoints = 0, confidences = [], drift = 0, learning = 0;
        var tags = (spec.tags || []).map(function (t) { return t.name; });
        Object.keys(spec.paths || {}).forEach(function (p) {
          Object.keys(spec.paths[p]).forEach(function (m) {
            var op = spec.paths[p][m];
            if (!op || typeof op !== 'object') return;
            endpoints++;
            (op.tags || []).forEach(function (t) { if (tags.indexOf(t) === -1) tags.push(t); });
            var x = op['x-jerant'];
            if (x) {
              x.method = m.toUpperCase();
              x.path = p;
              meta[op.operationId] = x;
              if (typeof x.confidence === 'number') confidences.push(x.confidence);
              if (x.drift) drift += x.drift.length;
              if (x.learning) learning++;
            }
          });
        });
        var el = function (id) { return document.getElementById(id); };
        if (spec.info && spec.info.version) el('jerant-version').textContent = 'v' + spec.info.version;
        el('jt-endpoints').textContent = endpoints;
        el('jt-tags').textContent = tags.length;
        el('jt-schemas').textContent = Object.keys((spec.components || {}).schemas || {}).length;
        var avg = confidences.length
          ? Math.round(confidences.reduce(function (a, b) { return a + b; }, 0) / confidences.length)
          : null;
        el('jt-confidence').innerHTML = avg === null ? '\\u2013' : avg + '<span class="unit">%</span>';
        if (drift > 0) { el('jt-drift').textContent = drift; el('jt-drift-tile').hidden = false; }
        el('jt-learning').textContent = learning;
        el('jt-learning-tile').hidden = learning === 0;
        el('jerant-stats').hidden = false;
      }

      fetch(SPEC_URL).then(function (r) { return r.json(); }).then(function (spec) {
        ingestSpec(spec);
        decorate();
        var root = document.getElementById('swagger-ui');
        if (root && window.MutationObserver) {
          new MutationObserver(decorate).observe(root, { childList: true, subtree: true });
        }
      }).catch(function () {});

      function chipClass(confidence) {
        if (confidence >= 90) return 'c-high';
        if (confidence >= 70) return 'c-mid';
        if (confidence >= 40) return 'c-low';
        return 'c-none';
      }

      function chipText(info) {
        return info.confidence + '%' +
          (info.learning ? ' \\u00b7 learning' : '') + (info.drift ? ' \\u26a0' : '');
      }

      function chipTitle(info) {
        return 'Source: ' + info.source + ' \\u00b7 Confidence: ' + info.confidence + '%' +
          (info.observations ? ' \\u00b7 Observed requests: ' + info.observations : '') +
          (info.drift ? ' \\u00b7 ' + info.drift.length + ' drift issue(s)' : '') +
          (info.learning ? ' \\u00b7 Send a request below to teach the docs' : '');
      }

      function decorate() {
        Object.keys(meta).forEach(function (id) {
          document.querySelectorAll('.opblock[id$="-' + id + '"]').forEach(function (block) {
            var info = meta[id];
            var chip = block.querySelector('.jerant-chip');
            if (!chip) {
              var summary = block.querySelector('.opblock-summary');
              if (summary) {
                chip = document.createElement('span');
                chip.className = 'jerant-chip ' + chipClass(info.confidence);
                chip.textContent = chipText(info);
                chip.title = chipTitle(info);
                summary.appendChild(chip);
              }
            }
            if (info.learning) {
              block.classList.add('jerant-learning');
              if (!block.dataset.jerantOpened) {
                block.dataset.jerantOpened = '1';
                if (!block.classList.contains('is-open')) {
                  var toggle = block.querySelector('.opblock-summary-control') ||
                    block.querySelector('.opblock-summary');
                  if (toggle) toggle.click();
                }
              }
              if (!block.querySelector('.jerant-teach')) {
                block.appendChild(buildTeachPanel(id, info));
              }
            }
          });
        });
      }

      // Re-fetch the spec after a taught request and repaint chips + tiles.
      function refreshMeta() {
        fetch(SPEC_URL).then(function (r) { return r.json(); }).then(function (spec) {
          ingestSpec(spec);
          Object.keys(meta).forEach(function (id) {
            var info = meta[id];
            document.querySelectorAll('.opblock[id$="-' + id + '"] .jerant-chip').forEach(function (chip) {
              chip.className = 'jerant-chip ' + chipClass(info.confidence);
              chip.textContent = chipText(info);
              chip.title = chipTitle(info);
            });
          });
        }).catch(function () {});
      }

      // --- Teach panel -------------------------------------------------

      function make(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
      }

      function makeInput(placeholder, cls) {
        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        if (cls) input.className = cls;
        return input;
      }

      // One key/value row; withFile adds a text|file type switch (form-data).
      function addRow(container, withFile) {
        var row = make('div', 'jt-row');
        var typeSel = null;
        row.appendChild(makeInput('name', 'jt-key'));
        var valueBox = makeInput('value', 'jt-val');
        if (withFile) {
          typeSel = document.createElement('select');
          typeSel.className = 'jt-type';
          ['text', 'file'].forEach(function (t) {
            var o = document.createElement('option');
            o.value = t; o.textContent = t;
            typeSel.appendChild(o);
          });
          typeSel.addEventListener('change', function () {
            var next;
            if (typeSel.value === 'file') {
              next = document.createElement('input');
              next.type = 'file';
              next.className = 'jt-val';
            } else {
              next = makeInput('value', 'jt-val');
            }
            row.replaceChild(next, row.querySelector('.jt-val'));
          });
          row.appendChild(typeSel);
        }
        row.appendChild(valueBox);
        var del = make('button', 'jt-x', '\\u00d7');
        del.type = 'button';
        del.title = 'Remove';
        del.addEventListener('click', function () { row.remove(); });
        row.appendChild(del);
        container.appendChild(row);
        return row;
      }

      function rowsSection(panel, title, addLabel, withFile, startRows) {
        panel.appendChild(make('h5', null, title));
        var container = make('div', 'jt-rows');
        panel.appendChild(container);
        for (var i = 0; i < startRows; i++) addRow(container, withFile);
        var add = make('button', 'jt-mini', addLabel);
        add.type = 'button';
        add.addEventListener('click', function () { addRow(container, withFile); });
        panel.appendChild(add);
        return container;
      }

      function collectRows(container, cb) {
        container.querySelectorAll('.jt-row').forEach(function (row) {
          var key = row.querySelector('.jt-key').value.trim();
          var val = row.querySelector('.jt-val');
          if (key) cb(key, val);
        });
      }

      function buildTeachPanel(id, info) {
        var panel = make('div', 'jerant-teach');
        var head = make('div', 'jt-head', '\\u25cc Teach this endpoint');
        head.appendChild(make('span', null,
          'fill in anything \\u2014 params, query, headers, body \\u2014 send it, and the docs learn from the real request'));
        panel.appendChild(head);

        var pathParams = (info.path.match(/\\{[^}]+\\}/g) || []).map(function (s) { return s.slice(1, -1); });
        var pathInputs = {};
        if (pathParams.length) {
          panel.appendChild(make('h5', null, 'Path params'));
          pathParams.forEach(function (name) {
            var row = make('div', 'jt-row');
            var label = make('span', 'jt-note', name);
            label.style.flex = '0 0 120px';
            row.appendChild(label);
            var input = makeInput('value for ' + name);
            pathInputs[name] = input;
            row.appendChild(input);
            panel.appendChild(row);
          });
        }

        var queryRows = rowsSection(panel, 'Query params', '+ add query param', false, 1);
        var headerRows = rowsSection(panel, 'Headers (e.g. Authorization)', '+ add header', false, 0);

        var hasBody = !/^(GET|HEAD)$/.test(info.method);
        var bodyMode = null, jsonArea = null, formRows = null, encodedRows = null;
        if (hasBody) {
          panel.appendChild(make('h5', null, 'Body'));
          bodyMode = document.createElement('select');
          ['json', 'form-data', 'url-encoded', 'none'].forEach(function (m) {
            var o = document.createElement('option');
            o.value = m; o.textContent = m;
            bodyMode.appendChild(o);
          });
          bodyMode.style.maxWidth = '160px';
          panel.appendChild(bodyMode);

          jsonArea = document.createElement('textarea');
          jsonArea.placeholder = '{\\n  "name": "value"\\n}';
          jsonArea.spellcheck = false;
          panel.appendChild(jsonArea);

          var formWrap = make('div');
          formRows = make('div', 'jt-rows');
          formWrap.appendChild(formRows);
          addRow(formRows, true);
          var addForm = make('button', 'jt-mini', '+ add form field');
          addForm.type = 'button';
          addForm.addEventListener('click', function () { addRow(formRows, true); });
          formWrap.appendChild(addForm);
          formWrap.style.display = 'none';
          panel.appendChild(formWrap);

          var encWrap = make('div');
          encodedRows = make('div', 'jt-rows');
          encWrap.appendChild(encodedRows);
          addRow(encodedRows, false);
          var addEnc = make('button', 'jt-mini', '+ add field');
          addEnc.type = 'button';
          addEnc.addEventListener('click', function () { addRow(encodedRows, false); });
          encWrap.appendChild(addEnc);
          encWrap.style.display = 'none';
          panel.appendChild(encWrap);

          bodyMode.addEventListener('change', function () {
            jsonArea.style.display = bodyMode.value === 'json' ? '' : 'none';
            formWrap.style.display = bodyMode.value === 'form-data' ? '' : 'none';
            encWrap.style.display = bodyMode.value === 'url-encoded' ? '' : 'none';
          });
        }

        var sendRow = make('div', 'jt-send-row');
        var send = make('button', 'jt-send', 'Send request');
        send.type = 'button';
        var note = make('span', 'jt-note', '');
        sendRow.appendChild(send);
        sendRow.appendChild(note);
        panel.appendChild(sendRow);

        var result = make('div', 'jt-result');
        var status = make('div', 'jt-status', '');
        var pre = document.createElement('pre');
        result.appendChild(status);
        result.appendChild(pre);
        panel.appendChild(result);

        send.addEventListener('click', function () {
          note.className = 'jt-note';
          note.textContent = '';

          var url = info.path;
          for (var name in pathInputs) {
            var v = pathInputs[name].value.trim();
            if (!v) { note.className = 'jt-note err'; note.textContent = 'Path param "' + name + '" is required.'; return; }
            url = url.split('{' + name + '}').join(encodeURIComponent(v));
          }
          var qs = new URLSearchParams();
          collectRows(queryRows, function (key, val) { qs.append(key, val.value); });
          var qsText = qs.toString();
          if (qsText) url += (url.indexOf('?') === -1 ? '?' : '&') + qsText;

          var headers = {};
          collectRows(headerRows, function (key, val) { headers[key] = val.value; });

          var body;
          if (hasBody && bodyMode.value === 'json') {
            var raw = jsonArea.value.trim();
            if (raw) {
              try { JSON.parse(raw); } catch (e) {
                note.className = 'jt-note err'; note.textContent = 'Body is not valid JSON.'; return;
              }
              headers['Content-Type'] = 'application/json';
              body = raw;
            }
          } else if (hasBody && bodyMode.value === 'form-data') {
            var fd = new FormData();
            collectRows(formRows, function (key, val) {
              if (val.type === 'file') { if (val.files[0]) fd.append(key, val.files[0]); }
              else fd.append(key, val.value);
            });
            body = fd; // browser sets the multipart boundary
          } else if (hasBody && bodyMode.value === 'url-encoded') {
            var enc = new URLSearchParams();
            collectRows(encodedRows, function (key, val) { enc.append(key, val.value); });
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            body = enc.toString();
          }

          send.disabled = true;
          note.textContent = 'Sending\\u2026';
          fetch(url, { method: info.method, headers: headers, body: body })
            .then(function (res) {
              return res.text().then(function (text) {
                status.textContent = info.method + ' ' + url + ' \\u2192 ' + res.status + ' ' + res.statusText;
                status.className = 'jt-status s' + String(res.status)[0];
                try { pre.textContent = JSON.stringify(JSON.parse(text), null, 2); }
                catch (e) { pre.textContent = text.slice(0, 4000); }
                result.style.display = 'block';
                note.className = 'jt-note ok';
                note.textContent = 'Observed \\u2713 \\u2014 the docs are learning. Reload the page to see the updated schema.';
                setTimeout(refreshMeta, 2500);
              });
            })
            .catch(function (err) {
              note.className = 'jt-note err';
              note.textContent = 'Request failed: ' + err;
            })
            .then(function () { send.disabled = false; });
        });

        return panel;
      }

      var expanded = false;
      document.getElementById('jerant-toggle-all').addEventListener('click', function () {
        expanded = !expanded;
        this.textContent = expanded ? 'Collapse all' : 'Expand all';
        document.querySelectorAll('.opblock-tag-section').forEach(function (section) {
          var isOpen = section.classList.contains('is-open');
          if (isOpen !== expanded) {
            var h = section.querySelector('.opblock-tag');
            if (h) h.click();
          }
        });
      });

      document.getElementById('jerant-copy-url').addEventListener('click', function () {
        var btn = this;
        var full = location.origin + SPEC_URL;
        (navigator.clipboard ? navigator.clipboard.writeText(full) : Promise.reject())
          .then(function () {
            btn.textContent = 'Copied ✓';
            setTimeout(function () { btn.textContent = 'Copy spec URL'; }, 1500);
          })
          .catch(function () { window.prompt('Spec URL:', full); });
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
          var filter = document.querySelector('.operation-filter-input');
          if (filter) { e.preventDefault(); filter.focus(); }
        }
      });
    })();`;

function renderSwaggerPage(opts, title, specUrl) {
  const assetBase = opts.assets === 'local'
    ? escapeHtml(`${opts.docsPath}/assets`)
    : escapeHtml(opts.cdn);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${title} — API Docs</title>
  <link rel="stylesheet" href="${assetBase}/swagger-ui.css" />
  <style>${THEME_CSS}</style>
</head>
<body>
${headerHtml(title, specUrl)}
  <div id="swagger-ui"></div>
  <script src="${assetBase}/swagger-ui-bundle.js"${opts.assets === 'local' ? '' : ' crossorigin'}></script>
  <script>
    var SPEC_URL = ${JSON.stringify(opts.openapiPath)};
    window.addEventListener('load', function () {
      window.ui = SwaggerUIBundle({
        url: SPEC_URL,
        dom_id: '#swagger-ui',
        deepLinking: true,
        filter: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout'
      });
    });
${HEADER_SCRIPT}
  </script>
</body>
</html>`;
}

// Redoc's theme option keyed to the same purple/lavender tokens.
const REDOC_THEME = JSON.stringify({
  colors: {
    primary: { main: '#a78bfa' },
    text: { primary: '#ece8f8', secondary: '#a89fc7' },
    background: { primary: '#0f0d17', secondary: '#171326' },
    border: { dark: '#2b2344', light: '#2b2344' },
    http: {
      get: '#8b5cf6', post: '#10a877', put: '#c98500',
      patch: '#0e9db5', delete: '#e0447a', options: '#5f5680', head: '#5f5680',
    },
  },
  sidebar: { backgroundColor: '#171326', textColor: '#ece8f8' },
  rightPanel: { backgroundColor: '#171326' },
  typography: { fontFamily: 'system-ui, sans-serif', code: { backgroundColor: '#1f1a33', color: '#c4b5fd' } },
});

function renderRedocPage(opts, title, specUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${title} — API Docs</title>
  <style>${THEME_CSS}
    .jerant-stats, .jerant-actions .jerant-btn:not(.primary) { display: none; }
  </style>
</head>
<body>
${headerHtml(title, specUrl)}
  <redoc spec-url="${specUrl}" theme='${REDOC_THEME}'></redoc>
  <script src="${escapeHtml(REDOC_CDN)}"></script>
</body>
</html>`;
}

function renderScalarPage(opts, title, specUrl) {
  const config = JSON.stringify({ theme: 'purple', darkMode: true });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${title} — API Docs</title>
  <style>${THEME_CSS}
    .jerant-stats, .jerant-actions .jerant-btn:not(.primary) { display: none; }
  </style>
</head>
<body>
${headerHtml(title, specUrl)}
  <script id="api-reference" data-url="${specUrl}" data-configuration='${escapeHtml(config)}'></script>
  <script src="${escapeHtml(SCALAR_CDN)}"></script>
</body>
</html>`;
}

/**
 * Render the docsPath HTML page for the configured UI (swagger, redoc,
 * scalar, or a user-supplied page), pointed at the app's own openapi.json.
 * Returns null when the docs page is disabled (ui: false).
 */
function renderDocsPage(opts) {
  if (opts.ui === false) return null;
  if (typeof opts.ui === 'function') {
    // Custom renderer: receives {openapiPath, docsPath, title} and returns HTML.
    return String(opts.ui({ openapiPath: opts.openapiPath, docsPath: opts.docsPath, title: opts.title }));
  }
  if (opts.ui && typeof opts.ui === 'object' && typeof opts.ui.html === 'string') {
    return opts.ui.html;
  }
  const title = escapeHtml(opts.title || 'API Documentation');
  const specUrl = escapeHtml(opts.openapiPath);
  if (opts.ui === 'redoc') return renderRedocPage(opts, title, specUrl);
  if (opts.ui === 'scalar') return renderScalarPage(opts, title, specUrl);
  return renderSwaggerPage(opts, title, specUrl);
}

module.exports = { renderDocsPage };
