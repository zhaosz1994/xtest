require('dotenv').config();
const mysql = require('mysql2/promise');

const LIBRARY_COUNT = 12;
const MODULES_PER_LIBRARY = 55;
const LEVEL1_PER_MODULE = 55;
const CASES_PER_LEVEL1 = 105;

const SWITCH_CHIP_MODULES = [
    { name: 'ACL', desc: 'Access Control List - 访问控制列表' },
    { name: 'VLAN', desc: 'Virtual LAN - 虚拟局域网' },
    { name: 'LAG', desc: 'Link Aggregation Group - 链路聚合组' },
    { name: 'QoS', desc: 'Quality of Service - 服务质量' },
    { name: 'Mirror', desc: 'Port Mirroring - 端口镜像' },
    { name: 'STP', desc: 'Spanning Tree Protocol - 生成树协议' },
    { name: 'L2Forward', desc: 'Layer 2 Forwarding - 二层转发' },
    { name: 'L3Forward', desc: 'Layer 3 Forwarding - 三层转发' },
    { name: 'Routing', desc: 'Routing Protocol - 路由协议' },
    { name: 'MPLS', desc: 'Multi-Protocol Label Switching - 多协议标签交换' },
    { name: 'BGP', desc: 'Border Gateway Protocol - 边界网关协议' },
    { name: 'OSPF', desc: 'Open Shortest Path First - 开放最短路径优先' },
    { name: 'ISIS', desc: 'Intermediate System to Intermediate System - 中间系统到中间系统' },
    { name: 'PIM', desc: 'Protocol Independent Multicast - 协议无关组播' },
    { name: 'IGMP', desc: 'Internet Group Management Protocol - 因特网组管理协议' },
    { name: 'Policer', desc: 'Traffic Policing - 流量监管' },
    { name: 'Queue', desc: 'Queue Management - 队列管理' },
    { name: 'Buffer', desc: 'Buffer Management - 缓冲区管理' },
    { name: 'Scheduler', desc: 'Traffic Scheduler - 流量调度器' },
    { name: 'WRED', desc: 'Weighted Random Early Detection - 加权随机早期检测' },
    { name: 'ECMP', desc: 'Equal-Cost Multi-Path - 等价多路径' },
    { name: 'FDB', desc: 'Forwarding Database - 转发数据库' },
    { name: 'ARP', desc: 'Address Resolution Protocol - 地址解析协议' },
    { name: 'ND', desc: 'Neighbor Discovery - 邻居发现' },
    { name: 'DHCP', desc: 'Dynamic Host Configuration Protocol - 动态主机配置协议' },
    { name: 'NAT', desc: 'Network Address Translation - 网络地址转换' },
    { name: 'Tunnel', desc: 'Tunneling - 隧道技术' },
    { name: 'IPSec', desc: 'IP Security - IP安全协议' },
    { name: 'VXLAN', desc: 'Virtual Extensible LAN - 虚拟扩展局域网' },
    { name: 'NVGRE', desc: 'Network Virtualization using Generic Routing Encapsulation' },
    { name: 'GRE', desc: 'Generic Routing Encapsulation - 通用路由封装' },
    { name: 'L2TP', desc: 'Layer 2 Tunneling Protocol - 二层隧道协议' },
    { name: 'PTP', desc: 'Precision Time Protocol - 精确时间协议' },
    { name: 'SyncE', desc: 'Synchronous Ethernet - 同步以太网' },
    { name: 'BFD', desc: 'Bidirectional Forwarding Detection - 双向转发检测' },
    { name: 'Y1731', desc: 'ITU-T Y.1731 - OAM性能监测' },
    { name: 'CFM', desc: 'Connectivity Fault Management - 连接故障管理' },
    { name: 'LACP', desc: 'Link Aggregation Control Protocol - 链路聚合控制协议' },
    { name: 'LLDP', desc: 'Link Layer Discovery Protocol - 链路层发现协议' },
    { name: 'PoE', desc: 'Power over Ethernet - 以太网供电' },
    { name: 'Port', desc: 'Port Management - 端口管理' },
    { name: 'Link', desc: 'Link Management - 链路管理' },
    { name: 'Phy', desc: 'Physical Layer - 物理层' },
    { name: 'MAC', desc: 'MAC Address Table - MAC地址表' },
    { name: 'IPMC', desc: 'IP Multicast - IP组播' },
    { name: 'L2MC', desc: 'Layer 2 Multicast - 二层组播' },
    { name: 'MCGroup', desc: 'Multicast Group Management - 组播组管理' },
    { name: 'HostIf', desc: 'Host Interface - 主机接口' },
    { name: 'CPU', desc: 'CPU Queue - CPU队列' },
    { name: 'Exception', desc: 'Exception Packet - 异常报文处理' },
    { name: 'Counter', desc: 'Statistics Counter - 统计计数器' },
    { name: 'Sample', desc: 'Packet Sampling - 报文采样' },
    { name: 'Hash', desc: 'Hash Algorithm - 哈希算法' },
    { name: 'FlexParser', desc: 'Flexible Parser - 灵活解析器' },
    { name: 'TunnelEncap', desc: 'Tunnel Encapsulation - 隧道封装' },
    { name: 'TunnelDecap', desc: 'Tunnel Decapsulation - 隧道解封装' },
    { name: 'Ingress', desc: 'Ingress Processing - 入口处理' },
    { name: 'Egress', desc: 'Egress Processing - 出口处理' },
    { name: 'Pipeline', desc: 'Pipeline Processing - 流水线处理' },
    { name: 'TCAM', desc: 'Ternary Content Addressable Memory - 三态内容寻址存储器' },
    { name: 'SRAM', desc: 'Static Random Access Memory - 静态随机存取存储器' }
];

const TEST_TYPES = ['功能测试', '性能测试', '压力测试', '规格测试'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const METHODS = ['自动化', '手动'];
const STATUSES = ['维护中', '评审中', '已归档', '待评审'];
const TEST_POINTS = [
    '基本功能验证', '边界值测试', '异常处理测试', '性能基准测试',
    '压力测试', '稳定性测试', '兼容性测试', '回归测试',
    '配置测试', '接口测试', '协议一致性测试', '互操作性测试',
    '负向测试', '正向测试', '并发测试', '长时间运行测试'
];

const LIBRARY_NAMES = [
    'CTCSDK基础测试库', 'CTCSDK高级测试库', 'SAI标准测试库',
    'SAI扩展测试库', 'Cmodel仿真测试库', 'Cmodel验证测试库',
    'ECPU功能测试库', 'ECPU性能测试库', '系统集成测试库',
    '回归测试库', '自动化测试库', '压力测试库'
];

const PROJECT_NAMES = ['U12项目', 'U13项目', 'U14项目', 'U15项目', 'U16项目', 'U17项目', 'U18项目', 'U19项目', 'U20项目', 'U21项目'];
const CHIP_NAMES = ['CTC7132', 'CTC7160', 'CTC7180', 'CTC8096', 'CTC8180', 'CTC8182', 'CTC8184', 'CTC8186', 'CTC8188', 'CTC8190'];

function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

let moduleCounter = 0;
let level1Counter = 0;
let caseCounter = 0;

function generateId(prefix) {
    if (prefix === 'MOD') {
        moduleCounter++;
        return `${prefix}-${Date.now()}-${moduleCounter}`;
    }
    if (prefix === 'LP') {
        level1Counter++;
        return `${prefix}-${Date.now()}-${level1Counter}`;
    }
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function generateCaseId() {
    caseCounter++;
    return `CASE-${Date.now()}-${caseCounter}`;
}
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function seedDatabase() {
    let connection;
    const startTime = Date.now();
    
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'zsz12345',
            database: process.env.DB_NAME || 'ctcsdk_testplan'
        });

        console.log('========================================');
        console.log('开始填充交换机芯片测试数据...');
        console.log(`目标: ${LIBRARY_COUNT}个用例库, 每库${MODULES_PER_LIBRARY}个模块, 每模块${LEVEL1_PER_MODULE}个一级测试点, 每测试点${CASES_PER_LEVEL1}个用例`);
        console.log('========================================\n');

        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        await connection.query('START TRANSACTION');

        const [existingUsers] = await connection.execute('SELECT id, username FROM users');
        const users = existingUsers.map(u => u.username);
        console.log(`已有用户: ${users.join(', ')}`);

        const [existingProjects] = await connection.execute('SELECT id FROM projects');
        let projectId = existingProjects.length > 0 ? existingProjects[0].id : null;
        
        if (!projectId) {
            for (const projName of PROJECT_NAMES) {
                const [result] = await connection.execute(
                    'INSERT INTO projects (name, code, description) VALUES (?, ?, ?)',
                    [projName, projName.replace('项目', ''), `${projName}测试项目`]
                );
            }
            const [newProjects] = await connection.execute('SELECT id FROM projects');
            projectId = newProjects[0].id;
        }
        console.log(`项目ID: ${projectId}`);

        const [existingChips] = await connection.execute('SELECT id FROM chips');
        if (existingChips.length < CHIP_NAMES.length) {
            for (const chipName of CHIP_NAMES) {
                const [existing] = await connection.execute('SELECT id FROM chips WHERE name = ?', [chipName]);
                if (existing.length === 0) {
                    await connection.execute(
                        'INSERT INTO chips (chip_id, name, description) VALUES (?, ?, ?)',
                        [generateId('CHIP'), chipName, `${chipName}交换机芯片`]
                    );
                }
            }
        }
        const [chips] = await connection.execute('SELECT id FROM chips');
        const chipIds = chips.map(c => c.id);
        console.log(`芯片数量: ${chipIds.length}`);

        const [progressRows] = await connection.execute('SELECT id FROM test_progresses');
        const progressIds = progressRows.map(p => p.id);
        const [statusRows] = await connection.execute('SELECT id FROM test_statuses');
        const statusIds = statusRows.map(s => s.id);
        const [typeRows] = await connection.execute('SELECT id FROM test_types');
        const typeIds = typeRows.map(t => t.id);
        const [phaseRows] = await connection.execute('SELECT id FROM test_phases');
        const phaseIds = phaseRows.map(p => p.id);
        const [envRows] = await connection.execute('SELECT id FROM environments');
        const envIds = envRows.map(e => e.id);
        const [methodRows] = await connection.execute('SELECT id FROM test_methods');
        const methodIds = methodRows.map(m => m.id);
        const [softwareRows] = await connection.execute('SELECT id FROM test_softwares');
        const softwareIds = softwareRows.map(s => s.id);

        console.log('\n--- 开始创建用例库 ---');
        const libraryIds = [];
        
        for (let i = 0; i < LIBRARY_COUNT; i++) {
            const libName = LIBRARY_NAMES[i] || `测试用例库${i + 1}`;
            const [result] = await connection.execute(
                'INSERT INTO case_libraries (name, creator) VALUES (?, ?)',
                [libName, randomItem(users)]
            );
            libraryIds.push(result.insertId);
            console.log(`[${i + 1}/${LIBRARY_COUNT}] 创建用例库: ${libName}`);
        }

        let totalModules = 0;
        let totalLevel1 = 0;
        let totalCases = 0;
        let totalCaseProjects = 0;

        console.log('\n--- 开始创建模块、一级测试点和测试用例 ---');

        for (let libIdx = 0; libIdx < libraryIds.length; libIdx++) {
            const libraryId = libraryIds[libIdx];
            const libName = LIBRARY_NAMES[libIdx] || `测试用例库${libIdx + 1}`;
            console.log(`\n=== 处理用例库 [${libIdx + 1}/${LIBRARY_COUNT}]: ${libName} ===`);

            for (let modIdx = 0; modIdx < MODULES_PER_LIBRARY; modIdx++) {
                const moduleInfo = SWITCH_CHIP_MODULES[modIdx % SWITCH_CHIP_MODULES.length];
                const moduleName = `${moduleInfo.name}_${libIdx + 1}_${modIdx + 1}`;
                const moduleId = generateId('MOD');

                const [modResult] = await connection.execute(
                    'INSERT INTO modules (module_id, name, library_id, order_index) VALUES (?, ?, ?, ?)',
                    [moduleId, moduleName, libraryId, modIdx]
                );
                const modId = modResult.insertId;
                totalModules++;

                if (totalModules % 100 === 0) {
                    console.log(`  已创建 ${totalModules} 个模块...`);
                }

                for (let l1Idx = 0; l1Idx < LEVEL1_PER_MODULE; l1Idx++) {
                    const testPoint = TEST_POINTS[l1Idx % TEST_POINTS.length];
                    const l1Name = `${moduleInfo.name} - ${testPoint} - ${l1Idx + 1}`;
                    const testType = randomItem(TEST_TYPES);

                    const [l1Result] = await connection.execute(
                        'INSERT INTO level1_points (module_id, name, test_type, order_index) VALUES (?, ?, ?, ?)',
                        [modId, l1Name, testType, l1Idx]
                    );
                    const l1Id = l1Result.insertId;
                    totalLevel1++;

                    for (let caseIdx = 0; caseIdx < CASES_PER_LEVEL1; caseIdx++) {
                        const caseId = generateCaseId();
                        const priority = randomItem(PRIORITIES);
                        const type = randomItem(TEST_TYPES);
                        const method = randomItem(METHODS);
                        const status = randomItem(STATUSES);
                        const creator = randomItem(users);
                        const owner = randomItem(users);

                        const caseName = `${moduleInfo.name}_${testPoint}_用例${caseIdx + 1}`;
                        const precondition = `1. 设备已上电并完成初始化\n2. ${moduleInfo.desc}模块已加载\n3. 测试环境已准备就绪`;
                        const purpose = `验证${moduleInfo.name}模块的${testPoint}功能正确性和稳定性`;
                        const steps = `1. 配置${moduleInfo.name}相关参数\n2. 设置测试条件\n3. 发送测试报文\n4. 检查处理结果\n5. 验证预期行为`;
                        const expected = `1. ${moduleInfo.name}功能正常工作\n2. 报文处理正确\n3. 统计计数准确\n4. 无异常错误`;

                        const [caseResult] = await connection.execute(
                            'INSERT INTO test_cases (case_id, name, priority, type, precondition, purpose, steps, expected, creator, library_id, module_id, level1_id, owner, method, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [caseId, caseName, priority, type, precondition, purpose, steps, expected, creator, libraryId, modId, l1Id, owner, method, status]
                        );
                        totalCases++;

                        if (Math.random() > 0.3 && projectId) {
                            await connection.execute(
                                'INSERT INTO test_case_projects (test_case_id, project_id, progress_id, status_id, owner) VALUES (?, ?, ?, ?, ?)',
                                [caseResult.insertId, projectId,
                                    progressIds.length > 0 ? randomItem(progressIds) : null,
                                    statusIds.length > 0 ? randomItem(statusIds) : null,
                                    owner]
                            );
                            totalCaseProjects++;
                        }
                    }

                    if (totalLevel1 % 100 === 0) {
                        console.log(`  进度: 模块=${totalModules}, 一级测试点=${totalLevel1}, 用例=${totalCases}`);
                    }
                }
            }

            console.log(`\n=== 用例库 ${libName} 完成 ===`);
            console.log(`  当前统计: 模块=${totalModules}, 一级测试点=${totalLevel1}, 用例=${totalCases}`);
        }

        await connection.query('COMMIT');
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        console.log('\n========================================');
        console.log('数据填充完成！');
        console.log('========================================');
        console.log(`用例库总数: ${libraryIds.length}`);
        console.log(`模块总数: ${totalModules}`);
        console.log(`一级测试点总数: ${totalLevel1}`);
        console.log(`测试用例总数: ${totalCases}`);
        console.log(`用例项目关联总数: ${totalCaseProjects}`);
        console.log(`耗时: ${duration} 秒`);
        console.log('========================================');

    } catch (error) {
        if (connection) {
            await connection.query('ROLLBACK');
        }
        console.error('填充数据错误:', error);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

seedDatabase().catch(console.error);
