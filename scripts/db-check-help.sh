#!/bin/bash

cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║              数据库检查工具 - 快速使用指南                    ║
╚══════════════════════════════════════════════════════════════╝

📌 快速开始

1️⃣  配置数据库连接
   cp .env.example .env
   # 编辑 .env 文件,填写数据库信息

2️⃣  运行检查 (两种方式)

   方式A - Node.js版 (推荐,详细报告):
   node scripts/check-database.js

   方式B - Shell版 (快速检查):
   ./scripts/check-database.sh

📋 检查项目

✓ 表存在性        - 检查所有表是否存在
✓ 表结构          - 主键、索引、字段检查
✓ 索引            - 关键索引是否存在
✓ 外键约束        - 外键完整性和孤立记录
✓ 数据完整性      - 重复数据、必填字段
✓ 表统计          - 空表、大表、碎片
✓ 数据库健康      - 连接数、InnoDB状态
✓ 安全设置        - 用户权限、远程访问

📊 输出报告

- 控制台实时输出
- JSON格式详细报告 (database-check-report.json)
- 健康度评分 (0-100%)

🔧 常用命令

# 查看表大小
SELECT table_name, table_rows, 
       ROUND((data_length + index_length)/1024/1024, 2) as 'Size(MB)'
FROM information_schema.tables 
WHERE table_schema = 'xtest_db' 
ORDER BY table_rows DESC;

# 查看碎片
SELECT table_name, data_free/1024/1024 as 'Fragment(MB)'
FROM information_schema.tables 
WHERE table_schema = 'xtest_db' AND data_free > 0;

# 优化表
OPTIMIZE TABLE table_name;

# 查看连接数
SHOW STATUS LIKE 'Threads_connected';

⚠️  注意事项

- 生产环境建议在低峰期执行
- 工具只读取数据,不会修改
- 需要SELECT和SHOW VIEW权限

📚 详细文档

查看 docs/DATABASE_CHECK_GUIDE.md

EOF
