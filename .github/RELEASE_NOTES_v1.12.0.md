# DocTreen v1.12.0 — Mock server

Every doctreen-enabled server already exposes a full OpenAPI 3.1 document at `/docs/openapi.json`. v1.12 turns that into the most direct payoff possible: spin up an Express-backed fake of any spec in seconds, with realistic data, CRUD short-circuits, latency, and error injection — no separate spec-stitching, no manual handler stubs.

## What's new

🎭 **`npx doctreen mock` — spec-driven mock server.** Point it at a live `/docs` URL or a local OpenAPI JSON file, get an Express app that serves every operation with a schema-faithful response:

```bash
# From a running doctreen-enabled server
npx doctreen mock --from http://localhost:3000/docs --port 4000

# From an OpenAPI file on disk
npx doctreen mock --from ./openapi.json --port 4000

# With latency + random declared-error injection
npx doctreen mock --from ./openapi.json --latency 100-500 --error-rate 0.1
```

Responses come from the same schema→example generator that powers the docs UI's Copy-as-cURL and Postman buttons. `$ref`, `oneOf` / `anyOf` / `allOf`, `enum`, `const`, `default`, and operation-level `example` / `examples` are all respected.

🛒 **In-memory CRUD short-circuits.** When the spec exposes `/resource` plus `/resource/:id`, `POST` actually creates a row in an in-memory store, `GET /resource` lists, `GET /resource/:id` reads, `PUT` / `PATCH` mutate, `DELETE` removes. Envelope responses (`{ products: [...], total, filters }`) are detected automatically — the array is swapped in while the surrounding shape is regenerated from the schema:

```bash
curl -s http://localhost:4000/products
# → {"products":[],"total":0,"filters":{}}

curl -s -X POST -d '{"name":"Widget","price":9.99}' \
  -H "Content-Type: application/json" \
  http://localhost:4000/products
# → {"name":"Widget","price":9.99,"id":1,"createdAt":"…"}

curl -s http://localhost:4000/products/1
# → {"name":"Widget","price":9.99,"id":1,"createdAt":"…"}
```

Pass `--persist ./fixtures.json` to save the store across restarts. Pass `--no-crud` if you want every endpoint to return synthesised examples instead of stateful CRUD.

🎲 **Optional Faker integration.** Install `@faker-js/faker` and fields with recognisable names (`email`, `name`, `uuid`, `createdAt`, …) plus OpenAPI `format` strings (`uuid`, `email`, `date-time`, `uri`, `ipv4`, …) automatically get realistic values:

```js
generateExample(
  { type: 'object', properties: { email: { type: 'string', format: 'email' } } },
  { faker: true, seed: 42 }
);
// → { email: 'Aida.Effertz18@yahoo.com' }
```

Without Faker installed, output falls back to deterministic placeholders (`'string'`, `0`, `true`). `--no-faker` forces placeholders even when Faker is present. `--seed <n>` makes Faker output reproducible.

⏱ **Latency + error injection.** Stress-test frontend error paths without touching your backend:

```bash
# Fixed 200ms delay on every response
--latency 200

# Random delay between 100 and 500ms
--latency 100-500

# Return a randomly-picked declared 4xx/5xx response 10% of the time
--error-rate 0.1
```

Both flags compose. The selected error response is always one the spec already declares — the body is generated from its declared schema.

🧰 **Public schema→example helper.** The generator behind the docs UI's Copy-as-cURL and Postman buttons is now a first-class export. Use it anywhere you need a JS value from a schema:

```js
const { generateExample } = require('doctreen/example');

generateExample(
  { type: 'object', properties: {
    email: { type: 'string', format: 'email' },
    createdAt: { type: 'string', format: 'date-time' },
    tags: { type: 'array', items: { type: 'string' } },
  }},
  { faker: true }
);
```

Accepts both doctreen `SchemaNode` and OpenAPI 3.x Schema Objects. Pass `components` to resolve `$ref`s.

🧪 **Programmatic mock API.** Embed the mock server in your own scripts or tests instead of shelling out:

```js
const { startMockFromOpenApi } = require('doctreen/mock');

const { app, server, routeCount } = await startMockFromOpenApi({
  from: './openapi.json',
  port: 4000,
  latency: [100, 500],
  errorRate: 0.05,
  persistPath: './fixtures.json',
});

// later, e.g. in afterAll()
server.close();
```

`createMockApp(...)` skips the listen step if you want to mount the mock as middleware inside another Express app.

## Why this matters

The natural lifecycle of a doctreen project so far has been: define routes → ship docs and OpenAPI → wire integration flows → catch drift in CI. v1.12 fills the gap on the **outside-in** side: frontend devs can now build against a faithful fake of the API before the backend is finished, and contract tests can run against the same fake to verify both ends agree on the shape.

The Mock Server is a peer of the existing CLI workflow:

| Command                                | What it does                                                   |
|----------------------------------------|----------------------------------------------------------------|
| `doctreen drift report --fail-on-mismatch` | Catch shape drift between code and live traffic (v1.10)        |
| `doctreen drift reset`                 | Clear the drift store between CI runs (v1.10.1)                |
| `doctreen lint openapi`                | Spectral-lite linter for the exported spec (v1.11)             |
| `doctreen mock --from <url\|file>`     | Serve a spec-driven fake API with CRUD + faker + injection     |

## Compatibility

No breaking changes for existing v1.11.x consumers. New exports (`doctreen/mock`, `doctreen/example`) are additive; `@faker-js/faker` is loaded lazily so it stays optional.

## Upgrade

```bash
npm install doctreen@1.12.0
# optional, for richer mock data
npm install -D @faker-js/faker
```

— [Full changelog →](https://github.com/CanDgrmc/doctreen/blob/main/CHANGELOG.md#1120--2026-05-27)
