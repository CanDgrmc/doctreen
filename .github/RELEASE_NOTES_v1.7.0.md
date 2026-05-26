# DocTreen v1.7.0 — OpenAPI 3.1 export, no extra annotations

v1.5 made one Zod schema per route the source of truth for documentation.
v1.6 made the same schema reject invalid requests. v1.7 turns the same
schema into a standards-compliant OpenAPI 3.1 document that drops into
Scalar, Redoc, Swagger UI, or any other spec-driven tool — without
writing a separate YAML file or adding a single decorator.

## What's new

📜 **OpenAPI 3.1 at `<docsPath>/openapi.json`.** Every adapter — Express,
Fastify, Hono, Koa, NestJS — now ships an OpenAPI 3.1 endpoint built
from the same schemas that already drive the docs UI. Hit it with curl,
download it from the new header button, or point any spec consumer at
it directly:

```bash
curl https://your-api.example.com/docs/openapi.json > openapi.json
```

🔗 **Drops into the ecosystem you already use.** The output passes
`@apidevtools/swagger-cli validate`, renders cleanly in
[Scalar](https://docs.scalar.com/), [Redoc](https://redocly.com/redoc/),
and Swagger UI, and includes path parameters, query parameters, request
body with `required[]` arrays derived from your Zod schemas, every
declared error response, and tags grouped by the first path segment.

🖱️ **One-click "Export to OpenAPI 3.1" button** in the docs UI, sitting
next to "Export to Postman". Same JSON file the endpoint serves.

🛣️ **Roadmap reshuffled.** Validation (v1.6) and OpenAPI export (v1.7)
are both ticked. Next big items: first-class `openapi.servers` config +
`securitySchemes` so `Authorization` headers stop showing up as plain
parameters, and production-grade schema drift reporting.

## Out of scope for now

- `securitySchemes` / `security` blocks — coming in v1.8. `Authorization`
  and similar headers currently render as `parameters[].in = header`,
  which is valid spec but Redocly flags as suboptimal.
- `callbacks`, `webhooks`, `links`.
- `$ref`-based schema deduplication — everything is inlined for now.

## Migration

No breaking changes. The new endpoint is additive; existing routes,
adapters, and `defineRoute` calls are untouched. Drop in v1.7 and you
get the export for free.

## Try it

```bash
npm install doctreen@latest
```

The [live demo](https://demo.doctreen.dev/docs) shows the button in the
header — click it, paste the file into your spec viewer of choice, and
the routes render with full request / response detail.

---

Full changelog: [CHANGELOG.md](./CHANGELOG.md).
Feedback welcome — [open an issue](https://github.com/CanDgrmc/doctreen/issues).
