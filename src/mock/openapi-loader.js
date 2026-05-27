'use strict';

/**
 * OpenAPI 3.x → mock route list.
 *
 * Reads a parsed OpenAPI document and emits an array of route descriptors the
 * mock server (src/mock/server.js) can serve. We deliberately stay shallow on
 * `$ref`s — the example generator resolves them lazily via the `components`
 * map passed alongside each route.
 *
 * Output shape (per route):
 *
 *   {
 *     method: 'GET',
 *     path: '/users/:id',          // express-style
 *     openapiPath: '/users/{id}',  // original
 *     operationId: 'getUser',
 *     summary, description, tags,
 *     pathParams: [{ name, schema }],
 *     query:      [{ name, schema, required }],
 *     headers:    [{ name, schema, required }],
 *     requestBody:  { schema, example?, examples? } | null,
 *     responses: {
 *       '200': { schema?, example?, examples?, description?, headers? },
 *       ...
 *     },
 *     successStatus: '200' | '201' | …,
 *     components: { … }  // shared reference, same Map for every route
 *   }
 */

async function loadOpenApiDoc(from) {
  const fs = require('fs');
  const path = require('path');

  // Heuristic: anything starting with http(s):// is a URL.
  if (/^https?:\/\//i.test(from)) {
    if (typeof fetch !== 'function') {
      throw new Error('global fetch() is not available. doctreen mock requires Node 18+.');
    }
    // Allow either a bare docs URL or a direct openapi.json URL.
    const url = from.endsWith('/openapi.json') || from.endsWith('.json')
      ? from
      : from.replace(/\/+$/, '') + '/openapi.json';
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new Error('GET ' + url + ' → ' + res.status + ' ' + res.statusText);
    }
    return await res.json();
  }

  const abs = path.resolve(from);
  const raw = fs.readFileSync(abs, 'utf8');
  return JSON.parse(raw);
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];

function toExpressPath(openapiPath) {
  return openapiPath.replace(/\{([^}]+)\}/g, ':$1');
}

function extractParamNames(openapiPath) {
  const out = [];
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(openapiPath))) out.push(m[1]);
  return out;
}

/** Pick the success status: prefer 200, then 201, then any 2xx. */
function pickSuccessStatus(responses) {
  if (!responses) return null;
  const codes = Object.keys(responses);
  if (codes.indexOf('200') !== -1) return '200';
  if (codes.indexOf('201') !== -1) return '201';
  for (const c of codes) {
    if (/^2\d\d$/.test(c)) return c;
  }
  if (codes.indexOf('default') !== -1) return 'default';
  return null;
}

/** Extract media type entry from a Request Body or Response Object. */
function pickMediaType(content) {
  if (!content || typeof content !== 'object') return null;
  // Prefer application/json, then JSON-suffixed, then first.
  if (content['application/json']) return content['application/json'];
  for (const k of Object.keys(content)) {
    if (/\+json$/i.test(k)) return content[k];
  }
  const first = Object.keys(content)[0];
  return first ? content[first] : null;
}

function buildResponseEntry(responseObj) {
  const out = { description: responseObj.description || null };
  const media = pickMediaType(responseObj.content);
  if (media) {
    if (media.schema) out.schema = media.schema;
    if (media.example !== undefined) out.example = media.example;
    if (media.examples) out.examples = media.examples;
  }
  if (responseObj.headers) out.headers = responseObj.headers;
  return out;
}

function buildRoute(openapiPath, method, operation, doc) {
  const expressPath = toExpressPath(openapiPath);
  const params = extractParamNames(openapiPath);

  // Combine path-level + operation-level parameters.
  const pathItem = doc.paths[openapiPath] || {};
  const allParams = []
    .concat(pathItem.parameters || [])
    .concat(operation.parameters || []);

  const pathParams = [];
  const query = [];
  const headers = [];
  for (const p of allParams) {
    if (!p || !p.in) continue;
    const entry = {
      name: p.name,
      schema: p.schema || null,
      required: Boolean(p.required),
      example: p.example,
    };
    if (p.in === 'path') pathParams.push(entry);
    else if (p.in === 'query') query.push(entry);
    else if (p.in === 'header') headers.push(entry);
    // cookie params are ignored — mock server doesn't enforce them.
  }

  // Request body.
  let requestBody = null;
  if (operation.requestBody) {
    const media = pickMediaType(operation.requestBody.content);
    if (media) {
      requestBody = { schema: media.schema || null };
      if (media.example !== undefined) requestBody.example = media.example;
      if (media.examples) requestBody.examples = media.examples;
    }
  }

  // Responses.
  const responses = {};
  const rawResponses = operation.responses || {};
  for (const code of Object.keys(rawResponses)) {
    responses[code] = buildResponseEntry(rawResponses[code]);
  }

  return {
    method: method.toUpperCase(),
    path: expressPath,
    openapiPath: openapiPath,
    operationId: operation.operationId || null,
    summary: operation.summary || null,
    description: operation.description || null,
    tags: Array.isArray(operation.tags) ? operation.tags : [],
    pathParams: pathParams,
    query: query,
    headers: headers,
    requestBody: requestBody,
    responses: responses,
    successStatus: pickSuccessStatus(responses),
    deprecated: Boolean(operation.deprecated),
    _paramNames: params,
  };
}

/**
 * @param {object} doc - parsed OpenAPI 3.x document
 * @returns {{ routes: object[], components: object, info: object }}
 */
function buildRoutesFromDoc(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('OpenAPI document is empty or not an object');
  }
  if (!doc.paths || typeof doc.paths !== 'object') {
    throw new Error('OpenAPI document has no `paths` block');
  }

  const components = (doc.components && doc.components.schemas) || {};
  const routes = [];

  for (const openapiPath of Object.keys(doc.paths)) {
    const pathItem = doc.paths[openapiPath];
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      routes.push(buildRoute(openapiPath, method, operation, doc));
    }
  }

  return {
    routes: routes,
    components: components,
    info: doc.info || { title: 'Mock API', version: '0.0.0' },
  };
}

module.exports = {
  loadOpenApiDoc,
  buildRoutesFromDoc,
  toExpressPath,
};
