#!/bin/bash

set -e

echo "========================================"
echo "  修复 AI 操作日志表 - 缺失字段"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

if [ ! -f .env ]; then
    echo "错误: .env 文件不存在"
    exit 1
fi

source .env

if [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "错误: 数据库配置不完整"
    exit 1
fi

MYSQL_CMD="mysql"
if [ -n "$DB_SOCKET" ]; then
    MYSQL_CMD="$MYSQL_CMD --socket=$DB_SOCKET"
elif [ -n "$DB_HOST" ]; then
    MYSQL_CMD="$MYSQL_CMD --host=$DB_HOST"
else
    MYSQL_CMD="$MYSQL_CMD --host=127.0.0.1"
fi

MYSQL_CMD="$MYSQL_CMD --user=$DB_USER --password=$DB_PASSWORD $DB_NAME"

echo ""
echo "=== 1. 检查当前表结构 ==="
echo "DESCRIBE ai_operation_logs;" | $MYSQL_CMD | head -n 30

echo ""
echo "=== 2. 检查缺失字段 ==="
MISSING_FIELDS=()

for field in prompt_tokens completion_tokens total_tokens model_name; do
    EXISTS=$(echo "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='$field';" | $MYSQL_CMD | tail -n 1)
    
    if [ "$EXISTS" = "0" ]; then
        MISSING_FIELDS+=($field)
        echo "⚠ 缺少字段: $field"
    else
        echo "✓ 字段存在: $field"
    fi
done

if [ ${#MISSING_FIELDS[@]} -eq 0 ]; then
    echo ""
    echo "✓ 所有字段都已存在,无需修复!"
    exit 0
fi

echo ""
echo "=== 3. 开始修复 (MySQL 5.x 兼容模式) ==="

for field in "${MISSING_FIELDS[@]}"; do
    case $field in
        prompt_tokens)
            echo "添加 prompt_tokens 字段..."
            echo "
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='prompt_tokens');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ai_operation_logs ADD COLUMN prompt_tokens INT DEFAULT 0 COMMENT \"提示词token数\" AFTER execution_time_ms', 'SELECT \"已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
            " | $MYSQL_CMD
            ;;
        completion_tokens)
            echo "添加 completion_tokens 字段..."
            echo "
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='completion_tokens');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ai_operation_logs ADD COLUMN completion_tokens INT DEFAULT 0 COMMENT \"完成token数\" AFTER prompt_tokens', 'SELECT \"已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
            " | $MYSQL_CMD
            ;;
        total_tokens)
            echo "添加 total_tokens 字段..."
            echo "
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='total_tokens');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ai_operation_logs ADD COLUMN total_tokens INT DEFAULT 0 COMMENT \"总token数\" AFTER completion_tokens', 'SELECT \"已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
            " | $MYSQL_CMD
            ;;
        model_name)
            echo "添加 model_name 字段..."
            echo "
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='model_name');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ai_operation_logs ADD COLUMN model_name VARCHAR(100) COMMENT \"使用的AI模型名称\" AFTER total_tokens', 'SELECT \"已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
            " | $MYSQL_CMD
            ;;
    esac
    
    if [ $? -eq 0 ]; then
        echo "  ✓ 成功处理: $field"
    else
        echo "  ✗ 处理失败: $field"
        exit 1
    fi
done

echo ""
echo "=== 4. 创建索引（优化查询性能）==="
echo "
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND index_name='idx_ai_logs_total_tokens');
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_ai_logs_total_tokens ON ai_operation_logs(total_tokens)', 'SELECT \"索引已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
" | $MYSQL_CMD && echo "✓ 索引检查完成" || echo "⚠ 索引创建失败或已存在"

echo ""
echo "=== 5. 验证修复结果 ==="
echo "DESCRIBE ai_operation_logs;" | $MYSQL_CMD

echo ""
echo "========================================"
echo "  ✅ 修复完成！"
echo "========================================"
echo ""
echo "说明:"
echo "  已成功处理以下字段到 ai_operation_logs 表:"
for field in "${MISSING_FIELDS[@]}"; do
    echo "    - $field"
done
echo ""
echo "现在可以重启应用服务,错误应该已经解决。"
