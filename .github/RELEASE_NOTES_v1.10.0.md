# DocTreen v1.10.0 — Production-grade schema drift reporting

v1.5 shipped an experimental dev-only `console.warn` for schema drift on Express. v1.10 promotes that signal into a full reporting pipeline you can run in production: structured aggregates, opt-in sampling, pluggable storage, a UI tab, a JSON endpoint, and a CI-friendly CLI — and it works on all five adapters (Express, Fastify, Hono, Koa, NestJS).

## What's new

🪡 **Structured drift pipeline.** A new `src/internal/drift-store.js` aggregates per-route counts, kind breakdowns (`missing-required` / `unexpected-field` / `type-mismatch`), rolling 24-hour hourly buckets, and the last N samples per route. All adapters emit through the same pipeline, so the shape of the report is identical no matter which framework you run.

⚙️ **The `drift` config block.**

```js
expressAdapter(app, {
  drift: {
    enabled:    true,           // default: NODE_ENV !== 'production'
    sampleRate: 0.01,           // 1% of mismatching requests
    onDrift:    (event) => log.warn(event),
    webhook:    'https://hooks.example.com/drift',
    logLevel:   'silent',       // suppress the per-process console.warn
  },
});
```

Pass `false` to disable, `true` to enable with defaults, or an object to fine-tune. The webhook fires on every recorded event; `onDrift` runs synchronously for in-process side effects.

📊 **`GET /docs/drift.json`.** Every adapter exposes the aggregated report at the docs path. Same shape powers the UI tab and the CLI:

```json
{
  "generatedAt": 1748371000000,
  "totalIssues": 12,
  "routes": [{
    "method":  "POST",
    "path":    "/users",
    "total":   8,
    "kinds":   { "missing-required": 3, "unexpected-field": 2, "type-mismatch": 3 },
    "parts":   { "body": 7, "query": 1 },
    "fields":  { "email": 3, "age": 2 },
    "buckets": { "2026-05-27T13": 5, "2026-05-27T14": 3 },
    "samples": [ /* up to maxSamples recent events */ ]
  }]
}
```

🖥 **UI: Drift tab.** Shown in the docs UI when drift is enabled. Kind summary across the whole API, per-route cards with samples and hourly histogram, and inline `DRIFT N` badges on the routes table so problem routes are visible without leaving the regular view.

🔬 **`npx doctreen drift report` CLI.** New umbrella binary at `bin/doctreen.js`. Hits `/drift.json` on a running server, prints a CI-friendly table, exits 1 when `--fail-on-mismatch` is set and drift is present:

```bash
npx doctreen drift report --url http://localhost:3000/docs --fail-on-mismatch
# 0 routes with drift  → exit 0
# 3 routes with drift  → table + exit 1
```

Drop it into integration test runs so PRs catch shape changes before they merge.

🔌 **Pluggable `DriftStore`.** The default in-memory store is fine for single-process apps. For multi-replica or long-running deployments, implement the three-method interface and pass it as `drift.store`:

```ts
interface DriftStore {
  record(event: DriftEvent): void | Promise<void>;
  report(): DriftReport | Promise<DriftReport>;
  reset(): void | Promise<void>;
}
```

A Redis-backed reference implementation lands in v1.10.1.

## Migration

No breaking changes. The experimental v1.5 `console.warn` still fires (per unique drift signature). To unlock the full report, opt in:

```js
expressAdapter(app, { drift: { enabled: true, sampleRate: 0.01 } });
```

The drift hook on Fastify / Hono / Koa / NestJS — previously a roadmap item — ships in this release.

## What's next

- **Reset endpoint, daily buckets, Redis store reference** (v1.10.1) — already in flight
- **OpenAPI polish** (v1.11) — `$ref` dedup, first-class tags, callbacks/webhooks, multi-example, `doctreen lint openapi`

## Try it

```bash
npm install doctreen@latest
```

---

Full changelog: [CHANGELOG.md](./CHANGELOG.md).
Feedback welcome — [open an issue](https://github.com/CanDgrmc/doctreen/issues).
