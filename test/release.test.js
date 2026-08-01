'use strict';

/**
 * Release auto-detect (T002) — `src/internal/release.js`.
 *
 * The module's whole job is a fixed-order search, so the suite is organised
 * around the two properties that can silently rot:
 *
 *   1. ORDER — every link is reachable on its own, and each link beats the one
 *      after it. Adjacent pairs are tested rather than one giant matrix:
 *      transitivity does the rest, and a failure names the exact pair that
 *      moved.
 *   2. FAIL-OPEN — nothing throws. Not a broken stamp, not an unreadable file,
 *      not an `env` object that throws on property access. The agent runs
 *      inside the host application's boot path; a throw here is an outage.
 *
 * Every test injects `env` explicitly so a CI runner's own `GITHUB_SHA` cannot
 * leak in and turn a red test green (or the reverse). Stamp tests run against
 * `fs.mkdtemp` directories and clean up after themselves.
 *
 * Run: node --test test/release.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveRelease, STAMP_FILENAME } = require('../src/internal/release');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A temp dir that removes itself when the test ends. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctreen-release-'));
  t.after(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** Write raw text as the stamp file — raw so malformed JSON is expressible. */
function writeStamp(dir, contents) {
  fs.writeFileSync(path.join(dir, STAMP_FILENAME), contents);
  return dir;
}

/**
 * Resolve with the environment and stamp search neutralised, so a test only
 * exercises the links it sets up. `cwd` points at an empty temp dir.
 */
function resolveIsolated(t, options) {
  return resolveRelease(Object.assign({ env: {}, cwd: tempDir(t) }, options));
}

// ── Link 1: explicit config ─────────────────────────────────────────────────

test('config release is taken verbatim and reports source "config"', function (t) {
  const got = resolveIsolated(t, { release: 'deadbeef1234' });
  assert.deepEqual(got, { sha: 'deadbeef1234', branch: null, source: 'config' });
});

test('config release accepts a non-sha label (users may tag their own releases)', function (t) {
  const got = resolveIsolated(t, { release: '2026.08.1-blue' });
  assert.equal(got.sha, '2026.08.1-blue');
  assert.equal(got.source, 'config');
});

test('config release beats every platform variable', function () {
  const got = resolveRelease({
    release: 'from-config',
    env: { DOCTREEN_RELEASE: 'from-env', VERCEL_GIT_COMMIT_SHA: 'from-vercel' },
  });
  assert.equal(got.sha, 'from-config');
  assert.equal(got.source, 'config');
});

test('release "auto" falls through to the env chain instead of being used as a sha', function () {
  const got = resolveRelease({ release: 'auto', env: { GITHUB_SHA: 'gh-sha' } });
  assert.equal(got.sha, 'gh-sha');
  assert.equal(got.source, 'env:GITHUB');
});

test('release "AUTO" / " auto " are treated as auto, not as a literal release', function (t) {
  assert.equal(resolveIsolated(t, { release: 'AUTO' }), null);
  assert.equal(resolveIsolated(t, { release: '  auto  ' }), null);
});

// ── Links 2–8: platform variables, one test per source ──────────────────────

const ENV_CASES = [
  {
    name: 'DOCTREEN_RELEASE',
    source: 'env:DOCTREEN_RELEASE',
    env: { DOCTREEN_RELEASE: 'sha-doctreen' },
    branch: null,
  },
  {
    name: 'VERCEL',
    source: 'env:VERCEL',
    env: { VERCEL_GIT_COMMIT_SHA: 'sha-vercel', VERCEL_GIT_COMMIT_REF: 'main' },
    branch: 'main',
  },
  {
    name: 'RENDER',
    source: 'env:RENDER',
    env: { RENDER_GIT_COMMIT: 'sha-render', RENDER_GIT_BRANCH: 'release/2' },
    branch: 'release/2',
  },
  {
    name: 'RAILWAY',
    source: 'env:RAILWAY',
    env: { RAILWAY_GIT_COMMIT_SHA: 'sha-railway', RAILWAY_GIT_BRANCH: 'dev' },
    branch: 'dev',
  },
  {
    name: 'HEROKU',
    source: 'env:HEROKU',
    env: { HEROKU_SLUG_COMMIT: 'sha-heroku' },
    branch: null,
  },
  {
    name: 'GITHUB',
    source: 'env:GITHUB',
    env: { GITHUB_SHA: 'sha-github', GITHUB_REF_NAME: 'feature/x' },
    branch: 'feature/x',
  },
  {
    name: 'SOURCE_VERSION',
    source: 'env:SOURCE_VERSION',
    env: { SOURCE_VERSION: 'sha-source-version' },
    branch: null,
  },
];

for (const c of ENV_CASES) {
  test('env source ' + c.name + ' resolves sha + branch', function (t) {
    const got = resolveRelease({ env: c.env, cwd: tempDir(t) });
    assert.equal(got.source, c.source);
    assert.equal(got.branch, c.branch);
    assert.ok(got.sha.indexOf('sha-') === 0, 'sha came from the expected variable');
  });
}

test('a platform sha without its branch variable yields branch null, not undefined', function (t) {
  const got = resolveRelease({ env: { VERCEL_GIT_COMMIT_SHA: 'sha-vercel' }, cwd: tempDir(t) });
  assert.equal(got.branch, null);
  assert.ok('branch' in got);
});

// ── Priority: adjacent pairs prove the whole order ──────────────────────────

const PRIORITY_PAIRS = [
  ['DOCTREEN_RELEASE', 'env:DOCTREEN_RELEASE', 'VERCEL_GIT_COMMIT_SHA'],
  ['VERCEL_GIT_COMMIT_SHA', 'env:VERCEL', 'RENDER_GIT_COMMIT'],
  ['RENDER_GIT_COMMIT', 'env:RENDER', 'RAILWAY_GIT_COMMIT_SHA'],
  ['RAILWAY_GIT_COMMIT_SHA', 'env:RAILWAY', 'HEROKU_SLUG_COMMIT'],
  ['HEROKU_SLUG_COMMIT', 'env:HEROKU', 'GITHUB_SHA'],
  ['GITHUB_SHA', 'env:GITHUB', 'SOURCE_VERSION'],
];

for (const [winner, source, loser] of PRIORITY_PAIRS) {
  test('priority: ' + winner + ' beats ' + loser, function (t) {
    const env = {};
    env[winner] = 'winner-sha';
    env[loser] = 'loser-sha';
    const got = resolveRelease({ env: env, cwd: tempDir(t) });
    assert.equal(got.sha, 'winner-sha');
    assert.equal(got.source, source);
  });
}

test('priority: with the entire chain set at once DOCTREEN_RELEASE wins', function (t) {
  const env = {};
  for (const c of ENV_CASES) Object.assign(env, c.env);
  const got = resolveRelease({ env: env, cwd: tempDir(t) });
  assert.equal(got.source, 'env:DOCTREEN_RELEASE');
  assert.equal(got.sha, 'sha-doctreen');
});

test('empty and whitespace-only variables are skipped, not returned as a sha', function (t) {
  const got = resolveRelease({
    env: { DOCTREEN_RELEASE: '', VERCEL_GIT_COMMIT_SHA: '   ', RENDER_GIT_COMMIT: 'sha-render' },
    cwd: tempDir(t),
  });
  assert.equal(got.sha, 'sha-render');
  assert.equal(got.source, 'env:RENDER');
});

test('values are trimmed (shell heredocs and CI files leave newlines behind)', function (t) {
  const got = resolveRelease({
    env: { GITHUB_SHA: ' abc123\n', GITHUB_REF_NAME: ' main \n' },
    cwd: tempDir(t),
  });
  assert.equal(got.sha, 'abc123');
  assert.equal(got.branch, 'main');
});

// ── Link 9: build-time stamp file ───────────────────────────────────────────

test('stamp: a valid file in cwd resolves with source "stamp"', function (t) {
  const dir = writeStamp(
    tempDir(t),
    JSON.stringify({ sha: 'stamped-sha', branch: 'main', stampedAt: 1764000000000 })
  );
  const got = resolveRelease({ env: {}, cwd: dir });
  assert.deepEqual(got, { sha: 'stamped-sha', branch: 'main', source: 'stamp' });
});

test('stamp: branch may be null in the file', function (t) {
  const dir = writeStamp(tempDir(t), JSON.stringify({ sha: 'stamped-sha', branch: null }));
  const got = resolveRelease({ env: {}, cwd: dir });
  assert.equal(got.branch, null);
});

test('stamp: every env source outranks the file', function (t) {
  const dir = writeStamp(tempDir(t), JSON.stringify({ sha: 'stamped-sha', branch: 'main' }));
  const got = resolveRelease({ env: { SOURCE_VERSION: 'sha-source-version' }, cwd: dir });
  assert.equal(got.source, 'env:SOURCE_VERSION');
});

test('stamp: no file anywhere resolves to null (release-less degrade, not an error)', function (t) {
  assert.equal(resolveRelease({ env: {}, cwd: tempDir(t) }), null);
});

test('stamp: malformed JSON is skipped silently', function (t) {
  const dir = writeStamp(tempDir(t), '{ "sha": "half-writ');
  assert.equal(resolveRelease({ env: {}, cwd: dir }), null);
});

test('stamp: valid JSON of the wrong shape is skipped silently', function (t) {
  for (const body of ['null', '"just-a-string"', '[]', '{}', '{"sha":""}', '{"sha":42}']) {
    const dir = writeStamp(tempDir(t), body);
    assert.equal(resolveRelease({ env: {}, cwd: dir }), null, 'body: ' + body);
  }
});

test('stamp: a non-string branch in the file degrades to null rather than leaking through', function (t) {
  const dir = writeStamp(tempDir(t), JSON.stringify({ sha: 'stamped-sha', branch: 7 }));
  const got = resolveRelease({ env: {}, cwd: dir });
  assert.equal(got.sha, 'stamped-sha');
  assert.equal(got.branch, null);
});

test('stamp: an unreadable path (directory in place of the file) is skipped silently', function (t) {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, STAMP_FILENAME));
  assert.equal(resolveRelease({ env: {}, cwd: dir }), null);
});

test('stamp: falls back to the entry module directory when cwd has none', function (t) {
  // Covers the systemd / `node /srv/app/server.js` case: the stamp ships beside
  // the built artifact, and the process was started from an unrelated cwd.
  const mainFile = require.main && require.main.filename;
  if (!mainFile) return t.skip('no CommonJS entry module in this runner');

  const mainDir = path.dirname(mainFile);
  const stampPath = path.join(mainDir, STAMP_FILENAME);
  if (fs.existsSync(stampPath)) return t.skip('entry module directory already holds a stamp');

  fs.writeFileSync(stampPath, JSON.stringify({ sha: 'main-dir-sha', branch: 'main' }));
  t.after(function () {
    fs.rmSync(stampPath, { force: true });
  });

  const got = resolveRelease({ env: {}, cwd: tempDir(t) });
  assert.deepEqual(got, { sha: 'main-dir-sha', branch: 'main', source: 'stamp' });
});

// ── Fail-open ───────────────────────────────────────────────────────────────

test('never throws on hostile or absent input', function (t) {
  const dir = tempDir(t);
  const hostileEnv = new Proxy({}, {
    get: function () { throw new Error('env access exploded'); },
  });

  const inputs = [
    undefined,
    null,
    'not-an-object',
    42,
    {},
    { release: 123, env: {}, cwd: dir },
    { release: {}, env: {}, cwd: dir },
    { release: 'auto', env: null, cwd: dir },
    { env: hostileEnv, cwd: dir },
    { env: {}, cwd: 12345 },
    { env: {}, cwd: '/nonexistent/path/' + Date.now() },
    { env: {}, cwd: '' },
  ];

  // Indexed rather than stringified: `JSON.stringify` on the hostile proxy
  // would throw inside the assertion message and mask the real result.
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    assert.doesNotThrow(function () { resolveRelease(input); }, 'inputs[' + i + ']');
  }
});

test('a non-string release falls through to the chain instead of being coerced', function (t) {
  const got = resolveRelease({ release: 42, env: { GITHUB_SHA: 'gh-sha' }, cwd: tempDir(t) });
  assert.equal(got.sha, 'gh-sha');
});

test('an env object whose lookups throw degrades to the stamp link', function (t) {
  const dir = writeStamp(tempDir(t), JSON.stringify({ sha: 'stamped-sha', branch: null }));
  const hostileEnv = new Proxy({}, {
    get: function () { throw new Error('env access exploded'); },
  });
  const got = resolveRelease({ env: hostileEnv, cwd: dir });
  assert.equal(got.source, 'stamp');
});

// ── Plan constraints (wiki/plan/04) ─────────────────────────────────────────

test('source reads neither .git nor child_process', function () {
  // Plan decision, not a style rule: prod images ship without `.git`, and the
  // agent must never fork a process on the host's boot path. Asserted on the
  // source text so a future edit that reintroduces either fails here.
  const raw = fs.readFileSync(path.join(__dirname, '..', 'src', 'internal', 'release.js'), 'utf8');
  // Comments are stripped first — the module's own header explains *why* it
  // avoids both, and that prose must not trip the check.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.equal(/child_process/.test(src), false, 'child_process must not be used');
  assert.equal(/['"`][^'"`]*\.git[/\\]/.test(src), false, '.git must not be read');

  // The full import list, so a new dependency is a deliberate edit here too.
  const requires = (src.match(/require\(\s*['"][^'"]+['"]\s*\)/g) || [])
    .map(function (r) { return r.replace(/^require\(\s*['"]|['"]\s*\)$/g, ''); })
    .sort();
  assert.deepEqual(requires, ['fs', 'path']);
});

// ── Public surface ──────────────────────────────────────────────────────────

test('resolveRelease is reachable from the package entry point, the module is not', function (t) {
  // The cloud agent must resolve the release the same way the library does,
  // instead of re-implementing the chain and disagreeing about it.
  const pkg = require('doctreen');
  assert.equal(pkg.resolveRelease, resolveRelease);
  assert.deepEqual(
    pkg.resolveRelease({ release: 'auto', env: { GITHUB_SHA: 'gh-sha' }, cwd: tempDir(t) }),
    { sha: 'gh-sha', branch: null, source: 'env:GITHUB' }
  );

  // `STAMP_FILENAME` deliberately stays internal — the stamp is written by the
  // CLI and read here; no third party needs to name the file.
  assert.throws(function () { require('doctreen/internal/release'); }, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
});
