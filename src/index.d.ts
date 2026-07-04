import type { FlowDefinition } from './flows/index';

/**
 * A recursive schema node produced by `inferSchema`.
 * Intentionally lightweight — not JSON Schema, just enough to show
 * key names and primitive types in the documentation UI.
 */
export interface SchemaNode {
  type: string;
  /** Present when type === 'object' */
  properties?: Record<string, SchemaNode>;
  /** Present when type === 'array' */
  items?: SchemaNode;
  /**
   * When true the field is optional. Shown as `field?` in the documentation UI.
   * Set via `s.optional(schema)`, or automatically when a `@param`/`@response`
   * JSDoc tag wraps the name in brackets: `[body.name]` or `[propName]`.
   */
  optional?: boolean;
  /**
   * When true the value may also be `null`. Emitted as OpenAPI 3.1
   * `type: [<type>, 'null']`. Set via `s.nullable(schema)`.
   */
  nullable?: boolean;
  /**
   * A fixed set of allowed values. Emitted as OpenAPI `enum`; the first value
   * is used when generating request/response examples. Set via `s.enum([...])`.
   */
  enum?: Array<string | number | boolean | null>;
  /**
   * A single fixed value (OpenAPI `const`). Set via `s.literal(value)`.
   */
  const?: string | number | boolean | null;
  /**
   * Default value applied when the field is omitted. Used when generating
   * request examples, cURL/Postman exports, and mock responses. Set via
   * `s.default(schema, value)`.
   */
  default?: unknown;
}

/**
 * A single documented error response for a route.
 */
export interface ErrorEntry {
  /** HTTP status code, e.g. 404, 422, 500 */
  status: number;
  /** Short description of when this error occurs. */
  description: string | null;
  /** Optional schema of the error response body. */
  schema: SchemaNode | null;
}

/**
 * Captured request payload shape for a single route.
 */
export interface RequestSchema {
  /** Shape of req.body (null if no body was observed or method has no body) */
  body: SchemaNode | null;
  /** Shape of req.query (null if no query params were observed) */
  query: SchemaNode | null;
  /** Shape of req.params — path parameters (v1.15). null if not declared. */
  params?: SchemaNode | null;
}

/**
 * A single discovered route entry.
 */
export interface RouteEntry {
  /** HTTP method in uppercase, e.g. "GET", "POST" */
  method: string;
  /** Express-style path string, e.g. "/users/:id" */
  path: string;
  /** Named path parameter names extracted from the path, e.g. ["id"] */
  params: string[];
  /**
   * Optional human-readable description of what this route does.
   * Set via `defineRoute`'s `description` field. null if not provided.
   */
  description: string | null;
  /**
   * Expected request headers, keyed by header name.
   * Value is a short description or example (e.g. "Bearer <token>").
   * Set via `defineRoute`'s `headers` field. null if not provided.
   */
  requestHeaders: Record<string, string> | null;
  /**
   * Populated lazily after real traffic hits this route.
   * null until the first request is observed.
   */
  requestSchema: RequestSchema | null;
  /**
   * Populated lazily after real traffic hits this route.
   * null until the first response is observed.
   */
  responseSchema: SchemaNode | null;
  /**
   * Documented error responses for this route.
   * Set via `defineRoute`'s `errors` field. null if not provided.
   */
  errors: ErrorEntry[] | null;
  /**
   * Original Zod schemas (v1.6+) captured by `normalizeRouteSchemas` for
   * runtime validation. `SchemaNode` versions live in `requestSchema`.
   */
  requestValidators?: { body: unknown | null; query: unknown | null; params?: unknown | null };
  /** Original Zod response schema (v1.15) for dev-mode response assertion. */
  responseValidator?: unknown | null;
  /** Per-route validation override (v1.6+). undefined → inherit adapter default. */
  validateOverride?: boolean;
  /** When true, this route is omitted from the docs UI and OpenAPI export (v1.8+). */
  hidden?: boolean;
  /** Per-route OpenAPI `security` requirement (v1.8+). Empty array marks the route explicitly public. */
  security?: Array<Record<string, string[]>>;
  /** Per-route OpenAPI tags (v1.11+). Overrides the default path-segment tag. */
  tags?: string[];
  /** Per-operation OpenAPI 3.1 callbacks (v1.11+). */
  callbacks?: Record<string, CallbackDef>;
  /** Per-route OpenAPI examples (v1.11+) — attached to request body + responses. */
  examples?: RouteExamples;
}

/**
 * A single callback / webhook contract (v1.11+). Same shape used for
 * per-operation `callbacks` and document-level `webhooks` (which omits `url`).
 */
export interface CallbackDef {
  /** Path-item key used by OpenAPI; e.g. `'{$request.body#/callbackUrl}'`. Required for callbacks, ignored for webhooks. */
  url?: string;
  method: string;
  summary?: string;
  description?: string;
  request?: { body?: SchemaNode | unknown; query?: SchemaNode | unknown };
  response?: SchemaNode | unknown;
  errors?: Record<number, string | { description?: string; schema?: SchemaNode | unknown }>;
  examples?: RouteExamples;
}

/**
 * Multi-example bag attached to a route (v1.11+). Either a single value
 * (rendered as `example`) or a `{ name: { value, summary?, description? } }`
 * map (rendered as `examples`).
 */
export interface RouteExamples {
  /** Examples for the request body. */
  request?: unknown | Record<string, { value: unknown; summary?: string; description?: string }>;
  /** Alias for `request`. */
  body?: unknown | Record<string, { value: unknown; summary?: string; description?: string }>;
  /** Examples for the success response. */
  response?: unknown | Record<string, { value: unknown; summary?: string; description?: string }>;
  /** Alias for `response`. */
  success?: unknown | Record<string, { value: unknown; summary?: string; description?: string }>;
  /** Examples keyed by HTTP status code, attached to the corresponding error response. */
  responses?: Record<string, unknown | Record<string, { value: unknown; summary?: string; description?: string }>>;
}

/**
 * Project metadata displayed in the documentation UI header.
 */
export interface ApiMeta {
  title?: string;
  version?: string;
  description?: string;
}

/**
 * User-supplied configuration object passed to the adapter factory.
 */
export interface UserConfig {
  /**
   * The path at which the docs UI will be served.
   * @default '/docs'
   */
  docsPath?: string;

  /**
   * Whether the middleware is active. When false a no-op middleware is returned.
   * @default process.env.NODE_ENV !== 'production'
   */
  enabled?: boolean;

  /** Project metadata shown in the UI header. */
  meta?: ApiMeta;

  /**
   * Route path patterns to hide from the docs.
   * Accepts exact path strings or RegExp instances.
   * Wildcards `'*'` and `'/*'` are always excluded by default.
   * @example ['/health', /^\/internal\//]
   */
  exclude?: Array<string | RegExp>;

  /**
   * When true the route registry is rebuilt on every request to the docs
   * endpoint instead of being cached after the first build.
   * Useful during development with hot-reload.
   * @default false
   */
  liveReload?: boolean;

  /**
   * Per-group metadata shown in the sidebar and group section headers.
   * Keys are the first path segment of the routes in that group (e.g. "users", "admin").
   * @example { users: { description: 'Manage user accounts.' }, admin: { description: 'Admin-only operations.' } }
   */
  groups?: Record<string, { description?: string }>;

  /**
   * Flow presets to embed directly into the docs UI.
   * When omitted, DocTreen will try to load `./doctreen-flows/*.json`.
   */
  flows?: FlowDefinition[];

  /**
   * Directory containing flow JSON files.
   * Each `*.json` file is treated as a flow definition.
   */
  flowsPath?: string;

  /**
   * Runtime request validation (v1.6+). When enabled, requests are validated
   * against the declared Zod schemas (`request.body` / `request.query` /
   * `request.params`) before the handler runs; invalid requests get a
   * structured 422 response. Available on every adapter.
   *
   * - `true` / `false` — enable or disable validation (legacy boolean form).
   * - `{ enabled?, writeback? }` — object form (v1.15). Set `writeback: true`
   *   to push the *parsed* payload (Zod coercions + defaults applied) back onto
   *   the request so the handler reads the coerced values:
   *     - Express / Fastify / NestJS — written to `req.body` / `req.query` / `req.params`.
   *     - Hono — overlaid on `c.req.param()` / `c.req.query()` / `c.req.json()`;
   *       also available as `c.get('doctreenValidated')`.
   *     - Koa — written to `ctx.request.body` and `ctx.query`; coerced path
   *       params are exposed on `ctx.state.doctreenValidated.params` (the Koa
   *       router re-derives `ctx.params` from the raw URL after validation).
   * - `response` — dev-mode response assertion (v1.15). `'warn'` logs a mismatch
   *   between the handler's response and the declared Zod `response` schema and
   *   passes it through; `'throw'` surfaces a 500 in development; `'off'`
   *   (default) disables it. Never coerces the response.
   * @default false
   */
  validate?: boolean | { enabled?: boolean; writeback?: boolean; response?: 'off' | 'warn' | 'throw' | boolean };

  /** OpenAPI-specific options applied to `<docsPath>/openapi.json` (v1.7+). */
  openapi?: OpenApiConfig;

  /**
   * Raw HTML appended to the docs UI `<head>` (v1.9+). Trusted input —
   * DocTreen does not sanitise — so do not pass anything derived from
   * user-submitted data. Typical uses: analytics scripts, custom CSS,
   * favicon overrides, OG / Twitter meta tags, web fonts.
   *
   * @example
   * headHtml: '<script defer src="/_vercel/insights/script.js"></script>'
   */
  headHtml?: string;

  /**
   * Schema drift detection (v1.10+). Compares actual request payloads
   * against the declared schema and aggregates mismatches.
   *
   * Pass `false` to disable, `true` to enable with defaults, or a config
   * object to fine-tune sampling, callbacks, and storage.
   *
   * @default { enabled: NODE_ENV !== 'production', sampleRate: 0.01 }
   */
  drift?: boolean | DriftConfig;
}

/**
 * A single drift event emitted by the per-adapter hook.
 */
export interface DriftIssue {
  /** 'missing-required' | 'unexpected-field' | 'type-mismatch' */
  kind: string;
  field: string;
  expected?: string;
  got?: string;
}

export interface DriftEvent {
  route: { method: string; path: string };
  /** 'body' or 'query' */
  part: string;
  issues: DriftIssue[];
  /** ms epoch */
  sampledAt: number;
}

/**
 * Pluggable drift store interface. The default in-memory store is used
 * when this is omitted. Implement to plug Redis/Postgres/etc.
 */
export interface DriftStore {
  record(event: DriftEvent): void | Promise<void>;
  report(): DriftReport | Promise<DriftReport>;
  reset(): void | Promise<void>;
}

/**
 * Aggregated drift snapshot returned by `store.report()` and served at
 * `GET <docsPath>/drift.json`.
 */
export interface DriftReport {
  generatedAt: number;
  totalIssues: number;
  routes: Array<{
    method: string;
    path: string;
    total: number;
    kinds: Record<string, number>;
    parts: Record<string, number>;
    fields: Record<string, number>;
    firstSeen: number;
    lastSeen: number;
    samples: Array<{ sampledAt: number; part: string; issues: DriftIssue[] }>;
    /** Hourly buckets (UTC), rolling 24h. Keys like `2026-05-27T14`. */
    buckets: Record<string, number>;
    /** Daily buckets (UTC), rolling 7 days. Keys like `2026-05-27`. (v1.10.1+) */
    dailyBuckets: Record<string, number>;
  }>;
}

/** Drift detection config block (v1.10+). */
export interface DriftConfig {
  /** Enable / disable detection. Defaults to `NODE_ENV !== 'production'`. */
  enabled?: boolean;
  /** Fraction of mismatching requests to record (0–1). Default 0.01. */
  sampleRate?: number;
  /** Per-route sample buffer cap (rolling window). Default 5. */
  maxSamples?: number;
  /** HTTP(S) URL to POST drift events to. Fire-and-forget. */
  webhook?: string;
  /** Synchronous callback invoked on every recorded drift event. */
  onDrift?: (event: DriftEvent) => void;
  /** Replace the default in-memory store (e.g. Redis-backed). */
  store?: DriftStore;
  /** `'warn'` (default) prints a console.warn per unique drift signature. `'silent'` suppresses logs. */
  logLevel?: 'warn' | 'silent';
  /**
   * Expose `POST <docsPath>/drift/reset` to clear the store at runtime (v1.10.1+).
   *
   * Default `false`. When enabled without `resetToken`, the endpoint is open —
   * only do this on internal networks. With `resetToken`, the endpoint requires
   * a matching `x-doctreen-drift-token` header (or `?token=` query param).
   */
  allowReset?: boolean;
  /** Shared secret required on `POST /drift/reset`. (v1.10.1+) */
  resetToken?: string;
}

/** Entry in the OpenAPI `servers` array. */
export interface OpenApiServer {
  url: string;
  description?: string;
  variables?: Record<string, { default: string; description?: string; enum?: string[] }>;
}

/** Nested OpenAPI configuration block (v1.7+). */
export interface OpenApiConfig {
  /**
   * `servers` array emitted into the OpenAPI document. Defaults to
   * `[{ url: '/' }]` (same origin as the docs page) so Swagger UI's
   * "Try it out" works against the live host.
   */
  servers?: OpenApiServer[];
  /**
   * Top-level `components.securitySchemes` map. Keys are scheme names
   * referenced from per-route `security` requirements. Values are
   * OpenAPI 3.1 Security Scheme Objects. (v1.8+)
   *
   * @example
   * {
   *   bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
   *   apiKey:     { type: 'apiKey', in: 'header', name: 'x-api-key' },
   * }
   */
  securitySchemes?: Record<string, unknown>;
  /**
   * Top-level `security` array — applies to every operation that does
   * not declare its own `security`. Pass an empty per-route `security: []`
   * to mark a route explicitly public. (v1.8+)
   *
   * @example [{ bearerAuth: [] }]
   */
  security?: Array<Record<string, string[]>>;

  /**
   * Top-level `tags[]` metadata emitted into the OpenAPI document (v1.11+).
   * Each entry attaches a description (and optional `externalDocs`) to a tag
   * referenced by per-route `tags`. Tags used by routes but not declared
   * here are appended without metadata.
   *
   * @example
   * tags: [
   *   { name: 'users', description: 'User account management' },
   *   { name: 'admin', description: 'Operator-only endpoints' },
   * ]
   */
  tags?: Array<{ name: string; description?: string; externalDocs?: { description?: string; url: string } }>;

  /**
   * Document-level `webhooks` map (OpenAPI 3.1, v1.11+). Use this to describe
   * outgoing event contracts your server emits — webhooks are NOT routes the
   * server handles. Shape mirrors the per-operation `callbacks` block.
   *
   * @example
   * webhooks: {
   *   userCreated: {
   *     method: 'POST',
   *     summary: 'Fired when a user signs up',
   *     request: { body: UserSchema },
   *   },
   * }
   */
  webhooks?: Record<string, CallbackDef>;
}

/**
 * Resolved configuration with all optional fields filled in.
 */
export interface NormalizedConfig {
  docsPath: string;
  enabled: boolean;
  meta: Required<ApiMeta>;
  exclude: Array<string | RegExp>;
  liveReload: boolean;
  groups: Record<string, { description: string }>;
  flows: FlowDefinition[] | null;
  flowsPath: string | null;
  validate: { enabled: boolean; writeback: boolean; response: 'off' | 'warn' | 'throw' };
  openapi: {
    servers: OpenApiServer[];
    securitySchemes: Record<string, unknown> | null;
    security: Array<Record<string, string[]>> | null;
    tags: Array<{ name: string; description?: string; externalDocs?: { description?: string; url: string } }> | null;
    webhooks: Record<string, CallbackDef> | null;
  };
  headHtml: string | null;
  drift: {
    enabled: boolean;
    sampleRate: number;
    maxSamples: number;
    webhook: string | null;
    onDrift: ((event: DriftEvent) => void) | null;
    store: DriftStore | null;
    logLevel: 'warn' | 'silent';
    allowReset: boolean;
    resetToken: string | null;
  };
}

/**
 * Framework-agnostic store for discovered routes.
 * Adapters populate this; the UI layer reads from it.
 */
export declare class RouteRegistry {
  /**
   * Register a single route. Duplicates (same method + path) are silently dropped.
   * Returns the stored entry reference so callers can mutate it later
   * (e.g. to attach request/response schemas from real traffic).
   */
  add(entry: Omit<RouteEntry, 'requestSchema' | 'responseSchema' | 'errors'> & { params?: string[] }): RouteEntry;

  /**
   * Returns a sorted, read-only snapshot of all registered routes.
   * Sorted by path then method for stable UI rendering.
   */
  getAll(): RouteEntry[];

  /**
   * Same as `getAll()` but omits entries marked `hidden: true` via
   * `defineRoute({ hidden: true })` / `@DocRoute({ hidden: true })`.
   * Use this when feeding routes to the docs UI or OpenAPI exporter so
   * hidden routes remain functional at runtime but invisible to consumers.
   * (v1.8+)
   */
  getVisible(): RouteEntry[];

  /**
   * Look up a registered route by HTTP method + exact path pattern.
   * Returns null when no match exists.
   */
  find(method: string, path: string): RouteEntry | null;

  /**
   * Look up a route by HTTP method + concrete request URL path,
   * matching `:params` against actual URL segments. Returns null
   * when no match exists.
   */
  findByRequestPath(method: string, actualPath: string): RouteEntry | null;

  /** Wipe all entries so the next introspection starts fresh. */
  clear(): void;

  /** Number of routes currently in the registry. */
  readonly size: number;
}

/**
 * Recursively infers a lightweight schema from a runtime JavaScript value.
 */
export declare function inferSchema(value: unknown, depth?: number): SchemaNode;

/**
 * Lightweight schema builder — produces `SchemaNode` objects in a concise,
 * type-guided way. Use with `defineRoute` to pre-populate documentation
 * without waiting for real HTTP traffic.
 *
 * @example
 * import { s } from 'doctreen';
 *
 * defineRoute(handler, {
 *   request: { body: s.object({ name: s.string(), age: s.number() }), query: null },
 *   response: s.object({ id: s.number(), name: s.string() }),
 * });
 */
export declare const s: {
  string(): SchemaNode;
  number(): SchemaNode;
  boolean(): SchemaNode;
  null(): SchemaNode;
  unknown(): SchemaNode;
  object(properties: Record<string, SchemaNode>): SchemaNode;
  array(items: SchemaNode): SchemaNode;
  /** Marks a schema node as optional. Shown as `field?` in the documentation UI. */
  optional(schema: SchemaNode): SchemaNode;
  /** A fixed set of allowed values. Value type is inferred from the first entry. */
  enum(values: Array<string | number | boolean | null>): SchemaNode;
  /** A single fixed value (OpenAPI `const`). Type inferred from the value. */
  literal(value: string | number | boolean | null): SchemaNode;
  /** Marks a schema node as nullable (`type: [<type>, 'null']` in OpenAPI 3.1). */
  nullable(schema: SchemaNode): SchemaNode;
  /** Attaches a default value; the field becomes optional and the default seeds examples. */
  default(schema: SchemaNode, value: unknown): SchemaNode;
};

/**
 * Merges user-supplied config with safe defaults.
 */
export declare function normalizeConfig(userConfig?: UserConfig): NormalizedConfig;

/**
 * Returns true if `routePath` matches any rule in `excludeList`.
 */
export declare function shouldExclude(
  routePath: string,
  excludeList: Array<string | RegExp>
): boolean;

/**
 * Registers a reusable, named schema that can be referenced by name in JSDoc
 * `@param` / `@response` type annotations and resolved automatically.
 *
 * Returns the same `SchemaNode` unchanged — assign it to a variable and pass
 * it directly to `defineRoute` as well.
 *
 * @example
 * import { s, defineSchema } from 'doctreen';
 *
 * const UserSchema = defineSchema('User', s.object({
 *   id:    s.number(),
 *   name:  s.string(),
 *   email: s.string(),
 * }));
 *
 * // Reference by name in JSDoc:  @response {User[]} users
 * // Pass directly to defineRoute: { response: UserSchema }
 */
export declare function defineSchema(name: string, schema: SchemaNode): SchemaNode;

/**
 * Structured data extracted by `parseJSDoc`.
 */
export interface JSDocInfo {
  description: string | null;
  headers: Record<string, string> | null;
  request: { body: SchemaNode | null; query: SchemaNode | null } | null;
  response: SchemaNode | null;
}

/**
 * Parses a JSDoc block comment from inside a handler function's source string.
 *
 * Place a `/** ... *\/` comment at the very start of the function body to
 * document that route without importing `defineRoute`:
 *
 * ```js
 * app.post('/users', function(req, res) {
 *   /**
 *    * Create a user
 *    * @param   {string} body.name    Full name
 *    * @param   {string} body.email   Email address
 *    * @param   {string} [query.role] Role filter
 *    * @response {number} id
 *    * @response {string} name
 *    * @header  Authorization - Bearer <token>
 *    * /
 *   res.json({ id: 1 });
 * });
 * ```
 *
 * Supported tags:
 * - First non-tag line or `@description` → route description
 * - `@param {type} body.name`            → request body field
 * - `@param {type} query.name`           → query parameter
 * - `@response {type} name`             → response object field
 * - `@returns {type}`                   → simple response type
 * - `@header name - description`        → request header
 *
 * Returns `null` if no JSDoc block is found or nothing useful is extracted.
 */
export declare function parseJSDoc(fn: Function): JSDocInfo | null;

export * as flows from './flows/index';
