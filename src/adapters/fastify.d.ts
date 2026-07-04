import type { UserConfig, SchemaNode, s } from '../index';
import type { SchemaInput } from './zod';

// ─────────────────────────────────────────────────────────────────────────────
// Structural interfaces — no hard dependency on @types/fastify
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal structural interface for the Fastify reply object.
 */
export interface FastifyReplyLike {
  header(key: string, value: string): this;
  send(data: unknown): this;
}

/**
 * Minimal shape of `routeOptions` passed to Fastify's `onRoute` hook.
 */
export interface FastifyRouteOptions {
  /** HTTP method(s). Fastify uses upper-case strings. */
  method: string | string[];
  /** Route path (Fastify 4). */
  url?: string;
  /** Route path (Fastify 5). */
  path?: string;
  /** The handler function. */
  handler?: Function;
  /** Fastify native JSON Schema (optional). */
  schema?: {
    description?: string;
    body?: Record<string, unknown>;
    Body?: Record<string, unknown>;
    querystring?: Record<string, unknown>;
    Querystring?: Record<string, unknown>;
    response?: Record<number | string, Record<string, unknown>>;
    Response?: Record<number | string, Record<string, unknown>>;
  };
}

/**
 * Minimal structural interface for the Fastify instance.
 * Matches both Fastify 4 and Fastify 5 shapes.
 * Using a structural type avoids a hard dependency on `@types/fastify` / `fastify`.
 */
export interface FastifyLike {
  addHook(name: 'onRoute', hook: (routeOptions: FastifyRouteOptions) => void): void;
  get(path: string, handler: (req: unknown, reply: FastifyReplyLike) => void): void;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sets up route introspection and serves the documentation UI for a Fastify app.
 *
 * Uses Fastify's `onRoute` hook to capture every route as it is registered.
 * Call this **before** registering your routes.
 *
 * Schema resolution order (first wins):
 *   1. `defineRoute` schemas
 *   2. Fastify native JSON Schema (`schema` option on route)
 *   3. JSDoc block comment inside the handler
 *
 * @example
 * ```ts
 * import Fastify from 'fastify';
 * import { fastifyAdapter } from 'doctreen/fastify';
 *
 * const fastify = Fastify();
 *
 * // Call BEFORE your routes
 * fastifyAdapter(fastify, {
 *   docsPath: '/api/docs',
 *   meta: { title: 'My API', version: '1.0.0' },
 * });
 *
 * fastify.get('/users', handler);
 * fastify.listen({ port: 3000 });
 * ```
 */
export declare function fastifyAdapter(fastify: FastifyLike, userConfig?: UserConfig): void;

/** Build the OpenAPI 3.1 document from a Fastify app offline (call after `await fastify.ready()`). */
export declare function getOpenApiDocument(fastify: FastifyLike, userConfig?: UserConfig): object;

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
  request?: { body?: SchemaInput | null; query?: SchemaInput | null; params?: SchemaInput | null } | null;
  /** Response payload schema. Accepts a SchemaNode, a Zod schema, or a status-keyed map (`{ 201: schema }`, v1.15). */
  response?: SchemaInput | Record<number, SchemaInput> | null;
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
 * Decorates a Fastify route handler with pre-defined documentation schemas.
 * Works identically to `defineRoute` from `doctreen/express`.
 *
 * Uses a generic pass-through so the return type matches the input handler type,
 * preserving full Fastify route type inference.
 *
 * @example
 * ```ts
 * import Fastify from 'fastify';
 * import { fastifyAdapter, defineRoute } from 'doctreen/fastify';
 * import { s } from 'doctreen';
 *
 * type CreateUserBody = { name: string; email: string };
 * type UserResponse   = { id: number; name: string; email: string };
 *
 * fastify.post<{ Body: CreateUserBody; Reply: UserResponse }>('/users', {
 *   handler: defineRoute(
 *     async (req, reply) => {
 *       reply.status(201).send({ id: 1, ...req.body });
 *     },
 *     {
 *       request: { body: s.object({ name: s.string(), email: s.string() }), query: null },
 *       response: s.object({ id: s.number(), name: s.string() }),
 *       errors: { 409: 'Email already in use' },
 *     }
 *   ),
 * });
 * ```
 */
export declare function defineRoute<T extends (...args: any[]) => any>(
  handler: T,
  schemas?: RouteSchemas
): T;

/** Re-exported from `doctreen` for convenience. */
export { s, defineSchema } from '../index';
