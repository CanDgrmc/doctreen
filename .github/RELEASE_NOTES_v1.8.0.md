# DocTreen v1.8.0 — security schemes + hide-a-route

v1.7 shipped a valid OpenAPI 3.1 document. v1.8 makes it a *good* one:
`securitySchemes` declared once, attached automatically, with the
`Authorization` header no longer awkwardly mirrored as a plain
parameter. Plus a long-requested escape hatch for endpoints that should
serve traffic but not show up in the docs.

## What's new

🛡️ **`securitySchemes` + per-route `security`.** Declare auth schemes
once on the adapter, set a global default, override per route as
needed:

```js
expressAdapter(app, {
  openapi: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    security: [{ bearerAuth: [] }],   // applies to every route by default
  },
});

// Override per route
app.post('/auth/login', defineRoute(handler, { security: [] }));         // public
app.get('/admin/stats', defineRoute(handler, { security: [{ adminAuth: [] }] }));
```

When a route has any effective security requirement, DocTreen also
strips the now-redundant `Authorization` header from `parameters[]`,
so Redocly's `security-defined` rule passes cleanly.

🙈 **`hidden: true` per route.** Useful for internal admin tools,
experimental flags, or routes you can't remove yet:

```js
app.get('/internal/metrics', defineRoute(handler, { hidden: true }));
```

NestJS gains a `@DocHidden()` shorthand alongside the existing
`@DocRoute({ hidden: true })` form.

🌐 **`config.openapi.servers`.** Point the spec at your real
environments:

```js
expressAdapter(app, {
  openapi: {
    servers: [
      { url: 'https://api.example.com',         description: 'Production' },
      { url: 'https://staging.api.example.com', description: 'Staging' },
    ],
  },
});
```

Defaults to `[{ url: '/' }]` (same origin as the docs page) when
omitted — Swagger UI's "Try it out" keeps working.

📚 **Type surface caught up.** `UserConfig` now declares `validate`
(back-filled from v1.6) and the new `openapi` block; `RouteEntry`
lists `requestValidators`, `validateOverride`, `hidden`, and
`security`; `RouteRegistry` gains type stubs for `getVisible`,
`find`, and `findByRequestPath` that have been live since v1.6/v1.8.

## Migration

No breaking changes. Every new field defaults to "behave like v1.7"
when omitted. Set `openapi.security: [{ bearerAuth: [] }]` and you'll
notice the `Authorization` header drop out of the spec — that's the
intended effect, not a regression.

## What's next

- **Production-grade schema drift reporting** — sampling, aggregation,
  and a dashboard view of declared vs. observed schemas.
- **Drift hooks on Fastify / Hono / Koa / NestJS** — port the v1.5
  Express dev warning to the remaining adapters.

## Try it

```bash
npm install doctreen@latest
```

The [live demo](https://demo.doctreen.dev/docs) exercises the new
fields end-to-end.

---

Full changelog: [CHANGELOG.md](./CHANGELOG.md).
Feedback welcome — [open an issue](https://github.com/CanDgrmc/doctreen/issues).
