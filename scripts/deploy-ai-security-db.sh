#!/bin/bash

echo "========================================"
echo "AI安全访问控制 - 数据库增量部署脚本"
echo "========================================"
echo ""

# 自动加载.env文件
if [ -f ".env" ]; then
    echo "✓ 检测到 .env 文件，正在加载配置..."
    export $(cat .env | grep -v '^#' | xargs)
    echo "✓ 配置加载完成"
    echo ""
fi

# 从.env或环境变量读取配置
DB_HOST=${DB_HOST:-${DB_HOST:-"127.0.0.1"}}
DB_USER=${DB_USER:-${DB_USER:-"root"}}
DB_NAME=${DB_NAME:-${DB_NAME:-"xtest"}}
DB_SOCKET=${DB_SOCKET:-${DB_SOCKET:-""}}
DB_PASSWORD=${DB_PASSWORD:-${DB_PASSWORD:-""}}

if [ -z "$DB_PASSWORD" ]; then
    echo "错误: 未找到数据库密码配置"
    echo ""
    echo "解决方案："
    echo "1. 在 .env 文件中添加: DB_PASSWORD='your_password'"
    echo "2. 或设置环境变量: export DB_PASSWORD='your_password'"
    echo ""
    exit 1
fi

echo "数据库配置:"
echo "  主机: ${DB_SOCKET:-$DB_HOST}"
echo "  数据库: $DB_NAME"
echo "  用户: $DB_USER"
echo ""

read -p "确认继续部署？: " confirm
if [ "$confirm" != "y" ]; then
    echo "已取消部署"
    exit 0
fi

echo ""
echo "步骤1: 创建AI只读数据库用户"
echo "----------------------------------------"

MYSQL_CMD="mysql"
if [ -n "$DB_SOCKET" ]; then
    MYSQL_CMD="mysql --socket=$DB_SOCKET"
else
    MYSQL_CMD="mysql --host=$DB_HOST"
fi

$MYSQL_CMD --user="$DB_USER" --password="$DB_PASSWORD" --database="$DB_NAME" <<EOF
-- 创建AI只读用户（如果不存在）
CREATE USER IF NOT EXISTS 'ai_readonly'@'%' IDENTIFIED BY 'AI_Readonly_2026_Secure!';

-- 撤销所有现有权限
REVOKE ALL PRIVILEGES ON *.* FROM 'ai_readonly'@'%';

-- 授予SELECT权限
GRANT SELECT ON $DB_NAME.* TO 'ai_readonly'@'%';

-- 刷新权限
FLUSH PRIVILEGES;

-- 验证用户权限
SHOW GRANTS FOR 'ai_readonly'@'%';
EOF

if [ $? -eq 0 ]; then
    echo "✓ AI只读用户创建成功"
else
    echo "✗ AI只读用户创建失败"
    exit 1
fi

echo ""
echo "步骤2: 创建审计日志表"
echo "----------------------------------------"

$MYSQL_CMD --user="$DB_USER" --password="$DB_PASSWORD" --database="$DB_NAME" <<EOF
-- 创建AI操作审计日志表
CREATE TABLE IF NOT EXISTS ai_operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
  user_id INT NOT NULL COMMENT '用户ID',
  username VARCHAR(100) COMMENT '用户名',
  skill_name VARCHAR(100) NOT NULL COMMENT '技能名称',
  skill_id INT COMMENT '技能ID',
  operation_type VARCHAR(20) NOT NULL COMMENT '操作类型（SELECT）',
  sql_query TEXT COMMENT '执行的SQL语句',
  sql_params TEXT COMMENT 'SQL参数（JSON格式）',
  tables_accessed VARCHAR(500) COMMENT '访问的表（逗号分隔）',
  result_count INT DEFAULT 0 COMMENT '返回结果数量',
  execution_time_ms INT COMMENT '执行耗时（毫秒）',
  status VARCHAR(20) NOT NULL DEFAULT 'success' COMMENT '执行状态（success/failed）',
  error_message TEXT COMMENT '错误信息',
  ip_address VARCHAR(50) COMMENT 'IP地址',
  user_agent VARCHAR(500) COMMENT '用户代理',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  
  INDEX idx_user_id (user_id),
  INDEX idx_skill_name (skill_name),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_operation_type (operation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI操作审计日志表';

-- 验证表创建
SHOW TABLES LIKE 'ai_operation_logs';
DESCRIBE ai_operation_logs;
EOF

if [ $? -eq 0 ]; then
    echo "✓ 审计日志表创建成功"
else
    echo "✗ 审计日志表创建失败"
    exit 1
fi

echo ""
echo "步骤3: 配置日志自动清理事件"
echo "----------------------------------------"

$MYSQL_CMD --user="$DB_USER" --password="$DB_PASSWORD" --database="$DB_NAME" <<EOF
-- 启用事件调度器
SET GLOBAL event_scheduler = ON;

-- 删除旧的事件（如果存在）
DROP EVENT IF EXISTS clean_old_ai_operation_logs;

-- 创建定期清理旧日志的事件（保留最近90天的日志）
CREATE EVENT clean_old_ai_operation_logs
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
DO
  DELETE FROM ai_operation_logs 
  WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- 验证事件创建
SHOW EVENTS LIKE 'clean_old_ai_operation_logs';
EOF

if [ $? -eq 0 ]; then
    echo "✓ 日志自动清理事件配置成功"
else
    echo "✗ 日志自动清理事件配置失败"
    exit 1
fi

echo ""
echo "步骤4: 创建日志归档表（可选）"
echo "----------------------------------------"

read -p "是否创建日志归档表？: " create_archive
if [ "$create_archive" = "y" ]; then
    $MYSQL_CMD --user="$DB_USER" --password="$DB_PASSWORD" --database="$DB_NAME" <<EOF
-- 创建归档表
CREATE TABLE IF NOT EXISTS ai_operation_logs_archive (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  username VARCHAR(100),
  skill_name VARCHAR(100) NOT NULL,
  skill_id INT,
  operation_type VARCHAR(20) NOT NULL,
  sql_query TEXT,
  sql_params TEXT,
  tables_accessed VARCHAR(500),
  result_count INT DEFAULT 0,
  execution_time_ms INT,
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  error_message TEXT,
  ip_address VARCHAR(50),
  user_agent VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at),
  INDEX idx_archived_at (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI操作日志归档表';

SHOW TABLES LIKE 'ai_operation_logs_archive';
EOF

    if [ $? -eq 0 ]; then
        echo "✓ 日志归档表创建成功"
    else
        echo "✗ 日志归档表创建失败"
    fi
else
    echo "⊘ 跳过创建日志归档表"
fi

echo ""
echo "========================================"
echo "✓ 数据库部署完成！"
echo "========================================"
echo ""
echo "后续步骤:"
echo "1. 在 .env 文件中添加以下配置:"
echo "   AI_DB_USER=ai_readonly"
echo "   AI_DB_PASSWORD=AI_Readonly_2026_Secure!"
echo "   API_KEY_ENCRYPTION_KEY=<运行下面的命令生成>"
echo ""
echo "2. 生成API Key加密密钥:"
echo "   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
echo ""
echo "3. 重启应用:"
echo "   pm2 restart ecosystem.config.js"
echo ""
echo "4. 访问AI操作日志页面:"
echo "   http://your-server:port/ai-operation-logs.html"
echo ""
