const Diff = require('diff');
const logger = require('./logger');

// 字段中文标签映射
const FIELD_LABELS = {
    name: '用例名称',
    priority: '优先级',
    type: '类型',
    precondition: '前置条件',
    purpose: '测试目的',
    steps: '测试步骤',
    expected: '预期结果',
    key_config: '关键配置',
    remark: '备注'
};

// 多行字段（需要行级diff）
const MULTILINE_FIELDS = new Set(['steps', 'expected', 'precondition']);

class DiffGenerator {
    /**
     * 生成人类可读的差异摘要
     * 格式: "优先级: 中→高; 预期结果: 登录成功→返回HTTP 200, 跳转首页"
     * @param {Object} original - 原始内容
     * @param {Object} suggested - 建议内容
     * @returns {string} 差异摘要，无差异返回空字符串
     */
    generateDiffSummary(original, suggested) {
        if (!original || !suggested) {
            return '';
        }

        const parts = [];

        for (const fieldName of Object.keys(FIELD_LABELS)) {
            const oldVal = this._normalizeValue(original[fieldName]);
            const newVal = this._normalizeValue(suggested[fieldName]);

            if (oldVal === newVal) {
                continue;
            }

            const label = FIELD_LABELS[fieldName];

            if (oldVal === '' && newVal !== '') {
                parts.push(`${label}: (空)→${newVal}`);
            } else if (oldVal !== '' && newVal === '') {
                parts.push(`${label}: ${oldVal}→(空)`);
            } else {
                // 对于多行字段，只显示首行差异或截断显示
                if (MULTILINE_FIELDS.has(fieldName)) {
                    const oldFirstLine = this._getFirstLine(oldVal);
                    const newFirstLine = this._getFirstLine(newVal);
                    if (oldFirstLine === newFirstLine) {
                        // 首行相同，显示变更行数
                        const oldLines = oldVal.split('\n').length;
                        const newLines = newVal.split('\n').length;
                        if (oldLines !== newLines) {
                            parts.push(`${label}: ${oldLines}行→${newLines}行`);
                        } else {
                            parts.push(`${label}: 内容有修改`);
                        }
                    } else {
                        parts.push(`${label}: ${oldFirstLine}→${newFirstLine}`);
                    }
                } else {
                    parts.push(`${label}: ${oldVal}→${newVal}`);
                }
            }
        }

        return parts.join('; ');
    }

    /**
     * 生成字段级差异详情（JSON数组）
     * @param {Object} original - 原始内容
     * @param {Object} suggested - 建议内容
     * @returns {Array} 差异详情数组，每项包含 field, fieldLabel, changeType, oldValue, newValue
     */
    generateDiffDetail(original, suggested) {
        if (!original || !suggested) {
            return [];
        }

        const details = [];

        for (const fieldName of Object.keys(FIELD_LABELS)) {
            const comparison = this._compareField(
                fieldName,
                FIELD_LABELS[fieldName],
                original[fieldName],
                suggested[fieldName]
            );

            if (comparison) {
                details.push(comparison);
            }
        }

        return details;
    }

    /**
     * 比较单个字段
     * @param {string} fieldName - 字段名
     * @param {string} fieldLabel - 字段中文标签
     * @param {*} oldVal - 旧值
     * @param {*} newVal - 新值
     * @returns {Object|null} 差异对象或null（无差异时）
     */
    _compareField(fieldName, fieldLabel, oldVal, newVal) {
        const normalizedOld = this._normalizeValue(oldVal);
        const normalizedNew = this._normalizeValue(newVal);

        if (normalizedOld === normalizedNew) {
            return null;
        }

        let changeType;
        if (normalizedOld === '' && normalizedNew !== '') {
            changeType = 'added';
        } else if (normalizedOld !== '' && normalizedNew === '') {
            changeType = 'removed';
        } else {
            changeType = 'modified';
        }

        const result = {
            field: fieldName,
            fieldLabel: fieldLabel,
            changeType: changeType,
            oldValue: oldVal || '',
            newValue: newVal || ''
        };

        // 对于多行字段，增加行级diff信息
        if (MULTILINE_FIELDS.has(fieldName) && normalizedOld !== '' && normalizedNew !== '') {
            result.lineDiff = this._generateLineDiff(normalizedOld, normalizedNew);
        }

        return result;
    }

    /**
     * 生成行级diff
     * @param {string} oldText - 旧文本
     * @param {string} newText - 新文本
     * @returns {Array} 行级差异数组
     */
    _generateLineDiff(oldText, newText) {
        const changes = Diff.diffLines(oldText, newText);
        const lineDiff = [];

        for (const change of changes) {
            if (change.added) {
                lineDiff.push({
                    type: 'added',
                    content: change.value.replace(/\n$/, '')
                });
            } else if (change.removed) {
                lineDiff.push({
                    type: 'removed',
                    content: change.value.replace(/\n$/, '')
                });
            }
        }

        return lineDiff;
    }

    /**
     * 标准化值：null/undefined转为空字符串，trim
     * @param {*} val - 原始值
     * @returns {string} 标准化后的字符串
     */
    _normalizeValue(val) {
        if (val === null || val === undefined) {
            return '';
        }
        return String(val).trim();
    }

    /**
     * 获取多行文本的首行（截断显示）
     * @param {string} text - 文本
     * @param {number} maxLen - 最大长度
     * @returns {string} 首行文本
     */
    _getFirstLine(text, maxLen = 30) {
        if (!text) return '';
        const firstLine = text.split('\n')[0];
        if (firstLine.length > maxLen) {
            return firstLine.substring(0, maxLen) + '...';
        }
        return firstLine;
    }
}

module.exports = new DiffGenerator();
