'use strict';

/**
 * Converts a Zod v3 schema to doctreen's internal SchemaNode format.
 * Returns { type: 'unknown' } for unrecognised or too-deeply-nested types.
 *
 * @param {any} zodSchema
 * @param {number} [depth=0]
 * @returns {import('../index').SchemaNode}
 */
function zodToSchemaNode(zodSchema, depth) {
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
    return { ...zodToSchemaNode(def.innerType, depth + 1), optional: true };
  }
  if (t === 'ZodDefault') {
    return zodToSchemaNode(def.innerType, depth + 1);
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
    // All enum values are strings in ZodEnum
    return { type: 'string' };
  }
  if (t === 'ZodNativeEnum') {
    const vals = Object.values(def.values || {});
    const hasString = vals.some((v) => typeof v === 'string');
    return { type: hasString ? 'string' : 'number' };
  }
  if (t === 'ZodLiteral') {
    const vt = typeof def.value;
    return { type: vt === 'string' || vt === 'number' || vt === 'boolean' ? vt : 'string' };
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
