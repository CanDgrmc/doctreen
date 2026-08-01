'use strict';

/**
 * Drift event `count` — agent-side pre-aggregation (T004).
 *
 * A drift event may stand for more than one occurrence: an external store that
 * batches (the cloud agent collapsing a flush window) reports the same
 * signature once with `count: N` instead of N times. The store multiplies every
 * counter it keeps by that number.
 *
 * The contract asserted here:
 *
 *   1. Default     — no `count` argument means `count: 1`, and every counter
 *                    lands exactly where it landed before the field existed.
 *   2. Normalise   — 0, -1, 1.5, '3', NaN, Infinity, null are not occurrence
 *                    counts; they all become 1, at `makeEvent` time and again
 *                    on the way into `record` (events can arrive hand-built).
 *   3. Scaling     — `total`, `parts` and the hourly/daily buckets scale by
 *                    `issues.length * count`; `kinds` and `fields` scale by
 *                    `count`, because each issue is counted once per occurrence.
 *   4. Dedup       — `count` is NOT part of the dedup signature: it says how
 *                    many, not what.
 *   5. Propagation — `onDrift` and the webhook POST carry the event verbatim,
 *                    `count` included.
 *
 * Counters are read through `report()` rather than store internals, so the test
 * pins the observable contract and not the shape of the private entry.
 *
 * Run: node --test test/drift-count.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMemoryStore, makeEvent } = require('../src/internal/drift-store');

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed instant so hourly/daily bucket keys are deterministic: 2026-05-27T14 UTC. */
const T0 = Date.UTC(2026, 4, 27, 14, 30, 0);
const HOUR_KEY = '2026-05-27T14';
const DAY_KEY = '2026-05-27';

/** Two issues of two different kinds on two different fields. */
const TWO_ISSUES = [
  { kind: 'missing-required', field: 'email' },
  { kind: 'type-mismatch', field: 'age', expected: 'number', got: 'string' },
];

/**
 * A drift event at a caller-chosen instant.
 *
 * Built through `makeEvent` (the factory under test) and then stamped with an
 * explicit `sampledAt`: the 200 ms dedup window is driven by that timestamp, so
 * tests that want two events recorded must place them apart on purpose rather
 * than hope `Date.now()` moved.
 *
 * @param {number} sampledAt
 * @param {*} [count]
 * @param {Array<object>} [issues]
 * @returns {object}
 */
function eventAt(sampledAt, count, issues) {
  const event = makeEvent('post', '/users', 'body', issues || TWO_ISSUES, count);
  event.sampledAt = sampledAt;
  return event;
}

/** The single route entry of a fresh store's report. */
function onlyRoute(store) {
  const report = store.report();
  assert.equal(report.routes.length, 1, 'expected exactly one route in report');
  return report.routes[0];
}

function silentStore(extra) {
  return createMemoryStore(Object.assign({ logLevel: 'silent' }, extra || {}));
}

// ── 1. Default: absent count behaves exactly as before ──────────────────────

test('makeEvent without count produces count: 1 and leaves every other field alone', function () {
  const before = Date.now();
  const event = makeEvent('post', '/users', 'body', TWO_ISSUES);
  const after = Date.now();

  assert.equal(event.count, 1);
  assert.deepEqual(event.route, { method: 'POST', path: '/users' });
  assert.equal(event.part, 'body');
  assert.deepEqual(event.issues, TWO_ISSUES);
  assert.ok(event.sampledAt >= before && event.sampledAt <= after);
});

test('a count-less event records the pre-v1.17 counter values', function () {
  const store = silentStore();
  store.record(eventAt(T0));

  const route = onlyRoute(store);
  assert.equal(route.total, 2);
  assert.equal(route.kinds['missing-required'], 1);
  assert.equal(route.kinds['type-mismatch'], 1);
  assert.equal(route.fields.email, 1);
  assert.equal(route.fields.age, 1);
  assert.equal(route.parts.body, 2);
  assert.equal(route.buckets[HOUR_KEY], 2);
  assert.equal(route.dailyBuckets[DAY_KEY], 2);
});

test('an event with no count property at all is treated as one occurrence', function () {
  // Not every event goes through `makeEvent` — an external store implementation
  // may hand `record` a literal built from the documented payload shape.
  const withCount = silentStore();
  withCount.record(eventAt(T0, 1));

  const withoutCount = silentStore();
  const bare = eventAt(T0);
  delete bare.count;
  withoutCount.record(bare);

  assert.deepEqual(onlyRoute(withoutCount), onlyRoute(withCount));
});

// ── 2. Normalisation ────────────────────────────────────────────────────────

test('invalid counts normalise to 1 in makeEvent', function () {
  const invalid = [0, -1, 1.5, '3', NaN, Infinity, -Infinity, null, true, {}, []];
  for (const value of invalid) {
    assert.equal(
      makeEvent('post', '/users', 'body', TWO_ISSUES, value).count,
      1,
      'count ' + String(value) + ' should normalise to 1'
    );
  }
});

test('valid counts survive makeEvent untouched', function () {
  assert.equal(makeEvent('post', '/users', 'body', TWO_ISSUES, 1).count, 1);
  assert.equal(makeEvent('post', '/users', 'body', TWO_ISSUES, 3).count, 3);
  assert.equal(makeEvent('post', '/users', 'body', TWO_ISSUES, 5000).count, 5000);
});

test('record normalises an invalid count carried on the event itself', function () {
  for (const value of [0, -1, 1.5, '3', NaN, Infinity]) {
    const store = silentStore();
    const event = eventAt(T0);
    event.count = value; // bypasses makeEvent, as an external producer could
    store.record(event);

    const route = onlyRoute(store);
    assert.equal(route.total, 2, 'count ' + String(value) + ' should weigh as 1');
    assert.equal(route.kinds['missing-required'], 1);
    assert.equal(route.buckets[HOUR_KEY], 2);
  }
});

// ── 3. Scaling ──────────────────────────────────────────────────────────────

test('count: 3 with 2 issues scales every counter', function () {
  const store = silentStore();
  store.record(eventAt(T0, 3));

  const route = onlyRoute(store);
  // issues.length * count
  assert.equal(route.total, 6);
  assert.equal(route.parts.body, 6);
  assert.equal(route.buckets[HOUR_KEY], 6);
  assert.equal(route.dailyBuckets[DAY_KEY], 6);
  // one per issue per occurrence
  assert.equal(route.kinds['missing-required'], 3);
  assert.equal(route.kinds['type-mismatch'], 3);
  assert.equal(route.fields.email, 3);
  assert.equal(route.fields.age, 3);
  // report roll-up follows entry.total
  assert.equal(store.report().totalIssues, 6);
});

test('a repeated field inside one event is counted once per occurrence per issue', function () {
  const store = silentStore();
  store.record(eventAt(T0, 4, [
    { kind: 'missing-required', field: 'email' },
    { kind: 'type-mismatch', field: 'email', expected: 'string', got: 'number' },
  ]));

  const route = onlyRoute(store);
  assert.equal(route.total, 8);
  assert.equal(route.fields.email, 8);
  assert.equal(route.kinds['missing-required'], 4);
  assert.equal(route.kinds['type-mismatch'], 4);
});

test('counts accumulate across events and across buckets', function () {
  const store = silentStore();
  const HOUR = 60 * 60 * 1000;
  store.record(eventAt(T0, 3));
  store.record(eventAt(T0 + HOUR, 2)); // next hour, same day

  const route = onlyRoute(store);
  assert.equal(route.total, 10);
  assert.equal(route.kinds['missing-required'], 5);
  assert.equal(route.buckets[HOUR_KEY], 6);
  assert.equal(route.buckets['2026-05-27T15'], 4);
  assert.equal(route.dailyBuckets[DAY_KEY], 10);
});

// ── 4. Dedup ignores count ──────────────────────────────────────────────────

test('the dedup signature excludes count: same signature inside the window is dropped', function () {
  const store = silentStore();
  store.record(eventAt(T0, 1));
  store.record(eventAt(T0 + 50, 500)); // < 200 ms later, different count

  const route = onlyRoute(store);
  assert.equal(route.total, 2, 'second event must be deduped despite its count');
});

test('outside the dedup window both events land with their own counts', function () {
  const store = silentStore();
  store.record(eventAt(T0, 1));
  store.record(eventAt(T0 + 500, 3)); // > 200 ms later

  const route = onlyRoute(store);
  assert.equal(route.total, 2 + 6);
});

// ── 5. Propagation to onDrift and webhook ───────────────────────────────────

test('onDrift receives the event with count attached', function () {
  /** @type {Array<object>} */
  const seen = [];
  const store = silentStore({ onDrift: function (event) { seen.push(event); } });

  store.record(eventAt(T0, 7));
  store.record(eventAt(T0 + 500)); // count-less, outside the dedup window

  assert.equal(seen.length, 2);
  assert.equal(seen[0].count, 7);
  assert.equal(seen[1].count, 1);
  assert.deepEqual(seen[0].route, { method: 'POST', path: '/users' });
  assert.deepEqual(seen[0].issues, TWO_ISSUES);
});

test('the webhook body carries count', async function (t) {
  const original = globalThis.fetch;
  /** @type {Array<object>} */
  const posted = [];
  globalThis.fetch = function (url, init) {
    posted.push({ url: url, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: true });
  };
  t.after(function () { globalThis.fetch = original; });

  const store = silentStore({ webhook: 'https://example.test/drift' });
  store.record(eventAt(T0, 9));

  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'https://example.test/drift');
  assert.equal(posted[0].body.count, 9);
  assert.equal(posted[0].body.sampledAt, T0);
  assert.deepEqual(posted[0].body.route, { method: 'POST', path: '/users' });
});
