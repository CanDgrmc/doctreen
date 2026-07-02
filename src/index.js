'use strict';

// ─── JSDoc typedefs ───────────────────────────────────────────────────────────
// These serve the library author's IDE experience while editing this file.
// The authoritative declarations for TypeScript consumers live in index.d.ts.

/**
 * @typedef {{ type: string, properties?: Record<string, SchemaNode>, items?: SchemaNode, optional?: boolean, nullable?: boolean, enum?: any[], default?: any, const?: any }} SchemaNode
 */

/**
 * @typedef {{ body: SchemaNode|null, query: SchemaNode|null }} RequestSchema
 */

/**
 * @typedef {{ status: number, description: string|null, schema: SchemaNode|null }} ErrorEntry
 */

/**
 * @typedef {{ method: string, path: string, params: string[], description: string|null, requestHeaders: Record<string,string>|null, requestSchema: RequestSchema|null, responseSchema: SchemaNode|null, errors: ErrorEntry[]|null }} RouteEntry
 */

/**
 * @typedef {{ url: string, description?: string }} OpenApiServer
 *
 * @typedef {{ servers?: OpenApiServer[], securitySchemes?: Record<string, any>, security?: Array<Record<string, string[]>> }} OpenApiConfig
 *
 * @typedef {{ enabled?: boolean, sampleRate?: number, maxSamples?: number, webhook?: string, onDrift?: Function, store?: { record: Function, report: Function, reset: Function }, logLevel?: 'warn'|'silent', allowReset?: boolean, resetToken?: string }} DriftConfig
 *
 * @typedef {{ docsPath?: string, enabled?: boolean, meta?: { title?: string, version?: string, description?: string }, exclude?: Array<string|RegExp>, liveReload?: boolean, groups?: Record<string, { description?: string }>, flows?: Array<any>, flowsPath?: string, validate?: boolean, openapi?: OpenApiConfig, headHtml?: string, drift?: DriftConfig|boolean }} UserConfig
 */

/**
 * @typedef {{ docsPath: string, enabled: boolean, meta: { title: string, version: string, description: string }, exclude: Array<string|RegExp>, liveReload: boolean, groups: Record<string, { description: string }>, flows: Array<any>|null, flowsPath: string|null, validate: boolean, openapi: { servers: OpenApiServer[], securitySchemes: Record<string, any>|null, security: Array<Record<string, string[]>>|null }, headHtml: string|null, drift: { enabled: boolean, sampleRate: number, maxSamples: number, webhook: string|null, onDrift: Function|null, store: any|null, logLevel: string, allowReset: boolean, resetToken: string|null } }} NormalizedConfig
 */

// ─────────────────────────────────────────────────────────────────────────────

/**
 * inferSchema
 *
 * Recursively infers a lightweight schema from a runtime JavaScript value.
 * This is intentionally simple — not JSON Schema, just enough to show
 * key names and their primitive types in the documentation UI.
 *
 * @param {unknown} value
 * @param {number}  [depth=0] - Guards against infinitely deep objects
 * @returns {SchemaNode}
 */
function inferSchema(value, depth) {
  depth = depth || 0;

  // Hard depth cap — avoids stack overflows on circular-ish structures
  if (depth > 5) return { type: '...' };

  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };

  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: value.length > 0 ? inferSchema(value[0], depth + 1) : { type: 'unknown' },
    };
  }

  if (typeof value === 'object') {
    /** @type {Record<string, SchemaNode>} */
    var properties = {};
    Object.keys(value).forEach(function (k) {
      properties[k] = inferSchema(value[k], depth + 1);
    });
    return { type: 'object', properties: properties };
  }

  // Primitives: 'string' | 'number' | 'boolean' | 'bigint' | 'symbol'
  return { type: typeof value };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * RouteRegistry
 *
 * Framework-agnostic store for discovered routes.
 * Adapters populate this; the UI layer reads from it.
 */
class RouteRegistry {
  constructor() {
    /** @type {RouteEntry[]} */
    this._routes = [];
  }

  /**
   * Register a single route. Silently ignores duplicates (same method + path).
   * Returns the stored entry reference so callers can mutate it (e.g., to
   * attach request/response schemas as real traffic is observed).
   *
   * @param {{ method: string, path: string, params?: string[], description?: string|null, requestHeaders?: Record<string,string>|null }} entry
   * @returns {RouteEntry} The stored (possibly pre-existing) entry object
   */
  add(entry) {
    const key = `${entry.method.toUpperCase()}:${entry.path}`;
    const existing = this._routes.find(
      (r) => `${r.method.toUpperCase()}:${r.path}` === key
    );
    if (existing) return existing;

    const newEntry = {
      method: entry.method.toUpperCase(),
      path: entry.path,
      params: entry.params || [],
      description: entry.description || null,
      requestHeaders: entry.requestHeaders || null,
      // Populated lazily as real requests flow through the wrapped handlers
      requestSchema: null,
      responseSchema: null,
      errors: null,
    };
    this._routes.push(newEntry);
    return newEntry;
  }

  /**
   * Look up a registered route by HTTP method + exact path. Returns null when
   * no match exists. Used by adapter request-time hooks (e.g. Fastify's
   * preHandler) to resolve the entry attached to the current request.
   *
   * @param {string} method
   * @param {string} path
   * @returns {RouteEntry|null}
   */
  find(method, path) {
    const m = String(method || '').toUpperCase();
    for (let i = 0; i < this._routes.length; i++) {
      const r = this._routes[i];
      if (r.method === m && r.path === path) return r;
    }
    return null;
  }

  /**
   * Look up a registered route by HTTP method + concrete request URL path,
   * matching `:params` against actual segments. Use this from middleware that
   * sees the live request path (e.g. Hono / Koa) — `find()` requires the exact
   * route pattern. Returns the first matching entry or null.
   *
   * @param {string} method
   * @param {string} actualPath
   * @returns {RouteEntry|null}
   */
  findByRequestPath(method, actualPath) {
    const m = String(method || '').toUpperCase();
    for (let i = 0; i < this._routes.length; i++) {
      const r = this._routes[i];
      if (r.method !== m) continue;
      if (r.path === actualPath) return r;
      // Skip the regex build for paths without ":params" — exact compare above.
      if (r.path.indexOf(':') === -1) continue;
      const escaped = r.path.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const withParams = escaped.replace(/:\w+/g, '[^/]+');
      if (new RegExp('^' + withParams + '$').test(actualPath)) return r;
    }
    return null;
  }

  /**
   * Return a sorted, read-only snapshot of all registered routes.
   * Sorted by path then method for stable UI rendering.
   * @returns {RouteEntry[]}
   */
  getAll() {
    return [...this._routes].sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      return pathCmp !== 0 ? pathCmp : a.method.localeCompare(b.method);
    });
  }

  /**
   * Same as `getAll()` but omits entries marked `hidden: true` via
   * `defineRoute({ hidden: true })` / `@DocRoute({ hidden: true })`.
   * Use this when feeding routes to the docs UI or OpenAPI exporter so
   * hidden routes remain functional at runtime but invisible to consumers.
   *
   * @returns {RouteEntry[]}
   */
  getVisible() {
    return this.getAll().filter(function (r) { return r && r.hidden !== true; });
  }

  /**
   * Wipe all entries so the next introspection starts fresh.
   */
  clear() {
    this._routes = [];
  }

  get size() {
    return this._routes.length;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * normalizeConfig
 *
 * Merges user-supplied config with safe defaults.
 * @param {object} [userConfig]
 * @returns {NormalizedConfig}
 */
function normalizeConfig(userConfig = {}) {
  return {
    docsPath: userConfig.docsPath || '/docs',

    enabled:
      userConfig.enabled !== undefined
        ? Boolean(userConfig.enabled)
        : process.env.NODE_ENV !== 'production',

    meta: {
      title: (userConfig.meta && userConfig.meta.title) || 'API Documentation',
      version: (userConfig.meta && userConfig.meta.version) || '1.0.0',
      description: (userConfig.meta && userConfig.meta.description) || '',
    },

    exclude: [
      '*',
      '/*',
      /^\(\.\*\)/,
      ...(userConfig.exclude || []),
    ],

    liveReload: Boolean(userConfig.liveReload),

    groups: userConfig.groups || {},
    flows: Array.isArray(userConfig.flows) ? userConfig.flows : null,
    flowsPath: userConfig.flowsPath || null,

    validate: Boolean(userConfig.validate),

    openapi: normalizeOpenApiConfig(userConfig.openapi),

    // Raw HTML appended to <head> of the docs UI. Use for analytics scripts,
    // custom CSS links, favicon overrides, OG / Twitter meta tags, web fonts,
    // etc. Trusted input — DocTreen does not sanitise — so do not pass
    // anything derived from user-submitted data.
    headHtml: typeof userConfig.headHtml === 'string' ? userConfig.headHtml : null,

    drift: normalizeDriftConfig(userConfig.drift),
  };
}

/**
 * Normalise the `drift` config block. Accepts:
 *   - `false`     → disabled
 *   - `true`      → enabled with defaults
 *   - object      → merged onto defaults
 *   - undefined   → enabled in dev (NODE_ENV !== 'production'), off in prod
 *
 * @param {boolean|object|undefined} input
 */
function normalizeDriftConfig(input) {
  const defaults = {
    enabled: process.env.NODE_ENV !== 'production',
    sampleRate: 0.01,
    maxSamples: 5,
    webhook: null,
    onDrift: null,
    store: null,
    logLevel: 'warn',
    allowReset: false,
    resetToken: null,
  };

  if (input === false) return Object.assign({}, defaults, { enabled: false });
  if (input === true) return Object.assign({}, defaults, { enabled: true });
  if (!input || typeof input !== 'object') return defaults;

  return {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : defaults.enabled,
    sampleRate: typeof input.sampleRate === 'number' ? input.sampleRate : defaults.sampleRate,
    maxSamples: typeof input.maxSamples === 'number' ? input.maxSamples : defaults.maxSamples,
    webhook: typeof input.webhook === 'string' ? input.webhook : null,
    onDrift: typeof input.onDrift === 'function' ? input.onDrift : null,
    store: (input.store && typeof input.store.record === 'function') ? input.store : null,
    logLevel: input.logLevel === 'silent' ? 'silent' : 'warn',
    allowReset: Boolean(input.allowReset),
    resetToken: typeof input.resetToken === 'string' && input.resetToken.length > 0 ? input.resetToken : null,
  };
}

/**
 * Normalise the nested `openapi` config block. Always returns a shape with
 * the three keys (`servers`, `securitySchemes`, `security`) populated so
 * downstream consumers can read without optional-chain noise.
 *
 * @param {OpenApiConfig|undefined} input
 */
function normalizeOpenApiConfig(input) {
  const cfg = input && typeof input === 'object' ? input : {};

  const servers = Array.isArray(cfg.servers) && cfg.servers.length > 0
    ? cfg.servers.map(function (s) {
        if (typeof s === 'string') return { url: s };
        return Object.assign({}, s);
      })
    : [{ url: '/' }];

  const securitySchemes =
    cfg.securitySchemes && typeof cfg.securitySchemes === 'object'
      ? cfg.securitySchemes
      : null;

  const security = Array.isArray(cfg.security) && cfg.security.length > 0
    ? cfg.security
    : null;

  // Top-level tag metadata (v1.11+). Each entry: { name, description?, externalDocs? }.
  // Used to attach descriptions to the per-operation tags so they render nicely
  // in Scalar/Redoc/Swagger UI. Per-route `tags` still drive grouping.
  const tags = Array.isArray(cfg.tags) && cfg.tags.length > 0
    ? cfg.tags
        .filter(function (t) { return t && typeof t === 'object' && typeof t.name === 'string'; })
        .map(function (t) {
          const out = { name: t.name };
          if (typeof t.description === 'string') out.description = t.description;
          if (t.externalDocs && typeof t.externalDocs === 'object') out.externalDocs = t.externalDocs;
          return out;
        })
    : null;

  // OpenAPI 3.1 `webhooks` (v1.11+). A user-declared map of named outgoing
  // webhook contracts — these are NOT routes the server handles, they describe
  // events the server may send. Shape:
  //   { name: { method, summary?, description?, request?: { body, query }, response?, errors? } }
  // Nested schemas can be Zod or SchemaNode; normalise the same way callbacks
  // are normalised so the exporter consumes uniform SchemaNodes only.
  let webhooks = null;
  if (cfg.webhooks && typeof cfg.webhooks === 'object' && !Array.isArray(cfg.webhooks)) {
    const { normaliseCallbacksBag } = require('./internal/schemas');
    webhooks = normaliseCallbacksBag(cfg.webhooks);
  }

  return {
    servers: servers,
    securitySchemes: securitySchemes,
    security: security,
    tags: tags,
    webhooks: webhooks,
  };
}

/**
 * shouldExclude
 *
 * Returns true if a route path matches any exclusion rule.
 * @param {string} routePath
 * @param {Array<string|RegExp>} excludeList
 */
function shouldExclude(routePath, excludeList) {
  return excludeList.some((rule) => {
    if (rule instanceof RegExp) return rule.test(routePath);
    return routePath === rule;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * s — lightweight schema builder
 *
 * Provides a concise, type-guided API for building SchemaNode objects.
 * Use with `defineRoute` to pre-populate documentation without waiting for
 * real HTTP traffic to flow through the route.
 *
 * @example
 * import { s } from 'doctreen';
 *
 * defineRoute(handler, {
 *   request: { body: s.object({ name: s.string(), age: s.number() }), query: null },
 *   response: s.object({ id: s.number(), name: s.string() }),
 * });
 */
const s = {
  /** @returns {SchemaNode} */
  string: () => ({ type: 'string' }),
  /** @returns {SchemaNode} */
  number: () => ({ type: 'number' }),
  /** @returns {SchemaNode} */
  boolean: () => ({ type: 'boolean' }),
  /** @returns {SchemaNode} */
  null: () => ({ type: 'null' }),
  /** @returns {SchemaNode} */
  unknown: () => ({ type: 'unknown' }),
  /**
   * @param {Record<string, SchemaNode>} properties
   * @returns {SchemaNode}
   */
  object: (properties) => ({ type: 'object', properties }),
  /**
   * @param {SchemaNode} items
   * @returns {SchemaNode}
   */
  array: (items) => ({ type: 'array', items }),
  /**
   * Marks a schema node as optional. Use inside `s.object(...)` to indicate
   * that a field may be absent. Shown as `field?` in the documentation UI.
   *
   * @param {SchemaNode} schema
   * @returns {SchemaNode}
   */
  optional: (schema) => Object.assign({}, schema, { optional: true }),
  /**
   * A fixed set of allowed values. The value type is inferred from the first
   * entry (`string` by default). Emitted as OpenAPI `enum`; the first value is
   * used when generating request/response examples.
   *
   * @param {Array<string|number|boolean|null>} values
   * @returns {SchemaNode}
   */
  enum: (values) => {
    const list = Array.isArray(values) ? values : [];
    const first = list.find((v) => v !== null && v !== undefined);
    const type = typeof first === 'number' ? 'number'
      : typeof first === 'boolean' ? 'boolean'
      : 'string';
    return { type, enum: list.slice() };
  },
  /**
   * A single fixed value (OpenAPI `const`). The type is inferred from the value.
   *
   * @param {string|number|boolean|null} value
   * @returns {SchemaNode}
   */
  literal: (value) => {
    const type = value === null ? 'null'
      : typeof value === 'number' ? 'number'
      : typeof value === 'boolean' ? 'boolean'
      : 'string';
    return { type, const: value };
  },
  /**
   * Marks a schema node as nullable — the value may be `null` in addition to
   * its declared type. Emitted as OpenAPI 3.1 `type: [<type>, 'null']`.
   *
   * @param {SchemaNode} schema
   * @returns {SchemaNode}
   */
  nullable: (schema) => Object.assign({}, schema, { nullable: true }),
  /**
   * Attaches a default value to a schema node. The field becomes optional (it
   * may be omitted from requests) and the default is used when generating
   * request examples, cURL/Postman exports, and mock responses.
   *
   * @param {SchemaNode} schema
   * @param {any} value
   * @returns {SchemaNode}
   */
  default: (schema, value) => Object.assign({}, schema, { default: value, optional: true }),
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Named schema registry — populated by `defineSchema()`.
 * @type {Map<string, SchemaNode>}
 */
const _schemaRegistry = new Map();

/**
 * defineSchema
 *
 * Registers a reusable, named schema so it can be referenced by name in JSDoc
 * comments (`@param {User}`, `@response {User[]}`) and resolved automatically.
 * Returns the same SchemaNode unchanged so you can assign it and pass it
 * directly to `defineRoute` too.
 *
 * @example
 * const { s, defineSchema } = require('doctreen');
 *
 * const UserSchema = defineSchema('User', s.object({
 *   id:    s.number(),
 *   name:  s.string(),
 *   email: s.string(),
 * }));
 *
 * // Reference by name in JSDoc:
 * app.get('/users', function(req, res) {
 *   // @response {User[]} users
 *   res.json({ users: [...] });
 * });
 *
 * // Or pass directly to defineRoute:
 * app.post('/users', defineRoute(handler, { response: UserSchema }));
 *
 * @param {string}     name   - Schema name (e.g. 'User', 'Product')
 * @param {SchemaNode} schema - The schema node to register
 * @returns {SchemaNode} The same schema node (pass-through for convenience)
 */
function defineSchema(name, schema) {
  _schemaRegistry.set(name, schema);
  return schema;
}

/**
 * Internal: returns the live named-schema registry. The OpenAPI exporter
 * uses this to map SchemaNode references back to their registered names so
 * they can be promoted to `components.schemas` and replaced with `$ref` —
 * this is what makes `defineSchema('User', ...)` show up as
 * `$ref: '#/components/schemas/User'` in the exported spec.
 *
 * Not part of the public API. Returns the Map directly (no copy) for
 * performance; do not mutate from the outside.
 *
 * @returns {Map<string, SchemaNode>}
 */
function _getNamedSchemas() {
  return _schemaRegistry;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * jsdocTypeToSchemaNode  (private)
 *
 * Maps a JSDoc type string to a SchemaNode.
 * Supports primitives, `type[]` arrays, `object`, and any name registered
 * via `defineSchema`.
 *
 * @param {string} type
 * @returns {SchemaNode}
 */
function jsdocTypeToSchemaNode(type) {
  const t = type.trim();

  // Array shorthand: string[], User[], etc.
  if (t.endsWith('[]')) {
    const itemType = t.slice(0, -2);
    return { type: 'array', items: jsdocTypeToSchemaNode(itemType) };
  }
  // Generic Array<T>
  const genericArr = t.match(/^Array\s*<\s*(.+)\s*>$/i);
  if (genericArr) {
    return { type: 'array', items: jsdocTypeToSchemaNode(genericArr[1]) };
  }

  // Named schemas registered via defineSchema (checked before primitives so
  // user-defined names like 'Object' can be used, though that would be unusual)
  if (_schemaRegistry.has(t)) {
    return /** @type {SchemaNode} */ (_schemaRegistry.get(t));
  }

  switch (t.toLowerCase()) {
    case 'string': return { type: 'string' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'bool': return { type: 'boolean' };
    case 'int':
    case 'integer': return { type: 'number' };
    case 'float':
    case 'double': return { type: 'number' };
    case 'null': return { type: 'null' };
    case 'object': return { type: 'object', properties: {} };
    case 'array': return { type: 'array', items: { type: 'unknown' } };
    default: return { type: 'unknown' };
  }
}

/**
 * parseJSDoc
 *
 * Extracts route documentation from a JSDoc block comment found inside a
 * handler function's source string (via `fn.toString()`). Place the comment
 * at the very beginning of the function body:
 *
 * ```js
 * app.post('/users', function(req, res) {
 *   /**
 *    * Create a user
 *    * @param   {string} body.name    - Full name
 *    * @param   {string} body.email   - Email address
 *    * @param   {string} [query.role] - Filter role
 *    * @response {number} id
 *    * @response {string} name
 *    * @header  Authorization - Bearer <token>
 *    * /
 *   res.json({ id: 1 });
 * });
 * ```
 *
 * Supported tags:
 *   (first non-tag line) or `@description <text>` → route description
 *   `@param   {type} body.name  [-desc]` → request body property
 *   `@param   {type} query.name [-desc]` → query parameter
 *   `@response {type} name      [-desc]` → response object property
 *   `@returns {type}            [-desc]` → simple response type
 *   `@header  name              [-desc]` → request header
 *
 * Returns `null` if no JSDoc block is found.
 *
 * @param {Function} fn
 * @returns {{ description: string|null, headers: Record<string,string>|null, request: { body: SchemaNode|null, query: SchemaNode|null }|null, response: SchemaNode|null }|null}
 */
function parseJSDoc(fn) {
  let src;
  try { src = fn.toString(); } catch (_) { return null; }

  // Find the first /** ... */ block in the function source
  let match = src.match(/\/\*\*([\s\S]*?)\*\//);
  
  // Fallback for transpilers like tsx/esbuild that strip JSDoc from fn.toString()
  if (!match) {
    try {
      const stack = new Error().stack || '';
      const lines = stack.split('\n');
      for (const stLine of lines) {
        // Skip internal doctreen calls and node_modules
        if (stLine.includes('node_modules') || stLine.includes('doctreen/src')) continue;
        
        const fileMatch = stLine.match(/\(([^:)]+):(\d+):\d+\)/) || stLine.match(/at ([^:)]+):(\d+):\d+/);
        if (fileMatch) {
          const filePath = fileMatch[1].replace(/^file:\/\//, '');
          const fs = require('fs');
          if (fs.existsSync(filePath)) {
            const fileSrc = fs.readFileSync(filePath, 'utf-8');
            const lineNum = parseInt(fileMatch[2], 10) - 1;
            const fileLines = fileSrc.split('\n');
            // Grab 15 lines before and 20 lines after the route definition
            const startLine = Math.max(0, lineNum - 15);
            const endLine = Math.min(fileLines.length, lineNum + 20);
            const searchSlice = fileLines.slice(startLine, endLine).join('\n');
            const fallbackMatch = searchSlice.match(/\/\*\*([\s\S]*?)\*\//);
            if (fallbackMatch) {
              match = fallbackMatch;
              break;
            }
          }
        }
      }
    } catch (_) {}
  }

  if (!match) return null;

  const rawLines = match[1].split('\n');
  // Strip the leading whitespace + optional ' * ' from each line
  const lines = rawLines
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return null;

  let description = null;
  /** @type {Record<string,string>} */
  const headers = {};
  /** @type {Record<string, SchemaNode>} */
  const bodyProps = {};
  /** @type {Record<string, SchemaNode>} */
  const queryProps = {};
  /** @type {Record<string, SchemaNode>} */
  const responseProps = {};
  /** @type {SchemaNode|null} */
  let responseType = null;

  for (const line of lines) {
    if (/^@desc(ription)?\s/.test(line)) {
      description = line.replace(/^@desc(ription)?\s+/, '').trim();

    } else if (line.startsWith('@param')) {
      // @param {type} [prefix.name] - optional  (brackets → optional: true)
      // @param {type} prefix.name   - required
      const m = line.match(/^@param\s+\{([^}]+)\}\s+(\[?)([^\]\s]+)/);
      if (m) {
        const type = m[1];
        const isOptional = m[2] === '[';
        const namePart = m[3];
        const dot = namePart.indexOf('.');
        if (dot > -1) {
          const prefix = namePart.slice(0, dot);
          const propName = namePart.slice(dot + 1);
          const base = jsdocTypeToSchemaNode(type);
          const node = isOptional ? Object.assign({}, base, { optional: true }) : base;
          if (prefix === 'body') bodyProps[propName] = node;
          else if (prefix === 'query') queryProps[propName] = node;
        }
      }

    } else if (line.startsWith('@response')) {
      // @response {type} [propName] - optional  (brackets → optional: true)
      // @response {type} propName   - required
      const m = line.match(/^@response\s+\{([^}]+)\}\s+(\[?)([^\]\s-]+)/);
      if (m) {
        const isOptional = m[2] === '[';
        const base = jsdocTypeToSchemaNode(m[1]);
        responseProps[m[3]] = isOptional ? Object.assign({}, base, { optional: true }) : base;
      }

    } else if (/^@returns?\s/.test(line)) {
      // @returns {type}  or  @return {type}
      const m = line.match(/^@returns?\s+\{([^}]+)\}/);
      if (m) responseType = jsdocTypeToSchemaNode(m[1]);

    } else if (line.startsWith('@header')) {
      // @header Authorization - Bearer <token>
      const m = line.match(/^@header\s+(\S+)(?:\s+-\s+(.+))?/);
      if (m) headers[m[1]] = m[2] || m[1];

    } else if (!line.startsWith('@') && description === null) {
      // First non-tag, non-empty line becomes the description
      description = line;
    }
  }

  const hasBody = Object.keys(bodyProps).length > 0;
  const hasQuery = Object.keys(queryProps).length > 0;
  const hasRespProp = Object.keys(responseProps).length > 0;
  const hasHeaders = Object.keys(headers).length > 0;

  // Nothing useful extracted
  if (!description && !hasHeaders && !hasBody && !hasQuery && !hasRespProp && !responseType) {
    return null;
  }

  // Build response schema: @response props take precedence over @returns
  const response = hasRespProp
    ? { type: 'object', properties: responseProps }
    : responseType;

  return {
    description,
    headers: hasHeaders ? headers : null,
    request: (hasBody || hasQuery)
      ? {
        body: hasBody ? { type: 'object', properties: bodyProps } : null,
        query: hasQuery ? { type: 'object', properties: queryProps } : null,
      }
      : null,
    response: response || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  RouteRegistry,
  normalizeConfig,
  shouldExclude,
  inferSchema,
  defineSchema,
  _getNamedSchemas,
  parseJSDoc,
  s,
  flows: require('./flows/index'),
};
