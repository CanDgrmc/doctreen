# DocTreen v1.6.0 — Runtime validation from one Zod schema

v1.5 made one Zod schema per route the source of truth for documentation.
v1.6 makes the same schema reject invalid requests with a structured 422
before they ever reach your handler.

## What's new

🛡️ **Runtime validation, opt-in.** Pass `validate: true` to any adapter
and DocTreen runs `safeParseAsync` on `request.body` and `request.query`
using the exact Zod schema you declared. Mismatches short-circuit:

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "error": "validation_failed",
  "issues": [
    { "path": "body.email", "message": "Invalid email", "code": "invalid_string" }
  ]
}
```

Per-route override via `defineRoute({ validate: false })` or
`defineRoute({ validate: true })`. Async refinements work — the gate
uses `safeParseAsync` end-to-end.

All five adapters — Express, Fastify, Hono, Koa, NestJS — ship with the
same flag and the same 422 response shape. The integration is
framework-idiomatic underneath: an Express middleware, a Fastify
`preHandler`, a Hono / Koa middleware, and a NestJS global guard.

🎯 **Sharpened positioning.** The README opens with *"One Zod schema
per route. Get docs, integration tests, **and** runtime validation. No
OpenAPI YAML."* Comparison table picked up a new row.

🧪 **Live demo updated.** [`demo.doctreen.dev`](https://demo.doctreen.dev/docs)
now runs with `validate: true`. POST something invalid to
`/users` and you get a 422 you can actually paste into a tracker.

## Migration

No breaking changes. Validation is off by default; v1.5 → v1.6 is a
drop-in upgrade. Once you flip `validate: true`, the only behavioural
change is that previously-accepted invalid payloads start failing fast.

If you were hand-rolling a NestJS pipe or Express middleware that ran
`zodSchema.parse(req.body)` for every endpoint, you can delete it:

```diff
- @Post()
- async create(@Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserDto) {
+ @Post()
+ @DocRoute({ request: { body: CreateUserSchema } })
+ async create(@Body() body: CreateUserDto) {
```

Set `validate: true` on the adapter once, and validation now flows from
the same source as the docs.

## What's next

- **OpenAPI 3.1 export** — v1.7 headline.
- **Drift detection on Fastify, Hono, Koa, NestJS** — the v1.5 Express
  drift warning ported to the remaining four adapters now that
  validation rails exist.
- **DocTreen Cloud** — hosted docs portal with versioning and CI flow
  monitoring. Private beta soon.

## Try it

```bash
npm install doctreen@latest
```

Or play with the [live demo →](https://demo.doctreen.dev/docs).

---

Full changelog: [CHANGELOG.md](./CHANGELOG.md).
Feedback welcome — [open an issue](https://github.com/CanDgrmc/doctreen/issues).
