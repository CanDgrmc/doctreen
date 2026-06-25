export interface CodegenOptions {
  /** Output module path for the generated client to import types from. Defaults to `./types`. */
  typesImportPath?: string;
  /** Default base URL baked into the generated client. */
  baseUrl?: string;
}

export function generateTypes(doc: any, opts?: CodegenOptions): string;
export function generateClient(doc: any, opts?: CodegenOptions): string;
export function loadOpenApiDoc(from: string): Promise<any>;
