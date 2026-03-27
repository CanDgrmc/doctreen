'use strict';

// ─── JSDoc typedefs ───────────────────────────────────────────────────────────
// These serve the library author's IDE experience while editing this file.
// The authoritative declarations for TypeScript consumers live in index.d.ts.

/**
 * @typedef {{ type: string, properties?: Record<string, SchemaNode>, items?: SchemaNode }} SchemaNode
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
 * @typedef {{ docsPath?: string, enabled?: boolean, meta?: { title?: string, version?: string, description?: string }, exclude?: Array<string|RegExp>, liveReload?: boolean, groups?: Record<string, { description?: string }> }} UserConfig
 */

/**
 * @typedef {{ docsPath: string, enabled: boolean, meta: { title: string, version: string, description: string }, exclude: Array<string|RegExp>, liveReload: boolean, groups: Record<string, { description: string }> }} NormalizedConfig
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
  parseJSDoc,
  s,
};
