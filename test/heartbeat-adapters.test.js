'use strict';

/**
 * Heartbeat counters, across all five adapters (T006).
 *
 * `heartbeat.test.js` owns the semantics — bucketing, windows, fail-open. This
 * file owns the wiring, which is the part that historically rots: the same
 * feature reaches express, fastify, hono, koa and nest through five different
 * request paths, and the only assertion that catches one of them being missed
 * is a real request over a real socket.
 *
 * Three invariants, run against every adapter:
 *
 *   1. Counted   — a request that passes validation reaches `recordHeartbeats`
 *                  with the right route (upper-case method, OpenAPI path form)
 *                  and the right `validatedCount`.
 *   2. Not counted — a 422 does not. `validatedCount` means "passed", not "arrived".
 *   3. Free      — with `drift.heartbeat: false`, or a store that never
 *                  implemented `recordHeartbeats`, nothing is counted at all:
 *                  the open window stays empty, so the hot path of every
 *                  pre-v1.17 user costs nothing.
 *
 * Setup mirrors `adapters-smoke.test.js`: one builder per framework (Factory),
 * each returning the same `{ baseUrl, tick, store, close }` handle, so the
 * assertions are written once and parametrised. Servers bind port 0 and are
 * closed in `after`.
 *
 * `tick` is the window timer's own callback, captured while the adapter mounts
 * (`captureHeartbeatTimer`). Two reasons for going through the timer rather
 * than the heartbeat object: the adapters attach it to their NORMALISED config,
 * which never leaves the adapter, so a test has no other handle on it — and
 * whether a timer was armed at all is exactly the question invariant 3 asks.
 * `tick === null` means no window was ever opened, which is a stronger claim
 * than "the flush found nothing".
 *
 * Waiting on the real interval is deliberately avoided: a suite that waits for
 * wall-clock time is a suite that eventually flakes.
 *
 * Run: node --test test/heartbeat-adapters.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { z } = require('zod');

// ── Shared fixture contract ─────────────────────────────────────────────────
// Every adapter app exposes the same validated route. `/items/:id` is here so
// the reported path proves the OpenAPI form (`/items/{id}`) is applied.

const CreateItemBody = z.object({ name: z.string(), qty: z.number() });
const ItemResponse = z.object({ id: z.number(), name: z.string(), qty: z.number() });

const META = { title: 'Heartbeat API', version: '1.0.0' };
const VALID_ITEM = { name: 'Widget', qty: 3 };
const INVALID_ITEM = { name: 42, qty: 'many' };

const HOST = '127.0.0.1';

// ── Test doubles ────────────────────────────────────────────────────────────

/**
 * A drift store that records the heartbeat windows it is handed (Spy).
 * `withHook: false` produces a pre-v1.17 store — one that never implemented
 * the optional method — which is the case the "costs nothing" assertion needs.
 *
 * @param {{ withHook?: boolean }} [options]
 * @returns {any}
 */
function createSpyStore(options) {
  const withHook = !options || options.withHook !== false;
  /** @type {Array<{ entries: any, windowStart: number }>} */
  const windows = [];
  /** @type {any} */
  const store = {
    windows: windows,
    record: function () {},
    report: function () { return { generatedAt: Date.now(), totalIssues: 0, routes: [] }; },
    reset: function () {},
  };
  if (withHook) {
    store.recordHeartbeats = function (entries, windowStart) {
      windows.push({ entries: entries, windowStart: windowStart });
    };
  }
  return store;
}

/**
 * Flatten every window the store saw into `'METHOD /path' -> validatedCount`.
 * @param {any} store
 * @returns {Record<string, number>}
 */
function countsByRoute(store) {
  /** @type {Record<string, number>} */
  const totals = {};
  store.windows.forEach(function (window) {
    window.entries.forEach(function (entry) {
      const key = entry.route.method + ' ' + entry.route.path;
      totals[key] = (totals[key] || 0) + entry.validatedCount;
    });
  });
  return totals;
}

// ── Minimal HTTP client ─────────────────────────────────────────────────────
// `agent: false` gives every request its own socket, so no keep-alive pool
// keeps `node --test` alive after the suite.

/**
 * @param {string} baseUrl
 * @param {string} method
 * @param {string} path
 * @param {any} [body] - JSON-encoded when present
 * @returns {Promise<{ status: number, text: string }>}
 */
function request(baseUrl, method, path, body) {
  return new Promise(function (resolve, reject) {
    const url = new URL(path, baseUrl);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = payload
      ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
      : {};

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method,
        agent: false,
        headers: headers,
      },
      function (res) {
        const chunks = [];
        res.on('data', function (chunk) { chunks.push(chunk); });
        res.on('end', function () {
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * @param {import('http').Server} server
 * @returns {Promise<string>}
 */
function listen(server) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, HOST, function () {
      resolve('http://' + HOST + ':' + server.address().port);
    });
  });
}

/**
 * @param {import('http').Server} server
 * @returns {Promise<void>}
 */
function closeServer(server) {
  return new Promise(function (resolve) { server.close(function () { resolve(); }); });
}

/** Resolve after the current macrotask, letting deferred introspection run. */
function nextTick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

/**
 * A window length no framework would pick for its own housekeeping, so the
 * timer captured below is unambiguously the heartbeat's.
 */
const HEARTBEAT_MS = 7777;

/**
 * The adapter config every builder passes in. `store` is the spy; `heartbeat`
 * is left at its default unless a test wants it off. `sampleRate: 0` keeps the
 * drift pipeline quiet — this suite is about counters, not mismatches.
 *
 * @param {any} store
 * @param {{ heartbeat?: boolean }} [driftExtra]
 * @returns {any}
 */
function adapterConfig(store, driftExtra) {
  return {
    meta: META,
    validate: true,
    drift: Object.assign(
      { store: store, sampleRate: 0, heartbeatIntervalMs: HEARTBEAT_MS },
      driftExtra || {}
    ),
  };
}

/**
 * Run `fn` (an adapter mount) with `setInterval` intercepted, and return the
 * heartbeat window callback it armed — or `null` if it armed none.
 *
 * Only the heartbeat's own interval is intercepted; every other timer the
 * framework sets while booting is passed straight through to the real
 * `setInterval`, so nothing about the app's behaviour changes.
 *
 * @param {function(): Promise<any>} fn
 * @returns {Promise<{ value: any, tick: (function(): void)|null }>}
 */
async function captureHeartbeatTimer(fn) {
  const realSetInterval = global.setInterval;
  /** @type {(function(): void)|null} */
  let tick = null;

  // @ts-ignore - narrower than the real signature on purpose
  global.setInterval = function (handler, ms) {
    if (ms === HEARTBEAT_MS && tick === null) {
      tick = handler;
      return { unref: function () { return this; } };
    }
    return realSetInterval.apply(global, arguments);
  };

  try {
    const value = await fn();
    return { value: value, tick: tick };
  } finally {
    global.setInterval = realSetInterval;
  }
}

// ── Adapter builders (Factory) ──────────────────────────────────────────────
// Each boots the same two-route app and returns the same handle. `config` is
// returned because `config._heartbeat` is what the assertions flush.

/** @returns {Promise<{ baseUrl: string, store: any, config: any, close: function(): Promise<void> }>} */
async function buildExpressApp(store, driftExtra) {
  const express = require('express');
  const { expressAdapter, defineRoute } = require('../src/adapters/express');

  const app = express();
  app.use(express.json());

  app.get('/items/:id', defineRoute(
    function getItem(req, res) { res.json({ id: Number(req.params.id), name: 'Widget', qty: 3 }); },
    { request: { params: z.object({ id: z.string() }) }, response: ItemResponse }
  ));

  app.post('/items', defineRoute(
    function createItem(req, res) { res.status(201).json({ id: 1, name: req.body.name, qty: req.body.qty }); },
    { request: { body: CreateItemBody, query: null }, response: ItemResponse }
  ));

  const config = adapterConfig(store, driftExtra);
  app.use(expressAdapter(app, config));

  const server = http.createServer(app);
  const baseUrl = await listen(server);
  await nextTick();

  return { baseUrl: baseUrl, store: store, close: function () { return closeServer(server); } };
}

/** @returns {Promise<{ baseUrl: string, store: any, config: any, close: function(): Promise<void> }>} */
async function buildFastifyApp(store, driftExtra) {
  const Fastify = require('fastify');
  const { fastifyAdapter, defineRoute } = require('../src/adapters/fastify');

  const app = Fastify();
  const config = adapterConfig(store, driftExtra);
  fastifyAdapter(app, config);

  app.get('/items/:id', defineRoute(
    async function getItem(req) { return { id: Number(req.params.id), name: 'Widget', qty: 3 }; },
    { request: { params: z.object({ id: z.string() }) }, response: ItemResponse }
  ));

  app.post('/items', defineRoute(
    async function createItem(req, reply) {
      reply.status(201);
      return { id: 1, name: req.body.name, qty: req.body.qty };
    },
    { request: { body: CreateItemBody, query: null }, response: ItemResponse }
  ));

  await app.listen({ port: 0, host: HOST });

  return {
    baseUrl: 'http://' + HOST + ':' + app.server.address().port,
    store: store,
    close: function () { return app.close(); },
  };
}

/** @returns {Promise<{ baseUrl: string, store: any, config: any, close: function(): Promise<void> }>} */
async function buildHonoApp(store, driftExtra) {
  const { Hono } = require('hono');
  const { serve } = require('@hono/node-server');
  const { honoAdapter, defineRoute } = require('../src/adapters/hono');

  const app = new Hono();
  const config = adapterConfig(store, driftExtra);
  honoAdapter(app, config);

  app.get('/items/:id', defineRoute(
    function getItem(c) { return c.json({ id: Number(c.req.param('id')), name: 'Widget', qty: 3 }); },
    { request: { params: z.object({ id: z.string() }) }, response: ItemResponse }
  ));

  app.post('/items', defineRoute(
    async function createItem(c) {
      const body = await c.req.json();
      return c.json({ id: 1, name: body.name, qty: body.qty }, 201);
    },
    { request: { body: CreateItemBody, query: null }, response: ItemResponse }
  ));

  const server = await new Promise(function (resolve) {
    const s = serve({ fetch: app.fetch, port: 0, hostname: HOST }, function () { resolve(s); });
  });

  return {
    baseUrl: 'http://' + HOST + ':' + server.address().port,
    store: store,
    close: function () { return closeServer(server); },
  };
}

/** @returns {Promise<{ baseUrl: string, store: any, config: any, close: function(): Promise<void> }>} */
async function buildKoaApp(store, driftExtra) {
  const Koa = require('koa');
  const Router = require('@koa/router');
  const { bodyParser } = require('@koa/bodyparser');
  const { koaAdapter, defineRoute } = require('../src/adapters/koa');

  const app = new Koa();
  app.silent = true;
  const router = new Router();

  app.use(bodyParser());
  const config = adapterConfig(store, driftExtra);
  koaAdapter(router, config);

  router.get('/items/:id', defineRoute(
    async function getItem(ctx) { ctx.body = { id: Number(ctx.params.id), name: 'Widget', qty: 3 }; },
    { request: { params: z.object({ id: z.string() }) }, response: ItemResponse }
  ));

  router.post('/items', defineRoute(
    async function createItem(ctx) {
      const body = ctx.request.body;
      ctx.status = 201;
      ctx.body = { id: 1, name: body.name, qty: body.qty };
    },
    { request: { body: CreateItemBody, query: null }, response: ItemResponse }
  ));

  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = http.createServer(app.callback());
  const baseUrl = await listen(server);

  return { baseUrl: baseUrl, store: store, close: function () { return closeServer(server); } };
}

/** @returns {Promise<{ baseUrl: string, store: any, config: any, close: function(): Promise<void> }>} */
async function buildNestApp(store, driftExtra) {
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { Controller, Get, Post, Module } = require('@nestjs/common');
  const { nestAdapter, DocRoute } = require('../src/adapters/nest');

  // Decorators applied by hand: this suite stays CommonJS, and the decorator
  // factories are plain functions over `Reflect.defineMetadata`.
  class ItemsController {
    getItem() { return { id: 1, name: 'Widget', qty: 3 }; }
    createItem() { return { id: 1, name: VALID_ITEM.name, qty: VALID_ITEM.qty }; }
  }

  function decorate(name, decorators) {
    const proto = ItemsController.prototype;
    for (let i = 0; i < decorators.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      decorators[i](proto, name, descriptor);
    }
  }

  decorate('getItem', [
    Get(':id'),
    DocRoute({ request: { params: z.object({ id: z.string() }) }, response: ItemResponse }),
  ]);
  decorate('createItem', [
    Post(),
    DocRoute({ request: { body: CreateItemBody } }),
  ]);

  Controller('items')(ItemsController);

  class AppModule {}
  Module({ controllers: [ItemsController] })(AppModule);

  const app = await NestFactory.create(AppModule, { logger: false });
  const config = adapterConfig(store, driftExtra);
  nestAdapter(app, config);
  await app.listen(0, HOST);

  return {
    baseUrl: 'http://' + HOST + ':' + app.getHttpServer().address().port,
    store: store,
    close: function () { return app.close(); },
  };
}

const BUILDERS = {
  express: buildExpressApp,
  fastify: buildFastifyApp,
  hono: buildHonoApp,
  koa: buildKoaApp,
  nest: buildNestApp,
};


/**
 * Boot one adapter and hand back the app plus its heartbeat window callback.
 *
 * @param {string} adapter
 * @param {any} store
 * @param {{ heartbeat?: boolean }} [driftExtra]
 * @returns {Promise<{ app: any, tick: (function(): void)|null }>}
 */
async function boot(adapter, store, driftExtra) {
  const captured = await captureHeartbeatTimer(function () {
    return BUILDERS[adapter](store, driftExtra);
  });
  return { app: captured.value, tick: captured.tick };
}

// ── The shared assertions, run against every adapter ────────────────────────

Object.keys(BUILDERS).forEach(function (adapter) {
  test.describe(adapter + ' adapter heartbeats', function () {
    test.it('counts validated requests per route and reports them when the window closes', async function () {
      const store = createSpyStore();
      const { app, tick } = await boot(adapter, store);
      try {
        assert.equal(typeof tick, 'function', 'the mount armed a heartbeat window');

        for (let i = 0; i < 3; i++) {
          const res = await request(app.baseUrl, 'POST', '/items', VALID_ITEM);
          assert.equal(res.status, 201, 'a conforming body reaches the handler');
        }
        const one = await request(app.baseUrl, 'GET', '/items/7');
        assert.equal(one.status, 200);

        assert.equal(store.windows.length, 0, 'nothing is reported before the window closes');
        tick();

        assert.equal(store.windows.length, 1, 'one window, one call');
        assert.equal(typeof store.windows[0].windowStart, 'number');

        const totals = countsByRoute(store);
        assert.equal(totals['POST /items'], 3, 'three validated POSTs: ' + JSON.stringify(totals));
        // Reported in OpenAPI path form, so it joins the startup route inventory.
        assert.equal(totals['GET /items/{id}'], 1, 'the params-only route counts too: ' + JSON.stringify(totals));

        // The window was emptied, not merely copied.
        tick();
        assert.equal(store.windows.length, 1, 'an empty window is not reported');
      } finally {
        await app.close();
      }
    });

    test.it('does not count a request that was answered with 422', async function () {
      const store = createSpyStore();
      const { app, tick } = await boot(adapter, store);
      try {
        const ok = await request(app.baseUrl, 'POST', '/items', VALID_ITEM);
        assert.equal(ok.status, 201);

        for (let i = 0; i < 4; i++) {
          const bad = await request(app.baseUrl, 'POST', '/items', INVALID_ITEM);
          assert.equal(bad.status, 422);
        }

        tick();

        const totals = countsByRoute(store);
        assert.equal(totals['POST /items'], 1, 'only the accepted request counts: ' + JSON.stringify(totals));
      } finally {
        await app.close();
      }
    });

    test.it('arms nothing when drift.heartbeat is false', async function () {
      const store = createSpyStore();
      const { app, tick } = await boot(adapter, store, { heartbeat: false });
      try {
        assert.equal(tick, null, 'no window timer was armed');

        const res = await request(app.baseUrl, 'POST', '/items', VALID_ITEM);
        assert.equal(res.status, 201, 'the application is unaffected');
        assert.equal(store.windows.length, 0, 'and nothing is ever reported');
      } finally {
        await app.close();
      }
    });

    test.it('costs nothing for a store that never implemented recordHeartbeats', async function () {
      const store = createSpyStore({ withHook: false });
      const { app, tick } = await boot(adapter, store);
      try {
        assert.equal(typeof store.recordHeartbeats, 'undefined');
        // Not "counted then discarded" — never counted. No timer means the
        // disabled instance was returned, so `hit` is a no-op and no Map exists
        // to grow. This is what keeps the hot path free for pre-v1.17 users.
        assert.equal(tick, null, 'the optional hook is absent, so counting never starts');

        for (let i = 0; i < 5; i++) {
          const res = await request(app.baseUrl, 'POST', '/items', VALID_ITEM);
          assert.equal(res.status, 201);
        }
        assert.equal(store.windows.length, 0);
      } finally {
        await app.close();
      }
    });
  });
});
