ALTER TABLE `ai_sub_agents` ADD COLUMN `stream_mode` ENUM('auto','always','never') NOT NULL DEFAULT 'auto' COMMENT '流式输出模式: auto=QA时流式/任务时非流式, always=始终流式, never=始终非流式';
