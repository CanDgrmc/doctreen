'use strict';

/**
 * Schema Drift Detection — comparator + pipeline.
 *
 * Promoted from experimental (v1.5) to production-grade (v1.10). This module
 * is now the *comparator*: it diffs an actual payload against a declared
 * SchemaNode and returns structured issues. Aggregation, sampling, webhook
 * dispatch, and reporting live in `./drift-store.js`.
 *
 * Drift kinds:
 *   - missing-required   declared property missing in payload
 *   - unexpected-field   payload property not declared in schema
 *   - type-mismatch      declared type differs from actual JS typeof
 *
 * Top-level shape comparison only — does not recurse into nested objects.
 * Recursive comparison was considered but trades simplicity for false-positive
 * noise on partially-typed responses; revisit when usage warrants.
 */

const { createMemoryStore, makeEvent, shouldSample, _resetWarnDedup } = require('./drift-store');
const { createHeartbeat } = require('./heartbeat');
const { computeSpecHashes } = require('./spec-hash');
const { toOpenApiPath } = require('../exporters/openapi');

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

  // Only compare object-typed declared schemas — primitive declared bodies
  // aren't useful for top-level drift.
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
    // Tolerate numeric strings in query parameters since most frameworks
    // surface query values as strings until parsed.
    if (expected && expected !== 'unknown' && got !== expected &&
        !(expected === 'number' && got === 'string' && !isNaN(Number(actual[key])))) {
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

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Build a drift pipeline from a normalised config block. Returns an object
 * with `recordIfDrift(route, part, declared, actual)` that adapters call, and
 * `recordIssues(route, part, issues)` for callers that have already diffed. The
 * pipeline owns sampling, store dispatch, and exposes the store for the
 * `/docs/drift.json` endpoint.
 *
 * @param {import('../index').NormalizedConfig} config
 * @returns {{ enabled: boolean, recordIfDrift: Function, recordIssues: Function, report: Function, reset: Function, store: any }}
 */
function createDriftPipeline(config) {
  const driftCfg = (config && config.drift) || {};
  const enabled = driftCfg.enabled !== false; // default on when block exists

  if (!enabled) {
    return {
      enabled: false,
      recordIfDrift: function () {},
      recordIssues: function () {},
      report: function () { return { generatedAt: Date.now(), totalIssues: 0, routes: [] }; },
      reset: function () {},
      store: null,
    };
  }

  const store = (driftCfg.store && typeof driftCfg.store.record === 'function')
    ? driftCfg.store
    : createMemoryStore({
        maxSamples: driftCfg.maxSamples,
        webhook: driftCfg.webhook,
        onDrift: driftCfg.onDrift,
        logLevel: driftCfg.logLevel,
      });

  const sampleRate = typeof driftCfg.sampleRate === 'number' ? driftCfg.sampleRate : 0.01;

  function recordIfDrift(route, part, declared, actual) {
    if (!declared || !actual) return;
    if (!shouldSample(sampleRate)) return;
    const issues = diffShape(declared, actual);
    if (issues.length === 0) return;
    store.record(makeEvent(route.method, route.path, part, issues));
  }

  /**
   * Record drift a caller has *already* diffed (v1.17, T007).
   *
   * The issues-ready half of `recordIfDrift`: same sampling, same `makeEvent`,
   * same store — only the comparison is somebody else's. Response drift enters
   * here because the mismatch was computed by the Zod assertion in
   * `validate.js`; handing the payload back to `diffShape` would diff it a
   * second time and answer worse (no refinements, no unions, no `.strict()`).
   *
   * `recordIfDrift` is left exactly as it was rather than reimplemented on top
   * of this: it samples *before* diffing, and inverting that order would change
   * how much work a non-sampled request pays for.
   *
   * @param {{ method?: string, path?: string }} route
   * @param {string} part    - 'body' | 'query' | 'response'
   * @param {Array<{ kind: string, field: string, expected?: string, got?: string }>} issues
   */
  function recordIssues(route, part, issues) {
    if (!route || !Array.isArray(issues) || issues.length === 0) return;
    if (!shouldSample(sampleRate)) return;
    store.record(makeEvent(route.method, route.path, part, issues));
  }

  return {
    enabled: true,
    recordIfDrift: recordIfDrift,
    recordIssues: recordIssues,
    report: function () { return store.report(); },
    reset: function () { return store.reset(); },
    store: store,
    config: driftCfg,
    // Flipped by `announceToStore` the first time an inventory is delivered.
    // Lives on the pipeline (one per adapter mount) rather than in the adapter,
    // so the announce-once guarantee holds no matter how often, or from how
    // many places, an adapter calls in.
    _announced: false,
  };
}

/**
 * Build every per-mount runtime object the `drift` config block implies and
 * attach them to the config, where the adapters' request paths already look
 * for them (`config._drift` is a v1.10 convention; `config._heartbeat` follows
 * it rather than inventing a second one).
 *
 * All five adapters call exactly this, at the one point where their config is
 * normalised — the same reason `announceToStore` exists. When the next thing
 * the drift block implies arrives, it is added here and every adapter has it,
 * instead of five near-identical constructor lines drifting apart.
 *
 * @param {import('../index').NormalizedConfig|any} config - mutated in place
 * @returns {{ enabled: boolean, recordIfDrift: Function, recordIssues: Function, report: Function, reset: Function, store: any }}
 *   the drift pipeline, for callers that want it without re-reading the config
 */
function attachDriftRuntime(config) {
  config._drift = createDriftPipeline(config);
  // Fed from the same `drift.store`, so it can only ever be as enabled as the
  // pipeline is. A store without `recordHeartbeats` makes this a no-op object.
  config._heartbeat = createHeartbeat(config);
  return config._drift;
}

// ─── Route inventory announcement (v1.17) ───────────────────────────────────

/**
 * Which routes an announcement covers — the *selection*, kept apart from the
 * two projections taken over it (the `{ method, path }` inventory and the spec
 * hashes). Both must describe the same route set: a hash computed over a
 * different selection than the inventory it travels with would move when the
 * inventory did not, and a consumer would read that as drift that never
 * happened.
 *
 * Returns the registry entries untouched, by reference — the callers only read
 * them, and `computeSpecHashes` needs the schemas the inventory throws away.
 *
 * @param {Array<import('../index').RouteEntry>} routes
 * @param {string} [docsPath]  - adapter `docsPath`; its subtree is skipped
 * @returns {Array<import('../index').RouteEntry>}
 */
function selectAnnouncedRoutes(routes, docsPath) {
  /** @type {Array<import('../index').RouteEntry>} */
  const selected = [];
  if (!Array.isArray(routes)) return selected;

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (!route || !route.path) continue;

    // Adapters pass `registry.getVisible()`, which already drops these. The
    // filter is repeated here so the guarantee "a hidden route never leaves
    // the process" is enforced at the one place that does the leaving.
    if (route.hidden === true) continue;

    // Skip DocTreen's own endpoints (`/docs`, `/docs/openapi.json`,
    // `/docs/drift.json`, …). Most adapters register them on the same router
    // they introspect, so they reach the registry. They are the tool's
    // plumbing, not the application's API. The OpenAPI export drops the same
    // subtree — see the matching guard in `exporters/openapi.js`; if a third
    // consumer needs this rule, lift it into a shared predicate.
    if (docsPath && (route.path === docsPath || route.path.indexOf(docsPath + '/') === 0)) continue;

    selected.push(route);
  }

  return selected;
}

/**
 * Reduce selected routes to the wire shape of a route inventory.
 *
 * Only `{ method, path }` survives: the inventory tells a consumer which
 * routes *exist*, it is not a spec. Schemas, params, descriptions, errors and
 * examples are deliberately dropped here — a route inventory that carried
 * schema bodies would be a second, weaker OpenAPI export.
 *
 * Paths go through `toOpenApiPath` so `/users/:id` is announced as
 * `/users/{id}` — the same string the OpenAPI export publishes for the same
 * route, which is what lets a consumer join the two by path.
 *
 * @param {Array<import('../index').RouteEntry>} routes - already selected
 * @returns {Array<{ method: string, path: string }>}
 */
function buildRouteInventory(routes) {
  /** @type {Array<{ method: string, path: string }>} */
  const inventory = [];

  for (let i = 0; i < routes.length; i++) {
    inventory.push({
      method: String(routes[i].method || '').toUpperCase(),
      path: toOpenApiPath(routes[i].path),
    });
  }

  return inventory;
}

/**
 * Spec hashes for the selected routes, or `null` if they could not be taken.
 *
 * `computeSpecHashes` is a pure function, but it walks the *whole* registry
 * entry — including `toJSON` methods on schema objects the user handed us. That
 * is foreign code on an application's startup path, so the net stays: losing
 * two hash fields costs a dashboard feature, throwing here would cost the boot.
 *
 * @param {Array<import('../index').RouteEntry>} routes
 * @returns {{ contractHash: string, docHash: string }|null}
 */
function safeSpecHashes(routes) {
  try {
    return computeSpecHashes(routes);
  } catch (_) {
    return null;
  }
}

/**
 * Narrow the adapter's `meta` block down to the two fields the inventory
 * carries. `description` and any future meta field stay local to the docs UI.
 *
 * @param {{ title?: string, version?: string }} [meta]
 * @returns {{ title?: string, version?: string }}
 */
function pickInventoryMeta(meta) {
  /** @type {{ title?: string, version?: string }} */
  const out = {};
  if (!meta || typeof meta !== 'object') return out;
  if (typeof meta.title === 'string' && meta.title) out.title = meta.title;
  if (typeof meta.version === 'string' && meta.version) out.version = meta.version;
  return out;
}

/**
 * The meta block that travels with an inventory: adapter identity plus the two
 * spec hashes (v1.17).
 *
 * The hashes go on `meta` and not into the route entries because they describe
 * the announcement as a whole — one fingerprint of the surface, not a field per
 * route — and because that keeps the inventory itself exactly what it was.
 *
 * @param {{ title?: string, version?: string }} [meta]  - adapter config `meta`
 * @param {Array<import('../index').RouteEntry>} routes  - the selected routes
 * @returns {{ title?: string, version?: string, contractHash?: string, docHash?: string }}
 */
function buildInventoryMeta(meta, routes) {
  return Object.assign(pickInventoryMeta(meta), safeSpecHashes(routes));
}

/**
 * Announce the app's route inventory to the drift store, once.
 *
 * Called by every adapter at the moment its registry has settled. All five
 * share this function rather than each formatting its own payload, so the
 * inventory contract (hidden routes excluded, OpenAPI path form, no schemas)
 * has exactly one implementation.
 *
 * `meta` carries `contractHash` + `docHash` over the announced routes (v1.17),
 * so a store reports the real contract fingerprint instead of hashing the
 * `{ method, path }` list it was handed — which would move when a route is
 * added or removed and stay still when a field changes type. Both hashes are
 * taken over the SAME selection as the inventory, once per adapter mount and
 * never on a request path.
 *
 * Fail-open, by the same policy as `onDrift`:
 *   - drift pipeline disabled          → no call
 *   - store has no `announceRoutes`     → no call (the hook is optional, so
 *     stores written before v1.17 keep working untouched)
 *   - hook throws, or returns a rejected promise → swallowed
 *
 * An empty inventory is not announced. The only ways to reach zero routes are
 * "introspection ran before any route was registered" and "every route is
 * hidden"; announcing the first as fact would publish a wrong picture, and
 * skipping leaves `_announced` unset so a later, populated call still lands.
 *
 * Takes `meta` and `docsPath` rather than the whole config: those two fields
 * are everything an inventory needs, and naming them keeps the helper usable
 * from any adapter without knowing the config shape.
 *
 * @param {{ enabled: boolean, store?: any, _announced?: boolean }} pipeline
 * @param {Array<import('../index').RouteEntry>} routes  - typically `registry.getVisible()`
 * @param {{ title?: string, version?: string }} [meta]  - adapter config `meta`
 * @param {string} [docsPath]                            - adapter config `docsPath`
 * @returns {void}
 */
function announceToStore(pipeline, routes, meta, docsPath) {
  if (!pipeline || !pipeline.enabled) return;
  if (pipeline._announced) return;

  const store = pipeline.store;
  if (!store || typeof store.announceRoutes !== 'function') return;

  const selected = selectAnnouncedRoutes(routes, docsPath);
  const inventory = buildRouteInventory(selected);
  if (inventory.length === 0) return;

  pipeline._announced = true;

  try {
    const result = store.announceRoutes(inventory, buildInventoryMeta(meta, selected));
    // An async store must not surface an unhandled rejection into the host app.
    if (result && typeof result.catch === 'function') result.catch(function () { /* swallow */ });
  } catch (_) { /* user code throws — swallow */ }
}

/**
 * Authorise an incoming `POST /drift/reset` request. Returns `{ ok: true }`
 * when the reset should proceed, or `{ ok: false, status, error }` describing
 * the rejection. Centralised so every adapter applies the same policy:
 *
 *   - drift disabled       → 404 (endpoint never registered, but defensive)
 *   - allowReset !== true  → 405
 *   - resetToken set but   → 401
 *     header/query missing
 *     or mismatched
 *
 * @param {object} pipeline      - The pipeline returned by createDriftPipeline.
 * @param {object} headers       - Incoming request headers (lowercase keys).
 * @param {object} [query]       - Parsed query string.
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function authorizeReset(pipeline, headers, query) {
  if (!pipeline || !pipeline.enabled) {
    return { ok: false, status: 404, error: 'drift detection disabled' };
  }
  const cfg = pipeline.config || {};
  if (cfg.allowReset !== true) {
    return { ok: false, status: 405, error: 'drift.allowReset is not enabled' };
  }
  if (cfg.resetToken) {
    const headerToken = headers && (headers['x-doctreen-drift-token'] || headers['X-Doctreen-Drift-Token']);
    const queryToken = query && query.token;
    const provided = headerToken || queryToken;
    if (!provided || String(provided) !== String(cfg.resetToken)) {
      return { ok: false, status: 401, error: 'invalid reset token' };
    }
  }
  return { ok: true };
}

module.exports = {
  diffShape: diffShape,
  createDriftPipeline: createDriftPipeline,
  attachDriftRuntime: attachDriftRuntime,
  announceToStore: announceToStore,
  authorizeReset: authorizeReset,
  _resetDriftCache: _resetWarnDedup,
};
