const pool = require('../db');
const { isAdmin } = require('../middleware');
const { safeJson } = require('./agentUtils');
const resourceSchedulerService = require('./resourceSchedulerService');

const HIGH_RISK_TRAFFIC = ['pause_storm', 'line_rate_traffic', 'error_packet_injection'];
const CONFIG_COMMAND_PATTERNS = [/\bset\b/i, /\benable\b/i, /\bdisable\b/i, /\bcreate\b/i, /\bdelete\b/i, /\bclear\b/i, /\bconfig\b/i];

class ExecutionGateService {
  async getTask(taskId) {
    if (!taskId) return null;
    const [rows] = await pool.execute('SELECT * FROM agent_tasks WHERE task_id = ? LIMIT 1', [taskId]);
    if (rows.length === 0) return null;
    return {
      ...rows[0],
      shared_state: safeJson(rows[0].shared_state, {}),
      artifacts: safeJson(rows[0].artifacts, {}),
      metadata: safeJson(rows[0].metadata, {})
    };
  }

  _isExecuteMode(mode, task) {
    const taskMode = String(task?.mode || '').toLowerCase();
    if (['execute', 'autonomous'].includes(taskMode)) return true;
    const effectiveMode = String(mode || 'dry_run').toLowerCase();
    return ['execute', 'autonomous'].includes(effectiveMode);
  }

  _requiresApproval(task, action, payload = {}) {
    if (!task) return false;
    if (Number(task.approval_required) === 1 && task.approval_status !== 'approved') return true;
    const trafficType = payload.trafficType || payload.traffic_type;
    if (trafficType && HIGH_RISK_TRAFFIC.includes(String(trafficType)) && task.approval_status !== 'approved') return true;
    if (action === 'start_traffic' && payload.ratePercent >= 90 && task.approval_status !== 'approved') return true;
    return false;
  }

  _requiresSnapshot(command) {
    return CONFIG_COMMAND_PATTERNS.some(pattern => pattern.test(String(command || '')));
  }

  async checkAction({ user, taskId, leaseId, resourceId, action, mode, payload = {} }) {
    const task = await this.getTask(taskId);
    if (taskId && !task) {
      return { allowed: false, reason: 'TASK_NOT_FOUND' };
    }
    if (task && task.created_by !== user.id && !isAdmin(user)) {
      return { allowed: false, reason: 'TASK_OWNER_REQUIRED' };
    }
    const executeMode = this._isExecuteMode(mode, task);
    if (!executeMode) {
      return { allowed: true, dryRun: true, reason: 'DRY_RUN_OR_GENERATION', task };
    }

    if (!task) {
      return { allowed: false, reason: 'TASK_REQUIRED_FOR_EXECUTE' };
    }
    if (task.created_by !== user.id && !isAdmin(user)) {
      return { allowed: false, reason: 'TASK_OWNER_REQUIRED' };
    }
    if (this._requiresApproval(task, action, payload)) {
      return { allowed: false, reason: 'APPROVAL_REQUIRED' };
    }

    const effectiveLeaseId = leaseId || task.lease_id;
    const leaseCheck = await resourceSchedulerService.validateLeaseForAction({
      leaseId: effectiveLeaseId,
      taskId,
      userId: user.id,
      resourceId,
      action
    });
    if (!leaseCheck.valid) {
      return { allowed: false, reason: leaseCheck.reason || 'LEASE_REQUIRED_OR_EXPIRED' };
    }

    if (action === 'run_command' && this._requiresSnapshot(payload.command)) {
      const artifacts = task.artifacts || {};
      if (!artifacts.snapshot_before && !payload.snapshotId && !payload.snapshot_id) {
        return { allowed: false, reason: 'SNAPSHOT_BEFORE_CONFIG_REQUIRED' };
      }
      if (!artifacts.rollback_plan && !payload.rollbackPlan && !payload.rollback_plan) {
        return { allowed: false, reason: 'ROLLBACK_PLAN_REQUIRED' };
      }
    }

    if (action === 'start_traffic') {
      const rate = Number(payload.ratePercent || payload.rate_percent || 0);
      const duration = Number(payload.durationSec || payload.duration_sec || 0);
      if (rate > 90) return { allowed: false, reason: 'TRAFFIC_RATE_EXCEEDS_POLICY' };
      if (duration > 300) return { allowed: false, reason: 'TRAFFIC_DURATION_EXCEEDS_POLICY' };
    }

    return { allowed: true, lease: leaseCheck.lease, task };
  }
}

module.exports = new ExecutionGateService();
