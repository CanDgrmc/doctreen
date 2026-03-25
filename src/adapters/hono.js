'use strict';

// ─── JSDoc typedefs ───────────────────────────────────────────────────────────

/**
 * @typedef {import('../index').RouteEntry} RouteEntry
 * @typedef {import('../index').NormalizedConfig} NormalizedConfig
 * @typedef {import('../index').UserConfig} UserConfig
 */

// ─────────────────────────────────────────────────────────────────────────────

const { RouteRegistry, normalizeConfig, shouldExclude, parseJSDoc, defineSchema, s } = require('../index');
const { serveDocsUI } = require('../ui/index');

// Only document these HTTP methods — skip ALL, OPTIONS, HEAD (internal/auto-added)
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
  const matches = routePath.match(/:([^/]+)/g);
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
 * Called for every handler entry in `app.routes` — including middleware.
 * Since `registry.add()` is idempotent, multiple handlers for the same
 * route/method share the same entry, and schemas are only applied when still null.
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
 * Iterates over Hono's `app.routes` array and builds a RouteRegistry.
 * Multiple handlers for the same path+method (middleware chains) are handled
 * correctly: `registry.add()` deduplicates, and schemas are applied from the
 * first handler that provides them.
 *
 * @param {Array<{ method: string, path: string, handler: Function }>} appRoutes
 * @param {NormalizedConfig} config
 * @returns {RouteRegistry}
 */
function buildRegistrySnapshot(appRoutes, config) {
  const registry = new RouteRegistry();

  for (const route of appRoutes) {
    const method = (route.method || '').toUpperCase();
    const path   = route.path   || '';

    if (!HTTP_METHODS_TO_DOCUMENT.has(method)) continue;
    if (!path || shouldExclude(path, config.exclude))  continue;

    const entry = registry.add({
      method,
      path,
      params: extractParamsFromPath(path),
    });

    seedEntry(entry, route.handler);
  }

  return registry;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * honoAdapter
 *
 * Adds a documentation UI route to a Hono app.
 *
 * Routes are discovered lazily: on the first request to `docsPath`, the adapter
 * reads `app.routes` (which Hono keeps up-to-date) and builds the registry.
 * This means `honoAdapter` can be called **before or after** your routes — all
 * routes registered by the time the docs page is first hit will be shown.
 *
 * Schema resolution order (first wins per field):
 *   1. `defineRoute` schemas — explicit, highest priority
 *   2. JSDoc block comment inside the handler function
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { Hono } from 'hono';
 *   import { honoAdapter } from 'doctreen/hono';
 *
 *   const app = new Hono();
 *
 *   app.get('/users', handler);
 *
 *   honoAdapter(app, { docsPath: '/api/docs', meta: { title: 'My API' } });
 *
 *   export default app;  // or serve({ fetch: app.fetch, port: 3000 });
 *
 * @param {object}     app        - The Hono application instance
 * @param {UserConfig} [userConfig]
 */
function honoAdapter(app, userConfig) {
  const config = normalizeConfig(userConfig || {});

  if (!config.enabled) return;

  /** @type {RouteRegistry|null} */
  let cachedRegistry = null;

  app.get(config.docsPath, function serveDocs(c) {
    if (!cachedRegistry || config.liveReload) {
      // Filter out the docs route itself so it doesn't appear in the route list
      const appRoutes = (app.routes || []).filter(
        (r) => r.path !== config.docsPath
      );
      cachedRegistry = buildRegistrySnapshot(appRoutes, config);
    }

    const html = serveDocsUI(cachedRegistry.getAll(), config);
    return c.html(html);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * defineRoute
 *
 * Decorates a Hono route handler with pre-defined documentation schemas so
 * that the UI is populated immediately — without waiting for traffic or JSDoc.
 *
 * Works identically to `defineRoute` from `doctreen/express` and `doctreen/fastify`.
 *
 * @example
 * import { defineRoute, s } from 'doctreen/hono';
 *
 * app.post('/users', defineRoute(
 *   async (c) => {
 *     const body = await c.req.json();
 *     return c.json({ id: 1, ...body }, 201);
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

module.exports = { honoAdapter, defineRoute, defineSchema, s };
