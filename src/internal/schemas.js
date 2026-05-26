'use strict';

const { isZodSchema, zodToSchemaNode } = require('../adapters/zod');

/**
 * Accepts a SchemaNode (from the `s` builder) or a Zod schema and returns a
 * SchemaNode. Returns null when input is null/undefined or unrecognised.
 *
 * @param {any} schema
 * @returns {import('../index').SchemaNode|null}
 */
function convertSchema(schema) {
  if (schema == null) return null;
  if (isZodSchema(schema)) return zodToSchemaNode(schema);
  if (typeof schema === 'object' && typeof schema.type === 'string') return schema;
  return null;
}

/**
 * Normalises a `defineRoute` / `@DocRoute` schemas bag so that any Zod schemas
 * inside it are converted to internal SchemaNode form at definition time.
 * Adapter consumption code can then treat all schemas uniformly.
 *
 * Mutates and returns a shallow copy — the original object is left untouched.
 *
 * @param {any} schemas
 * @returns {any}
 */
function normalizeRouteSchemas(schemas) {
  if (!schemas || typeof schemas !== 'object') return schemas;

  const out = Object.assign({}, schemas);

  if (out.request && typeof out.request === 'object' && !isZodSchema(out.request)) {
    const req = {};
    if ('body' in out.request)  req.body  = convertSchema(out.request.body);
    if ('query' in out.request) req.query = convertSchema(out.request.query);
    out.request = req;
  } else if (isZodSchema(out.request)) {
    out.request = { body: convertSchema(out.request), query: null };
  }

  if ('response' in out) out.response = convertSchema(out.response);

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

  return out;
}

module.exports = { convertSchema, normalizeRouteSchemas };
