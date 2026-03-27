'use strict';

// ─── JSDoc typedefs ───────────────────────────────────────────────────────────

/**
 * @typedef {import('../index').RouteEntry} RouteEntry
 * @typedef {import('../index').NormalizedConfig} NormalizedConfig
 * @typedef {import('../index').UserConfig} UserConfig
 */

/**
 * Express handler layer — one entry in `layer.route.stack`.
 * @typedef {{ handle: Function & { __docLibContainer?: { entry: RouteEntry } } }} ExpressHandlerLayer
 */

/**
 * Express router stack layer — one entry in `app._router.stack`.
 * These are Express 4 internals; we keep the shape minimal and explicit.
 * @typedef {{
 *   route?: { path: string, methods: Record<string, boolean>, stack: ExpressHandlerLayer[] },
 *   regexp:  { fast_slash?: boolean, fast_star?: boolean, source: string },
 *   keys?:   Array<{ name: string | number, optional?: boolean }>,
 *   name?:   string,
 *   handle?: Function & { stack?: ExpressLayer[] }
 * }} ExpressLayer
 */

// ─────────────────────────────────────────────────────────────────────────────

const { RouteRegistry, normalizeConfig, shouldExclude, inferSchema, parseJSDoc, defineSchema, s } = require('../index');
const { getUiFlows, runFlowPayload } = require('../flows');
const { serveDocsUI } = require('../ui/index');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

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
 * Pulls named parameter segments from an Express-style path string.
 * e.g. "/users/:id/posts/:postId" → ["id", "postId"]
 *
 * @param {string} routePath
 * @returns {string[]}
 */
function extractParamsFromPath(routePath) {
  const matches = routePath.match(/:([^/?]+)/g);
  return matches ? matches.map((p) => p.slice(1)) : [];
}

/**
 * normalizeJoinedPath
 *
 * Joins a parent prefix and child path without introducing duplicate slashes.
 *
 * @param {string} prefix
 * @param {string} path
 * @returns {string}
 */
function normalizeJoinedPath(prefix, path) {
  const full = `${prefix || ''}${path || ''}`;
  const normalized = full.replace(/\/{2,}/g, '/');
  return normalized || '/';
}

/**
 * regexpToMountPath
 *
 * Reconstructs an Express router mount path from the layer regexp and keys.
 * Express stores mounted router params in `layer.keys`, which lets us recover
 * `/:id` instead of leaking the raw regexp fragment into the docs.
 *
 * @param {ExpressLayer} layer
 * @returns {string}
 */
function regexpToMountPath(layer) {
  const keys = Array.isArray(layer.keys) ? layer.keys : [];
  let keyIndex = 0;

  let path = layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/')
    .replace(/\/\?\(\?=\/\|\$\)$/, '')
    .replace(/\/\?$/, '');

  path = path.replace(/\(\?:\/\(\[\^\/\]\+\?\)\)(\?)?/g, function (_match, optional) {
    const key = keys[keyIndex++] && keys[keyIndex - 1].name;
    const suffix = optional ? '?' : '';
    return typeof key === 'string' ? `/:${key}${suffix}` : `/:param${suffix}`;
  });

  path = path.replace(/\/\(\.\*\)(\?)?/g, function (_match, optional) {
    keyIndex += 1;
    return optional ? '/*?' : '/*';
  });

  return path || '/';
}

/**
 * layerToPath
 *
 * Converts an Express router layer's regexp back to a readable path string.
 * Prefers layer.route.path (clean) and falls back to regexp source parsing.
 *
 * @param {ExpressLayer} layer
 * @param {string} prefix
 * @returns {string}
 */
function layerToPath(layer, prefix) {
  if (layer.route) {
    return normalizeJoinedPath(prefix, layer.route.path);
  }

  if (layer.regexp.fast_slash) return normalizeJoinedPath(prefix, '/');
  if (layer.regexp.fast_star)  return normalizeJoinedPath(prefix, '*');

  return normalizeJoinedPath(prefix, regexpToMountPath(layer));
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * wrapRouteHandlers
 *
 * Wraps each handler in a route's handler stack so that real HTTP traffic
 * populates request/response schemas on the RouteEntry object.
 *
 * Uses a shared `container` object (not a direct closure over `entry`) so
 * that re-introspection during liveReload can update the container to point
 * at the new entry — without needing to re-wrap the function itself.
 *
 * Wrapping is idempotent: handlers already wrapped are detected via
 * `handler.handle.__docLibContainer` and only their container is updated.
 *
 * @param {ExpressHandlerLayer[]} handlerStack - layer.route.stack from Express
 * @param {RouteEntry} entry      - The RouteEntry to attach schemas to
 */
function wrapRouteHandlers(handlerStack, entry) {
  for (const handler of handlerStack) {
    if (!handler.handle || typeof handler.handle !== 'function') continue;

    // Already wrapped — migrate captured schemas to the new entry before
    // redirecting the container. Without this, liveReload re-introspection
    // creates a blank entry and wipes every schema collected from real traffic.
    if (handler.handle.__docLibContainer) {
      const container = handler.handle.__docLibContainer;
      const prev      = container.entry;

      if (prev.responseSchema !== null && entry.responseSchema === null) {
        entry.responseSchema = prev.responseSchema;
      }
      if (prev.requestSchema !== null && entry.requestSchema === null) {
        entry.requestSchema = prev.requestSchema;
      }
      if (prev.description !== null && entry.description === null) {
        entry.description = prev.description;
      }
      if (prev.requestHeaders !== null && entry.requestHeaders === null) {
        entry.requestHeaders = prev.requestHeaders;
      }
      if (prev.errors !== null && entry.errors === null) {
        entry.errors = prev.errors;
      }

      container.entry = entry;
      continue;
    }

    const original = handler.handle;

    // If the handler was decorated with defineRoute, seed the entry now so
    // documentation is available before any real traffic hits the route.
    if (original.__docLibSchema) {
      const predef = original.__docLibSchema;
      if (entry.requestSchema === null && predef.request !== undefined) {
        entry.requestSchema = predef.request;
      }
      if (entry.responseSchema === null && predef.response !== undefined) {
        entry.responseSchema = predef.response;
      }
      if (entry.description === null && predef.description) {
        entry.description = predef.description;
      }
      if (entry.requestHeaders === null && predef.headers) {
        entry.requestHeaders = predef.headers;
      }
      if (entry.errors === null && predef.errors) {
        entry.errors = normalizeErrors(predef.errors);
      }
    }

    // Fallback: parse JSDoc block comment from the handler source.
    // This lets plain JS handlers document themselves without importing defineRoute.
    // Priority: defineRoute > JSDoc > runtime traffic inference.
    if (entry.description === null || entry.requestSchema === null || entry.responseSchema === null) {
      const jsDoc = parseJSDoc(original);
      if (jsDoc) {
        if (entry.description    === null && jsDoc.description) entry.description    = jsDoc.description;
        if (entry.requestHeaders === null && jsDoc.headers)     entry.requestHeaders = jsDoc.headers;
        if (entry.requestSchema  === null && jsDoc.request)     entry.requestSchema  = jsDoc.request;
        if (entry.responseSchema === null && jsDoc.response)    entry.responseSchema = jsDoc.response;
      }
    }

    // Mutable container — survives liveReload re-introspection
    const container = { entry };

    /**
     * @param {import('http').IncomingMessage & { body?: any, query?: Record<string, any> }} req
     * @param {import('http').ServerResponse & { json?: Function }} res
     * @param {Function} next
     */
    handler.handle = function docLibWrappedHandler(req, res, next) {
      const currentEntry = container.entry;

      if (currentEntry) {
        const originalJson = /** @type {any} */ (res).json;

        if (typeof originalJson === 'function') {
          // Intercept res.json. By the time the handler calls res.json(),
          // body-parser has long since populated req.body and req.query,
          // so we capture both request and response schemas here.
          /** @type {any} */ (res).json = function docLibInterceptedJson(responseBody) {
            // ── Capture request schema ──────────────────────────────────────
            const reqBody  = /** @type {any} */ (req).body;
            const reqQuery = /** @type {any} */ (req).query;

            const hasBody  = reqBody  != null && typeof reqBody  === 'object' && Object.keys(reqBody).length  > 0;
            const hasQuery = reqQuery != null && typeof reqQuery === 'object' && Object.keys(reqQuery).length > 0;

            if (!currentEntry.requestSchema) {
              currentEntry.requestSchema = {
                body:  hasBody  ? inferSchema(reqBody)  : null,
                query: hasQuery ? inferSchema(reqQuery) : null,
              };
            } else {
              if (hasBody  && currentEntry.requestSchema.body  === null) {
                currentEntry.requestSchema.body  = inferSchema(reqBody);
              }
              if (hasQuery && currentEntry.requestSchema.query === null) {
                currentEntry.requestSchema.query = inferSchema(reqQuery);
              }
            }

            // ── Capture response schema ─────────────────────────────────────
            if (!currentEntry.responseSchema) {
              currentEntry.responseSchema = inferSchema(responseBody);
            }

            // Restore immediately so stacking wrappers can't occur if
            // json() is called more than once on the same res object.
            /** @type {any} */ (res).json = originalJson;
            return originalJson.call(res, responseBody);
          };
        }
      }

      return original.call(this, req, res, next);
    };

    handler.handle.__docLibContainer = container;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * walkStack
 *
 * Recursively traverses Express's internal router stack to collect all
 * registered routes and wrap their handlers for payload introspection.
 *
 * @param {ExpressLayer[]} stack
 * @param {string} prefix
 * @param {RouteRegistry} registry
 * @param {NormalizedConfig} config
 */
function walkStack(stack, prefix, registry, config) {
  if (!Array.isArray(stack)) return;

  for (const layer of stack) {
    if (layer.route) {
      const route     = layer.route; // narrowed — route is defined from here on
      const routePath = layerToPath(layer, prefix);
      if (shouldExclude(routePath, config.exclude)) continue;

      const methods = Object.keys(route.methods).filter(
        (m) => HTTP_METHODS.includes(m) && route.methods[m]
      );

      for (const method of methods) {
        // add() returns the stored entry reference (existing or new)
        const entry = registry.add({
          method,
          path: routePath,
          params: extractParamsFromPath(routePath),
        });

        // Wrap handlers so real traffic populates the schema fields
        wrapRouteHandlers(route.stack, entry);
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const nestedPrefix = layerToPath(layer, prefix).replace(/\/$/, '');
      walkStack(layer.handle.stack, nestedPrefix, registry, config);
    }
  }
}

/**
 * introspectExpressApp
 *
 * @param {object} app
 * @param {RouteRegistry} registry
 * @param {NormalizedConfig} config
 */
function introspectExpressApp(app, registry, config) {
  // Do NOT call registry.clear() here.
  //
  // Clearing would destroy request/response schemas that were captured from
  // real HTTP traffic, because liveReload calls this function on every /docs
  // request.  registry.add() is idempotent (deduplicates by method:path), so
  // re-introspecting simply skips already-known routes and appends new ones.
  // Stale routes (removed from the app) remain in docs until server restart —
  // an acceptable trade-off in development mode.

  const router = /** @type {any} */ (app)._router || /** @type {any} */ (app).router;

  if (!router || !Array.isArray(router.stack)) {
    console.warn(
      '[doctreen] Could not access Express router stack. ' +
        'Make sure routes are defined before the /docs endpoint is first requested.'
    );
    return;
  }

  walkStack(router.stack, '', registry, config);
}

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }

  return new Promise(function (resolve, reject) {
    let raw = '';
    req.on('data', function (chunk) { raw += chunk; });
    req.on('end', function () {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON request body.'));
      }
    });
    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * expressAdapter
 *
 * Creates an Express middleware that serves the documentation UI at
 * `config.docsPath`. Routes are introspected immediately at registration time
 * so handlers are wrapped before any real traffic arrives. The registry is
 * also refreshed on every /docs request when liveReload is enabled, picking
 * up any routes added after startup.
 *
 * Mount this middleware **after** your routes.
 *
 * @param {object} app
 * @param {UserConfig} [userConfig]
 * @returns {import('express').RequestHandler}
 */
function expressAdapter(app, userConfig = {}) {
  const config = normalizeConfig(userConfig);
  const registry = new RouteRegistry();

  if (!config.enabled) {
    return function docMiddlewareDisabled(_req, _res, next) { next(); };
  }

  // Wrap handlers immediately so traffic arriving before /docs is visited
  // is still captured. setImmediate defers to the next tick so that all
  // app.use()/app.get()/… calls in the same synchronous block complete first.
  setImmediate(() => introspectExpressApp(app, registry, config));

  return function docMiddleware(req, res, next) {
    if (req.path === config.docsPath + '/__flows/run' || req.url === config.docsPath + '/__flows/run') {
      if (req.method !== 'POST') return next();

      readJsonBody(req)
        .then(runFlowPayload)
        .then(function (result) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.statusCode = result.ok ? 200 : 422;
          res.end(JSON.stringify(result));
        })
        .catch(function (error) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: error.message || String(error) }));
        });
      return;
    }

    if (req.path !== config.docsPath && req.url !== config.docsPath) {
      return next();
    }

    if (config.liveReload) {
      introspectExpressApp(app, registry, config);
    }

    const html = serveDocsUI(registry.getAll(), config, { flows: getUiFlows(config) });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 200;
    res.end(html);
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * defineRoute
 *
 * Decorates an Express route handler with pre-defined request/response schemas
 * so that the documentation UI is populated immediately — without waiting for
 * real HTTP traffic to flow through the route.
 *
 * Build schema values with the `s` helper exported from `doctreen`.
 *
 * In TypeScript, pass the request body, query, and response types as generics
 * to get compile-time type checking on the handler's `req` and `res`.
 *
 * @template TBody
 * @template TQuery
 * @template TResponse
 *
 * @param {import('express').RequestHandler} handler
 * @param {{ request?: { body?: import('../index').SchemaNode|null, query?: import('../index').SchemaNode|null }|null, response?: import('../index').SchemaNode|null }} [schemas]
 * @returns {import('express').RequestHandler}
 *
 * @example
 * import { defineRoute } from 'doctreen/express';
 * import { s } from 'doctreen';
 *
 * app.post('/users', defineRoute<CreateUserBody, never, UserResponse>(
 *   (req, res) => { ... },
 *   {
 *     request: { body: s.object({ name: s.string(), email: s.string() }), query: null },
 *     response: s.object({ id: s.number(), name: s.string() }),
 *   }
 * ));
 */
function defineRoute(handler, schemas) {
  handler.__docLibSchema = schemas || {};
  return handler;
}

module.exports = { expressAdapter, defineRoute, defineSchema, s };
