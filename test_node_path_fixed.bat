@echo off
echo 测试 Node.js 绝对路径...
echo ================================

:: 正确使用引号
echo 测试 Node.js 版本:
"C:\Program Files\nodejs\node.exe" -v

echo 测试 npm 版本:
"C:\Program Files\nodejs\npm.cmd" -v

pause