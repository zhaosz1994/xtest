#!/usr/bin/env bash
# ============================================================
# xtest Python 虚拟环境初始化脚本
# 在项目内部创建独立 venv，不依赖系统 Python 包安装
#
# 支持两种模式:
#   1. 在线安装（有外网环境）: bash scripts/setup_venv.sh
#   2. 离线安装（内网环境）:
#      a. 在外网机器执行: bash scripts/setup_venv.sh --download-packages
#      b. 将 python_packages/ 目录拷贝到内网服务器
#      c. 在内网执行: bash scripts/setup_venv.sh --offline
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$PROJECT_ROOT/venv"
REQUIREMENTS="$SCRIPT_DIR/cta_extensions/requirements.txt"
PKG_DIR="$SCRIPT_DIR/cta_extensions/python_packages"

# 解析参数
MODE="online"
if [ "$1" == "--offline" ]; then
    MODE="offline"
elif [ "$1" == "--download-packages" ]; then
    MODE="download"
fi

echo "=========================================="
echo " xtest Python 虚拟环境初始化"
echo " 模式: $MODE"
echo "=========================================="
echo "项目路径: $PROJECT_ROOT"
echo "venv 路径: $VENV_DIR"
echo "离线包目录: $PKG_DIR"
echo ""

# 检查 python3
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未找到 python3，请先安装 Python 3.8+"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1)
echo "[1/4] 检测到 Python: $PYTHON_VERSION"

# --download-packages 模式: 只下载 wheel 包，不创建 venv
if [ "$MODE" == "download" ]; then
    echo "[下载模式] 下载 paramiko 及所有依赖到 $PKG_DIR ..."
    mkdir -p "$PKG_DIR"
    pip3 download -r "$REQUIREMENTS" -d "$PKG_DIR"
    echo ""
    echo "=========================================="
    echo " 下载完成!"
    echo "=========================================="
    echo "包目录: $PKG_DIR"
    echo ""
    ls -la "$PKG_DIR"
    echo ""
    echo "请将整个 xtest 项目（包含 scripts/cta_extensions/python_packages/）"
    echo "拷贝到内网服务器，然后执行:"
    echo "  bash scripts/setup_venv.sh --offline"
    echo "=========================================="
    exit 0
fi

# 创建 venv
if [ -d "$VENV_DIR" ]; then
    echo "[2/4] venv 已存在，跳过创建"
else
    echo "[2/4] 创建虚拟环境..."
    python3 -m venv "$VENV_DIR"
    echo "      虚拟环境创建完成"
fi

# 激活 venv
if [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
elif [ -f "$VENV_DIR/Scripts/activate" ]; then
    source "$VENV_DIR/Scripts/activate"
else
    echo "[错误] 无法找到 venv 激活脚本"
    exit 1
fi

# 升级 pip
echo "[3/4] 升级 pip..."
pip install --upgrade pip --quiet 2>/dev/null || true

# 安装依赖
echo "[4/4] 安装依赖包 (模式: $MODE)..."
if [ "$MODE" == "offline" ]; then
    # 离线安装模式
    if [ ! -d "$PKG_DIR" ] || [ -z "$(ls -A "$PKG_DIR" 2>/dev/null)" ]; then
        echo "[错误] 离线包目录不存在或为空: $PKG_DIR"
        echo ""
        echo "请先在有网的机器上执行:"
        echo "  bash scripts/setup_venv.sh --download-packages"
        echo "然后将 python_packages/ 目录拷贝到内网服务器"
        exit 1
    fi
    echo "      从离线包目录安装..."
    echo "      包列表:"
    ls "$PKG_DIR"
    echo ""
    pip install --no-index --find-links="$PKG_DIR" -r "$REQUIREMENTS"
else
    # 在线安装模式
    echo "      在线安装..."
    pip install -r "$REQUIREMENTS" 2>&1 || {
        echo ""
        echo "[警告] 在线安装失败，可能是内网无法访问 PyPI"
        echo "[提示] 请使用离线安装模式:"
        echo "  1. 在外网机器执行: bash scripts/setup_venv.sh --download-packages"
        echo "  2. 将 python_packages/ 目录拷贝到内网服务器"
        echo "  3. 在内网执行: bash scripts/setup_venv.sh --offline"
        exit 1
    }
fi

# 验证安装
echo ""
echo "=========================================="
echo " 验证安装"
echo "=========================================="
python3 -c "import paramiko; print(f'paramiko 版本: {paramiko.__version__}')" 2>/dev/null && \
    echo "[成功] Python 环境就绪" || \
    { echo "[失败] paramiko 导入失败"; exit 1; }

echo ""
echo "venv 路径: $VENV_DIR/bin/python"
echo "Node.js 会自动使用此路径，无需额外配置"
echo "=========================================="
