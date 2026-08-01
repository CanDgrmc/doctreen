'use strict';

/**
 * Heartbeat counters (v1.17).
 *
 * Drift events answer "what broke". They cannot answer "did anything happen
 * at all": a route with zero drift events is indistinguishable from a route
 * with zero traffic. Heartbeats close that gap — one counter per route, per
 * window, incremented every time a request passes validation, handed to the
 * store when the window closes.
 *
 * Design constraints, in the order they mattered:
 *
 *   1. The hot path must be free when nobody is listening. `recordHeartbeats`
 *      is an OPTIONAL store method (ISP — a store that only reports drift is
 *      still a valid store). When it is absent, `createHeartbeat` returns an
 *      instance whose `hit` is `noop` and which owns no Map and no timer, so a
 *      pre-v1.17 store costs exactly one dead call per validated request, not
 *      a growing Map that is thrown away every 60s.
 *   2. When it IS listening the hot path is one Map lookup and one or two
 *      integer increments. Path normalisation and object construction happen
 *      once per route per window, not once per request.
 *   3. Nothing here may break the host application. A store that throws or
 *      rejects is swallowed; the window is already cleared by then, so the
 *      next window starts clean.
 *
 * Routes are reported in the same form as the startup inventory
 * (`internal/drift.js` → `buildRouteInventory`): upper-case method, OpenAPI
 * path (`/users/{id}`, not `/users/:id`). That is what lets a consumer join
 * heartbeats, drift events and the inventory on one key.
 *
 * `statusCounts` is deliberately shipped before anything consumes it (see
 * doctreen-cloud `wiki/plan/09` #7): counting is a Map increment, but adding
 * the field later would mean a wire-format migration for every deployed agent.
 */

const { toOpenApiPath } = require('../exporters/openapi');

/** Window length when `drift.heartbeatIntervalMs` is not set. */
const DEFAULT_INTERVAL_MS = 60000;

/**
 * Floor for `drift.heartbeatIntervalMs`. Below this the flush itself starts to
 * cost more than the counting does; a store that wants finer granularity wants
 * a different mechanism, not a faster timer.
 */
const MIN_INTERVAL_MS = 5000;

function noop() {}

/**
 * The instance returned whenever counting cannot lead anywhere: heartbeats
 * turned off, drift turned off, or a store without `recordHeartbeats`.
 * Deliberately holds no Map and starts no timer.
 *
 * @returns {{ enabled: false, hit: Function, flush: Function, stop: Function, _pending: Function }}
 */
function createDisabledHeartbeat() {
  return {
    enabled: false,
    hit: noop,
    flush: noop,
    stop: noop,
    _pending: function () { return []; },
  };
}

/**
 * Bucket a status code into one of the three classes the wire format carries.
 * 1xx and 3xx have no bucket — they are counted in `validatedCount` like every
 * other validated request, they just do not move an error/success counter.
 *
 * @param {number|string} statusCode
 * @returns {'2xx'|'4xx'|'5xx'|null}
 */
function statusClass(statusCode) {
  const n = Number(statusCode);
  if (n >= 200 && n < 300) return '2xx';
  if (n >= 400 && n < 500) return '4xx';
  if (n >= 500 && n < 600) return '5xx';
  return null;
}

/**
 * Resolve the window length from config, clamped to `MIN_INTERVAL_MS`.
 * Anything that is not a usable positive number falls back to the default
 * rather than throwing — config mistakes must not take the app down.
 *
 * @param {{ heartbeatIntervalMs?: number }} driftCfg
 * @returns {number}
 */
function resolveIntervalMs(driftCfg) {
  const raw = driftCfg && driftCfg.heartbeatIntervalMs;
  if (typeof raw !== 'number' || !isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, raw);
}

/**
 * Build the heartbeat instance for one adapter mount.
 *
 * Off when any of these holds — all three resolve to the same `noop` instance:
 *   - `drift: false` / `drift: { enabled: false }` — drift off, nothing to feed
 *   - `drift: { heartbeat: false }`                — explicit opt-out
 *   - the store has no `recordHeartbeats`          — nobody to report to
 *
 * @param {import('../index').NormalizedConfig|any} config - adapter config
 * @returns {{ enabled: boolean, hit: Function, flush: Function, stop: Function, _pending: Function }}
 *   `hit(route, statusCode?)` counts one validated request; `flush()` closes
 *   the window; `stop()` clears the timer and flushes what is left;
 *   `_pending()` exposes the open window for tests.
 */
function createHeartbeat(config) {
  const driftCfg = (config && config.drift) || {};

  if (driftCfg.enabled === false) return createDisabledHeartbeat();
  if (driftCfg.heartbeat === false) return createDisabledHeartbeat();

  const store = driftCfg.store;
  if (!store || typeof store.recordHeartbeats !== 'function') return createDisabledHeartbeat();

  /**
   * `'<raw method> <raw path>'` → counter. The key uses the RouteEntry's own
   * strings so building it is a single concat; the normalised, reportable form
   * is computed once, when the counter is created.
   *
   * @type {Map<string, { method: string, path: string, validatedCount: number, statusCounts: ({'2xx':number,'4xx':number,'5xx':number}|null) }>}
   */
  const counters = new Map();

  const intervalMs = resolveIntervalMs(driftCfg);
  let windowStart = Date.now();

  /**
   * Count one validated request. This is the hot path: called once per request
   * that passes validation, on every route, in every adapter.
   *
   * @param {{ method?: string, path?: string }} route - the matched RouteEntry (or any `{method,path}`)
   * @param {number|string} [statusCode] - response status, when it is already known
   */
  function hit(route, statusCode) {
    if (!route || !route.path) return;

    const key = route.method + ' ' + route.path;
    let counter = counters.get(key);
    if (counter === undefined) {
      counter = {
        method: String(route.method || '').toUpperCase(),
        path: toOpenApiPath(String(route.path)),
        validatedCount: 0,
        // Stays null until a status is actually seen, so a deployment without
        // response validation reports `validatedCount` and nothing else.
        statusCounts: null,
      };
      counters.set(key, counter);
    }

    counter.validatedCount++;

    if (statusCode === undefined || statusCode === null) return;
    const cls = statusClass(statusCode);
    if (cls === null) return;
    if (counter.statusCounts === null) counter.statusCounts = { '2xx': 0, '4xx': 0, '5xx': 0 };
    counter.statusCounts[cls]++;
  }

  /**
   * Snapshot the open window in the shape `recordHeartbeats` receives.
   * @returns {Array<{ route: { method: string, path: string }, validatedCount: number, statusCounts?: object }>}
   */
  function snapshot() {
    /** @type {Array<any>} */
    const entries = [];
    counters.forEach(function (counter) {
      /** @type {any} */
      const entry = {
        route: { method: counter.method, path: counter.path },
        validatedCount: counter.validatedCount,
      };
      if (counter.statusCounts !== null) entry.statusCounts = counter.statusCounts;
      entries.push(entry);
    });
    return entries;
  }

  /**
   * Close the current window: hand the counters to the store and start a new
   * one. An empty window is not reported — there is nothing to say, and saying
   * it would cost a request per idle minute per process.
   *
   * The Map is cleared *before* the store is called, so a store that throws
   * loses one window instead of double-counting it into the next one.
   */
  function flush() {
    const reportedWindowStart = windowStart;
    windowStart = Date.now();
    if (counters.size === 0) return;

    const entries = snapshot();
    counters.clear();

    try {
      const result = store.recordHeartbeats(entries, reportedWindowStart);
      // An async store must not surface an unhandled rejection into the host app.
      if (result && typeof result.catch === 'function') result.catch(noop);
    } catch (_) { /* user code throws — swallow; the next window is unaffected */ }
  }

  // `unref` so a process whose only remaining work is this timer still exits —
  // notably `node --test`, which would otherwise hang for a full window.
  /** @type {any} */
  let timer = setInterval(flush, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();

  /**
   * Stop counting and report whatever the open window holds. Idempotent.
   */
  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    flush();
  }

  return {
    enabled: true,
    hit: hit,
    flush: flush,
    stop: stop,
    _pending: snapshot,
  };
}

module.exports = {
  createHeartbeat: createHeartbeat,
  statusClass: statusClass,
  DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS: MIN_INTERVAL_MS,
};
