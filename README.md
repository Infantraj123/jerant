# jerant

Zero-config automatic API documentation for Express. FastAPI-style docs — OpenAPI 3.1 + Swagger UI — served from **your own app, on the same port**, with no annotations required.

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
| `http://localhost:3000/docs` | Swagger UI (search, try-it-out, examples) |
| `http://localhost:3000/openapi.json` | OpenAPI 3.1 document |

No separate documentation server, no code generation step, no YAML.

## How it documents your API

jerant picks the **highest-quality schema source available** for every route, automatically:

1. **Validation schemas** — Zod, Joi, Yup, AJV, express-validator, class-validator schemas found on your routes are converted to OpenAPI schemas (100% confidence).
2. **Runtime traffic analysis** — for routes with no validation, jerant observes real requests and responses, infers schemas (types, nested objects, optional and nullable fields), and keeps improving them as more traffic flows.
3. **Static code analysis** — for routes with no validation and no traffic yet, jerant reads your code itself: fields the handlers access (`req.body.x`, `{a, b} = req.body`, `req.query.x`), file uploads (`req.file`/`req.files.doc` → documented as `multipart/form-data` with binary fields), and response status codes (`res.status(422)`). This includes a **full project source scan** (the entry script's directory, configurable via `sourceScan`), so it also sees what live function objects hide: handlers wrapped in `asyncHandler(...)` closures, controllers referenced by name from other files, and the real upload field names configured on the route (`upload.single('avatar')`, `upload.array('photos')`, `upload.fields([{ name: 'id_front' }])`). When a handler hands the whole payload to a service (`orderService.create(req.body)`), jerant **follows the payload down to the database query** — fields read from the service's parameter, columns in SQL `INSERT INTO ... (...)` / `UPDATE ... SET`, and query-builder writes like `.insert({ status: data.status })` all become documented request fields.
4. **Route scanning** — every route (including nested routers) appears in the docs from the moment the server starts, even before any traffic.

Every operation in the UI shows its **source and confidence score**:

```
POST /users      Source: Zod               Confidence: 100%
POST /orders     Source: Joi               Confidence: 100%
POST /payments   Source: Runtime Analysis  Confidence: 82%
```

## Works with your validation library

### Zod (recommended)

Use the optional `validate()` helper to get real request validation *and* perfect docs from one declaration:

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
    responses: {
      201: z.object({ id: z.number(), name: z.string() }),
    },
  }),
  (req, res) => res.status(201).json({ id: 1, name: req.body.name })
);
```

Invalid requests get a `400` with structured details; the docs get exact request/response schemas.

### Joi, Yup, AJV, JSON Schema, class-validator

`validate()` accepts them all — jerant detects the library automatically:

```js
validate({ body: Joi.object({ sku: Joi.string().required() }) })
validate({ body: yup.object({ email: yup.string().email().required() }) })
validate({ body: ajv.compile(schema) })      // compiled AJV validator
validate({ body: { type: "object", properties: { id: { type: "integer" } } } })
```

### express-validator

Detected automatically — no jerant code needed:

```js
app.post("/subscribe", body("email").isEmail(), handler);
// documented as { email: string (format: email), required }
```

### No validation at all

Legacy apps still get useful docs. jerant's runtime analyzer watches `req.body`, `req.query`, `req.params`, response bodies and status codes, merges observations into stable schemas, and captures (redacted) example payloads:

```
Observation 1: { "name": "John" }
Observation 2: { "name": "Alice", "age": 25 }
Result:        name: string (required), age: integer (optional)
```

### Form-data vs raw JSON

jerant documents the correct request media type per route:

- Routes with upload middleware (**multer**, express-fileupload) are automatically documented as `multipart/form-data` — no traffic or config needed. The source scan recovers the actual field names from your multer config (`upload.single('avatar')`, `upload.fields([{ name: 'id_front' }])`).
- File fields seen at runtime (`req.file`/`req.files`) appear as binary file inputs alongside the text fields from your validation schema.
- Everything else defaults to raw `application/json`, or whatever media type live traffic actually uses.
- Explicit control when you want it:

```js
app.post("/avatars",
  upload.single("avatar"),
  doc({ contentType: "multipart/form-data", files: ["avatar"] }),
  handler
);
```

### Documentation without validation

`doc()` attaches metadata and schemas without enforcing anything:

```js
const { doc } = require("jerant");
app.get("/reports", doc({ summary: "List reports", tags: ["reports"] }), handler);
```

## Security

jerant **never stores** authorization headers, cookies, or session identifiers (headers are not captured at all), and automatically redacts sensitive fields from stored payloads and examples — `password`, `token`, `secret`, `apiKey`, `client_secret`, credit-card fields, and anything that *looks* like a credential (JWTs, `Bearer …` values):

```json
{ "password": "***REDACTED***" }
```

Add your own fields with `redactKeys: ["internal_code"]`.

## Configuration

Everything is optional:

```js
jerant(app, {
  title: "My API",                 // default: your package.json name
  version: "2.0.0",                // default: your package.json version
  description: "…",
  docsPath: "/docs",
  openapiPath: "/openapi.json",
  servers: [{ url: "https://api.example.com" }],
  redactKeys: ["internal_id"],     // extra fields to redact
  cdn: "https://unpkg.com/swagger-ui-dist@5", // self-host if you prefer
  runtime: {
    enabled: true,                 // runtime traffic analysis
    sampleRate: 1,                 // sample a fraction of requests
    maxExamples: 3,                // stored examples per route/status
    maxObservations: 1000,         // merge cap per route
    maxBodyBytes: 102400,          // skip larger payloads
  },
  storage: {
    mode: "memory",                // or "file" to survive restarts
    path: ".jerant/data.json",
  },
});
```

Disable entirely with `enabled: false` or the `JERANT_DISABLED=1` environment variable.

The returned instance gives you programmatic access:

```js
const docs = jerant(app);
docs.getSpec();   // current OpenAPI document
docs.refresh();   // force a rebuild
docs.flush();     // persist learned schemas now (file mode)
```

## Notes for production

- **Overhead**: the middleware only wraps `res.json`/`res.send` and defers all analysis to `setImmediate` after the response is sent — nothing blocks the request path. Use `runtime.sampleRate` to sample under heavy load.
- **Call order**: call `jerant(app)` right after `express()` (before your body parser and routes) so the analyzer sees every response. Routes are discovered lazily, so registration order of *routes* doesn't matter.
- **CSP**: the `/docs` page loads Swagger UI assets from a CDN and uses an inline script. If you run a strict Content-Security-Policy (e.g. helmet), allow the `cdn` origin or point `cdn` at self-hosted `swagger-ui-dist` assets.
- **Persistence**: `storage.mode: "file"` writes learned schemas with debounced atomic writes and flushes on exit, so runtime-inferred docs survive restarts.

## Examples

```bash
node examples/zod-app.js      # modern app with Zod validation
node examples/legacy-app.js   # legacy app, docs learned from traffic
```

## Architecture

```
Express App
    │
Route Scanner ──► discovers every route & nested router
    │
    ├── Validation Adapters (Zod / Joi / Yup / AJV / express-validator / class-validator)
    └── Runtime Analyzer ──► Schema Inference Engine (+ redaction, confidence)
    │
OpenAPI 3.1 Generator
    │
    ├── /openapi.json
    └── /docs (Swagger UI)
```

The adapter system is extensible, and the core (scanner → registry → generator) is framework-agnostic by design — Fastify, Koa, NestJS and Hono adapters are on the roadmap.

## Roadmap

- **Phase 1 (now)**: Express, Zod, Joi, Yup, AJV, express-validator, class-validator, runtime analysis, Swagger UI, file persistence
- **Phase 2**: TypeScript metadata, database persistence
- **Phase 3**: Fastify, Koa, NestJS, Hono
- **Phase 4**: API version comparison & change tracking, SDK generation

## License

MIT
