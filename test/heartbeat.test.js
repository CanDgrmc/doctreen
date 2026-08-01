'use strict';

/**
 * Heartbeat counters (T006).
 *
 * What is asserted, and why each assertion exists:
 *
 *   1. Counting     — N hits become the right totals, in the right route form,
 *                     against the right `windowStart`, and the window is empty
 *                     afterwards.
 *   2. statusCounts — 200/404/503 bucket into 2xx/4xx/5xx; a hit without a
 *                     status leaves the field off entirely (it is optional on
 *                     the wire, and shipping a zero-filled object would make
 *                     "no response validation" look like "no responses").
 *   3. Free when unused — a store without `recordHeartbeats` must not merely
 *                     skip the flush, it must not COUNT. This is the one
 *                     assertion that protects the hot path of every existing
 *                     user, so it is checked through `_pending()` (the Map
 *                     itself) and not through the store spy.
 *   4. Config       — `drift.heartbeat: false` starts no timer at all;
 *                     the interval is clamped to the 5s floor.
 *   5. unref        — the timer never holds the process open. `node --test`
 *                     finishing is the real proof; the explicit assertion is
 *                     here so a regression names itself.
 *   6. Fail-open    — a store that throws (or rejects) loses one window and
 *                     nothing else.
 *   7. Wiring       — `validateRequest` counts on the accepted path and stays
 *                     silent on the 422 path.
 *   8. Assembly     — `attachDriftRuntime` is the single place the five
 *                     adapters build this from.
 *
 * The five adapters are proved end-to-end over real HTTP in
 * `heartbeat-adapters.test.js`; this file owns the semantics.
 *
 * `setInterval` is stubbed rather than waited on: every window boundary in
 * these tests is triggered by calling `flush()` directly, so the suite runs in
 * milliseconds and never depends on wall-clock timing.
 *
 * Run: node --test test/heartbeat.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const { createHeartbeat, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS } = require('../src/internal/heartbeat');
const { attachDriftRuntime } = require('../src/internal/drift');
const { validateRequest } = require('../src/internal/validate');

// ── Test doubles ────────────────────────────────────────────────────────────

/**
 * A drift store that records every heartbeat window it is handed (Spy).
 * `recordHeartbeats` is passed in rather than fixed so the same double covers
 * "store without the hook" (null) and "hook throws".
 *
 * @param {Function|null} [recordHeartbeats] - omitted from the store when null
 * @returns {any}
 */
function createSpyStore(recordHeartbeats) {
  /** @type {Array<{ entries: any, windowStart: number }>} */
  const windows = [];
  /** @type {any} */
  const store = {
    windows: windows,
    record: function () {},
    report: function () { return { generatedAt: Date.now(), totalIssues: 0, routes: [] }; },
    reset: function () {},
  };
  if (recordHeartbeats !== null) {
    store.recordHeartbeats = recordHeartbeats || function (entries, windowStart) {
      windows.push({ entries: entries, windowStart: windowStart });
    };
  }
  return store;
}

/**
 * Run `fn` with `setInterval` stubbed, so timer creation is observable and no
 * real timer is ever armed. Returns what the stub saw alongside `fn`'s result.
 *
 * @param {Function} fn
 * @returns {{ result: any, calls: Array<{ ms: number }>, unrefCount: number }}
 */
function withStubbedInterval(fn) {
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  /** @type {Array<{ ms: number }>} */
  const calls = [];
  let unrefCount = 0;

  // @ts-ignore - deliberately narrower than the real signature
  global.setInterval = function (_handler, ms) {
    calls.push({ ms: ms });
    return { unref: function () { unrefCount++; return this; } };
  };
  // @ts-ignore
  global.clearInterval = function () {};

  try {
    const result = fn();
    return { result: result, calls: calls, unrefCount: unrefCount };
  } finally {
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
  }
}

/** Config shorthand: drift on, heartbeats on, `store` plugged in. */
function configWith(store, extra) {
  return { drift: Object.assign({ store: store }, extra || {}) };
}

const ROUTE_LIST = { method: 'get', path: '/items' };
const ROUTE_ONE = { method: 'GET', path: '/items/:id' };

// ── 1. Counting ─────────────────────────────────────────────────────────────

test('flush reports per-route totals, then empties the window', function () {
  const store = createSpyStore();
  const before = Date.now();
  const hb = withStubbedInterval(function () { return createHeartbeat(configWith(store)); }).result;

  for (let i = 0; i < 7; i++) hb.hit(ROUTE_LIST);
  for (let i = 0; i < 3; i++) hb.hit(ROUTE_ONE);

  assert.equal(hb._pending().length, 2, 'both routes are open in the window');

  hb.flush();
  const after = Date.now();

  assert.equal(store.windows.length, 1);
  const { entries, windowStart } = store.windows[0];

  // Route form matches the startup inventory: upper-case method, OpenAPI path.
  const byKey = {};
  entries.forEach(function (e) { byKey[e.route.method + ' ' + e.route.path] = e; });
  assert.deepEqual(Object.keys(byKey).sort(), ['GET /items', 'GET /items/{id}']);
  assert.equal(byKey['GET /items'].validatedCount, 7);
  assert.equal(byKey['GET /items/{id}'].validatedCount, 3);

  // windowStart is when the window OPENED — i.e. at creation, not at flush.
  assert.ok(windowStart >= before && windowStart <= after, 'windowStart inside the window');

  assert.deepEqual(hb._pending(), [], 'the Map is cleared after flush');

  // The next window is independent and carries the new windowStart.
  hb.hit(ROUTE_LIST);
  hb.flush();
  assert.equal(store.windows.length, 2);
  assert.equal(store.windows[1].entries[0].validatedCount, 1);
  assert.ok(store.windows[1].windowStart >= windowStart);
});

test('an empty window is not reported', function () {
  const store = createSpyStore();
  const hb = withStubbedInterval(function () { return createHeartbeat(configWith(store)); }).result;

  hb.flush();
  hb.flush();

  assert.equal(store.windows.length, 0, 'nothing to say, so nothing is said');
});

test('stop() clears the timer and flushes what is left', function () {
  const store = createSpyStore();
  const stub = withStubbedInterval(function () {
    const hb = createHeartbeat(configWith(store));
    hb.hit(ROUTE_LIST);
    hb.stop();
    hb.stop(); // idempotent — no second (empty) window
    return hb;
  });

  assert.equal(store.windows.length, 1);
  assert.equal(stub.result._pending().length, 0);
});

// ── 2. statusCounts ─────────────────────────────────────────────────────────

test('status codes bucket into 2xx / 4xx / 5xx', function () {
  const store = createSpyStore();
  const hb = withStubbedInterval(function () { return createHeartbeat(configWith(store)); }).result;

  hb.hit(ROUTE_LIST, 200);
  hb.hit(ROUTE_LIST, 201);
  hb.hit(ROUTE_LIST, 404);
  hb.hit(ROUTE_LIST, 503);
  hb.flush();

  const entry = store.windows[0].entries[0];
  assert.equal(entry.validatedCount, 4);
  assert.deepEqual(entry.statusCounts, { '2xx': 2, '4xx': 1, '5xx': 1 });
});

test('a hit without a status counts only validatedCount', function () {
  const store = createSpyStore();
  const hb = withStubbedInterval(function () { return createHeartbeat(configWith(store)); }).result;

  hb.hit(ROUTE_LIST);
  hb.hit(ROUTE_LIST);
  hb.flush();

  const entry = store.windows[0].entries[0];
  assert.equal(entry.validatedCount, 2);
  assert.ok(!('statusCounts' in entry), 'the optional field stays off the wire entirely');
});

test('a status outside the three classes still counts as traffic', function () {
  const store = createSpyStore();
  const hb = withStubbedInterval(function () { return createHeartbeat(configWith(store)); }).result;

  hb.hit(ROUTE_LIST, 302);
  hb.hit(ROUTE_LIST, 200);
  hb.flush();

  const entry = store.windows[0].entries[0];
  assert.equal(entry.validatedCount, 2);
  assert.deepEqual(entry.statusCounts, { '2xx': 1, '4xx': 0, '5xx': 0 });
});

// ── 3. Free when unused ─────────────────────────────────────────────────────

test('a store without recordHeartbeats does not even count', function () {
  const store = createSpyStore(null);
  assert.equal(typeof store.recordHeartbeats, 'undefined');

  const stub = withStubbedInterval(function () { return createHeartbeat(configWith(store)); });
  const hb = stub.result;

  assert.equal(hb.enabled, false);
  for (let i = 0; i < 1000; i++) hb.hit(ROUTE_LIST, 200);

  assert.deepEqual(hb._pending(), [], 'the Map never grows — hit is bound to a no-op');
  assert.equal(stub.calls.length, 0, 'and no window timer is armed');

  hb.flush();
  hb.stop();
});

// ── 4. Config ───────────────────────────────────────────────────────────────

test('drift.heartbeat: false never arms an interval', function () {
  const store = createSpyStore();
  const stub = withStubbedInterval(function () {
    return createHeartbeat(configWith(store, { heartbeat: false }));
  });

  assert.equal(stub.calls.length, 0, 'setInterval was never called');
  assert.equal(stub.result.enabled, false);

  stub.result.hit(ROUTE_LIST);
  assert.deepEqual(stub.result._pending(), []);
});

test('drift disabled turns heartbeats off too', function () {
  const store = createSpyStore();
  const stub = withStubbedInterval(function () {
    return createHeartbeat(configWith(store, { enabled: false }));
  });

  assert.equal(stub.calls.length, 0);
  assert.equal(stub.result.enabled, false);
});

test('no config at all is safe', function () {
  const stub = withStubbedInterval(function () { return createHeartbeat(undefined); });
  assert.equal(stub.result.enabled, false);
  assert.equal(stub.calls.length, 0);
  stub.result.hit(ROUTE_LIST);
  stub.result.stop();
});

test('the window length defaults to 60s and is clamped to a 5s floor', function () {
  const store = createSpyStore();

  const dflt = withStubbedInterval(function () { return createHeartbeat(configWith(store)); });
  assert.equal(dflt.calls[0].ms, DEFAULT_INTERVAL_MS);

  const tooFast = withStubbedInterval(function () {
    return createHeartbeat(configWith(store, { heartbeatIntervalMs: 10 }));
  });
  assert.equal(tooFast.calls[0].ms, MIN_INTERVAL_MS);

  const custom = withStubbedInterval(function () {
    return createHeartbeat(configWith(store, { heartbeatIntervalMs: 15000 }));
  });
  assert.equal(custom.calls[0].ms, 15000);

  const nonsense = withStubbedInterval(function () {
    return createHeartbeat(configWith(store, { heartbeatIntervalMs: /** @type {any} */ ('soon') }));
  });
  assert.equal(nonsense.calls[0].ms, DEFAULT_INTERVAL_MS);
});

// ── 5. unref ────────────────────────────────────────────────────────────────

test('the window timer is unref()ed so it cannot hold the process open', function () {
  const store = createSpyStore();
  const stub = withStubbedInterval(function () { return createHeartbeat(configWith(store)); });

  assert.equal(stub.calls.length, 1);
  assert.equal(stub.unrefCount, 1);
});

test('a real, unstubbed heartbeat does not keep node --test alive', function (t) {
  // No stubbing here: this arms a genuine 5s interval and deliberately never
  // stops it. If `unref()` regressed, this file would take 5s longer to exit
  // (and hang for a full minute at the default interval).
  const store = createSpyStore();
  const hb = createHeartbeat(configWith(store, { heartbeatIntervalMs: MIN_INTERVAL_MS }));
  hb.hit(ROUTE_LIST);
  assert.equal(hb.enabled, true);
  t.diagnostic('live interval armed and intentionally left running');
});

// ── 6. Fail-open ────────────────────────────────────────────────────────────

test('a throwing store loses one window and nothing else', function () {
  let calls = 0;
  const store = createSpyStore(function (entries) {
    calls++;
    if (calls === 1) throw new Error('store exploded');
    store.windows.push({ entries: entries, windowStart: 0 });
  });
  const hb = withStubbedInterval(function () { return createHeartbeat(configWith(store)); }).result;

  hb.hit(ROUTE_LIST);
  assert.doesNotThrow(function () { hb.flush(); });
  assert.deepEqual(hb._pending(), [], 'the failed window is dropped, not replayed');

  hb.hit(ROUTE_ONE);
  hb.hit(ROUTE_ONE);
  hb.flush();

  assert.equal(calls, 2);
  assert.equal(store.windows.length, 1, 'the second window went through untouched');
  assert.equal(store.windows[0].entries[0].validatedCount, 2);
});

test('a rejecting async store does not raise an unhandled rejection', function () {
  const store = createSpyStore(function () { return Promise.reject(new Error('network down')); });
  const hb = withStubbedInterval(function () { return createHeartbeat(configWith(store)); }).result;

  hb.hit(ROUTE_LIST);
  assert.doesNotThrow(function () { hb.flush(); });
});

// ── 7. Wiring through validateRequest ───────────────────────────────────────

test('validateRequest counts an accepted request and ignores a rejected one', async function () {
  const store = createSpyStore();
  const config = configWith(store);
  withStubbedInterval(function () { return attachDriftRuntime(config); });
  const hb = config._heartbeat;
  const validators = { body: z.object({ name: z.string() }) };

  const ok = await validateRequest(validators, { body: { name: 'ada' } }, ROUTE_LIST, config);
  assert.equal(ok.ok, true);
  assert.equal(hb._pending()[0].validatedCount, 1);

  const bad = await validateRequest(validators, { body: { name: 42 } }, ROUTE_LIST, config);
  assert.equal(bad.ok, false);
  assert.equal(hb._pending()[0].validatedCount, 1, '422 responses are not traffic that passed validation');
});

test('validateRequest without route/config behaves exactly as before', async function () {
  const validators = { body: z.object({ name: z.string() }) };

  const ok = await validateRequest(validators, { body: { name: 'ada' } });
  assert.deepEqual(ok, { ok: true, data: { body: { name: 'ada' } } });

  // Half the pair is ignored rather than crashing the request.
  const store = createSpyStore();
  const config = configWith(store);
  withStubbedInterval(function () { return attachDriftRuntime(config); });
  await validateRequest(validators, { body: { name: 'ada' } }, undefined, config);
  await validateRequest(validators, { body: { name: 'ada' } }, ROUTE_LIST, undefined);
  assert.deepEqual(config._heartbeat._pending(), []);
});

test('a heartbeat that throws cannot break the request', async function () {
  const exploding = { _heartbeat: { hit: function () { throw new Error('counter exploded'); } } };
  const validators = { body: z.object({ name: z.string() }) };

  const ok = await validateRequest(validators, { body: { name: 'ada' } }, ROUTE_LIST, exploding);
  assert.equal(ok.ok, true);
});

// ── 8. attachDriftRuntime — the one place all five adapters wire this up ─────

test('attachDriftRuntime builds both runtime objects onto the config', function () {
  const store = createSpyStore();
  const config = configWith(store);
  const stub = withStubbedInterval(function () { return attachDriftRuntime(config); });

  assert.equal(stub.result, config._drift, 'returns the pipeline it attached');
  assert.equal(config._drift.enabled, true);
  assert.equal(config._heartbeat.enabled, true);
  assert.equal(stub.calls.length, 1, 'exactly one window timer per mount');

  // Drift off means heartbeats off — they share one store and one config block.
  const offConfig = configWith(store, { enabled: false });
  const offStub = withStubbedInterval(function () { return attachDriftRuntime(offConfig); });
  assert.equal(offConfig._drift.enabled, false);
  assert.equal(offConfig._heartbeat.enabled, false);
  assert.equal(offStub.calls.length, 0);
});
