'use strict';

/**
 * Response assertion → drift pipeline (v1.17, T007).
 *
 * The seam between two vocabularies. Response assertion speaks Zod: a failed
 * `safeParse` yields `ZodIssue[]` with codes, dotted paths and per-leaf detail.
 * The drift pipeline speaks `{ kind, field, expected?, got? }` over *top-level*
 * fields only. This module is the Adapter between them — the one place that
 * knows both — so `validate.js` stays free of drift semantics and `drift.js`
 * stays free of Zod.
 *
 * Nothing here re-diffs the payload: the mismatch was already computed by the
 * assertion, and `diffShape` would only produce a second, weaker answer (it
 * cannot see refinements, unions, or `.strict()`). This is also why the
 * pipeline gained `recordIssues` — an issues-ready entry point next to
 * `recordIfDrift`.
 *
 * Two rules follow from the core's top-level-only principle (plan 01,
 * §Bilinçli kararlar #2):
 *
 *   1. A nested path folds onto its root: `user.address.city` is reported as
 *      `field: 'user'`. All the top level can honestly say is that the shape of
 *      `user` does not match, so a folded issue is always `type-mismatch` and
 *      carries no `expected`/`got` — those describe a leaf, not the field named.
 *   2. A mismatch on the response root itself (`path: []`) has no top-level
 *      field to attribute and is dropped, exactly as `diffShape` returns no
 *      issues for a non-object payload.
 *   3. (v1.20) When the response root is an ARRAY, "top level" means the top
 *      level of an element. Leading element indices are not field names: they
 *      fold to `[]`, and the fold lands on the element's own field —
 *      `[4, 'email']` is reported as `field: '[].email'`. Before v1.20 the
 *      index itself was the field (`'4'`), which lost the name that drifted
 *      and made the same drift on elements 0, 3 and 7 three signatures (and
 *      three alerts) instead of one. Only LEADING indices fold: in
 *      `items.3.price` the root segment is `items`, as it always was.
 *
 * Drift events carry no payload values — only field names, kinds and type
 * names — and that invariant is preserved here: `expected`/`got` come from
 * Zod's type words, never from the body.
 */

/**
 * Fold one Zod issue path onto the top-level field it belongs to (rules 1–3).
 *
 * Zod reports array indices as numbers and object keys as strings, so
 * `typeof === 'number'` is exact: an object key that happens to be `"4"` is a
 * real field name and stays one.
 *
 * @param {any} path - `issue.path`
 * @returns {{ field: string, leaf: boolean }} `field` is '' when the issue is
 *   on the payload root itself; `leaf` is true when the issue describes the
 *   folded field directly (so its `expected`/`got` are about that field).
 */
function foldPath(path) {
  if (!Array.isArray(path) || path.length === 0) return { field: '', leaf: false };

  let elements = '';
  let at = 0;
  while (at < path.length && typeof path[at] === 'number') {
    elements += '[]';
    at++;
  }

  // The element itself is the wrong shape (`[3]` is null, say): the element
  // is the thing that drifted, and the issue describes it directly.
  if (at === path.length) return { field: elements, leaf: true };

  const name = String(path[at]);
  return {
    field: elements ? elements + '.' + name : name,
    leaf: at === path.length - 1,
  };
}

/**
 * Translate one Zod issue into a drift issue, or null when it has no top-level
 * field to attribute.
 *
 * @param {any} issue - one entry of `zodError.issues`
 * @returns {{ kind: string, field: string, expected?: string, got?: string }|null}
 */
function translateIssue(issue) {
  const folded = foldPath(issue && issue.path);
  const field = folded.field;
  if (!field) return null;

  // Below the top level: the detail belongs to a nested leaf. Reporting it
  // against the top-level field would attribute the wrong type (or claim
  // `user` is missing when only `user.address` is), so only the shape mismatch
  // survives the fold.
  if (!folded.leaf) return { kind: 'type-mismatch', field: field };

  if (issue.code === 'invalid_type') {
    // Zod reports an absent property as `received: 'undefined'` rather than a
    // dedicated code — that is the missing-required case.
    if (issue.received === 'undefined') {
      return { kind: 'missing-required', field: field, expected: String(issue.expected) };
    }
    return { kind: 'type-mismatch', field: field, expected: String(issue.expected), got: String(issue.received) };
  }

  // Refinements, string formats, ranges, unions: the value is the declared type
  // but not the declared contract. `type-mismatch` is the drift kind for
  // "declared and actual disagree" — the third kind exists for extra keys only.
  return { kind: 'type-mismatch', field: field };
}

/**
 * Translate `unrecognized_keys` (raised by `.strict()` objects) into one
 * `unexpected-field` per key. A plain `z.object()` strips extra keys silently,
 * so this is the only Zod issue that can produce the kind at all.
 *
 * `got` is omitted deliberately: Zod reports the key names, not the values, and
 * inventing a type would mean reading the payload the event must not carry.
 *
 * @param {any} issue
 * @param {Array<{ kind: string, field: string }>} out
 */
function translateUnrecognizedKeys(issue, out) {
  const path = Array.isArray(issue.path) ? issue.path : [];
  const keys = Array.isArray(issue.keys) ? issue.keys : [];
  for (let i = 0; i < keys.length; i++) {
    // The key is one more segment of the path, so it folds by the same rule:
    // inside a nested object onto that object's top-level name, at the root
    // the key *is* the top-level field, and inside an array element it is the
    // element's field (`[].extra`).
    out.push({ kind: 'unexpected-field', field: foldPath(path.concat([String(keys[i])])).field });
  }
}

/**
 * Convert a Zod issue list into drift issues.
 *
 * Folding makes collisions likely — `user.a` and `user.b` are one drift fact
 * about `user`, not two — so `kind + field` pairs are de-duplicated, keeping
 * the first (most detailed, since depth-1 issues carry `expected`/`got`).
 *
 * @param {Array<any>} zodIssues - `zodError.issues`
 * @returns {Array<{ kind: string, field: string, expected?: string, got?: string }>}
 */
function toDriftIssues(zodIssues) {
  /** @type {Array<{ kind: string, field: string, expected?: string, got?: string }>} */
  const out = [];
  if (!Array.isArray(zodIssues)) return out;

  for (let i = 0; i < zodIssues.length; i++) {
    const issue = zodIssues[i];
    if (!issue) continue;
    if (issue.code === 'unrecognized_keys') {
      translateUnrecognizedKeys(issue, out);
      continue;
    }
    const translated = translateIssue(issue);
    if (translated) out.push(translated);
  }

  /** @type {Array<{ kind: string, field: string, expected?: string, got?: string }>} */
  const deduped = [];
  const seen = Object.create(null);
  for (let i = 0; i < out.length; i++) {
    const sig = out[i].kind + '|' + out[i].field;
    if (seen[sig]) continue;
    seen[sig] = true;
    deduped.push(out[i]);
  }
  return deduped;
}

/**
 * Feed a failed response assertion into the drift pipeline as a
 * `part: 'response'` event.
 *
 * Called from `assertResponse` — the single point all five adapters already
 * share — so response drift is wired once rather than five times, and reaches
 * the store through the same sampling, `makeEvent` and `record` path as request
 * drift. `drift.sampleRate` governs both; a separate rate would be config
 * duplication for one signal.
 *
 * Fail-open like every other observation hook: a counter must never be the
 * reason a response fails.
 *
 * @param {{ _drift?: { enabled?: boolean, recordIssues?: Function } }} config
 *   - the adapter's normalised config
 * @param {{ method?: string, path?: string }|null} route - the route that answered
 * @param {Array<any>} zodIssues - raw `zodError.issues` from the assertion
 * @returns {void}
 */
function recordResponseDrift(config, route, zodIssues) {
  const pipeline = config && config._drift;
  if (!pipeline || !pipeline.enabled || typeof pipeline.recordIssues !== 'function') return;
  if (!route || !route.path) return;

  try {
    const issues = toDriftIssues(zodIssues);
    if (issues.length === 0) return;
    pipeline.recordIssues(route, 'response', issues);
  } catch (_) { /* observation must never break a response */ }
}

module.exports = {
  toDriftIssues: toDriftIssues,
  recordResponseDrift: recordResponseDrift,
};
