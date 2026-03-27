# DocTreen

Auto-generate and serve interactive API documentation and reusable request flows for Express, Fastify, Hono, and Koa backends.

DocTreen introspects your app at runtime, can read inline JSDoc comments from handlers, loads request-flow presets, and serves an interactive documentation UI at the configured `docsPath`.

![DocTreen UI](https://raw.githubusercontent.com/CanDgrmc/doctreen/main/example/ss-1.png)
![DocTreen UI](https://raw.githubusercontent.com/CanDgrmc/doctreen/main/example/ss-2.png)
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
  flowsPath: './doctreen-flows',
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
| `flows` | `FlowDefinition[]` | `null` | Flow presets embedded directly into the docs UI |
| `flowsPath` | `string` | `'./doctreen-flows'` if present | Directory of `*.json` flow presets to load into the docs UI |
| `exclude` | `string \| RegExp \| Array` | `[]` | Routes to exclude from docs |
| `groups` | `Record<string, string \| string[]>` | `{}` | Group routes into named sections |
| `meta.title` | `string` | `'API Documentation'` | Title shown in the UI |
| `meta.version` | `string` | — | API version label |
| `meta.description` | `string` | — | Description shown below the title |

---

## Request Flows

DocTreen can load named request-flow presets into the docs UI and run them through the same shared engine used by the CLI.

Flows are first-class in the UI:

- a top-level **Flows** tab keeps flows separate from crowded route docs
- the Flows tab includes a built-in guide for writing flow JSON
- the Flows tab includes a built-in flow creator for drafting new flow JSON from documented routes
- each flow can collect runtime inputs and override `baseUrl`
- the creator lets you insert `{{input.*}}`, `{{env.*}}`, and `{{vars.*}}` placeholders into step fields
- prior response fields can be promoted into `extract` entries and reused as `{{vars.*}}`
- route params can be mapped optionally through a simple param helper instead of editing paths by hand
- results are shown in both a visual execution timeline and raw JSON
- the same flow file can be reused for documentation, smoke tests, and CI

### Directory-based loading

If a `./doctreen-flows` directory exists, DocTreen will load every `*.json` file in it automatically. You can also point at a custom directory:

```js
const path = require('path');

app.use(expressAdapter(app, {
  docsPath: '/docs',
  flowsPath: path.join(__dirname, 'doctreen-flows'),
  meta: { title: 'My API', version: '1.0.0' },
}));
```

### Inline flows

You can embed flows directly in config:

```js
app.use(expressAdapter(app, {
  flows: [
    {
      version: 1,
      name: 'Login smoke',
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
  "baseUrl": "http://localhost:3000",
  "inputs": {
    "email": { "type": "string", "required": true }
  },
  "steps": [
    {
      "id": "create-user",
      "request": {
        "method": "POST",
        "path": "/users",
        "body": { "email": "{{input.email}}" }
      },
      "extract": {
        "userId": { "from": "body", "path": "$.id" }
      },
      "assert": {
        "status": 201
      }
    },
    {
      "id": "get-user",
      "request": {
        "method": "GET",
        "path": "/users/{{vars.userId}}"
      },
      "assert": {
        "status": 200,
        "body": {
          "$.id": "{{vars.userId}}"
        }
      }
    }
  ]
}
```

### Complete flow example

```json
{
  "version": 1,
  "name": "User onboarding",
  "description": "Create a user, fetch it back, then delete it.",
  "baseUrl": "http://localhost:3000",
  "inputs": {
    "email": { "type": "string", "required": true },
    "name": { "type": "string", "required": true }
  },
  "steps": [
    {
      "id": "create-user",
      "request": {
        "method": "POST",
        "path": "/users",
        "body": {
          "email": "{{input.email}}",
          "name": "{{input.name}}"
        }
      },
      "extract": {
        "userId": { "from": "body", "path": "$.id" }
      },
      "assert": {
        "status": 201,
        "body": {
          "$.email": "{{input.email}}"
        }
      }
    },
    {
      "id": "get-user",
      "request": {
        "method": "GET",
        "path": "/users/{{vars.userId}}"
      },
      "assert": {
        "status": 200,
        "body": {
          "$.id": "{{vars.userId}}"
        },
        "exists": ["$.email", "$.createdAt"]
      }
    }
  ]
}
```

### Variable namespaces

```json
{
  "baseUrl": "{{env.baseUrl}}",
  "request": {
    "path": "/users/{{vars.userId}}",
    "body": {
      "email": "{{input.email}}"
    }
  }
}
```

- `{{input.*}}`: runtime values entered in the docs UI or CLI
- `{{vars.*}}`: values extracted from previous steps
- `{{env.*}}`: values coming from the flow file or environment overrides

### Extract + assert example

```json
{
  "extract": {
    "userId": { "from": "body", "path": "$.id" },
    "etag":   { "from": "header", "path": "etag" }
  },
  "assert": {
    "status": 201,
    "body": {
      "$.email": "{{input.email}}"
    },
    "exists": ["$.id", "$.createdAt"]
  }
}
```

### In the docs UI

- Flow presets appear in their own **Flows** tab
- The Flows tab includes a built-in information section with JSON examples and creation guidance
- The Flows tab also includes a flow creator that can:
  - add documented routes as draft steps
  - edit flow-level `description`, `baseUrl`, `env`, and `inputs`
  - insert `input`, `env`, and extracted `vars` placeholders into request fields
  - capture values from earlier response schemas and automatically create matching `extract` rules
  - optionally map route params to placeholders without rewriting the whole path manually
- Each flow can collect runtime inputs, override `baseUrl`, and run via the docs server
- Results are shown as both:
  - an execution timeline with step-by-step request/response cards
  - raw JSON from the shared flow runner
- The same preset can work as both a demo scenario and an integration-test asset

### CLI runner

DocTreen also ships a small CLI for running the same flow files headlessly:

```bash
doctreen-flow run doctreen-flows/user-onboarding.json --input email=alice@example.com --input name='Alice Smith'
```

Use named or explicit environment files:

```bash
doctreen-flow run doctreen-flows/user-onboarding.json --env local
doctreen-flow run doctreen-flows/user-onboarding.json --env ./doctreen-flows/environments/staging.json --report json
```

Supported CLI flags:

- `--env <name|file>`
- `--base-url <url>`
- `--input key=value`
- `--no-bail`
- `--report text|json`

---

## Documenting Routes with JSDoc

DocTreen reads JSDoc from the handler function source. In practice, that means the JSDoc block should be placed inside the handler, at the top of the function body. Supported tags:

| Tag | Description | Example |
|---|---|---|
| `@description` | Route description | `@description Get all users` |
| `@param {type} body.name` | Request body field | `@param {string} body.email` |
| `@param {type} query.name` | Query parameter | `@param {string} query.search` |
| `@response {type} name` | Response field | `@response {string} id` |
| `@returns {Type}` | Full response type (schema ref) | `@returns {User}` |
| `@header Name - value` | Request header | `@header Authorization - Bearer <token>` |

### Optional Fields

Wrap a field name in `[brackets]` to mark it as optional:

```js
/**
 * @param {string} body.name
 * @param {string} [body.bio]       optional
 * @param {number} [body.age]       optional
 */
app.post('/users', handler);
```

### Example

```js
app.get('/users/:id', function (req, res) {
  /**
   * @description Get a user by ID
   * @response {string} id
   * @returns {User}
   */
  // ...
  res.json({ id: req.params.id });
});
```

Use `@param {type} query.name` for query fields and `@param {type} body.name` for body fields. Path params are still discovered from the route path itself. If you prefer comments above the route declaration or need stricter control, use `defineRoute(...)` instead of relying on JSDoc parsing.

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
- Lives in its own top-level **Routes** tab when flows are enabled

### Route Detail Panel
- Full schema tree for request body, query params, path params, and response
- **Error responses** — colour-coded by status class (amber 4xx, red 5xx) with optional body schema
- Optional fields shown with `?` suffix
- **Copy as cURL** — generates a ready-to-run curl command with example values
- **Copy for LLM** — generates a structured markdown prompt describing the endpoint (useful for AI-assisted development)
- **Export to Postman** — downloads a Postman Collection v2.1 JSON file; error responses are included as saved example responses

### Flow Runner
- Loads request-flow presets from `flows` config or `flowsPath`
- Uses a dedicated top-level **Flows** tab so flows stay separate from route documentation
- Includes an information section with flow authoring guidance and JSON examples
- Includes a built-in flow creator for assembling draft flows from documented routes
- Lets you insert `input`, `env`, and existing `vars` placeholders into step fields
- Can capture values from earlier response schemas and convert them into reusable `extract` rules
- Supports optional route-param mapping helpers for `:id`-style params
- Runs named flows directly inside the docs UI
- Collects runtime inputs and supports per-run `baseUrl` overrides
- Shows flow execution results as:
  - a visual timeline with per-step request/response details
  - raw JSON output from the shared runner
- Uses the same flow definition format as the `doctreen-flow` CLI

---

## TypeScript

DocTreen ships declaration files alongside the JavaScript. You do not need a separate `@types/doctreen` package.

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

`ExpressLike`, `FastifyLike`, `HonoLike`, and `KoaRouterLike` are structural interfaces exposed by DocTreen. You may still need your framework's own type packages depending on how your application is typed.

---

## How It Works

### Express
1. `expressAdapter(app, config)` registers a middleware at `docsPath`
2. On the first request to `/docs`, DocTreen walks `app._router.stack` to discover all registered routes (lazy introspection — solves the middleware-before-routes ordering problem)
3. Route handlers are wrapped so real HTTP traffic populates request/response schemas automatically
4. JSDoc comments on handler functions are parsed at runtime via `fn.toString()`
5. If flows are configured, `POST /docs/__flows/run` executes them through the shared runner when `docsPath` is `/docs`
6. The UI is served as a self-contained HTML page with zero external dependencies

### Fastify
1. `fastifyAdapter(fastify, config)` registers a Fastify `onRoute` hook and adds the docs GET route
2. Every route added after `fastifyAdapter` is captured by the hook at registration time — no traffic needed
3. Schema resolution order: `defineRoute` → Fastify native JSON Schema → JSDoc block comment
4. Named schemas registered with `defineSchema` are resolved when referenced in JSDoc tags
5. If flows are configured, `POST <docsPath>/__flows/run` executes them through the shared runner

### Hono
1. `honoAdapter(app, config)` adds a GET route at `docsPath` to the Hono app
2. On the first request to the docs page, `app.routes` is read — all routes registered by then are shown
3. Can be called **before or after** your routes (lazy read at request time)
4. Schema resolution order: `defineRoute` → JSDoc block comment
5. If flows are configured, `POST <docsPath>/__flows/run` executes them through the shared runner
6. The adapter reads Hono route metadata lazily and works with Hono apps; the included example uses Node.js via `@hono/node-server`

### Koa
1. `koaAdapter(router, config)` adds a GET route at `docsPath` to the `@koa/router` instance
2. On the first request to the docs page, `router.stack` is read — all routes registered by then are shown
3. Can be called **before or after** your routes (lazy read at request time)
4. Schema resolution order: `defineRoute` → JSDoc block comment
5. If flows are configured, `POST <docsPath>/__flows/run` executes them through the shared runner
6. Mount the router on the Koa app as usual: `app.use(router.routes())`

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
| [`example/app.js`](./example/app.js) | Express | JSDoc, `defineRoute`, named schemas, error responses, flow presets |
| [`example/app.ts`](./example/app.ts) | Express | Fully typed with `defineRoute` generics, flow presets |
| [`example/fastify-app.js`](./example/fastify-app.js) | Fastify | JSDoc, `defineRoute`, Fastify native JSON Schema, flow presets |
| [`example/fastify-app.ts`](./example/fastify-app.ts) | Fastify | Fully typed with Fastify route generics, flow presets |
| [`example/hono-app.js`](./example/hono-app.js) | Hono | JSDoc, `defineRoute`; run via `npx tsx`; flow presets |
| [`example/hono-app.ts`](./example/hono-app.ts) | Hono | Fully typed with Hono `Context`, flow presets |
| [`example/koa-app.js`](./example/koa-app.js) | Koa | JSDoc, `defineRoute`; uses `@koa/router`; flow presets |
| [`example/koa-app.ts`](./example/koa-app.ts) | Koa | Fully typed with `Router.RouterContext`, flow presets |

---

## License

MIT
