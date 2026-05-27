# DocTreen v1.10.1 — Drift reset, daily buckets, Redis store

A focused follow-up to v1.10 that closes the four open items from the drift sprint. Pure additive: existing v1.10.0 servers behave identically until the new flags are flipped.

## What's new

♻️ **`POST <docsPath>/drift/reset`.** Clear the in-memory drift store on demand — between integration test runs, after a deploy, or once a misbehaving client has been fixed. Opt-in and ideally protected by a shared secret:

```js
expressAdapter(app, {
  drift: {
    enabled:    true,
    allowReset: true,
    resetToken: process.env.DOCTREEN_RESET_TOKEN,
  },
});
```

```bash
# CI / cron / one-off
npx doctreen drift reset --url http://localhost:3000/docs --token "$DOCTREEN_RESET_TOKEN"

# Or directly
curl -X POST -H "x-doctreen-drift-token: $TOKEN" http://localhost:3000/docs/drift/reset
```

Without `allowReset: true` the endpoint returns `405`. Without `resetToken` it's open — only flip that on internal-only networks. Works on all five adapters.

🛠 **`doctreen drift reset` CLI.** Companion to `drift report`. POSTs to `/drift/reset`, prints a confirmation, exits non-zero on failure. Supports `--url`, `--token`, `--json`.

📆 **Rolling 7-day daily buckets.** Alongside the existing 24-hour hourly buckets (`buckets`), every per-route report now carries a `dailyBuckets` field with the last 7 daily counts. Same sampling, no extra cost — pick whichever resolution your dashboard wants:

```json
{
  "method": "POST",
  "path":   "/users",
  "buckets":      { "2026-05-27T13": 5, "2026-05-27T14": 3 },
  "dailyBuckets": { "2026-05-26": 12, "2026-05-27": 8 }
}
```

🗄 **Redis-backed `DriftStore` reference.** A complete, multi-replica-safe implementation of the `DriftStore` interface ships at [`example/drift-redis-store.js`](./example/drift-redis-store.js). Bring your own `ioredis`/`redis@4+` client; the store handles `record` / `report` / `reset` and survives process restarts:

```js
const Redis = require('ioredis');
const { createRedisDriftStore } = require('doctreen/example/drift-redis-store');

const redis = new Redis(process.env.REDIS_URL);

expressAdapter(app, {
  drift: {
    enabled:    true,
    sampleRate: 0.01,
    store:      createRedisDriftStore({ client: redis, prefix: 'doctreen:drift:' }),
    allowReset: true,
    resetToken: process.env.DOCTREEN_RESET_TOKEN,
  },
});
```

Storage layout uses sets + hashes + lists with key prefixes documented in the file header. Multiple replicas can share one Redis and aggregate into the same dashboard.

## Migration

No breaking changes.

- Reset endpoint defaults to disabled — existing v1.10.0 servers are unchanged until `allowReset` is set.
- `dailyBuckets` is a new top-level field on every per-route report payload; consumers that only read `buckets` continue working.
- `DriftStore` implementations from v1.10.0 keep working — `report()` consumers that strictly type their schema may want to add `dailyBuckets: Record<string, number>` to it.

## What's next

- **OpenAPI polish** (v1.11) — already merged: `$ref` dedup, first-class tags, callbacks/webhooks, multi-example, `doctreen lint openapi`
- **Mock server** (v1.12) — `npx doctreen mock` serves a fake API from the registry, latency/error injection, `--from openapi.json`

## Try it

```bash
npm install doctreen@latest
```

---

Full changelog: [CHANGELOG.md](./CHANGELOG.md).
Feedback welcome — [open an issue](https://github.com/CanDgrmc/doctreen/issues).
