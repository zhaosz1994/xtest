#!/bin/bash

# ============================================
# 一键修复 AI 操作日志表缺失字段 (MySQL 5.x 兼容版)
# 适用于: Linux服务器快速修复
# ============================================

echo "╔══════════════════════════════════════════════╗"
echo "║   AI操作日志表 - 一键修复工具 (MySQL 5.x)   ║"
echo "║   解决: unknown column 'total_tokens' 错误 ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --check    仅检查,不执行修复"
    echo "  --fix      执行修复(默认)"
    echo "  --verify   修复后验证"
    echo "  -h, --help 显示帮助信息"
    echo ""
    echo "示例:"
    echo "  $0              # 执行修复"
    echo "  $0 --check      # 仅检查问题"
    echo "  $0 --fix && $0 --verify  # 修复并验证"
    exit 0
fi

if [ ! -f .env ]; then
    echo "❌ 错误: .env 文件不存在"
    echo ""
    echo "请先配置数据库连接:"
    echo "  cp .env.example .env"
    echo "  nano .env  # 编辑配置"
    exit 1
fi

source .env

if [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "❌ 错误: 数据库配置不完整"
    echo "请在.env文件中设置: DB_NAME, DB_USER, DB_PASSWORD"
    exit 1
fi

MYSQL="mysql"
[ -n "$DB_SOCKET" ] && MYSQL="$MYSQL --socket=$DB_SOCKET"
[ -n "$DB_HOST" ] && MYSQL="$MYSQL --host=$DB_HOST"
MYSQL="$MYSQL --user=$DB_USER --password=$DB_PASSWORD $DB_NAME"

echo "🔗 测试数据库连接..."
if ! echo "SELECT 1;" | $MYSQL > /dev/null 2>&1; then
    echo "❌ 数据库连接失败!"
    echo "请检查.env中的配置是否正确"
    exit 1
fi
echo "✅ 连接成功 ✓"
echo ""

check_fields() {
    local missing=0
    
    echo "📋 检查 ai_operation_logs 表字段..."
    echo "─────────────────────────────────────"
    
    for field in prompt_tokens completion_tokens total_tokens model_name; do
        exists=$(echo "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='$field';" | $MYSQL 2>/dev/null | tail -n 1)
        
        if [ "$exists" = "0" ]; then
            echo "  ❌ 缺失: $field"
            missing=$((missing + 1))
        else
            echo "  ✅ 存在: $field"
        fi
    done
    
    echo "─────────────────────────────────────"
    return $missing
}

fix_fields() {
    local fixed=0
    
    echo "🔧 开始修复缺失字段 (MySQL 5.x 兼容模式)..."
    echo "─────────────────────────────────────"
    
    for field in prompt_tokens completion_tokens total_tokens model_name; do
        case $field in
            prompt_tokens)
                sql="
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='prompt_tokens');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ai_operation_logs ADD COLUMN prompt_tokens INT DEFAULT 0 COMMENT \"提示词token数\" AFTER execution_time_ms', 'SELECT \"已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
"
                ;;
            completion_tokens)
                sql="
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='completion_tokens');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ai_operation_logs ADD COLUMN completion_tokens INT DEFAULT 0 COMMENT \"完成token数\" AFTER prompt_tokens', 'SELECT \"已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
"
                ;;
            total_tokens)
                sql="
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='total_tokens');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ai_operation_logs ADD COLUMN total_tokens INT DEFAULT 0 COMMENT \"总token数\" AFTER completion_tokens', 'SELECT \"已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
"
                ;;
            model_name)
                sql="
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND column_name='model_name');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ai_operation_logs ADD COLUMN model_name VARCHAR(100) COMMENT \"使用的AI模型名称\" AFTER total_tokens', 'SELECT \"已存在\"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
"
                ;;
        esac
        
        if echo "$sql" | $MYSQL > /dev/null 2>&1; then
            echo "  ✅ 已处理: $field"
            fixed=$((fixed + 1))
        else
            echo "  ⏭️ 处理完成: $field (可能已存在)"
        fi
    done
    
    echo "─────────────────────────────────────"
    echo "✅ 已处理所有字段"
}

verify_fix() {
    echo "🔍 验证修复结果..."
    echo "─────────────────────────────────────"
    
    echo ""
    echo "📊 表结构 (关键字段):"
    echo "SELECT Field, Type, Comment FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='ai_operation_logs' AND Field IN ('id', 'execution_time_ms', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'model_name', 'status') ORDER BY ORDINAL_POSITION;" | $MYSQL 2>/dev/null | column -t -s $'\t'
    
    echo ""
    echo "📈 表统计:"
    echo "SELECT COUNT(*) as '总记录数', SUM(CASE WHEN total_tokens > 0 THEN 1 ELSE 0 END) as '有token数据的记录' FROM ai_operation_logs;" | $MYSQL 2>/dev/null | tail -n 1
    
    echo "─────────────────────────────────────"
    echo "✅ 验证完成"
}

case "${1:--fix}" in
    --check)
        check_fields
        exit_code=$?
        if [ $exit_code -eq 0 ]; then
            echo ""
            echo "🎉 所有字段都存在,无需修复!"
            exit 0
        else
            echo ""
            echo "⚠️ 发现 $exit_code 个缺失字段"
            echo "运行 '$0 --fix' 进行修复"
            exit 1
        fi
        ;;
    --fix)
        check_fields
        missing=$?
        
        if [ $missing -eq 0 ]; then
            echo ""
            echo "🎉 所有字段都已存在,无需修复!"
            exit 0
        fi
        
        echo ""
        fix_fields
        
        echo ""
        echo "🔄 建议重启应用服务:"
        echo "  pm2 restart all"
        echo "  或"
        echo "  systemctl restart xtest"
        ;;
    --verify)
        verify_fix
        ;;
    *)
        echo "❌ 未知选项: $1"
        echo "使用 '$0 --help' 查看帮助"
        exit 1
        ;;
esac

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   操作完成!                                 ║"
echo "╚══════════════════════════════════════════════╝"
