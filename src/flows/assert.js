'use strict';

const { getValueAtPath, normalizeHeaders } = require('./extract');
const { templateValue } = require('./template');

function makeAssertionError(message) {
  const error = new Error(message);
  error.name = 'FlowAssertionError';
  return error;
}

function assertCondition(condition, message) {
  if (!condition) throw makeAssertionError(message);
}

function assertResponse(assertSpec, response, context) {
  if (!assertSpec) return;

  if (assertSpec.status !== undefined) {
    assertCondition(
      response.status === assertSpec.status,
      `Expected status ${assertSpec.status}, received ${response.status}.`
    );
  }

  if (assertSpec.maxDurationMs !== undefined) {
    assertCondition(
      response.durationMs <= assertSpec.maxDurationMs,
      `Expected duration <= ${assertSpec.maxDurationMs}ms, received ${response.durationMs}ms.`
    );
  }

  const headers = normalizeHeaders(response.headers || {});
  const expectedHeaders = templateValue(assertSpec.headers || {}, context);
  for (const [name, expectedValue] of Object.entries(expectedHeaders)) {
    assertCondition(
      headers[String(name).toLowerCase()] === expectedValue,
      `Expected header "${name}" to equal "${expectedValue}", received "${headers[String(name).toLowerCase()]}" .`
    );
  }

  const expectedBody = templateValue(assertSpec.body || {}, context);
  for (const [path, expectedValue] of Object.entries(expectedBody)) {
    const actualValue = getValueAtPath(response.body, path);
    assertCondition(
      actualValue === expectedValue,
      `Expected body path "${path}" to equal ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actualValue)}.`
    );
  }

  for (const path of (assertSpec.exists || [])) {
    assertCondition(
      getValueAtPath(response.body, path) !== undefined,
      `Expected body path "${path}" to exist.`
    );
  }
}

module.exports = {
  assertResponse,
};
