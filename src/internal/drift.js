'use strict';

/**
 * Schema Drift Detection — comparator + pipeline.
 *
 * Promoted from experimental (v1.5) to production-grade (v1.10). This module
 * is now the *comparator*: it diffs an actual payload against a declared
 * SchemaNode and returns structured issues. Aggregation, sampling, webhook
 * dispatch, and reporting live in `./drift-store.js`.
 *
 * Drift kinds:
 *   - missing-required   declared property missing in payload
 *   - unexpected-field   payload property not declared in schema
 *   - type-mismatch      declared type differs from actual JS typeof
 *
 * Top-level shape comparison only — does not recurse into nested objects.
 * Recursive comparison was considered but trades simplicity for false-positive
 * noise on partially-typed responses; revisit when usage warrants.
 */

const { createMemoryStore, makeEvent, shouldSample, _resetWarnDedup } = require('./drift-store');

/**
 * Map a JS value to one of the SchemaNode primitive type strings.
 * @param {any} v
 * @returns {string}
 */
function actualType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  return 'unknown';
}

/**
 * Diffs an actual payload against a SchemaNode (top-level only).
 *
 * @param {any} declared     A SchemaNode — typically `entry.requestSchema.body`.
 * @param {any} actual       The actual payload — `req.body` or `req.query`.
 * @returns {Array<{ kind: string, field: string, expected?: string, got?: string }>}
 */
function diffShape(declared, actual) {
  /** @type {Array<{ kind: string, field: string, expected?: string, got?: string }>} */
  const issues = [];
  if (!declared || typeof declared !== 'object') return issues;
  if (actual == null || typeof actual !== 'object' || Array.isArray(actual)) return issues;

  // Only compare object-typed declared schemas — primitive declared bodies
  // aren't useful for top-level drift.
  if (declared.type !== 'object' || !declared.properties) return issues;

  const declaredProps = declared.properties;

  for (const key of Object.keys(declaredProps)) {
    const propSchema = declaredProps[key];
    const isOptional = propSchema && propSchema.optional === true;
    if (!(key in actual)) {
      if (!isOptional) issues.push({ kind: 'missing-required', field: key, expected: propSchema && propSchema.type });
      continue;
    }
    const expected = propSchema && propSchema.type;
    const got = actualType(actual[key]);
    // Tolerate numeric strings in query parameters since most frameworks
    // surface query values as strings until parsed.
    if (expected && expected !== 'unknown' && got !== expected &&
        !(expected === 'number' && got === 'string' && !isNaN(Number(actual[key])))) {
      issues.push({ kind: 'type-mismatch', field: key, expected: expected, got: got });
    }
  }

  for (const key of Object.keys(actual)) {
    if (!(key in declaredProps)) {
      issues.push({ kind: 'unexpected-field', field: key, got: actualType(actual[key]) });
    }
  }

  return issues;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Build a drift pipeline from a normalised config block. Returns an object
 * with `recordIfDrift(route, part, declared, actual)` that adapters call. The
 * pipeline owns sampling, store dispatch, and exposes the store for the
 * `/docs/drift.json` endpoint.
 *
 * @param {import('../index').NormalizedConfig} config
 * @returns {{ enabled: boolean, recordIfDrift: Function, report: Function, reset: Function, store: any }}
 */
function createDriftPipeline(config) {
  const driftCfg = (config && config.drift) || {};
  const enabled = driftCfg.enabled !== false; // default on when block exists

  if (!enabled) {
    return {
      enabled: false,
      recordIfDrift: function () {},
      report: function () { return { generatedAt: Date.now(), totalIssues: 0, routes: [] }; },
      reset: function () {},
      store: null,
    };
  }

  const store = (driftCfg.store && typeof driftCfg.store.record === 'function')
    ? driftCfg.store
    : createMemoryStore({
        maxSamples: driftCfg.maxSamples,
        webhook: driftCfg.webhook,
        onDrift: driftCfg.onDrift,
        logLevel: driftCfg.logLevel,
      });

  const sampleRate = typeof driftCfg.sampleRate === 'number' ? driftCfg.sampleRate : 0.01;

  function recordIfDrift(route, part, declared, actual) {
    if (!declared || !actual) return;
    if (!shouldSample(sampleRate)) return;
    const issues = diffShape(declared, actual);
    if (issues.length === 0) return;
    store.record(makeEvent(route.method, route.path, part, issues));
  }

  return {
    enabled: true,
    recordIfDrift: recordIfDrift,
    report: function () { return store.report(); },
    reset: function () { return store.reset(); },
    store: store,
  };
}

module.exports = {
  diffShape: diffShape,
  createDriftPipeline: createDriftPipeline,
  _resetDriftCache: _resetWarnDedup,
};
