'use strict';

/**
 * RouteRegistry → OpenAPI 3.1 document.
 *
 * Converts doctreen's internal route representation into an OpenAPI 3.1
 * JSON object suitable for Scalar, Redoc, Swagger UI, or any other
 * spec-driven tool.
 *
 * Scope:
 *   - GET / POST / PUT / PATCH / DELETE
 *   - request body (JSON only), query parameters, path parameters
 *   - 200/201 success response + declared error responses
 *   - request headers exposed as `parameters[].in = header`
 *   - tags: per-route override (defineRoute({ tags })) > path-segment fallback
 *   - top-level `tags[]` metadata via `config.openapi.tags`
 *   - `components.schemas` with `$ref` deduplication for named schemas
 *     (defineSchema) + auto-promotion of repeated anonymous object subtrees
 *   - per-operation `callbacks` and document-level `webhooks` (OpenAPI 3.1)
 *   - multi-example bodies + responses (`example` and `examples` map)
 *
 * Out of scope (still):
 *   - Links
 *   - oneOf / anyOf composition (until SchemaNode supports unions)
 */

const { _getNamedSchemas } = require('../index');

// ─── SchemaNode → OpenAPI Schema Object ─────────────────────────────────────

/**
 * Context for a single document build. Tracks identity-mapped named schemas
 * (from `defineSchema`) and structurally-hashed anonymous duplicates so they
 * can be promoted to `components.schemas` and replaced with `$ref`.
 *
 * Two-pass strategy:
 *   1. Convert every schema, tagging each emitted Schema Object with the
 *      original SchemaNode it came from (in WeakMap).
 *   2. For named SchemaNodes referenced anywhere: register under their name
 *      and replace inline occurrences with `{ $ref: '#/components/schemas/Name' }`.
 *   3. For anonymous object schemas with structural hash count >= 2 AND
 *      complexity >= 3 properties: auto-generate name `SchemaN`, promote.
 *
 * Names from defineSchema win over auto-generated names; if a user-named
 * schema collides with a different anonymous structure, the user wins.
 */
function createSchemaContext() {
  const named = _getNamedSchemas(); // Map<name, SchemaNode>
  // Reverse map for O(1) lookup: SchemaNode identity → name.
  const nodeToName = new Map();
  for (const [name, node] of named) nodeToName.set(node, name);

  /** Hash → { name, openapiSchema, count } for anonymous dedup. */
  const anonByHash = new Map();
  /** Final components.schemas map (name → OpenAPI Schema). */
  const components = {};
  /** Track which named SchemaNodes were actually referenced this build. */
  const referencedNames = new Set();
  /** Anonymous auto-name counter. */
  let anonCounter = 0;

  function refFor(name) {
    return { $ref: '#/components/schemas/' + name };
  }

  /**
   * Convert a SchemaNode to an OpenAPI Schema Object, emitting `$ref`s for
   * named schemas (and tracking anonymous duplicates for later promotion).
   *
   * @param {any} node
   * @returns {object|null}
   */
  function convert(node) {
    if (node == null || typeof node !== 'object') return null;

    // Named schema → register + ref.
    const name = nodeToName.get(node);
    if (name) {
      if (!components[name]) {
        // Reserve the slot before recursing, so cycles (defineSchema A →
        // refers to A) terminate via ref.
        components[name] = {};
        const inline = convertInline(node);
        components[name] = inline;
      }
      referencedNames.add(name);
      return refFor(name);
    }

    return convertInline(node);
  }

  function convertInline(node) {
    if (node == null || typeof node !== 'object') return null;
    const t = node.type;

    if (t === 'object') {
      const props = node.properties || {};
      const out = { type: 'object', properties: {} };
      const required = [];
      for (const key of Object.keys(props)) {
        const child = props[key];
        const sub = convert(child) || {};
        out.properties[key] = sub;
        if (!(child && child.optional === true)) required.push(key);
      }
      if (required.length > 0) out.required = required;
      decorate(out, node);
      // Track anonymous object subtrees for later auto-dedup.
      if (!nodeToName.has(node)) trackAnon(out);
      return out;
    }

    let out;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'null') {
      out = { type: t };
    } else if (t === 'array') {
      out = { type: 'array', items: convert(node.items) || {} };
    } else {
      out = {};
    }
    return decorate(out, node);
  }

  /**
   * Copy the value-level facets (`enum`, `const`, `default`) from a SchemaNode
   * onto its OpenAPI Schema Object, and fold `nullable` into an OpenAPI 3.1
   * `type: [<type>, 'null']` union. Mutates and returns `out`.
   */
  function decorate(out, node) {
    if (Array.isArray(node.enum) && node.enum.length > 0) out.enum = node.enum.slice();
    if (node.const !== undefined) out.const = node.const;
    if (node.default !== undefined) out.default = node.default;

    if (node.nullable === true && typeof out.type === 'string' && out.type !== 'null') {
      out.type = [out.type, 'null'];
      if (Array.isArray(out.enum) && out.enum.indexOf(null) === -1) out.enum.push(null);
    }
    return out;
  }

  function trackAnon(openapiSchema) {
    // Only consider non-trivial object schemas: >= 3 properties.
    if (!openapiSchema || openapiSchema.type !== 'object') return;
    const propCount = Object.keys(openapiSchema.properties || {}).length;
    if (propCount < 3) return;

    const hash = stableHash(openapiSchema);
    const existing = anonByHash.get(hash);
    if (existing) {
      existing.count++;
      existing.occurrences.push(openapiSchema);
    } else {
      anonByHash.set(hash, { count: 1, occurrences: [openapiSchema] });
    }
  }

  /**
   * After all routes have been converted, promote anonymous object subtrees
   * that appeared >= 2 times to `components.schemas` and replace every
   * occurrence with a `$ref`. Operates in-place on the document.
   */
  function finalize(doc) {
    // Auto-name anonymous duplicates.
    for (const entry of anonByHash.values()) {
      if (entry.count < 2) continue;

      const name = nextAnonName();
      // Store a deep clone in components — the in-document occurrences will
      // all be replaced with $ref, so we mustn't share a reference with any
      // of them.
      components[name] = JSON.parse(JSON.stringify(entry.occurrences[0]));

      // Replace EVERY occurrence (including the first) with a $ref. Mutate
      // in place so existing parents (paths/requestBody/responses) don't
      // need re-walking.
      for (const occ of entry.occurrences) {
        for (const k of Object.keys(occ)) delete occ[k];
        occ.$ref = '#/components/schemas/' + name;
      }
    }

    if (Object.keys(components).length > 0) {
      doc.components = doc.components || {};
      doc.components.schemas = Object.assign({}, components);
    }
  }

  function nextAnonName() {
    while (true) {
      anonCounter++;
      const candidate = 'Schema' + anonCounter;
      if (!components[candidate] && !nodeToName.has(candidate)) return candidate;
    }
  }

  return {
    convert: convert,
    finalize: finalize,
  };
}

/**
 * Stable structural hash for an OpenAPI Schema Object. Sorts object keys and
 * stringifies. Skips refs (they're a leaf for hash purposes).
 *
 * @param {object} obj
 * @returns {string}
 */
function stableHash(obj) {
  return JSON.stringify(obj, stableHashReplacer);
}

function stableHashReplacer(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value).sort();
    const out = {};
    for (const k of keys) out[k] = value[k];
    return out;
  }
  return value;
}

// ─── Path / operation helpers ───────────────────────────────────────────────

function toOpenApiPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function operationIdFor(method, routePath) {
  const slug = routePath
    .replace(/[{}:]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return method.toLowerCase() + (slug ? '_' + slug : '_root');
}

function defaultTagFor(routePath) {
  const segments = routePath.split('/').filter(Boolean);
  if (segments.length === 0) return 'default';
  const seg = segments[0].replace(/[{}:]/g, '');
  return seg || 'default';
}

function resolveTags(entry) {
  if (Array.isArray(entry.tags) && entry.tags.length > 0) {
    return entry.tags.filter(function (t) { return typeof t === 'string' && t.length > 0; });
  }
  return [defaultTagFor(entry.path)];
}

function queryParameters(querySchemaNode, ctx) {
  if (!querySchemaNode || querySchemaNode.type !== 'object' || !querySchemaNode.properties) return [];
  const out = [];
  const props = querySchemaNode.properties;
  for (const key of Object.keys(props)) {
    const child = props[key];
    const sub = ctx.convert(child) || {};
    out.push({
      name: key,
      in: 'query',
      required: !(child && child.optional === true),
      schema: sub,
    });
  }
  return out;
}

const SECURITY_HEADER_BLOCKLIST = ['authorization'];

function headerParameters(headers, stripAuth) {
  if (!headers || typeof headers !== 'object') return [];
  const out = [];
  for (const name of Object.keys(headers)) {
    if (stripAuth && SECURITY_HEADER_BLOCKLIST.indexOf(name.toLowerCase()) !== -1) continue;
    out.push({
      name: name,
      in: 'header',
      required: false,
      description: headers[name] || undefined,
      schema: { type: 'string' },
    });
  }
  return out;
}

function buildParameters(entry, stripAuthHeaders, ctx) {
  const out = [];
  // Path params (v1.15): if the route declared a `request.params` schema, type
  // each path parameter from it; otherwise fall back to plain string. Path
  // params are always `required` in OpenAPI regardless of the schema.
  const paramsSchema = entry.requestSchema && entry.requestSchema.params;
  const paramProps =
    paramsSchema && paramsSchema.type === 'object' && paramsSchema.properties
      ? paramsSchema.properties
      : null;
  for (const param of entry.params || []) {
    const node = paramProps ? paramProps[param] : null;
    out.push({
      name: param,
      in: 'path',
      required: true,
      schema: node ? (ctx.convert(node) || { type: 'string' }) : { type: 'string' },
    });
  }
  if (entry.requestSchema) {
    const q = queryParameters(entry.requestSchema.query, ctx);
    for (let i = 0; i < q.length; i++) out.push(q[i]);
  }
  const h = headerParameters(entry.requestHeaders, stripAuthHeaders);
  for (let i = 0; i < h.length; i++) out.push(h[i]);
  return out;
}

function effectiveSecurity(entry, openapiCfg) {
  if (entry.security !== undefined) return entry.security;
  return (openapiCfg && Array.isArray(openapiCfg.security)) ? openapiCfg.security : null;
}

// ─── Examples ───────────────────────────────────────────────────────────────

/**
 * Normalise an `examples` value into a Media Type Object's `example`/`examples`
 * pair. Accepts:
 *   - a single value → emitted as `example`
 *   - a `{ name: { value, summary?, description? } }` map → emitted as `examples`
 *   - a `{ name: value }` map (no metadata) → wrapped into `{ name: { value } }`
 *
 * @param {any} input
 * @returns {{ example?: any, examples?: object }|null}
 */
function normaliseExamples(input) {
  if (input == null) return null;

  if (typeof input !== 'object' || Array.isArray(input)) {
    return { example: input };
  }

  // Heuristic: if the keys all map to objects with `value`/`summary`/`description`,
  // treat as named examples map. Otherwise treat as a single example object.
  const keys = Object.keys(input);
  if (keys.length === 0) return null;

  const looksLikeMap = keys.every(function (k) {
    const v = input[k];
    return v && typeof v === 'object' && !Array.isArray(v) && (
      'value' in v || 'summary' in v || 'description' in v || 'externalValue' in v
    );
  });

  if (looksLikeMap) {
    const out = {};
    for (const k of keys) {
      const v = input[k];
      const entry = {};
      if ('value' in v) entry.value = v.value;
      if (typeof v.summary === 'string') entry.summary = v.summary;
      if (typeof v.description === 'string') entry.description = v.description;
      if (typeof v.externalValue === 'string') entry.externalValue = v.externalValue;
      out[k] = entry;
    }
    return { examples: out };
  }

  return { example: input };
}

function attachExamplesToMediaType(mediaType, examplesInput) {
  const ex = normaliseExamples(examplesInput);
  if (!ex) return;
  if (ex.example !== undefined) mediaType.example = ex.example;
  if (ex.examples) mediaType.examples = ex.examples;
}

// ─── Request body + responses ───────────────────────────────────────────────

function buildRequestBody(entry, ctx) {
  if (!entry.requestSchema || !entry.requestSchema.body) return null;
  const schema = ctx.convert(entry.requestSchema.body);
  if (!schema) return null;
  const mediaType = { schema: schema };

  const requestExamples = entry.examples && (entry.examples.request || entry.examples.body);
  if (requestExamples) attachExamplesToMediaType(mediaType, requestExamples);

  return {
    required: true,
    content: { 'application/json': mediaType },
  };
}

function buildResponses(entry, ctx) {
  const responses = {};
  const successCode = entry.method === 'POST' ? '201' : '200';
  const successSchema = ctx.convert(entry.responseSchema);
  const success = { description: 'Successful response' };
  if (successSchema) {
    const mediaType = { schema: successSchema };
    if (entry.examples && (entry.examples.response || entry.examples.success)) {
      attachExamplesToMediaType(mediaType, entry.examples.response || entry.examples.success);
    }
    success.content = { 'application/json': mediaType };
  }
  responses[successCode] = success;

  if (Array.isArray(entry.errors)) {
    for (const err of entry.errors) {
      const code = String(err.status);
      const errSchema = ctx.convert(err.schema);
      const r = { description: err.description || 'Error response' };
      if (errSchema) r.content = { 'application/json': { schema: errSchema } };
      // Per-error example via `entry.examples.responses[<status>]`.
      if (entry.examples && entry.examples.responses && entry.examples.responses[code]) {
        if (!r.content) r.content = { 'application/json': { schema: {} } };
        attachExamplesToMediaType(r.content['application/json'], entry.examples.responses[code]);
      }
      responses[code] = r;
    }
  }
  return responses;
}

// ─── Callbacks (per-operation) ──────────────────────────────────────────────

/**
 * Build an OpenAPI Callbacks Object from a user-friendly callbacks bag:
 *
 *   defineRoute(handler, {
 *     callbacks: {
 *       onPaymentSuccess: {
 *         url: '{$request.body#/callbackUrl}',
 *         method: 'POST',
 *         summary: 'Notify payer',
 *         request: { body: s.object({ paymentId: s.string() }) },
 *         response: s.object({ ok: s.boolean() }),
 *       },
 *     },
 *   })
 *
 * @param {object|null} callbacks
 * @param {object} ctx
 * @returns {object|null}
 */
function buildCallbacks(callbacks, ctx) {
  if (!callbacks || typeof callbacks !== 'object') return null;
  const out = {};
  for (const name of Object.keys(callbacks)) {
    const cb = callbacks[name];
    if (!cb || typeof cb !== 'object' || !cb.url || !cb.method) continue;
    out[name] = {};
    out[name][cb.url] = buildPathItemFromDef(cb, ctx);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function buildPathItemFromDef(def, ctx) {
  const method = String(def.method || 'post').toLowerCase();
  const op = {};
  if (def.summary) op.summary = def.summary;
  if (def.description) op.description = def.description;

  // Build a tiny entry-like for reuse of buildRequestBody/buildResponses.
  const fauxEntry = {
    method: method.toUpperCase(),
    params: [],
    requestHeaders: null,
    requestSchema: def.request
      ? {
          body: def.request.body || null,
          query: def.request.query || null,
        }
      : null,
    responseSchema: def.response || null,
    errors: def.errors
      ? Object.keys(def.errors).map(function (status) {
          const v = def.errors[status];
          return typeof v === 'string'
            ? { status: Number(status), description: v, schema: null }
            : {
                status: Number(status),
                description: (v && v.description) || null,
                schema: (v && v.schema) || null,
              };
        })
      : null,
    examples: def.examples || null,
  };
  const params = buildParameters(fauxEntry, false, ctx);
  if (params.length > 0) op.parameters = params;
  const body = buildRequestBody(fauxEntry, ctx);
  if (body) op.requestBody = body;
  op.responses = buildResponses(fauxEntry, ctx);

  const pathItem = {};
  pathItem[method] = op;
  return pathItem;
}

// ─── Webhooks (document-level) ──────────────────────────────────────────────

/**
 * Build the document-level `webhooks` map. Each entry is a Path Item Object
 * keyed by event name. Webhooks are NOT routes the server handles — they
 * describe outgoing event contracts.
 *
 * Input shape (under `config.openapi.webhooks`):
 *
 *   {
 *     userCreated: {
 *       method: 'POST',
 *       summary: 'Fired when a user signs up',
 *       request: { body: s.object({ userId: s.string() }) },
 *       response: s.object({ ok: s.boolean() }),
 *     },
 *   }
 *
 * @param {object|null} webhooks
 * @param {object} ctx
 * @returns {object|null}
 */
function buildWebhooks(webhooks, ctx) {
  if (!webhooks || typeof webhooks !== 'object') return null;
  const out = {};
  for (const name of Object.keys(webhooks)) {
    const def = webhooks[name];
    if (!def || typeof def !== 'object') continue;
    out[name] = buildPathItemFromDef(def, ctx);
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ─── Top-level builder ──────────────────────────────────────────────────────

function buildOpenApiDocument(routes, config) {
  const cfg = config || {};
  const meta = cfg.meta || {};
  const openapiCfg = cfg.openapi || {};

  const ctx = createSchemaContext();

  /** @type {Record<string, Record<string, object>>} */
  const paths = {};
  /** Tags actually used by operations (used to fill in defaults below). */
  const usedTags = new Set();

  for (const entry of routes || []) {
    if (!entry || !entry.path || !entry.method) continue;
    if (cfg.docsPath && (entry.path === cfg.docsPath || entry.path.indexOf(cfg.docsPath + '/') === 0)) continue;

    const openApiPath = toOpenApiPath(entry.path);
    if (!paths[openApiPath]) paths[openApiPath] = {};

    const security = effectiveSecurity(entry, openapiCfg);
    const hasSec = Array.isArray(security) && security.length > 0;

    const tags = resolveTags(entry);
    for (const t of tags) usedTags.add(t);

    const operation = {
      operationId: operationIdFor(entry.method, entry.path),
      tags: tags,
      parameters: buildParameters(entry, hasSec, ctx),
      responses: buildResponses(entry, ctx),
    };

    if (entry.description) {
      const firstLine = entry.description.split('\n')[0].trim();
      operation.summary = firstLine;
      if (entry.description !== firstLine) operation.description = entry.description;
    }
    if (operation.parameters.length === 0) delete operation.parameters;

    const body = buildRequestBody(entry, ctx);
    if (body) operation.requestBody = body;

    if (entry.security !== undefined) operation.security = entry.security;

    const cb = buildCallbacks(entry.callbacks, ctx);
    if (cb) operation.callbacks = cb;

    paths[openApiPath][entry.method.toLowerCase()] = operation;
  }

  const doc = {
    openapi: '3.1.0',
    info: { title: meta.title || 'API Documentation', version: meta.version || '1.0.0' },
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

  // Tags: merge declared metadata with auto-discovered tag names.
  const declaredTags = Array.isArray(openapiCfg.tags) ? openapiCfg.tags : [];
  const declaredNames = new Set(declaredTags.map(function (t) { return t && t.name; }));
  const tagsOut = declaredTags.slice();
  for (const name of usedTags) {
    if (!declaredNames.has(name)) tagsOut.push({ name: name });
  }
  if (tagsOut.length > 0) doc.tags = tagsOut;

  // Document-level webhooks.
  const webhooks = buildWebhooks(openapiCfg.webhooks, ctx);
  if (webhooks) doc.webhooks = webhooks;

  // Finalise: anonymous-duplicate promotion + components.schemas attachment.
  ctx.finalize(doc);

  return doc;
}

module.exports = {
  buildOpenApiDocument: buildOpenApiDocument,
  // Exported for unit-level reuse / extension. Not part of the public API.
  toOpenApiPath: toOpenApiPath,
  operationIdFor: operationIdFor,
  defaultTagFor: defaultTagFor,
  normaliseExamples: normaliseExamples,
};
