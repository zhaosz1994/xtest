@echo off
echo 测试 Node.js 绝对路径...
echo ================================

:: 使用引号包裹路径，避免空格问题
set "NODE_EXE=""C:\Program Files\nodejs\node.exe"""
set "NPM_EXE=""C:\Program Files\nodejs\npm.cmd"""

echo 测试 Node.js 版本:
%NODE_EXE% -v

echo 测试 npm 版本:
%NPM_EXE% -v

pause