#!/usr/bin/env node
'use strict';

/**
 * `doctreen` — umbrella CLI for repo-level operations.
 *
 * Subcommands:
 *   drift report  --url <docsUrl> [--fail-on-mismatch] [--json] [--min-issues N]
 *   drift reset   --url <docsUrl> [--token <token>] [--json]
 *   lint openapi  (--url <docsUrl> | --file <path>) [--json] [--fail-on warning|error]
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
    default: printRootUsage(); process.exit(2);
  }
}

main().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(2);
});
