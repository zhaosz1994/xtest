@echo off
echo 启动 CTCSDK Testplan 后端服务器...
echo ================================

:: 使用绝对路径执行命令
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_EXE=C:\Program Files\nodejs\npm.cmd"

:: 检查是否安装了 Node.js
%NODE_EXE% -v >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
) else (
    echo Node.js 已安装:
    %NODE_EXE% -v
)

:: 检查是否安装了依赖
if not exist node_modules (
    echo 正在安装依赖...
    %NPM_EXE% install
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
echo 正在启动服务器...
%NPM_EXE% start

pause