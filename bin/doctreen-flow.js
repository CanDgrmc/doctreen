#!/usr/bin/env node
'use strict';

const { loadFlow, loadEnvironment } = require('../src/flows/load');
const { runFlow } = require('../src/flows/run');

function printUsage() {
  console.error('Usage: doctreen-flow run <flow-file> [--env <name|file>] [--base-url <url>] [--input key=value] [--no-bail] [--report json]');
}

function argError(message) {
  const error = new Error(message);
  error.isArgError = true;
  return error;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args.shift();

  if (command !== 'run') {
    throw argError(`Unsupported command "${command || ''}".`);
  }

  const flowFile = args.shift();
  if (!flowFile) {
    throw argError('Flow file path is required.');
  }

  const options = {
    flowFile,
    envRef: null,
    baseUrl: undefined,
    input: {},
    bail: true,
    report: 'text',
  };

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === '--env') {
      options.envRef = args.shift() || null;
      if (!options.envRef) throw argError('--env requires a value.');
      continue;
    }

    if (arg === '--base-url') {
      options.baseUrl = args.shift();
      if (!options.baseUrl) throw argError('--base-url requires a value.');
      continue;
    }

    if (arg === '--input') {
      const pair = args.shift();
      if (!pair || !pair.includes('=')) throw argError('--input requires key=value.');
      const index = pair.indexOf('=');
      const key = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!key) throw argError('--input requires key=value.');
      options.input[key] = value;
      continue;
    }

    if (arg === '--no-bail') {
      options.bail = false;
      continue;
    }

    if (arg === '--report') {
      options.report = args.shift() || '';
      if (!['text', 'json'].includes(options.report)) {
        throw argError('--report must be "text" or "json".');
      }
      continue;
    }

    throw argError(`Unknown argument "${arg}".`);
  }

  return options;
}

function printTextReport(result) {
  console.log(`Flow: ${result.flow}`);
  console.log(`Result: ${result.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Duration: ${result.durationMs}ms`);

  for (const step of result.steps) {
    const status = step.status === null ? '-' : String(step.status);
    const line = `- ${step.ok ? 'PASS' : 'FAIL'} ${step.id} status=${status} duration=${step.durationMs}ms`;
    console.log(line);
    if (step.error) {
      console.log(`  error: ${step.error}`);
    }
  }

  const varNames = Object.keys(result.vars || {});
  if (varNames.length > 0) {
    console.log(`Vars: ${JSON.stringify(result.vars)}`);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv);
    const loadedFlow = loadFlow(options.flowFile);
    const loadedEnv = loadEnvironment(options.flowFile, options.envRef);

    const result = await runFlow(loadedFlow.data, {
      env: loadedEnv.data,
      input: options.input,
      baseUrl: options.baseUrl,
      bail: options.bail,
    });

    if (options.report === 'json') {
      console.log(JSON.stringify({
        ok: result.ok,
        flow: result.flow,
        durationMs: result.durationMs,
        steps: result.steps,
        vars: result.vars,
        error: result.error,
        flowFile: loadedFlow.path,
        envFile: loadedEnv.path,
      }, null, 2));
    } else {
      printTextReport(result);
    }

    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    if (error && error.isArgError) {
      printUsage();
    }
    process.exitCode = 1;
  }
}

main();
