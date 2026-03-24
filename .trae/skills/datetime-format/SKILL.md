---
name: "datetime-format"
description: "统一时间格式化规范。当添加新功能涉及时间显示时，必须使用此规范。格式：YYYY/MM/DD HH:mm（北京时间）"
---

# 时间格式化规范

## 统一格式

本项目所有时间显示统一使用**北京时间**格式：

| 类型 | 格式 | 示例 |
|------|------|------|
| 日期时间 | `YYYY/MM/DD HH:mm` | `2026/03/05 23:39` |
| 仅日期 | `YYYY/MM/DD` | `2026/03/05` |
| 日期时间（含秒） | `YYYY/MM/DD HH:mm:ss` | `2026/03/05 23:39:45` |

---

## 必须使用的函数

### 1. formatDateTime(dateStr)

用于显示日期时间，格式：`YYYY/MM/DD HH:mm`

```javascript
function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}/${month}/${day} ${hours}:${minutes}`;
    } catch (e) {
        return dateStr;
    }
}
```

### 2. formatDate(dateStr)

用于显示仅日期，格式：`YYYY/MM/DD`

```javascript
function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
    } catch (e) {
        return dateStr;
    }
}
```

---

## 禁止使用的方式

**不要使用以下方式格式化时间：**

```javascript
// ❌ 禁止
new Date(dateStr).toLocaleDateString()
new Date(dateStr).toLocaleString('zh-CN', {...})
new Date(dateStr).toLocaleTimeString()
date.toLocaleString()
```

**应该使用：**

```javascript
// ✅ 正确
formatDateTime(dateStr)
formatDate(dateStr)
```

---

## 使用示例

```javascript
// 用户列表 - 创建时间
<td>${user.created_at ? formatDate(user.created_at) : '-'}</td>

// 登录日志 - 登录时间
formattedTime = formatDateTime(login.loginTime);

// 历史记录 - 操作时间
time: formatDateTime(new Date())

// 仪表盘 - 刷新时间
lastRefreshTimeEl.textContent = formatDateTime(now);
```

---

## 注意事项

1. **所有 UI 显示的时间都必须使用此规范**
2. **数据库存储时间使用 UTC 或服务器本地时间，显示时转换**
3. **图表标签可以使用简洁格式（如"3月22日"），但需保持一致**
4. **新增功能涉及时间显示时，必须检查是否符合此规范**
