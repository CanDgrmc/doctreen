'use strict';

// ─── Imports ──────────────────────────────────────────────────────────────────

const { RouteRegistry, normalizeConfig, shouldExclude, s, defineSchema } = require('../index');
const { serveDocsUI } = require('../ui/index');
const { convertSchema, normalizeRouteSchemas } = require('../internal/schemas');
const { validateRequest, validateResponse, buildErrorBody, shouldValidate, shouldWriteback, applyWriteback, reportResponseIssues } = require('../internal/validate');
const { createDriftPipeline, authorizeReset } = require('../internal/drift');
const { buildOpenApiDocument } = require('../exporters/openapi');

/** Duck-type check for "this is a Zod schema instance". */
function isZodInstance(v) {
  return v != null && typeof v === 'object' && v._def && v._def.typeName;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Metadata key used by @DocRoute and the smaller decorator family.
// Matches what NestJS itself uses for its own keys (plain strings) so that
// reflect-metadata (already required by NestJS) is the only polyfill needed.
const DOC_ROUTE_METADATA = 'doctreen:route';

// NestJS RequestMethod enum — mirrored here to avoid importing @nestjs/common.
const REQUEST_METHOD_MAP = {
  0: 'GET',
  1: 'POST',
  2: 'PUT',
  3: 'DELETE',
  4: 'PATCH',
  5: 'ALL',
  6: 'OPTIONS',
  7: 'HEAD',
  8: 'SEARCH',
};

// Methods that carry no body and are not worth documenting in the UI.
const SKIP_METHODS = new Set([5, 6, 7]); // ALL, OPTIONS, HEAD

// ─── Path helpers ─────────────────────────────────────────────────────────────

function normalizeSegment(p) {
  if (!p || p === '/') return '';
  return p.startsWith('/') ? p : '/' + p;
}

function joinPaths() {
  const parts = Array.prototype.slice.call(arguments);
  const joined = parts
    .filter(Boolean)
    .map(normalizeSegment)
    .join('')
    .replace(/\/+/g, '/');
  return joined || '/';
}

function extractParamsFromPath(path) {
  const params = [];
  const re = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m;
  while ((m = re.exec(path)) !== null) params.push(m[1]);
  return params;
}

// ─── Route seeding ────────────────────────────────────────────────────────────

/**
 * Applies a DocRoute schema bag to a mutable RouteEntry.
 *
 * @param {import('../index').RouteEntry} entry
 * @param {NestRouteSchemas} docSchema
 */
function seedEntryFromSchema(entry, docSchema) {
  if (!docSchema) return;

  if (docSchema.description) entry.description = docSchema.description;
  if (docSchema.headers) entry.requestHeaders = docSchema.headers;

  if (docSchema.request) {
    entry.requestSchema = {
      body:   convertSchema(docSchema.request.body)   || null,
      query:  convertSchema(docSchema.request.query)  || null,
      params: convertSchema(docSchema.request.params) || null,
    };
    entry.requestSchemaDeclared = true;
    // Preserve original Zod schemas (when present) for v1.6+ runtime validation.
    const validatorBody   = isZodInstance(docSchema.request.body)   ? docSchema.request.body   : null;
    const validatorQuery  = isZodInstance(docSchema.request.query)  ? docSchema.request.query  : null;
    const validatorParams = isZodInstance(docSchema.request.params) ? docSchema.request.params : null;
    if (validatorBody || validatorQuery || validatorParams) {
      entry.requestValidators = { body: validatorBody, query: validatorQuery, params: validatorParams };
    }
  }

  if (docSchema.response != null) {
    entry.responseSchema = convertSchema(docSchema.response);
  }

  if (docSchema.errors) {
    entry.errors = Object.keys(docSchema.errors).map(function (statusStr) {
      const val = docSchema.errors[statusStr];
      return {
        status: parseInt(statusStr, 10),
        description: typeof val === 'string' ? val : (val && val.description) || null,
        schema: typeof val === 'object' && val && val.schema ? convertSchema(val.schema) : null,
      };
    });
  }

  if (docSchema.validate !== undefined) {
    entry.validateOverride = docSchema.validate;
  }

  if (docSchema.hidden === true) {
    entry.hidden = true;
  }

  if (docSchema.security !== undefined) {
    entry.security = docSchema.security;
  }

  if (Array.isArray(docSchema.tags) && docSchema.tags.length > 0) {
    entry.tags = docSchema.tags.slice();
  }

  if (docSchema.callbacks && typeof docSchema.callbacks === 'object') {
    const { normaliseCallbacksBag } = require('../internal/schemas');
    entry.callbacks = normaliseCallbacksBag(docSchema.callbacks);
  }

  if (docSchema.examples && typeof docSchema.examples === 'object') {
    entry.examples = docSchema.examples;
  }
}

// ─── Route discovery ──────────────────────────────────────────────────────────

/**
 * Walks the NestJS internal container to build a RouteRegistry.
 *
 * Discovery strategy:
 *  1. Read the global prefix via `app.getGlobalPrefix()` (NestJS ≥ 7).
 *  2. Iterate `app.container.getModules()` — each Module holds a `controllers` Map.
 *  3. For each controller metatype, read `@Controller` path metadata.
 *  4. Scan prototype methods; read `@Get` / `@Post` etc. path + method metadata.
 *  5. Read `@DocRoute` (or individual decorator) metadata from the method.
 *  6. Register the route and apply the doc schema.
 *
 * @param {any} app  - INestApplication instance
 * @param {import('../index').NormalizedConfig} config
 * @returns {import('../index').RouteRegistry}
 */
function discoverRoutes(app, config) {
  const registry = new RouteRegistry();

  let container;
  try {
    container = app.container;
  } catch (_) {
    return registry;
  }

  if (!container || typeof container.getModules !== 'function') {
    return registry;
  }

  const globalPrefix = normalizeSegment(
    typeof app.getGlobalPrefix === 'function' ? app.getGlobalPrefix() : ''
  );

  const modules = Array.from(container.getModules().values());

  for (let mi = 0; mi < modules.length; mi++) {
    const nestModule = modules[mi];
    const controllers = nestModule.controllers;
    if (!controllers || typeof controllers.forEach !== 'function') continue;

    controllers.forEach(function (wrapper) {
      const metatype = wrapper.metatype;
      if (!metatype || !metatype.prototype) return;

      // Controller-level path prefix — @Controller('users') or @Controller()
      const rawCtrlPath = Reflect.getMetadata('path', metatype);
      const ctrlPaths = Array.isArray(rawCtrlPath)
        ? rawCtrlPath
        : [rawCtrlPath != null ? rawCtrlPath : ''];

      const prototype = metatype.prototype;
      const methodNames = Object.getOwnPropertyNames(prototype);

      for (let i = 0; i < methodNames.length; i++) {
        const methodName = methodNames[i];
        if (methodName === 'constructor') continue;

        const handler = prototype[methodName];
        if (typeof handler !== 'function') continue;

        // NestJS sets these via @Get(), @Post(), etc.
        const rawRoutePath = Reflect.getMetadata('path', handler);
        const routeMethod = Reflect.getMetadata('method', handler);

        if (rawRoutePath === undefined || routeMethod === undefined) continue;
        if (SKIP_METHODS.has(routeMethod)) continue;

        const httpMethod = REQUEST_METHOD_MAP[routeMethod];
        if (!httpMethod) continue;

        const routePaths = Array.isArray(rawRoutePath) ? rawRoutePath : [rawRoutePath || ''];
        const docSchema = Reflect.getMetadata(DOC_ROUTE_METADATA, handler);

        for (let ci = 0; ci < ctrlPaths.length; ci++) {
          for (let ri = 0; ri < routePaths.length; ri++) {
            const fullPath = joinPaths(globalPrefix, ctrlPaths[ci], routePaths[ri]);

            if (shouldExclude(fullPath, config.exclude)) continue;

            const entry = registry.add({
              method: httpMethod,
              path: fullPath,
              params: extractParamsFromPath(fullPath),
            });

            seedEntryFromSchema(entry, docSchema);
          }
        }
      }
    });
  }

  return registry;
}

// ─── Decorators ───────────────────────────────────────────────────────────────

/**
 * Method decorator — attach a full documentation schema to a NestJS controller method.
 *
 * @example
 * ```ts
 * @Post('import')
 * @DocRoute({
 *   description: 'Bulk import partner inventory',
 *   headers: { 'x-api-key': 'Partner API key' },
 *   request: { body: importSchema },
 *   response: importResponseSchema,
 *   errors: { 400: 'Validation failed', 401: 'Unauthorised' },
 * })
 * importProducts(@Body() body: ImportDto) { ... }
 * ```
 *
 * @param {NestRouteSchemas} schemas
 * @returns {MethodDecorator}
 */
function DocRoute(schemas) {
  return function (target, key, descriptor) {
    Reflect.defineMetadata(DOC_ROUTE_METADATA, schemas, descriptor.value);
    return descriptor;
  };
}

/**
 * Attach a description string to a controller method.
 * Merges with any existing `@DocRoute` metadata on the same method.
 *
 * @param {string} description
 * @returns {MethodDecorator}
 */
function DocDescription(description) {
  return function (target, key, descriptor) {
    const existing = Reflect.getMetadata(DOC_ROUTE_METADATA, descriptor.value) || {};
    Reflect.defineMetadata(
      DOC_ROUTE_METADATA,
      Object.assign({}, existing, { description: description }),
      descriptor.value
    );
    return descriptor;
  };
}

/**
 * Attach documented request headers.
 * Merges with any existing `@DocRoute` metadata on the same method.
 *
 * @param {Record<string,string>} headers
 * @returns {MethodDecorator}
 */
function DocHeaders(headers) {
  return function (target, key, descriptor) {
    const existing = Reflect.getMetadata(DOC_ROUTE_METADATA, descriptor.value) || {};
    Reflect.defineMetadata(
      DOC_ROUTE_METADATA,
      Object.assign({}, existing, { headers: headers }),
      descriptor.value
    );
    return descriptor;
  };
}

/**
 * Attach request body/query schemas.
 * Accepts SchemaNode objects (from `s` builder) or Zod schemas.
 * Merges with any existing `@DocRoute` metadata on the same method.
 *
 * @param {{ body?: any, query?: any }} request
 * @returns {MethodDecorator}
 */
function DocRequest(request) {
  return function (target, key, descriptor) {
    const existing = Reflect.getMetadata(DOC_ROUTE_METADATA, descriptor.value) || {};
    Reflect.defineMetadata(
      DOC_ROUTE_METADATA,
      Object.assign({}, existing, { request: request }),
      descriptor.value
    );
    return descriptor;
  };
}

/**
 * Attach a response schema.
 * Accepts a SchemaNode object or a Zod schema.
 * Merges with any existing `@DocRoute` metadata on the same method.
 *
 * @param {any} response
 * @returns {MethodDecorator}
 */
function DocResponse(response) {
  return function (target, key, descriptor) {
    const existing = Reflect.getMetadata(DOC_ROUTE_METADATA, descriptor.value) || {};
    Reflect.defineMetadata(
      DOC_ROUTE_METADATA,
      Object.assign({}, existing, { response: response }),
      descriptor.value
    );
    return descriptor;
  };
}

/**
 * Attach documented error responses.
 * Merges with any existing `@DocRoute` metadata on the same method.
 *
 * @param {Record<number, string|{ description?: string, schema?: any }>} errors
 * @returns {MethodDecorator}
 */
function DocErrors(errors) {
  return function (target, key, descriptor) {
    const existing = Reflect.getMetadata(DOC_ROUTE_METADATA, descriptor.value) || {};
    Reflect.defineMetadata(
      DOC_ROUTE_METADATA,
      Object.assign({}, existing, { errors: errors }),
      descriptor.value
    );
    return descriptor;
  };
}

/**
 * Hide a controller method from the docs UI and the OpenAPI export while
 * leaving the route fully functional at runtime. Equivalent to
 * `@DocRoute({ hidden: true })`.
 *
 * Merges with any existing `@DocRoute` metadata on the same method.
 *
 * @returns {MethodDecorator}
 */
function DocHidden() {
  return function (target, key, descriptor) {
    const existing = Reflect.getMetadata(DOC_ROUTE_METADATA, descriptor.value) || {};
    Reflect.defineMetadata(
      DOC_ROUTE_METADATA,
      Object.assign({}, existing, { hidden: true }),
      descriptor.value
    );
    return descriptor;
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Sets up doctreen documentation for a NestJS application.
 *
 * Call this **after** `NestFactory.create()` and **before** `app.listen()`.
 * Works with both `@nestjs/platform-express` (default) and
 * `@nestjs/platform-fastify`.
 *
 * Route discovery reads NestJS internal metadata — no extra module imports,
 * no `DiscoveryModule`, no modifications to your AppModule required.
 *
 * Schema resolution order per route (first wins):
 *  1. `@DocRoute` / `@DocDescription` / `@DocRequest` / … decorators
 *  2. No further fallback (JSDoc and runtime inference are Express-only features)
 *
 * @example
 * ```ts
 * import { NestFactory } from '@nestjs/core';
 * import { nestAdapter } from 'doctreen/nest';
 * import { AppModule } from './app.module';
 *
 * async function bootstrap() {
 *   const app = await NestFactory.create(AppModule);
 *   nestAdapter(app, { meta: { title: 'My API', version: '2.0.0' } });
 *   await app.listen(3000);
 * }
 * bootstrap();
 * ```
 *
 * @param {any} app - INestApplication instance returned by NestFactory.create()
 * @param {import('../index').UserConfig} [userConfig]
 */
function nestAdapter(app, userConfig) {
  const config = normalizeConfig(userConfig);
  if (!config.enabled) return;

  // Schema drift pipeline (v1.10+). See express adapter for details.
  config._drift = createDriftPipeline(config);

  /** @type {import('../index').RouteRegistry|null} */
  let cachedRegistry = null;

  function getRegistry() {
    if (cachedRegistry === null || config.liveReload) {
      cachedRegistry = discoverRoutes(app, config);
    }
    return cachedRegistry;
  }

  const httpAdapter = app.getHttpAdapter();
  const adapterName = (httpAdapter.constructor && httpAdapter.constructor.name) || '';
  const isFastify = adapterName.toLowerCase().includes('fastify');

  if (isFastify) {
    httpAdapter.get(config.docsPath, function (req, reply) {
      const html = serveDocsUI(getRegistry().getVisible(), config);
      reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
    });
    httpAdapter.get(config.docsPath + '/openapi.json', function (req, reply) {
      const doc = buildOpenApiDocument(getRegistry().getVisible(), config);
      reply.header('Content-Type', 'application/json; charset=utf-8').send(doc);
    });
    httpAdapter.get(config.docsPath + '/drift.json', async function (req, reply) {
      const report = config._drift.enabled
        ? await Promise.resolve(config._drift.report())
        : { generatedAt: Date.now(), totalIssues: 0, routes: [] };
      reply.header('Content-Type', 'application/json; charset=utf-8').send(report);
    });
    httpAdapter.post(config.docsPath + '/drift/reset', async function (req, reply) {
      const auth = authorizeReset(config._drift, req.headers || {}, req.query || {});
      if (!auth.ok) {
        reply.code(auth.status).header('Content-Type', 'application/json; charset=utf-8').send({ ok: false, error: auth.error });
        return;
      }
      await Promise.resolve(config._drift.reset());
      reply.code(200).header('Content-Type', 'application/json; charset=utf-8').send({ ok: true, clearedAt: Date.now() });
    });
  } else {
    // Express (default platform) and any other adapter that uses Node's
    // IncomingMessage / ServerResponse signature.
    httpAdapter.get(config.docsPath, function (req, res) {
      const html = serveDocsUI(getRegistry().getVisible(), config);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
    httpAdapter.get(config.docsPath + '/openapi.json', function (req, res) {
      const doc = buildOpenApiDocument(getRegistry().getVisible(), config);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(JSON.stringify(doc, null, 2));
    });
    httpAdapter.get(config.docsPath + '/drift.json', async function (req, res) {
      const report = config._drift.enabled
        ? await Promise.resolve(config._drift.report())
        : { generatedAt: Date.now(), totalIssues: 0, routes: [] };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(JSON.stringify(report, null, 2));
    });
    httpAdapter.post(config.docsPath + '/drift/reset', async function (req, res) {
      // Nest/Express path uses the underlying http adapter — body parser is
      // already mounted globally if NestJS body-parsing is on; we only need
      // headers + query for auth, the request body is irrelevant.
      const auth = authorizeReset(config._drift, req.headers || {}, req.query || {});
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (!auth.ok) {
        res.statusCode = auth.status;
        res.send(JSON.stringify({ ok: false, error: auth.error }));
        return;
      }
      await Promise.resolve(config._drift.reset());
      res.statusCode = 200;
      res.send(JSON.stringify({ ok: true, clearedAt: Date.now() }));
    });
  }

  // ── Schema drift detection (v1.10+) ─────────────────────────────────────
  // Register a global interceptor that runs alongside the validation guard.
  // Uses a NestJS guard signature so we don't need an interceptor-specific
  // import. Returns true unconditionally — purely observational.
  if (config._drift.enabled && typeof app.useGlobalGuards === 'function') {
    const driftGuard = {
      canActivate(context) {
        try {
          const req = context.switchToHttp().getRequest();
          const handler = context.getHandler();
          const docSchema = handler ? Reflect.getMetadata(DOC_ROUTE_METADATA, handler) : null;
          if (!docSchema || !docSchema.request) return true;

          const declaredBody  = convertSchema(docSchema.request.body)  || null;
          const declaredQuery = convertSchema(docSchema.request.query) || null;
          if (!declaredBody && !declaredQuery) return true;

          // NestJS path includes the controller prefix; req.route?.path is the
          // declared pattern, falling back to url for safety.
          const route = {
            method: String(req.method || '').toUpperCase(),
            path: (req.route && req.route.path) || req.url || '',
          };
          if (declaredBody && req.body && typeof req.body === 'object') {
            config._drift.recordIfDrift(route, 'body', declaredBody, req.body);
          }
          if (declaredQuery && req.query && typeof req.query === 'object') {
            config._drift.recordIfDrift(route, 'query', declaredQuery, req.query);
          }
        } catch (_) { /* swallow — drift must never break the request */ }
        return true;
      },
    };
    app.useGlobalGuards(driftGuard);
  }

  // ── Runtime validation gate (v1.6+) ─────────────────────────────────────
  // Register a global guard. NestJS guards run after body-parser middleware
  // (whether the underlying platform is Express or Fastify) but before pipes
  // and the controller, so `req.body` is reliably parsed by the time we read
  // it. Going via the guard system also means our 422 response is shaped by
  // NestJS's HttpException pipeline (compatible with global filters).
  if (config.validate.enabled && typeof app.useGlobalGuards === 'function') {
    let HttpException = null;
    try { HttpException = require('@nestjs/common').HttpException; } catch (_) { /* no-op */ }

    const guard = {
      async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const handler = context.getHandler();
        const docSchema = handler ? Reflect.getMetadata(DOC_ROUTE_METADATA, handler) : null;
        if (!docSchema || !docSchema.request) return true;

        const validators = {
          body:   isZodInstance(docSchema.request.body)   ? docSchema.request.body   : null,
          query:  isZodInstance(docSchema.request.query)  ? docSchema.request.query  : null,
          params: isZodInstance(docSchema.request.params) ? docSchema.request.params : null,
        };
        if (!validators.body && !validators.query && !validators.params) return true;

        const perRoute = docSchema.validate;
        if (!shouldValidate(config.validate, perRoute)) return true;

        const result = await validateRequest(validators, { body: req.body, query: req.query, params: req.params });
        if (result.ok) {
          // v1.15 write-back — opt-in via `validate: { writeback: true }`.
          if (shouldWriteback(config.validate)) applyWriteback(req, result.data);
          return true;
        }

        const body = buildErrorBody(result.issues);
        if (HttpException) throw new HttpException(body, 422);
        // Fallback: write directly to the response when @nestjs/common is not
        // present (e.g. installed at runtime via an unusual path).
        const res = context.switchToHttp().getResponse();
        res.statusCode = 422;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
        return false;
      },
    };
    app.useGlobalGuards(guard);
  }

  // ── Response assertion (v1.15 dev-mode) ───────────────────────────────────
  // Guards can't see the response, so a global interceptor maps over the
  // handler's return value and asserts it against the declared Zod response
  // schema. 'warn' logs; 'throw' errors the stream → NestJS 500 in dev.
  if (config.validate.response !== 'off' && typeof app.useGlobalInterceptors === 'function') {
    let mapOp = null;
    try { mapOp = require('rxjs/operators').map; } catch (_) { /* no-op */ }
    if (!mapOp) { try { mapOp = require('rxjs').map; } catch (_) { /* no-op */ } }

    if (mapOp) {
      const rMode = config.validate.response;
      const interceptor = {
        intercept(context, next) {
          const handler = context.getHandler();
          const docSchema = handler ? Reflect.getMetadata(DOC_ROUTE_METADATA, handler) : null;
          const schema = docSchema && isZodInstance(docSchema.response) ? docSchema.response : null;
          if (!schema) return next.handle();
          const req = context.switchToHttp().getRequest();
          const label = ((req && req.method) || 'GET') + ' ' +
            ((req && ((req.route && req.route.path) || req.url)) || '');
          return next.handle().pipe(mapOp(function (data) {
            const rv = validateResponse(schema, data);
            if (!rv.ok) reportResponseIssues(rMode, label, rv.issues);
            return data;
          }));
        },
      };
      app.useGlobalInterceptors(interceptor);
    }
  }
}

// ─── defineRoute (compatibility shim) ────────────────────────────────────────

/**
 * Attaches a schema bag to a plain handler function via `__docLibSchema`.
 *
 * In NestJS, prefer `@DocRoute` instead — this shim exists so that code shared
 * with other doctreen adapters can be reused unchanged.
 *
 * @param {Function} handler
 * @param {any} [schemas]
 * @returns {Function}
 */
function defineRoute(handler, schemas) {
  if (handler) handler.__docLibSchema = normalizeRouteSchemas(schemas) || {};
  return handler;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  nestAdapter,
  DocRoute,
  DocDescription,
  DocHeaders,
  DocRequest,
  DocResponse,
  DocErrors,
  DocHidden,
  defineRoute,
  defineSchema,
  s,
};
