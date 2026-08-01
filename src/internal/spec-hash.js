'use strict';

/**
 * Spec hashes — `contractHash` + `docHash` over a route registry (v1.17).
 *
 * Two deterministic fingerprints of the same route list:
 *
 *   - `contractHash` — the *behavioural* contract. Methods, paths, request and
 *     response schemas, error schemas, required/optional flags, types, enum /
 *     nullable / default values, security requirements, the `hidden` flag.
 *     Free text (descriptions, summaries, examples) is excluded, so editing a
 *     doc string never moves it. Two builds with the same contract hash are
 *     interchangeable for a client.
 *   - `docHash` — everything the registry holds, free text included. Moves on
 *     any documented change at all.
 *
 * The input is the adapter route entry list — exactly what
 * `exporters/openapi.js` consumes (`RouteRegistry#getAll()` /
 * `#getVisible()`), not a separate intermediate format. Which routes take part
 * is the caller's decision: pass `getVisible()` to hash the published surface,
 * `getAll()` to include hidden ones.
 *
 * The module is a pure function of its input: no I/O, no clock, no randomness,
 * no adapter import, and the argument is never mutated. That is what lets CI
 * (the `emit-openapi` path) and a live process compute the same hash for the
 * same code.
 *
 * Canonicalisation rules (both modes):
 *   - routes sorted by `METHOD + ' ' + path`, lexicographic;
 *   - every object key sorted, recursively, by UTF-16 code unit (never
 *     `localeCompare` — that is locale-dependent, and a hash may not depend on
 *     the machine's locale);
 *   - `undefined` (and function / symbol) values dropped, `null` preserved —
 *     the same rule `JSON.stringify` applies;
 *   - the result is hashed as UTF-8 with SHA-256 and returned as
 *     `'sha256:' + hex`.
 */

const crypto = require('node:crypto');

/**
 * Free-text keys removed in `contract` mode. Stripping stops at SchemaNode
 * boundaries (see `isSchemaNode`), so a request field genuinely *named*
 * `description` still counts towards the contract.
 */
const CONTRACT_META_KEYS = ['description', 'summary', 'example', 'examples'];

/**
 * Dropped in BOTH modes. These hold the original Zod schemas kept for runtime
 * parsing — live objects with methods and self-references, not spec data.
 * Their descriptive projection is already present as SchemaNodes under
 * `requestSchema` / `responses` / `errors[].schema`, so nothing observable is
 * lost, and the canonical form stays serialisable.
 */
const RUNTIME_HANDLE_KEYS = [
  'validator',
  'validators',
  'requestValidators',
  'responseValidator',
  'responseValidators',
];

function has(list, key) {
  return list.indexOf(key) !== -1;
}

function isPlainish(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A SchemaNode is any object carrying a string `type` — `{ type: 'object',
 * properties: {…} }`, `{ type: 'string', enum: […] }`, and so on. Everything
 * below such a node is user data (property names, enum values) and is copied
 * verbatim: the contract projection must not treat a *field* called
 * `description` as documentation prose.
 *
 * @param {any} value
 * @returns {boolean}
 */
function isSchemaNode(value) {
  return isPlainish(value) && typeof value.type === 'string';
}

// ─── Mode projections ───────────────────────────────────────────────────────

/**
 * `doc` mode: keep everything the registry carries, minus the runtime parser
 * handles that cannot be serialised.
 *
 * @param {any} value
 * @returns {any}
 */
function docProjection(value) {
  return project(value, false);
}

/**
 * `contract` mode: `doc` minus free text.
 *
 * @param {any} value
 * @returns {any}
 */
function contractProjection(value) {
  return project(value, true);
}

/**
 * Shared walk for both modes. `contract` additionally drops the free-text keys
 * and reduces the two places where prose hides inside a structured value:
 * `errors` (description-only entries carry no contract at all) and
 * `requestHeaders` (a `name → description` map whose *names* are the contract).
 *
 * Recursion stops at SchemaNodes — they hold no prose, only shape.
 *
 * @param {any} value
 * @param {boolean} contract
 * @returns {any}
 */
function project(value, contract) {
  if (isSchemaNode(value)) return value;
  if (Array.isArray(value)) {
    return value.map(function (item) { return project(item, contract); });
  }
  if (!isPlainish(value)) return value;

  const out = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (has(RUNTIME_HANDLE_KEYS, key)) continue;
    if (contract && has(CONTRACT_META_KEYS, key)) continue;

    if (contract && key === 'errors') {
      out.errors = contractErrors(value.errors);
    } else if (contract && (key === 'requestHeaders' || key === 'headers')) {
      out[key] = headerNames(value[key]);
    } else {
      out[key] = project(value[key], contract);
    }
  }
  return out;
}

/**
 * Contract view of a route's declared errors. Accepts both shapes in the
 * codebase: the normalised `ErrorEntry[]` (`internal/errors.js`) and the raw
 * `{ 404: 'Not found' | { description, schema } }` map that callback
 * definitions still carry.
 *
 * A description-only entry (`errors: { 422: 'Validation' }`) documents *that*
 * a status can occur but declares no body — no schema, no contract. It is
 * dropped. An entry with a schema keeps its status and its schema.
 *
 * @param {any} errors
 * @returns {any}
 */
function contractErrors(errors) {
  if (Array.isArray(errors)) {
    const out = [];
    for (let i = 0; i < errors.length; i++) {
      const entry = errors[i];
      if (!isPlainish(entry)) continue;
      if (entry.schema == null) continue;
      out.push({ status: entry.status, schema: entry.schema });
    }
    return out;
  }

  if (!isPlainish(errors)) return errors;

  const out = {};
  const codes = Object.keys(errors);
  for (let i = 0; i < codes.length; i++) {
    const value = errors[codes[i]];
    if (typeof value === 'string') continue;      // description only
    if (isSchemaNode(value)) { out[codes[i]] = value; continue; }
    if (!isPlainish(value)) continue;
    if (value.schema == null) continue;           // `{ description }` only
    out[codes[i]] = { schema: project(value.schema, true) };
  }
  return out;
}

/**
 * Which headers the route expects — the contract part of `requestHeaders`.
 * The map's values are a description or an example string; changing one is a
 * documentation edit, adding or renaming a header is not.
 *
 * @param {any} headers
 * @returns {string[]|any}
 */
function headerNames(headers) {
  if (!isPlainish(headers)) return headers;
  return Object.keys(headers).sort();
}

// ─── Canonical serialisation ────────────────────────────────────────────────

/**
 * Serialise a value to canonical JSON: object keys sorted, `undefined` /
 * function / symbol members omitted, `null` kept.
 *
 * Written out rather than delegating to `JSON.stringify` with a replacer,
 * because JavaScript reorders integer-like own keys (`'200'`, `'422'`) ahead
 * of string keys no matter the insertion order — sorting them into an object
 * and stringifying it would silently produce a different order than the one
 * documented here.
 *
 * @param {any} value
 * @param {any[]} ancestors - the current path, for cycle detection
 * @returns {string|undefined} JSON text, or undefined when the value is to be omitted
 */
function canonicalJson(value, ancestors) {
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'string') return JSON.stringify(value);
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (type === 'bigint') return JSON.stringify(String(value));
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined;
  if (type !== 'object') return undefined;

  if (typeof value.toJSON === 'function') {
    return canonicalJson(value.toJSON(), ancestors);
  }

  // A named schema may refer to itself (`defineSchema('Node', …)` with a child
  // of the same node). Cut the cycle instead of recursing forever; only true
  // ancestors are cut, so a schema shared by two routes still serialises in
  // full at each site.
  if (ancestors.indexOf(value) !== -1) return '"[circular]"';
  ancestors.push(value);

  let out;
  if (Array.isArray(value)) {
    const items = [];
    for (let i = 0; i < value.length; i++) {
      const item = canonicalJson(value[i], ancestors);
      items.push(item === undefined ? 'null' : item);
    }
    out = '[' + items.join(',') + ']';
  } else {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (let i = 0; i < keys.length; i++) {
      const member = canonicalJson(value[keys[i]], ancestors);
      if (member === undefined) continue;
      parts.push(JSON.stringify(keys[i]) + ':' + member);
    }
    out = '{' + parts.join(',') + '}';
  }

  ancestors.pop();
  return out;
}

/**
 * Sort key for a route entry: `'GET /users/:id'`. Method is upper-cased first
 * so a registry that stored `get` and one that stored `GET` sort — and hash —
 * alike.
 *
 * @param {any} entry
 * @returns {string}
 */
function routeSortKey(entry) {
  return String(entry.method) + ' ' + String(entry.path);
}

// ─── Public surface ─────────────────────────────────────────────────────────

/**
 * Canonical, deterministic JSON string for a route list. Exported next to
 * `computeSpecHashes` so a test — or a human debugging a hash that moved —
 * can diff the text the hash was taken over.
 *
 * Entries without a `method` or a `path` are skipped, matching the OpenAPI
 * exporter's guard: they cannot be addressed, so they carry no contract.
 *
 * @param {Array<any>} routes - adapter route entries (`RouteRegistry#getAll()`)
 * @param {{ mode?: 'contract'|'doc' }} [options] - defaults to `contract`
 * @returns {string} canonical JSON — `'[]'` for an empty or absent list
 */
function canonicalizeRoutes(routes, options) {
  const contract = !(options && options.mode === 'doc');
  const input = Array.isArray(routes) ? routes : [];

  const projected = [];
  for (let i = 0; i < input.length; i++) {
    const entry = input[i];
    if (!isPlainish(entry) || !entry.method || !entry.path) continue;
    // Copied into a fresh object: the projection may hand back a subtree of
    // the caller's entry by reference, and this function does not mutate its
    // input.
    projected.push(Object.assign({}, contract ? contractProjection(entry) : docProjection(entry), {
      method: String(entry.method).toUpperCase(),
      path: String(entry.path),
    }));
  }

  projected.sort(function (a, b) {
    const ka = routeSortKey(a);
    const kb = routeSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return canonicalJson(projected, []);
}

/**
 * `'sha256:' + hex` over the UTF-8 bytes of `text`.
 *
 * @param {string} text
 * @returns {string}
 */
function sha256(text) {
  return 'sha256:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Both spec hashes for a route list.
 *
 * @param {Array<any>} routes - adapter route entries (`RouteRegistry#getAll()`)
 * @returns {{ contractHash: string, docHash: string }}
 */
function computeSpecHashes(routes) {
  return {
    contractHash: sha256(canonicalizeRoutes(routes, { mode: 'contract' })),
    docHash: sha256(canonicalizeRoutes(routes, { mode: 'doc' })),
  };
}

module.exports = {
  computeSpecHashes: computeSpecHashes,
  canonicalizeRoutes: canonicalizeRoutes,
};
