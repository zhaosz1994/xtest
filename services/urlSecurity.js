const net = require('net');

function parseIPv4(host) {
  const parts = String(host).split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return parts;
}

function isPrivateIPv4Parts(parts) {
  if (!parts) return false;
  return parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] === 0;
}

function normalizeIPv6(host) {
  const h = String(host).toLowerCase();
  const v4MappedMatch = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch) return { version: 4, host: v4MappedMatch[1] };
  const v4MappedMatch2 = h.match(/^::ffff:([0-9a-f]+:[0-9a-f]+)$/i);
  if (v4MappedMatch2) {
    const groups = v4MappedMatch2[1].split(':');
    if (groups.length === 2) {
      const hi = parseInt(groups[0], 16);
      const lo = parseInt(groups[1], 16);
      return {
        version: 4,
        host: `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
      };
    }
  }
  return { version: 6, host: h };
}

function isPrivateHost(hostname) {
  const raw = String(hostname || '').toLowerCase();
  if (!raw) return false;
  if (['localhost', 'metadata.google.internal', 'metadata'].includes(raw)) return true;
  const trimmed = raw.replace(/^\[|\]$/g, '');

  const ipVersion = net.isIP(trimmed);
  if (ipVersion === 4) {
    return isPrivateIPv4Parts(parseIPv4(trimmed));
  }
  if (ipVersion === 6) {
    const normalized = normalizeIPv6(trimmed);
    if (normalized.version === 4) {
      return isPrivateIPv4Parts(parseIPv4(normalized.host));
    }
    const h = normalized.host;
    if (h === '::1') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    if (h.startsWith('fe80:')) return true;
    if (h.startsWith('::')) return true;
    if (h.startsWith('2001:db8')) return true;
    return false;
  }
  return false;
}

function validateRunnerUrl(agentUrl) {
  if (!agentUrl) return null;
  const raw = String(agentUrl).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error('Runner URL格式无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Runner URL仅支持HTTP/HTTPS协议');
  }
  if (isPrivateHost(parsed.hostname) && process.env.ALLOW_PRIVATE_RUNNER_URL !== 'true') {
    throw new Error('Runner URL不允许指向本机、私网或链路本地地址');
  }
  const allowedHosts = (process.env.RUNNER_URL_ALLOWLIST || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error('Runner URL不在白名单中');
  }
  return parsed;
}

function normalizeRunnerUrl(value) {
  if (!value) return null;
  const parsed = validateRunnerUrl(value);
  if (!parsed) return null;
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

module.exports = {
  isPrivateHost,
  validateRunnerUrl,
  normalizeRunnerUrl
};
