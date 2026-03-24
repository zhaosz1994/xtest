@echo off
echo Stopping CTCSDK Testplan backend server...
taskkill /F /IM node.exe > nul 2>&1
if %errorlevel% equ 0 (
    echo Server stopped successfully!
) else (
    echo No Node.js processes found, server may already be stopped.
)
echo Operation completed.