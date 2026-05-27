# DocTreen v1.11.0 — OpenAPI polish

The OpenAPI exporter that landed in v1.7 was deliberately scrappy: schemas inlined everywhere, tags inferred from the path, no callbacks, no examples beyond a single inferred shape. v1.11 closes that gap. Every roadmap item under "OpenAPI polish" ships in this release.

## What's new

🪢 **`components.schemas` with `$ref` deduplication.** Wrap any schema with `defineSchema('Name', ...)` and the exporter promotes it to `components.schemas.Name` automatically — every occurrence across `requestBody`, `responses`, parameters, callbacks, and webhooks turns into `{ $ref: '#/components/schemas/Name' }`:

```js
const { s, defineSchema } = require('doctreen');

const User = defineSchema('User', s.object({
  id:    s.number(),
  name:  s.string(),
  email: s.string(),
}));

app.post('/users',    defineRoute(handler, { request: { body: User }, response: User }));
app.get('/users/:id', defineRoute(handler, { response: User }));
```

Anonymous object schemas with three or more properties that appear in two or more places also auto-promote under stable `Schema1`, `Schema2`, … names — you get the dedup benefit without naming every shape.

🏷 **Per-route + top-level tags.** `defineRoute({ tags: [...] })` (and `@DocRoute({ tags: [...] })` on NestJS) overrides the legacy first-path-segment default. Document-level metadata lives at `config.openapi.tags`:

```js
expressAdapter(app, {
  openapi: {
    tags: [
      { name: 'users',   description: 'User account management' },
      { name: 'billing', description: 'Invoices + payment methods' },
    ],
  },
});

app.post('/users', defineRoute(handler, { tags: ['users', 'public'], /* ... */ }));
```

Tags used by routes but not declared at the top level are auto-appended so the spec stays consistent. The new `doctreen lint openapi` warns about undescribed tags.

📞 **OpenAPI 3.1 callbacks + webhooks.** Per-operation callbacks for the spec's runtime-expression callback URLs:

```js
app.post('/payments', defineRoute(handler, {
  description: 'Create a payment',
  callbacks: {
    onPaymentSucceeded: {
      url:      '{$request.body#/callbackUrl}',
      method:   'POST',
      request:  { body: s.object({ paymentId: s.string() }) },
      response: s.object({ ok: s.boolean() }),
    },
  },
}));
```

Document-level webhooks for events the server emits:

```js
expressAdapter(app, {
  openapi: {
    webhooks: {
      userDeleted: {
        method:  'POST',
        summary: 'Fired when a user closes their account',
        request: { body: s.object({ userId: s.number(), deletedAt: s.string() }) },
      },
    },
  },
});
```

Both reuse the request/response/error pipeline — Zod or SchemaNode accepted, `$ref` dedup applies.

🧪 **Multi-example bodies and responses.**

```js
defineRoute(handler, {
  request:  { body: User },
  response: User,
  errors:   { 422: 'Validation failed' },
  examples: {
    request: {
      basic: { value: { name: 'Ada',  email: 'ada@example.com' }, summary: 'Minimum' },
      admin: { value: { name: 'Boss', email: 'boss@x.com', role: 'admin' }, summary: 'With role' },
    },
    response:  { id: 1, name: 'Ada', email: 'ada@example.com' },
    responses: { 422: { value: { errors: ['email is required'] } } },
  },
});
```

Single values render as OpenAPI `example`; named maps render as `examples`. Aliases: `body` → `request`, `success` → `response`.

🩺 **`npx doctreen lint openapi`.** Spectral-lite linter for the exported (or any) OpenAPI 3.x document. Nine rules across `error` / `warning` / `info`:

- duplicate operationIds
- missing `info.title` / `info.version`
- undeclared path parameters (`{id}` in template, missing from `parameters[]`)
- untagged operations / undescribed tags
- missing 4xx responses
- unused `components.schemas` entries

```bash
# Live URL
npx doctreen lint openapi --url http://localhost:3000/docs

# Local file
npx doctreen lint openapi --file ./build/openapi.json --fail-on warning

# CI-friendly JSON
npx doctreen lint openapi --url https://api.example.com/docs --json
```

Exits 1 when the configured `--fail-on` threshold is reached — drop into CI alongside `doctreen drift report`.

## Migration

No breaking changes for users.

- Specs that previously inlined the same schema multiple times now ship a single `components.schemas` entry referenced by `$ref`. Spec validators (Spectral, Redocly) handle this natively; custom consumers reading SchemaObjects directly must follow `$ref`s (one extra hop through `components.schemas`).
- `tagFor()` is no longer exported from `src/exporters/openapi.js`; renamed to `defaultTagFor()`. Public API consumers reach `buildOpenApiDocument` only, so this is invisible — but if you were importing the helper directly, rename.

## What's next

- **Mock server** (v1.12) — `npx doctreen mock` serves a fake API from the registry; Faker-backed examples; `--latency`, `--error-rate` flags; `--from openapi.json` for spec-driven mocking
- **Type & client codegen** (v1.13) — typed request/response interfaces and a tRPC-style fetch wrapper, in watch mode for dev

## Try it

```bash
npm install doctreen@latest
```

---

Full changelog: [CHANGELOG.md](./CHANGELOG.md).
Feedback welcome — [open an issue](https://github.com/CanDgrmc/doctreen/issues).
