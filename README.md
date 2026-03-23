# DocTreen

Auto-generate and serve interactive API documentation for your Node.js backend — zero configuration, zero runtime dependencies.

DocTreen introspects your Express app at runtime, parses your JSDoc comments, and serves a fully interactive documentation UI at `/docs`.

---

## Installation

```bash
npm install doctreen
```

---

## Quick Start

```js
const express = require('express');
const { expressAdapter } = require('doctreen/express');

const app = express();
app.use(express.json());

// Mount the docs middleware
app.use(expressAdapter(app, {
  meta: {
    title: 'My API',
    version: '1.0.0',
    description: 'My project API documentation',
  },
}));

// Your routes
app.get('/users', (req, res) => {
  res.json([]);
});

app.listen(3000, () => {
  console.log('API docs at http://localhost:3000/docs');
});
```

Visit `http://localhost:3000/docs` to see your documentation.

---

## Configuration

Pass a config object as the second argument to `expressAdapter`:

```js
app.use(expressAdapter(app, {
  docsPath: '/docs',          // URL path for the docs UI (default: '/docs')
  enabled: true,              // Show docs at all (default: NODE_ENV !== 'production')
  liveReload: false,          // Re-introspect on every /docs hit (default: false)
  exclude: ['/health'],       // Paths to hide from docs (string or RegExp)
  groups: {                   // Group routes under named sections
    Users: ['/users', '/users/:id'],
    Products: '/products',
  },
  meta: {
    title: 'My API',
    version: '1.0.0',
    description: 'Full description shown in the UI header',
  },
}));
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

For full control over how a route appears in the docs, wrap your handler with `defineRoute`:

```js
const { defineRoute, s } = require('doctreen/express');

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

`defineRoute` takes priority over JSDoc, which takes priority over runtime inference.

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
import express from 'express';
import { expressAdapter } from 'doctreen/express';
import { defineSchema, defineRoute, s, UserConfig } from 'doctreen';

const app = express();
app.use(express.json());

const config: UserConfig = {
  meta: { title: 'My API', version: '1.0.0' },
  groups: { Users: ['/users', '/users/:id'] },
};

app.use(expressAdapter(app, config));
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

import type { RouteSchemas, ExpressLike } from 'doctreen/express';
```

`ExpressLike` is a structural interface — `@types/express` is optional.

---

## How It Works

1. `expressAdapter(app, config)` registers a middleware at `docsPath`
2. On the first request to `/docs`, DocTreen walks `app._router.stack` to discover all registered routes (lazy introspection — solves the middleware-before-routes ordering problem)
3. JSDoc comments on handler functions are parsed at runtime via `fn.toString()`
4. Named schemas registered with `defineSchema` are resolved when referenced in JSDoc tags
5. The UI is served as a self-contained HTML page with zero external dependencies

---

## Example App

```bash
npm run example
# → http://localhost:3000/docs
```

See [`example/app.js`](./example/app.js) for a full working demo with schemas, groups, JSDoc, and multiple route types.

---

## License

MIT
