import type { UserConfig, SchemaNode, s } from '../index';

// ─────────────────────────────────────────────────────────────────────────────
// Structural interfaces — no hard dependency on koa or @types/koa
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape of a Koa context object.
 * Matches `ctx` in `router.get('/path', async (ctx) => { ... })`.
 */
export interface KoaContextLike {
  /** Response content type. Set to `'text/html'` for HTML responses. */
  type: string;
  /** Response body. Koa serializes this automatically. */
  body: unknown;
}

/**
 * Minimal shape of a single Layer in `router.stack`.
 * Matches the Layer objects created by `@koa/router`.
 */
export interface KoaRouterLayerLike {
  /** HTTP methods for this layer (uppercase). May include 'HEAD' for GET routes. */
  methods: string[];
  /** Route path, e.g. `/users/:id`. */
  path: string;
  /** Middleware handler functions registered on this route. */
  stack: Function[];
  /** Path parameter names extracted by path-to-regexp. */
  paramNames?: Array<{ name: string }>;
}

/**
 * Minimal structural interface for a @koa/router instance.
 * Using a structural type avoids a hard dependency on `@koa/router` or `@types/koa__router`.
 */
export interface KoaRouterLike {
  /**
   * Register a GET handler. Used internally by `koaAdapter` to add the docs route.
   */
  get(
    path: string,
    ...middleware: ((ctx: KoaContextLike, next: () => Promise<void>) => void | Promise<void>)[]
  ): this;
  /**
   * All registered route layers. @koa/router keeps this array up-to-date.
   * Read lazily on the first docs request.
   */
  stack?: KoaRouterLayerLike[];
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds a documentation UI route to a @koa/router instance.
 *
 * Routes are discovered lazily on the first request to `docsPath`: the adapter
 * reads `router.stack` (which @koa/router maintains) and builds a `RouteRegistry`.
 * Call `koaAdapter` before **or** after your routes — all routes registered
 * by the time the docs page is first hit will be shown.
 *
 * Schema resolution order (first wins per field):
 *   1. `defineRoute` schemas — explicit, highest priority
 *   2. JSDoc block comment inside the handler function
 *
 * @example
 * ```ts
 * import Koa from 'koa';
 * import Router from '@koa/router';
 * import { koaAdapter } from 'doctreen/koa';
 *
 * const app = new Koa();
 * const router = new Router();
 *
 * router.get('/users', (ctx) => { ctx.body = []; });
 *
 * koaAdapter(router, {
 *   docsPath: '/api/docs',
 *   meta: { title: 'My API', version: '1.0.0' },
 * });
 *
 * app.use(router.routes());
 * app.use(router.allowedMethods());
 * app.listen(3000);
 * ```
 */
export declare function koaAdapter(router: KoaRouterLike, userConfig?: UserConfig): void;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema definitions passed to `defineRoute`.
 */
export interface RouteSchemas {
  /** Human-readable description shown in the docs UI. */
  description?: string;
  /**
   * Expected request headers, keyed by header name.
   * @example { Authorization: 'Bearer <token>' }
   */
  headers?: Record<string, string>;
  /** Request body and query parameter schemas. */
  request?: { body?: SchemaNode | null; query?: SchemaNode | null } | null;
  /** Response payload schema. */
  response?: SchemaNode | null;
  /**
   * Documented error responses keyed by HTTP status code.
   * @example
   * errors: {
   *   404: 'Not found',
   *   422: { description: 'Validation failed', schema: s.object({ message: s.string() }) },
   * }
   */
  errors?: Record<number, string | { description?: string | null; schema?: SchemaNode | null }>;
}

/**
 * Decorates a Koa route handler with pre-defined documentation schemas.
 * Works identically to `defineRoute` from `doctreen/express`, `doctreen/fastify`,
 * and `doctreen/hono`.
 *
 * Uses a generic pass-through so the return type matches the input handler type,
 * preserving full Koa context type inference.
 *
 * @example
 * ```ts
 * import Router from '@koa/router';
 * import { koaAdapter, defineRoute } from 'doctreen/koa';
 * import { s } from 'doctreen';
 *
 * const router = new Router();
 *
 * router.post('/users', defineRoute(
 *   async (ctx) => {
 *     ctx.status = 201;
 *     ctx.body = { id: 1, name: 'Alice' };
 *   },
 *   {
 *     request:  { body: s.object({ name: s.string(), email: s.string() }), query: null },
 *     response: s.object({ id: s.number(), name: s.string(), email: s.string() }),
 *     errors:   { 409: 'Email already in use' },
 *   }
 * ));
 * ```
 */
export declare function defineRoute<T extends (...args: any[]) => any>(
  handler: T,
  schemas?: RouteSchemas
): T;

/** Re-exported from `doctreen` for convenience. */
export { s, defineSchema } from '../index';
