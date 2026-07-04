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
 * On success we keep `result.data` — the *parsed* value, with Zod coercions
 * and defaults applied — so the adapter can write it back onto the request
 * (v1.15 write-back). Previously this value was discarded, which is why
 * `.coerce`/`.default()` never reached the handler.
 *
 * @param {any} schema    - Zod schema (already verified via isZodSchema)
 * @param {any} payload   - req.body, req.query, or req.params
 * @param {string} where  - 'body', 'query', or 'params' (used to prefix issue paths)
 * @returns {Promise<{ issues: Array<{path:string,message:string,code:string}>, data?: any }>}
 */
async function runOne(schema, payload, where) {
  let result;
  try {
    result = await schema.safeParseAsync(payload);
  } catch (e) {
    // safeParseAsync should not throw, but if a custom refinement does we
    // surface it rather than crashing the request.
    return { issues: [{ path: where, message: (e && e.message) || 'validation error', code: 'internal' }] };
  }
  if (result.success) return { issues: [], data: result.data };
  const issues = (result.error && result.error.issues) || [];
  return { issues: issues.map(function (i) { return flattenIssue(where, i); }) };
}

/**
 * Validate a request against the validators stored on a RouteEntry.
 *
 * On success, returns the parsed payload for each part that had a validator
 * (`data.body` / `data.query` / `data.params`) so adapters can optionally
 * write coerced/defaulted values back onto the request.
 *
 * @param {{ body?: any, query?: any, params?: any }} validators
 *    Original Zod schemas from `normalizeRouteSchemas`.
 * @param {{ body?: any, query?: any, params?: any }} payload
 *    The actual request payload — e.g. `{ body: req.body, query: req.query, params: req.params }`.
 * @returns {Promise<{ ok: true, data: { body?: any, query?: any, params?: any } } | { ok: false, issues: Array<{path:string,message:string,code:string}> }>}
 */
async function validateRequest(validators, payload) {
  if (!validators) return { ok: true, data: {} };

  const issues = [];
  const data = {};

  if (validators.body && validators.body._def) {
    const r = await runOne(validators.body, payload && payload.body, 'body');
    for (let i = 0; i < r.issues.length; i++) issues.push(r.issues[i]);
    if (r.issues.length === 0) data.body = r.data;
  }
  if (validators.query && validators.query._def) {
    const r = await runOne(validators.query, payload && payload.query, 'query');
    for (let i = 0; i < r.issues.length; i++) issues.push(r.issues[i]);
    if (r.issues.length === 0) data.query = r.data;
  }
  if (validators.params && validators.params._def) {
    const r = await runOne(validators.params, payload && payload.params, 'params');
    for (let i = 0; i < r.issues.length; i++) issues.push(r.issues[i]);
    if (r.issues.length === 0) data.params = r.data;
  }

  if (issues.length === 0) return { ok: true, data: data };
  return { ok: false, issues: issues };
}

/**
 * Write parsed (coerced/defaulted) values back onto a request-like target.
 *
 * `req.body` and `req.params` are plain writable properties on every adapter,
 * but `req.query` is a lazy getter with no setter in Express 5 — a direct
 * assignment throws in strict mode. `Object.defineProperty` sidesteps that and
 * works uniformly on Express 4/5, Fastify, and plain objects.
 *
 * Only parts present in `data` (i.e. that actually had a validator) are
 * written; untouched parts keep their original request value.
 *
 * @param {any} target  - the request object (Express req, Fastify request, …)
 * @param {{ body?: any, query?: any, params?: any }} data  - from validateRequest
 */
function applyWriteback(target, data) {
  if (!target || !data) return;
  ['body', 'query', 'params'].forEach(function (key) {
    if (!(key in data)) return;
    try {
      Object.defineProperty(target, key, {
        value: data[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } catch (e) {
      // Last resort: some frameworks freeze the request. Swallow — validation
      // still succeeded; the handler just won't see coerced values.
    }
  });
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
 * Validate a response body against the declared Zod response schema (v1.15
 * dev-mode assertion). Unlike request validation this never coerces or mutates
 * the payload — it only reports mismatches.
 *
 * Runs *synchronously* (`safeParse`) so adapters can assert inside the sync
 * response path (e.g. Express `res.json`) and reject before the body is sent.
 * A schema with async refinements can't be checked synchronously — that case
 * is skipped (treated as ok) rather than crashing the response.
 *
 * @param {any} schema  - original Zod response schema (or null)
 * @param {any} body    - the response payload the handler produced
 * @returns {{ ok: true } | { ok: false, issues: Array<{path:string,message:string,code:string}> }}
 */
function validateResponse(schema, body) {
  if (!schema || typeof schema.safeParse !== 'function') return { ok: true };
  let result;
  try {
    result = schema.safeParse(body);
  } catch (e) {
    // Zod throws synchronously when a schema needs async parsing. Response
    // assertion is a best-effort dev aid — skip rather than break the response.
    return { ok: true };
  }
  if (result.success) return { ok: true };
  const issues = ((result.error && result.error.issues) || []).map(function (i) {
    return flattenIssue('response', i);
  });
  return { ok: false, issues: issues };
}

/**
 * The response-assertion mode from the normalised `validate` config:
 * `'off'` (default), `'warn'`, or `'throw'`.
 *
 * @param {boolean|{response?:string}} adapterDefault
 * @returns {'off'|'warn'|'throw'}
 */
function responseMode(adapterDefault) {
  if (adapterDefault && typeof adapterDefault === 'object' && adapterDefault.response) {
    return adapterDefault.response;
  }
  return 'off';
}

/**
 * Report a response-schema mismatch according to `mode`. In `'throw'` mode a
 * tagged Error is thrown (adapters surface it as a 500 in development); in
 * `'warn'` mode the mismatch is logged and the original response passes
 * through unchanged.
 *
 * @param {'warn'|'throw'} mode
 * @param {string} label   - e.g. 'GET /users/:id'
 * @param {Array<{path:string,message:string,code:string}>} issues
 */
function reportResponseIssues(mode, label, issues) {
  const detail = issues.map(function (i) { return '  - ' + i.path + ': ' + i.message; }).join('\n');
  const msg = '[doctreen] response for ' + label + ' does not match the declared schema:\n' + detail;
  if (mode === 'throw') {
    const err = new Error(msg);
    /** @type {any} */ (err).doctreenResponseInvalid = true;
    throw err;
  }
  // eslint-disable-next-line no-console
  console.warn(msg);
}

/**
 * Decide whether validation should run for a given route, combining the
 * adapter-level config with the per-route override stored on the entry.
 *
 * Precedence:
 *   - If per-route override is `true` or `false`, that wins.
 *   - Otherwise fall back to the adapter-level default.
 *
 * The adapter default may be a boolean (legacy) or the normalised object
 * `{ enabled, writeback }` (v1.15) — both are accepted.
 *
 * @param {boolean|{enabled?:boolean}} adapterDefault
 * @param {boolean|undefined|null} perRoute
 * @returns {boolean}
 */
function shouldValidate(adapterDefault, perRoute) {
  if (perRoute === true)  return true;
  if (perRoute === false) return false;
  const on = adapterDefault && typeof adapterDefault === 'object'
    ? !!adapterDefault.enabled
    : !!adapterDefault;
  return on;
}

/**
 * Whether coerced/defaulted values should be written back onto the request,
 * given the normalised adapter-level `validate` config. Only the object form
 * `{ writeback: true }` opts in; a bare `validate: true` keeps the legacy
 * behaviour (validate but don't mutate the request).
 *
 * @param {boolean|{writeback?:boolean}} adapterDefault
 * @returns {boolean}
 */
function shouldWriteback(adapterDefault) {
  return !!(adapterDefault && typeof adapterDefault === 'object' && adapterDefault.writeback);
}

module.exports = {
  validateRequest,
  validateResponse,
  buildErrorBody,
  shouldValidate,
  shouldWriteback,
  applyWriteback,
  responseMode,
  reportResponseIssues,
};
