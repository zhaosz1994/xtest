const pool = require('../db');
const { getUserAIConfig, getUserAITimeoutConfig, getAIGenerationParams, getSceneParams } = require('./aiService');
const sandboxExecutor = require('./sandboxExecutor');
const llmResponseParser = require('./llmResponseParser');
const diffGenerator = require('./diffGenerator');
const logger = require('./logger');
const agentToolUsageLogger = require('./agentToolUsageLogger');
const aiRequestLogger = require('./aiRequestLogger');
const axios = require('axios');

const MAX_TOOL_CALL_ROUNDS = 5;

class AgentExecutionEngine {
    /**
     * 执行Sub-Agent
     * @param {string} agentCode - 代理编码
     * @param {number} userId - 用户ID
     * @param {Object} variables - 模板变量
     * @param {Object} context - 执行上下文
     * @param {number} context.libraryId - 用例库ID
     * @param {number} context.moduleId - 模块ID
     * @param {string} context.sourceTaskId - 来源任务ID
     * @returns {Object} { success, result, toolCallsLog, memoryContribution }
     */
    async executeAgent(agentCode, userId, variables, context) {
        const startTime = Date.now();

        try {
            // 1. 通过Override引擎解析代理（私有覆盖 > 系统默认）
            const agent = await this._resolveAgent(agentCode, userId);
            if (!agent) {
                return {
                    success: false,
                    result: null,
                    error: `代理 "${agentCode}" 不存在`,
                    toolCallsLog: [],
                    memoryContribution: null,
                    executionTimeMs: Date.now() - startTime
                };
            }

            // 2. 加载配置文件
            const configFiles = await this._loadConfigFiles(agent.id);

            // 3. 加载记忆上下文
            let memoryContext = '';
            let memoryContribution = null;
            if (agent.memory_enabled) {
                memoryContext = await this._loadMemoryContext(
                    agent.id,
                    context.libraryId,
                    context.moduleId
                );
                if (memoryContext) {
                    memoryContribution = '已注入记忆上下文';
                }
            }

            // 4. 组装System Prompt = soul + <Memory_Context>
            const soulContent = configFiles.get('soul') || this._getDefaultSoul(agent);
            let systemPrompt = soulContent;
            if (memoryContext) {
                systemPrompt += '\n\n' + memoryContext;
            }

            // 5. 渲染User Prompt（Handlebars变量插值）
            const userTemplate = configFiles.get('user') || '';
            let userPrompt = this._renderUserPrompt(userTemplate, variables);

            // 5.1 追加参考文档到 User Prompt 末尾
            const refDocs = configFiles.get('ref_docs');
            if (refDocs && refDocs.length > 0) {
                userPrompt = this._appendRefDocs(userPrompt, refDocs);
            }

            // 5.2 如果User Prompt为空，跳过AI调用，避免只发送系统提示词
            if (!userPrompt || userPrompt.trim().length === 0) {
                logger.warn('Agent缺少User Prompt模板，跳过AI调用', {
                    agentCode,
                    agentId: agent.id,
                    userId
                });
                return {
                    success: false,
                    result: null,
                    error: '代理缺少User Prompt模板，无法生成有效请求',
                    toolCallsLog: [],
                    memoryContribution: null,
                    executionTimeMs: Date.now() - startTime
                };
            }

            // 6. 加载工具并转换为Function Calling JSON
            const toolsConfig = configFiles.get('tools');
            let tools = [];
            if (toolsConfig) {
                const toolNames = this._parseToolNames(toolsConfig);
                tools = await this._loadToolsConfig(toolNames);
            }

            // 7. 获取AI配置
            const aiConfig = await getUserAIConfig(userId);
            if (!aiConfig) {
                return {
                    success: false,
                    result: null,
                    error: '未配置AI模型，请先在设置中配置AI模型',
                    toolCallsLog: [],
                    memoryContribution: null,
                    executionTimeMs: Date.now() - startTime
                };
            }

            // 8. 调用LLM
            let llmResult = await this._callLLM(systemPrompt, userPrompt, tools, aiConfig);

            // 9. 处理工具调用（Agentic Loop，最多5轮）
            const toolCallsLog = [];
            let rounds = 0;
            let totalPromptTokens = llmResult.usage?.prompt_tokens || 0;
            let totalCompletionTokens = llmResult.usage?.completion_tokens || 0;
            let totalTokensAccum = llmResult.usage?.total_tokens || 0;

            while (llmResult.tool_calls && llmResult.tool_calls.length > 0 && rounds < MAX_TOOL_CALL_ROUNDS) {
                rounds++;

                const toolResults = await this._executeToolCalls(
                    llmResult.tool_calls,
                    { userId, userRole: context.userRole, username: context.username, agentCode }
                );

                // 记录工具调用日志
                for (let i = 0; i < llmResult.tool_calls.length; i++) {
                    const tc = llmResult.tool_calls[i];
                    const tr = toolResults[i];
                    toolCallsLog.push({
                        round: rounds,
                        toolName: tc.function?.name || tc.name || 'unknown',
                        arguments: tc.function?.arguments || tc.arguments || '{}',
                        result: tr?.result || tr?.error || null,
                        success: tr?.success !== false
                    });
                }

                // 将工具结果追加到消息中，继续调用LLM
                llmResult = await this._callLLMWithToolResults(
                    systemPrompt,
                    userPrompt,
                    llmResult.tool_calls,
                    toolResults,
                    tools,
                    aiConfig
                );

                totalPromptTokens += llmResult.usage?.prompt_tokens || 0;
                totalCompletionTokens += llmResult.usage?.completion_tokens || 0;
                totalTokensAccum += llmResult.usage?.total_tokens || 0;
            }

            // 10. 解析最终结果
            const finalContent = llmResult.content || '';
            const executionTimeMs = Date.now() - startTime;
            const hitMaxRounds = llmResult.tool_calls && llmResult.tool_calls.length > 0;

            logger.info('Agent执行完成', {
                agentCode,
                agentId: agent.id,
                userId,
                rounds,
                toolCallsCount: toolCallsLog.length,
                executionTimeMs,
                hitMaxRounds
            });

            agentToolUsageLogger.logSuccess({
                userId,
                username: context.username,
                itemType: 'sub_agent',
                itemCode: agentCode,
                itemName: agent.display_name,
                source: context.source || null,
                executionTimeMs,
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                totalTokens: totalTokensAccum,
                modelName: aiConfig.model_name || null,
                contextInfo: {
                    libraryId: context.libraryId,
                    moduleId: context.moduleId,
                    toolCallsCount: toolCallsLog.length,
                    rounds,
                    hitMaxRounds
                }
            });

            if (hitMaxRounds) {
                aiRequestLogger.logFailure({
                    userId,
                    username: context.username,
                    triggerType: context.source || 'agent',
                    triggerSource: agentCode,
                    triggerSourceName: agent.display_name,
                    systemPrompt,
                    userPrompt,
                    aiResponse: finalContent || '(Agent达到最大工具调用轮次，未生成最终回复)',
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    totalTokens: totalTokensAccum,
                    modelName: aiConfig.model_name || null,
                    executionTimeMs,
                    errorMessage: `Agent达到最大工具调用轮次(${MAX_TOOL_CALL_ROUNDS})，任务可能未完成`,
                    libraryId: context.libraryId,
                    moduleId: context.moduleId
                });
            } else {
                aiRequestLogger.logSuccess({
                    userId,
                    username: context.username,
                    triggerType: context.source || 'agent',
                    triggerSource: agentCode,
                    triggerSourceName: agent.display_name,
                    systemPrompt,
                    userPrompt,
                    aiResponse: finalContent,
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    totalTokens: totalTokensAccum,
                    modelName: aiConfig.model_name || null,
                    executionTimeMs,
                    libraryId: context.libraryId,
                    moduleId: context.moduleId
                });
            }

            return {
                success: true,
                result: finalContent,
                toolCallsLog,
                memoryContribution,
                executionTimeMs,
                agentId: agent.id,
                agentConfig: {
                    maxRetries: agent.max_retries || 3,
                    rules: configFiles.get('rules') || []
                }
            };

        } catch (error) {
            const executionTimeMs = Date.now() - startTime;
            logger.error('Agent执行失败', {
                agentCode,
                userId,
                error: error.message,
                executionTimeMs
            });

            agentToolUsageLogger.logFailure({
                userId,
                username: context.username,
                itemType: 'sub_agent',
                itemCode: agentCode,
                itemName: null,
                source: context.source || null,
                executionTimeMs,
                errorMessage: error.message,
                contextInfo: {
                    libraryId: context.libraryId,
                    moduleId: context.moduleId
                }
            });

            aiRequestLogger.logFailure({
                userId,
                username: context.username,
                triggerType: context.source || 'agent',
                triggerSource: agentCode,
                triggerSourceName: null,
                systemPrompt: null,
                userPrompt: null,
                aiResponse: null,
                executionTimeMs,
                errorMessage: error.message,
                modelName: aiConfig?.model_name || null,
                libraryId: context.libraryId,
                moduleId: context.moduleId
            });

            return {
                success: false,
                result: null,
                error: error.message,
                toolCallsLog: [],
                memoryContribution: null,
                executionTimeMs
            };
        }
    }

    /**
     * 解析代理：Override引擎（私有覆盖 > 系统默认）
     * @param {string} agentCode - 代理编码
     * @param {number} userId - 用户ID
     * @returns {Object|null} 代理记录
     */
    async _resolveAgent(agentCode, userId) {
        try {
            // 优先查找用户的私有覆盖
            if (userId) {
                const [privateAgents] = await pool.execute(
                    'SELECT * FROM ai_sub_agents WHERE agent_code = ? AND creator_id = ? AND is_enabled = 1 LIMIT 1',
                    [agentCode, userId]
                );
                if (privateAgents.length > 0) {
                    return privateAgents[0];
                }
            }

            // 其次查找系统默认
            const [systemAgents] = await pool.execute(
                'SELECT * FROM ai_sub_agents WHERE agent_code = ? AND is_system = 1 AND is_enabled = 1 AND visibility = \'public\' LIMIT 1',
                [agentCode]
            );
            if (systemAgents.length > 0) {
                return systemAgents[0];
            }

            // 最后查找其他公开代理
            const [publicAgents] = await pool.execute(
                'SELECT * FROM ai_sub_agents WHERE agent_code = ? AND is_enabled = 1 AND visibility = \'public\' LIMIT 1',
                [agentCode]
            );
            if (publicAgents.length > 0) {
                return publicAgents[0];
            }

            return null;
        } catch (error) {
            logger.error('解析代理失败', { agentCode, userId, error: error.message });
            return null;
        }
    }

    /**
     * 加载代理的所有配置文件
     * @param {number} agentId - 代理ID
     * @returns {Map} 配置文件Map，key为file_type，value为content
     */
    async _loadConfigFiles(agentId) {
        const configMap = new Map();
        const refDocTypes = ['checklist', 'examples', 'glossary', 'template', 'custom', 'ref_doc'];

        try {
            const [files] = await pool.execute(
                'SELECT file_type, file_name, content, sort_order FROM ai_sub_agent_config_files WHERE agent_id = ? ORDER BY sort_order ASC',
                [agentId]
            );

            for (const file of files) {
                if (file.content) {
                    if (file.file_type === 'rule') {
                        if (!configMap.has('rules')) {
                            configMap.set('rules', []);
                        }
                        configMap.get('rules').push({
                            content: file.content,
                            sort_order: file.sort_order,
                            file_name: file.file_name || ''
                        });
                    } else if (refDocTypes.includes(file.file_type)) {
                        if (!configMap.has('ref_docs')) {
                            configMap.set('ref_docs', []);
                        }
                        configMap.get('ref_docs').push({
                            type: file.file_type,
                            name: file.file_name || file.file_type,
                            content: file.content,
                            sort_order: file.sort_order
                        });
                    } else {
                        configMap.set(file.file_type, file.content);
                    }
                }
            }
        } catch (error) {
            logger.error('加载配置文件失败', { agentId, error: error.message });
        }

        return configMap;
    }

    /**
     * 加载记忆上下文（委托给memoryEngine进行JIT拼装）
     * 按设计规范：全局记忆 → 库级记忆 → 模块级记忆，带char_count限制(5000字)
     * @param {number} agentId - 代理ID
     * @param {number} libraryId - 用例库ID
     * @param {number} moduleId - 模块ID
     * @returns {string} 格式化的记忆上下文字符串
     */
    async _loadMemoryContext(agentId, libraryId, moduleId) {
        try {
            const memoryEngine = require('./memoryEngine');
            return await memoryEngine.assembleContext(agentId, libraryId, moduleId);
        } catch (error) {
            logger.error('加载记忆上下文失败', { agentId, libraryId, moduleId, error: error.message });
            return '';
        }
    }

    /**
     * 渲染User Prompt（Handlebars风格变量插值）
     * @param {string} userTemplate - 用户模板
     * @param {Object} variables - 变量对象
     * @returns {string} 渲染后的提示词
     */
    _renderUserPrompt(userTemplate, variables) {
        if (!userTemplate) {
            return '';
        }

        let rendered = userTemplate;
        const vars = variables || {};

        // 替换 {{variable_name}} 格式的变量
        rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
            if (vars.hasOwnProperty(varName)) {
                const value = vars[varName];
                if (value === null || value === undefined) {
                    return '';
                }
                if (typeof value === 'object') {
                    return JSON.stringify(value, null, 2);
                }
                return String(value);
            }
            return match;
        });

        return rendered;
    }

    /**
     * 追加参考文档到 User Prompt 末尾
     * @param {string} userPrompt - 原始 User Prompt
     * @param {Array} refDocs - 参考文档数组
     * @returns {string} 追加参考文档后的 User Prompt
     */
    _appendRefDocs(userPrompt, refDocs) {
        if (!refDocs || refDocs.length === 0) {
            return userPrompt;
        }

        // 按 sort_order 排序
        const sortedDocs = [...refDocs].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        const typeLabels = {
            checklist: '检查清单',
            examples: '示例参考',
            glossary: '术语表',
            template: '输出模板',
            custom: '自定义参考',
            ref_doc: '参考文档'
        };

        let refDocsSection = '\n\n---\n\n## 参考文档\n\n';

        for (const doc of sortedDocs) {
            const label = typeLabels[doc.type] || doc.type;
            refDocsSection += `### ${label}: ${doc.name}\n\n`;
            refDocsSection += doc.content;
            refDocsSection += '\n\n';
        }

        return userPrompt + refDocsSection;
    }

    /**
     * 解析工具名称列表
     * @param {string} toolsConfig - 工具配置（JSON字符串或逗号分隔）
     * @returns {Array} 工具名称数组
     */
    _parseToolNames(toolsConfig) {
        try {
            const parsed = JSON.parse(toolsConfig);
            if (Array.isArray(parsed)) {
                return parsed.filter(t => typeof t === 'string');
            }
        } catch (e) {
            // 不是JSON，尝试逗号分隔
        }

        if (typeof toolsConfig === 'string') {
            return toolsConfig.split(',').map(s => s.trim()).filter(Boolean);
        }

        return [];
    }

    /**
     * 加载工具配置并转换为Function Calling JSON格式
     * @param {Array} toolNames - 工具名称数组
     * @returns {Array} Function Calling格式的工具数组
     */
    async _loadToolsConfig(toolNames) {
        if (!toolNames || toolNames.length === 0) {
            return [];
        }

        const tools = [];

        try {
            const placeholders = toolNames.map(() => '?').join(',');
            const [toolRecords] = await pool.execute(
                `SELECT * FROM ai_custom_tools WHERE tool_name IN (${placeholders}) AND is_enabled = 1`,
                toolNames
            );

            for (const tool of toolRecords) {
                let inputSchema = {};
                if (tool.input_schema) {
                    try {
                        inputSchema = typeof tool.input_schema === 'string'
                            ? JSON.parse(tool.input_schema)
                            : tool.input_schema;
                    } catch (e) {
                        inputSchema = { type: 'object', properties: {} };
                    }
                }

                tools.push({
                    type: 'function',
                    function: {
                        name: tool.tool_name,
                        description: tool.description || tool.display_name || tool.tool_name,
                        parameters: inputSchema
                    }
                });
            }
        } catch (error) {
            logger.error('加载工具配置失败', { toolNames, error: error.message });
        }

        return tools;
    }

    /**
     * 调用LLM API
     * @param {string} systemPrompt - 系统提示词
     * @param {string} userPrompt - 用户提示词
     * @param {Array} tools - Function Calling工具列表
     * @param {Object} aiConfig - AI配置
     * @returns {Object} { content, tool_calls }
     */
    async _callLLM(systemPrompt, userPrompt, tools, aiConfig) {
        const apiKey = aiConfig.api_key;
        const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
        const model = aiConfig.model_name || 'deepseek-chat';

        const genParams = await getAIGenerationParams();
        const sceneParams = getSceneParams(genParams, 'scene_case_generation');

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const requestBody = {
            model: model,
            messages: messages,
            temperature: sceneParams.temperature,
            max_tokens: sceneParams.max_tokens
        };

        if (genParams.top_p !== undefined && genParams.top_p !== 1.0) {
            requestBody.top_p = genParams.top_p;
        }
        if (genParams.frequency_penalty !== undefined && genParams.frequency_penalty !== 0) {
            requestBody.frequency_penalty = genParams.frequency_penalty;
        }
        if (genParams.presence_penalty !== undefined && genParams.presence_penalty !== 0) {
            requestBody.presence_penalty = genParams.presence_penalty;
        }
        if (genParams.seed !== null && genParams.seed !== undefined) {
            requestBody.seed = genParams.seed;
        }

        if (tools && tools.length > 0) {
            requestBody.tools = tools;
            requestBody.tool_choice = genParams.tool_choice || 'auto';
        } else {
            const responseFormat = genParams.response_format || 'text';
            if (responseFormat === 'json_object') {
                requestBody.response_format = { type: 'json_object' };
            }
        }

        const timeoutConfig = await getUserAITimeoutConfig(aiConfig.user_id);

        const response = await axios.post(apiUrl, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: timeoutConfig.generalAITask || genParams.request_timeout || 120000
        });

        const choice = response.data?.choices?.[0];
        if (!choice) {
            throw new Error('LLM返回数据格式异常: 无choices');
        }

        const message = choice.message || {};
        const usage = response.data?.usage || {};

        return {
            content: message.content || '',
            tool_calls: message.tool_calls || null,
            usage: {
                prompt_tokens: usage.prompt_tokens || 0,
                completion_tokens: usage.completion_tokens || 0,
                total_tokens: usage.total_tokens || 0
            }
        };
    }

    /**
     * 带工具结果继续调用LLM
     * @param {string} systemPrompt - 系统提示词
     * @param {string} userPrompt - 用户提示词
     * @param {Array} toolCalls - 上次的工具调用
     * @param {Array} toolResults - 工具执行结果
     * @param {Array} tools - 工具定义
     * @param {Object} aiConfig - AI配置
     * @returns {Object} { content, tool_calls }
     */
    async _callLLMWithToolResults(systemPrompt, userPrompt, toolCalls, toolResults, tools, aiConfig) {
        const apiKey = aiConfig.api_key;
        const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
        const model = aiConfig.model_name || 'deepseek-chat';

        const genParams = await getAIGenerationParams();
        const sceneParams = getSceneParams(genParams, 'scene_case_generation');

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
            {
                role: 'assistant',
                content: null,
                tool_calls: toolCalls
            }
        ];

        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const tr = toolResults[i];
            messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(tr?.success ? tr.result : { error: tr?.error || '执行失败' })
            });
        }

        const requestBody = {
            model: model,
            messages: messages,
            temperature: sceneParams.temperature,
            max_tokens: sceneParams.max_tokens,
            tools: tools,
            tool_choice: genParams.tool_choice || 'auto'
        };

        const timeoutConfig = await getUserAITimeoutConfig(aiConfig.user_id);

        const response = await axios.post(apiUrl, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: timeoutConfig.generalAITask || 120000
        });

        const choice = response.data?.choices?.[0];
        if (!choice) {
            throw new Error('LLM返回数据格式异常: 无choices');
        }

        const message = choice.message || {};
        const usage = response.data?.usage || {};

        return {
            content: message.content || '',
            tool_calls: message.tool_calls || null,
            usage: {
                prompt_tokens: usage.prompt_tokens || 0,
                completion_tokens: usage.completion_tokens || 0,
                total_tokens: usage.total_tokens || 0
            }
        };
    }

    /**
     * 执行工具调用
     * @param {Array} toolCalls - LLM返回的tool_calls
     * @param {Object} context - 执行上下文
     * @returns {Array} 工具执行结果数组
     */
    async _executeToolCalls(toolCalls, context) {
        const results = [];

        for (const tc of toolCalls) {
            const toolName = tc.function?.name || tc.name;
            let params = {};

            try {
                const argsStr = tc.function?.arguments || tc.arguments || '{}';
                params = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr;
            } catch (e) {
                params = {};
            }

            const toolStartTime = Date.now();
            const result = await sandboxExecutor.executeTool(toolName, params, {
                userId: context.userId,
                userRole: context.userRole,
                username: context.username
            });
            const toolExecutionTimeMs = Date.now() - toolStartTime;

            agentToolUsageLogger.log({
                userId: context.userId,
                username: context.username,
                itemType: 'custom_tool',
                itemCode: toolName,
                itemName: null,
                source: 'agent_loop',
                executionTimeMs: toolExecutionTimeMs,
                status: result.success ? 'success' : 'failed',
                errorMessage: result.success ? null : (result.error || null),
                contextInfo: {
                    agentCode: context.agentCode || null
                }
            });

            results.push(result);
        }

        return results;
    }

    /**
     * 获取默认Soul提示词
     * @param {Object} agent - 代理记录
     * @returns {string} 默认Soul提示词
     */
    _getDefaultSoul(agent) {
        return `# ${agent.display_name || agent.agent_code}

## 身份
你是一个AI助手，专门负责${agent.description || '协助用户完成任务'}。

## 输出格式
请严格按照JSON格式输出结果。`;
    }
}

module.exports = new AgentExecutionEngine();
