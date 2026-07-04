#!/usr/bin/env node
'use strict';

/**
 * `doctreen` — umbrella CLI for repo-level operations.
 *
 * Subcommands:
 *   drift report  --url <docsUrl> [--fail-on-mismatch] [--json] [--min-issues N]
 *   drift reset   --url <docsUrl> [--token <token>] [--json]
 *   lint openapi  (--url <docsUrl> | --file <path>) [--json] [--fail-on warning|error]
 *   mock          --from <url|file> [--port N] [--latency ms[-ms]] [--error-rate p]
 *                 [--no-crud] [--no-faker] [--seed N] [--persist <file>] [--quiet]
 *   codegen types   --from <url|file> --out <path> [--watch [ms]]
 *   codegen client  --from <url|file> --out <path> [--base-url <url>]
 *                                                  [--types-import <path>] [--watch [ms]]
 *
 * `report` hits `<docsUrl>/drift.json` (or `<docsUrl>` if it already ends in
 * `/drift.json`) and prints a human-readable summary. With `--fail-on-mismatch`
 * it exits with code 1 when any drift is reported — the recommended invocation
 * for CI integration tests so PRs catch shape changes before they merge.
 *
 * `reset` POSTs to `<docsUrl>/drift/reset` and clears the in-memory store.
 * The server must opt in by setting `drift.allowReset: true`. If
 * `drift.resetToken` is configured, pass `--token <token>` to authenticate.
 *
 * Run with: `npx doctreen drift report --url http://localhost:3000/docs`
 */

const PROGRAM = 'doctreen';

function printRootUsage() {
  console.error('Usage: ' + PROGRAM + ' <command> [options]');
  console.error('');
  console.error('Commands:');
  console.error('  drift report   Print a schema drift report from a running server');
  console.error('  drift reset    Clear the in-memory drift store on a running server');
  console.error('  lint openapi   Lint an OpenAPI 3.x document (live URL or local file)');
  console.error('  mock           Serve a fake API from an OpenAPI document (faker-backed)');
  console.error('  codegen types  Generate TypeScript type declarations from an OpenAPI doc');
  console.error('  codegen client Generate a typed fetch client from an OpenAPI doc');
  console.error('  emit-openapi   Build a static openapi.json from your app (offline, no server)');
  console.error('');
  console.error('Run `' + PROGRAM + ' <command> --help` for command-specific options.');
}

function printLintOpenApiUsage() {
  console.error('Usage: ' + PROGRAM + ' lint openapi (--url <docsUrl> | --file <path>) [options]');
  console.error('');
  console.error('Lints an OpenAPI 3.x document for duplicate operationIds, missing 4xx');
  console.error('responses, undeclared path params, unused components.schemas, etc.');
  console.error('');
  console.error('Options:');
  console.error('  --url <docsUrl>       Live docs URL (fetches `${docsUrl}/openapi.json`)');
  console.error('  --file <path>         Path to a local JSON or YAML-as-JSON file');
  console.error('  --fail-on <level>     `error` (default) or `warning` — exit code 1 when present');
  console.error('  --json                Print raw JSON output');
  console.error('  --no-info             Suppress `info` severity issues from the table');
  console.error('  -h, --help            Show this help');
}

function printMockUsage() {
  console.error('Usage: ' + PROGRAM + ' mock --from <url|file> [options]');
  console.error('');
  console.error('Serve an Express-backed mock API from an OpenAPI 3.x document. Routes,');
  console.error('schemas, and examples are read from the spec; responses are synthesised');
  console.error('via the same schema→example generator that powers the docs UI. When');
  console.error('`@faker-js/faker` is installed, fields with known names (email, name,');
  console.error('uuid, …) get realistic values; otherwise output is a stable placeholder.');
  console.error('');
  console.error('CRUD short-circuits are on by default: POST creates rows in an in-memory');
  console.error('store keyed by the first non-version path segment; GET / PUT / PATCH /');
  console.error('DELETE on `/users/:id`-style routes read or mutate that store.');
  console.error('');
  console.error('Options:');
  console.error('  --from <src>          URL (auto-appends /openapi.json) or local JSON file (required)');
  console.error('  --port <n>            Port to listen on (default 4000)');
  console.error('  --host <addr>         Host to bind (default 0.0.0.0)');
  console.error('  --latency <ms|a-b>    Fixed delay or random ms range (e.g. 100-500)');
  console.error('  --error-rate <p>      0..1 probability of returning a declared error response');
  console.error('  --seed <n>            Faker seed for deterministic output');
  console.error('  --persist <file>      JSON file to persist CRUD state across restarts');
  console.error('  --no-crud             Disable in-memory CRUD (always return schema examples)');
  console.error('  --no-faker            Disable Faker (use placeholder strings/numbers)');
  console.error('  --quiet               Suppress per-request log lines');
  console.error('  -h, --help            Show this help');
}

function printDriftReportUsage() {
  console.error('Usage: ' + PROGRAM + ' drift report --url <docsUrl> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --url <docsUrl>       URL to the docs root or directly to drift.json (required)');
  console.error('  --fail-on-mismatch    Exit 1 when any drift is present');
  console.error('  --min-issues <N>      Only fail when total issues >= N (default 1)');
  console.error('  --json                Print the raw JSON report instead of a table');
  console.error('  --route <pattern>     Filter rows by path substring');
  console.error('  -h, --help            Show this help');
}

function printDriftResetUsage() {
  console.error('Usage: ' + PROGRAM + ' drift reset --url <docsUrl> [options]');
  console.error('');
  console.error('POST <docsUrl>/drift/reset to clear the in-memory drift store.');
  console.error('Requires `drift.allowReset: true` on the server.');
  console.error('');
  console.error('Options:');
  console.error('  --url <docsUrl>       URL to the docs root (required)');
  console.error('  --token <token>       Reset token (when drift.resetToken is set server-side)');
  console.error('  --json                Print the raw JSON response');
  console.error('  -h, --help            Show this help');
}

function printCodegenUsage() {
  console.error('Usage: ' + PROGRAM + ' codegen <types|client> --from <url|file> --out <path> [options]');
  console.error('');
  console.error('Reads an OpenAPI 3.x document and emits TypeScript:');
  console.error('  types   → a `.d.ts` file with one interface per `components.schemas` entry');
  console.error('            plus per-operation Params/Query/Body/Response shapes.');
  console.error('  client  → a `.ts` file exporting `createClient({ baseUrl, fetch?, headers? })`');
  console.error('            with one fully-typed async method per operation.');
  console.error('');
  console.error('Options:');
  console.error('  --from <src>           URL (auto-appends /openapi.json) or local JSON file (required)');
  console.error('  --out <path>           Output file path (required)');
  console.error('  --base-url <url>       Default baseUrl baked into the generated client (client only)');
  console.error('  --types-import <path>  Module path the client imports types from (default `./types`)');
  console.error('  --watch [ms]           Re-generate on change. For URL sources polls every <ms>');
  console.error('                          (default 2000); for files watches via fs.watch.');
  console.error('  -h, --help             Show this help');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    return { command: 'help' };
  }
  const cmd = args.shift();
  if (cmd === 'drift') {
    const sub = args.shift();
    if (sub === 'report') {
      const opts = { json: false, failOnMismatch: false, minIssues: 1, url: null, route: null };
      while (args.length) {
        const a = args.shift();
        if (a === '--url') opts.url = args.shift();
        else if (a === '--fail-on-mismatch') opts.failOnMismatch = true;
        else if (a === '--json') opts.json = true;
        else if (a === '--min-issues') opts.minIssues = parseInt(args.shift(), 10) || 1;
        else if (a === '--route') opts.route = args.shift();
        else if (a === '-h' || a === '--help') return { command: 'drift-report-help' };
        else { console.error('Unknown option: ' + a); return { command: 'drift-report-help', error: true }; }
      }
      return { command: 'drift-report', opts: opts };
    }
    if (sub === 'reset') {
      const opts = { json: false, url: null, token: null };
      while (args.length) {
        const a = args.shift();
        if (a === '--url') opts.url = args.shift();
        else if (a === '--token') opts.token = args.shift();
        else if (a === '--json') opts.json = true;
        else if (a === '-h' || a === '--help') return { command: 'drift-reset-help' };
        else { console.error('Unknown option: ' + a); return { command: 'drift-reset-help', error: true }; }
      }
      return { command: 'drift-reset', opts: opts };
    }
    return { command: 'drift-help', error: true };
  }
  if (cmd === 'mock') {
    const opts = {
      from: null, port: 4000, host: '0.0.0.0',
      latency: 0, errorRate: 0, seed: undefined,
      persist: null, crud: true, faker: undefined,
      quiet: false,
    };
    while (args.length) {
      const a = args.shift();
      if (a === '--from') opts.from = args.shift();
      else if (a === '--port') opts.port = parseInt(args.shift(), 10) || 4000;
      else if (a === '--host') opts.host = args.shift();
      else if (a === '--latency') opts.latency = parseLatency(args.shift());
      else if (a === '--error-rate') opts.errorRate = parseFloat(args.shift()) || 0;
      else if (a === '--seed') opts.seed = parseInt(args.shift(), 10);
      else if (a === '--persist') opts.persist = args.shift();
      else if (a === '--no-crud') opts.crud = false;
      else if (a === '--no-faker') opts.faker = false;
      else if (a === '--quiet') opts.quiet = true;
      else if (a === '-h' || a === '--help') return { command: 'mock-help' };
      else { console.error('Unknown option: ' + a); return { command: 'mock-help', error: true }; }
    }
    return { command: 'mock', opts: opts };
  }
  if (cmd === 'emit-openapi' || cmd === 'emit') {
    const opts = { app: null, adapter: null, out: 'openapi.json', export: null, title: null, docVersion: null };
    while (args.length) {
      const a = args.shift();
      if (a === '--app') opts.app = args.shift();
      else if (a === '--adapter') opts.adapter = args.shift();
      else if (a === '--out') opts.out = args.shift();
      else if (a === '--export') opts.export = args.shift();
      else if (a === '--title') opts.title = args.shift();
      else if (a === '--doc-version') opts.docVersion = args.shift();
      else if (a === '-h' || a === '--help') return { command: 'emit-openapi-help' };
      else { console.error('Unknown option: ' + a); return { command: 'emit-openapi-help', error: true }; }
    }
    return { command: 'emit-openapi', opts: opts };
  }
  if (cmd === 'codegen') {
    const sub = args.shift();
    if (sub !== 'types' && sub !== 'client') return { command: 'codegen-help', error: true };
    const opts = {
      kind: sub,
      from: null,
      out: null,
      baseUrl: '',
      typesImport: './types',
      watch: false,
      watchMs: 2000,
    };
    while (args.length) {
      const a = args.shift();
      if (a === '--from') opts.from = args.shift();
      else if (a === '--out') opts.out = args.shift();
      else if (a === '--base-url') opts.baseUrl = args.shift() || '';
      else if (a === '--types-import') opts.typesImport = args.shift() || './types';
      else if (a === '--watch') {
        opts.watch = true;
        const next = args[0];
        if (next && /^\d+$/.test(next)) { opts.watchMs = parseInt(args.shift(), 10); }
      }
      else if (a === '-h' || a === '--help') return { command: 'codegen-help' };
      else { console.error('Unknown option: ' + a); return { command: 'codegen-help', error: true }; }
    }
    return { command: 'codegen', opts: opts };
  }
  if (cmd === 'lint') {
    const sub = args.shift();
    if (sub === 'openapi') {
      const opts = { url: null, file: null, json: false, failOn: 'error', hideInfo: false };
      while (args.length) {
        const a = args.shift();
        if (a === '--url') opts.url = args.shift();
        else if (a === '--file') opts.file = args.shift();
        else if (a === '--fail-on') opts.failOn = args.shift() || 'error';
        else if (a === '--json') opts.json = true;
        else if (a === '--no-info') opts.hideInfo = true;
        else if (a === '-h' || a === '--help') return { command: 'lint-openapi-help' };
        else { console.error('Unknown option: ' + a); return { command: 'lint-openapi-help', error: true }; }
      }
      return { command: 'lint-openapi', opts: opts };
    }
    return { command: 'help', error: true };
  }
  return { command: 'help', error: true };
}

function parseLatency(value) {
  if (!value) return 0;
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(value);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  return parseInt(value, 10) || 0;
}

async function runMock(opts) {
  if (!opts.from) {
    printMockUsage();
    process.exit(2);
  }
  let mock;
  try {
    mock = require('../src/mock');
  } catch (err) {
    console.error('Error loading doctreen mock module: ' + err.message);
    process.exit(2);
  }

  try {
    const handle = await mock.startMockFromOpenApi({
      from: opts.from,
      port: opts.port,
      host: opts.host,
      crud: opts.crud,
      faker: opts.faker,
      seed: opts.seed,
      latency: opts.latency,
      errorRate: opts.errorRate,
      persistPath: opts.persist,
      logRequests: !opts.quiet,
    });
    const addr = handle.server.address();
    const url = 'http://' + (opts.host === '0.0.0.0' ? 'localhost' : opts.host) + ':' + (addr && addr.port || opts.port);
    process.stdout.write('[doctreen mock] ' + (handle.info.title || 'Mock API') + ' v' + (handle.info.version || '0.0.0') + '\n');
    process.stdout.write('[doctreen mock] serving ' + handle.routeCount + ' route(s) at ' + url + '\n');
    if (opts.latency) {
      process.stdout.write('[doctreen mock] latency: ' + (Array.isArray(opts.latency) ? opts.latency.join('-') + 'ms' : opts.latency + 'ms') + '\n');
    }
    if (opts.errorRate) {
      process.stdout.write('[doctreen mock] error-rate: ' + opts.errorRate + '\n');
    }
    if (opts.persist) {
      process.stdout.write('[doctreen mock] persisting CRUD state to ' + opts.persist + '\n');
    }
    process.stdout.write('[doctreen mock] press Ctrl+C to stop\n');
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(2);
  }
}

async function fetchReport(url) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch() is not available. doctreen CLI requires Node 18+.');
  }
  const driftUrl = url.endsWith('/drift.json') ? url : url.replace(/\/+$/, '') + '/drift.json';
  const res = await fetch(driftUrl, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error('GET ' + driftUrl + ' → ' + res.status + ' ' + res.statusText);
  }
  return await res.json();
}

function formatTable(report, opts) {
  const routes = (report.routes || []).filter(function (r) {
    if (!opts.route) return true;
    return r.path.indexOf(opts.route) !== -1;
  });

  if (routes.length === 0) {
    return 'No drift detected. Total issues: ' + (report.totalIssues || 0) + '.';
  }

  const lines = [];
  lines.push('Schema drift report — ' + new Date(report.generatedAt).toISOString());
  lines.push('Total issues: ' + report.totalIssues + ' across ' + report.routes.length + ' route(s)');
  lines.push('');

  const cols = { method: 6, path: 30, total: 5, missing: 7, unexpected: 10, mismatch: 8 };
  for (const r of routes) {
    cols.method = Math.max(cols.method, r.method.length);
    cols.path = Math.max(cols.path, r.path.length);
  }
  cols.method = Math.min(cols.method, 8);
  cols.path = Math.min(cols.path, 60);

  function pad(s, w) {
    s = String(s);
    if (s.length >= w) return s.slice(0, w);
    return s + ' '.repeat(w - s.length);
  }

  lines.push(
    pad('METHOD', cols.method) + '  ' +
    pad('PATH', cols.path) + '  ' +
    pad('TOTAL', cols.total) + '  ' +
    pad('MISSING', cols.missing) + '  ' +
    pad('UNEXPECTED', cols.unexpected) + '  ' +
    pad('MISMATCH', cols.mismatch)
  );
  lines.push('-'.repeat(cols.method + cols.path + cols.total + cols.missing + cols.unexpected + cols.mismatch + 10));

  for (const r of routes) {
    lines.push(
      pad(r.method, cols.method) + '  ' +
      pad(r.path, cols.path) + '  ' +
      pad(r.total, cols.total) + '  ' +
      pad((r.kinds && r.kinds['missing-required']) || 0, cols.missing) + '  ' +
      pad((r.kinds && r.kinds['unexpected-field']) || 0, cols.unexpected) + '  ' +
      pad((r.kinds && r.kinds['type-mismatch']) || 0, cols.mismatch)
    );
  }

  // Top fields globally
  const fieldTotals = {};
  for (const r of routes) {
    for (const f of Object.keys(r.fields || {})) {
      fieldTotals[f] = (fieldTotals[f] || 0) + r.fields[f];
    }
  }
  const topFields = Object.keys(fieldTotals)
    .sort(function (a, b) { return fieldTotals[b] - fieldTotals[a]; })
    .slice(0, 5);
  if (topFields.length > 0) {
    lines.push('');
    lines.push('Top fields:');
    for (const f of topFields) lines.push('  ' + f + ' × ' + fieldTotals[f]);
  }

  return lines.join('\n');
}

async function runDriftReport(opts) {
  if (!opts.url) {
    printDriftUsage();
    process.exit(2);
  }

  let report;
  try {
    report = await fetchReport(opts.url);
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(2);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(formatTable(report, opts) + '\n');
  }

  if (opts.failOnMismatch && (report.totalIssues || 0) >= opts.minIssues) {
    process.exit(1);
  }
}

async function runDriftReset(opts) {
  if (!opts.url) {
    printDriftResetUsage();
    process.exit(2);
  }

  if (typeof fetch !== 'function') {
    console.error('Error: global fetch() is not available. doctreen CLI requires Node 18+.');
    process.exit(2);
  }

  const baseUrl = opts.url.endsWith('/drift/reset') ? opts.url : opts.url.replace(/\/+$/, '') + '/drift/reset';
  const headers = { accept: 'application/json' };
  if (opts.token) headers['x-doctreen-drift-token'] = opts.token;

  let res;
  try {
    res = await fetch(baseUrl, { method: 'POST', headers: headers });
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(2);
  }

  const body = await res.json().catch(function () { return null; });

  if (opts.json) {
    process.stdout.write(JSON.stringify(body || { ok: res.ok }, null, 2) + '\n');
  } else if (res.ok && body && body.ok) {
    process.stdout.write('Drift store cleared at ' + new Date(body.clearedAt).toISOString() + '\n');
  } else {
    process.stderr.write('Reset failed: ' + res.status + ' ' + (body && body.error || res.statusText) + '\n');
  }

  if (!res.ok || !body || !body.ok) process.exit(1);
}

async function runCodegen(opts) {
  if (!opts.from || !opts.out) {
    printCodegenUsage();
    process.exit(2);
  }

  const fs = require('fs');
  const path = require('path');
  const codegen = require('../src/codegen');

  async function generateOnce() {
    const doc = await codegen.loadOpenApiDoc(opts.from);
    const output = opts.kind === 'types'
      ? codegen.generateTypes(doc)
      : codegen.generateClient(doc, { baseUrl: opts.baseUrl, typesImportPath: opts.typesImport });
    const outPath = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    return { path: outPath, bytes: Buffer.byteLength(output, 'utf8') };
  }

  try {
    const res = await generateOnce();
    process.stdout.write('[doctreen codegen] wrote ' + res.path + ' (' + res.bytes + ' bytes)\n');
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(2);
  }

  if (!opts.watch) return;

  const isUrl = /^https?:\/\//i.test(opts.from);
  let lastOutput = null;
  try { lastOutput = require('fs').readFileSync(require('path').resolve(opts.out), 'utf8'); } catch (e) {}

  async function regen(reason) {
    try {
      const doc = await codegen.loadOpenApiDoc(opts.from);
      const output = opts.kind === 'types'
        ? codegen.generateTypes(doc)
        : codegen.generateClient(doc, { baseUrl: opts.baseUrl, typesImportPath: opts.typesImport });
      if (output === lastOutput) return;
      lastOutput = output;
      const outPath = require('path').resolve(opts.out);
      require('fs').writeFileSync(outPath, output, 'utf8');
      process.stdout.write('[doctreen codegen] regenerated (' + reason + ', ' + Buffer.byteLength(output, 'utf8') + ' bytes)\n');
    } catch (err) {
      process.stderr.write('[doctreen codegen] watch error: ' + err.message + '\n');
    }
  }

  if (isUrl) {
    process.stdout.write('[doctreen codegen] watching ' + opts.from + ' every ' + opts.watchMs + 'ms\n');
    setInterval(function () { regen('poll'); }, Math.max(250, opts.watchMs));
  } else {
    const watchPath = require('path').resolve(opts.from);
    process.stdout.write('[doctreen codegen] watching ' + watchPath + '\n');
    require('fs').watch(watchPath, function () { regen('fs.watch'); });
  }
}

async function runLintOpenApi(opts) {
  const path = require('path');
  const fs = require('fs');

  if (!opts.url && !opts.file) {
    printLintOpenApiUsage();
    process.exit(2);
  }

  let doc;
  if (opts.file) {
    try {
      const raw = fs.readFileSync(path.resolve(opts.file), 'utf8');
      doc = JSON.parse(raw);
    } catch (err) {
      console.error('Error reading file: ' + err.message);
      process.exit(2);
    }
  } else {
    if (typeof fetch !== 'function') {
      console.error('Error: global fetch() is not available. doctreen CLI requires Node 18+.');
      process.exit(2);
    }
    const url = opts.url.endsWith('/openapi.json')
      ? opts.url
      : opts.url.replace(/\/+$/, '') + '/openapi.json';
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) {
        console.error('Fetch failed: ' + res.status + ' ' + res.statusText);
        process.exit(2);
      }
      doc = await res.json();
    } catch (err) {
      console.error('Error: ' + err.message);
      process.exit(2);
    }
  }

  // Lazy-require so the CLI script keeps working even if the package is
  // installed without dev deps.
  const { lintOpenApiDocument } = require('../src/internal/openapi-lint');
  const result = lintOpenApiDocument(doc);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const filtered = opts.hideInfo
      ? result.issues.filter(function (i) { return i.severity !== 'info'; })
      : result.issues;
    if (filtered.length === 0) {
      process.stdout.write('OK: no lint issues found.\n');
    } else {
      const symbol = { error: 'E', warning: 'W', info: 'i' };
      for (const i of filtered) {
        process.stdout.write(
          '[' + symbol[i.severity] + '] ' +
          (i.path ? i.path + '  ' : '') +
          i.code + ': ' + i.message + '\n'
        );
      }
      process.stdout.write('\n');
      process.stdout.write(
        result.counts.error + ' error, ' +
        result.counts.warning + ' warning, ' +
        result.counts.info + ' info\n'
      );
    }
  }

  const threshold = opts.failOn === 'warning' ? (result.counts.error + result.counts.warning) : result.counts.error;
  if (threshold > 0) process.exit(1);
}

function printEmitOpenApiUsage() {
  console.error('Usage: doctreen emit-openapi --adapter <name> --app <module> [--out openapi.json]');
  console.error('');
  console.error('Builds a static OpenAPI 3.1 document from your app WITHOUT starting a server,');
  console.error('so codegen / CI can run offline. The app module must register its routes and');
  console.error('export the app (or router, for Koa) — no app.listen() required.');
  console.error('');
  console.error('  --adapter <name>   express | fastify | hono | koa | nest   (required)');
  console.error('  --app <module>     Path to a module exporting the app/router (required)');
  console.error('  --export <prop>    Named export to use (default: app / router / default / module)');
  console.error('  --out <file>       Output path (default: openapi.json)');
  console.error('  --title <t>        Override info.title');
  console.error('  --doc-version <v>  Override info.version');
  console.error('');
  console.error('Notes: Fastify — call fastifyAdapter() before routes and export a promise that');
  console.error('resolves after `await fastify.ready()`. Nest — export the created INestApplication.');
}

async function runEmitOpenApi(opts) {
  const path = require('path');
  const fs = require('fs');
  const ADAPTERS = ['express', 'fastify', 'hono', 'koa', 'nest'];

  if (!opts.app) { console.error('Error: --app <module> is required.'); printEmitOpenApiUsage(); process.exit(2); }
  if (!opts.adapter || ADAPTERS.indexOf(opts.adapter) === -1) {
    console.error('Error: --adapter must be one of: ' + ADAPTERS.join(', ')); process.exit(2);
  }

  let mod;
  try { mod = require(path.resolve(opts.app)); }
  catch (e) { console.error('Error loading --app module: ' + (e && e.message)); process.exit(1); }

  // Resolve the app/router. Default to `module.exports` itself (CJS) or its
  // `default` (ESM interop). We deliberately do NOT probe `.app`/`.router`,
  // since framework app objects expose those as internals (e.g. Express' app
  // has a deprecated `.router` getter). Use `--export` for named exports.
  let app = opts.export ? mod[opts.export] : ((mod && mod.default) || mod);
  if (app && typeof app.then === 'function') app = await app; // async bootstrap
  if (!app || (typeof app !== 'object' && typeof app !== 'function')) {
    console.error('Error: could not resolve the app export from ' + opts.app + '. Pass --export <name>.');
    process.exit(1);
  }

  let adapter;
  try { adapter = require('../src/adapters/' + opts.adapter); }
  catch (e) { console.error('Error loading adapter "' + opts.adapter + '": ' + (e && e.message)); process.exit(1); }
  if (typeof adapter.getOpenApiDocument !== 'function') {
    console.error('Error: adapter "' + opts.adapter + '" does not support offline emit.'); process.exit(1);
  }

  const config = {};
  if (opts.title || opts.docVersion) config.meta = {};
  if (opts.title) config.meta.title = opts.title;
  if (opts.docVersion) config.meta.version = opts.docVersion;

  let doc;
  try {
    doc = adapter.getOpenApiDocument(app, config);
    if (doc && typeof doc.then === 'function') doc = await doc;
  } catch (e) { console.error('Error building OpenAPI document: ' + (e && e.message)); process.exit(1); }

  const outPath = path.resolve(opts.out);
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  const count = (doc && doc.paths) ? Object.keys(doc.paths).length : 0;
  console.error('Wrote ' + outPath + ' (' + count + ' path' + (count === 1 ? '' : 's') + ').');
}

async function main() {
  const parsed = parseArgs(process.argv);
  switch (parsed.command) {
    case 'help': printRootUsage(); process.exit(parsed.error ? 2 : 0); break;
    case 'drift-help': printRootUsage(); process.exit(parsed.error ? 2 : 0); break;
    case 'drift-report-help': printDriftReportUsage(); process.exit(parsed.error ? 2 : 0); break;
    case 'drift-reset-help': printDriftResetUsage(); process.exit(parsed.error ? 2 : 0); break;
    case 'drift-report': await runDriftReport(parsed.opts); break;
    case 'drift-reset': await runDriftReset(parsed.opts); break;
    case 'lint-openapi-help': printLintOpenApiUsage(); process.exit(parsed.error ? 2 : 0); break;
    case 'lint-openapi': await runLintOpenApi(parsed.opts); break;
    case 'mock-help': printMockUsage(); process.exit(parsed.error ? 2 : 0); break;
    case 'mock': await runMock(parsed.opts); break;
    case 'codegen-help': printCodegenUsage(); process.exit(parsed.error ? 2 : 0); break;
    case 'codegen': await runCodegen(parsed.opts); break;
    case 'emit-openapi-help': printEmitOpenApiUsage(); process.exit(parsed.error ? 2 : 0); break;
    case 'emit-openapi': await runEmitOpenApi(parsed.opts); break;
    default: printRootUsage(); process.exit(2);
  }
}

main().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(2);
});
