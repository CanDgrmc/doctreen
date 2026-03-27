'use strict';

// ─── JSDoc typedefs ───────────────────────────────────────────────────────────

/**
 * @typedef {import('../index').RouteEntry}       RouteEntry
 * @typedef {import('../index').SchemaNode}       SchemaNode
 * @typedef {import('../index').NormalizedConfig} NormalizedConfig
 * @typedef {import('../flows').FlowDefinition}   FlowDefinition
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

/**
 * @param {FlowDefinition[]} flows
 * @returns {string}
 */
function renderFlowSidebar(flows) {
  if (!flows || flows.length === 0) return '';

  let html = '';
  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i];
    const stepCount = Array.isArray(flow.steps) ? flow.steps.length : 0;
    html +=
      `<button class="sidebar-flow-item" data-flow-index="${i}">` +
      `<span class="sidebar-flow-name">${escapeHtml(flow.name)}</span>` +
      `<span class="sidebar-item-badge">${stepCount}</span>` +
      `</button>`;
  }
  return html;
}

/**
 * @param {FlowDefinition[]} flows
 * @returns {string}
 */
function renderFlowSections(flows) {
  if (!flows || flows.length === 0) return '';

  let html = `
  <section class="flow-group" id="flow-group" data-group="flows">
    <div class="group-header-bar">
      <div class="group-header-left">
        <h2 class="group-title">Flows</h2>
        <p class="group-desc">Run named request flows through the shared server-side flow engine.</p>
      </div>
      <span class="group-count-badge">${flows.length} flow${flows.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="flow-creator-card" id="flow-creator-card">
      <div class="flow-creator-header">
        <div>
          <h3 class="flow-creator-title">Flow Creator</h3>
          <p class="flow-creator-desc">Select documented routes, configure steps, and export a reusable flow JSON draft.</p>
        </div>
        <span class="flow-info-badge">Builder</span>
      </div>
      <div class="flow-creator-grid">
        <label class="flow-input-row">
          <span class="flow-input-label">Flow name</span>
          <input class="flow-input" id="creator-flow-name" placeholder="User onboarding" />
        </label>
        <label class="flow-input-row">
          <span class="flow-input-label">Description</span>
          <input class="flow-input" id="creator-flow-description" placeholder="Create, fetch, and verify a user." />
        </label>
        <label class="flow-input-row">
          <span class="flow-input-label">baseUrl template</span>
          <input class="flow-base-url" id="creator-flow-base-url" placeholder="{{env.baseUrl}}" />
        </label>
        <label class="flow-input-row">
          <span class="flow-input-label">Environment JSON</span>
          <textarea class="creator-step-textarea" id="creator-flow-env">{
  "baseUrl": "http://localhost:3000"
}</textarea>
        </label>
        <label class="flow-input-row creator-step-full">
          <span class="flow-input-label">Inputs JSON</span>
          <textarea class="creator-step-textarea" id="creator-flow-inputs">{
  "email": { "type": "string", "required": true }
}</textarea>
        </label>
      </div>
      <div class="flow-creator-toolbar">
        <select class="flow-route-select" id="creator-route-select">
          <option value="">Select a documented route…</option>
        </select>
        <button class="creator-add-step-btn" id="creator-add-step-btn" type="button">Add route as step</button>
        <button class="creator-export-btn" id="creator-export-btn" type="button">Export flow JSON</button>
        <span class="creator-helper-status" id="creator-helper-status">Pick route steps, then insert <code>{{input.*}}</code>, <code>{{env.*}}</code>, or prior <code>{{vars.*}}</code> into the focused field.</span>
      </div>
      <div class="flow-creator-layout">
        <div class="flow-creator-panel">
          <div class="detail-col-title">Draft Steps</div>
          <div class="creator-step-list" id="creator-step-list">
            <div class="flow-empty-note">No steps yet. Pick a route and add it to the flow.</div>
          </div>
        </div>
        <div class="flow-creator-panel">
          <div class="detail-col-title">Generated JSON</div>
          <pre class="flow-result is-active" id="creator-flow-json">{
  "version": 1,
  "name": "",
  "description": "",
  "baseUrl": "{{env.baseUrl}}",
  "env": {
    "baseUrl": "http://localhost:3000"
  },
  "inputs": {
    "email": { "type": "string", "required": true }
  },
  "steps": []
}</pre>
        </div>
      </div>
    </div>
    <div class="flow-info-card is-collapsed" id="flow-info-card">
      <button class="flow-info-toggle" id="flow-info-toggle" type="button" aria-expanded="false">
        <span class="flow-info-header">
          <span class="flow-info-title-wrap">
            <h3 class="flow-info-title">How To Create Flows</h3>
            <span class="flow-info-badge">Guide</span>
          </span>
          <span class="flow-info-toggle-text">Expand</span>
        </span>
      </button>
      <div class="flow-info-content">
      <div class="flow-info-grid">
        <div class="flow-info-block">
          <div class="flow-info-block-title">1. Start With A Scenario</div>
          <p class="flow-info-text">Create one flow for one named piece of logic, such as <code>User onboarding</code>, <code>Login smoke</code>, or <code>Checkout happy path</code>. Keep the sequence focused and ordered.</p>
        </div>
        <div class="flow-info-block">
          <div class="flow-info-block-title">2. Define Inputs</div>
          <p class="flow-info-text">Use <code>inputs</code> for values the runner should ask for at runtime, such as <code>email</code>, <code>name</code>, or <code>tenantId</code>. Mark required inputs with <code>"required": true</code>.</p>
        </div>
        <div class="flow-info-block">
          <div class="flow-info-block-title">3. Chain Requests With Vars</div>
          <p class="flow-info-text">Use <code>extract</code> to capture values from a response, then reuse them in later steps with <code>{{vars.someName}}</code>. Common examples are IDs, tokens, and timestamps.</p>
        </div>
        <div class="flow-info-block">
          <div class="flow-info-block-title">4. Add Assertions</div>
          <p class="flow-info-text">Each step should validate the expected behavior. Start with <code>status</code>, then add body checks like <code>"$.id"</code> or <code>"$.email"</code>. This keeps the same flow useful as an integration test.</p>
        </div>
      </div>
      <div class="flow-info-subgrid">
        <div class="flow-info-block">
          <div class="flow-info-block-title">Variable Namespaces</div>
          <ul class="flow-info-list">
            <li><code>{{input.email}}</code>: runtime values entered in the UI or CLI</li>
            <li><code>{{vars.userId}}</code>: values extracted from previous steps</li>
            <li><code>{{env.baseUrl}}</code>: environment values loaded from the flow or env file</li>
          </ul>
          <pre class="flow-info-pre">{
  "baseUrl": "{{env.baseUrl}}",
  "request": {
    "path": "/users/{{vars.userId}}",
    "body": {
      "email": "{{input.email}}"
    }
  }
}</pre>
        </div>
        <div class="flow-info-block">
          <div class="flow-info-block-title">Minimal Step Shape</div>
          <pre class="flow-info-pre">{
  "id": "create-user",
  "request": {
    "method": "POST",
    "path": "/users",
    "body": { "email": "{{input.email}}" }
  },
  "extract": {
    "userId": { "from": "body", "path": "$.id" }
  },
  "assert": {
    "status": 201
  }
}</pre>
        </div>
      </div>
      <div class="flow-info-subgrid">
        <div class="flow-info-block">
          <div class="flow-info-block-title">Extract + Assert Example</div>
          <pre class="flow-info-pre">{
  "extract": {
    "userId": { "from": "body", "path": "$.id" },
    "etag":   { "from": "header", "path": "etag" }
  },
  "assert": {
    "status": 201,
    "body": {
      "$.email": "{{input.email}}"
    },
    "exists": ["$.id", "$.createdAt"]
  }
}</pre>
        </div>
        <div class="flow-info-block">
          <div class="flow-info-block-title">Complete Flow Example</div>
          <pre class="flow-info-pre">{
  "version": 1,
  "name": "User onboarding",
  "baseUrl": "http://localhost:3000",
  "inputs": {
    "email": { "type": "string", "required": true },
    "name":  { "type": "string", "required": true }
  },
  "steps": [
    {
      "id": "create-user",
      "request": {
        "method": "POST",
        "path": "/users",
        "body": {
          "email": "{{input.email}}",
          "name": "{{input.name}}"
        }
      },
      "extract": {
        "userId": { "from": "body", "path": "$.id" }
      },
      "assert": { "status": 201 }
    },
    {
      "id": "get-user",
      "request": {
        "method": "GET",
        "path": "/users/{{vars.userId}}"
      },
      "assert": {
        "status": 200,
        "body": { "$.id": "{{vars.userId}}" }
      }
    }
  ]
}</pre>
        </div>
      </div>
      <p class="flow-info-footnote">Store flow files in <code>doctreen-flows/*.json</code> or configure <code>flowsPath</code>. The same definition can be run here in the docs UI or headlessly with <code>doctreen-flow run ...</code>.</p>
      </div>
    </div>
    <div class="flow-list">`;

  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i];
    const inputs = flow.inputs || {};
    const inputEntries = Object.entries(inputs);
    const steps = Array.isArray(flow.steps) ? flow.steps : [];

    let inputHtml = '';
    if (inputEntries.length === 0) {
      inputHtml = `<div class="flow-empty-note">No runtime inputs required.</div>`;
    } else {
      inputHtml = inputEntries.map(function ([name, definition]) {
        const required = definition && definition.required;
        return (
          `<label class="flow-input-row">` +
          `<span class="flow-input-label">${escapeHtml(name)}${required ? ' *' : ''}</span>` +
          `<input class="flow-input" data-input-name="${escapeHtml(name)}" placeholder="${escapeHtml((definition && definition.type) || 'string')}" />` +
          `</label>`
        );
      }).join('');
    }

    const stepsHtml = steps.map(function (step, stepIndex) {
      const method = step.request && step.request.method ? String(step.request.method).toUpperCase() : 'GET';
      const path = step.request && step.request.path ? step.request.path : '/';
      const style = METHOD_STYLES[method] || { cls: 'method-other' };
      return (
        `<div class="flow-step-row">` +
        `<span class="flow-step-index">${stepIndex + 1}</span>` +
        `<span class="method-mini ${style.cls}">${escapeHtml(method)}</span>` +
        `<span class="flow-step-path">${escapeHtml(path)}</span>` +
        `</div>`
      );
    }).join('');

    html += `
      <article class="flow-card" id="flow-${i}" data-flow-index="${i}">
        <div class="flow-card-header">
          <div>
            <h3 class="flow-title">${escapeHtml(flow.name)}</h3>
            ${flow.description ? `<p class="flow-desc">${escapeHtml(flow.description)}</p>` : ''}
          </div>
          <div class="flow-meta">
            <span class="badge badge-count">${steps.length} step${steps.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div class="flow-controls">
          <label class="flow-input-row flow-base-url-row">
            <span class="flow-input-label">baseUrl</span>
            <input class="flow-base-url" value="${escapeHtml(flow.baseUrl || '')}" placeholder="http://localhost:3000" />
          </label>
          <div class="flow-input-grid">
            ${inputHtml}
          </div>
          <div class="flow-toolbar">
            <button class="run-flow-btn" data-flow-index="${i}">Run flow</button>
            <button class="export-flow-btn" data-flow-index="${i}">Export JSON</button>
          </div>
        </div>
        <div class="flow-steps">
          <div class="detail-col-title">Steps</div>
          ${stepsHtml || `<div class="flow-empty-note">No steps defined.</div>`}
        </div>
        <div class="flow-result-block">
          <div class="detail-col-title">Last result</div>
          <div class="flow-result-tabs">
            <button class="flow-result-tab is-active" data-tab="timeline">Timeline</button>
            <button class="flow-result-tab" data-tab="json">JSON</button>
          </div>
          <div class="flow-result-panels">
            <div class="flow-result-timeline is-active">Not run yet.</div>
            <pre class="flow-result">Not run yet.</pre>
          </div>
        </div>
      </article>`;
  }

  html += `
    </div>
  </section>`;

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
 * @param {{ flows?: FlowDefinition[] }} [options]
 * @returns {string} Full HTML document
 */
function serveDocsUI(routes, config, options) {
  options = options || {};
  const { meta }    = config;
  const generatedAt = new Date().toUTCString();
  const totalRoutes = routes.length;
  const liveCount   = routes.filter((r) => r.requestSchema !== null || r.responseSchema !== null).length;
  const flows       = Array.isArray(options.flows) ? options.flows : [];
  const totalFlows  = flows.length;

  const groups         = groupRoutes(routes);
  const sidebarHtml    = renderSidebar(groups);
  const flowSidebarHtml = renderFlowSidebar(flows);
  const sectionsHtml   = groups.size > 0
    ? renderGroupSections(groups, config.groups || {})
    : `<p class="empty-state">No routes discovered. Make sure your routes are defined before the docs endpoint is first requested.</p>`;
  const flowSectionsHtml = renderFlowSections(flows);

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
    .header-tabs {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
    .header-tab {
      padding: 7px 14px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .header-tab:hover { color: var(--text); border-color: rgba(255,255,255,0.14); }
    .header-tab.is-active-routes {
      background: rgba(66,153,225,0.14);
      border-color: rgba(66,153,225,0.3);
      color: #63b3ed;
    }
    .header-tab.is-active-flows {
      background: rgba(72,187,120,0.14);
      border-color: rgba(72,187,120,0.3);
      color: #68d391;
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
    .sidebar-subnav { padding: 4px 8px 16px; border-top: 1px solid var(--border); }
    .sidebar-pane { display: none; }
    .sidebar-pane.is-active { display: block; }

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
    .sidebar-flow-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      border-radius: 6px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.8rem;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s, color 0.12s;
      margin-bottom: 3px;
    }
    .sidebar-flow-item:hover { background: rgba(255,255,255,0.05); color: var(--text); }
    .sidebar-flow-item.is-active { background: rgba(72,187,120,0.1); color: #68d391; }
    .sidebar-flow-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.78rem;
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
    .content-pane { display: none; }
    .content-pane.is-active { display: block; }

    /* ── Route group section ─────────────────────────────────────────────────── */
    .route-group {
      margin-bottom: 40px;
    }
    .route-group:last-child { margin-bottom: 0; }
    .flow-group { margin-top: 40px; }
    .flow-creator-card {
      background: linear-gradient(180deg, rgba(72,187,120,0.08), rgba(26,31,46,0.98));
      border: 1px solid rgba(72,187,120,0.2);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 18px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .flow-creator-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .flow-creator-title {
      font-size: 1rem;
      color: #d9f99d;
      margin: 0 0 4px;
    }
    .flow-creator-desc {
      font-size: 0.78rem;
      color: #cbd5e0;
      line-height: 1.6;
    }
    .flow-creator-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .flow-creator-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .flow-route-select {
      flex: 1;
      min-width: 220px;
      padding: 8px 10px;
      background: rgba(0,0,0,0.18);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.8rem;
      outline: none;
    }
    .creator-add-step-btn, .creator-export-btn, .creator-remove-step-btn {
      padding: 7px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-detail);
      color: var(--text);
      font-size: 0.76rem;
      cursor: pointer;
    }
    .creator-add-step-btn:hover { border-color: rgba(72,187,120,0.5); color: #68d391; }
    .creator-export-btn:hover { border-color: rgba(99,179,237,0.5); color: #63b3ed; }
    .creator-remove-step-btn:hover { border-color: rgba(245,101,101,0.5); color: #fc8181; }
    .creator-helper-status {
      font-size: 0.73rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .flow-creator-layout {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 14px;
    }
    .flow-creator-panel {
      background: rgba(0,0,0,0.14);
      border: 1px solid var(--border-sub);
      border-radius: 10px;
      padding: 12px;
      min-width: 0;
    }
    .creator-step-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .creator-step-card {
      border: 1px solid var(--border-sub);
      border-radius: 10px;
      background: rgba(255,255,255,0.02);
      padding: 12px;
    }
    .creator-step-header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .creator-step-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .creator-step-index {
      color: var(--text-dim);
      font-size: 0.72rem;
      min-width: 18px;
    }
    .creator-step-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .creator-step-full {
      grid-column: 1 / -1;
    }
    .creator-step-textarea {
      width: 100%;
      min-height: 84px;
      padding: 8px 10px;
      background: rgba(0,0,0,0.18);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.76rem;
      outline: none;
      resize: vertical;
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .creator-helper-block {
      display: grid;
      gap: 10px;
    }
    .creator-helper-section {
      background: rgba(0,0,0,0.14);
      border: 1px solid var(--border-sub);
      border-radius: 8px;
      padding: 10px;
    }
    .creator-helper-title {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #93c5fd;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .creator-helper-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .creator-placeholder-btn {
      padding: 6px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.02);
      color: var(--text);
      font-size: 0.72rem;
      cursor: pointer;
    }
    .creator-placeholder-btn:hover {
      border-color: rgba(99,179,237,0.45);
      color: #93c5fd;
    }
    .creator-helper-note {
      font-size: 0.72rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .flow-info-card {
      background: linear-gradient(180deg, rgba(66,153,225,0.08), rgba(26,31,46,0.98));
      border: 1px solid rgba(66,153,225,0.22);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 18px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .flow-info-card.is-collapsed .flow-info-content { display: none; }
    .flow-info-toggle {
      width: 100%;
      background: none;
      border: none;
      color: inherit;
      padding: 0;
      cursor: pointer;
      text-align: left;
    }
    .flow-info-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 0;
    }
    .flow-info-title-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .flow-info-title {
      font-size: 1rem;
      color: #dbeafe;
      margin: 0;
    }
    .flow-info-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(72,187,120,0.14);
      color: #9ae6b4;
      border: 1px solid rgba(72,187,120,0.22);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .flow-info-toggle-text {
      color: #93c5fd;
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .flow-info-content { margin-top: 12px; }
    .flow-info-grid, .flow-info-subgrid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .flow-info-subgrid { margin-top: 12px; }
    .flow-info-block {
      background: rgba(0,0,0,0.14);
      border: 1px solid var(--border-sub);
      border-radius: 10px;
      padding: 12px;
      min-width: 0;
    }
    .flow-info-block-title {
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #93c5fd;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .flow-info-text {
      font-size: 0.79rem;
      line-height: 1.6;
      color: #cbd5e0;
    }
    .flow-info-list {
      padding-left: 18px;
      color: #cbd5e0;
      font-size: 0.78rem;
      line-height: 1.7;
    }
    .flow-info-pre {
      margin: 0;
      font-size: 0.73rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #cbd5e0;
    }
    .flow-info-footnote {
      margin-top: 12px;
      font-size: 0.77rem;
      color: #a0aec0;
      line-height: 1.6;
    }
    .flow-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }
    .flow-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.26);
    }
    .flow-card-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .flow-title {
      font-size: 1rem;
      color: var(--text);
      margin-bottom: 4px;
    }
    .flow-desc {
      font-size: 0.78rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .flow-controls {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 14px;
    }
    .flow-input-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .flow-input-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .flow-input-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
      font-weight: 600;
    }
    .flow-input, .flow-base-url {
      width: 100%;
      padding: 8px 10px;
      background: rgba(0,0,0,0.18);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.8rem;
      outline: none;
    }
    .flow-toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .run-flow-btn, .export-flow-btn {
      padding: 7px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-detail);
      color: var(--text);
      font-size: 0.76rem;
      cursor: pointer;
    }
    .run-flow-btn:hover { border-color: rgba(72,187,120,0.5); color: #68d391; }
    .export-flow-btn:hover { border-color: rgba(99,179,237,0.5); color: #63b3ed; }
    .flow-step-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 0;
      border-bottom: 1px solid var(--border-sub);
    }
    .flow-step-row:last-child { border-bottom: none; }
    .flow-step-index {
      width: 20px;
      color: var(--text-dim);
      font-size: 0.72rem;
      text-align: center;
      flex-shrink: 0;
    }
    .flow-step-path {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.76rem;
      color: var(--text);
      word-break: break-all;
    }
    .flow-empty-note {
      font-size: 0.76rem;
      color: var(--text-dim);
      padding: 4px 0;
    }
    .flow-result-block { margin-top: 14px; }
    .flow-result-tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
    }
    .flow-result-tab {
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg-detail);
      color: var(--text-muted);
      font-size: 0.72rem;
      cursor: pointer;
    }
    .flow-result-tab.is-active {
      background: rgba(99,179,237,0.12);
      border-color: rgba(99,179,237,0.3);
      color: #63b3ed;
    }
    .flow-result-panels > * { display: none; }
    .flow-result-panels > .is-active { display: block; }
    .flow-result-timeline {
      background: rgba(0,0,0,0.18);
      border: 1px solid var(--border-sub);
      border-radius: 8px;
      padding: 14px;
      min-height: 120px;
    }
    .flow-result {
      background: rgba(0,0,0,0.18);
      border: 1px solid var(--border-sub);
      border-radius: 8px;
      padding: 12px;
      color: #a0aec0;
      font-size: 0.74rem;
      overflow: auto;
      min-height: 120px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .flow-summary-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--border-sub);
      border-radius: 8px;
      background: rgba(255,255,255,0.02);
      margin-bottom: 12px;
    }
    .flow-summary-main {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .flow-status-pill {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .flow-status-pill.pass { background: rgba(72,187,120,0.12); color: #68d391; }
    .flow-status-pill.fail { background: rgba(245,101,101,0.12); color: #fc8181; }
    .flow-summary-meta {
      font-size: 0.74rem;
      color: var(--text-muted);
    }
    .flow-vars-chip {
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(99,179,237,0.12);
      color: #90cdf4;
      font-size: 0.7rem;
      border: 1px solid rgba(99,179,237,0.2);
    }
    .flow-step-card {
      position: relative;
      padding: 12px 12px 12px 18px;
      border: 1px solid var(--border-sub);
      border-radius: 10px;
      background: rgba(255,255,255,0.02);
      margin-bottom: 10px;
    }
    .flow-step-card:last-child { margin-bottom: 0; }
    .flow-step-card::before {
      content: '';
      position: absolute;
      left: 8px;
      top: 12px;
      bottom: 12px;
      width: 2px;
      border-radius: 2px;
      background: var(--border);
    }
    .flow-step-card.pass::before { background: #48bb78; }
    .flow-step-card.fail::before { background: #f56565; }
    .flow-step-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }
    .flow-step-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .flow-step-name {
      color: var(--text);
      font-size: 0.82rem;
      font-weight: 600;
    }
    .flow-step-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .flow-mini-badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 0.67rem;
      border: 1px solid var(--border);
      color: var(--text-muted);
      background: rgba(255,255,255,0.03);
    }
    .flow-step-path-inline {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.74rem;
      color: #cbd5e0;
      word-break: break-all;
    }
    .flow-step-sections {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .flow-step-section {
      background: rgba(0,0,0,0.14);
      border: 1px solid var(--border-sub);
      border-radius: 8px;
      padding: 10px;
      min-width: 0;
    }
    .flow-step-section-title {
      font-size: 0.64rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-dim);
      font-weight: 700;
      margin-bottom: 8px;
    }
    .flow-step-pre {
      margin: 0;
      font-size: 0.72rem;
      color: #cbd5e0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'SFMono-Regular', Consolas, monospace;
    }
    .flow-step-error {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(245,101,101,0.08);
      border: 1px solid rgba(245,101,101,0.2);
      color: #feb2b2;
      font-size: 0.74rem;
    }
    .flow-result.is-pass { color: #9ae6b4; }
    .flow-result.is-fail { color: #feb2b2; }

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
    @media (max-width: 900px) {
      .flow-info-grid, .flow-info-subgrid, .flow-step-sections, .flow-creator-grid, .flow-creator-layout, .creator-step-grid {
        grid-template-columns: 1fr;
      }
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
      ${totalFlows > 0 ? `<span class="badge badge-count">${totalFlows} flow${totalFlows !== 1 ? 's' : ''}</span>` : ''}
      ${liveCount > 0 ? `<span class="badge badge-live">${liveCount} with schemas</span>` : ''}
      <button id="export-postman-btn" class="export-postman-btn">Export to Postman</button>
    </div>
  </div>
  ${flows.length > 0 ? `<div class="header-tabs" id="header-tabs"><button class="header-tab is-active-routes" data-pane="routes">Routes</button><button class="header-tab" data-pane="flows">Flows</button></div>` : ''}
</header>

<div class="app-shell">

  <aside class="sidebar" id="sidebar">
    <div class="sidebar-search">
      <input id="search" type="text" placeholder="Filter routes…" autocomplete="off" spellcheck="false" />
    </div>
    <div class="sidebar-pane is-active" id="sidebar-pane-routes" data-pane="routes">
      <div class="sidebar-label">Groups</div>
      <nav class="sidebar-nav" id="sidebar-nav">
        ${sidebarHtml}
      </nav>
    </div>
    ${flows.length > 0 ? `<div class="sidebar-pane" id="sidebar-pane-flows" data-pane="flows"><div class="sidebar-label">Flows</div><nav class="sidebar-subnav" id="sidebar-flow-nav">${flowSidebarHtml}</nav></div>` : ''}
  </aside>

  <main class="content" id="content">
    <div class="content-pane is-active" id="content-pane-routes" data-pane="routes">
      ${sectionsHtml}
    </div>
    ${flows.length > 0 ? `<div class="content-pane" id="content-pane-flows" data-pane="flows">${flowSectionsHtml}</div>` : ''}
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
  var sidebarFlowNav = document.getElementById('sidebar-flow-nav');
  var headerTabs = document.getElementById('header-tabs');
  var flowInfoCard = document.getElementById('flow-info-card');
  var flowInfoToggle = document.getElementById('flow-info-toggle');
  var creatorFlowName = document.getElementById('creator-flow-name');
  var creatorFlowDescription = document.getElementById('creator-flow-description');
  var creatorFlowBaseUrl = document.getElementById('creator-flow-base-url');
  var creatorFlowEnv = document.getElementById('creator-flow-env');
  var creatorFlowInputs = document.getElementById('creator-flow-inputs');
  var creatorRouteSelect = document.getElementById('creator-route-select');
  var creatorAddStepBtn = document.getElementById('creator-add-step-btn');
  var creatorExportBtn = document.getElementById('creator-export-btn');
  var creatorStepList = document.getElementById('creator-step-list');
  var creatorFlowJson = document.getElementById('creator-flow-json');
  var creatorHelperStatus = document.getElementById('creator-helper-status');
  var searchInput = document.getElementById('search');
  var ROUTES = ${JSON.stringify(routes)};
  var FLOWS = ${JSON.stringify(flows)};
  var META   = ${JSON.stringify({ title: meta.title, version: meta.version, description: meta.description })};
  var FLOW_RUN_ENDPOINT = ${JSON.stringify(config.docsPath + '/__flows/run')};
  var CLIENT_METHOD_CLASSES = ${JSON.stringify(Object.keys(METHOD_STYLES).reduce(function (acc, key) {
    acc[key] = METHOD_STYLES[key].cls;
    return acc;
  }, { OTHER: 'method-other' }))};
  var activePane = 'routes';
  var creatorState = {
    name: '',
    description: '',
    baseUrl: '{{env.baseUrl}}',
    env: { baseUrl: window.location.origin },
    inputs: { email: { type: 'string', required: true } },
    steps: [],
    focus: null
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function setActivePane(pane) {
    activePane = pane;

    document.querySelectorAll('.sidebar-pane').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-pane') === pane);
    });
    document.querySelectorAll('.content-pane').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-pane') === pane);
    });

    if (headerTabs) {
      headerTabs.querySelectorAll('.header-tab').forEach(function (el) {
        var isActive = el.getAttribute('data-pane') === pane;
        el.classList.toggle('is-active-routes', isActive && pane === 'routes');
        el.classList.toggle('is-active-flows', isActive && pane === 'flows');
      });
    }

    if (searchInput) {
      searchInput.placeholder = pane === 'flows' ? 'Filter flows…' : 'Filter routes…';
    }

    applyFilter(searchInput ? searchInput.value : '');
  }

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

  if (sidebarFlowNav) {
    sidebarFlowNav.addEventListener('click', function (e) {
      var flowBtn = e.target.closest('.sidebar-flow-item');
      if (!flowBtn) return;

      var index = flowBtn.getAttribute('data-flow-index');
      var target = document.getElementById('flow-' + index);
      if (!target) return;

      sidebarFlowNav.querySelectorAll('.sidebar-flow-item.is-active').forEach(function (el) {
        el.classList.remove('is-active');
      });
      flowBtn.classList.add('is-active');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  if (headerTabs) {
    headerTabs.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('.header-tab');
      if (!tabBtn) return;
      setActivePane(tabBtn.getAttribute('data-pane') || 'routes');
    });
  }

  if (flowInfoToggle && flowInfoCard) {
    flowInfoToggle.addEventListener('click', function () {
      var collapsed = flowInfoCard.classList.toggle('is-collapsed');
      flowInfoToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      var label = flowInfoToggle.querySelector('.flow-info-toggle-text');
      if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
    });
  }

  if (creatorFlowName) {
    creatorFlowName.addEventListener('input', function () {
      creatorState.name = this.value;
      syncCreatorPreview();
    });
  }
  if (creatorFlowDescription) {
    creatorFlowDescription.addEventListener('input', function () {
      creatorState.description = this.value;
      syncCreatorPreview();
    });
  }
  if (creatorFlowBaseUrl) {
    creatorFlowBaseUrl.value = creatorState.baseUrl;
    creatorState.baseUrl = creatorFlowBaseUrl.value;
    creatorFlowBaseUrl.addEventListener('input', function () {
      creatorState.baseUrl = this.value;
      syncCreatorPreview();
    });
  }
  if (creatorFlowEnv) {
    creatorFlowEnv.value = JSON.stringify(creatorState.env, null, 2);
    creatorFlowEnv.addEventListener('input', function () {
      creatorState.env = safeJsonParse(this.value, creatorState.env || {});
      syncCreatorPreview();
    });
  }
  if (creatorFlowInputs) {
    creatorFlowInputs.value = JSON.stringify(creatorState.inputs, null, 2);
    creatorFlowInputs.addEventListener('input', function () {
      creatorState.inputs = safeJsonParse(this.value, creatorState.inputs || {});
      syncCreatorPreview();
    });
  }
  if (creatorAddStepBtn && creatorRouteSelect) {
    creatorAddStepBtn.addEventListener('click', function () {
      var idx = Number(creatorRouteSelect.value);
      if (!Number.isInteger(idx) || !ROUTES[idx]) return;
      creatorState.steps.push(routeToDraftStep(ROUTES[idx], creatorState.steps.length));
      renderCreatorSteps();
    });
  }
  if (creatorExportBtn) {
    creatorExportBtn.addEventListener('click', function () {
      var json = JSON.stringify(buildCreatorFlowObject(), null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = slugifyStepId(creatorState.name || 'flow') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
  populateCreatorRoutes();
  renderCreatorSteps();

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

    content.querySelectorAll('#content-pane-routes .route-group').forEach(function (section) {
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

      var routeVisible = activePane === 'routes' && (hasVisible || q === '');
      section.style.display = routeVisible ? '' : 'none';
      if (sidebarGrp) sidebarGrp.style.display = routeVisible ? '' : 'none';
    });

    content.querySelectorAll('#content-pane-flows .flow-card').forEach(function (card) {
      var match = q === '' || card.textContent.toLowerCase().includes(q);
      var flowVisible = activePane === 'flows' && match;
      card.style.display = flowVisible ? '' : 'none';

      if (sidebarFlowNav) {
        var index = card.getAttribute('data-flow-index');
        var flowBtn = sidebarFlowNav.querySelector('.sidebar-flow-item[data-flow-index="' + index + '"]');
        if (flowBtn) flowBtn.style.display = flowVisible ? '' : 'none';
      }
    });

    var flowGroup = document.getElementById('flow-group');
    if (flowGroup) {
      var hasVisibleFlows = Array.prototype.some.call(
        flowGroup.querySelectorAll('.flow-card'),
        function (card) { return card.style.display !== 'none'; }
      );
      flowGroup.style.display = activePane === 'flows' && (hasVisibleFlows || q === '') ? '' : 'none';
    }
  }

  searchInput.addEventListener('input', function () { applyFilter(this.value); });
  setActivePane('routes');

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

  function escapeHtmlClient(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatJsonBlock(value) {
    return escapeHtmlClient(JSON.stringify(value, null, 2));
  }

  function renderFlowTimeline(result) {
    if (!result || !Array.isArray(result.steps) || result.steps.length === 0) {
      if (result && result.error) {
        return '<div class="flow-step-error">' + escapeHtmlClient(result.error) + '</div>';
      }
      return '<div class="flow-empty-note">Not run yet.</div>';
    }

    var summary =
      '<div class="flow-summary-card">' +
      '<div class="flow-summary-main">' +
      '<span class="flow-status-pill ' + (result.ok ? 'pass' : 'fail') + '">' + (result.ok ? 'PASS' : 'FAIL') + '</span>' +
      '<span class="flow-summary-meta">' + escapeHtmlClient(result.flow || 'Flow') + '</span>' +
      '<span class="flow-summary-meta">' + escapeHtmlClient(String(result.durationMs || 0)) + 'ms</span>' +
      '</div>' +
      '<div class="flow-summary-meta"><span class="flow-vars-chip">' + escapeHtmlClient(String(Object.keys(result.vars || {}).length)) + ' vars</span></div>' +
      '</div>';

    var stepsHtml = result.steps.map(function (step) {
      var request = step.request || null;
      var response = step.response || null;
      var requestBlock = request
        ? {
          method: request.method,
          url: request.url,
          path: request.path,
          query: request.query,
          headers: request.headers,
          body: request.body,
        }
        : { note: 'Request not built.' };
      var responseBlock = response
        ? {
          status: response.status,
          headers: response.headers,
          body: response.body,
        }
        : { note: 'No response captured.' };

      return (
        '<div class="flow-step-card ' + (step.ok ? 'pass' : 'fail') + '">' +
        '<div class="flow-step-header">' +
        '<div>' +
        '<div class="flow-step-title">' +
        '<span class="flow-step-name">' + escapeHtmlClient(step.name || step.id) + '</span>' +
        (request ? '<span class="method-mini ' + (CLIENT_METHOD_CLASSES[request.method] || CLIENT_METHOD_CLASSES.OTHER) + '">' + escapeHtmlClient(request.method) + '</span>' : '') +
        '</div>' +
        '<div class="flow-step-path-inline">' + escapeHtmlClient(request ? (request.path || request.url || '') : step.id) + '</div>' +
        '</div>' +
        '<div class="flow-step-badges">' +
        '<span class="flow-mini-badge">' + (step.status === null ? '-' : escapeHtmlClient(String(step.status))) + '</span>' +
        '<span class="flow-mini-badge">' + escapeHtmlClient(String(step.durationMs || 0)) + 'ms</span>' +
        '</div>' +
        '</div>' +
        '<div class="flow-step-sections">' +
        '<div class="flow-step-section"><div class="flow-step-section-title">Request</div><pre class="flow-step-pre">' + formatJsonBlock(requestBlock) + '</pre></div>' +
        '<div class="flow-step-section"><div class="flow-step-section-title">Response</div><pre class="flow-step-pre">' + formatJsonBlock(responseBlock) + '</pre></div>' +
        '<div class="flow-step-section"><div class="flow-step-section-title">Extracted Vars</div><pre class="flow-step-pre">' + formatJsonBlock(step.extracted || {}) + '</pre></div>' +
        '<div class="flow-step-section"><div class="flow-step-section-title">Flow Vars</div><pre class="flow-step-pre">' + formatJsonBlock(result.vars || {}) + '</pre></div>' +
        '</div>' +
        (step.error ? '<div class="flow-step-error">' + escapeHtmlClient(step.error) + '</div>' : '') +
        '</div>'
      );
    }).join('');

    return summary + stepsHtml;
  }

  function setFlowResult(card, result, requestOk) {
    var timelineEl = card.querySelector('.flow-result-timeline');
    var jsonEl = card.querySelector('.flow-result');
    if (!timelineEl || !jsonEl) return;

    timelineEl.innerHTML = renderFlowTimeline(result);
    jsonEl.textContent = JSON.stringify(result, null, 2);
    timelineEl.classList.toggle('is-pass', !!(requestOk && result.ok));
    timelineEl.classList.toggle('is-fail', !(requestOk && result.ok));
    jsonEl.classList.toggle('is-pass', !!(requestOk && result.ok));
    jsonEl.classList.toggle('is-fail', !(requestOk && result.ok));
  }

  function safeJsonParse(raw, fallback) {
    if (!raw || !raw.trim()) return fallback;
    try { return JSON.parse(raw); } catch (_error) { return fallback; }
  }

  function setCreatorStatus(message) {
    if (creatorHelperStatus) creatorHelperStatus.innerHTML = message;
  }

  function slugifyStepId(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'step';
  }

  function insertValueIntoField(field, value) {
    if (!field) return false;

    var start = typeof field.selectionStart === 'number' ? field.selectionStart : String(field.value || '').length;
    var end = typeof field.selectionEnd === 'number' ? field.selectionEnd : start;
    var current = String(field.value || '');
    field.value = current.slice(0, start) + value + current.slice(end);
    var cursor = start + value.length;
    if (typeof field.setSelectionRange === 'function') field.setSelectionRange(cursor, cursor);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
    return true;
  }

  function copyTextValue(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        fallbackCopy(text, function () {});
      });
    }
    fallbackCopy(text, function () {});
    return Promise.resolve();
  }

  function schemaFieldPaths(node, prefix) {
    prefix = prefix || '';
    if (!node) return [];

    if (node.type === 'object' && node.properties) {
      return Object.keys(node.properties).reduce(function (acc, key) {
        var next = prefix ? prefix + '.' + key : key;
        var child = node.properties[key];
        acc.push(next);
        return acc.concat(schemaFieldPaths(child, next));
      }, []);
    }

    if (node.type === 'array' && node.items) {
      var arrayPrefix = prefix ? prefix + '[0]' : '[0]';
      return [arrayPrefix].concat(schemaFieldPaths(node.items, arrayPrefix));
    }

    return [];
  }

  function ensureExtractVar(priorStep, fieldPath) {
    var selector = '$.' + fieldPath;
    var existing = Object.keys(priorStep.extract || {}).find(function (key) {
      var rule = priorStep.extract[key];
      return rule && typeof rule === 'object' && rule.from === 'body' && rule.path === selector;
    });
    if (existing) return existing;

    var varName = slugifyStepId(priorStep.id + '-' + fieldPath);
    priorStep.extract = priorStep.extract || {};
    priorStep.extract[varName] = { from: 'body', path: selector };
    return varName;
  }

  function getPlaceholderGroups(stepIndex) {
    var groups = {
      input: Object.keys(creatorState.inputs || {}).map(function (key) {
        return { label: 'input.' + key, value: '{{input.' + key + '}}' };
      }),
      env: Object.keys(creatorState.env || {}).map(function (key) {
        return { label: 'env.' + key, value: '{{env.' + key + '}}' };
      }),
      vars: [],
      capture: []
    };

    for (var i = 0; i < stepIndex; i++) {
      var prior = creatorState.steps[i];
      if (!prior) continue;

      Object.keys(prior.extract || {}).forEach(function (key) {
        groups.vars.push({
          label: prior.id + ' -> vars.' + key,
          value: '{{vars.' + key + '}}'
        });
      });

      ((prior._routeMeta && prior._routeMeta.responseFields) || []).forEach(function (field) {
        groups.capture.push({
          label: prior.id + ' -> ' + field,
          priorIndex: i,
          fieldPath: field
        });
      });
    }

    return groups;
  }

  function routeToDraftStep(route, index) {
    var bodySchema = route.requestSchema && route.requestSchema.body;
    var querySchema = route.requestSchema && route.requestSchema.query;
    var query = querySchema && querySchema.properties ? Object.keys(querySchema.properties).reduce(function (acc, key) {
      acc[key] = '';
      return acc;
    }, {}) : {};
    return {
      id: slugifyStepId(route.method + '-' + route.path) + '-' + (index + 1),
      name: route.method + ' ' + route.path,
      request: {
        method: route.method,
        path: route.path,
        headers: route.requestHeaders ? Object.assign({}, route.requestHeaders) : {},
        query: query,
        body: bodySchema ? schemaToExample(bodySchema) : {}
      },
      extract: {},
      assert: { status: route.method === 'POST' ? 201 : 200 },
      _routeMeta: {
        params: route.params || [],
        responseFields: schemaFieldPaths(route.responseSchema, '')
      }
    };
  }

  function buildCreatorFlowObject() {
    return {
      version: 1,
      name: creatorState.name || '',
      description: creatorState.description || undefined,
      baseUrl: creatorState.baseUrl || '',
      env: creatorState.env && Object.keys(creatorState.env).length > 0 ? creatorState.env : undefined,
      inputs: creatorState.inputs && Object.keys(creatorState.inputs).length > 0 ? creatorState.inputs : undefined,
      steps: creatorState.steps.map(function (step) {
        var out = {
          id: step.id,
          name: step.name,
          request: {
            method: step.request.method,
            path: step.request.path
          }
        };
        if (step.request.headers && Object.keys(step.request.headers).length > 0) out.request.headers = step.request.headers;
        if (step.request.query && Object.keys(step.request.query).length > 0) out.request.query = step.request.query;
        if (step.request.body && Object.keys(step.request.body).length > 0) out.request.body = step.request.body;
        if (step.extract && Object.keys(step.extract).length > 0) out.extract = step.extract;
        if (step.assert && Object.keys(step.assert).length > 0) out.assert = step.assert;
        return out;
      })
    };
  }

  function syncCreatorPreview() {
    if (creatorFlowJson) {
      creatorFlowJson.textContent = JSON.stringify(buildCreatorFlowObject(), null, 2);
    }
  }

  function renderCreatorSteps() {
    if (!creatorStepList) return;
    if (creatorState.steps.length === 0) {
      creatorStepList.innerHTML = '<div class="flow-empty-note">No steps yet. Pick a route and add it to the flow.</div>';
      syncCreatorPreview();
      return;
    }

    creatorStepList.innerHTML = creatorState.steps.map(function (step, index) {
      var placeholderGroups = getPlaceholderGroups(index);
      var paramSourceOptions = placeholderGroups.input.concat(placeholderGroups.env, placeholderGroups.vars).concat(
        placeholderGroups.capture.map(function (item) {
          return {
            label: 'capture ' + item.label,
            value: '__capture__:' + item.priorIndex + ':' + item.fieldPath
          };
        })
      );
      var paramHelpers = ((step._routeMeta && step._routeMeta.params) || []).map(function (paramName) {
        var selectOptions = ['<option value="">Optional: replace this route param…</option>'].concat(paramSourceOptions.map(function (option) {
          return '<option value="' + escapeHtmlClient(option.value) + '">' + escapeHtmlClient(option.label) + '</option>';
        }));
        return (
          '<label class="flow-input-row">' +
          '<span class="flow-input-label">Param: ' + escapeHtmlClient(paramName) + '</span>' +
          '<select class="flow-route-select creator-param-select" data-step-index="' + index + '" data-param-name="' + escapeHtmlClient(paramName) + '">' +
          selectOptions.join('') +
          '</select>' +
          '</label>'
        );
      }).join('');

      function renderPlaceholderButtons(items, type) {
        if (!items || items.length === 0) return '<div class="flow-empty-note">None available yet.</div>';
        return '<div class="creator-helper-row">' + items.map(function (item) {
          return '<button class="creator-placeholder-btn" type="button" data-step-index="' + index + '" data-placeholder-type="' + type + '" data-placeholder-value="' + escapeHtmlClient(item.value || '') + '" data-prior-index="' + escapeHtmlClient(String(item.priorIndex == null ? '' : item.priorIndex)) + '" data-field-path="' + escapeHtmlClient(item.fieldPath || '') + '">' + escapeHtmlClient(item.label) + '</button>';
        }).join('') + '</div>';
      }

      var helperBlock = paramHelpers || placeholderGroups.input.length > 0 || placeholderGroups.env.length > 0 || placeholderGroups.vars.length > 0 || placeholderGroups.capture.length > 0
        ? (
          '<div class="creator-step-full creator-helper-block">' +
          (paramHelpers ? '<div class="creator-helper-section"><div class="creator-helper-title">Optional route param mapping</div><div class="creator-step-grid">' + paramHelpers + '</div></div>' : '') +
          '<div class="creator-helper-section"><div class="creator-helper-title">Insert placeholders</div>' +
          (placeholderGroups.input.length > 0 ? '<div class="creator-helper-note">Inputs</div>' + renderPlaceholderButtons(placeholderGroups.input, 'direct') : '') +
          (placeholderGroups.env.length > 0 ? '<div class="creator-helper-note">Env</div>' + renderPlaceholderButtons(placeholderGroups.env, 'direct') : '') +
          (placeholderGroups.vars.length > 0 ? '<div class="creator-helper-note">Existing vars</div>' + renderPlaceholderButtons(placeholderGroups.vars, 'direct') : '') +
          (placeholderGroups.capture.length > 0 ? '<div class="creator-helper-note">Capture from earlier responses</div>' + renderPlaceholderButtons(placeholderGroups.capture, 'capture') : '') +
          ((placeholderGroups.input.length + placeholderGroups.env.length + placeholderGroups.vars.length + placeholderGroups.capture.length) === 0 ? '<div class="flow-empty-note">No placeholders available yet.</div>' : '') +
          '</div>' +
          '</div>'
        )
        : '';

      return (
        '<div class="creator-step-card" data-step-index="' + index + '">' +
        '<div class="creator-step-header">' +
        '<div class="creator-step-title">' +
        '<span class="creator-step-index">' + (index + 1) + '</span>' +
        '<span class="method-mini ' + (CLIENT_METHOD_CLASSES[step.request.method] || CLIENT_METHOD_CLASSES.OTHER) + '">' + escapeHtmlClient(step.request.method) + '</span>' +
        '<span class="flow-step-name">' + escapeHtmlClient(step.name || step.id) + '</span>' +
        '<span class="flow-step-path-inline">' + escapeHtmlClient(step.request.path) + '</span>' +
        '</div>' +
        '<button class="creator-remove-step-btn" data-step-index="' + index + '" type="button">Remove</button>' +
        '</div>' +
        '<div class="creator-step-grid">' +
        '<label class="flow-input-row"><span class="flow-input-label">Step id</span><input class="flow-input creator-step-id" data-step-index="' + index + '" value="' + escapeHtmlClient(step.id) + '" /></label>' +
        '<label class="flow-input-row"><span class="flow-input-label">Step name</span><input class="flow-input creator-step-name" data-step-index="' + index + '" value="' + escapeHtmlClient(step.name || '') + '" /></label>' +
        '<label class="flow-input-row"><span class="flow-input-label">Method</span><input class="flow-input creator-step-method" data-step-index="' + index + '" value="' + escapeHtmlClient(step.request.method) + '" /></label>' +
        '<label class="flow-input-row"><span class="flow-input-label">Path</span><input class="flow-input creator-step-path" data-step-index="' + index + '" value="' + escapeHtmlClient(step.request.path) + '" /></label>' +
        helperBlock +
        '<label class="flow-input-row creator-step-full"><span class="flow-input-label">Headers JSON</span><textarea class="creator-step-textarea creator-step-headers" data-step-index="' + index + '">' + escapeHtmlClient(JSON.stringify(step.request.headers || {}, null, 2)) + '</textarea></label>' +
        '<label class="flow-input-row creator-step-full"><span class="flow-input-label">Query JSON</span><textarea class="creator-step-textarea creator-step-query" data-step-index="' + index + '">' + escapeHtmlClient(JSON.stringify(step.request.query || {}, null, 2)) + '</textarea></label>' +
        '<label class="flow-input-row creator-step-full"><span class="flow-input-label">Body JSON</span><textarea class="creator-step-textarea creator-step-body" data-step-index="' + index + '">' + escapeHtmlClient(JSON.stringify(step.request.body || {}, null, 2)) + '</textarea></label>' +
        '<label class="flow-input-row creator-step-full"><span class="flow-input-label">Extract JSON</span><textarea class="creator-step-textarea creator-step-extract" data-step-index="' + index + '">' + escapeHtmlClient(JSON.stringify(step.extract || {}, null, 2)) + '</textarea></label>' +
        '<label class="flow-input-row creator-step-full"><span class="flow-input-label">Assert JSON</span><textarea class="creator-step-textarea creator-step-assert" data-step-index="' + index + '">' + escapeHtmlClient(JSON.stringify(step.assert || {}, null, 2)) + '</textarea></label>' +
        '</div>' +
        '</div>'
      );
    }).join('');

    syncCreatorPreview();
  }

  function populateCreatorRoutes() {
    if (!creatorRouteSelect) return;
    var options = ['<option value="">Select a documented route…</option>'];
    ROUTES.forEach(function (route, index) {
      options.push('<option value="' + index + '">' + escapeHtmlClient(route.method + ' ' + route.path) + '</option>');
    });
    creatorRouteSelect.innerHTML = options.join('');
  }

  function collectFlowInputs(card) {
    var input = {};
    card.querySelectorAll('.flow-input').forEach(function (el) {
      var name = el.getAttribute('data-input-name');
      if (name && el.value !== '') input[name] = el.value;
    });
    return input;
  }

  content.addEventListener('focusin', function (e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    if (!target.matches('.creator-step-id, .creator-step-name, .creator-step-method, .creator-step-path, .creator-step-headers, .creator-step-query, .creator-step-body, .creator-step-extract, .creator-step-assert')) return;

    var stepIndex = Number(target.getAttribute('data-step-index'));
    if (!Number.isInteger(stepIndex)) return;
    creatorState.focus = { stepIndex: stepIndex, element: target };
    setCreatorStatus('Insert placeholders into the focused field, or use the route-param dropdowns when the step path has <code>:params</code>.');
  });

  content.addEventListener('click', function (e) {
    var placeholderBtn = e.target.closest('.creator-placeholder-btn');
    if (placeholderBtn) {
      var stepIndex = Number(placeholderBtn.getAttribute('data-step-index'));
      var step = creatorState.steps[stepIndex];
      if (!step) return;

      var placeholderType = placeholderBtn.getAttribute('data-placeholder-type');
      var placeholderValue = placeholderBtn.getAttribute('data-placeholder-value');
      if (placeholderType === 'capture') {
        var priorIndex = Number(placeholderBtn.getAttribute('data-prior-index'));
        var fieldPath = placeholderBtn.getAttribute('data-field-path');
        var priorStep = creatorState.steps[priorIndex];
        if (!priorStep || !fieldPath) return;
        var varName = ensureExtractVar(priorStep, fieldPath);
        placeholderValue = '{{vars.' + varName + '}}';
      }

      var focus = creatorState.focus;
      if (focus && focus.stepIndex === stepIndex && focus.element && document.contains(focus.element)) {
        insertValueIntoField(focus.element, placeholderValue);
        setCreatorStatus('Inserted <code>' + escapeHtmlClient(placeholderValue) + '</code> into the focused field.');
      } else {
        copyTextValue(placeholderValue);
        setCreatorStatus('Copied <code>' + escapeHtmlClient(placeholderValue) + '</code>. Focus a step field first to insert directly.');
      }

      renderCreatorSteps();
      return;
    }

    var removeStepBtn = e.target.closest('.creator-remove-step-btn');
    if (removeStepBtn) {
      var removeIndex = Number(removeStepBtn.getAttribute('data-step-index'));
      if (Number.isInteger(removeIndex)) {
        creatorState.steps.splice(removeIndex, 1);
        renderCreatorSteps();
      }
      return;
    }

    var tabBtn = e.target.closest('.flow-result-tab');
    if (tabBtn) {
      var block = tabBtn.closest('.flow-result-block');
      if (!block) return;
      var tab = tabBtn.getAttribute('data-tab');
      block.querySelectorAll('.flow-result-tab').forEach(function (el) {
        el.classList.toggle('is-active', el === tabBtn);
      });
      var timeline = block.querySelector('.flow-result-timeline');
      var json = block.querySelector('.flow-result');
      if (timeline) timeline.classList.toggle('is-active', tab === 'timeline');
      if (json) json.classList.toggle('is-active', tab === 'json');
      return;
    }

    var runBtn = e.target.closest('.run-flow-btn');
    if (!runBtn) return;

    var index = Number(runBtn.getAttribute('data-flow-index'));
    var flow = FLOWS[index];
    var card = document.getElementById('flow-' + index);
    if (!flow || !card) return;

    var resultEl = card.querySelector('.flow-result');
    var timelineEl = card.querySelector('.flow-result-timeline');
    var baseUrlEl = card.querySelector('.flow-base-url');
    var payload = {
      flow: flow,
      input: collectFlowInputs(card),
      baseUrl: baseUrlEl && baseUrlEl.value ? baseUrlEl.value : window.location.origin,
      bail: true
    };

    runBtn.disabled = true;
    runBtn.textContent = 'Running...';
    resultEl.classList.remove('is-pass', 'is-fail');
    if (timelineEl) timelineEl.classList.remove('is-pass', 'is-fail');
    resultEl.textContent = 'Running flow...';
    if (timelineEl) timelineEl.innerHTML = '<div class="flow-empty-note">Running flow...</div>';

    fetch(FLOW_RUN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    }).then(function (result) {
      setFlowResult(card, result.data, result.ok);
    }).catch(function (error) {
      setFlowResult(card, {
        ok: false,
        flow: flow.name,
        durationMs: 0,
        steps: [],
        vars: {},
        error: String(error && error.message ? error.message : error),
      }, false);
    }).finally(function () {
      runBtn.disabled = false;
      runBtn.textContent = 'Run flow';
    });
  });

  content.addEventListener('change', function (e) {
    var target = e.target;
    if (!(target instanceof Element)) return;

    if (target.classList.contains('creator-param-select')) {
      var stepIndex = Number(target.getAttribute('data-step-index'));
      var paramName = target.getAttribute('data-param-name');
      var step = creatorState.steps[stepIndex];
      if (!step || !paramName) return;

      var placeholder = target.value;
      if (!placeholder) return;
      if (placeholder.indexOf('__capture__:') === 0) {
        var parts = placeholder.split(':');
        var priorIndex = Number(parts[1]);
        var fieldPath = parts.slice(2).join(':');
        var priorStep = creatorState.steps[priorIndex];
        if (!priorStep || !fieldPath) return;
        placeholder = '{{vars.' + ensureExtractVar(priorStep, fieldPath) + '}}';
      }

      var pattern = new RegExp(':' + paramName + '(?=/|$)', 'g');
      step.request.path = String(step.request.path || '').replace(pattern, placeholder);
      setCreatorStatus('Mapped route param <code>:' + escapeHtmlClient(paramName) + '</code> to <code>' + escapeHtmlClient(placeholder) + '</code>.');
      renderCreatorSteps();
      return;
    }
  });

  content.addEventListener('input', function (e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    var stepIndex = Number(target.getAttribute('data-step-index'));
    if (!Number.isInteger(stepIndex) || !creatorState.steps[stepIndex]) return;
    var step = creatorState.steps[stepIndex];

    if (target.classList.contains('creator-step-id')) step.id = target.value;
    else if (target.classList.contains('creator-step-name')) step.name = target.value;
    else if (target.classList.contains('creator-step-method')) step.request.method = target.value.toUpperCase();
    else if (target.classList.contains('creator-step-path')) step.request.path = target.value;
    else if (target.classList.contains('creator-step-headers')) step.request.headers = safeJsonParse(target.value, {});
    else if (target.classList.contains('creator-step-query')) step.request.query = safeJsonParse(target.value, {});
    else if (target.classList.contains('creator-step-body')) step.request.body = safeJsonParse(target.value, {});
    else if (target.classList.contains('creator-step-extract')) step.extract = safeJsonParse(target.value, {});
    else if (target.classList.contains('creator-step-assert')) step.assert = safeJsonParse(target.value, {});
    else return;

    var card = target.closest('.creator-step-card');
    if (card) {
      var titlePath = card.querySelector('.flow-step-path-inline');
      var methodBadge = card.querySelector('.method-mini');
      var stepName = card.querySelector('.creator-step-title .flow-step-name');
      if (titlePath) titlePath.textContent = step.request.path;
      if (methodBadge) {
        methodBadge.textContent = step.request.method;
        methodBadge.className = 'method-mini ' + (CLIENT_METHOD_CLASSES[step.request.method] || CLIENT_METHOD_CLASSES.OTHER);
      }
      if (stepName) stepName.textContent = step.name || step.id;
    }
    syncCreatorPreview();
  });

  content.addEventListener('click', function (e) {
    var exportBtn = e.target.closest('.export-flow-btn');
    if (!exportBtn) return;

    var index = Number(exportBtn.getAttribute('data-flow-index'));
    var flow = FLOWS[index];
    if (!flow) return;

    var json = JSON.stringify(flow, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (flow.name || 'flow').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
</script>

</body>
</html>`;
}

module.exports = { serveDocsUI };
