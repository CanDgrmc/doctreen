'use strict';

/**
 * OpenAPI 3.x linter (v1.11+).
 *
 * Intentionally minimal — covers the high-signal issues that bite users
 * before they reach Spectral/Redocly. Three severities:
 *
 *   error    — almost certainly broken: blocks code-gen, doc renderers will
 *              crash, or duplicate operationIds collide
 *   warning  — valid OpenAPI but poor DX: missing summaries, no 4xx response,
 *              tag used without metadata
 *   info     — stylistic / opportunistic: untagged operations, unused
 *              components.schemas entries
 *
 * Add new rules by appending to the `RULES` array — each is a pure function
 * `(doc) => Array<Issue>`. The CLI prints whatever the linter returns; this
 * module never throws on bad input.
 */

/**
 * @typedef {{ code: string, severity: 'error'|'warning'|'info', message: string, path?: string }} Issue
 */

// ─── Rules ──────────────────────────────────────────────────────────────────

/** info.title and info.version are required by the spec. */
function ruleInfoRequired(doc) {
  const issues = [];
  if (!doc.info || typeof doc.info !== 'object') {
    issues.push({ code: 'info-missing', severity: 'error', message: '`info` object missing' });
    return issues;
  }
  if (!doc.info.title || typeof doc.info.title !== 'string') {
    issues.push({ code: 'info-title-missing', severity: 'error', message: '`info.title` is required', path: 'info.title' });
  }
  if (!doc.info.version || typeof doc.info.version !== 'string') {
    issues.push({ code: 'info-version-missing', severity: 'error', message: '`info.version` is required', path: 'info.version' });
  }
  return issues;
}

/** Operations must declare at least one response. */
function ruleResponsesRequired(doc) {
  const issues = [];
  forEachOperation(doc, function (op, path) {
    if (!op.responses || Object.keys(op.responses).length === 0) {
      issues.push({
        code: 'operation-responses-missing',
        severity: 'error',
        message: 'Operation has no `responses` defined',
        path: path,
      });
    }
  });
  return issues;
}

/** operationId must be unique across the whole document. */
function ruleOperationIdUnique(doc) {
  const issues = [];
  const seen = new Map();
  forEachOperation(doc, function (op, path) {
    if (!op.operationId) return;
    const prev = seen.get(op.operationId);
    if (prev) {
      issues.push({
        code: 'operationid-duplicate',
        severity: 'error',
        message: 'Duplicate operationId `' + op.operationId + '` (first seen at ' + prev + ')',
        path: path,
      });
    } else {
      seen.set(op.operationId, path);
    }
  });
  return issues;
}

/** Each operation should have a human-readable summary. */
function ruleSummaryPresent(doc) {
  const issues = [];
  forEachOperation(doc, function (op, path) {
    if (!op.summary || typeof op.summary !== 'string' || op.summary.trim() === '') {
      issues.push({
        code: 'operation-summary-missing',
        severity: 'warning',
        message: 'Operation has no `summary` — UIs will fall back to the path',
        path: path,
      });
    }
  });
  return issues;
}

/**
 * Each operation should document at least one 4xx response. Routes routinely
 * return 400/401/404/422 etc.; without these declared, consumers can't tell
 * the API apart from one that never fails.
 */
function ruleHas4xxResponse(doc) {
  const issues = [];
  forEachOperation(doc, function (op, path) {
    if (!op.responses) return;
    const has4xx = Object.keys(op.responses).some(function (code) {
      const n = Number(code);
      return n >= 400 && n < 500;
    });
    if (!has4xx) {
      issues.push({
        code: 'operation-4xx-missing',
        severity: 'warning',
        message: 'Operation declares no 4xx response — error contract is invisible to consumers',
        path: path,
      });
    }
  });
  return issues;
}

/**
 * Tags referenced by operations should ideally be declared at the doc level
 * with a description. The exporter auto-fills the names, but missing
 * description = poor DX in Redoc/Scalar sidebars.
 */
function ruleTagsDocumented(doc) {
  const issues = [];
  const declared = new Map();
  if (Array.isArray(doc.tags)) {
    for (const t of doc.tags) {
      if (t && typeof t.name === 'string') declared.set(t.name, t);
    }
  }

  const used = new Set();
  forEachOperation(doc, function (op) {
    if (Array.isArray(op.tags)) {
      for (const t of op.tags) used.add(t);
    }
  });

  for (const tag of used) {
    const meta = declared.get(tag);
    if (!meta || typeof meta.description !== 'string' || meta.description.trim() === '') {
      issues.push({
        code: 'tag-description-missing',
        severity: 'warning',
        message: 'Tag `' + tag + '` has no description — add it to `openapi.tags` for richer sidebars',
        path: 'tags',
      });
    }
  }
  return issues;
}

/** Operations should be tagged so renderers can group them. */
function ruleOperationTagged(doc) {
  const issues = [];
  forEachOperation(doc, function (op, path) {
    if (!Array.isArray(op.tags) || op.tags.length === 0) {
      issues.push({
        code: 'operation-untagged',
        severity: 'info',
        message: 'Operation has no tags — will land in the "default" group',
        path: path,
      });
    }
  });
  return issues;
}

/** Each declared path parameter must appear in the path template. */
function rulePathParamConsistency(doc) {
  const issues = [];
  if (!doc.paths || typeof doc.paths !== 'object') return issues;

  for (const route of Object.keys(doc.paths)) {
    const pathItem = doc.paths[route];
    if (!pathItem || typeof pathItem !== 'object') continue;
    const declaredInPath = matchTemplate(route);

    for (const method of Object.keys(pathItem)) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      const params = Array.isArray(op.parameters) ? op.parameters : [];
      for (const p of params) {
        if (p && p.in === 'path') {
          if (!declaredInPath.has(p.name)) {
            issues.push({
              code: 'path-param-undeclared',
              severity: 'error',
              message: 'Operation declares path param `' + p.name + '` not present in path template',
              path: route + '.' + method,
            });
          }
        }
      }
      for (const name of declaredInPath) {
        const found = params.some(function (p) { return p && p.in === 'path' && p.name === name; });
        if (!found) {
          issues.push({
            code: 'path-param-missing',
            severity: 'error',
            message: 'Path template requires param `' + name + '` but operation does not declare it',
            path: route + '.' + method,
          });
        }
      }
    }
  }
  return issues;
}

/** `components.schemas` entries that are never `$ref`'d anywhere. */
function ruleUnusedComponents(doc) {
  const issues = [];
  if (!doc.components || !doc.components.schemas) return issues;
  const declared = Object.keys(doc.components.schemas);
  if (declared.length === 0) return issues;

  const referenced = new Set();
  collectRefs(doc.paths, referenced);
  collectRefs(doc.webhooks, referenced);
  collectRefs(doc.components.schemas, referenced); // refs between components

  for (const name of declared) {
    if (!referenced.has('#/components/schemas/' + name)) {
      issues.push({
        code: 'components-schema-unused',
        severity: 'info',
        message: 'Component schema `' + name + '` is declared but never referenced',
        path: 'components.schemas.' + name,
      });
    }
  }
  return issues;
}

const RULES = [
  ruleInfoRequired,
  ruleResponsesRequired,
  ruleOperationIdUnique,
  ruleSummaryPresent,
  ruleHas4xxResponse,
  ruleTagsDocumented,
  ruleOperationTagged,
  rulePathParamConsistency,
  ruleUnusedComponents,
];

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * Lint an OpenAPI document. Pure function — never throws.
 *
 * @param {object} doc
 * @returns {{ issues: Issue[], counts: { error: number, warning: number, info: number } }}
 */
function lintOpenApiDocument(doc) {
  const issues = [];
  if (!doc || typeof doc !== 'object') {
    issues.push({ code: 'document-invalid', severity: 'error', message: 'Linter input is not an object' });
    return { issues: issues, counts: { error: 1, warning: 0, info: 0 } };
  }
  for (const rule of RULES) {
    try {
      const ruleIssues = rule(doc);
      if (Array.isArray(ruleIssues)) {
        for (const i of ruleIssues) issues.push(i);
      }
    } catch (err) {
      issues.push({
        code: 'lint-rule-crashed',
        severity: 'warning',
        message: 'Lint rule threw: ' + (err && err.message || err),
      });
    }
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;
  return { issues: issues, counts: counts };
}

// ─── Internals ──────────────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];

function forEachOperation(doc, fn) {
  if (!doc.paths || typeof doc.paths !== 'object') return;
  for (const route of Object.keys(doc.paths)) {
    const pathItem = doc.paths[route];
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (op && typeof op === 'object') {
        fn(op, route + '.' + method);
      }
    }
  }
}

function matchTemplate(routePath) {
  const out = new Set();
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(routePath)) !== null) out.add(m[1]);
  return out;
}

function collectRefs(node, into) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const x of node) collectRefs(x, into);
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (k === '$ref' && typeof node[k] === 'string') into.add(node[k]);
      else collectRefs(node[k], into);
    }
  }
}

module.exports = { lintOpenApiDocument: lintOpenApiDocument };
