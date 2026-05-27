/**
 * doctreen/mock — in-process mock server.
 *
 * Spin up an Express app that fabricates request/response payloads from an
 * OpenAPI 3.x document or any compatible route descriptor list. Useful for
 * frontend dev, contract testing, and CI fixtures.
 */
export interface MockRouteDescriptor {
  method: string;
  path: string;
  openapiPath?: string;
  operationId?: string | null;
  summary?: string | null;
  description?: string | null;
  tags?: string[];
  pathParams?: Array<{ name: string; schema?: any; required?: boolean; example?: any }>;
  query?: Array<{ name: string; schema?: any; required?: boolean; example?: any }>;
  headers?: Array<{ name: string; schema?: any; required?: boolean; example?: any }>;
  requestBody?: { schema?: any; example?: any; examples?: Record<string, any> } | null;
  responses?: Record<string, {
    schema?: any;
    example?: any;
    examples?: Record<string, any>;
    description?: string | null;
  }>;
  successStatus?: string;
}

export interface MockOptions {
  routes: MockRouteDescriptor[];
  components?: Record<string, any>;
  info?: { title?: string; version?: string; description?: string };
  crud?: boolean;
  faker?: boolean;
  seed?: number;
  latency?: number | [number, number];
  errorRate?: number;
  persistPath?: string;
  logRequests?: boolean;
}

export interface StartMockOptions extends Omit<MockOptions, 'routes' | 'components' | 'info'> {
  from: string;
  port?: number;
  host?: string;
}

export interface MockHandle {
  app: any;
  server: any;
  info: { title?: string; version?: string };
  routeCount: number;
}

export function createMockApp(options: MockOptions): any;
export function startMockFromOpenApi(options: StartMockOptions): Promise<MockHandle>;
export function loadOpenApiDoc(from: string): Promise<any>;
export function buildRoutesFromDoc(doc: any): {
  routes: MockRouteDescriptor[];
  components: Record<string, any>;
  info: { title?: string; version?: string };
};

export class CrudStore {
  constructor(options?: { persistPath?: string });
  list(name: string): any[];
  get(name: string, id: string | number): any | null;
  create(name: string, body: any): any;
  update(name: string, id: string | number, body: any): any | null;
  replace(name: string, id: string | number, body: any): any;
  delete(name: string, id: string | number): boolean;
  seed(name: string, items: any[]): void;
}

export function resourceFromPath(routePath: string): string | null;
