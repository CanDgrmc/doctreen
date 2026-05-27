/**
 * Generate an example JS value from a doctreen SchemaNode or an OpenAPI 3.x
 * Schema Object. Used by the docs UI ("Copy as cURL", Postman export) and by
 * `npx doctreen mock` to fabricate request and response bodies.
 *
 * When `@faker-js/faker` is installed and `options.faker !== false`, output is
 * enriched with realistic values (emails, names, ISO dates, etc.) routed by
 * OpenAPI `format` strings and common field names. Without faker, output is a
 * deterministic placeholder (`'string'`, `0`, `true`, `null`).
 */
export interface GenerateExampleOptions {
  /**
   * Enable Faker enrichment. Defaults to `true` when `@faker-js/faker` is
   * installed; pass `false` to force placeholder output.
   */
  faker?: boolean;
  /** Faker seed for reproducible runs. */
  seed?: number;
  /**
   * OpenAPI `components.schemas` map for `$ref` resolution. Required only
   * when the schema you pass contains `$ref` entries.
   */
  components?: Record<string, any>;
  /**
   * Field name hint for the *root* call. Faker uses this to pick a more
   * realistic value (e.g. `email` → `internet.email()`). Nested fields are
   * inferred from object property names automatically.
   */
  fieldName?: string;
}

export function generateExample(schema: any, options?: GenerateExampleOptions): any;
