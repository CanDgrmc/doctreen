'use strict';

const { createMockApp } = require('./server');
const { loadOpenApiDoc, buildRoutesFromDoc } = require('./openapi-loader');
const { CrudStore, resourceFromPath } = require('./state');

/**
 * Run a mock server from an OpenAPI source.
 *
 * @param {object} options
 * @param {string} options.from        - URL or local path to an OpenAPI 3.x JSON document
 * @param {number} [options.port=4000]
 * @param {string} [options.host='0.0.0.0']
 * @param {boolean} [options.crud]
 * @param {boolean} [options.faker]
 * @param {number}  [options.seed]
 * @param {number|[number,number]} [options.latency]
 * @param {number}  [options.errorRate]
 * @param {string}  [options.persistPath]
 * @param {boolean} [options.logRequests]
 * @returns {Promise<{ app: any, server: any, info: object, routeCount: number }>}
 */
async function startMockFromOpenApi(options) {
  if (!options || !options.from) {
    throw new Error('startMockFromOpenApi: `from` is required (URL or file path)');
  }
  const doc = await loadOpenApiDoc(options.from);
  const built = buildRoutesFromDoc(doc);
  const app = createMockApp({
    routes: built.routes,
    components: built.components,
    info: built.info,
    crud: options.crud,
    faker: options.faker,
    seed: options.seed,
    latency: options.latency,
    errorRate: options.errorRate,
    persistPath: options.persistPath,
    logRequests: options.logRequests,
  });

  const port = options.port || 4000;
  const host = options.host || '0.0.0.0';
  const server = await new Promise(function (resolve, reject) {
    const s = app.listen(port, host, function (err) {
      if (err) reject(err);
      else resolve(s);
    });
    s.on('error', reject);
  });

  return { app: app, server: server, info: built.info, routeCount: built.routes.length };
}

module.exports = {
  createMockApp,
  startMockFromOpenApi,
  loadOpenApiDoc,
  buildRoutesFromDoc,
  CrudStore,
  resourceFromPath,
};
