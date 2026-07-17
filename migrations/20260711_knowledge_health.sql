-- =====================================================================
-- Part 2: 模块知识健康度 (Module Knowledge Health Score)
-- 描述: 给 modules 表加健康度字段,记录 5 维度评分明细
-- =====================================================================

ALTER TABLE `modules`
  ADD COLUMN `health_score` DECIMAL(5,2) DEFAULT 0 COMMENT '知识健康度评分(0-100)',
  ADD COLUMN `health_checked_at` DATETIME NULL COMMENT '上次评分时间',
  ADD COLUMN `health_breakdown` JSON DEFAULT NULL COMMENT '各维度得分明细: docCompleteness/drvSdkConsistency/bugCoverage/testPointCoverage/executionStability';
