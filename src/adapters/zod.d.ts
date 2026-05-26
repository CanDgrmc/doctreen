import type { SchemaNode } from '../index';

/**
 * Converts a Zod v3 schema to doctreen's internal `SchemaNode` format.
 *
 * Handles: string, number, boolean, null, object, array, tuple, record, set,
 * optional, nullable, default, catch, readonly, branded, effects/transform,
 * pipeline, enum, nativeEnum, literal, union, discriminatedUnion, intersection,
 * and lazy schemas.
 *
 * Unrecognised or too-deeply-nested schemas fall back to `{ type: 'unknown' }`.
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { zodToSchemaNode } from 'doctreen/zod';
 *
 * const schema = z.object({ name: z.string(), age: z.number().optional() });
 * const node = zodToSchemaNode(schema);
 * // { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number', optional: true } } }
 * ```
 */
export declare function zodToSchemaNode(zodSchema: any, depth?: number): SchemaNode;

/**
 * Returns `true` if `val` looks like a Zod v3 schema instance (has `_def.typeName`).
 * Useful for writing generic helpers that accept either a `SchemaNode` or a Zod schema.
 */
export declare function isZodSchema(val: any): boolean;

/**
 * Structural type matching any Zod schema instance — i.e. anything with a `_def`
 * property. Used by adapter declaration files so that `defineRoute` /
 * `@DocRoute` accept Zod schemas without a hard dependency on the `zod` types.
 */
export type ZodSchemaLike = { _def: any };

/** Union accepted by adapter `defineRoute` / `@DocRoute` schema slots. */
export type SchemaInput = SchemaNode | ZodSchemaLike;
