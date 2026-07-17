#!/bin/bash

# ==================== xTest 回滚脚本 ====================
# 用法: ./rollback.sh [环境] [备份名称]
# 环境: staging | production
# 示例: ./rollback.sh production backup_20240101_120000

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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
DEPLOY_ENV=${1:-"staging"}
BACKUP_NAME=$2

# 根据环境设置变量
if [ "$DEPLOY_ENV" == "production" ]; then
    DEPLOY_DIR="/var/www/xtest"
    BACKUP_DIR="/var/backups/xtest"
    PM2_APP_NAME="xtest"
else
    DEPLOY_DIR="/var/www/xtest-staging"
    BACKUP_DIR="/var/backups/xtest-staging"
    PM2_APP_NAME="xtest-staging"
fi

log_info "=========================================="
log_info "开始回滚 $DEPLOY_ENV 环境"
log_info "=========================================="

# 列出可用备份
log_info "可用的备份列表:"
cd $BACKUP_DIR
ls -dt backup_* | head -10

# 如果没有指定备份名称，使用最新的备份
if [ -z "$BACKUP_NAME" ]; then
    BACKUP_NAME=$(ls -dt backup_* | head -1)
    log_info "未指定备份，将使用最新备份: $BACKUP_NAME"
fi

BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

# 检查备份是否存在
if [ ! -d "$BACKUP_PATH" ]; then
    log_error "备份不存在: $BACKUP_PATH"
    exit 1
fi

log_warning "即将回滚到: $BACKUP_PATH"
read -p "确认回滚? (y/n): " confirm

if [ "$confirm" != "y" ]; then
    log_info "回滚已取消"
    exit 0
fi

# 停止服务
log_info "停止服务..."
pm2 stop $PM2_APP_NAME

# 恢复文件
log_info "恢复文件..."
cp -r $BACKUP_PATH/* $DEPLOY_DIR/

# 重启服务
log_info "重启服务..."
pm2 start $PM2_APP_NAME
pm2 save

# 健康检查
log_info "执行健康检查..."
sleep 5

if curl -sf http://localhost:3000/health > /dev/null; then
    log_success "健康检查通过！"
else
    log_error "健康检查失败！"
    pm2 logs $PM2_APP_NAME --lines 50
    exit 1
fi

log_success "=========================================="
log_success "回滚完成！"
log_success "=========================================="
