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
