'use strict';

/**
 * Runtime validation (v1.6+).
 *
 * Validates an incoming request payload against the original Zod schemas
 * stashed in `entry.requestValidators` by `normalizeRouteSchemas`.
 * Returns an `ok` boolean and, on failure, a structured `issues` array
 * derived from Zod's `ZodError`.
 *
 * Validation is intentionally Zod-only in v1.6: SchemaNode (built via the
 * `s` helper) is a descriptive shape, not a parser — it has no refinements,
 * regex, min/max, or custom error messages, and silently coercing values
 * against it would either reject too aggressively or pass invalid data.
 * If a route declared its schema with `s.*` builders only, validation is
 * skipped for that field; the docs UI still works the same.
 */

/**
 * Coerce one Zod issue to our flat shape.
 *
 * @param {string} where  - 'body' or 'query'
 * @param {any}    issue  - one entry from zodError.issues
 * @returns {{ path: string, message: string, code: string }}
 */
function flattenIssue(where, issue) {
  const tail = Array.isArray(issue.path) && issue.path.length > 0
    ? '.' + issue.path.join('.')
    : '';
  return {
    path:    where + tail,
    message: issue.message || 'Invalid',
    code:    issue.code    || 'invalid',
  };
}

/**
 * Run one Zod validator against a payload.
 * Uses `safeParseAsync` so async refinements (`.refine(async ...)`) work.
 *
 * @param {any} schema    - Zod schema (already verified via isZodSchema)
 * @param {any} payload   - req.body or req.query
 * @param {string} where  - 'body' or 'query'  (used to prefix issue paths)
 * @returns {Promise<Array<{path:string,message:string,code:string}>>}
 */
async function runOne(schema, payload, where) {
  let result;
  try {
    result = await schema.safeParseAsync(payload);
  } catch (e) {
    // safeParseAsync should not throw, but if a custom refinement does we
    // surface it rather than crashing the request.
    return [{ path: where, message: (e && e.message) || 'validation error', code: 'internal' }];
  }
  if (result.success) return [];
  const issues = (result.error && result.error.issues) || [];
  return issues.map(function (i) { return flattenIssue(where, i); });
}

/**
 * Validate a request against the validators stored on a RouteEntry.
 *
 * @param {{ body?: any, query?: any }} validators
 *    Original Zod schemas from `normalizeRouteSchemas`.
 * @param {{ body?: any, query?: any }} payload
 *    The actual request payload — typically `{ body: req.body, query: req.query }`.
 * @returns {Promise<{ ok: true } | { ok: false, issues: Array<{path:string,message:string,code:string}> }>}
 */
async function validateRequest(validators, payload) {
  if (!validators) return { ok: true };

  const issues = [];

  if (validators.body && validators.body._def) {
    const bodyIssues = await runOne(validators.body, payload && payload.body, 'body');
    for (let i = 0; i < bodyIssues.length; i++) issues.push(bodyIssues[i]);
  }
  if (validators.query && validators.query._def) {
    const queryIssues = await runOne(validators.query, payload && payload.query, 'query');
    for (let i = 0; i < queryIssues.length; i++) issues.push(queryIssues[i]);
  }

  if (issues.length === 0) return { ok: true };
  return { ok: false, issues: issues };
}

/**
 * Build the JSON body for a 422 response.
 *
 * @param {Array<{path:string,message:string,code:string}>} issues
 */
function buildErrorBody(issues) {
  return { error: 'validation_failed', issues: issues };
}

/**
 * Decide whether validation should run for a given route, combining the
 * adapter-level config with the per-route override stored on the entry.
 *
 * Precedence:
 *   - If per-route override is `true` or `false`, that wins.
 *   - Otherwise fall back to the adapter-level default.
 *
 * @param {boolean} adapterDefault
 * @param {boolean|undefined|null} perRoute
 * @returns {boolean}
 */
function shouldValidate(adapterDefault, perRoute) {
  if (perRoute === true)  return true;
  if (perRoute === false) return false;
  return !!adapterDefault;
}

module.exports = { validateRequest, buildErrorBody, shouldValidate };
