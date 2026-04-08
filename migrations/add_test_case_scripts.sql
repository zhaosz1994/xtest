-- 关联脚本表迁移脚本
-- 创建时间: 2026-04-03
-- 说明: 用于存储测试用例关联的自动化测试脚本信息

USE xtest_db;

CREATE TABLE IF NOT EXISTS test_case_scripts (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  test_case_id INT NOT NULL COMMENT '测试用例ID',
  script_name VARCHAR(255) NOT NULL COMMENT '脚本名称，如 sdk_fdb_func_xxx_xxx.tcl',
  script_type VARCHAR(50) DEFAULT 'tcl' COMMENT '脚本类型：tcl/py/sh/other',
  description TEXT COMMENT '脚本描述',
  file_path VARCHAR(500) COMMENT '上传文件的存储路径',
  file_size BIGINT COMMENT '文件大小（字节）',
  file_hash VARCHAR(64) COMMENT '文件MD5哈希值，用于去重',
  original_filename VARCHAR(255) COMMENT '原始文件名',
  link_url VARCHAR(1000) COMMENT '外部链接URL',
  link_title VARCHAR(255) COMMENT '链接显示标题',
  link_type VARCHAR(20) DEFAULT 'external' COMMENT '链接类型：external/gitlab/jira/other',
  order_index INT DEFAULT 0 COMMENT '排序序号',
  creator VARCHAR(50) NOT NULL COMMENT '创建人',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  INDEX idx_test_case_id (test_case_id),
  INDEX idx_script_type (script_type),
  INDEX idx_script_name (script_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试用例关联脚本表';
