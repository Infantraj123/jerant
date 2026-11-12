// Type definitions for jerant

import type { RequestHandler, Request } from 'express';

export interface JerantRuntimeOptions {
  /** Enable runtime traffic analysis. Default: true */
  enabled?: boolean;
  /** Fraction of requests to sample, 0..1. Default: 1 */
  sampleRate?: number;
  /** Max stored example payloads per route/status. Default: 3 */
  maxExamples?: number;
  /** Max observations merged per route. Default: 1000 */
  maxObservations?: number;
  /** Skip payloads larger than this many bytes. Default: 102400 */
  maxBodyBytes?: number;
  /** Adaptive sampling: once a route has `warmup` observations, record
   * further requests with probability warmup / observations. Default: true */
  adaptive?: boolean;
  /** Observations per route recorded in full before adaptive sampling
   * kicks in. Default: 50 (20 in production mode) */
  warmup?: number;
}

/** A route as seen by exclude predicates. */
export interface JerantRouteRef {
  method: string;
  path: string;
}

/** Exclusion rule: '/internal/*', 'GET /health', a RegExp on the path, or a predicate. */
export type JerantExcludeRule = string | RegExp | ((route: JerantRouteRef) => boolean);

/** Docs/spec protection: HTTP Basic credentials, or a check run against the
 * framework's native request (Express req, Fastify request, Koa ctx, Hono c). */
export type JerantAuth =
  | { username: string; password: string; realm?: string }
  | ((req: any) => boolean | Promise<boolean>);

/** Contract for user-supplied stores (Redis, S3, a shared DB). load() may
 * return a promise; jerant debounces save() calls itself. */
export interface JerantCustomStore {
  load(): unknown | Promise<unknown>;
  save(data: unknown): void | Promise<void>;
  close?(): void;
}

export interface JerantStorageOptions {
  /** 'memory' (default), 'file', or 'custom' (with `store`). */
  mode?: 'memory' | 'file' | 'custom';
  /** File path for mode 'file'. Default: '.jerant/data.json' */
  path?: string;
  /** Custom store instance for mode 'custom'. */
  store?: JerantCustomStore;
  /** Debounce for scheduled saves in ms. Default: 2000 */
  debounceMs?: number;
}

export interface JerantSourceScanOptions {
  /** Scan the app's own source files for handler code that
   * Function.prototype.toString cannot see (wrapped handlers, multer field
   * names, named controllers). Default: true */
  enabled?: boolean;
  /** Directory to scan. Default: the entry script's directory. */
  dir?: string;
  /** Max source files read. Default: 400 */
  maxFiles?: number;
  /** Skip files larger than this many bytes. Default: 524288 */
  maxFileBytes?: number;
}

export interface JerantPrismaOptions {
  /** Enrich code-analysis body schemas with types from schema.prisma when
   * handlers write request data into prisma models. Default: true */
  enabled?: boolean;
  /** Path to schema.prisma. Default: ./prisma/schema.prisma or ./schema.prisma */
  schemaPath?: string;
}

/** An OpenAPI security scheme object (http bearer/basic, apiKey, oauth2, ...). */
export type SecurityScheme = Record<string, unknown>;

/** A security requirement: scheme name(s) or OpenAPI requirement objects.
 * [] marks explicitly public. */
export type SecurityRequirement = string | Array<string | Record<string, string[]>>;

export interface JerantSecurityOptions {
  /** Named schemes for components.securitySchemes. */
  schemes?: Record<string, SecurityScheme>;
  /** Requirement applied to every operation ('bearerAuth', ['bearerAuth'], ...). */
  default?: SecurityRequirement;
  /** Detect auth middleware from its source (Authorization header reads,
   * passport.authenticate, x-api-key lookups). Default: true */
  autoDetect?: boolean;
}

export interface JerantValidationErrorOptions {
  /** HTTP status for validation failures. Default: 400 */
  status?: number;
  /** Builds the failure response body. Return undefined for the default shape. */
  formatter?: (ctx: {
    details: Array<{ location: string; path: string; message: string }>;
    req: Request;
    status: number;
  }) => unknown;
}

/** Envelope shorthand ({success: 'boolean', data: '$data'}), a JSON Schema
 * containing a '$data' slot, or {schema, statuses}. */
export type JerantEnvelopeOptions =
  | Record<string, unknown>
  | { schema: Record<string, unknown>; statuses?: Array<number | string> };

/** Responses added to every operation that does not already document the
 * status: schema (any supported kind) or {description, schema}. */
export type JerantDefaultResponses = Record<
  string | number,
  Record<string, unknown> | { description?: string; schema?: unknown }
>;

/** Tag metadata controlling group descriptions and ordering in the UI. */
export type JerantTags =
  | Array<string | { name: string; description?: string }>
  | Record<string, string>;

export interface JerantOptions {
  /** Master switch; also disabled via JERANT_DISABLED=1. Default: true */
  enabled?: boolean;
  /** Where the docs UI is served. Default: '/docs' */
  docsPath?: string;
  /** Where the OpenAPI document is served. Default: '/openapi.json' */
  openapiPath?: string;
  title?: string;
  version?: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
  /** Which documentation UI renders at docsPath: a built-in UI, false to
   * serve only the spec (bring your own UI elsewhere), a custom HTML page
   * ({html}), or a render function. Default: 'swagger' */
  ui?:
    | 'swagger'
    | 'redoc'
    | 'scalar'
    | false
    | { html: string }
    | ((ctx: {
        openapiPath: string;
        docsPath: string;
        title?: string;
        /** jerant's theme stylesheet (dark + light), for reuse in custom pages. */
        themeCss: string;
        /** URL the theme stylesheet is served at (`${docsPath}/theme.css`). */
        themeCssPath: string;
      }) => string);
  /** Swagger UI asset base URL. Default: unpkg swagger-ui-dist@5 */
  cdn?: string;
  /** 'cdn' (default) or 'local' — serve swagger-ui-dist from node_modules
   * under `${docsPath}/assets` for offline / strict-CSP setups. */
  assets?: 'cdn' | 'local';
  /** Minimum interval between spec rebuilds in ms. Rebuilds run in the
   * background and only when routes or learned data changed. Default: 5000 */
  cacheTtlMs?: number;
  /** OpenAPI version of the served document. '3.0' renders much faster in
   * Swagger UI. Default: '3.0' */
  openapi?: '3.0' | '3.1';
  /** 'production' turns off the learning features (teach mode) and makes
   * traffic recording cheaper. Default: from NODE_ENV. */
  mode?: 'development' | 'production';
  /** Docs theme: dark (black + lavender), light (white + violet), or 'auto'
   * (OS preference; the header toggle remembers the choice). Default: 'auto' */
  theme?: 'auto' | 'dark' | 'light';
  /** Extra Swagger UI options merged over jerant's defaults (JSON-serializable
   * values only), e.g. { docExpansion: 'none', syntaxHighlight: false }. */
  swaggerUi?: Record<string, unknown>;
  /** Routes to leave out of the docs and the runtime analyzer. */
  exclude?: JerantExcludeRule | JerantExcludeRule[];
  /** Edit the generated document before it is served or exported. Receives
   * a private copy; return a replacement or mutate in place. */
  transformSpec?: (spec: Record<string, any>) => Record<string, any> | void;
  /** Put the docs page, spec, theme and assets behind authentication. */
  auth?: JerantAuth;
  /** Instrument the router prototype to capture Express 5 mount paths. Default: true */
  patchRouter?: boolean;
  /** Additional field names to redact from stored payloads. */
  redactKeys?: string[];
  /** Authentication modeling: false disables, 'bearer' | 'apiKey' | 'basic' |
   * 'cookie' registers that scheme globally, or a full config object. */
  security?: false | 'bearer' | 'apiKey' | 'basic' | 'cookie' | JerantSecurityOptions;
  /** Response shape for validate() failures. */
  validationError?: JerantValidationErrorOptions;
  /** Document a response wrapper once, applied to declared response schemas. */
  envelope?: JerantEnvelopeOptions;
  /** Responses added to every operation (error shapes etc.). */
  defaultResponses?: JerantDefaultResponses;
  /** Top-level tag metadata: descriptions and UI group ordering. */
  tags?: JerantTags;
  /** Annotate operations whose traffic stopped matching declared schemas. Default: true */
  driftDetection?: boolean;
  /** Example payloads in the docs: 'placeholder' (default) shows type-name
   * values ({email: 'email', password: 'string'}), 'captured' shows real
   * (redacted) traffic payloads, false emits no examples. */
  examples?: 'placeholder' | 'captured' | false;
  /** Open low-confidence (<50%) operations in the docs with an editable
   * free-form request so users can teach the docs by sending real payloads.
   * Default: true */
  teachMode?: boolean;
  runtime?: JerantRuntimeOptions;
  storage?: JerantStorageOptions;
  sourceScan?: JerantSourceScanOptions;
  prisma?: JerantPrismaOptions;
}

export interface JerantInstance {
  enabled: boolean;
  options: Required<JerantOptions>;
  registry?: unknown;
  /** Current OpenAPI document (cached). */
  getSpec(force?: boolean): Record<string, unknown> | null;
  /** Force a rebuild of the OpenAPI document. */
  refresh(): Record<string, unknown> | null;
  /** Flush persisted runtime data to storage immediately. */
  flush(): void;
  close(): void;
}

/** Any supported schema: Zod, Joi, Yup, compiled AJV validator, plain JSON Schema, or a class-validator class. */
export type AnySchema = unknown;

export interface ValidateConfig {
  body?: AnySchema;
  query?: AnySchema;
  params?: AnySchema;
  /** Response schema for status 200. */
  response?: AnySchema;
  /** Response schemas keyed by status code. */
  responses?: Record<string | number, AnySchema>;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  /** Request media type, e.g. 'multipart/form-data'. Auto-detected from
   * upload middleware (multer) and observed traffic when omitted. */
  contentType?: string;
  /** Multipart file field names, documented as binary file inputs. */
  files?: string[];
  /** Per-route security requirement; [] marks the route public. */
  security?: SecurityRequirement;
  /** Per-route override of the validation failure response. */
  error?: JerantValidationErrorOptions;
}

/** Install jerant on an Express app. Serves /docs and /openapi.json on the same server and port. */
export function jerant(app: unknown, options?: JerantOptions): JerantInstance;

/** Install jerant on a Fastify instance (call before registering routes). */
export function jerantFastify(fastify: unknown, options?: JerantOptions): JerantInstance;

/** Install jerant on a Koa app; pass the @koa/router instance(s) via options.routers. */
export function jerantKoa(app: unknown, options?: JerantOptions & { routers?: unknown | unknown[] }): JerantInstance;

/** Install jerant on a Hono app (call before registering routes). */
export function jerantHono(app: unknown, options?: JerantOptions): JerantInstance;

/** Validation middleware: enforces the given schemas (400 by default on failure) and feeds the documentation. */
export function validate(config: ValidateConfig): RequestHandler;

/** Documentation-only middleware: attaches metadata without validating. */
export function doc(config: ValidateConfig): RequestHandler;

/** A schema adapter: detects schemas from one validation library and converts them to JSON Schema. */
export interface SchemaAdapter {
  name: string;
  isSchema(value: unknown): boolean;
  toJsonSchema(value: unknown): Record<string, unknown>;
}

/** Built-in schema adapters (zod, joi, yup, ajv, express-validator, class-validator). */
export const adapters: {
  detectSchema(value: unknown): { source: string; schema: Record<string, unknown> } | null;
  adapters: Record<string, SchemaAdapter | Record<string, unknown>>;
  expressValidator: Record<string, unknown>;
};

/** jerant's docs theme stylesheet (dark + light variables, Swagger UI skin). */
export const themeCss: string;

/** Convert an OpenAPI 3.1 document produced by jerant into OpenAPI 3.0.3. */
export function toOpenApi30(spec: Record<string, any>): Record<string, any>;

export default jerant;
