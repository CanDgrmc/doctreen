'use strict';

const { isZodSchema, zodToSchemaNode } = require('../adapters/zod');
const { getSchemaName, setSchemaName } = require('./named-schema');

/**
 * Accepts a SchemaNode (from the `s` builder) or a Zod schema and returns a
 * SchemaNode. Returns null when input is null/undefined or unrecognised.
 *
 * @param {any} schema
 * @returns {import('../index').SchemaNode|null}
 */
function convertSchema(schema) {
  if (schema == null) return null;
  let node;
  if (isZodSchema(schema)) node = zodToSchemaNode(schema);
  else if (typeof schema === 'object' && typeof schema.type === 'string') node = schema;
  else return null;
  // Carry a defineSchema name onto the converted node (a Zod conversion yields a
  // fresh object, losing the tag set on the original). SchemaNode inputs are
  // passed through unchanged, so their tag is already present.
  const name = getSchemaName(schema);
  if (name && node && typeof node === 'object' && !getSchemaName(node)) {
    setSchemaName(node, name);
  }
  return node;
}

/**
 * A status-keyed response map is a plain object whose keys are all 3-digit
 * HTTP status codes (`{ 200: schema, 201: schema }`) — distinct from a single
 * SchemaNode (has `.type`) or a Zod schema (has `._def`).
 *
 * @param {any} v
 * @returns {boolean}
 */
function isStatusKeyedResponse(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (isZodSchema(v)) return false;
  if (typeof v.type === 'string') return false; // SchemaNode
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  return keys.every(function (k) { return /^\d{3}$/.test(k); });
}

/**
 * Choose the primary status for back-compat single-schema consumers: prefer
 * 200, then 201, then the lowest 2xx, then the lowest status overall.
 *
 * @param {string[]} statuses
 * @returns {string|null}
 */
function pickPrimaryStatus(statuses) {
  if (!statuses || statuses.length === 0) return null;
  if (statuses.indexOf('200') !== -1) return '200';
  if (statuses.indexOf('201') !== -1) return '201';
  const sorted = statuses.slice().sort();
  const twoxx = sorted.filter(function (s) { return s.charAt(0) === '2'; });
  return (twoxx[0] || sorted[0]);
}

/**
 * Normalise a `response` field into its four internal representations:
 * a primary single SchemaNode (back-compat), a status-keyed SchemaNode map,
 * a primary Zod validator, and a status-keyed Zod validator map. Shared by
 * `normalizeRouteSchemas` and the NestJS adapter (which reads raw `@DocRoute`
 * metadata directly).
 *
 * @param {any} value
 * @returns {{ response: any, responses: object|null, responseValidator: any, responseValidators: object|null }}
 */
function normalizeResponseField(value) {
  const out = { response: null, responses: null, responseValidator: null, responseValidators: null };
  if (value === undefined) return out;

  if (isStatusKeyedResponse(value)) {
    const responses = {};
    const responseValidators = {};
    for (const code of Object.keys(value)) {
      responses[code] = convertSchema(value[code]);
      responseValidators[code] = isZodSchema(value[code]) ? value[code] : null;
    }
    const primary = pickPrimaryStatus(Object.keys(value));
    out.responses = responses;
    out.response = (primary && responses[primary]) || null;
    if (Object.keys(responseValidators).some(function (k) { return responseValidators[k]; })) {
      out.responseValidators = responseValidators;
    }
    out.responseValidator = (primary && responseValidators[primary]) || null;
  } else {
    out.response = convertSchema(value);
    out.responseValidator = isZodSchema(value) ? value : null;
  }
  return out;
}

/**
 * Normalises a `defineRoute` / `@DocRoute` schemas bag so that any Zod schemas
 * inside it are converted to internal SchemaNode form at definition time.
 * Adapter consumption code can then treat all schemas uniformly.
 *
 * Mutates and returns a shallow copy — the original object is left untouched.
 *
 * In addition to producing SchemaNodes for the docs UI, this function preserves
 * the *original* Zod schemas (when present) in an internal `validators` slot
 * so that v1.6+ runtime-validation can call `.safeParseAsync()` against the
 * exact schema the user defined — not the lossy SchemaNode representation.
 *
 * @param {any} schemas
 * @returns {any}
 */
function normalizeRouteSchemas(schemas) {
  if (!schemas || typeof schemas !== 'object') return schemas;

  const out = Object.assign({}, schemas);

  // Keep references to original Zod schemas — needed for runtime validation.
  let originalBody   = null;
  let originalQuery  = null;
  let originalParams = null;

  if (out.request && typeof out.request === 'object' && !isZodSchema(out.request)) {
    if (isZodSchema(out.request.body))   originalBody   = out.request.body;
    if (isZodSchema(out.request.query))  originalQuery  = out.request.query;
    if (isZodSchema(out.request.params)) originalParams = out.request.params;

    const req = {};
    if ('body' in out.request)   req.body   = convertSchema(out.request.body);
    if ('query' in out.request)  req.query  = convertSchema(out.request.query);
    if ('params' in out.request) req.params = convertSchema(out.request.params);
    out.request = req;
  } else if (isZodSchema(out.request)) {
    originalBody = out.request;
    out.request = { body: convertSchema(out.request), query: null };
  }

  // Response schema(s). `response` may be a single schema (SchemaNode or Zod)
  // or a status-keyed map `{ 200: schema, 201: schema }` (v1.15).
  if ('response' in out) {
    const r = normalizeResponseField(out.response);
    out.response = r.response; // back-compat single (primary 2xx)
    if (r.responses)          out.responses          = r.responses;
    if (r.responseValidators) out.responseValidators = r.responseValidators;
    if (r.responseValidator)  out.responseValidator  = r.responseValidator;
  }

  if (out.errors && typeof out.errors === 'object') {
    const normErrors = {};
    for (const code of Object.keys(out.errors)) {
      const v = out.errors[code];
      if (v && typeof v === 'object' && !isZodSchema(v) && 'schema' in v) {
        normErrors[code] = Object.assign({}, v, { schema: convertSchema(v.schema) });
      } else if (isZodSchema(v)) {
        normErrors[code] = { description: null, schema: convertSchema(v) };
      } else {
        normErrors[code] = v;
      }
    }
    out.errors = normErrors;
  }

  // Attach validators only when at least one Zod schema was supplied; absence
  // of this property means "nothing to validate against".
  if (originalBody || originalQuery || originalParams) {
    out.validators = { body: originalBody, query: originalQuery, params: originalParams };
  }

  // OpenAPI 3.1 callbacks (v1.11+). Each callback entry can carry its own
  // request/response/errors schemas, which may be Zod. Recurse so the
  // OpenAPI exporter sees uniform SchemaNodes only.
  if (out.callbacks && typeof out.callbacks === 'object') {
    out.callbacks = normaliseCallbacksBag(out.callbacks);
  }

  return out;
}

/**
 * Normalise a `{ name: { url, method, request?, response?, errors? } }` bag,
 * converting any nested Zod schemas to SchemaNodes. Shared between
 * `defineRoute({ callbacks })` and `config.openapi.webhooks` (which has the
 * same shape minus the `url`).
 *
 * @param {Record<string, any>} bag
 * @returns {Record<string, any>}
 */
function normaliseCallbacksBag(bag) {
  const out = {};
  for (const name of Object.keys(bag)) {
    const cb = bag[name];
    if (!cb || typeof cb !== 'object') continue;
    const norm = Object.assign({}, cb);

    if (norm.request && typeof norm.request === 'object' && !isZodSchema(norm.request)) {
      const req = {};
      if ('body' in norm.request)  req.body  = convertSchema(norm.request.body);
      if ('query' in norm.request) req.query = convertSchema(norm.request.query);
      norm.request = req;
    } else if (isZodSchema(norm.request)) {
      norm.request = { body: convertSchema(norm.request), query: null };
    }

    if ('response' in norm) norm.response = convertSchema(norm.response);

    if (norm.errors && typeof norm.errors === 'object') {
      const normErrors = {};
      for (const code of Object.keys(norm.errors)) {
        const v = norm.errors[code];
        if (v && typeof v === 'object' && !isZodSchema(v) && 'schema' in v) {
          normErrors[code] = Object.assign({}, v, { schema: convertSchema(v.schema) });
        } else if (isZodSchema(v)) {
          normErrors[code] = { description: null, schema: convertSchema(v) };
        } else {
          normErrors[code] = v;
        }
      }
      norm.errors = normErrors;
    }

    out[name] = norm;
  }
  return out;
}

module.exports = { convertSchema, normalizeRouteSchemas, normaliseCallbacksBag, normalizeResponseField };
