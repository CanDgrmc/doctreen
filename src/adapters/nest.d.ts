import type { UserConfig, SchemaNode, s, defineSchema } from '../index';

// ─────────────────────────────────────────────────────────────────────────────
// Schema input types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A schema accepted by doctreen's NestJS integration.
 * Either a doctreen `SchemaNode` (built with the `s` helper) or a Zod schema
 * (any object with a `_def` property, i.e. the result of `z.object(...)` etc.).
 */
export type SchemaInput = SchemaNode | { _def: any };

// ─────────────────────────────────────────────────────────────────────────────
// NestRouteSchemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Documentation schema bag for a single NestJS route.
 * Passed to `@DocRoute`, or consumed by the granular decorators.
 */
export interface NestRouteSchemas {
  /** Human-readable description shown in the docs UI. */
  description?: string;

  /**
   * Request headers to document, keyed by header name.
   * @example { 'x-api-key': 'Partner API key', 'Content-Type': 'application/json' }
   */
  headers?: Record<string, string>;

  /** Request body and/or query parameter schemas. Accept SchemaNode or Zod schemas. */
  request?: {
    body?: SchemaInput | null;
    query?: SchemaInput | null;
  } | null;

  /** Response payload schema. Accepts a SchemaNode or a Zod schema. */
  response?: SchemaInput | null;

  /**
   * Documented error responses keyed by HTTP status code.
   * @example
   * errors: {
   *   400: 'Validation failed',
   *   401: { description: 'Missing or invalid API key' },
   *   422: { description: 'Unprocessable entity', schema: s.object({ message: s.string() }) },
   * }
   */
  errors?: Record<number, string | { description?: string | null; schema?: SchemaInput | null }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal structural interface for INestApplication
// No hard dependency on @nestjs/core or @nestjs/common.
// ─────────────────────────────────────────────────────────────────────────────

export interface NestApplicationLike {
  getHttpAdapter(): { get(path: string, handler: (...args: any[]) => any): void; constructor: { name: string } };
  getGlobalPrefix?(): string;
  /** Internal NestJS container — accessed via app.container at runtime. */
  container: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// nestAdapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sets up doctreen documentation for a NestJS application.
 *
 * Call **after** `NestFactory.create()` and **before** `app.listen()`.
 * Works with both `@nestjs/platform-express` (default) and
 * `@nestjs/platform-fastify`.
 *
 * No changes to your `AppModule` or imports of `DiscoveryModule` are required.
 * The adapter reads NestJS internal route metadata directly.
 *
 * @example
 * ```ts
 * import { NestFactory } from '@nestjs/core';
 * import { nestAdapter } from 'doctreen/nest';
 * import { AppModule } from './app.module';
 *
 * async function bootstrap() {
 *   const app = await NestFactory.create(AppModule);
 *   nestAdapter(app, {
 *     meta: { title: 'My API', version: '2.0.0' },
 *   });
 *   await app.listen(3000);
 * }
 * bootstrap();
 * ```
 */
export declare function nestAdapter(app: NestApplicationLike, userConfig?: UserConfig): void;

// ─────────────────────────────────────────────────────────────────────────────
// Decorators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach a complete documentation schema to a NestJS controller method.
 *
 * Stack above or below the NestJS route decorator (`@Get`, `@Post`, …).
 *
 * @example
 * ```ts
 * @Post('import')
 * @DocRoute({
 *   description: 'Bulk import partner inventory',
 *   headers: { 'x-partner-api-key': 'Partner API key' },
 *   request: { body: importProductsSchema },
 *   response: importProductsResponseSchema,
 *   errors: {
 *     400: 'Validation failed',
 *     401: 'Missing or invalid API key',
 *   },
 * })
 * importProducts(@Body(new ZodValidationPipe(importProductsSchema)) body: ImportProductsDto) {
 *   ...
 * }
 * ```
 */
export declare function DocRoute(schemas: NestRouteSchemas): MethodDecorator;

/**
 * Attach a human-readable description to a route.
 * Merges with any other `@Doc*` decorators on the same method.
 *
 * @example
 * ```ts
 * @Get()
 * @DocDescription('List all active users')
 * getUsers() { ... }
 * ```
 */
export declare function DocDescription(description: string): MethodDecorator;

/**
 * Document expected request headers.
 * Merges with any other `@Doc*` decorators on the same method.
 *
 * @example
 * ```ts
 * @DocHeaders({ Authorization: 'Bearer <token>', 'x-tenant-id': 'Tenant identifier' })
 * ```
 */
export declare function DocHeaders(headers: Record<string, string>): MethodDecorator;

/**
 * Document request body and/or query schemas.
 * Accepts `SchemaNode` objects (from the `s` builder) or Zod schemas.
 * Merges with any other `@Doc*` decorators on the same method.
 *
 * @example
 * ```ts
 * @DocRequest({ body: z.object({ name: z.string() }), query: z.object({ page: z.number() }) })
 * ```
 */
export declare function DocRequest(request: {
  body?: SchemaInput | null;
  query?: SchemaInput | null;
}): MethodDecorator;

/**
 * Document the success response schema.
 * Accepts a `SchemaNode` or a Zod schema.
 * Merges with any other `@Doc*` decorators on the same method.
 *
 * @example
 * ```ts
 * @DocResponse(z.object({ id: z.number(), name: z.string() }))
 * ```
 */
export declare function DocResponse(response: SchemaInput): MethodDecorator;

/**
 * Document error responses keyed by HTTP status code.
 * Merges with any other `@Doc*` decorators on the same method.
 *
 * @example
 * ```ts
 * @DocErrors({ 404: 'User not found', 422: { description: 'Validation failed' } })
 * ```
 */
export declare function DocErrors(
  errors: Record<number, string | { description?: string | null; schema?: SchemaInput | null }>
): MethodDecorator;

// ─────────────────────────────────────────────────────────────────────────────
// defineRoute (compat shim)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches a schema bag to a plain handler function (compatibility shim).
 * In NestJS, prefer `@DocRoute` instead.
 */
export declare function defineRoute<T extends (...args: any[]) => any>(
  handler: T,
  schemas?: NestRouteSchemas
): T;

/** Re-exported from `doctreen` for convenience. */
export { s, defineSchema } from '../index';
