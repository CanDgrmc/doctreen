# Changelog

All notable changes to this project are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [1.18.0] — 2026-08-04

The startup route inventory carries the contract, not just the address. In 1.17
`announceRoutes` reported method and path only — enough for a store to know a
route existed, never enough to say what it accepted or returned. A store that
wanted the shape had to fetch the OpenAPI export out of band, which is a second
transport, a second auth story, and a spec that may already have moved on from
the hashes it was announced with.

### Added

- **`RouteInventoryEntry.schema`** — each announced route now carries its
  contract as data, in the same canonical projection `contractHash` is computed
  over. An inventory entry is no longer just an address:

  ```js
  {
    method: 'POST',
    path: '/users/{id}',
    schema: { body: { … }, query: { … }, responses: { … }, security: [ … ] }
  }
  ```

  It is the **same canonical projection `contractHash` is computed over**, not a
  second serialisation of the route — request / response / error schemas,
  status-keyed responses, required and optional flags, types, enum / nullable /
  default values, security requirements, the `hidden` flag. Free text is
  excluded, so `description` and `summary` never travel with the inventory; the
  `meta.contractHash` announced alongside is a fingerprint **of exactly this
  text**, key order included, so a store can verify what it was handed rather
  than trust it. Runtime parser handles and cyclic references are dropped, so
  the entry is plain JSON — no live objects reach the store.

### Changed

- `announceRoutes(routes, meta)` entries gained the `schema` key. Additive: a
  1.17 consumer reading `method` and `path` sees the same values, and the route
  selection is unchanged — `hidden` routes and the adapter's own `docsPath`
  subtree are still excluded. Note that a store which previously received only
  addresses now receives contract shapes; if a store persists the inventory
  verbatim, the announced payload is larger than it was in 1.17.

- The field is **optional on the wire and in the types** (`schema?: unknown`).
  Projecting a route walks user-supplied schema objects — foreign getters and
  `toJSON` implementations — on the startup path, so a route that cannot be
  projected loses its `schema` and nothing else. Same fail-open rule the spec
  hashes already follow: never take down the host app's boot for an
  observability field.

### Compatibility

No breaking changes and no new runtime dependencies — the package still ships
zero. `announceRoutes` remains an **optional** store method: a store without it
is still called for nothing. Node `>=20`.

## [1.17.0] — 2026-08-01

Observability release. Up to 1.16 a drift store could answer "what broke" and
nothing else. It could not tell a route with **zero drift** apart from a route
with **zero traffic**, it never learned a route existed until a request drifted
on it, it saw request payloads but never responses, and it had no way to say
*which build* produced any of it. This release closes those four gaps.

Everything new is additive and gated on optional store methods: a store written
against 1.10–1.16 implements none of them, is called for none of them, and
behaves exactly as before. The drift hot path stays free when nobody is
listening.

### Added

- **Heartbeat counters** — one counter per route per window, so "no drift" is
  finally distinguishable from "no traffic". When a window closes the store's
  optional `recordHeartbeats(entries, windowStart)` is called with one entry per
  route that saw validated traffic:

  ```js
  {
    route: { method: 'POST', path: '/users/{id}' },
    validatedCount: 128,
    statusCounts: { '2xx': 126, '4xx': 2 }   // only when statuses were observed
  }
  ```

  Configured by **`drift.heartbeat`** (default `true`) and
  **`drift.heartbeatIntervalMs`** (default `60000`, clamped to a `5000`
  floor). The default is on, but counting never starts unless the store
  actually implements `recordHeartbeats` — a store without it owns no Map and
  no timer and costs one dead call per validated request, so existing setups
  are untouched. A store that throws or rejects cannot affect the host app.

- **Startup route inventory** — the optional `announceRoutes(routes, meta)` is
  called once per adapter mount, after the route list settles, so a store can
  surface routes no traffic has reached yet. Only visible routes are announced:
  `hidden` routes and the adapter's own `docsPath` subtree are excluded. Method
  and path only — the inventory reports which routes exist, it is not a schema
  export. `meta` carries `title`, `version`, and both spec hashes over exactly
  those routes, so a store need not fingerprint the inventory itself.

- **Spec hashes — `computeSpecHashes(routes)`.** Two deterministic fingerprints
  of a route list, both `'sha256:<hex>'`:

  - `contractHash` — the behavioural contract: methods, paths, request /
    response / error *schemas*, required and optional flags, types, enum /
    nullable / default values, security requirements, the `hidden` flag. Free
    text is excluded, so editing a description never moves it. Two builds with
    the same `contractHash` are interchangeable for a client.
  - `docHash` — everything the registry holds, free text included; any
    documented change moves it.

  Pure and deterministic — no I/O, no clock, no randomness, and the argument is
  never mutated — so a build step and a live process agree on the hash for the
  same code. Routes are sorted by `METHOD + ' ' + path` and every object key is
  sorted recursively by UTF-16 code unit (never `localeCompare`: a hash may not
  depend on the machine's locale).

- **Release auto-detect — `resolveRelease(options)`.** Answers "which build of
  the code is running", so drift can be attributed to a deploy. Returns
  `{ sha, branch, source }` or `null`. The chain is walked in a fixed order:
  explicit `release` option → `DOCTREEN_RELEASE` → known platform variables
  (Vercel, Render, Railway, Heroku, GitHub Actions, `SOURCE_VERSION`) → a
  `.doctreen-release.json` build stamp. The `.git` directory is **never** read
  and **no process is spawned** — a `.git` reader works in dev and silently
  fails in the production image, which is exactly where it matters. Fail-open
  without exception: a missing file, malformed JSON or an `env` that throws all
  degrade to `null`. Losing a sha costs a dashboard feature; throwing at boot
  would take down the host app.

- **`doctreen release stamp` CLI** — writes `.doctreen-release.json` (sha,
  branch, `stampedAt`) at build time for platforms that set no environment
  variables of their own, such as a bare VPS or a hand-rolled Docker build.
  Accepts `--out <dir>`, `--sha <sha>`, `--branch <branch>`. A stamp already
  sitting in the output directory is ignored — it is this command's own output,
  and honouring it would let a stale sha survive forever. Exits `1` rather than
  writing a useless stamp when no release can be determined.

- **Response drift.** A response that fails the declared status-aware assertion
  (`validate: { response: 'warn' | 'throw' }`) now feeds the drift pipeline as
  **`part: 'response'`**, alongside the existing `'body'` and `'query'`. The
  mismatch already computed by the assertion is translated directly — the
  payload is never re-diffed. Consistent with the pipeline's top-level-only
  rule, a nested path folds onto its root (`user.address.city` is reported as
  `field: 'user'`) and a mismatch on the response root itself is dropped. Drift
  events still carry **no payload values** — only field names, kinds and type
  names. `drift.sampleRate` governs the whole signal, request and response
  alike; it is one rate, not one per part.

- **`DriftEvent.count`** — occurrences an event stands for, always an integer
  `>= 1`; anything else normalises to `1`. Every counter the event feeds is
  scaled by it, so a pre-aggregating store can report one signature once per
  flush window instead of once per request. `count: 1` reproduces the pre-1.17
  arithmetic exactly.

- **`SPEC.md` and a language-neutral `conformance/` suite.** `SPEC.md` freezes
  the DocTreen route model — the shape of a schema, a route, a validation
  failure and a drift event — for anyone implementing DocTreen in another
  language. `conformance/` is its executable half: fixture route lists in,
  expected OpenAPI documents out, exercised below every framework adapter so a
  case needs no HTTP server. Both are repository material and are not shipped
  in the npm tarball. Where the document and this implementation disagree, the
  implementation is correct and the document is the bug.

### Changed

- `DriftReport` route entries now count `response` in `parts` alongside `body`
  and `query`, and `DriftEvent` carries `count`. Both are additive: a reader
  that ignores them sees the same numbers as before.
- Response validation resolution was consolidated so all five adapters share
  one path. In 1.16 only Fastify called `resolveResponseValidator`; the
  remaining four could drift apart from it.

### Compatibility

No breaking changes, and no new runtime dependencies — the package still ships
zero. `announceRoutes` and `recordHeartbeats` are **optional** store methods:
omit them and nothing is called, with no warning. Production behaviour is
unchanged — drift and validation remain gated on their existing `enabled`
defaults, and neither `'warn'` nor `'throw'` mutates a response body or status.
Node `>=20`.

## [1.16.0] — 2026-07-19

Response assertion learns about status codes. In 1.15, `validate: { response }`
asserted **every** response against the single success schema, regardless of the
status code — so every `4xx`/`5xx` produced a phantom "does not match the
declared schema" warning even when its body was a perfectly valid error
envelope. In a real integration suite the warning count matched the number of
error responses exactly. This release makes the assertion pick the schema for
the **actual** status code.

### Fixed

- **Status-aware response validation.** `validate: { response: 'warn' | 'throw' }`
  now asserts a response against the schema declared for its status: the
  `response` schema for a `2xx`, and the schema declared for that exact status
  (route-local `errors[status]`, then adapter `defaultErrors[status]`) for a
  `4xx`/`5xx`. A status declared with only a description — `errors: { 422: 'Validation' }` —
  or declared nowhere is no longer asserted, so error envelopes stop generating
  phantom success-schema warnings. Genuine `2xx` drift is still caught.

  Before / after, for a route with `response: staff` and `errors: { 422: 'Validation' }`
  that returns a `{ error, message }` envelope with status `422`:

  ```
  # 1.15 — one phantom warning per 4xx:
  [doctreen] response for POST /staff does not match the declared schema:
    - response.id: Required
    - response.name: Required
    - response.role: Required
    …

  # 1.16 — the 422 is recognised as an error envelope; no warning.
  ```

- **Warning message names the status and source.** A real mismatch now reads
  `response for POST /staff (422) does not match the schema declared for status
  422 (route errors)` — the status code and where the schema came from
  (`route errors` / `defaultErrors` / `response`) make the diagnosis obvious.

### Added

- **`validate: { warnUndeclaredStatus: true }`** (default `false`) — opt-in
  signal when a route returns a status that has no declared schema anywhere. Off
  by default so it never adds noise.

### Behavior change / migration

This is a bugfix and silencing the phantom warnings is the point, but the
warning stream is narrower than in 1.15. If you built a log filter around the
old noise, either drop it or set the escape hatch **`validate: { statusAware: false }`**
to restore the pre-1.16 behaviour (assert the single success schema against
every response). `statusAware` defaults to `true`. Production behaviour is
unchanged: the adapter remains a no-op when `NODE_ENV === 'production'` (the
default `enabled` gate), and `'warn'`/`'throw'` never mutate the body or status.

## [1.15.0] — 2026-07-04

Validation, completed — this release closes the gap between what a route
*documents* and what it *enforces*, and fixes the codegen type-safety holes
that pushed consumers back to hand-written types.

### Added

- **Path-parameter schemas + validation** — `defineRoute` now accepts
  `request: { params }`, so `:id` and friends are validated by the same Zod
  schema that documents them, with a structured 422 on mismatch. Works across
  Express, Fastify, Hono, Koa, and NestJS — no more hand-rolled `requireUuid`
  helpers repeated on every route.
- **Request write-back.** Opt in with `validate: { writeback: true }` and the
  *parsed* payload — Zod coercions and `.default()`s applied — is written back
  onto `req.body` / `req.query` / `req.params`, so the handler reads coerced
  values instead of re-parsing them. (Koa and Hono expose coerced path params
  via `ctx.state.doctreenValidated` / `c.get('doctreenValidated')`.)
- **Dev-mode response assertion.** `validate: { response: 'warn' | 'throw' }`
  checks the handler's response against the declared Zod `response` schema —
  `'warn'` logs a mismatch and passes through, `'throw'` surfaces a 500 in
  development. Never coerces the response.
- **Status-keyed responses.** `response: { 201: schema, 200: schema }` documents
  each status with its own schema and drives the OpenAPI export; the plain
  `response: schema` form still means `200`.
- **`defaultErrors` config.** Declare shared error responses (401 / 403 / 422 …)
  once — they merge into every route, with the route's own `errors` winning on a
  status conflict.
- **Standard `DoctreenValidationError` envelope.** Validated routes document
  their 422 `{ error, issues[] }` body as a named component, so codegen emits a
  `DoctreenValidationError` type and clients stop guessing the error shape.
- **Offline OpenAPI emit.** `getOpenApiDocument(app)` (on every adapter) and the
  new `doctreen emit-openapi` CLI build a static `openapi.json` without starting
  a server, so codegen and CI can run fully offline.

### Fixed

- **`defineSchema` now works with Zod schemas.** Named schemas were matched by
  object identity, which Zod→SchemaNode conversion breaks — so Zod-defined named
  schemas fell through to anonymous `Schema1` / `Schema2` types in codegen. They
  now emit `$ref: '#/components/schemas/<name>'` and codegen produces
  `interface User`, at the top level, nested, and inside arrays.
- **Deep schemas no longer collapse to `unknown`.** The Zod conversion depth cap
  was raised from 5 to 12, so deep-but-non-recursive trees (menu → categories →
  items → variants → options) keep their leaf types. Recursion is best expressed
  with `defineSchema`, which now emits a terminating `$ref`.

## [1.14.1] — 2026-07-02

### Fixed

- **`codegen` no longer emits invalid TypeScript for nullable objects.** A
  nullable object schema — OpenAPI 3.1 `type: ["object", "null"]` or 3.0
  `nullable: true` — renders as `{ … } | null`, which starts with `{` but is
  not a bare object body. The generator mistook it for an interface body and
  produced `export interface Profile { … } | null` (a syntax error). Such
  schemas now emit a valid `type` alias (`export type Profile = { … } | null`);
  plain objects still emit `export interface`.

## [1.14.0] — 2026-07-02

### Added

- **`s.enum`, `s.nullable`, `s.default`, and `s.literal` schema builders**. The
  `s` helper can now express value-level facets that previously had nowhere to
  live in a `SchemaNode`:

  ```js
  defineRoute(handler, {
    request: {
      body: s.object({
        role:   s.enum(['admin', 'user', 'guest']),
        status: s.nullable(s.enum(['active', 'inactive'])),
        limit:  s.default(s.number(), 20),
        kind:   s.literal('user'),
      }),
    },
  });
  ```

  These flow through to the exported OpenAPI document, the docs UI schema tree,
  and every request example (Copy as cURL, Postman export, mock server).

### Fixed

- **`defineRoute` now emits `enum` and `nullable`.** `SchemaNode` could only
  carry `type` / `properties` / `items` / `optional`, so enum members and
  nullability were dropped before reaching the OpenAPI export or docs UI —
  `z.enum([...])` collapsed to a bare `string` and `.nullable()` was demoted to
  `optional`. Both the `s` builder and the Zod converter now preserve them, and
  the exporter emits `enum` plus OpenAPI 3.1 `type: [<type>, 'null']`.

- **Default values are now applied in request examples.** A schema `default`
  (via `s.default(...)` or Zod `.default(...)`) is emitted to OpenAPI and seeds
  the generated request bodies and query parameters used by Copy as cURL, the
  Postman export, and the mock server. Fields with a default are treated as
  optional and excluded from `required`.

## [1.13.1] — 2026-07-02

### Fixed

- **`codegen` now emits every HTTP method on a shared path**. Operations that
  reused an `operationId` across HTTP verbs — or used a verb-agnostic
  `operationId` — collapsed to a single generated name, so the typed client
  silently kept only the last method on a path (e.g. `POST /users` clobbered
  `GET /users`).
  Generated type and function names are now guaranteed unique; colliding names
  are disambiguated by HTTP method (`usersGet` / `usersPost`).

- **`codegen` enum / nullable output is now correct.** A `null` present both in
  a 3.1 `type: ["string", "null"]` array (or via `nullable: true`) and in an
  `enum` produced a doubled union such as `"active" | "inactive" | null | null`.
  Nullability is now folded into a single trailing `| null` and enum members are
  deduplicated. Type coverage was extended along the way to `const` literals,
  `prefixItems` tuples, and closed objects (`additionalProperties: false` →
  `Record<string, never>`).

## [1.13.0] — 2026-06-25

### Added

- **`npx doctreen codegen` — typed clients from your OpenAPI doc.** Generate
  a strict TypeScript declaration file and a fully-typed fetch client from
  the same `/docs/openapi.json` that DocTreen already emits:

  ```bash
  npx doctreen codegen types  --from http://localhost:3000/docs --out src/api/types.d.ts
  npx doctreen codegen client --from http://localhost:3000/docs --out src/api/client.ts \
                              --base-url https://api.example.com
  ```

  The `types` output mirrors `components.schemas` 1:1 as `export interface`
  declarations and emits per-operation `…Params` / `…Query` / `…Body` /
  `…Response` shapes. The `client` output is a single self-contained file
  exporting `createClient({ baseUrl, fetch?, headers?, onRequest? })` with
  one async method per operation, e.g. `await api.getUsersById({ params: { id: '1' } })`
  — every argument and return value typed end-to-end. Errors come back as
  `DoctreenHttpError` carrying `status` and the parsed body.

- **`--watch [ms]` flag.** Re-generate on change. Polls URL sources every
  `<ms>` (default 2000ms); uses `fs.watch()` for file sources. Skips the
  write when the output is byte-identical so editor file-watchers stay
  quiet.

- **Programmatic `doctreen/codegen` entry point.** `generateTypes(doc, opts?)`,
  `generateClient(doc, opts?)`, and `loadOpenApiDoc(from)` exported for
  build scripts that want to inline codegen.

### How it fits

Works with any OpenAPI 3.x document — not just DocTreen-emitted ones. The
generated client has zero dependencies (uses global `fetch`) and is safe
to check in alongside the rest of your source.

## [1.12.0] — 2026-05-27

### Added

- **`npx doctreen mock` — spec-driven mock server.** Spin up an
  Express-backed fake of any OpenAPI 3.x document in seconds:

  ```bash
  npx doctreen mock --from http://localhost:3000/docs --port 4000
  npx doctreen mock --from ./openapi.json --latency 100-500 --error-rate 0.1
  ```

  Routes, schemas, examples, and `$ref`s are read straight from the
  spec; responses come from the same schema→example generator that
  powers the docs UI. When `@faker-js/faker` is installed, fields with
  recognisable names (`email`, `name`, `uuid`, `createdAt`, …) and
  OpenAPI `format` strings (`uuid`, `email`, `date-time`, `uri`, …) get
  realistic values — without it, output is a deterministic placeholder.

- **In-memory CRUD short-circuits.** `POST /resource`, `GET /resource`,
  `GET /resource/:id`, `PUT|PATCH /resource/:id`, `DELETE /resource/:id`
  share a per-resource store keyed by the first non-version path
  segment. POST returns 201 with a stamped `id` + `createdAt`; GET reads
  back what was created. Envelope responses
  (`{ products: [...], total, filters }`) are handled — the array is
  swapped in, the rest of the envelope is regenerated from the schema.
  Pass `--no-crud` to disable and always return synthesised examples.
  Pass `--persist <file>` to save the store to a JSON file across
  restarts.

- **Latency + error injection.** `--latency 200` adds a fixed delay,
  `--latency 100-500` picks a random ms in range. `--error-rate 0.1`
  returns a randomly-selected declared 4xx/5xx response 10 % of the
  time — useful for shaking out frontend error paths.

- **`@faker-js/faker` is an optional peer.** doctreen lazy-requires it;
  install only when you want richer examples. `--no-faker` forces
  placeholder output even when faker is present.

- **Public schema→example helper.** The internal generator that powered
  Copy-as-cURL and Postman export is now a first-class export at
  `doctreen/example`:

  ```js
  const { generateExample } = require('doctreen/example');
  generateExample({ type: 'object', properties: { email: { type: 'string', format: 'email' } } });
  // → { email: 'user@example.com' }  (or a Faker email if installed)
  ```

  Accepts both doctreen `SchemaNode` and OpenAPI Schema Objects (with
  `$ref` resolved via the `components` option).

- **Programmatic mock API.** Import `doctreen/mock` to embed the mock
  server in your own scripts or tests:

  ```js
  const { startMockFromOpenApi } = require('doctreen/mock');
  const { server } = await startMockFromOpenApi({ from: './openapi.json', port: 4000 });
  // …
  server.close();
  ```

### Migration

No breaking changes for existing v1.11.x consumers. New exports
(`doctreen/mock`, `doctreen/example`) are additive.

## [1.11.0] — 2026-05-27

### Added

- **`components.schemas` with `$ref` dedup.** Schemas registered via
  `defineSchema('Name', …)` are now promoted to `components.schemas.Name`
  and every occurrence in `requestBody` / `responses` / `parameters` is
  replaced with a single `$ref`. Anonymous object schemas with three or
  more properties that appear in two or more places are also
  auto-promoted under stable `Schema1`, `Schema2`, … names. The exported
  spec stays self-contained but no longer ships the same shape inlined
  dozens of times.

- **Per-route + top-level tags.** `defineRoute({ tags: ['users'] })` and
  `@DocRoute({ tags: ['users'] })` override the legacy first-path-segment
  default. Top-level metadata lives at `config.openapi.tags`:

  ```js
  openapi: {
    tags: [
      { name: 'users', description: 'User account management' },
      { name: 'billing', description: 'Invoices + payment methods' },
    ],
  }
  ```

  Tags used by routes but not declared at the top level are auto-appended
  without metadata so the spec always validates.

- **OpenAPI 3.1 callbacks + webhooks.** Per-operation callbacks via
  `defineRoute({ callbacks: { onPaymentSucceeded: { url, method, request, response } } })`,
  document-level webhooks via `config.openapi.webhooks: { userCreated: { method, request, response } }`.
  Both reuse the same request/response/error pipeline as routes — Zod or
  SchemaNode supported, `$ref` dedup applies.

- **Multi-example bodies and responses.**

  ```js
  defineRoute(handler, {
    examples: {
      request: {
        basic: { value: { ... }, summary: 'Minimum' },
        admin: { value: { ... }, summary: 'With role' },
      },
      response: { id: 1, name: 'Ada' },                  // single example
      responses: { 422: { value: { errors: [...] } } },  // per-status-code
    },
  });
  ```

  Renders as OpenAPI `example` (single) or `examples` (named map) on the
  corresponding Media Type Object. Aliases: `body` → `request`,
  `success` → `response`.

- **`doctreen lint openapi`.** Spectral-lite linter for the exported (or
  any) OpenAPI 3.x document. Catches duplicate operationIds, missing
  `info.title`/`version`, undeclared path params, untagged operations,
  unused `components.schemas` entries, missing 4xx responses, missing
  tag descriptions.

  ```bash
  npx doctreen lint openapi --url http://localhost:3000/docs --fail-on warning
  npx doctreen lint openapi --file ./build/openapi.json --no-info
  ```

  Exit code 1 when the configured `--fail-on` threshold is reached —
  drop into CI alongside `drift report`.

### Migration

No breaking changes for existing v1.10.x consumers.

- Specs that previously inlined the same schema multiple times will now
  see `$ref`s. Spec validators (Spectral, Redocly) handle this natively;
  custom consumers reading SchemaObjects directly must follow `$ref`s
  (one extra hop through `components.schemas`).
- `tagFor()` is no longer exported from `src/exporters/openapi.js`;
  replaced by `defaultTagFor()`. Public API consumers were unlikely to
  reach into the exporter directly, but if you did: rename.

## [1.10.1] — 2026-05-27

### Added

- **Drift store reset endpoint.** `POST <docsPath>/drift/reset` clears the
  in-memory store on demand — useful between integration test runs, after
  deploys, or when a known bad client has finished its run. Opt-in via
  `drift.allowReset: true`; optionally protected by `drift.resetToken`
  matched against the `x-doctreen-drift-token` header or `?token=` query
  param. Available on all five adapters.

  ```js
  expressAdapter(app, {
    drift: {
      enabled: true,
      allowReset: true,
      resetToken: process.env.DOCTREEN_RESET_TOKEN,
    },
  });
  ```

- **`doctreen drift reset` CLI.** Companion to `drift report`. POSTs to
  `/drift/reset`, prints a confirmation, exits non-zero on failure.

  ```bash
  npx doctreen drift reset --url http://localhost:3000/docs --token "$DOCTREEN_RESET_TOKEN"
  ```

- **Daily buckets in drift report.** Alongside the existing rolling 24-hour
  hourly buckets, the store now keeps a rolling 7-day daily aggregate per
  route under `dailyBuckets`. Same dedup window, same sampling, no extra
  cost — exposed in `/drift.json` for dashboards that want a longer view
  than 24h.

- **Redis-backed `DriftStore` reference implementation.**
  `example/drift-redis-store.js` ships a complete, multi-replica-safe
  implementation of the `DriftStore` interface for `ioredis` / `redis@4+`
  (bring your own client). Drop-in for production deployments that need
  aggregates to survive restarts and stay consistent across replicas.

### Migration

No breaking changes. The reset endpoint defaults to disabled — existing
v1.10.0 servers behave identically until `allowReset` is flipped.

`dailyBuckets` is a new top-level field in the per-route report payload;
existing consumers continue to read `buckets` (hourly) unchanged.

## [1.10.0] — 2026-05-27

### Added

- **Production-grade schema drift detection.** The experimental v1.5
  `console.warn` is now a structured pipeline with an in-memory aggregator,
  per-route counters and hourly buckets, opt-in sampling (default 1%), a
  pluggable store interface for Redis / Postgres / etc., an `onDrift`
  callback, and fire-and-forget webhook dispatch. Every adapter
  (Express, Fastify, Hono, Koa, NestJS) emits events through the same
  pipeline so behaviour is uniform across frameworks.

  ```js
  expressAdapter(app, {
    drift: {
      enabled: true,
      sampleRate: 0.05,
      webhook: 'https://hooks.example.com/drift',
      onDrift: (event) => metrics.increment('api.drift', event.issues.length),
    },
  });
  ```

  Defaults: enabled when `NODE_ENV !== 'production'`, `sampleRate: 0.01`,
  `logLevel: 'warn'`. Pass `drift: false` to disable entirely.

- **`GET <docsPath>/drift.json`.** Every adapter exposes an aggregated
  drift report — totals per route, kind breakdown (`missing-required`,
  `unexpected-field`, `type-mismatch`), top fields, rolling hourly
  buckets, and the last N samples per route. The same payload powers
  the UI tab and the CLI.

- **UI: Drift tab.** A new header tab appears in the docs page when
  drift is enabled. Shows total issues, routes affected, kind breakdown,
  and the latest sample per route. Routes with active drift get an
  inline `DRIFT N` badge in the routes table. The tab fetches
  `/drift.json` on activation and refreshes manually.

- **CLI: `npx doctreen drift report`.** Umbrella CLI (new `doctreen`
  binary) that hits the running server's `/drift.json` and prints a
  CI-friendly summary. `--fail-on-mismatch` exits non-zero when drift
  is present; `--json` emits the raw payload; `--route <pattern>`
  filters by path substring.

  ```
  npx doctreen drift report --url http://localhost:3000/docs --fail-on-mismatch
  ```

- **`DriftStore` interface.** Plug an external store (Redis, Postgres,
  external aggregator) by passing `drift.store` — any object with
  `record(event)`, `report()`, `reset()` works.

### Changed

- The v1.5 experimental drift `console.warn` is now centralised in
  `src/internal/drift-store.js`. The same log line still fires for
  the default in-memory store (per unique drift signature, deduped),
  but it now also feeds the structured pipeline. Pass `drift.logLevel:
  'silent'` to suppress the log without disabling detection.

- Per-route `requestSchemaDeclared` is now set consistently across all
  adapters when a schema comes from `defineRoute`, `@DocRoute`, JSDoc,
  or Fastify native JSON Schema — so drift detection applies
  uniformly regardless of how the schema was provided.

- Roadmap: v1.10 ticked. Next headline is **OpenAPI polish** (`$ref`
  dedup, first-class tags, callbacks/webhooks, multi-example, `npx
  doctreen lint openapi`).

### Migration

No breaking changes. The experimental v1.5 drift detection is fully
backward compatible — the warning still fires for unique mismatches.

To opt into the new aggregated report and UI in **production**, flip
the gate:

```js
expressAdapter(app, { drift: { enabled: true, sampleRate: 0.01 } });
```

At a 1% sample rate the runtime cost is negligible. The store retains
24 hours of hourly buckets per route and the most recent 5 samples,
both configurable.

## [1.9.0] — 2026-05-26

### Added

- **`headHtml` config option.** Pass a raw HTML string and DocTreen
  appends it to the docs UI `<head>` — useful for analytics scripts
  (Vercel Analytics, Plausible, PostHog), favicons, custom theme-color
  / OG / Twitter meta tags, branded web fonts, or extra CSS overrides.
  Trusted input only; DocTreen does not sanitise, so callers must not
  pipe user-submitted data through this option.

  ```js
  expressAdapter(app, {
    headHtml: '<script defer src="/_vercel/insights/script.js"></script>',
  });
  ```

  Implementation: `normalizeConfig` defaults `headHtml` to `null`; the
  generated HTML template emits the string between the built-in
  `<style>` block and `</head>`.

### Changed

- Live demo (`api/index.js`) now wires up Vercel Analytics + Speed
  Insights through the new `headHtml` option so the dashboards at
  vercel.com/can-dgrmcs-projects/doctreen/analytics start collecting
  /docs traffic once enabled.
- README gains a new "Inject custom HTML into the docs `<head>`"
  subsection under OpenAPI Export covering the option, its trust
  model, and the demo's own usage.
- Roadmap: v1.9 ticked; production-grade drift detection remains the
  next headline.

### Migration

No breaking changes. `headHtml` is purely additive; omit it and the
UI renders exactly as in v1.8.

## [1.8.0] — 2026-05-26

### Added

- **`securitySchemes` + per-route `security`.** OpenAPI security can now
  be declared once and attached automatically: pass
  `config.openapi.securitySchemes` to register the schemes (Bearer,
  ApiKey, OAuth2, …), and `config.openapi.security` for the global
  default. Per-route overrides with `defineRoute({ security: [...] })`
  or `@DocRoute({ security: [...] })`; pass `security: []` to mark a
  route explicitly public when there's a global default. When a route
  has any effective security requirement, the `Authorization` header
  is auto-stripped from `parameters[]` so Redocly's `security-defined`
  rule passes cleanly.
- **`hidden: true` per route.** `defineRoute({ hidden: true })`,
  `@DocRoute({ hidden: true })`, or the new `@DocHidden()` shorthand
  removes a route from the docs UI and the OpenAPI export while
  leaving it fully reachable at runtime. Useful for internal /
  experimental endpoints.
- **`config.openapi.servers`.** Declare your environments once:
  `{ openapi: { servers: [{ url: 'https://api.example.com', description: 'Prod' }] } }`.
  Defaults to `[{ url: '/' }]` (same origin as the docs page) when
  omitted.
- New `RouteRegistry.getVisible()` returns the same sorted snapshot as
  `getAll()` minus any entry marked `hidden: true`. The docs UI and
  the OpenAPI exporter use this; `getAll()` behaviour is unchanged.
- Type surface tightened: `UserConfig` now declares `validate` (back-
  filled from v1.6) and the new `openapi` block; `RouteEntry` lists
  the runtime-attached `requestValidators`, `validateOverride`,
  `hidden`, and `security` fields; `RouteRegistry` gains type stubs
  for `getVisible`, `find`, and `findByRequestPath` that the runtime
  has had since v1.6/v1.8.

### Changed

- Comparison table picks up two new rows (`securitySchemes` /
  per-route `security`, and hide-a-route).
- README "OpenAPI Export" section grows three subsections covering
  servers + security configuration, hidden routes, and a one-block
  recap of the spec-validation CI hooks.
- Roadmap reshuffled: v1.8 items ticked; production-grade drift
  reporting moves up to the next-headline slot.

### Migration

No breaking changes. Hidden / security fields are purely additive and
default to "no change in behaviour" when omitted.

## [1.7.0] — 2026-05-26

### Added

- **OpenAPI 3.1 export.** Every adapter now serves the OpenAPI 3.1
  document at `<docsPath>/openapi.json`, and the docs UI ships with a
  one-click "Export to OpenAPI 3.1" download button next to "Export to
  Postman". The spec is built from the same Zod-or-`s`-builder schemas
  that already drive the UI, so there is no separate annotation or
  spec file to maintain. Drop the document into Scalar, Redoc, Swagger
  UI, editor.swagger.io, or any other spec-driven tool and it renders
  immediately.
- New `src/exporters/openapi.js` module exposing
  `buildOpenApiDocument(routes, config)` for use outside the adapter
  (e.g. generating the spec at build time).
- Spec includes path parameters (`:id` → `{id}`), query parameters
  derived from `request.query`, request headers as
  `parameters[].in = header`, JSON request body with `required[]`
  derived from the Zod schema, 200 / 201 success responses (201 for
  POST), every declared error response with its own schema, and tags
  grouped by the first non-empty path segment.
- A relative `servers: [{ url: '/' }]` default so Swagger UI's
  "Try it out" works against the live host without manual config.

### Changed

- Comparison table in README marks OpenAPI 3.1 export as "Yes
  (built-in)".
- Roadmap reshuffled: validation and OpenAPI both ticked off;
  next big items are first-class `openapi.servers` config +
  `securitySchemes` and production-grade drift reporting.
- README opens with a new bullet pointing at the OpenAPI export
  alongside the docs UI / runtime validation lines, and a new
  "OpenAPI Export" section walks through the curl command + how to
  paste into a renderer.

### Out of scope (deferred to v1.8+)

- `securitySchemes` / `security` declarations — `Authorization` and
  similar headers currently render as plain `parameters[].in = header`
  entries, which Redocly's `security-defined` lint rule flags as a
  best-practice violation. The document still passes the official
  OpenAPI 3.1 schema (`@apidevtools/swagger-cli` validates it).
- `callbacks`, `webhooks`, `links`.
- `$ref`-based schema deduplication — every schema is inlined.

### Migration

No breaking changes. The new endpoint is additive; existing routes are
untouched. Existing v1.5 / v1.6 user code keeps working without
modification.

## [1.6.1] — 2026-05-26

<!-- whatsnew-skip -->

### Changed

- README now opens with a "What's new in v1.6.0" callout linking to the
  GitHub release page and `CHANGELOG.md`. The npm package page only
  renders `README.md`, so this is the only way to surface release notes
  for visitors landing on https://www.npmjs.com/package/doctreen.
- Added `scripts/update-release-callout.js` and a `version` lifecycle
  hook so subsequent `npm version <bump>` runs regenerate the callout
  automatically from the CHANGELOG entry being published.

No user-facing code changes in this release.

## [1.6.0] — 2026-05-26

### Added

- **Runtime validation middleware.** The Zod schema declared via
  `defineRoute` / `@DocRoute` now optionally validates each incoming
  request before the handler executes. Invalid payloads short-circuit
  with a structured 422 response:
  ```
  { "error": "validation_failed", "issues": [{ path, message, code }, …] }
  ```
  Enable it once per adapter: `expressAdapter(app, { validate: true })`.
  Per-route override via `defineRoute({ validate: false })` or
  `defineRoute({ validate: true })`. Async refinements work via
  `safeParseAsync`. Available on all five adapters (Express, Fastify,
  Hono, Koa, NestJS).
- `RouteRegistry.find(method, path)` for exact-pattern lookup and
  `RouteRegistry.findByRequestPath(method, actualPath)` for concrete
  URL lookup with `:param` matching — used by the request-time validation
  hooks on Hono, Koa, and NestJS.
- `src/internal/validate.js` — the shared Zod safeParseAsync runner,
  issue formatter, and `shouldValidate(adapterDefault, perRouteOverride)`
  resolver.
- Top-level `tsconfig.json` so `npx tsx` runs the NestJS example with
  experimentalDecorators + emitDecoratorMetadata enabled.

### Changed

- **Positioning sharpened.** The tagline now reads *"One Zod schema per
  route. Get docs, integration tests, **and** runtime validation. No
  OpenAPI YAML."* The comparison table gained a "Runtime request
  validation" row.
- `normalizeRouteSchemas` keeps original Zod schemas in an internal
  `validators` slot alongside the SchemaNode conversion so runtime
  validation can call `.safeParseAsync` against the exact schema the
  user defined — refinements, custom messages, async checks all
  survive.
- Roadmap reshuffled: runtime validation now ticked off; OpenAPI 3.1
  export and drift-on-remaining-adapters are the next big items.
- Live demo (`api/index.js`) now opts in with `validate: true` so the
  live UI demonstrates the v1.6 feature end-to-end.
- `package.json` description and keywords mention `validation` and
  `request-validation`.

### Migration

No breaking changes — validation is opt-in. Existing code with no
`validate: true` flag continues to behave exactly as in v1.5.

If you were hand-rolling a NestJS pipe or Express middleware that ran
`zodSchema.parse(req.body)` for every endpoint, you can replace it with
the adapter flag plus your existing `defineRoute` / `@DocRoute`
declarations.

## [1.5.0] — 2026-05-26

### Added

- **Direct Zod support on every adapter.** `defineRoute`, `@DocRoute`, and the
  individual `@Doc*` decorators now accept Zod schemas in `request.body`,
  `request.query`, `response`, and `errors[*].schema` slots — no
  `zodToSchemaNode()` wrapping required. Conversion happens once at
  definition time via a shared `src/internal/schemas.js` helper. Express,
  Fastify, Hono, and Koa join NestJS in handling Zod out of the box.
- **Schema Drift Detection (experimental).** When an Express route's request
  schema is declared via `defineRoute` or JSDoc, DocTreen compares each
  incoming payload against it and logs a one-line warning to `console.warn`
  for missing required fields, unexpected fields, or type mismatches. Runs
  only when `NODE_ENV !== 'production'` and de-duplicates per
  `(route, drift-signature)` to prevent log flooding.
- **Vercel-ready live demo.** A single-file Express + Zod app under
  `api/index.js` plus root-level `vercel.json` so the docs UI can be
  deployed publicly with `vercel --prod` from a fresh clone.
- **Roadmap section in README** covering OpenAPI 3.1 export (next release),
  runtime validation middleware, drift hooks on the remaining four
  adapters, a `doctreen init` CLI, DocTreen Cloud, and long-term Python /
  Go adapters.
- `SchemaInput` and `ZodSchemaLike` exported from `doctreen/zod` for use in
  TypeScript code that needs to accept "either" a SchemaNode or a Zod
  schema.

### Changed

- **Positioning rewrite.** README now leads with *"One Zod schema per route.
  Get docs, integration tests, and runtime schema drift detection. No
  OpenAPI YAML."* The opening section also includes a comparison table
  against `@nestjs/swagger`, Scalar / Redoc, and `ts-rest` so newcomers can
  place DocTreen in 30 seconds.
- **Runtime traffic inference repositioned.** Sampling real HTTP traffic to
  fill in undeclared schemas is now framed as a gap-filler for development —
  not a primary feature. The same hook is the seam where Schema Drift
  Detection runs against declared schemas.
- `package.json` description and keywords rewritten to highlight Zod,
  code-first, integration tests, and schema-drift. Per-framework `-docs`
  keywords added for npm search discoverability.
- TypeScript adapter declarations now use a shared `SchemaInput` type
  (exported from `doctreen/zod`) instead of duplicating an inline
  `SchemaNode | { _def: any }` union per adapter.

### Removed

- The "Using `zodToSchemaNode` with other adapters" README section. The
  helper still exists as a standalone export, but adapters no longer
  require its use.

### Fixed

- NestJS adapter's previously duplicated `convertSchema` helper is now a
  thin re-import from `src/internal/schemas.js`. No behavioural change —
  just removes the duplicate definition.

### Migration

No breaking changes. Code that passes `SchemaNode` objects to `defineRoute`
or the `@Doc*` decorators continues to work unchanged. The new
Zod-direct form is purely additive.

If you were previously wrapping Zod schemas manually:

```diff
- import { zodToSchemaNode } from 'doctreen/zod';
- defineRoute(handler, { request: { body: zodToSchemaNode(MySchema) } });
+ defineRoute(handler, { request: { body: MySchema } });
```

Both forms work; the new form is recommended.

## [1.4.3] — earlier

NestJS adapter support, Hono and Koa adapters, Postman export, request
flow runner, and the v1.x foundation. See git history for details.
