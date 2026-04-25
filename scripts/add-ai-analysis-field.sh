#!/bin/bash

# 添加 ai_analysis_failed 字段到 test_reports 表
# 使用方法: ./add-ai-analysis-field.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}开始添加 ai_analysis_failed 字段...${NC}"

# 从.env文件读取数据库配置
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo -e "${RED}错误: .env 文件不存在${NC}"
    exit 1
fi

# 检查必要的变量
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
    echo -e "${RED}错误: 数据库配置不完整${NC}"
    exit 1
fi

# 执行SQL
echo -e "${YELLOW}执行SQL迁移...${NC}"

mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" << 'EOF'
-- 检查字段是否存在
SET @column_exists = (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    AND table_name = 'test_reports'
    AND column_name = 'ai_analysis_failed'
);

-- 如果字段不存在，则添加
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE test_reports ADD COLUMN ai_analysis_failed TINYINT(1) DEFAULT 0 COMMENT ''AI分析是否失败: 0-成功, 1-失败''',
    'SELECT ''字段已存在，跳过添加'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 显示结果
SELECT 
    COLUMN_NAME,
    COLUMN_TYPE,
    COLUMN_DEFAULT,
    COLUMN_COMMENT
FROM information_schema.columns
WHERE table_schema = DATABASE()
AND table_name = 'test_reports'
AND column_name = 'ai_analysis_failed';
EOF

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 字段添加成功！${NC}"
else
    echo -e "${RED}✗ 字段添加失败，请检查错误信息${NC}"
    exit 1
fi
