'use strict';

/**
 * Release auto-detect (v1.17+).
 *
 * Answers one question at boot: *which build of the code is running?* The
 * answer is a git sha (plus a branch name when the platform offers one) and is
 * attached to outgoing telemetry so drift can be attributed to a deploy.
 *
 * Deliberate non-goals — both are plan decisions (wiki/plan/04):
 *   - The `.git` directory is never read. Production images usually ship
 *     without it, so a `.git` reader would work in dev and silently fail where
 *     it matters.
 *   - `child_process` is never spawned. Booting a host app must not fork a
 *     `git rev-parse`.
 *
 * What is left is two sources that are cheap and always correct when present:
 * platform environment variables (set by the CI/PaaS that built the image) and
 * a build-time stamp file written by `doctreen release stamp` for platforms
 * that set nothing — bare VPS, hand-rolled Docker.
 *
 * Resolution order is a Chain of Responsibility expressed as data: the first
 * link that produces a sha wins, and the chain is walked in a FIXED order
 * (explicit user config → our own escape hatch → platform vars → stamp file).
 * Encoding the chain as the `ENV_CHAIN` table rather than an if-ladder keeps
 * "which platforms do we know about" a one-line edit, and keeps the diagnostic
 * `source` label next to the variable that produced it.
 *
 * The module is fail-open, without exception. A missing file, an unreadable
 * one, malformed JSON, an `env` object that throws on property access, a
 * caller passing nonsense — every one of them degrades to `null`, which the
 * callers read as "run without release attribution". Losing a sha costs a
 * dashboard feature; throwing here would take down the host application at
 * startup, which the agent is never allowed to do.
 */

const fs = require('fs');
const path = require('path');

/** Written by `doctreen release stamp`; read here. Shared so the name lives once. */
const STAMP_FILENAME = '.doctreen-release.json';

/**
 * Known platform variables, in resolution order. `branch` is the companion
 * variable holding a ref name, or `null` where the platform exposes none.
 * `source` is the diagnostic label reported back to the caller.
 *
 * ORDER IS PART OF THE CONTRACT — see wiki/tasks/T002. `DOCTREEN_RELEASE`
 * leads so a user can always override a platform that guesses wrong.
 */
const ENV_CHAIN = [
  { sha: 'DOCTREEN_RELEASE', branch: null, source: 'env:DOCTREEN_RELEASE' },
  { sha: 'VERCEL_GIT_COMMIT_SHA', branch: 'VERCEL_GIT_COMMIT_REF', source: 'env:VERCEL' },
  { sha: 'RENDER_GIT_COMMIT', branch: 'RENDER_GIT_BRANCH', source: 'env:RENDER' },
  { sha: 'RAILWAY_GIT_COMMIT_SHA', branch: 'RAILWAY_GIT_BRANCH', source: 'env:RAILWAY' },
  { sha: 'HEROKU_SLUG_COMMIT', branch: null, source: 'env:HEROKU' },
  { sha: 'GITHUB_SHA', branch: 'GITHUB_REF_NAME', source: 'env:GITHUB' },
  { sha: 'SOURCE_VERSION', branch: null, source: 'env:SOURCE_VERSION' },
];

// ─── Value helpers ───────────────────────────────────────────────────────────

/**
 * Normalise an untrusted value to a non-empty trimmed string, or `null`.
 * Numbers and objects are rejected rather than coerced: a sha that arrived as
 * `[object Object]` is worse than no sha at all.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read one variable off an environment-like object. The object is caller
 * supplied (tests inject one), so property access is guarded.
 *
 * @param {object} env
 * @param {string|null} name
 * @returns {string|null}
 */
function readEnv(env, name) {
  if (!name) return null;
  try {
    return cleanString(env[name]);
  } catch (_) {
    return null;
  }
}

/**
 * `options.env` when it is usable, otherwise the real environment. An empty
 * object is honoured — that is how a test asks for "no platform variables".
 *
 * @param {unknown} injected
 * @returns {object}
 */
function pickEnv(injected) {
  if (injected && typeof injected === 'object') return injected;
  return process.env;
}

// ─── Chain links ─────────────────────────────────────────────────────────────

/**
 * Link 1 — an explicit `release` in the adapter config.
 *
 * `'auto'` means "you figure it out" and falls through to the rest of the
 * chain; the comparison is case-insensitive because reading `'Auto'` as a
 * literal release tag would fail silently and confusingly. Any other string is
 * taken verbatim: users are allowed to report a release name that is not a git
 * sha (`'2026.08.1'`, `'blue'`), so no hex validation happens here.
 *
 * @param {unknown} release
 * @returns {{ sha: string, branch: null, source: string }|null}
 */
function fromConfig(release) {
  const value = cleanString(release);
  if (!value) return null;
  if (value.toLowerCase() === 'auto') return null;
  return { sha: value, branch: null, source: 'config' };
}

/**
 * Links 2–8 — the platform variable table, first hit wins.
 *
 * @param {object} env
 * @returns {{ sha: string, branch: string|null, source: string }|null}
 */
function fromEnv(env) {
  for (let i = 0; i < ENV_CHAIN.length; i++) {
    const link = ENV_CHAIN[i];
    const sha = readEnv(env, link.sha);
    if (!sha) continue;
    return { sha: sha, branch: readEnv(env, link.branch), source: link.source };
  }
  return null;
}

/**
 * Read and validate a stamp file out of one directory.
 *
 * Every failure mode — no file, no permission, a directory where the file
 * should be, truncated JSON, valid JSON of the wrong shape — resolves to
 * `null` so the search simply moves on.
 *
 * @param {string} dir
 * @returns {{ sha: string, branch: string|null, source: string }|null}
 */
function readStamp(dir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, STAMP_FILENAME), 'utf8');
  } catch (_) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const sha = cleanString(parsed.sha);
  if (!sha) return null;
  return { sha: sha, branch: cleanString(parsed.branch), source: 'stamp' };
}

/**
 * Link 9 — the build-time stamp file, searched in the working directory and
 * then beside the entry module. The second location covers a process started
 * from an unrelated cwd (systemd, `node /srv/app/server.js` from `/`), where
 * the stamp sits next to the built artifact rather than in `process.cwd()`.
 *
 * @param {unknown} cwd
 * @returns {{ sha: string, branch: string|null, source: string }|null}
 */
function fromStamp(cwd) {
  const dirs = [];

  const base = cleanString(cwd) || safeCwd();
  if (base) dirs.push(base);

  const mainDir = mainModuleDir();
  if (mainDir && dirs.indexOf(mainDir) === -1) dirs.push(mainDir);

  for (let i = 0; i < dirs.length; i++) {
    const found = readStamp(dirs[i]);
    if (found) return found;
  }
  return null;
}

/** `process.cwd()` throws if the directory was deleted underneath us. */
function safeCwd() {
  try {
    return process.cwd();
  } catch (_) {
    return null;
  }
}

/** Directory of the entry module; `null` under ESM or a bare `-e` eval. */
function mainModuleDir() {
  try {
    if (require.main && typeof require.main.filename === 'string') {
      return path.dirname(require.main.filename);
    }
  } catch (_) { /* swallow */ }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ResolveReleaseOptions
 * @property {string} [release]  - Explicit release, or `'auto'` to detect. Anything else is used verbatim.
 * @property {string} [cwd]      - Directory searched first for the stamp file. Default `process.cwd()`.
 * @property {object} [env]      - Environment override. Default `process.env`.
 */

/**
 * Resolve the running release. Returns `null` when nothing in the chain
 * matches — that is the normal "no release attribution" state, not an error.
 *
 * @param {ResolveReleaseOptions} [options]
 * @returns {{ sha: string, branch: string|null, source: string }|null}
 */
function resolveRelease(options) {
  try {
    const opts = options && typeof options === 'object' ? options : {};

    return fromConfig(opts.release) ||
      fromEnv(pickEnv(opts.env)) ||
      fromStamp(opts.cwd);
  } catch (_) {
    // Unreachable by design; the net stays because a throw from here would
    // reach the host application's startup path.
    return null;
  }
}

module.exports = {
  resolveRelease: resolveRelease,
  STAMP_FILENAME: STAMP_FILENAME,
};
