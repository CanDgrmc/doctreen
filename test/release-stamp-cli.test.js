'use strict';

/**
 * `doctreen release stamp` (T003) — `bin/doctreen.js`.
 *
 * The command is a build-time counterpart to the runtime resolver in
 * `src/internal/release.js`, so the suite is a black-box one: every case spawns
 * the real CLI and inspects the file, stdout, and exit code a CI job would see.
 * Requiring the bin file in-process is not an option — it calls `process.exit`.
 *
 * Three properties carry the weight:
 *
 *   1. PRECEDENCE — flags beat platform env vars, env vars beat git.
 *   2. FAIL LOUD — the runtime half is fail-open, so this half is the only place
 *      a missing sha can be noticed. No sha ⇒ exit 1 and a message on stderr.
 *   3. ROUND TRIP — what this command writes, `resolveRelease` reads back. The
 *      two halves share `STAMP_FILENAME`, and the file shape is asserted here
 *      rather than assumed.
 *
 * Every spawn gets an environment with the whole platform chain stripped, so a
 * CI runner's own `GITHUB_SHA` cannot leak in and mask a broken git fallback.
 * Temp dirs (including the throwaway git repos) remove themselves.
 *
 * Run: node --test test/release-stamp-cli.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const { resolveRelease, STAMP_FILENAME } = require('../src/internal/release');

const CLI = path.join(__dirname, '..', 'bin', 'doctreen.js');
const REPO_ROOT = path.join(__dirname, '..');

/** Everything `resolveRelease` looks at; cleared so tests control the input. */
const PLATFORM_VARS = [
  'DOCTREEN_RELEASE',
  'VERCEL_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_REF',
  'RENDER_GIT_COMMIT', 'RENDER_GIT_BRANCH',
  'RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_GIT_BRANCH',
  'HEROKU_SLUG_COMMIT',
  'GITHUB_SHA', 'GITHUB_REF_NAME',
  'SOURCE_VERSION',
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A temp dir that removes itself when the test ends. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctreen-stamp-'));
  t.after(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** The host environment minus the platform chain, plus whatever a test sets. */
function cleanEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const name of PLATFORM_VARS) delete env[name];
  return Object.assign(env, extra || {});
}

function runCli(args, options) {
  const opts = options || {};
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd: opts.cwd || REPO_ROOT,
    env: opts.env || cleanEnv(),
    encoding: 'utf8',
  });
}

function readStampFile(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, STAMP_FILENAME), 'utf8'));
}

/**
 * A throwaway repository with exactly one commit. Identity and signing are
 * forced on the command line so a developer's global git config cannot make
 * the commit fail (or hang on a gpg prompt).
 */
function tempGitRepo(t) {
  const dir = tempDir(t);
  const git = function (args) {
    execFileSync('git', args, {
      cwd: dir,
      stdio: 'ignore',
      env: Object.assign({}, process.env, {
        GIT_AUTHOR_NAME: 'doctreen test', GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'doctreen test', GIT_COMMITTER_EMAIL: 'test@example.com',
      }),
    });
  };
  git(['init', '-q', '-b', 'main']);
  git(['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'root']);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  return { dir: dir, head: head, git: git };
}

// ── Env vars ────────────────────────────────────────────────────────────────

test('DOCTREEN_RELEASE is written to the stamp file in --out', function (t) {
  const out = path.join(tempDir(t), 'nested', 'dist');

  const res = runCli(['release', 'stamp', '--out', out], {
    env: cleanEnv({ DOCTREEN_RELEASE: 'abc' }),
  });

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(readStampFile(out).sha, 'abc');
  assert.match(res.stdout, /^stamped abc \(no branch\) → /);
});

test('a platform pair further down the chain supplies both sha and branch', function (t) {
  const out = tempDir(t);

  const res = runCli(['release', 'stamp', '--out', out], {
    env: cleanEnv({ VERCEL_GIT_COMMIT_SHA: 'v1sha', VERCEL_GIT_COMMIT_REF: 'preview' }),
  });

  assert.equal(res.status, 0, res.stderr);
  const stamp = readStampFile(out);
  assert.equal(stamp.sha, 'v1sha');
  assert.equal(stamp.branch, 'preview');
  assert.match(res.stdout, /\(preview\)/);
});

test('the stamp file is pretty JSON with an epoch-ms stampedAt and a trailing newline', function (t) {
  const out = tempDir(t);
  const before = Date.now();

  const res = runCli(['release', 'stamp', '--out', out], {
    env: cleanEnv({ DOCTREEN_RELEASE: 'abc', GITHUB_REF_NAME: 'ignored' }),
  });
  assert.equal(res.status, 0, res.stderr);

  const raw = fs.readFileSync(path.join(out, STAMP_FILENAME), 'utf8');
  assert.ok(raw.endsWith('\n'), 'stamp file must end with a newline');

  const stamp = JSON.parse(raw);
  assert.deepEqual(Object.keys(stamp).sort(), ['branch', 'sha', 'stampedAt']);
  assert.equal(stamp.branch, null, 'DOCTREEN_RELEASE has no companion branch var');
  assert.equal(typeof stamp.stampedAt, 'number');
  assert.ok(stamp.stampedAt >= before && stamp.stampedAt <= Date.now());
});

test('--out defaults to the working directory', function (t) {
  const dir = tempDir(t);

  const res = runCli(['release', 'stamp'], {
    cwd: dir,
    env: cleanEnv({ DOCTREEN_RELEASE: 'cwd-sha' }),
  });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readStampFile(dir).sha, 'cwd-sha');
});

// ── Flags win ───────────────────────────────────────────────────────────────

test('--sha and --branch override the environment', function (t) {
  const out = tempDir(t);

  const res = runCli(['release', 'stamp', '--out', out, '--sha', 'flag-sha', '--branch', 'flag-branch'], {
    env: cleanEnv({ DOCTREEN_RELEASE: 'env-sha', GITHUB_SHA: 'gh', GITHUB_REF_NAME: 'gh-branch' }),
  });

  assert.equal(res.status, 0, res.stderr);
  const stamp = readStampFile(out);
  assert.equal(stamp.sha, 'flag-sha');
  assert.equal(stamp.branch, 'flag-branch');
});

test('--branch alone overrides the branch the environment supplied', function (t) {
  const out = tempDir(t);

  const res = runCli(['release', 'stamp', '--out', out, '--branch', 'flag-branch'], {
    env: cleanEnv({ GITHUB_SHA: 'gh-sha', GITHUB_REF_NAME: 'gh-branch' }),
  });

  assert.equal(res.status, 0, res.stderr);
  const stamp = readStampFile(out);
  assert.equal(stamp.sha, 'gh-sha', 'sha still comes from the env chain');
  assert.equal(stamp.branch, 'flag-branch');
});

// ── Git fallback ────────────────────────────────────────────────────────────

test('with no flags and no env vars the sha comes from git HEAD', function (t) {
  const repo = tempGitRepo(t);
  const out = tempDir(t);

  const res = runCli(['release', 'stamp', '--out', out], { cwd: repo.dir });

  assert.equal(res.status, 0, res.stderr);
  const stamp = readStampFile(out);
  assert.equal(stamp.sha, repo.head);
  assert.equal(stamp.branch, 'main');
});

test('a detached HEAD reports no branch instead of the literal "HEAD"', function (t) {
  const repo = tempGitRepo(t);
  repo.git(['checkout', '-q', '--detach', 'HEAD']);

  const res = runCli(['release', 'stamp'], { cwd: repo.dir });

  assert.equal(res.status, 0, res.stderr);
  const stamp = readStampFile(repo.dir);
  assert.equal(stamp.sha, repo.head);
  assert.equal(stamp.branch, null);
});

test('an existing stamp file is not recycled as an input for the next stamp', function (t) {
  const repo = tempGitRepo(t);
  fs.writeFileSync(
    path.join(repo.dir, STAMP_FILENAME),
    JSON.stringify({ sha: 'stale-sha', branch: 'stale', stampedAt: 1 })
  );

  const res = runCli(['release', 'stamp'], { cwd: repo.dir });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readStampFile(repo.dir).sha, repo.head);
});

// ── Nothing found ───────────────────────────────────────────────────────────

test('no sha from any source exits 1 with an explanatory stderr message', function (t) {
  const dir = tempDir(t);

  // Emptying PATH is what makes this deterministic: `git` becomes unreachable,
  // so the fallback cannot accidentally resolve a repo above the temp dir.
  const res = runCli(['release', 'stamp'], { cwd: dir, env: cleanEnv({ PATH: '' }) });

  assert.equal(res.status, 1);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /could not determine a release sha/i);
  assert.match(res.stderr, /--sha/);
  assert.equal(fs.existsSync(path.join(dir, STAMP_FILENAME)), false, 'no half-written stamp');
});

test('an empty --sha value falls through to the chain rather than stamping ""', function (t) {
  const out = tempDir(t);

  const res = runCli(['release', 'stamp', '--out', out, '--sha', '   '], {
    env: cleanEnv({ DOCTREEN_RELEASE: 'env-sha' }),
  });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(readStampFile(out).sha, 'env-sha');
});

// ── Round trip with the runtime resolver (T002) ─────────────────────────────

test('resolveRelease reads back exactly what the command wrote', function (t) {
  const out = tempDir(t);

  const res = runCli(['release', 'stamp', '--out', out], {
    env: cleanEnv({ RENDER_GIT_COMMIT: 'render-sha', RENDER_GIT_BRANCH: 'release' }),
  });
  assert.equal(res.status, 0, res.stderr);

  const got = resolveRelease({ env: {}, cwd: out });
  assert.deepEqual(got, { sha: 'render-sha', branch: 'release', source: 'stamp' });
});

test('a git-sourced stamp round-trips too', function (t) {
  const repo = tempGitRepo(t);

  assert.equal(runCli(['release', 'stamp'], { cwd: repo.dir }).status, 0);

  const got = resolveRelease({ env: {}, cwd: repo.dir });
  assert.equal(got.sha, repo.head);
  assert.equal(got.branch, 'main');
  assert.equal(got.source, 'stamp');
});

// ── Help and argument handling ──────────────────────────────────────────────

test('the root help lists release stamp without dropping the existing commands', function () {
  const res = runCli(['--help']);

  assert.equal(res.status, 0);
  for (const cmd of ['drift report', 'drift reset', 'lint openapi', 'mock',
    'codegen types', 'codegen client', 'emit-openapi', 'release stamp']) {
    assert.ok(res.stderr.indexOf(cmd) !== -1, 'root usage should mention `' + cmd + '`');
  }
});

test('release stamp --help exits 0 and documents the lookup order', function () {
  const res = runCli(['release', 'stamp', '--help']);

  assert.equal(res.status, 0);
  assert.match(res.stderr, /--out <dir>/);
  assert.match(res.stderr, /--sha <sha>/);
  assert.match(res.stderr, /--branch <branch>/);
  assert.match(res.stderr, /git rev-parse HEAD/);
});

test('an unknown release subcommand or option exits 2 with usage', function (t) {
  const dir = tempDir(t);

  const badSub = runCli(['release', 'publish'], { cwd: dir });
  assert.equal(badSub.status, 2);
  assert.match(badSub.stderr, /release stamp/);

  const badOpt = runCli(['release', 'stamp', '--nope'], { cwd: dir });
  assert.equal(badOpt.status, 2);
  assert.match(badOpt.stderr, /Unknown option: --nope/);
  assert.equal(fs.existsSync(path.join(dir, STAMP_FILENAME)), false);
});
