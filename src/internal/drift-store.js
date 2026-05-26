'use strict';

/**
 * Schema Drift Store (v1.10+).
 *
 * Production-grade aggregation of schema drift events emitted by the
 * per-adapter drift hooks. Stores:
 *   - lifetime totals per (method, path) keyed by issue kind
 *   - rolling 24h hourly buckets (UTC) for time-series rendering
 *   - last N samples per route for inspection
 *
 * All state is in-memory by default — pluggable via `config.drift.store`
 * if a user wants Redis / Postgres / etc. The interface intentionally stays
 * small so externals are easy to implement:
 *
 *   {
 *     record(event): void | Promise<void>
 *     report(): DriftReport | Promise<DriftReport>
 *     reset(): void | Promise<void>
 *   }
 *
 * The default in-memory store also handles:
 *   - sampling (per `config.drift.sampleRate`) — done *outside* this module,
 *     in the per-adapter hook; the store assumes events arriving are already
 *     sampled
 *   - per-process dedup so the same route+signature doesn't burn through
 *     the sample budget instantly (configurable, default 200 ms window)
 *   - synchronous `onDrift(event)` callback
 *   - fire-and-forget webhook POST when `webhook` URL set
 *
 * A drift event payload is:
 *   {
 *     route:      { method, path },
 *     part:       'body' | 'query',
 *     issues:     Array<{ kind, field, expected?, got? }>,
 *     sampledAt:  number   // ms epoch
 *   }
 */

// ─── Public event factory ────────────────────────────────────────────────────

/**
 * Build a normalised drift event from raw inputs.
 *
 * @param {string} method
 * @param {string} path
 * @param {string} part           - 'body' or 'query'
 * @param {Array<object>} issues
 * @returns {{ route: { method: string, path: string }, part: string, issues: Array<object>, sampledAt: number }}
 */
function makeEvent(method, path, part, issues) {
  return {
    route: { method: String(method || '').toUpperCase(), path: String(path || '') },
    part: part,
    issues: issues || [],
    sampledAt: Date.now(),
  };
}

// ─── In-memory store ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} DriftConfig
 * @property {boolean} [enabled]
 * @property {number}  [sampleRate]   - 0–1, fraction of mismatching requests to record. Default 0.01.
 * @property {number}  [maxSamples]   - Per-route sample buffer cap. Default 5.
 * @property {string}  [webhook]      - HTTP(S) URL to POST events to. Fire-and-forget.
 * @property {Function} [onDrift]     - Sync callback: (event) => void
 * @property {Object}  [store]        - External store override
 * @property {string}  [logLevel]     - 'warn' | 'silent'. Default 'warn'.
 */

/**
 * Create an in-memory drift store.
 *
 * @param {DriftConfig} [config]
 * @returns {{ record: Function, report: Function, reset: Function, hasData: Function }}
 */
function createMemoryStore(config) {
  const cfg = Object.assign(
    {
      maxSamples: 5,
      logLevel: 'warn',
      webhook: null,
      onDrift: null,
    },
    config || {}
  );

  /** key = `${METHOD} ${path}` */
  const routes = new Map();

  // Dedup window to avoid burning the sample budget on a single misbehaving
  // client retrying the same broken request 1000x/sec.
  const DEDUP_WINDOW_MS = 200;
  const recentSigs = new Map(); // sig -> timestamp

  function keyFor(route) {
    return route.method + ' ' + route.path;
  }

  function hourBucketKey(sampledAt) {
    // Hour bucket in UTC. e.g. '2026-05-27T14'
    const d = new Date(sampledAt);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours());
  }

  function dayBucketKey(sampledAt) {
    // Day bucket in UTC. e.g. '2026-05-27'
    const d = new Date(sampledAt);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function pruneOldBuckets(entry) {
    // Keep the most recent 24 hourly buckets and 7 daily buckets.
    const hourKeys = Object.keys(entry.buckets);
    if (hourKeys.length > 24) {
      hourKeys.sort();
      while (hourKeys.length > 24) {
        const k = hourKeys.shift();
        delete entry.buckets[k];
      }
    }
    const dayKeys = Object.keys(entry.dailyBuckets);
    if (dayKeys.length > 7) {
      dayKeys.sort();
      while (dayKeys.length > 7) {
        const k = dayKeys.shift();
        delete entry.dailyBuckets[k];
      }
    }
  }

  function shouldDedup(event) {
    const sig = keyFor(event.route) + '|' + event.part + '|' +
      event.issues.map(function (i) { return i.kind + ':' + i.field; }).join(',');
    const now = event.sampledAt;
    const last = recentSigs.get(sig);
    if (last && (now - last) < DEDUP_WINDOW_MS) return true;
    recentSigs.set(sig, now);
    // Best-effort prune: keep recentSigs small.
    if (recentSigs.size > 500) {
      const cutoff = now - DEDUP_WINDOW_MS * 10;
      for (const [k, ts] of recentSigs) {
        if (ts < cutoff) recentSigs.delete(k);
      }
    }
    return false;
  }

  function record(event) {
    if (!event || !event.route || !Array.isArray(event.issues) || event.issues.length === 0) return;

    if (shouldDedup(event)) return;

    const key = keyFor(event.route);
    let entry = routes.get(key);
    if (!entry) {
      entry = {
        method: event.route.method,
        path: event.route.path,
        total: 0,
        kinds: { 'missing-required': 0, 'unexpected-field': 0, 'type-mismatch': 0 },
        parts: { body: 0, query: 0 },
        fields: {}, // field -> count
        firstSeen: event.sampledAt,
        lastSeen: event.sampledAt,
        samples: [],
        buckets: {},      // hour key (UTC) -> count, rolling 24h
        dailyBuckets: {}, // day key (UTC)  -> count, rolling 7d
      };
      routes.set(key, entry);
    }

    entry.total += event.issues.length;
    entry.lastSeen = event.sampledAt;
    entry.parts[event.part] = (entry.parts[event.part] || 0) + event.issues.length;

    for (const issue of event.issues) {
      entry.kinds[issue.kind] = (entry.kinds[issue.kind] || 0) + 1;
      entry.fields[issue.field] = (entry.fields[issue.field] || 0) + 1;
    }

    // Hourly + daily buckets
    const hk = hourBucketKey(event.sampledAt);
    entry.buckets[hk] = (entry.buckets[hk] || 0) + event.issues.length;
    const dk = dayBucketKey(event.sampledAt);
    entry.dailyBuckets[dk] = (entry.dailyBuckets[dk] || 0) + event.issues.length;
    pruneOldBuckets(entry);

    // Sample buffer (ring)
    entry.samples.push({
      sampledAt: event.sampledAt,
      part: event.part,
      issues: event.issues.slice(0, 10),
    });
    if (entry.samples.length > cfg.maxSamples) entry.samples.shift();

    // Side effects: log, onDrift, webhook.
    if (cfg.logLevel === 'warn') logWarn(event);
    if (typeof cfg.onDrift === 'function') {
      try { cfg.onDrift(event); } catch (_) { /* user code throws — swallow */ }
    }
    if (cfg.webhook) postWebhook(cfg.webhook, event);
  }

  function report() {
    /** @type {Array<object>} */
    const list = [];
    for (const entry of routes.values()) {
      list.push({
        method: entry.method,
        path: entry.path,
        total: entry.total,
        kinds: Object.assign({}, entry.kinds),
        parts: Object.assign({}, entry.parts),
        fields: Object.assign({}, entry.fields),
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        samples: entry.samples.slice(),
        buckets: Object.assign({}, entry.buckets),
        dailyBuckets: Object.assign({}, entry.dailyBuckets),
      });
    }
    list.sort(function (a, b) { return b.total - a.total; });
    let grandTotal = 0;
    for (const r of list) grandTotal += r.total;
    return {
      generatedAt: Date.now(),
      totalIssues: grandTotal,
      routes: list,
    };
  }

  function reset() {
    routes.clear();
    recentSigs.clear();
  }

  function hasData() {
    return routes.size > 0;
  }

  return { record: record, report: report, reset: reset, hasData: hasData };
}

// ─── Side-effect helpers ─────────────────────────────────────────────────────

const WARN_DEDUP = new Set();
function logWarn(event) {
  const sig = event.route.method + ' ' + event.route.path + ' ' + event.part + ' ' +
    event.issues.map(function (i) { return i.kind + ':' + i.field; }).join(',');
  if (WARN_DEDUP.has(sig)) return;
  WARN_DEDUP.add(sig);

  const parts = event.issues.map(function (i) {
    if (i.kind === 'missing-required') return 'missing required `' + i.field + '`';
    if (i.kind === 'unexpected-field') return 'unexpected `' + i.field + '` (got ' + i.got + ')';
    if (i.kind === 'type-mismatch') return '`' + i.field + '` expected ' + i.expected + ', got ' + i.got;
    return i.kind + ' ' + i.field;
  });
  // eslint-disable-next-line no-console
  console.warn('[doctreen] schema drift on ' + event.route.method + ' ' + event.route.path +
    ' ' + event.part + ': ' + parts.join('; '));
}

function _resetWarnDedup() { WARN_DEDUP.clear(); }

function postWebhook(url, event) {
  // Fire-and-forget. Works on Node 18+ (global fetch). Falls back to silent
  // skip on older runtimes — webhook is an opt-in feature.
  if (typeof fetch !== 'function') return;
  try {
    const p = fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'doctreen-drift/1.0' },
      body: JSON.stringify(event),
    });
    if (p && typeof p.catch === 'function') p.catch(function () { /* swallow */ });
  } catch (_) { /* swallow */ }
}

// ─── Sampler ────────────────────────────────────────────────────────────────

/**
 * Returns true with probability `rate`. Centralised so per-adapter hooks share
 * sampling semantics. `rate >= 1` always samples; `rate <= 0` never samples.
 *
 * @param {number} rate
 */
function shouldSample(rate) {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

module.exports = {
  createMemoryStore: createMemoryStore,
  makeEvent: makeEvent,
  shouldSample: shouldSample,
  _resetWarnDedup: _resetWarnDedup,
};
