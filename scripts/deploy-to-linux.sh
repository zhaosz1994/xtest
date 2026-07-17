#!/bin/bash

echo "========================================"
echo "AI安全访问控制 - Linux服务器增量部署"
echo "========================================"
echo ""

SERVER_USER=${SERVER_USER:-"root"}
SERVER_HOST=${SERVER_HOST:-""}
SERVER_PORT=${SERVER_PORT:-"22"}
PROJECT_PATH=${PROJECT_PATH:-"/var/www/xtest"}

if [ -z "$SERVER_HOST" ]; then
    echo "错误: 请设置服务器地址"
    echo "示例: export SERVER_HOST='your-server-ip'"
    exit 1
fi

echo "服务器配置:"
echo "  主机: $SERVER_HOST"
echo "  用户: $SERVER_USER"
echo "  项目路径: $PROJECT_PATH"
echo ""

read -p "确认开始部署？: " confirm
if [ "$confirm" != "y" ]; then
    echo "已取消部署"
    exit 0
fi

echo ""
echo "步骤1: 上传新增文件..."
echo "----------------------------------------"

# 上传新增文件
rsync -avz --progress \
  routes/aiOperationLogs.js \
  services/sqlSecurityValidator.js \
  services/dataIsolationMiddleware.js \
  services/aiAuditLogger.js \
  services/apiKeyEncryption.js \
  services/connectionPoolMonitor.js \
  db-ai-readonly.js \
  public/ai-operation-logs.html \
  scripts/deploy-ai-security-db.sh \
  scripts/manage-ai-logs-aging.js \
  scripts/ai-logs-aging-policy.sql \
  $SERVER_USER@$SERVER_HOST:$PROJECT_PATH/

echo "✓ 新增文件上传完成"

echo ""
echo "步骤2: 上传修改文件..."
echo "----------------------------------------"

# 上传修改文件
rsync -avz --progress \
  server.js \
  index.html \
  routes/aiSkills.js \
  $SERVER_USER@$SERVER_HOST:$PROJECT_PATH/

echo "✓ 修改文件上传完成"

echo ""
echo "步骤3: 在服务器上执行部署..."
echo "----------------------------------------"

ssh $SERVER_USER@$SERVER_HOST << 'ENDSSH'

cd /var/www/xtest

echo "安装依赖..."
npm install node-sql-parser --save

echo "生成API Key加密密钥..."
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "更新.env配置..."
if ! grep -q "AI_DB_USER" .env; then
    echo "" >> .env
    echo "# AI只读数据库用户配置" >> .env
    echo "AI_DB_USER=ai_readonly" >> .env
    echo "AI_DB_PASSWORD=AI_Readonly_2026_Secure!" >> .env
    echo "" >> .env
    echo "# API Key加密密钥" >> .env
    echo "API_KEY_ENCRYPTION_KEY=$ENCRYPTION_KEY" >> .env
    echo "✓ .env配置已更新"
else
    echo "✓ .env配置已存在"
fi

echo "执行数据库部署脚本..."
chmod +x scripts/deploy-ai-security-db.sh
export DB_PASSWORD=$(grep DB_PASSWORD .env | cut -d '=' -f2)
./scripts/deploy-ai-security-db.sh

echo "重启服务..."
pm2 restart ecosystem.config.js

echo "✓ 服务器部署完成"

ENDSSH

echo ""
echo "========================================"
echo "✓ 增量部署完成！"
echo "========================================"
echo ""
echo "访问地址: http://$SERVER_HOST:8000/ai-operation-logs.html"
echo ""
