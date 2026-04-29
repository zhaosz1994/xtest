const pool = require('../db');
const { v4: uuidv4 } = require('uuid');

class Level1PointService {
  async getExistingLevel1Points(moduleId) {
    const [rows] = await pool.execute(`
      SELECT id, name, test_type, 
             (SELECT COUNT(*) FROM test_cases WHERE level1_id = level1_points.id) as case_count
      FROM level1_points
      WHERE module_id = ?
      ORDER BY order_index, created_at
    `, [moduleId]);

    return rows;
  }

  async generateLevel1Points(taskId, moduleId) {
    const module = await this.getModuleInfo(moduleId);
    const existingPoints = await this.getExistingLevel1Points(moduleId);

    const materialContent = await this.getMaterialSummary(moduleId, taskId);

    if (!materialContent || materialContent.trim().length === 0) {
      return [];
    }

    const prompt = this.buildLevel1Prompt(module, existingPoints, materialContent);

    const aiConfig = await this.getAIConfig(taskId);
    const userId = await this.getUserId(taskId);

    try {
      const response = await this.callAI(aiConfig, this.getSystemPrompt(), prompt, userId);

      const content = response.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);

      if (!jsonMatch) {
        return [];
      }

      const result = JSON.parse(jsonMatch[1]);

      const tempLevel1Points = [];
      for (const point of (result.level1_points || [])) {
        const tempLevel1Id = `TEMP-L1-${uuidv4().slice(0, 8).toUpperCase()}`;

        await pool.execute(`
          INSERT INTO temp_level1_points 
            (temp_level1_id, task_id, module_id, name, test_type, description)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [tempLevel1Id, taskId, moduleId, point.name, point.test_type || '功能测试', point.description || '']);

        tempLevel1Points.push({
          tempLevel1Id,
          name: point.name,
          testType: point.test_type || '功能测试'
        });
      }

      return tempLevel1Points;

    } catch (error) {
      console.error('生成一级测试点失败:', error.message);
      return [];
    }
  }

  getSystemPrompt() {
    return `你是一个专业的测试用例设计专家。
你的任务是根据需求材料，识别主要的测试领域，并生成一级测试点。

## 一级测试点定义
一级测试点是对测试范围的分类，每个测试点下会包含若干具体的测试用例。

## 命名规范
1. 简洁明了，体现测试领域
2. 格式建议: "功能名称 + 测试类型"
3. 示例: "Buffer管理测试"、"调度算法测试"、"异常处理测试"

## 输出要求
根据材料内容，识别3-10个主要测试领域，生成一级测试点。`;
  }

  buildLevel1Prompt(module, existingPoints, materialContent) {
    const existingPointsStr = existingPoints.length > 0
      ? existingPoints.map(p => `- ${p.name} (${p.test_type}, 已有${p.case_count}个用例)`).join('\n')
      : '暂无';

    return `## 模块信息
模块名称: ${module.name}
模块描述: ${module.description || module.name || '无'}

## 现有一级测试点
${existingPointsStr}

## 需求材料内容
${materialContent.slice(0, 6000)}

## 输出格式
严格按照以下JSON格式输出:
\`\`\`json
{
  "level1_points": [
    {
      "name": "一级测试点名称",
      "test_type": "功能测试/性能测试/异常测试/...",
      "description": "测试点描述",
      "estimated_cases": 5
    }
  ]
}
\`\`\`

注意: 避免与现有一级测试点重复`;
  }

  async getMaterialSummary(moduleId, taskId) {
    const [tasks] = await pool.execute(`
      SELECT selected_files FROM ai_case_generation_tasks WHERE task_id = ?
    `, [taskId]);

    if (tasks.length === 0) return '';

    const selectedFiles = typeof tasks[0].selected_files === 'string' 
      ? JSON.parse(tasks[0].selected_files || '[]') 
      : (tasks[0].selected_files || []);

    let sql = `
      SELECT chunk_content FROM ai_material_chunks c
      JOIN module_knowledge_files f ON c.file_id = f.id
      WHERE c.module_id = ? AND f.deleted_at IS NULL
    `;
    const params = [moduleId];

    if (selectedFiles.length > 0) {
      const placeholders = selectedFiles.map(() => '?').join(',');
      sql += ` AND c.file_id IN (${placeholders})`;
      params.push(...selectedFiles);
    }

    sql += ` ORDER BY c.chunk_index ASC LIMIT 10`;

    const [chunks] = await pool.execute(sql, params);
    return chunks.map(c => c.chunk_content).join('\n\n');
  }

  async assignLevel1ToCases(taskId) {
    const [tempPoints] = await pool.execute(`
      SELECT * FROM temp_level1_points WHERE task_id = ?
    `, [taskId]);

    const [tempCases] = await pool.execute(`
      SELECT id, temp_case_id, name, type FROM temp_test_cases 
      WHERE task_id = ? AND status = 'pending'
    `, [taskId]);

    if (tempCases.length === 0) return;

    const assignedCases = new Map();

    for (const caseItem of tempCases) {
      const matchedPoint = tempPoints.length > 0 ? this.matchCaseToLevel1(caseItem, tempPoints) : null;

      if (matchedPoint) {
        await pool.execute(`
          UPDATE temp_test_cases 
          SET level1_name = ?, is_new_level1 = 1
          WHERE temp_case_id = ?
        `, [matchedPoint.name, caseItem.temp_case_id]);
        
        if (!assignedCases.has(matchedPoint.name)) {
          assignedCases.set(matchedPoint.name, []);
        }
        assignedCases.get(matchedPoint.name).push(caseItem);
      } else {
        const extractedName = this.extractLevel1NameFromCase(caseItem);
        
        let existingPoint = tempPoints.find(p => p.name === extractedName);
        
        if (!existingPoint) {
          const tempLevel1Id = `TEMP-L1-${require('uuid').v4().slice(0, 8).toUpperCase()}`;
          const [taskInfo] = await pool.execute(`
            SELECT module_id FROM ai_case_generation_tasks WHERE task_id = ?
          `, [taskId]);
          const moduleId = taskInfo.length > 0 ? taskInfo[0].module_id : null;
          
          await pool.execute(`
            INSERT INTO temp_level1_points 
              (temp_level1_id, task_id, module_id, name, test_type, description)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [tempLevel1Id, taskId, moduleId, extractedName, caseItem.type || '功能测试', `从用例"${caseItem.name}"提炼`]);
          
          tempPoints.push({
            temp_level1_id: tempLevel1Id,
            name: extractedName,
            test_type: caseItem.type || '功能测试'
          });
        }
        
        await pool.execute(`
          UPDATE temp_test_cases 
          SET level1_name = ?, is_new_level1 = 1
          WHERE temp_case_id = ?
        `, [extractedName, caseItem.temp_case_id]);
        
        if (!assignedCases.has(extractedName)) {
          assignedCases.set(extractedName, []);
        }
        assignedCases.get(extractedName).push(caseItem);
      }
    }

    console.log(`[assignLevel1ToCases] 为 ${tempCases.length} 个用例分配了一级测试点，共 ${assignedCases.size} 个一级测试点`);
  }

  async assignExistingLevel1ToCases(taskId, level1Id) {
    const [level1] = await pool.execute(`
      SELECT id, name FROM level1_points WHERE id = ?
    `, [level1Id]);

    if (level1.length === 0) return;

    await pool.execute(`
      UPDATE temp_test_cases 
      SET level1_id = ?, level1_name = ?, is_new_level1 = 0
      WHERE task_id = ? AND status = 'pending'
    `, [level1[0].id, level1[0].name, taskId]);
  }

  matchCaseToLevel1(caseItem, level1Points) {
    if (level1Points.length === 0) return null;

    const caseName = (caseItem.name || '').toLowerCase();
    const caseType = (caseItem.type || '').toLowerCase();

    let bestMatch = null;
    let bestScore = 0;

    for (const point of level1Points) {
      const pointName = (point.name || '').toLowerCase().replace('测试', '');
      const pointType = (point.test_type || '').toLowerCase();
      let score = 0;

      if (caseName.includes(pointName)) score += 2;
      if (caseType.includes(pointType)) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = point;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  extractLevel1NameFromCase(caseItem) {
    const caseName = caseItem.name || '';
    const caseType = caseItem.type || '功能测试';
    
    const patterns = [
      /^(.+?)测试/,
      /^(.+?)验证/,
      /^(.+?)检查/,
      /^(.+?)功能/,
      /^测试(.+?)$/,
      /^验证(.+?)$/,
      /^检查(.+?)$/
    ];
    
    for (const pattern of patterns) {
      const match = caseName.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.length >= 2 && extracted.length <= 20) {
          return `${extracted}测试`;
        }
      }
    }
    
    const words = caseName.split(/[\s\-_,，、]+/);
    if (words.length > 0 && words[0].length >= 2 && words[0].length <= 15) {
      return `${words[0]}测试`;
    }
    
    if (caseName.length <= 15) {
      return `${caseName}测试`;
    }
    
    return `${caseName.substring(0, 15)}测试`;
  }

  async mergeLevel1Points(taskId) {
    const [tempPoints] = await pool.execute(`
      SELECT * FROM temp_level1_points 
      WHERE task_id = ? AND status = 'approved'
    `, [taskId]);

    for (const tempPoint of tempPoints) {
      const [result] = await pool.execute(`
        INSERT INTO level1_points (module_id, name, test_type, order_index)
        VALUES (?, ?, ?, ?)
      `, [tempPoint.module_id, tempPoint.name, tempPoint.test_type, tempPoint.order_index]);

      await pool.execute(`
        UPDATE temp_level1_points 
        SET status = 'merged', merged_level1_id = ?
        WHERE id = ?
      `, [result.insertId, tempPoint.id]);

      await pool.execute(`
        UPDATE temp_test_cases 
        SET level1_id = ?
        WHERE level1_name = ? AND task_id = ? AND is_new_level1 = 1
      `, [result.insertId, tempPoint.name, taskId]);
    }
  }

  async getModuleInfo(moduleId) {
    const [modules] = await pool.execute(`
      SELECT * FROM modules WHERE id = ?
    `, [moduleId]);
    return modules[0] || {};
  }

  async getAIConfig(taskId) {
    const [tasks] = await pool.execute(`
      SELECT user_id FROM ai_case_generation_tasks WHERE task_id = ?
    `, [taskId]);

    if (tasks.length === 0) {
      const aiService = require('./aiService');
      return aiService.getSystemDefaultAIConfig();
    }

    const aiService = require('./aiService');
    return aiService.getUserAIConfig(tasks[0].user_id);
  }

  async getUserId(taskId) {
    const [tasks] = await pool.execute(`
      SELECT user_id FROM ai_case_generation_tasks WHERE task_id = ?
    `, [taskId]);
    return tasks.length > 0 ? tasks[0].user_id : null;
  }

  async callAI(aiConfig, systemPrompt, userPrompt, userId) {
    const axios = require('axios');
    const { getUserAITimeoutConfig } = require('./aiService');
    const timeoutConfig = await getUserAITimeoutConfig(userId);
    const apiKey = aiConfig.api_key;
    const apiUrl = aiConfig.api_url || 'https://api.deepseek.com/v1/chat/completions';
    const model = aiConfig.model_name || 'deepseek-chat';

    const response = await axios.post(apiUrl, {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: timeoutConfig.generalAITask
    });

    return response.data;
  }

  async getTempLevel1Points(taskId) {
    const [points] = await pool.execute(`
      SELECT tlp.*, 
        (SELECT COUNT(*) FROM temp_test_cases WHERE task_id = tlp.task_id AND level1_name = tlp.name) as case_count
      FROM temp_level1_points tlp
      WHERE tlp.task_id = ?
      ORDER BY tlp.order_index, tlp.created_at
    `, [taskId]);

    return points;
  }

  async approveTempLevel1Point(tempLevel1Id, taskId) {
    await pool.execute(`
      UPDATE temp_level1_points 
      SET status = 'approved'
      WHERE temp_level1_id = ? AND task_id = ?
    `, [tempLevel1Id, taskId]);
  }

  async rejectTempLevel1Point(tempLevel1Id, taskId) {
    await pool.execute(`
      UPDATE temp_level1_points 
      SET status = 'rejected'
      WHERE temp_level1_id = ? AND task_id = ?
    `, [tempLevel1Id, taskId]);
  }
}

module.exports = new Level1PointService();
