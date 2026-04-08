-- 测试用例评审功能数据库迁移脚本
-- 创建时间: 2026-03-31
-- 功能说明: 添加测试用例评审功能所需的数据库表和字段

-- 选择数据库
USE xtest_db;

-- ============================================================================
-- 1. 修改test_cases表，添加评审相关字段
-- ============================================================================

-- 添加评审状态字段
ALTER TABLE test_cases 
ADD COLUMN review_status ENUM('draft', 'pending', 'approved', 'rejected') DEFAULT 'draft' COMMENT '评审状态: draft-草稿, pending-待评审, approved-已通过, rejected-被驳回' AFTER is_deleted;

-- 添加评审人ID字段
ALTER TABLE test_cases 
ADD COLUMN reviewer_id INT NULL COMMENT '评审人ID' AFTER review_status;

-- 添加提交评审时间字段
ALTER TABLE test_cases 
ADD COLUMN review_submitted_at TIMESTAMP NULL COMMENT '提交评审时间' AFTER reviewer_id;

-- 添加评审完成时间字段
ALTER TABLE test_cases 
ADD COLUMN review_completed_at TIMESTAMP NULL COMMENT '评审完成时间' AFTER review_submitted_at;

-- 添加索引以提高查询性能
ALTER TABLE test_cases 
ADD INDEX idx_review_status (review_status),
ADD INDEX idx_reviewer_id (reviewer_id);

-- 添加外键约束
ALTER TABLE test_cases
ADD CONSTRAINT fk_test_cases_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================================
-- 2. 创建评审记录表
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_records (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  case_id INT NOT NULL COMMENT '测试用例ID',
  reviewer_id INT NOT NULL COMMENT '评审人ID',
  submitter_id INT NOT NULL COMMENT '提交人ID',
  action ENUM('submit', 'approve', 'reject', 'resubmit') NOT NULL COMMENT '操作类型: submit-提交评审, approve-通过, reject-驳回, resubmit-重新提审',
  comment TEXT COMMENT '评审意见',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX idx_case_id (case_id),
  INDEX idx_reviewer_id (reviewer_id),
  INDEX idx_submitter_id (submitter_id),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (submitter_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试用例评审记录表';

-- ============================================================================
-- 3. 数据迁移（可选）
-- ============================================================================

-- 如果需要将现有用例的评审状态初始化为草稿状态，可以执行以下语句
-- UPDATE test_cases SET review_status = 'draft' WHERE review_status IS NULL;

-- ============================================================================
-- 4. 验证迁移结果
-- ============================================================================

-- 验证test_cases表结构
-- DESCRIBE test_cases;

-- 验证review_records表结构
-- DESCRIBE review_records;

-- 验证索引创建
-- SHOW INDEX FROM test_cases WHERE Key_name LIKE 'idx_review%';
-- SHOW INDEX FROM review_records;

-- ============================================================================
-- 回滚脚本（如果需要回滚，请执行以下语句）
-- ============================================================================

/*
-- 删除外键约束
ALTER TABLE test_cases DROP FOREIGN KEY fk_test_cases_reviewer;

-- 删除索引
ALTER TABLE test_cases DROP INDEX idx_review_status;
ALTER TABLE test_cases DROP INDEX idx_reviewer_id;

-- 删除字段
ALTER TABLE test_cases DROP COLUMN review_completed_at;
ALTER TABLE test_cases DROP COLUMN review_submitted_at;
ALTER TABLE test_cases DROP COLUMN reviewer_id;
ALTER TABLE test_cases DROP COLUMN review_status;

-- 删除review_records表
DROP TABLE IF EXISTS review_records;
*/
