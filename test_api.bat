@echo off
echo 测试 CTCSDK Testplan 后端 API 响应...
echo ================================

:: 测试健康检查 API
echo 1. 测试健康检查 API...
curl -X GET http://localhost:3000/health
echo.

:: 测试获取模块列表 API
echo 2. 测试获取模块列表 API...
curl -X GET http://localhost:3000/api/modules
echo.

:: 测试获取用户列表 API
echo 3. 测试获取用户列表 API...
curl -X GET http://localhost:3000/api/users
echo.

pause