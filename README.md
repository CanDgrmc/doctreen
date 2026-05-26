# DocTreen

**One Zod schema per route. Get docs, integration tests, *and* runtime validation. No OpenAPI YAML.**

[**Try the live demo →**](https://demo.doctreen.dev/docs) &nbsp;·&nbsp; [npm](https://www.npmjs.com/package/doctreen) &nbsp;·&nbsp; [Changelog](./CHANGELOG.md) &nbsp;·&nbsp; [Roadmap](#roadmap) &nbsp;·&nbsp; License: MIT

<!-- whatsnew:start -->
> **What's new in v1.8.0** &nbsp;—&nbsp; **`securitySchemes` + per-route `security`.** OpenAPI security can now be declared once and attached automatically: pass `config.openapi.securitySchemes` to register the schemes (Bearer, ApiKey, OAuth2, …), and `config.openapi.security`… **[Read the release notes →](https://github.com/CanDgrmc/doctreen/releases/tag/v1.8.0)**
<!-- whatsnew:end -->

DocTreen is a code-first API documentation library for Node.js. Define your route shape once with Zod (or DocTreen's own schema builder), and it generates an interactive docs UI, runnable integration flows, and Postman exports for **Express, Fastify, Hono, Koa, and NestJS** — no router rewrite, no separate spec file, no decorator boilerplate on every DTO field.

![DocTreen UI](https://raw.githubusercontent.com/CanDgrmc/doctreen/main/example/ss-1.png)
![DocTreen UI](https://raw.githubusercontent.com/CanDgrmc/doctreen/main/example/ss-2.png)

---

## Why DocTreen?

Most API doc tools force you to pick one of three trade-offs:

- **Spec-first** (OpenAPI YAML): write the spec, then keep it in sync with code. Spec drifts.
- **Annotation-heavy** (`@nestjs/swagger`, `swagger-jsdoc`): decorate every property of every DTO. Boilerplate compounds.
- **Framework-locked** (`ts-rest`, Hono RPC): rewrite your router. Migration pain.

DocTreen sits next to your existing router. Pass a Zod schema to `defineRoute` (or `@DocRoute` on NestJS) once, and you get:

- An interactive docs UI at `/docs` — zero-dependency HTML, served by the same Node process
- **OpenAPI 3.1 export** at `/docs/openapi.json` and a one-click download button — drop the file into Scalar, Redoc, Swagger UI, or any spec-driven tool
- **`securitySchemes` + per-route `security`** *(v1.8)* — declare auth schemes once, attach them automatically; the spec passes Redocly's `security-defined` rule cleanly
- **`hidden: true` per route** *(v1.8)* — keep internal endpoints serving traffic but invisible to docs / OpenAPI consumers
- Runnable integration flows with a CLI runner suitable for CI
- Postman Collection v2.1 export
- **Runtime validation** — opt in with `validate: true` and invalid requests are rejected with a structured 422 before they reach your handler. Same schema as the docs.
- **Schema Drift Detection (experimental)** — declared schemas are also compared against real traffic in development; mismatches log a one-line warning so docs and code stay in sync

## How DocTreen compares

|                          | DocTreen           | `@nestjs/swagger` | Scalar / Redoc    | `ts-rest`        |
|--------------------------|--------------------|-------------------|-------------------|------------------|
| Spec file required       | No                 | No                | Yes (OpenAPI)     | No               |
| Frameworks supported     | 5 adapters         | NestJS only       | Any (spec-only)   | Custom router    |
| Zod schemas accepted directly | Yes (all adapters) | Manual           | Manual            | Yes              |
| Runtime request validation | Yes (one schema)  | Via class-validator | No (spec-only)  | Yes              |
| Integration test runner  | Built-in flows     | No                | No                | No               |
| Postman export           | Yes                | No                | No                | No               |
| OpenAPI 3.1 export       | Yes (built-in)     | Yes               | Required          | Plugin           |
| `securitySchemes` + per-route `security` | Yes (v1.8) | Manual          | Spec input        | Manual           |
| Hide a route from docs   | Per route + path patterns | No         | Spec edit         | No               |
| Setup time               | ~5 min             | ~30 min           | ~1 hour           | Refactor router  |

---

## Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [NestJS — Decorator API](#nestjs--decorator-api)
- [Zod Support](#zod-support)
- [Runtime Validation](#runtime-validation)
- [OpenAPI Export](#openapi-export)
- [Schema Drift Detection (experimental)](#schema-drift-detection-experimental)
- [Request Flows](#request-flows)
- [Documenting Routes with JSDoc](#documenting-routes-with-jsdoc)
- [Schema Builder](#schema-builder)
- [Named Schemas](#named-schemas)
- [Explicit Route Definition with `defineRoute`](#explicit-route-definition-with-defineroute)
- [Error Responses](#error-responses)
- [UI Features](#ui-features)
- [TypeScript](#typescript)
- [How It Works](#how-it-works)
- [Example Apps](#example-apps)
- [Roadmap](#roadmap)

---

## Installation

```bash
npm install doctreen
```

For **NestJS** projects, also install the peer dependencies (if not already present):

```bash
npm install reflect-metadata rxjs
```

For **Zod** schema support:

```bash
npm install zod
```

---

## Quick Start

### Express

```js
const express = require('express');
const { expressAdapter } = require('doctreen/express');

const app = express();
app.use(express.json());

app.get('/users', (req, res) => res.json([]));
app.post('/users', (req, res) => res.status(201).json({ id: 1 }));

// Mount after your routes
app.use(expressAdapter(app, {
  meta: { title: 'My API', version: '1.0.0' },
}));

app.listen(3000, () => console.log('Docs at http://localhost:3000/docs'));
```

### Fastify

```js
const fastify = require('fastify')();
const { fastifyAdapter } = require('doctreen/fastify');

// Call BEFORE registering routes — uses the onRoute hook
fastifyAdapter(fastify, {
  meta: { title: 'My API', version: '1.0.0' },
});

fastify.get('/users', async (req, reply) => reply.send([]));

fastify.listen({ port: 3000 });
```

### Hono

```js
// Hono v4 is ESM-only — run with: npx tsx hono-app.js
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { honoAdapter } from 'doctreen/hono';

const app = new Hono();

app.get('/users', (c) => c.json([]));

// Can be called before or after routes
honoAdapter(app, { meta: { title: 'My API', version: '1.0.0' } });

serve({ fetch: app.fetch, port: 3000 });
```

### Koa

```js
const Koa    = require('koa');
const Router = require('@koa/router');
const { koaAdapter } = require('doctreen/koa');

const app    = new Koa();
const router = new Router();

router.get('/users', (ctx) => { ctx.body = []; });

// Can be called before or after routes
koaAdapter(router, { meta: { title: 'My API', version: '1.0.0' } });

app.use(router.routes());
app.use(router.allowedMethods());
app.listen(3000);
```

### NestJS

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { nestAdapter } from 'doctreen/nest';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Call after NestFactory.create(), before app.listen()
  nestAdapter(app, {
    meta: { title: 'My API', version: '1.0.0' },
  });

  await app.listen(3000);
  console.log('Docs at http://localhost:3000/docs');
}
bootstrap();
```

Then annotate your controller methods with `@DocRoute` (see [NestJS — Decorator API](#nestjs--decorator-api)).

Visit the configured `docsPath` (default: `/docs`) to see your documentation.

---

## Configuration

All adapters accept the same config object:

```js
{
  docsPath:  '/docs',          // URL where the docs UI is served
  enabled:   true,             // Set false to disable; defaults to NODE_ENV !== 'production'
  liveReload: false,           // Re-discover routes on every docs hit
  meta: {
    title:       'My API',
    version:     '1.0.0',
    description: 'Full description shown in the UI header',
  },
  exclude:   ['/health', /^\/internal\/.*/],  // Paths to hide from docs
  groups: {                    // Group routes under named sections in the sidebar
    Users:    ['/users', '/users/:id'],
    Products: '/products',
  },
  flows:     [...],            // Inline flow presets (see Request Flows)
  flowsPath: './doctreen-flows',  // Directory of *.json flow files
}
```

### Config Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `docsPath` | `string` | `'/docs'` | URL where the docs UI is served |
| `enabled` | `boolean` | `NODE_ENV !== 'production'` | Set to `false` to disable docs entirely |
| `liveReload` | `boolean` | `false` | Re-discover routes on every docs request |
| `meta.title` | `string` | `'API Documentation'` | Title shown in the UI header |
| `meta.version` | `string` | `'1.0.0'` | Version label |
| `meta.description` | `string` | `''` | Description shown below the title |
| `exclude` | `string \| RegExp \| Array` | `[]` | Routes to hide from the docs |
| `groups` | `Record<string, string \| string[]>` | `{}` | Group routes into named sidebar sections |
| `flows` | `FlowDefinition[]` | `null` | Inline request-flow presets |
| `flowsPath` | `string` | auto-detected | Directory of `*.json` flow files |

---

## NestJS — Decorator API

DocTreen provides a decorator-based API for NestJS that integrates naturally with standard NestJS controller patterns.

### Setup

```ts
// main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { nestAdapter } from 'doctreen/nest';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  nestAdapter(app, { meta: { title: 'My API', version: '2.0.0' } });
  await app.listen(3000);
}
bootstrap();
```

No changes to `AppModule` are required. DocTreen reads NestJS's internal route metadata directly — no `DiscoveryModule` import needed.

Works with both **`@nestjs/platform-express`** (default) and **`@nestjs/platform-fastify`**.

### `@DocRoute` — Full schema on one decorator

```ts
import { Controller, Post, Body } from '@nestjs/common';
import { DocRoute } from 'doctreen/nest';
import { z } from 'zod';

const importSchema = z.object({
  products: z.array(z.object({ sku: z.string(), price: z.number() })),
});

const importResponseSchema = z.object({
  imported: z.number(),
  skipped:  z.number(),
});

@Controller('products')
export class ProductsController {
  @Post('import')
  @DocRoute({
    description: 'Bulk import partner inventory',
    headers: {
      'x-partner-api-key': 'Partner API key',
      'Content-Type':      'application/json',
    },
    request: {
      body: importSchema,
    },
    response: importResponseSchema,
    errors: {
      400: 'Validation failed',
      401: 'Missing or invalid API key',
      429: 'Rate limit exceeded',
    },
  })
  importProducts(@Body() body: any) {
    return { imported: body.products.length, skipped: 0 };
  }
}
```

### Granular decorators

Use the smaller decorators when you want to keep each concern separate, or when composing with other decorator libraries:

```ts
import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import {
  DocDescription,
  DocHeaders,
  DocRequest,
  DocResponse,
  DocErrors,
} from 'doctreen/nest';
import { z } from 'zod';

const UserSchema = z.object({ id: z.number(), name: z.string(), email: z.string() });

@Controller('users')
export class UsersController {
  @Get()
  @DocDescription('List all users')
  @DocRequest({ query: z.object({ page: z.number().optional(), role: z.string().optional() }) })
  @DocResponse(z.array(UserSchema))
  getUsers() { return []; }

  @Post()
  @DocDescription('Create a new user')
  @DocHeaders({ Authorization: 'Bearer <token>' })
  @DocRequest({ body: z.object({ name: z.string(), email: z.string() }) })
  @DocResponse(UserSchema)
  @DocErrors({ 409: 'Email already in use', 422: 'Validation failed' })
  createUser(@Body() body: any) { return { id: 1, ...body }; }

  @Delete(':id')
  @DocDescription('Delete a user by ID')
  @DocErrors({ 404: 'User not found', 403: 'Insufficient permissions' })
  deleteUser(@Param('id') id: string) { return { success: true }; }
}
```

All `@Doc*` decorators merge onto the same metadata key — stack any combination on the same method.

### `@DocRoute` schema reference

| Field | Type | Description |
|---|---|---|
| `description` | `string` | Human-readable description shown in the UI |
| `headers` | `Record<string, string>` | Request headers to document |
| `request.body` | `SchemaNode \| ZodSchema` | Request body shape |
| `request.query` | `SchemaNode \| ZodSchema` | Query parameter shape |
| `response` | `SchemaNode \| ZodSchema` | Success response shape |
| `errors` | `Record<number, string \| { description?, schema? }>` | Error responses by HTTP status |

---

## Zod Support

Zod is a first-class input format on **every adapter**. Pass any Zod schema where DocTreen expects a schema — `defineRoute`, `@DocRoute`, individual `@Doc*` decorators — and it is converted to DocTreen's internal `SchemaNode` representation at definition time. No `zodToSchemaNode()` wrapper required.

```js
const { defineRoute } = require('doctreen/express');
const { z } = require('zod');

const CreateUser = z.object({ name: z.string(), email: z.string().email() });

app.post('/users', defineRoute(
  (req, res) => res.status(201).json({ id: 1, ...req.body }),
  {
    description: 'Create a user',
    request:  { body: CreateUser },
    response: CreateUser.extend({ id: z.number() }),
    errors:   { 409: 'Email already in use' },
  }
));
```

The same shape works in `doctreen/fastify`, `doctreen/hono`, `doctreen/koa`, and via `@DocRoute({ ... })` in `doctreen/nest`.

If you ever need the converter directly (e.g. to build a shared schema bag outside of an adapter), it remains available as a standalone export.

### `zodToSchemaNode` (standalone)

```ts
import { z } from 'zod';
import { zodToSchemaNode } from 'doctreen/zod';

const schema = z.object({
  id:    z.number(),
  name:  z.string(),
  email: z.string().email(),
  role:  z.enum(['admin', 'user']).optional(),
  tags:  z.array(z.string()),
});

const node = zodToSchemaNode(schema);
// {
//   type: 'object',
//   properties: {
//     id:    { type: 'number' },
//     name:  { type: 'string' },
//     email: { type: 'string' },
//     role:  { type: 'string', optional: true },
//     tags:  { type: 'array', items: { type: 'string' } },
//   }
// }
```

### Supported Zod types

| Zod type | SchemaNode output |
|---|---|
| `z.string()`, `z.date()` | `{ type: 'string' }` |
| `z.number()`, `z.bigint()` | `{ type: 'number' }` |
| `z.boolean()` | `{ type: 'boolean' }` |
| `z.null()`, `z.undefined()`, `z.void()` | `{ type: 'null' }` |
| `z.any()`, `z.unknown()` | `{ type: 'unknown' }` |
| `z.object({...})` | `{ type: 'object', properties: {...} }` |
| `z.array(T)` | `{ type: 'array', items: T }` |
| `z.tuple([T, ...])` | `{ type: 'array', items: T[0] }` |
| `z.record(V)` | `{ type: 'object', properties: {} }` |
| `z.optional(T)` | `{ ...T, optional: true }` |
| `z.nullable(T)` | `{ ...T, optional: true }` |
| `z.default(T)` | unwraps to `T` |
| `z.enum([...])` | `{ type: 'string' }` |
| `z.nativeEnum(E)` | `{ type: 'string' }` or `{ type: 'number' }` |
| `z.literal(v)` | `{ type: typeof v }` |
| `z.union([A, B])` | first option |
| `z.discriminatedUnion(...)` | first option |
| `z.intersection(A, B)` | merged `object` properties |
| `z.lazy(...)` | resolved recursively |
| `.transform()`, `.pipe()` | unwraps to input schema |

---

## Runtime Validation

The same Zod schema you declared for documentation can validate every incoming request. Enable it once at the adapter level and DocTreen runs `safeParseAsync` against `request.body` and `request.query` before your handler executes. Invalid requests are rejected with a structured 422 response.

```js
const express = require('express');
const { z } = require('zod');
const { expressAdapter, defineRoute } = require('doctreen/express');

const app = express();
app.use(express.json());

app.post('/users', defineRoute(
  (req, res) => res.status(201).json({ id: 1, ...req.body }),
  {
    request: { body: z.object({ name: z.string().min(2), email: z.string().email() }) },
  }
));

// Turn validation on for every Zod-declared route on this app
app.use(expressAdapter(app, { validate: true }));
```

Sending `{ "email": "nope" }` to `POST /users` now returns:

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "error": "validation_failed",
  "issues": [
    { "path": "body.name",  "message": "Required",           "code": "invalid_type"   },
    { "path": "body.email", "message": "Invalid email",      "code": "invalid_string" }
  ]
}
```

**Properties:**

- **Opt-in.** Default is off; you set `validate: true` once per adapter. Upgrading from v1.5 cannot suddenly start rejecting requests.
- **Per-route override.** Pass `validate: false` to `defineRoute` (or `@DocRoute`) to skip validation on a specific route while keeping the docs entry. Pass `validate: true` to enable validation on one route when the adapter default is off.
- **Async refinements work** — internally uses `safeParseAsync`, so `.refine(async ...)` and pipelines are honoured.
- **Zod only.** Schemas built with the `s.*` helper are descriptive shapes, not parsers, so they cannot be used to validate. Mixed routes (some Zod, some `s.*`) work fine — only the Zod ones validate, others pass through.
- **All five adapters.** Express, Fastify, Hono, Koa, and NestJS all support `validate: true`. Hono and Koa require the adapter to be called **before** routes (their middleware does not retro-apply); Express, Fastify, and NestJS work regardless of order.

If you previously hand-rolled a NestJS pipe or an Express middleware that ran `zodSchema.parse(req.body)` for every endpoint, this replaces it.

---

## OpenAPI Export

Every adapter serves an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document at `<docsPath>/openapi.json` and the docs UI ships with a one-click **Export to OpenAPI 3.1** button next to Export to Postman. The same Zod-or-`s`-builder schemas that drive DocTreen's own UI also drive the spec — no extra annotations, no separate file.

```bash
# Once the docs UI is running:
curl https://your-api.example.com/docs/openapi.json > openapi.json
```

Drop the file (or paste it) into [Scalar](https://docs.scalar.com/), [Redoc](https://redocly.com/redoc/), [Swagger UI](https://swagger.io/tools/swagger-ui/), [editor.swagger.io](https://editor.swagger.io), or any other tool that consumes the spec — it just works.

**What's in the spec:**

- GET / POST / PUT / PATCH / DELETE operations grouped by first path segment as tags
- Path parameters (`/users/:id` → `/users/{id}`), query parameters from `request.query`, request headers as `parameters[].in = header`
- JSON request body for POST/PUT/PATCH with `required` arrays derived from the Zod schema
- 200 / 201 success responses (201 for POST) plus every declared error response with its own schema
- All schemas inlined so the document is self-contained — no external `$ref` resolution needed

**Out of scope for now (v1.8+):**

- `securitySchemes` / `security` blocks — request-headers like `Authorization` currently render as parameters
- `callbacks`, `webhooks`, `links`
- `$ref`-based schema deduplication (everything is inlined; a few KB heavier but renders identically in every viewer)

### Configuring servers, security schemes, and per-route security (v1.8+)

Point the spec at real environments and declare auth schemes once — DocTreen will attach the right `security` block to each operation and strip the redundant `Authorization` header parameter:

```js
expressAdapter(app, {
  openapi: {
    servers: [
      { url: 'https://api.example.com',         description: 'Production' },
      { url: 'https://staging.api.example.com', description: 'Staging' },
    ],
    securitySchemes: {
      bearerAuth: { type: 'http',   scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey:     { type: 'apiKey', in: 'header',     name: 'x-api-key' },
    },
    security: [{ bearerAuth: [] }],   // global default — applies to every operation
  },
});
```

Per-route overrides:

```js
// Override with a different scheme
app.get('/admin/stats', defineRoute(handler, {
  security: [{ adminAuth: [] }],
  // ...
}));

// Mark this route explicitly public, ignoring the global default
app.post('/auth/login', defineRoute(handler, {
  security: [],
  // ...
}));
```

When a route has any effective `security` requirement (per-route or inherited), DocTreen automatically strips the `Authorization` header from `parameters[]` — the security scheme is the single source of truth, and Redocly's `security-defined` rule passes cleanly.

### Inject custom HTML into the docs `<head>` (v1.9+)

Pass `headHtml` to drop analytics scripts, custom CSS, favicons, OG tags, or web fonts into the docs UI without forking DocTreen:

```js
expressAdapter(app, {
  meta: { title: 'My API', version: '1.0.0' },
  headHtml: [
    '<script defer src="/_vercel/insights/script.js"></script>',
    '<script defer src="/_vercel/speed-insights/script.js"></script>',
    '<link rel="icon" href="/favicon.ico" />',
    '<meta name="theme-color" content="#0f1117">',
  ].join('\n'),
});
```

The string is appended **as-is** to the generated `<head>`, after DocTreen's built-in styles and before `</head>`. **Trusted input** — DocTreen does not sanitise — so do not pass anything derived from user-submitted data.

The live demo at [doctreen.vercel.app](https://doctreen.vercel.app/docs) uses this to load Vercel Analytics + Speed Insights.

### Hide a route from the docs (v1.8+)

Some endpoints serve traffic but should not appear in the docs UI or the OpenAPI export — internal admin tools, experimental features, deprecated routes you can't remove yet. Mark them per-route:

```js
app.get('/internal/metrics', defineRoute(handler, {
  hidden: true,           // removed from docs UI and openapi.json — still serves 200s
  description: 'Internal metrics endpoint',
}));
```

```ts
// NestJS — full bag
@Get('flags') @DocRoute({ hidden: true }) flags() { ... }

// NestJS — shorthand decorator
@Get('flags') @DocHidden() flags() { ... }
```

Hidden routes are filtered out by `RouteRegistry.getVisible()` (used by both the docs UI and the OpenAPI exporter), so the runtime route remains fully reachable.

### CI hooks

```bash
npx @redocly/cli lint https://your-api.example.com/docs/openapi.json
npx @apidevtools/swagger-cli validate https://your-api.example.com/docs/openapi.json
```

---

## Schema Drift Detection (experimental)

When a route's request schema is declared via `defineRoute` (or JSDoc) on the Express adapter, DocTreen compares each incoming payload against the declared shape and logs a one-line warning to `console.warn` if they diverge. This is a development aid for catching the most common cause of stale docs: the schema you wrote no longer matches what your code actually accepts.

```text
[doctreen] schema drift on POST /users body: missing required `email`
[doctreen] schema drift on POST /users body: unexpected `legacy_field` (got string)
[doctreen] schema drift on POST /users body: `age` expected number, got string
```

**What it catches today (top-level shape only):**
- Missing required properties
- Unexpected properties not declared in the schema
- Type mismatches between declared and runtime values

**Properties:**
- Runs only when `process.env.NODE_ENV !== 'production'`. Silent in production.
- De-duplicated per `(method, path, drift signature)` so a misbehaving client cannot flood logs.
- Available on the Express adapter in v1.5. Fastify, Hono, Koa, and NestJS adapters get parallel drift hooks in a follow-up patch.

This is the foundation for production-grade drift reporting on the roadmap — sampling, aggregation, and a dashboard for diffing live traffic against declared schemas. For now, treat it as an early signal during local development.

---

## Request Flows

DocTreen loads named request-flow presets into the docs UI and runs them through a shared engine — also available as a CLI.

Flows are first-class in the UI:

- A top-level **Flows** tab keeps flows separate from route docs
- The Flows tab includes a built-in guide for writing flow JSON
- The built-in flow creator lets you assemble draft steps from documented routes
- Runtime inputs and per-run `baseUrl` overrides are supported
- `{{input.*}}`, `{{vars.*}}`, and `{{env.*}}` placeholders are supported in all step fields
- Prior response fields can be promoted into `extract` entries and reused as `{{vars.*}}`
- Results are shown as both a visual execution timeline and raw JSON

### Directory-based loading

Place `*.json` files in a `./doctreen-flows` directory and they will be loaded automatically. Use `flowsPath` for a custom location:

```js
app.use(expressAdapter(app, {
  flowsPath: path.join(__dirname, 'doctreen-flows'),
  meta: { title: 'My API', version: '1.0.0' },
}));
```

### Inline flows

```js
app.use(expressAdapter(app, {
  flows: [
    {
      version: 1,
      name: 'Login smoke test',
      baseUrl: 'http://localhost:3000',
      steps: [
        {
          id: 'login',
          request: {
            method: 'POST',
            path: '/auth/login',
            body: { email: 'alice@example.com', password: 'secret' },
          },
          assert: { status: 200 },
          extract: { token: { from: 'body', path: '$.token' } },
        },
      ],
    },
  ],
}));
```

### Flow format

```json
{
  "version": 1,
  "name": "User onboarding",
  "description": "Create a user, fetch it back, then delete it.",
  "baseUrl": "http://localhost:3000",
  "inputs": {
    "email": { "type": "string", "required": true },
    "name":  { "type": "string", "required": true }
  },
  "steps": [
    {
      "id": "create-user",
      "request": {
        "method": "POST",
        "path": "/users",
        "body": { "email": "{{input.email}}", "name": "{{input.name}}" }
      },
      "extract": {
        "userId": { "from": "body", "path": "$.id" }
      },
      "assert": {
        "status": 201,
        "body": { "$.email": "{{input.email}}" }
      }
    },
    {
      "id": "get-user",
      "request": { "method": "GET", "path": "/users/{{vars.userId}}" },
      "assert": {
        "status": 200,
        "exists": ["$.id", "$.createdAt"]
      }
    }
  ]
}
```

### Variable namespaces

| Namespace | Source |
|---|---|
| `{{input.*}}` | Runtime values entered in the docs UI or CLI |
| `{{vars.*}}` | Values extracted from previous step responses |
| `{{env.*}}` | Values from the flow file or environment overrides |

### CLI runner

```bash
doctreen-flow run doctreen-flows/user-onboarding.json \
  --input email=alice@example.com \
  --input name='Alice Smith'

# Named environment
doctreen-flow run doctreen-flows/user-onboarding.json --env staging

# Explicit environment file + JSON report
doctreen-flow run doctreen-flows/user-onboarding.json \
  --env ./doctreen-flows/environments/staging.json \
  --report json
```

**CLI flags:**

| Flag | Description |
|---|---|
| `--env <name\|file>` | Load an environment preset |
| `--base-url <url>` | Override `baseUrl` for this run |
| `--input key=value` | Supply runtime inputs |
| `--no-bail` | Continue running after a failed step |
| `--report text\|json` | Output format (default: `text`) |

---

## Documenting Routes with JSDoc

> JSDoc parsing is available for **Express**, **Fastify**, **Hono**, and **Koa**.  
> For **NestJS**, use `@DocRoute` and the decorator API instead.

DocTreen reads JSDoc from handler function source at runtime. Place the JSDoc block **inside** the handler function body (at the top):

```js
app.get('/users/:id', function (req, res) {
  /**
   * @description Get a user by ID
   * @param  {string} query.fields  Comma-separated fields to return
   * @response {string} id
   * @response {string} name
   * @response {string} email
   */
  res.json({ id: req.params.id, name: 'Alice', email: 'alice@example.com' });
});
```

### Supported JSDoc tags

| Tag | Description | Example |
|---|---|---|
| `@description` | Route description | `@description Get all users` |
| `@param {type} body.name` | Request body field | `@param {string} body.email` |
| `@param {type} query.name` | Query parameter | `@param {string} query.search` |
| `@response {type} name` | Response field | `@response {string} id` |
| `@returns {Type}` | Full response type (schema ref) | `@returns {User}` |
| `@header Name - value` | Request header | `@header Authorization - Bearer <token>` |

Wrap a field name in `[brackets]` to mark it optional:

```js
/**
 * @param {string}  body.name
 * @param {string}  [body.bio]    optional
 * @param {number}  [body.age]    optional
 */
```

---

## Schema Builder

DocTreen ships a lightweight schema builder (`s`) for defining typed request and response shapes without a runtime schema library.

```js
const { s } = require('doctreen');
// import { s } from 'doctreen';

s.string()            // { type: 'string' }
s.number()            // { type: 'number' }
s.boolean()           // { type: 'boolean' }
s.null()              // { type: 'null' }
s.unknown()           // { type: 'unknown' }

s.object({
  id:   s.number(),
  name: s.string(),
  bio:  s.optional(s.string()),   // optional field — shown with ? in the UI
})

s.array(s.string())
s.array(s.object({ id: s.number(), tag: s.string() }))

s.optional(s.string())  // wraps any node as optional
```

`s` is re-exported from all adapter packages for convenience:

```js
const { s } = require('doctreen/express');
const { s } = require('doctreen/fastify');
const { s } = require('doctreen/hono');
const { s } = require('doctreen/koa');
const { s } = require('doctreen/nest');
```

---

## Named Schemas

Register a schema under a name and reference it in JSDoc with `{TypeName}` or `{TypeName[]}`:

```js
const { defineSchema, s } = require('doctreen');

defineSchema('User', s.object({
  id:     s.number(),
  name:   s.string(),
  email:  s.string(),
  active: s.boolean(),
  bio:    s.optional(s.string()),
}));

app.get('/users', function (req, res) {
  /**
   * @description List all users
   * @returns {User[]}
   */
  res.json([]);
});

app.get('/users/:id', function (req, res) {
  /**
   * @description Get a user by ID
   * @returns {User}
   */
  res.json({ id: 1, name: 'Alice', email: 'alice@example.com', active: true });
});
```

`defineSchema` is also re-exported from all adapter packages.

---

## Explicit Route Definition with `defineRoute`

For full control, wrap a handler with `defineRoute`. Works the same across Express, Fastify, Hono, and Koa:

```js
const { defineRoute, s } = require('doctreen/express');
// const { defineRoute, s } = require('doctreen/fastify');
// import { defineRoute, s } from 'doctreen/hono';
// const { defineRoute, s } = require('doctreen/koa');

app.post('/users', defineRoute(
  (req, res) => {
    res.status(201).json({ id: 1, name: req.body.name });
  },
  {
    description: 'Create a new user account',
    headers: {
      Authorization:  'Bearer <token>',
      'Content-Type': 'application/json',
    },
    request: {
      body:  s.object({ name: s.string(), email: s.string(), role: s.optional(s.string()) }),
      query: null,
    },
    response: s.object({ id: s.number(), name: s.string(), email: s.string() }),
    errors: {
      409: 'Email address already in use',
      422: { description: 'Validation failed', schema: s.object({ message: s.string(), field: s.string() }) },
    },
  }
));
```

**Schema resolution order (first wins):**

| Adapter | Priority |
|---|---|
| Express | `defineRoute` → JSDoc → runtime inference |
| Fastify | `defineRoute` → Fastify native JSON Schema → JSDoc |
| Hono | `defineRoute` → JSDoc |
| Koa | `defineRoute` → JSDoc |
| NestJS | `@DocRoute` / `@Doc*` decorators |

### Fastify native JSON Schema

If you already annotate routes with Fastify's built-in `schema` option, DocTreen reads it automatically — no `defineRoute` needed:

```js
fastify.get('/users/:id', {
  schema: {
    description: 'Get a user by ID',
    response: {
      200: {
        type: 'object',
        properties: {
          id:    { type: 'number' },
          name:  { type: 'string' },
          email: { type: 'string' },
        },
      },
    },
  },
  handler: async (req, reply) => { /* ... */ },
});
```

---

## Error Responses

Document possible error responses via the `errors` field (available in `defineRoute` and `@DocRoute`):

```js
errors: {
  // Plain string — description only
  401: 'Missing or invalid Authorization header',

  // Object — description + error body schema
  422: {
    description: 'Validation failed',
    schema: s.object({ message: s.string(), field: s.string() }),
  },

  // Object — schema only
  500: { schema: s.object({ message: s.string() }) },
}
```

Error responses appear in each route's detail panel, colour-coded by class (amber for 4xx, red for 5xx), and are exported as saved examples when downloading a Postman collection.

---

## UI Features

### Route Browser
- Sidebar groups routes by section (from `groups` config) or by first path segment
- Color-coded method pills — GET, POST, PUT, PATCH, DELETE
- Property-count badge on routes with defined schemas
- Lives in its own **Routes** tab when flows are also enabled

### Route Detail Panel
- Full schema tree for request body, query params, path params, and response
- Error responses — colour-coded by status class, with optional body schema
- Optional fields shown with `?` suffix
- **Copy as cURL** — ready-to-run curl command with example values filled in
- **Copy for LLM** — structured markdown description of the endpoint (useful for AI-assisted development)
- **Export to Postman** — downloads a Postman Collection v2.1 JSON; error responses are included as saved example responses

### Flow Runner
- Dedicated **Flows** tab, separate from route documentation
- Built-in authoring guide with JSON examples
- Flow creator — assemble steps from documented routes, insert placeholders, map path params
- Capture prior response fields and convert them to `extract` rules automatically
- Run flows inside the UI with live input collection and `baseUrl` override
- Visual execution timeline with per-step request/response details
- Raw JSON output from the shared runner
- Same format works with the `doctreen-flow` CLI

---

## TypeScript

DocTreen ships declaration files alongside the JavaScript. No separate `@types/doctreen` package is needed.

### Express

```ts
import express from 'express';
import { expressAdapter, defineRoute, RouteSchemas } from 'doctreen/express';
import { s } from 'doctreen';

const app = express();
app.use(express.json());

app.post('/users', defineRoute<{ name: string }, never, { id: number; name: string }>(
  (req, res) => res.status(201).json({ id: 1, name: req.body.name }),
  {
    description: 'Create a user',
    request:  { body: s.object({ name: s.string() }) },
    response: s.object({ id: s.number(), name: s.string() }),
    errors:   { 409: 'Email already in use' },
  }
));

app.use(expressAdapter(app, { meta: { title: 'My API', version: '1.0.0' } }));
app.listen(3000);
```

### Fastify

```ts
import Fastify from 'fastify';
import { fastifyAdapter } from 'doctreen/fastify';

const fastify = Fastify();
fastifyAdapter(fastify, { meta: { title: 'My API', version: '1.0.0' } });

fastify.get('/users', async (req, reply) => reply.send([]));
fastify.listen({ port: 3000 });
```

### Hono

```ts
import { Hono } from 'hono';
import { honoAdapter } from 'doctreen/hono';

const app = new Hono();
honoAdapter(app, { meta: { title: 'My API', version: '1.0.0' } });
```

### Koa

```ts
import Koa from 'koa';
import Router from '@koa/router';
import { koaAdapter } from 'doctreen/koa';

const app    = new Koa();
const router = new Router();

koaAdapter(router, { meta: { title: 'My API', version: '1.0.0' } });

app.use(router.routes());
app.use(router.allowedMethods());
```

### NestJS

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Post, Body, Module } from '@nestjs/common';
import { nestAdapter, DocRoute, DocDescription, DocResponse } from 'doctreen/nest';
import { z } from 'zod';

const UserSchema = z.object({ id: z.number(), name: z.string() });

@Controller('users')
class UsersController {
  @Get()
  @DocDescription('List all users')
  @DocResponse(z.array(UserSchema))
  getUsers() { return []; }

  @Post()
  @DocRoute({
    description: 'Create a user',
    request:  { body: z.object({ name: z.string() }) },
    response: UserSchema,
    errors:   { 409: 'Email already in use' },
  })
  createUser(@Body() body: { name: string }) {
    return { id: 1, ...body };
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  nestAdapter(app, { meta: { title: 'My API', version: '1.0.0' } });
  await app.listen(3000);
}
bootstrap();
```

### Available types

```ts
import type {
  SchemaNode,       // { type, properties?, items?, optional? }
  RouteEntry,       // { method, path, params, description, errors, ... }
  ErrorEntry,       // { status, description, schema }
  UserConfig,       // full config object shape
  NormalizedConfig,
  ApiMeta,
  RouteRegistry,
} from 'doctreen';

import type { RouteSchemas, ExpressLike }              from 'doctreen/express';
import type { RouteSchemas, FastifyLike }              from 'doctreen/fastify';
import type { RouteSchemas, HonoLike }                 from 'doctreen/hono';
import type { RouteSchemas, KoaRouterLike }            from 'doctreen/koa';
import type { NestRouteSchemas, NestApplicationLike }  from 'doctreen/nest';
```

The structural interfaces (`ExpressLike`, `FastifyLike`, etc.) let you use doctreen without depending on a specific framework's type package.

---

## How It Works

### Express

1. `expressAdapter(app, config)` returns a middleware registered at `docsPath`.
2. On the first request to `/docs`, DocTreen walks `app._router.stack` recursively to discover all registered routes — lazy introspection solves the middleware-before-routes ordering problem.
3. Route handlers are wrapped so that, in development, real HTTP traffic can fill in request/response schemas that weren't declared via `defineRoute` or JSDoc. Declared schemas always win; runtime sampling only fills the gaps.
4. JSDoc comments inside handler functions are parsed via `fn.toString()` at runtime.
5. If a route's schema *was* declared, each incoming payload is also compared against it for [schema drift](#schema-drift-detection-experimental) (dev-only warning).
6. If flows are configured, `POST /docs/__flows/run` executes them through the shared runner.

### Fastify

1. `fastifyAdapter(fastify, config)` registers an `onRoute` hook and adds the docs GET route.
2. Every route added **after** `fastifyAdapter` is captured by the hook at registration time — no traffic needed.
3. Schema resolution order: `defineRoute` → Fastify native JSON Schema → JSDoc.

### Hono

1. `honoAdapter(app, config)` adds a GET route at `docsPath` to the Hono app.
2. On the first request to the docs page, `app.routes` is read — all routes registered by that time are shown.
3. Can be called **before or after** your routes (lazy read at request time).
4. Schema resolution order: `defineRoute` → JSDoc.

### Koa

1. `koaAdapter(router, config)` adds a GET route at `docsPath` to the `@koa/router` instance.
2. On the first request to the docs page, `router.stack` is read — all routes registered by that time are shown.
3. Can be called **before or after** your routes (lazy read at request time).
4. Schema resolution order: `defineRoute` → JSDoc.

### NestJS

1. `nestAdapter(app, config)` is called after `NestFactory.create()` and before `app.listen()`.
2. It registers the docs route directly on the underlying HTTP adapter (Express or Fastify platform), bypassing NestJS guards and interceptors — this is intentional for an internal docs endpoint.
3. Route discovery reads NestJS's internal container (`app.container.getModules()`) to enumerate all controllers and their methods.
4. For each controller method, it reads `Reflect.getMetadata('path', fn)` and `Reflect.getMetadata('method', fn)` — the same metadata keys set by `@Get()`, `@Post()`, etc.
5. `@DocRoute` and `@Doc*` decorators attach their schemas under a separate metadata key on the same method function.
6. The global prefix (set via `app.setGlobalPrefix(...)`) is prepended to all discovered paths.
7. Schema resolution order: `@DocRoute` / `@Doc*` decorators (no JSDoc or runtime-inference fallback in NestJS).

---

## Example Apps

```bash
npm run example             # Express JS     → http://localhost:3000/api/docs
npm run example:ts          # Express TS     → http://localhost:3000/api/docs
npm run example:fastify     # Fastify JS     → http://localhost:3001/api/docs
npm run example:fastify:ts  # Fastify TS     → http://localhost:3001/api/docs
npm run example:hono        # Hono JS        → http://localhost:3002/api/docs
npm run example:hono:ts     # Hono TS        → http://localhost:3002/api/docs
npm run example:koa         # Koa JS         → http://localhost:3003/api/docs
npm run example:koa:ts      # Koa TS         → http://localhost:3003/api/docs
npm run example:nest        # NestJS TS      → http://localhost:3001/docs
```

| File | Framework | Highlights |
|---|---|---|
| [`example/app.js`](./example/app.js) | Express | JSDoc, `defineRoute`, named schemas, error responses, flow presets |
| [`example/app.ts`](./example/app.ts) | Express | Fully typed with `defineRoute` generics, flow presets |
| [`example/fastify-app.js`](./example/fastify-app.js) | Fastify | JSDoc, `defineRoute`, Fastify native JSON Schema, flow presets |
| [`example/fastify-app.ts`](./example/fastify-app.ts) | Fastify | Fully typed with Fastify route generics, flow presets |
| [`example/hono-app.js`](./example/hono-app.js) | Hono | JSDoc, `defineRoute`; run via `npx tsx` |
| [`example/hono-app.ts`](./example/hono-app.ts) | Hono | Fully typed with Hono `Context` |
| [`example/koa-app.js`](./example/koa-app.js) | Koa | JSDoc, `defineRoute`, `@koa/router` |
| [`example/koa-app.ts`](./example/koa-app.ts) | Koa | Fully typed with `Router.RouterContext` |
| [`example/nest-app.ts`](./example/nest-app.ts) | NestJS | `@DocRoute`, `@Doc*` decorators, Zod schemas, `s` builder |

---

## Roadmap

- [x] **Runtime validation middleware** *(v1.6)* — Zod schemas validate incoming requests; 422 on mismatch.
- [x] **OpenAPI 3.1 export** *(v1.7)* — same schema bag now also drives Scalar, Redoc, and Swagger UI via `GET /docs/openapi.json`.
- [x] **`openapi.servers` + `securitySchemes` + per-route `security` + `hidden`** *(v1.8)* — declare auth schemes once, attach to operations automatically; `Authorization` header auto-stripped; routes can opt out of docs entirely.
- [x] **`headHtml` config** *(v1.9)* — inject analytics scripts, custom CSS, favicons, or OG metadata into the docs UI `<head>` without forking.
- [ ] **Schema drift detection — production grade** — sampling, aggregation, and a dashboard view of declared vs. observed schemas. Extension of the v1.5 experimental dev warning.
- [ ] **Drift hooks on Fastify, Hono, Koa, NestJS** — port the v1.5 Express drift check to every adapter now that the validation rails exist.
- [ ] **`doctreen init` CLI** — scaffold a `doctreen-flows/` directory with an example flow and a CI-ready runner config.
- [ ] **DocTreen Cloud** — hosted docs portal with versioning, custom domains, and CI flow monitoring (private beta).
- [ ] **Python (FastAPI) and Go (chi / gin) adapters** — long-term, after the Node story is fully baked.

Have a feature request or use case we missed? [Open an issue →](https://github.com/CanDgrmc/doctreen/issues)

---

## License

MIT
