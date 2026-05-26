# Changelog

All notable changes to this project are documented here. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/).

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
