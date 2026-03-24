@echo off
echo 启动 CTCSDK Testplan 后端服务器...
echo ================================

:: 定义 Node.js 和 npm 的绝对路径
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_EXE=C:\Program Files\nodejs\npm.cmd"

:: 检查是否安装了 Node.js
echo 1. 检查 Node.js 安装状态...
"%NODE_EXE%" -v
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
    "%NPM_EXE%" install
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

:: 直接使用绝对路径启动服务器
echo 3. 启动服务器...
"%NODE_EXE%" server.js

pause