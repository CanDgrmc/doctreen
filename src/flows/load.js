'use strict';

const fs = require('fs');
const path = require('path');

function readJsonFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');

  try {
    return {
      path: absolutePath,
      data: JSON.parse(raw),
    };
  } catch (error) {
    throw new Error(`Failed to parse JSON file "${absolutePath}": ${error.message}`);
  }
}

function loadFlow(flowPath) {
  return readJsonFile(flowPath);
}

function resolveNamedEnvPath(flowPath, envName) {
  const flowDir = path.dirname(path.resolve(flowPath));
  return path.join(flowDir, 'environments', `${envName}.json`);
}

function loadEnvironment(flowPath, envRef) {
  if (!envRef) {
    return { path: null, data: {} };
  }

  const envPath = envRef.endsWith('.json')
    ? envRef
    : resolveNamedEnvPath(flowPath, envRef);

  return readJsonFile(envPath);
}

function loadFlowDirectory(dirPath) {
  const absoluteDir = path.resolve(dirPath);
  if (!fs.existsSync(absoluteDir)) return [];

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  return entries
    .filter(function (entry) {
      return entry.isFile() && entry.name.endsWith('.json');
    })
    .sort(function (a, b) {
      return a.name.localeCompare(b.name);
    })
    .map(function (entry) {
      return readJsonFile(path.join(absoluteDir, entry.name));
    });
}

function resolveConfiguredFlows(config) {
  if (Array.isArray(config && config.flows)) {
    return config.flows;
  }

  const explicitDir = config && config.flowsPath;
  const defaultDir = path.resolve(process.cwd(), 'doctreen-flows');
  const dirToUse = explicitDir ? path.resolve(explicitDir) : defaultDir;

  if (!fs.existsSync(dirToUse)) return [];

  return loadFlowDirectory(dirToUse).map(function (entry) {
    return entry.data;
  });
}

module.exports = {
  readJsonFile,
  loadFlow,
  loadEnvironment,
  loadFlowDirectory,
  resolveConfiguredFlows,
  resolveNamedEnvPath,
};
