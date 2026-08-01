#!/usr/bin/env node
// DocTreen conformance runner — Node reference implementation.
//
// Feeds every case in ../cases through buildOpenApiDocument() and compares the
// result to the case's expected/openapi.json. A failure here means the Node
// implementation changed behaviour that the Python port is written against.
//
// Usage:  node conformance/runners/node.mjs
// Expects to live at <repo>/conformance/runners/node.mjs.

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = resolve(HERE, '..', 'cases');
const SRC = process.env.DOCTREEN_SRC || resolve(HERE, '..', '..', 'src');

if (!existsSync(join(SRC, 'index.js'))) {
  console.error(`Cannot find the doctreen source at ${SRC}.`);
  console.error('Set DOCTREEN_SRC to the src/ directory of a doctreen checkout.');
  process.exit(2);
}

const idx = require(join(SRC, 'index.js'));
const { buildOpenApiDocument } = require(join(SRC, 'exporters', 'openapi.js'));

/** Replace every { "$named": "X" } with the schema registered under X. */
function resolveNamed(value, registry) {
  if (Array.isArray(value)) return value.map((v) => resolveNamed(v, registry));
  if (value && typeof value === 'object') {
    if (typeof value.$named === 'string') {
      const found = registry[value.$named];
      if (!found) throw new Error(`unknown $named reference: ${value.$named}`);
      return found;
    }
    const out = {};
    for (const k of Object.keys(value)) out[k] = resolveNamed(value[k], registry);
    return out;
  }
  return value;
}

/** First JSON-pointer path where two parsed documents differ, or null. */
function firstDiff(a, b, path = '') {
  if (a === b) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return { path, expected: a, actual: b };
  if (ta === 'array') {
    if (a.length !== b.length) return { path, expected: `array(${a.length})`, actual: `array(${b.length})` };
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}/${i}`);
      if (d) return d;
    }
    return null;
  }
  if (ta === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    // Key ORDER is part of the contract: the docs UI and the golden files
    // both depend on it, so compare the key lists as sequences.
    if (ka.join(',') !== kb.join(',')) return { path, expected: `keys[${ka}]`, actual: `keys[${kb}]` };
    for (const k of ka) {
      const d = firstDiff(a[k], b[k], `${path}/${k}`);
      if (d) return d;
    }
    return null;
  }
  return { path, expected: a, actual: b };
}

const dirs = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let failed = 0;
for (const dir of dirs) {
  const casePath = join(CASES_DIR, dir, 'case.json');
  const expectedPath = join(CASES_DIR, dir, 'expected', 'openapi.json');
  const spec = JSON.parse(readFileSync(casePath, 'utf8'));
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));

  const registry = {};
  for (const [name, node] of Object.entries(spec.namedSchemas || {})) {
    registry[name] = idx.defineSchema(name, node);
  }

  let actual;
  try {
    actual = buildOpenApiDocument(resolveNamed(spec.routes, registry), idx.normalizeConfig(spec.config));
  } catch (err) {
    console.log(`FAIL  ${dir} — threw: ${err.message}`);
    failed++;
    continue;
  }

  const diff = firstDiff(expected, JSON.parse(JSON.stringify(actual)));
  if (diff) {
    console.log(`FAIL  ${dir}`);
    console.log(`      at ${diff.path || '<root>'}`);
    console.log(`      expected: ${JSON.stringify(diff.expected)}`);
    console.log(`      actual:   ${JSON.stringify(diff.actual)}`);
    failed++;
  } else {
    console.log(`ok    ${dir}`);
  }
}

console.log(`\n${dirs.length - failed}/${dirs.length} conformance cases passed`);
process.exit(failed ? 1 : 0);
