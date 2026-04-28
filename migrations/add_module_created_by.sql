-- 为 modules 表添加 created_by 字段，用于记录模块创建者
-- 执行时间: 2025-04-25

-- 添加 created_by 字段
ALTER TABLE modules ADD COLUMN created_by VARCHAR(100) NULL COMMENT '创建者用户名' AFTER parent_id;

-- 添加 created_at 字段（如果不存在）
ALTER TABLE modules ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间';

-- 添加 updated_at 字段（如果不存在）
ALTER TABLE modules ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
