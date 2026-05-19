const logger = require('./logger');

const STRUCTURED_FORMAT_MARKER = '---FIELD---';

function buildStructuredPrompt(fields, options = {}) {
  const { format = 'key_value', example = null } = options;

  if (format === 'key_value') {
    let prompt = '请按以下格式输出，每行一个字段，格式为"字段名: 字段值"，不要输出JSON、不要加引号、不要加花括号：\n';
    for (const field of fields) {
      const typeHint = field.type === 'array' ? '（多个值用逗号分隔）' :
                       field.type === 'boolean' ? '（true或false）' :
                       field.type === 'number' ? '（数字）' : '';
      const required = field.required !== false ? '' : '（可选）';
      prompt += `${field.name}: ${field.description}${typeHint}${required}\n`;
    }

    if (example) {
      prompt += `\n示例输出：\n${example}`;
    }

    return prompt;
  }

  if (format === 'list') {
    let prompt = '请按以下格式输出，每个条目用空行分隔，条目内每行一个字段，格式为"字段名: 字段值"：\n';
    prompt += '---ENTRY---\n';
    for (const field of fields) {
      prompt += `${field.name}: ${field.description}\n`;
    }
    prompt += '---ENTRY---\n';

    if (example) {
      prompt += `\n示例输出：\n${example}`;
    }

    return prompt;
  }

  return '';
}

function parseStructuredResponse(text, fields, options = {}) {
  const { format = 'key_value' } = options;

  if (!text || typeof text !== 'string') {
    return null;
  }

  const cleaned = _cleanRawText(text);

  if (format === 'key_value') {
    return _parseKeyValue(cleaned, fields);
  }

  if (format === 'list') {
    return _parseList(cleaned, fields);
  }

  return null;
}

function _cleanRawText(text) {
  let cleaned = text.trim();

  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
  }

  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      return _jsonToKeyValue(parsed);
    } catch (e) {}
  }

  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    try {
      const parsed = JSON.parse(cleaned);
      return _jsonListToStructured(parsed);
    } catch (e) {}
  }

  return cleaned;
}

function _jsonToKeyValue(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      const items = value.map(item => {
        if (typeof item === 'object' && item !== null) {
          return JSON.stringify(item);
        }
        return String(item);
      });
      lines.push(`${key}: ${items.join(', ')}`);
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

function _jsonListToStructured(arr) {
  const entries = [];
  for (const item of arr) {
    const lines = [];
    for (const [key, value] of Object.entries(item)) {
      if (Array.isArray(value)) {
        lines.push(`${key}: ${value.join(', ')}`);
      } else if (typeof value === 'object' && value !== null) {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    entries.push('---ENTRY---\n' + lines.join('\n'));
  }
  return entries.join('\n');
}

function _parseKeyValue(text, fields) {
  const result = {};
  const lines = text.split('\n');
  const fieldMap = new Map();
  for (const f of fields) {
    fieldMap.set(f.name, f);
    if (f.aliases) {
      for (const alias of f.aliases) {
        fieldMap.set(alias, f);
      }
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 1) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    const value = trimmed.substring(colonIdx + 1).trim();

    const fieldDef = fieldMap.get(key);
    if (!fieldDef) {
      result[key] = value;
      continue;
    }

    result[fieldDef.name] = _castValue(value, fieldDef.type);
  }

  for (const f of fields) {
    if (f.required !== false && result[f.name] === undefined) {
      result[f.name] = _defaultValue(f.type);
    }
  }

  return result;
}

function _parseList(text, fields) {
  const entries = text.split('---ENTRY---').filter(s => s.trim());
  const results = [];

  for (const entry of entries) {
    const parsed = _parseKeyValue(entry.trim(), fields);
    if (parsed && Object.keys(parsed).length > 0) {
      results.push(parsed);
    }
  }

  return results;
}

function _castValue(value, type) {
  if (value === undefined || value === null) return value;

  switch (type) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      const v = String(value).toLowerCase().trim();
      return v === 'true' || v === '是' || v === 'yes' || v === '1';
    case 'number':
      const num = Number(value);
      return isNaN(num) ? 0 : num;
    case 'array':
      if (Array.isArray(value)) return value;
      return String(value).split(/[,，]/).map(s => s.trim()).filter(Boolean);
    case 'object':
      if (typeof value === 'object') return value;
      try {
        return JSON.parse(value);
      } catch (e) {
        return {};
      }
    case 'string':
    default:
      return String(value);
  }
}

function _defaultValue(type) {
  switch (type) {
    case 'boolean': return false;
    case 'number': return 0;
    case 'array': return [];
    case 'object': return {};
    case 'string':
    default: return '';
  }
}

function structuredToJSON(data, options = {}) {
  const { pretty = false } = options;
  try {
    return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  } catch (e) {
    logger.error('结构化数据转JSON失败', { error: e.message });
    return null;
  }
}

function estimateTokenSavings(jsonStr, structuredStr) {
  const jsonLen = (jsonStr || '').length;
  const structLen = (structuredStr || '').length;
  const savedChars = jsonLen - structLen;
  const savedPercent = jsonLen > 0 ? Math.round((savedChars / jsonLen) * 100) : 0;
  return {
    jsonLength: jsonLen,
    structuredLength: structLen,
    savedChars,
    savedPercent,
    estimatedSavedTokens: Math.round(savedChars / 4)
  };
}

module.exports = {
  buildStructuredPrompt,
  parseStructuredResponse,
  structuredToJSON,
  estimateTokenSavings
};
