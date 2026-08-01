# DocTreen conformance suite

Language-neutral fixtures that pin what DocTreen turns a route list into. Both the Node
package and the Python port run them and must produce **identical** output — same values,
same key order.

This directory lives in exactly one place: the Node repo, `CanDgrmc/doctreen`. Other
implementations do not vendor a copy — they fetch this one in CI and run it. A copy is a
copy that eventually diverges, and a conformance suite that has diverged is worse than
none, because it still reports green.

## Why this exists

Two implementations of the same product only stay "the same product" if something
mechanical says so. The docs UI bundle is shared between them, the cloud service ingests
one payload shape from both, and users are told the OpenAPI output matches. None of that
survives on good intentions.

So the contract is frozen here as data, not prose: a route list plus a config in, an
OpenAPI document out.

## What is under test

The seam is `buildOpenApiDocument(routes, normalizeConfig(config))` — deliberately below
every framework adapter, so a case needs no Express, no Flask, no HTTP server.

Note what is *not* under test: filtering `hidden` routes. That belongs to the adapter,
which passes `registry.getVisible()`. Case `08-hidden-and-docspath` passes a hidden route
and expects it to appear, so that a port cannot quietly move the filter into the exporter.

## Case format

```
cases/<nn-name>/
  case.json              the input
  expected/openapi.json  the output, exactly
```

`case.json`:

| Key | Meaning |
|---|---|
| `name` | Short identifier |
| `description` | What this case pins down, and why it is worth a case |
| `namedSchemas` | Optional. Registered via `defineSchema` before the build |
| `config` | User config, passed through `normalizeConfig` |
| `routes` | Route entries, exactly as a registry would hold them |

Schemas are plain `SchemaNode` JSON — no Zod, no Pydantic — so the fixture tests the
exporter rather than a schema-library adapter.

**`$named` references.** Anywhere a schema is expected, `{"$named": "User"}` means "the
schema registered under `User`". The runner substitutes the registered object before
building. This exists because `defineSchema` tags a schema by object identity in Node and
by an identity side-table in Python; JSON cannot express "the same object twice", so the
indirection does it instead.

## Running

```bash
node conformance/runners/node.mjs          # Node reference, from the doctreen repo
python conformance/runners/run_python.py   # Python port
```

Two environment variables let the runners work from outside their home repo:

| Variable | Used by | Meaning |
|---|---|---|
| `DOCTREEN_SRC` | `node.mjs` | Path to a `doctreen` `src/` directory |
| `DOCTREEN_CONFORMANCE_DIR` | `run_python.py` | Path to this `conformance/` directory |

The Python port's CI shallow-clones this repo and points `DOCTREEN_CONFORMANCE_DIR` at
the clone, so there is one copy of the fixtures in the world.

Both print one line per case and exit non-zero on any mismatch. A failure reports the
first differing JSON pointer with expected and actual values.

The Python runner exits 0 with a loud `SKIP` while `doctreen.exporters.openapi` does not
exist — but only when `DOCTREEN_CONFORMANCE_ALLOW_SKIP=1` is set. **Remove that variable
from CI the day the exporter lands.** A skip that outlives its reason is worse than no
suite at all.

## Changing a fixture

An `expected/openapi.json` is a golden file captured from the Node implementation
(v1.17.0) and reviewed by hand. Treat a diff as a behaviour change, not a test failure:

1. If the new Node behaviour is intended, update the fixture **and** the Python port in
   the same change, and say so in both CHANGELOGs.
2. If it is not intended, you just caught a regression that would otherwise have shipped.

Adding a case is cheap and always welcome. Every case earns its place by pinning a rule
that a reimplementation could plausibly get wrong — merge precedence, key order, a
default that appears from nowhere. A case that only restates an obvious mapping is noise.

## Coverage

| Case | Pins down |
|---|---|
| `01-minimal-get` | operationId derivation, `:param` → `{param}`, default tag, default 200 description |
| `02-request-body-and-query` | Every schema modifier; how `required` drops optional fields |
| `03-errors-and-default-errors` | Route errors beat `defaultErrors` on a status collision; description-only errors emit no content |
| `04-named-schemas-ref` | Promotion into `components.schemas` and `$ref` dedup at every use site |
| `05-security-and-headers` | Inherit / opt-out / override security; a secured operation drops its `Authorization` header parameter |
| `06-tags-and-status-responses` | Tag metadata, undeclared tags still emitted, status-keyed response maps |
| `07-examples-callbacks-webhooks` | Single `example` vs named `examples`, per-operation callbacks, top-level `webhooks` |
| `08-hidden-and-docspath` | The docsPath subtree is stripped; `hidden` is *not* the exporter's job |
