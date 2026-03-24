# 回收站功能设计文档 (V2.0 更新版)

## 一、需求概述

### 1.1 功能描述

实现一个系统级回收站功能，支持用例库、测试用例、测试计划、测试报告等数据的软删除和恢复。
被删除的数据在回收站中保留 **30 天**。
超过 30 天的数据将被自动彻底删除。

### 1.2 业务目标

- **防止**误删除的数据可以恢复
- 提供数据安全保障
- 减少误操作带来的损失
- 自动清理过期数据，节省存储空间

***

## 二、数据库设计

### 2.1 回收站表结构

创建统一的回收站表 `recycle_bin`。

```sql
CREATE TABLE recycle_bin (
    id INT PRIMARY KEY AUTO_INCREMENT,
    item_type ENUM('case_library', 'test_case', 'test_plan', 'test_report') NOT NULL COMMENT '数据类型',
    item_id INT NOT NULL COMMENT '原数据ID',
    item_data JSON NOT NULL COMMENT '原始数据快照',
    item_name VARCHAR(255) NOT NULL COMMENT '数据名称',
    deleted_by VARCHAR(50) NOT NULL COMMENT '删除者',
    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '删除时间',
    will_delete_at TIMESTAMP NOT NULL COMMENT '计划彻底删除时间',
    restored_at TIMESTAMP NULL COMMENT '恢复时间(如果被恢复)',
    restored_by VARCHAR(50) NULL COMMENT '恢复者(如果被恢复)'
    INDEX idx_item_type_id (item_type, item_id),
    INDEX idx_deleted_at (deleted_at),
    INDEX idx_will_delete_at (will_delete_at)
);
```

### 2.2 字段说明

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | INT | 主键ID |
| item_type | ENUM | 数据类型 |
| item_id | INT | 原数据表中的ID |
| item_data | JSON | 原始数据的完整JSON快照 |
| item_name | VARCHAR(255) | 数据名称,便于搜索 |
| deleted_by | VARCHAR(50) | 执行删除的用户 |
| deleted_at | TIMESTAMP | 删除时间 |
| will_delete_at| TIMESTAMP | 计划彻底删除时间(删除时间+30天) |
| restored_at | TIMESTAMP | 恢复时间(如果被恢复) |
| restored_by | VARCHAR(50) | 恢复操作的用户 |

*(注：对于测试报告等可能包含海量日志的超大 JSON 字段，建议将详情文本存储至 OSS/S3 等对象存储，`item_data` 中仅保留索引链接，以优化数据库性能。)*

***

## 三、API 设计

### 3.1 API 列表

| 方法 | 路径 | 描述 |
| :--- | :--- | :--- |
| GET | /api/recycle-bin | 获取回收站列表 |
| GET | /api/recycle-bin/:id | 获取单条回收记录详情 |
| POST | /api/recycle-bin/:id/restore | 恢复单条数据 |
| POST | /api/recycle-bin/batch-restore| 批量恢复数据 |
| DELETE| /api/recycle-bin/:id | 彻底删除单条数据 |
| DELETE| /api/recycle-bin/batch-delete | 批量彻底删除 |
| GET | /api/recycle-bin/stats | 获取回收站统计信息 |

***

## 四、前端设计

### 4.1 页面布局

在系统导航栏左侧栏社区入口下方添加回收站入口。页面采用顶部工具栏（筛选、搜索、排序）+ 中部数据表格（支持多选）+ 底部批量操作栏的布局结构。

### 4.2 交互流程优化（恢复数据流程）

```text
用户点击[恢复]
    ↓
显示确认弹窗: "确定恢复【SDK测试库】吗？恢复后数据将回到原位置。"
    ↓
用户确认
    ↓
调用 POST /api/recycle-bin/:id/restore
    ↓
【新增校验】后端检查父级依赖（如恢复测试用例时，检查所属模块是否存在）
    ↓
成功: 关闭弹窗, 刷新列表, 显示成功提示 "数据恢复成功"
失败: 提示具体原因（如："所属测试模块已被删除，请先恢复模块或重新分配"）
```

***

## 五、自动清理机制

使用定时任务每天凌晨 3:00 自动清理过期（超过30天）数据。

```javascript
// 每天凌晨 3:00 执行清理任务
cron.schedule('0 3 * * *', async () => {
    await cleanExpiredItems();
});
```

***

## 六、权限设计（升级版）

### 6.1 功能权限

引入“项目管理员/团队负责人”权限，解决员工离职或转岗后数据无法恢复的痛点。

| 操作 | 全局管理员 | 项目管理员/负责人 | 普通用户 |
| :--- | :--- | :--- | :--- |
| 查看回收站 | ✓ | ✓ (当前项目下) | ✓ (仅自己删除的) |
| 恢复数据 | ✓ | ✓ (当前项目下) | ✓ (仅自己删除的) |
| 彻底删除 | ✓ | ✗ | ✗ |
| 清空回收站 | ✓ | ✗ | ✗ |

### 6.2 恢复权限控制逻辑

```javascript
async function canRestore(item, currentUser) {
    // 全局管理员可以恢复任何数据
    if (currentUser.role === 'admin') return true;
    
    // 项目管理员可以恢复本项目的任何数据
    if (currentUser.isProjectAdmin(item.project_id)) return true;

    // 普通用户只能恢复自己删除的数据
    return item.deleted_by === currentUser.username;
}
```

***

## 七、通知机制

在数据即将过期前 3 天发送通知提醒。提取被删除者邮箱，发送保留提醒邮件。

***

## 八、数据恢复逻辑（重点优化事务与依赖）

### 8.1 恢复流程

```text
1. 开启数据库事务 (BEGIN TRANSACTION)
    ↓
2. 【新增校验】检查父级依赖项是否存活（如：测试模块、用例库是否存在）
    ↓
3. 检查原数据是否已存在（ID冲突）
    ↓
4. 如果存在冲突，根据策略处理（生成新ID 或 覆盖现有数据）
    ↓
5. 恢复数据到原表
    ↓
6. 恢复相关的级联关联数据
    ↓
7. 更新回收站记录（设置 restored_at, restored_by）
    ↓
8. 提交事务 (COMMIT)
```

***

## 九、性能优化

- **分页查询优化**：回收站数据量大时，为 `deleted_at` 和 `will_delete_at` 添加索引加速查询。
- **存储优化**：`item_data` 字段在数据量大时采用压缩存储，超大日志类数据转存至对象存储（OSS/S3）。
- **定时清理**：严格执行过期数据清理，防止表体积无限膨胀。

***

## 十、测试计划

### 10.1 单元测试

包含数据转换、数据恢复、自动清理以及权限控制的核心逻辑测试。增加“依赖缺失恢复失败”的边界测试。

### 10.2 原始数据保留（修正统一为30天）

| 项目 | 保留天数 |
| :--- | :--- |
| 用例库 | 30天 |
| 测试用例 | 30天 |
| 测试计划 | 30天 |
| 测试报告 | 30天 |

### 10.3 预期数据准备

准备各类型测试数据用于功能测试。模拟父节点被删、ID 冲突等复杂场景。

***

## 十一、风险评估

| 风险 | 影响 | 缓解措施 |
| :--- | :--- | :--- |
| 大量数据删除导致存储压力 | 存储空间不足 | 定期清理、大字段转存OSS、压缩存储 |
| 恢复时ID冲突 | 数据覆盖 | 提供冲突处理选项 (新ID/覆盖) |
| 恢复时级联依赖丢失 | 产生孤儿数据报错 | 恢复前强制校验父级依赖状态 |
| 自动清理任务失败 | 数据堆积 | 监控告警、手动清理入口 |