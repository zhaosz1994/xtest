-- =====================================================================
-- Agent Tool Registry
-- 描述: Agent 工具注册表,集中管理 Agent 可调用的工具
--       支持 4 种调用方式: script(JS/Python in-process) / http / cli / builtin
--       存输入/输出 schema,Agent 据此知道如何调用
-- =====================================================================

CREATE TABLE IF NOT EXISTS `agent_tool_registry` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `tool_id` VARCHAR(100) NOT NULL COMMENT '工具唯一标识',
  `display_name` VARCHAR(200) NOT NULL COMMENT '中文显示名',
  `description` TEXT COMMENT '工具描述',
  `version` VARCHAR(20) DEFAULT 'v1' COMMENT '工具版本',
  `category` VARCHAR(50) DEFAULT NULL COMMENT '分类:packet/traffic/capture/analysis/config/sdk/external',
  `invocation_type` ENUM('script','http','cli','builtin') NOT NULL DEFAULT 'builtin' COMMENT '调用方式',
  `entry_point` VARCHAR(500) DEFAULT NULL COMMENT '脚本路径 / HTTP URL / CLI 命令模板',
  `language` ENUM('javascript','python','shell','none') DEFAULT 'none' COMMENT '脚本语言 (仅 script 类型)',
  `code_content` LONGTEXT COMMENT '脚本内容 (仅 script 类型,直存 DB)',
  `input_schema` JSON DEFAULT NULL COMMENT '输入参数 schema (JSON Schema 风格)',
  `output_schema` JSON DEFAULT NULL COMMENT '输出 schema',
  `auth_config` JSON DEFAULT NULL COMMENT 'HTTP 认证配置 (header/token/oauth)',
  `timeout_ms` INT DEFAULT 30000 COMMENT '调用超时 (毫秒)',
  `max_memory_mb` INT DEFAULT 256 COMMENT '内存上限 (MB,仅 script)',
  `tags` JSON DEFAULT NULL COMMENT '标签数组',
  `metadata` JSON DEFAULT NULL COMMENT '其他元数据',
  `status` ENUM('active','inactive','maintenance') DEFAULT 'active',
  `creator_id` INT DEFAULT NULL,
  `updater_id` INT DEFAULT NULL,
  `deleted_at` DATETIME NULL COMMENT '软删除时间',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tool_id` (`tool_id`),
  KEY `idx_invocation_type` (`invocation_type`),
  KEY `idx_status` (`status`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Agent 工具注册表';

-- =====================================================================
-- 种子数据:从设计文档 v2_1_traffic_cli_agent_extension.md 提取
-- =====================================================================

-- 1. traffic_tool_service: 打流服务,包装 SdkCTP
INSERT INTO `agent_tool_registry`
  (`tool_id`, `display_name`, `description`, `version`, `category`, `invocation_type`, `entry_point`, `language`, `input_schema`, `output_schema`, `timeout_ms`, `tags`, `status`, `created_at`)
VALUES
  ('traffic_tool_service', 'Traffic Tool Service', '基于 SdkCTP 生成报文模板、flow spec、打流计划、抓包与统计。Agent 通过 HTTP 调用打流服务的 7 个 API。', 'v1', 'traffic', 'http', 'http://traffic-tool-service:8080', 'none',
   JSON_OBJECT(
     'apis', JSON_ARRAY(
       JSON_OBJECT('name', 'build_packet_template', 'params', JSON_OBJECT('packet_requirements', JSON_OBJECT('type','object','required',JSON_ARRAY('protocol','fields'))), 'returns', 'packet_template_id'),
       JSON_OBJECT('name', 'compile_flow_spec', 'params', JSON_OBJECT('packet_template_id','string','traffic_profile','object','topology','object','target_env','string'), 'returns', JSON_ARRAY('flow_spec_id','sdkctp_script_path')),
       JSON_OBJECT('name', 'start_traffic', 'params', JSON_OBJECT('flow_spec_id','string'), 'returns', 'run_id'),
       JSON_OBJECT('name', 'stop_traffic', 'params', JSON_OBJECT('run_id','string'), 'returns', 'stop_status'),
       JSON_OBJECT('name', 'get_traffic_stats', 'params', JSON_OBJECT('run_id','string'), 'returns', 'tx_rx_loss_latency_jitter'),
       JSON_OBJECT('name', 'capture_packets', 'params', JSON_OBJECT('run_id','string','port','string','duration_sec','number'), 'returns', 'pcap_path'),
       JSON_OBJECT('name', 'analyze_pcap', 'params', JSON_OBJECT('pcap_path','string','expected_pattern','object'), 'returns', 'packet_analysis_report')
     )
   ),
   JSON_OBJECT('type', 'mixed', 'fields', JSON_OBJECT('packet_template_id','string','flow_spec_id','string','run_id','string','pcap_path','string','stop_status','string','packet_analysis_report','object')),
   60000,
   JSON_ARRAY('traffic','sdkctp','packet','flow'),
   'active', NOW());

-- 2. sdk_cli_tool_service: SDK CLI 服务
INSERT INTO `agent_tool_registry`
  (`tool_id`, `display_name`, `description`, `version`, `category`, `invocation_type`, `entry_point`, `language`, `input_schema`, `output_schema`, `timeout_ms`, `tags`, `status`, `created_at`)
VALUES
  ('sdk_cli_tool_service', 'SDK CLI Tool Service', '包装 SDK CLI,提供 session 管理、命令执行、状态快照、diff、counter 查询与 rollback 生成。', 'v1', 'sdk', 'http', 'http://sdk-cli-service:8081', 'none',
   JSON_OBJECT(
     'apis', JSON_ARRAY(
       JSON_OBJECT('name', 'open_session', 'params', JSON_OBJECT('target_env','string','connection_profile','object','sdk_branch','string'), 'returns', JSON_ARRAY('session_id','prompt','sdk_version')),
       JSON_OBJECT('name', 'run_command', 'params', JSON_OBJECT('session_id','string','command','string','timeout_sec','number'), 'returns', JSON_OBJECT('stdout','string','stderr','string','exit_status','number','parsed_error','object')),
       JSON_OBJECT('name', 'run_command_batch', 'params', JSON_OBJECT('session_id','string','commands','array','stop_on_error','boolean'), 'returns', 'batch_result'),
       JSON_OBJECT('name', 'snapshot_state', 'params', JSON_OBJECT('session_id','string','snapshot_profile','object'), 'returns', JSON_ARRAY('snapshot_id','snapshot_json_path')),
       JSON_OBJECT('name', 'diff_snapshot', 'params', JSON_OBJECT('before_snapshot_id','string','after_snapshot_id','string'), 'returns', 'state_diff'),
       JSON_OBJECT('name', 'query_counter', 'params', JSON_OBJECT('session_id','string','counter_spec','object'), 'returns', 'counter_values'),
       JSON_OBJECT('name', 'generate_rollback', 'params', JSON_OBJECT('state_diff','object'), 'returns', 'rollback_commands')
     )
   ),
   JSON_OBJECT('type', 'mixed', 'fields', JSON_OBJECT('session_id','string','stdout','string','exit_status','number','snapshot_id','string','state_diff','object','counter_values','object','rollback_commands','array')),
   30000,
   JSON_ARRAY('sdk','cli','config','counter'),
   'active', NOW());

-- 3. pcap_analyzer: Python 脚本,分析 pcap 文件
INSERT INTO `agent_tool_registry`
  (`tool_id`, `display_name`, `description`, `version`, `category`, `invocation_type`, `entry_point`, `language`, `code_content`, `input_schema`, `output_schema`, `timeout_ms`, `max_memory_mb`, `tags`, `status`, `created_at`)
VALUES
  ('pcap_analyzer', 'Pcap Analyzer', 'Python 脚本:解析 pcap 文件,提取报文统计、协议分布、异常报文;支持与期望模式对比。', 'v1', 'analysis', 'script', 'tools/pcap_analyzer.py', 'python',
   '# pcap_analyzer.py\n# 输入: pcap_path, expected_pattern (可选)\n# 输出: packet_analysis_report (JSON)\nimport sys, json, argparse\n\nfrom scapy.all import rdpcap\n\ndef analyze(pcap_path, expected_pattern=None):\n    packets = rdpcap(pcap_path)\n    report = {\n        "total_packets": len(packets),\n        "protocols": {},\n        "anomalies": []\n    }\n    # TODO: 实际解析逻辑\n    return report\n\nif __name__ == "__main__":\n    parser = argparse.ArgumentParser()\n    parser.add_argument("--pcap", required=True)\n    parser.add_argument("--expected", default=None)\n    args = parser.parse_args()\n    result = analyze(args.pcap, args.expected)\n    print(json.dumps(result, indent=2))\n',
   JSON_OBJECT(
     'type', 'object',
     'properties', JSON_OBJECT(
       'pcap_path', JSON_OBJECT('type','string','description','pcap 文件路径'),
       'expected_pattern', JSON_OBJECT('type','object','description','期望的报文模式,用于对比')
     ),
     'required', JSON_ARRAY('pcap_path')
   ),
   JSON_OBJECT(
     'type', 'object',
     'properties', JSON_OBJECT(
       'total_packets', JSON_OBJECT('type','number'),
       'protocols', JSON_OBJECT('type','object','additionalProperties',JSON_OBJECT('type','number')),
       'anomalies', JSON_ARRAY('object')
     )
   ),
   60000, 512,
   JSON_ARRAY('pcap','analysis','python'),
   'active', NOW());

-- 4. ixia_adapter: HTTP 服务,适配 IXIA 硬件
INSERT INTO `agent_tool_registry`
  (`tool_id`, `display_name`, `description`, `version`, `category`, `invocation_type`, `entry_point`, `language`, `input_schema`, `output_schema`, `timeout_ms`, `tags`, `status`, `created_at`)
VALUES
  ('ixia_adapter', 'IXIA Hardware Adapter', '适配 IXIA 物理发包仪,提供端口预约、流量下发、统计查询能力。', 'v1', 'external', 'http', 'http://ixia-adapter:8082', 'none',
   JSON_OBJECT(
     'apis', JSON_ARRAY(
       JSON_OBJECT('name', 'reserve_port', 'params', JSON_OBJECT('port','string','duration_sec','number'), 'returns', 'reservation_id'),
       JSON_OBJECT('name', 'send_traffic', 'params', JSON_OBJECT('reservation_id','string','flow_spec','object'), 'returns', 'tx_id'),
       JSON_OBJECT('name', 'get_stats', 'params', JSON_OBJECT('tx_id','string'), 'returns', 'tx_rx_stats')
     )
   ),
   JSON_OBJECT('type','mixed','fields',JSON_OBJECT('reservation_id','string','tx_id','string','tx_rx_stats','object')),
   30000,
   JSON_ARRAY('ixia','hardware','traffic'),
   'active', NOW());

-- 5. packet_template_builder: 内置工具 (示例,builtin)
INSERT INTO `agent_tool_registry`
  (`tool_id`, `display_name`, `description`, `version`, `category`, `invocation_type`, `entry_point`, `language`, `input_schema`, `output_schema`, `timeout_ms`, `tags`, `status`, `created_at`)
VALUES
  ('packet_template_builder', 'Packet Template Builder', '根据协议知识构造报文模板。内置实现,由 Agent 后端代码直接调用。', 'v1', 'packet', 'builtin', NULL, 'none',
   JSON_OBJECT(
     'type', 'object',
     'properties', JSON_OBJECT(
       'protocol', JSON_OBJECT('type','string','enum',JSON_ARRAY('ethernet','ipv4','ipv6','tcp','udp','vxlan')),
       'fields', JSON_OBJECT('type','object','description','协议字段映射')
     ),
     'required', JSON_ARRAY('protocol','fields')
   ),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('packet_template_id','string')),
   5000,
   JSON_ARRAY('packet','template','builtin'),
   'active', NOW());

-- 6. traffic_failure_classifier: 内置工具
INSERT INTO `agent_tool_registry`
  (`tool_id`, `display_name`, `description`, `version`, `category`, `invocation_type`, `entry_point`, `language`, `input_schema`, `output_schema`, `timeout_ms`, `tags`, `status`, `created_at`)
VALUES
  ('traffic_failure_classifier', 'Traffic Failure Classifier', '区分流量工具问题、配置问题、DUT 问题、环境问题。', 'v1', 'analysis', 'builtin', NULL, 'none',
   JSON_OBJECT(
     'type', 'object',
     'properties', JSON_OBJECT(
       'symptom', JSON_OBJECT('type','string'),
       'cli_output', JSON_OBJECT('type','string'),
       'traffic_stats', JSON_OBJECT('type','object')
     ),
     'required', JSON_ARRAY('symptom')
   ),
   JSON_OBJECT(
     'type', 'object',
     'properties', JSON_OBJECT(
       'category', JSON_OBJECT('type','string','enum',JSON_ARRAY('traffic_tool','config','dut','environment')),
       'root_cause', JSON_OBJECT('type','string'),
       'suggested_action', JSON_OBJECT('type','string')
     )
   ),
   5000,
   JSON_ARRAY('failure','classifier','builtin'),
   'active', NOW());
