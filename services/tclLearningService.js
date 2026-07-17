const pool = require('../db');
const logger = require('./logger');
const embeddingAdapter = require('./embeddingAdapter');
const axios = require('axios');
const { buildAIHeaders } = require('./aiCallWrapper');

class TCLLearningService {
  async analyzeFromFile(fileId, moduleId) {
    try {
      const fileParserService = require('./fileParserService');
      const chunks = await fileParserService.getChunksByFile(fileId);
      if (!chunks || chunks.length === 0) {
        logger.warn('TCL学习: 文件无可用chunks', { fileId });
        return { success: false, error: '文件无可用chunks' };
      }

      const content = chunks.map(c => c.chunk_content || c.chunkContent || '').join('\n');
      if (!content.trim()) {
        logger.warn('TCL学习: 文件内容为空', { fileId });
        return { success: false, error: '文件内容为空' };
      }

      const cliPatterns = this._extractCliPatterns(content);

      const llmResult = await this._analyzeWithLLM(content, cliPatterns, moduleId);
      if (!llmResult) {
        logger.warn('TCL学习: LLM分析失败', { fileId });
        return { success: false, error: 'LLM分析失败' };
      }

      const [files] = await pool.execute(
        'SELECT library_id FROM module_knowledge_files WHERE id = ?',
        [fileId]
      );
      const libraryId = files.length > 0 ? files[0].library_id : null;

      await this._writeLearningResults(fileId, moduleId, libraryId, llmResult.cliReference, llmResult.tclConventions);

      logger.info('TCL学习完成', { fileId, moduleId });
      return { success: true };
    } catch (error) {
      logger.warn('TCL学习失败', { fileId, moduleId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  _extractCliPatterns(content) {
    const commands = [];
    const params = [];

    const cliCommandRegex = /\b(config(?:ure)?|show|ping|set|delete|add|remove|clear|reset|enable|disable|shutdown|no|debug|exit|quit|apply|commit|rollback|display|return)\s+([\w\-\.\/]+(?:\s+[\w\-\.\/]+){0,5})/gi;
    let match;
    const commandSet = new Set();
    while ((match = cliCommandRegex.exec(content)) !== null) {
      const fullCmd = `${match[1]} ${match[2]}`.trim();
      if (!commandSet.has(fullCmd.toLowerCase())) {
        commandSet.add(fullCmd.toLowerCase());
        commands.push(fullCmd);
      }
    }

    const ipRegex = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:\/\d{1,2})?\b/g;
    const ipSet = new Set();
    while ((match = ipRegex.exec(content)) !== null) {
      if (!ipSet.has(match[1])) {
        ipSet.add(match[1]);
        params.push({ type: 'ip', value: match[1] });
      }
    }

    const vlanRegex = /\b(vlan|VLAN)\s*(\d{1,4})\b/gi;
    const vlanSet = new Set();
    while ((match = vlanRegex.exec(content)) !== null) {
      const vlanId = match[2];
      if (!vlanSet.has(vlanId)) {
        vlanSet.add(vlanId);
        params.push({ type: 'vlan_id', value: vlanId });
      }
    }

    const interfaceRegex = /\b(GigabitEthernet|FastEthernet|Ethernet|TenGigE|Loopback|Vlanif|GE|FE|Eth|XGE)\s*([\d\/\.]+)\b/gi;
    const ifSet = new Set();
    while ((match = interfaceRegex.exec(content)) !== null) {
      const ifName = `${match[1]}${match[2]}`;
      if (!ifSet.has(ifName.toLowerCase())) {
        ifSet.add(ifName.toLowerCase());
        params.push({ type: 'interface', value: ifName });
      }
    }

    return { commands, params };
  }

  async _analyzeWithLLM(content, cliPatterns, moduleId) {
    try {
      const aiService = require('./aiService');
      const aiConfig = await aiService.getSystemDefaultAIConfig();
      if (!aiConfig || !aiConfig.api_key) {
        logger.warn('TCL学习: 无可用AI配置');
        return null;
      }

      const apiUrl = aiConfig.endpoint || aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
      const model = aiConfig.model_name || 'deepseek-chat';

      const truncatedContent = content.slice(0, 12000);
      const cliCommandsStr = cliPatterns.commands.slice(0, 50).join('\n');
      const cliParamsStr = cliPatterns.params.slice(0, 30).map(p => `${p.type}: ${p.value}`).join('\n');

      const systemPrompt = `你是一名资深的网络设备TCL脚本分析专家。请分析提供的TCL脚本内容，提取CLI命令参考和TCL编写规范。

请严格按照以下格式输出，使用"===SEPARATOR==="分隔两部分：

第一部分 - CLI命令参考（cli-reference）：
每行一条，格式：命令名|语法|参数说明|使用场景|示例

第二部分 - TCL编写规范（tcl-convention）：
每行一条，格式：规范项|说明|正确示例|错误示例`;

      const userPrompt = `以下是TCL脚本内容：
${truncatedContent}

正则提取的CLI命令模式：
${cliCommandsStr || '无'}

正则提取的参数模式：
${cliParamsStr || '无'}

请分析以上TCL脚本，输出CLI命令参考和TCL编写规范。`;

      const requestBody = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 4000
      };

      const headers = buildAIHeaders(aiConfig.provider, aiConfig.api_key);

      const response = await axios.post(apiUrl, requestBody, {
        headers,
        timeout: 180000
      });

      const resultText = response.data?.choices?.[0]?.message?.content || '';
      if (!resultText.trim()) {
        logger.warn('TCL学习: LLM返回内容为空');
        return null;
      }

      const parts = resultText.split('===SEPARATOR===');
      let cliReference = '';
      let tclConventions = '';

      if (parts.length >= 2) {
        cliReference = parts[0].trim();
        tclConventions = parts[1].trim();
      } else {
        if (resultText.includes('CLI') || resultText.includes('命令参考') || resultText.includes('cli-reference')) {
          cliReference = resultText.trim();
        } else {
          tclConventions = resultText.trim();
        }
      }

      return { cliReference, tclConventions };
    } catch (error) {
      logger.warn('TCL学习: LLM分析异常', { moduleId, error: error.message });
      return null;
    }
  }

  async _writeLearningResults(fileId, moduleId, libraryId, cliReference, tclConventions) {
    const cliChunks = this._splitByParagraph(cliReference, 'cli');
    const tclChunks = this._splitByParagraph(tclConventions, 'tcl_convention');

    if (cliChunks.length > 0) {
      try {
        const virtualFileId = 900000000 + fileId * 2;
        await embeddingAdapter.upsertKnowledgeChunks(
          virtualFileId,
          moduleId,
          libraryId,
          cliChunks,
          'cli'
        );
      } catch (error) {
        logger.warn('TCL学习: CLI知识块写入失败', { fileId, error: error.message });
      }
    }

    if (tclChunks.length > 0) {
      try {
        const virtualFileId = 900000000 + fileId * 2 + 1;
        await embeddingAdapter.upsertKnowledgeChunks(
          virtualFileId,
          moduleId,
          libraryId,
          tclChunks,
          'tcl_convention'
        );
      } catch (error) {
        logger.warn('TCL学习: TCL规范知识块写入失败', { fileId, error: error.message });
      }
    }

    try {
      const cliChunkIds = [];
      const tclChunkIds = [];

      if (cliReference) {
        await pool.execute(
          `INSERT INTO tcl_learning_results (module_id, library_id, result_type, content, source_file_id, chunk_ids, status)
           VALUES (?, ?, 'cli_reference', ?, ?, ?, 'completed')`,
          [moduleId, libraryId, cliReference, fileId, JSON.stringify(cliChunkIds)]
        );
      }

      if (tclConventions) {
        await pool.execute(
          `INSERT INTO tcl_learning_results (module_id, library_id, result_type, content, source_file_id, chunk_ids, status)
           VALUES (?, ?, 'tcl_convention', ?, ?, ?, 'completed')`,
          [moduleId, libraryId, tclConventions, fileId, JSON.stringify(tclChunkIds)]
        );
      }
    } catch (error) {
      logger.warn('TCL学习: 学习结果记录写入失败', { fileId, error: error.message });
    }
  }

  _splitByParagraph(text, category) {
    if (!text || !text.trim()) return [];

    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
    const chunks = [];

    let currentChunk = '';
    for (const para of paragraphs) {
      if (currentChunk.length + para.length + 2 > 2000 && currentChunk.length > 0) {
        chunks.push({
          chunkContent: currentChunk.trim(),
          charCount: currentChunk.trim().length,
          chunkingStrategy: 'knowledge',
          metadata: { category, source: 'tcl_learning' }
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
        metadata: { category, source: 'tcl_learning' }
      });
    }

    return chunks;
  }
}

module.exports = new TCLLearningService();
