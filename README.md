# jerant

**Zero-config automatic API documentation for Express, Fastify, Koa and Hono.**

FastAPI-style docs — OpenAPI 3.0/3.1 + a modern dark/light UI — served from **your own app, on the same port**, with no annotations required. Routes are discovered automatically, schemas are learned from your validation libraries, your Prisma schema, your source code, and real traffic.

```bash
npm install jerant
```

```js
const express = require("express");
const { jerant } = require("jerant");

const app = express();
jerant(app);

app.listen(3000);
```

That's it:

| URL | What |
| --- | --- |
| `http://localhost:3000` | Your application, unchanged |
| `http://localhost:3000/docs` | Interactive docs (dark & light themes, search, try-it-out, teach mode) |
| `http://localhost:3000/openapi.json` | OpenAPI document (3.0 by default, 3.1 on request) |

No separate documentation server, no code generation step, no YAML.

---

## Table of contents

1. [How your API gets documented](#1-how-your-api-gets-documented)
2. [Confidence scores & teach mode](#2-confidence-scores--teach-mode)
3. [Validation libraries](#3-validation-libraries)
4. [Prisma-aware tracing](#4-prisma-aware-tracing)
5. [Authentication & the Authorize button](#5-authentication--the-authorize-button)
6. [Custom validation errors](#6-custom-validation-errors)
7. [Response envelopes & default responses](#7-response-envelopes--default-responses)
8. [Example values](#8-example-values)
9. [Tag groups](#9-tag-groups)
10. [The docs UI](#10-the-docs-ui)
11. [CLI: export & breaking-change guard](#11-cli-export--breaking-change-guard)
12. [Schema drift detection](#12-schema-drift-detection)
13. [File uploads / form-data](#13-file-uploads--form-data)
14. [Data safety & redaction](#14-data-safety--redaction)
15. [Storage & persistence](#15-storage--persistence)
16. [Fastify, Koa and Hono](#16-fastify-koa-and-hono)
17. [Full configuration reference](#17-full-configuration-reference)
18. [Programmatic API](#18-programmatic-api)
19. [Production notes](#19-production-notes)
20. [Large APIs](#20-large-apis)
21. [Architecture](#21-architecture)

---

## 1. How your API gets documented

jerant picks the **highest-quality schema source available** for every route, automatically:

| Priority | Source | Confidence | What it needs from you |
|---|---|---|---|
| 1 | **Validation schemas** — Zod, Joi, Yup, AJV, plain JSON Schema, class-validator | **100%** | a `validate({...})` on the route |
| 1 | express-validator chains, class-validator classes | **90%** | nothing — detected automatically |
| 2 | **Runtime traffic analysis** — real requests/responses observed live | **40–90%** | just use the API |
| 3 | **Prisma schema tracing** — `prisma.user.create({data: req.body})` + `schema.prisma` | **75%** | nothing |
| 4 | **Static code analysis** — fields your handlers read (`req.body.x`, `{a} = req.body`), status codes, upload config; includes a full project source scan that sees through wrappers, named controllers, and follows payloads down to SQL/ORM writes | **55%** | nothing |
| 5 | **Route scanning** — every route (nested routers included) appears from the moment the server starts | **25%** | nothing |

Every operation shows its source and confidence in the UI and carries machine-readable metadata in `x-jerant` (source, confidence, observation count, drift issues).

## 2. Confidence scores & teach mode

**Raising a score is always the same move: give jerant a better source.**

- Add `validate({...})` → instant **100%**
- Handler writes into a Prisma model → **75%** automatically
- Send real requests → climbs to **~90%** (saturates around 30 observations)

**Teach mode** closes the loop from inside the docs. Any operation below 50% confidence is marked **◌ learning**; open it and a **"◌ Teach this endpoint"** panel appears where anyone can freely enter:

- **path params** — one input per `{param}`
- **query params** — unlimited key/value rows (no declaration needed)
- **headers** — e.g. an `Authorization` token
- **body** — raw JSON, form-data (with real file uploads), or url-encoded

Hitting **Send request** exercises your real app; the analyzer observes the request and response, the confidence chip updates live, and a reload shows the learned schema and parameters. Once an operation crosses 50% it graduates to a normal documented endpoint. Learning operations are never opened automatically, and the panel is only built when you open one, so large APIs stay fast. Disable with `teachMode: false`. [Production mode](#19-production-notes) turns it off for you.

## 3. Validation libraries

### Zod (recommended)

`validate()` gives you real request validation *and* perfect docs from one declaration:

```js
const { z } = require("zod");
const { jerant, validate } = require("jerant");

app.post(
  "/users",
  validate({
    summary: "Create a user",
    tags: ["users"],
    body: z.object({
      name: z.string().min(1),
      email: z.string().email(),
      age: z.number().int().optional(),
    }),
    responses: { 201: z.object({ id: z.number(), name: z.string() }) },
  }),
  (req, res) => res.status(201).json({ id: 1, name: req.body.name })
);
```

Invalid requests get a structured error response; the docs get exact schemas. Zod v3 and v4 are both supported (including `z.iso.date()`, `z.looseObject()`, discriminated unions).

### Joi, Yup, AJV, JSON Schema, class-validator

`validate()` accepts them all — the library is detected automatically:

```js
validate({ body: Joi.object({ sku: Joi.string().required() }) })
validate({ body: yup.object({ email: yup.string().email().required() }) })
validate({ body: ajv.compile(schema) })      // compiled AJV validator
validate({ body: { type: "object", properties: { id: { type: "integer" } } } })
```

### express-validator

Detected with no jerant code at all:

```js
app.post("/subscribe", body("email").isEmail(), handler);
// documented as { email: string (format: email), required }
```

### Documentation without validation

`doc()` attaches metadata and schemas without enforcing anything:

```js
const { doc } = require("jerant");
app.get("/reports", doc({ summary: "List reports", tags: ["reports"] }), handler);
```

## 4. Prisma-aware tracing

When a handler — or the service function it calls — writes request data into a Prisma model, jerant reads `schema.prisma` and types the body fields from the model:

```js
app.post("/users", async (req, res) => {
  const user = await prisma.user.create({ data: req.body });
  res.status(201).json(user);
});
// documented from schema.prisma: email (string, required), name (string,
// required), age (integer), role (enum ADMIN|MEMBER)
```

Server-managed columns are excluded automatically: `@id`, `@updatedAt`, and generated defaults (`now()`, `autoincrement()`, `uuid()`). Fields with literal defaults (`@default(MEMBER)`) are documented as optional. Configure with `prisma: { schemaPath: "db/schema.prisma" }`, disable with `prisma: { enabled: false }`.

## 5. Authentication & the Authorize button

Declare your auth model once — every operation documents it and Swagger UI shows its **Authorize** button:

```js
jerant(app, { security: "bearer" });   // or "apiKey", "basic", "cookie"
```

Mark exceptions per route (`security: []` = public):

```js
app.post("/login", validate({ security: [] }), loginHandler);
```

Full control:

```js
jerant(app, {
  security: {
    schemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      apiKeyAuth: { type: "apiKey", in: "header", name: "X-Service-Key" },
    },
    default: "bearerAuth",
  },
});
```

With no configuration at all, jerant **auto-detects auth middleware** from its source — `req.headers.authorization` reads, `Bearer` checks, `passport.authenticate(...)`, `x-api-key` lookups, or middleware named `requireAuth`/`isAuthenticated`/etc. — and documents those routes as secured. Disable with `security: false` or `security: { autoDetect: false }`.

## 6. Custom validation errors

The default failure response is `400 {error, details}`. Reshape it app-wide:

```js
jerant(app, {
  validationError: {
    status: 422,
    formatter: ({ details }) => ({ success: false, errors: details }),
  },
});
```

…or per route: `validate({ body: schema, error: { status: 422 } })`.

## 7. Response envelopes & default responses

If every response ships in a wrapper, declare it once — declared response schemas slot into `$data` automatically:

```js
jerant(app, {
  envelope: { success: "boolean", message: "string", data: "$data" },
  defaultResponses: {
    401: { description: "Not signed in", schema: { type: "object", properties: { error: { type: "string" } } } },
    500: { description: "Internal error" },
  },
});
```

`defaultResponses` are defined **once** under `components.responses` (`Default401`, `Default500`, …), and every operation that doesn't already document that status gets a `$ref` to it. They are not copied into each operation. The envelope also accepts a full JSON Schema containing a `"$data"` slot, plus `{ schema, statuses: [200, 201] }` to control which statuses get wrapped (default: all 2xx).

## 8. Example values

Every request/response body carries an example whose values are the **type names** — instant, self-explanatory, and guaranteed to never leak data:

```json
{ "email": "email", "password": "string", "age": "number", "score": "float" }
```

| `examples` option | Behavior |
|---|---|
| `"placeholder"` (default) | type-name values as above |
| `"captured"` | real (redacted) traffic payloads |
| `false` | no examples |

## 9. Tag groups

Give the sidebar groups descriptions and a fixed order:

```js
jerant(app, {
  tags: [
    { name: "users", description: "User management" },
    { name: "orders", description: "Order processing" },
    "internal",
  ],
});
```

Routes without explicit tags are grouped by their first meaningful path segment (`/api/v1/users/…` → `users`).

## 10. The docs UI

The default UI comes in two themes:

| Theme | Surfaces | Text & accents |
|---|---|---|
| **dark** | black | lavender text, violet accents |
| **light** | white | deep-violet and lavender text, violet accents |

`theme: "auto"` (the default) follows the OS setting. The ☾/☀ button in the header switches themes and remembers the choice. Force one with `theme: "dark"` or `theme: "light"`.

Features:

- a **stats header**: endpoints, tag groups, schemas, average confidence, drift issues, and endpoints still in learning mode
- **per-operation confidence chips** — color-graded score with source, observation count and drift warnings on hover
- **Expand all / Collapse all**, **Copy spec URL**, **Download JSON** buttons
- **`/`** keyboard shortcut to jump to the endpoint search
- **teach panels** on low-confidence operations (see [§2](#2-confidence-scores--teach-mode))
- color palette checked for contrast, with colorblind-safe method badges in both themes

### Choosing a UI

```js
jerant(app, { ui: "swagger" });   // default
jerant(app, { ui: "redoc" });     // Redoc, same dark/light theme
jerant(app, { ui: "scalar" });    // Scalar, purple theme (dark or light)
```

### Swagger UI settings

Any JSON-serializable [Swagger UI option](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/) is passed through and overrides jerant's defaults:

```js
jerant(app, {
  swaggerUi: {
    docExpansion: "none",        // start collapsed
    defaultModelsExpandDepth: -1, // hide the Schemas section
    syntaxHighlight: false,      // faster rendering of big payloads
    maxDisplayedTags: 50,
  },
});
```

Function-valued options (plugins, `onComplete`, …) are dropped because they can't be embedded in the page. Use `ui: (ctx) => html` if you need them.

### Self-hosting the assets (offline / strict CSP)

```bash
npm install swagger-ui-dist
```

```js
jerant(app, { assets: "local" });   // served at /docs/assets/*, allowlisted
```

### Bring your own UI

```js
jerant(app, { ui: false });                    // serve only /openapi.json
app.get("/mydocs", (req, res) => res.sendFile("my-ui.html"));

jerant(app, { ui: { html: myHtmlString } });   // your page at docsPath

jerant(app, {                                  // or a render function
  ui: ({ openapiPath, title }) => `<html>… fetch("${openapiPath}") …</html>`,
});
```

Custom pages can reuse jerant's theme. The render function receives `themeCss` (the stylesheet) and `themeCssPath`, and the stylesheet is also served at `/docs/theme.css` and exported from the package:

```js
const { themeCss } = require("jerant");
// <html data-theme="dark|light">…<style>${themeCss}</style>…
// Without a data-theme attribute the CSS follows prefers-color-scheme.
```

Any custom UI gets the full spec including the `x-jerant` metadata (source, confidence, drift), so you can render your own badges.

## 11. CLI: export & breaking-change guard

```bash
npx jerant export server.js -o openapi.json      # CI / codegen / Postman
npx jerant diff openapi.main.json openapi.json   # exits 1 on breaking changes
npx jerant diff main-server.js server.js         # app entries work too
```

- **`export`** loads your app (with `JERANT_EXPORT=1` set, so you can skip `listen()` if you want) and writes the full OpenAPI document. `--wait <ms>` allows extra time for async route registration; `--pretty` formats stdout output.
- **`diff`** reports **breaking changes** — removed operations, new required request fields/params, type changes, removed response properties — and exits `1` when any are found (`--fail-on any` also fails on additions). Wire it into CI to block accidental breakage.

## 12. Schema drift detection

When a route has a declared schema *and* enough observed traffic (≥5 requests), jerant compares the two and flags mismatches:

- **type-mismatch** — declared `number`, traffic shows `string`
- **required-field-never-observed** — declared required, absent from every payload
- **undeclared-field** — appears in traffic but the schema forbids extras

Findings land in `x-jerant.drift` per operation with a spec-level summary; drifting operations show a **⚠** on their confidence chip. Disable with `driftDetection: false`.

## 13. File uploads / form-data

jerant documents the correct request media type per route:

- Routes with upload middleware (**multer**, express-fileupload) are documented as `multipart/form-data` automatically; the source scan recovers real field names from your config (`upload.single('avatar')`, `upload.fields([{ name: 'id_front' }])`).
- File fields seen at runtime (`req.file` / `req.files`) appear as binary inputs alongside schema fields.
- Explicit control when you want it:

```js
app.post("/avatars",
  upload.single("avatar"),
  doc({ contentType: "multipart/form-data", files: ["avatar"] }),
  handler
);
```

## 14. Data safety & redaction

jerant **never stores** authorization headers, cookies, or session identifiers (headers are not captured at all), and automatically redacts sensitive fields from stored payloads and examples — `password`, `token`, `secret`, `apiKey`, credit-card fields, and anything that *looks* like a credential (JWTs, `Bearer …` values):

```json
{ "password": "***REDACTED***" }
```

Add your own with `redactKeys: ["internal_code"]`. With the default `examples: "placeholder"`, stored payloads never surface in the docs at all.

## 15. Storage & persistence

Learned schemas live in memory by default. To survive restarts:

```js
jerant(app, { storage: { mode: "file", path: ".jerant/data.json" } });
```

Multiple instances behind a load balancer should share a store instead — anything with `load()`/`save()` works (both may be async):

```js
jerant(app, {
  storage: {
    mode: "custom",
    store: {
      load: async () => JSON.parse(await redis.get("jerant") || "null"),
      save: async (data) => redis.set("jerant", JSON.stringify(data)),
    },
  },
});
```

Writes are debounced and atomic (file mode): a temporary file is written and then renamed over the real one. Scheduled saves are written **asynchronously**, so disk I/O never blocks the event loop. At most one write runs at a time, and saves requested during a write are merged into a single follow-up write. `docs.flush()` and the flush on process exit stay synchronous so the data is on disk before they return.

## 16. Fastify, Koa and Hono

The core is framework-agnostic; adapters ship in the box and provide the same docs, runtime learning, and UI:

```js
// Fastify — route schemas become first-class docs (call before routes)
const { jerantFastify } = require("jerant");
jerantFastify(fastify);

// Koa — pass your @koa/router instance(s)
const { jerantKoa } = require("jerant");
jerantKoa(app, { routers: [router] });

// Hono — call before registering routes
const { jerantHono } = require("jerant");
jerantHono(app);
```

## 17. Full configuration reference

Everything is optional:

```js
jerant(app, {
  // Identity (defaults come from your package.json)
  title: "My API",
  version: "2.0.0",
  description: "…",
  servers: [{ url: "https://api.example.com" }],

  // Paths
  docsPath: "/docs",
  openapiPath: "/openapi.json",
  openapi: "3.0",                  // "3.1" for an OpenAPI 3.1 document

  // Environment
  mode: "development",             // "production" (default when NODE_ENV=production)

  // UI
  ui: "swagger",                   // "redoc" | "scalar" | false | {html} | (ctx) => html
  theme: "auto",                   // "dark" | "light"
  swaggerUi: { docExpansion: "list" }, // passed through to Swagger UI
  assets: "cdn",                   // "local" = self-hosted swagger-ui-dist
  cdn: "https://unpkg.com/swagger-ui-dist@5",

  // Access & shaping
  auth: { username: "docs", password: process.env.DOCS_PASSWORD }, // or (req) => boolean
  exclude: ["/internal/*", "GET /health", /^\/admin/],
  transformSpec: (spec) => { spec.info["x-logo"] = { url: "/logo.png" }; },
  cacheTtlMs: 5000,                // min interval between background rebuilds

  // Documentation behavior
  security: "bearer",              // auth modeling + Authorize button (§5)
  validationError: { status: 422 },// validate() failure shape (§6)
  envelope: { success: "boolean", data: "$data" },   // §7
  defaultResponses: { 500: { description: "Internal error" } },
  tags: [{ name: "users", description: "User management" }],
  examples: "placeholder",         // "captured" | false (§8)
  teachMode: true,                 // open low-confidence ops for learning (§2)
  driftDetection: true,            // §12

  // Learning engine
  runtime: {
    enabled: true,                 // runtime traffic analysis
    sampleRate: 1,                 // sample a fraction of requests
    maxExamples: 3,                // stored examples per route/status
    maxObservations: 1000,         // merge cap per route
    maxBodyBytes: 102400,          // skip larger payloads
    adaptive: true,                // sample well-known routes less and less
    warmup: 50,                    // full-rate observations per route first
  },
  sourceScan: { enabled: true },   // project source analysis
  prisma: { enabled: true },       // schema.prisma tracing (§4)

  // Data safety
  redactKeys: ["internal_id"],

  // Persistence (§15)
  storage: { mode: "memory" },     // "file" | "custom"
});
```

Disable entirely with `enabled: false` or the `JERANT_DISABLED=1` environment variable.

## 18. Programmatic API

```js
const docs = jerant(app);
docs.getSpec();   // current OpenAPI document (cached; rebuilt if stale)
docs.refresh();   // force a rebuild
docs.flush();     // persist learned schemas now
docs.close();     // stop persistence timers
```

## 19. Production notes

### Production mode

```js
jerant(app, { mode: "production" }); // the default when NODE_ENV=production
```

Production mode turns off the learning features and makes traffic recording cheaper. Every value below is only a default, so any option you set yourself still wins:

| | development | production |
|---|---|---|
| `teachMode` (learning chips + teach panels) | on | **off** |
| `runtime.sampleRate` | 1 | **0.1** |
| `runtime.maxObservations` per route | 1000 | **200** |
| `runtime.warmup` (full-rate observations) | 50 | **20** |

### Protecting the docs

```js
// HTTP Basic auth (compared in constant time)
jerant(app, { auth: { username: "docs", password: process.env.DOCS_PASSWORD } });

// Or any check against the framework's request object
// (Express req, Fastify request, Koa ctx, Hono c); may be async.
jerant(app, { auth: (req) => req.user?.role === "admin" });
```

`auth` covers the docs page, the spec, `theme.css` and self-hosted assets. Your own routes are not affected. With the function form, any session or auth middleware that sets `req.user` must run before jerant's routes.

### Request recording cost

- **Overhead**: the middleware only wraps `res.json`/`res.send` (restored after each response) and defers all analysis to `setImmediate` after the response is sent — nothing blocks the request path. Each recorded payload is serialized once; that single pass measures its size, copies it, and is then redacted in place. Use `runtime.sampleRate` to sample under heavy load.
- **Adaptive sampling** (on by default): a route is recorded at full rate for its first `runtime.warmup` requests. After that it is recorded with probability `warmup / observations`, so a route's recording cost falls toward zero as it becomes well known (about 4.5k of 1M requests get recorded). Routes that reach `maxObservations`, or that are `exclude`d, are skipped before any work is done.
- **Examples** are only stored when `examples: "captured"` is set, because no other mode displays them.
- **Call order**: call `jerant(app)` right after `express()` (before your body parser and routes) so the analyzer sees every response. Route *registration* order doesn't matter — discovery is lazy.
- **CSP**: the `/docs` page loads UI assets from a CDN by default and uses an inline script. Under a strict Content-Security-Policy use `assets: "local"` or allow the `cdn` origin.
- **CI**: `npx jerant export` + `npx jerant diff` give you spec artifacts and a breaking-change gate without booting a server in tests.

## 20. Large APIs

jerant is built to keep docs for thousands of operations fast, both in the browser and on the server.

**What happens on the server**

- **The spec is built once and served from cache.** Each document is serialized a single time and given a strong `ETag` (unchanged → `304 Not Modified`). It is compressed with gzip or brotli on Node's thread pool, not the event loop.
- **Requests never wait for a rebuild.** When routes or learned data change, the next request still gets the cached document while the new one is built in the background. Rebuilds run at most once per `cacheTtlMs` (5 s), and never when nothing changed. A rebuild that produces identical content keeps the old `ETag`.
- **Per-route analysis is cached.** Schema detection and handler-source analysis are redone only for routes whose handlers changed. Project source files are indexed once instead of being scanned again for every route. On a 3,000-operation project the first build dropped from ~3.3 s to ~0.3 s, and rebuilds take ~70 ms.
- **Default responses are shared.** `defaultResponses` live once in `components.responses`, not inside every operation.
- **Self-hosted assets** are read from disk once and kept in memory. Their URLs carry the `swagger-ui-dist` version (`?v=5.x.y`), so they can be cached as `immutable`; unversioned URLs must revalidate.

**What happens in the browser**

- **OpenAPI 3.0 by default.** Swagger UI renders 3.0 documents much faster than 3.1. jerant converts its internal 3.1 schemas to 3.0 (`nullable`, `enum` for `const`, boolean `exclusiveMinimum`, …). Use `openapi: "3.1"` if your tooling needs 3.1.
- **The spec is downloaded once.** The page starts fetching it in `<head>`, in parallel with the UI bundle, and hands the parsed object straight to Swagger UI.
- **Decoration is incremental.** Confidence chips and teach panels are added only to the operation blocks that just changed, batched once per animation frame. The page never re-sweeps the whole document.
- **Nothing opens by itself.** Above 150 operations the page starts with every tag collapsed and the models section hidden (unless you set `swaggerUi.docExpansion` or `defaultModelsExpandDepth` yourself). Learning operations are never auto-opened.

**Recommended settings for very large APIs**

```js
jerant(app, {
  mode: "production",                       // or NODE_ENV=production
  exclude: ["/internal/*", "/health", "/metrics"],
  swaggerUi: {
    docExpansion: "none",
    defaultModelsExpandDepth: -1,
    syntaxHighlight: false,                 // big example payloads render faster
    maxDisplayedTags: 30,                   // with filter: true (default) to search the rest
  },
  sourceScan: { maxFiles: 2000 },           // raise if your routes span more files
  storage: { mode: "file" },                // writes are async and coalesced
});
```

If you put a CDN or reverse proxy in front of `/openapi.json`, keep its `Cache-Control: no-cache`. That header lets clients store the document but makes them revalidate it with the `ETag`, which costs a 304 when nothing changed.

## 21. Architecture

```
Express / Fastify / Koa / Hono App
    │
Route Scanner ──► discovers every route & nested router
    │
    ├── Validation Adapters (Zod / Joi / Yup / AJV / express-validator / class-validator)
    ├── Prisma Schema Tracing (schema.prisma → typed body fields)
    └── Runtime Analyzer ──► Schema Inference Engine (+ redaction, confidence, drift)
    │
OpenAPI Generator (security, envelopes, tags, shared default responses, teach mode; 3.1 → 3.0 by default)
    │
    ├── /openapi.json          (also: npx jerant export / diff)
    └── /docs (dark UI: Swagger / Redoc / Scalar / your own)
```

Schema adapters and framework adapters both operate on plain instances — nothing in jerant imports a web framework.

## Examples

```bash
node examples/zod-app.js      # modern app with Zod validation
node examples/legacy-app.js   # legacy app, docs learned from traffic
```

## Roadmap

- **Done**: Express/Fastify/Koa/Hono · all major validation libraries · runtime learning + teach mode · security modeling · envelopes & default responses · drift detection · Prisma tracing · export/diff CLI · pluggable storage · dark UI with Swagger/Redoc/Scalar/custom
- **Next**: NestJS adapter, TypeScript metadata, SDK generation

## License

MIT
