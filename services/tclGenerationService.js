const pool = require('../db');
const logger = require('./logger');
const embeddingAdapter = require('./embeddingAdapter');
const scriptRunnerClient = require('./scriptRunnerClient');
const chipContextService = require('./chipContextService');
const bugRagService = require('./bugRagService');
const { getSystemDefaultAIConfig } = require('./aiService');
const { buildAIHeaders } = require('./aiCallWrapper');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SCRIPTS_DIR = path.join(__dirname, '..', 'uploads', 'scripts');

class TCLGenerationService {
  async generate(taskId, moduleId, level1PointId, userId, options = {}) {
    try {
      await pool.execute(
        `INSERT INTO tcl_generation_tasks (task_id, module_id, user_id, level1_point_id, status, chip_version_id, execution_env_id) VALUES (?, ?, ?, ?, 'generating', ?, ?)`,
        [taskId, moduleId, userId, level1PointId, options.chipVersionId || null, options.executionEnvId || null]
      );
    } catch (error) {
      if (error.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(error.message)) {
        try {
          await pool.execute(
            `INSERT INTO tcl_generation_tasks (task_id, module_id, user_id, level1_point_id, status) VALUES (?, ?, ?, ?, 'generating')`,
            [taskId, moduleId, userId, level1PointId]
          );
        } catch (fallbackError) {
          logger.error('TCL生成: 创建任务记录失败', { taskId, error: fallbackError.message });
          return { success: false, error: fallbackError.message };
        }
      } else {
        logger.error('TCL生成: 创建任务记录失败', { taskId, error: error.message });
        return { success: false, error: error.message };
      }
    }

    let level1PointName = '';
    let libraryId = null;
    try {
      const [points] = await pool.execute(
        'SELECT name, library_id FROM level1_points WHERE id = ?',
        [level1PointId]
      );
      if (points.length > 0) {
        level1PointName = points[0].name;
        libraryId = points[0].library_id;
      }
    } catch (error) {
      logger.warn('TCL生成: 查询一级测试点失败', { level1PointId, error: error.message });
    }

    if (libraryId) {
      try {
        await pool.execute(
          'UPDATE tcl_generation_tasks SET library_id = ? WHERE task_id = ?',
          [libraryId, taskId]
        );
      } catch (_) {}
    }

    try {
      await pool.execute(
        'UPDATE tcl_generation_tasks SET level1_point_name = ? WHERE task_id = ?',
        [level1PointName, taskId]
      );
    } catch (_) {}

    let ragContext;
    try {
      ragContext = await this._assembleKnowledge(level1PointName, moduleId, { ...options, level1PointId, libraryId });
      const ragContextStr = JSON.stringify(ragContext);
      await pool.execute(
        'UPDATE tcl_generation_tasks SET rag_context = ? WHERE task_id = ?',
        [ragContextStr, taskId]
      );
    } catch (error) {
      logger.warn('TCL生成: 知识检索失败', { taskId, error: error.message });
      ragContext = { cli: [], tcl_convention: [], register_map: [], register_field: [], sdk_api: [], bug_rag: [], execution_experience: [], environment: [], results: [] };
    }

    let tclContent;
    try {
      tclContent = await this._generateTCL(
        level1PointName,
        options.testType || 'functional',
        options.dimension || 'functional',
        ragContext,
        options.globalContext || '',
        options
      );
      await pool.execute(
        'UPDATE tcl_generation_tasks SET tcl_content = ? WHERE task_id = ?',
        [tclContent, taskId]
      );
    } catch (error) {
      logger.error('TCL生成: LLM生成失败', { taskId, error: error.message });
      await this._failTask(taskId, `LLM生成失败: ${error.message}`);
      return { success: false, error: error.message };
    }

    let validation;
    try {
      validation = await this._staticValidation(tclContent);
      await pool.execute(
        'UPDATE tcl_generation_tasks SET reflection_result = ? WHERE task_id = ?',
        [JSON.stringify(validation), taskId]
      );
    } catch (error) {
      logger.warn('TCL生成: 静态校验失败', { taskId, error: error.message });
      validation = { passed: true, issues: [] };
    }

    const hasNeedsHuman = /needs_human\s*[:=]\s*true/i.test(tclContent);
    if (hasNeedsHuman || !validation.passed) {
      const reason = hasNeedsHuman
        ? `生成结果声明 needs_human，跳过动态执行: ${validation.issues.join('; ') || '需要人工补充证据'}`
        : `静态校验未通过，跳过动态执行: ${validation.issues.join('; ')}`;
      logger.warn('TCL生成: 静态校验未通过或需要人工介入，终止执行', { taskId, issues: validation.issues, needsHuman: hasNeedsHuman });
      await pool.execute(
        `UPDATE tcl_generation_tasks
         SET status = 'failed', execution_status = 'skipped', error_message = ?, completed_at = NOW()
         WHERE task_id = ?`,
        [reason, taskId]
      );
      return { success: false, taskId, needsHuman: hasNeedsHuman, error: reason, validation };
    }

    let executionResult = null;
    let executionStatus = 'skipped';
    try {
      await pool.execute(
        "UPDATE tcl_generation_tasks SET status = 'executing' WHERE task_id = ?",
        [taskId]
      );
      executionResult = await this._dynamicExecution(tclContent, taskId, options);
      executionStatus = executionResult.status === 'skipped' ? 'skipped' : executionResult.status;

      if (executionResult.status === 'error' || executionResult.status === 'unreachable') {
        executionStatus = 'agent_unreachable';
      } else if (executionResult.exit_code === 0) {
        executionStatus = 'passed';
      }

      await pool.execute(
        'UPDATE tcl_generation_tasks SET execution_result = ?, execution_status = ? WHERE task_id = ?',
        [JSON.stringify(executionResult), executionStatus, taskId]
      );
    } catch (error) {
      logger.warn('TCL生成: 动态执行失败', { taskId, error: error.message });
      executionStatus = 'agent_unreachable';
      await pool.execute(
        'UPDATE tcl_generation_tasks SET execution_result = ?, execution_status = ? WHERE task_id = ?',
        [JSON.stringify({ status: 'error', error: error.message }), executionStatus, taskId]
      );
    }

    let repairResult = { repaired: false, finalContent: tclContent, repairCount: 0, repairHistory: [] };
    if (executionResult && executionResult.exit_code !== 0 && executionResult.status !== 'skipped' && executionResult.status !== 'error') {
      try {
        await pool.execute(
          "UPDATE tcl_generation_tasks SET status = 'repairing' WHERE task_id = ?",
          [taskId]
        );
        repairResult = await this._selfRepairLoop(tclContent, executionResult, taskId, ragContext, options);
        tclContent = repairResult.finalContent;

        if (repairResult.repaired) {
          executionStatus = 'passed_after_repair';
        } else {
          executionStatus = 'failed';
        }

        await pool.execute(
          `UPDATE tcl_generation_tasks SET tcl_content = ?, repair_count = ?, repair_history = ?, execution_status = ? WHERE task_id = ?`,
          [tclContent, repairResult.repairCount, JSON.stringify(repairResult.repairHistory), executionStatus, taskId]
        );
      } catch (error) {
        logger.error('TCL生成: 自修复失败', { taskId, error: error.message });
        executionStatus = 'failed';
      }
    }

    if (repairResult.repaired) {
      try {
        await this._writeRepairExperience(taskId, tclContent, repairResult.repairHistory, moduleId, libraryId, options);
      } catch (error) {
        logger.warn('TCL生成: 避坑经验回写失败', { taskId, error: error.message });
      }
    }

    try {
      await this._saveAndAssociate(taskId, moduleId, level1PointId, tclContent, userId);
    } catch (error) {
      logger.error('TCL生成: 保存关联失败', { taskId, error: error.message });
      await this._failTask(taskId, `保存关联失败: ${error.message}`);
      return { success: false, error: error.message };
    }

    try {
      await pool.execute(
        `UPDATE tcl_generation_tasks SET status = 'completed', completed_at = NOW() WHERE task_id = ?`,
        [taskId]
      );
    } catch (error) {
      logger.error('TCL生成: 更新完成状态失败', { taskId, error: error.message });
    }

    return {
      success: true,
      taskId,
      executionStatus,
      repairCount: repairResult.repairCount,
      repaired: repairResult.repaired
    };
  }

  async _assembleKnowledge(level1PointName, moduleId, options = {}) {
    const categories = ['cli', 'tcl_convention', 'register_map', 'register_field', 'sdk_api', 'bug_rag', 'execution_experience', 'environment'];
    const chipContext = await chipContextService.resolveContext({ chipVersionId: options.chipVersionId, level1PointId: options.level1PointId });
    const effectiveChipVersionId = options.chipVersionId || chipContext.chipVersionId || null;
    const filters = { categories, moduleId, chipVersionId: effectiveChipVersionId, libraryId: options.libraryId || null };
    const results = await embeddingAdapter.hybridSearch(level1PointName, 16, filters);
    const grouped = categories.reduce((acc, category) => {
      acc[category] = results.filter(item => item.fileCategory === category || item.metadata?.category === category);
      return acc;
    }, {});
    return { ...grouped, results, chipContext: { ...chipContext, chipVersionId: effectiveChipVersionId } };
  }

  async _generateTCL(pointName, testType, dimension, ragContext, globalContext, options = {}) {
    const aiConfig = await getSystemDefaultAIConfig();
    if (!aiConfig || !aiConfig.api_key) {
      throw new Error('无可用AI配置');
    }

    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const knowledgeContext = ['cli', 'tcl_convention', 'register_map', 'register_field', 'sdk_api', 'bug_rag', 'execution_experience', 'environment']
      .map(category => {
        const items = ragContext[category] || [];
        if (!items.length) return '';
        return `## ${category}\n` + items.map((r, idx) => `Evidence ${idx + 1} [${r.fileCategory || category}#${r.id}]:\n${r.chunkContent || ''}`).join('\n---\n');
      })
      .filter(Boolean)
      .join('\n\n');

    const chipPromptContext = await chipContextService.buildPromptContext(ragContext.chipContext || { chipVersionId: options.chipVersionId });

    const systemPrompt = `你是一名资深的网络设备自动化测试TCL脚本编写专家。

## 输出要求
你必须生成结构化的TCL脚本，严格遵循以下三段式模板：

### 1. Setup段
proc setup {} {
    # 环境初始化：登录设备、创建测试前置条件
    # 必须使用catch包裹，异常时输出错误信息并返回失败
}

### 2. Test Steps段
proc test_steps {} {
    # 核心测试步骤：执行CLI命令、检查输出、验证结果
    # 每个关键操作必须使用catch包裹
    # 使用assert或自定义校验逻辑判断测试通过/失败
}

### 3. Teardown段
proc teardown {} {
    # 清理环境：删除测试数据、恢复设备配置
    # 必须使用catch包裹，确保清理操作不影响测试结果判定
}

### 4. 主流程
主流程按顺序调用 setup -> test_steps -> teardown，并收集各段执行结果。

## 证据约束
- CLI命令必须基于提供的 Evidence，不要编造不存在的命令
- 不能硬编码旧代芯片寄存器地址；寄存器地址和字段必须来自 register_map/register_field Evidence
- SDK API 调用必须来自 sdk_api Evidence
- 证据不足时，在脚本顶部注释写明 needs_human: true 和缺失证据，不要臆造关键步骤
- 每个关键寄存器/CLI/SDK操作必须添加注释: # Evidence: <类型#ID>

## 关键规范
- 所有关键操作必须使用catch异常捕获
- CLI命令必须基于提供的参考命令，不要编造不存在的命令
- 变量命名清晰，添加必要日志输出
- 脚本必须可直接执行，不依赖外部未定义变量`;

    let userPrompt = `请为以下测试点生成TCL自动化测试脚本：

## 测试点名称
${pointName}

## 测试类型
${testType}

## 测试维度
${dimension}

${chipPromptContext}`;

    if (knowledgeContext) {
      userPrompt += `\n\n## 可用证据\n${knowledgeContext}`;
    }
    if (globalContext) {
      userPrompt += `\n\n## 全局上下文\n${globalContext}`;
    }

    userPrompt += '\n\n请直接输出完整的TCL脚本代码，不要输出任何解释说明。';

    const requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 8000
    };

    const headers = buildAIHeaders(aiConfig.provider, aiConfig.api_key);

    const response = await axios.post(apiUrl, requestBody, {
      headers,
      timeout: 180000
    });

    const content = response.data?.choices?.[0]?.message?.content || '';
    if (!content.trim()) {
      throw new Error('LLM返回内容为空');
    }

    return this._extractTCLFromResponse(content);
  }

  _extractTCLFromResponse(content) {
    const codeBlockMatch = content.match(/```(?:tcl)?\s*\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    return content.trim();
  }

  async _staticValidation(tclContent) {
    const issues = [];

    const requiredPatterns = [
      { pattern: /proc\s+setup\s*\{/, label: 'proc setup' },
      { pattern: /proc\s+test_steps\s*\{/, label: 'proc test_steps' },
      { pattern: /proc\s+teardown\s*\{/, label: 'proc teardown' },
      { pattern: /\bcatch\b/, label: 'catch' }
    ];

    for (const { pattern, label } of requiredPatterns) {
      if (!pattern.test(tclContent)) {
        issues.push(`缺少必要元素: ${label}`);
      }
    }

    const openBraces = (tclContent.match(/\{/g) || []).length;
    const closeBraces = (tclContent.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      issues.push(`花括号不匹配: { 共${openBraces}个, } 共${closeBraces}个`);
    }

    const openBrackets = (tclContent.match(/\[/g) || []).length;
    const closeBrackets = (tclContent.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      issues.push(`方括号不匹配: [ 共${openBrackets}个, ] 共${closeBrackets}个`);
    }

    const hasNeedsHuman = /needs_human\s*[:=]\s*true/i.test(tclContent);
    const evidenceCount = (tclContent.match(/Evidence\s*:/gi) || []).length;
    if (!hasNeedsHuman && evidenceCount === 0) {
      issues.push('缺少证据注释: Evidence，或在证据不足时声明 needs_human: true');
    }

    return {
      passed: issues.length === 0,
      issues
    };
  }

  async _dynamicExecution(tclContent, taskId, options = {}) {
    return await scriptRunnerClient.execute(tclContent, {
      taskId,
      executionEnvId: options.executionEnvId || null,
      executionEnvKey: options.executionEnvKey || null,
      timeout: options.timeout || null,
      envVars: options.envVars || {},
      options
    });
  }

  async _selfRepairLoop(tclContent, executionResult, taskId, ragContext, options = {}) {
    const maxRetries = parseInt(process.env.TCL_SELF_REPAIR_MAX_RETRIES) || 2;
    const repairHistory = [];
    let currentContent = tclContent;
    let repairCount = 0;

    for (let i = 0; i < maxRetries; i++) {
      repairCount++;
      logger.info('TCL生成: 自修复尝试', { taskId, attempt: repairCount });

      let repairedContent;
      try {
        repairedContent = await this._generateRepairScript(
          currentContent,
          executionResult,
          ragContext,
          taskId,
          options
        );
      } catch (error) {
        logger.warn('TCL生成: 修复脚本生成失败', { taskId, attempt: repairCount, error: error.message });
        repairHistory.push({
          attempt: repairCount,
          error: error.message,
          status: 'repair_generation_failed'
        });
        break;
      }

      let newExecutionResult;
      try {
        newExecutionResult = await this._dynamicExecution(repairedContent, taskId, options);
      } catch (error) {
        logger.warn('TCL生成: 修复后执行失败', { taskId, attempt: repairCount, error: error.message });
        repairHistory.push({
          attempt: repairCount,
          error: error.message,
          status: 'execution_failed'
        });
        break;
      }

      repairHistory.push({
        attempt: repairCount,
        previousError: executionResult.stderr || executionResult.error || '',
        newStatus: newExecutionResult.status,
        newExitCode: newExecutionResult.exit_code,
        newStderr: newExecutionResult.stderr || ''
      });

      currentContent = repairedContent;

      if (newExecutionResult.exit_code === 0) {
        return {
          repaired: true,
          finalContent: currentContent,
          repairCount,
          repairHistory
        };
      }

      executionResult = newExecutionResult;
    }

    return {
      repaired: false,
      finalContent: currentContent,
      repairCount,
      repairHistory
    };
  }

  async _generateRepairScript(tclContent, executionResult, ragContext, taskId, options = {}) {
    const aiConfig = await getSystemDefaultAIConfig();
    if (!aiConfig || !aiConfig.api_key) {
      throw new Error('无可用AI配置');
    }

    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const cliContext = (ragContext.cli || ragContext.cliResults || [])
      .map(r => r.chunkContent || '')
      .filter(Boolean)
      .join('\n---\n');

    const tclConventionContext = (ragContext.tcl_convention || ragContext.tclConventionResults || [])
      .map(r => r.chunkContent || '')
      .filter(Boolean)
      .join('\n---\n');

    const systemPrompt = `你是一名资深的网络设备TCL脚本调试专家。你需要根据执行报错信息修复TCL脚本。

## 修复原则
1. 分析报错日志，定位根本原因
2. 参考CLI命令参考和TCL编写规范进行修复
3. 保持三段式结构(Setup/Test Steps/Teardown)不变
4. 所有关键操作必须使用catch异常捕获
5. 只修复有问题的部分，不要重写整个脚本`;

    let userPrompt = `## 原始TCL脚本
\`\`\`tcl
${tclContent}
\`\`\`

## 执行报错日志
- Exit Code: ${executionResult.exit_code}
- Stderr: ${executionResult.stderr || '无'}
- Stdout: ${executionResult.stdout || '无'}`;

    if (cliContext) {
      userPrompt += `\n\n## CLI命令参考\n${cliContext}`;
    }
    if (tclConventionContext) {
      userPrompt += `\n\n## TCL编写规范\n${tclConventionContext}`;
    }

    userPrompt += '\n\n请输出修复后的完整TCL脚本代码，不要输出任何解释说明。';

    const requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 8000
    };

    const headers = buildAIHeaders(aiConfig.provider, aiConfig.api_key);

    const response = await axios.post(apiUrl, requestBody, {
      headers,
      timeout: 180000
    });

    const content = response.data?.choices?.[0]?.message?.content || '';
    if (!content.trim()) {
      throw new Error('LLM修复返回内容为空');
    }

    return this._extractTCLFromResponse(content);
  }

  async _writeRepairExperience(taskId, tclContent, repairHistory, moduleId, libraryId, options = {}) {
    const aiConfig = await getSystemDefaultAIConfig();
    if (!aiConfig || !aiConfig.api_key) {
      return;
    }

    const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const systemPrompt = '你是一名TCL脚本避坑经验提取专家。请从修复历史中提取简明的避坑经验，每条经验包含：错误现象、根本原因、正确做法。输出不超过500字。';

    const userPrompt = `## 修复历史
${JSON.stringify(repairHistory, null, 2)}

## 最终修复后的脚本
${tclContent.slice(0, 3000)}

请提取避坑经验。`;

    try {
      const requestBody = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 1000
      };

      const headers = buildAIHeaders(aiConfig.provider, aiConfig.api_key);

      const response = await axios.post(apiUrl, requestBody, {
        headers,
        timeout: 60000
      });

      const experience = response.data?.choices?.[0]?.message?.content || '';
      if (!experience.trim()) {
        return;
      }

      await pool.execute(
        'UPDATE tcl_generation_tasks SET repair_experience = ? WHERE task_id = ?',
        [experience, taskId]
      );

      await bugRagService.createCandidate({
        chipVersionId: options.chipVersionId || null,
        moduleId,
        libraryId,
        title: `TCL自修复经验 ${taskId}`,
        symptom: JSON.stringify(repairHistory).slice(0, 2000),
        rootCause: experience,
        fixSuggestion: experience,
        sourceType: 'tcl_self_repair',
        sourceRef: taskId,
        metadata: { taskId, repairHistory }
      }).catch(error => logger.warn('TCL生成: Bug-RAG候选写入失败', { taskId, error: error.message }));

      const chunks = this._splitExperienceChunks(experience);
      if (chunks.length > 0) {
        const virtualFileId = 800000000 + parseInt(taskId.replace(/\D/g, '').slice(-9) || '0');
        await embeddingAdapter.upsertKnowledgeChunks(
          virtualFileId,
          moduleId,
          libraryId,
          chunks,
          'execution_experience',
          { chipVersionId: options.chipVersionId || null }
        );
      }
    } catch (error) {
      logger.warn('TCL生成: 避坑经验提取失败', { taskId, error: error.message });
    }
  }

  _splitExperienceChunks(text) {
    if (!text || !text.trim()) return [];

    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
    const chunks = [];

    let currentChunk = '';
    for (const para of paragraphs) {
      if (currentChunk.length + para.length + 2 > 1500 && currentChunk.length > 0) {
        chunks.push({
          chunkContent: currentChunk.trim(),
          charCount: currentChunk.trim().length,
          chunkingStrategy: 'knowledge',
          metadata: { category: 'execution_experience', source: 'tcl_self_repair' }
        });
        currentChunk = para;
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
      }
    }

    if (currentChunk.trim()) {
      chunks.push({
        chunkContent: currentChunk.trim(),
        charCount: currentChunk.trim().length,
        chunkingStrategy: 'knowledge',
        metadata: { category: 'execution_experience', source: 'tcl_self_repair' }
      });
    }

    return chunks;
  }

  async _saveAndAssociate(taskId, moduleId, level1PointId, tclContent, userId) {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const dirPath = path.join(SCRIPTS_DIR, year, month);

    await fs.mkdir(dirPath, { recursive: true });

    const fileName = `${uuidv4()}.tcl`;
    const filePath = path.join(dirPath, fileName);
    await fs.writeFile(filePath, tclContent, 'utf-8');

    const relativePath = path.join(year, month, fileName);

    await pool.execute(
      'UPDATE tcl_generation_tasks SET script_file_path = ? WHERE task_id = ?',
      [relativePath, taskId]
    );

    let testCaseId = null;
    if (level1PointId) {
      try {
        const [tempCases] = await pool.execute(
          'SELECT id FROM temp_test_cases WHERE level1_id = ? LIMIT 1',
          [level1PointId]
        );
        if (tempCases.length > 0) {
          testCaseId = tempCases[0].id;
        }
      } catch (_) {}

      if (!testCaseId) {
        try {
          const [cases] = await pool.execute(
            'SELECT id FROM test_cases WHERE level1_id = ? LIMIT 1',
            [level1PointId]
          );
          if (cases.length > 0) {
            testCaseId = cases[0].id;
          }
        } catch (_) {}
      }
    }

    if (testCaseId) {
      const scriptName = `tcl_gen_${level1PointId}_${Date.now()}.tcl`;
      const stats = await fs.stat(filePath);

      await pool.execute(
        `INSERT INTO test_case_scripts (test_case_id, script_name, script_type, file_path, file_size, original_filename, link_type, generation_task_id, level1_point_id, creator)
         VALUES (?, ?, 'tcl', ?, ?, ?, 'generated', ?, ?, ?)`,
        [testCaseId, scriptName, relativePath, stats.size, scriptName, taskId, level1PointId, String(userId)]
      );
    } else {
      logger.warn('TCL生成: 未找到关联测试用例', { taskId, level1PointId });
    }
  }

  async _failTask(taskId, errorMessage) {
    try {
      await pool.execute(
        `UPDATE tcl_generation_tasks SET status = 'failed', error_message = ?, completed_at = NOW() WHERE task_id = ?`,
        [errorMessage, taskId]
      );
    } catch (error) {
      logger.error('TCL生成: 更新失败状态异常', { taskId, error: error.message });
    }
  }
}

module.exports = new TCLGenerationService();
