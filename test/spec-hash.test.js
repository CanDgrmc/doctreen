'use strict';

/**
 * Spec hashes — `contractHash` / `docHash` (T001).
 *
 * `src/internal/spec-hash.js` fingerprints a route registry twice: once over
 * the behavioural contract, once over everything. The point of the pair is the
 * *difference* between them, so that is what these tests assert — which edits
 * move which hash — rather than pinning literal digests. A pinned digest would
 * break on any harmless change to the canonical form and would tell us nothing
 * about the property that matters.
 *
 * Groups:
 *   1. Determinism  — key order, route order, repeat calls, hash format.
 *   2. Contract     — the edits that MUST move `contractHash`.
 *   3. Documentation— the edits that must move ONLY `docHash`.
 *   4. Robustness   — empty input, junk entries, Zod handles, cycles, purity.
 *
 * Fixtures mirror `example/app.js` (users + products, Zod-free `s.*` schemas)
 * built through the same `s` helpers the adapters use, so the entries under
 * test have the shape `exporters/openapi.js` consumes.
 *
 * Run: node --test test/spec-hash.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { s } = require('../src/index');
const { computeSpecHashes, canonicalizeRoutes } = require('../src/internal/spec-hash');

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Three routes in registry form. Rebuilt on every call so a test can mutate
 * its own copy without leaking into the next one (deliberately not a shared
 * constant — these objects are nested and every test edits them).
 *
 * @returns {Array<any>}
 */
function routes() {
  return [
    {
      method: 'GET',
      path: '/users',
      params: [],
      description: 'List all users',
      requestHeaders: { Authorization: 'Bearer <token>' },
      requestSchema: {
        body: null,
        query: s.object({
          page: s.optional(s.number()),
          search: s.optional(s.string()),
        }),
      },
      responseSchema: s.object({
        users: s.array(s.object({ id: s.number(), name: s.string() })),
        total: s.number(),
      }),
      errors: null,
      tags: ['users'],
    },
    {
      method: 'POST',
      path: '/users',
      params: [],
      description: 'Create a user',
      requestHeaders: null,
      requestSchema: {
        body: s.object({
          name: s.string(),
          email: s.string(),
          role: s.enum(['admin', 'user']),
        }),
        query: null,
      },
      responseSchema: s.object({ id: s.number(), name: s.string() }),
      errors: [
        { status: 409, description: 'Email already taken', schema: s.object({ error: s.string() }), validator: null },
        { status: 422, description: 'Validation failed', schema: null, validator: null },
      ],
      security: [{ bearerAuth: [] }],
      examples: { request: { name: 'Alice', email: 'alice@example.com' } },
    },
    {
      method: 'GET',
      path: '/products/:id',
      params: ['id'],
      description: 'Fetch one product',
      requestHeaders: null,
      requestSchema: {
        body: null,
        query: null,
        params: s.object({ id: s.number() }),
      },
      responses: {
        200: s.object({ id: s.number(), price: s.number() }),
        404: s.object({ error: s.string() }),
      },
      responseSchema: null,
      errors: null,
      hidden: false,
    },
  ];
}

/** The `POST /users` entry of a fresh fixture — the one most tests edit. */
function withPostUsers(mutate) {
  const list = routes();
  mutate(list[1]);
  return list;
}

function contractOf(list) { return computeSpecHashes(list).contractHash; }
function docOf(list) { return computeSpecHashes(list).docHash; }

const BASE = computeSpecHashes(routes());

// ── 1. Determinism ──────────────────────────────────────────────────────────

test('hashes are shaped `sha256:<64 hex>`', function () {
  assert.match(BASE.contractHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(BASE.docHash, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(BASE.contractHash, BASE.docHash);
});

test('key insertion order does not change either hash', function () {
  const a = [{
    method: 'GET',
    path: '/a',
    description: 'first',
    requestSchema: { body: null, query: s.object({ x: s.string(), y: s.number() }) },
    responseSchema: s.object({ ok: s.boolean() }),
  }];
  const b = [{
    responseSchema: s.object({ ok: s.boolean() }),
    requestSchema: { query: s.object({ y: s.number(), x: s.string() }), body: null },
    description: 'first',
    path: '/a',
    method: 'GET',
  }];

  assert.equal(canonicalizeRoutes(a, { mode: 'doc' }), canonicalizeRoutes(b, { mode: 'doc' }));
  assert.deepEqual(computeSpecHashes(a), computeSpecHashes(b));
});

test('route order does not change either hash', function () {
  const shuffled = routes();
  shuffled.reverse();
  assert.deepEqual(computeSpecHashes(shuffled), BASE);

  const rotated = routes();
  rotated.push(rotated.shift());
  assert.deepEqual(computeSpecHashes(rotated), BASE);
});

test('method casing is normalised', function () {
  const lower = routes();
  lower[1].method = 'post';
  assert.deepEqual(computeSpecHashes(lower), BASE);
});

test('repeated calls on equivalent input agree (no clock, no randomness)', function () {
  assert.deepEqual(computeSpecHashes(routes()), BASE);
  assert.deepEqual(computeSpecHashes(routes()), computeSpecHashes(routes()));
});

// ── 2. Contract-moving edits ────────────────────────────────────────────────

test('a type change moves contractHash', function () {
  const changed = withPostUsers(function (r) {
    r.requestSchema.body.properties.name = s.number();
  });
  assert.notEqual(contractOf(changed), BASE.contractHash);
  assert.notEqual(docOf(changed), BASE.docHash);
});

test('adding or removing a field moves contractHash', function () {
  const added = withPostUsers(function (r) {
    r.requestSchema.body.properties.nickname = s.string();
  });
  assert.notEqual(contractOf(added), BASE.contractHash);

  const removed = withPostUsers(function (r) {
    delete r.requestSchema.body.properties.email;
  });
  assert.notEqual(contractOf(removed), BASE.contractHash);
  assert.notEqual(contractOf(removed), contractOf(added));
});

test('optional → required moves contractHash', function () {
  const before = routes();
  const after = routes();
  after[0].requestSchema.query.properties.page = s.number(); // was s.optional(...)
  assert.notEqual(contractOf(after), contractOf(before));
});

test('enum / nullable / default value changes move contractHash', function () {
  const enumChanged = withPostUsers(function (r) {
    r.requestSchema.body.properties.role = s.enum(['admin', 'user', 'guest']);
  });
  assert.notEqual(contractOf(enumChanged), BASE.contractHash);

  const nullable = withPostUsers(function (r) {
    r.requestSchema.body.properties.email = s.nullable(s.string());
  });
  assert.notEqual(contractOf(nullable), BASE.contractHash);

  const defaulted = withPostUsers(function (r) {
    r.requestSchema.body.properties.name = s.default(s.string(), 'anon');
  });
  assert.notEqual(contractOf(defaulted), BASE.contractHash);
});

test('status-keyed response schemas take part in contractHash', function () {
  const changed = routes();
  changed[2].responses['404'] = s.object({ error: s.string(), code: s.number() });
  assert.notEqual(contractOf(changed), BASE.contractHash);

  const dropped = routes();
  delete dropped[2].responses['404'];
  assert.notEqual(contractOf(dropped), BASE.contractHash);
});

test('security requirements and the hidden flag take part in contractHash', function () {
  const secured = withPostUsers(function (r) { r.security = [{ apiKey: [] }]; });
  assert.notEqual(contractOf(secured), BASE.contractHash);

  const hidden = routes();
  hidden[2].hidden = true;
  assert.notEqual(contractOf(hidden), BASE.contractHash);
});

test('adding or removing a route moves both hashes', function () {
  const extra = routes();
  extra.push({ method: 'DELETE', path: '/users/:id', params: ['id'], requestSchema: null, responseSchema: null });
  assert.notEqual(contractOf(extra), BASE.contractHash);
  assert.notEqual(docOf(extra), BASE.docHash);

  const fewer = routes().slice(0, 2);
  assert.notEqual(contractOf(fewer), BASE.contractHash);
});

test('renaming a request header moves contractHash', function () {
  const renamed = routes();
  renamed[0].requestHeaders = { 'X-Api-Key': 'Bearer <token>' };
  assert.notEqual(contractOf(renamed), BASE.contractHash);
});

test('a request field literally named "description" counts as contract', function () {
  const base = routes();
  const withField = routes();
  withField[1].requestSchema.body.properties.description = s.string();

  assert.notEqual(contractOf(withField), contractOf(base));

  const retyped = routes();
  retyped[1].requestSchema.body.properties.description = s.number();
  assert.notEqual(contractOf(retyped), contractOf(withField));
});

// ── 3. Documentation-only edits ─────────────────────────────────────────────

test('a description change moves docHash only', function () {
  const changed = withPostUsers(function (r) { r.description = 'Create a brand new user'; });
  assert.equal(contractOf(changed), BASE.contractHash);
  assert.notEqual(docOf(changed), BASE.docHash);
});

test('summary and example edits move docHash only', function () {
  const examples = withPostUsers(function (r) {
    r.examples = { request: { name: 'Bob', email: 'bob@example.com' } };
  });
  assert.equal(contractOf(examples), BASE.contractHash);
  assert.notEqual(docOf(examples), BASE.docHash);

  const summary = withPostUsers(function (r) { r.summary = 'Create'; });
  assert.equal(contractOf(summary), BASE.contractHash);
  assert.notEqual(docOf(summary), BASE.docHash);
});

test('a header description change moves docHash only', function () {
  const changed = routes();
  changed[0].requestHeaders = { Authorization: 'JWT, please' };
  assert.equal(contractOf(changed), BASE.contractHash);
  assert.notEqual(docOf(changed), BASE.docHash);
});

test('a description-only error entry is invisible to contractHash', function () {
  const base = routes();

  // The 422 in the fixture is description-only: dropping it changes nothing
  // for a client, so contractHash must hold.
  const without422 = routes();
  without422[1].errors = without422[1].errors.slice(0, 1);
  assert.equal(contractOf(without422), contractOf(base));
  assert.notEqual(docOf(without422), docOf(base));

  // Same for its wording, and for a newly added description-only status.
  const reworded = routes();
  reworded[1].errors[1].description = 'Payload rejected';
  assert.equal(contractOf(reworded), contractOf(base));

  const added = routes();
  added[1].errors.push({ status: 429, description: 'Too many requests', schema: null, validator: null });
  assert.equal(contractOf(added), contractOf(base));
  assert.notEqual(docOf(added), docOf(base));
});

test('an error entry WITH a schema does move contractHash', function () {
  const base = routes();

  const changed = routes();
  changed[1].errors[0].schema = s.object({ error: s.string(), field: s.string() });
  assert.notEqual(contractOf(changed), contractOf(base));

  // A 422 that grows a body is a contract change, unlike the same status
  // carrying only prose.
  const bodied = routes();
  bodied[1].errors[1].schema = s.object({ error: s.string() });
  assert.notEqual(contractOf(bodied), contractOf(base));

  // …while its description stays documentation.
  const bodiedReworded = routes();
  bodiedReworded[1].errors[1].schema = s.object({ error: s.string() });
  bodiedReworded[1].errors[1].description = 'Nope';
  assert.equal(contractOf(bodiedReworded), contractOf(bodied));
});

// ── 4. Robustness and purity ────────────────────────────────────────────────

test('an empty route list hashes without throwing, to a stable value', function () {
  const empty = computeSpecHashes([]);
  assert.equal(canonicalizeRoutes([], { mode: 'contract' }), '[]');
  assert.deepEqual(computeSpecHashes([]), empty);
  assert.match(empty.contractHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(empty.contractHash, empty.docHash); // nothing to differ over
  assert.notEqual(empty.contractHash, BASE.contractHash);

  // Missing / malformed input is treated as "no routes", never as a throw:
  // the hash sits on the fail-open runtime path.
  assert.deepEqual(computeSpecHashes(undefined), empty);
  assert.deepEqual(computeSpecHashes(null), empty);
  assert.deepEqual(computeSpecHashes([null, {}, { method: 'GET' }, { path: '/x' }]), empty);
});

test('runtime validator handles and cycles neither throw nor leak into the hash', function () {
  const zodish = { parse: function () {}, _def: { typeName: 'ZodObject' } };
  zodish._def.self = zodish; // Zod internals self-reference

  const withHandles = withPostUsers(function (r) {
    r.requestValidators = { body: zodish, query: null };
    r.responseValidator = zodish;
    r.errors[0].validator = zodish;
  });

  assert.deepEqual(computeSpecHashes(withHandles), BASE);

  // A cycle inside a schema (a self-referential defineSchema) terminates.
  const cyclic = routes();
  const node = { type: 'object', properties: { id: s.number() } };
  node.properties.self = node;
  cyclic[1].requestSchema.body = node;
  assert.match(contractOf(cyclic), /^sha256:[0-9a-f]{64}$/);
});

test('the input list is never mutated', function () {
  const list = routes();
  const before = JSON.stringify(list);
  computeSpecHashes(list);
  canonicalizeRoutes(list, { mode: 'doc' });
  canonicalizeRoutes(list, { mode: 'contract' });
  assert.equal(JSON.stringify(list), before);
});

test('canonicalizeRoutes emits sorted, undefined-free JSON and defaults to contract mode', function () {
  const list = [
    { method: 'POST', path: '/b', description: 'second', responseSchema: null, tags: undefined },
    { method: 'GET', path: '/b', description: 'first', responseSchema: null },
    { method: 'GET', path: '/a', description: 'zeroth', responseSchema: null },
  ];

  const contract = canonicalizeRoutes(list);
  assert.equal(contract, canonicalizeRoutes(list, { mode: 'contract' }));

  const parsed = JSON.parse(contract);
  assert.deepEqual(parsed.map(function (r) { return r.method + ' ' + r.path; }), ['GET /a', 'GET /b', 'POST /b']);

  // `undefined` dropped, `null` kept, keys sorted.
  assert.equal(contract.indexOf('tags'), -1);
  assert.equal(contract.indexOf('description'), -1);
  assert.deepEqual(Object.keys(parsed[0]), ['method', 'path', 'responseSchema']);
  assert.equal(parsed[0].responseSchema, null);

  assert.ok(canonicalizeRoutes(list, { mode: 'doc' }).indexOf('description') !== -1);
});

// ── 5. The `announce` projection ────────────────────────────────────────────

/**
 * `announce` (v1.19) is the projection the startup route inventory is built
 * from — see `safeRouteSchema` in `internal/drift.js`. It is not hashed, and
 * that is the point: `contract` is prose-free because a hash may not move when
 * somebody fixes a typo, and applying that same blindness to a payload meant
 * to be *read* cost every description and every schema-less error.
 *
 * It sits strictly between the other two: `contract` ⊂ `announce` ⊂ `doc`.
 */

/** The three canonical projections of one route list, parsed. */
function projections(list) {
  return {
    contract: JSON.parse(canonicalizeRoutes(list, { mode: 'contract' })),
    announce: JSON.parse(canonicalizeRoutes(list, { mode: 'announce' })),
    doc: JSON.parse(canonicalizeRoutes(list, { mode: 'doc' })),
  };
}

/** The `POST /users` entry of a projection — the fixture route carrying everything. */
function postUsers(projected) {
  return projected.filter(function (r) { return r.method + ' ' + r.path === 'POST /users'; })[0];
}

test('announce carries the prose the contract projection is required to drop', function () {
  const p = projections(routes());

  assert.equal(postUsers(p.contract).description, undefined);
  assert.equal(postUsers(p.announce).description, 'Create a user');
  assert.equal(postUsers(p.doc).description, 'Create a user');

  // `requestHeaders` is a `name → what it is for` map. Contract mode keeps only
  // the names, because renaming a header is a contract change and rewording its
  // note is not. A reader needs the note.
  const listing = p.contract.filter(function (r) { return r.path === '/users' && r.method === 'GET'; })[0];
  const readable = p.announce.filter(function (r) { return r.path === '/users' && r.method === 'GET'; })[0];
  assert.deepEqual(listing.requestHeaders, ['Authorization']);
  assert.deepEqual(readable.requestHeaders, { Authorization: 'Bearer <token>' });
});

test('announce keeps a declared error that has no schema', function () {
  const p = projections(routes());

  // The fixture declares two: a 409 with a body and a 422 without. Contract mode
  // keeps only the 409, because a status with no body declares no contract —
  // true for a hash, useless for a page listing what can go wrong.
  assert.deepEqual(postUsers(p.contract).errors.map(function (e) { return e.status; }), [409]);
  assert.deepEqual(postUsers(p.announce).errors.map(function (e) { return e.status; }), [409, 422]);

  const unschemad = postUsers(p.announce).errors[1];
  assert.equal(unschemad.description, 'Validation failed');
  assert.equal(unschemad.schema, null);

  // …and the one that does carry a body still carries it.
  assert.equal(postUsers(p.announce).errors[0].schema.type, 'object');
});

test('announce drops example bodies, which doc keeps', function () {
  const p = projections(routes());

  assert.deepEqual(postUsers(p.doc).examples, { request: { name: 'Alice', email: 'alice@example.com' } });
  assert.equal(postUsers(p.announce).examples, undefined);

  // Not just the key — the value. This projection crosses a process boundary,
  // and a future field that inlined an example would pass a key-name check.
  assert.equal(canonicalizeRoutes(routes(), { mode: 'announce' }).indexOf('alice@example.com'), -1);
});

test('an unrecognised mode narrows to contract rather than widening to doc', function () {
  // A typo in a caller's options object must lose information, never leak it.
  const contract = canonicalizeRoutes(routes(), { mode: 'contract' });
  assert.equal(canonicalizeRoutes(routes(), { mode: 'Doc' }), contract);
  assert.equal(canonicalizeRoutes(routes(), { mode: 'announce ' }), contract);
  assert.equal(canonicalizeRoutes(routes(), {}), contract);
});

test('adding a third mode left the two hashed projections alone', function () {
  // The regression that would matter most, and the one a moving hash reports
  // only after the fact: every key `contract` announces must still be announced
  // by both wider modes, with the same value.
  const p = projections(routes());

  for (let i = 0; i < p.contract.length; i++) {
    const narrow = p.contract[i];
    const middle = p.announce[i];
    const wide = p.doc[i];
    assert.equal(narrow.method + ' ' + narrow.path, middle.method + ' ' + middle.path);

    Object.keys(narrow).forEach(function (key) {
      // `errors` and `requestHeaders` are the two keys contract deliberately
      // reduces, so they are compared by presence rather than by value.
      if (key === 'errors' || key === 'requestHeaders') {
        assert.ok(key in middle && key in wide, key + ' vanished from a wider mode');
        return;
      }
      assert.deepEqual(middle[key], narrow[key], key + ' differs between contract and announce');
      assert.deepEqual(wide[key], narrow[key], key + ' differs between contract and doc');
    });
  }

  // And the hashes are still taken over exactly two of the three.
  assert.deepEqual(computeSpecHashes(routes()), BASE);
});

// ── 6. Public surface ───────────────────────────────────────────────────────

test('computeSpecHashes is reachable from the package entry point, the module is not', function () {
  // A drift store lives outside this package and reaches the library the only
  // way it can: `require('doctreen')`. Same function object, not a copy —
  // anything else would mean two hash implementations.
  const pkg = require('doctreen');
  assert.equal(pkg.computeSpecHashes, computeSpecHashes);
  assert.deepEqual(pkg.computeSpecHashes(routes()), BASE);

  // The internals stay internal: the two promoted functions are the contract,
  // the modules around them are not, so no `./internal/*` subpath is opened.
  assert.throws(function () { require('doctreen/internal/spec-hash'); }, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
});
