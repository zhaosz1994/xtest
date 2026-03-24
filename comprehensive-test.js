const http = require('http');

const API_BASE_URL = 'http://localhost:3000/api';

// 简单的HTTP请求函数
function httpRequest(endpoint, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
    };

    const req = http.request(`${API_BASE_URL}${endpoint}`, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, message: 'Invalid JSON response', data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// 测试结果统计
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let testResults = [];

// 测试函数
async function runTest(testName, testFunction) {
  totalTests++;
  console.log(`\n=== 测试 ${totalTests}: ${testName} ===`);
  
  try {
    await testFunction();
    passedTests++;
    testResults.push({ name: testName, status: 'PASS' });
    console.log(`✅ ${testName} - 通过`);
  } catch (error) {
    failedTests++;
    testResults.push({ name: testName, status: 'FAIL', error: error.message });
    console.log(`❌ ${testName} - 失败: ${error.message}`);
  }
}

// 断言函数
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || '断言失败');
  }
}

// 全局变量
let adminToken = null;
let testerToken = null;
let testProjectId = null;
let testTestCaseId = null;

// 主测试函数
async function runAllTests() {
  console.log('========================================');
  console.log('开始全面系统测试');
  console.log('========================================');
  
  // 1. 测试用户认证功能
  await runTest('管理员登录', async () => {
    const result = await httpRequest('/users/login', 'POST', {
      username: 'admin',
      password: 'admin123'
    });
    
    assert(result.token, '登录失败，未返回token');
    assert(result.user, '登录失败，未返回用户信息');
    assert(result.user.role === '管理员' || result.user.role === 'admin', '管理员角色不正确');
    
    adminToken = result.token;
    console.log('管理员登录成功，用户信息:', result.user);
  });
  
  await runTest('测试人员登录', async () => {
    // 先尝试注册一个测试人员账号
    await httpRequest('/users/register', 'POST', {
      username: 'testuser',
      password: 'test123',
      email: 'test@example.com'
    });
    
    // 然后登录
    const result = await httpRequest('/users/login', 'POST', {
      username: 'testuser',
      password: 'test123'
    });
    
    assert(result.token, '登录失败，未返回token');
    assert(result.user, '登录失败，未返回用户信息');
    assert(result.user.role === '测试人员' || result.user.role === 'tester', '测试人员角色不正确');
    
    testerToken = result.token;
    console.log('测试人员登录成功，用户信息:', result.user);
  });
  
  await runTest('错误密码登录', async () => {
    const result = await httpRequest('/users/login', 'POST', {
      username: 'admin',
      password: 'wrongpassword'
    });
    
    assert(!result.token, '错误密码登录不应该成功');
    console.log('错误密码登录测试通过');
  });
  
  // 2. 测试项目管理功能
  await runTest('获取项目列表', async () => {
    const result = await httpRequest('/projects/list');
    
    assert(result.success, '获取项目列表失败');
    assert(Array.isArray(result.projects), '项目列表格式不正确');
    
    if (result.projects.length > 0) {
      testProjectId = result.projects[0].id;
    }
    
    console.log('项目列表获取成功，项目数量:', result.projects.length);
  });
  
  await runTest('创建新项目', async () => {
    const result = await httpRequest('/projects/add', 'POST', {
      name: '测试项目_' + Date.now(),
      code: 'TEST_' + Date.now(),
      description: '这是一个测试项目'
    }, { 'Authorization': `Bearer ${adminToken}` });
    
    assert(result.success, '创建项目失败');
    assert(result.project, '未返回项目信息');
    
    testProjectId = result.project.id;
    console.log('项目创建成功，项目ID:', testProjectId);
  });
  
  // 3. 测试测试用例管理功能
  await runTest('获取用例库列表', async () => {
    const result = await httpRequest('/libraries/list');
    
    assert(result.success !== false, '获取用例库列表失败');
    console.log('用例库列表获取成功');
  });
  
  await runTest('获取模块列表', async () => {
    const result = await httpRequest('/modules/list', 'POST', {
      libraryId: 1,
      page: 1,
      pageSize: 10
    });
    
    assert(result.success, '获取模块列表失败');
    assert(Array.isArray(result.modules), '模块列表格式不正确');
    console.log('模块列表获取成功，模块数量:', result.modules.length);
  });
  
  await runTest('获取一级测试点', async () => {
    const result = await httpRequest('/testpoints/level1/all', 'POST', {
      libraryId: 1
    });
    
    assert(result.success !== false, '获取一级测试点失败');
    console.log('一级测试点获取成功');
  });
  
  // 4. 测试测试用例项目关联功能
  if (testProjectId) {
    await runTest('测试用例关联项目（带remark字段）', async () => {
      // 先获取或创建一个测试用例
      let testCaseId = '1'; // 假设存在测试用例1
      
      const testRemark = '测试备注_' + Date.now();
      const result = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', {
        associations: [
          {
            project_id: testProjectId,
            owner: 'test_user',
            progress_id: '1',
            status_id: '1',
            remark: testRemark
          }
        ]
      });
      
      assert(result.success, '保存关联项目失败');
      
      // 验证remark字段是否保存成功
      const verifyResult = await httpRequest(`/testcases/${testCaseId}/projects`);
      assert(verifyResult.success, '获取关联项目失败');
      
      if (verifyResult.projects && verifyResult.projects.length > 0) {
        const savedRemark = verifyResult.projects[0].remark;
        assert(savedRemark === testRemark, `remark字段保存失败，预期: ${testRemark}, 实际: ${savedRemark}`);
        console.log('remark字段验证成功:', savedRemark);
      }
    });
  }
  
  // 5. 测试权限管理功能
  await runTest('管理员权限验证', async () => {
    // 测试管理员可以访问的接口
    const result = await httpRequest('/users/list', 'GET', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    
    assert(Array.isArray(result), '管理员应该能够访问用户列表');
    console.log('管理员权限验证成功');
  });
  
  await runTest('测试人员权限验证', async () => {
    // 测试测试人员不能访问管理员接口
    const result = await httpRequest('/users/add', 'POST', {
      username: 'newuser',
      password: 'password',
      role: '测试人员',
      email: 'newuser@example.com'
    }, {
      'Authorization': `Bearer ${testerToken}`
    });
    
    assert(!result.success || result.message, '测试人员不应该能够添加用户');
    console.log('测试人员权限验证成功');
  });
  
  // 6. 测试数据可视化功能
  await runTest('获取测试进度列表', async () => {
    const result = await httpRequest('/test-progresses/list');
    
    assert(result.success !== false, '获取测试进度列表失败');
    console.log('测试进度列表获取成功');
  });
  
  await runTest('获取测试状态列表', async () => {
    const result = await httpRequest('/test-statuses/list');
    
    assert(result.success !== false, '获取测试状态列表失败');
    console.log('测试状态列表获取成功');
  });
  
  // 7. 测试环境配置功能
  await runTest('获取环境列表', async () => {
    const result = await httpRequest('/environments/list');
    
    assert(result.success !== false, '获取环境列表失败');
    console.log('环境列表获取成功');
  });
  
  await runTest('获取测试方式列表', async () => {
    const result = await httpRequest('/test-methods/list');
    
    assert(result.success !== false, '获取测试方式列表失败');
    console.log('测试方式列表获取成功');
  });
  
  // 输出测试结果汇总
  console.log('\n========================================');
  console.log('测试结果汇总');
  console.log('========================================');
  console.log(`总测试数: ${totalTests}`);
  console.log(`通过: ${passedTests}`);
  console.log(`失败: ${failedTests}`);
  console.log(`通过率: ${((passedTests / totalTests) * 100).toFixed(2)}%`);
  
  console.log('\n详细测试结果:');
  testResults.forEach((result, index) => {
    const status = result.status === 'PASS' ? '✅' : '❌';
    console.log(`${status} ${index + 1}. ${result.name} - ${result.status}`);
    if (result.error) {
      console.log(`   错误: ${result.error}`);
    }
  });
  
  console.log('\n========================================');
  if (failedTests === 0) {
    console.log('🎉 所有测试通过！');
  } else {
    console.log('⚠️  部分测试失败，请检查上述错误信息。');
  }
  console.log('========================================');
}

// 运行所有测试
runAllTests().catch(error => {
  console.error('测试执行失败:', error);
});
