'use strict';

/**
 * Cross-adapter smoke suite (T000).
 *
 * The library ships five adapters — express, fastify, hono, koa, nest — that
 * share one core (`src/index.js`, `src/internal/validate.js`,
 * `src/exporters/openapi.js`, `src/ui/index.js`). Any change to that core, or
 * to a single adapter, is expected to keep four things true everywhere:
 *
 *   1. Mount        — a minimal app boots with the adapter installed.
 *   2. Docs         — `GET /docs` returns 200 and an HTML body.
 *   3. OpenAPI      — `GET /docs/openapi.json` returns a valid 3.1 document
 *                     whose `paths` contains the app's own routes.
 *   4. Validation   — with `validate: true`, a body that violates the declared
 *                     Zod schema is answered with 422 + a structured `issues`
 *                     array, and the handler never runs.
 *
 * This file is the net under those four invariants. It deliberately contains no
 * unit tests: per-feature depth (drift, codegen, mock, flows) lives with the
 * task that owns the feature.
 *
 * Each adapter is set up by a builder in `BUILDERS` (Factory pattern) — the
 * five framework-specific mounting differences are collected in one place, and
 * every builder returns the same `{ baseUrl, close }` handle so the four
 * assertions below are written once and parametrised.
 *
 * Servers bind port 0 (kernel-assigned) and are closed in `after`, so the suite
 * is safe to run twice concurrently and leaves no open handle behind.
 *
 * Run: node --test test/adapters-smoke.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { z } = require('zod');

// ── Shared fixture contract ─────────────────────────────────────────────────
// Every adapter app exposes the same two routes so one set of assertions fits
// all five. `POST /items` is the validated route.

const CreateItemBody = z.object({
  name: z.string(),
  qty: z.number(),
});

const ItemResponse = z.object({
  id: z.number(),
  name: z.string(),
  qty: z.number(),
});

const ItemListResponse = z.object({
  items: z.array(ItemResponse),
  total: z.number(),
});

const META = { title: 'Smoke API', version: '9.9.9', description: 'Adapter smoke fixture.' };

const ITEM_LIST = { items: [{ id: 1, name: 'Widget', qty: 3 }], total: 1 };
const VALID_ITEM = { name: 'Widget', qty: 3 };

/** Violates both declared fields: `name` is not a string, `qty` is not a number. */
const INVALID_ITEM = { name: 42, qty: 'many' };

const HOST = '127.0.0.1';

// ── Minimal HTTP client ─────────────────────────────────────────────────────
// `agent: false` gives every request its own socket and closes it on response
// end, so no keep-alive pool keeps `node --test` alive after the suite.

/**
 * @param {string} baseUrl
 * @param {string} method
 * @param {string} path
 * @param {any} [body] - JSON-encoded when present
 * @returns {Promise<{ status: number, headers: object, text: string, json: function(): any }>}
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
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: text,
            json: function () { return JSON.parse(text); },
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Listen on a kernel-assigned port and resolve the resulting base URL.
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

// ── Adapter builders (Factory) ──────────────────────────────────────────────
// One entry per adapter. Each boots a two-route app with `validate: true` and
// the default `docsPath` ('/docs'), then returns `{ baseUrl, close }`.

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildExpressApp() {
  const express = require('express');
  const { expressAdapter, defineRoute } = require('../src/adapters/express');

  const app = express();
  app.use(express.json());

  app.get('/items', defineRoute(
    function listItems(_req, res) { res.json(ITEM_LIST); },
    { request: { body: null, query: null }, response: ItemListResponse }
  ));

  app.post('/items', defineRoute(
    function createItem(req, res) { res.status(201).json({ id: 1, name: req.body.name, qty: req.body.qty }); },
    { request: { body: CreateItemBody, query: null }, response: ItemResponse }
  ));

  // Express mounts the docs middleware AFTER the routes it documents.
  app.use(expressAdapter(app, { meta: META, validate: true }));

  const server = http.createServer(app);
  const baseUrl = await listen(server);
  // The adapter defers handler wrapping to setImmediate so that routes added in
  // the same synchronous block are all visible; wait for that pass.
  await nextTick();

  return { baseUrl: baseUrl, close: function () { return closeServer(server); } };
}

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildFastifyApp() {
  const Fastify = require('fastify');
  const { fastifyAdapter, defineRoute } = require('../src/adapters/fastify');

  const app = Fastify();
  // Fastify's onRoute hook must be installed before the routes are registered.
  fastifyAdapter(app, { meta: META, validate: true });

  app.get('/items', defineRoute(
    async function listItems() { return ITEM_LIST; },
    { request: { body: null, query: null }, response: ItemListResponse }
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
    close: function () { return app.close(); },
  };
}

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildHonoApp() {
  const { Hono } = require('hono');
  const { serve } = require('@hono/node-server');
  const { honoAdapter, defineRoute } = require('../src/adapters/hono');

  const app = new Hono();
  // Hono does not retro-apply wildcard middleware, so the adapter's validation
  // hook must be registered before the routes it guards.
  honoAdapter(app, { meta: META, validate: true });

  app.get('/items', defineRoute(
    function listItems(c) { return c.json(ITEM_LIST); },
    { request: { body: null, query: null }, response: ItemListResponse }
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
    close: function () { return closeServer(server); },
  };
}

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildKoaApp() {
  const Koa = require('koa');
  const Router = require('@koa/router');
  const { bodyParser } = require('@koa/bodyparser');
  const { koaAdapter, defineRoute } = require('../src/adapters/koa');

  const app = new Koa();
  app.silent = true; // don't print handler errors to stderr during the run
  const router = new Router();

  app.use(bodyParser());
  // @koa/router does not retro-apply router-level middleware either.
  koaAdapter(router, { meta: META, validate: true });

  router.get('/items', defineRoute(
    async function listItems(ctx) { ctx.body = ITEM_LIST; },
    { request: { body: null, query: null }, response: ItemListResponse }
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

  return { baseUrl: baseUrl, close: function () { return closeServer(server); } };
}

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildNestApp() {
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { Controller, Get, Post, Module } = require('@nestjs/common');
  const { nestAdapter, DocRoute } = require('../src/adapters/nest');

  // NestJS route metadata normally comes from TypeScript decorators. This suite
  // stays CommonJS, so the same decorator factories are applied by hand — they
  // are plain functions over `Reflect.defineMetadata`, with identical effect.
  class ItemsController {
    listItems() { return ITEM_LIST; }
    createItem() { return { id: 1, name: VALID_ITEM.name, qty: VALID_ITEM.qty }; }
  }

  /** Apply a method decorator to `ItemsController.prototype[name]`. */
  function decorate(name, decorators) {
    const proto = ItemsController.prototype;
    for (let i = 0; i < decorators.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      decorators[i](proto, name, descriptor);
    }
  }

  decorate('listItems', [
    Get(),
    DocRoute({ request: { body: null, query: null }, response: ItemListResponse }),
  ]);
  decorate('createItem', [
    Post(),
    DocRoute({ request: { body: CreateItemBody }, response: ItemResponse }),
  ]);

  Controller('items')(ItemsController);

  class AppModule {}
  Module({ controllers: [ItemsController] })(AppModule);

  const app = await NestFactory.create(AppModule, { logger: false });
  nestAdapter(app, { meta: META, validate: true });
  await app.listen(0, HOST);

  return {
    baseUrl: 'http://' + HOST + ':' + app.getHttpServer().address().port,
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

// ── The four shared assertions, run against every adapter ───────────────────

Object.keys(BUILDERS).forEach(function (adapter) {
  test.describe(adapter + ' adapter', function () {
    /** @type {{ baseUrl: string, close: function(): Promise<void> }} */
    let app;

    test.before(async function () { app = await BUILDERS[adapter](); });
    test.after(async function () { if (app) await app.close(); });

    // 1. Mount — the app boots with the adapter installed and still serves its
    //    own routes (the adapter must not shadow or break user routes).
    test.it('mounts without disturbing the application routes', async function () {
      assert.match(app.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
      const res = await request(app.baseUrl, 'GET', '/items');
      assert.equal(res.status, 200);
      assert.deepEqual(res.json(), ITEM_LIST);
    });

    // 2. Docs — GET /docs is 200 HTML.
    test.it('serves the docs UI at GET /docs', async function () {
      const res = await request(app.baseUrl, 'GET', '/docs');
      assert.equal(res.status, 200);
      assert.match(String(res.headers['content-type'] || ''), /text\/html/);
      assert.match(res.text, /<html/i);
      assert.ok(res.text.includes(META.title), 'docs HTML carries the configured title');
    });

    // 3. OpenAPI — GET /docs/openapi.json is a valid 3.1 document listing the
    //    app's routes.
    test.it('exports a valid OpenAPI 3.1 document at GET /docs/openapi.json', async function () {
      const res = await request(app.baseUrl, 'GET', '/docs/openapi.json');
      assert.equal(res.status, 200);

      let doc;
      assert.doesNotThrow(function () { doc = res.json(); }, 'openapi.json is parseable JSON');

      assert.match(doc.openapi, /^3\.1/);
      assert.equal(doc.info.title, META.title);
      assert.equal(doc.info.version, META.version);
      assert.ok(doc.paths && Object.keys(doc.paths).length > 0, 'paths is not empty');
      assert.ok(doc.paths['/items'], 'the documented route appears in paths');
      assert.ok(doc.paths['/items'].get, 'GET /items is documented');
      assert.ok(doc.paths['/items'].post, 'POST /items is documented');
    });

    // 4. Validation — a body that violates the declared Zod schema is rejected
    //    with 422 and a structured issue list; the handler is never reached.
    test.it('rejects a schema-violating body with 422 and structured issues', async function () {
      const ok = await request(app.baseUrl, 'POST', '/items', VALID_ITEM);
      assert.equal(ok.status, 201, 'a conforming body still reaches the handler');

      const res = await request(app.baseUrl, 'POST', '/items', INVALID_ITEM);
      assert.equal(res.status, 422);

      const body = res.json();
      assert.equal(body.error, 'validation_failed');
      assert.ok(Array.isArray(body.issues), 'issues is an array');
      assert.ok(body.issues.length > 0, 'issues is not empty');

      body.issues.forEach(function (issue) {
        assert.equal(typeof issue.path, 'string');
        assert.equal(typeof issue.message, 'string');
        assert.equal(typeof issue.code, 'string');
      });

      const paths = body.issues.map(function (i) { return i.path; });
      assert.ok(paths.indexOf('body.name') !== -1, 'names the offending body field: ' + paths.join(', '));
      assert.ok(paths.indexOf('body.qty') !== -1, 'reports every offending field: ' + paths.join(', '));
    });
  });
});
