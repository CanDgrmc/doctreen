'use strict';

function tokenizePath(path) {
  if (path === '$') return [];
  if (!path.startsWith('$.')) {
    throw new Error(`Unsupported path "${path}". Paths must start with "$." or equal "$".`);
  }

  const tokens = [];
  const raw = path.slice(2);
  const parts = raw.split('.');

  for (const part of parts) {
    const re = /([^[\]]+)|\[(\d+)\]/g;
    let match;
    while ((match = re.exec(part)) !== null) {
      if (match[1]) tokens.push({ type: 'prop', value: match[1] });
      else tokens.push({ type: 'index', value: Number(match[2]) });
    }
  }

  return tokens;
}

function getValueAtPath(value, path) {
  let current = value;
  const tokens = tokenizePath(path);

  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;

    if (token.type === 'prop') current = current[token.value];
    else current = current[token.value];
  }

  return current;
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    normalized[String(key).toLowerCase()] = value;
  }
  return normalized;
}

function extractValues(extractSpec, response) {
  const extracted = {};
  if (!extractSpec) return extracted;

  const headers = normalizeHeaders(response.headers || {});

  for (const [name, rule] of Object.entries(extractSpec)) {
    if (rule.from === 'status') {
      extracted[name] = response.status;
      continue;
    }

    if (rule.from === 'header') {
      extracted[name] = headers[String(rule.path).toLowerCase()];
      continue;
    }

    extracted[name] = getValueAtPath(response.body, rule.path);
  }

  return extracted;
}

module.exports = {
  tokenizePath,
  getValueAtPath,
  extractValues,
  normalizeHeaders,
};
