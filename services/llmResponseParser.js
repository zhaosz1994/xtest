const logger = require('./logger');

class LLMResponseParser {
    /**
     * 解析LLM返回的JSON文本，支持多种容错策略
     * @param {string} responseText - LLM返回的原始文本
     * @returns {Object|Array|null} 解析后的对象，失败返回null
     */
    parseJSON(responseText) {
        if (!responseText || typeof responseText !== 'string') {
            return null;
        }

        const trimmed = responseText.trim();
        if (!trimmed) {
            return null;
        }

        // Strategy 1: 直接JSON.parse
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            // 继续尝试其他策略
        }

        // Strategy 2: 提取 ```json 代码块
        const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (codeBlockMatch) {
            try {
                return JSON.parse(codeBlockMatch[1].trim());
            } catch (e) {
                // 代码块内解析失败，尝试修复
                const fixed = this._fixCommonJSONErrors(codeBlockMatch[1].trim());
                try {
                    return JSON.parse(fixed);
                } catch (e2) {
                    // 修复后仍然失败
                }
            }
        }

        // Strategy 3: 查找第一个 { 和最后一个 }，或第一个 [ 和最后一个 ]
        const isLikelyObject = trimmed.includes('{');
        const isLikelyArray = trimmed.includes('[');

        if (isLikelyObject) {
            const firstBrace = trimmed.indexOf('{');
            const lastBrace = trimmed.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                const extracted = trimmed.substring(firstBrace, lastBrace + 1);
                try {
                    return JSON.parse(extracted);
                } catch (e) {
                    const fixed = this._fixCommonJSONErrors(extracted);
                    try {
                        return JSON.parse(fixed);
                    } catch (e2) {
                        // 修复后仍然失败
                    }
                }
            }
        }

        if (isLikelyArray && !isLikelyObject) {
            const firstBracket = trimmed.indexOf('[');
            const lastBracket = trimmed.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket > firstBracket) {
                const extracted = trimmed.substring(firstBracket, lastBracket + 1);
                try {
                    return JSON.parse(extracted);
                } catch (e) {
                    const fixed = this._fixCommonJSONErrors(extracted);
                    try {
                        return JSON.parse(fixed);
                    } catch (e2) {
                        // 修复后仍然失败
                    }
                }
            }
        }

        // Strategy 4: 对整个文本尝试修复常见错误
        const fixedFull = this._fixCommonJSONErrors(trimmed);
        try {
            return JSON.parse(fixedFull);
        } catch (e) {
            // 最终失败
        }

        logger.warn('LLM响应JSON解析失败，所有策略均未成功', {
            textLength: trimmed.length,
            textPreview: trimmed.substring(0, 200)
        });

        return null;
    }

    /**
     * 解析LLM评审结果
     * 支持多种格式：
     *   - { "results": [...] }
     *   - { "action": "approve", ... } (单条)
     *   - [ { action, score, comment, suggested_content }, ... ]
     * @param {string} responseText - LLM返回的原始文本
     * @returns {Array} 评审结果数组，每项包含 action, score, comment, suggested_content
     */
    parseReviewResults(responseText) {
        const parsed = this.parseJSON(responseText);
        if (!parsed) {
            logger.warn('评审结果解析失败: 无法解析JSON');
            return [];
        }

        // 格式1: 数组直接返回
        if (Array.isArray(parsed)) {
            return parsed.map(item => this._normalizeReviewResult(item)).filter(Boolean);
        }

        // 格式2: { results: [...] }
        if (parsed.results && Array.isArray(parsed.results)) {
            return parsed.results.map(item => this._normalizeReviewResult(item)).filter(Boolean);
        }

        // 格式3: { action: "approve", ... } 单条结果
        if (parsed.action) {
            const normalized = this._normalizeReviewResult(parsed);
            if (normalized) {
                return [normalized];
            }
        }

        // 格式4: { cases: [...] } 每个case可能包含review信息
        if (parsed.cases && Array.isArray(parsed.cases)) {
            return parsed.cases.map(item => this._normalizeReviewResult(item)).filter(Boolean);
        }

        logger.warn('评审结果格式无法识别', { parsedKeys: Object.keys(parsed) });
        return [];
    }

    /**
     * 标准化单条评审结果
     * @param {Object} item - 原始评审结果
     * @returns {Object|null} 标准化后的评审结果
     */
    _normalizeReviewResult(item) {
        if (!item || typeof item !== 'object') {
            return null;
        }

        // 标准化 action 字段
        let action = (item.action || item.result || item.decision || '').toLowerCase();
        if (action === 'accept' || action === 'approved' || action === 'pass') {
            action = 'approve';
        } else if (action === 'reject' || action === 'rejected' || action === 'fail' || action === 'failed') {
            action = 'reject';
        } else if (action === 'modify' || action === 'modified' || action === 'suggest' || action === 'suggestion') {
            action = 'modify';
        }

        if (!['approve', 'reject', 'modify'].includes(action)) {
            // 如果无法识别action，根据score推断
            const score = parseFloat(item.score || item.rating || 0);
            if (score >= 8) {
                action = 'approve';
            } else if (score >= 5) {
                action = 'modify';
            } else {
                action = 'reject';
            }
        }

        return {
            action: action,
            score: parseFloat(item.score || item.rating || 0),
            comment: item.comment || item.reason || item.feedback || '',
            suggested_content: item.suggested_content || item.suggestedContent || item.suggested || item.modification || null
        };
    }

    /**
     * 修复常见JSON错误
     * @param {string} text - 待修复的JSON文本
     * @returns {string} 修复后的文本
     */
    _fixCommonJSONErrors(text) {
        let fixed = text;

        // 修复: 尾部逗号（} 或 ] 前面的逗号）
        fixed = fixed.replace(/,\s*([\]}])/g, '$1');

        // 修复: 单引号替换为双引号（简单场景，不在值内部的单引号）
        // 先处理 key: 'value' 格式
        fixed = fixed.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":');

        // 修复: 未加引号的key（如 {name: "value"}）
        fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

        // 修复: 值使用单引号（如 "key": 'value'）
        fixed = fixed.replace(/:\s*'([^']*)'([,}\]])/g, ':"$1"$2');

        // 修复: True/False/None -> true/false/null
        fixed = fixed.replace(/:\s*True([,}\]])/gi, ':true$1');
        fixed = fixed.replace(/:\s*False([,}\]])/gi, ':false$1');
        fixed = fixed.replace(/:\s*None([,}\]])/gi, ':null$1');

        // 修复: 多余的转义（如 \\" 应该是 \"）
        fixed = fixed.replace(/\\\\"/g, '\\"');

        // 修复: 缺少闭合引号（简单场景）
        // 统计双引号数量，如果是奇数则在末尾添加
        const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            fixed = fixed + '"';
        }

        return fixed;
    }
}

module.exports = new LLMResponseParser();
