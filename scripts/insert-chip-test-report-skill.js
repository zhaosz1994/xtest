const pool = require('../db');

async function insertChipTestReportSkill() {
    const connection = await pool.getConnection();
    
    try {
        const skillData = {
            name: 'generate_chip_test_report_analysis',
            display_name: '生成芯片测试分析报告',
            description: '分析测试计划数据和错误日志，结构化输出测试策略、总结、遗留问题和限制。',
            definition: JSON.stringify({
                type: "function",
                function: {
                    name: "fill_report_analysis",
                    description: "根据提供的测试执行数据，提炼并填充测试报告的总结与评估板块",
                    parameters: {
                        type: "object",
                        properties: {
                            test_strategy: {
                                type: "string",
                                description: "测试策略【明确测试范围】：根据关联的 module_id 和 test_type，总结本次测试覆盖的功能模块和主要策略。"
                            },
                            test_summary: {
                                type: "string",
                                description: "测试总结【明确可否发布】：基于整体 pass_rate、核心缺陷情况，给出明确的结论（例如：达到发布标准，或存在致命缺陷建议暂缓发布）。"
                            },
                            legacy_issues: {
                                type: "string",
                                description: "遗留重要问题【明确问题及影响】：重点分析状态为 Fail, ASIC_Hang, Core_Dump, Traffic_Drop 的用例，提取关键 error_message，说明对系统的具体影响。"
                            },
                            limitations: {
                                type: "string",
                                description: "限制【明确限制原因】：分析状态为 Block 的用例，或者测试环境中未能覆盖的边界条件，说明本次测试的局限性。"
                            }
                        },
                        required: ["test_strategy", "test_summary", "legacy_issues", "limitations"]
                    }
                }
            }),
            execute_code: `
const fetch = require('node-fetch');

const SYSTEM_PROMPT = \`【强制分析原则】
你是一个专业的网络芯片测试分析专家。在分析报文丢弃 (Traffic_Drop) 或流控相关的测试日志时，必须严格遵守以下底层硬件逻辑：
PFC (Priority Flow Control) 帧本身并不占用交换机缓存 (Buffer)。
绝对禁止在报告中推导出"由于 PFC 帧过多导致 Buffer 溢出/耗尽"之类的错误结论。如果出现丢包，请引导排查入向映射、死锁或队列调度配置等方向。

【报告格式规范】
1. 所有分析结论必须基于实际测试数据
2. 时间戳和数据来源必须准确标注
3. 问题分析需要给出具体的模块和用例ID
4. 建议措施需要具体可执行

请严格按照 function calling 的参数格式返回分析结果。\`;

async function executeChipTestReportAnalysis(args) {
    const { testPlanData, statistics, moduleDistribution, failedCases, blockedCases, aiModel } = args;
    
    const userPrompt = \`请分析以下测试数据并生成报告分析：

## 测试计划信息
- 项目: \${testPlanData.project || '-'}
- 测试计划: \${testPlanData.name || '-'}
- 测试阶段: \${testPlanData.testPhase || '-'}
- 测试负责人: \${testPlanData.owner || '-'}

## 测试统计数据
- 总用例数: \${statistics.total}
- 通过数: \${statistics.passed}
- 失败数: \${statistics.failed}
- 阻塞数: \${statistics.blocked}
- 未执行: \${statistics.notRun}
- 通过率: \${statistics.passRate}%

## 模块覆盖情况
\${Object.entries(moduleDistribution).slice(0, 20).map(([name, stats]) => 
    \`- \${name}: 总数\${stats.total}, 通过\${stats.passed}, 失败\${stats.failed}\`
).join('\\n')}

## 失败用例详情（前20条）
\${failedCases.slice(0, 20).map(tc => 
    \`- 用例ID: \${tc.caseId || tc.id}, 名称: \${tc.name}, 模块: \${tc.module || '-'}, 状态: \${tc.status}\`
).join('\\n')}

## 阻塞用例详情（前10条）
\${blockedCases.slice(0, 10).map(tc => 
    \`- 用例ID: \${tc.caseId || tc.id}, 名称: \${tc.name}, 模块: \${tc.module || '-'}\`
).join('\\n')}

请根据以上数据，调用 fill_report_analysis 函数返回分析结果。\`;

    try {
        const response = await fetch(aiModel.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': \`Bearer \${aiModel.api_key}\`
            },
            body: JSON.stringify({
                model: aiModel.model_name,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt }
                ],
                tools: [{
                    type: 'function',
                    function: {
                        name: 'fill_report_analysis',
                        description: '根据提供的测试执行数据，提炼并填充测试报告的总结与评估板块',
                        parameters: {
                            type: 'object',
                            properties: {
                                test_strategy: {
                                    type: 'string',
                                    description: '测试策略【明确测试范围】：根据关联的 module_id 和 test_type，总结本次测试覆盖的功能模块和主要策略。'
                                },
                                test_summary: {
                                    type: 'string',
                                    description: '测试总结【明确可否发布】：基于整体 pass_rate、核心缺陷情况，给出明确的结论。'
                                },
                                legacy_issues: {
                                    type: 'string',
                                    description: '遗留重要问题【明确问题及影响】：重点分析状态为 Fail, ASIC_Hang, Core_Dump, Traffic_Drop 的用例。'
                                },
                                limitations: {
                                    type: 'string',
                                    description: '限制【明确限制原因】：分析状态为 Block 的用例，或者测试环境中未能覆盖的边界条件。'
                                }
                            },
                            required: ['test_strategy', 'test_summary', 'legacy_issues', 'limitations']
                        }
                    }
                }],
                tool_choice: { type: 'function', function: { name: 'fill_report_analysis' } },
                temperature: 0.3
            })
        });

        if (!response.ok) {
            throw new Error(\`AI API请求失败: \${response.status}\`);
        }

        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            const toolCalls = data.choices[0].message.tool_calls;
            if (toolCalls && toolCalls.length > 0) {
                const functionArgs = JSON.parse(toolCalls[0].function.arguments);
                return {
                    success: true,
                    analysis: functionArgs
                };
            }
        }
        
        return {
            success: false,
            error: '未能获取结构化分析结果'
        };
    } catch (error) {
        console.error('芯片测试报告分析执行错误:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

return await executeChipTestReportAnalysis(args);
`,
            category: 'report',
            is_enabled: true,
            is_system: true,
            created_by: 'system'
        };

        const [existing] = await connection.execute(
            'SELECT id FROM ai_skills WHERE name = ?',
            [skillData.name]
        );

        if (existing.length > 0) {
            await connection.execute(`
                UPDATE ai_skills SET 
                    display_name = ?,
                    description = ?,
                    definition = ?,
                    execute_code = ?,
                    category = ?,
                    is_enabled = ?,
                    is_system = ?,
                    updated_at = NOW()
                WHERE name = ?
            `, [
                skillData.display_name,
                skillData.description,
                skillData.definition,
                skillData.execute_code,
                skillData.category,
                skillData.is_enabled,
                skillData.is_system,
                skillData.name
            ]);
            console.log('✅ AI技能已更新:', skillData.name);
        } else {
            await connection.execute(`
                INSERT INTO ai_skills (name, display_name, description, definition, execute_code, category, is_enabled, is_system, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                skillData.name,
                skillData.display_name,
                skillData.description,
                skillData.definition,
                skillData.execute_code,
                skillData.category,
                skillData.is_enabled,
                skillData.is_system,
                skillData.created_by
            ]);
            console.log('✅ AI技能已插入:', skillData.name);
        }

        console.log('\n📋 技能详情:');
        console.log('  - 名称:', skillData.name);
        console.log('  - 显示名:', skillData.display_name);
        console.log('  - 描述:', skillData.description);
        console.log('  - 分类:', skillData.category);
        
    } catch (error) {
        console.error('❌ 插入AI技能失败:', error);
        throw error;
    } finally {
        connection.release();
        await pool.end();
    }
}

insertChipTestReportSkill().catch(console.error);
