# 关联脚本功能设计文档

## 一、需求概述

### 1.1 功能背景

在测试用例详情页面中，需要在"测试内容"和"关联项目"两个标签页之间添加"关联脚本"标签页，用于管理测试用例关联的自动化测试脚本。

### 1.2 功能需求

1. 支持多个脚本的表格形式展示
2. 每个脚本条目包含：
   - 脚本名称（如 `sdk_fdb_func_xxx_xxx.tcl`）
   - 脚本类型（TCL/Python/Shell/其他）
   - 脚本描述
   - 源文件上传（可选）
   - 外部链接（可选，支持跳转到 GitLab 等页面）
3. 支持新增、编辑、删除操作
4. 支持文件上传和下载

### 1.3 扩展需求

1. 批量添加测试用例滑屉页面支持关联脚本编辑
2. 批量查看测试用例滑屉页面支持关联脚本显示和编辑
3. 全局搜索支持搜索脚本名称

---

## 二、影响分析

### 2.1 对现有功能的影响

**完全不影响现有功能**，具体分析如下：

| 层面 | 分析结论 |
|------|----------|
| 数据库 | 新建独立表，不修改现有表结构 |
| 后端API | 新增独立路由，不修改现有接口 |
| 前端组件 | 新增独立标签页，复用现有切换逻辑 |
| 业务逻辑 | 独立的功能模块，与现有功能解耦 |

### 2.2 数据一致性保证

```sql
-- 外键级联删除：删除测试用例时自动删除关联脚本
FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
```

---

## 三、数据库设计

### 3.1 新建表结构

```sql
CREATE TABLE IF NOT EXISTS test_case_scripts (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  test_case_id INT NOT NULL COMMENT '测试用例ID',
  script_name VARCHAR(255) NOT NULL COMMENT '脚本名称，如 sdk_fdb_func_xxx_xxx.tcl',
  script_type VARCHAR(50) DEFAULT 'tcl' COMMENT '脚本类型：tcl/py/sh/other',
  description TEXT COMMENT '脚本描述',
  file_path VARCHAR(500) COMMENT '上传文件的存储路径',
  file_size BIGINT COMMENT '文件大小（字节）',
  file_hash VARCHAR(64) COMMENT '文件MD5哈希值，用于去重',
  original_filename VARCHAR(255) COMMENT '原始文件名',
  link_url VARCHAR(1000) COMMENT '外部链接URL',
  link_title VARCHAR(255) COMMENT '链接显示标题',
  link_type VARCHAR(20) DEFAULT 'external' COMMENT '链接类型：external/gitlab/jira/other',
  order_index INT DEFAULT 0 COMMENT '排序序号',
  creator VARCHAR(50) NOT NULL COMMENT '创建人',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  INDEX idx_test_case_id (test_case_id),
  INDEX idx_script_type (script_type),
  INDEX idx_script_name (script_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试用例关联脚本表';
```

### 3.2 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | INT | 是 | 主键自增 |
| test_case_id | INT | 是 | 关联的测试用例ID |
| script_name | VARCHAR(255) | 是 | 脚本名称（必填） |
| script_type | VARCHAR(50) | 否 | 脚本类型，默认 tcl |
| description | TEXT | 否 | 脚本描述/备注 |
| file_path | VARCHAR(500) | 否 | 上传文件的存储路径 |
| file_size | BIGINT | 否 | 文件大小（字节） |
| file_hash | VARCHAR(64) | 否 | 文件MD5哈希，用于去重 |
| original_filename | VARCHAR(255) | 否 | 原始文件名 |
| link_url | VARCHAR(1000) | 否 | 外部链接URL |
| link_title | VARCHAR(255) | 否 | 链接显示标题 |
| link_type | VARCHAR(20) | 否 | 链接类型，默认 external |
| order_index | INT | 否 | 排序序号，默认 0 |
| creator | VARCHAR(50) | 是 | 创建人 |
| created_at | TIMESTAMP | 是 | 创建时间 |
| updated_at | TIMESTAMP | 是 | 更新时间 |

### 3.3 索引设计

| 索引名 | 字段 | 类型 | 用途 |
|--------|------|------|------|
| PRIMARY | id | 主键 | 主键索引 |
| idx_test_case_id | test_case_id | 普通 | 按用例ID查询脚本 |
| idx_script_type | script_type | 普通 | 按脚本类型筛选 |
| idx_script_name | script_name | 普通 | 全局搜索优化 |

---

## 四、后端API设计

### 4.1 API路由列表

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/testcases/:id/scripts` | 获取测试用例的关联脚本列表 | 登录用户 |
| POST | `/api/testcases/:id/scripts` | 添加关联脚本 | 登录用户 |
| GET | `/api/testcases/scripts/:scriptId` | 获取单个脚本详情 | 登录用户 |
| PUT | `/api/testcases/scripts/:scriptId` | 更新脚本信息 | 登录用户 |
| DELETE | `/api/testcases/scripts/:scriptId` | 删除关联脚本 | 登录用户 |
| POST | `/api/testcases/scripts/upload` | 上传脚本文件 | 登录用户 |
| GET | `/api/testcases/scripts/download/:scriptId` | 下载脚本文件 | 登录用户 |
| POST | `/api/testcases/scripts/batch` | 批量添加脚本 | 登录用户 |
| PUT | `/api/testcases/:id/scripts/order` | 更新脚本排序 | 登录用户 |

### 4.2 API详细设计

#### 4.2.1 获取关联脚本列表

```
GET /api/testcases/:id/scripts
```

**请求参数：** 无

**响应示例：**
```json
{
  "success": true,
  "scripts": [
    {
      "id": 1,
      "test_case_id": 123,
      "script_name": "sdk_fdb_func_basic_test.tcl",
      "script_type": "tcl",
      "description": "FDB基础功能测试脚本",
      "file_path": "/uploads/scripts/2026/04/abc123.tcl",
      "file_size": 10240,
      "original_filename": "sdk_fdb_func_basic_test.tcl",
      "link_url": "https://gitlab.xxx.com/test/sdk_fdb_func_basic_test.tcl",
      "link_title": "GitLab源码",
      "link_type": "gitlab",
      "order_index": 0,
      "creator": "admin",
      "created_at": "2026-04-03T10:00:00.000Z",
      "updated_at": "2026-04-03T10:00:00.000Z"
    }
  ],
  "total": 1
}
```

#### 4.2.2 添加关联脚本

```
POST /api/testcases/:id/scripts
```

**请求体：**
```json
{
  "script_name": "sdk_fdb_func_xxx.tcl",
  "script_type": "tcl",
  "description": "脚本描述",
  "file_path": "/uploads/scripts/xxx.tcl",
  "file_size": 10240,
  "original_filename": "sdk_fdb_func_xxx.tcl",
  "link_url": "https://xxx.com/script",
  "link_title": "脚本链接",
  "link_type": "external"
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "脚本添加成功",
  "script": {
    "id": 2,
    "script_name": "sdk_fdb_func_xxx.tcl",
    ...
  }
}
```

#### 4.2.3 上传脚本文件

```
POST /api/testcases/scripts/upload
Content-Type: multipart/form-data
```

**请求参数：**
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | 是 | 脚本文件 |

**响应示例：**
```json
{
  "success": true,
  "file": {
    "path": "/uploads/scripts/2026/04/abc123.tcl",
    "size": 10240,
    "hash": "md5hash...",
    "originalName": "sdk_fdb_func_xxx.tcl"
  }
}
```

#### 4.2.4 批量添加脚本

```
POST /api/testcases/scripts/batch
```

**请求体：**
```json
{
  "test_case_id": 123,
  "scripts": [
    {
      "script_name": "script1.tcl",
      "script_type": "tcl",
      "link_url": "https://xxx.com/script1"
    },
    {
      "script_name": "script2.py",
      "script_type": "py",
      "link_url": "https://xxx.com/script2"
    }
  ]
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "批量添加成功",
  "data": {
    "success_count": 2,
    "fail_count": 0,
    "scripts": [...]
  }
}
```

### 4.3 后端代码实现位置

新增路由文件：`routes/scripts.js`，或在 `routes/testcases.js` 中添加。

---

## 五、前端UI设计

### 5.1 测试用例详情页 - 标签页

#### 5.1.1 标签页位置

```
基本信息 | 测试内容 | 关联脚本 | 关联项目 | 执行记录 | 评审信息
                         ↑
                     新增位置
```

#### 5.1.2 标签页按钮HTML

```html
<button class="case-tab" data-tab="scripts">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
    </svg>
    关联脚本
</button>
```

#### 5.1.3 标签页内容HTML

```html
<!-- 关联脚本标签页 -->
<div class="case-tab-content" id="tab-scripts">
    <div class="form-card">
        <div class="form-card-header">
            <span class="form-card-icon">📜</span>
            <span>关联脚本</span>
            <button type="button" onclick="openAddScriptModal()" class="btn btn-sm btn-primary" style="margin-left: auto;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                添加脚本
            </button>
        </div>
        <div class="form-card-body">
            <!-- 脚本列表表格 -->
            <div class="scripts-table-container">
                <table class="scripts-table" id="scripts-table">
                    <thead>
                        <tr>
                            <th style="width: 40px;">#</th>
                            <th style="width: 250px;">脚本名称</th>
                            <th style="width: 80px;">类型</th>
                            <th>描述</th>
                            <th style="width: 120px;">源文件</th>
                            <th style="width: 150px;">链接</th>
                            <th style="width: 100px;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="scripts-table-body">
                        <!-- 动态渲染 -->
                    </tbody>
                </table>
                
                <!-- 空状态 -->
                <div class="scripts-empty" id="scripts-empty" style="display: none;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <polyline points="16 18 22 12 16 6"></polyline>
                        <polyline points="8 6 2 12 8 18"></polyline>
                    </svg>
                    <p>暂无关联脚本</p>
                    <button type="button" onclick="openAddScriptModal()" class="btn btn-sm btn-primary">添加脚本</button>
                </div>
            </div>
        </div>
    </div>
</div>
```

### 5.2 添加/编辑脚本弹窗

```html
<!-- 添加/编辑脚本弹窗 -->
<div class="modal" id="script-modal">
    <div class="modal-content" style="width: 600px;">
        <div class="modal-header">
            <h3 id="script-modal-title">添加关联脚本</h3>
            <button class="close-modal" onclick="closeScriptModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="script-form">
                <input type="hidden" id="script-id">
                <input type="hidden" id="script-file-path">
                <input type="hidden" id="script-file-size">
                <input type="hidden" id="script-original-filename">
                
                <div class="form-group">
                    <label class="form-label required">脚本名称</label>
                    <input type="text" id="script-name" class="form-input" placeholder="如：sdk_fdb_func_xxx_xxx.tcl" required>
                    <p class="form-hint">支持 .tcl, .py, .sh 等脚本文件</p>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">脚本类型</label>
                        <select id="script-type" class="form-select">
                            <option value="tcl">TCL</option>
                            <option value="py">Python</option>
                            <option value="sh">Shell</option>
                            <option value="other">其他</option>
                        </select>
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label">脚本描述</label>
                    <textarea id="script-description" class="form-textarea" rows="2" placeholder="脚本功能描述"></textarea>
                </div>
                
                <!-- 文件上传区域 -->
                <div class="form-group">
                    <label class="form-label">源文件上传</label>
                    <div class="file-upload-area" id="script-upload-area">
                        <input type="file" id="script-file-input" style="display: none;" accept=".tcl,.py,.sh,.txt,.json,.pl,.rb">
                        <div class="file-upload-content" onclick="document.getElementById('script-file-input').click()">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="17 8 12 3 7 8"></polyline>
                                <line x1="12" y1="3" x2="12" y2="15"></line>
                            </svg>
                            <p>点击上传或拖拽文件到此处</p>
                            <span class="file-upload-hint">支持 .tcl, .py, .sh 等格式</span>
                        </div>
                        <div class="file-upload-preview" id="script-file-preview" style="display: none;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                            <span id="script-file-name"></span>
                            <button type="button" class="btn-remove-file" onclick="removeScriptFile()">×</button>
                        </div>
                    </div>
                </div>
                
                <!-- 链接区域 -->
                <div class="form-group">
                    <label class="form-label">外部链接</label>
                    <div class="link-input-group">
                        <input type="url" id="script-link-url" class="form-input" placeholder="https://gitlab.xxx.com/xxx.tcl">
                        <input type="text" id="script-link-title" class="form-input" placeholder="链接标题（如：GitLab源码）" style="margin-top: 8px;">
                    </div>
                    <div class="link-type-selector" style="margin-top: 8px;">
                            <label class="radio-item">
                                <input type="radio" name="link-type" value="external" checked>
                                <span>外部链接</span>
                            </label>
                            <label class="radio-item">
                                <input type="radio" name="link-type" value="gitlab">
                                <span>GitLab</span>
                            </label>
                            <label class="radio-item">
                                <input type="radio" name="link-type" value="other">
                                <span>其他</span>
                            </label>
                        </div>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closeScriptModal()">取消</button>
            <button type="button" class="btn btn-primary" onclick="saveScript()">保存</button>
        </div>
    </div>
</div>
```

### 5.3 CSS样式

```css
/* ========================================
   关联脚本样式
   ======================================== */

/* 脚本表格样式 */
.scripts-table-container {
    overflow-x: auto;
}

.scripts-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
}

.scripts-table th,
.scripts-table td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid #e2e8f0;
}

.scripts-table th {
    background: #f8fafc;
    font-weight: 600;
    color: #475569;
    white-space: nowrap;
}

.scripts-table tbody tr:hover {
    background: #f8fafc;
}

.scripts-table .script-name {
    font-weight: 500;
    color: #1e293b;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
}

/* 脚本类型标签 */
.script-type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
}

.script-type-badge.tcl { 
    background: #dbeafe; 
    color: #1e40af; 
}

.script-type-badge.py { 
    background: #d1fae5; 
    color: #065f46; 
}

.script-type-badge.sh { 
    background: #fef3c7; 
    color: #92400e; 
}

.script-type-badge.other { 
    background: #f1f5f9; 
    color: #475569; 
}

/* 文件上传区域 */
.file-upload-area {
    border: 2px dashed #cbd5e1;
    border-radius: 8px;
    padding: 24px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: #fafafa;
}

.file-upload-area:hover {
    border-color: #3b82f6;
    background: #f0f9ff;
}

.file-upload-area.dragover {
    border-color: #3b82f6;
    background: #eff6ff;
}

.file-upload-content {
    color: #64748b;
}

.file-upload-content svg {
    margin-bottom: 8px;
    color: #94a3b8;
}

.file-upload-content p {
    margin: 8px 0 4px;
}

.file-upload-hint {
    font-size: 12px;
    color: #94a3b8;
}

.file-upload-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #f1f5f9;
    padding: 12px 16px;
    border-radius: 6px;
    margin-top: 12px;
}

.file-upload-preview svg {
    color: #64748b;
}

.file-upload-preview span {
    flex: 1;
    color: #475569;
    font-size: 14px;
}

.btn-remove-file {
    background: none;
    border: none;
    color: #ef4444;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
}

.btn-remove-file:hover {
    color: #dc2626;
}

/* 链接样式 */
.script-link {
    color: #3b82f6;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
}

.script-link:hover {
    text-decoration: underline;
    color: #2563eb;
}

/* 文件下载链接 */
.script-file-link {
    color: #059669;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
}

.script-file-link:hover {
    text-decoration: underline;
    color: #047857;
}

/* 链接类型选择器 */
.link-type-selector {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}

.link-type-selector .radio-item {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}

.link-type-selector .radio-item input[type="radio"] {
    margin: 0;
}

/* 空状态 */
.scripts-empty {
    text-align: center;
    padding: 48px 24px;
    color: #94a3b8;
}

.scripts-empty svg {
    margin-bottom: 16px;
    color: #cbd5e1;
}

.scripts-empty p {
    margin-bottom: 16px;
}

/* 操作按钮 */
.scripts-table .action-buttons {
    display: flex;
    gap: 8px;
}

.scripts-table .btn-icon {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: #64748b;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.scripts-table .btn-icon:hover {
    background: #f1f5f9;
    color: #475569;
}

.scripts-table .btn-icon.btn-danger:hover {
    background: #fef2f2;
    color: #dc2626;
}
```

---

## 六、扩展功能设计

### 6.1 批量添加测试用例滑屉页面

**文件位置：** `public/batch-create-cases.html` + `public/js/batch-create-cases.js`

**改动内容：** 在右侧滑屉的"关联信息"区域添加"关联脚本"部分。

#### 6.1.1 HTML改动位置

在 `batch-create-cases.html` 的 `#detail-drawer .drawer-body` 中，在"关联项目"之后添加：

```html
<div class="drawer-form-group">
    <label class="drawer-form-label">📜 关联脚本</label>
    <div class="drawer-scripts-summary" id="drawer-scripts-summary">
        <div class="drawer-scripts-empty" id="drawer-scripts-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <p>暂无关联脚本</p>
            <button type="button" class="btn btn-sm btn-primary" onclick="openDrawerScriptSelector()">添加脚本</button>
        </div>
        <div class="drawer-scripts-list" id="drawer-scripts-list" style="display: none;"></div>
    </div>
    <button type="button" onclick="openDrawerScriptSelector()" class="btn btn-sm btn-secondary" style="margin-top: 8px; display: none;" id="drawer-edit-scripts-btn">
        编辑脚本
    </button>
    <input type="hidden" id="drawer-scripts" value="">
</div>
```

#### 6.1.2 JavaScript改动

在 `batch-create-cases.js` 中添加：

```javascript
// 脚本数据存储
let currentDrawerScripts = [];

// 打开脚本选择器
function openDrawerScriptSelector() {
    // 实现脚本选择弹窗
}

// 渲染脚本列表
function renderDrawerScripts(scripts) {
    const listContainer = document.getElementById('drawer-scripts-list');
    const emptyState = document.getElementById('drawer-scripts-empty');
    const editBtn = document.getElementById('drawer-edit-scripts-btn');
    
    if (scripts && scripts.length > 0) {
        emptyState.style.display = 'none';
        listContainer.style.display = 'block';
        editBtn.style.display = 'inline-flex';
        
        listContainer.innerHTML = scripts.map(script => `
            <div class="drawer-script-item">
                <span class="script-type-badge ${script.script_type}">${script.script_type.toUpperCase()}</span>
                <span class="script-name">${escapeHtml(script.script_name)}</span>
                ${script.link_url ? `<a href="${escapeHtml(script.link_url)}" target="_blank" class="script-link">查看</a>` : ''}
            </div>
        `).join('');
    } else {
        emptyState.style.display = 'block';
        listContainer.style.display = 'none';
        editBtn.style.display = 'none';
    }
}

// 保存时收集脚本数据
function collectDrawerScripts() {
    return currentDrawerScripts;
}
```

### 6.2 批量查看测试用例滑屉页面

**文件位置：** `public/batch-view-cases.html` + `public/js/batch-view-cases.js`

**改动内容：** 与批量添加页面类似，但需要支持从服务器加载已有脚本数据。

#### 6.2.1 JavaScript改动

```javascript
// 加载用例脚本数据
async function loadDrawerScripts(testCaseId) {
    try {
        const data = await apiRequest(`/testcases/${testCaseId}/scripts`);
        if (data.success) {
            currentDrawerScripts = data.scripts || [];
            renderDrawerScripts(currentDrawerScripts);
        }
    } catch (error) {
        console.error('加载脚本失败:', error);
    }
}

// 打开滑屉时加载脚本
function openDrawerWithScripts(rowIndex) {
    // ... 现有的打开逻辑
    const testCaseId = batchData[rowIndex].id;
    if (testCaseId) {
        loadDrawerScripts(testCaseId);
    }
}
```

### 6.3 全局搜索扩展

**文件位置：** `routes/search.js`

**改动内容：** 扩展搜索范围，支持搜索脚本名称。

#### 6.3.1 新增搜索函数

```javascript
async function searchScripts(keyword, limit, offset) {
    const searchPattern = `%${keyword}%`;
    
    try {
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total
            FROM test_case_scripts
            WHERE script_name LIKE ? 
               OR description LIKE ?
        `, [searchPattern, searchPattern]);
        
        const total = countResult[0].total;
        
        const [rows] = await pool.execute(`
            SELECT 
                s.id,
                s.script_name,
                s.script_type,
                s.description,
                s.test_case_id,
                s.link_url,
                s.created_at,
                tc.name as case_name,
                tc.case_id,
                m.name as module_name
            FROM test_case_scripts s
            LEFT JOIN test_cases tc ON s.test_case_id = tc.id
            LEFT JOIN modules m ON tc.module_id = m.id
            WHERE s.script_name LIKE ? 
               OR s.description LIKE ?
            ORDER BY s.created_at DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `, [searchPattern, searchPattern]);
        
        return {
            total,
            hasMore: total > offset + limit,
            items: rows.map(row => ({
                id: row.id,
                scriptName: row.script_name,
                scriptType: row.script_type,
                description: row.description ? row.description.substring(0, 100) : '',
                testCaseId: row.test_case_id,
                caseName: row.case_name,
                caseId: row.case_id,
                moduleName: row.module_name || '未分类',
                linkUrl: row.link_url,
                createdAt: row.created_at
            }))
        };
    } catch (error) {
        console.error('搜索脚本错误:', error);
        return { total: 0, hasMore: false, items: [], error: error.message };
    }
}
```

#### 6.3.2 修改搜索路由

```javascript
router.get('/search', authenticateToken, async (req, res) => {
    // ... 现有代码
    
    // 修改有效类型列表
    const validTypes = ['testplan', 'case', 'post', 'comment', 'script'];  // 添加 'script'
    
    // 添加脚本搜索
    if (typeList.includes('script')) {
        searchPromises.push(
            searchScripts(searchTerm, limitNum, offsetNum)
                .then(r => { results.scripts = r; })
                .catch(e => { results.scripts = { total: 0, items: [], error: e.message }; })
        );
    }
    
    // ... 现有代码
});
```

#### 6.3.3 前端搜索结果显示

在全局搜索结果页面中添加脚本类型的显示模板：

```html
<!-- 脚本搜索结果模板 -->
<div class="search-result-item script-result" data-type="script">
    <div class="result-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
    </div>
    <div class="result-content">
        <div class="result-title">
            <span class="script-type-badge ${scriptType}">${scriptType}</span>
            ${scriptName}
        </div>
        <div class="result-meta">
            <span>所属用例: ${caseName}</span>
            <span>模块: ${moduleName}</span>
        </div>
    </div>
</div>
```

---

## 七、实现步骤

### 7.1 开发顺序

| 序号 | 步骤 | 涉及文件 | 预估工时 |
|------|------|----------|----------|
| 1 | 执行SQL创建表 | 数据库 | 0.5h |
| 2 | 实现后端API路由 | `routes/testcases.js` 或新建 `routes/scripts.js` | 2h |
| 3 | 配置文件上传中间件 | `server.js` | 0.5h |
| 4 | 测试用例详情页添加标签页 | `index.html` | 1h |
| 5 | 添加脚本弹窗HTML | `index.html` | 0.5h |
| 6 | 添加CSS样式 | `styles.css` | 0.5h |
| 7 | 实现前端JavaScript逻辑 | `script.js` | 2h |
| 8 | 批量添加页面扩展 | `batch-create-cases.html` + `batch-create-cases.js` | 1.5h |
| 9 | 批量查看页面扩展 | `batch-view-cases.html` + `batch-view-cases.js` | 1.5h |
| 10 | 全局搜索扩展 | `routes/search.js` + 前端搜索页面 | 1h |
| 11 | 测试验证 | 全部 | 1h |

**总计预估工时：** 12小时

### 7.2 测试清单

- [ ] 数据库表创建成功，索引正常
- [ ] API接口功能正常（增删改查）
- [ ] 文件上传功能正常
- [ ] 文件下载功能正常
- [ ] 测试用例详情页标签页显示正常
- [ ] 脚本列表渲染正常
- [ ] 添加/编辑脚本弹窗功能正常
- [ ] 批量添加页面脚本功能正常
- [ ] 批量查看页面脚本功能正常
- [ ] 全局搜索能搜索到脚本
- [ ] 删除测试用例时关联脚本级联删除

---

## 八、UI效果预览

### 8.1 测试用例详情页

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📋 CASE-20260330-605b69c4-0                                                │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐       │
│  │ 基本信息 │ 测试内容 │ 关联脚本 │ 关联项目 │ 执行记录 │ 评审信息 │       │
│  └──────────┴──────────┴────┬─────┴──────────┴──────────┴──────────┘       │
│                              ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📜 关联脚本                                    [+ 添加脚本]         │   │
│  ├────┬──────────────────────────────┬──────┬─────────┬────────┬──────┤   │
│  │ #  │ 脚本名称                     │ 类型 │ 描述    │ 源文件 │ 链接 │   │
│  ├────┼──────────────────────────────┼──────┼─────────┼────────┼──────┤   │
│  │ 1  │ sdk_fdb_func_basic_test.tcl  │ TCL  │ 基础测试│ [下载] │ [链接]│   │
│  │ 2  │ sdk_fdb_func_stress.py       │ PY   │ 压力测试│   -    │ [链接]│   │
│  │ 3  │ run_test.sh                  │ SH   │ 执行脚本│ [下载] │   -   │   │
│  └────┴──────────────────────────────┴──────┴─────────┴────────┴──────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 添加脚本弹窗

```
┌─────────────────────────────────────────────────┐
│  添加关联脚本                               ×    │
├─────────────────────────────────────────────────┤
│                                                 │
│  脚本名称 *                                     │
│  ┌─────────────────────────────────────────┐   │
│  │ sdk_fdb_func_xxx_xxx.tcl                 │   │
│  └─────────────────────────────────────────┘   │
│  支持 .tcl, .py, .sh 等脚本文件                │
│                                                 │
│  脚本类型                                       │
│  ┌─────────────────────────────────────────┐   │
│  │ TCL                                   ▼ │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  脚本描述                                       │
│  ┌─────────────────────────────────────────┐   │
│  │ FDB功能测试脚本                          │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  源文件上传                                     │
│  ┌─────────────────────────────────────────┐   │
│  │         ↥ 点击上传或拖拽文件到此处        │   │
│  │         支持 .tcl, .py, .sh 等格式       │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  外部链接                                       │
│  ┌─────────────────────────────────────────┐   │
│  │ https://gitlab.xxx.com/test/script.tcl  │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ GitLab源码                               │   │
│  └─────────────────────────────────────────┘   │
│  ○ 外部链接  ● GitLab  ○ 其他          │
│                                                 │
├─────────────────────────────────────────────────┤
│                        [取消]  [保存]           │
└─────────────────────────────────────────────────┘
```

### 8.3 批量添加滑屉

```
┌──────────────────────────────────────┐
│  编辑用例详情                    ×   │
├──────────────────────────────────────┤
│  📄 测试内容                         │
│  ...                                 │
│                                      │
│  🔗 关联信息                         │
│  ┌──────────────────────────────┐   │
│  │ 📁 关联项目                  │   │
│  │   [项目A] [项目B]            │   │
│  │   [编辑关联]                 │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ 📜 关联脚本                  │   │
│  │   ┌────────────────────┐     │   │
│  │   │ [TCL] script1.tcl  │     │   │
│  │   │ [PY] script2.py    │     │   │
│  │   └────────────────────┘     │   │
│  │   [添加脚本] [编辑脚本]       │   │
│  └──────────────────────────────┘   │
│                                      │
├──────────────────────────────────────┤
│              [取消]  [保存详情]      │
└──────────────────────────────────────┘
```

---

## 九、风险与注意事项

### 9.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 文件上传大小限制 | 大文件上传失败 | 配置合理的文件大小限制（建议10MB） |
| 文件类型安全 | 恶意文件上传 | 限制文件类型，添加文件内容校验 |
| 数据库性能 | 大量脚本影响查询 | 添加索引，分页查询 |

### 9.2 兼容性考虑

- 文件上传需要支持主流浏览器
- 拖拽上传需要处理浏览器兼容性
- 移动端需要适配触摸操作

### 9.3 安全考虑

- 文件上传需要验证文件类型和内容
- 链接需要防止XSS攻击
- API需要权限验证

---

## 十、附录

### 10.1 相关文件清单

| 文件路径 | 改动类型 |
|----------|----------|
| `database_schema.txt` | 新增表说明 |
| `routes/testcases.js` 或 `routes/scripts.js` | 新增API |
| `server.js` | 文件上传配置 |
| `index.html` | 新增标签页和弹窗 |
| `styles.css` | 新增样式 |
| `script.js` | 新增前端逻辑 |
| `public/batch-create-cases.html` | 扩展滑屉 |
| `public/js/batch-create-cases.js` | 扩展逻辑 |
| `public/batch-view-cases.html` | 扩展滑屉 |
| `public/js/batch-view-cases.js` | 扩展逻辑 |
| `routes/search.js` | 扩展搜索 |

### 10.2 参考资料

- 现有关联项目功能实现
- 现有文件上传功能实现
- 全局搜索功能实现

---

**文档版本：** v1.0  
**创建日期：** 2026-04-03  
**最后更新：** 2026-04-03
