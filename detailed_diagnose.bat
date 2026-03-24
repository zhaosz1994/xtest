@echo off
echo 详细诊断 CTCSDK Testplan 后端服务器问题...
echo ================================

:: 尝试找到 Node.js 安装路径
echo 1. 尝试找到 Node.js 安装路径...

:: 检查常见的 Node.js 安装路径
set "NODE_PATHS=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%USERPROFILE%\AppData\Local\nodejs"

for %%p in (%NODE_PATHS%) do (
    if exist "%%p\node.exe" (
        echo 找到 Node.js 安装路径: %%p
        set "NODE_EXE=%%p\node.exe"
        set "NPM_EXE=%%p\npm.cmd"
        goto :NodeFound
    )
)

:: 如果没有找到，尝试从注册表中获取
echo 2. 尝试从注册表中获取 Node.js 安装路径...
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Node.js" /v InstallPath 2^>nul ^| findstr InstallPath') do (
    set "NODE_PATH=%%b"
    if exist "%%b\node.exe" (
        echo 从注册表找到 Node.js 安装路径: %%b
        set "NODE_EXE=%%b\node.exe"
        set "NPM_EXE=%%b\npm.cmd"
        goto :NodeFound
    )
)

:: 如果仍然没有找到，提示用户
echo 错误: 未找到 Node.js 安装路径
echo 请确保 Node.js 已正确安装，并且添加到系统环境变量中
pause
exit /b 1

:NodeFound
:: 测试 Node.js 是否能够正常运行
echo 3. 测试 Node.js 是否能够正常运行...
"%NODE_EXE%" -v
if %errorlevel% neq 0 (
    echo 错误: Node.js 无法正常运行
    pause
    exit /b 1
) else (
    echo Node.js 运行正常
)

:: 测试 npm 是否能够正常运行
echo 4. 测试 npm 是否能够正常运行...
"%NPM_EXE%" -v
if %errorlevel% neq 0 (
    echo 错误: npm 无法正常运行
    pause
    exit /b 1
) else (
    echo npm 运行正常
)

:: 检查依赖是否已安装
echo 5. 检查依赖安装状态...
if not exist node_modules (
    echo 依赖未安装，开始安装依赖...
    "%NPM_EXE%" install --verbose
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
echo 6. 检查数据库连接...
echo 请确保 MySQL 服务已启动，并且数据库配置正确
echo 数据库配置:
echo - 主机: localhost
echo - 用户: root
echo - 密码: zsz12345
echo - 数据库: ctcsdk_testplan
pause

:: 尝试启动服务器（使用详细模式）
echo 7. 尝试启动服务器...
"%NPM_EXE%" start --verbose

pause