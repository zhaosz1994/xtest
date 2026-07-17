const pool = require('../db');
const { getUserAIConfig, getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams } = require('./aiService');
const { buildAIHeaders, callAIStreamWithRetry } = require('./aiCallWrapper');
const llmResponseParser = require('./llmResponseParser');
const logger = require('./logger');
const aiRequestLogger = require('./aiRequestLogger');

class ReflectionPipeline {
    async executeReflectionPipeline(agentId, draft, rules, context) {
        let currentDraft = draft;
        let reviewHistory = [];
        const maxRetries = context.maxRetries || 3;
        let lastPassedRule = 0;
        let totalRounds = 0;

        const aiConfig = await getUserAIConfig(context.userId);
        if (!aiConfig) {
            throw new Error('未配置AI模型，请先在设置中配置AI模型');
        }

        const genParams = await getUserAIGenerationParams(context.userId);
        const sceneParams = getSceneParams(genParams, 'scene_case_generation');

        const agentConfig = await this.loadAgentConfig(agentId);
        const effectiveModel = agentConfig?.llm_model || aiConfig.model_name || 'deepseek-chat';
        const effectiveTemperature = agentConfig?.llm_temperature != null ? parseFloat(agentConfig.llm_temperature) : sceneParams.temperature;
        const effectiveMaxTokens = agentConfig?.llm_max_tokens ?? sceneParams.max_tokens ?? 4000;

        const timeoutConfig = await getUserAITimeoutConfig(aiConfig.user_id);
        const timeout = timeoutConfig.generalAITask || genParams.request_timeout || 120000;

        const cachedContext = {
            aiConfig,
            timeout,
            effectiveModel,
            effectiveTemperature,
            effectiveMaxTokens
        };

        for (const rule of rules) {
            let retries = 0;
            let passed = false;

            while (!passed && retries < maxRetries) {
                totalRounds++;
                try {
                    const result = await this._callRuleLLM(
                        agentId,
                        rule,
                        currentDraft,
                        reviewHistory,
                        cachedContext
                    );

                    if (result.passed) {
                        passed = true;
                        currentDraft = result.revised_draft || currentDraft;
                        lastPassedRule = rule.sort_order;
                        reviewHistory.push({
                            type: 'passed',
                            rule_sort_order: rule.sort_order,
                            summary: result.summary || '',
                            text: '[规则' + rule.sort_order + '] 通过: ' + (result.summary || '')
                        });
                    } else {
                        if (result.revised_draft) {
                            currentDraft = result.revised_draft;
                        } else {
                            logger.warn('反思管道：规则未通过且LLM未提供修正草稿，跳过剩余重试', {
                                agentId,
                                ruleSortOrder: rule.sort_order,
                                retries
                            });
                            reviewHistory.push({
                                type: 'retry',
                                rule_sort_order: rule.sort_order,
                                retry_count: retries + 1,
                                summary: result.summary || 'LLM未提供修正草稿',
                                text: '[规则' + rule.sort_order + '] LLM未提供修正草稿，终止重试'
                            });
                            break;
                        }
                        retries++;
                        reviewHistory.push({
                            type: 'retry',
                            rule_sort_order: rule.sort_order,
                            retry_count: retries,
                            summary: result.summary || '',
                            text: '[规则' + rule.sort_order + '] 第' + retries + '次修正: ' + (result.summary || '')
                        });
                    }
                } catch (err) {
                    retries++;
                    reviewHistory.push({
                        type: 'error',
                        rule_sort_order: rule.sort_order,
                        retry_count: retries,
                        summary: err.message,
                        text: '[规则' + rule.sort_order + '] 第' + retries + '次调用异常: ' + err.message
                    });
                    logger.error('反思管道规则调用异常', {
                        agentId,
                        ruleSortOrder: rule.sort_order,
                        retries,
                        error: err.message
                    });
                }
            }

            if (!passed) {
                return {
                    status: 'needs_human',
                    failed_rule: rule.sort_order,
                    final_rule_passed: lastPassedRule,
                    draft: currentDraft,
                    history: reviewHistory,
                    total_rounds: totalRounds
                };
            }
        }

        return {
            status: 'passed',
            final_rule_passed: lastPassedRule,
            draft: currentDraft,
            history: reviewHistory,
            total_rounds: totalRounds,
            last_rule_summary: reviewHistory.length > 0 ? reviewHistory[reviewHistory.length - 1].summary : ''
        };
    }

    _parseReflectionResponse(content) {
        if (!content) return null;
        const result = {};
        const lines = content.trim().split('\n');
        let currentKey = null;
        let currentValue = '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            const colonIdx = line.indexOf(':');
            if (colonIdx > 0 && colonIdx < line.length - 1) {
                if (currentKey) {
                    result[currentKey] = currentValue.trim();
                }
                currentKey = line.substring(0, colonIdx).trim();
                currentValue = line.substring(colonIdx + 1).trim();
            } else if (currentKey) {
                currentValue += ' ' + line;
            }
        }
        if (currentKey) {
            result[currentKey] = currentValue.trim();
        }

        if (result.passed === undefined && result.summary === undefined) {
            return null;
        }

        const parsed = {
            passed: result.passed === 'true' || result.passed === true,
            summary: result.summary || '',
            confidence: parseFloat(result.confidence || 0),
            revised_draft: null
        };

        if (result.revised_draft && result.revised_draft !== 'null') {
            try {
                parsed.revised_draft = JSON.parse(result.revised_draft);
            } catch (e) {
                parsed.revised_draft = result.revised_draft;
            }
        }

        return parsed;
    }

    async _callRuleLLM(agentId, rule, currentDraft, reviewHistory, cachedContext) {
        const { aiConfig, timeout, effectiveModel, effectiveTemperature, effectiveMaxTokens } = cachedContext;

        const apiKey = aiConfig.api_key;
        const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';

        const historyTexts = reviewHistory.map(h => h.text);
        const systemPrompt = rule.content;
        const userPrompt = '## 当前草稿\n' + JSON.stringify(currentDraft, null, 2) +
            '\n\n## 前序评审履历\n' + (historyTexts.length > 0 ? historyTexts.join('\n') : '（无前序履历，这是第一轮评审）') +
            '\n\n## 输出要求\n请按以下格式输出评审结果，每行一个字段，不要输出JSON、不要加引号、不要加花括号：\n' +
            'passed: true或false\n' +
            'summary: 评审摘要\n' +
            'confidence: 置信度分数(0-100)\n' +
            'revised_draft: 修正后的草稿JSON（未通过时必须提供，通过时写null）';

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const requestBody = {
            model: effectiveModel,
            messages: messages,
            temperature: effectiveTemperature,
            max_tokens: effectiveMaxTokens
        };

        const headers = buildAIHeaders(aiConfig.provider, apiKey);
        const startTime = Date.now();

        try {
            const streamResult = await callAIStreamWithRetry(apiUrl, requestBody, headers, aiConfig, {
                timeout: timeout + 10000,
                logContext: { triggerSource: 'reflection_stream', model: effectiveModel }
            });

            const content = streamResult.content || '';
            const promptTokens = streamResult.usage?.prompt_tokens || 0;
            const completionTokens = streamResult.usage?.completion_tokens || 0;
            const totalTokens = streamResult.usage?.total_tokens || 0;
            const executionTimeMs = Date.now() - startTime;

            aiRequestLogger.logSuccess({
                userId: aiConfig.user_id,
                triggerType: 'reflection',
                triggerSource: 'rule_' + (rule.sort_order || 'unknown'),
                triggerSourceName: '反思管道-规则评审',
                systemPrompt,
                userPrompt,
                aiResponse: content,
                promptTokens,
                completionTokens,
                totalTokens,
                modelName: effectiveModel,
                executionTimeMs
            });

            let parsed = this._parseReflectionResponse(content);

            if (!parsed) {
                parsed = llmResponseParser.parseJSON(content);
            }

            if (!parsed) {
                logger.warn('反思管道LLM响应解析失败', {
                    agentId,
                    ruleSortOrder: rule.sort_order,
                    contentPreview: content.substring(0, 200)
                });
                return {
                    passed: false,
                    summary: 'LLM响应解析失败',
                    revised_draft: currentDraft,
                    confidence: 0
                };
            }

            return {
                passed: !!parsed.passed,
                summary: parsed.summary || parsed.reason || '',
                revised_draft: parsed.revised_draft || parsed.revisedDraft || parsed.revised_content || null,
                confidence: parseFloat(parsed.confidence || parsed.score || 0)
            };
        } catch (error) {
            const executionTimeMs = Date.now() - startTime;
            aiRequestLogger.logFailure({
                userId: aiConfig.user_id,
                triggerType: 'reflection',
                triggerSource: 'rule_' + (rule.sort_order || 'unknown'),
                triggerSourceName: '反思管道-规则评审',
                systemPrompt,
                userPrompt,
                executionTimeMs,
                errorMessage: error.message,
                modelName: effectiveModel
            });
            throw error;
        }
    }

    async loadRules(agentId) {
        try {
            const [files] = await pool.execute(
                "SELECT file_name, content, sort_order FROM ai_sub_agent_config_files WHERE agent_id = ? AND file_type = 'rule' ORDER BY sort_order ASC",
                [agentId]
            );
            return files.map(f => ({
                file_name: f.file_name,
                content: f.content,
                sort_order: f.sort_order
            }));
        } catch (error) {
            logger.error('加载规则配置文件失败', { agentId, error: error.message });
            return [];
        }
    }

    async loadAgentConfig(agentId) {
        try {
            const [agents] = await pool.execute(
                'SELECT id, agent_code, display_name, max_retries, llm_model, llm_temperature, llm_max_tokens FROM ai_sub_agents WHERE id = ?',
                [agentId]
            );
            return agents[0] || null;
        } catch (error) {
            logger.error('加载Agent配置失败', { agentId, error: error.message });
            return null;
        }
    }
}

module.exports = new ReflectionPipeline();
