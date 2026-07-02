'use strict';

/**
 * OpenAPI Schema Object → TypeScript type expression.
 *
 * Resolves `$ref` to identifier names from `components.schemas`. Caller is
 * responsible for emitting interface declarations for every referenced name.
 * The context tracks which names were touched so the caller can avoid
 * generating dead interfaces (or, if it wants, just emit all components).
 *
 * Handled:
 *   - $ref into components.schemas
 *   - type: string|number|integer|boolean|null|array|object
 *   - properties + required + additionalProperties
 *   - enum (literal union)
 *   - nullable (OpenAPI 3.0 style + 3.1 `type: ['x','null']`)
 *   - allOf (intersection), oneOf/anyOf (union)
 *
 * Out of scope: discriminator, format-driven branded types, pattern.
 */

function refName(ref) {
  if (typeof ref !== 'string') return null;
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
  return m ? m[1] : null;
}

function tsIdentifier(name) {
  let out = String(name).replace(/[^A-Za-z0-9_$]/g, '_');
  if (/^[0-9]/.test(out)) out = '_' + out;
  if (RESERVED.has(out)) out = out + '_';
  return out;
}

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
  'while', 'with',
]);

function safeKey(key) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return key;
  return JSON.stringify(key);
}

function literalValue(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return 'unknown';
}

/** Map an enum's values to a deduplicated literal union. */
function enumToUnion(values) {
  const seen = new Set();
  const parts = [];
  for (const v of values) {
    const lit = literalValue(v);
    if (!seen.has(lit)) {
      seen.add(lit);
      parts.push(lit);
    }
  }
  return parts.join(' | ');
}

/**
 * Return a shallow copy of `schema` with any `null` stripped from its `enum`.
 * Nullability is re-applied once by the caller, so keeping `null` in the enum
 * here would double it.
 */
function withoutEnumNull(schema) {
  if (!Array.isArray(schema.enum)) return schema;
  const filtered = schema.enum.filter(function (v) { return v !== null; });
  const copy = Object.assign({}, schema);
  if (filtered.length > 0) copy.enum = filtered;
  else delete copy.enum;
  return copy;
}

function createContext(components) {
  return {
    components: components || {},
    referenced: new Set(),
  };
}

function indent(text, depth) {
  if (depth <= 0) return text;
  const pad = '  '.repeat(depth);
  return text.split('\n').map(function (line, i) {
    return i === 0 ? line : pad + line;
  }).join('\n');
}

function schemaToTs(schema, ctx, depth) {
  depth = depth || 0;
  if (!schema || typeof schema !== 'object') return 'unknown';

  if (schema.$ref) {
    const name = refName(schema.$ref);
    if (name) {
      ctx.referenced.add(name);
      return tsIdentifier(name);
    }
    return 'unknown';
  }

  // Nullability can be expressed three (overlapping) ways: a `null` member in a
  // 3.1 `type` array, the 3.0 `nullable: true` flag, or a `null` entry in the
  // `enum`. We fold all of them into a SINGLE trailing `| null` so we never
  // emit `... | null | null`.
  const enumHasNull = Array.isArray(schema.enum) && schema.enum.indexOf(null) !== -1;

  // OpenAPI 3.1 nullable: type can be an array like ['string', 'null']
  if (Array.isArray(schema.type)) {
    const types = schema.type;
    const hasNull = types.indexOf('null') !== -1 || enumHasNull;
    const rest = types.filter(function (t) { return t !== 'null'; });
    const base = withoutEnumNull(schema);
    if (rest.length === 0) return 'null';
    if (rest.length === 1) {
      const inner = schemaToTs(Object.assign({}, base, { type: rest[0] }), ctx, depth);
      return hasNull ? inner + ' | null' : inner;
    }
    const parts = rest.map(function (t) { return schemaToTs(Object.assign({}, base, { type: t }), ctx, depth); });
    if (hasNull) parts.push('null');
    return parts.map(function (p) { return '(' + p + ')'; }).join(' | ');
  }

  // OpenAPI 3.0 nullable
  if (schema.nullable === true) {
    const inner = schemaToTs(Object.assign({}, withoutEnumNull(schema), { nullable: false }), ctx, depth);
    return inner + ' | null';
  }

  // const → single literal (OpenAPI 3.1)
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    const lit = literalValue(schema.const);
    return enumHasNull && lit !== 'null' ? lit + ' | null' : lit;
  }

  // enum → literal union (deduplicated; `null` folded in as a single member)
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return enumToUnion(schema.enum);
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map(function (s) { return '(' + schemaToTs(s, ctx, depth) + ')'; }).join(' & ');
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf.map(function (s) { return '(' + schemaToTs(s, ctx, depth) + ')'; }).join(' | ');
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf.map(function (s) { return '(' + schemaToTs(s, ctx, depth) + ')'; }).join(' | ');
  }

  const type = schema.type;

  if (type === 'string') return 'string';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'null') return 'null';

  // Tuple: OpenAPI 3.1 `prefixItems` (may appear with or without type: 'array').
  if (Array.isArray(schema.prefixItems) && schema.prefixItems.length > 0) {
    const members = schema.prefixItems.map(function (s) { return schemaToTs(s, ctx, depth); });
    if (schema.items && typeof schema.items === 'object') {
      members.push('...' + schemaToTs(schema.items, ctx, depth) + '[]');
    }
    return '[' + members.join(', ') + ']';
  }

  if (type === 'array') {
    const items = schemaToTs(schema.items || {}, ctx, depth);
    const needsParens = /[|&\s]/.test(items) && items[0] !== '{' && items[0] !== '(';
    return (needsParens ? '(' + items + ')' : items) + '[]';
  }

  // Object (explicit or inferred from properties / additionalProperties)
  if (type === 'object' || schema.properties || schema.additionalProperties !== undefined) {
    return objectToTs(schema, ctx, depth);
  }

  return 'unknown';
}

function objectToTs(schema, ctx, depth) {
  const props = schema.properties || {};
  const required = new Set(schema.required || []);
  const keys = Object.keys(props);
  const ap = schema.additionalProperties;

  if (keys.length === 0) {
    // Explicit `additionalProperties: false` with no props → a closed, empty object.
    if (ap === false) return 'Record<string, never>';
    if (ap && typeof ap === 'object') return 'Record<string, ' + schemaToTs(ap, ctx, depth) + '>';
    return 'Record<string, unknown>';
  }

  const pad = '  '.repeat(depth + 1);
  const closePad = '  '.repeat(depth);
  const lines = ['{'];
  for (const k of keys) {
    const optional = required.has(k) ? '' : '?';
    const child = schemaToTs(props[k], ctx, depth + 1);
    lines.push(pad + safeKey(k) + optional + ': ' + child + ';');
  }
  if (ap && typeof ap === 'object') {
    lines.push(pad + '[key: string]: ' + schemaToTs(ap, ctx, depth + 1) + ';');
  } else if (ap === true) {
    lines.push(pad + '[key: string]: unknown;');
  }
  lines.push(closePad + '}');
  return lines.join('\n');
}

module.exports = {
  schemaToTs,
  createContext,
  refName,
  tsIdentifier,
  safeKey,
};
