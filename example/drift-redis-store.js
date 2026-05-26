'use strict';

/**
 * Reference implementation: Redis-backed DriftStore (v1.10.1+).
 *
 * Plug this into doctreen so drift aggregates survive process restarts and
 * are shared across replicas:
 *
 *   const Redis = require('ioredis');
 *   const { createRedisDriftStore } = require('doctreen/example/drift-redis-store');
 *
 *   const redis = new Redis(process.env.REDIS_URL);
 *
 *   expressAdapter(app, {
 *     drift: {
 *       enabled: true,
 *       sampleRate: 0.01,
 *       store: createRedisDriftStore({ client: redis, prefix: 'doctreen:' }),
 *       allowReset: true,
 *       resetToken: process.env.DOCTREEN_RESET_TOKEN,
 *     },
 *   });
 *
 * The store conforms to doctreen's `DriftStore` interface:
 *
 *   { record(event), report(), reset() }
 *
 * Storage layout:
 *
 *   <prefix>routes                       SET of "METHOD path" keys
 *   <prefix>route:<METHOD path>:meta     HASH (method, path, total, firstSeen, lastSeen)
 *   <prefix>route:<METHOD path>:kinds    HASH (kind -> count)
 *   <prefix>route:<METHOD path>:parts    HASH (part -> count)
 *   <prefix>route:<METHOD path>:fields   HASH (field -> count)
 *   <prefix>route:<METHOD path>:hbuckets HASH (hour key -> count)   rolling 24h
 *   <prefix>route:<METHOD path>:dbuckets HASH (day key  -> count)   rolling 7d
 *   <prefix>route:<METHOD path>:samples  LIST (JSON-encoded events), LTRIM to maxSamples
 *
 * Works with `ioredis`, `redis@4+` (any client implementing `multi/exec`,
 * `sadd`, `hincrby`, `hset`, `hdel`, `lpush`, `ltrim`, `lrange`, `smembers`,
 * `hgetall`, `del`).
 *
 * @param {{ client: any, prefix?: string, maxSamples?: number, hourlyRetention?: number, dailyRetention?: number }} opts
 */
function createRedisDriftStore(opts) {
  if (!opts || !opts.client) {
    throw new Error('createRedisDriftStore: `client` is required (e.g. new Redis(url)).');
  }
  const client = opts.client;
  const prefix = typeof opts.prefix === 'string' ? opts.prefix : 'doctreen:drift:';
  const maxSamples = typeof opts.maxSamples === 'number' ? opts.maxSamples : 5;
  const hourlyRetention = typeof opts.hourlyRetention === 'number' ? opts.hourlyRetention : 24;
  const dailyRetention = typeof opts.dailyRetention === 'number' ? opts.dailyRetention : 7;

  // ─── Key helpers ─────────────────────────────────────────────────────────
  const ROUTES_SET = prefix + 'routes';
  const routeKey   = function (k) { return prefix + 'route:' + k; };
  const k_meta     = function (k) { return routeKey(k) + ':meta'; };
  const k_kinds    = function (k) { return routeKey(k) + ':kinds'; };
  const k_parts    = function (k) { return routeKey(k) + ':parts'; };
  const k_fields   = function (k) { return routeKey(k) + ':fields'; };
  const k_hbuckets = function (k) { return routeKey(k) + ':hbuckets'; };
  const k_dbuckets = function (k) { return routeKey(k) + ':dbuckets'; };
  const k_samples  = function (k) { return routeKey(k) + ':samples'; };

  function hourBucketKey(t) {
    const d = new Date(t);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours());
  }
  function dayBucketKey(t) {
    const d = new Date(t);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  // ─── record(event) ───────────────────────────────────────────────────────

  async function record(event) {
    if (!event || !event.route || !Array.isArray(event.issues) || event.issues.length === 0) return;
    const routeId = event.route.method + ' ' + event.route.path;
    const issuesCount = event.issues.length;
    const hk = hourBucketKey(event.sampledAt);
    const dk = dayBucketKey(event.sampledAt);

    const multi = client.multi();
    multi.sadd(ROUTES_SET, routeId);
    multi.hsetnx(k_meta(routeId), 'method', event.route.method);
    multi.hsetnx(k_meta(routeId), 'path', event.route.path);
    multi.hsetnx(k_meta(routeId), 'firstSeen', String(event.sampledAt));
    multi.hset(k_meta(routeId), 'lastSeen', String(event.sampledAt));
    multi.hincrby(k_meta(routeId), 'total', issuesCount);
    multi.hincrby(k_parts(routeId), event.part, issuesCount);
    multi.hincrby(k_hbuckets(routeId), hk, issuesCount);
    multi.hincrby(k_dbuckets(routeId), dk, issuesCount);

    for (const issue of event.issues) {
      multi.hincrby(k_kinds(routeId), issue.kind, 1);
      multi.hincrby(k_fields(routeId), issue.field, 1);
    }

    multi.lpush(k_samples(routeId), JSON.stringify({
      sampledAt: event.sampledAt,
      part: event.part,
      issues: event.issues.slice(0, 10),
    }));
    multi.ltrim(k_samples(routeId), 0, maxSamples - 1);

    await multi.exec();

    // Best-effort prune of old hourly/daily buckets outside the multi so a
    // hash-read can decide what to delete.
    pruneBuckets(routeId).catch(function () { /* swallow */ });
  }

  async function pruneBuckets(routeId) {
    const hourly = await client.hgetall(k_hbuckets(routeId));
    const hourlyKeys = Object.keys(hourly || {}).sort();
    if (hourlyKeys.length > hourlyRetention) {
      const drop = hourlyKeys.slice(0, hourlyKeys.length - hourlyRetention);
      if (drop.length > 0) await client.hdel(k_hbuckets(routeId), ...drop);
    }
    const daily = await client.hgetall(k_dbuckets(routeId));
    const dailyKeys = Object.keys(daily || {}).sort();
    if (dailyKeys.length > dailyRetention) {
      const drop = dailyKeys.slice(0, dailyKeys.length - dailyRetention);
      if (drop.length > 0) await client.hdel(k_dbuckets(routeId), ...drop);
    }
  }

  // ─── report() ────────────────────────────────────────────────────────────

  async function report() {
    const ids = await client.smembers(ROUTES_SET);
    if (!ids || ids.length === 0) {
      return { generatedAt: Date.now(), totalIssues: 0, routes: [] };
    }

    const routes = [];
    let grand = 0;
    for (const id of ids) {
      const [meta, kinds, parts, fields, hbuckets, dbuckets, samplesRaw] = await Promise.all([
        client.hgetall(k_meta(id)),
        client.hgetall(k_kinds(id)),
        client.hgetall(k_parts(id)),
        client.hgetall(k_fields(id)),
        client.hgetall(k_hbuckets(id)),
        client.hgetall(k_dbuckets(id)),
        client.lrange(k_samples(id), 0, -1),
      ]);

      if (!meta || !meta.method) continue;

      const total = parseInt(meta.total || '0', 10);
      grand += total;

      const samples = (samplesRaw || []).map(function (s) {
        try { return JSON.parse(s); } catch (_) { return null; }
      }).filter(Boolean);

      routes.push({
        method: meta.method,
        path: meta.path,
        total: total,
        kinds: toIntMap(kinds, ['missing-required', 'unexpected-field', 'type-mismatch']),
        parts: toIntMap(parts, ['body', 'query']),
        fields: toIntMap(fields, []),
        firstSeen: parseInt(meta.firstSeen || '0', 10),
        lastSeen: parseInt(meta.lastSeen || '0', 10),
        samples: samples,
        buckets: toIntMap(hbuckets, []),
        dailyBuckets: toIntMap(dbuckets, []),
      });
    }

    routes.sort(function (a, b) { return b.total - a.total; });

    return {
      generatedAt: Date.now(),
      totalIssues: grand,
      routes: routes,
    };
  }

  function toIntMap(raw, ensureKeys) {
    const out = {};
    for (const k of (ensureKeys || [])) out[k] = 0;
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(raw)) out[k] = parseInt(raw[k], 10) || 0;
    }
    return out;
  }

  // ─── reset() ─────────────────────────────────────────────────────────────

  async function reset() {
    const ids = await client.smembers(ROUTES_SET);
    if (ids && ids.length > 0) {
      const keys = [];
      for (const id of ids) {
        keys.push(
          k_meta(id), k_kinds(id), k_parts(id), k_fields(id),
          k_hbuckets(id), k_dbuckets(id), k_samples(id)
        );
      }
      await client.del(...keys);
    }
    await client.del(ROUTES_SET);
  }

  return { record: record, report: report, reset: reset };
}

module.exports = { createRedisDriftStore: createRedisDriftStore };
