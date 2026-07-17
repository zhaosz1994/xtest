#!/bin/bash

# ==================== xTest Docker 离线部署停止脚本 ====================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

stop_services() {
    log_info "正在停止服务..."
    docker-compose -f docker-compose.offline.yml down
    log_info "服务已停止"
}

remove_data() {
    read -p "是否删除数据卷（数据库数据将丢失）？[y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "正在删除数据卷..."
        docker-compose -f docker-compose.offline.yml down -v
        log_info "数据卷已删除"
    fi
}

main() {
    stop_services
    read -p "是否删除数据卷？[y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        remove_data
    fi
    log_info "部署已完全停止"
}

main "$@"
