'use strict';

/**
 * Extract path-parameter values from a concrete request path given a route
 * pattern.
 *
 * Adapters whose validation runs at the router / wildcard level — Koa's
 * `router.use()` and Hono's `app.use('*')` — do not have the *matched* route's
 * path params bound at that point (`ctx.params` / `c.req.param()` reflect the
 * middleware's own pattern, not the route's). We recover the values
 * deterministically by aligning the pattern's `:name` segments with the actual
 * URL segments, using the already-matched route pattern from the registry.
 *
 * @param {string} pattern     e.g. '/orders/:orderId/items/:seq'
 * @param {string} actualPath  e.g. '/orders/abc/items/3'
 * @returns {Record<string,string>} e.g. { orderId: 'abc', seq: '3' }
 */
function extractPathParams(pattern, actualPath) {
  const out = {};
  if (!pattern || pattern.indexOf(':') === -1) return out;

  // Strip any query string / hash, then split. Both pattern and path are
  // rooted at '/', so their segment arrays align 1:1 once the route matched.
  const clean = String(actualPath || '').split('?')[0].split('#')[0];
  const pSegs = pattern.split('/');
  const aSegs = clean.split('/');

  for (let i = 0; i < pSegs.length; i++) {
    const seg = pSegs[i];
    if (seg && seg.charAt(0) === ':') {
      const name = seg.slice(1);
      const raw = aSegs[i] != null ? aSegs[i] : '';
      try {
        out[name] = decodeURIComponent(raw);
      } catch (_) {
        out[name] = raw; // malformed %-encoding — pass through verbatim
      }
    }
  }
  return out;
}

module.exports = { extractPathParams };
