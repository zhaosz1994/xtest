const crypto = require('crypto');
const path = require('path');
const pool = require('../db');

function safeJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function jsonValue(value) {
  return value === undefined ? null : JSON.stringify(value);
}

function newId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function parsePositiveInt(value, fallback = null) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMode(mode) {
  const value = String(mode || 'dry_run').toLowerCase();
  const allowed = new Set(['advisory', 'generation', 'dry_run', 'execute', 'autonomous']);
  return allowed.has(value) ? value : 'dry_run';
}

function normalizeStatus(status, fallback = 'draft') {
  const value = String(status || fallback).toLowerCase();
  return value.replace(/[^a-z0-9_]/g, '_').slice(0, 64) || fallback;
}

function safePathSegment(value, fallback = 'artifact') {
  const segment = String(value || fallback).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(segment)) {
    throw new Error('非法路径标识');
  }
  return segment;
}

function resolveInsideRoot(root, ...segments) {
  const safeSegments = segments.map(segment => safePathSegment(segment));
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(rootPath, ...safeSegments);
  if (targetPath !== rootPath && !targetPath.startsWith(rootPath + path.sep)) {
    throw new Error('非法路径');
  }
  return targetPath;
}

module.exports = {
  safeJson,
  jsonValue,
  newId,
  parsePositiveInt,
  normalizeMode,
  normalizeStatus,
  safePathSegment,
  resolveInsideRoot
};
