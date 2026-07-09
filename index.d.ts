// Type definitions for jerant

import type { RequestHandler } from 'express';

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
}

export interface JerantStorageOptions {
  /** 'memory' (default) or 'file' */
  mode?: 'memory' | 'file';
  /** File path for mode 'file'. Default: '.jerant/data.json' */
  path?: string;
}

export interface JerantOptions {
  /** Master switch; also disabled via JERANT_DISABLED=1. Default: true */
  enabled?: boolean;
  /** Where Swagger UI is served. Default: '/docs' */
  docsPath?: string;
  /** Where the OpenAPI document is served. Default: '/openapi.json' */
  openapiPath?: string;
  title?: string;
  version?: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
  /** Swagger UI asset base URL. Default: unpkg swagger-ui-dist@5 */
  cdn?: string;
  /** Spec rebuild throttle in ms. Default: 2000 */
  cacheTtlMs?: number;
  /** Additional field names to redact from stored payloads. */
  redactKeys?: string[];
  runtime?: JerantRuntimeOptions;
  storage?: JerantStorageOptions;
}

export interface JerantInstance {
  enabled: boolean;
  options: Required<JerantOptions>;
  registry?: unknown;
  /** Current OpenAPI 3.1 document (cached). */
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
}

/** Install jerant on an Express app. Serves /docs and /openapi.json on the same server and port. */
export function jerant(app: unknown, options?: JerantOptions): JerantInstance;

/** Validation middleware: enforces the given schemas (400 on failure) and feeds the documentation. */
export function validate(config: ValidateConfig): RequestHandler;

/** Documentation-only middleware: attaches metadata without validating. */
export function doc(config: ValidateConfig): RequestHandler;

export default jerant;
