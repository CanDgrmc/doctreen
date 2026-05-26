# Changelog

All notable changes to this project are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/).

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
