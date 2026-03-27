'use strict';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateExtractSpec(extract, stepId) {
  assert(isPlainObject(extract), `Step "${stepId}" extract must be an object.`);

  for (const [name, rule] of Object.entries(extract)) {
    assert(typeof name === 'string' && name.length > 0, `Step "${stepId}" extract keys must be non-empty strings.`);
    assert(isPlainObject(rule), `Step "${stepId}" extract "${name}" must be an object.`);
    assert(['body', 'header', 'status'].includes(rule.from), `Step "${stepId}" extract "${name}" has unsupported source "${rule.from}".`);

    if (rule.from === 'status') continue;

    assert(typeof rule.path === 'string' && rule.path.length > 0, `Step "${stepId}" extract "${name}" must define a non-empty path.`);
  }
}

function validateAssertSpec(assertSpec, stepId) {
  assert(isPlainObject(assertSpec), `Step "${stepId}" assert must be an object.`);

  if (assertSpec.status !== undefined) {
    assert(Number.isInteger(assertSpec.status), `Step "${stepId}" assert.status must be an integer.`);
  }

  if (assertSpec.maxDurationMs !== undefined) {
    assert(typeof assertSpec.maxDurationMs === 'number' && assertSpec.maxDurationMs >= 0, `Step "${stepId}" assert.maxDurationMs must be a non-negative number.`);
  }

  if (assertSpec.headers !== undefined) {
    assert(isPlainObject(assertSpec.headers), `Step "${stepId}" assert.headers must be an object.`);
  }

  if (assertSpec.body !== undefined) {
    assert(isPlainObject(assertSpec.body), `Step "${stepId}" assert.body must be an object.`);
  }

  if (assertSpec.exists !== undefined) {
    assert(Array.isArray(assertSpec.exists), `Step "${stepId}" assert.exists must be an array.`);
    for (const path of assertSpec.exists) {
      assert(typeof path === 'string' && path.length > 0, `Step "${stepId}" assert.exists entries must be non-empty strings.`);
    }
  }
}

function validateRequestSpec(request, stepId) {
  assert(isPlainObject(request), `Step "${stepId}" request must be an object.`);
  assert(typeof request.method === 'string' && request.method.length > 0, `Step "${stepId}" request.method is required.`);
  assert(typeof request.path === 'string' && request.path.length > 0, `Step "${stepId}" request.path is required.`);

  if (request.headers !== undefined) {
    assert(isPlainObject(request.headers), `Step "${stepId}" request.headers must be an object.`);
  }
  if (request.query !== undefined) {
    assert(isPlainObject(request.query), `Step "${stepId}" request.query must be an object.`);
  }
}

function validateStep(step, seenIds) {
  assert(isPlainObject(step), 'Each flow step must be an object.');
  assert(typeof step.id === 'string' && step.id.length > 0, 'Each flow step must define a non-empty id.');
  assert(!seenIds.has(step.id), `Duplicate flow step id "${step.id}".`);
  seenIds.add(step.id);

  if (step.name !== undefined) {
    assert(typeof step.name === 'string', `Step "${step.id}" name must be a string.`);
  }

  validateRequestSpec(step.request, step.id);

  if (step.extract !== undefined) validateExtractSpec(step.extract, step.id);
  if (step.assert !== undefined) validateAssertSpec(step.assert, step.id);
}

function validateFlow(flow) {
  assert(isPlainObject(flow), 'Flow definition must be an object.');
  assert(flow.version === 1, 'Flow definition version must be 1.');
  assert(typeof flow.name === 'string' && flow.name.length > 0, 'Flow definition name is required.');
  assert(Array.isArray(flow.steps) && flow.steps.length > 0, 'Flow definition must include at least one step.');

  if (flow.description !== undefined) {
    assert(typeof flow.description === 'string', 'Flow description must be a string.');
  }

  if (flow.baseUrl !== undefined) {
    assert(typeof flow.baseUrl === 'string' && flow.baseUrl.length > 0, 'Flow baseUrl must be a non-empty string when provided.');
  }

  if (flow.env !== undefined) {
    assert(isPlainObject(flow.env), 'Flow env must be an object.');
  }

  if (flow.inputs !== undefined) {
    assert(isPlainObject(flow.inputs), 'Flow inputs must be an object.');
  }

  const seenIds = new Set();
  for (const step of flow.steps) {
    validateStep(step, seenIds);
  }

  return flow;
}

module.exports = {
  validateFlow,
  isPlainObject,
};
