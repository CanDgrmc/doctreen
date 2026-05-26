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

This folder has its own `package.json` so Vercel detects it as an
independent Node project and treats `api/index.js` as a serverless
function. `doctreen` is pulled in via `"doctreen": "file:.."` so the
demo always tracks the local source on the current branch — no need to
publish a release before deploying.

The repo-root `vercel.json` rewrites every path to `/api/index`. Deploy
from the repo root:

```bash
vercel --prod
```

If you fork this demo into a standalone repo, replace the `file:..`
dependency with `"doctreen": "^1.5.0"` and you're done.
