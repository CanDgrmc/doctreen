# DocTreen Route Model v1

**Status:** frozen from `doctreen` v1.17.0 (Node). · **Audience:** anyone implementing
DocTreen in another language.

This document describes the data DocTreen passes between its own layers: the shape of a
declared schema, the shape of a discovered route, the shape of a validation failure, and
the shape of a drift event. It is deliberately not an API reference — it says what the
*values* look like, not what functions exist.

It exists because DocTreen now has more than one implementation. The docs UI bundle is
shared between them, the OpenAPI output is claimed to be identical, and a contract
service ingests one payload shape regardless of which runtime produced it. Those claims
need somewhere to live that is not a single codebase's source.

Wherever this document and the Node implementation disagree, **the Node implementation is
correct and this document is a bug**. The executable half of this spec is
[`conformance/`](./conformance/README.md); read it alongside this file.

---

## 1. SchemaNode

A recursive, intentionally lightweight description of a value. Not JSON Schema — just
enough to render key names and primitive types in the docs UI, and enough to expand into
OpenAPI when exported.

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "number" },
    "role": { "type": "string", "enum": ["admin", "user"], "default": "user", "optional": true }
  }
}
```

| Field | Type | Present when |
|---|---|---|
| `type` | `string` | always |
| `properties` | `{ [key]: SchemaNode }` | `type == "object"` |
| `items` | `SchemaNode` | `type == "array"` |
| `optional` | `boolean` | the field may be absent |
| `nullable` | `boolean` | the value may also be null |
| `enum` | `array` | a fixed set of allowed values |
| `const` | `scalar` | a single fixed value |
| `default` | `any` | a default applies when omitted |

`type` is one of `string`, `number`, `boolean`, `null`, `object`, `array`, `unknown`.
There is no integer type — `number` covers both, and OpenAPI receives `number`.

**Key order is part of the format.** `type` comes first; modifiers are appended in the
order they were applied. `default` is written before `optional` because attaching a
default also marks the field optional, and the default is applied first. This matters
because golden fixtures compare serialised output and the UI bundle is shared; two
implementations that emit the same keys in a different order are not interchangeable.

A `SchemaNode` is a plain map, not a class. Implementations should not add private fields
to it — anything extra ends up in JSON output and in the fixtures.

### 1.1 The builder

Every implementation exposes a builder named `s` with these members, and no others:
`string`, `number`, `boolean`, `null`, `unknown`, `object(properties)`, `array(items)`,
`optional(schema)`, `nullable(schema)`, `enum(values)`, `literal(value)`,
`default(schema, value)`.

Two inference rules are easy to get subtly wrong:

- `enum(values)` takes its `type` from the **first non-null entry**, defaulting to
  `string` when the list is empty or entirely null.
- `literal(value)` maps null to `"null"`, booleans to `"boolean"`, numbers to `"number"`,
  and everything else to `"string"`.

In languages where booleans are a subtype of integers (Python), the boolean check must
come first. The JS original has no such hazard, so the ordering is not obvious from
reading it.

`optional`, `nullable` and `default` return a **copy**. They never mutate their argument.

### 1.2 Named schemas

`define_schema(name, schema)` registers a schema under a name and returns it unchanged.
Named schemas are promoted to `components.schemas` in the OpenAPI export and referenced by
`$ref` at every use site, instead of being inlined repeatedly.

The name must **not** be stored inside the schema map: it would leak into JSON output and
change the serialised form. Node attaches it as a non-enumerable Symbol. An implementation
without that facility must keep the association outside the map — for example in an
identity-keyed side table that also retains the object, so its identity cannot be recycled.

---

## 2. RouteEntry

One discovered route. Adapters produce these; the exporter, the docs UI and the drift
detector consume them.

| Field | Type | Notes |
|---|---|---|
| `method` | `string` | Upper-case: `GET`, `POST`, … |
| `path` | `string` | Framework-native form with `:param` segments |
| `params` | `string[]` | Names extracted from `path` |
| `description` | `string \| null` | Becomes the OpenAPI `summary` |
| `requestHeaders` | `{ [name]: string } \| null` | Value is a description or example |
| `requestSchema` | `{ body, query, params } \| null` | Each part a `SchemaNode` or null |
| `responseSchema` | `SchemaNode \| null` | The success response |
| `responses` | `{ [status]: SchemaNode } \| null` | Status-keyed alternative |
| `errors` | `ErrorEntry[] \| null` | Documented failures |
| `hidden` | `boolean` | Excluded from docs and export — see §6 |
| `security` | `SecurityRequirement[]` | `[]` means explicitly public |
| `tags` | `string[]` | Overrides the derived tag |
| `callbacks` | `{ [name]: CallbackDef }` | Per-operation callbacks |
| `examples` | `RouteExamples` | Attached to body and responses |

`path` stays in the framework's own notation. Conversion to OpenAPI's `{param}` form
happens in the exporter, so a route matched at runtime and a route documented in the spec
are the same string until the last moment.

`ErrorEntry` is `{ status, description, schema }`, where `description` and `schema` are
independently nullable. A status declared with only a description documents that the
status exists without pinning its body — which is why response assertion skips it rather
than warning (§5.2).

### 2.1 Derived values

These are computed by the exporter, not stored:

- **operationId** — `<method>_<path>` lower-cased with non-alphanumerics collapsed to `_`:
  `POST /users/:id` → `post_users_id`.
- **Default tag** — the first path segment. `/users/:id` → `users`.
- **Default success status** — `201` for `POST`, `200` for everything else.
- **Default response description** — `"Successful response"`.

---

## 3. Configuration

Adapters accept a user config and normalise it before anything else reads it.
Normalisation fills defaults and converts loose forms into strict ones — a boolean
`validate: true` becomes the full object form, a `defaultErrors` map becomes an
`ErrorEntry[]`. Everything downstream sees only the normalised shape.

The fields that affect the OpenAPI document are `meta` (title, version, description),
`docsPath`, `defaultErrors`, and the `openapi` block (`servers`, `securitySchemes`,
`security`, `tags`, `webhooks`). `servers` defaults to `[{ "url": "/" }]` so "try it out"
works against whatever host is serving the docs.

The remaining fields — `enabled`, `exclude`, `liveReload`, `groups`, `flows`, `flowsPath`,
`validate`, `headHtml`, `drift` — govern runtime behaviour and are outside the exporter's
contract.

### 3.1 Merge precedence

**The route wins.** Where a route declares something the adapter also declares — most
visibly an error status present in both `errors` and `defaultErrors` — the route-local
value replaces the adapter's entirely. It is a replacement, not a deep merge: a route's
`errors[422]` with only a description discards the adapter's `defaultErrors[422]` schema.

The same precedence governs `security`: a route's own requirement replaces the document
default, and an empty array is a real value meaning *explicitly public*, distinct from
"not declared".

---

## 4. OpenAPI export

The export seam is `buildOpenApiDocument(routes, normalizedConfig)` — below every adapter,
so it needs no framework and no server. This is the function the conformance suite tests.

Rules worth stating because a reimplementation could reasonably choose otherwise:

- Output is OpenAPI **3.1.0**. Nullable types are emitted as `type: [<type>, "null"]`, not
  the 3.0 `nullable: true`.
- `required` lists every property that is not `optional`. An empty list is omitted.
- A route whose path falls inside the configured `docsPath` subtree is **stripped**. The
  docs UI and its own spec endpoint never appear in the spec they serve.
- A secured operation drops a declared `Authorization` header from its `parameters`: the
  security scheme already documents it, and emitting both is wrong. Other declared headers
  survive.
- Tags used by a route but absent from `openapi.tags` are still emitted, without metadata.
- `webhooks` is a top-level 3.1 key describing events the server *sends*. It is not a path
  and must never be mistaken for one.

---

## 5. Runtime validation

### 5.1 Request validation and the 422 envelope

When validation is enabled, request parts are parsed against their declared schemas before
the handler runs. On failure the request is rejected with **422** and this body:

```json
{
  "error": "validation_failed",
  "issues": [
    { "path": "body.email", "message": "Invalid email", "code": "invalid_string" }
  ]
}
```

`path` is the part name (`body`, `query`, `params`) followed by the dotted path within it;
the part name alone is used when the failure is not attributable to a field. `message` and
`code` come from the underlying schema library, falling back to `"Invalid"` and
`"invalid"`. Issues from all three parts are collected into one flat list — validation does
not stop at the first failing part.

This envelope is public API. Clients parse it; changing it is a breaking change.

**Write-back** is opt-in. When enabled, the *parsed* value — coercions and defaults
applied — replaces the raw request value, so handlers read what the schema promised rather
than what arrived. Only parts that actually had a validator are written. Frameworks that
expose request properties as read-only getters need a defineProperty-style override, and a
framework that rejects even that must fail soft: validation still succeeded, the handler
just sees uncoerced values.

Validation is a no-op in production by default.

### 5.2 Response assertion

A development-time check that the handler returned what it documented. It **never**
coerces, rewrites, or changes the status — it only reports. Modes: `off` (default), `warn`,
`throw`.

Assertion is **status-aware**: the schema checked is the one declared for the response's
*actual* status. A 2xx is checked against the success schema; a 4xx/5xx against
`errors[status]`, falling back to `defaultErrors[status]`. A status with no declared schema
anywhere is skipped silently — there is no contract to check against. This is why error
envelopes stop producing phantom failures against the success schema.

---

## 6. Layering

Two responsibilities are easy to put in the wrong place, and both are pinned by
conformance case `08-hidden-and-docspath`:

**`hidden` is the adapter's job.** The adapter passes only visible routes to the exporter.
The exporter itself does not filter them — hand it a hidden route and it will document it.
Moving the filter into the exporter looks like a tidy-up and silently changes which layer
owns visibility.

**`docsPath` stripping is the exporter's job.** It removes its own docs subtree
unconditionally.

Hidden routes remain fully functional at runtime. Hiding affects documentation only; it is
not access control and must never be described as such.

---

## 7. Drift detection

Drift compares real request payloads against declared schemas and aggregates the
mismatches. A single event:

```json
{
  "route": { "method": "POST", "path": "/users" },
  "part": "body",
  "issues": [{ "kind": "missing-required", "field": "email", "expected": "string", "got": "undefined" }],
  "sampledAt": 1785600000000
}
```

`kind` is one of `missing-required`, `unexpected-field`, `type-mismatch`. `part` is `body`
or `query`. `sampledAt` is epoch milliseconds.

A store receives events and returns an aggregated report containing, per route, totals by
kind / part / field, first and last seen timestamps, a bounded rolling sample buffer,
hourly buckets over 24 hours and daily buckets over 7 days. Bucket keys are UTC:
`2026-05-27T14` and `2026-05-27`.

The store interface is `record`, `report`, `reset`, plus an **optional** `announceRoutes`,
called once per mount with every visible route so a store can surface endpoints no traffic
has reached yet. Optional means optional: a store without it works, silently, and an
exception thrown from it must never reach the host application.

Sampling defaults to 1% of mismatching requests, and detection defaults to off in
production.

**A note for multi-process runtimes.** Node's single process makes an in-memory store
behave like a global one. Under a pre-forking server — gunicorn, uWSGI, Passenger — each
worker holds its own store and the report reflects one worker at random. This is not a bug
to fix in the store; it is a property of the deployment, and an implementation targeting
such runtimes must say so plainly and ship a shared-store path.

### 7.1 Release attribution

A resolved release is `{ sha, branch, source }`, where `source` records which link in the
detection chain matched — explicit config, then platform environment variables, then a
build stamp file. When nothing matches the result is null, not an error: attribution is
optional and its absence must not stop anything from running.

---

## 8. Flows

A flow is a named, ordered sequence of HTTP steps with variable extraction and assertions
between them — an integration test expressed as data. `{ version: 1, name, steps[] }`,
where each step has an `id`, a `request`, optional `extract` rules that bind values from
the response into the variable context, and optional `assert` expectations. Later steps
interpolate earlier extractions by reference.

The flow document format is shared verbatim across implementations: a flow JSON written for
one runner runs unchanged on the other. Runner *ergonomics* need not match — a
language-native test-framework integration is a better fit than a CLI in some ecosystems —
but the document is the same document.

---

## 9. Versioning

This is **v1**. Additive changes — a new optional field, a new schema modifier — do not
change the version. Anything that alters existing output does, and requires a matching
conformance fixture change and a coordinated release across implementations.

Adding a feature to one implementation without updating this document is how the two
drift apart. The order that works: spec, then fixtures, then implementations.
