'use strict';

// Static handler analysis: the deepest fallback for routes with no
// validation schemas and no observed traffic. Reads each handler's source
// (Function.prototype.toString) and extracts:
//   - request body / query / params fields   (req.body.x, {a, b} = req.body,
//     aliases like const data = req.body, bracket access, TS-compiled
//     optional chaining)
//   - multipart usage and file field names   (req.file, req.files.doc)
//   - response status codes                  (res.status(404), res.sendStatus)
// Only identifiers are extracted — never values — and results are cached
// per function.

const MAX_SOURCE_LENGTH = 200 * 1024;
const MAX_FIELDS = 40;

// Names that show up in property-access positions but are never payload fields.
const NOISE = new Set([
  'hasOwnProperty', 'toString', 'valueOf', 'constructor', 'prototype',
  'length', 'forEach', 'map', 'filter', 'find', 'includes', 'keys', 'values',
  'entries', 'then', 'catch', 'finally', 'push', 'slice', 'splice', 'concat',
  'indexOf', 'join', 'split', 'trim', 'replace', 'match', 'test',
]);

const IDENT = '[A-Za-z_$][\\w$]*';

function isUsableName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 60 &&
    new RegExp(`^${IDENT}$`).test(name) &&
    !NOISE.has(name)
  );
}

/** Parse `{ a, b: renamed, c = 1, ...rest }` into source-side field names. */
function destructuredNames(inner) {
  const names = [];
  // Drop nested destructuring bodies so top-level commas split cleanly, but
  // keep the outer name: `address: { city }` -> `address: X`.
  let flat = inner;
  for (let i = 0; i < 5 && /[{[]/.test(flat); i++) {
    flat = flat.replace(/[{[][^{}[\]]*[}\]]/g, 'X');
  }
  for (const item of flat.split(',')) {
    const name = item.split(':')[0].split('=')[0].trim();
    if (name.startsWith('...')) continue;
    if (isUsableName(name)) names.push(name);
  }
  return names;
}

/** Collect field names accessed on one root pattern (regex-escaped). */
function collectFieldsOnRoot(src, root, fields) {
  const add = (name) => {
    if (fields.size < MAX_FIELDS && isUsableName(name)) fields.add(name);
  };
  let m;
  // Direct and optional access: root.name / root?.name
  const dot = new RegExp(`(?<![\\w$.])${root}\\??\\.(${IDENT})`, 'g');
  while ((m = dot.exec(src))) add(m[1]);
  // Bracket access: root['name'] / root["name"]
  const bracket = new RegExp(`(?<![\\w$.])${root}\\??\\.?\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g');
  while ((m = bracket.exec(src))) add(m[1]);
  // Destructuring: { a, b } = root
  const destructure = new RegExp(`\\{([^{}]+(?:\\{[^{}]*\\}[^{}]*)*)\\}\\s*=\\s*${root}(?![\\w$.])`, 'g');
  while ((m = destructure.exec(src))) {
    for (const name of destructuredNames(m[1])) add(name);
  }
  return fields;
}

/** Aliases of req.<base>: `const data = req.body`, `(_a = req.body)`. */
function collectAliases(src, base) {
  const aliases = [];
  const aliasRe = new RegExp(
    `(?:(?:const|let|var)\\s+(${IDENT})\\s*=\\s*req\\??\\.${base}\\b(?!\\s*[.[])` +
    `|\\(\\s*(${IDENT})\\s*=\\s*req\\??\\.${base}\\b(?!\\s*[.[]))`,
    'g'
  );
  let m;
  while ((m = aliasRe.exec(src)) && aliases.length < 4) {
    const alias = m[1] || m[2];
    if (isUsableName(alias)) aliases.push(alias);
  }
  return aliases;
}

/** Collect field names accessed on req.<base> (body/query/params/files). */
function collectFields(src, base) {
  const fields = new Set();
  const roots = [`req\\??\\.${base}`];
  for (const alias of collectAliases(src, base)) {
    roots.push(alias.replace(/\$/g, '\\$'));
  }
  for (const root of roots) collectFieldsOnRoot(src, root, fields);
  return fields;
}

function collectStatusCodes(src) {
  const codes = new Set();
  const re = /res\s*\.\s*(?:status|sendStatus)\s*\(\s*(\d{3})\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const code = Number(m[1]);
    if (code >= 100 && code < 600) codes.add(String(code));
  }
  return codes;
}

const analysisCache = new WeakMap();

function analyzeFunction(fn) {
  if (analysisCache.has(fn)) return analysisCache.get(fn);
  let result = null;
  try {
    const src = fn.toString();
    if (src.length <= MAX_SOURCE_LENGTH && !/\[native code\]/.test(src)) {
      result = {
        body: collectFields(src, 'body'),
        query: collectFields(src, 'query'),
        params: collectFields(src, 'params'),
        files: collectFields(src, 'files'),
        usesFiles: /(?<![\w$.])req\??\.files?\b/.test(src),
        genericFile: false,
        statusCodes: collectStatusCodes(src),
      };
      if (/(?<![\w$.])req\??\.file\b/.test(src) && result.files.size === 0) {
        result.files.add('file'); // multer .single(): field name lives in closure
        result.genericFile = true;
      }
    }
  } catch { /* exotic function objects are skipped */ }
  analysisCache.set(fn, result);
  return result;
}

/**
 * Analyze every handler on a route and merge the findings.
 * Returns {bodyFields, queryFields, paramsFields, fileFields: string[],
 * usesFiles, genericFile, statusCodes: string[]}. genericFile means the
 * 'file' entry in fileFields is the req.file placeholder, not a real name.
 */
function analyzeHandles(handles) {
  const merged = {
    bodyFields: new Set(),
    queryFields: new Set(),
    paramsFields: new Set(),
    fileFields: new Set(),
    usesFiles: false,
    genericFile: false,
    statusCodes: new Set(),
  };
  for (const handle of handles || []) {
    if (typeof handle !== 'function' || handle.__jerantInternal) continue;
    const found = analyzeFunction(handle);
    if (!found) continue;
    for (const f of found.body) merged.bodyFields.add(f);
    for (const f of found.query) merged.queryFields.add(f);
    for (const f of found.params) merged.paramsFields.add(f);
    for (const f of found.files) merged.fileFields.add(f);
    for (const s of found.statusCodes) merged.statusCodes.add(s);
    if (found.usesFiles) merged.usesFiles = true;
    if (found.genericFile) merged.genericFile = true;
  }
  return {
    bodyFields: [...merged.bodyFields],
    queryFields: [...merged.queryFields],
    paramsFields: [...merged.paramsFields],
    fileFields: [...merged.fileFields],
    usesFiles: merged.usesFiles,
    genericFile: merged.genericFile,
    statusCodes: [...merged.statusCodes],
  };
}

module.exports = {
  analyzeHandles,
  analyzeFunction,
  collectFields,
  collectFieldsOnRoot,
  collectAliases,
  collectStatusCodes,
  destructuredNames,
  isUsableName,
};
