'use strict';

// Project source scan: reads the app's own source files to document what
// Function.prototype.toString cannot see —
//   - inline handlers hidden inside wrapper closures (asyncHandler(fn))
//   - multer field names configured on the route (.single('avatar'),
//     .array('photos'), .fields([{name: 'id_front'}]))
//   - controller functions referenced by name (users.createUser)
// The scan walks the entry script's directory once (cached per directory),
// locates each route's registration text, and runs the same extractors as
// static-analysis over that text plus one hop of named handler definitions.
// Same guarantees: only identifiers are extracted, never values.

const fs = require('fs');
const path = require('path');
const {
  collectFields,
  collectFieldsOnRoot,
  collectAliases,
  collectStatusCodes,
  collectPrismaModels,
  destructuredNames,
  isUsableName,
} = require('./static-analysis');

const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.jerant', 'coverage', 'dist', 'build', 'out',
  '.next', '.nuxt', '.cache', 'public', 'static', 'logs', 'tmp',
]);
const MAX_ARGS_LENGTH = 100 * 1024;
const MAX_RESOLVED_HANDLERS = 5;

// Route arguments that look like handler references but never are.
const NON_HANDLER_NAMES = new Set([
  'req', 'res', 'next', 'err', 'app', 'router', 'express', 'multer',
  'upload', 'json', 'urlencoded', 'true', 'false', 'null', 'undefined',
]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defaultScanDir() {
  try {
    if (require.main && require.main.filename) {
      return path.dirname(require.main.filename);
    }
  } catch { /* bundlers may stub require.main */ }
  return process.cwd();
}

function walkFiles(dir, opts, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= opts.maxFiles) return;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, opts, out);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      try {
        const stat = fs.statSync(full);
        if (stat.size > opts.maxFileBytes) continue;
        out.push({ file: full, text: fs.readFileSync(full, 'utf8') });
      } catch { /* unreadable files are skipped */ }
    }
  }
}

// dir -> { files, routes: Map(method+path -> findings) }
const indexCache = new Map();

function loadSourceIndex(sourceScanOpts) {
  if (!sourceScanOpts || sourceScanOpts.enabled === false) return null;
  const dir = path.resolve(sourceScanOpts.dir || defaultScanDir());
  if (indexCache.has(dir)) return indexCache.get(dir);
  const files = [];
  walkFiles(dir, {
    maxFiles: sourceScanOpts.maxFiles || 400,
    maxFileBytes: sourceScanOpts.maxFileBytes || 512 * 1024,
  }, files);
  const index = { files, routes: new Map() };
  indexCache.set(dir, index);
  return index;
}

/** Balanced (...) / {...} / [...] starting at `start`, aware of strings and
 * comments. Returns { inner, end } where end is the closer's index. */
function extractBalancedRange(text, start, open, close) {
  let depth = 0;
  const end = Math.min(text.length, start + MAX_ARGS_LENGTH);
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < end; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === c) break;
      }
    } else if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i === -1) return null;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) return null;
      i += 1;
    } else if (c === open) {
      depth += 1;
    } else if (c === close) {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(start + 1, i), end: i };
    }
  }
  return null;
}

function extractBalanced(text, start, open, close) {
  const range = extractBalancedRange(text, start, open, close);
  return range ? range.inner : null;
}

/** Split on commas at depth 0, respecting strings and nesting. */
function splitTopLevel(text) {
  const pieces = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === c) break;
      }
    } else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) {
      pieces.push(text.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(text.slice(start));
  return pieces;
}

/** '/api/users/:id' -> ['/api/users/:id', '/users/:id', '/:id', '/'] */
function pathCandidates(fullPath) {
  const out = [fullPath];
  let p = fullPath;
  while (true) {
    const next = p.indexOf('/', 1);
    if (next === -1) break;
    p = p.slice(next);
    out.push(p);
  }
  if (out[out.length - 1] !== '/') out.push('/');
  return out;
}

/** A candidate with no static segment ('/', '/:id') matches too many routers
 * to identify on its own. */
function isAmbiguous(candidate) {
  return candidate.split('/').filter((s) => s && !s.startsWith(':')).length === 0;
}

/** Static path segments the candidate no longer carries (the mount prefix). */
function consumedSegments(fullPath, candidate) {
  const full = fullPath.split('/').filter(Boolean);
  const kept = candidate.split('/').filter(Boolean).length;
  return full.slice(0, full.length - kept).filter((s) => !s.startsWith(':'));
}

function findRegistrationArgs(files, method, fullPath) {
  const m = method.toLowerCase();
  const methodPattern = m === 'all' ? 'all' : `(?:${m}|all)`;
  for (const candidate of pathCandidates(fullPath)) {
    const re = new RegExp(
      `\\.\\s*${methodPattern}\\s*\\(\\s*(['"\`])${escapeRegExp(candidate)}\\1`,
      'g'
    );
    const found = [];
    for (const { file, text } of files) {
      let match;
      while ((match = re.exec(text))) {
        const openParen = match.index + match[0].indexOf('(');
        const args = extractBalanced(text, openParen, '(', ')');
        if (args) found.push({ args, file, text });
        if (found.length > 4) break;
      }
      re.lastIndex = 0;
    }
    if (found.length === 0) continue;
    // Two registrations of the same method+path (separate apps, versioned
    // routers) cannot be told apart at the text level — scan none of them.
    if (!isAmbiguous(candidate)) return found.length === 1 ? [found[0].args] : [];

    // Prefix-stripped candidates ('/', '/:id') match any router root; only
    // trust a match tied to the stripped mount segments — via the file's
    // path (routes/users.js) or a mount registration in the file.
    const consumed = consumedSegments(fullPath, candidate);
    if (!consumed.length) {
      return found.length === 1 ? [found[0].args] : [];
    }
    const related = found.filter(({ file, text }) =>
      consumed.some(
        (seg) =>
          file.toLowerCase().includes(seg.toLowerCase()) ||
          new RegExp(`use\\s*\\(\\s*(['"\`])[^'"\`]*${escapeRegExp(seg)}`).test(text)
      )
    );
    return related.length === 1 ? [related[0].args] : [];
  }
  return [];
}

/** Multer-style upload config in the registration text -> file field names. */
function collectUploadConfig(argsText, result) {
  let m;
  const single = /\.\s*(?:single|array)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = single.exec(argsText))) {
    if (isUsableName(m[1])) result.fileFields.add(m[1]);
    result.multipart = true;
  }
  const fieldsRe = /\.\s*fields\s*\(\s*\[/g;
  while ((m = fieldsRe.exec(argsText))) {
    const inner = extractBalanced(argsText, m.index + m[0].length - 1, '[', ']');
    if (inner === null) continue;
    result.multipart = true;
    const nameRe = /name\s*:\s*['"`]([^'"`]+)['"`]/g;
    let n;
    while ((n = nameRe.exec(inner))) {
      if (isUsableName(n[1])) result.fileFields.add(n[1]);
    }
  }
  if (/\.\s*(?:any|none)\s*\(\s*\)/.test(argsText)) result.multipart = true;
}

/** Split registration args on top-level commas and keep handler references:
 * bare `createUser`, dotted `users.createUser`, or `wrap(users.createUser)`. */
function handlerReferenceNames(argsText) {
  const pieces = splitTopLevel(argsText);
  const DOTTED = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/;
  const WRAPPED = /^[A-Za-z_$][\w$]*\s*\(\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\)$/;
  const names = [];
  for (const rawPiece of pieces) {
    const piece = rawPiece.trim();
    if (!piece || piece.startsWith('"') || piece.startsWith("'") || piece.startsWith('`')) continue;
    let ref = null;
    if (DOTTED.test(piece)) ref = piece;
    else {
      const wrapped = piece.match(WRAPPED);
      if (wrapped) ref = wrapped[1];
    }
    if (!ref) continue;
    const name = ref.split('.').pop().trim();
    if (isUsableName(name) && !NON_HANDLER_NAMES.has(name)) names.push(name);
    if (names.length >= MAX_RESOLVED_HANDLERS) break;
  }
  return names;
}

/** Find a function definition by name: returns { params, body } or null.
 * Covers declarations, arrow/function assignments, object properties,
 * exports.name = ..., and object-method shorthand. */
function findFunctionDefinition(files, name) {
  const escaped = escapeRegExp(name);
  const patterns = [
    `(?:async\\s+)?function\\s+${escaped}\\s*\\(`,
    `(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:function[^(]*)?\\(`,
    `(?:exports|module\\.exports)\\.${escaped}\\s*=\\s*(?:async\\s*)?(?:function[^(]*)?\\(`,
    `${escaped}\\s*:\\s*(?:async\\s*)?(?:function[^(]*)?\\(`,
    `(?:^|\\n)\\s*(?:async\\s+)?${escaped}\\s*\\(`, // object/class method shorthand
  ];
  for (const pattern of patterns) {
    const re = new RegExp(pattern);
    for (const { text } of files) {
      const match = re.exec(text);
      if (!match) continue;
      const parenStart = match.index + match[0].lastIndexOf('(');
      const params = extractBalancedRange(text, parenStart, '(', ')');
      if (!params) continue;
      // Definition bodies open with '{' (possibly after '=>'); anything else
      // (a call site, a condition) is not a definition.
      const after = text.slice(params.end + 1, params.end + 20);
      const arrow = after.match(/^\s*=>\s*/);
      const bodyOffset = params.end + 1 + (arrow ? arrow[0].length : after.match(/^\s*/)[0].length);
      if (text[bodyOffset] !== '{') {
        if (arrow) {
          // Expression-bodied arrow: take the rest of the statement.
          return { params: params.inner, body: text.slice(bodyOffset, bodyOffset + 500) };
        }
        continue;
      }
      const body = extractBalanced(text, bodyOffset, '{', '}');
      if (body !== null) return { params: params.inner, body };
    }
  }
  return null;
}

// --- Payload flow: follow req.body through calls down to the DB query ---

const MAX_FLOW_HOPS = 4;
const MAX_FLOW_FUNCTIONS = 8;
const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'await', 'new', 'throw', 'do', 'else', 'in', 'of', 'super', 'void',
]);

/** Textual roots the request body lives under in this source. */
function bodyRootNames(src) {
  const roots = ['req.body'];
  for (const alias of collectAliases(src, 'body')) roots.push(alias);
  return roots;
}

/** Calls that receive the payload root as a top-level argument:
 * `svc.create(req.body)` -> { name: 'create', argIndex: 0 }. */
function findCallsPassingRoot(src, root) {
  const calls = [];
  const callRe = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
  let m;
  while ((m = callRe.exec(src)) && calls.length < MAX_FLOW_FUNCTIONS) {
    const name = m[1].split('.').pop().trim();
    if (JS_KEYWORDS.has(m[1].trim()) || !isUsableName(name)) continue;
    const args = extractBalanced(src, m.index + m[0].length - 1, '(', ')');
    if (args === null || !args.includes(root)) continue;
    const pieces = splitTopLevel(args);
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i].replace(/[\s?]/g, '');
      if (piece === root || piece === `...${root}` || piece === `{...${root}}`) {
        calls.push({ name, argIndex: i });
        break;
      }
    }
  }
  return calls;
}

/** DB columns written from the tracked payload inside one function body:
 * SQL INSERT/UPDATE strings and query-builder object literals. */
function collectDbFields(src, root, addField) {
  const rootRef = new RegExp(`(?<![\\w$.])${escapeRegExp(root)}\\??[.[]`);
  if (!rootRef.test(src) && !src.includes(root)) return;

  // INSERT INTO users (email, name, role) VALUES ...
  const insertRe = /insert\s+into\s+[`"']?[\w.]+[`"']?\s*\(([^)]+)\)/gi;
  let m;
  while ((m = insertRe.exec(src))) {
    for (const col of m[1].split(',')) {
      const name = col.trim().replace(/[`"']/g, '');
      if (isUsableName(name)) addField(name);
    }
  }
  // UPDATE users SET email = $1, name = $2 WHERE ...
  const updateRe = /update\s+[`"']?[\w.]+[`"']?\s+set\s+([^;'"]+?)(?:\s+where\b|$)/gi;
  while ((m = updateRe.exec(src))) {
    const setRe = /[`"']?([A-Za-z_$][\w$]*)[`"']?\s*=/g;
    let s;
    while ((s = setRe.exec(m[1]))) addField(s[1]);
  }
  // Query-builder / ORM object literals: .insert({...}), .create({...}),
  // .update({...}), new Model({...}) — keys whose value reads the payload.
  const builderRe = /(?:\.\s*(?:insert|create|update|updateOne|findOneAndUpdate|save)|new\s+[A-Z][\w$]*)\s*\(\s*\{/g;
  while ((m = builderRe.exec(src))) {
    const inner = extractBalanced(src, m.index + m[0].length - 1, '{', '}');
    if (inner === null) continue;
    for (const piece of splitTopLevel(inner)) {
      const colon = piece.indexOf(':');
      if (colon === -1) continue;
      const key = piece.slice(0, colon).trim().replace(/^['"`]|['"`]$/g, '');
      const value = piece.slice(colon + 1);
      if (isUsableName(key) && rootRef.test(value)) addField(key);
    }
  }
}

/** Follow the payload through service calls, collecting body fields from
 * each callee's parameter usage and from DB write statements. */
function trackPayloadFlow(files, initialTexts, addBodyField, onSource) {
  const visited = new Set();
  let queue = initialTexts.map((src) => ({ src, roots: bodyRootNames(src) }));
  for (let hop = 0; hop < MAX_FLOW_HOPS && queue.length; hop++) {
    const next = [];
    for (const { src, roots } of queue) {
      for (const root of roots) {
        collectDbFields(src, root, addBodyField);
        for (const { name, argIndex } of findCallsPassingRoot(src, root)) {
          if (visited.has(name) || visited.size >= MAX_FLOW_FUNCTIONS) continue;
          visited.add(name);
          const def = findFunctionDefinition(files, name);
          if (!def) continue;
          if (onSource) onSource(def.body);
          const param = (splitTopLevel(def.params)[argIndex] || '').trim();
          if (!param) continue;
          if (param.startsWith('{')) {
            // create({ email, name }) — the parameter destructures the payload.
            for (const f of destructuredNames(param.replace(/^\{|\}$/g, ''))) addBodyField(f);
          } else {
            const paramName = param.split('=')[0].trim();
            if (!isUsableName(paramName)) continue;
            const fields = new Set();
            collectFieldsOnRoot(def.body, paramName.replace(/\$/g, '\\$'), fields);
            for (const f of fields) addBodyField(f);
            next.push({ src: def.body, roots: [paramName] });
          }
        }
      }
    }
    queue = next;
  }
}

function analyzeRegistrations(files, registrations) {
  const found = {
    bodyFields: new Set(),
    queryFields: new Set(),
    paramsFields: new Set(),
    fileFields: new Set(),
    usesFiles: false,
    multipart: false,
    statusCodes: new Set(),
    prismaModels: new Set(),
  };
  const sourceTexts = [];
  const seenHandlers = new Set();
  for (const args of registrations) {
    sourceTexts.push(args);
    collectUploadConfig(args, found);
    for (const name of handlerReferenceNames(args)) {
      if (seenHandlers.has(name) || seenHandlers.size >= MAX_RESOLVED_HANDLERS) continue;
      seenHandlers.add(name);
      const def = findFunctionDefinition(files, name);
      if (def) sourceTexts.push(def.body);
    }
  }
  const collectPrisma = (src) => {
    for (const model of collectPrismaModels(src)) found.prismaModels.add(model);
  };
  for (const src of sourceTexts) {
    for (const f of collectFields(src, 'body')) found.bodyFields.add(f);
    for (const f of collectFields(src, 'query')) found.queryFields.add(f);
    for (const f of collectFields(src, 'params')) found.paramsFields.add(f);
    for (const f of collectFields(src, 'files')) found.fileFields.add(f);
    for (const s of collectStatusCodes(src)) found.statusCodes.add(s);
    if (/(?<![\w$.])req\??\.files?\b/.test(src)) found.usesFiles = true;
    collectPrisma(src);
  }
  // Handlers that hand the whole payload to a service: follow it down to
  // the DB query to learn the field names.
  const addBodyField = (name) => {
    if (found.bodyFields.size < 40 && isUsableName(name)) found.bodyFields.add(name);
  };
  trackPayloadFlow(files, sourceTexts, addBodyField, collectPrisma);
  return {
    bodyFields: [...found.bodyFields],
    queryFields: [...found.queryFields],
    paramsFields: [...found.paramsFields],
    fileFields: [...found.fileFields],
    usesFiles: found.usesFiles,
    multipart: found.multipart,
    statusCodes: [...found.statusCodes],
    prismaModels: [...found.prismaModels],
  };
}

/**
 * Scan the project source for one route. Returns the analyzeHandles shape
 * plus a `multipart` flag from upload middleware configured on the route.
 */
function scanRouteSource(index, method, fullPath) {
  if (!index) return null;
  const key = `${method} ${fullPath}`;
  if (index.routes.has(key)) return index.routes.get(key);

  let result = null;
  try {
    const registrations = findRegistrationArgs(index.files, method, fullPath);
    if (registrations.length) {
      result = analyzeRegistrations(index.files, registrations);
    }
  } catch { result = null; /* scanning must never break spec generation */ }
  index.routes.set(key, result);
  return result;
}

/** Test helper: forget cached scans (e.g. between fixture apps). */
function clearSourceScanCache() {
  indexCache.clear();
}

module.exports = { loadSourceIndex, scanRouteSource, defaultScanDir, clearSourceScanCache };
