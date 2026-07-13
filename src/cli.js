'use strict';

// jerant CLI:
//   jerant export server.js [-o openapi.json] [--wait 500]
//   jerant diff old.json new.json [--fail-on breaking|any]
// Spec inputs for diff may be .json files or app entry files (exported live).

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const INSTANCES = Symbol.for('jerant.instances');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') args.output = argv[++i];
    else if (arg === '--wait') args.wait = Number(argv[++i]) || 0;
    else if (arg === '--fail-on') args.failOn = argv[++i];
    else if (arg === '--pretty') args.pretty = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else args._.push(arg);
  }
  return args;
}

const HELP = `jerant — zero-config API docs for Express

Usage:
  jerant export <server.js> [-o openapi.json] [--wait <ms>] [--pretty]
      Load the app, build the OpenAPI document and write it (stdout default).
      JERANT_EXPORT=1 is set so the app can skip listening if it wants to.

  jerant diff <old> <new> [--fail-on breaking|any]
      Compare two OpenAPI documents (either may be a .json file or an app
      entry file) and report breaking changes. Exits 1 when breaking changes
      are found (use --fail-on any to also fail on additions).
`;

async function loadSpecFromApp(entry, waitMs) {
  process.env.JERANT_EXPORT = '1';
  const resolved = path.resolve(entry);
  if (!fs.existsSync(resolved)) {
    throw new Error(`entry file not found: ${resolved}`);
  }
  await import(pathToFileURL(resolved).href);
  // Give the app a moment to finish async route registration.
  await new Promise((r) => setTimeout(r, waitMs));
  const instances = globalThis[INSTANCES] || [];
  const live = instances.filter((i) => i.enabled);
  if (!live.length) {
    throw new Error(
      `${entry} was loaded but never called jerant(app). ` +
      'Make sure jerant is installed on the app at module load time.'
    );
  }
  return live[live.length - 1].getSpec(true);
}

async function loadSpec(input, waitMs) {
  if (input.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  }
  return loadSpecFromApp(input, waitMs);
}

async function exportCommand(args) {
  const entry = args._[0];
  if (!entry) {
    process.stderr.write('jerant export: missing entry file\n\n' + HELP);
    return 2;
  }
  const spec = await loadSpecFromApp(entry, args.wait !== undefined ? args.wait : 500);
  const json = JSON.stringify(spec, null, args.pretty || args.output ? 2 : 0);
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(path.resolve(args.output), json + '\n');
    process.stderr.write(`jerant: wrote ${Object.keys(spec.paths || {}).length} path(s) to ${args.output}\n`);
  } else {
    process.stdout.write(json + '\n');
  }
  return 0;
}

// --- diff ---

function resolveRef(spec, schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 10) return schema;
  if (schema.$ref && typeof schema.$ref === 'string') {
    const m = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
    const target = m && spec.components && spec.components.schemas && spec.components.schemas[m[1]];
    return target ? resolveRef(spec, target, depth + 1) : {};
  }
  return schema;
}

function schemaTypeOf(schema) {
  if (!schema) return null;
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.filter((t) => t !== 'null').join('|') || null;
  return null;
}

function operations(spec) {
  const out = new Map();
  for (const [p, item] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(item || {})) {
      if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method)) {
        out.set(`${method.toUpperCase()} ${p}`, op);
      }
    }
  }
  return out;
}

function bodySchema(spec, op) {
  const content = op && op.requestBody && op.requestBody.content;
  if (!content) return null;
  const media = content['application/json'] || Object.values(content)[0];
  return media && media.schema ? resolveRef(spec, media.schema) : null;
}

function compareSchemas(oldSpec, newSpec, oldSchema, newSchema, where, findings, depth = 0) {
  if (!oldSchema || !newSchema || depth > 6) return;
  const oldType = schemaTypeOf(oldSchema);
  const newType = schemaTypeOf(newSchema);
  if (oldType && newType && oldType !== newType &&
      !(oldType === 'integer' && newType === 'number')) {
    findings.breaking.push(`${where}: type changed ${oldType} -> ${newType}`);
    return;
  }
  const oldProps = oldSchema.properties || {};
  const newProps = newSchema.properties || {};
  const oldRequired = new Set(oldSchema.required || []);
  const newRequired = new Set(newSchema.required || []);

  for (const name of Object.keys(oldProps)) {
    if (!newProps[name]) {
      if (where.includes('response')) {
        findings.breaking.push(`${where}: property "${name}" removed`);
      } else {
        findings.info.push(`${where}: request property "${name}" removed`);
      }
      continue;
    }
    compareSchemas(
      oldSpec, newSpec,
      resolveRef(oldSpec, oldProps[name]), resolveRef(newSpec, newProps[name]),
      `${where}.${name}`, findings, depth + 1
    );
  }
  for (const name of Object.keys(newProps)) {
    if (!oldProps[name]) {
      if (!where.includes('response') && newRequired.has(name)) {
        findings.breaking.push(`${where}: new required request property "${name}"`);
      } else {
        findings.info.push(`${where}: property "${name}" added`);
      }
    } else if (!where.includes('response') && newRequired.has(name) && !oldRequired.has(name)) {
      findings.breaking.push(`${where}: property "${name}" became required`);
    }
  }
  if (oldSchema.items && newSchema.items) {
    compareSchemas(
      oldSpec, newSpec,
      resolveRef(oldSpec, oldSchema.items), resolveRef(newSpec, newSchema.items),
      `${where}[]`, findings, depth + 1
    );
  }
}

function diffSpecs(oldSpec, newSpec) {
  const findings = { breaking: [], info: [] };
  const oldOps = operations(oldSpec);
  const newOps = operations(newSpec);

  for (const [key, oldOp] of oldOps) {
    const newOp = newOps.get(key);
    if (!newOp) {
      findings.breaking.push(`${key}: operation removed`);
      continue;
    }

    // Parameters that became required (or disappeared while required).
    const params = (op) => new Map((op.parameters || []).map((p) => [`${p.in}:${p.name}`, p]));
    const oldParams = params(oldOp);
    const newParams = params(newOp);
    for (const [pkey, newParam] of newParams) {
      const oldParam = oldParams.get(pkey);
      if (newParam.required && (!oldParam || !oldParam.required)) {
        if (newParam.in !== 'path') {
          findings.breaking.push(`${key}: parameter "${newParam.name}" (${newParam.in}) became required`);
        }
      } else if (!oldParam) {
        findings.info.push(`${key}: parameter "${newParam.name}" (${newParam.in}) added`);
      }
    }

    compareSchemas(oldSpec, newSpec, bodySchema(oldSpec, oldOp), bodySchema(newSpec, newOp), `${key} body`, findings);

    const oldResponses = oldOp.responses || {};
    const newResponses = newOp.responses || {};
    for (const status of Object.keys(oldResponses)) {
      if (!newResponses[status]) {
        if (Number(status) < 400) findings.breaking.push(`${key}: response ${status} removed`);
        else findings.info.push(`${key}: response ${status} removed`);
        continue;
      }
      const mediaOf = (r) => r.content && (r.content['application/json'] || Object.values(r.content)[0]);
      const oldMedia = mediaOf(oldResponses[status]);
      const newMedia = mediaOf(newResponses[status]);
      if (oldMedia && oldMedia.schema && newMedia && newMedia.schema) {
        compareSchemas(
          oldSpec, newSpec,
          resolveRef(oldSpec, oldMedia.schema), resolveRef(newSpec, newMedia.schema),
          `${key} response ${status}`, findings
        );
      }
    }
  }
  for (const key of newOps.keys()) {
    if (!oldOps.has(key)) findings.info.push(`${key}: operation added`);
  }
  return findings;
}

async function diffCommand(args) {
  const [oldInput, newInput] = args._;
  if (!oldInput || !newInput) {
    process.stderr.write('jerant diff: needs two inputs (spec files or app entries)\n\n' + HELP);
    return 2;
  }
  const waitMs = args.wait !== undefined ? args.wait : 500;
  const oldSpec = await loadSpec(oldInput, waitMs);
  const newSpec = await loadSpec(newInput, waitMs);
  const { breaking, info } = diffSpecs(oldSpec, newSpec);

  if (breaking.length) {
    process.stdout.write(`BREAKING CHANGES (${breaking.length}):\n`);
    for (const line of breaking) process.stdout.write(`  ✖ ${line}\n`);
  }
  if (info.length) {
    process.stdout.write(`Other changes (${info.length}):\n`);
    for (const line of info) process.stdout.write(`  · ${line}\n`);
  }
  if (!breaking.length && !info.length) process.stdout.write('No changes.\n');

  if (breaking.length) return 1;
  if (args.failOn === 'any' && info.length) return 1;
  return 0;
}

async function run(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (!command || args.help || command === 'help') {
    process.stdout.write(HELP);
    return command ? 0 : 2;
  }
  if (command === 'export') return exportCommand(args);
  if (command === 'diff') return diffCommand(args);
  process.stderr.write(`jerant: unknown command "${command}"\n\n` + HELP);
  return 2;
}

module.exports = { run, diffSpecs, parseArgs };
