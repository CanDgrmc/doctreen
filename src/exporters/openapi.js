'use strict';

/**
 * RouteRegistry → OpenAPI 3.1 document.
 *
 * Converts doctreen's internal route representation into an OpenAPI 3.1
 * JSON object suitable for Scalar, Redoc, Swagger UI, or any other
 * spec-driven tool. Schemas are inlined (no $ref deduplication in v1.7 —
 * that's a v1.8+ improvement) so the document is self-contained.
 *
 * Scope (v1.7):
 *   - GET / POST / PUT / PATCH / DELETE
 *   - request body (JSON only), query parameters, path parameters
 *   - 200 success response + declared error responses
 *   - request headers exposed as `parameters[].in = header`
 *   - tags derived from the first non-empty path segment
 *
 * Out of scope (deferred):
 *   - securitySchemes / auth definitions
 *   - callbacks, webhooks, links
 *   - $ref-based schema deduplication
 */

// ─── SchemaNode → OpenAPI Schema Object ─────────────────────────────────────

/**
 * Convert a doctreen SchemaNode to an OpenAPI Schema Object.
 * Returns a fresh object every call so the caller can mutate freely.
 *
 * @param {any} node  - SchemaNode or null
 * @returns {object|null}
 */
function schemaNodeToOpenApi(node) {
  if (node == null) return null;
  if (typeof node !== 'object') return null;

  const t = node.type;

  if (t === 'string')  return { type: 'string' };
  if (t === 'number')  return { type: 'number' };
  if (t === 'boolean') return { type: 'boolean' };
  if (t === 'null')    return { type: 'null' };

  if (t === 'object') {
    const props    = node.properties || {};
    const out      = { type: 'object', properties: {} };
    const required = [];
    for (const key of Object.keys(props)) {
      const child = props[key];
      const sub   = schemaNodeToOpenApi(child) || {};
      out.properties[key] = sub;
      if (!(child && child.optional === true)) required.push(key);
    }
    if (required.length > 0) out.required = required;
    return out;
  }

  if (t === 'array') {
    return { type: 'array', items: schemaNodeToOpenApi(node.items) || {} };
  }

  // 'unknown' or unrecognised → permissive empty schema
  return {};
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Express / Koa / Hono / Fastify all use `:param` syntax. OpenAPI uses
 * `{param}`. Normalise the path while preserving everything else.
 *
 * @param {string} routePath
 * @returns {string}
 */
function toOpenApiPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Build a deterministic, snake-ish operationId from method + path.
 *
 * @param {string} method
 * @param {string} routePath
 * @returns {string}
 */
function operationIdFor(method, routePath) {
  const slug = routePath
    .replace(/[{}:]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return method.toLowerCase() + (slug ? '_' + slug : '_root');
}

/**
 * Pick a single tag for grouping in the rendered docs UI. Uses the first
 * non-empty path segment, falling back to 'default'.
 *
 * @param {string} routePath
 * @returns {string}
 */
function tagFor(routePath) {
  const segments = routePath.split('/').filter(Boolean);
  if (segments.length === 0) return 'default';
  const seg = segments[0].replace(/[{}:]/g, '');
  return seg || 'default';
}

/**
 * Convert query SchemaNode to OpenAPI `parameters[]` entries.
 * Only object-typed schemas yield parameters — primitives at the top level
 * are not representable as query strings in OpenAPI.
 *
 * @param {any} querySchemaNode
 * @returns {Array<object>}
 */
function queryParameters(querySchemaNode) {
  if (!querySchemaNode || querySchemaNode.type !== 'object' || !querySchemaNode.properties) {
    return [];
  }
  const out = [];
  const props = querySchemaNode.properties;
  for (const key of Object.keys(props)) {
    const child = props[key];
    const sub   = schemaNodeToOpenApi(child) || {};
    out.push({
      name:     key,
      in:       'query',
      required: !(child && child.optional === true),
      schema:   sub,
    });
  }
  return out;
}

/**
 * Header names that should be omitted from `parameters[]` when an operation
 * has an effective `security` requirement — they are already conveyed by the
 * security scheme. Comparison is case-insensitive.
 *
 * Currently only `Authorization` is auto-stripped; cookie / apiKey schemes
 * may declare arbitrary header names, so future versions can grow this list
 * by reading from `securitySchemes` directly.
 */
const SECURITY_HEADER_BLOCKLIST = ['authorization'];

/**
 * Convert documented request headers (Record<string, string>) into OpenAPI
 * `parameters[]` with `in: header`. The string value is treated as the
 * example / description for the header.
 *
 * When `stripAuth` is true (route has an effective `security` declaration),
 * known auth headers like `Authorization` are omitted so the security
 * scheme is the single source of truth.
 *
 * @param {Record<string,string>|null} headers
 * @param {boolean} stripAuth
 * @returns {Array<object>}
 */
function headerParameters(headers, stripAuth) {
  if (!headers || typeof headers !== 'object') return [];
  const out = [];
  for (const name of Object.keys(headers)) {
    if (stripAuth && SECURITY_HEADER_BLOCKLIST.indexOf(name.toLowerCase()) !== -1) continue;
    out.push({
      name:        name,
      in:          'header',
      required:    false,
      description: headers[name] || undefined,
      schema:      { type: 'string' },
    });
  }
  return out;
}

/**
 * Build the `parameters[]` array for one route — path + query + header.
 *
 * @param {object} entry
 * @param {boolean} stripAuthHeaders
 * @returns {Array<object>}
 */
function buildParameters(entry, stripAuthHeaders) {
  const out = [];
  // Path parameters — always required by OpenAPI spec.
  for (const param of entry.params || []) {
    out.push({
      name:     param,
      in:       'path',
      required: true,
      schema:   { type: 'string' },
    });
  }
  if (entry.requestSchema) {
    const q = queryParameters(entry.requestSchema.query);
    for (let i = 0; i < q.length; i++) out.push(q[i]);
  }
  const h = headerParameters(entry.requestHeaders, stripAuthHeaders);
  for (let i = 0; i < h.length; i++) out.push(h[i]);
  return out;
}

/**
 * Resolve the effective `security` requirement for an entry, applying the
 * per-route override on top of the adapter-level default.
 *
 * Returns `null` when the route inherits the (possibly absent) global
 * default — let the caller emit no per-operation `security` so the spec
 * stays compact.
 *
 * @param {object} entry
 * @param {object} openapiCfg
 * @returns {Array|null}
 */
function effectiveSecurity(entry, openapiCfg) {
  if (entry.security !== undefined) return entry.security; // includes [] (explicit public)
  return (openapiCfg && Array.isArray(openapiCfg.security)) ? openapiCfg.security : null;
}

/**
 * Build the `requestBody` object for one route, or null when none was declared.
 * Always JSON in v1.7.
 *
 * @param {object} entry
 * @returns {object|null}
 */
function buildRequestBody(entry) {
  if (!entry.requestSchema || !entry.requestSchema.body) return null;
  const schema = schemaNodeToOpenApi(entry.requestSchema.body);
  if (!schema) return null;
  return {
    required: true,
    content:  { 'application/json': { schema: schema } },
  };
}

/**
 * Build the `responses` object for one route. Always includes a 200/201
 * success entry (using the declared response schema or an empty one);
 * plus every documented error.
 *
 * @param {object} entry
 * @returns {object}
 */
function buildResponses(entry) {
  const responses = {};
  const successCode = entry.method === 'POST' ? '201' : '200';
  const successSchema = schemaNodeToOpenApi(entry.responseSchema);
  const success = { description: 'Successful response' };
  if (successSchema) success.content = { 'application/json': { schema: successSchema } };
  responses[successCode] = success;

  if (Array.isArray(entry.errors)) {
    for (const err of entry.errors) {
      const code = String(err.status);
      const errSchema = schemaNodeToOpenApi(err.schema);
      const r = { description: err.description || 'Error response' };
      if (errSchema) r.content = { 'application/json': { schema: errSchema } };
      responses[code] = r;
    }
  }
  return responses;
}

// ─── Top-level builder ──────────────────────────────────────────────────────

/**
 * Build a complete OpenAPI 3.1 document from a list of RouteEntry objects.
 *
 * @param {Array<object>} routes - registry.getAll() output
 * @param {object} config        - normalised doctreen config (uses meta + docsPath)
 * @returns {object}             - the OpenAPI document, JSON-serializable
 */
function buildOpenApiDocument(routes, config) {
  const cfg        = config || {};
  const meta       = cfg.meta || {};
  const openapiCfg = cfg.openapi || {};

  /** @type {Record<string, Record<string, object>>} */
  const paths = {};

  for (const entry of routes || []) {
    if (!entry || !entry.path || !entry.method) continue;
    // Skip the docs UI route itself + its sub-routes.
    if (cfg.docsPath && (entry.path === cfg.docsPath || entry.path.indexOf(cfg.docsPath + '/') === 0)) {
      continue;
    }

    const openApiPath = toOpenApiPath(entry.path);
    if (!paths[openApiPath]) paths[openApiPath] = {};

    const security = effectiveSecurity(entry, openapiCfg);
    const hasSec   = Array.isArray(security) && security.length > 0;

    const operation = {
      operationId: operationIdFor(entry.method, entry.path),
      tags:        [tagFor(entry.path)],
      parameters:  buildParameters(entry, hasSec),
      responses:   buildResponses(entry),
    };

    if (entry.description) {
      const firstLine = entry.description.split('\n')[0].trim();
      operation.summary     = firstLine;
      if (entry.description !== firstLine) operation.description = entry.description;
    }
    if (operation.parameters.length === 0) delete operation.parameters;

    const body = buildRequestBody(entry);
    if (body) operation.requestBody = body;

    // Per-route security override emits an explicit `security` field (which
    // can be an empty array to mark a route public when there's a global
    // default). When no per-route override exists, the top-level
    // `doc.security` (if any) applies implicitly — no per-operation entry
    // needed, keeping the spec compact.
    if (entry.security !== undefined) {
      operation.security = entry.security;
    }

    paths[openApiPath][entry.method.toLowerCase()] = operation;
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title:   meta.title   || 'API Documentation',
      version: meta.version || '1.0.0',
    },
    // Defaults to `[{ url: '/' }]` via normalizeConfig so Swagger UI's
    // "Try it out" works against the live host. Users override via
    // `config.openapi.servers`.
    servers: Array.isArray(openapiCfg.servers) && openapiCfg.servers.length > 0
      ? openapiCfg.servers
      : [{ url: '/' }],
    paths: paths,
  };
  if (meta.description) doc.info.description = meta.description;

  if (openapiCfg.securitySchemes && typeof openapiCfg.securitySchemes === 'object') {
    doc.components = { securitySchemes: openapiCfg.securitySchemes };
  }
  if (Array.isArray(openapiCfg.security) && openapiCfg.security.length > 0) {
    doc.security = openapiCfg.security;
  }

  return doc;
}

module.exports = {
  buildOpenApiDocument,
  // Exported for unit-level reuse / extension. Not part of the public API.
  schemaNodeToOpenApi,
  toOpenApiPath,
  operationIdFor,
};
