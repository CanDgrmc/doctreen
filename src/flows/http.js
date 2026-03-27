'use strict';

const { runFlow } = require('./run');
const { resolveConfiguredFlows } = require('./load');

function getDocsFlowPayloadBody(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Flow run payload must be a JSON object.');
  }

  if (!payload.flow || typeof payload.flow !== 'object') {
    throw new Error('Flow run payload must include a flow definition.');
  }

  return {
    flow: payload.flow,
    input: payload.input && typeof payload.input === 'object' ? payload.input : {},
    env: payload.env && typeof payload.env === 'object' ? payload.env : {},
    baseUrl: payload.baseUrl,
    bail: payload.bail !== false,
  };
}

async function runFlowPayload(payload) {
  const parsed = getDocsFlowPayloadBody(payload);
  return runFlow(parsed.flow, {
    input: parsed.input,
    env: parsed.env,
    baseUrl: parsed.baseUrl,
    bail: parsed.bail,
  });
}

function getUiFlows(config) {
  return resolveConfiguredFlows(config);
}

module.exports = {
  runFlowPayload,
  getUiFlows,
};
