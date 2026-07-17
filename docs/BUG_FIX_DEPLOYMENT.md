# 问题修复部署说明

## 修复的问题

### 1. ✅ Vditor编辑器在Linux部署后的错误
**问题**: `Cannot read properties of undefined (reading 'Md2VditorIRDOM')`

**原因**: 本地缺少Vditor的编译文件

**修复**: 
- 下载Vditor编译文件到本地 `public/vditor/dist` 目录
- 修改了 `public/post-edit.html` 和 `public/post-create.html`
- 修改了 `public/js/post-edit.js` 和 `public/js/post-create.js`
- 所有引用改为本地路径 `/vditor/dist/`

**影响的文件**:
- `public/vditor/dist/` (新增目录，包含所有编译文件)
- `public/post-edit.html`
- `public/post-create.html`
- `public/js/post-edit.js`
- `public/js/post-create.js`

**详细说明**: 参见 [Vditor离线部署文档](./VDITOR_OFFLINE_DEPLOYMENT.md)

---

### 2. ✅ Excel导出文件格式问题
**问题**: 导出的Excel文件格式有问题，文件大小不对

**原因**: Excel列宽设置不匹配，headers有19列但列宽只设置了15列

**修复**: 
- 修改了 `routes/excel.js` 中的列宽设置
- 添加了缺失的4列列宽配置

**影响的文件**:
- `routes/excel.js`

---

### 3. ✅ AI分析超时问题
**问题**: AI分析超时时间设置为60秒，需要改为600秒

**修复**: 
- 修改了 `routes/reports.js` 中的超时时间
- 从60000ms（60秒）改为600000ms（600秒）
- 更新了错误日志信息

**影响的文件**:
- `routes/reports.js`

---

### 4. ✅ 数据库字段缺失问题
**问题**: `Unknown column 'ai_analysis_failed' in 'field list'`

**原因**: test_reports表缺少 ai_analysis_failed 字段

**修复**: 
- 创建了SQL迁移文件：`migrations/add_ai_analysis_failed_simple.sql`
- 创建了部署脚本：`scripts/add-ai-analysis-field.sh`

**新增文件**:
- `migrations/add_ai_analysis_failed_simple.sql`
- `scripts/add-ai-analysis-field.sh`

---

### 5. ⚠️ HTTP附件下载警告
**问题**: 文件通过HTTP加载，浏览器建议使用HTTPS

**说明**: 这是一个浏览器安全警告，不是代码错误

**解决方案**:
- 代码已使用相对路径，这是正确的做法
- 要消除此警告，需要在服务器配置HTTPS证书
- 可以使用Nginx反向代理配置SSL证书

**配置示例（Nginx）**:
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# HTTP重定向到HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 部署步骤

### 1. 更新代码
```bash
# 拉取最新代码
git pull

# 或者手动复制修改的文件到服务器
```

### 2. 部署Vditor文件（重要！）
```bash
# 确保Vditor文件已上传到服务器
ls -la /path/to/xtest/public/vditor/dist/

# 如果文件不存在，需要从本地复制
# 方式1: 使用scp
scp -r public/vditor user@server:/path/to/xtest/public/

# 方式2: 使用rsync
rsync -avz public/vditor/ user@server:/path/to/xtest/public/vditor/

# 设置权限
chmod -R 755 /path/to/xtest/public/vditor/
```

### 3. 执行数据库迁移
```bash
# 方式1: 使用部署脚本（推荐）
cd /data03/users/sdk/www/xtest/xtest
chmod +x scripts/add-ai-analysis-field.sh
./scripts/add-ai-analysis-field.sh

# 方式2: 手动执行SQL
mysql -h<DB_HOST> -u<DB_USER> -p<DB_PASSWORD> <DB_NAME> < migrations/add_ai_analysis_failed_simple.sql

# 方式3: 登录MySQL后执行
mysql -h<DB_HOST> -u<DB_USER> -p<DB_PASSWORD> <DB_NAME>
source migrations/add_ai_analysis_failed_simple.sql
```

### 4. 重启服务
```bash
# 使用PM2重启
pm2 restart ctcsdk-testplan

# 或者使用npm脚本
npm run pm2:restart

# 或者直接重启Node进程
pkill -f "node server.js"
npm start
```

### 5. 验证修复
```bash
# 1. 检查Vditor编辑器
# 访问论坛页面，尝试创建或编辑帖子，确认编辑器正常加载

# 2. 测试Excel导出
# 导出测试用例，检查Excel文件是否正常打开

# 3. 测试AI分析
# 创建测试报告并执行AI分析，确认不会超时

# 4. 检查数据库字段
mysql -h<DB_HOST> -u<DB_USER> -p<DB_PASSWORD> <DB_NAME> -e "DESC test_reports;"
# 应该能看到 ai_analysis_failed 字段
```

---

## 注意事项

1. **Vditor本地化**: 已将Vditor编译文件部署到本地，无需访问外网。确保 `public/vditor/dist/` 目录已正确上传到服务器。

2. **AI分析超时**: 600秒的超时时间适用于大多数情况，但如果AI模型响应特别慢，可能需要进一步调整

3. **HTTPS配置**: 强烈建议在生产环境配置HTTPS，以提高安全性

4. **数据库备份**: 执行数据库迁移前，建议先备份数据库

---

## 文件修改清单

### 修改的文件
- `public/post-edit.html`
- `public/post-create.html`
- `public/js/post-edit.js`
- `public/js/post-create.js`
- `routes/excel.js`
- `routes/reports.js`

### 新增的文件
- `public/vditor/dist/` (Vditor编译文件目录，约22.9MB)
- `migrations/add_ai_analysis_failed_simple.sql`
- `scripts/add-ai-analysis-field.sh`
- `docs/VDITOR_OFFLINE_DEPLOYMENT.md`

---

## 如有问题

如果部署后仍有问题，请检查：
1. 浏览器控制台是否有错误信息
2. 服务器日志：`pm2 logs ctcsdk-testplan`
3. 数据库连接是否正常
4. Vditor文件是否正确部署：`ls -la public/vditor/dist/`
5. 文件权限是否正确：`chmod -R 755 public/vditor/`
