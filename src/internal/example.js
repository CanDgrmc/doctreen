'use strict';

/**
 * Schema → example value generator (v1.12+).
 *
 * Accepts either:
 *   - doctreen's internal SchemaNode (`{ type, properties?, items?, optional? }`)
 *   - an OpenAPI 3.x Schema Object (with `$ref`, `enum`, `format`, `example`,
 *     `oneOf`/`anyOf`/`allOf`, `additionalProperties`, etc.)
 *
 * The same generator powers:
 *   - the docs UI's "Copy as cURL" / Postman export buttons
 *   - `npx doctreen mock` request and response bodies
 *
 * Faker integration is optional and lazy. When `@faker-js/faker` is installed
 * AND `options.faker !== false`, field names and OpenAPI string formats route
 * to richer Faker values. Otherwise the generator emits stable placeholder
 * values (`'string'`, `0`, `true`, …) so output is deterministic.
 */

// Resolved lazily on first use. `false` means "tried and not installed".
let _faker = null;
function tryLoadFaker() {
  if (_faker !== null) return _faker;
  try {
    // eslint-disable-next-line global-require
    const mod = require('@faker-js/faker');
    _faker = (mod && mod.faker) || null;
  } catch (_e) {
    _faker = false;
  }
  return _faker;
}

/**
 * @param {any}    schema
 * @param {object} [options]
 * @param {boolean}                 [options.faker]      - enable Faker enrichment (default: auto)
 * @param {Record<string, any>}     [options.components] - OpenAPI `components.schemas` for `$ref` resolution
 * @param {string}                  [options.fieldName]  - parent property name (used for faker heuristics)
 * @param {number}                  [options.seed]       - Faker seed for reproducible output
 * @returns {any}
 */
function generateExample(schema, options) {
  const opts = options || {};
  const faker = opts.faker === false ? null : tryLoadFaker();
  if (faker && typeof opts.seed === 'number') faker.seed(opts.seed);

  const ctx = {
    faker: faker && opts.faker !== false ? faker : null,
    components: opts.components || {},
    depth: 0,
  };
  return walk(schema, ctx, opts.fieldName || null);
}

function walk(schema, ctx, fieldName) {
  if (schema == null || typeof schema !== 'object') return null;
  if (ctx.depth > 8) return null;

  // 1. Explicit example wins.
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  // 2. $ref → resolve.
  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, ctx.components);
    if (resolved) {
      ctx.depth++;
      const value = walk(resolved, ctx, fieldName);
      ctx.depth--;
      return value;
    }
    return null;
  }

  // 3. Compositions — pick the first branch we can resolve.
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return walk(schema.oneOf[0], ctx, fieldName);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return walk(schema.anyOf[0], ctx, fieldName);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return mergeAllOf(schema.allOf, ctx, fieldName);
  }

  const type = resolveType(schema);

  if (type === 'object') return objectExample(schema, ctx);
  if (type === 'array')  return arrayExample(schema, ctx, fieldName);
  if (type === 'string') return stringExample(schema, ctx, fieldName);
  if (type === 'integer') return integerExample(schema, ctx, fieldName);
  if (type === 'number') return numberExample(schema, ctx, fieldName);
  if (type === 'boolean') return booleanExample(schema, ctx);
  if (type === 'null') return null;

  // No usable type info — return null so JSON.stringify keeps the key.
  return null;
}

function resolveType(schema) {
  if (typeof schema.type === 'string') return schema.type;
  // OpenAPI 3.1 allows `type: ['string', 'null']`.
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    const nonNull = schema.type.find(function (t) { return t !== 'null'; });
    return nonNull || schema.type[0];
  }
  // Implicit shapes.
  if (schema.properties || schema.additionalProperties) return 'object';
  if (schema.items) return 'array';
  return null;
}

function resolveRef(ref, components) {
  // Supports `#/components/schemas/Name` style refs.
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
  if (!m) return null;
  return components[m[1]] || null;
}

function mergeAllOf(parts, ctx, fieldName) {
  const out = {};
  for (let i = 0; i < parts.length; i++) {
    const val = walk(parts[i], ctx, fieldName);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(out, val);
    }
  }
  return out;
}

function objectExample(schema, ctx) {
  const props = schema.properties || {};
  const out = {};
  ctx.depth++;
  for (const key of Object.keys(props)) {
    out[key] = walk(props[key], ctx, key);
  }
  ctx.depth--;
  return out;
}

function arrayExample(schema, ctx, fieldName) {
  if (!schema.items) return [];
  ctx.depth++;
  const item = walk(schema.items, ctx, singularise(fieldName));
  ctx.depth--;
  return [item];
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function stringExample(schema, ctx, fieldName) {
  const format = schema.format;
  if (format) {
    const byFormat = stringByFormat(format, ctx);
    if (byFormat !== undefined) return byFormat;
  }

  if (ctx.faker && fieldName) {
    const byName = stringByFieldName(fieldName, ctx.faker);
    if (byName !== undefined) return byName;
  }

  if (ctx.faker) return ctx.faker.lorem.word();
  return 'string';
}

function stringByFormat(format, ctx) {
  const f = ctx.faker;
  switch (format) {
    case 'uuid':       return f ? f.string.uuid() : '00000000-0000-0000-0000-000000000000';
    case 'email':      return f ? f.internet.email() : 'user@example.com';
    case 'uri':
    case 'url':        return f ? f.internet.url() : 'https://example.com';
    case 'hostname':   return f ? f.internet.domainName() : 'example.com';
    case 'ipv4':       return f ? f.internet.ipv4() : '192.0.2.1';
    case 'ipv6':       return f ? f.internet.ipv6() : '2001:db8::1';
    case 'date':       return new Date().toISOString().slice(0, 10);
    case 'date-time':  return new Date().toISOString();
    case 'time':       return '12:00:00';
    case 'password':   return f ? f.internet.password() : 'p4ssw0rd!';
    case 'byte':       return Buffer.from('example').toString('base64');
    case 'binary':     return '';
    default:           return undefined;
  }
}

function stringByFieldName(fieldName, faker) {
  const name = String(fieldName).toLowerCase();
  if (name === 'id' || name.endsWith('id') || name.endsWith('_id')) return faker.string.uuid();
  if (name === 'email') return faker.internet.email();
  if (name === 'firstname' || name === 'first_name') return faker.person.firstName();
  if (name === 'lastname' || name === 'last_name') return faker.person.lastName();
  if (name === 'name' || name === 'fullname' || name === 'full_name') return faker.person.fullName();
  if (name === 'username' || name === 'handle' || name === 'slug') return faker.internet.username();
  if (name === 'avatar' || name === 'image' || name === 'photo' || name === 'picture') return faker.image.avatar();
  if (name === 'url' || name === 'website' || name === 'link') return faker.internet.url();
  if (name === 'phone' || name === 'phone_number' || name === 'tel') return faker.phone.number();
  if (name === 'address' || name === 'street') return faker.location.streetAddress();
  if (name === 'city') return faker.location.city();
  if (name === 'country') return faker.location.country();
  if (name === 'zipcode' || name === 'postal_code' || name === 'postcode' || name === 'zip') return faker.location.zipCode();
  if (name === 'company') return faker.company.name();
  if (name === 'description' || name === 'summary' || name === 'bio') return faker.lorem.sentence();
  if (name === 'title' || name === 'subject' || name === 'headline') return faker.lorem.words(4);
  if (name === 'content' || name === 'body' || name === 'message' || name === 'comment' || name === 'text') return faker.lorem.paragraph();
  if (name === 'price' || name === 'amount' || name === 'cost') return faker.commerce.price();
  if (name === 'currency') return faker.finance.currencyCode();
  if (name === 'token' || name === 'apikey' || name === 'api_key' || name === 'secret') return faker.string.alphanumeric(32);
  if (name === 'color' || name === 'colour') return faker.color.human();
  if (name === 'createdat' || name === 'created_at' || name === 'updatedat' || name === 'updated_at' || name.endsWith('_at')) {
    return faker.date.recent().toISOString();
  }
  return undefined;
}

function integerExample(schema, ctx, fieldName) {
  if (typeof schema.minimum === 'number') return schema.minimum;
  if (ctx.faker) {
    const min = typeof schema.minimum === 'number' ? schema.minimum : 1;
    const max = typeof schema.maximum === 'number' ? schema.maximum : 1000;
    if (fieldName && /id$/i.test(fieldName)) return ctx.faker.number.int({ min: 1, max: 9999 });
    return ctx.faker.number.int({ min, max });
  }
  return 0;
}

function numberExample(schema, ctx) {
  if (typeof schema.minimum === 'number') return schema.minimum;
  if (ctx.faker) {
    const min = typeof schema.minimum === 'number' ? schema.minimum : 0;
    const max = typeof schema.maximum === 'number' ? schema.maximum : 1000;
    return Number(ctx.faker.number.float({ min, max, fractionDigits: 2 }));
  }
  return 0;
}

function booleanExample() { return true; }

function singularise(name) {
  if (!name || typeof name !== 'string') return null;
  // crude — drops trailing "s" so `users` → `user` for faker field-name match.
  if (name.length > 1 && name.endsWith('s')) return name.slice(0, -1);
  return name;
}

module.exports = {
  generateExample,
  // exported for tests + the openapi loader.
  _internal: { resolveType, resolveRef },
};
