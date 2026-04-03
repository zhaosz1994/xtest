#!/bin/bash

# ==================== xTest 数据库迁移脚本 ====================
# 用法: ./migrate-database.sh [环境] [操作]
# 环境: staging | production
# 操作: migrate | rollback | status
# 示例: ./migrate-database.sh production migrate

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
DEPLOY_ENV=${1:-"staging"}
ACTION=${2:-"migrate"}
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 根据环境设置数据库配置
if [ "$DEPLOY_ENV" == "production" ]; then
    DB_HOST=${DB_HOST:-"localhost"}
    DB_PORT=${DB_PORT:-"3306"}
    DB_NAME=${DB_NAME:-"xtest_db"}
    DB_USER=${DB_USER:-"root"}
    MIGRATION_TABLE="schema_migrations"
else
    DB_HOST=${DB_HOST:-"localhost"}
    DB_PORT=${DB_PORT:-"3306"}
    DB_NAME=${DB_NAME:-"xtest_db_staging"}
    DB_USER=${DB_USER:-"root"}
    MIGRATION_TABLE="schema_migrations"
fi

log_info "=========================================="
log_info "数据库迁移工具"
log_info "环境: $DEPLOY_ENV"
log_info "数据库: $DB_NAME"
log_info "操作: $ACTION"
log_info "=========================================="

# 检查 mysql 命令是否存在
if ! command -v mysql &> /dev/null; then
    log_error "MySQL 客户端未安装"
    exit 1
fi

# 创建迁移记录表
create_migration_table() {
    log_info "创建迁移记录表..."
    mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" <<EOF
CREATE TABLE IF NOT EXISTS $MIGRATION_TABLE (
    id INT PRIMARY KEY AUTO_INCREMENT,
    migration_name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rollback_script TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
EOF
    log_success "迁移记录表已就绪"
}

# 检查迁移是否已执行
is_migration_executed() {
    local migration_name=$1
    local count=$(mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -B \
        -e "SELECT COUNT(*) FROM $MIGRATION_TABLE WHERE migration_name = '$migration_name'")
    return $count
}

# 记录迁移
record_migration() {
    local migration_name=$1
    local rollback_script=$2
    mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" <<EOF
INSERT INTO $MIGRATION_TABLE (migration_name, rollback_script) 
VALUES ('$migration_name', '$rollback_script');
EOF
}

# 删除迁移记录
remove_migration_record() {
    local migration_name=$1
    mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" <<EOF
DELETE FROM $MIGRATION_TABLE WHERE migration_name = '$migration_name';
EOF
}

# 备份数据库
backup_database() {
    log_info "备份数据库..."
    BACKUP_DIR="./backups"
    mkdir -p $BACKUP_DIR
    BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_backup_${TIMESTAMP}.sql"
    
    mysqldump -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        "$DB_NAME" > "$BACKUP_FILE"
    
    log_success "数据库已备份到: $BACKUP_FILE"
    
    # 保留最近10个备份
    cd $BACKUP_DIR
    ls -dt ${DB_NAME}_backup_*.sql | tail -n +11 | xargs -r rm -f
    log_info "已清理旧备份，保留最近10个"
}

# 执行迁移
execute_migrations() {
    log_info "开始执行数据库迁移..."
    
    create_migration_table
    
    # 定义迁移列表（按顺序执行）
    declare -a migrations=(
        "add_review_feature.sql"
        "add_multi_reviewer.sql"
    )
    
    for migration in "${migrations[@]}"; do
        if [ ! -f "migrations/$migration" ]; then
            log_warning "迁移文件不存在: migrations/$migration"
            continue
        fi
        
        if is_migration_executed "$migration"; then
            log_info "迁移已执行，跳过: $migration"
            continue
        fi
        
        log_info "执行迁移: $migration"
        
        # 执行迁移脚本
        if mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < "migrations/$migration"; then
            # 提取回滚脚本
            rollback_script=$(sed -n '/^\/\*/,/\*\//p' "migrations/$migration" | sed '1d;$d' | sed "s/'/\\\'/g" | tr '\n' ' ')
            
            # 记录迁移
            record_migration "$migration" "$rollback_script"
            
            log_success "迁移完成: $migration"
        else
            log_error "迁移失败: $migration"
            exit 1
        fi
    done
    
    log_success "所有迁移已完成！"
}

# 回滚迁移
rollback_migrations() {
    log_warning "开始回滚数据库迁移..."
    
    # 获取已执行的迁移（倒序）
    executed_migrations=$(mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -B \
        -e "SELECT migration_name, rollback_script FROM $MIGRATION_TABLE ORDER BY id DESC")
    
    if [ -z "$executed_migrations" ]; then
        log_info "没有需要回滚的迁移"
        return
    fi
    
    while IFS=$'\t' read -r migration_name rollback_script; do
        log_warning "回滚迁移: $migration_name"
        
        # 执行回滚脚本
        if echo "$rollback_script" | mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME"; then
            # 删除迁移记录
            remove_migration_record "$migration_name"
            log_success "已回滚: $migration_name"
        else
            log_error "回滚失败: $migration_name"
            exit 1
        fi
    done <<< "$executed_migrations"
    
    log_success "所有迁移已回滚！"
}

# 查看迁移状态
show_migration_status() {
    log_info "迁移状态:"
    mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e \
        "SELECT migration_name, executed_at FROM $MIGRATION_TABLE ORDER BY id"
}

# 主流程
case "$ACTION" in
    migrate)
        backup_database
        execute_migrations
        ;;
    rollback)
        log_warning "⚠️  回滚操作将撤销所有已执行的迁移！"
        read -p "确认回滚? (yes/no): " confirm
        if [ "$confirm" == "yes" ]; then
            backup_database
            rollback_migrations
        else
            log_info "回滚已取消"
        fi
        ;;
    status)
        show_migration_status
        ;;
    *)
        log_error "未知操作: $ACTION"
        echo "用法: $0 [环境] [migrate|rollback|status]"
        exit 1
        ;;
esac
