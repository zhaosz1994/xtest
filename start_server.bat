@echo off
echo 启动 CTCSDK Testplan 后端服务器...
echo ================================

:: 切换到项目目录
cd /d "%~dp0"

:: 检查是否安装了依赖
if not exist "node_modules" (
    echo 正在安装依赖...
    npm install
    if %errorlevel% neq 0 (
        echo 错误: 依赖安装失败
        pause
        exit /b 1
    )
)

:: 启动服务器
echo 正在启动服务器...
node server.js

pause