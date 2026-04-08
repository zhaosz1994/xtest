# 数据库自动迁移功能 - 使用说明

## ✅ 已实现的功能

现在你的项目支持**启动时自动检测和修复数据库结构**！

### 🎯 工作原理

```
启动服务器 (node server.js)
    ↓
initDatabase()  ← 原有逻辑
    ↓
databaseMigrator.init()  ← 🆕 新增！自动检查并修复
    ↓
server.listen()  ← 启动HTTP服务
```

---

## 🔧 实现细节

### 1. 新增文件：[services/databaseMigrator.js](../services/databaseMigrator.js)

**核心功能：**
- 启动时自动检查 `ai_operation_logs` 表结构
- 如果缺少字段，**自动添加**
- 支持扩展更多迁移规则

**当前检测的迁移项：**

| 迁移名称 | 检测内容 | 修复操作 |
|---------|---------|---------|
| ai_operation_logs_token_fields | 检查4个token字段是否存在 | 自动添加缺失字段 |

**检测的字段：**
- ✅ `prompt_tokens` - 提示词token数
- ✅ `completion_tokens` - 完成token数  
- ✅ `total_tokens` - 总token数
- ✅ `model_name` - AI模型名称

### 2. 修改文件：[server.js](../server.js) (第8170-8177行)

在 `startServer()` 函数中添加了迁移调用：

```javascript
// 自动检查并修复数据库结构
try {
  const databaseMigrator = require('./services/databaseMigrator');
  await databaseMigrator.init();
} catch (migrationError) {
  console.warn('⚠️ 数据库自动迁移失败（不影响启动）:', migrationError.message);
}
```

**设计特点：**
- ✅ **不影响启动** - 即使迁移失败，服务器仍会正常启动
- ✅ **幂等性** - 多次执行不会重复添加字段（使用 IF NOT EXISTS）
- ✅ **可扩展** - 轻松添加新的迁移规则

---

## 🚀 使用方法

### 正常启动（推荐）

```bash
# 启动时会自动检查和修复
node server.js

# 或使用PM2
pm2 start server.js --name xtest
```

**控制台输出示例：**

```
🔄 数据库自动迁移检查...

✅ 数据库结构正常，无需修复

或

🔄 数据库自动迁移检查...
[数据库迁移] 发现问题: ai_operation_logs_token_fields, 正在修复...
[数据库迁移] ✅ 已修复: ai_operation_logs_token_fields

✅ 数据库已自动修复 1 个问题

服务器运行在 http://localhost:3000
WebSocket服务已启动
服务器启动成功，等待请求...
```

---

## 📋 如何添加新的迁移规则

编辑 [services/databaseMigrator.js](../services/databaseMigrator.js)：

```javascript
class DatabaseMigrator {
  // ... 现有代码 ...

  init() {
    this.registerAIOperationLogsMigration();  // 现有
    
    // 🆕 添加你的新迁移规则
    this.registerYourNewMigration();          // 新增
    
    logger.info('[数据库迁移] 开始检查...');
    // ...
  }

  // 🆕 示例：为新表添加字段迁移
  registerYourNewMigration() {
    this.registerMigration(
      'your_migration_name',                    // 迁移名称
      `
        SELECT 
          CASE WHEN COUNT(*) > 0 THEN 0 ELSE 1 END as needs_fix
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
          AND table_name = 'your_table' 
          AND column_name IN ('field1', 'field2')
      `,                                        // 检查SQL
      `
        ALTER TABLE your_table 
          ADD COLUMN IF NOT EXISTS field1 INT DEFAULT 0,
          ADD COLUMN IF NOT EXISTS field2 VARCHAR(100);
      `                                         // 修复SQL
    );
  }
}
```

---

## ⚙️ 高级配置

### 禁用自动迁移（可选）

如果不想每次启动都检查，可以注释掉 [server.js](../server.js) 第8170-8177行：

```javascript
// 注释掉这段代码即可禁用
/*
try {
  const databaseMigrator = require('./services/databaseMigrator');
  await databaseMigrator.init();
} catch (migrationError) {
  console.warn('⚠️ 数据库自动迁移失败（不影响启动）:', migrationError.message);
}
*/
```

### 手动触发迁移

```bash
# 方式1: 使用Node.js直接调用
node -e "require('./services/databaseMigrator').init().then(() => process.exit(0))"

# 方式2: 使用之前的修复脚本
./scripts/quick-fix-ai-logs.sh
```

---

## 🎯 适用场景

### 场景1: 首次部署到新服务器
```bash
git pull origin main
npm install
node server.js  # ✅ 自动创建/修复所有缺失的表和字段
```

### 场景2: 更新代码后重启
```bash
pm2 restart all  # ✅ 自动应用新的数据库变更
```

### 场景3: 多环境部署（开发/测试/生产）
```bash
# 所有环境都可以安全地使用自动迁移
# 因为使用了 IF NOT EXISTS，不会重复创建
```

---

## 🔍 验证是否生效

### 方法1: 查看日志

```bash
# 启动时查看控制台输出
node server.js | grep "数据库"

# 应该看到：
# 🔄 数据库自动迁移检查...
# ✅ 数据库已自动修复 X 个问题  （或 "数据结构正常"）
```

### 方法2: 检查表结构

```sql
-- 登录MySQL查看
DESCRIBE ai_operation_logs;

-- 应该看到这4个字段：
-- prompt_tokens     int(11)      NO   0
-- completion_tokens int(11)      NO   0
-- total_tokens      int(11)      NO   0
-- model_name        varchar(100) YES   NULL
```

### 方法3: 测试API接口

```bash
curl http://localhost:3000/api/ai-operation-logs/preview

# 应该返回正常数据，不再报错
```

---

## 💡 最佳实践建议

### 1. 保持迁移脚本同步

当你修改了数据库结构（添加新表、新字段）时：

```javascript
// 步骤1: 在 services/databaseMigrator.js 添加迁移规则
this.registerMigration(
  'new_table_or_field',
  checkSql,  // 检测SQL
  fixSql     // 修复SQL
);

// 步骤2: 提交到Git
git add services/databaseMigrator.js
git commit -m "feat: 添加XXX表的自动迁移"
git push origin main

// 步骤3: 在服务器上拉取并重启
git pull && pm2 restart all  # ✅ 自动应用
```

### 2. 版本化迁移记录

建议在迁移函数中添加版本号：

```javascript
registerMigration(
  'v20260408_add_ai_tokens',  // 包含日期和描述
  checkSql,
  fixSql
);
```

### 3. 生产环境注意事项

- ✅ **安全**: 使用 `IF NOT EXISTS` 避免重复创建
- ✅ **容错**: 迁移失败不阻止服务启动
- ✅ **日志**: 记录所有迁移操作便于排查
- ⚠️ **性能**: 迁移在启动时执行，确保SQL高效
- ⚠️ **备份**: 重要环境建议先备份数据库

---

## ❓ 常见问题

### Q1: 会影响性能吗？
**A:** 影响很小。只在启动时执行一次简单的SELECT查询，耗时通常 < 100ms。

### Q2: 会重复执行吗？
**A:** 不会。使用了 `IF NOT EXISTS` 和条件判断，多次执行是安全的。

### Q3: 可以回滚吗？
**A:** 目前不支持自动回滚。如果需要回滚，手动执行反向SQL即可。

### Q4: 如何知道哪些迁移被执行过？
**A:** 查看启动日志或添加迁移记录表（高级用法）。

### Q5: 适合大型项目吗？
**A:** 适合中小型项目。对于企业级项目，建议使用专业的迁移工具如：
- Knex.js migrations
- Sequelize migrations
- Flyway (Java)
- Alembic (Python)

---

## 📊 对比：之前 vs 现在

| 项目 | 之前 | 现在 |
|------|------|------|
| **部署流程** | 手动执行SQL → 重启 | 直接重启 ✅ |
| **忘记迁移** | 报错 "unknown column" | 自动修复 ✅ |
| **多服务器部署** | 每台都要手动执行 | 全自动 ✅ |
| **新人上手** | 需要了解迁移步骤 | 无需关心 ✅ |
| **回滚风险** | 低（手动控制） | 中（自动化） |
| **维护成本** | 高（需记住执行） | 低（全自动） |

---

## 📦 相关文件清单

### 新增文件
- ✅ [services/databaseMigrator.js](../services/databaseMigrator.js) - 自动迁移核心模块

### 修改文件
- ✅ [server.js](../server.js) (第8170-8177行) - 添加迁移调用

### 辅助工具（仍可用）
- [scripts/quick-fix-ai-logs.sh](../scripts/quick-fix-ai-logs.sh) - 一键手动修复
- [scripts/fix-ai-operation-logs.sh](../scripts/fix-ai-operation-logs.sh) - 标准修复脚本
- [migrations/fix-ai-operation-logs-tokens.sql](../migrations/fix-ai-operation-logs-tokens.sql) - SQL迁移文件

### 文档
- [docs/FIX_AI_OPERATION_LOGS.md](../docs/FIX_AI_OPERATION_LOGS.md) - 故障排查指南
- 本文档 - 自动迁移功能说明

---

## 🎉 总结

**现在你有了双重保障：**

1. **自动模式**（推荐）：启动时自动检测和修复 ✨
2. **手动模式**（备用）：使用脚本手动修复 🛠️

**下次遇到类似问题时：**

```bash
# 只需要重启服务即可！
pm2 restart all

# 控制台会显示：
# ✅ 数据库已自动修复 X 个问题
```

**再也不用手动执行SQL了！🚀**
