# DocTreen v1.9.0 — Custom HTML in the docs `<head>`

A small but long-requested release: a single config option that lets you
drop analytics, favicons, fonts, and meta tags into the docs UI without
forking DocTreen. The live demo at
[doctreen.vercel.app](https://doctreen.vercel.app/docs) is the first
consumer — it now loads Vercel Analytics and Speed Insights through
this exact mechanism.

## What's new

🎨 **`headHtml` config option.** Pass a raw HTML string and DocTreen
appends it to the docs UI `<head>`, just before `</head>`:

```js
expressAdapter(app, {
  meta: { title: 'My API', version: '1.0.0' },
  headHtml: [
    '<script defer src="/_vercel/insights/script.js"></script>',
    '<link rel="icon" href="/favicon.ico" />',
    '<meta name="theme-color" content="#0f1117">',
  ].join('\n'),
});
```

Typical use cases:

- **Analytics**: Vercel Analytics, Plausible, PostHog, Fathom, …
- **Custom branding**: favicon, theme-color, web fonts, OG / Twitter
  card metadata
- **Style overrides**: extra `<style>` blocks or `<link>` to a CDN-hosted
  stylesheet
- **Speed insights / RUM**: load whatever real-user-monitoring snippet
  your monitoring provider gives you

The string is treated as trusted server-side config — DocTreen does
not sanitise — so do not pipe user-submitted data through it.

📊 **Live demo wired up.** The Vercel deployment now loads
`/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js`
through `headHtml`. Once Analytics + Speed Insights are enabled in the
Vercel dashboard for the project, traffic from `/docs` will start
populating the dashboards.

## Migration

No breaking changes. `headHtml` is purely additive; omit it and the UI
renders exactly as in v1.8.

## What's next

- **Production-grade schema drift reporting** — sampling, aggregation,
  and a dashboard view of declared vs. observed schemas.
- **Drift hooks on Fastify / Hono / Koa / NestJS** — port the v1.5
  Express dev warning to the remaining adapters.

## Try it

```bash
npm install doctreen@latest
```

Or open the [live demo](https://doctreen.vercel.app/docs) — the new
analytics scripts are already loaded.

---

Full changelog: [CHANGELOG.md](./CHANGELOG.md).
Feedback welcome — [open an issue](https://github.com/CanDgrmc/doctreen/issues).
