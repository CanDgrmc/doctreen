'use strict';

/**
 * Shared OpenAPI → operation descriptor walker.
 *
 * Both the types generator and the client generator iterate the same set of
 * operations and need the same naming. Keeping the walker here means we can't
 * accidentally drift between the two outputs.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function pascalCase(parts) {
  return parts.filter(Boolean).map(function (p) {
    return String(p).charAt(0).toUpperCase() + String(p).slice(1);
  }).join('');
}

function camelCase(parts) {
  const filtered = parts.filter(Boolean).map(String);
  if (filtered.length === 0) return '';
  return filtered[0].charAt(0).toLowerCase() + filtered[0].slice(1) +
    filtered.slice(1).map(function (p) {
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join('');
}

function sanitizeIdParts(text) {
  return String(text).split(/[^A-Za-z0-9]+/).filter(Boolean);
}

function pathSegmentsToNameParts(path) {
  const segments = path.split('/').filter(Boolean);
  return segments.map(function (s) {
    const m = /^\{(.+?)\}$/.exec(s) || /^:(.+)$/.exec(s);
    if (m) return 'By' + sanitizeIdParts(m[1]).map(function (p, i) {
      return i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1);
    }).join('');
    return sanitizeIdParts(s).map(function (p, i) {
      return i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1);
    }).join('');
  });
}

function baseTypeName(method, path, operationId) {
  if (operationId) return pascalCase(sanitizeIdParts(operationId));
  return pascalCase([method.toLowerCase()].concat(pathSegmentsToNameParts(path)));
}

function clientFnName(method, path, operationId) {
  if (operationId) return camelCase(sanitizeIdParts(operationId));
  return camelCase([method.toLowerCase()].concat(pathSegmentsToNameParts(path)));
}

function pickSuccessCode(responses) {
  if (!responses) return null;
  if (responses['200']) return '200';
  if (responses['201']) return '201';
  for (const c of Object.keys(responses)) {
    if (/^2\d\d$/.test(c)) return c;
  }
  if (responses['default']) return 'default';
  return null;
}

function pickJsonMedia(content) {
  if (!content || typeof content !== 'object') return null;
  if (content['application/json']) return content['application/json'];
  for (const k of Object.keys(content)) {
    if (/\+json$/i.test(k)) return content[k];
  }
  return null;
}

function collectParameters(pathItem, op) {
  const all = [].concat(pathItem.parameters || []).concat(op.parameters || []);
  return {
    path: all.filter(function (p) { return p && p.in === 'path'; }),
    query: all.filter(function (p) { return p && p.in === 'query'; }),
    header: all.filter(function (p) { return p && p.in === 'header'; }),
  };
}

function operationDescriptors(doc) {
  const paths = doc.paths || {};
  const out = [];
  for (const path of Object.keys(paths)) {
    const pathItem = paths[path];
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      const params = collectParameters(pathItem, op);
      const reqMedia = op.requestBody ? pickJsonMedia(op.requestBody.content) : null;
      const successCode = pickSuccessCode(op.responses);
      const respMedia = successCode && op.responses[successCode]
        ? pickJsonMedia(op.responses[successCode].content)
        : null;
      out.push({
        method: method.toUpperCase(),
        path: path,
        baseName: baseTypeName(method, path, op.operationId),
        fnName: clientFnName(method, path, op.operationId),
        summary: op.summary || null,
        description: op.description || null,
        deprecated: Boolean(op.deprecated),
        params: params,
        requestBody: reqMedia && reqMedia.schema ? { schema: reqMedia.schema, required: !!(op.requestBody && op.requestBody.required) } : null,
        response: respMedia && respMedia.schema ? { code: successCode, schema: respMedia.schema } : null,
      });
    }
  }
  return out;
}

module.exports = {
  METHODS,
  pascalCase,
  camelCase,
  baseTypeName,
  clientFnName,
  operationDescriptors,
};
