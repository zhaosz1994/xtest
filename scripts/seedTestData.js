require('dotenv').config();
const mysql = require('mysql2/promise');

const SAI_MODULES = [
    { name: 'ACL', desc: 'Access Control List - 访问控制列表' },
    { name: 'BFD', desc: 'Bidirectional Forwarding Detection - 双向转发检测' },
    { name: 'Bridge', desc: 'Bridge - 网桥' },
    { name: 'Buffer', desc: 'Buffer - 缓冲区管理' },
    { name: 'Counter', desc: 'Counter - 计数器' },
    { name: 'DebugCounter', desc: 'Debug Counter - 调试计数器' },
    { name: 'Fdb', desc: 'Forwarding Database - 转发数据库' },
    { name: 'Hash', desc: 'Hash - 哈希' },
    { name: 'HostIntf', desc: 'Host Interface - 主机接口' },
    { name: 'IsolationGroup', desc: 'Isolation Group - 隔离组' },
    { name: 'Lag', desc: 'Link Aggregation Group - 链路聚合组' },
    { name: 'Mirror', desc: 'Mirror - 镜像' },
    { name: 'Multicast', desc: 'Multicast - 组播' },
    { name: 'Mpls', desc: 'MPLS - 多协议标签交换' },
    { name: 'NAT', desc: 'Network Address Translation - 网络地址转换' },
    { name: 'Neighbor', desc: 'Neighbor - 邻居' },
    { name: 'Nexthop', desc: 'Next Hop - 下一跳' },
    { name: 'NexthopGroup', desc: 'Next Hop Group - 下一跳组' },
    { name: 'Policer', desc: 'Policer - 策略器' },
    { name: 'Port', desc: 'Port - 端口' },
    { name: 'QoSmaps', desc: 'QoS Maps - QoS映射' },
    { name: 'Queue', desc: 'Queue - 队列' },
    { name: 'Route', desc: 'Route - 路由' },
    { name: 'Router', desc: 'Router - 路由器' },
    { name: 'RouterIntf', desc: 'Router Interface - 路由接口' },
    { name: 'SamplePacket', desc: 'Sample Packet - 报文采样' },
    { name: 'Scheduler', desc: 'Scheduler - 调度器' },
    { name: 'SchedulerGroup', desc: 'Scheduler Group - 调度器组' },
    { name: 'STP', desc: 'Spanning Tree Protocol - 生成树协议' },
    { name: 'Switch', desc: 'Switch - 交换机' },
    { name: 'Tunnel', desc: 'Tunnel - 隧道' },
    { name: 'UDF', desc: 'User Defined Field - 用户自定义字段' },
    { name: 'VirtualRouter', desc: 'Virtual Router - 虚拟路由器' },
    { name: 'Vlan', desc: 'VLAN - 虚拟局域网' },
    { name: 'WRED', desc: 'Weighted RED - 加权随机早期检测' },
    { name: 'Ipmc', desc: 'IP Multicast - IP组播' },
    { name: 'IpmcGroup', desc: 'IP Multicast Group - IP组播组' },
    { name: 'L2mc', desc: 'L2 Multicast - 二层组播' },
    { name: 'L2mcGroup', desc: 'L2 Multicast Group - 二层组播组' },
    { name: 'McastFdb', desc: 'Multicast FDB - 组播转发数据库' },
    { name: 'RpfGroup', desc: 'RPF Group - 反向路径转发组' },
    { name: 'Warmboot', desc: 'Warm Boot - 热启动' },
    { name: 'MPLS VPN', desc: 'MPLS VPN - MPLS虚拟专用网络' },
    { name: 'BFD for VPN&TP', desc: 'BFD for VPN & TP - VPN和隧道保护BFD' },
    { name: 'ES', desc: 'Ethernet Segment - 以太网段' },
    { name: 'PTP', desc: 'Precision Time Protocol - 精确时间协议' },
    { name: 'SYNCE', desc: 'SyncE - 同步以太网' },
    { name: 'TWAMP', desc: 'TWAMP - 双向主动测量协议' },
    { name: 'Y1731', desc: 'Y.1731 - OAM性能监测' },
    { name: 'APS for VPN', desc: 'APS for VPN - VPN自动保护切换' },
    { name: 'Buffer Monitor', desc: 'Buffer Monitor - 缓冲区监控' },
    { name: 'Latency Monitor', desc: 'Latency Monitor - 延迟监控' },
    { name: 'Service QoS', desc: 'Service QoS - 服务质量' },
    { name: 'NPM', desc: 'NPM - 网络性能监测' },
    { name: 'SD Detect', desc: 'Signal Degrade Detect - 信号劣化检测' }
];

const TEST_TYPES = ['功能测试', '性能测试', '兼容性测试', '安全测试'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const CASE_TYPES = ['功能测试', '性能测试', '接口测试', '兼容性测试', '安全测试', '回归测试'];

function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateCaseId() {
    return `CASE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function seedDatabase() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('开始填充测试数据...');

        await connection.query('START TRANSACTION');

        const [existingLibraries] = await connection.execute('SELECT id FROM case_libraries LIMIT 1');
        let libraryId;

        if (existingLibraries.length > 0) {
            libraryId = existingLibraries[0].id;
            console.log(`使用现有用例库 ID: ${libraryId}`);
        } else {
            const [libResult] = await connection.execute(
                'INSERT INTO case_libraries (name, creator) VALUES (?, ?)',
                ['SAI测试用例库', 'admin']
            );
            libraryId = libResult.insertId;
            console.log(`创建用例库 ID: ${libraryId}`);
        }

        console.log('创建模块...');
        const moduleIds = [];
        for (let i = 0; i < SAI_MODULES.length; i++) {
            const module = SAI_MODULES[i];
            const moduleId = `MOD-${Date.now()}-${i}`;
            const [result] = await connection.execute(
                'INSERT INTO modules (module_id, name, library_id, order_index) VALUES (?, ?, ?, ?)',
                [moduleId, module.name, libraryId, i]
            );
            moduleIds.push(result.insertId);
        }
        console.log(`创建了 ${moduleIds.length} 个模块`);

        console.log('创建一级测试点...');
        const level1Ids = [];
        let level1Count = 0;
        for (let i = 0; i < moduleIds.length; i++) {
            const moduleId = moduleIds[i];
            const pointsPerModule = Math.floor(Math.random() * 3) + 1;
            
            for (let j = 0; j < pointsPerModule && level1Count < 60; j++) {
                const module = SAI_MODULES[i];
                const level1Id = `LP-${Date.now()}-${level1Count}`;
                const [result] = await connection.execute(
                    'INSERT INTO level1_points (module_id, name, test_type, order_index, level1_id) VALUES (?, ?, ?, ?, ?)',
                    [moduleId, `${module.name} - 测试点${j + 1}`, randomItem(TEST_TYPES), j, level1Id]
                );
                level1Ids.push({ id: result.insertId, moduleId: moduleId });
                level1Count++;
            }
        }
        console.log(`创建了 ${level1Ids.length} 个一级测试点`);

        console.log('创建测试用例...');
        let caseCount = 0;

        for (let i = 0; i < level1Ids.length && caseCount < 320; i++) {
            const level1 = level1Ids[i];
            const casesPerPoint = Math.floor(Math.random() * 8) + 3;
            const module = SAI_MODULES.find((_, idx) => moduleIds[idx] === level1.moduleId);
            const moduleName = module ? module.name : 'Unknown';

            for (let j = 0; j < casesPerPoint && caseCount < 320; j++) {
                const caseId = generateCaseId();
                const priority = randomItem(PRIORITIES);
                const type = randomItem(CASE_TYPES);
                const name = `${moduleName} - 测试用例 #${Math.floor(Math.random() * 10000)}`;
                
                await connection.execute(
                    `INSERT INTO test_cases (case_id, name, priority, type, precondition, purpose, steps, expected, creator, library_id, module_id, level1_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [caseId, name, priority, type, '前置条件：设备已初始化并配置完成', `验证${moduleName}功能的正确性和稳定性`, `1. 初始化${moduleName}模块\n2. 配置相关参数\n3. 执行测试操作\n4. 验证结果`, '预期结果：功能正常，无异常错误', 'admin', libraryId, level1.moduleId, level1.id]
                );
                caseCount++;
                
                if (caseCount % 50 === 0) {
                    console.log(`已创建 ${caseCount} 个测试用例...`);
                }
            }
        }

        console.log(`总共创建了 ${caseCount} 个测试用例`);

        await connection.query('COMMIT');

        const [moduleCount] = await connection.execute('SELECT COUNT(*) as count FROM modules');
        const [level1CountResult] = await connection.execute('SELECT COUNT(*) as count FROM level1_points');
        const [caseCountResult] = await connection.execute('SELECT COUNT(*) as count FROM test_cases');

        console.log('\n=== 数据填充完成 ===');
        console.log(`模块总数: ${moduleCount[0].count}`);
        console.log(`一级测试点总数: ${level1CountResult[0].count}`);
        console.log(`测试用例总数: ${caseCountResult[0].count}`);

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
