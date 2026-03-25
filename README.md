# DocTreen

Auto-generate and serve interactive API documentation for your Node.js backend — zero configuration, zero runtime dependencies.

DocTreen introspects your Express, Fastify, Hono, or Koa app at runtime, parses your JSDoc comments, and serves a fully interactive documentation UI at `/docs`.

---

## Installation

```bash
npm install doctreen
```

---

## Quick Start

### Express

```js
const express = require('express');
const { expressAdapter } = require('doctreen/express');

const app = express();
app.use(express.json());

// Define routes first, then mount the docs middleware
app.get('/users', (req, res) => res.json([]));

app.use(expressAdapter(app, {
  meta: { title: 'My API', version: '1.0.0' },
}));

app.listen(3000, () => console.log('API docs at http://localhost:3000/docs'));
```

### Fastify

```js
const fastify = require('fastify')();
const { fastifyAdapter } = require('doctreen/fastify');

// Call BEFORE registering routes — uses the onRoute hook
fastifyAdapter(fastify, {
  docsPath: '/api/docs',
  meta: { title: 'My API', version: '1.0.0' },
});

fastify.get('/users', async (req, reply) => reply.send([]));

fastify.listen({ port: 3000 }, () => console.log('API docs at http://localhost:3000/api/docs'));
```

### Hono

```js
// hono-app.js — run with: npx tsx hono-app.js  (Hono v4 is ESM-only)
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { honoAdapter } from 'doctreen/hono';

const app = new Hono();

app.get('/users', (c) => c.json([]));

// Can be called before or after routes — reads lazily at first request
honoAdapter(app, {
  docsPath: '/api/docs',
  meta: { title: 'My API', version: '1.0.0' },
});

serve({ fetch: app.fetch, port: 3000 });
```

> **Note**: Hono v4 is ESM-only. Run `.js` files with `npx tsx` or use `.ts` files directly.

### Koa

```js
const Koa    = require('koa');
const Router = require('@koa/router');
const { koaAdapter } = require('doctreen/koa');

const app    = new Koa();
const router = new Router();

router.get('/users', (ctx) => { ctx.body = []; });

// Can be called before or after routes — reads lazily at first request
koaAdapter(router, {
  docsPath: '/api/docs',
  meta: { title: 'My API', version: '1.0.0' },
});

app.use(router.routes());
app.use(router.allowedMethods());
app.listen(3000, () => console.log('API docs at http://localhost:3000/api/docs'));
```

Visit the configured `docsPath` to see your documentation.

---

## Configuration

The same config object is accepted by `expressAdapter`, `fastifyAdapter`, `honoAdapter`, and `koaAdapter`:

```js
// Express
app.use(expressAdapter(app, {
  docsPath: '/docs',
  enabled: true,
  liveReload: false,
  exclude: ['/health'],
  groups: {
    Users: ['/users', '/users/:id'],
    Products: '/products',
  },
  meta: {
    title: 'My API',
    version: '1.0.0',
    description: 'Full description shown in the UI header',
  },
}));

// Fastify (same options)
fastifyAdapter(fastify, {
  docsPath: '/api/docs',
  meta: { title: 'My API', version: '1.0.0' },
});
```

### Config Options

| Option | Type | Default | Description |
|---|---|---|---|
| `docsPath` | `string` | `'/docs'` | URL path where the docs UI is served |
| `enabled` | `boolean` | `NODE_ENV !== 'production'` | Disable to hide docs entirely |
| `liveReload` | `boolean` | `false` | Re-introspect routes on every docs hit |
| `exclude` | `string \| RegExp \| Array` | `[]` | Routes to exclude from docs |
| `groups` | `Record<string, string \| string[]>` | `{}` | Group routes into named sections |
| `meta.title` | `string` | `'API Documentation'` | Title shown in the UI |
| `meta.version` | `string` | — | API version label |
| `meta.description` | `string` | — | Description shown below the title |

---

## Documenting Routes with JSDoc

DocTreen parses JSDoc comments on your route handler functions. Supported tags:

| Tag | Description | Example |
|---|---|---|
| `@description` | Route description | `@description Get all users` |
| `@param {type} name` | Query or path parameter | `@param {string} search` |
| `@body {type} name` | Request body field | `@body {string} email` |
| `@response {type} name` | Response field | `@response {string} id` |
| `@returns {Type}` | Full response type (schema ref) | `@returns {User}` |
| `@deprecated` | Mark route as deprecated | `@deprecated` |
| `@group GroupName` | Override group assignment | `@group Admin` |

### Optional Fields

Wrap a field name in `[brackets]` to mark it as optional:

```js
/**
 * @body {string} name
 * @body {string} [bio]       — optional
 * @body {number} [age]       — optional
 */
app.post('/users', handler);
```

### Example

```js
/**
 * @description Get a user by ID
 * @param {string} id - User ID
 * @returns {User}
 */
app.get('/users/:id', (req, res) => {
  // ...
});
```

---

## Schema API

DocTreen ships a schema builder (`s`) for defining typed request and response shapes.

### Primitive builders

```js
const { s } = require('doctreen');

s.string()    // { type: 'string' }
s.number()    // { type: 'number' }
s.boolean()   // { type: 'boolean' }
s.any()       // { type: 'any' }
```

### Composite builders

```js
s.object({ name: s.string(), age: s.number() })
s.array(s.string())
s.array(s.object({ id: s.number() }))
```

### Optional fields

```js
s.object({
  name: s.string(),
  bio: s.optional(s.string()),    // marked as optional — shown with ? in UI
})
```

---

## Named Schemas with `defineSchema`

Register a reusable schema by name and reference it in JSDoc with `{SchemaName}` or `{SchemaName[]}`:

```js
const { defineSchema, s } = require('doctreen');

defineSchema('User', s.object({
  id: s.number(),
  name: s.string(),
  email: s.string(),
  active: s.boolean(),
  bio: s.optional(s.string()),
}));

/**
 * @description Get all users
 * @response {User[]} users
 */
app.get('/users', (req, res) => { /* ... */ });

/**
 * @description Get a user by ID
 * @returns {User}
 */
app.get('/users/:id', (req, res) => { /* ... */ });
```

---

## Explicit Route Definition with `defineRoute`

For full control over how a route appears in the docs, wrap your handler with `defineRoute`. Works the same across all adapters:

```js
const { defineRoute, s } = require('doctreen/express'); // or 'doctreen/fastify' / 'doctreen/koa'
// import { defineRoute, s } from 'doctreen/hono';       // Hono (ESM)

app.post('/users', defineRoute(
  (req, res) => {
    res.status(201).json({ id: 1, name: req.body.name });
  },
  {
    description: 'Create a new user account.',
    headers: { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' },
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

`defineRoute` takes priority over JSDoc, which takes priority over runtime inference (Express) or Fastify native JSON Schema.

### Fastify Native JSON Schema

If you use Fastify's built-in `schema` option on a route, DocTreen reads it automatically — no `defineRoute` needed:

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

The `body`, `querystring`, `response`, and `description` fields from the Fastify schema are all converted to DocTreen's internal schema format and shown in the UI. `defineRoute` takes priority over native schema if both are present.

### Error Responses

The `errors` field documents possible error responses for a route. Each key is an HTTP status code; the value is either a plain description string or an object with an optional `description` and/or `schema`.

```js
errors: {
  // Plain string — description only
  401: 'Missing or invalid Authorization header',

  // Object — description + error body schema
  422: {
    description: 'Validation failed',
    schema: s.object({ message: s.string(), field: s.string() }),
  },

  // Object — schema only (no description)
  500: { schema: s.object({ message: s.string() }) },
}
```

Errors appear in the **Response** column of each route's detail panel (colour-coded by status class: amber for 4xx, red for 5xx), and are included as saved example responses when exporting to Postman.

---

## UI Features

### Route Browser
- Sidebar lists all routes grouped by section or HTTP method
- Color-coded method pills (GET, POST, PUT, PATCH, DELETE)
- Property count badge on routes with defined schemas
- Search/filter by path or method

### Route Detail Panel
- Full schema tree for request body, query params, path params, and response
- **Error responses** — colour-coded by status class (amber 4xx, red 5xx) with optional body schema
- Optional fields shown with `?` suffix
- **Copy as cURL** — generates a ready-to-run curl command with example values
- **Copy for LLM** — generates a structured markdown prompt describing the endpoint (useful for AI-assisted development)
- **Export to Postman** — downloads a Postman Collection v2.1 JSON file; error responses are included as saved example responses

---

## TypeScript

DocTreen ships declaration files alongside the JavaScript — no build step, no `@types/express` required.

### Quick Start (TypeScript)

```ts
// Express
import express from 'express';
import { expressAdapter } from 'doctreen/express';
import { s, UserConfig } from 'doctreen';

const app = express();
app.use(express.json());
app.use(expressAdapter(app, { meta: { title: 'My API', version: '1.0.0' } }));

// Fastify
import Fastify from 'fastify';
import { fastifyAdapter } from 'doctreen/fastify';

const fastify = Fastify();
fastifyAdapter(fastify, { docsPath: '/api/docs', meta: { title: 'My API', version: '1.0.0' } });

// Hono
import { Hono } from 'hono';
import { honoAdapter } from 'doctreen/hono';

const honoApp = new Hono();
honoAdapter(honoApp, { docsPath: '/api/docs', meta: { title: 'My API', version: '1.0.0' } });

// Koa
import Koa from 'koa';
import Router from '@koa/router';
import { koaAdapter } from 'doctreen/koa';

const koaApp    = new Koa();
const koaRouter = new Router();
koaAdapter(koaRouter, { docsPath: '/api/docs', meta: { title: 'My API', version: '1.0.0' } });
koaApp.use(koaRouter.routes());
```

### Typed Schemas

```ts
import { defineSchema, defineRoute, s, SchemaNode } from 'doctreen';

defineSchema('User', s.object({
  id: s.number(),
  name: s.string(),
  email: s.string(),
  bio: s.optional(s.string()),
}));

app.post('/users', defineRoute<CreateUserBody, never, User>(
  (req, res) => {
    res.status(201).json({ id: 1, ...req.body });
  },
  {
    description: 'Create a user',
    request: {
      body:  s.object({ name: s.string(), email: s.string(), role: s.optional(s.string()) }),
      query: null,
    },
    response: s.object({ id: s.number(), name: s.string() }),
    errors: {
      409: 'Email already in use',
      422: { description: 'Validation failed', schema: s.object({ message: s.string() }) },
    },
  }
));

// Build a schema node dynamically — fully typed
const mySchema: SchemaNode = s.array(s.object({
  id: s.number(),
  tags: s.array(s.string()),
}));
```

### Available Types

```ts
import type {
  SchemaNode,      // { type, properties?, items?, optional? }
  RouteEntry,      // { method, path, params?, description?, errors?, ... }
  ErrorEntry,      // { status, description, schema }
  UserConfig,      // full config object shape
  NormalizedConfig,
  ApiMeta,
  RouteRegistry,
} from 'doctreen';

import type { RouteSchemas, ExpressLike }   from 'doctreen/express';
import type { RouteSchemas, FastifyLike }   from 'doctreen/fastify';
import type { RouteSchemas, HonoLike }      from 'doctreen/hono';
import type { RouteSchemas, KoaRouterLike } from 'doctreen/koa';
```

`ExpressLike`, `FastifyLike`, `HonoLike`, and `KoaRouterLike` are structural interfaces — framework `@types/*` packages are optional.

---

## How It Works

### Express
1. `expressAdapter(app, config)` registers a middleware at `docsPath`
2. On the first request to `/docs`, DocTreen walks `app._router.stack` to discover all registered routes (lazy introspection — solves the middleware-before-routes ordering problem)
3. Route handlers are wrapped so real HTTP traffic populates request/response schemas automatically
4. JSDoc comments on handler functions are parsed at runtime via `fn.toString()`
5. The UI is served as a self-contained HTML page with zero external dependencies

### Fastify
1. `fastifyAdapter(fastify, config)` registers a Fastify `onRoute` hook and adds the docs GET route
2. Every route added after `fastifyAdapter` is captured by the hook at registration time — no traffic needed
3. Schema resolution order: `defineRoute` → Fastify native JSON Schema → JSDoc block comment
4. Named schemas registered with `defineSchema` are resolved when referenced in JSDoc tags

### Hono
1. `honoAdapter(app, config)` adds a GET route at `docsPath` to the Hono app
2. On the first request to the docs page, `app.routes` is read — all routes registered by then are shown
3. Can be called **before or after** your routes (lazy read at request time)
4. Schema resolution order: `defineRoute` → JSDoc block comment
5. Works on any runtime: Node.js (via `@hono/node-server`), Bun, Deno, Cloudflare Workers

### Koa
1. `koaAdapter(router, config)` adds a GET route at `docsPath` to the `@koa/router` instance
2. On the first request to the docs page, `router.stack` is read — all routes registered by then are shown
3. Can be called **before or after** your routes (lazy read at request time)
4. Schema resolution order: `defineRoute` → JSDoc block comment
5. Mount the router on the Koa app as usual: `app.use(router.routes())`

---

## Example Apps

```bash
npm run example             # Express JS    → http://localhost:3000/api/docs
npm run example:ts          # Express TS    → http://localhost:3000/api/docs
npm run example:fastify     # Fastify JS    → http://localhost:3001/api/docs
npm run example:fastify:ts  # Fastify TS    → http://localhost:3001/api/docs
npm run example:hono        # Hono JS       → http://localhost:3002/api/docs
npm run example:hono:ts     # Hono TS       → http://localhost:3002/api/docs
npm run example:koa         # Koa JS        → http://localhost:3003/api/docs
npm run example:koa:ts      # Koa TS        → http://localhost:3003/api/docs
```

| File | Framework | Notes |
|------|-----------|-------|
| [`example/app.js`](./example/app.js) | Express | JSDoc, `defineRoute`, named schemas, error responses |
| [`example/app.ts`](./example/app.ts) | Express | Fully typed with `defineRoute` generics |
| [`example/fastify-app.js`](./example/fastify-app.js) | Fastify | JSDoc, `defineRoute`, Fastify native JSON Schema |
| [`example/fastify-app.ts`](./example/fastify-app.ts) | Fastify | Fully typed with Fastify route generics |
| [`example/hono-app.js`](./example/hono-app.js) | Hono | JSDoc, `defineRoute`; run via `npx tsx` |
| [`example/hono-app.ts`](./example/hono-app.ts) | Hono | Fully typed with Hono `Context` |
| [`example/koa-app.js`](./example/koa-app.js) | Koa | JSDoc, `defineRoute`; uses `@koa/router` |
| [`example/koa-app.ts`](./example/koa-app.ts) | Koa | Fully typed with `Router.RouterContext` |

---

## License

MIT
