export interface FlowInputDefinition {
  type?: string;
  required?: boolean;
}

export interface FlowExtractRule {
  from: 'body' | 'header' | 'status';
  path?: string;
}

export interface FlowAssertSpec {
  status?: number;
  maxDurationMs?: number;
  headers?: Record<string, unknown>;
  body?: Record<string, unknown>;
  exists?: string[];
}

export interface FlowRequestSpec {
  method: string;
  path: string;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface FlowStep {
  id: string;
  name?: string;
  request: FlowRequestSpec;
  extract?: Record<string, FlowExtractRule>;
  assert?: FlowAssertSpec;
}

export interface FlowDefinition {
  version: 1;
  name: string;
  description?: string;
  baseUrl?: string;
  env?: Record<string, unknown>;
  inputs?: Record<string, FlowInputDefinition>;
  steps: FlowStep[];
}

export interface FlowStepResult {
  id: string;
  name: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
  extracted: Record<string, unknown>;
  request: {
    method: string;
    url: string;
    path: string;
    query: Record<string, unknown> | null;
    headers: Record<string, unknown>;
    body: string | null;
  } | null;
  response: {
    status: number;
    headers: Record<string, unknown>;
    body: unknown;
    rawBody: string | null;
    durationMs: number;
  } | null;
  error?: string;
}

export interface FlowRunResult {
  ok: boolean;
  flow: string;
  durationMs: number;
  steps: FlowStepResult[];
  vars: Record<string, unknown>;
  error?: string;
}

export interface LoadedJsonFile<T = unknown> {
  path: string;
  data: T;
}

export interface RunFlowOptions {
  baseUrl?: string;
  env?: Record<string, unknown>;
  input?: Record<string, unknown>;
  bail?: boolean;
  fetchImpl?: (request: {
    method: string;
    url: URL;
    headers: Record<string, unknown>;
    body?: string;
  }) => Promise<{
    status: number;
    headers?: Record<string, unknown>;
    body?: unknown;
    rawBody?: string;
    durationMs: number;
  }>;
}

export declare function validateFlow(flow: FlowDefinition): FlowDefinition;
export declare function resolveReference(reference: string, context: Record<string, unknown>): unknown;
export declare function renderTemplateString(template: string, context: Record<string, unknown>): unknown;
export declare function templateValue<T = unknown>(value: T, context: Record<string, unknown>): T;
export declare function getValueAtPath(value: unknown, path: string): unknown;
export declare function extractValues(spec: Record<string, FlowExtractRule> | undefined, response: {
  status: number;
  headers?: Record<string, unknown>;
  body?: unknown;
}): Record<string, unknown>;
export declare function readJsonFile<T = unknown>(filePath: string): LoadedJsonFile<T>;
export declare function loadFlow(flowPath: string): LoadedJsonFile<FlowDefinition>;
export declare function resolveNamedEnvPath(flowPath: string, envName: string): string;
export declare function loadEnvironment(flowPath: string, envRef?: string | null): LoadedJsonFile<Record<string, unknown>> | { path: null; data: {} };
export declare function loadFlowDirectory(dirPath: string): Array<LoadedJsonFile<FlowDefinition>>;
export declare function resolveConfiguredFlows(config: { flows?: FlowDefinition[] | null; flowsPath?: string | null }): FlowDefinition[];
export declare function getUiFlows(config: { flows?: FlowDefinition[] | null; flowsPath?: string | null }): FlowDefinition[];
export declare function runFlowPayload(payload: {
  flow: FlowDefinition;
  input?: Record<string, unknown>;
  env?: Record<string, unknown>;
  baseUrl?: string;
  bail?: boolean;
}): Promise<FlowRunResult>;
export declare function assertResponse(assertSpec: FlowAssertSpec | undefined, response: {
  status: number;
  headers?: Record<string, unknown>;
  body?: unknown;
  durationMs: number;
}, context: Record<string, unknown>): void;
export declare function runFlow(flow: FlowDefinition, options?: RunFlowOptions): Promise<FlowRunResult>;
