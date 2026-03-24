const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '123456',
  database: 'ctcsdk_testplan'
};

async function insertTestData() {
  const pool = mysql.createPool(dbConfig);
  
  try {
    console.log('开始插入测试数据...');
    
    // 1. 插入用户数据
    console.log('插入用户数据...');
    const users = [
      ['admin', 'admin123', '管理员', 'admin@example.com'],
      ['tester1', 'tester123', '测试人员', 'tester1@example.com'],
      ['tester2', 'tester123', '测试人员', 'tester2@example.com'],
      ['tester3', 'tester123', '测试人员', 'tester3@example.com'],
      ['developer1', 'dev123', '开发人员', 'dev1@example.com'],
      ['developer2', 'dev123', '开发人员', 'dev2@example.com']
    ];
    
    for (const user of users) {
      try {
        await pool.execute(
          'INSERT IGNORE INTO users (username, password, role, email) VALUES (?, ?, ?, ?)',
          user
        );
      } catch (e) {
        console.log(`用户 ${user[0]} 已存在，跳过`);
      }
    }
    console.log('用户数据插入完成');
    
    // 2. 插入项目数据
    console.log('插入项目数据...');
    const projects = [
      ['M12项目', 'M12', 'M12产品化测试项目'],
      ['M4项目', 'M4', 'M4芯片测试项目'],
      ['IPU项目', 'IPU', 'IPU图像处理单元测试项目'],
      ['NPU项目', 'NPU', 'NPU神经网络处理单元测试项目'],
      ['VPU项目', 'VPU', 'VPU视频处理单元测试项目'],
      ['SOC项目', 'SOC', 'SOC系统级芯片测试项目'],
      ['SDK项目', 'SDK', 'SDK软件开发包测试项目'],
      ['驱动项目', 'DRV', '驱动程序测试项目']
    ];
    
    for (const project of projects) {
      try {
        await pool.execute(
          'INSERT IGNORE INTO projects (name, code, description) VALUES (?, ?, ?)',
          project
        );
      } catch (e) {
        console.log(`项目 ${project[0]} 已存在，跳过`);
      }
    }
    console.log('项目数据插入完成');
    
    // 3. 插入用例库数据
    console.log('插入用例库数据...');
    const libraries = [
      ['M12产品化测试', 'admin'],
      ['M4测试用例库', 'admin'],
      ['IPU功能测试库', 'tester1'],
      ['NPU性能测试库', 'tester2'],
      ['VPU视频测试库', 'tester3'],
      ['SOC集成测试库', 'admin'],
      ['SDK接口测试库', 'developer1'],
      ['驱动兼容性测试库', 'developer2']
    ];
    
    for (const lib of libraries) {
      try {
        await pool.execute(
          'INSERT IGNORE INTO case_libraries (name, creator) VALUES (?, ?)',
          lib
        );
      } catch (e) {
        console.log(`用例库 ${lib[0]} 已存在，跳过`);
      }
    }
    console.log('用例库数据插入完成');
    
    // 4. 插入模块数据
    console.log('插入模块数据...');
    const modules = [
      ['功能模块', 1],
      ['性能模块', 1],
      ['稳定性模块', 1],
      ['兼容性模块', 1],
      ['安全模块', 1],
      ['接口模块', 2],
      ['驱动模块', 2],
      ['系统模块', 3]
    ];
    
    for (const mod of modules) {
      try {
        await pool.execute(
          'INSERT IGNORE INTO modules (name, library_id) VALUES (?, ?)',
          mod
        );
      } catch (e) {
        console.log(`模块 ${mod[0]} 已存在，跳过`);
      }
    }
    console.log('模块数据插入完成');
    
    // 5. 插入测试状态数据
    console.log('插入测试状态数据...');
    const statuses = [
      ['通过', '测试通过'],
      ['失败', '测试失败'],
      ['阻塞', '测试阻塞'],
      ['未测试', '尚未测试'],
      ['进行中', '测试进行中'],
      ['跳过', '跳过测试']
    ];
    
    for (const status of statuses) {
      try {
        await pool.execute(
          'INSERT IGNORE INTO test_statuses (name, description) VALUES (?, ?)',
          status
        );
      } catch (e) {
        console.log(`状态 ${status[0]} 已存在，跳过`);
      }
    }
    console.log('测试状态数据插入完成');
    
    // 6. 插入测试进度数据
    console.log('插入测试进度数据...');
    const progresses = [
      ['未开始', '测试尚未开始'],
      ['进行中', '测试正在进行'],
      ['已完成', '测试已完成'],
      ['暂停', '测试暂停'],
      ['取消', '测试取消']
    ];
    
    for (const progress of progresses) {
      try {
        await pool.execute(
          'INSERT IGNORE INTO test_progresses (name, description) VALUES (?, ?)',
          progress
        );
      } catch (e) {
        console.log(`进度 ${progress[0]} 已存在，跳过`);
      }
    }
    console.log('测试进度数据插入完成');
    
    // 7. 插入测试用例数据
    console.log('插入测试用例数据...');
    const testCases = [];
    const owners = ['admin', 'tester1', 'tester2', 'tester3', 'developer1', 'developer2'];
    const priorities = ['high', 'medium', 'low'];
    const types = ['functional', 'performance', 'stability', 'security', 'compatibility'];
    
    for (let i = 1; i <= 100; i++) {
      const caseId = `CASE-${Date.now()}-${String(i).padStart(4, '0')}`;
      const name = `测试用例_${i}_${['功能测试', '性能测试', '稳定性测试', '安全测试', '兼容性测试'][i % 5]}`;
      const priority = priorities[i % 3];
      const type = types[i % 5];
      const owner = owners[i % 6];
      const libraryId = (i % 8) + 1;
      const moduleId = (i % 8) + 1;
      
      testCases.push([
        caseId,
        name,
        priority,
        type,
        `前置条件_${i}`,
        `测试目的_${i}`,
        `测试步骤_${i}\n1. 步骤一\n2. 步骤二\n3. 步骤三`,
        `预期结果_${i}`,
        'admin',
        libraryId,
        moduleId,
        owner,
        `备注信息_${i}`
      ]);
    }
    
    for (const tc of testCases) {
      try {
        await pool.execute(
          `INSERT IGNORE INTO test_cases 
           (case_id, name, priority, type, precondition, purpose, steps, expected, creator, library_id, module_id, owner, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          tc
        );
      } catch (e) {
        // 忽略重复错误
      }
    }
    console.log('测试用例数据插入完成');
    
    // 8. 插入测试用例项目关联数据
    console.log('插入测试用例项目关联数据...');
    
    // 获取测试用例ID
    const [testCaseRows] = await pool.execute('SELECT id FROM test_cases LIMIT 100');
    const [statusRows] = await pool.execute('SELECT id FROM test_statuses');
    const [progressRows] = await pool.execute('SELECT id FROM test_progresses');
    const [projectRows] = await pool.execute('SELECT id FROM projects');
    
    const testCaseIds = testCaseRows.map(r => r.id);
    const statusIds = statusRows.map(r => r.id);
    const progressIds = progressRows.map(r => r.id);
    const projectIds = projectRows.map(r => r.id);
    const ownerList = ['admin', 'tester1', 'tester2', 'tester3', 'developer1', 'developer2'];
    
    let count = 0;
    for (const tcId of testCaseIds) {
      // 每个测试用例关联1-3个项目
      const numProjects = Math.floor(Math.random() * 3) + 1;
      const shuffledProjects = [...projectIds].sort(() => Math.random() - 0.5);
      
      for (let i = 0; i < numProjects && i < shuffledProjects.length; i++) {
        const projectId = shuffledProjects[i];
        const statusId = statusIds[Math.floor(Math.random() * statusIds.length)];
        const progressId = progressIds[Math.floor(Math.random() * progressIds.length)];
        const owner = ownerList[Math.floor(Math.random() * ownerList.length)];
        const remark = `测试备注_${count}`;
        
        // 随机设置updated_at时间，用于测试趋势图
        const daysAgo = Math.floor(Math.random() * 30);
        const updatedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        
        try {
          await pool.execute(
            `INSERT IGNORE INTO test_case_projects 
             (test_case_id, project_id, status_id, progress_id, owner, remark, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tcId, projectId, statusId, progressId, owner, remark, updatedAt]
          );
          count++;
        } catch (e) {
          // 忽略重复错误
        }
      }
    }
    console.log(`测试用例项目关联数据插入完成，共 ${count} 条`);
    
    // 9. 插入一级测试点数据
    console.log('插入一级测试点数据...');
    const level1Points = [
      ['启动测试', 1, 1],
      ['关机测试', 1, 2],
      ['重启测试', 1, 3],
      ['睡眠测试', 1, 4],
      ['唤醒测试', 1, 5],
      ['性能基准测试', 2, 1],
      ['压力测试', 2, 2],
      ['长时间运行测试', 2, 3],
      ['接口测试', 3, 1],
      ['数据传输测试', 3, 2]
    ];
    
    for (const point of level1Points) {
      try {
        await pool.execute(
          'INSERT IGNORE INTO level1_points (name, module_id, order_index) VALUES (?, ?, ?)',
          point
        );
      } catch (e) {
        console.log(`一级测试点 ${point[0]} 已存在，跳过`);
      }
    }
    console.log('一级测试点数据插入完成');
    
    console.log('\n========================================');
    console.log('测试数据插入完成！');
    console.log('========================================');
    
    // 统计数据
    const [userCount] = await pool.execute('SELECT COUNT(*) as count FROM users');
    const [projectCount] = await pool.execute('SELECT COUNT(*) as count FROM projects');
    const [libraryCount] = await pool.execute('SELECT COUNT(*) as count FROM case_libraries');
    const [tcCount] = await pool.execute('SELECT COUNT(*) as count FROM test_cases');
    const [tcpCount] = await pool.execute('SELECT COUNT(*) as count FROM test_case_projects');
    
    console.log('\n数据统计:');
    console.log(`- 用户数: ${userCount[0].count}`);
    console.log(`- 项目数: ${projectCount[0].count}`);
    console.log(`- 用例库数: ${libraryCount[0].count}`);
    console.log(`- 测试用例数: ${tcCount[0].count}`);
    console.log(`- 用例项目关联数: ${tcpCount[0].count}`);
    
  } catch (error) {
    console.error('插入测试数据错误:', error);
  } finally {
    await pool.end();
  }
}

insertTestData();
