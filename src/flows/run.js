'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const { validateFlow, isPlainObject } = require('./validate');
const { templateValue } = require('./template');
const { extractValues } = require('./extract');
const { assertResponse } = require('./assert');

function mergeContexts(flow, options) {
  return {
    env: Object.assign({}, flow.env || {}, options.env || {}),
    input: Object.assign({}, options.input || {}),
    vars: {},
    step: {},
  };
}

function assertRequiredInputs(flow, context) {
  for (const [name, definition] of Object.entries(flow.inputs || {})) {
    if (!definition || !definition.required) continue;
    if (context.input[name] === undefined) {
      throw new Error(`Flow input "${name}" is required.`);
    }
  }
}

function ensureAbsoluteUrl(baseUrl, path, query) {
  const url = new URL(path, baseUrl);

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  return url;
}

function parseResponseBody(text, contentType) {
  if (!text) return null;
  if (contentType && contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return text;
    }
  }
  return text;
}

function executeHttpRequest(request, fetchImpl) {
  if (typeof fetchImpl === 'function') {
    return fetchImpl(request);
  }

  return new Promise(function (resolve, reject) {
    const transport = request.url.protocol === 'https:' ? https : http;
    const startedAt = Date.now();
    const req = transport.request(request.url, {
      method: request.method,
      headers: request.headers,
    }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers || {},
          body: parseResponseBody(body, String(res.headers['content-type'] || '')),
          rawBody: body,
          durationMs: Date.now() - startedAt,
        });
      });
    });

    req.on('error', reject);

    if (request.body !== undefined) {
      req.write(request.body);
    }

    req.end();
  });
}

function buildStepRequest(step, context, baseUrl) {
  const request = templateValue(step.request, context);
  const method = String(request.method).toUpperCase();
  const query = isPlainObject(request.query) ? request.query : null;
  const headers = Object.assign({}, request.headers || {});
  let body;

  if (request.body !== undefined) {
    if (isPlainObject(request.body) || Array.isArray(request.body)) {
      body = JSON.stringify(request.body);
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
      }
    } else if (request.body !== null) {
      body = String(request.body);
    }
  }

  const url = ensureAbsoluteUrl(baseUrl, request.path, query);

  return {
    method,
    url,
    headers,
    body,
    query,
    path: request.path,
  };
}

function serializeRequest(request) {
  return {
    method: request.method,
    url: String(request.url),
    path: request.path,
    query: request.query || null,
    headers: request.headers || {},
    body: request.body || null,
  };
}

function serializeResponse(response) {
  return {
    status: response.status,
    headers: response.headers || {},
    body: response.body === undefined ? null : response.body,
    rawBody: response.rawBody === undefined ? null : response.rawBody,
    durationMs: response.durationMs,
  };
}

async function runFlow(flow, options) {
  const validated = validateFlow(flow);
  const runtime = options || {};
  const context = mergeContexts(validated, runtime);
  assertRequiredInputs(validated, context);
  const baseUrl = templateValue(runtime.baseUrl || validated.baseUrl || context.env.baseUrl, context);

  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('Flow execution requires a baseUrl via flow.baseUrl, env.baseUrl, or options.baseUrl.');
  }

  const bail = runtime.bail !== false;
  const steps = [];
  const startedAt = Date.now();

  for (const step of validated.steps) {
    const stepStartedAt = Date.now();
    let serializedRequest = null;
    let serializedResponse = null;

    try {
      const request = buildStepRequest(step, context, baseUrl);
      serializedRequest = serializeRequest(request);
      const response = await executeHttpRequest(request, runtime.fetchImpl);
      serializedResponse = serializeResponse(response);

      assertResponse(step.assert, response, context);

      const extracted = extractValues(step.extract, response);
      Object.assign(context.vars, extracted);
      context.step[step.id] = {
        request: serializedRequest,
        response: serializedResponse,
        extracted,
      };

      steps.push({
        id: step.id,
        name: step.name || step.id,
        ok: true,
        status: response.status,
        durationMs: response.durationMs,
        extracted,
        request: serializedRequest,
        response: serializedResponse,
      });
    } catch (error) {
      const failedStep = {
        id: step.id,
        name: step.name || step.id,
        ok: false,
        status: serializedResponse ? serializedResponse.status : null,
        durationMs: Date.now() - stepStartedAt,
        extracted: {},
        request: serializedRequest,
        response: serializedResponse,
        error: error && error.message ? error.message : String(error),
      };

      steps.push(failedStep);

      if (bail) {
        return {
          ok: false,
          flow: validated.name,
          durationMs: Date.now() - startedAt,
          steps,
          vars: Object.assign({}, context.vars),
          error: failedStep.error,
        };
      }
    }
  }

  return {
    ok: steps.every(function (step) { return step.ok; }),
    flow: validated.name,
    durationMs: Date.now() - startedAt,
    steps,
    vars: Object.assign({}, context.vars),
  };
}

module.exports = {
  runFlow,
  buildStepRequest,
  executeHttpRequest,
};
