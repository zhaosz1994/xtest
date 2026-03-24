@echo off
echo 启动 CTCSDK Testplan 后端服务器...
echo ================================

:: 检查是否安装了 Node.js
echo 1. 检查 Node.js 安装状态...
"C:\Program Files\nodejs\node.exe" -v
if %errorlevel% neq 0 (
    echo 错误: 未安装 Node.js，请先安装 Node.js
    pause
    exit /b 1
) else (
    echo Node.js 已安装
)

:: 检查依赖是否已安装
echo 2. 检查依赖安装状态...
if not exist node_modules (
    echo 依赖未安装，开始安装依赖...
    "C:\Program Files\nodejs\npm.cmd" install
    if %errorlevel% neq 0 (
        echo 错误: 依赖安装失败
        pause
        exit /b 1
    ) else (
        echo 依赖安装成功
    )
) else (
    echo 依赖已安装
)

:: 启动服务器
echo 3. 启动服务器...
"C:\Program Files\nodejs\npm.cmd" start

pause