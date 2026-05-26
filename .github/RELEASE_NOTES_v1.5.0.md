# DocTreen v1.5.0 — Code-first, Zod-first API docs

This release sharpens DocTreen's positioning and lands two long-running
items: a single Zod schema is now enough for every adapter, and declared
schemas now warn you when reality diverges from documentation.

## What's new

🎯 **New positioning.** *One Zod schema per route. Get docs, integration
tests, and runtime schema drift detection. No OpenAPI YAML.* The README
has been rewritten to lead with this message, with a comparison table
against `@nestjs/swagger`, Scalar / Redoc, and `ts-rest` so newcomers can
place DocTreen in 30 seconds.

🧹 **Direct Zod on every adapter.** `defineRoute({ request: { body: zodSchema } })`
now works on Express, Fastify, Hono, Koa, *and* NestJS — no more wrapping
in `zodToSchemaNode()`. Conversion happens once at definition time.

🔍 **Schema Drift Detection (experimental).** When a route's schema is
declared (via `defineRoute` or JSDoc) on the Express adapter, DocTreen
compares each incoming payload against it and logs a one-line warning
for missing fields, unexpected fields, and type mismatches. Dev-only,
de-duplicated, zero noise on a green path. Other adapters get drift
hooks in a follow-up.

🚀 **Live demo, deployable.** A new `api/index.js` + `vercel.json`
scaffolds a one-command Vercel deploy of the docs UI. See
[`api/README.md`](./api/README.md).

🛣️ **Public roadmap.** OpenAPI 3.1 export ships in v1.6. Runtime
validation middleware, drift hooks on remaining adapters, a
`doctreen init` CLI, and DocTreen Cloud are all on the docket.

## Migration

No breaking changes — this is a drop-in upgrade. If you were wrapping Zod
schemas by hand:

```diff
- import { zodToSchemaNode } from 'doctreen/zod';
- defineRoute(handler, { request: { body: zodToSchemaNode(MySchema) } });
+ defineRoute(handler, { request: { body: MySchema } });
```

Both forms continue to work; the new form is recommended.

## Try it

```bash
npm install doctreen@latest
```

Or play with the [live demo →](https://demo.doctreen.dev/docs).

---

Full changelog: [CHANGELOG.md](./CHANGELOG.md).
Feedback welcome — [open an issue](https://github.com/CanDgrmc/doctreen/issues) or start a discussion.
