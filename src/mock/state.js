'use strict';

/**
 * In-memory CRUD store for the mock server.
 *
 * Resources are keyed by the first non-parametric segment of the route path.
 * `/users` and `/users/:id` both target the `users` resource. Items live in
 * an `id`-keyed Map; new items get an auto-assigned id if the request body
 * doesn't include one.
 *
 * Persistence is opt-in: when `persistPath` is set, the store flushes the
 * full snapshot to disk on every mutation (debounced) so a restart preserves
 * fixtures. Crash-safety is not a goal — this is a dev fixture, not a
 * database.
 */

const fs = require('fs');

class CrudStore {
  constructor(options) {
    options = options || {};
    /** @type {Map<string, Map<string|number, any>>} */
    this.resources = new Map();
    this.persistPath = options.persistPath || null;
    this._flushTimer = null;
    /** Tracks the next numeric auto-id per resource. */
    this._nextId = new Map();

    if (this.persistPath && fs.existsSync(this.persistPath)) {
      this._loadFromDisk();
    }
  }

  _loadFromDisk() {
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const obj = JSON.parse(raw);
      for (const name of Object.keys(obj || {})) {
        const items = Array.isArray(obj[name]) ? obj[name] : [];
        const m = new Map();
        let maxNumericId = 0;
        for (const item of items) {
          if (item && (item.id !== undefined && item.id !== null)) {
            m.set(String(item.id), item);
            if (typeof item.id === 'number' && item.id > maxNumericId) maxNumericId = item.id;
          }
        }
        this.resources.set(name, m);
        this._nextId.set(name, maxNumericId + 1);
      }
    } catch (err) {
      // Bad persistence file — log once, start fresh.
      console.error('[doctreen mock] failed to load state from ' + this.persistPath + ': ' + err.message);
    }
  }

  _scheduleFlush() {
    if (!this.persistPath) return;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flushNow();
    }, 50);
    // Don't hold the event loop open just for persistence.
    if (this._flushTimer.unref) this._flushTimer.unref();
  }

  _flushNow() {
    const out = {};
    for (const [name, m] of this.resources) {
      out[name] = Array.from(m.values());
    }
    try {
      fs.writeFileSync(this.persistPath, JSON.stringify(out, null, 2));
    } catch (err) {
      console.error('[doctreen mock] failed to write state to ' + this.persistPath + ': ' + err.message);
    }
  }

  _table(name) {
    let m = this.resources.get(name);
    if (!m) {
      m = new Map();
      this.resources.set(name, m);
      this._nextId.set(name, 1);
    }
    return m;
  }

  list(name) {
    return Array.from(this._table(name).values());
  }

  get(name, id) {
    return this._table(name).get(String(id)) || null;
  }

  create(name, body) {
    const table = this._table(name);
    const item = Object.assign({}, body || {});
    if (item.id === undefined || item.id === null) {
      const next = this._nextId.get(name) || 1;
      item.id = next;
      this._nextId.set(name, next + 1);
    } else if (typeof item.id === 'number') {
      const next = this._nextId.get(name) || 1;
      if (item.id >= next) this._nextId.set(name, item.id + 1);
    }
    const stamped = Object.assign({}, item, {
      createdAt: item.createdAt || new Date().toISOString(),
    });
    table.set(String(stamped.id), stamped);
    this._scheduleFlush();
    return stamped;
  }

  update(name, id, body) {
    const table = this._table(name);
    const key = String(id);
    const existing = table.get(key);
    if (!existing) return null;
    const merged = Object.assign({}, existing, body || {}, {
      id: existing.id,
      updatedAt: new Date().toISOString(),
    });
    table.set(key, merged);
    this._scheduleFlush();
    return merged;
  }

  replace(name, id, body) {
    const table = this._table(name);
    const key = String(id);
    const existed = table.has(key);
    const next = Object.assign({}, body || {}, {
      id: body && body.id !== undefined ? body.id : (existed ? table.get(key).id : id),
      updatedAt: new Date().toISOString(),
    });
    table.set(key, next);
    this._scheduleFlush();
    return next;
  }

  delete(name, id) {
    const table = this._table(name);
    const key = String(id);
    const had = table.delete(key);
    if (had) this._scheduleFlush();
    return had;
  }

  /** Seed the table with a list of items. Used by example fixtures. */
  seed(name, items) {
    if (!Array.isArray(items) || items.length === 0) return;
    const table = this._table(name);
    let maxNumericId = this._nextId.get(name) || 1;
    for (const item of items) {
      if (item && item.id !== undefined && item.id !== null) {
        table.set(String(item.id), item);
        if (typeof item.id === 'number' && item.id >= maxNumericId) maxNumericId = item.id + 1;
      }
    }
    this._nextId.set(name, maxNumericId);
    this._scheduleFlush();
  }
}

/**
 * Extract the resource name from a route path. `/users/:id` → `users`,
 * `/api/v1/users/:id` → `users` (skips leading segments that look like
 * version prefixes). Returns null when no candidate exists (e.g. `/:id`).
 */
function resourceFromPath(routePath) {
  const segments = routePath.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg.startsWith(':')) continue;
    // Skip common prefix conventions so /api/v1/users still resolves to "users".
    if (seg === 'api' || /^v\d+$/i.test(seg)) continue;
    return seg.toLowerCase();
  }
  return null;
}

module.exports = {
  CrudStore,
  resourceFromPath,
};
