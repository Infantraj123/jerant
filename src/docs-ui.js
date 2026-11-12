'use strict';

const { escapeHtml } = require('./util');
const { assetVersion } = require('./assets');

// UI asset sources when opts.cdn is left at its swagger-ui default.
const REDOC_CDN = 'https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js';
const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';

// Theme tokens. Dark = black surfaces with lavender/violet text; light =
// white surfaces with deep-violet/lavender text. Both are driven by
// [data-theme] on <html>; pages without the attribute (custom pages reusing
// the exported CSS) follow prefers-color-scheme. Method identity is never
// color-alone: every badge carries its text label.
const DARK_VARS = `
      --bg-0: #000000;          /* page: black */
      --bg-1: #0b0a10;          /* panels */
      --bg-2: #14121c;          /* raised */
      --bg-3: #1e1a2b;          /* hover */
      --border: #241f36;
      --border-strong: #372e55;
      --text-1: #e9e1ff;        /* lavender */
      --text-2: #b8a5f0;        /* violet-lavender */
      --text-3: #8d7bc4;
      --accent: #8b5cf6;        /* violet */
      --accent-2: #a78bfa;      /* lavender */
      --accent-3: #c4b5fd;      /* light lavender */
      --accent-soft: rgba(139, 92, 246, 0.16);
      --on-accent: #ffffff;
      --header-bg: linear-gradient(135deg, #000000 0%, #0c0717 55%, #1a0f33 100%);
      --tile-bg: rgba(20, 18, 28, 0.78);
      --code-bg: #07060c;
      --backdrop: rgba(0, 0, 0, 0.78);
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      --get: #8b5cf6;
      --post: #10a877;
      --put: #c98500;
      --patch: #0e9db5;
      --delete: #e0447a;
      --neutral-method: #5f5680;
      --good: #10a877;
      --warn: #c98500;
      --bad: #e0447a;
      --good-fg: #4bd4a6;
      --warn-fg: #e8b04a;
      --bad-fg: #ef7ba2;
      --select-bg: rgba(167, 139, 250, 0.35);`;

const LIGHT_VARS = `
      --bg-0: #ffffff;          /* page: white */
      --bg-1: #fbf9ff;          /* panels */
      --bg-2: #f4f0ff;          /* raised */
      --bg-3: #ebe4ff;          /* hover */
      --border: #e5dcfb;
      --border-strong: #cdbff3;
      --text-1: #35196e;        /* deep violet */
      --text-2: #6545b0;        /* violet */
      --text-3: #7a62bf;        /* lavender-violet */
      --accent: #7c3aed;
      --accent-2: #8b5cf6;
      --accent-3: #6d28d9;
      --accent-soft: rgba(124, 58, 237, 0.10);
      --on-accent: #ffffff;
      --header-bg: linear-gradient(135deg, #ffffff 0%, #f7f3ff 55%, #ece3ff 100%);
      --tile-bg: rgba(255, 255, 255, 0.85);
      --code-bg: #f6f2ff;
      --backdrop: rgba(53, 25, 110, 0.35);
      --shadow: 0 1px 3px rgba(80, 50, 160, 0.10);
      --get: #7c3aed;
      --post: #0a8a61;
      --put: #a36a00;
      --patch: #0b7f93;
      --delete: #c42d63;
      --neutral-method: #6b6290;
      --good: #0a8a61;
      --warn: #a36a00;
      --bad: #c42d63;
      --good-fg: #087553;
      --warn-fg: #8a5a00;
      --bad-fg: #b3245a;
      --select-bg: rgba(124, 58, 237, 0.20);`;

// Per-method block styling. Selectors match Swagger UI's own
// (.opblock.opblock-<method> …) in specificity and come later, so the
// theme's surfaces and badge colors win over Swagger's blue/green/orange.
const METHOD_CSS = [
  ['get', '--get'], ['post', '--post'], ['put', '--put'], ['patch', '--patch'],
  ['delete', '--delete'], ['head', '--neutral-method'], ['options', '--neutral-method'],
].map(([m, v]) => `
    .swagger-ui .opblock.opblock-${m} {
      background: var(--bg-1); border-color: var(--border); border-left: 3px solid var(${v});
    }
    .swagger-ui .opblock.opblock-${m}:hover { border-color: var(--border-strong); border-left-color: var(${v}); }
    .swagger-ui .opblock.opblock-${m} .opblock-summary { border-color: var(--border); }
    .swagger-ui .opblock.opblock-${m}.is-open .opblock-summary { border-bottom: 1px solid var(--border); }
    .swagger-ui .opblock.opblock-${m} .opblock-summary-method {
      background: var(${v}); color: #fff; text-shadow: none;
    }
    .swagger-ui .opblock.opblock-${m} .opblock-section-header {
      background: var(--bg-2); border-color: var(--border);
    }
    .swagger-ui .opblock.opblock-${m} .tab-header .tab-item.active h4 span:after,
    .swagger-ui .opblock.opblock-${m} .opblock-section-header .tab-header .tab-item .opblock-title span:after {
      background: var(${v});
    }
    .swagger-ui .opblock.opblock-${m} .opblock-body > .opblock-description-wrapper { border-color: var(--border); }`).join('');

const THEME_CSS = `
    :root, [data-theme="dark"] {${DARK_VARS}
      --radius: 10px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    [data-theme="light"] {${LIGHT_VARS}
    }
    @media (prefers-color-scheme: light) {
      :root:not([data-theme]) {${LIGHT_VARS}
      }
    }
    html { color-scheme: dark; }
    html[data-theme="light"] { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg-0); color: var(--text-1); font-family: var(--font); }
    ::selection { background: var(--select-bg); }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: var(--bg-0); }
    ::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 6px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }

    /* --- Header --- */
    .jerant-header {
      background: var(--header-bg);
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
      background: var(--accent-soft);
    }
    .jerant-actions { display: flex; gap: 8px; }
    .jerant-btn {
      appearance: none; border: 1px solid var(--border-strong); background: var(--bg-2);
      color: var(--text-1); font: 600 12.5px var(--font); padding: 7px 13px;
      border-radius: 8px; cursor: pointer; transition: background .15s, border-color .15s;
      text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
    }
    .jerant-btn:hover { background: var(--bg-3); border-color: var(--accent); }
    .jerant-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
    .jerant-btn.primary:hover { background: var(--accent-2); border-color: var(--accent-2); }
    .jerant-btn.icon { padding: 7px 10px; font-size: 14px; line-height: 1; }

    /* --- Stat tiles (label + value; values wear text tokens) --- */
    .jerant-stats {
      display: flex; gap: 10px; flex-wrap: wrap;
      max-width: 1460px; margin: 16px auto 0;
    }
    .jerant-tile {
      background: var(--tile-bg); border: 1px solid var(--border);
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
      border-radius: var(--radius); box-shadow: var(--shadow);
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
${METHOD_CSS}
    .swagger-ui .opblock .opblock-section-header {
      background: var(--bg-2); border: none; box-shadow: none;
    }
    .swagger-ui .opblock .opblock-section-header h4,
    .swagger-ui .opblock .opblock-section-header > label { color: var(--text-1); }
    .swagger-ui .opblock-body pre.microlight {
      background: var(--code-bg) !important; color: var(--accent-3) !important;
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
    .swagger-ui .btn.execute { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
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
    .swagger-ui .dialog-ux .backdrop-ux { background: var(--backdrop); }
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
    .jerant-chip.c-high { background: rgba(16,168,119,.12); color: var(--good-fg); border-color: rgba(16,168,119,.4); }
    .jerant-chip.c-mid  { background: rgba(201,133,0,.12);  color: var(--warn-fg); border-color: rgba(201,133,0,.4); }
    .jerant-chip.c-low  { background: rgba(224,68,122,.10); color: var(--bad-fg); border-color: rgba(224,68,122,.4); }
    .jerant-chip.c-none { background: var(--bg-3); color: var(--text-2); border-color: var(--border-strong); }

    /* --- Learning mode (confidence < 50): open + editable --- */
    .swagger-ui .opblock.jerant-learning.jerant-learning { border-style: dashed; border-color: var(--accent); }
    .swagger-ui .opblock.jerant-learning .opblock-summary::before {
      content: '◌'; color: var(--accent-3); margin-right: 6px; font-size: 13px;
    }
    .swagger-ui .opblock:not(.is-open) .jerant-teach { display: none; }
    .jerant-teach {
      margin: 0 12px 12px; border: 1px dashed var(--border-strong); border-radius: 8px;
      background: var(--accent-soft); padding: 14px 16px; font-family: var(--font);
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
      appearance: none; background: var(--accent); border: 1px solid var(--accent); color: var(--on-accent);
      font: 700 12.5px var(--font); padding: 8px 18px; border-radius: 8px; cursor: pointer;
    }
    .jerant-teach .jt-send:hover { background: var(--accent-2); border-color: var(--accent-2); }
    .jerant-teach .jt-send[disabled] { opacity: .6; cursor: wait; }
    .jerant-teach .jt-note { font-size: 12px; color: var(--text-2); }
    .jerant-teach .jt-note.ok { color: var(--good-fg); }
    .jerant-teach .jt-note.err { color: var(--bad-fg); }
    .jerant-teach .jt-result {
      margin-top: 10px; background: var(--code-bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 10px 12px; display: none;
    }
    .jerant-teach .jt-result .jt-status { font: 700 12px var(--mono); margin-bottom: 6px; }
    .jerant-teach .jt-result .jt-status.s2 { color: var(--good-fg); }
    .jerant-teach .jt-result .jt-status.s4, .jerant-teach .jt-result .jt-status.s5 { color: var(--bad-fg); }
    .jerant-teach .jt-result pre {
      margin: 0; color: var(--accent-3); font: 12px var(--mono);
      white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow: auto;
    }

    /* --- Light theme touches Swagger UI's own light defaults can't cover --- */
    .swagger-ui .opblock .opblock-description-wrapper p,
    .swagger-ui .opblock .opblock-description-wrapper .renderedMarkdown p { color: var(--text-2); }
    .swagger-ui .opblock .opblock-summary-control:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .swagger-ui .opblock .opblock-summary-control:focus:not(:focus-visible) { outline: none; }
    [data-theme="light"] .swagger-ui .opblock-tag { color: var(--text-1); }

    /* --- Responsive --- */
    @media (max-width: 720px) {
      .jerant-header { padding: 16px; }
      .jerant-tile { flex: 1 1 40%; }
      #swagger-ui { padding: 4px 8px 40px; }
    }`;

// Theme bootstrap, run in <head> before first paint (no flash): a stored
// toggle choice wins, then the configured theme, then the OS preference.
function themeBootScript(theme) {
  return `(function(){var t=null;try{t=localStorage.getItem('jerant-theme')}catch(e){}` +
    `if(t!=='dark'&&t!=='light'){t=${JSON.stringify(theme)};}` +
    `if(t!=='dark'&&t!=='light'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}` +
    `document.documentElement.setAttribute('data-theme',t);})();`;
}

// Theme toggle: swagger re-themes live (pure CSS variables); Redoc and
// Scalar bake colors in at init, so they reload.
const THEME_TOGGLE_SCRIPT = `
    (function () {
      var btn = document.getElementById('jerant-theme');
      if (!btn) return;
      function paint() {
        var dark = document.documentElement.getAttribute('data-theme') !== 'light';
        btn.textContent = dark ? '\\u2600' : '\\u263e';
        btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
      }
      paint();
      btn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        try { localStorage.setItem('jerant-theme', next); } catch (e) {}
        if (btn.getAttribute('data-reload')) { location.reload(); return; }
        document.documentElement.setAttribute('data-theme', next);
        paint();
      });
    })();`;

// Header markup: brand row + actions + stat tile row (filled client-side).
function headerHtml(title, specUrl, { full = true, reloadOnTheme = false } = {}) {
  const extra = full
    ? `        <button class="jerant-btn" id="jerant-toggle-all" type="button">Expand all</button>
        <button class="jerant-btn" id="jerant-copy-url" type="button">Copy spec URL</button>
`
    : '';
  return `  <header class="jerant-header">
    <div class="row">
      <div class="brand">
        <span class="title">${title}<span class="by">jerant</span></span>
        <span class="version" id="jerant-version"></span>
      </div>
      <div class="jerant-actions">
${extra}        <a class="jerant-btn primary" id="jerant-download" href="${specUrl}" download="openapi.json">Download JSON</a>
        <button class="jerant-btn icon" id="jerant-theme" type="button"${reloadOnTheme ? ' data-reload="1"' : ''} aria-label="Toggle light/dark theme">☾</button>
      </div>
    </div>
${full ? `    <div class="jerant-stats" id="jerant-stats" hidden>
      <div class="jerant-tile"><div class="label">Endpoints</div><div class="value" id="jt-endpoints">–</div></div>
      <div class="jerant-tile"><div class="label">Tag groups</div><div class="value" id="jt-tags">–</div></div>
      <div class="jerant-tile"><div class="label">Schemas</div><div class="value" id="jt-schemas">–</div></div>
      <div class="jerant-tile"><div class="label">Avg confidence</div><div class="value" id="jt-confidence">–</div></div>
      <div class="jerant-tile" id="jt-drift-tile" hidden><div class="label">⚠ Drift issues</div><div class="value" id="jt-drift">–</div><div class="sub">schema vs traffic</div></div>
      <div class="jerant-tile" id="jt-learning-tile" hidden><div class="label">◌ Learning</div><div class="value" id="jt-learning">–</div><div class="sub">open one and send a request to teach it</div></div>
    </div>
` : ''}  </header>`;
}

// Client script for the Swagger page. Performance contract for huge APIs:
//   - the spec is fetched exactly once (started in <head>, in parallel with
//     the UI bundle) and handed to Swagger UI as an object;
//   - DOM decoration is incremental: a MutationObserver queues only the
//     operation blocks that actually changed and processes them once per
//     animation frame — never a document-wide sweep per mutation;
//   - nothing is auto-expanded; the teach panel is built lazily the first
//     time a learning operation is opened.
// Plain ES5, no template literals.
const PAGE_SCRIPT = `
    (function () {
      var meta = {};       // operationId -> x-jerant info (+ method, path)
      var metaIds = [];    // operationIds, longest first (suffix fallback)
      var tagNames = [];
      var root = document.getElementById('swagger-ui');

      function ingestSpec(spec) {
        var endpoints = 0, confidences = [], drift = 0, learning = 0;
        meta = {};
        tagNames = (spec.tags || []).map(function (t) { return t.name; });
        var paths = spec.paths || {};
        for (var p in paths) {
          var item = paths[p];
          for (var m in item) {
            var op = item[m];
            if (!op || typeof op !== 'object' || !op.responses) continue;
            endpoints++;
            var opTags = op.tags || [];
            for (var i = 0; i < opTags.length; i++) if (tagNames.indexOf(opTags[i]) === -1) tagNames.push(opTags[i]);
            var x = op['x-jerant'];
            if (x && op.operationId) {
              x.method = m.toUpperCase();
              x.path = p;
              meta[op.operationId] = x;
              if (typeof x.confidence === 'number') confidences.push(x.confidence);
              if (x.drift) drift += x.drift.length;
              if (x.learning && LEARNING) learning++;
            }
          }
        }
        metaIds = Object.keys(meta).sort(function (a, b) { return b.length - a.length; });
        var el = function (id) { return document.getElementById(id); };
        if (spec.info && spec.info.version) el('jerant-version').textContent = 'v' + spec.info.version;
        el('jt-endpoints').textContent = endpoints;
        el('jt-tags').textContent = tagNames.length;
        el('jt-schemas').textContent = Object.keys((spec.components || {}).schemas || {}).length;
        var sum = 0;
        for (var c = 0; c < confidences.length; c++) sum += confidences[c];
        el('jt-confidence').innerHTML = confidences.length
          ? Math.round(sum / confidences.length) + '<span class="unit">%</span>' : '\\u2013';
        el('jt-drift').textContent = drift;
        el('jt-drift-tile').hidden = drift === 0;
        el('jt-learning').textContent = learning;
        el('jt-learning-tile').hidden = learning === 0;
        el('jerant-stats').hidden = false;
        return endpoints;
      }

      // Swagger UI block ids are "operations-<tag>-<operationId>".
      function infoFor(block) {
        if (block.__jerantId !== undefined) return block.__jerantId && meta[block.__jerantId];
        var id = block.id || '';
        var found = '';
        var tail = id.slice(id.lastIndexOf('-') + 1);
        if (meta[tail]) found = tail;
        else {
          for (var i = 0; i < metaIds.length; i++) {
            if (id.length > metaIds[i].length && id.slice(-metaIds[i].length - 1) === '-' + metaIds[i]) { found = metaIds[i]; break; }
          }
        }
        block.__jerantId = found;
        return found && meta[found];
      }

      function chipClass(confidence) {
        if (confidence >= 90) return 'c-high';
        if (confidence >= 70) return 'c-mid';
        if (confidence >= 40) return 'c-low';
        return 'c-none';
      }
      function chipText(info) {
        return info.confidence + '%' +
          (info.learning && LEARNING ? ' \\u00b7 learning' : '') + (info.drift ? ' \\u26a0' : '');
      }
      function chipTitle(info) {
        return 'Source: ' + info.source + ' \\u00b7 Confidence: ' + info.confidence + '%' +
          (info.observations ? ' \\u00b7 Observed requests: ' + info.observations : '') +
          (info.drift ? ' \\u00b7 ' + info.drift.length + ' drift issue(s)' : '') +
          (info.learning && LEARNING ? ' \\u00b7 Open it and send a request to teach the docs' : '');
      }
      function paintChip(chip, info) {
        chip.className = 'jerant-chip ' + chipClass(info.confidence);
        chip.textContent = chipText(info);
        chip.title = chipTitle(info);
      }

      function decorateBlock(block) {
        if (!block.isConnected) return;
        var info = infoFor(block);
        if (!info) return;
        var summary = block.querySelector('.opblock-summary');
        if (summary && !(block.__jerantChip && block.__jerantChip.parentNode === summary)) {
          var chip = document.createElement('span');
          paintChip(chip, info);
          summary.appendChild(chip);
          block.__jerantChip = chip;
        }
        if (info.learning && LEARNING) {
          if (!block.classList.contains('jerant-learning')) block.classList.add('jerant-learning');
          if (block.classList.contains('is-open') &&
              !(block.__jerantTeach && block.__jerantTeach.parentNode === block)) {
            block.__jerantTeach = buildTeachPanel(block.__jerantId, info);
            block.appendChild(block.__jerantTeach);
          }
        }
      }

      // --- Incremental decoration queue -------------------------------
      var queue = [];
      var scheduled = false;
      var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      function enqueue(block) {
        if (block.__jerantQueued) return;
        block.__jerantQueued = true;
        queue.push(block);
        if (!scheduled) { scheduled = true; raf(flush); }
      }
      function flush() {
        scheduled = false;
        var batch = queue;
        queue = [];
        for (var i = 0; i < batch.length; i++) {
          batch[i].__jerantQueued = false;
          decorateBlock(batch[i]);
        }
      }
      function enqueueWithin(node) {
        if (node.nodeType !== 1) return;
        if (node.classList.contains('opblock')) { enqueue(node); return; }
        var owner = node.closest('.opblock');
        if (owner) { enqueue(owner); return; }
        var inner = node.getElementsByClassName('opblock');
        for (var i = 0; i < inner.length; i++) enqueue(inner[i]);
      }
      function onMutations(records) {
        if (!metaIds.length) return;
        for (var r = 0; r < records.length; r++) {
          var rec = records[r];
          if (rec.target.nodeType === 1) {
            var owner = rec.target.closest('.opblock');
            if (owner) enqueue(owner);
          }
          var added = rec.addedNodes;
          for (var a = 0; a < added.length; a++) enqueueWithin(added[a]);
        }
      }
      if (root && window.MutationObserver) {
        new MutationObserver(onMutations).observe(root, { childList: true, subtree: true });
      }

      function swaggerConfig(endpoints, spec) {
        var cfg = { dom_id: '#swagger-ui', spec: spec };
        for (var k in SWAGGER_DEFAULTS) cfg[k] = SWAGGER_DEFAULTS[k];
        // Large APIs: start fully collapsed and skip the models section
        // unless the app configured these explicitly.
        if (endpoints > LARGE_API) {
          cfg.docExpansion = 'none';
          cfg.defaultModelsExpandDepth = -1;
        }
        for (var u in SWAGGER_USER) cfg[u] = SWAGGER_USER[u];
        cfg.presets = [SwaggerUIBundle.presets.apis];
        cfg.layout = 'BaseLayout';
        return cfg;
      }

      var specPromise = window.__jerantSpec ||
        fetch(SPEC_URL, { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
      specPromise.then(function (spec) {
        var endpoints = ingestSpec(spec);
        window.ui = SwaggerUIBundle(swaggerConfig(endpoints, spec));
      }).catch(function (err) {
        if (root) root.textContent = 'Could not load ' + SPEC_URL + ': ' + err.message;
      });

      // Re-fetch the spec after a taught request and repaint chips + tiles.
      // Only rendered blocks are touched; the ETag makes no-change cheap.
      function refreshMeta() {
        fetch(SPEC_URL, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (spec) {
          ingestSpec(spec);
          var blocks = root.getElementsByClassName('opblock');
          for (var i = 0; i < blocks.length; i++) {
            var info = blocks[i].__jerantId && meta[blocks[i].__jerantId];
            if (info && blocks[i].__jerantChip) paintChip(blocks[i].__jerantChip, info);
          }
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
        var actions = window.ui && window.ui.layoutActions;
        if (actions && typeof actions.show === 'function') {
          for (var i = 0; i < tagNames.length; i++) actions.show(['operations-tag', tagNames[i]], expanded);
          return;
        }
        var sections = document.querySelectorAll('.opblock-tag-section');
        for (var s = 0; s < sections.length; s++) {
          if (sections[s].classList.contains('is-open') !== expanded) {
            var h = sections[s].querySelector('.opblock-tag');
            if (h) h.click();
          }
        }
      });

      document.getElementById('jerant-copy-url').addEventListener('click', function () {
        var btn = this;
        var full = location.origin + SPEC_URL;
        (navigator.clipboard ? navigator.clipboard.writeText(full) : Promise.reject())
          .then(function () {
            btn.textContent = 'Copied \\u2713';
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

// Endpoint count above which the Swagger page starts collapsed.
const LARGE_API_THRESHOLD = 150;

const SWAGGER_DEFAULTS = {
  deepLinking: true,
  filter: true,
  tryItOutEnabled: true,
  persistAuthorization: true,
  displayRequestDuration: true,
  docExpansion: 'list',
  defaultModelsExpandDepth: 1,
};

/** JSON for embedding inside a <script> element. */
function scriptJson(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Only JSON-serializable Swagger UI options survive into the page. */
function swaggerUserConfig(opts) {
  const out = {};
  for (const [key, value] of Object.entries(opts.swaggerUi || {})) {
    if (['dom_id', 'domNode', 'spec', 'url', 'urls', 'presets', 'plugins', 'layout'].includes(key)) continue;
    if (typeof value === 'function' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function renderSwaggerPage(opts, title, specUrl) {
  const local = opts.assets === 'local';
  const version = local ? assetVersion() : null;
  const assetBase = local ? escapeHtml(`${opts.docsPath === '/' ? '' : opts.docsPath}/assets`) : escapeHtml(opts.cdn);
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  const learning = opts.teachMode !== false && opts.mode !== 'production';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark light" />
  <title>${title} — API Docs</title>
  <script>${themeBootScript(opts.theme)}
    var SPEC_URL = ${scriptJson(opts.openapiPath)};
    window.__jerantSpec = fetch(SPEC_URL, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    window.__jerantSpec.catch(function () {});
  </script>
  <link rel="stylesheet" href="${assetBase}/swagger-ui.css${v}" />
  <style>${THEME_CSS}</style>
</head>
<body>
${headerHtml(title, specUrl)}
  <div id="swagger-ui"></div>
  <script src="${assetBase}/swagger-ui-bundle.js${v}"${local ? '' : ' crossorigin'}></script>
  <script>
    var LEARNING = ${learning ? 'true' : 'false'};
    var LARGE_API = ${LARGE_API_THRESHOLD};
    var SWAGGER_DEFAULTS = ${scriptJson(SWAGGER_DEFAULTS)};
    var SWAGGER_USER = ${scriptJson(swaggerUserConfig(opts))};
${THEME_TOGGLE_SCRIPT}
${PAGE_SCRIPT}
  </script>
</body>
</html>`;
}

// Redoc theme per mode, keyed to the same tokens.
function redocTheme(dark) {
  const c = dark
    ? { primary: '#a78bfa', text: '#e9e1ff', text2: '#b8a5f0', bg: '#000000', bg2: '#0b0a10', border: '#241f36', code: '#14121c', codeText: '#c4b5fd' }
    : { primary: '#7c3aed', text: '#35196e', text2: '#6545b0', bg: '#ffffff', bg2: '#fbf9ff', border: '#e5dcfb', code: '#f4f0ff', codeText: '#6d28d9' };
  return {
    colors: {
      primary: { main: c.primary },
      text: { primary: c.text, secondary: c.text2 },
      background: { primary: c.bg, secondary: c.bg2 },
      border: { dark: c.border, light: c.border },
      http: dark
        ? { get: '#8b5cf6', post: '#10a877', put: '#c98500', patch: '#0e9db5', delete: '#e0447a', options: '#5f5680', head: '#5f5680' }
        : { get: '#7c3aed', post: '#0a8a61', put: '#a36a00', patch: '#0b7f93', delete: '#c42d63', options: '#6b6290', head: '#6b6290' },
    },
    sidebar: { backgroundColor: c.bg2, textColor: c.text },
    rightPanel: { backgroundColor: dark ? '#0b0a10' : '#2a1458' },
    typography: { fontFamily: 'system-ui, sans-serif', code: { backgroundColor: c.code, color: c.codeText } },
  };
}

function renderRedocPage(opts, title, specUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark light" />
  <title>${title} — API Docs</title>
  <script>${themeBootScript(opts.theme)}</script>
  <style>${THEME_CSS}</style>
</head>
<body>
${headerHtml(title, specUrl, { full: false, reloadOnTheme: true })}
  <div id="redoc-container"></div>
  <script src="${escapeHtml(REDOC_CDN)}"></script>
  <script>
${THEME_TOGGLE_SCRIPT}
    (function () {
      var dark = document.documentElement.getAttribute('data-theme') !== 'light';
      var themes = ${scriptJson({ dark: redocTheme(true), light: redocTheme(false) })};
      Redoc.init(${scriptJson(opts.openapiPath)}, { theme: dark ? themes.dark : themes.light },
        document.getElementById('redoc-container'));
    })();
  </script>
</body>
</html>`;
}

function renderScalarPage(opts, title, specUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark light" />
  <title>${title} — API Docs</title>
  <script>${themeBootScript(opts.theme)}</script>
  <style>${THEME_CSS}</style>
</head>
<body>
${headerHtml(title, specUrl, { full: false, reloadOnTheme: true })}
  <script id="api-reference" data-url="${specUrl}"></script>
  <script>
${THEME_TOGGLE_SCRIPT}
    document.getElementById('api-reference').setAttribute('data-configuration', JSON.stringify({
      theme: 'purple',
      darkMode: document.documentElement.getAttribute('data-theme') !== 'light'
    }));
  </script>
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
    // Custom renderer: receives {openapiPath, docsPath, title, themeCss} and returns HTML.
    return String(opts.ui({
      openapiPath: opts.openapiPath,
      docsPath: opts.docsPath,
      title: opts.title,
      themeCss: THEME_CSS,
      themeCssPath: `${opts.docsPath === '/' ? '' : opts.docsPath}/theme.css`,
    }));
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

module.exports = { renderDocsPage, THEME_CSS, themeCss: THEME_CSS };
