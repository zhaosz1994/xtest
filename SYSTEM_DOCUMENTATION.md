# xTest 测试管理系统文档

## 系统概述

xTest 是一个专业的测试管理系统，基于 Web 技术构建，提供了完整的测试计划、测试用例、测试执行和测试报告管理功能。系统采用前后端分离架构，前端使用 HTML5、CSS3 和 JavaScript 实现，后端使用 Node.js、Express 和 MySQL 实现。

## 系统功能

### 1. 测试概览
- 显示测试模块数量、测试点总数、最近修改时间、总通过率等关键指标
- 提供各模块测试通过率、测试状态分布、各芯片测试通过率和芯片测试点数量分布等图表
- 支持实时数据更新

### 2. 测试计划管理
- 创建、编辑、删除测试计划
- 按状态筛选测试计划（我负责的、未完成的、已完成的）
- 查看测试计划详情和关联的测试用例
- 测试计划状态跟踪（未开始、进行中、已完成、阻塞）

### 3. 用例库管理
- 管理功能测试、性能测试、兼容性测试和安全测试等多种类型的测试用例
- 支持按优先级、状态等筛选测试用例
- 提供用例的创建、编辑、删除和执行功能
- 支持用例导入/导出功能

### 4. 测试报告管理
- 创建、编辑、删除测试报告
- 关联测试报告与测试计划、项目和迭代
- 支持日报、周报和最终报告等多种报告类型
- 提供测试报告列表和详情查看功能

### 5. 配置中心
- 系统设置（系统名称、管理员邮箱、系统语言等）
- 用户管理（添加、编辑、删除用户，分配角色）
- 项目配置（添加、编辑、删除项目）
- 测试环境配置（添加、编辑、删除测试环境）
- 集成配置（JIRA、Jenkins 等外部系统集成）

### 6. 实时通信
- 基于 WebSocket 的实时通信
- 在线用户状态显示
- 实时测试点更新通知
- 实时模块更新通知

## 技术架构

### 前端技术栈
- HTML5 语义化结构
- CSS3 响应式设计
- JavaScript ES6+ 特性
- Chart.js 数据可视化
- Socket.io 实时通信

### 后端技术栈
- Node.js 运行环境
- Express 框架
- MySQL 数据库
- Socket.io 实时通信
- JWT 身份认证
- Bcrypt 密码加密

### 数据库设计
- users: 用户表
- modules: 模块表
- level1_points: 一级测试点表
- level2_points: 二级测试点表
- chips: 芯片表
- testpoint_chips: 测试点芯片关联表
- testpoint_status: 测试点状态表
- history: 历史记录表
- history_snapshots: 历史快照表
- test_plans: 测试计划表
- test_reports: 测试报告表

## 系统部署

### 环境要求
- Node.js 14.0+
- MySQL 5.7+
- npm 6.0+

### 安装步骤
1. 克隆代码仓库
2. 运行 `install_deps.bat` 安装依赖
3. 配置 `.env` 文件中的数据库连接信息
4. 运行 `start.bat` 启动系统

### 数据库初始化
系统启动时会自动检查数据库是否存在，不存在则创建。同时会创建必要的表结构和默认管理员用户。

默认管理员账号：
- 用户名: admin
- 密码: ctc@2026.

## 系统使用指南

### 1. 登录系统
1. 打开浏览器，访问 `http://localhost:3000`
2. 输入用户名和密码
3. 点击登录按钮

### 2. 创建测试计划
1. 点击左侧导航栏中的 "测试计划"
2. 点击页面右上角的 "+" 按钮
3. 选择 "新建测试计划"
4. 填写测试计划名称、负责人、状态、测试阶段等信息
5. 点击 "创建" 按钮

### 3. 管理测试用例
1. 点击左侧导航栏中的 "用例库"
2. 点击页面右上角的 "+" 按钮
3. 选择 "新建用例"
4. 填写用例名称、测试步骤、预期结果等信息
5. 点击 "创建" 按钮

### 4. 执行测试
1. 点击左侧导航栏中的 "测试计划"
2. 选择一个测试计划
3. 在测试用例列表中，点击 "执行" 按钮
4. 填写测试结果和备注
5. 点击 "提交" 按钮

### 5. 生成测试报告
1. 点击左侧导航栏中的 "测试报告"
2. 点击页面右上角的 "+" 按钮
3. 选择 "新建测试报告"
4. 填写报告名称、创建人、关联项目、关联测试计划等信息
5. 点击 "创建" 按钮

### 6. 系统配置
1. 点击左侧导航栏中的 "配置中心"
2. 根据需要修改系统设置、用户管理、项目配置等
3. 点击 "保存设置" 按钮

## API 接口文档

### 认证接口
- POST /api/users/login - 用户登录
- POST /api/users/register - 用户注册

### 测试计划接口
- GET /api/testplans/list - 获取测试计划列表
- POST /api/testplans/create - 创建测试计划
- PUT /api/testplans/update/:id - 更新测试计划
- DELETE /api/testplans/delete/:id - 删除测试计划
- GET /api/testplans/detail/:id - 获取测试计划详情

### 测试报告接口
- GET /api/reports/list - 获取测试报告列表
- POST /api/reports/create - 创建测试报告
- PUT /api/reports/update/:id - 更新测试报告
- DELETE /api/reports/delete/:id - 删除测试报告
- GET /api/reports/detail/:id - 获取测试报告详情

### 用户接口
- GET /api/users/list - 获取用户列表
- POST /api/users/add - 添加用户
- PUT /api/users/edit/:id - 编辑用户
- DELETE /api/users/delete/:id - 删除用户

### 模块接口
- GET /api/modules/list - 获取模块列表
- POST /api/modules/add - 添加模块
- PUT /api/modules/edit/:id - 编辑模块
- DELETE /api/modules/delete/:id - 删除模块

### 测试点接口
- GET /api/testpoints/list - 获取测试点列表
- POST /api/testpoints/add - 添加测试点
- PUT /api/testpoints/edit/:id - 编辑测试点
- DELETE /api/testpoints/delete/:id - 删除测试点
- POST /api/testpoints/executetest - 执行测试

### 芯片接口
- GET /api/chips/list - 获取芯片列表
- POST /api/chips/add - 添加芯片
- PUT /api/chips/edit/:id - 编辑芯片
- DELETE /api/chips/delete/:id - 删除芯片

### 历史记录接口
- GET /api/history - 获取历史记录
- POST /api/history/add - 添加历史记录

### 快照接口
- GET /api/snapshots/list - 获取快照列表
- POST /api/snapshots/restore - 恢复快照

### Excel 导入/导出接口
- POST /api/excel/import - 导入 Excel 文件
- GET /api/excel/export - 导出 Excel 文件

## 系统维护

### 数据库备份
建议定期备份 MySQL 数据库，以防止数据丢失。可以使用以下命令进行备份：

```bash
mysqldump -u [用户名] -p [数据库名] > backup.sql
```

### 日志管理
系统运行日志会输出到控制台，建议在生产环境中配置日志文件存储。

### 性能优化
- 定期清理历史数据和快照数据
- 优化数据库查询，添加适当的索引
- 增加服务器内存和 CPU 资源
- 使用 CDN 加速静态资源加载

## 常见问题

### 1. 系统无法启动
- 检查 Node.js 是否安装正确
- 检查 MySQL 服务是否运行
- 检查数据库连接配置是否正确
- 检查端口 3000 是否被占用

### 2. 无法登录系统
- 检查用户名和密码是否正确
- 检查网络连接是否正常
- 检查后端服务是否运行

### 3. 测试计划无法创建
- 检查表单数据是否填写完整
- 检查网络连接是否正常
- 检查后端服务是否运行

### 4. 图表无法显示
- 检查浏览器是否支持 Canvas
- 检查网络连接是否正常
- 检查 Chart.js 是否加载成功

### 5. 实时通知不工作
- 检查网络连接是否正常
- 检查 WebSocket 服务是否运行
- 检查浏览器是否支持 WebSocket

## 版本历史

- v1.0.0 (2026-01-14) - 系统初始化，实现基本功能
- v1.0.1 (2026-01-15) - 优化用户体验，修复已知问题
- v1.0.2 (2026-01-16) - 增加数据可视化功能，完善 API 接口

## 联系方式

如有问题或建议，请联系系统管理员：
- 邮箱：admin@example.com
- 电话：123-456-7890

## 许可证

本系统采用 MIT 许可证，详见 LICENSE 文件。