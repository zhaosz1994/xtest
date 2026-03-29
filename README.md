# xTest - 测试管理平台

<div align="center">

!\[Version]\(https\://img.shields.io/badge/version-1.0.0-blue.svg null)
!\[License]\(https\://img.shields.io/badge/license-MIT-green.svg null)
!\[Node]\(https\://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg null)
!\[MySQL]\(https\://img.shields.io/badge/mysql-%3E%3D5.7-orange.svg null)

一个专业的测试管理平台，为开发者和测试工程师提供完整的测试计划、测试用例、测试执行和测试报告管理功能。

[在线演示](#) · [功能特性](#功能特性) · [快速开始](#快速开始) · [文档](#文档)

</div>

***

## 📖 目录

- [系统概述](#系统概述)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [配置说明](#配置说明)
- [API 文档](#api-文档)
- [部署指南](#部署指南)
- [开发指南](#开发指南)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

***

## 系统概述

xTest 是一个功能完善的测试管理平台，支持：

- 📋 **测试计划管理** - 创建、执行、跟踪测试计划
- 🧪 **测试用例库** - 多层级用例管理，支持多种测试类型
- 📊 **测试报告** - 自动生成测试报告，支持多种格式导出
- 👥 **团队协作** - 用户权限管理，实时协作
- 🔔 **实时通知** - WebSocket 实时推送
- 📈 **数据可视化** - 测试进度、通过率等数据可视化展示

***

## 功能特性

### 核心功能

| 模块       | 功能    | 描述                |
| -------- | ----- | ----------------- |
| **测试计划** | 计划管理  | 创建、编辑、删除测试计划      |
| <br />   | 状态跟踪  | 未开始、进行中、已完成、延期等状态 |
| <br />   | 进度统计  | 实时统计测试进度和通过率      |
| **用例库**  | 多级结构  | 库 → 模块 → 测试点 → 用例 |
| <br />   | 用例类型  | 功能、性能、兼容性、安全测试    |
| <br />   | 导入导出  | 支持 Excel 导入导出     |
| **测试报告** | 自动生成  | 日报、周报、最终报告        |
| <br />   | 模板管理  | 自定义报告模板           |
| <br />   | 多格式导出 | 支持 Markdown、PDF   |
| **配置中心** | 用户管理  | 角色权限管理            |
| <br />   | 项目配置  | 项目信息管理            |
| <br />   | 环境配置  | 测试环境管理            |
| **社区功能** | 论坛系统  | 技术讨论、经验分享         |
| <br />   | @提及   | 支持 @提及用户          |
| <br />   | 通知系统  | 实时消息通知            |

### 高级特性

- ✅ **Token 自动刷新** - 无感知的登录状态保持
- ✅ **实时通信** - 基于 WebSocket 的实时协作
- ✅ **邮件通知** - 测试结果邮件推送
- ✅ **AI 集成** - 支持 AI 辅助测试
- ✅ **回收站** - 误删数据恢复

***

## 技术栈

### 前端技术

- **HTML5** - 语义化结构
- **CSS3** - 现代化样式，响应式设计
- **JavaScript (ES6+)** - 原生 JavaScript，无框架依赖
- **Chart.js** - 数据可视化

### 后端技术

- **Node.js** - JavaScript 运行时
- **Express** - Web 框架
- **MySQL** - 关系型数据库
- **Socket.io** - 实时通信
- **JWT** - 身份认证

### 开发工具

- **PM2** - 进程管理
- **Nodemon** - 开发热重载
- **ESLint** - 代码规范

***

## 快速开始

### 环境要求

- Node.js >= 14.0.0
- MySQL >= 5.7
- npm >= 6.0.0

### 安装步骤

1. **克隆项目**

```bash
git clone https://github.com/zhaosz1994/xtest.git
cd xtest
```

1. **安装依赖**

```bash
npm install
```

1. **配置环境变量**

复制 `.env.example` 为 `.env` 并修改配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 数据库配置
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=xtest_db

# JWT 密钥（请使用强随机字符串）
JWT_SECRET=your_jwt_secret_key_here

# 服务器配置
PORT=3000
NODE_ENV=development
```

1. **启动服务**

开发模式（推荐）：

```bash
npm run dev
```

生产模式：

```bash
npm start
```

使用 PM2 管理：

```bash
npm run pm2:start
```

1. **访问系统**

打开浏览器访问：<http://localhost:3000>

**默认账号**：

- 管理员：`admin` / `admin123`
- 测试人员：`tester1` / `tester123`

***

## 项目结构

```
xtest/
├── 📁 docs/                    # 文档目录
│   ├── API_DOCUMENTATION.md    # API 文档
│   ├── DEPLOYMENT.md           # 部署指南
│   └── SYSTEM_DOCUMENTATION.md # 系统文档
├── 📁 routes/                  # API 路由
│   ├── aiSkills.js             # AI 技能路由
│   ├── chips.js                # 芯片管理路由
│   ├── projects.js             # 项目管理路由
│   ├── testplans.js            # 测试计划路由
│   ├── testpoints.js           # 测试点路由
│   └── users.js                # 用户管理路由
├── 📁 services/                # 业务服务
│   ├── emailService.js         # 邮件服务
│   └── reportService.js        # 报告服务
├── 📁 public/                  # 静态资源
│   ├── css/                    # 样式文件
│   ├── js/                     # 前端脚本
│   └── uploads/                # 上传文件
├── 📁 logs/                    # 日志目录
├── 📁 uploads/                 # 上传文件
├── 📄 index.html               # 前端入口
├── 📄 script.js                # 前端主脚本
├── 📄 server.js                # 后端入口
├── 📄 styles.css               # 主样式文件
├── 📄 package.json             # 项目配置
└── 📄 .env.example             # 环境变量示例
```

***

## 配置说明

### 数据库配置

系统启动时会自动创建所需的数据表。数据库配置在 `.env` 文件中：

```env
DB_HOST=localhost      # 数据库主机
DB_USER=root           # 数据库用户
DB_PASSWORD=password   # 数据库密码
DB_NAME=xtest_db # 数据库名称
```

### JWT 配置

JWT 密钥用于用户认证，请使用强随机字符串：

```bash
# 生成随机密钥
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 邮件配置（可选）

如需邮件通知功能，配置 SMTP：

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_email@example.com
SMTP_PASS=your_email_password
```

***

## API 文档

详细的 API 文档请查看 [API\_DOCUMENTATION.md](docs/API_DOCUMENTATION.md)

### 主要 API 端点

| 模块     | 端点                      | 方法   | 描述   |
| ------ | ----------------------- | ---- | ---- |
| 用户     | `/api/users/login`      | POST | 用户登录 |
| <br /> | `/api/users/list`       | GET  | 用户列表 |
| 测试计划   | `/api/testplans/list`   | GET  | 计划列表 |
| <br /> | `/api/testplans/create` | POST | 创建计划 |
| 用例     | `/api/testcases/list`   | GET  | 用例列表 |
| <br /> | `/api/testcases/create` | POST | 创建用例 |
| 报告     | `/api/reports/generate` | POST | 生成报告 |

***

## 部署指南

详细的部署指南请查看 [DEPLOYMENT.md](docs/DEPLOYMENT.md)

### 生产环境部署

1. **安装 PM2**

```bash
npm install -g pm2
```

1. **启动服务**

```bash
npm run pm2:start
```

1. **查看日志**

```bash
npm run pm2:logs
```

1. **设置开机自启**

```bash
pm2 startup
pm2 save
```

***

## 开发指南

### 代码规范

- 使用 ESLint 进行代码检查
- 遵循 JavaScript Standard Style
- 提交前请运行 `npm run lint`

### 分支管理

- `main` - 生产分支
- `develop` - 开发分支
- `feature/*` - 功能分支
- `bugfix/*` - 修复分支

### 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 代码重构
test: 测试相关
chore: 构建/工具相关
```

***

## 常见问题

### 1. 数据库连接失败

**原因**：数据库配置错误或 MySQL 服务未启动

**解决**：

- 检查 `.env` 文件中的数据库配置
- 确保 MySQL 服务已启动
- 检查数据库用户权限

### 2. 端口被占用

**原因**：3000 端口已被其他程序占用

**解决**：

```bash
# 查找占用端口的进程
lsof -i :3000

# 修改 .env 中的 PORT 配置
PORT=3001
```

### 3. Token 过期

**原因**：JWT Token 已过期

**解决**：系统已实现自动刷新，刷新页面即可

### 4. 文件上传失败

**原因**：上传目录权限不足

**解决**：

```bash
chmod -R 755 uploads/
```

***

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

***

## 更新日志

### v1.0.0 (2024-01-01)

- ✨ 初始版本发布
- ✅ 核心功能实现
- 📝 完整文档

### v1.1.0 (2024-03-01)

- ✨ 添加 Token 自动刷新
- 🎨 优化 UI 界面
- 🐛 修复筛选功能

### v1.2.0 (2024-03-23)

- ✨ 添加社区功能
- 🎨 邮件配置页面优化
- 🐛 修复状态筛选问题

***

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

***

## 联系方式

- 项目主页：<https://github.com/yourusername/xtest>
- 问题反馈：<https://github.com/yourusername/xtest/issues>
- 邮箱：<your.email@example.com>

***

<div align="center">

**⭐ 如果这个项目对你有帮助，请给一个 Star ⭐**

Made with ❤️ by xTest Team

</div>
