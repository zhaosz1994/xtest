const pool = require('../db');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const REPORTS_DIR = path.join(process.cwd(), 'uploads', 'reports');

if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// ==================== 统一的状态判定函数 ====================
// 消除统计分布 Bug，确保所有状态检查逻辑一致

const PASSED_STATUS_SET = new Set(['pass', '通过', 'passed', '成功']);
const FAILED_STATUS_SET = new Set(['fail', '失败', 'failed', 'asic_hang', 'core_dump', 'traffic_drop', 'asic hang', 'core dump', 'traffic drop']);
const BLOCKED_STATUS_SET = new Set(['blocked', '阻塞', 'block']);

function normalizeStatus(status) {
    if (!status) return '';
    return String(status).toLowerCase().trim();
}

function isStatusPassed(status) {
    return PASSED_STATUS_SET.has(normalizeStatus(status));
}

function isStatusFailed(status) {
    return FAILED_STATUS_SET.has(normalizeStatus(status));
}

function isStatusBlocked(status) {
    return BLOCKED_STATUS_SET.has(normalizeStatus(status));
}

function getStatusCategory(status) {
    if (isStatusPassed(status)) return 'passed';
    if (isStatusFailed(status)) return 'failed';
    if (isStatusBlocked(status)) return 'blocked';
    return 'notRun';
}

const HARDWARE_KNOWLEDGE = `
## PFC帧与Buffer行为领域知识

### PFC (Priority Flow Control) 帧机制
PFC是IEEE 802.1Qbb标准定义的链路层流控机制，用于在以太网网络上实现无损传输。

#### 核心原理
1. **优先级队列控制**: PFC对每个优先级队列(0-7)独立控制，允许针对特定优先级暂停流量
2. **PAUSE帧结构**: 
   - 目的MAC: 01:80:C2:00:00:01 (组播地址)
   - EtherType: 0x8808
   - OpCode: 0x0001
   - Pause Time: 每个优先级的暂停时间(0-65535)

3. **触发条件**: 当接收端buffer使用超过阈值时，发送PFC PAUSE帧请求发送端暂停

### Buffer行为分析
#### Ingress Buffer (入向缓冲)
- **功能**: 存储从端口接收的数据帧，等待转发处理
- **关键参数**:
  - Headroom Buffer: PFC触发后额外缓冲空间
  - Shared Buffer: 多端口共享缓冲池
  - PG (Priority Group) Buffer: 每个优先级组的专用缓冲

#### Egress Buffer (出向缓冲)
- **功能**: 存储待发送的数据帧
- **关键参数**:
  - Queue Buffer: 每个队列的缓冲空间
  - MC Buffer: 组播专用缓冲
  - CPU Buffer: CPU控制报文缓冲

### 常见测试场景
1. **PFC风暴测试**: 验证持续PFC PAUSE下的buffer行为
2. **Headroom溢出测试**: 验证headroom buffer耗尽时的丢包行为
3. **XOFF/XON时序测试**: 验证PAUSE帧发送和恢复的时序
4. **多优先级冲突测试**: 验证多个优先级同时触发PFC时的资源竞争

### 性能指标
- **PFC触发延迟**: 从buffer阈值越限到PAUSE帧发出的时间
- **Headroom利用率**: PFC触发后headroom buffer的使用效率
- **无损队列保证**: 确保高优先级流量零丢包
`;

async function assembleReportData(testPlanId) {
    const connection = await pool.getConnection();
    
    try {
        const [testPlans] = await connection.execute(`
            SELECT tp.*, 
                   p.name as project_name,
                   ts.name as software_name,
                   tph.name as phase_name,
                   tpso.name as test_software_name
            FROM test_plans tp
            LEFT JOIN projects p ON tp.project = p.name
            LEFT JOIN test_softwares ts ON tp.software_id = ts.id
            LEFT JOIN test_phases tph ON tp.stage_id = tph.id
            LEFT JOIN test_softwares tpso ON tp.software_id = tpso.id
            WHERE tp.id = ?
        `, [testPlanId]);
        
        if (testPlans.length === 0) {
            throw new Error('测试计划不存在');
        }
        
        const testPlan = testPlans[0];
        
        const [testCases] = await connection.execute(`
            SELECT tc.*, 
                   m.name as module_name,
                   l1.name as level1_name,
                   tpc.status as execution_status,
                   tpc.executor_id,
                   tpc.error_message,
                   tpc.execution_time,
                   ts.name as status_name
            FROM test_plan_cases tpc
            INNER JOIN test_cases tc ON tpc.case_id = tc.id
            LEFT JOIN modules m ON tc.module_id = m.id
            LEFT JOIN level1_points l1 ON tc.level1_id = l1.id
            LEFT JOIN test_statuses ts ON tpc.status = ts.name
            WHERE tpc.plan_id = ?
        `, [testPlanId]);
        
        const stats = calculateStatistics(testCases);
        
        const moduleStats = {};
        const ownerStats = {};
        
        testCases.forEach(tc => {
            const moduleName = tc.module_name || '未分类';
            if (!moduleStats[moduleName]) {
                moduleStats[moduleName] = { total: 0, passed: 0, failed: 0, blocked: 0, notRun: 0 };
            }
            moduleStats[moduleName].total++;
            
            const status = tc.execution_status || tc.status_name || '';
            const category = getStatusCategory(status);
            
            if (category === 'passed') {
                moduleStats[moduleName].passed++;
            } else if (category === 'failed') {
                moduleStats[moduleName].failed++;
            } else if (category === 'blocked') {
                moduleStats[moduleName].blocked++;
            } else {
                moduleStats[moduleName].notRun++;
            }
            
            const owner = tc.owner || tc.executor_id || '未分配';
            if (!ownerStats[owner]) {
                ownerStats[owner] = 0;
            }
            ownerStats[owner]++;
        });
        
        const priorityStats = {};
        testCases.forEach(tc => {
            const priority = tc.priority || 'P2';
            if (!priorityStats[priority]) {
                priorityStats[priority] = { total: 0, passed: 0, failed: 0 };
            }
            priorityStats[priority].total++;
            
            const status = tc.execution_status || tc.status_name || '';
            if (isStatusPassed(status)) {
                priorityStats[priority].passed++;
            } else if (isStatusFailed(status)) {
                priorityStats[priority].failed++;
            }
        });
        
        const ownerDistribution = calculateOwnerDistribution(ownerStats, testCases.length);
        
        const duration = calculateTestDuration(
            testPlan.start_date || testPlan.actual_start_time,
            testPlan.end_date || testPlan.actual_end_time
        );
        
        const failedCases = testCases.filter(tc => {
            const status = tc.execution_status || tc.status_name || '';
            return isStatusFailed(status);
        }).map(tc => ({
            id: tc.id,
            caseId: tc.case_id,
            name: tc.name,
            module: tc.module_name,
            priority: tc.priority,
            owner: tc.owner || tc.executor_id,
            bugId: tc.bug_id
        }));
        
        return {
            testPlan: {
                id: testPlan.id,
                name: testPlan.name || '未命名测试计划',
                owner: testPlan.owner || '未分配',
                ownerDistribution: ownerDistribution,
                project: testPlan.project || '未知项目',
                iteration: testPlan.iteration || '-',
                testPhase: testPlan.phase_name || testPlan.test_phase || '-',
                startDate: testPlan.start_date || testPlan.actual_start_time,
                endDate: testPlan.end_date || testPlan.actual_end_time,
                software: testPlan.software_name || '-',
                softwareVersion: testPlan.software_version || '-',
                description: testPlan.description || '-',
                duration: duration
            },
            statistics: stats,
            moduleDistribution: moduleStats,
            priorityDistribution: priorityStats,
            ownerDistribution: ownerDistribution,
            failedCases: failedCases,
            testCases: testCases.map(tc => ({
                id: tc.id,
                caseId: tc.case_id,
                name: tc.name,
                module: tc.module_name,
                level1: tc.level1_name,
                priority: tc.priority,
                type: tc.type,
                status: tc.execution_status || tc.status_name,
                progress: tc.progress_name,
                owner: tc.owner || tc.executor_id,
                steps: tc.steps,
                expected: tc.expected,
                bugId: tc.bug_id,
                executionStatus: tc.execution_status
            }))
        };
    } finally {
        connection.release();
    }
}

function calculateOwnerDistribution(ownerStats, totalCases) {
    if (!totalCases || totalCases === 0) {
        return [];
    }
    
    const owners = Object.entries(ownerStats).map(([owner, count]) => ({
        owner,
        count,
        percentage: (count / totalCases) * 100
    }));
    
    owners.sort((a, b) => b.count - a.count);
    
    let totalPercentage = 0;
    owners.forEach((item, index) => {
        if (index === owners.length - 1) {
            item.percentage = Math.round((100 - totalPercentage) * 10) / 10;
        } else {
            item.percentage = Math.round(item.percentage * 10) / 10;
            totalPercentage += item.percentage;
        }
    });
    
    return owners;
}

function formatOwnerDisplay(ownerDistribution) {
    if (!ownerDistribution || ownerDistribution.length === 0) {
        return '未分配';
    }
    return ownerDistribution.map(o => `${o.owner} (${o.percentage}%)`).join(', ');
}

function calculateTestDuration(startDate, endDate) {
    if (!startDate) {
        return null;
    }
    
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    
    const diffMs = Math.abs(end - start);
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    const formatDate = (date) => {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    
    // 精细化时长显示
    let display = '';
    if (diffDays > 0) {
        const remainHours = diffHours % 24;
        display = `${diffDays} 天 ${remainHours} 小时`;
    } else if (diffHours > 0) {
        const remainMinutes = diffMinutes % 60;
        display = `${diffHours} 小时 ${remainMinutes} 分钟`;
    } else if (diffMinutes > 0) {
        const remainSeconds = diffSeconds % 60;
        display = `${diffMinutes} 分钟 ${remainSeconds} 秒`;
    } else {
        display = `${diffSeconds} 秒`;
    }
    
    return {
        days: diffDays,
        hours: diffHours,
        minutes: diffMinutes,
        seconds: diffSeconds,
        startDate: formatDate(start),
        endDate: endDate ? formatDate(end) : '进行中',
        display: `${display} (${formatDate(start)} 至 ${endDate ? formatDate(end) : '进行中'})`
    };
}

function calculateStatistics(testCases) {
    const stats = {
        total: testCases.length,
        passed: 0,
        failed: 0,
        blocked: 0,
        notRun: 0,
        passRate: 0,
        severeDefects: 0
    };
    
    testCases.forEach(tc => {
        const status = tc.status_name || tc.status || tc.execution_status || '';
        const priority = (tc.priority || '').toUpperCase();
        const category = getStatusCategory(status);
        
        if (category === 'passed') {
            stats.passed++;
        } else if (category === 'failed') {
            stats.failed++;
            if (priority === 'P0' || priority === 'P1') {
                stats.severeDefects++;
            }
        } else if (category === 'blocked') {
            stats.blocked++;
        } else {
            stats.notRun++;
        }
    });
    
    const executed = stats.passed + stats.failed + stats.blocked;
    stats.passRate = executed > 0 ? ((stats.passed / executed) * 100).toFixed(2) : 0;
    
    return stats;
}

function generateMarkdownReport(reportData, aiAnalysis) {
    const { testPlan, statistics, moduleDistribution, priorityDistribution, ownerDistribution, failedCases } = reportData;
    
    const formatDate = (date) => {
        if (!date) return '-';
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    
    const ownerDisplay = formatOwnerDisplay(ownerDistribution);
    
    const durationDisplay = testPlan.duration 
        ? testPlan.duration.display 
        : '-';
    
    const softwareDisplay = testPlan.softwareVersion && testPlan.softwareVersion !== '-'
        ? `${testPlan.software} (v${testPlan.softwareVersion})`
        : (testPlan.software || '-');
    
    let markdown = `# ${testPlan.project || '测试项目'} 测试报告

---

## 一、测试信息

### 1.1 基本信息

| 项目 | 内容 |
|------|------|
| **项目名称** | ${testPlan.project || '-'} |
| **测试计划** | ${testPlan.name || '-'} |
| **测试阶段** | ${testPlan.testPhase || '-'} |
| **测试迭代** | ${testPlan.iteration || '-'} |
| **测试软件** | ${softwareDisplay} |
| **测试负责人** | ${ownerDisplay} |
| **测试工期** | ${durationDisplay} |
| **开始时间** | ${formatDate(testPlan.startDate)} |
| **结束时间** | ${formatDate(testPlan.endDate)} |

### 1.2 测试执行概况

| 指标 | 数值 |
|------|------|
| **用例总数** | ${statistics.total.toLocaleString()} |
| **通过数** | ${statistics.passed.toLocaleString()} |
| **失败数** | ${statistics.failed.toLocaleString()} |
| **阻塞数** | ${statistics.blocked.toLocaleString()} |
| **未执行** | ${statistics.notRun.toLocaleString()} |
| **通过率** | ${statistics.passRate}% |

### 1.3 模块覆盖情况

| 模块名称 | 用例数 | 通过 | 失败 | 阻塞 | 未执行 | 通过率 |
|----------|--------|------|------|------|--------|--------|
`;
    
    const sortedModules = Object.entries(moduleDistribution)
        .sort((a, b) => b[1].total - a[1].total);
    
    sortedModules.forEach(([moduleName, stats]) => {
        const executed = stats.passed + stats.failed + stats.blocked;
        const rate = executed > 0 ? ((stats.passed / executed) * 100).toFixed(1) : 0;
        markdown += `| ${moduleName} | ${stats.total.toLocaleString()} | ${stats.passed.toLocaleString()} | ${stats.failed.toLocaleString()} | ${stats.blocked.toLocaleString()} | ${stats.notRun.toLocaleString()} | ${rate}% |\n`;
    });
    
    if (failedCases && failedCases.length > 0) {
        markdown += `
### 1.4 失败用例清单

| 序号 | 用例ID | 用例名称 | 模块 | 优先级 | 负责人 | 关联Bug |
|------|--------|----------|------|--------|--------|--------|
`;
        failedCases.slice(0, 100).forEach((tc, index) => {
            const bugLink = tc.bugId ? `[${tc.bugId}](bug-link:${tc.bugId})` : '-';
            markdown += `| ${index + 1} | ${tc.caseId || tc.id} | ${tc.name} | ${tc.module || '-'} | ${tc.priority || '-'} | ${tc.owner || '-'} | ${bugLink} |\n`;
        });
        
        if (failedCases.length > 100) {
            markdown += `\n> 注：仅显示前100条失败用例，共 ${failedCases.length} 条。\n`;
        }
    }
    
    markdown += `
---

## 二、总结与评估

${aiAnalysis?.summary || `### 测试策略

本次测试覆盖了主要功能模块，测试范围包括核心业务流程验证。

### 测试总结

本次测试按计划完成，测试覆盖了主要功能模块。`}

${aiAnalysis?.riskAnalysis || `### 遗留重要问题

当前测试结果整体稳定，主要风险点已识别并记录。`}

${aiAnalysis?.suggestions || `### 测试限制

1. 部分边界条件未能覆盖
2. 性能测试场景有限
3. 需要补充异常场景测试`}

---

## 三、Bug统计

### 3.1 按优先级分布

| 优先级 | 用例总数 | 通过 | 失败 | 失败率 |
|--------|----------|------|------|--------|
`;
    
    Object.entries(priorityDistribution).forEach(([priority, stats]) => {
        const failRate = stats.total > 0 ? ((stats.failed / stats.total) * 100).toFixed(1) : 0;
        markdown += `| ${priority} | ${stats.total} | ${stats.passed} | ${stats.failed} | ${failRate}% |\n`;
    });
    
    markdown += `
### 3.2 失败用例清单

| 用例ID | 用例名称 | 模块 | 优先级 | 失败原因 |
|--------|----------|------|--------|----------|
`;
    
    const allFailedCases = reportData.testCases.filter(tc => {
        const status = tc.status || tc.execution_status || tc.status_name || '';
        return isStatusFailed(status);
    });
    
    // 限制显示数量，防止内存爆炸
    const MAX_FAILED_CASES_DISPLAY = 100;
    
    if (allFailedCases.length > 0) {
        const displayCases = allFailedCases.slice(0, MAX_FAILED_CASES_DISPLAY);
        displayCases.forEach(tc => {
            markdown += `| ${tc.caseId || tc.id} | ${tc.name} | ${tc.module || '-'} | ${tc.priority} | 待分析 |\n`;
        });
        
        if (allFailedCases.length > MAX_FAILED_CASES_DISPLAY) {
            markdown += `| ... | **还有 ${allFailedCases.length - MAX_FAILED_CASES_DISPLAY} 条失败用例未显示** | ... | ... | 请在 xTest 平台上查看详情 |\n`;
        }
    } else {
        markdown += `| - | 暂无失败用例 | - | - | - |\n`;
    }
    
    markdown += `
---

*报告生成时间: ${new Date().toLocaleString('zh-CN')}*
*本报告由 xTest AI 自动生成*
`;
    
    return markdown;
}

function getHardwareKnowledge() {
    return HARDWARE_KNOWLEDGE;
}

async function saveReportToFile(reportId, markdownContent) {
    const fileName = `report-${reportId}-${Date.now()}.md`;
    const filePath = path.join(REPORTS_DIR, fileName);
    await fsPromises.writeFile(filePath, markdownContent, 'utf8');
    return filePath;
}

async function readReportFromFile(filePath) {
    try {
        await fsPromises.access(filePath);
        return await fsPromises.readFile(filePath, 'utf8');
    } catch {
        return null;
    }
}

async function deleteReportFile(filePath) {
    try {
        await fsPromises.unlink(filePath);
    } catch {
        // 文件不存在或删除失败，忽略
    }
}

module.exports = {
    assembleReportData,
    generateMarkdownReport,
    calculateStatistics,
    calculateOwnerDistribution,
    formatOwnerDisplay,
    calculateTestDuration,
    getHardwareKnowledge,
    saveReportToFile,
    readReportFromFile,
    deleteReportFile,
    REPORTS_DIR
};
