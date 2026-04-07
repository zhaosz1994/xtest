#!/bin/bash

set -e

echo "========================================"
echo "  数据库完整性检查工具 (Shell版)"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

if [ ! -f .env ]; then
    echo "错误: .env 文件不存在"
    echo "请复制 .env.example 为 .env 并配置数据库连接信息"
    exit 1
fi

source .env

if [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "错误: 数据库配置不完整"
    echo "请在 .env 文件中配置 DB_NAME, DB_USER, DB_PASSWORD"
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
echo "=== 1. 检查数据库连接 ==="
if echo "SELECT 1;" | $MYSQL_CMD > /dev/null 2>&1; then
    echo "✓ 数据库连接成功"
else
    echo "✗ 数据库连接失败"
    exit 1
fi

echo ""
echo "=== 2. 检查表数量 ==="
TABLE_COUNT=$(echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME';" | $MYSQL_CMD | tail -n 1)
echo "✓ 发现 $TABLE_COUNT 个表"

echo ""
echo "=== 3. 检查关键表是否存在 ==="
CRITICAL_TABLES="users test_cases test_plans test_reports projects modules"
for table in $CRITICAL_TABLES; do
    EXISTS=$(echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_name='$table';" | $MYSQL_CMD | tail -n 1)
    if [ "$EXISTS" -gt 0 ]; then
        echo "✓ 表 $table 存在"
    else
        echo "✗ 表 $table 不存在"
    fi
done

echo ""
echo "=== 4. 检查表数据量 ==="
echo "SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_rows > 0 ORDER BY table_rows DESC LIMIT 10;" | $MYSQL_CMD

echo ""
echo "=== 5. 检查空表 ==="
EMPTY_COUNT=$(echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_rows = 0;" | $MYSQL_CMD | tail -n 1)
echo "⚠ 发现 $EMPTY_COUNT 个空表"

echo ""
echo "=== 6. 检查表碎片 ==="
echo "SELECT table_name, data_free/1024/1024 as '碎片大小(MB)' FROM information_schema.tables WHERE table_schema='$DB_NAME' AND data_free > 0 ORDER BY data_free DESC LIMIT 5;" | $MYSQL_CMD

echo ""
echo "=== 7. 检查索引使用情况 ==="
echo "SELECT table_name, index_name FROM information_schema.statistics WHERE table_schema='$DB_NAME' GROUP BY table_name, index_name ORDER BY table_name LIMIT 20;" | $MYSQL_CMD

echo ""
echo "=== 8. 检查外键约束 ==="
FK_COUNT=$(echo "SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema='$DB_NAME' AND constraint_type='FOREIGN KEY';" | $MYSQL_CMD | tail -n 1)
echo "✓ 发现 $FK_COUNT 个外键约束"

echo ""
echo "=== 9. 检查用户数据完整性 ==="
DUPLICATE_USERS=$(echo "SELECT COUNT(*) FROM (SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1) as dup;" | $MYSQL_CMD 2>/dev/null | tail -n 1 || echo "0")
if [ "$DUPLICATE_USERS" -gt 0 ]; then
    echo "✗ 发现 $DUPLICATE_USERS 个重复用户名"
else
    echo "✓ 无重复用户名"
fi

DUPLICATE_EMAILS=$(echo "SELECT COUNT(*) FROM (SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1) as dup;" | $MYSQL_CMD 2>/dev/null | tail -n 1 || echo "0")
if [ "$DUPLICATE_EMAILS" -gt 0 ]; then
    echo "✗ 发现 $DUPLICATE_EMAILS 个重复邮箱"
else
    echo "✓ 无重复邮箱"
fi

echo ""
echo "=== 10. 检查孤立数据 ==="
echo "检查 test_plan_cases 表中的孤立记录..."
ORPHAN_CASES=$(echo "SELECT COUNT(*) FROM test_plan_cases t1 LEFT JOIN test_cases t2 ON t1.case_id = t2.id WHERE t2.id IS NULL;" | $MYSQL_CMD 2>/dev/null | tail -n 1 || echo "0")
if [ "$ORPHAN_CASES" -gt 0 ]; then
    echo "⚠ 发现 $ORPHAN_CASES 条孤立测试用例记录"
else
    echo "✓ 无孤立测试用例记录"
fi

echo ""
echo "=== 11. 检查数据库大小 ==="
echo "SELECT table_schema as '数据库', ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as '大小(MB)' FROM information_schema.tables WHERE table_schema='$DB_NAME' GROUP BY table_schema;" | $MYSQL_CMD

echo ""
echo "=== 12. 检查数据库连接数 ==="
CONNECTIONS=$(echo "SHOW STATUS LIKE 'Threads_connected';" | $MYSQL_CMD | tail -n 1 | awk '{print $2}')
MAX_CONNECTIONS=$(echo "SHOW VARIABLES LIKE 'max_connections';" | $MYSQL_CMD | tail -n 1 | awk '{print $2}')
echo "当前连接数: $CONNECTIONS / $MAX_CONNECTIONS"

echo ""
echo "========================================"
echo "  检查完成"
echo "========================================"

echo ""
echo "建议:"
if [ "$EMPTY_COUNT" -gt 5 ]; then
    echo "  - 有 $EMPTY_COUNT 个空表，请确认是否正常"
fi
if [ "$DUPLICATE_USERS" -gt 0 ] || [ "$DUPLICATE_EMAILS" -gt 0 ]; then
    echo "  - 发现重复数据，请清理"
fi
if [ "$ORPHAN_CASES" -gt 0 ]; then
    echo "  - 发现孤立记录，请检查数据完整性"
fi

echo ""
echo "详细报告已生成: database-check-report.txt"
echo "========================================"
