# Live demo

A small Express + Zod app showcasing the DocTreen v1.5 API. Used as the
deployment target for the [live demo link](https://demo.doctreen.dev/docs)
in the project README.

## Local

```bash
node api/index.js
# then open http://localhost:3000/docs (when wrapped behind a listener)
```

Or import the exported app from your own server file:

```js
const app = require('./api/index');
app.listen(3000);
```

## Vercel

The repo root contains a `vercel.json` that rewrites every path to
`/api/index`. Deploy from the repo root:

```bash
vercel --prod
```

`NPM_CONFIG_PRODUCTION=false` is set in `vercel.json` so the build picks up
`express` and `zod` from devDependencies (DocTreen itself has no runtime
dependencies). If you fork this demo into a standalone project, move
`express` and `zod` into `dependencies` instead.
