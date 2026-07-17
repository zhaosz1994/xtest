-- 工具注册表新增跳板机代理配置字段
-- 用于 HTTP 类型工具通过 SSH 跳板机访问隔离网段的服务（如 IXIA 适配器）
ALTER TABLE `agent_tool_registry` ADD COLUMN `proxy_config` JSON DEFAULT NULL COMMENT 'SSH 跳板机代理配置: {jump_host, jump_port, jump_username, jump_password, jump_key_path}';
