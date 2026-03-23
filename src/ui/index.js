'use strict';

// ─── JSDoc typedefs ───────────────────────────────────────────────────────────

/**
 * @typedef {import('../index').RouteEntry}       RouteEntry
 * @typedef {import('../index').SchemaNode}       SchemaNode
 * @typedef {import('../index').NormalizedConfig} NormalizedConfig
 */

// ─────────────────────────────────────────────────────────────────────────────

/** @type {Record<string, { cls: string }>} */
const METHOD_STYLES = {
  GET:     { cls: 'method-get'     },
  POST:    { cls: 'method-post'    },
  PUT:     { cls: 'method-put'     },
  PATCH:   { cls: 'method-patch'   },
  DELETE:  { cls: 'method-delete'  },
  OPTIONS: { cls: 'method-options' },
  HEAD:    { cls: 'method-head'    },
};

// Methods that can carry a request body
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} routePath
 * @returns {string}
 */
function highlightPath(routePath) {
  return escapeHtml(routePath).replace(
    /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
    '<span class="param">:$1</span>'
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * renderSchemaNode
 *
 * Recursively converts a SchemaNode into an HTML tree.
 *
 * @param {SchemaNode|null} node
 * @param {number} [depth]
 * @returns {string}
 */
function renderSchemaNode(node, depth) {
  if (depth === undefined) depth = 0;
  if (!node) return '<span class="t-null">—</span>';

  switch (node.type) {
    case 'object': {
      const entries = node.properties ? Object.entries(node.properties) : [];
      if (entries.length === 0) return '<span class="t-type t-brace">{}</span>';
      const count = entries.length;
      const props = entries
        .map(([k, v]) =>
          `<div class="schema-prop">` +
          `<span class="schema-key">${escapeHtml(k)}` +
          (v.optional ? `<span class="prop-optional">?</span>` : '') +
          `</span>` +
          `<span class="schema-sep">: </span>` +
          renderSchemaNode(v, depth + 1) +
          `</div>`
        )
        .join('');
      return (
        `<span class="t-brace">{</span>` +
        `<span class="schema-count">${count} prop${count !== 1 ? 's' : ''}</span>` +
        `<div class="schema-body">${props}</div>` +
        `<span class="t-brace">}</span>`
      );
    }

    case 'array': {
      const items = node.items ? renderSchemaNode(node.items, depth + 1) : '<span class="t-unknown">unknown</span>';
      const summary = node.items ? `<span class="schema-count">${node.items.type}[]</span>` : '';
      return (
        `<span class="t-bracket">[</span>` +
        summary +
        `<div class="schema-body">${items}</div>` +
        `<span class="t-bracket">]</span>`
      );
    }

    case 'string':    return '<span class="t-pill t-string">string</span>';
    case 'number':    return '<span class="t-pill t-number">number</span>';
    case 'boolean':   return '<span class="t-pill t-boolean">boolean</span>';
    case 'null':      return '<span class="t-pill t-null">null</span>';
    case 'undefined': return '<span class="t-pill t-null">undefined</span>';
    case '...':       return '<span class="t-ellipsis">…</span>';
    default:          return `<span class="t-pill t-unknown">${escapeHtml(node.type)}</span>`;
  }
}

/**
 * renderDetailPanel
 *
 * Builds the expanded payload panel for a single route.
 *
 * @param {RouteEntry} route
 * @returns {string}
 */
function renderDetailPanel(route) {
  const bodySchema   = route.requestSchema  && route.requestSchema.body;
  const querySchema  = route.requestSchema  && route.requestSchema.query;
  const respSchema   = route.responseSchema;
  const headers      = route.requestHeaders;
  const neverHit     = route.requestSchema === null && route.responseSchema === null && !headers;

  const curlBtn =
    `<button class="copy-curl-btn" ` +
    `data-method="${escapeHtml(route.method)}" ` +
    `data-path="${escapeHtml(route.path)}" ` +
    `data-headers="${escapeHtml(JSON.stringify(headers || null))}" ` +
    `data-body-schema="${escapeHtml(JSON.stringify(bodySchema || null))}" ` +
    `data-query-schema="${escapeHtml(JSON.stringify(querySchema || null))}"` +
    `>Copy as cURL</button>`;

  const llmBtn =
    `<button class="copy-llm-btn" ` +
    `data-method="${escapeHtml(route.method)}" ` +
    `data-path="${escapeHtml(route.path)}" ` +
    `data-params="${escapeHtml(JSON.stringify(route.params || []))}" ` +
    `data-description="${escapeHtml(route.description || '')}" ` +
    `data-headers="${escapeHtml(JSON.stringify(headers || null))}" ` +
    `data-body-schema="${escapeHtml(JSON.stringify(bodySchema || null))}" ` +
    `data-query-schema="${escapeHtml(JSON.stringify(querySchema || null))}" ` +
    `data-response-schema="${escapeHtml(JSON.stringify(respSchema || null))}"` +
    `>Copy for LLM</button>`;

  const toolbar = `<div class="detail-toolbar">${llmBtn}${curlBtn}</div>`;

  if (neverHit) {
    return (
      toolbar +
      `<div class="detail-empty">` +
      `<span class="detail-empty-icon">◎</span>` +
      ` No traffic observed yet — hit this endpoint at least once to capture payload schemas.` +
      `</div>`
    );
  }

  let left = `<div class="detail-col-title">Request</div>`;

  // ── Headers ────────────────────────────────────────────────────────────────
  if (headers && Object.keys(headers).length > 0) {
    left += `<div class="detail-sub">`;
    left += `<span class="detail-sub-label">Headers</span>`;
    left += `<div class="header-list">`;
    for (const [name, value] of Object.entries(headers)) {
      left +=
        `<div class="header-row">` +
        `<span class="header-name">${escapeHtml(name)}</span>` +
        `<span class="header-sep">:</span>` +
        `<span class="header-value">${escapeHtml(value)}</span>` +
        `</div>`;
    }
    left += `</div></div>`;
  }

  // ── Body ───────────────────────────────────────────────────────────────────
  if (BODY_METHODS.has(route.method)) {
    left += `<div class="detail-sub">`;
    left += `<span class="detail-sub-label">Body</span>`;
    left += `<div class="schema-tree">`;
    left += bodySchema
      ? renderSchemaNode(bodySchema)
      : `<span class="schema-none">No body observed</span>`;
    left += `</div></div>`;
  }

  // ── Query ──────────────────────────────────────────────────────────────────
  left += `<div class="detail-sub">`;
  left += `<span class="detail-sub-label">Query</span>`;
  left += `<div class="schema-tree">`;
  left += querySchema
    ? renderSchemaNode(querySchema)
    : `<span class="schema-none">None observed</span>`;
  left += `</div></div>`;

  let right = (
    `<div class="detail-col-title">Response</div>` +
    `<div class="schema-tree">` +
    (respSchema ? renderSchemaNode(respSchema) : `<span class="schema-none">No response observed</span>`) +
    `</div>`
  );

  // ── Errors ─────────────────────────────────────────────────────────────────
  const errors = route.errors;
  if (errors && errors.length > 0) {
    right += `<div class="detail-sub">`;
    right += `<span class="detail-sub-label">Errors</span>`;
    right += `<div class="error-list">`;
    for (const err of errors) {
      const statusClass = err.status >= 500
        ? 'error-status-5xx'
        : err.status >= 400
          ? 'error-status-4xx'
          : 'error-status-other';
      right += `<div class="error-row">`;
      right += `<span class="error-status ${statusClass}">${escapeHtml(String(err.status))}</span>`;
      right += `<div class="error-body">`;
      if (err.description) {
        right += `<span class="error-desc">${escapeHtml(err.description)}</span>`;
      }
      if (err.schema) {
        right += `<div class="schema-tree">${renderSchemaNode(err.schema)}</div>`;
      }
      right += `</div></div>`;
    }
    right += `</div></div>`;
  }

  return (
    toolbar +
    `<div class="detail-cols">` +
    `<div class="detail-col">${left}</div>` +
    `<div class="detail-col">${right}</div>` +
    `</div>`
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * groupRoutes
 *
 * Splits a flat route list into an ordered Map keyed by first path segment.
 * e.g. /users/:id → "users", /admin/stats → "admin"
 *
 * @param {RouteEntry[]} routes
 * @returns {Map<string, RouteEntry[]>}
 */
function groupRoutes(routes) {
  /** @type {Map<string, RouteEntry[]>} */
  const groups = new Map();
  for (const route of routes) {
    const name = route.path.split('/')[1] || 'root';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(route);
  }
  return groups;
}

/**
 * renderGroupTable
 *
 * Produces the route rows for one group. `startIdx` ensures detail-row IDs
 * remain unique across all groups in the page.
 *
 * @param {RouteEntry[]} routes
 * @param {number} startIdx
 * @returns {{ html: string, nextIdx: number }}
 */
function renderGroupTable(routes, startIdx) {
  let html = '';
  let idx  = startIdx;

  for (const route of routes) {
    const style      = METHOD_STYLES[route.method] || { cls: 'method-other' };
    const isCaptured = route.requestSchema !== null || route.responseSchema !== null;

    const paramsHtml = route.params.length > 0
      ? route.params.map((p) => `<span class="param-badge">${escapeHtml(p)}</span>`).join(' ')
      : '<span class="no-params">—</span>';

    const dotCls = isCaptured ? 'dot-live' : 'dot-pending';
    const dotTip = isCaptured ? 'Schemas captured' : 'No traffic observed yet';

    const descHtml = route.description
      ? `<div class="route-desc">${escapeHtml(route.description)}</div>`
      : '';

    html += `
      <tr class="route-row" id="route-${idx}" data-detail="rd-${idx}" data-method="${escapeHtml(route.method)}" data-path="${escapeHtml(route.path)}">
        <td><span class="method-badge ${style.cls}">${escapeHtml(route.method)}</span></td>
        <td class="route-path-cell">
          <div class="route-path">${highlightPath(route.path)}</div>
          ${descHtml}
        </td>
        <td class="route-params">
          <div class="params-row">
            <div>${paramsHtml}</div>
            <div class="row-actions">
              <span class="schema-dot ${dotCls}" title="${dotTip}"></span>
              <span class="chevron">›</span>
            </div>
          </div>
        </td>
      </tr>
      <tr class="route-detail" id="rd-${idx}">
        <td colspan="3">
          <div class="detail-panel">${renderDetailPanel(route)}</div>
        </td>
      </tr>`;

    idx++;
  }

  return { html, nextIdx: idx };
}

/**
 * renderSidebar
 *
 * Renders collapsible group items, each containing a list of routes with
 * method mini-badges and schema-capture status dots.
 *
 * @param {Map<string, RouteEntry[]>} groups
 * @returns {string}
 */
function renderSidebar(groups) {
  let html = '';
  for (const [name, routes] of groups) {
    const liveCount  = routes.filter((r) => r.requestSchema !== null || r.responseSchema !== null).length;
    const totalCount = routes.length;

    html += `<div class="sidebar-group" data-group="${escapeHtml(name)}">`;

    // Group header — clicking toggles the route list
    html +=
      `<button class="sidebar-group-btn" data-group="${escapeHtml(name)}">` +
      `<span class="sidebar-group-arrow">›</span>` +
      `<span class="sidebar-item-name">/${escapeHtml(name)}</span>` +
      `<span class="sidebar-item-badge">${totalCount}</span>` +
      (liveCount > 0 ? `<span class="sidebar-dot-live"></span>` : '') +
      `</button>`;

    // Route list (shown when group is open)
    html += `<div class="sidebar-routes">`;
    for (const route of routes) {
      const style      = METHOD_STYLES[route.method] || { cls: 'method-other' };
      const isCaptured = route.requestSchema !== null || route.responseSchema !== null;
      const dotCls     = isCaptured ? 'dot-live' : 'dot-pending';
      html +=
        `<button class="sidebar-route-item" data-route-method="${escapeHtml(route.method)}" data-route-path="${escapeHtml(route.path)}">` +
        `<span class="method-mini ${style.cls}">${escapeHtml(route.method)}</span>` +
        `<span class="sidebar-route-path">${escapeHtml(route.path)}</span>` +
        `<span class="schema-dot ${dotCls}" title="${isCaptured ? 'Schema captured' : 'No traffic yet'}"></span>` +
        `</button>`;
    }
    html += `</div>`;

    html += `</div>`;
  }
  return html;
}

/**
 * renderGroupSections
 *
 * Produces all `<section class="route-group">` blocks for the main content.
 *
 * @param {Map<string, RouteEntry[]>} groups
 * @param {Record<string, { description?: string }>} groupsMeta
 * @returns {string}
 */
function renderGroupSections(groups, groupsMeta) {
  let html     = '';
  let routeIdx = 0;

  for (const [name, routes] of groups) {
    const count    = routes.length;
    const { html: rows, nextIdx } = renderGroupTable(routes, routeIdx);
    routeIdx = nextIdx;

    const isEmpty   = count === 0;
    const groupDesc = (groupsMeta[name] && groupsMeta[name].description) || '';
    const groupDescHtml = groupDesc
      ? `<p class="group-desc">${escapeHtml(groupDesc)}</p>`
      : '';

    html += `
  <section class="route-group" id="group-${escapeHtml(name)}" data-group="${escapeHtml(name)}">
    <div class="group-header-bar">
      <div class="group-header-left">
        <h2 class="group-title">/${escapeHtml(name)}</h2>
        ${groupDescHtml}
      </div>
      <span class="group-count-badge">${count} route${count !== 1 ? 's' : ''}</span>
    </div>
    <table class="routes-table">
      <thead>
        <tr>
          <th style="width:90px">Method</th>
          <th>Path</th>
          <th style="width:220px">Params</th>
        </tr>
      </thead>
      <tbody class="routes-tbody">
        ${isEmpty
          ? `<tr><td colspan="3" class="empty">No routes in this group.</td></tr>`
          : rows}
      </tbody>
    </table>
  </section>`;
  }

  return html;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * serveDocsUI
 *
 * Generates a complete, self-contained HTML page with a left sidebar that
 * groups routes by their first path segment. No external CDN dependencies.
 *
 * @param {RouteEntry[]} routes
 * @param {NormalizedConfig} config
 * @returns {string} Full HTML document
 */
function serveDocsUI(routes, config) {
  const { meta }    = config;
  const generatedAt = new Date().toUTCString();
  const totalRoutes = routes.length;
  const liveCount   = routes.filter((r) => r.requestSchema !== null || r.responseSchema !== null).length;

  const groups         = groupRoutes(routes);
  const sidebarHtml    = renderSidebar(groups);
  const sectionsHtml   = groups.size > 0
    ? renderGroupSections(groups, config.groups || {})
    : `<p class="empty-state">No routes discovered. Make sure your routes are defined before the docs endpoint is first requested.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(meta.title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:         #0f1117;
      --bg-surface: #1a1f2e;
      --bg-header:  #16213e;
      --bg-detail:  #111520;
      --bg-sidebar: #0d1016;
      --border:     #2d3748;
      --border-sub: #1e2535;
      --text:       #e2e8f0;
      --text-muted: #718096;
      --text-dim:   #4a5568;
      --accent:     #4299e1;
      --sidebar-w:  220px;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* ── Header ─────────────────────────────────────────────────────────────── */
    header {
      background: linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-header) 100%);
      border-bottom: 1px solid var(--border);
      padding: 24px 32px;
      flex-shrink: 0;
    }
    .header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .header-left { display: flex; flex-direction: column; gap: 4px; }
    .header-title { font-size: 1.45rem; font-weight: 700; color: #fff; }
    .header-desc  { font-size: 0.8rem; color: var(--text-muted); }
    .header-meta  { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .badge {
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.03em;
    }
    .badge-version { background: #2d3748; color: #a0aec0; }
    .badge-count   { background: #1a3a5c; color: #61affe; }
    .badge-live    { background: #1a3d2b; color: #48bb78; }

    /* ── App shell ───────────────────────────────────────────────────────────── */
    .app-shell {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    /* ── Sidebar ─────────────────────────────────────────────────────────────── */
    .sidebar {
      width: var(--sidebar-w);
      min-width: var(--sidebar-w);
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }

    .sidebar-search {
      padding: 14px 12px 10px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    #search {
      width: 100%;
      padding: 8px 12px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.8rem;
      outline: none;
      transition: border-color 0.2s;
    }
    #search::placeholder { color: var(--text-dim); }
    #search:focus { border-color: var(--accent); }

    .sidebar-label {
      padding: 14px 14px 6px;
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--text-dim);
      font-weight: 600;
    }

    .sidebar-nav { padding: 4px 8px 16px; }

    /* ── Sidebar group (collapsible) ─────────────────────────────────────────── */
    .sidebar-group { margin-bottom: 2px; }

    .sidebar-group-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 7px 10px;
      border-radius: 6px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s, color 0.15s;
    }
    .sidebar-group-btn:hover { background: rgba(255,255,255,0.05); color: var(--text); }
    .sidebar-group.is-active > .sidebar-group-btn { background: rgba(66,153,225,0.1); color: #63b3ed; }

    .sidebar-group-arrow {
      flex-shrink: 0;
      color: var(--text-dim);
      font-size: 0.85rem;
      line-height: 1;
      transition: transform 0.15s;
      display: inline-block;
    }
    .sidebar-group.is-open > .sidebar-group-btn > .sidebar-group-arrow { transform: rotate(90deg); }

    /* ── Sidebar route list ───────────────────────────────────────────────────── */
    .sidebar-routes {
      display: none;
      padding: 2px 6px 4px 18px;
      border-left: 1px solid var(--border-sub);
      margin: 2px 8px 4px 16px;
    }
    .sidebar-group.is-open > .sidebar-routes { display: block; }

    .sidebar-route-item {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 4px 6px;
      border-radius: 4px;
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 0.74rem;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s, color 0.12s;
      margin-bottom: 1px;
    }
    .sidebar-route-item:hover { background: rgba(255,255,255,0.04); color: var(--text-muted); }
    .sidebar-route-item.is-active { color: var(--text); background: rgba(66,153,225,0.08); }

    .sidebar-route-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.71rem;
    }

    /* ── Method mini-badge (sidebar) ─────────────────────────────────────────── */
    .method-mini {
      flex-shrink: 0;
      display: inline-block;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.56rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      min-width: 36px;
      text-align: center;
    }

    /* ── Shared sidebar text/badge styles ────────────────────────────────────── */
    .sidebar-item-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.79rem;
    }
    .sidebar-item-badge {
      flex-shrink: 0;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      color: var(--text-dim);
      border-radius: 10px;
      padding: 1px 7px;
      font-size: 0.67rem;
      font-weight: 600;
    }
    .sidebar-group.is-active > .sidebar-group-btn .sidebar-item-badge {
      background: rgba(66,153,225,0.15);
      border-color: rgba(66,153,225,0.3);
      color: #63b3ed;
    }
    .sidebar-dot-live {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #48bb78;
      flex-shrink: 0;
      box-shadow: 0 0 4px rgba(72,187,120,0.6);
    }

    /* ── Main content ────────────────────────────────────────────────────────── */
    .content {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      padding: 28px 36px 64px;
    }

    /* ── Route group section ─────────────────────────────────────────────────── */
    .route-group {
      margin-bottom: 40px;
    }
    .route-group:last-child { margin-bottom: 0; }

    .group-header-bar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .group-header-left { display: flex; flex-direction: column; gap: 4px; }
    .group-title {
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--text);
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .group-desc {
      font-size: 0.8rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .group-count-badge {
      font-size: 0.72rem;
      color: var(--text-dim);
      font-weight: 400;
      white-space: nowrap;
      padding-top: 3px;
    }

    /* ── Table ───────────────────────────────────────────────────────────────── */
    .routes-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-surface);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 16px rgba(0,0,0,0.35);
    }
    thead th {
      background: var(--bg-header);
      color: var(--text-muted);
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 10px 18px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    /* ── Route row ───────────────────────────────────────────────────────────── */
    .route-row td {
      padding: 12px 18px;
      border-bottom: 1px solid var(--border-sub);
      vertical-align: middle;
    }
    .route-row:last-child td { border-bottom: none; }
    .route-row { cursor: pointer; user-select: none; }
    .route-row:hover td { background: #1d2640; }
    .route-row.is-expanded td { background: #1d2640; border-bottom: none; }

    /* ── Method badges ───────────────────────────────────────────────────────── */
    .method-badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 4px;
      font-size: 0.67rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      min-width: 60px;
      text-align: center;
    }
    .method-get     { background: rgba(97,175,254,0.15); color: #61affe; }
    .method-post    { background: rgba(73,204,144,0.15); color: #49cc90; }
    .method-put     { background: rgba(252,161,48,0.15);  color: #fca130; }
    .method-patch   { background: rgba(80,227,194,0.15);  color: #50e3c2; }
    .method-delete  { background: rgba(249,62,62,0.15);   color: #f93e3e; }
    .method-options { background: rgba(13,90,167,0.15);   color: #4a9de0; }
    .method-head    { background: rgba(144,18,254,0.15);  color: #c084fc; }
    .method-other   { background: rgba(160,160,160,0.15); color: #a0aec0; }

    /* ── Path column ─────────────────────────────────────────────────────────── */
    .route-path-cell { vertical-align: middle; }
    .route-path {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.85rem;
      color: var(--text);
    }
    .route-path .param { color: #f6ad55; }
    .route-desc {
      font-size: 0.77rem;
      color: var(--text-muted);
      margin-top: 3px;
      line-height: 1.4;
    }

    /* ── Params column ───────────────────────────────────────────────────────── */
    .route-params { width: 220px; }
    .params-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .row-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .param-badge {
      display: inline-block;
      background: rgba(246,173,85,0.12);
      color: #f6ad55;
      border: 1px solid rgba(246,173,85,0.28);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 0.68rem;
      font-family: monospace;
      margin: 1px 2px 1px 0;
    }
    .no-params { color: var(--text-dim); font-size: 0.78rem; }

    /* ── Schema dot indicator ────────────────────────────────────────────────── */
    .schema-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot-live    { background: #48bb78; box-shadow: 0 0 5px rgba(72,187,120,0.5); }
    .dot-pending { background: #2d3748; }

    /* ── Chevron ─────────────────────────────────────────────────────────────── */
    .chevron {
      color: var(--text-dim);
      font-size: 1rem;
      line-height: 1;
      transition: transform 0.18s ease, color 0.18s;
      display: inline-block;
    }
    .route-row.is-expanded .chevron { transform: rotate(90deg); color: #a0aec0; }

    /* ── Detail row ──────────────────────────────────────────────────────────── */
    .route-detail { display: none; }
    .route-detail.is-open { display: table-row; }
    .route-detail > td { padding: 0 !important; border-bottom: 1px solid var(--border) !important; }
    .detail-panel { padding: 18px 22px 22px; background: var(--bg-detail); }

    .detail-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
    .detail-col-title {
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      font-weight: 600;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border-sub);
    }
    .detail-sub { margin-bottom: 16px; }
    .detail-sub:last-child { margin-bottom: 0; }
    .detail-sub-label {
      display: inline-block;
      font-size: 0.63rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 1px 7px;
      margin-bottom: 9px;
      font-weight: 600;
    }

    .detail-empty { color: var(--text-dim); font-size: 0.82rem; padding: 2px 0; }
    .detail-empty-icon { margin-right: 6px; }

    /* ── Schema tree ─────────────────────────────────────────────────────────── */
    .schema-tree {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.79rem;
      line-height: 1.8;
      background: rgba(0,0,0,0.18);
      border: 1px solid var(--border-sub);
      border-radius: 6px;
      padding: 10px 14px;
    }
    .schema-body {
      padding-left: 16px;
      border-left: 1px solid var(--border-sub);
      margin-left: 2px;
    }
    .schema-prop { display: block; }
    .schema-key  { color: #cbd5e0; }
    .prop-optional { color: var(--text-dim); font-size: 0.9em; }
    .schema-sep  { color: var(--text-dim); }
    .schema-count {
      display: inline-block;
      font-size: 0.62rem;
      color: var(--text-dim);
      margin-left: 7px;
      vertical-align: middle;
      font-style: italic;
    }
    .t-brace     { color: var(--text-muted); }
    .t-bracket   { color: var(--text-muted); }
    /* Pill-style type labels for primitives */
    .t-pill {
      display: inline-block;
      padding: 0px 6px;
      border-radius: 3px;
      font-size: 0.72rem;
      font-weight: 600;
      line-height: 1.6;
      vertical-align: baseline;
    }
    .t-string    { background: rgba(104,211,145,0.12); color: #68d391; border: 1px solid rgba(104,211,145,0.2); }
    .t-number    { background: rgba(99,179,237,0.12);  color: #63b3ed; border: 1px solid rgba(99,179,237,0.2); }
    .t-boolean   { background: rgba(246,173,85,0.12);  color: #f6ad55; border: 1px solid rgba(246,173,85,0.2); }
    .t-null      { background: rgba(113,128,150,0.1);  color: #718096; border: 1px solid rgba(113,128,150,0.15); }
    .t-unknown   { color: var(--text-dim); }
    .t-ellipsis  { color: var(--text-dim); }
    .schema-none { color: #2d3748; font-style: italic; }

    /* ── Header list ─────────────────────────────────────────────────────────── */
    .header-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.79rem;
    }
    .header-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 4px 8px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border-sub);
      border-radius: 4px;
    }
    .header-name {
      color: #63b3ed;
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .header-sep {
      color: var(--text-dim);
      flex-shrink: 0;
    }
    .header-value {
      color: #a0aec0;
      word-break: break-all;
    }

    /* ── Error list ──────────────────────────────────────────────────────────── */
    .error-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .error-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 6px 10px;
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border-sub);
      border-radius: 4px;
    }
    .error-status {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.78rem;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
      padding: 1px 6px;
      border-radius: 3px;
    }
    .error-status-4xx { color: #f6ad55; background: rgba(246,173,85,0.1); border: 1px solid rgba(246,173,85,0.25); }
    .error-status-5xx { color: #fc8181; background: rgba(252,129,129,0.1); border: 1px solid rgba(252,129,129,0.25); }
    .error-status-other { color: #a0aec0; background: rgba(160,174,192,0.1); border: 1px solid rgba(160,174,192,0.2); }
    .error-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .error-desc {
      font-size: 0.79rem;
      color: var(--text-muted);
    }

    /* ── Detail toolbar ─────────────────────────────────────────────────────── */
    .detail-toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 14px;
    }
    .copy-curl-btn, .copy-llm-btn {
      padding: 4px 12px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text-muted);
      font-size: 0.71rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      font-family: inherit;
    }
    .copy-llm-btn:hover {
      background: rgba(192,132,252,0.1);
      color: #c084fc;
      border-color: rgba(192,132,252,0.3);
    }
    .copy-llm-btn.copied {
      background: rgba(72,187,120,0.1);
      color: #48bb78;
      border-color: rgba(72,187,120,0.3);
    }
    .copy-curl-btn:hover {
      background: rgba(66,153,225,0.1);
      color: #63b3ed;
      border-color: rgba(66,153,225,0.3);
    }
    .copy-curl-btn.copied {
      background: rgba(72,187,120,0.1);
      color: #48bb78;
      border-color: rgba(72,187,120,0.3);
    }

    /* ── Export to Postman button ──────────────────────────────────────────── */
    .export-postman-btn {
      padding: 5px 14px;
      border-radius: 5px;
      border: 1px solid rgba(255,110,90,0.35);
      background: rgba(255,110,90,0.08);
      color: #ff6e5a;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      font-family: inherit;
      letter-spacing: 0.02em;
    }
    .export-postman-btn:hover {
      background: rgba(255,110,90,0.16);
      border-color: rgba(255,110,90,0.5);
      color: #ff8a78;
    }

    /* ── Empty states ────────────────────────────────────────────────────────── */
    .empty { text-align: center; padding: 36px 20px; color: var(--text-dim); font-size: 0.84rem; }
    .empty-state { color: var(--text-dim); font-size: 0.875rem; padding: 48px 0; text-align: center; }

    /* ── Footer ──────────────────────────────────────────────────────────────── */
    footer {
      text-align: center;
      padding: 14px;
      color: var(--text-dim);
      font-size: 0.7rem;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
  </style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="header-left">
      <h1 class="header-title">${escapeHtml(meta.title)}</h1>
      ${meta.description ? `<p class="header-desc">${escapeHtml(meta.description)}</p>` : ''}
    </div>
    <div class="header-meta">
      <span class="badge badge-version">v${escapeHtml(meta.version)}</span>
      <span class="badge badge-count">${totalRoutes} route${totalRoutes !== 1 ? 's' : ''}</span>
      ${liveCount > 0 ? `<span class="badge badge-live">${liveCount} with schemas</span>` : ''}
      <button id="export-postman-btn" class="export-postman-btn">Export to Postman</button>
    </div>
  </div>
</header>

<div class="app-shell">

  <aside class="sidebar" id="sidebar">
    <div class="sidebar-search">
      <input id="search" type="text" placeholder="Filter routes…" autocomplete="off" spellcheck="false" />
    </div>
    <div class="sidebar-label">Groups</div>
    <nav class="sidebar-nav" id="sidebar-nav">
      ${sidebarHtml}
    </nav>
  </aside>

  <main class="content" id="content">
    ${sectionsHtml}
  </main>

</div>

<footer>
  Generated by <strong>doctreen</strong> &mdash; ${generatedAt}
  &nbsp;·&nbsp; Click any row to expand payload schemas
</footer>

<script>
(function () {
  var content     = document.getElementById('content');
  var sidebarNav  = document.getElementById('sidebar-nav');
  var searchInput = document.getElementById('search');
  var ROUTES = ${JSON.stringify(routes)};
  var META   = ${JSON.stringify({ title: meta.title, version: meta.version, description: meta.description })};

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function expandDetailRow(row) {
    var tbody    = row.closest('tbody');
    var detailId = row.getAttribute('data-detail');
    var detailRow = detailId ? document.getElementById(detailId) : null;
    if (!detailRow) return;
    tbody.querySelectorAll('tr.route-row.is-expanded').forEach(function (r) {
      if (r === row) return;
      r.classList.remove('is-expanded');
      var d = document.getElementById(r.getAttribute('data-detail') || '');
      if (d) d.classList.remove('is-open');
    });
    row.classList.add('is-expanded');
    detailRow.classList.add('is-open');
  }

  // ── Expand / collapse detail rows (click on table row) ───────────────────────
  content.addEventListener('click', function (e) {
    var row = e.target.closest('tr.route-row');
    if (!row) return;

    var tbody     = row.closest('tbody');
    var detailId  = row.getAttribute('data-detail');
    var detailRow = detailId ? document.getElementById(detailId) : null;
    if (!detailRow) return;

    var wasOpen = row.classList.contains('is-expanded');

    tbody.querySelectorAll('tr.route-row.is-expanded').forEach(function (r) {
      if (r === row) return;
      r.classList.remove('is-expanded');
      var d = document.getElementById(r.getAttribute('data-detail') || '');
      if (d) d.classList.remove('is-open');
    });

    row.classList.toggle('is-expanded', !wasOpen);
    detailRow.classList.toggle('is-open', !wasOpen);
  });

  // ── Sidebar: group toggle ────────────────────────────────────────────────────
  sidebarNav.addEventListener('click', function (e) {
    var btn = e.target.closest('.sidebar-group-btn');
    if (btn) {
      var group = btn.closest('.sidebar-group');
      if (group) group.classList.toggle('is-open');
      return;
    }

    // ── Sidebar: route item click → scroll + expand ──────────────────────────
    var routeBtn = e.target.closest('.sidebar-route-item');
    if (routeBtn) {
      var method    = routeBtn.getAttribute('data-route-method');
      var path      = routeBtn.getAttribute('data-route-path');
      var targetRow = content.querySelector(
        'tr.route-row[data-method="' + method + '"][data-path="' + CSS.escape(path) + '"]'
      );
      if (!targetRow) return;

      // Mark active on route item
      sidebarNav.querySelectorAll('.sidebar-route-item.is-active').forEach(function (el) {
        el.classList.remove('is-active');
      });
      routeBtn.classList.add('is-active');

      expandDetailRow(targetRow);
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // ── Sidebar active group via IntersectionObserver ────────────────────────────
  var sections   = content.querySelectorAll('.route-group');
  var groupElMap = {};
  sidebarNav.querySelectorAll('.sidebar-group').forEach(function (el) {
    groupElMap[el.getAttribute('data-group')] = el;
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var group = entry.target.getAttribute('data-group');
      var el    = groupElMap[group];
      if (!el) return;
      if (entry.isIntersecting) {
        el.classList.add('is-active');
        el.classList.add('is-open'); // auto-expand when scrolled into view
      } else {
        el.classList.remove('is-active');
      }
    });
  }, { root: content, threshold: 0.05 });

  sections.forEach(function (sec) { observer.observe(sec); });

  // Open first group by default
  var firstGroup = sidebarNav.querySelector('.sidebar-group');
  if (firstGroup) firstGroup.classList.add('is-open');

  // ── Live filter ─────────────────────────────────────────────────────────────
  function applyFilter(q) {
    q = q.toLowerCase().trim();

    content.querySelectorAll('.route-group').forEach(function (section) {
      var groupName   = section.getAttribute('data-group');
      var sidebarGrp  = groupElMap[groupName];
      var hasVisible  = false;

      section.querySelectorAll('tr.route-row').forEach(function (row) {
        var match = q === '' || row.textContent.toLowerCase().includes(q);
        row.style.display = match ? '' : 'none';

        var detailId = row.getAttribute('data-detail');
        if (detailId) {
          var detail = document.getElementById(detailId);
          if (detail) detail.style.display = !match ? 'none' : '';
        }

        // Keep sidebar route item visibility in sync
        if (sidebarGrp) {
          var method = row.getAttribute('data-method');
          var path   = row.getAttribute('data-path');
          var sidebarRoute = sidebarGrp.querySelector(
            '.sidebar-route-item[data-route-method="' + method + '"][data-route-path="' + path + '"]'
          );
          if (sidebarRoute) sidebarRoute.style.display = match ? '' : 'none';
        }

        if (match) hasVisible = true;
      });

      section.style.display = hasVisible || q === '' ? '' : 'none';
      if (sidebarGrp) sidebarGrp.style.display = hasVisible || q === '' ? '' : 'none';
    });
  }

  searchInput.addEventListener('input', function () { applyFilter(this.value); });

  // ── Copy as cURL ─────────────────────────────────────────────────────────────

  function schemaToExample(node) {
    if (!node) return null;
    switch (node.type) {
      case 'object': {
        var obj = {};
        if (node.properties) {
          Object.keys(node.properties).forEach(function (k) {
            obj[k] = schemaToExample(node.properties[k]);
          });
        }
        return obj;
      }
      case 'array':   return node.items ? [schemaToExample(node.items)] : [];
      case 'string':  return 'string';
      case 'number':  return 0;
      case 'boolean': return true;
      default:        return null;
    }
  }

  function buildCurlCommand(method, path, headers, bodySchema, querySchema) {
    var baseUrl = window.location.origin;
    var isBodyMethod = method === 'POST' || method === 'PUT' || method === 'PATCH';
    var parts = ['curl -s'];

    if (method !== 'GET' && method !== 'HEAD') {
      parts.push('-X ' + method);
    }

    var hasContentType = false;
    if (headers) {
      Object.keys(headers).forEach(function (name) {
        parts.push("-H '" + name + ': ' + headers[name] + "'");
        if (name.toLowerCase() === 'content-type') hasContentType = true;
      });
    }

    if (isBodyMethod && bodySchema && !hasContentType) {
      parts.push("-H 'Content-Type: application/json'");
    }

    if (isBodyMethod && bodySchema) {
      var json = JSON.stringify(schemaToExample(bodySchema));
      parts.push("-d '" + json.replace(/'/g, "'\\''") + "'");
    }

    var url = baseUrl + path;
    if (querySchema && querySchema.properties) {
      var qkeys = Object.keys(querySchema.properties);
      if (qkeys.length > 0) {
        var qparams = qkeys.map(function (k) {
          var t = querySchema.properties[k] ? querySchema.properties[k].type : 'string';
          return k + '=' + (t === 'number' ? '0' : t === 'boolean' ? 'true' : k);
        });
        url += '?' + qparams.join('&');
      }
    }

    parts.push("'" + url + "'");
    return parts.join(' \\\\' + String.fromCharCode(10) + '  ');
  }

  content.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-curl-btn');
    if (!btn) return;
    e.stopPropagation();

    var method      = btn.getAttribute('data-method');
    var path        = btn.getAttribute('data-path');
    var headers     = JSON.parse(btn.getAttribute('data-headers') || 'null');
    var bodySchema  = JSON.parse(btn.getAttribute('data-body-schema') || 'null');
    var querySchema = JSON.parse(btn.getAttribute('data-query-schema') || 'null');
    var cmd         = buildCurlCommand(method, path, headers, bodySchema, querySchema);

    function onCopied() {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function () {
        btn.textContent = 'Copy as cURL';
        btn.classList.remove('copied');
      }, 1500);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd).then(onCopied).catch(function () {
        fallbackCopy(cmd, onCopied);
      });
    } else {
      fallbackCopy(cmd, onCopied);
    }
  });

  // ── Copy for LLM ─────────────────────────────────────────────────────────────

  function schemaTypeLabel(node) {
    if (!node) return 'unknown';
    if (node.type === 'array') return (node.items ? schemaTypeLabel(node.items) : 'unknown') + '[]';
    return node.type;
  }

  function schemaPropsToLines(properties, indent) {
    if (!properties) return [];
    return Object.keys(properties).reduce(function (acc, k) {
      var v = properties[k];
      var suffix = v.optional ? ' (optional)' : '';
      if (v.type === 'object' && v.properties && Object.keys(v.properties).length > 0) {
        acc.push(indent + '- ' + k + ': object' + suffix);
        schemaPropsToLines(v.properties, indent + '  ').forEach(function (l) { acc.push(l); });
      } else {
        acc.push(indent + '- ' + k + ': ' + schemaTypeLabel(v) + suffix);
      }
      return acc;
    }, []);
  }

  function buildLLMPrompt(method, path, params, description, headers, bodySchema, querySchema, responseSchema) {
    var lines = [];

    lines.push('## ' + method + ' ' + path);

    if (description) {
      lines.push('');
      lines.push(description);
    }

    if (params && params.length > 0) {
      lines.push('');
      lines.push('### Path Parameters');
      params.forEach(function (p) { lines.push('- ' + p + ': string'); });
    }

    if (headers && Object.keys(headers).length > 0) {
      lines.push('');
      lines.push('### Request Headers');
      Object.keys(headers).forEach(function (name) { lines.push('- ' + name + ': ' + headers[name]); });
    }

    if (querySchema && querySchema.properties && Object.keys(querySchema.properties).length > 0) {
      lines.push('');
      lines.push('### Query Parameters');
      schemaPropsToLines(querySchema.properties, '').forEach(function (l) { lines.push(l); });
    }

    if (bodySchema && bodySchema.properties && Object.keys(bodySchema.properties).length > 0) {
      lines.push('');
      lines.push('### Request Body (JSON)');
      schemaPropsToLines(bodySchema.properties, '').forEach(function (l) { lines.push(l); });
    }

    if (responseSchema) {
      lines.push('');
      lines.push('### Response');
      if (responseSchema.type === 'object' && responseSchema.properties) {
        schemaPropsToLines(responseSchema.properties, '').forEach(function (l) { lines.push(l); });
      } else if (responseSchema.type === 'array') {
        var itemLabel = responseSchema.items ? schemaTypeLabel(responseSchema.items) : 'unknown';
        lines.push('Array of ' + itemLabel);
        if (responseSchema.items && responseSchema.items.type === 'object' && responseSchema.items.properties) {
          schemaPropsToLines(responseSchema.items.properties, '  ').forEach(function (l) { lines.push(l); });
        }
      } else {
        lines.push(schemaTypeLabel(responseSchema));
      }
    }

    return lines.join(String.fromCharCode(10));
  }

  content.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-llm-btn');
    if (!btn) return;
    e.stopPropagation();

    var method         = btn.getAttribute('data-method');
    var path           = btn.getAttribute('data-path');
    var params         = JSON.parse(btn.getAttribute('data-params') || '[]');
    var description    = btn.getAttribute('data-description') || '';
    var headers        = JSON.parse(btn.getAttribute('data-headers') || 'null');
    var bodySchema     = JSON.parse(btn.getAttribute('data-body-schema') || 'null');
    var querySchema    = JSON.parse(btn.getAttribute('data-query-schema') || 'null');
    var responseSchema = JSON.parse(btn.getAttribute('data-response-schema') || 'null');
    var prompt         = buildLLMPrompt(method, path, params, description, headers, bodySchema, querySchema, responseSchema);

    function onCopied() {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function () {
        btn.textContent = 'Copy for LLM';
        btn.classList.remove('copied');
      }, 1500);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(prompt).then(onCopied).catch(function () { fallbackCopy(prompt, onCopied); });
    } else {
      fallbackCopy(prompt, onCopied);
    }
  });

  // ── Export to Postman ──────────────────────────────────────────────────────

  function buildPostmanCollection() {
    var groups = {};
    var groupOrder = [];
    ROUTES.forEach(function (route) {
      var group = route.path.split('/')[1] || 'root';
      if (!groups[group]) { groups[group] = []; groupOrder.push(group); }
      groups[group].push(route);
    });

    var items = groupOrder.map(function (groupName) {
      var groupItems = groups[groupName].map(function (route) {
        var pathSegments = route.path.split('/').filter(Boolean);
        var rawUrl = '{{baseUrl}}' + route.path;
        var urlObj = {
          raw: rawUrl,
          host: ['{{baseUrl}}'],
          path: pathSegments,
        };

        var pathVars = (route.params || []).map(function (p) {
          return { key: p, value: '' };
        });
        if (pathVars.length > 0) urlObj.variable = pathVars;

        var querySchema = route.requestSchema && route.requestSchema.query;
        if (querySchema && querySchema.properties) {
          var qkeys = Object.keys(querySchema.properties);
          if (qkeys.length > 0) {
            urlObj.query = qkeys.map(function (k) { return { key: k, value: '', disabled: false }; });
            urlObj.raw = rawUrl + '?' + qkeys.map(function (k) { return k + '='; }).join('&');
          }
        }

        var headers = [];
        if (route.requestHeaders) {
          Object.keys(route.requestHeaders).forEach(function (name) {
            headers.push({ key: name, value: route.requestHeaders[name], type: 'text' });
          });
        }

        var body = null;
        var bodySchema = route.requestSchema && route.requestSchema.body;
        var isBodyMethod = route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH';
        if (isBodyMethod) {
          var hasContentType = headers.some(function (h) { return h.key.toLowerCase() === 'content-type'; });
          if (bodySchema && !hasContentType) {
            headers.unshift({ key: 'Content-Type', value: 'application/json', type: 'text' });
          }
          body = {
            mode: 'raw',
            raw: JSON.stringify(schemaToExample(bodySchema), null, 2) || '{}',
            options: { raw: { language: 'json' } },
          };
        }

        var request = { method: route.method, header: headers, url: urlObj };
        if (route.description) request.description = route.description;
        if (body) request.body = body;

        var responses = [];
        if (route.errors && route.errors.length > 0) {
          route.errors.forEach(function (err) {
            var exampleBody = err.schema ? JSON.stringify(schemaToExample(err.schema), null, 2) : '';
            responses.push({
              name: err.status + (err.description ? ' ' + err.description : ''),
              originalRequest: request,
              status: String(err.status),
              code: err.status,
              _postman_previewlanguage: 'json',
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: exampleBody,
            });
          });
        }

        return { name: route.method + ' ' + route.path, request: request, response: responses };
      });

      return { name: '/' + groupName, item: groupItems };
    });

    return {
      info: {
        name: META.title,
        _postman_id: 'doclib-' + Date.now(),
        description: META.description || '',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: items,
      variable: [{ key: 'baseUrl', value: window.location.origin, type: 'string' }],
    };
  }

  document.getElementById('export-postman-btn').addEventListener('click', function () {
    var collection = buildPostmanCollection();
    var json = JSON.stringify(collection, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (META.title || 'api').replace(/[^a-zA-Z0-9_-]/g, '_') + '_postman_collection.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  function fallbackCopy(text, cb) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); cb(); } catch (_) {}
    document.body.removeChild(ta);
  }
})();
</script>

</body>
</html>`;
}

module.exports = { serveDocsUI };
