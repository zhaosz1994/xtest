@echo off
echo 简单诊断 Node.js 安装状态...
echo ================================

:: 手动检查常见的 Node.js 安装路径
echo 1. 检查常见的 Node.js 安装路径...

if exist "C:\Program Files\nodejs\node.exe" (
    echo 找到 Node.js 安装路径: C:\Program Files\nodejs
    echo 测试 Node.js 版本:
    "C:\Program Files\nodejs\node.exe" -v
    echo 测试 npm 版本:
    "C:\Program Files\nodejs\npm.cmd" -v
    goto :End
)

if exist "C:\Program Files (x86)\nodejs\node.exe" (
    echo 找到 Node.js 安装路径: C:\Program Files (x86)\nodejs
    echo 测试 Node.js 版本:
    "C:\Program Files (x86)\nodejs\node.exe" -v
    echo 测试 npm 版本:
    "C:\Program Files (x86)\nodejs\npm.cmd" -v
    goto :End
)

if exist "%USERPROFILE%\AppData\Local\nodejs\node.exe" (
    echo 找到 Node.js 安装路径: %USERPROFILE%\AppData\Local\nodejs
    echo 测试 Node.js 版本:
    "%USERPROFILE%\AppData\Local\nodejs\node.exe" -v
    echo 测试 npm 版本:
    "%USERPROFILE%\AppData\Local\nodejs\npm.cmd" -v
    goto :End
)

echo 未找到 Node.js 安装路径
echo 请手动检查 Node.js 的安装位置

:End
pause