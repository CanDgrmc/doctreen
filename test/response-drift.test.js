'use strict';

/**
 * Response drift → drift pipeline, `part: 'response'` (T007 — v1.17).
 *
 * v1.16 could tell that a response violated its declared contract, but the
 * finding died in a console.warn (or a 500). T007 routes the same mismatch into
 * the drift pipeline, so the diagnosis matrix has a data source for its
 * response row.
 *
 * The wiring lives in `assertResponse` (src/internal/validate.js) — the single
 * helper T008 extracted for exactly this reason — so all five adapters inherit
 * it from one place. This suite proves that claim adapter by adapter, using the
 * same builder table as the other parity suites, plus unit coverage for the
 * Zod → drift issue translation and the `normalizeDriftConfig` whitelist.
 *
 * Run: node --test test/response-drift.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { z } = require('zod');

const { normalizeConfig } = require('../src/index');
const { toDriftIssues } = require('../src/internal/response-drift');
const { createDriftPipeline } = require('../src/internal/drift');

// ── Shared fixture contract ─────────────────────────────────────────────────

const Staff = z.object({
  id: z.number(),
  name: z.string(),
  isActive: z.boolean(),
});

const Nested = z.object({
  user: z.object({
    address: z.object({ city: z.string() }),
  }),
});

const ErrorEnvelope = z.object({
  error: z.string(),
  message: z.string(),
});

/** `id` is a string and `isActive` is absent — two distinct top-level kinds. */
const FLAT_DRIFT   = { id: 'one', name: 'Ada' };
/** Only the leaf `user.address.city` is wrong — must fold onto `user`. */
const NESTED_DRIFT = { user: { address: { city: 5 } } };
/** `message` is absent — violates the schema declared for status 422. */
const BAD_ENVELOPE = { error: 'Validation' };
const VALID_STAFF  = { id: 1, name: 'Ada', isActive: true };

const STAFF_DOC  = { request: { body: null, query: null }, response: Staff };
const NESTED_DOC = { request: { body: null, query: null }, response: Nested };
const ERROR_DOC  = {
  request: { body: null, query: null },
  response: Staff,
  errors: { 422: { description: 'Validation failed', schema: ErrorEnvelope } },
};

/**
 * @typedef {{ path: string, status: number, body: any, doc: any }} FixtureRoute
 */

/** @type {FixtureRoute[]} */
const ROUTES = [
  { path: '/ok',         status: 200, body: VALID_STAFF,   doc: STAFF_DOC  },
  { path: '/flat',       status: 200, body: FLAT_DRIFT,    doc: STAFF_DOC  },
  { path: '/nested',     status: 200, body: NESTED_DRIFT,  doc: NESTED_DOC },
  { path: '/err',        status: 422, body: BAD_ENVELOPE,  doc: ERROR_DOC  },
  { path: '/undeclared', status: 418, body: { teapot: true }, doc: STAFF_DOC },
];

const META = { title: 'Response Drift API', version: '1.17.0', description: 'T007 fixture.' };
const HOST = '127.0.0.1';

/**
 * Build a doctreen config whose drift pipeline reports into `events`.
 *
 * `sampleRate: 1` makes the assertions deterministic; `logLevel: 'silent'`
 * keeps the store's own warnings out of the response-assertion warnings.
 *
 * @param {Array<any>} events
 * @param {object} [overrides] - merged over the top-level config
 * @param {object} [driftOverrides] - merged over the `drift` block
 */
function configWith(events, overrides, driftOverrides) {
  return Object.assign({
    meta: META,
    validate: { response: 'warn' },
    drift: Object.assign({
      enabled: true,
      sampleRate: 1,
      logLevel: 'silent',
      onDrift: function (event) { events.push(event); },
    }, driftOverrides || {}),
  }, overrides || {});
}

/** Only the events this task is about. */
function responseEvents(events) {
  return events.filter(function (e) { return e.part === 'response'; });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * @param {string} baseUrl
 * @param {string} path
 * @returns {Promise<{ status: number, text: string }>}
 */
function get(baseUrl, path) {
  return new Promise(function (resolve, reject) {
    const url = new URL(path, baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET', agent: false },
      function (res) {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { text += c; });
        res.on('end', function () { resolve({ status: res.statusCode, text: text }); });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Run `fn` with console.warn swallowed — response assertion warns by design and
 * this suite is about the events, not the log line.
 *
 * @param {function(): Promise<any>} fn
 */
async function quiet(fn) {
  const original = console.warn;
  console.warn = function () {};
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

/** @param {import('http').Server} server @returns {Promise<string>} */
function listen(server) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, HOST, function () {
      resolve('http://' + HOST + ':' + server.address().port);
    });
  });
}

/** @param {import('http').Server} server @returns {Promise<void>} */
function closeServer(server) {
  return new Promise(function (resolve) { server.close(function () { resolve(); }); });
}

/** Resolve after the current macrotask, letting deferred introspection run. */
function nextTick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

/**
 * Find the single response event recorded for a route.
 *
 * @param {Array<any>} events
 * @param {string} path
 * @returns {any}
 */
function eventFor(events, path) {
  const hits = responseEvents(events).filter(function (e) { return e.route.path === path; });
  assert.equal(hits.length, 1, 'expected exactly one response drift event for ' + path +
    ', got ' + JSON.stringify(hits));
  return hits[0];
}

/**
 * Assert an issue list contains a matching entry.
 *
 * @param {Array<any>} issues
 * @param {object} expected - subset of the issue fields
 */
function hasIssue(issues, expected) {
  const found = issues.some(function (i) {
    return Object.keys(expected).every(function (k) { return i[k] === expected[k]; });
  });
  assert.ok(found, 'expected an issue matching ' + JSON.stringify(expected) +
    ' in ' + JSON.stringify(issues));
}

// ── Adapter builders (Factory) ──────────────────────────────────────────────

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildExpressApp(config) {
  const express = require('express');
  const { expressAdapter, defineRoute } = require('../src/adapters/express');

  const app = express();
  for (const r of ROUTES) {
    app.get(r.path, defineRoute(
      function handler(_req, res) { res.status(r.status).json(r.body); },
      r.doc
    ));
  }
  app.use(expressAdapter(app, config));
  app.use(function (_err, _req, res, _next) { res.status(500).json({ error: 'response_invalid' }); });

  const server = http.createServer(app);
  const baseUrl = await listen(server);
  await nextTick();
  return { baseUrl: baseUrl, close: function () { return closeServer(server); } };
}

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildFastifyApp(config) {
  const Fastify = require('fastify');
  const { fastifyAdapter, defineRoute } = require('../src/adapters/fastify');

  const app = Fastify();
  fastifyAdapter(app, config);
  for (const r of ROUTES) {
    app.get(r.path, defineRoute(
      async function handler(_req, reply) { reply.status(r.status); return r.body; },
      r.doc
    ));
  }
  await app.listen({ port: 0, host: HOST });
  return {
    baseUrl: 'http://' + HOST + ':' + app.server.address().port,
    close: function () { return app.close(); },
  };
}

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildHonoApp(config) {
  const { Hono } = require('hono');
  const { serve } = require('@hono/node-server');
  const { honoAdapter, defineRoute } = require('../src/adapters/hono');

  const app = new Hono();
  honoAdapter(app, config);
  for (const r of ROUTES) {
    app.get(r.path, defineRoute(
      function handler(c) { return c.json(r.body, r.status); },
      r.doc
    ));
  }
  app.onError(function (_err, c) { return c.json({ error: 'response_invalid' }, 500); });

  const server = await new Promise(function (resolve) {
    const s = serve({ fetch: app.fetch, port: 0, hostname: HOST }, function () { resolve(s); });
  });
  return {
    baseUrl: 'http://' + HOST + ':' + server.address().port,
    close: function () { return closeServer(server); },
  };
}

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildKoaApp(config) {
  const Koa = require('koa');
  const Router = require('@koa/router');
  const { koaAdapter, defineRoute } = require('../src/adapters/koa');

  const app = new Koa();
  app.silent = true;
  const router = new Router();
  koaAdapter(router, config);

  for (const r of ROUTES) {
    router.get(r.path, defineRoute(
      async function handler(ctx) {
        // Body first, then status: assigning ctx.body resets an unset status.
        ctx.body = r.body;
        ctx.status = r.status;
      },
      r.doc
    ));
  }
  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = http.createServer(app.callback());
  const baseUrl = await listen(server);
  return { baseUrl: baseUrl, close: function () { return closeServer(server); } };
}

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildNestApp(config) {
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { Controller, Get, HttpCode, Module } = require('@nestjs/common');
  const { nestAdapter, DocRoute } = require('../src/adapters/nest');

  // The suite stays CommonJS, so the decorator factories are applied by hand.
  class DriftController {}

  ROUTES.forEach(function (r, i) {
    const name = 'route' + i;
    DriftController.prototype[name] = function () { return r.body; };
    const proto = DriftController.prototype;
    const decorators = [Get(r.path.slice(1)), HttpCode(r.status), DocRoute(r.doc)];
    for (let d = 0; d < decorators.length; d++) {
      decorators[d](proto, name, Object.getOwnPropertyDescriptor(proto, name));
    }
  });

  Controller()(DriftController);
  class AppModule {}
  Module({ controllers: [DriftController] })(AppModule);

  const app = await NestFactory.create(AppModule, { logger: false });
  nestAdapter(app, config);
  await app.listen(0, HOST);
  return {
    baseUrl: 'http://' + HOST + ':' + app.getHttpServer().address().port,
    close: function () { return app.close(); },
  };
}

const BUILDERS = {
  express: buildExpressApp,
  fastify: buildFastifyApp,
  hono:    buildHonoApp,
  koa:     buildKoaApp,
  nest:    buildNestApp,
};

const ADAPTERS = Object.keys(BUILDERS);

/**
 * Boot one adapter, run `fn(baseUrl)`, close it.
 *
 * @param {string} name
 * @param {any} config
 * @param {function(string): Promise<any>} fn
 */
async function withApp(name, config, fn) {
  const app = await BUILDERS[name](config);
  try {
    return await quiet(function () { return fn(app.baseUrl); });
  } finally {
    await app.close();
  }
}

// ── Adapter parity ──────────────────────────────────────────────────────────

for (const name of ADAPTERS) {
  test(name + ': a failed response assertion becomes a part:response drift event', async () => {
    /** @type {Array<any>} */
    const events = [];

    await withApp(name, configWith(events), async function (baseUrl) {
      for (const r of ROUTES) {
        const res = await get(baseUrl, r.path);
        assert.equal(res.status, r.status, r.path + ' should keep its status');
      }
    });

    // 2xx success-schema drift: both top-level kinds, with the declared and
    // actual type names — never the values.
    const flat = eventFor(events, '/flat');
    assert.equal(flat.route.method, 'GET');
    assert.equal(flat.count, 1);
    hasIssue(flat.issues, { kind: 'type-mismatch', field: 'id', expected: 'number', got: 'string' });
    hasIssue(flat.issues, { kind: 'missing-required', field: 'isActive', expected: 'boolean' });

    // Nested mismatch folds onto the top-level field (core is top-level only).
    const nested = eventFor(events, '/nested');
    assert.deepEqual(nested.issues, [{ kind: 'type-mismatch', field: 'user' }]);

    // Status-aware: the 422 is diffed against errors[422], not the success schema.
    const err = eventFor(events, '/err');
    assert.deepEqual(err.issues, [{ kind: 'missing-required', field: 'message', expected: 'string' }]);

    // A conforming response and an undeclared status produce nothing: drift
    // reports what validation asserts, no more.
    const paths = responseEvents(events).map(function (e) { return e.route.path; });
    assert.ok(paths.indexOf('/ok') === -1, '/ok must not drift: ' + JSON.stringify(paths));
    assert.ok(paths.indexOf('/undeclared') === -1,
      'an undeclared status has no contract to drift from: ' + JSON.stringify(paths));
  });

  test(name + ': throw mode records the event too', async () => {
    /** @type {Array<any>} */
    const events = [];
    const config = configWith(events, { validate: { response: 'throw' } });

    await withApp(name, config, async function (baseUrl) {
      const res = await get(baseUrl, '/flat');
      assert.ok(res.status >= 400, 'throw mode must not deliver the invalid body');
    });

    const flat = eventFor(events, '/flat');
    hasIssue(flat.issues, { kind: 'missing-required', field: 'isActive' });
  });

  test(name + ': no response drift while response validation is off', async () => {
    /** @type {Array<any>} */
    const events = [];
    const config = configWith(events, { validate: undefined });

    await withApp(name, config, async function (baseUrl) {
      const res = await get(baseUrl, '/flat');
      assert.equal(res.status, 200);
    });

    assert.deepEqual(responseEvents(events), [],
      'nothing asserts the response, so nothing can drift');
  });
}

// ── Sampling, reporting and opt-out (express as the reference mount) ─────────

test('express: sampleRate 0 records nothing, sampleRate 1 records every mismatch', async () => {
  /** @type {Array<any>} */
  const none = [];
  await withApp('express', configWith(none, null, { sampleRate: 0 }), async function (baseUrl) {
    await get(baseUrl, '/flat');
    await get(baseUrl, '/nested');
  });
  assert.deepEqual(responseEvents(none), [], 'sampleRate 0 must drop every response event');

  /** @type {Array<any>} */
  const all = [];
  await withApp('express', configWith(all, null, { sampleRate: 1 }), async function (baseUrl) {
    await get(baseUrl, '/flat');
    await get(baseUrl, '/nested');
  });
  assert.equal(responseEvents(all).length, 2, 'sampleRate 1 must record both mismatches');
});

test('express: drift: false silences response drift without breaking the response', async () => {
  /** @type {Array<any>} */
  const events = [];
  const config = {
    meta: META,
    validate: { response: 'warn' },
    drift: false,
    // Would fire if the pipeline were live; it must not be reachable at all.
    onDrift: function (e) { events.push(e); },
  };

  await withApp('express', config, async function (baseUrl) {
    const res = await get(baseUrl, '/flat');
    assert.equal(res.status, 200, 'a disabled pipeline must not disturb the response');
  });
  assert.deepEqual(events, []);
});

test('express: /docs/drift.json counts response issues under parts.response', async () => {
  /** @type {Array<any>} */
  const events = [];
  let report = null;

  await withApp('express', configWith(events), async function (baseUrl) {
    await get(baseUrl, '/flat');    // two issues
    await get(baseUrl, '/nested');  // one issue
    const res = await get(baseUrl, '/docs/drift.json');
    assert.equal(res.status, 200);
    report = JSON.parse(res.text);
  });

  const flat = report.routes.filter(function (r) { return r.path === '/flat'; })[0];
  assert.ok(flat, 'the drifting route should appear in the report: ' + JSON.stringify(report.routes));
  assert.equal(flat.parts.response, 2, 'both issues weigh into parts.response');
  assert.equal(flat.parts.body, 0, 'request parts stay zero and stay present');
  assert.equal(flat.parts.query, 0);
  assert.equal(flat.samples[0].part, 'response');

  const nested = report.routes.filter(function (r) { return r.path === '/nested'; })[0];
  assert.equal(nested.parts.response, 1);
  assert.equal(nested.fields.user, 1, 'the folded top-level field is what gets counted');
});

// ── Pipeline entry point ────────────────────────────────────────────────────

test('recordIssues routes pre-diffed issues through sampling, makeEvent and the store', () => {
  /** @type {Array<any>} */
  const recorded = [];
  const store = {
    record: function (event) { recorded.push(event); },
    report: function () { return { generatedAt: 0, totalIssues: 0, routes: [] }; },
    reset: function () {},
  };
  const pipeline = createDriftPipeline({ drift: { enabled: true, sampleRate: 1, store: store } });

  pipeline.recordIssues({ method: 'post', path: '/staff' }, 'response',
    [{ kind: 'missing-required', field: 'id' }]);

  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0].route, { method: 'POST', path: '/staff' }, 'makeEvent normalises the method');
  assert.equal(recorded[0].part, 'response');
  assert.equal(recorded[0].count, 1);
  assert.ok(recorded[0].sampledAt > 0);

  // Nothing to report is not an event.
  pipeline.recordIssues({ method: 'GET', path: '/staff' }, 'response', []);
  assert.equal(recorded.length, 1);

  // A disabled pipeline still answers the call — adapters must not have to check.
  const off = createDriftPipeline({ drift: { enabled: false } });
  assert.equal(typeof off.recordIssues, 'function');
  off.recordIssues({ method: 'GET', path: '/x' }, 'response', [{ kind: 'type-mismatch', field: 'a' }]);
});

// ── Zod → drift issue translation ───────────────────────────────────────────

/** @param {any} schema @param {any} value @returns {Array<any>} */
function driftIssuesFor(schema, value) {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, 'fixture should not parse');
  return toDriftIssues(result.error.issues);
}

test('toDriftIssues maps the three drift kinds off real Zod issues', () => {
  assert.deepEqual(driftIssuesFor(Staff, { id: 'one', name: 'Ada' }), [
    { kind: 'type-mismatch', field: 'id', expected: 'number', got: 'string' },
    { kind: 'missing-required', field: 'isActive', expected: 'boolean' },
  ]);

  // Extra keys are only visible to Zod on a `.strict()` object — a plain
  // z.object strips them, which is why unexpected-field is rare here.
  assert.deepEqual(driftIssuesFor(Staff.strict(), { id: 1, name: 'Ada', isActive: true, extra: 1 }), [
    { kind: 'unexpected-field', field: 'extra' },
  ]);

  // null / wrong primitive types keep the SchemaNode type vocabulary.
  assert.deepEqual(driftIssuesFor(Staff, { id: 1, name: null, isActive: true }), [
    { kind: 'type-mismatch', field: 'name', expected: 'string', got: 'null' },
  ]);
});

test('toDriftIssues folds nested paths onto their top-level field', () => {
  // A leaf three levels down is reported against `user` — and without the
  // leaf's expected/got, which describe `city`, not `user`.
  assert.deepEqual(driftIssuesFor(Nested, { user: { address: { city: 5 } } }), [
    { kind: 'type-mismatch', field: 'user' },
  ]);

  // A missing nested property is not a missing top-level property: all the top
  // level can say is that `user`'s shape disagrees.
  assert.deepEqual(driftIssuesFor(Nested, { user: { address: {} } }), [
    { kind: 'type-mismatch', field: 'user' },
  ]);

  // Two leaves under one field are one drift fact about that field.
  const Wide = z.object({ user: z.object({ a: z.string(), b: z.number() }) });
  assert.deepEqual(driftIssuesFor(Wide, { user: { a: 1, b: 'x' } }), [
    { kind: 'type-mismatch', field: 'user' },
  ]);

  // An extra key inside a nested object folds the same way.
  const StrictNested = z.object({ user: z.object({ a: z.string() }).strict() });
  assert.deepEqual(driftIssuesFor(StrictNested, { user: { a: 'x', b: 1 } }), [
    { kind: 'unexpected-field', field: 'user' },
  ]);
});

test('toDriftIssues drops issues with no top-level field to name', () => {
  // The whole body is the wrong shape — `diffShape` returns nothing for this
  // case either, so response drift stays consistent with request drift.
  assert.deepEqual(driftIssuesFor(Staff, null), []);
  assert.deepEqual(driftIssuesFor(Staff, [1, 2]), []);
  assert.deepEqual(toDriftIssues(undefined), []);
  assert.deepEqual(toDriftIssues([null]), []);
});

test('toDriftIssues reports a failed refinement as type-mismatch on its field', () => {
  const Constrained = z.object({ name: z.string().min(3), email: z.string().email() });
  assert.deepEqual(driftIssuesFor(Constrained, { name: 'a', email: 'nope' }), [
    { kind: 'type-mismatch', field: 'name' },
    { kind: 'type-mismatch', field: 'email' },
  ]);
});

test('toDriftIssues never carries a payload value', () => {
  const issues = driftIssuesFor(Staff, { id: 'secret-token', name: 'Ada' });
  const serialised = JSON.stringify(issues);
  assert.equal(serialised.indexOf('secret-token'), -1,
    'drift events carry field names and type names only: ' + serialised);
});

// ── normalizeDriftConfig whitelist ──────────────────────────────────────────

test('normalizeConfig carries every drift field through the object branch', () => {
  // `normalizeDriftConfig` rebuilds the block field by field, so a field added
  // to the defaults but not to the object branch is silently dropped for every
  // user who passes an object (the v1.17 `heartbeat` regression). Comparing the
  // two branches' key sets is what makes that failure loud.
  const fromDefaults = normalizeConfig({ drift: true }).drift;
  const fromObject = normalizeConfig({ drift: { enabled: true } }).drift;
  assert.deepEqual(
    Object.keys(fromObject).sort(),
    Object.keys(fromDefaults).sort(),
    'normalizeDriftConfig is a whitelist — a new drift field must be added to both branches'
  );
});

test('normalizeConfig preserves the sampleRate response drift shares with request drift', () => {
  assert.equal(normalizeConfig({ drift: { sampleRate: 0 } }).drift.sampleRate, 0,
    'an explicit 0 must survive normalisation, not fall back to the default');
  assert.equal(normalizeConfig({ drift: { sampleRate: 1 } }).drift.sampleRate, 1);
  assert.equal(normalizeConfig({ drift: {} }).drift.sampleRate, 0.01);
});
