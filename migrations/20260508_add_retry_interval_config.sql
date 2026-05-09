UPDATE ai_config 
SET config_value = '{"temperature":"0.7","max_tokens":"4000","retry_interval":"30"}' 
WHERE config_key = 'scene_case_generation' 
  AND config_value NOT LIKE '%retry_interval%';
