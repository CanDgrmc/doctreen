'use strict';

const { convertSchema } = require('./schemas');
const { isZodSchema } = require('../adapters/zod');

/**
 * Normalise a user-facing error map — `{ 401: 'msg', 422: { description, schema } }`
 * — into the internal `ErrorEntry[]` form `{ status, description, schema, validator }`.
 * Schema values (SchemaNode or Zod) are converted to a SchemaNode for the docs UI.
 * When the declared schema is a Zod schema its *original* is preserved in
 * `validator` so status-aware response assertion (v1.16) can `.safeParse()`
 * against the exact schema — a SchemaNode is descriptive, not a parser, so it
 * cannot validate. `validator` is null for description-only or `s.*`-only errors.
 * Returns null when empty.
 *
 * @param {Record<number, string | { description?: string|null, schema?: any }>|null|undefined} map
 * @returns {Array<{status:number,description:string|null,schema:any,validator:any}>|null}
 */
function normalizeErrorMap(map) {
  if (!map || typeof map !== 'object') return null;
  const out = [];
  for (const key of Object.keys(map)) {
    const status = parseInt(key, 10);
    if (!status) continue;
    const val = map[key];
    if (typeof val === 'string') {
      out.push({ status: status, description: val, schema: null, validator: null });
    } else if (isZodSchema(val)) {
      out.push({ status: status, description: null, schema: convertSchema(val) || null, validator: val });
    } else if (val && typeof val === 'object') {
      out.push({
        status: status,
        description: val.description != null ? val.description : null,
        schema: convertSchema(val.schema) || null,
        validator: isZodSchema(val.schema) ? val.schema : (val.validator || null),
      });
    }
  }
  return out.length ? out : null;
}

/**
 * Merge adapter/config-level default errors with a route's own errors.
 * The route's own entry wins on a status-code conflict. Result is sorted by
 * status for stable output.
 *
 * @param {Array<{status:number}>|null} defaults
 * @param {Array<{status:number}>|null} routeErrors
 * @returns {Array<{status:number}>|null}
 */
function mergeErrorEntries(defaults, routeErrors) {
  if (!defaults || defaults.length === 0) return routeErrors || null;
  const byStatus = new Map();
  for (let i = 0; i < defaults.length; i++) byStatus.set(defaults[i].status, defaults[i]);
  const own = routeErrors || [];
  for (let i = 0; i < own.length; i++) byStatus.set(own[i].status, own[i]);
  return Array.from(byStatus.values()).sort(function (a, b) { return a.status - b.status; });
}

/**
 * Return a view of `routes` where each route's `errors` is merged with the
 * config-level `defaultErrors`. Entries are shallow-copied so the shared
 * registry objects are never mutated (safe under liveReload).
 *
 * @param {Array<any>} routes
 * @param {Array<{status:number}>|null} defaultErrors
 * @returns {Array<any>}
 */
function applyDefaultErrors(routes, defaultErrors) {
  if (!defaultErrors || defaultErrors.length === 0) return routes;
  return routes.map(function (r) {
    return Object.assign({}, r, { errors: mergeErrorEntries(defaultErrors, r.errors) });
  });
}

module.exports = { normalizeErrorMap, mergeErrorEntries, applyDefaultErrors };
