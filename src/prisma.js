'use strict';

// Prisma-aware tracing: when a handler (or the service it calls) passes
// request data into prisma.<model>.create/update, the model definition in
// schema.prisma names and types the body fields far better than untyped
// code analysis can. Parsing is line-based and best-effort — a schema that
// fails to parse simply contributes nothing.

const fs = require('fs');
const path = require('path');

const SCALAR_TYPES = {
  String: { type: 'string' },
  Int: { type: 'integer' },
  BigInt: { type: 'integer' },
  Float: { type: 'number' },
  Decimal: { type: 'number' },
  Boolean: { type: 'boolean' },
  DateTime: { type: 'string', format: 'date-time' },
  Json: {},
  Bytes: { type: 'string', format: 'byte' },
};

/** Parse schema.prisma text into {models: {lowername: {name, fields}}, enums}. */
function parsePrismaSchema(text) {
  const models = {};
  const enums = {};

  const enumRe = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = enumRe.exec(text))) {
    const values = m[2]
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => /^\w+$/.test(line));
    if (values.length) enums[m[1]] = values;
  }

  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
  while ((m = modelRe.exec(text))) {
    const modelName = m[1];
    const fields = {};
    for (const rawLine of m[2].split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!field) continue;
      const [, name, type, isList, isOptional, attributes] = field;
      if (attributes.includes('@relation')) continue; // relation object fields
      if (attributes.includes('@ignore')) continue;

      let schema;
      if (SCALAR_TYPES[type]) schema = { ...SCALAR_TYPES[type] };
      else if (enums[type]) schema = { type: 'string', enum: [...enums[type]] };
      else continue; // relation to another model

      if (isList) schema = { type: 'array', items: schema };

      // Server-managed columns are never client-supplied input. A literal
      // @default (e.g. @default(MEMBER)) only makes the field optional;
      // generated defaults (now(), autoincrement(), uuid()) mark it managed.
      const generatedDefault = /@default\s*\(\s*(?:now|autoincrement|uuid|cuid|nanoid|dbgenerated)\s*\(/.test(attributes);
      const serverManaged =
        attributes.includes('@id') ||
        attributes.includes('@updatedAt') ||
        generatedDefault;
      fields[name] = {
        schema,
        required: !isOptional && !isList && !serverManaged && !attributes.includes('@default'),
        serverManaged,
      };
    }
    if (Object.keys(fields).length) {
      models[modelName.toLowerCase()] = { name: modelName, fields };
    }
  }
  return { models, enums };
}

// schemaPath -> parsed schema (mtime-checked)
const schemaCache = new Map();

function loadPrismaSchema(prismaOpts) {
  if (!prismaOpts || prismaOpts.enabled === false) return null;
  const candidates = prismaOpts.schemaPath
    ? [path.resolve(prismaOpts.schemaPath)]
    : [
        path.resolve('prisma/schema.prisma'),
        path.resolve('schema.prisma'),
      ];
  for (const file of candidates) {
    try {
      const stat = fs.statSync(file);
      const cached = schemaCache.get(file);
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.parsed;
      const parsed = parsePrismaSchema(fs.readFileSync(file, 'utf8'));
      schemaCache.set(file, { mtimeMs: stat.mtimeMs, parsed });
      return parsed;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/**
 * Body schema for a prisma model's client-writable fields:
 * { type, properties, required } or null when the model is unknown.
 */
function modelBodySchema(prismaSchema, modelName) {
  if (!prismaSchema || !modelName) return null;
  const model = prismaSchema.models[String(modelName).toLowerCase()];
  if (!model) return null;
  const properties = {};
  const required = [];
  for (const [name, field] of Object.entries(model.fields)) {
    if (field.serverManaged) continue;
    properties[name] = field.schema;
    if (field.required) required.push(name);
  }
  if (!Object.keys(properties).length) return null;
  const schema = { type: 'object', properties };
  if (required.length) schema.required = required;
  return schema;
}

/** Test helper. */
function clearPrismaCache() {
  schemaCache.clear();
}

module.exports = { parsePrismaSchema, loadPrismaSchema, modelBodySchema, clearPrismaCache };
