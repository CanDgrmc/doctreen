'use strict';

/**
 * `doctreen mock` — Express-based mock server.
 *
 * Wires a list of route descriptors (produced by `openapi-loader.js` or any
 * adapter that emits the same shape) into an Express app that returns
 * example payloads generated from the route schemas. CRUD short-circuits,
 * latency injection, and random error responses sit on top.
 *
 * Design constraints:
 *   - Express is a peer dependency of the host app; if it's not installed
 *     the mock server fails loudly at `createMockApp()` time rather than at
 *     first request.
 *   - All response shapes are deterministic given the same options + faker
 *     seed. Use this for fixtures, contract tests, frontend dev, etc.
 *   - The mock server does *not* validate request bodies. That belongs in
 *     the real server — drift detection on the real server catches the gap.
 */

const { generateExample } = require('../internal/example');
const { CrudStore, resourceFromPath } = require('./state');

/**
 * @typedef {object} MockOptions
 * @property {object[]} routes              - route descriptors (see openapi-loader)
 * @property {object}   [components]        - OpenAPI `components.schemas` map for $ref resolution
 * @property {object}   [info]              - OpenAPI `info` block (used by `/__mock`)
 * @property {boolean}  [crud=true]         - enable in-memory CRUD for matching routes
 * @property {boolean}  [faker]             - force faker on/off (default: auto-detect)
 * @property {number}   [seed]              - faker seed for deterministic output
 * @property {number|[number,number]} [latency=0] - artificial latency in ms (number) or [min,max] range
 * @property {number}   [errorRate=0]       - probability (0..1) of returning a declared error response
 * @property {string}   [persistPath]       - JSON file used to persist CRUD state across restarts
 * @property {boolean}  [logRequests=true]  - log every request to stdout
 */

function createMockApp(options) {
  let express;
  try {
    // eslint-disable-next-line global-require
    express = require('express');
  } catch (e) {
    throw new Error(
      'express is required to run the mock server. Install it: `npm i express`'
    );
  }

  const opts = Object.assign({
    crud: true,
    faker: undefined,
    seed: undefined,
    latency: 0,
    errorRate: 0,
    persistPath: null,
    logRequests: true,
  }, options || {});

  const routes = opts.routes || [];
  const components = opts.components || {};
  const info = opts.info || { title: 'Mock API', version: '0.0.0' };
  const store = new CrudStore({ persistPath: opts.persistPath });

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (opts.logRequests) {
    app.use(function (req, res, next) {
      const started = Date.now();
      res.on('finish', function () {
        process.stdout.write(
          '[doctreen mock] ' + req.method + ' ' + req.originalUrl +
          ' → ' + res.statusCode + ' (' + (Date.now() - started) + 'ms)\n'
        );
      });
      next();
    });
  }

  // Index + spec routes — handy for tooling.
  app.get('/__mock', function (req, res) {
    res.json({
      mock: true,
      info: info,
      routes: routes.map(function (r) {
        return { method: r.method, path: r.path, openapiPath: r.openapiPath, operationId: r.operationId };
      }),
    });
  });

  // Seed CRUD fixtures with one example row per resource so list endpoints
  // never return an empty array on first hit.
  if (opts.crud) seedFromRoutes(routes, components, store, opts);

  // Mount each route from the descriptor list.
  for (const route of routes) {
    const handler = makeHandler(route, { components, store, opts });
    mountRoute(app, route, handler);
  }

  // 404 with a JSON-ish body — easier to spot during dev than the HTML default.
  app.use(function (req, res) {
    res.status(404).json({
      error: 'route_not_found',
      message: 'No mock route matches ' + req.method + ' ' + req.originalUrl,
    });
  });

  app.locals.mockMeta = { info: info, routeCount: routes.length };
  return app;
}

function mountRoute(app, route, handler) {
  const method = route.method.toLowerCase();
  if (typeof app[method] !== 'function') return;
  app[method](route.path, handler);
}

function seedFromRoutes(routes, components, store, opts) {
  const seeded = new Set();
  for (const route of routes) {
    if (route.method !== 'GET') continue;
    const resource = resourceFromPath(route.path);
    if (!resource || seeded.has(resource)) continue;
    // Skip when persistence already restored items for this resource.
    if (store.list(resource).length > 0) { seeded.add(resource); continue; }
    // Only seed list-style routes (no `:param` after the resource segment).
    if (/:/.test(route.path.split('/' + resource)[1] || '')) continue;
    const successCode = route.successStatus || '200';
    const successResp = (route.responses && route.responses[successCode]) || null;
    if (!successResp || !successResp.schema) continue;
    const example = generateOne(successResp.schema, components, opts);
    const list = extractListFromExample(example, resource);
    if (list && list.length > 0) {
      store.seed(resource, list);
      seeded.add(resource);
    }
  }
}

/**
 * Pull the actual list out of a generated response example. Accepts either
 * a bare array or a single-level envelope (`{ <resource>: [...] }`,
 * `{ data: [...] }`, `{ items: [...] }`, `{ results: [...] }`).
 */
function extractListFromExample(example, resource) {
  if (Array.isArray(example)) return example;
  if (!example || typeof example !== 'object') return null;
  const candidates = [resource, resource + 's', 'data', 'items', 'results'];
  for (const key of candidates) {
    if (Array.isArray(example[key])) return example[key];
  }
  // Fall back: first array-valued property.
  for (const key of Object.keys(example)) {
    if (Array.isArray(example[key])) return example[key];
  }
  return null;
}

/**
 * Inspect a response schema and figure out whether the list lives at the root
 * (`{ type: 'array' }`) or inside an envelope. Returns the property name to
 * place items under, or `null` for a bare-array response.
 */
function findEnvelopeKey(schema) {
  if (!schema) return undefined;
  if (schema.type === 'array' || Array.isArray(schema.items)) return null;
  if (schema.type === 'object' && schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const prop = schema.properties[key];
      if (prop && (prop.type === 'array' || prop.items)) return key;
    }
  }
  return undefined;
}

function makeHandler(route, ctx) {
  return async function (req, res) {
    // 1. Latency.
    const wait = pickLatency(ctx.opts.latency);
    if (wait > 0) await delay(wait);

    // 2. Random error injection.
    if (ctx.opts.errorRate > 0 && Math.random() < ctx.opts.errorRate) {
      const err = pickErrorResponse(route);
      if (err) {
        const body = generateResponseBody(err.entry, ctx.components, ctx.opts);
        res.status(parseInt(err.code, 10) || 500).json(body);
        return;
      }
    }

    // 3. CRUD short-circuit when enabled.
    if (ctx.opts.crud) {
      const crudReply = handleCrud(route, req, ctx);
      if (crudReply !== null) {
        res.status(crudReply.status).json(crudReply.body);
        return;
      }
    }

    // 4. Fallback: synthesise a body from the success response schema.
    const successCode = route.successStatus || (route.method === 'POST' ? '201' : '200');
    const successResp = (route.responses && route.responses[successCode]) || null;
    if (!successResp) {
      // No declared success — return 204 No Content.
      res.status(204).end();
      return;
    }
    const body = generateResponseBody(successResp, ctx.components, ctx.opts);
    if (body === null || body === undefined) {
      res.status(parseInt(successCode, 10) || 200).end();
    } else {
      res.status(parseInt(successCode, 10) || 200).json(body);
    }
  };
}

function handleCrud(route, req, ctx) {
  const resource = resourceFromPath(route.path);
  if (!resource) return null;

  // Determine whether this route is an item route (`/users/:id`) or a
  // collection route (`/users`). Item routes have a single `:param` segment
  // directly after the resource. Anything else (e.g. `/auth/login`,
  // `/users/:id/posts`) is RPC-shaped — fall through to schema examples.
  const segments = route.path.split('/').filter(Boolean);
  const resIdx = segments.findIndex(function (s) { return s.toLowerCase() === resource; });
  const trailing = resIdx >= 0 ? segments.slice(resIdx + 1) : [];
  const isCollectionRoot = trailing.length === 0;
  const isItemRoot = trailing.length === 1 && trailing[0].startsWith(':');
  if (!isCollectionRoot && !isItemRoot) return null;
  const itemRoute = isItemRoot;
  const idParam = itemRoute ? trailing[0].slice(1) : null;
  const id = idParam ? req.params[idParam] : null;

  const method = route.method;

  const successCode = route.successStatus || (route.method === 'POST' ? '201' : '200');
  const successResp = (route.responses && route.responses[successCode]) || null;
  const successSchema = successResp && successResp.schema;

  if (method === 'GET' && !itemRoute) {
    const items = ctx.store.list(resource);
    const envelopeKey = findEnvelopeKey(successSchema);
    if (envelopeKey) {
      const body = generateResponseBody(successResp, ctx.components, ctx.opts) || {};
      body[envelopeKey] = items;
      if ('total' in body) body.total = items.length;
      if ('count' in body) body.count = items.length;
      return { status: 200, body: body };
    }
    return { status: 200, body: items };
  }
  if (method === 'GET' && itemRoute) {
    const item = ctx.store.get(resource, id);
    if (!item) return { status: 404, body: notFound(resource, id) };
    const envelopeKey = findEnvelopeKey(successSchema);
    if (envelopeKey) {
      const body = generateResponseBody(successResp, ctx.components, ctx.opts) || {};
      body[envelopeKey] = item;
      return { status: 200, body: body };
    }
    return { status: 200, body: item };
  }
  if (method === 'POST' && !itemRoute) {
    const created = ctx.store.create(resource, req.body);
    return { status: 201, body: maybeWrapItem(created, successSchema, successResp, ctx) };
  }
  if (method === 'PUT' && itemRoute) {
    const replaced = ctx.store.replace(resource, id, req.body);
    return { status: 200, body: maybeWrapItem(replaced, successSchema, successResp, ctx) };
  }
  if (method === 'PATCH' && itemRoute) {
    const updated = ctx.store.update(resource, id, req.body);
    if (!updated) return { status: 404, body: notFound(resource, id) };
    return { status: 200, body: maybeWrapItem(updated, successSchema, successResp, ctx) };
  }
  if (method === 'DELETE' && itemRoute) {
    const removed = ctx.store.delete(resource, id);
    if (!removed) return { status: 404, body: notFound(resource, id) };
    return { status: 204, body: '' };
  }
  return null;
}

function maybeWrapItem(item, successSchema, successResp, ctx) {
  const envelopeKey = findEnvelopeKey(successSchema);
  if (!envelopeKey) return item;
  // Envelope wraps an array — return the array containing the single item.
  // Otherwise, place the item under the key directly.
  const body = generateResponseBody(successResp, ctx.components, ctx.opts) || {};
  const prop = successSchema && successSchema.properties && successSchema.properties[envelopeKey];
  if (prop && prop.type === 'array') body[envelopeKey] = [item];
  else body[envelopeKey] = item;
  return body;
}

function notFound(resource, id) {
  return {
    error: 'not_found',
    message: resource + '/' + id + ' does not exist',
  };
}

function generateOne(schema, components, opts) {
  return generateExample(schema, {
    faker: opts.faker,
    seed: opts.seed,
    components: components,
  });
}

function generateResponseBody(responseEntry, components, opts) {
  if (responseEntry.example !== undefined) return responseEntry.example;
  if (responseEntry.examples) {
    const keys = Object.keys(responseEntry.examples);
    if (keys.length > 0) {
      const first = responseEntry.examples[keys[0]];
      if (first && 'value' in first) return first.value;
      return first;
    }
  }
  if (!responseEntry.schema) return null;
  return generateOne(responseEntry.schema, components, opts);
}

function pickErrorResponse(route) {
  if (!route.responses) return null;
  const codes = Object.keys(route.responses).filter(function (c) {
    return /^[45]\d\d$/.test(c);
  });
  if (codes.length === 0) return null;
  const code = codes[Math.floor(Math.random() * codes.length)];
  return { code: code, entry: route.responses[code] };
}

function pickLatency(latency) {
  if (!latency) return 0;
  if (typeof latency === 'number') return latency;
  if (Array.isArray(latency) && latency.length === 2) {
    const [min, max] = latency;
    return Math.floor(min + Math.random() * (max - min));
  }
  return 0;
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

module.exports = {
  createMockApp,
};
