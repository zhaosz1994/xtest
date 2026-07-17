#!/bin/bash

# ==================== xTest Docker 离线部署启动脚本 ====================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker 未安装，请先安装 Docker"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker 服务未运行，请先启动 Docker 服务"
        exit 1
    fi
}

load_images() {
    log_info "正在加载 Docker 镜像..."
    
    if [ -f "images/xtest-app.tar" ]; then
        docker load -i images/xtest-app.tar
        log_info "xtest-app 镜像加载完成"
    else
        log_error "未找到 xtest-app.tar 镜像文件"
        exit 1
    fi
    
    if [ -f "images/mysql.tar" ]; then
        docker load -i images/mysql.tar
        log_info "MySQL 镜像加载完成"
    else
        log_warn "未找到 mysql.tar 镜像文件，将从网络拉取"
        docker pull mysql:8.0
    fi
}

setup_env() {
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            log_info "未找到 .env 文件，正在从 .env.example 复制..."
            cp .env.example .env
            log_warn "请编辑 .env 文件修改数据库密码和 JWT 密钥！"
        else
            log_error "未找到 .env.example 文件"
            exit 1
        fi
    fi
}

start_services() {
    log_info "正在启动服务..."
    docker-compose -f docker-compose.offline.yml up -d
    
    log_info "等待服务启动..."
    sleep 10
    
    log_info "服务状态："
    docker-compose -f docker-compose.offline.yml ps
}

show_info() {
    echo ""
    echo "=========================================="
    echo "  xTest 部署完成！"
    echo "=========================================="
    echo ""
    echo "  访问地址: http://localhost:8000"
    echo ""
    echo "  查看日志: docker-compose -f docker-compose.offline.yml logs -f"
    echo "  停止服务: ./stop.sh"
    echo ""
    echo "=========================================="
}

main() {
    log_info "开始部署 xTest..."
    
    check_docker
    load_images
    setup_env
    start_services
    show_info
}

main "$@"
