#!/usr/bin/env node
'use strict';

/**
 * Updates the "What's new in vX.Y.Z" callout block in README.md from the
 * top entry of CHANGELOG.md and the current package.json version.
 *
 * Designed for the `npm version` lifecycle hook:
 *
 *   "scripts": {
 *     "version": "node scripts/update-release-callout.js && git add README.md"
 *   }
 *
 * `npm version <bump>` bumps package.json, runs `version`, then commits
 * package.json + anything else that was staged. So this script just edits
 * README in place and lets npm pick it up.
 *
 * Conventions:
 *   - README must contain a `<!-- whatsnew:start -->` / `<!-- whatsnew:end -->`
 *     marker pair. Everything between is replaced.
 *   - CHANGELOG.md must have a `## [X.Y.Z]` heading for the new version.
 *   - The highlight text is taken from the FIRST bullet under the FIRST
 *     `###` subsection of that version. The first sentence (or 240 chars,
 *     whichever is shorter) is used.
 *
 * GitHub release URL is built from the `repository` field in package.json
 * (must be a github.com URL).
 *
 * Opt-out: add `<!-- whatsnew-skip -->` anywhere inside a CHANGELOG entry
 * (typically docs-only or refactor patches) and the script will fall back
 * to the previous (older) entry. Useful when the current bullet would
 * produce a meta-circular callout like "v1.6.1 — README now opens with…".
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const PKG_PATH   = path.join(ROOT, 'package.json');
const README     = path.join(ROOT, 'README.md');
const CHANGELOG  = path.join(ROOT, 'CHANGELOG.md');

const START_MARK = '<!-- whatsnew:start -->';
const END_MARK   = '<!-- whatsnew:end -->';

function fail(msg) {
  console.error('[update-release-callout] ' + msg);
  process.exit(1);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Pull the section for `version` out of CHANGELOG.md. Returns the lines
 * between this version's heading and the next version heading (exclusive),
 * plus the version string and the byte offset of the heading so callers
 * can rewind to an earlier section.
 */
function extractChangelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const allHeadings = [];
  const headingRe = /^##\s+\[([^\]]+)\]/;
  for (let i = 0; i < lines.length; i++) {
    const m = headingRe.exec(lines[i]);
    if (m) allHeadings.push({ version: m[1], index: i });
  }
  if (allHeadings.length === 0) return null;

  // Find the requested version; if missing, fall back to the topmost entry.
  let idx = allHeadings.findIndex(function (h) { return h.version === version; });
  if (idx === -1) idx = 0;

  return {
    version:  allHeadings[idx].version,
    body:     lines.slice(allHeadings[idx].index + 1, idx + 1 < allHeadings.length ? allHeadings[idx + 1].index : lines.length),
    nextOlder: idx + 1 < allHeadings.length ? allHeadings[idx + 1].version : null,
  };
}

/**
 * Extract the first bullet under any `###` subsection. Returns the bullet's
 * leading sentence stripped of markdown noise.
 */
function extractHighlight(sectionLines) {
  let inSubsection = false;
  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    if (/^###\s+/.test(line)) { inSubsection = true; continue; }
    if (!inSubsection) continue;

    const bulletMatch = /^\s*-\s+(.*)$/.exec(line);
    if (!bulletMatch) continue;

    // Concatenate continuation lines (indented) into the same bullet so the
    // first sentence isn't cut off by a hard wrap inside the bullet.
    let bullet = bulletMatch[1];
    for (let j = i + 1; j < sectionLines.length; j++) {
      const nxt = sectionLines[j];
      if (/^\s*-\s+/.test(nxt) || /^###\s+/.test(nxt) || /^##\s+/.test(nxt)) break;
      if (/^\s+\S/.test(nxt)) bullet += ' ' + nxt.trim();
      else if (nxt.trim() === '') break;
    }

    // First sentence — split on `. ` boundary, but keep colon-separated leads
    // ("Runtime validation middleware. The Zod schema…") in one shot.
    const sentence = bullet.split(/(?<=\.)\s/)[0].trim();
    return sentence.length > 240 ? sentence.slice(0, 237).trimEnd() + '…' : sentence;
  }
  return null;
}

function buildReleaseUrl(repoField, version) {
  if (!repoField) return null;
  const url = typeof repoField === 'string' ? repoField : repoField.url;
  if (!url) return null;
  // Normalise "git+https://github.com/foo/bar.git" → "https://github.com/foo/bar"
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(url);
  if (!m) return null;
  return 'https://github.com/' + m[1] + '/' + m[2] + '/releases/tag/v' + version;
}

/** True when a CHANGELOG section body contains the opt-out marker. */
function hasSkipMarker(sectionLines) {
  for (let i = 0; i < sectionLines.length; i++) {
    if (sectionLines[i].indexOf('<!-- whatsnew-skip -->') !== -1) return true;
  }
  return false;
}

function main() {
  const pkg     = readJSON(PKG_PATH);
  const startV  = pkg.version;

  const changelog = fs.readFileSync(CHANGELOG, 'utf8');

  // Walk back from the current version through any entries flagged with
  // <!-- whatsnew-skip --> (typical for docs-only / refactor patches whose
  // CHANGELOG bullet would produce a meta-circular callout).
  let v = startV;
  let section = extractChangelogSection(changelog, v);
  while (section && hasSkipMarker(section.body) && section.nextOlder) {
    v = section.nextOlder;
    section = extractChangelogSection(changelog, v);
  }

  if (!section) fail('CHANGELOG.md has no usable section near v' + startV + '.');

  const highlight = extractHighlight(section.body);
  if (!highlight) fail('Could not find a bullet under any `###` subsection in the [' + v + '] CHANGELOG entry.');

  const releaseUrl = buildReleaseUrl(pkg.repository, v);
  const releaseTail = releaseUrl
    ? ' **[Read the release notes →](' + releaseUrl + ')**'
    : '';

  const callout =
    START_MARK + '\n' +
    '> **What\'s new in v' + v + '** &nbsp;—&nbsp; ' + highlight + releaseTail + '\n' +
    END_MARK;

  const readme = fs.readFileSync(README, 'utf8');
  const startIdx = readme.indexOf(START_MARK);
  const endIdx   = readme.indexOf(END_MARK);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    fail('README is missing the ' + START_MARK + ' / ' + END_MARK + ' marker pair.');
  }
  const before = readme.slice(0, startIdx);
  const after  = readme.slice(endIdx + END_MARK.length);
  fs.writeFileSync(README, before + callout + after);

  if (v !== startV) {
    console.log('[update-release-callout] v' + startV + ' is flagged whatsnew-skip; callout points to v' + v + ' instead.');
  } else {
    console.log('[update-release-callout] README callout updated for v' + v + '.');
  }
}

main();
