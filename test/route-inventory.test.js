'use strict';

/**
 * Startup route inventory (T005).
 *
 * When an adapter mounts, it tells the drift store which routes exist —
 * `store.announceRoutes(routes, meta)`, once. The point is coverage: a route
 * that has never been called still exists, and a consumer that only ever sees
 * drift events would never learn about it.
 *
 * All five adapters delegate to one helper (`announceToStore` in
 * `src/internal/drift.js`), so the contract is asserted once and run against
 * every adapter:
 *
 *   1. Content   — every visible route, upper-case method, OpenAPI path form
 *                  (`/items/{id}`, not `/items/:id`), and no other fields.
 *   2. Prose     — description, header purposes and every declared error
 *                  (v1.19). Through v1.18 the inventory carried the *contract*
 *                  projection, which drops all three by design.
 *   3. Bodies    — example bodies are the one thing v1.19 still withholds.
 *   4. Wire      — what the store receives survives `JSON.stringify`; a live
 *                  Zod object here would fail inside user code and be swallowed.
 *   5. Hidden    — a route marked `hidden` never appears.
 *   6. Optional  — a store without `announceRoutes` is not called, silently.
 *   7. Fail-open — a hook that throws does not disturb the application.
 *   8. Disabled  — drift off means no announcement.
 *   9. Hashes    — `meta` carries `contractHash` / `docHash` over exactly the
 *                  announced routes (v1.17), so a store reports the real
 *                  contract instead of fingerprinting the route list.
 *
 * Adapter setup mirrors `adapters-smoke.test.js`: one builder per framework
 * (Factory), each returning the same handle. Servers are only started for the
 * fail-open case, which is the one assertion that needs live traffic to be
 * meaningful; the rest read the store directly.
 *
 * Run: node --test test/route-inventory.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { z } = require('zod');

const { createDriftPipeline, announceToStore } = require('../src/internal/drift');
// Through the package entry point on purpose: this is the function a real
// store reaches for, and the hash it recomputes must equal the announced one.
const { computeSpecHashes } = require('doctreen');

const HOST = '127.0.0.1';

const META = { title: 'Inventory API', version: '4.2.0', description: 'never announced' };

/**
 * The four routes every adapter fixture registers. The fourth is hidden, so
 * the announced inventory must be the first three — in OpenAPI path form.
 */
const EXPECTED = ['GET /items', 'GET /items/{id}', 'POST /items'];

/**
 * The definition attached to `POST /items` in every fixture — one route
 * carrying every kind of thing a route definition can hold, so the five
 * adapters are asked the same question about all of them at once.
 *
 * Four of these five fields are the whole of v1.19. Through v1.18 the
 * inventory announced the *contract* projection, which is prose-free by
 * design because `contractHash` is taken over it, so:
 *
 *   - `description` was dropped;
 *   - `headers` was reduced to a bare list of names, losing what each is for;
 *   - `errors[401]`, declared with a description and no schema, was dropped
 *     whole — the page could not even say the status exists;
 *   - `errors[422]`, declared WITH a schema, was the one that always survived.
 *
 * The fifth is the line v1.19 does not cross: `examples` holds a request
 * *body*, and the inventory leaves the process.
 */
const DOCUMENTED = {
  description: 'Create an item on behalf of the current customer.',
  headers: { 'x-idempotency-key': 'a ULID unique to this attempt' },
  errors: { 401: 'Unauthorized', 422: z.object({ field: z.string() }) },
  examples: { request: { name: 'a widget', price: 9.99 } },
};

// ── Test doubles ────────────────────────────────────────────────────────────

/**
 * A drift store that records what it was told (Spy). `announceRoutes` is
 * passed in rather than fixed so the same double covers the "store without
 * the hook" and "hook throws" cases.
 *
 * @param {Function|null} [announceRoutes] - omitted from the store when null
 * @returns {{ calls: Array<{ routes: any, meta: any }>, record: Function, report: Function, reset: Function, announceRoutes?: Function }}
 */
function createSpyStore(announceRoutes) {
  /** @type {Array<{ routes: any, meta: any }>} */
  const calls = [];

  /** @type {any} */
  const store = {
    calls: calls,
    // `record` is what makes the pipeline accept this object as a store at all.
    record: function () {},
    report: function () { return { generatedAt: Date.now(), totalIssues: 0, routes: [] }; },
    reset: function () {},
  };

  if (announceRoutes !== null) {
    store.announceRoutes = function (routes, meta) {
      calls.push({ routes: routes, meta: meta });
      if (typeof announceRoutes === 'function') announceRoutes(routes, meta);
    };
  }

  return store;
}

/** `'GET /items'`-style keys, sorted, for order-independent comparison. */
function keysOf(routes) {
  return routes.map(function (r) { return r.method + ' ' + r.path; }).sort();
}

/**
 * The announced `schema` for one route of the first (and only) announcement.
 * Fails loudly rather than returning undefined, so a missing route reads as a
 * missing route instead of a pile of `cannot read property of undefined`.
 *
 * @param {{ calls: Array<{ routes: any }> }} store
 * @param {string} key - `'POST /items'`
 * @returns {any}
 */
function announced(store, key) {
  const routes = (store.calls[0] || {}).routes || [];
  const match = routes.filter(function (r) { return r.method + ' ' + r.path === key; })[0];
  assert.ok(match, key + ' was not announced; got ' + keysOf(routes).join(', '));
  assert.ok(match.schema, key + ' was announced without a schema');
  return match.schema;
}

/** Build the drift config block for a spy store. */
function driftConfig(store, enabled) {
  return {
    enabled: enabled !== false,
    store: store,
    logLevel: 'silent',
    sampleRate: 0,
  };
}

/** Capture console.warn/error for the duration of `fn`. */
async function withConsoleCapture(fn) {
  const lines = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  console.error = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try {
    await fn();
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
  return lines;
}

// ── HTTP helpers (only used by the fail-open case) ──────────────────────────

function listen(server) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, HOST, function () {
      resolve('http://' + HOST + ':' + server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise(function (resolve) { server.close(function () { resolve(); }); });
}

/** GET a URL and resolve its status code. */
function getStatus(url) {
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', agent: false },
      function (res) {
        res.resume();
        res.on('end', function () { resolve(res.statusCode); });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** Resolve after the current macrotask, letting deferred introspection run. */
function nextTick() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

// ── Adapter builders (Factory) ──────────────────────────────────────────────
// Each registers the same four routes, mounts the adapter with the given drift
// config, waits for the announcement window to pass, and returns a handle.
// `listen: true` additionally boots a server and fills in `baseUrl`.

/** @typedef {{ drift: object, listen?: boolean }} MountOptions */
/** @typedef {Promise<{ baseUrl?: string, close: function(): Promise<void> }>} MountResult */

/** @param {MountOptions} opts @returns {MountResult} */
async function mountExpress(opts) {
  const express = require('express');
  const { expressAdapter, defineRoute } = require('../src/adapters/express');

  const app = express();
  // A fresh function per route: `defineRoute` stores the schema on the handler
  // object itself, so a shared handler would carry the last route's metadata.
  const ok = function () { return function (_req, res) { res.json({ ok: true }); }; };

  app.get('/items', defineRoute(ok(), {}));
  app.post('/items', defineRoute(ok(), DOCUMENTED));
  app.get('/items/:id', defineRoute(ok(), {}));
  app.get('/internal/health', defineRoute(ok(), { hidden: true }));

  app.use(expressAdapter(app, { meta: META, drift: opts.drift }));

  let server = null;
  let baseUrl;
  if (opts.listen) {
    server = http.createServer(app);
    baseUrl = await listen(server);
  }
  // The adapter introspects and announces from a setImmediate callback.
  await nextTick();

  return {
    baseUrl: baseUrl,
    close: function () { return server ? closeServer(server) : Promise.resolve(); },
  };
}

/** @param {MountOptions} opts @returns {MountResult} */
async function mountFastify(opts) {
  const Fastify = require('fastify');
  const { fastifyAdapter, defineRoute } = require('../src/adapters/fastify');

  const app = Fastify();
  fastifyAdapter(app, { meta: META, drift: opts.drift });

  const ok = function () { return async function () { return { ok: true }; }; };
  app.get('/items', defineRoute(ok(), {}));
  app.post('/items', defineRoute(ok(), DOCUMENTED));
  app.get('/items/:id', defineRoute(ok(), {}));
  app.get('/internal/health', defineRoute(ok(), { hidden: true }));

  // Fastify announces from `onReady`, which both listen() and ready() trigger.
  let baseUrl;
  if (opts.listen) {
    await app.listen({ port: 0, host: HOST });
    baseUrl = 'http://' + HOST + ':' + app.server.address().port;
  } else {
    await app.ready();
  }

  return { baseUrl: baseUrl, close: function () { return app.close(); } };
}

/** @param {MountOptions} opts @returns {MountResult} */
async function mountHono(opts) {
  const { Hono } = require('hono');
  const { honoAdapter, defineRoute } = require('../src/adapters/hono');

  const app = new Hono();
  honoAdapter(app, { meta: META, drift: opts.drift });

  const ok = function () { return function (c) { return c.json({ ok: true }); }; };
  app.get('/items', defineRoute(ok(), {}));
  app.post('/items', defineRoute(ok(), DOCUMENTED));
  app.get('/items/:id', defineRoute(ok(), {}));
  app.get('/internal/health', defineRoute(ok(), { hidden: true }));

  let server = null;
  let baseUrl;
  if (opts.listen) {
    const { serve } = require('@hono/node-server');
    server = await new Promise(function (resolve) {
      const s = serve({ fetch: app.fetch, port: 0, hostname: HOST }, function () { resolve(s); });
    });
    baseUrl = 'http://' + HOST + ':' + server.address().port;
  }
  await nextTick();

  return {
    baseUrl: baseUrl,
    close: function () { return server ? closeServer(server) : Promise.resolve(); },
  };
}

/** @param {MountOptions} opts @returns {MountResult} */
async function mountKoa(opts) {
  const Koa = require('koa');
  const Router = require('@koa/router');
  const { koaAdapter, defineRoute } = require('../src/adapters/koa');

  const app = new Koa();
  app.silent = true;
  const router = new Router();

  koaAdapter(router, { meta: META, drift: opts.drift });

  const ok = function () { return async function (ctx) { ctx.body = { ok: true }; }; };
  router.get('/items', defineRoute(ok(), {}));
  router.post('/items', defineRoute(ok(), DOCUMENTED));
  router.get('/items/:id', defineRoute(ok(), {}));
  router.get('/internal/health', defineRoute(ok(), { hidden: true }));

  app.use(router.routes());
  app.use(router.allowedMethods());

  let server = null;
  let baseUrl;
  if (opts.listen) {
    server = http.createServer(app.callback());
    baseUrl = await listen(server);
  }
  await nextTick();

  return {
    baseUrl: baseUrl,
    close: function () { return server ? closeServer(server) : Promise.resolve(); },
  };
}

/** @param {MountOptions} opts @returns {MountResult} */
async function mountNest(opts) {
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { Controller, Get, Post, Module } = require('@nestjs/common');
  const { nestAdapter, DocRoute } = require('../src/adapters/nest');

  // As in the smoke suite: this file is CommonJS, so the decorator factories
  // are applied by hand. A fresh class per mount keeps the metadata isolated.
  class ItemsController {
    listItems() { return { ok: true }; }
    createItem() { return { ok: true }; }
    getItem() { return { ok: true }; }
    health() { return { ok: true }; }
  }

  function decorate(name, decorators) {
    const proto = ItemsController.prototype;
    for (let i = 0; i < decorators.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      decorators[i](proto, name, descriptor);
    }
  }

  decorate('listItems', [Get(), DocRoute({})]);
  decorate('createItem', [Post(), DocRoute(DOCUMENTED)]);
  decorate('getItem', [Get(':id'), DocRoute({})]);
  decorate('health', [Get('health'), DocRoute({ hidden: true })]);

  Controller('items')(ItemsController);

  class AppModule {}
  Module({ controllers: [ItemsController] })(AppModule);

  const app = await NestFactory.create(AppModule, { logger: false });
  nestAdapter(app, { meta: META, drift: opts.drift });

  let baseUrl;
  if (opts.listen) {
    await app.listen(0, HOST);
    baseUrl = 'http://' + HOST + ':' + app.getHttpServer().address().port;
  }
  await nextTick();

  return { baseUrl: baseUrl, close: function () { return app.close(); } };
}

const BUILDERS = {
  express: mountExpress,
  fastify: mountFastify,
  hono: mountHono,
  koa: mountKoa,
  nest: mountNest,
};

// Nest's fixture route is `/items/health`, not `/internal/health` — controller
// paths are always prefixed. Either way it must not reach the inventory.
const HIDDEN_KEYS = ['GET /internal/health', 'GET /items/health'];

// ── The shared contract, run against every adapter ──────────────────────────

Object.keys(BUILDERS).forEach(function (adapter) {
  test.describe(adapter + ' route inventory', function () {
    test.it('announces every visible route exactly once, with its contract as data', async function () {
      const store = createSpyStore();
      const app = await BUILDERS[adapter]({ drift: driftConfig(store) });

      try {
        assert.equal(store.calls.length, 1, 'announceRoutes is called exactly once');

        const call = store.calls[0];
        assert.deepEqual(keysOf(call.routes), EXPECTED);

        // v1.18: each entry is method + path + the route's contract as data. No handlers, no
        // live Zod objects — see the `announce` projection assertions below for what is in it.
        call.routes.forEach(function (route) {
          assert.deepEqual(Object.keys(route).sort(), ['method', 'path', 'schema']);
          assert.equal(route.method, route.method.toUpperCase());
          assert.equal(typeof route.schema, 'object');
        });

        // `description` is configured but must not travel with the inventory;
        // the two spec hashes do (v1.17), from every one of the five adapters.
        assert.deepEqual(Object.keys(call.meta).sort(), ['contractHash', 'docHash', 'title', 'version']);
        assert.equal(call.meta.title, META.title);
        assert.equal(call.meta.version, META.version);
        assert.match(call.meta.contractHash, /^sha256:[0-9a-f]{64}$/);
        assert.match(call.meta.docHash, /^sha256:[0-9a-f]{64}$/);
      } finally {
        await app.close();
      }
    });

    test.it('announces the prose a reader needs: description, header purposes, every error', async function () {
      const store = createSpyStore();
      const app = await BUILDERS[adapter]({ drift: driftConfig(store) });

      try {
        const schema = announced(store, 'POST /items');

        assert.equal(schema.description, DOCUMENTED.description);

        // The *purpose* of each header, not just its name. The contract projection reduced this
        // to `['x-idempotency-key']`, which tells a reader nothing they could act on.
        assert.deepEqual(schema.requestHeaders, DOCUMENTED.headers);

        // Both declared errors, including the one with no schema. Through v1.18 this array held
        // only the 422 — a page could not say that a 401 was even possible.
        const errors = schema.errors.slice().sort(function (a, b) { return a.status - b.status; });
        assert.deepEqual(errors.map(function (e) { return e.status; }), [401, 422]);
        assert.equal(errors[0].description, 'Unauthorized');
        assert.equal(errors[0].schema, null, 'a description-only error declares no body');
        assert.equal(errors[1].schema.type, 'object', 'the schema-carrying error keeps its schema');
        assert.deepEqual(Object.keys(errors[1].schema.properties), ['field']);
      } finally {
        await app.close();
      }
    });

    test.it('does not announce example bodies', async function () {
      const store = createSpyStore();
      const app = await BUILDERS[adapter]({ drift: driftConfig(store) });

      try {
        const schema = announced(store, 'POST /items');

        assert.ok(!('examples' in schema), 'examples must not cross the process boundary');
        assert.ok(!('example' in schema));

        // Belt and braces: the value inside the bag must not appear anywhere in the announcement,
        // however it were nested. A key-name check alone would miss a future field that inlines it.
        const wire = JSON.stringify(store.calls[0].routes);
        assert.ok(wire.indexOf('a widget') === -1, 'an example body leaked into the inventory');
      } finally {
        await app.close();
      }
    });

    test.it('announces something a store can serialise', async function () {
      const store = createSpyStore();
      const app = await BUILDERS[adapter]({ drift: driftConfig(store) });

      try {
        // The reason this matters is not tidiness: a store that cannot stringify what it was
        // handed throws inside `announceRoutes`, and `announceToStore` swallows that — so the
        // symptom would be a silently empty inventory, not an error anyone sees.
        const wire = JSON.stringify(store.calls[0].routes);
        assert.deepEqual(keysOf(JSON.parse(wire)), EXPECTED);
        assert.ok(wire.indexOf('_def') === -1, 'a live Zod object reached the wire');
      } finally {
        await app.close();
      }
    });

    test.it('uses the OpenAPI path form for parameters', async function () {
      const store = createSpyStore();
      const app = await BUILDERS[adapter]({ drift: driftConfig(store) });

      try {
        const paths = store.calls[0].routes.map(function (r) { return r.path; });
        assert.ok(paths.indexOf('/items/{id}') !== -1, 'announced ' + paths.join(', '));
        assert.ok(paths.indexOf('/items/:id') === -1, 'the raw framework form is not announced');
      } finally {
        await app.close();
      }
    });

    test.it('leaves hidden routes out of the inventory', async function () {
      const store = createSpyStore();
      const app = await BUILDERS[adapter]({ drift: driftConfig(store) });

      try {
        const announced = keysOf(store.calls[0].routes);
        HIDDEN_KEYS.forEach(function (key) {
          assert.ok(announced.indexOf(key) === -1, key + ' must stay out of the inventory');
        });
      } finally {
        await app.close();
      }
    });

    test.it('says nothing to a store that does not implement announceRoutes', async function () {
      const store = createSpyStore(null);
      assert.equal(typeof store.announceRoutes, 'undefined');

      let app;
      const output = await withConsoleCapture(async function () {
        app = await BUILDERS[adapter]({ drift: driftConfig(store) });
      });

      try {
        assert.equal(store.calls.length, 0);
        assert.deepEqual(output, [], 'no warning or error is produced');
      } finally {
        await app.close();
      }
    });

    test.it('swallows a throwing hook and keeps serving requests', async function () {
      const store = createSpyStore(function () {
        throw new Error('store is on fire');
      });

      const app = await BUILDERS[adapter]({ drift: driftConfig(store), listen: true });

      try {
        assert.equal(store.calls.length, 1, 'the hook was reached');
        assert.equal(await getStatus(app.baseUrl + '/items'), 200, 'the application still answers');
      } finally {
        await app.close();
      }
    });

    test.it('announces nothing when drift is disabled', async function () {
      const store = createSpyStore();
      const app = await BUILDERS[adapter]({ drift: driftConfig(store, false) });

      try {
        assert.equal(store.calls.length, 0);
      } finally {
        await app.close();
      }
    });
  });
});

// ── Helper-level cases the adapters cannot reach ────────────────────────────

test.describe('announceToStore', function () {
  const ROUTES = [{ method: 'GET', path: '/things' }];

  test.it('announces once no matter how often an adapter calls in', function () {
    const store = createSpyStore();
    const pipeline = createDriftPipeline({ drift: driftConfig(store) });

    announceToStore(pipeline, ROUTES, META);
    announceToStore(pipeline, ROUTES, META);
    announceToStore(pipeline, ROUTES, META);

    assert.equal(store.calls.length, 1);
  });

  test.it('skips an empty inventory and stays open to a later, populated one', function () {
    const store = createSpyStore();
    const pipeline = createDriftPipeline({ drift: driftConfig(store) });

    // Introspection ran before any route was registered.
    announceToStore(pipeline, [], META);
    assert.equal(store.calls.length, 0, 'an empty inventory is not worth announcing');

    // …and the routes showed up afterwards.
    announceToStore(pipeline, ROUTES, META);
    assert.equal(store.calls.length, 1, 'the later call still lands');
    // v1.18: the entries gain the canonical contract projection beside method + path.
    assert.deepEqual(
      store.calls[0].routes,
      ROUTES.map(function (route) {
        return { method: route.method, path: route.path, schema: {} };
      }),
    );
  });

  test.it('does not let a rejected promise escape into the process', async function () {
    const store = createSpyStore();
    store.announceRoutes = function () { return Promise.reject(new Error('network down')); };
    const pipeline = createDriftPipeline({ drift: driftConfig(store) });

    let unhandled = null;
    const onUnhandled = function (err) { unhandled = err; };
    process.on('unhandledRejection', onUnhandled);

    try {
      announceToStore(pipeline, ROUTES, META);
      // Give the microtask queue a turn plus a macrotask; an unhandled
      // rejection would be reported by now.
      await new Promise(function (resolve) { setTimeout(resolve, 10); });
      assert.equal(unhandled, null);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  test.it('drops the docsPath subtree, as the OpenAPI export does', function () {
    const store = createSpyStore();
    const pipeline = createDriftPipeline({ drift: driftConfig(store) });

    announceToStore(
      pipeline,
      [
        { method: 'GET', path: '/items' },
        { method: 'GET', path: '/docs' },
        { method: 'GET', path: '/docs/openapi.json' },
      ],
      META,
      '/docs'
    );

    assert.deepEqual(keysOf(store.calls[0].routes), ['GET /items']);
  });
});

// ── Spec hashes on the inventory meta ───────────────────────────────────────

/**
 * The inventory answers "which routes exist"; the hashes on `meta` answer
 * "and what do they promise". A store cannot derive the second from the first
 * — schemas never reach it — so these tests pin the property that motivates
 * carrying them: a change *inside* a route must be visible even though the
 * route list did not move.
 */
test.describe('announceToStore spec hashes', function () {
  /** Two routes with schemas, rebuilt per test so each may mutate its own copy. */
  function schemaRoutes() {
    return [
      {
        method: 'GET',
        path: '/items',
        description: 'List items',
        requestSchema: { body: null, query: { type: 'object', properties: { limit: { type: 'number' } } } },
        responseSchema: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' } } } },
      },
      {
        method: 'POST',
        path: '/items',
        description: 'Create an item',
        requestSchema: { body: { type: 'object', properties: { name: { type: 'string' } } }, query: null },
        responseSchema: { type: 'object', properties: { id: { type: 'number' } } },
      },
    ];
  }

  /** Announce `routes` to a fresh pipeline and hand back the single call. */
  function announceOnce(routes, docsPath) {
    const store = createSpyStore();
    const pipeline = createDriftPipeline({ drift: driftConfig(store) });
    announceToStore(pipeline, routes, META, docsPath);
    return store.calls[0];
  }

  test.it('hashes exactly the routes it announces, and nothing it filtered out', function () {
    const visible = schemaRoutes();
    const call = announceOnce(
      visible.concat([
        { method: 'GET', path: '/internal/health', hidden: true, responseSchema: { type: 'object' } },
        { method: 'GET', path: '/docs', responseSchema: { type: 'string' } },
        { method: 'GET', path: '/docs/openapi.json', responseSchema: { type: 'object' } },
      ]),
      '/docs'
    );

    // One selection, two projections: whatever the inventory dropped, the hash
    // dropped too. A store recomputing the hash over the same route set — the
    // CI-side check this feeds — must land on the same digest.
    assert.deepEqual(keysOf(call.routes), ['GET /items', 'POST /items']);
    assert.deepEqual(
      { contractHash: call.meta.contractHash, docHash: call.meta.docHash },
      computeSpecHashes(visible)
    );
  });

  test.it('moves contractHash when a field type changes, leaving the inventory identical', function () {
    const before = announceOnce(schemaRoutes());

    const changed = schemaRoutes();
    changed[1].requestSchema.body.properties.name = { type: 'number' };
    const after = announceOnce(changed);

    // This is the whole point of the pair: the route list is untouched, so an
    // inventory hash would call these two builds identical.
    assert.deepEqual(keysOf(after.routes), keysOf(before.routes));
    assert.notEqual(after.meta.contractHash, before.meta.contractHash);
    assert.notEqual(after.meta.docHash, before.meta.docHash);
  });

  test.it('moves only docHash when documentation changes', function () {
    const before = announceOnce(schemaRoutes());

    const reworded = schemaRoutes();
    reworded[0].description = 'Return every item, paginated';
    const after = announceOnce(reworded);

    assert.equal(after.meta.contractHash, before.meta.contractHash);
    assert.notEqual(after.meta.docHash, before.meta.docHash);
  });

  test.it('still announces when hashing throws on a hostile schema', function () {
    const hostile = schemaRoutes();
    // `toJSON` is user code reached from a startup path; a store losing two
    // meta fields is survivable, an application failing to boot is not.
    hostile[0].responseSchema = { toJSON: function () { throw new Error('nope'); } };

    const call = announceOnce(hostile);

    assert.deepEqual(keysOf(call.routes), ['GET /items', 'POST /items']);
    assert.deepEqual(Object.keys(call.meta).sort(), ['title', 'version']);
  });
});
