'use strict';

const { isPlainObject } = require('./validate');

const TEMPLATE_RE = /{{\s*([^}]+?)\s*}}/g;
const WHOLE_TEMPLATE_RE = /^{{\s*([^}]+?)\s*}}$/;

function getPathValue(source, path) {
  const parts = path.split('.');
  let current = source;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }

  return current;
}

function resolveReference(reference, context) {
  return getPathValue(context, reference.trim());
}

function renderTemplateString(template, context) {
  const whole = template.match(WHOLE_TEMPLATE_RE);
  if (whole) {
    const resolved = resolveReference(whole[1], context);
    if (resolved === undefined) {
      throw new Error(`Missing template variable "${whole[1].trim()}".`);
    }
    return resolved;
  }

  return template.replace(TEMPLATE_RE, function (_match, reference) {
    const value = resolveReference(reference, context);
    if (value === undefined) {
      throw new Error(`Missing template variable "${reference.trim()}".`);
    }
    if (value === null) return '';
    return String(value);
  });
}

function templateValue(value, context) {
  if (typeof value === 'string') return renderTemplateString(value, context);

  if (Array.isArray(value)) {
    return value.map(function (entry) {
      return templateValue(entry, context);
    });
  }

  if (isPlainObject(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = templateValue(entry, context);
    }
    return result;
  }

  return value;
}

module.exports = {
  getPathValue,
  resolveReference,
  renderTemplateString,
  templateValue,
};
