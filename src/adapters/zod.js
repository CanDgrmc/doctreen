'use strict';

const { getSchemaName, setSchemaName } = require('../internal/named-schema');

/**
 * Converts a Zod v3 schema to doctreen's internal SchemaNode format.
 * Returns { type: 'unknown' } for unrecognised or too-deeply-nested types.
 *
 * Thin wrapper over `_zodToSchemaNode` that carries a `defineSchema` name onto
 * the produced node. Because recursion goes through this wrapper, *nested*
 * named schemas are tagged too — so they also emit `$ref`s in the OpenAPI export.
 *
 * @param {any} zodSchema
 * @param {number} [depth=0]
 * @returns {import('../index').SchemaNode}
 */
function zodToSchemaNode(zodSchema, depth) {
  const node = _zodToSchemaNode(zodSchema, depth);
  const name = getSchemaName(zodSchema);
  if (name && node && typeof node === 'object' && !getSchemaName(node)) {
    setSchemaName(node, name);
  }
  return node;
}

/**
 * @param {any} zodSchema
 * @param {number} [depth=0]
 * @returns {import('../index').SchemaNode}
 */
function _zodToSchemaNode(zodSchema, depth) {
  depth = depth || 0;
  if (depth > 5 || zodSchema == null) return { type: 'unknown' };

  const def = zodSchema._def;
  if (!def) return { type: 'unknown' };

  const t = def.typeName;

  // ── primitives ─────────────────────────────────────────────────────────────
  if (t === 'ZodString' || t === 'ZodDate' || t === 'ZodUUID') return { type: 'string' };
  if (t === 'ZodNumber' || t === 'ZodBigInt' || t === 'ZodInt') return { type: 'number' };
  if (t === 'ZodBoolean') return { type: 'boolean' };
  if (t === 'ZodNull' || t === 'ZodUndefined' || t === 'ZodVoid' || t === 'ZodNever') return { type: 'null' };
  if (t === 'ZodAny' || t === 'ZodUnknown') return { type: 'unknown' };

  // ── object ─────────────────────────────────────────────────────────────────
  if (t === 'ZodObject') {
    const rawShape = def.shape;
    const shape = typeof rawShape === 'function' ? rawShape() : rawShape;
    const properties = {};
    for (const key of Object.keys(shape || {})) {
      properties[key] = zodToSchemaNode(shape[key], depth + 1);
    }
    return { type: 'object', properties };
  }

  // ── array ──────────────────────────────────────────────────────────────────
  if (t === 'ZodArray') {
    return { type: 'array', items: zodToSchemaNode(def.type, depth + 1) };
  }

  // ── tuple — treat as array of first element type ───────────────────────────
  if (t === 'ZodTuple') {
    const items = def.items || [];
    return {
      type: 'array',
      items: items.length > 0 ? zodToSchemaNode(items[0], depth + 1) : { type: 'unknown' },
    };
  }

  // ── record — object with unknown keys ──────────────────────────────────────
  if (t === 'ZodRecord' || t === 'ZodMap') {
    return { type: 'object', properties: {} };
  }

  // ── set — treat as array ───────────────────────────────────────────────────
  if (t === 'ZodSet') {
    return { type: 'array', items: zodToSchemaNode(def.valueType, depth + 1) };
  }

  // ── wrappers that delegate to their inner type ─────────────────────────────
  if (t === 'ZodOptional') {
    return { ...zodToSchemaNode(def.innerType, depth + 1), optional: true };
  }
  if (t === 'ZodNullable') {
    return { ...zodToSchemaNode(def.innerType, depth + 1), nullable: true };
  }
  if (t === 'ZodDefault') {
    const inner = zodToSchemaNode(def.innerType, depth + 1);
    // `def.defaultValue` is a thunk in Zod v3. A field with a default is
    // optional on input, so mark it as such alongside the resolved value.
    let value;
    try {
      value = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
    } catch (_) {
      value = undefined;
    }
    return value === undefined
      ? { ...inner, optional: true }
      : { ...inner, default: value, optional: true };
  }
  if (t === 'ZodCatch') {
    return zodToSchemaNode(def.innerType, depth + 1);
  }
  if (t === 'ZodReadonly') {
    return zodToSchemaNode(def.innerType, depth + 1);
  }
  if (t === 'ZodBranded') {
    return zodToSchemaNode(def.type, depth + 1);
  }

  // ── effects / transform — unwrap to input schema ───────────────────────────
  if (t === 'ZodEffects') {
    return zodToSchemaNode(def.schema, depth + 1);
  }
  if (t === 'ZodPipeline') {
    return zodToSchemaNode(def.in, depth + 1);
  }

  // ── enum / literal ─────────────────────────────────────────────────────────
  if (t === 'ZodEnum') {
    // All enum values are strings in ZodEnum. `def.values` is the string[].
    const values = Array.isArray(def.values) ? def.values.slice() : [];
    return values.length > 0 ? { type: 'string', enum: values } : { type: 'string' };
  }
  if (t === 'ZodNativeEnum') {
    // Native (TS) enums include reverse-mapping numeric keys; keep only the
    // actual member values and drop the numeric-string reverse-map entries.
    const raw = def.values || {};
    const numeric = Object.values(raw).filter((v) => typeof v === 'number');
    const values = numeric.length > 0
      ? numeric
      : Object.values(raw).filter((v) => typeof v === 'string' || typeof v === 'number');
    const hasString = values.some((v) => typeof v === 'string');
    return values.length > 0
      ? { type: hasString ? 'string' : 'number', enum: values }
      : { type: hasString ? 'string' : 'number' };
  }
  if (t === 'ZodLiteral') {
    const vt = typeof def.value;
    const type = def.value === null ? 'null'
      : vt === 'number' || vt === 'boolean' ? vt
      : 'string';
    return { type, const: def.value };
  }

  // ── union / discriminated union — use first option as representative ────────
  if (t === 'ZodUnion' || t === 'ZodDiscriminatedUnion') {
    const options = def.options || [];
    if (options.length > 0) return zodToSchemaNode(options[0], depth + 1);
    return { type: 'unknown' };
  }

  // ── intersection — merge if both sides are objects ─────────────────────────
  if (t === 'ZodIntersection') {
    const left = zodToSchemaNode(def.left, depth + 1);
    const right = zodToSchemaNode(def.right, depth + 1);
    if (left.type === 'object' && right.type === 'object') {
      return { type: 'object', properties: { ...left.properties, ...right.properties } };
    }
    return left;
  }

  // ── lazy — resolve and recurse ─────────────────────────────────────────────
  if (t === 'ZodLazy') {
    try {
      return zodToSchemaNode(def.getter(), depth + 1);
    } catch (_) {
      return { type: 'unknown' };
    }
  }

  return { type: 'unknown' };
}

/**
 * Returns true if the value looks like a Zod schema instance.
 *
 * @param {any} val
 * @returns {boolean}
 */
function isZodSchema(val) {
  return (
    val != null &&
    typeof val === 'object' &&
    '_def' in val &&
    val._def != null &&
    'typeName' in val._def
  );
}

module.exports = { zodToSchemaNode, isZodSchema };
