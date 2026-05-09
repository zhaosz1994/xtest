-- 添加 partial_completed 状态和 chunk 统计字段
-- 用于区分"全部成功完成"和"部分成功完成"两种任务状态

ALTER TABLE `ai_case_generation_tasks` 
  MODIFY COLUMN `status` enum('pending','processing','completed','partial_completed','failed','cancelled') DEFAULT 'pending';

ALTER TABLE `ai_case_generation_tasks` 
  ADD COLUMN `completed_chunks` int DEFAULT 0;

ALTER TABLE `ai_case_generation_tasks` 
  ADD COLUMN `failed_chunks` int DEFAULT 0;

ALTER TABLE `ai_unified_tasks` 
  MODIFY COLUMN `status` enum('pending','processing','completed','partial_completed','failed','cancelled') DEFAULT 'pending';
