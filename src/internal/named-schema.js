'use strict';

/**
 * Named-schema marker (v1.15).
 *
 * `defineSchema(name, schema)` tags the schema object with this Symbol so it
 * can be recognised by name *after* conversion — even for Zod schemas, whose
 * `zodToSchemaNode` conversion produces a fresh SchemaNode each time and thus
 * breaks object-identity matching. The tag is a non-enumerable Symbol so it
 * never leaks into JSON output, `Object.keys`, or object spreads; only explicit
 * propagation carries it forward.
 *
 * The OpenAPI exporter reads the tag to emit `$ref: '#/components/schemas/<name>'`
 * (and register the component body once), which is what lets Zod-defined named
 * schemas dedupe into readable `components.schemas` instead of anonymous
 * `SchemaN` types.
 */
const SCHEMA_NAME = Symbol('doctreen.schemaName');

/**
 * Tag an object (Zod schema or SchemaNode) with a registered name.
 * @param {any} obj
 * @param {string} name
 * @returns {any} the same object
 */
function setSchemaName(obj, name) {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    Object.defineProperty(obj, SCHEMA_NAME, {
      value: name,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  } catch (_) { /* frozen object — best-effort */ }
  return obj;
}

/**
 * Read the registered name off an object, or undefined.
 * @param {any} obj
 * @returns {string|undefined}
 */
function getSchemaName(obj) {
  return obj && typeof obj === 'object' ? obj[SCHEMA_NAME] : undefined;
}

module.exports = { SCHEMA_NAME, setSchemaName, getSchemaName };
