# DocTreen

**One Zod schema per route. Get docs, integration tests, *and* runtime validation. No OpenAPI YAML.**

[**Docs →**](https://doctreen.dev) &nbsp;·&nbsp; [**Live demo →**](https://demo.doctreen.dev/docs) &nbsp;·&nbsp; [npm](https://www.npmjs.com/package/doctreen) &nbsp;·&nbsp; [Changelog](./CHANGELOG.md) &nbsp;·&nbsp; [Roadmap](https://doctreen.dev/docs/roadmap) &nbsp;·&nbsp; License: MIT

<!-- whatsnew:start -->
> **What's new in v1.15.0** &nbsp;—&nbsp; **Path-parameter schemas + validation** — `defineRoute` now accepts `request: { params }`, so `:id` and friends are validated by the same Zod schema that documents them, with a structured 422 on mismatch. **[Read the release notes →](https://github.com/CanDgrmc/doctreen/releases/tag/v1.15.0)**
<!-- whatsnew:end -->

DocTreen is a code-first API documentation library for Node.js. Define your route shape once with Zod (or DocTreen's own schema builder) and you get an interactive docs UI, OpenAPI 3.1 export, runnable integration flows, and 422-on-invalid-request validation — for **Express, Fastify, Hono, Koa, and NestJS**. No router rewrite, no separate spec file, no decorator boilerplate on every DTO field.

![DocTreen UI](https://raw.githubusercontent.com/CanDgrmc/doctreen/main/example/ss-1.png)

---

## What you get

- **Interactive docs UI** at `/docs` — zero-dependency HTML, served by the same Node process
- **OpenAPI 3.1 export** at `/docs/openapi.json` — drop into Scalar, Redoc, Swagger UI, or any spec-driven tool
- **Runtime validation** — opt in with `validate: true`; invalid requests are rejected with a structured 422 before they reach your handler
- **Schema drift detection** — sample real traffic, compare against declared schemas, surface mismatches in a UI tab, `/drift.json`, and a CI-ready CLI
- **Mock server** — `npx doctreen mock --from <url|file>` synthesises a spec-driven fake API with CRUD short-circuits, latency / error injection, and optional Faker
- **Typed codegen** — `npx doctreen codegen types|client --from <url|file>` emits strict TypeScript declarations and a zero-dependency typed fetch client from your OpenAPI doc
- **Runnable integration flows** + **Postman Collection v2.1** export
- **5 adapters** sharing one config object: Express · Fastify · Hono · Koa · NestJS

Full feature matrix and comparison with `@nestjs/swagger`, `ts-rest`, and Scalar / Redoc: **[doctreen.dev →](https://doctreen.dev)**

---

## Install

```bash
npm install doctreen
```

Optional peers:

```bash
npm install zod                       # Zod schema support
npm install reflect-metadata rxjs     # NestJS
npm install --save-dev @faker-js/faker # realistic mock-server values
```

---

## Quick example (Express)

```js
const express = require('express');
const { z } = require('zod');
const { expressAdapter, defineRoute } = require('doctreen/express');

const app = express();
app.use(express.json());

app.post('/users', defineRoute(
  (req, res) => res.status(201).json({ id: 1, ...req.body }),
  {
    description: 'Create a user',
    request:  { body: z.object({ name: z.string(), email: z.string().email() }) },
    response: z.object({ id: z.number(), name: z.string(), email: z.string() }),
    errors:   { 409: 'Email already in use' },
  }
));

// Mount after your routes; turn on runtime validation in one place.
app.use(expressAdapter(app, {
  meta: { title: 'My API', version: '1.0.0' },
  validate: true,
}));

app.listen(3000, () => console.log('Docs at http://localhost:3000/docs'));
```

That single declaration drives:

- `GET /docs` — interactive UI
- `GET /docs/openapi.json` — OpenAPI 3.1 spec
- `POST /users` with `{ "email": "nope" }` — `422` with structured issues
- Postman collection download + LLM-friendly markdown for the route

**Fastify, Hono, Koa, and NestJS examples →** [doctreen.dev/docs/quick-start](https://doctreen.dev/docs/quick-start)

---

## Docs

Everything lives at **[doctreen.dev](https://doctreen.dev)**:

| | |
|---|---|
| **[Quick start](https://doctreen.dev/docs/quick-start)** | Mount the docs UI on your existing app in under five minutes |
| **[Adapters](https://doctreen.dev/docs/adapters)** | Per-framework guides for Express, Fastify, Hono, Koa, NestJS |
| **[Zod integration](https://doctreen.dev/docs/zod)** | First-class Zod support on every adapter |
| **[Runtime validation](https://doctreen.dev/docs/features/runtime-validation)** | Reject invalid requests with a structured 422 |
| **[OpenAPI 3.1 export](https://doctreen.dev/docs/features/openapi-export)** | `$ref` dedup, tags, callbacks, webhooks, multi-example, `lint openapi` CLI |
| **[Mock server](https://doctreen.dev/docs/features/mock-server)** | `npx doctreen mock --from <url|file>` |
| **[Typed codegen](https://doctreen.dev/docs/features/codegen)** | `npx doctreen codegen types\|client --from <url|file>` |
| **[Schema drift detection](https://doctreen.dev/docs/features/schema-drift)** | Sampling, buckets, CI integration, pluggable Redis store |
| **[Request flows](https://doctreen.dev/docs/features/request-flows)** | Named integration flows, `doctreen-flow` CLI |
| **[Configuration](https://doctreen.dev/docs/configuration)** | All adapters accept the same config object |
| **[TypeScript](https://doctreen.dev/docs/reference/typescript)** | `.d.ts` shipped — no `@types/doctreen` needed |

---

## Example apps

The [`example/`](./example) folder ships runnable apps — one per adapter:

```bash
npm run example             # Express JS     → http://localhost:3000/api/docs
npm run example:fastify     # Fastify JS     → http://localhost:3001/api/docs
npm run example:hono        # Hono JS        → http://localhost:3002/api/docs
npm run example:koa         # Koa JS         → http://localhost:3003/api/docs
npm run example:nest        # NestJS TS      → http://localhost:3001/docs
```

Each adapter also has a fully-typed TS variant (`npm run example:ts`, `:fastify:ts`, `:hono:ts`, `:koa:ts`).

---

## Roadmap

**Shipped:** runtime validation (v1.6) · OpenAPI 3.1 export (v1.7) · security schemes + hidden routes (v1.8) · `headHtml` (v1.9) · schema drift detection (v1.10) · `$ref` dedup, tags, callbacks/webhooks, examples, `lint openapi` (v1.11) · spec-driven mock server (v1.12) · typed TS codegen + fetch client (v1.13) · schema enums/nullable/defaults (v1.14) · validation completeness — path-param schemas, coerce/default write-back, response assertions, status-keyed responses, `defaultErrors`, Zod `$ref` codegen, offline `emit-openapi` (v1.15)

**Next up:** AI-native endpoints (`/llm.txt`, MCP server) · contract testing & spec diff · `doctreen init` CLI

Full roadmap with rationale: **[doctreen.dev/docs/roadmap](https://doctreen.dev/docs/roadmap)**

Have a feature request? [Open an issue →](https://github.com/CanDgrmc/doctreen/issues)

---

## License

MIT
