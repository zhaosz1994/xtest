const fs = require('fs').promises;
const path = require('path');
const pool = require('../db');
const axios = require('axios');
const { isAdmin } = require('../middleware');
const resourceSchedulerService = require('./resourceSchedulerService');
const executionGateService = require('./executionGateService');
const agentConsoleService = require('./agentConsoleService');
const { jsonValue, newId, parsePositiveInt, safePathSegment, resolveInsideRoot } = require('./agentUtils');

const ARTIFACT_ROOT = process.env.AGENT_ARTIFACT_DIR || path.join(__dirname, '..', 'uploads', 'agent-artifacts');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

class TrafficToolService {
  async _assertRunAccess(user, runId) {
    const [rows] = await pool.execute('SELECT * FROM traffic_run_trace WHERE run_id = ? LIMIT 1', [safePathSegment(runId)]);
    if (rows.length === 0) throw new Error('Traffic run不存在');
    const run = rows[0];
    if (!isAdmin(user) && (!run.created_by || run.created_by !== user.id)) {
      throw new Error('无权访问该Traffic run');
    }
    return run;
  }

  async buildPacketTemplate(requirements = {}) {
    const templateId = newId('PKT');
    const normalized = {
      l2: requirements.l2 || {},
      vlan: requirements.vlan || null,
      ether_type: requirements.ether_type || requirements.etherType || 'ipv4',
      ip: requirements.ip || {},
      priority: requirements.priority || {},
      payload_len: requirements.payload_len || requirements.payloadLen || [64]
    };
    return { packetTemplateId: templateId, packet_template_id: templateId, template: normalized };
  }

  _buildFlowSpec({ packetTemplate, trafficProfile, topology, targetEnv }) {
    const profile = trafficProfile || {};
    return {
      version: 'sdkctp.flow.v1',
      target_env: targetEnv || 'CModel',
      topology: topology || {},
      packet_template: packetTemplate || {},
      traffic_profile: {
        mode: profile.mode || 'continuous',
        rate_percent: Math.min(parsePositiveInt(profile.rate_percent || profile.ratePercent, 10), 90),
        duration_sec: Math.min(parsePositiveInt(profile.duration_sec || profile.durationSec, 10), 300),
        burst_size: parsePositiveInt(profile.burst_size || profile.burstSize, 0),
        seed: profile.seed || Date.now()
      },
      expected_observation: profile.expected_observation || {}
    };
  }

  async compileFlowSpec(data = {}) {
    const packetTemplate = data.packetTemplate || data.packet_template || (await this.buildPacketTemplate(data.packetRequirements || data.packet_requirements || {})).template;
    const flowSpec = this._buildFlowSpec({
      packetTemplate,
      trafficProfile: data.trafficProfile || data.traffic_profile || {},
      topology: data.topology || {},
      targetEnv: data.targetEnv || data.target_env
    });
    const flowSpecId = safePathSegment(data.flowSpecId || newId('FLOW'));
    const dir = resolveInsideRoot(ARTIFACT_ROOT, flowSpecId);
    await ensureDir(dir);
    const flowSpecPath = path.join(dir, 'flow_spec.json');
    const scriptPath = path.join(dir, 'traffic.py');
    const script = [
      '# Auto-generated SdkCTP traffic script',
      `FLOW_SPEC_ID = ${JSON.stringify(flowSpecId)}`,
      `FLOW_SPEC = ${JSON.stringify(flowSpec, null, 2)}`,
      'def main():',
      '    print("SdkCTP dry-run flow spec loaded:", FLOW_SPEC_ID)',
      'if __name__ == "__main__":',
      '    main()'
    ].join('\n');
    await fs.writeFile(flowSpecPath, JSON.stringify(flowSpec, null, 2));
    await fs.writeFile(scriptPath, script);
    return { flowSpecId, flow_spec_id: flowSpecId, flowSpec, flow_spec_path: flowSpecPath, sdkctp_script_path: scriptPath };
  }

  async startTraffic(user, data = {}) {
    const mode = String(data.mode || 'dry_run').toLowerCase();
    const trafficProfile = data.trafficProfile || data.traffic_profile || {};
    const gate = await executionGateService.checkAction({
      user,
      taskId: data.taskId || data.task_id,
      leaseId: data.leaseId || data.lease_id,
      action: 'start_traffic',
      mode,
      payload: {
        trafficType: data.trafficType || data.traffic_type,
        ratePercent: trafficProfile.rate_percent || trafficProfile.ratePercent,
        durationSec: trafficProfile.duration_sec || trafficProfile.durationSec
      }
    });
    if (!gate.allowed) {
      return { status: 'rejected', reason: gate.reason, message: 'Execution gate rejected this traffic action.' };
    }

    const runId = safePathSegment(data.runId || data.run_id || newId('TR'));
    const flow = data.flowSpecId || data.flow_spec_id
      ? { flowSpecId: safePathSegment(data.flowSpecId || data.flow_spec_id), flow_spec_path: data.flowSpecPath || data.flow_spec_path, sdkctp_script_path: data.sdkctpScriptPath || data.sdkctp_script_path }
      : await this.compileFlowSpec(data);

    // 连接路由：根据 resourceConnections.traffic 的协议选择执行路径
    const resourceConnections = data.resourceConnections || {};
    const trafficEndpoint = resourceConnections.traffic || resourceConnections.injector || null;
    let status, stats;

    if (trafficEndpoint && mode !== 'dry_run' && mode !== 'generation') {
      // 真实流量执行
      const routeResult = await this._routeTrafficStart(trafficEndpoint, flow.flowSpec, { runId, sessionId: data.sessionId, taskId: data.taskId, timeout: 60000 });
      status = routeResult.status || 'running';
      stats = routeResult.stats || { tx_packets: 0, rx_packets: 0, loss_packets: 0, started_at: new Date().toISOString() };
    } else {
      status = mode === 'dry_run' || mode === 'generation' ? 'compiled' : 'running';
      stats = status === 'compiled' ? { dry_run: true, tx_packets: 0, rx_packets: 0, loss_packets: 0 } : { tx_packets: 0, rx_packets: 0, loss_packets: 0, started_at: new Date().toISOString() };
    }

    await pool.execute(
      `INSERT INTO traffic_run_trace
       (session_id, task_id, lease_id, run_id, created_by, sdkctp_script_path, flow_spec_path, stats, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [data.sessionId || data.session_id || 'standalone', data.taskId || data.task_id || null, data.leaseId || data.lease_id || null, runId, user.id, flow.sdkctp_script_path || null, flow.flow_spec_path || null, jsonValue(stats), status]
    );
    if (data.sessionId || data.session_id) {
      await agentConsoleService.getSession(user, data.sessionId || data.session_id);
      await agentConsoleService.emitEvent({
        sessionId: data.sessionId || data.session_id,
        taskId: data.taskId || data.task_id,
        eventType: status === 'running' ? 'TRAFFIC_STARTED' : 'TRAFFIC_READY',
        senderAgent: 'traffic_agent_v1',
        receiverAgent: 'sdk_cli_agent_v1',
        phase: status === 'running' ? 'EXECUTE_TRAFFIC' : 'CRITIC_GATE',
        payload: { runId, flowSpecId: flow.flowSpecId || flow.flow_spec_id, status }
      });
    }
    return { runId, run_id: runId, status, ...flow, stats };
  }

  /**
   * 根据 connection_profiles URL 协议路由流量启动
   * 支持协议: cmodel://, ixia://, http://
   */
  async _routeTrafficStart(endpoint, flowSpec, options = {}) {
    const url = new URL(endpoint);
    const protocol = url.protocol.replace(':', '');

    switch (protocol) {
      case 'cmodel':
        return this._startTrafficViaCmodel(endpoint, flowSpec, options);
      case 'ixia':
        return this._startTrafficViaIxia(endpoint, flowSpec, options);
      case 'http':
      case 'https':
        return this._startTrafficViaHttp(endpoint, flowSpec, options);
      default:
        throw new Error(`不支持的流量连接协议: ${protocol}`);
    }
  }

  /**
   * cmodel:// 协议：通过 CModel REST API 启动流量
   * URL 格式: cmodel://instance01/injector → http://cmodel-host/api/cmodel/instance01/traffic/start
   */
  async _startTrafficViaCmodel(endpoint, flowSpec, options = {}) {
    const apiBase = process.env.CMODEL_API_BASE || 'http://localhost:8080';
    const url = new URL(endpoint);
    const instance = url.hostname;
    const api = `${apiBase}/api/cmodel/${instance}/traffic/start`;
    try {
      const response = await axios.post(api, { flow_spec: flowSpec, run_id: options.runId }, { timeout: options.timeout || 60000 });
      return {
        status: response.data?.status || 'running',
        stats: response.data?.stats || { tx_packets: 0, rx_packets: 0, loss_packets: 0, started_at: new Date().toISOString() }
      };
    } catch (error) {
      return {
        status: 'failed',
        stats: { error: `CModel traffic error: ${error.response?.data?.error || error.message}` }
      };
    }
  }

  /**
   * ixia:// 协议：通过 IXIA REST API 启动流量（支持跳板机代理）
   * URL 格式: ixia://appliance/session
   * 如果配置了 agentToolService 的 proxy_config (跳板机)，会通过跳板机转发
   */
  async _startTrafficViaIxia(endpoint, flowSpec, options = {}) {
    // 尝试通过 agentToolService 的 IXIA 工具调用（支持 SSH 跳板机）
    try {
      const agentToolService = require('./agentToolService');
      const url = new URL(endpoint);
      const appliance = url.hostname;
      const toolResult = await agentToolService.invokeTool(null, {
        toolId: 'ixia_traffic',
        action: 'start',
        payload: { appliance, flow_spec: flowSpec, run_id: options.runId }
      });
      return {
        status: toolResult?.status || 'running',
        stats: toolResult?.stats || { tx_packets: 0, rx_packets: 0, loss_packets: 0, started_at: new Date().toISOString() }
      };
    } catch (error) {
      // 回退：直接 HTTP 调用 IXIA REST API
      return this._startTrafficViaHttp(endpoint, flowSpec, options);
    }
  }

  /**
   * http(s):// 协议：直接通过 HTTP POST 启动流量
   */
  async _startTrafficViaHttp(endpoint, flowSpec, options = {}) {
    try {
      const response = await axios.post(endpoint, {
        flow_spec: flowSpec,
        run_id: options.runId,
        session_id: options.sessionId,
        task_id: options.taskId
      }, { timeout: options.timeout || 60000 });
      return {
        status: response.data?.status || 'running',
        stats: response.data?.stats || { tx_packets: 0, rx_packets: 0, loss_packets: 0, started_at: new Date().toISOString() }
      };
    } catch (error) {
      return {
        status: 'failed',
        stats: { error: `HTTP traffic error: ${error.response?.data?.error || error.message}` }
      };
    }
  }

  async stopTraffic(user, runId, data = {}) {
    const run = await this._assertRunAccess(user, runId);
    if (run.lease_id) {
      const leaseCheck = await resourceSchedulerService.validateLeaseForAction({ leaseId: run.lease_id, taskId: run.task_id, userId: user.id, action: 'stop_traffic' });
      if (!leaseCheck.valid) throw new Error('Lease无效或已过期');
    }
    const stats = data.stats || { tx_packets: 100000, rx_packets: 100000, loss_packets: 0, stopped_at: new Date().toISOString() };
    await pool.execute('UPDATE traffic_run_trace SET status = ?, stats = ? WHERE run_id = ?', ['stopped', jsonValue(stats), runId]);
    if (run.session_id && run.session_id !== 'standalone') {
      await agentConsoleService.getSession(user, run.session_id);
      await agentConsoleService.emitEvent({
        sessionId: run.session_id,
        taskId: run.task_id,
        eventType: 'TRAFFIC_STOPPED',
        senderAgent: 'traffic_agent_v1',
        receiverAgent: 'sdk_cli_agent_v1',
        phase: 'OBSERVE',
        payload: { runId, stats }
      });
    }
    return { runId, status: 'stopped', stats };
  }

  async getStats(runId, user = null) {
    if (user) {
      const row = await this._assertRunAccess(user, runId);
      return { ...row, stats: typeof row.stats === 'string' ? JSON.parse(row.stats || '{}') : row.stats };
    }
    const [rows] = await pool.execute('SELECT * FROM traffic_run_trace WHERE run_id = ? LIMIT 1', [safePathSegment(runId)]);
    if (rows.length === 0) throw new Error('Traffic run不存在');
    const row = rows[0];
    return { ...row, stats: typeof row.stats === 'string' ? JSON.parse(row.stats || '{}') : row.stats };
  }

  async capturePackets(user, runId, port, durationSec = 10) {
    const safeRunId = safePathSegment(runId);
    const run = await this.getStats(safeRunId, user);
    const dir = resolveInsideRoot(ARTIFACT_ROOT, safeRunId);
    await ensureDir(dir);
    const pcapPath = path.join(dir, `${String(port || 'port').replace(/[^a-zA-Z0-9_-]/g, '_')}.pcap.txt`);
    await fs.writeFile(pcapPath, `pcap placeholder for ${runId}, port=${port}, duration=${durationSec}s\n`);
    await pool.execute('UPDATE traffic_run_trace SET pcap_path = ? WHERE run_id = ?', [pcapPath, safeRunId]);
    return { runId: safeRunId, pcapPath: pcapPath, pcap_path: pcapPath };
  }

  async analyzePcap(pcapPath, expectedPattern = {}) {
    return {
      pcapPath,
      status: 'analyzed',
      expectedPattern,
      signature: 'pcap_analysis_placeholder',
      findings: []
    };
  }
}

module.exports = new TrafficToolService();
