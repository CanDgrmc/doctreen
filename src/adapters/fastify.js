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
 * jsonSchemaToSchemaNode
 *
 * Converts a Fastify native JSON Schema object to the internal SchemaNode format
 * used by the documentation UI. Handles objects, arrays, and primitives.
 * Non-required properties are marked optional.
 *
 * @param {Record<string, any>} schema
 * @param {number} [depth]
 * @returns {import('../index').SchemaNode}
 */
function jsonSchemaToSchemaNode(schema, depth) {
  depth = depth || 0;
  if (depth > 5 || !schema || typeof schema !== 'object') return { type: 'unknown' };

  if (schema.type === 'object') {
    /** @type {Record<string, import('../index').SchemaNode>} */
    const properties = {};
    const props    = schema.properties || {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    Object.keys(props).forEach(function (key) {
      const node = jsonSchemaToSchemaNode(props[key], depth + 1);
      properties[key] = required.includes(key) ? node : Object.assign({}, node, { optional: true });
    });
    return { type: 'object', properties };
  }

  if (schema.type === 'array') {
    return {
      type: 'array',
      items: schema.items ? jsonSchemaToSchemaNode(schema.items, depth + 1) : { type: 'unknown' },
    };
  }

  if (typeof schema.type === 'string') return { type: schema.type };

  return { type: 'unknown' };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * seedEntryFromHandler
 *
 * Populates a RouteEntry from a handler function by checking, in order:
 *   1. defineRoute schemas (`handler.__docLibSchema`)
 *   2. Fastify native JSON Schema (`nativeSchema`)
 *   3. JSDoc block comment (`parseJSDoc`)
 *
 * @param {RouteEntry} entry
 * @param {Function}   handler
 * @param {Record<string, any>|null} nativeSchema - routeOptions.schema from Fastify
 */
function seedEntryFromHandler(entry, handler, nativeSchema) {
  // 1. defineRoute — highest priority
  if (handler && handler.__docLibSchema) {
    const predef = handler.__docLibSchema;
    if (entry.requestSchema  === null && predef.request   !== undefined) entry.requestSchema  = predef.request;
    if (entry.responseSchema === null && predef.response  !== undefined) entry.responseSchema = predef.response;
    if (entry.description    === null && predef.description)             entry.description    = predef.description;
    if (entry.requestHeaders === null && predef.headers)                 entry.requestHeaders = predef.headers;
    if (entry.errors         === null && predef.errors)                  entry.errors         = normalizeErrors(predef.errors);
  }

  // 2. Fastify native JSON Schema
  if (nativeSchema) {
    if (entry.description === null && nativeSchema.description) {
      entry.description = nativeSchema.description;
    }

    if (entry.requestSchema === null) {
      const body        = nativeSchema.body        || nativeSchema.Body;
      const querystring = nativeSchema.querystring || nativeSchema.Querystring;
      if (body || querystring) {
        entry.requestSchema = {
          body:  body        ? jsonSchemaToSchemaNode(body)        : null,
          query: querystring ? jsonSchemaToSchemaNode(querystring) : null,
        };
      }
    }

    if (entry.responseSchema === null && nativeSchema.response) {
      const resp = nativeSchema.response;
      // Prefer the first 2xx success schema
      const successSchema =
        resp[200]   || resp['200']   ||
        resp[201]   || resp['201']   ||
        resp[204]   || resp['204']   ||
        Object.values(resp).find(Boolean);
      if (successSchema) {
        entry.responseSchema = jsonSchemaToSchemaNode(successSchema);
      }
    }
  }

  // 3. JSDoc block comment — lowest priority
  if (handler && (entry.description === null || entry.requestSchema === null || entry.responseSchema === null)) {
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
 * fastifyAdapter
 *
 * Sets up route introspection and serves the documentation UI for a Fastify app.
 *
 * Uses Fastify's `onRoute` application hook to capture every route as it is
 * registered. Documentation schemas are populated immediately — no real HTTP
 * traffic is required (unlike the Express adapter's runtime inference path).
 *
 * Schema resolution order:
 *   1. `defineRoute` schemas — explicit, highest priority
 *   2. Fastify native JSON Schema (`schema` option on route)
 *   3. JSDoc block comment inside the handler function
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 * Call `fastifyAdapter` BEFORE registering your routes so the `onRoute` hook
 * is active when routes are added:
 *
 *   const fastify = require('fastify')();
 *   const { fastifyAdapter } = require('doctreen/fastify');
 *
 *   fastifyAdapter(fastify, { docsPath: '/api/docs', meta: { title: 'My API' } });
 *
 *   fastify.get('/users', handler);
 *   fastify.listen({ port: 3000 });
 *
 * @param {object}     fastify    - The Fastify instance
 * @param {UserConfig} [userConfig]
 */
function fastifyAdapter(fastify, userConfig) {
  const config   = normalizeConfig(userConfig || {});
  const registry = new RouteRegistry();

  if (!config.enabled) return;

  // Capture routes as they are registered
  fastify.addHook('onRoute', function (routeOptions) {
    // Fastify 4 uses routeOptions.url; Fastify 5 uses routeOptions.path
    const path = routeOptions.url || routeOptions.path || '';
    if (path === config.docsPath || path === config.docsPath + '/__flows/run') return;
    if (!path || shouldExclude(path, config.exclude)) return;

    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];

    for (const method of methods) {
      // Fastify auto-adds HEAD for every GET; skip internal methods
      if (method === 'HEAD' || method === 'OPTIONS') continue;

      const entry = registry.add({
        method,
        path,
        params: extractParamsFromPath(path),
      });

      seedEntryFromHandler(entry, routeOptions.handler, routeOptions.schema || null);
    }
  });

  // Serve the documentation UI
  fastify.get(config.docsPath, function serveDocs(_req, reply) {
    const html = serveDocsUI(registry.getAll(), config, { flows: getUiFlows(config) });
    reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  fastify.post(config.docsPath + '/__flows/run', async function runDocsFlow(req, reply) {
    try {
      const result = await runFlowPayload(req.body || {});
      reply.code(result.ok ? 200 : 422).header('Content-Type', 'application/json; charset=utf-8').send(result);
    } catch (error) {
      reply.code(400).header('Content-Type', 'application/json; charset=utf-8').send({ ok: false, error: error.message || String(error) });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * defineRoute
 *
 * Decorates a Fastify route handler with pre-defined request/response schemas
 * so that documentation is populated immediately — without JSDoc or waiting
 * for real traffic.
 *
 * Works identically to `defineRoute` from `doctreen/express`.
 *
 * @example
 * const { defineRoute, s } = require('doctreen/fastify');
 *
 * fastify.post('/users', {
 *   handler: defineRoute(
 *     async (req, reply) => {
 *       reply.status(201).send({ id: 1, ...req.body });
 *     },
 *     {
 *       request: { body: s.object({ name: s.string(), email: s.string() }), query: null },
 *       response: s.object({ id: s.number(), name: s.string() }),
 *       errors: {
 *         409: 'Email already in use',
 *         422: { description: 'Validation failed', schema: s.object({ message: s.string() }) },
 *       },
 *     }
 *   ),
 * });
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

module.exports = { fastifyAdapter, defineRoute, defineSchema, s };
