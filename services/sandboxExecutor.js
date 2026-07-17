const vm = require('vm');
const pool = require('../db');
const { validateSQL, extractTablesFromSQL } = require('./sqlSecurityValidator');
const { createSecureExecutor, getUserProjects } = require('./dataIsolationMiddleware');
const logger = require('./logger');

const SAFE_GLOBALS_WHITELIST = [
    'console', 'Date', 'Math', 'JSON', 'Object', 'Array', 'String',
    'Number', 'Boolean', 'Error', 'TypeError', 'RangeError', 'Promise',
    'Map', 'Set', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURIComponent', 'decodeURIComponent', 'undefined', 'NaN', 'Infinity',
    'Symbol', 'ArrayBuffer', 'DataView', 'Float32Array', 'Float64Array',
    'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint16Array', 'Uint32Array'
];

const DANGEROUS_PATTERNS = [
    /require\s*\(/i,
    /import\s+/i,
    /process\s*\./i,
    /global\s*\./i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /child_process/i,
    /fs\s*\.\s*(read|write|unlink|mkdir|rmdir|rm)/i,
    /__dirname/i,
    /__filename/i,
    /constructor\s*\[/i,
    /constructor\s*\(/i,
    /\[\s*['"]constructor['"]\s*\]/i,
    /__proto__/i,
    /prototype\s*\[/i,
    /\.constructor\b/i,
    /this\s*\.\s*constructor/i
];

class SandboxExecutor {
    constructor() {
        this._dockerAvailable = null; // null = not checked yet
    }

    /**
     * 验证代码安全性，检查是否包含危险模式
     * @param {string} code - 待执行的代码
     * @throws {Error} 如果代码包含危险模式
     */
    validateCodeSecurity(code) {
        if (!code || typeof code !== 'string') {
            throw new Error('代码不能为空');
        }

        for (const pattern of DANGEROUS_PATTERNS) {
            if (pattern.test(code)) {
                const match = code.match(pattern);
                logger.warn('沙箱安全检查: 检测到危险代码模式', {
                    pattern: pattern.toString(),
                    match: match ? match[0] : null
                });
                throw new Error(`代码包含不允许的操作: ${match ? match[0] : pattern.toString()}`);
            }
        }
    }

    /**
     * 在沙箱中执行JavaScript代码
     * @param {string} code - 待执行的JS代码
     * @param {Object} params - 传入参数
     * @param {Object} context - 执行上下文
     * @param {number} context.userId - 用户ID
     * @param {string} context.userRole - 用户角色
     * @param {string} context.username - 用户名
     * @param {string} context.toolName - 工具名称
     * @param {number} context.toolId - 工具ID
     * @param {Array} context.allowedTables - 允许访问的表
     * @param {number} context.timeoutMs - 超时时间(毫秒)
     * @returns {Object} { success, result, error, executionTimeMs }
     */
    async executeJavaScript(code, params, context) {
        const startTime = Date.now();
        const {
            userId,
            userRole,
            username,
            toolName,
            toolId,
            allowedTables,
            timeoutMs = 10000
        } = context;

        try {
            // 1. 验证代码安全性
            this.validateCodeSecurity(code);

            // 2. 创建安全沙箱环境
            const secureExecutor = await createSecureExecutor(userId, userRole);

            const sandbox = {
                console: {
                    log: (...args) => logger.info('[Sandbox]', toolName, ...args),
                    error: (...args) => logger.error('[Sandbox]', toolName, ...args),
                    warn: (...args) => logger.warn('[Sandbox]', toolName, ...args),
                    info: (...args) => logger.info('[Sandbox]', toolName, ...args)
                },
                Date: Date,
                Math: Math,
                JSON: JSON,
                Object: Object,
                Array: Array,
                String: String,
                Number: Number,
                Boolean: Boolean,
                Error: Error,
                TypeError: TypeError,
                RangeError: RangeError,
                Promise: Promise,
                Map: Map,
                Set: Set,
                RegExp: RegExp,
                parseInt: parseInt,
                parseFloat: parseFloat,
                isNaN: isNaN,
                isFinite: isFinite,
                encodeURIComponent: encodeURIComponent,
                decodeURIComponent: decodeURIComponent,
                db: {
                    query: async (sql, sqlParams) => {
                        const queryStart = Date.now();
                        try {
                            const validation = validateSQL(sql, sqlParams || []);
                            if (!validation.valid) {
                                throw new Error(`SQL验证失败: ${validation.errors.join('; ')}`);
                            }

                            if (allowedTables && Array.isArray(allowedTables) && allowedTables.length > 0) {
                                const accessedTables = extractTablesFromSQL(sql);
                                for (const table of accessedTables) {
                                    if (!allowedTables.includes(table.toLowerCase())) {
                                        throw new Error(`工具无权访问表: ${table}`);
                                    }
                                }
                            }

                            const result = await secureExecutor.query(sql, sqlParams || []);

                            logger.info('沙箱DB查询执行', {
                                userId,
                                toolName,
                                toolId,
                                sql: sql.substring(0, 200),
                                resultCount: result ? result.length : 0,
                                executionTimeMs: Date.now() - queryStart
                            });

                            return result;
                        } catch (err) {
                            logger.error('沙箱DB查询失败', {
                                userId,
                                toolName,
                                toolId,
                                sql: sql.substring(0, 200),
                                error: err.message
                            });
                            throw new Error(`数据库查询错误: ${err.message}`);
                        }
                    }
                }
            };

            Object.defineProperty(sandbox, 'global', { get: () => { throw new Error('访问 global 被禁止'); } });
            Object.defineProperty(sandbox, 'GLOBAL', { get: () => { throw new Error('访问 GLOBAL 被禁止'); } });
            Object.defineProperty(sandbox, 'root', { get: () => { throw new Error('访问 root 被禁止'); } });

            const wrappedCode = `
                (async function(params) {
                    ${code}
                })
            `;

            const script = new vm.Script(wrappedCode, {
                filename: `tool_${toolName || 'unknown'}_${Date.now()}.js`
            });

            const vmContext = vm.createContext(sandbox);
            vmContext.constructor = undefined;
            const asyncFn = script.runInContext(vmContext, { timeout: timeoutMs || 5000, microtaskMode: 'afterEvaluate' });

            // 4. 执行并设置超时
            const result = await Promise.race([
                asyncFn(params || {}),
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`执行超时: ${timeoutMs}ms`));
                    }, timeoutMs);
                })
            ]);

            const executionTimeMs = Date.now() - startTime;

            logger.info('沙箱JS执行成功', {
                userId,
                toolName,
                toolId,
                executionTimeMs
            });

            return {
                success: true,
                result: result,
                error: null,
                executionTimeMs
            };

        } catch (error) {
            const executionTimeMs = Date.now() - startTime;

            logger.error('沙箱JS执行失败', {
                userId,
                toolName,
                toolId,
                error: error.message,
                executionTimeMs
            });

            return {
                success: false,
                result: null,
                error: error.message,
                executionTimeMs
            };
        }
    }

    async _checkDockerAvailable() {
        if (this._dockerAvailable !== null) return this._dockerAvailable;

        const { execFile } = require('child_process');
        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 3000);
            try {
                execFile('docker', ['--version'], (error) => {
                    clearTimeout(timeout);
                    this._dockerAvailable = !error;
                    resolve(this._dockerAvailable);
                });
            } catch (e) {
                clearTimeout(timeout);
                this._dockerAvailable = false;
                resolve(false);
            }
        });
    }

    /**
     * 执行Python代码（需要Docker环境）
     * 如果Docker不可用，返回错误提示
     * @param {string} code - Python代码
     * @param {Object} params - 传入参数
     * @param {Object} context - 执行上下文
     * @returns {Object} { success, result, error, executionTimeMs }
     */
    async executePython(code, params, context) {
        const startTime = Date.now();
        const { toolName, toolId, userId } = context;

        try {
            // 尝试检测Docker是否可用（带缓存）
            const dockerAvailable = await this._checkDockerAvailable();

            if (!dockerAvailable) {
                return {
                    success: false,
                    result: null,
                    error: 'Python执行需要Docker环境，但当前Docker不可用',
                    executionTimeMs: Date.now() - startTime
                };
            }

            const util = require('util');
            const execFileAsync = util.promisify(execFile);

            const paramsJson = JSON.stringify(params || {});
            const dockerArgs = [
                'run', '--rm', '--network', 'none',
                '--memory=128m', '--cpus=0.5', '--pids-limit=50',
                'python:3.11-slim',
                'python', '-c', code,
                '--params', paramsJson
            ];

            const { stdout, stderr } = await execFileAsync('docker', dockerArgs, {
                timeout: context.timeoutMs || 10000,
                maxBuffer: 1024 * 1024
            });

            const executionTimeMs = Date.now() - startTime;

            if (stderr && !stdout) {
                return {
                    success: false,
                    result: null,
                    error: stderr.substring(0, 500),
                    executionTimeMs
                };
            }

            let result;
            try {
                result = JSON.parse(stdout.trim());
            } catch (e) {
                result = stdout.trim();
            }

            return {
                success: true,
                result: result,
                error: null,
                executionTimeMs
            };

        } catch (error) {
            const executionTimeMs = Date.now() - startTime;

            logger.error('沙箱Python执行失败', {
                userId,
                toolName,
                toolId,
                error: error.message,
                executionTimeMs
            });

            return {
                success: false,
                result: null,
                error: error.message,
                executionTimeMs
            };
        }
    }

    /**
     * 执行工具
     * @param {string} toolName - 工具名称
     * @param {Object} params - 传入参数
     * @param {Object} context - 执行上下文
     * @returns {Object} { success, result, error, executionTimeMs }
     */
    async executeTool(toolName, params, context) {
        try {
            // 1. 从数据库加载工具
            const [tools] = await pool.execute(
                'SELECT * FROM ai_custom_tools WHERE tool_name = ? AND is_enabled = 1',
                [toolName]
            );

            if (tools.length === 0) {
                return {
                    success: false,
                    result: null,
                    error: `工具 "${toolName}" 不存在或已禁用`,
                    executionTimeMs: 0
                };
            }

            const tool = tools[0];

            // 2. 检查工具是否启用
            if (!tool.is_enabled) {
                return {
                    success: false,
                    result: null,
                    error: `工具 "${toolName}" 已禁用`,
                    executionTimeMs: 0
                };
            }

            // 3. 补充上下文信息
            const enrichedContext = {
                ...context,
                toolName: tool.tool_name,
                toolId: tool.id,
                timeoutMs: context.timeoutMs || tool.timeout_ms || 10000,
                allowedTables: tool.allowed_tables
                    ? (typeof tool.allowed_tables === 'string' ? JSON.parse(tool.allowed_tables) : tool.allowed_tables)
                    : null
            };

            // 4. 根据语言路由到对应的执行器
            const language = tool.language || 'javascript';
            const code = tool.code_content;

            if (!code) {
                return {
                    success: false,
                    result: null,
                    error: `工具 "${toolName}" 没有代码内容`,
                    executionTimeMs: 0
                };
            }

            if (language === 'javascript') {
                return await this.executeJavaScript(code, params, enrichedContext);
            } else if (language === 'python') {
                return await this.executePython(code, params, enrichedContext);
            } else {
                return {
                    success: false,
                    result: null,
                    error: `不支持的语言: ${language}`,
                    executionTimeMs: 0
                };
            }

        } catch (error) {
            logger.error('工具执行异常', {
                toolName,
                error: error.message
            });

            return {
                success: false,
                result: null,
                error: `工具执行异常: ${error.message}`,
                executionTimeMs: 0
            };
        }
    }
}

module.exports = new SandboxExecutor();
