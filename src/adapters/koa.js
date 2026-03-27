'use strict';

// ─── JSDoc typedefs ───────────────────────────────────────────────────────────

/**
 * @typedef {import('../index').RouteEntry} RouteEntry
 * @typedef {import('../index').NormalizedConfig} NormalizedConfig
 * @typedef {import('../index').UserConfig} UserConfig
 */

// ─────────────────────────────────────────────────────────────────────────────

const { RouteRegistry, normalizeConfig, shouldExclude, parseJSDoc, defineSchema, s } = require('../index');
const { getUiFlows, runFlowPayload } = require('../flows');
const { serveDocsUI } = require('../ui/index');

// Only document these HTTP methods — skip HEAD, OPTIONS (auto-added by @koa/router for GET routes)
const HTTP_METHODS_TO_DOCUMENT = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * normalizeErrors
 *
 * Converts the user-facing errors map (Record<number, string | { description?, schema? }>)
 * into the internal ErrorEntry[] format.
 *
 * @param {Record<number, string | { description?: string|null, schema?: import('../index').SchemaNode|null }>} errors
 * @returns {import('../index').ErrorEntry[]}
 */
function normalizeErrors(errors) {
  return Object.keys(errors).map(function (status) {
    const value = errors[Number(status)];
    if (typeof value === 'string') {
      return { status: Number(status), description: value, schema: null };
    }
    return {
      status: Number(status),
      description: (value && value.description) || null,
      schema: (value && value.schema) || null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * extractParamsFromPath
 *
 * Pulls named parameter segments from a path string.
 * e.g. "/users/:id/posts/:postId" → ["id", "postId"]
 *
 * @param {string} routePath
 * @returns {string[]}
 */
function extractParamsFromPath(routePath) {
  const matches = routePath.match(/:([^/?]+)/g);
  return matches ? matches.map((p) => p.slice(1)) : [];
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * seedEntry
 *
 * Populates a RouteEntry from a handler by checking, in order:
 *   1. defineRoute schemas (`handler.__docLibSchema`)
 *   2. JSDoc block comment (`parseJSDoc`)
 *
 * Called for every handler in a layer's middleware stack. Multiple handlers
 * for the same route are tried in order — the first that provides a value wins.
 *
 * @param {RouteEntry} entry
 * @param {Function}   handler
 */
function seedEntry(entry, handler) {
  if (!handler || typeof handler !== 'function') return;

  // 1. defineRoute — highest priority
  if (handler.__docLibSchema) {
    const predef = handler.__docLibSchema;
    if (entry.requestSchema  === null && predef.request   !== undefined) entry.requestSchema  = predef.request;
    if (entry.responseSchema === null && predef.response  !== undefined) entry.responseSchema = predef.response;
    if (entry.description    === null && predef.description)             entry.description    = predef.description;
    if (entry.requestHeaders === null && predef.headers)                 entry.requestHeaders = predef.headers;
    if (entry.errors         === null && predef.errors)                  entry.errors         = normalizeErrors(predef.errors);
  }

  // 2. JSDoc — fallback when any field is still missing
  if (entry.description === null || entry.requestSchema === null || entry.responseSchema === null) {
    const jsDoc = parseJSDoc(handler);
    if (jsDoc) {
      if (entry.description    === null && jsDoc.description) entry.description    = jsDoc.description;
      if (entry.requestHeaders === null && jsDoc.headers)     entry.requestHeaders = jsDoc.headers;
      if (entry.requestSchema  === null && jsDoc.request)     entry.requestSchema  = jsDoc.request;
      if (entry.responseSchema === null && jsDoc.response)    entry.responseSchema = jsDoc.response;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildRegistrySnapshot
 *
 * Iterates over @koa/router's `router.stack` (an array of Layer objects) and
 * builds a RouteRegistry. Each Layer has `methods`, `path`, and `stack`
 * (an array of Koa middleware functions).
 *
 * @param {Array<{ methods: string[], path: string, stack: Function[] }>} layers
 * @param {NormalizedConfig} config
 * @returns {RouteRegistry}
 */
function buildRegistrySnapshot(layers, config) {
  const registry = new RouteRegistry();

  for (const layer of layers) {
    const path    = layer.path || '';
    if (!path || shouldExclude(path, config.exclude)) continue;

    const methods = (layer.methods || []).filter((m) => HTTP_METHODS_TO_DOCUMENT.has(m));

    for (const method of methods) {
      const entry = registry.add({
        method,
        path,
        params: extractParamsFromPath(path),
      });

      // Try each handler in the layer's middleware stack — first value wins per field
      for (const handler of (layer.stack || [])) {
        seedEntry(entry, handler);
      }
    }
  }

  return registry;
}

function readJsonBody(ctx) {
  if (ctx.request && ctx.request.body && typeof ctx.request.body === 'object') {
    return Promise.resolve(ctx.request.body);
  }

  return new Promise(function (resolve, reject) {
    let raw = '';
    ctx.req.on('data', function (chunk) { raw += chunk; });
    ctx.req.on('end', function () {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_error) {
        reject(new Error('Invalid JSON request body.'));
      }
    });
    ctx.req.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * koaAdapter
 *
 * Adds a documentation UI route to a @koa/router instance.
 *
 * Routes are discovered lazily: on the first request to `docsPath`, the adapter
 * reads `router.stack` (which @koa/router keeps up-to-date) and builds the registry.
 * This means `koaAdapter` can be called **before or after** your routes — all
 * routes registered by the time the docs page is first hit will be shown.
 *
 * Schema resolution order (first wins per field):
 *   1. `defineRoute` schemas — explicit, highest priority
 *   2. JSDoc block comment inside the handler function
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   const Koa = require('koa');
 *   const Router = require('@koa/router');
 *   const { koaAdapter } = require('doctreen/koa');
 *
 *   const app = new Koa();
 *   const router = new Router();
 *
 *   router.get('/users', handler);
 *
 *   koaAdapter(router, { docsPath: '/api/docs', meta: { title: 'My API' } });
 *
 *   app.use(router.routes());
 *   app.use(router.allowedMethods());
 *   app.listen(3000);
 *
 * @param {object}     router     - The @koa/router instance
 * @param {UserConfig} [userConfig]
 */
function koaAdapter(router, userConfig) {
  const config = normalizeConfig(userConfig || {});

  if (!config.enabled) return;

  /** @type {RouteRegistry|null} */
  let cachedRegistry = null;

  router.get(config.docsPath, async function serveDocs(ctx) {
    if (!cachedRegistry || config.liveReload) {
      // Filter out the docs route itself so it doesn't appear in the route list
      const layers = (router.stack || []).filter(
        (layer) => layer.path !== config.docsPath && layer.path !== config.docsPath + '/__flows/run'
      );
      cachedRegistry = buildRegistrySnapshot(layers, config);
    }

    ctx.type = 'text/html';
    ctx.body = serveDocsUI(cachedRegistry.getAll(), config, { flows: getUiFlows(config) });
  });

  router.post(config.docsPath + '/__flows/run', async function runDocsFlow(ctx) {
    try {
      const payload = await readJsonBody(ctx);
      const result = await runFlowPayload(payload || {});
      ctx.status = result.ok ? 200 : 422;
      ctx.body = result;
    } catch (error) {
      ctx.status = 400;
      ctx.body = { ok: false, error: error.message || String(error) };
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * defineRoute
 *
 * Decorates a Koa route handler with pre-defined documentation schemas so
 * that the UI is populated immediately — without waiting for traffic or JSDoc.
 *
 * Works identically to `defineRoute` from `doctreen/express`, `doctreen/fastify`,
 * and `doctreen/hono`.
 *
 * @example
 * const { defineRoute, s } = require('doctreen/koa');
 *
 * router.post('/users', defineRoute(
 *   async (ctx) => {
 *     ctx.status = 201;
 *     ctx.body = { id: 1, name: ctx.request.body.name };
 *   },
 *   {
 *     request:  { body: s.object({ name: s.string(), email: s.string() }) },
 *     response: s.object({ id: s.number(), name: s.string() }),
 *     errors:   { 409: 'Email already in use' },
 *   }
 * ));
 *
 * @param {Function} handler
 * @param {{ request?: { body?: import('../index').SchemaNode|null, query?: import('../index').SchemaNode|null }|null, response?: import('../index').SchemaNode|null, description?: string, headers?: Record<string,string>, errors?: Record<number, string|{ description?: string|null, schema?: import('../index').SchemaNode|null }> }} [schemas]
 * @returns {Function}
 */
function defineRoute(handler, schemas) {
  handler.__docLibSchema = schemas || {};
  return handler;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { koaAdapter, defineRoute, defineSchema, s };
