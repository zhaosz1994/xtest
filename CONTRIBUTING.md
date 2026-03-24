# 贡献指南

感谢你考虑为 xTest 做贡献！🎉

## 📋 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [问题反馈](#问题反馈)

---

## 行为准则

本项目采用贡献者公约作为行为准则。参与此项目即表示你同意遵守其条款。请阅读 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 了解详情。

---

## 如何贡献

### 报告 Bug

如果你发现了 bug，请通过 [GitHub Issues](https://github.com/yourusername/sdk_xtest/issues) 提交报告。提交前请：

1. 检查是否已有相同问题的 issue
2. 使用 issue 模板填写详细信息
3. 提供复现步骤和预期行为

### 建议新功能

欢迎提出新功能建议！请：

1. 在 Issues 中创建新 issue
2. 详细描述功能需求和使用场景
3. 说明为什么这个功能对项目有帮助

### 提交代码

#### 1. Fork 项目

点击右上角 "Fork" 按钮，将项目复制到你的账户。

#### 2. 克隆仓库

```bash
git clone https://github.com/your-username/xtest.git
cd xtest
```

#### 3. 创建分支

```bash
git checkout -b feature/your-feature-name
# 或
git checkout -b fix/your-bug-fix
```

#### 4. 安装依赖

```bash
npm install
```

#### 5. 进行开发

- 遵循[代码规范](#代码规范)
- 编写清晰的注释
- 添加必要的测试

#### 6. 提交更改

```bash
git add .
git commit -m "feat: 添加新功能描述"
```

#### 7. 推送到 GitHub

```bash
git push origin feature/your-feature-name
```

#### 8. 创建 Pull Request

1. 访问你 fork 的仓库
2. 点击 "New Pull Request"
3. 填写 PR 模板
4. 等待审核

---

## 开发流程

### 环境设置

1. 复制环境变量文件：
```bash
cp .env.example .env
```

2. 配置数据库：
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=ctcsdk_testplan
```

3. 启动开发服务器：
```bash
npm run dev
```

### 项目结构

```
sdk_xtest/
├── routes/          # API 路由
├── services/        # 业务逻辑
├── public/          # 静态资源
├── docs/            # 文档
├── tests/           # 测试文件
└── scripts/         # 工具脚本
```

### 测试

运行测试：
```bash
npm test
```

---

## 代码规范

### JavaScript

- 使用 ES6+ 语法
- 使用 2 空格缩进
- 使用单引号或双引号保持一致
- 函数和变量使用驼峰命名
- 常量使用大写字母和下划线
- 添加必要的注释

### 示例

```javascript
// 好的示例
const getUserById = async (userId) => {
  try {
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    return users[0] || null;
  } catch (error) {
    console.error('获取用户失败:', error);
    throw error;
  }
};

// 避免的示例
function get_user(user_id) {
  return pool.query('SELECT * FROM users WHERE id = ' + user_id);
}
```

### CSS

- 使用语义化的类名
- 遵循 BEM 命名规范
- 避免使用 `!important`
- 保持样式简洁

### HTML

- 使用语义化标签
- 添加必要的 ARIA 属性
- 保持结构清晰

---

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

### 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响代码运行的变动）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 增加测试
- `chore`: 构建过程或辅助工具的变动

### 示例

```bash
feat: 添加用户登录功能

- 实现 JWT 认证
- 添加登录页面
- 添加登出功能

Closes #123
```

```bash
fix: 修复测试计划筛选问题

修复状态筛选无法正确匹配中英文状态的 bug

Fixes #456
```

---

## 问题反馈

### 提交 Issue

1. 使用清晰的标题
2. 提供详细描述
3. 添加相关标签
4. 提供复现步骤（如果是 bug）

### Issue 模板

#### Bug 报告

```markdown
**Bug 描述**
清晰简洁地描述 bug

**复现步骤**
1. 进入 '...'
2. 点击 '....'
3. 滚动到 '....'
4. 看到错误

**预期行为**
描述你期望发生的事情

**截图**
如果适用，添加截图帮助解释问题

**环境信息:**
 - OS: [e.g. macOS, Windows]
 - Browser: [e.g. Chrome, Safari]
 - Version: [e.g. 22]

**其他信息**
添加关于问题的任何其他上下文
```

#### 功能请求

```markdown
**功能描述**
清晰简洁地描述你想要的功能

**问题背景**
描述这个功能要解决的问题

**建议方案**
描述你建议的解决方案

**替代方案**
描述你考虑过的替代方案

**其他信息**
添加关于功能请求的任何其他上下文或截图
```

---

## 代码审核

所有代码变更都需要经过审核：

1. 至少需要一位维护者批准
2. 通过所有自动化测试
3. 没有冲突
4. 遵循代码规范

---

## 许可证

提交代码即表示你同意你的代码将在 MIT 许可证下发布。

---

## 联系方式

如有任何问题，请通过以下方式联系：

- GitHub Issues: https://github.com/yourusername/xtest/issues
- Email: your.email@example.com

---

再次感谢你的贡献！❤️
