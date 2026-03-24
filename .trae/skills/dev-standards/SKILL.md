---
name: "dev-standards"
description: "开发规范汇总。添加新功能时必须遵循此规范，包括弹窗、时间格式、XSS防护、权限判断等。"
---

# 开发规范汇总

本文档汇总了项目开发过程中必须遵循的规范，添加新功能时请务必检查是否符合以下规范。

---

## 一、弹窗规范

### 1.1 禁止使用系统自带弹窗

**不要使用以下方式：**

```javascript
// ❌ 禁止
alert('提示信息');
confirm('确定要删除吗？');
```

### 1.2 必须使用项目封装的弹窗函数

| 函数 | 用途 | 示例 |
|------|------|------|
| `showSuccessMessage(msg)` | 成功提示（自动消失） | `showSuccessMessage('保存成功')` |
| `showErrorMessage(msg)` | 错误提示（模态框） | `showErrorMessage('操作失败')` |
| `showConfirmMessage(msg)` | 确认弹窗（Promise） | `await showConfirmMessage('确定删除？')` |
| `showConfirmModal(msg, callback)` | 确认弹窗（回调） | `showConfirmModal('确定？', (r) => {})` |

### 1.3 使用示例

**成功提示：**

```javascript
// ✅ 正确 - 显示成功提示（自动消失）
showSuccessMessage('操作成功');
```

**错误提示：**

```javascript
// ✅ 正确 - 显示错误模态框
showErrorMessage('操作失败，请重试');
```

**确认弹窗：**

```javascript
// ✅ 正确 - Promise 版本（推荐）
async function deleteItem(id) {
    if (!(await showConfirmMessage('确定要删除吗？'))) {
        return;
    }
    // 执行删除操作
}

// ✅ 正确 - 回调函数版本
function deleteItem(id) {
    showConfirmModal('确定要删除吗？', (result) => {
        if (result) {
            // 执行删除操作
        }
    });
}
```

---

## 二、时间格式规范

详见 `datetime-format` Skill

**核心要点：**

```javascript
// ✅ 正确
formatDateTime(dateStr)  // 输出: 2026/03/05 23:39
formatDate(dateStr)      // 输出: 2026/03/05

// ❌ 禁止
new Date().toLocaleDateString()
new Date().toLocaleString('zh-CN', {...})
```

---

## 三、XSS 防护规范

### 3.1 用户输入必须转义

**必须使用 `escapeHtml()` 函数：**

```javascript
// ✅ 正确
element.innerHTML = `<div>${escapeHtml(userInput)}</div>`;
select.innerHTML += `<option value="${id}">${escapeHtml(name)}</option>`;

// ❌ 禁止 - 直接插入用户输入
element.innerHTML = `<div>${userInput}</div>`;
```

### 3.2 escapeHtml 函数

```javascript
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
```

### 3.3 Markdown 渲染需要消毒

```javascript
// ✅ 正确 - 使用 DOMPurify 消毒
element.innerHTML = DOMPurify.sanitize(marked.parse(markdownContent));

// ❌ 禁止 - 直接渲染 Markdown
element.innerHTML = marked.parse(markdownContent);
```

---

## 四、权限判断规范

### 4.1 管理员权限判断

**必须支持中英文角色值：**

```javascript
// ✅ 正确 - 支持三种角色值
const isAdmin = userRole === '管理员' || userRole === 'admin' || userRole === 'Administrator';

// ❌ 禁止 - 只检查中文
const isAdmin = userRole === '管理员';
```

### 4.2 前端权限判断函数

```javascript
// 使用 Router.isAdmin() 或自定义函数
function hasAdminRole(role) {
    return role === '管理员' || role === 'admin' || role === 'Administrator';
}
```

---

## 五、API 调用规范

### 5.1 使用 apiRequest 函数

```javascript
// ✅ 正确 - 使用封装的 apiRequest
const result = await apiRequest('/api/users/list', {
    method: 'POST',
    body: JSON.stringify(data)
});

// ❌ 禁止 - 直接使用 fetch
const response = await fetch('/api/users/list', {...});
```

### 5.2 错误处理
```javascript
// ✅ 正确 - 检查 success 字段
const result = await apiRequest('/api/xxx');
if (result.success) {
    // 处理成功
} else {
    showErrorMessage(result.message || '操作失败');
}
```

---

## 六、事件绑定规范

### 6.1 避免内联事件

```javascript
// ✅ 正确 - 使用 addEventListener
element.addEventListener('click', handleClick);

// ❌ 避免 - 内联事件（特殊字符可能导致错误）
element.innerHTML = `<button onclick="handleClick('${name}')">点击</button>`;
```

### 6.2 使用 data 属性传递数据

```javascript
// ✅ 正确
element.innerHTML = `<button class="action-btn" data-id="${id}" data-name="${escapeHtml(name)}">操作</button>`;
document.querySelector('.action-btn').addEventListener('click', function() {
    const id = this.dataset.id;
    const name = this.dataset.name;
    // 处理点击
});
```

---

## 七、模态框 z-index 规范

| 元素 | z-index |
|------|---------|
| 滑屉遮罩层 | 9998 |
| 滑屉主体 | 10000 |
| 模态框遮罩层 | 11001+ |
| 动态创建的模态框 | 99999 |

**动态创建模态框时必须设置高 z-index：**

```javascript
modal.style.cssText = 'z-index: 99999 !important; ...';
```

---

## 八、检查清单

添加新功能时，请检查以下项目：

- [ ] 弹窗是否使用项目封装的函数
- [ ] 时间显示是否使用 formatDateTime/formatDate
- [ ] 用户输入是否使用 escapeHtml 转义
- [ ] 权限判断是否支持中英文角色值
- [ ] API 调用是否使用 apiRequest
- [ ] 事件绑定是否避免内联事件
- [ ] 模态框 z-index 是否足够高
