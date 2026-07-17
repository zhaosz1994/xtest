#!/bin/bash

# ==================== xTest Docker 离线部署包构建脚本 ====================
# 此脚本需要在安装了 Docker 的环境中运行

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$SCRIPT_DIR/deploy-offline"
IMAGES_DIR="$OUTPUT_DIR/images"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker 未安装，请先安装 Docker"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker 服务未运行，请先启动 Docker 服务"
        exit 1
    fi
    
    log_info "Docker 环境检查通过"
}

prepare_dirs() {
    log_step "准备目录结构..."
    
    mkdir -p "$IMAGES_DIR"
    mkdir -p "$OUTPUT_DIR/init-sql"
    
    log_info "目录创建完成"
}

build_app_image() {
    log_step "构建应用镜像..."
    
    cd "$PROJECT_ROOT"
    docker build -t xtest-app:latest .
    
    log_info "应用镜像构建完成"
}

pull_mysql_image() {
    log_step "拉取 MySQL 镜像..."
    
    docker pull mysql:8.0
    
    log_info "MySQL 镜像拉取完成"
}

export_images() {
    log_step "导出镜像文件..."
    
    log_info "导出 xtest-app 镜像..."
    docker save -o "$IMAGES_DIR/xtest-app.tar" xtest-app:latest
    
    log_info "导出 MySQL 镜像..."
    docker save -o "$IMAGES_DIR/mysql.tar" mysql:8.0
    
    log_info "镜像导出完成"
    
    ls -lh "$IMAGES_DIR"
}

copy_config_files() {
    log_step "复制配置文件..."
    
    cp "$PROJECT_ROOT/docker-compose.offline.yml" "$OUTPUT_DIR/"
    
    if [ -d "$PROJECT_ROOT/backups" ] && [ "$(ls -A $PROJECT_ROOT/backups 2>/dev/null)" ]; then
        cp "$PROJECT_ROOT"/backups/*.sql "$OUTPUT_DIR/init-sql/" 2>/dev/null || true
    fi
    
    log_info "配置文件复制完成"
}

create_package() {
    log_step "创建部署包..."
    
    cd "$(dirname "$OUTPUT_DIR")"
    
    PACKAGE_NAME="xtest-docker-deploy-$(date +%Y%m%d_%H%M%S).tar.gz"
    tar -czf "$PACKAGE_NAME" deploy-offline
    
    log_info "部署包创建完成: $PACKAGE_NAME"
    
    ls -lh "$PACKAGE_NAME"
}

show_summary() {
    echo ""
    echo "=========================================="
    echo "  构建完成！"
    echo "=========================================="
    echo ""
    echo "  镜像文件:"
    ls -lh "$IMAGES_DIR"
    echo ""
    echo "  部署包位置:"
    echo "  $(dirname "$OUTPUT_DIR")/xtest-docker-deploy-*.tar.gz"
    echo ""
    echo "  部署方法:"
    echo "  1. 将部署包传输到目标服务器"
    echo "  2. 解压: tar -xzf xtest-docker-deploy-*.tar.gz"
    echo "  3. 进入目录: cd deploy-offline"
    echo "  4. 配置环境: cp .env.example .env && vi .env"
    echo "  5. 启动服务: ./start.sh"
    echo ""
    echo "=========================================="
}

main() {
    echo ""
    echo "=========================================="
    echo "  xTest Docker 离线部署包构建"
    echo "=========================================="
    echo ""
    
    check_docker
    prepare_dirs
    build_app_image
    pull_mysql_image
    export_images
    copy_config_files
    create_package
    show_summary
}

main "$@"
