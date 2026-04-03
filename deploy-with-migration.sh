#!/bin/bash

# ==================== xTest 完整部署脚本（含数据库迁移）====================
# 用法: ./deploy-with-migration.sh [环境]
# 环境: staging | production
# 示例: ./deploy-with-migration.sh production

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 配置变量
APP_NAME="xtest"
DEPLOY_ENV=${1:-"staging"}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 根据环境设置变量
if [ "$DEPLOY_ENV" == "production" ]; then
    DEPLOY_DIR="/var/www/xtest"
    BACKUP_DIR="/var/backups/xtest"
    PM2_APP_NAME="xtest"
    BRANCH="main"
    DB_NAME="xtest_db"
else
    DEPLOY_DIR="/var/www/xtest-staging"
    BACKUP_DIR="/var/backups/xtest-staging"
    PM2_APP_NAME="xtest-staging"
    BRANCH="develop"
    DB_NAME="xtest_db_staging"
fi

log_info "=========================================="
log_info "开始完整部署 $APP_NAME 到 $DEPLOY_ENV 环境"
log_info "部署目录: $DEPLOY_DIR"
log_info "数据库: $DB_NAME"
log_info "时间: $TIMESTAMP"
log_info "=========================================="

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    log_error "请在项目根目录运行此脚本"
    exit 1
fi

# 步骤1: 拉取最新代码
log_info "步骤1: 拉取最新代码..."
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

# 步骤2: 创建备份
log_info "步骤2: 创建备份..."
mkdir -p $BACKUP_DIR
if [ -d "$DEPLOY_DIR" ]; then
    BACKUP_PATH="$BACKUP_DIR/backup_$TIMESTAMP"
    cp -r $DEPLOY_DIR $BACKUP_PATH
    log_success "备份已创建: $BACKUP_PATH"
    
    # 保留最近5个备份
    cd $BACKUP_DIR
    ls -dt backup_* | tail -n +6 | xargs -r rm -rf
    log_info "已清理旧备份，保留最近5个"
fi

# 步骤3: 执行数据库迁移
log_info "步骤3: 执行数据库迁移..."
if [ -f "migrate-database.sh" ]; then
    ./migrate-database.sh $DEPLOY_ENV migrate
    if [ $? -eq 0 ]; then
        log_success "数据库迁移完成"
    else
        log_error "数据库迁移失败，停止部署"
        exit 1
    fi
else
    log_warning "未找到数据库迁移脚本，跳过数据库迁移"
fi

# 步骤4: 安装依赖
log_info "步骤4: 安装依赖..."
npm ci --production
log_success "依赖安装完成"

# 步骤5: 运行测试（可选）
log_info "步骤5: 运行测试..."
if [ -f "__tests__/setup.js" ]; then
    npm test || log_warning "测试未通过，但继续部署"
else
    log_warning "未找到测试文件，跳过测试"
fi

# 步骤6: 检查环境配置
log_info "步骤6: 检查环境配置..."
if [ ! -f ".env" ]; then
    log_warning ".env 文件不存在，请确保已配置环境变量"
fi

# 步骤7: 使用PM2重启服务
log_info "步骤7: 重启PM2服务..."

# 检查PM2是否已安装
if ! command -v pm2 &> /dev/null; then
    log_error "PM2 未安装，请先安装: npm install -g pm2"
    exit 1
fi

# 检查应用是否已运行
if pm2 describe $PM2_APP_NAME > /dev/null 2>&1; then
    log_info "应用已运行，正在重启..."
    pm2 restart $PM2_APP_NAME
else
    log_info "应用未运行，正在启动..."
    pm2 start ecosystem.config.js --env $DEPLOY_ENV
fi

pm2 save

log_success "PM2 服务已重启"

# 步骤8: 健康检查
log_info "步骤8: 执行健康检查..."
sleep 5

HEALTH_URL="http://localhost:3000/health"
if curl -sf $HEALTH_URL > /dev/null; then
    log_success "健康检查通过！"
else
    log_error "健康检查失败，请检查应用状态"
    pm2 logs $PM2_APP_NAME --lines 50
    exit 1
fi

# 步骤9: 显示状态
log_info "步骤9: 显示应用状态..."
pm2 status

# 步骤10: 数据库迁移状态
log_info "步骤10: 检查数据库迁移状态..."
if [ -f "migrate-database.sh" ]; then
    ./migrate-database.sh $DEPLOY_ENV status
fi

# 完成
log_success "=========================================="
log_success "完整部署完成！"
log_success "环境: $DEPLOY_ENV"
log_success "分支: $BRANCH"
log_success "时间: $TIMESTAMP"
log_success "=========================================="

# 显示访问地址
if [ "$DEPLOY_ENV" == "production" ]; then
    log_info "访问地址: http://xtest.example.com"
else
    log_info "访问地址: http://staging.xtest.example.com"
fi

# 显示日志命令
log_info "查看日志: pm2 logs $PM2_APP_NAME"
log_info "查看迁移状态: ./migrate-database.sh $DEPLOY_ENV status"
log_info "回滚迁移: ./migrate-database.sh $DEPLOY_ENV rollback"
