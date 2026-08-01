'use strict';

/**
 * Response-validation adapter parity (T008 — v1.16 bug fix).
 *
 * v1.16 shipped status-aware response validation, but only fastify actually
 * called `resolveResponseValidator` correctly. express, hono, koa and nest
 * passed the *resolution object* straight into `validateResponse`, which bails
 * out on anything without `.safeParse` — so every response in four of the five
 * adapters was silently declared valid. They also dropped the original Zod
 * error schema when normalising a route's `errors` map, and never forwarded
 * `defaultErrors` / `statusAware` / `warnUndeclaredStatus`.
 *
 * All five adapters now go through one helper, `assertResponse` in
 * `src/internal/validate.js`. This suite is the parity net under that helper:
 * the same fixture contract is mounted on all five frameworks and the same
 * expectations are asserted against each, so a future change that fixes or
 * breaks one adapter has to fix or break all of them.
 *
 * Fixture contract (identical on every adapter) — one route per outcome so no
 * framework-specific status juggling is needed:
 *
 *   GET /ok           200  body matching `response`            → silent
 *   GET /drift        200  body violating `response`           → warns
 *   GET /err-valid    422  body matching errors[422].schema    → silent
 *   GET /err-invalid  422  body violating errors[422].schema   → warns
 *   GET /desc-only    404  errors[404] is description-only     → silent
 *   GET /default-err  401  body violating defaultErrors[401]   → warns
 *   GET /undeclared   418  no contract for this status         → silent,
 *                                                                unless
 *                                                                warnUndeclaredStatus
 *
 * Run: node --test test/response-validation-parity.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { z } = require('zod');

// ── Shared fixture contract ─────────────────────────────────────────────────

const Staff = z.object({
  id: z.number(),
  name: z.string(),
  isActive: z.boolean(),
});

const ErrorEnvelope = z.object({
  error: z.string(),
  message: z.string(),
});

const VALID_STAFF     = { id: 1, name: 'Ada', isActive: true };
/** `id` is a string and `isActive` is missing — genuine success-schema drift. */
const INVALID_STAFF   = { id: 'one', name: 'Ada' };
const VALID_ENVELOPE  = { error: 'Validation', message: 'branchId is required' };
/** `message` is missing — violates the declared error schema. */
const INVALID_ENVELOPE = { error: 'Validation' };

/** The schema bag every fixture route declares. */
const DOC = {
  request:  { body: null, query: null },
  response: Staff,
  errors: {
    422: { description: 'Validation failed', schema: ErrorEnvelope },
    404: 'Not found',
  },
};

/** Adapter-level `defaultErrors` — the config path that was dead in four adapters. */
const DEFAULT_ERRORS = {
  401: { description: 'Unauthorised', schema: ErrorEnvelope },
};

/**
 * @typedef {{ path: string, status: number, body: any, warns: boolean }} FixtureRoute
 */

/** @type {FixtureRoute[]} */
const ROUTES = [
  { path: '/ok',          status: 200, body: VALID_STAFF,      warns: false },
  { path: '/drift',       status: 200, body: INVALID_STAFF,    warns: true  },
  { path: '/err-valid',   status: 422, body: VALID_ENVELOPE,   warns: false },
  { path: '/err-invalid', status: 422, body: INVALID_ENVELOPE, warns: true  },
  { path: '/desc-only',   status: 404, body: { detail: 'gone' }, warns: false },
  { path: '/default-err', status: 401, body: INVALID_ENVELOPE, warns: true  },
  { path: '/undeclared',  status: 418, body: { teapot: true }, warns: false },
];

const META = { title: 'Parity API', version: '1.16.0', description: 'Response parity fixture.' };
const HOST = '127.0.0.1';

/** Config for the plain warn-mode app used by most assertions. */
const WARN_CONFIG = {
  meta: META,
  validate: { response: 'warn' },
  defaultErrors: DEFAULT_ERRORS,
};

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
 * Collect everything written to console.warn while `fn` runs.
 * @param {function(): Promise<any>} fn
 * @returns {Promise<string[]>}
 */
async function withWarnCapture(fn) {
  const original = console.warn;
  /** @type {string[]} */
  const warnings = [];
  console.warn = function () {
    warnings.push(Array.prototype.slice.call(arguments).join(' '));
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return warnings;
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

// ── Adapter builders (Factory) ──────────────────────────────────────────────
// One entry per adapter, each taking the doctreen config so the same fixture
// can be booted in 'warn', 'throw' and warnUndeclaredStatus modes.

/** @returns {Promise<{ baseUrl: string, close: function(): Promise<void> }>} */
async function buildExpressApp(config) {
  const express = require('express');
  const { expressAdapter, defineRoute } = require('../src/adapters/express');

  const app = express();
  for (const r of ROUTES) {
    app.get(r.path, defineRoute(
      function handler(_req, res) { res.status(r.status).json(r.body); },
      DOC
    ));
  }
  app.use(expressAdapter(app, config));
  // Quiet 500 for 'throw' mode — Express's default handler prints the stack.
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
      DOC
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
      DOC
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
  app.silent = true; // don't print handler errors to stderr during the run
  const router = new Router();
  koaAdapter(router, config);

  for (const r of ROUTES) {
    router.get(r.path, defineRoute(
      async function handler(ctx) {
        // Body first, then status: assigning ctx.body resets an unset status
        // to 200, so the explicit status has to come last.
        ctx.body = r.body;
        ctx.status = r.status;
      },
      DOC
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

  // The suite stays CommonJS, so the decorator factories are applied by hand —
  // they are plain functions over Reflect.defineMetadata, with identical effect.
  class ParityController {}

  ROUTES.forEach(function (r, i) {
    const name = 'route' + i;
    ParityController.prototype[name] = function () { return r.body; };
    const proto = ParityController.prototype;
    const decorators = [Get(r.path.slice(1)), HttpCode(r.status), DocRoute(DOC)];
    for (let d = 0; d < decorators.length; d++) {
      decorators[d](proto, name, Object.getOwnPropertyDescriptor(proto, name));
    }
  });

  Controller()(ParityController);
  class AppModule {}
  Module({ controllers: [ParityController] })(AppModule);

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
 * Boot one adapter, run `fn(baseUrl)` with console.warn captured, close it.
 *
 * @param {string} name
 * @param {any} config
 * @param {function(string): Promise<any>} fn
 * @returns {Promise<string[]>} captured warnings
 */
async function withApp(name, config, fn) {
  const app = await BUILDERS[name](config);
  try {
    return await withWarnCapture(function () { return fn(app.baseUrl); });
  } finally {
    await app.close();
  }
}

/** Warnings emitted by doctreen only — frameworks may warn about their own things. */
function doctreenWarnings(warnings) {
  return warnings.filter(function (w) { return w.indexOf('[doctreen]') === 0; });
}

// ── Parity assertions ───────────────────────────────────────────────────────

for (const name of ADAPTERS) {
  test(name + ': warn mode asserts every status against its declared contract', async () => {
    /** @type {Array<{ path: string, status: number, warnings: string[] }>} */
    const seen = [];

    await withApp(name, WARN_CONFIG, async function (baseUrl) {
      for (const r of ROUTES) {
        const before = console.warn;
        // Capture per-route so a warning can be attributed to the route that
        // produced it, not just counted across the whole run.
        /** @type {string[]} */
        const collected = [];
        console.warn = function () { collected.push(Array.prototype.slice.call(arguments).join(' ')); };
        let res;
        try {
          res = await get(baseUrl, r.path);
        } finally {
          console.warn = before;
        }
        seen.push({ path: r.path, status: res.status, warnings: doctreenWarnings(collected) });
      }
    });

    for (let i = 0; i < ROUTES.length; i++) {
      const r = ROUTES[i];
      const got = seen[i];
      assert.equal(got.status, r.status, r.path + ' should keep its status (never rewritten)');
      if (r.warns) {
        assert.equal(got.warnings.length, 1, r.path + ' should warn exactly once, got: ' + JSON.stringify(got.warnings));
        assert.match(got.warnings[0], new RegExp('\\(' + r.status + '\\)'),
          r.path + ' warning should name the actual status');
      } else {
        assert.deepEqual(got.warnings, [], r.path + ' should stay silent');
      }
    }
  });

  test(name + ': throw mode turns a schema mismatch into an error response', async () => {
    const config = Object.assign({}, WARN_CONFIG, { validate: { response: 'throw' } });
    /** @type {Record<string, { status: number, text: string }>} */
    const res = {};

    await withApp(name, config, async function (baseUrl) {
      res.ok         = await get(baseUrl, '/ok');
      res.drift      = await get(baseUrl, '/drift');
      res.errInvalid = await get(baseUrl, '/err-invalid');
      res.descOnly   = await get(baseUrl, '/desc-only');
    });

    assert.equal(res.ok.status, 200, 'a conforming 2xx must not be disturbed');
    assert.deepEqual(JSON.parse(res.ok.text), VALID_STAFF);
    assert.equal(res.drift.status, 500, 'genuine 2xx drift must surface as a 500');

    // A mismatching *error* response is rejected too, but the final status is
    // the framework's call once the reply is already a 4xx: Fastify keeps the
    // 422 it was about to send and only replaces the body, while the others
    // escalate to 500. The parity claim is that the invalid payload never
    // reaches the client.
    assert.ok(res.errInvalid.status >= 400,
      'a 4xx violating its declared error schema must not succeed');
    assert.notEqual(res.errInvalid.text, JSON.stringify(INVALID_ENVELOPE),
      'the invalid error payload must not be delivered as-is');

    assert.equal(res.descOnly.status, 404, 'a description-only error entry has nothing to throw about');
    assert.deepEqual(JSON.parse(res.descOnly.text), { detail: 'gone' });
  });

  test(name + ': warnUndeclaredStatus signals a status with no declared contract', async () => {
    const config = Object.assign({}, WARN_CONFIG, {
      validate: { response: 'warn', warnUndeclaredStatus: true },
    });

    const warnings = await withApp(name, config, async function (baseUrl) {
      const res = await get(baseUrl, '/undeclared');
      assert.equal(res.status, 418, 'the undeclared status is passed through untouched');
    });

    const undeclared = doctreenWarnings(warnings).filter(function (w) {
      return w.indexOf('undeclared status') !== -1;
    });
    assert.equal(undeclared.length, 1, 'expected one undeclared-status signal, got: ' + JSON.stringify(warnings));
    assert.match(undeclared[0], /418/);
  });

  test(name + ': response validation stays off by default', async () => {
    const warnings = await withApp(name, { meta: META, defaultErrors: DEFAULT_ERRORS }, async function (baseUrl) {
      const res = await get(baseUrl, '/drift');
      assert.equal(res.status, 200);
    });
    assert.deepEqual(doctreenWarnings(warnings), [], 'no response assertion without `validate.response`');
  });
}
