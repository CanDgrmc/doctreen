'use strict';

/**
 * Schema Drift Detection (experimental).
 *
 * Compares an incoming request payload against the schema declared via
 * `defineRoute` / `@DocRoute` and emits a one-line `console.warn` for any
 * mismatch. Only runs when `NODE_ENV !== 'production'`. Top-level shape
 * comparison only — does not recurse into nested objects to keep false
 * positives low for the v1.5 experimental release.
 *
 * Drift kinds:
 *   - missing-required   declared property missing in payload
 *   - unexpected-field   payload property not declared in schema
 *   - type-mismatch      declared type differs from actual JS typeof
 */

/**
 * Map a JS value to one of the SchemaNode primitive type strings.
 * @param {any} v
 * @returns {string}
 */
function actualType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  return 'unknown';
}

/**
 * Diffs an actual payload against a SchemaNode (top-level only).
 *
 * @param {any} declared     A SchemaNode — typically `entry.requestSchema.body`.
 * @param {any} actual       The actual payload — `req.body` or `req.query`.
 * @returns {Array<{ kind: string, field: string, expected?: string, got?: string }>}
 */
function diffShape(declared, actual) {
  /** @type {Array<{ kind: string, field: string, expected?: string, got?: string }>} */
  const issues = [];
  if (!declared || typeof declared !== 'object') return issues;
  if (actual == null || typeof actual !== 'object' || Array.isArray(actual)) return issues;

  // Only compare object-typed declared schemas — primitive declared bodies aren't
  // useful for top-level drift.
  if (declared.type !== 'object' || !declared.properties) return issues;

  const declaredProps = declared.properties;

  for (const key of Object.keys(declaredProps)) {
    const propSchema = declaredProps[key];
    const isOptional = propSchema && propSchema.optional === true;
    if (!(key in actual)) {
      if (!isOptional) issues.push({ kind: 'missing-required', field: key, expected: propSchema && propSchema.type });
      continue;
    }
    const expected = propSchema && propSchema.type;
    const got = actualType(actual[key]);
    if (expected && expected !== 'unknown' && got !== expected && !(expected === 'number' && got === 'string' && !isNaN(Number(actual[key])))) {
      issues.push({ kind: 'type-mismatch', field: key, expected: expected, got: got });
    }
  }

  for (const key of Object.keys(actual)) {
    if (!(key in declaredProps)) {
      issues.push({ kind: 'unexpected-field', field: key, got: actualType(actual[key]) });
    }
  }

  return issues;
}

/**
 * Emit a console.warn line describing drift. Called at most once per
 * (route, drift signature) per process to avoid log flooding.
 *
 * @param {{ method: string, path: string }} route
 * @param {string} part    'body' or 'query'
 * @param {Array<{ kind: string, field: string, expected?: string, got?: string }>} issues
 */
const SEEN = new Set();
function reportDrift(route, part, issues) {
  if (!issues || issues.length === 0) return;
  const sig = route.method + ' ' + route.path + ' ' + part + ' ' + issues.map(function (i) { return i.kind + ':' + i.field; }).join(',');
  if (SEEN.has(sig)) return;
  SEEN.add(sig);

  const parts = issues.map(function (i) {
    if (i.kind === 'missing-required') return 'missing required `' + i.field + '`';
    if (i.kind === 'unexpected-field') return 'unexpected `' + i.field + '` (got ' + i.got + ')';
    if (i.kind === 'type-mismatch') return '`' + i.field + '` expected ' + i.expected + ', got ' + i.got;
    return i.kind + ' ' + i.field;
  });

  // eslint-disable-next-line no-console
  console.warn('[doctreen] schema drift on ' + route.method + ' ' + route.path + ' ' + part + ': ' + parts.join('; '));
}

/**
 * Reset the dedup cache. Mostly useful in tests.
 */
function _resetDriftCache() {
  SEEN.clear();
}

module.exports = { diffShape, reportDrift, _resetDriftCache };
