# xTest 深度测试规划与可用性审查报告

> 评估人：资深测试开发架构师（SDET）兼高级UX研究员  
> 评估日期：2026-03-04  
> 系统版本：xTest v1.0

---

## 一、核心业务流测试 (Business Logic & State Transition)

### 1.1 状态机模型定义

基于代码分析，xTest 的核心状态机如下：

```
测试计划状态机：
┌─────────────┐
│   未开始    │ ───────────────────────┐
└──────┬──────┘                        │
       │ 开始执行                       │
       ▼                               │
┌─────────────┐                        │
│   进行中    │ ◄─────────────────────┤
└──────┬──────┘                        │
       │                               │
       ├──► ┌─────────────┐            │
       │    │   已完成    │ ───────────┘ 重置
       │    └─────────────┘
       │
       └──► ┌─────────────┐
            │   阻塞      │
            └─────────────┘
```

### 1.2 状态机遍历测试方案

#### 1.2.1 基本路径覆盖测试

| 测试ID | 初始状态 | 触发事件 | 预期状态 | 验证点 |
|--------|----------|----------|----------|--------|
| ST-001 | 未开始 | 点击"开始执行" | 进行中 | 状态变更、时间戳更新 |
| ST-002 | 进行中 | 所有用例执行完毕 | 已完成 | 通过率计算、完成时间记录 |
| ST-003 | 进行中 | 遇到阻塞问题 | 阻塞 | 阻塞原因记录、通知机制 |
| ST-004 | 阻塞 | 问题解决 | 进行中 | 恢复执行、状态回滚 |
| ST-005 | 已完成 | 重新测试 | 未开始 | 数据重置、历史保留 |

#### 1.2.2 状态转换矩阵测试

```
           │ 未开始 │ 进行中 │ 已完成 │ 阻塞 │
───────────┼────────┼────────┼────────┼──────┤
未开始     │   -    │   ✓    │   ✗    │  ✗   │
进行中     │   ✗    │   -    │   ✓    │  ✓   │
已完成     │   ✓    │   ✗    │   -    │  ✗   │
阻塞       │   ✗    │   ✓    │   ✓    │  -   │
```

#### 1.2.3 并发状态转换测试

```javascript
// 并发状态修改测试场景
const concurrentTests = [
  {
    name: '双用户同时修改状态',
    actions: [
      { user: 'user1', action: 'updateStatus', from: '进行中', to: '已完成' },
      { user: 'user2', action: 'updateStatus', from: '进行中', to: '阻塞' }
    ],
    expected: '最终状态一致，有明确的冲突解决机制'
  },
  {
    name: '状态修改与删除并发',
    actions: [
      { user: 'user1', action: 'updateStatus', target: 'plan_001' },
      { user: 'user2', action: 'delete', target: 'plan_001' }
    ],
    expected: '删除操作应被阻止或状态修改应失败'
  }
];
```

### 1.3 业务逻辑漏洞与死锁场景

#### 漏洞 #1：项目删除后的测试计划孤儿问题

**场景描述**：
```
1. 创建项目 P1
2. 创建测试计划 TP1，关联项目 P1
3. 删除项目 P1
4. 查询 TP1
```

**当前行为**：测试计划仍存在，但 `project_name` 显示为 `null` 或原始项目代码

**预期行为**：
- 应阻止删除有关联测试计划的项目
- 或提供级联处理选项（迁移/删除/保留）

**风险等级**：🔴 高危

---

#### 漏洞 #2：通过率数据完整性缺失

**场景描述**：
```javascript
// 当前代码中通过率计算
passRate: plan.pass_rate || 0,  // 无校验
testedCases: plan.tested_cases || 0,
totalCases: plan.total_cases || 0,

// 前端计算结果分布
resultDistribution: {
  pass: Math.floor((plan.pass_rate || 0) / 100 * (plan.tested_cases || 0)),
  fail: Math.floor(((100 - (plan.pass_rate || 0)) / 100) * (plan.tested_cases || 0)),
  pending: (plan.total_cases || 0) - (plan.tested_cases || 0)
}
```

**问题**：
- `pass_rate` 可被篡改为负数或超过100
- `tested_cases` 可大于 `total_cases`
- 无服务端校验

**攻击向量**：
```javascript
// 恶意请求
PUT /api/testplans/update/1
{
  "pass_rate": -50,      // 负数通过率
  "tested_cases": 1000,  // 已测试数
  "total_cases": 10      // 总数小于已测试
}
```

**风险等级**：🔴 高危

---

#### 漏洞 #3：负责人变更后的权限死锁

**场景描述**：
```
1. 用户 A 创建测试计划 TP1，A 为负责人
2. 用户 A 离职，账号被删除
3. TP1 成为"无主"状态
4. 其他用户无法编辑/删除 TP1（如果有权限校验）
```

**当前行为**：未发现明确的负责人变更机制

**风险等级**：🟡 中危

---

#### 漏洞 #4：测试用例与测试计划关联断裂

**场景描述**：
```
1. 测试计划 TP1 关联测试用例 TC1, TC2, TC3
2. TC2 被删除
3. TP1 的 total_cases 与实际关联数不一致
4. 执行进度显示异常
```

**风险等级**：🟡 中危

---

#### 漏洞 #5：迭代版本删除后的数据一致性

**场景描述**：
```
1. 创建迭代 v1.0
2. 多个测试计划关联迭代 v1.0
3. 删除迭代 v1.0
4. 测试计划的迭代字段成为悬空引用
```

**风险等级**：🟡 中危

---

## 二、极限边界与异常输入测试 (Edge Cases & Chaos Testing)

### 2.1 输入验证测试矩阵

| 字段 | 正常值 | 边界值 | 异常值 | 预期行为 |
|------|--------|--------|--------|----------|
| name | "测试计划A" | 1字符/255字符 | 空/10000字符/Emoji/SQL注入 | 校验拒绝 |
| pass_rate | 85 | 0/100 | -1/101/NaN/Infinity | 校验拒绝 |
| tested_cases | 50 | 0 | -1/1.5/"abc"/超大数 | 校验拒绝 |
| owner | "admin" | - | 不存在用户/空 | 校验拒绝 |
| project | "M12" | - | 不存在项目/空 | 校验拒绝 |

### 2.2 恶意输入测试用例

#### 2.2.1 SQL注入测试

```javascript
const sqlInjectionPayloads = [
  "'; DROP TABLE test_plans; --",
  "' OR '1'='1",
  "1; SELECT * FROM users --",
  "admin'--",
  "' UNION SELECT * FROM projects --"
];

// 测试点：名称字段、描述字段、筛选条件
```

#### 2.2.2 XSS攻击测试

```javascript
const xssPayloads = [
  '<script>alert("XSS")</script>',
  '<img src=x onerror=alert("XSS")>',
  'javascript:alert("XSS")',
  '<svg onload=alert("XSS")>',
  '"><script>alert(String.fromCharCode(88,83,83))</script>'
];

// 测试点：测试计划名称、描述、备注字段
```

#### 2.2.3 Emoji与Unicode攻击

```javascript
const unicodePayloads = [
  '😀'.repeat(10000),  // 10000个Emoji
  '\u200B'.repeat(1000),  // 零宽空格
  '\u202E' + 'test',  // RTL覆盖
  'test\u0000null',  // 空字节注入
  'ṫëṡṭ',  // 同形字攻击
];
```

### 2.3 混沌测试场景

#### 2.3.1 并发压力测试

```javascript
// 场景：100个并发请求修改同一测试计划状态
async function concurrentStatusUpdate() {
  const planId = 'test_plan_001';
  const promises = [];
  
  for (let i = 0; i < 100; i++) {
    promises.push(
      fetch(`/api/testplans/update/${planId}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: i % 2 === 0 ? '进行中' : '已完成'
        })
      })
    );
  }
  
  const results = await Promise.all(promises);
  // 验证：最终状态一致，无数据损坏
}
```

#### 2.3.2 数据库连接池耗尽测试

```javascript
// 场景：模拟连接池耗尽
async function connectionPoolExhaustion() {
  // 当前连接池大小：20
  // 发起30个长时间运行的查询
  const longQueries = Array(30).fill(null).map(() => 
    fetch('/api/testplans/list?sleep=30')
  );
  
  // 验证：系统是否有优雅降级机制
}
```

#### 2.3.3 网络分区模拟

```javascript
// 场景：请求过程中断开数据库连接
async function networkPartitionTest() {
  // 1. 发起创建请求
  const createPromise = fetch('/api/testplans/create', { ... });
  
  // 2. 在请求处理中断开数据库
  await simulateDbDisconnect();
  
  // 3. 验证：事务回滚，无脏数据
}
```

### 2.4 数据完整性测试

```javascript
// 通过率与用例数一致性测试
const dataIntegrityTests = [
  {
    name: '通过率与通过数不一致',
    data: { pass_rate: 80, tested_cases: 10, total_cases: 20 },
    expected: '系统应自动计算或拒绝不一致数据'
  },
  {
    name: '已测试数超过总数',
    data: { tested_cases: 100, total_cases: 50 },
    expected: '应拒绝并提示错误'
  },
  {
    name: '负数用例数',
    data: { tested_cases: -5, total_cases: -10 },
    expected: '应拒绝负数输入'
  }
];
```

---

## 三、专家级 UX/可用性审查 (Usability Heuristics)

### 3.1 主流测试管理系统的反人类设计

#### 问题 #1：过度的页面跳转

**Jira典型问题**：
- 创建测试计划 → 跳转详情页 → 返回列表 → 重新加载
- 每次操作都丢失上下文

**用户痛点**：
> "我只想快速创建一个计划，为什么要经历3次页面跳转？"

---

#### 问题 #2：筛选条件不持久

**典型问题**：
- 设置复杂筛选条件后点击某个计划
- 返回列表时筛选条件丢失
- 需要重新设置所有筛选

---

#### 问题 #3：批量操作效率低

**典型问题**：
- 需要逐个点击进入详情页修改状态
- 无批量状态变更功能
- 无键盘快捷键支持

---

### 3.2 xTest 交互优化建议

#### 优化 #1：原地编辑 (Inline Editing)

**当前路径**：点击计划 → 进入详情 → 编辑 → 保存 → 返回列表（5次点击）

**优化后**：
```
┌─────────────────────────────────────────────────────┐
│ 测试计划名称        状态      操作                    │
├─────────────────────────────────────────────────────┤
│ SDK功能测试计划  [进行中 ▼]  [执行][编辑][详情][删除] │
│                  ↓ 点击下拉                          │
│              ┌───────────┐                          │
│              │ ○ 未开始   │                          │
│              │ ● 进行中   │                          │
│              │ ○ 已完成   │                          │
│              │ ○ 阻塞     │                          │
│              └───────────┘                          │
└─────────────────────────────────────────────────────┘
```

**效果**：5次点击 → 2次点击（减少60%）

---

#### 优化 #2：智能筛选持久化

```javascript
// 实现方案
const filterPersistence = {
  // 保存到URL参数
  saveToUrl(filters) {
    const params = new URLSearchParams(filters);
    history.pushState(null, '', `?${params}`);
  },
  
  // 页面加载时恢复
  restoreFromUrl() {
    const params = new URLSearchParams(location.search);
    return Object.fromEntries(params);
  },
  
  // 保存到localStorage作为默认值
  saveAsDefault(filters) {
    localStorage.setItem('testplan-filters', JSON.stringify(filters));
  }
};
```

**效果**：用户返回列表时，筛选条件自动恢复

---

#### 优化 #3：键盘优先的快捷操作

```
┌─────────────────────────────────────────────────────┐
│  快捷键映射                                         │
├─────────────────────────────────────────────────────┤
│  N + P     新建测试计划                             │
│  N + C     新建测试用例                             │
│  /         聚焦搜索框                               │
│  ?         显示快捷键帮助                           │
│  J / K     上下移动选中行                           │
│  E         编辑选中项                               │
│  D         删除选中项                               │
│  Enter     打开详情                                 │
│  Esc       关闭弹窗/取消选择                        │
└─────────────────────────────────────────────────────┘
```

**实现代码**：
```javascript
document.addEventListener('keydown', (e) => {
  // 忽略输入框内的按键
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }
  
  const keyMap = {
    'n+p': () => openCreatePlanModal(),
    'n+c': () => openCreateCaseModal(),
    '/': () => document.getElementById('search-input').focus(),
    '?': () => showShortcutHelp(),
    'j': () => selectNextRow(),
    'k': () => selectPrevRow(),
    'e': () => editSelected(),
    'd': () => deleteSelected(),
    'Enter': () => openDetail(),
    'Escape': () => closeModal()
  };
  
  const combo = [];
  if (e.ctrlKey || e.metaKey) combo.push('ctrl');
  if (e.shiftKey) combo.push('shift');
  combo.push(e.key.toLowerCase());
  
  const action = keyMap[combo.join('+')];
  if (action) {
    e.preventDefault();
    action();
  }
});
```

---

## 四、自动化测试落地 (Playwright E2E)

### 4.1 测试环境配置

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### 4.2 核心E2E测试脚本

```typescript
// tests/testplan-crud.spec.ts
import { test, expect, Page } from '@playwright/test';

test.describe('测试计划 CRUD 流程', () => {
  let page: Page;
  const testPlanName = `自动化测试计划_${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    
    // 设置默认超时
    test.setTimeout(60000);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('完整的测试计划创建流程', async () => {
    // ==================== 步骤1：登录 ====================
    await test.step('用户登录', async () => {
      await page.goto('/');
      
      // 等待登录表单出现
      await page.waitForSelector('#login-form', { state: 'visible' });
      
      // 填写登录信息
      await page.fill('#username', 'admin');
      await page.fill('#password', 'ctc@2026.');
      
      // 点击登录按钮
      await page.click('#login-btn');
      
      // 等待登录成功 - 检查导航栏用户信息
      await expect(page.locator('#user-info')).toContainText('admin', {
        timeout: 10000
      });
      
      console.log('✅ 登录成功');
    });

    // ==================== 步骤2：导航到测试计划 ====================
    await test.step('导航到测试计划页面', async () => {
      // 点击侧边栏测试计划链接
      await page.click('a[href="#testplans"]');
      
      // 等待页面加载完成
      await page.waitForSelector('#testplans-section', { state: 'visible' });
      
      // 验证URL变化
      expect(page.url()).toContain('#testplans');
      
      console.log('✅ 导航成功');
    });

    // ==================== 步骤3：打开新建表单 ====================
    await test.step('点击新建测试计划按钮', async () => {
      // 点击新建按钮
      const createBtn = page.locator('button:has-text("新建测试计划")');
      await expect(createBtn).toBeEnabled();
      await createBtn.click();
      
      // 等待模态框出现
      await page.waitForSelector('.modal.show, [role="dialog"]', { 
        state: 'visible',
        timeout: 5000 
      });
      
      console.log('✅ 模态框已打开');
    });

    // ==================== 步骤4：填写表单 ====================
    await test.step('填写测试计划表单', async () => {
      // 填写基本信息
      await page.fill('#plan-name-input', testPlanName);
      await page.fill('#plan-description-input', '这是一个自动化测试创建的计划');
      
      // 选择状态
      await page.selectOption('#plan-status-select', '未开始');
      
      // 选择测试阶段
      await page.selectOption('#plan-phase-select', '集成测试');
      
      // 选择项目（如果有选项）
      const projectSelect = page.locator('#plan-project-select');
      if (await projectSelect.count() > 0) {
        const options = await projectSelect.locator('option').count();
        if (options > 1) {
          await projectSelect.selectOption({ index: 1 });
        }
      }
      
      // 设置日期
      const today = new Date().toISOString().split('T')[0];
      await page.fill('#plan-start-date', today);
      
      const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await page.fill('#plan-end-date', endDate);
      
      console.log('✅ 表单填写完成');
    });

    // ==================== 步骤5：提交保存 ====================
    await test.step('保存测试计划', async () => {
      // 监听API响应
      const responsePromise = page.waitForResponse(
        response => response.url().includes('/api/testplans/create') && response.request().method() === 'POST'
      );
      
      // 点击保存按钮
      await page.click('button:has-text("保存")');
      
      // 等待API响应
      const response = await responsePromise;
      const responseBody = await response.json();
      
      // 验证API返回
      expect(responseBody.success).toBe(true);
      
      // 等待模态框关闭
      await page.waitForSelector('.modal.show, [role="dialog"]', { 
        state: 'hidden',
        timeout: 5000 
      });
      
      console.log('✅ 测试计划保存成功');
    });

    // ==================== 步骤6：验证列表显示 ====================
    await test.step('验证列表中出现新计划', async () => {
      // 等待列表刷新
      await page.waitForTimeout(1000);
      
      // 查找新创建的计划
      const planRow = page.locator(`tr:has-text("${testPlanName}")`);
      
      // 使用重试机制
      await expect(planRow).toBeVisible({ timeout: 10000 });
      
      // 验证计划名称
      await expect(planRow.locator('td:first-child')).toContainText(testPlanName);
      
      console.log('✅ 列表中找到新计划');
    });

    // ==================== 步骤7：验证状态标签颜色 ====================
    await test.step('验证状态标签样式', async () => {
      const planRow = page.locator(`tr:has-text("${testPlanName}")`);
      
      // 获取状态标签元素
      const statusTag = planRow.locator('.status-tag');
      
      // 验证状态文本
      await expect(statusTag).toContainText('未开始');
      
      // 验证CSS类名
      const className = await statusTag.getAttribute('class');
      expect(className).toContain('status-tag-pending');
      
      // 验证背景色（通过计算样式）
      const bgColor = await statusTag.evaluate(el => 
        window.getComputedStyle(el).backgroundColor
      );
      
      // 浅色模式下应为橙色系
      // RGB格式验证（允许一定误差）
      const colorMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (colorMatch) {
        const [, r, g, b] = colorMatch.map(Number);
        // 橙色系：R较高，G中等，B较低
        expect(r).toBeGreaterThan(200);
        expect(g).toBeGreaterThan(100);
        expect(b).toBeLessThan(100);
      }
      
      console.log('✅ 状态标签样式正确');
    });

    // ==================== 步骤8：清理测试数据 ====================
    await test.step('清理测试数据', async () => {
      const planRow = page.locator(`tr:has-text("${testPlanName}")`);
      
      // 点击删除按钮
      await planRow.locator('button:has-text("删除"), .delete-btn').click();
      
      // 确认删除
      page.on('dialog', dialog => dialog.accept());
      
      // 等待删除完成
      await page.waitForTimeout(1000);
      
      // 验证已删除
      await expect(page.locator(`tr:has-text("${testPlanName}")`)).not.toBeVisible({
        timeout: 5000
      });
      
      console.log('✅ 测试数据已清理');
    });
  });

  // ==================== 边界测试用例 ====================
  test('边界测试：超长名称处理', async () => {
    // 登录
    await page.goto('/');
    await page.waitForSelector('#login-form', { state: 'visible' });
    await page.fill('#username', 'admin');
    await page.fill('#password', 'ctc@2026.');
    await page.click('#login-btn');
    await page.waitForSelector('#user-info');
    
    // 导航
    await page.click('a[href="#testplans"]');
    await page.waitForSelector('#testplans-section');
    
    // 打开新建表单
    await page.click('button:has-text("新建测试计划")');
    await page.waitForSelector('.modal.show, [role="dialog"]');
    
    // 输入超长名称（10000字符）
    const longName = 'A'.repeat(10000);
    await page.fill('#plan-name-input', longName);
    
    // 尝试保存
    await page.click('button:has-text("保存")');
    
    // 验证：应该显示错误提示或截断处理
    const errorMessage = page.locator('.error-message, .toast-error');
    const hasError = await errorMessage.count() > 0;
    
    if (hasError) {
      console.log('✅ 正确拒绝超长输入');
    } else {
      // 检查是否被截断
      const savedName = await page.locator('#plan-name-input').inputValue();
      expect(savedName.length).toBeLessThanOrEqual(255);
      console.log('✅ 输入被正确截断');
    }
  });

  // ==================== 并发测试 ====================
  test('并发测试：同时创建多个计划', async () => {
    // 登录
    await page.goto('/');
    await page.waitForSelector('#login-form', { state: 'visible' });
    await page.fill('#username', 'admin');
    await page.fill('#password', 'ctc@2026.');
    await page.click('#login-btn');
    await page.waitForSelector('#user-info');
    
    // 模拟并发创建（通过API直接调用）
    const createPromises = Array(10).fill(null).map((_, i) => 
      fetch('/api/testplans/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `并发测试计划_${Date.now()}_${i}`,
          owner: 'admin',
          status: '未开始'
        })
      })
    );
    
    // 注意：这里需要获取认证token
    // 实际测试中应从cookie或localStorage获取
    
    console.log('⚠️ 并发测试需要认证token，此处仅作演示');
  });
});
```

### 4.3 测试工具函数

```typescript
// tests/helpers/test-helpers.ts
import { Page } from '@playwright/test';

export class TestHelper {
  constructor(private page: Page) {}

  // 登录辅助函数
  async login(username: string, password: string) {
    await this.page.goto('/');
    await this.page.waitForSelector('#login-form', { state: 'visible' });
    await this.page.fill('#username', username);
    await this.page.fill('#password', password);
    await this.page.click('#login-btn');
    await this.page.waitForSelector('#user-info');
  }

  // 等待Toast消息
  async waitForToast(type: 'success' | 'error' | 'warning', timeout = 5000) {
    const selector = `.toast-${type}, .message-${type}`;
    await this.page.waitForSelector(selector, { state: 'visible', timeout });
  }

  // 重试操作
  async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delay = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        await this.page.waitForTimeout(delay);
      }
    }
    
    throw lastError;
  }

  // 获取认证Token
  async getAuthToken(): Promise<string> {
    const token = await this.page.evaluate(() => {
      return localStorage.getItem('authToken') || 
             document.cookie.match(/authToken=([^;]+)/)?.[1] || '';
    });
    return token;
  }

  // 模拟网络延迟
  async simulateNetworkDelay(ms: number) {
    await this.page.route('**/api/**', route => {
      setTimeout(() => route.continue(), ms);
    });
  }

  // 截图对比
  async compareScreenshot(name: string) {
    await expect(this.page).toHaveScreenshot(`${name}.png`, {
      maxDiffPixels: 100,
    });
  }
}
```

### 4.4 运行测试

```bash
# 安装依赖
npm install -D @playwright/test

# 安装浏览器
npx playwright install

# 运行所有测试
npx playwright test

# 运行特定测试文件
npx playwright test tests/testplan-crud.spec.ts

# 生成HTML报告
npx playwright show-report

# 调试模式
npx playwright test --debug
```

---

## 五、总结与优先级建议

### 5.1 问题优先级矩阵

| 优先级 | 问题类型 | 数量 | 建议处理时间 |
|--------|----------|------|--------------|
| 🔴 P0 | 数据完整性/安全漏洞 | 2 | 立即修复 |
| 🟠 P1 | 业务逻辑漏洞 | 3 | 1周内 |
| 🟡 P2 | UX优化 | 3 | 2周内 |
| 🟢 P3 | 边界测试 | 多项 | 迭代优化 |

### 5.2 快速修复建议

1. **添加服务端数据校验**
```javascript
// routes/testplans.js 中添加
function validateTestPlan(data) {
  const errors = [];
  
  if (!data.name || data.name.length > 255) {
    errors.push('名称必填且不超过255字符');
  }
  
  if (data.pass_rate < 0 || data.pass_rate > 100) {
    errors.push('通过率必须在0-100之间');
  }
  
  if (data.tested_cases < 0 || data.total_cases < 0) {
    errors.push('用例数不能为负数');
  }
  
  if (data.tested_cases > data.total_cases) {
    errors.push('已测试数不能超过总数');
  }
  
  return errors;
}
```

2. **添加项目删除前的关联检查**
```javascript
// routes/projects.js 中修改删除逻辑
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  
  // 检查是否有关联的测试计划
  const [relatedPlans] = await pool.execute(
    'SELECT COUNT(*) as count FROM test_plans WHERE project = (SELECT code FROM projects WHERE id = ?)',
    [id]
  );
  
  if (relatedPlans[0].count > 0) {
    return res.status(400).json({ 
      success: false, 
      message: `该项目关联了 ${relatedPlans[0].count} 个测试计划，请先处理关联数据` 
    });
  }
  
  // 继续删除...
});
```

---

**报告完成** ✅
