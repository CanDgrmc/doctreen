'use strict';

/**
 * Programmatic entry point for `doctreen/codegen`.
 *
 * The CLI in `bin/doctreen.js` is the primary user surface, but the same
 * helpers are exported here for build scripts and one-off tools.
 */

const { generateTypes } = require('./types');
const { generateClient } = require('./client');
const { loadOpenApiDoc } = require('../mock/openapi-loader');

module.exports = {
  generateTypes: generateTypes,
  generateClient: generateClient,
  loadOpenApiDoc: loadOpenApiDoc,
};
