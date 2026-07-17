const { v4: uuidv4 } = require('uuid');
const chipContextService = require('./chipContextService');
const embeddingAdapter = require('./embeddingAdapter');
const evidenceService = require('./evidenceService');

class AdaptiveWorkflowService {
  constructor() {
    this.tasks = new Map();
  }

  async createAdaptiveTask(data, userId = null) {
    const taskId = `ADAPT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 8).toUpperCase()}`;
    const chipContext = await chipContextService.resolveContext({
      chipVersionId: data.chipVersionId || data.chip_version_id,
      level1PointId: data.level1PointId || data.level1_point_id,
      testCaseId: data.testCaseId || data.test_case_id,
      fileId: data.fileId || data.file_id,
      taskId: data.taskId || data.task_id
    });

    const queryText = data.queryText || data.query || data.level1PointName || data.targetName || '';
    const categories = data.categories || ['register_map', 'register_field', 'sdk_api', 'bug_rag', 'execution_experience'];
    const evidenceCandidates = queryText
      ? await embeddingAdapter.hybridSearch(queryText, data.topK || 8, {
          categories,
          moduleId: data.moduleId || data.module_id,
          libraryId: data.libraryId || data.library_id,
          chipVersionId: chipContext.chipVersionId
        })
      : [];

    const targetType = data.targetType || data.target_type || 'adaptive_task';
    const targetId = data.targetId || data.target_id || taskId;
    const links = evidenceCandidates.slice(0, 10).map(item => ({
      targetType,
      targetId,
      evidenceType: item.fileCategory || item.metadata?.category || 'knowledge_chunk',
      evidenceTable: 'ai_material_chunks',
      evidenceId: item.id,
      evidenceTitle: item.metadata?.registerName || item.metadata?.name || item.fileCategory || `chunk_${item.id}`,
      evidenceExcerpt: (item.chunkContent || '').slice(0, 500),
      confidence: item.score || item.similarity || 0,
      createdBy: userId,
      metadata: { source: 'adaptive_workflow', taskId }
    }));
    if (links.length > 0) {
      await evidenceService.createLinks(links);
    }

    const task = {
      taskId,
      status: 'created',
      targetType,
      targetId: String(targetId),
      chipContext,
      evidenceCount: links.length,
      evidence: links,
      createdBy: userId || null,
      createdAt: new Date().toISOString(),
      payload: data
    };
    this.tasks.set(taskId, task);
    return task;
  }

  async getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }
}

module.exports = new AdaptiveWorkflowService();
