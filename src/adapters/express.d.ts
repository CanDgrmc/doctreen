import type { RequestHandler, Request, Response, NextFunction } from 'express';
import type { UserConfig, SchemaNode, s } from '../index';
import type { SchemaInput } from './zod';

/**
 * Creates an Express middleware that intercepts requests to `config.docsPath`,
 * lazily introspects the application's registered routes, and serves a
 * generated HTML documentation UI.
 *
 * Mount this middleware **after** your routes so that all routes are visible
 * when the docs endpoint is first requested. Use `liveReload: true` during
 * development if you need re-introspection on every request.
 *
 * @param app       The Express application instance (`app` returned by `express()`).
 * @param userConfig Optional configuration object.
 * @returns An Express `RequestHandler` middleware function.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { expressAdapter } from 'doctreen/express';
 *
 * const app = express();
 *
 * app.get('/users', handler);
 * app.post('/users', handler);
 *
 * // Mount AFTER routes
 * app.use(expressAdapter(app, {
 *   docsPath: '/api/docs',
 *   meta: { title: 'My API', version: '1.0.0' },
 *   exclude: ['/health', /^\/internal\//],
 *   liveReload: true,
 * }));
 * ```
 */
export declare function expressAdapter(
  app: ExpressLike,
  userConfig?: UserConfig
): RequestHandler;

/**
 * Schema definitions passed to `defineRoute`.
 */
export interface RouteSchemas {
  /** Human-readable description of what this route does. Shown in the docs UI below the route path. */
  description?: string;
  /**
   * Expected request headers, keyed by header name.
   * Value is a short description or example shown in the docs.
   * @example { Authorization: 'Bearer <token>', 'Content-Type': 'application/json' }
   */
  headers?: Record<string, string>;
  /**
   * Request body and query parameter schemas.
   * Accepts a SchemaNode (from the `s` builder) or a Zod schema — both work
   * interchangeably. Zod schemas are converted to SchemaNode automatically.
   */
  request?: { body?: SchemaInput | null; query?: SchemaInput | null } | null;
  /** Response payload schema. Accepts SchemaNode or Zod schema. */
  response?: SchemaInput | null;
  /**
   * Documented error responses keyed by HTTP status code.
   * Values can be a plain description string or an object with an optional
   * description and/or response body schema (SchemaNode or Zod schema).
   *
   * @example
   * errors: {
   *   404: 'User not found',
   *   422: { description: 'Validation failed', schema: s.object({ message: s.string() }) },
   *   409: { description: 'Conflict', schema: z.object({ message: z.string() }) },
   * }
   */
  errors?: Record<number, string | { description?: string | null; schema?: SchemaInput | null }>;
  /**
   * Per-route override for runtime validation (v1.6+). Set `true` to force
   * validation on for this route when the adapter default is off, or `false`
   * to skip validation when the adapter default is on. Omit to inherit the
   * adapter setting.
   */
  validate?: boolean;
  /**
   * Hide this route from the docs UI and the OpenAPI export (v1.8+). The
   * route remains fully functional at runtime — only the documentation
   * surface is affected. Useful for internal / admin / experimental
   * endpoints that should not be discoverable.
   */
  hidden?: boolean;
}

/**
 * Decorates an Express route handler with pre-defined request/response schemas
 * so that documentation is available immediately — without waiting for real
 * HTTP traffic to flow through the route.
 *
 * Pass `TBody`, `TQuery`, and `TResponse` generics to get compile-time type
 * checking on `req.body`, `req.query`, and `res.json()` inside the handler.
 *
 * Build schema values with the `s` helper exported from `doctreen`.
 *
 * @example
 * ```ts
 * import { defineRoute } from 'doctreen/express';
 * import { s } from 'doctreen';
 *
 * app.post('/users', defineRoute<CreateUserBody, never, UserResponse>(
 *   (req, res) => {
 *     const { name, email } = req.body; // typed as CreateUserBody
 *     res.status(201).json({ id: 1, name, email }); // typed as UserResponse
 *   },
 *   {
 *     request: { body: s.object({ name: s.string(), email: s.string() }), query: null },
 *     response: s.object({ id: s.number(), name: s.string(), email: s.string() }),
 *   }
 * ));
 * ```
 */
export declare function defineRoute<
  TBody = any,
  TQuery = any,
  TResponse = any,
  TParams extends Record<string, string> = Record<string, string>
>(
  handler: (
    req: Request<TParams, TResponse, TBody, TQuery extends Record<string, any> ? TQuery : any>,
    res: Response<TResponse>,
    next: NextFunction
  ) => void,
  schemas?: RouteSchemas
): RequestHandler;

/** Re-exported from `doctreen` for convenience. */
export { s, defineSchema } from '../index';

/**
 * Minimal structural interface for the Express application object.
 * Matches both `express.Application` (Express 4) and the Express 5 shape.
 * Using a structural type avoids a hard dependency on `@types/express`.
 */
export interface ExpressLike {
  /** Express 4 internal router */
  _router?: { stack: unknown[] };
  /** Express 5 router property */
  router?: { stack: unknown[] };
  use(...args: unknown[]): this;
}
