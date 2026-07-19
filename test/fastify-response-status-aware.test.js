'use strict';

/**
 * Status-aware response validation (v1.16).
 *
 * `validate: { response: 'warn' | 'throw' }` must assert a response against the
 * schema declared for the ACTUAL status code — the success `response` schema for
 * 2xx, and the declared error schema (route-local `errors[status]`, then adapter
 * `defaultErrors[status]`) for a 4xx/5xx. A status declared with only a
 * description, or declared nowhere, is not asserted. Previously every response
 * was hit with the single success schema, so each 4xx/5xx produced a phantom
 * "does not match the declared schema" warning.
 *
 * These tests mirror the reproduction table one-to-one, plus regression cover
 * for genuine 2xx drift and the `statusAware: false` escape hatch.
 *
 * Run: node --test test/fastify-response-status-aware.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { z } = require('zod');
const { fastifyAdapter, defineRoute } = require('../src/adapters/fastify');

// ── Schemas from the restaurant-API reproduction ────────────────────────────

const staff = z.object({
  id: z.number(),
  name: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  hasPin: z.boolean(),
  branchId: z.number(),
  archivedAt: z.string().nullable(),
});

const doctreenValidationError = z.object({
  error: z.string(),
  message: z.string(),
});

const validStaff = {
  id: 1,
  name: 'Ada',
  role: 'server',
  isActive: true,
  hasPin: false,
  branchId: 7,
  archivedAt: null,
};

const validErrorEnvelope = { error: 'Validation', message: 'branchId is required' };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Collect everything written to console.warn while `fn` runs. */
async function withWarnCapture(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = function () {
    warnings.push(Array.prototype.join.call(arguments, ' '));
  };
  try {
    await fn(warnings);
  } finally {
    console.warn = original;
  }
  return warnings;
}

/**
 * Build a Fastify app with the adapter installed, register `routes`, and return
 * the ready instance. The adapter must be installed BEFORE routes so its
 * `onRoute` hook captures them.
 */
async function buildApp(validate, routes, adapterExtra) {
  const app = Fastify();
  fastifyAdapter(app, Object.assign({ validate: validate }, adapterExtra || {}));
  routes(app);
  await app.ready();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 2xx + conforming body → no warning, body/status untouched
// ─────────────────────────────────────────────────────────────────────────────

test('2xx conforming response produces no warning and passes body/status through', async () => {
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn' }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(201); return validStaff; },
          { request: { body: null, query: null }, response: staff, errors: { 422: 'Validation' } },
        ),
      });
    });
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.json(), validStaff);
    await app.close();
  });
  assert.deepEqual(warnings, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 2xx + REAL drift → warning (the critical regression guard). The bugfix must
//    not blunt genuine success-schema drift detection.
// ─────────────────────────────────────────────────────────────────────────────

test('2xx genuine drift still warns (regression guard) and leaves body/status intact', async () => {
  const drifted = { id: 1, name: 'Ada' }; // missing role, isActive, hasPin, branchId, archivedAt
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn' }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(200); return drifted; },
          { request: { body: null, query: null }, response: staff, errors: { 422: 'Validation' } },
        ),
      });
    });
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    // Requirement 10: validation failure never mutates body or status.
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), drifted);
    await app.close();
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /POST \/staff \(200\)/);
  assert.match(warnings[0], /status 200/);
  assert.match(warnings[0], /role/); // names the genuinely-missing field
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 422 + errors:{422:<schema>} + conforming error envelope → no warning
//    (this is the exact bug in the report)
// ─────────────────────────────────────────────────────────────────────────────

test('non-2xx conforming to its declared error schema produces no warning', async () => {
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn' }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(422); return validErrorEnvelope; },
          {
            request: { body: null, query: null },
            response: staff,
            errors: { 422: { description: 'Validation', schema: doctreenValidationError } },
          },
        ),
      });
    });
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.json(), validErrorEnvelope);
    await app.close();
  });
  assert.deepEqual(warnings, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 422 + errors:{422:<schema>} + body NOT matching schema → warning, message
//    names status 422 (not the success schema)
// ─────────────────────────────────────────────────────────────────────────────

test('non-2xx that violates its declared error schema warns with the status in the message', async () => {
  const badEnvelope = { unexpected: true }; // missing error + message
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn' }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(422); return badEnvelope; },
          {
            request: { body: null, query: null },
            response: staff,
            errors: { 422: { description: 'Validation', schema: doctreenValidationError } },
          },
        ),
      });
    });
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.json(), badEnvelope); // untouched
    await app.close();
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /POST \/staff \(422\)/);
  assert.match(warnings[0], /schema declared for status 422/);
  assert.match(warnings[0], /route errors/);
  // It must complain about the ERROR schema's fields, not the success schema's.
  assert.match(warnings[0], /response\.error|response\.message/);
  assert.doesNotMatch(warnings[0], /branchId|hasPin|isActive/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 422 + description only → no warning (no contract to assert)
// ─────────────────────────────────────────────────────────────────────────────

test('non-2xx declared with only a description is skipped (no warning)', async () => {
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn' }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(422); return validErrorEnvelope; },
          { request: { body: null, query: null }, response: staff, errors: { 422: 'Validation' } },
        ),
      });
    });
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 422);
    await app.close();
  });
  assert.deepEqual(warnings, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 422 + adapter defaultErrors[422].schema, no route-local errors → validated
//    against the default schema
// ─────────────────────────────────────────────────────────────────────────────

test('non-2xx with no route-local error falls back to defaultErrors schema', async () => {
  const badEnvelope = { nope: 1 };
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp(
      { response: 'warn' },
      (a) => {
        a.post('/staff', {
          handler: defineRoute(
            async (req, reply) => { reply.status(422); return badEnvelope; },
            { request: { body: null, query: null }, response: staff }, // no route-local errors
          ),
        });
      },
      {
        defaultErrors: {
          401: 'Auth required',
          403: 'Forbidden',
          422: { description: 'Validation', schema: doctreenValidationError },
        },
      },
    );
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 422);
    await app.close();
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\(422\)/);
  assert.match(warnings[0], /defaultErrors/);
});

test('non-2xx conforming to the defaultErrors schema produces no warning', async () => {
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp(
      { response: 'warn' },
      (a) => {
        a.post('/staff', {
          handler: defineRoute(
            async (req, reply) => { reply.status(422); return validErrorEnvelope; },
            { request: { body: null, query: null }, response: staff },
          ),
        });
      },
      { defaultErrors: { 422: { description: 'Validation', schema: doctreenValidationError } } },
    );
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 422);
    await app.close();
  });
  assert.deepEqual(warnings, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Route-local errors[422] + defaultErrors[422] together → route-local wins
// ─────────────────────────────────────────────────────────────────────────────

test('route-local error schema wins over defaultErrors for the same status', async () => {
  // Route schema requires { code }; default schema requires { error, message }.
  const routeErr = z.object({ code: z.number() });
  // Body conforms to the DEFAULT schema but NOT the route-local one. If route
  // wins, this must warn; if default wins, it would pass silently.
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp(
      { response: 'warn' },
      (a) => {
        a.post('/staff', {
          handler: defineRoute(
            async (req, reply) => { reply.status(422); return validErrorEnvelope; },
            {
              request: { body: null, query: null },
              response: staff,
              errors: { 422: { description: 'Route validation', schema: routeErr } },
            },
          ),
        });
      },
      { defaultErrors: { 422: { description: 'Default validation', schema: doctreenValidationError } } },
    );
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 422);
    await app.close();
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /route errors/);
  assert.match(warnings[0], /response\.code/); // route schema's field, proving it won
});

test('route-local error schema wins: a body matching the route schema passes', async () => {
  const routeErr = z.object({ code: z.number() });
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp(
      { response: 'warn' },
      (a) => {
        a.post('/staff', {
          handler: defineRoute(
            async (req, reply) => { reply.status(422); return { code: 42 }; },
            {
              request: { body: null, query: null },
              response: staff,
              errors: { 422: { description: 'Route validation', schema: routeErr } },
            },
          ),
        });
      },
      { defaultErrors: { 422: { description: 'Default validation', schema: doctreenValidationError } } },
    );
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 422);
    await app.close();
  });
  assert.deepEqual(warnings, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Undeclared status (418) → no warning by default; opt-in surfaces a signal
// ─────────────────────────────────────────────────────────────────────────────

test('undeclared status produces no warning by default', async () => {
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn' }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(418); return { teapot: true }; },
          { request: { body: null, query: null }, response: staff, errors: { 422: 'Validation' } },
        ),
      });
    });
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 418);
    await app.close();
  });
  assert.deepEqual(warnings, []);
});

test('undeclared status warns when warnUndeclaredStatus is on', async () => {
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn', warnUndeclaredStatus: true }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(418); return { teapot: true }; },
          { request: { body: null, query: null }, response: staff, errors: { 422: 'Validation' } },
        ),
      });
    });
    await app.inject({ method: 'POST', url: '/staff', payload: {} });
    await app.close();
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /undeclared status 418/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. NODE_ENV=production → no warnings in any mode (adapter is a no-op)
// ─────────────────────────────────────────────────────────────────────────────

test('production is a no-op: neither warn nor throw modes assert responses', async () => {
  const drifted = { id: 1 };
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    for (const mode of ['warn', 'throw']) {
      const warnings = await withWarnCapture(async () => {
        const app = await buildApp({ response: mode }, (a) => {
          a.post('/staff', {
            handler: defineRoute(
              async (req, reply) => { reply.status(200); return drifted; },
              { request: { body: null, query: null }, response: staff },
            ),
          });
        });
        const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
        assert.equal(res.statusCode, 200); // no 500 even in throw mode
        assert.deepEqual(res.json(), drifted);
        await app.close();
      });
      assert.deepEqual(warnings, [], 'no warnings in production (' + mode + ' mode)');
    }
  } finally {
    process.env.NODE_ENV = prev;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Body + status stay exactly as the handler produced them, even on failure.
//     (Covered inline in tests 2 and 4; this is an explicit standalone check.)
// ─────────────────────────────────────────────────────────────────────────────

test('a failing assertion never rewrites the handler body or status', async () => {
  const drifted = { id: 99, extra: 'kept' };
  await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn' }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(206); return drifted; },
          { request: { body: null, query: null }, response: staff },
        ),
      });
    });
    const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
    assert.equal(res.statusCode, 206);
    assert.deepEqual(res.json(), drifted);
    await app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// throw mode is also status-aware: a description-only 4xx does not throw, but a
// genuine 2xx drift still does.
// ─────────────────────────────────────────────────────────────────────────────

test('throw mode: description-only 4xx does not throw', async () => {
  const app = await buildApp({ response: 'throw' }, (a) => {
    a.post('/staff', {
      handler: defineRoute(
        async (req, reply) => { reply.status(422); return validErrorEnvelope; },
        { request: { body: null, query: null }, response: staff, errors: { 422: 'Validation' } },
      ),
    });
  });
  const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.json(), validErrorEnvelope);
  await app.close();
});

test('throw mode: genuine 2xx drift still surfaces as a 500', async () => {
  const app = await buildApp({ response: 'throw' }, (a) => {
    a.post('/staff', {
      handler: defineRoute(
        async (req, reply) => { reply.status(200); return { id: 1 }; },
        { request: { body: null, query: null }, response: staff },
      ),
    });
  });
  const res = await app.inject({ method: 'POST', url: '/staff', payload: {} });
  assert.equal(res.statusCode, 500);
  await app.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Escape hatch: `statusAware: false` restores the pre-v1.16 behaviour, so a
// declared-error 4xx is (wrongly, but deliberately) hit with the success schema.
// ─────────────────────────────────────────────────────────────────────────────

test('statusAware:false restores legacy behaviour (error envelope hit by success schema)', async () => {
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn', statusAware: false }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => { reply.status(422); return validErrorEnvelope; },
          {
            request: { body: null, query: null },
            response: staff,
            errors: { 422: { description: 'Validation', schema: doctreenValidationError } },
          },
        ),
      });
    });
    await app.inject({ method: 'POST', url: '/staff', payload: {} });
    await app.close();
  });
  // Legacy: the success schema is asserted against the 422 envelope → warns.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /branchId/); // success-schema field, i.e. the old phantom warning
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration-count check straight from the report: warnings == number of 4xx.
// ─────────────────────────────────────────────────────────────────────────────

test('integration: 11x 201 + 2x 422 (description-only) yields zero warnings', async () => {
  const warnings = await withWarnCapture(async () => {
    const app = await buildApp({ response: 'warn' }, (a) => {
      a.post('/staff', {
        handler: defineRoute(
          async (req, reply) => {
            if (req.body && req.body.bad) { reply.status(422); return validErrorEnvelope; }
            reply.status(201); return validStaff;
          },
          { request: { body: null, query: null }, response: staff, errors: { 422: 'Validation' } },
        ),
      });
    });
    for (let i = 0; i < 11; i++) await app.inject({ method: 'POST', url: '/staff', payload: {} });
    for (let i = 0; i < 2; i++) await app.inject({ method: 'POST', url: '/staff', payload: { bad: true } });
    await app.close();
  });
  assert.deepEqual(warnings, []);
});
