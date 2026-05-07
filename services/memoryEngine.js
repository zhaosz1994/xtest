const pool = require('../db');
const { getUserAIConfig, getUserAITimeoutConfig, getUserAIGenerationParams, getSceneParams } = require('./aiService');
const logger = require('./logger');
const aiRequestLogger = require('./aiRequestLogger');
const axios = require('axios');

const MEMORY_CHAR_LIMIT = 5000;

class MemoryEngine {
    /**
     * JIT组装记忆上下文
     * 查询ai_sub_agent_memories，按level排序（global -> library -> module）
     * 如果总字符数超过MEMORY_CHAR_LIMIT，按优先级截断（先截module，再library）
     * @param {number} agentId - 代理ID
     * @param {number} libraryId - 用例库ID
     * @param {number} moduleId - 模块ID
     * @returns {string} 格式化的记忆上下文字符串，无记忆返回空字符串
     */
    async assembleContext(agentId, libraryId, moduleId) {
        try {
            // 查询所有匹配的记忆记录
            let sql = 'SELECT id, library_id, module_id, level, content, char_count FROM ai_sub_agent_memories WHERE agent_id = ?';
            const params = [agentId];

            // 按优先级过滤：全局 + 匹配的library + 匹配的module
            const conditions = ['level = \'global\''];
            if (libraryId) {
                conditions.push('(level = \'library\' AND library_id = ?)');
                params.push(libraryId);
            }
            if (moduleId) {
                conditions.push('(level = \'module\' AND module_id = ?)');
                params.push(moduleId);
            }

            sql += ` AND (${conditions.join(' OR ')}) ORDER BY level ASC`;
            const [memories] = await pool.execute(sql, params);

            if (memories.length === 0) {
                return '';
            }

            // 计算总字符数
            let totalChars = memories.reduce((sum, m) => sum + (m.char_count || 0), 0);

            // 如果超过限制，按优先级截断（先移除module级别，再移除library级别）
            let filteredMemories = [...memories];
            if (totalChars > MEMORY_CHAR_LIMIT) {
                // 先尝试移除module级别
                if (filteredMemories.some(m => m.level === 'module')) {
                    filteredMemories = filteredMemories.filter(m => m.level !== 'module');
                    totalChars = filteredMemories.reduce((sum, m) => sum + (m.char_count || 0), 0);
                }

                // 仍然超限，移除library级别
                if (totalChars > MEMORY_CHAR_LIMIT && filteredMemories.some(m => m.level === 'library')) {
                    filteredMemories = filteredMemories.filter(m => m.level !== 'library');
                    totalChars = filteredMemories.reduce((sum, m) => sum + (m.char_count || 0), 0);
                }

                // 仍然超限，截断global内容
                if (totalChars > MEMORY_CHAR_LIMIT) {
                    for (const m of filteredMemories) {
                        if (totalChars <= MEMORY_CHAR_LIMIT) break;
                        const excess = totalChars - MEMORY_CHAR_LIMIT;
                        const contentChars = m.char_count || 0;
                        if (contentChars > excess) {
                            m.content = m.content.substring(0, contentChars - excess) + '\n...(已截断)';
                            m.char_count = m.content.length;
                            totalChars = MEMORY_CHAR_LIMIT;
                        } else {
                            m.content = '';
                            m.char_count = 0;
                            totalChars -= contentChars;
                        }
                    }
                }
            }

            // 格式化为 <Memory_Context>
            const sections = [];
            for (const memory of filteredMemories) {
                if (!memory.content) continue;

                const levelLabel = {
                    global: '全局基础规范',
                    library: '用例库共识',
                    module: '模块级踩坑记录'
                }[memory.level] || memory.level;

                sections.push(`### ${levelLabel}\n${memory.content}`);
            }

            if (sections.length === 0) {
                return '';
            }

            return `<Memory_Context>\n以下是本团队长期积累的评审经验，请严格遵循：\n\n${sections.join('\n\n')}\n</Memory_Context>`;
        } catch (error) {
            logger.error('组装记忆上下文失败', { agentId, libraryId, moduleId, error: error.message });
            return '';
        }
    }

    /**
     * 获取记忆统计信息
     * @param {number} agentId - 代理ID
     * @returns {Object} 统计信息
     */
    async getMemoryStats(agentId) {
        try {
            const [rows] = await pool.execute(
                `SELECT level, COUNT(*) AS cnt, COALESCE(SUM(char_count), 0) AS total_chars, MAX(last_distilled_at) AS last_distilled_at
                 FROM ai_sub_agent_memories WHERE agent_id = ? GROUP BY level`,
                [agentId]
            );

            const stats = {
                global: { count: 0, totalChars: 0 },
                library: { count: 0, totalChars: 0 },
                module: { count: 0, totalChars: 0 },
                totalChars: 0,
                lastDistilledAt: null
            };

            let latestDistilled = null;

            for (const r of rows) {
                if (stats[r.level]) {
                    stats[r.level].count = r.cnt;
                    stats[r.level].totalChars = r.total_chars;
                }
                stats.totalChars += r.total_chars;
                if (r.last_distilled_at) {
                    if (!latestDistilled || new Date(r.last_distilled_at) > new Date(latestDistilled)) {
                        latestDistilled = r.last_distilled_at;
                    }
                }
            }

            stats.lastDistilledAt = latestDistilled;

            return stats;
        } catch (error) {
            logger.error('获取记忆统计失败', { agentId, error: error.message });
            return {
                global: { count: 0, totalChars: 0 },
                library: { count: 0, totalChars: 0 },
                module: { count: 0, totalChars: 0 },
                totalChars: 0,
                lastDistilledAt: null
            };
        }
    }

    async getBatchMemoryStats(agentIds) {
        if (!agentIds || agentIds.length === 0) return {};

        try {
            const placeholders = agentIds.map(() => '?').join(',');
            const [rows] = await pool.execute(
                `SELECT agent_id, level, COUNT(*) AS cnt, COALESCE(SUM(char_count), 0) AS total_chars, MAX(last_distilled_at) AS last_distilled_at
                 FROM ai_sub_agent_memories WHERE agent_id IN (${placeholders}) GROUP BY agent_id, level`,
                agentIds
            );

            const result = {};
            for (const id of agentIds) {
                result[id] = {
                    global: { count: 0, totalChars: 0 },
                    library: { count: 0, totalChars: 0 },
                    module: { count: 0, totalChars: 0 },
                    totalChars: 0,
                    lastDistilledAt: null
                };
            }

            for (const r of rows) {
                const aid = r.agent_id;
                if (!result[aid]) continue;
                if (result[aid][r.level]) {
                    result[aid][r.level].count = r.cnt;
                    result[aid][r.level].totalChars = r.total_chars;
                }
                result[aid].totalChars += r.total_chars;
                if (r.last_distilled_at) {
                    if (!result[aid].lastDistilledAt || new Date(r.last_distilled_at) > new Date(result[aid].lastDistilledAt)) {
                        result[aid].lastDistilledAt = r.last_distilled_at;
                    }
                }
            }

            return result;
        } catch (error) {
            logger.error('批量获取记忆统计失败', { agentIds, error: error.message });
            const result = {};
            for (const id of agentIds) {
                result[id] = {
                    global: { count: 0, totalChars: 0 },
                    library: { count: 0, totalChars: 0 },
                    module: { count: 0, totalChars: 0 },
                    totalChars: 0,
                    lastDistilledAt: null
                };
            }
            return result;
        }
    }

    /**
     * 获取记忆树结构（用于UI展示）
     * @param {number} agentId - 代理ID
     * @returns {Object} 树结构 { global: [...], libraries: [...] }
     */
    async getMemoryTree(agentId) {
        try {
            const [memories] = await pool.execute(
                `SELECT m.id, m.library_id, m.module_id, m.level, m.content, m.char_count,
                        l.name as library_name, mo.name as module_name
                 FROM ai_sub_agent_memories m
                 LEFT JOIN case_libraries l ON m.library_id = l.id
                 LEFT JOIN modules mo ON m.module_id = mo.id
                 WHERE m.agent_id = ?
                 ORDER BY m.level ASC, m.library_id ASC, m.module_id ASC`,
                [agentId]
            );

            const tree = {
                global: [],
                libraries: []
            };

            const libraryMap = new Map();

            for (const m of memories) {
                if (m.level === 'global') {
                    tree.global.push({
                        id: m.id,
                        content: m.content,
                        charCount: m.char_count
                    });
                } else if (m.level === 'library' || m.level === 'module') {
                    const libId = m.library_id || 0;
                    if (!libraryMap.has(libId)) {
                        libraryMap.set(libId, {
                            libraryId: libId,
                            libraryName: m.library_name || '未知用例库',
                            modules: []
                        });
                    }

                    if (m.level === 'library') {
                        libraryMap.get(libId).charCount = m.char_count;
                        libraryMap.get(libId).content = m.content;
                        libraryMap.get(libId).id = m.id;
                    } else if (m.level === 'module') {
                        libraryMap.get(libId).modules.push({
                            id: m.id,
                            moduleId: m.module_id,
                            moduleName: m.module_name || '未知模块',
                            charCount: m.char_count,
                            content: m.content
                        });
                    }
                }
            }

            tree.libraries = Array.from(libraryMap.values());

            return tree;
        } catch (error) {
            logger.error('获取记忆树失败', { agentId, error: error.message });
            return { global: [], libraries: [] };
        }
    }

    /**
     * 获取特定记忆节点的详细内容
     * @param {number} agentId - 代理ID
     * @param {number} libraryId - 用例库ID
     * @param {number} moduleId - 模块ID
     * @returns {Object|null} 记忆详情
     */
    async getMemoryDetail(agentId, libraryId, moduleId) {
        try {
            let sql = 'SELECT * FROM ai_sub_agent_memories WHERE agent_id = ?';
            const params = [agentId];

            if (libraryId === null || libraryId === undefined) {
                sql += ' AND (library_id IS NULL OR library_id = 0)';
            } else {
                sql += ' AND library_id = ?';
                params.push(libraryId);
            }

            if (moduleId === null || moduleId === undefined) {
                sql += ' AND (module_id IS NULL OR module_id = 0)';
            } else {
                sql += ' AND module_id = ?';
                params.push(moduleId);
            }

            sql += ' LIMIT 1';

            const [memories] = await pool.execute(sql, params);
            return memories[0] || null;
        } catch (error) {
            logger.error('获取记忆详情失败', { agentId, libraryId, moduleId, error: error.message });
            return null;
        }
    }

    /**
     * 更新（Upsert）记忆内容
     * @param {number} agentId - 代理ID
     * @param {number} libraryId - 用例库ID
     * @param {number} moduleId - 模块ID
     * @param {string} content - 记忆内容
     * @returns {Object} 操作结果
     */
    async updateMemory(agentId, libraryId, moduleId, content) {
        try {
            const charCount = content ? content.length : 0;

            let level = 'global';
            if (libraryId && moduleId) {
                level = 'module';
            } else if (libraryId) {
                level = 'library';
            }

            const libVal = libraryId || null;
            const modVal = moduleId || null;

            const [existing] = await pool.execute(
                `SELECT id FROM ai_sub_agent_memories 
                 WHERE agent_id = ? AND ((library_id = ? AND ? IS NOT NULL) OR (library_id IS NULL AND ? IS NULL))
                 AND ((module_id = ? AND ? IS NOT NULL) OR (module_id IS NULL AND ? IS NULL))`,
                [agentId, libVal, libVal, libVal, modVal, modVal, modVal]
            );

            if (existing.length > 0) {
                await pool.execute(
                    `UPDATE ai_sub_agent_memories SET content = ?, char_count = ?, level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [content || '', charCount, level, existing[0].id]
                );
            } else {
                await pool.execute(
                    `INSERT INTO ai_sub_agent_memories (agent_id, library_id, module_id, level, content, char_count) VALUES (?, ?, ?, ?, ?, ?)`,
                    [agentId, libVal, modVal, level, content || '', charCount]
                );
            }

            logger.info('记忆更新成功', { agentId, libraryId, moduleId, level, charCount });

            return { success: true, charCount };
        } catch (error) {
            logger.error('更新记忆失败', { agentId, libraryId, moduleId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 蒸馏记忆：通过LLM压缩/合并现有记忆内容
     * @param {number} agentId - 代理ID
     * @param {number} libraryId - 用例库ID
     * @param {number} moduleId - 模块ID
     * @returns {Object} { success, distilledContent, charCount }
     */
    async distillMemory(agentId, libraryId, moduleId) {
        try {
            // 1. 加载当前记忆内容
            const memory = await this.getMemoryDetail(agentId, libraryId, moduleId);
            if (!memory || !memory.content) {
                return { success: true, distilledContent: '', charCount: 0 };
            }

            // 2. 获取AI配置
            const [agent] = await pool.execute(
                'SELECT creator_id FROM ai_sub_agents WHERE id = ?',
                [agentId]
            );
            const userId = agent[0]?.creator_id;
            const aiConfig = await getUserAIConfig(userId);
            if (!aiConfig) {
                return { success: false, error: '未配置AI模型' };
            }

            // 3. 调用蒸馏Agent
            const distilledContent = await this._callDistillerAgent(memory.content, null, aiConfig, userId);

            // 4. 更新记忆
            const charCount = distilledContent ? distilledContent.length : 0;
            await pool.execute(`
                UPDATE ai_sub_agent_memories
                SET content = ?, char_count = ?, last_distilled_at = NOW()
                WHERE agent_id = ? AND ((library_id = ? AND ? IS NOT NULL) OR (library_id IS NULL AND ? IS NULL))
                AND ((module_id = ? AND ? IS NOT NULL) OR (module_id IS NULL AND ? IS NULL))
            `, [distilledContent, charCount, agentId, libraryId, libraryId, libraryId, moduleId, moduleId, moduleId]);

            logger.info('记忆蒸馏完成', { agentId, libraryId, moduleId, originalChars: memory.char_count, distilledChars: charCount });

            return { success: true, distilledContent, charCount };
        } catch (error) {
            logger.error('记忆蒸馏失败', { agentId, libraryId, moduleId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 从用户修正中蒸馏记忆
     * @param {number} agentId - 代理ID
     * @param {number} libraryId - 用例库ID
     * @param {number} moduleId - 模块ID
     * @param {Object} suggestedContent - AI建议的内容
     * @param {Object} userModifiedContent - 用户修改后的内容
     * @returns {Object} { success, distilledContent, charCount }
     */
    async distillFromUserCorrection(agentId, libraryId, moduleId, suggestedContent, userModifiedContent) {
        try {
            // 1. 生成diff
            const diff = require('./diffGenerator');
            const diffSummary = diff.generateDiffSummary(suggestedContent, userModifiedContent);
            const diffDetail = diff.generateDiffDetail(suggestedContent, userModifiedContent);

            if (!diffSummary && diffDetail.length === 0) {
                return { success: true, distilledContent: '', charCount: 0, message: '无差异，无需蒸馏' };
            }

            // 2. 加载当前记忆
            const memory = await this.getMemoryDetail(agentId, libraryId, moduleId);
            const currentMemory = memory ? memory.content : '';

            // 3. 获取AI配置
            const [agent] = await pool.execute(
                'SELECT creator_id FROM ai_sub_agents WHERE id = ?',
                [agentId]
            );
            const userId = agent[0]?.creator_id;
            const aiConfig = await getUserAIConfig(userId);
            if (!aiConfig) {
                return { success: false, error: '未配置AI模型' };
            }

            // 4. 调用蒸馏Agent合并用户修正
            const userDiff = diffSummary || JSON.stringify(diffDetail);
            const distilledContent = await this._callDistillerAgent(currentMemory, userDiff, aiConfig, userId);

            // 5. Upsert记忆
            const result = await this.updateMemory(agentId, libraryId, moduleId, distilledContent);

            logger.info('用户修正蒸馏完成', {
                agentId, libraryId, moduleId,
                diffSummary: diffSummary.substring(0, 100),
                charCount: result.charCount
            });

            return {
                success: true,
                distilledContent,
                charCount: result.charCount,
                diffSummary,
                diffDetail
            };
        } catch (error) {
            logger.error('用户修正蒸馏失败', { agentId, libraryId, moduleId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 检查并自动蒸馏超限记忆
     * @param {number} agentId - 代理ID
     * @returns {Object} { distilled: number, results: [] }
     */
    async checkAndAutoDistill(agentId) {
        try {
            // 获取代理的蒸馏阈值
            const [agents] = await pool.execute(
                'SELECT memory_distill_threshold FROM ai_sub_agents WHERE id = ?',
                [agentId]
            );

            if (agents.length === 0) {
                return { distilled: 0, results: [] };
            }

            const threshold = agents[0].memory_distill_threshold || 2000;

            // 查找超限的记忆节点
            const [memories] = await pool.execute(
                'SELECT id, library_id, module_id, level, char_count FROM ai_sub_agent_memories WHERE agent_id = ? AND char_count > ?',
                [agentId, threshold]
            );

            const results = [];

            for (const m of memories) {
                const result = await this.distillMemory(agentId, m.library_id, m.module_id);
                results.push({
                    level: m.level,
                    libraryId: m.library_id,
                    moduleId: m.module_id,
                    originalChars: m.char_count,
                    distilledChars: result.charCount,
                    success: result.success
                });
            }

            if (results.length > 0) {
                logger.info('自动蒸馏完成', { agentId, distilledCount: results.length });
            }

            return { distilled: results.length, results };
        } catch (error) {
            logger.error('自动蒸馏检查失败', { agentId, error: error.message });
            return { distilled: 0, results: [], error: error.message };
        }
    }

    /**
     * 重置代理的所有记忆
     * @param {number} agentId - 代理ID
     * @returns {Object} { success, deletedCount }
     */
    async resetAllMemories(agentId) {
        try {
            const [result] = await pool.execute(
                'DELETE FROM ai_sub_agent_memories WHERE agent_id = ?',
                [agentId]
            );

            logger.info('记忆重置完成', { agentId, deletedCount: result.affectedRows });

            return { success: true, deletedCount: result.affectedRows };
        } catch (error) {
            logger.error('记忆重置失败', { agentId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 调用蒸馏Agent（LLM）
     * @param {string} currentMemory - 当前记忆内容
     * @param {string|null} userDiff - 用户修正差异（为null时为主动蒸馏）
     * @param {Object} aiConfig - AI配置
     * @param {number} userId - 用户ID
     * @returns {string} 蒸馏后的内容（最多500字符）
     */
    async _callDistillerAgent(currentMemory, userDiff, aiConfig, userId) {
        const apiKey = aiConfig.api_key;
        const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
        const model = aiConfig.model_name || 'deepseek-chat';
        const startTime = Date.now();

        let systemPrompt = `你是经验提炼专家，将信息压缩合并到现有记忆中。

## 规则
1. 保留所有关键规则和事实，删除冗余描述
2. 合并重复的条目
3. 使用简洁的条目式表达
4. 输出内容不超过500字符
5. 如果当前记忆为空，直接提炼输入内容
6. 只输出提炼后的内容，不要添加解释`;

        let userPrompt = '';

        if (userDiff) {
            userPrompt = `## 当前记忆
${currentMemory || '(空)'}

## 用户修正差异
${userDiff}

请将用户修正差异合并到当前记忆中，输出合并后的精炼记忆。`;
        } else {
            userPrompt = `## 当前记忆
${currentMemory || '(空)'}

请精炼压缩以上记忆内容，保留关键信息，删除冗余。`;
        }

        const timeoutConfig = await getUserAITimeoutConfig(userId);
        const genParams = await getUserAIGenerationParams(userId);
        const sceneParams = getSceneParams(genParams, 'scene_memory_distillation');

        try {
            const response = await axios.post(apiUrl, {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: sceneParams.temperature,
                max_tokens: sceneParams.max_tokens
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: timeoutConfig.generalAITask || genParams.request_timeout || 120000
            });

            const content = response.data?.choices?.[0]?.message?.content || '';
            const promptTokens = response.data?.usage?.prompt_tokens || 0;
            const completionTokens = response.data?.usage?.completion_tokens || 0;
            const totalTokens = response.data?.usage?.total_tokens || 0;
            const executionTimeMs = Date.now() - startTime;

            aiRequestLogger.logSuccess({
                userId: aiConfig.user_id,
                triggerType: 'memory_refine',
                triggerSource: 'memory_distiller',
                triggerSourceName: '记忆提炼',
                systemPrompt,
                userPrompt,
                aiResponse: content,
                promptTokens,
                completionTokens,
                totalTokens,
                modelName: model,
                executionTimeMs
            });

            if (content.length > 500) {
                return content.substring(0, 497) + '...';
            }

            return content;
        } catch (error) {
            const executionTimeMs = Date.now() - startTime;
            aiRequestLogger.logFailure({
                userId: aiConfig.user_id,
                triggerType: 'memory_refine',
                triggerSource: 'memory_distiller',
                triggerSourceName: '记忆提炼',
                systemPrompt,
                userPrompt,
                executionTimeMs,
                errorMessage: error.message,
                modelName: model
            });
            throw error;
        }
    }
}

module.exports = new MemoryEngine();
