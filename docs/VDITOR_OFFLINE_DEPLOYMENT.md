# 内网部署 - Vditor编辑器本地化方案

## 问题背景

在内网环境中部署时，无法访问外网CDN（如 unpkg.com），导致Vditor编辑器无法正常加载。

## 解决方案

已将Vditor编译文件下载到本地 `public/vditor/dist` 目录，所有引用已改为本地路径。

## 文件结构

```
public/
└── vditor/
    └── dist/
        ├── index.min.js          # 主JS文件
        ├── index.css             # 主样式文件
        ├── js/                   # 依赖的JS库
        │   ├── highlight.js/     # 代码高亮
        │   ├── katex/           # 数学公式
        │   ├── lute/            # Markdown解析
        │   ├── markmap/         # 思维导图
        │   ├── mathjax/         # 数学公式
        │   ├── mermaid/         # 流程图
        │   └── ...
        ├── images/              # 图片资源
        └── css/                 # 样式文件
```

## 修改的文件

### HTML文件
- `public/post-edit.html` - 编辑帖子页面
- `public/post-create.html` - 创建帖子页面

修改内容：
```html
<!-- CSS引用 -->
<link rel="stylesheet" href="/vditor/dist/index.css" />

<!-- JS引用 -->
<script src="/vditor/dist/index.min.js"></script>
```

### JavaScript文件
- `public/js/post-edit.js`
- `public/js/post-create.js`

修改内容：
```javascript
PostEdit.vditor = new Vditor('vditor', {
    cdn: '/vditor',  // 改为本地路径
    height: 400,
    // ... 其他配置
});
```

## 部署步骤

### 1. 确认文件已存在
```bash
ls -la public/vditor/dist/
# 应该看到 index.min.js, index.css 等文件
```

### 2. 部署到服务器
将整个 `public/vditor` 目录上传到服务器：
```bash
# 方式1: 使用scp
scp -r public/vditor user@server:/path/to/xtest/public/

# 方式2: 使用rsync
rsync -avz public/vditor/ user@server:/path/to/xtest/public/vditor/

# 方式3: 打包后上传
tar -czf vditor.tar.gz public/vditor
# 上传后解压
```

### 3. 验证部署
```bash
# 在服务器上检查文件
ls -la /path/to/xtest/public/vditor/dist/

# 检查文件权限
chmod -R 755 /path/to/xtest/public/vditor/
```

### 4. 重启服务
```bash
pm2 restart ctcsdk-testplan
# 或
npm run pm2:restart
```

### 5. 测试验证
访问论坛页面，尝试：
- 创建新帖子
- 编辑现有帖子
- 确认编辑器正常加载和显示

## 注意事项

### 1. 文件完整性
确保所有文件都已正确复制，特别是 `js/` 子目录下的依赖库：
```bash
# 检查关键文件
ls -lh public/vditor/dist/index.min.js
ls -lh public/vditor/dist/js/lute/lute.min.js
ls -lh public/vditor/dist/js/katex/katex.min.js
```

### 2. 文件权限
确保Web服务器有读取权限：
```bash
chmod -R 755 public/vditor/
chown -R www-data:www-data public/vditor/  # Ubuntu/Debian
# 或
chown -R nginx:nginx public/vditor/        # CentOS/RHEL
```

### 3. Web服务器配置
确保Express静态文件服务正确配置（已在server.js中配置）：
```javascript
app.use(express.static(path.join(__dirname, 'public')));
```

### 4. 文件大小
Vditor完整包约22.9MB，确保有足够的磁盘空间。

## 常见问题

### Q1: 编辑器无法加载，控制台报404错误
**原因**: 文件路径不正确或文件未上传

**解决**:
```bash
# 检查文件是否存在
ls -la public/vditor/dist/index.min.js

# 检查Web服务器配置
# 确保Express能正确提供静态文件
```

### Q2: 编辑器加载但样式错乱
**原因**: CSS文件未正确加载

**解决**:
```bash
# 检查CSS文件
ls -la public/vditor/dist/index.css

# 检查浏览器控制台是否有CSS加载错误
```

### Q3: 某些功能不工作（如数学公式、流程图）
**原因**: 依赖库文件缺失

**解决**:
```bash
# 检查依赖库目录
ls -la public/vditor/dist/js/

# 确保以下目录存在且不为空：
# - katex/
# - lute/
# - mermaid/
# - highlight.js/
```

### Q4: 如何更新Vditor版本
```bash
# 1. 下载新版本
npm pack vditor@<version>

# 2. 解压
tar -xzf vditor-<version>.tgz

# 3. 复制到public目录
cp -r package/dist/* public/vditor/dist/

# 4. 清理临时文件
rm -rf package vditor-<version>.tgz
```

## 文件大小参考

```
public/vditor/dist/
├── index.min.js          285 KB
├── index.css              43 KB
├── js/
│   ├── lute/             4.0 MB  (Markdown解析核心)
│   ├── mermaid/          2.7 MB  (流程图)
│   ├── mathjax/          2.5 MB  (数学公式)
│   ├── markmap/          824 KB  (思维导图)
│   ├── katex/            334 KB  (数学公式渲染)
│   └── highlight.js/     ~1 MB   (代码高亮)
└── images/               ~50 KB
总计约: 22.9 MB
```

## 性能优化建议

### 1. 启用Gzip压缩
在Nginx配置中：
```nginx
gzip on;
gzip_types text/css application/javascript application/json;
gzip_min_length 1024;
```

### 2. 启用浏览器缓存
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|woff|woff2|ttf)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. CDN加速（如果有内网CDN）
可以将vditor目录部署到内网CDN，修改HTML和JS中的路径即可。

## 验证清单

- [ ] public/vditor/dist/ 目录存在
- [ ] index.min.js 文件存在且大小正确（~285KB）
- [ ] index.css 文件存在且大小正确（~43KB）
- [ ] js/ 子目录存在且包含所有依赖库
- [ ] 文件权限正确（755）
- [ ] Web服务器能访问静态文件
- [ ] 编辑器在浏览器中正常加载
- [ ] 编辑器功能正常（工具栏、预览、上传等）

## 相关文档

- [Vditor官方文档](https://b3log.org/vditor/)
- [Vditor GitHub](https://github.com/Vanessa219/vditor)
- [问题修复部署说明](./BUG_FIX_DEPLOYMENT.md)
