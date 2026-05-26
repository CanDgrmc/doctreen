import type { UserConfig, SchemaNode, s } from '../index';
import type { SchemaInput } from './zod';

// ─────────────────────────────────────────────────────────────────────────────
// Structural interfaces — no hard dependency on hono or @types/hono
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape of a Hono context object.
 * Matches `c` in `app.get('/path', (c) => { ... })`.
 */
export interface HonoContextLike {
  /** Return an HTML response. Available on all Hono context objects. */
  html(content: string, status?: number): Response;
}

/**
 * Minimal shape of a single entry in `app.routes`.
 */
export interface HonoRouteEntry {
  method: string;
  path: string;
  handler: Function;
}

/**
 * Minimal structural interface for a Hono application instance.
 * Matches both Hono v3 and Hono v4.
 * Using a structural type avoids a hard dependency on `hono` itself.
 */
export interface HonoLike {
  /**
   * Register a GET handler. Used internally by `honoAdapter` to add the docs route.
   */
  get(path: string, handler: (c: HonoContextLike) => Response | Promise<Response>): this;
  /**
   * All registered routes. Hono keeps this array up-to-date as routes are added.
   * Read lazily on the first docs request.
   */
  routes?: HonoRouteEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds a documentation UI route to a Hono app.
 *
 * Routes are discovered lazily on the first request to `docsPath`: the adapter
 * reads `app.routes` (which Hono maintains) and builds a `RouteRegistry`.
 * Call `honoAdapter` before **or** after your routes — all routes registered
 * by the time the docs page is first hit will be shown.
 *
 * Schema resolution order (first wins per field):
 *   1. `defineRoute` schemas — explicit, highest priority
 *   2. JSDoc block comment inside the handler function
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { serve } from '@hono/node-server';
 * import { honoAdapter } from 'doctreen/hono';
 *
 * const app = new Hono();
 *
 * app.get('/users', (c) => c.json([]));
 *
 * honoAdapter(app, {
 *   docsPath: '/api/docs',
 *   meta: { title: 'My API', version: '1.0.0' },
 * });
 *
 * serve({ fetch: app.fetch, port: 3000 });
 * ```
 */
export declare function honoAdapter(app: HonoLike, userConfig?: UserConfig): void;

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
   * @example
   * errors: {
   *   404: 'Not found',
   *   422: { description: 'Validation failed', schema: s.object({ message: s.string() }) },
   *   409: { description: 'Conflict', schema: z.object({ message: z.string() }) },
   * }
   */
  errors?: Record<number, string | { description?: string | null; schema?: SchemaInput | null }>;
  /** Per-route override for runtime validation (v1.6+). */
  validate?: boolean;
  /** Hide this route from the docs UI and the OpenAPI export (v1.8+). */
  hidden?: boolean;
  /** OpenAPI security requirement for this operation (v1.8+). See express.d.ts for full notes. */
  security?: Array<Record<string, string[]>>;
}

/**
 * Decorates a Hono route handler with pre-defined documentation schemas.
 * Works identically to `defineRoute` from `doctreen/express` and `doctreen/fastify`.
 *
 * Uses a generic pass-through so the return type matches the input handler type,
 * preserving full Hono context type inference.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { honoAdapter, defineRoute } from 'doctreen/hono';
 * import { s } from 'doctreen';
 *
 * const app = new Hono();
 *
 * app.post('/users', defineRoute(
 *   async (c) => {
 *     const body = await c.req.json<{ name: string; email: string }>();
 *     return c.json({ id: 1, ...body }, 201);
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
