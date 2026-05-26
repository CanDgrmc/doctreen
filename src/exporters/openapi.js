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
 * Convert documented request headers (Record<string, string>) into OpenAPI
 * `parameters[]` with `in: header`. The string value is treated as the
 * example / description for the header.
 *
 * @param {Record<string,string>|null} headers
 * @returns {Array<object>}
 */
function headerParameters(headers) {
  if (!headers || typeof headers !== 'object') return [];
  const out = [];
  for (const name of Object.keys(headers)) {
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
 * @returns {Array<object>}
 */
function buildParameters(entry) {
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
  const h = headerParameters(entry.requestHeaders);
  for (let i = 0; i < h.length; i++) out.push(h[i]);
  return out;
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
  const cfg  = config || {};
  const meta = cfg.meta || {};

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

    const operation = {
      operationId: operationIdFor(entry.method, entry.path),
      tags:        [tagFor(entry.path)],
      parameters:  buildParameters(entry),
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

    paths[openApiPath][entry.method.toLowerCase()] = operation;
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title:   meta.title   || 'API Documentation',
      version: meta.version || '1.0.0',
    },
    // `/` means "same origin as the docs page" — tools like Swagger UI use
    // this for their built-in "Try it out" feature. Users can override via
    // the new `openapi.servers` config option once we expose it.
    servers: [{ url: '/' }],
    paths: paths,
  };
  if (meta.description) doc.info.description = meta.description;

  return doc;
}

module.exports = {
  buildOpenApiDocument,
  // Exported for unit-level reuse / extension. Not part of the public API.
  schemaNodeToOpenApi,
  toOpenApiPath,
  operationIdFor,
};
