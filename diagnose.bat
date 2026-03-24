@echo off
echo 诊断 CTCSDK Testplan 后端服务器问题...
echo ================================

:: 检查是否安装了 Node.js
echo 1. 检查 Node.js 安装状态...
node -v
if %errorlevel% neq 0 (
    echo 错误: 未安装 Node.js，请先安装 Node.js
    pause
    exit /b 1
) else (
    echo Node.js 已安装
)

:: 检查 npm 版本
echo 2. 检查 npm 版本...
npm -v
if %errorlevel% neq 0 (
    echo 错误: npm 未安装
    pause
    exit /b 1
) else (
    echo npm 已安装
)

:: 检查依赖是否已安装
echo 3. 检查依赖安装状态...
if not exist node_modules (
    echo 依赖未安装，开始安装依赖...
    npm install --verbose
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

:: 检查数据库连接
echo 4. 检查数据库连接...
echo 请确保 MySQL 服务已启动，并且数据库配置正确
echo 数据库配置:
echo - 主机: localhost
echo - 用户: root
echo - 密码: zsz12345
echo - 数据库: ctcsdk_testplan
pause

:: 尝试启动服务器（使用详细模式）
echo 5. 尝试启动服务器...
npm start --verbose

pause