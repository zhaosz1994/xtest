-- 多人评审功能数据库迁移脚本
-- 创建时间: 2026-04-01
-- 功能说明: 支持多人评审（全部通过规则）

USE xtest_db;

-- ============================================================================
-- 1. 创建用例评审人表（支持多人评审）
-- ============================================================================

CREATE TABLE IF NOT EXISTS case_reviewers (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  case_id INT NOT NULL COMMENT '测试用例ID',
  reviewer_id INT NOT NULL COMMENT '评审人ID',
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending' COMMENT '评审状态: pending-待评审, approved-已通过, rejected-已拒绝',
  comment TEXT COMMENT '评审意见',
  reviewed_at TIMESTAMP NULL COMMENT '评审时间',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY uk_case_reviewer (case_id, reviewer_id),
  INDEX idx_case_id (case_id),
  INDEX idx_reviewer_id (reviewer_id),
  INDEX idx_status (status),
  FOREIGN KEY (case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例评审人表（多人评审）';

-- ============================================================================
-- 2. 迁移现有数据（将test_cases中的reviewer_id迁移到case_reviewers表）
-- ============================================================================

INSERT IGNORE INTO case_reviewers (case_id, reviewer_id, status, created_at)
SELECT id, reviewer_id, 
       CASE 
         WHEN review_status = 'approved' THEN 'approved'
         WHEN review_status = 'rejected' THEN 'rejected'
         ELSE 'pending'
       END,
       COALESCE(review_submitted_at, NOW())
FROM test_cases 
WHERE reviewer_id IS NOT NULL AND review_status IN ('pending', 'approved', 'rejected');

-- ============================================================================
-- 3. 验证迁移结果
-- ============================================================================

-- SELECT COUNT(*) as migrated_count FROM case_reviewers;

-- ============================================================================
-- 回滚脚本（如果需要回滚，请执行以下语句）
-- ============================================================================

/*
DROP TABLE IF EXISTS case_reviewers;
*/
